<?php

namespace Epal\Modules\Travels\Accounts\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Validation for "Record Expense" (Travels › Accounts › Expenses).
 * Mirrors the fields the SPA's expenseEntry() form sends, one for one.
 */
class StoreExpenseRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;      // auth:sanctum is applied centrally (ModuleServiceProvider)
    }

    public function rules(): array
    {
        return [
            'id'          => 'nullable|string|max:40',              // re-post an existing voucher
            'amount'      => 'required|numeric|min:0.01',
            'head'        => 'nullable|string|max:20',              // CoA code to debit; derived from category when absent
            'category'    => 'required|string|max:255',
            'subCategory' => 'nullable|string|max:255',
            'bankId'      => 'nullable|string|max:40',              // the account the money leaves
            'method'      => 'nullable|string|in:Bank,Cash,bKash,Nagad,Debit Card,Credit Card,Cheque,Card',
            'fundedBy'    => 'nullable|string|max:50',              // another concern's purse -> inter-company loan
            'date'        => 'nullable|date',
            'party'       => 'nullable|string|max:255',
            'ref'         => 'nullable|string|max:255',
            'desc'        => 'nullable|string',
            'created'     => 'nullable|string|max:40',
        ];
    }

    public function messages(): array
    {
        return [
            'amount.min'       => 'Enter the amount that was spent.',
            'category.required' => 'Pick the account head this expense posts to.',
        ];
    }
}
