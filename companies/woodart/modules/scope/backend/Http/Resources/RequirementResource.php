<?php

namespace Epal\Modules\Woodart\Scope\Http\Resources;

use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Shapes a Requirement into the EXACT frontend `wa_requirements` record.
 *
 * `qty` is emitted as a float because labour is man-days and material can be
 * half a sheet; every money field is an integer number of Taka (D10). The
 * amount and the quote are deliberately NOT sent: they are one multiplication
 * away, and a number sent twice is a number that can arrive disagreeing.
 */
class RequirementResource extends JsonResource
{
    public function toArray($request): array
    {
        return [
            'id'         => $this->ext_id,
            'companyId'  => $this->company_id,
            'project'    => $this->project,
            'space'      => $this->space,
            'phase'      => $this->phase,
            'kind'       => $this->kind,
            'code'       => $this->code ?: '',
            'item'       => $this->item,
            'materialId' => $this->material_id,
            'qty'        => (float) $this->qty,
            'unit'       => $this->unit ?: '',
            'unitCost'   => (int) $this->unit_cost,
            'unitSale'   => (int) $this->unit_sale,
            'status'     => $this->status,
            'note'       => $this->note ?: '',
        ];
    }
}
