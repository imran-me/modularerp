<?php

use Epal\Modules\Travels\AirTicketing\AirlineController;
use Epal\Modules\Travels\AirTicketing\AirportController;
use Epal\Modules\Travels\AirTicketing\TicketPurchaseController;
use Illuminate\Support\Facades\Route;

Route::get('travels/air-ticketing/airlines', [AirlineController::class, 'index']);
Route::post('travels/air-ticketing/airlines', [AirlineController::class, 'store']);
Route::delete('travels/air-ticketing/airlines/{id}', [AirlineController::class, 'destroy']);

Route::get('travels/air-ticketing/airports', [AirportController::class, 'index']);
Route::post('travels/air-ticketing/airports', [AirportController::class, 'store']);
Route::delete('travels/air-ticketing/airports/{id}', [AirportController::class, 'destroy']);

Route::get('travels/air-ticketing/purchases', [TicketPurchaseController::class, 'index']);
