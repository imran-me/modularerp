<?php

namespace Epal\Modules\GroupCockpit\MasterAccounts\Services;

use Epal\Modules\GroupCockpit\MasterAccounts\Models\AccEntry;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

/**
 * AccEntryService — list + upsert + delete register entries. Upsert matches on
 * the frontend id (ext_id) so an edit updates in place and the id — and hence the
 * GL mirror (GL-ACC-<id>) — never changes across a save or a hydrate.
 *
 * FORWARD-COMPATIBLE WRITES: the payment-source columns (bank_id / bank_name /
 * pay_acct, migration 2026_07_26_002000) are written ONLY when they exist. A host
 * that has pulled the new code but not yet run `php artisan migrate` would
 * otherwise get an "unknown column" SQL error on every save — the client rolls
 * the optimistic row back and the user sees "Save failed" on a working feature.
 * Degrade, never break: the entry saves without them, and the moment the
 * migration runs they start persisting.
 */
class AccEntryService
{
    /** Which of the payment-source columns this database actually has. Cached on
     *  the INSTANCE (not static) so a process that migrates mid-run sees truth. */
    private ?array $paymentCols = null;

    private function paymentColumns(): array
    {
        if ($this->paymentCols === null) {
            $this->paymentCols = [];
            foreach (['bank_id' => 'bankId', 'bank_name' => 'bankName', 'pay_acct' => 'payAcct'] as $col => $key) {
                try {
                    if (Schema::hasColumn('acc_entries', $col)) {
                        $this->paymentCols[$col] = $key;
                    }
                } catch (\Throwable $e) {
                    // table missing / introspection denied — treat as absent
                }
            }
        }

        return $this->paymentCols;
    }

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

        $payment = [];
        foreach ($this->paymentColumns() as $col => $key) {
            $payment[$col] = $data[$key] ?? null;
        }

        $entry->fill($payment + [
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
            // bank_id / bank_name / pay_acct (the account the money left + the GL
            // side it credited) are merged in above, but ONLY when the database
            // has them — see paymentColumns().
        ]);
        $entry->save();

        return $entry;
    }

    public function delete(string $frontendId): void
    {
        AccEntry::where('ext_id', $frontendId)->delete();
    }
}
