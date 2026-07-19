<?php

namespace Epal\Modules\GroupCockpit\MasterAccounts;

use App\Support\ScopesToCompany;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Payment Schedules.
 * ----------------------------------------------------------------------------
 * Serves the REAL `payment_schedules` table in the shape the frontend
 * `acc_schedules` store reads (see schedulesView()/masterScheduleForm() in
 * view.js):
 *   { id, companyId, party, partyType, kind, amount, paidAmount, due, status,
 *     priority, desc, rescheduleCount, rescheduleReason, paidDate }
 *
 *   old.company_id         -> companyId (frontend slug)
 *   old.party_name         -> party
 *   old.party_type         -> partyType
 *   old.type(pay|receive)  -> kind (Payable|Receivable)
 *   old.amount             -> amount
 *   old.paid_amount        -> paidAmount
 *   old.scheduled_date     -> due
 *   old.status             -> status (ucfirst: Pending/Approved/Paid/Cancelled/Rejected)
 *   old.priority           -> priority (high|medium|low — already matches)
 *   old.note               -> desc
 *   old.reschedule_count   -> rescheduleCount
 *   old.reschedule_reason  -> rescheduleReason
 *   old.paid_date          -> paidDate
 *
 * index() is pure read/translate. store() is the write side — every UI
 * action (add, edit, approve, cancel, reschedule, payment-done, priority
 * change) all funnel through the SAME `db.save('acc_schedules', record)`
 * call in view.js, so ONE store() covers all of them; no per-action
 * endpoint needed. `trail` (the on-screen approval/action log) has no
 * matching DB column and isn't in index()'s own output shape either — it's
 * a frontend-only decoration in demo mode, not something this write adds
 * or removes support for.
 */
class PaymentScheduleController
{
    use ScopesToCompany;

    /** DB companies.id -> frontend company slug (matches platform/core/config.js). */
    private function companySlug($id): string
    {
        $map = [
            1 => 'it', 2 => 'travels', 3 => 'construction', 4 => 'group',
            5 => 'shop', 6 => 'woodart',
        ];
        return $map[(int) $id] ?? 'group';
    }

    /** Frontend slug -> DB companies.id. */
    private function companyId(?string $slug): ?int
    {
        $map = [
            'it' => 1, 'travels' => 2, 'construction' => 3, 'group' => 4,
            'shop' => 5, 'woodart' => 6,
        ];
        return $map[$slug] ?? null;
    }

    private function present(object $s): array
    {
        return [
            'id'               => (string) $s->id,
            'companyId'        => $this->companySlug($s->company_id),
            'party'            => $s->party_name ?: '',
            'partyType'        => $s->party_type ?: '',
            'kind'             => $s->type === 'receive' ? 'Receivable' : 'Payable',
            'amount'           => (float) $s->amount,
            'paidAmount'       => $s->paid_amount !== null ? (float) $s->paid_amount : 0,
            'due'              => $s->scheduled_date,
            'status'           => ucfirst((string) $s->status),
            'priority'         => $s->priority ?: 'medium',
            'desc'             => $s->note ?: '',
            'rescheduleCount'  => (int) $s->reschedule_count,
            'rescheduleReason' => $s->reschedule_reason ?: '',
            'paidDate'         => $s->paid_date,
        ];
    }

    public function index(Request $request): JsonResponse
    {
        $cid = $this->requesterCompanyId($request);
        $rows = DB::table('payment_schedules')
            ->when($cid, fn ($q) => $q->where('company_id', $cid))   // company user: only their own
            ->orderBy('scheduled_date')
            ->get();

        return response()->json([
            'success' => true,
            'count'   => $rows->count(),
            'data'    => $rows->map(fn ($s) => $this->present($s))->values(),
        ]);
    }

    /** Create OR update. Unlike other modules' client temp ids (which are
     *  decimal timestamps), this one's is base36 (ui.uid()) and can contain
     *  digits anywhere — extracting "the trailing digit run" the way other
     *  controllers do risks colliding with an unrelated real row. Only a
     *  STRICTLY numeric id (exactly what index() returns for a real row) is
     *  ever treated as an update; anything else is a create. */
    public function store(\Illuminate\Http\Request $request): JsonResponse
    {
        $v = $request->validate([
            'id'               => 'nullable|string',
            'companyId'        => 'nullable|string',
            'party'            => 'required|string|max:255',
            'partyType'        => 'nullable|string|max:255',
            'kind'             => 'nullable|in:Payable,Receivable',
            'amount'           => 'required|numeric|min:0',
            'paidAmount'       => 'nullable|numeric|min:0',
            'due'              => 'required|date',
            'status'           => 'nullable|string|max:50',
            'priority'         => 'nullable|in:high,medium,low',
            'desc'             => 'nullable|string',
            'rescheduleCount'  => 'nullable|integer|min:0',
            'rescheduleReason' => 'nullable|string|max:255',
            'paidDate'         => 'nullable|date',
        ]);

        $existingId = null;
        if (!empty($v['id']) && preg_match('/^\d+$/', $v['id'])) {
            $n = (int) $v['id'];
            if (DB::table('payment_schedules')->where('id', $n)->exists()) {
                $existingId = $n;
            }
        }

        $row = [
            'company_id'         => $this->companyId($v['companyId'] ?? null),
            'party_name'         => $v['party'],
            'party_type'         => $v['partyType'] ?? '',
            'type'               => ($v['kind'] ?? 'Payable') === 'Receivable' ? 'receive' : 'pay',
            'amount'             => $v['amount'],
            'paid_amount'        => $v['paidAmount'] ?? 0,
            'scheduled_date'     => $v['due'],
            'status'             => strtolower($v['status'] ?? 'pending'),
            'priority'           => $v['priority'] ?? 'medium',
            'note'               => $v['desc'] ?? null,
            'reschedule_count'   => $v['rescheduleCount'] ?? 0,
            'reschedule_reason'  => $v['rescheduleReason'] ?? null,
            'paid_date'          => $v['paidDate'] ?? null,
            'updated_at'         => now(),
        ];

        if ($existingId) {
            DB::table('payment_schedules')->where('id', $existingId)->update($row);
            $id = $existingId;
        } else {
            $row['created_by'] = $request->user()->id;
            $row['created_at'] = now();
            $id = DB::table('payment_schedules')->insertGetId($row);
        }

        $saved = DB::table('payment_schedules')->where('id', $id)->first();

        return response()->json(['success' => true, 'data' => $this->present($saved)]);
    }

    public function destroy(string $id): JsonResponse
    {
        if (preg_match('/^\d+$/', $id)) {
            DB::table('payment_schedules')->where('id', (int) $id)->delete();
        }

        return response()->json(['success' => true]);
    }
}
