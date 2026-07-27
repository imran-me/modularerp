<?php

namespace Epal\Modules\Woodart\Design;

use Epal\Modules\Woodart\Design\Http\Resources\RevisionResource;
use Epal\Modules\Woodart\Design\Models\Revision;
use Epal\Modules\Woodart\Design\Services\DesignService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Schema;

/**
 * Revision trail API — serves the frontend `wa_revisions` store.
 *
 * READ-ONLY on purpose. A revision is EVIDENCE: it is written by DesignService
 * as the side effect of a drawing moving state, never posted directly. Exposing
 * a write endpoint would let a client fabricate an approval that never happened,
 * which is precisely what an audit trail exists to prevent.
 *
 * @see backend/endpoints.md
 */
class RevisionController
{
    private const TABLE = 'wa_revisions';

    public function __construct(private DesignService $service) {}

    /** GET /api/woodart/design/revisions — the whole trail (api.js HYDRATE). */
    public function index(): JsonResponse
    {
        if (! Schema::hasTable(self::TABLE)) {
            return response()->json(['success' => true, 'provisioned' => false, 'count' => 0, 'data' => []]);
        }

        $rows = Revision::query()
            ->where('company_id', 'woodart')
            ->orderBy('drawing')->orderBy('rev')->orderBy('ext_id')
            ->get();

        return response()->json([
            'success'     => true,
            'provisioned' => true,
            'count'       => $rows->count(),
            'data'        => RevisionResource::collection($rows),
        ]);
    }

    /** GET /api/woodart/design/drawings/{id}/revisions — one deliverable trail. */
    public function forDrawing(string $id): JsonResponse
    {
        if (! Schema::hasTable(self::TABLE)) {
            return response()->json(['success' => true, 'count' => 0, 'data' => []]);
        }
        $rows = $this->service->trail($id);

        return response()->json([
            'success' => true,
            'count'   => $rows->count(),
            'data'    => RevisionResource::collection($rows),
        ]);
    }
}
