<?php

use App\Http\Controllers\AuthController;
use Illuminate\Support\Facades\Route;

// Kernel API routes (auth + health). MODULE routes are auto-registered from
// each module's backend routes.php by the ModuleServiceProvider — they are NOT
// listed here (that is the whole point of the modular loader).

Route::get('health', fn () => response()->json(['ok' => true, 'service' => 'epal-kernel']));

// Real password login — issues a Sanctum bearer token.
Route::post('login', [AuthController::class, 'login']);

Route::middleware('auth:sanctum')->group(function () {
    Route::get('me', [AuthController::class, 'me']);
    Route::post('logout', [AuthController::class, 'logout']);
});
