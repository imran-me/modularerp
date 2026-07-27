<?php

/**
 * Woodart · Clients — module API routes.
 * ----------------------------------------------------------------------------
 * Loaded by platform/backend's ModuleServiceProvider under the shared /api
 * group (which also applies auth:sanctum). This module owns the
 * `woodart/clients/*` path segment and nothing else. Delete this folder and
 * these routes are simply never registered — auto-discovery, and what makes a
 * module genuinely drop-in / drop-out.
 *
 * Full URL of each route below = /api + the path given here.
 * The frozen contract for every one of them is in backend/endpoints.md.
 */

use Epal\Modules\Woodart\Clients\ClientController;
use Illuminate\Support\Facades\Route;

// The client directory — frontend `wa_clients` store (api.js HYDRATE+WRITABLE).
Route::get('woodart/clients/directory', [ClientController::class, 'index']);
Route::post('woodart/clients/directory', [ClientController::class, 'store']);
Route::delete('woodart/clients/directory/{id}', [ClientController::class, 'destroy']);

// Derived reads. The SPA computes both client-side from the hydrated stores, so
// it does not call them today — they exist so the client→work join has ONE
// authoritative server-side definition, and for reports / any future non-SPA
// client that cannot hold the whole project table in memory.
Route::get('woodart/clients/portfolio', [ClientController::class, 'portfolio']);
Route::get('woodart/clients/segments', [ClientController::class, 'segments']);
