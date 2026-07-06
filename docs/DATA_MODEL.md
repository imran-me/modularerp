# DATA_MODEL.md — Epal Group ERP

**Architect-grade data reference.** Every entity, every field, every relation.

This document is the authoritative map of the persisted state of the Epal Group ERP.
It is derived directly from the source (`data/database.js`, `data/seed-bd.js`, the Deep
Core engines, and the module views that own their own stores). If code and this doc
disagree, code wins — but this doc is kept faithful to the code it was generated from.

---

## 1. Storage model

### 1.1 The substrate: browser `localStorage`

The ERP is a no-build, browser-only SPA. There is **no server and no database**. All
state lives in the browser's `localStorage`, accessed through one narrow door:
`EPAL.store` (`data/state.js`). Swapping this single file for real API calls is the
intended migration path — nothing else in the app touches `localStorage` directly.

### 1.2 Namespace: `epal.v1.`

Every key is prefixed with the schema-version namespace `epal.v1.` (constant `NS` in
`state.js`). So the logical store `sales` is physically stored at key
`epal.v1.sales`. The prefix is the version boundary and the blast radius for
`EPAL.store.nuke()` (used by *Reset demo data*), which removes only `epal.v1.*` keys.

| `EPAL.store` method | Behaviour |
|---|---|
| `get(key, fallback)` | JSON-parse `NS+key`; returns `fallback` (or `null`) if absent/corrupt |
| `set(key, value)` | JSON-stringify into `NS+key` |
| `patch(key, partial)` | shallow-merge into an object store |
| `list(key)` | `get(key, [])` — a collection is always an array |
| `upsert(key, record)` | find by `record.id`; **merge** (`Object.assign`) if found, else push |
| `removeFrom(key, id)` | filter out the record with `id` |
| `seedOnce(key, data)` | write `data` only if the key has **never** been written (idempotent) |
| `nuke()` | delete every `epal.v1.*` key |

### 1.3 Collection convention: `[{ id, … }]`

Almost every store is a JSON **array of records**, each carrying a unique string `id`.
`upsert`/`removeFrom` key on `id`. IDs are human-readable, prefixed, and stable across
reloads because the seed uses deterministic PRNGs. Common prefixes: `EPL-` employees,
`CUS-` customers, `LD-` leads, `VA-`/`VC-` visa, `TK-`/`AL-`/`AP-`/`RF-` air, `SL-`
sales, `JV-` journals, `AGT-`/`VN-` parties, `WAP-`/`ITP-`/`CNP-` projects, and so on.

A handful of stores are **singleton objects, not arrays** (noted per-store below):
`airBsp`, `serials`, `automation_meta`, and every `settings.*` / `module-overrides`
key.

Per-employee task boards use a **keyed family**: `tasks.<empId>` (e.g. `tasks.EPL-DEV1`)
— each employee's board is its own store.

### 1.4 The module-override layer

`EPAL.modules` (in `state.js`) maintains a single object store `module-overrides` that
enables/disables companies, modules and sub-modules at runtime:

```
{ "travels": false,                          // whole company off
  "travels/visa-processing": false,          // one module off
  "travels/visa-processing/analysis": false  // one sub-module off
}
```

Absence of a key means "use the compiled default from `config.js`". `applyOverrides()`
folds these flags back onto the in-memory `EPAL.config` registry so the whole UI reacts
instantly. This is metadata *about* the app, not business data, and is intentionally
excluded from the audit trail.

### 1.5 Seeding & idempotency

`EPAL.db.seed()` populates the core stores, then calls `EPAL.seedBD()` (all company
operational data) and `EPAL.seedEngines()` (Deep Core engines). **Every** seed uses
`seedOnce`, so re-running is safe and manual edits survive reloads. `EPAL.db.reset()`
calls `nuke()` then `seed()` — a full wipe-and-reseed. Deterministic PRNGs
(`mulberry32(20260702)` in database.js, seed `987654321` in seed-bd.js) make the demo
dataset byte-stable across machines. The demo "now" is frozen around **2026-07-05**.

### 1.6 The event bus (why writes matter)

Every mutation helper emits on `EPAL.bus` (`data:changed`, `sale:recorded`,
`ledger:posted`, `approval:*`, `audit:logged`, `notify`, …). Dashboards, the audit
engine, the ledger auto-poster, and open widgets all subscribe. This is how a single
`postSale` ripples across companies live (see §4).

### 1.7 Mapping to a future relational DB

| localStorage concept | Relational equivalent |
|---|---|
| `epal.v1.<store>` array | a **table** `<store>` |
| record `id` | primary key |
| `tasks.<empId>` family | table `tasks` with FK `empId` |
| `gl_entries[].lines[]` | child table `gl_lines (entry_id FK, account FK, dr, cr)` |
| `airBsp` object | 3 tables (`bsp_txns`, `bsp_adms`, `bsp_unused`) + 1 config row |
| string references (`companyId`, `catId`, `party`, `ref`, `account`) | foreign keys (see §3) |
| `settings.*` singletons | a `settings` key/value table or typed config rows |
| `seedOnce` | migration/seed scripts |
| `data:changed` bus | DB triggers / CDC / outbox events |

Note two integrity caveats that a relational port must resolve: several references are
**by display-name string** rather than by id (`sales.customer`, `party_txns.party`,
`comments` on party name, ledger `party`), and a few reference sets are **denormalised
across two stores** (e.g. vendors live in both `vendors` and `party_txns`).

---

## 2. Entity reference

