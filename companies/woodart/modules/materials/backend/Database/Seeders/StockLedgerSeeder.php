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

        // What the story projects consumed, by material ext_id.
        $consumed = [
            'MAT-001' => [['WAP-102', 210, '2026-05-06'], ['WAP-103', 96, '2026-03-12']],
            'MAT-004' => [['WAP-102', 188, '2026-05-18']],
            'MAT-003' => [['WAP-102', 104, '2026-05-22']],
            'MAT-006' => [['WAP-102', 142, '2026-06-02']],
            'MAT-009' => [['WAP-102', 58,  '2026-06-14']],
            'MAT-002' => [['WAP-103', 44,  '2026-03-20']],
            'MAT-008' => [['WAP-103', 18,  '2026-03-26']],
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
