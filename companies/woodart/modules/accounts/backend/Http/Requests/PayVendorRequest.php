<?php

namespace Epal\Modules\Woodart\Accounts\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Validation for POST /api/woodart/accounts/payables/{po}/pay.
 *
 * Deliberately does NOT check the amount against the order's outstanding
 * balance. That rule lives in EntryPostingService::payVendor(), because it has
 * to read the order and sum prior settlements to know what is owed — and a rule
 * enforced in two places drifts. Here we only reject what is malformed; there we
 * reject what is wrong.
 */
class PayVendorRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'id'     => ['nullable', 'string', 'max:40', 'regex:/^[A-Za-z0-9_-]+$/'],
            'amount' => ['required', 'numeric', 'gt:0'],
            'bankId' => ['nullable', 'string', 'max:40'],
            'method' => ['nullable', Rule::in(StoreEntryRequest::METHODS)],
            'date'   => ['required', 'date'],
            'note'   => ['nullable', 'string', 'max:500'],
        ];
    }
}
