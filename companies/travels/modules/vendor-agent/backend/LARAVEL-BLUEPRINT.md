# Vendor & Agent — Laravel backend blueprint

Source of truth: `companies/travels/modules/vendor-agent/view.js` (line refs below). One SPA view branches on sub-route (view.js:206-226). Company scope: `travels`.

## Purpose & screens
- **overview** (`#/travels/vendor-agent`) — KPIs: vendor count, agent count, total payable, agent receivable, overdue (view.js:238-246); "Top Open Balances" table of parties with |balance| > 0.5, sorted by absolute balance, row-click opens ledger modal (view.js:262-288).
- **vendors** — CRUD table of vendors (GSAs/consolidators); Payable column = live ledger balance falling back to stored `balance` (view.js:306-309, 786-791); row-click opens party ledger.
- **agents** — CRUD table of sub-agents; Receivable column = same ledger-balance fallback (view.js:378-381).
- **portals** — CRUD table of booking/settlement channels (GDS, BSP, VFS…) (view.js:429-477). No ledger interaction.
- **accounts** — party picker (vendors + agents + any party appearing in txns) → full ledger: header with balance/charged/settled/credit-limit + utilisation bar, ageing buckets, running-balance statement table, Record Invoice / Record Payment actions, printable branded Statement, comments thread (view.js:480-603).
- **commission** — per-agent expected vs received vs outstanding commission, slab tier cards, KPI totals, top agent (view.js:706-767).

## Entities & fields
Today's localStorage stores (ns `epal.v1.`), accessed via `EPAL.db` / `EPAL.store`:

**Vendor** — store `vendors` (shared travels store; view.js:112, saved 351):
`id` string `VN-xxxx` (view.js:345) · `name` string required · `type` enum [Ticketing, Visa, Hotel, Umrah, Multi-service] · `contact` string · `email` string · `phone` string · `country` string (default Bangladesh) · `city` string (default Dhaka) · `address` text · `currency` enum [BDT, USD, SAR, AED, EUR] · `creditLimit` decimal (default 500000) · `terms`/`paymentTerms` enum [Cash, Net 7, Net 15, Net 30, Net 45] (both keys written, view.js:348-349) · `bank` string · `balance` decimal (opening payable, set only on create) · `openingBalance` decimal (set on edit) (view.js:350).

**Agent** — store `tv_agents` (view.js:113, saved 416):
`id` string `AGT-xxxx` · `name` string required · `agency` string required · `phone` string · `location` string (default Dhaka) · `commission` number % (0–20, default 4) · `totalSales` decimal (YTD) · `balance` decimal (opening receivable) · `status` enum [Active, Inactive].

**Portal** — store `tv_portals` (view.js:114, saved 471):
`id` string `PTL-xxxx` · `name` string required · `type` enum [GDS, Visa, Hotel Aggregator, Insurance, BSP-Settlement, Embassy Tracker] · `url` string · `balance` decimal (wallet) · `autoSync` enum [15 min, Hourly, Daily] · `status` enum [Connected, Disconnected, Error].

**PartyTxn** — store `party_txns` (seeded idempotently via engine registry, view.js:47-49; written at 635):
`id` string `PT-…` · `party` string (party NAME is the FK today) · `partyType` enum [vendor, agent] · `companyId` = 'travels' · `date` date · `ref` string (see serial formats) · `desc` string · `kind` enum — debit kinds [Invoice, Purchase, ADM, Service Charge], credit kinds [Payment, Refund, Credit Note, Adjustment] (view.js:34-35) · `debit` decimal · `credit` decimal (exactly one non-zero) · `due` date = date+30 for debits, '' for credits (view.js:634) · `created` epoch ms (tiebreak sort key, view.js:119-122).

