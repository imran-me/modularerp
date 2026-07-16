<?php

namespace Epal\Modules\GroupCockpit\MasterAccounts;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

/**
 * General Ledger — Journal Entries (Manage Journals).
 * ----------------------------------------------------------------------------
 * Serves the REAL `journal_entries` (74) + `journal_items` (156) tables in the
 * shape the frontend `gl_entries` store reads (see ledger.js header + the
 * journalsView()/journalDetail() code in view.js):
 *   gl_entries — { id, date, companyId, ref, memo, source, party,
 *                  lines:[{account:CODE, dr:number, cr:number}] }
 *
 * Each entry carries its items NESTED as `lines`. Journal items reference an
 * account_id (bigint); the frontend ledger keys everything by the account CODE
 * (e.g. '1010'), so we translate account_id -> accounts.code here.
 *   je.reference       -> ref
 *   je.description     -> memo
 *   je.source          -> source
 *   ji.debit / credit  -> dr / cr
 *
 * Pure read/translate — the posting logic stays in the new system's ledger.
 */
class JournalController
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
        // account_id -> account code, so lines carry the code the ledger keys on
        $codeById = DB::table('accounts')
            ->whereNull('deleted_at')
            ->pluck('code', 'id');

        // all items, grouped by their parent entry
        $itemsByEntry = DB::table('journal_items')
            ->whereNull('deleted_at')
            ->orderBy('id')
            ->get()
            ->groupBy('journal_entry_id');

        $entries = DB::table('journal_entries')
            ->whereNull('deleted_at')
            ->orderBy('date')
            ->orderBy('id')
            ->get();

        $data = $entries->map(function ($e) use ($itemsByEntry, $codeById) {
            $lines = collect($itemsByEntry->get($e->id, []))->map(function ($it) use ($codeById) {
                return [
                    'account' => (string) ($codeById[$it->account_id] ?? $it->account_id),
                    'dr'      => (float) $it->debit,
                    'cr'      => (float) $it->credit,
                ];
            })->values();

            return [
                'id'        => (string) $e->id,
                'date'      => $e->date,
                'companyId' => $this->companySlug($e->company_id),
                'ref'       => $e->reference ?: (string) $e->id,
                'memo'      => $e->description ?: '',
                'source'    => $e->source ?: 'manual',
                'party'     => '',
                'lines'     => $lines,
            ];
        })->values();

        return response()->json([
            'success' => true,
            'count'   => $data->count(),
            'data'    => $data,
        ]);
    }
}
