# Munshi Villa Duplex — how the working sheet actually works

Analysis of `Munshi Villa New Accounts.xlsx` (21 sheets), the spreadsheet the
business runs a live project on today. Written so the ERP can absorb it without
guessing at what any column means.

**Read this before building project cost control.** The sheet is the real
requirement; anything the ERP does differently is a decision, not an accident.

---

## 1 · The money, top to bottom

| | Amount |
|---|---|
| Contract value | **৳70,00,000** |
| Received — 1st / 2nd / 3rd payment | ৳10,00,000 · ৳20,00,000 · ৳10,00,000 = **৳40,00,000** |
| Still to collect | **৳30,00,000** |
| Spent to date | **৳23,48,257** |

The client side lives in unlabelled rows at the very bottom of *Over all
Accounts* — rows 77–85 — not on the summary. That is the single most fragile
thing in the file: the project's revenue is four loose cells below the last
expense.

---

## 2 · The three layers

### Layer 1 — `Over all Accounts`: a MATRIX cash book (85 rows)

One row per payment. Not a two-column ledger — a **spreadsheet matrix**:

```
SL.NO | DATE | REF. NAME | PURPOSE | ‹13 category columns›
```

The category columns are: `TRANSPORT/LABOUR · BRICK (EIT) & BREAKING · CEMENT ·
ROD · SAND (BALI) · METARIALS · SOIL TEST & CUTTING · RAJMISTRI CONTRACTOR ·
OTHERS · HARDWARE · ELECTRIC · LABOUR`.

The amount is typed into the column it belongs to, so **the column IS the
account head**. Row 65 totals every column; row 67 repeats them negated (the
cross-check).

**`REF. NAME` is not a vendor.** It is the person who physically moved the
money — `MOHSIN BOSS`, `NAYEEM`, `EMAN VAI`, `RONY & EMAN VAI`, `AZIZUL VAI`.
Vendor and purpose are both buried in the free-text `PURPOSE` string
(`"BSRM ROD PURPOSE (HAJI ENT…"`).

### Layer 2 — `Over All Cost Summary`: 18 heads, cost vs BUDGET

| Head | Spent | Budget |
|---|---|---|
| Bricks & Breaking | 4,14,000 | — |
| Cement | 2,73,780 | — |
| Sand/Bali | 2,44,920 | — |
| Rod | 8,56,397 | — |
| Hardware | 24,160 | — |
| Sanitary | 7,530 | **4,00,000** |
| Soil Excavation & Fill | 59,980 | — |
| Electrical | 22,800 | **3,50,000** |
| 3D Design office | 30,000 | **50,000** |
| Transport & Visit | 43,790 | **1,00,000** |
| Extra Labour | 16,300 | — |
| Younus Contractor | 3,41,000 | **13,44,000** |
| Extra/Others Bill | 13,600 | **90,215** |
| **Tiles · Paint · Metal · Aluminium · Wood Work** | — | — |

**Budgets are partial** — only 6 of 18 heads carry one. The rest are being
tracked without a target.

### Layer 3 — one detail sheet per head

`SL | Date | Description | Quantity | Rate | Taka | NOTE`, with a total row.

So the material sheets are a **BOQ**: quantity × rate = amount. `Rod` even
carries a running cumulative total, and quantities in mixed units
(`2263 KG`, `1398KG & 50 PCS`) — free text, not a number.

---

## 3 · The two things the sheet does that the ERP does NOT yet

### 3a · Phases are cost heads, and five have not started

`Tiles Work · Paint · Metal · Aluminium · **Wood Work**` are empty sheets
sitting in the summary with no rows. They are not missing data — they are
**phases not yet reached**. This is exactly the owner's earlier point that a
project runs in phases and Woodart's joinery is one of them.

The ERP models a project's `phase` as a single current stage. The sheet models
phases as **parallel cost heads, each with its own budget and its own ledger**.
The sheet is right and the ERP is thin here.

### 3b · The project is funded by SISTER CONCERNS

`Younus Contactor` is a party ledger, and its source column is the important
part:

```
BANK TRANSFER   EPAL TRAVELS IBBL → YOUNUS MIA      15,000
BANK TRANSFER   EPAL IT BRAC      → YOUNUS MIA      70,000
BANK TRANSFER   EMI IBBL          → YOUNUS MIA      70,000 / 50,000 / 50,000
BANK TRANSFER   EPAL TRAVELS DBL  → YOUNUS MIA      40,000
CASH            MUNSHI GIVEN TO YOUNUS              16,000
TALIM BAKSAH    MOHSIN BOSS                         10,000 ×2
```

**Travels' and IT's bank accounts are paying this project's contractor.** That
is inter-company funding recorded as free text. The kernel already supports it
properly — `ExpensePostingService` takes `fundedBy` and posts the funder's
mirror leg plus the `1300 / 2400` inter-company pair — but nothing in the
Woodart UI asks for it.

---

## 4 · What maps, and what is missing

| Sheet concept | ERP today | Gap |
|---|---|---|
| Matrix cash book | `acc_entries` + `category`, scoped by `ref` = project | ✅ shape fits |
| Cost per head | Accounts › Expenses, grouped by category | ✅ |
| **Budget per head** | Project P&L has ONE budget, from the BOQ | ❌ **no per-head budget** |
| Detail sheet (qty × rate) | `wa_estimates.lines` | ✅ same shape |
| Contract value & receipts | `wa_projects.value` + Income register | ✅ |
| **`REF. NAME` (who moved it)** | — | ❌ **no handler field** |
| Vendor + purpose | buried in one free-text string | ⚠️ needs splitting on import |
| Party ledger (Younus) | Payables is per-PO, not per-party | ⚠️ partial |
| **Funded by a sister concern** | kernel supports `fundedBy`; UI does not offer it | ❌ **not exposed** |
| **Phases as parallel cost heads** | `phase` is one current stage | ❌ **structurally different** |

---

## 5 · What I would build, in order

1. **Per-head budget on a project.** The summary sheet's core value is
   `budget vs actual per cost head`. Today Project P&L compares one BOQ total.
   This is the single biggest gap and the cheapest to close.
2. **Expose `fundedBy` in the Woodart expense form.** The kernel already posts
   the inter-company legs correctly; the UI simply never asks. Without it, a
   contractor paid from Travels' account looks like a Woodart cash payment and
   the group's inter-company balance is wrong.
3. **Phase cost heads.** Let a project carry phases as budget lines that can be
   open, unstarted or complete — matching how the business already thinks.
4. **A `handledBy` field** on a register entry. Five names recur on every row;
   losing them loses the audit trail the business actually relies on.
5. **Importer** for this workbook, once 1–4 exist. Splitting `PURPOSE` into
   vendor + description is the fiddly part and should be a reviewed mapping, not
   a regex run in silence.

## 6 · Cautions for whoever imports it

- Dates are inconsistent: `27.02.2026`, `01-30.03.20226` (typo), `06.14.2026`
  (month/day swapped), `09.04.2026 8 APR`. **Do not parse these unattended.**
- `Quantity` is free text with units (`2263 KG`, `1398KG & 50 PCS`).
- Some rows carry a stray id in the SL column (`106`, `117`, `209`) — those are
  continuation/among-row notes, not sequence numbers.
- Row 67 is row 65 negated. It is a checksum, not a transaction — importing it
  would zero the project.
- The `Cost` column on the summary is a **typed constant**, not a formula
  referencing the detail sheets. It can and does drift from them.
