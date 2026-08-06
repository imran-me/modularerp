<?php

namespace Epal\Modules\Woodart\Scope\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Space — one room or area of a project (frontend `wa_spaces`).
 *
 * `ext_id` is the frontend id ('SPC-001') and the upsert key; `project` holds
 * a wa_projects.ext_id by value, as every Woodart module joins.
 */
class Space extends Model
{
    use SoftDeletes;

    protected $table = 'wa_spaces';

    protected $fillable = [
        'ext_id', 'company_id', 'project', 'name', 'kind',
        'area', 'sort', 'note', 'created_on',
    ];

    protected $casts = [
        'area'       => 'integer',
        'sort'       => 'integer',
        'created_on' => 'date',
    ];

    /** This space's phases, in running order. */
    public function phases()
    {
        return Phase::where('company_id', $this->company_id)
            ->where('space', $this->ext_id)
            ->orderBy('sort')->orderBy('ext_id');
    }
}
