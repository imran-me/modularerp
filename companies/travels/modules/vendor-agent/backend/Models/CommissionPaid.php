<?php

namespace Epal\Modules\Travels\VendorAgent\Models;

use Illuminate\Database\Eloquent\Model;

/** CommissionPaid — a commission payout (frontend `tv_comm_paid` store). */
class CommissionPaid extends Model
{
    protected $table = 'tv_comm_paid';

    protected $fillable = ['ext_id', 'company_id', 'status', 'data'];

    protected $casts = ['data' => 'array'];
}
