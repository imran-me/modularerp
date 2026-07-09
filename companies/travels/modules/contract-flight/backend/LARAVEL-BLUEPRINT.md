# Contract Flight — Laravel backend blueprint

Source of truth: `companies/travels/modules/contract-flight/view.js` (line refs below) and
`module.json`. Domain: Epal Travels pre-buys blocks of charter/GSA seats and re-sells them
seat-by-seat; the whole block is paid up-front, so unsold seats = blocked capital with a hard
departure deadline (view.js:4-8).

## Purpose & screens (hash routes → sub-screens, module.json `menu`)
- `#/travels/contract-flight/schedule` (default, view.js:93-183) — KPI row (Total Seats, Seats
  Sold, Unsold, Blocked Capital = unsold × costSeat, Deadline Risk count), red deadline-risk
  alert list sorted by days-left, and the flight table (sell-through %, unsold, status). Row
  click opens a detail drawer (view.js:186-254) with block P&L, Sell Seats, Block Voucher
  (print), Mark Departed, Delete, and a comments thread.
- `#/travels/contract-flight/add-flight` (view.js:329-390) — form to contract a new seat block
  (carrier/route, schedule, block size, pricing); auto-opens on landing (view.js:340).
- `#/travels/contract-flight/category` (view.js:399-464) — seat inventory grouped by category,
  bar chart of unsold seats per category, category summary table with revenue and block P&L.
- `#/travels/contract-flight/manage-sales` (view.js:467-532) — ledger of every contract-seat
  sale (sales whose `ref` matches `/^CF/i`, view.js:469), sales KPIs, and per-flight
  profitability breakdown sorted worst-P&L first; CSV export on all tables.

## Entities & fields
**ContractFlight** — today localStorage store `tv_contract_flights` (record built view.js:373-382):
- `id` string PK, format `CF-001` (see serial rule) · `airline` string · `flightNo` string
- `origin` string (uppercased) · `destination` string (uppercased) · `route` string = `"ORG → DST"`
- `aircraft` string nullable · `category` enum [Umrah, Hajj, Tourist, Worker, Medical, Business, Student] (view.js:31)
- `depDate` date · `depTime` string · `arrTime` string
- `seats` int (total contracted) · `sold` int (default 0) · `class` enum [Economy, Premium Economy, Business]
- `vendor` string (contract vendor) · `costSeat` decimal · `saleSeat` decimal · `commission` decimal (%)
- `status` enum [Selling, Sold Out, Departed] · `created` date

**SeatSale** — today the SHARED `sales` store written via `db.postSale('travels', …)`
(view.js:284-288; shape from platform/data/database.js:545-552):
- `id` string (`SL-…`) · `companyId` = `travels` · `date` date · `amount` decimal (qty × salePrice)
- `cost` decimal (qty × costSeat) · `profit` decimal = amount − cost (computed on post)
- `ref` string = ContractFlight id (join key, view.js:56,286) · `desc` string
  `"Contract seats <route> (<qty>×)"` · `customer` string

Derived (never stored — compute in accessors/queries):
- `unsold = max(0, seats − sold)` (view.js:39); `daysLeft = depDate − today` in days (view.js:41-46)
- `revenue(flight) = Σ sales.amount where ref = flight.id` (view.js:53-59)
- `pnl(flight) = revenue − seats × costSeat` — cost counts EVERY seat, block is pre-bought (view.js:60-61)

## Business rules
1. Deadline risk: flight is "at risk" iff `unsold > 0 && status !== 'Departed' && daysLeft <= 15`
   (RISK_WINDOW, view.js:30,47-49). Drives KPI count, alert banners, red row styling.
2. Serial format: next id = `CF-` + zero-padded 3-digit max(numeric part of existing ids)+1
   (view.js:392-396). Laravel: DB-transactional sequence per module.
3. Add-flight validation: sale/seat must be ≥ cost/seat, else reject with "Sale price is below
   cost" (view.js:370). Required: airline, flightNo, origin, destination, depDate, category,
   totalSeats ≥ 1, vendor, costSeat ≥ 1, saleSeat ≥ 1. Origin/destination trimmed + uppercased;
   `route` composed server-side; `sold` starts 0; default status `Selling` (view.js:373-382).
4. Sell-seats validation (view.js:271-295): qty is re-checked against CURRENT unsold at save time
   (`qty ≥ 1` and `qty ≤ unsold`, view.js:276-277) — must be atomic (row lock) in Laravel.
   Sale price per seat defaults to `saleSeat` but is user-overridable (view.js:267).
5. Sell-seats side effects, in order: `sold += qty`; status auto-flow → `Sold Out` when
   `sold >= seats`, else back to `Selling` unless already `Departed` (view.js:279-281); post a
   Sale (amount = qty × price, cost = qty × costSeat, ref = flight id); emit a success
   notification (view.js:291-292). postSale also rolls amount/cost into the company's latest
   financials month and writes an audit-log line (database.js:554-566).
