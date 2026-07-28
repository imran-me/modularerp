<?php

namespace Epal\Modules\Woodart\Projects\Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

/**
 * THE COST CODE LIST — the vocabulary every estimate, purchase and expense
 * tags against.
 *
 * DERIVED FROM THE REAL SHEET, NOT INVENTED. Every head in
 * `Assets/Munshi Villa New Accounts.xlsx` appears here, because that is the
 * list the business already keeps by hand. The owner's note on 2026-07-28:
 * *"The excel might be for construction company, but interiors track should be
 * like this too."* — so the list spans BOTH a Woodart job that includes civil
 * work and one that is pure joinery. A fit-out with no structure simply never
 * posts to the Structure codes, and they stay off its cost report.
 *
 * `code` IS the string stored in `acc_entries.category`. One vocabulary, so
 * cost control works on every historical entry with no migration and nothing
 * to keep aligned (PROJECT-PROFILE-PLAN.md §8).
 *
 * KIND MATTERS. `overhead` codes — transport, site allowances, miscellaneous —
 * are separated from `direct` work packages on purpose. Job-costing practice is
 * explicit that mixing site overheads into work packages manufactures phantom
 * overruns: on a documented $2.4M fit-out it produced an apparent 10% overrun
 * by week 6 that did not exist.
 *
 * Run: php artisan db:seed --class="Epal\Modules\Woodart\Projects\Database\Seeders\CostCodeSeeder"
 */
class CostCodeSeeder extends Seeder
{
    public function run(): void
    {
        $rows = [
            // [code (== acc_entries.category), label, phase, kind]

            /* DESIGN — Woodart's own first phase, and a real line on the sheet
             * ('3D Design office', budget 50,000). */
            ['Design Fee',          'Design & Consultancy',      'Design',     'direct'],
            ['3D & Visualisation',  '3D Design / Visualisation', 'Design',     'direct'],
            ['Drawings & Approval', 'Drawings & Approvals',      'Design',     'direct'],

            /* STRUCTURE — only used when the job carries civil work, as Munshi
             * Villa does. A pure fit-out never posts here. */
            ['Bricks & Breaking',   'Bricks & Breaking',         'Structure',  'direct'],
            ['Cement',              'Cement',                    'Structure',  'direct'],
            ['Rod',                 'Steel / Rod',               'Structure',  'direct'],
            ['Sand & Bali',         'Sand / Bali',               'Structure',  'direct'],
            ['Soil & Excavation',   'Soil Excavation & Fill',    'Structure',  'direct'],

            /* JOINERY — Woodart's core. These map 1:1 onto the Materials
             * register categories, so a BOQ line and a stock issue land on the
             * same code without anyone deciding. */
            ['Boards & Ply',        'Boards, Ply & MDF',         'Joinery',    'direct'],
            ['Laminates & Veneer',  'Laminates & Veneer',        'Joinery',    'direct'],
            ['Hardware',            'Hardware & Fittings',       'Joinery',    'direct'],
            ['Adhesives',           'Adhesives & Consumables',   'Joinery',    'direct'],
            ['Finishes',            'Lacquer, Polish & Finish',  'Joinery',    'direct'],
            ['Fabric & Foam',       'Fabric, Foam & Upholstery', 'Joinery',    'direct'],
            ['Wood Work',           'Wood Work (contracted)',    'Joinery',    'direct'],

            /* SERVICES — the trades a fit-out coordinates but rarely self-performs. */
            ['Electrical',          'Electrical',                'Services',   'direct'],
            ['Sanitary',            'Sanitary & Plumbing',       'Services',   'direct'],
            ['HVAC',                'HVAC & Ventilation',        'Services',   'direct'],

            /* FINISHES — the phases that were empty sheets in the workbook,
             * i.e. not yet reached. They exist here so a project can show them
             * as 'not started' rather than as missing. */
            ['Tiles Work',          'Tiles & Stone',             'Finishes',   'direct'],
            ['Paint',               'Paint & Wall Finish',       'Finishes',   'direct'],
            ['Metal',               'Metal Work',                'Finishes',   'direct'],
            ['Aluminium',           'Aluminium & Glazing',       'Finishes',   'direct'],
            ['False Ceiling',       'False Ceiling',             'Finishes',   'direct'],

            /* SITE — labour and the people running the job. */
            ['Contractor',          'Contractor (Rajmistri)',    'Site',       'direct'],
            ['Extra Labour',        'Extra Labour',              'Site',       'direct'],
            ['Installation',        'Delivery & Installation',   'Site',       'direct'],

            /* OVERHEAD — deliberately NOT direct. Keeping these out of the work
             * packages is what stops a phantom overrun. */
            ['Transport & Visit',   'Transport & Site Visits',   'Overheads',  'overhead'],
            ['Site Expense',        'Site Allowance & Sundries', 'Overheads',  'overhead'],
            ['Vendor Payment',      'Vendor Payment (on account)', 'Overheads', 'overhead'],
            ['Salaries',            'Salaries',                  'Overheads',  'overhead'],
            ['Office Rent',         'Workshop / Office Rent',    'Overheads',  'overhead'],
            ['Utilities',           'Utilities',                 'Overheads',  'overhead'],
            ['Tools & Equipment',   'Tools & Equipment',         'Overheads',  'overhead'],
            ['Other Expense',       'Extra / Others',            'Overheads',  'overhead'],
        ];

        foreach ($rows as $i => [$code, $label, $phase, $kind]) {
            DB::table('wa_cost_codes')->updateOrInsert(
                ['company_id' => 'woodart', 'code' => $code],
                ['label' => $label, 'phase' => $phase, 'kind' => $kind,
                 'sort' => $i, 'active' => true, 'updated_at' => now(), 'created_at' => now()]
            );
        }
    }
}
