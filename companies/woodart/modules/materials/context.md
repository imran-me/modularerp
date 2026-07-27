# Woodart · Materials — module context

> This module's memory. Append, never rewrite. Company-level context is
> `companies/woodart/CONTEXT.md`; the recipe is `MODULE-STANDARD.md`.

## Purpose

The register of what Woodart has in the workshop, what it is worth, and what
needs buying. It sits upstream of Procurement (which raises the actual order)
and upstream of Workshop (which consumes the stock). It is the **first module
built to the Woodart full-stack standard**, chosen precisely because it is one
entity with one table and seeded data — the cheapest possible way to prove the
whole standard end to end before anything expensive depends on it.

## Decisions (locked)

| # | Date | Decision | Why |
|---|---|---|---|
| M1 | 2026-07-27 | **No ledger posting from this module** | Holding stock is not an expense. The spend is booked when Procurement records the purchase (`material.purchased` → 5002). Posting here would double-count every board. |
| M2 | 2026-07-27 | Low stock is **`stock <= reorder`** (at or below, not strictly below) | An item sitting exactly on its line already needs buying. Defined once in `MaterialService`/`Material::isLow()` and mirrored in the frontend seam — two halves of one rule. |
| M3 | 2026-07-27 | Stock value is **`stock × unit_cost`**, no FIFO / moving average | Matches how the workshop actually prices its own consumption. If FIFO is ever needed it is a new field + migration, not a redefinition. |
| M4 | 2026-07-27 | `stock` column is **signed** although the API rejects negative writes | Counts legitimately go negative when issues are recorded before receipts. An unsigned column turns a data problem into a 500. |
| M5 | 2026-07-27 | Deletes are **soft**, and re-posting a deleted code **revives** it | A consumed material is history and the group's books may reference it; the user's intent on re-post is "this exists again", not "fail on the unique index". |
| M6 | 2026-07-27 | `/reorder` and `/valuation` endpoints exist but the SPA does not call them | The SPA computes both from the hydrated store — instant and offline-capable. The endpoints give the rule one authoritative server-side definition, for reports and any future non-SPA client. |
| M7 | 2026-07-27 | Supplier is **free text**, not an entity | `wa_vendors` belongs to Procurement. This column becomes a reference when that module lands. |

## State

| | |
|---|---|
| Frontend | ✅ real HTML — 3 screens, zero `<script>`, zero `<template>`; repetition via `[hidden][data-proto]` |
| Data seam | ✅ `frontend/api.js` — the store key `wa_materials` appears **nowhere** else in the module |
| Styling | ✅ **every utility is Tailwind** (`tw-flex-1`, `tw-font-semibold`, `tw-mt-[6px]`, `tw-text-ink-mute`, `tw-text-[11px]`, `tw-text-ink-dim`, `tw-text-right`, `tw-ml-auto`, `tw-relative`, `tw-h-[260px]`); component classes (`card`, `kpi-card`, `btn`, `page-head`, `badge`, `num`) kept as the universal vocabulary; one inline style (a computed bar width — a value, not a utility) |
| Registered | ✅ `platform/core/config.js` + company `module.json` (`built:true`) + **own `modules/materials/module.json`** + `index.html` |
| Build | ✅ `view.js` rebuilt (first module to compile a `frontend/api.js`) |
| Tailwind | ✅ 7 classes added, regenerated, gate green, **purely additive** (17 → 24 rules, none lost). Every one value-matched to the house token — `tw-mt-[6px]` not `tw-mt-1` (4px), `tw-text-[11px]` not `tw-text-xs` (12px) |
| Backend | ✅ 9-file Laravel slice — routes · thin controller · service · model · migration · FormRequest · Resource · seeder |
| Backend tested | ✅ **26/26 against real MySQL** (Laragon 5.7, DB `modularerp`) — migrated, seeded 12 rows (raw-SQL verified), then a probe over the SERVICE + RESOURCE covering: exact frontend key shape · ints not strings · the `<=` reorder rule incl. the exact boundary · valuation ties to summary · create/update-without-duplicate · soft delete · idempotent delete · **delete-then-revive** · company scoping (another company may reuse `MAT-001`) · seeder idempotence. Probe rows cleaned up; 12 live rows remain. |
| Sweep | ✅ **225/225 both themes, 0 console errors** (222 → 225: the 3 new sub-routes) |

