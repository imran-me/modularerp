# CONTEXT.md — Woodart Interiors (the interiors master context)

> **This is the source of authority for everything inside `companies/woodart/`.**
> Read it before touching a single file here. It carries the vision, the locked
> build language, the module roadmap, the decisions and the state — so any
> developer, human or AI, can resume months later without losing any of it.
>
> **Read order:** this file → `ROOT-MAP.md` (the module map + phase model) →
> `MODULE-STANDARD.md` (how a module is built) →
> `NAMING-AND-TERMINOLOGY.md` (what things are called) →
> `platform/design-system/UI-CONTRACT.md` (how it must look) → the target
> module's own `context.md`.
>
> Repo-wide law still applies on top: `/CLAUDE.md` (R1–R8) and `/CONTEXT.md`
> (the frontend build law + project-wide state).

---

## 1 · The company

**Woodart Interiors** — design · build · fit-out. A design-build interiors house:
enquiry → design → estimate/BOQ → workshop fabrication → site installation →
snagging → handover → billing.

| | |
|---|---|
| Folder | `companies/woodart/` |
| Route prefix | `#/woodart/...` |
| Accent | `#6f9c1c` |
| Icon | `tree-fill` |
| Atmosphere scene | `app/atmosphere/interior-scene.{css,js}` (bound via `data-atmos="woodart"`) |
| Modules declared | 16 (`module.json`) |
| Modules actually built | **7** — `design` + `materials` + `clients` + `procurement` + `production` + `installation` (✅ to the standard) and `projects` (legacy, also registers `estimates`) |

**Group rollup (`bridge.map` — already declared, wired in `platform/bridge/bridge.js`):**

```
project.invoiced     -> group.revenue    (4001)
milestone.billed     -> group.revenue    (4002)
material.purchased   -> group.expense    (5002)
expense.recorded     -> group.expense    (5001)
```

---

## 2 · 🟥 THE BUILD LANGUAGE — LOCKED (owner, 2026-07-27)

Restated here because it is the reason this document exists. Full detail in
`MODULE-STANDARD.md` §2 and `platform/design-system/UI-CONTRACT.md`.

1. **Modular, always.** Every feature is a self-contained module folder carrying
   its **whole** stack — frontend, backend, PHP, migrations, docs. Nothing about
   a module lives outside its folder.
2. **HTML is the core build.** Nav bar, text, buttons, pages, containers, cards,
   tables — the skeleton — is **fixed, plain HTML** in `frontend/template.html`.
   **Never built by JS.** **No `<script>` tag, no `<template>` tag in that file.**
3. **CSS is the styling — and every UTILITY is Tailwind** (owner, 2026-07-27:
   *"styling only Tailwind CSS and JS"*). Spacing, flex, size, weight, colour →
   `tw-`. The house COMPONENT classes stay (`.card`, `.kpi-card`, `.btn`,
   `.page-head`) because they are the universal vocabulary that keeps every
   company identical — `class="card tw-max-w-[320px]"`. Convert by **value**,
   not by name: house `.mt-1` is 6px, Tailwind's `mt-1` is 4px (D12).
4. **JS is animation, effects, complex styling, live data and behaviour** — and
   nothing else. It never authors the skeleton.
5. **Universal styles and types are saved once and reused everywhere.** The nav
   bar is the same on every screen of every company because it is authored once,
   in the platform. A module that re-authors shared chrome is wrong. See the
   UI-CONTRACT.
6. **A data seam per module (`frontend/api.js`).** A screen calls
   `Materials.stock()` — never `EPAL.db.col('wa_materials')`, never a URL.
   Flipping a module onto Laravel becomes a one-line change in one file instead
   of an edit to every screen.
7. **The backend is real Laravel**, written the way a developer writes it:
   routes · one thin Controller **per entity** · a Service holding the business
   logic · Eloquent Models · migrations · Form Requests · API Resources ·
   seeders. Never a "standalone view.js pretending to be a backend".
8. **Written for handover.** Clear structure, file header blocks, a conventions
   legend in every template, comments that say *why*. Every module ships a
   `README.md`, its own `context.md`, and a frozen `backend/endpoints.md`.
9. **Two commits per module** — frontend, then backend. Never mixed.
10. **Nothing is deleted.** Existing features are assets. Modules only advance.

---

