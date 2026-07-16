<?php
namespace Epal\Modules\Travels\AirTicketing;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

/**
 * Airports master — stations used to build ticket routes.
 * Real table: `airports` (id, name, code, state_id, country_id). 301 rows.
 * Frontend store 'airports' shape: { id, name, iata, city, country }.
 * `code` is the IATA code; city resolves from the linked state, country
 * from the linked country.
 */
class AirportController
{
    public function index(): JsonResponse
    {
        $rows = DB::table('airports as ap')
            ->leftJoin('states as s', 's.id', '=', 'ap.state_id')
            ->leftJoin('countries as c', 'c.id', '=', 'ap.country_id')
            ->orderBy('ap.name')
            ->get([
                'ap.id',
                'ap.name',
                'ap.code',
                's.name as city',
                'c.name as country',
            ]);

        $airports = $rows->map(function ($a) {
            return [
                'id'      => $a->id,
                'name'    => $a->name,
                'iata'    => $a->code,
                'city'    => $a->city ?? '',
                'country' => $a->country ?? '',
            ];
        })->values();

        return response()->json([
            'success' => true,
            'count'   => $airports->count(),
            'data'    => $airports,
        ]);
    }
}
