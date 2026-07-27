<?php

namespace Epal\Modules\Woodart\Procurement\Http\Resources;

use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Shapes a PurchaseOrder into the EXACT frontend `wa_purchases` record:
 *
 *   { id, supplier, items, amount, status, date, created }
 *
 * This shape is INHERITED, not designed — it is what platform/data/seed-bd.js
 * already produces and what the screens already read. Keeping it verbatim is
 * what lets api.js hydrate with a plain write (R2).
 */
class PurchaseOrderResource extends JsonResource
{
    public function toArray($request): array
    {
        return [
            'id'       => $this->ext_id,
            'supplier' => $this->supplier,
            'items'    => (int) $this->items,
            'amount'   => (int) $this->amount,
            'status'   => $this->status,
            'date'     => optional($this->date)->toDateString(),
            'created'  => optional($this->created_on)->toDateString(),
        ];
    }
}
