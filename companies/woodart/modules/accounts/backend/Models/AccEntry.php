<?php

namespace Epal\Modules\Woodart\Accounts\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;

/**
 * AccEntry — one row of the SHARED income & expense register (`acc_entries`).
 *
 * ⚠️ THIS MODULE DOES NOT OWN THIS TABLE. `acc_entries` belongs to Master
 * Accounts and is company-scoped; Woodart is one tenant of it, exactly as
 * Travels is. That is deliberate — see backend/endpoints.md, invariant 1. A
 * private Woodart ledger would fork the group's books, which is the one thing
 * the bridge architecture exists to prevent.
 *
 * Consequences of borrowing rather than owning:
 *   - there is NO migration in this module. Nothing here creates a table.
 *   - EVERY query must be company-scoped or it reads another company's money.
 *     `scopeWoodart()` exists so that scoping is one word and hard to forget.
 *   - there is no `deleted_at` on this table, so no SoftDeletes. Voids are
 *     posted as REVERSALS (invariant 3), never as deletes — a balance never
 *     moves without a row explaining why.
 */
class AccEntry extends Model
{
    protected $table = 'acc_entries';

    /** Woodart's company scope in the shared register. */
    public const COMPANY = 'woodart';

    /** The kinds this register recognises. */
    public const INCOME  = 'Income';
    public const EXPENSE = 'Expense';

    protected $fillable = [
        'ext_id', 'company_id', 'kind', 'amount', 'category', 'sub_category',
        'head', 'method', 'bank_id', 'bank_name', 'pay_acct', 'date', 'party',
        'ref', 'description', 'items', 'alloc', 'funded_by', 'created',
    ];

    protected $casts = [
        'amount' => 'decimal:2',
        'date'   => 'date',
        'items'  => 'array',
        'alloc'  => 'boolean',
    ];

    /**
     * THE scope. Every read and write in this module goes through it.
     *
     * Written as a scope rather than a global scope on purpose: a global scope
     * would silently hide rows from anything that later reuses this model for a
     * group-wide report, and silent filtering of money is worse than a forgotten
     * `->woodart()` that shows up immediately in a total.
     */
    public function scopeWoodart(Builder $q): Builder
    {
        return $q->where('company_id', self::COMPANY);
    }

    public function isIncome(): bool
    {
        return $this->kind === self::INCOME;
    }

    /** Income adds, expense subtracts — the sign belongs to the KIND. */
    public function signedAmount(): float
    {
        return $this->isIncome() ? (float) $this->amount : -(float) $this->amount;
    }

    /**
     * A vendor settlement, i.e. a payment against a purchase order.
     *
     * Payables reads this to work out what is still owed, so the definition
     * lives here once rather than as a `where` clause repeated at each call
     * site that could drift out of step with the others.
     */
    public function isVendorPayment(): bool
    {
        return ! $this->isIncome()
            && $this->category === 'Vendor Payment'
            && ! empty($this->ref);
    }
}
