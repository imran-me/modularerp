<?php

namespace Tests\Feature;

use App\Exceptions\LedgerException;
use App\Services\ExpensePostingService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * Recording an expense must land in EVERY book at once (owner 2026-07-26):
 * the concern's register, the general ledger, and the paying account's own
 * balance + history — and an inter-company spend must move the FUNDER's money
 * while leaving us owing them. These tests are the contract.
 *
 *   php vendor/bin/phpunit --filter ExpensePostingTest
 *
 * (phpunit.xml runs on sqlite :memory:. If PHP reports "could not find driver",
 * the sqlite PDO driver is off in your php.ini — either uncomment
 * `extension=pdo_sqlite` there, or run it once with
 * `php -d extension=pdo_sqlite vendor/bin/phpunit`.)
 *
 * The four legacy tables (accounts / banks / journal_entries / journal_items)
 * predate this repo's migrations — they live in the production schema — so the
 * fixture below creates just the columns the posting path touches. acc_entries
 * and bank_transactions are created here with the same columns their real
 * migrations produce, so the assertions match production exactly.
 */
class ExpensePostingTest extends TestCase
{
    private ExpensePostingService $expenses;

    protected function setUp(): void
    {
        parent::setUp();
        $this->buildSchema();
        $this->seedChartAndAccounts();
        $this->expenses = $this->app->make(ExpensePostingService::class);
    }

    /** Tea for a guest, paid from the Travels bank account. */
    public function test_it_writes_the_register_the_ledger_and_the_account(): void
    {
        $out = $this->expenses->record([
            'id'          => 'JV-TEA001',
            'companyId'   => 'travels',
            'amount'      => 1250,
            'head'        => '5550',
            'category'    => 'Guest & Entertainment',
            'subCategory' => 'Tea / Coffee (Guest)',
            'bankId'      => '1',                       // City Bank (Travels)
            'method'      => 'Bank',
            'party'       => 'Star Kabab',
            'date'        => '2026-07-26',
            'ref'         => 'BR-118',
        ]);

        // 1 · the register row the Expenses screen lists
        $row = DB::table('acc_entries')->where('ext_id', 'JV-TEA001')->first();
        $this->assertNotNull($row);
        $this->assertSame('travels', $row->company_id);
        $this->assertSame('Expense', $row->kind);
        $this->assertEquals(1250, (float) $row->amount);
        $this->assertSame('5550', $row->head);
        $this->assertSame('Tea / Coffee (Guest)', $row->sub_category);
        $this->assertSame('1', $row->bank_id);          // WHICH account paid
        $this->assertSame('1010', $row->pay_acct);      // and the GL side it credited

        // 2 · the double entry every report reads: DR 5550 / CR 1010
        $this->assertSame(1250.0, $this->lineOn('GL-ACC-JV-TEA001', '5550', 'debit'));
        $this->assertSame(1250.0, $this->lineOn('GL-ACC-JV-TEA001', '1010', 'credit'));
        $this->assertTrue($this->balances('GL-ACC-JV-TEA001'));

        // 3 · the account: balance down + one withdrawal row in its history
        $this->assertEquals(900000 - 1250, $this->balanceOf(1));
        $txn = DB::table('bank_transactions')->where('entry_ref', 'JV-TEA001')->first();
        $this->assertNotNull($txn);
        $this->assertSame('withdraw', $txn->type);
        $this->assertEquals(1250, (float) $txn->amount);
        $this->assertSame('Guest & Entertainment · Tea / Coffee (Guest) — Star Kabab', $txn->description);
        $this->assertSame(1250.0, $out['register']['amount']);
    }

    /** A cash box is hard cash: it credits 1000, not 1010. */
    public function test_a_cash_box_credits_hard_cash(): void
    {
        $this->expenses->record([
            'id' => 'JV-CASH01', 'companyId' => 'travels', 'amount' => 500,
            'head' => '5600', 'category' => 'Conveyance & Travel', 'bankId' => '2',
        ]);

        $this->assertSame(500.0, $this->lineOn('GL-ACC-JV-CASH01', '1000', 'credit'));
        $this->assertSame('1000', DB::table('acc_entries')->where('ext_id', 'JV-CASH01')->value('pay_acct'));
        $this->assertEquals(40000 - 500, $this->balanceOf(2));
    }

