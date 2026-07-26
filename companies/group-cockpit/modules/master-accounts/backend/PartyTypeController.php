<?php

namespace Epal\Modules\GroupCockpit\MasterAccounts;

use Epal\Modules\GroupCockpit\MasterAccounts\Http\Requests\StorePartyTypeRequest;
use Epal\Modules\GroupCockpit\MasterAccounts\Http\Resources\PartyTypeResource;
use Epal\Modules\GroupCockpit\MasterAccounts\Services\PartyTypeService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Schema;

/**
 * Party Types API — serves the frontend `party_types` lookup store. Thin
 * controller over PartyTypeService + PartyTypeResource; a group-level lookup
 * (client filters by company), Schema::hasTable-guarded so it no-ops before migrate.
 */
class PartyTypeController
{
    public function __construct(private PartyTypeService $service) {}

    public function index(): JsonResponse
    {
        if (! Schema::hasTable('party_types')) {
            return response()->json(['success' => true, 'count' => 0, 'data' => []]);
        }
        $rows = $this->service->list();

        return response()->json([
            'success' => true,
            'count'   => $rows->count(),
            'data'    => PartyTypeResource::collection($rows),
        ]);
    }

    public function store(StorePartyTypeRequest $request): JsonResponse
    {
        if (! Schema::hasTable('party_types')) {
            return response()->json(['success' => false, 'message' => 'party_types table not migrated yet. Run: php artisan migrate'], 503);
        }
        $saved = $this->service->upsert($request->validated());

        return response()->json(['success' => true, 'data' => new PartyTypeResource($saved)]);
    }

    public function destroy(string $id): JsonResponse
    {
        if (Schema::hasTable('party_types')) {
            $this->service->delete($id);
        }

        return response()->json(['success' => true]);
    }
}
