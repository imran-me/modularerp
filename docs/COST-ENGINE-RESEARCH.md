# Making the system dynamic and cost-calculative — research, analysis, proposals

**Date:** 2026-07-29 · **Status: PROPOSAL ONLY. Nothing here is built.**
Owner asked for research → analysis → suggestions on UI/UX and features that make
the system more *dynamic* and *cost-calculative*. Every claim about our own code
below was checked against the source, and every proposal is tagged with whether the
data already exists — so nothing here quietly invents a number (R8).

---

## 1 · The one-sentence finding

**The system records money beautifully and calculates cost barely at all.**
Every taka that moves lands in a balanced ledger with a named account and a real
bank behind it. But almost nothing can answer *"what does one of these actually
cost us?"* — one ticket, one square foot, one job-day, one employee-hour. Gross
margin is visible in several places; **true cost per unit is visible nowhere**,
because the overheads that make up most of the difference never reach the thing
that earned the money.

---

## 2 · What we already have (better than it looks)

Credit where it is due — this is not a blank page.

| Vertical | What already computes cost | Quality |
|---|---|---|
| **Interiors (Woodart)** | `estimates` compares **every quoted unit cost against the live Materials register** and flags *drift*; a **Costing** screen literally titled "which quotations actually make money"; margin % per quotation with a tone that changes when it should worry you | **The strongest costing in the repo.** This is the model the others should copy |
| **Construction** | BOQ cost + work-order material + work-order labour = `realCost`; certified value; retention held | Solid job-cost skeleton, but the inputs are hand-typed |
| **Travels** | Every ticket / visa / contract flight carries `cost` and `sale`; COGS posts **DR 5000 / CR 2000 at the moment of sale**, guarded against double-posting | Real gross margin per sale, correctly on the books |
| **Shop** | Products carry cost and price; warns when a sale price is below cost | Basic but honest |
| **Group** | Shared-cost allocation across concerns by **% split**, inter-company 1300/2400 both legs, budgets per expense head, consolidated P&L and trial balance **including Group HQ** | Genuinely good group plumbing |
| **Payroll** | `departmentCost()` — monthly salary cost by department | Reporting only; see the gap below |

The accounting spine is sound: one `ledger.post()`, balanced or refused, reversals
rather than edits, period locks, and inter-company pairs that net to zero. **A
costing layer can be built on top of this without touching any of it.**

---

## 3 · The four places cost truth breaks

### 3.1 Overheads never reach the thing that earned the money
Verified: `5100 Salaries` is touched **only** by payroll and the group employee
screen. No ticket, job, project or product absorbs a single taka of salary, rent
or utilities. They sit as period costs at the bottom of the P&L.

Consequence: a job shows a healthy **gross** margin, and the year shows a thin
**net** margin, and nothing in the system connects the two. That is the single
biggest reason a business that looks profitable per job is not profitable per year.

### 3.2 Nothing measures a unit
There is no cost per ticket issued, per visa file, per square foot installed, per
project-day, per employee-hour. Totals exist; **rates do not**. Without a rate you
cannot price confidently, compare two jobs, or notice one getting worse.

### 3.3 A journal line cannot say what it was FOR
A line is `{account, dr, cr}` (plus the entry-level `party` added recently). So the
books can answer "how much did we spend on marketing" but never "what did the
Dhaka–Jeddah route cost us", "what did this client cost to serve", or "which
salesperson's deals actually made money". **Profit cannot be sliced by any business
dimension** — the thing every ERP researched treats as the core of profitability
analysis (SAP calls it CO-PA / Margin Analysis, and it exists precisely for this).

### 3.4 Nothing is configurable, so nothing is dynamic
Rates, splits and assumptions live inside forms and code: the shared-cost split is
typed in every time, the payroll template is one flat structure per company, and
there is no place where "labour is ৳X/hour" or "overhead is Y% of direct cost" is
stated once and used everywhere. Nothing can be re-run under a different
assumption, so no question starting with *"what if"* can be answered at all.

