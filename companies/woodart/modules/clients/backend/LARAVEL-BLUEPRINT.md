# Woodart · Clients — backend blueprint

> **Entities, business rules and invariants.** The ROUTES are deliberately NOT
> here — they live in `endpoints.md`, frozen and versioned. This document
> answers *"what is this thing and what rules govern it"*; that one answers
> *"what do I call and what comes back"*.

## Purpose

The people and companies Woodart builds for — homeowners, developers and
corporates. It is the master record behind every project and estimate, and the
place the business answers *"who is worth the most to us, and who has gone
quiet"*.

## Entity

**Client** — table `wa_clients`.

| Column | Type | Notes |
|---|---|---|
| `id` | bigint PK | Laravel's key. Never exposed to the client. |
| `ext_id` | string(40) | The FRONTEND id (`CLI-001`). Upsert key. Unique **per company**. |
| `company_id` | string(50) | Frontend company slug, `'woodart'`. Not an FK — a company folder must be droppable. |
| `name` | string(160) | **Also the join key** to projects/estimates. Indexed. |
| `type` | string(40) | One of the four-value segmentation. Indexed with company. |
| `contact` | string(160) nullable | The person to call at a corporate. |
| `phone` · `email` · `area` | nullable | |
| `since` | date nullable | When they became a client. |
| `created_on` | date nullable | Business date, distinct from `created_at`. |
| `deleted_at` | timestamp | Soft deletes. |

**There is no money column, and that is deliberate** — see rule 2.

## Business rules

1. **The client→work join is by NAME.** `wa_projects.client` and
   `wa_estimates.client` hold a name string, not an id. This module does not get
   to rewrite those stores (R2), so it matches on a normalised name:
   `trim` + lowercase, in **one** method — `ClientService::matchKey()`, mirrored
   by `key()` in the frontend seam. Two implementations of one rule is a bug
   waiting to happen.
2. **A client's value is DERIVED, never stored.** Contract value, cost, margin,
   project count and quote counts are all computed from the work tables on
   read. A stored total would drift the first time a project's value changed;
   a computed one cannot.
3. **A "live" project is any stage that is not `Completed` or `Handover`** —
   the same definition the Projects module uses.
4. **"Repeat client" means more than one project.** "Idle" means no project
   **and** no estimate — a client with an open quote is not idle, they are in
   the pipeline.
5. **Won / open quotes:** `Approved` counts as won; `Draft` and `Sent` count as
   open. `Rejected` counts as neither.
6. **Upsert, never duplicate**, keyed on `(company_id, ext_id)`.
7. **Soft delete, and re-posting revives.** Deleting a client does **not** touch
   their projects or estimates — those belong to other modules. They simply stop
   matching a client, which the UI warns about before the delete.
8. **The work tables are optional.** `Schema::hasTable` guards the roll-up, so a
   host that has migrated Clients but not Projects still gets a working
   directory with zero-value rows.

## What this module does NOT do (deliberately)

- **No ledger posting.** A client is a master record; money moves when a project
  is billed (`project.invoiced` → `group.revenue` 4001, already declared in
  `companies/woodart/bridge.map`).
- **No receivables/ageing.** That is the Accounts and Ledgers modules' job, off
  the real GL — duplicating it here would give two answers to one question.
- **No CRM pipeline.** Leads and enquiries belong to the `crm` module
  (`wa_leads`); this module starts once someone is actually a client.

## Known gaps — the honest list

- **The name join is the weak point.** Rename a client and their history stops
  matching until the projects are renamed too. The fix is a real
  `client_id` foreign key on `wa_projects` / `wa_estimates`, backfilled by
  matching today's names, with the name kept as a display fallback. That is a
  **cross-module migration** touching two modules that are not yet rebuilt, so
  it is deliberately deferred until `projects` and `estimates` are done — doing
  it now would mean migrating them twice.
- **No contact history.** No log of calls, site visits or emails. When `crm`
  lands it should own an activity table that this module reads.
- **No credit terms or limits.** Nothing here says what a client is allowed to
  owe. It belongs with receivables in `accounts`.

## Dependencies

- `platform/backend` `ModuleServiceProvider` — route, migration and class
  auto-discovery. Nothing to register centrally.
- Namespace `Epal\Modules\Woodart\Clients\…` resolves to this folder.
- Reads `wa_projects` and `wa_estimates` **defensively** (via `Schema::hasTable`
  + a raw `DB::table` query), and never writes them.

## Files

```
backend/
├── endpoints.md                 the frozen contract (routes + payloads)
├── LARAVEL-BLUEPRINT.md         this file (entities + rules)
├── routes.php
├── ClientController.php         thin: validate → delegate → shape
├── Services/ClientService.php   ALL business logic, incl. the name join
├── Models/Client.php
├── Http/Requests/StoreClientRequest.php
├── Http/Resources/ClientResource.php
├── migrations/2026_07_27_000200_create_wa_clients_table.php
└── Database/Seeders/ClientSeeder.php
```
