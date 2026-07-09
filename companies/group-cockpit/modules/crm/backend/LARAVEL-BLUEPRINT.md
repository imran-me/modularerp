# Group CRM — Laravel backend blueprint

Source of truth: `companies/group-cockpit/modules/crm/view.js` (route `group/crm`) + `module.json`.
Group-level module: one shared pipeline / customer graph spanning ALL sister companies.

## Purpose & screens
One route with four sub-screens branched on `ctx.subId` (view.js:99-100, 657-661; menu in module.json):
- **pipeline** (default) — Kanban of every group lead across 7 fixed stages with drag-and-drop; dropping a card into "Won" posts a sale to the owning company's ledger via `db.postSale` and fires a success notification (view.js:161-218, 188-207).
- **leads** — searchable/filterable/CSV-exportable table of all leads (filters: stage, source, company; export `group-leads.csv`), row click opens edit modal, trash action deletes with confirm (view.js:223-251).
- **customers** ("Customers 360") — shared cross-company customer card grid with tier + text filters, an RFM 5×5 heatmap (click cell filters the grid), Best/Sleeping/At-Risk intelligence lists, customer detail modal with embedded comments thread, create/edit modal (view.js:256-547).
- **activities** — table of CRM touchpoints (Call/Email/Meeting/WhatsApp/Site Visit/Follow-up) with log-activity modal, filters (type, outcome), export `group-crm-activities.csv`, delete (view.js:552-596).
- KPI header on every sub: Open Leads, Pipeline Value (open stages only), Win Rate, Customers count, Activities This Month (view.js:107-116, 146-152). "Leads by Company" bar chart appended under pipeline and leads (view.js:637-655).

## Entities & fields
Today stored in localStorage (ns `epal.v1.`) via `EPAL.db`; store keys in parentheses.

**Lead** (`leads`) — view.js:601-632, 165-177
- `id` string, format `LD-<last 5 digits of Date.now()>` (view.js:616)
- `name` string (required), `companyId` string FK→company registry (required)
- `source` enum: Website | Referral | WhatsApp | Facebook | Walk-in | Cold Call | Fair (view.js:34)
- `stage` enum: New | Contacted | Qualified | Proposal | Negotiation | Won | Lost (view.js:27-32), default New
- `value` decimal ৳ (required, min 1), `cost` decimal nullable (optional estimated cost, view.js:611-612)
- `owner` string = current auth user id (view.js:617), `created` date (YYYY-MM-DD)

**Customer** (`customers`) — view.js:516-547, shared group graph
- `id` string, format `CUS-<last 5 digits of Date.now()>` (view.js:535)
- `name` string (required), `contact` string, `phone` string (required), `email` string
- `tier` enum: Standard | Silver | Gold | Platinum (default Standard)
- `value` decimal (manual "Lifetime Value", min 0, default 0), `status` enum active | inactive
- `companyIds` string[] — which concerns "know" this customer; preserved on edit, seeded with `firstCompany` on create (view.js:527-540)
- `since` string YYYY-MM (view.js:536)

**CrmActivity** (`crm_activities`, read via `db.col('crm_activities')`) — view.js:577-596
- `id` string `ACT-<last 6 digits of Date.now()>`
- `type` enum: Call | Email | Meeting | WhatsApp | Site Visit | Follow-up (required)
- `lead` string person/lead name (required), `company` string organisation (optional)
- `outcome` enum: Positive | Neutral | Needs follow-up
- `note` text (required), `by` string = current user name (fallback 'Admin'), `date` + `created` date

## Business rules
- **Stage set is fixed** (7 stages); OPEN_STAGES = first 5; Pipeline Value = Σ value of open-stage leads; Win Rate = won/(won+lost)·100, rounded, 0 when no closed leads (view.js:27-33, 109-114).
- **Won transition posts a sale** (fires only when stage becomes Won and was not previously Won — checked in both drag-drop view.js:192-205 and form save view.js:619-627): calls `db.postSale(companyId, {amount: value, cost, ref: lead.id, desc: 'CRM deal: '+name, customer: name})` plus a success notification `{level:'success', title:'Deal won 🎉', companyId}`.
- **Won-deal costing**: cost = lead.cost if entered, else auto-estimate `round(value * 0.7)` (~30% margin) (view.js:50-53, 624).
- `postSale` (platform/data/database.js:543-558) creates a `sales` record `{id:'SL-…', companyId, date, amount, cost, profit: amount-cost, ref, desc, customer}` and rolls it into the company's latest `financials` month — this is the group-bridge money path.
- **Customer graph merge**: on create, `firstCompany` is appended to `companyIds` if absent, then removed from the record; on edit `companyIds` is preserved untouched (view.js:534-542).
- **RFM intelligence is derived, not stored**: `EPAL.intel.rfm()` scores customers from the group sales ledger keyed by customer NAME; heatmap axis = R × round((F+M)/2) (view.js:70, 260-265, 287-328). Predicted LTV via `EPAL.intel.ltv(name)`. Customers with no matching sales show "Unrated" (view.js:436). Best/Sleeping/At-Risk lists from `EPAL.intel.topCustomers(5)`, `sleepingCustomers()`, `atRisk()` (view.js:364-367).
- Deletes require a confirm dialog (leads view.js:243-246, activities view.js:568-571). No soft delete in the code.
- Activity `date` and `by` are set server-side-equivalent at creation (today, current user) — not user-entered (view.js:588-590).

