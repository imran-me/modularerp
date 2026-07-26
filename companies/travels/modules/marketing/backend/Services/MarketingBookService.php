<?php

namespace Epal\Modules\Travels\Marketing\Services;

use Epal\Modules\Travels\Marketing\Models\BotBooking;
use Epal\Modules\Travels\Marketing\Models\BotChat;
use Epal\Modules\Travels\Marketing\Models\Campaign;
use Epal\Modules\Travels\Marketing\Models\Message;
use Epal\Modules\Travels\Marketing\Models\MsgTemplate;
use Illuminate\Support\Str;

/**
 * MarketingBookService — one service for the five marketing stores (document-style:
 * the full frontend record round-trips in `data`, keyed by ext_id/company_id/status).
 * Upsert by frontend id; records without an id (chat lines) get a generated one.
 */
class MarketingBookService
{
    private const MODELS = [
        'campaigns' => Campaign::class,
        'templates' => MsgTemplate::class,
        'messages'  => Message::class,
        'bookings'  => BotBooking::class,
        'chat'      => BotChat::class,
    ];

    private const PREFIX = [
        'campaigns' => 'CMP', 'templates' => 'TPL', 'messages' => 'MSG', 'bookings' => 'BK', 'chat' => 'CH',
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

        $extId = $record['id'] ?? ((self::PREFIX[$store] ?? 'MK') . '-' . strtoupper(Str::random(6)));
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
