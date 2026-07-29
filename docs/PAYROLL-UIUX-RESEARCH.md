# Payroll UI/UX — market research, gap analysis and a build backlog

**Date:** 2026-07-28 · **Scope:** research + comparison only. Nothing in this document
has been implemented. Every item is tagged with whether the data already exists, so
nothing here violates R8 (no invented data) without saying so out loud.

---

## 1 · What was researched

| System | Tier | What it is known for in payroll UX |
|---|---|---|
| SAP SuccessFactors **Payroll Control Center** (PCC) | Enterprise | KPI tiles with period comparison; validation rules that raise *assignable* alerts; process ladder (prepayroll → production → off-cycle) |
| **Workday** Payroll | Enterprise | Payroll command centre dashboard; ML anomaly detection on input *and* calculated results; period-over-period trend comparison per pay component; reconciliation + audit trail |
| **Oracle Fusion** Global Payroll | Enterprise | Payroll *Checklist* work area — every task as a row with status; Redwood "Process Results Detail" showing each task iteration; variance operators for exception rules |
| **ADP** Workforce Now | Mid-market | Topline-then-drill reporting; single analytics dashboard; payroll preview before commit |
| **Gusto / Rippling / Deel** | SMB / modern | Run-payroll wizard with a review step, plain-language cost summary, "what changed since last run" |
| **Keka / greytHR / Zoho Payroll** | India/South Asia | Cost split by department/location/cost-centre; **compliance dashboard** with statutory deadlines (PF 15th, TDS 7th …); one-click run |
| **ERPNext HR** | Open-source | Full lifecycle: gratuity, full & final, arrears, bank advice file, reimbursements in-cycle |

Sources are listed at the end.

---

## 2 · The patterns every one of them converges on

