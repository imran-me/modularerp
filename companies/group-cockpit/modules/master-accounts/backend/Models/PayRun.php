<?php

namespace Epal\Modules\GroupCockpit\MasterAccounts\Models;

use Illuminate\Database\Eloquent\Model;

/** PayRun — one month's payroll run for a company (frontend `pay_runs` store). */
class PayRun extends Model
{
    protected $table = 'pay_runs';

    protected $fillable = ['ext_id', 'company_id', 'status', 'data'];

    protected $casts = ['data' => 'array'];
}
