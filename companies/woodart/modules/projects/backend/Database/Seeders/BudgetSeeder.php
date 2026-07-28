<?php

namespace Epal\Modules\Woodart\Projects\Database\Seeders;

use Epal\Modules\Woodart\Projects\Models\Estimate;
use Epal\Modules\Woodart\Projects\Models\Project;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

/**
 * PER-CODE BUDGETS, DERIVED FROM THE BOQ — plus each project's phases.
 *
 * The budget is not typed in. It is computed from the approved estimate's
 * lines, grouped by the cost code each material belongs to, so a project's
 * budget and the quotation it was won on can never disagree. That is the same
 * rule Project P&L already follows (PROJECT-PROFILE-PLAN.md §5, "derived, never
 * stored") and the opposite of what the working spreadsheet does — its summary
 * `Cost` column is a typed constant that has already drifted from its own
 * detail sheets.
 *
 * MATERIAL CATEGORY -> COST CODE is the whole mapping, and it is deliberately
 * boring: the Materials register already classifies every item (Board,
 * Laminate, Hardware, Adhesive, Finish, Fabric), so a BOQ line and a stock
 * issue land on the same code without a human deciding twice.
 *
 * A project with NO approved BOQ gets no budget rows, and that is correct — the
 * Munshi Villa sheet budgets only 6 of its 18 heads. A missing budget shows
 * actuals with no variance, never a fake 100% overrun.
 *
 * Run: php artisan db:seed --class="Epal\Modules\Woodart\Projects\Database\Seeders\BudgetSeeder"
 */
class BudgetSeeder extends Seeder
{
    /** The Materials register's own categories, mapped to cost codes. */
    private const CATEGORY_TO_CODE = [
        'Board'    => 'Boards & Ply',
        'Laminate' => 'Laminates & Veneer',
        'Hardware' => 'Hardware',
        'Adhesive' => 'Adhesives',
        'Finish'   => 'Finishes',
        'Fabric'   => 'Fabric & Foam',
    ];

    /** The phases a Woodart job runs through, in order. */
    private const PHASES = ['Design', 'Structure', 'Joinery', 'Services', 'Finishes', 'Site'];

    public function run(): void
    {
        $this->seedBudgets();
        $this->seedPhases();
    }

    private function seedBudgets(): void
    {
        // material name -> its cost code, via the register's own category
        $codeOf = [];
        if (DB::getSchemaBuilder()->hasTable('wa_materials')) {
            foreach (DB::table('wa_materials')->where('company_id', 'woodart')->get() as $m) {
                $codeOf[$m->name] = self::CATEGORY_TO_CODE[$m->category] ?? 'Other Expense';
            }
        }

        $estimates = Estimate::query()
            ->where('company_id', 'woodart')
            ->whereIn('status', ['Approved', 'Sent'])
            ->whereNotNull('project_ext')
            ->get();

        foreach ($estimates as $est) {
            $byCode = [];
            foreach ((array) $est->lines as $line) {
                $code = $codeOf[$line['item'] ?? ''] ?? 'Other Expense';
                $byCode[$code] = ($byCode[$code] ?? 0)
                    + (float) ($line['qty'] ?? 0) * (float) ($line['unitCost'] ?? 0);
            }

            foreach ($byCode as $code => $amount) {
                DB::table('wa_budget_lines')->updateOrInsert(
                    ['company_id' => 'woodart', 'project' => $est->project_ext, 'code' => $code],
                    ['budget' => (int) round($amount), 'source' => 'boq',
                     'note' => 'From ' . $est->ext_id,
                     'updated_at' => now(), 'created_at' => now()]
                );
            }
        }
    }

    /**
     * Phases per project.
     *
     * Status is DERIVED from the project's headline stage rather than invented:
     * everything before the current stage is Complete, the current one is
     * Active, everything after is Not started. So the phase strip agrees with
     * the stage badge on day one instead of contradicting it.
     *
     * Structure is skipped for projects that carry no civil work — a fit-out
     * showing an empty "Structure 0%" row would be noise, and the whole point of
     * phases-as-rows is that a project only carries the ones it has.
     */
    private function seedPhases(): void
    {
        $stageToPhase = [
            'Design' => 'Design', 'Production' => 'Joinery',
            'Installation' => 'Site', 'Handover' => 'Site', 'Completed' => 'Site',
        ];

        foreach (Project::query()->where('company_id', 'woodart')->get() as $p) {
            $current = $stageToPhase[$p->stage] ?? 'Design';
            $currentIdx = array_search($current, self::PHASES, true) ?: 0;

            foreach (self::PHASES as $i => $name) {
                // no civil work on an interiors fit-out
                if ($name === 'Structure' && $p->type !== 'Civil') {
                    continue;
                }

                $status = $i < $currentIdx ? 'Complete' : ($i === $currentIdx ? 'Active' : 'Not started');

                DB::table('wa_phases')->updateOrInsert(
                    ['company_id' => 'woodart', 'project' => $p->ext_id, 'name' => $name],
                    ['sort' => $i, 'status' => $status,
                     'start' => $i <= $currentIdx ? $p->start : null,
                     'finish' => $i < $currentIdx ? $p->start : null,
                     'updated_at' => now(), 'created_at' => now()]
                );
            }
        }
    }
}
