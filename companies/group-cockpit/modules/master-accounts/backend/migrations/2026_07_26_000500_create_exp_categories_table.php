<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Expense categories — module-owned lookup for Master Accounts Operational
 * Expenses (a category name + its sub-category list). Serves the frontend
 * `exp_categories` store. company_id is a frontend slug (nullable = group-wide).
 * Run: php artisan migrate
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('exp_categories')) {
            return;
        }
        Schema::create('exp_categories', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->json('subs')->nullable();               // ['Stationery', 'Cleaning', …]
            $table->boolean('active')->default(true);
            $table->string('company_id')->nullable()->index();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('exp_categories');
    }
};
