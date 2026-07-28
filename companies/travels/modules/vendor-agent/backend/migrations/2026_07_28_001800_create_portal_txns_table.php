<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * THE PORTAL WALLET STATEMENT (2026-07-28).
 * ----------------------------------------------------------------------------
 * A booking portal holds our money: we wire Sabre or Galileo a float and draw
 * tickets against it. The SPA now treats that float as what it is — a prepayment
 * asset on 1180, with one sub-account per portal — and writes a row for every
 * movement: the top-up that funded it, and each booking that drew it down, with
 * the balance before and after and the journal it posted.
 *
 * Until this table existed those rows lived only in the browser, so a reload lost
 * the statement while the ledger kept the money. Same document shape as the other
 * five vendor-agent stores (ext_id / company_id / status / data JSON), so it is
 * served by the same controller and needs no new plumbing.
 *
 * The BALANCE is not stored here — it is on the portal record and, authoritatively,
 * on the ledger (1180-<portal>). This is the statement, not the source of truth.
 *
 * Run: php artisan migrate
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('tv_portal_txns')) {
            return;
        }
        Schema::create('tv_portal_txns', function (Blueprint $table) {
            $table->id();
            $table->string('ext_id')->unique();          // the client id (PW-…)
            $table->string('company_id')->nullable()->index();
            $table->string('status')->nullable();
            $table->json('data');                        // portalId, kind, amount, opening/closing, ref, glId…
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('tv_portal_txns');
    }
};
