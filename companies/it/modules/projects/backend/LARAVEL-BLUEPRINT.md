# IT Projects (Epal IT Solutions) — Laravel backend blueprint

Source of truth: `companies/it/modules/projects/view.js` (this file registers THREE views —
`it/projects`, `it/support`, `it/services`; view.js:101,616,800). Module manifest: `module.json`
(menu subs active/sprints/roadmap). Company id `it` (view.js:31).

## Purpose & screens
- **Projects — Active** (`#/it/projects/active`, default sub; view.js:103,127): portfolio cards with
  KPIs (Portfolio Value/Cost/Margin, Billable Hours, Live+AMC count; view.js:132-144); each card shows
  progress bar, stage badge, margin %, deadline countdown (overdue = red, <21d = warn; view.js:158-160).
- **Projects — Sprints** (`#/it/projects/sprints`; view.js:194): Kanban of projects by stage with
  drag-to-advance (dropping on "Live" forces progress to 100; view.js:221-233), text search, and a
  "Contract Value vs Invoiced" bar chart per project (view.js:242-258).
- **Projects — Roadmap** (`#/it/projects/roadmap`; view.js:284): projects sorted by deadline, bucketed
  by `YYYY · Qn` quarter (no/invalid date → "Unscheduled"; view.js:343-348); KPIs Due≤30d / Overdue /
  Live / Avg Progress.
- **Project drawer** (view.js:351): P&L stats (value, cost, profit, invoiced, collected), billable-vs-total
  hours banner, Timesheets tab (log/edit time) and Milestone Invoices tab (raise invoice, mark paid,
  open branded invoice doc), comments widget on entity `it_project` (view.js:408-411).
- **Support Desk** (`#/it/support`; view.js:616): ticket KPIs, Kanban by status (drag to change status;
  Resolved drop fires a notification; view.js:651-659), ticket table with SLA-status column, ticket
  drawer with status select / Resolve button and comments on `it_ticket` (view.js:761-764).
- **Managed Services & SaaS** (`#/it/services`; view.js:800): MRR/ARR/Active/Churn/Renewals≤30d KPIs,
  "Renewals Due" list (next 30 days), subscription register table; row click edits.

## Entities & fields (today's localStorage stores, ns `epal.v1.`)
1. **Project** — store `it_projects` (view.js:70,596-608)
   `id` string "ITP-NNN" · `name` string · `client` string · `type` enum Web|ERP|Mobile|Cloud|AMC ·
   `value` decimal (contract value BDT) · `cost` decimal · `stage` enum Discovery|Development|Testing|UAT|Live|Maintenance ·
   `progress` int 0-100 · `lead` string (employee name) · `deadline` date|'' · `created` date
2. **Timesheet** — store `it_timesheets` (view.js:72,559-567)
   `id` "TS-NNNN" · `project` FK project id · `employee` string · `date` date · `hours` decimal (min 0.5, step 0.5) ·
   `billable` enum Yes|No · `note` string · `created` date
3. **MilestoneInvoice** — store `it_invoices`, seeded idempotently by engine `it-projects-seed` (view.js:52-67)
   `id` "ITI-NNNN" · `project` FK · `milestone` string · `amount` decimal · `date` date ·
   `status` enum Sent|Paid · `customer` string · `saleRef` string (id of posted sale; view.js:505)
4. **Ticket** — store `it_tickets` (view.js:631,783-791)
   `id` "TIC-NNNN" · `subject` string · `client` string · `priority` enum Urgent|High|Medium|Low ·
   `assignee` string · `slaHours` int (4|8|24|48) · `status` enum Open|In Progress|Waiting|Resolved|Closed · `created` date
5. **Subscription** — store `it_subscriptions` (view.js:816,909-918)
   `id` "SUB-NNN" · `product` enum (Epal HRM Cloud|Epal POS|Epal School Suite|Hosting + Care Plan|Epal Books) ·
   `client` string · `plan` enum Basic|Pro|Enterprise · `mrr` decimal · `startDate` date · `renewal` date|'' ·
   `status` enum Active|Past Due|Cancelled · `created` date

## Business rules
- **Serials**: max numeric part of existing ids + 1, zero-padded (view.js:927-936): ITP-3d, ITI-4d, TS-4d, TIC-4d, SUB-3d.
- **Progress** clamped 0–100 on save (view.js:604); moving a project to stage **Live** via Kanban forces progress=100 (view.js:227).
- **Invoice milestone** (view.js:482-515): amount required > 0 (reject with error toast; view.js:494); default amount =
  outstanding `max(0, value - invoicedTotal)` (view.js:483,488); creates invoice with status **Sent**, posts revenue via
  `db.postSale('it', {amount, cost:0, ref:invoiceId, desc, customer})`, stores returned `sale.id` in `saleRef`, emits a
  success notification, then opens a branded Tax Invoice document (payment terms: due within 15 days; view.js:540).
