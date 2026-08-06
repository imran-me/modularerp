<?php

namespace Epal\Modules\Woodart\Scope\Database\Seeders;

use Epal\Modules\Woodart\Scope\Models\Phase;
use Epal\Modules\Woodart\Scope\Models\PhaseTemplate;
use Epal\Modules\Woodart\Scope\Models\Requirement;
use Epal\Modules\Woodart\Scope\Models\Space;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * THE VILLA'S BREAKDOWN — spaces, phases and what each phase needs.
 *
 * Mirrors platform/data/seed-bd.js exactly, so the API-mode screen and the
 * demo-mode screen tell the same story. A developer comparing the two should
 * never have to wonder whether a difference is a bug.
 *
 * THE REQUIREMENTS ARE NOT TYPED OUT — they are ALLOCATED from the project's
 * BOQ, read back out of `wa_estimates`. That is deliberate and it is the whole
 * integrity story: Σ requirements per cost code equals the BOQ per code equals
 * the budget per code, because they are one set of numbers cut three ways. A
 * second hand-typed table of 214 lines would drift from the quotation the first
 * time anybody edited either one.
 *
 * ORDER MATTERS: run ProjectSeeder first (it writes the project and its BOQ).
 * With no BOQ present this seeder still writes the rooms and their phases and
 * simply plans nothing — an honest degrade rather than a crash.
 *
 * Idempotent: keyed on (company_id, ext_id) via updateOrCreate.
 *
 * Run: php artisan db:seed --class="Epal\Modules\Woodart\Scope\Database\Seeders\ScopeSeeder"
 */
class ScopeSeeder extends Seeder
{
    private const COMPANY = 'woodart';

    private const PROJECT = 'WAP-101';

    /** The contract ÷ budgeted cost — the same constant the frontend seed uses. */
    private const MARKUP = 1.1492;

    public function run(): void
    {
        $this->seedTemplates();
        $this->seedSpaces();
        $this->seedPhases();
        $this->seedRequirements();
    }

    /* ====================================================================
     * TEMPLATES — the default phase list per kind of room. Data, not code.
     * ================================================================== */
    private function seedTemplates(): void
    {
        $tpl = [
            ['Bedroom',   [['Design', 'Design Fee'], ['Electrical', 'Electrical'], ['False Ceiling', 'False Ceiling'],
                ['Wood Work', 'Wood Work'], ['Colour & Paint', 'Paint'], ['Furniture', 'Boards & Ply'],
                ['Handover', 'Installation']]],
            ['Kitchen',   [['Design', 'Design Fee'], ['Civil & Breaking', 'Bricks & Breaking'], ['Plumbing', 'Sanitary'],
                ['Electrical', 'Electrical'], ['Tiles', 'Tiles Work'], ['Wood Work', 'Wood Work'],
                ['Counter & Stone', 'Metal'], ['Colour & Paint', 'Paint'], ['Appliances & Fit-out', 'Hardware'],
                ['Handover', 'Installation']]],
            ['Dining',    [['Design', 'Design Fee'], ['Electrical', 'Electrical'], ['False Ceiling', 'False Ceiling'],
                ['Wood Work', 'Wood Work'], ['Colour & Paint', 'Paint'], ['Furniture', 'Boards & Ply'],
                ['Handover', 'Installation']]],
            ['Living',    [['Design', 'Design Fee'], ['3D & Visualisation', '3D & Visualisation'], ['Electrical', 'Electrical'],
                ['False Ceiling', 'False Ceiling'], ['Wood Work', 'Wood Work'], ['Colour & Paint', 'Paint'],
                ['Furniture', 'Fabric & Foam'], ['Handover', 'Installation']]],
            ['Bath',      [['Design', 'Design Fee'], ['Civil & Breaking', 'Bricks & Breaking'], ['Plumbing', 'Sanitary'],
                ['Tiles', 'Tiles Work'], ['Electrical', 'Electrical'], ['Fittings', 'Hardware'],
                ['Handover', 'Installation']]],
            ['Balcony',   [['Design', 'Design Fee'], ['Tiles', 'Tiles Work'], ['Aluminium & Glazing', 'Aluminium'],
                ['Colour & Paint', 'Paint'], ['Handover', 'Installation']]],
            ['Office',    [['Design', 'Design Fee'], ['Electrical', 'Electrical'], ['False Ceiling', 'False Ceiling'],
                ['Wood Work', 'Wood Work'], ['Colour & Paint', 'Paint'], ['Furniture', 'Boards & Ply'],
                ['Handover', 'Installation']]],
            ['Reception', [['Design', 'Design Fee'], ['3D & Visualisation', '3D & Visualisation'], ['Electrical', 'Electrical'],
                ['False Ceiling', 'False Ceiling'], ['Wood Work', 'Wood Work'], ['Metal & Signage', 'Metal'],
                ['Colour & Paint', 'Paint'], ['Handover', 'Installation']]],
            ['Retail',    [['Design', 'Design Fee'], ['Electrical', 'Electrical'], ['False Ceiling', 'False Ceiling'],
                ['Wood Work', 'Wood Work'], ['Metal & Signage', 'Metal'], ['Colour & Paint', 'Paint'],
                ['Handover', 'Installation']]],
            ['Common',    [['Design', 'Design Fee'], ['Electrical', 'Electrical'], ['Wood Work', 'Wood Work'],
                ['Colour & Paint', 'Paint'], ['Handover', 'Installation']]],
        ];

        foreach ($tpl as $i => [$kind, $phases]) {
            PhaseTemplate::updateOrCreate(
                ['company_id' => self::COMPANY, 'ext_id' => 'TPL-'.str_pad((string) ($i + 1), 3, '0', STR_PAD_LEFT)],
                [
                    'kind'   => $kind,
                    'sort'   => $i,
                    'phases' => array_map(fn ($p) => ['name' => $p[0], 'code' => $p[1]], $phases),
                ]
            );
        }
    }

