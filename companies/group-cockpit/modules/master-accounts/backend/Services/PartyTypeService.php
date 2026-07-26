<?php

namespace Epal\Modules\GroupCockpit\MasterAccounts\Services;

use Epal\Modules\GroupCockpit\MasterAccounts\Models\PartyType;
use Illuminate\Support\Collection;
use Illuminate\Support\Str;

/**
 * PartyTypeService — list + upsert + delete party types. The slug is derived from
 * the name (kebab), matching the frontend's ptSlug(); uniqueness is per company.
 */
class PartyTypeService
{
    public function list(): Collection
    {
        return PartyType::query()->orderBy('company_id')->orderBy('name')->get();
    }

    public function upsert(array $data): PartyType
    {
        $id = null;
        if (! empty($data['id']) && preg_match('/(\d+)$/', $data['id'], $m)) {
            $id = (int) $m[1];
        }

        $pt = ($id && PartyType::whereKey($id)->exists())
            ? PartyType::findOrFail($id)
            : new PartyType();

        $pt->fill([
            'name'       => trim($data['name']),
            'slug'       => Str::slug(trim($data['name'])),
            'company_id' => $data['companyId'] ?? 'group',
            'maps_to'    => $data['mapsTo'] ?? '',
        ]);
        $pt->save();

        return $pt;
    }

    public function delete(string $frontendId): void
    {
        if (preg_match('/(\d+)$/', $frontendId, $m)) {
            PartyType::whereKey((int) $m[1])->delete();
        }
    }
}
