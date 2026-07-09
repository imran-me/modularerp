# Adding a feature — the folder-wise checklist (MUST follow)

> We are mid-migration (Phases 0–3 done, Phase 4 = Tailwind, paused). Every NEW
> feature must land in the modular structure so it does not regress the work.
> Rules: `CLAUDE.md` (R1–R8). Anatomy: `companies/README.md`.

## A. A new MODULE inside an existing company

Say you're adding `refunds` to Travels (`companies/travels/`, folder `travels`).

1. **Create the module folder** `companies/<company>/modules/<module-id>/`:
   - `view.js` — the screen. Self-registers exactly like the others:
     ```js
     (function (EPAL) {
       'use strict';
       EPAL.view('<company>/<module-id>', {
         title: function () { return 'My Title'; },
         render: function (ctx) { /* build DOM with EPAL.ui.el(...) */ }
       });
     })(window.EPAL);
     ```
     Write it in the SAME readable IIFE style as the existing views (the
     blueprint directive — a Laravel dev must be able to read it). Use the
     **existing design-system classes** (`.card`, `.kpi-card`, `.btn`, `.tbl`
     …), NOT hand-rolled CSS — those convert to Tailwind together in Phase 4.
   - `module.json` — the module manifest (copy a sibling's; set `key`, `company`,
     `title`, `route`, `menu` subs, `roles`, and **`built: true`**).
   - `backend/LARAVEL-BLUEPRINT.md` — the backend spec (copy a sibling's shape:
     entities, business rules, routes, controllers, models+migrations, policies,
     bridge events, engine deps).

2. **Register it in the live registry** — add the module to its company's array
   in `platform/core/config.js` (e.g. `TRAVELS_MODULES`) via the `m(id,label,
   icon,{...})` helper. This is what actually builds today's sidebar/route.

3. **Mirror it in the company manifest** — add the same module (with
   `"built": true`) to `companies/<company>/module.json` so auto-discovery knows
   it's a real folder (delete the folder later → it disappears).

4. **Load its script** — add one `<script src="companies/<company>/modules/
   <id>/view.js"></script>` to `index.html`, alongside that company's other view
   tags (order only matters relative to `registry.js` first / `app.js` last).

5. **If it records money** (a sale, an invoice, a payment):
   - add the event to `companies/<company>/bridge.map` and to the `MAPS` table in
     `platform/bridge/bridge.js`;
   - call `EPAL.bridge.emit('<company>', '<event>', { amount, ref })` when the
     action commits, so it rolls up to the Group.

6. **Verify** (never skip): headless boot sweep must stay **0 errors / 0 render
   failures**, now at 191 routes (or +N for sub-routes). Screenshot both themes.
   Commit small: one module = one reviewable commit.

## B. A new SUB-SCREEN inside a module

Add the sub to the module's `subs` in BOTH `platform/core/config.js` and the
module's `module.json`, then handle its `ctx.subId` inside that module's
`view.js` (the module view dispatches its own sub-screens — there is no separate
file per sub). Verify.

## C. A new COMPANY

1. `companies/<new>/` with: `module.json`, `bridge.map`, `app/{frontend,theme,
   atmosphere,backend}` (+ their READMEs), `modules/<id>/…` per §A.
2. Add the company to `COMPANIES` in `platform/core/config.js` (id, name, short,
   icon, accent, tagline, modules array).
3. Add its rollup events to `platform/bridge/bridge.js` `MAPS`.
4. Its emblem: add a `[data-atmos="<id>"]` motif in
   `platform/design-system/css/atmosphere.css` (optional full scene later).
5. Verify boot sweep; the new company appears in the rail; delete its folder over
   HTTP → it vanishes (discovery).

## The non-negotiables (why "100% what I want")

- **Folder-wise**: a feature's screen, manifest, and backend spec live TOGETHER
  in its module folder. Nothing new goes back into a flat `assets/` (it's gone).
- **Two registrations stay in sync**: `platform/core/config.js` (live menus) AND
  the company/module `module.json` (discovery + the Phase-3 future source). Add
  to both, or the menu and the delete-behaviour disagree.
- **No pixel/behaviour regressions** to existing screens (R1/R2). New screens use
  the design system; they get the Tailwind treatment in Phase 4 with the rest.
- **Verify before commit**: boot sweep 0 errors, both themes, small commits.
