# Plan · Project breakdown — Spaces → Phases → Requirements → Quotation → Hiring

**Status: APPROVED (owner, 2026-08-06). SLICE 1 IS BUILT — slices 2–6 outstanding.**
Written 2026-08-06 against the owner's brief of the same date, on top of
`PROJECT-PROFILE-PLAN.md` (cost codes, phases, budget lines — seeded, no screen
yet) and `ROOT-MAP.md` (the phase model).

> **Where it stands**
> | Slice | State |
> |---|---|
> | **1 · `scope` module — spaces, phase board, assignment** | ✅ **built** — `companies/woodart/modules/scope/` · sweep 257/257 both themes · probe `tools/verify/scope.mjs` 20/20 |
> | **2 · `wa_requirements` + Material Demand** | ✅ **built** — per-phase material · labour · contract lines, the drawer's line editor, `#/woodart/scope/materials` · sweep 258/258 · probe 34/34 |
> | 3 · Estimates → Quotation Builder | ⬜ next |
> | 4 · `contractors` module — hiring + labour estimate | ⬜ |
> | 5 · budget lines derived; committed cost | ⬜ |
> | 6 · Laravel slice per module | ⬜ (contracts frozen in each `backend/endpoints.md`) |

> **The owner's words (2026-08-06):** *"There will be option to register a new
> project, where we will divide the project into subproject like Bed Room,
> Kitchen, Dining Room. Each sub project will have phases — first phase is
> design, then colour, then wood work, then furniture. Each phase will have
> option to assign a specific person from the Epal company who is responsible
> for that phase, and what materials will be needed in that phase. Those
> materials go to the master quotation builder / material listing. Then the
> contractor part — electricians hiring, labour hiring, estimation."*

---

## 1 · The shape, in one picture

```
PROJECT              WAP-102 · Munshi Villa Duplex · Munshi Billah · ৳70,00,000
│                    (registered where it already is: Projects → New Project)
│
├─ SPACE  SPC-001    Master Bed Room          kind: Bedroom      · 320 sft
│   ├─ PHASE  Design            owner: Imtiaz Chowdhury   · Complete
│   ├─ PHASE  Electrical        owner: Jahangir Alam      · Active
│   ├─ PHASE  Wood Work         owner: Sumaiya Akter      · Not started
│   ├─ PHASE  Colour & Paint    owner: —                  · Not started
│   └─ PHASE  Furniture         owner: —                  · Not started
│        │
│        └─ REQUIREMENTS (what this phase needs)
│             material  Marine Plywood 18mm    24 sheet × ৳3,400
│             material  Laminate — Walnut      18 sheet × ৳1,250
│             labour    Carpenter  2 men × 6 days × ৳900
│             contract  Polish & lacquer — lump sum ৳45,000
│
├─ SPACE  SPC-002    Kitchen                  kind: Kitchen      · 140 sft
└─ SPACE  SPC-003    Dining Room              kind: Dining       · 210 sft

         ↓ every requirement line rolls up, once, into two places

   MASTER QUOTATION BUILDER            MATERIAL LISTING (demand)
   Estimates & BOQ → Builder           Scope → Material Demand
   grouped Space → Phase               material × total qty vs stock
   cost · markup · quote               shortfall → Procurement PO

         ↓ and the labour/contract lines become

   HIRING                              Contractors & Labour → Engagements
   ENG-011  Younus · Electrician  →  SPC-002 Kitchen / Electrical
            8 days × 2 men × ৳1,200 = ৳19,200   [Committed]
```

Four levels where the system has three today. **The whole plan is that one extra
level, plus the line table that hangs off it.**

## 2 · The rule this follows (so it fits, instead of forking the app)

`ROOT-MAP.md` §1 froze the organising rule:

> **A project moves through PHASES. Each delivery phase has exactly ONE module
> that owns the work records produced during it. The project owns the phase; the
> module owns the work.**

This plan extends it by exactly one clause, and changes nothing else:

> **The project owns the SPACE. The space owns the PHASE. The phase owns its
> REQUIREMENTS (what it will need). The delivery modules still own the work
> records (drawings, jobs, site visits, POs) — unchanged.**

So `design` still owns drawings, `production` still owns workshop jobs,
`procurement` still owns POs, `projects` is still the only place revenue posts.
Nothing that works today moves. **A requirement is a plan, not a work record** —
that distinction is what keeps the new module from colliding with the five built
ones.