6. Status transitions: manual "Mark Departed" from drawer (view.js:240-241); no un-depart action.
7. Delete removes the flight record only — historical sales rows keep their `ref` and still show
   in the manage-sales ledger (view.js:242-244, 487-489 tolerates missing flight).
8. Revenue is ALWAYS the realized ledger sum, never `sold × saleSeat`, so P&L reconciles with
   finance even when sale price was overridden (comment view.js:50-52).
9. Manage-sales ledger filter: sales with `ref` matching `/^CF/i`, newest date first (view.js:469-470).

## Routes (RESTful, prefix `/api/travels/contract-flights`)
- `GET    /`                     index (+ `?category=&status=&q=` mirroring table filters/search)
- `POST   /`                     store (add-flight form)
- `GET    /{id}`                 show (drawer payload: flight + derived unsold/daysLeft/pnl/revenue)
- `DELETE /{id}`                 destroy
- `POST   /{id}/sell`            sell seats `{qty, customer, salePrice}`
- `POST   /{id}/depart`          mark departed
- `GET    /{id}/voucher`         block-voucher document (PDF), mirrors view.js:299-326
- `GET    /summary/schedule`     KPI block for schedule screen
- `GET    /summary/categories`   category rollup + unsold-by-category chart data
- `GET    /sales`                contract-seat sales ledger + KPIs + per-flight P&L breakdown

## Controllers
- `ContractFlightController` — `index`, `store` (returns created flight, 422 on margin/required
  failures), `show`, `destroy`, `scheduleSummary` (totals + risky list), `categorySummary`.
- `ContractSeatSaleController` — `store` (the sell action: locks flight row, validates qty,
  updates sold/status, creates Sale via LedgerService, fires event; returns updated flight +
  sale), `index` (ledger + KPIs + breakdown).
- `ContractFlightVoucherController` — `show` (renders voucher: parties = vendor/route blocks,
  seat/cost rows, totals = block cost / revenue booked / net P&L, terms text; view.js:302-325).

## Models & migrations
`ContractFlight` (table `contract_flights`):
- fillable: airline, flight_no, origin, destination, route, aircraft, category, dep_date,
  dep_time, arr_time, seats, sold, class, vendor, cost_seat, sale_seat, commission, status
- casts: dep_date:date, seats:int, sold:int, cost_seat:decimal:2, sale_seat:decimal:2,
  commission:decimal:2
- columns: id (string PK `CF-###`), airline, flight_no, origin(3), destination(3), route,
  aircraft nullable, category, dep_date date, dep_time nullable, arr_time nullable, seats int,
  sold int default 0, class default 'Economy', vendor, cost_seat decimal(12,2),
  sale_seat decimal(12,2), commission decimal(5,2) default 0, status default 'Selling',
  timestamps. Accessors: getUnsoldAttribute, getRevenueAttribute (sum of sales), getPnlAttribute.
- relation: `hasMany(Sale::class, 'ref', 'id')` — Sale is the group-wide sales table (shared
  model, NOT owned by this module; migration lives with the finance/ledger service).

## Policies / permissions
- Only permission gate in the code: delete button requires
  `EPAL.perm.can('travels','contract-flight','delete')` (view.js:233). Laravel:
  `ContractFlightPolicy@delete`. All other actions are open to any authenticated Travels user
  today — mirror with a module-access gate (`viewAny/create/update/sell` → travels module access).

## Events
- `ContractSeatsSold` (≙ `sale:recorded` + `data:changed` bus events, database.js:563-564) —
  payload: sale record + flight id. Group bridge consumes this for Travels + Group finance
  rollup ("group totals must match exactly").
- `ContractFlightDeparted`, `ContractFlightCreated`, `ContractFlightDeleted` — mirror
  `data:changed` store events for dashboards/notifications.
- Notification on sale: level success, "Contract seats sold", companyId travels (view.js:291-292).

## Engine dependencies → Laravel equivalents
- `EPAL.db.postSale/sales` (finance ledger + monthly financials rollup + audit log) →
  shared `LedgerService::postSale(company, dto)` in the platform kernel; single source for the
  sales table and financials month rollup (database.js:543-568).
- `EPAL.doc` (voucher printing, serial `EPAL.doc.numberFor('voucher')`, view.js:303) →
  `DocumentService` + PDF renderer with its own voucher serial sequence.
- `EPAL.comments.widget('contract-flight', id)` (view.js:248-251) → polymorphic
  `comments` table (`commentable_type = contract-flight`).
- `EPAL.perm` → Policy above. `db.notify` → Laravel Notification (database channel).
- `EPAL.charts` / `EPAL.table` CSV export are frontend-only; backend just supplies the
  aggregates above.
