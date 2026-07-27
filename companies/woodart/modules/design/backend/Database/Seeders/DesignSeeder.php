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
        $drawings = [
            // [ext_id, project, title, kind, designer, rev, status, issued, approved]
            ['DWG-001', 'WAP-001', 'Ground floor plan',      'Plan',      'Nasrin Sultana', 'A', 'Approved',  '2026-05-20', '2026-05-28'],
            ['DWG-002', 'WAP-001', 'Reception elevation',    'Elevation', 'Nasrin Sultana', 'B', 'Approved',  '2026-06-02', '2026-06-11'],
            ['DWG-003', 'WAP-001', 'Lobby render',           'Render',    'Farzana Yasmin', 'A', 'Approved',  '2026-06-06', '2026-06-14'],
            // WAP-002: one still with the client for a long time — heads the queue
            ['DWG-004', 'WAP-002', 'Workstation layout',     'Plan',      'Touhidul Alam',  'A', 'Issued',    '2026-06-04', null],
            ['DWG-005', 'WAP-002', 'Conference 3D model',    '3D Model',  'Touhidul Alam',  'C', 'Commented', '2026-06-24', null],
            // WAP-003: fresh work, still on our side of the fence
            ['DWG-006', 'WAP-003', 'Wardrobe detail',        'Detail',    'Sharmin Jahan',  'A', 'Draft',     null,         null],
            ['DWG-007', 'WAP-003', 'Bedroom section',        'Section',   'Sharmin Jahan',  'A', 'Issued',    '2026-07-01', null],
            // an orphan — its project no longer exists. Kept and flagged.
            ['DWG-008', 'WAP-999', 'Salvaged concept model', '3D Model',  'Farzana Yasmin', 'A', 'Issued',    '2026-06-18', null],
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
        $revisions = [
            ['RVN-001', 'DWG-001', 'A', 'Issued',    'Nasrin Sultana', '',                              '2026-05-20'],
            ['RVN-002', 'DWG-001', 'A', 'Approved',  'Nasrin Sultana', '',                              '2026-05-28'],
            ['RVN-003', 'DWG-002', 'A', 'Revised',   'Nasrin Sultana', 'Client asked for a wider desk', '2026-05-29'],
            ['RVN-004', 'DWG-002', 'B', 'Approved',  'Nasrin Sultana', '',                              '2026-06-11'],
            ['RVN-005', 'DWG-003', 'A', 'Approved',  'Farzana Yasmin', '',                              '2026-06-14'],
            ['RVN-006', 'DWG-004', 'A', 'Issued',    'Touhidul Alam',  '',                              '2026-06-04'],
            ['RVN-007', 'DWG-005', 'A', 'Revised',   'Touhidul Alam',  'Ceiling height corrected',      '2026-06-12'],
            ['RVN-008', 'DWG-005', 'B', 'Revised',   'Touhidul Alam',  'Glazing line moved',            '2026-06-20'],
            ['RVN-009', 'DWG-005', 'C', 'Commented', 'Touhidul Alam',  'Client wants a darker veneer',  '2026-06-28'],
            ['RVN-010', 'DWG-006', 'A', 'Drafted',   'Sharmin Jahan',  '',                              '2026-06-30'],
            ['RVN-011', 'DWG-007', 'A', 'Issued',    'Sharmin Jahan',  '',                              '2026-07-01'],
            ['RVN-012', 'DWG-008', 'A', 'Issued',    'Farzana Yasmin', '',                              '2026-06-18'],
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
