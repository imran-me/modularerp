<?php

namespace Epal\Modules\GroupCockpit\MasterAccounts\Models;

use Illuminate\Database\Eloquent\Model;

/** LoanTaken — a borrowing the group TOOK (frontend `loans_taken` store). */
class LoanTaken extends Model
{
    protected $table = 'loans_taken';

    protected $fillable = ['ext_id', 'company_id', 'status', 'data'];

    protected $casts = ['data' => 'array'];
}
