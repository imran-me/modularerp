# Consolidated Finance (Group Cockpit) — Laravel backend blueprint

Source of truth: `companies/group-cockpit/modules/finance/view.js` (route `#/group/finance`, view key `group/finance`, view.js:136) + `module.json`. Read-mostly module: the only writes are AR/AP schedule maintenance, bank-account maintenance, manual journal posting and inter-company posting (view.js:20-22).

## Purpose & screens
Eleven sub-screens branch on `ctx.subId` (view.js:136-151); pill tabs at view.js:35-41.
- **Overview** (no sub) — 12M consolidated KPIs (revenue/expense/profit/margin/cash/AR/AP), group trend chart, per-company P&L table drilling to `{companyId}/accounts` (view.js:156-248). AR/AP KPIs prefer ledger aging totals, fall back to `acc_schedules` sums (view.js:165-171).
- **pnl** — monthly group P&L statement + Month×Company revenue matrix + CSV export (view.js:253-325).
- **cashflow** — net movement per month (= profit series), cumulative curve, cash ledger table, CSV (view.js:330-393). Inflow=revenue, outflow=expense (view.js:335-336).
- **balance-sheet** — ledger-derived when `EPAL.ledger.balanceSheet` exists (view.js:399, 1283-1358); else management view: assets = bank balances + open receivables; liabilities = open payables; equity = assets − liabilities (derived balancing figure, view.js:400-405).
- **receivables / payables** — aging desks. Ledger mode: by-party aging from AR/AP subledger with party statement drawer (view.js:1361-1426). Fallback mode: `acc_schedules` CRUD with aging buckets, mark-collected/settled, delete (view.js:499-622).
- **banks** — group bank accounts CRUD, masked account numbers (last 4 shown, view.js:686), balance doughnut, cash-by-concern breakdown (view.js:627-745).
- **coa** — chart of accounts grouped by 5 classes with live balances; row opens running account ledger modal (view.js:790-839).
- **journal** — all posted double-entry journals; entry drawer shows dr/cr lines + comments widget on `gl_entries` (view.js:843-929); "New Journal" modal (view.js:930-977).
- **trial-balance** — consolidated TB with balance check (|Dr−Cr| < 1, view.js:984) + per-company net-balance comparison (view.js:1028-1063).
- **consolidation** — group TB with inter-company eliminations on control accounts 1300/2400, IC posting form, branded consolidated statement document (view.js:1082-1280).

## Entities & fields
Today's localStorage stores (namespace `epal.v1.`) → Laravel tables:
1. **Schedule** (`acc_schedules`, view.js:89-95, 598-621): `id` string `SCH-<6 digits of Date.now()>` (view.js:614), `kind` enum Receivable|Payable, `party` string, `companyId` string, `amount` decimal, `due` date (ISO yyyy-mm-dd), `ref` string nullable (invoice ref), `status` enum Pending|Partial|Paid (default Pending), `created` date. Derived (not stored): `days` overdue, `bucket` (view.js:100-107).
2. **BankAccount** (`banks`, view.js:96-98, 722-744): `id` string `BNK-<5 digits>` (view.js:735), `name` string, `branch` string, `account` string 6–18 digits (regex `^\d{6,18}$`, view.js:728), `companyId` string (any company incl. group), `balance` decimal ≥ 0, `created` date.
3. **LedgerAccount** (via `EPAL.ledger.accounts()`, view.js:791, 810): `code` string (e.g. 1300, 2400), `name`, `type` enum asset|liability|equity|income|expense (view.js:786-789), `group` string nullable, `normal` enum debit|credit. Balance computed, never stored (view.js:810).
4. **JournalEntry** (`gl_entries` store per comments hook, view.js:925; read via `LED().entries()`, view.js:844): `id`, `date`, `companyId`, `source` enum manual|sale|payroll|refund|opening|adjustment|intercompany (view.js:875, 950-951, 1103), `ref` nullable, `memo` nullable, `party` nullable, `lines[]`.
5. **JournalLine** (embedded array today): `account` (code), `dr` decimal, `cr` decimal (view.js:963-964).
Read-only aggregates consumed: `db.series(companyId)` (12M labels/revenue/expense/profit), `db.finance(companyId,12)`, `db.months(12)`, `db.groupSnapshot()`, `db.momRevenue(companyId)` — in Laravel these become query/report services over journal + sales data, not tables.

