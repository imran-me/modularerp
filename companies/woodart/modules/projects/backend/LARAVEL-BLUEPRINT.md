# Woodart Projects (Design-Build + Estimates/BOQ) — Laravel backend blueprint

Source of truth: `companies/woodart/modules/projects/view.js` (registers TWO SPA views:
`woodart/projects` at view.js:83 and `woodart/estimates` at view.js:684). Business date used
throughout is the app "today" constant (view.js:34). Company id `woodart` (view.js:35).

## Purpose & screens
- **projects/active** (view.js:110-175): portfolio cards. KPIs: Portfolio Value (Σ value), Committed Cost (Σ cost), Portfolio Margin (value−cost), Live Projects (stage not Handover/Completed), Deadline Risk (progress<100 AND deadline <30 days AND stage not Handover/Completed, view.js:118-120). Card click opens project drawer.
- **projects/design** (view.js:178-236): kanban board over the 5 stages; drag-and-drop advances a project's stage (PATCH stage); drop on Completed forces progress=100 (view.js:203); drop on Handover fires a "Ready for Handover" notification (view.js:205).
- **projects/milestones** (view.js:239-310): KPIs — Revenue Billed (Σ woodart sales), Jobs Running, Sites Snagging (status=Snagging OR open snags>0), Awaiting Billing (stage Handover/Completed AND !billed); stage doughnut + value-by-type bar; Client Billing Ledger table over the woodart sales ledger sorted date desc.
- **projects/gallery** (view.js:313-345): read-only portfolio wall (gradient thumb by type/stage colors).
- **Project drawer** (view.js:348-544): P&L strip + meta, 4 tabs — Estimate/BOM (linked estimates), Production (jobs table), Install & Snags (installs + snag modal), Billing ("Bill on Handover" / advance-stage shortcut / reprint invoice).
- **estimates/quotations** (view.js:709-753): estimate ledger, KPIs (count, quoted value, approved count+won value, open pipeline = Draft+Sent value); row → estimate drawer (edit / print quotation / Approve→Project / delete).
- **estimates/boq** (view.js:756-800): aggregates all estimate lines by item name → qty, cost, sale, margin.
- **estimates/costing** (view.js:803-859): per-estimate value/cost/margin/% register + top-10 cost-vs-quote bar chart.

## Entities & fields (today: localStorage stores via EPAL.db, seeded by core/seed-bd.js — never re-seeded here)
**Project** — store `wa_projects` (write shape view.js:1029-1041, 942-955):
`id` string "WAP-###" · `name` string · `client` string · `designer` string · `type` enum(Residential|Office|Retail|Restaurant) · `area` int (sft) · `value` decimal · `cost` decimal · `progress` int 0-100 · `stage` enum(Design|Production|Installation|Handover|Completed) · `start` date · `deadline` date · `estimateId` string nullable · `billed` bool · `billRef` string (sale id) · `billDate` date · `created` date.
**Estimate** — store `wa_estimates` (view.js:1078-1089): `id` "EST-###" · `title` · `client` · `validTill` date · `status` enum(Draft|Sent|Approved|Rejected) · `lines` array of `{item:string, qty:number, unitCost:decimal, unitSale:decimal}` · `items` int (line count cache) · `value`/`cost` decimal (derived cache) · `projectId` string nullable · `created` date.
**ProductionJob** — store `wa_production` (view.js:1113-1120): `id` "JOB-###" · `project` (project id FK) · `job` string · `station` enum(CNC|Cutting|Edge Banding|Assembly|Finishing) · `assignedTo` string · `status` enum(Queued|Running|Done|Blocked) · `due` date · `created` date.
**Install** — store `wa_installs` (view.js:1143-1150): `id` "INS-###" · `project` FK · `site` string · `team` enum(Team Alpha..Delta) · `date` date · `status` enum(Scheduled|In Progress|Snagging|Handover) · `snagList` array of `{text:string, done:bool}` · `snags` int (open-snag count cache) · `created` date.
**Sale** — written via `db.postSale('woodart', {amount, cost, ref, desc, customer})` (view.js:561-565); read via `db.sales('woodart')` with fields date/ref/customer/desc/cost/amount/profit (view.js:271-282).

