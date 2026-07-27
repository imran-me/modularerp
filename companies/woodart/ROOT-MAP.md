# ROOT MAP — Woodart Interiors, and the phase model behind it

> **What this answers:** the complete module map with a feature hierarchy, and
> every feature allocated to exactly one owning module. Frozen 2026-07-27.
>
> **The decision that unlocked it (owner, 2026-07-27):**
> *"A project may have several phases; architecture or 3D modeling is one of
> them."* — so architecture/3D is **not a service module**. It is a **phase of a
> project**, like production and installation already are.
>
> Read with: `MODULE-STANDARD.md` (how a module is built) ·
> `NAMING-AND-TERMINOLOGY.md` (what things are called) · `CONTEXT.md` (state).

---

## 1 · The organising principle

Everything below follows from one rule:

> **A project moves through PHASES. Each delivery phase has exactly ONE module
> that owns the work records produced during it. The project owns the phase;
> the module owns the work.**

That is not a new idea imposed on the system — it is what the built modules
already do, and naming it makes the remaining gaps obvious:

| Phase | Module that owns its work records | Its records | Status |
|---|---|---|---|
| Brief & survey | `crm` | enquiries, site visits | ⬜ |
| **Architecture & 3D** | **`design`** | drawings, 3D models, revisions, approvals | ❌ **missing — the gap this map exposes** |
| Estimate & BOQ | `estimates` | estimates, BOQ lines | ⬜ |
| Procurement | `procurement` | POs, vendors | ✅ built |
| Production | `production` (Workshop) | fabrication jobs | ✅ built |
| Installation | `installation` (Site & Install) | site visits, snags | ✅ built |
| Handover & billing | `projects` | the sale, the invoice | ◑ legacy |

Materials, accounts, ledgers, HRM and the rest are **not phases** — they are
resources and books that every phase draws on. §3 separates the two.

**The gap this makes obvious:** production and installation each got their own
desk, but the architecture/3D phase — the one the owner just named — has no
home at all. Its work currently has nowhere to live except a kanban column
labelled "Design Studio".

---

## 2 · The phase model

### 2.1 Today

`wa_projects.stage` has five values, driving the Design Studio kanban and the
billing gate:

```
Design → Production → Installation → Handover → Completed
```

"Design" is doing too much: it silently covers brief, survey, concept,
architecture, 3D modelling, revisions and client approval.

### 2.2 Proposed

```
Brief → Design & 3D → Estimate → Production → Installation → Snagging → Handover → Completed
```

⚠️ **This is an R2 change and must not be done casually.** `stage` drives the
kanban columns, `daysLeft` risk, the "Bill on Handover" gate and the
`consolidatedPnl` reporting. Changing the value set changes a working screen.

**Recommendation — additive, in two steps:**

1. **Add a `phase` field** alongside `stage`, carrying the fine-grained value.
   `stage` keeps its five values and everything that reads it keeps working.
   The `design` module and the project drawer read `phase`.
2. **Retire `stage`** only once every reader has moved, with a parity proof —
   the same discipline every module rebuild has used.

Doing it the other way round — redefining `stage` first — breaks the billing
gate, which is the one thing in this company that moves money.

### 2.3 Construction differs, and the map must say so

Owner: *"for construction, that too a phase + also individual work sell."*

So in **Construction**, architecture is **both**:

- a **phase** of a build project (same as Woodart), **and**
- a **standalone sellable deliverable** — architecture sold on its own, with no
  build attached.

That is a genuinely different shape and it needs its own record type: a
**work order** (a sellable unit of work that bills without a parent project),
not a project with only one phase. Forcing standalone sales through `projects`
would put half-empty projects in every portfolio KPI and corrupt margin
reporting.

**Recorded here so the decision is already made when Construction is built:**
Construction gets `projects` (phased, like Woodart) **plus** a `work-orders`
module owning standalone sellable work. Woodart does **not** need `work-orders`
unless it starts selling design without the fit-out — if that ever happens, the
same module drops in.

---

## 3 · The module map

Sixteen declared modules, reorganised into six bands. **The band is the mental
model; the sidebar order should follow it.**

### Band A · PIPELINE — win the work

| # | Module | Owns | Feature hierarchy |
|---|---|---|---|
| A1 | `crm` — Leads & CRM | `wa_leads` | **Enquiries** (source, brief, budget band) · **Site visits** (survey notes, measurements) · **Pipeline** (stage board, conversion) · **Lost reasons** |
| A2 | `clients` ✅ | `wa_clients` | **Directory** · **Portfolio** (projects, value, margin, won/open quotes) · **Segments** (Homeowner · Developer · Corporate · Retail) |

### Band B · DESIGN — the architecture & 3D phase ❌ **to build**

| # | Module | Owns | Feature hierarchy |
|---|---|---|---|
| B1 | **`design`** — Design Studio | `wa_drawings`, `wa_revisions` | **Drawing register** (per project: plan, elevation, section, detail — each with a revision letter) · **3D models & renders** (viewpoint, render date, file ref) · **Revisions** (what changed, who asked, when) · **Client approvals** (issued → commented → approved, the gate into Estimate) · **Design load** (by designer, by project) |

> **Why a module and not a tab on `projects`:** drawings and 3D models are a
> real body of versioned records with their own lifecycle (issue → comment →
> revise → approve), exactly like jobs and site visits. Production and
> Installation each earned a desk for the same reason. Putting it in the project
> drawer is how it ended up invisible in the first place.

### Band C · DELIVERY — the project spine

