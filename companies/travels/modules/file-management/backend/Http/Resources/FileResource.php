<?php

namespace Epal\Modules\Travels\FileManagement\Http\Resources;

use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Shapes a VisaFile model into the EXACT frontend `tv_files` store record:
 *   { id, applicant, passport, country, agent, submitDate, decisionDue,
 *     embassyStatus, embassyFee, serviceFee, total, payStatus }
 */
class FileResource extends JsonResource
{
    public function toArray($request): array
    {
        return [
            'id'            => 'FL-' . $this->id,
            'applicant'     => $this->applicant,
            'passport'      => $this->passport,
            'country'       => $this->country,
            'agent'         => $this->agent,
            'submitDate'    => optional($this->submit_date)->format('Y-m-d'),
            'decisionDue'   => optional($this->decision_due)->format('Y-m-d'),
            'embassyStatus' => $this->embassy_status,
            'embassyFee'    => (float) $this->embassy_fee,
            'serviceFee'    => (float) $this->service_fee,
            'total'         => (float) $this->total,
            'payStatus'     => $this->pay_status,
        ];
    }
}
