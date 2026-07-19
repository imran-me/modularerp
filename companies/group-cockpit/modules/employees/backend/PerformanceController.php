<?php

namespace Epal\Modules\GroupCockpit\Employees;

use App\Support\ScopesToCompany;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Performance Reviews — the REAL rating source (owner: build a real feature, not
 * a fake star score). Serves the frontend `perf_reviews` store; the SPA computes
 * each employee's rating as the average of their reviews' scores.
 *
 * Frontend review shape:
 *   { id, empId, userId, period, score, strengths, improvements, reviewer, reviewedOn }
 *   empId = the employee's frontend id (employee_id_no, else 'U-<users.id>') so
 *   it matches the employee record's `id` for client-side grouping.
 *
 * Every method is guarded by Schema::hasTable — before `php artisan migrate` has
 * created performance_reviews on a server, the endpoints return empty / no-op
 * rather than 500, so the live app keeps working until the table exists.
 */
class PerformanceController
{
    use ScopesToCompany;

    private function present(object $r): array
    {
        return [
            'id'           => 'PR-' . $r->id,
            'empId'        => $r->employee_id_no ?: ('U-' . $r->user_id),
            'userId'       => (int) $r->user_id,
            'period'       => $r->period,
            'score'        => (float) $r->score,
            'strengths'    => $r->strengths,
            'improvements' => $r->improvements,
            'reviewer'     => $r->reviewer,
            'reviewedOn'   => $r->reviewed_on,
        ];
    }

    /** Resolve the frontend empId ('U-<n>' or an employee_id_no) → users.id. */
    private function userIdFor(?string $empId): ?int
    {
        $empId = trim((string) $empId);
        if ($empId === '') {
            return null;
        }
        if (preg_match('/^U-(\d+)$/', $empId, $m)) {
            return (int) $m[1];
        }
        $row = DB::table('users')->where('employee_id_no', $empId)->first('id');
        return $row?->id;
    }

    public function index(Request $request): JsonResponse
    {
        if (! Schema::hasTable('performance_reviews')) {
            return response()->json(['success' => true, 'count' => 0, 'data' => []]);
        }
        $cid = $this->requesterCompanyId($request);
        $rows = DB::table('performance_reviews as pr')
            ->leftJoin('users as u', 'u.id', '=', 'pr.user_id')
            ->when($cid, fn ($q) => $q->where('u.company_id', $cid))   // company user: only their own people's reviews
            ->orderByDesc('pr.reviewed_on')
            ->get(['pr.id', 'pr.user_id', 'pr.period', 'pr.score', 'pr.strengths',
                'pr.improvements', 'pr.reviewer', 'pr.reviewed_on', 'u.employee_id_no']);

        return response()->json([
            'success' => true,
            'count'   => $rows->count(),
            'data'    => $rows->map(fn ($r) => $this->present($r))->values(),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        if (! Schema::hasTable('performance_reviews')) {
            return response()->json(['success' => false, 'message' => 'Performance table not migrated yet. Run: php artisan migrate'], 503);
        }
        $v = $request->validate([
            'id'           => 'nullable|string',
            'empId'        => 'required|string',
            'period'       => 'nullable|string|max:255',
            'score'        => 'required|numeric|min:0|max:5',
            'strengths'    => 'nullable|string',
            'improvements' => 'nullable|string',
            'reviewer'     => 'nullable|string|max:255',
            'reviewedOn'   => 'nullable|date',
        ]);

        $userId = $this->userIdFor($v['empId']);
        if (! $userId) {
            return response()->json(['success' => false, 'message' => 'Unknown employee'], 422);
        }

        $existingId = null;
        if (!empty($v['id']) && preg_match('/^PR-(\d+)$/', $v['id'], $m)) {
            $n = (int) $m[1];
            if (DB::table('performance_reviews')->where('id', $n)->exists()) {
                $existingId = $n;
            }
        }

        $row = [
            'user_id'      => $userId,
            'period'       => $v['period'] ?? null,
            'score'        => $v['score'],
            'strengths'    => $v['strengths'] ?? null,
            'improvements' => $v['improvements'] ?? null,
            'reviewer'     => $v['reviewer'] ?? ($request->user()->name ?? null),
            'reviewed_on'  => $v['reviewedOn'] ?? now()->toDateString(),
            'updated_at'   => now(),
        ];

        if ($existingId) {
            DB::table('performance_reviews')->where('id', $existingId)->update($row);
            $id = $existingId;
        } else {
            $row['created_by'] = $request->user()->id ?? null;
            $row['created_at'] = now();
            $id = DB::table('performance_reviews')->insertGetId($row);
        }

        $saved = DB::table('performance_reviews as pr')
            ->leftJoin('users as u', 'u.id', '=', 'pr.user_id')
            ->where('pr.id', $id)
            ->first(['pr.id', 'pr.user_id', 'pr.period', 'pr.score', 'pr.strengths',
                'pr.improvements', 'pr.reviewer', 'pr.reviewed_on', 'u.employee_id_no']);

        return response()->json(['success' => true, 'data' => $this->present($saved)]);
    }

    public function destroy(string $id): JsonResponse
    {
        if (Schema::hasTable('performance_reviews') && preg_match('/^PR-(\d+)$/', $id, $m)) {
            DB::table('performance_reviews')->where('id', (int) $m[1])->delete();
        }

        return response()->json(['success' => true]);
    }
}
