<?php

namespace Epal\Modules\GroupCockpit\MasterAccounts\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreAccEntryRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'id'          => 'nullable|string',
            'companyId'   => 'nullable|string|max:50',
            'kind'        => 'nullable|string|in:Income,Expense',
            'amount'      => 'required|numeric',
            'category'    => 'nullable|string|max:255',
            'subCategory' => 'nullable|string|max:255',
            'head'        => 'nullable|string|max:50',
            'method'      => 'nullable|string|max:50',
            'date'        => 'nullable|date',
            'party'       => 'nullable|string|max:255',
            'ref'         => 'nullable|string|max:255',
            'desc'        => 'nullable|string',
            'items'       => 'nullable|array',
            'alloc'       => 'nullable|boolean',
            'fundedBy'    => 'nullable|string|max:50',
            'created'     => 'nullable|string|max:40',
        ];
    }
}
