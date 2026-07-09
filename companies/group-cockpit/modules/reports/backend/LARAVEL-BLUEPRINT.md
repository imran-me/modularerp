# Group Report Center — Laravel backend blueprint

> Source of truth: `companies/group-cockpit/modules/reports/view.js` (route `group/reports`,
> registered via `EPAL.view('group/reports', …)` at view.js:78). This module is **read-only**:
> it never writes a store — every download is computed live at click time (view.js:164-166).

## Purpose & screens

One screen (`#/group/reports`), the owner's "documentation desk":

- **KPI row** (view.js:100-105): Reports Available (fixed `5`), Data Freshness (now-time — reports
  are generated live, never cached), Records Covered (`sales + employees + acc_schedules +
  financials + customers` row counts, view.js:87), Active Concerns (enabled companies, view.js:42-44).
- **Report card grid** (view.js:108-142): five cards; clicking a card generates and downloads a
  self-contained, print-ready HTML document via Blob (view.js:50-55, doc chrome at 56-69):
  1. `pnl` — Consolidated P&L (view.js:175-212)
  2. `sales` — Group Sales Register (view.js:214-229)
  3. `roster` — Workforce Roster (view.js:231-249)
  4. `compare` — Company Comparison Snapshot (view.js:251-271)
  5. `schedules` — Payables & Receivables Summary (view.js:273-308)
- **Data Coverage chart** (view.js:145-162): horizontal bar of live row counts per source store.
- Head action button navigates to `group/finance` (view.js:94-96).

## Entities & fields (read-only consumers — stores owned by other modules/seeders)

localStorage stores read today (ns `epal.v1.`), with fields the reports actually touch:

- **`sales`** (`db.sales()`; appended at runtime by `db.postSale()` — platform/data/database.js:543):
  `id` string (`SL-…`), `companyId` string, `date` date-string, `amount` decimal, `cost` decimal,
  `profit` decimal, `desc` string, `customer` string. (Read at view.js:214-228.)
- **`employees`** (`db.employees()`): `id`, `name`, `companyId`, `dept`, `designation`, `phone`,
  `joinDate` date, `salary` decimal (monthly), `status` string. (view.js:231-248.)
- **`acc_schedules`** (`db.col('acc_schedules')`; shape declared platform/data/seed-bd.js:18-19):
  `id` (`SCH-###`), `companyId`, `party` string, `kind` enum `Payable|Receivable`,
  `amount` decimal, `due` date, `status` enum `Pending|Partial|Paid`, `ref` string. (view.js:273-307.)
- **`financials`** (`db.financials()`): `companyId`, `ym` string `YYYY-MM`, `revenue` decimal,
  `expense` decimal — keyed `companyId|ym` for the P&L matrix (view.js:177-180).
- **`customers`** — count only, for the KPI/coverage chart (view.js:85, 87, 158).
- **Company registry** `EPAL.config.companies` (`type === 'company' && enabled`) → Laravel
  `companies` table; `groupSnapshot()` per-company row (database.js:502-522): `id, name, short,
  revenue, profit, margin, mom, risk, employees` plus group totals
  `revenue, profit, margin, headcount, customers, openLeads, pipelineValue` (view.js:252-270).

Entity count consumed: 6 (sales, employees, acc_schedules, financials, customers, companies).
This module OWNS no tables — see Models below.

## Business rules (from the code — preserve exactly)

- **Live generation, no snapshots**: every figure is queried at download time (view.js:6-7, 164-166).
- **P&L** (view.js:175-211): trailing-12-months window from `db.months(12)`; per-concern summary via
  `db.finance(cid, 12)` = Σrevenue, Σexpense, profit = rev−exp, margin = (rev−exp)/rev×100
  (database.js:463-469); group consolidated row = `finance(null, 12)`; two monthly matrices
  (revenue; profit = revenue−expense per cell) with a Group total column per month; missing
  `companyId|ym` cell = 0 (view.js:179-180).
- **Sales Register** (view.js:214-225): sorted by `date` DESC; totals row = Σamount and Σprofit
  (null-safe `|| 0`); cost column is listed but NOT totalled.
- **Roster** (view.js:231-245): sorted `companyId` ASC then `name` ASC; total row = Σsalary
  labelled "monthly payroll".
