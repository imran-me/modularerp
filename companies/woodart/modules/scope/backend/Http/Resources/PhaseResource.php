<?php

namespace Epal\Modules\Woodart\Scope\Http\Resources;

use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Shapes a Phase into the EXACT frontend `wa_phases` record:
 *
 *   { id, project, space, name, code, sort, status, ownerId, start, finish, note }
 *
 * `ownerId` is a REFERENCE to employees.ext_id and never a copy of the person's
 * name: HRM owns that record, and a duplicated name goes stale the first time
 * somebody changes a designation.
 */
class PhaseResource extends JsonResource
{
    public function toArray($request): array
    {
        return [
            'id'        => $this->ext_id,
            'companyId' => $this->company_id,
            'project'   => $this->project,
            'space'     => $this->space,
            'name'      => $this->name,
            'code'      => $this->code ?: '',
            'sort'      => (int) $this->sort,
            'status'    => $this->status,
            'ownerId'   => $this->owner_id ?: '',
            'start'     => optional($this->start)->toDateString(),
            'finish'    => optional($this->finish)->toDateString(),
            'note'      => $this->note ?: '',
        ];
    }
}
