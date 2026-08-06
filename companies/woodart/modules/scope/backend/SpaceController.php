<?php

namespace Epal\Modules\Woodart\Scope;

use Epal\Modules\Woodart\Scope\Http\Requests\StoreSpaceRequest;
use Epal\Modules\Woodart\Scope\Http\Resources\PhaseResource;
use Epal\Modules\Woodart\Scope\Http\Resources\SpaceResource;
use Epal\Modules\Woodart\Scope\Services\ScopeService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Schema;

/**
 * Spaces API — serves the frontend `wa_spaces` store.
 *
 * THIN BY DESIGN: validate → delegate to ScopeService → shape with a Resource.
 *
 * Every action is Schema::hasTable-guarded, like every other module here: the
 * live host pulls code before anyone runs `php artisan migrate`, and without
 * the guard a working feature would show "Save failed". A GET degrades to an
 * honest empty list; a POST says plainly what has to be run.
 *
 * @see backend/endpoints.md — the frozen contract this implements
 */
class SpaceController
{
    private const TABLE = 'wa_spaces';

    public function __construct(private ScopeService $service) {}

    /** GET /api/woodart/scope/spaces?project=WAP-101 */
    public function index(Request $request): JsonResponse
    {
        if (! Schema::hasTable(self::TABLE)) {
            return response()->json(['success' => true, 'provisioned' => false, 'count' => 0, 'data' => []]);
        }
        $rows = $this->service->spaces($request->query('project'));

        return response()->json([
            'success'     => true,
            'provisioned' => true,
            'count'       => $rows->count(),
            'data'        => SpaceResource::collection($rows),
        ]);
    }

    /** POST /api/woodart/scope/spaces — create or update, keyed on `id`. */
    public function store(StoreSpaceRequest $request): JsonResponse
    {
        if (! Schema::hasTable(self::TABLE)) {
            return response()->json([
                'success' => false,
                'message' => 'wa_spaces table not migrated yet. Run: php artisan migrate',
            ], 503);
        }

        return response()->json([
            'success' => true,
            'data'    => new SpaceResource($this->service->upsertSpace($request->validated())),
        ]);
    }

    /** DELETE /api/woodart/scope/spaces/{id} — cascades to phases and lines. */
    public function destroy(string $id): JsonResponse
    {
        if (Schema::hasTable(self::TABLE)) {
            $this->service->deleteSpace($id);
        }

        return response()->json(['success' => true]);
    }

    /**
     * POST /api/woodart/scope/spaces/{id}/apply-template — adds only the phases
     * this space is missing. An empty array is a successful answer.
     */
    public function applyTemplate(string $id): JsonResponse
    {
        if (! Schema::hasTable('wa_phases')) {
            return response()->json([
                'success' => false,
                'message' => 'wa_phases table not migrated yet. Run: php artisan migrate',
            ], 503);
        }
        $written = $this->service->applyTemplate($id);

        return response()->json([
            'success' => true,
            'count'   => count($written),
            'data'    => PhaseResource::collection(collect($written)),
        ]);
    }
}
