<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Loan books — the Manage Loan desk (shared kit platform/kit/loans.js), hosted in
 * Master Accounts. Four stores: loan_products (lookup), loans_ext (loans GIVEN),
 * loans_taken (borrowings), loan_txns (movement log). Kept SEPARATE from the GL
 * (owner rule: the loan book is outside the main accounts), so no ledger linkage.
 *
 * These records are field-rich and carry computed arrays (the EMI `schedule`), so
 * each table keeps the queryable keys as columns (ext_id / company_id / status) and
 * the full frontend record in a `data` JSON column — the exact store shape round-trips.
 * Run: php artisan migrate
 */
return new class extends Migration
{
    public function up(): void
    {
        foreach (['loan_products', 'loans_ext', 'loans_taken', 'loan_txns'] as $t) {
            if (Schema::hasTable($t)) {
                continue;
            }
            Schema::create($t, function (Blueprint $table) {
                $table->id();
                $table->string('ext_id')->unique();               // the frontend id
                $table->string('company_id')->nullable()->index(); // frontend slug
                $table->string('status')->nullable();
                $table->json('data');                              // the full frontend record
                $table->timestamps();
            });
        }
    }

    public function down(): void
    {
        foreach (['loan_txns', 'loans_taken', 'loans_ext', 'loan_products'] as $t) {
            Schema::dropIfExists($t);
        }
    }
};
