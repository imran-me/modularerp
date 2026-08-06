<?php

namespace Epal\Modules\Woodart\Accounts\Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * WOODART'S MONEY — the half of the seed that was missing entirely.
 *
 * An audit on 2026-07-27 found the interiors data referentially clean but
 * financially empty: `acc_entries` held ZERO rows for any company, and Woodart
 * had no bank account. Every operational table was populated — projects,
 * materials, movements, drawings, jobs, installs — while the books that are
 * supposed to record what all of it COST were blank. A business whose ledger is
 * empty while its workshop is full is not logical data.
 *
 * These rows mirror the browser seed (JV-WA101..108 in platform/data/seed-bd.js)
 * so the demo site and a migrated host tell the SAME story rather than two
 * different ones.
 *
 * ⚠️ NOTE ON OWNERSHIP: `acc_entries` and `banks` are Master Accounts' tables,
 * not this module's. This seeder only writes Woodart's own rows into them, which
 * is exactly how the frontend already works — Woodart expenses have always lived
 * in the shared register, scoped by company. It is declared here rather than in
 * master-accounts so that deleting the Woodart folder takes Woodart's seed with
 * it, which is the whole point of the modular layout.
 *
 * This is the first file of the `accounts` module (ROOT-MAP band E). The desk
 * itself — income, expenses, vendor payment, project P&L — comes next; its data
 * lands first so there is something real to build against.
 *
 * Run: php artisan db:seed --class="Epal\Modules\Woodart\Accounts\Database\Seeders\WoodartMoneySeeder"
 */
class WoodartMoneySeeder extends Seeder
{
    /** Woodart's numeric company id — see platform/backend/app/Support/CompanySlugs.php */
    private const COMPANY_ID = 6;

    public function run(): void
    {
        $this->seedBank();
        $this->seedEntries();
    }

    /** One real operating account, so a payment has somewhere to come from. */
    private function seedBank(): void
    {
        if (! Schema::hasTable('banks')) {
            return;
        }

        DB::table('banks')->updateOrInsert(
            ['account_number' => '1502-WA-004417'],
            [
                'name'           => 'BRAC Bank',
                'branch_name'    => 'Tejgaon',
                'account_name'   => 'Woodart Interiors Ltd',
                'account_type'   => 'Current',
                'type'           => 'bank',
                'routing_number' => '060271726',
                'currency'       => 'BDT',
                'balance'        => 2840000,
                'status'         => 1,
                'company_id'     => self::COMPANY_ID,
                'updated_at'     => now(),
                'created_at'     => now(),
            ]
        );
    }

