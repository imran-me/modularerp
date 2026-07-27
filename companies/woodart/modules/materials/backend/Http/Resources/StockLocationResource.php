<?php

namespace Epal\Modules\Woodart\Materials\Http\Resources;

use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Shapes a StockLocation into the EXACT frontend `wa_locations` record:
 *   { id, name, kind, area, primary, created }
 */
class StockLocationResource extends JsonResource
{
    public function toArray($request): array
    {
        return [
            'id'      => $this->ext_id,
            'name'    => $this->name,
            'kind'    => $this->kind,
            'area'    => $this->area ?: '',
            'primary' => (bool) $this->primary,
            'created' => optional($this->created_on)->toDateString(),
        ];
    }
}
