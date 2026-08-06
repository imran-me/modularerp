# NAMING & TERMINOLOGY — the words and the shapes

> **Scope: all of Woodart, and the conventions section applies to any company
> built to this standard.** `MODULE-STANDARD.md` says how a module is
> *assembled*; this file says what things are *called*. Both are frozen — change
> them by editing this file, not by inventing a variant in a new module.
>
> **Why this exists (owner, 2026-07-27):** the first five modules were built
> back to back and their conventions *happen* to agree, because one person wrote
> them in one sitting. Nothing wrote them down, so module #7 could diverge
> legitimately. Worse, the terminology had already drifted — see §3, which lists
> real conflicts in shipped code, not hypothetical ones.

---

## 1 · Naming conventions

### 1.1 Identifiers

| Thing | Rule | Example |
|---|---|---|
| Module id (folder + route) | lower-kebab, **singular domain noun** | `materials`, `procurement`, `installation` |
| Sub-screen id | lower-kebab, one or two words | `stock`, `reorder`, `valuation`, `snags` |
| Frontend store | `wa_` + lower_snake **plural** | `wa_materials`, `wa_purchases`, `wa_clients` |
| Database table | **identical to the store** | `wa_materials` |
| Record id (`ext_id`) | `PREFIX-000`, 3-digit zero-padded, uppercase | `MAT-001`, `CLI-004`, `WPO-008` |
| PHP namespace | `Epal\Modules\Woodart\<StudlyModule>` | `Epal\Modules\Woodart\Procurement` |
| PHP class | Studly **singular** entity | `Material`, `PurchaseOrder`, `Install` |
| Service | `<StudlyModule>Service` — one per module, even with 2 entities | `ProcurementService` |
| Controller | `<Entity>Controller` — one per entity | `VendorController`, `PurchaseOrderController` |
| Seam object (JS) | Studly, **plural or domain noun**, module-private | `Materials`, `Clients`, `Procurement`, `Workshop`, `Installs` |
| Module CSS namespace | `.wa-<module>-…` | `.wa-materials-swatch` |
| Journal entry id | `GL-<PREFIX>-<record>` (+ `-R2`, `-R3` on re-post) | `GL-WPO-008`, `GL-WPO-008-R2` |
| CSV export name | `woodart-<what>.csv` | `woodart-purchase-orders.csv` |

**The `PREFIX` register — claim here before you use one:**

| Prefix | Record | Module |
|---|---|---|
| `MAT` | Material | materials |
| `CLI` | Client | clients |
| `VEN` | Vendor | procurement |
| `WPO` | Purchase order | procurement |
| `JOB` | Workshop job | production |
| `INS` | Install / site visit | installation |
| `WAP` | Project | projects *(pre-existing)* |
| `EST` | Estimate | estimates *(pre-existing)* |
| `SPC` | Space | scope |
| `PHS` | Phase | scope |
| `TPL` | Phase template | scope |

`PHS` is 4-digit (`PHS-0014`), not 3: a project carries a phase per space per
stage, so the series passes 999 on real data. Same exception `MOV` already
takes in materials.

### 1.2 Seam method names

One vocabulary, so a developer who has read one module can read them all.

| Intent | Name | Never |
|---|---|---|
| the whole collection, display order | `all()` / `<domain>()` — e.g. `orders()`, `vendors()`, `jobs()` | `getAll`, `list` |
| one record by id | `find(id)` | `get`, `byId` |
| a filtered subset | a **named business rule** — `belowReorder()`, `snagging()`, `byStatus()` | an inline `.filter()` in a screen |
| a grouped roll-up | `by<Thing>()` — `byCategory()`, `byStation()`, `byTeam()` | `groupBy…`, `…Stats` |
| the header figures | `summary()` | `stats`, `totals`, `kpis` |
| next free id | `nextId()` / `next<Entity>Id()` | `generateId` |
| create or update | `save(rec)` / `save<Entity>(rec)` | `create`, `update`, `upsert` |
| delete | `remove(id)` / `remove<Entity>(id)` | `delete`, `destroy` |
| a boolean rule | `is<Adjective>()` — `isLow()`, `isOpen()`, `isOverdue()` | `checkLow`, `hasOpen` |

**Rules stated once.** Any predicate the UI shows (`low`, `open`, `overdue`,
`outstanding`) is a **named function in the seam and a mirrored method on the
Eloquent model** — never an inline comparison at a call site. Change one, change
the other; both docblocks say so.

### 1.3 Dates and money

- **Money is an integer number of Taka.** No floats, ever (D10). Column type
  `unsignedBigInteger` for values, `integer` where a negative is meaningful.
- **The demo clock is `2026-07-05`**, and it is **explicit**: a `TODAY` constant
  in the seam, a constructor argument on the service. Never a bare `now()` —
  the server must not disagree with the screen about what "overdue" means.
- Business dates (`date`, `due`, `since`, `created_on`) are distinct from
  Eloquent's `created_at` / `updated_at`. Both exist; they mean different things.

---

## 2 · The glossary — one word per concept

**Pick the left column. The right column is banned in new code.**