## Business rules
- **Running balance**: balance = Σ(debit − credit) in (date, created) order (view.js:145-154). List rows carry per-row cumulative balance.
- **Ageing (FIFO)**: apply total credits to oldest debits (sorted by due-or-date); unpaid remainder bucketed by age vs "today" against the debit's due date: Current (≤0 days), 1–30, 31–60, 60+ (view.js:158-178). Remainders ≤ 0.5 ignored. Demo "today" is fixed 2026-07-05 (view.js:28) — in Laravel use `now()`.
- **Roll-up KPIs**: payable = Σ positive vendor balances; receivable = Σ positive agent balances; overdue = Σ(d30+d60+d90) across all parties (view.js:188-201).
- **Ledger-balance fallback**: list Payable/Receivable columns use live txn balance; if a party has NO txns, fall back to the record's stored `balance` field (view.js:786-791).
- **Credit control**: utilisation = round(max(0, balance)/creditLimit × 100); warn tint > 70%, alert banner > 90% (view.js:512-538). Default limits when unset: vendor 500,000, agent 800,000 (view.js:128-137). Advisory only — posting is NOT blocked.
- **Record txn validation**: amount required, must be > 0 (rejected otherwise, view.js:627-628); kind constrained to the debit or credit list; debit txns get `due = date + 30 days`.
- **Balanced double-entry post** on every recorded txn (view.js:644-660):
  - agent charge: DR 1150 (agent receivable) / CR 4000 (revenue)
  - vendor charge: DR 5000 (COGS/purchase) / CR 2000 (payable)
  - agent settlement: DR 1010 (cash) / CR 1150
  - vendor settlement: DR 2000 / CR 1010
  Journal memo `"{kind} · {party}"`, source `manual`, party name attached. Ledger failure is caught and logged, txn still saved (mirror with DB transaction in Laravel: make both atomic).
- **Serial/ref formats**: txn ref = kind prefix + '-' + (1000 + n%9000): PINV/PO/ADM/SVC (debits), PV/RF/CN/ADJ (credits) (view.js:93-97). Statement serial via serial engine `STMT` scoped to company travels, fallback `STMT/{year}/{6 digits}` (view.js:818-821).
- **Commission**: expected = round(totalSales × commission%/100); received is a demo deterministic 50–94% hash of agent id (view.js:757-761) — in Laravel, received must come from real commission-payment records; outstanding = max(0, expected − received). Tiers by sales: Bronze < 500k, Silver ≥ 500k, Gold ≥ 2,000,000, Platinum ≥ 5,000,000 (view.js:762-767). Slab display card claims rates 2/4/6/7% (view.js:37-42) — display data only, not applied in calculations.
- **Delete**: confirm dialog then hard remove (view.js:778-785). No cascade — party txns survive party deletion (parties reconstructed from txns in `allParties`, view.js:135-138).

## Routes
```
GET    /travels/vendor-agent                      overview KPIs + top exposures
GET    /travels/vendor-agent/vendors              index (search name/type/phone/terms; filter type,terms)
POST   /travels/vendor-agent/vendors              store
PUT    /travels/vendor-agent/vendors/{vendor}     update
DELETE /travels/vendor-agent/vendors/{vendor}     destroy
GET/POST/PUT/DELETE /travels/vendor-agent/agents  same CRUD (search name/agency/location; filter status,location)
GET/POST/PUT/DELETE /travels/vendor-agent/portals same CRUD (search name/type/url; filter type,status)
GET    /travels/vendor-agent/parties              picker list (vendors ∪ agents ∪ txn parties)
GET    /travels/vendor-agent/parties/{party}/ledger      statement rows + ageing + credit util
POST   /travels/vendor-agent/parties/{party}/transactions   record invoice (debit) or payment (credit)
GET    /travels/vendor-agent/parties/{party}/statement   branded statement document (PDF)
GET    /travels/vendor-agent/commission           commission ledger + KPIs + tiers
```

## Controllers
- **VendorAgentOverviewController@index** → counts + rollup {payable, receivable, overdue} + top open balances.
- **VendorController@{index,store,update,destroy}** → vendor list (each row with computed live payable), saved/deleted vendor.
- **AgentController@{index,store,update,destroy}** → agent list with live receivable.
- **PortalController@{index,store,update,destroy}** → portal list.
- **PartyLedgerController@show** → {party meta, rows[] with running balance, totals {balance,debit,credit}, ageing {current,d30,d60,d90,total}, utilisation}; **@storeTransaction** → validates kind/amount/date, creates PartyTransaction + balanced journal entry in one DB transaction, returns txn with ref; **@statement** → statement payload/PDF (serial, parties block, meta, rows incl. Opening Balance row, closing balance, amount-in-words, ageing terms line — view.js:663-703).
- **CommissionController@index** → per-agent {totalSales, rate, expected, received, outstanding, tier} + totals + top agent + slab config.

