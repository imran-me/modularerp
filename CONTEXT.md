# CONTEXT.md — Epal Group ERP

> 🟥🟥🟥 **FRONTEND BUILD LAW — OWNER COMMAND (2026-07-26), RESTATED FORCEFULLY. NEVER
> EVER FORGET OR WATER THIS DOWN.** 🟥🟥🟥
>
> **Every screen's ENTIRE UI is authored as REAL, PLAIN HTML** — every container, card,
> KPI, button, bar, tab band, page-head, company switcher, form, and table STRUCTURE is
> written out as readable HTML markup that IS the screen. **NOT built by JavaScript.**
> Both of these are REJECTED: (1) `el()` / hyperscript JS-DOM assembly, and (2)
> `<template data-tpl="…">` fragment-cloning with `frag()`/`slot()`. Opening the HTML
> file must show the whole screen as HTML — head bar to footer.
>
> - **HTML** = the foundation/structure of EVERYTHING on the screen.
> - **CSS + Tailwind + a custom `style.css` + Bootstrap** = colors, styling, layout.
> - **JS = ONLY where truly needed:** hover effects, animations, filling LIVE DATA into
>   the HTML placeholders, and feature behavior (a data grid's sort/search/pagination).
> - **PIXEL-PERFECT, PROVEN:** for each screen run the before/after screenshot loop and
>   iterate until it is **100% byte-identical to the CURRENT view**, THEN move to the next.
> - **ORDER:** Master Accounts + Travels FIRST, then every other module, one at a time.
> - Earlier claims that screens were "converted to markup" were WRONG — they were still
>   JS-built (`el()`) or `<template>`-cloned. This law supersedes all of that. Redo them.
> - **BACKUP RULE (owner):** BEFORE converting a module, COPY its current frontend files
>   to `_frontend-originals/<company>/<module>/` and KEEP them there even after changing.
>   Use that backup + the `.parity/<module>-before` screenshots to **cross-check** the new
>   HTML build against the old, running the loop until it matches **100% (byte-identical)**,
>   THEN move to the next. Never delete the backup.
>
> (Proven pattern started: master-accounts `<section data-screen="party-types">` in
> template.html is real HTML; party-types route verified byte-identical. Extend this to
> EVERY element of EVERY screen — including the page-head bar, tab bar, switcher.)

> 🎨 **STYLING METHOD — decided 2026-07-26 (owner: "custom effects/concepts in custom
> CSS, rest universal CSS in Tailwind") · ✅ TAILWIND UNBLOCKED 2026-07-27.**
> The 2026-07-26 pilot deferred Tailwind because `npm run tw:build` appeared not to
> reproduce the committed `platform/design-system/css/tailwind.built.css` — dropping
> arbitrary-value classes (`tw-max-w-[320px]`…) believed to be built dynamically in JS
> and silently breaking untouched screens (cash/loans/payroll).
> **That block was re-tested on 2026-07-27 and is STALE.** Measured, not assumed:
> a fresh build is **byte-identical** to the committed file (md5 `fa2b2623…`, 577 bytes)
> on **both** `tailwindcss@3.4.17` and `@3.4.19`; all **17** `tw-` class literals in the
> app are static; **zero** classes are composed in JS (the feared pattern does not occur —
> the one `tw-bg-surface` hit is a comment in tailwind.config.js, which is deliberately
> not scanned). All three prerequisites are now **DONE**: the version is pinned EXACTLY
> (no caret) in `package.json` + `package-lock.json`; `safelist` is documented in the
> config (intentionally EMPTY — an entry is a debt, not a feature); and losslessness is
> no longer a promise but a **gate**: `npm run verify:tw` → `tools/verify/tailwind.mjs`
> checks (A) a fresh build is byte-identical and (B) every `tw-` class used anywhere has
> a rule in the committed CSS — the failure that actually ships broken pixels, since prod
> is a static git-pull. Self-tested: it goes RED on an injected bad class and green again.
> **Rules when writing `tw-`:** never compose a class name (`'tw-max-w-['+w+'px]'` is
> invisible to the scanner — switch between whole literals); a genuinely computed value is
> an inline style, not a utility; run `npm run tw:build` **and** `npm run verify:tw` and
> commit the regenerated CSS with the screen. House component classes (`.card`, `.btn`,
> `.kpi-card`) stay the vocabulary for *what a thing is*; Tailwind is *where it sits and
> how it looks*. The legacy `layout.css`/`base.css` utilities still style every
> unconverted screen — **do not delete them** until all screens are converted (R4).
> Full detail: `platform/design-system/UI-CONTRACT.md` §6.

> 📖 **DEVELOPER-READABILITY pass done (2026-07-26):** master-accounts + finance
> `template.html` now open with a full conventions LEGEND (every `data-*` hook explained)
> and the shells/KPI cards are laid out multi-line — EXCEPT inline leaf runs (the `<h1>`
> eyebrow·icon·title, `<template data-tpl>` fragments) which stay one-line so cloned
> whitespace can't shift pixels. Both re-proven pixel-identical via the back-to-back loop.
> Backups at `_frontend-originals/_readability-backup/<module>/`.

> **This file is the project's long-term memory.** It exists so that any developer
> (human or AI) can resume work months later without losing the vision, the
> architecture, or the conventions. Read this first, always.

> 📌 **STANDING INSTRUCTION (owner, 2026-07-16):** keep THIS file continuously
> updated with all context + instructions, and **push it to GitHub every session**
> (it is the shareable resume doc). A private AI memory also exists at
> `C:\Users\User\.claude\projects\e--Imran-New-folder-newerp\memory\` (local, not
> pushed) — this file is the public mirror of the load-bearing parts.

> ⚠️ **AI-memory path moved (new machine, 2026-07-21):** the local memory that used
> to live at `C:\Users\User\.claude\projects\e--Imran-New-folder-newerp\memory\` is
> NOT on this machine. New path:
> `C:\Users\Epal\.claude\projects\h--Imran-Modular-ERP-Continious-File-modularerp-main\memory\`
> (currently empty — memories like `epal-bookkeeping-audit`, `epal-backend-migration`
> did not travel). This context.md is the surviving source of truth.

---

## 📍 WHERE THINGS STAND — 2026-08-07 (read this first)

**The focus is INTERIOR** (`companies/woodart/`). Its own
`companies/woodart/CONTEXT.md` carries the detail; the roadmap is
`companies/woodart/PROJECT-BREAKDOWN-PLAN.md`. Three things a new session needs
before touching anything:

**1 · The deployed site reads MySQL, not the browser seed.** `dev.epal.com.bd`
answers `/api/health`, so the SPA boots in **API mode** and
`platform/core/app.js` **skips `EPAL.db.seed()` entirely**. Every change to
`platform/data/seed-bd.js` is invisible there — that data lives in the database,
put there by each module's PHP seeder. **So ship the Laravel half in the same
pass**: migration · model · resource · controller · route · seeder, plus the
store wired into `platform/data/api.js` HYDRATE and CONDITIONAL. A clean
headless-browser sweep proves demo mode only. This cost two rounds of "nothing
changed" on 2026-08-06 before it was spotted.

**2 · Code deploys itself; the database never does.** The host pulls on its own,
so screens and calculations go live with no terminal step. Schema and demo data
do not: `deploy.sh` reports pending migrations and then stops, on purpose, and
the owner runs them. Steps: `docs/RESEED-INTERIOR.md`. Connection details live
in hPanel, deliberately not in this public repo.

**3 · One demo project, and only Interior's data may be reset.** Woodart carries
exactly `WAP-101` Munshi Villa Duplex at the real figures in
`companies/woodart/Assets/MUNSHI-VILLA-SHEET.md` — `node tools/verify/books.mjs
story` fails if a second project appears or a figure drifts. Reseeding is
per-company: `php artisan epal:reseed woodart` clears only what
`companies/woodart/app/backend/seeders.php` claims. **Never `migrate:fresh`** —
owner, 2026-08-06: *"not the whole database, but only the interior one"*.

Built since 2026-08-06: the `scope` module (spaces → phases → who is responsible
→ what each phase needs), Material Demand, the one-project demo across browser
**and** database, the read-only project profile, and a material ledger where
stock arrives in dated deliveries against an order and leaves room by room.
Next: the forms that let staff **record** those two things (a purchase order has
no line editor; issuing stock has no room picker), then the quotation builder,
then contractor hiring.

Verify with: `node tools/verify/sweep.mjs both` · `node tools/verify/scope.mjs` ·
`node tools/verify/books.mjs story|refs|stock`.

---

## ⭐ PRIORITY ORDER (owner, 2026-07-26) + LOOP DISCIPLINE

Owner set the order: **(1) Group Master Accounts → (2) Travels Accounts → (3) rest of
Travels → (4) everything else**, all full-stack (FE+BE), and re-do ALL to this standard.
Owner (caps) reinforced: **follow the loop — before/after screenshots, cross-check,
pixel-perfect match — for EVERY module.** Recorded in `docs/FULLSTACK-REBUILD-TRACKER.md`.

**✅ DONE — module = group-cockpit/master-accounts (priority #1), REAL-HTML rebuild.**
- ✅ **FRONTEND rebuilt to the FRONTEND BUILD LAW** — every route screen is now authored
  as a **real, plain-HTML `<section data-screen="…">` block** in `template.html` (NOT
  `el()`, NOT `<template data-tpl>` fragment-cloning). Screens done: `party-types`,
  `accounts`, `schedules`, `journals`, `expenses`, `overview`. The three top bars
  (page-head, tab band, company switcher) are real-HTML `<div data-shell="…">` blocks.
  JS only fills live data + wires buttons: helpers `screen(name)` / `shell(name)` clone
  the HTML block, `fillK()` writes `[data-k]` values, buttons wired via `[data-act]` /
  `[data-role]` / `[data-co]` / `[data-tab]` / `[data-type]`, data grids appended into
  `[data-fill]`, then `mountScreen(page, s)` moves the element children onto the page.
- ✅ **PROVEN PIXEL-IDENTICAL** — full 10-route parity diff (`.parity/master-accounts-before`
  vs `.parity/ma-html-final`) = **20/20 shots PIXEL-IDENTICAL, both themes**. Each screen
  was verified byte-identical as it was converted (party-types, accounts, schedules,
  journals, expenses, overview all `SAME`). Commits 6066875, 0b99d42, 7afc521 (+ earlier
  shell/party-types). Backup of originals kept at `_frontend-originals/group-cockpit/master-accounts/`.
- ◻ **Intentionally left as JS data-widgets (allowed by the law's "live data / feature
  behavior" carve-out):** the `banks` route summary panel + the shared bank-card GRID
  (`renderBankCardGrid`, one computed card per account — a data grid, like `EPAL.table`) +
  `bankAccountDetail` (computed hue gradients / running balances) + the config-driven
  `EPAL.formModal` forms. These are per-record computed widgets, not fixed screen chrome.
- ✅ **BACKEND COMPLETE** — 7 original controllers + party-types (b9d4f7c), expense-
  categories (d2f848c), acc_entries register (f4eaf2f, ext_id id-stability so the GL
  mirror can't double-post), loans 4-store book (7065a34), payroll 4-store book
  (32fe902). Loans/payroll use a document-style schema (ext_id/company_id/status columns
  + full record in `data` JSON) so the rich records + schedule arrays round-trip exactly.
  All migrated + tested vs local MySQL; api.js HYDRATE + WRITABLE wired for every store.

**➡️ MASTER ACCOUNTS COMPLETE** (routes = real HTML `<section>`, 20/20 pixel-identical · full tested backend).

**✅ GROUP FINANCE — FRONTEND real-HTML rebuild COMPLETE (priority #2, 2026-07-26).**
ALL 13 finance screens are now authored as real-HTML `<section data-screen>` blocks:
overview (top+bottom), pnl, cashflow, balance-sheet, receivables, payables (shared
`aging` section), banks, coa, journal, trial-balance, consolidation, concern-pnl,
group-expenses. Shared building blocks — `head()` (page-head bar), `pills()` (13-tab
band), `kpi()` (KPI tile), `chartCard()` (chart card w/ `<canvas>`) — are `<div data-shell>`
blocks, so every bar/KPI/chart across all screens is HTML from one edit each. JS only fills
live data + wires buttons + draws charts. Dynamic data-grids (`EPAL.table`, hand-built
consolidation matrix), computed inline-style strips (budget bars, balance-sheet line rows,
cash-by-concern bars) and the red-flag / period-lock panels stay JS (the law's "live data /
feature behavior" carve-out). Commits 6b30504 (split) → e3213c0 (banks).

**⚠️ FINANCE PARITY VERIFICATION — the `.parity/finance-before` baseline DRIFTS.** The
headless harness accumulates localStorage between `shoot` runs, and visiting Receivables/
Payables (posts `GL-RECLASS-AG-*`), Consolidation (posts inter-company) and Group Expenses
(`ensureGroupAccounts` adds COA rows) MUTATES that state — so the ledger entry count grows
run-to-run and a stale baseline shows false coa/journal diffs. **Reliable method = BACK-TO-BACK:**
shoot the current build → `cp` the `_frontend-originals/group-cockpit/finance/view.js` backup
over `view.js` → shoot again → restore build → `diff` the two. Same-state compare of MY code
vs ORIGINAL code. The 11 menu routes = 22/22 byte-identical this way; concern-pnl+expenses
proven separately (their own before/after). Do NOT trust an isolated single-route journal
diff. See [[parity-sweep-context-journal]].

**◻ FINANCE BACKEND — still TODO:** only `backend/LARAVEL-BLUEPRINT.md` exists (no real slice
yet). Build the Laravel controllers/services/models/migrations for the finance stores (banks,
group_budgets, group expense entries) + test vs local MySQL, per the full-stack directive.

**◑ (superseded) earlier finance notes:**
Finance was ONE hand-written 133KB `view.js` (13 chart/table screens). Steps done + pushed:
- ✅ **Split into the `frontend/` build** (`template.html` + `finance.js` → `view.js` via
  `build-module.mjs`), backup at `_frontend-originals/group-cockpit/finance/view.js`. The
  split alone is **byte-identical to the original** (proven by re-shooting the backup).
  Fresh baseline at `.parity/finance-before` (22 shots). Commit 6b30504.
- ✅ **Shared chrome → real-HTML shells:** `head()` (page-head bar, mirrors `EPAL.pageHead`)
  + `pills()` (13-tab band) are now `<div data-shell>` blocks filled by JS. Commit bafc8fc.
- ✅ **Shared building blocks → shells:** `kpi()` (KPI tile) + `chartCard()` (chart card w/
  `<canvas>`) are `<div data-shell>` — so **every KPI tile + chart card across all 13
  screens is now real HTML** from two helper edits. Commit f430b10.
- ✅ **trial-balance** screen body → `<section data-screen="trial-balance">` (KPI grid +
  balanced-status banner + tables). Commit 79c1f59.
- **Each step re-verified 22/22 (or per-route) PIXEL-IDENTICAL vs `.parity/finance-before`.**
- ◻ **REMAINING finance bodies:** overview, pnl, cashflow, balance-sheet, receivables,
  payables, banks, coa, journal, consolidation, concern-pnl, group-expenses — convert each
  screen's section-labels + table-container cards + custom panels to `<section data-screen>`
  HTML (the KPIs/charts/bars they use are already HTML via the shells). Dynamic data-grids
  (`EPAL.table`, hand-built consolidation matrix) + computed inline-style strips stay JS
  (the law's "live data / feature" carve-out). Then final full parity + backend (LARAVEL
  blueprint exists; build the real slice + test vs MySQL) before FINANCE COMPLETE.

**✅ TRAVELS ACCOUNTS — real-HTML rebuild COMPLETE (priority #3, 2026-07-26 → 07-27).**
The earlier "el()→template markup" pass (below) was the OLD `<template data-tpl>` fragment
style the owner REJECTED — it was REDONE as real `<section data-screen>` HTML, exactly like
master-accounts + finance. Every screen this module owns is now markup:
- ✅ Helpers `screen()/shell()/fillK()/mountScreen()` + a local `head()` in `frontend/accounts.js`.
- ✅ **banks**, **income + expenses** (the shared `kindRegister` KPI strip) — commits
  f6864bd, f2f192a.
- ✅ **recurring · schedules · journals** — commit d4e0a5b. Banners that depend on state
  (recurring "due this month", schedules "overdue") live in the markup and are REMOVED
  when they don't apply, which is also how the create-permission hides Generate All.
- ✅ **overview** (KPI strip · Action Center card *and* its "all clear" banner · the three
  chart cards + canvases · recent-entries card) **and the shared chrome** — the page-head
  bar now mirrors `EPAL.pageHead`'s markup as `[data-shell="head"]` (local `head()` fills
  eyebrow/title/sub/actions; the title stays a TEXT node after the icon), the 9-button
  section-nav band is markup (its `data-tab` hooks are stripped after wiring) and the
  period-lock badge is a shell. Commit cf07970.
- **Still JS BY DESIGN** (mapped, not skipped): the `EPAL.form` line-item repeater, the
  `EPAL.table` data grids, the `kindRegister` head-chips filter widget, the Action-Center
  rows (0..N from live data) and the Chart.js canvases. `cash` + `payroll` delegate to the
  shared kits (`EPAL.cashDesk`/`EPAL.payrollDesk`) — out of scope for this module.
- **PROOF:** back-to-back parity over **all nine routes × both themes** (stash the change →
  shoot before → restore → shoot after → diff): **18/18 BYTE-IDENTICAL**. Overview also
  proven by a **DOM dump**: after normalising the `data-*` hooks and the generated canvas
  ids, the produced DOM is character-for-character what the `el()` code produced. Sweep
  222/222 × both themes, 0 console errors.
- **Method note for the next module:** `.parity` baselines DRIFT (localStorage
  accumulation), so always shoot before/after back-to-back in one sitting; and a DOM dump
  (`#view` innerHTML, hooks normalised) is a stronger proof than pixels for markup work —
  it catches structure the 1440×900 fold never shows. See [[parity-sweep-context-journal]].
- 🐞 **BUG FOUND + FIXED while converting (6752028):** the overview's *Recent Entries* card
  passed the table INSTANCE to its container instead of `.el`, so `ui.appendChildren`
  stringified it and the card rendered the literal text **`[object Object]`** — the whole
  register was missing from the cockpit. Fixed in its OWN commit, after the byte-identical
  conversion, so the parity proof stayed honest.

**(superseded) earlier Travels Accounts FE note — was the rejected fragment style:**
- **FE:** route screens converted el()→template markup; reusable fragments + helpers added;
  the helpers mirror `ui.appendChildren` so they're byte-identical. Parity 16/16. Commit 6e7a6e3.
- **BE:** `tv_recurring` / `tv_cheques` / `tv_petty` document-style Laravel slice
  (migration + 3 Models + AccountsBookService + Controller + routes + seeder), migrated +
  seeded + CRUD-tested vs MySQL; api.js HYDRATE+WRITABLE wired. Commit 7c7156f. (acc_entries/
  schedules/banks come from the Master Accounts backend.)

**➡️ MARKETING done (2026-07-26).** Backend: 5-store document-style Laravel slice
(tv_campaigns/templates/messages/bot_bookings/bot_chat), migrated + CRUD-tested vs MySQL,
api.js wired (cc9d09d). Frontend: already at standard from the prior conversion — the
tab/route STRUCTURAL shells are templated (kpi-grid/head-row/two-col via frag); the
remaining el() is documented DYNAMIC content (chat bubbles, phone panel, funnel bars,
template-editor preview) — same bar as MA detail views, left as el() by design.

**➡️ ALL TRAVELS MODULE BACKENDS DONE (2026-07-26).** Document-style Laravel slices
(ext_id/company_id/status columns + data JSON, upsert-by-frontend-id, {store}-keyed),
each migrated + CRUD-tested vs MySQL + api.js wired: accounts (7c7156f), marketing
(cc9d09d), automation+contract-file+crm (7d70db3), contract-flight+hrm (3220b7a),
vendor-agent 5 stores (b011c26). Plus passport-mgmt/settings/file-management earlier.
reports/analytics/dashboard/ledgers are read-only views (no owned stores → no backend).

**✅ TRAVELS LEDGERS — real-HTML rebuild COMPLETE (priority #4, 2026-07-27).**
The whole module was in the REJECTED `<template data-tpl>` fragment style; all 8 tabs are
now real `<section data-screen>` HTML. Backup kept at `_frontend-originals/travels/ledgers/`.
- ✅ **chrome** (page-head mirroring `EPAL.pageHead` + the 8-tab band) · **overview** ·
  **party** · **AR/AP ageing** (ONE shell serves both tabs) — commit 916aa32.
- ✅ **general · trial · balance sheet · pnl** — the REPAINT-driven tabs: each clones its
  section per paint (As-of date, period range, account select). The balance sheet inserts
  Assets before the claims column and Liabilities above the Equity slot so the DOM order
  matches the old builder exactly. Commit 6702e87.
- ✅ **PRUNED the retired fragments** — nav · nav-btn · kpi-grid · kpi-grid-plain ·
  section-label · grid-auto · head-btn-card · build-banner · chart-card · select-card ·
  print-row, plus the `chartCard()`/`buildBanner()` builders that lost their callers.
  **The rule that survived:** a `<template>` is only justified when the logic emits 0..N of
  the thing and the COUNT is data, not layout — kpi · kpi-drill · action-row · reg-card ·
  card-body-card. Everything that is a fixed part of a screen is markup.
- **PROOF:** back-to-back parity 16/16 over all 8 tabs × both themes; **DOM dump
  character-identical** on all 8; a headless drive of the repaint paths **10/10**
  (P&L ৳6.47Cr all-time → ৳17.93L last year · Trial Balance ৳11.84Cr → ৳0 as-of 2025-01-01
  · Balance Sheet keeps Assets|Liabilities|Equity in order · General Ledger 1010 → 1200 —
  and none of them stack a duplicate card). Sweep 222/222 × both themes, 0 errors.

**▶ NEXT (resume here):** priorities #1–#4 (master-accounts · finance · travels-accounts ·
travels-ledgers) are all real-HTML COMPLETE. Next is the FRONTEND pass for the remaining Travels modules —
most were "converted" in prior sessions (structural shells templated, dynamic content
el(), like marketing), so per-module: shoot baseline → convert any UN-templated route
cards (exactly as Travels Accounts and Ledgers needed) → parity byte-identical + a DOM
dump. Modules to check: **dashboard** (it carries the Product P&L card the accounting work
keeps touching), then reports · analytics · automation · crm · contract-file ·
contract-flight · vendor-agent · hrm · visa-processing · air-ticketing (payroll backend
already built via master-accounts). Then Group-cockpit modules, then
woodart/it/shop/construction. Autonomous, push each.

**🆕 2026-07-27 · WOODART INTERIORS — MASTER CONTEXT + THE UNIVERSAL UI CONTRACT.**
Owner pivoted to interiors and locked the build language in writing. Three new
authorities (docs only — no screen touched, sweep 222/222 × both themes):
- **`platform/design-system/UI-CONTRACT.md`** — the UNIVERSAL look, for EVERY
  company: who owns which layer, the canonical markup for nav bar · page head ·
  tab band · KPI · card · empty state, the full shared class inventory, the
  `data-*` hook grammar, where JS may make DOM, and the Tailwind gate. "Nav bar,
  all same everywhere" is now a contract instead of a habit.
- **`companies/woodart/MODULE-STANDARD.md`** — the frozen per-module recipe:
  folder anatomy, the build language, the `frontend/api.js` seam, the split-out
  `backend/endpoints.md`, `README.md` + `context.md` per module, **two commits
  per module**, and the 8-gate definition of done.
- **`companies/woodart/CONTEXT.md`** — the interiors master context: company
  facts, honest state (only `projects` exists, as a 1,238-line legacy `el()`
  view.js with no backend; the other 15 modules are placeholder scaffolds),
  build order starting at `materials`, 10 LOCKED decisions, 4 open questions.
- **`tools/build/build-module.mjs`** now compiles an OPTIONAL `frontend/api.js`
  into the module IIFE **before** the logic — so a screen calls
  `Materials.stock()` and never names a store key or a URL, and flipping a module
  to Laravel is one line in one file. **Verified additive:** rebuilt all 20
  existing modules → **zero git diff** (absent api.js emits nothing).
- Woodart matters strategically: 15 of its 16 modules are greenfield, so it is
  the FIRST company that can be built to the standard from the start rather than
  retrofitted — it becomes the reference for IT · Shop · Construction.
- **⭐ MODULE BUILT: `woodart/materials` — the reference module** (2026-07-27).
  Three real-HTML screens (Stock · Reorder · Valuation) with **zero `<script>`
  and zero `<template>`** — repetition uses a `[hidden][data-proto]` prototype
  row. `frontend/api.js` is the data seam: the store key `wa_materials` appears
  NOWHERE else in the module, so the Laravel switch is one line in one file.
  9-file Laravel slice (thin controller → service → model → migration →
  FormRequest → Resource → seeder) + a frozen versioned `backend/endpoints.md`
  split out of the blueprint. `wa_materials` wired into api.js HYDRATE+WRITABLE.
  Verified: PHP `-l` 8/8, tw gate green, **sweep 225/225 × both themes, 0 errors**
  (222→225 = the 3 new sub-routes). ◻ MySQL CRUD test still owed.
- **✅ THE PROCUREMENT LEDGER POSTING IS RESOLVED AND SHIPPED** (2026-07-27).
  It was flagged as needing an owner call; it turned out the chart of accounts
  already answers it — and it exposed an error in my own blueprint: I had
  written "arguably inventory (1200)", but **1200 is Accounts Receivable**. The
  COA has a real **1400 Inventory** and **2000 Accounts Payable**.
  A goods receipt now posts **DR 1400 / CR 2000** on `Received` ONLY (a PO is a
  commitment, and `Partial` has no part-received amount to post honestly).
  Because that lands on the BALANCE SHEET while `projects` posts `5000 Cost of
  Sales` on the P&L at sale, the double-count that blocked the decision is
  structurally impossible. Paying the vendor is deliberately still out — the
  payable is real and visible, and settling it needs a bank/cash account the
  accounts desk owns. Reversals are real reversals (AUDIT P2): un-receiving,
  re-valuing or deleting posts the opposite entry, a re-receipt uses a fresh
  `…-R2` id, and `glAttempt` — bookkeeping metadata the edit form does not carry
  — is preserved across saves so a routine edit can never orphan a journal.
  **`bridge.map` corrected**: `material.purchased` was mapped to
  `group.expense (5002)`, which is wrong twice (5002 is not in the COA, and
  buying stock is not an expense) → now `group.inventory (1400)`. Flagged but
  NOT touched: `shop`'s `stock.adjusted → group.inventory (1200)` has the same
  confusion. **New probe** `node tools/verify/books.mjs receipt` drives the REAL
  seam (through a documented `EPAL.diag` hook — a test that re-implements the
  rule proves nothing) and asserts: Ordered posts nothing · Received posts
  ৳1.2L to 1400 and 2000 with ZERO movement on 5000/1010 · un-receiving
  reverses to zero · trial balance still balances. Sweep 237/237 both themes.
- **⭐ MODULE BUILT: `woodart/installation` (Site & Install)** (2026-07-27) —
  module #5, closing the physical chain Materials → Procurement → Workshop →
  Install. Its hard rule is the **DUAL-SHAPE SNAG COUNT**: the seeded store
  carries a plain `snags` number, but the Projects snag modal migrates that into
  an itemised `[{text,done}]` list on first open — so a record in the wild may
  carry EITHER. Read counts the un-done items when a list exists and falls back
  to the number; **write RECOMPUTES the number from the list**, so a stale count
  from any client cannot corrupt the figure the handover queue is ordered by
  (proven by a test that sends 99 alongside a 3-item list and gets 2 stored).
  **Handover billing is deliberately NOT wired here** — `projects/view.js`
  already calls `db.postSale('woodart', …)` and opens the branded invoice; a
  second path would DOUBLE-BILL every project. Verified: sweep **237/237 × both
  themes**, backend **42/42 vs MySQL**.
- **⭐ MODULE BUILT: `woodart/production` (Workshop)** (2026-07-27) — module #4.
  Job Register · Workshop Board · Station Load. The board is the clearest
  example in the codebase of the line the FRONTEND BUILD LAW draws: its four
  COLUMNS are fixed HTML (they are the workshop's states, not data) and only the
  CARDS are `[hidden][data-proto]` clones. Two rules worth knowing: the **demo
  clock is an explicit constructor argument** on the service (never a hidden
  `now()`) and is echoed by `GET /load`, so the server can never disagree with a
  screen about what "overdue" means — proven by tests that MOVE the clock and
  watch the overdue count move with it; and an **orphan job** (pointing at a
  project id that no longer exists) is KEPT and flagged, because losing real
  shop-floor history because a parent vanished is worse than showing the
  problem. Verified: sweep **234/234 × both themes**, backend **41/41 vs MySQL**.
- **⭐ MODULE BUILT: `woodart/procurement`** (2026-07-27) — module #3, and the
  first owning TWO entities: two thin controllers over ONE shared service,
  because the rules that matter span both. **⚠️ It deliberately does NOT post to
  the ledger.** `bridge.map` declares `material.purchased → group.expense 5002`,
  but three accounting questions are unanswered — does the expense hit on ORDER
  or on RECEIPT; is bought stock an EXPENSE or an INVENTORY ASSET until consumed
  (booking straight to 5002 double-counts against the project cost `projects`
  already records); and does a Net-30 vendor credit a PAYABLE rather than a bank
  withdrawal. Guessing any of them corrupts the group books, so it ships as a
  complete honest register and the posting is an OPEN OWNER DECISION.
  Verified: sweep **231/231 × both themes**, backend **40/40 vs MySQL** — incl.
  the rule that an order on a supplier with NO vendor record is COUNTED under
  `Unlisted` and never dropped (money that left the business must appear in the
  totals even when the vendor paperwork is behind).
- **⭐ MODULE BUILT: `woodart/clients`** (2026-07-27) — module #2. Directory ·
  Portfolio · Segments, same standard as materials. Its `frontend/api.js` seam
  owns the first **cross-module read**: Woodart's projects and estimates
  reference a client by NAME, not id (that is how those stores were built, R2),
  so the join is a normalised name match defined in exactly two mirrored places.
  New store `wa_clients` seeded DERIVED from the client names that actually
  appear on projects/estimates — an invented list would have left half the
  directory with no work and half the work with no client, which reads like a
  broken join. Verified: sweep **228/228 × both themes**, backend **37/37 vs
  MySQL** proving both branches of the join (absent `wa_projects` → graceful
  zero-value directory; present → case/whitespace-insensitive roll-up that
  ignores work for an unknown client rather than inventing one).
- **STYLING SHARPENED (owner mid-session): "core build in pure proper HTML,
  styling only Tailwind CSS and JS."** Resolved as: **every UTILITY is Tailwind**
  (`tw-flex-1`, `tw-font-semibold`, `tw-mt-[6px]`, `tw-text-ink-mute`), while the
  house **COMPONENT** classes stay (`.card`, `.kpi-card`, `.btn`, `.page-head`)
  because they are the universal vocabulary that keeps all six companies
  identical — forking them per module is the opposite of "nav bar all same
  everywhere". ⚠️ **Convert by VALUE, not by name:** house `.mt-1` is 6px but
  Tailwind's `mt-1` is 4px, and `.xs` is 11px vs `text-xs` 12px — a blind rename
  silently shifts pixels. Verified-exact mapping table in UI-CONTRACT §5.
- 🐞 **TRAP FOUND (cost a debugging session, now documented):** a module
  registered `built:true` **without its own `modules/<id>/module.json`** is read
  by auto-discovery as DELETED (it HEAD-probes exactly that file), and the sweep
  then fails with **every route empty and ZERO console errors** — looking like a
  core break rather than one missing file. Isolated with a clean `git worktree`
  at HEAD. Written up in `companies/woodart/MODULE-STANDARD.md` §8.
- **Then (owner: "do whatever needed, but lock in my preference") the Tailwind
  block was cleared** — see the STYLING METHOD note at the top of this file.
  `tools/verify/tailwind.mjs` + `npm run verify:tw` is the new permanent gate;
  `tailwind.built.css` is UNCHANGED (nothing needed regenerating). Woodart's
  open questions #2–#4 now carry defaults instead of blocking.

> Also still open from the ACCOUNTING build order (independent of the HTML work):
> **step 5 part 2 = Group consolidated P&L** (sum every concern's `pnl()` with
> inter-company 4000/5000 elimination + the Group's own income line; the engine has
> `consolidatedTrialBalance` but no consolidated P&L).
> And one OWNER action nobody else can do: **run `php artisan migrate` on the host** so
> `bank_transactions` exists — the bank movement log then starts persisting by itself
> (the client already asks the server whether the table is there).

## 🚨 CORRECTION — 2026-07-26 (owner reminded me) · FULL-STACK MEANS FRONTEND **AND** BACKEND

I broke the command on modules #1–#3: I built + tested their Laravel backends but
SKIPPED the frontend/UI-UX rebuild, declaring the frontends "already HTML" and marking
the gate ✅. That was wrong. The owner's command is **each module = full-stack: the
frontend UI/UX re-authored to proper HTML5 + Tailwind (every container/card/modal as
markup — NOT `el()` script-DOM), pixel-perfect via the before/after screenshot loop,
AND the Laravel backend.** A module is not "done" until BOTH sides are rebuilt + verified.

**State of #1–#3:** backends are real + tested (keep them). **Frontends owe the
completion pass** (reopened in the tracker). **#1 passport-mgmt now DONE full-stack**
(2026-07-26): its detail modal moved from `el()` script-DOM into template.html markup
(`detail`/`detail-row` fragments), rebuilt view.js, **parity loop run — 8/8 pixel-
identical** (4 light byte-perfect, 4 dark ≤2px AA), sweep 222/222. #2 settings + #3
file-management frontends get the same completion pass next.

**Honest scope note:** the 18 Travels frontends were converted to HTML+Tailwind
templates in PRIOR sessions, so per-module frontend work here = convert residual `el()`
→ markup + polish + prove pixel-perfect (a completion pass). The GROUND-UP frontend
rebuilds are the Group-cockpit modules + the 4 other companies (still on legacy view.js
/ shared wildcard views) — those get full HTML+Tailwind builds.

## 🚨 DIRECTIVE PIVOT — 2026-07-26 · FULL-STACK, MODULE-BY-MODULE, 100% EACH

**Owner correction (important):** the accounting work above (steps 3–5) was
**frontend-only** — JS in each module's `frontend/<id>.js` using the `el()` DOM
builder + design-system CSS classes, persisting through the ONE pre-existing generic
`JournalController`. **No new Laravel backend, no HTML+Tailwind rebuild.** The owner
had strongly instructed: build each module **100% full-stack, then move to the next**.

**The binding method from here on** (see `docs/FULLSTACK-REBUILD-TRACKER.md`):
- **Frontend:** properly-structured **HTML5 + Tailwind** (real containers/cards/markup
  in `template.html`, logic-only JS) — **pixel-perfect** vs current, proven by
  `tools/verify/parity.mjs` (shoot before → rebuild → diff byte-identical; screenshot,
  find issue, fix, repeat until 100%).
- **Backend:** a real **Laravel** slice per module — routes · Controller · Service ·
  Model(s) · migrations · Form Requests · Resource — auto-discovered by
  `platform/backend`'s ModuleServiceProvider; reference = the master-accounts
  controllers. **Build all → cross-check → test vs local Laragon MySQL → fix → re-check → push.**
- **One module fully done + verified before the next.** Order = simplest→hardest,
  Travels first; **payroll is the most complex (shared desk ×5 companies + embedded in
  Master Accounts) and is deliberately LAST in Travels**, after the pattern is proven.
- **STRICT CONTEXT (owner 2026-07-26):** update THIS file + the tracker for EVERY edit.

**Full code backup taken FIRST** (owner instruction): `../modularerp-FULLSTACK-BACKUP-2026-07-26`
(9,442 files / 119.9 MB incl. `.git`) in the mother folder.

**MODULE #1 — passport-mgmt — ✅ DONE (2026-07-26).** Built the full enterprise
Laravel slice in `companies/travels/modules/passport-mgmt/backend/` (owner spec: MVC +
Service + Form Request + Resource + Model + migration + seeder):
`migrations/…create_tv_passports_table.php` · `Models/Passport.php` (Eloquent, soft
deletes, date casts) · `Http/Requests/StorePassportRequest.php` · `Http/Resources/
PassportResource.php` (exact `tv_passports` frontend shape) · `Services/PassportService.php`
(company-scoped list, upsert-by-id, soft delete) · `PassportController.php` (thin,
Schema::hasTable-guarded, ScopesToCompany) · `routes.php` (GET/POST/DELETE) ·
`Database/Seeders/PassportSeeder.php`. All auto-discovered by ModuleServiceProvider.
- **Tested vs real MySQL** (Laragon 5.7, DB `modularerp`): all 8 files `php -l` clean;
  `php artisan migrate --path=…` created the table; seeder inserted 3 rows (verified by
  raw `SELECT`); a tinker CRUD test proved INDEX returns the exact frontend shape,
  STORE creates + updates-without-dup, DESTROY soft-deletes.
- **Frontend:** already template-structured HTML (the original parity pilot) + read-only
  (no add/edit UI), so it stays pixel-identical — the module's only gap was the backend.
  Wired `tv_passports` into `api.js` HYDRATE (register hydrates from DB in API mode).
  Sweep 222/222 both themes, 0 errors.
- **Env note:** the local `modularerp` DB is nearly empty on this new machine (production
  dump NOT imported) — so backends use **module-owned migrations + seeders** (the
  drop-in/drop-out pattern), testable standalone. MySQL start command that worked:
  `C:\laragon\bin\mysql\mysql-5.7.33-winx64\bin\mysqld.exe --defaults-file=…\my.ini --datadir=C:\laragon\data\mysql`.

**MODULE #2 — settings — ✅ DONE (2026-07-26).** Backend: `company_settings` JSON
table + `CompanySetting` model + `SettingsService` (shallow-merge, mirrors the
frontend's per-tab `S.patch` no-clobber) + `SaveSettingsRequest` + `SettingsController`
(company-scoped, defaults to Travels=2) + routes `travels/settings/config`. Migrated +
tested vs MySQL (merge keeps all tabs' keys, single row per company). FE already
template-structured, untouched (pixel-identical). Settings is a keyed config blob (not
a collection), so it stays on the proven local-persist path with the API ready for
server sync — no `api.js`/SPA change, sweep unaffected.

**MODULE #3 — file-management — ✅ DONE (2026-07-26).** Backend: `tv_files` 8-file
Laravel slice (VisaFile model + FileService with derived `total`=embassy+service +
StoreFileRequest + FileResource + FileController + migration + seeder + routes),
migrated+seeded+CRUD-tested vs MySQL (3 rows raw-SQL verified, shape exact, create/
update-no-dup/soft-delete pass). `api.js` HYDRATE wired (`tv_files`); sweep 222/222.
FE already HTML/template, untouched.

**▶ NEXT (resume here):** module #4 = **Travels marketing** (owns tv_campaigns,
tv_templates, tv_messages, tv_bot_bookings, tv_bot_chat — multi-store). Then automation,
reports, analytics, crm… per `docs/FULLSTACK-REBUILD-TRACKER.md`. Autonomous, push each.

> Note: the accounting buildout (funding legs, Dashboard P&L, statement suite V2) is
> shipped & working as frontend features; their Laravel backends are now folded into
> this full-stack program (accounts=#15, ledgers=#14, dashboard=#13). The Group
> consolidated P&L (step-5 part 2) is deferred until those modules' full-stack pass.

---

## 🆕 SESSION — 2026-07-30 · P8, AND THE TABLE PASS IS DONE

**29 tables · 28 footed · 1 that should not be · 8 printed documents.** No document
in this phase: a drill-down is not something you hand to anybody.

The three that needed thought rather than a `SUM()`: *month transactions* foots the
sheet's own THREE totals — what was listed, what cash left, what came back, and
**what was recovered inside a payment and moved no cash at all** (`৳4,68,416 ·
৳3,38,750 cash out · ৳1,29,666 netted in pay`), because one figure there would be
four questions answered as one; *employee money movements* says how much MOVED and
then splits it, since its rows run both ways; and *salary templates* foots DRIFT —
the gap between what the templates say and what the employees' recorded salaries say
— which matters because the pay follows the TEMPLATE.

⚠ **Salary structures gets NO totals row, and that is the answer, not an omission.**
Every column is a rate or a rule — basic %, tax %, PF %, the tax-free threshold,
leave days, the pay-by day. Adding six companies' basic percentages gives 268%, and
averaging them describes a company that does not exist. It is documented in the code
so nobody "fixes" it later.

**Two verification notes worth keeping.** The Payroll ↔ Ledger variance modal is
UNREACHABLE on this data — the books reconcile, so the "why?" link is absent by
design — so it was exercised by knocking one payslip's `paid` down ৳5,000 inside the
disposable browser profile, after which its foot read ৳4,68,316, exactly the
perturbed `sheetOwed`. And the blocked-approval table only exists when a month fails
its arithmetic check; no month here does, so its foot is written and follows the same
pattern but has not been seen on screen.

**THE WHOLE PASS, for the record.** Eight documents now come off this desk:
`PR-MR` Monthly Register · `PR-SR` Salary Register · `PR-DS` Disbursement Sheet ·
`PR-SP` Staff Position Statement · `PR-LB` Loan Book · `PR-AR` Advance Register ·
`PR-EL` Encashment Liability Schedule · `PR-PA` Payroll Cash & Ledger Reconciliation.
Along the way the foots found: a **money bug** (`loanOutstanding` dropped every cash
repayment, ৳2.67 lakh, and would have kept deducting EMI from cleared loans), two
**label lies** on the advance register, a column that **stopped footing to itself**,
two **same-name-different-number** collisions caught before they reached paper
(staff net position, encashment provision), and a compiled `view.js` that was never
rebuilt. That is the argument for putting a total under every column.

---

## 🆕 SESSION — 2026-07-30 · THE REPORTS TAB (P7) — SEVEN FOOTS, TWO AUDIT DOCUMENTS

**Seven tables footed, and three of them REFUSE to sum a column** — which is the
argument for doing this by hand rather than with a blanket `SUM()`. The account
drill foots NET with both directions beneath (its rows run both ways through the
account). *Eligibility* counts rather than totals (`17 eligible · 0 accruing`).
And on *Increment history*, **"From" and "To" refuse to sum at all** — they are
salary LEVELS at two moments, and adding fifteen of them describes nobody; only the
change sums, and the foot says which way the revisions went. Department cost is the
opposite case, and worth noting: headcount really does sum there, because
departments are disjoint, unlike months, where the same person recurs.

**`PR-EL` Leave Encashment Liability Schedule** — accrued days, **day rate at
today's salary**, accrued value, and the 12-month condition, per person. The totals
row prints `–` for the day rate: averaging a per-person rate describes nobody.
⚠ **It prints its own control.** The engine has two roads to this number — this
schedule (leaveState per employee, days × today's rate) and
`encashmentLiability(company)`, the provision the books carry. The panel prints BOTH
and the difference, and a HIGH note explains the drift when it exists (the schedule
revalues at today's salary; the provision was charged at each month's salary, so an
increment moves one and not the other). On this data they agree to the taka —
৳4,67,576 — so the note stays quiet. Picker: Everyone · **Only encashable now** ·
**Only still accruing**.

**`PR-PA` Payroll Cash & Ledger Reconciliation** — "where the money went", printed,
with the sheet-to-ledger control beside it. One row per ACCOUNT (movement count
under the name) × salary · advance · staff loan · bonus · other · total out · came
back in. The control panel prints the variance **whether or not it is zero**,
because a control that only appears when it fails is not a control; here it lands on
sheet ৳4,63,316 = ledger 2100 ৳4,63,316, *"They agree"*. **No picker, deliberately:**
its only two variables — company and period — are already chosen on the screen it
prints from, so a modal would be a step that changes nothing.

Fixed in its own output: the scope sentence read *"– was recovered INSIDE a salary
payment"* when nothing had been. A dash mid-prose reads as a missing figure, which is
the opposite of what the dash convention means, so the clause now only appears when
there is a recovery to describe.

Verified: sweep 253/253 × both themes, 0 errors; encashment foots match an
independent walk of `leaveState()` (17 people · 225.14 days · ৳4,67,576 · 17 eligible
· provision ৳4,67,576 · gap ৳0); account columns add across to ৳65,78,809 out; both
documents read at 1:1.

---

## 🆕 SESSION — 2026-07-30 · THE ADVANCE SALARY REGISTER (P6)

**Per PERSON, not per transaction — and that is the difference from the loan book.**
A loan is a thing with a plan and a maturity, so its book is one row per loan. An
advance is not: it is pay not yet earned, taken as often as the boss allows and
recovered whole from the very next payslip. So `PR-AR` is one row per person who has
ever taken one — a cleared advance still shows, because the history is the point of a
register — and the columns answer *who is holding what, and what comes back this
month*. Picker: Everyone · Only still holding · **Only over a month's pay** · add by
company.

**Three tables footed**, including the one that needed a judgement: on *Decided
requests*, "asked for" sums every decided row but **"approved" sums only the approved
ones** — adding a declined row's nothing into the total is how a decline turns into a
discount — and the foot prints the gap (`৳45,000 not advanced · 0 approved · 1
declined`).

**Two label bugs this build caught in its OWN output.** The last column said *"Coming
back — this payslip"*, but on a month already paid that figure is what the payslip
ALREADY took: one column, two tenses. It is now **"This month · recovered or
planned"**, and the panel treats it as context inside the reconciliation rather than a
second subtraction — deducting it again would understate the outstanding by exactly
one month. Then the cell printed `–` whenever nothing was outstanding, so an advance
cleared BY this month's payslip showed a dash while its ৳15,000 sat in the total and
**the column stopped footing to itself**. The figure comes first now; "no run" is kept
for a balance with no payslip to take it.

**What the data said:** every advance here is fully recovered (৳1,46,000 given, ৳0
outstanding), so the *Outstanding advances* card does not render at all — which is why
the register's Print also rides the transactions table, the one card always on the
tab. Two pending requests worth ৳32,000 are deliberately excluded, with a note: an ask
is not an advance.

Verified: sweep 253/253 × both themes, 0 errors; foots match an independent walk of
`pay_txns` + `advanceOutstanding()` (6 people · 7 advances · ৳1,46,000 given · ৳0
outstanding · 2 pending / 0 approved / 1 declined); pages read at 1:1.

---

## 🆕 SESSION — 2026-07-30 · THE LOAN BOOK (P5) — AND THE MONEY BUG ITS FOOT FOUND

**This is why the totals rows are worth building.** The loan register footed
**৳92,004** still due while the Loans KPI and Staff Accounts said **৳3,59,505** —
two readers of the same loans, ৳2.67 lakh apart, and nobody could see it until the
column had a total under it.

**The cause, in `platform/engines-library/payroll.js`:** `loanOutstanding()` tested
`x.slipId !== exceptSlip` to skip a slip's own repayment. A MANUAL repayment — cash
or bank, not deducted from a payslip — carries no `slipId`, so with no `exceptSlip`
passed the test read `undefined !== undefined`, which is **false**, and every
hand-recorded repayment was silently dropped: the loan stayed outstanding at its
full principal for ever. It also fed `emiInstallment()`, which caps the monthly
deduction at that figure — so **payroll would keep recovering EMI from a loan the
employee had already paid off in cash**. Now `!(exceptSlip && x.slipId ===
exceptSlip)`: exclude a slip's own repayment only when a slip is actually being
sized. A per-employee probe afterwards finds ZERO disagreement between the function
and the rebuilt loan book. Knock-on: *Employees with loans* drops from 10 to the 4
who really owe, and P4's five "loan with no EMI set" exceptions vanish — those loans
were repaid, not unscheduled.

**Five tables footed, each by what its columns mean:** *Repaid via* foots as the
SPLIT (`salary ৳0 · cash ৳3,72,996`) because that column exists to say how the
money came back; *Status* counts (`5 running · 8 cleared`) rather than pretending to
a total; *loan due after* REFUSES to sum, being a per-loan balance at a moment; the
per-loan payments table shows a CLOSING balance; and *Loan transactions* — where a
single Amount total would be a lie, the rows running both ways — foots net with both
directions beneath it (`৳92,004 net · ৳10,92,000 lent · ৳9,99,996 repaid`).

**`PR-LB` Staff Loan Book** — one row per LOAN, not per person, because "how much of
the ৳20,000 taken in May is left" is a question about a loan and one person can hold
three. Its *months to clear* total is not a column sum but the open book's runway at
the EMI actually scheduled, and a second panel buckets the outstanding money by AGE
— nothing else on the desk answered that. Picker: Everything lent · Only running ·
Only cleared · **Only without an EMI plan** · add by company.

Verified: sweep 253/253 × both themes, 0 errors; every foot matches an independent
walk of `loanBook()` over every employee (13 loans · ৳10,92,000 disbursed ·
৳9,99,996 repaid · ৳92,004 outstanding · 5 running); pages read at 1:1.
🔎 Noted, not changed: EMI is `round(principal ÷ months)`, so two loans here sit at
৳2 still due. It self-heals through the recovery cap; say the word and the last
instalment can absorb the rounding instead.

---

## 🆕 SESSION — 2026-07-30 · THE STAFF POSITION STATEMENT (P4)

**The first payroll document that is not about a month.** Staff Accounts is a set
of BALANCES, so `PR-SP` is dated *as at* — no month to tick, no run to approve, no
signature to collect. It gets its own smaller picker (`staffPrintCentre`) rather
than contorting the month-based `printCentre`: scope and as-at, then who —
Everyone · Clear all · **Only with a balance** · **Only owed salary** · add by
company or department — with the same live counter the payroll centre taught.

Columns: `#` · Employee (ID beneath) · Company · Designation (department beneath) ·
Monthly salary · Salary due · Advance out · Loan out (EMI beneath) · Encashment
accrued (days beneath) · **Net position** · Status. The screen says owed/owes in
green and red, which a photocopier throws away, so on paper the sign convention IS
the document: a plain figure is owed by the group to the employee, a bracketed one
by the employee, the words sit under every figure, and the scope line states the
rule before the first row.

**THE TRAP THIS BUILD HIT.** The table's Net position column is the employee LEDGER
balance — the whole history, everything earned and accrued less everything handed
over — which footed to ৳12,22,730, while my panel netted TODAY's balances and got
৳5,71,387. Two different figures under one name on one page is a control failure,
not a rounding difference. So the KPI band now carries the LEDGER balance (tying to
the table's own foot), the panel is named *"What each side is owed, today"* and
closes on *"Owed to staff, less recoverables"*, and a NOTE states why the two
differ — before anybody decides one of them is a bug.

The foot prints the signed net AND both gross sides (`৳12,24,323 we owe · ৳1,593
they owe`): a total that showed one direction while hiding the other would be worse
than no total. Non-money columns say what they count — *1 never paid · 18 active*.

It also raises exceptions nothing else on the desk was raising: a LEAVER still
owing money (after the last payslip there is no pay to recover from), an advance
bigger than a month's salary, **a loan with no EMI set** — five people, caught on
the first run — and anyone with no salary on record.

Verified: sweep 253/253 × both themes, 0 errors; the foot matches an independent
sum over `employees` (18 people · salary ৳10,53,000 · due ৳4,63,316 · loans
৳3,59,505 · encashment ৳4,67,576 · ledger ৳12,22,730), *Only with a balance* picks
17 of 18, and the printed pages were read at 1:1.

---

## 🆕 SESSION — 2026-07-30 · THE SALARY DISBURSEMENT SHEET (P3)

**A third document, not a variant.** `PR-DS-<YYYY>-<MM>` is the only artifact on
the desk that leaves the building UNFINISHED: it goes out with a blank column and
comes back as the receipt, one signature per employee, which is what makes a cash
payroll auditable. The Salary sheet's own foot was already in place
(`sheetTotals`), so P3 was purely the document.

**Its columns are the cashier's, not the accountant's** — `#` to tick down ·
Employee with the ID beneath · Company · Department · Net payable · Recovered
(advance + EMI, bracketed) · Already paid · **To hand over**, the only bold figure
on the row · Through (the account a paid row actually left by) · **Signature and
date**, a dotted rule in the widest column after the name. The full earnings
breakdown stays in `PR-SR`: putting it here would push the signature off the paper.
Rows are TALL (`.rp-tall`) because somebody has to write on them — 17 people over
3 pages, which is the right trade for a sheet that gets signed.

Net payable is already net of advance and EMI (the engine's `slipPayable`), so "to
hand over" needs no arithmetic in the cashier's head; Recovered is printed for the
EMPLOYEE's benefit. The *How this sheet adds up* panel takes its adjustments line
as the RESIDUAL, so it foots to the engine's net rather than to my own arithmetic.
*Paid so far, through which account* is built from the payslips' own `payMethod`,
so it can only ever name accounts that really carried money this month. The sign-off
is the cash chain: Prepared by · **Cash handed over by** · Checked by · Approved by.

**The print centre now has three levels** — Summary · Employee-level detail ·
Disbursement sheet — and Print in the sheet's own toolbar opens it at the third by
default. Paired with **Only unpaid** it is exactly the sheet for today's payout.
The control bar's older tick-the-columns "Print Sheet" is untouched.

Verified: sweep 253/253 × both themes, 0 errors; the driver confirms the level
default, 17 signature lines for 17 rows, and totals net ৳8,04,066 · recovered
৳1,27,666 · paid ৳3,40,750 · **to hand over ৳4,63,316** against an independent sum
out of `pay_slips`. Filtering to Only unpaid (11 of 17) leaves cash to hand over
**unchanged at ৳4,63,316** — as it must, because a fully-paid employee is owed
nothing. Both variants were rendered at 1:1 and read page by page.

---

## 🆕 SESSION — 2026-07-30 · PAYROLL HISTORY PRINTS THE SAME REGISTER (+ the plan for the other 26 tables)

**The owner's check** — *"the one you have done already is in Overview the Monthly
Register Table. It matches with Salary Manage's Payroll History table, check it.
If matches 100%, then first make same print option there, if not, list what's the
difference."*

**It matches where it counts and nowhere else.** Both tables are the SAME
`monthSeries()` — same months, same figures, no limit on either — so the printed
register is a drop-in with nothing to recompute. Proven by driving both screens:
Overview foots gross ৳71,99,496 · paid ৳52,47,059 · due ৳4,63,316 over 17 distinct
heads, and Payroll History foots the identical three figures. The differences are
presentational: 10 columns against 6, `heads` against `paidHeads / heads`, the
history card alone renders "No run" and "Mixed · N runs", and the row click drills
to the Salary Register on one and to the month's TRANSACTIONS on the other. One
asks what the month cost and owes; the other what it paid out, and to how many.

So Payroll History now raises the FULLER `PR-MR` document — it already carries
every column that card shows and four more. One payroll month register, not two
variants of one. Its foot follows the same rules, and "Staff paid" foots as
**people with nothing outstanding across the period / people on the payroll in it**
(6 / 17 — never a sum of monthly counts, which would say 119 of 119).
⚠ A month with no run, or a draft one, is listed on that card but cannot be
printed: only approved runs leave the building.

**THE DESK HAS 29 TABLES. THREE ARE FOOTED AND PRINTABLE.** The other 26 are
planned in `docs/TASK-QUEUE.md` as T-PAY-TABLES, in phases, with the two
treatments kept apart on purpose: FOOT every table that carries money (cheap now
that `EPAL.table` takes `opts.totals`), but raise a DOCUMENT only for the ones
somebody hands to somebody — the Salary sheet (the disbursement sheet that gets
signed, next up), Staff Accounts, the Loan Book, the Advance Register, and the two
an auditor asks for by name: the encashment liability schedule and the payroll ↔
ledger reconciliation. A drill-down modal is not a document and does not get
letterhead.

---

## 🆕 SESSION — 2026-07-30 · THE PAYROLL PRINT SYSTEM — A REGISTER YOU CAN FILE

**The ask** — the owner wrote a full spec (`Epal-Group-Payroll-Print-Spec-Prompt.md`)
and sent a rendered mock-up with one row crossed out: *"print layout style, just
avoid too much colors. dont need the monthly average raw."* So: build it, drop the
Monthly-average row, and keep the palette down.

**Print no longer prints.** It opens the PRINT CENTRE — scope (read-only, so you
cannot print the wrong entity by accident) → months (all ticked, Select all /
Clear all / Last 3 / Last 6 / This year, live counter) → detail level (only when
exactly ONE month is ticked; two or more always print the summary) → employees
(all ticked, search, select-by-company / by-department, and a live
`16 of 17 selected · net payable ৳8,98,123` that is exactly what the printed
totals row will say) → a preview of the REAL pages → Print / Save as PDF.

**Two documents, both A4 landscape.** `PR-MR-…` the Payroll Monthly Register (one
row per month) and `PR-SR-…` the Salary Register (one row per employee). The id
carries the company code when the scope is one concern, so a consolidated report
can never be mistaken for a company's.

**THE LAYOUT ENGINE IS NEW AND SHARED — `platform/kit/report-print.js`
(`EPAL.report`).** It paginates in JS, which is the only honest way to get
"Page X of Y": Chrome does not support the `@page` margin boxes that would carry
it, and a browser cannot be asked how many pages it made. Measuring the flow
ourselves also gives a footer on EVERY page, a table header that repeats on each,
rows that never split, and a sign-off block that always lands at the end. The
preview shows the very nodes that print — not a mock-up of them.

**Colour, per the owner: two.** Navy `#0B2545` for the header band, rules and
panel headings; `#14365F` for the group band. Every figure is pure black, because
a payroll register gets photocopied and a pale gold number is gone by the second
generation. Negatives wear accounting brackets — `(69,388)`, never a minus, never
red — nothing prints as `0` (an en dash instead), money is grouped the
Bangladeshi way (`53,74,501`), and the currency is declared once in the masthead
instead of in 500 cells. No gold, no zebra beyond `#F7F9FB`, no Monthly-average
row.

**THE TOTALS ROW IS NOT A SUM, and that is the whole point.** `EPAL.table` gained
an opt-in `opts.totals(rows)` (default off — no existing table moved) and both
payroll tables now foot ON SCREEN as well as in print, by the same four rules:
sum what sums; RE-COMPUTE every percentage from the totals (an average of row
percentages is a different, wrong number); show the encashment accrual's CLOSING
BALANCE, not its column sum; and count heads DISTINCT — seven months of 17 staff
is 17 people, not 119.

**Accounting the layout had to respect:** encashment is a liability accrued
monthly and settled once in December — out of Net Payable, printed as a balance,
and stated in words on the page so nobody reads it as unpaid salary; deductions
withheld stay a liability until remitted; true cost = gross + additions +
encashment accrual, which is the KPI band's first figure and never the cash one.

**Also new:** `EPAL.config.group.letterhead` (address · web · email · licences,
from the owner's spec) with a per-company override slot, so one edit changes every
document the group prints; and `pay_prints`, the revision counter and audit trail
of who raised a confidential payroll document — written when the print dialog
opens, not when a preview is flipped through.

**SAME-DAY FOLLOW-UP** (owner: *"where is, after clicking a single month, then
print option, with that month's these infos?? also, option to mark specific
employee, or all, or just due, or just paid"*) — two real gaps, both closed:
Print was only in the month screen's control bar, ABOVE the dashboard row, so by
the time you are reading the register it is off the top of the screen; it now
also rides in the register's own toolbar beside Export and PDF, where a reader
looks for the outputs of the table in front of them. And step 4 gained **Only
unpaid** / **Only paid**, which REPLACE the selection (one click = one intended
set) rather than adding to it like the by-company / by-department pickers; every
row carries a Due/Paid badge, and the printed page names the subset — *"Partial
selection — 11 of 17 employees, unpaid only"* — because "11 of 17" leaves the
reader to guess WHICH eleven. Driver-checked against the store: Only unpaid = 11
of 17 · ৳5,43,494, Only paid = 6, and 11 + 6 = 17.

**Deviations, both forced by 273mm of paper** (the spec's own rule: drop a column
rather than shrink the type): the employee ID prints UNDER the name instead of in
its own column, and the ADDITIONS subtotal is dropped from the salary register —
its three components are printed beside it and the subtotal still appears in the
KPI band and in "How the month adds up".

**Verified** — sweep 253/253 × both themes, 0 console errors; a CDP driver opens
the centre from both screens, ticks and unticks, previews and presses Print with
`window.open` stubbed, and asserts: the printed totals row equals an INDEPENDENT
sum straight out of `pay_slips` (৳71,99,496 gross · ৳65,88,870 net · ৳60,48,721
paid · 17 distinct heads), settled % = 91.80% and deduction rate = 11.02% both
recomputed from the totals, the encashment foot is the closing balance
(৳4,70,918) and not the column sum, `Page 1 of 2` / `Page 2 of 2` on both pages,
the header repeating on page 2 of the 3-page salary register, the partial-selection
notice appearing when two people are unticked, the PDF filename
`Epal-Payroll-AllCompanies-Jan-Jul2026-20260730`, and `pay_prints` recording
`n=1`. Both documents were also rendered at 1:1 (1123×794) and read page by page.

---

## 🆕 SESSION — 2026-07-30 · THE ALL-COMPANIES NOTE IS AN (i), AND THE CARD OPENS FROM IT

**The ask** (owner, screenshot of Master Payroll ▸ Overview ▸ All Companies with the
note's icon circled and an arrow drawn at it): *"make the marked icon placed here
while in all companies, clicking it will expand its card."*

The all-companies note ("Combined payroll — Group · Travels · …" and the paragraph
explaining that a RUN belongs to one company) is a paragraph you read once and then
know. It now ships **shut**: nothing but its info button, sitting on the exact spot
the open card's icon occupied, so clicking it grows the card DOWN from the icon and
nothing on the page moves sideways. Measured shut: **34×34 at x=366** — where the
owner's arrow pointed; open: the same 944×156 card, same words, same place.

One function, so all five tabs that show a note (Overview · Salary Manage · Loans ·
Advance · Reports) got it at once, and it is the ONLY note of its kind in the repo —
`grep data-shell="scopenote"` matches nothing outside `travels/modules/payroll`, and
that desk is what Master Payroll and every company's Accounts ▸ Payroll tab mount.

- The icon IS the toggle (`<button class="brief-exc-ico scopenote-ico" data-el="tog"
  data-k="ico">`) — one element in both states, so `fillH(n,'ico',…)` is unchanged.
- Shut, the `.card` skin is dropped (`.scopenote.is-shut` → no background/border/
  shadow, `width:max-content`) rather than the element removed: it has to keep its
  place in the flow. The body is hidden by an EXPLICIT `display:none` on the shut
  class, not `[hidden]` — the trap already documented in `rowsInto`.
- Open/shut lives in a module var (`noteShut`, default true), so shutting it on
  Overview and walking to Loans does not hand you the paragraph again. Deliberately
  NOT persisted to the store: the first sight of all-mode in a session still offers
  the explanation. Nothing about single-company mode changed — the note never renders
  there.

**Verified:** boot sweep **253/253 routes × both themes, 0 console errors, 0 render
failures**; a CDP driver clicks All Companies, screenshots shut and open in light and
dark, toggles, and walks to Loans with 0 console errors and the state carried over.

---

## 🆕 SESSION — 2026-07-29 · EVERY PAYROLL TRANSACTION SAYS WHERE IT WAS DONE FROM

**The ask** (owner, on the employee file › Accounts tab): *"all transactions across
payroll should contain from where the transaction has [been] done. Like, Company paid
from which bank or Cash, Loan Repayment done from Employee salary or Bank / cash etc."*

The full transaction history listed WHAT moved and never WHERE FROM. The screen it was
asked on is the shared employee file (`platform/kit/emp-profile.js`), which the Payroll
desk, Master Accounts › Master Payroll and HRM all mount — so one edit answers it in
every place an employee's money is listed.

**NOTHING NEW IS STORED.** Every movement already knew its account, in one of two
places, and the engine now reads both (`platform/engines-library/payroll.js`, section
*WHERE THE MONEY MOVED*): the **journal** is the definitive answer — its cash line names
the real account — and the transaction's own **`method`** answers for a movement whose
journal id is rebuilt from a counter that `unpay()` shifts (the trap `payroll.js`
`monthTxns` documents). `empLedger()` and `loanBook()` stamp `source · sourceKind ·
sourceDir · sourceCash · sourceOffset · sourceGuess` on every row; the engine formats no
money, so the view writes the sentence and the two can never drift.

- **Three answers kept apart, because one number would mislead.** An **accrual** is not a
  payment and says so ("Accrued to Salary Payable — no money moved") instead of naming an
  account it never used. A **salary deduction** is real money given back with no account
  moving ("Deducted from the July 2026 salary"). And a payment can be **both** — ৳59,831
  left Eastern Bank, ৳3,333 was recovered out of the same salary — so the cell prints the
  two figures rather than one total.
- **A reversed instalment names no account.** `unpay()` keeps `payCount` so reversal ids
  stay unique; a `GL-PAYP-…-n` with a matching `GL-UNPAY-…-n` is skipped, or the row would
  name the bank money was taken back OUT of.
- **`sourceGuess`** marks the honest case: older/seeded money with no journal behind it,
  read off the record's own method and labelled as such, never dressed up as a fact.
- **The reader is one function.** `methodSource()` answers 'bank:<id>' / 'm:<X>' / a
  legacy plain 'Cash'. `EPAL.pay.resolve()` cannot be used as the reader — handed a plain
  'Cash' it falls through to its Bank default, so every legacy cash payment would read as
  a bank payment. The plain case is answered first (same rule `payroll.js` already had).

**AND THE ENTRY POINTS NOW CAPTURE IT.** A source can only be shown if it was recorded,
and the employee file was the last surface still offering a bare `['Bank','Cash','bKash',
'Cheque']` list that moved no account — the exact bug the 2026-07-28 audit fixed on the
payroll desk. Advance · loan · repayment · bonus · pay-from-payslip · **leave-encashment
payout** · **final settlement** all pick a REAL account now (`EPAL.pay.options` of the
*employee's own* company, since the engine derives the company from the person).
`settle()` gained `opts.method` — it was the last movement posting to the abstract 1010
and moving no register; with no method passed it resolves to exactly 1010, so every
existing caller posts precisely where it always did. The payslip header and the printed
payslip now READ `payMethod` too, instead of printing a raw `bank:B-04`.

**🐞 THE DEFECT THE PROBE FOUND:** `loanBook()` builds its `payments` array a second time
inside the FIFO allocation loop, so the freshly-stamped `source` was dropped and every
loan payment read `undefined`. Caught by asserting on the *rendered* value, not on the
function that produced it.

**◻ FLAGGED, NOT CHANGED (needs an owner call):** `empLedger()` has no row for an
**encashment payout** — the accrual credits the employee but paying it out debits
nothing, so the running "net due" overstates what is owed by the amount encashed. Adding
the row changes balances on every screen that reads the ledger, so it is reported rather
than done quietly.

**VERIFIED** — boot sweep **253/253 routes × both themes, 0 console errors, 0 render
failures** · tailwind gate green (reproducible, 0 orphans) · routes-imports 46/46 · trial
balance balances · plus a purpose-built headless probe (**18 checks**): 424 ledger rows
across 18 employees all name a source with the running balance untouched; a ৳1,500 salary
payment from a named bank reads back that bank with cash + recovered = the row; a
reversal leaves no row; a loan, a manual repayment and an auto-EMI each name their own
side; Σ loan due still equals `loanOutstanding()`; a settlement moves the account it
names; and the column renders on the screen with no blank cell.

---

## 🆕 SESSION — 2026-07-29 · SALARY IS PAID MONTH BY MONTH, AND A LOAN ROW SAYS WHAT IS DUE

Two owner asks, landed together (both edit `payroll.js` and the hunks interleave).
Commit `6991280`. Detail in `docs/TASK-QUEUE.md` › T-SALARY-SPLIT and T-LOAN-ROWS.

**1 · The allocator — paying more than one month at once.** Owner: *"he might have 20K
due for his March salary and 40K for July, so I can pay Against Due 15K (due becomes
5K) and against July 30K (10K goes to the due), total due 15K."* Until now salary
payment could aim at ONE month only: the Pay… form paid the month whose row you
clicked, and earlier months were all-or-nothing through `payArrears()`, which clears
every open month in full, oldest first. There was no way to put a part-payment against
March and a different one against July in the same breath.

**Nothing in the accounting had to move.** `pay(empId, ym, amount, method)` has always
booked a PARTIAL against a NAMED month, leaving the rest on 2100 Salary Payable — the
company's debt to the employee — with the slip reading `partial`. What was missing was
a way to SAY it. So the allocator is one posting per month with a figure in it, and
every guard the engine carries (never more than outstanding, advance/EMI recovery, the
`onBooks()` ledger ceiling) still applies to each leg untouched.

`payAllocator(emp, ym)` returns `{ el, post() }`, so ONE widget serves both surfaces —
it renders inline in Manage Salary and it is the body of the Pay… modal. It lists every
unpaid month via `previousDueList(empId, '9999-12')` — an upper bound, not a date, so
the question asked is "every unpaid month there is" rather than "every month before
this one". Opening March must still show that July is unpaid.
**Paid from now names a REAL account** (`EPAL.pay.options(CID)`, `'m:<Method>'`
unwrapped back to the plain word before it reaches `pay()`), so a salary payment moves
the account's own register. The old form offered a bare `['Bank','Cash','bKash',…]`
list and moved nothing — the same class of bug the 2026-07-28 audit found on advance,
loan, repayment, bonus and encashment.

**2 · Manage Salary now reads the month out in full.** Owner sent the reference app's
*Add New salary form* with: *"our current + this screenshot, by combining both. I must
need what I have now, then will be added the new screenshot like shape."* So the modal
keeps its identity row, its four stats and every button EXACTLY, and gains four cards
beneath: **Salary record** (month · generated · scheduled · method · status · gross ·
total deductions · total additions · bonus · adjustment · net + amount in words) ·
**Attendance summary** · **Deduction breakdown** · **Overtime & additions**. Size went
`md` → `lg`; the fact tiles reuse `.emp-facts`/`.emp-fact` from the employee profile so
the modal reads as one system.

They are READ-OUTS, not inputs. The month is still edited where it always was — Adjust
(`correctionForm`) while the run is a draft. Two places to type the same figure is how
the two drift apart. Net checks by construction: gross + additions − deductions IS
`slipPayable(s)`, the tiles are that sum split.

**Where the reference shows something this system does not hold, the tile says what we
DO hold.** Attendance is recorded in DAYS (present · absent · late count · early-leave
count · overtime hours) — there is no clock-in/out anywhere, so late MINUTES and worked
HOURS cannot be shown, and the card says so rather than inventing them (same gap the
task queue already flags as an owner decision). The overtime RATE is read back out of
the slip (`overtime ÷ hours`) rather than recomputed — a slip does not carry `otRate`,
and recomputing would quote today's package against a month finalized under the old one.
**⏭ Still needs an owner call:** the reference's free-text **Note** and editable
**Bonus Label** are new persisted fields (column + migration + a place on Adjust), so
they were not invented into the store.

**3 · Every loan row says taken · taken on · paid till now · still due.** New engine
read `EPAL.payroll.loanBook(empId)` rebuilds the per-loan book from the movements the
engine already records — every disbursement is a loan, every repayment (manual, the
auto payslip EMI, or a settlement) applied FIFO to the oldest open loan. Nothing is
stored, and Σ due IS `loanOutstanding()` by construction, so no tile can drift from
another. Surfaced on Payroll › Loans (plus a Loan register and a per-loan drill-down
with the balance after each payment), Staff Accounts, the employee file, Payroll ›
Reports and Master Accounts › Manage Loan.

**Verified:** routes-imports 46/46 · tailwind reproducible + 0 orphans · every committed
`view.js` is the real build of its sources · boot sweep **253/253 routes × both themes,
0 console errors, 0 render failures** · trial balance balances · and the allocator
driven end-to-end in headless Chrome — 26,474 typed against January and 16,805 against
July of 35,298/33,609 left **8,824 + 16,804 = 25,628**, exactly what the footer
previewed before the button was pressed.

---

## 🆕 SESSION — 2026-07-29 · "ALL COMPANIES" ON MASTER PAYROLL — THE GROUP AS ONE PAYROLL

**The ask** (owner screenshot of Master Payroll ▸ Loans, six arrows at the company
switcher): *"the group acts as a company now in the payroll, as group has its
employees. So make another button before group, 'All Company', so every nav's
switcher gives us a combined view. I am in the Loan section and switch to All
Companies, so I see all loan employees with their loan taken, paid, due as of — the
loan-related transaction history of all companies."*

**The button was already in the markup and was being DELETED.** `[data-co="all"]`
has always been the first button in `[data-shell="switcher"]`, before Group HQ,
exactly where the owner asked for it. THREE places threw it away, and finding only
two cost a debugging round: the switcher wiring removed the button on payroll; ten
lines above it `if (sub === 'payroll' && selCo === 'all') selCo = 'travels';`
silently rewrote the scope; and `payrollView` rewrote it a third time on the way
into the desk. All three are gone — `selCo` now reaches the desk untouched.

**ONE SENTINEL, ONE SCOPE LAYER.** `CID` carries `'all'`, and nothing in the desk
compares `CID` to a company id any more. Every read goes through `inScope(companyId)`
· `scopeCids()` · `scoped(store)` · `slipsIn(ym)` · `runInfo(ym)` · `deptCost()` ·
`payOptions(cid)`, each of which reduces to exactly the old code on a single company,
so a company desk did not move by a pixel or a taka. **Group HQ is one of the scoped
companies** — that was the owner's first sentence. Every list gains a Company column
and a Company filter in all-mode ONLY (`withCo(cols, get, at)` returns the array it
was handed when the scope is one company, so the existing column order is untouched).

**WHAT IT DELIBERATELY WILL NOT DO: post a RUN.** Generate · Finalize · Reopen ·
Pay All and the salary STRUCTURE write records keyed by company id, and `'all'` is
not a company: `generate('all', ym)` would create a `pay_runs` row against a company
that does not exist, and `EPAL.pay.accountsOf('all')` would *invent a cash box* for
it (`ensureCashBox` creates on read — the trap that shaped `payOptions()`). Those
controls are replaced by a note naming the concerns, and the AUTOPILOT becomes a
board read-out saying WHICH company is behind and by how much. Everything keyed by an
EMPLOYEE keeps working — loan, advance, repayment, payslip, payment, punishment —
because the engine derives the company from the person (`compOf(empId)`,
`slip.companyId`). **"Paid from" follows the employee**, so a Woodart loan can never
be paid out of a Travels account. Salary Template shows every company's structure
side by side, read-only, instead of an editable one that would belong to nobody.
A month that six companies are at different stages of reads **Mixed** — never one
company's status borrowed for the group.

**VERIFIED** — sweep **253/253 × both themes, 0 console errors** · tw gate green ·
trial balance balances · a purpose-built driver **31/31**: it clicks the button,
walks all eight tabs, opens an *IT Solutions* loan out of the combined register,
proves the account list re-fills when the employee's company changes, asserts the run
controls are absent and Print Sheet is not, asserts **nothing was ever written
against a company called "all"**, and asserts a single company still reads exactly as
before. The loan proof is the real one: the screen's "Still due" column sums to
Σ `loanOutstanding()` over EVERY company (৳1,68,837) rather than Travels' ৳92,000.

---

## 🆕 SESSION — 2026-07-29 · SALARY TEMPLATES: A SAVED PACKAGE PER EMPLOYEE, AND IT IS THE PAY

**The ask** (owner screenshot of the group's existing *Salary Templates List*): the saved
template for an individual employee should appear on the Payroll › Salary Template tab,
be editable, allow **overtime to be turned on there**, carry a **deduction as punishment**,
and offer **an option to make a new template**.

**Why it was a new thing, not an edit.** `pay_templates` is ONE record per company — the
statutory structure (basic 60% / house 25% / medical 10% of `emp.salary`, tax, PF, leave,
working days, pay-by + correction days). It answers *how a salary is split*. The screenshot
answers a different question — *what THIS person is paid* — in fixed taka. So a second
store, `pay_salary_tpl`, sits beside it and the tab now has two halves (list on top, the
untouched Structure + Live Preview below).

- **The list** — name · basic · house rent · medical · conveyance · other · bonus · total ·
  overtime · punishment, one row per employee, searchable by name **or** employee ID,
  exportable, with **Add New Salary Template** and four row actions (edit · overtime on/off ·
  punish · delete). Real HTML `<section data-screen="salary-templates">`; only the grid is JS.
- **It DRIVES THE PAY.** `computeSlip` takes gross and all five components from the template
  when the employee is on one (`empIds`), and `total` is always the five added up — never
  typed — so the list can't show a total the payslip disagrees with. Tax, PF, absence,
  lateness and encashment still come from Structure: the statutory rules stay in one place.
  New slip fields: `otherAllow`, `tplBonus`, `fine`/`fineExtra`/`fineNote`, `pkgId`/`pkgName`.
- **Overtime** = a switch on the template + an optional own ৳/hour rate over the company
  default. (Turning it off zeroes the recorded hours — the same semantics `emp.otEligible`
  always had.)
- **Punishment, both shapes:** a **standing** fine that runs every month until taken off the
  template, and a **one-off** on ONE month (from the list, and on Edit Salary). Both print on
  the payslip with their reason, and both are *recovered* in the accrual (they reduce salary
  cost — they are not income), so `expense − tax − pf = payable` still holds by construction.
- **NOTHING THAT EXISTS MOVED.** The list **seeds itself DERIVED from the staff actually on
  the payroll** — each seeded template is exactly what the percentages compute for that
  salary, conveyance being the same remainder — so opening the tab changes not one figure.
  Proved by recomputing EVERY month before and after: zero differences. Off-template
  employees compute exactly as before; an old payslip carries no bonus/fine fields → reads 0.
- **Assignment lives on the TEMPLATE (`empIds`), not on the employee record** — the employees
  store is hydrated from the group directory and a payroll desk must not write into it. One
  person, one template: assigning detaches them from any other, so two templates can never
  both claim to be someone's pay (the payslip would then depend on record order).

**🐞 TWO DEFECTS THE PROBES FOUND (both fixed in the same commit):**
1. **A partial save was a full save.** The overtime toggle sends `{id, otEligible}`;
   `savePackage` derived `empIds`/`total` from that alone, so flipping one switch
   **detached the employee and zeroed the template** — quietly changing someone's pay.
   Saves now merge onto the stored record.
2. **An attendance save erased a fine.** Every caller of `adjustSlip` rebuilds the whole
   adjustment set by hand (it recomputes the slip from scratch), and the attendance path
   did not carry the new `fineExtra`. They all read the new **`slipAdj(slip)`** now — one
   place, so the next new field cannot be dropped by one caller and kept by another.

**VERIFIED** — sweep **253/253 × both themes, 0 console errors** · tw gate green · trial
balance balances · **23 engine checks** (seed neutrality across every month · the template
driving gross/components/PF/bonus/fine · the OT switch and its rate · a one-off fine adding
to the standing one, printing with both reasons and surviving an attendance save · the
accrual balancing · delete putting the employee back on the percentages while a punishment
already applied to a month STAYS) · **19 screen checks** at the standalone route and embedded
in Master Accounts › Master Payroll. Commit a7a5d4b.

**◻ Still owed:** no Laravel slice for `pay_salary_tpl` (local-only, like every store whose
backend has not been written yet) — the table is `salary_templates` + a
`salary_template_employee` pivot when it is built.

---

## 🆕 SESSION — 2026-07-28 · PAYROLL BECOMES A COMMAND CENTRE (owner ask: "make it world class")

**The ask.** The owner pointed at *Manage Banks* — "I liked its KPI, its structure and
its styles; I want this type in the Payroll too" — plus: month-by-month reports that drill
into every employee's figures for that month, search by name **and** employee ID, an
employee file that opens everything, and "automations, AI, brief". Then, mid-build:
*"the payroll should be reflected both in the master account and in the travels account
accordingly — design, UI, functions, logics, everything."*

**Why that last line was already satisfied by the architecture.** There is exactly ONE
payroll implementation — `companies/travels/modules/payroll/` — and it mounts in four
places: the standalone route `<cid>/payroll` (woodart · it · shop · construction),
`EPAL.payrollDesk` inside **Master Accounts › Master Payroll**, inside **Travels ›
Accounts › Payroll**, and inside **Woodart › Accounts › Payroll**. A `VIEWS` map now
drives BOTH the route and the embedded desk, so the group desk and a company desk cannot
drift apart. One edit ships to all six companies.

**WHAT SHIPPED**
- **The dashboard row** — `[data-shell="dash"]`, real HTML, four same-height cards, filled
  by `dashRow(cfg)`: brand-accented identity panel (hero figure · 3 clickable drill facts ·
  the LAST PAYROLL EVENT as a mini-statement with IN/OUT/ACCRUED, a ref chip and
  owed-before → owed-after) · a mirrored sparkline · a reconciliation card · a mini stack.
  It heads **Payroll Overview**, **Salary Manage** (month-scoped) and the **month drill**.
  ⚠ It deliberately reuses the `bank-*` classes from `components.css`: that block is the
  house SUMMARY-IDENTITY-PANEL design and Manage Banks was merely its first caller —
  reusing it makes Payroll pixel-consistent with Banks for free and forks zero rules.
  The `pay-*` classes alongside carry no styling; they are override hooks.
- **NEW TAB · Payroll Overview** (now the landing tab, first in `TABS`) — the dashboard
  row, the **brief row**, the **Monthly Register** and department cost.
- **THE BRIEF ROW** (`.pay-brief-row`, owner 2026-07-30) — **Payroll Autopilot** ·
  **Anomaly Radar** · the narrated **digest**, three cards in ONE row of a fixed height
  (`max-height:264px`), each scrolling inside its own `.card-body`. The digest used to be a
  full-width navy `.brief-hero` above the row; it is the same live narrative, now the third
  card (`.pay-digest-scope` + `.pay-digest-text`, emphasis in `--accent` because gold on a
  white card is unreadable). Autopilot and radar are sorted **critical first** by
  `bySeverity()` (high → med → low, stable), and the radar sorts BEFORE its `slice(0,12)`
  so the twelve that survive the cut are the twelve that matter.
- **NET PAYABLE — the formula, and where the recovery happens** (owner 2026-07-30, the
  payslip audit). Gross + overtime + bonus **−** advance **−** loan EMI **−** absent **−**
  every other deduction (late · fine · tax · PF · adjustment⁻) **= net payable**, and
  **net payable − paid = due**. **Leave encashment is outside it** — a yearly accrual on
  2150, paid once, moving none of the three.
  · **The bug it fixes:** the advance and the EMI used to come off at PAYMENT time (`pay()`
  split the payable into recovery + cash), so the sheet printed two deduction columns the
  Net Payable beside them had never subtracted, and a month approved-but-unpaid showed an
  EMI that had touched nothing — not the net, not the cash, not the loan book.
  · **Now:** the recovery is part of the payslip. `slipRecovery(s)` is the ONE authority
  (frozen figures once approved · what a legacy payment actually recovered · else the plan);
  `slipPayable` = `slipEarned − advance − EMI`, floored at 0; `slipPaid` is the CASH the
  employee got (it takes a legacy payment's recovery back out, so Due never moves on a
  settled month); `slipDue` closes the row. The sheet columns, the payslip print, the
  makeup card, the accrual and the approval check all read them — nothing recomputes.
  · **The accrual books it** (`accrueSlip`): Dr 5100 · Cr 2120 tax · Cr 2110 PF ·
  **Cr 1250 advance · Cr 1260 EMI** · Cr 2100 net payable, plus one stable
  `PT-EMI-<emp>-<ym>` repayment so **the loan book falls the moment the month is approved**.
  `pay()` then moves cash only, and **self-heals** a slip accrued under the old rule by
  re-posting its accrual first (safe: nothing has moved on it). `unfinalize` gives both back.
  · **Settled history is read, not rewritten:** a month already paid under the old rule keeps
  its journals exactly as posted (`legacyPaid` skips the re-post) — the payment entry already
  credited 1250/1260, so re-posting would credit them twice and drive 2100 negative.
  · **Never negative:** the plan is capped at what the month can bear; what will not fit is
  simply not deducted, stays outstanding, and next month's plan picks it up — `short` marks
  the row with a caret on Net Payable. · **`runCheck(cid, ym)`** re-derives every row from
  its own fields (never from `slipPayable` — a check that asks the function it is checking
  proves nothing) and **blocks `finalize()`**; the desk shows the failing rows and the amount
  each is off by. · **`emiGap()`** audits every non-draft slip ever written: EMI a sheet
  SHOWED against EMI that actually moved. Harness: `node tools/verify/books.mjs payslip`
  (the arithmetic, the ledger, the loan book, the owner's reported rows) and `… emigap`.
- **THE PAYROLL AUDIT** (`node tools/verify/payroll-audit.mjs [--verbose]`, 2026-07-30) —
  every payroll account and every table that restates a payslip, footed against the ledger
  in a booted app: 1250 · 1260 · 2100 · 2110 · 2120 · 2150 against the records; the row
  maths on every slip ever written; every journal balancing; the sheet, monthly register,
  loan register, arrears, printed payslip and employee ledger agreeing; and the sanity
  rules (nothing negative, no orphan slip, no EMI over what is owed). **It found four real
  faults**, all fixed: (1) `platform/kit/loans.js`'s one-time "detach the loans desk from
  the GL" cleanup matched `^GL-(LNOPEN|LOAN|LREP|LNWO)-` and so **deleted PAYROLL's
  staff-loan journals** — ৳92,000 of loans with a record and no journal, 1260 reading ৳4
  against a register of ৳92,004 (it now excludes `source==='payroll'`); (2) the journal id
  for a loan/advance/repayment/bonus was built from a COUNT, so deleting one money event
  made the next posting **overwrite a live journal** — ids now derive from the txn's own id
  (`txnGlId`); (3) the employee ledger credited a **bonus** that `bonus()` had already paid
  out and never debited it, and never credited back a **recovered advance** (a loan had its
  repayment row, an advance had none) — one ledger closed ৳39,000 high, another ৳33,000
  low; (4) the loan register filed an EMI taken at accrual as a **cash** repayment because
  it sniffed the memo for `EMI auto-deducted from ` (now `isEmiRepay`, which reads the
  slipId the txn carries). `EPAL.payroll.journalGap()` reports money events with no journal
  — read-only, because posting a journal for a record is a decision about someone's books.
- **Payroll ↔ Ledger reconciliation** — the piece no off-the-shelf payroll ships. Salary
  Payable **2100** vs what the payslips still say is outstanding, plus advances+loans
  (1250/1260) and the variance, with a **"why?"** explainer that lists the months where the
  two disagree. `ACC` in payroll.js mirrors the engine's posting rules.
- **AUTOPILOT — proposals only** (owner: *"automation will [be] on overview, summary"*).
  It detects: correction window open · month not accrued · salaries due (louder past the
  pay-by date) · past-month arrears · staff who completed a year (encashment payable) ·
  loans with **no EMI schedule** · employees with **no salary set** · a ledger↔sheet
  variance. Each is a card with the button that does it. **Nothing posts by itself**, so an
  "automatic" payroll can never surprise the bank.
- **AI, honestly.** This is a static site with no LLM backend, and the app's existing AI
  (MD Briefing) is `EPAL.intel` — a deterministic narrative engine. The payroll digest and
  radar follow that pattern rather than faking a chatbot: overpayment vs the payslip,
  unpaid ≥2 months, an advance bigger than a month's salary, a loan that runs past two
  years, a ±25% pay swing month-on-month, 5+ absent days. Every finding names the person
  and opens their file.
- **MONTHLY REGISTER → the month drill** (`<section data-screen="month">`) — click a month
  and get: its own dashboard row, a **23-column Salary Register** (gross · absent · earned
  gross · overtime · bonus · adjustment · **additions** · late · early · tax · PF · other ·
  **deductions** · net payable · encash accrued · advance recovered · loan EMI · cash out ·
  paid · due · status) that is exportable/printable, plus **every employee money movement**
  and **every ledger posting** payroll wrote that month. Presentation matches
  `slipPayable()` exactly — `earnedGross` is already net of absence, so absence is shown as
  its own line and never double-deducted.
- **NEW TAB · Staff Accounts** — searchable by **name OR employee ID** (also added `empId`
  to every other payroll table's `searchKeys`). Columns: net position (we owe / they owe),
  salary due, advance out, loan out + EMI, leave encashment + eligibility, last paid,
  record count. A row opens `EPAL.people.open()` — the existing universal dossier (ledger
  with running net-due · payslip history · attendance · full A–Z details · money actions).
- **Salary Manage** — the five flat KPI tiles became the same dashboard row. Every figure
  they carried survives: Headcount and Gross are drill facts, Net Payable is the hero, Paid
  and Outstanding live in the payment-progress and add-up cards. The run bar and the
  13-column salary sheet are untouched.

**🐞 TRAP WORTH REMEMBERING — `hidden` is NOT enough to hide a prototype row.** The UA rule
`[hidden]{display:none}` and a house class like `.brief-exc{display:flex}` /
`.btn{display:inline-flex}` have the SAME specificity, and the author sheet applies later —
so the class wins and a "hidden" `[data-proto]` row renders as a blank card row. Found by
the headless driver, not by eye. **Anything that must not appear is REMOVED from the DOM,
never hidden.** This applies to every module using the `[hidden][data-proto]` pattern.

**VERIFIED** — sweep **253/253 × both themes, 0 console errors**; tailwind gate green (24
classes, no orphans, byte-identical rebuild — no new `tw-` literal was needed); trial
balance balances. Plus a purpose-built headless driver (21 checks) that clicks through
every tab, opens the month drill and back, searches an employee ID down to one row, and
asserts the dashboard row is fully filled at **all four mount points** including a company
with no payroll history (readable zero-state, never a blank).

### PAYROLL HISTORY (same day, second slice) — and what the data actually said

Owner asked for a **Payroll History** card under the Salary Sheet: one row per month
(newest first) with staff paid · gross · net paid · outstanding · run status; the row opens
every payroll transaction that month; a transaction opens its own printable detail, with
the shared **`EPAL.journalVoucher`** when a posting exists. Built — and **three assumptions
in the brief turned out to be false**, each verified against
`platform/engines-library/payroll.js` before a line was written:

1. **`pay_txns` does NOT store a glId.** The engine derives ids from a per-employee,
   per-type COUNTER at post time (`GL-ADV-<empId>-<n>` …). So the id is REBUILT here and
   then **checked against the ledger** — and validated (right employee, right amount, right
   `ref` prefix, never a `GL-UNPAY-` reversal) before it is trusted. `unpay()` **deletes**
   the auto-EMI rows it created, which SHIFTS every later repayment's ordinal, so an
   unvalidated rebuild would happily print **another transaction's voucher**. The button
   only appears when a validated entry is found.
2. **A payslip carries no bank name** — only a free-text `payMethod`, and only the LAST one.
   "Paid from" is therefore read from the JOURNAL's own cash line and falls back to the slip
   only when no journal exists.
3. **A slip can be paid in instalments**; `pay_slips` keeps totals only. Individual payments
   live at `GL-PAYP-<empId>-<ym>-<n>`, so salary rows are enumerated from those — a partial
   payment gets its own dated row, which is the point of a history.

**🐞 THE BUG THAT MATTERED MOST — a reversed payment is still on the books.** `unpay()`
posts the opposite entry and **deliberately keeps `payCount`** ("reversal ids stay unique").
Enumerating `n = 1..payCount` therefore lists money that was taken back, and after one
Reopen-Draft → Pay-All cycle the same salary appears **twice**. Fixed by skipping any
`GL-PAYP-…-n` that has a matching `GL-UNPAY-…-n`. Proved by a headless test that reverses a
real payment through `EPAL.payroll.unpay()` and re-pays it: the row disappears, then comes
back exactly once.

**THREE DIRECTIONS, NOT ONE TOTAL.** A payroll month mixes money that LEFT an account, money
that CAME BACK (a loan repayment — posted DR cash, so treating its cash as an outflow adds
inbound money to the outflow total), and money that never moved at all (an advance or a loan
EMI recovered *inside* the same salary payment, which is a real transaction that is also
already inside the salary figure above it). Every row carries a direction, and the sheet
says all three plainly instead of one misleading number:
*"Of the ৳139,177 listed above: ৳117,511 left an account · ৳21,666 was recovered inside a
salary payment, so it is listed but never touched the bank."*

Also fixed, each found by the adversarial review and confirmed in the engine source:
`paidFrom()` rendered every legacy plain method (`'Cash'`, `'bKash'`) as **"Bank"**, because
`EPAL.pay.resolve()` falls through to a Bank default for unprefixed strings — the plain case
is now answered before resolve() is consulted; an auto-deducted EMI claimed **"Paid from:
Bank"** though nothing moved; an auto-EMI was filed by calendar date, orphaning it away from
the salary it came out of (now filed by the payroll month its memo names); `settle()` marks
every accrued month paid with **no per-month journal**, which the fallback would have
reported as a second lot of cash (now labelled as cleared in the settlement); the CSV/PDF
exported **blank** Staff-paid and Run-status columns (`exportVal` added — `EPAL.table`
exports `row[key]`, not the rendered cell); a month with payslips but no `pay_runs` row —
the exact case the month list is a UNION for — was shown as **"Draft"**, a claim the data
does not make, and now reads **"No run"**; and "Staff paid" counted anyone with a token
part-payment, so it now counts only heads with nothing still due.

**VERIFIED** — sweep **253/253 × both themes, 0 errors**; tw gate green; trial balance
balances; plus **20 headless checks** on the feature and **9 more** that drive the real
engine (reverse a payment, re-pay it, stamp a legacy `'Cash'` method) and read back what the
history says. `monthSeries()` gained `paidHeads` and stayed the single month-list function,
so a month can never exist on one payroll screen and be missing from another.

**◻ STILL OWED on payroll:** no backend slice for the new screens — they are read models
over stores Master Accounts' payroll backend already persists (`pay_runs`/`pay_slips`/
`pay_txns`/`pay_templates`), so nothing new needs a table, but the Laravel read endpoints
for the register/overview are not written. The dossier (`platform/kit/emp-profile.js`) was
NOT touched — it already covers ledger/payslips/loans/advances/settlement; deepening it is
the natural next slice.

---

## 🆕 SESSION — 2026-07-27 · GROUP CONSOLIDATED P&L (accounting step 5, part 2 — the plan's LAST step)

**Step 5 part 2 is DONE — the accounting build order is now complete.**

**Engine (`platform/engines-library/ledger.js`, directly loaded, no build):**
- **`consolidatedPnl({from,to})`** — the group income statement: every PRESENT
  concern plus **Group HQ**, per-entity columns, an **Elimination** column and the
  group total. Returns rows + `totals.per / .elimination / .group`.
- **The elimination rule (the whole point).** When Travels invoices Woodart, Travels
  books revenue and Woodart books an expense; summing the concerns naively inflates
  BOTH group totals while the net stays right — so every margin and every "expense as
  % of revenue" reads wrong. `intercompanyPnlElimination()` groups the
  `source:'intercompany'` journals by their pair `ref` and eliminates a ref **only
  when it has BOTH an income credit and an expense debit** (a real internal sale).
  A **funded expense** or a **shared cost** has an expense but no matching internal
  revenue — that money genuinely left the group to a landlord or vendor, so it STAYS.
  This is the income-statement half of what `consolidatedTrialBalance()` already does
  for 1300/2400 on the balance sheet.
- Also extracted `presentCompanies()` (one list for both consolidations, so they can
  never disagree about who is in the group), `consolidatedEntities()` (+ Group HQ) and
  a named `COGS_ACCOUNT`.

**UI — Group Finance › P&L by Concern** now renders that call instead of a naive sum:
an **Elimination** column (deductions in brackets), a **Group** column that is the real
consolidated figure, an **Inter-company** KPI, and a footnote saying what was removed
and what deliberately was not. The CSV export is the same consolidation, so screen and
export can never disagree. On today's demo data it strips **৳26,00,000** of internal
sales — the group revenue KPI was overstated by exactly that until now.

**Verified:** 17/17 engine probe — ties to the per-entity sum; an internal sale moves
the concerns but leaves group revenue, cost AND net untouched; a funded expense and a
shared cost are NOT eliminated; periods scope; empty period is empty; and the BASELINE
consolidated TB still balances (no regression). Sweep 222/222 × both themes, 0 errors.

> **⚠️ Pre-existing gap this surfaced (NOT introduced here, worth a decision):**
> `consolidatedTrialBalance()` covers the operating companies only — **Group HQ's own
> books are omitted**. So a group-FUNDED expense or a group-paid SHARED cost leaves the
> concern's leg inside the consolidation while its counterpart sits outside, and the
> consolidated TB goes out by that amount (the probe reproduced it exactly: ৳1,00,000
> from ৳40,000 funded + ৳60,000 shared). The new consolidated **P&L does not have this
> gap** — it includes Group HQ. Fixing the TB would change numbers on the Consolidation
> screen, so it is left for the owner to call.

**Also this session (owner screenshot, live site):**
- **Removed the Salary + Office Rent quick cards** from Record Expense — salary belongs
  to Payroll, rent is entered once at Group HQ and split, so a card here invited
  double-booking. Both remain in the whole-account search (nothing became unpostable)
  and picking one now warns which desk owns it.
- **Fixed a real deployment hazard:** `AccEntryService` / `ExpensePostingService` wrote
  the new `bank_id` / `bank_name` / `pay_acct` columns unconditionally. On a host that
  pulled the code but had not run `php artisan migrate` — **which is the live host** —
  every save would hit "unknown column", the client would roll back its optimistic row
  and the user would see **"Save failed"** on a feature that works. Both now write those
  columns only when they exist (`Schema::hasColumn`, instance-cached). New test:
  `test_it_still_records_on_a_database_missing_the_payment_columns`. PHP 12/12.

---

## 🆕 SESSION — 2026-07-26 (cont'd) · RECORD EXPENSE: REAL ACCOUNTS, WHOLE-CHART SEARCH, FULL PROPAGATION + REAL LARAVEL

Owner screenshot of `#/travels/accounts/expenses` with the **Record Expense** modal
open and **"Payment method" circled in red** (it only offered `Bank`). Four asks —
see `docs/TASK-QUEUE.md` T-EXP-SOURCE for the verbatim log. All four shipped.

**1 · "Paid from (bank / cash account)" replaces "Payment method".** The field now
lists the REAL accounts from Manage Banks — bank accounts, cash boxes (hard cash /
petty cash), wallets, cards — in the owner's order (**bank → cash → wallet**), and it
**follows "Funded by"**: another concern's money offers THAT concern's accounts,
because that is whose account the cash leaves. The 7 generic methods stay at the END
of the list, labelled "no registered account", so a cheque or card swipe with no
registered account is still recordable (nothing removed — R3).

**2 · "Or search the whole account list"** sits beside the ten cards. Every chart
code, **expense heads first**, then each head's items, then the rest of the chart.
Typing "tea" surfaces *Tea / Coffee (Guest)* and *Tea & Coffee*; picking an item
lights its **card AND its chip**, and clicking a card fills the field back — both
ways in, always in sync. Non-expense codes are pickable too (the owner asked for the
whole list) with a note that the posting lands on the balance sheet, not the P&L.

**3 · Propagation — one spend, every book.** register (`acc_entries`, now carrying
`bankId`/`bankName`/`payAcct`) → GL (`GL-ACC-…`, and `GL-ACF-…` on the funder's books
for an inter-company spend) → **the paying account's balance + a withdrawal row in
its own transaction history** (through the SHARED `EPAL.bankTxnApply`, so Travels ›
Banks and Master Accounts › Manage Banks both show it and stay reconciled) → the
group bridge `expense.recorded` event. An **edit** posts an adjustment row and a
**delete** posts a reversal row + flags the original: a balance never moves without a
row explaining why (AUDIT P2).

**4 · Real Laravel, not a sketch.** Posting rules in the KERNEL (a company module
must never reach into another company's code), HTTP surface in the module:
- `platform/backend/app/Services/ExpensePostingService.php` — `record()` / `void()`:
  all three books in ONE `DB::transaction`, idempotent by voucher id, reversible.
- `platform/backend/app/Services/LedgerService.php` — now **THE** ledger poster
  (`post`/`reverse`/`expenseAccountFor`). `JournalController@store` delegates to it,
  same HTTP contract as before; the duplicated posting code is gone.
- `platform/backend/app/Services/BankRegisterService.php` — the server twin of
  `bankTxnApply` (atomic increment/decrement + the `bank_transactions` row).
- `platform/backend/app/Support/CompanySlugs.php` — the ONE slug ↔ `companies.id` map
  (was privately duplicated in Bank/Journal controllers).
- `companies/travels/modules/accounts/backend/ExpenseController.php` +
  `Http/Requests/StoreExpenseRequest.php` — `GET|POST /api/travels/accounts/expenses`,
  `GET …/expenses/form` (heads + accounts pre-ordered for the form),
  `DELETE …/expenses/{voucher}`. Documented with a worked example in the file header
  and in the module's `LARAVEL-BLUEPRINT.md`.
- Migrations: `…master-accounts/…/2026_07_26_002000_add_payment_source_to_acc_entries`
  (`bank_id`, `bank_name`, `pay_acct`) and
  `platform/backend/…/2026_07_26_003000_add_entry_trail_to_bank_transactions`
  (`entry_ref`, `reversed`). **Run `php artisan migrate`.**
- **9 feature tests** — `platform/backend/tests/Feature/ExpensePostingTest.php`:
  all three books, cash box → 1000, the inter-company legs on both companies,
  wrong-owner account refused, unknown head refused, re-post never duplicates, void
  reverses everything. Suite **11/11 green** (needs `pdo_sqlite`; if php.ini has it
  off, run `php -d extension=pdo_sqlite vendor/bin/phpunit`).

**Platform kit:** `EPAL.form(...)` gained `setOptions(key, options, prefer)` —
repopulate a select after build (dependent dropdowns) and the searchable combobox is
rebuilt around the SAME `<select>`, so `values()`/`validate()`/`showIf` never notice.

**Verified:** rebuilt `view.js` (compiled module — build step, see the trap below);
**sweep 222/222 routes × both themes, 0 console errors**; a headless CDP drive of the
modal, **18/18 assertions** — the account ordering, the "tea" search, both-ways card↔
list sync, the funder re-filter, `DR 5550 / CR 1010`, the balance ৳900,000 → ৳898,750,
the withdrawal row, and the inter-company pair (`DR 5500/CR 2400` on Travels,
`DR 1300/CR 1010` on Group, Group HQ's balance the one that dropped).

**FOLLOW-UPS — same day, all three known-open items closed** (owner: "push, then
solve, then again push"):

1. **`bank_txns` persistence is SELF-HEALING now.** `BankTxnController@index` reports
   `provisioned: true|false`; `platform/data/api.js` hydrates the log always and
   promotes it into `WRITABLE` only when the server says the table exists (new
   `CONDITIONAL` map + a `console.warn` naming the gap instead of hiding it). The log
   starts persisting **by itself** the moment `php artisan migrate` runs on the host —
   no redeploy — and there is no save-fail → re-render loop if it never does. That
   loop is exactly why bank_txns was pulled out of HYDRATE/WRITABLE in July; this is
   the safe way back in. Verified by loading the real api.js with stubs: **8/8** over
   both branches (read always on · no POST when unprovisioned · POST when provisioned).
2. **New Journal Entry** (Travels, income AND expense) uses the account picker too.
   Income ADDS to the chosen account (deposit row), Expense takes it out, and moving
   an entry to a DIFFERENT account refunds the old one in full and charges the new one
   — two honest rows, never a silent balance swap between accounts.
3. **Master Accounts › Operational Expenses + Shared Cost** got the same picker: the
   list follows *Company* / *Paid by*, the spend moves that account's balance and
   history, and for a shared cost the **payer's account loses the FULL bill** (one
   register row) while the other concerns only owe their share (2400). Fixed on the
   way: with the desk scoped to "All companies" the picker offered only generic
   methods — an `'all'`/unset scope is not a company, it means Group HQ.

**ONE implementation (important):** the payment-source + register-leg helpers now live
in the platform cash kit as **`EPAL.pay`** (`platform/kit/cash.js`) —
`accountsOf · options · valueOf · resolve · stamp · cashEffect · syncRegister ·
reverseRegister`. Travels Accounts (expense + journal entry) and both Master Accounts
desks call it, so a fix cannot land in one screen and drift in the other. The Travels
module keeps four one-line locals purely for call-site readability.
`EPAL.formModal` gained **`onReady(form)`** — the hook for dependent fields.

**Verified (follow-ups):** rebuilt both modules' `view.js`; sweep **222/222 × both
themes, 0 console errors**; trial balance balances; PHP suite **11/11**; a headless
drive of all three screens **20/20** — including the move-to-another-account trail
(`deposit:5000 | withdraw:5000 (rev) | deposit:8000`), the shared cost's single
full-bill row on the payer's account, and **Dr − Cr = 0 for travels, group AND woodart**
after every posting.

---

## 🆕 SESSION — 2026-07-26 (cont'd) · STATEMENT SUITE V2 — PERIOD-AWARE (build-order step 5, part 1)

Made the Travels **Ledgers** statement suite period-aware (the "V2" upgrade). The
per-company suite already existed (Overview · General Ledger · Trial Balance · Party
Ledger · AR/AP Ageing · Balance Sheet · P&L, with print + CSV) — step 5 is enhancement.

- **Engine (`platform/engines-library/ledger.js`, directly-loaded, no build)** — made
  period-aware ADDITIVELY: `trialBalance(companyId, {asOf, from, to})` and
  `balanceSheet(companyId, {asOf})`. Both default to the all-time/latest result
  (byte-identical when no opts) — `pnl` already took `{from,to}`.
- **Ledgers UI (`ledgers.js` → rebuilt `view.js`)** — new shared `periodControl`
  (range pills: All · This/Last month · This/Last year · Custom From/To) on the **P&L**
  tab, and `asOfControl` (As-of date + Latest) on **Trial Balance** + **Balance Sheet**.
  Each repaints its host in place. Print docs (`printPnl/printTrial/printBalanceSheet`)
  now carry the period/as-of label.
- **Verified:** rebuilt view.js; **sweep 222/222 both themes, 0 errors**; a CDP probe
  proved every range scopes AND stays balanced — TB dr=cr ৳11.84Cr all-time, balanced
  as-of 2026-12, empty as-of 2025-01; BS A=L+E at every as-of; P&L all ৳6.47Cr → 2026
  ৳6.29Cr → empty year ৳0.

**▶ NEXT (resume here):** the REMAINING half of step 5 — **Group consolidated P&L**
(sum every concern's `pnl()` with inter-company revenue/expense elimination + the
Group's own income line). Its own focused pass: the engine has `consolidatedTrialBalance`
(eliminates 1300/2400) but no consolidated P&L, and inter-co 4000/5000 legs need
elimination care. Then printable vouchers / the rest of the reference V1/V2 list.

---

## 🆕 SESSION — 2026-07-26 (cont'd) · DASHBOARD P&L PERIOD FILTER (build-order step 4)

Shipped **build-order step 4** — the Travels Dashboard "Product P&L" card now has a
**period selector** so it doubles as a monthly & yearly P&L. All in
`companies/travels/modules/dashboard/frontend/dashboard.js` → rebuilt `view.js`.

- Period pills: **All time · This month · Last month · This year · Last year ·
  Custom** (custom reveals From/To date inputs). Anchored to demo today 2026-07-05.
- On change it re-queries the already period-aware `EPAL.ledger.pnl('travels',{from,to})`
  + `pnlByProduct('travels',{from,to})` and repaints only the table+footer (the pill
  bar persists). The card sub-title shows the active range. No engine change needed —
  both ledger fns already accept `{from,to}`.
- **Verified:** rebuilt view.js; **sweep 222/222 both themes, 0 errors**; a CDP probe
  proved the ranges genuinely scope — all-time ৳6.47Cr → 2026 ৳6.29Cr → 2026-07
  ৳47.5L → an empty past year = ৳0 / 0 products.

**▶ NEXT (resume here):** build-order **step 5 — statement suite (TB / GL / BS / P&L
V2)** + Group consolidated P&L, drawing on the reference-ERP V1/V2 report advantage
list (`docs/TASK-QUEUE.md`). Decisions all LOCKED.

---

## 🆕 SESSION — 2026-07-26 · INTER-COMPANY FUNDING LEGS (accounting build-order step 3)

Shipped **build-order step 3** of the Travels accounting buildout — expense "paid
from another company" → inter-company loan + a payable to settle (owner decision #5,
`docs/ACCOUNTING-PLAN-TRAVELS.md`). All in `companies/travels/modules/accounts/`
(frontend `accounts.js` → rebuilt `view.js`).

- **"Funded by" selector** on Travels Accounts → Expenses → **New Expense**: own
  funds (default) · Group HQ · each present concern. Own → normal DR head / CR
  cash|bank. Funded by concern X → **inter-company loan both sides**: Travels
  `DR head / CR 2400 Inter-co Payable` (owes X); funder X `DR 1300 Inter-co Rcv /
  CR 1000|1010` (paid). Live journal preview switches to show both legs. `mirrorToLedger`
  branches on `rec.fundedBy`; the funder leg is a second GL id `GL-ACF-<id>`.
- **"Inter-company balances" card** at the top of the Expenses desk (only when a
  position is open) lists every owes/owed line with a **Settle** (pay from own purse)
  or **Record receipt** action → posts the mirrored repayment legs on both books.
  New helpers: `fundingSources()`, `coLabel()`, `isKnownCo()`, `intercoPositions()`,
  `intercoCard()`, `settleInterco()`.
- **Delete** of a funded expense reverses BOTH legs (`GL-ACC-*` + `GL-ACF-*`).
- Reuses existing CSS only (`.tv-exp-live-*`, `.ma-shr-row`, `.card`), no new styles.
- **Verified:** rebuilt view.js; **sweep 222/222 both themes, 0 errors**; a CDP books
  probe proved per-company purses move exactly, the debt tracks + clears, and the
  consolidated TB stays balanced with an operating-company funder. NOTE: a **Group-HQ**
  funder's leg sits on the group's OWN books, which the operating-company
  `consolidatedTrialBalance()` deliberately omits (`type:'company'` filter) — a
  pre-existing property shared by the group-paid `sharedExpenseForm`, NOT a regression.

**▶ NEXT (resume here):** build-order **step 4 — Travels Dashboard P&L monthly/yearly
filter** (revenue, COGS, gross margin, opex, net; per-product contribution margin;
cost-per-sale & margin-per-sale; period presets), then **step 5 statement suite
(TB/GL/BS/P&L V2)** + Group consolidated P&L. Decisions all LOCKED — no re-asking.

---

## 🆕 SESSION — 2026-07-22 → 07-23 · BANK PERSISTENCE FIX + TRAVELS ACCOUNTING BUILDOUT

**Git is working now** (the 2026-07-21 "not a repo" blocker is resolved) — this
session committed and pushed ~10 small commits to `origin/main`. Headless push:
`git -c credential.helper= -c credential.helper=manager -c credential.interactive=false push origin main`.

### A. Bank card polish (Master Accounts → Manage Banks · Overview)
- Account-card text scaled down 20% (cqw × 0.8) per owner; cards stay proportional
  (`container-type: inline-size`, `min-width:0`, `max-width:340px`). CSS only.

### B. 🩹 CRITICAL — the "Operation not permitted" save-fail flood / blinking
**Symptom:** on Manage Banks, a flood of red "Not saved · Database rejected the
write: Operation not permitted" toasts on every load; earlier it also blinked.
**Root cause:** DERIVED/auto ledger backfills (bank openings `GL-OPBK-*` + the
historical expense/income mirrors) posted to the DB on EVERY page load. The
opening bank-txn used `db.save`, which — with a stale-cached `api.js` where
`bank_txns` was still writable — re-triggered the `bank_transactions` **CREATE
TABLE**, which the shared host denies (DDL EPERM → driver message "Operation not
permitted", surfaced by `bootstrap/app.php`'s QueryException→422 handler). It
never persists, so it re-fires each load. (The blink itself was the earlier
`bankRepairsRan` once-per-load latch — already in place.)
**Fix (committed `bca99b1`):**
- `ledger.post()` tags its `data:changed` event with `local: !!spec.local`.
- `api.js` `wireWrites` **skips `e.local`** — a derived entry never hits the DB.
- The 4 backfills (exp + inc mirrors, both bank-opening posts) pass `local:true`;
  the opening bank-txn uses `S.upsert` (local), not `db.save`.
- Rationale: openings/mirrors are RECOMPUTED each load from stores that already
  persist (`banks`, `acc_entries`) — they must never round-trip to the DB.
- Real user actions (deposits/withdrawals/expenses/manual journals) are NOT local
  → still persist via `journal_entries` (DML, allowed on the shared host).

### C. Recent Bank Transactions survive reload — WITHOUT the extra table
`bank_transactions` cannot be created on the shared host (DDL denied), so the log
lived only in the browser. NEW `resolveBankTxns(scopeIds)` in master-accounts:
MERGES live local `bank_txns` with any **persisted GL** bank/opening movement that
has no local row, reconstructing a txn row from the GL memo ("Deposit to <name>",
"Bank opening balance · <name>") + its 1000/1010 line. A prior-session deposit
reappears after reload, sourced from the DB. Committed `2a92b47`.
**Persistence status now:** deposit → balance (`banks`) ✔ + GL journal
(`journal_entries`) ✔ both persist; the log is reconstructed from the GL. See the
memory `api-mode-persistence-gap` for the full map.

### D. ⚠️ BUILD-STEP TRAP (important, recurring risk)
Module screens are COMPILED: `frontend/<id>.js` (+ `template.html`) →
`tools/build/build-module.mjs` → committed **`view.js`**, and **`index.html`
loads `view.js`, not the frontend source.** This session I found master-accounts'
`view.js` was STALE — B & C above were committed as frontend source but never
compiled, so they weren't actually live until the rebuild in commit `7334754`.
**Rule:** after editing any `frontend/<id>.js`, run
`node tools/build/build-module.mjs companies/<co>/modules/<id>` and commit the
regenerated `view.js` too. Directly-loaded (edit-and-go, no build): `ledger.js`,
`api.js`, `database.js`, `platform/kit/*`, `platform/core/*`, CSS.

### E. 📚 Accounting buildout for Travels — plan LOCKED + 3 features shipped
Full plan in **`docs/ACCOUNTING-PLAN-TRAVELS.md`** (§10 = the owner's 5 LOCKED
decisions). Summary of the decisions:
1. **COGS captured at the SELL entry** (per sale → product-tagged); opex in the
   Expense section. 2. **P&L lives on the Travels Dashboard** (cost-per-sale,
   margins, per-product). 3. P&L depth = **per-product contribution/gross margin
   + company net** (the standard). 4. **Shared costs entered at GROUP HQ, split
   EQUALLY** across concerns via inter-company legs (1300 Rcv / 2400 Payable).
   5. **Funding-source rule**: book the expense against whoever's money paid; if
   another company pays (Group cash → Travels bill) → inter-company **loan**
   (Travels owes Group, settle later).

Shipped this session:
- **Travels categorized expense entry** (`travels/accounts` → Expenses → "New
  Expense") — guided Category→Sub→Details modal with live journal preview,
  `TV_EXPENSE_CATS` taxonomy, `.tv-exp-*` CSS. (commit `03ea21c`)
- **COGS-at-sale already existed** via `db.postSale('travels',{amount,cost,
  category,…})` → emits `sale:recorded` → ledger auto-posts revenue (product
  income acct 4010 Air / 4020 Visa / 4050 Contract via `incomeAccountFor`) + COGS
  (5000). Added a **`product` line-tag** (`post()` preserves `line.product`; the
  sale auto-post stamps it) + **`ledger.pnlByProduct(companyId,{from,to})`** →
  per-product {revenue,cogs,gross,margin,count,perSaleCost} (keyed by income
  account + ref-matched COGS, so it works on historical sales too). contract-file
  does NOT post (it's a contract master — correct). (commit `0229310`)
- **Travels Dashboard "Product P&L" card** — per-product table (Revenue · Direct
  Cost · Gross Margin · Margin% · Cost/Sale) + company Revenue/COGS/Gross/Opex/Net
  footer, straight from the ledger. (`travels/dashboard`, rebuilt view.js)
- **Group Shared-Cost equal split** (`group/master-accounts` → Operational
  Expenses → **"Shared Cost"**) — `sharedExpenseForm()`: guided modal, concern
  chips, live split/journal preview. One-step inter-company posting: payer DR
  head own-share + DR 1300 (Σ others) + CR 1000|1010 full; each other concern DR
  head share / CR 2400. Per-concern `acc_entries` flagged `alloc` (the exp→GL
  mirror skips them, no double-post). Verified: ৳120k across 6 concerns → 6
  balanced legs, group keeps ৳20k expense + ৳100k receivable, each concern ৳20k
  expense + ৳20k payable; eliminates on consolidation. (commit `7334754`)

**▶ NEXT (resume here):** build-order **step 3 — inter-company FUNDING legs**
(expense "paid from" another company → loan/transfer + a payable the borrower must
settle), then (4b) Dashboard P&L monthly/yearly filter, then (5) statement suite
(TB/GL/BS/P&L V2). All decisions locked — no re-asking. See the memory
`accounting-buildout-travels`.

### Verify each commit
`node tools/verify/sweep.mjs both` → 222 routes, 0 console errors, both themes.
Every commit this session passed 222/222.

---

## 🆕 SESSION — 2026-07-21 · NEW MACHINE BRING-UP + SIDEBAR TEXT FIX

**Machine move.** Owner is on a new Windows 11 box with nothing dev-related
installed. Installed via `winget` (approved): **Node** `v24.18.0` + **npm**
`11.16.0`, **Git** `2.55.0`. Chrome was already present. The verify/build harness
(`tools/verify/*.mjs`, `tools/build/build-module.mjs`) uses **only Node built-ins**
— no `npm install` needed to boot-sweep; `npm install` is only for the Tailwind CLI
(Phase 4, paused). PATH gotcha: tools installed mid-session aren't on already-open
shells — prefix commands with
`$env:Path=[Environment]::GetEnvironmentVariable("Path","Machine")+";"+[Environment]::GetEnvironmentVariable("Path","User")`,
or open a fresh terminal.

**⚠️ OPEN DECISION — this folder is NOT a git repo.** It was copied here without its
`.git` history (real history + remote are on GitHub). Until resolved, R6 "small
reviewable commits" and the standing "push context.md every session" rule can't be
honoured — edits are file-only. Options (owner call): (1) `git clone` fresh + re-apply
today's edits, (2) reconnect this folder to the remote, or (3) keep working file-only
and reconcile later. Flagged, not guessed.

**Sidebar polish — DONE (owner-directed, iterated to a reference).** The "responsive
-fit" nav (sized in `vh`, `platform/design-system/css/layout.css`) bottomed out at
tiny floors on a short window. Owner shared a reference (old `newerp` build) and asked
to match its **text size + spacing between items**, plus soft group dividers at three
marked boundaries. Final values:
- `.nav-item`  font `clamp(14.5px,1.75vh,15.5px)` · padding `clamp(7px,1vh,11px)`
- `.nav-sub`   font `clamp(13.5px,1.6vh,14.5px)` · padding `clamp(5px,0.7vh,8px)`
- `.nav` gap `clamp(2px,0.3vh,4px)`; new `.nav-divider` = soft shadow-like hairline
  that fades at the ends, theme-aware.
- Dividers are config-driven: `m()` carries `sectionEnd` (config.js), tagged on
  `tasks` / `passport-mgmt` / `analytics`; `app.js` renders a divider after a
  sectionEnd module **only when items follow** (a hidden module can't leave a
  dangling line). **Verified:** sweep 222/222, both themes + visual captures.

**Tracker reconciliation (important).** MIGRATION_STATUS/CONTEXT were STALE: they
showed only the passport-mgmt pilot, but **11 of 18 Travels modules are already
converted** (frontend/ + built view.js, committed as `feat(rebuild): …` on origin):
settings, file-management, contract-file, dashboard, analytics, reports, automation,
crm, ledgers, payroll, passport-mgmt. **Remaining legacy (7, simplest→largest):**
marketing, contract-flight, hrm, visa-processing, accounts, vendor-agent, air-ticketing.
Also: the old work folder `H:\Imran\New folder\newerp` is present on this machine at
HEAD `a3bcbde` with NO uncommitted work — everything is on origin, nothing stranded.

**DONE 2026-07-21 — marketing converted (12/18).** First rebuild of this new-machine
session: Travels **Marketing & Messaging** → `frontend/{template.html,marketing.js}`
+ built `view.js` (cddc157). Parity **8/8 pixel-identical** across all 4 tabs
(campaigns/templates/bot/send-log) both themes (4 light byte-perfect, 4 dark ≤1px AA
jitter); sweep 222/222. Method proof: marketing honours `ctx.subId`, so parity.mjs
shoots each tab via `#/travels/marketing/<tab>`.

**DONE 2026-07-21 — contract-flight converted (13/18, cd8b223).** Parity **8/8
BYTE-IDENTICAL** across schedule/day-board/category/manage-sales both themes
(charts included); sweep 222/222. (Caught + fixed a self-inflicted bug: a `->`
instead of `-->` in template.html silently commented-out the KPI fragments — the
parity harness flagged the full-content diff.) **Remaining legacy (5):** hrm,
visa-processing, accounts, vendor-agent, air-ticketing.

**Continuing the FRONTEND REBUILD** (owner: "code the frontend my way, 10× loop").
Converting the remaining legacy modules one at a time — copy/baseline the current
view.js (parity `before`) → author `frontend/{template.html,<id>.js}` (HTML5 + Tailwind
`tw-` + raw JS) → build → parity `diff` byte-identical → 10× checks → commit. NOTE:
this is a STRUCTURE-ONLY, pixel+behaviour-identical rebuild — NO feature changes (the
earlier Air-Ticketing "Travel-Profile" idea was a feature, so it's OUT of this track).

---

## 🎯 INITIATIVE (owner, 2026-07-21) — ACCOUNTS DEEP-ENHANCE vs the reference ERP

Owner directive: bring **Master Accounts** (group) and **Travels Accounts** to a
best-in-class standard by mining the other developer's mature Laravel ERP
`epal_erp_soft` for anything more advanced, then applying it (UI + frontend +
backend). Method: section → subsection, **screenshot → analyze → solve → re-check
until 100%**. Owner also wants me to occasionally REMIND what's missing + offer
suggestions.

**Reference build:** `H:\ERP\Live\epal_erp_soft-main.zip` (Laravel monolith; our
DONOR / old erp.epal.com.bd). Extract → scratchpad `ref-erp/`. Models: Account,
JournalEntry+JournalItem, Voucher+VoucherDetail, Transaction, EmployeeLedger.
Controllers incl. a huge **ReportController (~1338 lines)**. See AI memory
[[reference-erp-comparison]].

**Reference's edge (verify per section as we go):** a deep REPORTING suite with
V1+V2 of each — general_ledger, trial_balance, profit_loss, balance_sheet,
account_ledger, account_statement, account_balances, journal_entries — plus
printable vouchers (journal / party / payment-schedule).

**Current status of the two targets:** BOTH are still **legacy monolithic view.js**
(no `frontend/` sources) — Master Accounts (`group-cockpit/modules/master-accounts`)
and Travels Accounts (`travels/modules/accounts`). Travels Ledgers IS converted.

**PLAN (owner approved — do in order):**
1. **[✅ DONE 2026-07-22] Convert BOTH Accounts modules to the frontend structure**
   (`frontend/{template.html,<id>.js}` → built `view.js`), parity-first / pixel-
   identical, like hrm & contract-flight. "Make this perfectly done first."
   → **Travels Accounts** c38fad1 (14/14 parity byte-identical) + **Master
   Accounts** b9ad7ae (18/18 parity byte-identical). No feature lost: reverse-on-
   delete, out-of-balance journal guard, company switcher, VAT/AIT return,
   opening-balance posters and GL backfill migrations all preserved. Sweep 222/222,
   0 errors, both themes. Next up: step 2 (section-by-section deep-enhance).
2. Then, **section by section** (Manage Journals → Manage Accounts → Reports →
   Vouchers → …): screenshot ours, read the reference's blade+controller for that
   section, LIST what's more advanced, apply it, re-check to 100%.
3. Maintain a running **"reference-advantage list"** in `docs/TASK-QUEUE.md` as
   gaps are found (owner can ask for the list anytime).

**Session progress toward this (2026-07-21):** bank cards world-class + CMYK-muted
hues + company-wise chip badges + accountant net-change/activity content;
searchable account combobox; bank duplicate fix (verified 16/16 local); frontend
rebuild now 14/18 (added marketing, contract-flight, hrm — all parity 8/8).

**Session progress (2026-07-22):** step 1 COMPLETE — both Accounts modules on the
modular frontend (Travels c38fad1, Master b9ad7ae), byte-identical parity, pushed.
Then **Travels rebuild finished 18/18** — visa-processing (10991eb), vendor-agent
(e4f8bb9), air-ticketing (a9ffa28) all converted parity-verified & pushed. Whole
Travels company now on the modular frontend. New-machine toolchain paths +
headless git-push recipe saved to AI memory. **Step 2 (deep-enhance) UNDERWAY:**
Manage Journals gap-analysis vs the reference ERP kicked off; findings land in
`docs/TASK-QUEUE.md` as the running reference-advantage list.

---

## 📐 MIGRATION SPEC (owner, 2026-07-19) — the binding brief for the rebuild

> Owner asked to save this prompt in context. It is the authoritative statement
> of the frontend+backend rebuild. Read with `MIGRATION_BRIEF_for_Claude_Code.md`
> and the R1–R8 rules in CLAUDE.md (they still bind — pixel-identical, no
> behaviour change, incremental, verify before deleting old, ask when ambiguous).

**Goal:** rebuild/restructure the ERP into a modern, maintainable, enterprise-grade
architecture WITHOUT changing the user experience. Modular, folder-wise — each
module keeps BOTH its frontend and backend in its own dedicated folder (the
structure already in place). Convert the `view.js` screens to the new frontend
stack. Migrate **module by module**; do the **Travels module FIRST** and finish it
(tested, functionally + visually identical) before any other module.

**Frontend stack:** HTML5 · Tailwind CSS · Vanilla/raw JS. UI must stay **100%
pixel-identical** — no redesign, no change to spacing / colours / fonts / component
sizes / animations / layout / responsiveness; no elements added or removed unless
strictly required for function. Every interaction, hover, transition, modal,
dropdown, table, sidebar, nav, filter, search, form, notification, chart, card and
dashboard must behave exactly as now. A side-by-side comparison must show no 1-px
difference.

**Backend stack:** PHP 8+ · Laravel (latest stable) · MariaDB. Enterprise
architecture & best practices: MVC + Service layer + Repository pattern (where
apt) + Form Request validation + Policies/Gates + Middleware + API Resources +
Eloquent relationships + Migrations + Seeders + Factories + Route groups + config
+ env + proper error handling + logging + Events/Listeners (where beneficial) +
queue-ready + role/permission-ready. DB: foreign keys, indexes, constraints,
normalisation, Eloquent relations.

**Code quality:** clean, modular, reusable, documented, SOLID, no duplication,
meaningful names, business logic OUT of controllers/Blade — maintainable by a new
dev with zero context.

**Preserve EVERYTHING:** every page/button/modal/form/table/filter/search/dashboard/
chart/report/workflow/validation/calculation/business-rule keeps working exactly.
Only the underlying architecture improves.

**Travels module scope (first):** Dashboard, Customer Mgmt, Leads & CRM, Visa
Processing, Air Ticketing, Tour Packages, Vendor Mgmt, Supplier Mgmt, Booking Mgmt,
File Tracking, Payments, Due Collection, Invoices, Quotations, Receipts, Expenses,
Income, Reports, Employee Assignment, Task Mgmt, Notifications, Document Mgmt,
Status Tracking + all associated forms/modals/filters/tables/calcs/logic.

**Per-component method:** analyse existing → recreate FE (HTML+Tailwind+raw JS) →
build BE (Laravel clean arch) → DB schema+migrations → models+relations →
controllers/services/repos/validation → preserve every behaviour/rule → verify UI
visually identical (screenshot-diff harness) → sign off → next.

**WORKING METHOD (owner, 2026-07-19 — binding):** always start with ONE module,
ONE SECTION. Complete that section perfectly, then **cross-check it 10 times**
(pixel-diff, behaviour, data round-trip, both themes, zoom levels, console-clean,
API-vs-demo, print/export paths, edge inputs, regression sweep). Only after a
100% pass move to the next section. Update CONTEXT.md after every section.

**FRAMEWORK CLARIFICATIONS (owner, 2026-07-19, later the same day):**
- CSS/JS frameworks ARE allowed ("best framework… like Bootstrap") — **frontend
  only, NEVER for the backend**; a custom stylesheet.css alongside is fine.
  DECISION (recorded, owner accepted by continuing): stay on **Tailwind + raw
  JS** per the written spec — the repo's Phase-1 design lock already seeds a
  `tw-` prefixed config verbatim from tokens.css (theme-aware var() colors,
  preflight off, safe coexistence). Bootstrap's opinionated components would
  fight the pixel-identical rule and the standing premium non-Bootstrap look.
- **"Never do one view.js like now, without build code"** — the current
  monolithic, no-build, DOM-strings-in-JS view.js pattern is OUT for converted
  modules. Each converted module's frontend is properly structured (template
  markup + separate logic + optional module stylesheet), and a BUILD STEP is
  now permitted — dev-machine build with the OUTPUT committed (same pattern as
  tailwind.built.css; the server stays a static git-pull, no node on Hostinger).

**PILOT (in progress):** Travels › **Passport Management** (the simplest Travels
screen per the brief's "start with the simplest screen to establish the parity
workflow"; 3 sections: holders / categories / expiry). Parity harness BUILT:
`tools/verify/parity.mjs` — screenshots routes at fixed 1440×900@1x in headless
Chrome with EVERY animation seeked-to-0-and-paused (looping ambient keyframes
would otherwise differ frame-to-frame), then byte-compares before/after PNGs.
Pass bar = byte-identical. Flow:
  node tools/verify/parity.mjs shoot .parity/before <routes> both
  …convert…  → shoot .parity/after → parity.mjs diff .parity/before .parity/after
NEXT STEP: baseline-shoot the 3 passport routes, then restructure the module
frontend (template + logic + tw- utilities), diff to byte-identical, 10× checks.

**⚠️ OPEN DECISION before large-scale conversion (see chat 2026-07-19):** "pure
Tailwind + pixel-identical + module-by-module + don't touch other modules" is in
tension with the SHARED custom-CSS component system (platform/design-system +
platform/core/ui.js `el()`, `EPAL.table`, `EPAL.formModal`, `ui.modal`) that EVERY
module's view.js renders through. A per-module pure-Tailwind rewrite can't drop
that shared layer without touching all modules. Resolve the Tailwind strategy
(reuse design-system classes vs. replicate every rule as Tailwind utilities/@apply)
BEFORE mass conversion, and prove pixel-parity on ONE pilot screen first.

---

## 🚧 RESUME HERE — 2026-07-19 (late) · WRITE ENDPOINTS + LIVE UI POLISH SPRINT

Big session on top of the live deploy. Everything below is pushed + boot-swept
(222/222, both themes) + backend pieces tested against real local MySQL.

**Write endpoints (real create/update/delete → real DB), all following one
pattern** — controller `store()`/`destroy()` + one line in `api.js`'s `WRITABLE`
map + the existing `wireWrites()` bus hook, NO screen call-site touched:
- Phase A (safe master data): Customers, Suppliers, Banks, Employees, Airlines,
  Airports, Visa Categories — all live.
- Phase B (transactional): Payment Schedules done. Air Ticketing Purchases is
  **parked mid-build, UNCOMMITTED in the working tree** (TicketPurchaseController
  has store()/destroy() written but untested — finish + test before committing).
  Visa Sales write not started.
- Employees is the careful one: `users` IS the login table, so writes are narrow
  (create gets an unusable random password; role→is_super_admin escalation is
  checked against the REQUESTER's own token, never the client), and creates run
  in a DB::transaction() (testing caught a real orphaned-row bug).

**Real-data card fixes (the live UI looked "changed" — it was demo-fabricated
fields the API returned as 0/placeholder; ZERO view/CSS was touched for these):**
- Visa flags: real, from the country's ISO code. Employee Present/Absent/Leave:
  real from the `attendances` table. Employee **Hours + Overtime**: real, from
  check_in/check_out punches, 9h/day standard (overtime = beyond 9h/day). The
  employee card now shows Present·Absent·Hours·Overtime. Customer "since": real
  created_at. Discovery: the live DB is a FRESH ERP — master data present but
  almost no transactions (sales/party_invoices empty), so value/tier/revenue
  cards are legitimately near-zero and fill in as real transactions get recorded.

**Real flags, name-driven & global (`platform/core/flags.js`):**
`EPAL.flag(nameOrCodeOrEmoji)` → real flag rendered by the bundled Twemoji flag
webfont (`platform/design-system/fonts/TwemojiCountryFlags.woff2`, @font-face +
unicode-range in tokens.css). Full ISO-3166 NAME→code table + aliases (UK→gb,
USA→us, UAE→ae, Korea/Schengen…), so any country by name auto-renders, new ones
included. Chose the webfont over flag-icons (identical flags, 1×78KB file vs
~260 SVGs — respects the free/static rule).

**UI/design changes (owner-directed this session):**
- Single-line SCROLLABLE nav (reverses the old "wrap never scroll" rule — at 100%
  zoom the wrapping read as broken). `.pill-tab/.nav-row/.co-sw/.tab-underline`
  now nowrap + overflow-x + a VISIBLE thin scrollbar (so off-screen tabs stay
  findable). `.scroll-row` utility for the company switcher.
- Numbers never break: `.tbl` numeric cells + inline `.num/.mono` are
  white-space:nowrap; wide tables scroll in their `.table-wrap` instead of
  fracturing a figure ("৳300,0⏎00" bug).
- Card hover border = violet `--card-hover #7c5cff`. (Charcoal border experiments
  were REVERTED — keep card outlines the original faint `--border`.)
- Employee/Visa-Rates card grids widened to minmax(300px) so their stat grids
  render as a 2-col cross like the Sister-Concerns cards.
- card-head overflow guard: long titles shrink so the print/wa/gmail action
  icons never get clipped out of the card.
- Employee: Status edit (Active/On leave) in the edit form + Delete in the
  profile. Required-Documents cards: flag+country on line 1, "N documents"
  subtitle below.

**Bank Accounts feature (Master Accounts, mirrors the old ERP):**
- NEW "Overview" tab = default landing = dashboard of EVERY sister-concern bank
  account as clickable cards.
- Click a card → `bankAccountDetail()`: that account's ledger, newest-first,
  running Dr/Cr balance, In/Out/All + date-range (+Today) filters, Print of the
  filtered view (all/day/range/in/out) + per-row single-transaction print, CSV.
- Manage Banks per-company strip now respects the selected company scope.
- Transaction data = `bank_txns` store; empty on the live fresh system until a
  bank-transactions endpoint + real movements exist (structure done).

**DEPLOY-LAG LESSON:** the owner tests the live site, which trails each push by
the 1-min cron pull + browser cache. Several "it's broken" reports were
already-fixed things showing a cached build. Tell them to hard-refresh
(Ctrl+Shift+R) before diagnosing.

**DONE SINCE (all pushed, tested vs real MySQL, boot-swept):**
- Phase B COMPLETE — Air Ticketing Purchases + Visa Sales writes live (join
  Payment Schedules). All Phase A+B write endpoints done.
- Real **Performance Review** feature (owner chose it over a fake rating):
  module-owned `performance_reviews` table + PerformanceController
  (Schema::hasTable-guarded so it no-ops safely before the table exists) +
  `perf_reviews` in HYDRATE/WRITABLE + a Performance-tab review workflow; the
  employee rating = average of real reviews.
  **DEPLOY STEP (owner, once):** the imported DB isn't in Laravel's migrations
  ledger, so plain `php artisan migrate` fails ("table already exists"). Create
  the new table with the module path only:
  `php artisan migrate --path=../../companies/group-cockpit/modules/employees/backend/migrations --force`
- More live UI: bank Overview (company-row button) with INLINE per-account
  ledger (print/in-out/date filters), employee Directory list-view + print +
  status filter, "Cash in Sell" on every company, name-driven real flags.

**NEXT (remaining phases):**
- **Phase C — corrected ledger/COA posting logic: OWNER-REVIEW-GATED.** Do NOT
  build the posting logic by guessing — the whole project exists because the old
  books are wrong (see [[epal-bookkeeping-audit]]). The owner picks the fix order
  first. This is a design task, not a mechanical rollout.
- **Phase D — DONE.** (1) login scope: `AuthController.identity()` maps
  `company_id` → company SLUG (not the numeric id the SPA couldn't match), so a
  company user logs in and lands in THEIR company; super-admin/Group-less → group.
  (2) data isolation: new trait `App\Support\ScopesToCompany` filters every
  company-bearing controller's `index()` (Customers, Banks, Payment Schedules,
  Employees, Visa Sales, Air Purchases) to the requester's company — a company
  login no longer receives other concerns' rows; Group/super-admin unchanged.
  Verified vs real MySQL (Travels user sees only Travels; an IT user's bank is
  forced to `it`, and is 403'd from creating a visa sale). Reads AND writes are
  isolated across ALL company-bearing controllers (customers, banks, schedules,
  employees, journals, perf reviews, visa sales, air purchases). Phase D DONE.
- **Phase E** — roll out the other 4 companies' MODULE backends (Woodart, IT,
  Shop, Construction). Lower value right now: the shared master data
  (customers/employees/banks/cash) already works for all companies and the live
  DB is fresh (sparse company-specific data), so their bespoke modules would
  mostly serve empty states. Do this once real per-company transactional data
  exists, using the same proven modular read+write pattern.
See memory `epal-backend-migration` for the full phase map.

---

## 🚧 RESUME HERE — 2026-07-19 · FRONTEND SWAP + DEPLOY-RESTRUCTURE DONE, PUSHED

**Commit identity (owner directive):** every commit in this repo is authored as
**Md Imran Hossain** `<me.imran.personal@gmail.com>` (`git config user.name` set
repo-locally 2026-07-19). Don't override it per-commit.

**Push-verification rule (learned the hard way today — follow it every session):**
never trust a comparison against a previously-fetched `origin/main` ref; it can be
stale (a corrupted local git index once made "already pushed" a false positive).
**Always confirm with a live query:** `git ls-remote origin refs/heads/main`
compared byte-for-byte against `git rev-parse HEAD`, AFTER pushing, before telling
anyone it's live.

**What's done since 2026-07-16 (both commits pushed, both E2E-proven in headless
Chrome — not just curl):**

1. **Frontend swap (`4c29ec6`)** — the milestone: log in with a real password, see
   real data on the new UI.
   - `platform/data/api.js` — resolves demo-vs-real ONCE per load. Real mode needs
     EITHER an explicit `EPAL_API_BASE` (local cross-origin dev) OR a same-origin
     `/api/health` that returns the *exact* JSON marker `{"service":"epal-kernel"}`
     — a bare `200` isn't enough (a static host's SPA-fallback would also return
     200, which is exactly what would have falsely flipped the static preview site
     into "real mode" with nothing real behind it).
   - `hydrate()` fetches every backed collection in parallel straight into the
     SAME `EPAL.store` cache the whole app already reads synchronously — no
     rewrite of the 500+ existing call sites.
   - `platform/auth-rbac/login-screen.js` — the pre-boot sign-in gate (real mode
     only; demo mode never renders it).
   - `platform/core/app.js` — boot now resolves mode FIRST; demo seeding only
     runs in demo mode, never mixed with real data.
   - Local dev login: `dev@epal.local` / `dev12345` (group scope).

2. **Deploy-restructure (`bfebecb`)** — makes ONE origin serve both the SPA and
   `/api`, as the owner asked (like the old ERP — no second subdomain, no CORS).
   - **The one security decision that matters:** `platform/backend/deploy.sh`
     symlinks the SPA's static assets into `public/`, but **`platform/backend/`
     itself — which holds `.env` with the real DB password — is NEVER symlinked
     as a whole.** Only `platform/`'s individual frontend subfolders are linked
     one at a time (`backend` excluded by name). `companies/` is safe to link
     wholesale (no secrets live there). `.htaccess` is also hardened (deny
     dotfiles + stray `.php`) as defense in depth on top of that boundary.
   - `routes/web.php`: `/` now returns the real `index.html` directly via
     `response()->file(...)` — not relying on Apache's DirectoryIndex to guess
     between a symlinked `index.html` and Laravel's own `index.php`.
   - **Route caching is deliberately never run** — this app discovers module
     routes live on every request; caching would freeze the drop-a-folder
     behaviour until someone remembered to re-cache.
   - `deploy.sh` is idempotent — safe to re-run after every `git pull`.

**AWAITING THE OWNER (next concrete step):** SSH into Hostinger (same session used
for the original git-clone setup), `cd` to the repo's `platform/backend`, run
`bash deploy.sh` (creates `.env` from the example on first run — needs the real
`DB_DATABASE` / `DB_USERNAME` / `DB_PASSWORD` filled in by hand, then re-run to
finish), then repoint the `dev.epal.com.bd` subdomain's document root (one hPanel
field, same panel as the original subdomain setup) from the repo root to
`platform/backend/public`.

**Recurring local gotcha:** Laragon's MySQL does not survive between sessions —
always `mysql -u root -e "SELECT 1"` first; if refused, restart it and wait ~20s
for InnoDB init before it accepts connections. A Laravel 500 saying "connection
actively refused" on port 3306 is this, not a routing bug — check MySQL first.

**After the live deploy:** roll out the rest of Group + Travels modules (same
proven pattern — one `backend/` folder each, most already have a
`LARAVEL-BLUEPRINT.md`), then write endpoints (everything today is GET-only, and
writes MUST call the NEW ledger logic, never the old system's).

---

## 🚧 RESUME HERE — 2026-07-19 (cont'd) · GENUINE BUILD PHASE + LOGIN FIXES + FIRST WRITE ENDPOINT

**Reframe (owner, 2026-07-19):** the no-build vanilla-SPA / custom-CSS / Tailwind /
jQuery + Laravel + MySQL **stack itself is unchanged** (see MANDATORY STACK above) —
what's changing is the *mode*: earlier work was zero-build UI review; from here on
**everything gets coded for real**, module by module, frontend AND backend, no more
mockup/demo shortcuts. This section is the live backend build roadmap — update it
every session, work it top to bottom, one module at a time.

**Live-site bugs fixed today (all pushed, all boot-swept 222/222 clean):**
- `dcecae3` — a stale `EPAL_TOKEN` left the browser stuck on demo data with no
  login screen and no way out. Boot failures now render a visible on-screen
  overlay (`core/app.js` `.catch()`); the login gate shows the failure reason and
  a **"Reset session"** link that clears the token and reloads; the user menu got
  a real **Sign out** (`EPAL.api.logout()`) instead of only demo "Reset demo data".
- `943fe0b` — the user-menu popover (`#user-card`, sidebar footer) always opened
  *below* its anchor; anchored at the very bottom of the screen, that pushed it
  off-screen and made Sign out look broken ("not working" — reported live). Fixed:
  `popover()` now flips upward when there isn't room below.
- `2a8bcde` — **first WRITE endpoint, proven against real MySQL**: Customers
  (create/update/delete), see architecture note below.

**WRITE-THROUGH ARCHITECTURE (the pattern every future write endpoint follows):**
- Backend: each controller gets `store()` (upsert-by-id: an id that doesn't exist
  yet = create, ignore the client's temp id, DB assigns the real one; an id that
  exists = update in place) and `destroy($id)`. Same translation-seam shape as
  `index()` — strip the frontend id prefix (`CUS-`, etc.) to get the real DB id.
- Frontend: `platform/data/api.js` → `wireWrites()` hooks the **existing**
  `data:changed` bus event that every `db.save()`/`db.remove()` call (and the
  specific `saveXxx` helpers) already emits — see `platform/data/database.js`.
  Adding a module to write support is a **two-file change**: the controller's
  `store()`/`destroy()`, and one line in `api.js`'s `WRITABLE` map. **No call site
  anywhere in the 500+ existing screens needs to change** — same swap-seam
  discipline as the read/hydrate side. On create, the client's temp id is swapped
  for the server's real id once the response lands; on failure the optimistic
  local write is rolled back and the user is toasted.
- **Test the loop for real before trusting it**: `php artisan serve --port=8899`
  locally + curl POST/DELETE + a raw `mysql -u root modularerp -e "SELECT..."` to
  confirm the row actually changed — not just "the endpoint returned success".

**BACKEND ROADMAP — work this list top to bottom, one item at a time, commit +
push + `git ls-remote` verify after each:**

**Phase A — safe master-data writes** (mirror the Customer pattern exactly; none
of these touch the ledger, so they're safe to wire directly):
1. ~~Customers~~ — **DONE** (`2a8bcde`)
2. Suppliers (`group/master-accounts/suppliers`)
3. Banks — master fields only (name/branch/account no.); balance stays
   read-only/ledger-derived, never directly editable
4. Employees (`group/employees/directory`)
5. Airlines (`travels/air-ticketing/airlines`)
6. Airports (`travels/air-ticketing/airports`)
7. Visa Categories (`travels/visa-processing/categories`)

**Phase B — transactional writes** (money/inventory, moderate risk, no *shared*
ledger posting required yet — just get the raw record persisting correctly):
8. Payment Schedules (`group/master-accounts/schedules`)
9. Air Ticketing Purchases (`travels/air-ticketing/purchases`)
10. Visa Sales (`travels/visa-processing/sales`)

**Phase C — the big one, design BEFORE code:** Chart of Accounts writes +
corrected journal/ledger posting logic. **MUST NOT reuse the old system's posting
logic** — see the bookkeeping audit (−377% margin from 2 proven bugs: ৳5.01Cr
income never posted + salary double-booked). This is a from-scratch design task
(seller model, correct VAT to 2130, etc.), not a mechanical CRUD rollout like
Phases A/B. Do not start this until the owner has reviewed the audit's fix order.

**Phase D:** real per-company logins (today `AuthController` only distinguishes
group-vs-one-company via `company_id IS NULL` — no actual per-company user scoping
beyond that).

**Phase E:** roll out the other 4 companies' backends (Woodart, IT, Shop,
Construction) — same proven modular pattern, only after Group + Travels' write
layer (Phases A-C) is solid.

**PHASE A COMPLETE (2026-07-19, same session):** all seven modules live —
Customers (`2a8bcde`), Suppliers (`aaa3202`), Banks (`6080948`), Employees
(`c4d52b6`), Airlines + Airports (`fcdc3b5`), Visa Categories (`852a6f5`).
Every one proven against real local MySQL (row-level checks, not just a
200 response) before pushing. Real bugs the schema surfaced along the way
(all fixed, not just noted):
- Banks: `currency` NOT NULL no default (defaulted to BDT), `account_number`
  NOT NULL+UNIQUE (Cash Box needs a generated-per-row placeholder, not a
  fixed one), `type` is a 4-value enum narrower than the frontend's 5
  payment-type options (bKash/Nagad → mobile_banking, Card → digital_wallet).
- Employees (highest risk — `users` IS the login table): a create is
  wrapped in `DB::transaction()` after testing caught a real orphaned-row
  bug (profile insert failing after the user insert had already committed);
  `is_super_admin` escalation is checked against the REQUESTER's own token
  server-side, never trusting the frontend's client-side role-picker guard.
- Airports / Visa Categories: `countries.code` is NOT NULL+UNIQUE with no
  frontend field for it — both generate a code from the country name
  (find-or-create, verified NOT to duplicate on reuse).

**Phase B is next: Payment Schedules, Air Ticketing Purchases, Visa Sales**
— transactional (money/inventory) but no shared ledger posting required
yet, just get the raw record persisting correctly. Same
test-against-real-MySQL discipline as Phase A: never trust a 200 response
alone, always check the actual row.

---

## RESUME HERE — 2026-07-16 · BACKEND MIGRATION (real data + modular Laravel), historical

**Phase now:** connect the new dev UI to a **real Laravel backend + MySQL**, using
the owner's **real production data**. Scope: **GROUP + TRAVELS first** (prove, then
roll out the other 4 companies).

**MANDATORY STACK (boss's directive — honor everywhere):**
- Frontend: **HTML5 · CSS3 · Tailwind · custom CSS stylesheet · jQuery · raw JS**
  (custom CSS is now ALLOWED — the existing design system stays; jQuery is available
  for the AJAX layer; this supersedes the old "Tailwind-only, delete custom CSS" rule).
- Backend: **PHP Laravel**.  Database: **MySQL / MariaDB**.

**THE LOAD-BEARING RULE:** the OLD ERP's **accounting is wrong** ("many wrong,
bookkeeping errors — that's why we build the new one"). So we **import the DATA,
never the old accounting LOGIC.** The new system's corrected ledger is the source of
truth. Old journal entries = archive/reference, not the opening position. The old
Laravel app (`E:\Imran\epal_erp_soft-main`, monolith) is a **DONOR** (its auth, its
140 models, its real data, the 36 `backend/LARAVEL-BLUEPRINT.md` specs) — NOT run
as-is (a monolith can't do delete-a-folder).

**ARCHITECTURE (owner-approved): MODULAR, folder-wise, drop-in/drop-out — the backend
MIRRORS the frontend.** Each module folder owns BOTH sides and is deletable as a unit:
```
companies/<co>/modules/<mod>/
├─ view.js            ← frontend (exists)
├─ module.json        ← manifest (exists)
└─ backend/           ← its Laravel slice (NEW), auto-discovered by the kernel
   ├─ routes.php · <Name>Controller.php · migrations/ · bridge.map
```
Delete the folder → screen + API + tables + Group rollup all vanish; nothing else
notices. This is exactly `EPAL_GROUP_ERP_Modular_Architecture.md` §4 + the bridge in
`platform/bridge/bridge.js`. **PROVEN today** (remove a `backend/` folder →
`route:list` drops it; restore → back).

**DEPLOYMENT (owner decision): ONE subdomain `dev.epal.com.bd` serves BOTH FE + BE**
(like the old erp — one Laravel app per subdomain). The repo BECOMES a Laravel app:
docroot → `platform/backend/public`; Laravel serves the SPA shell + `/api/*`; the
modular asset folders (platform/, companies/) reachable via symlinks so delete-a-folder
survives. Same-origin → NO CORS. **Not done yet** — still deploys as the static demo.
Hosting facts: dev.epal.com.bd → `~/domains/epal.com.bd/public_html/modularerp`,
auto-deploy via Hostinger cron **`/usr/bin/git -C <path> pull`** every minute (NOT
`cd && git pull` — cron can't run the `cd` builtin). erp.epal.com.bd is the SEPARATE
live old system (own folder, own GitHub Epal-It-Solutions) — never touched.

**DATABASES:** new = `u203838805_modularerp` (Hostinger, imported; separate from the old
`u203838805_erp`). Password lives ONLY in the server `.env` — never in git, never in chat.

**LOCAL DEV (this machine has Laragon):** PHP 8.3.26, Composer 2.8, MySQL 8.4.3.
- Start MySQL: `D:/laragon/bin/mysql/mysql-8.4.3-winx64/bin/mysqld.exe --defaults-file=".../my.ini" --datadir="D:/laragon/data/mysql-8.4"` (DLL warnings are harmless).
- Real DB imported to local `modularerp`. IMPORT GOTCHA: the dump has an FK ordering
  issue (contract_flights→tickets) — import with `SET FOREIGN_KEY_CHECKS=0;` prepended
  + `mysql --force`, or it aborts ~line 61326.
- Run the API: `cd platform/backend && php artisan serve` (local test user:
  `admin@epal.com` / `epal1234` — set in LOCAL db only; production passwords untouched).

**BUILT + WORKING (local) today:**
- `platform/backend/` = Laravel 13 kernel. `ModuleServiceProvider` (app/Providers) is
  the module-loader: globs `companies/*/modules/*/backend` + `companies/*/app/backend`,
  loads each `routes.php` under `/api`, adds `migrations/`, and a runtime autoloader maps
  namespace `Epal\Modules\<CompanyStudly>\<ModuleStudly>\<Class>` → that folder (kebab).
- **Login** (`app/Http/Controllers/AuthController.php`, `routes/api.php`): Sanctum token,
  real bcrypt check, returns `{token, user{id,name,email,companyId,isSuperAdmin,scope}}`.
  `POST /api/login`, `GET /api/me`, `POST /api/logout`. (User model got `HasApiTokens`.)
- **13 module read endpoints serving REAL data**, each in its module's `backend/`
  (built via a 4-way parallel workflow, all `php -l` clean):
  group/master-accounts → accounts(263), banks(11), journals(74 w/ 156 lines nested),
  customers(14), suppliers(10), schedules(26); group/employees → directory(82);
  travels/air-ticketing → airlines(24), airports(301), purchases(3);
  travels/visa-processing → categories(25), sales(3). Controllers translate old
  snake_case tables → the frontend store shapes (mapping notes are in each controller).
  Re-verify each returns rows on resume (some counts skip soft-deleted rows).

**NOT deployed / NOT fully committed (deliberate):** `platform/backend/vendor` + `.env`
are gitignored (Laravel default). The kernel CODE + module `backend/` files ARE committed
so the work is preserved; `composer install` regenerates vendor on the server at deploy.

**NEXT (resume order):**
1. ~~Fix visa-processing/categories (returns 0 rows though table has 46)~~ — RESOLVED, was a stale mid-build observation; re-verified 2026-07-19, returns 25 correctly-shaped rows.
2. **Frontend swap** = the milestone: a login screen before boot; `platform/data/state.js`
   load-at-boot — fetch the module endpoints into the in-memory cache, map into stores
   (`coa` ← /api/group/master-accounts/accounts, etc.), so the user logs in with a real
   password and SEES real data on the new UI. Keep it ADDITIVE: if no API base configured
   (current static deploy) → behave exactly as demo; if API + token → real data.
   Swap point = `platform/core/app.js` `EPAL.db.seed()` (~line 53).
3. **Deploy-restructure**: point dev.epal.com.bd docroot at `platform/backend/public`,
   `composer install` + real `.env` on the server, symlink platform/ + companies/ into
   public/. Guide the owner through the Hostinger steps (like the git-clone was).
4. **Roll out** the rest of group + travels module `backend/` folders (blueprints exist),
   then wire `bridge.map` events (ticket.sold → group.revenue) for consolidation.
5. **Bookkeeping fixes** (see AI memory `epal-bookkeeping-audit`): the new ledger's
   posting bugs (voids destroying money, cash-as-debt, VAT, etc.) — some applied, some
   remain. These govern how the CORRECT books post going forward.

**Key new paths:** `platform/backend/` (kernel) · `platform/backend/app/Providers/ModuleServiceProvider.php` (the loader) · `companies/**/modules/**/backend/` (per-module slices) · `docs/BACKEND-ARCHITECTURE.md` (to be written once the frontend swap is proven).

---

> ✅ **DEEP CORE PASS COMPLETE (v0.3.0, 2026-07-06).** The double-entry ledger, audit
> trail, maker-checker approvals, branded document engine, intelligence layer (MD
> briefing/RFM/anomalies), action-level permissions, automation scheduler, comment
> threads, and global search are all built, hostile-inspected (17 defects found & fixed),
> and verified (boot sweep 184/0; dynamic invariants 24/24). Engine APIs: `docs/DEEP-CORE-CONTRACT.md`.
> Data model: `docs/DATA_MODEL.md`. Backend path: `docs/MIGRATION_ROADMAP.md`. See the
> CHANGELOG v0.3.0 entry for the full list.

> 🛠️ **WORKING SESSION 2026-07-11 — RESUME HERE.** Large Travels feature push,
> all committed + pushed to `imran-me/modularerp` (main tip `0093862`). Delivered:
> - **8 "Others" modules** built deep to the Vendor/Agent gold standard: Accounts,
>   HRM, CRM, Ledgers, Reports, Analytics, Automation, Settings — each is its own
>   `companies/travels/modules/<id>/{view.js, module.json, backend/LARAVEL-BLUEPRINT.md}`.
> - **Revenue-module cockpits** (Air Ticketing, Visa Processing, Contract Flight):
>   7 slim one-row drill-down KPIs + a geo map / seat-occupancy gauges + a league
>   table + a funnel/status donut; plus momentum deltas, BSP countdown, refund %.
> - **Air Ticketing parity** with the owner's legacy ERP: **Ticket Manage** (route
>   stock), **Ticket Purchase**, **Country + States** masters, **Airport** upgrade
>   (KPIs + geo), and a tabbed **Ticket Operations** (Direct Sale / Refund / Re-Issue
>   / Void / EMD). The four reference masters were merged into ONE nav item
>   "**Setup**" (tabs).
> - **House rules (global):** KPI cards are uniform ~30% smaller, ONE row everywhere
>   (`.kpi-slim` base + `.kpi-onerow`). **Tables WRAP-TO-FIT** — text/headers wrap,
>   numbers/badges/actions stay one line — so every column incl. Actions is visible
>   with **NO horizontal scrollbar** at 90–100% zoom (reversed the old nowrap+scroll
>   rule; see `base.css`). Grid overflow fix: `.app` main track `minmax(0,1fr)`.
> - **Atmosphere — the 2D airfield is the DEFAULT** (owner directive, 2026-07-29).
>   `companies/travels/app/atmosphere/travels-scene.{js,css}` — the flat SVG dusk
>   airfield — is what every user gets out of the box, and it is the version that
>   gets fixed/tuned. The 3D airport (`platform/atmosphere/ambient3d.js`, three.js:
>   runway/taxiway/tower/terminal/hangar/skyline + take-off, landing, taxi, cruise,
>   cargo, helicopter + the re-forming **fighter-jet show**) is **opt-in** from
>   **Travels ▸ Settings ▸ Background Animation** (`ui.atmos` = `2d` (default) |
>   `3d` | `off`). The default lives in one place: `atmosMode()` in `ambient3d.js`.
>   A **one-time reset** at the top of that file drops a stale stored `"3d"` once
>   per browser (flag `ui.atmosDefault2d`) — browsers that used the app while 3D
>   was the default were otherwise pinned to it forever; a 3D pick made after the
>   reset sticks normally.
>   three.js is loaded `defer` from a CDN in `index.html`; ambient3d no-ops
>   gracefully if three.js is unavailable (2D stays).
>
> **⏭️ DUE TOMORROW / caveats:**
> 1. **The 3D scene can only be tuned by LOOKING at it live** — WebGL doesn't render
>    in the headless boot-sweep, so verify on the deployed site: aircraft
>    size/colour/positions, camera framing, that craft don't merge into the pale sky.
>    Tweak `ambient3d.js` (materials `M.white`/`M.blue`, camera, per-craft path fns).
> 2. **GitHub Pages builds get CANCELLED by rapid pushes** (why the live site lagged
>    all session). Batch commits, push once, wait ~2 min. Verify live by: sidebar
>    shows "**Setup**", tables have no bottom scrollbar, background is the 2D airfield
>    (the default; the 3D airport only appears if Settings has been switched to it).
> 3. Optional upgrade: swap the procedural airliner for a real glTF (CesiumGS
>    `Cesium_Air.glb`, CC-BY, jsDelivr-verified 200+CORS) — needs a live orientation
>    check. Loader: `three@0.128.0/examples/js/loaders/GLTFLoader.js`.

---

## 1. The Vision (the owner's words, distilled)

Build the **digital operating system of an entire business group** — *Epal Group* —
not a demo, not a template, not a college project. It must feel worthy of sitting
beside SAP, Oracle, Odoo, Monday, ClickUp, Notion, Zoho.

Three non-negotiable pillars:

1. **Everything is modular.** Every sister concern, every module, every sub-feature
   can be switched on/off by the admin with **no code changes** — and the whole UI
   reacts instantly (nav, routing, search, dashboards).
2. **The group is intelligently connected.** A change in one company (a sale, a new
   customer, a finance movement) ripples to dashboards and analytics everywhere.
3. **It is used by everyone.** The owner sees a command center; employees log in to
   a self-service portal, run their Kanban task boards with phase timers, and the
   admin oversees, assigns, comments (with a glow notification), restricts and
   red-flags any task.

The look must be **premium, luxurious, artistic, corporate, timeless** — explicitly
**NOT** a generic Bootstrap dashboard.

## 2. The Companies (sister concerns)

| id | Name | Accent | Depth |
|----|------|--------|-------|
| `group` | Epal Group (command layer) | gold `#c8a24a` | aggregation of all |
| `travels` | Epal Travels & Consultancy | blue `#2f6bff` | **deepest** (visa, ticketing) |
| `woodart` | Woodart Interiors | green `#6f9c1c` | design-build |
| `it` | Epal IT Solutions | violet `#7b5cff` | software house |
| `shop` | Epal Shop | pink `#e0356e` | retail + POS |
| `construction` | Epal Construction | orange `#e2721b` | projects/BOQ |

`travels` is the reference implementation for module depth (see **Visa Processing**).

## 3. Architecture (how it actually works)

**Stack:** vanilla HTML/CSS/JS + Bootstrap *Icons* + Chart.js. **No build step.**
Persistence is `localStorage` behind one wrapper (`data/state.js`) so it can later be
swapped for a real API by changing one file.

```
index.html ─ loads design system + runtime, then kernel/app.js BOOTS everything
│
├─ assets/css/   tokens → base → layout → components → animations   (the look)
│
├─ assets/js/   grouped into LAYERS that map 1:1 to a future Laravel backend
│               (see docs/FOR-LARAVEL-DEVELOPERS.md):
│
│  kernel/   app bootstrap + shell           ⇒ routes, middleware, layout
│    config.js     THE MODULE REGISTRY (companies→modules→subs). Single source of truth.
│    eventbus.js   pub/sub — the nervous system that keeps the group in sync.
│    ui.js         DOM builder (el/frag), formatting (money/date), toast/modal/confirm.
│    charts.js     theme-aware Chart.js factory.
│    auth.js       roles, permissions, "View As", company scoping.
│    router.js     hash router (#/company/module/sub) + enable/permission gates.
│    app.js        builds rail+sidebar+topbar from the registry, then starts router.
│
│  data/     persistence + seeded data        ⇒ Models + Migrations + Seeders
│    state.js      localStorage wrapper + the module on/off "override" engine.
│    database.js   seeded mock DB + cross-company aggregators (groupSnapshot, series…).
│    seed-bd.js    deep Bangladesh-context seed for every company.
│
│  engines/  business-logic services          ⇒ app/Services (+ policies, jobs)
│    ledger.js (double-entry) · audit.js · approvals.js · documents.js · serial.js
│    intel.js · rules.js (automation) · comments.js · search.js · permissions.js
│    engines.js  (the self-registration registry)
│
│  kit/      reusable UI building blocks       ⇒ Blade components / FormRequests
│    forms.js (schema form + items repeater) · datatable.js (EPAL.table) · entity.js (CRUD factory)
│
└─ assets/js/views/   one file per screen; each self-registers into EPAL.views.
     registry.js            EPAL.view() + the generic placeholder SCAFFOLD.
     group/dashboard.js     Group Command Center.
     admin/module-manager.js  the on/off control room.
     admin/employees.js     Workforce (directory, attendance, payroll, reports…).
     tasks/board.js         Kanban + multi-phase timers + admin glow/restrict.
     travels/dashboard.js   Travels company dashboard.
     travels/visa-processing.js  the FULLY-OPERATIONAL exemplar module.
```

**Route shape:** `#/<companyId>/<moduleId>[/<subId>]`
e.g. `#/travels/visa-processing/new-application`.

**Golden rule of the router:** it resolves the most specific registered view, then
falls back to the **placeholder scaffold** — so *every* nav item is live from day one,
and any module can be "graduated" to a full custom view incrementally.

## 4. The modular engine (the core idea, precisely)

- Defaults live on the registry objects in `config.js` (`enabled: true/false`).
- The admin's toggles are stored as **overrides** in `localStorage` under
  `module-overrides`, keyed `"company"`, `"company/module"`, `"company/module/sub"`.
- `EPAL.modules.applyOverrides()` folds overrides onto the live config at boot and
  after every change; `EPAL.modules.isEnabled(...)` is the single truth-check used by
  the rail, sidebar, command palette and router gates.
- `EPAL.modules.toggle(...)` persists + emits `modules:changed` → instant re-render.
- Two nodes are hard-locked (`group/dashboard`, `group/module-manager`) so you can
  never switch off the screen you need to switch things back on.

## 5. Roles & access (auth.js)

`owner → admin → manager → accountant → hr → employee → agent`.
`EPAL.auth.can(companyId, moduleId)` is the one gate. Employees are ESS: General
Dashboard + their own Tasks + their own Profile only. Use the topbar avatar →
**"View As"** to test any role live (demo impersonation).

## 6. Design language

- **Fonts:** Inter (UI), Sora (display), JetBrains Mono (numbers — tabular).
- **Palette:** deep navy canvas, platinum text, restrained gold; per-company accent
  injected at runtime via `--accent`. Dark default + full light theme.
- **Motion:** subtle. `fadeUp` on route change, `stagger` on grids, glow pulse for
  admin-flagged tasks, live `rec-dot` for running timers. Respects reduced-motion.
- Re-skin the entire system by editing **`assets/css/tokens.css`** only.

## 7. Conventions (follow these)

- Every file starts with a banner comment explaining its role.
- Views register via `EPAL.view('company/module', { render(ctx){…}, teardown(){} })`.
- Build DOM with `EPAL.ui.el(spec, attrs, children)` (hyperscript) — no innerHTML for
  user data (use `text:` or `escapeHtml`).
- Money via `EPAL.ui.money()`, dates via `EPAL.ui.date()`, ids via `EPAL.ui.uid()`.
- All persistence through `EPAL.store` / `EPAL.db` — never touch `localStorage` raw.
- Mutations go through `EPAL.db.*` so they **emit events** (keep the group in sync).
- ⚠️ Never write a literal `*/` inside a block comment (it closes the comment). Say
  "star-slash" or reword.

## 8. Current status (as of this build)

**Fully built & operational:** the whole runtime, modular engine, premium design
system, Group Command Center, Module Control, Workforce/Employee Management (with
downloadable profile reports + payroll + CSV export), the Task Board (Kanban, phase
timers, admin comment-glow, restrict/red-flag, drag-drop), Travels Dashboard, the
**Visa Processing** module end-to-end, and the **Air Ticketing** module (Direct Sale
issue, Manage Sales ledger + detail drawer with void/re-issue/refund/pay-status,
Airlines & Airports masters, BSP/ADM reconciliation, Refund Tracker — issuing a ticket
fires `db.postSale()` so Travels + Group finance move live).

Also live: the **group command layer** (CRM, Consolidated Finance, Analytics, Reports,
Companies, Automation, Notifications, Settings) and **shared wildcard company views**
(`*/dashboard`, `*/hrm`, `*/accounts`, `*/ledgers`, `*/reports`, `*/analytics`,
`*/customers`, `*/crm`, `*/settings`) that give every sister concern real screens, plus
the runtime kit `kit/forms.js` · `kit/datatable.js` (`EPAL.table`) · `kit/entity.js`
(CRUD factory) · `data/seed-bd.js` (deep all-company seed).

**Deep Core (v0.3.0) — the operating brain, all live:** double-entry **`engines/ledger.js`**
(COA, journal, trial balance, AR/AP ageing, P&L, balance sheet; auto-posts every sale),
**`engines/audit.js`** (append-only trail → `group/activity-log`), **`engines/approvals.js`**
(maker-checker → `group/approvals`), **`engines/documents.js`** + **`engines/serial.js`**
(branded navy/gold docs + gapless serials → `group/documents`), **`engines/intel.js`**
(MD briefing → `group/briefing`, RFM, anomalies), **`engines/permissions.js`** (action-level
RBAC), **`engines/rules.js`** (automation scheduler + escalation), **`engines/comments.js`**
(@mention threads), **`engines/search.js`** (Ctrl+K data search). Deep modules: Travels
**Vendor & Agent** ledgers, **Contract Flight** seats, deepened **Air Ticketing** &
**Visa**; **Shop POS**, **Construction** BOQ→billing→retention, **Woodart**, **IT**.
Engine APIs are in `docs/DEEP-CORE-CONTRACT.md`; every store/field/relation in
`docs/DATA_MODEL.md`; backend path in `docs/MIGRATION_ROADMAP.md`.

> ⚠️ **Every new file MUST be added as a `<script>` in `index.html`** (there is no
> dynamic loader) — new core engines self-register via `EPAL.registerEngine` but still
> need the script tag. A boot sweep (Chrome headless over all ~184 routes) is the fast
> regression check — every route must render real content with no console error. There
> is also a dynamic invariant harness (ledger balance, maker≠checker, serial uniqueness,
> audit capture) used in the Deep Core hostile-inspection pass.

**Live-but-scaffolded:** a few remaining sub-features still render the placeholder
workspace — ready to graduate one file at a time.

## 9. Roadmap / next graduations (priority order)

1. Travels: Air Ticketing (Direct Sale hub — see `oldprojectmap.md` §8 for fields),
   Vendor & Agent party ledgers, CRM pipeline.
2. Group CRM (unified customer 360) + Consolidated Finance (P&L, cash, AR/AP).
3. Shop POS + Inventory; Construction Projects/BOQ; Woodart Projects/Estimates; IT
   Projects/Support.
4. Real backend: reimplement `data/state.js` + `data/database.js` against an API;
   everything else is untouched.

## 10. Reference

`oldprojectmap.md` (in repo root) maps the owner's **previous** system. It is a
**domain reference only** (realistic field lists for travel forms, RBAC ideas). The
owner disliked it because it was a monolith — do **not** copy its structure; we
deliberately rebuilt it modular, multi-file, and premium.

---

## 11. Deployment — the live host (added 2026-07-28)

Everything below was learned by deploying, not by reading code. None of it is
visible to the local harness.

### Where it runs

| | |
|---|---|
| URL | **https://dev.epal.com.bd** |
| Repo | `/home/u203838805/domains/epal.com.bd/public_html/modularerp` |
| Laravel | `platform/backend` · MariaDB 11.8.8 |

The directory sits under `domains/epal.com.bd/`, so the URL *looks* like it
should be `epal.com.bd/modularerp`. It is not — the `dev` subdomain's document
root points at that folder. Never derive the site URL from the host path.

### The database is SHARED — never run a bare `migrate`

`u203838805_modularerp` holds **a deliberate copy of the owner's live Travels
ERP** (~179 tables, ~20 MB of real business data) alongside our `wa_*` tables.
The owner's instruction: *keep them, add ours.*

`php artisan migrate` runs every pending migration, and ~20 of them collide with
that live schema — `create_acc_entries_table`, `create_party_types_table`,
`create_bank_transactions_table`, `create_personal_access_tokens_table`, payroll
and CRM all try to CREATE tables that already exist. Worse,
`add_payment_source_to_acc_entries` would die on a duplicate column, because the
live `acc_entries` **already has** `pay_acct` and `funded_by` despite Laravel
listing that migration as pending.

Migrate one module at a time instead:

```bash
php artisan migrate --force --path=../../companies/<co>/modules/<id>/backend/migrations
```

Run `php artisan db:show` BEFORE anything, and back up from hPanel → Databases →
Backups (SSH `mysqldump` fails authentication on this host).

All twelve Woodart tables migrated cleanly with zero collisions purely because
every one carries the `wa_` prefix frozen in `NAMING-AND-TERMINOLOGY.md` before
any of them existed. `projects`/`estimates` exist in the live copy; ours are
`wa_projects`/`wa_estimates`.

### Boot hydration must stay throttled

The host runs at a **load average of 45–50**. At that saturation it refuses new
MySQL connections, PDO reports `Operation not permitted`, and the `api/*`
QueryException handler in `platform/backend/bootstrap/app.php` turns that into a
**422**.

`EPAL.api.hydrate()` therefore uses a **pool of 3 with exponential backoff**
(300 ms / 900 ms / 2.7 s, three retries) — never `Promise.all` over all ~59
stores. Unthrottled it lost ~15 stores per boot, scattered at random across
woodart, travels *and* group, and every affected screen rendered an empty state
over a full table.

### The verification blind spot this exposed

Three real defects shipped past a green local suite in one evening:

1. `projects` had a migration, models and a seeder but **no controller** — data
   seeded into MySQL that no route could reach.
2. `materials/routes.php` referenced `MovementController` and
   `StockLocationController` without importing them. `routes.php` declares no
   namespace, so both resolved to the global name. PHP does not catch this and
   `php -l` passes clean; it killed `php artisan route:list` for the ENTIRE
   application and 500'd the movements endpoint.
3. Unthrottled hydration, above.

None were detectable locally. Module test suites call controllers directly and
never exercise route resolution; `tools/verify/sweep.mjs` runs in DEMO mode where
`api.js` never hydrates at all. The sweep reported 242/242 clean while the
deployed app was losing a third of its data on every boot.

Gates added: `tools/verify/routes-imports.mjs` (every `Name::class` in a
routes.php must be imported) and `tools/verify/deployed-smoke.mjs` (assert the
live API actually serves each hydrated store).

**When a deployed screen is empty, read the `[api] hydrated in …` console line
FIRST.** It reports every store's row count plus the failures, and it
distinguishes "no data on the server", "endpoint down" and "frontend bug" in one
glance. Guessing before reading it cost four wrong diagnoses.

### Two traps behind a BLANK screen (2026-07-29, Group ▸ Task Oversight)

A blank content area with a drawn breadcrumb and **no console error** is its own
diagnosis: the view ran to completion and put nothing on the mount. Two causes,
both hit at once on that screen:

1. **A view must MOUNT, never RETURN.** `router.js:111` calls `view.render(ctx)`
   and discards the result — a view is only on screen once it appends to
   `ctx.mount`. `board.js` built its "no employees on file" page and returned it,
   so the one branch written to explain an empty directory was the one branch
   that could only ever render nothing. Grep for `return page;` inside a
   `render:` before believing any empty-state exists.
2. **Demo ids do not exist in the live database.** `EPL-DEV1` (and any
   `EPL-…`/seed id) belongs to `seed-bd.js`. Falling back to one — `db.employee(x)
   || db.employee('EPL-DEV1')` — resolves in demo mode and misses on every real
   database, sending a screen with a full staff list down its empty path. Fall
   back to *the first row that actually exists*, and keep the demo id only as the
   first preference.

Both are invisible to `sweep.mjs`: it runs the demo seed, where the demo id
resolves and the branch never executes. The check that catches them is to drive
the screen against **three directory shapes** — demo seed, real-shaped data with
no demo ids, and empty — and assert the mount is non-empty in all three.
