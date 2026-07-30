# TASK QUEUE — owner-reported tasks (work top-down, never skip)

> Working rule (owner, 2026-07-21): when the owner gives multiple tasks, especially
> with screenshots, log them ALL here first WITH full context + a description of the
> screenshot, then do them ONE BY ONE, top to bottom, skipping none. If the owner
> forgets to continue, REMIND them what's still open. Mark each ✅ when done+pushed.


## ✅ CLOSED 2026-07-28 (evening)
- **Woodart Accounts — full Travels tab set.** Owner circled the Travels tab band:
  "I need these all in the Interiors Account." 3 tabs → 11. Payroll and Manage Cash
  MOUNT THE SHARED DESKS (`EPAL.payrollDesk` / `EPAL.cashDesk` already take a cid),
  so Woodart runs the same code Travels does. 7 of 9 needed no new table.
- **`wa_recurring` persists** — migration, model, controller, request, seeder,
  CONDITIONAL hydration. Verified vs MySQL: 6 rows, 5 active, 9,39,200 commitment.
- **Sidebar grouping + eyebrow convention** aligned to Travels.
- **SEVEN stale `view.js` rebuilt.** air-ticketing · travels/accounts (×2) ·
  master-accounts · contract-flight · crm. Root cause: commit 7afa4e3 landed source
  edits without running the build. Every one was swallowing an owner-requested money
  fix — the Paid-without-an-account guard, the won-deal receipt question, and the
  ledger naming a generic 1010 instead of the real bank.
- **Gates added:** `routes-imports.mjs` · `build-fresh.mjs` · `deployed-smoke.mjs` ·
  `preflight.mjs` (all of them, one command) · `tools/hooks/pre-push` (installable).
- **`php artisan migrate:collisions`** — read-only report of what each pending
  migration would hit. Replaces guesswork on the shared-database problem.

## ⏭️ STILL OPEN

### T-PAY-TABLES — every table on the payroll desk, footed and printable (PLAN, 2026-07-30)
Owner: *"which table we work on same way?? … you go check the overall payroll, list
how many we have and do plan."*

**The count: 29 tables on the desk. 3 are footed and printable. 26 are not.**

Two separate treatments, and not every table earns both:
- **FOOT IT** — a totals row via `EPAL.table`'s `opts.totals(rows)`. Cheap, and
  every table with a money column owes the reader one. Same four rules every
  time: sum what sums · re-compute percentages from the totals · a cumulative
  accrual shows its CLOSING BALANCE · people are counted DISTINCT.
- **PRINT IT** — a formal document through the print centre (masthead · footed
  totals · panels · sign-off). Only for tables somebody actually hands to
  somebody. A drill-down modal does not need letterhead.

| Phase | Tab | Tables | Foot | Document |
|---|---|---|---|---|
| P1 ✅ | Overview · month drill | Monthly Register · Salary Register | done | `PR-MR` · `PR-SR` |
| P2 ✅ | Salary Manage | Payroll History | done | reuses `PR-MR` (same `monthSeries()`) |
| P3 ✅ | Salary Manage | **Salary sheet** | done (`sheetTotals`) | **`PR-DS` Salary Disbursement Sheet** — signature line per employee |
| P4 ✅ | Staff | **Staff Accounts** | done | **`PR-SP` Staff Position Statement** — as at, not per month |
| P5 ✅ | Loans | staff-loans · loan-register · emi-history · loan payments (modal) · loan transactions | done ×5 | **`PR-LB` Staff Loan Book** |
| P6 | Advance | advance outstanding · advance requests · advance transactions | ⏭ ×3 | ⏭ **Advance Register** |
| P7 | Reports | payroll-by-account (+ its drill) · encashment liability · loan outstanding · department cost · increment history · simpleTbl lists | ⏭ ×7 | ⏭ **Encashment liability schedule** + **Payroll ↔ ledger reconciliation** (the two an auditor asks for by name) |
| P8 | drills & modals | month transactions · money movements · ledger postings · variance explainer · payslip list · template list · structure compare · blocked-approval check | ⏭ ×8 | none — a drill is not a document |

The Payslip already has its own printed artifact (`EPAL.people.payslipPrint`), so it
needs footing only. Each phase is one commit, verified the same way: sweep both
themes + a driver that checks the footed figure against an INDEPENDENT sum out of
the store.

### T-PAY-P5 — the Loan Book, and the engine bug footing it found ✅ (2026-07-30)

**⚠ THE FOOT FOUND A MONEY BUG.** The loan register footed **৳92,004** still due
while the tab's own KPI and Staff Accounts said **৳3,59,505** — two readers of the
same loans, ৳2.67L apart. Cause, in `platform/engines-library/payroll.js`:

```js
// before
x.type === 'loan-repay' && x.slipId !== exceptSlip
```
A **manual** repayment (cash or bank, not deducted from a payslip) carries no
`slipId`. With no `exceptSlip` passed, that test reads `undefined !== undefined` →
**false**, so every hand-recorded repayment was silently dropped and the loan
stayed outstanding at its full principal for ever. It also fed `emiInstallment()`,
which caps the monthly deduction at that figure — so **payroll would keep
recovering EMI from a loan the employee had already paid off in cash**.

Fixed to `!(exceptSlip && x.slipId === exceptSlip)` — exclude a slip's own
repayment only when a slip is actually being sized. After it, a per-employee probe
finds **zero** disagreement between `loanOutstanding()` and the rebuilt loan book,
and both tables foot to ৳92,004. Knock-on: "Employees with loans" drops from 10
people to the 4 who really owe; the Loans KPI, Staff Accounts' *Loan out* and P4's
*Owed by staff* all fall to the true figure; and P4's five "loan with no EMI set"
exceptions disappear, because those loans were repaid, not unscheduled.

**Five tables footed**, each by what its columns actually mean:
- *Employees with loans* — taken · repaid · still due · EMI sum, and **Repaid via
  foots as the split** (`salary ৳0 · cash ৳3,72,996`), which is the only honest
  total for a column that exists to say HOW the money came back.
- *Loan register* — the three money columns, and **Status counts** (`5 running ·
  8 cleared`) instead of pretending to a total.
- *EMI history* — the EMI column sums; **"loan due after" refuses to**, because it
  is a per-loan balance at a moment and adding fifteen of them invents a figure.
- *Loan payments* (per-loan modal) — paid sums, "due after this" shows the
  **closing balance**, the same rule as the encashment column.
- *Loan transactions* — the one table where a single Amount total would be a LIE:
  the rows run both ways, so it foots **net, with both directions beneath**
  (`৳92,004 net · ৳10,92,000 lent · ৳9,99,996 repaid`).

**`PR-LB` Staff Loan Book** — one row per LOAN, not per person ("how much of the
৳20,000 taken in May is left" is a question about a loan, and one person can hold
three). As at, like the staff statement. Columns: `#` · Employee (ID) · Company ·
Taken on (EMI plan) · Principal · Repaid (% beneath) · **Still due** · EMI a month
· **Months to clear** · Repaid via · Status. The totals row's *months to clear* is
NOT a column sum — it is the whole open book's runway at the EMI actually
scheduled. Panels: *The book, both ways* (disbursed → recovered from salary and
from cash → outstanding → runway) and **How old the outstanding money is** (buckets
by when each loan was taken — nothing else on the desk answered that).
Picker: Everything lent · Clear all · **Only running** · **Only cleared** · **Only
without an EMI plan** · add by company.
- Verified: sweep 253/253 × both themes, 0 errors; foots match an independent walk
  of `loanBook()` over every employee (13 loans · ৳10,92,000 disbursed · ৳9,99,996
  repaid · ৳92,004 outstanding · 5 running), *Only running* prints 5 of 13, and the
  pages were read at 1:1.
- 🔎 **Small thing spotted, not changed:** EMI is `round(principal ÷ months)`, so
  months × EMI can miss the principal by a taka or two (two loans here sit at ৳2
  still due). It self-heals — the cap means the next deduction takes exactly the
  remainder — but if the owner wants the last instalment to absorb the rounding,
  say so and it is a one-line change in the engine.

### T-PAY-P4 — the Staff Position Statement ✅ (2026-07-30)
The first document on the desk that is **not about a month**. Staff Accounts is a
set of BALANCES, so `PR-SP` is dated *as at* — no month to tick, no run to approve,
no signature to collect.

- **Its own picker** (`staffPrintCentre`), not `printCentre`: scope + as-at, then
  who — Everyone · Clear all · **Only with a balance** · **Only owed salary** ·
  add by company / department, with the same live counter (`17 of 18 people ·
  people carrying a balance only · net position ৳12,22,730 owed to staff`).
  Same classes, same vocabulary, different questions.
- **Columns:** `#` · Employee (ID) · Company · Designation (dept) · Monthly salary
  · Salary due · Advance out · Loan out (EMI beneath) · Encashment accrued (days
  beneath) · **Net position** (`we owe / (they owe)`) · Status.
- **THE SIGN CONVENTION IS THE DOCUMENT:** the screen says owed/owes in green and
  red, which a photocopier throws away, so here it is the bracket plus the words
  under the figure, and the scope line states the rule before the first row.
