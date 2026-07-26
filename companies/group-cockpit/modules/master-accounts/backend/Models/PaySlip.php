<?php

namespace Epal\Modules\GroupCockpit\MasterAccounts\Models;

use Illuminate\Database\Eloquent\Model;

/** PaySlip — one employee's payslip for a month (frontend `pay_slips` store). */
class PaySlip extends Model
{
    protected $table = 'pay_slips';

    protected $fillable = ['ext_id', 'company_id', 'status', 'data'];

    protected $casts = ['data' => 'array'];
}
