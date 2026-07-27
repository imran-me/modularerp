<?php

namespace Tests\Feature;

use App\Exceptions\LedgerException;
use App\Services\ReceiptPostingService;
use App\Services\SalePostingService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\Support\BuildsMoneySchema;
use Tests\TestCase;

/**
 * Selling something, and getting paid for it.
 *
 *   php vendor/bin/phpunit --filter SaleAndReceiptPostingTest
 *   (sqlite :memory: — if PHP says "could not find driver", run it once with
 *    `php -d extension=pdo_sqlite vendor/bin/phpunit`)
 *
 * These lock down the rules that were each a real bug at some point: VAT booked as
 * revenue, a sub-agent's debt landing in customer AR, a void leaving a phantom cost,
 * money "arriving" in a bank whose balance never moved, and an invoice marked paid
 * twice.
 */
class SaleAndReceiptPostingTest extends TestCase
{
    use BuildsMoneySchema;

    private SalePostingService $sales;
    private ReceiptPostingService $receipts;

    protected function setUp(): void
    {
        parent::setUp();
        $this->buildMoneySchema();
        $this->seedChart();
        $this->seedAccountsFor();
        $this->sales = $this->app->make(SalePostingService::class);
        $this->receipts = $this->app->make(ReceiptPostingService::class);
    }

    /* ------------------------------------------------------------------ sales */

    /** The everyday case: sell a ticket on credit, vendor not yet paid. */
    public function test_a_credit_sale_raises_a_receivable_and_a_payable(): void
    {
        $out = $this->sales->record([
            'ref' => 'TKT-1', 'companyId' => 'travels', 'amount' => 100000, 'cost' => 70000,
            'category' => 'air', 'customer' => 'Mr Rahman', 'vendor' => 'Emirates', 'date' => '2026-07-26',
        ]);

        $this->assertSame('4010', $out['revenue']['lines'][1]['account']);   // air ticket income
        $this->assertSame('Air Ticket', $out['product']);
        $this->assertSame(100000.0, $this->lineOn('GL-STKT-1', '1200', 'debit'));
        $this->assertSame(100000.0, $this->lineOn('GL-STKT-1', '4010', 'credit'));
        $this->assertSame(70000.0, $this->lineOn('GL-SCTKT-1', '5000', 'debit'));
        $this->assertSame(70000.0, $this->lineOn('GL-SCTKT-1', '2000', 'credit'));
        $this->assertTrue($this->booksBalance());
        // nothing touched any real account yet
        $this->assertEquals(900000, $this->balanceOf(1));
        $this->assertSame(0, DB::table('bank_transactions')->count());
    }

    /** Paid at the till, into a NAMED account — the ledger and the account agree. */
    public function test_a_paid_sale_lands_in_the_named_account(): void
    {
        $this->sales->record([
            'ref' => 'TKT-2', 'companyId' => 'travels', 'amount' => 45000, 'cost' => 30000,
            'category' => 'air', 'paid' => true, 'bankId' => '1',
            'costPaid' => true, 'costBankId' => '2',          // vendor paid from the cash box
        ]);

        $this->assertSame(45000.0, $this->lineOn('GL-STKT-2', '1010', 'debit'));
        $this->assertSame(0.0, $this->lineOn('GL-STKT-2', '1200', 'debit'));      // never a receivable
        $this->assertSame(30000.0, $this->lineOn('GL-SCTKT-2', '1000', 'credit')); // cash box IS 1000
        $this->assertEquals(900000 + 45000, $this->balanceOf(1));
        $this->assertEquals(40000 - 30000, $this->balanceOf(2));
        $rows = DB::table('bank_transactions')->orderBy('id')->pluck('type')->all();
        $this->assertSame(['deposit', 'withdraw'], $rows);
        $this->assertTrue($this->booksBalance());
    }

