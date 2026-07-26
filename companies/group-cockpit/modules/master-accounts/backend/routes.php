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
use Epal\Modules\GroupCockpit\MasterAccounts\BankTxnController;
use Epal\Modules\GroupCockpit\MasterAccounts\JournalController;
use Epal\Modules\GroupCockpit\MasterAccounts\CustomerController;
use Epal\Modules\GroupCockpit\MasterAccounts\SupplierController;
use Epal\Modules\GroupCockpit\MasterAccounts\AccEntryController;
use Epal\Modules\GroupCockpit\MasterAccounts\ExpenseCategoryController;
use Epal\Modules\GroupCockpit\MasterAccounts\LoanController;
use Epal\Modules\GroupCockpit\MasterAccounts\PartyTypeController;
use Epal\Modules\GroupCockpit\MasterAccounts\PaymentScheduleController;
use Illuminate\Support\Facades\Route;

// Chart of Accounts — the group-wide account list (real `accounts` table),
// returned in the shape the frontend ledger expects.
Route::get('group/master-accounts/accounts', [AccountController::class, 'index']);
Route::post('group/master-accounts/accounts', [AccountController::class, 'store']);

// Bank accounts (real `banks` table) — frontend `banks` store.
Route::get('group/master-accounts/banks', [BankController::class, 'index']);
Route::post('group/master-accounts/banks', [BankController::class, 'store']);
Route::delete('group/master-accounts/banks/{id}', [BankController::class, 'destroy']);

// Journal entries + their items (real `journal_entries` + `journal_items`),
// each entry with its lines nested — frontend `gl_entries` store.
Route::get('group/master-accounts/journals', [JournalController::class, 'index']);
Route::post('group/master-accounts/journals', [JournalController::class, 'store']);
Route::delete('group/master-accounts/journals/{id}', [JournalController::class, 'destroy']);
// Bank transaction log (deposits/withdrawals/transfers) — the "Recent Bank
// Transactions" list; persisted so it survives reload and shows on every device.
Route::get('group/master-accounts/bank-transactions', [BankTxnController::class, 'index']);
Route::post('group/master-accounts/bank-transactions', [BankTxnController::class, 'store']);
Route::delete('group/master-accounts/bank-transactions/{id}', [BankTxnController::class, 'destroy']);

// Customers (real `customers` table) — frontend `customers` store.
Route::get('group/master-accounts/customers', [CustomerController::class, 'index']);
Route::post('group/master-accounts/customers', [CustomerController::class, 'store']);
Route::delete('group/master-accounts/customers/{id}', [CustomerController::class, 'destroy']);

// Suppliers (real `suppliers` table) — frontend `suppliers` store.
Route::get('group/master-accounts/suppliers', [SupplierController::class, 'index']);
Route::post('group/master-accounts/suppliers', [SupplierController::class, 'store']);
Route::delete('group/master-accounts/suppliers/{id}', [SupplierController::class, 'destroy']);

// Payment schedules (real `payment_schedules` table) — frontend `acc_schedules` store.
Route::get('group/master-accounts/schedules', [PaymentScheduleController::class, 'index']);
Route::post('group/master-accounts/schedules', [PaymentScheduleController::class, 'store']);
Route::delete('group/master-accounts/schedules/{id}', [PaymentScheduleController::class, 'destroy']);

// Party types (module-owned `party_types` lookup) — frontend `party_types` store.
Route::get('group/master-accounts/party-types', [PartyTypeController::class, 'index']);
Route::post('group/master-accounts/party-types', [PartyTypeController::class, 'store']);
Route::delete('group/master-accounts/party-types/{id}', [PartyTypeController::class, 'destroy']);

// Expense categories (module-owned `exp_categories` lookup) — frontend `exp_categories` store.
Route::get('group/master-accounts/expense-categories', [ExpenseCategoryController::class, 'index']);
Route::post('group/master-accounts/expense-categories', [ExpenseCategoryController::class, 'store']);
Route::delete('group/master-accounts/expense-categories/{id}', [ExpenseCategoryController::class, 'destroy']);

// Account entries — the income/expense register (module-owned `acc_entries`).
Route::get('group/master-accounts/entries', [AccEntryController::class, 'index']);
Route::post('group/master-accounts/entries', [AccEntryController::class, 'store']);
Route::delete('group/master-accounts/entries/{id}', [AccEntryController::class, 'destroy']);

// Loan books (module-owned) — {store} = products | ext | taken | txns.
// Frontend stores: loan_products, loans_ext, loans_taken, loan_txns.
Route::get('group/master-accounts/loans/{store}', [LoanController::class, 'index'])->where('store', 'products|ext|taken|txns');
Route::post('group/master-accounts/loans/{store}', [LoanController::class, 'store'])->where('store', 'products|ext|taken|txns');
Route::delete('group/master-accounts/loans/{store}/{id}', [LoanController::class, 'destroy'])->where('store', 'products|ext|taken|txns');
