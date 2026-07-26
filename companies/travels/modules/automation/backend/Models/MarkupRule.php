<?php

namespace Epal\Modules\Travels\Automation\Models;

use Illuminate\Database\Eloquent\Model;

/** MarkupRule — a pricing markup rule (frontend `tv_markup` store). */
class MarkupRule extends Model
{
    protected $table = 'tv_markup';

    protected $fillable = ['ext_id', 'company_id', 'status', 'data'];

    protected $casts = ['data' => 'array'];
}
