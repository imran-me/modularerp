<?php

/**
 * Woodart · Spaces & Phases — module API routes.
 * ----------------------------------------------------------------------------
 * Loaded by platform/backend's ModuleServiceProvider under the shared /api
 * group (which also applies auth:sanctum). This module owns the
 * `woodart/scope/*` path segment and nothing else. Delete this folder and these
 * routes are simply never registered — that is auto-discovery, and it is what
 * makes a module genuinely drop-in / drop-out.
 *
 * Full URL of each route = /api + the path given here. The frozen contract for
 * every one of them is in backend/endpoints.md.
 */

/* Every controller named below MUST be imported. routes.php declares no
 * namespace, so an un-imported `Foo::class` silently resolves to the global
 * "Foo" — it registers a route quite happily and only explodes when that route
 * is dispatched or `route:list` walks it. Materials lost `route:list` entirely
 * to exactly this, once. */
use Epal\Modules\Woodart\Scope\PhaseController;
use Epal\Modules\Woodart\Scope\PhaseTemplateController;
use Epal\Modules\Woodart\Scope\RequirementController;
use Epal\Modules\Woodart\Scope\SpaceController;
use Illuminate\Support\Facades\Route;

/* SPACES — the rooms a project is built in. Frontend `wa_spaces` store. */
Route::get('woodart/scope/spaces', [SpaceController::class, 'index']);
Route::post('woodart/scope/spaces', [SpaceController::class, 'store']);
Route::delete('woodart/scope/spaces/{id}', [SpaceController::class, 'destroy']);
Route::post('woodart/scope/spaces/{id}/apply-template', [SpaceController::class, 'applyTemplate']);

/* PHASES — a stage of work inside one space. Frontend `wa_phases` store. */
Route::get('woodart/scope/phases', [PhaseController::class, 'index']);
Route::post('woodart/scope/phases', [PhaseController::class, 'store']);
Route::delete('woodart/scope/phases/{id}', [PhaseController::class, 'destroy']);

/* REQUIREMENTS — what a phase needs. The write is a PUT that replaces one
 * phase's whole set, because that is what the editor hands back. */
Route::get('woodart/scope/requirements', [RequirementController::class, 'index']);
Route::post('woodart/scope/requirements', [RequirementController::class, 'store']);
Route::put('woodart/scope/requirements', [RequirementController::class, 'replace']);
Route::delete('woodart/scope/requirements/{id}', [RequirementController::class, 'destroy']);

/* DERIVED READS. The SPA computes both client-side from the hydrated stores, so
 * it does not call them today — they exist for reports, for a future mobile
 * client, and so each rule has ONE server-side definition to point at. */
Route::get('woodart/scope/demand', [RequirementController::class, 'demand']);
Route::get('woodart/scope/load', [PhaseController::class, 'load']);

/* TEMPLATES — read-only master data (the default phase list per room kind). */
Route::get('woodart/scope/templates', [PhaseTemplateController::class, 'index']);
