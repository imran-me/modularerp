<?php

namespace Epal\Modules\Travels\PassportMgmt;

use App\Support\ScopesToCompany;
use Epal\Modules\Travels\PassportMgmt\Http\Requests\StorePassportRequest;
use Epal\Modules\Travels\PassportMgmt\Http\Resources\PassportResource;
use Epal\Modules\Travels\PassportMgmt\Services\PassportService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Schema;

/**
 * Passport Management API — serves the frontend `tv_passports` store. A THIN
 * controller over PassportService (business logic) + PassportResource (shape),
 * per the owner's enterprise-architecture spec. Company-scoped via
 * ScopesToCompany (a Travels user sees only Travels' passports; super-admin all).
 *
 * Every method is Schema::hasTable-guarded, so before `php artisan migrate` has
 * created tv_passports on a server the endpoints return empty / no-op rather
 * than 500 — the live app keeps working until the table exists.
 */
class PassportController
{
    use ScopesToCompany;

    public function __construct(private PassportService $service) {}

    public function index(Request $request): JsonResponse
    {
        if (! Schema::hasTable('tv_passports')) {
            return response()->json(['success' => true, 'count' => 0, 'data' => []]);
        }

        $rows = $this->service->list($this->requesterCompanyId($request));

        return response()->json([
            'success' => true,
            'count'   => $rows->count(),
            'data'    => PassportResource::collection($rows),
        ]);
    }

    public function store(StorePassportRequest $request): JsonResponse
    {
        if (! Schema::hasTable('tv_passports')) {
            return response()->json(['success' => false, 'message' => 'Passports table not migrated yet. Run: php artisan migrate'], 503);
        }

        $saved = $this->service->upsert($request->validated(), $this->requesterCompanyId($request));

        return response()->json(['success' => true, 'data' => new PassportResource($saved)]);
    }

    public function destroy(string $id): JsonResponse
    {
        if (Schema::hasTable('tv_passports')) {
            $this->service->delete($id);
        }

        return response()->json(['success' => true]);
    }
}
