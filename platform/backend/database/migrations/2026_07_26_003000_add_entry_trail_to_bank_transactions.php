<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Tie a bank movement back to the VOUCHER that caused it (owner 2026-07-26).
 * ----------------------------------------------------------------------------
 * An expense paid from a real account writes a withdrawal row here. When that
 * voucher is later deleted, the account has to be given its money back — which
 * means finding the row it created. `gl_id` is not enough on its own (a funded
 * expense's row carries the FUNDER's journal id), so:
 *   entry_ref  the acc_entries voucher id ('JV-A1B2C3')
 *   reversed   already given back — so it can never be reversed twice
 *
 * Matches the frontend `bank_txns` record, which carries the same two fields
 * (see bankTxnApply + syncRegisterLeg). Run: php artisan migrate
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('bank_transactions')) {
            return;                              // created later, with these columns
        }
        Schema::table('bank_transactions', function (Blueprint $t) {
            if (! Schema::hasColumn('bank_transactions', 'entry_ref')) {
                $t->string('entry_ref', 64)->nullable()->index()->after('gl_id');
            }
            if (! Schema::hasColumn('bank_transactions', 'reversed')) {
                $t->boolean('reversed')->default(false)->after('entry_ref');
            }
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('bank_transactions')) {
            return;
        }
        Schema::table('bank_transactions', function (Blueprint $t) {
            foreach (['entry_ref', 'reversed'] as $col) {
                if (Schema::hasColumn('bank_transactions', $col)) {
                    $t->dropColumn($col);
                }
            }
        });
    }
};
