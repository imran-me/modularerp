<?php

namespace Epal\Modules\Woodart\Scope\Http\Resources;

use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Shapes a Space into the EXACT frontend `wa_spaces` record:
 *
 *   { id, project, name, kind, area, sort, note, created }
 *
 * THIS CLASS IS THE TRANSLATION SEAM — it emits the frontend shape verbatim, so
 * platform/data/api.js hydrates the store with a plain write and there is no
 * mapping layer in JavaScript to drift out of sync.
 */
class SpaceResource extends JsonResource
{
    public function toArray($request): array
    {
        return [
            'id'        => $this->ext_id,
            'companyId' => $this->company_id,
            'project'   => $this->project,
            'name'      => $this->name,
            'kind'      => $this->kind,
            'area'      => (int) $this->area,
            'sort'      => (int) $this->sort,
            'note'      => $this->note ?: '',
            'created'   => optional($this->created_on)->toDateString(),
        ];
    }
}
