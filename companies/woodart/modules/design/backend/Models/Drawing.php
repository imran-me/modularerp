<?php

namespace Epal\Modules\Woodart\Design\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Drawing — one deliverable of the architecture & 3D phase: a plan, elevation,
 * section, detail, 3D model or render (frontend `wa_drawings`).
 *
 * `project` holds the project's FRONTEND id and `designer` a person's NAME,
 * not database keys — see the migration.
 */
class Drawing extends Model
{
    use SoftDeletes;

    protected $table = 'wa_drawings';

    protected $fillable = [
        'ext_id', 'company_id', 'title', 'kind', 'project',
        'designer', 'rev', 'status', 'issued', 'approved', 'created_on',
    ];

    protected $casts = [
        'issued'     => 'date',
        'approved'   => 'date',
        'created_on' => 'date',
    ];

    /** THE open rule: anything not Approved is still design work in flight.
     *  Mirrored by Design.isOpen() in the frontend seam. */
    public function isOpen(): bool
    {
        return $this->status !== 'Approved';
    }

    /** Sitting with the CLIENT. The ONLY state where the wait is somebody
     *  else's — everything else is on us, and the queue is ordered by this. */
    public function isWaiting(): bool
    {
        return $this->status === 'Issued';
    }

    /**
     * Days it has been with the client, against the injected demo clock.
     * `$today` is passed in for the same reason as ProductionService: this app
     * runs on a fixed date, and a hidden now() would disagree with the screen.
     */
    public function waitingDays(string $today): ?int
    {
        if (! $this->isWaiting() || $this->issued === null) {
            return null;
        }

        return max(0, $this->issued->diffInDays($today, false));
    }

    /** How many times it has been revised. Rev A means none. */
    public function revCount(): int
    {
        return max(0, ord(substr((string) ($this->rev ?: 'A'), 0, 1)) - 65);
    }

    /** The next revision letter, capped at Z. */
    public function nextRev(): string
    {
        return chr(min(90, ord(substr((string) ($this->rev ?: 'A'), 0, 1)) + 1));
    }
}
