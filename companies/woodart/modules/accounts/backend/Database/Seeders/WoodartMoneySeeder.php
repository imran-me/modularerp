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

        $rows = [
            // [ext_id, kind, category, description, amount, method, date, ref]
            ['JV-WA101', 'Expense', 'Fuel & Transport', 'Site survey — Gulshan (WAP-101)',                  14500,   'Cash', '2026-06-10', 'WAP-101'],
            ['JV-WA102', 'Expense', 'Salaries',         'Design team — June',                               385000,  'Bank', '2026-06-30', ''],
            ['JV-WA103', 'Expense', 'Vendor Payment',   'Akij Board — settles WPO-002 in full',             186000,  'Bank', '2026-05-06', 'WPO-002'],
            ['JV-WA104', 'Expense', 'Fuel & Transport', 'Delivery to site — WAP-103',                       26800,   'Cash', '2026-06-12', 'WAP-103'],
            ['JV-WA105', 'Expense', 'Office Rent',      'Workshop — Tejgaon, June',                         180000,  'Bank', '2026-06-05', ''],
            ['JV-WA106', 'Expense', 'Utilities',        'Workshop power — June',                            64200,   'Bank', '2026-07-02', ''],
            ['JV-WA107', 'Income',  'Design Fee',       'Concept + 3D — Bashundhara Group (WAP-101)',       320000,  'Bank', '2026-06-26', 'WAP-101'],
            ['JV-WA108', 'Income',  'Project Billing',  'Stage 2 — Square Pharmaceuticals (WAP-102)',       3600000, 'Bank', '2026-06-18', 'WAP-102'],
            // a little more history, so a month-on-month chart is not a single spike
            ['JV-WA109', 'Expense', 'Salaries',         'Workshop crew — May',                              412000,  'Bank', '2026-05-31', ''],
            ['JV-WA110', 'Expense', 'Office Rent',      'Workshop — Tejgaon, May',                          180000,  'Bank', '2026-05-05', ''],
            ['JV-WA111', 'Expense', 'Vendor Payment',   'Timber World BD — settles WPO-001 in full',        340000,  'Bank', '2026-02-26', 'WPO-001'],
            ['JV-WA113', 'Expense', 'Vendor Payment',   'Hatil Trade — settles WPO-005 in full',            212000,  'Bank', '2026-06-10', 'WPO-005'],
            ['JV-WA112', 'Income',  'Project Billing',  'Final — Ashraful Karim (WAP-103)',                 1850000, 'Bank', '2026-07-02', 'WAP-103'],
            // WAP-001..005 had drawings, jobs and installs but not a single
            // rupee recorded against them. Work that costs nothing and earns
            // nothing is not work — every project now shows in the books.
            ['JV-WA120', 'Income',  'Project Billing',  'Stage 1 — ACI Limited (WAP-001)',                  1620000, 'Bank', '2026-04-12', 'WAP-001'],
            ['JV-WA121', 'Expense', 'Fuel & Transport', 'Delivery to site — WAP-001',                       31500,   'Cash', '2026-05-20', 'WAP-001'],
            ['JV-WA122', 'Income',  'Project Billing',  'Final — Ashraful Karim (WAP-002)',                 4100000, 'Bank', '2026-07-01', 'WAP-002'],
            ['JV-WA123', 'Expense', 'Fuel & Transport', 'Site handover run — WAP-002',                      18200,   'Cash', '2026-06-30', 'WAP-002'],
            ['JV-WA124', 'Income',  'Project Billing',  'Stage 2 — Square Pharmaceuticals (WAP-003)',       2480000, 'Bank', '2026-06-08', 'WAP-003'],
            ['JV-WA125', 'Income',  'Design Fee',       'Concept — Rahimafrooz (WAP-004)',                  185000,  'Bank', '2026-06-14', 'WAP-004'],
            ['JV-WA126', 'Income',  'Project Billing',  'Mobilisation — Akij Group (WAP-005)',              2130000, 'Bank', '2026-04-20', 'WAP-005'],
            ['JV-WA127', 'Expense', 'Salaries',         'Site crew — June',                                 268000,  'Bank', '2026-06-30', ''],
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
