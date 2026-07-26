<?php

namespace Epal\Modules\Travels\Crm\Models;

use Illuminate\Database\Eloquent\Model;

/** CrmActivity — a CRM activity-log entry (frontend `crm_activities` store). */
class CrmActivity extends Model
{
    protected $table = 'crm_activities';

    protected $fillable = ['ext_id', 'company_id', 'status', 'data'];

    protected $casts = ['data' => 'array'];
}
