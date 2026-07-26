<?php

namespace Epal\Modules\Travels\ContractFlight\Models;

use Illuminate\Database\Eloquent\Model;

/** ContractFlight — a block/charter seat contract (frontend `tv_contract_flights`). */
class ContractFlight extends Model
{
    protected $table = 'tv_contract_flights';

    protected $fillable = ['ext_id', 'company_id', 'status', 'data'];

    protected $casts = ['data' => 'array'];
}
