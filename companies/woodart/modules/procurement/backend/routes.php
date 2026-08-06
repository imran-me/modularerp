<?php

/**
 * Woodart · Procurement — module API routes.
 * ----------------------------------------------------------------------------
 * Loaded by platform/backend's ModuleServiceProvider under the shared /api
 * group (which also applies auth:sanctum). This module owns the
 * `woodart/procurement/*` path segment and nothing else. Delete this folder and
 * these routes are never registered — that is auto-discovery, and it is what
 * makes a module genuinely drop-in / drop-out.
 *
 * Full URL of each route below = /api + the path given here.
 * The frozen contract is in backend/endpoints.md.
 */

use Epal\Modules\Woodart\Procurement\PurchaseOrderController;
use Epal\Modules\Woodart\Procurement\VendorController;
use Illuminate\Support\Facades\Route;

// Purchase orders — frontend `wa_purchases` store (api.js HYDRATE + WRITABLE).
Route::get('woodart/procurement/orders', [PurchaseOrderController::class, 'index']);
Route::post('woodart/procurement/orders', [PurchaseOrderController::class, 'store']);
Route::delete('woodart/procurement/orders/{id}', [PurchaseOrderController::class, 'destroy']);

// Vendors — frontend `wa_vendors` store (api.js HYDRATE + WRITABLE).
Route::get('woodart/procurement/vendors', [VendorController::class, 'index']);
Route::post('woodart/procurement/vendors', [VendorController::class, 'store']);
Route::delete('woodart/procurement/vendors/{id}', [VendorController::class, 'destroy']);

// Derived read. The SPA computes this client-side from the hydrated stores, so
// it does not call it today — it exists so the order→vendor join and the
// outstanding rule have ONE authoritative server-side definition, and for
// reports or any future client that cannot hold both tables in memory.
Route::get('woodart/procurement/spend', [PurchaseOrderController::class, 'spend']);

/* ORDER LINES (2026-08-06) — what an order actually orders, per material. An
 * order used to carry only a total and an item count, so a part-delivery of 100
 * bricks had nothing to be part of. */
Route::get('woodart/procurement/lines', [PurchaseLineController::class, 'index']);
Route::post('woodart/procurement/lines', [PurchaseLineController::class, 'store']);
Route::delete('woodart/procurement/lines/{id}', [PurchaseLineController::class, 'destroy']);
