<?php

namespace Epal\Modules\Travels\PassportMgmt\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Validation for creating/updating a passport. Field names match the frontend
 * `tv_passports` record (camelCase); the controller/service translate to the
 * snake_case columns.
 */
class StorePassportRequest extends FormRequest
{
    public function authorize(): bool
    {
        // Route already requires auth:sanctum (ModuleServiceProvider) + the
        // controller applies company scoping; nothing extra to gate here.
        return true;
    }

    public function rules(): array
    {
        return [
            'id'          => 'nullable|string',
            'holder'      => 'required|string|max:255',
            'passportNo'  => 'required|string|max:100',
            'type'        => 'nullable|string|max:50',
            'nationality' => 'nullable|string|max:100',
            'dob'         => 'nullable|date',
            'issueDate'   => 'nullable|date',
            'expiry'      => 'nullable|date',
            'phone'       => 'nullable|string|max:50',
            'companyId'   => 'nullable|string',
        ];
    }
}
