<?php

namespace Epal\Modules\Travels\ContractFile\Models;

use Illuminate\Database\Eloquent\Model;

/** Contract — a contract-file record (frontend `tv_contracts` store). */
class Contract extends Model
{
    protected $table = 'tv_contracts';

    protected $fillable = ['ext_id', 'company_id', 'status', 'data'];

    protected $casts = ['data' => 'array'];
}
