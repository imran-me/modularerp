<?php

namespace Epal\Modules\GroupCockpit\MasterAccounts\Models;

use Illuminate\Database\Eloquent\Model;

/** LoanTxn — a loan disbursement / collection movement (frontend `loan_txns` store). */
class LoanTxn extends Model
{
    protected $table = 'loan_txns';

    protected $fillable = ['ext_id', 'company_id', 'status', 'data'];

    protected $casts = ['data' => 'array'];
}
