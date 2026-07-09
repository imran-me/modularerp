# Air Ticketing — Laravel backend blueprint

Source of truth: `companies/travels/modules/air-ticketing/view.js` (line refs below) + `module.json`.
Currency is BDT throughout (view.js:370). Demo "today" is pinned to 2026-07-05 for countdowns (view.js:32) — in Laravel use `now()`.

## Purpose & screens
One SPA view serves 9 sub-routes (view.js:135-160):
- **overview** — KPIs (tickets sold, issued count, sales value, net profit) + section cards + 8 most-recent tickets (view.js:175-212).
- **ticketing (Direct Sale)** — multi-passenger issue form: per-pax base fare/taxes/vendor, itinerary, GDS portal, markup split across pax, sub-agent commission, payable/receivable schedule, live fare summary, branded IATA-style invoice via doc engine (view.js:215-417).
- **manage-sales** — searchable sales ledger with base/tax/cost/sale/commission/net-profit columns, CSV export, ticket detail drawer (status moves, mark paid/due, reissue, void, refund, delete, comments), per-airline & per-agent profit report + bar chart (view.js:421-520, 463-510).
- **emd (EMD & Ancillary)** — sell ancillary services (baggage, seat, meal, insurance…) as EMD lines; register table with filters; receipt document; mark paid/due (view.js:1051-1220).
- **ttl (Ticketing Deadlines)** — held-PNR queue with urgency buckets (<24h red, <72h amber), "Ticket now" (posts sale at 92% cost assumption) and "Extend deadline" (view.js:1223-1377).
- **airlines / airports** — masters CRUD (view.js:648-712).
- **bsp (BSP / ADM Recon)** — import BSP billing CSV, auto-match rows to issued tickets, exception list (mismatch / bsp-only / erp-only) with waive/accept, "Mark Reconciled" gate; ADM tracker with 30-day dispute countdown; unused-tickets list (view.js:715-956).
- **refunds** — 5-stage refund lifecycle `Requested → Filed → Received → Paid | Rejected` (view.js:43) with payout math and ledger reversal on Paid (view.js:959-1048).

## Entities & fields (localStorage store → model)
1. **AirTicket** (`airTickets`, written view.js:357-373): id `TK-<5-digit stamp>-<n>`, pnr, ticketNo, passenger, phone, passport, fromCode, toCode, route ("DAC → DXB"), tripType (One-way|Round|Multi-City), airlineCode, airline, flightNo, vendor, portal (Sabre|Amadeus|Galileo|Direct), travelDate (date), purchaseDate (date), baseFare/taxes/markup/commission (int BDT), commissionPct (float), agent (tv_agents id), agentName, cost, sale, costPaid, payStatus (Paid|Partial|Due), payable {to, amount, date}, receivable {from, amount, date}, currency ('BDT'), status (Hold|Confirmed|Issued|Re-issued|Void|Refunded — view.js:35-42), voidPenalty, created, timeline [{at:ms, text}].
2. **Airline** (`airlines`, view.js:664-678): id `AL-####`, name, iata (uppercased), country, status (active|inactive).
3. **Airport** (`airports`, view.js:697-711): id `AP-####`, name, iata (uppercased, required), city, country.
4. **AirRefund** (`airRefunds`, view.js:991-1047): id `RF-####`, pnr, passenger, airline, ticketNo, date, gross, airlineRefund, penalty, fee, netRefund, method (Bank|bKash|Nagad|Cash|Card Reversal), status (REFUND_STAGES), _fromTicket (source ticket id), _origCost, _origComm, _reversed (bool guard).
5. **Emd** (`air_emd`, seeded view.js:70-93, written view.js:1168-1175): id, emdNo (serial), date, passenger, ticketRef, serviceType (8-item catalogue view.js:46-55), vendor, description, cost, sale, payStatus (Paid|Due), agent, created.
6. **TtlHold** (`air_ttl`, view.js:101-119): id `TTL-####`, pnr, passenger, airline, route, ttl (`YYYY-MM-DDTHH:MM`), status (Hold|Ticketed|Expired — view.js:56), amount, created.
7. **BspState** (`airBsp`, single object, read view.js:719, persisted view.js:771): `api {connected, endpoint, keyMasked, lastSync}`, `txns [{passenger, airline, issueDate, agencyAmt, bspAmt, status:Matched|Discrepancy|…}]`, `adms [{airline, ticketNo, reason, amount, status:Settled|Disputed|…, date}]`, `unused [{passenger, airline, value, expiry}]`, `recon {period, importedAt, count, matched, exceptions[], reconciled}`; exception = `{type:mismatch|bsp-only|erp-only, key, passenger, erpAmt, bspAmt, diff, waived, note}` (view.js:825-852). Normalise into `bsp_recons`, `bsp_exceptions`, `adms`, `unused_tickets` tables.
Reads (not owned): `tv_agents` sub-agents (view.js:124), `vendors`, `employees`.

