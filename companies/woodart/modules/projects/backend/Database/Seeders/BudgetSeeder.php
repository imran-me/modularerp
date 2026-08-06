<?php

namespace Epal\Modules\Woodart\Projects\Database\Seeders;

use Epal\Modules\Woodart\Projects\Models\Estimate;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

/**
 * PER-CODE BUDGETS, DERIVED FROM THE BOQ.
 *
 * The budget is not typed in. It is a roll-up of the approved estimate's lines
 * by the cost code each line already carries, so a project's budget and the
 * quotation it was won on cannot disagree — they are the same rows added up two
 * ways. That is the rule Project P&L follows (PROJECT-PROFILE-PLAN.md §5,
 * "derived, never stored") and the opposite of what the working spreadsheet
 * does: its summary `Cost` column is a typed constant that has already drifted
 * from its own detail sheets.
 *
 * ⚠️ TWO THINGS CHANGED ON 2026-08-06, both worth knowing:
 *
 * 1. THE CODE COMES FROM THE LINE, not from a material-category lookup. Every
 *    BOQ line now carries its own `code` (see ProjectSeeder::WORK), which is
 *    the only way a line for labour or a rajmistri contract — neither of which
 *    is a material — can be budgeted at all. The old CATEGORY_TO_CODE map filed
 *    all of those under "Other Expense".
 *
 * 2. THIS SEEDER NO LONGER WRITES PHASES. `wa_phases` moved down a level: a
 *    phase belongs to a SPACE now, and the scope module owns it
 *    (ScopeSeeder). Leaving the old project-level writer here would have two
 *    seeders fighting over one table, and the loser would be whichever ran
 *    second.
 *
 * A project with NO approved BOQ gets no budget rows, and that is correct — a
 * missing budget shows actuals with no variance, never a fake 100% overrun.
 *
 * Run: php artisan db:seed --class="Epal\Modules\Woodart\Projects\Database\Seeders\BudgetSeeder"
 */
class BudgetSeeder extends Seeder
{
    private const COMPANY = 'woodart';

    public function run(): void
    {
        if (! DB::getSchemaBuilder()->hasTable('wa_budget_lines')) {
            return;
        }

        $estimates = Estimate::query()
            ->where('company_id', self::COMPANY)
            ->whereIn('status', ['Approved', 'Sent'])
            ->whereNotNull('project_ext')
            ->get();

        foreach ($estimates as $est) {
            $byCode = [];
            foreach ((array) $est->lines as $line) {
                $code = $line['code'] ?? 'Other Expense';
                $byCode[$code] = ($byCode[$code] ?? 0)
                    + (float) ($line['qty'] ?? 0) * (float) ($line['unitCost'] ?? 0);
            }

            foreach ($byCode as $code => $amount) {
                DB::table('wa_budget_lines')->updateOrInsert(
                    ['company_id' => self::COMPANY, 'project' => $est->project_ext, 'code' => $code],
                    [
                        'budget'     => (int) round($amount),
                        'source'     => 'boq',
                        'note'       => 'From '.$est->ext_id,
                        'updated_at' => now(),
                        'created_at' => now(),
                    ]
                );
            }
        }
    }
}
