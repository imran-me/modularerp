<?php

namespace Epal\Modules\Travels\Marketing\Models;

use Illuminate\Database\Eloquent\Model;

/** MsgTemplate — a reusable message template (frontend `tv_templates`). */
class MsgTemplate extends Model
{
    protected $table = 'tv_templates';

    protected $fillable = ['ext_id', 'company_id', 'status', 'data'];

    protected $casts = ['data' => 'array'];
}
