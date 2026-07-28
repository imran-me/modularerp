# Woodart · Accounts — Laravel blueprint

How the backend is assembled, and why each piece is where it is. The frozen API
surface is `endpoints.md`; this is the implementation behind it.

## Namespace & discovery

```
Epal\Modules\Woodart\Accounts\…
```

Auto-resolved by `platform/backend/app/Providers/ModuleServiceProvider`, which
scans `companies/*/modules/*/backend/` and loads each `routes.php` under the
shared `/api` group (Sanctum applied there). Delete this folder and the routes
are never registered — that is the whole drop-in / drop-out mechanism.

## Files

| File | Job |
|---|---|
| `AccountsController.php` | validate → delegate → shape. Nothing else. |
| `Services/AccountsService.php` | **reads**: register, payables, project P&L |
| `Services/EntryPostingService.php` | **writes**: routes money to the kernel |
| `Models/AccEntry.php` | local read model over the SHARED `acc_entries` |
| `Http/Requests/StoreEntryRequest.php` | shape of a register entry |
| `Http/Requests/PayVendorRequest.php` | shape of a settlement |
| `Http/Resources/EntryResource.php` | the frontend `acc_entries` record |
| `Database/Seeders/WoodartMoneySeeder.php` | 21 entries + the BRAC Bank account |

**No `migrations/` directory.** This module creates nothing.

## The chart of accounts it touches

| Code | Account | When |
|---|---|---|
| `1000` / `1010` | Cash / Bank | the account money moved through |
| `1200` | Accounts Receivable | income recorded unpaid |
| `1400` | Inventory | raised by Procurement's goods receipt, not here |
| `2000` | Accounts Payable | cleared when an order is settled |
| `2130` | VAT Payable | **not used yet** — Woodart bills VAT-exclusive |
| `4000` | Revenue | income, by category |
| `5000` | Cost of Sales | posted at material issue, not at billing |

## The two write paths

```
POST /register  kind=Expense ──> ExpensePostingService::record()
                                   ├── acc_entries row
                                   ├── GL: DR <head> / CR 1000|1010
                                   └── bank balance + movement row

POST /register  kind=Income  ──> DB::transaction:
                                   ├── SalePostingService::record()
                                   │     └── GL: DR 1010|1000|1200 / CR 4000
                                   └── acc_entries row (written HERE)
```

`SalePostingService` does not touch `acc_entries` — that table is the
expense-shaped register, and the sale services were built for modules keeping
their own sales ledger. Woodart shows income in the same register, so the row is
written here and both halves share one transaction.

⚠️ **Do not "simplify" income onto `ExpensePostingService`.** It is the one that
writes the register row, which makes it look like the tidier choice. It would
post revenue as a debit to an expense head and invert the P&L.

## Refusals

`LedgerException` → **422**, never a 500. The kernel throws it for an unknown
account code, an account belonging to another concern, or a receipt larger than
the debt. `AccountsController` catches it on every write and returns the
message, because the caller did something the books do not allow and needs to
know which thing.

`AccountsService::provisioned()` reports whether the shared `acc_entries` table
exists on this host. Reads degrade to an honest empty response; writes return
**503** rather than half-posting.

## Seeding

```bash
php artisan db:seed --force \
  --class="Epal\Modules\Woodart\Accounts\Database\Seeders\WoodartMoneySeeder"
```

⚠️ It writes into the **live, shared** `acc_entries` and `banks`. On a host whose
database also holds a copy of another system (see `CONTEXT.md` §11), check for
`ext_id` collisions on `JV-WA%` first. It is `updateOrInsert`-keyed, so a
collision would overwrite a real row rather than fail.

Expected after seeding: 21 entries, income ৳1,62,85,000, expense ৳23,18,200.
