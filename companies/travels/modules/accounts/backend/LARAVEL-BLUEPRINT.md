# Accounts — Laravel backend blueprint

The money desk of Epal Travels: the day-to-day income/expense **journal**, a
double-entry **journal poster** into the shared general ledger, and the
payable/receivable **payment-schedule** tracker. Source of truth for the SPA
screen: `companies/travels/modules/accounts/view.js`. This is a Travels-specific
override of the shared `*/accounts` view (router prefers a specific view).

## Purpose & screens
- **Overview** (`/accounts`, default) — cockpit: Income / Expense / Net / Cash &
  Bank / Open-Schedules / Overdue KPIs, an **Action Center** (overdue + due-soon
  schedules, biggest expense head, low-cash), monthly Income-vs-Expense trend,
  expense-by-head & payment-method mix, and the recent-entries register.
  view.js `overview`.
- **Income** (`/income`) / **Expenses** (`/expenses`) — kind-scoped register with
  KPIs + tap-to-filter head chips + rich detail. view.js `kindRegister`.
- **Journals** (`/journals`) — post a BALANCED double-entry journal straight into
  the GL + recent ledger entries. view.js `journalsView`.
- **Schedules** (`/schedules`) — payable/receivable tracker with ageing, mark-paid,
  reminders (WhatsApp/Gmail). view.js `schedulesView`.

## Entities & fields
`AccountEntry` (today: store `acc_entries`, key `epal.v1.acc_entries`):
| field | type | notes |
|-------|------|-------|
| id | string PK | `JV-XXXXXX` today → bigint/uuid |
| company_id | string | always `travels` (bridge attribution) |
| kind | enum | Income · Expense |
| category | string | posting head (free text; common heads offered on form) |
| amount | int (BDT) | integer taka, no cents |
| method | enum | Bank · Cash · bKash · Nagad · Card · Cheque |
| date | date | YYYY-MM-DD |
| party | string? | customer / vendor / staff (optional) |
| ref | string? | voucher / cheque / invoice ref (optional) |
| desc | string? | narration |
| created | date | posting date |

`PaymentSchedule` (today: store `acc_schedules`, key `epal.v1.acc_schedules`):
| field | type | notes |
|-------|------|-------|
| id | string PK | `SCH-XXXXX` |
| company_id | string | `travels` |
| party | string | counterparty |
| kind | enum | Payable · Receivable |
| amount | int (BDT) | |
| due | date | due date (drives ageing) |
| status | enum | Pending · Partial · Paid |
| phone / email | string? | for reminders |
| desc | string? | note |

Derived (not stored): schedule ageing bucket from `due` vs today; per-head /
per-method aggregates; monthly income/expense series.

## Business rules
- Every quick `AccountEntry` **mirrors into the double-entry ledger** with a stable
  GL id `GL-ACC-<id>` (an edit re-posts/upserts, never duplicates):
  - Income  → DR `1010 Bank` / CR `4000 Sales Revenue`.
  - Expense → DR `5xxx` (by head via `expenseAccountFor`) / CR `1010 Bank`.
- **Cash & Bank** KPI reads ledger account `1010` balance (asset, Dr − Cr).
- Journals must balance (`|Σdr − Σcr| ≤ 0.5` and Σdr > 0) before posting — the
  LedgerService enforces the same invariant server-side.
- A schedule marked **Paid** is settled; overdue = `due < today` and not Paid.

## Routes (Laravel)
```
GET    /travels/accounts                 -> overview (KPIs + cockpit + register)
GET    /travels/accounts/income          -> income register
GET    /travels/accounts/expenses        -> expense register
GET    /travels/accounts/journals        -> journal poster + recent GL
POST   /travels/accounts/journals        -> post balanced journal (LedgerService)
GET    /travels/accounts/schedules       -> schedule tracker
POST   /travels/accounts/entries         -> store quick entry (+ mirror to GL)
PUT    /travels/accounts/entries/{entry} -> update (re-post GL)
DELETE /travels/accounts/entries/{entry} -> destroy (+ remove GL mirror)
POST   /travels/accounts/schedules       -> store schedule
PUT    /travels/accounts/schedules/{s}   -> update / mark paid
```

## Controllers
- `AccountEntryController@index` — kind-scoped, paginated entries + aggregates
  (Σincome, Σexpense, net, per-head, per-method, monthly series).
- `AccountEntryController@store/@update/@destroy` — validated (amount > 0, kind,
  method, date); each write calls `LedgerService::mirror($entry)`.
- `JournalController@store` — validated balanced lines → `LedgerService::post()`.
- `PaymentScheduleController@index/@store/@update` — ageing buckets, mark-paid.

## Models & migrations
- `AccountEntry` (fillable: company_id, kind, category, amount, method, date,
  party, ref, desc; casts amount int, date date). `mirror()` observer posts to GL.
- `PaymentSchedule` (fillable: company_id, party, kind, amount, due, status,
  phone, email, desc; casts amount int, due date). Accessor `ageing`, scope `open()`.
- migrations `account_entries`, `payment_schedules` (+ `company_id` index).

## Policies / permissions
- `accounts.view` (Travels accountants+), `accounts.create` / `accounts.delete`
  (accountant/manager/owner). Mirrors `EPAL.perm.can('travels','accounts',...)`.

## Events (group bridge)
- Recording income can emit `payment.received` and expenses `expense.recorded`
  per `companies/travels/bridge.map` so Group cash/expense roll up. Real finance
  impact flows through the LedgerService mirror (double-entry), not the bridge.

## Engine dependencies
- Ledger (double-entry post + trial balance + account balances) · Serial (voucher
  numbering) · Documents (branded receipt/payment voucher PDF) · Audit (entry &
  journal trail) · Comments (per-entry / per-schedule notes). Laravel: shared Services.
