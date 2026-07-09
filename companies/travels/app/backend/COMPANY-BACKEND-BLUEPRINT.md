# Epal Travels & Consultancy — company backend blueprint

The company SHELL/API for the Laravel rebuild. It does not own business logic —
each module owns its own (see the per-module `backend/LARAVEL-BLUEPRINT.md`).
This shell composes them, scopes them to `travels`, and emits this company's events UP to the Group via the bridge.

## Identity
- key: `travels` · route prefix: `/travels` · accent `#2f6bff`
- 18 modules (menu tree in `companies/travels/module.json`)

## Shell responsibilities (Laravel)
- **Layout / nav** — one Blade layout `layouts/travels.blade.php` that renders the
  sidebar from this company's `module.json` (the menu tree is data, not markup).
- **Routing** — a route group prefixed `/travels` mapping `/{module}/{sub?}`
  to each module's controller (mirrors today's hash routes).
- **Auth scope** — every request scoped to company `travels`; roles/permissions from
  `platform/auth-rbac/` (Laravel: middleware + policies).
- **Theme** — inject `--accent: #2f6bff` so the shared design system tints to
  this company (see `app/theme/`).

## Modules (each has its own backend blueprint)
| module | title | backend blueprint |
|--------|-------|-------------------|
| dashboard | Dashboard | modules/dashboard/backend/LARAVEL-BLUEPRINT.md |
| crm | CRM | — (scaffold; shared wildcard screen) |
| vendor-agent | Vendor & Agent | modules/vendor-agent/backend/LARAVEL-BLUEPRINT.md |
| air-ticketing | Air Ticketing | modules/air-ticketing/backend/LARAVEL-BLUEPRINT.md |
| contract-flight | Contract Flight | modules/contract-flight/backend/LARAVEL-BLUEPRINT.md |
| visa-processing | Visa Processing | modules/visa-processing/backend/LARAVEL-BLUEPRINT.md |
| file-management | File Management | — (scaffold; shared wildcard screen) |
| passport-mgmt | Passport Mgmt | — (scaffold; shared wildcard screen) |
| customers | Customers | — (scaffold; shared wildcard screen) |
| accounts | Accounts | — (scaffold; shared wildcard screen) |
| ledgers | Ledgers | — (scaffold; shared wildcard screen) |
| hrm | HRM | — (scaffold; shared wildcard screen) |
| reports | Reports | — (scaffold; shared wildcard screen) |
| analytics | Analytics | — (scaffold; shared wildcard screen) |
| marketing | Marketing | modules/marketing/backend/LARAVEL-BLUEPRINT.md |
| automation | Automation | — (scaffold; shared wildcard screen) |
| tasks | My Tasks | — (scaffold; shared wildcard screen) |
| settings | Settings | — (scaffold; shared wildcard screen) |

## Bridge (emits) — see `bridge.map`
- `ticket.sold` -> `group.revenue` (acct 4001) — when the owning module records it.
- `visa.approved` -> `group.revenue` (acct 4002) — when the owning module records it.
- `payment.received` -> `group.cash` (acct 1001) — when the owning module records it.
- `expense.recorded` -> `group.expense` (acct 5001) — when the owning module records it.
- These fire from the module services; the shell guarantees the event carries
  `company:"travels"` so the Group can attribute it.

## Data
- Today: one shared store (`platform/data/`), company membership is a field on
  records — this is what today's numbers depend on, so it is NOT split in Phase 2.
- Target: this company's own tables/connection (`companies/travels/data/` ->
  Laravel: a per-company schema or a `company_id` scope), so group roll-ups
  match the current figures to the taka.

## Engine dependencies (shared machinery — platform/engines-library/)
- Ledger (double-entry), Serial (document numbers), Audit, Approvals
  (maker-checker), Documents, Intel (analytics), Rules (automation), Comments,
  Search. Laravel: shared Services/Domain packages the company depends on.