    /** VAT is money owed to the NBR, not revenue. */
    public function test_vat_is_split_out_of_revenue(): void
    {
        $this->sales->record([
            'ref' => 'TKT-3', 'companyId' => 'travels', 'amount' => 11500, 'vat' => 1500,
            'cost' => 0, 'category' => 'visa', 'paid' => true, 'bankId' => '1',
        ]);

        $this->assertSame(11500.0, $this->lineOn('GL-STKT-3', '1010', 'debit'));
        $this->assertSame(10000.0, $this->lineOn('GL-STKT-3', '4020', 'credit'));   // net only
        $this->assertSame(1500.0, $this->lineOn('GL-STKT-3', '2130', 'credit'));    // the tax
        $this->assertTrue($this->booksBalance());
    }

    /** A sub-agent's debt belongs in 1150, not customer AR. */
    public function test_a_sub_agent_sale_uses_the_agent_receivable(): void
    {
        $this->sales->record([
            'ref' => 'TKT-4', 'companyId' => 'travels', 'amount' => 20000, 'cost' => 0,
            'category' => 'air', 'customer' => 'Sky Travels', 'isAgent' => true,
        ]);

        $this->assertSame(20000.0, $this->lineOn('GL-STKT-4', '1150', 'debit'));
        $this->assertSame(0.0, $this->lineOn('GL-STKT-4', '1200', 'debit'));
    }

    /**
     * …and the caller should not have to KNOW. The SPA looks the buyer up in
     * `tv_agents` (ledger.js isAgentParty), so a module that just posts a sale still
     * gets 1150. This does the same lookup — without it, every sub-agent sale posted
     * through the API would have quietly landed in customer AR and corrupted both
     * ageing books.
     */
    public function test_a_known_sub_agent_is_detected_without_being_told(): void
    {
        Schema::create('tv_agents', function ($t) {
            $t->id();
            $t->string('ext_id')->nullable();
            $t->string('company_id')->nullable();
            $t->string('status')->nullable();
            $t->json('data')->nullable();
            $t->timestamps();
        });
        DB::table('tv_agents')->insert(['ext_id' => 'AG-1', 'company_id' => 'travels',
            'data' => json_encode(['id' => 'AG-1', 'name' => 'Sky Travels'])]);

        // no isAgent flag passed — the name alone must be enough
        $this->sales->record(['ref' => 'TKT-4B', 'companyId' => 'travels', 'amount' => 8000,
            'cost' => 0, 'category' => 'air', 'customer' => 'Sky Travels']);
        $this->assertSame(8000.0, $this->lineOn('GL-STKT-4B', '1150', 'debit'));

        // a plain customer still goes to 1200
        $this->sales->record(['ref' => 'TKT-4C', 'companyId' => 'travels', 'amount' => 5000,
            'cost' => 0, 'category' => 'air', 'customer' => 'Mr Rahman']);
        $this->assertSame(5000.0, $this->lineOn('GL-STKT-4C', '1200', 'debit'));

        // an explicit flag still overrides the lookup
        $this->sales->record(['ref' => 'TKT-4D', 'companyId' => 'travels', 'amount' => 3000,
            'cost' => 0, 'category' => 'air', 'customer' => 'Sky Travels', 'isAgent' => false]);
        $this->assertSame(3000.0, $this->lineOn('GL-STKT-4D', '1200', 'debit'));

        Schema::dropIfExists('tv_agents');
    }

    /** No agents table (a host without the vendor-agent module) → customer AR, not a crash. */
    public function test_it_falls_back_to_customer_ar_when_there_is_no_agents_table(): void
    {
        Schema::dropIfExists('tv_agents');

        $this->sales->record(['ref' => 'TKT-4E', 'companyId' => 'travels', 'amount' => 1000,
            'cost' => 0, 'category' => 'air', 'customer' => 'Sky Travels']);

        $this->assertSame(1000.0, $this->lineOn('GL-STKT-4E', '1200', 'debit'));
    }