    /* ====================================================================
     * THE ROOMS — ground floor, then upper. Their areas sum to the 2,520 sft
     * on the project record, so the screen's "Area Planned" and the project's
     * own area agree.
     * ================================================================== */
    private function spaceRows(): array
    {
        return [
            // [name, kind, area sft, floor]
            ['Living Room',       'Living',  420, 'Ground'],
            ['Dining Room',       'Dining',  300, 'Ground'],
            ['Kitchen',           'Kitchen', 180, 'Ground'],
            ['Guest Bed Room',    'Bedroom', 240, 'Ground'],
            ['Guest Bath',        'Bath',     70, 'Ground'],
            ['Master Bed Room',   'Bedroom', 360, 'Upper'],
            ['Master Bath',       'Bath',     90, 'Upper'],
            ['Kids Bed Room',     'Bedroom', 260, 'Upper'],
            ['Family Lounge',     'Living',  280, 'Upper'],
            ['Staircase & Lobby', 'Common',  200, 'Upper'],
            ['Balcony — Upper',   'Balcony', 120, 'Upper'],
        ];
    }

    private function seedSpaces(): void
    {
        foreach ($this->spaceRows() as $i => [$name, $kind, $area, $floor]) {
            Space::updateOrCreate(
                ['company_id' => self::COMPANY, 'ext_id' => 'SPC-'.str_pad((string) ($i + 1), 3, '0', STR_PAD_LEFT)],
                [
                    'project'    => self::PROJECT,
                    'name'       => $name,
                    'kind'       => $kind,
                    'area'       => $area,
                    'sort'       => $i + 1,
                    'note'       => $floor.' floor',
                    'created_on' => '2026-02-27',
                ]
            );
        }
    }

    /* ====================================================================
     * THE PHASES — and where the villa actually stands (demo clock
     * 2026-07-05). The statuses are the SHEET's, not a generator's:
     * design and civil complete, electrical and plumbing running, and the
     * five heads its summary leaves empty are Not started.
     * ================================================================== */
    private const PLAN = [
        'Living'  => ['Design', 'Civil & Breaking', 'Electrical', 'Tiles', 'Wood Work', 'Colour & Paint', 'Furniture', 'Handover'],
        'Dining'  => ['Design', 'Civil & Breaking', 'Electrical', 'Tiles', 'Wood Work', 'Colour & Paint', 'Furniture', 'Handover'],
        'Bedroom' => ['Design', 'Civil & Breaking', 'Electrical', 'Tiles', 'Wood Work', 'Colour & Paint', 'Furniture', 'Handover'],
        'Kitchen' => ['Design', 'Civil & Breaking', 'Plumbing', 'Electrical', 'Tiles', 'Wood Work', 'Counter & Stone', 'Colour & Paint', 'Handover'],
        'Bath'    => ['Design', 'Civil & Breaking', 'Plumbing', 'Electrical', 'Tiles', 'Fittings', 'Colour & Paint', 'Handover'],
        'Balcony' => ['Design', 'Civil & Breaking', 'Tiles', 'Aluminium & Glazing', 'Colour & Paint', 'Handover'],
        'Common'  => ['Design', 'Civil & Breaking', 'Electrical', 'Tiles', 'MS Railing', 'Colour & Paint', 'Handover'],
    ];