## Business rules (all cited)
- **Fare math** (view.js:298-314): cost = Σ(baseFare+taxes); sale = cost + markup; gross profit = markup; commission = round(Σ baseFare × agent.commission% / 100); net = gross − commission. Net profit per ticket = sale − cost − commission (view.js:133).
- **Markup split** across N pax: each gets round(markup/N); last pax gets remainder so totals reconcile exactly (view.js:354).
- **Issue validation**: ≥1 named passenger; origin ≠ destination (view.js:338-340); masters gate — need ≥1 active airline + 1 airport (view.js:221).
- **Batch PNR**: user PNR or random 2-letter+4-digit (view.js:132,348); per-pax ids `TK-<stamp>-<idx>` (view.js:358).
- **Issue posting**: one `postSale('travels', {amount:sale, cost:cost+commission, ref:ticketId})` per pax so ledger profit reconciles with module net profit (view.js:377-378). costPaid = cost when payStatus=Paid else 0 (view.js:367).
- **Reissue** (view.js:591-617): requires penalty+fareDiff > 0; ticket cost += fareDiff, baseFare += fareDiff, sale += penalty+fareDiff, status→Re-issued; posts incremental sale `{amount:add, cost:diff, ref:id+'-RE'}`.
- **Void** (view.js:621-645): posts full reversal `{amount:-sale, cost:-cost, ref:id+'-VOID'}`; penalty>0 posted as pure income `id+'-VOIDFEE'`; status→Void, payStatus→Due, timeline appended.
- **Refund**: netRefund = gross − penalty − fee (view.js:1014). On status=Paid for ticket-linked refund, once only (`_reversed` guard): reverse `{amount:-gross, cost:-(origCost+origComm), ref:ticket+'-REFUND'}`, post retained penalty+fee as income `'-REFUNDFEE'`, flip source ticket to Refunded (view.js:1028-1043). Prefill from ticket: penalty 3000, fee 1000, airlineRefund = max(0,cost−3000), netRefund = max(0,sale−4000) (view.js:985-988).
- **Status moves** from detail drawer: choosing Refunded/Re-issued/Void routes into the respective flow; any other transition just saves + timeline entry (view.js:578-586). No approval/maker-checker in this module.
- **BSP reconciliation** (view.js:813-852): CSV `ticketNo,gross,commission,net`; match key = ticketNo OR pnr; |gross − sale| > 1 ⇒ mismatch exception; unmatched import row ⇒ bsp-only; Issued/Re-issued ticket absent from file ⇒ erp-only. "Mark Reconciled" blocked while any exception unwaived (view.js:892-896). Waive stamps an audit note (view.js:932-945).
- **ADM dispute deadline** = raised date + 30 days; overdue red, ≤7 days amber (view.js:948-956).
- **TTL urgency**: Expired or <24h ⇒ red, <72h ⇒ amber, else green (view.js:1321-1328). Ticket-now: status→Ticketed, postSale amount=amount, cost=round(amount×0.92) (view.js:1349-1352). Extend: new deadline must be future; Expired reverts to Hold (view.js:1367-1373).
- **EMD**: ≥1 line with serviceType and sale>0, passenger required (view.js:1159-1161); one EMD record per line, serial `EPAL.serial.next('EMD')` (view.js:1165); single aggregate postSale for the batch keyed to first EMD no (view.js:1181-1182).

## Routes (RESTful, mirror hash routes)
Prefix `/api/travels/air-ticketing` (hash routes `#/travels/air-ticketing[/sub]` map 1:1):
- `GET  /overview`                      — hub KPIs + 8 recent tickets
- `GET  /tickets?q=`                    — sales ledger + KPI totals (manage-sales)
- `POST /tickets`                       — batch issue (Direct Sale); returns tickets + invoice payload
- `GET|PATCH|DELETE /tickets/{id}`      — detail drawer / delete
- `POST /tickets/{id}/status`           — plain status move (adds timeline entry)
- `POST /tickets/{id}/toggle-pay`       — flip Paid ↔ Due (view.js:566)
- `POST /tickets/{id}/reissue`          — {penalty, fareDiff}
- `POST /tickets/{id}/void`             — {penalty}
- `POST /tickets/{id}/refund`           — prefills + creates AirRefund (view.js:984-989)
- `GET  /tickets/export`                — CSV (columns per view.js:513)
- `GET  /reports/profitability`         — by-airline / by-agent aggregates
- `GET|POST /airlines` · `PATCH /airlines/{id}`
- `GET|POST /airports` · `PATCH /airports/{id}`
- `GET|POST /refunds`  · `PATCH /refunds/{id}` — update runs Paid-reversal transaction
- `GET|POST /emds` · `PATCH /emds/{id}/toggle-pay` · `GET /emds/{id}/receipt`
- `GET  /ttl` · `POST /ttl/{id}/ticket-now` · `POST /ttl/{id}/extend` — {ttl datetime}
- `GET  /bsp` · `POST /bsp/import` (CSV body) · `POST /bsp/exceptions/{id}/waive` · `POST /bsp/reconcile`

