<?php

namespace Epal\Modules\Travels\VendorAgent\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * PortalTxn — one movement of a portal wallet (frontend `tv_portal_txns` store).
 *
 * A top-up that funded the wallet, or a booking that drew it down, with the
 * balance before and after and the id of the journal it posted. The wallet's
 * BALANCE lives on the portal record and, authoritatively, on the ledger
 * (1180-<portal>) — this is the statement, not the source of truth.
 */
class PortalTxn extends Model
{
    protected $table = 'tv_portal_txns';

    protected $fillable = ['ext_id', 'company_id', 'status', 'data'];

    protected $casts = ['data' => 'array'];
}
