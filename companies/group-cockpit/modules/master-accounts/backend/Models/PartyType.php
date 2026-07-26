<?php

namespace Epal\Modules\GroupCockpit\MasterAccounts\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * PartyType — a per-company party classification (frontend `party_types` store).
 * company_id holds the frontend company slug ('group', 'travels', …).
 */
class PartyType extends Model
{
    protected $table = 'party_types';

    protected $fillable = ['name', 'slug', 'company_id', 'maps_to'];
}
