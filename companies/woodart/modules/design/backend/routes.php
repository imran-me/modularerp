<?php

/**
 * Woodart · Design & 3D — module API routes.
 * ----------------------------------------------------------------------------
 * Loaded by platform/backend's ModuleServiceProvider under the shared /api
 * group (auth:sanctum). Owns the `woodart/design/*` segment. Delete this folder
 * and these routes are never registered — auto-discovery.
 *
 * Full URL = /api + the path below. Contract: backend/endpoints.md.
 */

use Epal\Modules\Woodart\Design\DrawingController;
use Epal\Modules\Woodart\Design\RevisionController;
use Illuminate\Support\Facades\Route;

// Deliverables — frontend `wa_drawings` store (api.js HYDRATE + CONDITIONAL).
Route::get('woodart/design/drawings', [DrawingController::class, 'index']);
Route::post('woodart/design/drawings', [DrawingController::class, 'store']);
Route::delete('woodart/design/drawings/{id}', [DrawingController::class, 'destroy']);

// The revision trail — READ ONLY. Rows are written by DesignService as the side
// effect of a drawing moving state; a write endpoint would let a client
// fabricate an approval that never happened.
Route::get('woodart/design/revisions', [RevisionController::class, 'index']);
Route::get('woodart/design/drawings/{id}/revisions', [RevisionController::class, 'forDrawing']);

// Derived reads — the SPA computes both client-side, so it does not call them
// today. They exist so the lifecycle and the PHASE GATE have one authoritative
// server-side definition, and for reports.
Route::get('woodart/design/approvals', [DrawingController::class, 'approvals']);
Route::get('woodart/design/load', [DrawingController::class, 'load']);
