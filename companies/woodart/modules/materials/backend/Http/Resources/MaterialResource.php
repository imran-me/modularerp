<?php

namespace Epal\Modules\Woodart\Materials\Http\Resources;

use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Shapes a Material into the EXACT frontend `wa_materials` record:
 *
 *   { id, name, category, unit, stock, reorder, unitCost, supplier, created }
 *
 * THIS CLASS IS THE TRANSLATION SEAM. Because it emits the frontend shape
 * verbatim, platform/data/api.js can hydrate the store with a plain write — no
 * mapping layer in JavaScript, and no chance of the two shapes drifting apart.
 * If you rename a column, change it HERE and the SPA never notices.
 */
class MaterialResource extends JsonResource
{
    public function toArray($request): array
    {
        return [
            'id'       => $this->ext_id,
            'name'     => $this->name,
            'category' => $this->category,
            'unit'     => $this->unit,
            'stock'    => (int) $this->stock,
            'reorder'  => (int) $this->reorder,
            'unitCost' => (int) $this->unit_cost,
            'supplier' => $this->supplier ?: '',
            'created'  => optional($this->created_on)->toDateString(),
        ];
    }
}
