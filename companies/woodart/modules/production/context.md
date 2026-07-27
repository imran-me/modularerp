# Woodart · Workshop (production) — module context

> This module's memory. Append, never rewrite. Company-level context is
> `companies/woodart/CONTEXT.md`; the recipe is `MODULE-STANDARD.md`.

## Purpose

The shop floor as its own desk. Module #4 of the Woodart build order. The jobs
already existed — inside the project drawer in `projects/view.js` — but only
project-by-project. A workshop manager thinks by station and by state, so this
module gives the same records those two views.

## Decisions (locked)

| # | Date | Decision | Why |
|---|---|---|---|
| W1 | 2026-07-27 | **The demo clock is an explicit constructor argument**, `ProductionService($companyId, $today = '2026-07-05')`, echoed back by `GET /load` | "Overdue" depends on a date. A hidden `now()` would make the server disagree with a screen that anchors to the same constant, and would make the screenshot harness unrepeatable. One line changes when the app goes live. |
| W2 | 2026-07-27 | **OPEN = not `Done`. OVERDUE = open AND past `due`.** A finished job is never overdue however late it was | It is done; the register should stop shouting about it. Defined in `Job::isOpen()/isOverdue()` and mirrored in the seam. |
| W3 | 2026-07-27 | **An orphan job (project id that no longer exists) is KEPT and flagged**, never hidden or refused | Losing real shop-floor history because a parent record vanished is worse than showing the problem. `project` is therefore not validated against the projects table — which may not even be migrated on this host. |
| W4 | 2026-07-27 | **Station load is ranked by OPEN jobs, not total** | Finished work is history and does not compete for a machine. |
| W5 | 2026-07-27 | **The board's four COLUMNS are fixed markup; only the CARDS are cloned** | The columns are the workshop's states, not data. This is the clearest example in the codebase of the line the build law draws. |
| W6 | 2026-07-27 | **No material consumption, no capacity model, no labour cost, no project-progress derivation** | Each needs data the store does not have (movements, hours) or owns a number another module owns. Half-building any of them makes something else silently wrong. |
| W7 | 2026-07-27 | The seed includes real overdue work, a blocked job, an undated job and one deliberate orphan | So every branch has data on screen and in the tests, not just in theory. |

## State

| | |
|---|---|
| Frontend | ✅ real HTML — 3 screens (Register · Board · Load), zero `<script>`, zero `<template>`, `[hidden][data-proto]` cards + rows |
| Data seam | ✅ `frontend/api.js` — owns the store key, the open/overdue rules and the demo clock |
| Styling | ✅ every utility Tailwind; component classes kept (incl. the house `kanban`/`kb-*`); inline styles only for the computed bar width and column accent |
| Registered | ✅ `config.js` + company `module.json` + **own `module.json`** + `index.html` |
| Build | ✅ `view.js` rebuilt |
| Tailwind | ✅ no new classes needed — gate green, built CSS untouched |
| Backend | ✅ 8-file Laravel slice + frozen `endpoints.md` v1 |
| Backend tested | ✅ **41/41 vs real MySQL** — see below |
| Sweep | ✅ **234/234 both themes, 0 console errors** (231 → 234: the 3 new sub-routes) |

### What the 41 assertions cover

Migrated, seeded 11 jobs (raw-SQL verified by status), then a probe over the
**service**, the **model rules** and the **resource**:

- exact frontend key shape, `assigned_to` exposed as camelCase `assignedTo`,
  optional fields `""` not `null`, soonest-due-first ordering with **undated
  jobs sorting last**;
- **the date rules** — overdue counts only open jobs past due; a Done job that
  *is* past its due date is proven not overdue; an undated job is never overdue;
  and because the clock is **injected**, moving it forward makes more jobs
  overdue and moving it back makes **none** — which is what proves W1 is real
  rather than decorative;
- open + done == total, and the running/blocked/attention/percentage figures;
- **the board covers every job exactly once** across the four columns;
- station load totals tie to the summary, ranking is by open work, and CNC's
  3/2/1/1 split is exact;
- **the orphan job** is kept, counted in the totals and counted in its station;
- create/update-without-duplicate, soft delete, idempotent delete,
  delete-then-revive, company scoping, seeder idempotence.

Probe rows removed; 11 live jobs remain.

## Data

- **Owns:** `wa_production`.
- **Reads, never writes:** `wa_projects` (project name on a job) and the
  employee directory (assignee picker) — frontend only; the backend reads
  neither, so a partially migrated host still serves jobs.
- **Emits:** nothing to the group bridge — a job moves no money.

## Open questions

1. **Material consumption.** Running a job through CNC eats board. Wiring it
   needs the stock-movement table Materials lacks (its gap #1). Until then stock
   is only changed by hand, and this module deliberately does not pretend
   otherwise.
2. **Capacity / scheduling.** "Load" is a count of open jobs. Real scheduling
   needs job durations and shift hours — new fields, and a decision about
   whether the workshop wants that at all.
3. **Drag on the board.** The Projects design studio has drag-to-advance; here
   status changes in the modal. Easy to add; left out to keep the first pass
   honest about scope.

## Log

| Date | What | Commit |
|---|---|---|
| 2026-07-27 | Module built full-stack, #4 of the order: 3 real-HTML screens incl. a board whose four columns are fixed markup and whose cards are proto clones; `api.js` seam owning the open/overdue rules and the demo clock; 8-file Laravel slice with `$today` injected rather than hidden; frozen `endpoints.md` v1; README + context. `wa_production` wired into api.js HYDRATE + WRITABLE. PHP 8/8 lint clean, tw gate green, sweep 234/234 both themes, backend **41/41 vs MySQL**. | — |