Legend for the **Type** column: `str` string · `int`/`num` number · `bool` boolean ·
`ms` epoch milliseconds · `date` `'YYYY-MM-DD'` · `ym` `'YYYY-MM'` · `[]` array · `{}`
nested object. "Enum" values are the observed/allowed set.

---

### 2.A Core / Group

#### `financials` — monthly revenue/expense per company (the BI spine)
12 rows per operating company. Purpose: powers every dashboard, P&L headline and the
Group Command Center. `postSale` rolls live amounts into the latest month here.

| Field | Type | Notes |
|---|---|---|
| companyId | str | `travels`\|`woodart`\|`it`\|`shop`\|`construction` (no `id` field; composite key = companyId+ym) |
| ym | ym | month bucket, e.g. `2026-06` |
| revenue | int | BDT |
| expense | int | BDT |

#### `employees` — the group-wide people directory
| Field | Type | Notes |
|---|---|---|
| id | str | `EPL-0001` (owner), `EPL-DEV1` (named demo dev), `EPL-NNNN` |
| name | str | |
| companyId | str | `group` for owner; else a company id |
| dept | str | department (see `DEPTS` per company) |
| designation | str | job title |
| role | str | `owner`\|`admin`\|`manager`\|`accountant`\|`hr`\|`employee`\|`agent` |
| email | str | |
| phone | str | |
| joinDate | date | |
| salary | int | monthly BDT (owner = 0) |
| status | str | `active`\|`on-leave` |
| attendance | {} | `{ present, absent, late, leave }` (ints) |
| rating | num | 3.0–5.0 |
| demoUser | bool | present only on `EPL-DEV1` |

#### `customers` — shared customer graph (cross-company)
| Field | Type | Notes |
|---|---|---|
| id | str | `CUS-1001…` |
| name | str | |
| companyIds | [str] | **many-to-many**: which companies the customer belongs to |
| contact | str | contact person |
| phone / email | str | |
| value | int | lifetime value BDT |
| since | str | `'YYYY-MM'` |
| tier | str | `Standard`\|`Silver`\|`Gold`\|`Platinum` |
| status | str | `active` |

#### `leads` — CRM pipeline
| Field | Type | Notes |
|---|---|---|
| id | str | `LD-2001…` |
| companyId | str | owning company |
| name | str | |
| source | str | `Website`\|`Referral`\|`WhatsApp`\|`Facebook`\|`Walk-in`\|`Cold Call`\|`Fair` |
| stage | str | `New`\|`Contacted`\|`Qualified`\|`Proposal`\|`Negotiation`\|`Won`\|`Lost` |
| value | int | BDT |
| owner | str | → `employees.id` |
| created | date | |

#### `tasks.<empId>` — per-employee Kanban board (keyed family)
One store per employee. Purpose: task management + the automation "overdue" radar.

| Field | Type | Notes |
|---|---|---|
| id | str | `T-1001`, `AUTO-<base36>` for automation-raised |
| title / desc | str | |
| status | str | `todo`\|`inprogress`\|`review`\|`done`\|`cancelled` |
| priority | str | `low`\|`medium`\|`high` |
| due / created | date | |
| createdBy | str | → `employees.id` or `automation` |
| labels | [str] | free tags |
| restricted | bool | admin-only close |
| redFlag | bool | escalation flag (set by automation) |
| comments | [{}] | `{ by→employees.id, byAdmin, at:ms, text, unseen }` (inline, distinct from the `comments` store) |
| phases | [{}] | `{ id, name, pct, accumMs, running, startedAt, done }` — timed sub-steps |

#### `notifications` — the topbar alert feed
| Field | Type | Notes |
|---|---|---|
| id | str | `N1…` / `uid('N')` |
| level | str | `info`\|`success`\|`warning`\|`error` |
| title / text | str | |
| companyId | str | |
| at | ms | |
| read | bool | |
| icon | str | Bootstrap icon name |
| to | str | optional → `employees.id` (targeted, e.g. @mention) |
| route | str | optional deep-link hash |

#### `activity` — lightweight human-readable activity log
| Field | Type | Notes |
|---|---|---|
| id | str | `uid('A')` |
| at | ms | |
| actor | str | display name |
| text | str | |
| companyId | str | default `group` |

#### `crm_activities` — logged CRM touches
| Field | Type | Notes |
|---|---|---|
| id | str | `ACT-0001…` |
| type | str | `Call`\|`Email`\|`Meeting`\|`WhatsApp`\|`Site Visit`\|`Follow-up` |
| lead | str | contact name (string ref, not FK) |
| company | str | corporate name (string) |
| by | str | person name |
| note / outcome | str | outcome ∈ `Positive`\|`Neutral`\|`Needs follow-up` |
| date / created | date | |

#### `banks` — group cash accounts
| Field | Type | Notes |
|---|---|---|
| id | str | `BNK-01…` |
| name / branch / account | str | |
| companyId | str | owner company (or `group`) |
| balance | int | BDT — **seeds the ledger opening balance** (DR 1010 / CR 3000) |
| created | date | |

#### `sales` — the group-wide sales register (the artery's ledger)
Seeded with 40 rows; runtime `postSale()` appends here. See §4.

| Field | Type | Notes |
|---|---|---|
| id | str | `SL-0001…` seed; `SL-<base36><rand>` runtime |
| companyId | str | |
| date | date | |
| amount | int | revenue BDT |
| cost | int | COGS BDT |
| profit | int | `amount - cost` |
| ref | str | source-doc reference (e.g. `TKT-123`, an IPC id) |
| desc | str | |
| customer | str | name string (→ `customers.name`, soft) |
| created | date/ms | |

