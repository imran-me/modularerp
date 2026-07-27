<?php

namespace Epal\Modules\GroupCockpit\MasterAccounts;

use App\Exceptions\LedgerException;
use App\Services\InterCompanyService;
use App\Support\CompanySlugs;
use App\Support\ScopesToCompany;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * MONEY BETWEEN THE SISTER CONCERNS — the Group's own desk.
 * ----------------------------------------------------------------------------
 * Lives in Master Accounts because these are GROUP decisions: who invoices whom,
 * who pays the shared rent, who settles what. The posting rules are in the kernel
 * (App\Services\InterCompanyService) so a concern's own screen can use the same
 * ones — this is just the HTTP surface.
 *
 *   GET  /api/group/master-accounts/intercompany/positions?companyId=travels
 *        who owes whom right now, read off the journals
 *   POST /api/group/master-accounts/intercompany/invoice
 *        { from, to, amount, memo?, revenueAccount?, expenseAccount?, ref?, date? }
 *   POST /api/group/master-accounts/intercompany/settle
 *        { companyId, party, amount, direction:pay|receive, bankId?, partyBankId?, date? }
 *   POST /api/group/master-accounts/intercompany/shared-cost
 *        { amount, paidBy, among:[…], head|category, bankId?, date?, desc? }
 *
 * Every one of these writes BOTH concerns' books in ONE transaction. A half-posted
 * favour between sister companies is a permanently unbalanced group consolidation,
 * which is exactly what the 1300/2400 control accounts exist to prevent.
 *
 * Refusals come back as 422 with a readable message: settling more than is owed,
 * a concern transacting with itself, a shared cost with one participant, a payment
 * account belonging to someone else.
 */
class InterCompanyController
{
    use ScopesToCompany;

    public function __construct(private InterCompanyService $ic) {}

    /** Who owes whom. A company-scoped user always sees their own position. */
    public function positions(Request $request): JsonResponse
    {
        $scope = $this->requesterCompanyId($request);
        $companyId = $scope !== null
            ? CompanySlugs::slug($scope)
            : (string) $request->query('companyId', 'group');

        if (CompanySlugs::dbIdOrNull($companyId) === null) {
            return response()->json(['success' => false, 'message' => 'Unknown concern: ' . $companyId], 422);
        }

        $pos = $this->ic->positions($companyId);

        return response()->json(['success' => true, 'companyId' => $companyId, 'data' => $pos,
            'totals' => ['owes' => round(array_sum($pos['owes']), 2),
                         'dueTo' => round(array_sum($pos['dueTo']), 2)]]);
    }

    /** A sells to B — internal revenue and cost, eliminated on consolidation. */
    public function invoice(Request $request): JsonResponse
    {
        $v = $request->validate([
            'from' => 'required|string|max:50',
            'to' => 'required|string|max:50',
            'amount' => 'required|numeric|min:0.01',
            'memo' => 'nullable|string|max:255',
            'ref' => 'nullable|string|max:64',
            'date' => 'nullable|date',
            'revenueAccount' => 'nullable|string|max:20',
            'expenseAccount' => 'nullable|string|max:20',
        ]);

        try {
            $out = $this->ic->invoice($v['from'], $v['to'], (float) $v['amount'], $v);
        } catch (LedgerException $e) {
            return response()->json(['success' => false, 'message' => $e->getMessage()], 422);
        }

        return response()->json(['success' => true, 'data' => $out], 201);
    }

    /** Repay (or collect) an inter-company balance — mirrored on both books. */
    public function settle(Request $request): JsonResponse
    {
        $v = $request->validate([
            'companyId' => 'required|string|max:50',
            'party' => 'required|string|max:50',
            'amount' => 'required|numeric|min:0.01',
            'direction' => 'required|string|in:pay,receive',
            'bankId' => 'nullable|string|max:40',        // our account
            'partyBankId' => 'nullable|string|max:40',   // theirs
            'date' => 'nullable|date',
            'ref' => 'nullable|string|max:64',
        ]);

        $scope = $this->requesterCompanyId($request);
        $companyId = $scope !== null ? CompanySlugs::slug($scope) : $v['companyId'];

        try {
            $out = $this->ic->settle($companyId, $v['party'], (float) $v['amount'], $v['direction'], $v);
        } catch (LedgerException $e) {
            return response()->json(['success' => false, 'message' => $e->getMessage()], 422);
        }

        return response()->json(['success' => true, 'data' => $out], 201);
    }

    /** One bill, several concerns — split equally, the payer pays it all. */
    public function sharedCost(Request $request): JsonResponse
    {
        $v = $request->validate([
            'amount' => 'required|numeric|min:0.01',
            'paidBy' => 'required|string|max:50',
            'among' => 'required|array|min:2',
            'among.*' => 'required|string|max:50',
            'head' => 'nullable|string|max:20',
            'category' => 'nullable|string|max:120',
            'bankId' => 'nullable|string|max:40',
            'date' => 'nullable|date',
            'desc' => 'nullable|string',
        ]);

        try {
            $out = $this->ic->shareCost($v);
        } catch (LedgerException $e) {
            return response()->json(['success' => false, 'message' => $e->getMessage()], 422);
        }

        return response()->json(['success' => true, 'data' => $out], 201);
    }
}
