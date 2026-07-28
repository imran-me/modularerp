# Woodart · Accounts — API contract

**Version 1 · frozen 2026-07-28 · CONTRACT FIRST, screens next**

> Written before the module, on purpose. `MODULE-STANDARD.md` §4: the frontend is
> built against a frozen API surface **before any PHP exists**, so neither side
> waits for the other and neither can change a shape unilaterally.
>
> The data this desk reads is already seeded — `WoodartMoneySeeder` landed first
> precisely so there is something real to build against.

- **Base path:** `/api/woodart/accounts` · **Auth:** Sanctum (central)
- **Company scope:** `company_id = 'woodart'` (numeric id `6` in `banks`)
- **Money:** integer Taka, never a float (D10)

---

## What this desk owns, and what it borrows

It owns **no new table**. That is the important design fact.

| Data | Table | Owned by |
|---|---|---|
| Income & expense register | `acc_entries` | Master Accounts (shared, company-scoped) |
| Bank / cash accounts | `banks` | Master Accounts |
| The double-entry postings | `journal_entries` | Master Accounts (`LedgerService`) |
| Purchase orders it settles | `wa_purchases` | Procurement |
| Projects it reports P&L on | `wa_projects` | Projects |

Woodart Accounts is a **desk over shared books**, exactly as Travels Accounts is.
Building it a private ledger would fork the group's accounting, which is the one
thing the bridge architecture exists to prevent.

---

## Screens → endpoints

### `GET /register`
The income and expense register, newest first — what Travels Accounts calls its
Income/Expenses tabs, scoped to Woodart.

```json
200 → { "success": true, "provisioned": true, "count": 21,
        "summary": { "income": 12655000, "expense": 2268500, "net": 10386500,
                     "unpaidVendors": 3, "outstanding": 1152000 },
        "data": [ { "id":"JV-WA108", "kind":"Income", "category":"Project Billing",
                    "description":"Stage 2 — Square Pharmaceuticals (WAP-102)",
                    "amount":3600000, "method":"Bank", "date":"2026-06-18",
                    "ref":"WAP-102", "party":"", "fundedBy":null } ] }
```

### `POST /register`
Record an income or expense. **Posts three things in one transaction**, the way
`ExpensePostingService` already does for Travels:

1. the register row (`acc_entries`),
2. the GL mirror (`DR <head> / CR <cash|bank>` for an expense; reverse for income),
3. the paying account's balance **and** a row in its transaction history.

```json
Body → { id?, kind*, category*, description, amount*, method*, date*,
         ref?, bankId?, fundedBy? }
200  → { "success": true, "data": { …entry… }, "journal": "GL-WA-…" }
422  → validation
503  → tables not migrated
```

### `DELETE /register/{id}`
Voids an entry: posts a **reversal** journal and a reversing bank row. Never a
silent delete — a balance never moves without a row explaining why (AUDIT P2).

### `GET /payables`
What Woodart owes vendors — the `2000 Accounts Payable` balance Procurement's
goods receipts raise, broken down by vendor and PO.

```json
200 → { "success": true,
        "summary": { "outstanding": 1152000, "vendors": 3, "oldestDays": 41 },
        "data": [ { "vendor":"Akij Board", "po":"WPO-002", "ordered":186000,
                    "paid":186000, "due":0, "terms":"Net 30", "days":41 } ] }
```

### `POST /payables/{po}/pay`
Settle a purchase order. `DR 2000 / CR 1000|1010` through the payment-source
picker, plus the register row and the bank movement.

```json
Body → { amount*, bankId*, date*, note? }
200  → { "success": true, "data": { …entry… }, "remaining": 0 }
```

### `GET /project-pnl`
**The reason this desk is not a copy of Travels.** Contract value vs committed
cost vs the **BOQ budget** — a comparison no other company can make, because no
other company has a bill of quantities.

```json
200 → { "success": true, "data": [
  { "project":"WAP-102", "name":"Office Fit-out · Square Pharma HQ",
    "client":"Square Pharmaceuticals", "stage":"Production",
    "value":9200000, "cost":5980000, "margin":3220000, "marginPct":35,
    "budget":2613300, "budgetSale":3641600,
    "billed":3600000, "spent":186000,
    "materialIssued":412000, "variance":-98700 } ] }
```

- `budget` / `budgetSale` come from the project's approved BOQ (`wa_estimates.lines`).
- `materialIssued` is the real cost of stock issued to it, from `wa_movements`
  × `unit_cost` — which is why the stock ledger had to exist first.
- `variance` is `budget − materialIssued`: **negative means the job is eating
  more material than it was quoted for**, and that is the single number this
  whole module exists to surface.

---

## Invariants

1. **No private ledger.** Every posting goes through the kernel
   `LedgerService`/`ExpensePostingService`. A Woodart-only posting path would
   fork the group's books.
2. **Three books move together or none do** — register, GL, bank balance + its
   row — in one transaction, as `ExpensePostingService::record()` already does.
3. **Voids reverse, never delete** (AUDIT P2).
4. **Paying a vendor settles a REAL purchase order** for an amount that does not
   exceed it. The seed already holds three payments that match their PO to the
   rupee; the endpoint must keep that true.
5. **Project P&L reads the BOQ, not a stored budget.** A budget column would
   drift from the estimate it came from.
6. **Material cost comes from the movement ledger**, not from a guess. This is
   the dependency that made stock movements a prerequisite rather than a
   nice-to-have.
7. **`Schema::hasTable`-guarded**, and `provisioned` reported, like every other
   Woodart endpoint.

## Change log

| Version | Date | Change |
|---|---|---|
| 1 | 2026-07-28 | Contract frozen ahead of the build. |
