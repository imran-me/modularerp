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
    ];

    protected $casts = [
        'amount' => 'decimal:2',
        'date'   => 'date',
        'items'  => 'array',
        'alloc'  => 'boolean',
    ];
}
