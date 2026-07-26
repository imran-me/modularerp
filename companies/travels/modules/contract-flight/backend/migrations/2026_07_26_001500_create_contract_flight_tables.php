<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Contract Flight — module-owned store tv_contract_flights (block/charter seat
 * contracts + seat sales). Document-style (ext_id/company_id/status + data JSON).
 * Run: php artisan migrate
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('tv_contract_flights')) {
            return;
        }
        Schema::create('tv_contract_flights', function (Blueprint $table) {
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
        Schema::dropIfExists('tv_contract_flights');
    }
};
