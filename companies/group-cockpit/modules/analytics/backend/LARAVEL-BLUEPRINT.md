# Business Intelligence (group/analytics) — Laravel backend blueprint

Read-only, cross-company analytics module. It writes NOTHING — every screen is derived live from the
monthly financials store plus employees/leads (view.js:20-21 "everything is computed live"). The Laravel
backend is therefore a set of aggregation endpoints over data owned by other modules, not new tables.

## Purpose & screens
Route `#/group/analytics` with four sub-screens branched on `ctx.subId` (view.js:108-136, module.json menu):
- **Trends** (default, sub=null) — one revenue line per concern painted in its accent + consolidated
  profit-vs-expense area chart; leader KPIs: Fastest Growing (H2-vs-H1 revenue), Highest Margin,
  Biggest MoM Riser / Faller (view.js:144-192). KPI cards drill to `{companyId}/analytics`.
- **Forecast** (`forecast`) — least-squares 3-month revenue projection for the group AND each concern via
  `EPAL.forecast` (view.js:197-289). Focus pill (`?focus=group|{companyId}`) switches the chart series
  (view.js:198,231-238). Table: last-quarter actual, +1/+2/+3 month projections, next-quarter total,
  projected QoQ growth badge (view.js:248-264). KPIs: Group Next Quarter, Projected QoQ, Best/Weakest Trajectory.
- **Compare** (`compare`) — 8-axis scoreboard per concern: revenue, expense, profit, margin, MoM, risk,
  headcount + grouped bar chart (view.js:294-357). Row click drills to `{companyId}/dashboard` (view.js:337).
  KPIs: Revenue/Margin/Growth Leader, Lowest Risk.
- **Heatmap** (`heatmap`) — 12-month × concern revenue grid; each cell's alpha scales to that concern's own
  best month (view.js:401-421); KPIs: group Peak/Softest month, Hottest single cell, Total Heat; plus a
  group-seasonality bar chart (view.js:443-450).
- Header actions on every screen: **Export Snapshot** (CSV of the comparison scoreboard, view.js:88-103,124-126)
  and a shortcut to `group/dashboard`.

## Entities & fields
The module OWNS no store; it READS these (localStorage stores namespaced by platform/data/state.js):
1. `financials` (platform/data/database.js:14) — the only monetary source:
   `companyId: string`, `ym: string 'YYYY-MM'`, `revenue: int`, `expense: int` (one row per company per month, 12 mo).
2. `employees` — used only for headcount counts filtered by `companyId` (database.js:432-437, 509).
3. `leads` — used only inside `groupSnapshot` for openLeads / pipelineValue (`companyId`, `stage`, `value`; database.js:519-520).
4. Company registry (today `EPAL.config.companies`, database.js:504) — `id`, `name`, `short`, `accent`, `icon`,
   `type:'company'`, `enabled: bool`; becomes a `companies` table.
Derived (compute in services, do NOT persist):
- `series(companyId?)` → `{labels[12], revenue[12], expense[12], profit[12]}` (database.js:472-483).
- `finance(companyId?, months?)` → `{revenue, expense, profit, margin}` (database.js:463-469).
- `momRevenue`, `riskScore` (database.js:486-499), `groupSnapshot()` (database.js:502-522) → per-company
  `{id,name,short,accent,icon,revenue,profit,margin,mom,risk,employees,m3revenue}` + group totals
  `{revenue,profit,margin,headcount,customers,openLeads,pipelineValue}`.

## Business rules
- **Forecast** = least-squares linear regression over points with revenue > 0; requires ≥ 3 non-zero months
  else returns `[]` ("Not enough history to project yet", view.js:263); projections floored at 0 and rounded
  (platform/views/shared/company-modules.js:46-56).
- **Projected QoQ** = `(nextQ − lastQ) / lastQ × 100`, null when no forecast or lastQ = 0 (view.js:208).
- **H-growth** (Fastest Growing) = `(sum last 6 mo − sum prior 6 mo) / prior × 100` (view.js:148-149, sumLast view.js:71-77).
- **MoM revenue** = `(lastMonth − prevMonth) / prevMonth × 100`, 0 if < 2 months or prev = 0 (database.js:486-490).
- **Risk score 0-100** = `min(100, round(marginRisk + trendRisk + arRisk))` where
  marginRisk = `max(0, 25 − margin3mo) × 2`, trendRisk = `mom < 0 ? min(40, −mom × 6) : 0`,
  arRisk = 22 for `construction` else 8 (demo AR weight) (database.js:493-499). Risk bands in UI: <30 low, <55 mid, else high (view.js:329).
