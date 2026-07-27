# Woodart · Materials

The material inventory for Woodart Interiors — boards, laminates, hardware,
adhesives, finishes and fabric. What is on hand, what it is worth, and what
needs buying.

**This is the reference module for the Woodart build standard.** If you are
adding another Woodart module, copy the shape of this one.

## Screens

| Route | Tab | What it shows |
|---|---|---|
| `#/woodart/materials` | Stock | The register — 5 KPIs, a low-stock banner, and a searchable/exportable grid of every item |
| `#/woodart/materials/reorder` | Reorder | Everything at or below its reorder level, with refill quantity and estimated cost. Shows an "all clear" state when nothing is low |
| `#/woodart/materials/valuation` | Valuation | Where the money sits — value by category (bars + doughnut) and a highest-value-first register |

Add / edit is a modal on the **New Material** button or by clicking any row.
Delete is the row action on the Stock grid. Both respect
`EPAL.perm.can('woodart','materials',…)`.

## Data it owns

| Frontend store | Table | Endpoint |
|---|---|---|
| `wa_materials` | `wa_materials` | `/api/woodart/materials/stock` |

Wired into `platform/data/api.js` **HYDRATE** (reads) and **WRITABLE** (writes),
so in API mode the register is real MySQL data and edits persist.

Demo data is seeded two ways, deliberately kept in step: `platform/data/seed-bd.js`
for the static demo site, and `Database/Seeders/MaterialSeeder.php` for MySQL.

## Files

```
frontend/
  template.html    THE SCREEN — all three tabs as plain HTML. No <script>, no <template>.
  api.js           THE DATA SEAM — the only file naming the store key. Read this first.
  materials.js     behaviour only: fill slots, clone proto rows, wire buttons, draw the chart
view.js            BUILD OUTPUT — never hand-edit
backend/
  endpoints.md     the frozen API contract (build the frontend against this)
  LARAVEL-BLUEPRINT.md  entities, business rules, and the honest list of gaps
  routes.php · MaterialController.php · Services/ · Models/ · Http/ · migrations/ · Database/Seeders/
context.md         this module's memory — decisions, state, log
```

## Working on it

```bash
# after ANY edit under frontend/ — index.html loads view.js, not the sources
node tools/build/build-module.mjs companies/woodart/modules/materials

# if you added a tw- class, regenerate and prove the CSS is safe
npm run tw:build && npm run verify:tw

# the gate
node tools/verify/sweep.mjs both        # 0 console errors, both themes
```

Backend, against local Laragon MySQL:

```bash
php artisan migrate --path=../../companies/woodart/modules/materials/backend/migrations
php artisan db:seed --class="Epal\Modules\Woodart\Materials\Database\Seeders\MaterialSeeder"
```

Routes, classes and migrations are all **auto-discovered** by
`platform/backend` → `ModuleServiceProvider`. Nothing to register centrally;
delete this folder and the module disappears from the menus, the API and the
migrator.

## Depends on

`EPAL.table` (grid) · `EPAL.formModal` (add/edit) · `EPAL.charts.doughnut` ·
`EPAL.ui` · `EPAL.perm`. No ledger or cash-kit dependency — see below.

## What it deliberately does NOT do

**It does not post to the ledger.** Holding stock is not an expense; the spend is
booked when Procurement records the purchase (`material.purchased` →
`group.expense` 5002 in `companies/woodart/bridge.map`). Posting here would
double-count every board.

**It does not yet track stock movements** — an edit overwrites the count with no
trail of why. That is the module's biggest known gap and the most valuable next
step; the reasoning is in `backend/LARAVEL-BLUEPRINT.md` § Known gaps.

## Read next

`companies/woodart/MODULE-STANDARD.md` (how this module is built) ·
`platform/design-system/UI-CONTRACT.md` (how it must look) ·
`companies/woodart/CONTEXT.md` (where it sits in the roadmap).
