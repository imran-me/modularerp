<?php

namespace Epal\Modules\Woodart\Accounts\Database\Seeders;

use Epal\Modules\Woodart\Accounts\Models\Recurring;
use Illuminate\Database\Seeder;

/**
 * Woodart's standing monthly costs.
 *
 * DELIBERATELY NOT RANDOM. Every row here is a head the seeded register already
 * carries — workshop rent at Tejgaon (৳1,80,000), workshop power (৳64,200),
 * design-team salaries (৳3,85,000), site-crew salaries (৳2,68,000) — at the SAME
 * amounts. So the Recurring tab and the Expense register describe one business
 * rather than two, and clicking from a standing cost to its history finds real
 * entries.
 *
 * A standing cost with no matching entries in the register reads as a data-entry
 * error the first time anyone checks it, which is exactly the kind of
 * "seeded but not thought about" data this whole seed set exists to avoid.
 *
 * These rows MIRROR the browser seed (wa_recurring in platform/data/seed-bd.js)
 * so the demo site and a migrated host tell the SAME story.
 *
 * One row is deliberately PAUSED — the CNC service retainer — so the paused
 * branch of the summary has real data instead of being a path nobody sees.
 *
 * Run: php artisan db:seed --class="Epal\Modules\Woodart\Accounts\Database\Seeders\RecurringSeeder"
 */
class RecurringSeeder extends Seeder
{
    public function run(): void
    {
        $rows = [
            // [ext_id, name, category, amount, party, day, method, status]
            ['REC-WA001', 'Workshop rent — Tejgaon',    'Office Rent',       180000, 'Tejgaon Industrial Estate', 5,  'Bank',   'Active'],
            ['REC-WA002', 'Workshop power & utilities', 'Utilities',          64200, 'DESCO',                     12, 'Bank',   'Active'],
            ['REC-WA003', 'Design team salaries',       'Salaries',          385000, 'Payroll',                   28, 'Bank',   'Active'],
            ['REC-WA004', 'Site crew salaries',         'Salaries',          268000, 'Payroll',                   28, 'Bank',   'Active'],
            ['REC-WA005', 'Delivery van lease',         'Fuel & Transport',   42000, 'Rangs Motors',              8,  'Bank',   'Active'],
            ['REC-WA006', 'CNC service retainer',       'Tools & Equipment',  25000, 'Homag Bangladesh',          20, 'Cheque', 'Paused'],
        ];

        foreach ($rows as [$extId, $name, $category, $amount, $party, $day, $method, $status]) {
            Recurring::updateOrCreate(
                ['company_id' => 'woodart', 'ext_id' => $extId],
                [
                    'name'         => $name,
                    'category'     => $category,
                    'amount'       => $amount,
                    'party'        => $party,
                    'day_of_month' => $day,
                    'method'       => $method,
                    'status'       => $status,
                    'created_on'   => '2026-01-05',
                ]
            );
        }
    }
}
