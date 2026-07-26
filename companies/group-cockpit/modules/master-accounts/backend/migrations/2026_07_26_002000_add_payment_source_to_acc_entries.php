<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * WHICH ACCOUNT the money left (owner 2026-07-26).
 * ----------------------------------------------------------------------------
 * `method` only ever said HOW ('Bank', 'Cash') — never WHICH account, so a spend
 * could not be tied back to the bank/cash box whose balance it moved. These three
 * columns close that loop:
 *   bank_id   the `banks` row the money left (nullable: a cheque or a card swipe
 *             may not have a registered account behind it)
 *   bank_name captured at posting time, so the voucher still prints correctly if
 *             the account is later renamed
 *   pay_acct  the GL side that was credited ('1000' hard cash | '1010' bank) —
 *             pinned per entry instead of re-derived from the method wording, so
 *             a re-post or a reversal can never land on the other account
 *
 * Run: php artisan migrate
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('acc_entries')) {
            return;                                  // created with the columns already
        }
        Schema::table('acc_entries', function (Blueprint $table) {
            if (! Schema::hasColumn('acc_entries', 'bank_id')) {
                $table->string('bank_id', 40)->nullable()->index()->after('method');
            }
            if (! Schema::hasColumn('acc_entries', 'bank_name')) {
                $table->string('bank_name')->nullable()->after('bank_id');
            }
            if (! Schema::hasColumn('acc_entries', 'pay_acct')) {
                $table->string('pay_acct', 20)->nullable()->after('bank_name');
            }
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('acc_entries')) {
            return;
        }
        Schema::table('acc_entries', function (Blueprint $table) {
            foreach (['bank_id', 'bank_name', 'pay_acct'] as $col) {
                if (Schema::hasColumn('acc_entries', $col)) {
                    $table->dropColumn($col);
                }
            }
        });
    }
};
