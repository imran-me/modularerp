<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * wa_projects + wa_estimates — the SPINE every other Woodart module points at.
 *
 * ⚠️ THIS IS A PARTIAL SLICE, and deliberately so. The `projects` module has
 * not been rebuilt yet (it is still the legacy 1,238-line view.js, ROOT-MAP §6
 * puts it at #9). What it did NOT have was a table — and that turned out to
 * matter, because every module built before it seeds references INTO it:
 * wa_production.project, wa_installs.project, wa_drawings.project,
 * wa_movements.ref and wa_estimates.projectId all name a project id.
 *
 * With no wa_projects table, every one of those references dangled in MySQL —
 * the browser resolved them against seeded demo data while the database held
 * orphans pointing at nothing. Worse, the seeders had drifted into TWO id sets
 * that did not agree with each other.
 *
 * So the tables and their seed land now, ahead of the module rebuild, purely so
 * the database is referentially honest. The full slice — controllers, service,
 * resources, the phase field from ROOT-MAP §2.2 — comes with the rebuild.
 *
 * `stage` keeps its five legacy values; `phase` is the additive field the root
 * map proposes, nullable so nothing that reads `stage` changes (R2).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('wa_projects', function (Blueprint $table) {
            $table->id();
            $table->string('ext_id', 40);
            $table->string('company_id', 50)->default('woodart');
            $table->string('name', 200);
            $table->string('client', 160)->nullable();     // client NAME — see Clients
            $table->string('type', 40)->default('Residential');
            $table->unsignedInteger('area')->default(0);   // sft
            $table->unsignedBigInteger('value')->default(0);
            $table->unsignedBigInteger('cost')->default(0);
            $table->string('stage', 40)->default('Design');
            $table->string('phase', 40)->nullable();       // ROOT-MAP §2.2, additive
            $table->unsignedInteger('progress')->default(0);
            $table->string('designer', 160)->nullable();
            $table->date('start')->nullable();
            $table->date('deadline')->nullable();
            $table->boolean('billed')->default(false);
            $table->date('created_on')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->unique(['company_id', 'ext_id']);
            $table->index(['company_id', 'stage']);
            $table->index(['company_id', 'client']);
        });

        Schema::create('wa_estimates', function (Blueprint $table) {
            $table->id();
            $table->string('ext_id', 40);
            $table->string('company_id', 50)->default('woodart');
            $table->string('title', 200);
            $table->string('client', 160)->nullable();
            $table->string('project_ext', 40)->nullable();  // the project it quotes
            $table->string('status', 30)->default('Draft');
            $table->json('lines')->nullable();              // the BOQ — this IS the budget
            $table->date('valid_till')->nullable();
            $table->date('created_on')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->unique(['company_id', 'ext_id']);
            $table->index(['company_id', 'project_ext']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('wa_estimates');
        Schema::dropIfExists('wa_projects');
    }
};
