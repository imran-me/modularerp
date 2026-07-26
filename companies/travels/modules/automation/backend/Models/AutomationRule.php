<?php

namespace Epal\Modules\Travels\Automation\Models;

use Illuminate\Database\Eloquent\Model;

/** AutomationRule — an automation rule (frontend `tv_automation` store). */
class AutomationRule extends Model
{
    protected $table = 'tv_automation';

    protected $fillable = ['ext_id', 'company_id', 'status', 'data'];

    protected $casts = ['data' => 'array'];
}
