# Projects / Sites (Construction) — Laravel backend blueprint

Source of truth: `companies/construction/modules/projects/view.js` — two SPA views: `construction/projects` (view.js:123)
and `construction/boq` (view.js:761) — plus `module.json` (menu/subs/routes). Rebuild 1:1; nothing here is invented.

## Purpose & screens
- **Active Sites** (`#/construction/projects/active`, default sub) — portfolio cards per project: progress bar, stage badge,
  value/budget/cost/margin, engineer, deadline countdown. KPIs: Portfolio Value, Committed Cost, Portfolio Margin,
  Retention Held, Deadline Risk (view.js:150-215). Card click opens the project drawer.
- **Work Breakdown / WBS** (`.../wbs`) — table of ALL work orders across sites with trade/status filters, CSV export and
  "Add Work Order". KPIs: Work Orders, Completed, Material Cost, Labor Cost (view.js:218-262).
- **Progress** (`.../progress`) — physical (`project.progress`) vs financial (certified billing ÷ contract value) per site;
  bar chart + register with deadline tone; KPIs: Avg Physical, Near Handover, On Hold, Overdue (view.js:265-325).
- **Milestones & Billing** (`.../milestones`) — group-wide IPC ledger. KPIs: Certified Value, Collected (net),
  Retention Held, Awaiting Payment (view.js:328-375). Row click opens the billing drawer.
- **BOQ Workspace** (`#/construction/boq`, separately registered view) — every BOQ line across projects, totals-by-category
  chips, global add-line form with project select (view.js:761-853).
- **Project drawer** — P&L strip (Contract Value, Budgeted Cost, Committed Cost, Projected Profit, Retention Held) and
  three tabs: BOQ, Work Orders, Milestones & Billing; Edit Project button; comments widget on `('cn_project', id)`
  (view.js:378-531).
- **Billing drawer** — IPC detail with actions Raise IPC / Mark Paid / print Certificate (view.js:599-623).

## Entities & fields (today's localStorage store → Laravel table)
**`cn_projects` → `projects`** (seeded in platform/data/seed-bd.js; written at view.js:646-657)
- `id` string `CNP-###` PK · `name` string · `client` string · `engineer` string (employee name)
- `value` decimal (contract value) · `cost` decimal (budgeted cost) · `progress` int 0-100
- `stage` enum: Mobilization | Structure | Finishing | Handover | On Hold | Completed (view.js:640)
- `start` date · `deadline` date · `created` date

**`cn_boq` → `boq_lines`** (written at view.js:713-722 and 843-848)
- `id` string `BOQ-####` PK · `project` FK → projects.id · `item` string
- `category` enum: Civil | Structure | Electrical | Plumbing | Finishing | Earthwork (view.js:707)
- `unit` string · `qty` decimal · `rate` decimal · `amount` decimal (server-computed) · `created` date

**`cn_workorders` → `work_orders`** (seed shape view.js:55-69; written view.js:682-692)
- `id` string `WO-###` PK · `project` FK · `title` string · `trade` enum (same six trades, view.js:42)
- `assignedTo` string — employee name from `db.employees({companyId:'construction'})` (view.js:117-120)
- `materialCost` decimal · `laborCost` decimal · `status` enum: Planned | In Progress | On Hold | Completed (view.js:43)
- `due` date · `created` date

**`cn_billing` → `ipcs`** (seed shape view.js:72-89; written view.js:743-753)
- `id` string `IPC-###` PK · `project` FK · `milestone` string · `pct` int 0-100 · `amount` decimal (gross)
- `retentionPct` int 0-20 · `retentionAmount` decimal (server-computed)
- `status` enum: Draft | Submitted | Certified | Paid (view.js:44)
- `date` date · `saleRef` string nullable — finance sale id, set only on certify (view.js:553)

## Business rules
- **ID generation**: max numeric suffix in store + 1, zero-padded — CNP/WO/IPC 3 digits, BOQ 4 (view.js:856-864).
  Enforce inside a DB transaction to avoid duplicates.
- **BOQ amount = qty × rate**, always computed on save, never user-entered (view.js:721, 845).
- **retentionAmount = round(amount × retentionPct / 100)**, recomputed on every milestone save (view.js:750);
  form caps: retentionPct 0-20, pct 0-100 (view.js:737-739).
- **Committed cost = Σ boq.amount + Σ wo.materialCost + Σ wo.laborCost**; margin = value − cost (view.js:98-101, 387).
- **Retention held / certified value** sum only milestones with status Certified or Paid (view.js:102-109).
- **IPC status flow**: Draft/Submitted → *Raise IPC* → Certified → *Mark Paid* → Paid. Raise IPC allowed only from
  Draft or Submitted (view.js:510, 614); Mark Paid only from Certified (view.js:615, 619-620).
- **Raise IPC posts revenue NET of retention** (view.js:536-563): `net = amount − retentionAmount`; calls
  `db.postSale('construction', { amount: net, cost: 0, ref: ipc.id, desc: 'IPC <milestone> · <projectId>',
  customer: client || projectName })`; then status=Certified, saleRef=sale.id, date=today; raises a success
  notification and opens the branded certificate. Must be one atomic transaction in Laravel.
- **Deadline risk**: at-risk when progress<100 AND daysLeft<30 AND stage≠Handover (view.js:159); overdue when
  daysLeft<0 (view.js:270). Financial progress % = certifiedValue ÷ value × 100 (view.js:286).
- **Milestone KPI math** (view.js:333-340): certified = Σ gross of Certified+Paid; collected = Σ net of Paid;
  held = Σ retention of Certified+Paid; awaiting = Σ net of Submitted+Certified.
