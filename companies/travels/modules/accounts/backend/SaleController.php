<?php

namespace Epal\Modules\Travels\Accounts;

use App\Exceptions\LedgerException;
use App\Services\ReceiptPostingService;
use App\Services\SalePostingService;
use App\Support\ScopesToCompany;
use Epal\Modules\Travels\Accounts\Http\Requests\StoreReceiptRequest;
use Epal\Modules\Travels\Accounts\Http\Requests\StoreSaleRequest;
use Epal\Modules\Travels\Accounts\Http\Resources\ReceiptResource;
use Epal\Modules\Travels\Accounts\Http\Resources\SalePostingResource;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * TRAVELS · SALES & RECEIPTS — the income half of the money desk.
 * ----------------------------------------------------------------------------
 * Every Travels module that SELLS (air ticketing, visa, EMD, contract flights)
 * posts through here, so a ticket and a visa cannot be accounted for differently.
 * Its twin is ExpenseController (money out); both delegate to kernel services, so
 * this file stays a thin, readable HTTP surface.
 *
 *   POST   /api/travels/accounts/sales                  record a sale
 *   DELETE /api/travels/accounts/sales/{ref}            void it (REVERSES, never erases)
 *   POST   /api/travels/accounts/receipts               the customer paid
 *   DELETE /api/travels/accounts/receipts/{ref}         un-pay (the debt comes back)
 *   GET    /api/travels/accounts/receivables            what is still owed, per sale
 *
 * WHAT ONE CALL DOES — sell a ticket on credit, then take the money:
 *
 *   POST /api/travels/accounts/sales
 *   { "ref":"TKT-1201", "amount":100000, "cost":70000, "category":"air",
 *     "customer":"Mr Rahman", "vendor":"Emirates" }
 *   → DR 1200 Receivable / CR 4010 Air Ticket Sales     (GL-STKT-1201)
 *     DR 5000 Cost of Sales / CR 2000 Payable           (GL-SCTKT-1201)
 *
 *   POST /api/travels/accounts/receipts
 *   { "ref":"TKT-1201", "amount":100000, "bankId":"12" }
 *   → DR 1010 Bank (that account) / CR 1200             (GL-SET-TKT-1201)
 *     …and account 12's balance rises with a deposit row in its history.
 *
 * Sell it already paid instead — add "paid":true and "bankId" — and the revenue
 * journal debits that account directly; no receivable is ever raised.
 *
 * @see \App\Services\SalePostingService     the rules: VAT split, sub-agent AR,
 *                                           negative (void) costs, idempotency
 * @see \App\Services\ReceiptPostingService  settles the SAME control account the
 *                                           sale raised; refuses over-settling
 */
class SaleController
{
    use ScopesToCompany;

    private const COMPANY = 'travels';

    public function __construct(
        private SalePostingService $sales,
        private ReceiptPostingService $receipts,
    ) {}

    /** Record a sale — revenue, cost and (when it names an account) the register. */
    public function store(StoreSaleRequest $request): JsonResponse
    {
        $payload = $request->validated() + ['companyId' => self::COMPANY];

        try {
            $result = $this->sales->record($payload, $this->requesterCompanyId($request));
        } catch (LedgerException $e) {
            return response()->json(['success' => false, 'message' => $e->getMessage()], 422);
        }

        return response()->json(['success' => true, 'data' => new SalePostingResource($result)], 201);
    }

    /** Void a sale: both journals reversed, any account movement given back. */
    public function destroy(Request $request, string $ref): JsonResponse
    {
        try {
            $result = $this->sales->void($ref, (string) $request->query('reason', 'sale voided'));
        } catch (LedgerException $e) {
            return response()->json(['success' => false, 'message' => $e->getMessage()], 422);
        }

        return response()->json(['success' => true, 'data' => $result]);
    }

    /** The customer paid — into a named account, clearing the sale's receivable. */
    public function receipt(StoreReceiptRequest $request): JsonResponse
    {
        $payload = $request->validated() + ['companyId' => self::COMPANY];

        try {
            $result = $this->receipts->record($payload, $this->requesterCompanyId($request));
        } catch (LedgerException $e) {
            return response()->json(['success' => false, 'message' => $e->getMessage()], 422);
        }

        return response()->json(['success' => true, 'data' => new ReceiptResource($result)], 201);
    }

    /** Un-pay: reverse the receipt(s); the receivable returns to the ageing book. */
    public function unreceipt(Request $request, string $ref): JsonResponse
    {
        try {
            $result = $this->receipts->reverse($ref, (string) $request->query('reason', 'receipt reversed'));
        } catch (LedgerException $e) {
            return response()->json(['success' => false, 'message' => $e->getMessage()], 422);
        }

        return response()->json(['success' => true, 'data' => $result]);
    }

    /**
     * What customers still owe, per sale — read straight off the journals, so it
     * cannot drift from the ledger the way a stored "paid" flag can.
     * Optional ?ref= narrows it to one sale.
     */
    public function receivables(Request $request): JsonResponse
    {
        if (! Schema::hasTable('journal_entries')) {
            return response()->json(['success' => true, 'count' => 0, 'total' => 0, 'data' => []]);
        }
        $cid = \App\Support\CompanySlugs::dbId(self::COMPANY);
        $one = trim((string) $request->query('ref', ''));

        $sales = DB::table('journal_entries')->whereNull('deleted_at')
            ->where('source', 'sale')->where('company_id', $cid)
            ->when($one !== '', fn ($q) => $q->where('reference', 'GL-S' . $one))
            ->where('reference', 'like', 'GL-S%')
            ->orderByDesc('date')->orderByDesc('id')
            ->get(['reference', 'date', 'description']);

        $rows = [];
        $total = 0.0;
        foreach ($sales as $s) {
            // 'GL-S<ref>' → <ref>; the cost journal is 'GL-SC<ref>' and is skipped
            $ref = (string) $s->reference;
            if (str_starts_with($ref, 'GL-SC')) {
                continue;
            }
            $ref = substr($ref, 4);
            $due = $this->receipts->outstanding($ref);
            if ($due <= 0.01) {
                continue;
            }
            $rows[] = ['ref' => $ref, 'date' => $s->date, 'memo' => $s->description, 'outstanding' => $due];
            $total += $due;
        }

        return response()->json(['success' => true, 'count' => count($rows),
            'total' => round($total, 2), 'data' => $rows]);
    }
}
