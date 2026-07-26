<?php

namespace Epal\Modules\Travels\Accounts\Models;

use Illuminate\Database\Eloquent\Model;

/** TvRecurring — a recurring expense template (frontend `tv_recurring` store). */
class TvRecurring extends Model
{
    protected $table = 'tv_recurring';

    protected $fillable = ['ext_id', 'company_id', 'status', 'data'];

    protected $casts = ['data' => 'array'];
}
