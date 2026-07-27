<?php

namespace Epal\Modules\Woodart\Procurement\Http\Resources;

use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Shapes a Vendor into the EXACT frontend `wa_vendors` record:
 *
 *   { id, name, category, contact, phone, email, area, terms, since, created }
 *
 * The translation seam: because it emits the frontend shape verbatim,
 * platform/data/api.js hydrates the store with a plain write.
 */
class VendorResource extends JsonResource
{
    public function toArray($request): array
    {
        return [
            'id'       => $this->ext_id,
            'name'     => $this->name,
            'category' => $this->category,
            'contact'  => $this->contact ?: '',
            'phone'    => $this->phone ?: '',
            'email'    => $this->email ?: '',
            'area'     => $this->area ?: '',
            'terms'    => $this->terms ?: '',
            'since'    => optional($this->since)->toDateString(),
            'created'  => optional($this->created_on)->toDateString(),
        ];
    }
}
