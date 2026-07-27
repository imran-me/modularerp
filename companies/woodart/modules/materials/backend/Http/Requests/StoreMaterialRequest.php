<?php

namespace Epal\Modules\Woodart\Materials\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Validation for POST /api/woodart/materials/stock.
 *
 * These rules mirror the frontend form schema in
 * companies/woodart/modules/materials/frontend/materials.js (editMaterial) —
 * same required fields, same option lists, same minimums. They are two halves
 * of ONE contract: the client validates for a fast, friendly error; the server
 * validates because the client can be bypassed. Change one, change the other,
 * and update backend/endpoints.md — that document is what both are built from.
 */
class StoreMaterialRequest extends FormRequest
{
    /** The route already requires auth:sanctum (ModuleServiceProvider). */
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
            'unit'     => ['required', Rule::in(self::UNITS)],
            'stock'    => ['required', 'integer', 'min:0'],
            'reorder'  => ['required', 'integer', 'min:0'],
            'unitCost' => ['required', 'integer', 'min:0'],
            'supplier' => ['nullable', 'string', 'max:160'],
            'created'  => ['nullable', 'date'],
        ];
    }

    public function messages(): array
    {
        return [
            'id.regex'       => 'The material code may only contain letters, numbers, hyphens and underscores.',
            'unitCost.integer' => 'Unit cost is a whole number of Taka — money never floats in this system.',
        ];
    }

    /** The taxonomy. Kept beside the rules that enforce it; documented in
     *  backend/endpoints.md and mirrored by the frontend seam's CATEGORIES/UNITS. */
    public const CATEGORIES = ['Board', 'Laminate', 'Hardware', 'Adhesive', 'Finish', 'Fabric'];

    public const UNITS = ['pcs', 'sheet', 'kg', 'litre', 'sft'];
}