---

### 2.B Finance & Ledger (double-entry)

#### `coa` — Chart of Accounts (`engines/ledger.js`)
Singleton-per-account rows. The standard 22-account chart.

| Field | Type | Notes |
|---|---|---|
| code | str | account number, e.g. `1200` (primary key) |
| name | str | |
| type | str | `asset`\|`liability`\|`equity`\|`income`\|`expense` |
| normal | str | `debit`\|`credit` — derived: asset/expense→debit, else credit |
| group | str | statement grouping, e.g. `Current Assets` |

**Standard accounts:** 1000 Cash · 1010 Bank · 1150 Sub-Agent Receivable · 1200
Accounts Receivable · 1400 Inventory · 1500 Fixed Assets · 2000 Accounts Payable ·
2050 BSP Payable · 2200 VAT Payable · 2300 Customer Advances · 3000 Owner Equity ·
3100 Retained Earnings · 4000 Sales Revenue · 4100 Commission Income · 4900 Other
Income · 5000 Cost of Sales · 5100 Salaries · 5200 Rent · 5300 Utilities · 5400
Marketing · 5900 ADM & Penalties · 6000 Bank Charges. (`3200 Current Year Earnings`
is synthesised on the balance sheet, not stored.)

#### `gl_entries` — the journal (double-entry source of truth)
| Field | Type | Notes |
|---|---|---|
| id | str | `JV-<base36>-<seq>` runtime; `GL-S…`/`GL-OB-…`/`GL-EX-…` seed |
| date | date | |
| companyId | str | default `group` |
| ref | str | external reference |
| memo | str | |
| source | str | `sale`\|`manual`\|`payroll`\|`refund`\|`opening`\|… |
| party | str | AR/AP counterparty name (string ref) |
| lines | [{}] | `{ account→coa.code, dr, cr }` — **Σdr must equal Σcr** (tol 0.5) |
| posted | bool | always `true` |
| created | ms | |

#### `acc_entries` — company income/expense feed (Accounts module)
| Field | Type | Notes |
|---|---|---|
| id | str | `JV-00001…` (5-wide; distinct namespace from ledger `JV-`) |
| companyId | str | |
| kind | str | `Income`\|`Expense` |
| category | str | context-specific (e.g. `Ticket Sales`, `Office Rent`) |
| desc | str | |
| amount | int | BDT |
| method | str | `Bank`\|`Cash`\|`bKash`\|`Cheque` |
| date / created | date | |

#### `acc_schedules` — payables/receivables schedule
| Field | Type | Notes |
|---|---|---|
| id | str | `SCH-001…` |
| companyId | str | |
| party | str | vendor or corporate name (string) |
| kind | str | `Payable`\|`Receivable` |
| amount | int | BDT |
| due | date | drives the "Payment due" automation |
| status | str | `Pending`\|`Partial`\|`Paid` |
| ref | str | `INV-####` |
| created | date | |

#### `expenseHeads` — master list of expense categories (Settings)
| Field | Type | Notes |
|---|---|---|
| id | str | `EH-01…` |
| name | str | |
| type | str | `Fixed`\|`Variable`\|`Statutory` |

---

### 2.C Travels

#### `visaCats` — visa product catalogue
| Field | Type | Notes |
|---|---|---|
| id | str | `VC-01…` |
| country | str | |
| flag | str | emoji |
| type | str | `Tourist`\|`Business`\|`Visit`\|`Umrah`\|`Student`\|`Work` |
| cost | int | our cost BDT |
| sale | int | client price BDT |
| days | int | processing days |
| status | str | `active`\|`inactive` |

#### `visaApps` — visa application files
| Field | Type | Notes |
|---|---|---|
| id | str | `VA-5001…` |
| applicant | str | |
| phone / passport | str | |
| country / flag | str | |
| visaType | str | mirrors `visaCats.type` |
| catId | str | → `visaCats.id` |
| cost / sale | int | copied from category |
| stage | str | `New`\|`Documents`\|`Submitted`\|`Under Process`\|`Approved`\|`Rejected` |
| travelDate / created | date | |
| agent | str | → `employees.id` |
| payStatus | str | `Paid`\|`Partial`\|`Due` |

#### `airlines` — airline master (Air Ticketing)
| Field | Type | Notes |
|---|---|---|
| id | str | `AL-BG…` |
| name | str | |
| iata | str | 2-char code |
| country | str | |
| status | str | `active`\|`inactive` |

#### `airports` — airport master
| Field | Type | Notes |
|---|---|---|
| id | str | `AP-DAC…` |
| name | str | |
| iata | str | 3-char code |
| city / country | str | |

#### `airTickets` — issued air tickets
| Field | Type | Notes |
|---|---|---|
| id | str | `TK-7001…` |
| pnr / ticketNo | str | |
| passenger / phone / passport | str | |
| fromCode / toCode | str | → `airports.iata` |
| route | str | `DAC → DXB` |
| tripType | str | `One-way`\|`Round`\|`Multi-City` |
| airlineCode | str | → `airlines.iata` |
| airline | str | airline name (denormalised) |
| flightNo | str | |
| vendor | str | GSA/consolidator name (string ref → `vendors`/`party_txns`) |
| portal | str | `Sabre`\|`Amadeus`\|`Galileo`\|`Direct` |
| travelDate / purchaseDate / created | date | |
| cost / sale | int | BDT |
| costPaid | int | amount paid to vendor so far |
| payStatus | str | `Paid`\|`Partial`\|`Due` |
| agent | str | → `employees.id` |
| currency | str | `BDT` |
| status | str | `Issued`\|`Confirmed`\|`Hold`\|`Re-issued`\|`Void`\|`Refunded` |
| timeline | [{}] | `{ at:ms, text }` history entries |

