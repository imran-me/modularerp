<?php

namespace Epal\Modules\Woodart\Design\Http\Resources;

use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Shapes a Drawing into the EXACT frontend `wa_drawings` record:
 *   { id, project, title, kind, rev, status, designer, issued, approved, created }
 */
class DrawingResource extends JsonResource
{
    public function toArray($request): array
    {
        return [
            'id'       => $this->ext_id,
            'project'  => $this->project ?: '',
            'title'    => $this->title,
            'kind'     => $this->kind,
            'rev'      => $this->rev,
            'status'   => $this->status,
            'designer' => $this->designer ?: '',
            'issued'   => optional($this->issued)->toDateString(),
            'approved' => optional($this->approved)->toDateString(),
            'created'  => optional($this->created_on)->toDateString(),
        ];
    }
}
