# Master Accounts — Laravel Blueprint (Group)

The group-level accounting desk. Every section takes a `?company=` scope param
(the SPA's company-switcher buttons): `all` | `group` | a concern id.

## Sections → endpoints
| Section | Frontend | Backend |
|---|---|---|
| All Expenses | acc_entries kind=Expense (+GL mirror GL-MX-*) | `expenses` table · `GET/POST /group/expenses?company=` |
| Categories | `exp_categories` {name, subs[]} | `expense_categories` + `expense_sub_categories` (hasMany) |
| Budget Setup | `group_budgets` {companyId, category, period, amount, history[]} | `budgets` table + `budget_revisions` (the history log) |
| Expense Report | daily/weekly/monthly/custom GROUP BY buckets | `GET /group/expense-report?mode=&from=&to=&company=` |
| Manage Journals | EPAL.ledger.entries scoped | `journal_entries` with company scope + source filter + SUM |
| Payment Schedules | acc_schedules scoped (+partyType) | `payment_schedules` (+party_type_id FK) |
| Party Types | `party_types` | lookup table CRUD |
| Master Payroll | EPAL.payrollDesk(cid) | PayrollController with company param (same service as per-company) |
| Manage Banks | banks scoped + link to group banks desk | `bank_accounts` (type: bank/bkash/nagad/cashbox/card) |

## Rules
- An expense saved here posts DR expense-head / CR 1010 tagged with the CHOSEN
  company, so the consolidated P&L by concern stays truthful.
- Category rename cascades onto existing expenses (reports stay grouped).
- Budget saves append `{date, from, to}` to `history` when the amount changes.
- Deleting a category in use is blocked (deactivate/rename instead).
