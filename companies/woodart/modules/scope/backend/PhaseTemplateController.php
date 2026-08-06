<?php

namespace Epal\Modules\Woodart\Scope;

use Epal\Modules\Woodart\Scope\Http\Resources\PhaseTemplateResource;
use Epal\Modules\Woodart\Scope\Models\PhaseTemplate;
use Epal\Modules\Woodart\Scope\Services\ScopeService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Schema;

/**
 * Phase templates — read-only master data: the default phase list for a kind of
 * room. Data, not code, so adding a phase type is a row rather than a deploy.
 *
 * READ-ONLY on purpose. A template is the company's standard sequence; editing
 * it belongs to a settings screen with a person's name against the change, not
 * to whoever last opened a project.
 */
class PhaseTemplateController
{
    private const TABLE = 'wa_phase_templates';

    /** GET /api/woodart/scope/templates */
    public function index(): JsonResponse
    {
        if (! Schema::hasTable(self::TABLE)) {
            return response()->json(['success' => true, 'provisioned' => false, 'count' => 0, 'data' => []]);
        }
        $rows = PhaseTemplate::where('company_id', ScopeService::COMPANY)->orderBy('sort')->get();

        return response()->json([
            'success'     => true,
            'provisioned' => true,
            'count'       => $rows->count(),
            'data'        => PhaseTemplateResource::collection($rows),
        ]);
    }
}
