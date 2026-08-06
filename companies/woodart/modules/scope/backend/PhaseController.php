<?php

namespace Epal\Modules\Woodart\Scope;

use Epal\Modules\Woodart\Scope\Http\Requests\StorePhaseRequest;
use Epal\Modules\Woodart\Scope\Http\Resources\PhaseResource;
use Epal\Modules\Woodart\Scope\Services\ScopeService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Schema;

/** Phases API — serves the frontend `wa_phases` store. Thin; rules live in ScopeService. */
class PhaseController
{
    private const TABLE = 'wa_phases';

    public function __construct(private ScopeService $service) {}

    /** GET /api/woodart/scope/phases?project=WAP-101[&space=SPC-001] */
    public function index(Request $request): JsonResponse
    {
        if (! Schema::hasTable(self::TABLE)) {
            return response()->json(['success' => true, 'provisioned' => false, 'count' => 0, 'data' => []]);
        }
        $rows = $this->service->phases($request->query('project'), $request->query('space'));

        return response()->json([
            'success'     => true,
            'provisioned' => true,
            'count'       => $rows->count(),
            'data'        => PhaseResource::collection($rows),
        ]);
    }

    /** POST /api/woodart/scope/phases — `project` is derived from `space`. */
    public function store(StorePhaseRequest $request): JsonResponse
    {
        if (! Schema::hasTable(self::TABLE)) {
            return response()->json([
                'success' => false,
                'message' => 'wa_phases table not migrated yet. Run: php artisan migrate',
            ], 503);
        }
        try {
            $saved = $this->service->upsertPhase($request->validated());
        } catch (\InvalidArgumentException $e) {
            return response()->json(['success' => false, 'message' => $e->getMessage()], 422);
        }

        return response()->json(['success' => true, 'data' => new PhaseResource($saved)]);
    }

    /** DELETE /api/woodart/scope/phases/{id} — cascades to its requirements. */
    public function destroy(string $id): JsonResponse
    {
        if (Schema::hasTable(self::TABLE)) {
            $this->service->deletePhase($id);
        }

        return response()->json(['success' => true]);
    }

    /** GET /api/woodart/scope/load — who is carrying what, plus the unassigned queue. */
    public function load(): JsonResponse
    {
        if (! Schema::hasTable(self::TABLE)) {
            return response()->json(['success' => true, 'data' => ['people' => [], 'unassigned' => 0]]);
        }

        return response()->json(['success' => true, 'data' => $this->service->load()]);
    }
}
