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
 * READ-ONLY UNTIL 2026-08-08, then given its write side — ahead of this module's
 * own build slot (#9) and the frontend/ rebuild, because the register learned to
 * DELETE a project (owner: "make a delete option everywhere") and a read-only
 * endpoint turned that into a lie: the row left the screen and came straight
 * back on the next hydrate. Writes are keyed on `ext_id` and idempotent, so the
 * client's optimistic save and any later re-save agree; deletes are SOFT.
 */

use Epal\Modules\Woodart\Projects\ProjectController;
use Illuminate\Support\Facades\Route;

// The portfolio — frontend `wa_projects` store (api.js HYDRATE + CONDITIONAL).
Route::get   ('woodart/projects/portfolio',      [ProjectController::class, 'index']);
Route::post  ('woodart/projects/portfolio',      [ProjectController::class, 'store']);
Route::delete('woodart/projects/portfolio/{id}', [ProjectController::class, 'destroy']);

// The BOQs — frontend `wa_estimates` store. Accounts reads the same lines to
// compute each project's material variance, so the shape is load-bearing twice.
Route::get   ('woodart/projects/estimates',      [ProjectController::class, 'estimates']);
Route::post  ('woodart/projects/estimates',      [ProjectController::class, 'storeEstimate']);
Route::delete('woodart/projects/estimates/{id}', [ProjectController::class, 'destroyEstimate']);
