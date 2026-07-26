<?php

namespace Epal\Modules\Travels\PassportMgmt\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Passport — Eloquent model over the module-owned `tv_passports` table.
 * Dates are cast so the API Resource can format them as plain Y-m-d strings
 * (the shape the frontend `tv_passports` store expects).
 */
class Passport extends Model
{
    use SoftDeletes;

    protected $table = 'tv_passports';

    protected $fillable = [
        'holder', 'passport_no', 'type', 'nationality',
        'dob', 'issue_date', 'expiry', 'phone', 'company_id',
    ];

    protected $casts = [
        'dob'        => 'date',
        'issue_date' => 'date',
        'expiry'     => 'date',
    ];

    /** Whole months until expiry (negative = already expired, null = no date). */
    public function monthsToExpiry(): ?int
    {
        if (! $this->expiry) {
            return null;
        }

        return (int) round(now()->diffInDays($this->expiry, false) / 30.4);
    }
}
