<?php

namespace App\Services;

use App\Exceptions\LedgerException;
use App\Support\CompanySlugs;
use Illuminate\Support\Facades\DB;

/**
 * THE CUSTOMER PAID — a receipt, not a flag.
 * ----------------------------------------------------------------------------
 * Server-side twin of `db.settleSale()`. Marking an invoice "Paid" is not a status
 * change, it is money arriving: it has to LAND in a named account, clear the same
 * receivable the sale raised, and show up in that account's own history. Otherwise
 * the ledger says the customer paid while Manage Banks shows the old balance and
 * the receivable never clears — the two complaints this service exists to prevent.
 *
 *   DR 1010 Bank | 1000 Cash   (the account the money actually went into)
 *   CR 1200 Accounts Receivable | 1150 Sub-Agent Receivable
 *
 * IT SETTLES THE SAME CONTROL ACCOUNT THE SALE DEBITED. Not "1200 by default" —
 * it reads the sale's own journal and credits back exactly what was debited, so a
 * sub-agent's receivable can never be cleared out of the customer AR book.
 *
 * REFUSALS, all deliberate:
 *   · a sale that was already CASH at the till has nothing to settle (it never
 *     raised a receivable) — settling it again would invent revenue-less cash;
 *   · more than the sale's outstanding amount — a receipt cannot exceed the debt;
 *   · an account belonging to another concern.
 *
 * Partial receipts are fine: pay 40 of 100, then 60. Each is its own journal
 * (GL-SET-<ref>-1, -2 …) so a payment history exists rather than one mutable row.
 */
class ReceiptPostingService
{
    public const AR_ACCOUNTS = ['1200', '1150'];
    public const CASH_ACCOUNTS = ['1000', '1010'];

    public function __construct(
        private LedgerService $ledger,
        private BankRegisterService $register,
    ) {}

    /**
     * Record a customer payment against a posted sale.
     *
     * @param  array  $in  ref (the sale's id) · amount · companyId · bankId? · party? · date?
     * @return array  keys: journal, register, arAccount, settled, outstanding
     */
    public function record(array $in, ?int $scopeCompanyId = null): array
    {
        $ref = trim((string) ($in['ref'] ?? ''));
        if ($ref === '') {
            throw new LedgerException('Which sale is this payment for? (ref)');
        }
        $amount = round((float) ($in['amount'] ?? 0), 2);
        if ($amount <= 0) {
            throw new LedgerException('A receipt needs a positive amount.');
        }

        $companySlug = $scopeCompanyId !== null ? CompanySlugs::slug($scopeCompanyId) : (string) ($in['companyId'] ?? 'group');
        $sale = $this->saleFor($ref);
        if (! $sale) {
            throw new LedgerException('Sale ' . $ref . ' is not on the books — nothing to settle.');
        }
        if ($sale['cash']) {
            throw new LedgerException('Sale ' . $ref . ' was paid at the till — there is no receivable to settle.');
        }

        $already = $this->settledSoFar($ref);
        $outstanding = round($sale['amount'] - $already, 2);
        if ($amount > $outstanding + 0.01) {
            throw new LedgerException('That is more than the outstanding ' . number_format($outstanding, 2)
                . ' on sale ' . $ref . '.');
        }

        $bank = ! empty($in['bankId']) ? $this->register->requireAccount((string) $in['bankId'], $companySlug) : null;
        $into = $bank ? $this->register->glAccountFor($bank) : '1010';
        $date = substr((string) ($in['date'] ?? now()->toDateString()), 0, 10);
        // each receipt is its own journal, so partial payments read as a history
        $seq = $this->receiptCount($ref) + 1;
        $id = 'GL-SET-' . $ref . ($seq > 1 ? '-' . $seq : '');

        return DB::transaction(function () use ($id, $ref, $companySlug, $amount, $into, $date, $bank, $sale, $outstanding, $in) {
            $journal = $this->ledger->post([
                'id' => $id, 'date' => $date, 'companyId' => $companySlug, 'ref' => $ref,
                'memo' => 'Customer payment received · ' . $ref . ($bank ? ' · ' . $bank->name : ''),
                'source' => 'payment', 'party' => (string) ($in['party'] ?? ''),
                'lines' => [
                    ['account' => $into, 'dr' => $amount, 'cr' => 0],
                    ['account' => $sale['ar'], 'dr' => 0, 'cr' => $amount],
                ],
            ], CompanySlugs::dbId($companySlug));

            $move = null;
            if ($bank) {
                $move = $this->register->apply($bank, 'deposit', $amount, $date,
                    'Customer payment · ' . $ref, $ref, $id, ['entryRef' => 'RCPT-' . $ref]);
            }

            return [
                'journal' => $journal, 'register' => $move, 'arAccount' => $sale['ar'],
                'settled' => $amount, 'outstanding' => round($outstanding - $amount, 2),
                'into' => $into, 'account' => $bank ? $bank->name : null,
            ];
        });
    }

