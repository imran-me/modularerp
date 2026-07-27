# MODULE STANDARD — how every Woodart Interiors module is built

> The frozen recipe. `CONTEXT.md` (next to this file) is the living state — what
> is built, what is decided, what is next. **This file does not change per
> module; it is the shape every module must take.**
>
> Written to be handed to a Laravel developer with no prior context. If any file
> below is missing from a module, that module is not done.

---

## 1 · Folder anatomy — one module = one self-contained full stack

```
companies/woodart/modules/<id>/
│
├── module.json                  manifest — id, label, icon, subs, built:true
├── README.md                    1-page handover: what it does, how to run it
├── context.md                   this module's memory: decisions, state, open items
│
├── frontend/                    ← EDIT THESE
│   ├── template.html            the ENTIRE screen as plain HTML. No <script>. No <template>.
│   ├── api.js                   THE DATA SEAM — the only file that knows a store key or URL
│   ├── <id>.js                  behaviour only: fill data, wire events, effects
│   └── <id>.css                 optional — module-only effects/concepts (namespaced .wa-<id>-…)
│
├── view.js                      ← BUILD OUTPUT. Never hand-edit. Never review as source.
│
└── backend/                     ← REAL LARAVEL, written like a developer writes it
    ├── endpoints.md             the FROZEN API contract — routes, payloads, errors
    ├── LARAVEL-BLUEPRINT.md     entities, business rules, invariants (NO routes — they live above)
    ├── routes.php
    ├── <Entity>Controller.php   ONE controller per entity. Thin. No business logic.
    ├── Http/Requests/Store<Entity>Request.php
    ├── Http/Resources/<Entity>Resource.php
    ├── Services/<Entity>Service.php     ← the business logic lives HERE
    ├── Models/<Entity>.php
    ├── migrations/YYYY_MM_DD_HHMMSS_create_wa_<table>_table.php
    └── Database/Seeders/<Entity>Seeder.php
```

Everything a module needs is inside its folder. Delete the folder over HTTP and
the module disappears from the menus **and** from the Group's books — that
drop-in/drop-out property is the whole point of the architecture. Nothing about
this module may live in a shared `assets/` folder.

**Build step (the recurring trap):** `index.html` loads `view.js`, **not** the
frontend sources. After editing anything in `frontend/`:

```bash
node tools/build/build-module.mjs companies/woodart/modules/<id>
```

and commit the regenerated `view.js` too. A change that is not rebuilt is not live.

---

## 2 · The build language — locked (owner, 2026-07-27)

### 2.1 HTML is the skeleton — always, no exceptions

Every container, card, KPI, button, bar, tab band, page head, form and table
**structure** is written out as readable HTML in `template.html`. Opening that
file must show the whole screen, head bar to footer.

Rejected outright:
- `el()` / hyperscript JS-DOM assembly of screen structure;
- `<template data-tpl="…">` fragment-cloning as a screen's structure;
- **any `<script>` or `<template>` tag inside `template.html`.**

Repetition (0..N records) uses a `[hidden] [data-proto]` prototype element that
is itself part of the markup — see `platform/design-system/UI-CONTRACT.md` §4.

### 2.2 CSS is the styling

**Owner rule, sharpened 2026-07-27: "core build in pure proper HTML, and
styling only Tailwind CSS and JS."** That resolves as:

- **Every UTILITY is Tailwind.** Spacing, flex, width, alignment, font size,
  font weight, colour — `tw-flex-1`, `tw-font-semibold`, `tw-mt-[6px]`,
  `tw-text-ink-mute`. The legacy house utilities (`flex-1`, `fw-600`, `mt-1`,
  `text-mute`, `xs`) are **not used in new Woodart markup**.
- **COMPONENT classes stay** — `.card`, `.kpi-card`, `.btn`, `.page-head`,
  `.tab-underline`, `.badge`, `.empty-state`, `.data-row`, `.progress`, `.num`.
  These are the *universal vocabulary*, and they are the reason the nav bar and
  every card look identical in all six companies. Re-expressing them as utility
  strings inside one module would fork the look the moment `components.css`
  changes — the exact opposite of the owner's "all same everywhere" rule. This
  is the one place the two preferences meet, and the component class wins.
- **Module-only `<id>.css` last**, for effects and concepts unique to this
  module. Colours come from tokens, never hard-coded.

**⚠️ Convert by VALUE, not by name.** The house scale and Tailwind's default
scale are different: house `.mt-1` is **6px**, Tailwind's `mt-1` is **4px**.
A blind rename silently shifts pixels. Use an arbitrary value that matches the
token exactly — `tw-mt-[6px]`, `tw-text-[11px]` (`--fs-micro`) — and verify
against `platform/design-system/css/*` before you trust a mapping.

