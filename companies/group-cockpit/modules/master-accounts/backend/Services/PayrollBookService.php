<?php

namespace Epal\Modules\GroupCockpit\MasterAccounts\Services;

use Epal\Modules\GroupCockpit\MasterAccounts\Models\PayRun;
use Epal\Modules\GroupCockpit\MasterAccounts\Models\PaySlip;
use Epal\Modules\GroupCockpit\MasterAccounts\Models\PayTemplate;
use Epal\Modules\GroupCockpit\MasterAccounts\Models\PayTxn;
use Illuminate\Support\Str;

/**
 * PayrollBookService — one service for the four payroll stores (document-style:
 * the full frontend record round-trips in `data`, keyed by ext_id/company_id/status).
 * Upsert matches on the frontend id so a re-generated run/slip updates in place.
 */
class PayrollBookService
{
    private const MODELS = [
        'templates' => PayTemplate::class,
        'runs'      => PayRun::class,
        'slips'     => PaySlip::class,
        'txns'      => PayTxn::class,
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

        $extId = $record['id'] ?? ('PAY-' . strtoupper(Str::random(6)));
        $record['id'] = $extId;

        $row = $model::firstOrNew(['ext_id' => $extId]);
        $row->company_id = $record['companyId'] ?? null;
        $row->status     = $record['status'] ?? null;
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