---

## 4 · What the market does (and which parts are worth stealing)

| Practice | Who | Worth taking? |
|---|---|---|
| **Dimensions on the posting line** (customer, product, project, channel, region) so profit slices any way | SAP CO-PA / Margin Analysis, Dynamics | **Yes — this is the keystone.** Everything else in this doc gets easier once a line can say what it was for |
| **Activity-based costing** — overhead into pools, each with its own driver rate, charged only to what uses it | Textbook ABC, Acumatica, Dynamics | **A simplified version.** Full ABC is too heavy; two or three pools with honest drivers is not |
| **Committed cost tracked beside actuals** (PO raised but not yet invoiced) | Acumatica job costing | **Yes** — construction and interiors both need it |
| **Live pricebook driving the quote**, quantity changes upstream repricing downstream automatically | BOQ/estimating tools | **Already half-built in Woodart.** Generalise it |
| **Cost codes + budget versions, variance by code, role-based dashboards** | Job-costing ERPs | **Yes** |
| **Real-time recalculation** — price updates as options change, not after a "recalculate" button | CPQ / configurators | **Yes**, and cheap for us: the engines are pure functions already |
| **What-if simulation side by side with actual** | SAP's dual-model simulator | **Yes** — high value, low cost, because `computeSlip`-style engines can just be re-run |

---

## 5 · Proposals

Legend — **HAVE** = data exists · **DERIVE** = computable · **NEW** = needs a field
or a rule → **owner decision**.

### PART A · The costing spine (do this first — everything else leans on it)

| # | Proposal | Data | Why it matters |
|---|---|---|---|
| **A1** | **Cost dimensions on the ledger line** — extend a line to optionally carry `{ dim: { project, customer, route, product, dept, staff } }`. Purely additive; `ledger.post()`'s balance rule is untouched | **NEW** (one optional field) | The keystone. Unlocks profit-by-anything, and every report below is then a `groupBy` instead of a new subsystem |
| **A2** | **Cost objects registry** — one place that says "the things we measure cost against": a ticket, a visa file, a project, a job, a product line. Each gets an id that A1 can point at | DERIVE | Makes "per unit" a first-class idea instead of five different local conventions |
| **A3** | **Unit-economics engine** — cost per ticket, per file, per sq ft, per project-day, per employee-hour, with the denominator stated on screen (nothing is more dangerous than a rate whose denominator is hidden) | DERIVE + A1 | This is the literal answer to "cost calculative" |
| **A4** | **Contribution margin** everywhere a sale exists — revenue − *variable* cost, kept distinct from gross margin. The number that tells you whether one more ticket is worth selling | DERIVE | Currently we only have gross margin |

### PART B · Make the overheads land

| # | Proposal | Data | Note |
|---|---|---|---|
| **B1** | **Overhead pools + driver rates** — a small, honest ABC: 2–4 pools (staff cost, premises, admin), each with a driver (hours, headcount, floor area, transaction count) and a rate that recalculates monthly | **NEW** (the pools + drivers) | The one proposal that fixes §3.1. Deliberately small: full ABC is a project, three pools is a screen |
| **B2** | **Absorption posting, clearly marked** — allocated overhead posts to the job **and** to a contra so the statutory P&L is unchanged. Management view and statutory view stay reconcilable, which is the thing that goes wrong when people bolt costing onto a ledger | DERIVE | Non-negotiable design constraint: never distort the real books |
| **B3** | **Payroll → job labour cost** — payroll already knows what every head costs per month and per day (`perDay` is on every payslip). With hours or day-splits against jobs, real labour cost reaches the job instead of being typed by hand | HAVE (`perDay`) + **NEW** (the time split) | Construction/interiors type `laborCost` by hand today. This makes it true |
| **B4** | **Employee true cost** — gross + employer PF + bonus provision + leave-encashment accrual + overtime, per head per month, as the rate B1 and B3 consume | Partly DERIVE; **NEW**: does the company contribute PF? | Also the honest input to any hiring decision |

