<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * RESEED ONE COMPANY — and only that company.
 * ----------------------------------------------------------------------------
 *   php artisan epal:reseed woodart
 *   php artisan epal:reseed woodart --force      (no confirmation prompt)
 *   php artisan epal:reseed woodart --dry-run    (say what would happen)
 *
 * WHY THIS EXISTS. `migrate:fresh --seed` rebuilds the whole database, which on
 * a live host means every company's data, not the one you meant. The owner's
 * instruction on 2026-08-06 was exact: *"not the whole database, but only the
 * interior one."* This command cannot do anything else — it clears only the
 * tables a company's own manifest claims, and only that company's rows in the
 * shared ones it names.
 *
 * WHAT IT READS. `companies/<company>/app/backend/seeders.php` — the company's
 * manifest: its table prefix, the shared tables it owns rows in, the tables to
 * leave alone, and the seeders to run in dependency order. No company knowledge
 * lives in this file, so a new company needs no edit here and a deleted company
 * simply stops being reseedable.
 *
 * WHAT IT WILL NOT DO:
 *   · touch a table outside the manifest
 *   · delete another company's rows from a shared table
 *   · run without saying exactly what it is about to delete
 */
class ReseedCompany extends Command
{
    protected $signature = 'epal:reseed
                            {company : the company slug, e.g. woodart}
                            {--force : skip the confirmation}
                            {--dry-run : report what would happen, change nothing}';

    protected $description = "Clear and reseed ONE company's demo data. Never touches another company.";

    public function handle(): int
    {
        $company = (string) $this->argument('company');
        $manifestPath = base_path("../../companies/{$company}/app/backend/seeders.php");

        if (! is_file($manifestPath)) {
            $this->error("No manifest at companies/{$company}/app/backend/seeders.php");
            $this->line('A company is reseedable only if it declares what it owns.');

            return self::FAILURE;
        }

        $manifest = require $manifestPath;
        $prefix = $manifest['prefix'] ?? null;
        $shared = $manifest['shared'] ?? [];
        $keep = $manifest['keep'] ?? [];
        $seeders = $manifest['seeders'] ?? [];

        /* ---- work out exactly what will be cleared, before clearing any of it */
        $owned = [];
        foreach (Schema::getTableListing() as $table) {
            $table = str_contains($table, '.') ? substr($table, strrpos($table, '.') + 1) : $table;
            if ($prefix && str_starts_with($table, $prefix) && ! in_array($table, $keep, true)) {
                $owned[] = $table;
            }
        }
        sort($owned);

        $sharedPresent = array_values(array_filter(
            $shared,
            fn ($t) => ! in_array($t, $keep, true) && Schema::hasTable($t) && Schema::hasColumn($t, 'company_id')
        ));

        $this->newLine();
        $this->line("<options=bold>Reseed {$company} — and nothing else</>");
        $this->line('  wipe entirely   : '.($owned ? implode(', ', $owned) : '(none found)'));
        $this->line("  wipe {$company} rows : ".($sharedPresent ? implode(', ', $sharedPresent) : '(none)'));
        $this->line('  never touched   : '.($keep ? implode(', ', $keep) : '(none)'));
        $this->line('  then run        : '.count($seeders).' seeder(s), in order');
        $this->newLine();

        if ($this->option('dry-run')) {
            $this->info('Dry run — nothing was changed.');

            return self::SUCCESS;
        }

        if (! $this->option('force') && ! $this->confirm("Clear and reseed {$company}'s demo data?", false)) {
            $this->line('Nothing was changed.');

            return self::SUCCESS;
        }

        /* ---- clear ---------------------------------------------------------
         * One transaction: a half-cleared company is worse than either a full
         * one or none at all, because every roll-up would be quietly wrong. */
        DB::transaction(function () use ($owned, $sharedPresent, $company) {
            foreach ($owned as $table) {
                $n = Schema::hasColumn($table, 'company_id')
                    ? DB::table($table)->where('company_id', $company)->delete()
                    : DB::table($table)->delete();
                $this->line("  cleared {$table} ({$n})");
            }
            foreach ($sharedPresent as $table) {
                $n = DB::table($table)->where('company_id', $company)->delete();
                $this->line("  cleared {$table} where company_id={$company} ({$n})");
            }
        });

        /* ---- reseed, in the manifest's order ------------------------------ */
        $this->newLine();
        foreach ($seeders as $class) {
            if (! class_exists($class)) {
                $this->warn("  skipped {$class} — class not found (module removed?)");

                continue;
            }
            $this->line('  seeding '.class_basename($class));
            $this->callSilent('db:seed', ['--class' => $class, '--force' => true]);
        }

        $this->newLine();
        $this->info("{$company} reseeded. No other company was touched.");

        return self::SUCCESS;
    }
}
