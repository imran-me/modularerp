<?php

namespace Epal\Modules\Travels\Marketing\Models;

use Illuminate\Database\Eloquent\Model;

/** BotChat — one chat-transcript line (frontend `tv_bot_chat`). */
class BotChat extends Model
{
    protected $table = 'tv_bot_chat';

    protected $fillable = ['ext_id', 'company_id', 'status', 'data'];

    protected $casts = ['data' => 'array'];
}
