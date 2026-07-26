<?php

namespace Epal\Modules\GroupCockpit\MasterAccounts\Http\Resources;

use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Shapes an AccEntry into the EXACT frontend `acc_entries` record. The id is the
 * stable `ext_id` (never the DB id), so the client-side GL mirror keeps working.
 *   { id, companyId, kind, amount, category, subCategory, head, method, payAcct,
 *     bankId, bankName, date, party, ref, desc, items, alloc, fundedBy, created }
 */
class AccEntryResource extends JsonResource
{
    public function toArray($request): array
    {
        return [
            'id'          => $this->ext_id,
            'companyId'   => $this->company_id,
            'kind'        => $this->kind,
            'amount'      => (float) $this->amount,
            'category'    => $this->category,
            'subCategory' => $this->sub_category,
            'head'        => $this->head,
            'method'      => $this->method,
            'payAcct'     => $this->pay_acct ?: '',
            'bankId'      => $this->bank_id ?: '',
            'bankName'    => $this->bank_name ?: '',
            'date'        => optional($this->date)->format('Y-m-d'),
            'party'       => $this->party,
            'ref'         => $this->ref,
            'desc'        => $this->description,
            'items'       => $this->items ?? [],
            'alloc'       => (bool) $this->alloc,
            'fundedBy'    => $this->funded_by ?: '',
            'created'     => $this->created,
        ];
    }
}
