<?php

namespace Epal\Modules\Travels\Marketing\Models;

use Illuminate\Database\Eloquent\Model;

/** Message — one delivery-log row (frontend `tv_messages` send-log). */
class Message extends Model
{
    protected $table = 'tv_messages';

    protected $fillable = ['ext_id', 'company_id', 'status', 'data'];

    protected $casts = ['data' => 'array'];
}
