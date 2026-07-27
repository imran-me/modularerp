# Woodart · Clients — module context

> This module's memory. Append, never rewrite. Company-level context is
> `companies/woodart/CONTEXT.md`; the recipe is `MODULE-STANDARD.md`.

## Purpose

The master record of who Woodart builds for, and the place the business answers
*"who is worth the most to us, and who has gone quiet"*. Module #2 of the
Woodart build order — chosen after `materials` because it is still a simple
master, but it adds the first **cross-module read**, which is the thing every
later module (procurement, production, installation) will also need.

## Decisions (locked)

| # | Date | Decision | Why |
|---|---|---|---|
| C1 | 2026-07-27 | **The client→work join is by NAME, not id** | `wa_projects.client` / `wa_estimates.client` hold a name string. That is how those stores were built and this module does not get to rewrite them (R2). Normalised (`trim` + lowercase) in exactly two mirrored places: `key()` in the seam, `ClientService::matchKey()` on the server. |
| C2 | 2026-07-27 | **A client's value is DERIVED, never stored** — no money column on `wa_clients` | A stored total drifts the first time a project's value changes; a computed one cannot. |
| C3 | 2026-07-27 | **The work tables are OPTIONAL** — `Schema::hasTable`-guarded | `wa_projects` has no backend yet. A host that migrated Clients but not Projects must still get a working directory, not a 500. |
| C4 | 2026-07-27 | **Deleting a client does NOT delete their projects/estimates** | Those are other modules' records. The UI warns exactly how many will stop matching. |
| C5 | 2026-07-27 | "Live" = any stage except `Completed`/`Handover`; "repeat" = >1 project; "idle" = no project **and** no estimate | Same definitions the Projects module uses. A client with an open quote is pipeline, not idle. |
| C6 | 2026-07-27 | Won = `Approved`; open = `Draft`+`Sent`; `Rejected` counts as neither | Matches the estimate status vocabulary already in `wa_estimates`. |
| C7 | 2026-07-27 | The demo seed is **DERIVED from real project/estimate client names** | A fixed invented list would leave half the directory with zero projects and half the projects with no client — that reads like a broken join rather than seed data. |

## State

| | |
|---|---|
| Frontend | ✅ real HTML — 3 screens (Directory · Portfolio · Segments), zero `<script>`, zero `<template>`, `[hidden][data-proto]` repetition |
| Data seam | ✅ `frontend/api.js` — `wa_clients` appears nowhere else; owns the name join |
| Styling | ✅ every utility Tailwind; component classes kept; one inline style (computed bar width) |
| Registered | ✅ `config.js` + company `module.json` + **own `module.json`** + `index.html` |
| Build | ✅ `view.js` rebuilt |
| Tailwind | ✅ no new classes needed — reused the 24 already in the built CSS, gate green |
| Backend | ✅ 9-file Laravel slice + frozen `endpoints.md` v1 |
| Backend tested | ✅ **37/37 vs real MySQL** — see below |
| Sweep | ✅ **228/228 both themes, 0 console errors** (225 → 228: the 3 new sub-routes) |

### What the 37 assertions actually cover

Migrated + seeded 10 rows (raw-SQL verified), then a probe over the **service and
resource**: exact frontend key shape · optional fields `""` not `null` ·
case-insensitive ordering matching the frontend · create/update-without-duplicate ·
soft delete · idempotent delete · delete-then-revive · company scoping ·
seeder idempotence.

**Both branches of the name join were proven**, which is the part worth having:

- with **no** `wa_projects` table, `portfolio()` returns all 10 clients at zero
  value and marks everyone idle instead of throwing (C3);
- with a temporary `wa_projects` table, the roll-up matches by name **including
  a row written as `'  bashundhara group '`** (case + whitespace), sums value and
  cost, counts live correctly excluding `Completed`/`Handover`, **ignores work
  for a client who does not exist** rather than inventing one, and the segment
  totals tie back to the portfolio total.

Probe rows and the temporary table were removed; the DB is exactly as found
(10 live clients, no `wa_projects`).

## Data

- **Owns:** `wa_clients` (store) → `wa_clients` (table).
- **Reads, never writes:** `wa_projects`, `wa_estimates`.
- **Seeded twice, in step:** `platform/data/seed-bd.js` (derived from the client
  names actually on Woodart projects/estimates) and `ClientSeeder.php`.
- **Emits:** nothing to the group bridge — a client is a master record.

## Open questions

1. **The name join is the weak point.** Rename a client and their history stops
   matching until the projects are renamed too. The fix is a real `client_id`
   foreign key on `wa_projects`/`wa_estimates`, backfilled from today's names,
   with the name kept as a display fallback. It is a **cross-module migration**
   touching two modules that are not yet rebuilt, so doing it now would mean
   migrating them twice — deferred until `projects` and `estimates` are done.
2. **No contact history** (calls, site visits, emails). Belongs to `crm` when it
   lands; this module should read it, not own it.
3. **No credit terms or limits.** Belongs with receivables in `accounts`.

## Log

| Date | What | Commit |
|---|---|---|
| 2026-07-27 | Module built full-stack, module #2 of the Woodart order: 3 real-HTML screens, `api.js` seam owning the name join, 9-file Laravel slice, frozen `endpoints.md` v1, README + context. `wa_clients` added to seed-bd.js (derived) and to api.js HYDRATE + WRITABLE. PHP 8/8 lint clean, tw gate green with no new classes, sweep 228/228 both themes, backend **37/37 vs MySQL** incl. both join branches. | — |
