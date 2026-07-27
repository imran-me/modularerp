<?php

namespace Epal\Modules\Woodart\Projects\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Estimate — a quotation and its BOQ (frontend `wa_estimates`).
 *
 * The BOQ IS the project's budget: unit cost against unit sale, line by line.
 * `lines` is JSON because a BOQ line has no life of its own — unlike a design
 * revision, which is evidence and earns its own table.
 *
 * PARTIAL SLICE, same as Project: ROOT-MAP §6 splits `estimates` into its own
 * module at #8. Until then the table lives with the spine that owns it today.
 */
class Estimate extends Model
{
    use SoftDeletes;

    protected $table = 'wa_estimates';

    protected $fillable = [
        'ext_id', 'company_id', 'title', 'client', 'project_ext',
        'status', 'lines', 'valid_till', 'created_on',
    ];

    protected $casts = [
        'lines'      => 'array',
        'valid_till' => 'date',
        'created_on' => 'date',
    ];

    /** Quoted value — derived from the lines, so it cannot contradict them. */
    public function value(): int
    {
        return (int) collect($this->lines ?? [])
            ->sum(fn ($l) => (int) ($l['qty'] ?? 0) * (int) ($l['unitSale'] ?? 0));
    }

    /** Estimated cost — the other half of the budget. */
    public function cost(): int
    {
        return (int) collect($this->lines ?? [])
            ->sum(fn ($l) => (int) ($l['qty'] ?? 0) * (int) ($l['unitCost'] ?? 0));
    }
}
