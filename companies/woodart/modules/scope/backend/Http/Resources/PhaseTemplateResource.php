<?php

namespace Epal\Modules\Woodart\Scope\Http\Resources;

use Illuminate\Http\Resources\Json\JsonResource;

/** Shapes a PhaseTemplate into the frontend `wa_phase_templates` record. */
class PhaseTemplateResource extends JsonResource
{
    public function toArray($request): array
    {
        return [
            'id'        => $this->ext_id,
            'companyId' => $this->company_id,
            'kind'      => $this->kind,
            'sort'      => (int) $this->sort,
            'phases'    => $this->phases ?: [],
        ];
    }
}