## Business rules
- Aging bucket vs today from `due`: Paid→Settled; days≤0→Current; ≤30→1–30d; ≤60→31–60d; else 60+d (view.js:100-107). Ledger aging uses keys current/d30/d60/d90 (view.js:1368).
- Settlement is one-way: action sets `status='Paid'`, fires a notification + audit log line, no partial-amount handling (view.js:569-578); "Already settled" guard (view.js:564).
- Journal must balance: only lines with an account and a nonzero dr/cr are kept; minimum 2 lines (view.js:963-965); UI live-checks |Dr−Cr| < 0.5 (view.js:937); `ledger.post()` throws if unbalanced — surface as 422 (view.js:966-973).
- Posting permission: `EPAL.perm.can('group','finance','create')` gates New Journal and IC posting (view.js:31, 932, 1114, 1196).
- Inter-company: seller books 1300 IC Receivable + revenue, buyer books expense + 2400 IC Payable, same ref both legs; seller ≠ buyer (view.js:1207); eliminations = gross/2 (each pair counted twice, view.js:1101); IC rows net to zero in the Group column (view.js:1145); distinct IC transactions counted by distinct `ref` of `source='intercompany'` entries (view.js:1103-1105).
- Trial balance considered balanced when |ΣDr − ΣCr| < 1 (view.js:984); balance-sheet check Assets = Liabilities + Equity (view.js:1309-1310).
- Cashflow "net movement" is exactly the profit series; cumulative is its running total (view.js:333-337).
- Bank account number stored raw, always rendered masked `•••• last4` (view.js:685-687); bank add/edit writes an audit log line with actor name (view.js:738-739).
- Only active companies (`type==='company' && enabled`) participate in per-company breakdowns (view.js:44-46).

## Routes
```
GET    /group/finance                    overview (kpis + trend + per-company pnl)
GET    /group/finance/pnl                monthly statement + revenue matrix   (+ ?export=csv)
GET    /group/finance/cashflow           monthly cash ledger                  (+ ?export=csv)
GET    /group/finance/balance-sheet      ledger BS (or derived management BS) (+ ?export=csv)
GET    /group/finance/receivables        AR aging          GET /group/finance/payables  AP aging
POST   /group/finance/schedules          create schedule   PUT /group/finance/schedules/{id}
POST   /group/finance/schedules/{id}/settle              DELETE /group/finance/schedules/{id}
GET    /group/finance/banks              bank positions
POST   /group/finance/banks              PUT /group/finance/banks/{id}   DELETE /group/finance/banks/{id}
GET    /group/finance/coa                accounts by class + balances
GET    /group/finance/coa/{code}/ledger  running account ledger (modal today, view.js:831)
GET    /group/finance/journal            entries + filters (companyId, source)
POST   /group/finance/journal            post manual journal
GET    /group/finance/journal/{id}       entry with lines
GET    /group/finance/parties/{party}/statement   AR/AP party ledger (view.js:1418)
GET    /group/finance/trial-balance      consolidated + per-company TB (+ ?export=csv)
GET    /group/finance/consolidation      eliminated group TB (+ ?export=csv, ?doc=1 statement)
POST   /group/finance/intercompany      post IC pair {from,to,amount,memo}
```

