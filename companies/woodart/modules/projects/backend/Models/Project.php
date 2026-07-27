<?php

namespace Epal\Modules\Woodart\Projects\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Project — the Woodart spine (frontend `wa_projects`).
 *
 * PARTIAL SLICE: the module itself is still the legacy view.js (ROOT-MAP §6
 * puts its rebuild at #9). This model and its table exist ahead of that purely
 * so every other module's project reference resolves in the database.
 *
 * `client` and `designer` hold NAMES, not keys — the inherited pattern.
 * `phase` is the additive field from ROOT-MAP §2.2; `stage` keeps its five
 * legacy values so nothing that reads it changes (R2).
 */
class Project extends Model
{
    use SoftDeletes;

    protected $table = 'wa_projects';

    protected $fillable = [
        'ext_id', 'company_id', 'name', 'client', 'type', 'area',
        'value', 'cost', 'stage', 'phase', 'progress', 'designer',
        'start', 'deadline', 'billed', 'created_on',
    ];

    protected $casts = [
        'area'       => 'integer',
        'value'      => 'integer',
        'cost'       => 'integer',
        'progress'   => 'integer',
        'billed'     => 'boolean',
        'start'      => 'date',
        'deadline'   => 'date',
        'created_on' => 'date',
    ];

    /** Margin is DERIVED, never stored — it cannot drift from value and cost. */
    public function margin(): int
    {
        return (int) $this->value - (int) $this->cost;
    }

    /** Live = not finished. Same definition the Clients portfolio uses. */
    public function isLive(): bool
    {
        return ! in_array($this->stage, ['Completed', 'Handover'], true);
    }
}
