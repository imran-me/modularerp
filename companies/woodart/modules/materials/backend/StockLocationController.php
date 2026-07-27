<?php

namespace Epal\Modules\Woodart\Materials;

use Epal\Modules\Woodart\Materials\Http\Resources\StockLocationResource;
use Epal\Modules\Woodart\Materials\Models\StockLocation;
use Epal\Modules\Woodart\Materials\Services\MaterialService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Schema;

/**
 * Stock locations API — serves the frontend `wa_locations` store, and the
 * warehouse roll-up: what each place is holding and what it is worth.
 *
 * @see backend/endpoints.md
 */
class StockLocationController
{
    private const TABLE = 'wa_locations';

    public function __construct(private MaterialService $service) {}

    /** GET /api/woodart/materials/locations */
    public function index(): JsonResponse
    {
        if (! Schema::hasTable(self::TABLE)) {
            return response()->json(['success' => true, 'provisioned' => false, 'count' => 0, 'data' => []]);
        }
        $rows = $this->service->locations();

        return response()->json([
            'success'     => true,
            'provisioned' => true,
            'count'       => $rows->count(),
            'data'        => StockLocationResource::collection($rows),
        ]);
    }

    /** GET /api/woodart/materials/locations/holdings — the warehouse view.
     *  Needs BOTH tables: a location roll-up without movements is meaningless. */
    public function holdings(): JsonResponse
    {
        if (! Schema::hasTable(self::TABLE) || ! Schema::hasTable('wa_movements')) {
            return response()->json(['success' => true, 'data' => []]);
        }

        return response()->json([
            'success' => true,
            'data'    => $this->service->locationTotals(),
        ]);
    }
}