| # | Module | Owns | Feature hierarchy |
|---|---|---|---|
| C1 | `projects` ◑ legacy | `wa_projects` | **Active projects** (stage, phase, progress, margin, deadline) · **Phase board** (drag to advance) · **Milestones & billing** (Bill on Handover — the only place revenue posts) · **Gallery** |
| C2 | `estimates` ⬜ *(currently inside `projects/view.js`)* | `wa_estimates` | **Quotations** (line items, validity, approve → project) · **BOQ** (aggregated material demand) · **Costing** (cost vs quote margin) |
| C3 | `production` ✅ — Workshop | `wa_production` | **Job register** · **Workshop board** (Queued · Running · Blocked · Done) · **Station load** |
| C4 | `installation` ✅ — Site & Install | `wa_installs` | **Schedule** · **Snag list** (the handover queue) · **Teams** |

### Band D · SUPPLY — what the work consumes

| # | Module | Owns | Feature hierarchy |
|---|---|---|---|
| D1 | `materials` ✅ | `wa_materials` | **Stock** · **Reorder** · **Valuation** · ⬜ **Movements** (receipt · issue · adjustment · wastage — the known gap) |
| D2 | `procurement` ✅ | `wa_purchases`, `wa_vendors` | **Purchase orders** (goods receipt posts DR 1400 / CR 2000) · **Vendors** · **Spend** · ⬜ **Vendor payment** (settles the 2000 payable) |

### Band E · MONEY — the books

| # | Module | Owns | Feature hierarchy |
|---|---|---|---|
| E1 | `accounts` ⬜ | shared | **Income** · **Expenses** · **Vendor payments** · **Project P&L** · **Banks & cash** (via `EPAL.pay`) |
| E2 | `ledgers` ⬜ | none (reads `EPAL.ledger`) | **General ledger** · **Trial balance** · **Client ledger** · **AR/AP ageing** · **Balance sheet** · **P&L** |
| E3 | `payroll` ⬜ | shared desk | **Salary sheet** · **Payslips** · **Advances** |

### Band F · PEOPLE & OVERSIGHT

| # | Module | Owns | Feature hierarchy |
|---|---|---|---|
| F1 | `hrm` ⬜ | `employees` | **Designers · carpenters · site crew** · **Attendance** · **Leaves** |
| F2 | `tasks` ⬜ | shared | **Personal Kanban** |
| F3 | `dashboard` ⬜ | none | **Pipeline · workshop load · margins · deadline risk** |
| F4 | `reports` ⬜ · `analytics` ⬜ | none | **Project / material / financial reports** · **Margin, wastage, on-time delivery** |
| F5 | `settings` ⬜ | `company_settings` | **Woodart configuration** |

---

## 4 · Feature allocation — the cross-cutting answers

Every capability I deferred while building, now assigned to exactly one owner.
**This is the part that stops two modules implementing the same thing.**

| Capability | Owner | Not | Why |
|---|---|---|---|
| Posting revenue | `projects` | installation, accounts | "Bill on Handover" already does it. A second path double-bills. |
| Goods receipt posting | `procurement` | materials | Materials holds stock; buying it is a procurement event. |
| Paying a vendor | `accounts` | procurement | Needs a bank/cash account and `EPAL.pay`. |
| Stock movements | `materials` | procurement, production | The store is the ledger of its own quantities. |
| Consuming stock on a job | `production` → calls materials | production alone | Production says *what* was consumed; materials records the movement. |
| Snag items (the list) | `installation` | projects | Currently the project drawer's modal — **move it** when installation becomes the primary snagging desk. One editor, one list. |
| Drawings & 3D models | **`design`** | projects | See B1. |
| Client approval of a design | **`design`** | crm, projects | It is the gate out of the design phase. |
| Project phase | `projects` | any phase module | The project owns the phase; the module owns the work. |
| Client master | `clients` | crm, accounts | CRM owns *leads*; a lead becomes a client on first project. |
| Vendor master | `procurement` | materials | Materials references a vendor by name until the FK lands. |
| Approval thresholds | `settings` + `EPAL.approvals` | procurement | A business policy, not a module rule. |

---

## 5 · What is missing, ranked

1. **`design` module** — the architecture & 3D phase has no home. **This is the
   biggest structural gap in the company**, and the owner's answer is what
   surfaced it. New stores `wa_drawings`, `wa_revisions`.
2. **`phase` on `wa_projects`** — additively, per §2.2.
3. **Material movements** — `materials` gap #1; blocks honest stock in three
   other modules.
4. **Vendor payment** — leaves the `2000` payable unsettled today.
5. **`estimates` split** out of `projects/view.js` into its own module.
6. **`projects` rebuild** to the standard — the last legacy screen.

## 6 · Revised build order

Supersedes `CONTEXT.md` §4 from here on:

| # | Module | Why here |
|---|---|---|
| ✅ 1–5 | materials · clients · procurement · production · installation | built |
| **6** | **`design`** | the named gap; unblocks the phase model |
| 7 | `crm` | feeds design with briefs and site visits |
| 8 | `estimates` | split out; sits between design and production |
| 9 | `projects` | rebuilt with `phase`, once every phase module exists |
| 10 | `accounts` | vendor payment + project P&L |
| 11 | `ledgers` | read-only off the real GL |
| 12 | `dashboard` | needs everything above to have something to show |
| 13+ | `reports` · `analytics` · `hrm` · `payroll` · `tasks` · `settings` | |

`projects` moved **later** deliberately: rebuilding it before `design` and
`estimates` exist would mean rebuilding it twice.

---

**Related:** `MODULE-STANDARD.md` · `NAMING-AND-TERMINOLOGY.md` ·
`platform/design-system/UI-CONTRACT.md` · `CONTEXT.md`.
