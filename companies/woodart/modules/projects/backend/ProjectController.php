<?php

namespace Epal\Modules\Woodart\Projects;

use Epal\Modules\Woodart\Projects\Models\Estimate;
use Epal\Modules\Woodart\Projects\Models\Project;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Woodart · Projects — the portfolio HTTP seam.
 *
 * WHY THIS FILE EXISTS AT ALL, LATE:
 * The projects migration, models and seeder were written FIRST, because every
 * other Woodart seeder names a project id and those references dangled without
 * them. The HTTP layer was left for this module's own build slot — which meant
 * that after the host migration, eight projects and eight BOQs sat in MySQL with
 * no route to reach them, and the SPA correctly rendered an empty portfolio
 * (platform/data/api.js only hydrates a store whose module has a real backend).
 * Seeding a table without serving it is a half-deployment; this closes it.
 *
 * Responses are ALREADY in the frontend store shape — the controller is the
 * translation seam, so hydration is a plain write with no mapping in the client.
 *
 * `provisioned` is reported on every response so a host that has not run the
 * migration degrades to a read-only empty state instead of throwing.
 */
class ProjectController
{
    private const COMPANY = 'woodart';

    /** GET /api/woodart/projects/portfolio — the `wa_projects` store. */
    public function index(): JsonResponse
    {
        if (! Schema::hasTable('wa_projects')) {
            return $this->unprovisioned('wa_projects');
        }

        $rows = Project::query()
            ->where('company_id', self::COMPANY)
            ->orderBy('ext_id')
            ->get()
            ->map(fn (Project $p) => $this->shapeProject($p));

        return response()->json([
            'success'     => true,
            'provisioned' => true,
            'count'       => $rows->count(),
            'data'        => $rows->values(),
        ]);
    }

    /**
     * GET /api/woodart/projects/estimates — the `wa_estimates` store.
     *
     * `lines` is returned as the BOQ array the drawer already renders, not as a
     * total: the estimate IS the project's budget, line by line, and Accounts
     * reads those same lines to compute material variance. Collapsing them to a
     * number here would make that impossible downstream.
     */
    public function estimates(): JsonResponse
    {
        if (! Schema::hasTable('wa_estimates')) {
            return $this->unprovisioned('wa_estimates');
        }

        $rows = Estimate::query()
            ->where('company_id', self::COMPANY)
            ->orderBy('ext_id')
            ->get()
            ->map(fn (Estimate $e) => $this->shapeEstimate($e));

        return response()->json([
            'success'     => true,
            'provisioned' => true,
            'count'       => $rows->count(),
            'data'        => $rows->values(),
        ]);
    }

    /**
     * POST /api/woodart/projects/portfolio — register or edit a project.
     *
     * Added 2026-08-08 with `destroy` below. Until then this module was
     * read-only on purpose, which was fine while the browser only ever READ the
     * portfolio — but the moment a project could be deleted from the register
     * (owner: "make a delete option everywhere") read-only stopped being a
     * deliberate pause and became a lie: the row vanished from the screen and
     * came straight back on the next hydrate. A register you cannot write to is
     * not a register.
     *
     * Keyed on `ext_id` (WAP-101), which is what the SPA calls its id and what
     * every other Woodart table references. `updateOrCreate` makes a repeated
     * POST idempotent, so the optimistic client write and a later re-save agree.
     */
    public function store(Request $request): JsonResponse
    {
        if (! Schema::hasTable('wa_projects')) {
            return $this->unprovisioned('wa_projects');
        }

        $v = $request->validate([
            'id'        => ['required', 'string', 'max:40'],
            'name'      => ['required', 'string', 'max:200'],
            'client'    => ['nullable', 'string', 'max:160'],
            'type'      => ['nullable', 'string', 'max:40'],
            'area'      => ['nullable', 'integer', 'min:0'],
            'value'     => ['nullable', 'integer', 'min:0'],
            'cost'      => ['nullable', 'integer', 'min:0'],
            'stage'     => ['nullable', 'string', 'max:40'],
            'phase'     => ['nullable', 'string', 'max:40'],
            'progress'  => ['nullable', 'integer', 'min:0', 'max:100'],
            'designer'  => ['nullable', 'string', 'max:160'],
            'start'     => ['nullable', 'date'],
            'deadline'  => ['nullable', 'date'],
            'billed'    => ['nullable', 'boolean'],
            'createdOn' => ['nullable', 'date'],
        ]);

        $saved = Project::updateOrCreate(
            ['company_id' => self::COMPANY, 'ext_id' => $v['id']],
            [
                'name'       => $v['name'],
                'client'     => $v['client']   ?? null,
                'type'       => $v['type']     ?? 'Residential',
                'area'       => (int) ($v['area']  ?? 0),
                'value'      => (int) ($v['value'] ?? 0),
                'cost'       => (int) ($v['cost']  ?? 0),
                'stage'      => $v['stage']    ?? 'Design',
                'phase'      => $v['phase']    ?? null,
                'progress'   => (int) ($v['progress'] ?? 0),
                'designer'   => $v['designer'] ?? null,
                'start'      => $v['start']    ?? null,
                'deadline'   => $v['deadline'] ?? null,
                'billed'     => (bool) ($v['billed'] ?? false),
                'created_on' => $v['createdOn'] ?? null,
            ]
        );

        return response()->json([
            'success'     => true,
            'provisioned' => true,
            'data'        => $this->shapeProject($saved->fresh()),
        ]);
    }

