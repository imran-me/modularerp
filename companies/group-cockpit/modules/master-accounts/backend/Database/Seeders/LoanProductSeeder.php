<?php

namespace Epal\Modules\GroupCockpit\MasterAccounts\Database\Seeders;

use Epal\Modules\GroupCockpit\MasterAccounts\Models\LoanProduct;
use Illuminate\Database\Seeder;

/**
 * Seeds the default loan products (mirrors platform/kit/loans.js seed). Idempotent.
 */
class LoanProductSeeder extends Seeder
{
    public function run(): void
    {
        if (LoanProduct::query()->exists()) {
            return;
        }

        $products = [
            ['id' => 'LP-STAFF-EXT', 'name' => 'Personal Loan (Individual)',   'rate' => 12, 'method' => 'reducing', 'tenure' => 12, 'penalty' => 2, 'notes' => 'Un-secured, for known individuals · guarantor required'],
            ['id' => 'LP-BIZ',       'name' => 'Business Loan (Partner/Agent)', 'rate' => 15, 'method' => 'reducing', 'tenure' => 24, 'penalty' => 2, 'notes' => 'For sub-agents & partners · cheque security'],
            ['id' => 'LP-BRIDGE',    'name' => 'Bridge / Short-term',           'rate' => 18, 'method' => 'flat',     'tenure' => 6,  'penalty' => 3, 'notes' => 'Quick working-capital support, flat interest'],
            ['id' => 'LP-FRIENDLY',  'name' => 'Interest-free (Goodwill)',      'rate' => 0,  'method' => 'flat',     'tenure' => 10, 'penalty' => 0, 'notes' => 'No interest — relationship lending'],
        ];

        foreach ($products as $p) {
            LoanProduct::create(['ext_id' => $p['id'], 'company_id' => null, 'status' => null, 'data' => $p]);
        }
    }
}
