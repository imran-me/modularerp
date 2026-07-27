# Woodart · Procurement — module context

> This module's memory. Append, never rewrite. Company-level context is
> `companies/woodart/CONTEXT.md`; the recipe is `MODULE-STANDARD.md`.

## Purpose

Buying — vendors, purchase orders and where the procurement money goes. Module
#3 of the Woodart build order, and the first to own **two entities**, which is
why it comes after the two single-entity modules: it proves the
one-controller-per-entity / one-shared-service pattern that everything larger
will need.

## Decisions (locked)

| # | Date | Decision | Why |
|---|---|---|---|
| P1 | 2026-07-27 | **An order on a supplier with NO vendor record is VALID and is COUNTED** — flagged "unlisted" in the register, grouped under `Unlisted` in the spend analysis | Money that left the business must appear in the totals even when the vendor master is behind. Refusing the order would mean a real purchase cannot be recorded because the paperwork lags; silently excluding it from the analysis would make the spend numbers quietly wrong. **The most important rule in this module.** |
| P2 | 2026-07-27 | **Outstanding = status is not `Received`. `Partial` counts as FULLY outstanding** | The store has no part-received amount. Claiming a precise figure we do not have would understate what is owed. If part receipts are needed it is a `received_amount` column + a GRN document, not a reinterpretation. |
| P3 | 2026-07-27 | **The order→vendor join is by NAME** (`trim` + lowercase), one definition each side | `wa_purchases.supplier` holds a name string; this module does not rewrite that store (R2). Same pattern as Clients. |
| P4 | 2026-07-27 | **Vendor spend is DERIVED, never stored** — no total column on `wa_vendors` | A stored total drifts the first time an order changes. |
| P5 | 2026-07-27 | **Two controllers, ONE service** | One controller per entity is the house convention (D8), but the rules that matter (the join, outstanding, the roll-ups) span both entities and must have a single implementation. |
| P6 | 2026-07-27 | **Deleting a vendor never deletes their orders** — they become "unlisted" | The orders are real history. The UI states exactly how many and what they are worth before the delete. |
| P7 | 2026-07-27 | The demo seed includes **one deliberately unlisted supplier** (`WPO-008`, Dhaka Glass Co) | So the P1 path has real data on screen and in the tests, instead of being a branch nobody ever sees. |

## ✅ RESOLVED — the ledger posting (2026-07-27)

**Decided and implemented.** It needed no judgement call in the end: the chart
of accounts already answers it. **Correction to my own earlier note below — I
wrote "inventory (1200)"; `1200` is Accounts Receivable.** The COA has a real
`1400 Inventory` and `2000 Accounts Payable`.

- **On receipt only.** A PO is a commitment. `Partial` does not post either —
  there is no part-received amount (P2), so posting the full value would
  overstate stock.
- **`DR 1400 Inventory / CR 2000 Accounts Payable`.** Stock is an ASSET; it
  becomes cost (`5000`) when a project consumes it. **This is what removes the
  double-count risk** — the receipt is on the balance sheet, `projects` posts
  `5000` on the P&L at sale, and the two can never overlap.
- **Paying the vendor is NOT here.** The payable is real and visible; settling
  it needs a bank/cash account that belongs to the accounts desk.
- Reversals are real reversals; a re-receipt posts under a fresh `…-R2` id;
  `glAttempt` (carried across edits by `saveOrder`) records which is live.
- **`bridge.map` corrected** from `group.expense (5002)` — not an account in the
  COA, and buying stock is not an expense — to `group.inventory (1400)`.
- **Proven:** `node tools/verify/books.mjs receipt` drives the real seam.

### (superseded) the original open question

`bridge.map` declares `material.purchased -> group.expense (5002)` and the
Materials blueprint says the spend is booked "when Procurement records the
purchase". **Not implemented, deliberately.** It moves real money in the group
books and three accounting questions are unanswered:

1. **When** — on order (accrual, PO date) or on receipt? Different month-end numbers.
2. **Expense or asset?** Board sitting in the workshop is arguably inventory
   (1200) until consumed on a project — which is how COGS-at-sale already works
   for Travels. Booking straight to 5002 **double-counts** against the project
   cost the `projects` module already records.
3. **What pays it?** `EPAL.pay` posts a real bank/cash withdrawal; a Net-30
   vendor should instead credit a payable.

Guessing any of these corrupts the books, so the module ships as a complete,
honest register instead. Nothing it does can distort group totals.

## State

| | |
|---|---|
| Frontend | ✅ real HTML — 3 screens (Orders · Vendors · Spend), zero `<script>`, zero `<template>`, `[hidden][data-proto]` repetition |
| Data seam | ✅ `frontend/api.js` — owns both store keys and the name join |
| Styling | ✅ every utility Tailwind; component classes kept; one inline style (computed bar width) |
| Registered | ✅ `config.js` + company `module.json` + **own `module.json`** + `index.html` |
| Build | ✅ `view.js` rebuilt |
| Tailwind | ✅ no new classes needed — gate green, built CSS untouched |
| Backend | ✅ 12-file Laravel slice (2 controllers, 2 models, 2 requests, 2 resources, 1 shared service, 1 migration for both tables, seeder, routes) + frozen `endpoints.md` v1 |
| Backend tested | ✅ **40/40 vs real MySQL** — see below |
| Sweep | ✅ **231/231 both themes, 0 console errors** (228 → 231: the 3 new sub-routes) |

### What the 40 assertions cover

Migrated both tables, seeded 5 vendors + 8 orders (raw-SQL verified), then a
probe over the shared **service** and both **resources**:

- exact frontend key shapes for both records · ints not strings · optional
  fields `""` not `null` · newest-first orders · case-insensitive vendor order;
- **the outstanding rule** — total ৳14,99,000, `Partial` counted fully
  outstanding at ৳6,87,000, received + outstanding == value exactly;
- **the unlisted-supplier rule (P1)** — the unknown supplier's ৳58,000 appears
  under `Unlisted`, the category totals **tie to the order total**, and
  `vendorsUsed` counts 6 distinct suppliers against 5 vendor records;
- **the name join** — per-vendor roll-up of orders/value/received/outstanding
  and last-order date, `byVendor` correctly **excludes** the unlisted supplier
  while `byVendor + unlisted == total`, and a supplier written
  `'  timber WORLD bd '` still matches;
- create/update-without-duplicate, soft delete, idempotent delete,
  delete-then-revive, deleting a vendor leaving orders intact, company scoping,
  seeder idempotence.

Probe rows removed; the DB is exactly as seeded.

## Data

- **Owns:** `wa_purchases` + `wa_vendors`.
- **Seeded twice, in step:** `platform/data/seed-bd.js` (vendors DERIVED from
  supplier names on real orders and material lines) and `ProcurementSeeder.php`.
- **Emits:** nothing to the group bridge yet — see the open decision.

## Open questions

1. **The ledger posting** — above. Blocking nothing, but it is the module's
   reason for existing in the accounting sense.
2. **Receipt into stock.** Marking an order `Received` should arguably raise
   `wa_materials` quantities. Needs the movement table Materials does not have
   (its own gap #1); doing it without one would make stock silently wrong.
3. **Approval workflow.** `EPAL.approvals` (maker-checker) exists. A large PO
   should probably route through it — but the threshold is a business policy
   nobody has stated.

## Log

| Date | What | Commit |
|---|---|---|
| 2026-07-27 | Module built full-stack, #3 of the order: 3 real-HTML screens, `api.js` seam owning two stores + the order→vendor name join, 12-file Laravel slice (2 controllers / 1 shared service), frozen `endpoints.md` v1, README + context. New store `wa_vendors` seeded DERIVED; both stores wired into api.js HYDRATE + WRITABLE. PHP 12/12 lint clean, tw gate green, sweep 231/231 both themes, backend **40/40 vs MySQL**. Ledger posting deliberately NOT wired — open decision recorded. | — |
