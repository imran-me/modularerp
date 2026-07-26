<?php

namespace Epal\Modules\Travels\Settings\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Validates a settings save. The payload is a flexible key/value blob (the tab's
 * fields), so we accept an object under `data` (or the raw body) and only bound
 * its size — the frontend forms already constrain the individual field types.
 */
class SaveSettingsRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'data' => 'nullable|array',
        ];
    }

    /** The patch to merge = the `data` object, or the whole body minus control keys. */
    public function patch(): array
    {
        if (is_array($this->input('data'))) {
            return $this->input('data');
        }

        return collect($this->except(['data', '_token', 'id']))
            ->filter(fn ($v) => ! is_null($v))
            ->all();
    }
}
