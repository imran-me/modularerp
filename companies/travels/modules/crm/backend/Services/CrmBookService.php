<?php

namespace Epal\Modules\Travels\Crm\Services;

use Epal\Modules\Travels\Crm\Models\CrmActivity;
use Epal\Modules\Travels\Crm\Models\Lead;
use Illuminate\Support\Str;

/**
 * CrmBookService — document-style service for the two CRM stores (leads /
 * activities). Upsert by frontend id; the full record round-trips in `data`.
 */
class CrmBookService
{
    private const MODELS = ['leads' => Lead::class, 'activities' => CrmActivity::class];
    private const PREFIX = ['leads' => 'LEAD', 'activities' => 'ACT'];

    public function modelFor(string $store): ?string
    {
        return self::MODELS[$store] ?? null;
    }

    public function list(string $store, ?string $companyId): array
    {
        $model = $this->modelFor($store);
        if (! $model) {
            return [];
        }

        return $model::query()
            ->when($companyId, fn ($q) => $q->where('company_id', $companyId))
            ->orderBy('id')
            ->get()
            ->map(fn ($r) => $this->present($r))
            ->all();
    }

    public function upsert(string $store, array $record): ?array
    {
        $model = $this->modelFor($store);
        if (! $model) {
            return null;
        }

        $extId = $record['id'] ?? ((self::PREFIX[$store] ?? 'CRM') . '-' . strtoupper(Str::random(6)));
        $record['id'] = $extId;

        $row = $model::firstOrNew(['ext_id' => $extId]);
        $row->company_id = $record['companyId'] ?? null;
        $row->status     = $record['status'] ?? ($record['stage'] ?? null);
        $row->data       = $record;
        $row->save();

        return $this->present($row);
    }

    public function delete(string $store, string $frontendId): void
    {
        $model = $this->modelFor($store);
        if ($model) {
            $model::where('ext_id', $frontendId)->delete();
        }
    }

    private function present($row): array
    {
        return array_merge((array) $row->data, ['id' => $row->ext_id]);
    }
}
