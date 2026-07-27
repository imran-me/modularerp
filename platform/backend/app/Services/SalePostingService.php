<?php

namespace App\Services;

use App\Exceptions\LedgerException;
use App\Support\CompanySlugs;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

/**
 * RECORD A SALE — one call, and the money is on every book.
 * ----------------------------------------------------------------------------
 * The server-side twin of the SPA's sale auto-post (the `sale:recorded` handler in
 * platform/engines-library/ledger.js). A ticket, a visa, an EMD, contract seats —
 * every module funnels into this, so the accounting cannot differ by which screen
 * sold it.
 *
 * THE TWO JOURNALS (kept as two on purpose, so the vendor's payable sub-ledger is
 * correct and a cost can be voided independently of the revenue):
 *
 *   revenue   DR 1010|1000 (paid) | 1200 AR | 1150 sub-agent AR
 *             CR <income head by product>            … and CR 2130 for the VAT part
 *   cost      DR 5000 Cost of Sales
 *             CR 1010|1000 (vendor already paid) | 2000 Accounts Payable
 *
 * THE RULES IT ENFORCES (each one is a bug that was found and fixed on the SPA
 * side — they are re-stated here so the API cannot regress them):
 *   · VAT IS NOT REVENUE. When the price includes VAT, only the net credits income;
 *     the tax credits 2130 VAT Payable — money owed to the NBR. Booking it as
 *     income inflates the P&L and overstates margin.
 *   · A SUB-AGENT IS NOT A CUSTOMER. An unpaid sale to a sub-agent sits in 1150,
 *     not customer AR 1200, or the two ageing books mix.
 *   · A NEGATIVE COST STILL POSTS. A void/refund reverses a sale with a negative
 *     cost; a `> 0` guard silently dropped that leg and left a phantom loss plus a
 *     phantom payable on the books. Non-zero posts, either sign.
 *   · WHICH ACCOUNT, NOT JUST "BANK". A paid sale that names an account books to
 *     THAT account's own side (a cash box IS hard cash 1000) and moves its balance
 *     and history — otherwise the ledger says money arrived while Manage Banks
 *     shows the old figure.
 *   · IDEMPOTENT. Stable ids (GL-S<ref> / GL-SC<ref>) mean replaying a sale
 *     updates it instead of double-counting revenue.
 *
 * @see \App\Services\ReceiptPostingService  the later "customer paid" half
 * @see \App\Services\ExpensePostingService  the same shape for money going out
 */
class SalePostingService
{
    /** Product label per income head — the sale's head IS its product, which is
     *  what lets a per-product P&L be read straight off the journals. */
    private const PRODUCTS = [
        '4010' => 'Air Ticket', '4020' => 'Visa', '4030' => 'Package',
        '4040' => 'Hotel', '4050' => 'Contract', '4000' => 'Other Sales',
    ];

    public const COGS = '5000';
    public const AGENT_COMMISSION = '5350';
    public const AR_CUSTOMER = '1200';
    public const AR_AGENT = '1150';
    public const AP_VENDOR = '2000';
    public const VAT_PAYABLE = '2130';

    public function __construct(
        private LedgerService $ledger,
        private BankRegisterService $register,
    ) {}

