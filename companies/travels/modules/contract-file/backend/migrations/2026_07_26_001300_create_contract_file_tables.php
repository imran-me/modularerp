<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Contract File — module-owned store tv_contracts (manpower/service contract
 * master). Document-style (ext_id/company_id/status + data JSON). Run: php artisan migrate
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('tv_contracts')) {
            return;
        }
        Schema::create('tv_contracts', function (Blueprint $table) {
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
        Schema::dropIfExists('tv_contracts');
    }
};