## 3 · State of play — honest, as of 2026-07-27

### Built
| Module | Routes | Frontend | Backend | Standard |
|---|---|---|---|---|
| **`design`** (Design & 3D) ⭐ | `#/woodart/design/{register,approvals,load}` | ✅ real HTML + a revision-trail drawer; seam owns the lifecycle, the **phase gate** and the clock | ✅ 10-file slice, READ-ONLY revision controller + frozen `endpoints.md` · **41/41 vs MySQL** | ✅ the first module built from the ROOT MAP |
| **`installation`** (Site & Install) | `#/woodart/installation/{schedule,snags,teams}` | ✅ real HTML, `[data-proto]`, all utilities Tailwind, `api.js` seam owning the **dual-shape snag count** + open/overdue + the demo clock | ✅ 8-file slice whose write path RECOMPUTES the snag count from the list + frozen `endpoints.md` · **42/42 vs MySQL** | ✅ to the standard · handover billing deliberately left to `projects` |
| **`production`** (Workshop) | `#/woodart/production/{jobs,board,load}` | ✅ real HTML — board COLUMNS are fixed markup, cards are `[data-proto]` clones; `api.js` seam owns the open/overdue rules + the demo clock | ✅ 8-file slice, `$today` INJECTED not hidden + frozen `endpoints.md` · **41/41 vs MySQL** | ✅ to the standard |
| **`procurement`** | `#/woodart/procurement/{orders,vendors,spend}` | ✅ real HTML, `[data-proto]`, all utilities Tailwind, `api.js` seam owning **two stores** + the order→vendor name join | ✅ 12-file slice (2 controllers, 1 shared service) + frozen `endpoints.md` · **40/40 vs MySQL** | ✅ to the standard · ✅ ledger posting RESOLVED (goods receipt → 1400/2000) |
| **`clients`** | `#/woodart/clients/{directory,portfolio,segments}` | ✅ real HTML, `[data-proto]` repetition, all utilities Tailwind, `frontend/api.js` seam owning the **name join** to projects/estimates | ✅ 9-file Laravel slice + frozen `endpoints.md` · **37/37 vs MySQL** (both join branches) | ✅ to the standard |
| **`materials`** ⭐ | `#/woodart/materials/{stock,reorder,valuation}` | ✅ real HTML, zero `<script>`/`<template>`, `[data-proto]` repetition, **all utilities Tailwind**, `frontend/api.js` seam | ✅ 9-file Laravel slice + frozen `endpoints.md` · **26/26 CRUD+rules vs MySQL** | ⭐ **THE REFERENCE MODULE** — copy its shape |
| **`scope`** (Spaces & Phases) ⭐ | `#/woodart/scope/{spaces,phases,load}` | ✅ real HTML, `[data-proto]` cards + rows, all utilities Tailwind (0 new classes), `api.js` seam owning the **space → phase hierarchy**, the derived progress/status and the assignment read of `employees` | ⬜ **owed** — `endpoints.md` frozen + blueprint written; PHP is slice 6 | ◑ frontend to the standard · backend outstanding |
| `projects` | `#/woodart/projects/{active,design,milestones,gallery}` and `#/woodart/estimates/{quotations,boq,costing}` | **legacy** — one 1,238-line hand-written `view.js`, 100% `el()` script-DOM, no `frontend/` sources | **none** — only `backend/LARAVEL-BLUEPRINT.md` | ❌ fails every gate |

`projects/view.js` is a genuinely rich screen — kanban design studio with drag-
to-advance, project drawer with Estimate/BOM · Production · Install & Snags ·
Billing tabs, snag checklists, aggregated BOQ, costing analysis, "Bill on
Handover" posting through `db.postSale('woodart', …)` into Woodart **and** Group
finance, and a branded invoice via `EPAL.doc.open`. **All of that behaviour is
kept.** The rebuild is structure + styling only, pixel-identical (R1/R2).

### Not built — render the generic placeholder scaffold today
`dashboard` · `crm` · `estimates` (menu entry; its screen is registered from
inside `projects/view.js`) ·
`accounts` · `ledgers` · `hrm` · `reports` · `analytics` ·
`tasks` · `settings`.

### Data stores that already exist (seeded by `platform/data/seed-bd.js`)
`wa_projects` · `wa_estimates` · `wa_production` · `wa_installs` ·
`wa_materials` · `wa_purchases`