    /** Every phase files under a cost code, so plan, purchase and expense agree. */
    private const CODE = [
        'Design' => '3D & Visualisation', 'Civil & Breaking' => 'Bricks & Breaking',
        'Plumbing' => 'Sanitary', 'Electrical' => 'Electrical', 'Tiles' => 'Tiles Work',
        'Wood Work' => 'Wood Work', 'Counter & Stone' => 'Metal', 'MS Railing' => 'Metal',
        'Aluminium & Glazing' => 'Aluminium', 'Fittings' => 'Sanitary',
        'Colour & Paint' => 'Paint', 'Furniture' => 'Boards & Ply', 'Handover' => 'Installation',
    ];

    /**
     * Who is responsible — the real Woodart roster:
     *   EPL-0007 Imtiaz Chowdhury · Lead Interior Designer  → the drawing board
     *   EPL-0008 Sumaiya Akter    · Production Supervisor   → the workshop
     *   EPL-0009 Jahangir Alam    · Installation Foreman    → the site
     * 'Colour & Paint' is absent on purpose: it is far enough out that nobody
     * has been put on it, which is the queue the phase board exists to shrink.
     */
    private const OWNER = [
        'Design' => 'EPL-0007',
        'Wood Work' => 'EPL-0008', 'Counter & Stone' => 'EPL-0008', 'Furniture' => 'EPL-0008',
        'Civil & Breaking' => 'EPL-0009', 'Plumbing' => 'EPL-0009', 'Electrical' => 'EPL-0009',
        'Tiles' => 'EPL-0009', 'Fittings' => 'EPL-0009', 'MS Railing' => 'EPL-0009',
        'Aluminium & Glazing' => 'EPL-0009', 'Handover' => 'EPL-0009',
    ];

    private function seedPhases(): void
    {
        $n = 0;
        foreach (Space::where('company_id', self::COMPANY)->orderBy('sort')->get() as $space) {
            $plan = self::PLAN[$space->kind] ?? self::PLAN['Common'];
            $ground = str_contains((string) $space->note, 'Ground');

            foreach ($plan as $i => $name) {
                $status = 'Not started';
                $start = null;
                $finish = null;

                if ($name === 'Design') {
                    $status = 'Complete';
                    $start = '2026-02-27';
                    $finish = '2026-03-10';
                } elseif ($name === 'Civil & Breaking') {
                    $status = 'Complete';
                    $start = '2026-03-12';
                    $finish = '2026-06-20';
                } elseif ($name === 'Electrical' && $ground) {
                    $status = 'Active';
                    $start = '2026-06-22';
                    $finish = '2026-07-31';
                } elseif ($name === 'Plumbing' && in_array($space->name, ['Kitchen', 'Master Bath'], true)) {
                    $status = 'Active';
                    $start = '2026-06-18';
                    // the kitchen's date has passed with the phase still open, so
                    // the overdue rule has one real row to report
                    $finish = $space->name === 'Kitchen' ? '2026-06-30' : '2026-07-20';
                }

                Phase::updateOrCreate(
                    ['company_id' => self::COMPANY, 'ext_id' => 'PHS-'.str_pad((string) (++$n), 4, '0', STR_PAD_LEFT)],
                    [
                        'project'  => $space->project,
                        'space'    => $space->ext_id,
                        'name'     => $name,
                        'code'     => self::CODE[$name] ?? null,
                        'sort'     => $i + 1,
                        'status'   => $status,
                        'owner_id' => self::OWNER[$name] ?? null,
                        'start'    => $start,
                        'finish'   => $finish,
                    ]
                );
            }
        }
    }

    /* ====================================================================
     * WHAT EACH PHASE NEEDS — allocated from the BOQ, never typed twice.
     * ================================================================== */

    /** Which phase carries which cost code. A code with more than one phase is
     *  shared across all of them (hardware is needed by wood work AND by the
     *  furniture that follows it). */
    private const CODE2PHASE = [
        '3D & Visualisation' => ['Design'],
        'Soil & Excavation'  => ['Civil & Breaking'],
        'Bricks & Breaking'  => ['Civil & Breaking'],
        'Cement'             => ['Civil & Breaking'],
        'Rod'                => ['Civil & Breaking'],
        'Sand & Bali'        => ['Civil & Breaking'],
        'Contractor'         => ['Civil & Breaking'],
        'Extra Labour'       => ['Civil & Breaking'],
        'Electrical'         => ['Electrical'],
        'Sanitary'           => ['Plumbing', 'Fittings'],
        'Tiles Work'         => ['Tiles'],
        'Paint'              => ['Colour & Paint'],
        'Aluminium'          => ['Aluminium & Glazing'],
        'Metal'              => ['MS Railing', 'Counter & Stone'],
        'Wood Work'          => ['Wood Work'],
        'Boards & Ply'       => ['Wood Work', 'Furniture'],
        'Laminates & Veneer' => ['Wood Work'],
        'Hardware'           => ['Wood Work', 'Furniture'],
        'Finishes'           => ['Wood Work'],
        // 'Transport & Visit' and 'Other Expense' have no phase: project
        // overheads stay in the budget and are never a room's requirement.
    ];

