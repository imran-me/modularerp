<?php
namespace Epal\Modules\Travels\AirTicketing;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

/**
 * Airlines master — carriers the ticketing desk buys/sells on.
 * Real table: `airlines` (id, name, status). 24 rows.
 * Frontend store 'airlines' shape: { id, name, iata, country, status }.
 * The DB carries no IATA / country columns, so IATA is best-effort parsed
 * from a "(XX)" designator embedded in the name (e.g. "Emirates (EK)"),
 * and country is left blank. `status` tinyint(1) maps to active/inactive.
 *
 * index() is pure read/translate. store()/destroy() are master-data writes
 * (no ledger impact) — `name` is UNIQUE in the real table, so an IATA code
 * typed into the name (frontend has no separate iata field to send) is kept
 * as part of the stored name, same as every existing row.
 */
class AirlineController
{
    private function present(object $a): array
    {
        $iata = '';
        if (preg_match('/\(([A-Z0-9]{2,3})\)/', (string) $a->name, $m)) {
            $iata = $m[1];
        }
        return [
            'id'      => $a->id,
            'name'    => $a->name,
            'iata'    => $iata,
            'country' => '',
            'status'  => ((int) $a->status === 1) ? 'active' : 'inactive',
        ];
    }

    public function index(): JsonResponse
    {
        $rows = DB::table('airlines')
            ->orderBy('name')
            ->get(['id', 'name', 'status']);

        return response()->json([
            'success' => true,
            'count'   => $rows->count(),
            'data'    => $rows->map(fn ($a) => $this->present($a))->values(),
        ]);
    }

    /** Create OR update, keyed by a numeric id that exists (create otherwise —
     *  same rule as every other module in this rollout). */
    public function store(\Illuminate\Http\Request $request): JsonResponse
    {
        $v = $request->validate([
            'id'     => 'nullable',
            'name'   => 'required|string|max:255',
            'status' => 'nullable|in:active,inactive',
        ]);

        $existingId = null;
        if (!empty($v['id']) && preg_match('/(\d+)/', (string) $v['id'], $m)) {
            $n = (int) $m[1];
            if (DB::table('airlines')->where('id', $n)->exists()) {
                $existingId = $n;
            }
        }

        $row = [
            'name'       => $v['name'],
            'status'     => ($v['status'] ?? 'active') === 'active' ? 1 : 0,
            'updated_at' => now(),
        ];

        if ($existingId) {
            DB::table('airlines')->where('id', $existingId)->update($row);
            $id = $existingId;
        } else {
            $row['created_at'] = now();
            $id = DB::table('airlines')->insertGetId($row);
        }

        $saved = DB::table('airlines')->where('id', $id)->first(['id', 'name', 'status']);

        return response()->json(['success' => true, 'data' => $this->present($saved)]);
    }

    public function destroy(string $id): JsonResponse
    {
        preg_match('/(\d+)/', $id, $m);
        $n = (int) ($m[1] ?? 0);
        if ($n > 0) {
            DB::table('airlines')->where('id', $n)->delete();
        }

        return response()->json(['success' => true]);
    }
}
