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
 * index() is pure read/translate. store()/destroy() are master-data writes —
 * no ledger/AP balance involved, safe to write directly (mirrors
 * CustomerController's pattern exactly).
 */
class SupplierController
{
    private function present(object $s): array
    {
        return [
            'id'      => 'SUP-' . $s->id,
            'name'    => $s->name,
            'email'   => $s->email ?: '',
            'phone'   => $s->phone ?: '',
            'address' => $s->address ?: '',
            'status'  => (int) $s->is_active === 1 ? 'active' : 'inactive',
        ];
    }

    public function index(): JsonResponse
    {
        $rows = DB::table('suppliers')
            ->orderBy('name')
            ->get(['id', 'name', 'email', 'phone', 'address', 'is_active']);

        return response()->json([
            'success' => true,
            'count'   => $rows->count(),
            'data'    => $rows->map(fn ($s) => $this->present($s))->values(),
        ]);
    }

    /** Create OR update, keyed by the frontend's 'SUP-<n>' id (a client temp
     *  id that doesn't exist yet means create — same rule as Customers). */
    public function store(\Illuminate\Http\Request $request): JsonResponse
    {
        $v = $request->validate([
            'id'      => 'nullable|string',
            'name'    => 'required|string|max:255',
            'email'   => 'nullable|email|max:255',
            'phone'   => 'nullable|string|max:50',
            'address' => 'nullable|string|max:255',
            'status'  => 'nullable|in:active,inactive',
        ]);

        $existingId = null;
        if (!empty($v['id']) && str_starts_with($v['id'], 'SUP-')) {
            $n = (int) substr($v['id'], 4);
            if ($n > 0 && DB::table('suppliers')->where('id', $n)->exists()) {
                $existingId = $n;
            }
        }

        $row = [
            'name'       => $v['name'],
            'email'      => $v['email'] ?? null,
            'phone'      => $v['phone'] ?? null,
            'address'    => $v['address'] ?? null,
            'is_active'  => ($v['status'] ?? 'active') === 'active' ? 1 : 0,
            'updated_at' => now(),
        ];

        if ($existingId) {
            DB::table('suppliers')->where('id', $existingId)->update($row);
            $id = $existingId;
        } else {
            $row['created_at'] = now();
            $id = DB::table('suppliers')->insertGetId($row);
        }

        $saved = DB::table('suppliers')->where('id', $id)
            ->first(['id', 'name', 'email', 'phone', 'address', 'is_active']);

        return response()->json(['success' => true, 'data' => $this->present($saved)]);
    }

    public function destroy(string $id): JsonResponse
    {
        $n = (int) str_replace('SUP-', '', $id);
        if ($n > 0) {
            DB::table('suppliers')->where('id', $n)->delete();
        }

        return response()->json(['success' => true]);
    }
}
