<?php

/**
 * WOODART INTERIORS — the company's demo-data manifest.
 * ----------------------------------------------------------------------------
 * Read by `php artisan epal:reseed woodart` (platform/backend/app/Console/
 * Commands/ReseedCompany.php). It answers two questions and nothing else:
 *
 *   WHAT IS MINE TO CLEAR?   the `wa_` tables, plus this company's rows in the
 *                            shared money tables — named explicitly, so the
 *                            command can never reach past them.
 *   IN WHAT ORDER DO I SEED? dependencies first: the project and its BOQ exist
 *                            before the scope module allocates them into rooms.
 *
 * WHY THE LIST IS HERE AND NOT IN THE PLATFORM. A company folder is drop-in /
 * drop-out. Delete `companies/woodart/` and this file goes with it, and the
 * command simply reports that the company has no manifest — nothing central to
 * edit, nothing left behind pointing at tables nobody owns.
 *
 * WHY IT IS A LIST AND NOT "every table with a company_id column". That rule
 * would also sweep `employees`, whose rows no Woodart seeder recreates —
 * clearing them would delete three real people and orphan every payslip in the
 * payroll history. An explicit list cannot over-reach by accident.
 */

return [

    /* Tables owned outright by this company. Every row in them is Woodart's. */
    'prefix' => 'wa_',

    /* Shared tables where only this company's rows may be cleared. The command
     * deletes WHERE company_id = 'woodart' and nothing else — Travels, IT, Shop,
     * Construction and the Group are untouched. */
    'shared' => [
        'acc_entries',
        'acc_schedules',
        'sales',
    ],

    /* NEVER cleared, even though they carry woodart rows: nothing in this
     * company's seeders would put them back.
     *   employees — three real people, and every payslip references them
     *   banks     — the money seeder updates its row in place, never recreates it */
    'keep' => [
        'employees',
        'banks',
    ],

    /* DEPENDENCY ORDER. Each seeder is idempotent on its own; the order matters
     * because later ones read what earlier ones wrote:
     *   ProjectSeeder writes the BOQ  →  BudgetSeeder rolls it up by cost code
     *                                 →  ScopeSeeder allocates it across rooms
     *   MaterialSeeder writes the register → StockLedgerSeeder explains its
     *                                        numbers with movements */
    'seeders' => [
        \Epal\Modules\Woodart\Projects\Database\Seeders\CostCodeSeeder::class,
        \Epal\Modules\Woodart\Clients\Database\Seeders\ClientSeeder::class,
        \Epal\Modules\Woodart\Materials\Database\Seeders\MaterialSeeder::class,
        \Epal\Modules\Woodart\Procurement\Database\Seeders\ProcurementSeeder::class,
        \Epal\Modules\Woodart\Projects\Database\Seeders\ProjectSeeder::class,
        \Epal\Modules\Woodart\Projects\Database\Seeders\BudgetSeeder::class,
        \Epal\Modules\Woodart\Scope\Database\Seeders\ScopeSeeder::class,
        \Epal\Modules\Woodart\Design\Database\Seeders\DesignSeeder::class,
        \Epal\Modules\Woodart\Production\Database\Seeders\JobSeeder::class,
        \Epal\Modules\Woodart\Installation\Database\Seeders\InstallSeeder::class,
        \Epal\Modules\Woodart\Materials\Database\Seeders\StockLedgerSeeder::class,
        \Epal\Modules\Woodart\Accounts\Database\Seeders\RecurringSeeder::class,
        \Epal\Modules\Woodart\Accounts\Database\Seeders\WoodartMoneySeeder::class,
    ],
];
