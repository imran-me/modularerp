<?php

namespace App\Services;

use App\Exceptions\LedgerException;
use App\Support\CompanySlugs;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * MONEY BETWEEN THE SISTER CONCERNS.
 * ----------------------------------------------------------------------------
 * Five sister companies under one roof constantly do each other favours: the Group
 * cash box settles a Travels bill, Travels invoices Woodart, everyone shares the
 * office rent. Each of those is TWO sets of books moving at once, and if only one
 * side posts, the group consolidation stops balancing.
 *
 * Everything here goes through the elimination control accounts, so a favour never
 * inflates the group:
 *      1300 Inter-company Receivable   (they owe us)
 *      2400 Inter-company Payable      (we owe them)
 * Consolidation nets those two to zero — see LedgerService::consolidatedTrialBalance
 * and consolidatedPnl. That is why every method below writes BOTH legs in ONE
 * transaction: a half-posted favour is a permanently unbalanced group.
 *
 * THE FOUR FLOWS (the SPA equivalents are named so the two stay in step):
 *   invoice()    A sells to B                    → SPA ledger.postIntercompany()
 *   settle()     repay what one owes the other   → SPA settleInterco()
 *   shareCost()  one pays, all carry a share     → SPA sharedExpenseForm()
 *   positions()  who owes whom, right now        → SPA intercoPositions()
 *
 * FUNDING an expense (X's purse pays Y's bill) is not here on purpose: it is part of
 * recording that expense, so it lives in ExpensePostingService::record(fundedBy).
 */
class InterCompanyService
{
    public const RECEIVABLE = '1300';
    public const PAYABLE = '2400';

    public function __construct(
        private LedgerService $ledger,
        private BankRegisterService $register,
    ) {}

    /**
     * A sells something to B. The seller books revenue against a receivable, the
     * buyer books a cost against a payable — internal, so consolidation removes
     * BOTH the revenue and the cost (consolidatedPnl eliminates the pair).
     */
    public function invoice(string $fromCo, string $toCo, float $amount, array $opts = []): array
    {
        $amount = round($amount, 2);
        if ($amount <= 0) {
            throw new LedgerException('An inter-company invoice needs a positive amount.');
        }
        $this->requireDifferentConcerns($fromCo, $toCo);

        $ref = 'IC-' . ($opts['ref'] ?? ($fromCo . '-' . $toCo . '-' . strtoupper(Str::random(5))));
        $date = substr((string) ($opts['date'] ?? now()->toDateString()), 0, 10);
        $memo = (string) ($opts['memo'] ?? ('Inter-company: ' . $fromCo . ' → ' . $toCo));
        $revenue = (string) ($opts['revenueAccount'] ?? '4000');
        $expense = (string) ($opts['expenseAccount'] ?? '5000');

        return DB::transaction(function () use ($ref, $fromCo, $toCo, $amount, $date, $memo, $revenue, $expense) {
            $seller = $this->ledger->post([
                'id' => 'GL-' . $ref . '-' . $fromCo, 'date' => $date, 'companyId' => $fromCo,
                'ref' => $ref, 'memo' => $memo, 'source' => 'intercompany', 'party' => $toCo,
                'lines' => [
                    ['account' => self::RECEIVABLE, 'dr' => $amount, 'cr' => 0],
                    ['account' => $revenue, 'dr' => 0, 'cr' => $amount],
                ],
            ], CompanySlugs::dbId($fromCo));

            $buyer = $this->ledger->post([
                'id' => 'GL-' . $ref . '-' . $toCo, 'date' => $date, 'companyId' => $toCo,
                'ref' => $ref, 'memo' => $memo, 'source' => 'intercompany', 'party' => $fromCo,
                'lines' => [
                    ['account' => $expense, 'dr' => $amount, 'cr' => 0],
                    ['account' => self::PAYABLE, 'dr' => 0, 'cr' => $amount],
                ],
            ], CompanySlugs::dbId($toCo));

            return ['ref' => $ref, 'seller' => $seller, 'buyer' => $buyer];
        });
    }

