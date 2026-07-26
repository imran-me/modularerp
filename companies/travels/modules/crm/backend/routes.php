<?php

/**
 * Travels CRM — module API routes. Owns `travels/crm/*`. {store} = leads | activities.
 * Frontend stores: leads, crm_activities.
 */

use Epal\Modules\Travels\Crm\CrmController;
use Illuminate\Support\Facades\Route;

Route::get('travels/crm/books/{store}', [CrmController::class, 'index'])->where('store', 'leads|activities');
Route::post('travels/crm/books/{store}', [CrmController::class, 'store'])->where('store', 'leads|activities');
Route::delete('travels/crm/books/{store}/{id}', [CrmController::class, 'destroy'])->where('store', 'leads|activities');
