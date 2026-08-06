<?php

namespace Epal\Modules\Woodart\Scope\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Phase — a stage of work INSIDE ONE SPACE (frontend `wa_phases`).
 *
 * Design → Electrical → Wood Work → Colour & Paint → Furniture → Handover, per
 * room, each with one person responsible (`owner_id` → employees.ext_id).
 *
 * The rules below are the SAME rules the frontend seam applies
 * (companies/woodart/modules/scope/frontend/api.js). Change one, change the
 * other — a rule with two implementations is a rule with two answers.
 */
class Phase extends Model
{
    use SoftDeletes;

    protected $table = 'wa_phases';

    protected $fillable = [
        'ext_id', 'company_id', 'project', 'space', 'name', 'code',
        'sort', 'status', 'owner_id', 'start', 'finish', 'note',
    ];

    protected $casts = [
        'sort'   => 'integer',
        'start'  => 'date',
        'finish' => 'date',
    ];

    /** THE open rule: a phase is open until it is Complete. */
    public function isOpen(): bool
    {
        return $this->status !== 'Complete';
    }

    /**
     * THE overdue rule. `$today` is INJECTED, never now(): the server must not
     * disagree with the screen about what "overdue" means, and the demo clock
     * is 2026-07-05.
     */
    public function isOverdue(string $today): bool
    {
        return $this->isOpen()
            && $this->finish !== null
            && $this->finish->toDateString() < $today;
    }

    /** Nobody is responsible yet — the queue the phase board exists to shrink. */
    public function isUnassigned(): bool
    {
        return $this->owner_id === null || $this->owner_id === '';
    }

    /** This phase's requirement lines. */
    public function requirements()
    {
        return Requirement::where('company_id', $this->company_id)
            ->where('phase', $this->ext_id)
            ->orderBy('id');
    }
}
