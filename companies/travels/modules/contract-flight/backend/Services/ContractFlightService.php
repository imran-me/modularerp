<?php

namespace Epal\Modules\Travels\ContractFlight\Services;

use Epal\Modules\Travels\ContractFlight\Models\ContractFlight;
use Illuminate\Support\Collection;
use Illuminate\Support\Str;

/** ContractFlightService — list + upsert-by-id + delete for tv_contract_flights. */
class ContractFlightService
{
    public function list(?string $companyId): Collection
    {
        return ContractFlight::query()
            ->when($companyId, fn ($q) => $q->where('company_id', $companyId))
            ->orderBy('id')
            ->get()
            ->map(fn ($r) => $this->present($r));
    }

    public function upsert(array $record): array
    {
        $extId = $record['id'] ?? ('CFL-' . strtoupper(Str::random(6)));
        $record['id'] = $extId;

        $row = ContractFlight::firstOrNew(['ext_id' => $extId]);
        $row->company_id = $record['companyId'] ?? null;
        $row->status     = $record['status'] ?? null;
        $row->data       = $record;
        $row->save();

        return $this->present($row);
    }

    public function delete(string $frontendId): void
    {
        ContractFlight::where('ext_id', $frontendId)->delete();
    }

    private function present($row): array
    {
        return array_merge((array) $row->data, ['id' => $row->ext_id]);
    }
}
