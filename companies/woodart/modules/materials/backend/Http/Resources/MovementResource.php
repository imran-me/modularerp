<?php

namespace Epal\Modules\Woodart\Materials\Http\Resources;

use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Shapes a Movement into the EXACT frontend `wa_movements` record:
 *   { id, material, kind, qty, location, ref, note, by, date, created }
 */
class MovementResource extends JsonResource
{
    public function toArray($request): array
    {
        return [
            'id'       => $this->ext_id,
            'material' => $this->material,
            'kind'     => $this->kind,
            'qty'      => (int) $this->qty,
            'location' => $this->location ?: '',
            'ref'      => $this->ref ?: '',
            'note'     => $this->note ?: '',
            'by'       => $this->by ?: '',
            'date'     => optional($this->date)->toDateString(),
            'created'  => optional($this->date)->toDateString(),
        ];
    }
}
