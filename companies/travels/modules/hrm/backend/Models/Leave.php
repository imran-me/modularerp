<?php

namespace Epal\Modules\Travels\Hrm\Models;

use Illuminate\Database\Eloquent\Model;

/** Leave — a leave application / register row (frontend `tv_leaves` store). */
class Leave extends Model
{
    protected $table = 'tv_leaves';

    protected $fillable = ['ext_id', 'company_id', 'status', 'data'];

    protected $casts = ['data' => 'array'];
}
