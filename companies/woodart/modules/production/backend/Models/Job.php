<?php

namespace Epal\Modules\Woodart\Production\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Job — one fabrication job on the Woodart shop floor (frontend `wa_production`).
 *
 * `ext_id` is the frontend id ('JOB-001') and the upsert key. `project` holds
 * the project's FRONTEND id, not a database foreign key (see the migration).
 */
class Job extends Model
{
    use SoftDeletes;

    protected $table = 'wa_production';

    protected $fillable = [
        'ext_id', 'company_id', 'job', 'project', 'station',
        'assigned_to', 'status', 'due', 'created_on',
    ];

    protected $casts = [
        'due'        => 'date',
        'created_on' => 'date',
    ];

    /** THE open rule, server side: anything not Done is still work.
     *  Mirrored by Workshop.isOpen() in the frontend seam. */
    public function isOpen(): bool
    {
        return $this->status !== 'Done';
    }

    /**
     * THE overdue rule: past its due date and not finished.
     *
     * `$today` is passed IN rather than read from the clock, because this app
     * runs on a fixed demo date (2026-07-05) so seeded data tells a stable
     * story. A service that silently used now() would disagree with the screen.
     */
    public function isOverdue(string $today): bool
    {
        return $this->isOpen()
            && $this->due !== null
            && $this->due->toDateString() < $today;
    }
}
