<?php

namespace Epal\Modules\Travels\FileManagement\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * VisaFile — Eloquent model over the module-owned `tv_files` table (embassy file
 * tracking for Travels File Management). `total` = embassy_fee + service_fee,
 * kept as a stored column to match the frontend record.
 */
class VisaFile extends Model
{
    use SoftDeletes;

    protected $table = 'tv_files';

    protected $fillable = [
        'applicant', 'passport', 'country', 'agent', 'submit_date', 'decision_due',
        'embassy_status', 'embassy_fee', 'service_fee', 'total', 'pay_status', 'company_id',
    ];

    protected $casts = [
        'submit_date'  => 'date',
        'decision_due' => 'date',
        'embassy_fee'  => 'decimal:2',
        'service_fee'  => 'decimal:2',
        'total'        => 'decimal:2',
    ];
}