#### `airRefunds` — ticket refund cases
| Field | Type | Notes |
|---|---|---|
| id | str | `RF-9001…` |
| pnr / passenger / airline / ticketNo | str | |
| gross | int | ticket value |
| airlineRefund | int | `gross - penalty` |
| penalty / fee | int | |
| netRefund | int | `gross - penalty - fee` |
| method | str | `Bank`\|`bKash`\|`Cash`\|`Card Reversal` |
| status | str | `Requested`\|`Filed`\|`Received`\|`Paid`\|`Rejected` |
| date | date | |

#### `airBsp` — BSP/ADM reconciliation (**singleton object**, not an array)
Structure: `{ txns:[], adms:[], unused:[], api:{} }`.

| Sub | Fields |
|---|---|
| `txns[]` | `id, passenger, airline, issueDate, comm, agencyAmt, bspAmt, status(Matched\|Unmatched\|Discrepancy)` |
| `adms[]` | `id, airline, ticketNo, reason, amount, date, status(Open\|Disputed)` |
| `unused[]` | `id, passenger, airline, value, expiry` |
| `api` | `{ connected:bool, endpoint, keyMasked, lastSync }` |

#### `vendors` — GSAs / consolidators / suppliers (payables side)
Seed shape is minimal; the vendor form (`vendor-agent.js`) extends it.

| Field | Type | Notes |
|---|---|---|
| id | str | `VN-301…` |
| name | str | |
| type | str | `Ticketing`\|`Visa`\|`Hotel`\|`Umrah`\|`Multi-service` |
| balance | int | payable BDT (can be negative) |
| creditLimit | int | |
| terms | str | `Cash`\|`Net 7`\|`Net 15`\|`Net 30` |
| *(form-added)* contact, email, phone, country, city, address, currency, openingBalance, paymentTerms, bank | mixed | populated when edited via UI |

#### `tv_tickets` — Travels ticket register (operational; parallel to `airTickets`)
`id, pnr, passenger, phone, airline, route, flightNo, travelDate, class(Economy\|Business),
tripType, vendor, cost, sale, payStatus, status(Issued\|Hold\|Re-issued\|Refunded\|Void),
agent(name), created`.

#### `tv_contract_flights` — charter/block-seat inventory
`id, airline, flightNo, route, category(Umrah\|Hajj\|Worker\|Tourist), depDate, seats,
sold, costSeat, saleSeat, vendor, status(Selling\|Sold Out\|Departed), created`. Drives
the "Contract flight deadline" automation (unsold seats near departure).

#### `tv_agents` — sub-agents (receivables + commission)
`id(AGT-001…), name, agency, phone, location, commission(%), balance, totalSales,
status(Active\|Inactive), created`. Credit-limit for agents defaults to 800000 in the
party ledger; the automation flags balances over a 150000 sentinel.

#### `tv_portals` — booking/settlement channels
`id(PTL-01…), name, type(GDS\|Visa\|Hotel Aggregator\|Insurance\|BSP-Settlement\|Embassy
Tracker), url, balance, autoSync(15 min\|Hourly\|Daily), status(Connected\|Disconnected\|Error),
created`.

#### `tv_files` — embassy/visa file management
`id(FL-001…), applicant, passport, country, agent(name), submitDate, decisionDue,
embassyStatus(Slot Booked\|Submitted\|Decision Pending\|Approved\|Rejected), embassyFee,
serviceFee, total, payStatus, created`. Idle undecided files > 3 days drive the "Visa
file idle" automation.

#### `tv_passports` — passport register
`id(PP-0001…), holder, passportNo, type(E-Passport\|MRP\|Official), nationality, dob,
issueDate, expiry, phone, created`.

#### `party_txns` — vendor/agent party ledger (owned by `views/travels/vendor-agent.js`)
The counterparty subledger; every invoice/payment also posts a balanced GL entry.

| Field | Type | Notes |
|---|---|---|
| id | str | `PT-940001…` / `uid('PT')` |
| party | str | party **name** (→ `vendors.name` or `tv_agents.name`) |
| partyType | str | `vendor`\|`agent` |
| companyId | str | `travels` |
| date | date | |
| ref | str | `PINV-…`, `PV-…`, etc. |
| desc | str | |
| kind | str | debit: `Invoice`\|`Purchase`\|`ADM`\|`Service Charge`; credit: `Payment`\|`Refund`\|`Credit Note`\|`Adjustment` |
| debit | int | charge (0 if a credit) |
| credit | int | settlement (0 if a debit) |
| due | date | on debits only (date + 30) |
| created | ms | |

---

### 2.D Woodart (interiors)

| Store | Purpose | Fields |
|---|---|---|
| `wa_projects` | interior projects | `id(WAP-001…), name, client, type(Residential\|Office\|Retail\|Restaurant), area, value, cost, stage(Design\|Production\|Installation\|Handover\|Completed), progress, start, deadline, designer, created` |
| `wa_estimates` | quotations | `id(EST-001…), title, client, items(int), value, status(Draft\|Sent\|Approved\|Rejected), validTill, created` |
| `wa_materials` | material stock | `id(MAT-001…), name, category, unit, stock, reorder, unitCost, supplier, created` |
| `wa_production` | workshop jobs | `id(JOB-001…), job, project→wa_projects.id, station(CNC\|Cutting\|Edge Banding\|Assembly\|Finishing), assignedTo, due, status(Queued\|Running\|Done\|Blocked), created` |
| `wa_installs` | site installs | `id(INS-001…), project→wa_projects.id, site, team, date, status(Scheduled\|In Progress\|Snagging\|Handover), snags, created` |
| `wa_purchases` | purchase orders | `id(WPO-001…), supplier, items, amount, status(Ordered\|Received\|Partial), date, created` |

