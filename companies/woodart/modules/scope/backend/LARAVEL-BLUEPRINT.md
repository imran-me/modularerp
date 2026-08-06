# Woodart · Spaces & Phases (`scope`) — Laravel blueprint

**Status: SPEC — the PHP slice is not written yet (slice 6 of
`companies/woodart/PROJECT-BREAKDOWN-PLAN.md`).** The frozen API surface lives in
`endpoints.md` and this file carries the entities, the business rules and the
invariants. Routes are **not** here on purpose — they live in the contract.

> Written to be handed to a Laravel developer with no prior context.
> Conventions: `companies/woodart/MODULE-STANDARD.md` §7 (one thin controller per
> entity, business logic in a Service, Form Requests, API Resources, seeders).

## Namespace

`Epal\Modules\Woodart\Scope`

## Entities

### `Space` — table `wa_spaces`

| Column | Type | Notes |
|---|---|---|
| `id` | `string(16)` primary | `SPC-000` series, client-generated, upserted |
| `company_id` | `string(24)` index | always `woodart`; stamped by the service |
| `project` | `string(16)` index | FK → `wa_projects.id` |
| `name` | `string(80)` | |
| `kind` | `string(24)` | one of the ten kinds in `endpoints.md` |
| `area` | `unsignedInteger` | square feet, `0` = not measured |
| `sort` | `unsignedSmallInteger` | order within the project |
| `note` | `text` nullable | |
| `created` | `date` nullable | the business date, distinct from `created_at` |

### `Phase` — table `wa_phases`

| Column | Type | Notes |
|---|---|---|
| `id` | `string(16)` primary | `PHS-0000` series |
| `company_id` | `string(24)` index | |
| `project` | `string(16)` index | **derived from the space**, never trusted from the client |
| `space` | `string(16)` index | FK → `wa_spaces.id`, `on delete cascade` |
| `name` | `string(60)` | |
| `code` | `string(40)` nullable | FK-ish → `wa_cost_codes.id`; nullable because a phase may be planned before its head is chosen |
| `sort` | `unsignedSmallInteger` | |
| `status` | `string(16)` | `Not started · Active · Complete` |
| `owner_id` | `string(16)` nullable | → `employees.id`. Exposed as `ownerId` |
| `start` / `finish` | `date` nullable | |
| `note` | `text` nullable | |

### `PhaseTemplate` — table `wa_phase_templates`

| Column | Type | Notes |
|---|---|---|
| `id` | `string(16)` primary | `TPL-000` |
| `company_id` | `string(24)` | |
| `kind` | `string(24)` unique per company | the space kind this list belongs to |
| `sort` | `unsignedSmallInteger` | |
| `phases` | `json` | `[{ "name":"Design", "code":"Design Fee" }, …]` |

**`wa_phases` already exists in the frontend seed and changed shape on
2026-08-06** — it was project-level and read by no screen. The migration that
introduces `space` is therefore additive-then-backfill, not a rename: add
`space`, backfill from the project's first space (or drop the rows in a demo
database), then make it non-nullable.

## Business rules (mirror the seam exactly — `frontend/api.js`)

Each rule is a **named method on the Service and a mirrored scope/method on the
Model**, never an inline comparison at a call site. Change one, change the other;
both docblocks say so.

| Rule | Definition |
|---|---|
| `Phase::isOpen()` | `status !== 'Complete'` — the module's one meaning of "open" |
| `Phase::isOverdue($today)` | open **and** `finish` is set **and** `finish < $today`. `$today` is a constructor argument on the service, never `now()` |
| `Phase::isUnassigned()` | `owner_id` is null or `''` |
| `ScopeService::progressOf($space)` | phases complete ÷ phases total. **Slice 2 changes this to weight by phase cost** — one method, one place |
| `ScopeService::statusOf($space)` | all complete → `Complete`; any not-`Not started` → `Active`; else `Not started`. Derived, never stored |
| `ScopeService::applyTemplate($space)` | writes only the template phases whose **name** the space does not already carry (case-insensitive); returns the rows written |
| `ScopeService::load($today)` | every person on the `woodart` + `group` roster with their open-phase counts, plus the unassigned queue |

## Invariants the tests must prove

1. A phase's `project` always equals its space's `project`, even when the client
   sends a different one.
2. Deleting a space deletes its phases — no orphan survives the transaction.
3. `apply-template` twice in a row writes nothing the second time and leaves
   assigned/completed phases untouched.
4. `isOverdue` moves with an injected clock: the same row is overdue at one
   `$today` and not at another, and a `Complete` phase is never overdue.
5. Nothing derived is ever persisted — `progress`, `statusOf`, the summary and
   the load are recomputed on read, and no column exists to hold them.
6. Company scoping: a `woodart` token cannot read or write another company's
   spaces or phases.

## Files (when the slice is written)

```
routes.php
SpaceController.php · PhaseController.php · PhaseTemplateController.php   (thin)
Http/Requests/StoreSpaceRequest.php · StorePhaseRequest.php
Http/Resources/SpaceResource.php · PhaseResource.php
Services/ScopeService.php                    ← every rule above lives here
Models/Space.php · Phase.php · PhaseTemplate.php
migrations/…_create_wa_spaces_table.php
migrations/…_create_wa_phase_templates_table.php
migrations/…_add_space_to_wa_phases_table.php
Database/Seeders/PhaseTemplateSeeder.php     ← mirrors platform/data/seed-bd.js exactly
```

## Bridge

**None.** This module records no money, so it emits no event and appears nowhere
in `companies/woodart/bridge.map`. Revenue still posts only from `projects`
("Bill on Handover"); vendor and contractor payment only from `accounts`.
