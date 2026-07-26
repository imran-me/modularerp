<?php

namespace Epal\Modules\GroupCockpit\MasterAccounts\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * ExpenseCategory — a category + its sub-category list (frontend `exp_categories`
 * store). `subs` is a JSON array of sub-category names.
 */
class ExpenseCategory extends Model
{
    protected $table = 'exp_categories';

    protected $fillable = ['name', 'subs', 'active', 'company_id'];

    protected $casts = [
        'subs'   => 'array',
        'active' => 'boolean',
    ];
}
