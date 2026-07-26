<?php

/**
 * Travels HRM — module API routes. Owns `travels/hrm/*` for its OWN store.
 * Frontend store: tv_leaves. (Employees/users come from the group/employees backend.)
 */

use Epal\Modules\Travels\Hrm\LeaveController;
use Illuminate\Support\Facades\Route;

Route::get('travels/hrm/leaves', [LeaveController::class, 'index']);
Route::post('travels/hrm/leaves', [LeaveController::class, 'store']);
Route::delete('travels/hrm/leaves/{id}', [LeaveController::class, 'destroy']);
