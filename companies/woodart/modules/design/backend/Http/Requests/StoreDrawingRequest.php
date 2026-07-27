<?php

namespace Epal\Modules\Woodart\Design\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Validation for POST /api/woodart/design/drawings.
 * Mirrors the frontend form schema in frontend/design.js (editDrawing).
 *
 * `project` is a plain string, NOT validated against the projects table — that
 * table may not be migrated here, and losing real design work because its
 * parent vanished would destroy history. Orphans are kept and flagged.
 */
class StoreDrawingRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'id'       => ['required', 'string', 'max:40', 'regex:/^[A-Za-z0-9_-]+$/'],
            'title'    => ['required', 'string', 'max:200'],
            'kind'     => ['required', Rule::in(self::KINDS)],
            'project'  => ['nullable', 'string', 'max:40'],
            'designer' => ['nullable', 'string', 'max:160'],
            'rev'      => ['nullable', 'string', 'regex:/^[A-Z]$/'],
            'status'   => ['required', Rule::in(self::STATUSES)],
            'issued'   => ['nullable', 'date'],
            'approved' => ['nullable', 'date'],
            'created'  => ['nullable', 'date'],
        ];
    }

    public function messages(): array
    {
        return ['rev.regex' => 'A revision is a single capital letter, A to Z.'];
    }

    public const KINDS = ['Plan', 'Elevation', 'Section', 'Detail', '3D Model', 'Render'];

    public const STATUSES = ['Draft', 'Issued', 'Commented', 'Approved'];
}
