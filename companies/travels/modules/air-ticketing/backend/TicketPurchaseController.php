<?php
namespace Epal\Modules\Travels\AirTicketing;

use App\Support\ScopesToCompany;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
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
 *
 * index() is pure read/translate. store()/destroy() are the write side.
 * NOTE the read side already returns '' for route (fromCode/toCode/via) and
 * vendor because the real table has no columns for them — the write side
 * therefore CANNOT persist those either (adding columns would be a schema
 * change, out of scope). Those fields stay a frontend-only convenience,
 * exactly as on the read side today — R2, behaviour unchanged. Everything
 * the table DOES model round-trips.
 */
class TicketPurchaseController
{
    use ScopesToCompany;

    private function present(object $p): array
    {
        $total = (float) $p->amount;
        $paid  = (float) $p->paid_amount;
        $due   = (float) $p->due_amount;
        $payStatus = ($due <= 0) ? 'Confirm' : (($paid > 0) ? 'Partial' : 'Pending');
        $tripMap  = ['one-way' => 'One-way', 'two-way' => 'Two-way'];

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
            'tripType'     => $tripMap[$p->trip_type] ?? 'One-way',
            'total'        => $total,
            'paid'         => $paid,
            'due'          => $due,
            'payStatus'    => $payStatus,
            'route'        => '',
            'status'       => 'Confirm',
            'created'      => $p->created_at,
        ];
    }

    private function reload(int $id): ?object
    {
        return DB::table('ticket_purchases as tp')
            ->leftJoin('passport_holders as ph', 'ph.id', '=', 'tp.passport_holder_id')
            ->where('tp.id', $id)
            ->first(['tp.id', 'tp.ticket_no', 'tp.purchase_date', 'tp.trip_type', 'tp.airline_or_operator',
                'tp.amount', 'tp.paid_amount', 'tp.due_amount', 'tp.status', 'tp.payment_status',
                'tp.created_at', 'ph.name as passenger', 'ph.passport_no']);
    }

    public function index(Request $request): JsonResponse
    {
        $cid = $this->requesterCompanyId($request);
        $rows = DB::table('ticket_purchases as tp')
            ->leftJoin('passport_holders as ph', 'ph.id', '=', 'tp.passport_holder_id')
            ->whereNull('tp.deleted_at')
            ->when($cid, fn ($q) => $q->where('tp.company_id', $cid))   // company user: only their own
            ->orderByDesc('tp.purchase_date')
            ->get(['tp.id', 'tp.ticket_no', 'tp.purchase_date', 'tp.trip_type', 'tp.airline_or_operator',
                'tp.amount', 'tp.paid_amount', 'tp.due_amount', 'tp.status', 'tp.payment_status',
                'tp.created_at', 'ph.name as passenger', 'ph.passport_no']);

        return response()->json([
            'success' => true,
            'count'   => $rows->count(),
            'data'    => $rows->map(fn ($p) => $this->present($p))->values(),
        ]);
    }

    /** Passenger name + passport resolve to a passport_holders FK. passport_no
     *  is NOT NULL + UNIQUE, so a blank passport gets a generated placeholder
     *  (same pattern as the Cash Box account_number). Find-or-create keyed on
     *  passport_no — the passenger's OWN identity — so re-buying a ticket for
     *  the same passport reuses the holder rather than duplicating them. */
    private function passportHolderId(string $passenger, ?string $passport, int $userId): int
    {
        $passport = trim((string) $passport);
        if ($passport !== '') {
            $row = DB::table('passport_holders')->where('passport_no', $passport)->first('id');
            if ($row) {
                return $row->id;
            }
        } else {
            $passport = 'NOPP-' . strtoupper(substr(uniqid(), -8));   // no passport given — stable unique placeholder
        }

        return DB::table('passport_holders')->insertGetId([
            'name' => $passenger ?: 'Unknown', 'passport_no' => $passport,
            'nationality' => 'Bangladeshi', 'type' => 'general', 'status' => 'active',
            'created_by' => $userId, 'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    public function store(\Illuminate\Http\Request $request): JsonResponse
    {
        $v = $request->validate([
            'id'           => 'nullable|string',
            'ticketNo'     => 'required|string|max:255',
            'purchaseDate' => 'nullable|date',
            'passenger'    => 'required|string|max:255',
            'passport'     => 'nullable|string|max:255',
            'airlineCode'  => 'nullable|string|max:255',
            'tripType'     => 'nullable|string|max:50',
            'total'        => 'required|numeric|min:0',
            'paid'         => 'nullable|numeric|min:0',
        ]);

        $existingId = null;
        if (!empty($v['id']) && preg_match('/^\d+$/', $v['id'])) {
            $n = (int) $v['id'];
            if (DB::table('ticket_purchases')->where('id', $n)->whereNull('deleted_at')->exists()) {
                $existingId = $n;
            }
        }

        $userId = $request->user()->id;
        $total  = (float) $v['total'];
        $paid   = min((float) ($v['paid'] ?? 0), $total);
        $due    = max(0, $total - $paid);
        $payment = $due <= 0 ? 'paid' : ($paid > 0 ? 'partial' : 'due');

        $row = [
            'passport_holder_id'  => $this->passportHolderId($v['passenger'], $v['passport'] ?? null, $userId),
            'ticket_type'         => 'air',
            'trip_type'           => strtolower($v['tripType'] ?? 'one-way') === 'two-way' ? 'two-way' : 'one-way',
            'airline_or_operator' => $v['airlineCode'] ?? null,
            'ticket_no'           => $v['ticketNo'],
            'purchase_date'       => $v['purchaseDate'] ?? now()->toDateString(),
            'amount'              => $total,
            'paid_amount'         => $paid,
            'due_amount'          => $due,
            'payment_status'      => $payment,
            'status'              => 'confirm',
            'company_id'          => 2,   // travels — this module IS the travels air-ticketing desk
            'updated_at'          => now(),
        ];

        if ($existingId) {
            DB::table('ticket_purchases')->where('id', $existingId)->update($row);
            $id = $existingId;
        } else {
            $row['created_by'] = $userId;
            $row['created_at'] = now();
            $id = DB::table('ticket_purchases')->insertGetId($row);
        }

        return response()->json(['success' => true, 'data' => $this->present($this->reload($id))]);
    }

    public function destroy(string $id): JsonResponse
    {
        if (preg_match('/^\d+$/', $id)) {
            DB::table('ticket_purchases')->where('id', (int) $id)->update(['deleted_at' => now()]);
        }

        return response()->json(['success' => true]);
    }
}
