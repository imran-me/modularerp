<?php

namespace Epal\Modules\Woodart\Procurement\Http\Resources;

use Illuminate\Http\Resources\Json\JsonResource;

/** Shapes a PurchaseLine into the exact frontend `wa_purchase_lines` record. */
class PurchaseLineResource extends JsonResource
{
    public function toArray($request): array
    {
        return [
            'id'        => $this->ext_id,
            'companyId' => $this->company_id,
            'order'     => $this->order,
            'project'   => $this->project ?: '',
            'material'  => $this->material,
            'item'      => $this->item,
            'qty'       => (float) $this->qty,
            'unit'      => $this->unit ?: '',
            'unitCost'  => (int) $this->unit_cost,
        ];
    }
}