- **Mark Paid** flips invoice status Sent→Paid only (view.js:467-468); Collected = sum of Paid invoices (view.js:84-87).
- **Margin** = value − cost; margin % = round(margin/value×100) (view.js:155-156). Billable hours = sum of hours where billable==='Yes' (view.js:76-79).
- **Deadline risk**: daysLeft vs a fixed business date (demo NOW = 2026-07-05; view.js:29-30 — in Laravel use `now()`); overdue <0, warn <21d (cards) / ≤30d (roadmap, renewals).
- **SLA**: dueAt = created + slaHours; ticket is open if status ∉ {Resolved, Closed}; breached = open && dueAt < now (view.js:707-710). Timesheet hours min 0.5, step 0.5 (view.js:554).
- **Services KPIs**: MRR = sum of mrr where status Active; ARR = MRR×12; churn % = cancelled/all×100; renewals due = non-cancelled with 0 ≤ daysLeft(renewal) ≤ 30 (view.js:816-824).
- Required fields (form `required:true`): project name, client, value; timesheet employee, date, hours; invoice milestone, amount; ticket subject, client; subscription product, client, mrr.

## Routes (mirror hash routes `#/it/projects/*`, `#/it/support`, `#/it/services`)
```
GET    /it/projects                      index (?sub=active|sprints|roadmap analytics payloads)
POST   /it/projects                      store        PUT /it/projects/{project}   update
PATCH  /it/projects/{project}/stage      moveStage    (Kanban drop; body: stage)
GET    /it/projects/{project}            show (drawer payload: P&L, hours, invoices)
GET/POST /it/projects/{project}/timesheets           index/store   PUT /it/timesheets/{ts} update
GET/POST /it/projects/{project}/invoices             index/store (store = raise milestone → posts sale)
PATCH  /it/invoices/{invoice}/pay        markPaid
GET    /it/invoices/{invoice}/document   invoiceDoc (rendered tax invoice)
GET/POST /it/tickets                     index/store   PUT /it/tickets/{ticket} update
PATCH  /it/tickets/{ticket}/status       setStatus     (Kanban / drawer select / Resolve)
GET/POST /it/subscriptions               index/store   PUT /it/subscriptions/{sub} update
```

## Controllers
- **ProjectController** — `index` (projects + KPI aggregates per sub), `show` (project, timesheets,
  invoices, invoiced/collected/billable totals), `store`, `update`, `moveStage` (applies Live→100 rule).
- **TimesheetController** — `index`, `store`, `update` (returns saved row + recomputed hour totals).
- **MilestoneInvoiceController** — `store` (validates amount>0, creates Sent invoice, calls LedgerService::postSale,
  saves saleRef, fires event + notification, returns invoice + document URL), `markPaid`, `document`.
- **TicketController** — `index` (tickets + SLA computed fields open/breached/remainingHours), `store`, `update`, `setStatus`.
- **SubscriptionController** — `index` (register + MRR/ARR/churn/renewals payload), `store`, `update`.

## Models & migrations
- **ItProject** — fillable: name, client, type, value, cost, stage, progress, lead, deadline;
  casts: value/cost decimal:2, progress int, deadline date. Columns: id(pk), serial ITP unique, + fillables, timestamps.
  hasMany ItTimesheet, ItMilestoneInvoice.
- **ItTimesheet** — fillable: project_id, employee, date, hours, billable, note; casts: hours decimal:1, date date, billable bool.
- **ItMilestoneInvoice** — fillable: project_id, milestone, amount, date, status, customer, sale_ref;
  casts: amount decimal:2, date date; status enum sent|paid, default sent.
- **ItTicket** — fillable: subject, client, priority, assignee, sla_hours, status; casts: sla_hours int;
  accessor `due_at` = created_at + sla_hours, `is_breached`.
- **ItSubscription** — fillable: product, client, plan, mrr, start_date, renewal, status; casts: mrr decimal:2, dates.
- Keep the human serial (ITP-001 …) as a unique `serial` column generated by max+1 to preserve today's ids.

## Policies / permissions
- view.js does **not** gate any action by role — no `EPAL.auth`/permissions calls in this module. All
  actions (create/edit project, drag stage, invoice, mark paid, log time, tickets, subscriptions) are open
  to any signed-in IT-company user. Laravel: single `it` company scope on all queries; a permissive
  module policy (`viewAny/create/update` for users with access to company `it`) mirrors today exactly.

## Events
- **`it.invoice.raised`** — fired when a milestone invoice is posted; this is the ONLY place the module
  records money: `db.postSale('it', …)` feeds IT + Group finance/ledger live (view.js:500-505). Payload:
  invoice id, project id, amount, customer, saleRef. Group bridge consumes it for group revenue totals.
- **`it.invoice.paid`** — status Sent→Paid (view.js:468) for collections reporting.
- (In-app notifications, not bridge events: project moved to stage, ticket resolved, invoice raised — view.js:229,657,507.)

## Engine dependencies → Laravel equivalents
- **db.postSale** (finance/ledger spine) → `LedgerService::postSale(company:'it', amount, cost:0, ref, desc, customer)` returning a Sale whose id is stored as saleRef.
- **EPAL.doc** (branded document engine: `numberFor('invoice')` serial + `amountInWords`; view.js:521,539) → invoice PDF/Blade renderer + document serial service.
- **db.notify** → Laravel Notifications (database channel), company-scoped.
- **EPAL.comments.widget** on `it_project` / `it_ticket` → polymorphic `comments` table (commentable_type/id).
- **db.employees({companyId:'it'})** for lead/assignee/engineer pickers (view.js:95-98) → Employee model scoped to company `it` (names only; fallback list is demo seed).
- **EPAL.registerEngine seed** (`it-projects-seed`, seedOnce `it_invoices`; view.js:52-57) → database seeder for the 5 demo invoices.
- No approvals/serial-engine/intel/rules usage in this module.
