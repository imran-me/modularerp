<?php

namespace App\Providers;

use Illuminate\Support\Facades\Route;
use Illuminate\Support\ServiceProvider;

/**
 * MODULE LOADER — the backend half of the modular architecture.
 * ----------------------------------------------------------------------------
 * Mirrors the frontend's auto-discovery (see EPAL_GROUP_ERP_Modular_Architecture.md
 * §12 and platform/core discovery): the kernel finds modules by SCANNING for
 * their folders, so there is NO central list to edit. Drop a `backend/` folder
 * into a module and its API + tables come alive; delete the module folder and
 * they vanish — nothing else changes. That is what makes a module drop-in/out.
 *
 * Each module's backend lives BESIDE its frontend, in the same module folder:
 *
 *   companies/<company>/modules/<module>/backend/
 *       routes.php          <- its API routes  (loaded under the /api group)
 *       <Name>Controller.php, models, ...       (namespaced — autoloaded below)
 *       migrations/         <- its own tables   (added to the migrator)
 *       bridge.map          <- what it rolls up to the Group (bridge phase)
 *
 * Company-wide backends (a company's shell, not a single module) may also live
 * at  companies/<company>/app/backend/  and are loaded the same way.
 *
 * Backend classes use the namespace  Epal\Modules\<Company>\<Module>\<Class>,
 * which this provider resolves to the folder above (StudlyCase -> kebab-case),
 * via a runtime autoloader — so a freshly-dropped folder needs no composer dump.
 */
class ModuleServiceProvider extends ServiceProvider
{
    /** Repo-root /companies (two levels up from platform/backend), resolved once. */
    protected function companiesPath(): ?string
    {
        $p = realpath(base_path('../../companies'));

        return $p ?: null;
    }

    public function register(): void
    {
        // Runtime PSR-4-style autoloader for module backend classes. Keeps the
        // scattered per-module folders out of composer.json — presence of the
        // file is the only thing that matters (RULE 3: auto-discovery).
        spl_autoload_register(function (string $class): void {
            if (! str_starts_with($class, 'Epal\\Modules\\')) {
                return;
            }
            $root = $this->companiesPath();
            if (! $root) {
                return;
            }
            $parts = explode('\\', $class);              // Epal, Modules, Company, Module, ...Class
            if (count($parts) < 5) {
                return;
            }
            $company = $this->kebab($parts[2]);
            $module  = $this->kebab($parts[3]);
            $tail    = implode('/', array_slice($parts, 4)).'.php';
            $file    = "$root/$company/modules/$module/backend/$tail";
            if (is_file($file)) {
                require_once $file;
            }
        });
    }

    public function boot(): void
    {
        $root = $this->companiesPath();
        if (! $root) {
            return;
        }

        // Every module backend, plus every company-shell backend. glob() returns
        // only folders that EXIST — a deleted module simply isn't in the list.
        $backends = array_merge(
            glob("$root/*/modules/*/backend", GLOB_ONLYDIR) ?: [],
            glob("$root/*/app/backend", GLOB_ONLYDIR) ?: []
        );

        foreach ($backends as $dir) {
            $routes = "$dir/routes.php";
            if (is_file($routes)) {
                // Each module owns its own path segment inside the group; the
                // provider only supplies the shared /api prefix + api middleware.
                Route::middleware('api')->prefix('api')->group($routes);
            }
            if (is_dir("$dir/migrations")) {
                $this->loadMigrationsFrom("$dir/migrations");
            }
        }
    }

    /** StudlyCase -> kebab-case.  GroupCockpit -> group-cockpit, MasterAccounts -> master-accounts. */
    private function kebab(string $studly): string
    {
        return strtolower(preg_replace('/(?<!^)[A-Z]/', '-$0', $studly));
    }
}
