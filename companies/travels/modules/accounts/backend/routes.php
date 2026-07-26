<?php

/**
 * Travels Accounts — module API routes.
 * ----------------------------------------------------------------------------
 * Loaded by platform/backend ModuleServiceProvider under the shared /api group
 * (auth:sanctum applied centrally). Owns the `travels/accounts/*` path segment
 * for its OWN stores (recurring / cheques / petty). The income/expense register,
 * schedules and banks are served by the Master Accounts backend.
 * Full URL of each route below = /api + the path given here.
 */

use Epal\Modules\Travels\Accounts\AccountsBookController;
use Epal\Modules\Travels\Accounts\ExpenseController;
use Illuminate\Support\Facades\Route;

// Travels Accounts books — {store} = recurring | cheques | petty.
// Frontend stores: tv_recurring, tv_cheques, tv_petty.
Route::get('travels/accounts/books/{store}', [AccountsBookController::class, 'index'])->where('store', 'recurring|cheques|petty');
Route::post('travels/accounts/books/{store}', [AccountsBookController::class, 'store'])->where('store', 'recurring|cheques|petty');
Route::delete('travels/accounts/books/{store}/{id}', [AccountsBookController::class, 'destroy'])->where('store', 'recurring|cheques|petty');

// Record Expense — ONE call writes the register, the ledger and the paying
// account's own history in one transaction (App\Services\ExpensePostingService).
// /form serves the account heads + payment accounts the capture form offers,
// already ordered (expense codes first · Travels' accounts first, bank → cash).
Route::get('travels/accounts/expenses', [ExpenseController::class, 'index']);
Route::get('travels/accounts/expenses/form', [ExpenseController::class, 'formData']);
Route::post('travels/accounts/expenses', [ExpenseController::class, 'store']);
Route::delete('travels/accounts/expenses/{voucher}', [ExpenseController::class, 'destroy']);
