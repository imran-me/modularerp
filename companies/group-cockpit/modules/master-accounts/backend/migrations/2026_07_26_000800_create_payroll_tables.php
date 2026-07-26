<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Payroll books — the Master Payroll desk (shared engine platform/engines-library/
 * payroll.js), hosted in Master Accounts and used by every company. Four stores:
 * pay_templates (salary structure per company), pay_runs (a month's run),
 * pay_slips (per employee per month), pay_txns (advance / loan / repayment).
 *
 * Slips + runs carry many computed fields, so — like the loan books — each table
 * keeps the queryable keys as columns (ext_id / company_id / status) and the full
 * frontend record in a `data` JSON column, so the exact store shape round-trips.
 * The salary ACCRUAL to the GL stays where it is (the engine posts journals that
 * persist via JournalController); this backend persists the payroll STATE only.
 * Run: php artisan migrate
 */
return new class extends Migration
{
    public function up(): void
    {
        foreach (['pay_templates', 'pay_runs', 'pay_slips', 'pay_txns'] as $t) {
            if (Schema::hasTable($t)) {
                continue;
            }
            Schema::create($t, function (Blueprint $table) {
                $table->id();
                $table->string('ext_id')->unique();
                $table->string('company_id')->nullable()->index();
                $table->string('status')->nullable();
                $table->json('data');
                $table->timestamps();
            });
        }
    }

    public function down(): void
    {
        foreach (['pay_txns', 'pay_slips', 'pay_runs', 'pay_templates'] as $t) {
            Schema::dropIfExists($t);
        }
    }
};
