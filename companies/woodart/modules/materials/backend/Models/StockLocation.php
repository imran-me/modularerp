<?php

namespace Epal\Modules\Woodart\Materials\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * StockLocation — where stock sits (frontend `wa_locations`).
 *
 * Named StockLocation rather than Location because "Location" is a word this
 * codebase already uses loosely for an area/address; this is specifically a
 * place stock is held (NAMING-AND-TERMINOLOGY §4: coin a word only when the
 * existing one is genuinely ambiguous).
 */
class StockLocation extends Model
{
    use SoftDeletes;

    protected $table = 'wa_locations';

    protected $fillable = [
        'ext_id', 'company_id', 'name', 'kind', 'area', 'primary', 'created_on',
    ];

    protected $casts = [
        'primary'    => 'boolean',
        'created_on' => 'date',
    ];

    public const KINDS = ['Workshop', 'Site', 'Store'];
}
