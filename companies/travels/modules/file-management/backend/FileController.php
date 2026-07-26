<?php

namespace Epal\Modules\Travels\FileManagement;

use App\Support\ScopesToCompany;
use Epal\Modules\Travels\FileManagement\Http\Requests\StoreFileRequest;
use Epal\Modules\Travels\FileManagement\Http\Resources\FileResource;
use Epal\Modules\Travels\FileManagement\Services\FileService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Schema;

/**
 * File Management API — serves the frontend `tv_files` store (embassy file
 * tracking). Thin controller over FileService + FileResource; company-scoped;
 * Schema::hasTable-guarded so it no-ops before migrate.
 */
class FileController
{
    use ScopesToCompany;

    public function __construct(private FileService $service) {}

    public function index(Request $request): JsonResponse
    {
        if (! Schema::hasTable('tv_files')) {
            return response()->json(['success' => true, 'count' => 0, 'data' => []]);
        }

        $rows = $this->service->list($this->requesterCompanyId($request));

        return response()->json([
            'success' => true,
            'count'   => $rows->count(),
            'data'    => FileResource::collection($rows),
        ]);
    }

    public function store(StoreFileRequest $request): JsonResponse
    {
        if (! Schema::hasTable('tv_files')) {
            return response()->json(['success' => false, 'message' => 'Files table not migrated yet. Run: php artisan migrate'], 503);
        }

        $saved = $this->service->upsert($request->validated(), $this->requesterCompanyId($request));

        return response()->json(['success' => true, 'data' => new FileResource($saved)]);
    }

    public function destroy(string $id): JsonResponse
    {
        if (Schema::hasTable('tv_files')) {
            $this->service->delete($id);
        }

        return response()->json(['success' => true]);
    }
}
