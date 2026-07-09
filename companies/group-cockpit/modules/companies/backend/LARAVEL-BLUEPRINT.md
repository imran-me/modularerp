# Sister Concerns (group/companies) — Laravel backend blueprint

> Source of truth: `companies/group-cockpit/modules/companies/view.js` (single-screen,
> READ-ONLY module) + `platform/data/database.js` (data layer) + `platform/core/config.js`
> (company registry). Route today: `#/group/companies` (module.json). No sub-menus (`menu: []`).

## Purpose & screens
ONE screen: the group portfolio overview — one premium card per enabled operating company.
- **Page head** (view.js:42-53): "Sister Concerns", subtitle = concern count + consolidated
  12-month revenue + blended margin. Actions: "Compare Side-by-Side" (navigates to
  `group/analytics/compare`) and, admins only, "Module Control" (`group/module-manager`).
- **KPI summary strip** (view.js:56-67), each tile a drill link: Portfolio Revenue → group/finance;
  Portfolio Profit (+blended margin) → group/finance/pnl; Active Concerns → group/module-manager;
  Group Workforce → group/employees/directory; Shared Customers → group/crm/customers.
- **Revenue vs Profit bar chart** by concern, trailing 12 months (view.js:70-79, 156-165).
- **Per-concern card** (view.js:86-150): identity (icon/name/tagline), health pill, 12-month
  revenue + MoM trend badge, 12-month revenue spark line, Profit/Margin/Team stats, 0-100 risk
  meter, drill buttons to `<company>/dashboard`, `<company>/analytics`, `<company>/accounts`.
The module WRITES nothing — it is a pure aggregation read over shared stores.

## Entities & fields
This module owns no store; it reads aggregates built from these (localStorage ns `epal.v1.`):
- **Company registry** — today static in `platform/core/config.js` (companies[]); becomes a
  `companies` table: `id:string(pk, e.g. 'travels')`, `name:string`, `short:string`,
  `type:enum(group|company)`, `enabled:bool`, `icon:string`, `accent:string(#hex)`, `tagline:string`.
- **`financials` store** — `{companyId:string, ym:'YYYY-MM', revenue:int, expense:int}` monthly
  summary rows, 12 months × company (database.js:14).
- **`employees` store** — read only for headcounts: filter `companyId`, count (database.js:433-437, 509, 517).
- **`customers` store** — read only for the shared-customer count; a customer links to many
  companies via `companyIds:[]` (database.js:18-19, 439-442, 518).
- **`leads` store** — `groupSnapshot` also derives `openLeads`/`pipelineValue` from `stage`+`value`
  (database.js:519-520); this screen doesn't render them but the endpoint should keep them.
- **Snapshot response shape** consumed by the view (database.js:502-522):
  `companies[]:{id,name,short,accent,icon,revenue,profit,margin,mom,risk,employees,m3revenue}`,
  plus totals `{revenue,profit,margin,headcount,customers,openLeads,pipelineValue}`.
- **Series response** per company (database.js:472-483): `{labels[12], revenue[12], expense[12], profit[12]}`.

## Business rules (all derived, never stored — database.js:58-59)
- `finance(cid, months)`: sum revenue/expense over last N `ym` months; `profit = rev - exp`;
  `margin = rev ? (rev-exp)/rev*100 : 0` (database.js:466-469).
- `momRevenue`: % change of last vs previous month's revenue; 0 if <2 months or prev==0 (database.js:486-490).
- `riskScore` (0-100 composite, database.js:493-499): `marginRisk = max(0, 25 - margin3mo) * 2`;
  `trendRisk = mom < 0 ? min(40, -mom*6) : 0`; `arRisk = 22` for `construction` else `8`
  (seed/demo constant — port as a per-company config value); total capped at 100, rounded.
- Health pill from risk (view.js:34-36): `<30 → Healthy(g)`, `<55 → Watch(y)`, else `At Risk(r)`;
  same thresholds pick meter level low/mid/high (view.js:89).
