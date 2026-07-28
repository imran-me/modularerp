# Plan · The Project Profile

**Status: PLAN — not built. Awaiting owner approval.**
Written 2026-07-28 against `Assets/MUNSHI-VILLA-SHEET.md` (the real working
spreadsheet) plus current construction job-costing practice.

> **Goal in one line:** click a project and see *everything* about it — money,
> materials, phases, drawings, site, billing — on one deep-linkable page that a
> site manager can read without training.

---

## 1 · Why the current drawer is not enough

Today a project opens a **modal drawer** with four tabs (Estimate/BOM,
Production, Install & Snags, Billing). Three problems:

1. **It has no URL.** You cannot send someone a link to Munshi Villa. For the
   thing the whole business revolves around, that is the biggest accessibility
   gap in the app.
2. **It shows activity, not control.** It lists what happened. It does not
   answer *"are we over budget, and where?"* — which is the only question the
   spreadsheet exists to answer.
3. **Phases are a single stage field.** The sheet treats phases as parallel cost
   heads with their own budgets, five of which have not started. The ERP models
   one current stage, which cannot express "Tiles not started, Wood Work not
   started, Rod 108% spent".

## 2 · The one idea that fixes it: a cost code

Everything below hangs off one concept the sheet already has informally — its 18
column heads. Industry practice calls these **cost codes**: a fixed, shared
vocabulary that every estimate, purchase order and expense is tagged with, so
estimating, buying and accounting all speak the same language.

The value only appears when three numbers sit against each code:

| | Where it comes from | Have it? |
|---|---|---|
| **Budget** | the approved BOQ, or typed per head | partly — one total, not per head |
| **Committed** | POs raised but not yet paid | ✅ `wa_purchases` already holds this |
| **Actual** | `acc_entries` where `ref` = the project | ✅ |

**Committed cost is the piece the spreadsheet cannot do at all** — it only
records money that has already left. A committed-cost column shows an overrun
the day a purchase order is *raised*, not weeks later when the bill is paid.
That is the single biggest upgrade over the sheet, and the data is already in
the database.

> A worked warning from the research: on a $2.4M fit-out, misposting overheads
> into build-out work packages produced a phantom 10% overrun by week 6. **Cost
> codes must include overhead codes** (Transport & Visit, Extra Labour, Others
> already exist in the sheet) so site costs never contaminate a work package.

## 3 · Data model — four small tables

Deliberately additive. Nothing existing changes shape.

| Table | Holds | Notes |
|---|---|---|
| `wa_cost_codes` | the company's fixed head list | seeded from the sheet's 18 heads; `group` ties each to a phase |
| `wa_phases` | per project: name, order, budget, status, dates | status: `Not started · Active · Complete` |
| `wa_budget_lines` | project × cost code → budgeted amount | from the BOQ where one exists, else typed |
| `wa_project_docs` | files/photos against a project | the sheet has none; the business emails them |

**Actuals and commitments get NO new table.** They are derived:

```
actual(project, code)    = SUM(acc_entries.amount) WHERE ref = project AND category → code
committed(project, code) = SUM(wa_purchases.amount − paid) WHERE project = project AND code
```

That is the whole point of having built Accounts and Procurement over shared
books first — the money is already there and correctly scoped.

**One mapping decision to make with the owner:** `acc_entries.category` is
currently free-ish text ('Vendor Payment', 'Salaries'). Cost codes need it to be
a controlled list. Either the category list *becomes* the cost code list, or a
small mapping table sits between them. **Recommendation: make them the same
list.** Two vocabularies for one idea is exactly how the sheet's summary drifted
from its detail sheets.

## 4 · The profile screen

Route: `#/woodart/projects/WAP-102` — a real page, deep-linkable, bookmarkable,
sendable. The drawer stays for quick peeks; this is the full record.

A persistent **header band** on every tab, so the four numbers that matter never
leave the screen:

```
Munshi Villa Duplex · Munshi Billah · Production · 56%
Contract 70,00,000   Billed 40,00,000   Spent 23,48,257   Committed 4,12,000
                                          ▓▓▓▓▓▓▓▓░░░░░ margin 33%
```

### Tabs

| Tab | Answers | Built from |
|---|---|---|
| **1 · Overview** | Is this job healthy? | header + alerts + phase strip + cost-by-code chart |
| **2 · Cost Control** ⭐ | Where exactly are we over? | budget · committed · actual · variance per code, grouped by phase |
| **3 · Phases** | What is done, running, not started? | `wa_phases` with per-phase budget vs spend |
| **4 · BOQ** | What did we quote? | `wa_estimates.lines` (exists) |
| **5 · Ledger** | Every taka against this job | `acc_entries` where `ref` = project |
| **6 · Purchases** | What have we ordered and owe? | `wa_purchases` (exists) |
| **7 · Materials** | What has been issued to site? | `wa_movements` (exists) |
| **8 · Work** | Workshop jobs + site visits + snags | `wa_production` + `wa_installs` (exist) |
| **9 · Drawings** | Design status & approvals | `wa_drawings` (exists) |
| **10 · Billing** | Contract, invoices, receipts, due | Income entries + contract value |
| **11 · Files** | Photos, contracts, approvals | `wa_project_docs` (new) |