    /**
     * @param  array  $in
     *   ref          the selling module's own id ('TKT-1201') — the spine of both journals   REQUIRED
     *   companyId    whose sale (slug)                                                        REQUIRED
     *   amount       what the customer pays (VAT included, if any)                            REQUIRED
     *   cost         what it cost us (may be negative for a void/refund)
     *   vat          the VAT portion OF `amount` (0 when the sale charges none)
     *   incomeAccount / category   the income head; category maps when no code is given
     *   paid         true → the customer has paid; else it is a receivable
     *   bankId       WHICH account the payment landed in (only meaningful when paid)
     *   costPaid     true → the vendor is already paid
     *   costBankId   which account paid the vendor (defaults to bankId)
     *   customer, vendor, date, desc, isAgent
     * @return array  keys: revenue (journal), cost (journal|null), register (moves)
     */
    public function record(array $in, ?int $scopeCompanyId = null): array
    {
        $amount = round((float) ($in['amount'] ?? 0), 2);
        $cost   = round((float) ($in['cost'] ?? 0), 2);
        $vat    = round((float) ($in['vat'] ?? 0), 2);
        if (abs($amount) < 0.01) {
            throw new LedgerException('A sale needs an amount.');
        }

        $companySlug = $scopeCompanyId !== null ? CompanySlugs::slug($scopeCompanyId) : (string) ($in['companyId'] ?? 'group');
        $ref = trim((string) ($in['ref'] ?? '')) ?: ('SL-' . strtoupper(Str::random(8)));
        $date = substr((string) ($in['date'] ?? now()->toDateString()), 0, 10);
        $memo = trim((string) ($in['desc'] ?? '')) ?: 'Sale';

        $income = $this->incomeAccountFor($in);
        if (! $this->ledger->hasAccount($income)) {
            throw new LedgerException('Unknown income account: ' . $income);
        }
        $product = self::PRODUCTS[$income] ?? 'Other Sales';

        $paid = ($in['paid'] ?? false) === true || ($in['payStatus'] ?? '') === 'Paid';
        $inBank  = $paid && ! empty($in['bankId']) ? $this->register->requireAccount((string) $in['bankId'], $companySlug) : null;
        $outBank = ($in['costPaid'] ?? false) === true && ! empty($in['costBankId'] ?? $in['bankId'] ?? null)
            ? $this->register->requireAccount((string) ($in['costBankId'] ?? $in['bankId']), $companySlug) : null;

        // where the customer's side lands
        $debit = $paid
            ? ($inBank ? $this->register->glAccountFor($inBank) : '1010')
            : ($this->isAgent($in) ? self::AR_AGENT : self::AR_CUSTOMER);
        // …and where the vendor's side comes from
        $creditCost = ($in['costPaid'] ?? false) === true
            ? ($outBank ? $this->register->glAccountFor($outBank) : '1010')
            : self::AP_VENDOR;

        // VAT only splits out when it is a genuine PART of the amount
        $splitVat = $vat > 0 && $vat < abs($amount);

        return DB::transaction(function () use ($in, $ref, $companySlug, $amount, $cost, $vat, $splitVat,
            $income, $product, $debit, $creditCost, $date, $memo, $inBank, $outBank) {

            $lines = $splitVat
                ? [
                    ['account' => $debit, 'dr' => $amount, 'cr' => 0],
                    ['account' => $income, 'dr' => 0, 'cr' => $amount - $vat],
                    ['account' => self::VAT_PAYABLE, 'dr' => 0, 'cr' => $vat],
                  ]
                : [
                    ['account' => $debit, 'dr' => $amount, 'cr' => 0],
                    ['account' => $income, 'dr' => 0, 'cr' => $amount],
                  ];

            $revenue = $this->ledger->post([
                'id' => 'GL-S' . $ref, 'date' => $date, 'companyId' => $companySlug, 'ref' => $ref,
                'memo' => $memo, 'source' => 'sale', 'party' => (string) ($in['customer'] ?? ''),
                'lines' => $lines,
            ], CompanySlugs::dbId($companySlug));

            // `!= 0`, not `> 0`: a void/refund carries a NEGATIVE cost and must reverse
            $costJournal = null;
            if (abs($cost) >= 0.01) {
                $costJournal = $this->ledger->post([
                    'id' => 'GL-SC' . $ref, 'date' => $date, 'companyId' => $companySlug, 'ref' => $ref,
                    'memo' => $memo . ' — cost', 'source' => 'sale',
                    'party' => (string) ($in['vendor'] ?? $in['customer'] ?? ''),
                    'lines' => [
                        ['account' => self::COGS, 'dr' => $cost, 'cr' => 0],
                        ['account' => $creditCost, 'dr' => 0, 'cr' => $cost],
                    ],
                ], CompanySlugs::dbId($companySlug));
            }

            // AGENT COMMISSION — its OWN head, never buried in the cost of sales.
            // A sub-agent's cut is not what the ticket cost us; it is what we owe the
            // agent for bringing the customer. Inside 5000 it was invisible: the books
            // could not say what is owed to agents, and gross margin read low while
            // commission expense read zero. party = the agent, so it lands in their
            // payable sub-ledger and settles like any other supplier balance.
            $commissionJournal = null;
            $commission = round((float) ($in['commission'] ?? 0), 2);
            if (abs($commission) >= 0.01) {
                $commissionCredit = ($in['commissionPaid'] ?? false) === true
                    ? ($outBank ? $this->register->glAccountFor($outBank) : '1010')
                    : self::AP_VENDOR;
                $commissionJournal = $this->ledger->post([
                    'id' => 'GL-SM' . $ref, 'date' => $date, 'companyId' => $companySlug, 'ref' => $ref,
                    'memo' => $memo . ' — agent commission' . (($in['agent'] ?? '') !== '' ? ' · ' . $in['agent'] : ''),
                    'source' => 'sale', 'party' => (string) ($in['agent'] ?? $in['customer'] ?? ''),
                    'lines' => [
                        ['account' => self::AGENT_COMMISSION, 'dr' => $commission, 'cr' => 0],
                        ['account' => $commissionCredit, 'dr' => 0, 'cr' => $commission],
                    ],
                ], CompanySlugs::dbId($companySlug));
            }

            // the accounts' own books — balance + a row in their history
            $moves = [];
            if ($inBank && $amount > 0) {
                $moves['in'] = $this->register->apply($inBank, 'deposit', $amount, $date,
                    $memo, $ref, 'GL-S' . $ref, ['entryRef' => 'SALE-' . $ref]);
            }
            if ($outBank && $cost > 0) {
                $moves['out'] = $this->register->apply($outBank, 'withdraw', $cost, $date,
                    $memo . ' — cost', $ref, 'GL-SC' . $ref, ['entryRef' => 'SALECOST-' . $ref]);
            }

            return [
                'ref' => $ref, 'product' => $product,
                'revenue' => $revenue, 'cost' => $costJournal, 'commission' => $commissionJournal, 'register' => $moves,
                'debitedTo' => $debit, 'paid' => $debit !== self::AR_CUSTOMER && $debit !== self::AR_AGENT,
            ];
        });
    }

