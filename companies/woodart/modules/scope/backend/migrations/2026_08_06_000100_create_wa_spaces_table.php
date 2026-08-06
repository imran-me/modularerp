<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * wa_spaces — the rooms and areas a project is built in (Master Bed Room,
 * Kitchen, Dining Room). The level between a project and its phases.
 *
 * SHAPE NOTES a developer needs:
 *  - `ext_id` is the FRONTEND id ('SPC-001') and the upsert key, so a re-post
 *    of the same record updates instead of duplicating. Unique per company.
 *  - `company_id` holds the company SLUG ('woodart'), not a foreign key: a
 *    company folder can be dropped in or out and its rows must survive.
 *  - `project` references wa_projects.ext_id by VALUE for the same reason —
 *    every other Woodart module joins on the frontend id, not on an auto id.
 *  - `area` is square feet. 0 means "not measured", which is different from
 *    zero area and is why it is not nullable.
 *  - No cost column anywhere: what a space is worth is the sum of its phases'
 *    requirements, computed on read. A stored total is a total that drifts.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('wa_spaces', function (Blueprint $table) {
            $table->id();
            $table->string('ext_id', 40);
            $table->string('company_id', 50)->default('woodart');
            $table->string('project', 40);
            $table->string('name', 120);
            $table->string('kind', 40)->default('Common');
            $table->unsignedInteger('area')->default(0);
            $table->unsignedSmallInteger('sort')->default(1);
            $table->text('note')->nullable();
            $table->date('created_on')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->unique(['company_id', 'ext_id']);
            $table->index(['company_id', 'project']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('wa_spaces');
    }
};
