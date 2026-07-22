# Standard Bookkeeping & P&L — Travels (and the Group model)

> Project plan (owner brief, 2026-07-22). Goal: full standard double-entry
> bookkeeping for Epal Travels — every sale, direct cost and operating expense
> posted to real journals + ledgers, auto-reflected in the concern's books AND
> the Group master accounts, then evaluated as gross/monthly/yearly P&L, per-sale
> cost & margin, and **per-product** P&L (Tickets · Visa · Contract Flight ·
> Contract File). The pattern generalises to every sister concern.

---

## 0. The scenario (owner's words, distilled)

- **Group** sits on top; sister concerns (Travels, Woodart, IT, Shop,
  Construction) are its products, so **the concerns' income IS the Group's
  income** (consolidated), and the Group can also have its **own** separate income.
- Each concern has **dedicated accounts**; the **Group has Master Accounts** that
  roll everything up.
- **Travels sells**: Ticketing, Visa, Contract Flight, Contract File. Each sale
  has a **direct cost** (buy @90, sell @100 → ৳10 gross) — but we want the FULL
  standard treatment, not just the arithmetic.
- **Costs to model**: COGS per sale; staff (salary + wages + overtime + lunch +
  snacks); office (rent, utilities, internet, supplies, stationery, printing,
  cleaning, housekeeping, security, development); marketing (ads, boost,
  subscriptions incl. shared AI plans); guest/entertainment (nasta, tea, coffee,
  client entertainment, events, occasions, transport/TA, refreshments).
- **Shared costs** (one office rent ~1 lac; shared AI subscriptions) are **split
  across the concerns** (equally, or by a rule).
- **Wanted outputs**: P&L, gross margin, monthly P&L, yearly P&L, per-sell cost,
  per-sell margin, and everything **categorised by product**.

---

## 1. What already exists (the spine we build on)

The double-entry engine is already real — `platform/engines-library/ledger.js`:

- **Ledger**: `ledger.post({date,companyId,ref,memo,source,party,lines:[{account,dr,cr}]})`
  — balanced double-entry, per-company (`companyId`), with reversal, period lock,
  and audit. Single source of truth. Everything that touches money posts here.
- **Chart of Accounts** (frontend `coa` store, backend `accounts` table):
  - Assets 1000 Cash · 1010 Bank · 1150 Sub-Agent Rcv · 1200 AR · 1300 Inter-co
    Rcv · 1400 Inventory · 1500 Fixed Assets
  - Liabilities 2000 AP · 2050 BSP Payable · 2130/2200 VAT Payable · 2140 AIT/TDS
    · 2300 Customer Advances · 2400 Inter-co Payable
  - Equity 3000 Owner Equity · 3100 Retained Earnings · 3200 Current-Year Earnings
  - **Income (product-specific!)** 4000 Sales · **4010 Air Ticket** · **4020 Visa**
    · 4030 Package/Tour · 4040 Hotel · **4050 Contract Flights & Files** · 4100
    Commission · 4900 Other
  - **COGS** 5000 Cost of Sales
  - **Operating expense** 5100 Salaries · 5200 Rent · 5300 Utilities · 5350 Agent
    Commission · 5400 Marketing · 5500 Office & Admin · 5550 Food & Entertainment
    · 5600 Conveyance & Travel · 5800 Misc · 5900 ADM/Penalties · 6000 Bank Charges
- **Auto-posting**: a `sale:recorded` listener posts every sale — **DR AR/Cash /
  CR Revenue**, and when `cost>0` also **DR 5000 COGS / CR 2000 AP** (guarded
  against double-post). So COGS *already* posts for sales that carry a cost.
- **Mappers**: `incomeAccountFor(sale)` routes a sale to its product revenue
  account (air/ticket→4010, visa→4020, contract/flight→4050…);
  `expenseAccountFor(text)` routes an expense head to its COGS/opex account.
- **Reports already in the engine**:
  - `pnl(companyId, {from, to})` → `{revenue, cogs, gross, expenses, net, lines}`
    — **already period-aware and already separates COGS → gross margin**.
  - `trialBalance(companyId)`, `balanceSheet(companyId)`.
  - Consolidated trial balance with **inter-company elimination** for the Group.
