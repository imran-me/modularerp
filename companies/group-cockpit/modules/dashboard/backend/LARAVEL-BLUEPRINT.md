# Group Command Center (group/dashboard) — Laravel backend blueprint

Source of truth: `companies/group-cockpit/modules/dashboard/view.js` (+ aggregations in
`platform/data/database.js` L463–522). This module is **read-only BI**: it owns no store of its
own — it consolidates data written by other modules and exports one document. Route today:
`#/group/dashboard` (module.json).

## Purpose & screens
Single screen, the owner's consolidated group view (view.js L24–221). Sections, in DOM order:
1. **Head + period pills** — greeting from `EPAL.auth.current().name`, 12M/6M/3M pills that
   re-filter KPIs + charts client-side (L47–66), Export button, link to `group/module-manager`.
2. **MD Briefing teaser** — `EPAL.intel.mdBriefing()` narrative + headline chips, link to
   `group/briefing` (L263–296).
3. **Anomaly Radar** — `EPAL.intel.anomalies()` sorted high→med→low, top 7, each row deep-links
   to `anomaly.route` (L300–330).
4. **KPI hero (5 tiles)** — Group Revenue, Net Profit, Blended Margin, Workforce, Pipeline Value;
   each drills to another module route (L76–94).
5. **Charts** — area trend (revenue/expense/profit + 2-month dashed least-squares projection via
   `EPAL.forecast`, L166–189), revenue-mix doughnut per company (L191–199), horizontal profit
   ranking bar sorted desc (L201–212).
6. **Sister-concern performance strip** — one card per enabled company; click → company home
   (`EPAL.app.gotoCompany`, L116–134).
7. **Risk Radar & Alerts** — top-3 companies by risk + latest 4 notifications (L379–405).
8. **Smart Signals** — computed digests: fastest riser / bleeder by MoM, best margin, top client
   by lifetime value, weakest employee by rating (excl. role `owner`) (L409–441).
9. **Group Activity timeline** — latest 6 activity rows (L443–455).

## Entities & fields (read-only consumers; localStorage ns `epal.v1.`)
- **financials** (store `financials`) — `companyId:string`, `ym:string "YYYY-MM"`,
  `revenue:decimal`, `expense:decimal`. Basis of finance/series/snapshot (database.js L463–483).
- **employees** (store `employees`) — `id`, `companyId`, `name`, `role`, `designation`,
  `rating:float`, `dept`. Used for headcount + weakest-performer signal (view.js L88, L413).
- **customers** (store `customers`) — `id`, `name`, `value:decimal` (lifetime),
  `companyIds:string[]`. Top-client signal (view.js L412, L435–436).
- **leads** (store `leads`) — `companyId`, `stage:enum(New,Contacted,Qualified,Proposal,
  Negotiation,…)`, `value:decimal`. openLeads / pipelineValue (database.js L519–520).
- **notifications** (store `notifications`) — `title`, `text`, `level`, `icon`, `at:timestamp`;
  sorted desc by `at` (view.js L381, L396–402).
- **activity** (store `activity`) — `id`, `at:timestamp`, `actor`, `text`, `companyId`;
  sorted desc (view.js L444–452).
Derived per-company snapshot row (not stored): `{id, name, short, accent, icon, revenue, profit,
margin, mom, risk, employees, m3revenue}` (database.js L505–511).

## Business rules (all in code)
- **finance(companyId?, months?)** = Σ revenue/expense over filtered `financials` rows;
  `profit = rev − exp`; `margin = profit/rev·100`, 0 when rev=0 (database.js L463–469).
- **series()** = 12 calendar months, zero-filled for missing months (L472–483).
- **momRevenue** = `(last − prev)/prev·100`, 0 if <2 points or prev=0 (L486–490).
- **riskScore (0–100)** = `min(100, round(max(0, 25−margin3M)·2 + (mom<0 ? min(40,−mom·6) : 0)
  + arRisk))`; arRisk hard-coded 22 for `construction`, else 8 (L493–499).
- **Snapshot scope**: only companies with `type==='company' && enabled` (L504) — Module Control
  toggles must change group totals.
- **pipelineValue** = Σ `value` of leads in stage Qualified/Proposal/Negotiation; **openLeads**
  counts those plus New/Contacted (L519–520).
