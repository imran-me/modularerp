<?php

namespace Epal\Modules\Travels\VendorAgent\Models;

use Illuminate\Database\Eloquent\Model;

/** Agent — a sub-agent (frontend `tv_agents` store). */
class Agent extends Model
{
    protected $table = 'tv_agents';

    protected $fillable = ['ext_id', 'company_id', 'status', 'data'];

    protected $casts = ['data' => 'array'];
}
