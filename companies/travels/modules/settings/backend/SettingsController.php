<?php

namespace Epal\Modules\Travels\Settings;

use App\Support\ScopesToCompany;
use Epal\Modules\Travels\Settings\Http\Requests\SaveSettingsRequest;
use Epal\Modules\Travels\Settings\Services\SettingsService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Schema;

/**
 * Company Settings API (Travels) — serves the frontend `settings.travels` blob.
 * Thin controller over SettingsService; company-scoped (a company user only ever
 * reads/writes their OWN settings; this route defaults to Travels = 2 for a
 * super-admin). Schema::hasTable-guarded so it no-ops before migrate.
 */
class SettingsController
{
    use ScopesToCompany;

    /** This module belongs to Travels; a super-admin (no company) defaults here. */
    private const DEFAULT_COMPANY = 2;

    public function __construct(private SettingsService $service) {}

    private function companyId(Request $request): int
    {
        return $this->requesterCompanyId($request) ?: self::DEFAULT_COMPANY;
    }

    public function index(Request $request): JsonResponse
    {
        if (! Schema::hasTable('company_settings')) {
            return response()->json(['success' => true, 'data' => (object) []]);
        }

        return response()->json([
            'success' => true,
            'data'    => (object) $this->service->get($this->companyId($request)),
        ]);
    }

    public function store(SaveSettingsRequest $request): JsonResponse
    {
        if (! Schema::hasTable('company_settings')) {
            return response()->json(['success' => false, 'message' => 'Settings table not migrated yet. Run: php artisan migrate'], 503);
        }

        $merged = $this->service->merge($this->companyId($request), $request->patch());

        return response()->json(['success' => true, 'data' => (object) $merged]);
    }
}
