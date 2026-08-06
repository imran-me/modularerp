<?php

namespace Epal\Modules\Woodart\Scope\Services;

use Epal\Modules\Woodart\Scope\Models\Phase;
use Epal\Modules\Woodart\Scope\Models\PhaseTemplate;
use Epal\Modules\Woodart\Scope\Models\Requirement;
use Epal\Modules\Woodart\Scope\Models\Space;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * SCOPE SERVICE — every rule this module has, in one place.
 *
 * The controllers are thin: validate → call this → shape with a Resource. Each
 * method below MIRRORS a named function in the frontend seam
 * (companies/woodart/modules/scope/frontend/api.js). They are two halves of one
 * contract: change a rule here and change it there, or the screen and the
 * server start answering the same question differently.
 *
 * THE DEMO CLOCK IS INJECTED, never now(). `overdue` must mean the same thing
 * on the server as it does on the screen, and the screen runs on 2026-07-05.
 *
 * CROSS-MODULE READS GO THROUGH DB::table + Schema::hasTable, NOT through
 * another module's Eloquent model. Deleting the materials folder must leave
 * this module working with an honest "not stocked" instead of a 500 — that
 * drop-in/drop-out property is the whole architecture.
 */
class ScopeService
{
    public const COMPANY = 'woodart';

    public function __construct(private string $today = '2026-07-05') {}

    /* ====================================================================
     * SPACES
     * ================================================================== */

    public function spaces(?string $project = null)
    {
        $q = Space::where('company_id', self::COMPANY);
        if ($project) {
            $q->where('project', $project);
        }

        return $q->orderBy('sort')->orderBy('ext_id')->get();
    }

    public function space(string $extId): ?Space
    {
        return Space::where('company_id', self::COMPANY)->where('ext_id', $extId)->first();
    }

    public function upsertSpace(array $data): Space
    {
        $extId = $data['id'] ?? $this->nextExtId(Space::class, 'SPC', 3);

        return Space::updateOrCreate(
            ['company_id' => self::COMPANY, 'ext_id' => $extId],
            [
                'project'    => $data['project'],
                'name'       => trim($data['name']),
                'kind'       => $data['kind'] ?? 'Common',
                'area'       => (int) ($data['area'] ?? 0),
                'sort'       => (int) ($data['sort'] ?? 1),
                'note'       => $data['note'] ?? null,
                'created_on' => $data['created'] ?? $this->today,
            ]
        );
    }

    /**
     * Delete a space AND everything under it. A phase whose space is gone still
     * counts in every roll-up while being impossible to open, and a requirement
     * whose phase is gone still prices into the quotation. Orphans are not kept
     * here — they are prevented.
     */
    public function deleteSpace(string $extId): void
    {
        DB::transaction(function () use ($extId) {
            $phases = Phase::where('company_id', self::COMPANY)->where('space', $extId)->get();
            foreach ($phases as $phase) {
                $this->deletePhase($phase->ext_id);
            }
            Requirement::where('company_id', self::COMPANY)->where('space', $extId)->delete();
            Space::where('company_id', self::COMPANY)->where('ext_id', $extId)->delete();
        });
    }

    /* ====================================================================
     * PHASES
     * ================================================================== */

    public function phases(?string $project = null, ?string $space = null)
    {
        $q = Phase::where('company_id', self::COMPANY);
        if ($project) {
            $q->where('project', $project);
        }
        if ($space) {
            $q->where('space', $space);
        }

        return $q->orderBy('sort')->orderBy('ext_id')->get();
    }

    public function phase(string $extId): ?Phase
    {
        return Phase::where('company_id', self::COMPANY)->where('ext_id', $extId)->first();
    }

