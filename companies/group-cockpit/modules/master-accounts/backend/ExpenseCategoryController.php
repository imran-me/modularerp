<?php

namespace Epal\Modules\GroupCockpit\MasterAccounts;

use Epal\Modules\GroupCockpit\MasterAccounts\Http\Requests\StoreExpenseCategoryRequest;
use Epal\Modules\GroupCockpit\MasterAccounts\Http\Resources\ExpenseCategoryResource;
use Epal\Modules\GroupCockpit\MasterAccounts\Services\ExpenseCategoryService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Schema;

/**
 * Expense Categories API — serves the frontend `exp_categories` lookup store.
 * Thin controller over ExpenseCategoryService + ExpenseCategoryResource,
 * Schema::hasTable-guarded so it no-ops before migrate.
 */
class ExpenseCategoryController
{
    public function __construct(private ExpenseCategoryService $service) {}

    public function index(): JsonResponse
    {
        if (! Schema::hasTable('exp_categories')) {
            return response()->json(['success' => true, 'count' => 0, 'data' => []]);
        }
        $rows = $this->service->list();

        return response()->json([
            'success' => true,
            'count'   => $rows->count(),
            'data'    => ExpenseCategoryResource::collection($rows),
        ]);
    }

    public function store(StoreExpenseCategoryRequest $request): JsonResponse
    {
        if (! Schema::hasTable('exp_categories')) {
            return response()->json(['success' => false, 'message' => 'exp_categories table not migrated yet. Run: php artisan migrate'], 503);
        }
        $saved = $this->service->upsert($request->validated());

        return response()->json(['success' => true, 'data' => new ExpenseCategoryResource($saved)]);
    }

    public function destroy(string $id): JsonResponse
    {
        if (Schema::hasTable('exp_categories')) {
            $this->service->delete($id);
        }

        return response()->json(['success' => true]);
    }
}
