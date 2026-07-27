<?php

namespace App\Services;

use App\Exceptions\LedgerException;
use App\Support\CompanySlugs;
use Illuminate\Support\Facades\DB;

/**
 * THE LEDGER — the one place a journal entry is written.
 * ----------------------------------------------------------------------------
 * Double-entry posting into the real `journal_entries` + `journal_items` tables,
 * in the shape the SPA's `gl_entries` store reads (see platform/engines-library/
 * ledger.js and docs/BACKEND-ARCHITECTURE.md):
 *
 *   { id, date, companyId:<slug>, ref, memo, source, party,
 *     lines:[ { account:'<code>', dr:number, cr:number }, … ] }
 *
 * WHY A SERVICE and not more controller code: three different desks post to the
 * ledger (Master Accounts' journal mirror, a company's expense capture, cash
 * movements) and every one of them must apply the SAME rules — balanced or
 * refused, account CODES resolved to ids up front, one entry per stable client
 * id (idempotent, so a re-post updates instead of double-counting). Put that in
 * one class and a caller cannot get it subtly wrong.
 *
 * RULES (do not relax any of these — they are why the books balance):
 *   1. At least two lines, total debits == total credits (±0.01), debits > 0.
 *   2. Every line's account code must already exist in `accounts` — an unknown
 *      code is refused up front, never inserted mid-transaction as an FK error.
 *   3. IDEMPOTENT: a stable client id ('GL-ACC-JV-1234') is stored in
 *      `reference`; re-posting the same id UPDATES that entry in place (items
 *      soft-deleted and re-inserted). Ids never change, so nothing duplicates.
 *   4. A company-scoped caller is forced to its own company (pass $scopeCompanyId
 *      from App\Support\ScopesToCompany).
 *
 * REVERSALS (never deletions): void()/reverse() posts an equal-and-opposite
 * entry. The original and the reversal both stay on the books forever — that is
 * the audit trail the accountants sign.
 */
