<?php

/**
 * Woodart · Projects — module API routes.
 * ----------------------------------------------------------------------------
 * Loaded by platform/backend's ModuleServiceProvider under the shared /api
 * group (which also applies auth:sanctum). This module owns the
 * `woodart/projects/*` path segment. Delete this folder and these routes are
 * never registered — auto-discovery.
 *
 * Full URL of each route = /api + the path given here.
 *
 * READ-ONLY FOR NOW, DELIBERATELY. The portfolio screen still writes through
 * EPAL.db to localStorage; promoting these stores to WRITABLE in
 * platform/data/api.js is this module's own build slot (#9), together with the
 * frontend/ rebuild. Serving the reads first is what makes the eight seeded
 * projects visible on a real host instead of stranded in MySQL — and a read
 * endpoint cannot corrupt anything if the shape turns out to need adjusting.
 */

use Epal\Modules\Woodart\Projects\ProjectController;
use Illuminate\Support\Facades\Route;

// The portfolio — frontend `wa_projects` store (api.js HYDRATE).
Route::get('woodart/projects/portfolio', [ProjectController::class, 'index']);

// The BOQs — frontend `wa_estimates` store. Accounts reads the same lines to
// compute each project's material variance, so the shape is load-bearing twice.
Route::get('woodart/projects/estimates', [ProjectController::class, 'estimates']);
