<?php

namespace Epal\Modules\Travels\Settings\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * CompanySetting — one row per company holding its settings JSON blob
 * (the frontend `settings.<company>` object). `data` is cast to an array so the
 * service can shallow-merge patches cleanly.
 */
class CompanySetting extends Model
{
    protected $table = 'company_settings';

    protected $fillable = ['company_id', 'data'];

    protected $casts = [
        'data' => 'array',
    ];
}
