# Woodart · Site & Install (installation) — backend blueprint

> **Entities, business rules and invariants.** The ROUTES live in
> `endpoints.md`, frozen and versioned.

## Purpose

The last mile. Delivery to site, fitting, the snag walk, and client handover.
It is the end of the physical chain: Materials → Procurement → Workshop →
**Site & Install** → (Projects bills the handover).

## Entity

**Install** — table `wa_installs`. One site visit.

| Column | Type | Notes |
|---|---|---|
| `ext_id` | string(40) | The FRONTEND id (`INS-001`). Upsert key, unique per company. |
| `company_id` | string(50) | Frontend slug. Not an FK — the folder must be droppable. |
| `project` | string(40) nullable | The project's **frontend id**, not a DB key. Indexed. |
| `site` · `team` | | Where and who. `team` indexed for the load roll-up. |
| `status` | string(30) | `Scheduled` · `In Progress` · `Snagging` · `Handover`. Indexed. |
| `date` | date nullable | The visit date. |
| `snags` | unsigned int | The **OPEN** snag count. Always authoritative. |
| `snag_list` | json nullable | Itemised `[{text, done}]`, when the record has been itemised. |
| `created_on` | date nullable | Business date. |
| `deleted_at` | timestamp | Soft deletes. |

## Business rules

1. **The dual-shape snag count** — the interesting one. The seeded store has a
   plain `snags` number. The Projects module's snag modal, the first time a user
   opens it, migrates that number into a `snagList` of `{text, done}` and keeps
   the number in step. So a record in the wild may carry **either** shape, and
   both must work:
   - **On read**, `Install::openSnags()` counts the un-done items when a list
     exists and falls back to the number. Reading only one shape would make this
     module disagree with the project drawer for exactly the records a user has
     already touched — the worst half of the data to be wrong about.
   - **On write**, a supplied list always **recomputes** the number. A client
     sending a stale count cannot corrupt the figure the whole handover queue is
     ordered by.
   - **On response**, `snagList` is omitted when empty, so a never-itemised
     record is byte-for-byte the shape the frontend already had.
2. **OPEN = status is not `Handover`.** **OVERDUE = open AND past `date`.** A
   handed-over site is never overdue however late it was.
3. **A clean handover = handed over AND zero open snags.** The two are tracked
   separately on purpose: a site can be marked Handover while snags remain, and
   the business wants to see that, not have it hidden.
4. **The demo clock is explicit** — a constructor argument defaulting to
   `2026-07-05`, echoed by `GET /teams`. Same reasoning as ProductionService.
5. **Team load is ranked by OPEN sites**, not total.
6. **An orphan install is kept and flagged**, never refused — `project` is not
   validated against the projects table.
7. **Upsert, never duplicate**; **soft delete**, and re-posting revives.

## What this module does NOT do (deliberately)

- **It does not bill the handover.** Reaching `Handover` does not post revenue.
  `projects/view.js` already owns "Bill on Handover" — it calls
  `db.postSale('woodart', …)`, moves Woodart *and* Group finance, and opens a
  branded invoice. Adding a second posting path here would **double-bill every
  project**, which is the single most damaging thing this module could do.
- **It does not edit individual snag items.** The itemised list is created and
  ticked off in the project drawer's snag modal, which already exists and works.
  This module reads the list, shows the count, and orders the handover queue by
  it. Building a second snag editor would give two places to change one list.
- **It does not move project stage.** A site reaching Handover does not advance
  `wa_projects.stage`; that is set on the project, and deriving it would change
  numbers on a screen this module does not own.

## Known gaps

- **`project` is a loose reference** (same as Workshop and Clients). Fix is a
  real foreign key once `projects` is rebuilt — doing it now means migrating
  twice.
- **No per-snag ownership or dates.** A snag has text and a done flag, nothing
  else. Adding "raised by / due by" is a schema change and a real feature.
- **No delivery / logistics detail** — no vehicle, no dispatch note. The store
  never had them (R3).
- **Snag editing lives in another module's modal.** That is correct today (one
  editor, one list), but if Site & Install becomes the primary desk for snagging
  the modal should move here and the project drawer should read it.

## Dependencies

- `platform/backend` `ModuleServiceProvider` — route, migration and class
  auto-discovery.
- Namespace `Epal\Modules\Woodart\Installation\…` resolves to this folder.
- The frontend seam additionally reads `wa_projects` (for the project name on an
  install); the backend reads nothing, so a partially migrated host still serves
  the schedule.

## Files

```
backend/
├── endpoints.md                       the frozen contract
├── LARAVEL-BLUEPRINT.md               this file
├── routes.php
├── InstallController.php              thin: validate → delegate → shape
├── Services/InstallationService.php   ALL business logic + the demo clock
├── Models/Install.php                 the open / overdue / dual-shape snag rules
├── Http/Requests/StoreInstallRequest.php
├── Http/Resources/InstallResource.php
├── migrations/2026_07_27_000500_create_wa_installs_table.php
└── Database/Seeders/InstallSeeder.php
```
