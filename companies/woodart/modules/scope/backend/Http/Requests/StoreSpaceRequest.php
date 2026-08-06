<?php

namespace Epal\Modules\Woodart\Scope\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * The field schema the SPA's Add Space form mirrors one-for-one. Kept in step
 * with frontend/scope.js `editSpace` — if a rule differs, the form lets
 * something through that the API then rejects, which reads as a broken save.
 */
class StoreSpaceRequest extends FormRequest
{
    public const KINDS = ['Bedroom', 'Kitchen', 'Dining', 'Living', 'Bath', 'Balcony',
        'Office', 'Reception', 'Retail', 'Common'];

    public function authorize(): bool
    {
        return true;   // auth:sanctum is applied centrally by ModuleServiceProvider
    }

    public function rules(): array
    {
        return [
            'id'      => ['nullable', 'string', 'max:40'],
            'project' => ['required', 'string', 'max:40'],
            'name'    => ['required', 'string', 'max:120'],
            'kind'    => ['required', Rule::in(self::KINDS)],
            'area'    => ['nullable', 'integer', 'min:0'],
            'sort'    => ['nullable', 'integer', 'min:1'],
            'note'    => ['nullable', 'string'],
            'created' => ['nullable', 'date'],
        ];
    }
}