---

### 2.E IT Solutions

| Store | Purpose | Fields |
|---|---|---|
| `it_projects` | software projects | `id(ITP-001…), name, client, type(Web\|ERP\|Mobile\|Cloud\|AMC), value, cost, stage(Discovery\|Development\|Testing\|UAT\|Live\|Maintenance), progress, lead, deadline, created` |
| `it_subscriptions` | recurring products | `id(SUB-001…), product, client, plan(Basic\|Pro\|Enterprise), mrr, startDate, renewal, status(Active\|Past Due\|Cancelled), created` |
| `it_tickets` | support tickets | `id(TIC-0001…), subject, client, priority(Urgent\|High\|Medium\|Low), assignee, slaHours(4\|8\|24\|48), status(Open\|In Progress\|Waiting\|Resolved\|Closed), created` |
| `it_timesheets` | logged hours | `id(TS-0001…), employee(name), project→it_projects.id, date, hours, billable(Yes\|No), note, created` |
| `it_contracts` | client contracts | `id(CON-001…), client, type(AMC\|SLA\|License\|NDA), value, startDate, endDate, status(Active\|Expiring\|Expired), created` |

---

### 2.F Shop (retail / POS)

| Store | Purpose | Fields |
|---|---|---|
| `sh_products` | catalogue/inventory | `id(PRD-0001…), name, sku, category, brand, unit, costPrice, salePrice, stock, reorder, status(Active), created` — `stock ≤ reorder` drives "Low stock" automation |
| `sh_orders` | sales orders | `id(ORD-0001…), customer, phone, items, amount, channel(Counter\|Online\|Facebook), payMethod(Cash\|bKash\|Nagad\|Card), status(Completed\|Processing\|Delivered\|Returned), date, created` |
| `sh_purchases` | purchase orders | `id(SPO-001…), supplier, items, amount, status(Ordered\|Received\|Partial), date, created` |
| `sh_suppliers` | suppliers | `id(SUP-01…), name, contact, phone, category, balance, terms(Cash\|Net 7\|Net 15\|Net 30), created` |

---

### 2.G Construction

| Store | Purpose | Fields |
|---|---|---|
| `cn_projects` | sites/portfolio | `id(CNP-001…), name, client, value, cost, progress, stage(Mobilization\|Structure\|Finishing\|Handover\|On Hold\|Completed), start, deadline, engineer, created` |
| `cn_tenders` | tender pipeline | `id(TND-001…), title, authority(LGED\|PWD\|RHD\|DPHE\|…), value, submission, emd, status(Preparing\|Submitted\|Won\|Lost), created` |
| `cn_boq` | bill of quantities | `id(BOQ-0001…), project→cn_projects.id, item, unit, category(Civil\|Structure\|Electrical\|Plumbing\|Finishing\|Earthwork), qty, rate, amount(=qty×rate), created` |
| `cn_materials` | site materials | `id(CMT-001…), name, unit, stock, reorder, unitCost, site→cn_projects.id, supplier, created` |
| `cn_equipment` | plant/equipment | `id(EQP-001…), name, type(Owned\|Rented), site→cn_projects.id, status(Working\|Idle\|Maintenance), utilization, nextService, created` |
| `cn_subcontractors` | subcontracts | `id(SUBC-001…), name, trade, site→cn_projects.id, contractValue, paid, status(Active\|Completed), created` |
| `cn_labor` | labour roster | `id(LBR-001…), name, trade, site→cn_projects.id, wage, present, absent, status(Active\|Left), created` |
| `cn_incidents` | HSE incidents | `id(HSE-001…), site→cn_projects.id, type(Near Miss\|First Aid\|Injury\|Property Damage), severity(Low\|Medium\|High), date, status(Closed\|Investigating\|Open), note, created` |

#### `cn_workorders` — WBS work orders (owned by `views/construction/projects.js`)
| Field | Type | Notes |
|---|---|---|
| id | str | `WO-001…` |
| project | str | → `cn_projects.id` |
| title | str | |
| trade | str | `Civil`\|`Structure`\|`Electrical`\|`Plumbing`\|`Finishing`\|`Earthwork` |
| assignedTo | str | person name |
| materialCost / laborCost | int | BDT (sum → project committed cost) |
| status | str | `Planned`\|`In Progress`\|`On Hold`\|`Completed` |
| due / created | date | |

#### `cn_billing` — milestone / IPC ledger (owned by `views/construction/projects.js`)
| Field | Type | Notes |
|---|---|---|
| id | str | `IPC-001…` |
| project | str | → `cn_projects.id` |
| milestone | str | |
| pct | int | % of work certified |
| amount | int | gross BDT |
| retentionPct | int | % held |
| retentionAmount | int | `round(amount × retentionPct/100)` |
| status | str | `Draft`\|`Submitted`\|`Certified`\|`Paid` |
| date | date | |
| saleRef | str | set on "Raise IPC" → `sales.id` (net posted via `postSale`) |

---

### 2.H HR