    /**
     * Un-pay: reverse every receipt posted against this sale, and give the account
     * its money back with a row saying why. The receivable comes back — which is
     * the point: an invoice wrongly marked paid must return to the ageing book.
     */
    public function reverse(string $ref, string $reason = 'receipt reversed'): array
    {
        return DB::transaction(function () use ($ref, $reason) {
            // every receipt posted against this sale — GL-SET-<ref>, -2, -3 …
            $rows = $this->receiptIds($ref)->pluck('reference')->filter()->unique()->values();

            $done = [];
            foreach ($rows as $reference) {
                $rev = $this->ledger->reverse((string) $reference, $reason);
                if ($rev) {
                    $done[] = $rev;
                }
            }
            if (! $done) {
                throw new LedgerException('No receipt found for sale ' . $ref . '.');
            }

            return ['reversed' => $ref, 'reversals' => $done,
                'register' => $this->register->reverseFor('RCPT-' . $ref, $reason)];
        });
    }

    /** What the customer still owes on a sale. */
    public function outstanding(string $ref): float
    {
        $sale = $this->saleFor($ref);
        if (! $sale || $sale['cash']) {
            return 0.0;
        }

        return round($sale['amount'] - $this->settledSoFar($ref), 2);
    }

    /* ------------------------------------------------------------------ inside */

    /** The sale's own journal: which receivable it raised, and for how much.
     *  Returns ['ar' => code, 'amount' => float, 'cash' => bool] or null. */
    private function saleFor(string $ref): ?array
    {
        // the sale's revenue journal carries the stable id GL-S<ref> (SalePostingService)
        $entry = DB::table('journal_entries')->whereNull('deleted_at')
            ->where('reference', 'GL-S' . $ref)->first();
        if (! $entry) {
            return null;
        }

        $items = DB::table('journal_items')
            ->join('accounts', 'accounts.id', '=', 'journal_items.account_id')
            ->where('journal_items.journal_entry_id', $entry->id)
            ->whereNull('journal_items.deleted_at')
            ->get(['accounts.code as code', 'journal_items.debit as debit']);

        foreach ($items as $it) {
            if ((float) $it->debit <= 0) {
                continue;
            }
            if (in_array($it->code, self::CASH_ACCOUNTS, true)) {
                return ['ar' => $it->code, 'amount' => (float) $it->debit, 'cash' => true];
            }
            if (in_array($it->code, self::AR_ACCOUNTS, true)) {
                return ['ar' => $it->code, 'amount' => (float) $it->debit, 'cash' => false];
            }
        }

        return null;
    }

    /**
     * The receipt journals for one sale — EXACTLY, never by prefix.
     * `LIKE 'GL-SET-TKT-1%'` would also match sale TKT-12's receipts and settle the
     * wrong invoice, so an id must be the base or the base plus a -<n> sequence.
     * `$withReversals` also returns the GL-REV-… mirrors, which is what makes an
     * un-paid sale genuinely payable again (their debit cancels the credit).
     */
    private function receiptIds(string $ref, bool $withReversals = false): \Illuminate\Support\Collection
    {
        $bases = ['GL-SET-' . $ref];
        if ($withReversals) {
            $bases[] = 'GL-REV-GL-SET-' . $ref;
        }

        return DB::table('journal_entries')->whereNull('deleted_at')
            ->where(function ($q) use ($bases) {
                foreach ($bases as $b) {
                    $q->orWhere('reference', $b)->orWhere('reference', 'like', $b . '-%');
                }
            })
            ->orderBy('id')
            ->get(['id', 'reference']);
    }

    private function receiptCount(string $ref): int
    {
        return $this->receiptIds($ref)->count();
    }

    /** Total already received against this sale — its receipts MINUS any reversal. */
    private function settledSoFar(string $ref): float
    {
        $ids = $this->receiptIds($ref, true)->pluck('id');
        if ($ids->isEmpty()) {
            return 0.0;
        }
        $sum = DB::table('journal_items')
            ->join('accounts', 'accounts.id', '=', 'journal_items.account_id')
            ->whereIn('journal_items.journal_entry_id', $ids)
            ->whereNull('journal_items.deleted_at')
            ->whereIn('accounts.code', self::AR_ACCOUNTS)
            ->selectRaw('SUM(journal_items.credit) as cr, SUM(journal_items.debit) as dr')->first();

        return round((float) $sum->cr - (float) $sum->dr, 2);   // a reversal debits it back
    }
}
