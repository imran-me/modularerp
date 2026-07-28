<?php

namespace Epal\Modules\Woodart\Procurement\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * PurchaseOrder — one order raised on a vendor (frontend `wa_purchases`).
 *
 * `supplier` holds the vendor NAME, not an id (see the migration's note and the
 * blueprint). `ext_id` is the frontend id ('WPO-001') and the upsert key.
 */
class PurchaseOrder extends Model
{
    use SoftDeletes;

    protected $table = 'wa_purchases';

    protected $fillable = [
        'ext_id', 'company_id', 'supplier', 'project', 'items', 'amount', 'status', 'date', 'created_on',
    ];

    protected $casts = [
        'items'      => 'integer',
        'amount'     => 'integer',
        'date'       => 'date',
        'created_on' => 'date',
    ];

    /** THE outstanding rule, server side: anything not fully Received is owed.
     *  Mirrored by Procurement.isOpen() in the frontend seam. */
    public function isOpen(): bool
    {
        return $this->status !== 'Received';
    }
}
