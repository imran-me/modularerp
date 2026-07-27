<?php

namespace Epal\Modules\Woodart\Production;

use Epal\Modules\Woodart\Production\Http\Requests\StoreJobRequest;
use Epal\Modules\Woodart\Production\Http\Resources\JobResource;
use Epal\Modules\Woodart\Production\Services\ProductionService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Schema;

/**
 * Workshop Jobs API — serves the frontend `wa_production` store.
 *
 * THIN BY DESIGN: validate -> delegate -> shape. Every action is
 * Schema::hasTable-guarded, because the live host pulls code before anyone runs
 * migrations.
 *
 * @see backend/endpoints.md   the frozen contract this implements
 */
class JobController
{
    private const TABLE = 'wa_production';

    public function __construct(private ProductionService $service) {}

    /** GET /api/woodart/production/jobs — soonest due first. */
    public function index(): JsonResponse
    {
        if (! Schema::hasTable(self::TABLE)) {
            return response()->json(['success' => true, 'provisioned' => false, 'count' => 0, 'data' => []]);
        }
        $rows = $this->service->jobs();

        return response()->json([
            'success'     => true,
            'provisioned' => true,
            'count'       => $rows->count(),
            'data'    => JobResource::collection($rows),
        ]);
    }

    /** GET /api/woodart/production/load — summary + station load. */
    public function load(): JsonResponse
    {
        if (! Schema::hasTable(self::TABLE)) {
            return response()->json(['success' => true, 'summary' => null, 'data' => []]);
        }

        return response()->json([
            'success' => true,
            'today'   => $this->service->today(),
            'summary' => $this->service->summary(),
            'data'    => $this->service->byStation(),
        ]);
    }

    /** POST /api/woodart/production/jobs — create or update, keyed on `id`. */
    public function store(StoreJobRequest $request): JsonResponse
    {
        if (! Schema::hasTable(self::TABLE)) {
            return response()->json([
                'success' => false,
                'message' => 'wa_production table not migrated yet. Run: php artisan migrate',
            ], 503);
        }
        $saved = $this->service->upsert($request->validated());

        return response()->json([
            'success' => true,
            'data'    => new JobResource($saved),
        ]);
    }

    /** DELETE /api/woodart/production/jobs/{id} — soft delete, idempotent. */
    public function destroy(string $id): JsonResponse
    {
        if (Schema::hasTable(self::TABLE)) {
            $this->service->delete($id);
        }

        return response()->json(['success' => true]);
    }
}
