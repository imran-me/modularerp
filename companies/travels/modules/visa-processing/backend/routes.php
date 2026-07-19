<?php
use Epal\Modules\Travels\VisaProcessing\VisaCategoryController;
use Epal\Modules\Travels\VisaProcessing\VisaSaleController;
use Illuminate\Support\Facades\Route;

Route::get('travels/visa-processing/categories', [VisaCategoryController::class, 'index']);
Route::post('travels/visa-processing/categories', [VisaCategoryController::class, 'store']);
Route::delete('travels/visa-processing/categories/{id}', [VisaCategoryController::class, 'destroy']);

Route::get('travels/visa-processing/sales', [VisaSaleController::class, 'index']);
