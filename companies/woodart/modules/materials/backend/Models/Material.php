<?php

namespace Epal\Modules\Woodart\Materials\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Material — one line of Woodart's material inventory (frontend `wa_materials`).
 *
 * `ext_id` is the frontend-generated id ('MAT-001') and is the upsert key;
 * `company_id` is the frontend company slug ('woodart').
 */
class Material extends Model
{
    use SoftDeletes;

    protected $table = 'wa_materials';

    protected $fillable = [
        'ext_id', 'company_id', 'name', 'category', 'unit',
        'stock', 'reorder', 'unit_cost', 'supplier', 'created_on',
    ];

    /** Money and counts must reach the frontend as numbers, never as strings. */
    protected $casts = [
        'stock'      => 'integer',
        'reorder'    => 'integer',
        'unit_cost'  => 'integer',
        'created_on' => 'date',
    ];

    /** Stock value of this line. The same rule the frontend seam applies. */
    public function value(): int
    {
        return (int) $this->stock * (int) $this->unit_cost;
    }

    /** THE reorder rule, server side: at or below the line needs buying. */
    public function isLow(): bool
    {
        return (int) $this->stock <= (int) $this->reorder;
    }
}
