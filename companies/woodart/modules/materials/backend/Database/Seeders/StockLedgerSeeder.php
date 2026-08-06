<?php

namespace Epal\Modules\Woodart\Materials\Database\Seeders;

use Epal\Modules\Woodart\Materials\Models\Material;
use Epal\Modules\Woodart\Materials\Models\Movement;
use Epal\Modules\Woodart\Materials\Models\StockLocation;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

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

        /* DELIVERIES, not one lump — the instalments each order arrived in, and
         * the dates they came (owner, 2026-08-06: *"a room needs 500 brick, so
         * can buy 100, then 50 like that"*).
         * [order, qty, date] */
        $deliveries = [
            'MAT-013' => [['WPO-101', 4000, '2026-03-14'], ['WPO-101', 3500, '2026-03-19'], ['WPO-101', 2575, '2026-03-24']],
            'MAT-014' => [['WPO-102', 300,  '2026-03-22'], ['WPO-102', 202,  '2026-04-01']],
            'MAT-015' => [['WPO-103', 15000,'2026-03-08'], ['WPO-103', 12000,'2026-03-13'], ['WPO-103', 7500, '2026-03-17']],
            'MAT-016' => [['WPO-104', 2000, '2026-03-05'], ['WPO-104', 1768, '2026-03-11']],
        ];

        /* Civil bulk lives at the site store; workshop material at the workshop. */
        $siteStore = ['MAT-013' => true, 'MAT-014' => true, 'MAT-015' => true, 'MAT-016' => true];

        /* The rooms an issue can be issued TO — the civil phases, with the area
         * each room carries, so a split matches the requirements exactly. */
        $rooms = [];
        if (Schema::hasTable('wa_phases') && Schema::hasTable('wa_spaces')) {
            $areas = DB::table('wa_spaces')->where('company_id', 'woodart')->pluck('area', 'ext_id');
            foreach (DB::table('wa_phases')->where('company_id', 'woodart')
                ->where('name', 'Civil & Breaking')->orderBy('ext_id')->get() as $ph) {
                $rooms[] = ['phase' => $ph->ext_id, 'space' => $ph->space, 'area' => (int) ($areas[$ph->space] ?? 1)];
            }
        }

        $n = 0;
        foreach (Material::where('company_id', 'woodart')->orderBy('ext_id')->get() as $m) {
            $used = $consumed[$m->ext_id] ?? [];
            $out = array_sum(array_column($used, 1));
            $wastage = $out ? max(1, (int) round($out * 0.02)) : 0;

            // opening = what is left, plus everything that left again
            $opening = (int) $m->stock + $out + $wastage;
            $loc = isset($siteStore[$m->ext_id]) ? 'LOC-003' : 'LOC-001';

            if (isset($deliveries[$m->ext_id])) {
                /* the instalments sum to the same opening quantity, so the
                 * invariant holds — it is the same stock, told as its history */
                $got = array_sum(array_column($deliveries[$m->ext_id], 1));
                $last = count($deliveries[$m->ext_id]) - 1;
                foreach ($deliveries[$m->ext_id] as $i => [$order, $qty, $date]) {
                    Movement::updateOrCreate(
                        ['company_id' => 'woodart', 'ext_id' => 'MOV-'.str_pad((string) ++$n, 4, '0', STR_PAD_LEFT)],
                        ['material' => $m->ext_id, 'kind' => 'Receipt',
                         'qty' => $qty + ($i === $last ? ($opening - $got) : 0),
                         'location' => $loc, 'ref' => $order, 'order_ext' => $order,
                         'note' => 'Delivery '.($i + 1).' of '.count($deliveries[$m->ext_id]).' against '.$order,
                         'by' => 'Jahangir Alam', 'date' => $date]
                    );
                }
            } else {
                Movement::updateOrCreate(
                    ['company_id' => 'woodart', 'ext_id' => 'MOV-'.str_pad((string) ++$n, 4, '0', STR_PAD_LEFT)],
                    ['material' => $m->ext_id, 'kind' => 'Receipt', 'qty' => $opening,
                     'location' => $loc, 'ref' => 'OPENING',
                     'note' => 'Opening stock on hand', 'by' => 'System', 'date' => '2026-02-01']
                );
            }

            foreach ($used as [$project, $qty, $date]) {
                $parts = $this->splitAcrossRooms($qty, $rooms);
                if (! $parts) {
                    /* no rooms on this host yet — record it against the job so the
                     * ledger is still complete rather than silently short */
                    Movement::updateOrCreate(
                        ['company_id' => 'woodart', 'ext_id' => 'MOV-'.str_pad((string) ++$n, 4, '0', STR_PAD_LEFT)],
                        ['material' => $m->ext_id, 'kind' => 'Issue', 'qty' => -$qty,
                         'location' => $loc, 'ref' => $project,
                         'note' => 'Issued to '.$project, 'by' => 'Jahangir Alam', 'date' => $date]
                    );

                    continue;
                }
                foreach ($rooms as $i => $room) {
                    if (! $parts[$i]) {
                        continue;
                    }
                    Movement::updateOrCreate(
                        ['company_id' => 'woodart', 'ext_id' => 'MOV-'.str_pad((string) ++$n, 4, '0', STR_PAD_LEFT)],
                        ['material' => $m->ext_id, 'kind' => 'Issue', 'qty' => -$parts[$i],
                         'location' => $loc, 'ref' => $project,
                         'phase' => $room['phase'], 'space' => $room['space'],
                         'note' => 'Issued to the room', 'by' => 'Jahangir Alam', 'date' => $date]
                    );
                }
            }

            if ($wastage) {
                Movement::updateOrCreate(
                    ['company_id' => 'woodart', 'ext_id' => 'MOV-'.str_pad((string) ++$n, 4, '0', STR_PAD_LEFT)],
                    ['material' => $m->ext_id, 'kind' => 'Wastage', 'qty' => -$wastage,
                     'location' => $loc, 'ref' => 'WAP-101',
                     'note' => 'Cutting waste and breakage', 'by' => 'Jahangir Alam', 'date' => '2026-06-20']
                );
            }
        }
    }

    /**
     * Split a quantity across the rooms by AREA, with largest remainder so the
     * parts sum EXACTLY back to the whole. The same split the requirements use,
     * so "this room needed 6,250 bricks and used 5,800" reconciles both ways —
     * and the stock invariant survives, because nothing is lost to rounding.
     */
    private function splitAcrossRooms(int $total, array $rooms): array
    {
        if (! $rooms) {
            return [];
        }
        $weights = array_map(fn ($r) => $r['area'] ?: 1, $rooms);
        $sum = array_sum($weights) ?: count($weights);
        $raw = array_map(fn ($w) => $total * $w / $sum, $weights);
        $out = array_map('floor', $raw);
        $used = (int) array_sum($out);

        $order = [];
        foreach ($raw as $i => $v) {
            $order[] = [$v - floor($v), $i];
        }
        usort($order, fn ($x, $y) => $y[0] <=> $x[0]);
        for ($k = 0; $used < $total; $k++, $used++) {
            $out[$order[$k % count($order)][1]]++;
        }

        return array_map('intval', $out);
    }
}