<?php

/**
 * Travels Contract File — module API routes. Owns `travels/contract-file/*`.
 * Frontend store: tv_contracts.
 */

use Epal\Modules\Travels\ContractFile\ContractController;
use Illuminate\Support\Facades\Route;

Route::get('travels/contract-file/contracts', [ContractController::class, 'index']);
Route::post('travels/contract-file/contracts', [ContractController::class, 'store']);
Route::delete('travels/contract-file/contracts/{id}', [ContractController::class, 'destroy']);
