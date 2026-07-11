# Ledgers — Laravel backend blueprint

The double-entry books of Epal Travels, read straight off the shared LedgerService:
a financial-snapshot cockpit plus General Ledger, Trial Balance, Party subledgers,
AR/AP ageing, Balance Sheet and P&L — every table drillable, every statement a
branded PDF. Source of truth for the SPA screen:
`companies/travels/modules/ledgers/view.js`. Travels-specific override of the
shared `*/ledgers` view. **Read-only** over the ledger — postings originate in
Accounts / Air-Ticketing / Visa / CRM.

## Purpose & screens (tabs via `?tab=`)
- **Overview** — Revenue/Net/Cash/AR/AP/Assets KPIs, an Action Center (unbalanced
  trial or balance sheet, worst overdue AR/AP), an income-statement snapshot and
  an assets-vs-claims doughnut.
- **General Ledger** — account picker → running balance; row → journal entry.
- **Trial Balance** — type chips; row → that account's ledger; print.
- **Party Ledger** — party list; row → Statement of Account (modal + PDF).
- **AR / AP Ageing** — FIFO buckets; row → party statement; print.
- **Balance Sheet** / **P&L** — sectioned statements + branded PDF.

## Data source — the LedgerService (no own tables)
Reads the shared `gl_entries` + `coa`. Key calls mirrored from `EPAL.ledger`:
| SPA call | Laravel service method | returns |
|----------|------------------------|---------|
| `accounts()` / `account(code)` | `LedgerService::accounts()` | COA rows |
| `entries({companyId,...})` | `::entries($filters)` | GL entries |
| `balance(code,{companyId})` | `::balance($code,$co)` | signed balance |
| `trialBalance(co)` | `::trialBalance($co)` | `[{code,name,type,debit,credit}]` |
| `ledgerFor(code,{co})` | `::ledgerFor($code,$co)` | running `[{date,ref,memo,party,debit,credit,balance}]` |
| `partyLedger(party,{co})` | `::partyLedger($party,$co)` | running party rows |
| `aging('AR'|'AP',{co})` | `::aging($kind,$co)` | `[{party,current,d30,d60,d90,total}]` |
| `pnl(co)` | `::pnl($co)` | `{revenue,cogs,gross,expenses,net,lines[]}` |
| `balanceSheet(co)` | `::balanceSheet($co)` | `{assets[],liabilities[],equity[],totals{}}` |

## Business rules
- Trial balance and balance sheet must balance (Σdr = Σcr; A = L + E); the cockpit
  raises an Action-Center alert when they do not.
- Ageing is FIFO over open invoices against 2026-07-05 (current/1-30/31-60/60+).
- Cash & Bank = balance(1000) + balance(1010).

## Routes (Laravel)
```
GET /travels/ledgers?tab=overview   -> financial snapshot
GET /travels/ledgers?tab=general&code=1010 -> account ledger
GET /travels/ledgers?tab=trial      -> trial balance
GET /travels/ledgers?tab=party&party=... -> party statement
GET /travels/ledgers?tab=ar|ap      -> ageing
GET /travels/ledgers?tab=bs|pnl     -> balance sheet / P&L
GET /travels/ledgers/{doc}/pdf      -> branded statement (DocumentService)
```

## Controllers
- `LedgerController@overview|general|trial|party|aging|balanceSheet|pnl` — each
  reads the LedgerService and renders a Blade tab.
- `StatementController@pdf` — trial / account / party / ageing / BS / P&L PDFs.

## Policies / permissions
- `ledgers.view` (Travels accountants/managers/owner). Read-only — no create/delete.
  Mirrors `EPAL.auth.can('travels','ledgers')`.

## Events (group bridge)
- None emitted — Ledgers is a read model. It consumes what Accounts/Sales/Payroll
  post through the LedgerService.

## Engine dependencies
- Ledger (all figures) · Documents (branded statement PDFs). Laravel: LedgerService
  + DocumentService.
