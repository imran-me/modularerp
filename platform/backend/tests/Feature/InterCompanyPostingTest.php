<?php

namespace Tests\Feature;

use App\Exceptions\LedgerException;
use App\Services\ExpensePostingService;
use App\Services\InterCompanyService;
use App\Services\LedgerService;
use Illuminate\Support\Facades\DB;
use Tests\Support\BuildsMoneySchema;
use Tests\TestCase;

/**
 * MONEY BETWEEN THE SISTER CONCERNS — both legs, every time.
 *
 *   php vendor/bin/phpunit --filter InterCompanyPostingTest
 *
 * The invariant under all of it: after ANY inter-company flow, each concern's own
 * books balance AND the group consolidation still balances, because 1300 and 2400
 * net to zero across the family. A flow that posts only one leg breaks that
 * permanently, which is why these tests check both sides and the group.
 */
class InterCompanyPostingTest extends TestCase
{
    use BuildsMoneySchema;

    private InterCompanyService $ic;
    private LedgerService $ledger;

    protected function setUp(): void
    {
        parent::setUp();
        $this->buildMoneySchema();
        $this->seedChart();
        $this->seedAccountsFor();
        $this->ic = $this->app->make(InterCompanyService::class);
        $this->ledger = $this->app->make(LedgerService::class);
    }

    /**
     * 1300 and 2400 must CANCEL across the whole family — the reason the group's
     * books balance at all. Both are measured Dr − Cr, so the receivable side comes
     * out positive and the payable side negative: they eliminate when they SUM to
     * zero. (Getting this backwards was my first draft — worth stating, because a
     * wrong invariant here would have hidden a genuinely unbalanced group.)
     */
    private function assertControlsEliminate(): void
    {
        $this->assertEqualsWithDelta(0, $this->netOn('1300') + $this->netOn('2400'), 0.01,
            '1300 and 2400 must net out across the concerns');
        $this->assertTrue($this->booksBalance());
    }

    /* ----------------------------------------------------------------- invoice */

    public function test_an_internal_invoice_posts_both_legs(): void
    {
        $out = $this->ic->invoice('travels', 'woodart', 250000, ['ref' => 'JOB-9', 'date' => '2026-07-27']);

        $this->assertSame(250000.0, $this->lineOn('GL-IC-JOB-9-travels', '1300', 'debit'));
        $this->assertSame(250000.0, $this->lineOn('GL-IC-JOB-9-travels', '4000', 'credit'));
        $this->assertSame(250000.0, $this->lineOn('GL-IC-JOB-9-woodart', '5000', 'debit'));
        $this->assertSame(250000.0, $this->lineOn('GL-IC-JOB-9-woodart', '2400', 'credit'));
        $this->assertSame('IC-JOB-9', $out['ref']);
        $this->assertControlsEliminate();
    }

    public function test_a_concern_cannot_invoice_itself(): void
    {
        $this->expectException(LedgerException::class);
        $this->ic->invoice('travels', 'travels', 1000);
    }

    /* ------------------------------------------------------------------ settle */

    /** Travels owes the Group (a funded expense), then pays it back from its bank. */
    public function test_settling_a_debt_clears_it_on_both_books(): void
    {
        // the Group's purse pays a Travels bill — ExpensePostingService raises the debt
        $this->app->make(ExpensePostingService::class)->record([
            'id' => 'JV-F1', 'companyId' => 'travels', 'amount' => 40000, 'head' => '5500',
            'category' => 'Office & Admin', 'fundedBy' => 'group', 'bankId' => '3',
        ]);
        $pos = $this->ic->positions('travels');
        $this->assertSame(40000.0, $pos['owes']['group']);
        $this->assertSame(40000.0, $this->ic->positions('group')['dueTo']['travels']);

        $out = $this->ic->settle('travels', 'group', 40000, 'pay',
            ['bankId' => '1', 'partyBankId' => '3', 'date' => '2026-07-28']);

        // our side: the payable goes, our bank pays
        $this->assertSame(40000.0, $this->lineOn('GL-' . $out['ref'] . '-travels', '2400', 'debit'));
        $this->assertSame(40000.0, $this->lineOn('GL-' . $out['ref'] . '-travels', '1010', 'credit'));
        // their side: their receivable goes, their bank receives
        $this->assertSame(40000.0, $this->lineOn('GL-' . $out['ref'] . '-group', '1010', 'debit'));
        $this->assertSame(40000.0, $this->lineOn('GL-' . $out['ref'] . '-group', '1300', 'credit'));

        $this->assertSame([], $this->ic->positions('travels')['owes']);          // nothing left
        $this->assertSame(0.0, $out['remaining']);
        $this->assertEquals(900000 - 40000, $this->balanceOf(1));               // our bank paid
        $this->assertEquals(5000000 - 40000 + 40000, $this->balanceOf(3));      // theirs: out then back
        $this->assertControlsEliminate();
    }

    public function test_it_refuses_to_settle_more_than_is_owed(): void
    {
        $this->app->make(ExpensePostingService::class)->record([
            'id' => 'JV-F2', 'companyId' => 'travels', 'amount' => 10000, 'head' => '5500',
            'category' => 'Office & Admin', 'fundedBy' => 'group', 'bankId' => '3',
        ]);

        $this->expectException(LedgerException::class);
        $this->ic->settle('travels', 'group', 25000, 'pay', ['bankId' => '1']);
    }

    public function test_it_refuses_to_settle_a_debt_that_does_not_exist(): void
    {
        $this->expectException(LedgerException::class);
        $this->ic->settle('travels', 'woodart', 100, 'pay', ['bankId' => '1']);
    }