## Controllers
- **AirTicketController**: index (search + KPI totals), store (batch: validates, splits markup, creates N tickets, posts N sales, returns invoice payload), show, updateStatus, togglePay, reissue, void, destroy, exportCsv, profitability (group-by airline/agent aggregates per view.js:469-477).
- **AirlineController / AirportController**: index, store, update (upsert masters).
- **AirRefundController**: index (+KPI sums), store, update (runs Paid-reversal logic in a DB transaction).
- **EmdController**: index (+revenue/profit KPIs, mix-by-type data), store (batch lines, serials, one aggregate sale post, receipt payload), togglePay.
- **TtlController**: index (buckets/countdowns computed server-side), ticketNow, extend.
- **BspController**: show (state + recon), import (parse CSV, reconcile, persist exceptions), waiveException, markReconciled (422 if open exceptions).

## Models & migrations
- `AirTicket` — fillable: all §Entities fields; casts: `payable/receivable/timeline => array`, money => integer, `travelDate/purchaseDate => date`. Migration: string pk-style id, pnr, ticket_no, passenger, phone, passport, from_code, to_code, route, trip_type, airline_code, airline, flight_no, vendor, portal, travel_date, purchase_date, integers base_fare/taxes/markup/commission/cost/sale/cost_paid/void_penalty, decimal commission_pct, agent_id nullable FK tv_agents, agent_name, pay_status, status, currency default 'BDT', json payable/receivable/timeline, timestamps.
- `Airline` (id, name, iata, country, status) · `Airport` (id, name, iata, city, country).
- `AirRefund` — ints gross/airline_refund/penalty/fee/net_refund; strings pnr/passenger/airline/ticket_no/method/status; date; from_ticket_id nullable FK; orig_cost, orig_comm, reversed boolean default false.
- `Emd` — emd_no unique, date, passenger, ticket_ref, service_type, vendor, description, cost, sale, pay_status, agent_id nullable.
- `TtlHold` — pnr, passenger, airline, route, ttl datetime, status, amount.
- `BspRecon` (period, imported_at, row_count, matched, reconciled bool) + `BspException` (recon_id FK, type, key, passenger, erp_amt, bsp_amt, diff, waived bool, note) + `Adm` (airline, ticket_no, reason, amount, status, raised_date) + `UnusedTicket` (passenger, airline, value, expiry).

## Policies / permissions
The view checks no roles — any authenticated Travels user does everything (EPAL.auth is not consumed in view.js). Laravel: gate the whole route group behind `company:travels` module access; recommend policy split viewer vs operator for destructive actions (delete/void/reconcile) but that is an addition, not current behaviour. Ticket delete requires confirm dialog only (view.js:570).

## Events (group-bridge; each maps to a `db.postSale` today)
- `air.ticket.issued` (per pax; amount=sale, cost=cost+commission) — view.js:377
- `air.ticket.reissued` (+add / +diff) — view.js:614 · `air.ticket.voided` (negative reversal) + `air.ticket.void_fee` — view.js:637-638
- `air.refund.paid` (negative reversal) + `air.refund.fee_retained` — view.js:1030-1034
- `air.emd.issued` (aggregate) — view.js:1181 · `air.pnr.ticketed` (TTL queue) — view.js:1351
Plus non-financial notifications (db.notify) on issue/void/reissue/refund/BSP import/reconcile/waive/TTL — map to Laravel Notifications.

## Engine dependencies → Laravel equivalents
- `EPAL.db.postSale('travels', …)` cross-company sale + Deep Core ledger auto-post → a `SalesLedgerService::post()` firing the events above; Group finance consumes them.
- `EPAL.serial.next('EMD')` + `EPAL.doc.numberFor('ticket')` → sequential number service (DB-backed, per-doc-type counters).
- `EPAL.doc.open()` invoice/receipt + `amountInWords` → PDF/print service (e.g. dompdf) with the exact columns/totals in view.js:385-410, 1197-1219.
- `EPAL.comments.widget('airTickets', id)` → polymorphic `comments` table (view.js:573-576).
- `db.notify` → Laravel notifications. `EPAL.charts` / `EPAL.table` are frontend-only. BSPlink "API" banner and "Sync now" are mock UI (view.js:727-729) — no real integration to build.
