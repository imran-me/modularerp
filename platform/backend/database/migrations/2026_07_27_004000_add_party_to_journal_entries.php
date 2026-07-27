<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * WHO the journal entry was with (fixed 2026-07-27).
 * ----------------------------------------------------------------------------
 * The SPA has always sent `party` on every posting — a customer, a vendor, a
 * sub-agent, or a SISTER CONCERN — and the API silently dropped it:
 * journal_entries had no column for it, and JournalController::index handed back
 * `'party' => ''`. So in API mode the party was lost the moment it round-tripped.
 *
 * That is not cosmetic. Party is what these read:
 *   · the Party Ledger (a customer's or vendor's own statement),
 *   · AR/AP ageing by counterparty,
 *   · **inter-company balances** — "Travels owes Group ৳40,000" is derived by
 *     grouping 1300/2400 lines by party. With party blank, the Travels Accounts
 *     "Inter-company balances" card and its Settle button had nothing to show
 *     after a reload on the live site.
 *
 * Nullable and additive: existing rows simply have no party, and every write path
 * only fills it when this column exists (LedgerService::post is hasColumn-guarded),
 * so pulling the code before running this migration changes nothing.
 *
 * Run: php artisan migrate
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('journal_entries') || Schema::hasColumn('journal_entries', 'party')) {
            return;
        }
        Schema::table('journal_entries', function (Blueprint $t) {
            // indexed: the party ledger and the inter-company positions both look up by it
            $t->string('party', 255)->nullable()->index()->after('source');
        });
    }

    public function down(): void
    {
        if (Schema::hasTable('journal_entries') && Schema::hasColumn('journal_entries', 'party')) {
            Schema::table('journal_entries', function (Blueprint $t) {
                $t->dropColumn('party');
            });
        }
    }
};