| Use | Not | Why |
|---|---|---|
| **Client** | customer, buyer | Woodart builds *for* clients. `customer` is the platform-wide sales term used by Master Accounts; keeping them distinct is deliberate — see §3.1. |
| **Vendor** | supplier | One word for who we buy from. §3.2 is the outstanding cleanup. |
| **Purchase order** / **PO** | order, indent | "Order" alone is ambiguous with a client order. |
| **Goods receipt** | GRN, delivery, receiving | The accounting event that posts `DR 1400 / CR 2000`. |
| **Material** | item, stock item, product | "Product" is what Travels sells; Woodart consumes materials. |
| **Job** | task, work order | A workshop job. `task` belongs to the personal Kanban module. |
| **Station** | machine, workcentre | CNC · Cutting · Edge Banding · Assembly · Finishing. |
| **Install** | site visit, delivery, fitting | One record covering the visit through to handover. |
| **Snag** | defect, punch item, issue | The BD/UK fit-out term the business already uses. |
| **Handover** | completion, sign-off, closeout | The moment the client accepts the site. |
| **Estimate** | quote, quotation | The *record* is an estimate; the printed document is a quotation. Both are correct in their place. |
| **Project** | job, site, contract | The thing sold and billed. |
| **Space** | room, sub-project, unit, package, zone, area | A division of a project's scope — Master Bed Room, Kitchen, Lobby. *Space planning* is the interior industry's own term for this breakdown, and unlike "room" it does not lie about a balcony, a corridor or an open-plan zone. Owner decision 2026-08-06. |
| **Phase** | stage, step, task | A stage of work **inside one space** — Design, Electrical, Wood Work, Colour & Paint, Furniture. **`stage` stays reserved** for `wa_projects.stage`, the project's five-value headline field: two words, two levels, no collision. |
| **Kind** *(of a space)* | type, category | Bedroom · Kitchen · Dining · Living · Bath · Balcony · Office · Reception · Retail · Common. It selects the phase template. |
| **Responsible** | assignee, owner *(in UI copy)*, in-charge | The one person accountable for a phase. The field is `ownerId` because it is an `employees.id`; the label a user reads is **Responsible**. |
| **Segment** | type, category *(for clients)* | Client segmentation: Homeowner · Developer · Corporate · Retail. |
| **Category** | type *(for materials/vendors)* | Board · Laminate · Hardware · Adhesive · Finish · Fabric · General. |
| **Open / Outstanding** | pending, active, live | `open` = not in its terminal state. `outstanding` = money still owed. |
| **Orphan** | broken link, missing parent | A record whose parent id no longer exists. Kept and flagged, never hidden. |
| **Unlisted** | unknown, unmatched | A name with no master record. Counted, never dropped. |

### Terminal states — the word "open" means one thing per module

| Module | Record | `open` means | Terminal |
|---|---|---|---|
| procurement | purchase order | status ≠ `Received` | `Received` |
| production | job | status ≠ `Done` | `Done` |
| installation | install | status ≠ `Handover` | `Handover` |
| materials | material | *n/a* — `low` is `stock <= reorder` | — |
| scope | phase | status ≠ `Complete` | `Complete` |

**Module id vs display label.** They may differ where the business word differs
from the domain word, but the pairing is fixed here and nowhere else:

| Module id (URL) | Label (nav) | Why they differ |
|---|---|---|
| `production` | **Workshop** | The domain is production; the room is called the workshop. |
| `installation` | **Site & Install** | The domain is installation; the desk covers site work too. |
| `crm` | **Leads & CRM** | Pre-existing. |
| `estimates` | **Estimates & BOQ** | Pre-existing. |

---

## 3 · Known inconsistencies — the honest list

These are in **shipped code**, found while writing this file. None is a bug
today; each is a trap for the next developer.

### 3.1 `client` vs `customer` — two stores, adjacent concepts
`wa_clients` (Woodart) and `customers` (platform, used by Master Accounts) both
exist. **This is defensible and stays**: a Woodart client is a fit-out client,
while `customers` is the group-wide sales ledger party. **Action:** none, but
the Woodart accounts module must map one to the other explicitly when it lands,
and say so in its blueprint rather than silently reusing either.

### 3.2 `vendor` vs `supplier` — one concept, two words, one module ⚠️
`wa_vendors.name` but `wa_purchases.supplier`, both meaning the same party.
`supplier` is also the column on `wa_materials`. The word `vendor` won (§2), but
the column names are **inherited from the pre-existing seeded stores** and
renaming them is an R2 change touching three tables and their Resources.
**Action:** rename to `vendor` in the same migration that introduces the real
`vendor_id` foreign key — one breaking change, not two. Until then: the
**concept is "vendor"** in all prose, UI and new code; `supplier` survives only
as a column name, and every place it appears says why.

### 3.3 `job` vs `task`
`wa_production.job` and a `tasks` module (personal Kanban). Different things,
similar words. **Action:** none — but never call a workshop job a "task".

### 3.4 `snags` as both a number and a list
`wa_installs.snags` (count) and `snag_list` (itemised). Deliberate and
documented (installation I1–I3), not drift. **Action:** none.

---

## 4 · How to add a word

1. Check §2. If the concept is there, use that word — even if you prefer another.
2. If it is genuinely new, add a row to §2 with the banned alternatives, and
   claim a prefix in §1.1 if it is a record type.
3. If you find a conflict, add it to §3 with a proposed action. **Do not
   silently rename shipped columns** — schedule it behind a migration that is
   already happening.

---

**Related:** `MODULE-STANDARD.md` (how a module is assembled) ·
`platform/design-system/UI-CONTRACT.md` (how it looks) · `CONTEXT.md` (state).