**Tab 2 is the reason for the whole plan.** It is the sheet's summary page, done
properly:

```
PHASE / CODE            BUDGET      COMMITTED     ACTUAL    VARIANCE   %
▼ Structure           16,00,000      1,20,000  14,89,097    +1,10,903  93%
    Rod                8,50,000        90,000   8,56,397      −6,397  101% ▲
    Cement             3,00,000             —   2,73,780      26,220   91%
    Bricks & Breaking  4,50,000        30,000   4,14,000      36,000   92%
▼ Finishes             8,00,000      2,20,000     30,330    5,49,670    4%
    Sanitary           4,00,000      1,80,000      7,530    2,12,470    2%
    Electrical         3,50,000        40,000     22,800    2,87,200    7%
▷ Wood Work            —  not started
```

Red only where it means something: **actual + committed > budget**.

## 5 · Making it easy to maintain

The owner's brief was *accessible, understandable, easy to maintain*. Concretely:

- **One route, not a modal.** Linkable and back-button-able.
- **Every tab is a `data-screen` in `template.html`** — a developer opens one
  HTML file and sees all eleven screens. No screen is built in JS.
- **One seam.** `frontend/api.js` owns every store name and every derived
  number. `costControl(projectId)` returns the whole matrix; the screen only
  formats it. The same function backs the Laravel endpoint, so browser and
  server cannot disagree.
- **Cost codes are seeded data, not code.** Adding "Aluminium" is a row, not a
  deploy.
- **Derived, never stored.** Actual and committed are computed on read. A stored
  total is a total that drifts — exactly how the sheet's summary stopped
  matching its detail sheets.
- **Phases are rows, not an enum.** The current `STAGES` array cannot express a
  project with Wood Work but no Tiles.

## 6 · Build order — each slice ships on its own

| # | Slice | Delivers | Depends on |
|---|---|---|---|
| 1 | `wa_cost_codes` + seed from the sheet's 18 heads; category list unified | one shared vocabulary | — |
| 2 | **Cost Control tab** on the existing drawer | budget vs committed vs actual — the core value, immediately | 1 |
| 3 | `wa_phases` + Phases tab | phases as real things with budgets | 1 |
| 4 | Promote to a full profile page at `#/woodart/projects/<id>` | the URL, the header band, all tabs | 2, 3 |
| 5 | Move existing drawer tabs onto the page | one place for everything | 4 |
| 6 | `wa_project_docs` + Files tab | photos and contracts | 4 |
| 7 | Munshi Villa importer | the live project inside the ERP | 1–5 |

**Slice 2 is worth building even if nothing else is** — it answers the question
the spreadsheet exists for, and needs only one new table.

## 7 · Deliberately NOT in this plan

- **Inter-company funding.** The sheet shows Younus Contractor paid from EPAL
  TRAVELS and EPAL IT accounts. **Owner decision 2026-07-28: Interiors gets its
  own bank account**, so that is a transitional artifact, not a pattern to
  build. No `fundedBy` in the Woodart expense form.
- **Earned-value (CPI/SPI).** Real practice, wrong audience. "Rod is 101% spent"
  is understood by everyone on site; "CPI 0.94" is not.
- **Automatic import of the workbook.** Its dates come in four formats including
  a typo year and a month/day swap, quantities are free text, and one row is a
  negated checksum. Import must be a reviewed mapping, run once, not a parser
  trusted in the dark.
- **Retention / defect liability.** Real for construction, absent from this
  sheet. Add when a contract needs it, not before.

## 8 · The one thing to decide before slice 1

**Do `acc_entries.category` and the cost-code list become the same thing?**

Recommended **yes**. Every expense already carries a category; making that the
cost code means cost control works on all historical data with no migration and
no second vocabulary to keep aligned. The cost is that renaming a category
becomes a real operation rather than free text — which is the correct trade, and
the reason practice says to *define cost codes early and lock them*.

---

**Sources consulted:** construction job costing and cost-code practice
(Acumatica, Mastt, Deltek, Xpedeon on committed costs), and WBS / cost-breakdown
structure guidance (Procore, ProjectManager, monday.com) — see the chat record
of 2026-07-28 for links.
