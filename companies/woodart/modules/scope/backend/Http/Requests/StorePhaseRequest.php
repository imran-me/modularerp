<?php

namespace Epal\Modules\Woodart\Scope\Http\Requests;

use Epal\Modules\Woodart\Scope\Models\Phase;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * A phase is validated against its SPACE, never against a project: `project` is
 * derived server-side, so it is deliberately absent from these rules. A client
 * that sends one is ignored rather than trusted.
 */
class StorePhaseRequest extends FormRequest
{
    public const STATUSES = ['Not started', 'Active', 'Complete'];

    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'id'      => ['nullable', 'string', 'max:40'],
            'space'   => ['required', 'string', 'max:40'],
            'name'    => ['required', 'string', 'max:120'],
            'code'    => ['nullable', 'string', 'max:60'],
            'sort'    => ['nullable', 'integer', 'min:1'],
            'status'  => ['required', Rule::in(self::STATUSES)],
            'ownerId' => ['nullable', 'string', 'max:40'],
            'start'   => ['nullable', 'date'],
            'finish'  => ['nullable', 'date'],
            'note'    => ['nullable', 'string'],
        ];
    }
}
