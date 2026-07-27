<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * wa_installs — Woodart's site visits: delivery, fitting, snagging, handover.
 *
 * SHAPE NOTES a developer needs:
 *  - `ext_id` is the FRONTEND id ('INS-001') and the upsert key, unique PER
 *    COMPANY. `company_id` holds the frontend slug — not an FK, so a company
 *    folder stays droppable.
 *  - `project` holds the project's FRONTEND id, not a database key (same as
 *    wa_production). An install whose project has gone is KEPT and flagged
 *    "orphan" in the UI, never hidden.
 *  - **`snags` and `snag_list` coexist deliberately.** The seeded store has a
 *    plain count; the Projects snag modal migrates that number into an itemised
 *    list of {text, done} and keeps the count in step. A record in the wild may
 *    carry either, so both are stored and the count is always kept
 *    authoritative — see the blueprint. `snag_list` is JSON and nullable, so a
 *    record that was never itemised costs nothing.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('wa_installs', function (Blueprint $table) {
            $table->id();
            $table->string('ext_id', 40);
            $table->string('company_id', 50)->default('woodart');
            $table->string('project', 40)->nullable();     // project EXT id
            $table->string('site', 160);
            $table->string('team', 120)->nullable();
            $table->string('status', 30)->default('Scheduled');
            $table->date('date')->nullable();
            $table->unsignedInteger('snags')->default(0);  // OPEN snag count
            $table->json('snag_list')->nullable();         // itemised, when present
            $table->date('created_on')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->unique(['company_id', 'ext_id']);
            $table->index(['company_id', 'project']);
            $table->index(['company_id', 'team']);
            $table->index(['company_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('wa_installs');
    }
};
