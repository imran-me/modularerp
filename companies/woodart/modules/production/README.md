# Woodart · Workshop (production)

The shop floor. Every fabrication job Woodart is making, which machine it is on,
who owns it, when it is due and whether it is stuck.

These jobs previously existed only inside the project drawer in
`projects/view.js`. This module gives the workshop its own desk — the same
records, addressable by station and by state, which is how a workshop manager
actually thinks. Built to the Woodart standard; `materials` is the reference.

## Screens

| Route | Tab | What it shows |
|---|---|---|
| `#/woodart/production` | Job Register | 5 KPIs, a needs-attention banner, and the full job grid with a live due-date countdown |
| `#/woodart/production/board` | Workshop Board | The four workshop states side by side — Queued · Running · Blocked · Done. Click a card to open the job |
| `#/woodart/production/load` | Station Load | Open jobs per station (bars + doughnut) and a per-station breakdown of blocked and overdue work |

Add / edit is a modal on **New Job** or by clicking any row or board card.
Delete is the row action. Both respect
`EPAL.perm.can('woodart','production',…)`.

## How the board is built (worth reading once)

The four **columns are fixed HTML** in `template.html` — they are the workshop's
four states, not data. Only the **cards** are cloned, from a single
`[hidden][data-proto]` node. That is exactly the line the build law draws:
fixed structure is markup, 0..N records are a proto clone. The per-column accent
colour is set as an inline style because it is a computed value, not a utility.

## Data it owns

| Frontend store | Table | Endpoint |
|---|---|---|
| `wa_production` | `wa_production` | `/api/woodart/production/jobs` |

Wired into `platform/data/api.js` **HYDRATE** and **WRITABLE**.

The frontend seam also **reads** `wa_projects` (for the project name on a job)
and the employee directory (for the assignee picker) — never writes them.

## ⚠️ Three things you need to know

**1 · The demo clock is explicit.** "Overdue" depends on a date, and this app
runs on a fixed demo date (`2026-07-05`) so seeded data tells a stable story and
the screenshot harness is repeatable. `ProductionService` takes `$today` as a
**constructor argument**, never a hidden `now()`, and `GET /load` echoes it back.
The seam anchors to the same constant. When the app goes live, that default is
the one line that changes.

**2 · A finished job is never overdue**, however late it was. It is done, and
the register should stop shouting about it. `OPEN = status is not Done`;
`OVERDUE = open AND past due`.

**3 · An orphan job is kept and flagged.** `project` holds the project's
frontend id, not a foreign key, and is not validated against the projects table
(which may not even be migrated here). A job whose project has gone shows an
**orphan** badge rather than disappearing — losing real shop-floor history
because a parent record vanished would be worse than showing the problem.

## Files

```
frontend/
  template.html    THE SCREEN — all three tabs as plain HTML, incl. the four fixed board columns
  api.js           THE DATA SEAM — the only file naming the store key. Read this first.
  production.js    behaviour only: fill slots, clone cards into columns, wire buttons, draw the chart
view.js            BUILD OUTPUT — never hand-edit
backend/
  endpoints.md     the frozen API contract
  LARAVEL-BLUEPRINT.md   entities, rules, and the honest list of gaps
  routes.php · JobController.php · Services/ · Models/ · Http/ · migrations/ · Database/Seeders/
context.md         this module's memory — decisions, state, log
```

## Working on it

```bash
node tools/build/build-module.mjs companies/woodart/modules/production
npm run tw:build && npm run verify:tw     # only if you added a tw- class
node tools/verify/sweep.mjs both
```

Backend, against local Laragon MySQL:

```bash
php artisan migrate --path=../../companies/woodart/modules/production/backend/migrations
php artisan db:seed --class="Epal\Modules\Woodart\Production\Database\Seeders\JobSeeder"
```

## What it deliberately does NOT do

**No material consumption** — running a job obviously eats board, but
decrementing `wa_materials` needs the stock-movement table Materials does not
have yet; a half-built version would make stock silently wrong. **No machine
scheduling or capacity** — there are no hours or shifts in the store, and
inventing them would be a feature, not a rebuild (R3); "load" means *count of
open jobs* and the UI says so. **No labour cost** — Payroll owns that. **It does
not drive project progress** — that is set on the project, and deriving it would
change numbers on a screen this module does not own.

## Read next

`companies/woodart/MODULE-STANDARD.md` · `platform/design-system/UI-CONTRACT.md` ·
`companies/woodart/CONTEXT.md`.
