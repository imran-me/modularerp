<?php

namespace Epal\Modules\Travels\Accounts\Http\Resources;

use App\Http\Resources\JournalResource;
use App\Http\Resources\RegisterMovementResource;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * What recording an EXPENSE gives back — the three books it touched.
 *
 *   { entry:         the register row, in the frontend `acc_entries` shape,
 *     journal:       <journal>          DR the head / CR the account (or 2400 when funded),
 *     funderJournal: <journal>|null     the FUNDER's leg: DR 1300 / CR their account,
 *     register:      <movement>|null    the paying account's balance + history row }
 *
 * `funderJournal` is only there when another concern's purse paid — its presence is
 * how a caller knows the spend became an inter-company loan rather than our own cash
 * going out.
 */
class ExpenseVoucherResource extends JsonResource
{
    public function toArray($request): array
    {
        $r = is_array($this->resource) ? $this->resource : (array) $this->resource;

        return [
            'entry'         => $r['entry'] ?? null,
            'journal'       => isset($r['journal']) ? new JournalResource($r['journal']) : null,
            'funderJournal' => isset($r['funderJournal']) && $r['funderJournal']
                ? new JournalResource($r['funderJournal']) : null,
            'register'      => isset($r['register']) && $r['register']
                ? new RegisterMovementResource($r['register']) : null,
        ];
    }
}
