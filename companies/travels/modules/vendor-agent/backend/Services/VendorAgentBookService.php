<?php

namespace Epal\Modules\Travels\VendorAgent\Services;

use Epal\Modules\Travels\VendorAgent\Models\Agent;
use Epal\Modules\Travels\VendorAgent\Models\CommissionPaid;
use Epal\Modules\Travels\VendorAgent\Models\PartyTxn;
use Epal\Modules\Travels\VendorAgent\Models\Portal;
use Epal\Modules\Travels\VendorAgent\Models\Vendor;
use Illuminate\Support\Str;

/**
 * VendorAgentBookService — document-style service for the five Vendor & Agent
 * stores. Upsert by frontend id; the full record round-trips in `data`.
 */
class VendorAgentBookService
{
    private const MODELS = [
        'agents'      => Agent::class,
        'vendors'     => Vendor::class,
        'party-txns'  => PartyTxn::class,
        'commissions' => CommissionPaid::class,
        'portals'     => Portal::class,
    ];

    private const PREFIX = [
        'agents' => 'AG', 'vendors' => 'VN', 'party-txns' => 'PTX', 'commissions' => 'CM', 'portals' => 'PT',
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

        $extId = $record['id'] ?? ((self::PREFIX[$store] ?? 'VA') . '-' . strtoupper(Str::random(6)));
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
