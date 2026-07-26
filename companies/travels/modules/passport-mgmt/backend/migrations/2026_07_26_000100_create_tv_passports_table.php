<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Passports — module-owned table for Travels Passport Management. Auto-discovered
 * by ModuleServiceProvider (loadMigrationsFrom); delete the module folder and this
 * migration goes with it. Serves the frontend `tv_passports` store.
 * Run once on a server: php artisan migrate
 *   (or scoped: php artisan migrate --path=../../companies/travels/modules/passport-mgmt/backend/migrations)
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('tv_passports')) {
            return;
        }
        Schema::create('tv_passports', function (Blueprint $table) {
            $table->id();
            $table->string('holder');
            $table->string('passport_no')->index();
            $table->string('type')->default('E-Passport');   // E-Passport | MRP | Official
            $table->string('nationality')->nullable();
            $table->date('dob')->nullable();
            $table->date('issue_date')->nullable();
            $table->date('expiry')->nullable()->index();
            $table->string('phone')->nullable();
            $table->unsignedBigInteger('company_id')->nullable()->index();
            $table->softDeletes();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('tv_passports');
    }
};
