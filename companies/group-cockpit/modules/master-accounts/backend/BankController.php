<?php

namespace Epal\Modules\GroupCockpit\MasterAccounts;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

/**
 * Bank Accounts (Manage Banks).
 * ----------------------------------------------------------------------------
 * Serves the REAL `banks` table in the shape the frontend `banks` store reads
 * (see banksView() in view.js):
 *   old.name            -> name
 *   old.branch_name     -> branch
 *   old.account_name    -> accountName
 *   old.account_type    -> accType   (savings|current|fixed -> Savings/Current/Fixed)
 *   old.type            -> type      (cash -> "Cash Box" so GL 1000 logic fires; else "Bank")
 *   old.routing_number  -> routing
 *   old.account_number  -> account
 *   old.balance         -> balance
 *   old.status(1|0)     -> status    (Active|Inactive)
 *   old.company_id      -> companyId (mapped to the frontend company slug)
 *
 * Pure read/translate — no banking logic. The GL reconciliation stays in the
 * new system's ledger.
 */
class BankController
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
        $rows = DB::table('banks')
            ->whereNull('deleted_at')
            ->orderBy('name')
            ->get();

        $banks = $rows->map(function ($b) {
            return [
                'id'          => (string) $b->id,
                'name'        => $b->name,
                'branch'      => $b->branch_name,
                'accountName' => $b->account_name,
                'accType'     => ucfirst((string) $b->account_type),
                'type'        => $b->type === 'cash' ? 'Cash Box'
                                    : ($b->type === 'bank' ? 'Bank'
                                        : ucwords(str_replace('_', ' ', (string) $b->type))),
                'routing'     => $b->routing_number,
                'account'     => $b->account_number,
                'balance'     => (float) $b->balance,
                'status'      => (int) $b->status === 1 ? 'Active' : 'Inactive',
                'companyId'   => $this->companySlug($b->company_id),
            ];
        })->values();

        return response()->json([
            'success' => true,
            'count'   => $banks->count(),
            'data'    => $banks,
        ]);
    }
}
