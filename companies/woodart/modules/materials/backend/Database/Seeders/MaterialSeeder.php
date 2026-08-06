<?php

namespace Epal\Modules\Woodart\Materials\Database\Seeders;

use Epal\Modules\Woodart\Materials\Models\Material;
use Illuminate\Database\Seeder;

/**
 * Seeds a realistic Woodart material register.
 *
 * The rows mirror the demo data in platform/data/seed-bd.js so the API-mode
 * screen and the demo-mode screen tell the same story — a developer comparing
 * the two should not have to wonder whether a difference is a bug.
 *
 * Idempotent: keyed on (company_id, ext_id) via updateOrCreate, so running it
 * twice does not duplicate. Safe to re-run after a schema change.
 *
 * Run:  php artisan db:seed --class="Epal\Modules\Woodart\Materials\Database\Seeders\MaterialSeeder"
 */
class MaterialSeeder extends Seeder
{
    public function run(): void
    {
        /* [ext_id, name, category, unit, stock, reorder, unit_cost, supplier]
         *
         * MAT-013..016 are the CIVIL BULK the Munshi Villa build actually bought
         * and consumed. Their rates are the sheet's own, so a purchase order, a
         * BOQ line and the stock value all quote the same number — and what is
         * left is what the movement ledger nets to: rod ৳8,56,397 at ৳85/kg is
         * 10,075 kg received, 9,700 issued to site, 194 cut waste, 181 left. */
        $rows = [
            ['MAT-001', 'Marine Plywood 18mm',    'Board',    'sheet', 142,   40, 3610, 'Timber World BD'],
            ['MAT-002', 'Veneer Board',           'Board',    'sheet',  38,   25, 4200, 'Akij Board'],
            ['MAT-003', 'MDF 12mm',               'Board',    'sheet',  16,   30, 1850, 'Partex Star'],
            ['MAT-004', 'Formica Laminate',       'Laminate', 'sheet',  88,   35, 1250, 'Hatil Trade'],
            ['MAT-005', 'German Hinge (Hettich)', 'Hardware', 'pcs',   420,  150,  335, 'RFL Hardware'],
            ['MAT-006', 'Drawer Channel 18"',     'Hardware', 'pcs',    64,  100,  540, 'RFL Hardware'],
            ['MAT-007', 'SS Handle',              'Hardware', 'pcs',   210,   80,  185, 'RFL Hardware'],
            ['MAT-008', 'Wood Glue 5kg',          'Adhesive', 'kg',     52,   20,  760, 'Timber World BD'],
            ['MAT-009', 'NC Lacquer',             'Finish',   'litre',  28,   30, 1065, 'Akij Board'],
            ['MAT-010', 'PU Polish',              'Finish',   'litre',  44,   20, 1420, 'Akij Board'],
            ['MAT-011', 'Fabric — Velvet',        'Fabric',   'sft',   160,   60,  420, 'Hatil Trade'],
            ['MAT-012', 'Foam 4"',                'Fabric',   'sft',     0,   50,  260, 'Hatil Trade'],
            ['MAT-013', 'Rod — BSRM 60 grade',    'Civil',    'kg',    181,  500,   85, 'Haji Enterprise'],
            ['MAT-014', 'Cement — 50 kg bag',     'Civil',    'bag',    12,   50,  545, 'Meghna Cement Depot'],
            ['MAT-015', 'Bricks (1st class)',     'Civil',    'pcs',   500, 2000,   12, 'Munshiganj Brick Field'],
            ['MAT-016', 'Sand & bali',            'Civil',    'cft',    68,  300,   65, 'Buriganga Sand Traders'],
        ];

        foreach ($rows as [$extId, $name, $category, $unit, $stock, $reorder, $cost, $supplier]) {
            Material::updateOrCreate(
                ['company_id' => 'woodart', 'ext_id' => $extId],
                [
                    'name'       => $name,
                    'category'   => $category,
                    'unit'       => $unit,
                    'stock'      => $stock,
                    'reorder'    => $reorder,
                    'unit_cost'  => $cost,
                    'supplier'   => $supplier,
                    'created_on' => '2026-05-14',
                ]
            );
        }
    }
}