    /**
     * DELETE /api/woodart/projects/portfolio/{id} — remove a project.
     *
     * SOFT delete: the model carries `SoftDeletes`, so the row leaves every read
     * (and therefore the SPA) while staying recoverable in the database. A job
     * worth ৳70,00,000 should not be one mis-click from being unrecoverable.
     *
     * WHAT THIS DOES **NOT** TOUCH, deliberately: stock movements and
     * `acc_entries`. The material really did leave the store and the money
     * really did move; the corrections for those are an Adjustment and a
     * reversal, never an erasure. Same rule the browser confirm states aloud and
     * the same rule `epal:reseed` follows.
     *
     * The rest of the job — rooms, phases, requirements, orders, order lines,
     * jobs, visits, drawings, revisions — is deleted by the browser through each
     * module's OWN endpoint as part of the same cascade, so nothing is deleted
     * here that another module is responsible for. The two exceptions are the
     * BOQ and the budget heads: they belong to this module, and budget lines
     * have no endpoint of their own at all, so a project delete is the only
     * thing that will ever clear them.
     */
    public function destroy(string $id): JsonResponse
    {
        if (! Schema::hasTable('wa_projects')) {
            return response()->json(['success' => true, 'provisioned' => false]);
        }

        DB::transaction(function () use ($id) {
            Project::query()
                ->where('company_id', self::COMPANY)->where('ext_id', $id)
                ->get()->each->delete();

            if (Schema::hasTable('wa_estimates')) {
                Estimate::query()
                    ->where('company_id', self::COMPANY)->where('project_ext', $id)
                    ->get()->each->delete();
            }
            if (Schema::hasTable('wa_budget_lines')) {
                DB::table('wa_budget_lines')
                    ->where('company_id', self::COMPANY)->where('project', $id)
                    ->delete();
            }
        });

        return response()->json(['success' => true, 'provisioned' => true]);
    }

    /** POST /api/woodart/projects/estimates — save a quotation and its BOQ. */
    public function storeEstimate(Request $request): JsonResponse
    {
        if (! Schema::hasTable('wa_estimates')) {
            return $this->unprovisioned('wa_estimates');
        }

        $v = $request->validate([
            'id'        => ['required', 'string', 'max:40'],
            'title'     => ['required', 'string', 'max:200'],
            'client'    => ['nullable', 'string', 'max:160'],
            'project'   => ['nullable', 'string', 'max:40'],
            'status'    => ['nullable', 'string', 'max:30'],
            'lines'     => ['nullable', 'array'],
            'validTill' => ['nullable', 'date'],
            'createdOn' => ['nullable', 'date'],
        ]);

        $saved = Estimate::updateOrCreate(
            ['company_id' => self::COMPANY, 'ext_id' => $v['id']],
            [
                'title'       => $v['title'],
                'client'      => $v['client']  ?? null,
                'project_ext' => $v['project'] ?? null,
                'status'      => $v['status']  ?? 'Draft',
                'lines'       => $v['lines']   ?? [],
                'valid_till'  => $v['validTill'] ?? null,
                'created_on'  => $v['createdOn'] ?? null,
            ]
        );

        return response()->json([
            'success'     => true,
            'provisioned' => true,
            'data'        => $this->shapeEstimate($saved->fresh()),
        ]);
    }

    /** DELETE /api/woodart/projects/estimates/{id} — soft delete, idempotent. */
    public function destroyEstimate(string $id): JsonResponse
    {
        if (Schema::hasTable('wa_estimates')) {
            Estimate::query()
                ->where('company_id', self::COMPANY)->where('ext_id', $id)
                ->get()->each->delete();
        }

        return response()->json(['success' => true]);
    }

    /* ---- the translation seam, one shape per store, used by read AND write -- */

    /** @return array<string,mixed> */
    private function shapeProject(Project $p): array
    {
        return [
            'id'        => $p->ext_id,
            'name'      => $p->name,
            'client'    => $p->client,
            'type'      => $p->type,
            'area'      => (int) $p->area,
            'value'     => (int) round((float) $p->value),
            'cost'      => (int) round((float) $p->cost),
            'stage'     => $p->stage,
            'phase'     => $p->phase,
            'progress'  => (int) $p->progress,
            'designer'  => $p->designer,
            'start'     => $p->start?->toDateString(),
            'deadline'  => $p->deadline?->toDateString(),
            'billed'    => (bool) $p->billed,
            'createdOn' => $p->created_on?->toDateString(),
        ];
    }

    /** @return array<string,mixed> */
    private function shapeEstimate(Estimate $e): array
    {
        return [
            'id'        => $e->ext_id,
            'title'     => $e->title,
            'client'    => $e->client,
            'project'   => $e->project_ext,
            'status'    => $e->status,
            'lines'     => (array) $e->lines,
            'validTill' => $e->valid_till?->toDateString(),
            'createdOn' => $e->created_on?->toDateString(),
        ];
    }

    /**
     * The honest 503. The store stays absent in the SPA rather than being
     * overwritten with an empty list — the exact failure mode that made seeded
     * Woodart data vanish once already.
     */
    private function unprovisioned(string $table): JsonResponse
    {
        return response()->json([
            'success'     => false,
            'provisioned' => false,
            'count'       => 0,
            'data'        => [],
            'message'     => $table . ' table not migrated yet',
        ], 503);
    }
}
