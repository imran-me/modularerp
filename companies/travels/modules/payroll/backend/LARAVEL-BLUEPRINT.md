# Payroll — Laravel Blueprint (Travels)

Dedicated payroll desk. The frontend view (`view.js`) is thin — all logic lives in
the shared **payroll engine** (`platform/engines-library/payroll.js` → `EPAL.payroll`).
On the backend this becomes a `PayrollService` + `PayrollController`.

## Tabs → endpoints
| Tab | Frontend | Backend |
|---|---|---|
| Salary Template | `EPAL.payroll.template/saveTemplate` | `salary_templates` (per company) · `GET/PUT /payroll/template` |
| Salary Manage | `generate/adjustSlip/finalize/pay` | `payroll_runs` + `payslips` · `POST /payroll/{ym}/generate|finalize|pay` |
| Loan Management | `loan/repayLoan/loanOutstanding` | `employee_ledger` (type loan/loan-repay) · `POST /payroll/loan` |
| Payslip | `statement` | `GET /payroll/statement/{emp}/{ym}` (PDF) |
| Advance Salary | `advance/advanceOutstanding` | `employee_ledger` (type advance) · `POST /payroll/advance` |

## Models
- `SalaryTemplate` { company_id, basic_pct, house_pct, medical_pct, tax_threshold, tax_pct, pf_pct, leave_days_per_year, working_days, pay_by_day, correction_day }
- `PayrollRun` { company_id, ym, status(draft|finalized|partial|due|paid), correction_until, due_after, finalized_at }
- `Payslip` { run_id, employee_id, ym, gross, earned_gross, basic, house, medical, transport, tax, pf, leave_deduct_days, other_deduction, bonus, encash_days, encash_amt, net, paid, advance_recovered, status }
- `EmployeeLedgerTxn` { employee_id, company_id, date, type(advance|loan|loan-repay|bonus|settlement), amount, method, memo }

## Accounting (posted through the LedgerService — see engine header)
Accrual: DR 5100 Salaries + DR 5150 Leave Encashment / CR 2120 Tax, 2110 PF, 2100 Salary Payable, 2150 Encash Payable.
Payment: DR 2100 / CR 1250 Advances, CR 1010 Bank. Advance: DR 1250 / CR 1010. Loan: DR 1260 / CR 1010.
Settlement: DR 2100 + 2150 / CR 1250, 1260, 1010. All tagged `company_id` (party = employee) so they consolidate to the group P&L by concern.

## Scheduling
A daily command runs `autoDue()` — after each run's `due_after` (10th) any finalized-but-unpaid payslip flips to **Due**. Leave encashment accrues 23/12 = 1.92 days per finalized month, payable in full at one completed year or pro-rata on resignation.
