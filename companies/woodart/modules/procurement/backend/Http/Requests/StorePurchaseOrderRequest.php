<?php

namespace Epal\Modules\Woodart\Procurement\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Validation for POST /api/woodart/procurement/orders.
 *
 * Mirrors the frontend form schema in
 * companies/woodart/modules/procurement/frontend/procurement.js (editOrder).
 *
 * NOTE on `supplier`: it is validated as a free string, NOT as an existing
 * vendor. That is deliberate and matches the UI — an order against a supplier
 * who is not in the vendor master still saves, and the register flags it as
 * "unlisted". Refusing it would mean a real purchase could not be recorded
 * because the paperwork is behind, which is exactly backwards: the money left
 * the business either way, and the books must be able to say so.
 */
class StorePurchaseOrderRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'id'       => ['required', 'string', 'max:40', 'regex:/^[A-Za-z0-9_-]+$/'],
            'supplier' => ['required', 'string', 'max:160'],
            'items'    => ['required', 'integer', 'min:1'],
            'amount'   => ['required', 'integer', 'min:0'],
            'status'   => ['required', Rule::in(self::STATUSES)],
            'date'     => ['nullable', 'date'],
            'created'  => ['nullable', 'date'],
        ];
    }

    public function messages(): array
    {
        return [
            'id.regex'        => 'The PO number may only contain letters, numbers, hyphens and underscores.',
            'amount.integer'  => 'Order value is a whole number of Taka — money never floats in this system.',
        ];
    }

    /** The order lifecycle. Mirrored by the frontend seam's STATUSES. */
    public const STATUSES = ['Ordered', 'Partial', 'Received'];
}