### PART C · Dynamic — configurable, re-runnable, live

| # | Proposal | Data | Note |
|---|---|---|---|
| **C1** | **Rate card** — one screen where every assumption lives with an effective-from date: labour ৳/hour by grade, overhead %, wastage %, markup by category, mileage, standard costs. Everything else reads it | **NEW** | This is what "dynamic" actually means in practice. Today these live in forms and code |
| **C2** | **Effective-dated rates** — a quote from March costs at March's rates; re-costing today shows the drift. Woodart's drift idea, generalised | DERIVE + C1 | Prevents the classic "why did last quarter's margin change?" |
| **C3** | **What-if simulator** — pick a lever (material +10%, labour +5%, a 15% increment, drop a route), see the impact side by side with actual, commit nothing | DERIVE | Cheap for us: the engines are pure. High perceived value |
| **C4** | **Live recalculation in the quote builder** — margin, markup and total update as a line is typed, with the floor price visible while you discount | DERIVE | Woodart is closest already |
| **C5** | **Break-even & sensitivity** — fixed cost ÷ contribution margin, per company and per vertical; "how many tickets a month before we are square" | DERIVE + A4 | One card, high value, needs B1 for the fixed-cost figure |
| **C6** | **Budgets that reach further** — today budgets are per group expense head. Extend to per company, per department, per project, monthly or annual, with variance | HAVE (pattern exists) | Reuses `setBudgetForm`/`budgetView` |

### PART D · UI/UX — the screens and the visuals

| # | Screen / visual | Where | Note |
|---|---|---|---|
| **D1** | **Cost Explorer** — one screen, pick a dimension (company · project · customer · route · product · department), get revenue, direct cost, allocated overhead, contribution and net, sortable and drillable to the postings | new, group + company | The payoff screen for A1. Drill must reach the journal, or it is just another dashboard |
| **D2** | **Margin waterfall** — Revenue → −direct → **contribution** → −allocated overhead → **net**, per object | Cost Explorer, project, job | The single clearest cost visual there is. Chart.js floating bars; no new library |
| **D3** | **Unit-economics tiles** — cost per ticket / sq ft / job-day, with the denominator printed under the figure and a trend pill (the KPI tile pattern already shipped on payroll) | every vertical | Reuses `[data-shell="kpitile"]` exactly as built |
| **D4** | **Committed vs actual vs budget** — three bars per cost code: spent, committed (PO raised, not invoiced), remaining | construction, interiors | Standard job-costing visual; stops the "we had budget yesterday" surprise |
| **D5** | **Cost-drift strip** — quoted vs current vs actual per line, coloured by drift | interiors, construction | Woodart has the maths; this is the visual |
| **D6** | **Profit heatmap** — dimension × month, green→red | analytics | `renderHeatmap` already exists in group analytics |
| **D7** | **Rate-card screen** with effective-dating and "what this changes" preview before saving | settings | C1's home |
| **D8** | **What-if panel** — levers on the left, side-by-side before/after on the right, "nothing is committed" stated plainly | Cost Explorer | C3's home |
| **D9** | **Break-even card** — contribution margin ratio, fixed cost, break-even revenue, current position against it | company dashboard | Small, memorable |
| **D10** | **"Where did the margin go?"** — the narrated-digest pattern from payroll, applied to a job: plain English over live figures | project/job | We already know this style works |

### PART E · Per-vertical specifics

- **Travels** — cost per PNR including the share of staff who issue them; route/airline profitability (the route is already on every ticket); ADM/penalty leakage as a cost driver; **cost of held BSP stock** and of a refund cycle.
- **Interiors** — generalise the drift model to labour and subcontract, not just materials; wastage % as a rate; **cost per square foot by item type**, which is how the trade actually quotes.
- **Construction** — committed cost from work orders; BOQ vs actual per cost code; retention as a financing cost; cash-flow-weighted job margin.
- **IT** — the one vertical where **billable hours** are the whole model; it has the most to gain from B3 and the least data today.
- **Shop** — moving-average or FIFO cost instead of a single `cost` field; shrinkage; margin by category, not just per product.

