<?php

namespace Tests\Feature;

use App\Exceptions\LedgerException;
use App\Services\LedgerService;
use Illuminate\Support\Facades\DB;
use Tests\Support\BuildsMoneySchema;
use Tests\TestCase;

/**
 * THE LEDGER'S OWN RULES — the invariants every posting path depends on.
 * Everything else (expenses, sales, receipts, consolidation) is only as correct as
 * this class, so its rules get tested directly rather than through a caller.
 *
 *   php vendor/bin/phpunit --filter LedgerServiceTest
 */
class LedgerServiceTest extends TestCase
{
    use BuildsMoneySchema;

    private LedgerService $ledger;

    protected function setUp(): void
    {
        parent::setUp();
        $this->buildMoneySchema();
        $this->seedChart();
        $this->ledger = $this->app->make(LedgerService::class);
    }

    private function entry(array $lines, array $over = []): array
    {
        return $this->ledger->post(array_merge([
            'id' => 'GL-T1', 'date' => '2026-07-27', 'companyId' => 'travels',
            'ref' => 'T1', 'memo' => 'test', 'source' => 'manual', 'lines' => $lines,
        ], $over));
    }

    public function test_a_balanced_entry_posts(): void
    {
        $this->entry([
            ['account' => '5550', 'dr' => 1000, 'cr' => 0],
            ['account' => '1010', 'dr' => 0, 'cr' => 1000],
        ]);

        $this->assertSame(1000.0, $this->lineOn('GL-T1', '5550', 'debit'));
        $this->assertTrue($this->booksBalance());
    }

    public function test_an_unbalanced_entry_is_refused(): void
    {
        $this->expectException(LedgerException::class);
        $this->entry([
            ['account' => '5550', 'dr' => 1000, 'cr' => 0],
            ['account' => '1010', 'dr' => 0, 'cr' => 900],
        ]);
    }

    /**
     * A VOID/REFUND negates both sides — balanced, and legitimate. The old rule
     * ("there must be a debit", i.e. Dr > 0) rejected exactly this, so every void
     * the SPA mirrored came back 422 and the reversal never reached the database:
     * the browser showed it reversed while the books still carried the revenue.
     */
    public function test_a_balanced_negative_entry_posts_because_that_is_a_void(): void
    {
        $this->entry([
            ['account' => '4010', 'dr' => -5000, 'cr' => 0],
            ['account' => '1200', 'dr' => 0, 'cr' => -5000],
        ]);

        $this->assertSame(-5000.0, $this->lineOn('GL-T1', '4010', 'debit'));
        $this->assertTrue($this->booksBalance());
    }

    public function test_an_entry_worth_nothing_is_refused(): void
    {
        $this->expectException(LedgerException::class);
        $this->entry([
            ['account' => '5550', 'dr' => 0, 'cr' => 0],
            ['account' => '1010', 'dr' => 0, 'cr' => 0],
        ]);
    }

    public function test_a_single_line_entry_is_refused(): void
    {
        $this->expectException(LedgerException::class);
        $this->entry([['account' => '5550', 'dr' => 1000, 'cr' => 0]]);
    }

    /**
     * THE LIVE FAILURE, 2026-07-27. Recording a Conveyance expense on
     * dev.epal.com.bd answered "Save failed: Unknown account code: 5600" and the
     * register went empty. The SPA tops its own chart up at boot
     * (ensureExtraAccounts) but the imported production `accounts` table never had
     * 5500/5550/5600/5800/5350/4050/2130/2140 — so the browser could post to a head
     * the API would refuse. A code on the STANDARD chart is now topped up instead.
     */
    public function test_a_missing_standard_head_is_topped_up_instead_of_refused(): void
    {
        DB::table('accounts')->where('code', '5600')->delete();      // as production was
        $this->assertSame(0, DB::table('accounts')->where('code', '5600')->count());

        $this->entry([
            ['account' => '5600', 'dr' => 800, 'cr' => 0],
            ['account' => '1010', 'dr' => 0, 'cr' => 800],
        ]);

        // the head now exists, correctly typed, and the posting went through
        $head = DB::table('accounts')->where('code', '5600')->first();
        $this->assertNotNull($head);
        $this->assertSame('Conveyance & Travel', $head->name);
        $this->assertSame('expense', $head->type);
        $this->assertSame(800.0, $this->lineOn('GL-T1', '5600', 'debit'));
        $this->assertTrue($this->booksBalance());
    }

    /** …but a code that is NOT on the standard chart must still be refused: a typo
     *  must not quietly invent an account. */
    public function test_a_non_standard_code_is_still_refused(): void
    {
        try {
            $this->entry([
                ['account' => '7777', 'dr' => 100, 'cr' => 0],
                ['account' => '1010', 'dr' => 0, 'cr' => 100],
            ]);
            $this->fail('expected a LedgerException');
        } catch (LedgerException $e) {
            $this->assertStringContainsString('7777', $e->getMessage());
        }
        $this->assertSame(0, DB::table('accounts')->where('code', '7777')->count());
    }