## Models & migrations
- **Vendor** — fillable: name,type,contact,email,phone,country,city,address,currency,credit_limit,payment_terms,bank,opening_balance; casts: credit_limit/opening_balance decimal:2. Columns: id, name, type, contact, email, phone, country, city, address text, currency(3), credit_limit decimal(14,2) default 500000, payment_terms, bank, opening_balance decimal(14,2) default 0, company_id default 'travels', timestamps.
- **TravelAgent** (table `tv_agents`) — fillable: name,agency,phone,location,commission_rate,total_sales,opening_balance,status; casts: commission_rate decimal:2, total_sales/opening_balance decimal:2. Columns as fillables + company_id, timestamps.
- **Portal** (table `tv_portals`) — fillable: name,type,url,balance,auto_sync,status; cast balance decimal:2.
- **PartyTransaction** (table `party_txns`) — fillable: party_name,party_type,company_id,date,ref,kind,description,debit,credit,due_date; casts: date/due_date date, debit/credit decimal:2. Columns: id, party_name indexed, party_type enum(vendor,agent), company_id, date, ref, kind, description, debit decimal(14,2) default 0, credit decimal(14,2) default 0, due_date nullable, timestamps (created_at replaces `created` ms sort key). Seeder mirrors seedPartyTxns (view.js:51-92): 4 txns × 10 named parties, deterministic.

### Form validation summary (from formModal field specs)
- Vendor: `name` required (view.js:328); all other fields optional with the defaults listed above.
- Agent: `name` and `agency` required (view.js:401-402); `commission` numeric 0–20; `totalSales` ≥ 0.
- Portal: `name` required (view.js:460).
- Party transaction: `date` required (default today), `amount` required money ≥ 1 with server-side > 0 re-check (view.js:620-628); `kind` must be in the debit list for invoices or credit list for payments; blank description falls back to the kind's canonical text (view.js:98-107, 632).

## Policies/permissions
Mirrors `EPAL.perm.can('travels','vendor-agent', action)` (view.js:770-771): **create** gates Add Vendor/Agent/Portal buttons AND Record Invoice/Record Payment (view.js:293, 365, 430, 545-549); **delete** gates delete actions (view.js:773-777). Edit is not permission-gated today; viewing/statement is open to module users. Laravel: `VendorAgentPolicy` with `create` and `delete` abilities checked per company-module; apply `can:` middleware on POST/DELETE routes.

## Events
- **party.transaction.recorded** — on every invoice/payment post (the only place this module moves money, view.js:626-641); payload {party, party_type, kind, debit|credit amount, ref, date, company_id}. The group bridge consumes payables/receivables via the journal, so the paired **journal posting** (below) is the authoritative money event.
- No sale/ticket events here — sales figures (`totalSales`) are entered, not transacted.

## Engine dependencies
- **EPAL.ledger.post** → Laravel `LedgerService::post()` writing balanced journal_entries + journal_lines (accounts 1010, 1150, 2000, 4000, 5000; source 'manual'; party tag). Must stay in sync with group finance.
- **EPAL.serial.next('STMT', {company:'travels'})** → `SerialService` per-company sequence for statement numbers, with the documented fallback format.
- **EPAL.doc.open / amountInWords** → statement PDF renderer (voucher layout, watermark STATEMENT) + Bengali/English amount-in-words helper.
- **EPAL.comments.widget('party', name)** → polymorphic `comments` (commentable_type 'party', key = party name) shown on the ledger screen (view.js:599-602).
- **EPAL.db / EPAL.store (seedOnce)** → Eloquent + idempotent database seeder for `party_txns`.
- **EPAL.perm** → policy layer above. No approvals/intel/rules engine usage in this module.