    /**
     * Create or update a phase. `project` is DERIVED from the space — a client
     * that sends a different one is overwritten, never trusted, so a phase can
     * never claim to belong to a project its room is not in.
     */
    public function upsertPhase(array $data): Phase
    {
        $space = $this->space($data['space']);
        if (! $space) {
            throw new \InvalidArgumentException('Unknown space: '.$data['space']);
        }
        $extId = $data['id'] ?? $this->nextExtId(Phase::class, 'PHS', 4);

        return Phase::updateOrCreate(
            ['company_id' => self::COMPANY, 'ext_id' => $extId],
            [
                'project'  => $space->project,
                'space'    => $space->ext_id,
                'name'     => trim($data['name']),
                'code'     => $data['code'] ?? null,
                'sort'     => (int) ($data['sort'] ?? 1),
                'status'   => $data['status'] ?? 'Not started',
                'owner_id' => ($data['ownerId'] ?? '') ?: null,
                'start'    => $data['start'] ?? null,
                'finish'   => $data['finish'] ?? null,
                'note'     => $data['note'] ?? null,
            ]
        );
    }

    /** Deleting a phase takes its requirements with it. */
    public function deletePhase(string $extId): void
    {
        DB::transaction(function () use ($extId) {
            Requirement::where('company_id', self::COMPANY)->where('phase', $extId)->delete();
            Phase::where('company_id', self::COMPANY)->where('ext_id', $extId)->delete();
        });
    }

    /**
     * Create the phases of a space's kind that it does NOT already have.
     * Appending only the missing ones is what makes pressing "apply template"
     * twice safe: it can never wipe a phase somebody has already assigned or
     * completed. Returns only the rows written — an empty array is a valid,
     * successful answer.
     */
    public function applyTemplate(string $spaceExtId): array
    {
        $space = $this->space($spaceExtId);
        if (! $space) {
            return [];
        }

        $have = $this->phases(null, $space->ext_id);
        $haveNames = $have->map(fn ($p) => mb_strtolower($p->name))->all();
        $sort = $have->count() ? ((int) $have->last()->sort + 1) : 1;

        $template = PhaseTemplate::where('company_id', self::COMPANY)
            ->where('kind', $space->kind)->first();
        $list = $template ? ($template->phases ?: []) : [];

        $written = [];
        foreach ($list as $row) {
            if (in_array(mb_strtolower($row['name']), $haveNames, true)) {
                continue;
            }
            $written[] = $this->upsertPhase([
                'space'  => $space->ext_id,
                'name'   => $row['name'],
                'code'   => $row['code'] ?? null,
                'sort'   => $sort++,
                'status' => 'Not started',
            ]);
        }

        return $written;
    }

    /* ====================================================================
     * REQUIREMENTS
     * ================================================================== */

    public function requirements(?string $project = null, ?string $phase = null)
    {
        $q = Requirement::where('company_id', self::COMPANY);
        if ($project) {
            $q->where('project', $project);
        }
        if ($phase) {
            $q->where('phase', $phase);
        }

        return $q->orderBy('id')->get();
    }