### Why phases move down a level

`wa_phases` today is **project-level and parallel** (seeded 2026-07-28,
`PROJECT-PROFILE-PLAN.md` §3). That cannot express what the owner described:
Kitchen wood work finished while Bed Room wood work has not started. A phase
must belong to a space.

**This is safe to change**: `wa_phases` is seeded but **no screen reads it** —
verified by grep across the repo, the only other hits are the plan document and
the seeder itself. Reshaping a store with zero consumers is not an R2 change.
Project-level phase totals (the strip in the profile plan) become a **derived
roll-up** of its spaces' phases — one source, no drift.

## 3 · Words — locked here, then copied into `NAMING-AND-TERMINOLOGY.md`

The owner said "whatever suits the standard in interior". **Space** is that word:
*space planning* is the interior industry's own term for exactly this breakdown,
and unlike "room" it also covers a balcony, a lobby, a corridor or an open-plan
zone without the label lying.

| Use | Not | Record | Prefix | Store |
|---|---|---|---|---|
| **Space** | room, sub-project, unit, zone, package | a division of a project's scope — Master Bed Room, Kitchen, Lobby | `SPC` | `wa_spaces` |
| **Phase** | stage, step, task | a stage of work *inside one space* — Design, Wood Work, Colour | `PHS` | `wa_phases` |
| **Requirement** | BOM line, need, item | one planned line a phase needs: material · labour · contract | `REQ` | `wa_requirements` |
| **Contractor** | subcontractor, party, mistri | a hired party — contractor, electrician, painter, labour gang | `CON` | `wa_contractors` |
| **Engagement** | hiring, booking, deployment | one hire: a contractor on one phase, for an agreed amount | `ENG` | `wa_engagements` |

UI label softens the jargon without forking the word: the menu reads
**"Spaces & Phases"**, and the Spaces screen subtitle reads *"rooms and areas of
this project"*. `Stage` stays reserved for `wa_projects.stage` (the existing
five-value headline field) — two words, two levels, no collision.

## 4 · Data model — 4 new stores, 1 reshaped, 1 seeded list

Deliberately additive. Money is integer BDT (D10). The demo clock stays
`2026-07-05`.

| Store | Status | Holds |
|---|---|---|
| `wa_spaces` | **new** | the project's spaces |
| `wa_phases` | **reshaped** (0 consumers today) | phases, now belonging to a space |
| `wa_requirements` | **new** | every planned line of every phase |
| `wa_contractors` | **new** | the hire register + rate card |
| `wa_engagements` | **new** | a contractor hired onto one phase |
| `wa_phase_templates` | **new, seeded** | default phase lists per space kind |

### 4.1 `wa_spaces` — the sub-project

```js
{ id:'SPC-001', companyId:'woodart', project:'WAP-102',
  name:'Master Bed Room',
  kind:'Bedroom',            // Bedroom·Kitchen·Dining·Living·Bath·Balcony·Office·Common
  area:320,                  // sft — optional, drives per-sft reporting
  sort:1,
  status:'Active',           // Not started · Active · Complete  (DERIVED, see below)
  note:'', created:'2026-07-05' }
```

`status` and every money figure on a space are **derived from its phases**, never
stored. A stored total is a total that drifts — the exact failure the Munshi
spreadsheet demonstrated.

### 4.2 `wa_phases` — reshaped: a phase belongs to a space

```js
{ id:'PHS-0014', companyId:'woodart', project:'WAP-102', space:'SPC-001',
  name:'Wood Work',
  code:'Wood Work',          // → wa_cost_codes.id — THE ONE VOCABULARY (§4.7)
  sort:3,
  status:'Not started',      // Not started · Active · Complete   (the seeded values)
  ownerId:'EPL-0008',        // → employees.id — "who is responsible" (§5.2)
  start:null, finish:null,   // planned dates
  note:'' }
```

Kept from the current seeded shape: `companyId · project · name · sort · status ·
start · finish`. Added: `space · code · ownerId · id`. Removed: nothing.

### 4.3 `wa_requirements` — one table for material, labour and contracted work

The single most important design decision in this plan: **one line table, three
kinds**, so the quotation builder, the material listing, the labour estimate and
the cost-control matrix are all one query with a filter — not four features that
can disagree.

