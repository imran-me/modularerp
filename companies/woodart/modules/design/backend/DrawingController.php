<?php

namespace Epal\Modules\Woodart\Design;

use Epal\Modules\Woodart\Design\Http\Requests\StoreDrawingRequest;
use Epal\Modules\Woodart\Design\Http\Resources\DrawingResource;
use Epal\Modules\Woodart\Design\Services\DesignService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Schema;

/**
 * Design deliverables API — serves the frontend `wa_drawings` store.
 *
 * THIN: validate -> delegate -> shape. Every action is Schema::hasTable-guarded,
 * and index() reports `provisioned`, because platform/data/api.js uses that flag
 * to decide both "may I write?" and "may I overwrite the local store?" — the fix
 * for the vanishing-data bug of 2026-07-27.
 *
 * @see backend/endpoints.md
 */
class DrawingController
{
    private const TABLE = 'wa_drawings';

    public function __construct(private DesignService $service) {}

    /** GET /api/woodart/design/drawings */
    public function index(): JsonResponse
    {
        if (! Schema::hasTable(self::TABLE)) {
            return response()->json(['success' => true, 'provisioned' => false, 'count' => 0, 'data' => []]);
        }
        $rows = $this->service->register();

        return response()->json([
            'success'     => true,
            'provisioned' => true,
            'count'       => $rows->count(),
            'data'        => DrawingResource::collection($rows),
        ]);
    }

    /** GET /api/woodart/design/approvals — the queue, longest wait first. */
    public function approvals(): JsonResponse
    {
        if (! Schema::hasTable(self::TABLE)) {
            return response()->json(['success' => true, 'summary' => null, 'data' => []]);
        }

        return response()->json([
            'success' => true,
            'today'   => $this->service->today(),
            'summary' => $this->service->summary(),
            'data'    => $this->service->queue(),
        ]);
    }

    /** GET /api/woodart/design/load — summary, designer load, mix, phase gate. */
    public function load(): JsonResponse
    {
        if (! Schema::hasTable(self::TABLE)) {
            return response()->json(['success' => true, 'summary' => null, 'data' => []]);
        }

        return response()->json([
            'success'  => true,
            'summary'  => $this->service->summary(),
            'data'     => $this->service->byDesigner(),
            'byKind'   => $this->service->byKind(),
            'projects' => $this->service->projectStatus(),
        ]);
    }

    /** POST /api/woodart/design/drawings — create or update, keyed on `id`.
     *  A status or revision change writes a trail row automatically. */
    public function store(StoreDrawingRequest $request): JsonResponse
    {
        if (! Schema::hasTable(self::TABLE)) {
            return response()->json([
                'success' => false,
                'message' => 'wa_drawings table not migrated yet. Run: php artisan migrate',
            ], 503);
        }
        $saved = $this->service->upsert($request->validated(), (string) $request->input('note', ''));

        return response()->json(['success' => true, 'data' => new DrawingResource($saved)]);
    }

    /** DELETE /api/woodart/design/drawings/{id} — takes its trail with it. */
    public function destroy(string $id): JsonResponse
    {
        if (Schema::hasTable(self::TABLE)) {
            $this->service->delete($id);
        }

        return response()->json(['success' => true]);
    }
}