- Only companies with `type === 'company' && enabled` appear (database.js:504) — the group
  pseudo-company is excluded; toggling `enabled` (Module Manager) drops a concern from the page.
- Profit stat is green when `>= 0`, red `#f0506e` when negative (view.js:124).
- Live data contract: any sale posted via `postSale` rolls into `financials`, so this page must
  always reflect current ledger truth (view.js:13-14; database.js:52-55) — compute, don't cache stale.

## Routes
```
GET /group/companies                 -> page (Blade/Inertia) = snapshot + per-company series
GET /api/group/snapshot              -> groupSnapshot JSON (shape above)
GET /api/companies/{company}/series  -> 12-month {labels,revenue,expense,profit}
```
No POST/PUT/DELETE — the screen performs zero mutations. Drill buttons are plain
redirects to other modules' routes (finance, employees, crm, module-manager, per-company apps).

## Controllers
- `Group\SisterConcernsController@index` — returns the page with `PortfolioReportService::snapshot()`.
- `Api\GroupSnapshotController@show` — JSON snapshot (companies[] + totals).
- `Api\CompanySeriesController@show(Company $company)` — JSON 12-month series for spark/compare charts.

## Models & migrations
- **Company** — fillable `['id','name','short','type','enabled','icon','accent','tagline']`;
  casts `['enabled'=>'boolean']`; string PK, `$incrementing=false`. Migration: `id string pk`,
  `name`, `short`, `type enum(group,company)`, `enabled boolean default true`, `icon`, `accent`,
  `tagline`, `risk_ar_base unsignedTinyInteger default 8` (ports the construction=22 demo constant).
- **Financial** — fillable `['company_id','ym','revenue','expense']`; casts
  `['revenue'=>'integer','expense'=>'integer']`. Migration: `id`, `company_id fk`,
  `ym char(7)`, `revenue bigInteger`, `expense bigInteger`, unique `(company_id, ym)`.
- Employee, Customer (+ `company_customer` pivot for `companyIds[]`), Lead are OWNED by the
  employees/crm modules — this module only queries `count()` / `whereIn('stage',…)->sum('value')`.
- `PortfolioReportService` implements finance/series/mom/risk exactly per the formulas above
  (SQL `GROUP BY company_id, ym`), mirroring database.js:466-522.

## Policies / permissions
- Whole page: authenticated group-level users (it lives in the group cockpit nav).
- The ONLY role gate in the code: the "Module Control" action renders for `EPAL.auth.isAdmin()`
  only (view.js:50-51) → Blade `@can('admin')` / Gate `admin` on that button and on the
  module-manager route it targets. Everything else is read-only viewing.

## Events
None emitted — this module records no money, sales, or state. It is a CONSUMER: rebuild its
numbers when other modules fire `SaleRecorded` / financials-affecting events (the SPA equivalent
is re-render on `data:changed`, database.js:56-57). Cache the snapshot per-request at most.

## Engine dependencies
- `EPAL.db` aggregate helpers only: `groupSnapshot()` (view.js:39) and `series(cid).revenue`
  (view.js:168) → Laravel `PortfolioReportService` (queries over financials/employees/customers/leads).
- `EPAL.auth.isAdmin()` (view.js:50) → Gate/Policy `admin`.
- `EPAL.config.company(id)` for tagline (view.js:87,102) → `Company` model.
- `EPAL.charts` bar/spark + `EPAL.ui`/router are pure frontend — no backend counterpart.
- No ledger/approvals/serial/documents/intel/rules/comments usage in this view.

## Parity checks (acceptance)
- `GET /api/group/snapshot` totals must equal the sum of each company's own finance page — the
  group bridge contract is "group totals match exactly" (repo migration brief, Phase 3).
- For every enabled company: `sum(series.profit) == snapshot.companies[i].profit` and
  `series.labels` are the last 12 calendar months as short month names (database.js:473-482).
- Risk/health of the seeded demo data must reproduce today's pills (construction skews riskier
  via its AR base of 22) so old vs new screenshots stay pixel-identical.
