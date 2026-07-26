<?php

namespace Epal\Modules\GroupCockpit\MasterAccounts\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StorePartyTypeRequest extends FormRequest
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
            'companyId' => 'nullable|string|max:50',
            'mapsTo'    => 'nullable|string|in:,Customer,Supplier',
        ];
    }
}
