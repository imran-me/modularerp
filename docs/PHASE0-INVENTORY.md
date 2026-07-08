# PHASE 0 — Repo Inventory & Migration Ground Truth

> 2026-07-08 · produced by a 6-inspector parallel sweep + 6 adversarial verifiers
> (60 load-bearing claims spot-checked: 42 confirmed, 17 made precise, 1 corrected).
> Baseline: tag `pre-migration-baseline` = 6e1211d. Full detail below the summary.

## Executive summary — the brief's five questions answered

**1 · Stack.** Vanilla no-build ES5 SPA. Every file is an IIFE over the global
`window.EPAL`; there is no bundler and no module system, so the 64 ordered
<link>/<script> tags in index.html ARE the dependency graph (config first,
app.js last, atmosphere scenes after). Hash router `#/company/module/sub` with
enable+permission gates, view fallback chain `co/mod/sub → co/mod → */mod →
designed placeholder scaffold`. Parse-time couplings exist (ui.js captures
config.group at load; eventbus reads store namespace at load) — reordering or
lazy-loading breaks silently, not loudly.

**2 · Styling today.** 8 core stylesheets + 2 ambient-scene stylesheets + the
travels/ mini-app theme. Design tokens live in `assets/css/tokens.css` (real
palette: accent #1A43BF, abyss #00072D … light+dark via [data-theme]). Hard
facts for a Tailwind conversion: ~92 color-mix() expressions blended with a
RUNTIME-injected --accent (router sets it per company); 41 pseudo-elements with
generated content; attribute-selector theming ([data-theme],[data-co],
[data-atmos]); 24 keyframes + SMIL in the scenes; class names are generated in
JS (el() hyperscript + runtime string concatenation), so conversion edits JS
strings and content-scanning must cover assets/js/**. Base.css defines
utilities whose NAMES collide with Tailwind but with different values
(.gap-2=12px vs 0.5rem). Two booby traps that are part of current pixels and
must be preserved as-is: deepcore.css silently overrides --epal-navy to
#1B2A4A app-wide, and deepcore uses var(--panel)/var(--line) that are never
defined (compute to initial values). The travels/ mini-app already runs
Tailwind Play CDN with an inline config that mixes stale + current brand hexes.

**3 · Current structure.** Registry-driven, not folder-driven: config.js
declares 6 companies / 97 modules / subs; views self-register string keys
decoupled from file paths (46 of 97 modules are served by shared */mod
wildcards; ~20 are scaffold-only via the designed placeholder; some files
register multiple keys, e.g. tasks/board.js → group/tasks AND */tasks with
different behaviour). Sub-routes have no registry tier — each module view
dispatches its own subs internally. The atmosphere scenes already demonstrate
per-vertical decoupling (data-atmos + MutationObserver, copy-a-pair recipe).

**4 · How group totals are computed today (bridge-critical).** There are TWO
non-reconciling finance books, both seeded deterministically: (a) the
`financials` store feeds the Command Center KPIs and P&L (db.series/
groupSnapshot), (b) `gl_entries` (double-entry ledger) feeds trial balance +
consolidation, seeded from a different population (sales + synthetic expenses).
Numbers are load-bearing-deterministic: fixed-seed PRNGs (mulberry32(20260702))
and FROZEN clocks (2026-07-05 hardcoded independently in serial, ledger, rules,
intel). Asymmetries that are part of today's truth: KPI-hero revenue sums ALL
rows while groupSnapshot/consolidation filter ENABLED companies only; postSale
rolls into the company's LATEST financials row (2026-06), not the calendar
month; seeded sales are already inside financials (must never re-roll); ledger
auto-post idempotency hangs on GL-S<id> refs; intercompany elimination needs
both legs in ONE store; customers are a cross-company graph keyed by name.
**Conclusion: the bridge must MIGRATE the exact stores and reproduce these
exact read-paths — never re-derive, re-seed, or "fix" them.**

**5 · Build tooling.** None — no package.json, no node_modules, no .github/.
Served by GitHub Pages branch-deploy from main; root .nojekyll is load-bearing;
file:// operation is documented and currently true (the app performs ZERO
runtime fetches — any fetch-based discovery would be its first and would break
file://). No .gitignore/.gitattributes (CRLF noise hazard for mass moves —
fix before Phase 2). The travels/ mini-app is a fully self-contained folder
(relocates as a unit) with its own localStorage world.

## The three decisions that gate the phases (owner call)

1. **Tailwind mechanism (Phase 1):** recommended = local Tailwind CLI run at
   dev time with the BUILT css committed (Pages stays free/static; no runtime
   JIT flash; no CDN dependency) + .gitignore added first. Alternative: Play
   CDN at runtime (zero tooling, but ~350KB runtime compiler, FOUC risk, CDN
   dependency).