    /** A void/refund carries a NEGATIVE cost — the cost leg must still reverse. */
    public function test_a_negative_cost_still_posts(): void
    {
        $this->sales->record([
            'ref' => 'TKT-5-VOID', 'companyId' => 'travels', 'amount' => -50000, 'cost' => -35000,
            'category' => 'air',
        ]);

        $this->assertSame(-35000.0, $this->lineOn('GL-SCTKT-5-VOID', '5000', 'debit'));
        $this->assertSame(-35000.0, $this->lineOn('GL-SCTKT-5-VOID', '2000', 'credit'));
        $this->assertTrue($this->booksBalance());
    }

    /**
     * The income head is chosen by the SAME mapper as the SPA's ledger.js, ORDER
     * included — revenue has to land on the same product line whichever side
     * recorded the sale, or the per-product P&L disagrees with itself.
     *
     * Every case here failed before the mapper was ported faithfully (2026-07-27):
     * `air` was being tested FIRST and emd/reissue/void/flight/bsp/sector were
     * missing, so every EMD and every void reversal credited 4000 Other Sales
     * instead of 4010 Air Ticket Sales, and an air ticket sold as part of an Umrah
     * PACKAGE was booked as a ticket rather than a package.
     */
    public function test_the_income_head_matches_the_frontend_mapper(): void
    {
        $cases = [
            'EMD-1'  => ['desc' => 'EMD Excess baggage · Mr Rahman', 'category' => 'emd',      'head' => '4010'],
            'VOID-1' => ['desc' => 'Void reversal DAC → DXB (EK)',   'category' => 'air',      'head' => '4010'],
            'REIS-1' => ['desc' => 'Reissue DAC → JED (SV)',         'category' => 'air',      'head' => '4010'],
            'BSP-1'  => ['desc' => 'BSP settlement adjustment',      'category' => '',         'head' => '4010'],
            'PKG-1'  => ['desc' => 'Air ticket for Umrah package',   'category' => 'air',      'head' => '4030'],
            'VISA-1' => ['desc' => 'Visa air ticket bundle',         'category' => 'visa',     'head' => '4020'],
            'HOT-1'  => ['desc' => 'Hotel booking Radisson',         'category' => '',         'head' => '4040'],
            'CON-1'  => ['desc' => 'Contract seats DAC → DXB (12×)', 'category' => 'contract', 'head' => '4050'],
            'OTH-1'  => ['desc' => 'Consultancy fee',                'category' => '',         'head' => '4000'],
        ];

        foreach ($cases as $ref => $c) {
            $this->sales->record(['ref' => $ref, 'companyId' => 'travels', 'amount' => 1000,
                'cost' => 0, 'category' => $c['category'], 'desc' => $c['desc']]);
            $this->assertSame(1000.0, $this->lineOn('GL-S' . $ref, $c['head'], 'credit'),
                $c['desc'] . ' should credit ' . $c['head']);
        }
        $this->assertTrue($this->booksBalance());
    }

    public function test_re_posting_a_sale_does_not_double_count(): void
    {
        $p = ['ref' => 'TKT-6', 'companyId' => 'travels', 'amount' => 10000, 'cost' => 6000, 'category' => 'air'];
        $this->sales->record($p);
        $this->sales->record($p);

        $this->assertSame(10000.0, $this->netOn('4010') * -1);          // income is credit-normal
        $this->assertSame(1, DB::table('journal_entries')->where('reference', 'GL-STKT-6')->count());
    }

    public function test_voiding_a_sale_reverses_both_journals_and_the_account(): void
    {
        $this->sales->record([
            'ref' => 'TKT-7', 'companyId' => 'travels', 'amount' => 25000, 'cost' => 15000,
            'category' => 'air', 'paid' => true, 'bankId' => '1', 'costPaid' => true,
        ]);
        $this->assertEquals(900000 + 25000 - 15000, $this->balanceOf(1));

        $out = $this->sales->void('TKT-7', 'test');

        $this->assertCount(2, $out['reversals']);
        $this->assertSame(0.0, $this->netOn('4010'));                    // revenue nets to zero
        $this->assertSame(0.0, $this->netOn('5000'));                    // so does the cost
        $this->assertEquals(900000, $this->balanceOf(1));                // and the account is whole
        $this->assertTrue($this->booksBalance());
    }

