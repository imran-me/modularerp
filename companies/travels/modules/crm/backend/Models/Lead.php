<?php

namespace Epal\Modules\Travels\Crm\Models;

use Illuminate\Database\Eloquent\Model;

/** Lead — a CRM pipeline lead (frontend `leads` store). */
class Lead extends Model
{
    protected $table = 'leads';

    protected $fillable = ['ext_id', 'company_id', 'status', 'data'];

    protected $casts = ['data' => 'array'];
}
