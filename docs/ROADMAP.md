# Roadmap

The foundation is complete and every screen is navigable today (via full views or the
live scaffold). This is the priority order for graduating scaffolds into full modules.
Each item is one `views/**` file following `docs/VIEWS-GUIDE.md`.

## ✅ Done (fully operational)
- Runtime: registry, state + module-override engine, event bus, UI kit, charts, seeded
  DB + aggregators, auth/roles/View-As, hash router with gates, app shell.
- Premium design system (dark + light, re-skin from `tokens.css`).
- **Group Command Center** — KPIs, trend/mix/profit charts, company strip, risk radar,
  alerts, activity.
- **Module Control** — enable/disable companies, modules, sub-features live.
- **Workforce / Employee Management** — directory, profiles, attendance, leaves,
  payroll (+ run + CSV), performance, org chart, downloadable profile report.
- **Task Board** — Kanban, drag-drop, multi-phase timers (start/pause/done, live
  counter, weighted % completion), admin comment-glow, restrict + red-flag, assign,
  employee ESS view, per-employee persistence.
- **Travels Dashboard** + **Visa Processing** (end-to-end, see `docs/travels-visa.md`).
- **Travels ▸ Air Ticketing** — Direct Sale (issue), Manage Sales ledger + detail
  drawer (void/re-issue/refund/pay-status), Airlines & Airports masters, BSP/ADM
  reconciliation, Refund Tracker. Issuing fires `db.postSale()` → live group finance.
- **Group command layer** — CRM (customer 360 + pipeline), Consolidated Finance
  (P&L, cash flow, balance sheet, AR/AP, banks), Analytics, Reports, Companies,
  Automation, Notifications, Settings.
- **Shared company workspaces** — wildcard views (`*/dashboard`, `*/hrm`, `*/accounts`,
  `*/ledgers`, `*/reports`, `*/analytics`, `*/customers`, `*/crm`, `*/settings`) give
  every sister concern real screens; a specific view overrides them per company.
- **Runtime kit** — `core/forms.js` (schema form builder), `core/datatable.js`
  (`EPAL.table`), `core/entity.js` (CRUD factory), `core/seed-bd.js` (deep all-company
  operational seed). All wired into `index.html` and boot-verified (180 routes, 0 errors).

## 🎯 Next (high value)
1. **Travels ▸ Air Ticketing depth** — repeatable multi-pax cards, EMD/ancillary tab,
   payable/receivable schedules, branded invoice/PDF, TTL deadline queue.
2. **Travels ▸ Vendor & Agent** — party ledgers, ageing buckets, credit limits, commission.
3. **Contract Flight** — group/charter seat blocks (Umrah/Hajj/worker) off the airline master.
4. Graduate the remaining scaffolded per-concern modules (Shop POS, Construction BOQ…).

## 🧱 Per-concern build-out
- **Epal Shop** — POS terminal, Products (catalog/variants/barcodes), Inventory
  (stock/warehouses/transfers/low-stock), Orders, Purchases.
- **Epal Construction** — Projects/Sites (WBS, progress, EVM), Tenders, BOQ &
  estimation, Procurement (PO/GRN), Plant & assets, Labour muster, QA/QC & HSE.
- **Woodart Interiors** — Projects (design→build→install), Estimates & BOM, Workshop
  scheduling, Site/installation snag lists, Procurement.
- **Epal IT Solutions** — Projects/sprints, Products & subscriptions (MRR/churn),
  Support desk (tickets/SLA/KB), Timesheets, Contracts.

## 🔌 Platform
- **Real backend** — reimplement `core/state.js` + `core/database.js` against a REST/
  GraphQL API; enforce auth + permissions server-side. Nothing else changes.
- **Automation engine** — rules/triggers UI writing to a rules store consumed by the bus.
- **Reporting/export** — shared PDF/print report builder (extend the employee-report
  pattern in `views/admin/employees.js`).
- **Notifications** — persistence + read state (started) → real-time channel later.
- **i18n / currency** — already centralised in `ui.js` + `config.group`.

## 🧪 Quality to add as it grows
- Promote the headless smoke test into a small test file per module.
- Add optimistic-UI + error toasts around all `db.save*` once a backend exists.
