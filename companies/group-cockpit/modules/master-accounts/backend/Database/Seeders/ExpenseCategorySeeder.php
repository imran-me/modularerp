<?php

namespace Epal\Modules\GroupCockpit\MasterAccounts\Database\Seeders;

use Epal\Modules\GroupCockpit\MasterAccounts\Models\ExpenseCategory;
use Illuminate\Database\Seeder;

/**
 * Seeds the default group expense categories (mirrors master-accounts.js seed).
 * Idempotent — skips if rows exist.
 */
class ExpenseCategorySeeder extends Seeder
{
    public function run(): void
    {
        if (ExpenseCategory::query()->exists()) {
            return;
        }

        $cats = [
            ['Office Management',   ['Stationery', 'Cleaning', 'Repair & Maintenance', 'Furniture']],
            ['Food & Entertainment', ['Staff Lunch', 'Guest Entertainment', 'Tea & Snacks']],
            ['Utilities',           ['Electricity', 'Water', 'Gas', 'Internet', 'Phone']],
            ['Office Rent',         []],
            ['Staff Salary',        ['Salary', 'Bonus', 'Overtime']],
            ['Marketing',           ['Facebook Ads', 'Boosting', 'Design', 'Print', 'SMS Campaign']],
            ['Fees & Charges',      ['Bank Charge', 'Trade License', 'Software', 'IATA Fee']],
            ['Conveyance & Travel', ['Local Transport', 'Fuel']],
            ['Miscellaneous',       []],
        ];

        foreach ($cats as [$name, $subs]) {
            ExpenseCategory::create(['name' => $name, 'subs' => $subs, 'active' => true, 'company_id' => null]);
        }
    }
}
