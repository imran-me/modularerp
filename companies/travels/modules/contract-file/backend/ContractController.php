<?php

namespace Epal\Modules\Travels\ContractFile;

use Epal\Modules\Travels\ContractFile\Services\ContractService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Schema;

/**
 * Contract File API — serves the frontend `tv_contracts` store. Schema::hasTable-guarded.
 */
class ContractController
{
    public function __construct(private ContractService $service) {}

    public function index(Request $request): JsonResponse
    {
        if (! Schema::hasTable('tv_contracts')) {
            return response()->json(['success' => true, 'count' => 0, 'data' => []]);
        }
        $rows = $this->service->list($request->query('companyId'));

        return response()->json(['success' => true, 'count' => $rows->count(), 'data' => $rows->values()]);
    }

    public function store(Request $request): JsonResponse
    {
        if (! Schema::hasTable('tv_contracts')) {
            return response()->json(['success' => false, 'message' => 'tv_contracts not migrated yet. Run: php artisan migrate'], 503);
        }
        $record = $request->all();
        $saved = $this->service->upsert(is_array($record['data'] ?? null) ? $record['data'] : $record);

        return response()->json(['success' => true, 'data' => $saved]);
    }

    public function destroy(string $id): JsonResponse
    {
        if (Schema::hasTable('tv_contracts')) {
            $this->service->delete($id);
        }

        return response()->json(['success' => true]);
    }
}
