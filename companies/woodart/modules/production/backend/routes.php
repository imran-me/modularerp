<?php

/**
 * Woodart · Workshop (production) — module API routes.
 * ----------------------------------------------------------------------------
 * Loaded by platform/backend's ModuleServiceProvider under the shared /api
 * group (which also applies auth:sanctum). This module owns the
 * `woodart/production/*` path segment. Delete this folder and these routes are
 * never registered — auto-discovery.
 *
 * Full URL of each route = /api + the path given here.
 * The frozen contract is in backend/endpoints.md.
 */

use Epal\Modules\Woodart\Production\JobController;
use Illuminate\Support\Facades\Route;

// Fabrication jobs — frontend `wa_production` store (api.js HYDRATE + WRITABLE).
Route::get('woodart/production/jobs', [JobController::class, 'index']);
Route::post('woodart/production/jobs', [JobController::class, 'store']);
Route::delete('woodart/production/jobs/{id}', [JobController::class, 'destroy']);

// Derived read. The SPA computes it client-side from the hydrated store, so it
// does not call this today — it exists so the open/overdue rules have ONE
// authoritative server-side definition, and for reports.
Route::get('woodart/production/load', [JobController::class, 'load']);
