<?php

namespace Epal\Modules\Woodart\Scope\Http\Requests;

use Epal\Modules\Woodart\Scope\Models\Requirement;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * The whole line set for one phase — the editor always sends the complete list,
 * because that is what "replace" means. An empty `lines` array is valid and
 * clears the phase.
 */
class SaveRequirementsRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'lines'             => ['present', 'array'],
            'lines.*.kind'      => ['required', Rule::in(Requirement::KINDS)],
            'lines.*.item'      => ['required', 'string', 'max:200'],
            'lines.*.qty'       => ['required', 'numeric', 'min:0'],
            'lines.*.unit'      => ['nullable', 'string', 'max:30'],
            'lines.*.unitCost'  => ['nullable', 'integer', 'min:0'],
            'lines.*.unitSale'  => ['nullable', 'integer', 'min:0'],
            'lines.*.code'      => ['nullable', 'string', 'max:60'],
            'lines.*.status'    => ['nullable', Rule::in(Requirement::STATUSES)],
            'lines.*.note'      => ['nullable', 'string'],
        ];
    }
}
