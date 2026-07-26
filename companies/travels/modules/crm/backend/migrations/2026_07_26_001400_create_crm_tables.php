<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * CRM — module-owned stores: leads (the pipeline) and crm_activities (the
 * activity log). Document-style (ext_id/company_id/status + data JSON).
 * Run: php artisan migrate
 */
return new class extends Migration
{
    public function up(): void
    {
        foreach (['leads', 'crm_activities'] as $t) {
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
        Schema::dropIfExists('crm_activities');
        Schema::dropIfExists('leads');
    }
};
