<?php

namespace Epal\Modules\Woodart\Installation\Services;

use Epal\Modules\Woodart\Installation\Models\Install;
use Illuminate\Support\Collection;

/**
 * InstallationService — ALL the business logic for Woodart site visits. The
 * controller is thin (owner decision D8).
 *
 * THE DEMO CLOCK is a constructor argument defaulting to 2026-07-05, never a
 * hidden now(), for the same reason as ProductionService: "overdue" depends on
 * a date, and a service reading the real clock would disagree with a screen
 * anchored to the same constant and would make the screenshot harness
 * unrepeatable.
 *
 * THE SNAG COUNT IS KEPT AUTHORITATIVE ON WRITE. If a caller sends an itemised
 * `snagList`, the stored `snags` number is RECOMPUTED from it rather than
 * trusted — a client that sent a stale count cannot corrupt the figure the
 * whole handover queue is ordered by.
 *
 * Other rules:
 *   - OPEN is any install whose status is not 'Handover';
 *   - a site cannot be considered a clean handover while snags are open;
 *   - team load is ranked by OPEN sites, because that is what a scheduler
 *     cares about;
 *   - upsert keyed on (company_id, ext_id); soft delete; a re-post revives.
 */
class InstallationService
{
    public const DEMO_TODAY = '2026-07-05';

    public function __construct(
        private string $companyId = 'woodart',
        private string $today = self::DEMO_TODAY,
    ) {}

    public function today(): string
    {
        return $this->today;
    }

    /** Every install, soonest visit first, undated last. */
    public function schedule(): Collection
    {
        return Install::query()
            ->where('company_id', $this->companyId)
            ->orderByRaw('CASE WHEN date IS NULL THEN 1 ELSE 0 END, date ASC')
            ->orderBy('ext_id')
            ->get();
    }

    public function find(string $extId): ?Install
    {
        return Install::query()
            ->where('company_id', $this->companyId)
            ->where('ext_id', $extId)
            ->first();
    }

    /** Only the sites still carrying snags, worst first — the handover queue. */
    public function snagging(): Collection
    {
        return $this->schedule()
            ->filter(fn (Install $i) => $i->openSnags() > 0)
            ->map(fn (Install $i) => [
                'id'      => $i->ext_id,
                'site'    => $i->site,
                'project' => $i->project ?: '',
                'team'    => $i->team ?: '',
                'status'  => $i->status,
                'date'    => optional($i->date)->toDateString(),
                'open'    => $i->openSnags(),
            ])
            ->sortByDesc('open')
            ->values();
    }

    /** Load per team, busiest (most OPEN sites) first. */
    public function byTeam(): Collection
    {
        $acc = [];

        foreach ($this->schedule() as $i) {
            $k = $i->team ?: 'Unassigned';
            $acc[$k] ??= ['name' => $k, 'sites' => 0, 'open' => 0, 'snags' => 0,
                          'overdue' => 0, 'handover' => 0];
            $acc[$k]['sites']++;
            $acc[$k]['snags'] += $i->openSnags();
            $i->isOpen() ? $acc[$k]['open']++ : $acc[$k]['handover']++;
            if ($i->isOverdue($this->today)) {
                $acc[$k]['overdue']++;
            }
        }

        return collect(array_values($acc))
            ->sortByDesc(fn (array $r) => [$r['open'], $r['sites']])
            ->values();
    }

    /** The header figures. One calculation, mirroring the frontend seam. */
    public function summary(): array
    {
        $all = $this->schedule();
        $handover = $all->filter(fn (Install $i) => ! $i->isOpen());
        $load = $this->byTeam();
        $worst = $this->snagging()->first();

        return [
            'installs'  => $all->count(),
            'active'    => $all->whereIn('status', ['In Progress', 'Snagging'])->count(),
            'handover'  => $handover->count(),
            'overdue'   => $all->filter(fn (Install $i) => $i->isOverdue($this->today))->count(),
            'snags'     => (int) $all->sum(fn (Install $i) => $i->openSnags()),
            'sites'     => $all->filter(fn (Install $i) => $i->openSnags() > 0)->count(),
            'clean'     => $handover->filter(fn (Install $i) => $i->openSnags() === 0)->count(),
            'open'      => $all->count() - $handover->count(),
            'attention' => $all->filter(
                fn (Install $i) => $i->status === 'Snagging' || $i->isOverdue($this->today)
            )->count(),
            'teams'     => $all->filter(fn (Install $i) => $i->isOpen())->pluck('team')->filter()->unique()->count(),
            'allTeams'  => $load->count(),
            'rate'      => $all->count() ? (int) round($handover->count() / $all->count() * 100) : 0,
            'top'       => ($load->first()['open'] ?? 0) > 0 ? $load->first()['name'] : '—',
            'worst'     => $worst['site'] ?? '—',
        ];
    }

    /** Create or update, keyed on the frontend id. */
    public function upsert(array $data): Install
    {
        $install = Install::withTrashed()->firstOrNew([
            'company_id' => $this->companyId,
            'ext_id'     => $data['id'],
        ]);

        $list = $data['snagList'] ?? $install->snag_list;

        // The count is DERIVED from the list whenever one exists — a client that
        // sent a stale number cannot corrupt the figure the handover queue is
        // ordered by.
        $snags = (is_array($list) && $list !== [])
            ? count(array_filter($list, static fn ($s) => empty($s['done'])))
            : (int) ($data['snags'] ?? $install->snags ?? 0);

        $install->fill([
            'company_id' => $this->companyId,
            'ext_id'     => $data['id'],
            'project'    => $data['project'] ?? null,
            'site'       => trim($data['site']),
            'team'       => isset($data['team']) ? trim($data['team']) : null,
            'status'     => $data['status'],
            'date'       => $data['date'] ?? $install->date,
            'snags'      => max(0, $snags),
            'snag_list'  => (is_array($list) && $list !== []) ? array_values($list) : null,
            'created_on' => $data['created'] ?? $install->created_on ?? now()->toDateString(),
        ]);

        if ($install->trashed()) {
            $install->deleted_at = null;
        }

        $install->save();

        return $install;
    }

    /** Soft delete by frontend id. Idempotent. */
    public function delete(string $extId): void
    {
        Install::query()
            ->where('company_id', $this->companyId)
            ->where('ext_id', $extId)
            ->delete();
    }
}
