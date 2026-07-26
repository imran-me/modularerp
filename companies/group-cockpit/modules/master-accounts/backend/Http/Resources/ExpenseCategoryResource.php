<?php

namespace Epal\Modules\GroupCockpit\MasterAccounts\Http\Resources;

use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Shapes an ExpenseCategory into the frontend `exp_categories` record:
 *   { id, name, subs, active, companyId }
 */
class ExpenseCategoryResource extends JsonResource
{
    public function toArray($request): array
    {
        return [
            'id'        => 'CAT-' . $this->id,
            'name'      => $this->name,
            'subs'      => $this->subs ?? [],
            'active'    => (bool) $this->active,
            'companyId' => $this->company_id,
        ];
    }
}
