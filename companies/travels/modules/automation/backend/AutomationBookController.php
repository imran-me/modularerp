<?php

namespace Epal\Modules\Travels\Automation;

use Epal\Modules\Travels\Automation\Services\AutomationBookService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Schema;

/**
 * Automation books API — serves the two module-owned stores (rules / markup)
 * behind one controller keyed by {store}. Schema::hasTable-guarded.
 */
class AutomationBookController
{
    private const TABLES = ['rules' => 'tv_automation', 'markup' => 'tv_markup'];

    public function __construct(private AutomationBookService $service) {}

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
            return response()->json(['success' => false, 'message' => 'Automation tables not migrated yet. Run: php artisan migrate'], 503);
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