- **Shared-cost allocation EXISTS**: `companies/group-cockpit/modules/finance`
  `allocateCostsForm` — split a group cost to concerns by % (posts `source:
  'intercompany'` legs both sides). Today it's %-based.
- **Per-module margin already computed**: air-ticketing `netProfit = sale − cost
  − commission`, avg margin %; contract-flight `pnlOf(f)`. These are the raw
  numbers; the gap is posting/rolling them into the ledger P&L consistently.
- **Expense entry + taxonomy**: Master Accounts → Operational Expenses (shared
  `platform/kit/expenses.js`): `exp_categories` (category → sub-categories),
  budget setup, D/W/M/custom expense report. Travels Accounts has its own
  income/expense register + double-entry journal poster, all mirroring to the GL.
- **Persistence (2026-07-22)**: journals (`gl_entries`) and the bank-txn log now
  persist to the DB (JournalController / BankTxnController); bank openings post an
  opening journal. So posted books survive reload on the live (API-mode) site.

**Conclusion:** ~70% is built. This plan is mostly *orchestration + filling gaps*
(product dimension, finer taxonomy, equal-split allocation, a unified P&L/eval
surface), NOT a rewrite.

---

## 2. The double-entry model — every flow's journal

Every money event becomes a balanced journal on the concern's `companyId`. Debits
must equal credits. The Group books are just the sum of all concerns' entries
(with inter-company legs eliminated).

