# Reports — Laravel backend blueprint

A documentation-grade report centre for Epal Travels: a categorised catalogue
(Financial · Sales & CRM · People) where each report opens a rich preview (KPI
strip + data table with CSV + PDF export) and a print sheet. Source of truth for
the SPA screen: `companies/travels/modules/reports/view.js`. Travels-specific
override of the shared `*/reports` view. **Read-only** — every figure is pulled
live from the ledger, sales register, journal and HR stores.

## Catalogue (each = a ReportController method)
Financial: Monthly P&L (12M) · Trial Balance · Balance Sheet · AR Ageing ·
AP Ageing · Income Register · Expense Register.
Sales & CRM: Sales Register · Sales by Customer · Sales by Service Line · Agent
Commission · CRM Leads.
People: Team Roster · Attendance Sheet · Salary Sheet · Leave Register.

Adding a report = one entry in `REPORTS` with a `build()` returning
`{ kpis, columns, rows }`; preview + CSV/PDF/print come for free.

## Data sources (no own tables)
| report | source |
|--------|--------|
| P&L / Trial / Balance Sheet / Ageing | `LedgerService` (series, trialBalance, balanceSheet, aging) |
| Income / Expense Register | `acc_entries` grouped by head |
| Sales / by-Customer / by-Service | `sales` register (service classified from ref/desc) |
| Agent Commission | `tv_agents` (expected = sales × rate) |
| CRM Leads | `leads` |
| Roster / Attendance / Salary | `employees` (payslip derived) |
| Leave Register | `tv_leaves` |

## Routes (Laravel)
```
GET /travels/reports                 -> catalogue
GET /travels/reports/{id}            -> preview (dataset JSON → Blade table)
GET /travels/reports/{id}/export.csv -> CSV
GET /travels/reports/{id}/export.pdf -> branded PDF (DocumentService)
```

## Controllers
- `ReportController@index` — the catalogue.
- `ReportController@show($id)` — dispatch to the per-report builder → dataset.
- `ReportController@export($id, $format)` — CSV / PDF via the DocumentService.

## Policies / permissions
- `reports.view` (Travels managers/accountants/owner). Read-only.
  Mirrors `EPAL.auth.can('travels','reports')`.

## Events (group bridge)
- None — Reports is a read model over existing stores/services.

## Engine dependencies
- Ledger (financial figures) · Documents (branded PDF) · the HR/CRM/Sales stores.
