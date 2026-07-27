<?php

namespace Epal\Modules\Woodart\Procurement\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Validation for POST /api/woodart/procurement/vendors.
 *
 * Mirrors the frontend form schema in
 * companies/woodart/modules/procurement/frontend/procurement.js (editVendor).
 * Two halves of ONE contract: the client validates for a fast, friendly error;
 * the server validates because the client can be bypassed. Change one, change
 * the other, and update backend/endpoints.md.
 */
class StoreVendorRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'id'       => ['required', 'string', 'max:40', 'regex:/^[A-Za-z0-9_-]+$/'],
            'name'     => ['required', 'string', 'max:160'],
            'category' => ['required', Rule::in(self::CATEGORIES)],
            'contact'  => ['nullable', 'string', 'max:160'],
            'phone'    => ['nullable', 'string', 'max:40'],
            'email'    => ['nullable', 'email', 'max:160'],
            'area'     => ['nullable', 'string', 'max:120'],
            'terms'    => ['nullable', Rule::in(self::TERMS)],
            'since'    => ['nullable', 'date'],
            'created'  => ['nullable', 'date'],
        ];
    }

    public function messages(): array
    {
        return [
            'id.regex'      => 'The vendor code may only contain letters, numbers, hyphens and underscores.',
            'name.required' => 'A vendor name is required — purchase orders link to a vendor by name.',
        ];
    }

    /** Mirrored by the frontend seam's CATEGORIES / TERMS. */
    public const CATEGORIES = ['Board', 'Laminate', 'Hardware', 'Adhesive', 'Finish', 'Fabric', 'General'];

    public const TERMS = ['Advance', 'Net 15', 'Net 30', 'Net 45'];
}
