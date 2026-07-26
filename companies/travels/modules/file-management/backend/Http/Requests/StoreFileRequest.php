<?php

namespace Epal\Modules\Travels\FileManagement\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Validation for creating/updating a visa file. Field names match the frontend
 * `tv_files` record (camelCase); the service translates to snake_case columns.
 */
class StoreFileRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'id'            => 'nullable|string',
            'applicant'     => 'required|string|max:255',
            'passport'      => 'nullable|string|max:100',
            'country'       => 'nullable|string|max:100',
            'agent'         => 'nullable|string|max:255',
            'submitDate'    => 'nullable|date',
            'decisionDue'   => 'nullable|date',
            'embassyStatus' => 'nullable|string|max:50',
            'embassyFee'    => 'nullable|numeric|min:0',
            'serviceFee'    => 'nullable|numeric|min:0',
            'total'         => 'nullable|numeric|min:0',
            'payStatus'     => 'nullable|string|max:50',
            'companyId'     => 'nullable|string',
        ];
    }
}
