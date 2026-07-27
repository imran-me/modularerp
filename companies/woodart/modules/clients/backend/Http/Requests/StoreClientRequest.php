<?php

namespace Epal\Modules\Woodart\Clients\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Validation for POST /api/woodart/clients/directory.
 *
 * These rules mirror the frontend form schema in
 * companies/woodart/modules/clients/frontend/clients.js (editClient) — same
 * required fields, same segment list. They are two halves of ONE contract: the
 * client validates for a fast, friendly error; the server validates because the
 * client can be bypassed. Change one, change the other, and update
 * backend/endpoints.md — that document is what both are built from.
 */
class StoreClientRequest extends FormRequest
{
    /** The route already requires auth:sanctum (ModuleServiceProvider). */
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'id'      => ['required', 'string', 'max:40', 'regex:/^[A-Za-z0-9_-]+$/'],
            'name'    => ['required', 'string', 'max:160'],
            'type'    => ['required', Rule::in(self::TYPES)],
            'contact' => ['nullable', 'string', 'max:160'],
            'phone'   => ['nullable', 'string', 'max:40'],
            'email'   => ['nullable', 'email', 'max:160'],
            'area'    => ['nullable', 'string', 'max:120'],
            'since'   => ['nullable', 'date'],
            'created' => ['nullable', 'date'],
        ];
    }

    public function messages(): array
    {
        return [
            'id.regex' => 'The client code may only contain letters, numbers, hyphens and underscores.',
            'name.required' => 'A client name is required — projects and estimates link to a client by name.',
        ];
    }

    /** The segmentation. Mirrored by the frontend seam's TYPES and documented
     *  in backend/endpoints.md. */
    public const TYPES = ['Homeowner', 'Developer', 'Corporate', 'Retail'];
}
