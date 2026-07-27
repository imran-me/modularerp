<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * wa_clients — the people and companies Woodart builds for.
 *
 * SHAPE NOTES a developer needs:
 *  - `ext_id` is the FRONTEND id ('CLI-001') and the upsert key, unique PER
 *    COMPANY (two companies may each use 'CLI-001').
 *  - `company_id` holds the frontend company SLUG ('woodart'), matching every
 *    other module backend. Not a foreign key on purpose — a company folder must
 *    be droppable without orphaning rows.
 *  - `name` is INDEXED because Woodart's projects and estimates reference a
 *    client by NAME, not by id. That is how those stores were built and this
 *    module does not get to rewrite them; the index is what keeps the join
 *    cheap. See backend/LARAVEL-BLUEPRINT.md § Known gaps for the migration
 *    path to a real foreign key.
 *  - No money columns here — a client's value is DERIVED from their projects,
 *    never stored, so it can never drift from the projects it came from.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('wa_clients', function (Blueprint $table) {
            $table->id();
            $table->string('ext_id', 40);
            $table->string('company_id', 50)->default('woodart');
            $table->string('name', 160);
            $table->string('type', 40)->default('Homeowner');
            $table->string('contact', 160)->nullable();
            $table->string('phone', 40)->nullable();
            $table->string('email', 160)->nullable();
            $table->string('area', 120)->nullable();
            $table->date('since')->nullable();
            $table->date('created_on')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->unique(['company_id', 'ext_id']);
            $table->index(['company_id', 'name']);      // the project/estimate join
            $table->index(['company_id', 'type']);      // the segment roll-up
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('wa_clients');
    }
};
