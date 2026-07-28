<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * wa_recurring — Woodart's standing monthly costs: rent, utilities, retainers.
 *
 * THE ONLY TABLE THIS MODULE OWNS. Everything else on the Accounts desk reads
 * shared books — `acc_entries`, `banks`, `journal_entries`, `acc_schedules` —
 * because a private Woodart ledger would fork the group's accounting. A standing
 * cost is different: it is not a posting, it is a REMINDER that a posting is due,
 * and no shared table holds that concept.
 *
 * SHAPE NOTES a developer needs:
 *  - `ext_id` is the FRONTEND id ('REC-WA001') and the upsert key, unique PER
 *    COMPANY. `company_id` holds the frontend slug — not an FK, so a company
 *    folder stays droppable.
 *  - `day_of_month` is 1–31, not a date. The whole point is "the 5th of every
 *    month"; storing a concrete date would need rewriting every time one passed.
 *    A 31 in a short month is the caller's problem to interpret, deliberately —
 *    clamping it here would silently move a bill.
 *  - `status` is Active | Paused. Paused KEEPS the record and stops counting it
 *    in the monthly commitment. There is no delete-on-stop, because a cost that
 *    lapses for two months and returns is the same cost.
 *  - `amount` is integer Taka (D10), never a float.
 *  - NO `ref` to a project. A standing cost belongs to the business, not to a
 *    job; tying rent to a project would distort every Project P&L that happened
 *    to be open that month.
 *
 * Travels' equivalent is `tv_recurring`. The two are separate tables on purpose:
 * modules never share a table across companies, so deleting either company's
 * folder cannot take the other's data with it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('wa_recurring', function (Blueprint $table) {
            $table->id();
            $table->string('ext_id', 40);
            $table->string('company_id', 50)->default('woodart');
            $table->string('name', 200);                        // "Workshop rent — Tejgaon"
            $table->string('category', 120)->nullable();         // the expense head
            $table->unsignedBigInteger('amount')->default(0);    // integer Taka
            $table->string('party', 160)->nullable();            // who is paid
            $table->unsignedTinyInteger('day_of_month')->nullable();
            $table->string('method', 40)->nullable();
            $table->string('status', 20)->default('Active');     // Active | Paused
            $table->date('created_on')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->unique(['company_id', 'ext_id']);
            $table->index(['company_id', 'status']);
            $table->index(['company_id', 'category']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('wa_recurring');
    }
};
