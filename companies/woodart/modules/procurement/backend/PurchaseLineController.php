<?php

namespace Epal\Modules\Woodart\Procurement;

use Epal\Modules\Woodart\Procurement\Http\Resources\PurchaseLineResource;
use Epal\Modules\Woodart\Procurement\Models\PurchaseLine;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Schema;

/**
 * Purchase order LINES — serves the frontend `wa_purchase_lines` store.
 *
 * Thin, and Schema::hasTable-guarded like every other controller here: a host
 * that has pulled the code but not migrated answers with an honest empty list
 * rather than a 500, and a save says plainly what has to be run.
 */
class PurchaseLineController
{
    private const TABLE = 'wa_purchase_lines';

    /** GET /api/woodart/procurement/lines[?order=WPO-101][&project=WAP-101] */
    public function index(Request $request): JsonResponse
    {
        if (! Schema::hasTable(self::TABLE)) {
            return response()->json(['success' => true, 'provisioned' => false, 'count' => 0, 'data' => []]);
        }
        $q = PurchaseLine::where('company_id', 'woodart');
        if ($request->query('order')) {
            $q->where('order', $request->query('order'));
        }
        if ($request->query('project')) {
            $q->where('project', $request->query('project'));
        }
        $rows = $q->orderBy('id')->get();

        return response()->json([
            'success'     => true,
            'provisioned' => true,
            'count'       => $rows->count(),
            'data'        => PurchaseLineResource::collection($rows),
        ]);
    }

    /** POST /api/woodart/procurement/lines — create or update, keyed on `id`. */
    public function store(Request $request): JsonResponse
    {
        if (! Schema::hasTable(self::TABLE)) {
            return response()->json([
                'success'     => true,
                'provisioned' => false,
                'message'     => 'wa_purchase_lines table not migrated yet. Run: php artisan migrate',
            ]);
        }
        $data = $request->all();
        $saved = PurchaseLine::updateOrCreate(
            ['company_id' => 'woodart', 'ext_id' => $data['id'] ?? ('POL-'.str_pad((string) (PurchaseLine::count() + 1), 4, '0', STR_PAD_LEFT))],
            [
                'order'     => $data['order'] ?? '',
                'project'   => $data['project'] ?? null,
                'material'  => $data['material'] ?? null,
                'item'      => trim((string) ($data['item'] ?? '')),
                'qty'       => (float) ($data['qty'] ?? 0),
                'unit'      => $data['unit'] ?? null,
                'unit_cost' => (int) ($data['unitCost'] ?? 0),
            ]
        );

        return response()->json(['success' => true, 'data' => new PurchaseLineResource($saved)]);
    }

    /** DELETE /api/woodart/procurement/lines/{id} */
    public function destroy(string $id): JsonResponse
    {
        if (Schema::hasTable(self::TABLE)) {
            PurchaseLine::where('company_id', 'woodart')->where('ext_id', $id)->delete();
        }

        return response()->json(['success' => true]);
    }
}