Never compose a class name in JS (`'tw-max-w-[' + w + 'px]'` is invisible to the
scanner) — switch between whole literals. A genuinely computed value is an inline
style, not a utility. After adding any new `tw-` class:

```bash
npm run tw:build && npm run verify:tw    # then commit the regenerated CSS too
```

### 2.3 JS is behaviour, motion and live data — never structure

Allowed: filling `[data-k]` / `[data-fill]` slots, wiring `[data-act]` buttons,
cloning `[data-proto]` rows, data grids, charts, computed inline styles,
animations, hover effects, feature behaviour (sort/search/pagination).

Not allowed: building a head, a tab band, a card, a KPI tile or a section.

### 2.4 Written like a professional hands it over

- The house readable IIFE style, `'use strict'`, `var` (no build, no transpile).
- A **file header block** on every file: what it is, how it works, where its data
  comes from, what the next developer needs to know.
- A **conventions LEGEND** at the top of `template.html` explaining every
  `data-*` hook it uses.
- Section banners (`/* ====== SECTION ====== */`) marking each screen.
- Comments explain **why**, not what. A rule with a reason survives refactors.
- Named helpers over inline lambdas. A developer must be able to grep a concept.

---

## 3 · `frontend/api.js` — the data seam (the most important file)

**The problem it removes:** today a Woodart screen calls `EPAL.db.col('wa_materials')`
directly. When Laravel lands, **every screen has to be edited**.

**The rule:** a screen never names a store key and never names a URL. It calls
the module's data object. Flipping the module to the backend is then a one-line
change inside **one** file.

```js
/* ============================================================================
 * WOODART · MATERIALS — the data seam.
 * ----------------------------------------------------------------------------
 * The ONLY file in this module that knows where materials come from. The screen
 * calls Materials.stock(); it neither knows nor cares whether that resolves to
 * localStorage (demo mode) or GET /api/woodart/materials/stock (API mode).
 *
 * TO PUT THIS MODULE ON LARAVEL: nothing here changes for reads — platform/
 * data/api.js hydrates `wa_materials` from the endpoint at boot, so db.col()
 * already returns real rows. What changes is WRITES: add the store to WRITABLE
 * in platform/data/api.js, and the contract in backend/endpoints.md is the
 * agreement both sides are built against.
 * ==========================================================================*/
var STORE = 'wa_materials';           // ← the one place this name appears

var Materials = {

  /** Every material, newest first. */
  stock: function () {
    return db.col(STORE).slice().sort(function (a, b) { return a.name < b.name ? -1 : 1; });
  },

  /** One material by id, or null. */
  find: function (id) {
    return db.col(STORE).filter(function (m) { return m.id === id; })[0] || null;
  },

  /** Items at or below their reorder level — the reorder queue. */
  belowReorder: function () {
    return Materials.stock().filter(function (m) { return (+m.qty || 0) <= (+m.reorder || 0); });
  },

  /** Create or update. Emits data:changed, so every open screen repaints. */
  save: function (rec) { return db.save(STORE, rec); },

  /** Soft-remove. */
  remove: function (id) { return db.remove(STORE, id); }
};
```

Rules:
- **One `STORE` constant per collection**, declared once, at the top.
- **The seam is module-private — with ONE sanctioned exception.** A module may
  expose its seam read-only as `EPAL.diag.<company><Module>` so the verification
  harness can drive the REAL code. A test that re-implements a rule proves
  nothing: it passes even when the shipped rule is wrong. `woodart/procurement`
  does this so `node tools/verify/books.mjs receipt` exercises the actual
  posting path. Nothing else goes on a global.
- Every derived query the screen needs is a **named method here**, not an inline
  `.filter()` in the screen. `belowReorder()` reads; `.filter(m => m.qty <= m.reorder)`
  scattered across four screens rots.
- Money-moving writes go through the platform kits (`EPAL.pay`, `db.postSale`,
  `EPAL.bridge.emit`) — never re-implement posting rules in a module.
- The seam is emitted **inside the module's IIFE**, before the logic, so
  `Materials` is module-private. No new globals.

---

## 4 · `backend/endpoints.md` — the frozen contract

Split out of the blueprint deliberately: **the frontend is built against this
document before any PHP exists**, and the PHP is built to satisfy it. Neither
side waits for the other, and neither side gets to change the shape unilaterally.

Required shape:

```markdown
# Woodart · Materials — API contract  (v1, frozen 2026-07-27)

Base: `/api/woodart/materials`  ·  Auth: Sanctum bearer  ·  Scope: company_id = woodart

## GET /stock
Returns every material.
200 → { "data": [ { "id":"WA-M-001", "name":"Oak Veneer 4×8", "unit":"sheet",
        "qty":42, "reorder":10, "unitCost":3400, "vendor":"Rahman Timber" } ] }

## POST /stock
Create or update (upsert by `id`).
Body   → { id?, name*, unit*, qty*, reorder, unitCost, vendor }
201/200→ { "data": { …the material… } }
422    → { "message":"…", "errors": { "name": ["…"] } }

## DELETE /stock/{id}
204 → no content.   404 → not found / not this company's.

## Invariants
- `id` is frontend-generated and stable; the server upserts on it (never duplicates).
- Quantities are integers; money is integer BDT (no floats anywhere).
- Every response row is ALREADY in the frontend shape — the controller is the
  translation seam, so hydration is a plain write with no mapping.
```

Freeze it, version it, and change it only by bumping the version and noting what
moved. `LARAVEL-BLUEPRINT.md` keeps the entities, business rules and invariants
and **stops carrying routes**.

---

## 5 · `README.md` — the handover page

One page. Written for a developer who has never seen this repo.

```markdown
# Woodart · Materials

What it does · the screens (routes) · the data it owns (stores + tables) ·
the files and what each one is for · how to build it · how to verify it ·
what it depends on (kits, engines) · what it emits to the Group bridge.
```

## 6 · `context.md` — the module's memory

The per-module equivalent of the repo's `CONTEXT.md`. Append, never rewrite.

```markdown
# Woodart · Materials — module context

## Purpose            one paragraph: why this module exists
## Decisions (locked)  dated, with the reason. Never re-litigated.
## State               FE / BE / parity / tested — what is actually done
## Data                stores owned, tables, who else reads them
## Open questions      things only the owner can answer
## Log                 date · what changed · commit
```

---

## 7 · Two commits per module — always

1. **`feat(woodart-<id>): frontend`** — `template.html` + `api.js` + `<id>.js`
   (+ `<id>.css`) + rebuilt `view.js` + `README.md` + `context.md` + registry
   entries. Verified: sweep clean both themes (+ parity byte-identical if the
   screen already existed).
2. **`feat(woodart-<id>): backend`** — `endpoints.md` + blueprint + routes,
   controller(s), service(s), models, migrations, requests, resources, seeders.
   Verified: `php -l` clean, migrated + seeded + CRUD-tested against local
   MySQL, `api.js` HYDRATE/WRITABLE wired.

Two commits, because the frontend is reviewable and deployable on its own, and
because a backend bug must never bisect into a styling change.

---

## 8 · Definition of DONE — all eight gates

| # | Gate | Command / proof |
|---|---|---|
| 1 | Registered in **three** places | `platform/core/config.js` · `companies/woodart/module.json` (`built:true`) · **the module's OWN `modules/<id>/module.json`** — see the trap below |
| 2 | Script tag added | one `<script src="companies/woodart/modules/<id>/view.js">` in `index.html` |
| 3 | Frontend is real HTML | `template.html` shows the whole screen; zero `<script>`, zero `<template>` |
| 4 | Data seam exists | no store key or URL appears anywhere outside `frontend/api.js` |
| 5 | Rebuilt | `node tools/build/build-module.mjs companies/woodart/modules/<id>` committed |
| 6 | Visual proof | `npm run verify:tw` green · new screen → sweep-clean both themes · rebuilt screen → parity byte-identical, shot back-to-back |
| 7 | Backend real + tested | migrated + seeded + CRUD-tested vs local MySQL; `php -l` clean |
| 8 | Docs + sweep + push | README · context.md · endpoints.md written; `node tools/verify/sweep.mjs both` 0 errors; company CONTEXT.md updated; pushed |

A module that fails any gate is **in progress**, not done. One module reaches
done before the next is started.

### ⚠️ THE `module.json` TRAP (cost a full debugging session on 2026-07-27)

Auto-discovery (`platform/discovery/discovery.js`) **HEAD-probes
`companies/<co>/modules/<id>/module.json`** for every module the company
manifest marks `built:true`. A 404 means "this folder was deleted" — which is
the whole drop-in/drop-out mechanism working as designed.

So a module registered `built:true` **without its own `module.json`** is treated
as deleted, and the boot sweep fails with **every route rendering empty** —
`rendered=false` across the board, with **zero console errors**, which makes it
look like a catastrophic core break rather than one missing 30-line file.

If you ever see "all routes failing, no console errors": check for a missing
per-module `module.json` first.

---

**Related:** `NAMING-AND-TERMINOLOGY.md` (identifiers, seam method names and the
glossary — every convention this file assumes) ·
`platform/design-system/UI-CONTRACT.md` (the universal look) ·
`companies/woodart/CONTEXT.md` (state + roadmap) · `CLAUDE.md` (R1–R8) ·
`docs/ADDING-A-FEATURE.md` (registration checklist) ·
`docs/FOR-LARAVEL-DEVELOPERS.md`.
