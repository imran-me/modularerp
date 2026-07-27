<?php

namespace Epal\Modules\Woodart\Design\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Revision — one entry in a drawing's audit trail (frontend `wa_revisions`).
 *
 * `drawing` holds the drawing's FRONTEND id, not a database key, matching the
 * loose-reference pattern the rest of Woodart inherited (R2).
 *
 * There is deliberately no `belongsTo(Drawing)` relation: it would be a lie
 * about the schema. The join lives in DesignService, in one place.
 */
class Revision extends Model
{
    use SoftDeletes;

    protected $table = 'wa_revisions';

    protected $fillable = [
        'ext_id', 'company_id', 'drawing', 'rev', 'action', 'by', 'note', 'date',
    ];

    protected $casts = ['date' => 'date'];
}
