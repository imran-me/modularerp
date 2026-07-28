<?php

namespace Epal\Modules\Woodart\Accounts;

use App\Exceptions\LedgerException;
use Epal\Modules\Woodart\Accounts\Http\Requests\PayVendorRequest;
use Epal\Modules\Woodart\Accounts\Http\Requests\StoreEntryRequest;
use Epal\Modules\Woodart\Accounts\Http\Resources\EntryResource;
use Epal\Modules\Woodart\Accounts\Services\AccountsService;
use Epal\Modules\Woodart\Accounts\Services\EntryPostingService;
use Illuminate\Http\JsonResponse;

/**
 * Woodart Accounts — the interiors money desk.
 *
 * THIN BY DESIGN: validate -> delegate -> shape. Reads go to AccountsService,
 * writes to EntryPostingService, which routes them through the KERNEL posting
 * services so the group's books cannot differ by which company recorded the
 * money.
 *
 * This module owns NO table, so there is no Schema::hasTable guard on a table
 * of its own — `AccountsService::provisioned()` reports whether the shared
 * `acc_entries` exists on this host, and every read degrades to an empty,
 * honest response rather than throwing.
 *
 * LedgerException is the kernel's way of refusing a posting it cannot make
 * safely — an unknown account code, a payment larger than the debt, an account
 * belonging to another concern. It is a 422 and never a 500: the caller did
 * something the books do not allow, and the message says which.
 *
 * @see backend/endpoints.md   the frozen contract this implements
 */
class AccountsController
{
    public function __construct(
        private AccountsService $accounts,
        private EntryPostingService $posting,
    ) {}

    /** GET /api/woodart/accounts/register — income & expense, newest first. */
    public function register(): JsonResponse
    {
        $provisioned = $this->accounts->provisioned();
        $book = $this->accounts->register();

        return response()->json([
            'success'     => true,
            'provisioned' => $provisioned,
            'count'       => count($book['data']),
            'summary'     => $book['summary'],
            'data'        => EntryResource::collection(collect($book['data'])),
        ]);
    }

    /** POST /api/woodart/accounts/register — record income or an expense. */
    public function store(StoreEntryRequest $request): JsonResponse
    {
        if (! $this->accounts->provisioned()) {
            return $this->unprovisioned();
        }

        try {
            $out = $this->posting->record($request->validated());
        } catch (LedgerException $e) {
            return response()->json(['success' => false, 'message' => $e->getMessage()], 422);
        }

        return response()->json([
            'success' => true,
            'data'    => $out['entry'],
            'journal' => $out['journal'],
        ], 201);
    }

    /** DELETE /api/woodart/accounts/register/{id} — void by REVERSAL, never delete. */
    public function destroy(string $id): JsonResponse
    {
        if (! $this->accounts->provisioned()) {
            return $this->unprovisioned();
        }

        try {
            $out = $this->posting->void($id);
        } catch (LedgerException $e) {
            return response()->json(['success' => false, 'message' => $e->getMessage()], 422);
        }

        return response()->json($out, $out['success'] ? 200 : 404);
    }

    /** GET /api/woodart/accounts/payables — what Woodart owes vendors, per PO. */
    public function payables(): JsonResponse
    {
        $book = $this->accounts->payables();

        return response()->json([
            'success'     => true,
            'provisioned' => $this->accounts->provisioned(),
            'summary'     => $book['summary'],
            'data'        => $book['data'],
        ]);
    }

    /** POST /api/woodart/accounts/payables/{po}/pay — settle a purchase order. */
    public function pay(PayVendorRequest $request, string $po): JsonResponse
    {
        if (! $this->accounts->provisioned()) {
            return $this->unprovisioned();
        }

        try {
            $out = $this->posting->payVendor($po, $request->validated());
        } catch (LedgerException $e) {
            return response()->json(['success' => false, 'message' => $e->getMessage()], 422);
        }

        return response()->json($out, $out['success'] ? 200 : 422);
    }

    /**
     * GET /api/woodart/accounts/project-pnl — value vs cost vs the BOQ budget.
     *
     * The endpoint no other company can offer, because no other company has a
     * bill of quantities. `variance` negative means the job is eating more
     * material than it was quoted for.
     */
    public function projectPnl(): JsonResponse
    {
        $rows = $this->accounts->projectPnl();

        return response()->json([
            'success'     => true,
            'provisioned' => $this->accounts->provisioned(),
            'count'       => count($rows),
            'data'        => $rows,
        ]);
    }

    /** The shared register is not on this host — say so, do not pretend. */
    private function unprovisioned(): JsonResponse
    {
        return response()->json([
            'success' => false,
            'message' => 'acc_entries table not migrated yet. Run: php artisan migrate',
        ], 503);
    }
}
