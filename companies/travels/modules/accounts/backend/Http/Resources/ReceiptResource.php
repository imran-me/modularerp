<?php

namespace Epal\Modules\Travels\Accounts\Http\Resources;

use App\Http\Resources\JournalResource;
use App\Http\Resources\RegisterMovementResource;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * What recording a customer PAYMENT gives back.
 *
 *   { arAccount, settled, outstanding, into, account,
 *     journal:  <journal>,      DR the account / CR the SAME receivable the sale raised
 *     register: <movement>|null }
 *
 * `outstanding` is the point of this response: it is what the customer still owes
 * AFTER this receipt, so a client can decide whether the invoice is closed without
 * re-querying. `arAccount` says which receivable was actually cleared (1200 customer
 * or 1150 sub-agent) — proof the right ageing book moved.
 */
class ReceiptResource extends JsonResource
{
    public function toArray($request): array
    {
        $r = is_array($this->resource) ? $this->resource : (array) $this->resource;

        return [
            'arAccount'   => (string) ($r['arAccount'] ?? ''),
            'settled'     => round((float) ($r['settled'] ?? 0), 2),
            'outstanding' => round((float) ($r['outstanding'] ?? 0), 2),
            'into'        => (string) ($r['into'] ?? ''),      // 1010 bank | 1000 hard cash
            'account'     => $r['account'] ?? null,            // its name, when one was named
            'journal'     => isset($r['journal']) ? new JournalResource($r['journal']) : null,
            'register'    => isset($r['register']) && $r['register']
                ? new RegisterMovementResource($r['register']) : null,
        ];
    }
}
