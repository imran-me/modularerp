<?php

namespace Epal\Modules\Travels\Marketing;

use Epal\Modules\Travels\Marketing\Services\MarketingBookService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Schema;

/**
 * Marketing books API — serves the five module-owned stores (campaigns / templates /
 * messages / bookings / chat) behind one controller keyed by {store}.
 * Schema::hasTable-guarded so it no-ops before migrate.
 */
class MarketingBookController
{
    private const TABLES = [
        'campaigns' => 'tv_campaigns',
        'templates' => 'tv_templates',
        'messages'  => 'tv_messages',
        'bookings'  => 'tv_bot_bookings',
        'chat'      => 'tv_bot_chat',
    ];

    public function __construct(private MarketingBookService $service) {}

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
            return response()->json(['success' => false, 'message' => 'Marketing tables not migrated yet. Run: php artisan migrate'], 503);
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
