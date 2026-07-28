<?php

namespace Epal\Modules\Woodart\Accounts\Http\Requests;

use Epal\Modules\Woodart\Accounts\Models\AccEntry;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Validation for POST /api/woodart/accounts/register.
 *
 * Mirrors the frontend form schema in
 * companies/woodart/modules/accounts/frontend/accounts.js.
 *
 * `ref` is a free string, not an existing project or purchase order. The
 * projects table may not be migrated on a given host, and refusing to record
 * real money because its parent record is missing would be the wrong trade:
 * the money happened. Orphaned refs are kept and flagged in the UI, exactly as
 * Installation does with a missing project.
 *
 * `amount` is validated as a positive number and stored as integer Taka (D10).
 * Zero is rejected: an entry that moves nothing is not a transaction, and it
 * would appear in the register as noise a user cannot explain.
 */
class StoreEntryRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'id'          => ['nullable', 'string', 'max:40', 'regex:/^[A-Za-z0-9_-]+$/'],
            'kind'        => ['required', Rule::in([AccEntry::INCOME, AccEntry::EXPENSE])],
            'category'    => ['required', 'string', 'max:120'],
            'description' => ['nullable', 'string', 'max:500'],
            'amount'      => ['required', 'numeric', 'gt:0'],
            'method'      => ['required', Rule::in(self::METHODS)],
            'date'        => ['required', 'date'],
            'ref'         => ['nullable', 'string', 'max:40'],
            'party'       => ['nullable', 'string', 'max:160'],
            'bankId'      => ['nullable', 'string', 'max:40'],
            'fundedBy'    => ['nullable', 'string', 'max:40'],
        ];
    }

    public function messages(): array
    {
        return [
            'id.regex'    => 'The voucher number may only contain letters, numbers, hyphens and underscores.',
            'amount.gt'   => 'An entry must move a non-zero amount.',
        ];
    }

    /** The payment methods the kernel posting services recognise. */
    public const METHODS = ['Bank', 'Cash', 'bKash', 'Nagad', 'Debit Card', 'Credit Card', 'Cheque'];
}
