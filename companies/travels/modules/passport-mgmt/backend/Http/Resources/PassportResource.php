<?php

namespace Epal\Modules\Travels\PassportMgmt\Http\Resources;

use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Shapes a Passport model into the EXACT frontend `tv_passports` store record
 * the SPA reads (see passport-mgmt.js):
 *   { id, holder, passportNo, type, nationality, dob, issueDate, expiry, phone }
 * The frontend id is 'PP-<db id>' — stable + unique; the controller strips the
 * trailing digits back to the real id on write (upsert).
 */
class PassportResource extends JsonResource
{
    public function toArray($request): array
    {
        return [
            'id'          => 'PP-' . $this->id,
            'holder'      => $this->holder,
            'passportNo'  => $this->passport_no,
            'type'        => $this->type,
            'nationality' => $this->nationality,
            'dob'         => optional($this->dob)->format('Y-m-d'),
            'issueDate'   => optional($this->issue_date)->format('Y-m-d'),
            'expiry'      => optional($this->expiry)->format('Y-m-d'),
            'phone'       => $this->phone,
        ];
    }
}
