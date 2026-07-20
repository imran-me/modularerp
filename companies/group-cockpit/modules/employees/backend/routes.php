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
use Epal\Modules\GroupCockpit\Employees\PerformanceController;
use Illuminate\Support\Facades\Route;

// Employee Directory — the group-wide workforce (real `users` LEFT JOIN
// `employee_profiles`), returned in the shape the frontend employees store
// (db.employees()) expects.
Route::get('group/employees/directory', [EmployeeController::class, 'index']);
Route::post('group/employees/directory', [EmployeeController::class, 'store']);
Route::delete('group/employees/directory/{id}', [EmployeeController::class, 'destroy']);

// Day-basis attendance KPI totals (Present / Absent / Late / On Leave) for one
// date — drives the date selector on the Attendance screen. Read-only.
Route::get('group/employees/attendance', [EmployeeController::class, 'attendanceByDate']);

// Performance reviews — the real rating source (frontend `perf_reviews` store).
Route::get('group/employees/reviews', [PerformanceController::class, 'index']);
Route::post('group/employees/reviews', [PerformanceController::class, 'store']);
Route::delete('group/employees/reviews/{id}', [PerformanceController::class, 'destroy']);