`wa_materials` and `wa_purchases` **already carry seeded demo data but have no
screen** — the Materials and Procurement modules have their data waiting for them.

### The important structural difference from Travels
Travels modules were *converted* — they had a working look that had to be
matched pixel-for-pixel. Woodart is almost entirely **greenfield**: 15 of 16
modules have no screen at all. So:

- **`projects` (+ its `estimates` view) = a REBUILD** → parity loop, byte-identical.
- **Everything else = a NEW BUILD** → no baseline exists; the gate is the
  UI-CONTRACT plus a clean sweep in both themes.

That means Woodart is the **first company that can be built to the standard from
the start**, rather than retrofitted into it. Treat it as the reference
implementation for IT, Shop and Construction.

---

## 4 · Build order — ⚠️ SUPERSEDED by `ROOT-MAP.md` §6

> The owner answered the architecture question on 2026-07-27: **architecture /
> 3D modelling is a PHASE of a project, not a service module.** That produced
> the real map (`ROOT-MAP.md`), which reorders what follows: **`design` is now
> #6** (the phase with no home — the biggest structural gap in the company), and
> **`projects` moves later**, because rebuilding it before `design` and
> `estimates` exist would mean rebuilding it twice.
>
> The table below is kept for the reasoning behind items 1–5, which is unchanged.

### (superseded) the original order

Simplest → hardest, each one full-stack and 100% done before the next.

| # | Module | Why here | Owns |
|---|---|---|---|
| 1 | ✅ **materials** | smallest real CRUD, data already seeded — proves the whole standard end to end | `wa_materials` |
| 2 | ✅ **clients** | simple master with a real relationship to projects | `wa_clients` |
| 3 | ✅ **procurement** | vendors · POs · spend | `wa_purchases`, `wa_vendors` |
| 4 | ✅ **production** | workshop jobs — lifted out of the project drawer into their own desk | `wa_production` |
| 5 | ✅ **installation** | site, teams, snag checklists | `wa_installs` |
| 6 | **crm** | design enquiries → site visit → deal → estimate | `wa_leads` (new) |
| 7 | **estimates** | quotations · BOQ · costing — split out of `projects/view.js` into its own module | `wa_estimates` |
| 8 | **projects** | the big one; rebuilt pixel-identical | `wa_projects` |
| 9 | **accounts** | money desk; reuses `EPAL.pay` + the master-accounts backend | shared |
| 10 | **ledgers** | read-only statements off `EPAL.ledger` | none |
| 11 | **dashboard** | needs 1–10 to have something to show | none |
| 12 | **reports** · **analytics** | read-only | none |
| 13 | **hrm** · **tasks** · **settings** | follow the Travels equivalents | various |

**Rationale for starting at `materials`, not `dashboard`:** a dashboard reads
every other module, so building it first means building it twice. Materials is
one entity, one table, seeded data, a clear Laravel slice — the perfect first
lap to prove the full standard (HTML skeleton + seam + real backend + two
commits + eight gates) before anything expensive depends on it.

---

## 5 · What every Woodart module must produce

The full recipe is `MODULE-STANDARD.md`. The eight gates, in short:

1. registered in **both** `platform/core/config.js` and `module.json` (`built:true`)
2. `<script>` tag added to `index.html`
3. `frontend/template.html` = the whole screen as HTML, zero `<script>`/`<template>`
4. `frontend/api.js` is the only file naming a store key or URL
5. `view.js` rebuilt via `tools/build/build-module.mjs` and committed
6. visual proof — parity byte-identical (rebuild) or sweep-clean both themes (new)
7. real Laravel slice, migrated + seeded + CRUD-tested against local MySQL
8. `README.md` + `context.md` + `backend/endpoints.md` written; sweep 0 errors;
   this file updated; pushed

---

## 6 · Decisions — LOCKED (do not re-litigate)

