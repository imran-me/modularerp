# Woodart · Site & Install (installation) — module context

> This module's memory. Append, never rewrite. Company-level context is
> `companies/woodart/CONTEXT.md`; the recipe is `MODULE-STANDARD.md`.

## Purpose

The last mile — delivery, fitting, snagging, handover. Module #5, and the one
that closes the physical chain: Materials → Procurement → Workshop → **Site &
Install**. Like Workshop, these records existed only inside the project drawer;
this gives them a schedule, a handover queue and a crew view.

## Decisions (locked)

| # | Date | Decision | Why |
|---|---|---|---|
| I1 | 2026-07-27 | **The snag count reads BOTH shapes — itemised list first, plain number as fallback** | The seed has a number; the Projects snag modal itemises it on first open. A record may carry either. Reading one shape would make this module disagree with the project drawer for exactly the records a user has touched. |
| I2 | 2026-07-27 | **On write, a supplied list RECOMPUTES the number** — a client-sent count is never trusted | The handover queue is ordered by that figure. A stale count from any client must not be able to corrupt it. |
| I3 | 2026-07-27 | **`snagList` is omitted from the response when empty** | A never-itemised record then looks byte-for-byte like the seeded frontend record. |
| I4 | 2026-07-27 | **This module does NOT bill the handover** | `projects/view.js` already owns "Bill on Handover" — `db.postSale('woodart', …)` + the branded invoice. A second posting path would **double-bill every project**. The most damaging thing this module could have done. |
| I5 | 2026-07-27 | **It does not edit individual snag items** | The project drawer's snag modal already does. Two editors for one list is a bug factory. This module reads the list, shows the count, orders the queue. |
| I6 | 2026-07-27 | **OPEN = not `Handover`; OVERDUE = open AND past date; CLEAN HANDOVER = handed over AND zero snags** | A site can be marked Handover with snags still open, and the business wants to SEE that rather than have it hidden. |
| I7 | 2026-07-27 | **Demo clock injected**, defaulting to `2026-07-05`, echoed by `GET /teams` | Same reasoning as Workshop: the server must never disagree with the screen about what "overdue" means. |
| I8 | 2026-07-27 | An orphan install (project id that no longer exists) is **kept and flagged** | Losing a real site visit because its parent vanished would destroy history. |

## State

| | |
|---|---|
| Frontend | ✅ real HTML — 3 screens (Schedule · Snag List · Teams), zero `<script>`, zero `<template>`, `[hidden][data-proto]` rows |
| Data seam | ✅ `frontend/api.js` — owns the store key, the dual-shape snag rule, open/overdue and the demo clock |
| Styling | ✅ every utility Tailwind; component classes kept; one inline style (computed bar width) |
| Registered | ✅ `config.js` + company `module.json` + **own `module.json`** + `index.html` |
| Build | ✅ `view.js` rebuilt |
| Tailwind | ✅ no new classes needed — gate green, built CSS untouched |
| Backend | ✅ 8-file Laravel slice + frozen `endpoints.md` v1 |
| Backend tested | ✅ **42/42 vs real MySQL** — see below |
| Sweep | ✅ **237/237 both themes, 0 console errors** (234 → 237: the 3 new sub-routes) |

### What the 42 assertions cover

Migrated, seeded 7 installs across every state (raw-SQL verified, including one
with a 4-item snag list), then a probe over the **service**, the **model rules**
and the **resource**:

- **the dual-shape snag count** — a plain-number record counts the number; an
  itemised record counts the **un-done items, not the array length**; and a
  deliberately **stale count (99) sent alongside a 3-item list is recomputed to
  2**, proving I2 rather than assuming it;
- the resource omits `snagList` when never itemised and adds it when present,
  with `snags` derived;
- open + handover == total; overdue counts only open sites past their date; a
  **handed-over site proven to be past its date is not overdue**; an undated
  site is never overdue; and because the clock is injected, moving it forward
  raises the overdue count and moving it back drops it to zero;
- the snag queue holds only sites with open snags, is worst-first, and its total
  ties to the summary; clean handovers = handed over AND zero snags;
- team load totals tie to the summary on sites, open and snags, ranked by open
  work, with the handover rate a percentage of all installs;
- the orphan install is kept and counted;
- create/update-without-duplicate, soft delete, idempotent delete,
  delete-then-revive, company scoping, and seeder idempotence **including that
  a re-run restores INS-005's 4-item list**.

Probe rows removed; 7 live installs remain.

## Data

- **Owns:** `wa_installs`.
- **Reads, never writes:** `wa_projects` (frontend only).
- **Emits:** nothing to the group bridge — billing is the project's job (I4).

## Open questions

1. **Should the snag modal move here?** Today it lives in the project drawer,
   which is correct while there is only one editor. If Site & Install becomes
   the primary snagging desk, the modal should move and the drawer should read
   it — not both.
2. **Per-snag ownership and dates.** A snag currently has text and a done flag.
   "Raised by / due by" is a schema change and a real feature.
3. **Delivery / logistics detail** — no vehicle or dispatch note; the store
   never had them (R3).

## Log

| Date | What | Commit |
|---|---|---|
| 2026-07-27 | Module built full-stack, #5 of the order: 3 real-HTML screens, `api.js` seam owning the dual-shape snag rule + open/overdue + the demo clock, 8-file Laravel slice whose write path recomputes the snag count from the list, frozen `endpoints.md` v1, README + context. `wa_installs` wired into api.js HYDRATE + WRITABLE. PHP 8/8, tw gate green, sweep 237/237 both themes, backend **42/42 vs MySQL**. Handover billing deliberately NOT wired — the projects module already does it and a second path would double-bill. | — |
