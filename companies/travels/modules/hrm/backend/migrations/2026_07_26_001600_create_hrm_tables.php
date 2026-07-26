<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * HRM — module-owned store tv_leaves (leave applications/register). Employees and
 * users are shared (served by the group/employees backend), so only leaves are
 * owned here. Document-style (ext_id/company_id/status + data JSON). Run: php artisan migrate
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('tv_leaves')) {
            return;
        }
        Schema::create('tv_leaves', function (Blueprint $table) {
            $table->id();
            $table->string('ext_id')->unique();
            $table->string('company_id')->nullable()->index();
            $table->string('status')->nullable();
            $table->json('data');
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('tv_leaves');
    }
};