    public function test_it_refuses_an_account_belonging_to_another_concern(): void
    {
        $this->expectException(LedgerException::class);
        $this->sales->record([
            'ref' => 'TKT-8', 'companyId' => 'travels', 'amount' => 1000, 'cost' => 0,
            'category' => 'air', 'paid' => true, 'bankId' => '4',        // Woodart's bank
        ]);
    }

    /* --------------------------------------------------------------- receipts */

    public function test_a_receipt_clears_the_receivable_and_fills_the_account(): void
    {
        $this->sales->record(['ref' => 'TKT-9', 'companyId' => 'travels', 'amount' => 80000,
            'cost' => 0, 'category' => 'air', 'customer' => 'Mr Rahman']);
        $this->assertSame(80000.0, $this->receipts->outstanding('TKT-9'));

        $out = $this->receipts->record(['ref' => 'TKT-9', 'companyId' => 'travels',
            'amount' => 80000, 'bankId' => '1', 'party' => 'Mr Rahman', 'date' => '2026-07-27']);

        $this->assertSame('1200', $out['arAccount']);
        $this->assertSame(0.0, $out['outstanding']);
        $this->assertSame(80000.0, $this->lineOn('GL-SET-TKT-9', '1010', 'debit'));
        $this->assertSame(80000.0, $this->lineOn('GL-SET-TKT-9', '1200', 'credit'));
        $this->assertSame(0.0, $this->netOn('1200'));                    // the debt is gone
        $this->assertEquals(900000 + 80000, $this->balanceOf(1));
        $this->assertSame('deposit', DB::table('bank_transactions')->value('type'));
        $this->assertTrue($this->booksBalance());
    }

    /** A cash-box receipt is HARD CASH — 1000, not Bank. */
    public function test_a_cash_box_receipt_hits_hard_cash(): void
    {
        $this->sales->record(['ref' => 'TKT-10', 'companyId' => 'travels', 'amount' => 5000,
            'cost' => 0, 'category' => 'air']);
        $this->receipts->record(['ref' => 'TKT-10', 'companyId' => 'travels', 'amount' => 5000, 'bankId' => '2']);

        $this->assertSame(5000.0, $this->lineOn('GL-SET-TKT-10', '1000', 'debit'));
        $this->assertEquals(40000 + 5000, $this->balanceOf(2));
    }

    /** It settles the SAME control account the sale raised — a sub-agent's debt
     *  can never be cleared out of the customer AR book. */
    public function test_it_settles_the_account_the_sale_debited(): void
    {
        $this->sales->record(['ref' => 'TKT-11', 'companyId' => 'travels', 'amount' => 9000,
            'cost' => 0, 'category' => 'air', 'isAgent' => true]);
        $out = $this->receipts->record(['ref' => 'TKT-11', 'companyId' => 'travels', 'amount' => 9000, 'bankId' => '1']);

        $this->assertSame('1150', $out['arAccount']);
        $this->assertSame(9000.0, $this->lineOn('GL-SET-TKT-11', '1150', 'credit'));
        $this->assertSame(0.0, $this->lineOn('GL-SET-TKT-11', '1200', 'credit'));
    }

    public function test_partial_receipts_each_get_their_own_journal(): void
    {
        $this->sales->record(['ref' => 'TKT-12', 'companyId' => 'travels', 'amount' => 100000,
            'cost' => 0, 'category' => 'air']);

        $a = $this->receipts->record(['ref' => 'TKT-12', 'companyId' => 'travels', 'amount' => 40000, 'bankId' => '1']);
        $b = $this->receipts->record(['ref' => 'TKT-12', 'companyId' => 'travels', 'amount' => 60000, 'bankId' => '1']);

        $this->assertSame(60000.0, $a['outstanding']);
        $this->assertSame(0.0, $b['outstanding']);
        $this->assertSame(40000.0, $this->lineOn('GL-SET-TKT-12', '1010', 'debit'));
        $this->assertSame(60000.0, $this->lineOn('GL-SET-TKT-12-2', '1010', 'debit'));
        $this->assertEquals(900000 + 100000, $this->balanceOf(1));
        $this->assertSame(0.0, $this->netOn('1200'));
    }

