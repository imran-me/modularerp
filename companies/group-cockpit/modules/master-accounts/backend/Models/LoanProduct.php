<?php

namespace Epal\Modules\GroupCockpit\MasterAccounts\Models;

use Illuminate\Database\Eloquent\Model;

/** LoanProduct — a loan product template (frontend `loan_products` store). */
class LoanProduct extends Model
{
    protected $table = 'loan_products';

    protected $fillable = ['ext_id', 'company_id', 'status', 'data'];

    protected $casts = ['data' => 'array'];
}