- **Comparison** (view.js:251-270): exactly `db.groupSnapshot()`; `mom` printed with explicit `+`
  sign and 1 decimal; `risk` shown as `n / 100`. (Snapshot math — mom = last-vs-previous month
  revenue %, risk = composite 0-100 — lives in database.js:486-499, not in this module.)
- **Schedules** (view.js:273-307): "open" = `status !== 'Paid'` (view.js:86, 275); per-company
  Payable vs Receivable sums with Net Position = receivables − payables; group total row; detail
  sorted by `due` ASC; **aging** = floor((today@00:00 − due@00:00)/86400000) days — `> 0` renders
  "`Nd overdue`", else "current"; unparseable `due` → 0 days (view.js:291-296).
- All HTML output is escaped (`ui.escapeHtml`, view.js:45); money/percent/date formatting via
  `ui.money / ui.pct / ui.date`; doc footer marks reports "Confidential" (view.js:68).

## Routes

```php
Route::prefix('group/reports')->middleware(['auth'])->group(function () {
    Route::get('/',                   [GroupReportController::class, 'index']);      // KPI + card meta + coverage counts
    Route::get('/download/pnl',       [GroupReportController::class, 'pnl']);        // card click → file
    Route::get('/download/sales',     [GroupReportController::class, 'sales']);
    Route::get('/download/roster',    [GroupReportController::class, 'roster']);
    Route::get('/download/compare',   [GroupReportController::class, 'compare']);
    Route::get('/download/schedules', [GroupReportController::class, 'schedules']);
});
```
GET-only — the SPA has no POST/PUT/DELETE on this screen.

## Controllers

**`GroupReportController`**
- `index()` → JSON/view: active companies, row counts per store (sales, employees, acc_schedules,
  financials, customers), open-schedule count, generated-at timestamp (mirrors view.js:80-105, 145-162).
- `pnl() / sales() / roster() / compare() / schedules()` → each builds its dataset per the
  business rules above and returns a **file download response** (`Response::streamDownload`) of a
  self-contained HTML document rendered from a Blade layout replicating `htmlDoc()`
  (title, group legal name, generated-at, brand header, confidential footer — view.js:56-69).
  Filenames must match today's: `group-consolidated-pnl.html`, `group-sales-register.html`,
  `group-workforce-roster.html`, `group-company-comparison.html`, `group-payables-receivables.html`.

## Models & migrations

This module creates **no tables and no writes** — it queries models owned elsewhere:
`Sale` (fillable: company_id, date, amount, cost, profit, ref, desc, customer; casts:
date:date, amount/cost/profit:decimal:2), `Employee` (…salary:decimal:2, join_date:date),
`AccSchedule` (company_id, party, kind, amount, due, status, ref; casts amount:decimal:2,
due:date; enum kind Payable|Receivable, status Pending|Partial|Paid), `Financial`
(company_id, ym, revenue, expense), `Customer`, `Company`. Only migration owned here: none.
(Define those models in their owning modules' blueprints; reference them via a read-only
`GroupReportService`.)

## Policies / permissions

view.js contains no `EPAL.auth` / permission checks — access is by reaching the group route.
Laravel: gate the whole route group behind an ability like `viewGroupReports` (group/owner role),
since these documents expose consolidated financials of all concerns. No per-report permission
granularity exists in the code today.

## Events

None. The module records no money, sales, or state changes — it only reads. Do **not** emit
domain events; optionally log an audit entry `report.downloaded {report, user, at}` if the group
audit trail is desired (not present in the SPA code).

## Engine dependencies

- **`EPAL.db` aggregations** (platform/data/database.js): `months(n)`, `finance(companyId?, n)`,
  `groupSnapshot()`, `col()`, plus `sales/employees/financials/customers` readers → a Laravel
  `GroupFinanceService` (single source for finance math so group totals match every other module
  exactly — R-parity requirement).
- **`EPAL.config`** company registry (`activeCompanies`, `company(cid).short`, `group.legalName`)
  → `companies` table + group settings config.
- **`EPAL.charts.bar`** — frontend-only; backend just supplies the five row counts.
- No use of ledger/approvals/serial/documents/intel/rules/comments engines.
