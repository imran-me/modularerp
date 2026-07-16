<?php
namespace Epal\Modules\Travels\AirTicketing;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

/**
 * Airlines master — carriers the ticketing desk buys/sells on.
 * Real table: `airlines` (id, name, status). 24 rows.
 * Frontend store 'airlines' shape: { id, name, iata, country, status }.
 * The DB carries no IATA / country columns, so IATA is best-effort parsed
 * from a "(XX)" designator embedded in the name (e.g. "Emirates (EK)"),
 * and country is left blank. `status` tinyint(1) maps to active/inactive.
 */
class AirlineController
{
    public function index(): JsonResponse
    {
        $rows = DB::table('airlines')
            ->orderBy('name')
            ->get(['id', 'name', 'status']);

        $airlines = $rows->map(function ($a) {
            // Best-effort IATA: a bracketed 2-letter code in the name.
            $iata = '';
            if (preg_match('/\(([A-Z0-9]{2,3})\)/', (string) $a->name, $m)) {
                $iata = $m[1];
            }
            return [
                'id'      => $a->id,
                'name'    => $a->name,
                'iata'    => $iata,
                'country' => '',
                'status'  => ((int) $a->status === 1) ? 'active' : 'inactive',
            ];
        })->values();

        return response()->json([
            'success' => true,
            'count'   => $airlines->count(),
            'data'    => $airlines,
        ]);
    }
}
