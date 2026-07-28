<?php

/**
 * Woodart · Accounts — module API routes.
 * ----------------------------------------------------------------------------
 * Loaded by platform/backend's ModuleServiceProvider under the shared /api
 * group (which also applies auth:sanctum). This module owns the
 * `woodart/accounts/*` path segment. Delete this folder and these routes are
 * never registered — auto-discovery.
 *
 * Full URL of each route = /api + the path given here.
 * The frozen contract is in backend/endpoints.md.
 *
 * ⚠️ EVERY controller named below MUST be imported. routes.php declares no
 * namespace, so an un-imported `Foo::class` resolves to the global "Foo" — it
 * does not fail at parse time, registers a route quite happily, and only
 * explodes when that route is dispatched or `route:list` walks it. That bug
 * took out route:list for the ENTIRE application once already; the gate is
 * tools/verify/routes-imports.mjs.
 */

use Epal\Modules\Woodart\Accounts\AccountsController;
use Illuminate\Support\Facades\Route;

/* The register — income and expense, over the SHARED `acc_entries` table.
 * Writes go through the kernel posting services (App\Services\*PostingService),
 * so a Woodart entry lands on exactly the same books as a Travels one. */
Route::get('woodart/accounts/register', [AccountsController::class, 'register']);
Route::post('woodart/accounts/register', [AccountsController::class, 'store']);

// A void posts a REVERSAL, never a silent delete (AUDIT P2): a balance must not
// move without a row explaining why.
Route::delete('woodart/accounts/register/{id}', [AccountsController::class, 'destroy']);

/* Payables — the 2000 Accounts Payable balance that Procurement's goods
 * receipts raise, broken down by vendor and purchase order. */
Route::get('woodart/accounts/payables', [AccountsController::class, 'payables']);
Route::post('woodart/accounts/payables/{po}/pay', [AccountsController::class, 'pay']);

/* Project P&L — contract value vs committed cost vs the BOQ budget. The reason
 * this desk is not a copy of Travels: no other company has a bill of
 * quantities, so no other company can say whether a job is eating more material
 * than it was quoted for. */
Route::get('woodart/accounts/project-pnl', [AccountsController::class, 'projectPnl']);
