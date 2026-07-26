<?php

namespace Epal\Modules\Travels\Accounts\Models;

use Illuminate\Database\Eloquent\Model;

/** TvPetty — a petty-cash / IOU slip (frontend `tv_petty` store). */
class TvPetty extends Model
{
    protected $table = 'tv_petty';

    protected $fillable = ['ext_id', 'company_id', 'status', 'data'];

    protected $casts = ['data' => 'array'];
}
