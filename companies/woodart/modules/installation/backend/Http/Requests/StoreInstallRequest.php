<?php

namespace Epal\Modules\Woodart\Installation\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Validation for POST /api/woodart/installation/installs.
 *
 * Mirrors the frontend form schema in
 * companies/woodart/modules/installation/frontend/installation.js.
 *
 * `project` is validated as a plain string, NOT as an existing project — the
 * projects table may not be migrated on this host, and losing a real site visit
 * because its parent record vanished would destroy history. Orphans are kept
 * and flagged in the UI instead.
 */
class StoreInstallRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'id'              => ['required', 'string', 'max:40', 'regex:/^[A-Za-z0-9_-]+$/'],
            'site'            => ['required', 'string', 'max:160'],
            'project'         => ['nullable', 'string', 'max:40'],
            'team'            => ['nullable', 'string', 'max:120'],
            'status'          => ['required', Rule::in(self::STATUSES)],
            'date'            => ['nullable', 'date'],
            'snags'           => ['nullable', 'integer', 'min:0'],
            'snagList'        => ['nullable', 'array'],
            'snagList.*.text' => ['required_with:snagList', 'string', 'max:500'],
            'snagList.*.done' => ['nullable', 'boolean'],
            'created'         => ['nullable', 'date'],
        ];
    }

    public function messages(): array
    {
        return [
            'id.regex' => 'The install number may only contain letters, numbers, hyphens and underscores.',
        ];
    }

    public const STATUSES = ['Scheduled', 'In Progress', 'Snagging', 'Handover'];
}
