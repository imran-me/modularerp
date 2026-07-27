<?php

namespace Epal\Modules\Woodart\Installation;

use Epal\Modules\Woodart\Installation\Http\Requests\StoreInstallRequest;
use Epal\Modules\Woodart\Installation\Http\Resources\InstallResource;
use Epal\Modules\Woodart\Installation\Services\InstallationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Schema;

/**
 * Site & Install API — serves the frontend `wa_installs` store.
 *
 * THIN BY DESIGN: validate -> delegate -> shape. Every action is
 * Schema::hasTable-guarded, because the live host pulls code before anyone runs
 * migrations.
 *
 * @see backend/endpoints.md   the frozen contract this implements
 */
class InstallController
{
    private const TABLE = 'wa_installs';

    public function __construct(private InstallationService $service) {}

    /** GET /api/woodart/installation/installs — soonest visit first. */
    public function index(): JsonResponse
    {
        if (! Schema::hasTable(self::TABLE)) {
            return response()->json(['success' => true, 'provisioned' => false, 'count' => 0, 'data' => []]);
        }
        $rows = $this->service->schedule();

        return response()->json([
            'success'     => true,
            'provisioned' => true,
            'count'       => $rows->count(),
            'data'    => InstallResource::collection($rows),
        ]);
    }

    /** GET /api/woodart/installation/snags — the handover queue, worst first. */
    public function snags(): JsonResponse
    {
        if (! Schema::hasTable(self::TABLE)) {
            return response()->json(['success' => true, 'summary' => null, 'data' => []]);
        }

        return response()->json([
            'success' => true,
            'summary' => $this->service->summary(),
            'data'    => $this->service->snagging(),
        ]);
    }

    /** GET /api/woodart/installation/teams — summary + team load. */
    public function teams(): JsonResponse
    {
        if (! Schema::hasTable(self::TABLE)) {
            return response()->json(['success' => true, 'summary' => null, 'data' => []]);
        }

        return response()->json([
            'success' => true,
            'today'   => $this->service->today(),
            'summary' => $this->service->summary(),
            'data'    => $this->service->byTeam(),
        ]);
    }

    /** POST /api/woodart/installation/installs — create or update, keyed on `id`. */
    public function store(StoreInstallRequest $request): JsonResponse
    {
        if (! Schema::hasTable(self::TABLE)) {
            return response()->json([
                'success' => false,
                'message' => 'wa_installs table not migrated yet. Run: php artisan migrate',
            ], 503);
        }
        $saved = $this->service->upsert($request->validated());

        return response()->json([
            'success' => true,
            'data'    => new InstallResource($saved),
        ]);
    }

    /** DELETE /api/woodart/installation/installs/{id} — soft delete, idempotent. */
    public function destroy(string $id): JsonResponse
    {
        if (Schema::hasTable(self::TABLE)) {
            $this->service->delete($id);
        }

        return response()->json(['success' => true]);
    }
}
