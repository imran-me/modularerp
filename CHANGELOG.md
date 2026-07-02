# CHANGELOG — Epal Group ERP

## v0.2.0 "Aurora — World-Class Elevation Pass" · 02-Jul-2026

The second major build: a full-system depth audit and elevation. The benchmark was
explicit — SAP/NetSuite/Odoo depth, Linear/Stripe/Notion polish. This pass closed the
gap list found by auditing v0.1.0 against them, module by module.

### The honest gap list we found (and fixed)

| # | Gap found in v0.1.0 (judged hostile) | Fix in v0.2.0 |
|---|---|---|
| 1 | ~80% of nav items landed on a scaffold, not a working module | Every module of every company is now a real screen: CRUD, validation, KPIs, analytics |
| 2 | Tables were static HTML — no search/sort/filter/pagination/export | New `core/datatable.js` used everywhere: multi-key search, column sort, dropdown filters, pagination, CSV export of the filtered set |
| 3 | Forms didn't validate; saves accepted garbage | New `core/forms.js` schema-driven forms: required/min/max/pattern/email/phone validation with inline error states |
| 4 | "Cross-company connection" was seed-deep only — a new sale changed nothing | New `db.postSale()` artery: every completed sale (POS checkout, air ticket, contract seats, project handover, go-live, CRM win, embassy file) rolls into that company's financials, the group sales ledger, and emits `sale:recorded` — Group Command Center reflects it instantly |
| 5 | Demo data was thin and generic | New `core/seed-bd.js`: ~600 realistic Bangladesh-context records across 35+ stores — Biman/Emirates PNRs, Gulshan fit-outs, BSRM steel, Walton SKUs, bKash payments, LGED tenders |
| 6 | Owner dashboard had no forecasting, no drill-down, no signals | Command Center: every KPI drills to its detail, revenue projects forward (least-squares, dashed), Smart Signals digest (fastest riser, bleeder, best margin, top client, weakest performer — all computed live), health pills per company |
| 7 | No per-module analytics | Every module now carries a KPI row + monthly trend + breakdown chart (auto-provided by the entity factory, custom on flagships) |
| 8 | Employees had no in-company task route (RBAC dead-end) | "My Tasks" module added to all five companies; ESS employees reach their own board |
| 9 | Unknown routes crashed into the placeholder | Premium 404 with command-palette and home actions |
| 10 | No group-level finance statements | `group/finance`: consolidated P&L, cash flow, management balance sheet, AR/AP aging, bank positions |
| 11 | No BI layer | `group/analytics`: multi-company trends, 3-month forecasts, sortable comparison, 12-month revenue heatmap; per-company `analytics` with forecast + health |
| 12 | Numbers appeared statically | KPI count-up animation (`ui.countUp`, easeOutCubic, reduced-motion aware) |
| 13 | No print story for reports | Print stylesheet + downloadable board-grade HTML/CSV reports at group and company level |
| 14 | Mobile: kanban and forms cramped | Deeper responsive pass (kanban swipe columns, single-column forms, full-width actions) |

### Added — core platform
- `core/datatable.js` — the one world-class table component (search/sort/filter/paginate/export/actions/empty-states).
- `core/forms.js` — schema-driven forms + `formModal` with validation gating.
- `core/entity.js` — the entity module factory: declare a business object once, get a complete workspace (KPIs → table → validated CRUD → confirm-delete → auto analytics). This is how 70+ modules stay consistent.
- `core/seed-bd.js` — deep, deterministic BD-context seed for all companies.
- `db.col/save/remove` generic collection API; `db.postSale()` + `db.sales()` cross-company chain.
- `EPAL.forecast()` least-squares projection; `ui.countUp()` animated numbers.
- Premium 404 in the router; print stylesheet; POS layout; health pills; drill-down affordances (`elevation.css`).

### Added — modules (the deep build-out)
- **Group:** CRM (pipeline kanban, leads, Customers 360, activities) · Consolidated Finance (P&L, cashflow, balance sheet, AR/AP aging, banks) · Business Intelligence (trends, forecast, compare, heatmap) · Sister Concerns overview · Report Center · Automation rules engine · Notification center · Group settings with full backup/restore.
- **Travels:** Air Ticketing (direct sale with live profit readout, manage sales, airlines/airports masters, BSP recon, refunds) · Contract Flight (seat blocks, sell-seats with capacity guard) · Vendor & Agent (party accounts, payments, commission statements) · File Management (embassy files, slot tracker) · Passport Management (expiry radar) · Marketing (campaigns) · Automation (doc-expiry / payment-chaser / decision-watch computed from live data).
- **Woodart:** Projects (billed-on-handover) · Estimates (approve→project conversion) · Materials (stock adjust) · Workshop production · Installation & snags · Procurement.
- **IT Solutions:** Projects (billed on go-live, sprint board, roadmap) · Products & SaaS (catalog, subscriptions, MRR analytics) · Support desk (SLA monitor, knowledge base) · Contracts (renewals) · Timesheets (utilisation).
- **Shop:** a real POS terminal (cart, stock-guarded, VAT/discount, receipt download, posts to finance) · Products · Inventory (adjustments log, transfers, warehouses, low-stock) · Orders · Purchases · Suppliers.
- **Construction:** Projects (cost-vs-budget risk) · Tenders (win→project conversion) · BOQ (auto amounts) · Materials (issue-to-site) · Procurement · Plant & equipment (utilisation) · Subcontractors (payment tracking) · Labour (wage bill) · Quality & Safety (incident lifecycle).
- **Every company:** shared HRM, Accounts (+schedules), Ledgers (general/trial/party), Reports (downloadable), Analytics (forecast + health), Customers (shared graph), CRM pipeline, Settings — via wildcard views in `views/shared/company-modules.js`; premium generic company dashboard in `views/shared/company-dashboard.js`.

### Changed
- `config.js`: "My Tasks" module added to all five companies (closes the ESS routing gap).
- `group/dashboard.js`: drill-downs on every KPI, count-up values, dashed revenue projection, Smart Signals card, health pills on the company strip.
- `database.js`: generic collection API + `postSale` + extended-seed hook.

### Verified
- Every JS file passes `node --check`.
- Headless harness: 44 assertions green — seed depth for 29 stores, collection API round-trips, the full postSale chain (financials + ledger + event), forecast math, entity registration, RBAC after the config change.
- A multi-agent hostile-inspector pass reviewed every view file for dead buttons, contract violations and broken flows; all findings fixed (see final report).

---

## v0.1.0 "Aurora" · 02-Jul-2026
Initial architecture: module registry, localStorage state + override engine, event bus,
UI kit, charts factory, auth/RBAC/View-As, hash router with gates, app shell, premium
design system (dark/light), Group Command Center, Module Control, Workforce, Task Board
(phases/timers/admin glow/restrict), Travels dashboard, Visa Processing end-to-end, docs.
