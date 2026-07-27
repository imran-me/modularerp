<?php

namespace Epal\Modules\Woodart\Clients\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Client — one homeowner, developer or corporate Woodart builds for
 * (frontend `wa_clients`).
 *
 * `ext_id` is the frontend-generated id ('CLI-001') and the upsert key;
 * `company_id` is the frontend company slug ('woodart').
 *
 * NOTE: there is deliberately no `projects()` relation. Woodart's projects
 * reference a client by NAME, not by id, so a hasMany would be a lie about the
 * schema. The name join lives in ClientService, in one place, behind one
 * normalisation — see the blueprint.
 */
class Client extends Model
{
    use SoftDeletes;

    protected $table = 'wa_clients';

    protected $fillable = [
        'ext_id', 'company_id', 'name', 'type',
        'contact', 'phone', 'email', 'area', 'since', 'created_on',
    ];

    protected $casts = [
        'since'      => 'date',
        'created_on' => 'date',
    ];
}
