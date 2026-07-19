<?php
namespace Epal\Modules\Travels\AirTicketing;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

/**
 * Airports master — stations used to build ticket routes.
 * Real table: `airports` (id, name, code, state_id, country_id). 301 rows.
 * Frontend store 'airports' shape: { id, name, iata, city, country }.
 * `code` is the IATA code; city resolves from the linked state, country
 * from the linked country. (The frontend form also has a free-text 'state'
 * field, but it's never read back anywhere — city IS the state's name in
 * this schema; there's no separate city column. Pre-existing frontend
 * quirk, left as-is — R2, don't change behaviour.)
 *
 * index() is pure read/translate. store()/destroy() are master-data writes.
 * city/country arrive as free text (see view.js editAirport()) but the real
 * schema wants state_id/country_id FKs, both find-or-create.
 */
class AirportController
{
    private function present(object $a): array
    {
        return [
            'id'      => $a->id,
            'name'    => $a->name,
            'iata'    => $a->code,
            'city'    => $a->city ?? '',
            'country' => $a->country ?? '',
        ];
    }

    private function reload(int $id): ?object
    {
        return DB::table('airports as ap')
            ->leftJoin('states as s', 's.id', '=', 'ap.state_id')
            ->leftJoin('countries as c', 'c.id', '=', 'ap.country_id')
            ->where('ap.id', $id)
            ->first(['ap.id', 'ap.name', 'ap.code', 's.name as city', 'c.name as country']);
    }

    public function index(): JsonResponse
    {
        $rows = DB::table('airports as ap')
            ->leftJoin('states as s', 's.id', '=', 'ap.state_id')
            ->leftJoin('countries as c', 'c.id', '=', 'ap.country_id')
            ->orderBy('ap.name')
            ->get(['ap.id', 'ap.name', 'ap.code', 's.name as city', 'c.name as country']);

        return response()->json([
            'success' => true,
            'count'   => $rows->count(),
            'data'    => $rows->map(fn ($a) => $this->present($a))->values(),
        ]);
    }

    /** countries.code is NOT NULL + UNIQUE with no frontend field for it —
     *  generated from the name (first 3 letters, upper) with a numeric
     *  suffix on collision, matching the account_number-placeholder pattern
     *  used in BankController for the same kind of "required but unmodeled
     *  in the frontend" column. */
    private function countryId(?string $name): ?int
    {
        $name = trim((string) $name);
        if ($name === '') return null;
        $row = DB::table('countries')->where('name', $name)->first('id');
        if ($row) return $row->id;

        $base = strtoupper(substr(preg_replace('/[^A-Za-z]/', '', $name) ?: 'XX', 0, 3)) ?: 'XX';
        $code = $base;
        $i = 1;
        while (DB::table('countries')->where('code', $code)->exists()) {
            $code = $base . $i++;
        }

        return DB::table('countries')->insertGetId([
            'name' => $name, 'code' => $code, 'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    private function stateId(?string $name, ?int $countryId): ?int
    {
        $name = trim((string) $name);
        if ($name === '' || !$countryId) return null;
        $row = DB::table('states')->where('name', $name)->where('country_id', (string) $countryId)->first('id');
        if ($row) return $row->id;

        return DB::table('states')->insertGetId([
            'name' => $name, 'country_id' => (string) $countryId, 'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    public function store(\Illuminate\Http\Request $request): JsonResponse
    {
        $v = $request->validate([
            'id'      => 'nullable',
            'name'    => 'required|string|max:255',
            'iata'    => 'required|string|max:10',
            'city'    => 'nullable|string|max:255',
            'country' => 'nullable|string|max:255',
        ]);

        $existingId = null;
        if (!empty($v['id']) && preg_match('/(\d+)/', (string) $v['id'], $m)) {
            $n = (int) $m[1];
            if (DB::table('airports')->where('id', $n)->exists()) {
                $existingId = $n;
            }
        }

        $countryId = $this->countryId($v['country'] ?? null);
        $stateId   = $this->stateId($v['city'] ?? null, $countryId);
        // state_id/country_id are NOT NULL — an airport with no city/country
        // given still needs both; reuse (find-or-create) a shared "Unknown".
        if (!$countryId) $countryId = $this->countryId('Unknown');
        if (!$stateId)   $stateId   = $this->stateId('Unknown', $countryId);

        $row = [
            'name'       => $v['name'],
            'code'       => strtoupper($v['iata']),
            'state_id'   => $stateId,
            'country_id' => $countryId,
            'updated_at' => now(),
        ];

        if ($existingId) {
            DB::table('airports')->where('id', $existingId)->update($row);
            $id = $existingId;
        } else {
            $row['created_at'] = now();
            $id = DB::table('airports')->insertGetId($row);
        }

        return response()->json(['success' => true, 'data' => $this->present($this->reload($id))]);
    }

    public function destroy(string $id): JsonResponse
    {
        preg_match('/(\d+)/', $id, $m);
        $n = (int) ($m[1] ?? 0);
        if ($n > 0) {
            DB::table('airports')->where('id', $n)->delete();
        }

        return response()->json(['success' => true]);
    }
}