    /**
     * The operating register — what the work actually cost and earned.
     *
     * A vendor payment references a PO that EXISTS and settles it for its exact
     * amount. The first draft of this seeder pointed two payments at WPO-102 and
     * WPO-105 — ids from the browser story that have no row in this database —
     * and for amounts that matched no order. An audit caught both. A payment
     * against an order that does not exist, for a figure the order never said,
     * is precisely the illogical data this seed exists to avoid.
     */
    private function seedEntries(): void
    {
        if (! Schema::hasTable('acc_entries')) {
            return;
        }

        /* INTERIOR'S BOOKS ARE THIS PROJECT'S BOOKS (owner, 2026-08-06).
         *
         * Every income row is one of the three payments the client has made, and
         * every project expense is one of the thirteen heads on the sheet's cost
         * summary, at the sheet's own figures — they sum to exactly ৳23,48,257,
         * which is what the spreadsheet says has been spent:
         *
         *     received   ৳40,00,000  of a ৳70,00,000 contract
         *     spent      ৳23,48,257  across 13 heads
         *     to collect ৳30,00,000  (RecurringSeeder aside, this is the job)
         *
         * `ref` carries the project id, because that is what Project P&L joins
         * on. The standing costs at the end deliberately have none: workshop
         * rent is the concern's overhead, not this villa's cost, and charging it
         * to the job would overstate this one and understate the next.
         *
         * WHO MOVED THE MONEY is kept in the description — the sheet's REF. NAME
         * column (MOHSIN BOSS · NAYEEM · EMAN VAI · AZIZUL VAI) is an audit trail
         * the business relies on, and the ERP has no handler field yet. Recorded
         * where it can be read rather than dropped, and no column invented.
         *
         * [ext_id, kind, category, description, amount, method, date, ref] */
        $rows = [
            ['JV-WA101', 'Income',  'Project Billing',    'Munshi Villa Duplex — 1st payment, on signing',                  1000000, 'Bank', '2026-03-05', 'WAP-101'],
            ['JV-WA102', 'Income',  'Project Billing',    'Munshi Villa Duplex — 2nd payment, on structure',                2000000, 'Bank', '2026-04-22', 'WAP-101'],
            ['JV-WA103', 'Income',  'Project Billing',    'Munshi Villa Duplex — 3rd payment, on brickwork',                1000000, 'Bank', '2026-06-10', 'WAP-101'],

            ['JV-WA104', 'Expense', '3D & Visualisation', '3D design office — concept & walkthrough · handled by MOHSIN BOSS',  30000, 'Bank', '2026-03-04', 'WAP-101'],
            ['JV-WA105', 'Expense', 'Soil & Excavation',  'Soil test, cutting & fill · handled by NAYEEM',                      59980, 'Cash', '2026-03-06', 'WAP-101'],
            ['JV-WA106', 'Expense', 'Sand & Bali',        'Sand & bali — Buriganga Sand Traders (WPO-104) · AZIZUL VAI',       244920, 'Bank', '2026-03-09', 'WAP-101'],
            ['JV-WA107', 'Expense', 'Bricks & Breaking',  'Bricks & breaking — Munshiganj Brick Field (WPO-103) · EMAN VAI',   414000, 'Bank', '2026-03-16', 'WAP-101'],
            ['JV-WA108', 'Expense', 'Rod',                'BSRM rod — Haji Enterprise (WPO-101) · handled by MOHSIN BOSS',     856397, 'Bank', '2026-03-24', 'WAP-101'],
            ['JV-WA109', 'Expense', 'Cement',             'Cement — Meghna Cement Depot (WPO-102) · handled by EMAN VAI',      273780, 'Bank', '2026-04-02', 'WAP-101'],
            ['JV-WA110', 'Expense', 'Contractor',         'Rajmistri contract — Younus Mia, part payment · RONY & EMAN VAI',   341000, 'Bank', '2026-05-10', 'WAP-101'],
            ['JV-WA111', 'Expense', 'Hardware',           'Civil hardware & fixings — RFL Hardware (WPO-105) · NAYEEM',         24160, 'Cash', '2026-05-20', 'WAP-101'],
            ['JV-WA112', 'Expense', 'Extra Labour',       'Extra labour — call-outs · handled by NAYEEM',                       16300, 'Cash', '2026-06-04', 'WAP-101'],
            ['JV-WA113', 'Expense', 'Electrical',         'Electrical first fix — Dhaka Electric House (WPO-106) · AZIZUL VAI',  22800, 'Bank', '2026-06-22', 'WAP-101'],
            ['JV-WA114', 'Expense', 'Transport & Visit',  'Transport & site visits · handled by MOHSIN BOSS',                   43790, 'Cash', '2026-06-26', 'WAP-101'],
            ['JV-WA115', 'Expense', 'Sanitary',           'Sanitary advance — Sanitary World BD (WPO-107) · NAYEEM',             7530, 'Cash', '2026-06-30', 'WAP-101'],
            ['JV-WA116', 'Expense', 'Other Expense',      'Extra / others · handled by MOHSIN BOSS',                             13600, 'Cash', '2026-07-02', 'WAP-101'],

            ['JV-WA120', 'Expense', 'Office Rent',        'Workshop rent — Tejgaon, June',                                     180000, 'Bank', '2026-06-05', ''],
            ['JV-WA121', 'Expense', 'Salaries',           'Salaries — design & site team, June',                                148000, 'Bank', '2026-06-28', ''],
            ['JV-WA122', 'Expense', 'Utilities',          'Workshop power — June',                                              64200, 'Bank', '2026-07-02', ''],
        ];

        foreach ($rows as [$extId, $kind, $category, $desc, $amount, $method, $date, $ref]) {
            DB::table('acc_entries')->updateOrInsert(
                ['ext_id' => $extId],
                [
                    'company_id'  => 'woodart',
                    'kind'        => $kind,
                    'category'    => $category,
                    'description' => $desc,
                    'amount'      => $amount,
                    'method'      => $method,
                    'date'        => $date,
                    'ref'         => $ref ?: null,
                    'alloc'       => 0,
                    'created'     => $date,
                    'updated_at'  => now(),
                    'created_at'  => now(),
                ]
            );
        }
    }
}
