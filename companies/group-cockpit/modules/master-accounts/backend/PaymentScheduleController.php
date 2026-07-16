<?php

namespace Epal\Modules\GroupCockpit\MasterAccounts;

use Illuminate\Http\JsonResponse;
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
 * Pure read/translate.
 */
class PaymentScheduleController
{
    /** DB companies.id -> frontend company slug (matches platform/core/config.js). */
    private function companySlug($id): string
    {
        $map = [
            1 => 'it', 2 => 'travels', 3 => 'construction', 4 => 'group',
            5 => 'shop', 6 => 'woodart',
        ];
        return $map[(int) $id] ?? 'group';
    }

    public function index(): JsonResponse
    {
        $rows = DB::table('payment_schedules')
            ->orderBy('scheduled_date')
            ->get();

        $data = $rows->map(function ($s) {
            return [
                'id'               => (string) $s->id,
                'companyId'        => $this->companySlug($s->company_id),
                'party'            => $s->party_name ?: '',
                'partyType'        => $s->party_type ?: '',
                'kind'             => $s->type === 'receive' ? 'Receivable' : 'Payable',
                'amount'           => (float) $s->amount,
                'paidAmount'       => $s->paid_amount !== null ? (float) $s->paid_amount : 0,
                'due'              => $s->scheduled_date,
                'status'          => ucfirst((string) $s->status),
                'priority'         => $s->priority ?: 'medium',
                'desc'             => $s->note ?: '',
                'rescheduleCount'  => (int) $s->reschedule_count,
                'rescheduleReason' => $s->reschedule_reason ?: '',
                'paidDate'         => $s->paid_date,
            ];
        })->values();

        return response()->json([
            'success' => true,
            'count'   => $data->count(),
            'data'    => $data,
        ]);
    }
}
