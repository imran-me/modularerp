# CONTEXT.md — Epal Group ERP

> **This file is the project's long-term memory.** It exists so that any developer
> (human or AI) can resume work months later without losing the vision, the
> architecture, or the conventions. Read this first, always.

> ✅ **DEEP CORE PASS COMPLETE (v0.3.0, 2026-07-06).** The double-entry ledger, audit
> trail, maker-checker approvals, branded document engine, intelligence layer (MD
> briefing/RFM/anomalies), action-level permissions, automation scheduler, comment
> threads, and global search are all built, hostile-inspected (17 defects found & fixed),
> and verified (boot sweep 184/0; dynamic invariants 24/24). Engine APIs: `docs/DEEP-CORE-CONTRACT.md`.
> Data model: `docs/DATA_MODEL.md`. Backend path: `docs/MIGRATION_ROADMAP.md`. See the
> CHANGELOG v0.3.0 entry for the full list.

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