class LedgerService
{
    /** Post (or re-post) one balanced journal entry. Returns the frontend shape. */
    public function post(array $entry, ?int $scopeCompanyId = null): array
    {
        $frontId = trim((string) ($entry['id'] ?? ''));
        $lines   = is_array($entry['lines'] ?? null) ? $entry['lines'] : [];

        if (count($lines) < 2) {
            throw new LedgerException('A journal needs at least two lines.');
        }

        // THE balance check: debits must equal credits. Nothing else.
        //
        // It used to also demand `$dr > 0`, which quietly rejected the one case that
        // matters most: a VOID or REFUND. Those post the original entry with both
        // sides NEGATED (Dr −50,000 / Cr −50,000) — perfectly balanced, and exactly
        // how the SPA's ledger.post() has always accepted them (it checks
        // |dr − cr| only). So every void the client mirrored came back 422 and never
        // persisted: the browser showed the sale reversed while the database still
        // carried the revenue and the payable. Reject an imbalance, and reject an
        // entry worth nothing at all — but never a legitimate reversal.
        $dr = 0.0;
        $cr = 0.0;
        foreach ($lines as $ln) {
            $dr += (float) ($ln['dr'] ?? 0);
            $cr += (float) ($ln['cr'] ?? 0);
        }
        if (abs($dr - $cr) > 0.01) {
            throw new LedgerException('Entry does not balance (Dr ' . $dr . ' ≠ Cr ' . $cr . ').');
        }
        if (abs($dr) < 0.01 && abs($cr) < 0.01) {
            throw new LedgerException('Entry has no value to post (every line is zero).');
        }

        // company: a company-scoped user is forced to their own company
        $companyId = $scopeCompanyId ?: CompanySlugs::dbId($entry['companyId'] ?? 'group');

        $items = $this->resolveItems($lines);
        $date  = substr((string) ($entry['date'] ?? now()->toDateString()), 0, 10);
        $now   = now();
        $userId = $entry['userId'] ?? null;

        $entryId = DB::transaction(function () use ($frontId, $companyId, $items, $entry, $date, $now, $userId) {
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
                'source'      => (string) ($entry['source'] ?? 'manual'),
                'description' => (string) ($entry['memo'] ?? ''),
                'updated_at'  => $now,
            ];
            // WHO it was with — a customer, a vendor, or a sister concern. The party
            // ledger, AR/AP ageing and the inter-company positions are all derived
            // from it (migration 2026_07_27_004000). Only written when the column is
            // there, so an un-migrated host still posts.
            if ($this->hasPartyColumn()) {
                $head['party'] = ((string) ($entry['party'] ?? '')) ?: null;
            }
            if (! is_numeric($frontId) && $frontId !== '') {
                $head['reference'] = $frontId;   // keep a stored string id
            }

            if ($existingId) {
                DB::table('journal_entries')->where('id', $existingId)->update($head);
                DB::table('journal_items')->where('journal_entry_id', $existingId)->whereNull('deleted_at')->update(['deleted_at' => $now]);
                $id = (int) $existingId;
            } else {
                $id = DB::table('journal_entries')->insertGetId($head + [
                    'created_by' => $userId,
                    'reference'  => ($frontId !== '' && ! is_numeric($frontId)) ? $frontId : ($entry['ref'] ?? null),
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

        return [
            'id'        => (string) $entryId,
            'date'      => $date,
            'companyId' => CompanySlugs::slug($companyId),
            'ref'       => (string) ($entry['ref'] ?? ($frontId !== '' ? $frontId : (string) $entryId)),
            'memo'      => (string) ($entry['memo'] ?? ''),
            'source'    => (string) ($entry['source'] ?? 'manual'),
            'party'     => (string) ($entry['party'] ?? ''),
            'lines'     => array_map(fn ($ln) => [
                'account' => (string) ($ln['account'] ?? ''),
                'dr'      => (float) ($ln['dr'] ?? 0),
                'cr'      => (float) ($ln['cr'] ?? 0),
            ], $lines),
        ];
    }

    /**
     * Post the equal-and-opposite entry for a posting identified by its stable
     * client reference ('GL-ACC-JV-1234'). Returns the reversal, or null when
     * there was nothing on the books to reverse (already gone / never posted).
     * The original is left untouched: the pair nets to zero and BOTH stay.
     */
    public function reverse(string $reference, string $reason = ''): ?array
    {
        $original = DB::table('journal_entries')->whereNull('deleted_at')
            ->where(fn ($q) => $q->where('reference', $reference)->orWhere('id', is_numeric($reference) ? (int) $reference : -1))
            ->first();
        if (! $original) {
            return null;
        }

        $codeById = DB::table('accounts')->whereNull('deleted_at')->pluck('code', 'id');
        $lines = DB::table('journal_items')->whereNull('deleted_at')
            ->where('journal_entry_id', $original->id)->orderBy('id')->get()
            ->map(fn ($it) => [
                'account' => (string) ($codeById[$it->account_id] ?? $it->account_id),
                'dr'      => (float) $it->credit,      // swapped — that IS the reversal
                'cr'      => (float) $it->debit,
            ])->all();
        if (count($lines) < 2) {
            return null;
        }

        return $this->post([
            'id'        => 'GL-REV-' . $reference,
            'date'      => now()->toDateString(),
            'companyId' => CompanySlugs::slug($original->company_id),
            'ref'       => 'REV-' . ($original->reference ?: $original->id),
            'memo'      => 'Reversal of: ' . ($original->description ?: $reference) . ($reason ? ' — ' . $reason : ''),
            'source'    => $original->source ?: 'manual',
            'lines'     => $lines,
        ], (int) $original->company_id);
    }

    /**
     * The expense head a free-text category posts to — the PHP port of
     * ledger.js expenseAccountFor(). Kept identical on purpose: the SPA and the
     * API must classify the same wording into the same head, or the P&L reads
     * differently depending on which side recorded the spend.
     * A caller that already knows the code (the categorised expense form pins
     * it) should pass it and never come through here.
     */
    public function expenseAccountFor(?string $text): string
    {
        $c = mb_strtolower((string) $text);
        $is = fn (string $re) => (bool) preg_match('/' . $re . '/u', $c);

        if ($is('rent|lease')) return '5200';
        if ($is('salary|payroll|wage|staff')) return '5100';
        if ($is('utility|electric|internet|wifi|gas|water|phone|bill')) return '5300';
        // WORD-BOUNDED on purpose (fixed 2026-07-27) — see the same two lines in
        // ledger.js: unbounded `fee` matched "cof-FEE" so "Tea / Coffee (Guest)"
        // classified as BANK CHARGES, and `ad\b` never matched the plural "Ads".
        // These two patterns must stay byte-identical to the SPA's.
        if ($is('market|\bads?\b|promo|campaign|boost|sms|design')) return '5400';
        if ($is('bank|charge|\bfees?\b|license|iata|software')) return '6000';
        if ($is('adm|penalt|fine')) return '5900';
        if ($is('food|lunch|tea|snack|entertain|canteen')) return '5550';
        if ($is('office|stationer|clean|repair|furniture')) return '5500';
        if ($is('conveyance|travel|transport|fuel')) return '5600';

        return '5800';
    }

    /** Does journal_entries carry `party` on THIS host? (migration 2026_07_27_004000)
     *  Cached on the instance so a mid-process migration is still seen. */
    private ?bool $partyColumn = null;

    public function hasPartyColumn(): bool
    {
        if ($this->partyColumn === null) {
            try { $this->partyColumn = \Illuminate\Support\Facades\Schema::hasColumn('journal_entries', 'party'); }
            catch (\Throwable $e) { $this->partyColumn = false; }
        }

        return $this->partyColumn;
    }

    /** True when this account code exists on the chart. */
    public function hasAccount(string $code): bool
    {
        return DB::table('accounts')->whereNull('deleted_at')->where('code', $code)->exists();
    }

    /**
     * Line array -> journal_items rows, refusing unknown account codes up front.
     *
     * A code that is missing but belongs to the STANDARD chart is topped up rather
     * than refused (ChartOfAccounts::ensure) — the SPA has always done this for its
     * own chart via ensureExtraAccounts(), and the mismatch is what made live
     * expenses fail with "Unknown account code: 5600" while the browser was happily
     * posting to it. Anything NOT on the standard chart still throws: a typo must
     * not quietly create an account.
     */
    private function resolveItems(array $lines): array
    {
        $idByCode = DB::table('accounts')->whereNull('deleted_at')->pluck('id', 'code');
        $topUp = null;
        foreach ($lines as $ln) {
            $code = (string) ($ln['account'] ?? '');
            if ($code !== '' && ! isset($idByCode[$code])) {
                $topUp = $topUp ?: app(ChartOfAccounts::class);
                if ($topUp->ensure($code)) {
                    $idByCode = DB::table('accounts')->whereNull('deleted_at')->pluck('id', 'code');
                }
            }
        }

        $items = [];
        foreach ($lines as $ln) {
            $code = (string) ($ln['account'] ?? '');
            if (! isset($idByCode[$code])) {
                throw new LedgerException('Unknown account code: ' . $code
                    . ' — add it in Master Accounts › Chart of Accounts.');
            }
            $items[] = [
                'account_id' => (int) $idByCode[$code],
                'debit'      => (float) ($ln['dr'] ?? 0),
                'credit'     => (float) ($ln['cr'] ?? 0),
            ];
        }

        return $items;
    }
}
