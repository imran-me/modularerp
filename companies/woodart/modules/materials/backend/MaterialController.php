<?php

namespace Epal\Modules\Woodart\Materials;

use Epal\Modules\Woodart\Materials\Http\Requests\StoreMaterialRequest;
use Epal\Modules\Woodart\Materials\Http\Resources\MaterialResource;
use Epal\Modules\Woodart\Materials\Services\MaterialService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Schema;

/**
 * Materials API — serves the frontend `wa_materials` store.
 *
 * THIN BY DESIGN: validate (StoreMaterialRequest) → delegate (MaterialService)
 * → shape (MaterialResource). No business logic lives in this file.
 *
 * Every action is Schema::hasTable-guarded. That is not defensive noise — the
 * live host pulls code before anyone runs `php artisan migrate`, and without
 * the guard the SPA would show "Save failed" on a feature that works. A GET
 * degrades to an honest empty list; a POST says plainly what has to be run.
 *
 * @see backend/endpoints.md   the frozen contract this implements
 */
class MaterialController
{
    private const TABLE = 'wa_materials';

    public function __construct(private MaterialService $service) {}

    /** GET /api/woodart/materials/stock — the whole register. */
    public function index(): JsonResponse
    {
        if (! Schema::hasTable(self::TABLE)) {
            return response()->json(['success' => true, 'count' => 0, 'data' => []]);
        }
        $rows = $this->service->list();

        return response()->json([
            'success' => true,
            'count'   => $rows->count(),
            'data'    => MaterialResource::collection($rows),
        ]);
    }

    /** GET /api/woodart/materials/reorder — only what needs buying. */
    public function reorder(): JsonResponse
    {
        if (! Schema::hasTable(self::TABLE)) {
            return response()->json(['success' => true, 'count' => 0, 'data' => []]);
        }
        $rows = $this->service->belowReorder();

        return response()->json([
            'success' => true,
            'count'   => $rows->count(),
            'data'    => MaterialResource::collection($rows),
        ]);
    }

    /** GET /api/woodart/materials/valuation — totals + value by category. */
    public function valuation(): JsonResponse
    {
        if (! Schema::hasTable(self::TABLE)) {
            return response()->json(['success' => true, 'summary' => null, 'data' => []]);
        }

        return response()->json([
            'success' => true,
            'summary' => $this->service->summary(),
            'data'    => $this->service->valuation(),
        ]);
    }

    /** POST /api/woodart/materials/stock — create or update, keyed on `id`. */
    public function store(StoreMaterialRequest $request): JsonResponse
    {
        if (! Schema::hasTable(self::TABLE)) {
            return response()->json([
                'success' => false,
                'message' => 'wa_materials table not migrated yet. Run: php artisan migrate',
            ], 503);
        }
        $saved = $this->service->upsert($request->validated());

        return response()->json([
            'success' => true,
            'data'    => new MaterialResource($saved),
        ]);
    }

    /** DELETE /api/woodart/materials/stock/{id} — soft delete, idempotent. */
    public function destroy(string $id): JsonResponse
    {
        if (Schema::hasTable(self::TABLE)) {
            $this->service->delete($id);
        }

        return response()->json(['success' => true]);
    }
}
