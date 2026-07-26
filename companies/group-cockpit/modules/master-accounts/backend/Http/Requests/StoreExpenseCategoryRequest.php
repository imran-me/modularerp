<?php

namespace Epal\Modules\GroupCockpit\MasterAccounts\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreExpenseCategoryRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'id'        => 'nullable|string',
            'name'      => 'required|string|max:100',
            'subs'      => 'nullable|array',
            'subs.*'    => 'string|max:100',
            'active'    => 'nullable|boolean',
            'companyId' => 'nullable|string|max:50',
        ];
    }
}