| # | Date | Decision | Why |
|---|---|---|---|
| D1 | 2026-07-27 | HTML skeleton, CSS styling, JS behaviour — and **no `<script>`/`<template>` in `template.html`** | The template must open in a browser and *be* the screen. Anything else is unreadable at handover. |
| D2 | 2026-07-27 | Every module carries its whole stack in its own folder | Drop-in/drop-out: delete the folder, the module leaves the menus and the Group books. |
| D3 | 2026-07-27 | `frontend/api.js` data seam is mandatory | Otherwise every screen must be edited when Laravel lands. One file, one line. |
| D4 | 2026-07-27 | `endpoints.md` is split out of `LARAVEL-BLUEPRINT.md` and frozen | The frontend is built against a fixed API surface before any PHP exists. |
| D5 | 2026-07-27 | `README.md` + `context.md` per module | Handover to another developer must not require reading a blueprint end to end. |
| D6 | 2026-07-27 | Two commits per module: frontend, then backend | Each half is independently reviewable and deployable; a backend bug never bisects into styling. |
| D7 | 2026-07-27 | Universal chrome is authored once in the platform, never per module | "Nav bar, all same everywhere." A module that forks shared chrome is a defect. |
| D8 | 2026-07-27 | One controller per entity, business logic in a Service | Thin controllers are the Laravel convention and keep the slice testable. |
| D9 | 2026-07-27 | `projects` is rebuilt **pixel-identical**, keeping every behaviour | R1/R2 — it is a working screen; the rebuild is structure + styling only. |
| D10 | 2026-07-27 | Money never floats — integer BDT everywhere | Matches the existing ledger engine and avoids rounding drift in consolidation. |
| D12 | 2026-07-27 | **Every utility is Tailwind; component classes stay** — and conversions are value-exact, not name-exact | Owner: *"styling only Tailwind CSS and JS."* Re-expressing `.card`/`.page-head` as utility strings inside one module would fork the shared look the moment `components.css` changes — the opposite of D7. So utilities convert, components don't. Value-exact because the scales disagree: house `.mt-1`=6px vs Tailwind `mt-1`=4px, `.xs`=11px vs `text-xs`=12px. |
| D11 | 2026-07-27 | **Tailwind is the styling layer** — unblocked, version pinned exactly, enforced by `npm run verify:tw` | The owner's stated preference. The old block was stale: a fresh build is byte-identical to the committed CSS (md5 matched on 3.4.17 **and** 3.4.19), all 17 `tw-` literals are static, and **zero** classes are composed in JS. Woodart is greenfield, so building it on house CSS would mean writing 16 modules twice. |

---

## 7 · ❓ OPEN — flagged, proceeding on the stated default

Owner said "do whatever needed, but lock in my preference" (2026-07-27), so each
of these now has a **default that work proceeds on**. Say the word to change one;
none is blocking.

1. ~~**Tailwind: unlock or stay on house CSS?**~~ → **RESOLVED, D11.** Unlocked,
   pinned, gated. See §6 above and UI-CONTRACT §6.
2. **Build order** — §4 stands: start at `materials`, finish at `settings`.
   *Default: proceed.* Change it if a desk is needed sooner for business reasons.
3. ~~**Ownership of the `estimates` screens.**~~ → **RESOLVED by `ROOT-MAP.md`**:
   `estimates` becomes its own module at #8, between design and production.
   Original note: registered inside `projects/view.js`
   today, but `estimates` is its own menu module. *Default: split it into
   `modules/estimates/` when module #7 comes up* — not before, because it moves
   working routes and must be done with a parity proof, not casually.
4. **New stores** — `wa_clients`, `wa_vendors`, `wa_leads` do not exist yet.
   *Default: create them with those names, seeded with demo data* like the other
   `wa_*` stores, so the screens have something to render on the demo site.

---

## 8 · Log