### 🐞 Bug hit and fixed while building (worth knowing)

The module was registered `built:true` but shipped **without its own
`modules/materials/module.json`**. Auto-discovery HEAD-probes exactly that file
to decide whether a folder still exists, so a 404 meant "deleted" — and the boot
sweep failed with **every one of 225 routes rendering empty and ZERO console
errors**, which reads like a catastrophic core break instead of one missing
file. Isolated by sweeping a clean `git worktree` at HEAD (222/222 ✓) and then
copying changed files in one at a time. Written up in `MODULE-STANDARD.md` §8.

## Data

- **Owns:** `wa_materials` (frontend store) → `wa_materials` (table).
- **Seeded twice, kept in step:** `platform/data/seed-bd.js` (demo site) and
  `MaterialSeeder.php` (MySQL).
- **Read by:** nothing else yet. Procurement and Workshop will both read it.
- **Emits:** nothing to the group bridge — see M1.

## Decisions added 2026-07-27 — the movement ledger

| # | Decision | Why |
|---|---|---|
| M8 | **`apply()` is the only way stock changes** — row and number written together | Mirrors `EPAL.bankTxnApply`. A balance without a history is one nobody can explain, which is exactly what the owner hit. |
| M9 | **The sign belongs to the KIND** | A caller passing a positive `Issue` would double stock instead of consuming it. Deriving it makes that impossible. |
| M10 | **`reconcile()` is a first-class function, surfaced in the UI** | The invariant is worth nothing if nobody can check it. The Movements tab shows a drift banner; the healthy state is that the banner is absent. |
| M11 | **A PO's `lines` are OPTIONAL; a receipt with none moves no stock** | Every order seeded before today has no lines. Such an order genuinely does not say WHAT arrived — inventing a guess would be worse than recording nothing. |
| M12 | **Locations are a dimension on the movement, not a second stock column** | Per-location stock stays derivable while `stock` remains one number, so nothing that already reads it breaks (R2). |

## Open questions

1. ~~**Stock movements**~~ → **BUILT 2026-07-27.** `wa_movements` + `wa_locations`,
   wired into Procurement receipts, invariant proven by `books.mjs stock`.
   ◻ **The Laravel slice for both new stores is still owed.**
2. *(original note)* **Stock movements** — the biggest gap. An edit overwrites the count with no
   trail of *why*, which is out of step with every money-moving desk in this ERP
   (AUDIT P2: a balance never moves without a row explaining it). Proposal: a
   `wa_material_movements` table (receipt · issue · adjustment · wastage) with
   `stock` becoming a derived sum. Needs an owner decision on whether stock is
   edited directly or only ever moved.
2. **BOQ demand cross-reference** — `estimates` already aggregates a bill of
   materials. Joining it against stock on hand would turn Reorder from "what is
   low" into "what this month's approved work actually needs".

## Log

| Date | What | Commit |
|---|---|---|
| 2026-07-27 | **Backend proven against real MySQL — 26/26.** One assertion failed first and was MY TEST, not the code: it compared MySQL's row order to PHP's byte-order `sort()`. MySQL's `_ci` collation is case-insensitive and agrees with the frontend's `localeCompare` (*Marine Plywood* before *MDF 12mm*); PHP's `sort()` is the odd one out (`'D'` < `'a'`). Server and client agree — recorded as invariant 8 in `endpoints.md` so nobody "fixes" it later. **All 8 gates now pass.** | — |
| 2026-07-27 | Module built full-stack as the Woodart reference: 3-screen real-HTML frontend + `api.js` seam + 9-file Laravel slice + frozen `endpoints.md`. Wired `wa_materials` into api.js HYDRATE + WRITABLE. Registered in config.js, module.json, index.html. Added `tw-text-right`, regenerated CSS (additive, gate green). | — |
