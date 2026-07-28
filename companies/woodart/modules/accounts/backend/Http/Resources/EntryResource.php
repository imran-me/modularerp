<?php

namespace Epal\Modules\Woodart\Accounts\Http\Resources;

use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Shapes an AccEntry into the frontend `acc_entries` record.
 *
 * ⚠️ THIS SHAPE IS NOT OURS TO INVENT. `acc_entries` is a SHARED store: Master
 * Accounts hydrates it group-wide and its own AccEntryResource defines the
 * canonical record. Woodart's register is a company-scoped view of the very
 * same rows, so it must emit byte-identical keys — otherwise the same entry
 * would arrive with one shape via the group screen and another via this one,
 * and whichever hydrated last would win.
 *
 * Kept as a copy rather than an import because modules never import each
 * other's classes (see Travels Accounts, which imports only its own models):
 * deleting `companies/group-cockpit/` must not break Woodart, and vice versa.
 * The duplication is the price of drop-in / drop-out, and it is deliberate.
 *
 * If the canonical shape changes, change it HERE too. The keys are:
 *   { id, companyId, kind, amount, category, subCategory, head, method,
 *     payAcct, bankId, bankName, date, party, ref, desc, items, alloc,
 *     fundedBy, created }
 */
class EntryResource extends JsonResource
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
