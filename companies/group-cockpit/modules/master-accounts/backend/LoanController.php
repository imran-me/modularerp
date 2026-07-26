<?php

namespace Epal\Modules\GroupCockpit\MasterAccounts;

use Epal\Modules\GroupCockpit\MasterAccounts\Services\LoanBookService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Schema;

/**
 * Loan Books API — serves the four frontend loan stores (loan_products, loans_ext,
 * loans_taken, loan_txns) behind one controller keyed by the {store} segment. Thin
 * wrapper over LoanBookService; Schema::hasTable-guarded so it no-ops before migrate.
 * The loan book is intentionally separate from the GL (no ledger side-effects here).
 */
class LoanController
{
    /** {store} segment -> physical table (for the hasTable guard). */
    private const TABLES = [
        'products' => 'loan_products',
        'ext'      => 'loans_ext',
        'taken'    => 'loans_taken',
        'txns'     => 'loan_txns',
    ];

    public function __construct(private LoanBookService $service) {}

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
            return response()->json(['success' => false, 'message' => 'Loan tables not migrated yet. Run: php artisan migrate'], 503);
        }
        $record = $request->all();
        if (! isset($record['id']) && ! is_array($record['data'] ?? null)) {
            // accept either a flat record or {data:{…}}
        }
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
