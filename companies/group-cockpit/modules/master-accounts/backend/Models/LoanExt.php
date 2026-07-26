<?php

namespace Epal\Modules\GroupCockpit\MasterAccounts\Models;

use Illuminate\Database\Eloquent\Model;

/** LoanExt — a loan GIVEN to an external party (frontend `loans_ext` store). */
class LoanExt extends Model
{
    protected $table = 'loans_ext';

    protected $fillable = ['ext_id', 'company_id', 'status', 'data'];

    protected $casts = ['data' => 'array'];
}
