# Woodart · Procurement — backend blueprint

> **Entities, business rules and invariants.** The ROUTES live in
> `endpoints.md`, frozen and versioned. This document answers *"what is this
> thing and what rules govern it"*.

## Purpose

Buying. Who Woodart buys board, laminate, hardware, finishes and fabric from,
what has been ordered, what has arrived, and what is still owed. It sits
downstream of Materials (which says what is running low) and upstream of the
books (which is where the spend is eventually recorded — see the open decision).

## Entities

**Vendor** — table `wa_vendors`. Name (the join key, indexed), category, contact
details, payment terms.

**PurchaseOrder** — table `wa_purchases`. `supplier` (the vendor **name**, not an
id, indexed), line count, amount in integer Taka, status, date.

Both carry `ext_id` (the frontend id, the upsert key, unique per company),
`company_id` (the frontend slug), timestamps and soft deletes.

**Neither table stores a total.** Vendor spend is derived from the orders.

## Business rules

1. **The order→vendor join is by NAME.** `wa_purchases.supplier` holds a name
   string. This module does not rewrite that store (R2), so it matches on
   `trim` + lowercase in **one** method — `ProcurementService::matchKey()`,
   mirrored by `key()` in the frontend seam.
2. **Outstanding = status is not `Received`.** `Partial` counts as fully
   outstanding. The module does not track a part-received amount; claiming a
   precise figure it does not have would understate what is owed. If part
   receipts are ever needed, that is a `received_amount` column and a GRN
   document, not a reinterpretation of this rule.
3. **An order against an unknown supplier is valid and is counted** — under
   `Unlisted`. See invariant 3 in `endpoints.md` for the reasoning; it is the
   most important rule in this module.
4. **Spend is derived, never stored.**
5. **Upsert, never duplicate**; **soft delete**, and re-posting revives.
6. **Deleting a vendor never deletes their orders.** The orders become
   "unlisted" and the UI says so before the delete happens.

## What this module does NOT do (deliberately)

- **It does not post to the ledger.** See the open decision below — this is the
  one place in the Woodart build where a real accounting choice is owed, and
  guessing it would corrupt the group books.
- **It does not receive stock into `wa_materials`.** Marking an order `Received`
  does not increment material quantities. Doing so needs the stock-movement
  table that Materials does not have yet (its own § Known gaps), and a
  half-built version would make stock silently wrong.
- **It does not do GRN line detail.** An order has a line COUNT, not lines. The
  seeded store never had them and inventing them would be a feature, not a
  rebuild (R3).

## ⚠️ OPEN DECISION — the ledger posting (owner call required)

`companies/woodart/bridge.map` already declares:

```
material.purchased -> group.expense (5002)
```

and the Materials blueprint states that the spend is booked "when Procurement
records the purchase". **That posting is NOT implemented here, on purpose.**
Wiring it changes real money in the group books, and three things must be
decided first — by the owner, not by me:

1. **When does the expense hit?** On the order being raised (accrual, matches
   the PO date) or on receipt (matches when the goods arrived)? These give
   different month-end numbers.
2. **Is it an expense or an asset?** Buying board that sits in the workshop is
   arguably inventory (a balance-sheet asset, 1200) until it is consumed on a
   project — which is how COGS-at-sale already works for Travels. Booking it
   straight to expense 5002 double-counts against the project cost the
   `projects` module already records.
3. **What pays it?** The existing `EPAL.pay` kit expects a bank or cash account
   and posts a real withdrawal; a Net-30 vendor should instead credit a payable.

Until that is settled, Procurement is a complete, honest **register** — every
figure on screen is real and reconciles to the orders — and nothing it does can
distort the group's books.

## Known gaps

- **The name join is the weak point** (same as Clients). The fix is a real
  `vendor_id` foreign key on `wa_purchases`, backfilled from today's names with
  the name kept as a display fallback. Deferred with the same reasoning: it is
  cheaper once the modules that read these stores are rebuilt.
- **No receipt against materials** — see above.
- **No PO line items** — see above.
- **No approval workflow.** A large order should arguably route through
  `EPAL.approvals` (the maker-checker engine already exists). Not wired,
  because the threshold is a business policy nobody has stated.

## Dependencies

- `platform/backend` `ModuleServiceProvider` — route, migration and class
  auto-discovery.
- Namespace `Epal\Modules\Woodart\Procurement\…` resolves to this folder.
- No engine or kit dependency, because of the open decision above.

## Files

```
backend/
├── endpoints.md                     the frozen contract
├── LARAVEL-BLUEPRINT.md             this file
├── routes.php
├── PurchaseOrderController.php      thin — orders
├── VendorController.php             thin — vendors
├── Services/ProcurementService.php  ALL business logic, incl. the name join
├── Models/PurchaseOrder.php · Models/Vendor.php
├── Http/Requests/StorePurchaseOrderRequest.php · StoreVendorRequest.php
├── Http/Resources/PurchaseOrderResource.php · VendorResource.php
├── migrations/2026_07_27_000300_create_wa_procurement_tables.php
└── Database/Seeders/ProcurementSeeder.php
```
