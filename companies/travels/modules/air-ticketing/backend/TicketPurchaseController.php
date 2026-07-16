<?php
namespace Epal\Modules\Travels\AirTicketing;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

/**
 * Ticket Purchase register — buying a ticket for a passport holder
 * (paid / due / total). Real table: `ticket_purchases` (3 rows).
 * Frontend store 'air_purchases' shape (view.js purchaseForm/table):
 *   { id, ticketNo, purchaseDate, passenger, passport, vendor,
 *     fromCode, toCode, via, airlineCode, tripType,
 *     total, paid, due, payStatus, route, status, created }
 *
 * The real table has no route columns (from/to/via), so those are left
 * blank; passenger + passport resolve from the linked passport holder.
 * payStatus is derived the same way the frontend derives it
 * (due<=0 → Confirm, paid>0 → Partial, else Pending).
 */
class TicketPurchaseController
{
    public function index(): JsonResponse
    {
        $rows = DB::table('ticket_purchases as tp')
            ->leftJoin('passport_holders as ph', 'ph.id', '=', 'tp.passport_holder_id')
            ->whereNull('tp.deleted_at')
            ->orderByDesc('tp.purchase_date')
            ->get([
                'tp.id',
                'tp.ticket_no',
                'tp.purchase_date',
                'tp.trip_type',
                'tp.airline_or_operator',
                'tp.amount',
                'tp.paid_amount',
                'tp.due_amount',
                'tp.status',
                'tp.payment_status',
                'tp.created_at',
                'ph.name as passenger',
                'ph.passport_no',
            ]);

        $purchases = $rows->map(function ($p) {
            $total = (float) $p->amount;
            $paid  = (float) $p->paid_amount;
            $due   = (float) $p->due_amount;

            // Mirror the frontend's status vocabulary/colours.
            $payStatus = ($due <= 0) ? 'Confirm' : (($paid > 0) ? 'Partial' : 'Pending');

            // trip_type enum ('one-way' | 'two-way') → display label.
            $tripMap  = ['one-way' => 'One-way', 'two-way' => 'Two-way'];
            $tripType = $tripMap[$p->trip_type] ?? 'One-way';

            return [
                'id'           => $p->id,
                'ticketNo'     => $p->ticket_no,
                'purchaseDate' => $p->purchase_date,
                'passenger'    => $p->passenger ?? '',
                'passport'     => $p->passport_no ?? '',
                'vendor'       => '',
                'fromCode'     => '',
                'toCode'       => '',
                'via'          => '',
                'airlineCode'  => $p->airline_or_operator ?? '',
                'tripType'     => $tripType,
                'total'        => $total,
                'paid'         => $paid,
                'due'          => $due,
                'payStatus'    => $payStatus,
                'route'        => '',
                'status'       => 'Confirm',
                'created'      => $p->created_at,
            ];
        })->values();

        return response()->json([
            'success' => true,
            'count'   => $purchases->count(),
            'data'    => $purchases,
        ]);
    }
}
