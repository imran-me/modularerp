<?php

namespace Epal\Modules\GroupCockpit\MasterAccounts;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

/**
 * Suppliers.
 * ----------------------------------------------------------------------------
 * Serves the REAL `suppliers` table in the shape the frontend `suppliers` store
 * reads. The suppliers table has no company_id, so these are group-wide.
 *   old.name        -> name
 *   old.email       -> email
 *   old.phone       -> phone
 *   old.address     -> address
 *   old.is_active   -> status (active|inactive)
 *
 * Pure read/translate.
 */
class SupplierController
{
    public function index(): JsonResponse
    {
        $rows = DB::table('suppliers')
            ->orderBy('name')
            ->get(['id', 'name', 'email', 'phone', 'address', 'is_active']);

        $data = $rows->map(function ($s) {
            return [
                'id'      => 'SUP-' . $s->id,
                'name'    => $s->name,
                'email'   => $s->email ?: '',
                'phone'   => $s->phone ?: '',
                'address' => $s->address ?: '',
                'status'  => (int) $s->is_active === 1 ? 'active' : 'inactive',
            ];
        })->values();

        return response()->json([
            'success' => true,
            'count'   => $data->count(),
            'data'    => $data,
        ]);
    }
}
