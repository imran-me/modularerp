<?php
namespace Epal\Modules\Travels\VisaProcessing;

use App\Support\ScopesToCompany;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
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
    use ScopesToCompany;

    /** DB payment status → frontend payStatus. */
    private const PAY_MAP = ['paid' => 'Paid', 'partial' => 'Partial', 'pending' => 'Due'];

    private function present(object $r): array
    {
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
            'payStatus'     => self::PAY_MAP[$r->status] ?? 'Due',
            'agent'         => $r->issued_by,
            'notes'         => $r->notes,
            'posted'        => true,        // already booked in the source ledger
            'stage'         => 'New',
            'created'       => $created,
            'docs'          => [],
            'timeline'      => [],
        ];
    }

    private const COLS = ['id', 'invoice_number', 'client_name', 'client_phone', 'client_email',
        'bundle_label', 'voucher_date', 'issued_by', 'total_amount', 'paid_amount', 'due_amount', 'notes', 'status'];

    public function index(Request $request): JsonResponse
    {
        $cid = $this->requesterCompanyId($request);
        $rows = DB::table('visa_sales')
            ->whereNull('deleted_at')
            ->when($cid, fn ($q) => $q->where('company_id', $cid))   // company user: only their own
            ->orderByDesc('voucher_date')
            ->get(self::COLS);

        return response()->json([
            'success' => true,
            'count'   => $rows->count(),
            'data'    => $rows->map(fn ($r) => $this->present($r))->values(),
        ]);
    }

    /** Create OR update. Keyed by the frontend id = the row's invoice_number;
     *  a client temp id ('VA-<timestamp>') won't match any invoice_number, so
     *  it's treated as a create and a fresh unique invoice_number is minted.
     *  Note: the demo's rich per-line fees (embassy/vfs) aren't modelled in the
     *  real visa_sales table (invoice total only), so those don't round-trip —
     *  same limitation the read side already has. */
    public function store(Request $request): JsonResponse
    {
        $v = $request->validate([
            'id'            => 'nullable|string',
            'applicant'     => 'required|string|max:255',
            'phone'         => 'nullable|string|max:50',
            'email'         => 'nullable|email|max:255',
            'country'       => 'nullable|string|max:255',
            'customerTotal' => 'nullable|numeric',
            'sale'          => 'nullable|numeric',
            'payStatus'     => 'nullable|string|max:50',
            'notes'         => 'nullable|string',
            'created'       => 'nullable|date',
            'travelDate'    => 'nullable|date',
        ]);

        $existingId = null;
        if (!empty($v['id'])) {
            $row = DB::table('visa_sales')->where('invoice_number', $v['id'])->whereNull('deleted_at')->first('id');
            $existingId = $row?->id;
        }

        $total  = (float) ($v['customerTotal'] ?? $v['sale'] ?? 0);
        $pay    = strtolower($v['payStatus'] ?? '');
        $status = $pay === 'paid' ? 'paid' : ($pay === 'partial' ? 'partial' : 'pending');
        $paid   = $status === 'paid' ? $total : 0;

        $row = [
            'company_id'    => 2,   // travels
            'client_name'   => $v['applicant'],
            'client_phone'  => $v['phone'] ?: '',       // NOT NULL in the real table
            'client_email'  => $v['email'] ?? null,
            'send_via'      => 'email',
            'bundle_label'  => $v['country'] ?? null,
            'voucher_date'  => $v['created'] ?? $v['travelDate'] ?? now()->toDateString(),
            'payment_terms' => 'full_today',
            'total_amount'  => $total,
            'paid_amount'   => $paid,
            'due_amount'    => max(0, $total - $paid),
            'notes'         => $v['notes'] ?? null,
            'status'        => $status,
            'updated_at'    => now(),
        ];

        if ($existingId) {
            DB::table('visa_sales')->where('id', $existingId)->update($row);
            $id = $existingId;
        } else {
            $row['invoice_number'] = 'VINV-' . strtoupper(substr(uniqid(), -6));   // NOT NULL + UNIQUE
            $row['created_by'] = $request->user()->id;
            $row['created_at'] = now();
            $id = DB::table('visa_sales')->insertGetId($row);
        }

        $saved = DB::table('visa_sales')->where('id', $id)->first(self::COLS);

        return response()->json(['success' => true, 'data' => $this->present($saved)]);
    }

    public function destroy(string $id): JsonResponse
    {
        $q = DB::table('visa_sales')->whereNull('deleted_at');
        if (preg_match('/^VA-(\d+)$/', $id, $m)) {
            $q->where('id', (int) $m[1]);
        } else {
            $q->where('invoice_number', $id);
        }
        $q->update(['deleted_at' => now()]);

        return response()->json(['success' => true]);
    }
}