    public function test_an_unknown_account_code_is_refused_before_anything_is_written(): void
    {
        try {
            $this->entry([
                ['account' => '9999', 'dr' => 100, 'cr' => 0],
                ['account' => '1010', 'dr' => 0, 'cr' => 100],
            ]);
            $this->fail('expected a LedgerException');
        } catch (LedgerException $e) {
            $this->assertStringContainsString('9999', $e->getMessage());
        }
        // nothing half-written
        $this->assertSame(0, DB::table('journal_entries')->count());
        $this->assertSame(0, DB::table('journal_items')->count());
    }

    /** Re-posting the same stable id UPDATES in place — never a second entry. */
    public function test_re_posting_the_same_id_updates_in_place(): void
    {
        $this->entry([
            ['account' => '5550', 'dr' => 1000, 'cr' => 0],
            ['account' => '1010', 'dr' => 0, 'cr' => 1000],
        ]);
        $this->entry([
            ['account' => '5550', 'dr' => 1400, 'cr' => 0],
            ['account' => '1010', 'dr' => 0, 'cr' => 1400],
        ]);

        $this->assertSame(1, DB::table('journal_entries')->whereNull('deleted_at')->count());
        $this->assertSame(1400.0, $this->lineOn('GL-T1', '5550', 'debit'));   // not 2,400
        $this->assertSame(1400.0, $this->netOn('5550'));
    }

    /** A reversal is a NEW entry; the original stays. That pair IS the audit trail. */
    public function test_reverse_posts_the_mirror_and_keeps_the_original(): void
    {
        $this->entry([
            ['account' => '5550', 'dr' => 1000, 'cr' => 0],
            ['account' => '1010', 'dr' => 0, 'cr' => 1000],
        ]);

        $rev = $this->ledger->reverse('GL-T1', 'because');

        $this->assertNotNull($rev);
        $this->assertSame(1000.0, $this->lineOn('GL-T1', '5550', 'debit'));          // original intact
        $this->assertSame(1000.0, $this->lineOn('GL-REV-GL-T1', '5550', 'credit'));  // mirrored
        $this->assertSame(0.0, $this->netOn('5550'));                                // nets to zero
        $this->assertStringContainsString('because', (string) DB::table('journal_entries')
            ->where('reference', 'GL-REV-GL-T1')->value('description'));
        $this->assertTrue($this->booksBalance());
    }

    public function test_reversing_something_that_was_never_posted_returns_null(): void
    {
        $this->assertNull($this->ledger->reverse('GL-NOPE', 'x'));
    }

    /** A company-scoped caller cannot post onto another concern's books. */
    public function test_a_scoped_caller_is_forced_to_its_own_company(): void
    {
        $this->ledger->post([
            'id' => 'GL-T2', 'date' => '2026-07-27', 'companyId' => 'woodart',   // asks for woodart
            'ref' => 'T2', 'memo' => 'test', 'source' => 'manual',
            'lines' => [
                ['account' => '5550', 'dr' => 500, 'cr' => 0],
                ['account' => '1010', 'dr' => 0, 'cr' => 500],
            ],
        ], 2);                                                                    // scoped to travels

        $this->assertSame(2, (int) DB::table('journal_entries')->where('reference', 'GL-T2')->value('company_id'));
    }

    /**
     * The head mapper must stay IDENTICAL to the SPA's ledger.js expenseAccountFor()
     * — the same wording has to classify the same way whichever side recorded it,
     * or the P&L reads differently depending on where the spend was typed.
     *
     * The two patterns fixed on 2026-07-27 are pinned here so neither side can drift:
     *   · 'Tea / Coffee (Guest)' → 5550, NOT 6000. Unbounded `fee` matched "cof-FEE",
     *     so tea for a guest used to classify as BANK CHARGES.
     *   · 'Facebook / Google Ads' → 5400, NOT 5800. `ad\b` never matched the plural.
     * Still asserted as-is because both sides genuinely do it: 'Staff · Welfare Tea'
     * → 5100, because `staff` is tested before `tea`. Harmless — every capture form
     * PINS its head; the mapper is only the free-text fallback.
     */
    public function test_the_expense_head_mapper_matches_the_frontend(): void
    {
        foreach ([
            'Office Rent' => '5200', 'Staff Salary' => '5100', 'Electricity bill' => '5300',
            'Marketing campaign' => '5400', 'Boosting' => '5400',
            'Bank Charge' => '6000', 'Trade License' => '6000', 'IATA / GDS Fee' => '6000',
            'ADM / Penalty' => '5900', 'Stationery' => '5500', 'Fuel' => '5600',
            'something else entirely' => '5800',
            // the 2026-07-27 fixes — a regression here means the P&L moves
            'Tea / Coffee (Guest)' => '5550',
            'Tea & Coffee' => '5550',
            'Facebook / Google Ads' => '5400',
            // known ordering quirk, kept identical on both sides
            'Staff · Welfare Tea & Coffee' => '5100',
        ] as $text => $code) {
            $this->assertSame($code, $this->ledger->expenseAccountFor($text), $text);
        }
    }
}
