<?php

namespace Epal\Modules\GroupCockpit\MasterAccounts;

use App\Support\ScopesToCompany;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
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
    use ScopesToCompany;

    /** DB companies.id -> frontend company slug (matches platform/core/config.js). */
    private function companySlug($id): string
    {
        $map = [
            1 => 'it', 2 => 'travels', 3 => 'construction', 4 => 'group',
            5 => 'shop', 6 => 'woodart',
        ];
        return $map[(int) $id] ?? 'group';
    }

    public function index(Request $request): JsonResponse
    {
        $cid = $this->requesterCompanyId($request);

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
            ->when($cid, fn ($q) => $q->where('company_id', $cid))   // company user: only their own entries
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

    /** frontend company slug -> DB companies.id (reverse of companySlug). */
    private function companyDbId(?string $slug): int
    {
        $map = ['it' => 1, 'travels' => 2, 'construction' => 3, 'group' => 4, 'shop' => 5, 'woodart' => 6];
        return $map[$slug ?? 'group'] ?? 4;
    }

    /**
     * Persist a journal entry (a deposit, withdrawal, manual journal, mirror…)
     * to the REAL journal_entries + journal_items tables, so transactions are
     * durable in the DB instead of living only in the browser.
     *
     * Idempotent: the frontend's stable id is stored in `reference`, and a
     * re-post of the same id REPLACES the prior entry (soft-delete + re-insert)
     * rather than duplicating — so edits/re-mirrors don't pile up. Rejects an
     * unbalanced entry, an unknown account code, or a company mismatch.
     */
    public function store(Request $request): JsonResponse
    {
        $v = $request->all();
        $frontId = trim((string) ($v['id'] ?? ''));
        $lines   = is_array($v['lines'] ?? null) ? $v['lines'] : [];

        if (count($lines) < 2) {
            return response()->json(['success' => false, 'message' => 'A journal needs at least two lines.'], 422);
        }

        // balance check (debits must equal credits, and there must be a debit)
        $dr = 0.0; $cr = 0.0;
        foreach ($lines as $ln) { $dr += (float) ($ln['dr'] ?? 0); $cr += (float) ($ln['cr'] ?? 0); }
        if ($dr <= 0 || abs($dr - $cr) > 0.01) {
            return response()->json(['success' => false, 'message' => 'Entry does not balance (Dr ' . $dr . ' ≠ Cr ' . $cr . ').'], 422);
        }

        // company: a company-scoped user is forced to their own company
        $scope     = $this->requesterCompanyId($request);
        $companyId = $scope ?: $this->companyDbId($v['companyId'] ?? 'group');

        // translate account CODE -> account_id (reject unknown codes up front so
        // we never hit a raw FK violation mid-transaction)
        $idByCode = DB::table('accounts')->whereNull('deleted_at')->pluck('id', 'code');
        $items = [];
        foreach ($lines as $ln) {
            $code = (string) ($ln['account'] ?? '');
            if (! isset($idByCode[$code])) {
                return response()->json(['success' => false, 'message' => 'Unknown account code: ' . $code], 422);
            }
            $items[] = [
                'account_id' => (int) $idByCode[$code],
                'debit'      => (float) ($ln['dr'] ?? 0),
                'credit'     => (float) ($ln['cr'] ?? 0),
            ];
        }

        $date = substr((string) ($v['date'] ?? now()->toDateString()), 0, 10);
        $now  = now();
        $userId = optional($request->user())->id;

        $entryId = DB::transaction(function () use ($frontId, $companyId, $items, $v, $date, $now, $userId) {
            // Match an existing LIVE entry: a numeric client id is a real DB id
            // (e.g. a hydrated entry being re-posted) -> UPDATE that row in place;
            // otherwise the stable string id lives in `reference`. Either way we
            // UPDATE in place (never soft-delete + re-insert), so the entry keeps
            // its id and a re-post can't duplicate it.
            $existingId = null;
            if ($frontId !== '') {
                $q = DB::table('journal_entries')->whereNull('deleted_at');
                $existingId = (is_numeric($frontId) ? $q->where('id', (int) $frontId) : $q->where('reference', $frontId))->value('id');
            }

            $head = [
                'company_id'  => $companyId,
                'date'        => $date,
                'source'      => (string) ($v['source'] ?? 'manual'),
                'description' => (string) ($v['memo'] ?? ''),
                'updated_at'  => $now,
            ];
            if (! is_numeric($frontId) && $frontId !== '') $head['reference'] = $frontId;   // keep a stored string id

            if ($existingId) {
                DB::table('journal_entries')->where('id', $existingId)->update($head);
                DB::table('journal_items')->where('journal_entry_id', $existingId)->whereNull('deleted_at')->update(['deleted_at' => $now]);
                $id = (int) $existingId;
            } else {
                $id = DB::table('journal_entries')->insertGetId($head + [
                    'created_by' => $userId,
                    'reference'  => ($frontId !== '' && ! is_numeric($frontId)) ? $frontId : ($v['ref'] ?? null),
                    'created_at' => $now,
                ]);
            }
            foreach ($items as $it) {
                DB::table('journal_items')->insert([
                    'journal_entry_id' => $id,
                    'account_id'       => $it['account_id'],
                    'debit'            => $it['debit'],
                    'credit'           => $it['credit'],
                    'created_at'       => $now,
                    'updated_at'       => $now,
                ]);
            }
            return $id;
        });

        return response()->json(['success' => true, 'data' => [
            'id'        => (string) $entryId,
            'date'      => $date,
            'companyId' => $this->companySlug($companyId),
            'ref'       => (string) ($v['ref'] ?? ($frontId !== '' ? $frontId : (string) $entryId)),
            'memo'      => (string) ($v['memo'] ?? ''),
            'source'    => (string) ($v['source'] ?? 'manual'),
            'party'     => (string) ($v['party'] ?? ''),
            'lines'     => array_map(fn ($ln) => [
                'account' => (string) ($ln['account'] ?? ''),
                'dr'      => (float) ($ln['dr'] ?? 0),
                'cr'      => (float) ($ln['cr'] ?? 0),
            ], $lines),
        ]]);
    }

    /** Soft-delete a journal entry + its items (rarely used; reversals post a new REV- entry). */
    public function destroy(string $id): JsonResponse
    {
        $now = now();
        // id may be the DB bigint OR a frontend client id stored in `reference`
        $ids = DB::table('journal_entries')->whereNull('deleted_at')
            ->where(fn ($q) => $q->where('id', is_numeric($id) ? (int) $id : -1)->orWhere('reference', $id))
            ->pluck('id');
        if ($ids->isNotEmpty()) {
            DB::table('journal_items')->whereIn('journal_entry_id', $ids)->whereNull('deleted_at')->update(['deleted_at' => $now]);
            DB::table('journal_entries')->whereIn('id', $ids)->update(['deleted_at' => $now]);
        }
        return response()->json(['success' => true]);
    }
}
