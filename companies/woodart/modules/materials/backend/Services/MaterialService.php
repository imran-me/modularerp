<?php

namespace Epal\Modules\Woodart\Materials\Services;

use Epal\Modules\Woodart\Materials\Models\Material;
use Epal\Modules\Woodart\Materials\Models\Movement;
use Epal\Modules\Woodart\Materials\Models\StockLocation;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

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

    /**
     * Soft delete by frontend id, TAKING ITS MOVEMENT HISTORY WITH IT. Silent
     * when it is already gone (idempotent).
     *
     * The ledger goes because a ledger for a material nobody can look at is
     * orphaned evidence — the rule the frontend seam has always stated. It is
     * cascaded HERE, in one transaction, rather than as one HTTP DELETE per
     * movement from the browser: that per-row shape is what took the host past
     * its connection cap on 2026-08-08 and answered a project delete with a wall
     * of "Operation not permitted".
     *
     * This is the one place stock movements are removed at all, and only ever
     * with the material they describe. Deleting a movement on its own would
     * silently change a stock level; the correction for that is an Adjustment.
     */
    public function delete(string $extId): void
    {
        DB::transaction(function () use ($extId) {
            if (Schema::hasTable('wa_movements')) {
                Movement::query()
                    ->where('company_id', $this->companyId)
                    ->where('material', $extId)
                    ->delete();
            }

            Material::query()
                ->where('company_id', $this->companyId)
                ->where('ext_id', $extId)
                ->delete();
        });
    }

    /* ======================================================================
     * THE STOCK LEDGER  (server half, 2026-07-27)
     * ----------------------------------------------------------------------
     * Stock used to be a bare number here too. It now moves only through
     * applyMovement(), which writes the movement row and updates the material's
     * stock column inside ONE database transaction — atomicity the browser
     * cannot offer, and the reason the server is the authority once it exists.
     * ==================================================================== */

    /** Every movement, newest first. */
    public function movements(): Collection
    {
        return Movement::query()
            ->where('company_id', $this->companyId)
            ->orderByDesc('date')
            ->orderByDesc('ext_id')
            ->get();
    }

    /** One material's history — the answer to "why is it only 26?". */
    public function historyOf(string $materialExtId): Collection
    {
        return Movement::query()
            ->where('company_id', $this->companyId)
            ->where('material', $materialExtId)
            ->orderByDesc('date')->orderByDesc('ext_id')
            ->get();
    }

    public function locations(): Collection
    {
        return StockLocation::query()
            ->where('company_id', $this->companyId)
            ->orderByDesc('primary')->orderBy('name')
            ->get();
    }

    public function defaultLocation(): ?string
    {
        return $this->locations()->first()?->ext_id;
    }

    /**
     * APPLY A MOVEMENT — the only sanctioned way stock changes.
     *
     * The row and the balance are written in ONE transaction: either both land
     * or neither does. That is the guarantee the whole ledger rests on, and it
     * is why reconcile() can be trusted rather than merely hoped for.
     *
     * The sign is derived from the KIND (Movement::signed), never taken from the
     * caller. Returns null when the material is unknown or the quantity resolves
     * to zero — a movement of nothing is not a movement.
     */
    public function applyMovement(array $data): ?Movement
    {
        $material = Material::query()
            ->where('company_id', $this->companyId)
            ->where('ext_id', $data['material'])
            ->first();

        if (! $material) {
            return null;
        }

        $kind = $data['kind'];
        $qty = Movement::signed($kind, $data['qty']);
        if ($qty === 0) {
            return null;
        }

        return DB::transaction(function () use ($data, $material, $kind, $qty) {
            $movement = Movement::create([
                'company_id' => $this->companyId,
                'ext_id'     => $data['id'] ?? $this->nextMovementId(),
                'material'   => $material->ext_id,
                'kind'       => $kind,
                'qty'        => $qty,
                'location'   => $data['location'] ?? $this->defaultLocation(),
                'ref'        => $data['ref'] ?? null,
                /* WHERE it went and WHAT bought it. `space` is DERIVED from the
                 * phase rather than trusted from the client, so a movement can
                 * never claim to be for a room its phase is not in. */
                'phase'      => $data['phase'] ?? null,
                'space'      => $this->spaceOfPhase($data['phase'] ?? null) ?? ($data['space'] ?? null),
                'order_ext'  => $data['order'] ?? null,
                'note'       => $data['note'] ?? null,
                'by'         => $data['by'] ?? 'System',
                'date'       => $data['date'] ?? now()->toDateString(),
            ]);

            $material->stock = (int) $material->stock + $qty;
            $material->save();

            return $movement;
        });
    }

    /**
     * The room a phase belongs to — read straight from wa_phases, so a movement
     * cannot be filed under a room its phase is not in.
     *
     * Cross-module read through DB::table with a hasTable guard, never through
     * the scope module's model: deleting that folder must leave stock working
     * with an empty answer rather than a 500. Drop-in/drop-out is the whole
     * architecture (see ModuleServiceProvider).
     */
    /**
     * The room a phase belongs to — read straight from `wa_phases`, so a
     * movement can never be filed under a room its phase is not in.
     *
     * A cross-module read through DB::table with a hasTable guard, never through
     * the scope module's model: deleting that folder must leave stock working
     * with an honest empty answer rather than a 500. Drop-in/drop-out is the
     * whole architecture (see ModuleServiceProvider).
     */
    private function spaceOfPhase(?string $phaseExtId): ?string
    {
        if (! $phaseExtId || ! Schema::hasTable('wa_phases')) {
            return null;
        }
        $row = DB::table('wa_phases')
            ->where('company_id', $this->companyId)
            ->where('ext_id', $phaseExtId)
            ->first(['space']);

        return $row->space ?? null;
    }

    /** Stock per location for one material, derived from its movements. */
    public function byLocation(string $materialExtId): Collection
    {
        return $this->historyOf($materialExtId)
            ->groupBy(fn (Movement $m) => $m->location ?: 'unassigned')
            ->map(fn (Collection $rows, string $loc) => [
                'location' => $loc,
                'qty'      => (int) $rows->sum('qty'),
            ])
            ->sortByDesc('qty')
            ->values();
    }

    /** Every location with what it holds — the warehouse view. */
    public function locationTotals(): Collection
    {
        $cost = $this->list()->mapWithKeys(fn (Material $m) => [$m->ext_id => (int) $m->unit_cost]);
        $qty = [];
        $val = [];

        foreach ($this->movements() as $mv) {
            $k = $mv->location ?: 'unassigned';
            $qty[$k] = ($qty[$k] ?? 0) + (int) $mv->qty;
            $val[$k] = ($val[$k] ?? 0) + (int) $mv->qty * ($cost[$mv->material] ?? 0);
        }

        return $this->locations()
            ->map(fn (StockLocation $l) => [
                'id'    => $l->ext_id,
                'name'  => $l->name,
                'kind'  => $l->kind,
                'area'  => $l->area ?: '',
                'qty'   => $qty[$l->ext_id] ?? 0,
                'value' => $val[$l->ext_id] ?? 0,
            ])
            ->sortByDesc('value')
            ->values();
    }

    /**
     * THE INVARIANT: for every material, the sum of its movements equals its
     * stored stock. Returns ONLY the rows that disagree — an empty collection is
     * the healthy state. A balance you cannot prove is a balance you cannot
     * trust, which is the entire reason this ledger exists.
     *
     * Degrades to empty when the movements table is not migrated, so a partially
     * migrated host does not report false drift on every single material.
     */
    public function reconcile(): Collection
    {
        if (! Schema::hasTable('wa_movements')) {
            return collect();
        }

        $net = Movement::query()
            ->where('company_id', $this->companyId)
            ->selectRaw('material, SUM(qty) AS moved')
            ->groupBy('material')
            ->pluck('moved', 'material');

        return $this->list()
            ->map(fn (Material $m) => [
                'id'    => $m->ext_id,
                'name'  => $m->name,
                'stock' => (int) $m->stock,
                'moved' => (int) ($net[$m->ext_id] ?? 0),
                'drift' => (int) $m->stock - (int) ($net[$m->ext_id] ?? 0),
            ])
            ->filter(fn (array $r) => $r['drift'] !== 0)
            ->values();
    }

    /** The movement screen's header figures. */
    public function movementSummary(): array
    {
        $all = $this->movements();

        return [
            'movements' => $all->count(),
            'received'  => (int) $all->where('kind', 'Receipt')->sum('qty'),
            'issued'    => (int) abs($all->where('kind', 'Issue')->sum('qty')),
            'wasted'    => (int) abs($all->where('kind', 'Wastage')->sum('qty')),
            'adjusted'  => (int) $all->where('kind', 'Adjustment')->sum('qty'),
            'locations' => $this->locations()->count(),
            'lastDate'  => optional($all->first())->date?->toDateString(),
        ];
    }

    private function nextMovementId(): string
    {
        $max = 0;
        foreach (Movement::withTrashed()->where('company_id', $this->companyId)->pluck('ext_id') as $id) {
            if (preg_match('/(\d+)$/', (string) $id, $m)) {
                $max = max($max, (int) $m[1]);
            }
        }

        return 'MOV-'.str_pad((string) ($max + 1), 4, '0', STR_PAD_LEFT);
    }
}
