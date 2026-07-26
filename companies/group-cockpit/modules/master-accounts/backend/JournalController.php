<?php

namespace Epal\Modules\GroupCockpit\MasterAccounts;

use App\Exceptions\LedgerException;
use App\Services\LedgerService;
use App\Support\CompanySlugs;
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
 * index() is pure read/translate. store() hands the POSTING RULES to the kernel's
 * App\Services\LedgerService — balance check, code->id resolution and the
 * idempotent upsert live there, so this endpoint and every server-side poster
 * (e.g. a concern's expense capture) write the ledger through one implementation.
 */
class JournalController
{
    use ScopesToCompany;

    public function __construct(private LedgerService $ledger) {}

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
                'companyId' => CompanySlugs::slug($e->company_id),
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

    /**
     * Persist a journal entry (a deposit, withdrawal, manual journal, mirror…)
     * to the REAL journal_entries + journal_items tables, so transactions are
     * durable in the DB instead of living only in the browser.
     *
     * The rules — balanced or refused, unknown account codes refused up front,
     * idempotent by the frontend's stable id (a re-post UPDATES in place and can
     * never duplicate), a company-scoped user forced to their own company — all
     * live in App\Services\LedgerService. This method is the HTTP skin over it:
     * it just turns a refusal into the API's `{ success:false, message }` 422.
     */
    public function store(Request $request): JsonResponse
    {
        $payload = $request->all();
        $payload['userId'] = optional($request->user())->id;

        try {
            $data = $this->ledger->post($payload, $this->requesterCompanyId($request));
        } catch (LedgerException $e) {
            return response()->json(['success' => false, 'message' => $e->getMessage()], 422);
        }

        return response()->json(['success' => true, 'data' => $data]);
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