    /** A line's status follows its phase: done is issued, running is ordered. */
    private const REQ_STATUS = ['Complete' => 'Issued', 'Active' => 'Ordered', 'Not started' => 'Planned'];

    private function seedRequirements(): void
    {
        if (! Schema::hasTable('wa_estimates')) {
            return;   // no BOQ table on this host yet — rooms and phases still seeded
        }

        $estimate = DB::table('wa_estimates')
            ->where('company_id', self::COMPANY)
            ->where('project_ext', self::PROJECT)
            ->whereIn('status', ['Approved', 'Sent'])
            ->first();

        $lines = $estimate ? json_decode($estimate->lines ?? '[]', true) : [];
        if (! $lines) {
            return;
        }

        $phases = Phase::where('company_id', self::COMPANY)->where('project', self::PROJECT)
            ->orderBy('sort')->orderBy('ext_id')->get();
        $areaOf = Space::where('company_id', self::COMPANY)->pluck('area', 'ext_id')->all();
        $materialId = $this->materialIds();

        $n = 0;
        foreach ($lines as $line) {
            $names = self::CODE2PHASE[$line['code'] ?? ''] ?? null;
            if (! $names) {
                continue;
            }
            $hosts = $phases->filter(fn ($p) => in_array($p->name, $names, true))->values();
            if ($hosts->isEmpty()) {
                continue;
            }

            $weights = $hosts->map(fn ($p) => (int) ($areaOf[$p->space] ?? 1))->all();
            $isMaterial = ($line['kind'] ?? 'material') === 'material';
            $qty = (float) $line['qty'];
            $unitCost = (int) $line['unitCost'];

            // a material splits by QUANTITY; a lump sum has no quantity to
            // split, so its AMOUNT is split instead and each part stays "1 lot"
            $parts = $this->splitExact(
                (int) round($isMaterial ? $qty : $qty * $unitCost),
                $weights
            );

            foreach ($hosts as $i => $phase) {
                if (! $parts[$i]) {
                    continue;
                }
                $lineQty = $isMaterial ? $parts[$i] : 1;
                $lineCost = $isMaterial ? $unitCost : $parts[$i];

                Requirement::updateOrCreate(
                    ['company_id' => self::COMPANY, 'ext_id' => 'REQ-'.str_pad((string) (++$n), 4, '0', STR_PAD_LEFT)],
                    [
                        'project'     => $phase->project,
                        'space'       => $phase->space,
                        'phase'       => $phase->ext_id,
                        'kind'        => $isMaterial ? 'material' : 'contract',
                        'code'        => $line['code'],
                        'item'        => $line['item'],
                        'material_id' => $isMaterial ? ($materialId[$line['item']] ?? null) : null,
                        'qty'         => $lineQty,
                        'unit'        => $isMaterial ? ($line['unit'] ?? null) : 'lot',
                        'unit_cost'   => $lineCost,
                        'unit_sale'   => (int) round($lineCost * self::MARKUP),
                        'status'      => self::REQ_STATUS[$phase->status] ?? 'Planned',
                    ]
                );
            }
        }
    }

    /**
     * Split a whole into integer parts that sum EXACTLY back to it — largest
     * remainder. Rounding each share independently would lose or invent
     * material, and the entire point of this table is that it reconciles:
     * 37,500 bricks across eleven rooms must still be 37,500 bricks.
     *
     * The same algorithm runs in platform/data/seed-bd.js, so both sides
     * produce the same rows from the same BOQ.
     */
    private function splitExact(int $total, array $weights): array
    {
        $sum = array_sum($weights) ?: count($weights);
        $raw = array_map(fn ($w) => $total * ($w ?: 1) / $sum, $weights);
        $out = array_map('floor', $raw);
        $used = (int) array_sum($out);

        $order = [];
        foreach ($raw as $i => $v) {
            $order[] = [$v - floor($v), $i];
        }
        usort($order, fn ($a, $b) => $b[0] <=> $a[0]);

        for ($k = 0; $used < $total; $k++, $used++) {
            $out[$order[$k % count($order)][1]]++;
        }

        return array_map('intval', $out);
    }

    /** Material names → register ids, or empty if that module is not installed. */
    private function materialIds(): array
    {
        if (! Schema::hasTable('wa_materials')) {
            return [];
        }

        return DB::table('wa_materials')->where('company_id', self::COMPANY)
            ->pluck('ext_id', 'name')->all();
    }
}
