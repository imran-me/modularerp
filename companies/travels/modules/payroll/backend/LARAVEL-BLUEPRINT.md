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

## Printing (owner spec, 2026-07-30)
Two formal documents, both A4 landscape, laid out by `EPAL.report`
(`platform/kit/report-print.js`) and composed in `payroll.js`
(`paySummaryReport` / `payDetailReport`, opened from `printCentre`):

| Document | Id | Route it becomes |
|---|---|---|
| Payroll Monthly Register (one row per month) | `PR-MR[-<CO>]-<YYYY>-<MM>` | `GET /payroll/reports/register?months=…&company=…` |
| Salary Register (one row per employee, one month) | `PR-SR[-<CO>]-<YYYY>-<MM>` | `GET /payroll/reports/salary/{ym}?employees=…` |

- **Only approved runs** are printable (`status !== 'draft'`); the footer says so on every page.
- The masthead reads `EPAL.config.group.letterhead` and a concern's optional
  `company.letterhead` override → on the backend this is `companies.letterhead_*`
  columns (address, web, email, phone, licences), editable in Settings.
- **`pay_prints`** { id: report id, n: revision, at, by } is the revision counter
  and the audit trail of who raised a confidential payroll document. It is written
  when the print dialog opens, NOT when the preview is built. ⚠ Browser-local
  today (same persistence gap as `pay_txns`); on Laravel it is a
  `payroll_report_prints` table and `Rev n` comes from `count() + 1`.
- Totals are **not** a blanket `SUM()`: percentages are recomputed from the
  totals, the encashment column shows a closing balance, and headcount is
  `COUNT(DISTINCT employee_id)`. Whatever renders the PDF server-side must keep
  those three rules or the register will foot to figures that do not exist.
- PDF today is the browser's own Save-as-PDF (no library — the site is a static
  deploy). On Laravel it becomes Browsershot/dompdf over the same markup.
