# CHANGELOG — Epal Group ERP

## v0.3.1 "Deep Core — Fourth Pass" · 06-Jul-2026

Depth additions on top of the Deep Core, plus platform fixes.

### Added
- **Consolidation accounting** (`group/finance/consolidation`): a consolidated
  trial balance with one column per company, an **inter-company elimination**
  column, and the group total. New ledger primitives `EPAL.ledger.consolidatedTrialBalance()`
  and `EPAL.ledger.postIntercompany()`, two inter-company control accounts
  (1300 Inter-company Receivable / 2400 Inter-company Payable) that net to zero
  on consolidation, and seeded inter-company transactions (IT→Travels, Woodart→
  Construction, Shop→Construction, IT→Shop). Post-IC button, CSV, branded statement.
- **Air Ticketing to the metal**: **EMD & Ancillary** module (multi-line ancillary
  sales — baggage/seat/meal/insurance… — with serials + branded EMD receipt),
  **Ticketing Deadlines (TTL)** held-PNR queue with urgency countdown, and a
  **BSP file import + reconciliation** (import/parse a billing file, auto-match to
  tickets, exception list of mismatches/missing, accept/waive, mark reconciled).
- **Live comms channel** (`travels/marketing`): omni-channel **campaigns**
  (WhatsApp/SMS/Email) with real-audience send simulation + delivery/open stats,
  a **template** manager with placeholder preview, and an interactive **WhatsApp
  Booking Bot** that answers fare/package/visa queries from real data and drafts bookings.
- **Collapsible sidebar** — every company's module nav is now a persisted accordion
  (default: only the active module expanded); fixes the pile-up where every visited
  section stayed open.

### Fixed
- **GitHub Pages deploy** was failing on the large Deep Core commit (build OK, deploy
  step failing) — added `.nojekyll` so this vanilla no-build site deploys as-is.

### Verified
Boot sweep **191 routes / 0 errors / 0 blanks**; dynamic ledger invariants **24/24**
(including the new inter-company entries — trial balance and balance sheet still tie out;
consolidation eliminates to a balanced group column).

---

## v0.3.0 "Deep Core — Brain, Nerves & Backbone" · 06-Jul-2026

The third major build. Where v0.1.0 built the body and v0.2.0 gave it a world-class
face, v0.3.0 adds the **operating brain**: real business rules, double-entry accounting,
an automation nervous-system, an intelligence advisor, and a trust/audit backbone —
so the system behaves like an enterprise ERP, not a beautiful shell. Built and hardened
via multi-agent orchestration (scout → build → three-persona hostile inspection → fix).

### Added — the 10 Deep Core engines (`assets/js/{kernel,data,engines,kit}/`)
- **`ledger.js`** — true **double-entry** accounting. 22-account chart of accounts,
  balanced journal (`gl_entries`), `post()` that rejects imbalance, trial balance,
  running GL, party subledger, AR/AP ageing, P&L, balance sheet. Auto-posts every
  `sale:recorded` (DR AR / CR Revenue, DR COGS / CR AP). **The trial balance balances
  and the balance sheet ties out — verified.**
- **`audit.js`** — structured, append-only audit trail. Every create/edit/delete/login/
  post/approve captured with who/what/when/before-after. Global filterable Activity Log.
- **`approvals.js`** — maker-checker workflows. Amount-banded matrix, sequential levels,
  **maker ≠ checker enforced** (throws), mandatory reject comment, pending inbox.
- **`documents.js`** + **`serial.js`** — branded (navy `#1B2A4A` / gold `#C9A227`)
  document engine: invoices, receipts, vouchers, work orders, salary slips, statements,
  visa cover sheets — with **gapless serial numbering**, amount-in-words, print/PDF, and
  a searchable Document Center.
- **`intel.js`** — the advisor: **MD Briefing** narrative digest, RFM/LTV customer
  ranking, employee productivity, per-company risk register, anomaly flags (expense
  spike, negative-margin sale, over-credit-limit, margin drop).
- **`permissions.js`** — action-level RBAC (view/create/edit/delete/export/approve) with
  editable role templates, layered over the existing module gate.
- **`rules.js`** — automation engine + 60s scheduler: reminders (idle visa file, payment
  due, task overdue, flight deadline, credit-limit breach), 48h escalation, recurring
  month-end generation. Powers the Automation Center.
- **`comments.js`** — @mention comment threads embeddable on any entity.
- **`search.js`** — global Ctrl+K search across data (customers, tickets, files,
  invoices, GL, employees…), not just modules.
- **`engines.js`** — the self-registration backbone (`registerEngine/seedEngines/bootEngines`).

