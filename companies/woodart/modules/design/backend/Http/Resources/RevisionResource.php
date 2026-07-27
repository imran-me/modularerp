<?php

namespace Epal\Modules\Woodart\Design\Http\Resources;

use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Shapes a Revision into the EXACT frontend `wa_revisions` record:
 *   { id, drawing, rev, action, by, note, date }
 */
class RevisionResource extends JsonResource
{
    public function toArray($request): array
    {
        return [
            'id'      => $this->ext_id,
            'drawing' => $this->drawing,
            'rev'     => $this->rev,
            'action'  => $this->action,
            'by'      => $this->by ?: '',
            'note'    => $this->note ?: '',
            'date'    => optional($this->date)->toDateString(),
        ];
    }
}
