<?php

namespace Epal\Modules\Woodart\Procurement\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Vendor — a supplier Woodart buys from (frontend `wa_vendors`).
 *
 * NOTE: there is deliberately no `orders()` hasMany. Purchase orders reference
 * a vendor by NAME, not by id, so a relation would be a lie about the schema.
 * The name join lives in ProcurementService, in one place, behind one
 * normalisation — see the blueprint.
 */
class Vendor extends Model
{
    use SoftDeletes;

    protected $table = 'wa_vendors';

    protected $fillable = [
        'ext_id', 'company_id', 'name', 'category',
        'contact', 'phone', 'email', 'area', 'terms', 'since', 'created_on',
    ];

    protected $casts = [
        'since'      => 'date',
        'created_on' => 'date',
    ];
}
