<?php

namespace Epal\Modules\Woodart\Procurement\Services;

use Epal\Modules\Woodart\Procurement\Models\PurchaseOrder;
use Epal\Modules\Woodart\Procurement\Models\Vendor;
use Illuminate\Support\Collection;

/**
 * ProcurementService — ALL the business logic for Woodart procurement. The two
 * controllers (orders, vendors) are thin wrappers over this one service, because
 * the interesting rules are the ones that SPAN both entities.
 *
 * THE JOIN THIS SERVICE OWNS
 * ---------------------------------------------------------------------------
 * A purchase order stores the vendor by NAME (`supplier`), not by id — that is
 * how `wa_purchases` was already built and this module does not rewrite it
 * (R2). The order→vendor join is therefore a normalised name match through ONE
 * method, `matchKey()`, mirrored by `key()` in the frontend seam.
 *
 * Rules this service owns:
 *   - OUTSTANDING is any order whose status is not 'Received'. One definition,
 *     mirrored in PurchaseOrder::isOpen() and the frontend seam;
 *   - spend is DERIVED from the orders, never stored on the vendor, so it
 *     cannot drift from the orders it came from;
 *   - an order whose supplier has NO vendor record is counted under 'Unlisted'
 *     rather than dropped. Money that left the business must always appear in
 *     the totals, even when the vendor master is incomplete — silently
 *     discarding it would make the spend analysis quietly wrong;
 *   - upserts are keyed on (company_id, ext_id); deletes are soft and a
 *     re-post revives.
 */
class ProcurementService
{
    public function __construct(private string $companyId = 'woodart') {}

    /** Normalise a vendor name for matching. Mirrored client-side. */
    public static function matchKey(?string $name): string
    {
        return mb_strtolower(trim((string) $name));
    }

    /* ------------------------------------------------------------- ORDERS */

    /** Every purchase order, newest first. */
    public function orders(): Collection
    {
        return PurchaseOrder::query()
            ->where('company_id', $this->companyId)
            ->orderByDesc('date')
            ->orderBy('ext_id')
            ->get();
    }

    public function findOrder(string $extId): ?PurchaseOrder
    {
        return PurchaseOrder::query()
            ->where('company_id', $this->companyId)
            ->where('ext_id', $extId)
            ->first();
    }

    public function upsertOrder(array $data): PurchaseOrder
    {
        $order = PurchaseOrder::withTrashed()->firstOrNew([
            'company_id' => $this->companyId,
            'ext_id'     => $data['id'],
        ]);

        $order->fill([
            'company_id' => $this->companyId,
            'ext_id'     => $data['id'],
            'supplier'   => trim($data['supplier']),
            'items'      => (int) $data['items'],
            'amount'     => (int) $data['amount'],
            'status'     => $data['status'],
            'date'       => $data['date'] ?? $order->date,
            'created_on' => $data['created'] ?? $order->created_on ?? now()->toDateString(),
        ]);

        if ($order->trashed()) {
            $order->deleted_at = null;
        }

        $order->save();

        return $order;
    }

    public function deleteOrder(string $extId): void
    {
        PurchaseOrder::query()
            ->where('company_id', $this->companyId)
            ->where('ext_id', $extId)
            ->delete();
    }

    /* ------------------------------------------------------------ VENDORS */

    /** Every vendor, A→Z by name. */
    public function vendors(): Collection
    {
        return Vendor::query()
            ->where('company_id', $this->companyId)
            ->orderBy('name')
            ->get();
    }

    public function findVendor(string $extId): ?Vendor
    {
        return Vendor::query()
            ->where('company_id', $this->companyId)
            ->where('ext_id', $extId)
            ->first();
    }

    public function upsertVendor(array $data): Vendor
    {
        $vendor = Vendor::withTrashed()->firstOrNew([
            'company_id' => $this->companyId,
            'ext_id'     => $data['id'],
        ]);

        $vendor->fill([
            'company_id' => $this->companyId,
            'ext_id'     => $data['id'],
            'name'       => trim($data['name']),
            'category'   => $data['category'],
            'contact'    => isset($data['contact']) ? trim($data['contact']) : null,
            'phone'      => isset($data['phone']) ? trim($data['phone']) : null,
            'email'      => isset($data['email']) ? trim($data['email']) : null,
            'area'       => isset($data['area']) ? trim($data['area']) : null,
            'terms'      => $data['terms'] ?? $vendor->terms,
            'since'      => $data['since'] ?? $vendor->since,
            'created_on' => $data['created'] ?? $vendor->created_on ?? now()->toDateString(),
        ]);

        if ($vendor->trashed()) {
            $vendor->deleted_at = null;
        }

        $vendor->save();

        return $vendor;
    }