## Routes
Mirroring hash routes `#/group/crm/{pipeline|leads|customers|activities}`:
```
GET    /group/crm/kpis                     header KPIs (openLeads, pipelineValue, winRate, customers, activitiesThisMonth)
GET    /group/crm/leads                    index (?stage=&source=&company_id=&q=) + CSV export ?format=csv
POST   /group/crm/leads                    create
PUT    /group/crm/leads/{lead}             update (Won transition side-effects here)
PATCH  /group/crm/leads/{lead}/stage       Kanban drag-drop stage change
DELETE /group/crm/leads/{lead}
GET    /group/crm/leads/by-company         chart data (lead counts per company)
GET    /group/crm/customers                index (?tier=&q=&r=&fm=) — r/fm mirror heatmap cell filter
POST   /group/crm/customers                create (accepts first_company)
PUT    /group/crm/customers/{customer}     update (company_ids preserved)
GET    /group/crm/customers/{customer}     detail + RFM + predicted LTV + comments
GET    /group/crm/intel                    rfm heatmap counts, top/sleeping/at-risk lists
GET    /group/crm/activities               index (?type=&outcome=&q=) + CSV export
POST   /group/crm/activities               create
DELETE /group/crm/activities/{activity}
```

## Controllers
- `CrmDashboardController` — `kpis()` → KPI payload; `leadsByCompany()` → labels/counts/accent colors.
- `LeadController` — `index` (filter/search/paginate/CSV), `store`, `update`, `changeStage(lead, stage)` (invokes Won pipeline), `destroy`. `update`/`changeStage` return the lead + any posted sale id.
- `CustomerController` — `index` (tier/q/RFM-cell filters, each row decorated with rfm segment + predicted LTV + company badges), `store`, `update`, `show` (detail rows + comments thread), all writes return the saved customer.
- `CustomerIntelController` — `heatmap()` (5×5 cell counts), `lists()` (best/sleeping/atRisk, 5 each).
- `CrmActivityController` — `index`, `store` (stamps by/date from auth+today), `destroy`.

## Models & migrations
- `Lead` — fillable: name, company_id, source, stage, value, cost, owner_id; casts: value:decimal:2, cost:decimal:2, created_on:date. Migration: id (string PK `LD-…` or ulid + display ref), name, company_id (indexed), source, stage (indexed, default 'New'), value decimal(14,2), cost decimal(14,2) nullable, owner_id, created_on date, timestamps.
- `Customer` — fillable: name, contact, phone, email, tier, value, status, company_ids, since; casts: company_ids:array (json column), value:decimal:2. Migration: id (`CUS-…` ref), name (indexed — RFM joins sales by name today), contact, phone, email, tier default 'Standard', value decimal(14,2) default 0, status default 'active', company_ids json, since string(7), timestamps.
- `CrmActivity` — fillable: type, lead, company, outcome, note, by, date; casts: date:date. Migration: id (`ACT-…` ref), type, lead, company nullable, outcome nullable, note text, by, date, timestamps.
- (Sale/financials tables belong to the shared ledger service — not owned by this module.)

## Policies / permissions
- The view only uses `EPAL.auth.current()` to stamp `owner` on leads (view.js:617) and `by` on activities (view.js:589) — no role gates exist in this module's code. Laravel: `auth` middleware on all routes; stamp `owner_id`/`by` from `auth()->user()`; no finer-grained policy is encoded today (do not invent one — group-level access control lives in the shell/registry).

## Events
- `LeadWon(lead, sale)` — the only money-recording moment (view.js:196-205, 619-627). Listener posts the sale to the owning company's ledger (LedgerService::postSale mirroring database.js:543-558) and creates the "Deal won 🎉" notification.
- `CustomerUpserted(customer)` — `db.saveCustomer` emits `customer:upserted` today (database.js:606); broadcast so other concerns' views refresh the shared graph.
- Generic `data:changed` bus emissions on save/remove map to Eloquent model events; no other domain events are recorded by this module.

## Engine dependencies
- **db.postSale** (cross-company sales/financials chain) → `LedgerService::postSale(companyId, dto)` writing `sales` + rolling into monthly `financials` — shared group service.
- **db.notify** → `NotificationService` / Laravel database notifications (level, title, text, companyId, icon).
- **EPAL.intel** (rfm, ltv, topCustomers, sleepingCustomers, atRisk) → `CustomerIntelService` computing RFM from the sales table keyed by customer name (match today's algorithm exactly; segments listed view.js:56-60).
- **EPAL.comments.widget('customer', id)** → shared polymorphic `Comment` model/service (`commentable_type=customer`), thread embedded in customer detail (view.js:487-501).
- **EPAL.table / charts / formModal** are frontend-only (CSV export, bar chart, forms) — backend just supplies filterable index endpoints and the by-company aggregate.
