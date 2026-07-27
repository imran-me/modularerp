<?php

namespace Epal\Modules\Travels\Accounts;

use App\Exceptions\LedgerException;
use App\Services\ExpensePostingService;
use App\Support\CompanySlugs;
use App\Support\ScopesToCompany;
use Epal\Modules\Travels\Accounts\Http\Requests\StoreExpenseRequest;
use Epal\Modules\Travels\Accounts\Http\Resources\ExpenseVoucherResource;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * TRAVELS · ACCOUNTS · EXPENSES — the "Record Expense" API.
 * ----------------------------------------------------------------------------
 * ONE call records a spend in every book it belongs to (register + ledger +
 * the paying account's own history), in one database transaction. The posting
 * rules live in the kernel service so every concern books an expense the same
 * way — this controller is only the HTTP surface for Travels:
 *
 *   GET    /api/travels/accounts/expenses            list Travels' expense register
 *   GET    /api/travels/accounts/expenses/form       what the form needs: the expense
 *                                                     heads and the payment accounts,
 *                                                     already in the owner's order
 *   POST   /api/travels/accounts/expenses            record one (see StoreExpenseRequest)
 *   DELETE /api/travels/accounts/expenses/{voucher}  void it: register row removed,
 *                                                     ledger REVERSED, account refunded
 *
 * Example — “tea for a guest, 1,250, paid from the City Bank account”:
 *
 *   POST /api/travels/accounts/expenses
 *   { "amount": 1250, "head": "5550", "category": "Guest & Entertainment",
 *     "subCategory": "Tea / Coffee (Guest)", "bankId": "12", "method": "Bank",
 *     "party": "Star Kabab", "date": "2026-07-26", "ref": "BR-118" }
 *
 *   → 201 { success, data: { entry, journal, funderJournal, register } }
 *     entry    = the register row (frontend `acc_entries` shape)
 *     journal  = DR 5550 / CR 1010, id GL-ACC-<voucher>
 *     register = { bankId, type:"withdraw", amount, balance } — the account after
 *
 * Add "fundedBy": "group" and it becomes an inter-company loan instead: Travels
 * books DR 5550 / CR 2400 payable, the Group books DR 1300 receivable / CR its
 * own account, and Group HQ's balance is the one that drops. Settle it later.
 *
 * @see \App\Services\ExpensePostingService  the posting rules + the double entry
 * @see \App\Services\BankRegisterService    balance + bank_transactions log
 * @see \App\Services\LedgerService          journal_entries / journal_items
 */
class ExpenseController
{
    use ScopesToCompany;

    /** This module's own concern. Every route here is scoped to it. */
    private const COMPANY = 'travels';

    public function __construct(private ExpensePostingService $expenses) {}

    /** Travels' expense register, newest first — the list the Expenses screen shows. */
    public function index(Request $request): JsonResponse
    {
        if (! Schema::hasTable('acc_entries')) {
            return response()->json(['success' => true, 'count' => 0, 'data' => []]);
        }
        $rows = DB::table('acc_entries')
            ->where('company_id', self::COMPANY)
            ->where('kind', 'Expense')
            ->when($request->query('from'), fn ($q, $d) => $q->where('date', '>=', $d))
            ->when($request->query('to'), fn ($q, $d) => $q->where('date', '<=', $d))
            ->when($request->query('head'), fn ($q, $h) => $q->where('head', $h))
            ->orderByDesc('date')->orderByDesc('id')
            ->get()
            ->map(fn ($r) => $this->present($r));

        return response()->json(['success' => true, 'count' => $rows->count(), 'data' => $rows]);
    }

    /**
     * Everything the Record-Expense form needs to render, in the ORDER the owner
     * asked for — so the client never has to re-sort or re-filter:
     *   heads[]    every chart-of-accounts code, EXPENSE codes first, each with
     *              its type, so the form can search by title or by code.
     *   accounts[] the payment accounts of each concern, Travels' first and,
     *              within a concern, banks before cash before wallets. Cash boxes
     *              (hard cash / petty cash) are included — they are accounts too.
     */
    public function formData(): JsonResponse
    {
        $heads = Schema::hasTable('accounts')
            ? DB::table('accounts')->whereNull('deleted_at')
                ->orderByRaw("CASE WHEN type = 'expense' THEN 0 ELSE 1 END")   // expense codes first
                ->orderBy('code')
                ->get(['code', 'name', 'type'])
                ->map(fn ($a) => ['code' => $a->code, 'name' => $a->name, 'type' => $a->type])
            : collect();

        // 'cash' (a cash box) sorts right after 'bank' — the owner's order is
        // "Travels bank, then cash", then the wallets and cards.
        $accounts = Schema::hasTable('banks')
            ? DB::table('banks')->whereNull('deleted_at')->where('status', 1)
                ->orderByRaw('CASE WHEN company_id = ? THEN 0 ELSE 1 END', [CompanySlugs::dbId(self::COMPANY)])
                ->orderByRaw("CASE type WHEN 'bank' THEN 0 WHEN 'cash' THEN 1 WHEN 'mobile_banking' THEN 2 ELSE 3 END")
                ->orderBy('name')
                ->get()
                ->map(fn ($b) => [
                    'id'        => (string) $b->id,
                    'name'      => $b->name,
                    'branch'    => $b->branch_name,
                    'type'      => $b->type === 'cash' ? 'Cash Box' : ($b->type === 'bank' ? 'Bank' : ucwords(str_replace('_', ' ', (string) $b->type))),
                    'balance'   => (float) $b->balance,
                    'glAccount' => $b->type === 'cash' ? '1000' : '1010',
                    'companyId' => CompanySlugs::slug($b->company_id),
                ])
            : collect();

        return response()->json(['success' => true, 'data' => ['heads' => $heads, 'accounts' => $accounts]]);
    }

    /** Record one expense — register + ledger + the paying account, one transaction. */
    public function store(StoreExpenseRequest $request): JsonResponse
    {
        if (! Schema::hasTable('acc_entries')) {
            return response()->json(['success' => false, 'message' => 'acc_entries table not migrated yet. Run: php artisan migrate'], 503);
        }

        $payload = $request->validated() + ['companyId' => self::COMPANY];

        try {
            $result = $this->expenses->record($payload, $this->requesterCompanyId($request));
        } catch (LedgerException $e) {
            return response()->json(['success' => false, 'message' => $e->getMessage()], 422);
        }

        return response()->json(['success' => true, 'data' => new ExpenseVoucherResource($result)], 201);
    }

    /** Void a voucher: register row removed, ledger reversed, account refunded. */
    public function destroy(Request $request, string $voucher): JsonResponse
    {
        try {
            $result = $this->expenses->void($voucher, (string) $request->query('reason', 'voucher deleted'));
        } catch (LedgerException $e) {
            return response()->json(['success' => false, 'message' => $e->getMessage()], 422);
        }

        return response()->json(['success' => true, 'data' => $result]);
    }

    /** DB row -> the frontend `acc_entries` record (same shape as AccEntryResource). */
    private function present(object $r): array
    {
        return [
            'id'          => $r->ext_id,
            'companyId'   => $r->company_id,
            'kind'        => $r->kind,
            'amount'      => (float) $r->amount,
            'category'    => $r->category,
            'subCategory' => $r->sub_category,
            'head'        => $r->head,
            'method'      => $r->method,
            'payAcct'     => $r->pay_acct ?? '',
            'bankId'      => $r->bank_id ?? '',
            'bankName'    => $r->bank_name ?? '',
            'date'        => $r->date,
            'party'       => $r->party,
            'ref'         => $r->ref,
            'desc'        => $r->description,
            'fundedBy'    => $r->funded_by ?: '',
            'created'     => $r->created,
        ];
    }
}
