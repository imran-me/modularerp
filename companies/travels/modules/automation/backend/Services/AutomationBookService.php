<?php

namespace Epal\Modules\Travels\Automation\Services;

use Epal\Modules\Travels\Automation\Models\AutomationRule;
use Epal\Modules\Travels\Automation\Models\MarkupRule;
use Illuminate\Support\Str;

/**
 * AutomationBookService — document-style service for the two automation stores
 * (rules / markup). Upsert by frontend id; the full record round-trips in `data`.
 */
class AutomationBookService
{
    private const MODELS = [
        'rules'  => AutomationRule::class,
        'markup' => MarkupRule::class,
    ];

    private const PREFIX = ['rules' => 'AUTO', 'markup' => 'MKP'];

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

        $extId = $record['id'] ?? ((self::PREFIX[$store] ?? 'AT') . '-' . strtoupper(Str::random(6)));
        $record['id'] = $extId;

        $row = $model::firstOrNew(['ext_id' => $extId]);
        $row->company_id = $record['companyId'] ?? null;
        $row->status     = $record['status'] ?? (isset($record['active']) ? ($record['active'] ? 'active' : 'inactive') : null);
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
