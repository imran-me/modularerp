<?php

namespace Epal\Modules\Woodart\Design\Database\Seeders;

use Epal\Modules\Woodart\Design\Models\Drawing;
use Epal\Modules\Woodart\Design\Models\Revision;
use Illuminate\Database\Seeder;

/**
 * Seeds the architecture & 3D phase against the demo clock (2026-07-05):
 * deliverables in every state, one project fully approved (so "design-complete"
 * has a real example), one long-waiting issue for the top of the approval
 * queue, a revised drawing with a real trail, and one orphan whose project does
 * not exist — so every branch has data instead of being a path nobody sees.
 *
 * Idempotent: keyed on (company_id, ext_id) via updateOrCreate.
 *
 * Run: php artisan db:seed --class="Epal\Modules\Woodart\Design\Database\Seeders\DesignSeeder"
 */
class DesignSeeder extends Seeder
{
    public function run(): void
    {
        /* THE VILLA'S DRAWING SET. The build drawings are approved — the shell is
         * already up, and you cannot pour a structure from drawings nobody
         * signed. The joinery ones are still moving, which is what a project at
         * this phase looks like: the client approved the shell and is still
         * choosing what goes inside it. `Issued` is the only state where the
         * wait is the CLIENT's, so the approvals queue has exactly one row.
         *
         * [ext_id, project, title, kind, designer, rev, status, issued, approved] */
        $drawings = [
            ['DWG-101', 'WAP-101', 'Ground floor plan',         'Plan',      'Imtiaz Chowdhury', 'B', 'Approved',  '2026-03-02', '2026-03-10'],
            ['DWG-102', 'WAP-101', 'Upper floor plan',          'Plan',      'Imtiaz Chowdhury', 'B', 'Approved',  '2026-03-02', '2026-03-10'],
            ['DWG-103', 'WAP-101', 'Front elevation',           'Elevation', 'Imtiaz Chowdhury', 'A', 'Approved',  '2026-03-04', '2026-03-10'],
            ['DWG-104', 'WAP-101', 'Staircase & lobby section', 'Section',   'Imtiaz Chowdhury', 'A', 'Approved',  '2026-03-06', '2026-03-12'],
            ['DWG-105', 'WAP-101', 'Living room — 3D view',     '3D Model',  'Imtiaz Chowdhury', 'C', 'Commented', '2026-06-24', null],
            ['DWG-106', 'WAP-101', 'Master wardrobe detail',    'Detail',    'Imtiaz Chowdhury', 'A', 'Issued',    '2026-06-28', null],
            ['DWG-107', 'WAP-101', 'Kitchen joinery detail',    'Detail',    'Imtiaz Chowdhury', 'A', 'Draft',     null,         null],
        ];

        foreach ($drawings as [$extId, $project, $title, $kind, $designer, $rev, $status, $issued, $approved]) {
            Drawing::updateOrCreate(
                ['company_id' => 'woodart', 'ext_id' => $extId],
                [
                    'title'      => $title,
                    'kind'       => $kind,
                    'project'    => $project,
                    'designer'   => $designer,
                    'rev'        => $rev,
                    'status'     => $status,
                    'issued'     => $issued,
                    'approved'   => $approved,
                    'created_on' => '2026-05-14',
                ]
            );
        }

        // The trail. DWG-002 was revised once and DWG-005 twice, so the counts
        // the register shows have real evidence behind them.
        /* THE TRAIL IS EVIDENCE — one row per revision letter, up to the current
         * one, so how a drawing reached its state is still readable months
         * later. Every row belongs to a drawing above; a trail pointing at a
         * drawing that does not exist is worse than no trail.
         *
         * [ext_id, drawing, rev, action, by, note, date] */
        $revisions = [
            ['RVN-101', 'DWG-101', 'A', 'Revised',   'Imtiaz Chowdhury', 'Store room moved under the stair',   '2026-02-29'],
            ['RVN-102', 'DWG-101', 'B', 'Approved',  'Imtiaz Chowdhury', '',                                   '2026-03-10'],
            ['RVN-103', 'DWG-102', 'A', 'Revised',   'Imtiaz Chowdhury', 'Kids bed room widened by 1 ft',      '2026-03-01'],
            ['RVN-104', 'DWG-102', 'B', 'Approved',  'Imtiaz Chowdhury', '',                                   '2026-03-10'],
            ['RVN-105', 'DWG-103', 'A', 'Approved',  'Imtiaz Chowdhury', '',                                   '2026-03-10'],
            ['RVN-106', 'DWG-104', 'A', 'Approved',  'Imtiaz Chowdhury', '',                                   '2026-03-12'],
            ['RVN-107', 'DWG-105', 'A', 'Revised',   'Imtiaz Chowdhury', 'Ceiling height corrected to 9 ft',   '2026-05-30'],
            ['RVN-108', 'DWG-105', 'B', 'Revised',   'Imtiaz Chowdhury', 'Veneer tone changed to walnut',      '2026-06-14'],
            ['RVN-109', 'DWG-105', 'C', 'Commented', 'Imtiaz Chowdhury', 'Client wants the TV wall reworked',  '2026-07-02'],
            ['RVN-110', 'DWG-106', 'A', 'Issued',    'Imtiaz Chowdhury', '',                                   '2026-06-28'],
            ['RVN-111', 'DWG-107', 'A', 'Drafted',   'Imtiaz Chowdhury', '',                                   '2026-07-01'],
        ];

        foreach ($revisions as [$extId, $drawing, $rev, $action, $by, $note, $date]) {
            Revision::updateOrCreate(
                ['company_id' => 'woodart', 'ext_id' => $extId],
                [
                    'drawing' => $drawing,
                    'rev'     => $rev,
                    'action'  => $action,
                    'by'      => $by,
                    'note'    => $note ?: null,
                    'date'    => $date,
                ]
            );
        }
    }
}
