<?php

namespace Epal\Modules\Woodart\Production\Http\Resources;

use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Shapes a Job into the EXACT frontend `wa_production` record:
 *
 *   { id, job, project, station, assignedTo, status, due, created }
 *
 * Note `assignedTo` (camelCase) against the column `assigned_to` — this class
 * is the translation seam, which is why the SPA needs no mapping layer and the
 * two shapes cannot drift.
 */
class JobResource extends JsonResource
{
    public function toArray($request): array
    {
        return [
            'id'         => $this->ext_id,
            'job'        => $this->job,
            'project'    => $this->project ?: '',
            'station'    => $this->station,
            'assignedTo' => $this->assigned_to ?: '',
            'status'     => $this->status,
            'due'        => optional($this->due)->toDateString(),
            'created'    => optional($this->created_on)->toDateString(),
        ];
    }
}