    public function deleteVendor(string $extId): void
    {
        Vendor::query()
            ->where('company_id', $this->companyId)
            ->where('ext_id', $extId)
            ->delete();
    }

    /* ------------------------------------------------------- THE ROLL-UPS */

    /** Every vendor with their orders rolled up, highest spend first. */
    public function spendByVendor(): Collection
    {
        $byName = $this->ordersByVendorName();

        return $this->vendors()
            ->map(function (Vendor $v) use ($byName) {
                $agg = $byName[self::matchKey($v->name)]
                    ?? ['orders' => 0, 'items' => 0, 'value' => 0, 'received' => 0, 'outstanding' => 0, 'last' => null];

                return [
                    'id'          => $v->ext_id,
                    'name'        => $v->name,
                    'category'    => $v->category,
                    'terms'       => $v->terms ?: '',
                    'contact'     => $v->contact ?: '',
                    'area'        => $v->area ?: '',
                    'orders'      => $agg['orders'],
                    'items'       => $agg['items'],
                    'value'       => $agg['value'],
                    'received'    => $agg['received'],
                    'outstanding' => $agg['outstanding'],
                    'last'        => $agg['last'],
                ];
            })
            ->sortByDesc('value')
            ->values();
    }

    /**
     * Order value grouped by vendor CATEGORY, largest first.
     * An order whose supplier has no vendor record lands under 'Unlisted' —
     * never dropped. See the class docblock for why that matters.
     */
    public function spendByCategory(): Collection
    {
        $catOf = $this->vendors()
            ->mapWithKeys(fn (Vendor $v) => [self::matchKey($v->name) => $v->category ?: 'General'])
            ->all();

        $acc = [];
        foreach ($this->orders() as $o) {
            $cat = $catOf[self::matchKey($o->supplier)] ?? 'Unlisted';
            $acc[$cat] ??= ['name' => $cat, 'orders' => 0, 'value' => 0];
            $acc[$cat]['orders']++;
            $acc[$cat]['value'] += (int) $o->amount;
        }

        return collect(array_values($acc))->sortByDesc('value')->values();
    }

    /** The header figures. One calculation, mirroring the frontend seam. */
    public function summary(): array
    {
        $orders = $this->orders();
        $value = (int) $orders->sum('amount');
        $outstanding = (int) $orders->filter(fn (PurchaseOrder $o) => $o->isOpen())->sum('amount');
        $spend = $this->spendByVendor();
        $cats = $this->spendByCategory();

        return [
            'orders'      => $orders->count(),
            'value'       => $value,
            'received'    => $value - $outstanding,
            'outstanding' => $outstanding,
            'open'        => $orders->filter(fn (PurchaseOrder $o) => $o->isOpen())->count(),
            'vendorsUsed' => $orders->pluck('supplier')->map(fn ($n) => self::matchKey($n))->filter()->unique()->count(),
            'vendors'     => $this->vendors()->count(),
            'idle'        => $spend->where('orders', 0)->count(),
            'avg'         => $orders->count() ? (int) round($value / $orders->count()) : 0,
            'top'         => $spend->first()['name'] ?? '—',
            'topCategory' => $cats->first()['name'] ?? '—',
        ];
    }

    /* ------------------------------------------------------------------ */

    /** Orders aggregated by normalised vendor name — the join, done once. */
    private function ordersByVendorName(): array
    {
        $out = [];

        foreach ($this->orders() as $o) {
            $k = self::matchKey($o->supplier);
            if ($k === '') {
                continue;
            }
            $out[$k] ??= ['orders' => 0, 'items' => 0, 'value' => 0, 'received' => 0, 'outstanding' => 0, 'last' => null];
            $out[$k]['orders']++;
            $out[$k]['items'] += (int) $o->items;
            $out[$k]['value'] += (int) $o->amount;

            if ($o->isOpen()) {
                $out[$k]['outstanding'] += (int) $o->amount;
            } else {
                $out[$k]['received'] += (int) $o->amount;
            }

            $date = optional($o->date)->toDateString();
            if ($date && (! $out[$k]['last'] || $date > $out[$k]['last'])) {
                $out[$k]['last'] = $date;
            }
        }

        return $out;
    }
}
