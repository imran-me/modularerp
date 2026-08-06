<?php

namespace Epal\Modules\Woodart\Projects\Database\Seeders;

use Epal\Modules\Woodart\Projects\Models\Estimate;
use Epal\Modules\Woodart\Projects\Models\Project;
use Illuminate\Database\Seeder;

/**
 * THE SPINE — Interior's ONE project, and the BOQ every other seeder points at.
 *
 * Owner, 2026-08-06: *"remove demo data from interior only, and make only one
 * demo project across all the system of interior."* Woodart used to seed five
 * generated projects plus three story projects; it now seeds exactly one, and
 * every other Woodart seeder hangs its rows off it.
 *
 * THE NUMBERS ARE THE BUSINESS'S OWN, from companies/woodart/Assets/
 * MUNSHI-VILLA-SHEET.md — the spreadsheet this project actually runs on:
 *
 *     contract   ৳70,00,000
 *     received   ৳40,00,000   three payments   (WoodartMoneySeeder)
 *     spent      ৳23,48,257   thirteen heads   (WoodartMoneySeeder)
 *
 * THE SCOPE OF WORK (WORK below) is the single source for BOTH the BOQ and the
 * per-head budget, and the scope module reads these same lines back out of the
 * database to allocate them across the rooms. One table, three consumers — so a
 * budget can never disagree with the quotation it came from.
 *
 * Every line carries a cost CODE (wa_cost_codes) and a KIND. A `material` line
 * names a material in the register exactly, so the bill of materials resolves
 * it; a `work` line prices labour or a contract, and nobody stocks a rajmistri.
 *
 * Idempotent: keyed on (company_id, ext_id) via updateOrCreate.
 *
 * Run: php artisan db:seed --class="Epal\Modules\Woodart\Projects\Database\Seeders\ProjectSeeder"
 */
class ProjectSeeder extends Seeder
{
    private const COMPANY = 'woodart';

    /** Contract ÷ budgeted cost — this villa's margin, as one constant. */
    public const MARKUP = 1.1492;

    /** [ cost code, line item, qty, unit, unit cost, kind ] */
    public const WORK = [
        ['3D & Visualisation', '3D design, walkthrough & drawings',     1, 'lot',      50000, 'work'],
        ['Soil & Excavation',  'Soil excavation, cutting & fill',       1, 'lot',      75000, 'work'],
        ['Bricks & Breaking',  'Bricks (1st class)',                37500, 'pcs',         12, 'material'],
        ['Cement',             'Cement — 50 kg bag',                  550, 'bag',        545, 'material'],
        ['Rod',                'Rod — BSRM 60 grade',               10000, 'kg',          85, 'material'],
        ['Sand & Bali',        'Sand & bali',                        4000, 'cft',         65, 'material'],
        ['Contractor',         'Rajmistri contract — Younus Mia',       1, 'lot',    1344000, 'work'],
        ['Electrical',         'Electrical points & wiring',          120, 'point',     2900, 'work'],
        ['Sanitary',           'Sanitary & plumbing set',               5, 'set',      80000, 'work'],
        ['Tiles Work',         'Floor & wall tiles — supply & lay',  2000, 'sft',        160, 'work'],
        ['Paint',              'Putty, primer & paint',              6000, 'sft',         30, 'work'],
        ['Aluminium',          'Aluminium windows & glazing',         400, 'sft',        400, 'work'],
        ['Metal',              'MS railing & grill',                   60, 'rft',       1500, 'work'],
        ['Wood Work',          'Joinery labour & site fitting',         1, 'lot',     350000, 'work'],
        ['Boards & Ply',       'Marine Plywood 18mm',                  90, 'sheet',     3610, 'material'],
        ['Boards & Ply',       'Veneer Board',                         30, 'sheet',     4200, 'material'],
        ['Laminates & Veneer', 'Formica Laminate',                     45, 'sheet',     1250, 'material'],
        ['Hardware',           'German Hinge (Hettich)',              200, 'pcs',        335, 'material'],
        ['Hardware',           'Drawer Channel 18"',                   70, 'pcs',        540, 'material'],
        ['Hardware',           'SS Handle',                           110, 'pcs',        185, 'material'],
        ['Finishes',           'NC Lacquer',                           30, 'litre',     1065, 'material'],
        ['Extra Labour',       'Extra labour — call-outs',              1, 'lot',      60000, 'work'],
        ['Transport & Visit',  'Transport & site visits',               1, 'lot',     100000, 'work'],
        ['Other Expense',      'Extra / others',                        1, 'lot',      90215, 'work'],
    ];

    /** The BOQ lines, in the exact frontend `wa_estimates.lines` shape. */
    public static function boqLines(): array
    {
        return array_map(fn ($w) => [
            'item'     => $w[1],
            'qty'      => $w[2],
            'unit'     => $w[3],
            'unitCost' => $w[4],
            'unitSale' => (int) round($w[4] * self::MARKUP),
            'code'     => $w[0],
            'kind'     => $w[5],
        ], self::WORK);
    }

    public function run(): void
    {
        $lines = self::boqLines();
        $budget = 0;
        foreach ($lines as $l) {
            $budget += $l['qty'] * $l['unitCost'];
        }

        Project::updateOrCreate(
            ['company_id' => self::COMPANY, 'ext_id' => 'WAP-101'],
            [
                'name'       => 'Munshi Villa Duplex — build & full interior',
                'client'     => 'Munshi Billah',
                'type'       => 'Residential',
                'area'       => 2520,               // the eleven rooms, summed
                'value'      => 7000000,            // the contract, from the sheet
                'cost'       => (int) round($budget),
                'stage'      => 'Production',       // civil done, services running
                'phase'      => 'Production',
                'progress'   => 42,
                'designer'   => 'Imtiaz Chowdhury',
                'start'      => '2026-02-27',
                'deadline'   => '2026-11-30',
                'billed'     => false,
                'created_on' => '2026-02-20',
            ]
        );

        Estimate::updateOrCreate(
            ['company_id' => self::COMPANY, 'ext_id' => 'EST-101'],
            [
                'title'       => 'Munshi Villa Duplex — bill of quantities',
                'client'      => 'Munshi Billah',
                'project_ext' => 'WAP-101',
                'status'      => 'Approved',
                'lines'       => $lines,
                'valid_till'  => '2026-12-31',
                'created_on'  => '2026-02-24',
            ]
        );
    }
}