    /** Funded by the Group: the expense is ours, the cash is theirs, we owe them. */
    public function test_an_inter_company_spend_moves_the_funders_money(): void
    {
        $this->expenses->record([
            'id' => 'JV-ICO001', 'companyId' => 'travels', 'amount' => 3000,
            'head' => '5500', 'category' => 'Office & Admin',
            'bankId' => '3',                    // Group HQ Current
            'fundedBy' => 'group',
        ]);

        // ours: the expense against an inter-company PAYABLE, not against our cash
        $this->assertSame(3000.0, $this->lineOn('GL-ACC-JV-ICO001', '5500', 'debit'));
        $this->assertSame(3000.0, $this->lineOn('GL-ACC-JV-ICO001', '2400', 'credit'));
        $this->assertSame(0.0, $this->lineOn('GL-ACC-JV-ICO001', '1010', 'credit'));

        // theirs: an inter-company RECEIVABLE, and their account is the one that moves
        $this->assertSame(3000.0, $this->lineOn('GL-ACF-JV-ICO001', '1300', 'debit'));
        $this->assertSame(3000.0, $this->lineOn('GL-ACF-JV-ICO001', '1010', 'credit'));
        $this->assertEquals(5000000 - 3000, $this->balanceOf(3));
        $this->assertEquals(900000, $this->balanceOf(1));          // ours untouched

        // and each leg is on the right company's books
        $this->assertSame(2, (int) $this->entry('GL-ACC-JV-ICO001')->company_id);   // travels
        $this->assertSame(4, (int) $this->entry('GL-ACF-JV-ICO001')->company_id);   // group
    }

    /** An account may only be spent from by the concern that owns it. */
    public function test_it_refuses_another_concerns_account(): void
    {
        $this->expectException(LedgerException::class);
        $this->expenses->record([
            'companyId' => 'travels', 'amount' => 100, 'head' => '5500',
            'category' => 'Office & Admin', 'bankId' => '3',       // a GROUP account, own funds
        ]);
    }

    public function test_it_refuses_an_unknown_head(): void
    {
        $this->expectException(LedgerException::class);
        $this->expenses->record([
            'companyId' => 'travels', 'amount' => 100, 'head' => '9999', 'category' => 'Nope',
        ]);
    }

    /**
     * With no head given, the wording decides — the SAME mapping as the SPA's
     * ledger.js expenseAccountFor(), keyword order included. That order is also
     * why the categorised form PINS the head instead of trusting the wording:
     * "Staff · Welfare / Tea & Coffee" hits `staff` before `tea` and lands on
     * 5100 Salaries. Faithful to the frontend is the contract here — a caller
     * that knows the code must send it.
     */
    public function test_it_maps_the_head_from_the_wording(): void
    {
        $this->expenses->record([
            'id' => 'JV-MAP001', 'companyId' => 'travels', 'amount' => 200,
            'category' => 'Conveyance & Travel', 'subCategory' => 'Fuel', 'bankId' => '1',
        ]);
        $this->assertSame('5600', DB::table('acc_entries')->where('ext_id', 'JV-MAP001')->value('head'));

        $this->expenses->record([
            'id' => 'JV-MAP002', 'companyId' => 'travels', 'amount' => 200,
            'category' => 'Staff · Welfare', 'subCategory' => 'Tea & Coffee', 'bankId' => '1',
        ]);
        $this->assertSame('5100', DB::table('acc_entries')->where('ext_id', 'JV-MAP002')->value('head'));
    }

    /** Re-posting the same voucher UPDATES it — the register and the GL never double up. */
    public function test_re_posting_the_same_voucher_does_not_duplicate(): void
    {
        $payload = ['id' => 'JV-DUP001', 'companyId' => 'travels', 'amount' => 700,
            'head' => '5400', 'category' => 'Marketing', 'bankId' => '1'];
        $this->expenses->record($payload);
        $this->expenses->record($payload);

        $this->assertSame(1, DB::table('acc_entries')->where('ext_id', 'JV-DUP001')->count());
        $this->assertSame(1, DB::table('journal_entries')->where('reference', 'GL-ACC-JV-DUP001')->whereNull('deleted_at')->count());
        $this->assertSame(700.0, $this->lineOn('GL-ACC-JV-DUP001', '5400', 'debit'));   // not 1,400
    }