- **The trap this build hit, and the fix:** the table's Net position column is the
  employee LEDGER balance (whole history, everything earned less everything handed
  over) = ৳12,22,730, while netting today's balances gives ৳5,71,387. Two figures,
  one name, one page — a control failure. So the KPI band now carries the LEDGER
  balance (tying to the table's own foot), the panel is named *"What each side is
  owed, today"* closing on *"Owed to staff, less recoverables"*, and a NOTE states
  why the two differ before anybody calls one of them a bug.
- **Foot:** money sums, plus the signed net printed as its net AND both gross
  sides (`৳12,24,323 we owe · ৳1,593 they owe`) — a total that showed one
  direction while hiding the other would be worse than none. Non-money columns
  say what they count: *1 never paid · 18 active*.
- **Exceptions it raises by itself:** a LEAVER still owing money (no pay left to
  recover from), an advance bigger than a month's salary, **a loan with no EMI
  set** (five people, caught on the first run), and anyone with no salary on record.
- Verified: sweep 253/253 × both themes, 0 errors; the foot matches an independent
  sum over `employees` (18 people · salary ৳10,53,000 · due ৳4,63,316 · loans
  ৳3,59,505 · encashment ৳4,67,576 · ledger ৳12,22,730), *Only with a balance*
  picks 17 of 18, and the printed pages were read at 1:1.

### T-PAY-P3 — the Salary Disbursement Sheet ✅ (2026-07-30)
Owner: *"P3 Salary Manage · Salary sheet — the disbursement sheet, wants a
signature column per employee. continue this one."*

The sheet's own **foot was already done** (`sheetTotals`, added in the parallel
session), so P3 was the document — and it is a THIRD document, not the register
with a column bolted on. `PR-DS-<YYYY>-<MM>`, and it is the one artifact on the
desk that leaves the building **unfinished**: out with a blank column, back as the
receipt.

- **Columns are the cashier's, not the accountant's:** `#` to tick down · Employee
  (ID beneath) · Company · Department · Net payable · Recovered (advance + EMI, in
  brackets) · Already paid · **To hand over** (the only bold figure on the row) ·
  Through (the account a paid row actually left by) · **Signature and date** —
  a dotted rule in the widest column after the name. The full earnings breakdown
  stays in `PR-SR`; putting it here would push the signature off the paper.
- **Rows are tall** (`.rp-tall`, 2.6mm top and bottom) because somebody has to
  write on them. That costs pages — 17 people over 3 — which is correct for a
  sheet that gets signed.
