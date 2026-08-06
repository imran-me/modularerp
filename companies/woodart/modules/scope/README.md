# Woodart · Spaces & Phases (`scope`)

The project **breakdown**: a project is divided into **spaces** (Master Bed Room ·
Kitchen · Dining Room), each space runs its own **phases** (Design → Colour →
Wood Work → Furniture), and every phase has **one person responsible** for it.

```
PROJECT  WAP-102 · Munshi Villa Duplex        ← owned by `projects`, registered there
 └ SPACE   SPC-001 · Master Bed Room          ← this module
    └ PHASE  PHS-0014 · Wood Work             ← this module
         owner  Sumaiya Akter · Production Supervisor
         code   Wood Work  (→ wa_cost_codes)
         status Active · 14 Jul → 28 Jul
```

Plan: [`companies/woodart/PROJECT-BREAKDOWN-PLAN.md`](../../PROJECT-BREAKDOWN-PLAN.md)
— this module is **slice 1 of 6**.

## The screens

| Route | Screen | Answers |
|---|---|---|
| `#/woodart/scope?p=WAP-102` | **Spaces** | What is this project divided into? A card per space: kind, area, progress, the phase strip in running order. |
| `#/woodart/scope/phases?p=WAP-102` | **Phase Board** | Where does every space stand, and who is on each phase? Click a row to assign the person, set status and dates. |
| `#/woodart/scope/load` | **Team Load** | Who is carrying what, across every project — and what nobody has picked up. Company-wide, so it has no project picker. |

The project lives in the URL as `?p=<id>`, which `platform/core/router.js` already
parses into `ctx.params` — so a broken-down project is a link you can send to site.

## The data it owns

| Store / table | Rows | Notes |
|---|---|---|
| `wa_spaces` | the project's spaces | `SPC-000` series |
| `wa_phases` | phases, **per space** | `PHS-0000` series. Re-seeded from the old project-level shape on 2026-08-06 — see `context.md` D2 |
| `wa_phase_templates` | the phase list per space kind | seeded data, not code: adding a phase type is a row |

**Reads, never writes:** `wa_projects` (owned by `projects`), `wa_cost_codes`
(the shared budget vocabulary), `employees` (owned by HRM — this module stores
an id on the phase and nothing else).

**No money.** A phase carries no amount in this slice, emits no bridge event and
posts nothing to the ledger. Materials, labour and contracted work arrive in
slice 2 as `wa_requirements`, and that is what the quotation builder and the
cost-control matrix will read.

## The files

```
frontend/template.html   the ENTIRE screen as plain HTML — three <section data-screen>
frontend/api.js          THE DATA SEAM — the only file naming a store key
frontend/scope.js        behaviour only: fill slots, clone rows, wire buttons, open forms
frontend/scope.css       one concept the shared vocabulary has no word for: the phase strip
view.js                  BUILD OUTPUT — never hand-edit
module.json              the manifest auto-discovery HEAD-probes
backend/endpoints.md     the frozen API contract the frontend is built against
backend/LARAVEL-BLUEPRINT.md   entities, rules, invariants for the PHP slice (slice 6)
```

## How to build it

```bash
node tools/build/build-module.mjs companies/woodart/modules/scope
```

`index.html` loads `view.js`, **not** the sources. A change that is not rebuilt
is not live.

## How to verify it

```bash
node tools/verify/scope.mjs          # drives the REAL seam: template → assign → derive → delete
node tools/verify/sweep.mjs both     # 257 routes, 0 console errors, both themes
node tools/verify/tailwind.mjs       # no orphan tw- classes (this module adds none)
```

`tools/verify/scope.mjs` exercises the shipped rules through
`EPAL.diag.woodartScope` rather than re-implementing them — a test that
re-implements a rule passes even when the shipped rule is wrong.

## What it depends on

`EPAL.ui` · `EPAL.table` · `EPAL.formModal` · `EPAL.charts` · `EPAL.router` ·
`EPAL.perm` · `EPAL.db` (`col` / `save` / `remove` / `employees`). No engine, no
kit beyond those, and nothing on `window` except the read-only diag handle.
