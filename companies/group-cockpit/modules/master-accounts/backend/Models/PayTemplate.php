<?php

namespace Epal\Modules\GroupCockpit\MasterAccounts\Models;

use Illuminate\Database\Eloquent\Model;

/** PayTemplate — a company's salary structure (frontend `pay_templates` store). */
class PayTemplate extends Model
{
    protected $table = 'pay_templates';

    protected $fillable = ['ext_id', 'company_id', 'status', 'data'];

    protected $casts = ['data' => 'array'];
}