#### `leave_requests` — leave apply→approve workflow (owned by `views/admin/employees.js`)
| Field | Type | Notes |
|---|---|---|
| id | str | `LV-2001…` |
| empId | str | → `employees.id` |
| type | str | `Casual`\|`Sick`\|`Annual`\|`Unpaid` |
| from / to | date | |
| days | int | |
| reason | str | |
| status | str | `Pending`\|`Approved`\|`Rejected` |
| created | date | |
| approvalId | str | optional → `approvals.id` (maker-checker mirror) |

#### `payroll_runs` — executed payroll batches
| Field | Type | Notes |
|---|---|---|
| id | str | `PR-<base36>` |
| date | date | |
| period | str | e.g. `July 2026` |
| headcount | int | |
| gross / tax / net | int | tax = 5% of gross |
| at | ms | |
| by | str | run-by name |
| companies | [{}] | `{ companyId, gross, net, count }` — posts DR 5100 / CR 1010 per company |

#### `attendance_log` — daily punch/adjust journal
`id(ATL-…), empId→employees.id, empName, companyId, date, status(present\|late\|absent\|leave),
note, at:ms`. Each punch also increments the counter on `employees.attendance`.

#### `designations` — designation master (Settings)
`id(DS-01…), name, dept`.

---

### 2.I Trust — audit / approvals / permissions

#### `audit_log` — tamper-evident "who did what, when" (`engines/audit.js`)
Append-only, **capped at the most-recent 500 rows** (`capStore`).

| Field | Type | Notes |
|---|---|---|
| id | str | `uid('AL')` |
| at | ms | |
| user / userName | str | actor id + display name |
| action | str | `create`\|`update`\|`delete`\|`post`\|`login`\|`logout`\|`approve`\|`reject`\|`export`\|`config`\|`permission`\|`state` |
| entity | str | store/entity name |
| entityId | str | |
| entityLabel | str | friendly label |
| companyId | str | |
| changes | {}\|null | `{ field:{ old, new } }` field-level diff |
| reason | str | |
| ip | str | demo constant `127.0.0.1` |
| agent | str | `navigator.userAgent` |

Only stores present in the `LABELS` map are auto-audited; noise stores (`audit_log`,
`serials`, `module-overrides`, `activity`, `notifications`, `gl_entries`, `coa`) are
ignored. The ledger self-audits its own postings (so `gl_entries` is skipped here to
avoid double-logging).

#### `approvals` — maker-checker requests (`engines/approvals.js`)
| Field | Type | Notes |
|---|---|---|
| id | str | `AP-3001…` / `uid('APR')` |
| at | ms | |
| docType | str | `payment`\|`refund`\|`salary-change`\|`credit-limit-override`\|`client-delete`\|`leave`\|… |
| docId | str | → the underlying doc (e.g. `VN-301`, `RF-9002`, `EPL-DEV1`, `CUS-1013`, `LV-…`) |
| companyId | str | |
| title | str | |
| amount | int | |
| maker / makerName | str | requester (→ `employees.id`); **may not be the checker** |
| state | str | `pending`\|`approved`\|`rejected`\|`recalled` |
| level | int | current approval level (1-based) |
| levels | [str] | ordered required roles, one per level |
| steps | [{}] | `{ level, role, decidedBy, decidedByName, decision, at, comment }` |
| created | ms | |

#### `approval_matrix` — which roles must sign off (banded)
| Field | Type | Notes |
|---|---|---|
| docType | str | (no id; matched by docType + amount band) |
| minAmount | int | inclusive lower bound |
| maxAmount | int | exclusive upper bound (`999999999999` = ∞) |
| roles | [str] | ordered approver roles |

Default bands: payment 50k–500k → `[Finance Manager]`; payment ≥500k → `[Finance
Manager, MD]`; refund any → `[Finance Manager]`; salary-change → `[MD]`;
credit-limit-override → `[MD]`; client-delete → `[admin]`.

#### `role_templates` — action-level permission grants (`engines/permissions.js`)
| Field | Type | Notes |
|---|---|---|
| id | str | `RT-owner`, `RT-admin`, … |
| role | str | one of the 7 roles |
| label / desc | str | |
| grants | {} | map `"companyId/moduleId" → ['view','create','edit','delete','export','approve'] \| '*'`; wildcards allowed in both slots (`travels/*`, `*/accounts`, `*/*`) |

Actions vocabulary: `view · create · edit · delete · export · approve`. Only `delete`
and `approve` are hard-enforced for non-admins without a covering grant.

---

### 2.J Documents / Comments / Automation / Serials

#### `documents` — Document Center metadata (`engines/documents.js`)
| Field | Type | Notes |
|---|---|---|
| id | str | `DOC-0001…` / `uid('DOC')` |
| serial | str | `INV/2026/000001` (from the serial engine) |
| type | str | `invoice`\|`receipt`\|`voucher`\|`workorder`\|`salary`\|`quotation`\|`po`\|`visacover`\|`ticket` |
| title | str | |
| companyId | str | |
| party | str | counterparty name |
| amount | int | BDT |
| at | ms | |
| by | str | issuer name |

Type→prefix map: invoice INV · receipt RCP · voucher JV · workorder WO · salary SAL ·
quotation QUO · po PO · visacover VISA · ticket TKT.

#### `comments` — collaboration threads + @mentions (`engines/comments.js`)
| Field | Type | Notes |
|---|---|---|
| id | str | `uid('CMT')` |
| entityType | str | the kind of thing commented on (`visaApps`, `airTickets`, `task`, `customer`, `party`, `employee`, `cn_project`, …) |
| entityId | str | → that entity's id **or name** (e.g. party/customer name) |
| at | ms | |
| by / byName | str | author (→ `employees.id`) |
| text | str | raw text (rendered safely; `@Name` highlighted) |
| mentions | [str] | resolved `employees.id[]`; each is notified |

