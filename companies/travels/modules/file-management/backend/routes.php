<?php

/**
 * Travels File Management — module API routes.
 * ----------------------------------------------------------------------------
 * Loaded by platform/backend ModuleServiceProvider under the shared /api group
 * (auth:sanctum applied centrally). Owns the `travels/file-management/*` segment.
 * Full URL of each route below = /api + the path given here.
 */

use Epal\Modules\Travels\FileManagement\FileController;
use Illuminate\Support\Facades\Route;

// Visa files (module-owned `tv_files` table) — frontend `tv_files` store.
Route::get('travels/file-management/files', [FileController::class, 'index']);
Route::post('travels/file-management/files', [FileController::class, 'store']);
Route::delete('travels/file-management/files/{id}', [FileController::class, 'destroy']);