1. **A process ladder, not just a state badge.** Oracle's Checklist and SAP's PCC both show payroll as an ordered list of tasks with per-task status. You always know which step you are on and what is blocking.
2. **Validate *before* the lock.** Alerts/validation rules fire at prepayroll, are assigned to a person, and carry solution guidance. Nobody waits until after accrual to find a broken payslip.
3. **Period-over-period is the default lens.** Every KPI tile carries a comparison. Variance reports at *employee* level with a configurable ৳/% threshold are table stakes.
4. **Gross-to-net must be visible as a structure**, not just a row of numbers — a bridge from gross through each addition and deduction to net.
5. **Reconciliation is a first-class screen** (payroll totals vs GL vs bank), with an audit trail.
6. **Cost is sliced by department / cost-centre / location** with headcount alongside, so a cost rise can be read as growth vs. rate vs. overtime.
7. **A compliance calendar** with upcoming/overdue statutory deadlines and RAG status.
8. **A bank advice / payment file** as the bridge from "approved" to "money moved".
9. **Employee self-service payslips with YTD** — line-item breakdown, historical slips, mobile-readable, net pay visually dominant.
10. **Off-cycle runs** (bonus, arrears, final settlement) without disturbing the regular cycle.
11. **Wizard/stepper for the run** — 3–6 steps, backward navigation allowed, an explicit review checkpoint before anything commits.
12. **What-if simulation** — model an increment or a headcount change and see the cost before committing (SAP's dual-model simulator).

---

## 3 · What we have today (verified against the code)

**File:** `companies/travels/modules/payroll/` — `frontend/payroll.js` (1478 lines) +
`frontend/template.html` (316 lines) → compiled to `view.js`.
Registered for **five companies** and mounted **twice**: standalone `#/<cid>/payroll/<tab>`
and embedded via `EPAL.payrollDesk` inside Master Accounts and each company's Accounts
module — one implementation, so the group desk and a company desk cannot diverge.

**Eight tabs:** Overview · Salary Manage · Staff Accounts · Salary Template · Loan
Management · Payslip · Advance Salary · Reports.

### The Overview is genuinely strong

- **Four-card dashboard row** (`[data-shell="dash"]`, reusing the `bank-*` summary
  vocabulary so it is pixel-consistent with Manage Banks for free):
  1. identity panel — hero "Owed to staff", 3 clickable drill facts, and a *last payroll
     event* mini-statement with direction, amount, reference, and opening → closing of
     what we owe staff;
  2. mirrored sparkline — paid vs still-owed over 12 months;
  3. **Payroll ↔ Ledger reconciliation** — 2×2 of control figures, a variance stat, and a
     "why?" button that opens a month-by-month explainer;
  4. mini stack — advances+loans out, statutory payable.
- **Narrated digest** — plain-English paragraph computed live from payslips + ledger.
- **Payroll Autopilot** — proposals with buttons (finalize, pay all, clear arrears,
  encashment eligibility, loans with no schedule, staff with no salary, ledger variance).
  It never posts by itself; every proposal is a click.
- **Anomaly Radar** — overpayment, ≥2 months unpaid, advance larger than a month's salary,
  loan running past 24 months, pay swing ≥25% month-on-month, ≥5 absent days.
- **Monthly Register** (10 columns) → click a month → **full month drill**: month-scoped
  dashboard row, a 24-column Salary Register, employee money movements, and every ledger
  posting payroll wrote that month.

### Where the rest sits

| Tab | State |
|---|---|
| Salary Manage | Dashboard row + run control (month picker, status badge, Print Sheet, Finalize & Accrue, Reopen Draft, Pay All), 13-column salary sheet, per-head pay cards, Manage Salary modal, correction modal with auto-amount **overrides** |
| Staff Accounts | 13-column searchable roster with net position, salary due, advance, loan+EMI, encashment, last paid |
| Salary Template | Structure %s (basic/house/medical), tax threshold + %, PF, OT rate, lates-per-absent, leave days, working days, pay-by day, correction day — with a live ৳50,000 preview |
| Loans / Advance | 4 flat KPI cards each, disburse/repay forms, outstanding table, EMI deduction history, transaction table. **Structurally near-identical screens.** |
| Payslip | Employee+month picker, all-payslips table, print via `EPAL.people.payslipPrint` |
| Reports | 4 flat KPI cards + Leave Encashment Liability, Salary Due, Advance Register, Loan Outstanding, Department Cost, Increment History |

### Engine (`platform/engines-library/payroll.js`, 844 lines)

`computeSlip` (components on full gross; absent/late/early as money deduction lines; tax
threshold; PF on basic; OT auto 1.5× hourly; signed adjustment; encashment accrual),
`amountInWords` in Bangladeshi crore/lakh, monthly attendance (`att_monthly`), correction
window, finalize/unfinalize, pay/unpay, `payArrears`, `previousDueList`, `empLedger`,
`departmentCost`, `settlementPreview`/`settle`, `payEncashment`, full GL posting.

### Things that already exist elsewhere and are wired in

- **Full & final settlement UI** — lives in HRM and `platform/kit/emp-profile.js`, not on the payroll desk.
- **Monthly attendance entry** — `platform/kit/emp-profile.js`, per-employee only.
- **`EPAL.charts`** (Chart.js 4.4.3, already loaded in `index.html`) — line, area, bar
  (stacked + horizontal), doughnut, spark. **Payroll uses none of it.** Its only graphic is
  a hand-rolled `sparkSvg()` mirrored bar.
- **Design-system pieces payroll never uses:** `.kpi-spark`, `.kpi-trend` (up/down/flat
  pills), `.kpi-foot`, `.meter`, `.ring`, `.timeline`, `.avatar-stack`.
- **`EPAL.approvals`** — the default matrix already contains a `salary-change` doc type
  requiring MD sign-off. Payroll references approvals **zero** times.
- **`EPAL.audit`** — payroll references it **zero** times.

---

## 4 · Head-to-head

| Capability | Us | Market | Verdict |
|---|:--:|:--:|---|
| Ledger reconciliation on the payroll screen | ✅ strong | partial | **We're ahead.** Most mid-market payroll never shows the GL side at all |
| Narrated, plain-English digest | ✅ | rare | **We're ahead** |
| Proposal-style automation that never auto-posts | ✅ | rare | **We're ahead** — and it is the safer design |
| Anomaly detection | ✅ rules | ✅ ML (Workday) | Comparable in effect; ours is transparent, theirs is opaque |
| Drill from month → every employee → every posting | ✅ | ✅ | Par |
| One implementation for group + company desks | ✅ | n/a | Architectural strength |
| **Employee-level month-vs-month variance report** | ❌ | ✅ everywhere | **Biggest gap** |
| **Gross→net bridge visual** | ❌ | ✅ | Gap |
| **Pre-finalize validation gates** | ❌ (radar is post-hoc) | ✅ | Gap — real money risk |
| **Run checklist / process ladder** | ❌ (status badge only) | ✅ | Gap |
| **Real charts** | ❌ 0 charts | ✅ | Gap — and the library is already loaded |
| **KPI trend/comparison styling** | ❌ flat numbers | ✅ | Gap — CSS already exists |
| **Statutory remittance + compliance calendar** | ❌ | ✅ | Gap — PF/tax accrue to 2110/2120 with no "remit" action |
| **Bank advice / disbursement file** | ❌ | ✅ | Gap |
| **YTD figures** | ❌ | ✅ | Gap |
| **Off-cycle / bonus run** | ❌ | ✅ | Gap |
| **Approval before finalize** | ❌ | ✅ | Gap — engine exists, unused |
| **Audit trail on payroll actions** | ❌ | ✅ | Gap — engine exists, unused |
| **Bulk actions on the sheet** | ❌ | ✅ | Gap |
| **What-if simulator** | ❌ | ✅ (SAP) | Gap |
| Cost by department | ✅ table | ✅ chart+table | Partial |
| Loans / advances / encashment depth | ✅ | varies | **We're ahead** of most SMB tools |

**Summary:** our *accounting integrity* and *narrative* are better than most of the market.
Our *analytics, process control and compliance* are behind it. The gaps are almost all
computable from data we already hold.

---

## 5 · What we can add

Legend — **Data:** `HAVE` = already stored · `DERIVE` = computable from stored data ·
**`NEW`** = needs a new field/decision → **must ask the owner first (R7)**.

### A · Charts (Chart.js is already loaded; payroll uses zero)

| # | Chart | Where | Data | Why |
|---|---|---|---|---|
| A1 | **Gross→Net waterfall** — Gross → +OT → +Bonus → +Adj → −Absent → −Late/Early → −Tax → −PF → −Other → Net | Month drill, beside "How the month adds up" | DERIVE | The single clearest way to read a payroll month. Chart.js floating bars |
| A2 | **Month-over-month cost bridge** — prior net → headcount Δ → increments → OT → bonus → absence → current net | Overview | DERIVE (`monthSeries` + `salaryHistory`) | Answers "why did payroll go up?" — the #1 question a payroll owner asks |
| A3 | **Stacked 12-month bar** — earnings vs deductions vs net | Overview, under the register | DERIVE | Composition trend; `EPAL.charts.bar` stacked is already used in Finance |
| A4 | **Department doughnut** | next to the existing "Where the money goes" table | HAVE (`departmentCost`) | Table gives precision, doughnut gives proportion — keep both |
| A5 | **Horizontal bar leaderboards** — top 10 by net / by OT / by absence | Reports | DERIVE | Instant outlier spotting |
| A6 | **KPI sparklines** (`.kpi-spark` + `EPAL.charts.spark`) on every flat KPI card in Loans, Advance, Reports | those tabs | DERIVE | Free house-standard upgrade; the CSS band already exists |
| A7 | **Payment-progress meter** (`.meter`) — paid vs due % per run | Salary Manage run card | DERIVE | One glance instead of reading two numbers |
| A8 | **Ring gauge** (`.ring`) — run completion % | Salary Manage | DERIVE | Optional; use only if it doesn't crowd the row |
| A9 | **Employee × month heatmap** — absence, or pay variance | Reports | HAVE (`att_monthly`, slips) | Pattern to copy: `companies/group-cockpit/modules/analytics/view.js:365` |
| A10 | **Headcount bridge** — opening + joiners − leavers = closing | Reports | DERIVE (`joinDate`, `status`) | Separates "cost rose because we grew" from "rates rose" |

### B · KPI styles (all CSS already exists, unused by payroll)

- **B1 · Trend pill** — `.kpi-trend.up/.down/.flat` with Δ vs last month on every KPI. *(DERIVE)*
- **B2 · Context foot** — `.kpi-foot` micro-line: "3 of 24 staff · 12% of gross". *(DERIVE)*
- **B3 · Dual-value tile** — primary figure + a muted "vs last month" secondary, the way SAP PCC tiles are built. *(DERIVE)*
- **B4 · Normalised KPIs** — cost per head, cost per working day, average net, **median** net (median resists one big salary skewing the read). *(DERIVE)*
- **B5 · Threshold tone** — OT% or absence% turns warn/bad past a template-set limit. *(NEW: the thresholds — ask)*
- **B6 · Consistent semantic colour** — today advance/loan recovery is `text-warn`, the same as a deduction. A recovery is **not** a cost, it's repayment of money we already lent. Worth a distinct tone. *(design decision — ask)*

### C · KPIs worth surfacing

All `DERIVE` from what we already store, unless marked.

| Metric | Why it matters |
|---|---|
| Payroll cost per employee; average and **median** net | Comparability across months and companies |
| Gross-to-net ratio (take-home %); total deduction % | Instantly shows a deduction anomaly |
| **Overtime % of gross**, OT hours per head | The classic early-warning metric — understaffing or a control failure |
| **Absence rate** (absent days ÷ working days), late incidents per head | We already store both counts |
| **Payroll variance vs last month** (৳ and %) | Currently exists only as a sentence in the digest — it deserves a tile |
| **On-time payment rate** (paid on/before `run.dueAfter`) | A real governance figure |
| **Arrears ageing** — how old the oldest unpaid month is | The radar flags ≥2 months; the *ageing* is the finance number |
| Advance recovery rate; average months to recover | Tells you if advances are a benefit or a leak |
| Loan book: outstanding, weighted-average remaining months, EMI coverage | We compute pieces already |
| Encashment liability as % of a month's payroll | Sizes the provision |
| **Statutory payable ageing** (PF 2110 / tax 2120 sitting unremitted) | Balances exist; nothing tracks how long they've sat |
| **Manual-override count and value per run** | Both SAP and Workday treat this as a *control* KPI. Our slip already stores `absentOverride`/`lateOverride`/`earlyOverride`/`otOverride`/`advCap`/`emiCap` — nobody counts them |
| Headcount by dept/designation/status; joiners and leavers per month | Context for every cost figure |
| **Payroll as % of revenue** | `financials` already holds revenue per company per month |

### D · Features

Ordered by value-to-effort.

| # | Feature | Data | Notes |
|---|---|---|---|
| **D1** | **Employee-level variance report** — new tab or Reports card: this month vs last, per employee, per component, with a ৳/% threshold filter; jumps straight to the payslip | DERIVE | The most-cited feature in every system researched, and we already hold both months |
| **D2** | **Pre-finalize validation gates** — a blocking review panel before "Finalize & Accrue": zero-salary staff, negative net, net > 2× gross, missing attendance, recovery exceeding net, resigned employee still on the run | DERIVE | Today the Radar finds these *after* accrual. This is real money risk, and it is cheap |
| **D3** | **Run checklist / process ladder** — Generate → Attendance → Corrections → Review exceptions → Finalize & Accrue → Pay → Remit statutory, each a row with status | DERIVE from run status + slip counts | The Oracle/SAP pattern. No new data at all |
| **D4** | **YTD columns** on the payslip and register (gross, tax, PF, net) | DERIVE | Standard everywhere; we have every month's slip |
| **D5** | **Bank disbursement advice** — group the run's payments by bank/method, printable advice + CSV | HAVE (`method`, `EPAL.pay`) | Closes the gap between "approved" and "money moved" |
| **D6** | **Bulk actions on the salary sheet** — select rows → apply bonus/OT/adjustment, or pay selected | DERIVE | Currently per-row or all-or-nothing |
| **D7** | **Approval before finalize** — route through `EPAL.approvals`; the matrix already has `salary-change → MD` | HAVE (engine unused) | Maker-checker on the largest recurring cash movement in the group |
| **D8** | **Audit trail on payroll actions** — log finalize / unfinalize / pay / unpay / override via `EPAL.audit` | HAVE (engine unused) | "Reopen Draft" can reverse posted payments — that must leave a trace |
| **D9** | **Statutory remittance** — a "Remit PF / income tax" action that clears 2110/2120, plus ageing | Mostly HAVE; **NEW**: the remittance rules/authorities | Accounting gap: we accrue statutory liabilities and never settle them |
| **D10** | **Compliance calendar** — pay-by day, correction-until day, statutory due dates as a month strip with RAG status | Partly HAVE (`payByDay`, `correctionDay`); **NEW**: BD statutory dates | Ask the owner which BD deadlines apply |
| **D11** | **Off-cycle / supplementary run** — festival bonus, arrears run, without touching the regular cycle | **NEW** (a run type) | BD context: festival bonus is typically twice a year |
| **D12** | **Retro / arrears from a backdated increment** — recompute affected months | HAVE (`salaryHistory`) | Currently an increment only affects future months |
| **D13** | **What-if simulator** — "+10% across Operations" → cost impact, side by side | DERIVE (re-run `computeSlip`) | SAP's dual-model idea, and cheap for us because the engine is pure |
| **D14** | **Bulk attendance entry grid** — all staff × one month | HAVE (`att_monthly`) | Entry is per-employee only today, in `emp-profile.js` |
| **D15** | **Settlement on the payroll desk** — surface the existing `settlementPreview`/`settle` | HAVE (built, lives in HRM) | It's finished code sitting on the wrong screen |
| **D16** | **Cost-to-company view** — gross + employer PF + bonus provision + encashment accrual per head | Partly DERIVE; **NEW**: employer-side PF contribution | Ask: does the company contribute PF, or is it employee-only? |
| **D17** | **Employee self-service payslip** — read-only route with YTD | DERIVE | Print already exists via `EPAL.people.payslipPrint` |
| **D18** | **Budget vs actual payroll** | **NEW** (a budget figure) | Ask whether a payroll budget exists |
| **D19** | **Gratuity** | **NEW** (rules) | BD practice varies — needs an owner decision, do not guess |

### E · Table & document craft

- **E1 · Column groups on the register.** 24 columns is a lot. Banded headers — *Earnings │ Deductions │ Recovery │ Settlement │ Status* — turn it from a wall into four readable blocks.
- **E2 · Sticky employee column + sticky totals row** on the wide sheets.
- **E3 · Micro-bar inside the Net Payable cell** — each row's share of the month's total.
- **E4 · Left accent stripe** on rows that need attention (negative net, zero salary, overpaid).
- **E5 · Initials chip** on employee cells (`.avatar-stack` exists).
- **E6 · Slip status timeline** (`.timeline`) — draft → accrued → paid, with dates.
- **E7 · Payslip document redesign** — dominant net-pay box, a visual gross→net, YTD side panel, amount-in-words (the engine already produces it), and a verification reference.
- **E8 · Register print** — landscape, column groups, per-department subtotals. The column-tick print modal is already good; this extends it.
- **E9 · Density toggle** on the sheet (compact / comfortable) instead of `.tbl-dense` being permanent.

### F · Structure / IA

The eight tabs are a flat list. Every system researched groups by phase. A candidate grouping — **no feature removed, purely how the tabs are arranged**:

```
RUN      Overview · Salary Manage · Variance          (+ the run checklist inside Manage)
PEOPLE   Staff Accounts · Payslip
MONEY    Staff Credit  (Loans + Advance as two sub-tabs — near-identical screens today)
SETUP    Salary Template · Calendar
REPORTS  Reports (+ Statutory)
```

⚠️ **This changes navigation, so it needs an explicit owner decision (R7).** Merging Loans
and Advance would remove a large block of duplicated code, but it changes two routes.
Listed as an option, not a recommendation.

---

## 6 · Suggested sequencing

| Wave | Contents | Character |
|---|---|---|
| **1 — free wins** | A6 sparklines · B1 trend pills · B2 foot lines · A4 doughnut · A7 meter · E1 column groups · E2 sticky | Pure presentation using CSS and a chart library we already ship. No engine change |
| **2 — the real gaps** | D1 variance report · A1 gross→net waterfall · A2 cost bridge · D3 run checklist · D2 pre-finalize gates | The five things that close the distance to SAP/Workday/Oracle |
| **3 — control** | D7 approvals · D8 audit trail · D5 bank advice · D4 YTD · D6 bulk actions | Governance and throughput |
| **4 — needs owner input** | D9 statutory remittance · D10 compliance calendar · D11 off-cycle · D16 CTC · D19 gratuity · F structure | Every item here needs a rule or a date that only the owner can supply |

---

## 7 · Implementation notes

- **Build step is mandatory.** Module frontends are compiled: edit
  `companies/travels/modules/payroll/frontend/payroll.js` and `frontend/template.html`,
  then run `tools/build/build-module.mjs` and commit the regenerated `view.js`. Editing
  `view.js` directly, or skipping the build, means the change never deploys.
- **Frontend build law.** All new screens go under the *REAL-HTML BLOCKS* section of
  `template.html` as plain HTML with `[data-k]` / `[data-fill]` / `[data-proto]` /
  `[data-act]` hooks — not `el()`, not cloned `[data-tpl]` fragments.
- **Reuse the `bank-*` vocabulary.** The dashboard row is the house summary-identity-panel
  design. Anything new should extend it rather than fork a new card style.
- **Chart destruction.** `EPAL.charts` tracks instances and the router calls `destroyAll()`
  on route change — but the payroll desk also redraws *in place* when embedded
  (`deskRedraw`). Any chart added must survive that path, or it will leak/error.
- **The `[hidden]` trap** is documented at `frontend/payroll.js:449` — prototype rows must
  be **removed** from the DOM, not hidden. It will bite again with any new `[data-proto]`.
- **Verify with the boot sweep** — 0 console errors, 0 render failures across all routes,
  both themes — before every commit.
- **R1/R2/R3 note.** Everything in §5 is *additive*. Nothing here proposes changing how an
  existing screen looks or behaves. Items that would move existing pixels (F · structure,
  B6 · recolouring recovery, E9 · density) are flagged as owner decisions.

---

## Sources

- [Payroll Control Center: Process Management — SAP Help Portal](https://help.sap.com/docs/successfactors-employee-central-payroll/implementing-employee-central-payroll-based-on-sap-human-capital-management-for-sap-erp-hcm/payroll-control-center)
- [Use Payroll Control Center — SAP Help Portal](https://help.sap.com/docs/successfactors-employee-central-payroll/implementing-employee-central-payroll-based-on-sap-human-capital-management-for-sap-erp-hcm/use-payroll-control-center)
- [A look at SAP SuccessFactors Payroll Control Center Manage Configuration — SAPinsider](https://sapinsider.org/expert-insights/a-look-at-sap-successfactors-payroll-control-center-manage-configuration/)
- [From "What Is" to "What If": Building a Dual-Model Payroll Impact Simulator — SAP Community](https://community.sap.com/t5/human-capital-management-blog-posts-by-sap/from-what-is-to-what-if-building-a-dual-model-payroll-impact-simulator-for/ba-p/14365064)
- [Workday Payroll Management System](https://www.workday.com/en-us/products/payroll/payroll-management-system.html)
- [Workday Payroll for the U.S. — datasheet (PDF)](https://www.workday.com/content/dam/web/en-us/documents/datasheets/datasheet-workday-payroll.pdf)
- [Check out these Workday Payroll Reports — Commit](https://commitconsulting.com/blog/custom-reports-for-workday-payroll)
- [Monitoring the Payroll Flow Status — Oracle](https://download.oracle.com/tutorials/fusionapps/hcm/FusionHCMDemos/Payroll/html/tpc/711a04d3-c7c0-4cc4-8eb4-b5c1842d1417/topic.html)
- [Overview of Using Oracle Fusion Global Payroll](https://docs.oracle.com/en/cloud/saas/human-resources/faaus/overview-of-using-oracle-fusion-global-payroll-for-the-us.html)
- [Variance Operators — Oracle](https://docs.oracle.com/en/cloud/saas/human-resources/fasbe/variance-operators.html)
- [Viewing Payroll Insights Analytics — Oracle](https://docs.oracle.com/cd/F79855_01/hcm92pbr46/eng/hcm/hpay/ViewingPayrollInsightsAnalytics.html)
- [ADP Workforce Now Payroll](https://www.adp.com/what-we-offer/products/adp-workforce-now/payroll.aspx)
- [ADP Workforce Now Analytics](https://www.adp.com/what-we-offer/products/adp-workforce-now/insights.aspx)
- [41 Payroll Software Features for Indian Businesses — Keka](https://www.keka.com/payroll-software-features)
- [ERPNext v15 HR Module: Detailed Overview — ClefinCode](https://clefincode.com/blog/global-digital-vibes/en/erpnext-v15-hr-module-detailed-overview-and-deep-dive)
- [ERPNext HR & Payroll Modules Explained — Invento (Bangladesh)](https://invento.com.bd/erpnext-hr-payroll-modules-explained/)
- [Payroll KPIs Guide — Multiplier](https://www.usemultiplier.com/global-payroll/payroll-kpis)
- [Payroll metrics and KPIs — Lano](https://www.lano.io/academy/payroll/payroll-management/payroll-kpis-and-metrics)
- [Awesome Labor Cost Insights: 4 Valuable Payroll Metrics — BambooHR](https://www.bamboohr.com/blog/payroll-performance-metrics)
- [Payroll Dashboard Guide: Examples, Templates, Best Practices — FanRuan](https://www.fanruan.com/en/blog/how-to-build-a-payroll-dashboard-for-hr-and-finance-teams-examples-templates-and)
- [Payroll Analytics Dashboard — Factorial](https://factorialhr.co.uk/blog/payroll-analytics-dashboard/)
- [Waterfall Chart Guide — Domo](https://www.domo.com/learn/charts/waterfall-charts)
- [How to use the Payroll Variance Report — Remote](https://support.remote.com/hc/en-us/articles/41134470354829-How-to-use-the-Payroll-Variance-Report)
- [Payroll Variance Explained — Beebole](https://beebole.com/blog/payroll-variance-guide-finance-hr-managers)
- [Wizard / Stepper Pattern — UX Patterns for Developers](https://uxpatterns.dev/patterns/advanced/wizard)
- [Payroll Approval Workflow Guide](https://payrun.app/blog/payroll-approval-workflow)
- [Payslip Design Best Practices: Compliance and User Experience — BIPO](https://www.biposervice.com/news/payslip-design-best-practices-compliance-and-user-experience/)
- [Employee Self-Service Portals: Simplifying Payroll Access — Inova Payroll](https://inovapayroll.com/articles/employee-self-service-portals-simplifying-payroll-access/)
- [Global Payroll Compliance Checklist for 2026 — Deel](https://www.deel.com/blog/global-payroll-compliance-checklist-2026/)