#### `automation_rules` — the rule book (`engines/rules.js`)
| Field | Type | Notes |
|---|---|---|
| id | str | `AR-01…` |
| name | str | |
| trigger | str | `Sale recorded`\|`Low stock`\|`Visa file idle`\|`Payment due`\|`Task overdue`\|`Contract flight deadline`\|`Credit limit breached`\|`Month-end recurring` |
| condition | str | human description |
| action | str | `Send notification`\|`Create task for admin`\|`Escalate to MD`\|`Generate document`\|`Email report` |
| active | bool | |
| schedule | str | `realtime`\|`daily` |
| lastRun | ms\|null | |
| runs | int | |
| lastFired | date\|null | dedupe key (frozen demo-day) |
| history | [{}] | `{ at, count, note }` (last 10) |
| created | date | |

#### `automation_meta` — automation bookkeeping (**singleton object**)
`{ escalatedDay: 'YYYY-MM-DD' }` — guards once-per-day MD escalation.

#### `serials` — gapless document counters (**singleton object**, `engines/serial.js`)
Map of `"<company?>:<PREFIX>:<fiscalYear>" → highest issued int`, e.g.
`{ "INV:2026": 42, "travels:JV:2026": 7 }`. Format `PREFIX/FY/000NNN`. Reconciled on
first read against seeded `documents` serials so runtime numbers never collide with
seeded ones.

---

### 2.K Settings & app-state (singleton objects)

| Key | Shape / purpose |
|---|---|
| `settings.group` | `{ name, legalName, tagline, currencySymbol, fiscalNote, dateFormat, theme }` — group identity/locale/appearance |
| `settings.finance` | `{ fyStartMonth, baseCurrency, vatRate, reducedVatRate, workingDays, weekend, invoicePrefix, invoicePad, receiptPrefix, voucherPrefix }` |
| `settings.hrPolicy` | `{ annualLeave, casualLeave, sickLeave, maternityLeave, overtimeRule, overtimeCap, basicPct, houseRentPct, medicalPct, conveyancePct }` (salary components must total 100%) |
| `settings.<companyId>` | per-company branding `{ displayName, accent }` |
| `settings` (legacy) | read by HR for `leaveQuota`/`annualLeave` fallback |
| `module-overrides` | `{ "<co>[/mod[/sub]]": bool }` enable/disable map (see §1.4) |
| `ui.theme` | `'dark'` \| `'light'` |

---

## 3. Relationships (foreign-key map)

References are by string id unless marked **(name)** — those join on a display-name
string and are the first things to normalise in a relational port.

```
COMPANY REGISTRY (config.js, not localStorage)
  companies[].id  ──referenced-by──▶  financials.companyId, employees.companyId,
        sales.companyId, gl_entries.companyId, leads.companyId, banks.companyId,
        every tv_/wa_/it_/sh_/cn_ record's companyId/scope, settings.<companyId>

CORE / PEOPLE
  employees.id ◀── leads.owner, visaApps.agent, airTickets.agent,
                   tasks.<empId> (board key), leave_requests.empId,
                   attendance_log.empId, approvals.maker, comments.by,
                   comments.mentions[], notifications.to, audit_log.user
  employees.companyId ─▶ companies.id
  customers.companyIds[] ─▶ companies.id (many-to-many)
  customers.name ◀── sales.customer (name), comments.entityId when entityType=customer

FINANCE / LEDGER
  gl_entries.lines[].account ─▶ coa.code            (the core double-entry join)
  gl_entries.party ─▶ vendors.name / tv_agents.name / customers.name  (name)
  gl_entries.ref   ─▶ sales.ref (for source='sale'), payroll_runs.id (source='payroll'),
                      party_txns.ref (source='manual' from vendor-agent posts)
  banks.balance    ─▶ seeds gl_entries opening entries (GL-OB-<bankId>)
  acc_schedules.party ─▶ vendor/corporate (name)

TRAVELS
  visaApps.catId ─▶ visaCats.id
  airTickets.fromCode / toCode ─▶ airports.iata
  airTickets.airlineCode ─▶ airlines.iata ; airTickets.airline ─▶ airlines.name (denorm)
  airTickets.vendor ─▶ vendors.name (name)
  party_txns.party ─▶ vendors.name (partyType=vendor) / tv_agents.name (partyType=agent) (name)
  tv_production/tv_installs ... project ─▶ wa_projects.id (Woodart parallels)

CONSTRUCTION
  cn_boq.project, cn_workorders.project, cn_billing.project,
    cn_materials.site, cn_equipment.site, cn_subcontractors.site,
    cn_labor.site, cn_incidents.site  ─▶ cn_projects.id
  cn_billing.saleRef ─▶ sales.id (created on Raise IPC)

WOODART / IT
  wa_production.project, wa_installs.project ─▶ wa_projects.id
  it_timesheets.project ─▶ it_projects.id

TRUST / GOVERNANCE
  approvals.docId ─▶ the underlying doc (vendors.id, airRefunds.id, employees.id,
                     customers.id, leave_requests.id, …) — polymorphic by docType
  approvals.levels[] / approval_matrix.roles[] ─▶ role names (Finance Manager, MD, admin, …)
  leave_requests.approvalId ─▶ approvals.id
  role_templates.grants keys ─▶ "companyId/moduleId" (config registry)
  audit_log.entity + entityId ─▶ any store + record (polymorphic)

DOCUMENTS / COLLAB / AUTOMATION
  documents.serial ─▶ serials counter stream ; documents.type ─▶ PREFIX map
  comments.entityType + entityId ─▶ any entity (polymorphic; id OR name)
  automation_rules.trigger ─▶ live data queries (sh_products, tv_files, acc_schedules,
                     tasks.*, tv_contract_flights, vendors/tv_agents, employees)
```

