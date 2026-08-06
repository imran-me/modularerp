<?php

namespace Epal\Modules\Woodart\Materials\Database\Seeders;

use Epal\Modules\Woodart\Materials\Models\Material;
use Epal\Modules\Woodart\Materials\Models\Movement;
use Epal\Modules\Woodart\Materials\Models\StockLocation;
use Illuminate\Database\Seeder;

/**
 * Seeds the stock locations and a movement ledger that EXPLAINS the stock each
 * material already carries — the same approach the SPA seed takes.
 *
 * The movements are generated BACKWARDS from the current figure: an opening
 * receipt, then the issues that consumed it, then wastage. That way the ledger
 * accounts for the register instead of contradicting it, and
 * MaterialService::reconcile() returns empty on a freshly seeded database.
 *
 * Run AFTER MaterialSeeder:
 *   php artisan db:seed --class="Epal\Modules\Woodart\Materials\Database\Seeders\StockLedgerSeeder"
 */
class StockLedgerSeeder extends Seeder
{
    public function run(): void
    {
        $locations = [
            ['LOC-001', 'Main Workshop', 'Workshop', 'Tejgaon I/A', true],
            ['LOC-002', 'Finishing Bay', 'Workshop', 'Tejgaon I/A', false],
            ['LOC-003', 'Site Store',    'Site',     'Gulshan-2',   false],
        ];

        foreach ($locations as [$extId, $name, $kind, $area, $primary]) {
            StockLocation::updateOrCreate(
                ['company_id' => 'woodart', 'ext_id' => $extId],
                ['name' => $name, 'kind' => $kind, 'area' => $area,
                 'primary' => $primary, 'created_on' => '2026-01-14']
            );
        }

        /* WHAT THE VILLA HAS ACTUALLY CONSUMED, by material. Only the four civil
         * bulk materials appear: the joinery phases have not started, so not one
         * sheet of plywood has left the workshop for this job — which is exactly
         * what the sheet's empty Wood Work page says.
         *
         * The quantities are derived from the SPEND, not invented: rod ৳8,56,397
         * at ৳85/kg is 10,075 kg received, of which 9,700 went to site and 194
         * (2%) was cutting waste, leaving the 181 kg the register shows. */
        $consumed = [
            'MAT-013' => [['WAP-101', 9700,  '2026-03-26']],
            'MAT-014' => [['WAP-101', 480,   '2026-04-04']],
            'MAT-015' => [['WAP-101', 33333, '2026-03-18']],
            'MAT-016' => [['WAP-101', 3627,  '2026-03-12']],
        ];

        $n = 0;
        foreach (Material::where('company_id', 'woodart')->orderBy('ext_id')->get() as $m) {
            $used = $consumed[$m->ext_id] ?? [];
            $out = array_sum(array_column($used, 1));
            $wastage = $out ? max(1, (int) round($out * 0.02)) : 0;

            // opening = what is left, plus everything that left again
            $opening = (int) $m->stock + $out + $wastage;

            Movement::updateOrCreate(
                ['company_id' => 'woodart', 'ext_id' => 'MOV-'.str_pad((string) ++$n, 4, '0', STR_PAD_LEFT)],
                ['material' => $m->ext_id, 'kind' => 'Receipt', 'qty' => $opening,
                 'location' => 'LOC-001', 'ref' => 'OPENING',
                 'note' => 'Opening stock on hand', 'by' => 'System', 'date' => '2026-02-01']
            );

            foreach ($used as [$project, $qty, $date]) {
                Movement::updateOrCreate(
                    ['company_id' => 'woodart', 'ext_id' => 'MOV-'.str_pad((string) ++$n, 4, '0', STR_PAD_LEFT)],
                    ['material' => $m->ext_id, 'kind' => 'Issue', 'qty' => -$qty,
                     'location' => 'LOC-001', 'ref' => $project,
                     'note' => 'Issued to '.$project, 'by' => 'Store', 'date' => $date]
                );
            }

            if ($wastage) {
                Movement::updateOrCreate(
                    ['company_id' => 'woodart', 'ext_id' => 'MOV-'.str_pad((string) ++$n, 4, '0', STR_PAD_LEFT)],
                    ['material' => $m->ext_id, 'kind' => 'Wastage', 'qty' => -$wastage,
                     'location' => 'LOC-001', 'ref' => '',
                     'note' => 'Offcuts and damage', 'by' => 'Store', 'date' => '2026-06-20']
                );
            }
        }
    }
}
