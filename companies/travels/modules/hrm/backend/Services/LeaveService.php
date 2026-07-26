<?php

namespace Epal\Modules\Travels\Hrm\Services;

use Epal\Modules\Travels\Hrm\Models\Leave;
use Illuminate\Support\Collection;
use Illuminate\Support\Str;

/** LeaveService — list + upsert-by-id + delete for tv_leaves. */
class LeaveService
{
    public function list(?string $companyId): Collection
    {
        return Leave::query()
            ->when($companyId, fn ($q) => $q->where('company_id', $companyId))
            ->orderBy('id')
            ->get()
            ->map(fn ($r) => $this->present($r));
    }

    public function upsert(array $record): array
    {
        $extId = $record['id'] ?? ('LV-' . strtoupper(Str::random(6)));
        $record['id'] = $extId;

        $row = Leave::firstOrNew(['ext_id' => $extId]);
        $row->company_id = $record['companyId'] ?? null;
        $row->status     = $record['status'] ?? null;
        $row->data       = $record;
        $row->save();

        return $this->present($row);
    }

    public function delete(string $frontendId): void
    {
        Leave::where('ext_id', $frontendId)->delete();
    }

    private function present($row): array
    {
        return array_merge((array) $row->data, ['id' => $row->ext_id]);
    }
}