    public function test_it_refuses_to_over_settle(): void
    {
        $this->sales->record(['ref' => 'TKT-13', 'companyId' => 'travels', 'amount' => 1000,
            'cost' => 0, 'category' => 'air']);
        $this->receipts->record(['ref' => 'TKT-13', 'companyId' => 'travels', 'amount' => 900, 'bankId' => '1']);

        $this->expectException(LedgerException::class);
        $this->receipts->record(['ref' => 'TKT-13', 'companyId' => 'travels', 'amount' => 200, 'bankId' => '1']);
    }

    /** A sale already paid at the till raised no receivable — settling it again
     *  would invent cash the business never received. */
    public function test_it_refuses_to_settle_a_cash_sale(): void
    {
        $this->sales->record(['ref' => 'TKT-14', 'companyId' => 'travels', 'amount' => 7000,
            'cost' => 0, 'category' => 'air', 'paid' => true, 'bankId' => '1']);

        $this->expectException(LedgerException::class);
        $this->receipts->record(['ref' => 'TKT-14', 'companyId' => 'travels', 'amount' => 7000, 'bankId' => '1']);
    }

    public function test_it_refuses_a_receipt_for_an_unposted_sale(): void
    {
        $this->expectException(LedgerException::class);
        $this->receipts->record(['ref' => 'NOPE-1', 'companyId' => 'travels', 'amount' => 100, 'bankId' => '1']);
    }

    /** Wrongly marked paid: reversing brings the receivable BACK and empties the
     *  account again — and the sale becomes payable once more. */
    public function test_reversing_a_receipt_restores_the_debt_and_allows_re_payment(): void
    {
        $this->sales->record(['ref' => 'TKT-15', 'companyId' => 'travels', 'amount' => 30000,
            'cost' => 0, 'category' => 'air']);
        $this->receipts->record(['ref' => 'TKT-15', 'companyId' => 'travels', 'amount' => 30000, 'bankId' => '1']);
        $this->assertSame(0.0, $this->netOn('1200'));

        $this->receipts->reverse('TKT-15', 'marked paid by mistake');

        $this->assertSame(30000.0, $this->netOn('1200'));                // the debt is back
        $this->assertEquals(900000, $this->balanceOf(1));                // the money is not ours
        $this->assertSame(30000.0, $this->receipts->outstanding('TKT-15'));
        $this->assertTrue($this->booksBalance());

        // …and it can be paid again, into a different account this time
        $again = $this->receipts->record(['ref' => 'TKT-15', 'companyId' => 'travels', 'amount' => 30000, 'bankId' => '2']);
        $this->assertSame(0.0, $again['outstanding']);
        $this->assertEquals(40000 + 30000, $this->balanceOf(2));
    }

    /** Two sales whose refs share a prefix must not settle each other. */
    public function test_a_ref_prefix_cannot_settle_the_wrong_sale(): void
    {
        $this->sales->record(['ref' => 'T-1', 'companyId' => 'travels', 'amount' => 1000, 'cost' => 0, 'category' => 'air']);
        $this->sales->record(['ref' => 'T-12', 'companyId' => 'travels', 'amount' => 2000, 'cost' => 0, 'category' => 'air']);

        $this->receipts->record(['ref' => 'T-1', 'companyId' => 'travels', 'amount' => 1000, 'bankId' => '1']);

        $this->assertSame(0.0, $this->receipts->outstanding('T-1'));
        $this->assertSame(2000.0, $this->receipts->outstanding('T-12'));   // untouched
    }
}
