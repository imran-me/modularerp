<?php

namespace Epal\Modules\Woodart\Production\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Validation for POST /api/woodart/production/jobs.
 *
 * Mirrors the frontend form schema in
 * companies/woodart/modules/production/frontend/production.js (editJob).
 *
 * NOTE on `project`: validated as a plain string, NOT as an existing project.
 * The store holds a project EXT id and the projects table may not even be
 * migrated on this host. A job whose project has gone is kept and flagged
 * "orphan" in the register — losing the job record because its parent vanished
 * would destroy real shop-floor history.
 */
class StoreJobRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'id'         => ['required', 'string', 'max:40', 'regex:/^[A-Za-z0-9_-]+$/'],
            'job'        => ['required', 'string', 'max:160'],
            'project'    => ['nullable', 'string', 'max:40'],
            'station'    => ['required', Rule::in(self::STATIONS)],
            'assignedTo' => ['nullable', 'string', 'max:160'],
            'status'     => ['required', Rule::in(self::STATUSES)],
            'due'        => ['nullable', 'date'],
            'created'    => ['nullable', 'date'],
        ];
    }

    public function messages(): array
    {
        return [
            'id.regex' => 'The job number may only contain letters, numbers, hyphens and underscores.',
        ];
    }

    /** The shop floor's vocabulary. Mirrored by the frontend seam. */
    public const STATIONS = ['CNC', 'Cutting', 'Edge Banding', 'Assembly', 'Finishing'];

    public const STATUSES = ['Queued', 'Running', 'Blocked', 'Done'];
}
