<?php

namespace Epal\Modules\Woodart\Production\Database\Seeders;

use Epal\Modules\Woodart\Production\Models\Job;
use Illuminate\Database\Seeder;

/**
 * Seeds a realistic Woodart shop floor against the demo clock (2026-07-05):
 * work in every state, a couple of jobs genuinely overdue, one blocked, and one
 * pointing at a project id that does not exist so the "orphan" path has real
 * data instead of being a branch nobody ever sees.
 *
 * Idempotent: keyed on (company_id, ext_id) via updateOrCreate.
 *
 * Run: php artisan db:seed --class="Epal\Modules\Woodart\Production\Database\Seeders\JobSeeder"
 */
class JobSeeder extends Seeder
{
    public function run(): void
    {
        $rows = [
            // [ext_id, job, project, station, assigned_to, status, due]
            ['JOB-001', 'Cabinet carcass',    'WAP-001', 'CNC',          'Omar Faruk',     'Done',    '2026-06-12'],
            ['JOB-002', 'Wardrobe shutters',  'WAP-001', 'Edge Banding', 'Kamrul Islam',   'Running', '2026-07-12'],
            ['JOB-003', 'Conference table',   'WAP-002', 'Assembly',     'Mahmudul Hasan', 'Running', '2026-07-02'],  // overdue
            ['JOB-004', 'Wall paneling',      'WAP-002', 'Cutting',      'Delwar Mia',     'Queued',  '2026-07-20'],
            ['JOB-005', 'Reception desk',     'WAP-003', 'CNC',          'Omar Faruk',     'Blocked', '2026-06-28'],  // overdue + blocked
            ['JOB-006', 'Bed frame',          'WAP-003', 'Assembly',     'Jashim Uddin',   'Queued',  '2026-08-01'],
            ['JOB-007', 'TV unit',            'WAP-004', 'Finishing',    'Kamrul Islam',   'Done',    '2026-06-30'],
            ['JOB-008', 'Kitchen shutters',   'WAP-004', 'Edge Banding', 'Delwar Mia',     'Queued',  '2026-07-26'],
            ['JOB-009', 'Showroom counter',   'WAP-005', 'CNC',          'Mahmudul Hasan', 'Running', '2026-07-09'],
            ['JOB-010', 'Display shelving',   'WAP-005', 'Finishing',    'Jashim Uddin',   'Queued',  null],
            // Deliberately points at a project that does not exist, so the
            // "orphan" path is exercised. The job is real work and is KEPT.
            ['JOB-011', 'Salvaged door trim', 'WAP-999', 'Cutting',      'Omar Faruk',     'Queued',  '2026-07-30'],
            // WAP-102 is the project in PRODUCTION — it must have a live floor.
            ['JOB-101', 'Reception desk carcass', 'WAP-102', 'CNC',          'Omar Faruk',     'Running', '2026-07-10'],
            ['JOB-102', 'Workstation tops',       'WAP-102', 'Cutting',      'Delwar Mia',     'Running', '2026-07-14'],
            ['JOB-103', 'Storage unit shutters',  'WAP-102', 'Edge Banding', 'Kamrul Islam',   'Blocked', '2026-06-30'],
            ['JOB-104', 'Boardroom table',        'WAP-102', 'Assembly',     'Mahmudul Hasan', 'Done',    '2026-06-24'],
            ['JOB-105', 'Panelling — lobby',      'WAP-102', 'Finishing',    'Jashim Uddin',   'Queued',  '2026-07-22'],
            // WAP-103 is at handover, so its jobs are finished.
            ['JOB-106', 'Wardrobe shutters',      'WAP-103', 'Finishing',    'Kamrul Islam',   'Done',    '2026-06-20'],
            ['JOB-107', 'Staircase handrail',     'WAP-103', 'Assembly',     'Omar Faruk',     'Done',    '2026-06-26'],
        ];

        foreach ($rows as [$extId, $job, $project, $station, $assigned, $status, $due]) {
            Job::updateOrCreate(
                ['company_id' => 'woodart', 'ext_id' => $extId],
                [
                    'job'         => $job,
                    'project'     => $project,
                    'station'     => $station,
                    'assigned_to' => $assigned,
                    'status'      => $status,
                    'due'         => $due,
                    'created_on'  => '2026-06-01',
                ]
            );
        }
    }
}