    /** Voiding: register row gone, ledger REVERSED (both halves kept), money back. */
    public function test_voiding_reverses_every_book(): void
    {
        $this->expenses->record([
            'id' => 'JV-VOID01', 'companyId' => 'travels', 'amount' => 1000,
            'head' => '5550', 'category' => 'Guest & Entertainment', 'bankId' => '1',
        ]);
        $this->assertEquals(900000 - 1000, $this->balanceOf(1));

        $out = $this->expenses->void('JV-VOID01', 'test');

        $this->assertSame(0, DB::table('acc_entries')->where('ext_id', 'JV-VOID01')->count());
        $this->assertNotEmpty($out['reversals']);
        // the ORIGINAL posting is still on the books, with its mirror image beside it
        $this->assertSame(1000.0, $this->lineOn('GL-ACC-JV-VOID01', '5550', 'debit'));
        $this->assertSame(1000.0, $this->lineOn('GL-REV-GL-ACC-JV-VOID01', '5550', 'credit'));
        // net effect on the head is zero
        $this->assertSame(0.0, $this->netOn('5550'));
        // and the account has its money back, with a row saying why
        $this->assertEquals(900000, $this->balanceOf(1));
        $this->assertSame(1, DB::table('bank_transactions')->where('entry_ref', 'JV-VOID01')
            ->where('type', 'deposit')->count());
        $this->assertTrue((bool) DB::table('bank_transactions')->where('entry_ref', 'JV-VOID01')
            ->where('type', 'withdraw')->value('reversed'));
    }

    public function test_it_refuses_a_zero_amount(): void
    {
        $this->expectException(LedgerException::class);
        $this->expenses->record(['companyId' => 'travels', 'amount' => 0, 'head' => '5550', 'category' => 'Guest']);
    }

    /**
     * A host that pulled the new code but has NOT run `php artisan migrate` yet
     * has no bank_id / bank_name / pay_acct columns. Recording an expense must
     * still work there — it just can't record WHICH account paid. Writing those
     * columns blindly would throw "unknown column" on every save, the client
     * would roll its optimistic row back, and a working feature would look
     * broken to the user.
     */
    public function test_it_still_records_on_a_database_missing_the_payment_columns(): void
    {
        Schema::table('acc_entries', function ($t) {
            $t->dropColumn(['bank_id', 'bank_name', 'pay_acct']);
        });
        $service = $this->app->make(ExpensePostingService::class);   // fresh column cache

        $out = $service->record([
            'id' => 'JV-OLD001', 'companyId' => 'travels', 'amount' => 900,
            'head' => '5550', 'category' => 'Guest & Entertainment', 'bankId' => '1',
        ]);

        // the register row and the journal are there…
        $this->assertSame(1, DB::table('acc_entries')->where('ext_id', 'JV-OLD001')->count());
        $this->assertSame(900.0, $this->lineOn('GL-ACC-JV-OLD001', '5550', 'debit'));
        $this->assertSame(900.0, $this->lineOn('GL-ACC-JV-OLD001', '1010', 'credit'));
        // …the account still moved, and the response still reports it
        $this->assertEquals(900000 - 900, $this->balanceOf(1));
        $this->assertSame('1', $out['entry']['bankId']);
    }

    /* ---------------------------------------------------------------- helpers */

    private function entry(string $reference): object
    {
        return DB::table('journal_entries')->where('reference', $reference)->whereNull('deleted_at')->first();
    }

    /** Debit or credit posted to one account code inside one journal entry. */
    private function lineOn(string $reference, string $code, string $side): float
    {
        $entry = $this->entry($reference);
        if (! $entry) {
            return 0.0;
        }

        return (float) DB::table('journal_items')
            ->join('accounts', 'accounts.id', '=', 'journal_items.account_id')
            ->where('journal_items.journal_entry_id', $entry->id)
            ->whereNull('journal_items.deleted_at')
            ->where('accounts.code', $code)
            ->sum('journal_items.' . $side);
    }

    /** Net Dr − Cr across EVERY entry for one account code. */
    private function netOn(string $code): float
    {
        $rows = DB::table('journal_items')
            ->join('accounts', 'accounts.id', '=', 'journal_items.account_id')
            ->whereNull('journal_items.deleted_at')
            ->where('accounts.code', $code)
            ->selectRaw('SUM(debit) as dr, SUM(credit) as cr')->first();

        return (float) $rows->dr - (float) $rows->cr;
    }

    private function balances(string $reference): bool
    {
        $entry = $this->entry($reference);
        $sums = DB::table('journal_items')->where('journal_entry_id', $entry->id)->whereNull('deleted_at')
            ->selectRaw('SUM(debit) as dr, SUM(credit) as cr')->first();

        return abs((float) $sums->dr - (float) $sums->cr) < 0.01;
    }

    private function balanceOf(int $bankId): float
    {
        return (float) DB::table('banks')->where('id', $bankId)->value('balance');
    }

    /* ------------------------------------------------------------- the fixture */

