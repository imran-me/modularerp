<?php

namespace Epal\Modules\Woodart\Design\Services;

use Epal\Modules\Woodart\Design\Models\Drawing;
use Epal\Modules\Woodart\Design\Models\Revision;
use Illuminate\Support\Collection;

/**
 * DesignService — ALL the business logic for the architecture & 3D phase. Two
 * entities, ONE service (the same call as Procurement): the rules that matter —
 * the lifecycle, the phase gate, the trail — span both, and duplicating them
 * across two services is how they drift.
 *
 * THE DEMO CLOCK is a constructor argument defaulting to 2026-07-05, never a
 * hidden now(): "days with the client" depends on a date, and a service reading
 * the real clock would disagree with a screen anchored to the same constant.
 *
 * THE LIFECYCLE
 *   Draft → Issued → (Commented → Issued at the next revision) → Approved
 * `Issued` is the ONLY state where the wait is the client's; everything else is
 * on us, which is why the approval queue is exactly the Issued set.
 *
 * THE PHASE GATE — the reason this module matters to the project spine:
 * a project's design phase is complete only when it HAS deliverables and every
 * one of them is Approved. A project with NONE has not started design, which is
 * emphatically not the same as having finished it, and must never count as
 * complete. That distinction is the whole point of `complete` below.
 *
 * THE TRAIL is written by the service, not the caller. Every status or revision
 * change records who did it and when — the same principle as a ledger reversal:
 * a state never moves without a row explaining why.
 */
