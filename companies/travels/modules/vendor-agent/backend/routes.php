<?php

/**
 * Travels Vendor & Agent — module API routes. Owns `travels/vendor-agent/*`.
 * {store} = agents | vendors | party-txns | commissions | portals | portal-txns.
 * Frontend stores: tv_agents, vendors, party_txns, tv_comm_paid, tv_portals, tv_portal_txns.
 */

use Epal\Modules\Travels\VendorAgent\VendorAgentController;
use Illuminate\Support\Facades\Route;

Route::get('travels/vendor-agent/books/{store}', [VendorAgentController::class, 'index'])->where('store', 'agents|vendors|party-txns|commissions|portals|portal-txns');
Route::post('travels/vendor-agent/books/{store}', [VendorAgentController::class, 'store'])->where('store', 'agents|vendors|party-txns|commissions|portals|portal-txns');
Route::delete('travels/vendor-agent/books/{store}/{id}', [VendorAgentController::class, 'destroy'])->where('store', 'agents|vendors|party-txns|commissions|portals|portal-txns');
