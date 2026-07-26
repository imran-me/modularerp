<?php

namespace Epal\Modules\Travels\ContractFlight;

use Epal\Modules\Travels\ContractFlight\Services\ContractFlightService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Schema;

/** Contract Flight API — serves the frontend `tv_contract_flights` store. */
class ContractFlightController
{
    public function __construct(private ContractFlightService $service) {}

    public function index(Request $request): JsonResponse
    {
        if (! Schema::hasTable('tv_contract_flights')) {
            return response()->json(['success' => true, 'count' => 0, 'data' => []]);
        }
        $rows = $this->service->list($request->query('companyId'));

        return response()->json(['success' => true, 'count' => $rows->count(), 'data' => $rows->values()]);
    }

    public function store(Request $request): JsonResponse
    {
        if (! Schema::hasTable('tv_contract_flights')) {
            return response()->json(['success' => false, 'message' => 'tv_contract_flights not migrated yet. Run: php artisan migrate'], 503);
        }
        $record = $request->all();
        $saved = $this->service->upsert(is_array($record['data'] ?? null) ? $record['data'] : $record);

        return response()->json(['success' => true, 'data' => $saved]);
    }

    public function destroy(string $id): JsonResponse
    {
        if (Schema::hasTable('tv_contract_flights')) {
            $this->service->delete($id);
        }

        return response()->json(['success' => true]);
    }
}
