<?php

namespace Epal\Modules\Travels\Crm;

use Epal\Modules\Travels\Crm\Services\CrmBookService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Schema;

/**
 * CRM API — serves the frontend `leads` and `crm_activities` stores behind one
 * controller keyed by {store}. Schema::hasTable-guarded.
 */
class CrmController
{
    private const TABLES = ['leads' => 'leads', 'activities' => 'crm_activities'];

    public function __construct(private CrmBookService $service) {}

    private function ready(string $store): bool
    {
        return isset(self::TABLES[$store]) && Schema::hasTable(self::TABLES[$store]);
    }

    public function index(Request $request, string $store): JsonResponse
    {
        if (! $this->ready($store)) {
            return response()->json(['success' => true, 'count' => 0, 'data' => []]);
        }
        $rows = $this->service->list($store, $request->query('companyId'));

        return response()->json(['success' => true, 'count' => count($rows), 'data' => $rows]);
    }

    public function store(Request $request, string $store): JsonResponse
    {
        if (! $this->ready($store)) {
            return response()->json(['success' => false, 'message' => 'CRM tables not migrated yet. Run: php artisan migrate'], 503);
        }
        $record = $request->all();
        $saved = $this->service->upsert($store, is_array($record['data'] ?? null) ? $record['data'] : $record);

        return response()->json(['success' => true, 'data' => $saved]);
    }

    public function destroy(string $store, string $id): JsonResponse
    {
        if ($this->ready($store)) {
            $this->service->delete($store, $id);
        }

        return response()->json(['success' => true]);
    }
}