---

## 6 · Suggested order

| Wave | What | Why here |
|---|---|---|
| **1 — cheap, visible** | D3 unit-economics tiles on what we can already compute · D2 margin waterfall for travels sales · C6 budgets per company/project · D5 drift strip in Woodart | No schema change; proves the ideas on real numbers |
| **2 — the keystone** | A1 dimensions on the line · A2 cost objects · D1 Cost Explorer · A4 contribution margin | Everything downstream becomes a groupBy |
| **3 — the honest number** | B1 overhead pools · B2 absorption with contra · B4 employee true cost · C5 break-even | This is where gross margin becomes net margin and the P&L stops surprising anyone |
| **4 — dynamic** | C1 rate card · C2 effective dating · C3 what-if · C4 live quote recalc · D7/D8 | Needs 1–3 underneath to be worth anything |
| **5 — per vertical** | Part E, one vertical at a time | Travels first (most volume), interiors second (most cost complexity) |

---

## 7 · What I need from the owner before building any of it

1. **Does the company contribute employer PF**, or is the 10% employee-side only? Changes every "true cost of an employee" figure.
2. **Which overhead pools and drivers** feel right — staff cost by hours? premises by headcount or floor area? admin by transaction count? Or should overhead simply be a flat % of direct cost to start (cruder, but honest and instant)?
3. **Do you want a management view that differs from the statutory P&L?** B2 keeps them reconcilable, but you should know that allocated cost is a management number, not a tax number.
4. **Is there a budget** to compare against, per company or per project — and who sets it?
5. **Which vertical hurts most right now?** I would start Wave 5 there rather than by volume.
6. **How are IT project hours captured today**, if at all? It is the vertical where costing is the business model.

---

## Sources

- [SAP Profitability Analysis (CO-PA) — SAP Help Portal](https://help.sap.com/docs/SAP_ERP/bc7bfa203895425090402d10d80cd9f2/9e33b3533ebb823de10000000a4450e5.html)
- [Designing for Margin Analysis in SAP — SAP PRESS](https://blog.sap-press.com/designing-for-margin-analysis-in-sap)
- [CO-PA in SAP S/4HANA: which path should I follow? — Pikon](https://www.pikon.com/en/blog/co-pa-in-s4hana/)
- [Job Cost Accounting: Track Costs & Protect Margins — Acumatica](https://www.acumatica.com/blog/job-cost-accounting-guide/)
- [Cost Accounting and Project Management in Dynamics 365 — ERP Software Blog](https://erpsoftwareblog.com/2020/10/cost-accounting-and-project-management-in-dynamics-365/)
- [Activity-Based Costing — Wikipedia](https://en.wikipedia.org/wiki/Activity-based_costing)
- [Activity-Based Costing Explained — ProjectManager](https://www.projectmanager.com/blog/activity-based-costing)
- [Job Order Costing – Achieving Accurate Margins in the Job Shop — MRPeasy](https://www.mrpeasy.com/blog/job-order-costing/)
- [Bill of Quantities in Estimating Software — Builder Expert](https://builderexpert.uk/bill-of-quantity-in-construction-estimating)
- [Construction Quoting Software — Buildxact](https://www.buildxact.com/us/features/construction-quoting-software/)
- [Complex Product Configurators with Real-Time Pricing — Bemeir](https://bemeir.com/articles/complex-product-configurators-real-time-pricing/)
- [Pricing simulation in SAP ERP — Zilliant](https://docs.zilliant.com/docs/pricing-simulation-in-sap-erp)
- [What is Real-Time Pricing? — DealHub](https://dealhub.io/glossary/real-time-pricing/)
