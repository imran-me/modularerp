<?php

namespace Epal\Modules\GroupCockpit\MasterAccounts\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * AccEntry — one income/expense register row (frontend `acc_entries` store).
 * `ext_id` holds the stable frontend id so the GL mirror stays linked.
 */
class AccEntry extends Model
{
    protected $table = 'acc_entries';

    protected $fillable = [
        'ext_id', 'company_id', 'kind', 'amount', 'category', 'sub_category',
        'head', 'method', 'date', 'party', 'ref', 'description', 'items',
        'alloc', 'funded_by', 'created',
        // WHICH account the money left (2026_07_26_002000): the `banks` row, its
        // name captured at posting time, and the GL side that moved (1000|1010).
        'bank_id', 'bank_name', 'pay_acct',
    ];

    protected $casts = [
        'amount' => 'decimal:2',
        'date'   => 'date',
        'items'  => 'array',
        'alloc'  => 'boolean',
    ];
}
