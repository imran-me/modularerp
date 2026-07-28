<?php

namespace Epal\Modules\Woodart\Accounts\Services;

use App\Services\ExpensePostingService;
use App\Services\SalePostingService;
use Epal\Modules\Woodart\Accounts\Models\AccEntry;
use Epal\Modules\Woodart\Procurement\Models\PurchaseOrder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * THE WRITE SIDE — every rupee Woodart records enters the group's books here.
 *
 * WHY THIS IS NOT A LEDGER OF ITS OWN (endpoints.md, invariant 1)
 * Woodart owns no accounting table. Postings go through the KERNEL services in
 * platform/backend/app/Services — the same ones Travels uses — so the group's
 * accounting cannot differ by which company's screen recorded the money. A
 * Woodart-only posting path would fork the books, which is the single thing the
 * bridge architecture exists to prevent.
 *
 * THE TWO PATHS ARE ASYMMETRIC, AND DELIBERATELY SO
 *
 *   EXPENSE → ExpensePostingService::record() does everything: the acc_entries
 *             register row, the GL (DR head / CR cash|bank), and the paying
 *             account's balance plus a row in its history.
 *
 *   INCOME  → SalePostingService::record() posts the REVENUE journal but does
 *             NOT write an acc_entries row — that table is the expense-shaped
 *             register, and the sale services were built for modules that keep
 *             their own sales ledger. Woodart shows income in the same register,
 *             so this service writes that row itself and wraps BOTH in one
 *             transaction.
 *
 * That asymmetry is a fact about the kernel, not a choice made here. It is
 * written down because the obvious "tidy-up" — routing income through
 * ExpensePostingService because it is the one that writes the register row —
 * would post revenue as a DEBIT to an expense head and silently invert the P&L.
 *
 * WHY NOT ReceiptPostingService: that one settles an EXISTING receivable, and
 * refuses anything that never raised one. A Woodart project billing raises the
 * sale; it does not settle a prior invoice.
 */
class EntryPostingService
{
    public function __construct(
        private ExpensePostingService $expense,
        private SalePostingService $sale,
    ) {}

    /**
     * Record one register entry — income or expense — across every book.
     *
     * @param  array  $in  the frontend record shape (see frontend/api.js)
     * @return array{entry: array, journal: string|null}
     */
    public function record(array $in): array
    {
        $kind = ($in['kind'] ?? AccEntry::EXPENSE) === AccEntry::INCOME
            ? AccEntry::INCOME
            : AccEntry::EXPENSE;

        return $kind === AccEntry::INCOME
            ? $this->recordIncome($in)
            : $this->recordExpense($in);
    }

    /** Straight delegation: the kernel already moves all three books. */
    private function recordExpense(array $in): array
    {
        $out = $this->expense->record([
            'id'        => $in['id'] ?? null,
            'companyId' => AccEntry::COMPANY,
            'amount'    => $in['amount'],
            'category'  => $in['category'] ?? null,
            'method'    => $in['method'] ?? null,
            'bankId'    => $in['bankId'] ?? null,
            'fundedBy'  => $in['fundedBy'] ?? null,
            'date'      => $in['date'] ?? null,
            'party'     => $in['party'] ?? null,
            'ref'       => $in['ref'] ?? null,
            'desc'      => $in['description'] ?? null,
        ]);

        return [
            'entry'   => (array) ($out['entry'] ?? []),
            'journal' => $this->journalId($out['journal'] ?? null),
        ];
    }

    /**
     * Pull the readable id out of whatever a kernel service returns for a
     * journal — model, array or plain string.
     *
     * Written tolerantly on purpose. The two posting services were built at
     * different times and this module is only a CONSUMER of them; guessing one
     * concrete shape would break the moment the other one is touched, and the
     * id is decoration on the response, not something the books depend on.
     */
    private function journalId(mixed $journal): ?string
    {
        if (is_string($journal)) {
            return $journal;
        }
        if (is_array($journal)) {
            return $journal['ext_id'] ?? null;
        }
        if (is_object($journal)) {
            return $journal->ext_id ?? null;
        }

        return null;
    }