- **Growth badge tone**: > +2% good, < −2% bad, else warn (view.js:78-82).
- Snapshot includes only companies with `type === 'company' && enabled` (database.js:504).
- **Margin** = `(revenue − expense) / revenue × 100`, 0 when revenue = 0 (database.js:468).
- Heatmap cell alpha = `0.08 + (value / rowMax) × 0.87`, per-row normalisation (view.js:402,412).
- CSV snapshot columns: Company, Revenue 12M, Expense 12M, Profit 12M, Margin %, MoM %, Risk, Headcount + GROUP TOTAL row (view.js:89-95).
- No writes, no statuses, no maker-checker, no serials anywhere in this module.

## Routes
All GET (module is read-only); prefix `/api/group/analytics`, mirroring hash routes in module.json:
```
GET /api/group/analytics/trends      → snapshot + per-company series + leader KPIs
GET /api/group/analytics/forecast?focus={group|companyId} → projections table + focused series+forecast
GET /api/group/analytics/compare     → scoreboard rows + KPI leaders
GET /api/group/analytics/heatmap     → per-company 12-mo series + group series + peak/soft/hottest KPIs
GET /api/group/analytics/snapshot.csv → CSV export (Export Snapshot button)
```

## Controllers
`App\Http\Controllers\Group\AnalyticsController`
- `trends()` — returns `{kpis:{fastest,highestMargin,riser,faller}, companies:[{id,short,accent,series}], groupSeries}`.
- `forecast(Request)` — validates `focus` ∈ group|company ids; returns `{kpis, rows:[{id,short,lastQ,m1,m2,m3,nextQ,growth}], focusSeries:{labels,revenue,forecast[3]}}`.
- `compare()` — returns `{kpis:{revenueLeader,marginLeader,growthLeader,lowestRisk}, rows:[{id,short,name,accent,revenue,expense,profit,margin,mom,risk,employees}]}`.
- `heatmap()` — returns `{kpis:{peakMonth,softMonth,hottestCell,totalHeat}, grid:[{company,series}], groupSeries}`.
- `exportSnapshot()` — streams the CSV above (quote-escaped, group-total footer row).
All numbers computed by `GroupIntelligenceService` (below); nothing is cached-stale — recompute per request
to preserve the "a sale posted anywhere moves these screens instantly" contract (view.js:21).

## Models & migrations
No new tables owned here. Reuse group-finance's model:
- `MonthlyFinancial` — fillable `['company_id','ym','revenue','expense']`; casts `revenue/expense => integer`;
  migration: `id, company_id (fk companies), ym char(7) 'YYYY-MM', revenue bigint, expense bigint,
  unique(company_id, ym), timestamps`. (Mirror of the `financials` store, database.js:14,132.)
- `Company` — `id (string pk), name, short, accent, icon, type, enabled bool` (from config registry).
- `Employee` (company_id fk) and `Lead` (company_id, stage, value) are owned by HRM/CRM modules; this module
  only counts/sums them.

## Policies / permissions
Router gates every module via `EPAL.auth.can(companyId, moduleId)` (platform/core/router.js:101-102); the
permission matrix (platform/auth-rbac/permissions.js) grants owner/admin a full bypass, and role templates
grant `'*/analytics': ['view','export']` (permissions.js:96). Laravel:
- `AnalyticsPolicy@view` — role has `view` on `group/analytics` (or `*/analytics` wildcard); owner/admin via `Gate::before`.
- `AnalyticsPolicy@export` — required for the CSV route only. No create/edit/approve abilities exist here.

## Events
None emitted — this module records no money, sales or documents; it is a pure consumer. It should instead
LISTEN: whenever another module posts revenue/expense into `MonthlyFinancial` (today `bus.emit('data:changed', {store:'financials'})`,
database.js:528), any cached aggregates must invalidate.

## Engine dependencies
- `EPAL.db` aggregations (`groupSnapshot/series/finance/momRevenue/riskScore`, database.js:459-522)
  → `App\Services\GroupIntelligenceService` with the same method names/formulas (SQL GROUP BY ym / company_id).
- `EPAL.forecast` (company-modules.js:45-57) → `App\Services\ForecastService::leastSquares(array $series, int $n)`.
- `EPAL.config.companies` → `Company` Eloquent model / config cache.
- `EPAL.charts`, `EPAL.table`, `ui.*` are frontend-only (Chart.js + table kit) — no backend equivalent needed;
  the API just returns the labelled series/rows shapes above.
