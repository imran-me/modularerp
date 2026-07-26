<?php

namespace App\Services;

use App\Exceptions\LedgerException;
use App\Support\CompanySlugs;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * RECORD AN EXPENSE — once, and it lands in every book that has to know.
 * ----------------------------------------------------------------------------
 * "I bought tea for a guest." One HTTP call, one database transaction, and the
 * spend appears everywhere the accountants look:
 *
 *   1. THE REGISTER   `acc_entries`  — the concern's expense history (the list on
 *                     Travels › Accounts › Expenses, searchable by head/party).
 *   2. THE LEDGER     `journal_entries` + `journal_items` — the double entry that
 *                     feeds journals, account ledgers, trial balance, the P&L and
 *                     the Group consolidation (they are all READS over the GL,
 *                     which is why posting there is what makes them all agree).
 *   3. THE ACCOUNT    `banks` + `bank_transactions` — the named account the money
 *                     left: balance down, one withdrawal row in its history.
 *
 * THE DOUBLE ENTRY
 *   Paid from our own account:
 *       DR <expense head e.g. 5550 Food & Entertainment>
 *       CR 1010 Bank | 1000 Cash          (the account's own GL side)
 *
 *   Paid from ANOTHER concern's account (inter-company funding) — the expense is
 *   ours, but the cash was theirs, so it is booked as a LOAN through the
 *   elimination control accounts and NOT as our cash going out:
 *       us:     DR <expense head>       / CR 2400 Inter-company Payable
 *       funder: DR 1300 Inter-co Rcv    / CR 1010|1000  (their account moves)
 *   Group consolidation eliminates 1300 against 2400, so the group P&L carries
 *   the expense exactly once and nobody double-counts the cash. The debt is
 *   settled later with the reverse legs (see the frontend's settleInterco()).
 *
 * IDEMPOTENT + REVERSIBLE
 *   The voucher id (`acc_entries.ext_id`, e.g. 'JV-A1B2C3') is the spine: the GL
 *   entries are 'GL-ACC-<id>' (ours) and 'GL-ACF-<id>' (the funder's), and the
 *   register row is tagged with it. So re-posting the same voucher updates in
 *   place, and void() can undo the exact three books it touched — by REVERSING,
 *   never by erasing (audit trail).
 *
 * WHY IT LIVES IN platform/backend (the kernel) AND NOT IN A COMPANY MODULE:
 *   every concern records expenses the same way, and the three books it writes
 *   are shared. A company module must never reach into another company's code —
 *   they meet in the kernel. The module keeps only its HTTP surface (see
 *   companies/travels/modules/accounts/backend/ExpenseController.php).
 */
class ExpensePostingService
{
    public function __construct(
        private LedgerService $ledger,
        private BankRegisterService $register,
    ) {}

    /**
     * Record one expense across all three books.
     *
     * @param  array  $in  the frontend record shape (see the SPA's expenseEntry()):
     *   id?          voucher id — omit to mint one ('JV-…'); passing an existing one re-posts it
     *   companyId    whose expense it is (slug, e.g. 'travels')                          REQUIRED
     *   amount       > 0                                                                 REQUIRED
     *   head         chart-of-accounts code to debit ('5550'); derived from `category` when absent
     *   category     the head's human name ('Guest & Entertainment')
     *   subCategory  the item ('Tea / Coffee (Guest)')
     *   bankId       the account the money left — id from `banks`; omit for an
     *                unregistered method (a cheque, a card swipe)
     *   method       Bank | Cash | bKash | Nagad | Debit Card | Credit Card | Cheque
     *   fundedBy     slug of the concern whose money paid, when it was not our own
     *   date, party, ref, desc
     * @param  int|null  $scopeCompanyId  from ScopesToCompany — forces a company user to its own books
     * @return array  keys: entry (the register row), journal (ours), funderJournal
     *                (the funder's mirror leg or null), register (the account
     *                movement or null when no registered account was named)
     */
    public function record(array $in, ?int $scopeCompanyId = null): array
    {
        $amount = round((float) ($in['amount'] ?? 0), 2);
        if ($amount <= 0) {
            throw new LedgerException('An expense needs a positive amount.');
        }

        // whose expense — a company-scoped user can only book their own
        $companySlug = (string) ($in['companyId'] ?? 'group');
        if ($scopeCompanyId !== null) {
            $companySlug = CompanySlugs::slug($scopeCompanyId);
        }

        // the head we debit: pinned by the form, else mapped from the wording
        $head = trim((string) ($in['head'] ?? ''));
        if ($head === '') {
            $head = $this->ledger->expenseAccountFor(($in['category'] ?? '') . ' ' . ($in['subCategory'] ?? ''));
        }
        if (! $this->ledger->hasAccount($head)) {
            throw new LedgerException('Unknown account code: ' . $head . ' — add it to the chart of accounts first.');
        }

        // who actually paid, and out of which account. An expense funded by
        // another concern leaves THAT concern's account, never ours.
        $funder = trim((string) ($in['fundedBy'] ?? ''));
        if ($funder === $companySlug) {
            $funder = '';
        }
        if ($funder !== '' && CompanySlugs::dbIdOrNull($funder) === null) {
            throw new LedgerException('Unknown funding concern: ' . $funder);
        }
        $payer = $funder !== '' ? $funder : $companySlug;

        $bank = isset($in['bankId']) && $in['bankId'] !== ''
            ? $this->register->requireAccount((string) $in['bankId'], $payer)
            : null;
        $payAccount = $bank ? $this->register->glAccountFor($bank)
            : ((($in['method'] ?? '') === 'Cash') ? '1000' : '1010');

        $extId = trim((string) ($in['id'] ?? '')) ?: ('JV-' . strtoupper(Str::random(6)));
        $date  = substr((string) ($in['date'] ?? now()->toDateString()), 0, 10);
        $what  = $this->describe($in);
        $memo  = trim((string) ($in['desc'] ?? '')) ?: $what;

        return DB::transaction(function () use ($in, $extId, $companySlug, $funder, $bank, $payAccount, $head, $amount, $date, $memo, $what) {
            /* 1 · THE REGISTER — the concern's own expense history */
            $entry = $this->saveRegisterRow($in, $extId, $companySlug, $funder, $bank, $payAccount, $head, $amount, $date);

            /* 2 · THE LEDGER — the double entry every report reads */
            $ourLines = $funder !== ''
                ? [['account' => $head, 'dr' => $amount, 'cr' => 0], ['account' => '2400', 'dr' => 0, 'cr' => $amount]]
                : [['account' => $head, 'dr' => $amount, 'cr' => 0], ['account' => $payAccount, 'dr' => 0, 'cr' => $amount]];

            $journal = $this->ledger->post([
                'id'        => 'GL-ACC-' . $extId,
                'date'      => $date,
                'companyId' => $companySlug,
                'ref'       => $extId,
                'memo'      => $memo . ($funder !== '' ? ' — funded by ' . $funder : ''),
                'source'    => $funder !== '' ? 'intercompany' : 'manual',
                'party'     => $funder !== '' ? $funder : (string) ($in['party'] ?? ''),
                'lines'     => $ourLines,
            ], CompanySlugs::dbId($companySlug));

            // the funder's mirror leg: their cash left, and we owe them
            $funderJournal = null;
            if ($funder !== '') {
                $funderJournal = $this->ledger->post([
                    'id'        => 'GL-ACF-' . $extId,
                    'date'      => $date,
                    'companyId' => $funder,
                    'ref'       => $extId,
                    'memo'      => 'Funded ' . $companySlug . ' expense · ' . (($in['category'] ?? '') ?: 'expense'),
                    'source'    => 'intercompany',
                    'party'     => $companySlug,
                    'lines'     => [
                        ['account' => '1300', 'dr' => $amount, 'cr' => 0],
                        ['account' => $payAccount, 'dr' => 0, 'cr' => $amount],
                    ],
                ], CompanySlugs::dbId($funder));
            }

            /* 3 · THE ACCOUNT — balance down + a row in its own history */
            $register = null;
            if ($bank) {
                $register = $this->register->apply($bank, 'withdraw', $amount, $date, $what,
                    ((string) ($in['ref'] ?? '')) ?: $extId,
                    $funder !== '' ? 'GL-ACF-' . $extId : 'GL-ACC-' . $extId,
                    ['entryRef' => $extId]);
            }

            return ['entry' => $entry, 'journal' => $journal, 'funderJournal' => $funderJournal, 'register' => $register];
        });
    }

    /**
     * Undo a voucher: the register row goes, the ledger postings are REVERSED
     * (never erased — the original and its mirror image both stay on the books),
     * and the paying account gets its money back with a reversal row explaining
     * why its balance moved. All in one transaction, so a half-undone expense
     * cannot exist.
     */
    public function void(string $extId, string $reason = 'voucher deleted'): array
    {
        return DB::transaction(function () use ($extId, $reason) {
            $row = DB::table('acc_entries')->where('ext_id', $extId)->first();
            if (! $row) {
                throw new LedgerException('Voucher ' . $extId . ' not found.');
            }

            DB::table('acc_entries')->where('ext_id', $extId)->delete();

            $reversals = array_values(array_filter([
                $this->ledger->reverse('GL-ACC-' . $extId, $reason),
                $this->ledger->reverse('GL-ACF-' . $extId, $reason),   // the funder's leg, when there was one
            ]));
            $register = $this->register->reverseFor($extId, $reason);

            return ['voided' => $extId, 'reversals' => $reversals, 'register' => $register];
        });
    }

    /** What this spend WAS, in one line — the memo, the register description and
     *  the bank-history row all read the same sentence. */
    private function describe(array $in): string
    {
        $s = (string) ($in['category'] ?? 'Expense');
        if (($in['subCategory'] ?? '') !== '') {
            $s .= ' · ' . $in['subCategory'];
        }
        if (($in['party'] ?? '') !== '') {
            $s .= ' — ' . $in['party'];
        }

        return trim($s);
    }

    /** The `acc_entries` row — the same columns AccEntryService writes, so the
     *  register reads identically whichever side recorded the spend. Returns it
     *  in the frontend `acc_entries` shape (AccEntryResource + the payment
     *  source fields), which is what the API hands back to the client. */
    private function saveRegisterRow(array $in, string $extId, string $companySlug, string $funder,
        ?object $bank, string $payAccount, string $head, float $amount, string $date): array
    {
        $now = now();
        $row = [
            'company_id'   => $companySlug,
            'kind'         => 'Expense',
            'amount'       => $amount,
            'category'     => $in['category'] ?? null,
            'sub_category' => $in['subCategory'] ?? null,
            'head'         => $head,
            'method'       => $in['method'] ?? ($payAccount === '1000' ? 'Cash' : 'Bank'),
            'date'         => $date,
            'party'        => $in['party'] ?? null,
            'ref'          => $in['ref'] ?? null,
            'description'  => $in['desc'] ?? null,
            'funded_by'    => $funder !== '' ? $funder : null,
            'created'      => $in['created'] ?? $now->toDateString(),
            'bank_id'      => $bank ? (string) $bank->id : null,
            'bank_name'    => $bank ? $bank->name : null,
            'pay_acct'     => $payAccount,
            'updated_at'   => $now,
        ];

        $existing = DB::table('acc_entries')->where('ext_id', $extId)->value('id');
        if ($existing) {
            DB::table('acc_entries')->where('id', $existing)->update($row);
        } else {
            DB::table('acc_entries')->insert($row + ['ext_id' => $extId, 'created_at' => $now]);
        }

        return [
            'id'          => $extId,
            'companyId'   => $companySlug,
            'kind'        => 'Expense',
            'amount'      => $amount,
            'category'    => $row['category'],
            'subCategory' => $row['sub_category'],
            'head'        => $head,
            'method'      => $row['method'],
            'payAcct'     => $payAccount,
            'bankId'      => $row['bank_id'] ?: '',
            'bankName'    => $row['bank_name'] ?: '',
            'date'        => $date,
            'party'       => $row['party'],
            'ref'         => $row['ref'],
            'desc'        => $row['description'],
            'fundedBy'    => $funder,
            'created'     => $row['created'],
        ];
    }
}