```js
{ id:'REQ-0042', companyId:'woodart', project:'WAP-102',
  space:'SPC-001', phase:'PHS-0014',
  kind:'material',           // material · labour · contract
  code:'Boards & Ply',       // → wa_cost_codes.id
  item:'Marine Plywood 18mm',// material → matches wa_materials.name where it exists
  materialId:'MAT-003',      // null when it is a free-text item (kept, flagged Unlisted)
  qty:24, unit:'sheet',
  unitCost:3400,             // what it costs us
  unitSale:4500,             // what it is quoted at (0 = not quoted yet)
  status:'Planned',          // Planned · Quoted · Ordered · Issued
  note:'' }
```

**Labour and contract lines use the same three number fields**, so one formula
totals everything:

| kind | `qty` means | `unitCost` means | example |
|---|---|---|---|
| `material` | quantity | rate per unit | 24 sheet × ৳3,400 |
| `labour` | **man-days** (men × days) | day rate | (2 × 6) × ৳900 |
| `contract` | 1 | the lump sum | 1 × ৳45,000 |

`men` and `days` are kept as their own fields on labour lines (`men:2, days:6`)
because the hiring screen needs them, and `qty` is **recomputed from them on
write** — the same "write recomputes the derived number" rule that
`installation` uses for its snag count, and for the same reason.

### 4.4 `wa_contractors` — the hire register

```js
{ id:'CON-003', companyId:'woodart', name:'Younus Electric Works',
  trade:'Electrician',       // Electrician·Carpenter·Painter·Mason·Plumber·Tiles·Labour·General
  type:'Contractor',         // Contractor · Labour gang · Individual
  rate:1200, rateBasis:'day',// day · sft · lump
  phone:'', address:'', nid:'',
  rating:4, status:'Active', since:'2024-02-01' }
```

Deliberately **not** `wa_vendors`. A vendor sells material against a purchase
order and lands in `2000 Accounts Payable` on goods receipt; a contractor sells
labour against a phase and is paid on work done. Same word would mean the
Procurement spend screens quietly start reporting labour as material purchasing.

### 4.5 `wa_engagements` — one hire

```js
{ id:'ENG-011', companyId:'woodart', project:'WAP-102',
  space:'SPC-002', phase:'PHS-0021',
  contractor:'CON-003',
  requirement:'REQ-0088',    // the labour/contract line this fulfils (null if ad-hoc)
  men:2, days:8, rate:1200,
  amount:19200,              // recomputed on write: men × days × rate, or the lump sum
  status:'Hired',            // Hired · Working · Completed · Cancelled
  start:'2026-07-14', finish:'2026-07-21',
  note:'' }
```

**An engagement is committed cost, never a payment.** It appears in the
cost-control matrix the day it is agreed — which is the point (`PROJECT-PROFILE-
PLAN.md` §2: committed cost is the thing the spreadsheet cannot do at all).
Paying the contractor stays with the Accounts desk and `EPAL.pay`, per
`ROOT-MAP.md` §4. No second money path.

### 4.6 `wa_phase_templates` — so nobody retypes the phase list

Data, not code (same principle as cost codes: adding a phase is a row, not a
deploy). Seeded per space kind, applied on "Add space":

```js
{ id:'TPL-002', companyId:'woodart', kind:'Kitchen', sort:1,
  phases:[ {name:'Design',           code:'Design Fee'},
           {name:'Civil & Breaking', code:'Bricks & Breaking'},
           {name:'Plumbing',         code:'Sanitary'},
           {name:'Electrical',       code:'Electrical'},
           {name:'Tiles',            code:'Tiles Work'},
           {name:'Wood Work',        code:'Wood Work'},
           {name:'Counter & Stone',  code:'Metal'},
           {name:'Colour & Paint',   code:'Paint'},
           {name:'Furniture',        code:'Boards & Ply'},
           {name:'Handover',         code:'Installation'} ] }
```

Seeded kinds: **Bedroom · Kitchen · Dining · Living · Bath · Balcony · Office ·
Common**. The owner's own sequence (Design → Colour → Wood Work → Furniture) is
the Bedroom/Living template. A template is a **starting point**: phases can be
added, renamed, reordered or deleted per space afterwards.

### 4.7 Nothing new is invented for money — cost codes already exist

