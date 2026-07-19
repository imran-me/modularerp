# CONTEXT.md — Epal Group ERP

> **This file is the project's long-term memory.** It exists so that any developer
> (human or AI) can resume work months later without losing the vision, the
> architecture, or the conventions. Read this first, always.

> 📌 **STANDING INSTRUCTION (owner, 2026-07-16):** keep THIS file continuously
> updated with all context + instructions, and **push it to GitHub every session**
> (it is the shareable resume doc). A private AI memory also exists at
> `C:\Users\User\.claude\projects\e--Imran-New-folder-newerp\memory\` (local, not
> pushed) — this file is the public mirror of the load-bearing parts.

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
> - **3D atmosphere** (`platform/atmosphere/ambient3d.js`, three.js): a full 3D
>   AIRFIELD — runway/taxiway/tower/terminal/hangar/skyline + take-off, landing,
>   taxi, cruise, cargo, helicopter (spinning rotors) + a re-forming **fighter-jet
>   show** — replaces the flat 2D SVG airfield, which is KEPT and toggleable at
>   **Travels ▸ Settings ▸ Data ▸ Appearance** (`ui.atmos` = `3d` | `2d` | `off`).
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
>    shows "**Setup**", tables have no bottom scrollbar, background is the 3D airfield.
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
