<?php

namespace Epal\Modules\GroupCockpit\MasterAccounts\Services;

use Epal\Modules\GroupCockpit\MasterAccounts\Models\ExpenseCategory;
use Illuminate\Support\Collection;

/**
 * ExpenseCategoryService — list + upsert + delete expense categories. `subs` is
 * kept as a clean array of trimmed, non-empty names.
 */
class ExpenseCategoryService
{
    public function list(): Collection
    {
        return ExpenseCategory::query()->orderBy('name')->get();
    }

    public function upsert(array $data): ExpenseCategory
    {
        $id = null;
        if (! empty($data['id']) && preg_match('/(\d+)$/', $data['id'], $m)) {
            $id = (int) $m[1];
        }

        $cat = ($id && ExpenseCategory::whereKey($id)->exists())
            ? ExpenseCategory::findOrFail($id)
            : new ExpenseCategory();

        $subs = collect($data['subs'] ?? [])
            ->map(fn ($s) => trim((string) $s))
            ->filter()
            ->values()
            ->all();

        $cat->fill([
            'name'       => trim($data['name']),
            'subs'       => $subs,
            'active'     => $data['active'] ?? true,
            'company_id' => $data['companyId'] ?? null,
        ]);
        $cat->save();

        return $cat;
    }

    public function delete(string $frontendId): void
    {
        if (preg_match('/(\d+)$/', $frontendId, $m)) {
            ExpenseCategory::whereKey((int) $m[1])->delete();
        }
    }
}
