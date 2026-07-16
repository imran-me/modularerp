<?php

namespace Epal\Modules\GroupCockpit\MasterAccounts;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

/**
 * Customers.
 * ----------------------------------------------------------------------------
 * Serves the REAL `customers` table in the shape the frontend `customers` store
 * reads (see seedCustomers() in platform/data/database.js):
 *   { id:'CUS-…', name, companyIds:[slug], contact, phone, email,
 *     value, since, tier, status }
 *
 *   old.name        -> name
 *   old.email       -> email
 *   old.phone       -> phone
 *   old.address     -> contact (best available human label besides the name)
 *   old.company_id  -> companyIds (single-element array of the frontend slug)
 *   old.is_active   -> status (active|inactive)
 *
 * Pure read/translate.
 */
class CustomerController
{
    /** DB companies.id -> frontend company slug (matches platform/core/config.js). */
    private function companySlug($id): string
    {
        $map = [
            1 => 'it', 2 => 'travels', 3 => 'construction', 4 => 'group',
            5 => 'shop', 6 => 'woodart',
        ];
        return $map[(int) $id] ?? 'group';
    }

    public function index(): JsonResponse
    {
        $rows = DB::table('customers')
            ->orderBy('name')
            ->get(['id', 'company_id', 'name', 'email', 'phone', 'address', 'is_active']);

        $data = $rows->map(function ($c) {
            return [
                'id'         => 'CUS-' . $c->id,
                'name'       => $c->name,
                'companyIds' => [$this->companySlug($c->company_id)],
                'contact'    => $c->address ?: '',
                'phone'      => $c->phone ?: '',
                'email'      => $c->email ?: '',
                'value'      => 0,
                'tier'       => 'Standard',
                'status'     => (int) $c->is_active === 1 ? 'active' : 'inactive',
            ];
        })->values();

        return response()->json([
            'success' => true,
            'count'   => $data->count(),
            'data'    => $data,
        ]);
    }
}
