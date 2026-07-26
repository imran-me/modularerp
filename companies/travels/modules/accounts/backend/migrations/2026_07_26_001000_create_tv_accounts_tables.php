<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Travels Accounts — module-owned stores for the money desk: tv_recurring
 * (recurring expense templates), tv_cheques (cheque register), tv_petty (petty
 * cash / IOU register). Document-style (ext_id / company_id / status columns +
 * the full frontend record in `data` JSON) so the exact store shape round-trips.
 * The income/expense register (acc_entries), schedules and banks are served by
 * the Master Accounts backend; these three are Travels-Accounts-owned.
 * Run: php artisan migrate
 */
return new class extends Migration
{
    public function up(): void
    {
        foreach (['tv_recurring', 'tv_cheques', 'tv_petty'] as $t) {
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
        foreach (['tv_petty', 'tv_cheques', 'tv_recurring'] as $t) {
            Schema::dropIfExists($t);
        }
    }
};