## Controllers
- **FinanceOverviewController@index** — 12M finance rollup, group snapshot, bank total, AR/AP totals (ledger aging preferred), per-company rows with MoM.
- **PnlController@index/@export** — series(null) + months(12) + per-company series; CSV mirrors exportPnlCsv (view.js:113-131).
- **CashflowController@index/@export** — rows {month, inflow, outflow, net, cumulative}.
- **BalanceSheetController@show/@export** — ledger.balanceSheet() sections or fallback derivation.
- **ScheduleController@index (kind param) /@store /@update /@settle /@destroy** — settle sets status Paid + notification + audit log.
- **BankAccountController@index/@store/@update/@destroy** — validates account regex; audit log on save.
- **CoaController@index**, **AccountLedgerController@show(code)** — accounts + computed balances / running ledger rows {date, ref, memo, debit, credit, balance} (view.js:764-783).
- **JournalController@index/@store/@show** — store validates ≥2 lines, balanced; returns created entry id.
- **TrialBalanceController@index/@export**, **ConsolidationController@index/@export/@statement**, **IntercompanyController@store** (returns generated `ref`).
- **PartyStatementController@show(party)**.

## Models & migrations
- `Schedule` — fillable: kind, party, company_id, amount, due, ref, status; casts: amount decimal:2, due date. Migration: id (string SCH-… or ULID + display ref), kind enum, party, company_id index, amount decimal(14,2), due date, ref nullable, status enum default 'Pending', created date, timestamps.
- `BankAccount` — fillable: name, branch, account_number, company_id, balance; casts: balance decimal:2. Migration: id (BNK-…), name, branch, account_number string(18), company_id index, balance decimal(14,2), created date, timestamps. Encrypt/mask account_number in API resources.
- `LedgerAccount` — fillable: code (unique), name, type enum(5), group nullable, normal enum(debit,credit).
- `JournalEntry` — fillable: date, company_id, source, ref, memo, party; casts: date date. hasMany JournalLine.
- `JournalLine` — fillable: journal_entry_id, account_code FK→ledger_accounts.code, dr decimal(14,2) default 0, cr decimal(14,2) default 0. DB check/observer: per-entry ΣDr = ΣCr.

## Policies / permissions
Mirror `EPAL.perm.can('group','finance', action)` (view.js:31): `FinancePolicy` with `view` (all screens), `create` (journal posting + inter-company, enforced at view.js:932/1196; also gate schedule/bank writes as `create/update/delete`). Missing permission → 403 with same message semantics ("You do not have permission to post journals").

## Events
- `ScheduleSettled(schedule)` — on settle; today fires `db.notify` + `db.log` (view.js:573-576).
- `BankAccountSaved / BankAccountRemoved` — audit log parity (view.js:738-739, 703).
- `JournalPosted(entry)` — on manual/IC posting (view.js:967, 1209). No sale/money-creation events originate here: sales are recorded by operating modules (view.js:21-22); this module only consumes them for consolidation.
- `IntercompanyPosted(from, to, amount, ref)` — feeds elimination reporting.

## Engine dependencies
- **EPAL.ledger** (Deep Core double-entry GL) — accounts(), balance(), entries(), post(), ledgerFor(), trialBalance(companyId?), consolidatedTrialBalance(), balanceSheet(), aging('AR'|'AP'), partyLedger(), postIntercompany() → Laravel `LedgerService` + report query classes. All ledger screens must degrade gracefully when absent (view.js:750-754 fallbacks).
- **EPAL.db** stores `acc_schedules`, `banks` + aggregates series/finance/groupSnapshot/momRevenue/months → Eloquent + `GroupReportingService`.
- **EPAL.db.log / db.notify** → audit-log service (spatie/laravel-activitylog) + notifications.
- **EPAL.comments** on `gl_entries` (view.js:923-926) → polymorphic comments on JournalEntry.
- **EPAL.doc** branded voucher for consolidated statement (view.js:1252-1277) → PDF document service.
- **EPAL.auth.current().name** as actor on logs (view.js:575, 738) → `auth()->user()->name`.