### Added — modules & deepenings (`assets/js/views/`)
- **Group:** MD Briefing, Document Center, Approvals inbox, Activity Log; Finance gains
  Chart-of-Accounts / Journal / Trial-Balance tabs; Settings becomes a real engine
  (fiscal year, tax, dropdown managers, approval matrix, role templates, per-company
  branding); Dashboard gains the briefing teaser + anomaly radar; CRM gains RFM/LTV.
- **Travels:** **Vendor & Agent** party ledgers (ageing, credit limits, commission,
  branded statements); **Contract Flight** block-seat inventory with unsold-seat
  deadline warnings; **Air Ticketing** deepened to a full lifecycle (multi-passenger
  fare model, base/tax/markup + agent commission, reissue/refund/void with reversing
  ledger entries, per-airline/agent profit, branded IATA-style invoice); **Visa** gains
  per-country checklists, missing-doc alerts, fee/service/profit breakdown, finance posting.
- **Per concern:** **Shop POS** (cart, stock-guarded checkout, VAT, receipt) + Inventory
  with low-stock & dues; **Construction** project → BOQ → work orders → milestone billing
  → retention → per-project P&L; **Woodart** design→production→install→handover billing;
  **IT** projects + support desk (SLA) + subscriptions (MRR) + timesheets.
- **HR:** leave apply→approve (via approvals), payroll run → branded salary slips + ledger
  posting, attendance punch.
- **`kit/forms.js`** — new **`items`** line-item repeater (multi-pax tickets, journal
  lines, BOQ rows, quotation lines).

### Hardened — three-persona hostile inspection (owner / employee / auditor)
26 adversarial agents surfaced 20 candidate defects; **17 confirmed** (3 correctly
refuted), all fixed and re-verified. Notable catches: a non-admin HR **privilege-escalation**
via the role field (closed), ticket **refunds that never reversed booked revenue** (now
post reversing entries), **duplicate document serials** on first runtime issue (counters
now reconcile past seeded docs), agent **commission omitted from posted cost** (now
reconciles module Net Profit with Group Finance), and anomaly deep-links to 404 routes (fixed).

### Verified
Every JS file passes `node --check`. Headless boot sweep: **184 routes, 0 errors, 0
render failures, 0 blanks.** Dynamic invariant harness: **24/24** (ledger stays balanced
through sales/refunds/rejected posts; `postSale` never double-posts; maker≠checker
enforced; serials unique & monotonic; audit captures mutations; stock decrements persist).

### Docs
New `docs/DATA_MODEL.md` (every store, field, relation), `docs/MIGRATION_ROADMAP.md`
(front-end → Laravel/API path), `docs/DEEP-CORE-CONTRACT.md` (engine APIs).

---

## v0.2.0 "Aurora — World-Class Elevation Pass" · 02-Jul-2026

The second major build: a full-system depth audit and elevation. The benchmark was
explicit — SAP/NetSuite/Odoo depth, Linear/Stripe/Notion polish. This pass closed the
gap list found by auditing v0.1.0 against them, module by module.

### The honest gap list we found (and fixed)

| # | Gap found in v0.1.0 (judged hostile) | Fix in v0.2.0 |
|---|---|---|
| 1 | ~80% of nav items landed on a scaffold, not a working module | Every module of every company is now a real screen: CRUD, validation, KPIs, analytics |
| 2 | Tables were static HTML — no search/sort/filter/pagination/export | New `kit/datatable.js` used everywhere: multi-key search, column sort, dropdown filters, pagination, CSV export of the filtered set |
| 3 | Forms didn't validate; saves accepted garbage | New `kit/forms.js` schema-driven forms: required/min/max/pattern/email/phone validation with inline error states |
| 4 | "Cross-company connection" was seed-deep only — a new sale changed nothing | New `db.postSale()` artery: every completed sale (POS checkout, air ticket, contract seats, project handover, go-live, CRM win, embassy file) rolls into that company's financials, the group sales ledger, and emits `sale:recorded` — Group Command Center reflects it instantly |
| 5 | Demo data was thin and generic | New `data/seed-bd.js`: ~600 realistic Bangladesh-context records across 35+ stores — Biman/Emirates PNRs, Gulshan fit-outs, BSRM steel, Walton SKUs, bKash payments, LGED tenders |
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
- `kit/datatable.js` — the one world-class table component (search/sort/filter/paginate/export/actions/empty-states).
- `kit/forms.js` — schema-driven forms + `formModal` with validation gating.
- `kit/entity.js` — the entity module factory: declare a business object once, get a complete workspace (KPIs → table → validated CRUD → confirm-delete → auto analytics). This is how 70+ modules stay consistent.
- `data/seed-bd.js` — deep, deterministic BD-context seed for all companies.
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
