<?php

namespace Epal\Modules\Woodart\Accounts\Services;

use Epal\Modules\Woodart\Accounts\Models\AccEntry;
use Epal\Modules\Woodart\Materials\Models\Material;
use Epal\Modules\Woodart\Materials\Models\Movement;
use Epal\Modules\Woodart\Procurement\Models\PurchaseOrder;
use Epal\Modules\Woodart\Projects\Models\Estimate;
use Epal\Modules\Woodart\Projects\Models\Project;
use Illuminate\Support\Facades\Schema;

/**
 * The Woodart accounts desk — the ONE server-side definition of what the
 * interiors business earned, owes, and is losing on material.
 *
 * Every rule the frontend shows is computed here rather than in the browser, so
 * a report, an export and the screen can never disagree. The contract this
 * implements is frozen in backend/endpoints.md.
 *
 * `$today` is a CONSTRUCTOR ARGUMENT, never a hidden `now()` call. The app runs
 * on a fixed demo clock (2026-07-05) so seeded data tells a stable story and the
 * screenshot harness is repeatable — the same reasoning as ProductionService and
 * InstallationService. A service that secretly reads the wall clock produces a
 * different answer every day and cannot be tested.
 */
class AccountsService
{
    public function __construct(private string $today = '2026-07-05')
    {
    }

    /** Guard for every read: this module borrows tables it does not create. */
    public function provisioned(): bool
    {
        return Schema::hasTable('acc_entries');
    }

    // ---------------------------------------------------------------- register

    /**
     * The income & expense register, newest first.
     *
     * @return array{summary: array, data: array}
     */
    public function register(): array
    {
        if (! $this->provisioned()) {
            return ['summary' => $this->emptySummary(), 'data' => []];
        }

        $rows = AccEntry::query()->woodart()
            ->orderByDesc('date')->orderByDesc('id')
            ->get();

        $income  = $rows->where('kind', AccEntry::INCOME)->sum('amount');
        $expense = $rows->where('kind', AccEntry::EXPENSE)->sum('amount');
        $payable = $this->payables();

        return [
            'summary' => [
                'income'         => (int) round($income),
                'expense'        => (int) round($expense),
                'net'            => (int) round($income - $expense),
                'unpaidVendors'  => $payable['summary']['vendors'],
                'outstanding'    => $payable['summary']['outstanding'],
            ],
            'data' => $rows->all(),
        ];
    }

    // ---------------------------------------------------------------- payables

    /**
     * What Woodart still owes vendors, per purchase order.
     *
     * A payment is matched to its order by `ref` holding the PO's ext_id — the
     * same key the seeder uses, and the reason WoodartMoneySeeder was corrected
     * to point at orders that actually exist for the exact amounts they carry.
     * Matching on anything looser (vendor name, date window) would quietly pay
     * down the wrong order the first time a vendor has two open POs.
     *
     * @return array{summary: array, data: array}
     */
    public function payables(): array
    {
        if (! $this->provisioned() || ! Schema::hasTable('wa_purchases')) {
            return ['summary' => ['outstanding' => 0, 'vendors' => 0, 'oldestDays' => 0], 'data' => []];
        }

        // One query for every settlement, keyed by the PO it names — rather than
        // a per-order query inside the loop.
        $paidByPo = AccEntry::query()->woodart()
            ->where('kind', AccEntry::EXPENSE)
            ->where('category', 'Vendor Payment')
            ->whereNotNull('ref')
            ->selectRaw('ref, SUM(amount) AS paid')
            ->groupBy('ref')
            ->pluck('paid', 'ref');

        $orders = PurchaseOrder::query()
            ->where('company_id', AccEntry::COMPANY)
            ->orderBy('date')
            ->get();

        $data = [];
        $outstanding = 0;
        $vendors = [];
        $oldestDays = 0;

        foreach ($orders as $po) {
            // A cancelled order is not a liability.
            if ($po->status === 'Cancelled') {
                continue;
            }

            $ordered = (int) round((float) $po->amount);
            $paid    = (int) round((float) ($paidByPo[$po->ext_id] ?? 0));
            $due     = max(0, $ordered - $paid);
            $days    = $this->daysSince($po->date);

            if ($due > 0) {
                $outstanding += $due;
                $vendors[$po->supplier] = true;
                $oldestDays = max($oldestDays, $days);
            }

            $data[] = [
                'vendor'  => $po->supplier,
                'po'      => $po->ext_id,
                'ordered' => $ordered,
                'paid'    => $paid,
                'due'     => $due,
                'status'  => $po->status,
                'date'    => $po->date?->toDateString(),
                'days'    => $days,
            ];
        }

        // Owing money is the point of the screen — unpaid orders sort first,
        // oldest of those at the top.
        usort($data, static function ($a, $b) {
            if (($a['due'] > 0) !== ($b['due'] > 0)) {
                return $b['due'] <=> $a['due'];
            }

            return $b['days'] <=> $a['days'];
        });

        return [
            'summary' => [
                'outstanding' => $outstanding,
                'vendors'     => count($vendors),
                'oldestDays'  => $oldestDays,
            ],
            'data' => $data,
        ];
    }

    // ------------------------------------------------------------- project P&L

