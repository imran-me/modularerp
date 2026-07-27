# Woodart · Procurement — backend blueprint

> **Entities, business rules and invariants.** The ROUTES live in
> `endpoints.md`, frozen and versioned. This document answers *"what is this
> thing and what rules govern it"*.

## Purpose

Buying. Who Woodart buys board, laminate, hardware, finishes and fabric from,
what has been ordered, what has arrived, and what is still owed. It sits
downstream of Materials (which says what is running low) and upstream of the
books: a goods receipt posts DR 1400 Inventory / CR 2000 Accounts Payable.

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

- **It does not post on ORDER, and does not pay the vendor.** A receipt raises
  inventory and a payable; settling that payable needs a bank/cash account this
  module has no business choosing. See the RESOLVED section below and Known gaps.
- **It does not receive stock into `wa_materials`.** Marking an order `Received`
  does not increment material quantities. Doing so needs the stock-movement
  table that Materials does not have yet (its own § Known gaps), and a
  half-built version would make stock silently wrong.
- **It does not do GRN line detail.** An order has a line COUNT, not lines. The
  seeded store never had them and inventing them would be a feature, not a
  rebuild (R3).

## ✅ RESOLVED — the ledger posting (2026-07-27)

This was flagged as an open owner decision. It is now **decided and
implemented**, and it turned out not to need a judgement call at all — the
chart of accounts already in `platform/engines-library/ledger.js` answers all
three questions.

> **Correction to an earlier draft of this document:** it said bought stock was
> "arguably inventory (1200)". **`1200` is Accounts Receivable.** The COA has a
> real **`1400` Inventory** account, and **`2000` Accounts Payable**. The
> mistake mattered, because it made the decision look like a trade-off when the
> accounts make it obvious.

**1 · When?** On **receipt**, never on order. A purchase order is a commitment,
not a transaction; there is nothing to journalise until goods arrive. `Partial`
does **not** post either — the store has no part-received amount (rule 2), so
posting the full value for a partial delivery would overstate inventory. Only
`Received` posts.

**2 · Expense or asset?** **Asset — `1400 Inventory`.** Board sitting in the
workshop is stock, not a cost. It becomes cost (`5000 Cost of Sales`) when it is
consumed on a project, exactly as Travels' COGS-at-sale works.
**This is what dissolves the double-count risk that blocked the decision:** a
receipt touches the BALANCE SHEET while `projects` posts `5000` on the P&L at
sale, so the same money can never be counted twice.

**3 · What pays it?** Nothing yet — the receipt raises the liability,
`CR 2000 Accounts Payable`. Goods receipt and payment are two events, and
settling a vendor needs a bank or cash account this module has no business
choosing. That belongs to the Accounts desk, which owns `EPAL.pay`. See
Known gaps.

### The entry

```
DR 1400  Inventory           order value
CR 2000  Accounts Payable    order value
```

dated the order date, `ref` = the PO number, party = the vendor,
`source: 'procurement'`, id `GL-WPO-<po>`.

**Reversals are real reversals (AUDIT P2).** Un-receiving an order, correcting
the value of a received one, or deleting it posts an equal-and-opposite entry
rather than erasing history. A later re-receipt posts under a fresh id
(`…-R2`, `-R3`) so a corrected delivery never collides with the reversed one.
`glAttempt` on the order records which posting is live — it is bookkeeping
metadata, not a form field, and `saveOrder` carries it across an edit so a
routine save can never orphan a journal entry.

**`bridge.map` was corrected too.** It declared
`material.purchased -> group.expense (5002)`, which is wrong twice over: `5002`
is not in the standard COA, and buying stock is not a group expense. It now
reads `group.inventory (1400)`. (Note for later: `shop`'s
`stock.adjusted -> group.inventory (1200)` in `platform/bridge/bridge.js` has
the same 1200/1400 confusion. Left alone — it is another company's mapping and
not this module's to change.)

**Proven, not asserted:** `node tools/verify/books.mjs receipt` drives the real
seam and asserts that an `Ordered` PO posts nothing, a `Received` one posts
৳120,000 to 1400 and 2000 with **zero** movement on 5000 or 1010, un-receiving
reverses it to zero, and the trial balance still balances.

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
- **Paying the vendor is not built.** The receipt leaves a `2000 Accounts
  Payable` balance per vendor; nothing here settles it. That is the next real
  step and it belongs to the Woodart **accounts** module, which will own
  `EPAL.pay` and the bank/cash accounts: `DR 2000 / CR 1000|1010`, one payment
  document per settlement. Until then the payable is honest and visible.
- **The server does not post yet.** The posting lives in the frontend seam,
  which is where the live app runs today. `platform/backend` already has a real
  `LedgerService::post()`, so the server-side mirror is a small, well-defined
  slice — but it must be written against the SAME entry shape, which is now
  frozen in `endpoints.md`.

## Dependencies

- `platform/backend` `ModuleServiceProvider` — route, migration and class
  auto-discovery.
- Namespace `Epal\Modules\Woodart\Procurement\…` resolves to this folder.
- `EPAL.ledger` (frontend seam) for the goods-receipt posting, and
  `EPAL.bridge` for the `material.purchased` rollup. No cash-kit dependency —
  paying the vendor is the Accounts desk's job.

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
