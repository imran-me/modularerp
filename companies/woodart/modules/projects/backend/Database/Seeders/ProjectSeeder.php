<?php

namespace Epal\Modules\Woodart\Projects\Database\Seeders;

use Epal\Modules\Woodart\Projects\Models\Project;
use Epal\Modules\Woodart\Projects\Models\Estimate;
use Illuminate\Database\Seeder;

/**
 * THE SPINE — the projects every other Woodart seeder already points at.
 *
 * Seeded LAST in intent but first in dependency: wa_production, wa_installs,
 * wa_drawings and wa_movements all name a project id, and until this existed
 * those references dangled in MySQL. Every id used by any other seeder appears
 * here, so the database is referentially honest:
 *
 *   WAP-001 … WAP-005   the projects JobSeeder / DesignSeeder / InstallSeeder use
 *   WAP-101 … WAP-103   the three story projects, each at a different phase,
 *                       which StockLedgerSeeder issues material against
 *   WAP-999             deliberately ABSENT — the orphan those seeders reference
 *                       on purpose, so the "orphan" badge has real data
 *
 * Clients are the names ClientSeeder holds, so the Clients portfolio join
 * resolves too rather than showing ten clients with no work.
 *
 * Run: php artisan db:seed --class="Epal\Modules\Woodart\Projects\Database\Seeders\ProjectSeeder"
 */
