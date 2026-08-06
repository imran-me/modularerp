<?php

namespace Epal\Modules\Woodart\Procurement\Database\Seeders;

use Epal\Modules\Woodart\Procurement\Models\PurchaseLine;
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
        /* THE VILLA'S SUPPLIERS. The four civil merchants are the ones the sheet
         * names; the joinery merchants stay because the register stocks their
         * material and the wood-work phase will buy from them next.
         *
         * [ext_id, name, category, contact, phone, area, terms, since] */
        $vendors = [
            ['VEN-001', 'Haji Enterprise',        'Civil',    'Mohsin Boss',    '+8801812000001', 'Munshiganj',     'Advance', '2026-03-01'],
            ['VEN-002', 'Meghna Cement Depot',    'Civil',    'Eman Vai',       '+8801812000002', 'Munshiganj',     'Net 15',  '2026-03-05'],
            ['VEN-003', 'Munshiganj Brick Field', 'Civil',    'Nayeem',         '+8801812000003', 'Munshiganj',     'Advance', '2026-03-02'],
            ['VEN-004', 'Buriganga Sand Traders', 'Civil',    'Azizul Vai',     '+8801812000004', 'Keraniganj',     'Advance', '2026-03-02'],
            ['VEN-005', 'RFL Hardware',           'Hardware', 'Nasrin Sultana', '+8801812000005', 'Mirpur DOHS',    'Advance', '2023-05-27'],
            ['VEN-006', 'Dhaka Electric House',   'General',  'Kamrul Islam',   '+8801812000006', 'Nawabpur',       'Net 15',  '2025-01-12'],
            ['VEN-007', 'Sanitary World BD',      'General',  'Sharmin Jahan',  '+8801812000007', 'Nawabpur',       'Net 15',  '2025-04-08'],
            ['VEN-008', 'Timber World BD',        'Board',    'Mahmudul Hasan', '+8801812000008', 'Wari',           'Net 30',  '2022-11-14'],
            ['VEN-009', 'Akij Board',             'Board',    'Omar Faruk',     '+8801812000009', 'Tejgaon I/A',    'Net 30',  '2024-02-11'],
            ['VEN-010', 'Hatil Trade',            'Laminate', 'Sharmin Jahan',  '+8801812000010', 'Mohakhali DOHS', 'Net 45',  '2023-08-19'],
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

        /* EVERY ORDER THIS PROJECT RAISED, at the sheet's own amounts. The four
         * civil orders are received (the shell is built); the electrical one is
         * part-delivered and the sanitary one only just placed, which is why
         * those two heads have barely any spend against a large budget.
         *
         * [ext_id, supplier, project, items, amount, status, date] */
        $orders = [
            ['WPO-101', 'Haji Enterprise',        'WAP-101', 3, 856397, 'Received', '2026-03-14'],
            ['WPO-102', 'Meghna Cement Depot',    'WAP-101', 1, 273780, 'Received', '2026-03-22'],
            ['WPO-103', 'Munshiganj Brick Field', 'WAP-101', 1, 414000, 'Received', '2026-03-08'],
            ['WPO-104', 'Buriganga Sand Traders', 'WAP-101', 1, 244920, 'Received', '2026-03-05'],
            ['WPO-105', 'RFL Hardware',           'WAP-101', 4,  24160, 'Received', '2026-05-18'],
            ['WPO-106', 'Dhaka Electric House',   'WAP-101', 6,  22800, 'Partial',  '2026-06-20'],
            ['WPO-107', 'Sanitary World BD',      'WAP-101', 5,   7530, 'Ordered',  '2026-06-28'],
        ];

        foreach ($orders as [$extId, $supplier, $project, $items, $amount, $status, $date]) {
            PurchaseOrder::updateOrCreate(
                ['company_id' => 'woodart', 'ext_id' => $extId],
                [
                    'supplier'   => $supplier,
                    'project'    => $project,
                    'items'      => $items,
                    'amount'     => $amount,
                    'status'     => $status,
                    'date'       => $date,
                    'created_on' => $date,
                ]
            );
        }

        /* WHAT EACH ORDER ACTUALLY ORDERS (2026-08-06). Without lines, "ordered
         * 500 bricks" is not a fact the system holds and a part-delivery of 100
         * has nothing to be part of. Quantity is the order's own amount divided
         * by the rate, so a line and its order can never disagree.
         *
         * [order, material ext_id, item, qty, unit, rate] */
        $lines = [
            ['WPO-101', 'MAT-013', 'Rod — BSRM 60 grade',      10075, 'kg',    85],
            ['WPO-102', 'MAT-014', 'Cement — 50 kg bag',         502, 'bag',  545],
            ['WPO-103', 'MAT-015', 'Bricks (1st class)',       34500, 'pcs',   12],
            ['WPO-104', 'MAT-016', 'Sand & bali',               3768, 'cft',   65],
            ['WPO-105', null,      'Civil hardware & fixings',      1, 'lot', 24160],
            ['WPO-106', null,      'Electrical points & wiring',    8, 'point', 2850],
            ['WPO-107', null,      'Sanitary & plumbing set',       1, 'set',  7530],
        ];

        $ln = 0;
        foreach ($lines as [$order, $material, $item, $qty, $unit, $rate]) {
            PurchaseLine::updateOrCreate(
                ['company_id' => 'woodart', 'ext_id' => 'POL-'.str_pad((string) ++$ln, 4, '0', STR_PAD_LEFT)],
                ['order' => $order, 'project' => 'WAP-101', 'material' => $material,
                 'item' => $item, 'qty' => $qty, 'unit' => $unit, 'unit_cost' => $rate]
            );
        }
    }
}