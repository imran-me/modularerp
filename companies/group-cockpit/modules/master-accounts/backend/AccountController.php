<?php

namespace Epal\Modules\GroupCockpit\MasterAccounts;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

/**
 * Chart of Accounts.
 * ----------------------------------------------------------------------------
 * Serves the REAL `accounts` table (326 rows in the imported production data)
 * in the shape the frontend ledger expects — {code, name, type, group, normal}.
 *
 * The old schema and the frontend shape differ, so this controller is the
 * translation seam (owner rule: import the DATA, keep the NEW system's shapes):
 *   old.code           -> code
 *   old.name           -> name
 *   old.type           -> type   (asset|liability|equity|income|expense — same set)
 *   old.parent_id      -> group  (the parent account's name, e.g. "Current Assets")
 *   derived            -> normal (asset/expense = debit side; else credit side)
 *   old.opening_balance-> opening
 *   old.status         -> active
 *
 * No accounting logic lives here — it is a pure read/translate. The correct
 * posting logic stays in the new system's ledger (see epal-bookkeeping-audit).
 */
class AccountController
{
    public function index(): JsonResponse
    {
        $rows = DB::table('accounts')
            ->whereNull('deleted_at')
            ->orderBy('code')
            ->get(['id', 'code', 'name', 'type', 'parent_id', 'opening_balance', 'status']);

        // id -> name, so a child can resolve its parent's name for the "group" label
        $nameById = $rows->pluck('name', 'id');

        $coa = $rows->map(function ($a) use ($nameById) {
            return [
                'code'    => (string) $a->code,
                'name'    => $a->name,
                'type'    => $a->type,
                'group'   => ($a->parent_id && isset($nameById[$a->parent_id]))
                                ? $nameById[$a->parent_id]
                                : ucfirst((string) $a->type),
                'normal'  => in_array($a->type, ['asset', 'expense'], true) ? 'debit' : 'credit',
                'opening' => (float) $a->opening_balance,
                'active'  => (int) $a->status === 1,
            ];
        })->values();

        return response()->json([
            'success' => true,
            'count'   => $coa->count(),
            'data'    => $coa,
        ]);
    }
}
