<?php

namespace Epal\Modules\Woodart\Materials\Http\Requests;

use Epal\Modules\Woodart\Materials\Models\Movement;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Validation for POST /api/woodart/materials/movements.
 *
 * NOTE `qty` accepts any non-zero integer, including a negative one — but the
 * SERVICE derives the final sign from the kind (Movement::signed). Validating a
 * positive-only quantity would force callers to think about sign, which is the
 * exact mistake this design removes.
 */
class StoreMovementRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'id'       => ['nullable', 'string', 'max:40', 'regex:/^[A-Za-z0-9_-]+$/'],
            'material' => ['required', 'string', 'max:40'],
            'kind'     => ['required', Rule::in(Movement::KINDS)],
            'qty'      => ['required', 'integer', 'not_in:0'],
            'location' => ['nullable', 'string', 'max:40'],
            'ref'      => ['nullable', 'string', 'max:60'],
            /* WHERE it went and WHAT bought it. Both optional: a workshop receipt
             * is not 'for' a room, and an opening balance came from no order. */
            'phase'    => ['nullable', 'string', 'max:40'],
            'space'    => ['nullable', 'string', 'max:40'],
            'order'    => ['nullable', 'string', 'max:40'],
            'note'     => ['nullable', 'string', 'max:400'],
            'by'       => ['nullable', 'string', 'max:160'],
            'date'     => ['nullable', 'date'],
        ];
    }

    public function messages(): array
    {
        return ['qty.not_in' => 'A movement of zero is not a movement.'];
    }
}
