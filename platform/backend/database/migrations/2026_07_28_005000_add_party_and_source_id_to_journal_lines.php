<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * PER-LINE PARTY, AND THE DOCUMENT A JOURNAL CAME FROM (2026-07-28).
 * ----------------------------------------------------------------------------
 * Two additive columns the SPA now sends and the API had nowhere to put.
 *
 * 1 · journal_items.party — WHO that individual line was with.
 *   The entry already carries a party (migration 2026_07_27_004000), which is
 *   right for a single-counterparty voucher. But one journal can legitimately
 *   span several: a batch payment settling three vendors at once, or one entry
 *   carrying three bills owed to three different suppliers. With only a header
 *   party, each of those parties' statements and ageing buckets showed the whole
 *   entry or none of it. A line's own party wins; blank falls back to the
 *   header, so every existing row reads exactly as it does today.
 *
 *   (The reference ERP carries party columns on journal_items too — but has no
 *   party statement or ageing report to read them with. Ours has both, which is
 *   what makes the per-line detail worth storing.)
 *
 * 2 · journal_entries.source_id — WHICH document produced the journal.
 *   `source` already says the KIND ('sale', 'payroll', 'payment'); source_id says
 *   which one, so a posting can be traced back to the ticket, slip or voucher
 *   that caused it, and the voucher print can name it. `reference` keeps the
 *   human-readable number and is unchanged.
 *
 * Both nullable, both hasColumn-guarded at every write site, so pulling the code
 * before running this migration changes nothing.
 *
 * Run: php artisan migrate
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('journal_items') && ! Schema::hasColumn('journal_items', 'party')) {
            Schema::table('journal_items', function (Blueprint $t) {
                // indexed: a party statement looks its own lines up by it
                $t->string('party', 255)->nullable()->index()->after('credit');
            });
        }
        if (Schema::hasTable('journal_entries') && ! Schema::hasColumn('journal_entries', 'source_id')) {
            Schema::table('journal_entries', function (Blueprint $t) {
                // a string, not an FK: the document lives in whichever table `source`
                // names, and its id may be a client-side string ('TK-88101')
                $t->string('source_id', 64)->nullable()->index()->after('source');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('journal_items') && Schema::hasColumn('journal_items', 'party')) {
            Schema::table('journal_items', function (Blueprint $t) { $t->dropColumn('party'); });
        }
        if (Schema::hasTable('journal_entries') && Schema::hasColumn('journal_entries', 'source_id')) {
            Schema::table('journal_entries', function (Blueprint $t) { $t->dropColumn('source_id'); });
        }
    }
};
