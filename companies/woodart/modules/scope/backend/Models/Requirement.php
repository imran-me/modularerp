<?php

namespace Epal\Modules\Woodart\Scope\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Requirement — one line of what a phase needs (frontend `wa_requirements`).
 *
 * Three kinds share one table and one pair of formulas, which is the whole
 * point: material, labour and contracted work all price the same way, so the
 * quotation, the material listing and the cost matrix cannot disagree.
 */
class Requirement extends Model
{
    use SoftDeletes;

    protected $table = 'wa_requirements';

    public const KINDS = ['material', 'labour', 'contract'];

    public const STATUSES = ['Planned', 'Quoted', 'Ordered', 'Issued'];

    protected $fillable = [
        'ext_id', 'company_id', 'project', 'space', 'phase', 'kind', 'code',
        'item', 'material_id', 'qty', 'unit', 'unit_cost', 'unit_sale',
        'status', 'note',
    ];

    protected $casts = [
        'qty'       => 'float',
        'unit_cost' => 'integer',
        'unit_sale' => 'integer',
    ];

    /** What it costs us. */
    public function amount(): int
    {
        return (int) round($this->qty * $this->unit_cost);
    }

    /** What the client is charged. */
    public function quote(): int
    {
        return (int) round($this->qty * $this->unit_sale);
    }

    /**
     * Already ordered or already issued is NOT demand. The rod on the Munshi
     * villa was bought and poured months ago; counting it again would send
     * somebody to buy the building twice.
     */
    public function isCommitted(): bool
    {
        return $this->status === 'Ordered' || $this->status === 'Issued';
    }
}
