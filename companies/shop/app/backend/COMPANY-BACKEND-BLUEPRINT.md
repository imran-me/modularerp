# Epal Shop — company backend blueprint

The company SHELL/API for the Laravel rebuild. It does not own business logic —
each module owns its own (see the per-module `backend/LARAVEL-BLUEPRINT.md`).
This shell composes them, scopes them to `shop`, and emits this company's events UP to the Group via the bridge.

## Identity
- key: `shop` · route prefix: `/shop` · accent `#e0356e`
- 15 modules (menu tree in `companies/shop/module.json`)

## Shell responsibilities (Laravel)
- **Layout / nav** — one Blade layout `layouts/shop.blade.php` that renders the
  sidebar from this company's `module.json` (the menu tree is data, not markup).
- **Routing** — a route group prefixed `/shop` mapping `/{module}/{sub?}`
  to each module's controller (mirrors today's hash routes).
- **Auth scope** — every request scoped to company `shop`; roles/permissions from
  `platform/auth-rbac/` (Laravel: middleware + policies).
- **Theme** — inject `--accent: #e0356e` so the shared design system tints to
  this company (see `app/theme/`).

## Modules (each has its own backend blueprint)
| module | title | backend blueprint |
|--------|-------|-------------------|
| dashboard | Dashboard | — (scaffold; shared wildcard screen) |
| pos | Point of Sale | modules/pos/backend/LARAVEL-BLUEPRINT.md |
| products | Products | — (scaffold; shared wildcard screen) |
| inventory | Inventory | — (scaffold; shared wildcard screen) |
| orders | Orders | — (scaffold; shared wildcard screen) |
| purchases | Purchases | — (scaffold; shared wildcard screen) |
| customers | Customers | — (scaffold; shared wildcard screen) |
| suppliers | Suppliers | — (scaffold; shared wildcard screen) |
| accounts | Accounts | — (scaffold; shared wildcard screen) |
| ledgers | Ledgers | — (scaffold; shared wildcard screen) |
| hrm | HRM | — (scaffold; shared wildcard screen) |
| reports | Reports | — (scaffold; shared wildcard screen) |
| analytics | Analytics | — (scaffold; shared wildcard screen) |
| tasks | My Tasks | — (scaffold; shared wildcard screen) |
| settings | Settings | — (scaffold; shared wildcard screen) |

## Bridge (emits) — see `bridge.map`
- `pos.sale` -> `group.revenue` (acct 4001) — when the owning module records it.
- `purchase.recorded` -> `group.expense` (acct 5002) — when the owning module records it.
- `stock.adjusted` -> `group.inventory` (acct 1200) — when the owning module records it.
- `expense.recorded` -> `group.expense` (acct 5001) — when the owning module records it.
- These fire from the module services; the shell guarantees the event carries
  `company:"shop"` so the Group can attribute it.

## Data
- Today: one shared store (`platform/data/`), company membership is a field on
  records — this is what today's numbers depend on, so it is NOT split in Phase 2.
- Target: this company's own tables/connection (`companies/shop/data/` ->
  Laravel: a per-company schema or a `company_id` scope), so group roll-ups
  match the current figures to the taka.

## Engine dependencies (shared machinery — platform/engines-library/)
- Ledger (double-entry), Serial (document numbers), Audit, Approvals
  (maker-checker), Documents, Intel (analytics), Rules (automation), Comments,
  Search. Laravel: shared Services/Domain packages the company depends on.
