<?php
namespace Epal\Modules\Travels\VisaProcessing;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

/**
 * VisaCategoryController — real `visa_categories` rows mapped onto the
 * frontend `visaCats` store shape read by view.js (categories / visa-rates).
 *
 * Frontend category shape (view.js editCategory / categories table):
 *   { id, country, flag, type, cost, sale, days, status }
 *   margin is derived on the client as round((sale-cost)/sale*100).
 *
 * index() is pure read/translate. store()/destroy() are master-data writes
 * (pricing catalog, not a ledger posting — safe to write directly). `flag`
 * is a frontend-only emoji decoration with no DB column; not persisted,
 * same as the read side always returning the static 🌍.
 */
class VisaCategoryController
{
    private function present(object $r): array
    {
        $country = $r->country_name ?: ($r->description ?: $r->name);
        $days = 0;
        if ($r->avg_processing_days !== null && preg_match('/\d+/', $r->avg_processing_days, $m)) {
            $days = (int) $m[0];
        }
        return [
            'id'      => 'VC-' . $r->id,
            'country' => $country,
            'name'    => $r->name,
            'flag'    => '🌍',
            'type'    => $r->visa_type ?: 'Tourist',
            'cost'    => (float) $r->costing_price,
            'sale'    => (float) $r->sale_price,
            'days'    => $days,
            'status'  => ((int) $r->is_active === 1) ? 'active' : 'inactive',
        ];
    }

    private function reload(int $id): ?object
    {
        return DB::table('visa_categories as vc')
            ->leftJoin('countries as c', 'c.id', '=', 'vc.country_id')
            ->where('vc.id', $id)
            ->first(['vc.id', 'vc.name', 'vc.visa_type', 'vc.description', 'vc.costing_price',
                'vc.sale_price', 'vc.avg_processing_days', 'vc.is_active', 'c.name as country_name']);
    }

    public function index(): JsonResponse
    {
        $rows = DB::table('visa_categories as vc')
            ->leftJoin('countries as c', 'c.id', '=', 'vc.country_id')
            ->whereNull('vc.deleted_at')
            ->orderBy('vc.name')
            ->get(['vc.id', 'vc.name', 'vc.visa_type', 'vc.description', 'vc.costing_price',
                'vc.sale_price', 'vc.avg_processing_days', 'vc.is_active', 'c.name as country_name']);

        return response()->json([
            'success' => true,
            'count'   => $rows->count(),
            'data'    => $rows->map(fn ($r) => $this->present($r))->values(),
        ]);
    }

    /** countries.code is NOT NULL + UNIQUE with no frontend field for it —
     *  same generated-code find-or-create as AirportController::countryId()
     *  (each module owns its own copy by design — self-contained, drop-in/
     *  drop-out folders, see CLAUDE.md). */
    private function countryId(?string $name): ?int
    {
        $name = trim((string) $name);
        if ($name === '') return null;
        $row = DB::table('countries')->where('name', $name)->first('id');
        if ($row) return $row->id;

        $base = strtoupper(substr(preg_replace('/[^A-Za-z]/', '', $name) ?: 'XX', 0, 3)) ?: 'XX';
        $code = $base;
        $i = 1;
        while (DB::table('countries')->where('code', $code)->exists()) {
            $code = $base . $i++;
        }

        return DB::table('countries')->insertGetId([
            'name' => $name, 'code' => $code, 'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    public function store(\Illuminate\Http\Request $request): JsonResponse
    {
        $v = $request->validate([
            'id'      => 'nullable|string',
            'country' => 'required|string|max:255',
            'type'    => 'nullable|string|max:255',
            'days'    => 'nullable|integer|min:0',
            'cost'    => 'nullable|numeric',
            'sale'    => 'nullable|numeric',
            'status'  => 'nullable|in:active,inactive',
        ]);

        $existingId = null;
        if (!empty($v['id']) && str_starts_with($v['id'], 'VC-')) {
            $n = (int) substr($v['id'], 3);
            if ($n > 0 && DB::table('visa_categories')->where('id', $n)->whereNull('deleted_at')->exists()) {
                $existingId = $n;
            }
        }

        $row = [
            'name'                 => $v['country'],
            'country_id'           => $this->countryId($v['country']),
            'visa_type'            => $v['type'] ?? 'Tourist',
            'costing_price'        => $v['cost'] ?? 0,
            'sale_price'           => $v['sale'] ?? 0,
            'avg_processing_days'  => (string) ($v['days'] ?? 0),
            'is_active'            => ($v['status'] ?? 'active') === 'active' ? 1 : 0,
            'updated_at'           => now(),
        ];

        if ($existingId) {
            DB::table('visa_categories')->where('id', $existingId)->update($row);
            $id = $existingId;
        } else {
            $row['created_at'] = now();
            $id = DB::table('visa_categories')->insertGetId($row);
        }

        return response()->json(['success' => true, 'data' => $this->present($this->reload($id))]);
    }

    public function destroy(string $id): JsonResponse
    {
        $n = (int) str_replace('VC-', '', $id);
        if ($n > 0) {
            DB::table('visa_categories')->where('id', $n)->update(['deleted_at' => now()]);
        }

        return response()->json(['success' => true]);
    }
}
