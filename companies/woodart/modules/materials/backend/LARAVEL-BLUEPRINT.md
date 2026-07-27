# Woodart · Materials — backend blueprint

> **Entities, business rules and invariants.** The ROUTES are deliberately NOT
> here — they live in `endpoints.md`, which is frozen and versioned so the
> frontend can be built against a fixed API surface. This document answers
> *"what is this thing and what rules govern it"*; that one answers
> *"what do I call and what comes back"*.

## Purpose

Woodart Interiors buys boards, laminates, hardware, adhesives, finishes and
fabric, holds them in the workshop, and consumes them on fit-out projects. This
module is the **register of what is on hand, what it is worth, and what needs
buying**. It is the first stop before Procurement raises a purchase order.

## Entity

**Material** — one stock line. Table `wa_materials`.

| Column | Type | Notes |
|---|---|---|
| `id` | bigint PK | Laravel's own key. Never exposed to the client. |
| `ext_id` | string(40) | The FRONTEND id (`MAT-001`). The upsert key. Unique **per company**. |
| `company_id` | string(50) | Frontend company slug, `'woodart'`. Not an FK — a company folder must be droppable. |
| `name` | string(160) | |
| `category` | string(60) | One of the six-value taxonomy. |
| `unit` | string(20) | One of the five-value unit list. |
| `stock` | integer **signed** | Units on hand. |
| `reorder` | unsigned integer | The buy-more line. |
| `unit_cost` | unsigned bigint | **Integer Taka.** |
| `supplier` | string(160) nullable | |
| `created_on` | date nullable | The business date, distinct from `created_at`. |
| `deleted_at` | timestamp | Soft deletes. |

Indexes: `unique(company_id, ext_id)` — the upsert key — and
`index(company_id, category)` for the valuation grouping.

## Business rules

1. **Low stock is `stock <= reorder`** — *at or below*, not strictly below. An
   item sitting exactly on its line already needs buying. Implemented in
   `MaterialService::belowReorder()` / `Material::isLow()` and mirrored in the
   frontend seam. **These are two halves of one rule: change both.**
2. **Refill quantity is `max(0, reorder - stock)`** and estimated refill cost is
   `refill × unit_cost`. It is an *estimate* — the real price is agreed on the
   purchase order, so nothing here posts to the ledger.
3. **Stock value is `stock × unit_cost`.** Simple weighted-average-free
   valuation, matching how the workshop actually prices its own consumption
   today. If FIFO or moving-average is ever needed it is a NEW field and a
   migration, not a redefinition of this one.
4. **Upsert, never duplicate.** The client generates the id and may retry a
   write; `(company_id, ext_id)` makes that safe.
5. **Soft delete, and re-posting revives.** A consumed material is history.
6. **Money never floats.** Integer Taka end to end (owner decision D10).

## What this module does NOT do (deliberately)

- **It does not post to the ledger.** Holding stock is not an expense; the spend
  is booked when Procurement records the purchase (`material.purchased` →
  `group.expense` 5002, already declared in `companies/woodart/bridge.map`).
  Adding a posting here would double-count every board.
- **It does not consume stock against projects.** That is Workshop/Production's
  job and needs a movements table (see below).
- **It does not track batches, bins or serials.** Not how the workshop works.

## Known gaps — the honest list

- **No stock movement history.** Today an edit overwrites the count and leaves
  no trail of *why*. Every other money-moving desk in this ERP posts a row
  explaining a balance change (AUDIT P2), and stock should eventually match
  that: a `wa_material_movements` table (receipt · issue · adjustment ·
  wastage), with `stock` becoming a derived sum. **This is the single most
  valuable next step for this module** and is deliberately out of scope for the
  first pass so the standard could be proven end to end first.
- **No link to BOQ demand.** `estimates` already aggregates a bill of materials;
  cross-referencing it against stock on hand would turn the Reorder tab from
  "what is low" into "what this month's approved work actually needs".
- **No supplier entity.** `supplier` is free text matching the seeded names.
  When the `procurement` module lands it should own a `wa_vendors` table and
  this column becomes a reference.

## Dependencies

- `platform/backend` `ModuleServiceProvider` — route + migration + class
  auto-discovery. Nothing to register centrally.
- Namespace `Epal\Modules\Woodart\Materials\…` resolves to this folder.
- No engine or kit dependency: materials do not touch `EPAL.ledger` or
  `EPAL.pay`, by rule 1 of "what this module does not do".

## Files

```
backend/
├── endpoints.md                 the frozen contract (routes + payloads)
├── LARAVEL-BLUEPRINT.md         this file (entities + rules)
├── routes.php
├── MaterialController.php       thin: validate → delegate → shape
├── Services/MaterialService.php ALL business logic
├── Models/Material.php
├── Http/Requests/StoreMaterialRequest.php
├── Http/Resources/MaterialResource.php
├── migrations/2026_07_27_000100_create_wa_materials_table.php
└── Database/Seeders/MaterialSeeder.php
```
