<?php

/**
 * Master Accounts — module API routes.
 * ----------------------------------------------------------------------------
 * Loaded by platform/backend ModuleServiceProvider under the shared /api group.
 * This module owns the `group/master-accounts/*` path segment. Delete this
 * folder and these routes are simply never registered (auto-discovery).
 *
 * Full URL of each route below = /api + the path given here.
 */

use Epal\Modules\GroupCockpit\MasterAccounts\AccountController;
use Epal\Modules\GroupCockpit\MasterAccounts\BankController;
use Epal\Modules\GroupCockpit\MasterAccounts\JournalController;
use Epal\Modules\GroupCockpit\MasterAccounts\CustomerController;
use Epal\Modules\GroupCockpit\MasterAccounts\SupplierController;
use Epal\Modules\GroupCockpit\MasterAccounts\PaymentScheduleController;
use Illuminate\Support\Facades\Route;

// Chart of Accounts — the group-wide account list (real `accounts` table),
// returned in the shape the frontend ledger expects.
Route::get('group/master-accounts/accounts', [AccountController::class, 'index']);

// Bank accounts (real `banks` table) — frontend `banks` store.
Route::get('group/master-accounts/banks', [BankController::class, 'index']);

// Journal entries + their items (real `journal_entries` + `journal_items`),
// each entry with its lines nested — frontend `gl_entries` store.
Route::get('group/master-accounts/journals', [JournalController::class, 'index']);

// Customers (real `customers` table) — frontend `customers` store.
Route::get('group/master-accounts/customers', [CustomerController::class, 'index']);

// Suppliers (real `suppliers` table) — frontend `suppliers` store.
Route::get('group/master-accounts/suppliers', [SupplierController::class, 'index']);

// Payment schedules (real `payment_schedules` table) — frontend `acc_schedules` store.
Route::get('group/master-accounts/schedules', [PaymentScheduleController::class, 'index']);
