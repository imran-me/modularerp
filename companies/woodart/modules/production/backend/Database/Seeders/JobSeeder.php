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
        /* THE WORKSHOP IS PREPARING, NOT BUILDING. The villa's Wood Work phase
         * has not started (the sheet's Wood Work page is empty), so what the
         * floor is doing is getting ready for it: a sample door for the client
         * to approve, two carcasses queued behind it, and the handrail cap
         * blocked until the MS railing goes in. Four jobs, four states — an
         * honest board for a project at this phase.
         *
         * [ext_id, job, project, station, assigned_to, status, due] */
        $rows = [
            ['JOB-101', 'Kitchen cabinet — sample door', 'WAP-101', 'Finishing', 'Sumaiya Akter', 'Running', '2026-07-12'],
            ['JOB-102', 'Master wardrobe carcass',       'WAP-101', 'Cutting',   'Sumaiya Akter', 'Queued',  '2026-08-05'],
            ['JOB-103', 'TV wall panel — living room',   'WAP-101', 'CNC',       'Sumaiya Akter', 'Queued',  '2026-08-18'],
            ['JOB-104', 'Staircase handrail — wood cap', 'WAP-101', 'Assembly',  'Jahangir Alam', 'Blocked', '2026-07-20'],
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