    private function buildSchema(): void
    {
        Schema::create('accounts', function ($t) {
            $t->id();
            $t->string('code', 20)->index();
            $t->string('name');
            $t->string('type', 20)->default('expense');
            $t->softDeletes();
        });
        Schema::create('journal_entries', function ($t) {
            $t->id();
            $t->unsignedBigInteger('company_id')->nullable();
            $t->date('date')->nullable();
            $t->string('source', 40)->nullable();
            $t->string('reference')->nullable()->index();
            $t->text('description')->nullable();
            $t->unsignedBigInteger('created_by')->nullable();
            $t->softDeletes();
            $t->timestamps();
        });
        Schema::create('journal_items', function ($t) {
            $t->id();
            $t->unsignedBigInteger('journal_entry_id')->index();
            $t->unsignedBigInteger('account_id');
            $t->decimal('debit', 15, 2)->default(0);
            $t->decimal('credit', 15, 2)->default(0);
            $t->softDeletes();
            $t->timestamps();
        });
        Schema::create('banks', function ($t) {
            $t->id();
            $t->string('name');
            $t->string('branch_name')->nullable();
            $t->string('account_name')->nullable();
            $t->string('account_type', 20)->default('current');
            $t->string('type', 30)->default('bank');       // bank | cash | mobile_banking | digital_wallet
            $t->string('routing_number')->nullable();
            $t->string('account_number')->nullable();
            $t->string('currency', 8)->default('BDT');
            $t->decimal('balance', 15, 2)->default(0);
            $t->tinyInteger('status')->default(1);
            $t->unsignedBigInteger('company_id')->nullable();
            $t->softDeletes();
            $t->timestamps();
        });
        // same columns as the real migrations (acc_entries + the payment-source
        // columns, bank_transactions + the voucher trail)
        Schema::create('acc_entries', function ($t) {
            $t->id();
            $t->string('ext_id')->unique();
            $t->string('company_id')->default('group');
            $t->string('kind')->default('Expense');
            $t->decimal('amount', 14, 2)->default(0);
            $t->string('category')->nullable();
            $t->string('sub_category')->nullable();
            $t->string('head')->nullable();
            $t->string('method')->nullable();
            $t->string('bank_id', 40)->nullable();
            $t->string('bank_name')->nullable();
            $t->string('pay_acct', 20)->nullable();
            $t->date('date')->nullable();
            $t->string('party')->nullable();
            $t->string('ref')->nullable();
            $t->text('description')->nullable();
            $t->json('items')->nullable();
            $t->boolean('alloc')->default(false);
            $t->string('funded_by')->nullable();
            $t->string('created')->nullable();
            $t->timestamps();
        });
        Schema::create('bank_transactions', function ($t) {
            $t->id();
            $t->string('client_id', 40)->nullable();
            $t->string('bank_ref', 64)->nullable();
            $t->string('bank_name')->nullable();
            $t->string('type', 30);
            $t->decimal('amount', 15, 2)->default(0);
            $t->date('date')->nullable();
            $t->string('reference')->nullable();
            $t->text('description')->nullable();
            $t->string('gl_id', 64)->nullable();
            $t->string('entry_ref', 64)->nullable();
            $t->boolean('reversed')->default(false);
            $t->softDeletes();
            $t->timestamps();
        });
    }

    private function seedChartAndAccounts(): void
    {
        foreach ([
            ['1000', 'Cash', 'asset'], ['1010', 'Bank', 'asset'],
            ['1300', 'Inter-company Receivable', 'asset'], ['2400', 'Inter-company Payable', 'liability'],
            ['5100', 'Salaries', 'expense'], ['5200', 'Rent', 'expense'],
            ['5400', 'Marketing', 'expense'], ['5500', 'Office & Admin', 'expense'],
            ['5550', 'Food & Entertainment', 'expense'], ['5600', 'Conveyance & Travel', 'expense'],
        ] as [$code, $name, $type]) {
            DB::table('accounts')->insert(['code' => $code, 'name' => $name, 'type' => $type]);
        }
        // company_id 2 = travels, 4 = group (App\Support\CompanySlugs)
        DB::table('banks')->insert([
            ['id' => 1, 'name' => 'City Bank (Travels)', 'type' => 'bank', 'balance' => 900000, 'status' => 1, 'company_id' => 2],
            ['id' => 2, 'name' => 'Travels Petty Cash', 'type' => 'cash', 'balance' => 40000, 'status' => 1, 'company_id' => 2],
            ['id' => 3, 'name' => 'Group HQ Current', 'type' => 'bank', 'balance' => 5000000, 'status' => 1, 'company_id' => 4],
        ]);
    }
}
