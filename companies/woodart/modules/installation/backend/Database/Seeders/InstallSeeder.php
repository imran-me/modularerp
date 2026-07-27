<?php

namespace Epal\Modules\Woodart\Installation\Database\Seeders;

use Epal\Modules\Woodart\Installation\Models\Install;
use Illuminate\Database\Seeder;

/**
 * Seeds a realistic Woodart install schedule against the demo clock
 * (2026-07-05): sites in every state, one genuinely overdue, clean handovers,
 * a site whose snags are an ITEMISED list (so the dual-shape snag count has
 * real data on both branches), and one pointing at a project that does not
 * exist so the "orphan" path is exercised.
 *
 * Idempotent: keyed on (company_id, ext_id) via updateOrCreate.
 *
 * Run: php artisan db:seed --class="Epal\Modules\Woodart\Installation\Database\Seeders\InstallSeeder"
 */
class InstallSeeder extends Seeder
{
    public function run(): void
    {
        $rows = [
            // [ext_id, project, site, team, status, date, snags, snag_list]
            ['INS-001', 'WAP-001', 'Gulshan-2',        'Team Alpha',   'Handover',    '2026-06-14', 0, null],
            ['INS-002', 'WAP-002', 'Banani DOHS',      'Team Bravo',   'Snagging',    '2026-06-28', 3, null],
            ['INS-003', 'WAP-003', 'Dhanmondi 27',     'Team Alpha',   'In Progress', '2026-07-08', 0, null],
            ['INS-004', 'WAP-004', 'Uttara Sector 7',  'Team Charlie', 'Scheduled',   '2026-07-22', 0, null],
            // Itemised snag list: 2 of 4 still open. openSnags() must read the
            // LIST (2), not any stale number — the stored count is derived.
            ['INS-005', 'WAP-005', 'Bashundhara R/A',  'Team Bravo',   'Snagging',    '2026-07-01', 2, [
                ['text' => 'Hinge alignment on wardrobe shutter', 'done' => false],
                ['text' => 'Skirting gap in living room',        'done' => true],
                ['text' => 'Touch-up polish on TV unit',         'done' => false],
                ['text' => 'Loose handle, kitchen drawer 3',     'done' => true],
            ]],
            ['INS-006', 'WAP-001', 'Mirpur DOHS',      'Team Delta',   'Handover',    '2026-05-30', 0, null],
            // Deliberately orphaned: the project does not exist. Kept + flagged.
            ['INS-007', 'WAP-999', 'Wari',             'Team Charlie', 'Scheduled',   null,         0, null],
            // WAP-102 is in production — its fit-out is scheduled, not started.
            ['INS-101', 'WAP-102', 'Tejgaon I/A',  'Team Alpha', 'Scheduled', '2026-08-04', 0, null],
            // WAP-103 is AT handover: one visit closed out, one still snagging.
            ['INS-102', 'WAP-103', 'Dhanmondi 27', 'Team Bravo', 'Snagging',  '2026-06-28', 2, [
                ['text' => 'Wardrobe shutter alignment — master bedroom', 'done' => false],
                ['text' => 'Polish touch-up on staircase handrail',       'done' => false],
                ['text' => 'Skirting gap in the living room',             'done' => true],
                ['text' => 'Drawer channel replaced — kitchen unit 3',    'done' => true],
            ]],
            ['INS-103', 'WAP-103', 'Dhanmondi 27', 'Team Bravo', 'Handover',  '2026-05-30', 0, null],
        ];

        foreach ($rows as [$extId, $project, $site, $team, $status, $date, $snags, $list]) {
            $open = is_array($list)
                ? count(array_filter($list, static fn ($s) => empty($s['done'])))
                : $snags;

            Install::updateOrCreate(
                ['company_id' => 'woodart', 'ext_id' => $extId],
                [
                    'project'    => $project,
                    'site'       => $site,
                    'team'       => $team,
                    'status'     => $status,
                    'date'       => $date,
                    'snags'      => $open,
                    'snag_list'  => $list,
                    'created_on' => '2026-06-01',
                ]
            );
        }
    }
}