Every phase and every requirement carries a `code` from the **already-seeded**
`wa_cost_codes` (34 heads: Design Fee · Boards & Ply · Wood Work · Electrical ·
Paint · Tiles Work · Contractor · Extra Labour · …). That is what makes plan,
purchase and actual speak one language, and it is why the cost-control matrix in
`PROJECT-PROFILE-PLAN.md` §4 will light up the moment this lands:

```
budget(project, code)     = Σ wa_requirements.qty × unitCost      ← THIS PLAN (new)
committed(project, code)  = Σ wa_purchases unpaid + Σ wa_engagements open
actual(project, code)     = Σ acc_entries where ref = project
```

`wa_budget_lines` stops being seeded from the BOQ guess and becomes a **derived
view of requirements** — one number, one origin.

### 4.8 Derived, never stored

| Figure | Formula |
|---|---|
| phase cost / quote | Σ its requirements `qty × unitCost` / `qty × unitSale` |
| space totals | Σ its phases |
| project plan value | Σ its spaces |
| space / project progress | phases Complete ÷ phases total (weighted by phase cost) |
| material demand | Σ requirements where `kind='material'` grouped by `item` |
| shortfall | demand − `wa_materials.qty` |
| person load | phases where `ownerId = X` and `status ≠ Complete` |

## 5 · The modules and their screens

Per the approved split: **2 new modules + 1 new sub-screen**.

### 5.1 `scope` — "Spaces & Phases"  *(new module)*

`companies/woodart/modules/scope/` · route `#/woodart/scope/…`
Owns `wa_spaces`, `wa_phases`, `wa_requirements`, `wa_phase_templates`.
Reads `wa_projects`, `wa_materials`, `wa_cost_codes`, `employees`.

Every screen is scoped to one project, chosen by a picker that writes a **query
param** so the URL is sendable — the router already parses `?` into `ctx.params`
(`platform/core/router.js:52-56`), so this needs no router change:

```
#/woodart/scope/spaces?p=WAP-102
```

| Sub | Screen | Answers |
|---|---|---|
| `spaces` | **Spaces** | What is this project divided into? Space cards: kind, area, phase strip, progress, planned cost vs quote. `[+ Add Space]` → name · kind · area → applies the template → phases exist immediately. |
| `phases` | **Phase Board** | Where is every space right now? A grid — spaces down, phases across — each cell showing status + owner initials; click to open the phase drawer (owner, dates, status, requirements). |
| `materials` | **Material Demand** | What does this project need to buy? Every `material` requirement rolled up per item: total qty · in stock · shortfall · planned cost, with `Send to Quotation` and `Raise PO` (hands off to Procurement — it does not raise one itself). |
| `load` | **Team Load** | Who is carrying what? Per person: active phases, spaces, planned value — mirrors `design/load` and `production/load` so the house pattern holds. |

The **phase drawer** is where the owner's daily work happens: assign the
responsible person from a dropdown of Woodart staff, set status and dates, and
add requirement lines (material picker from `wa_materials` + free text; labour
with men × days × rate; contract lump sum).

### 5.2 "Assign a specific person from the Epal company"

Read-only from the group `employees` store via `EPAL.db.employees({companyId:
'woodart'})` — today Imtiaz Chowdhury (Lead Interior Designer), Sumaiya Akter
(Production Supervisor), Jahangir Alam (Installation Foreman). HRM owns those
records; this module stores only `ownerId` on the phase. **No employee data is
duplicated and no HR feature is invented** (R3).

An owner who no longer exists is shown as **Orphan** and kept, never hidden —
the house rule from `NAMING-AND-TERMINOLOGY.md` §2.

### 5.3 `contractors` — "Contractors & Labour"  *(new module)*

`companies/woodart/modules/contractors/` · route `#/woodart/contractors/…`
Owns `wa_contractors`, `wa_engagements`. Reads `wa_phases`, `wa_spaces`,
`wa_requirements`, `wa_projects`.

| Sub | Screen | Answers |
|---|---|---|
| `register` | **Contractor Register** | Who can we hire? Name · trade · type · rate · rate basis · rating · status. Filter by trade (Electrician, Carpenter, Painter, Mason, Plumber, Tiles, Labour). |
| `engagements` | **Engagements** | Who is hired where? Per hire: contractor → project / space / phase, men × days × rate, amount, dates, status. Hire directly from a phase's labour requirement (one click carries the numbers across). |
| `estimate` | **Labour Estimate** | What will the people cost on this job? Per project: planned labour + contract requirements vs engaged amounts, by trade and by phase — planned · engaged · variance. |

