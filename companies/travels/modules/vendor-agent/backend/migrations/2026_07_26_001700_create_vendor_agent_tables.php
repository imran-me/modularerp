<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Vendor & Agent — module-owned stores: tv_agents (sub-agents), vendors, party_txns
 * (party ledger movements), tv_comm_paid (commissions paid), tv_portals (portal
 * wallets). Document-style (ext_id/company_id/status + data JSON). Run: php artisan migrate
 */
return new class extends Migration
{
    public function up(): void
    {
        foreach (['tv_agents', 'vendors', 'party_txns', 'tv_comm_paid', 'tv_portals'] as $t) {
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
        foreach (['tv_portals', 'tv_comm_paid', 'party_txns', 'vendors', 'tv_agents'] as $t) {
            Schema::dropIfExists($t);
        }
    }
};