    /**
     * Void a sale: both journals REVERSED (never erased) and any account movement
     * given back with its own row. The original and the reversal both stay — that
     * pair is the audit trail.
     */
    public function void(string $ref, string $reason = 'sale voided'): array
    {
        return DB::transaction(function () use ($ref, $reason) {
            $reversals = array_values(array_filter([
                $this->ledger->reverse('GL-S' . $ref, $reason),
                $this->ledger->reverse('GL-SC' . $ref, $reason),
            ]));
            if (! $reversals) {
                throw new LedgerException('Sale ' . $ref . ' was never posted.');
            }

            return [
                'voided' => $ref,
                'reversals' => $reversals,
                'register' => array_values(array_filter([
                    $this->register->reverseFor('SALE-' . $ref, $reason),
                    $this->register->reverseFor('SALECOST-' . $ref, $reason),
                ])),
            ];
        });
    }

    /**
     * Is the buyer one of our SUB-AGENTS? Their debt belongs in 1150 Sub-Agent
     * Receivable, not customer AR 1200 — mixing the two corrupts both ageing books.
     *
     * The SPA does not ask, it LOOKS UP the name in `tv_agents` (ledger.js
     * isAgentParty). This does the same, so a caller that simply posts a sale gets
     * the right control account without having to know the party is an agent — an
     * explicit `isAgent` flag still wins when the caller does know.
     * Falls back to false if the table is absent (a host without the travels
     * vendor-agent module), which is the safe side: customer AR, not agent AR.
     */
    private function isAgent(array $in): bool
    {
        if (array_key_exists('isAgent', $in)) {
            return $in['isAgent'] === true;
        }
        $name = trim((string) ($in['customer'] ?? ''));
        if ($name === '') {
            return false;
        }
        try {
            if (! Schema::hasTable('tv_agents')) {
                return false;
            }
            // agents are stored document-style: the display name lives in `data`
            return DB::table('tv_agents')
                ->where('data->name', $name)
                ->orWhere('ext_id', $name)
                ->exists();
        } catch (\Throwable $e) {
            return false;
        }
    }

    /**
     * The income head this sale credits — a BYTE-FOR-BYTE port of ledger.js's
     * incomeAccountFor(), keyword list and ORDER included. Revenue must land on the
     * same product line whichever side recorded the sale, or the per-product P&L and
     * every revenue-mix chart disagree with themselves.
     *
     * The order is load-bearing, not arbitrary: `air` is tested LAST because its
     * keyword list is the widest (it has to catch emd / reissue / void / bsp /
     * sector / pnr), so testing it first would swallow "air ticket for an Umrah
     * PACKAGE" into 4010 instead of 4030. My first draft did exactly that, and also
     * dropped emd/reissue/void — which would have posted every EMD and every void
     * reversal to 4000 Other Sales instead of 4010 Air Ticket Sales.
     *
     * One deliberate difference from the SPA: an explicitly-passed `incomeAccount`
     * that does not exist on the chart is REFUSED by record() rather than quietly
     * falling back to keyword-guessing. Silently ignoring an explicit instruction is
     * the worse failure for an API — the caller gets a clear 422 instead.
     */
    private function incomeAccountFor(array $in): string
    {
        $code = trim((string) ($in['incomeAccount'] ?? ''));
        if ($code !== '') {
            return $code;
        }
        $s = mb_strtolower((string) ($in['category'] ?? '') . ' ' . (string) ($in['desc'] ?? ''));
        $is = fn (string $re) => (bool) preg_match('/' . $re . '/u', $s);

        if ($is('visa')) return '4020';
        if ($is('package|tour|umrah|hajj|holiday')) return '4030';
        if ($is('hotel|room')) return '4040';
        if ($is('contract')) return '4050';          // contract flights & files — own P&L line
        if ($is('air|ticket|emd|reissue|re-issue|void|flight|bsp|sector|pnr')) return '4010';

        return '4000';
    }
}