class ProjectSeeder extends Seeder
{
    public function run(): void
    {
        $projects = [
            // [ext_id, name, client, type, area, value, cost, stage, phase, progress, designer, start, deadline]
            ['WAP-001', 'Office Fit-out · Tejgaon I/A',        'ACI Limited',            'Office',      6200, 5400000, 3510000, 'Production',   'Production',   62, 'Nasrin Sultana', '2026-03-04', '2026-08-28'],
            ['WAP-002', 'Penthouse Remodel · Wari',            'Ashraful Karim',         'Residential', 3800, 4100000, 2665000, 'Handover',     'Handover',     94, 'Touhidul Alam',  '2026-02-11', '2026-07-24'],
            ['WAP-003', 'Penthouse Remodel · Tejgaon I/A',     'Square Pharmaceuticals', 'Residential', 4400, 6200000, 4030000, 'Installation', 'Installation', 81, 'Farzana Yasmin', '2026-03-18', '2026-09-12'],
            ['WAP-004', 'Showroom Design · Uttara Sector 7',   'Rahimafrooz',            'Retail',      2900, 3350000, 2177500, 'Design',       'Design & 3D',  22, 'Sharmin Jahan',  '2026-05-26', '2026-10-30'],
            ['WAP-005', 'Bank Branch Fit-out · Motijheel C/A', 'Akij Group',             'Office',      5100, 7100000, 4615000, 'Production',   'Production',   48, 'Touhidul Alam',  '2026-04-02', '2026-09-26'],

            // the three story projects — one per phase, threaded end to end
            ['WAP-101', 'Full Interior · Gulshan Penthouse',   'Bashundhara Group',      'Residential', 4200, 4800000, 3120000, 'Design',       'Design & 3D',  18, 'Nasrin Sultana', '2026-06-08', '2026-11-20'],
            ['WAP-102', 'Office Fit-out · Square Pharma HQ',   'Square Pharmaceuticals', 'Office',      9800, 9200000, 5980000, 'Production',   'Production',   56, 'Touhidul Alam',  '2026-04-14', '2026-09-30'],
            ['WAP-103', 'Duplex Interior · Dhanmondi 27',      'Ashraful Karim',         'Residential', 3100, 3650000, 2372500, 'Handover',     'Handover',     96, 'Sharmin Jahan',  '2026-02-02', '2026-07-18'],
        ];

        foreach ($projects as [$extId, $name, $client, $type, $area, $value, $cost, $stage, $phase, $progress, $designer, $start, $deadline]) {
            Project::updateOrCreate(
                ['company_id' => 'woodart', 'ext_id' => $extId],
                ['name' => $name, 'client' => $client, 'type' => $type, 'area' => $area,
                 'value' => $value, 'cost' => $cost, 'stage' => $stage, 'phase' => $phase,
                 'progress' => $progress, 'designer' => $designer, 'start' => $start,
                 'deadline' => $deadline, 'billed' => $stage === 'Completed',
                 'created_on' => $start]
            );
        }

        /* The BOQs. Each line quotes a material the register actually stocks, so
         * Estimates, Materials and Procurement describe ONE business. This is
         * also each project's budget: unit cost against unit sale, line by line. */
        $estimates = [
            ['EST-101', 'Full Interior — Gulshan Penthouse', 'Bashundhara Group', 'WAP-101', 'Sent', '2026-08-15', [
                ['item' => 'Marine Plywood 18mm',     'qty' => 180, 'unitCost' => 3400, 'unitSale' => 4600],
                ['item' => 'Veneer Board',            'qty' => 90,  'unitCost' => 4200, 'unitSale' => 5900],
                ['item' => 'German Hinge (Hettich)',  'qty' => 320, 'unitCost' => 310,  'unitSale' => 480],
                ['item' => 'PU Polish',               'qty' => 70,  'unitCost' => 1420, 'unitSale' => 2050],
                ['item' => 'Fabric — Velvet',         'qty' => 140, 'unitCost' => 420,  'unitSale' => 690],
            ]],
            ['EST-102', 'Office Fit-out — Square Pharma HQ', 'Square Pharmaceuticals', 'WAP-102', 'Approved', '2026-06-30', [
                ['item' => 'Marine Plywood 18mm',     'qty' => 420, 'unitCost' => 3400, 'unitSale' => 4500],
                ['item' => 'Formica Laminate',        'qty' => 360, 'unitCost' => 1250, 'unitSale' => 1850],
                ['item' => 'MDF 12mm',                'qty' => 210, 'unitCost' => 1850, 'unitSale' => 2600],
                ['item' => 'Drawer Channel 18"',      'qty' => 260, 'unitCost' => 540,  'unitSale' => 820],
                ['item' => 'SS Handle',               'qty' => 480, 'unitCost' => 185,  'unitSale' => 310],
                ['item' => 'NC Lacquer',              'qty' => 120, 'unitCost' => 980,  'unitSale' => 1480],
            ]],
            ['EST-103', 'Duplex Interior — Dhanmondi 27', 'Ashraful Karim', 'WAP-103', 'Approved', '2026-03-31', [
                ['item' => 'Marine Plywood 18mm',     'qty' => 150, 'unitCost' => 3400, 'unitSale' => 4550],
                ['item' => 'Veneer Board',            'qty' => 70,  'unitCost' => 4200, 'unitSale' => 5800],
                ['item' => 'Wood Glue 5kg',           'qty' => 40,  'unitCost' => 760,  'unitSale' => 1120],
                ['item' => 'Foam 4"',                 'qty' => 120, 'unitCost' => 260,  'unitSale' => 430],
            ]],
            ['EST-001', 'Reception & Workstations — ACI', 'ACI Limited', 'WAP-001', 'Approved', '2026-04-30', [
                ['item' => 'Marine Plywood 18mm',     'qty' => 240, 'unitCost' => 3400, 'unitSale' => 4520],
                ['item' => 'Formica Laminate',        'qty' => 190, 'unitCost' => 1250, 'unitSale' => 1820],
            ]],
        ];

        foreach ($estimates as [$extId, $title, $client, $project, $status, $validTill, $lines]) {
            Estimate::updateOrCreate(
                ['company_id' => 'woodart', 'ext_id' => $extId],
                ['title' => $title, 'client' => $client, 'project_ext' => $project,
                 'status' => $status, 'lines' => $lines, 'valid_till' => $validTill,
                 'created_on' => '2026-04-18']
            );
        }
    }
}
