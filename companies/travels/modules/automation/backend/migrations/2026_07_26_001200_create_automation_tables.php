<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Automation — module-owned stores: tv_automation (automation rules) and
 * tv_markup (pricing markup rules). Document-style (ext_id/company_id/status +
 * data JSON) so the exact frontend record round-trips. Run: php artisan migrate
 */
return new class extends Migration
{
    public function up(): void
    {
        foreach (['tv_automation', 'tv_markup'] as $t) {
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
        Schema::dropIfExists('tv_markup');
        Schema::dropIfExists('tv_automation');
    }
};
