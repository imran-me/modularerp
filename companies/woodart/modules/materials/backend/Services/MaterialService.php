<?php

namespace Epal\Modules\Woodart\Materials\Services;

use Epal\Modules\Woodart\Materials\Models\Material;
use Illuminate\Support\Collection;

/**
 * MaterialService — ALL the business logic for Woodart materials lives here.
 * The controller is deliberately thin (house convention, owner decision D8):
 * it validates, delegates, and shapes a response. Nothing else.
 *
 * The rules this service owns:
 *   - upsert is keyed on (company_id, ext_id) — the frontend generates the id,
 *     so re-posting the same record UPDATES and never duplicates. This is what
 *     makes the SPA's optimistic writes safe to retry.
 *   - "low stock" is `stock <= reorder`, defined once, matching the frontend
 *     seam's Materials.isLow(). Two implementations of one rule is a bug
 *     waiting to happen, so if you change one, change the other.
 *   - deletes are soft: a material that was bought and consumed is history, not
 *     a mistake, and the group's books may still reference it.
 */
class MaterialService
{
    public function __construct(private string $companyId = 'woodart') {}

    /** Every material for the company, A→Z by name (the register's order). */
    public function list(): Collection
    {
        return Material::query()
            ->where('company_id', $this->companyId)
            ->orderBy('name')
            ->get();
    }

    /** Only what needs buying, worst shortfall first — the Reorder tab. */
    public function belowReorder(): Collection
    {
        return Material::query()
            ->where('company_id', $this->companyId)
            ->whereColumn('stock', '<=', 'reorder')
            ->orderByRaw('(reorder - stock) DESC')
            ->get();
    }

    /** Stock value grouped by category, largest first — the Valuation tab. */
    public function valuation(): Collection
    {
        return $this->list()
            ->groupBy('category')
            ->map(fn (Collection $rows, string $category) => [
                'name'  => $category,
                'items' => $rows->count(),
                'units' => (int) $rows->sum('stock'),
                'value' => (int) $rows->sum(fn (Material $m) => $m->value()),
            ])
            ->sortByDesc('value')
            ->values();
    }

    /** The header figures. One calculation server side, mirroring the seam. */
    public function summary(): array
    {
        $rows = $this->list();
        $value = (int) $rows->sum(fn (Material $m) => $m->value());

        return [
            'items'      => $rows->count(),
            'value'      => $value,
            'low'        => $rows->filter(fn (Material $m) => $m->isLow())->count(),
            'dead'       => $rows->where('stock', 0)->count(),
            'categories' => $rows->pluck('category')->filter()->unique()->count(),
            'suppliers'  => $rows->pluck('supplier')->filter()->unique()->count(),
            'avg'        => $rows->count() ? (int) round($value / $rows->count()) : 0,
        ];
    }

    /**
     * Create or update, keyed on the frontend id. Returns the saved model.
     * `$data` arrives already validated by StoreMaterialRequest, in the
     * frontend's camelCase shape — this method is the only translation point.
     */
    public function upsert(array $data): Material
    {
        $material = Material::withTrashed()->firstOrNew([
            'company_id' => $this->companyId,
            'ext_id'     => $data['id'],
        ]);

        $material->fill([
            'company_id' => $this->companyId,
            'ext_id'     => $data['id'],
            'name'       => trim($data['name']),
            'category'   => $data['category'],
            'unit'       => $data['unit'],
            'stock'      => (int) $data['stock'],
            'reorder'    => (int) $data['reorder'],
            'unit_cost'  => (int) $data['unitCost'],
            'supplier'   => isset($data['supplier']) ? trim($data['supplier']) : null,
            'created_on' => $data['created'] ?? $material->created_on ?? now()->toDateString(),
        ]);

        // Re-posting a soft-deleted code revives it rather than failing on the
        // unique index — the user's intent is "this material exists again".
        if ($material->trashed()) {
            $material->deleted_at = null;
        }

        $material->save();

        return $material;
    }

    /** Soft delete by frontend id. Silent when it is already gone (idempotent). */
    public function delete(string $extId): void
    {
        Material::query()
            ->where('company_id', $this->companyId)
            ->where('ext_id', $extId)
            ->delete();
    }
}
