<?php

namespace App\Http\Resources;

use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A MOVEMENT ON A REAL ACCOUNT, as the API returns it.
 * ----------------------------------------------------------------------------
 * The other half of every money posting: the ledger says cash moved, this says
 * WHICH account it moved in, and what it holds now. Shaped to match the SPA's
 * `bank_txns` record (bankTxnApply) plus the resulting `balance`, which is the one
 * field a client always wants back and would otherwise have to re-fetch:
 *
 *   { bankId, bankName, type, amount, date, desc, ref, glId, balance }
 *
 * `type` is the register's own vocabulary — deposit · withdraw · transfer-in ·
 * transfer-out · opening — not an accounting term; the accounting is in the journal.
 */
class RegisterMovementResource extends JsonResource
{
    public function toArray($request): array
    {
        $m = is_array($this->resource) ? $this->resource : (array) $this->resource;

        return [
            'bankId'   => (string) ($m['bankId'] ?? ''),
            'bankName' => $m['bankName'] ?? null,
            'type'     => (string) ($m['type'] ?? ''),
            'amount'   => round((float) ($m['amount'] ?? 0), 2),
            'date'     => $m['date'] ?? null,
            'desc'     => (string) ($m['desc'] ?? ''),
            'ref'      => (string) ($m['ref'] ?? ''),
            'glId'     => (string) ($m['glId'] ?? ''),
            // what the account holds AFTER the movement — saves the client a round-trip
            'balance'  => isset($m['balance']) ? round((float) $m['balance'], 2) : null,
        ];
    }
}
