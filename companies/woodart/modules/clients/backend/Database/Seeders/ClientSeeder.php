<?php

namespace Epal\Modules\Woodart\Clients\Database\Seeders;

use Epal\Modules\Woodart\Clients\Models\Client;
use Illuminate\Database\Seeder;

/**
 * Seeds a realistic Woodart client directory.
 *
 * The names mirror the demo data in platform/data/seed-bd.js so the API-mode
 * screen and the demo-mode screen tell the same story — a developer comparing
 * the two should not have to wonder whether a difference is a bug.
 *
 * Classification follows the same STATED rule the frontend seed uses: a
 * corporate name carrying "Group"/"Holdings" is a Developer, any other
 * corporate name is a Corporate, and an individual is a Homeowner. It is a
 * rule, not a random pick, so both sides land on the same segment.
 *
 * Idempotent: keyed on (company_id, ext_id) via updateOrCreate, so running it
 * twice does not duplicate.
 *
 * Run: php artisan db:seed --class="Epal\Modules\Woodart\Clients\Database\Seeders\ClientSeeder"
 */
class ClientSeeder extends Seeder
{
    public function run(): void
    {
        $rows = [
            // [ext_id, name, type, contact, phone, area, since]
            ['CLI-001', 'ACI Limited',            'Corporate', 'Nasrin Sultana', '+8801712000001', 'Tejgaon I/A',               '2024-03-11'],
            ['CLI-002', 'Akij Group',             'Developer', 'Mahmudul Hasan', '+8801712000002', 'Motijheel C/A',             '2023-11-02'],
            ['CLI-003', 'Ashraful Karim',         'Homeowner', 'Ashraful Karim', '+8801712000003', 'Gulshan-2',                 '2025-01-19'],
            ['CLI-004', 'Bashundhara Group',      'Developer', 'Farzana Yasmin', '+8801712000004', 'Bashundhara R/A',           '2023-06-24'],
            ['CLI-005', 'Concord Group',          'Developer', 'Omar Faruk',     '+8801712000005', 'Banani DOHS',               '2024-08-30'],
            ['CLI-006', 'Farzana Yasmin',         'Homeowner', 'Farzana Yasmin', '+8801712000006', 'Dhanmondi 27',              '2025-05-14'],
            ['CLI-007', 'Rahimafrooz',            'Corporate', 'Kamrul Islam',   '+8801712000007', 'Mohakhali DOHS',            '2024-01-08'],
            ['CLI-008', 'Shanta Holdings',        'Developer', 'Sharmin Jahan',  '+8801712000008', 'Baridhara Diplomatic Zone', '2023-09-17'],
            ['CLI-009', 'Square Pharmaceuticals', 'Corporate', 'Touhidul Alam',  '+8801712000009', 'Uttara Sector 7',           '2024-12-01'],
            ['CLI-010', 'Taslima Begum',          'Homeowner', 'Taslima Begum',  '+8801712000010', 'Mirpur DOHS',               '2025-07-03'],
        ];

        foreach ($rows as [$extId, $name, $type, $contact, $phone, $area, $since]) {
            $slug = strtolower(trim(preg_replace('/[^A-Za-z0-9]+/', '.', $name), '.'));

            Client::updateOrCreate(
                ['company_id' => 'woodart', 'ext_id' => $extId],
                [
                    'name'       => $name,
                    'type'       => $type,
                    'contact'    => $contact,
                    'phone'      => $phone,
                    'email'      => $slug . ($type === 'Homeowner' ? '@mail.example.bd' : '@corp.example.bd'),
                    'area'       => $area,
                    'since'      => $since,
                    'created_on' => '2026-05-14',
                ]
            );
        }
    }
}