## Business rules
1. Serial formats: `WAP-`, `EST-`, `JOB-`, `INS-` + zero-padded 3-digit max+1 over existing ids (view.js:1159-1167).
2. Derived money: project profit = value − cost (view.js:60). estValue = Σ qty×unitSale of lines, else stored `value`; estCost = Σ qty×unitCost, else stored `cost`, else round(value×0.65) fallback (view.js:62-69).
3. Estimate save: drop blank lines (no item text and no qty); if lines exist recompute value/cost from lines; new estimate with no lines gets value=cost=0; items = line count (view.js:1079-1087).
4. **Billing gate**: "Bill on Handover" only when stage ∈ {Handover, Completed} AND !billed (view.js:503, 552). Billing posts a sale (amount=value, cost=cost, ref=project id, desc "Interior fit-out · name", customer=client), sets billed=true, billRef=sale.id, billDate=today, stage Handover→Completed, progress=100, sends success notification, opens branded invoice doc (view.js:549-578). Idempotent: re-bill blocked (view.js:552). One-shot full-value invoice — no partial billing exists.
5. Stage advance: drag on kanban or "Advance to <next>" button (only shown while stage index <3, i.e. up to Installation→Handover, view.js:524-529); Completed via drag forces progress=100.
6. **Approve estimate → project** (view.js:931-966): only offered when status≠Approved (view.js:908); creates project {name=title, client, type Residential, area 0, value=estValue, cost=estCost, stage Design, progress 0, designer=first woodart employee, start=today, deadline=validTill, estimateId}, sets estimate status=Approved + projectId, notifies, navigates to active list.
7. Snag list (view.js:621-681): lazy migration — legacy numeric `snags` expands to N placeholder items (view.js:627-634); toggling/removing/adding recomputes `snags` = open count; adding a snag while status is Scheduled/In Progress auto-moves install status to Snagging (view.js:670); status manually settable to any of the 4 values.
8. Validations (form `required`): project name, client, value≥1; estimate title, client; job project, job, station; install project, site. Progress clamped 0-100 (view.js:1037).
9. Designer options = active woodart employees (`db.employees({companyId:'woodart'})`), with a 4-name static fallback (view.js:77-80).
10. Deadline math: daysLeft = round((deadline−today)/86400000); tone bad if <0, warn if <30 (view.js:71-76, 143-144).

## Routes (mirror hash routes `#/woodart/projects/*`, `#/woodart/estimates/*`)
```
GET    /woodart/projects                      index (?stage=&q=) — active/design/gallery data
GET    /woodart/projects/milestones           milestones dashboard (KPIs, stage/type aggregates, billing ledger)
GET    /woodart/projects/{project}            drawer payload (project + estimates + jobs + installs + sale)
POST   /woodart/projects                      store
PUT    /woodart/projects/{project}            update
PATCH  /woodart/projects/{project}/stage      advance / drag-drop stage change
POST   /woodart/projects/{project}/bill       bill-on-handover (posts sale, returns invoice doc payload)
GET    /woodart/projects/{project}/invoice    reprint invoice
POST   /woodart/projects/{project}/jobs       store job         PUT /woodart/jobs/{job} update
POST   /woodart/projects/{project}/installs   store install     PUT /woodart/installs/{install} update
POST   /woodart/installs/{install}/snags      add snag
PATCH  /woodart/installs/{install}/snags/{i}  toggle done       DELETE …/snags/{i} remove
PATCH  /woodart/installs/{install}/status     set install status
GET    /woodart/estimates                     ledger (?status=&q=)   GET /woodart/estimates/boq   GET /woodart/estimates/costing
POST   /woodart/estimates                     store   PUT /woodart/estimates/{estimate} update   DELETE destroy
POST   /woodart/estimates/{estimate}/approve  approve → create project
GET    /woodart/estimates/{estimate}/quotation  quotation doc payload
```

## Controllers
- **ProjectController**: index (list + portfolio KPIs), milestones (aggregates + sales ledger), show (drawer payload), store, update, updateStage, invoice. Returns Project resources with computed profit/marginPct/daysLeft.
- **ProjectBillingController@store**: transaction — guard stage/billed, create Sale via LedgerService, stamp billed/billRef/billDate/stage/progress, dispatch event, return invoice document payload.
- **EstimateController**: index/boq/costing/store/update/destroy, quotation (doc payload); approve (transaction: create Project, mark Approved, link projectId — mirrors view.js:931-966).
- **ProductionJobController**: store, update (scoped to project).
- **InstallController**: store, update, updateStatus; **SnagController**: store, toggle, destroy (recompute open-snag cache; auto-Snagging rule).

