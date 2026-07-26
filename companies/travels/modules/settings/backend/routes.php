<?php

/**
 * Travels Settings — module API routes.
 * ----------------------------------------------------------------------------
 * Loaded by platform/backend ModuleServiceProvider under the shared /api group
 * (auth:sanctum applied centrally). Owns the `travels/settings/*` path segment.
 * Full URL of each route below = /api + the path given here.
 */

use Epal\Modules\Travels\Settings\SettingsController;
use Illuminate\Support\Facades\Route;

// Company settings blob (company_settings table) — frontend `settings.travels`.
Route::get('travels/settings/config', [SettingsController::class, 'index']);
Route::post('travels/settings/config', [SettingsController::class, 'store']);
