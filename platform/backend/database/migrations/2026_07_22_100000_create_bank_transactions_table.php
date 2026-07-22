<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The "Recent Bank Transactions" log (deposits / withdrawals / transfers /
 * openings). The module controller creates this lazily too, but shared hosting
 * denies DDL at request time ("Operation not permitted") — so it must be created
 * by a migration (`php artisan migrate`) or the equivalent SQL run once in
 * phpMyAdmin. Once it exists, re-enable `bank_txns` in platform/data/api.js
 * HYDRATE + WRITABLE and the log persists to the DB.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('bank_transactions')) {
            return;
        }
        Schema::create('bank_transactions', function (Blueprint $t) {
            $t->id();
            $t->string('client_id', 40)->nullable()->index();
            $t->string('bank_ref', 64)->nullable()->index();
            $t->string('bank_name', 255)->nullable();
            $t->string('type', 30);
            $t->decimal('amount', 15, 2)->default(0);
            $t->date('date')->nullable();
            $t->string('reference', 255)->nullable();
            $t->text('description')->nullable();
            $t->string('gl_id', 64)->nullable();
            $t->softDeletes();
            $t->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('bank_transactions');
    }
};