    /**
     * Revenue journal + the register row, together or not at all.
     *
     * `ref` given to SalePostingService is the ENTRY's own id, never the project
     * id. The sale ref is the spine of the journal and the handle void() uses;
     * keying it on the project would make a second billing against the same
     * project collide with the first. The project stays in the register row's
     * own `ref`, which is what Project P&L reads.
     */
    private function recordIncome(array $in): array
    {
        $extId  = trim((string) ($in['id'] ?? '')) ?: ('JV-WA' . strtoupper(Str::random(6)));
        $amount = round((float) ($in['amount'] ?? 0), 2);
        $date   = substr((string) ($in['date'] ?? now()->toDateString()), 0, 10);

        return DB::transaction(function () use ($in, $extId, $amount, $date) {
            $sale = $this->sale->record([
                'ref'       => $extId,
                'companyId' => AccEntry::COMPANY,
                'amount'    => $amount,
                'cost'      => 0,           // COGS is posted by material issue / procurement, not here
                'vat'       => 0,           // Woodart bills VAT-exclusive today; see context.md
                'category'  => $in['category'] ?? null,
                'paid'      => ! empty($in['bankId']) || ($in['method'] ?? '') !== '',
                'bankId'    => $in['bankId'] ?? null,
                'customer'  => $in['party'] ?? null,
                'date'      => $date,
                'desc'      => $in['description'] ?? null,
            ]);

            $entry = AccEntry::updateOrCreate(
                ['ext_id' => $extId],
                [
                    'company_id'  => AccEntry::COMPANY,
                    'kind'        => AccEntry::INCOME,
                    'category'    => $in['category'] ?? null,
                    'description' => $in['description'] ?? null,
                    'amount'      => $amount,
                    'method'      => $in['method'] ?? null,
                    'bank_id'     => $in['bankId'] ?? null,
                    'date'        => $date,
                    'party'       => $in['party'] ?? null,
                    'ref'         => $in['ref'] ?: null,
                    'alloc'       => false,
                    'created'     => $date,
                ]
            );

            return [
                'entry'   => $entry->toArray(),
                'journal' => $sale['revenue']['ext_id'] ?? null,
            ];
        });
    }

    /**
     * Void an entry — a REVERSAL, never a delete (invariant 3, AUDIT P2).
     *
     * A balance must never move without a row explaining why. The kernel
     * services own the reversal for their own postings, so the void is
     * dispatched the same way the posting was.
     */
    public function void(string $extId, string $reason = 'voided from Woodart Accounts'): array
    {
        $entry = AccEntry::query()->woodart()->where('ext_id', $extId)->first();

        if (! $entry) {
            return ['success' => false, 'message' => 'No Woodart entry ' . $extId];
        }

        if ($entry->isIncome()) {
            $this->sale->void($extId, $reason);
            // The sale service reverses the journal; the register row is ours.
            $entry->delete();

            return ['success' => true, 'reversed' => $extId];
        }

        $this->expense->void($extId, $reason);

        return ['success' => true, 'reversed' => $extId];
    }

    /**
     * Settle a purchase order.
     *
     * Booked as an ordinary expense against the payables head so it travels the
     * same audited path as every other payment — register row, GL, bank
     * movement, in one transaction. The PO id goes in `ref`, which is exactly
     * what AccountsService::payables() matches on to work out what is still
     * owed (contract invariant 4).
     */
    public function payVendor(string $po, array $in): array
    {
        $order = PurchaseOrder::query()
            ->where('company_id', AccEntry::COMPANY)
            ->where('ext_id', $po)
            ->first();

        if (! $order) {
            return ['success' => false, 'message' => 'No purchase order ' . $po];
        }

        $amount = round((float) ($in['amount'] ?? 0), 2);
        $paid   = (float) AccEntry::query()->woodart()
            ->where('kind', AccEntry::EXPENSE)
            ->where('category', 'Vendor Payment')
            ->where('ref', $po)
            ->sum('amount');

        $due = round((float) $order->amount - $paid, 2);

        // A payment may not exceed what is owed. Overpaying a settled order is
        // how a payables report starts disagreeing with the ledger.
        if ($amount <= 0 || $amount > $due) {
            return [
                'success' => false,
                'message' => 'Payment must be between 0 and the outstanding ' . number_format($due, 2),
            ];
        }

        $out = $this->recordExpense([
            'id'          => $in['id'] ?? null,
            'amount'      => $amount,
            'category'    => 'Vendor Payment',
            'description' => $in['note'] ?? ($order->supplier . ' — settles ' . $po),
            'method'      => $in['method'] ?? 'Bank',
            'bankId'      => $in['bankId'] ?? null,
            'date'        => $in['date'] ?? null,
            'party'       => $order->supplier,
            'ref'         => $po,
        ]);

        return [
            'success'   => true,
            'data'      => $out['entry'],
            'journal'   => $out['journal'],
            'remaining' => round($due - $amount, 2),
        ];
    }
}
