<?php

namespace Epal\Modules\Travels\Marketing\Models;

use Illuminate\Database\Eloquent\Model;

/** BotBooking — a bot-captured booking (frontend `tv_bot_bookings`). */
class BotBooking extends Model
{
    protected $table = 'tv_bot_bookings';

    protected $fillable = ['ext_id', 'company_id', 'status', 'data'];

    protected $casts = ['data' => 'array'];
}
