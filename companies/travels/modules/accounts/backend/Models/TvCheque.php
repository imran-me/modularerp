<?php

namespace Epal\Modules\Travels\Accounts\Models;

use Illuminate\Database\Eloquent\Model;

/** TvCheque — a cheque register entry (frontend `tv_cheques` store). */
class TvCheque extends Model
{
    protected $table = 'tv_cheques';

    protected $fillable = ['ext_id', 'company_id', 'status', 'data'];

    protected $casts = ['data' => 'array'];
}
