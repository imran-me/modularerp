<?php

namespace Epal\Modules\Travels\VendorAgent;

use Epal\Modules\Travels\VendorAgent\Services\VendorAgentBookService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Schema;

/**
 * Vendor & Agent API — serves the five module-owned stores (agents / vendors /
 * party-txns / commissions / portals) behind one controller keyed by {store}.
 * Schema::hasTable-guarded.
 */
class VendorAgentController
{
    private const TABLES = [
        'agents'      => 'tv_agents',
        'vendors'     => 'vendors',
        'party-txns'  => 'party_txns',
        'commissions' => 'tv_comm_paid',
        'portals'     => 'tv_portals',
    ];

    public function __construct(private VendorAgentBookService $service) {}

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
            return response()->json(['success' => false, 'message' => 'Vendor/Agent tables not migrated yet. Run: php artisan migrate'], 503);
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
