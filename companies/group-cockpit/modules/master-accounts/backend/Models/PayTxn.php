<?php

namespace Epal\Modules\GroupCockpit\MasterAccounts\Models;

use Illuminate\Database\Eloquent\Model;

/** PayTxn — a payroll advance / loan / repayment movement (frontend `pay_txns` store). */
class PayTxn extends Model
{
    protected $table = 'pay_txns';

    protected $fillable = ['ext_id', 'company_id', 'status', 'data'];

    protected $casts = ['data' => 'array'];
}