    /** The other direction: someone pays US. */
    public function test_recording_a_receipt_from_a_concern_clears_the_receivable(): void
    {
        $this->ic->invoice('travels', 'woodart', 60000, ['ref' => 'JOB-7']);
        $this->assertSame(60000.0, $this->ic->positions('travels')['dueTo']['woodart']);

        $out = $this->ic->settle('travels', 'woodart', 60000, 'receive', ['bankId' => '1', 'partyBankId' => '4']);

        $this->assertSame(60000.0, $this->lineOn('GL-' . $out['ref'] . '-travels', '1010', 'debit'));
        $this->assertSame(60000.0, $this->lineOn('GL-' . $out['ref'] . '-travels', '1300', 'credit'));
        $this->assertSame(60000.0, $this->lineOn('GL-' . $out['ref'] . '-woodart', '2400', 'debit'));
        $this->assertEquals(900000 + 60000, $this->balanceOf(1));
        $this->assertEquals(700000 - 60000, $this->balanceOf(4));
        $this->assertSame([], $this->ic->positions('travels')['dueTo']);
        $this->assertControlsEliminate();
    }

    /** Partial settlement leaves the remainder on both books. */
    public function test_a_partial_settlement_leaves_the_rest_owing(): void
    {
        $this->ic->invoice('woodart', 'travels', 100000, ['ref' => 'JOB-6']);
        $out = $this->ic->settle('travels', 'woodart', 40000, 'pay', ['bankId' => '1']);

        $this->assertSame(60000.0, $out['remaining']);
        $this->assertSame(60000.0, $this->ic->positions('travels')['owes']['woodart']);
        $this->assertSame(60000.0, $this->ic->positions('woodart')['dueTo']['travels']);
        $this->assertControlsEliminate();
    }

    /* --------------------------------------------------------------- shareCost */

    public function test_a_shared_cost_splits_equally_and_the_payer_pays_it_all(): void
    {
        $out = $this->ic->shareCost([
            'amount' => 90000, 'paidBy' => 'group', 'among' => ['group', 'travels', 'woodart'],
            'head' => '5200', 'category' => 'Office Rent', 'bankId' => '3', 'date' => '2026-07-27',
        ]);

        $this->assertEquals([30000.0, 30000.0, 30000.0], array_values($out['shares']));
        // payer: own share + what it lent the others, and the FULL bill out of its bank
        $this->assertSame(30000.0, $this->lineOn('GL-' . $out['ref'] . '-group', '5200', 'debit'));
        $this->assertSame(60000.0, $this->lineOn('GL-' . $out['ref'] . '-group', '1300', 'debit'));
        $this->assertSame(90000.0, $this->lineOn('GL-' . $out['ref'] . '-group', '1010', 'credit'));
        // each other concern carries only its share, against what it now owes
        foreach (['travels', 'woodart'] as $c) {
            $this->assertSame(30000.0, $this->lineOn('GL-' . $out['ref'] . '-' . $c, '5200', 'debit'));
            $this->assertSame(30000.0, $this->lineOn('GL-' . $out['ref'] . '-' . $c, '2400', 'credit'));
        }
        // the payer's account lost the whole bill, ONCE
        $this->assertEquals(5000000 - 90000, $this->balanceOf(3));
        $this->assertSame(1, DB::table('bank_transactions')->where('reference', $out['ref'])->count());
        // …and every concern's register shows its share, flagged as an allocation
        $this->assertSame(3, DB::table('acc_entries')->where('ref', $out['ref'])->count());
        $this->assertSame(3, DB::table('acc_entries')->where('ref', $out['ref'])->where('alloc', true)->count());
        $this->assertControlsEliminate();
    }

    /** The shares must add back to the exact bill, cents and all. */
    public function test_an_odd_amount_splits_without_losing_a_paisa(): void
    {
        $out = $this->ic->shareCost([
            'amount' => 100, 'paidBy' => 'group', 'among' => ['group', 'travels', 'woodart'],
            'head' => '5200', 'category' => 'Rent', 'bankId' => '3',
        ]);

        $this->assertSame(100.0, round(array_sum($out['shares']), 2));
        $this->assertSame(33.34, $out['shares']['group']);      // remainder to the first
        $this->assertSame(33.33, $out['shares']['travels']);
        $this->assertSame(33.33, $out['shares']['woodart']);
        $this->assertControlsEliminate();
    }

    public function test_a_shared_cost_needs_at_least_two_concerns(): void
    {
        $this->expectException(LedgerException::class);
        $this->ic->shareCost(['amount' => 1000, 'paidBy' => 'group', 'among' => ['group'], 'head' => '5200']);
    }

    public function test_the_payer_must_be_one_of_the_sharers(): void
    {
        $this->expectException(LedgerException::class);
        $this->ic->shareCost([
            'amount' => 1000, 'paidBy' => 'it', 'among' => ['group', 'travels'], 'head' => '5200',
        ]);
    }

    /* -------------------------------------------------------------- positions */

    /** Several flows at once: the netting must still read correctly per counterparty. */
    public function test_positions_net_per_counterparty(): void
    {
        $this->ic->invoice('travels', 'woodart', 50000, ['ref' => 'A']);   // woodart owes travels
        $this->ic->invoice('woodart', 'travels', 20000, ['ref' => 'B']);   // travels owes woodart
        $this->ic->invoice('travels', 'it', 15000, ['ref' => 'C']);        // it owes travels

        $p = $this->ic->positions('travels');
        $this->assertSame(50000.0, $p['dueTo']['woodart']);
        $this->assertSame(15000.0, $p['dueTo']['it']);
        $this->assertSame(20000.0, $p['owes']['woodart']);
        $this->assertControlsEliminate();
    }
}
