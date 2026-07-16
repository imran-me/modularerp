<?php

use Epal\Modules\Travels\AirTicketing\AirlineController;
use Epal\Modules\Travels\AirTicketing\AirportController;
use Epal\Modules\Travels\AirTicketing\TicketPurchaseController;
use Illuminate\Support\Facades\Route;

Route::get('travels/air-ticketing/airlines', [AirlineController::class, 'index']);
Route::get('travels/air-ticketing/airports', [AirportController::class, 'index']);
Route::get('travels/air-ticketing/purchases', [TicketPurchaseController::class, 'index']);
