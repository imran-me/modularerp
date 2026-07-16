<?php
namespace Epal\Modules\Travels\VisaProcessing;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

/**
 * VisaSaleController — real `visa_sales` rows mapped onto the frontend
 * `visaApps` store shape read by view.js (manage-sales / application-board /
 * embassy-tracking / overview).
 *
 * Frontend application shape (view.js save() + fees()):
 *   { id, applicant, phone, email, passport, nationality, dob, catId,
 *     country, flag, visaType, travelDate, embassyFee, vfsCharge, serviceFee,
 *     customerTotal, cost, sale, payStatus, agent, notes, posted, stage,
 *     created, docs[], timeline[] }
 *   fees(): with customerTotal + serviceFee supplied → cost = embassy+vfs,
 *   profit = customerTotal - cost. We surface the invoice total as both the
 *   customer total and the service fee (cost 0) so the ledger reads real money.
 */
class VisaSaleController
{
    public function index(): JsonResponse
    {
        $rows = DB::table('visa_sales')
            ->whereNull('deleted_at')
            ->orderByDesc('voucher_date')
            ->get([
                'id',
                'invoice_number',
                'client_name',
                'client_phone',
                'client_email',
                'bundle_label',
                'voucher_date',
                'issued_by',
                'total_amount',
                'paid_amount',
                'due_amount',
                'notes',
                'status',
            ]);

        // DB payment status → frontend payStatus (enum Paid|Partial|Due).
        $payMap = ['paid' => 'Paid', 'partial' => 'Partial', 'pending' => 'Due'];

        $apps = $rows->map(function ($r) use ($payMap) {
            $total = (float) $r->total_amount;
            $created = $r->voucher_date ? (string) $r->voucher_date : null;
            return [
                'id'            => $r->invoice_number ?: ('VA-' . $r->id),
                'applicant'     => $r->client_name,
                'phone'         => $r->client_phone,
                'email'         => $r->client_email,
                'passport'      => '',
                'nationality'   => '',
                'dob'           => null,
                'catId'         => null,
                'country'       => $r->bundle_label ?: '—',
                'flag'          => '🌍',
                'visaType'      => 'Tourist',
                'travelDate'    => $created,
                'embassyFee'    => 0,
                'vfsCharge'     => 0,
                'serviceFee'    => $total,      // profit == service fee
                'customerTotal' => $total,
                'cost'          => 0,           // legacy mirror
                'sale'          => $total,      // legacy mirror
                'payStatus'     => $payMap[$r->status] ?? 'Due',
                'agent'         => $r->issued_by,
                'notes'         => $r->notes,
                'posted'        => true,        // already booked in the source ledger
                'stage'         => 'New',
                'created'       => $created,
                'docs'          => [],
                'timeline'      => [],
            ];
        })->values();

        return response()->json(['success' => true, 'count' => $apps->count(), 'data' => $apps]);
    }
}
