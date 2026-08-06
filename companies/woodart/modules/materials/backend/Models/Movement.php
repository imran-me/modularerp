<?php

namespace Epal\Modules\Woodart\Materials\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Movement — one change to stock (frontend `wa_movements`).
 *
 * `material` and `location` hold FRONTEND ids, not database keys — the
 * inherited loose-reference pattern (R2). `qty` is SIGNED.
 *
 * There is deliberately no `belongsTo(Material)`: it would be a lie about the
 * schema. The join lives in MaterialService, in one place.
 */
class Movement extends Model
{
    use SoftDeletes;

    protected $table = 'wa_movements';

    protected $fillable = [
        'ext_id', 'company_id', 'material', 'kind', 'qty',
        'location', 'ref', 'note', 'by', 'date',
        /* WHERE it went and WHAT bought it (2026-08-06): a room, and the order a
         * delivery came in against. Both nullable — a workshop receipt is not
         * 'for' a room, and an opening balance came from no order. */
        'phase', 'space', 'order_ext',
    ];

    protected $casts = [
        'qty'  => 'integer',
        'date' => 'date',
    ];

    /** The four kinds, mirrored by the frontend seam's KINDS. */
    public const KINDS = ['Receipt', 'Issue', 'Adjustment', 'Wastage'];

    /**
     * THE SIGN BELONGS TO THE KIND, not to the caller.
     *
     * A caller passing a positive `Issue` would otherwise ADD the stock it
     * meant to consume — silently, and in the direction that hides a shortage.
     * Deriving it here makes that mistake impossible to make.
     */
    public static function signed(string $kind, $qty): int
    {
        $n = (int) abs((int) $qty);
        if ($n === 0) {
            return 0;
        }
        if ($kind === 'Receipt') {
            return $n;
        }
        if ($kind === 'Issue' || $kind === 'Wastage') {
            return -$n;
        }

        return (int) $qty;          // Adjustment keeps the caller's sign
    }
}
