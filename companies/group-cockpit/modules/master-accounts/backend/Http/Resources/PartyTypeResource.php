<?php

namespace Epal\Modules\GroupCockpit\MasterAccounts\Http\Resources;

use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Shapes a PartyType into the frontend `party_types` record:
 *   { id, name, slug, companyId, mapsTo }
 */
class PartyTypeResource extends JsonResource
{
    public function toArray($request): array
    {
        return [
            'id'        => 'PT-' . $this->id,
            'name'      => $this->name,
            'slug'      => $this->slug,
            'companyId' => $this->company_id,
            'mapsTo'    => $this->maps_to ?: '',
        ];
    }
}
