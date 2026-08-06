<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * wa_phases — MOVED DOWN A LEVEL: a phase now belongs to a SPACE, not to a
 * project (owner, 2026-08-06).
 *
 * WHY THIS IS A RESHAPE AND NOT A NEW TABLE. `wa_phases` was created on
 * 2026-07-28 by the projects module for the cost-control plan, project-level
 * and read by no screen. A fit-out finishes the kitchen while the bedroom has
 * not started, and one flat list per project cannot say that — so the table
 * gained a `space`, and the project-level view became a derived roll-up.
 * Building a second phase table beside it would have guaranteed the two drift
 * apart the first time anybody wrote to one of them.
 *
 * WHY THIS MIGRATION LIVES IN `scope` AND NOT IN `projects`. Ownership moved
 * with the shape: the scope module now owns this table (see its module.json),
 * exactly as the estimates module owns the screens over `wa_estimates` while
 * projects keeps that table. Documented in both places rather than left to be
 * discovered.
 *
 * THE OLD UNIQUE INDEX HAD TO GO. It was (company_id, project, name), which
 * allowed one "Design" phase per project — the new shape needs one per ROOM.
 * The key is now the frontend id, like every other table here.
 *
 * THE OLD ROWS ARE DROPPED, not backfilled. They were demo rows for a screen
 * that never shipped, they carry no `space` to migrate to, and inventing one
 * would put every phase in whichever room happened to sort first. The seeder
 * rebuilds them properly.
 */
return new class extends Migration
{
    public function up(): void
    {
        // A host that never ran the July migration has no table to reshape.
        if (! Schema::hasTable('wa_phases')) {
            Schema::create('wa_phases', function (Blueprint $table) {
                $table->id();
                $table->string('ext_id', 40);
                $table->string('company_id', 50)->default('woodart');
                $table->string('project', 40);
                $table->string('space', 40);
                $table->string('name', 120);
                $table->string('code', 60)->nullable();
                $table->unsignedSmallInteger('sort')->default(0);
                $table->string('status', 20)->default('Not started');
                $table->string('owner_id', 40)->nullable();
                $table->date('start')->nullable();
                $table->date('finish')->nullable();
                $table->text('note')->nullable();
                $table->timestamps();
                $table->softDeletes();

                $table->unique(['company_id', 'ext_id']);
                $table->index(['company_id', 'project']);
                $table->index(['company_id', 'space']);
            });

            return;
        }

        /* Project-level rows cannot become room-level rows by guesswork. */
        DB::table('wa_phases')->where('company_id', 'woodart')->delete();

        /* The old unique blocks eleven rooms each having a "Design" phase.
         * Wrapped because a host may have been created by the branch below,
         * where that index never existed. */
        try {
            Schema::table('wa_phases', function (Blueprint $table) {
                $table->dropUnique('wa_phases_company_id_project_name_unique');
            });
        } catch (\Throwable $e) {
            // already gone — nothing to do
        }

        Schema::table('wa_phases', function (Blueprint $table) {
            if (! Schema::hasColumn('wa_phases', 'ext_id')) {
                $table->string('ext_id', 40)->after('id')->default('');
            }
            if (! Schema::hasColumn('wa_phases', 'space')) {
                $table->string('space', 40)->after('project')->default('');
            }
            if (! Schema::hasColumn('wa_phases', 'code')) {
                $table->string('code', 60)->nullable()->after('name');
            }
            if (! Schema::hasColumn('wa_phases', 'owner_id')) {
                $table->string('owner_id', 40)->nullable()->after('status');
            }
            if (! Schema::hasColumn('wa_phases', 'note')) {
                $table->text('note')->nullable()->after('finish');
            }
            if (! Schema::hasColumn('wa_phases', 'deleted_at')) {
                $table->softDeletes();
            }
        });

        try {
            Schema::table('wa_phases', function (Blueprint $table) {
                $table->unique(['company_id', 'ext_id']);
                $table->index(['company_id', 'space']);
            });
        } catch (\Throwable $e) {
            // indexes already present
        }
    }

    public function down(): void
    {
        if (! Schema::hasTable('wa_phases')) {
            return;
        }
        Schema::table('wa_phases', function (Blueprint $table) {
            foreach (['ext_id', 'space', 'code', 'owner_id', 'note'] as $col) {
                if (Schema::hasColumn('wa_phases', $col)) {
                    $table->dropColumn($col);
                }
            }
        });
    }
};