Cardinality highlights: `financials` 1-company-to-12-months · `customers` M:N companies ·
`gl_entries` 1-to-many `lines` · `cn_projects` 1-to-many BOQ/WO/billing/materials/etc ·
`tasks.<empId>` 1-employee-to-1-board-to-many-tasks · `approvals`/`comments`/`audit_log`
polymorphic to any entity.

---

## 4. The cross-company artery: `db.postSale`

`EPAL.db.postSale(companyId, sale)` is the **single artery** connecting operations →
finance → BI. Any module that closes a sale (an air ticket, an IT milestone, a
construction IPC, a counter sale) calls it, and every downstream surface moves in
lockstep. An auditor can trace any figure end-to-end through this chain:

```
  module closes a sale
        │
        ▼
  db.postSale('construction', { amount, cost, ref, desc, customer })
        │
        ├─(1) build record  SL-<base36><rand>  { id, companyId, date, amount, cost,
        │        profit=amount-cost, ref, desc, customer }
        │        └── S.upsert('sales', rec)                    → the sales register
        │
        ├─(2) roll into that company's LATEST financials month row:
        │        last.revenue += amount ; last.expense += cost ; S.set('financials', …)
        │        └── company dashboard, Accounts, Group Command Center all move
        │
        ├─(3) bus.emit('sale:recorded', rec)                   ← the key event
        │        └── engines/ledger.js boot() listener AUTO-POSTS a balanced GL entry:
        │              DR 1200 Accounts Receivable   amount
        │              CR 4000 Sales Revenue         amount
        │              (if cost>0)
        │              DR 5000 Cost of Sales         cost
        │              CR 2000 Accounts Payable      cost
        │            → entry id 'GL-S<saleId>', source='sale', ref=sale.ref,
        │              party=sale.customer, companyId=sale.companyId
        │            → ledger.post() validates Σdr==Σcr, upserts gl_entries,
        │              emits 'ledger:posted', and records an audit row
        │
        ├─(4) bus.emit('data:changed', { store:'sales', action:'create', record })
        │        └── audit engine logs a 'create' on 'sales' (Sale label)
        │
        └─(5) db.log(actor, 'Sale <money> · <desc>', companyId)  → activity feed
```

Double-post guard: the ledger boot listener tracks posted sale keys (`ref` or
`GL-S<id>`) so the same sale is never journaled twice, even across reloads. Seeded
`sales` rows are pre-reflected in seeded `financials` and are backfilled into
`gl_entries` at seed time (`GL-S…`), so they are **not** re-rolled into financials.

**Trace example.** A Construction IPC "Raise IPC" (`projects.js`) posts net-of-retention
revenue via `postSale`. To audit ৳X:
`cn_billing.IPC-00N.saleRef` → `sales.SL-…` (amount=net, ref=IPC id) →
`sale:recorded` → `gl_entries.GL-SSL-…` (DR 1200 / CR 4000) → visible in
`ledger.trialBalance('construction')`, `ledger.pnl('construction')`, and rolled into
`financials` for the current month → surfaced in `groupSnapshot()`.

---

## 5. Integrity rules

1. **Double-entry balance.** `ledger.post()` refuses any entry where `Σdr ≠ Σcr`
   (tolerance 0.5 for float noise) — it throws before writing. Every stored
   `gl_entries` row therefore balances, and `balanceSheet().totals.balanced` holds
   (assets = liabilities + equity, with current-year earnings folded into equity).

2. **Serial gaplessness.** `serials` counters are the single numbering authority.
   `next(prefix)` atomically increments and persists; `peek()` never consumes.
   On first use `reconcile()` seeds counters **above** any serial already printed on a
   seeded document, so runtime numbers never duplicate or regress. Format is a stable
   `PREFIX/FY/000NNN`, resetting per (prefix, fiscal-year).

3. **Audit append-only + capped.** `audit.record()` only ever `upsert`s new rows (fresh
   `uid`), never edits or deletes existing ones. `capStore()` trims to the most-recent
   **500** rows by timestamp — history is immutable, only the oldest tail is pruned. The
   first write for an entity is a `create`; every later write is an `update` (never a
   second create), so same-day edits/voids are labelled correctly.

4. **Maker ≠ checker (segregation of duties).** `approvals.decide()` throws
   `"Maker cannot approve own request"` if the deciding user equals `req.maker`.
   `pending({forUser})` also hides a user's own requests from their queue. Rejections
   require a mandatory comment. Multi-level requests advance role-by-role through
   `levels[]`; only the final level flips state to `approved` and runs the registered
   executor.

5. **Idempotent seeds / reset-safe.** All seeds use `seedOnce`, so reseeding never
   clobbers live data, and `db.reset()` (`nuke()` + `seed()`) rebuilds a clean, fully
   self-consistent dataset. Deterministic PRNGs keep it byte-stable.

6. **Permissions fail-open but destructive-safe.** `perm.can()` never throws; unknown
   cases return `true` so the demo never dead-ends — except `delete`/`approve`, which
   are hard-denied to non-admins lacking an explicit grant.

7. **Escape / no raw HTML for user data.** All persisted text is rendered via
   `el({text})` or `ui.escapeHtml`; comments build DOM text nodes (never `innerHTML`),
   so stored content cannot inject markup.
