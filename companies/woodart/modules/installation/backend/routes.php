<?php

/**
 * Woodart · Site & Install (installation) — module API routes.
 * ----------------------------------------------------------------------------
 * Loaded by platform/backend's ModuleServiceProvider under the shared /api
 * group (which also applies auth:sanctum). This module owns the
 * `woodart/installation/*` path segment. Delete this folder and these routes
 * are never registered — auto-discovery.
 *
 * Full URL of each route = /api + the path given here.
 * The frozen contract is in backend/endpoints.md.
 */

use Epal\Modules\Woodart\Installation\InstallController;
use Illuminate\Support\Facades\Route;

// Site visits — frontend `wa_installs` store (api.js HYDRATE + WRITABLE).
Route::get('woodart/installation/installs', [InstallController::class, 'index']);
Route::post('woodart/installation/installs', [InstallController::class, 'store']);
Route::delete('woodart/installation/installs/{id}', [InstallController::class, 'destroy']);

// Derived reads. The SPA computes both client-side from the hydrated store, so
// it does not call them today — they exist so the snag count and the open /
// overdue rules have ONE authoritative server-side definition, and for reports.
Route::get('woodart/installation/snags', [InstallController::class, 'snags']);
Route::get('woodart/installation/teams', [InstallController::class, 'teams']);
