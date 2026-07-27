<?php

/**
 * Woodart · Materials — module API routes.
 * ----------------------------------------------------------------------------
 * Loaded by platform/backend's ModuleServiceProvider under the shared /api
 * group (which also applies auth:sanctum). This module owns the
 * `woodart/materials/*` path segment and nothing else. Delete this folder and
 * these routes are simply never registered — that is auto-discovery, and it is
 * what makes a module genuinely drop-in / drop-out.
 *
 * Full URL of each route below = /api + the path given here.
 * The frozen contract for every one of them is in backend/endpoints.md.
 */

use Epal\Modules\Woodart\Materials\MaterialController;
use Illuminate\Support\Facades\Route;

// The material register — frontend `wa_materials` store (api.js HYDRATE).
Route::get('woodart/materials/stock', [MaterialController::class, 'index']);
Route::post('woodart/materials/stock', [MaterialController::class, 'store']);
Route::delete('woodart/materials/stock/{id}', [MaterialController::class, 'destroy']);

// Derived reads. The SPA computes these client-side from the hydrated store, so
// it does not call them today — they exist for reports, for a future mobile
// client, and so the reorder rule has ONE server-side definition to point at.
Route::get('woodart/materials/reorder', [MaterialController::class, 'reorder']);
Route::get('woodart/materials/valuation', [MaterialController::class, 'valuation']);

/* ---------------------------------------------------------------------------
 * THE STOCK LEDGER (2026-07-27) — stock is no longer a bare number.
 *
 * There is deliberately NO update and NO delete on a movement: a movement is a
 * fact that happened, and correcting one is a new Adjustment, not a rewrite of
 * history. If rows could be edited away, `reconcile` would only ever prove that
 * somebody had tidied up.
 * ------------------------------------------------------------------------- */
Route::get('woodart/materials/movements', [MovementController::class, 'index']);
Route::post('woodart/materials/movements', [MovementController::class, 'store']);
Route::get('woodart/materials/reconcile', [MovementController::class, 'reconcile']);
Route::get('woodart/materials/{id}/movements', [MovementController::class, 'forMaterial']);

Route::get('woodart/materials/locations', [StockLocationController::class, 'index']);
Route::get('woodart/materials/locations/holdings', [StockLocationController::class, 'holdings']);
