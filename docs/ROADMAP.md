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

## ✅ Deep Core Pass (v0.3.0) — the operating brain (done + hostile-inspected)
- **Double-entry accounting** (`core/ledger.js`): chart of accounts, balanced journal,
  trial balance, GL, party subledger, AR/AP ageing, P&L, balance sheet; auto-posts sales.
- **Trust backbone**: append-only audit trail (`core/audit.js` → Activity Log),
  maker-checker approvals (`core/approvals.js` → Approvals inbox), action-level
  permissions (`core/permissions.js`).
- **Document engine** (`core/documents.js` + `core/serial.js`): branded navy/gold
  invoices/receipts/vouchers/slips/statements, gapless serials, Document Center.
- **Intelligence** (`core/intel.js`): MD Briefing, RFM/LTV, anomaly flags, risk register.
- **Automation** (`core/rules.js`): reminder/escalation/recurring scheduler.
- **Comms & search**: @mention threads (`core/comments.js`), Ctrl+K data search (`core/search.js`).
- **Modules deepened/added**: Air Ticketing (multi-pax + commission + reissue/refund/void
  + invoice), Visa (fee breakdown + posting), **Vendor & Agent** ledgers, **Contract
  Flight** seats, **Shop POS**, **Construction** BOQ→billing→retention, **Woodart**, **IT**,
  HR leave/payroll. Settings became a real engine; Finance gained COA/journal/trial-balance.

## 🎯 Next (high value — fourth pass candidates)
1. **Server backend** — reimplement `core/state.js` + `core/database.js` + engine
   persistence against a Laravel/REST API (see `docs/MIGRATION_ROADMAP.md`); enforce
   double-entry, serials, audit, maker-checker, per-company isolation server-side.
2. **Air Ticketing further depth** — EMD/ancillary tab, TTL held-PNR deadline queue,
   full BSP HOT-file import + reconciliation.
3. **Consolidation** — inter-company eliminations, per-company columns on the group
   trial balance, currency translation.
4. **Deepen remaining sub-features** still on the scaffold (procurement GRN, warehouses/
   transfers, QA/QC & HSE, KB, contracts).

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
