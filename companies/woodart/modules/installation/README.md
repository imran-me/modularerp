# Woodart · Site & Install

The last mile. Delivery to site, fitting, the snag walk and client handover —
the end of the physical chain: Materials → Procurement → Workshop → **Site &
Install** → (Projects bills the handover).

Built to the Woodart standard; `materials` is the reference module.

## Screens

| Route | Tab | What it shows |
|---|---|---|
| `#/woodart/installation` | Schedule | 5 KPIs, a needs-attention banner, and every site visit with a live countdown and open-snag count |
| `#/woodart/installation/snags` | Snag List | The handover queue — only sites with open snags, worst first |
| `#/woodart/installation/teams` | Teams | Open sites per crew (bars + doughnut), snags carried, overdue and handover rate |

Add / edit is a modal on **Schedule Install** or by clicking any row. Delete is
the row action. Both respect `EPAL.perm.can('woodart','installation',…)`.

## Data it owns

| Frontend store | Table | Endpoint |
|---|---|---|
| `wa_installs` | `wa_installs` | `/api/woodart/installation/installs` |

Wired into `platform/data/api.js` **HYDRATE** and **WRITABLE**. The frontend
seam also **reads** `wa_projects` (project name on an install) — never writes it.

## ⚠️ The dual-shape snag count — read this before touching snags

The seeded store has a plain `snags` **number**. The Projects module's snag
modal, the first time a user opens it, migrates that number into an itemised
`snagList` of `{text, done}` and keeps the number in step. **A record in the
wild may carry either shape.**

- **Reading:** `openSnags()` counts un-done items when a list exists, else the
  number. Both the seam (`frontend/api.js`) and the model
  (`backend/Models/Install.php`) implement it. Reading only one shape would make
  this module disagree with the project drawer for exactly the records a user
  has already touched.
- **Writing:** if a list is supplied, the number is **recomputed** from it — a
  stale count sent by a client cannot corrupt the figure the handover queue is
  ordered by. The edit modal here makes the count read-only when a list exists
  and says where to change it.
- **Responding:** `snagList` is omitted when empty, so a never-itemised record
  is byte-for-byte the shape the frontend already had.

## ⚠️ It does not bill the handover — on purpose

Reaching `Handover` does **not** post revenue. `projects/view.js` already owns
"Bill on Handover": it calls `db.postSale('woodart', …)`, moves Woodart *and*
Group finance, and opens a branded invoice. A second posting path here would
**double-bill every project** — the single most damaging thing this module
could do.

It also does not edit individual snag items (the project drawer's modal already
does, and two editors for one list is a bug factory) and does not move project
stage (another module owns that number).

## Files

```
frontend/
  template.html     THE SCREEN — all three tabs as plain HTML. No <script>, no <template>.
  api.js            THE DATA SEAM — the only file naming the store key. Read this first.
  installation.js   behaviour only: fill slots, clone proto rows, wire buttons, draw the chart
view.js             BUILD OUTPUT — never hand-edit
backend/
  endpoints.md      the frozen API contract
  LARAVEL-BLUEPRINT.md   entities, rules, and the honest list of gaps
  routes.php · InstallController.php · Services/ · Models/ · Http/ · migrations/ · Database/Seeders/
context.md          this module's memory — decisions, state, log
```

## Working on it

```bash
node tools/build/build-module.mjs companies/woodart/modules/installation
npm run tw:build && npm run verify:tw     # only if you added a tw- class
node tools/verify/sweep.mjs both
```

Backend, against local Laragon MySQL:

```bash
php artisan migrate --path=../../companies/woodart/modules/installation/backend/migrations
php artisan db:seed --class="Epal\Modules\Woodart\Installation\Database\Seeders\InstallSeeder"
```

## Read next

`companies/woodart/MODULE-STANDARD.md` · `platform/design-system/UI-CONTRACT.md` ·
`companies/woodart/CONTEXT.md`.
