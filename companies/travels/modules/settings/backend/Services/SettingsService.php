<?php

namespace Epal\Modules\Travels\Settings\Services;

use Epal\Modules\Travels\Settings\Models\CompanySetting;

/**
 * SettingsService — read + shallow-merge-save a company's settings blob, mirroring
 * the frontend's EPAL.store.patch (each tab merges its own keys without clobbering
 * the others). Business logic kept out of the controller (enterprise-architecture spec).
 */
class SettingsService
{
    /** The stored settings object for a company (empty array if none yet). */
    public function get(int $companyId): array
    {
        $row = CompanySetting::where('company_id', $companyId)->first();

        return $row?->data ?? [];
    }

    /** Shallow-merge $patch into the company's settings and persist; returns the merged blob. */
    public function merge(int $companyId, array $patch): array
    {
        $row = CompanySetting::firstOrNew(['company_id' => $companyId]);
        $row->data = array_merge($row->data ?? [], $patch);
        $row->save();

        return $row->data;
    }
}
