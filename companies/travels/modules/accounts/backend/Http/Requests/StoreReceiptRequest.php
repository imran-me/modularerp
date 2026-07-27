<?php

namespace Epal\Modules\Travels\Accounts\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Validation for a customer payment against a posted sale.
 * `bankId` is optional but strongly wanted: without it the receipt books to the
 * generic Bank account and no real account's balance or history moves.
 */
class StoreReceiptRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'ref'    => 'required|string|max:64',              // the sale being settled
            'amount' => 'required|numeric|min:0.01',           // partial receipts are fine
            'bankId' => 'nullable|string|max:40',              // WHICH account it landed in
            'party'  => 'nullable|string|max:255',
            'date'   => 'nullable|date',
        ];
    }

    public function messages(): array
    {
        return [
            'ref.required'    => 'Which sale is this payment for?',
            'amount.min'      => 'Enter the amount received.',
        ];
    }
}