    /**
     * REPLACE a phase's requirement lines with what the editor sent.
     *
     * Ids are reused POSITIONALLY — row 1 keeps row 1's id — because the
     * line-item editor cannot round-trip an id, and minting a fresh one on
     * every save would break the engagement → requirement link the hiring desk
     * needs. Surplus rows are deleted; a blank item is not a requirement.
     */
    public function saveRequirements(string $phaseExtId, array $lines): array
    {
        $phase = $this->phase($phaseExtId);
        if (! $phase) {
            throw new \InvalidArgumentException('Unknown phase: '.$phaseExtId);
        }

        return DB::transaction(function () use ($phase, $lines) {
            $existing = $this->requirements(null, $phase->ext_id)->values();
            $kept = [];

            foreach ($lines as $line) {
                $item = trim($line['item'] ?? '');
                if ($item === '') {
                    continue;
                }
                $kind = in_array($line['kind'] ?? '', Requirement::KINDS, true) ? $line['kind'] : 'material';
                $old = $existing[count($kept)] ?? null;
                $status = in_array($line['status'] ?? '', Requirement::STATUSES, true)
                    ? $line['status']
                    : ($old->status ?? 'Planned');

                $kept[] = Requirement::updateOrCreate(
                    [
                        'company_id' => self::COMPANY,
                        'ext_id'     => $old->ext_id ?? $this->nextExtId(Requirement::class, 'REQ', 4),
                    ],
                    [
                        'project'     => $phase->project,
                        'space'       => $phase->space,
                        'phase'       => $phase->ext_id,
                        'kind'        => $kind,
                        'code'        => $line['code'] ?? $old->code ?? $phase->code,
                        'item'        => $item,
                        'material_id' => $kind === 'material' ? $this->materialIdOf($item) : null,
                        'qty'         => (float) ($line['qty'] ?? 0),
                        'unit'        => $line['unit'] ?? ($kind === 'labour' ? 'man-day' : ($kind === 'contract' ? 'lot' : null)),
                        'unit_cost'   => (int) ($line['unitCost'] ?? 0),
                        'unit_sale'   => (int) ($line['unitSale'] ?? 0),
                        'status'      => $status,
                        'note'        => $line['note'] ?? null,
                    ]
                );
            }

            // whatever the editor dropped, drop from the table too
            foreach ($existing->slice(count($kept)) as $gone) {
                $gone->delete();
            }

            return $kept;
        });
    }

    /* ====================================================================
     * DERIVED — computed on read, never stored
     * ================================================================== */

    /** Cost, quote and margin of any set of requirement lines. */
    public function totals($rows): array
    {
        $cost = 0;
        $quote = 0;
        foreach ($rows as $r) {
            $cost += $r->amount();
            $quote += $r->quote();
        }

        return [
            'lines'     => is_countable($rows) ? count($rows) : iterator_count($rows),
            'cost'      => $cost,
            'quote'     => $quote,
            'margin'    => $quote - $cost,
            'marginPct' => $quote > 0 ? (int) round(($quote - $cost) / $quote * 100) : 0,
        ];
    }

    /**
     * A space's progress, WEIGHTED by what each phase is worth. Counting phases
     * treats a ৳4 lakh wood-work phase like a ৳15,000 handover and flatters a
     * job that has finished the cheap parts. A phase with nothing planned
     * weighs 1, so it still counts instead of vanishing.
     */
    public function progressOf(string $spaceExtId): array
    {
        $phases = $this->phases(null, $spaceExtId);
        $done = 0;
        $weightDone = 0;
        $weightAll = 0;

        foreach ($phases as $p) {
            $w = $this->totals($this->requirements(null, $p->ext_id))['cost'] ?: 1;
            $weightAll += $w;
            if ($p->status === 'Complete') {
                $done++;
                $weightDone += $w;
            }
        }

        return [
            'done'  => $done,
            'total' => $phases->count(),
            'pct'   => $weightAll ? (int) round($weightDone / $weightAll * 100) : 0,
        ];
    }

