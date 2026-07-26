<?php

namespace Epal\Modules\GroupCockpit\MasterAccounts\Services;

use Epal\Modules\GroupCockpit\MasterAccounts\Models\LoanExt;
use Epal\Modules\GroupCockpit\MasterAccounts\Models\LoanProduct;
use Epal\Modules\GroupCockpit\MasterAccounts\Models\LoanTaken;
use Epal\Modules\GroupCockpit\MasterAccounts\Models\LoanTxn;
use Illuminate\Support\Str;

/**
 * LoanBookService — one service for all four loan stores (document-style: the full
 * frontend record round-trips in `data`, keyed by ext_id/company_id/status). Upsert
 * matches on the frontend id so an edit updates in place; the id never changes.
 */
class LoanBookService
{
    /** Route store segment -> Eloquent model class. */
    private const MODELS = [
        'products' => LoanProduct::class,
        'ext'      => LoanExt::class,
        'taken'    => LoanTaken::class,
        'txns'     => LoanTxn::class,
    ];

    public function modelFor(string $store): ?string
    {
        return self::MODELS[$store] ?? null;
    }

    /** All records for a store, optionally scoped to a company slug. */
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

    /** Create OR update by frontend id; returns the stored frontend record. */
    public function upsert(string $store, array $record): ?array
    {
        $model = $this->modelFor($store);
        if (! $model) {
            return null;
        }

        $extId = $record['id'] ?? ('LN-' . strtoupper(Str::random(6)));
        $record['id'] = $extId;                                   // keep the id inside the blob too

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

    /** The stored record is the frontend shape; force id = ext_id for safety. */
    private function present($row): array
    {
        return array_merge((array) $row->data, ['id' => $row->ext_id]);
    }
}
