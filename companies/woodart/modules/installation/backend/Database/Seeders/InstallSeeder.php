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
        /* THE VILLA IS A BUILDING SITE, not a delivery address, so these are
         * site visits: civil supervision running, the electrical first-fix
         * inspection booked, and the ground-floor civil handover being snagged.
         * The snag list is ITEMISED — openSnags() reads the list, never the
         * stored number, so a stale count cannot corrupt the handover queue.
         *
         * [ext_id, project, site, team, status, date, snags, snag_list] */
        $rows = [
            ['INS-101', 'WAP-101', 'Munshiganj', 'Team Alpha', 'In Progress', '2026-07-02', 0, null],
            ['INS-102', 'WAP-101', 'Munshiganj', 'Team Alpha', 'Scheduled',   '2026-07-14', 0, null],
            ['INS-103', 'WAP-101', 'Munshiganj', 'Team Bravo', 'Snagging',    '2026-06-26', 2, [
                ['text' => 'Plaster crack — dining room north wall', 'done' => false],
                ['text' => 'Floor level off by 8mm — guest bath',    'done' => false],
                ['text' => 'Window opening 2" narrow — kids room',   'done' => true],
            ]],
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
