<?php

namespace Epal\Modules\Travels\Marketing\Models;

use Illuminate\Database\Eloquent\Model;

/** Campaign — a broadcast campaign + delivery stats (frontend `tv_campaigns`). */
class Campaign extends Model
{
    protected $table = 'tv_campaigns';

    protected $fillable = ['ext_id', 'company_id', 'status', 'data'];

    protected $casts = ['data' => 'array'];
}
