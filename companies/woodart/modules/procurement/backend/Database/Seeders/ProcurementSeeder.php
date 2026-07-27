<?php

namespace Epal\Modules\Woodart\Procurement\Database\Seeders;

use Epal\Modules\Woodart\Procurement\Models\PurchaseOrder;
use Epal\Modules\Woodart\Procurement\Models\Vendor;
use Illuminate\Database\Seeder;

/**
 * Seeds Woodart's vendor directory and a realistic purchase-order book.
 *
 * The vendor names are the same five suppliers the material register uses
 * (see MaterialSeeder), so the two modules describe the same business. The
 * orders reference those vendors BY NAME — the join this module is built on —
 * and one order is deliberately raised on a supplier who is NOT in the vendor
 * master, so the "unlisted" path has real data to exercise.
 *
 * Idempotent: keyed on (company_id, ext_id) via updateOrCreate.
 *
 * Run: php artisan db:seed --class="Epal\Modules\Woodart\Procurement\Database\Seeders\ProcurementSeeder"
 */
class ProcurementSeeder extends Seeder
{
    public function run(): void
    {
        $vendors = [
            // [ext_id, name, category, contact, phone, area, terms, since]
            ['VEN-001', 'Akij Board',      'Board',    'Omar Faruk',      '+8801812000001', 'Tejgaon I/A',   'Net 30',  '2024-02-11'],
            ['VEN-002', 'Hatil Trade',     'Fabric',   'Sharmin Jahan',   '+8801812000002', 'Mohakhali DOHS','Net 45',  '2023-08-19'],
            ['VEN-003', 'Partex Star',     'Board',    'Kamrul Islam',    '+8801812000003', 'Motijheel C/A', 'Net 15',  '2024-06-02'],
            ['VEN-004', 'RFL Hardware',    'Hardware', 'Nasrin Sultana',  '+8801812000004', 'Mirpur DOHS',   'Advance', '2023-05-27'],
            ['VEN-005', 'Timber World BD', 'Board',    'Mahmudul Hasan',  '+8801812000005', 'Wari',          'Net 30',  '2022-11-14'],
        ];

        foreach ($vendors as [$extId, $name, $category, $contact, $phone, $area, $terms, $since]) {
            $slug = strtolower(trim(preg_replace('/[^A-Za-z0-9]+/', '.', $name), '.'));

            Vendor::updateOrCreate(
                ['company_id' => 'woodart', 'ext_id' => $extId],
                [
                    'name'       => $name,
                    'category'   => $category,
                    'contact'    => $contact,
                    'phone'      => $phone,
                    'email'      => $slug . '@supply.example.bd',
                    'area'       => $area,
                    'terms'      => $terms,
                    'since'      => $since,
                    'created_on' => '2026-05-14',
                ]
            );
        }

        $orders = [
            // [ext_id, supplier, items, amount, status, date]
            ['WPO-001', 'Timber World BD', 8,  340000, 'Received', '2026-04-02'],
            ['WPO-002', 'Akij Board',      5,  186000, 'Received', '2026-04-19'],
            ['WPO-003', 'RFL Hardware',   12,   96000, 'Partial',  '2026-05-06'],
            ['WPO-004', 'Partex Star',     4,  128000, 'Ordered',  '2026-05-21'],
            ['WPO-005', 'Hatil Trade',     6,  212000, 'Received', '2026-06-03'],
            ['WPO-006', 'Timber World BD', 9,  405000, 'Ordered',  '2026-06-18'],
            ['WPO-007', 'RFL Hardware',    7,   74000, 'Received', '2026-06-29'],
            // Deliberately raised on a supplier with NO vendor record, so the
            // "unlisted" path has data. Money left the business either way.
            ['WPO-008', 'Dhaka Glass Co',  3,   58000, 'Ordered',  '2026-07-01'],
        ];

        foreach ($orders as [$extId, $supplier, $items, $amount, $status, $date]) {
            PurchaseOrder::updateOrCreate(
                ['company_id' => 'woodart', 'ext_id' => $extId],
                [
                    'supplier'   => $supplier,
                    'items'      => $items,
                    'amount'     => $amount,
                    'status'     => $status,
                    'date'       => $date,
                    'created_on' => $date,
                ]
            );
        }
    }
}
