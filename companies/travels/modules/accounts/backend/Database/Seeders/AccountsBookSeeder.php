<?php

namespace Epal\Modules\Travels\Accounts\Database\Seeders;

use Epal\Modules\Travels\Accounts\Models\TvCheque;
use Epal\Modules\Travels\Accounts\Models\TvPetty;
use Epal\Modules\Travels\Accounts\Models\TvRecurring;
use Illuminate\Database\Seeder;

/**
 * Seeds the demo recurring / cheque / petty rows (mirrors accounts.js seed).
 * Idempotent per store.
 */
class AccountsBookSeeder extends Seeder
{
    public function run(): void
    {
        if (! TvRecurring::query()->exists()) {
            foreach ([
                ['id' => 'REC-RENT', 'companyId' => 'travels', 'category' => 'Office Rent',           'amount' => 85000, 'dayOfMonth' => 1, 'method' => 'Bank', 'party' => 'Landlord',   'active' => true],
                ['id' => 'REC-NET',  'companyId' => 'travels', 'category' => 'Internet & Utilities',   'amount' => 12000, 'dayOfMonth' => 5, 'method' => 'Bank', 'party' => 'ISP / DESCO', 'active' => true],
            ] as $r) {
                TvRecurring::create(['ext_id' => $r['id'], 'company_id' => 'travels', 'status' => 'active', 'data' => $r]);
            }
        }

        if (! TvCheque::query()->exists()) {
            foreach ([
                ['id' => 'CHQ-1', 'companyId' => 'travels', 'type' => 'Issued',   'number' => 'A-4471209', 'bank' => 'City Bank', 'party' => 'Biman Bangladesh', 'amount' => 249000, 'date' => '2026-07-02', 'dueDate' => '2026-07-15', 'status' => 'Pending'],
                ['id' => 'CHQ-2', 'companyId' => 'travels', 'type' => 'Received', 'number' => 'B-8830112', 'bank' => 'BRAC Bank', 'party' => 'Concord Group',    'amount' => 279000, 'date' => '2026-06-28', 'dueDate' => '2026-07-08', 'status' => 'Cleared'],
            ] as $c) {
                TvCheque::create(['ext_id' => $c['id'], 'company_id' => 'travels', 'status' => $c['status'], 'data' => $c]);
            }
        }

        if (! TvPetty::query()->exists()) {
            foreach ([
                ['id' => 'PC-1', 'companyId' => 'travels', 'staff' => 'Naeem Chowdhury', 'amount' => 5000, 'purpose' => 'Office supplies & courier', 'date' => '2026-07-03', 'status' => 'Open'],
                ['id' => 'PC-2', 'companyId' => 'travels', 'staff' => 'Rafiul Islam', 'amount' => 3000, 'purpose' => 'Client refreshments', 'date' => '2026-06-29', 'status' => 'Settled', 'category' => 'Travel & Conveyance', 'billAmount' => 2650, 'billNo' => 'BR-118', 'settledDate' => '2026-07-01'],
            ] as $p) {
                TvPetty::create(['ext_id' => $p['id'], 'company_id' => 'travels', 'status' => $p['status'], 'data' => $p]);
            }
        }
    }
}
