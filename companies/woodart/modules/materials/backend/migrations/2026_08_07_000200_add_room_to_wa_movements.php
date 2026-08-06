<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A movement gains the ROOM it was for, and the ORDER it came from.
 *
 * `ref` already said WAP-101. That answers "which job" but not "which room",
 * so a room could be planned 500 bricks and there was no way to say how many it
 * actually took. And a receipt could not point at the order that bought it, so
 * a part-delivery was just a number arriving from nowhere.
 *
 * Both columns are nullable and additive: every existing row keeps working, and
 * a movement with no room is still a perfectly good movement (a workshop
 * receipt is not "for" a room).
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('wa_movements')) {
            return;
        }
        Schema::table('wa_movements', function (Blueprint $table) {
            if (! Schema::hasColumn('wa_movements', 'phase')) {
                $table->string('phase', 40)->nullable()->after('ref');
            }
            if (! Schema::hasColumn('wa_movements', 'space')) {
                $table->string('space', 40)->nullable()->after('phase');
            }
            if (! Schema::hasColumn('wa_movements', 'order_ext')) {
                $table->string('order_ext', 40)->nullable()->after('space');
            }
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('wa_movements')) {
            return;
        }
        Schema::table('wa_movements', function (Blueprint $table) {
            foreach (['phase', 'space', 'order_ext'] as $c) {
                if (Schema::hasColumn('wa_movements', $c)) {
                    $table->dropColumn($c);
                }
            }
        });
    }
};
