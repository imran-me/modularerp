<?php

/**
 * Passport Management — module API routes.
 * ----------------------------------------------------------------------------
 * Loaded by platform/backend ModuleServiceProvider under the shared /api group
 * (with auth:sanctum applied centrally). This module owns the
 * `travels/passport-mgmt/*` path segment. Delete this folder and these routes
 * are simply never registered (auto-discovery).
 *
 * Full URL of each route below = /api + the path given here.
 */

use Epal\Modules\Travels\PassportMgmt\PassportController;
use Illuminate\Support\Facades\Route;

// Passports (module-owned `tv_passports` table) — frontend `tv_passports` store.
Route::get('travels/passport-mgmt/passports', [PassportController::class, 'index']);
Route::post('travels/passport-mgmt/passports', [PassportController::class, 'store']);
Route::delete('travels/passport-mgmt/passports/{id}', [PassportController::class, 'destroy']);
