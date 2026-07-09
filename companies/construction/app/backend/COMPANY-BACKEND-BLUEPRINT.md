# Epal Construction — company backend blueprint

The company SHELL/API for the Laravel rebuild. It does not own business logic —
each module owns its own (see the per-module `backend/LARAVEL-BLUEPRINT.md`).
This shell composes them, scopes them to `construction`, and emits this company's events UP to the Group via the bridge.

## Identity
- key: `construction` · route prefix: `/construction` · accent `#e2721b`
- 17 modules (menu tree in `companies/construction/module.json`)

## Shell responsibilities (Laravel)
- **Layout / nav** — one Blade layout `layouts/construction.blade.php` that renders the
  sidebar from this company's `module.json` (the menu tree is data, not markup).
- **Routing** — a route group prefixed `/construction` mapping `/{module}/{sub?}`
  to each module's controller (mirrors today's hash routes).
- **Auth scope** — every request scoped to company `construction`; roles/permissions from
  `platform/auth-rbac/` (Laravel: middleware + policies).
- **Theme** — inject `--accent: #e2721b` so the shared design system tints to
  this company (see `app/theme/`).

## Modules (each has its own backend blueprint)
| module | title | backend blueprint |
|--------|-------|-------------------|
| dashboard | Dashboard | — (scaffold; shared wildcard screen) |
| projects | Projects / Sites | modules/projects/backend/LARAVEL-BLUEPRINT.md |
| tenders | Tenders | — (scaffold; shared wildcard screen) |
| boq | BOQ & Estimation | — (scaffold; shared wildcard screen) |
| materials | Materials | — (scaffold; shared wildcard screen) |
| procurement | Procurement | — (scaffold; shared wildcard screen) |
| equipment | Plant & Assets | — (scaffold; shared wildcard screen) |
| subcontractors | Subcontractors | — (scaffold; shared wildcard screen) |
| labor | Workforce | — (scaffold; shared wildcard screen) |
| quality | Quality & Safety | — (scaffold; shared wildcard screen) |
| accounts | Accounts | — (scaffold; shared wildcard screen) |
| ledgers | Ledgers | — (scaffold; shared wildcard screen) |
| hrm | HRM | — (scaffold; shared wildcard screen) |
| reports | Reports | — (scaffold; shared wildcard screen) |
| analytics | Analytics | — (scaffold; shared wildcard screen) |
| tasks | My Tasks | — (scaffold; shared wildcard screen) |
| settings | Settings | — (scaffold; shared wildcard screen) |

## Bridge (emits) — see `bridge.map`
- `tender.won` -> `group.revenue` (acct 4003) — when the owning module records it.
- `progress.billed` -> `group.revenue` (acct 4001) — when the owning module records it.
- `procurement.spent` -> `group.expense` (acct 5002) — when the owning module records it.
- `labor.paid` -> `group.expense` (acct 5003) — when the owning module records it.
- These fire from the module services; the shell guarantees the event carries
  `company:"construction"` so the Group can attribute it.

## Data
- Today: one shared store (`platform/data/`), company membership is a field on
  records — this is what today's numbers depend on, so it is NOT split in Phase 2.
- Target: this company's own tables/connection (`companies/construction/data/` ->
  Laravel: a per-company schema or a `company_id` scope), so group roll-ups
  match the current figures to the taka.

## Engine dependencies (shared machinery — platform/engines-library/)
- Ledger (double-entry), Serial (document numbers), Audit, Approvals
  (maker-checker), Documents, Intel (analytics), Rules (automation), Comments,
  Search. Laravel: shared Services/Domain packages the company depends on.