### 5.4 `estimates` → new sub-screen `builder` — the master quotation builder

**Not a new module** — the quotation already has a desk, and a second one would
mean two places that both claim to hold the quote.

`#/woodart/estimates/builder` — pick a project, and every requirement in it
arrives grouped Space → Phase:

```
BUILDER · WAP-102 Munshi Villa Duplex          markup [ 28 % ]  [Apply to all]

▼ SPC-001 Master Bed Room                            cost 4,86,400   quote 6,22,600
   ▼ Wood Work            (Sumaiya Akter)
       Marine Plywood 18mm      24 sheet   3,400   →  4,500     81,600 / 1,08,000
       Laminate — Walnut        18 sheet   1,250   →  1,650     22,500 /   29,700
       Carpenter (labour)       12 m-days    900   →  1,150     10,800 /   13,800
   ▶ Colour & Paint       (—)                                   38,000 /   48,600
▶ SPC-002 Kitchen                                    cost 7,40,100   quote 9,47,300

                                     TOTAL  cost 12,26,500   quote 15,69,900   margin 22%
                    [ Save as Estimate ]  [ Update EST-118 ]  [ Print Quotation ]
```

**It writes into the existing `wa_estimates` record shape** — `lines:[{item, qty,
unitCost, unitSale}]` — so Quotations, BOQ and Costing keep working untouched
(R2). It adds two optional fields that old screens ignore: `space` and `phase` on
each line, plus `builtFrom:'scope'` on the estimate. Round-trip rule: **the
builder never silently overwrites a Sent or Approved estimate** — it creates a
new revision and says so.

### 5.5 What the flows look like end to end

```
1  Projects → New Project                 (unchanged screen, existing form)
2  Scope → Spaces → Add Space             template applies the phase list
3  Phase drawer → assign owner            from Woodart staff
4  Phase drawer → add requirements        material · labour · contract
5  Scope → Material Demand                total vs stock → shortfall
      ├→ Estimates → Builder              markup → quotation → EST-###
      └→ Procurement → Purchase Order     existing module, existing posting
6  Contractors → Register → Engagements   hire the electrician onto that phase
7  Cost control (profile plan slice 2)    budget = requirements
                                          committed = POs + engagements
                                          actual = ledger
8  Projects → Bill on Handover            unchanged — still the only revenue path
```

## 6 · Estimation — stated once, computed once

```
line.cost   = qty × unitCost          (qty = men × days for labour, 1 for contract)
line.quote  = qty × unitSale          (unitSale = unitCost × (1 + markup) when applied)

phase.cost  = Σ lines            space.cost   = Σ phases       project.cost  = Σ spaces
phase.quote = Σ lines            space.quote  = Σ phases       project.quote = Σ spaces

margin      = quote − cost            margin%  = margin ÷ quote
```

One implementation, in `scope/frontend/api.js`, exposed as `Scope.totals(id)` and
re-used by the builder, the labour estimate and the cost matrix. The same
function backs the Laravel endpoint, so browser and server cannot disagree —
the seam rule from `MODULE-STANDARD.md` §3.

## 7 · Build order — six slices, each shippable on its own

| # | Slice | Delivers | Gate |
|---|---|---|---|
| **1** | `scope` module: `wa_spaces` + reshaped `wa_phases` + templates → **Spaces** and **Phase Board** screens, owner assignment | the hierarchy and "who is responsible", live | sweep both themes, `verify:tw` |
| **2** | `wa_requirements` + the phase drawer's requirement editor + **Material Demand** | "what materials this phase needs" and the material listing | shortfall matches stock by hand-check |
| **3** | `estimates` → **Builder** sub-screen | the master quotation builder | existing quotation screens byte-identical |
| **4** | `contractors` module: register + engagements + labour estimate | electrician / labour hiring and its estimate | no new money path — assert 0 postings |
| **5** | `wa_budget_lines` derived from requirements; committed = POs + engagements | the cost-control matrix lights up (profile plan slice 2) | group totals unchanged |
| **6** | Laravel slice per module (two commits per module, `MODULE-STANDARD.md` §7) | real backend | migrated + seeded + CRUD-tested vs MySQL |

