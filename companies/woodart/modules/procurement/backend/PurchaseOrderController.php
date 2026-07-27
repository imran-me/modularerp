<?php

namespace Epal\Modules\Woodart\Procurement;

use Epal\Modules\Woodart\Procurement\Http\Requests\StorePurchaseOrderRequest;
use Epal\Modules\Woodart\Procurement\Http\Resources\PurchaseOrderResource;
use Epal\Modules\Woodart\Procurement\Services\ProcurementService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Schema;

/**
 * Purchase Orders API — serves the frontend `wa_purchases` store.
 *
 * ONE CONTROLLER PER ENTITY (owner decision D8): orders here, vendors in
 * VendorController. Both are thin wrappers over the single ProcurementService,
 * because the interesting rules span both entities and must not be duplicated.
 *
 * Every action is Schema::hasTable-guarded — the live host pulls code before
 * anyone runs `php artisan migrate`.
 *
 * @see backend/endpoints.md   the frozen contract this implements
 */
class PurchaseOrderController
{
    private const TABLE = 'wa_purchases';

    public function __construct(private ProcurementService $service) {}

    /** GET /api/woodart/procurement/orders — the whole register, newest first. */
    public function index(): JsonResponse
    {
        if (! Schema::hasTable(self::TABLE)) {
            return response()->json(['success' => true, 'provisioned' => false, 'count' => 0, 'data' => []]);
        }
        $rows = $this->service->orders();

        return response()->json([
            'success'     => true,
            'provisioned' => true,
            'count'       => $rows->count(),
            'data'    => PurchaseOrderResource::collection($rows),
        ]);
    }

    /** GET /api/woodart/procurement/spend — totals, by category and by vendor. */
    public function spend(): JsonResponse
    {
        if (! Schema::hasTable(self::TABLE)) {
            return response()->json(['success' => true, 'summary' => null, 'byCategory' => [], 'byVendor' => []]);
        }

        return response()->json([
            'success'    => true,
            'summary'    => $this->service->summary(),
            'byCategory' => $this->service->spendByCategory(),
            'byVendor'   => $this->service->spendByVendor(),
        ]);
    }

    /** POST /api/woodart/procurement/orders — create or update, keyed on `id`. */
    public function store(StorePurchaseOrderRequest $request): JsonResponse
    {
        if (! Schema::hasTable(self::TABLE)) {
            return response()->json([
                'success' => false,
                'message' => 'wa_purchases table not migrated yet. Run: php artisan migrate',
            ], 503);
        }
        $saved = $this->service->upsertOrder($request->validated());

        return response()->json([
            'success' => true,
            'data'    => new PurchaseOrderResource($saved),
        ]);
    }

    /** DELETE /api/woodart/procurement/orders/{id} — soft delete, idempotent. */
    public function destroy(string $id): JsonResponse
    {
        if (Schema::hasTable(self::TABLE)) {
            $this->service->deleteOrder($id);
        }

        return response()->json(['success' => true]);
    }
}
