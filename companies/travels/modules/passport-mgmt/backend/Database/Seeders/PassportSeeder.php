<?php

namespace Epal\Modules\Travels\PassportMgmt\Database\Seeders;

use Epal\Modules\Travels\PassportMgmt\Models\Passport;
use Illuminate\Database\Seeder;

/**
 * Seeds a few demo passports (mirrors the frontend seed-bd.js sample) so the
 * register + expiry radar have data to serve. Idempotent — skips if rows exist.
 * Run: php artisan db:seed --class="Epal\\Modules\\Travels\\PassportMgmt\\Database\\Seeders\\PassportSeeder"
 */
class PassportSeeder extends Seeder
{
    public function run(): void
    {
        if (Passport::query()->exists()) {
            return;
        }

        $rows = [
            ['holder' => 'Md Rahim Uddin',  'passport_no' => 'A01234567', 'type' => 'E-Passport', 'nationality' => 'Bangladesh',     'dob' => '1990-04-12', 'issue_date' => '2021-06-01', 'expiry' => '2031-05-31', 'phone' => '+8801711000001'],
            ['holder' => 'Ayesha Siddiqua', 'passport_no' => 'B07654321', 'type' => 'MRP',        'nationality' => 'Bangladesh',     'dob' => '1988-11-02', 'issue_date' => '2016-02-10', 'expiry' => '2026-09-30', 'phone' => '+8801711000002'],
            ['holder' => 'John Carter',     'passport_no' => 'X99887766', 'type' => 'Official',   'nationality' => 'United Kingdom', 'dob' => '1979-01-20', 'issue_date' => '2018-07-15', 'expiry' => '2026-07-31', 'phone' => '+8801711000003'],
        ];

        foreach ($rows as $r) {
            $r['company_id'] = 2;   // travels
            Passport::create($r);
        }
    }
}
