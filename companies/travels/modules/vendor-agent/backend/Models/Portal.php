<?php

namespace Epal\Modules\Travels\VendorAgent\Models;

use Illuminate\Database\Eloquent\Model;

/** Portal — a B2B portal wallet (frontend `tv_portals` store). */
class Portal extends Model
{
    protected $table = 'tv_portals';

    protected $fillable = ['ext_id', 'company_id', 'status', 'data'];

    protected $casts = ['data' => 'array'];
}