| Event | Debit | Credit |
|---|---|---|
| **Product sale** (cash) | 1000/1010 Cash/Bank | 40x0 product revenue |
| **Product sale** (credit) | 1200 AR (or 1150 agent) | 40x0 product revenue |
| **Direct cost of that sale (COGS)** | 5000 Cost of Sales *(tag: product)* | 2000 AP / 1010 (paid) |
| **Customer pays an AR** | 1000/1010 | 1200 AR |
| **Salary run** | 5100 Salaries | 1010 (net) + 2140 (TDS) + 2xxx (deductions) |
| **Wages / overtime / staff lunch-snacks** | 5100 (sub: wages/OT) or 5550 (meals) | 1000/1010/2000 |
| **Office rent (this concern's share)** | 5200 Rent | 1010 / 2000 |
| **Utilities / internet / supplies / printing / cleaning / security / dev** | 5300 / 5500 | 1010 / 2000 |
| **Marketing (ads/boost/subscriptions)** | 5400 Marketing | 1010 / 2000 |
| **Guest / entertainment / tea / events / transport-TA** | 5550 / 5600 | 1000/1010 |
| **Shared cost allocated FROM group** | 5xxx (concern's share) | 2400 Inter-co Payable |
| **…the group side** | 1300 Inter-co Rcv | 5xxx (original head, contra) |
| **VAT collected / AIT withheld** | (part of sale/expense) | 2130 / 2140 |

Gross profit = Revenue − COGS (5000). Net profit = Gross − Operating expenses
(51xx–6000). This is exactly what `ledger.pnl()` already returns.

---

## 3. Data entry points (where the user types → what posts)

There should be **one obvious entry point per event type**, each producing the
journal above automatically. Most exist; a few need wiring.

1. **Product sale** — the product module (Air-Ticketing sale, Visa application
   sale, Contract-Flight seat sale, Contract-File billing). Captures **sale
   price, direct cost, commission, VAT, product, party**. → posts Revenue + COGS
   (+ commission to 5350, + VAT to 2130). *Exists for tickets/flights; ensure
   Visa & Contract-File capture cost and post COGS the same way.*
2. **Operational expense** — Master Accounts → Operational Expenses (or Travels
   Accounts → Expenses). Pick **Category → Sub-category**, method, party, bill no,
   line-items. → posts the expense head + Cash/AP. *Exists; extend the taxonomy in
   §5.*
3. **Payroll run** — Master Payroll / concern payroll desk. → posts Salaries +
   net-pay + TDS/deductions. *Exists (5100).* Add wages/overtime/benefits as
   sub-heads (§5).
4. **Shared-cost allocation** — Group Finance → "Allocate Costs". Enter the total
   (rent, AI subs), choose **Equal split** (new) or custom %. → posts the concern
   shares via inter-company legs. *Exists (%); add equal-split.*
5. **Manual journal** — Manage Journals "Post Journal" for adjustments, openings,
   accruals. *Exists, balanced-guard enforced.*
6. **Bank movement** — Deposit/Withdraw/Transfer + bank openings. *Exists +
   persists (2026-07-22).*

---

## 4. The product dimension (Tickets · Visa · Contract Flight · Contract File)

To slice P&L by product we need each **revenue AND its COGS** tagged to a product.

- **Revenue** is already product-specific by account (4010/4020/4030/4040/4050).
- **COGS today is one bucket (5000)** → gross margin is company-wide, not
  per-product. Two ways to get per-product COGS (pick one; A is lighter):
  - **A. Tag lines with `product`** — add an optional `product` field to journal
    lines (or the entry). Sales & their COGS carry `product:'tickets'|'visa'|
    'contract-flight'|'contract-file'`. Per-product P&L = group ledger lines by
    `product`. Minimal COA change, flexible. (Pairs with reference-ERP Gap 1's
    per-line party work — same mechanism.)
  - **B. Product-specific COGS accounts** — 5010 Ticket COGS, 5020 Visa COGS,
    5050 Contract COGS. Cleaner trial balance, but more accounts + mapping.
- **Recommended: A** (a `product` tag), because opex (staff, rent, marketing)
  can't be product-specific at source and must be **apportioned** to products by
  a driver (revenue share or sale count) for a *fully-loaded* per-product P&L.
  A tag + an apportionment step gives both **direct** (revenue−COGS) and
  **fully-loaded** (after allocated opex) product margins.

---

## 5. Expense taxonomy (owner's full list → COA heads)

Keep the two-level **Category → Sub-category** the expense kit already has; map
each to a COA head so posting is automatic. Proposed taxonomy for Travels:

| Category (COA head) | Sub-categories (owner's list) |
|---|---|
| **Staff — Salaries (5100)** | Salary · Wages · Overtime · Bonus · Festival bonus |
| **Staff — Welfare (5550)** | Staff lunch · Snacks · Tea/coffee (staff) |
| **Office — Rent (5200)** | Office rent *(shared → allocated, §6)* |
| **Office — Admin (5500)** | Utilities(elec/water/gas) · Internet · Office supplies · Stationery · Printing · Cleaning · Housekeeping · Security · Repair & maintenance · Software/Dev |
| **Marketing (5400)** | Facebook/Google ads · Boosting · Design · Print/SMS · **Subscriptions (AI/SaaS)** *(shared → allocated)* |
| **Guest & Entertainment (5550)** | Guest nasta · Client entertainment · Tea/coffee (guest) · Events · Occasions · Refreshments |
| **Conveyance & Travel (5600)** | Local transport · Fuel · TA/DA · Courier |
| **Fees & Charges (6000)** | Bank charge · Trade license · IATA/GDS fee · Software license |
| **Cost of Sales (5000)** | *(posted by the sale, tagged product — not a manual head)* |

Sub-categories are free-text-plus-list (already supported), so the owner can add
more; the **Category fixes the COA head** so the journal is always correct.

---

## 6. Shared costs → split across concerns (rent, AI subscriptions)

- The **payer** (usually Group HQ, or the concern that holds the contract) records
  the full cost, then **allocates** shares to each concern.
- **Equal split** (new mode): amount ÷ N active concerns; or **by driver**
  (headcount, revenue share) for fairness. The existing `allocateCostsForm`
  already posts the inter-company legs — add an **"Equal / By headcount / By
  revenue / Custom %"** selector.
- Result: each concern's P&L carries its **fair share** of rent/AI; the Group's
  consolidated P&L nets the inter-company legs to zero (no double count).

---

## 7. Reports & evaluations (the outputs the owner asked for)

All read the **one ledger**, so they're always consistent. Build a **Travels
Accounts → P&L / Evaluation** surface (and mirror at Group for consolidation):

1. **Company P&L** — `pnl('travels', {from,to})` already gives revenue, COGS,
   **gross**, opex, **net**. Add **period presets**: This month · Last month ·
   This year · Last year · Custom. → **monthly P&L** and **yearly P&L** fall out.
2. **Per-product P&L** — group ledger lines by `product` tag (§4): Revenue −
   direct COGS = **direct margin per product**; minus apportioned opex =
   **fully-loaded margin per product**. Table + stacked bar (Tickets/Visa/
   Contract-Flight/Contract-File).
3. **Per-sale metrics** — from the sales register + its COGS: **avg cost/sale**,
   **avg margin/sale**, **margin %**, count, by product and by month. (Air-
   Ticketing already computes net-profit & avg-margin — generalise it.)
4. **Gross stats dashboard** — Revenue · COGS · Gross · Opex · Net + gross-margin%
   and net-margin%, trend over months, top expense heads, top products.
5. **Group consolidated P&L** — sum every concern's `pnl()` with inter-company
   elimination (engine already does elimination for the trial balance). Group also
   shows its **own** separate income line.
6. **Standard statements** — Trial Balance, Balance Sheet, General Ledger,
   Account Statement (engine has TB + BS; add the V1/V2 report suite from the
   reference-ERP advantage list in `docs/TASK-QUEUE.md`).

---

## 8. How an entry auto-reflects EVERYWHERE

The invariant that makes "enter once, appears everywhere" true:

> **Every money event posts ONE balanced journal to `ledger.post` on the
> concern's `companyId`. Nothing computes balances independently — every screen
> READS the ledger.**

- Journals view, account ledgers, trial balance, P&L, balance sheet → all read
  `ledger.entries()/balance()/pnl()`. Post once → they all update.
- **Group master accounts** read the same store with no `companyId` filter (all
  concerns) and eliminate inter-company legs → the Group P&L is the concerns'
  sum, automatically, plus the Group's own entries.
- Bank balances, reconciliation, cash-flow, last-transaction (the cards we just
  built) also read the ledger + bank-txn log → a sale/expense shows in the bank
  movement, the reconciliation, and the P&L at once.
- Persistence (DB) is wired for `gl_entries` + `bank_txns`, so this holds across
  reloads and devices on the live site.

---

## 9. Gap roadmap (phased — build on the spine)

- **Phase 1 — COGS everywhere.** Ensure **every** product sale (Visa, Contract-
  File too, not just Tickets/Flights) captures a **direct cost** and posts the
  COGS leg. Backfill/guard so gross margin is real for all four products.
- **Phase 2 — Product tag.** Add optional `product` to journal lines/entries;
  stamp it on sale + COGS postings. (Shares the mechanism with per-line party.)
- **Phase 3 — Expense taxonomy.** Seed the §5 Category→Sub-category tree; confirm
  every sub maps to the right COA head; add missing sub-heads (wages, overtime,
  housekeeping, security, dev, subscriptions).
- **Phase 4 — Equal-split allocation.** Add Equal / by-headcount / by-revenue
  modes to the Group allocation form; apply to rent + AI subscriptions.
- **Phase 5 — Evaluation surface.** Travels Accounts → P&L tab: period presets
  (monthly/yearly), gross stats, **per-product P&L** (direct + fully-loaded),
  per-sale cost/margin, trends. Mirror a consolidated version at Group.
- **Phase 6 — Statement suite.** GL, Account Statement, Trial Balance V2, P&L V2,
  Balance Sheet V2, printable vouchers (from the reference-ERP advantage list).
- **Phase 7 — Opex apportionment to products** (optional, advanced): allocate
  operating expenses to products by revenue/volume driver for fully-loaded
  per-product net margin.

Each phase is small, ledger-first, and independently shippable — parity-safe
because it ADDS posting/reporting, never changes existing screens' look.

---

## 10. Open decisions for the owner

1. **Per-product costing method** — tag lines (A, recommended) vs product COGS
   accounts (B)?
2. **Shared-cost split rule** — equal, by headcount, by revenue, or per-cost
   custom? (Rent equal? AI by headcount?)
3. **Opex → product apportionment** — do you want *fully-loaded* per-product P&L
   (opex spread onto products), or just **direct** margin (revenue − COGS) per
   product with opex shown company-wide?
4. **Who holds the shared contracts** — Group HQ pays rent/AI then recharges, or
   one concern pays and recharges?
5. **Cash vs accrual** — book expenses when paid (cash) or when incurred
   (accrual, via AP)? The engine supports both; pick the default.
