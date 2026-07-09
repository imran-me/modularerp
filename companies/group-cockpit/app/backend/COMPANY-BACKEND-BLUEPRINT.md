# Epal Group — company backend blueprint

The company SHELL/API for the Laravel rebuild. It does not own business logic —
each module owns its own (see the per-module `backend/LARAVEL-BLUEPRINT.md`).
This shell composes them, scopes them to `group`, and consolidates the other companies via the bridge.

## Identity
- key: `group` · route prefix: `/group` · accent `#1A43BF`
- 16 modules (menu tree in `companies/group-cockpit/module.json`)

## Shell responsibilities (Laravel)
- **Layout / nav** — one Blade layout `layouts/group.blade.php` that renders the
  sidebar from this company's `module.json` (the menu tree is data, not markup).
- **Routing** — a route group prefixed `/group` mapping `/{module}/{sub?}`
  to each module's controller (mirrors today's hash routes).
- **Auth scope** — every request scoped to company `group`; roles/permissions from
  `platform/auth-rbac/` (Laravel: middleware + policies).
- **Theme** — inject `--accent: #1A43BF` so the shared design system tints to
  this company (see `app/theme/`).

## Modules (each has its own backend blueprint)
| module | title | backend blueprint |
|--------|-------|-------------------|
| dashboard | Command Center | modules/dashboard/backend/LARAVEL-BLUEPRINT.md |
| briefing | MD Briefing | modules/briefing/backend/LARAVEL-BLUEPRINT.md |
| companies | Sister Concerns | modules/companies/backend/LARAVEL-BLUEPRINT.md |
| finance | Consolidated Finance | modules/finance/backend/LARAVEL-BLUEPRINT.md |
| analytics | Business Intelligence | modules/analytics/backend/LARAVEL-BLUEPRINT.md |
| crm | Group CRM | modules/crm/backend/LARAVEL-BLUEPRINT.md |
| employees | Workforce | modules/employees/backend/LARAVEL-BLUEPRINT.md |
| tasks | Task Oversight | — (scaffold; shared wildcard screen) |
| reports | Reports | modules/reports/backend/LARAVEL-BLUEPRINT.md |
| documents | Document Center | modules/documents/backend/LARAVEL-BLUEPRINT.md |
| approvals | Approvals | modules/approvals/backend/LARAVEL-BLUEPRINT.md |
| automation | Automation | modules/automation/backend/LARAVEL-BLUEPRINT.md |
| activity-log | Activity Log | modules/activity-log/backend/LARAVEL-BLUEPRINT.md |
| notifications | Notifications | modules/notifications/backend/LARAVEL-BLUEPRINT.md |
| module-manager | Module Control | modules/module-manager/backend/LARAVEL-BLUEPRINT.md |
| settings | Settings | modules/settings/backend/LARAVEL-BLUEPRINT.md |

## Bridge (receives) — see `bridge.map`
- Subscribes to every company's rolled-up events and updates the Group
  dashboard + Consolidated Finance. Emits nothing upward.
- CRITICAL (Phase 3): the bridge must reproduce today's group totals EXACTLY
  before the current on-read consolidation is retired (no double-counting).

## Data
- Today: one shared store (`platform/data/`), company membership is a field on
  records — this is what today's numbers depend on, so it is NOT split in Phase 2.
- Target: this company's own tables/connection (`companies/group-cockpit/data/` ->
  Laravel: a per-company schema or a `company_id` scope), so group roll-ups
  match the current figures to the taka.

## Engine dependencies (shared machinery — platform/engines-library/)
- Ledger (double-entry), Serial (document numbers), Audit, Approvals
  (maker-checker), Documents, Intel (analytics), Rules (automation), Comments,
  Search. Laravel: shared Services/Domain packages the company depends on.
