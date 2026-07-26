<?php

namespace Epal\Modules\Travels\VendorAgent\Models;

use Illuminate\Database\Eloquent\Model;

/** PartyTxn — a party ledger movement (frontend `party_txns` store). */
class PartyTxn extends Model
{
    protected $table = 'party_txns';

    protected $fillable = ['ext_id', 'company_id', 'status', 'data'];

    protected $casts = ['data' => 'array'];
}
