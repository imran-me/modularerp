# Epal IT Solutions — company backend blueprint

The company SHELL/API for the Laravel rebuild. It does not own business logic —
each module owns its own (see the per-module `backend/LARAVEL-BLUEPRINT.md`).
This shell composes them, scopes them to `it`, and emits this company's events UP to the Group via the bridge.

## Identity
- key: `it` · route prefix: `/it` · accent `#7b5cff`
- 15 modules (menu tree in `companies/it/module.json`)

## Shell responsibilities (Laravel)
- **Layout / nav** — one Blade layout `layouts/it.blade.php` that renders the
  sidebar from this company's `module.json` (the menu tree is data, not markup).
- **Routing** — a route group prefixed `/it` mapping `/{module}/{sub?}`
  to each module's controller (mirrors today's hash routes).
- **Auth scope** — every request scoped to company `it`; roles/permissions from
  `platform/auth-rbac/` (Laravel: middleware + policies).
- **Theme** — inject `--accent: #7b5cff` so the shared design system tints to
  this company (see `app/theme/`).

## Modules (each has its own backend blueprint)
| module | title | backend blueprint |
|--------|-------|-------------------|
| dashboard | Dashboard | — (scaffold; shared wildcard screen) |
| crm | Leads & CRM | — (scaffold; shared wildcard screen) |
| projects | Projects | modules/projects/backend/LARAVEL-BLUEPRINT.md |
| services | Products & SaaS | — (scaffold; shared wildcard screen) |
| clients | Clients | — (scaffold; shared wildcard screen) |
| support | Support Desk | — (scaffold; shared wildcard screen) |
| contracts | Contracts | — (scaffold; shared wildcard screen) |
| timesheets | Timesheets | — (scaffold; shared wildcard screen) |
| accounts | Accounts | — (scaffold; shared wildcard screen) |
| ledgers | Ledgers | — (scaffold; shared wildcard screen) |
| hrm | HRM | — (scaffold; shared wildcard screen) |
| reports | Reports | — (scaffold; shared wildcard screen) |
| analytics | Analytics | — (scaffold; shared wildcard screen) |
| tasks | My Tasks | — (scaffold; shared wildcard screen) |
| settings | Settings | — (scaffold; shared wildcard screen) |

## Bridge (emits) — see `bridge.map`
- `subscription.billed` -> `group.revenue` (acct 4001) — when the owning module records it.
- `project.invoiced` -> `group.revenue` (acct 4002) — when the owning module records it.
- `expense.recorded` -> `group.expense` (acct 5001) — when the owning module records it.
- These fire from the module services; the shell guarantees the event carries
  `company:"it"` so the Group can attribute it.

## Data
- Today: one shared store (`platform/data/`), company membership is a field on
  records — this is what today's numbers depend on, so it is NOT split in Phase 2.
- Target: this company's own tables/connection (`companies/it/data/` ->
  Laravel: a per-company schema or a `company_id` scope), so group roll-ups
  match the current figures to the taka.

## Engine dependencies (shared machinery — platform/engines-library/)
- Ledger (double-entry), Serial (document numbers), Audit, Approvals
  (maker-checker), Documents, Intel (analytics), Rules (automation), Comments,
  Search. Laravel: shared Services/Domain packages the company depends on.
