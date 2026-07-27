# Woodart · Design & 3D — backend blueprint

> Entities, business rules and invariants. Routes live in `endpoints.md`.

## Purpose

The **architecture & 3D phase** — the phase the owner named on 2026-07-27 and
the one that had no owner at all. Its work lived in a kanban column called
"Design Studio" and nowhere else: no register, no revisions, no record of what
the client approved or when.

Per `companies/woodart/ROOT-MAP.md` §1: a project moves through phases, and each
delivery phase has ONE module owning the work produced during it. Production
owns fabrication jobs, Installation owns site visits — this owns drawings, 3D
models, their revisions and the client approval that closes the phase.

## Entities

**Drawing** (`wa_drawings`) — a plan, elevation, section, detail, 3D model or
render, carrying its CURRENT revision letter and status.

**Revision** (`wa_revisions`) — one row per revision letter, per action: who
issued it, what the client said, when it was approved.

Both carry `ext_id` (frontend id, upsert key, unique per company), `company_id`,
timestamps and soft deletes. `project` and `designer` are loose references (a
frontend id and a name) — the inherited pattern, see the migration.

**Why the trail is a TABLE and not a JSON column**, when `wa_installs.snag_list`
is a blob: a snag is a checklist item; a revision is **evidence**. Evidence gets
its own row so it can be queried, counted, and never silently rewritten.

## Business rules

1. **Lifecycle:** `Draft → Issued → (Commented → Issued at rev+1) → Approved`.
2. **`Issued` is the only state where the wait is the client's.** Everything
   else is on us. The approval queue is therefore exactly the Issued set, and
   `Commented` is deliberately excluded — that work came back to the designer.
3. **The trail is written by the service, not the caller.** A status or revision
   change records who moved it and when; an edit that changes neither writes no
   row. Same principle as a ledger reversal: a state never moves without a row
   explaining why.
4. **THE PHASE GATE:** a project is design-complete only when it HAS
   deliverables AND every one is Approved. **A project with none has not
   started** — not the same as finished, and never counted as complete. This is
   the rule the rest of the spine will read when `projects` gains its `phase`
   field (ROOT-MAP §2.2).
5. **Deleting a drawing deletes its trail** — orphaned evidence describes a
   record nobody can look at.
6. **The demo clock is injected**, never `now()`.
7. Upsert, never duplicate; soft delete; a re-post revives.

## What this module does NOT do (deliberately)

- **It does not store files.** No PDF, DWG or render binary — only the register
  entry and its trail. File storage is a platform concern (`EPAL.doc` handles
  documents today) and inventing a per-module uploader would fork it.
- **It does not move the project's phase.** It reports whether design is
  complete; `projects` owns the phase field and will read this. Writing to
  another module's record is exactly what the root map forbids.
- **It does not gate Estimates.** Blocking a quotation until design is approved
  is a business policy nobody has stated, and enforcing it would change a
  working screen (R2).
- **No per-revision file diff or markup.** Not in the data, and inventing it
  would be a feature, not a rebuild (R3).

## Known gaps

- **`project` / `designer` are loose references** — same as Workshop and
  Installation. Real foreign keys land with the `projects` rebuild; doing it now
  means migrating twice.
- **No file attachments** — see above. The most likely next request.
- **No client-side portal.** Approvals are recorded by staff on the client's
  behalf. A real client login is a much larger piece.
- **`RevisionController` is read-only**, which is correct — but it means a
  correction to a mis-recorded trail row currently needs a console. Acceptable
  for an audit trail; worth an admin tool later.

## Dependencies

- `platform/backend` `ModuleServiceProvider` — route, migration, class discovery.
- Namespace `Epal\Modules\Woodart\Design\…`.
- The frontend seam also reads `wa_projects` and the employee directory; the
  backend reads neither, so a partially migrated host still serves the register.

## Files

```
backend/
├── endpoints.md · LARAVEL-BLUEPRINT.md · routes.php
├── DrawingController.php            thin
├── RevisionController.php           thin, READ-ONLY by design
├── Services/DesignService.php       ALL logic: lifecycle, phase gate, the trail
├── Models/Drawing.php · Models/Revision.php
├── Http/Requests/StoreDrawingRequest.php
├── Http/Resources/DrawingResource.php · RevisionResource.php
├── migrations/2026_07_27_000600_create_wa_design_tables.php
└── Database/Seeders/DesignSeeder.php
```
