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
| method | enum | Bank · Cash · bKash · Nagad · Card · Cheque (HOW it was paid) |
| bank_id | string? | WHICH account it left — a `banks` row; null for an unregistered method (cheque, card swipe) |
| bank_name | string? | captured at posting time, so a later rename doesn't rewrite old vouchers |
| pay_acct | string? | the GL side credited: `1000` hard cash · `1010` bank — pinned per entry |
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
  - Expense → DR `5xxx` (the head the form pinned, else `expenseAccountFor`) /
    CR `pay_acct` — `1000` when the money left a cash box, else `1010`.
- An entry that named a real account also **moves that account's register**:
  balance down + a withdrawal row in `bank_transactions` tagged with the voucher
  (`entry_ref`). Editing the amount posts an adjustment row and deleting posts a
  reversal row — a balance never changes without a row saying why. That is what
  keeps Manage Banks reconciled with the trial balance.
- **Cash & Bank** KPI reads ledger account `1010` balance (asset, Dr − Cr).
- Journals must balance (`|Σdr − Σcr| ≤ 0.5` and Σdr > 0) before posting — the
  LedgerService enforces the same invariant server-side.
- A schedule marked **Paid** is settled; overdue = `due < today` and not Paid.

## BUILT — Record Expense (owner 2026-07-26) · the one call that hits every book

Not a blueprint any more: this endpoint exists. `POST /api/travels/accounts/expenses`
records a spend in **three books inside one transaction**, and nothing else has to
be remembered afterwards.

| # | Book | Table(s) | What lands there |
|---|------|----------|------------------|
| 1 | the concern's register | `acc_entries` | the voucher — the row the Expenses screen lists |
| 2 | the general ledger | `journal_entries` + `journal_items` | the double entry every report READS (journals, account ledgers, trial balance, P&L, group consolidation) |
| 3 | the paying account | `banks` + `bank_transactions` | balance down + one withdrawal row in that account's own history |

**The double entry**

```
paid from our own account       DR <head e.g. 5550>   /  CR 1010 Bank | 1000 Cash
paid from ANOTHER concern       us:     DR <head>     /  CR 2400 Inter-company Payable
  (inter-company funding)       funder: DR 1300 Rcv   /  CR 1010|1000  (THEIR account moves)
```

Consolidation eliminates 1300 against 2400, so the group P&L carries the expense
once and the cash is never double-counted. The debt is settled later with the
reverse legs.

**Files** (posting rules in the kernel, HTTP surface in the module — a company
module never reaches into another company's code):

| File | Role |
|------|------|
| `platform/backend/app/Services/ExpensePostingService.php` | `record()` / `void()` — the three books, one transaction |
| `platform/backend/app/Services/LedgerService.php` | `post()` / `reverse()` / `expenseAccountFor()` — THE ledger; balance check, code→id, idempotent upsert |
| `platform/backend/app/Services/BankRegisterService.php` | `apply()` / `reverseFor()` — balance + `bank_transactions`, the server twin of the SPA's `bankTxnApply()` |
| `platform/backend/app/Support/CompanySlugs.php` | the one slug ↔ `companies.id` map |
| `…/accounts/backend/ExpenseController.php` | the routes below |
| `…/accounts/backend/Http/Requests/StoreExpenseRequest.php` | validation, field for field with the SPA form |
| `platform/backend/tests/Feature/ExpensePostingTest.php` | 9 tests: all three books, cash box → 1000, inter-company legs, wrong-owner refusal, unknown head, re-post idempotency, void reverses everything |

```
GET    /api/travels/accounts/expenses            expense register (filters: from, to, head)
GET    /api/travels/accounts/expenses/form       heads (expense codes FIRST) + payment
                                                 accounts (Travels' first, bank → cash → wallet)
POST   /api/travels/accounts/expenses            record one — see the example below
DELETE /api/travels/accounts/expenses/{voucher}  void: register row removed, ledger
                                                 REVERSED (never erased), account refunded
```

```jsonc
// POST /api/travels/accounts/expenses   — "tea for a guest, paid from City Bank"
{ "amount": 1250, "head": "5550", "category": "Guest & Entertainment",
  "subCategory": "Tea / Coffee (Guest)", "bankId": "12", "method": "Bank",
  "party": "Star Kabab", "date": "2026-07-26", "ref": "BR-118" }
// -> 201 { success:true, data:{ entry, journal, funderJournal, register } }
// add  "fundedBy": "group"  and it becomes an inter-company loan instead
```

Refusals come back as `422 { success:false, message }` — unbalanced, unknown
account code, an account belonging to another concern, a zero amount.

**The bank movement LOG is self-healing.** `bank_transactions` is created by a
migration, not at request time (shared hosting denies DDL). `BankTxnController@index`
reports `provisioned: true|false` and `platform/data/api.js` only promotes `bank_txns`
into its WRITABLE set when that is true — so the log persists **the moment you run
`php artisan migrate`**, with no redeploy, and an un-migrated host degrades to
read-only (with a `console.warn`) instead of looping on failed writes.

**Migrations to run:** `php artisan migrate`
(`…master-accounts/backend/migrations/2026_07_26_002000_add_payment_source_to_acc_entries.php`,
`platform/backend/database/migrations/2026_07_26_003000_add_entry_trail_to_bank_transactions.php`.)

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
