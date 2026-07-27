<?php

namespace Epal\Modules\Travels\Accounts\Http\Resources;

use App\Http\Resources\JournalResource;
use App\Http\Resources\RegisterMovementResource;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * What recording a SALE gives back.
 *
 *   { ref, product, paid, debitedTo,
 *     revenue:  <journal>,            DR receivable|account / CR income (+ VAT)
 *     cost:       <journal>|null,     DR 5000 / CR payable|account
 *     commission: <journal>|null,     DR 5350 Agent Commission / CR payable to the agent
 *     register: { in?: <movement>, out?: <movement> } }
 *
 * `debitedTo` is the code the customer's side landed on — 1200 customer AR, 1150
 * sub-agent AR, or 1010/1000 when it was paid at the till. It is the single field
 * that tells a caller whether a receivable was raised, so it is worth returning
 * explicitly rather than making the client dig through the journal lines.
 *
 * `register.in` is the customer's money arriving; `register.out` is the vendor being
 * paid. Either is absent when that side named no real account.
 */
class SalePostingResource extends JsonResource
{
    public function toArray($request): array
    {
        $r = is_array($this->resource) ? $this->resource : (array) $this->resource;
        $reg = $r['register'] ?? [];

        return [
            'ref'       => (string) ($r['ref'] ?? ''),
            'product'   => $r['product'] ?? null,
            'paid'      => (bool) ($r['paid'] ?? false),
            'debitedTo' => (string) ($r['debitedTo'] ?? ''),
            'revenue'   => isset($r['revenue']) ? new JournalResource($r['revenue']) : null,
            'cost'      => isset($r['cost']) && $r['cost'] ? new JournalResource($r['cost']) : null,
            // present only when a sub-agent earned a cut — DR 5350 / CR payable to them
            'commission' => isset($r['commission']) && $r['commission'] ? new JournalResource($r['commission']) : null,
            'register'  => [
                'in'  => isset($reg['in']) ? new RegisterMovementResource($reg['in']) : null,
                'out' => isset($reg['out']) ? new RegisterMovementResource($reg['out']) : null,
            ],
        ];
    }
}