- **Validation**: project — name & client required, value required min 1, progress clamped 0-100 (view.js:633-653);
  WO — project/title/trade required, costs min 0 (view.js:672-679); BOQ — item/category/unit/qty/rate required
  (view.js:706-710); milestone — text, amount min 1, pct required (view.js:736-740).
- **IPC certificate** (view.js:565-596): document type `invoice`, serial via `EPAL.doc.numberFor('invoice')`,
  rows = gross work certified / less retention, totals = Gross Certified, Retention Held, Net Payable (grand),
  amount-in-words, fixed terms: net payable within 30 days, retention released on final account + defect liability.

## Routes (api.php, prefix `/api/construction`, auth + company scope)
- `GET|POST /projects` · `GET|PUT /projects/{id}` · `GET /projects/{id}/pnl`
- `GET /projects-dashboard?view=active|wbs|progress|milestones` — per-screen KPI aggregates
- `GET|POST /work-orders` · `PUT /work-orders/{id}` (query filters: trade, status, project)
- `GET|POST /boq-lines` · `PUT /boq-lines/{id}` (filters: category, project)
- `GET /boq-lines/summary` — by-category totals + grand total + distinct project count (view.js:779-799)
- `GET|POST /ipcs` · `PUT /ipcs/{id}` (filter: status)
- `POST /ipcs/{id}/certify` — Raise IPC · `POST /ipcs/{id}/pay` — Mark Paid · `GET /ipcs/{id}/certificate` — PDF
- CSV exports mirroring the tables: `GET /work-orders/export`, `/boq-lines/export`, `/ipcs/export`,
  `/projects/progress-export`

## Controllers
- **ProjectController** — `index` (rows with computed committedCost/margin/retentionHeld), `store`, `show`,
  `update`, `pnl` (value, budget, committedCost, profit+%, retentionHeld — view.js:398-406), `dashboard`.
- **WorkOrderController** — `index`, `store`, `update`; responses include computed total = material + labor.
- **BoqLineController** — `index`, `summary` (category ⇒ total map, grand, uniqueProjects), `store`, `update`;
  amount computed server-side.
- **IpcController** — `index` (with milestone KPI block), `store`, `update`, `certify` (guard status ∈ {Draft,
  Submitted}; posts sale via ledger service; returns updated IPC + saleRef), `pay` (guard status=Certified),
  `certificate` (renders the IPC PDF through the document service).

## Models & migrations
- **Project** — fillable: name, client, engineer, value, cost, progress, stage, start, deadline.
  casts: value/cost `decimal:2`, progress `int`, start/deadline `date`. hasMany BoqLine, WorkOrder, Ipc (FK `project`).
  Migration: `id` string PK, name, client, engineer nullable, value, cost, progress, stage, start nullable,
  deadline nullable, timestamps.
- **WorkOrder** — fillable: project, title, trade, assigned_to, material_cost, labor_cost, status, due.
  casts: material_cost/labor_cost `decimal:2`, due `date`. Migration: id string PK, project FK, title, trade,
  assigned_to nullable, material_cost, labor_cost, status default 'Planned', due nullable, timestamps.
- **BoqLine** — fillable: project, item, category, unit, qty, rate. `amount` set in `saving` hook (qty × rate).
  casts: qty/rate/amount `decimal:2`. Migration: id string PK, project FK, item, category, unit, qty, rate,
  amount, timestamps.
- **Ipc** — fillable: project, milestone, pct, amount, retention_pct, status, date. `retention_amount` set in
  `saving` hook; `sale_ref` guarded (written only by certify). casts: amount/retention_amount `decimal:2`,
  pct/retention_pct `int`, date `date`. Migration: id string PK, project FK, milestone, pct, amount,
  retention_pct, retention_amount, status default 'Draft', date, sale_ref nullable, timestamps.

## Policies / permissions
- view.js applies no per-role gate itself; access follows the shell's company scoping (module belongs to company
  `construction`, view.js:32). In Laravel: all routes behind auth + `company:construction` middleware.
- Suggested abilities mirroring the UI actions: `projects.view` (all reads/exports), `projects.manage`
  (create/edit project, work order, BOQ line, milestone), `projects.certify` (certify + mark-paid — the
  money-moving actions at view.js:536-563 and 619-620).

## Events
- **`construction.ipc.certified`** — emitted by certify, payload {ipcId, projectId, gross, retention, net, saleRef,
  customer}. This is the module's only money-recording point: `db.postSale('construction', …)` (view.js:547-551),
  which the group finance bridge consumes; a user notification is also raised (view.js:556-557).
- **`construction.ipc.paid`** — emitted by Mark Paid (view.js:620). No ledger posting in the code (net revenue was
  already posted at certify), so event only — for collections dashboards.

## Engine dependencies → Laravel equivalents
- **EPAL.db.postSale** (ledger/finance engine) → `SalesPostingService`: creates the company sale + GL entries;
  certify passes amount=net, cost=0, ref=IPC id (view.js:547-551).
- **EPAL.doc** (`doc.open`, `doc.numberFor('invoice')`, `doc.amountInWords`) → `DocumentService` + serial-numbering
  table for invoice serials; renders the IPC certificate PDF (view.js:565-596).
- **db.notify** → Laravel database-channel Notification to construction users (view.js:556-557).
- **EPAL.comments.widget('cn_project', id)** → polymorphic `comments` table, commentable_type=Project (view.js:439-442).
- **db.employees({companyId:'construction'})** → HR employees query feeding engineer/assignedTo selects (view.js:117-120).
- **EPAL.charts / EPAL.table CSV export** — frontend-only; backend supplies the aggregates and export endpoints above.
- Not used by this module: approvals/maker-checker, serial engine (beyond doc numbering), intel, rules engines.
