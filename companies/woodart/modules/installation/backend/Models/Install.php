<?php

namespace Epal\Modules\Woodart\Installation\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Install — one Woodart site visit (frontend `wa_installs`).
 *
 * `project` holds the project's FRONTEND id, not a database key.
 */
class Install extends Model
{
    use SoftDeletes;

    protected $table = 'wa_installs';

    protected $fillable = [
        'ext_id', 'company_id', 'project', 'site', 'team',
        'status', 'date', 'snags', 'snag_list', 'created_on',
    ];

    protected $casts = [
        'date'       => 'date',
        'created_on' => 'date',
        'snags'      => 'integer',
        'snag_list'  => 'array',
    ];

    /** THE open rule: anything not handed over is still live work. */
    public function isOpen(): bool
    {
        return $this->status !== 'Handover';
    }

    /**
     * THE snag count — reads BOTH shapes, itemised list first.
     *
     * The seeded store has a plain number; the Projects snag modal itemises it
     * into a list of {text, done}. A record in the wild may carry either.
     * Reading only one shape would make this module disagree with the project
     * drawer for exactly the records a user has already touched — the worst
     * half of the data to be wrong about.
     */
    public function openSnags(): int
    {
        $list = $this->snag_list;

        if (is_array($list) && $list !== []) {
            return count(array_filter($list, static fn ($s) => empty($s['done'])));
        }

        return max(0, (int) $this->snags);
    }

    /**
     * Past its visit date and not handed over.
     *
     * `$today` is passed IN rather than read from the clock: this app runs on a
     * fixed demo date so seeded data tells a stable story and the screenshot
     * harness is repeatable. Same reasoning as ProductionService.
     */
    public function isOverdue(string $today): bool
    {
        return $this->isOpen()
            && $this->date !== null
            && $this->date->toDateString() < $today;
    }
}