| Date | What | Commit |
|---|---|---|
| 2026-08-06 | **INTERIOR DEMO DATA REPLACED BY ONE REAL PROJECT** (owner: *"remove demo data from interior only, and make only one demo project across all the system of interior, in different phase, related fields"*). Woodart carried 16 randomly generated projects PLUS three hand-written story projects; it now carries exactly **one — `WAP-101` Munshi Villa Duplex** — and every record in every module hangs off it: 11 spaces, 86 phases, 7 drawings + 11 revisions, a 24-line coded BOQ, 21 budget heads, 7 purchase orders, 24 stock movements, 4 workshop jobs, 3 site visits, and every taka of income and expense. **The figures are the business's own**, from `Assets/MUNSHI-VILLA-SHEET.md`: contract ৳70,00,000 · received ৳40,00,000 (three payments) · spent ৳23,48,257 across 13 heads, reproduced to the taka. The sheet's five empty pages (Tiles · Paint · Metal · Aluminium · Wood Work) become **Not started** phases, so the Phase Board shows what the spreadsheet shows. Woodart was removed from the random `acc_entries` / `sales` / `acc_schedules` generators — a random "Project Billing" would reference no project — and its financial scale dropped from ৳26L/month to ৳7.8L, because one villa is not a portfolio. Four **Civil** materials (rod · cement · bricks · sand) joined the register at their real rates so the largest spend on the job is explainable in stock terms; that added a `Civil` category and `bag`/`cft` units to the materials module. A **versioned one-time reset** (`WA_DEMO_VERSION`) drops every `wa_*` store and every woodart row in the shared money stores on next load, so an existing browser actually sees this — and touches no other company. `books.mjs story` was rewritten from "three stories thread" to "**one project threads, at the sheet's own figures**", and now fails if any Woodart record names a different project; `refs` learned that a BOQ prices labour as well as materials (`kind`), so a mistyped material name still fails while a rajmistri does not. Sweep **257/257 both themes**, refs ✓, trial balance ✓, stock invariant ✓, scope probe 20/20. | — |
| 2026-08-06 | **MODULE `scope` (Spaces & Phases) BUILT — frontend**, slice 1 of `PROJECT-BREAKDOWN-PLAN.md` (the owner's brief of the same day). The company gains the level it was missing: **project → space → phase → the person responsible**. Three screens — Spaces (a card per room with its phase strip), Phase Board (a row per phase carrying its responsible person, status, cost code and dates), Team Load (who is carrying what, company-wide, plus the unassigned queue). New stores `wa_spaces` and `wa_phase_templates`; **`wa_phases` moved down a level** to belong to a space rather than a project — safe because it was seeded 2026-07-28 and read by **no screen** (grep-verified), and a second phase table would have drifted the day anyone wrote to one of them. Three rules carry the weight: **a template only ever appends the phases a space is missing** (pressing it twice can never wipe assigned work); **deleting a space deletes its phases**, because a phase whose space is gone still counts in every roll-up while being impossible to open; and **every figure is derived** — progress, a space's status, the project totals and the team load are computed on read, so no stored total can drift. Registered in all three places + `index.html`; **no money, no bridge event, no posting**. New probe `tools/verify/scope.mjs` drives the REAL seam (template → assign → derive → overdue → delete) **20/20**. Sweep **257/257 both themes, 0 errors**; tailwind gate green with **0 new classes**. | — |
| 2026-07-27 | Master context created. Build language locked (D1–D10). `MODULE-STANDARD.md` + platform `UI-CONTRACT.md` written. `build-module.mjs` extended with the optional `frontend/api.js` data seam — verified: all 20 existing modules rebuild **byte-identical** (zero git diff). | — |
| 2026-07-27 | **MODULE #6 `design` (Design & 3D) BUILT full-stack** — the gap the root map exposed: every other delivery phase had a module owning its work, the architecture/3D phase had none. Drawing Register · Approvals · Design Load, plus a drawer showing the revision trail. Three rules: **`Issued` is the only state where the wait is the CLIENT's** (Commented came back to us, so it is excluded from the queue); **the trail is EVIDENCE** — its own table, written by the service, and `RevisionController` is READ-ONLY so a client cannot fabricate an approval; and **the PHASE GATE** — a project is design-complete only when it HAS deliverables AND all are Approved, because treating "no work" as "finished" would let a project sail through having done nothing. Stores wired CONDITIONAL from the start. Sweep **241/241**, backend **41/41 vs MySQL**. | — |
| 2026-07-27 | **✅ PROCUREMENT LEDGER POSTING RESOLVED + SHIPPED.** The open decision needed no judgement call — the chart of accounts answers it, and it exposed an error in my own blueprint (I wrote "inventory (1200)"; **1200 is Accounts Receivable** — the COA has a real **1400 Inventory** and **2000 Accounts Payable**). A goods receipt now posts **DR 1400 / CR 2000** on `Received` only (a PO is a commitment; `Partial` has no part-received amount to post). Because it lands on the BALANCE SHEET while `projects` posts `5000` on the P&L at sale, the double-count risk that blocked the decision **cannot happen**. Paying the vendor stays with the accounts desk. Reversals are real reversals (`…-R2` on re-receipt; `glAttempt` carried across edits). `bridge.map` corrected `group.expense (5002)` → `group.inventory (1400)`. New probe `books.mjs receipt` drives the REAL seam via a documented `EPAL.diag` hook. Sweep 237/237, trial balance balances. | — |
| 2026-07-27 | **MODULE #5 `installation` (Site & Install) BUILT full-stack** — Schedule · Snag List · Teams. Closes the physical chain Materials → Procurement → Workshop → Install. Its hard rule is the **dual-shape snag count**: the seed carries a plain number, the Projects snag modal itemises it into `[{text,done}]` on first open, so a record may carry EITHER — read counts the list first, and **write RECOMPUTES the number from the list** so a stale client count cannot corrupt the figure the handover queue is ordered by (proven: a deliberately wrong 99 sent with a 3-item list stored as 2). **Handover billing deliberately NOT wired** — `projects/view.js` already posts the sale, and a second path would double-bill every project. PHP 8/8, sweep **237/237 both themes**, backend **42/42 vs MySQL**. | — |
| 2026-07-27 | **MODULE #4 `production` (Workshop) BUILT full-stack** — Job Register · Workshop Board · Station Load. The board is the clearest example of the build law's line: its four COLUMNS are fixed markup (they are the workshop's states, not data) and only the CARDS are `[data-proto]` clones. The demo clock is an **explicit constructor argument** on the service, never a hidden `now()`, and is echoed by `GET /load` — proven by tests that move the clock and watch the overdue count move with it. An orphan job (project id that no longer exists) is KEPT and flagged, never hidden. PHP 8/8, sweep **234/234 both themes**, backend **41/41 vs MySQL**. | — |
| 2026-07-27 | **MODULE #3 `procurement` BUILT full-stack** — Orders · Vendors · Spend. First module owning TWO entities: two thin controllers over ONE shared service, because the rules that matter (the order→vendor name join, the outstanding rule, the roll-ups) span both. New store `wa_vendors` seeded DERIVED. **⚠️ Ledger posting deliberately NOT wired** — `bridge.map` declares `material.purchased → 5002` but three accounting questions are unanswered (on order or on receipt? expense or inventory-asset? paid from cash or a payable?) and guessing corrupts the books; recorded as an OPEN OWNER DECISION and the module ships as an honest register. PHP 12/12, sweep **231/231 both themes**, backend **40/40 vs MySQL** including the unlisted-supplier rule (an order on a supplier with no vendor record is COUNTED, never dropped) and a case/whitespace-insensitive join. | — |
| 2026-07-27 | **MODULE #2 `clients` BUILT full-stack** — 3 real-HTML screens (Directory · Portfolio · Segments), `api.js` seam owning the client→work NAME join, 9-file Laravel slice, frozen `endpoints.md` v1. `wa_clients` seeded DERIVED from real project/estimate client names + wired into api.js HYDRATE/WRITABLE. PHP 8/8, tw gate green (no new classes), **sweep 228/228 both themes**, backend **37/37 vs MySQL** proving BOTH join branches (absent work table → graceful zero; present → case/whitespace-insensitive roll-up that ignores unknown clients). | — |
| 2026-07-27 | **MODULE #1 `materials` BUILT full-stack** — the reference module. 3 real-HTML screens (Stock · Reorder · Valuation), `frontend/api.js` seam (the store key appears nowhere else), 9-file Laravel slice, frozen `endpoints.md`, README + context. Wired `wa_materials` into api.js HYDRATE + WRITABLE. All utilities converted to Tailwind (7 new classes, value-exact, purely additive 17→24 rules). PHP 8/8 lint clean. **Sweep 225/225 × both themes, 0 errors.** Backend MySQL test still owed. | — |
| 2026-07-27 | **Tailwind UNBLOCKED (D11)** — the recorded block was stale. Proved a fresh build is byte-identical to the committed CSS (md5 `fa2b2623…`, 577 bytes) on **both** 3.4.17 and 3.4.19; all 17 `tw-` literals are static; zero classes composed in JS. Pinned the version exactly (no caret) in `package.json` + `package-lock.json`; documented `safelist` (intentionally empty) in the config; added **`tools/verify/tailwind.mjs`** (`npm run verify:tw`) enforcing REPRODUCIBLE + NO-ORPHANS, self-tested red-then-green. Built CSS unchanged. | — |
