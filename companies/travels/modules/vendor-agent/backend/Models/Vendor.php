<?php

namespace Epal\Modules\Travels\VendorAgent\Models;

use Illuminate\Database\Eloquent\Model;

/** Vendor — a vendor/supplier partner (frontend `vendors` store). */
class Vendor extends Model
{
    protected $table = 'vendors';

    protected $fillable = ['ext_id', 'company_id', 'status', 'data'];

    protected $casts = ['data' => 'array'];
}
