<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * COST CONTROL — the two tables behind budget vs committed vs actual.
 *
 * See companies/woodart/PROJECT-PROFILE-PLAN.md §2-3 for the reasoning, and
 * Assets/MUNSHI-VILLA-SHEET.md for the working spreadsheet this replaces.
 *
 * WHAT IS *NOT* HERE, AND WHY
 * There is no `actuals` table and no `committed` table. Both are DERIVED on
 * read:
 *     actual(project, code)    = SUM(acc_entries.amount)  WHERE ref = project
 *     committed(project, code) = SUM(wa_purchases unpaid) WHERE project
 * A stored total is a total that drifts, and that is exactly how the Munshi
 * Villa summary sheet stopped matching its own detail sheets — its `Cost` column
 * is a typed constant, not a formula. Deriving costs a join and buys the
 * guarantee that the summary can never lie.
 *
 * `wa_cost_codes` IS SEEDED DATA, NOT AN ENUM. Adding "Aluminium" must be a row
 * a user can create, not a deploy.
 */
return new class extends Migration
{
    public function up(): void
    {
        /* The shared vocabulary. Estimating, buying and accounting all tag
         * against this one list — the sheet's 18 column heads, made real.
         *
         * `code` is the SAME string that lands in acc_entries.category. That is
         * the deliberate decision from the plan (§8): one vocabulary, so cost
         * control works on all historical data with no migration and nothing to
         * keep aligned. */
        Schema::create('wa_cost_codes', function (Blueprint $table) {
            $table->id();
            $table->string('company_id', 50)->default('woodart');
            $table->string('code', 120);                   // == acc_entries.category
            $table->string('label', 160);
            $table->string('phase', 80)->nullable();       // groups codes into a phase
            $table->unsignedSmallInteger('sort')->default(0);
            $table->string('kind', 20)->default('direct'); // direct | overhead
            $table->boolean('active')->default(true);
            $table->timestamps();

            $table->unique(['company_id', 'code']);
            $table->index(['company_id', 'phase']);
        });

        /* What each project is allowed to spend, per code.
         *
         * Seeded from the approved BOQ where one exists, typed by hand where it
         * does not — the Munshi sheet budgets only 6 of its 18 heads, so a
         * missing budget is a NORMAL state, not an error. A code with no budget
         * row shows actuals and no variance rather than a fake 100% overrun. */
        Schema::create('wa_budget_lines', function (Blueprint $table) {
            $table->id();
            $table->string('company_id', 50)->default('woodart');
            $table->string('project', 40);                 // project EXT id
            $table->string('code', 120);                   // -> wa_cost_codes.code
            $table->unsignedBigInteger('budget')->default(0);   // integer Taka
            $table->string('source', 20)->default('manual');    // manual | boq
            $table->text('note')->nullable();
            $table->timestamps();

            $table->unique(['company_id', 'project', 'code']);
            $table->index(['company_id', 'project']);
        });

        /* A project's phases, as PARALLEL control accounts.
         *
         * The ERP models `wa_projects.phase` as ONE current stage. The working
         * sheet models phases as parallel cost heads, five of which have not
         * started — 'Tiles not started, Wood Work not started, Rod 101% spent'
         * is a sentence the single-stage model cannot express. The sheet is
         * right, so phases become rows. `wa_projects.phase` stays as the
         * headline stage and is untouched. */
        Schema::create('wa_phases', function (Blueprint $table) {
            $table->id();
            $table->string('company_id', 50)->default('woodart');
            $table->string('project', 40);
            $table->string('name', 120);
            $table->unsignedSmallInteger('sort')->default(0);
            $table->string('status', 20)->default('Not started'); // Not started | Active | Complete
            $table->date('start')->nullable();
            $table->date('finish')->nullable();
            $table->timestamps();

            $table->unique(['company_id', 'project', 'name']);
            $table->index(['company_id', 'project']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('wa_phases');
        Schema::dropIfExists('wa_budget_lines');
        Schema::dropIfExists('wa_cost_codes');
    }
};
