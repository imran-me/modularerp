<?php
use Epal\Modules\Travels\VisaProcessing\VisaCategoryController;
use Epal\Modules\Travels\VisaProcessing\VisaSaleController;
use Illuminate\Support\Facades\Route;

Route::get('travels/visa-processing/categories', [VisaCategoryController::class, 'index']);
Route::get('travels/visa-processing/sales', [VisaSaleController::class, 'index']);
