<?php

namespace Epal\Modules\Woodart\Clients\Http\Resources;

use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Shapes a Client into the EXACT frontend `wa_clients` record:
 *
 *   { id, name, type, contact, phone, email, area, since, created }
 *
 * THIS CLASS IS THE TRANSLATION SEAM. Because it emits the frontend shape
 * verbatim, platform/data/api.js hydrates the store with a plain write — no
 * mapping layer in JavaScript, and no chance of the two shapes drifting.
 * Rename a column and you change it HERE; the SPA never notices.
 */
class ClientResource extends JsonResource
{
    public function toArray($request): array
    {
        return [
            'id'      => $this->ext_id,
            'name'    => $this->name,
            'type'    => $this->type,
            'contact' => $this->contact ?: '',
            'phone'   => $this->phone ?: '',
            'email'   => $this->email ?: '',
            'area'    => $this->area ?: '',
            'since'   => optional($this->since)->toDateString(),
            'created' => optional($this->created_on)->toDateString(),
        ];
    }
}
