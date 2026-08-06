<?php

namespace Epal\Modules\Woodart\Scope\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * PhaseTemplate — the default phase list for a kind of room
 * (frontend `wa_phase_templates`). Seeded data, not code.
 */
class PhaseTemplate extends Model
{
    protected $table = 'wa_phase_templates';

    protected $fillable = ['ext_id', 'company_id', 'kind', 'sort', 'phases'];

    protected $casts = [
        'sort'   => 'integer',
        'phases' => 'array',
    ];
}