class DesignService
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

    /* ----------------------------------------------------------- DRAWINGS */

    /** Every deliverable, most recently issued first, undated last. */
    public function register(): Collection
    {
        return Drawing::query()
            ->where('company_id', $this->companyId)
            ->orderByRaw('CASE WHEN issued IS NULL THEN 1 ELSE 0 END, issued DESC')
            ->orderBy('ext_id')
            ->get();
    }

    public function find(string $extId): ?Drawing
    {
        return Drawing::query()
            ->where('company_id', $this->companyId)
            ->where('ext_id', $extId)
            ->first();
    }

    /** Only what is with the client, longest wait first — the approval queue. */
    public function queue(): Collection
    {
        return $this->register()
            ->filter(fn (Drawing $d) => $d->isWaiting())
            ->map(fn (Drawing $d) => [
                'id'       => $d->ext_id,
                'title'    => $d->title,
                'kind'     => $d->kind,
                'project'  => $d->project ?: '',
                'designer' => $d->designer ?: '',
                'rev'      => $d->rev,
                'issued'   => optional($d->issued)->toDateString(),
                'days'     => $d->waitingDays($this->today) ?? 0,
            ])
            ->sortByDesc('days')
            ->values();
    }

    /** The revision trail of one deliverable, oldest first. */
    public function trail(string $drawingExtId): Collection
    {
        return Revision::query()
            ->where('company_id', $this->companyId)
            ->where('drawing', $drawingExtId)
            ->orderBy('rev')
            ->orderBy('ext_id')
            ->get();
    }

    /* -------------------------------------------------------- THE ROLL-UPS */

    /** Per project: is the design phase complete? See the class docblock. */
    public function projectStatus(): Collection
    {
        $acc = [];

        foreach ($this->register() as $d) {
            $k = $d->project ?: 'Unassigned';
            $acc[$k] ??= ['project' => $k, 'total' => 0, 'open' => 0, 'waiting' => 0, 'approved' => 0];
            $acc[$k]['total']++;
            $d->isOpen() ? $acc[$k]['open']++ : $acc[$k]['approved']++;
            if ($d->isWaiting()) {
                $acc[$k]['waiting']++;
            }
        }

        return collect(array_values($acc))
            ->map(function (array $r) {
                // HAS deliverables AND none open. "No deliverables" is NOT complete.
                $r['complete'] = $r['total'] > 0 && $r['open'] === 0;

                return $r;
            })
            ->sortByDesc(fn (array $r) => [$r['open'], $r['total']])
            ->values();
    }

    /** Load per designer, busiest (most OPEN deliverables) first. */
    public function byDesigner(): Collection
    {
        $acc = [];

        foreach ($this->register() as $d) {
            $k = $d->designer ?: 'Unassigned';
            $acc[$k] ??= ['name' => $k, 'total' => 0, 'open' => 0, 'waiting' => 0,
                          'revisions' => 0, 'approved' => 0];
            $acc[$k]['total']++;
            $acc[$k]['revisions'] += $d->revCount();
            $d->isOpen() ? $acc[$k]['open']++ : $acc[$k]['approved']++;
            if ($d->isWaiting()) {
                $acc[$k]['waiting']++;
            }
        }

        return collect(array_values($acc))
            ->sortByDesc(fn (array $r) => [$r['open'], $r['total']])
            ->values();
    }

    /** Deliverables grouped by kind — the mix. */
    public function byKind(): Collection
    {
        return $this->register()
            ->groupBy('kind')
            ->map(fn (Collection $rows, string $kind) => ['name' => $kind, 'count' => $rows->count()])
            ->sortByDesc('count')
            ->values();
    }

    /** The header figures. One calculation, mirroring the frontend seam. */
    public function summary(): array
    {
        $all = $this->register();
        $approved = $all->filter(fn (Drawing $d) => ! $d->isOpen())->count();
        $queue = $this->queue();
        $projects = $this->projectStatus();
        $load = $this->byDesigner();
        $revs = (int) $all->sum(fn (Drawing $d) => $d->revCount());

        return [
            'drawings'  => $all->count(),
            'issued'    => $all->where('status', 'Issued')->count(),
            'commented' => $all->where('status', 'Commented')->count(),
            'draft'     => $all->where('status', 'Draft')->count(),
            'approved'  => $approved,
            'open'      => $all->count() - $approved,
            'attention' => $all->whereIn('status', ['Issued', 'Commented'])->count(),
            'waiting'   => $queue->count(),
            'oldest'    => $queue->first()['days'] ?? 0,
            'complete'  => $projects->where('complete', true)->count(),
            'projects'  => $projects->count(),
            'avgRev'    => $all->count() ? round($revs / $all->count(), 1) : 0.0,
            'designers' => $all->pluck('designer')->filter()->unique()->count(),
            'rate'      => $all->count() ? (int) round($approved / $all->count() * 100) : 0,
            'top'       => ($load->first()['open'] ?? 0) > 0 ? $load->first()['name'] : '—',
        ];
    }

    /* -------------------------------------------------------------- WRITES */

    /**
     * Create or update a deliverable, and record the transition in the trail.
     *
     * The trail row is written HERE rather than by the caller, so a status or
     * revision change can never be saved without evidence of who moved it.
     */
    public function upsert(array $data, string $note = ''): Drawing
    {
        $drawing = Drawing::withTrashed()->firstOrNew([
            'company_id' => $this->companyId,
            'ext_id'     => $data['id'],
        ]);

        $wasStatus = $drawing->exists ? $drawing->status : null;
        $wasRev    = $drawing->exists ? $drawing->rev : null;

        $drawing->fill([
            'company_id' => $this->companyId,
            'ext_id'     => $data['id'],
            'title'      => trim($data['title']),
            'kind'       => $data['kind'],
            'project'    => $data['project'] ?? null,
            'designer'   => isset($data['designer']) ? trim($data['designer']) : null,
            'rev'        => $data['rev'] ?? ($drawing->rev ?: 'A'),
            'status'     => $data['status'],
            'issued'     => $data['issued'] ?? $drawing->issued,
            'approved'   => $data['approved'] ?? $drawing->approved,
            'created_on' => $data['created'] ?? $drawing->created_on ?? now()->toDateString(),
        ]);

        if ($drawing->trashed()) {
            $drawing->deleted_at = null;
        }

        $drawing->save();

        if ($wasStatus !== $drawing->status || $wasRev !== $drawing->rev) {
            $this->recordRevision($drawing, $wasStatus, $wasRev, $note);
        }

        return $drawing;
    }

    /**
     * Delete a deliverable AND its trail. The trail has no meaning without the
     * drawing it describes, and leaving it behind would be orphaned evidence.
     */
    public function delete(string $extId): void
    {
        Revision::query()
            ->where('company_id', $this->companyId)
            ->where('drawing', $extId)
            ->delete();

        Drawing::query()
            ->where('company_id', $this->companyId)
            ->where('ext_id', $extId)
            ->delete();
    }

    /* ------------------------------------------------------------------ */

    private function recordRevision(Drawing $d, ?string $wasStatus, ?string $wasRev, string $note): void
    {
        Revision::create([
            'company_id' => $this->companyId,
            'ext_id'     => $this->nextRevisionId(),
            'drawing'    => $d->ext_id,
            'rev'        => $d->rev,
            'action'     => $this->actionFor($wasStatus, $wasRev, $d),
            'by'         => $d->designer,
            'note'       => $note ?: null,
            'date'       => $this->today,
        ]);
    }

    /** What to call the transition that just happened. Named, not inlined, so
     *  the trail's vocabulary lives in one place (NAMING-AND-TERMINOLOGY §1.2). */
    private function actionFor(?string $wasStatus, ?string $wasRev, Drawing $d): string
    {
        if ($wasStatus === null) {
            return $d->status === 'Draft' ? 'Drafted' : $d->status;
        }
        if ($wasRev !== $d->rev) {
            return 'Revised';
        }

        return $d->status;
    }

    private function nextRevisionId(): string
    {
        $max = 0;
        foreach (Revision::withTrashed()->where('company_id', $this->companyId)->pluck('ext_id') as $id) {
            if (preg_match('/(\d+)$/', (string) $id, $m)) {
                $max = max($max, (int) $m[1]);
            }
        }

        return 'RVN-'.str_pad((string) ($max + 1), 3, '0', STR_PAD_LEFT);
    }
}
