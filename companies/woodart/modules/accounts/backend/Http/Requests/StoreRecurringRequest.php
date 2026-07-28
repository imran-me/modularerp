<?php

namespace Epal\Modules\Woodart\Accounts\Http\Requests;

use Epal\Modules\Woodart\Accounts\Models\Recurring;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Validation for POST /api/woodart/accounts/recurring.
 *
 * Mirrors the frontend form schema in
 * companies/woodart/modules/accounts/frontend/accounts.js.
 *
 * `dayOfMonth` accepts 1–31 and is NOT clamped to the month's real length. The
 * field means "the 31st, whenever that exists"; silently rewriting it to 28 or
 * 30 would move a bill the user did not move.
 */
class StoreRecurringRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'id'         => ['nullable', 'string', 'max:40', 'regex:/^[A-Za-z0-9_-]+$/'],
            'name'       => ['required', 'string', 'max:200'],
            'category'   => ['nullable', 'string', 'max:120'],
            'amount'     => ['required', 'numeric', 'gt:0'],
            'party'      => ['nullable', 'string', 'max:160'],
            'dayOfMonth' => ['nullable', 'integer', 'min:1', 'max:31'],
            'method'     => ['nullable', Rule::in(StoreEntryRequest::METHODS)],
            'status'     => ['nullable', Rule::in([Recurring::ACTIVE, Recurring::PAUSED])],
            'created'    => ['nullable', 'date'],
        ];
    }

    public function messages(): array
    {
        return [
            'id.regex'  => 'The reference may only contain letters, numbers, hyphens and underscores.',
            'amount.gt' => 'A standing cost must be worth more than zero.',
        ];
    }
}
