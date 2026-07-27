<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The ARCHITECTURE & 3D phase owns two tables, created together because they
 * are one feature and must arrive or leave as a unit.
 *
 *   wa_drawings    the deliverable, carrying its CURRENT revision and status
 *   wa_revisions   the trail — one row per revision letter, per action
 *
 * WHY THE TRAIL IS A TABLE, not a JSON column on the drawing (which is what
 * `wa_installs.snag_list` does): a snag is a checklist item, but a revision is
 * EVIDENCE — who issued it, what the client said, when it was approved. Evidence
 * gets its own row so it can be queried, counted and never silently rewritten.
 *
 * `project` and `designer` hold the project's FRONTEND id and a person's NAME,
 * not database keys — the same inherited pattern as wa_production (R2). A
 * deliverable whose project no longer exists is KEPT and flagged "orphan".
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('wa_drawings', function (Blueprint $table) {
            $table->id();
            $table->string('ext_id', 40);
            $table->string('company_id', 50)->default('woodart');
            $table->string('title', 200);
            $table->string('kind', 40)->default('Plan');
            $table->string('project', 40)->nullable();     // project EXT id
            $table->string('designer', 160)->nullable();   // person NAME
            $table->string('rev', 4)->default('A');        // A, B, C…
            $table->string('status', 30)->default('Draft');
            $table->date('issued')->nullable();
            $table->date('approved')->nullable();
            $table->date('created_on')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->unique(['company_id', 'ext_id']);
            $table->index(['company_id', 'project']);      // the phase-gate roll-up
            $table->index(['company_id', 'status']);
            $table->index(['company_id', 'designer']);
        });

        Schema::create('wa_revisions', function (Blueprint $table) {
            $table->id();
            $table->string('ext_id', 40);
            $table->string('company_id', 50)->default('woodart');
            $table->string('drawing', 40);                 // drawing EXT id
            $table->string('rev', 4)->default('A');
            $table->string('action', 30)->default('Drafted');
            $table->string('by', 160)->nullable();
            $table->string('note', 500)->nullable();
            $table->date('date')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->unique(['company_id', 'ext_id']);
            $table->index(['company_id', 'drawing']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('wa_revisions');
        Schema::dropIfExists('wa_drawings');
    }
};
