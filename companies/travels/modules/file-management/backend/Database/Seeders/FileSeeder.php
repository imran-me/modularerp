<?php

namespace Epal\Modules\Travels\FileManagement\Database\Seeders;

use Epal\Modules\Travels\FileManagement\Models\VisaFile;
use Illuminate\Database\Seeder;

/**
 * Seeds a few demo embassy files (mirrors seed-bd.js) so the tracker has data.
 * Idempotent — skips if rows exist.
 */
class FileSeeder extends Seeder
{
    public function run(): void
    {
        if (VisaFile::query()->exists()) {
            return;
        }

        $rows = [
            ['applicant' => 'Md Rahim Uddin',  'passport' => 'B1234567', 'country' => 'Cyprus',  'agent' => 'Nadia Karim', 'submit_date' => '2026-06-10', 'decision_due' => '2026-09-10', 'embassy_status' => 'Submitted',        'embassy_fee' => 30000, 'service_fee' => 15000, 'pay_status' => 'Paid'],
            ['applicant' => 'Ayesha Siddiqua', 'passport' => 'B7654321', 'country' => 'Romania', 'agent' => 'Rafiul Islam', 'submit_date' => '2026-06-22', 'decision_due' => '2026-09-22', 'embassy_status' => 'Decision Pending', 'embassy_fee' => 25000, 'service_fee' => 12000, 'pay_status' => 'Due'],
            ['applicant' => 'Tanvir Hasan',    'passport' => 'A9988776', 'country' => 'Malta',   'agent' => 'Nadia Karim', 'submit_date' => '2026-07-01', 'decision_due' => '2026-10-01', 'embassy_status' => 'Slot Booked',      'embassy_fee' => 40000, 'service_fee' => 20000, 'pay_status' => 'Partial'],
        ];

        foreach ($rows as $r) {
            $r['total'] = $r['embassy_fee'] + $r['service_fee'];
            $r['company_id'] = 2;
            VisaFile::create($r);
        }
    }
}
