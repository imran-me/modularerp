<?php

namespace Epal\Modules\Woodart\Accounts\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Recurring — one Woodart standing monthly cost (frontend `wa_recurring`).
 *
 * The ONLY table this module owns. Contrast with AccEntry, which is a local read
 * model over the SHARED `acc_entries`: a standing cost is not a posting, it is a
 * reminder that a posting is due, and no shared table holds that concept.
 */
class Recurring extends Model
{
    use SoftDeletes;

    protected $table = 'wa_recurring';

    public const ACTIVE = 'Active';
    public const PAUSED = 'Paused';

    protected $fillable = [
        'ext_id', 'company_id', 'name', 'category', 'amount',
        'party', 'day_of_month', 'method', 'status', 'created_on',
    ];

    protected $casts = [
        'amount'       => 'integer',
        'day_of_month' => 'integer',
        'created_on'   => 'date',
    ];

    /** Paused keeps the record and stops it counting toward the commitment. */
    public function isActive(): bool
    {
        return $this->status !== self::PAUSED;
    }

    /**
     * Still to fall due in the month containing `$today`.
     *
     * `$today` is passed IN rather than read from the clock — the same rule as
     * every other Woodart service. This app runs on a fixed demo date so seeded
     * data tells a stable story and the screenshot harness is repeatable; a
     * hidden now() would make this answer change silently on the 6th.
     */
    public function isDueThisMonth(string $today): bool
    {
        if (! $this->isActive() || ! $this->day_of_month) {
            return false;
        }

        return $this->day_of_month >= (int) substr($today, 8, 2);
    }
}