Slices 1–2 are the owner's core ask and are worth shipping even if nothing else
follows. Each slice ends runnable and committable (R5, R6).

## 8 · Registration checklist — per new module (the gates that bite)

For **each** of `scope` and `contractors`:

1. `platform/core/config.js` → add `m('scope','Spaces & Phases','grid-1x2-fill',
   {subs:[…]})` to `WOODART_MODULES`, in Band C (delivery), next to `projects`.
2. `companies/woodart/module.json` → same module with `"built": true`.
3. `companies/woodart/modules/<id>/module.json` → **the module's own manifest**
   (the trap in `MODULE-STANDARD.md` §8: `built:true` without this file = every
   route renders empty with zero console errors).
4. `index.html` → one `<script src="companies/woodart/modules/<id>/view.js">`.
5. `frontend/{template.html, api.js, <id>.js}` → rebuild with
   `node tools/build/build-module.mjs companies/woodart/modules/<id>`.
6. `README.md` + `context.md` + `backend/endpoints.md`.
7. Seeds in `platform/data/seed-bd.js`, idempotent, guarded by
   `localStorage.getItem(...) === null` like the existing Woodart blocks.
8. `node tools/verify/sweep.mjs both` → 0 errors, and the new routes counted.

For the `estimates` builder sub: add `['builder','Quotation Builder']` to the
subs in `platform/core/config.js`, `companies/woodart/module.json` **and**
`modules/estimates/module.json`, then handle `ctx.subId === 'builder'` in that
module (§B of `docs/ADDING-A-FEATURE.md`).

**Prefixes claimed** in `NAMING-AND-TERMINOLOGY.md` §1.1: `SPC · PHS · REQ ·
CON · ENG · TPL`.

## 9 · What this plan deliberately does NOT do

- **Does not touch `projects/view.js` screens.** Project registration, the design
  kanban, the drawer, milestones, gallery and "Bill on Handover" stay exactly as
  they are (R1/R2). The rebuild of that module is still item #9 in `ROOT-MAP.md`
  §6 — this plan makes it *easier*, because spaces/phases will already have a
  home.
- **Adds no second billing or payment path.** Engagements are committed cost.
  Revenue posts only from `projects`; vendor and contractor payment only from
  `accounts` — `ROOT-MAP.md` §4.
- **Invents no HR.** Assignment reads the existing `employees` store.
- **Does not rename `supplier` → `vendor`.** That cleanup stays scheduled behind
  the FK migration (`NAMING-AND-TERMINOLOGY.md` §3.2).
- **Does not convert old screens to Tailwind.** New markup is built to the
  current standard (component classes + `tw-` utilities); Phase 4 still converts
  everything else together.
- **No day-work attendance logs and no in-module payments** — the owner chose the
  register + hire + estimate scope. Both drop in later without reshaping
  anything: day-work is a child table of `wa_engagements`, payment is an
  `EPAL.pay` call from the Accounts desk.

## 10 · Open — flagged, with the default this proceeds on

1. **Phase list per space kind.** Seeded templates above are drafted from the
   owner's sequence plus the Munshi sheet's heads. *Default: seed as written,
   editable per space.* One review from whoever runs site work would be worth
   more than any amount of guessing.
2. **Can a space be quoted and billed on its own?** (Client pays for the Kitchen
   separately.) *Default: no — one estimate per project, grouped by space.* The
   builder's grouping makes per-space billing a later slice, not a rewrite.
3. **`wa_phases` reshape.** Zero consumers verified today; the seed is rewritten
   in the same commit. *Default: proceed.* If the profile plan's project-level
   strip is wanted first, it reads the derived roll-up instead.
4. **Space progress weighting.** *Default: weight by phase planned cost*, so a
   ৳4 lakh wood-work phase does not count the same as a ৳15,000 handover phase.

---

**Related:** `PROJECT-PROFILE-PLAN.md` (cost codes, cost control) ·
`ROOT-MAP.md` (the phase model) · `MODULE-STANDARD.md` (how a module is built) ·
`NAMING-AND-TERMINOLOGY.md` (words + prefixes) · `CONTEXT.md` (state) ·
`docs/ADDING-A-FEATURE.md` (registration) · `/CLAUDE.md` (R1–R8).