    /**
     * Repay an inter-company balance. `direction`:
     *   'pay'     $companyId pays $party what it owes   (clears our 2400, their 1300)
     *   'receive' $party pays $companyId what it owes    (clears our 1300, their 2400)
     * The mirrored legs are what make the debt drop on BOTH books at once —
     * settling one side only would leave the group permanently out of balance.
     */
    public function settle(string $companyId, string $party, float $amount, string $direction, array $opts = []): array
    {
        $amount = round($amount, 2);
        if ($amount <= 0) {
            throw new LedgerException('A settlement needs a positive amount.');
        }
        $this->requireDifferentConcerns($companyId, $party);
        if (! in_array($direction, ['pay', 'receive'], true)) {
            throw new LedgerException('Settlement direction must be "pay" or "receive".');
        }

        // never settle more than is actually owed — the balance is read from the books
        $pos = $this->positions($companyId);
        $owed = $direction === 'pay' ? ($pos['owes'][$party] ?? 0) : ($pos['dueTo'][$party] ?? 0);
        if ($amount > round($owed, 2) + 0.01) {
            throw new LedgerException($direction === 'pay'
                ? 'Only ' . number_format($owed, 2) . ' is owed to ' . $party . '.'
                : $party . ' only owes ' . number_format($owed, 2) . '.');
        }

        $bank = ! empty($opts['bankId']) ? $this->register->requireAccount((string) $opts['bankId'], $companyId) : null;
        $ours = $bank ? $this->register->glAccountFor($bank) : '1010';
        // the counterparty's cash side: their own account when named, else plain Bank
        $theirBank = ! empty($opts['partyBankId']) ? $this->register->requireAccount((string) $opts['partyBankId'], $party) : null;
        $theirs = $theirBank ? $this->register->glAccountFor($theirBank) : '1010';

        $ref = 'ICS-' . strtoupper(Str::random(6));
        $date = substr((string) ($opts['date'] ?? now()->toDateString()), 0, 10);
        $isPay = $direction === 'pay';
        $note = (string) ($opts['ref'] ?? '');

        return DB::transaction(function () use ($ref, $companyId, $party, $amount, $date, $isPay, $direction, $ours, $theirs, $bank, $theirBank, $note) {
            $memoUs = ($isPay ? 'Settled inter-company debt to ' : 'Collected inter-company balance from ') . $party . ($note ? ' · ' . $note : '');
            $memoThem = ($isPay ? 'Received inter-company settlement from ' : 'Settled inter-company debt to ') . $companyId . ($note ? ' · ' . $note : '');

            $us = $this->ledger->post([
                'id' => 'GL-' . $ref . '-' . $companyId, 'date' => $date, 'companyId' => $companyId,
                'ref' => $ref, 'memo' => $memoUs, 'source' => 'intercompany', 'party' => $party,
                'lines' => $isPay
                    ? [['account' => self::PAYABLE, 'dr' => $amount, 'cr' => 0], ['account' => $ours, 'dr' => 0, 'cr' => $amount]]
                    : [['account' => $ours, 'dr' => $amount, 'cr' => 0], ['account' => self::RECEIVABLE, 'dr' => 0, 'cr' => $amount]],
            ], CompanySlugs::dbId($companyId));

            $them = $this->ledger->post([
                'id' => 'GL-' . $ref . '-' . $party, 'date' => $date, 'companyId' => $party,
                'ref' => $ref, 'memo' => $memoThem, 'source' => 'intercompany', 'party' => $companyId,
                'lines' => $isPay
                    ? [['account' => $theirs, 'dr' => $amount, 'cr' => 0], ['account' => self::RECEIVABLE, 'dr' => 0, 'cr' => $amount]]
                    : [['account' => self::PAYABLE, 'dr' => $amount, 'cr' => 0], ['account' => $theirs, 'dr' => 0, 'cr' => $amount]],
            ], CompanySlugs::dbId($party));

            // the real accounts move too, on whichever side named one
            $moves = [];
            if ($bank) {
                $moves[$companyId] = $this->register->apply($bank, $isPay ? 'withdraw' : 'deposit', $amount,
                    $date, $memoUs, $ref, 'GL-' . $ref . '-' . $companyId, ['entryRef' => 'ICS-' . $ref]);
            }
            if ($theirBank) {
                $moves[$party] = $this->register->apply($theirBank, $isPay ? 'deposit' : 'withdraw', $amount,
                    $date, $memoThem, $ref, 'GL-' . $ref . '-' . $party, ['entryRef' => 'ICS-' . $ref]);
            }

            return ['ref' => $ref, 'direction' => $direction, 'amount' => $amount,
                'us' => $us, 'them' => $them, 'register' => $moves,
                'remaining' => round(($this->positions($companyId)[$isPay ? 'owes' : 'dueTo'][$party] ?? 0), 2)];
        });
    }