- **Health bands** on risk: `<30` Healthy/low, `<55` Watch/mid, else At Risk/high (view.js L118).
- **KPI trend chip**: MoM pct; dir up if >+0.5%, down if <−0.5%, else flat (view.js L227–232).
- **Forecast**: 2-point least-squares projection appended to revenue line, display-only (L169).
- **Export serial**: `EPAL.serial.next('GRP', {})` — group report serial sequence (L337).
- **Export audit**: records `{action:'export', entity:'report', entityId:'group-snapshot',
  companyId:'group'}` (L371–374).

## Routes (RESTful mirror)
| Verb | URI | Purpose |
|---|---|---|
| GET | /api/group/dashboard/snapshot | groupSnapshot payload (companies[], totals, headcount, openLeads, pipelineValue) |
| GET | /api/group/dashboard/series?months=12\|6\|3 | consolidated monthly labels/revenue/expense/profit |
| GET | /api/group/dashboard/finance/{companyId}?months=N | per-company finance sums (mix + ranking charts) |
| GET | /api/group/dashboard/briefing | MD briefing teaser (intel service) |
| GET | /api/group/dashboard/anomalies | severity-ranked anomalies (top 7) |
| GET | /api/group/dashboard/signals | smart signals digest |
| GET | /api/group/dashboard/activity?limit=6 | latest activity rows |
| GET | /api/group/dashboard/alerts?limit=4 | latest notifications + top-3 risk companies |
| POST | /api/group/dashboard/export | generate Group Snapshot document (serial + audit) |

## Controllers
- **GroupDashboardController**
  - `snapshot()` → SnapshotResource: `{companies:[{id,short,revenue,profit,margin,mom,risk,employees}], revenue, profit, margin, headcount, customers, openLeads, pipelineValue}`.
  - `series(Request)` → `{labels[], revenue[], expense[], profit[]}` for N∈{3,6,12}.
  - `companyFinance(companyId, Request)` → `{revenue, expense, profit, margin}`.
  - `briefing()` / `anomalies()` / `signals()` → delegate to IntelService; return arrays/DTOs.
  - `activity()` / `alerts()` → latest rows, desc by timestamp.
- **GroupSnapshotExportController**
  - `store()` → allocates serial `GRP-…`, builds document payload (parties/meta/columns/rows/
    totals mirroring view.js L338–370), writes audit row, returns PDF/print payload.

## Models & migrations (owned by other modules; dashboard only queries)
- `Financial` — fillable `[company_id, ym, revenue, expense]`; casts `revenue/expense:decimal:2`;
  migration: id, company_id (string, indexed), ym char(7) indexed, revenue, expense, timestamps;
  unique (company_id, ym).
- `Lead` — fillable `[company_id, stage, value, …]`; cast `value:decimal:2`; index on stage.
- `Employee` — `[company_id, name, role, designation, rating, dept]`; cast `rating:float`.
- `Customer` — `[name, value]` + `company_customer` pivot (mirrors `companyIds[]`).
- `Notification` — `[title, text, level, icon, at]`; cast `at:datetime`.
- `Activity` — `[actor, text, company_id, at]`; cast `at:datetime`.
No new tables for this module; snapshot/series are query scopes or a cached read model.

## Policies / permissions
View.js does no permission branching; the route lives under the group cockpit, i.e. owner/MD
scope. Laravel: `can:view-group-dashboard` middleware on all GETs (owner + group-admin roles);
`can:export-group-reports` on POST /export. Export must run under the authenticated user
(`EPAL.auth.current()` supplies preparer name, view.js L336, L346).

## Events
Dashboard is read-only; it emits only:
- `GroupSnapshotExported` — on export (payload: serial, user, totals) — mirrors the
  `EPAL.audit.record` call (view.js L371–374).
It **listens** (for cache/read-model invalidation) to `sale:recorded` / `data:changed` emitted by
`db.postSale()` (database.js L543–568) — the artery that moves these numbers.

## Engine dependencies → Laravel equivalents
- `EPAL.db` aggregations (finance/series/momRevenue/riskScore/groupSnapshot) → `GroupMetricsService` (+ cache).
- `EPAL.intel` (mdBriefing, anomalies) → `IntelService` (shared analytics service).
- `EPAL.forecast` → least-squares helper in `GroupMetricsService` (or compute client-side).
- `EPAL.doc` → PDF/document renderer service (branded report layout).
- `EPAL.serial.next('GRP')` → `SerialService::next('GRP')` (sequence table, atomic increment).
- `EPAL.audit.record` → `AuditService` / audit_logs table.
- `EPAL.auth` → Laravel auth; `EPAL.config.companies` → companies registry table (enabled flag).
