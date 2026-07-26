<?php

/**
 * Travels Contract Flight — module API routes. Owns `travels/contract-flight/*`.
 * Frontend store: tv_contract_flights.
 */

use Epal\Modules\Travels\ContractFlight\ContractFlightController;
use Illuminate\Support\Facades\Route;

Route::get('travels/contract-flight/flights', [ContractFlightController::class, 'index']);
Route::post('travels/contract-flight/flights', [ContractFlightController::class, 'store']);
Route::delete('travels/contract-flight/flights/{id}', [ContractFlightController::class, 'destroy']);