- Net payable is already net of advance and EMI (the engine's `slipPayable`), so
  "to hand over" needs no arithmetic in the cashier's head. Recovered is printed
  for the EMPLOYEE's benefit.
- Panels: *How this sheet adds up* (gross → net → cash to hand over; the
  adjustments line is the residual, so the panel foots to the engine's net rather
  than to my arithmetic) and *Paid so far, through which account* (a mini-table
  built from the payslips' own `payMethod`, so it can only name accounts that
  really carried money).
- Sign-off is the CASH chain: Prepared by · **Cash handed over by** · Checked by ·
  Approved by. "Recommended by" is not a step in handing money over.
- **Print centre gained a third level** — Summary · Employee-level detail ·
  **Disbursement sheet** — and Print in the sheet's own toolbar opens it there by
  default. Pair with **Only unpaid** and it is exactly the sheet for today's
  payout. The control bar's older "Print Sheet" (tick the columns) is untouched.
- Verified: sweep 253/253 × both themes, 0 errors; driver confirms the level
  default, 17 signature lines for 17 rows, and totals net ৳8,04,066 · recovered
  ৳1,27,666 · paid ৳3,40,750 · **to hand over ৳4,63,316** against an independent
  sum out of `pay_slips`. Filtering to *Only unpaid* (11 of 17) leaves cash to hand
  over **unchanged at ৳4,63,316** — as it must, since a fully-paid employee is
  owed nothing.

### T-PAY-HISTORY — Payroll History prints the same register ✅ (2026-07-30)
Owner: *"the one you have done already is in Overview the Monthly Register Table.
It matches with Salary Manage's Payroll History table, check it. If matches 100%,
then first make same print option there, if not, list what's the difference."*

**Checked: same DATA, narrower VIEW.** Both tables are `monthSeries()` — the same
months, the same figures, no limit on either — so the printed register is a
drop-in with nothing to recompute and nothing to keep in sync. The differences are
all presentational:

| | Monthly Register (Overview) | Payroll History (Salary Manage) |
|---|---|---|
| Columns | 10 — Month · Run · Employees · Gross · Additions · Deductions · Encash · Net Payable · Paid · Due | 6 — Month · Staff paid (`6 / 17`) · Gross · Net paid · Still outstanding · Run status |
| Headcount | on the payroll | fully paid / on the payroll |
| Status | badge | badge **+ "No run" + "Mixed · N runs"** |
| Row click | drills into that month's Salary Register | opens **every transaction** in that month |
| Question | what the month **cost and owes** | what the month **paid out, and to how many** |

So Payroll History now raises the FULLER `PR-MR` register — it carries every column
this card shows and four more. One payroll month register, not two variants.
Its foot follows the same rules: sums for the money, and "Staff paid" foots as
**people with nothing outstanding across the period / people on the payroll in it**
(6 / 17), never a sum of monthly counts.
⚠ A month with **no run**, or a draft one, is listed on this card but cannot be
printed — only approved runs leave the building, and the centre says so.

### T-PAY-PRINT — the payroll print system, to the owner's written spec ✅ (2026-07-30)
Owner sent `Epal-Group-Payroll-Print-Spec-Prompt.md` (9 sections + a 13-point
acceptance checklist) with a rendered mock-up, plus two amendments in his own
words: *"print layout style, just avoid too much colors. dont need the monthly
average raw."*

- **Print opens the PRINT CENTRE**, never the printer: scope → months → detail
  level → employees → preview. All months and all rows ticked by default; the
  live counter says what the printed totals row will say; Preview is disabled at
  zero. Screen A (Monthly Register) defaults to summary, Screen B (Salary
  Register) to employee-level with that month ticked.
- **Two documents**, A4 landscape: `PR-MR-…` Monthly Register, `PR-SR-…` Salary
  Register. Company code in the id when the scope is one concern.
- **New shared renderer** `platform/kit/report-print.js` (`EPAL.report`) —
  JS-paginated, footer + `Page X of Y` on every page, table header repeated, no
  split rows, sign-off last. The preview shows the nodes that print.
- **Totals rows on screen too** — `EPAL.table` gained opt-in `opts.totals(rows)`.
  Sums where a sum is the answer; percentages recomputed from the totals; the
  encashment accrual shows a closing balance; headcount is distinct.
- **Two colours only**, every figure black, negatives in brackets, en dash for
  nil, Bangladeshi digit grouping, no Monthly-average row.
- Also: `EPAL.config.group.letterhead` (+ per-company override) and `pay_prints`
  (revision + who printed what).
- **Follow-up, same day** (owner: *"where is, after clicking a single month, then
  print option, with that month's these infos?? also, option to mark specific
  employee, or all, or just due, or just paid"*): Print now also sits in the
  Salary Register's OWN toolbar beside Export and PDF — it was only at the top of
  the month screen, out of sight by the time you are reading the register — and
  step 4 gained **Only unpaid** / **Only paid** (which REPLACE the selection, so
  one click is one intended set) beside Select all / Clear all and the additive
  Add-by-company / Add-by-department pickers. Every row now shows a Due/Paid
  badge, and the printed page names the subset: *"Partial selection — 11 of 17
  employees, unpaid only."*
- ⏭ **Owner input still wanted:** each concern's OWN address / licence numbers
  for its letterhead (they currently print the group's), and whether the sign-off
  roles should carry real names instead of "Accounts / Head of HR & Admin /
  Managing Director".

### T-ALLCO-NOTE — the all-companies note collapses to its (i) ✅ (2026-07-30)
Owner screenshot of Master Payroll ▸ Overview ▸ **All Companies**, the note's info
icon circled with an arrow drawn at it: *"make the marked icon placed here while in
all companies, clicking it will expand its card."*

- The note now ships **shut** — nothing but the (i), on the exact spot the open
  card's icon occupied (measured 34×34 at x=366), so expanding grows the card down
  from the icon and nothing shifts sideways. Clicking again shuts it.
- One `scopeNote()`, so all five tabs that show a note (Overview · Salary Manage ·
  Loans · Advance · Reports) behave identically; the open card is the same 944×156
  card with the same words as before.
- The open/shut choice is remembered for the session (module var, not the store), so
  it does not re-open on every tab click. Single-company mode is untouched — the note
  only ever renders in all-companies mode.
- Sources: `frontend/template.html` (the icon IS the toggle button) ·
  `frontend/payroll.css` (`.scopenote.is-shut`) · `frontend/payroll.js` (`noteShut`),
  rebuilt into `view.js`. Sweep 253/253 × both themes, 0 errors; shut/open
  screenshotted in light and dark.

### T-ALLCO-PAYROLL — an "All Company" button before Group, giving a combined view ✅ (2026-07-29)
Owner, with a screenshot of Master Accounts ▸ Master Payroll ▸ Loans and six red
arrows drawn at the company switcher: *"the company switcher works fine, I am
grateful to you. But the group acts as a company now in the payroll, as group has
its employees. So, make another button before group, "All Company". So that, every
nav's all-company switcher gives us a combined view. Like, I am in the Loan
section, and switched All Companies, so I will see all loan employee list, with
their loan amount taken, paid, due as of, the loan related transaction history of
all companies…"*

- ✅ **The button was already in the markup and was being DELETED on payroll** —
  `[data-co="all"]` sits first in `[data-shell="switcher"]`, before Group HQ, exactly
  where the owner asked for it. Two lines removed it: a filter in the switcher wiring
  and, ten lines above, `if (sub === 'payroll' && selCo === 'all') selCo = 'travels';`
  — a SECOND guard that silently rewrote the scope and cost a debugging round when
  only the first was found. `payrollView` also rewrote 'all' → 'travels' on the way
  into the desk. All three are gone; `selCo` reaches the desk untouched.
- ✅ **The desk answers the 'all' sentinel on all EIGHT tabs.** Nothing compares
  `CID` to a company id any more: every read goes through `inScope(companyId)` /
  `scopeCids()` / `scoped(store)` / `slipsIn(ym)` / `runInfo(ym)` / `deptCost()`,
  which in single-company mode reduce to exactly what the code did before. **Group HQ
  is one of the scoped companies** — which is what the owner's first sentence was
  about. Every list gains a Company column (and a Company filter) in all-mode only.
- ✅ **LOANS, the tab the owner was standing on:** one book across six payrolls —
  who holds a loan, taken · paid so far · still due · repaid via · monthly EMI per
  person, the per-loan register, the EMI deduction history and the full loan
  transaction trail, every row naming its company. Proven by a driver that sums the
  screen's "Still due" column and compares it to Σ `loanOutstanding()` over EVERY
  company: ৳1,68,837, not Travels' ৳92,000.
- ⚠ **WHAT ALL-MODE DELIBERATELY WILL NOT DO: post a RUN.** Generate / Finalize /
  Reopen / Pay All and the salary STRUCTURE write records keyed by company id, and
  'all' is not a company — `generate('all', ym)` would create a `pay_runs` row against
  a company that does not exist. Those controls are replaced by a note naming the
  concerns; the Autopilot turns into a board read-out saying WHICH company is behind.
  Everything keyed by an EMPLOYEE keeps working (loan · advance · repayment · payslip
  · payment · punishment), because the engine derives the company from the person —
  and "Paid from" now follows the employee, so a Woodart loan can never be paid out of
  a Travels account. Salary Template shows every company's structure side by side,
  read-only.
- ✅ **VERIFIED** — sweep **253/253 × both themes, 0 console errors** · tw gate green ·
  trial balance balances · a purpose-built driver, **31/31**, that clicks the button,
  walks all eight tabs, opens an IT Solutions loan out of the combined register,
  proves the account list re-fills when the employee's company changes, asserts the
  run controls are absent, asserts **nothing was written against a company called
  "all"**, and asserts a single company still reads exactly as before.

### T-LOAN-ROWS — every loan row says taken · taken on · paid till now · still due ✅ (2026-07-29)
Owner, with a screenshot of Payroll ▸ Loans (EMI Deduction History + Loan
transactions, both showing only an amount): *"the loan section in payroll needs
more perfections. Like, MrX taken 20K loan, Loan date May 2026, Total Paid 6K,
Total Due 14K to the date, Paid as Deduction of Salary / Cash etc. Wherever is a
row of a loan, whether its status or history, it must show these figures — loan
taken, date taken, paid till now, due total."*

- ✅ **`EPAL.payroll.loanBook(empId)`** (engine) — the per-loan book, rebuilt from
  the movements: every disbursement is a loan; every repayment (manual, the auto
  payslip EMI, or a final settlement) is applied to the OLDEST loan still open
  (FIFO). Returns taken / taken on / paid / due / EMI plan / viaSalary / viaCash /
  closed + the payment trail with the balance after each one. A READ — nothing is
  stored, and Σ due IS `loanOutstanding()` by construction, so no tile can drift.
- ✅ **Payroll ▸ Loans** — "Employees with loans" gained taken · paid · still due ·
  repaid via; a new **Loan register** lists every loan ever taken (running and
  cleared) and opens a per-loan drill-down (stats, how it was repaid, every
  payment with the balance after it, printable statement); EMI history and the
  transaction trail now name the loan each row touched and its due after it.
- ✅ **Everywhere else a loan row appears:** Staff Accounts' "Loan out" column,
  the employee file's Salary & Loan Summary (every loan, one row each), Payroll ▸
  Reports' Loan Outstanding (loan-wise), the employee profile's Accounts tab, and
  Master Accounts ▸ Manage Loan (staff book = Total Loan · Paid · Due, the
  drill-down's Loans Given table, its recovery history and printed statement).
- ✅ A stored `bank:BNK-04` now prints as the account's name on these rows.
- **Verified:** boot sweep 253/253 routes × 2 themes, 0 console errors · trial
  balance still balances · screenshots of the Loans tab, the loan drill-down
  (light), Staff, Reports, the employee file and the group loan desk.

### T-SALARY-SPLIT — pay several months in one go, and the month read out in full ✅ (2026-07-29)
Owner, with a screenshot of the **Manage Salary** modal (the money-bag icon on
Salary Manage, `#/group/master-accounts/payroll`): *"while salary payment I want
more option — he might have 20K due for his March salary and 40K for July, so I
can pay Against Due 15K (due becomes 5K) and against July 30K (10K goes to the
due), total due 10K + 5K = 15K."* Then a second screenshot — the reference app's
**Add New salary form** (Users · Salary Month · generation date · scheduled date ·
Payment Methods · Payment Status · Gross · Total Deductions · Total Additions ·
Bonus Label/Amount · Salary Adjustment · Net Salary, then ATTENDANCE SUMMARY,
DEDUCTION BREAKDOWN, OVERTIME ADDITION, Note) — with: *"our current + this
screenshot, by combining both. I must need what I have now, then will be added
the new screenshot like shape."* Owner confirmed: **same modal, extended**, and
**one input per unpaid month** (not two buckets).

- ✅ **The allocator** (`payAllocator` in the payroll module) — one row per month
  the employee is still owed for, each with its own box and a live "left ৳X",
  plus a footer that says *Paying now* / *Total due after this* as you type.
  Quick fills: Fill everything · Past dues only · This month only · Clear.
  It lists EVERY unpaid month, not only earlier ones, so opening March still
  shows July. Paid-from uses the REAL account picker (`EPAL.pay.options`), so a
  salary payment names the bank it left — the old Pay… form offered a bare
  method list. Renders inline in Manage Salary AND is the body of the Pay… modal.
- ✅ **No accounting change was needed** — `pay(empId, ym, amount, method)` has
  always booked a partial against a NAMED month; what was missing was a way to
  say it. Each month is one posting, so every guard (never more than
  outstanding, advance/EMI recovery, the ledger ceiling) applies per leg.
- ✅ **The record read out in full** — four new cards under the part that was
  already there: Salary record · Attendance summary · Deduction breakdown ·
  Overtime & additions. Read-outs, not inputs; the month is still edited on
  Adjust. Every figure comes off the payslip or the attendance record — where
  the reference shows something this system does not hold (clock minutes, a free
  bonus label, a note) the tile says what we DO hold instead of guessing.
- **Verified:** boot sweep 253/253 routes × 2 themes, 0 console errors ·
  trial balance still balances · modal driven end-to-end in headless Chrome
  (typed 26,474 against January and 16,805 against July of 35,298/33,609 →
  8,824 + 16,804 = 25,628 remaining, exactly what the footer previewed).
- ⏭ **Not built, needs an owner call:** a free-text **Note** on the payslip and
  an editable **Bonus Label** (both in the reference form). Neither exists in the
  store today, so both are new persisted fields — say the word and they get a
  column, a migration and a place on Adjust.

### T-PAY-QUESTIONS — the owner's accounting questions, answered on the desk (2026-07-29)
He asks payroll in depth: how much due / payable this month · how much comes off
for loans, absence, punishments, advance EMI · how much goes out extra as overtime
and bonus · for ONE person: how much now and for what, where the rest goes on a
partial, his last months' history, how much of it was advance repayment vs
deduction, hours worked, where he stands against the others · and **from WHICH
account did I pay — cash, which bank, last month, last six months.**

Audit of what the desk could answer: the accounting spine was there (accrual,
partial pay, arrears with dates, advance/loan recovery, ledger reconciliation) —
roughly 70%. The gaps were presentation of data already on file, except hours.

- ✅ **Where the money went** (Reports) — by account, over 1/3/6/12 months, split
  Salary · Advance · Loan · Bonus · Other, plus what came back in; click an account
  for its transactions and vouchers. Answers the whole "from where / which bank /
  how much last 6 months" block. `299751e`
- ✅ **How <month> is made up** (Salary Manage) — gross → OT/bonus/adjustment →
  absent/late/early/fine/tax/PF/other → net payable → advance + EMI recovered →
  cash to hand out. Answers the deduction/addition split by kind. `299751e`
- ⏭️ **Per-employee, folded into T-PROFILE-FULL below** (do NOT build twice):
  a "Paid from" column + a 6/12-month money summary on the profile's Accounts tab
  (salary paid · advance taken/recovered · loan taken · EMI paid · bonus ·
  deductions), and a plain rank ("#3 of 14 by salary") on Staff + the profile head.
- ⛔ **Hours worked — NOT answerable, needs a decision.** Attendance stores DAYS
  (present/absent/late/early-leave); there is no clock-in/out anywhere, so the
  reference screenshot's "Working Hour 174.03 hr · Late Time 862.52 min" cannot be
  derived from anything we hold. Either per-day time entry starts being recorded,
  or the profile keeps showing what is true — worked days, absent days, late count,
  overtime hours. **Owner decision.**

### T-PROFILE-FULL — the individual employee profile (owner, 2026-07-29) — NEXT
Owner sent two screenshots while the Staff Accounts fit was being finished:

1. **The reference app's analytics stack** — Weekly Task Performance (bar: assigned
   vs completed, this week) · Monthly Task Performance (area, 12 months) ·
   **Attendance Summary (July 2026)** with three tiles (Present Days 22 · Late Time
   862.52 min · Working Hour 174.03 hr) over a dual-axis Late-Time/Working-Hour chart
   · **Leave Summary (2026)** (Approved 5 · Pending 0 · Rejected 0 · Used Leave Days 5)
   · **Salary & Loan Summary** (Paid/Pending records, total & latest net salary |
   running loans, completed loans, remaining amount, pending & approved advance).
2. **Our own profile with that stack pasted under it** — the dark-blue header
   (avatar, name, "Interior Design · WOOD ART INTERIORS", Full-time/Active chips,
   PaySlip + Back buttons), the six money tiles, our real tab row
   **Overview · Accounts · Payslips · Attendance · All Details**, Profile Details,
   then TASK TOTAL / COMPLETED / PENDING tiles and the charts above.

**Ask:** "I want the employee profile individually like this. Current one should stay
as it is now, but clicking an employee name should open an employee's full profile
like I have given in the screenshot."

Reading: the Staff Accounts table stays exactly as it now is; the profile that opens
on a name click (`EPAL.people.open` → `platform/kit/emp-profile.js`, today a MODAL
with those five tabs) grows the analytics stack. Every number already exists in the
app — tasks + phases (Task Oversight store), attendance (`P.saveAttendance`), leave
(`P.leaveState`), payroll/loans/advances (`EPAL.payroll`) — so nothing has to be
invented; it has to be charted.

**Open questions to settle before building:** modal vs full page (the shot shows a
"Back to User List" button, which implies a page); which chart lib is already in the
bundle; and whether the tiles belong on Overview or a new tab.
- **Woodart accent colour** — green `#6f9c1c` is the DELIBERATE per-company identity
  (group blue · travels blue · woodart green · IT purple · shop pink · construction
  orange). Making it blue erases one member of that system. ONE LINE in
  `platform/core/config.js` — **owner decision, not a style fix.**
- **Density & typography** — compared the same screens in both companies; found no
  divergence beyond what is already fixed. Needs the owner to point at something
  specific, or it should be closed.
- **The ~20 non-Woodart pending migrations** — now ANSWERABLE: run
  `php artisan migrate:collisions` on the host and act on what it says.
- **Projects module writes** — hydrates read-only; promoting to WRITABLE belongs
  with the projects rebuild (its own build slot).
- **Install the pre-push hook on each clone:**
  `cp tools/hooks/pre-push .git/hooks/pre-push && chmod +x .git/hooks/pre-push`
## ⏳ OPEN

### T-BE-MONEY — the Laravel money chain (autonomous session, 2026-07-27) ✅
Owner was out for 2h and asked for continuous work. Priority #2 is travels/accounts
full-stack; the other session had just finished its FRONTEND, so the **backend half**
was free and collides with nothing.

**Built — kernel services** (`platform/backend/app/Services/`), so every concern posts
money the same way and a company module never reaches into another's code:
| Flow | Service | Endpoint |
|------|---------|----------|
| money out | `ExpensePostingService` (earlier) | `POST /api/travels/accounts/expenses` |
| a sale | **`SalePostingService`** | `POST /api/travels/accounts/sales` |
| customer paid | **`ReceiptPostingService`** | `POST /api/travels/accounts/receipts` |
| still owed | ″ | `GET /api/travels/accounts/receivables` |
| between concerns | **`InterCompanyService`** | `…/master-accounts/intercompany/{positions,invoice,settle,shared-cost}` |

**THREE REAL BUGS FOUND BY WRITING THE TESTS** (all fixed, all pinned by a test):
1. **Every void/refund was rejected by the API — 422.** `LedgerService` (and
   `JournalController` before it) demanded `Dr > 0`, but a void negates BOTH sides:
   balanced, and exactly what the SPA's `ledger.post()` accepts. So the browser showed
   a sale reversed while the DB still carried the revenue and the payable. Now the rule
   is balance-only, plus a refusal for an entry worth nothing.
2. **`journal_entries` had no `party` column.** The SPA sent it on every posting; the
   API dropped it on write and returned `'party' => ''` on read. That blanks the Party
   Ledger, AR/AP-by-counterparty, and the **inter-company balances card** in Travels
   Accounts — whose Settle button reads exactly that. Nullable indexed column added
   (`2026_07_27_004000`), written hasColumn-guarded, returned by the controller.
3. **The expense head mapper misfiled two everyday categories, on BOTH sides.**
   "Tea / Coffee (Guest)" → **6000 BANK CHARGES** (unbounded `fee` matched "cof-FEE")
   and "Facebook / Google Ads" → 5800 Misc (`ad\b` never matched the plural). Only the
   free-text fallback is affected — capture forms pin their head — but the New Journal
   Entry head IS free text. Both patterns word-bounded identically in `ledger.js` and
   `LedgerService`, re-verified across all 46 real category strings: **0 mismatches**.

**Tests: 12 → 65.** New `SaleAndReceiptPostingTest` (17) · `InterCompanyPostingTest`
(12, asserting BOTH legs and that 1300 + 2400 still net to zero across the family after
every flow) · `LedgerServiceTest` (11, the ledger's own invariants) · `TravelsMoneyApiTest`
(13, over HTTP: routes, validation, clean 422s, JSON shapes) · shared
`tests/Support/BuildsMoneySchema` so all posting tests reason about ONE definition of
the books. Verified: **sweep 234/234 × both themes 0 errors** · trial balance balances ·
`route:list` shows all 16 money routes. Commits 30ec511, c123072.

**Note — the frontend still posts through the per-store endpoints** (`acc_entries`,
`gl_entries`, `banks`), not these new ones. That is deliberate: wiring the SPA to them
means async save paths, and it would double-write while both routes are live. These are
the production posting API the Laravel rebuild targets, and they are now proven.

### T-CONS-GROUPHQ — the consolidated TRIAL BALANCE now includes Group HQ (fixed 2026-07-27)
Flagged earlier as "the owner's call" because it moves numbers on the Consolidation
screen; closed now that the owner said finish what's left.
**Was:** `consolidatedTrialBalance()` covered the operating companies only. Group HQ
carries real postings — its own overheads, cash it lends a concern (1300), shared costs
it pays in full — so the concern's half of those sat INSIDE the consolidation while the
counterpart sat outside, and **the group column did not balance** (reproduced: out by
৳1,00,000 from a ৳40,000 group-funded expense + a ৳60,000 group-paid shared cost).
**Now:** it uses the SAME entity list as `consolidatedPnl()` (`consolidatedEntities()` =
present concerns + Group HQ), so both statements always agree on who is in the group and
both sides of every inter-company pair are in one table. Elimination is unchanged.
**Visible change:** a **Group HQ column** on Consolidation; the KPI reads "Entities
Consolidated · concerns + Group HQ"; `pnlEntities()` no longer appends Group HQ twice.
**Verified:** out-by **0** with those same postings (dr = cr ৳23,55,39,498); bridge
invariant still matches; sweep 228/228 × both themes 0 errors; trial balance balances.

### T-DEPLOY-MIGRATE — deploy.sh now reports pending migrations (fixed 2026-07-27)
The schema ships with the code but `deploy.sh` stopped at step 6, so a deploy could leave
new columns unmigrated while the new code expected them — that is what made a working
expense form answer **"Save failed"** on the live host (twice: `bank_transactions`, then
`acc_entries`' payment-source columns). New **step 7/7** always REPORTS pending
migrations and runs them only when asked: `./deploy.sh --migrate` (or `MIGRATE=1`). Not
automatic on purpose — `migrate` alters a live financial database; that is a decision,
not a side effect of copying files.

### T-BLANK-APP — 🩹 a hidden folder blanked the WHOLE app (found 2026-07-27, fixed)
**Symptom:** every route rendered empty — shell fine, `#view` empty, **no console error**.
Hit while the Woodart *materials* module was half-built (its parent manifest already said
`built:true` before `modules/materials/module.json` existed).

**Root cause — nothing to do with Woodart.** `App.renderShell()` does `root.innerHTML=''`
and rebuilds, so **`#view` becomes a NEW element**. Only the boot path re-pointed
`EPAL.router.mount` at it. The other two callers — `auth:changed` and the
**auto-discovery** callback (`if (d.changed()) { renderShell(); router.render(); }`) —
left the mount pointing at the OLD, detached `#view`, so every later render wrote into a
node that is not on the page. Blank app, silent.

That made the migration's headline feature self-destructive: **delete a module folder and
discovery correctly hides it — then blanks the app.** Same for any login/role change that
fires `auth:changed`.

**Fix:** `renderShell()` now owns the mount (`EPAL.router.mount = $('#view')` at the end),
so no caller can forget it. Verified against the exact repro (half-built module in a clean
worktree: blank → full render) and on the live working tree: **sweep 225/225 × both
themes, 0 errors** — including the other session's new module.

**Note for whoever half-builds a module next:** flipping `built:true` in the company
manifest before the module's own `module.json` exists is legitimate mid-work; discovery
hides it and the app now stays up.

### T-SALE-CHAIN — "I sell a ticket: does it record EVERYWHERE?" (owner review 2026-07-27)
Owner: *"i will review the accounting of travel, if works everywhere. like i do a sell
in ticketing, if its recording or going everywhere automaticly … travels accounts,
journals, ledgers, transection, bank manage, cash manage, pnl, then groups master
accounts, finance."* Audited with a real posted sale
(`scratchpad/audit-sale-chain.mjs`), then fixed what was missing.

**Already worked:** sales store · journals (GL) · ledgers (TB + P&L) · group master
accounts + Group Finance consolidated P&L · trial balance stayed balanced.

**Was BROKEN — now fixed:**
1. **Manage Banks / Manage Cash never moved.** A sale or a receipt debited "1010" in
   the abstract: no named account, so no balance change and no row in any account's
   history. `db.settleSale(…, opts.bankId)` now books to the CHOSEN account's own GL
   side (a **cash box IS hard cash 1000**, not Bank) and moves its register through
   `EPAL.pay.syncRegister`. Ticketing's **Mark Paid** now asks "received into which
   account?" via the new shared `EPAL.pay.ask()` prompt; Mark Due reverses it.
2. **Ticket sales were invisible in Travels ▸ Accounts ▸ Income.** That register read
   only `acc_entries` (hand-typed money) while a ticket/visa sale posts straight to the
   ledger. Now folded in on the READ side from the sale journals (no second copy → it
   cannot double-count), tagged `Sale`, with edit/delete pointing back to the owning
   module.

**Verified:** unpaid ticket → Receivables; Mark Paid → GL `1010 DR / 1200 CR`, AR
cleared, account balance ৳5,00,000 → ৳5,60,000, `deposit:60000` in its history, books
still balance; a **cash box** receipt posts `1000 DR15000` and the box goes ৳20,000 →
৳35,000; the Income desk lists the sales. Sweep 222/222 × both themes, 0 errors.

**STILL OPEN (one gap left):** a sale created with `payStatus:'Paid'` **at the moment
of sale** (the EMD form, and visa where it does the same) still books to an abstract
1010 with no named account, so those skip the register. The fix is the same
`EPAL.pay.ask()` prompt on those two forms — small, but it touches two more modules,
so it is left for the next pass rather than rushed in unverified.

### T-EXP-CARDS — remove the Salary + Office Rent quick cards (owner screenshot)
**Reported:** 2026-07-26, screenshot of the live Record Expense modal with
**Staff · Salary & Wages (5100)** and **Office Rent (5200)** crossed out in red.
**DONE (this commit):** both are gone from the card grid (`card:false` in
`TV_EXPENSE_CATS`) — salary belongs to the **Payroll** desk and rent is entered once
at **Group HQ › Shared Cost** and split, so a card here invited double-booking. They
are still reachable in the whole-account search (`5100 · Staff · Salary & Wages`,
`5200 · Office Rent`, plus their items) and picking one now shows a warning naming the
desk that owns it — nothing became unpostable, only the shortcut is gone. 8 cards left.
Verified by a headless drive: 20/20.

### T-EXP-LIVE — "the expense is not working yet as I have wanted" ❓NEEDS DETAIL
**Reported:** 2026-07-26, same message as T-EXP-CARDS, no specifics yet.
**Found + fixed while investigating (this commit):** a real deployment hazard —
`AccEntryService` and `ExpensePostingService` wrote the NEW `bank_id` / `bank_name` /
`pay_acct` columns unconditionally. On a host that pulled the code but has **not run
`php artisan migrate`** (which is the live host today) every save would hit "unknown
column", the client would roll its optimistic row back and the user would see
**"Save failed"** — a working feature looking broken. Both now write those columns
only when they exist (`Schema::hasColumn`, instance-cached), so the expense records
either way and starts carrying the account the moment the migration runs. New test:
`test_it_still_records_on_a_database_missing_the_payment_columns` (12/12 suite).
**Still open:** ask the owner exactly what "not working" looked like — no accounts in
the "Paid from" list, a save error, or the numbers not moving.

### T-EXP-SOURCE — Record Expense: real accounts + whole-chart search + full propagation
**Reported:** 2026-07-26, screenshot of `#/travels/accounts/expenses` with the
**Record Expense** modal open and the **“Payment method” select circled in red**
(it showed only `Bank`). Three asks, then a fourth:
1. That field must list **all the accounts** — every bank, plus cash and petty cash —
   ordered **Travels' bank first, then cash**.
2. The account head must work **both ways**: the ten cards above are too few, so it
   must also be pickable from the **whole account list**, expense codes first,
   **searchable by title** ("tea for guest", "tea for office").
3. An expense must record **everywhere it connects**: the Travels expense history,
   the journals/ledgers, the **bank or cash account it was paid from** (balance
   deducted + in that account's transaction history), and — when another concern
   funded it — as a **loan Travels owes**, reflected in the Group's Master Accounts.
4. Backend in **real Laravel**: proper controller, readable and usable by a dev.

**DONE 2026-07-26 (this commit).**
- **Paid from (bank / cash account)** replaces "Payment method": the real accounts
  from Manage Banks (bank → cash box/petty cash → wallets/cards), and it **follows
  "Funded by"** — another concern's money offers THAT concern's accounts, because
  that is whose account the cash leaves. The 7 generic methods stay at the end of
  the list, labelled "no registered account", so a cheque/card spend with no
  registered account is still recordable (nothing removed).
- **"Or search the whole account list"** beside the cards: every chart code with
  expense heads first, then each head's items, then the rest of the chart. Typing
  "tea" finds *Tea / Coffee (Guest)* and *Tea & Coffee*; picking an item lights its
  card **and** its chip, and clicking a card fills the field back. Non-expense codes
  are pickable too (owner asked for the whole list) with a note that they land on
  the balance sheet.
- **Propagation:** register (`acc_entries`, now carrying `bankId`/`bankName`/`payAcct`)
  → GL (`GL-ACC-…`, plus `GL-ACF-…` on the funder's books) → the paying account's
  **balance + a withdrawal row** in its history (through the shared `bankTxnApply`)
  → the group bridge `expense.recorded` event. An **edit** posts an adjustment row
  and a **delete** posts a reversal row + flags the original — balances never change
  without a row explaining why.
- **Laravel:** `ExpensePostingService::record()/void()` (kernel) does all three
  books in ONE transaction; `LedgerService` is now THE poster (JournalController
  delegates to it, same HTTP contract); `BankRegisterService` is the server twin of
  `bankTxnApply`; `ExpenseController` + `StoreExpenseRequest` are the Travels HTTP
  surface (`GET|POST /api/travels/accounts/expenses`, `GET …/expenses/form`,
  `DELETE …/expenses/{voucher}`). Two migrations. **9 feature tests** in
  `platform/backend/tests/Feature/ExpensePostingTest.php` (11/11 suite green).
- **Verified:** boot sweep 222/222 routes × both themes, 0 console errors; a
  headless drive of the modal — 18/18 assertions — proved the ordering, the "tea"
  search, both-ways sync, the funder re-filter, the GL legs, the balance deduction
  and the inter-company legs on both books.
**FOLLOW-UPS ALSO DONE 2026-07-26** (owner: "push, then solve, then again push") —
the three items left open above are closed:
1. **`bank_txns` persistence is now self-healing.** `BankTxnController@index` reports
   `provisioned: true|false`; `platform/data/api.js` hydrates the log ALWAYS and
   promotes it into `WRITABLE` only when the server says its table is really there
   (new `CONDITIONAL` map). So the log starts persisting BY ITSELF the moment
   `php artisan migrate` runs — no redeploy — and there is no save-fail → re-render
   loop if it never does. It also `console.warn`s the gap instead of hiding it.
   Proved with a stubbed load of the real api.js: 8/8 across both branches.
2. **New Journal Entry** (Travels, income AND expense) now uses the account picker
   too: an Income entry ADDS to the chosen account (deposit row), an Expense takes
   it out, and moving an entry to a different account refunds the old one in full and
   charges the new one — two honest rows, never a silent balance swap.
3. **Master Accounts › Operational Expenses** and the **Shared Cost** desk got the
   same picker: the account list follows *Company* / *Paid by*, the spend moves that
   account's balance + history, and for a shared cost the PAYER's account loses the
   FULL bill (one register row) while the other concerns just owe their share.
   Also fixed: with the desk scoped to "All companies" the picker was offering only
   the generic methods (an `'all'`/unset scope is not a company — it means Group HQ).

**One implementation:** the helpers moved into the platform cash kit as **`EPAL.pay`**
(`platform/kit/cash.js`) — `options/resolve/stamp/syncRegister/reverseRegister` — used
by Travels Accounts and both Master Accounts desks, so a fix can't land in one and
drift in the other. `EPAL.formModal` gained `onReady(form)` for dependent fields.
**Verified:** sweep 222/222 × both themes, 0 errors; trial balance balances; PHP 11/11;
headless drive of all three screens **20/20** (including Dr−Cr = 0 for travels, group
and woodart after every posting).

### T-BANKS — condense the Manage Banks summary block (space utilization)
**Reported:** 2026-07-22, screenshot of Master Accounts › Manage Banks › Group HQ.
Owner: the four KPI tiles "take too much space for their little info."
**DONE 2026-07-22 (3e4ce52):** the 4 tiles (Total Balance/Accounts/Active/Scope) in
`banksView` became ONE company-branded **banking-summary panel** — company-hue rail +
gradient icon + soft glaze; company heading, hero balance, and Accounts/Active/**Last
transaction** facts (Last transaction is new = newest bank_txn or ledger 1000/1010
movement). Left-aligned by design — owner is reserving the right gutter for planned
content. New `.bank-summary` CSS in components.css. Verified: banksView driven +
screenshotted both themes (0 console errors), sweep 222/222.
**Deferred (owner's call, not yet requested):** reconciliation-card collapse-when-clean;
compact empty-state prompt; rolling the same panel to the Overview all-companies view
and/or the other Master Accounts sections (Cash/Payroll/Schedules/etc. still use the
old KPI tiles). Owner said "first do what I said" + keep dead-space ideas in mind.

---

## 📊 REFERENCE-ADVANTAGE LIST (deep-enhance initiative — gaps vs epal_erp_soft)

> Running list of where the reference ERP does MORE than ours, per section. Built by
> screenshot→analyze→reference-compare. Apply additively (never delete our leads).
> Section 1 of N: **Manage Journals** (analysed 2026-07-22).

### Manage Journals — verified gaps (ranked)
1. **[high·L] Per-line PARTY attribution** linked to real customer/supplier/agent/vendor
   records. Ref: `journal_items.party_type/party_id` + morph relations. Ours: lines are
   `{account,dr,cr}` only; entry-level party is a free-text string. Adopt: optional
   `party {type,id,name}` per ledger line (additive) + searchable party select in the
   opening/journal posters. Unlocks #2.
2. **[high·M] Party Voucher** — per-party printable (party contact block, that party's
   net, party signature line), distinct from the company JV. Depends on #1. Ours has only
   the generic `journalVoucherPrint`.
3. **[med-high·M] Edit/Delete manual journals from the desk**, strictly guarded to
   `source==='manual'` (system/sale/opening/payroll/reversal stay immutable). Ours desk is
   view+print only. Delete should post a reversal (reuse `EPAL.ledger.reverse`).
4. **[low-med·S] "Created By" as a list column** — we already store `by`; just add the
   column to the master `journalsView` table.
5. **[med·L] Chart-of-Accounts hierarchy** (parent/child, system-account protection).
   Ours COA is flat with a free-text `group`. Lower urgency (group already buckets TB).
6. **[low-med·S] Reversal back-pointer + explicit "Reverse" button.** We stamp
   `orig.reversedBy` but not `reversalOf` on the REV- entry, and there's no Reverse action
   in the journals UI (only implicit on quick-entry delete).

**OUR LEADS over the reference (do NOT regress/duplicate):** BD VAT/AIT tax cycle in
journals + NBR deposit; group multi-company journals + consolidated TB with inter-company
elimination; CSV/PDF export + live source-filtered totals; reversal-on-delete immutability;
engine-enforced period locks; full N-line manual poster with live Dr=Cr guard.

**Recommended apply order:** 1 → 2 → 3 → (4 & 6 quick polish) → 5. All additive; none touch
the `ledger.post` balancing invariant. **STATUS: analysed, awaiting owner go-ahead to build.**

---

<details><summary>T5 — searchable account select ✅ DONE</summary>

### T5 — searchable / type-to-filter account select (the Credit/Debit journal pickers)
**Reported:** 2026-07-21, screenshot of the "Credit Journal — Money In" modal, "Credit
account" dropdown (2000 · LIABILITIES … a long chart-of-accounts list).
**Owner likes** the current select; wants it **type-to-search**: when you type a number
(account code) or text, matching accounts jump to the TOP / filter the list.
**Scope:** the account-code selects in the Credit/Debit journal forms (Master Accounts).
Ideally the shared select control so it benefits everywhere.
**Done:** added a shared, opt-in combobox to `platform/kit/forms.js` (`makeCombobox`,
enable with `searchable:true` on any select). Wraps a hidden native `<select>` so the
form value contract is unchanged; type to filter, matches sorted to the TOP (starts-with
first), arrow/enter/esc keys, click-outside close. Enabled on the Credit/Debit + journal
account pickers. `.combo*` CSS in components.css. Verified visually (typing "21" floats
2100/2110/2111) + sweep 222/222.

</details>

<details><summary>Completed T1 / T2 (kept for context)</summary>

### T1 — Inner module nav (tab band) must fit ONE line at 90–100% zoom ✅ DONE (4436e7a)
**Reported:** 2026-07-21, screenshot of `dev.epal.com.bd/#/travels/air-ticketing/purchase`.
**Screenshot:** the Air-Ticketing tab band (Overview · Ticket Manage · Ticket Purchase ·
Ticketing · Manage Sales · EMD & Ancillary · Ticketing Deadlines · Re-Issue & Void
Register · Setup) wrapped to a SECOND line for **BSP / ADM Recon** and **Refund Tracker**
(both circled).
**Want:** at 100% and 90% zoom the inner nav (`.tab-underline`) must be on ONE line,
shrinking the tabs' size to fit the row. Only at 110%+ zoom may it wrap to more rows.
**Scope:** ALL inner navs of ALL modules of ALL companies (global fix).
**Approach:** JS auto-fit — measure each `.tab-underline`; if it wraps, shrink
font/padding via CSS vars until one line fits or a readable floor is hit (then allow
wrap = the high-zoom case). Drive it after every route render + on resize/zoom.
Files: `platform/design-system/css/base.css` (`.tab-underline`), a fit routine in
`platform/core/app.js` (or router post-render hook).

### T2 — Group sidebar section dividers ✅ DONE
**Reported:** 2026-07-21, screenshot of `#/group/dashboard` (Group Command Center).
**Screenshot:** the GROUP sidebar with red underlines marking dividers AFTER: **Sister
Concerns**, **Group CRM**, and **Document Center**.
**Done:** tagged `companies` / `crm` / `documents` with `sectionEnd:true` in GROUP_MODULES;
dividers render at all three boundaries. Sweep 222/222, screenshot confirmed.

</details>

## ✅ DONE (this session, 2026-07-21)
- **T6** instant client-side duplicate-account_number check on bank save (7a65fab).
- **T7** searchable combobox auto-enabled for all long selects app-wide (1eccb4f).
- **T8** carried the premium card treatment into the per-company + detail views —
  extracted a shared `renderBankCardGrid`, added cards to `banksView`, and branded
  the bank-detail header in the bank's own hue.
- **T1** inner tab-band one-line auto-fit (4436e7a).
- **T2** Group sidebar dividers (Sister Concerns / Group CRM / Document Center).
- **Bank add fix VERIFIED** end-to-end (local PHP+MySQL, 16/16) + follow-up c3484c6.
- **T3** bank-account statement header — smaller, premium `.stat-compact` values.
- **T4** bank account CARDS — **world-class redesign** (v2 after owner feedback):
  brand accent rail + gradient identity chip + status dot, display-font name,
  refined Active pill, CURRENT BALANCE hero, mono A/C, hairline footer, hover
  lift + brand-tinted shadow + light sweep. Per-bank `--bank-hue`. Both themes.
- **Local backend now runnable/testable** (PHP 8.3 + Laragon MySQL 5.7 + composer install).

## 🔧 PARTIAL (leftover)
- **Laragon polish:** `php` works in a NEW terminal (winget PHP 8.3 on User PATH) and
  the backend boots/tests. Making `php` resolve in Laragon's own cmder + adding to the
  Machine PATH needs an ADMIN prompt; Laragon Apache failed on port 80 (separate). Not
  blocking — backend runs fine via `php artisan serve` / direct boot. Revisit if wanted.
- Bank add duplicate-account_number failure — fixed backend + frontend + delete-tombstone,
  pushed (6fd8054). Needs a live test after deploy.
- Sidebar (Travels): reference text size + item spacing + dividers at My Task /
  Passport Mgmt / Analytics — pushed.
- Frontend rebuild: Marketing module → template + logic, parity 8/8 — pushed (cddc157).
- New machine bring-up (Node/Git), repo reconnected to origin.

## 🆕 QUEUED 2026-07-28
- ✅ **Woodart Accounts (module #8)** — DONE 2026-07-28 (e0b1169). Was: Model + AccountsService committed
  (`AccEntry` model, register / payables / project-P&L). Remaining: controller, routes,
  Request, Resource, module.json, README, context.md, frontend (template/api/logic),
  registration in platform/core/config.js + index.html. Blocked point: the income leg
  must go through the RIGHT kernel service — ExpensePostingService covers expenses,
  income is ReceiptPostingService or SalePostingService. Wrong pick posts revenue to
  the wrong account in LIVE books, so read both before wiring.
- **Interiors layout + style to match Travels** — owner request 2026-07-28.
  SCOPE CONFIRMED by the owner, three of four:
    1. **Page chrome & layout** — page head, breadcrumb, tab band, KPI row, card grid
       rebuilt to the exact Travels markup structure.
    2. **Density & typography** — font sizes, row heights, card padding, spacing.
       Woodart currently reads larger/airier than Travels.
    3. **Colour & accents** — badges, KPI icon tiles, progress bars, chart palette,
       aligned to how Travels uses the shared brand tokens.
  ❌ **NOT the background atmosphere** — the owner keeps the Woodart interior scene
     (cornice, pendant rail, drifting swatches). Do not touch `app/atmosphere/`.
  Method: this is a CONVERGENCE onto `platform/design-system/UI-CONTRACT.md`, not a
  redesign — the contract already mandates one universal look, so the work is finding
  where Woodart diverged. Travels is the reference implementation. Take a before-shot
  of every Woodart screen first; the parity harness proves only what we intend to
  change actually changed. Do AFTER accounts #8.

## 🆕 2026-07-28 — PAYROLL COMMAND CENTRE

- ✅ **DONE — payroll rebuilt to the Manage Banks design language.** Owner ask: the banks
  KPI/structure/style in Payroll, monthly reports that drill to every employee's figures,
  search by name AND employee ID, a full employee file, plus automation/AI/brief. Shipped:
  the shared four-card dashboard row (`[data-shell="dash"]`), a new **Overview** tab
  (digest · Autopilot proposals · Anomaly Radar · Monthly Register · department cost), the
  **month drill** (23-column salary register + that month's money movements + ledger
  postings), a new **Staff Accounts** tab, and the dashboard row on Salary Manage. One
  implementation, so it lands identically in Master Accounts › Master Payroll, Travels ›
  Accounts › Payroll, Woodart › Accounts › Payroll and the standalone routes.
  Verified: sweep 253/253 × both themes, tw gate green, trial balance balances, plus a
  21-check headless driver. Full write-up in CONTEXT.md.
- ◻ **NEXT on payroll (not started):** deepen the employee dossier
  (`platform/kit/emp-profile.js`) — the owner wants "everything possible" on one employee:
  it already has the ledger with running net-due, payslip history, loans/advances,
  attendance and the settlement action; what is missing is partial-payment history per
  month, an encashment timeline, and a print/export of the whole file.
- ◻ **Laravel read endpoints** for the Overview/Monthly Register. No new tables needed —
  they read `pay_runs`/`pay_slips`/`pay_txns` which Master Accounts' payroll backend
  already persists.
- ⏸ **Interiors layout + style to match Travels** (queued 2026-07-28, above) — still
  pending; the owner interrupted with the payroll work.

## 🆕 2026-07-29 — SALARY TEMPLATES (owner screenshot of the group's Salary Templates List)

- ✅ **DONE (a7a5d4b).** Owner: "in payrolls salary template, make it like this, where saved
  template for individual employee will appear here, can be edited or modified, can turn on
  OT here, or Deduction as Punishments" + "option to make new template".
  Shipped on Payroll › Salary Template, above the untouched Structure card: the
  **Salary Templates List** (name · basic · house rent · medical · conveyance · other ·
  bonus · total · overtime · punishment, one row per employee, searchable by name OR
  employee ID, exportable) with **Add New Salary Template** and four row actions —
  edit · overtime on/off · punish · delete.
  **The template is the pay:** an employee on one is paid its total, split exactly as it
  says (new store `pay_salary_tpl`; tax/PF/absence/encashment still from Structure).
  Overtime = a switch + its own optional ৳/hour. Punishment = a standing monthly fine AND
  a one-off on a single month, both printed on the payslip with their reason.
  Seeded DERIVED from real staff, so opening the tab moved **zero** existing figures.
  Full write-up + the two defects the probes found in CONTEXT.md.
- ◻ **Backend not written** for `pay_salary_tpl` (local-only until its Laravel slice —
  `salary_templates` + a `salary_template_employee` pivot).

## 🆕 2026-07-28 — PAYROLL UI/UX RESEARCH → BUILD BACKLOG

Owner asked for research into how other ERPs do payroll UI/UX, a comparison against
ours, and a list of what to add. Full write-up: **`docs/PAYROLL-UIUX-RESEARCH.md`**
(SAP PCC · Workday · Oracle Fusion · ADP · Gusto/Rippling/Deel · Keka/greytHR/Zoho ·
ERPNext). Owner said **"ok"** to queueing Wave 1 and starting it one item at a time.

**Where we already lead** (do NOT regress): the Payroll ↔ Ledger reconciliation card
with its month-by-month "why?" explainer; the narrated digest; Autopilot as
proposals-with-buttons that never posts by itself.

**The four waves** (full detail + data-availability tags in the research doc):

- **Wave 1 · free wins** — presentation only, no engine change, using design-system
  pieces that already exist and chart code already loaded.
  - ✅ **1a · rich KPI cards — DONE 2026-07-29** (was blocked 07-28 while a concurrent
    session held `payroll.js` for the Payroll History feature; rebased on top of it
    once that landed in c6e79f5).
    The flat `kpi()` tile (label · icon · figure, nothing else) is retired; every
    caller now builds `[data-shell="kpitile"]` — figure + **trend pill vs last month**
    + **context foot line** + **sparkline**. Same markup as the group dashboard's
    `kpiTile()` so the two cannot drift.
    **The rule that shaped it: a sparkline's LAST point must equal the figure printed
    above it.** So the series are month-end walks over the events that actually moved
    each balance (`balanceSeries` / `headSeries` over `loanEvents()` / `advanceEvents()`),
    mirroring the engine's `loanOutstanding()` / `advanceOutstanding()` line for line,
    with anything older than the 12-month window folded into the opening balance.
    · **Reports gets NO spark band, on purpose** — leave-encashment liability comes
      from `leaveState()` (accrued days × today's rate) and does NOT reconcile to the
      only stored history (Σ`slip.encashAmt`); Salary Due needs accrual dates the slip
      does not keep. Two of four unprovable, and a half-sparked row reads broken, so
      all four get trend pills + foot lines instead.
    · **Latent bug fixed on the way:** Loan/Advance `disbursed`/`given` summed a
      **companyId-filtered** txn list while `totalOut` summed a **team-filtered** one —
      and "Repaid = disbursed − totalOut" subtracted across the two bases. Both now
      read one event list. The transaction TABLES still use their own list, unchanged.
    · Charts are tracked **locally** (`myCharts`/`killCharts`) and killed in the
      embedded desk's `draw()`: `charts.destroyAll()` only runs on a route change
      (`router.js:82`), and a blanket call here would kill the host page's charts.
    **Verified:** sweep 253/253 × both themes 0 errors · tailwind gate green · trial
    balance balances · 19/19 headless driver asserting each spark's last point against
    the engine's own figure, and 0 orphaned Chart instances after three tab redraws.
    ⚠ **Found while testing — pre-existing, NOT fixed:** `payroll` is registered as a
    view for five companies (`travels/payroll`, `woodart/…`, `it/…`, `shop/…`,
    `construction/…`) but is **not a module in `platform/core/config.js`**, so every
    standalone `#/<cid>/payroll/<tab>` route 404s. The desk is reachable only embedded
    (Master Accounts › Master Payroll, `<co>` › Accounts › Payroll). The module header
    still claims it renders standalone. Registering it is a navigation change and per
    CLAUDE.md needs both config.js and module.json — **owner decision.**
  - ✅ **1b · department doughnut — DONE 2026-07-29** (`e07835f`). Beside the
    existing table, fed the SAME rows in the SAME order so slice N and row N are
    the same department. **Legend off on purpose** — the table already names every
    department and its share. Removed (not hidden) when there is nothing to draw.
  - ✅ **1c · payment-progress meter — DONE 2026-07-29** (`e07835f`). On the Salary
    Manage run card. Appended by JS rather than added to the `[data-tpl="run-card"]`
    fragment, which is one of the ORIGINALS whose pixels must not move. The
    `.meter` `lvl-*` scale is risk-coloured and reads correctly once you see what
    is metered: **unpaid salary** — all paid = `lvl-low` = green.
    Both verified 13/13 (ring == `departmentCost()` in order; meter width 33% =
    paid ৳1,20,844 of ৳3,71,101 with the matching lvl class) · sweep 253/253 ×
    both themes · tw gate green.
    Adds **`frontend/payroll.css`**, the module's first stylesheet (the build picks
    up `frontend/<id>.css` automatically). Only what has no house equivalent lives
    there — everything else still uses `.kpi-card` / `.meter` / `.card` / `bank-*`.
  - ✅ **1d (half) · FROZEN IDENTITY COLUMN — DONE 2026-07-29** (`a6887df`).
    Pure CSS in `platform/design-system/css/base.css`, scoped to `.tbl-dense`,
    which ONLY Payroll applies — no other table in the app is touched. The dense
    rule is "fit, don't scroll", but the 24-column Salary Register gives up at a
    narrow window or 110%+ zoom, and scrolling right stranded the figures with no
    way to tell whose they were. Every `.tbl-dense` table leads with WHO or WHICH
    MONTH, so that column now stays put. Purely progressive — at a wide window
    there is 0px of overflow and the rule does nothing. Edge is a box-shadow, not
    a border, so border-collapse layout and measured widths are untouched.
    **Verified:** sweep 253/253 × both themes · tw gate green · 10/10 driver
    (forced 395px of overflow, scrolled 220px, identity cell stayed flush at the
    wrap edge while column 2 moved 182px → −38px; z-ladder corner 3 > cells 2 >
    thead 1; inert at a wide window).
  - ⛔ 1d (other half) · column groups (Earnings │ Deductions │ Recovery │
    Settlement) — needs an optional second header row in `platform/kit/datatable.js`
    (uncontested) *plus* a `columns[].group` wiring in `payroll.js` (contested).
    Not started: shipping the datatable half with no caller would be dead code.

  ✔ The concurrent-session block that held 1a/1b/1c cleared at 11:41 when the
  **Salary Templates** slice landed (`a7a5d4b` + `5c90096`). 1b and 1c were built
  straight on top of it. **Only 1d's column groups remain open in Wave 1.**

## 🆕 2026-07-29 — OWNER: DEMO DATA + ADVANCE-SALARY REQUESTS

Two tasks, given together. Doing them in order, one at a time.

### T-PAY-DATA — Jan 2026 → today, every scenario, all of it logical ✅ DONE 2026-07-29 (4ee897e)
Owner: *"give some demo realistic data, from january 2026 to present real time,
with all scenario, employee based deduction, bonus, attendances, etc. All should be
functional, and logical data. like someone taken a loan, his next month payroll
should deduct the EMI automatically, an employee can also repay the loan at once."*

Extends `platform/kit/sample-payroll.js`, which already drives the REAL engine
month by month (generate → finalize → pay) rather than writing fixtures — so the
books fill exactly as if the months had been run at the time. What it covers today:
a staff loan on 6 EMIs, an Eid bonus, one advance, one part-paid month, Jan–Jun.

**To add:** the current month (so it runs to *today*, not to last month) ·
per-employee **attendance** (absent / late / early-leave) feeding the automatic
deductions · **overtime** hours · **individual** performance bonuses on top of the
festival one · an occasional **other deduction** · and a **lump-sum loan
repayment** (`repayLoan`) beside the EMI-amortised one, because the owner asked for
both ways of clearing a loan.

**Two engine facts that decide the shape:**
1. `generate()` reads `attendanceFor(empId, ym)` when it creates a NEW slip — so
   attendance must be written BEFORE the first generate, and then the absences are
   baked in with no correction-window fight.
2. `adjustSlip()` recomputes the slip from the `adj` it is handed, so a partial adj
   (just `{overtimeHours}`) would silently WIPE the attendance. Always pass the
   full set.
⚠ **Determinism:** the boot sweep must stay reproducible, so no `Math.random()` —
variety comes from a hash of `empId + ym`.
⚠ **Idempotency:** never adjust a run that is already finalized; that would move
slips out from under postings the ledger has already made.

### T-PAY-ADVREQ — advance salary becomes a request the boss approves ✅ DONE 2026-07-29
Owner: *"in the advance salary option, employees' advance salary request option
will appear, boss will allow or disallow, also can customize the amount. For which
month advanced — that should indicate."*

So: an employee raises a REQUEST (amount + which month it is against + reason);
the approver sees it pending and can **approve / reject / approve-for-a-different-
amount**; approval is what actually disburses (today `EPAL.payroll.advance()` fires
straight away with no ask). The month it is advanced AGAINST must be shown, and it
is a genuinely new field — the current advance txn has no target month.

**DONE.** New store `pay_adv_requests`; engine gains `advRequests` / `advRequest` /
`requestAdvance` / `decideAdvance` / `nextYm`; the Advance Salary tab gains a
decision queue, an approve/decline flow and a decided-requests history.

**The three asks, and where each landed:**
· *"boss will allow or disallow"* → Approve / Decline on every waiting row.
· *"can customize the amount"* → Approve opens a form with the asked figure
  pre-filled and editable. **Both figures are kept** — `amount` is the ask, for
  ever, and `approvedAmount` is what was actually released. Overwriting the ask
  would erase the fact that a decision was made at all; the history column shows
  "৳6,000 of ৳12,000" when they differ.
· *"for which month advanced"* → `forYm`, a genuinely new field (the advance
  transaction never had one). Defaults to NEXT month, because that is what an
  advance is. Shown as a badge on the row, a column in the history, and written
  into the ledger memo: *"Advance salary · against August 2026"*.

**Approval is the only thing that moves money** — it calls the existing
`advance()`, so a request inherits the whole chain: DR 1250 / CR the named
account, the account's own register row, and automatic recovery from a later
payslip. Declining insists on a reason; a decided request cannot be decided twice.

Seeded with 2 pending + 1 declined under its OWN gate (`pay_advreq_seeded_v1`, not
seedDemo's — every existing browser already carries `pay_seeded_v3`, so anything
added there would never appear for anyone who has run the app before). **Nothing
is pre-approved**: approving moves real money, and the approved rows should be the
ones the owner creates.

**Verified 20/20** — approving 6,000 against a 12,000 ask moved advance outstanding
and ledger 1250 by exactly 6,000 while the ask stayed 12,000, the memo named the
month, the books balanced, and the three guards (no-reason decline, double
decision, zero amount) all refused. Sweep 253/253 × both themes · trial balance
balances · tw gate green.

---

**WAVE 1 IS COMPLETE EXCEPT 1d's column groups.** Next up is either that or Wave 2
(the real gaps — variance report, gross→net waterfall, cost bridge, run checklist,
pre-finalize gates). Wave 2 is where the distance to SAP/Workday/Oracle actually
closes; 1d is polish on a screen that already works.
- **Wave 2 · the real gaps** — employee-level variance report · gross→net waterfall ·
  month-over-month cost bridge · run checklist · pre-finalize validation gates
- **Wave 3 · control** — approvals (`EPAL.approvals` already ships a
  `salary-change → MD` rule, payroll references it 0 times) · audit trail
  (`EPAL.audit`, also 0 references) · bank advice file · YTD columns · bulk actions
- **Wave 4 · needs an owner decision** — statutory remittance rules (PF 2110 / tax
  2120 accrue and are never settled) · BD compliance dates · off-cycle / festival
  bonus run · employer PF for a CTC view · gratuity · the tab regrouping

⚠ **Known trap for anything in Wave 1–2 that adds a chart:** `charts.destroyAll()` is
called by `router.render()` only (`platform/core/router.js:82`). The embedded desk
(`EPAL.payrollDesk` → `deskRedraw`) redraws in place with no route change, so charts
must be tracked locally by the module and destroyed on redraw — a blanket
`destroyAll()` would also kill the host page's charts.

- ✅ **DONE — Payroll History (owner, same day).** Card under the Salary Sheet: one row per
  month (newest first) with staff paid / gross / net paid / outstanding / run status; the row
  opens every payroll transaction that month (salary payments enumerated per INSTALMENT from
  their journals, plus advances, loans, repayments, bonuses, encashment payouts) with a Print
  sheet; a transaction opens its own printable detail and the shared `EPAL.journalVoucher`
  when a validated posting exists. Three assumptions in the brief were false and are written
  up in CONTEXT.md (pay_txns stores no glId; a slip carries no bank name; a slip can hold
  several payments). An adversarial review then found a real double-count — `unpay()` keeps
  `payCount`, so reversed payments were listed and re-payment showed the money twice — plus
  eight smaller defects, all fixed and regression-tested against the live engine.
