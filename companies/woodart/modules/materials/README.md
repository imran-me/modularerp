# Woodart · Materials

The material inventory for Woodart Interiors — boards, laminates, hardware,
adhesives, finishes and fabric. What is on hand, what it is worth, and what
needs buying.

**This is the reference module for the Woodart build standard.** If you are
adding another Woodart module, copy the shape of this one.

## Screens

| Route | Tab | What it shows |
|---|---|---|
| `#/woodart/materials` | Stock | The register — 5 KPIs, a low-stock banner, and a searchable/exportable grid. Row actions: **Receive · Issue · History** |
| `#/woodart/materials/movements` | Movements | **The stock ledger** — every receipt, issue, adjustment and wastage, where stock sits by location, and a drift banner if any number stops matching its history |
| `#/woodart/materials/reorder` | Reorder | Everything at or below its reorder level, with refill quantity and estimated cost. Shows an "all clear" state when nothing is low |
| `#/woodart/materials/valuation` | Valuation | Where the money sits — value by category (bars + doughnut) and a highest-value-first register |

Add / edit is a modal on the **New Material** button or by clicking any row.
Delete is the row action on the Stock grid. Both respect
`EPAL.perm.can('woodart','materials',…)`.

## Data it owns

| Frontend store | Table | Endpoint |
|---|---|---|
| `wa_materials` | `wa_materials` | `/api/woodart/materials/stock` |
| `wa_movements` | ⬜ owed | `/api/woodart/materials/movements` |
| `wa_locations` | ⬜ owed | `/api/woodart/materials/locations` |

## ⚠️ Stock is a LEDGER, not a number

Added 2026-07-27. Every other balance in this system refuses to move without a
row explaining it — a bank balance goes through `EPAL.bankTxnApply` — and stock
now works the same way:

- **`Materials.apply()` is the only sanctioned way stock changes.** It writes the
  movement row and the number together. `Materials.save()` saves the *record*
  and must never be used to edit `stock`.
- **The sign belongs to the KIND, not the caller.** A caller passing a positive
  `Issue` would otherwise double the stock it meant to consume, so `apply()`
  derives it.
- **`Materials.reconcile()` proves the invariant**: for every material, the sum
  of its movements equals its stored stock. It returns the rows that disagree —
  an empty array is health, the Movements tab shows a drift banner if it is not,
  and `node tools/verify/books.mjs stock` asserts it.
- **A goods receipt in Procurement moves both.** A PO carries an optional
  `lines` array; receiving it posts `DR 1400 / CR 2000` **and** applies a
  Receipt movement per line. An order with no lines books correctly and moves no
  stock — it genuinely does not say what arrived, and guessing would be worse.

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