## Models & migrations
- `Project` — fillable: name, client, designer, type, area, value, cost, progress, stage, start, deadline, estimate_id; casts: value/cost decimal:2, area/progress int, start/deadline/bill_date date, billed bool. Migration: id (string PK "WAP-###" or bigint + serial column), name, client, designer, type, area int, value/cost decimal(14,2), progress tinyint, stage string, start/deadline date nullable, estimate_id nullable, billed bool default false, bill_ref nullable, bill_date nullable, timestamps.
- `Estimate` — fillable: title, client, valid_till, status, project_id; casts: valid_till date, value/cost decimal:2. hasMany EstimateLine.
- `EstimateLine` — fillable: item, qty, unit_cost, unit_sale; casts decimal:2. Migration: estimate_id FK, item, qty decimal(10,2), unit_cost, unit_sale.
- `ProductionJob` — fillable: project_id, job, station, assigned_to, status, due; cast due date.
- `Install` — fillable: project_id, site, team, date, status; cast date. hasMany Snag (or json `snag_list` column mirroring today's embedded array); keep `snags` int open-count column for parity with view.js:653.
- `Snag` — fillable: install_id, text, done (bool).

## Policies / permissions
- Only explicit permission check in code: estimate **delete** requires `EPAL.perm.can('woodart','estimates','delete')` (view.js:909) → `EstimatePolicy@delete` gated on woodart estimates.delete permission. All other actions are open to any user with woodart module access (no other perm calls exist) — model as module-level gate `can:access,woodart.projects`.

## Events
- `woodart.project.billed` — the only money-posting action (view.js:561-565, db.postSale): payload {projectId, saleId, amount, cost, customer}; group bridge consumes it for group finance totals.
- `woodart.estimate.approved` (project spawned, view.js:956-961) and `woodart.project.stage_changed` (Handover notification, view.js:205) — today these only emit in-app notifications via db.notify; map to Laravel Notifications.

## Engine dependencies (shared services → Laravel equivalent)
- **EPAL.db** (col/save/remove/postSale/sales/notify/employees) → Eloquent + a `LedgerService::postSale(company,…)` writing the shared sales ledger (profit = amount − cost).
- **EPAL.doc** (open, numberFor('invoice'|'quotation'), amountInWords) → DocumentService: branded PDF invoice/quotation with global per-type serials and amount-in-words (view.js:595-617, 981-1002).
- **EPAL.comments.widget('wa_project'|'wa_estimate', id)** (view.js:405, 924) → polymorphic Comment model.
- **EPAL.perm** → policies (above). **EPAL.charts / EPAL.table / ui.*** are frontend-only; **db.notify** → Notification system. No ledger/approvals/serial/intel/rules engines beyond these are consumed.

## Parity notes for the Laravel developer
- Seed data lives in `core/seed-bd.js` (stores wa_projects, wa_estimates, wa_production, wa_installs) — port it as database seeders so group totals reconcile; this module never seeds (view.js:25-27).
- All list KPIs/aggregates above are computed client-side today; reproduce them server-side in the index endpoints (single query + aggregate) so numbers match exactly.
- Estimate `value`/`cost` are caches: authoritative when lines exist is the line math (view.js:62-69). Recompute on every save; keep the ×0.65 cost fallback for legacy line-less estimates.
- Milestones "Sites Snagging" counts installs where status=Snagging OR open snags>0 (view.js:246) — an install can be counted while status is Handover if snags remain open.
- The kanban search filters by name/client/designer/id substring, case-insensitive (view.js:185-188) — implement as a `q` LIKE filter.
- Invoice totals are fixed at contract value with zero advance/adjustments (view.js:609-613); quotation totals show VAT (incl.) = 0 (view.js:994-998). Do not add tax logic.
- Deleting an estimate does NOT touch its spawned project (view.js:917-919 only removes wa_estimates) — mirror with a nullable FK, no cascade.
