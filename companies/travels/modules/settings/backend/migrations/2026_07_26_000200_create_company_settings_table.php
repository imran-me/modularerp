<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Company settings — one JSON blob of per-company configuration (profile,
 * financial defaults, document numbering, notification prefs). Module-owned by
 * the Travels settings module but the table is generic (keyed by company_id), so
 * every company's settings module reads/writes its own row. Auto-discovered by
 * ModuleServiceProvider. Run: php artisan migrate
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('company_settings')) {
            return;
        }
        Schema::create('company_settings', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('company_id')->unique();
            $table->json('data')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('company_settings');
    }
};
