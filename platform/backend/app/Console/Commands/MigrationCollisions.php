<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Schema;

/**
 * READ-ONLY. Reports what each PENDING migration would collide with.
 *
 * WHY THIS EXISTS
 * The production database holds a deliberate COPY of the owner's live Travels
 * ERP (~179 tables) alongside our modular tables. `php artisan migrate` would
 * run every pending migration against it, and several try to CREATE tables that
 * already exist or ADD columns that are already there — so the batch dies
 * half-applied, against real business data, with no backup guaranteed.
 *
 * The trap is that Laravel's own `migrate:status` says "Pending" for all of
 * them. Pending means "not in the migrations table", NOT "safe to run". A
 * migration whose table was created by an earlier deployment, or which arrived
 * inside a database dump, is pending forever and fatal every time.
 *
 * Proof this is not theoretical: `acc_entries` on the live host already carries
 * `pay_acct` and `funded_by`, the exact columns
 * 2026_07_26_002000_add_payment_source_to_acc_entries wants to add.
 *
 * This command changes NOTHING. It reads the pending list, greps each file for
 * the tables and columns it touches, compares them against the live schema, and
 * prints a verdict per migration so the decision is made on facts.
 *
 *   php artisan migrate:collisions
 *   php artisan migrate:collisions --safe-only    # just the runnable ones
 *
 * Exit code is 0 always: this is a report, not a gate. Nothing here should ever
 * block a deploy by accident.
 */
class MigrationCollisions extends Command
{
    protected $signature = 'migrate:collisions {--safe-only : list only migrations with no collision}';

    protected $description = 'Report which pending migrations collide with the existing schema (read-only)';

    public function handle(): int
    {
        $pending = $this->pendingFiles();

        if (! $pending) {
            $this->info('No pending migrations.');

            return self::SUCCESS;
        }

        $this->line('');
        $this->line('  Pending migrations: ' . count($pending) . '   (READ-ONLY REPORT — nothing is run)');
        $this->line('  ' . str_repeat('-', 96));

        /* Tables the PENDING batch will create itself.
         *
         * Without this, an ALTER whose table does not exist yet reads as a
         * collision — when in fact an earlier migration in the same run creates
         * it moments before. Reporting that as a problem would send someone
         * hunting a fault that does not exist, and a report that cries wolf gets
         * ignored on the day it is right. */
        $willCreate = [];
        foreach ($pending as $path) {
            foreach ($this->matches(File::get($path), "/Schema::create\(\s*['\"]([a-zA-Z0-9_]+)['\"]/") as $t) {
                $willCreate[$t] = true;
            }
        }

        $safe = 0;
        $risky = 0;

        foreach ($pending as $name => $path) {
            $body = File::get($path);
            $creates = $this->matches($body, "/Schema::create\(\s*['\"]([a-zA-Z0-9_]+)['\"]/");
            $alters = $this->matches($body, "/Schema::table\(\s*['\"]([a-zA-Z0-9_]+)['\"]/");

            $problems = [];

            foreach ($creates as $table) {
                if (Schema::hasTable($table)) {
                    $problems[] = 'CREATE ' . $table . ' — table ALREADY EXISTS (' . $this->rowCount($table) . ' rows)';
                }
            }

            foreach ($alters as $table) {
                if (! Schema::hasTable($table)) {
                    // Fine when the same batch creates it first; a genuine
                    // problem only when nothing anywhere makes the table.
                    if (! isset($willCreate[$table])) {
                        $problems[] = 'ALTER ' . $table . ' — table is MISSING and nothing pending creates it';
                    }
                    continue;
                }
                foreach ($this->addedColumns($body) as $col) {
                    if (Schema::hasColumn($table, $col)) {
                        $problems[] = 'ALTER ' . $table . ' — column "' . $col . '" ALREADY EXISTS';
                    }
                }
                $n = $this->rowCount($table);
                if ($n > 0) {
                    $problems[] = 'ALTER ' . $table . ' — touches ' . $n . ' LIVE rows';
                }
            }

            if ($problems) {
                $risky++;
                if ($this->option('safe-only')) {
                    continue;
                }
                $this->line('  <fg=red>✗</> ' . $name);
                foreach (array_unique($problems) as $p) {
                    $this->line('      ' . $p);
                }
            } else {
                $safe++;
                $this->line('  <fg=green>✓</> ' . $name . ($creates ? '  creates: ' . implode(', ', $creates) : ''));
            }
        }

        $this->line('  ' . str_repeat('-', 96));
        $this->line('  <fg=green>' . $safe . ' safe</>   <fg=red>' . $risky . ' with collisions</>');
        $this->line('');
        $this->line('  Run the safe ones ONE MODULE AT A TIME, never a bare `migrate`:');
        $this->line('    php artisan migrate --force --path=<relative/path/to/that/migrations/dir>');
        $this->line('');

        return self::SUCCESS;
    }

    /** Migration files not yet recorded in the `migrations` table. */
    private function pendingFiles(): array
    {
        $ran = Schema::hasTable('migrations')
            ? DB::table('migrations')->pluck('migration')->all()
            : [];

        $out = [];
        foreach ($this->allMigrationDirs() as $dir) {
            foreach (File::glob($dir . '/*.php') as $file) {
                $name = basename($file, '.php');
                if (! in_array($name, $ran, true)) {
                    $out[$name] = $file;
                }
            }
        }
        ksort($out);

        return $out;
    }

    /**
     * Every directory migrations can live in — the kernel's own, plus each
     * module's. Mirrors how ModuleServiceProvider discovers them, so this report
     * cannot silently miss a module the migrator would find.
     */
    private function allMigrationDirs(): array
    {
        $dirs = [database_path('migrations')];
        foreach (File::glob(base_path('../../companies/*/modules/*/backend/migrations')) as $d) {
            $dirs[] = $d;
        }

        return array_filter($dirs, fn ($d) => is_dir($d));
    }

    private function matches(string $body, string $pattern): array
    {
        preg_match_all($pattern, $body, $m);

        return array_values(array_unique($m[1] ?? []));
    }

    /** Column names a Schema::table block adds. Advisory — regex, not a parser. */
    private function addedColumns(string $body): array
    {
        preg_match_all("/->(?:string|integer|bigInteger|unsignedBigInteger|boolean|date|dateTime|timestamp|decimal|text|json|foreignId)\(\s*['\"]([a-zA-Z0-9_]+)['\"]/", $body, $m);

        return array_values(array_unique($m[1] ?? []));
    }

    private function rowCount(string $table): int
    {
        try {
            return (int) DB::table($table)->count();
        } catch (\Throwable $e) {
            return 0;
        }
    }
}
