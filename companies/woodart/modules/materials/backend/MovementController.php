<?php

namespace Epal\Modules\Woodart\Materials;

use Epal\Modules\Woodart\Materials\Http\Requests\StoreMovementRequest;
use Epal\Modules\Woodart\Materials\Http\Resources\MovementResource;
use Epal\Modules\Woodart\Materials\Services\MaterialService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Schema;

/**
 * Stock movements API — serves the frontend `wa_movements` store.
 *
 * There is NO update and NO delete, deliberately. A movement is a fact that
 * happened; correcting one is a new Adjustment movement, not a rewrite of
 * history. That is the same discipline the ledger uses for a reversal, and it
 * is what makes reconcile() meaningful: if rows could be edited away, the
 * invariant would only ever prove that somebody tidied up.
 *
 * @see backend/endpoints.md
 */
class MovementController
{
    private const TABLE = 'wa_movements';

    public function __construct(private MaterialService $service) {}

    /** GET /api/woodart/materials/movements — the ledger, newest first. */
    public function index(): JsonResponse
    {
        if (! Schema::hasTable(self::TABLE)) {
            return response()->json(['success' => true, 'provisioned' => false, 'count' => 0, 'data' => []]);
        }
        $rows = $this->service->movements();

        return response()->json([
            'success'     => true,
            'provisioned' => true,
            'count'       => $rows->count(),
            'data'        => MovementResource::collection($rows),
        ]);
    }

    /** GET /api/woodart/materials/{id}/movements — one material's history. */
    public function forMaterial(string $id): JsonResponse
    {
        if (! Schema::hasTable(self::TABLE)) {
            return response()->json(['success' => true, 'count' => 0, 'data' => []]);
        }
        $rows = $this->service->historyOf($id);

        return response()->json([
            'success'    => true,
            'count'      => $rows->count(),
            'byLocation' => $this->service->byLocation($id),
            'data'       => MovementResource::collection($rows),
        ]);
    }

    /**
     * POST /api/woodart/materials/movements — apply a movement.
     *
     * The service writes the row and updates the material's stock in ONE
     * transaction, and derives the sign from the kind. A caller cannot move
     * stock any other way.
     */
    public function store(StoreMovementRequest $request): JsonResponse
    {
        if (! Schema::hasTable(self::TABLE)) {
            return response()->json([
                'success' => false,
                'message' => 'wa_movements table not migrated yet. Run: php artisan migrate',
            ], 503);
        }

        $saved = $this->service->applyMovement($request->validated());

        if (! $saved) {
            return response()->json([
                'success' => false,
                'message' => 'Unknown material, or a movement of zero.',
            ], 422);
        }

        return response()->json(['success' => true, 'data' => new MovementResource($saved)]);
    }

    /** GET /api/woodart/materials/reconcile — the invariant, as an endpoint.
     *  An empty `data` is the healthy state. */
    public function reconcile(): JsonResponse
    {
        $drift = $this->service->reconcile();

        return response()->json([
            'success'  => true,
            'balanced' => $drift->isEmpty(),
            'count'    => $drift->count(),
            'summary'  => Schema::hasTable(self::TABLE) ? $this->service->movementSummary() : null,
            'data'     => $drift,
        ]);
    }
}
