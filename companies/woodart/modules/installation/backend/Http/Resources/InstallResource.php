<?php

namespace Epal\Modules\Woodart\Installation\Http\Resources;

use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Shapes an Install into the EXACT frontend `wa_installs` record:
 *
 *   { id, project, site, team, status, date, snags, snagList?, created }
 *
 * `snags` is ALWAYS the authoritative OPEN count — derived from the itemised
 * list when one exists — so a client that only reads the number is never wrong.
 * `snagList` is omitted entirely when the record was never itemised, which is
 * exactly what the seeded frontend records look like.
 */
class InstallResource extends JsonResource
{
    public function toArray($request): array
    {
        $out = [
            'id'      => $this->ext_id,
            'project' => $this->project ?: '',
            'site'    => $this->site,
            'team'    => $this->team ?: '',
            'status'  => $this->status,
            'date'    => optional($this->date)->toDateString(),
            'snags'   => $this->openSnags(),
            'created' => optional($this->created_on)->toDateString(),
        ];

        if (is_array($this->snag_list) && $this->snag_list !== []) {
            $out['snagList'] = $this->snag_list;
        }

        return $out;
    }
}
