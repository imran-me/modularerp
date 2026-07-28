<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A purchase order has to say WHICH JOB it is buying for.
 *
 * Found while building cost control (PROJECT-PROFILE-PLAN.md slice 2):
 * `wa_purchases` carried supplier, items, amount, status and date — but no
 * project. Without it, COMMITTED COST per project cannot be computed at all,
 * and committed cost is the one column the working spreadsheet structurally
 * cannot produce:
 *
 *     budget · COMMITTED · actual · variance
 *
 * An overrun shows the day an order is RAISED rather than weeks later when the
 * bill is paid. That is the single biggest upgrade over the Munshi Villa sheet,
 * and it was one nullable column away the whole time.
 *
 * NULLABLE on purpose. Woodart buys stock for the shelf as well as for a job —
 * plywood ordered to replenish the workshop belongs to no project, and forcing
 * a project onto it would either invent a link or block a real purchase. A null
 * project means "general stock", and cost control simply does not count it
 * against any job.
 *
 * The project's FRONTEND id, not a foreign key — same rule as wa_production and
 * wa_installs, so a company folder stays droppable and an order whose project
 * has gone is kept and flagged rather than deleted.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('wa_purchases', function (Blueprint $table) {
            $table->string('project', 40)->nullable()->after('supplier');
            $table->index(['company_id', 'project']);
        });
    }

    public function down(): void
    {
        Schema::table('wa_purchases', function (Blueprint $table) {
            $table->dropIndex(['company_id', 'project']);
            $table->dropColumn('project');
        });
    }
};
