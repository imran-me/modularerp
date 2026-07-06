# For the Laravel / PHP Developer — how to read this codebase

This front-end **is the spec**. It is a working, no-build vanilla HTML/CSS/JS app, but it
was written so you can read it and rebuild it faithfully in **Laravel + Blade + Bootstrap**.
Nothing here is throwaway — the folder layout, the data shapes, and the business rules are
the requirements. This document is your map.

> Golden rule when porting: **preserve every feature, option, and screen.** The behaviour in
> this app is the acceptance criteria.

---

## 1. The layer map (folder → Laravel concept)

```
assets/js/
  kernel/   → app bootstrap, routing, shell        ⇒ routes/web.php, middleware, AppServiceProvider, the Blade layout
  data/     → persistence + seeded domain data      ⇒ Eloquent Models + Migrations + Seeders   (THE backend seam)
  engines/  → business logic services               ⇒ app/Services/* (+ policies, jobs, events)
  kit/      → reusable UI building blocks            ⇒ Blade components + FormRequests + a resource Controller pattern
  views/    → one file per screen                    ⇒ Blade views + Controllers (one per module)
assets/css/ → bespoke premium theme (navy/gold)      ⇒ your compiled theme on top of Bootstrap
docs/       → the written spec (read these)
```

Everything hangs off one global object, `window.EPAL`, assembled at load time in the order
listed in `index.html`. That order is the dependency graph.

## 2. Where the data lives (this becomes your database)

All state is in `localStorage` behind one wrapper, `assets/js/data/state.js`
(`EPAL.store`). Collections are arrays of `{id, ...}` under namespaced keys. The complete
list of stores, every field, and every relation is in **`docs/DATA_MODEL.md`** — treat that
as your migration checklist. `assets/js/data/database.js` (`EPAL.db`) is the query+mutation
layer (your repositories/Eloquent), and `assets/js/data/seed-bd.js` is the seed data
(your `DatabaseSeeder`).

**The one seam that matters:** the entire app talks to data only through `EPAL.store`,
`EPAL.db`, and the engines. Swap those three for API/Eloquent calls and nothing else changes.
See **`docs/MIGRATION_ROADMAP.md`** for the phased plan and suggested schema/DDL.

## 3. The business-logic engines (this becomes app/Services)

Each file in `assets/js/engines/` is a self-contained service with a documented public API
(see each file's banner and **`docs/DEEP-CORE-CONTRACT.md`**). The ones that carry real
accounting/compliance weight — port these carefully and enforce them **server-side**:

| Engine | What it enforces | Laravel port |
|---|---|---|
| `ledger.js` | **Double-entry**: every posting balances (Σdr=Σcr); sales auto-post; consolidation eliminates inter-company | `LedgerService` + a DB transaction per posting; `accounts`, `journal_entries`, `journal_lines` tables |
| `serial.js` | **Gapless** document numbers per type/fiscal-year | a `serials` table + `SELECT … FOR UPDATE` in a transaction |
| `audit.js` | **Append-only** trail of every create/edit/delete/login/approve | an `audit_log` table (no update/delete grants) + a global model observer |
| `approvals.js` | **Maker ≠ checker**; amount-banded matrix; mandatory reject reason | an `ApprovalService` + policy; `approvals`, `approval_steps`, `approval_matrix` |
| `permissions.js` | Action-level (view/create/edit/delete/export/approve) role grants | Gates/Policies + a `role_templates` table |
| `rules.js` | Automation: reminders, 48h escalation, recurring generation | scheduled Artisan commands + queued jobs |
| `documents.js` | Branded (navy/gold) printable invoices/receipts/vouchers/slips | Blade PDF templates (e.g. dompdf) + a `documents` table |
| `intel.js` | Read-model analytics (MD briefing, RFM, anomalies) | query services / DB views (no writes) |
| `comments.js` | `@mention` threads on any entity | a polymorphic `comments` table |
| `search.js` | Global search across records | a search query service (or Scout) |

**Server-side non-negotiables:** transactional double-entry posting, gapless serials,
append-only audit, maker-checker enforcement, and per-company data isolation (`company_id`
on every table + row scoping). The client mirrors these; the server must own them.

## 4. The screens (this becomes Controllers + Blade views)

`assets/js/views/<company>/<module>.js` = one screen. Each registers itself under a route key
`company/module[/sub]` and renders into the page. The route shape `#/<company>/<module>/<sub>`
maps straight to your `web.php` routes and a Controller per module. Sub-routes (the pills/tabs
inside a module) are the Controller's methods/tabs.

The **module registry** in `assets/js/kernel/config.js` declares every company → module →
sub-feature, plus which are admin-only and which carry badges. It also drives the sidebar,
the command palette, and the on/off **module toggles**. In Laravel this is a `config/modules.php`
(or a `modules` table) that your routes, nav, and a middleware feature-gate read from.

## 5. The look (Bootstrap + a premium theme)

The current CSS is a bespoke design system (`assets/css/*`) — navy `#1B2A4A`, platinum text,
gold `#C9A227`, Inter/Sora/JetBrains-Mono fonts. When you rebuild on **Bootstrap 5**, keep a
thin theme layer that reproduces these tokens so it stays premium (not stock Bootstrap):
override Bootstrap's CSS variables (`--bs-primary`, body bg, fonts, radius, shadows) and reuse
the component look from `assets/css/components.css` / `deepcore.css`. Bootstrap **Icons** are
already used throughout (`<i class="bi bi-…">`).

## 6. Suggested build order

1. Auth + roles + the `modules` registry + the app shell/layout (kernel).
2. Models + migrations + seeders from `docs/DATA_MODEL.md` (data).
3. The ledger + serial + audit services with server-side enforcement (engines, the risky core).
4. Module Controllers + Blade views, one company at a time, matching each screen here.
5. Approvals, documents/PDF, automation (jobs/schedule), intel, notifications, search.

Read `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, `docs/DEEP-CORE-CONTRACT.md`, and
`docs/MIGRATION_ROADMAP.md` alongside this file. Every JS file's top banner tells you what it
is, the data it owns, its rules, and its Laravel mapping.
