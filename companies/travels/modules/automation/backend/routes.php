<?php

/**
 * Travels Automation — module API routes (loaded by ModuleServiceProvider under
 * /api with auth:sanctum). Owns `travels/automation/*`. {store} = rules | markup.
 * Frontend stores: tv_automation, tv_markup.
 */

use Epal\Modules\Travels\Automation\AutomationBookController;
use Illuminate\Support\Facades\Route;

Route::get('travels/automation/books/{store}', [AutomationBookController::class, 'index'])->where('store', 'rules|markup');
Route::post('travels/automation/books/{store}', [AutomationBookController::class, 'store'])->where('store', 'rules|markup');
Route::delete('travels/automation/books/{store}/{id}', [AutomationBookController::class, 'destroy'])->where('store', 'rules|markup');
