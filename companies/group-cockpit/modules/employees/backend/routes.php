<?php

/**
 * Employees — module API routes.
 * ----------------------------------------------------------------------------
 * Loaded by platform/backend ModuleServiceProvider under the shared /api group.
 * This module owns the `group/employees/*` path segment. Delete this folder and
 * these routes are simply never registered (auto-discovery).
 *
 * Full URL of each route below = /api + the path given here.
 */

use Epal\Modules\GroupCockpit\Employees\EmployeeController;
use Illuminate\Support\Facades\Route;

// Employee Directory — the group-wide workforce (real `users` LEFT JOIN
// `employee_profiles`), returned in the shape the frontend employees store
// (db.employees()) expects.
Route::get('group/employees/directory', [EmployeeController::class, 'index']);
