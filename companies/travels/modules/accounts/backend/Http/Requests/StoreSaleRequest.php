<?php

namespace Epal\Modules\Travels\Accounts\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Validation for recording a sale (ticket · visa · EMD · contract seats).
 * Mirrors the payload every selling module hands to db.postSale() on the client.
 */
class StoreSaleRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;      // auth:sanctum is applied centrally (ModuleServiceProvider)
    }

    public function rules(): array
    {
        return [
            'ref'           => 'required|string|max:64',      // the selling module's own id
            'amount'        => 'required|numeric',            // may be NEGATIVE: a void/refund
            'cost'          => 'nullable|numeric',            // ditto
            'vat'           => 'nullable|numeric|min:0',      // the VAT part OF amount
            'incomeAccount' => 'nullable|string|max:20',
            'category'      => 'nullable|string|max:120',     // maps to a head when no code given
            'customer'      => 'nullable|string|max:255',
            'vendor'        => 'nullable|string|max:255',
            'isAgent'       => 'nullable|boolean',            // sub-agent → 1150, not 1200
            'paid'          => 'nullable|boolean',
            'payStatus'     => 'nullable|string|in:Paid,Partial,Due,Pending,Confirm',
            'bankId'        => 'nullable|string|max:40',      // where the payment landed
            'costPaid'      => 'nullable|boolean',
            'costBankId'    => 'nullable|string|max:40',      // where the vendor was paid from
            'date'          => 'nullable|date',
            'desc'          => 'nullable|string',
        ];
    }

    public function messages(): array
    {
        return [
            'ref.required'    => 'A sale needs its module reference (ticket / visa / EMD id).',
            'amount.required' => 'What is the sale amount?',
        ];
    }
}
