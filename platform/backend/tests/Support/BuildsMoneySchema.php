<?php

namespace Tests\Support;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * The money tables, for feature tests.
 * ----------------------------------------------------------------------------
 * Four of them (accounts / banks / journal_entries / journal_items) predate this
 * repo's migrations — they live in the production schema — so tests have to build
 * them. The other two (acc_entries / bank_transactions) are created here with the
 * SAME columns their real migrations produce, so an assertion that passes here
 * means the same thing in production.
 *
 * Shared by every posting test (expense · sale · receipt) so there is ONE
 * definition of the books to reason about: fix a column here and every test
 * agrees, instead of three fixtures drifting apart.
 *
 * Company ids follow App\Support\CompanySlugs: 1 it · 2 travels · 3 construction
 * · 4 group · 5 shop · 6 woodart.
 */
trait BuildsMoneySchema
{
    /** The six tables these tests own, dropped in reverse-dependency order. */
    private const MONEY_TABLES = [
        'bank_transactions', 'acc_entries', 'journal_items', 'journal_entries', 'banks', 'accounts',
    ];

    /**
     * Build them fresh. The DROP first is what lets the SAME suite run against a real
     * MySQL database as well as sqlite :memory: — sqlite hands every test a brand-new
     * in-memory database, MySQL does not, so without this the second test would die on
     * "table already exists". Running these against MySQL is worth it: strict mode,
     * DECIMAL rounding, LIKE collation and ORDER BY CASE all behave differently there,
     * and those differences only ever show up in production.
     *
     *   DB_CONNECTION=mysql DB_DATABASE=<a scratch db> php vendor/bin/phpunit
     */
    protected function buildMoneySchema(): void
    {
        $this->dropMoneySchema();

        Schema::create('accounts', function ($t) {
            $t->id();
            // 20 was too short the moment banks got their own codes: '1180-PRT-2'
            // is a sub-account of 1180, and production allows the length
            $t->string('code', 40)->index();
            $t->string('name');
            $t->string('type', 20)->default('expense');
            // production carries these; the fixture must too, or a test passes on a
            // table simpler than the one the code actually runs against
            $t->unsignedBigInteger('parent_id')->nullable();
            $t->decimal('opening_balance', 15, 2)->default(0);
            $t->boolean('status')->default(true);
            $t->softDeletes();
        });
        Schema::create('journal_entries', function ($t) {
            $t->id();
            $t->unsignedBigInteger('company_id')->nullable();
            $t->date('date')->nullable();
            $t->string('source', 40)->nullable();
            $t->string('party', 255)->nullable()->index();   // migration 2026_07_27_004000
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

    protected function dropMoneySchema(): void
    {
        foreach (self::MONEY_TABLES as $t) {
            Schema::dropIfExists($t);
        }
    }

    /** The chart of accounts the money flows touch. */
    protected function seedChart(): void
    {
        foreach ([
            ['1000', 'Cash', 'asset'], ['1010', 'Bank', 'asset'],
            ['1150', 'Sub-Agent Receivable', 'asset'], ['1200', 'Accounts Receivable', 'asset'],
            ['1300', 'Inter-company Receivable', 'asset'],
            ['2000', 'Accounts Payable', 'liability'], ['2130', 'VAT Payable', 'liability'],
            ['2400', 'Inter-company Payable', 'liability'],
            ['4000', 'Sales Revenue', 'income'], ['4010', 'Air Ticket Sales', 'income'],
            ['4020', 'Visa Services', 'income'], ['4030', 'Package & Tour', 'income'],
            ['4040', 'Hotel & Other Travel', 'income'], ['4050', 'Contract Flights & Files', 'income'],
            ['5000', 'Cost of Sales', 'expense'], ['5100', 'Salaries', 'expense'],
            ['5200', 'Rent', 'expense'], ['5400', 'Marketing', 'expense'],
            ['5500', 'Office & Admin', 'expense'], ['5550', 'Food & Entertainment', 'expense'],
            ['5600', 'Conveyance & Travel', 'expense'],
        ] as [$code, $name, $type]) {
            DB::table('accounts')->insert(['code' => $code, 'name' => $name, 'type' => $type]);
        }
    }

    /** Payment accounts: 1 Travels bank · 2 Travels cash box · 3 Group bank · 4 Woodart bank. */
    protected function seedAccountsFor(): void
    {
        DB::table('banks')->insert([
            ['id' => 1, 'name' => 'City Bank (Travels)', 'type' => 'bank', 'balance' => 900000, 'status' => 1, 'company_id' => 2],
            ['id' => 2, 'name' => 'Travels Petty Cash', 'type' => 'cash', 'balance' => 40000, 'status' => 1, 'company_id' => 2],
            ['id' => 3, 'name' => 'Group HQ Current', 'type' => 'bank', 'balance' => 5000000, 'status' => 1, 'company_id' => 4],
            ['id' => 4, 'name' => 'Woodart Bank', 'type' => 'bank', 'balance' => 700000, 'status' => 1, 'company_id' => 6],
        ]);
    }

    /* ------------------------------------------------------------- assertions */

    /** One journal entry by its stable client id, or null. Named journalEntry()
     *  rather than entry() because a test class may have its own entry() poster. */
    protected function journalEntry(string $reference): ?object
    {
        return DB::table('journal_entries')->where('reference', $reference)->whereNull('deleted_at')->first();
    }

    /** Does THIS one entry balance? (booksBalance() checks the whole book.) */
    protected function balances(string $reference): bool
    {
        $entry = $this->journalEntry($reference);
        if (! $entry) {
            return false;
        }
        $sums = DB::table('journal_items')->where('journal_entry_id', $entry->id)->whereNull('deleted_at')
            ->selectRaw('SUM(debit) as dr, SUM(credit) as cr')->first();

        return abs((float) $sums->dr - (float) $sums->cr) < 0.01;
    }

    /** Debit or credit posted to one account code inside one journal entry. */
    protected function lineOn(string $reference, string $code, string $side): float
    {
        $entry = $this->journalEntry($reference);
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

    /** Net Dr − Cr across EVERY entry for one account code (optionally per company). */
    protected function netOn(string $code, ?int $companyId = null): float
    {
        $r = DB::table('journal_items')
            ->join('accounts', 'accounts.id', '=', 'journal_items.account_id')
            ->join('journal_entries', 'journal_entries.id', '=', 'journal_items.journal_entry_id')
            ->whereNull('journal_items.deleted_at')
            ->whereNull('journal_entries.deleted_at')
            ->when($companyId, fn ($q) => $q->where('journal_entries.company_id', $companyId))
            ->where('accounts.code', $code)
            ->selectRaw('SUM(journal_items.debit) as dr, SUM(journal_items.credit) as cr')->first();

        return (float) $r->dr - (float) $r->cr;
    }

    /** Every posted journal balances, and so does the whole book. */
    protected function booksBalance(): bool
    {
        $r = DB::table('journal_items')
            ->join('journal_entries', 'journal_entries.id', '=', 'journal_items.journal_entry_id')
            ->whereNull('journal_items.deleted_at')->whereNull('journal_entries.deleted_at')
            ->selectRaw('SUM(debit) as dr, SUM(credit) as cr')->first();

        return abs((float) $r->dr - (float) $r->cr) < 0.01;
    }

    protected function balanceOf(int $bankId): float
    {
        return (float) DB::table('banks')->where('id', $bankId)->value('balance');
    }
}
