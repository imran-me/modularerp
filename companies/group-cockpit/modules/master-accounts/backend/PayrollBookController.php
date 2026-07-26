<?php

namespace Epal\Modules\GroupCockpit\MasterAccounts;

use Epal\Modules\GroupCockpit\MasterAccounts\Services\PayrollBookService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Schema;

/**
 * Payroll Books API — serves the four frontend payroll stores (pay_templates,
 * pay_runs, pay_slips, pay_txns) behind one controller keyed by the {store}
 * segment. Thin wrapper over PayrollBookService; Schema::hasTable-guarded so it
 * no-ops before migrate. Persists payroll STATE only — salary accrual to the GL
 * stays in the engine (posts journals that persist via JournalController).
 */
class PayrollBookController
{
    private const TABLES = [
        'templates' => 'pay_templates',
        'runs'      => 'pay_runs',
        'slips'     => 'pay_slips',
        'txns'      => 'pay_txns',
    ];

    public function __construct(private PayrollBookService $service) {}

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
            return response()->json(['success' => false, 'message' => 'Payroll tables not migrated yet. Run: php artisan migrate'], 503);
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