    /**
     * ONE cost, carried by several concerns — rent, an AI subscription, a shared
     * licence. The payer pays the FULL bill; every concern's own P&L carries only
     * its share, and the difference is an inter-company balance.
     *
     *   payer:   DR <head> own share · DR 1300 (everyone else's shares) · CR cash FULL
     *   others:  DR <head> share     · CR 2400 share
     *
     * Split EQUALLY (owner decision 2026-07-22), the rounding remainder going to the
     * first concern so the shares always add back to the exact bill.
     */
    public function shareCost(array $in): array
    {
        $amount = round((float) ($in['amount'] ?? 0), 2);
        if ($amount <= 0) {
            throw new LedgerException('A shared cost needs a positive amount.');
        }
        $payer = (string) ($in['paidBy'] ?? 'group');
        $among = array_values(array_unique(array_filter((array) ($in['among'] ?? []))));
        if (count($among) < 2) {
            throw new LedgerException('A shared cost needs at least two concerns.');
        }
        if (! in_array($payer, $among, true)) {
            throw new LedgerException('The payer must be one of the concerns sharing the cost.');
        }
        foreach ($among as $c) {
            if (CompanySlugs::dbIdOrNull($c) === null) {
                throw new LedgerException('Unknown concern: ' . $c);
            }
        }

        $head = trim((string) ($in['head'] ?? '')) ?: $this->ledger->expenseAccountFor((string) ($in['category'] ?? ''));
        if (! $this->ledger->hasAccount($head)) {
            throw new LedgerException('Unknown account code: ' . $head);
        }

        $bank = ! empty($in['bankId']) ? $this->register->requireAccount((string) $in['bankId'], $payer) : null;
        $cash = $bank ? $this->register->glAccountFor($bank) : '1010';
        $ref = 'SHR-' . strtoupper(Str::random(6));
        $date = substr((string) ($in['date'] ?? now()->toDateString()), 0, 10);
        $memo = (string) ($in['category'] ?? 'Shared cost');

        $shares = $this->splitEqually($amount, count($among));
        $shareOf = [];
        foreach ($among as $i => $c) {
            $shareOf[$c] = $shares[$i];
        }

        return DB::transaction(function () use ($ref, $payer, $among, $shareOf, $amount, $head, $cash, $date, $memo, $bank, $in) {
            $ownShare = $shareOf[$payer];
            $lentOut = round($amount - $ownShare, 2);

            $payerLines = [];
            if ($ownShare > 0) {
                $payerLines[] = ['account' => $head, 'dr' => $ownShare, 'cr' => 0];
            }
            if ($lentOut > 0) {
                $payerLines[] = ['account' => self::RECEIVABLE, 'dr' => $lentOut, 'cr' => 0];
            }
            $payerLines[] = ['account' => $cash, 'dr' => 0, 'cr' => $amount];

            $journals = [];
            $journals[$payer] = $this->ledger->post([
                'id' => 'GL-' . $ref . '-' . $payer, 'date' => $date, 'companyId' => $payer, 'ref' => $ref,
                'memo' => $memo . ' (shared) — paid by ' . $payer . ', split across ' . count($among),
                'source' => 'intercompany', 'party' => 'shared', 'lines' => $payerLines,
            ], CompanySlugs::dbId($payer));

            foreach ($among as $c) {
                if ($c === $payer) {
                    continue;
                }
                $journals[$c] = $this->ledger->post([
                    'id' => 'GL-' . $ref . '-' . $c, 'date' => $date, 'companyId' => $c, 'ref' => $ref,
                    'memo' => $memo . ' share (from ' . $payer . ')', 'source' => 'intercompany', 'party' => $payer,
                    'lines' => [
                        ['account' => $head, 'dr' => $shareOf[$c], 'cr' => 0],
                        ['account' => self::PAYABLE, 'dr' => 0, 'cr' => $shareOf[$c]],
                    ],
                ], CompanySlugs::dbId($c));
            }

            // each concern's expense register shows its share, flagged `alloc` so the
            // client's own expense→GL mirror skips it (the GL is already posted here)
            $now = now();
            foreach ($among as $c) {
                DB::table('acc_entries')->insert([
                    'ext_id' => 'JV-' . $ref . '-' . $c, 'company_id' => $c, 'kind' => 'Expense',
                    'amount' => $shareOf[$c], 'category' => $memo, 'sub_category' => 'Shared',
                    'head' => $head, 'method' => $c === $payer ? ($cash === '1000' ? 'Cash' : 'Bank') : 'Inter-co',
                    'date' => $date, 'party' => 'Shared · ' . $payer, 'ref' => $ref,
                    'description' => (string) ($in['desc'] ?? ''), 'alloc' => true,
                    'created' => $date, 'created_at' => $now, 'updated_at' => $now,
                ]);
            }

            // the payer's account loses the FULL bill — one movement, not per share
            $move = null;
            if ($bank) {
                $move = $this->register->apply($bank, 'withdraw', $amount, $date,
                    $memo . ' · shared cost (' . count($among) . ' concerns)', $ref,
                    'GL-' . $ref . '-' . $payer, ['entryRef' => 'SHR-' . $ref]);
            }

            return ['ref' => $ref, 'head' => $head, 'shares' => $shareOf,
                'journals' => $journals, 'register' => $move];
        });
    }

