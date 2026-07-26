<?php

namespace Epal\Modules\Travels\ContractFile\Services;

use Epal\Modules\Travels\ContractFile\Models\Contract;
use Illuminate\Support\Collection;
use Illuminate\Support\Str;

/**
 * ContractService — list + upsert-by-frontend-id + delete for tv_contracts
 * (document-style: the full record round-trips in `data`).
 */
class ContractService
{
    public function list(?string $companyId): Collection
    {
        return Contract::query()
            ->when($companyId, fn ($q) => $q->where('company_id', $companyId))
            ->orderBy('id')
            ->get()
            ->map(fn ($r) => $this->present($r));
    }

    public function upsert(array $record): array
    {
        $extId = $record['id'] ?? ('CF-' . strtoupper(Str::random(6)));
        $record['id'] = $extId;

        $row = Contract::firstOrNew(['ext_id' => $extId]);
        $row->company_id = $record['companyId'] ?? null;
        $row->status     = $record['status'] ?? null;
        $row->data       = $record;
        $row->save();

        return $this->present($row);
    }

    public function delete(string $frontendId): void
    {
        Contract::where('ext_id', $frontendId)->delete();
    }

    private function present($row): array
    {
        return array_merge((array) $row->data, ['id' => $row->ext_id]);
    }
}
