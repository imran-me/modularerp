<?php

namespace Epal\Modules\GroupCockpit\MasterAccounts\Services;

use Epal\Modules\GroupCockpit\MasterAccounts\Models\AccEntry;
use Illuminate\Support\Collection;
use Illuminate\Support\Str;

/**
 * AccEntryService — list + upsert + delete register entries. Upsert matches on
 * the frontend id (ext_id) so an edit updates in place and the id — and hence the
 * GL mirror (GL-ACC-<id>) — never changes across a save or a hydrate.
 */
class AccEntryService
{
    public function list(?string $companyId): Collection
    {
        return AccEntry::query()
            ->when($companyId, fn ($q) => $q->where('company_id', $companyId))
            ->orderByDesc('date')
            ->get();
    }

    public function upsert(array $data): AccEntry
    {
        $extId = $data['id'] ?? ('JV-' . strtoupper(Str::random(6)));
        $entry = AccEntry::firstOrNew(['ext_id' => $extId]);

        $entry->fill([
            'company_id'   => $data['companyId'] ?? 'group',
            'kind'         => $data['kind'] ?? 'Expense',
            'amount'       => $data['amount'] ?? 0,
            'category'     => $data['category'] ?? null,
            'sub_category' => $data['subCategory'] ?? null,
            'head'         => $data['head'] ?? null,
            'method'       => $data['method'] ?? null,
            'date'         => $data['date'] ?? null,
            'party'        => $data['party'] ?? null,
            'ref'          => $data['ref'] ?? null,
            'description'  => $data['desc'] ?? null,
            'items'        => $data['items'] ?? null,
            'alloc'        => $data['alloc'] ?? false,
            'funded_by'    => $data['fundedBy'] ?? null,
            'created'      => $data['created'] ?? null,
            // the account the money left + the GL side it credited — see the
            // 2026_07_26_002000 migration for why these are pinned per entry
            'bank_id'      => $data['bankId'] ?? null,
            'bank_name'    => $data['bankName'] ?? null,
            'pay_acct'     => $data['payAcct'] ?? null,
        ]);
        $entry->save();

        return $entry;
    }

    public function delete(string $frontendId): void
    {
        AccEntry::where('ext_id', $frontendId)->delete();
    }
}
