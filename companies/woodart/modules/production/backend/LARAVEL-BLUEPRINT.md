# Woodart · Workshop (production) — backend blueprint

> **Entities, business rules and invariants.** The ROUTES live in
> `endpoints.md`, frozen and versioned.

## Purpose

The shop floor. Every fabrication job Woodart is making, which machine it is on,
who owns it, when it is due and whether it is stuck. It sits between Projects
(which says what has been sold) and Site & Install (which fits it).

Today these jobs are only visible inside the project drawer in
`projects/view.js`. This module gives the workshop its own desk — the same
records, addressable by station and by state, which is how a workshop manager
actually thinks.

## Entity

**Job** — table `wa_production`.

| Column | Type | Notes |
|---|---|---|
| `id` | bigint PK | Laravel's key. Never exposed. |
| `ext_id` | string(40) | The FRONTEND id (`JOB-001`). Upsert key, unique per company. |
| `company_id` | string(50) | Frontend slug, `'woodart'`. Not an FK — the folder must be droppable. |
| `job` | string(160) | What is being made. |
| `project` | string(40) nullable | The project's **frontend id**, not a DB key. Indexed. |
| `station` | string(60) | One of five. Indexed with company. |
| `assigned_to` | string(160) nullable | A person's **name**, not an employee id. |
| `status` | string(30) | `Queued` · `Running` · `Blocked` · `Done`. Indexed. |
| `due` | date nullable | |
| `created_on` | date nullable | Business date, distinct from `created_at`. |
| `deleted_at` | timestamp | Soft deletes. |

**No money columns.** A job costs nothing here; labour and material cost belong
to the project.

## Business rules

1. **OPEN = status is not `Done`.**
2. **OVERDUE = open AND past `due`.** A finished job is never overdue however
   late it was — it is done, and the register should stop shouting about it.
   Both live in `Job::isOpen()` / `Job::isOverdue()` and are mirrored in the
   frontend seam. **Change one, change the other.**
3. **The demo clock is explicit.** `ProductionService` takes `$today` as a
   constructor argument defaulting to `2026-07-05`, and `GET /load` echoes it
   back. A hidden `now()` would make the server disagree with a screen that
   anchors to the same constant, and would make the screenshot harness
   unrepeatable. This is the single line that changes when the app goes live.
4. **Station load is ranked by OPEN jobs**, not total — finished work is history
   and does not compete for a machine.
5. **An orphan job is kept and flagged.** `project` is not validated against the
   projects table (which may not be migrated on this host). Losing a real job
   because its parent record vanished would destroy shop-floor history; showing
   it as "orphan" surfaces the data problem instead of hiding it.
6. **Upsert, never duplicate**; **soft delete**, and re-posting revives.

## What this module does NOT do (deliberately)

- **It does not consume materials.** Running a job through CNC obviously eats
  board, but decrementing `wa_materials` needs the stock-movement table
  Materials does not have yet (its own § Known gaps). A half-built version would
  make stock silently wrong, which is worse than not doing it.
- **It does not schedule machine time or capacity.** There are no hours,
  durations or shifts in the store, and inventing them would be a feature, not
  a rebuild (R3). "Load" here means *count of open jobs*, and the UI says so.
- **It does not post labour cost.** Payroll owns that.
- **It does not drive project progress.** `wa_projects.progress` is set on the
  project, not derived from its jobs. Making it derived would change numbers on
  a screen this module does not own.

## Known gaps

- **`project` and `assigned_to` are loose references.** The fix is real foreign
  keys once `projects` is rebuilt and the employee directory is the single
  source for people. Same reasoning as Clients and Procurement: doing it now
  means migrating twice.
- **No job duration / capacity model** — see above. This is the natural next
  step if the workshop ever needs real scheduling rather than a load count.
- **The board does not drag.** The Projects design studio has drag-to-advance;
  here the status changes in the job modal. Adding drag is easy and was left
  out to keep the first pass honest about scope.

## Dependencies

- `platform/backend` `ModuleServiceProvider` — route, migration and class
  auto-discovery.
- Namespace `Epal\Modules\Woodart\Production\…` resolves to this folder.
- The frontend seam additionally reads `wa_projects` (for the project name on a
  job) and the employee directory (for the assignee picker); the backend reads
  neither, so a partially migrated host still serves jobs.

## Files

```
backend/
├── endpoints.md                     the frozen contract
├── LARAVEL-BLUEPRINT.md             this file
├── routes.php
├── JobController.php                thin: validate → delegate → shape
├── Services/ProductionService.php   ALL business logic + the demo clock
├── Models/Job.php                   the open / overdue rules
├── Http/Requests/StoreJobRequest.php
├── Http/Resources/JobResource.php
├── migrations/2026_07_27_000400_create_wa_production_table.php
└── Database/Seeders/JobSeeder.php
```
