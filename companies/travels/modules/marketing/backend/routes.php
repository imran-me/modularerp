<?php

/**
 * Travels Marketing — module API routes.
 * ----------------------------------------------------------------------------
 * Loaded by platform/backend ModuleServiceProvider under the shared /api group
 * (auth:sanctum applied centrally). Owns the `travels/marketing/*` path segment.
 * Full URL of each route below = /api + the path given here.
 */

use Epal\Modules\Travels\Marketing\MarketingBookController;
use Illuminate\Support\Facades\Route;

// Marketing books — {store} = campaigns | templates | messages | bookings | chat.
Route::get('travels/marketing/books/{store}', [MarketingBookController::class, 'index'])->where('store', 'campaigns|templates|messages|bookings|chat');
Route::post('travels/marketing/books/{store}', [MarketingBookController::class, 'store'])->where('store', 'campaigns|templates|messages|bookings|chat');
Route::delete('travels/marketing/books/{store}/{id}', [MarketingBookController::class, 'destroy'])->where('store', 'campaigns|templates|messages|bookings|chat');
