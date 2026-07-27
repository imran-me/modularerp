<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * wa_production — Woodart's fabrication jobs (the workshop floor).
 *
 * SHAPE NOTES a developer needs:
 *  - `ext_id` is the FRONTEND id ('JOB-001') and the upsert key, unique PER
 *    COMPANY.
 *  - `company_id` holds the frontend company SLUG ('woodart'). Not a foreign
 *    key on purpose — a company folder must be droppable.
 *  - `project` holds the PROJECT'S FRONTEND ID ('WAP-004'), not a database
 *    foreign key. That is how the existing `wa_production` store was already
 *    built and this module does not rewrite it (R2). It is indexed because the
 *    job register resolves a project name for every row. A job whose project no
 *    longer exists is kept and FLAGGED "orphan" in the UI, never hidden — see
 *    the blueprint.
 *  - `assignedTo` is a NAME, not an employee id, for the same reason.
 *  - No money columns: a job costs nothing here. Labour and material cost live
 *    with the project.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('wa_production', function (Blueprint $table) {
            $table->id();
            $table->string('ext_id', 40);
            $table->string('company_id', 50)->default('woodart');
            $table->string('job', 160);
            $table->string('project', 40)->nullable();       // project EXT id
            $table->string('station', 60)->default('CNC');
            $table->string('assigned_to', 160)->nullable();  // person NAME
            $table->string('status', 30)->default('Queued');
            $table->date('due')->nullable();
            $table->date('created_on')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->unique(['company_id', 'ext_id']);
            $table->index(['company_id', 'project']);
            $table->index(['company_id', 'station']);
            $table->index(['company_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('wa_production');
    }
};