    /**
     * Who owes whom, right now — read from the books, never stored.
     *   owes[party]  = we owe them   (net 2400)
     *   dueTo[party] = they owe us   (net 1300)
     */
    public function positions(string $companyId): array
    {
        $cid = CompanySlugs::dbId($companyId);
        $hasParty = $this->ledger->hasPartyColumn();

        $rows = DB::table('journal_items')
            ->join('journal_entries', 'journal_entries.id', '=', 'journal_items.journal_entry_id')
            ->join('accounts', 'accounts.id', '=', 'journal_items.account_id')
            ->whereNull('journal_items.deleted_at')->whereNull('journal_entries.deleted_at')
            ->where('journal_entries.company_id', $cid)
            ->whereIn('accounts.code', [self::RECEIVABLE, self::PAYABLE])
            ->get(array_merge(['journal_entries.reference as reference', 'accounts.code as code',
                'journal_items.debit as debit', 'journal_items.credit as credit'],
                $hasParty ? ['journal_entries.party as party'] : []));

        $owes = [];
        $dueTo = [];
        foreach ($rows as $r) {
            // WHO: the entry's own party when it names a real concern (the reliable
            // way, and what the SPA does); otherwise fall back to pairing by the
            // shared reference, which is all an un-migrated host has to go on.
            $party = null;
            if ($hasParty && ! empty($r->party) && CompanySlugs::dbIdOrNull((string) $r->party) !== null
                && (string) $r->party !== $companyId) {
                $party = (string) $r->party;
            }
            if ($party === null) {
                $party = $this->partyFromReference((string) $r->reference, $companyId);
            }
            if ($party === null) {
                continue;
            }
            if ($r->code === self::PAYABLE) {
                $owes[$party] = ($owes[$party] ?? 0) + ((float) $r->credit - (float) $r->debit);
            } else {
                $dueTo[$party] = ($dueTo[$party] ?? 0) + ((float) $r->debit - (float) $r->credit);
            }
        }

        return [
            'owes' => array_map(fn ($v) => round($v, 2), array_filter($owes, fn ($v) => $v > 0.5)),
            'dueTo' => array_map(fn ($v) => round($v, 2), array_filter($dueTo, fn ($v) => $v > 0.5)),
        ];
    }

    /* ------------------------------------------------------------------ inside */

    /** Equal split whose parts add back to the exact total (remainder to the first). */
    private function splitEqually(float $amount, int $n): array
    {
        $cents = (int) round($amount * 100);
        $base = intdiv($cents, $n);
        $out = array_fill(0, $n, $base);
        $out[0] += $cents - ($base * $n);

        return array_map(fn ($c) => (float) ($c / 100), $out);
    }

    private function requireDifferentConcerns(string $a, string $b): void
    {
        if ($a === $b) {
            throw new LedgerException('A concern cannot transact with itself.');
        }
        foreach ([$a, $b] as $c) {
            if (CompanySlugs::dbIdOrNull($c) === null) {
                throw new LedgerException('Unknown concern: ' . $c);
            }
        }
    }

    /**
     * Both legs of every flow here share one `ref` and are id'd GL-<ref>-<company>,
     * so the counterparty of OUR leg is whichever other company also has a leg under
     * that ref. Read from the data rather than from a `party` string, which is free
     * text and cannot be trusted to name a real concern.
     */
    private function partyFromReference(string $reference, string $mine): ?string
    {
        if ($reference === '') {
            return null;
        }
        $suffix = '-' . $mine;
        if (! str_ends_with($reference, $suffix)) {
            return null;
        }
        $ref = substr($reference, 0, -strlen($suffix));

        $others = DB::table('journal_entries')->whereNull('deleted_at')
            ->where('reference', 'like', $ref . '-%')
            ->where('reference', '!=', $reference)
            ->pluck('reference');
        foreach ($others as $o) {
            $slug = substr((string) $o, strlen($ref) + 1);
            if (CompanySlugs::dbIdOrNull($slug) !== null && $slug !== $mine) {
                return $slug;
            }
        }

        return null;
    }
}
