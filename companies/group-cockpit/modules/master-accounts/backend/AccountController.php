<?php

namespace Epal\Modules\GroupCockpit\MasterAccounts;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
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

    /**
     * Create OR update ONE chart-of-accounts head (the "Add Ledger Account"
     * form). This adds an account DEFINITION only — it posts nothing to the
     * ledger, so it is safe while the corrected posting logic is still pending.
     * The frontend keys accounts by `code`, so the response echoes `code` as the
     * record id (index() shape + id) to keep the client store in sync.
     *   POST group/master-accounts/accounts   { code, name, type, group?, opening?, active? }
     */
    public function store(Request $request): JsonResponse
    {
        $v = $request->validate([
            'code'    => 'required|string|max:50',
            'name'    => 'required|string|max:255',
            'type'    => 'required|string|in:asset,liability,equity,income,expense',
            'group'   => 'nullable|string|max:255',
            'opening' => 'nullable|numeric',
            'active'  => 'nullable|boolean',
        ]);

        // Resolve the free-text "group / class" label to a parent account id by
        // name (null when it names no existing account — a flat head is fine).
        $parentId = null;
        if (! empty($v['group'])) {
            $parent = DB::table('accounts')->where('name', $v['group'])->whereNull('deleted_at')->first('id');
            $parentId = $parent?->id;
        }

        $existing = DB::table('accounts')->where('code', $v['code'])->whereNull('deleted_at')->first('id');

        $row = [
            'name'       => $v['name'],
            'type'       => $v['type'],
            'parent_id'  => $parentId,
            'status'     => array_key_exists('active', $v) ? (int) ($v['active'] ?? 1) : 1,
            'updated_at' => now(),
        ];
        if (array_key_exists('opening', $v)) {
            $row['opening_balance'] = $v['opening'] ?? 0;
        }

        if ($existing) {
            DB::table('accounts')->where('id', $existing->id)->update($row);
            $id = $existing->id;
        } else {
            $row['code']            = $v['code'];
            $row['opening_balance'] = $row['opening_balance'] ?? 0;
            $row['created_at']      = now();
            $id = DB::table('accounts')->insertGetId($row);
        }

        $saved = DB::table('accounts')->where('id', $id)
            ->first(['id', 'code', 'name', 'type', 'parent_id', 'opening_balance', 'status']);

        return response()->json(['success' => true, 'data' => $this->present($saved)]);
    }

    /** One account in the frontend `coa` shape (id === code, since the client
     *  keys accounts by code, not the DB row id). Mirrors index()'s mapping. */
    private function present(object $a): array
    {
        $parentName = null;
        if ($a->parent_id) {
            $p = DB::table('accounts')->where('id', $a->parent_id)->first('name');
            $parentName = $p?->name;
        }

        return [
            'id'      => (string) $a->code,
            'code'    => (string) $a->code,
            'name'    => $a->name,
            'type'    => $a->type,
            'group'   => $parentName ?: ucfirst((string) $a->type),
            'normal'  => in_array($a->type, ['asset', 'expense'], true) ? 'debit' : 'credit',
            'opening' => (float) $a->opening_balance,
            'active'  => (int) $a->status === 1,
        ];
    }
}