    /**
     * MATERIAL DEMAND — every `material` line of a project rolled up per item,
     * against what the register holds. `outstanding` excludes lines already
     * ordered or issued; `short` is what still has to be bought.
     */
    public function demand(string $project): array
    {
        $stock = $this->materialStock();
        $bag = [];

        foreach ($this->requirements($project) as $r) {
            if ($r->kind !== 'material') {
                continue;
            }
            $key = $r->item;
            if (! isset($bag[$key])) {
                $bag[$key] = [
                    'item' => $r->item, 'unit' => $r->unit ?: '', 'code' => $r->code ?: '',
                    'materialId' => $r->material_id, 'qty' => 0.0, 'committed' => 0.0,
                    'cost' => 0, 'quote' => 0, 'phases' => 0, 'spaces' => [],
                ];
            }
            $bag[$key]['qty'] += (float) $r->qty;
            if ($r->isCommitted()) {
                $bag[$key]['committed'] += (float) $r->qty;
            }
            $bag[$key]['cost'] += $r->amount();
            $bag[$key]['quote'] += $r->quote();
            $bag[$key]['phases']++;
            $bag[$key]['spaces'][$r->space] = true;
        }

        $rows = [];
        foreach ($bag as $row) {
            $mat = $stock[$row['item']] ?? null;
            $row['outstanding'] = max(0, $row['qty'] - $row['committed']);
            $row['stock'] = $mat ? (int) $mat->stock : null;
            $row['listed'] = (bool) $mat;
            $row['short'] = $mat
                ? max(0, $row['outstanding'] - (int) $mat->stock)
                : $row['outstanding'];
            $unit = $mat ? (int) $mat->unit_cost : ($row['qty'] ? $row['cost'] / $row['qty'] : 0);
            $row['shortCost'] = (int) round($row['short'] * $unit);
            $row['spaceCount'] = count($row['spaces']);
            unset($row['spaces']);
            $rows[] = $row;
        }

        usort($rows, fn ($a, $b) => $b['cost'] <=> $a['cost']);

        return $rows;
    }

    /**
     * TEAM LOAD — who is carrying which open phases, across every project.
     * Everyone with work appears; the unassigned queue is returned beside them,
     * because "what has nobody on it" is half of what this answers.
     */
    public function load(): array
    {
        $open = $this->phases()->filter(fn ($p) => $p->isOpen());
        $people = [];
        $unassigned = 0;

        foreach ($open as $p) {
            if ($p->isUnassigned()) {
                $unassigned++;

                continue;
            }
            $id = $p->owner_id;
            $people[$id] ??= ['id' => $id, 'open' => 0, 'active' => 0, 'overdue' => 0,
                'spaces' => [], 'projects' => []];
            $people[$id]['open']++;
            if ($p->status === 'Active') {
                $people[$id]['active']++;
            }
            if ($p->isOverdue($this->today)) {
                $people[$id]['overdue']++;
            }
            $people[$id]['spaces'][$p->space] = true;
            $people[$id]['projects'][$p->project] = true;
        }

        $rows = array_map(function ($r) {
            $r['spaces'] = count($r['spaces']);
            $r['projects'] = count($r['projects']);

            return $r;
        }, array_values($people));

        usort($rows, fn ($a, $b) => $b['open'] <=> $a['open']);

        return ['people' => $rows, 'unassigned' => $unassigned];
    }

    /* ====================================================================
     * PLUMBING
     * ================================================================== */

    /** Next free id in a series, so hand-added rows keep the shape. */
    public function nextExtId(string $modelClass, string $prefix, int $pad): string
    {
        $max = 0;
        foreach ($modelClass::withTrashed()->where('company_id', self::COMPANY)->pluck('ext_id') as $id) {
            $n = (int) preg_replace('/\D/', '', (string) $id);
            if ($n > $max) {
                $max = $n;
            }
        }

        return $prefix.'-'.str_pad((string) ($max + 1), $pad, '0', STR_PAD_LEFT);
    }

    /** The material register, keyed by name — or empty if that module is gone. */
    private function materialStock(): array
    {
        if (! Schema::hasTable('wa_materials')) {
            return [];
        }
        $rows = DB::table('wa_materials')
            ->where('company_id', self::COMPANY)
            ->whereNull('deleted_at')
            ->get(['name', 'stock', 'unit_cost']);

        return $rows->keyBy('name')->all();
    }

    /** A material line resolves to the register by NAME; anything else is null. */
    private function materialIdOf(string $item): ?string
    {
        if (! Schema::hasTable('wa_materials')) {
            return null;
        }
        $row = DB::table('wa_materials')
            ->where('company_id', self::COMPANY)
            ->where('name', $item)
            ->whereNull('deleted_at')
            ->first(['ext_id']);

        return $row->ext_id ?? null;
    }
}
