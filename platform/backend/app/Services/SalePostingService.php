<?php

namespace App\Services;

use App\Exceptions\LedgerException;
use App\Support\CompanySlugs;
use Illuminate\Support\Facades\DB;
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
            : (($in['isAgent'] ?? false) === true ? self::AR_AGENT : self::AR_CUSTOMER);
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
                'revenue' => $revenue, 'cost' => $costJournal, 'register' => $moves,
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

    /** The income head this sale credits: an explicit code wins, else the category. */
    private function incomeAccountFor(array $in): string
    {
        $code = trim((string) ($in['incomeAccount'] ?? ''));
        if ($code !== '') {
            return $code;
        }
        $c = mb_strtolower((string) ($in['category'] ?? '') . ' ' . (string) ($in['desc'] ?? ''));
        if (preg_match('/air|ticket|gds|pnr/u', $c)) return '4010';
        if (preg_match('/visa/u', $c)) return '4020';
        if (preg_match('/package|tour|umrah|hajj/u', $c)) return '4030';
        if (preg_match('/hotel|room/u', $c)) return '4040';
        if (preg_match('/contract|charter|seat/u', $c)) return '4050';

        return '4000';
    }
}