    /**
     * Contract value vs committed cost vs the BOQ budget, per project.
     *
     * THE REASON THIS DESK IS NOT A COPY OF TRAVELS. No other company in the
     * group has a bill of quantities, so no other company can answer "is this
     * job eating more material than we quoted for?" — which is the single number
     * this module exists to surface.
     *
     * `budget` is read from the estimate's lines rather than stored on the
     * project (invariant 5): a copied budget column drifts away from the
     * estimate it came from the first time a BOQ is revised, and then the
     * variance is quietly lying.
     *
     * @return array<int, array>
     */
    public function projectPnl(): array
    {
        if (! Schema::hasTable('wa_projects')) {
            return [];
        }

        $projects = Project::query()
            ->where('company_id', AccEntry::COMPANY)
            ->orderBy('ext_id')
            ->get();

        $billed = $this->registerTotalsByRef(AccEntry::INCOME);
        $spent  = $this->registerTotalsByRef(AccEntry::EXPENSE);
        $boq    = $this->budgetsByProject();
        $issued = $this->materialIssuedByProject();

        $out = [];

        foreach ($projects as $p) {
            $value  = (int) round((float) $p->value);
            $cost   = (int) round((float) $p->cost);
            $margin = $value - $cost;
            $budget = $boq[$p->ext_id] ?? ['cost' => 0, 'sale' => 0];
            $mat    = $issued[$p->ext_id] ?? 0;

            $out[] = [
                'project'        => $p->ext_id,
                'name'           => $p->name,
                'client'         => $p->client,
                'stage'          => $p->stage,
                'value'          => $value,
                'cost'           => $cost,
                'margin'         => $margin,
                'marginPct'      => $value > 0 ? (int) round($margin / $value * 100) : 0,
                'budget'         => $budget['cost'],
                'budgetSale'     => $budget['sale'],
                'billed'         => (int) round($billed[$p->ext_id] ?? 0),
                'spent'          => (int) round($spent[$p->ext_id] ?? 0),
                'materialIssued' => $mat,
                // NEGATIVE means the job is consuming more material than it was
                // quoted for. That is the alarm this whole module was built for.
                'variance'       => $budget['cost'] - $mat,
            ];
        }

        return $out;
    }

    // ------------------------------------------------------------------ pieces

    /** Register money summed against the project/PO id in `ref`. */
    private function registerTotalsByRef(string $kind): array
    {
        if (! $this->provisioned()) {
            return [];
        }

        return AccEntry::query()->woodart()
            ->where('kind', $kind)
            ->whereNotNull('ref')
            ->selectRaw('ref, SUM(amount) AS total')
            ->groupBy('ref')
            ->pluck('total', 'ref')
            ->all();
    }

    /**
     * Each project's approved BOQ, costed and priced.
     *
     * Only APPROVED and SENT estimates count. A draft is a guess, and budgeting
     * against a guess makes the variance meaningless.
     */
    private function budgetsByProject(): array
    {
        if (! Schema::hasTable('wa_estimates')) {
            return [];
        }

        $out = [];

        $estimates = Estimate::query()
            ->where('company_id', AccEntry::COMPANY)
            ->whereIn('status', ['Approved', 'Sent'])
            ->whereNotNull('project_ext')
            ->get();

        foreach ($estimates as $est) {
            $cost = 0;
            $sale = 0;

            foreach ((array) $est->lines as $line) {
                $qty   = (float) ($line['qty'] ?? 0);
                $cost += $qty * (float) ($line['unitCost'] ?? 0);
                $sale += $qty * (float) ($line['unitSale'] ?? 0);
            }

            $key = $est->project_ext;
            $out[$key] = [
                'cost' => (int) round(($out[$key]['cost'] ?? 0) + $cost),
                'sale' => (int) round(($out[$key]['sale'] ?? 0) + $sale),
            ];
        }

        return $out;
    }

    /**
     * The REAL cost of stock issued to each project, from the movement ledger.
     *
     * Not a guess and not a share of the total — every issue names its project
     * in `ref`, and the movement ledger is the only place that is recorded.
     * This is the dependency that made the stock ledger a prerequisite for this
     * module rather than a nice-to-have (invariant 6).
     */
    private function materialIssuedByProject(): array
    {
        if (! Schema::hasTable('wa_movements') || ! Schema::hasTable('wa_materials')) {
            return [];
        }

        $unitCost = Material::query()
            ->where('company_id', AccEntry::COMPANY)
            ->pluck('unit_cost', 'ext_id');

        $out = [];

        Movement::query()
            ->where('company_id', AccEntry::COMPANY)
            ->where('kind', 'Issue')
            ->whereNotNull('ref')
            ->get()
            ->each(function ($m) use (&$out, $unitCost) {
                // Issues are stored NEGATIVE by the stock ledger (the sign
                // belongs to the kind). Cost is a positive number.
                $qty  = abs((float) $m->qty);
                $rate = (float) ($unitCost[$m->material] ?? 0);
                $out[$m->ref] = (int) round(($out[$m->ref] ?? 0) + $qty * $rate);
            });

        return $out;
    }

    private function emptySummary(): array
    {
        return [
            'income' => 0, 'expense' => 0, 'net' => 0,
            'unpaidVendors' => 0, 'outstanding' => 0,
        ];
    }

    /** Whole days between a date and the demo clock; 0 if unknown or future. */
    private function daysSince($date): int
    {
        if (! $date) {
            return 0;
        }

        $then = strtotime(is_string($date) ? $date : $date->toDateString());
        $now  = strtotime($this->today);

        return $then && $now ? max(0, (int) floor(($now - $then) / 86400)) : 0;
    }
}
