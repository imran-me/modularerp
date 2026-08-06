<?php

namespace Epal\Modules\Woodart\Procurement\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * PurchaseLine — what a purchase order actually orders (frontend
 * `wa_purchase_lines`): the material and the quantity, so a part-delivery has
 * something to be part of.
 */
class PurchaseLine extends Model
{
    use SoftDeletes;

    protected $table = 'wa_purchase_lines';

    protected $fillable = [
        'ext_id', 'company_id', 'order', 'project', 'material',
        'item', 'qty', 'unit', 'unit_cost',
    ];

    protected $casts = [
        'qty'       => 'float',
        'unit_cost' => 'integer',
    ];

    /** What this line costs — the only formula it has. */
    public function amount(): int
    {
        return (int) round($this->qty * $this->unit_cost);
    }
}
