<?php

namespace Epal\Modules\Woodart\Clients;

use Epal\Modules\Woodart\Clients\Http\Requests\StoreClientRequest;
use Epal\Modules\Woodart\Clients\Http\Resources\ClientResource;
use Epal\Modules\Woodart\Clients\Services\ClientService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Schema;

/**
 * Clients API — serves the frontend `wa_clients` store.
 *
 * THIN BY DESIGN: validate (StoreClientRequest) → delegate (ClientService) →
 * shape (ClientResource). No business logic in this file.
 *
 * Every action is Schema::hasTable-guarded. That is not defensive noise — the
 * live host pulls code before anyone runs `php artisan migrate`, and without the
 * guard the SPA would show "Save failed" on a feature that works. A GET degrades
 * to an honest empty list; a POST says plainly what has to be run.
 *
 * @see backend/endpoints.md   the frozen contract this implements
 */
class ClientController
{
    private const TABLE = 'wa_clients';

    public function __construct(private ClientService $service) {}

    /** GET /api/woodart/clients/directory — the whole directory. */
    public function index(): JsonResponse
    {
        if (! Schema::hasTable(self::TABLE)) {
            return response()->json(['success' => true, 'provisioned' => false, 'count' => 0, 'data' => []]);
        }
        $rows = $this->service->directory();

        return response()->json([
            'success'     => true,
            'provisioned' => true,
            'count'       => $rows->count(),
            'data'    => ClientResource::collection($rows),
        ]);
    }

    /** GET /api/woodart/clients/portfolio — each client with their work. */
    public function portfolio(): JsonResponse
    {
        if (! Schema::hasTable(self::TABLE)) {
            return response()->json(['success' => true, 'summary' => null, 'data' => []]);
        }

        return response()->json([
            'success' => true,
            'summary' => $this->service->summary(),
            'data'    => $this->service->portfolio(),
        ]);
    }

    /** GET /api/woodart/clients/segments — value by segment. */
    public function segments(): JsonResponse
    {
        if (! Schema::hasTable(self::TABLE)) {
            return response()->json(['success' => true, 'summary' => null, 'data' => []]);
        }

        return response()->json([
            'success' => true,
            'summary' => $this->service->summary(),
            'data'    => $this->service->segments(),
        ]);
    }

    /** POST /api/woodart/clients/directory — create or update, keyed on `id`. */
    public function store(StoreClientRequest $request): JsonResponse
    {
        if (! Schema::hasTable(self::TABLE)) {
            return response()->json([
                'success' => false,
                'message' => 'wa_clients table not migrated yet. Run: php artisan migrate',
            ], 503);
        }
        $saved = $this->service->upsert($request->validated());

        return response()->json([
            'success' => true,
            'data'    => new ClientResource($saved),
        ]);
    }

    /** DELETE /api/woodart/clients/directory/{id} — soft delete, idempotent. */
    public function destroy(string $id): JsonResponse
    {
        if (Schema::hasTable(self::TABLE)) {
            $this->service->delete($id);
        }

        return response()->json(['success' => true]);
    }
}
