<?php

namespace Epal\Modules\Travels\Accounts\Services;

use Epal\Modules\Travels\Accounts\Models\TvCheque;
use Epal\Modules\Travels\Accounts\Models\TvPetty;
use Epal\Modules\Travels\Accounts\Models\TvRecurring;
use Illuminate\Support\Str;

/**
 * AccountsBookService — one service for the three Travels-Accounts stores
 * (recurring / cheques / petty). Document-style: the full frontend record
 * round-trips in `data`, keyed by ext_id/company_id/status. Upsert by frontend id.
 */
class AccountsBookService
{
    private const MODELS = [
        'recurring' => TvRecurring::class,
        'cheques'   => TvCheque::class,
        'petty'     => TvPetty::class,
    ];

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

        $prefix = ['recurring' => 'REC', 'cheques' => 'CHQ', 'petty' => 'PC'][$store] ?? 'ACC';
        $extId = $record['id'] ?? ($prefix . '-' . strtoupper(Str::random(6)));
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