2. **Auto-discovery mechanism (Phase 3):** recommended = one script-tag per
   company folder (self-registering company.js; folder deleted → tag 404s
   gracefully; preserves file:// and zero-fetch). Alternative: module.json
   fetch-probe (cleaner manifests, but first-ever fetch + breaks file://).
3. **Irreducible CSS exemption (Phase 4):** scenes (24 keyframes/SMIL/masks),
   attribute-theming and runtime-accent color-mix cannot be utilities;
   recommended = they move INTO their owning company/platform folders and stay
   as scoped CSS files; everything expressible as utilities converts.

---

# Full inspector reports



<!-- ======================================================= -->

# Stack & Runtime Wiring — Epal Group ERP (vanilla no-build SPA)

## 1) Boot sequence and why `<script>` order in index.html IS the dependency graph

There is no bundler and no module system — every file is an IIFE that attaches onto the shared global via `(window.EPAL = window.EPAL || {})` (e.g. `assets/js/kernel/config.js:293`, `router.js:178`). Several files read `EPAL.*` **at parse time**, so tag order is the only dependency resolution mechanism. index.html says this explicitly: "LOAD ORDER MATTERS … config first, then the layers in dependency order, views next, app.js LAST" (`index.html:31-32`).

**Load-order groups (all script tags at the end of `<body>`, no `defer`/`async`):**

1. **Vendor (CDN)** — Chart.js 4.4.3 UMD (`index.html:80`). Also CDN CSS in `<head>`: Google Fonts (`index.html:47`) and Bootstrap **Icons only** — full Bootstrap CSS is deliberately not loaded (`index.html:49-51`); the bespoke design-system CSS loads in token→base→layout→components→deepcore→animations→atmosphere order (`index.html:54-63`).
2. **Core runtime** (`index.html:82-110`), in order: `kernel/config.js` (84) — must be first because `ui.js` captures `EPAL.config.group` at load time for currency/locale (`ui.js:37`, comment at `index.html:83`); `data/state.js` (85) — defines `EPAL.store` + `EPAL.modules`; `kernel/eventbus.js` (86) — reads `EPAL.store.namespace` in its load-time `storage` listener (`eventbus.js:68`); `kernel/ui.js` (87); `kernel/charts.js` (88); `engines/engines.js` (90) — the engine registry must precede any `registerEngine` caller (`engines.js:26-27`); `data/database.js` (91); `data/seed-bd.js` (93); the nine Deep-Core engines serial→ledger→audit→approvals→rules→documents→intel→comments→search (95-103) — registration order IS seed/boot execution order (`engines.js:17-18`); UI kit `forms/datatable/entity` (105-107); `kernel/auth.js` (108); `engines/permissions.js` (109); `kernel/router.js` (110).
3. **Views (self-registering)** (`index.html:112-149`): `views/registry.js` first — it defines `EPAL.views`, the `EPAL.view()` registration helper and the `__placeholder__` scaffold (`registry.js:21-24, 47`); then the shared wildcard factories `shared/company-dashboard.js` + `shared/company-modules.js` (117-118); then group views (120-133), admin/tasks (135-137), Travels-specific views which "override the shared wildcards" (138-144), and per-concern deep modules shop/construction/woodart/it (146-149).
4. **Boot** — `kernel/app.js` "must be LAST" (`index.html:151-153`); then the two ambient-scene scripts `assets/atmosphere/travels-scene.js` / `interior-scene.js` (155-156).

**Boot itself** (`app.js:52-74`, auto-invoked at `app.js:472-474` — on `DOMContentLoaded` if still parsing, else immediately):
1. `EPAL.db.seed()` — idempotent `seedOnce` of all stores (`database.js:406-428`), which chains `EPAL.seedBD()` (`database.js:424`) and `EPAL.seedEngines()` (`database.js:427`).
2. `EPAL.modules.applyOverrides()` — folds persisted on/off flags onto the in-memory config (`app.js:54`, impl `state.js:148-162`).
3. `applyTheme()` — reads `ui.theme` from store, stamps `data-theme` on `<html>` (`app.js:77-79`).
4. `renderShell()` — builds rail + sidebar + topbar + `#view` mount into `#app` (`app.js:90-101`).
5. `bindGlobal()` — Ctrl/Cmd+K palette hotkey (`app.js:440-444`).
6. `EPAL.router.mount = $('#view')` (`app.js:58`).
7. Subscribe `route:changed` **before** `router.start()` so the first render's emit is caught (comment `app.js:59-62`), then `EPAL.router.start()` (`app.js:63`).
8. `EPAL.bootEngines()` **after** the router so engine boot hooks run against a live view (`app.js:64`, rule at `app.js:19-21`).
9. Reactive subscriptions: `modules:changed → refreshNav`, `auth:changed → renderShell + router.render`, `notify → toast` (`app.js:66-71`); finally the `#boot-splash` div (`index.html:68`) is removed (`app.js:73`).

## 2) Hash router

- **Route pattern:** `#/<companyId>/<moduleId>[/<subId>][?k=v&…]`. `parse()` strips `#/`, splits on `/`, parses the query into `params`, and **defaults to `companyId:'group'`, `moduleId:'dashboard'`, `subId:null`** (`router.js:48-57`).
- **Navigation:** `navigate(route, params?)` sets `location.hash`; if the hash is already identical it calls `render()` directly (`router.js:59-63`). `start()` attaches a `hashchange → render` listener, sets `#/group/dashboard` if no hash, and does the first render (`router.js:123-128`).
- **Mount:** `Router.mount` is a plain property, `null` until app.js assigns `$('#view')` (`router.js:46`, `app.js:58`). `render()` no-ops if mount is unset (`router.js:77`).
- **Teardown:** on every render, the previous view's optional `teardown()` is called inside try/catch, `current` is cleared, `EPAL.charts.destroyAll()` destroys every tracked Chart.js instance (mandatory — canvas reuse leaks, `charts.js:14-16, 89`), and scroll resets (`router.js:79-83`).
- **Gates (in order, before any view renders):** unknown company → redirect `group/dashboard` (`router.js:86`); unknown module on a known company → in-place premium 404 (`router.js:90`, `render404` at 132-145); **Gate 1 enabled?** — company off / module off / sub off → `renderState()` "switched off" screens (`router.js:97-99`, states at 148-174, with an admin-only "Open Module Control" CTA at 166-168); **Gate 2 permission?** — `EPAL.auth.can(companyId, moduleId)` else "Access restricted" (`router.js:102`).
- **View resolution, first hit wins:** `views['co/mod/sub']` → `views['co/mod']` → `views['*/mod']` (wildcard shared by every company) → `null`, then the caller falls back to `views['__placeholder__']` (`router.js:65-71, 105`). Note the sub-route level has **no** `*/mod/sub` wildcard tier.
- **Render:** clears mount, stamps `data-route`, sets the page-level `--accent` CSS var to the company accent (`router.js:106-108`), calls `view.render(ctx)` in try/catch — a throwing view produces an inline error panel, never a blank page (`router.js:110-117`). `ctx = { mount, companyId, moduleId, subId, company, module, sub, params, router }` (`router.js:91-94`); view shape is `{ title(ctx)?, render(ctx), teardown()? }` (`router.js:31-32`).
- **Events:** after render it emits **`route:changed`** with the full ctx (`router.js:119`) and sets `document.title` (`router.js:120`). The **only** bus consumer of `route:changed` is `App.onRoute` (`app.js:62`), which: refreshes the sidebar when the company changed, re-highlights nav + breadcrumb, **stamps `data-atmos`/`data-module` attributes on `#view`** (`app.js:198-201`), toggles the rail active state, closes the mobile sidebar, refreshes the notification dot (`app.js:189-206`). The ambient scenes do NOT listen to the bus — each watches that `data-atmos` attribute with a `MutationObserver` and toggles its `.on` class (`travels-scene.js:295-297`, `interior-scene.js:334-342`, `atmosphere/README.md:19-24`).

## 3) config.js registry → how menus are built

- `EPAL.config` is a **pure declarative in-memory tree**: `companies[]` → each `{ id, name, short, type:'group'|'company', enabled, icon, accent, tagline, modules[] }` (`config.js:235-259`); modules are built by the `m(id,label,icon,opts)` helper giving `{ id, label, icon, desc, enabled (default true), admin, badge, roles, subs[] }` (`config.js:44-62`); subs may be declared as bare strings or `[id,label,icon,desc,enabled]` tuples (`config.js:56-59`). Six companies: group, travels, woodart, it, shop, construction; module arrays at `config.js:71-96` (group), 102-134 (travels), 139-158 (woodart), 163-182 (it), 187-205 (shop), 210-229 (construction). Lookups: `config.company(id)` / `config.module(co,mod)` (`config.js:278-282`); group meta incl. `currency:'BDT'`, `fiscalYearStart:7` (`config.js:265-274`). Route = the id path `#/<companyId>/<moduleId>[/<subId>]` — ids are the stable primary keys (`config.js:10, 20`).
- **Rail (company switcher):** `App.buildRail()` iterates `EPAL.config.companies`, skipping companies that fail `EPAL.modules.isEnabled(co.id)` (group exempt) or `EPAL.auth.canCompany(co.id)` (`app.js:109-120`).
- **Sidebar (module menu):** `App.refreshNav()` reads the active company from config, rebuilds `#sidebar-head`, then filters `co.modules` by `EPAL.modules.isEnabled(co.id, mm.id) && EPAL.auth.can(co.id, mm.id)` and renders each via `App.buildNavItem()` (`app.js:208-228`). `buildNavItem` filters subs by `isEnabled` again and builds a single-open accordion group with `href:'#/' + co.id + '/' + mm.id [+ '/' + s.id]'` links (`app.js:240-293`); no open-state is persisted (`app.js:230-235`).
- **Command palette** is generated from the same config with the same two filters (`app.js:384-396`).
- Adding a node to config makes its nav item + route live immediately, with the placeholder rendering until a real view exists (`config.js:8-10`).

## 4) Module enable/disable

- The mechanism lives in `state.js` as `EPAL.modules`: overrides are persisted in **localStorage under `epal.v1.module-overrides`** as a flat map `{ "co":bool, "co/mod":bool, "co/mod/sub":bool }`; a missing key means "use the config default" (`state.js:13-16, 106-115`).
- `isEnabled(co[,mod[,sub]])` checks the override map first, else the node's `enabled !== false`; **a node missing from config resolves to DISABLED** (`state.js:124-134`, rule at 28-29).
- `toggle(co,mod,sub,val)` writes the flag, calls `applyOverrides()`, and emits `modules:changed {key,enabled}` (`state.js:137-144`); `applyOverrides()` folds the map back onto the live `EPAL.config` tree at boot and after each toggle (`state.js:148-162`, called at `app.js:54`).
- The UI is the admin **Module Control** view registered at `group/module-manager` (`views/admin/module-manager.js:20`): per-company master switches and per-module/per-sub rows call `EPAL.modules.toggle` (`module-manager.js:114-120`), "Reset to defaults" writes an empty map (`module-manager.js:29-35`), and `LOCKED = { 'group/dashboard', 'group/module-manager' }` prevents locking yourself out (`module-manager.js:17-18`). Consumers react instantly: `modules:changed → App.refreshNav` (`app.js:66`) and the router gates re-check `isEnabled` on every render (`router.js:97-99`).

## 5) Auth / roles gating

- `EPAL.auth` (`kernel/auth.js`): the current user is an **employee record** from `EPAL.db`, id persisted in localStorage `auth.currentUserId`, defaulting to owner `'EPL-0001'` (`auth.js:56-63`). Role ladder: owner > admin > manager > accountant > hr > employee > agent (`auth.js:16`).
- `canCompany(id)` — rail visibility: admins see all; everyone sees `'group'`; non-admins are scoped to their `homeCompany` (`auth.js:90-95`).
- `can(companyId, moduleId)` — "THE gate used by router + nav + palette" (`auth.js:32`): owner/admin bypass (`auth.js:100`); explicit per-employee grants `'co/mod'` or `'co/*'` win over role defaults (`auth.js:103-105`); on the group layer non-admins get only `dashboard`/`notifications`, with `GROUP_ADMIN_ONLY = ['module-manager','settings','employees','tasks','automation']` hard-denied (`auth.js:50, 110-113`); non-admins can't cross out of `homeCompany` (`auth.js:116-117`); then per-role module whitelists (manager = all but settings; accountant/hr/agent lists; plain employee = ESS `['dashboard','tasks']`) (`auth.js:119-125`, `auth.js:48`).
- Enforcement points: router Gate 2 (`router.js:102` → 'denied' state naming the role, `router.js:157-158`), sidebar filter (`app.js:223`), rail (`app.js:111`), palette (`app.js:387-392`), and `gotoCompany` picks the first enabled+permitted module (`app.js:182-186`).
- `viewAs(roleKey)` is demo impersonation — swaps the user and stamps a role in memory, emits `auth:changed` (`auth.js:141-159`), which triggers a full shell rebuild + re-render (`app.js:67`). Some views also self-guard, e.g. module-manager blanks the mount for non-admins (`module-manager.js:22`).
- A second, action-level layer `EPAL.perm.can(co, mod, action)` sits on top for view/create/edit/delete/export/approve — advisory and fail-open except delete/approve which are hard-denied without a grant (`permissions.js:4-9, 19-26, 53-55`); it does not gate routing.

## 6) Globals other than EPAL

- **`window.EPAL`** — the sole app global; every file is an IIFE over `window.EPAL = window.EPAL || {}` (e.g. `app.js:476`, `router.js:178`).
- **`window.Chart`** — Chart.js 4.4.3 from CDN (`index.html:80`), consumed via `window.Chart` inside `charts.js` (`charts.js:46-47`).
- Nothing else: a regex sweep for `window.<name> =` assignments across `assets/` returns no matches beyond EPAL, and the two atmosphere scripts are anonymous IIFEs exporting nothing (`travels-scene.js:42`). Side-channel state outside EPAL: localStorage keys under the `epal.v1.` namespace (`state.js:54`), the `data-theme` attribute on `<html>` (`index.html:2`, `app.js:79`), and `data-atmos`/`data-module`/`data-route`/`--accent` stamped on `#view`.

## 7) What breaks if a company's view files were not loaded

Nothing user-visible breaks — the system is designed for exactly this:

- The router resolves per specificity `co/mod/sub` → `co/mod` → `*/mod` → placeholder (`router.js:65-71, 105`). If e.g. all `views/travels/*.js` tags were removed, `travels/dashboard` would fall through to the shared wildcard `*/dashboard` registered by `views/shared/company-dashboard.js:45` (a full generic KPI dashboard — this is already how Woodart/IT/Shop/Construction dashboards render, `company-dashboard.js:4-8`); `hrm/accounts/ledgers/reports/analytics/customers/clients/crm/settings/tasks` fall to the `*/…` wildcards in `views/shared/company-modules.js:62-1111` and `views/tasks/board.js:628`.
- Modules with no wildcard (e.g. `travels/visa-processing`) fall to `EPAL.views['__placeholder__']` (`registry.js:47-95`) — not a "coming soon" page but a live scaffold: page head, a "Live module scaffold" banner, enabled sub-module entry cards, or a generic KPI+empty-table workspace (`registry.js:9-14, 70-93, 109-134`). Routing, gates and toggles all remain active.
- Registration is purely additive at parse time: each view file calls `EPAL.view(key, def)` which just does `EPAL.views[key] = def` (`registry.js:24`); a missing file simply leaves keys unset — no import errors, no 404 route. The router 404 only triggers for a module id absent from **config**, not for a missing view file (`router.js:88-90`).
- Only if `views/registry.js` itself were missing would things degrade: `resolve()` guards with `EPAL.views || {}` (`router.js:66`) so `view` becomes `undefined`, and `view.render(ctx)` throws inside the try/catch, yielding the inline "Something broke rendering this view" panel (`router.js:110-117`) — still not a blank page. (Views loaded before registry.js would also crash at parse time since `EPAL.view` wouldn't exist yet — order group 3 in index.html:112-114 prevents this.)

### Risks flagged (Stack & Runtime)

- Parse-time coupling is invisible: ui.js captures EPAL.config.group at load time (ui.js:37) and eventbus.js reads EPAL.store.namespace at load time (eventbus.js:68) — any migration that reorders or lazy-loads these files silently breaks currency formatting and cross-tab sync rather than erroring.
- route:changed has exactly one subscriber (App.onRoute) but the atmosphere scenes depend on a side effect of it (the data-atmos attribute watched via MutationObserver, travels-scene.js:295-297); a migration that reproduces the router but not the attribute-stamping loses the ambient scenes with no error.
- Enable/disable state is dual-written: overrides live in localStorage AND are mutated onto the in-memory config tree via applyOverrides (state.js:148-162), so config.companies[].enabled is not the declared default after boot — a migration that treats config.js as immutable truth will mis-render toggles; also isEnabled treats missing config nodes as disabled (state.js:133).
- Router sub-route resolution has no '*/mod/sub' wildcard tier (router.js:65-71) — sub-views resolve only exact 'co/mod/sub' or fall through to the module view/placeholder; replicating resolution order wrongly changes which screen renders for dozens of routes.
- auth.can defaults are permissive in specific spots (canCompany returns true for users with no homeCompany, auth.js:94; manager = everything except settings, auth.js:119) and viewAs mutates role only in memory (auth.js:146) — porting to a real backend must not copy these demo-oriented semantics literally; EPAL.perm additionally FAILS OPEN by design (permissions.js:19-21).
- Chart.js teardown contract (charts.destroyAll on every route render, router.js:82) and view teardown() are mandatory to avoid canvas leaks; a migration to another chart layer must preserve an equivalent lifecycle.
- All persistence is namespaced localStorage 'epal.v1.' including auth.currentUserId and module-overrides (state.js:54, auth.js:45-46) — schema-version bump or key rename invalidates existing demo data; store.nuke wipes by prefix (state.js:98-101).
- CDN dependencies (Google Fonts, Bootstrap Icons, Chart.js — index.html:45-51,80) mean pixel parity depends on exact versions (bootstrap-icons@1.11.3, chart.js@4.4.3); full Bootstrap CSS must NOT be introduced or it clobbers the bespoke .btn/.card/.nav design system (index.html:49-50).


<!-- ======================================================= -->

# EPAL Group ERP — Styling Inventory (for Tailwind pixel-parity migration)

Repo: `E:\Imran\New folder\newerp`. Design system = 8 core stylesheets + 2 scene stylesheets + 1 Tailwind-companion theme in the separate `travels/` mini-app. Load order is declared in `index.html:53-63` (tokens → base → layout → components → deepcore → animations → atmosphere → travels-scene → interior-scene) and **order matters** (see Risk #1).

---

## (1) Per-file roles and Tailwind-hostile features

| File | Lines | color-mix | @keyframes | ::before/::after | backdrop-filter | mask | [data-*] selectors |
|---|---|---|---|---|---|---|---|
| assets/css/tokens.css | 137 | 6 | 0 | 0 | 0 | 0 | 9 |
| assets/css/base.css | 154 | 5 | 0 | 5 | 0 | 0 | 1 |
| assets/css/layout.css | 181 | 12 | 0 | 3 | 1 | 0 | 0 |
| assets/css/components.css | 338 | 21 | 1 | 11 | 2 | 0 | 0 |
| assets/css/deepcore.css | 176 | 8 | 0 | 1 | 0 | 0 | 0 |
| assets/css/animations.css | 47 | 0 | 9 | 3 | 0 | 0 | 0 |
| assets/css/atmosphere.css | 107 | 1 | 0 | 11 | 0 | 1 | 15 |
| assets/css/elevation.css | 100 | 1 | 0 | 2 | 0 | 0 | 0 |
| assets/atmosphere/travels-scene.css | 230 | 29 | 11 | 2 | 0 | 0 | 5 |
| assets/atmosphere/interior-scene.css | 208 | 9 | 13 | 2 | 0 | 0 | 2 |
| travels/assets/theme.css | 88 | 0 | 1 | 1 | 1 | 0 | 0 |
| **Total** | **1766** | **92** | **35** | **41** | **4** | **1** | **32** |

**tokens.css (137)** — single source of truth for all design tokens; two theme blocks driven by `[data-theme]` on `<html>` (tokens.css:63, 98) plus `[data-co="…"]` accent helper classes (tokens.css:132-137). Hardest: `color-mix()` tokens that blend the *runtime* `--accent` (`--border-accent: color-mix(in srgb, var(--accent) 55%, transparent)` tokens.css:73; `--glow` tokens.css:87), `color-scheme: dark/light` (tokens.css:94, 128).

**base.css (154)** — reset + primitives (.btn family, .input/.select/.switch, .tbl, .badge/.chip, utility classes). Hardest: `.btn` uses a local custom prop `--btn-bg` overridden per variant with gradients (base.css:42, 52-58); `.select` chevron is a data-URI SVG background (base.css:91); `.switch .track::before` knob (base.css:99-102); `::-webkit-scrollbar*` styling (base.css:33-35); `::selection` with color-mix (base.css:26); `.badge.dot::before` (base.css:123). **Name-collision trap**: it defines its own `.flex`, `.grid`, `.hidden`, `.items-center`, `.justify-between`, `.gap-1..4` (6/12/18/24px — NOT Tailwind's scale), `.mt-1..4`, `.uppercase`, `.truncate` (base.css:141-149).

**layout.css (181)** — app shell: `.app` 3-column grid (`--rail-w`/`--sidebar-w`), rail, sidebar, topbar, content scroll region, responsive collapse. Hardest: `.app` background = 3 stacked radial-gradients built from color-mix (layout.css:12-16); `.rail-co::before` animated active bar (layout.css:43-46); `.rail-tip` hover tooltip (layout.css:52-58); `.nav-item.active::before` (layout.css:90); animated accordion via `grid-template-rows: 0fr→1fr` (layout.css:104-105); topbar `backdrop-filter: blur(14px)` (layout.css:134); body-level state selector `body.sidebar-open .sidebar` (layout.css:170).

**components.css (338)** — composite UI: page-head, .card, .kpi-card, stat rows, .ring, kanban, phases, timeline, modals, toasts, popovers, command palette, empty/gate states, boot splash. Hardest: `.kpi-card` layered radial+linear gradient background (components.css:41-43) plus `::before` luminous top hairline gradient (components.css:51-56); `.ring` conic-gradient progress driven by element-level custom props `--p/--sz/--c` (components.css:116-118); `.kb-card.redflag::after` renders an icon-font glyph `content:'\F33A'; font-family:'bootstrap-icons'` (components.css:139); `.progress-bar.fluid::after` shimmer + `@keyframes progShimmer` (components.css:186-191); `.glass` backdrop-filter blur(20px) (components.css:31); `.modal-overlay` backdrop-filter blur(6px) (components.css:210); `.kb-col-dot` colored by JS-set `--kb` var (components.css:126); `.card-accent::before`, `.kpi-spark::before`, `.timeline::before`, `.tl-item::before`, `.boot-bar::before`.

**deepcore.css (176)** — Deep Core primitives: line-item repeater, branded print documents (`.epal-doc`), MD briefing hero, approvals inbox, audit timeline, RFM grid, comment threads, plus an `@media print` block that hides everything except `.epal-doc` via `visibility` (deepcore.css:172-176). Hardest: a **second `:root` block** re-declaring `--epal-navy:#1B2A4A`, `--epal-navy-2:#24365c`, `--epal-gold:#1A43BF`, `--epal-gold-soft:#7E9AE8` (deepcore.css:10-15) which, loading after tokens.css, overrides tokens' `--epal-navy:#051650` app-wide; `.epal-doc-watermark::after` uses `content: attr(data-wm)` for the rotated stamp (deepcore.css:95-99); it consumes `var(--panel)`, `var(--line)`, `var(--panel-2)` which are **never defined** in the main app's stylesheets (deepcore.css:22, 116, 127, 165).

**animations.css (47)** — motion language: 9 @keyframes (pulseGlow, floatY, bootSlide, fadeUp, fadeIn, popIn, shimmer, ringSpin, recPing). Hardest: route-change entrance applied to *every* content child `.content > .page, .content > * { animation: fadeUp … }` (animations.css:21); `.stagger > *:nth-child(1..8)` delay ladder (animations.css:25-28); `.rec-dot::after` ping (animations.css:42); global `prefers-reduced-motion` kill switch (animations.css:45-47).

**atmosphere.css (107)** — per-vertical watermark emblem behind the page header; the single hardest file to express in Tailwind. Mechanism: `#view::before` is masked by a custom property (`-webkit-mask: var(--atmos, none) no-repeat right -30px top -26px / 116%` atmosphere.css:51-52); each of 7 attribute-selector rules (`[data-atmos="group"]`, `[data-atmos="travels"]`, compound `[data-atmos="travels"][data-module="visa-processing"]`, construction, woodart, it, shop) sets `--atmos` to an inline `url("data:image/svg+xml,…")` (atmosphere.css:70-102); ink is `color-mix(in srgb, var(--accent) 55%, var(--text))` painted only when a vertical claims the page (atmosphere.css:55-59); dark theme opacity boost `[data-theme="dark"] #view::before { opacity:.18 }` (atmosphere.css:60). `data-atmos`/`data-module` are stamped by `app.js` `onRoute` (app.js:199-200).

**elevation.css (100)** — datatable chrome, form validation states, drill-down affordance, premium 404, POS layout, health pills, print report, deep responsive. Hardest: `.kpi-card.drill:hover .kpi-label::after { content:' →' }` (elevation.css:37); `.err-code` gradient text via `-webkit-background-clip:text; color:transparent` (elevation.css:41-42); `.health::before` glowing dot `box-shadow: 0 0 8px currentColor` (elevation.css:64); `@media print` with `* { color:#111 !important }` (elevation.css:73-81).

**assets/atmosphere/travels-scene.css (230)** — the animated dusk-airfield scene behind Travels. Effectively unconvertible: 11 @keyframes (ac-drift, bwink, cl-comet, rabbit, beacon, strobe, llight, bflash, ws-flutter, twinkle, radar-sweep); 29 color-mix; a scoped palette of ~11 custom props re-mapped for light theme under `[data-theme="light"] .ascene` (travels-scene.css:52-65); per-element animation delays from an index var `animation-delay: calc(var(--i,0) * -.37s)` (travels-scene.css:139, 145, 150); SVG presentation classes styling injected SVG (`.sil`, `.paint`, `.plane`, `.cl`, `.rabbit`, `.papi-w`… travels-scene.css:127-205); conic-gradient radar sweep + repeating-radial-gradient rings (travels-scene.css:212-223); vignette via inset box-shadow on `::after` (travels-scene.css:72-76); `.ascene.paused * { animation-play-state: paused !important }` (travels-scene.css:69); the companion `travels-scene.js` contains **6 SMIL elements** (`<animate>/<animateTransform>/<animateMotion>`). It also disables the atmosphere watermark with `[data-atmos="travels"]#view::before { display:none }` (travels-scene.css:32).

**assets/atmosphere/interior-scene.css (208)** — the scroll-built living-room scene behind Woodart. Hardest: a JS-written scroll-progress custom property `--p` (interior-scene.css:39) drives phase cross-fades via `opacity: clamp(0, calc((var(--p) - 0.55) / 0.4), 1)` (interior-scene.css:99, 111, 139, 151) and staggered furniture arrival `transform: translateY(calc((1 - clamp(0, calc((var(--p) - 0.14 - var(--d,0)*0.05)/0.28), 1)) * 30px))` (interior-scene.css:115); a fill computed as `color-mix(... calc(60% - var(--p) * 10%) ...)` (interior-scene.css:94); 13 @keyframes (d-draw, sway, breathe, mote-rise, glow, clk-swing, curtain-breathe, hp-sway, cat-breathe, tt-spin, flick, nstar-twinkle, steam-rise); SVG transform mechanics `transform-box: view-box/fill-box` with userspace origins like `transform-origin: 1004px 214px` (interior-scene.css:128, 158) and `vector-effect: non-scaling-stroke` (interior-scene.css:80); reduced-motion pins `--p:.72` (interior-scene.css:207).

**travels/assets/theme.css (88)** — already a *Tailwind companion layer* for the travels mini-app: brand tokens `--sky #2E56C4, --ocean/--brand #1A43BF, --royal #0A2472, --deep #00072D, --brandsoft #7E9AE8, --line rgba(96,165,250,.16)` (theme.css:17-25); fixed multi-radial body background (theme.css:30-39); `.glass` backdrop-filter (theme.css:45-49); `.nav-link.active::before` bar (theme.css:62-65); 1 keyframe fadeUp with `.fade-up-2/-3` delays (theme.css:84-88).

---

## (2) Design tokens — where they live + full group list with current values

Tokens live in **assets/css/tokens.css** only ("Every colour, radius, shadow, and easing lives here" tokens.css:11-12) — with one rogue exception: deepcore.css:10-15 re-declares `--epal-navy:#1B2A4A`, `--epal-navy-2:#24365c`, `--epal-gold:#1A43BF`, `--epal-gold-soft:#7E9AE8`.

**Typography** (tokens.css:17-19): `--font-sans: 'Inter','Plus Jakarta Sans',system-ui,-apple-system,'Segoe UI',sans-serif`; `--font-display: 'Sora','Plus Jakarta Sans',var(--font-sans)`; `--font-mono: 'JetBrains Mono','DM Mono',ui-monospace,'SF Mono',monospace`.

**Brand accents** (tokens.css:22-36): `--gold: #1A43BF` (NOTE: named "gold" but is the brand *blue*), `--gold-soft: #7E9AE8`; EPAL swatches `--epal-abyss:#00072D`, `--epal-navy:#051650` (overridden to `#1B2A4A` by deepcore.css:11), `--epal-deep:#0A2472`, `--epal-royal:#123499`, `--epal-accent:#1A43BF`, `--epal-soft:#7E9AE8`; per-company `--brand-travels:#2f6bff`, `--brand-woodart:#6f9c1c`, `--brand-it:#7b5cff`, `--brand-shop:#e0356e`, `--brand-construction:#e2721b` (mirrored in config.js:237-257 as company `accent`).

**Semantic status** (tokens.css:39-42): `--good:#23c17e`/`--good-soft:rgba(35,193,126,.14)`; `--warn:#f4b740`/`rgba(244,183,64,.14)`; `--bad:#f0506e`/`rgba(240,80,110,.14)`; `--info:#3b82f6`/`rgba(59,130,246,.14)`.

**Runtime accent** (tokens.css:45): `--accent: var(--gold)` — re-set per company at runtime (router.js:108).

**Radii** (tokens.css:48): `--r-xs:7px --r-sm:10px --r-md:14px --r-lg:18px --r-xl:24px --r-pill:999px`.

**Motion** (tokens.css:51-53): `--e-out: cubic-bezier(.16,.84,.44,1)`; `--e-inout: cubic-bezier(.65,.05,.36,1)`; `--t-fast:.14s --t:.24s --t-slow:.4s`.

**Layout metrics** (tokens.css:56-59): `--rail-w:68px --sidebar-w:268px --topbar-h:62px --content-max:1600px`.

**DARK theme (default)** (tokens.css:63-95): surfaces `--bg:#03071c --bg-2:#060c26 --surface:#0a1330 --surface-2:#0f1a3d --surface-3:#17234f --surface-hi:#1f2d5e`; borders `--border:rgba(142,168,240,.12) --border-strong:rgba(150,178,245,.22) --border-accent:color-mix(in srgb,var(--accent) 55%,transparent) --hairline:rgba(200,218,255,.09)`; text `--text:#eaeefb --text-dim:#9aa6c2 --text-mute:#5c6884`; shadows `--shadow-sm: 0 1px 2px rgba(0,0,0,.45)`, `--shadow: 0 1px 1px rgba(0,0,0,.4), 0 16px 36px -14px rgba(0,4,20,.66)`, `--shadow-lg: 0 2px 6px rgba(0,0,0,.5), 0 44px 84px -28px rgba(0,4,24,.78)`, `--shadow-card: 0 1px 2px rgba(0,2,14,.5), 0 6px 16px -6px rgba(0,4,24,.5), 0 20px 44px -18px rgba(0,4,24,.62)`, `--glow: 0 0 0 1px var(--border-accent), 0 10px 40px -12px color-mix(in srgb,var(--accent) 55%,transparent)`; glass `--glass:color-mix(in srgb,var(--surface) 72%,transparent) --glass-brd:rgba(255,255,255,.08) --grid-line:rgba(255,255,255,.045) --scrim:rgba(3,6,12,.66)`; `color-scheme: dark`.

**LIGHT theme** (tokens.css:98-129): `--bg:#e8edf6 --bg-2:#dde5f1 --surface:#ffffff --surface-2:#f6f8fd --surface-3:#eef2f9 --surface-hi:#e5ebf6`; `--border:rgba(26,67,191,.12) --border-strong:rgba(26,67,191,.22) --border-accent:color-mix(... 42% ...) --hairline:rgba(255,255,255,.7)`; `--text:#131a2c --text-dim:#56617c --text-mute:#8a93a9`; navy-tinted shadows `rgba(5,22,80,…)` (tokens.css:115-120); `--glass:color-mix(in srgb,#ffffff 78%,transparent) --glass-brd:rgba(16,26,48,.08) --grid-line:rgba(16,26,48,.05) --scrim:rgba(20,30,60,.35)`; `color-scheme: light`.

**Company accent helpers** (tokens.css:132-137): `[data-co="group"]{--accent:var(--gold)}` … through construction.

---

## (3) Light/dark theming end-to-end

1. `index.html:2` ships `<html lang="en" data-theme="dark">` as the pre-boot default.
2. On boot, `App.applyTheme()` reads `EPAL.store.get('ui.theme','dark')` and sets `document.documentElement.setAttribute('data-theme', t)` (app.js:77-80).
3. The rail-foot theme button (app.js:123-124) calls `toggleTheme()`: flips the attribute, persists via `EPAL.store.set('ui.theme', t)`, emits `theme:changed`, swaps the moon/sun icon (app.js:81-87).
4. Storage: `EPAL.store` prefixes all keys with `NS = 'epal.v1.'` (state.js:54), so the **actual localStorage key is `epal.v1.ui.theme`** (JSON-encoded string `"dark"`/`"light"`).
5. The Settings screen also applies `data-theme` immediately on save (settings.js:626).
6. CSS reacts via the `:root,[data-theme="dark"]` / `[data-theme="light"]` variable swap (tokens.css:63, 98); scene stylesheets re-map their scoped palettes under `[data-theme="light"] .ascene`/`.iscene` (travels-scene.css:52, interior-scene.css:49); atmosphere raises watermark opacity in dark (atmosphere.css:60). There is **no `prefers-color-scheme` detection** — dark unless stored otherwise. Orthogonally, the per-company accent is injected at runtime: `mount.style.setProperty('--accent', company.accent)` on every route (router.js:108), sidebar head (app.js:213), and rail buttons (app.js:114).

The travels/ mini-app is separate: it hard-codes `<html class="dark">` (travels/index.html:2) with no toggle.

---

## (4) CRITICAL — DOM class names come from JS, not HTML

Confirmed. `index.html`'s body contains only the boot splash and an empty `<div id="app" class="app">` (index.html:66-77); the entire shell and every screen are built in JS. The hyperscript builder `el(spec, attrs, children)` in ui.js parses `'tag.class#id'` specs — `spec.split(/(?=[.#])/)` then `classList.add` per `.part` (ui.js:45-66); it also merges a `class` attr string (ui.js:56) and `frag(html)` builds nodes from raw HTML strings (ui.js:75-79).

Examples: shell `el('aside.rail')` (app.js:105), `el('div.rail-brand', …)` (app.js:106); KPI tiles `el('div.kpi-card' + (drill ? '.drill' : ''), …)` (group/dashboard.js:237, kit/entity.js:99, group/finance.js:48, travels/visa-processing.js:612, and ~20 more view files); toasts `el('div.toast-item.toast-' + level)` (ui.js:185); modals `el('div.modal-box' + '.modal-' + size)` (ui.js:204). Class names are also *concatenated at runtime* (variant suffixes) and *toggled* (`classList.toggle('active', …)` app.js:203, `classList.add('is-group')` app.js:118, `.in`, `.gone`, `body.sidebar-open`). Icon markup arrives via HTML strings: `icon(name)` returns `'<i class="bi bi-…">'` (ui.js:157).

**Consequence for the conversion**: Tailwind class edits happen inside JS string literals across `assets/js/kernel/*`, `assets/js/kit/*`, and `assets/js/views/*` (el() specs, `class:`/`html:` attrs, frag() strings, string concatenations), and the Tailwind `content` glob must include `assets/js/**/*.js`. Dynamic concatenations (`'.toast-' + level`, `'.modal-' + size`, `'kpi-trend.' + trend.dir`) defeat static class extraction and need safelisting or refactoring.

---

## (5) Inline styles set from JS

The `el()` builder supports `style:{…}` objects → `Object.assign(node.style, v)` (ui.js:59). Categories found:

- **Custom-property injection (theming)**: `mount.style.setProperty('--accent', company.accent)` (router.js:108); `head.style.setProperty('--accent', co.accent)` (app.js:213); `style:{'--accent': co.accent}` on rail buttons (app.js:114) and cards (module-manager.js:81, employees.js:651, group/approvals.js:179); kanban column colour `style:{'--kb': STAGE_COLOR[st]}` (it/projects.js:234, 661).
- **Data-driven visuals**: avatar backgrounds `style:{background: ui.colorFor(u.name)}` (app.js:141, 347; employees.js:112, 140; comments.js:133); progress-bar widths `style:{width: prog + '%', background: col}` (it/projects.js:173, construction/projects.js:196); status-pill tint `b.style.color = col; b.style.background = col + '22'` (construction/projects.js:878, it/projects.js:950).
- **Layout/positioning**: chart canvas wrappers `style:{height:'240px', position:'relative'}` (kit/entity.js:206-211); popover fixed positioning `node.style.top/right = …px` (app.js:455-457); ad-hoc margins/paddings throughout views (it/projects.js:171-174, employees.js:78-80).
- **Visibility toggles**: `wrap.style.display = f.showIf(vals) ? '' : 'none'` (kit/forms.js:247); collapsible card bodies (module-manager.js:97-107); table sort cursor (kit/datatable.js:144).
- **Scene runtime vars**: interior-scene.js writes scroll progress `--p` onto `.iscene` (documented interior-scene.css:9, 39); inline `style="color:var(--accent,#2f6bff)"` inside HTML strings (travels/contract-flight.js:332).

---

## (6) travels/ mini-app — already Tailwind

Yes. All four pages (`travels/index.html`, `air-ticketing.html`, `flight-search.html`, `packages.html`) load the **Tailwind Play CDN** `<script src="https://cdn.tailwindcss.com"></script>` (travels/index.html:25; air-ticketing.html:18; flight-search.html:18; packages.html:16) with an identical inline config (formatted version at travels/index.html:27-39; one-liners at packages.html:17, flight-search.html:19, air-ticketing.html:20-23):

```js
tailwind.config = {
  theme: { extend: {
    colors: {
      navy: { 900:'#070b14', 800:'#0b1220', 700:'#111a2e', 600:'#1B2A4A' },
      brand: '#1A43BF', brandsoft: '#7E9AE8'
    },
    fontFamily: {
      sans: ['Inter','system-ui','sans-serif'],
      display: ['Sora','Inter','sans-serif'],
      mono: ['JetBrains Mono','ui-monospace','monospace']
    }
  } }
};
```

Markup uses real Tailwind utilities (`w-64 shrink-0 glass border-r border-white/10`, `bg-gradient-to-br from-brand to-blue-900`, arbitrary values `text-[11px]` — travels/index.html:53-69) plus the `theme.css` custom layer (.glass, .nav-link, .kpi-accent, .badge-up/-down — theme.css:45-72). `<html class="dark">` (travels/index.html:2). Stack: Tailwind Play CDN + Alpine.js 3.14.1 + Chart.js 4.4.3 + Bootstrap Icons 1.11.3 (travels/index.html:22, 25, 44-45). `travels/assets/travels.js:98` even returns Tailwind class strings from a status-pill helper.

---

## (7) Fonts

- **Main app** (index.html:47, one Google Fonts stylesheet): **Inter** 400/500/600/700 (UI, `--font-sans`), **Sora** 500/600/700/800 (display, `--font-display`), **Plus Jakarta Sans** 500/600/700 (fallback in both stacks), **JetBrains Mono** 400/500/600 (numbers/`--font-mono`), with preconnects to fonts.googleapis.com/fonts.gstatic.com (index.html:45-46). Token stacks at tokens.css:17-19 ('DM Mono' and 'SF Mono' appear as mono fallbacks but are not loaded).
- **Icon font**: Bootstrap Icons 1.11.3 via jsDelivr CDN — icons only, full Bootstrap CSS deliberately NOT loaded (index.html:49-51). Used both as `<i class="bi bi-…">` (ui.js:157) and as pseudo-element glyph `font-family:'bootstrap-icons'; content:'\F33A'` (components.css:139).
- **Travels mini-app** (travels/index.html:19-22): Inter 400-700, Sora 600-800, JetBrains Mono 500-600 (no Plus Jakarta) + the same Bootstrap Icons CDN.
- **Print documents** hard-code `'Inter', system-ui` and `'Sora', sans-serif` directly rather than via tokens (deepcore.css:41, 54, 56, 62).

### Risks flagged (Styling)

- Token shadowing: deepcore.css:10-15 silently overrides tokens.css's --epal-navy (#051650 → #1B2A4A) for the whole app due to load order (index.html:54,58); a Tailwind theme generated from tokens.css alone would render .kpi-ico gradients and .epal-doc documents with the wrong navy.
- Undefined tokens in production CSS: deepcore.css uses var(--panel)/var(--line)/var(--panel-2) that are never defined in the main app (deepcore.css:22,116,127,165) — today those borders/backgrounds silently compute to initial values; 'fixing' them during conversion would change pixels, and reproducing them requires deliberately preserving the broken fallback behavior.
- Utility-class name collisions: base.css defines .flex, .grid, .hidden, .items-center, .justify-between, .truncate, .uppercase, .gap-1..4 (6/12/18/24px) and .mt-1..4 (base.css:141-149) with values that differ from Tailwind's identically-named utilities (e.g. gap-2 = 12px vs Tailwind 0.5rem) — enabling Tailwind preflight+utilities alongside or replacing these will shift spacing everywhere unless remapped.
- 92 color-mix() usages blend the runtime-injected --accent (set via style.setProperty at router.js:108), so accent-derived colors cannot be statically tokenized in tailwind.config; they must remain CSS-variable-based (arbitrary values or a plugin), otherwise per-company theming breaks.
- Class names live in JS strings including runtime concatenations ('.toast-' + level ui.js:185, '.modal-' + size ui.js:204, 'kpi-trend.' + trend.dir dashboard.js:243) and classList toggles ('in','active','sidebar-open','gone','on','paused') — Tailwind content scanning must include assets/js/**/*.js and dynamic names need safelisting or refactoring to avoid purge losses.
- Heavy reliance on pseudo-elements with generated content (41 ::before/::after incl. content:attr(data-wm) watermark deepcore.css:95-99, icon-font glyph content:'\F33A' components.css:139, hover-appended content:' →' elevation.css:37) and attribute-selector theming ([data-theme],[data-co],[data-atmos][data-module]) — these need retained plain CSS or custom variants, not utilities.
- The ambient scenes (travels-scene.css 230 lines, interior-scene.css 208 lines: 24 keyframes, SMIL SVG animation, scroll-driven --p math, SVG transform-box/userspace origins, mask-based emblems in atmosphere.css) are practically impossible to express as Tailwind utilities and should be carried over verbatim as CSS files.
- Two @media print regimes (deepcore.css:172-176 visibility-based document isolation; elevation.css:73-81 with * { color:#111 !important }) depend on global overrides that Tailwind's layer ordering could break; print output (invoices/reports) is a business deliverable.
- Behavioral CSS coupling: JS writes inline styles and custom properties (--accent, --kb, --p, progress widths, avatar colors, popover positioning) that must survive the conversion; converting these to classes would break runtime data-driven styling.
- travels/ uses the Tailwind Play CDN with four separately duplicated inline configs (travels/index.html:27-39 vs one-liners in the other three pages) — config drift risk, and Play CDN is not production-grade; also its dark mode is hard-coded (<html class="dark">) unlike the main app's stored toggle, so unifying theming needs a strategy decision.
- The animations.css route-transition rule (.content > * { animation: fadeUp } animations.css:21) and .stagger nth-child delay ladder apply motion to arbitrary children — Tailwind's animation utilities can't reproduce the descendant/nth-child targeting without custom CSS.
- Naming trap: --gold is actually the brand blue #1A43BF (tokens.css:22) — a converter mapping 'gold' to a yellow hue, or deduplicating --gold/--epal-accent/--brand ocean (#1A43BF appears under at least 4 names), could introduce subtle regressions.


<!-- ======================================================= -->

# EPAL Group ERP — Data Layer & Group-Total Computation Inventory

## 1. Storage: namespace, stores, seeding flow

**Namespace.** Everything the main app persists goes through `EPAL.store` (a thin localStorage wrapper) with prefix `NS = 'epal.v1.'` — `assets/js/data/state.js:54`. No file may touch localStorage raw ("One door" rule, state.js:20-22). `seedOnce(key,data)` writes only if the raw key has never existed (state.js:92-95), and `nuke()` deletes only keys starting with `epal.v1.` (state.js:98-101) — so foreign namespaces (e.g. the travels mini-app) survive "Reset demo data".

**One shared DB, not per-company DBs.** All stores are flat group-wide collections; company membership is a **field on each record** (`companyId`, or `companyIds[]` for customers), never a separate storage partition:
- Core stores seeded by `database.js DB.seed()` (database.js:406-421): `financials` `[{companyId, ym:'YYYY-MM', revenue, expense}]` (12 months × 5 companies, database.js:14, 123-136), `employees`, `customers` (shared graph with `companyIds:[]`, database.js:18-19, 201-214), `leads`, `visaCats/visaApps`, `vendors`, `airlines/airports/airTickets/airRefunds/airBsp`, `notifications`, `tasks.<empId>` (per-employee key, database.js:24, 457), `activity`.
- Deep operational stores seeded by `EPAL.seedBD()` (seed-bd.js:58-359): shared `banks`, `crm_activities`, `acc_entries`, `acc_schedules`, `sales` (seed-bd.js:100-149) plus per-company prefixed stores `tv_*`, `wa_*`, `it_*`, `sh_*`, `cn_*` (seed-bd.js:22-27) — again all keyed by prefix, with `companyId` fields where relevant.
- Engine stores seeded via `EPAL.seedEngines()` (database.js:427): the ledger seeds `coa` and `gl_entries` (ledger.js:631-634), intel stamps `intel_config` only (intel.js:670-677).

**When seeding runs.** Boot order is `app.init()` → `EPAL.db.seed()` FIRST (app.js:53), which does `seedOnce` per core store, then delegates `EPAL.seedBD()` (database.js:424) and `EPAL.seedEngines()` (database.js:427; registry in engines.js:65-71). Every seeder is idempotent (`gen()` no-ops if key exists, seed-bd.js:76-80) and **deterministic**: database.js uses `mulberry32(20260702)` (database.js:102), seed-bd.js its own PRNG `a=987654321` (seed-bd.js:62-64), with a frozen demo "now" of Jun-2026 (`lastMonths` anchor `new Date(2026, 5, 1)`, database.js:108). `db.reset()` = nuke + reseed (database.js:622).

## 2. Group Command Center KPIs — exact computation

Rendered by `views/group/dashboard.js`. Two data sources: `snap = db.groupSnapshot()` and `fullSeries = db.series()` (dashboard.js:26-27). **Nothing is pre-aggregated: every group figure is summed on read from per-company `financials` rows.**

- `db.series(companyId?)` (database.js:472-483): takes all `financials` rows, filters by company only if given, buckets by `ym` into per-month `revenue/expense` sums over the fixed 12-month window; `profit[i] = r - e`. **Note: it does NOT filter by company-enabled.**
- `db.finance(companyId?, months?)` (database.js:463-469): sums `revenue`/`expense` over the filtered `financials` rows; `profit = rev-exp`, `margin = (rev-exp)/rev*100`.
- `db.groupSnapshot()` (database.js:502-522): filters config companies to `type==='company' && enabled` (database.js:504), maps each to `finance(c.id,12)` + `momRevenue` + `riskScore` + per-company employee count, then **reduces per-company revenue/profit into `tot`** (database.js:512); `margin = tot.profit/tot.revenue*100` (database.js:516); `headcount = this.employees().length` (ALL employee rows — includes the group-level owner and on-leave staff, database.js:517); `openLeads` = leads with stage in New/Contacted/Qualified/Proposal/Negotiation (database.js:519); `pipelineValue` = sum of `value` of leads in **Qualified/Proposal/Negotiation only** (database.js:520).

The KPI hero (`renderKpis`, dashboard.js:76-93) is window-driven (12M/6M/3M pills):
- **Group Revenue** = `sum(windowSeries(months).revenue)` — i.e. slice the last N entries of `db.series()` and sum (dashboard.js:33-42, 78, 80-81). Sums per-company monthly records, not a stored total.
- **Net Profit** = `sum(ws.profit)` (dashboard.js:78, 82-83).
- **Blended Margin** = `prof/rev*100` from the same window sums (dashboard.js:78, 84-87); the sparkline is per-month `profit/revenue*100`.
- **Workforce** = `ui.num(snap.headcount)` with a **hardcoded trend chip `'+3'`** and foot "active employees" though no status filter is applied (dashboard.js:88-89, database.js:517).
- **Pipeline Value** = `snap.pipelineValue`, chip = `snap.openLeads + ' open'` (dashboard.js:90-91).

Charts: Revenue Mix doughnut = `db.finance(c.id, months).revenue` per company (dashboard.js:191-199); Profit ranking = `db.finance(c.id, months).profit` (dashboard.js:201-212); trend adds a least-squares forecast overlay (dashboard.js:166-189). The Export doc uses `snap.revenue/profit/margin` — the enabled-companies-only 12M totals (dashboard.js:333-370). Company strip/risk uses `momRevenue` (last-vs-previous series month, database.js:486-490) and the composite `riskScore` (margin risk + trend risk + hardcoded `arRisk` 22 for construction / 8 otherwise, database.js:493-499).

**Runtime sales feed these numbers via `db.postSale()`** (database.js:543-568): appends to `sales`, then **mutates the company's LATEST existing `financials` row** (`mine[mine.length-1]`, i.e. 2026-06 in the demo — not necessarily the true calendar month) adding `amount` to revenue and `cost` to expense (database.js:555-561), then emits `sale:recorded` + `data:changed`. Seeded `sales` rows are ALREADY inside the seeded financials and must never re-roll (database.js:53-55; seed-bd.js:38-39, 140-149).

## 3. Consolidated Finance — where each screen's numbers come from

`views/group/finance.js` (route `group/finance`, 11 tabs, finance.js:35-41) mixes THREE sources:

1. **`financials` summaries via db** — Overview KPIs `finance(null,12)` (finance.js:157, 194-201), P&L tab (`db.series(null)` + `db.months(12)` + per-company series matrix, finance.js:253-316), Cash Flow (net movement = series profit, finance.js:330-341), per-company table `finance(c.id,12)` + `momRevenue` (finance.js:208-213), CSV export (finance.js:113-131).
2. **Operational stores** as fallback — `acc_schedules` for AR/AP (finance.js:89-94, 499-505 falls back only when `EPAL.ledger.aging` is absent), `banks` for cash (finance.js:96-98, 199); non-ledger balance sheet = banks + open schedules, equity as balancing figure (finance.js:398-404).
3. **The double-entry ledger `EPAL.ledger`** when loaded (it always is — index.html:96) — AR/AP KPIs on Overview mirror ledger aging (finance.js:164-171); Receivables/Payables desks use `LED().aging('AR'|'AP')` (finance.js:500, 1361-1416); Balance Sheet uses `LED().balanceSheet()` (finance.js:399, 1283-1358); **Chart of Accounts** balances = `LED().balance(code,{})` (finance.js:810); **Journal** = `LED().entries({})` (finance.js:844); **Trial Balance** = `LED().trialBalance()` group-wide plus a per-company comparison built from `LED().trialBalance(c.id)` (finance.js:981, 1029-1041); **Consolidation** = `LED().consolidatedTrialBalance()` with elimination column (finance.js:1091). Manual journals and inter-company postings write through `LED().post()` / `LED().postIntercompany()` (finance.js:962-976, 1195-1220).

So the P&L/Cash-Flow/Overview revenue numbers come from `financials`, while trial balance/consolidation come from `gl_entries` — **two deliberately parallel books that do not reconcile with each other** (ledger seed expenses are ~6%/month of seeded-sales revenue, ledger.js:553-559, whereas financials expenses are ~(1−margin)·revenue, database.js:119-131).

## 4. Ledger: one journal for all companies

**One shared journal + one shared chart of accounts; per-company books are read-time filters.**
- Store `gl_entries`: each entry carries `companyId` (schema ledger.js:17-20; assigned at post, `companyId: spec.companyId || 'group'`, ledger.js:170); store `coa` is a single group-wide COA with NO company dimension (STANDARD_COA, ledger.js:81-106).
- `post()` enforces the balancing invariant `|ΣDR−ΣCR| ≤ 0.5` and throws otherwise (ledger.js:162-165), upserts into the single `gl_entries` store (ledger.js:180) and emits `ledger:posted` + `data:changed` (ledger.js:181-182).
- Per-company figures are produced by filtering entries on `e.companyId` inside `accountTotals(code,{companyId})` (ledger.js:221-236), `trialBalance(companyId?)` (ledger.js:246-257), `pnl(companyId?)`, `balanceSheet(companyId?)`, `aging(kind,{companyId})`.
- `consolidatedTrialBalance()` (ledger.js:264-297) computes each account's net PER company via `accountTotals(...,{companyId})`, sums across companies, and **zeroes accounts flagged `intercompany` (1300 Inter-company Receivable / 2400 Inter-company Payable, ledger.js:86, 92)** into an elimination column. `postIntercompany()` writes two mirrored balanced entries (seller: DR 1300/CR 4000; buyer: DR 5000/CR 2400) linked by a shared `IC-` ref (ledger.js:305-321). Seeded IC transactions exist (4 pairs, ledger.js:612-626).
- Ledger seed backfills history **from the seeded `sales` store** (one `GL-S<id>` entry per sale: DR 1200/CR 4000, plus DR 5000/CR 2000 when cost>0, ledger.js:530-551, 561-566), opening bank balances (DR 1010/CR 3000 per `banks` row, ledger.js:569-581), and deterministic monthly expenses sized off each company's seeded sales revenue (ledger.js:556-559, 583-608).

## 5. Event/bus rollup vs computed-on-read

**Consolidation is computed on read — there are no stored group aggregates.** `groupSnapshot`, `finance`, `series`, `trialBalance`, `consolidatedTrialBalance`, and everything in `EPAL.intel` re-derive per call (intel is explicitly a persist-nothing read model, intel.js:20-27, 670-682).

There IS, however, an event-driven **write-time propagation chain for new sales** that the migration must reproduce:
1. `db.postSale()` appends to `sales`, rolls amount/cost into that company's latest `financials` row, and emits `sale:recorded` (database.js:543-568).
2. The ledger engine's `boot()` (run via `EPAL.bootEngines()` after `router.start()`, app.js:63-64, engines.js:73-79) subscribes to `sale:recorded` and auto-posts a balanced GL entry, **idempotently guarded** by in-memory keys plus a store scan on `ref`/`GL-S<id>` (ledger.js:651-680, rules at ledger.js:31-33).
3. Every mutation emits `data:changed` on `EPAL.bus` so open dashboards re-render (database.js:56-57, 528-533) — but these events trigger re-computation, never incremental aggregate updates.

## 6. What a per-company data split must preserve for identical group numbers

The exact stores/fields the group figures are functions of:

- **`financials`** — `{companyId, ym, revenue, expense}`: the sole input to Group Revenue/Net Profit/Blended Margin/MoM/risk/Revenue-Mix/P&L/Cash-Flow (database.js:463-499). A split must keep every row's exact `ym` bucketing (anchored to the frozen Jun-2026 window, database.js:108) and exact integer values; group totals are plain sums across companyIds.
- **`sales`** — `{companyId, date, amount, cost, profit, customer, ref}`: feeds ledger seed backfill (ledger.js:565-566), intel RFM/LTV/anomalies keyed by **customer NAME string** (intel.js:21-22, 81-103), and MD-briefing MTD sums (intel.js:556-561). Splitting must keep the union queryable group-wide and keep customer name strings identical across companies or RFM segments change.
- **`gl_entries` + `coa`** — the entry-level `companyId`, the `source` values (`sale|opening|manual|intercompany`...), the shared `IC-` pair refs, and the `intercompany` flags on accounts 1300/2400: trial balance, consolidation and eliminations all depend on filtering ONE entry set by `companyId` (ledger.js:264-297). The idempotency keys `GL-S<saleId>` / `ref` must survive (ledger.js:641-649).
- **`employees`** — headcount is `employees().length` including the `companyId:'group'` owner row and `EPL-DEV1` (database.js:164-167, 194-197, 517); per-company staff counts filter on `companyId` (database.js:509).
- **`leads`** — `{companyId, stage, value}`: pipelineValue/openLeads depend on the exact stage strings (database.js:519-520).
- **`customers`** — `companyIds:[]` is a *shared* graph (one customer can belong to several companies, database.js:207); `snap.customers` counts distinct customers group-wide (database.js:518). A naive per-company split would double-count.
- **`banks`** (has `companyId`, including `'group'`-owned accounts, seed-bd.js:100-106) and **`acc_schedules`** (`companyId`, `kind`, `status`, `due`) — cash position, fallback AR/AP, fallback balance sheet, MD-briefing cash (finance.js:89-98; intel.js:528-536).
- **`module-overrides`** + config `enabled` flags — `groupSnapshot` and `consolidatedTrialBalance` include only enabled `type:'company'` entries (database.js:504; ledger.js:265-267), while `finance(null)`/`series(null)` include **all** financials rows regardless (database.js:464-466, 473-474). This asymmetry must be reproduced exactly.
- **Frozen clocks and PRNGs** — `mulberry32(20260702)` (database.js:102), seed-bd PRNG `987654321` (seed-bd.js:63), ledger `TODAY = 2026-07-05` for aging (ledger.js:74), intel `TODAY/CUR_MONTH/YESTERDAY` constants (intel.js:56-59). Any re-generation instead of data migration will produce different numbers.

## 7. The travels/ mini-app is a fully separate data world

`travels/assets/core.js` defines its own persistence layer under namespace **`'epalTravels.'`** (core.js:31) with its own `store.get/set/list/save/seedOnce` (core.js:34-46) — it never imports `EPAL.store`, `EPAL.db`, or `EPAL.bus`; it exports `window.TV` (core.js:203). Its stores are `tv.bookings`, `tv.payments`, `tv.agents`, `tv.hotels`, `tv.airlines`, `tv.airports` (core.js:20-26, 114-121) — note the **dot** naming (`tv.bookings`) vs the main app's underscore stores (`tv_tickets` etc. under `epal.v1.`, seed-bd.js:22, 152). It seeds itself immediately at script load (`seed()` at core.js:202), computes its own aggregates (`TV.stats()`, core.js:188-193), and its bookings/payments **never flow into `EPAL.db`, `financials`, `sales`, or the ledger** — so nothing in the Group Command Center or Consolidated Finance includes mini-app data. Conversely `EPAL.store.nuke()` (prefix-scoped to `epal.v1.`, state.js:98-101) does not touch it.

### Risks flagged (Data Layer & Group Totals)

- Two non-reconciling finance books: dashboard/P&L numbers come from 'financials' while trial balance/consolidation come from 'gl_entries' seeded from a different population ('sales' + synthetic expenses). A migration that unifies them into one real ledger will change the Command Center and P&L numbers; pixel parity requires migrating BOTH datasets as-is (database.js:119-136 vs ledger.js:553-608).
- Determinism is load-bearing: numbers depend on fixed-seed PRNGs (mulberry32(20260702) in database.js:102; a=987654321 in seed-bd.js:63) and frozen clocks (financials window anchored Jun-2026 at database.js:108; ledger aging TODAY=2026-07-05 at ledger.js:74; intel TODAY/CUR_MONTH at intel.js:56-59). Re-generating seed data in another runtime instead of migrating the exact rows will silently change every KPI.
- Enabled-company asymmetry: KPI-hero revenue (db.series, all rows) vs groupSnapshot/export/consolidation (enabled companies only). If a company is toggled off via 'module-overrides', the same screen shows two different group revenues; a naive migration that picks one filter breaks parity (database.js:464-483 vs 504; ledger.js:265-267).
- Double-counting hazards baked into the seed contract: seeded 'sales' are already inside seeded 'financials' and must NOT re-roll (database.js:53-55; seed-bd.js:38-39), and ledger auto-post idempotency hinges on GL-S<id>/ref keys (ledger.js:641-649). Replaying sale events or reseeding in a backend without these guards double-counts revenue.
- postSale rolls new revenue into the company's LATEST existing financials row (mine[mine.length-1], i.e. 2026-06 in the demo), not the real calendar month (database.js:555-561). A backend that buckets by actual current month will diverge from today's behavior for MoM, series, and window KPIs.
- Customers are a shared cross-company graph (companyIds[]) and intel keys customer analytics by the raw NAME string in sales rows (database.js:207,518; intel.js:21-22,81-103). A per-company split that duplicates customers or namespaces sales per company will change the customer count KPI and every RFM/LTV/at-risk figure.
- Inconsistent clocks between ledger and fallback paths: ledger aging uses frozen 2026-07-05 (ledger.js:74,385-389) while the acc_schedules fallback ages against the real 'new Date()' (finance.js:101-105), and the balance-sheet fallback differs structurally from the ledger balance sheet - parity depends on which engine is loaded (finance.js:165-171,399,500).
- Cosmetic-but-visible hardcodings the migration must not 'fix': Workforce trend chip is a literal '+3' and counts all employees (incl. on-leave and the group owner) despite the 'active employees' label (dashboard.js:88-89; database.js:517); riskScore hardcodes arRisk 22 for construction / 8 otherwise (database.js:497).
- The travels/ mini-app data ('epalTravels.' namespace) is invisible to group totals today; wiring it into a unified backend would ADD its bookings to group revenue and break parity - it must stay a separate world or be excluded from rollups (travels/assets/core.js:31,202).


<!-- ======================================================= -->

# ENGINES inventory — `assets/js/engines/` (11 files, 3,958 lines)

All engines are IIFEs over the `window.EPAL` global, ES5, self-registering via `EPAL.registerEngine` (engines.js:53). Load order in index.html:84-110: kernel (config, state, eventbus, ui, charts) → **engines.js:90** → database.js:91 → seed-bd.js:93 → serial:95, ledger:96, audit:97, approvals:98, rules:99, documents:100, intel:101, comments:102, search:103 → auth.js:108 → **permissions.js:109** → router:110 → views → app.js:153. Registration order = execution order for seed and boot (engines.js:17).

---

## 0. engines.js — the registry (what happens at startup)

- **Purpose**: pure service-provider registry driving two lifecycle phases (seed, then boot) over all registered engines (engines.js:4-11).
- **Stores**: none — "pure registry / dispatcher" (engines.js:13-14).
- **Company-aware**: no. Pure machinery.
- **Startup sequence**: `app.init()` calls `EPAL.db.seed()` first (app.js:53); at the end of db.seed, `EPAL.seedEngines()` runs every engine's `seed()` in registration order (database.js:427, engines.js:65-71). After `router.start()`, `EPAL.bootEngines()` runs every `boot()` (app.js:63-64, engines.js:73-79). Each phase try/catches per engine so one failure never blocks the rest (engines.js:58-59, 69, 77). Late registration replays missed phases immediately (engines.js:56-59).
- **Schedulers / recurring jobs at boot**: exactly ONE recurring job in the whole system — rules.js boot runs `tick()` once then `setInterval(tick, 60000)` (rules.js:457-460). Other boots: ledger subscribes `sale:recorded` (ledger.js:659), audit records a login row + subscribes `data:changed` and `auth:changed` (audit.js:226-294). serial, approvals, documents, intel, comments, search, permissions boots are all no-ops (serial.js:145, approvals.js:336-341, documents.js:394-398, intel.js:679-682, comments.js:307-310, search.js:260-262, permissions.js:263-266).
- **Also used by views as a seed hook**: `EPAL.onSeed` (engines.js:83) exists but views call `registerEngine({name:'…-seed', seed})` directly: admin/employees.js:37, travels/vendor-agent.js:47, travels/marketing.js:60, shop/pos.js:38, travels/air-ticketing.js:63, it/projects.js:52, construction/projects.js:47, group/settings.js:105.

## 1. serial.js — `EPAL.serial`

1. **Purpose**: gapless sequential document numbering, `PREFIX/FY/000NNN`, one stream per (prefix, fiscal-year[, company]) (serial.js:4-9).
2. **Stores**: `serials` — flat counter map `{'INV:2026':42, 'travels:JV:2026':7}` (serial.js:11-14).
3. **Company-aware**: optionally — `keyFor(prefix, company)` prefixes the key with a company id when `opts.company` is passed (serial.js:62-64); otherwise streams are group-global. Fiscal year comes from `EPAL.config.group.fiscalYearStart` with a frozen demo anchor `new Date(2026,6,5)` (serial.js:53-59).
4. **Calls**: `EPAL.store` only, plus reads the `documents` store (owned by documents.js) inside `reconcile()` to seed counters ABOVE seeded serials (serial.js:78-93). No bus, no db.
5. **Consumers**: documents.js:301 (`numberFor`), travels/vendor-agent.js:819 (the ONLY company-keyed call: `next(prefix, {company:'travels'})`), travels/air-ticketing.js:1165 (`next('EMD')`), group/dashboard.js:337 (`next('GRP')`), group/settings.js:162 (`peek` preview).
6. **Per-company move breakage**: `reconcile()` scans the single shared `documents` store and only parses non-company keys `/^([A-Z]+)\/(\d+)\/(\d+)$/` (serial.js:83-92) — moving a company's documents to its own store means after `db.reset()` counters rebuild without them and `next('INV')` can reissue a byte-for-byte duplicate serial (serial.js:66-77). Company-prefixed streams are never reconciled at all. The counter map itself is one shared object — splitting it per company requires re-keying.

## 2. ledger.js — `EPAL.ledger`

1. **Purpose**: double-entry GL — the single financial source of truth: post/query journal entries, trial balance, P&L, balance sheet, AR/AP party subledgers, FIFO aging, consolidated (multi-company) trial balance with inter-company elimination (ledger.js:4-11).
2. **Stores**: `coa` (chart of accounts, 25 standard accounts, ledger.js:81-106) and `gl_entries` (ledger.js:70-71); both seeded via `seedOnce` (ledger.js:631-634).
3. **Company-aware**: deeply — every entry carries `companyId` (default `'group'`, ledger.js:170); all queries filter on it; `consolidatedTrialBalance()` derives the company list from `EPAL.config.companies` where `type==='company' && enabled!==false` (ledger.js:265-267); inter-company control accounts 1300/2400 are flagged and eliminated at group level (ledger.js:86, 92, 285-292); `postIntercompany` posts two mirrored entries (ledger.js:305-321). Seed hardcodes 4 IC pairs across it/woodart/shop/construction/travels (ledger.js:612-617) and derives sale entries + opening balances + expenses from the shared `sales` and `banks` stores (ledger.js:565-608).
4. **Calls**: `EPAL.store`, `EPAL.bus` (emits `data:changed`, `ledger:posted`, `intercompany:posted`; subscribes `sale:recorded` — ledger.js:181-182, 319, 659), `EPAL.audit.record` (guarded, ledger.js:183-187), `EPAL.db.sales` (ledger.js:565), `EPAL.config.companies` (ledger.js:265). The balancing invariant: post() THROWS if |ΣDR−ΣCR| > 0.5 (ledger.js:163-165). Auto-post on `sale:recorded` is idempotent via ref / `GL-S<id>` keys (ledger.js:641-663).
5. **Consumers**: group/finance.js (whole ledger suite — 29-31, 165-167, 399, 500, 832, 981, 1034, 1091 consolidated TB, 1209 postIntercompany, 1284, 1367, 1419); shared/company-modules.js (per-company accounts/journal/ledgers screens for ALL five companies — 226-236, 254-341, 371-569); travels/vendor-agent.js:645-657 (vendor payment posting); admin/employees.js:556-558 (payroll posting); group/briefing.js:226-228 (partyLedger); intel.js:415-416, 539-540, 576-577 (aging).
6. **Per-company move breakage**: `gl_entries` is ONE shared store partitioned only by the `companyId` field — every query does `S.list(GL_KEY)` then filters (ledger.js:202-213, 224-236). Moving one company's rows out silently drops them from trial balance, aging, P&L AND breaks consolidation: elimination math needs BOTH sides of each IC pair present so intercompany accounts net to zero (ledger.js:283-292). The seed also reads shared `sales`/`banks` (ledger.js:565-580), and dedup keys (`GL-S<id>`) assume a single store scan (ledger.js:641-649).

## 3. audit.js — `EPAL.audit`

1. **Purpose**: append-only audit trail ("who did what, when"), auto-recording create/update/delete from the `data:changed` firehose plus logins/approvals/exports (audit.js:4-10).
2. **Stores**: `audit_log`, hard-capped at the most recent 500 rows (audit.js:52-53, 92-97).
3. **Company-aware**: rows carry a `companyId` column (falls back to record/user companyId or 'group', audit.js:113, 279), but the machinery is generic. HOWEVER the `LABELS` allowlist hardcodes store names, mixing group and travels-specific stores (`visaApps, visaCats, airTickets, airlines, airports, airRefunds` — audit.js:60-67); anything absent from LABELS is treated as noise and never audited (audit.js:240-241). `IGNORE` explicitly skips `gl_entries`/`coa` because the ledger writes its own audit rows (audit.js:71-74, 296-297).
4. **Calls**: `EPAL.store`, `EPAL.bus` (subscribes `data:changed`, `auth:changed`; emits `audit:logged` — audit.js:121, 237, 286), `EPAL.auth.current` (audit.js:80-82), `EPAL.ui.uid` (audit.js:105). Boot also records a login for the signed-in user (audit.js:228-234). It strips transient `__auditAction/__auditReason` markers off live records (audit.js:251-254).
5. **Consumers**: group/activity-log.js (whole view — 65, 120, 171 subscribes `audit:logged`, 287); group/settings.js:114-115, 522-523; group/dashboard.js:371-372; admin/employees.js:572-573; and as a sink for ledger.js:185, approvals.js:135/193, rules.js:284/359.
6. **Per-company move breakage**: any store rename/move (e.g. per-company prefixing) silently kills auditing for it because LABELS is keyed by exact store name (audit.js:60-67, 241). The 500-row cap is shared group-wide — one busy company evicts the others' history (audit.js:53, 92-97). The create-vs-update heuristic scans the single store per entity (audit.js:265-271).

## 4. approvals.js — `EPAL.approvals`

1. **Purpose**: maker-checker governance — amount-banded multi-level approve/reject with segregation of duties and per-docType executors on full approval (approvals.js:4-10).
2. **Stores**: `approvals` (requests + step history) and `approval_matrix` (amount band → required roles) (approvals.js:12-21, 59-60). Executor registry is in-memory only (approvals.js:66).
3. **Company-aware**: requests carry `companyId` (default 'group', approvals.js:112) and `list()` filters on it (approvals.js:255), but the `approval_matrix` has NO company dimension — bands are group-global (approvals.js:276-288).
4. **Calls**: `EPAL.store`, `EPAL.ui.uid`/`ui.money` (approvals.js:108, 295), `EPAL.db.employee` (name lookup, approvals.js:67-70), `EPAL.db.notify` (approvals.js:125-133, 203-213), `EPAL.audit.record` (approvals.js:134-139, 192-200), `EPAL.auth.current` (approvals.js:154), `EPAL.bus` (emits `approval:requested/approved/rejected/advanced`, approvals.js:140, 217-219). Invariants: maker≠checker throws (approvals.js:155), reject requires comment (approvals.js:158-160), executors fire once on final approval inside try/catch (approvals.js:223-226).
5. **Consumers**: group/approvals.js (the checker console — 54, 122 `pending({forUser})`); group/settings.js:369-372, 426 (matrix editor via `setMatrix`); admin/employees.js:384-386, 460-464 (leave requests via `request`/`get`/`decide`); intel.js:598-599 (pending → MD briefing exceptions).
6. **Per-company move breakage**: single shared store keyed by `companyId` field — same pattern as ledger; splitting it breaks `pending()`/`list()` full-store scans (approvals.js:243, 252). A per-company approval matrix requires schema change (no companyId on rules, approvals.js:20-21). Seeds hardcode employee ids and company ids (approvals.js:293-322).

## 5. rules.js — `EPAL.automation`

1. **Purpose**: automation engine + THE scheduler — 8 declarative rules watching live data (low stock, idle visa files, payments due, overdue tasks, contract flights, credit breaches, month-end payroll) that fire notifications/tasks/escalations (rules.js:4-11).
2. **Stores**: `automation_rules` (this engine OWNS the seed; group/automation.js only reads — rules.js:22-25) and `automation_meta` (`escalatedDay` once-per-day dedupe, rules.js:17-19, 351-357).
3. **Company-aware**: heavily and hardcodedly — evaluators read company-specific stores directly: `sh_products` (shop, rules.js:123), `tv_files` (travels, rules.js:138), `acc_schedules` (rules.js:155), `tv_contract_flights` (rules.js:185), `tv_agents` w/ hardcoded 150000 limit (rules.js:209-215), plus group `vendors`/`employees`/`tasks.*`; deep-link routes hardcode company paths ('shop/inventory/low-stock', 'travels/file-management/files' — rules.js:131, 147). Admin task target hardcodes `EPL-0001` (rules.js:60).
4. **Calls**: `EPAL.db` (sales, col, vendors, employees, tasksFor, notify, saveTask — rules.js:103-258, 303-331, 345-355), `EPAL.store`, `EPAL.ui.money` (rules.js:80), `EPAL.config.company` (rules.js:81-84), `EPAL.audit.record` (rules.js:283-289, 358-362). Frozen demo clock 2026-07-05 (rules.js:64-67); each rule fires at most once per demo-day (`lastFired !== DEMO_DAY`, rules.js:370-374); bookkeeping upsert is silent (no data:changed) to avoid audit spam (rules.js:272-281).
5. **Consumers**: group/automation.js ONLY (console reading/previewing/running rules — automation.js:8, 16, 19, 31, 247).
6. **Per-company move breakage**: the `evaluate()` switch is a hardcoded map of store names and routes — moving shop's `sh_products` or travels' `tv_files`/`tv_contract_flights`/`tv_agents` to per-company stores silently zeroes those triggers (no error: `db.col` on a missing key returns []). The engine is conceptually "platform machinery + per-company rule packs" but is currently written as one monolith.

## 6. documents.js — `EPAL.doc`

1. **Purpose**: branded printable-document engine — builds pixel-perfect navy/gold `.epal-doc` DOM from a spec, prints/downloads self-contained HTML, files metadata to the Document Center (documents.js:4-12).
2. **Stores**: `documents` — Document Center METADATA rows only (not rendered docs), seeded with 6 fixed-serial rows (documents.js:13-17, 375-384).
3. **Company-aware**: rows carry `companyId` (default 'group', documents.js:331); branding comes from `EPAL.config.group` (documents.js:65). Machinery itself (build/print/words) is company-agnostic; BD lakh/crore numbering is locale-, not company-, specific (documents.js:84-97).
4. **Calls**: `EPAL.serial.next` via `numberFor` with the contract-mandated PREFIX map (documents.js:60-63, 299-303), `EPAL.ui` (el/modal/money/date/num/toast/uid/escapeHtml), `EPAL.db.save` for save-to-center so audit + live refresh happen (documents.js:336-338), `EPAL.auth.current` (documents.js:334), `EPAL.store.seedOnce` (documents.js:392). Save-once idempotence per modal (documents.js:323-324).
5. **Consumers — the widest engine**: every company vertical raises docs: woodart/projects.js:595, 981 (invoice, quotation); it/projects.js:520 (invoice); construction/projects.js:569 (interim payment certificate); travels/visa-processing.js:442 (visa cover), travels/contract-flight.js:302 (voucher), travels/air-ticketing.js:385, 1197 (ticket invoices), travels/vendor-agent.js:674 (statement); shop/pos.js:355 (receipt); admin/employees.js:591 (salary slip); group/documents.js:269, 310 (center + new-doc wizard); group/briefing.js:242, 292; group/dashboard.js:338; group/finance.js:1252; shared/company-modules.js:631-720 (statements for all companies).
6. **Per-company move breakage**: the shared `documents` store feeds group/documents.js (whole-store read) AND serial.js's reconcile (serial.js:80-92) — splitting it per company both hides rows from the Center and breaks serial duplicate protection after reset. Fixed seeded serials (INV/2026/000001-2 etc., documents.js:377-382) are the anchor for serial reconciliation.

## 7. intel.js — `EPAL.intel`

1. **Purpose**: pure read-model analytics — RFM/LTV customer analytics, workforce productivity, anomaly detection, per-company risk register, MD daily briefing; persists NOTHING, re-derives per call (intel.js:4-16).
2. **Stores**: `intel_config` — an idempotent config marker only (intel.js:12-16, 674-677).
3. **Company-aware**: yes, hardcoded: companies array `['travels','woodart','it','shop','construction']` (intel.js:331); `riskRegister(companyId)` has a per-company branch reading each vertical's private stores — `tv_files`/`tv_contract_flights` (travels, intel.js:455-473), `sh_products` (shop, 475-480), `cn_equipment` (construction, 482-487), `wa_projects` (woodart, 489-497), `it_subscriptions` (it, 499-505). Customers are keyed by the sales `customer` NAME string group-wide, not id (intel.js:21-22, 86).
4. **Calls**: `EPAL.db` (sales, employees, tasksFor, financials, airRefunds, vendors, momRevenue, finance, groupSnapshot, series — intel.js:81, 287-292, 309, 318, 351, 365, 389, 409, 430, 556-567), `EPAL.store` direct (it_timesheets:229, tv_agents:375, banks:530, acc_schedules:420/546, plus vertical stores above), `EPAL.ledger.aging` GUARDED with acc_schedules fallback (intel.js:415-424, 539-553, 576-580), `EPAL.approvals.pending` GUARDED (intel.js:598-608), `EPAL.ui`, `EPAL.config.company` (intel.js:303-306). Frozen clock 2026-07-05 (intel.js:56-59). Owner role excluded from productivity (intel.js:291).
5. **Consumers**: group/dashboard.js:264, 301 (briefing teaser, anomaly radar); group/crm.js:262, 265, 365-367, 465-467, (rfm/ltv/top/sleeping/atRisk); group/briefing.js:32, 185, 224 (full MD briefing view).
6. **Per-company move breakage**: every hardcoded store key and the hardcoded company list break; the fallbacks are silent (empty arrays), so numbers would quietly go wrong rather than error. Splitting the shared `sales` store fragments group-wide RFM/LTV (single `salesAgg()` scan, intel.js:80-103).

## 8. comments.js — `EPAL.comments`

1. **Purpose**: embeddable polymorphic comment threads with @mention parsing + notification pings; `widget(entityType, entityId)` drops a live thread into any drawer (comments.js:4-11).
2. **Stores**: `comments` — `{entityType, entityId, by, byName, text, mentions:[empId]}` (comments.js:13-16, 48).
3. **Company-aware**: no — comments have no companyId column; the mention notification targets the mentioned employee's companyId (comments.js:184). Pure machinery, but `routeFor` hardcodes deep links to travels/group modules only (comments.js:70-82).
4. **Calls**: `EPAL.ui` (el/uid/icon/toast/ago/initials/colorFor), `EPAL.db.employees`/`employee` (mention resolution, comments.js:96, 64), `EPAL.db.notify` (comments.js:179-186), `EPAL.auth.current` (comments.js:58-61), `EPAL.bus` (emits `data:changed` on add — audited via audit engine; widget live-sync subscribes and self-unsubscribes when off-DOM, comments.js:189, 240-248), `EPAL.store`.
5. **Consumers — one of the broadest**: travels/visa-processing.js:431 ('visaApps'), travels/air-ticketing.js:575 ('airTickets'), travels/vendor-agent.js:601 ('party' keyed by NAME), travels/contract-flight.js:250, woodart/projects.js:405, 924 ('wa_project','wa_estimate'), it/projects.js:410, 763 ('it_project','it_ticket'), construction/projects.js:441 ('cn_project'), group/finance.js:925 ('gl_entries'), group/crm.js:489 ('customer'), group/approvals.js:243 ('approval'), admin/employees.js:179 ('employee').
6. **Per-company move breakage**: threads attach by `(entityType, entityId)` string pairs — migrating a company's records with new ids (or renaming a vendor, since vendor-agent uses the party NAME as entityId) orphans its threads. The store itself is shared with no company column, so per-company splitting requires deriving company from the entity.

## 9. search.js — `EPAL.search`

1. **Purpose**: global data search behind the Ctrl+K palette — scans 12 live stores, ranks by earliest match position, round-robins across categories, caps at 20 (search.js:4-9, 29-38).
2. **Stores**: `search_config` — an idempotent config marker only (search.js:11-13, 252-258).
3. **Company-aware**: mixed — descriptors hardcode store keys spanning group (`customers, leads, employees, sales, documents, gl_entries`), travels (`visaApps, airTickets, tv_files, tv_passports, tv_contract_flights`) and shop (`sh_products`) with per-store deep-link routes and companyId resolvers (search.js:109-183); accent/name come from `EPAL.config.company` (search.js:70-84).
4. **Calls**: `EPAL.store.list` (defensively wrapped, search.js:65-67), `EPAL.config.company`. No bus, db, or other engines.
5. **Consumers**: kernel/app.js command palette ONLY (app.js:28, 420-421).
6. **Per-company move breakage**: descriptor store keys and route strings are hardcoded (search.js:111-181) — moved stores silently vanish from search; the seeded `search_config.stores` list (search.js:255-257) is a one-time snapshot that would go stale.

## 10. permissions.js — `EPAL.perm`

1. **Purpose**: action-level permissions (view/create/edit/delete/export/approve) layered on `EPAL.auth`'s coarse gate; `can(companyId, moduleId, action)` is the single gate; fail-open, admin bypass, only delete/approve hard-enforced (permissions.js:4-30).
2. **Stores**: `role_templates` — 7 seeded role rows with grant maps (permissions.js:11-17, 50, 261).
3. **Company-aware**: yes, via grant KEYS — `"companyId/moduleId"` with wildcards in both slots, most-specific wins (permissions.js:141-154); the seeded `agent` role hardcodes `travels/...` grants (permissions.js:123-133).
4. **Calls**: `EPAL.auth` (isAdmin/role/can — permissions.js:220-236), `EPAL.store`, `EPAL.bus` (emits `permissions:changed` + `data:changed` on setTemplate, permissions.js:204-207). Nothing else.
5. **Consumers**: group/settings.js:279, 435-441, 521 (Roles editor via templates/template/setTemplate/actions); gate checks in group/finance.js:31, woodart/projects.js:909, travels/vendor-agent.js:770-771, travels/contract-flight.js:233, shop/pos.js:451. Note kernel does NOT consult perm — routing uses auth.js.
6. **Per-company move breakage**: grant keys embed the company id string — renaming/splitting a company invalidates every explicit grant for it (silently falls to wildcard/advisory-allow, so it LOOSENS security rather than erroring).

---

## Platform vs per-company verdict

**Pure platform machinery (company-agnostic core)**: engines.js, serial.js (company is an opt-in param), documents.js build/print/words, comments.js core, permissions.js core, approvals.js core, audit.js core, ledger.js posting/query core.

**Company-entangled (hardcoded company store names / ids / routes inside the engine)**: rules.js `evaluate()` (rules.js:123-237), intel.js `riskRegister`/`anomalies` (intel.js:331, 455-505), search.js descriptors (search.js:109-183), audit.js LABELS (audit.js:60-67), comments.js routeFor (comments.js:70-82), ledger.js seed IC pairs (ledger.js:612-617), permissions.js agent template (permissions.js:123-133). These are the surfaces a per-company split must refactor into registries/config.

**Shared single stores partitioned by a companyId FIELD (not per-company stores)**: `gl_entries`, `documents`, `approvals`, `audit_log`, `comments`, `serials`, `automation_rules`. localStorage namespace is flat: `epal.v1.<key>` (state.js:20-22, 92-95).

### Risks flagged (Engines)

- Splitting the shared gl_entries store per company silently corrupts the books: trial balance, aging, P&L and the consolidated elimination all scan the single store, and intercompany pairs (ref 'IC-…', accounts 1300/2400) must have both sides present to net to zero (ledger.js:202-213, 264-297, 612-626).
- Serial duplicate risk: serial.js reconciles counters only from the single shared 'documents' store and only for non-company-keyed streams — per-company document stores or company-keyed streams get no reconciliation, so after a reset next() can reissue serials already printed on filed documents (serial.js:78-93).
- Audit coverage is a hardcoded allowlist: any per-company store rename drops it from audit.js LABELS and auditing stops silently with no error; the 500-row shared cap also lets one busy company purge others' compliance trail (audit.js:60-74, 92-97).
- rules.js, intel.js and search.js all fail SILENTLY on moved data (empty-array fallbacks and try/catch swallowing), so a partial per-company migration would ship with dead automations, wrong analytics and missing search results rather than visible breakage (rules.js:123-237, intel.js:415-424, search.js:65-67, 218).
- Comments are anchored to raw (entityType, entityId) strings — and travels/vendor-agent.js:601 uses the party NAME as entityId — so any id-remapping or record rename during migration orphans discussion threads with no referential integrity check (comments.js:149-152).
- permissions.js fails open and only enforces delete/approve; migrating company ids invalidates explicit grant keys and the engine then silently ALLOWS advisory actions, weakening rather than breaking access control (permissions.js:141-154, 241-248).
- Four engines carry independently hardcoded frozen demo clocks (2026-07-05: serial.js:54, ledger.js:74, rules.js:64, intel.js:56) — a migration that unfreezes or centralizes 'today' must change all four in lockstep or aging/serials/automation dedupe diverge.
- The approval_matrix has no company dimension (group-global amount bands, approvals.js:276-288) — per-company approval policies require a schema change, not just data partitioning.
- Registration order = execution order and index.html load order is load-bearing (engines.js before all engines, after eventbus/state/ui; permissions.js after auth.js — index.html:84-110); reordering scripts during migration changes seed/boot sequencing.


<!-- ======================================================= -->

# Views, Menus & Modularity Inventory — Epal Group ERP (`e:/Imran/New folder/newerp`)

## 1. View registration mechanism

**Registry location & signature.** The registry is `EPAL.views` (plain object, key → view def), created in `assets/js/views/registry.js:21`. The registration helper is a one-liner:

- `EPAL.view = function (key, def) { EPAL.views[key] = def; return def; }` — `assets/js/views/registry.js:24`
- Key format: `'company/module'` string (e.g. `'travels/visa-processing'`, documented at `assets/js/views/registry.js:15`), or wildcard `'*/module'` for screens shared by every company (`assets/js/views/shared/company-modules.js:8-10`).
- View shape: `{ title(ctx)?, render(ctx), teardown()? }` with `ctx = { mount, companyId, moduleId, subId, company, module, sub, params, router }` — `assets/js/kernel/router.js:31-32`.

**Router resolution.** Hash router at `assets/js/kernel/router.js`. `parse()` turns `#/<company>/<module>/<sub>[?params]` into segments, defaulting missing segments to `group` / `dashboard` (`router.js:48-57`). `resolve(companyId, moduleId, subId)` implements the fallback chain, first hit wins (`router.js:65-71`):

1. `'co/mod/sub'` exact
2. `'co/mod'` module-level
3. `'*/mod'` wildcard (shared across companies)
4. `null` → caller substitutes `EPAL.views['__placeholder__']` (`router.js:105`)

Before render, two gates run in order: module-enabled (`EPAL.modules.isEnabled`, `router.js:97-99`) then permission (`EPAL.auth.can`, `router.js:102`); gated routes render built-in states, never the view (`router.js:148-174`). Unknown company → redirect `group/dashboard` (`router.js:86`); unknown module → premium 404 (`router.js:90`, `132-145`). Old view `teardown()` + `charts.destroyAll()` always run first (`router.js:80-82`); a throwing render is caught inline (`router.js:110-117`).

**Fallback chain in practice:**
- The **shared company dashboard** is just the wildcard entry `EPAL.view('*/dashboard', …)` (`assets/js/views/shared/company-dashboard.js:45`) — Woodart, IT, Shop, Construction land there; Travels and Group win via specific registrations (`company-dashboard.js:5-7`).
- The **scaffold** `'__placeholder__'` (`registry.js:47-95`) is a *real navigable workspace*, not "coming soon": module-level scaffold lists enabled sub-modules as entry cards (`registry.js:78-92`); sub-level scaffold renders a generic workspace with KPI tiles + empty table (`registry.js:53-68`, `109-134`).

**Menus are generated from config, not from views.** `assets/js/kernel/config.js` is the single source of truth (`config.js:4-10`): the sidebar is rebuilt from `company.modules` filtered by enablement + role (`assets/js/kernel/app.js:220-226`), and each module with subs becomes an accordion with sub-links `#/co/mod/sub` (`app.js:240-293`, subs at `284-289`). Adding a config node makes its nav item + route live immediately with the scaffold rendering (`config.js:8-9`).

**A second registration path exists but is unused:** `EPAL.entity(spec)` (CRUD factory) registers `EPAL.view(spec.route, view)` at `assets/js/kit/entity.js:50` / `entity.js:178`, but no production view currently calls `EPAL.entity` — the only occurrence outside its own file is a docs example (`docs/CONTRACT.md:44`). Its header comment ("this is how ~60 modules exist", `entity.js:11-12`) describes intent, not current reality.

**Loading is manual:** every view file is a `<script>` tag in `index.html:114-149` (registry first at 114, shared at 117-118, app.js last at 153). `README.md:124` documents the contract: one `EPAL.view(...)` call + one script tag.

## 2. Registered view keys per company vs config.js modules

All `EPAL.view` registrations (43 keys + `__placeholder__`). **No key anywhere contains a sub segment** — registration is module-level only.

**Wildcard shared (one file, `views/shared/company-modules.js` + 2 others):** `*/dashboard` (company-dashboard.js:45), `*/hrm` (:62), `*/accounts` (:105), `*/ledgers` (:369), `*/reports` (:738), `*/analytics` (:829), `*/customers` (:944), `*/clients` (:945 — same render fn `customersView` as customers, i.e. route aliasing), `*/crm` (:954), `*/settings` (:1111), `*/tasks` (tasks/board.js:628).

**group — 16/16 modules bespoke (100%).** dashboard (group/dashboard.js:24), briefing (:30), companies (:38), finance (:136), analytics (:108), crm (:99), employees (admin/employees.js:775), tasks (tasks/board.js:627), reports (group/reports.js:78), documents (:64), approvals (:59), automation (:203), activity-log (:76), notifications (:46), module-manager (admin/module-manager.js:20), settings (group/settings.js:566). Note five of these *shadow* wildcard entries (dashboard, crm, reports, analytics, settings) — specificity override in live use.

**travels — 18 modules: 6 bespoke, 9 wildcard, 3 scaffold.**
- Bespoke: dashboard (travels/dashboard.js:13), vendor-agent (:206), air-ticketing (air-ticketing.js:135), contract-flight (:64), visa-processing (visa-processing.js:126), marketing (:152).
- Wildcard: crm, customers, accounts, ledgers, hrm, reports, analytics, tasks, settings.
- **Scaffold only: file-management, passport-mgmt, automation** (declared at config.js:119-122, 131; no view registered).

**woodart — 16 modules: 2 bespoke, 10 wildcard, 4 scaffold.**
- Bespoke: projects (woodart/projects.js:83), estimates (:684) — two modules from one file.
- Wildcard: dashboard, crm, clients, accounts, ledgers, hrm, reports, analytics, tasks, settings.
- Scaffold: materials, production, installation, procurement (config.js:147-150).

**it — 15 modules: 3 bespoke, 10 wildcard, 2 scaffold.**
- Bespoke: projects (it/projects.js:101), support (:616), services (:800) — three modules from one file.
- Wildcard: dashboard, crm, clients, accounts, ledgers, hrm, reports, analytics, tasks, settings.
- Scaffold: contracts, timesheets (config.js:173-174).

**shop — 15 modules: 2 bespoke, 9 wildcard, 4 scaffold.**
- Bespoke: pos (shop/pos.js:68), inventory (:395).
- Wildcard: dashboard, customers, accounts, ledgers, hrm, reports, analytics, tasks, settings.
- Scaffold: products, orders, purchases, suppliers (config.js:190-197).

**construction — 17 modules: 2 bespoke, 8 wildcard, 7 scaffold.**
- Bespoke: projects (construction/projects.js:123), boq (:761).
- Wildcard: dashboard, accounts, ledgers, hrm, reports, analytics, tasks, settings (construction has no crm/customers module in config.js:210-229).
- Scaffold: tenders, materials, procurement, equipment, subcontractors, labor, quality (config.js:214-221).

Totals: 97 config modules → 31 bespoke, 46 via wildcard shared screens, 20 placeholder scaffolds.

## 3. Sub-menu route resolution

Since no `'co/mod/sub'` keys exist, **every sub-route resolves to the module-level view, which dispatches internally on `ctx.subId`**. Two patterns:

- **Dispatch map** (deep travels views): `air-ticketing.js:137` reads `var sub = ctx.subId || 'overview'`, titles from a map (:139-143), then dispatches `({ overview:…, ticketing:directSale, 'manage-sales':manageSales, … }[sub] || overview)(page, ctx)` (:154-156). Identical pattern in visa-processing.js:128, 145-147.
- **Pill tabs** (shared wildcard views): `*/accounts` reads `ctx.subId || 'all'` (company-modules.js:107) and renders sub-route pills that `router.navigate(cid + '/accounts/…')` (:122-128), branching per sub (:138+).
- Modules with no registered view get the scaffold's sub-focused branch (`registry.js:53-68`).
- The dormant `EPAL.entity` factory also supports subs via row-filter predicates (`entity.js:27`, `:55`).

## 4. tasks/board.js and admin/* — sharing model

**tasks/board.js** — one factory `boardView(defaultAdmin)` (`board.js:40`) registered twice at `board.js:627-628`:
- `EPAL.view('group/tasks', boardView(true))` → admin oversight (employee picker, assign/restrict powers, `board.js:13-18, 45-47`).
- `EPAL.view('*/tasks', boardView(false))` → every company's `/tasks` route becomes the signed-in employee's own board (`board.js:20-23`).
So sharing is by **double registration of one closure-parameterised view**, not route redirection. All six companies declare a `tasks` module in config (group at config.js:87 admin-only; each company e.g. config.js:132, 156, 180, 203, 227).

**admin/*** — NOT shared across companies. `views/admin/module-manager.js:20` registers only `'group/module-manager'` and `views/admin/employees.js:775` only `'group/employees'`. These are group-command-layer screens (config marks both `admin:true`, config.js:84-86, 94); company-level HRM is served by the separate wildcard `*/hrm` (company-modules.js:62). The `admin/` and `tasks/` folder names demonstrate that **folder placement is cosmetic — the registration string alone decides routing**.

**Folder = module verdict:** today it's *folder = company, file ≈ 1-3 modules*. Views live in per-company folders (group/, travels/, shop/, it/, woodart/, construction/) plus cross-cutting shared/, tasks/, admin/. But: single files register multiple module keys (it/projects.js → 3 keys; shop/pos.js, woodart/projects.js, construction/projects.js → 2 each), one shared file registers 10 wildcard modules (company-modules.js:4), keys don't have to match paths (admin/ → group/*), and inclusion is manual script tags (index.html:114-149). The decoupled string-key registry makes a true folder-per-module refactor mechanical, but nothing enforces it today.

## 5. The standalone travels/ multi-page app

`travels/` (index.html, air-ticketing.html, flight-search.html, packages.html + assets/{core.js, travels.js, flight-search.js, packages.js, theme.css}) is a **completely separate, older-generation multi-page app with zero runtime relationship to the SPA**:

- Different stack: Tailwind CDN (`travels/index.html:25`) + Alpine.js page interactivity (`travels/assets/travels.js:4-7`) + its own Chart.js include (`travels/index.html:44`); no `window.EPAL` anywhere.
- Different data: its own persistence layer `TV.store` under localStorage namespace `'epalTravels.'` (`travels/assets/core.js:31, 34-46`) with its own stores (tv.bookings, tv.payments, tv.agents…, core.js:20-27); the SPA uses namespace `'epal.v1.'` (`assets/js/data/state.js:54`). Grep confirms the SPA never reads `epalTravels` and the mini-app never reads `epal.v1` — **no shared data**.
- **No cross-links in either direction**: no href from the SPA to `travels/*.html` and none from the mini-app back to `../index.html` (only its own page-to-page nav, `travels/index.html:66-89`).
- Internally it IS a coherent mini-ERP: a booking made on flight-search.html appears in air-ticketing.html and the dashboard via core.js (`core.js:5-8`).
- Defect: `travels/index.html:77` links to `visa-processing.html`, which does not exist in the folder (dead link).

It functions as a design/domain prototype that the SPA's `views/travels/*` re-implemented natively; for migration it is dead weight unless the owner still demos it.

## 6. assets/atmosphere/ — per-vertical decoupling that already works

The ambient-scene system is the cleanest existing example of "drop in a per-vertical pair, zero core changes":

- **Stamping:** `app.js` subscribes `route:changed` before `router.start()` (`app.js:59-62`) and `onRoute` stamps `data-atmos="{companyId}"` and `data-module="{moduleId}"` on the `#view` mount every navigation (`app.js:196-201`); the router itself also stamps `data-route` and the company `--accent` (`router.js:107-108`).
- **Base layer:** `assets/css/atmosphere.css` paints a per-vertical line-art emblem via `[data-atmos="…"]#view::before` selectors for all six verticals (`atmosphere.css:55-100`), including a module-specific variant `[data-atmos="travels"][data-module="visa-processing"]` (`atmosphere.css:80`).
- **Full scenes:** each vertical scene is a self-contained CSS+JS pair — `travels-scene.{css,js}`, `interior-scene.{css,js}` — that mounts its own DOM and binds a `MutationObserver` on `#view[data-atmos]`, toggling `.on` when its vertical is active (`travels-scene.js:295-297`, `interior-scene.js:334, 342`). Full scenes suppress the corner emblem with one CSS line (`travels-scene.css:32`, `interior-scene.css:33`).
- **Wiring:** two `<link>`s + two `<script>`s in index.html (`index.html:62-63, 155-156`); the add-a-vertical recipe is documented in `assets/atmosphere/README.md:19-44` (copy pair, change the `data-atmos` string, add tags).

This attribute-stamp + observer pattern is exactly the decoupling contract a folder-per-module migration should generalise: the kernel broadcasts context (`data-atmos`/`data-module`/`route:changed`), modules self-attach.

### Risks flagged (Views & Menus)

- Registration keys are strings decoupled from folder paths — files in views/admin/ register group/* keys, tasks/board.js registers both group/tasks and */tasks, and single files register up to three module keys (it/projects.js:101,616,800) — so a naive 'folder = module' mapping will drop or mis-route these aliases.
- The wildcard '*/mod' layer serves 46 of 97 modules (9-10 per company); a migration that only ports company-specific screens silently downgrades those routes to scaffolds or 404s, and per-company overrides of wildcards (group/settings vs */settings) must be parity-tested in both scopes.
- Script-tag order in index.html:84-156 is load-bearing (registry.js before all views, app.js last, atmosphere scenes after app.js); any bundler/module-loader port must preserve this init order or EPAL.view/EPAL.pageHead will be undefined at registration time.
- Sub-routes have no registry entries — all sub-navigation logic (dispatch maps, pill tabs, scaffold sub-branch) lives inside module view bodies, so route-table-driven frameworks cannot infer sub-screens from the registry; each module file must be read to enumerate its real sub-screens.
- The placeholder scaffold (registry.js:47-95) is itself a designed, navigable UI (sub-module cards, KPI tiles, build banner, comingSoon modal) — pixel parity requires reproducing it for the 20 scaffold-only modules, not treating them as empty.
- EPAL.entity (kit/entity.js) is documented as powering '~60 modules' but has zero callers today — inventory or estimates based on its header comment would be wrong.
- Atmosphere scenes bind MutationObservers to the #view node captured at load (travels-scene.js:297); any framework that re-creates the mount element (vdom re-render, page transitions) breaks scene toggling even if attributes are stamped correctly.
- The standalone travels/ mini-app shares nothing with the SPA (separate storage namespace, no links) yet ships in the same repo and deploys to the same GitHub Pages site — migration scope must explicitly include or exclude it, and its nav already contains a dead link (travels/index.html:77 -> missing visa-processing.html).
- Router defaults ('' -> group/dashboard, missing module -> 'dashboard', router.js:56) and gate states (company-off/module-off/sub-off/denied, router.js:148-174) are behavior users see daily; parity requires porting these dead-end states, not just happy-path views.


<!-- ======================================================= -->

# Tooling, Deployment & Docs Inventory — Epal Group ERP (`e:/Imran/New folder/newerp`)

## 1. Build tooling: confirmed NONE

- **No npm/bundler anywhere.** `package.json`, `package-lock.json`, and `node_modules` do not exist (verified by directory listing and glob — the only `.json` in the repo is the untracked `.claude/settings.local.json`). No `.github/` directory exists at all, so there are **zero GitHub Actions workflow files**.
- The no-build design is an explicit, documented directive, not an accident:
  - `index.html:31-35` — "LOAD ORDER MATTERS (no build step, everything hangs off a global window.EPAL) … No build step. Open index.html through a local web server (recommended) or directly."
  - `CLAUDE.md:35-39` — "No bundler, no npm — deployed as-is to GitHub Pages (`.nojekyll`), must stay free/static (**owner directive**)."
  - `README.md:31` — "No install, no build, no backend." (run via `python -m http.server 8080` or double-click, `README.md:33-41`).
- **How it is served:** GitHub Pages, "deploy from a branch" style. Remote is `https://github.com/imran-me/modularerp.git`, single branch `main` tracking `origin/main` (git remote/branch output; HEAD `9c6e776` == `origin/main`). With no workflow files, deployment is GitHub's automatic Pages branch build. `CHANGELOG.md:29-30` records the operative fix: "**GitHub Pages deploy** was failing on the large Deep Core commit (build OK, deploy step failing) — added `.nojekyll` so this vanilla no-build site deploys as-is." The zero-byte `.nojekyll` sits at repo root (confirmed, 0 bytes) and **must survive any restructure at the root**.
- **Runtime dependencies are all CDN** (the only network resources): Google Fonts (`index.html:45-47`), Bootstrap Icons 1.11.3 (`index.html:51`), Chart.js 4.4.3 (`index.html:80`). The `travels/` mini-app additionally pulls **Tailwind Play CDN** (`travels/index.html:25`, `travels/packages.html:16`, `travels/air-ticketing.html:18`, `travels/flight-search.html:18`) and Alpine.js 3.14.1 (`travels/index.html:45`) — the only place Tailwind already exists in the repo, a live precedent for the Phase-1 "Tailwind on a no-build repo" open decision (`MIGRATION_STATUS.md:41-44`).

## 2. What breaks if files move into `companies/<x>/` folders

**Only `index.html` breaks — and it breaks completely.** It is the single manifest of every file the SPA loads:
- 9 relative `<link rel="stylesheet" href="assets/css/...">` / `assets/atmosphere/...` tags (`index.html:54-63`).
- 55 relative `<script src="assets/js/...">` / `assets/atmosphere/...` tags (`index.html:84-156`), whose **order IS the dependency graph** — "config first, then the layers in dependency order, views next, app.js LAST" (`index.html:31-32`; reiterated `CLAUDE.md:36-37`). Any folder move must rewrite these tags and preserve order exactly.

**Nothing inside the JS/CSS references filesystem paths at runtime:**
- Grep of every `.js` for `assets/` finds **only banner comments** (self-identifying headers, e.g. `assets/js/kernel/config.js:2`, `assets/js/engines/serial.js:2`) — cosmetic, not load-bearing (though they will read wrong after moves).
- All CSS `url()` values are inline `data:` URIs (`assets/css/atmosphere.css:101`, `assets/css/base.css:91`; verified no non-data `url()` exists in any CSS file). No local images, no local fonts — the repo contains **zero binary assets**.
- Route strings like `travels/visa-processing` (`assets/js/engines/search.js:127`, `assets/js/engines/comments.js:72`) are hash-router keys, not paths — folder moves cannot affect them.
- GitHub Pages itself has no path config; it serves the branch as-is, so no deploy-side change is needed beyond keeping `.nojekyll` and `index.html` at root.

## 3. Dynamic runtime loading: NONE today — and that's the migration's sharpest edge

- Exhaustive grep for `fetch(`, `XMLHttpRequest`, `import(`, `createElement('script'`, `.src =`, `WebSocket`, `EventSource`, `axios`, `$.ajax`, `importScripts`, `appendChild(script` across all JS/HTML finds **no runtime resource loading at all**. The only hits are two `window.open('', '_blank')` calls opening *blank* windows for print flows (`assets/js/views/tasks/board.js:608`, `assets/js/engines/documents.js:274`) — URL-less and path-independent.
- All data lives in localStorage under the `epal.v1.` namespace behind `EPAL.store` (`docs/DATA_MODEL.md:14-26`). Nothing fetches JSON or HTML.
- **Consequence:** folder moves cannot break any runtime fetch — but the planned auto-discovery (per-company `module.json` fetch probe, `MIGRATION_BRIEF_for_Claude_Code.md:79`, `MIGRATION_STATUS.md:45-48`) would introduce the app's **first-ever runtime fetch**, which breaks the currently-documented `file://` support ("Works from `file://`", `docs/ARCHITECTURE.md:9-10`; `README.md:34-35`) because `fetch()` of local files is blocked on `file://`. The alternative "one `<script>` tag per company folder whose absence 404s gracefully" (`MIGRATION_STATUS.md:47-48`) preserves `file://`. This is already logged as Open Decision 2 and genuinely needs the owner call.

## 4. Docs inventory — overlap and staleness vs. the new architecture

**Root docs (migration set — current, authored 2026-07-08, commit `9c6e776`):**
- `CLAUDE.md` — guard rails R1–R8; current; names GitHub Pages + `.nojekyll` + free/static owner directive (`CLAUDE.md:35-39`).
- `MIGRATION_BRIEF_for_Claude_Code.md` — the *how* (Phases 0–4, manifest/bridge formats §7); current.
- `EPAL_GROUP_ERP_Modular_Architecture.md` — the *what* (v2 target: `platform/` kernel + `companies/<x>/` + bridge + auto-discovery + Tailwind-only, RULES 1–6 at lines 31-39; master tree at 124-147). Line 7 explicitly supersedes the old navy/gold tokens in earlier drafts.
- `MIGRATION_STATUS.md` — live tracker; current, **but** it cites `docs/PHASE0-INVENTORY.md` as delivered (`MIGRATION_STATUS.md:21,37`) and **that file does not exist** in `docs/` (verified by listing) — the tracker is ahead of reality until this inventory lands there.
- `CONTEXT.md` — project memory; accurate for the pre-migration app; its architecture tree (`CONTEXT.md:58-80`) describes the `assets/js/{kernel,data,engines,kit,views}` layout and will need a rewrite after restructure.
- `CHANGELOG.md` — release history; current; v0.3.1 documents the `.nojekyll` fix (`CHANGELOG.md:29-30`). Its v0.3.0 entry still describes documents branding as "navy `#1B2A4A` / gold `#C9A227`" (`CHANGELOG.md:57`) — fine as history, but do not seed Tailwind from it.
- `README.md` — **already stale**: its project-structure section claims `assets/js/core/` (`README.md:80-89`) but the real layout is `kernel/ + data/ + engines/ + kit/` (actual tree; `index.html:15-27`); it lists ~6 view files vs ~30 real ones and omits 6 of the 11 docs (`README.md:99-104`). Needs a full rewrite post-migration anyway.
- `oldprojectmap.md` — old-system **domain reference only** (per `README.md:69`); its line 253 notes the old system's Pages/`file://` constraint; leave as-is.

**`docs/` folder (11 files) — the two the prompt flags, then the rest:**
- `docs/ARCHITECTURE.md` — **direct conflict with the target architecture.** Claims "the app is generated from `kernel/config.js`" (`:5`), "No build step … Works from `file://`" (`:9-10`), the layer table `kernel/…/views/**` (`:28-39`), and a "Why not Bootstrap / a framework?" section defending bespoke CSS (`:64-71`) that now collides with the Tailwind directive (RULE 5). Must be rewritten for platform/companies/bridge/discovery once Phase 2–3 land.
- `docs/MODULE-SYSTEM.md` — **the biggest doc casualty.** Everything hinges on the hand-maintained registry: "The registry (`assets/js/kernel/config.js`)" (`:5`), overrides in `localStorage["epal.v1.module-overrides"]` (`:25-36`), and "Adding to the registry … Drop that into the `SHOP_MODULES` array in `config.js`" (`:85-93`) — the exact "master list to edit by hand" that RULE 3 auto-discovery (`EPAL_GROUP_ERP_Modular_Architecture.md:23,34`) abolishes. The override/toggle *behaviour* it documents must be preserved bit-for-bit (R2), so this doc must be updated, not discarded.
- `docs/VIEWS-GUIDE.md` — step 2 is "Add one line to `index.html`" (`:47-53`) and file pattern `assets/js/views/<company>/<module>.js` (`:7`) — both invalidated by folder discovery; the `EPAL.view()` API itself survives.
- `docs/DEEP-CORE-CONTRACT.md` — engine API surface; current for APIs, but "Every new JS file MUST be added as a `<script>` in `index.html`" (`:5-6`) conflicts with discovery; the ES5-only rule (`:4`) should carry forward.
- `docs/CONTRACT.md` — view-author contract incl. mandatory `views/<company>/<file>.js` banner (`:7-12`); API portion survives; path conventions change.
- `docs/DATA_MODEL.md` — authoritative store map; behaviour-stable under R2 so remains valid; cited file paths (`data/database.js` etc., `:6-8`) will move.
- `docs/MIGRATION_ROADMAP.md` — a **different migration** (localStorage → Laravel backend via the `state.js`/`database.js`/engines seam, `:12-80`). Orthogonal to the current structure+Tailwind migration; the near-identical naming vs `MIGRATION_BRIEF/STATUS` is a real confusion hazard for future sessions.
- `docs/FOR-LARAVEL-DEVELOPERS.md` — **stale on two axes**: quotes the superseded palette "navy `#1B2A4A` … gold `#C9A227`" (`:79-80`) whereas `assets/css/tokens.css:22,26,30` now holds `--gold:#1A43BF`, `--epal-abyss:#00072D`, `--epal-accent:#1A43BF` (exactly the trap `CLAUDE.md:40-43` warns Tailwind seeding about); and it prescribes rebuilding on "Laravel + Blade + **Bootstrap**" (`:4`, `:80`) which now contradicts RULE 5 (Tailwind). Its layer map (`:16-24`) goes stale after restructure.
- `docs/DEEP-CORE-STATUS.md` — explicitly "retained as a record" (`:4`); no update needed.
- `docs/ROADMAP.md` — feature graduation order; content unaffected, path references (`views/**`, `:5`) go stale.
- `docs/travels-visa.md` — exemplar module doc; path `assets/js/views/travels/visa-processing.js` (`:3`) moves.
- `assets/atmosphere/README.md` — current; "ships free on GitHub Pages" (`:8-9`); if scenes move into company folders (Open Decision 3, `MIGRATION_STATUS.md:49-53`) its file table needs updating.

## 5. Repo hygiene

- **Line endings:** `git ls-files --eol` shows 91 tracked files LF/LF, 1 none (`.nojekyll`), and **4 files LF-in-index but CRLF-in-working-tree**: `assets/css/atmosphere.css`, `assets/js/kernel/app.js`, `index.html`, `oldprojectmap.md`. Cause: system-level `core.autocrlf=true` (`C:/Program Files/Git/etc/gitconfig`) and **no `.gitattributes`** in the repo — this is exactly what produces the "LF will be replaced by CRLF" warnings during the migration's many file moves. Repo content is normalized LF in the index, so it's cosmetic, but a `.gitattributes` (`* text=auto`) would silence it deterministically.
- **No `.gitignore` in the repo.** The `.claude/` local files stay untracked only via *machine-local* excludes: `C:\Users\User/.config/git/ignore:3` ignores `**/.claude/settings.local.json` and `.git/info/exclude:8` ignores `**/.claude/scheduled_tasks.lock` — neither travels with a clone. If Phase 1 introduces a local Tailwind CLI (`node_modules/`), nothing prevents committing it today.
- **State:** working tree clean; HEAD `9c6e776` == `origin/main`; rollback tag `pre-migration-baseline` exists locally (= `6e1211d`, `MIGRATION_STATUS.md:10`); backup folder `e:\Imran\New folder\newerp-BACKUP-pre-migration-2026-07-08\` lives *outside* the repo (good — it can't be accidentally committed).
- **Oddities:** GitHub repo is named `modularerp` while the local folder is `newerp`; global `init.defaultbranch=master` vs repo `main` (harmless); no LICENSE file; repo has zero binary assets (all imagery is inline SVG/data-URI).

## 6. The `travels/` mini-app deploy paths

- A **standalone multi-page** Tailwind-CDN + Alpine app: `travels/{index,flight-search,air-ticketing,packages}.html` + `travels/assets/{theme.css,core.js,travels.js,flight-search.js,packages.js}`.
- **All links are relative siblings**, so the folder is relocatable *as a unit*: nav/CTA links `href="index.html"`, `"flight-search.html"`, `"air-ticketing.html"`, `"packages.html"` (`travels/index.html:66-79,135,215,288-289`; `travels/packages.html:34-39,52-54,165`; `travels/flight-search.html:36-41,54-56,203`; `travels/air-ticketing.html:42-53,72`); assets via `href="assets/theme.css"` / `src="assets/core.js"` etc. (`travels/index.html:41,46`; `travels/packages.html:18-20`; `travels/air-ticketing.html:25-26`; `travels/flight-search.html:20-22`). Moving `travels/` wholesale keeps everything working; splitting HTML from `travels/assets/` breaks it.
- **Dead link shipped today:** every page links to `visa-processing.html` (`travels/index.html:77,289`; `travels/flight-search.html:40`; `travels/air-ticketing.html:47`; `travels/packages.html:38`) but **no `visa-processing.html` exists** in `travels/` — a live 404 on GitHub Pages right now.
- **No cross-links between the two apps:** the main SPA never links to `travels/*.html` and the mini-app never links back to the root SPA (grep-verified). They also use **disjoint localStorage namespaces** — SPA `epal.v1.` vs mini-app `epalTravels.` (`travels/assets/core.js:31`) — and localStorage is origin-scoped, so folder moves don't touch stored data.
- **Naming hazard for move tooling:** `travels/assets/` vs root `assets/` — any bulk path rewrite targeting `assets/` must exclude the mini-app's own `assets/` subfolder (and vice versa).

### Risks flagged (Tooling, Deployment & Docs)

- Auto-discovery via module.json fetch-probe would introduce the app's first-ever runtime fetch, breaking the documented file:// support (docs/ARCHITECTURE.md:9-10, README.md:34-35) and adding 404 noise on GitHub Pages; the script-tag-per-folder alternative (MIGRATION_STATUS.md:47-48) preserves file:// — this owner decision gates Phase 3 and must precede any restructure design.
- Every folder move requires editing index.html's 64 ordered <link>/<script> tags where load order IS the dependency graph (index.html:31-32); a single mis-ordered tag (e.g. config.js not first, app.js not last) breaks boot silently on deploy.
- Seeding the Tailwind config from any doc instead of assets/css/tokens.css would bake in the superseded navy/gold palette still printed in docs/FOR-LARAVEL-DEVELOPERS.md:79-80 and CHANGELOG.md:57, violating R1 pixel parity.
- No .gitignore exists, so a Phase-1 local Tailwind CLI setup (node_modules/, build artifacts) could be committed to the Pages-served branch; the .claude/ excludes are machine-local only and do not travel with the repo.
- .nojekyll must remain at repo root through every restructure commit — its removal reintroduces the exact Pages deploy failure recorded in CHANGELOG.md:29-30, and R5 requires the app deployable at every step.
- core.autocrlf=true with no .gitattributes means the migration's mass file moves will generate CRLF/LF warnings and risk noisy whole-file diffs that defeat the small-reviewable-commits rule (R6); adding .gitattributes first (a non-visual change) would stabilize diffs.
- Bulk path-rewrite tooling that targets 'assets/' can corrupt the travels/ mini-app, which has its own travels/assets/ folder with identically named relative references (travels/index.html:41,46).
- The docs set will actively mislead future sessions mid-migration: docs/MODULE-SYSTEM.md and docs/VIEWS-GUIDE.md instruct editing config.js and index.html by hand — the exact pattern the new architecture removes — and docs/MIGRATION_ROADMAP.md describes a *different* (backend) migration under a near-identical name to MIGRATION_BRIEF/STATUS.
- travels/ pages ship a dead link to visa-processing.html on every page (404 in production today); a pixel/behaviour-parity sweep will flag it, and 'fixing' it during migration would violate R3 (no feature changes) without an owner decision.
- MIGRATION_STATUS.md already claims docs/PHASE0-INVENTORY.md exists (lines 21,37) when it does not — the tracker must be reconciled before the Phase 0 approval gate or the audit trail is wrong from step one.


---

# Verification appendix — adversarial spot-check verdicts

Verdict totals: {"CONFIRMED":42,"IMPRECISE":17,"WRONG":1}

- **IMPRECISE** — Script tag order in index.html is the only dependency mechanism (no build step, all IIFEs over window.EPAL); groups are vendor Chart.js (index.html:80), core runtime config→state→eventbus→ui→charts→engines→db→seed→9 engines→kit→auth→permissions→router (index.html:84-110), views registry-first then wildcards then specific (index.html:114-149), and app.js last + atmosphere scenes (index.html:153-156).
  - correction: Order, grouping and all line cites are exact: Chart.js CDN at index.html:80; config(84)→state(85)→eventbus(86)→ui(87)→charts(88)→engines.js(90)→database(91)→seed-bd(93)→exactly 9 engines serial/ledger/audit/approvals/rules/documents/intel/comments/search(95-103)→kit forms/datatable/entity(105-107)→auth(108)→permissions(109)→router(110); views: registry(114)→wildcards company-dashboard/company-modules(117-118)→specific(120-149); app.js(153) then atmosphere scenes(155-156). The wrong detail is 'all IIFEs over window.EPAL': the 55 files under assets/js all end `})(window.EPAL = window.EPAL || {});` (verified by grep), but the two assets/atmosphere scripts are zero-argument anonymous IIFEs that never receive or touch EPAL (travels-scene.js:42, interior-scene.js:36). Also app.js is not literally the last <script> — the two scene scripts follow it.
- **CONFIRMED** — Boot order in App.init is seed → applyOverrides → applyTheme → renderShell → bindGlobal → set router.mount → subscribe route:changed → router.start → bootEngines → reactive bus subscriptions → remove splash (app.js:52-74), auto-invoked at app.js:472-474.
- **CONFIRMED** — The hash router parses #/<company>/<module>[/<sub>][?params] with defaults group/dashboard (router.js:48-57), resolves views by specificity co/mod/sub → co/mod → */mod → __placeholder__ (router.js:65-71,105), and runs two gates before render: modules.isEnabled (router.js:97-99) then auth.can (router.js:102).
- **IMPRECISE** — route:changed is emitted with the full ctx after every render (router.js:119) and its ONLY bus consumer is App.onRoute (app.js:62), which stamps data-atmos/data-module on #view (app.js:198-201); the atmosphere scenes bind via MutationObserver on that attribute, not the bus (travels-scene.js:295-297, interior-scene.js:334-342).
  - correction: 'After every render' is wrong: router.render() RETURNS BEFORE the emit at router.js:119 on every early-exit path — unknown company redirect (86), unknown module → render404 (90), and all gate states company-off/module-off/sub-off (97-99) and denied (102). route:changed fires only when a view/placeholder render path completes (including a caught view error, 110-117). So on 404/gate screens the breadcrumb, rail highlight and data-atmos/data-module stamps do NOT update — a real parity detail. The rest is confirmed: a repo-wide grep shows router.js:119 is the only emitter and app.js:62 the only bus subscriber; onRoute stamps data-atmos/data-module at app.js:198-201; scenes bind via `new MutationObserver(refresh).observe(view,{attributes:true,attributeFilter:['data-atmos']})` at travels-scene.js:295-297 ('travels') and interior-scene.js:333-342 ('woodart', observer at 342), never the bus.
- **CONFIRMED** — Rail, sidebar and command palette are all generated from EPAL.config.companies filtered by EPAL.modules.isEnabled AND EPAL.auth.can/canCompany — buildRail (app.js:109-120), refreshNav/buildNavItem (app.js:208-293), openCommandPalette (app.js:384-396).
- **CONFIRMED** — Module enable/disable persists as a flat map in localStorage key epal.v1.module-overrides ({"co":bool,"co/mod":bool,"co/mod/sub":bool}, absence = config default) (state.js:106-134); toggle() writes it, re-folds onto live config, and emits modules:changed (state.js:137-144); the admin UI is the group/module-manager view (module-manager.js:20) with group/dashboard and group/module-manager locked on (module-manager.js:17-18).
- **IMPRECISE** — Auth gating: owner/admin bypass everything, explicit 'co/mod' or 'co/*' grants beat role defaults, non-admins are scoped to homeCompany, group layer allows non-admins only dashboard/notifications with GROUP_ADMIN_ONLY hard-denied, and per-role whitelists cover manager/accountant/hr/agent/employee (auth.js:98-126,50).
  - correction: Three details are off (file assets/js/kernel/auth.js). (1) GROUP_ADMIN_ONLY is NOT hard-denied: the explicit-grant check at 104-105 runs BEFORE the group-layer check at 110-113, so a permissions[] entry 'group/<mod>' or 'group/*' grants access to module-manager/settings/employees/tasks/automation (list at line 50) despite GROUP_ADMIN_ONLY. It is denied only along the role-default path. (2) homeCompany scoping applies only to non-admins whose companyId is a real company: homeCompany() returns null for companyId 'group' (78-81), so such a user passes canCompany for EVERY company (94) and skips the scoping check in can() (116-117) — then hits the role rules. (3) 'per-role whitelists' — manager is a BLACKLIST (`moduleId !== 'settings'`, line 119), i.e. everything except settings; accountant/hr/agent are whitelists (120-122); plain employee falls to the ESS whitelist ['dashboard','tasks'] (48, 125). Confirmed parts: isAdmin bypass in can() (100) and canCompany (91); group layer allows only dashboard/notifications to non-admins (112); can() spans 98-126.
- **CONFIRMED** — The only JS globals are window.EPAL and window.Chart (Chart.js CDN, index.html:80, charts.js:46-47); a sweep for other window.* assignments across assets/ finds none, and atmosphere scripts are anonymous IIFEs (travels-scene.js:42).
- **CONFIRMED** — If a company's view files are not loaded nothing breaks: routes fall back to the */module wildcards (company-dashboard.js:45, company-modules.js:62-1111, board.js:628) or the __placeholder__ live scaffold (registry.js:47-95), and even a missing placeholder yields a caught inline error, never a blank page (router.js:66,110-117).
- **CONFIRMED** — Every mounted chart is tracked and the router calls EPAL.charts.destroyAll() before each render (charts.js:89, router.js:82), and a view's optional teardown() is invoked in try/catch (router.js:80) — the SPA's leak-prevention contract.
- **IMPRECISE** — All DOM class names originate in JS: index.html's body is just a splash plus an empty <div id="app"> (index.html:66-77), and views build elements via the el('div.kpi-card') hyperscript helper (assets/js/kernel/ui.js:45-66; example assets/js/views/group/dashboard.js:237), so a Tailwind conversion edits JS string literals, not HTML files.
  - correction: The mechanism is right but 'All' is false. Static class names DO live in index.html: the boot splash uses .boot-logo/.boot-mark/.boot-name/.boot-bar (index.html:69-72) and the mount div is <div id="app" class="app"> (index.html:77) — it is not class-less. Also the body is not 'just' those elements: index.html:79-156 holds ~70 lines of <script> tags inside <body> (66-157); the markup-only portion is 68-77. The el() helper (ui.js:45-66, class parsing at 49-51) and the example el('div.kpi-card'...) (dashboard.js:237) are confirmed. Two further nuances for a Tailwind conversion: (a) class names also arrive via HTML strings inside JS, not only hyperscript specs — el()'s html:/class: attrs (ui.js:56-57), frag() (ui.js:75-79), and innerHTML like router.js:115 ('<div class="empty-state">...'); (b) the travels/ mini-app pages are static HTML already full of classes (e.g., travels/index.html:49-54).
- **IMPRECISE** — Design tokens live solely in assets/css/tokens.css (two [data-theme] blocks at tokens.css:63 and 98) with dark surfaces #03071c/#060c26/#0a1330/#0f1a3d/#17234f/#1f2d5e (tokens.css:64-69), light surfaces #e8edf6/#dde5f1/#ffffff/#f6f8fd/#eef2f9/#e5ebf6 (tokens.css:99-104), and brand values --gold:#1A43BF (a blue, despite the name), --epal-abyss:#00072D through --epal-soft:#7E9AE8 (tokens.css:22-31).
  - correction: 'Solely' is wrong; every cited value and line is exact. Confirmed: theme blocks at tokens.css:63 (':root, [data-theme="dark"]') and :98 ('[data-theme="light"]'); all six dark surface hexes (64-69), all six light surface hexes (99-104), --gold:#1A43BF at :22 (a blue), --epal-abyss:#00072D (:26) through --epal-soft:#7E9AE8 (:31). BUT tokens are not solely in tokens.css: deepcore.css:10-15 declares a second :root defining --epal-navy:#1B2A4A, --epal-navy-2:#24365c, --epal-gold:#1A43BF, --epal-gold-soft:#7E9AE8 (its --epal-navy overrides tokens.css:27 app-wide); interior-scene.css defines scoped theme tokens (--ink/--ink-soft/--line/--warm/--warm-2/--glass/--master on .iscene at interior-scene.css:35-58, with a [data-theme="light"] variant at 49-58); travels-scene.css defines analogous scoped vars; and the travels/ mini-app has its own travels/assets/theme.css (e.g., --line at theme.css:24). A re-skin by editing tokens.css alone would not reach the deepcore document navy or the scene palettes.
- **CONFIRMED** — Theming end-to-end: index.html:2 ships data-theme="dark" on <html>; App.applyTheme/toggleTheme set document.documentElement's data-theme and persist via EPAL.store (assets/js/kernel/app.js:77-87), whose 'epal.v1.' namespace (assets/js/data/state.js:54) makes the localStorage key epal.v1.ui.theme.
- **CONFIRMED** — The per-company accent is injected at runtime, not statically: router.js:108 runs mount.style.setProperty('--accent', company.accent) on every route, with accents defined in config.js:237-257 and mirrored as [data-co] helper classes in tokens.css:132-137.
- **CONFIRMED** — deepcore.css declares a second :root that overrides tokens.css's --epal-navy from #051650 to #1B2A4A app-wide because it loads later (assets/css/deepcore.css:10-15 vs assets/css/tokens.css:27; load order index.html:54,58) — pixel parity depends on the #1B2A4A value.
- **IMPRECISE** — deepcore.css consumes var(--panel), var(--line) and var(--panel-2) which no main-app stylesheet defines (deepcore.css:22, 116, 127, 165), so those declarations are currently invalid-at-computed-value in the ERP shell.
  - correction: The conclusion is right; the 'no main-app stylesheet defines' detail is not literally true for --line. Confirmed consumption: var(--line) at deepcore.css:22 (also :30, :33, :36, :116, :124, :127, :139, :154, :165), var(--panel) at :23, :116, :127, and var(--panel-2, var(--panel)) at :165 (the fallback is itself undefined, so it still fails). --panel and --panel-2 are defined nowhere in the repo (grep: only usages, deepcore.css:7,23,116,127,165). BUT --line IS defined by a stylesheet index.html loads: interior-scene.css:43 (on .iscene) and :53 (on [data-theme="light"] .iscene) — plus travels/assets/theme.css:24, which the main shell never loads. Because deepcore's consumers (.items-row, .brief-exc, .appr-card, .cmt-bubble) render inside #view and are never descendants of the .iscene background layer, those scoped definitions never reach them, so the practical effect stands: in the ERP shell these declarations are invalid at computed-value time (border/background fall back to unset). Precise version: '--panel/--panel-2 are undefined anywhere; --line is only defined scoped to .iscene (interior-scene.css:43,53) and in the separate travels mini-app theme, none of which cascade to deepcore's selectors.'
- **CONFIRMED** — atmosphere.css is the hardest file to Tailwind: #view::before is masked by a --atmos custom property holding inline SVG data-URIs, selected by [data-atmos]/[data-module] attribute rules (atmosphere.css:40-102) that app.js stamps on the router mount in onRoute (assets/js/kernel/app.js:199-200).
- **CONFIRMED** — The two ambient scene stylesheets are effectively unconvertible to utilities: travels-scene.css has 11 @keyframes, 29 color-mix() calls and per-element delays via calc(var(--i)*-.37s) (travels-scene.css:139-150) plus 6 SMIL elements in travels-scene.js; interior-scene.css drives phases from a JS-written scroll var --p through clamp()/calc() expressions (interior-scene.css:39, 111-115) with 13 @keyframes.
- **CONFIRMED** — The travels/ mini-app already uses Tailwind Play CDN on all four pages with an inline config extending colors {navy:{900:'#070b14',800:'#0b1220',700:'#111a2e',600:'#1B2A4A'}, brand:'#1A43BF', brandsoft:'#7E9AE8'} and Inter/Sora/JetBrains Mono font families (travels/index.html:25-39; air-ticketing.html:18-23; flight-search.html:18-19; packages.html:16-17).
- **CONFIRMED** — Fonts are Google-Fonts-loaded Inter, Sora, Plus Jakarta Sans and JetBrains Mono (index.html:47) mapped to --font-sans/--font-display/--font-mono (tokens.css:17-19), plus the Bootstrap Icons 1.11.3 icon font from jsDelivr (index.html:51) which is even used as a pseudo-element glyph (components.css:139).
- **IMPRECISE** — All main-app persistence is one shared localStorage dataset under prefix 'epal.v1.' with company membership as a field on records, not per-company partitions (state.js:54; database.js:14-24).
  - correction: The single namespace part is right: NS='epal.v1.' (assets/js/data/state.js:54), every main-app read/write goes through EPAL.store (auth session via S.set, assets/js/kernel/auth.js:66; even Settings backup/restore filters to NS keys, assets/js/views/group/settings.js:39-41,739-743), and there is no per-company localStorage namespace. But 'company membership as a field on records, not per-company partitions' only holds for the cross-company stores (financials/employees/leads/sales/banks/acc_entries/acc_schedules/gl_entries carry companyId; customers carry companyIds[], database.js:14-24). A large share of stores are company-scoped BY STORE NAME with no companyId on rows: the deep per-company stores tv_*, wa_*, it_*, sh_*, cn_* (assets/js/data/seed-bd.js:22-27; e.g. the tv_tickets factory at seed-bd.js:152-161 has no companyId — grep shows companyId appears only in banks/acc_entries/acc_schedules/sales), and the Travels-exemplar core stores visaCats/visaApps/airlines/airports/airTickets/airRefunds/airBsp/vendors (database.js:229-391 — no companyId field; implicitly travels-scoped). Tasks are additionally partitioned per EMPLOYEE under key 'tasks.<empId>' (database.js:420,457). A migration that assumes a companyId column on every table will be wrong for all of these.
- **CONFIRMED** — Seeding runs on every boot as step 1 of app.init(): EPAL.db.seed() -> EPAL.seedBD() -> EPAL.seedEngines(), all idempotent via seedOnce/gen-if-absent and deterministic PRNGs (app.js:53; database.js:406-428; seed-bd.js:76-80).
- **CONFIRMED** — Group Command Center KPIs: Group Revenue/Net Profit/Blended Margin = sums over db.series() sliced to the selected window, Workforce = db.employees().length (all rows incl. the group owner), Pipeline = sum of lead.value for stages Qualified/Proposal/Negotiation (dashboard.js:33-42,76-93; database.js:463-522).
- **CONFIRMED** — db.postSale() is the only write-time rollup: appends to 'sales', mutates the company's LATEST existing financials row (revenue+=amount, expense+=cost), emits sale:recorded which the ledger engine auto-posts idempotently (DR 1200/CR 4000 [+ DR 5000/CR 2000]) via keys GL-S<id>/ref (database.js:543-568; ledger.js:651-680).
- **CONFIRMED** — The double-entry engine keeps ONE journal ('gl_entries') and ONE chart of accounts ('coa') for all companies; each entry carries a companyId field and per-company books/trial balances are read-time filters (ledger.js:81-106,170,221-257).
- **CONFIRMED** — Consolidation is computed on read: consolidatedTrialBalance() nets each account per company then zeroes accounts flagged intercompany (1300/2400) into an elimination column; no group aggregates are ever stored (ledger.js:264-297; intel.js:20-27).
- **IMPRECISE** — Consolidated Finance mixes three sources: 'financials' via db.finance/db.series for Overview/P&L/Cashflow, EPAL.ledger for CoA/Journal/Trial-Balance/Consolidation/BalanceSheet/AR-AP aging, and acc_schedules/banks only as fallback when the ledger is absent (finance.js:157,164-171,254,399,500,981,1091).
  - correction: The three-source mix and every cited line verify: Overview db.finance(null,12) (views/group/finance.js:157), ledger aging with acc_schedules fallback (164-171), P&L db.series (254), Cashflow db.series (331), BalanceSheet ledger-first (399, fallback banks+schedules 400-405), AR/AP aging ledger-first (500), CoA (791), Journal (844), Trial Balance (981), Consolidation (1091). But 'banks only as fallback' is wrong: the 'banks' store is ALWAYS the cash source regardless of ledger presence — the Overview 'Cash in Banks' KPI reads bankTotal() = db.col('banks') (finance.js:96-98,159,199) and the entire Banks subview (group/finance/banks) reads db.col('banks') unconditionally (finance.js:627-630); cash is never derived from ledger account 1010 in this view. Only acc_schedules is a pure ledger-absent fallback (Overview AR/AP KPIs, aging desks, management balance sheet).
- **IMPRECISE** — 'financials' summaries and 'gl_entries' are two parallel books that intentionally do NOT reconcile: ledger seed backfills from the 40 seeded 'sales' rows plus ~6%/month expenses, while financials revenue/expense come from an independent scale/margin/growth model (ledger.js:553-608; database.js:119-136).
  - correction: Right idea — the books are parallel and never numerically reconcile: financials come from the SCALE/MARGIN/GROWTH monthly model (database.js:119-136), while ledger P&L comes from posted entries; the only linkage is the docs' assertion that seeded sales are 'already reflected inside' financials (database.js:53-55). But the GL-seed enumeration is incomplete and one detail is off: buildGlSeed (ledger.js:561-629) posts (1) one balanced entry per seeded sale — 40 rows from gen('sales',40,...) (seed-bd.js:141-149) — at ledger.js:564-566; (2) OPENING BALANCES: DR 1010 Bank / CR 3000 Owner Equity for every positive bank balance, dated 2025-07-01 (ledger.js:568-581); (3) monthly operating expenses for only THREE months (2026-04-28/05-28/06-28, ledger.js:556), each month sized at ~6% of the company's TOTAL seeded sales revenue split 3.6%/1.5%/0.9% across 5100/5200/5300 (ledger.js:557-559,583-608) — not 6% of that month's revenue; and (4) four hard-coded intercompany pairs (GL-ICS/GL-ICB, ₹0.85M+1.25M+0.18M+0.32M) adding 4000-revenue to sellers and 5000-expense to buyers (ledger.js:610-626). So ledger revenue = seeded sales + IC revenue, and the balance sheet includes bank opening equity — a parity migration reproducing only 'sales + 6% expenses' would get both statements wrong.
- **CONFIRMED** — groupSnapshot() and consolidatedTrialBalance() include only enabled companies, but finance(null)/series(null) sum ALL financials rows regardless of module toggles — an asymmetry the migration must reproduce (database.js:504 vs 464-483; ledger.js:265-267).
- **CONFIRMED** — The travels/ mini-app (travels/assets/core.js) is a completely separate data world: own 'epalTravels.' namespace, own store/seed run at script load, exports window.TV, and its bookings/payments never reach EPAL.db, financials, sales, or the ledger (travels/assets/core.js:31,34-46,114-121,202-203).
- **CONFIRMED** — Engine lifecycle is two-phase: EPAL.seedEngines() runs at the end of db.seed (database.js:427) and EPAL.bootEngines() runs after router.start() (app.js:63-64), with per-engine try/catch isolation and late-registration replay (engines.js:56-79).
- **IMPRECISE** — The ONLY recurring scheduler in the system is rules.js boot: tick() once then setInterval(EPAL.automation.tick, 60000), each rule deduped to fire at most once per frozen demo-day 2026-07-05 (rules.js:457-460, 370-374).
  - correction: The rules.js facts are exact: boot() runs tick() once in try/catch then setInterval(function(){EPAL.automation.tick();},60000) (rules.js:457-460); isDue() gates every rule to lastFired !== '2026-07-05' (rules.js:370-374, DEMO_DAY at 66; note runRule stamps lastFired on EVERY run even with 0 matches, rules.js:275, so each rule RUNS at most once per demo-day). But it is not the only recurring timer: tasks/board.js:84-88 registers `self._ticker = setInterval(..., 1000)` — a 1-second live phase-timer display ticker while the task-board view is mounted, cleared in teardown (board.js:90). Precise version: rules.js boot is the only app-lifetime, business-logic scheduler; board.js adds a view-scoped recurring UI ticker.
- **IMPRECISE** — ledger.js owns coa + gl_entries as ONE shared store partitioned by a companyId field; every query scans S.list('gl_entries') and consolidation eliminates intercompany accounts 1300/2400 only when both sides of a pair are present (ledger.js:70-71, 202-213, 283-292).
  - correction: Two-thirds holds: COA_KEY='coa'/GL_KEY='gl_entries' (ledger.js:70-71); gl_entries is one shared journal whose entries carry companyId (170) and every read path full-scans S.list(GL_KEY) — entries() 202, accountTotals() 224, runningRows() 324, runningRowsForParty() 363, aging() 394. Two corrections: (1) coa is NOT company-partitioned — account rows have no companyId (withNormal, 111-115; STANDARD_COA 81-106), it is a single group-wide chart; only gl_entries partitions by companyId. (2) The pair condition is FALSE: consolidatedTrialBalance eliminates UNCONDITIONALLY — for any account flagged intercompany (1300 at 86, 2400 at 92) it moves the summed per-company net into the elimination column and forces groupNet=0 with no check that both sides of a pair exist (`if (acc.intercompany) { elim = -summed; groupNet = 0; }`, ledger.js:285-288). Pairing exists only at POSTING time (postIntercompany creates mirrored entries, 305-321); a one-sided intercompany posting is still fully eliminated at group level. A migration implementing pair-matched elimination would NOT be pixel-parity.
- **CONFIRMED** — ledger.post() throws on imbalance >0.5 and boot auto-posts every sale:recorded event idempotently via ref/GL-S<id> dedup keys (ledger.js:163-165, 641-679).
- **CONFIRMED** — serial.js reconciles its counter store from the shared documents store on first read so runtime serials continue past seeded fixed serials — moving a company's documents to its own store would let next() reissue duplicate serials after db.reset (serial.js:78-93, documents.js:377-382).
- **IMPRECISE** — audit.js audits only stores whitelisted in its hardcoded LABELS map (mixing group and travels-specific store names) and caps the group-wide log at 500 rows, so any store rename silently stops auditing and busy companies evict others' history (audit.js:60-67, 92-97, 240-241).
  - correction: Right idea, one scope error. Confirmed: LABELS at audit.js:60-67 mixes travels-specific stores (visaApps, visaCats, airTickets, airlines, airports, airRefunds) with group-wide ones (employees, customers, leads, sales, tasks, approvals, documents, comments...); the data:changed listener drops any store not in LABELS with no warning (240-241: `var label = LABELS[p.store]; if (!label) return;`); CAP=500 (53) enforced by capStore() sorting by timestamp across the single group-wide audit_log store (92-97), so one busy company evicts others' oldest rows. Imprecision: 'audits ONLY whitelisted stores' is true only for the automatic data:changed path — explicit EPAL.audit.record() calls bypass LABELS entirely (ledger posts gl_entries rows, ledger.js:183-188; rules.js:283-289 and 358-362; approvals.js:134-139 and 192-199), and audit.js itself records login/auth events (227-234, 286-294). So a store rename silently stops the AUTOMATIC audit for that store; explicit audit calls keep working. Also note the other verticals' operational stores (tv_files, tv_agents, sh_products, cn_*, wa_*, it_*) were never in LABELS and are not auto-audited today.
- **CONFIRMED** — rules.js and intel.js hardcode company-specific store names and company id lists inside their logic (sh_products, tv_files, tv_contract_flights, tv_agents, cn_equipment, wa_projects, it_subscriptions; companies array at intel.js:331), so per-company data moves silently zero their triggers/analytics (rules.js:123-237, intel.js:455-505).
- **CONFIRMED** — documents.js (EPAL.doc) is the widest-consumed engine — all five company verticals plus group views raise branded docs through it, drawing serials via EPAL.serial.next with a fixed type→prefix map (documents.js:60-63, 299-303; e.g. shop/pos.js:355, it/projects.js:520, construction/projects.js:569).
- **WRONG** — Engine→kernel coupling flows through exactly four seams: EPAL.store (all engines), EPAL.bus events (data:changed, sale:recorded, ledger:posted, approval:*, audit:logged, permissions:changed), EPAL.db helpers (notify, save, saveTask, employee(s), sales, tasksFor), and EPAL.auth.current/isAdmin/role (approvals.js:125-140, rules.js:303-355, comments.js:179-189, permissions.js:220-236).
  - correction: The four named seams are real and the cited lines check out (approvals.js:125-140 = db.notify + audit.record + bus.emit; rules.js:303-314 db.notify/db.saveTask; comments.js:179-189 db.notify + bus.emit; permissions.js:223/225/235 auth.isAdmin/role/can), but 'exactly four' is false. Missing kernel seams: (5) EPAL.ui (kernel/ui.js) — used by nearly every engine for DOM/formatting/ids: documents.js:54 with ui.el/ui.money/ui.modal/ui.toast/ui.escapeHtml/ui.uid throughout (e.g. 126-222, 326, 344-353), comments.js:56 with ui.el/icon/toast/colorFor/initials/ago/uid (117-141, 165, 197-233), approvals.js EPAL.ui.uid:108 + EPAL.ui.money:295-319, audit.js EPAL.ui.uid:105, rules.js EPAL.ui.money:80, intel.js:54/61-62; (6) EPAL.config (kernel/config.js) — ledger.js:265 config.companies, rules.js:82 config.company, intel.js:304, documents.js:65 config.group, serial.js:53 config.group (fiscalYearStart), search.js:72/80. The bus-event list is also incomplete: audit.js:286 SUBSCRIBES 'auth:changed', ledger.js:319 EMITS 'intercompany:posted', and comments widgets subscribe data:changed with self-unsubscribe (comments.js:241-247). There is additionally engine→engine coupling not via kernel: ledger/rules/approvals → EPAL.audit.record, documents → EPAL.serial.next, intel → EPAL.ledger.aging / EPAL.approvals.pending (intel.js:415, 539, 598).
- **IMPRECISE** — permissions.js grant keys embed company ids ('travels/air-ticketing') and can() FAILS OPEN with only delete/approve hard-enforced, so renaming or splitting a company silently loosens security instead of erroring (permissions.js:141-154, 217-249).
  - correction: Mechanics confirmed: grant keys literally embed company ids ('travels/air-ticketing' at permissions.js:128, whole agent block 127-131; 'group/finance' 90, 'group/employees' 105); lookupGrant most-specific-first with wildcards (141-154); can() wraps everything in try/catch returning true on any error (246-249), DESTRUCTIVE=['delete','approve'] only (55), hard deny at 241, create/edit/export always advisory-allow for non-admins (242-245), view falls back to auth.can (234-237). But 'silently loosens security' is directionally wrong. After a company id rename/split, unmatched grants make the ONLY hard-enforced actions (delete/approve) return false — a hard DENY, i.e. TIGHTENING (241); create/edit/export are unaffected because they are allowed with or without a grant (245); view defers to auth.can, which home-company-scopes non-admins (auth.js:116-117) and would typically also deny. Precise version: renaming/splitting a company silently breaks fine-grained grant matching with no error or warning — over-restricting delete/approve for roles whose grants named the old id, while the engine's baseline fail-open posture (create/edit/export always allowed, errors swallowed) is constant and not triggered by the rename. Nothing errors, but nothing previously denied becomes allowed.
- **IMPRECISE** — The entire registry is a plain object plus a one-line helper: EPAL.view = function (key, def) { EPAL.views[key] = def; return def; } (assets/js/views/registry.js:21-24), with keys formatted 'company/module' or wildcard '*/module'.
  - correction: The mechanics and quote are exact: EPAL.views init at assets/js/views/registry.js:21 and the helper verbatim at registry.js:24. But the key-format statement is incomplete: the same helper also registers the sentinel key '__placeholder__' (registry.js:47), which is neither 'company/module' nor '*/module'; and the router additionally probes three-segment 'company/module/sub' keys (router.js:67) — a supported format that simply has no registrants today. Precise version: keys are 'co/mod', '*/mod', the special '__placeholder__', with 'co/mod/sub' supported by resolution but unused.
- **CONFIRMED** — Router fallback chain is exact 'co/mod/sub' -> 'co/mod' -> '*/mod' -> __placeholder__ scaffold, first hit wins (assets/js/kernel/router.js:65-71 and :105), preceded by enabled and permission gates (router.js:97-102).
- **IMPRECISE** — No registered key anywhere contains a sub segment, so every sub-menu route resolves to the module-level view which dispatches internally on ctx.subId (air-ticketing.js:137 and 154-156; visa-processing.js:145-147; company-modules.js:107 and 122-128).
  - correction: First half CONFIRMED: an exhaustive grep of every EPAL.view( call in the repo shows all registered keys are two-segment ('co/mod' or '*/mod') plus '__placeholder__'; the only other registration path (kit/entity.js:178 via spec.route) has zero callers. All four dispatch citations verified (air-ticketing.js:137 'var sub = ctx.subId || "overview"' and dispatch map at 154-156; visa-processing.js:145-147; company-modules.js:107 and pills at 122-128). But 'every sub-menu route resolves to the module-level view' is over-broad: sub routes under the 20 modules with NO registered view (e.g. travels/file-management/files, travels/passport-mgmt/holders, shop/products/catalog) resolve to the '__placeholder__' scaffold, which renders its own sub-focused workspace (registry.js:53-68), not a module-level view. Precise version: every sub route resolves to either the module-level view (which branches on ctx.subId) or the placeholder's sub scaffold — never to a sub-specific registered key.
- **IMPRECISE** — Of 97 config-declared modules, 31 have bespoke company-specific views, 46 are served by 11 wildcard '*/mod' shared screens in views/shared/company-modules.js and company-dashboard.js, and 20 fall to the placeholder scaffold (scaffold at registry.js:47-95).
  - correction: All four numbers verified by full recount against assets/js/kernel/config.js: 97 modules total (group 16 + travels 18 + woodart 16 + it 15 + shop 15 + construction 17); 31 bespoke (group 16, travels 6, it 3, woodart 2, shop 2, construction 2); 46 wildcard-served (travels 9, woodart 10, it 10, shop 9, construction 8); 20 placeholder (travels 3, woodart 4, it 2, shop 4, construction 7). Scaffold registration is exactly registry.js:47-95. The wrong detail is the file attribution: the 11 wildcard keys are NOT all in views/shared/ — '*/tasks' is registered in views/tasks/board.js:628, so the 5 company 'tasks' modules (of the 46) are served from board.js. views/shared/company-modules.js holds 9 wildcard keys (*/hrm:62, */accounts:105, */ledgers:369, */reports:738, */analytics:829, */customers:944, */clients:945 — those two share one customersView render — */crm:954, */settings:1111) and company-dashboard.js:45 holds */dashboard.
- **IMPRECISE** — Group is the only company with 100% bespoke coverage (16/16), and five of its views (dashboard, crm, reports, analytics, settings) shadow wildcard equivalents via the specificity rule (e.g. group/settings.js:566 vs company-modules.js:1111).
  - correction: 16/16 bespoke for group is confirmed (all 16 GROUP_MODULES ids in config.js:71-96 have a matching 'group/<id>' registration), group is indeed the only such company, and both cited lines are exact (settings.js:566 registers 'group/settings'; company-modules.js:1111 registers '*/settings'). But the count is six, not five: 'group/tasks' (board.js:627) also shadows '*/tasks' (board.js:628) via the same specificity rule — and meaningfully so, since boardView(true) enables admin oversight while the wildcard gets boardView(false). (Note also travels/dashboard shadows */dashboard, though that doesn't affect the 'only-100%-company' statement.)
- **CONFIRMED** — tasks/board.js shares one closure-parameterised factory across all companies by double registration — EPAL.view('group/tasks', boardView(true)) and EPAL.view('*/tasks', boardView(false)) (board.js:627-628) — while admin/* files register only group-scoped keys 'group/module-manager' (module-manager.js:20) and 'group/employees' (employees.js:775), proving registration strings are fully decoupled from folder paths.
- **CONFIRMED** — Menus are generated from config.js alone: the sidebar rebuilds from company.modules filtered by enablement and role (app.js:220-226), with sub-links '#/co/mod/sub' built at app.js:284-289, so adding a config node makes nav plus scaffolded route live with no view file (config.js:8-9).
- **CONFIRMED** — The EPAL.entity CRUD factory registers views via EPAL.view(spec.route, view) (kit/entity.js:50, :178) but has zero production callers — the only usage is a docs example (docs/CONTRACT.md:44).
- **CONFIRMED** — The travels/ folder is a fully disconnected Tailwind+Alpine multi-page prototype: its own localStorage namespace 'epalTravels.' (travels/assets/core.js:31) vs the SPA's 'epal.v1.' (assets/js/data/state.js:54), with no hyperlinks or shared data in either direction, and a dead link to a non-existent visa-processing.html (travels/index.html:77).
- **CONFIRMED** — Atmosphere scenes are already folder-decoupled per vertical: app.js stamps data-atmos={companyId} and data-module={moduleId} on #view every route change (app.js:196-201), and each scene pair self-binds via MutationObserver on that attribute (travels-scene.js:295-297, interior-scene.js:334-342), documented as a copy-the-pair recipe in assets/atmosphere/README.md:19-44.
- **CONFIRMED** — There is no build tooling at all: no package.json, no node_modules, no .github/ directory or workflow files anywhere in the repo, and the no-build constraint is an owner directive recorded at CLAUDE.md:35-39 and index.html:31-35.
- **CONFIRMED** — The site deploys to GitHub Pages from branch main of https://github.com/imran-me/modularerp.git via GitHub's automatic branch deploy, with a zero-byte root .nojekyll added specifically because the Pages deploy step was failing without it (CHANGELOG.md:29-30).
- **CONFIRMED** — index.html is the sole load manifest — 9 relative <link> tags (index.html:54-63) and 55 relative <script> tags (index.html:84-156) whose order is the declared dependency graph (index.html:31-32) — so moving files into companies/<x>/ breaks nothing except these tags, all of which must be rewritten in order.
- **CONFIRMED** — No JS or CSS references a filesystem path at runtime: every 'assets/' string in JS is a banner comment (e.g. assets/js/kernel/config.js:2), and every CSS url() is an inline data: URI (assets/css/atmosphere.css:101, assets/css/base.css:91).
- **CONFIRMED** — The app performs zero dynamic resource loading — no fetch/XHR/dynamic import/script injection anywhere (only blank window.open print flows at assets/js/views/tasks/board.js:608 and assets/js/engines/documents.js:274) — so the planned module.json fetch-probe discovery would be the app's first runtime fetch and would break the documented file:// support (docs/ARCHITECTURE.md:9-10, README.md:34-35).
- **CONFIRMED** — docs/ARCHITECTURE.md:5 ('generated from kernel/config.js') and docs/MODULE-SYSTEM.md:5,85-93 (hand-edited registry in config.js) directly conflict with the target auto-discovery architecture (EPAL_GROUP_ERP_Modular_Architecture.md:23,34) and need rewriting after Phases 2-3.
- **CONFIRMED** — docs/FOR-LARAVEL-DEVELOPERS.md:79-80 quotes the superseded navy #1B2A4A / gold #C9A227 palette, while the real current tokens are --gold:#1A43BF and --epal-abyss:#00072D at assets/css/tokens.css:22,26 — exactly the stale-token trap CLAUDE.md:40-43 warns Tailwind seeding against.
- **CONFIRMED** — MIGRATION_STATUS.md:21,37 cites docs/PHASE0-INVENTORY.md as delivered, but that file does not exist in docs/ (verified listing).
- **CONFIRMED** — Four working-tree files are CRLF against an LF index (assets/css/atmosphere.css, assets/js/kernel/app.js, index.html, oldprojectmap.md per git ls-files --eol) because system core.autocrlf=true and the repo has no .gitattributes and no .gitignore.
- **CONFIRMED** — The travels/ mini-app uses only relative sibling links and its own assets/ subfolder (travels/index.html:41,46,66-79), so it relocates as a unit, but every page carries a dead link to a non-existent visa-processing.html (travels/index.html:77,289; travels/flight-search.html:40; travels/air-ticketing.html:47; travels/packages.html:38).
