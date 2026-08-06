<?php

namespace Epal\Modules\Woodart\Scope;

use Epal\Modules\Woodart\Scope\Http\Requests\SaveRequirementsRequest;
use Epal\Modules\Woodart\Scope\Http\Resources\RequirementResource;
use Epal\Modules\Woodart\Scope\Models\Requirement;
use Epal\Modules\Woodart\Scope\Services\ScopeService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Schema;

/**
 * Requirements API — serves the frontend `wa_requirements` store, and the
 * material listing derived from it.
 *
 * The write is a PUT that REPLACES one phase's lines, because that is what the
 * editor does: it hands back the whole set. A per-line POST would need the
 * client to track deletions, which is exactly the bookkeeping a replace avoids.
 *
 * @see backend/endpoints.md — the frozen contract this implements
 */
class RequirementController
{
    private const TABLE = 'wa_requirements';

    public function __construct(private ScopeService $service) {}

    /** GET /api/woodart/scope/requirements?project=WAP-101[&phase=PHS-0014] */
    public function index(Request $request): JsonResponse
    {
        if (! Schema::hasTable(self::TABLE)) {
            return response()->json(['success' => true, 'provisioned' => false, 'count' => 0, 'data' => []]);
        }
        $rows = $this->service->requirements($request->query('project'), $request->query('phase'));

        return response()->json([
            'success'     => true,
            'provisioned' => true,
            'count'       => $rows->count(),
            'data'        => RequirementResource::collection($rows),
        ]);
    }

    /** PUT /api/woodart/scope/requirements?phase=PHS-0014 — replace the set. */
    public function replace(SaveRequirementsRequest $request): JsonResponse
    {
        if (! Schema::hasTable(self::TABLE)) {
            return response()->json([
                'success' => false,
                'message' => 'wa_requirements table not migrated yet. Run: php artisan migrate',
            ], 503);
        }
        $phase = $request->query('phase');
        if (! $phase) {
            return response()->json(['success' => false, 'message' => 'phase is required'], 422);
        }
        try {
            $rows = $this->service->saveRequirements($phase, $request->validated()['lines']);
        } catch (\InvalidArgumentException $e) {
            return response()->json(['success' => false, 'message' => $e->getMessage()], 422);
        }

        return response()->json([
            'success' => true,
            'count'   => count($rows),
            'data'    => RequirementResource::collection(collect($rows)),
        ]);
    }

    /**
     * POST /api/woodart/scope/requirements — upsert ONE line, keyed on `id`.
     *
     * This is the route the SPA's generic write path uses (platform/data/api.js
     * posts the whole record whenever a store row changes). The PUT above is the
     * batch form the phase editor's contract describes; both go through the same
     * service, so a line saved either way lands identically.
     */
    public function store(Request $request): JsonResponse
    {
        if (! Schema::hasTable(self::TABLE)) {
            return response()->json([
                'success'     => true,
                'provisioned' => false,
                'message'     => 'wa_requirements table not migrated yet. Run: php artisan migrate',
            ]);
        }

        $data = $request->all();
        $phase = $this->service->phase($data['phase'] ?? '');
        if (! $phase) {
            return response()->json(['success' => false, 'message' => 'Unknown phase'], 422);
        }

        $saved = Requirement::updateOrCreate(
            [
                'company_id' => ScopeService::COMPANY,
                'ext_id'     => $data['id'] ?? $this->service->nextExtId(Requirement::class, 'REQ', 4),
            ],
            [
                'project'     => $phase->project,     // derived, never trusted
                'space'       => $phase->space,
                'phase'       => $phase->ext_id,
                'kind'        => in_array($data['kind'] ?? '', Requirement::KINDS, true) ? $data['kind'] : 'material',
                'code'        => $data['code'] ?? $phase->code,
                'item'        => trim((string) ($data['item'] ?? '')),
                'material_id' => $data['materialId'] ?? null,
                'qty'         => (float) ($data['qty'] ?? 0),
                'unit'        => $data['unit'] ?? null,
                'unit_cost'   => (int) ($data['unitCost'] ?? 0),
                'unit_sale'   => (int) ($data['unitSale'] ?? 0),
                'status'      => in_array($data['status'] ?? '', Requirement::STATUSES, true) ? $data['status'] : 'Planned',
                'note'        => $data['note'] ?? null,
            ]
        );

        return response()->json(['success' => true, 'data' => new RequirementResource($saved)]);
    }

    /** DELETE /api/woodart/scope/requirements/{id} */
    public function destroy(string $id): JsonResponse
    {
        if (Schema::hasTable(self::TABLE)) {
            Requirement::where('company_id', ScopeService::COMPANY)->where('ext_id', $id)->delete();
        }

        return response()->json(['success' => true]);
    }

    /**
     * GET /api/woodart/scope/demand?project=WAP-101 — the material listing.
     *
     * Rolled up per ITEM across every phase on purpose: asking each phase
     * separately would order the same plywood four times.
     */
    public function demand(Request $request): JsonResponse
    {
        $project = $request->query('project');
        if (! Schema::hasTable(self::TABLE) || ! $project) {
            return response()->json(['success' => true, 'count' => 0, 'data' => []]);
        }
        $rows = $this->service->demand($project);

        return response()->json(['success' => true, 'count' => count($rows), 'data' => $rows]);
    }
}
