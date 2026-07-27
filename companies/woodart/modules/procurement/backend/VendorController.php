<?php

namespace Epal\Modules\Woodart\Procurement;

use Epal\Modules\Woodart\Procurement\Http\Requests\StoreVendorRequest;
use Epal\Modules\Woodart\Procurement\Http\Resources\VendorResource;
use Epal\Modules\Woodart\Procurement\Services\ProcurementService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Schema;

/**
 * Vendors API — serves the frontend `wa_vendors` store.
 *
 * ONE CONTROLLER PER ENTITY (owner decision D8). Thin over ProcurementService,
 * which owns the order→vendor name join shared with PurchaseOrderController.
 *
 * @see backend/endpoints.md   the frozen contract this implements
 */
class VendorController
{
    private const TABLE = 'wa_vendors';

    public function __construct(private ProcurementService $service) {}

    /** GET /api/woodart/procurement/vendors — the directory, A→Z. */
    public function index(): JsonResponse
    {
        if (! Schema::hasTable(self::TABLE)) {
            return response()->json(['success' => true, 'provisioned' => false, 'count' => 0, 'data' => []]);
        }
        $rows = $this->service->vendors();

        return response()->json([
            'success'     => true,
            'provisioned' => true,
            'count'       => $rows->count(),
            'data'    => VendorResource::collection($rows),
        ]);
    }

    /** POST /api/woodart/procurement/vendors — create or update, keyed on `id`. */
    public function store(StoreVendorRequest $request): JsonResponse
    {
        if (! Schema::hasTable(self::TABLE)) {
            return response()->json([
                'success' => false,
                'message' => 'wa_vendors table not migrated yet. Run: php artisan migrate',
            ], 503);
        }
        $saved = $this->service->upsertVendor($request->validated());

        return response()->json([
            'success' => true,
            'data'    => new VendorResource($saved),
        ]);
    }

    /** DELETE /api/woodart/procurement/vendors/{id} — soft delete, idempotent.
     *  Their purchase orders are NOT deleted; they simply show as "unlisted". */
    public function destroy(string $id): JsonResponse
    {
        if (Schema::hasTable(self::TABLE)) {
            $this->service->deleteVendor($id);
        }

        return response()->json(['success' => true]);
    }
}
