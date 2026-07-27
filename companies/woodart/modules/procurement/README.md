# Woodart · Procurement

Buying. Who Woodart buys board, laminate, hardware, finishes and fabric from,
what has been ordered, what has arrived, and what is still owed.

Built to the Woodart standard; `materials` is the reference module.

## Screens

| Route | Tab | What it shows |
|---|---|---|
| `#/woodart/procurement` | Purchase Orders | 5 KPIs, an outstanding-deliveries banner, and the PO register with an **unlisted-vendor flag** |
| `#/woodart/procurement/vendors` | Vendors | The directory with each vendor's orders, spend and outstanding rolled up |
| `#/woodart/procurement/spend` | Spend | Where the money goes — by category (bars + doughnut) and by vendor |

**New Purchase Order** on the Orders and Spend tabs; the same button becomes
**New Vendor** on the Vendors tab, because that is what you came for. Edit by
clicking any row; delete is the row action. Both respect
`EPAL.perm.can('woodart','procurement',…)`.

## Data it owns

| Frontend store | Table | Endpoint |
|---|---|---|
| `wa_purchases` | `wa_purchases` | `/api/woodart/procurement/orders` |
| `wa_vendors` | `wa_vendors` | `/api/woodart/procurement/vendors` |

Both wired into `platform/data/api.js` **HYDRATE** and **WRITABLE**.

Demo data is seeded two ways, in step: `platform/data/seed-bd.js` (vendors
derived from the supplier names that actually appear on purchase orders and
material lines) and `Database/Seeders/ProcurementSeeder.php`.

## ⚠️ Two things you need to know

**1 · Orders reference a vendor by NAME, not by id.** That is how `wa_purchases`
was already built and this module does not rewrite it (R2). The match is
`trim` + lowercase, defined in exactly two mirrored places:

- `frontend/api.js` → `key()`
- `backend/Services/ProcurementService.php` → `matchKey()`

**2 · An order on a supplier who is not in the vendor master is VALID.** It is
flagged "unlisted" in the register and counted under `Unlisted` in the spend
analysis — never dropped. Money that left the business must appear in the
totals even when the vendor paperwork is behind. Refusing the order, or quietly
excluding it from the analysis, would make the spend numbers wrong.

## ⚠️ Open decision — the ledger posting

`bridge.map` declares `material.purchased -> group.expense (5002)`, but **this
module does not post to the ledger**, on purpose. Three things must be decided
first, and they are accounting choices, not implementation details:

1. Does the expense hit on **order** or on **receipt**?
2. Is bought stock an **expense** or an **asset** until it is consumed? Booking
   straight to 5002 double-counts against the project cost `projects` records.
3. What **pays** it — a bank/cash account now, or a payable for a Net-30 vendor?

Until that is settled, Procurement is a complete, honest **register**: every
figure reconciles to the orders, and nothing here can distort the group books.
Full reasoning in `backend/LARAVEL-BLUEPRINT.md`.

## Files

```
frontend/
  template.html     THE SCREEN — all three tabs as plain HTML. No <script>, no <template>.
  api.js            THE DATA SEAM — the only file naming the store keys. Read this first.
  procurement.js    behaviour only: fill slots, clone proto rows, wire buttons, draw the chart
view.js             BUILD OUTPUT — never hand-edit
backend/
  endpoints.md      the frozen API contract (build the frontend against this)
  LARAVEL-BLUEPRINT.md   entities, rules, the open decision, and the honest gaps
  routes.php · PurchaseOrderController.php · VendorController.php
  Services/ · Models/ · Http/ · migrations/ · Database/Seeders/
context.md          this module's memory — decisions, state, log
```

## Working on it

```bash
node tools/build/build-module.mjs companies/woodart/modules/procurement
npm run tw:build && npm run verify:tw     # only if you added a tw- class
node tools/verify/sweep.mjs both
```

Backend, against local Laragon MySQL:

```bash
php artisan migrate --path=../../companies/woodart/modules/procurement/backend/migrations
php artisan db:seed --class="Epal\Modules\Woodart\Procurement\Database\Seeders\ProcurementSeeder"
```

## What it deliberately does NOT do

**No ledger posting** (see above). **No receipt into `wa_materials`** — marking
an order Received does not increment stock; that needs the movement table
Materials does not have yet, and a half-built version would make stock silently
wrong. **No PO line items** — an order has a line count, not lines; the seeded
store never had them and inventing them would be a feature, not a rebuild (R3).

## Read next

`companies/woodart/MODULE-STANDARD.md` · `platform/design-system/UI-CONTRACT.md` ·
`companies/woodart/CONTEXT.md`.
