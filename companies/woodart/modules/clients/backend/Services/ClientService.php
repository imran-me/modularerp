<?php

namespace Epal\Modules\Woodart\Clients\Services;

use Epal\Modules\Woodart\Clients\Models\Client;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * ClientService — ALL the business logic for Woodart clients lives here. The
 * controller is deliberately thin (house convention, owner decision D8).
 *
 * THE JOIN THIS SERVICE OWNS
 * ---------------------------------------------------------------------------
 * Woodart's projects and estimates reference a client by NAME, not by id —
 * that is how `wa_projects` / `wa_estimates` were built and this module does
 * not get to rewrite them. So the client→work join is a name match, normalised
 * through ONE method, `matchKey()`. The frontend seam normalises identically.
 * If this ever becomes a real foreign key, this class is the only place that
 * changes on the server.
 *
 * Rules this service owns:
 *   - upsert is keyed on (company_id, ext_id), so a retried client write can
 *     never duplicate a row;
 *   - a client's VALUE is always DERIVED from their projects and never stored,
 *     so it cannot drift from the projects it came from;
 *   - deletes are soft, and re-posting a deleted code revives it;
 *   - the project/estimate tables are OPTIONAL — a host that has not migrated
 *     those modules still gets a working directory with zero-value rows,
 *     instead of a 500 on a missing table.
 */
class ClientService
{
    public function __construct(private string $companyId = 'woodart') {}

    /** Normalise a client name for matching. One definition, mirrored client-side. */
    public static function matchKey(?string $name): string
    {
        return mb_strtolower(trim((string) $name));
    }

    /** Every client, A→Z by name (the directory's order). */
    public function directory(): Collection
    {
        return Client::query()
            ->where('company_id', $this->companyId)
            ->orderBy('name')
            ->get();
    }

    public function find(string $extId): ?Client
    {
        return Client::query()
            ->where('company_id', $this->companyId)
            ->where('ext_id', $extId)
            ->first();
    }

    /**
     * Every client with their work rolled up, highest contract value first.
     * Degrades gracefully when the projects/estimates tables do not exist yet.
     */
    public function portfolio(): Collection
    {
        $projects  = $this->workBy('wa_projects');
        $estimates = $this->workBy('wa_estimates', true);

        return $this->directory()
            ->map(function (Client $c) use ($projects, $estimates) {
                $k = self::matchKey($c->name);
                $p = $projects[$k]  ?? ['count' => 0, 'live' => 0, 'value' => 0, 'cost' => 0];
                $e = $estimates[$k] ?? ['count' => 0, 'won' => 0, 'open' => 0];

                return [
                    'id'       => $c->ext_id,
                    'name'     => $c->name,
                    'type'     => $c->type,
                    'area'     => $c->area ?: '',
                    'projects' => $p['count'],
                    'live'     => $p['live'],
                    'value'    => (int) $p['value'],
                    'cost'     => (int) $p['cost'],
                    'margin'   => (int) $p['value'] - (int) $p['cost'],
                    'quotes'   => $e['count'],
                    'won'      => $e['won'],
                    'open'     => $e['open'],
                ];
            })
            ->sortByDesc('value')
            ->values();
    }

    /** Contract value grouped by segment, largest first. */
    public function segments(): Collection
    {
        return $this->portfolio()
            ->groupBy('type')
            ->map(fn (Collection $rows, string $type) => [
                'name'     => $type,
                'clients'  => $rows->count(),
                'projects' => (int) $rows->sum('projects'),
                'value'    => (int) $rows->sum('value'),
                'margin'   => (int) $rows->sum('margin'),
            ])
            ->sortByDesc('value')
            ->values();
    }

    /** The header figures. One calculation, mirroring the frontend seam. */
    public function summary(): array
    {
        $rows = $this->portfolio();
        $value = (int) $rows->sum('value');

        return [
            'clients'  => $rows->count(),
            'value'    => $value,
            'cost'     => (int) $rows->sum('cost'),
            'margin'   => (int) $rows->sum('margin'),
            'live'     => $rows->where('live', '>', 0)->count(),
            'repeat'   => $rows->where('projects', '>', 1)->count(),
            'idle'     => $rows->filter(fn ($r) => $r['projects'] === 0 && $r['quotes'] === 0)->count(),
            'segments' => $rows->pluck('type')->filter()->unique()->count(),
            'avg'      => $rows->count() ? (int) round($value / $rows->count()) : 0,
            'top'      => $rows->first()['name'] ?? '—',
        ];
    }

    /** Create or update, keyed on the frontend id. */
    public function upsert(array $data): Client
    {
        $client = Client::withTrashed()->firstOrNew([
            'company_id' => $this->companyId,
            'ext_id'     => $data['id'],
        ]);

        $client->fill([
            'company_id' => $this->companyId,
            'ext_id'     => $data['id'],
            'name'       => trim($data['name']),
            'type'       => $data['type'],
            'contact'    => isset($data['contact']) ? trim($data['contact']) : null,
            'phone'      => isset($data['phone']) ? trim($data['phone']) : null,
            'email'      => isset($data['email']) ? trim($data['email']) : null,
            'area'       => isset($data['area']) ? trim($data['area']) : null,
            'since'      => $data['since'] ?? $client->since,
            'created_on' => $data['created'] ?? $client->created_on ?? now()->toDateString(),
        ]);

        // Re-posting a soft-deleted code revives it rather than failing on the
        // unique index — the user's intent is "this client exists again".
        if ($client->trashed()) {
            $client->deleted_at = null;
        }

        $client->save();

        return $client;
    }

    /** Soft delete by frontend id. Idempotent — silent when already gone. */
    public function delete(string $extId): void
    {
        Client::query()
            ->where('company_id', $this->companyId)
            ->where('ext_id', $extId)
            ->delete();
    }

    /* ------------------------------------------------------------------ */

    /**
     * Roll up a work table keyed by normalised client name.
     * Returns [] when the table is absent, so a partially-migrated host still
     * serves a working directory instead of throwing.
     */
    private function workBy(string $table, bool $isEstimate = false): array
    {
        if (! Schema::hasTable($table)) {
            return [];
        }

        $rows = DB::table($table)->get();
        $out = [];

        foreach ($rows as $row) {
            $k = self::matchKey($row->client ?? null);
            if ($k === '') {
                continue;
            }
            if ($isEstimate) {
                $out[$k] ??= ['count' => 0, 'won' => 0, 'open' => 0];
                $out[$k]['count']++;
                if (($row->status ?? '') === 'Approved') {
                    $out[$k]['won']++;
                }
                if (in_array($row->status ?? '', ['Draft', 'Sent'], true)) {
                    $out[$k]['open']++;
                }
                continue;
            }
            $out[$k] ??= ['count' => 0, 'live' => 0, 'value' => 0, 'cost' => 0];
            $out[$k]['count']++;
            $out[$k]['value'] += (int) ($row->value ?? 0);
            $out[$k]['cost']  += (int) ($row->cost ?? 0);
            if (! in_array($row->stage ?? '', ['Completed', 'Handover'], true)) {
                $out[$k]['live']++;
            }
        }

        return $out;
    }
}
