<?php

namespace Epal\Modules\Woodart\Production\Services;

use Epal\Modules\Woodart\Production\Models\Job;
use Illuminate\Support\Collection;

/**
 * ProductionService — ALL the business logic for the Woodart workshop. The
 * controller is thin (owner decision D8).
 *
 * THE DEMO CLOCK
 * ---------------------------------------------------------------------------
 * "Overdue" is relative to a date, and this app runs on a FIXED demo date so
 * seeded data tells a stable story and the screenshot harness is repeatable.
 * The date is a constructor argument with that default, never a hidden call to
 * now(): a service that silently used the real clock would disagree with the
 * screen, which anchors to the same constant in its seam. When the app goes
 * live, this default is the one line that changes.
 *
 * Rules this service owns:
 *   - OPEN is any job whose status is not 'Done';
 *   - OVERDUE is open AND past its due date. A finished job is never overdue,
 *     however late it was — it is done, and the register should stop shouting;
 *   - station load is ranked by OPEN jobs, because that is what a workshop
 *     manager schedules around; finished work is history;
 *   - upsert keyed on (company_id, ext_id); soft delete; a re-post revives.
 */
class ProductionService
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

    /** Every job, soonest due first, undated last — the register's order. */
    public function jobs(): Collection
    {
        return Job::query()
            ->where('company_id', $this->companyId)
            ->orderByRaw('CASE WHEN due IS NULL THEN 1 ELSE 0 END, due ASC')
            ->orderBy('ext_id')
            ->get();
    }

    public function find(string $extId): ?Job
    {
        return Job::query()
            ->where('company_id', $this->companyId)
            ->where('ext_id', $extId)
            ->first();
    }

    /** The jobs in one board column. */
    public function byStatus(string $status): Collection
    {
        return $this->jobs()->where('status', $status)->values();
    }

    /** Load per station, busiest (most OPEN jobs) first. */
    public function byStation(): Collection
    {
        $acc = [];

        foreach ($this->jobs() as $j) {
            $k = $j->station ?: 'Unassigned';
            $acc[$k] ??= ['name' => $k, 'total' => 0, 'open' => 0, 'running' => 0,
                          'blocked' => 0, 'overdue' => 0, 'done' => 0];
            $acc[$k]['total']++;
            $j->isOpen() ? $acc[$k]['open']++ : $acc[$k]['done']++;
            if ($j->status === 'Running') {
                $acc[$k]['running']++;
            }
            if ($j->status === 'Blocked') {
                $acc[$k]['blocked']++;
            }
            if ($j->isOverdue($this->today)) {
                $acc[$k]['overdue']++;
            }
        }

        return collect(array_values($acc))
            ->sortByDesc(fn (array $r) => [$r['open'], $r['total']])
            ->values();
    }

    /** The header figures. One calculation, mirroring the frontend seam. */
    public function summary(): array
    {
        $jobs = $this->jobs();
        $done = $jobs->filter(fn (Job $j) => ! $j->isOpen())->count();
        $load = $this->byStation();

        return [
            'jobs'      => $jobs->count(),
            'running'   => $jobs->where('status', 'Running')->count(),
            'blocked'   => $jobs->where('status', 'Blocked')->count(),
            'overdue'   => $jobs->filter(fn (Job $j) => $j->isOverdue($this->today))->count(),
            'done'      => $done,
            'open'      => $jobs->count() - $done,
            'attention' => $jobs->where('status', 'Blocked')->count()
                           + $jobs->filter(fn (Job $j) => $j->isOverdue($this->today))->count(),
            'pct'       => $jobs->count() ? (int) round($done / $jobs->count() * 100) : 0,
            'crew'      => $jobs->pluck('assigned_to')->filter()->unique()->count(),
            'stations'  => $jobs->pluck('station')->filter()->unique()->count(),
            'top'       => ($load->first()['open'] ?? 0) > 0 ? $load->first()['name'] : '—',
        ];
    }

    /** Create or update, keyed on the frontend id. */
    public function upsert(array $data): Job
    {
        $job = Job::withTrashed()->firstOrNew([
            'company_id' => $this->companyId,
            'ext_id'     => $data['id'],
        ]);

        $job->fill([
            'company_id'  => $this->companyId,
            'ext_id'      => $data['id'],
            'job'         => trim($data['job']),
            'project'     => $data['project'] ?? null,
            'station'     => $data['station'],
            'assigned_to' => isset($data['assignedTo']) ? trim($data['assignedTo']) : null,
            'status'      => $data['status'],
            'due'         => $data['due'] ?? $job->due,
            'created_on'  => $data['created'] ?? $job->created_on ?? now()->toDateString(),
        ]);

        if ($job->trashed()) {
            $job->deleted_at = null;
        }

        $job->save();

        return $job;
    }

    /** Soft delete by frontend id. Idempotent. */
    public function delete(string $extId): void
    {
        Job::query()
            ->where('company_id', $this->companyId)
            ->where('ext_id', $extId)
            ->delete();
    }
}
