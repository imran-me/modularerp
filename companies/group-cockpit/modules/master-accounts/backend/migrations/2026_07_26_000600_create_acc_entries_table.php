<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Account entries — the income/expense register for Master Accounts (and the
 * concern Accounts desks). Serves the frontend `acc_entries` store. Each row
 * mirrors into the GL (GL-ACC-<id> / GL-MX-<id>), so we keep the FRONTEND id in
 * `ext_id` (unique) and return it verbatim — the mirror linkage stays stable
 * across a hydrate, so nothing re-posts or double-counts. Run: php artisan migrate
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('acc_entries')) {
            return;
        }
        Schema::create('acc_entries', function (Blueprint $table) {
            $table->id();
            $table->string('ext_id')->unique();             // the frontend id ('JV-…')
            $table->string('company_id')->default('group')->index();
            $table->string('kind')->default('Expense');     // Income | Expense
            $table->decimal('amount', 14, 2)->default(0);
            $table->string('category')->nullable();
            $table->string('sub_category')->nullable();
            $table->string('head')->nullable();             // COA code the mirror debits/credits
            $table->string('method')->nullable();
            $table->date('date')->nullable();
            $table->string('party')->nullable();
            $table->string('ref')->nullable();
            $table->text('description')->nullable();
            $table->json('items')->nullable();              // optional line items
            $table->boolean('alloc')->default(false);       // shared-cost allocation share
            $table->string('funded_by')->nullable();        // inter-company funding source slug
            $table->string('created')->nullable();          // frontend-supplied created date
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('acc_entries');
    }
};
