<?php

namespace Epal\Modules\Woodart\Projects;

use Epal\Modules\Woodart\Projects\Models\Estimate;
use Epal\Modules\Woodart\Projects\Models\Project;
use Illuminate\Http\JsonResponse;
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
            ->map(fn (Project $p) => [
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
            ]);

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
            ->map(fn (Estimate $e) => [
                'id'        => $e->ext_id,
                'title'     => $e->title,
                'client'    => $e->client,
                'project'   => $e->project_ext,
                'status'    => $e->status,
                'lines'     => (array) $e->lines,
                'validTill' => $e->valid_till?->toDateString(),
                'createdOn' => $e->created_on?->toDateString(),
            ]);

        return response()->json([
            'success'     => true,
            'provisioned' => true,
            'count'       => $rows->count(),
            'data'        => $rows->values(),
        ]);
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
