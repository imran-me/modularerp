# Travels Dashboard — Laravel backend blueprint

Source of truth: `companies/travels/modules/dashboard/view.js` (route `#/travels/dashboard`,
registered as `EPAL.view('travels/dashboard', …)` at view.js:13) and `module.json`
(single screen, no sub-menu: `"menu": []`). This module is **read-only**: it aggregates
data owned by Finance and Visa Processing and writes nothing. The Laravel port is one
GET endpoint returning a dashboard payload; the entities below are the shapes it reads.

## Purpose & screens
One screen only — the Epal Travels company command view (view.js:14-92):
- **Header** with actions that deep-link to Visa Processing: "Visa Board" →
  `travels/visa-processing/application-board` and "New Visa Application" →
  `travels/visa-processing/new-application` (view.js:23-24). No data mutation here.
- **KPI row** (5 cards, view.js:29-39): Revenue (12M), Net Profit (+margin), Visa
  Pipeline (pending count), Approved Visas, Visa Sales Value (+profit).
- **Sales & Profit Trend** area chart — 12 monthly points of revenue + profit (view.js:43-46, 86-88).
- **Visa Pipeline** bar chart — application counts per stage (view.js:48-53, 89-90).
- **Top Destinations** — top 6 countries by application count with flag emoji and a
  progress bar scaled to the #1 country (view.js:58-70).
- **Recent Applications** — first 6 visa applications with applicant, country · visaType
  and a stage badge; each row navigates to the application board (view.js:71-80).

## Entities & fields
Today's persistence is localStorage (namespace `epal.v1.`) via `EPAL.db`
(`platform/data/database.js`). Stores this view reads:

**financials** (store key `epal.v1.financials`) — monthly finance rows, 12 mo × company:
- `companyId` string (here always filtered to `'travels'`) · `ym` string `YYYY-MM`
- `revenue` int · `expense` int (database.js:14)

**visaApps** (store key `epal.v1.visaApps`) — visa applications (database.js:28-30):
- `id` string (VA-xxxx) · `applicant` string · `phone` string · `passport` string
- `country` string · `visaType` string · `catId` string (FK → visaCats)
- `cost` decimal · `sale` decimal
- `stage` enum: `New | Documents | Submitted | Under Process | Approved | Rejected`
- `travelDate` date · `agent` string · `payStatus` string · `flag` string (emoji, read at view.js:76)

**visaCats** (store key `epal.v1.visaCats`) — visa categories, used only to look up the
flag emoji per country (view.js:60): `id, country, flag, type, cost, sale, days, status`
(database.js:27).

Entity count consumed: **3** (financials, visaApps, visaCats). None are owned by this
module — canonical CRUD lives in the finance and visa-processing modules.

## Business rules
All are read-side aggregations; replicate exactly:
- **Revenue (12M)** = Σ revenue of travels financial rows in last 12 months; **Net Profit**
  = Σ revenue − Σ expense; **margin** = profit/revenue × 100 (database.js:463-469; consumed view.js:34-35).
- **MoM revenue %** = (last month − previous month) / previous month × 100; returns 0 if
  fewer than 2 points or previous is 0 (database.js:486-490; shown on KPI 1, view.js:34).
- **Visa Revenue** = Σ `sale` over all apps; **Visa Profit** = Σ (`sale` − `cost`)
  (null-safe, `x.sale||0`) (view.js:29-30).
- **Pending** = apps whose stage ∈ {New, Documents, Submitted, Under Process};
  **Approved** = stage === 'Approved' (view.js:31-32).
- **Stage funnel** counts per the fixed ordered stage list
  `['New','Documents','Submitted','Under Process','Approved','Rejected']` (view.js:48-49).
- **Top destinations** = group apps by `country`, sort desc by count, take 6; flag =
  first visaCat matching country, fallback `'🌍'`; bar width = n / top[0].n × 100% (view.js:58-61, 67).
- **Recent applications** = first 6 rows of the visaApps list in store order (view.js:74) — no sorting; preserve insertion order (newest apps are unshifted by visa-processing).
- **Stage badge colour map** (shared helper `EPAL.travelStageBadge`, view.js:102-106):
  Approved→good, Rejected→bad, Under Process→warn, Submitted→info, Documents/New→default.
- KPI trend arrows: profit card direction is `up` if profit ≥ 0 else `down` (view.js:35).

## Routes
```
GET /api/travels/dashboard        → full dashboard payload (kpis, series, stageFunnel,
                                    topDestinations, recentApplications)   [mirrors #/travels/dashboard]
```
Optional granular reads if the SPA fetches per-widget: `GET /api/travels/dashboard/series`,
`GET /api/travels/dashboard/pipeline`. No POST/PUT/DELETE — header buttons are pure
navigation to visa-processing routes (view.js:23-24).

## Controllers
`Travels\DashboardController`
- `index()` → JSON:
  - `kpis`: `{revenue12m, netProfit, margin, momRevenuePct, visaPending, visaApproved, visaRevenue, visaProfit}`
  - `series`: `{labels[12 month names], revenue[12], profit[12]}` (mirror database.js:472-483 — zero-fill missing months)
  - `stageFunnel`: `[{stage, count}]` in the fixed 6-stage order
  - `topDestinations`: `[{country, flag, count, pctOfTop}]` (max 6)
  - `recentApplications`: `[{id, applicant, country, visaType, stage, flag}]` (max 6)

## Models & migrations
Owned elsewhere; reference them read-only (define here only if visa-processing/finance blueprints don't):
- `Financial` — fillable `[company_id, ym, revenue, expense]`; casts `revenue:int, expense:int`.
  Migration: `id, company_id string index, ym string(7) index, revenue bigint, expense bigint, timestamps`.
- `VisaApplication` — fillable `[applicant, phone, passport, country, visa_type, cat_id, cost,
  sale, stage, travel_date, agent, pay_status, flag]`; casts `cost:decimal:2, sale:decimal:2,
  travel_date:date`; `stage` string with app-level enum check.
  Migration: `id string PK (VA-xxxx serial), applicant, phone, passport, country index,
  visa_type, cat_id FK→visa_categories, cost decimal, sale decimal, stage string index,
  travel_date date, agent, pay_status, flag, timestamps`.
- `VisaCategory` — fillable `[country, flag, type, cost, sale, days, status]`.
No new tables for this module itself (dashboard persists nothing).

## Policies/permissions
view.js contains no `EPAL.auth`/permission checks — access is governed by company scope
(travels menu). Laravel: gate the route with `can:view,travels` company-scope middleware;
any authenticated travels-company user may read. No write permissions needed.

## Events
None. This module records no money or sales — sale/cost figures are read from visaApps
records created by visa-processing (which owns `visa.application.created` / ticket-sale
events). The dashboard should only *consume* aggregates; emit nothing.

## Engine dependencies
- `EPAL.db` aggregations `finance()`, `series()`, `momRevenue()` (database.js:463-490)
  → Laravel: a `FinanceAggregationService` (or query scopes on `Financial`) reproducing
  the exact sum/margin/MoM formulas above.
- `EPAL.charts` (area/bar) and `EPAL.ui` are frontend-only; no backend equivalent.
- No use of ledger, approvals, serial, documents, intel, rules, or comments engines in this view.
- Caching hint: payload is derivable, safe to cache per-company and bust on
  `visaApps`/`financials` writes (SPA equivalent: `data:changed` bus events, database.js:591).
