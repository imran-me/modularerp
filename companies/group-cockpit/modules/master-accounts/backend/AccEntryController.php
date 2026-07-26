<?php

namespace Epal\Modules\GroupCockpit\MasterAccounts;

use Epal\Modules\GroupCockpit\MasterAccounts\Http\Requests\StoreAccEntryRequest;
use Epal\Modules\GroupCockpit\MasterAccounts\Http\Resources\AccEntryResource;
use Epal\Modules\GroupCockpit\MasterAccounts\Services\AccEntryService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Schema;

/**
 * Account Entries API — serves the frontend `acc_entries` income/expense register.
 * Thin controller over AccEntryService + AccEntryResource; a group-level list the
 * client filters by company. Schema::hasTable-guarded so it no-ops before migrate.
 *
 * NOTE: this persists the REGISTER row only. Its GL posting is a SEPARATE concern
 * — the client mirrors each entry to the ledger and that GL entry persists via
 * JournalController. Keeping the id stable (ext_id) is what keeps the two linked.
 */
class AccEntryController
{
    public function __construct(private AccEntryService $service) {}

    public function index(Request $request): JsonResponse
    {
        if (! Schema::hasTable('acc_entries')) {
            return response()->json(['success' => true, 'count' => 0, 'data' => []]);
        }
        $rows = $this->service->list($request->query('companyId'));

        return response()->json([
            'success' => true,
            'count'   => $rows->count(),
            'data'    => AccEntryResource::collection($rows),
        ]);
    }

    public function store(StoreAccEntryRequest $request): JsonResponse
    {
        if (! Schema::hasTable('acc_entries')) {
            return response()->json(['success' => false, 'message' => 'acc_entries table not migrated yet. Run: php artisan migrate'], 503);
        }
        $saved = $this->service->upsert($request->validated());

        return response()->json(['success' => true, 'data' => new AccEntryResource($saved)]);
    }

    public function destroy(string $id): JsonResponse
    {
        if (Schema::hasTable('acc_entries')) {
            $this->service->delete($id);
        }

        return response()->json(['success' => true]);
    }
}
