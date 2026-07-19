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
 * index() is pure read/translate. store()/update()/destroy() are the write
 * side: master data only (name/contact/status), never touches the ledger —
 * safe to write directly, unlike journals/accounts which need the corrected
 * posting logic first (see docs/BACKEND-ARCHITECTURE.md).
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

    /** Frontend slug -> DB companies.id (inverse of companySlug()). */
    private function companyId(?string $slug): ?int
    {
        $map = [
            'it' => 1, 'travels' => 2, 'construction' => 3, 'group' => 4,
            'shop' => 5, 'woodart' => 6,
        ];
        return $map[$slug] ?? null;
    }

    private function present(object $c): array
    {
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
    }

    public function index(): JsonResponse
    {
        $rows = DB::table('customers')
            ->orderBy('name')
            ->get(['id', 'company_id', 'name', 'email', 'phone', 'address', 'is_active']);

        return response()->json([
            'success' => true,
            'count'   => $rows->count(),
            'data'    => $rows->map(fn ($c) => $this->present($c))->values(),
        ]);
    }

    /** Create OR update, keyed by the frontend's 'CUS-<n>' id (n may be a
     *  client-generated temp id that doesn't exist yet — that means create). */
    public function store(\Illuminate\Http\Request $request): JsonResponse
    {
        $v = $request->validate([
            'id'         => 'nullable|string',
            'name'       => 'required|string|max:255',
            'companyIds' => 'nullable|array',
            'contact'    => 'nullable|string|max:255',
            'phone'      => 'nullable|string|max:50',
            'email'      => 'nullable|email|max:255',
            'status'     => 'nullable|in:active,inactive',
        ]);

        $existingId = null;
        if (!empty($v['id']) && str_starts_with($v['id'], 'CUS-')) {
            $n = (int) substr($v['id'], 4);
            if ($n > 0 && DB::table('customers')->where('id', $n)->exists()) {
                $existingId = $n;
            }
        }

        $row = [
            'name'       => $v['name'],
            'email'      => $v['email'] ?? null,
            'phone'      => $v['phone'] ?? null,
            'address'    => $v['contact'] ?? null,
            'company_id' => $this->companyId($v['companyIds'][0] ?? null),
            'is_active'  => ($v['status'] ?? 'active') === 'active' ? 1 : 0,
            'updated_at' => now(),
        ];

        if ($existingId) {
            DB::table('customers')->where('id', $existingId)->update($row);
            $id = $existingId;
        } else {
            $row['created_at'] = now();
            $id = DB::table('customers')->insertGetId($row);
        }

        $saved = DB::table('customers')->where('id', $id)
            ->first(['id', 'company_id', 'name', 'email', 'phone', 'address', 'is_active']);

        return response()->json(['success' => true, 'data' => $this->present($saved)]);
    }

    public function destroy(string $id): JsonResponse
    {
        $n = (int) str_replace('CUS-', '', $id);
        if ($n > 0) {
            DB::table('customers')->where('id', $n)->delete();
        }

        return response()->json(['success' => true]);
    }
}
