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
        /* ONE PROJECT, ONE CLIENT. The directory used to carry ten names, nine
         * of which had no work against them once Interior was cut back to a
         * single job — a directory of strangers reads as a broken join.
         *
         * [ext_id, name, type, contact, phone, area, since] */
        $rows = [
            ['CLI-001', 'Munshi Billah', 'Homeowner', 'Munshi Billah', '+8801712000001', 'Munshiganj', '2026-02-20'],
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
