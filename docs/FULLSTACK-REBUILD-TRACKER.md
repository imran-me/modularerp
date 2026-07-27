# FULL-STACK REBUILD — module-by-module tracker (owner directive 2026-07-26)

> **Binding owner directive (2026-07-26):** every module is taken to a TRUE 100% —
> a properly-structured **HTML5 + Tailwind** frontend (real containers/cards/markup,
> not `el()` script-building) that is **pixel-perfect** vs the current look, AND a
> real **Laravel backend** (routes · Controller · Service · Model(s) · migrations ·
> Form Requests · API Resource), built the way a developer does it. **One module is
> finished 100% — verified — before the next is touched.**
>
> **Full code backup taken first:** `../modularerp-FULLSTACK-BACKUP-2026-07-26`
> (9,442 files / 119.9 MB, incl. `.git`) in the mother folder.
>
> **Strict context rule (owner 2026-07-26):** update CONTEXT.md (+ this tracker)
> for EVERY edit. No silent changes.

## Definition of DONE (per module — all must pass before moving on)

1. **Parity baseline** — `node tools/verify/parity.mjs shoot .parity/<mod>-before <routes> both`
   (current look captured, both themes) — done for EVERY module, even backend-only ones.
2. **Frontend rebuilt** — `frontend/template.html` holds the real HTML5 markup
   (containers, cards, grids as Tailwind-classed elements); `frontend/<id>.js` is
   **behaviour only** (wire data, events, modals). Build → `view.js`.
3. **Pixel-perfect** — `parity.mjs diff .parity/before .parity/after` byte-identical
   (light byte-perfect, dark ≤ AA jitter). Screenshot → find issue → fix → repeat
   until 100%.
4. **Laravel backend** — in `companies/<co>/modules/<id>/backend/`: `routes.php`,
   `<Name>Controller.php`, a `<Name>Service`, Eloquent `Model`(s), `migrations/`,
   `FormRequest`(s), API `Resource`. Auto-discovered by `platform/backend` →
   `ModuleServiceProvider`. Follow the master-accounts controllers as the reference
   pattern. Wire `store()/destroy()` into `api.js` WRITABLE where the screen writes.
5. **Backend tested** — build all, cross-check, **test against local Laragon MySQL**
   (`php artisan serve` + real row checks, not just a 200), solve every error, re-check.
6. **Boot sweep** — `node tools/verify/sweep.mjs both` → 222/222, 0 errors, both themes.
7. **Context + push** — update CONTEXT.md + this tracker; commit small; push; verify
   `git ls-remote` == HEAD.

## ⭐ PRIORITY ORDER (owner override, 2026-07-26) — do these FIRST, full-stack, in order:
1. **group-cockpit / master-accounts** (the Group's money hub) — FE completion + finish/verify BE
2. **travels / accounts** (Travels money desk) — FE completion + build BE (currently 0 php)
3. **the rest of the Travels modules** (dashboard, ledgers, air-ticketing, visa-processing,
   vendor-agent, hrm, crm, contract-flight, contract-file, marketing, automation, reports,
   analytics, settings✓, file-management✓, passport-mgmt✓, payroll-last)
4. **then the rest** — remaining Group-cockpit modules + woodart / it / shop / construction.

Then re-sweep ALL for a final full pass. (The simplest→hardest list below still holds
WITHIN each priority band; money modules jump the queue per this override.)

## Order (within-band: simplest → hardest; Travels already frontend-converted)

Legend: ⬜ not started · ◑ in progress · ✅ done (all 7 gates)

> ⚠️ CORRECTED NOTE (2026-07-26): the prior "18/18 converted" was a STRUCTURAL split only
> (view.js → template.html + logic + parity) — it did NOT convert the DOM to markup. The
> screens are still largely built with `el()` script-DOM (e.g. master-accounts = 2,234
> lines, 279 `el()` calls, 6 template fragments). So the owner's "all HTML+Tailwind, not
> script tags" rebuild IS owed for these modules too — convert the `el()` DOM into
> `template.html` markup, pixel-perfect via the before/after loop. This is real per-module
> frontend work, not a rubber-stamp.

### Travels
| # | Module | FE rebuilt | Parity | Backend | Tested | Status |
|---|--------|-----------|--------|---------|--------|--------|
| 1 | passport-mgmt (pilot) | ✅ markup (modal→template) | ✅ pixel-identical 8/8 | ✅ 8 files | ✅ MySQL | ✅ FULL-STACK |
| 2 | settings | ◑ FE rebuild owed | ⬜ | ✅ config table | ✅ MySQL | ◑ backend only |
| 3 | file-management | ◑ FE rebuild owed | ⬜ | ✅ 8 files | ✅ MySQL | ◑ backend only |

> ⚠️ CORRECTION (owner, 2026-07-26): I initially marked #1-3 frontend ✅ "already HTML"
> and moved on — that SKIPPED the commanded frontend/UI-UX rebuild. A module is NOT done
> until BOTH sides are rebuilt: the frontend re-authored to full HTML5+Tailwind (every
> container/card/modal as markup, JS = behaviour only — no `el()` script-DOM), pixel-
> perfect via the before/after screenshot loop, AND the backend. Redoing #1-3 frontends.
| 4 | marketing | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| 5 | automation | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| 6 | reports | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| 7 | analytics | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| 8 | crm | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| 9 | passport/contract-file | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| 10 | contract-flight | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| 11 | vendor-agent | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| 12 | hrm | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| 13 | dashboard | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| 14 | ledgers | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| 15 | accounts | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| 16 | visa-processing | ⬜ | ⬜ | ◑ (3 php) | ⬜ | ⬜ |
| 17 | air-ticketing | ⬜ | ⬜ | ◑ (4 php) | ⬜ | ⬜ |
| 18 | **payroll** (biggest — shared desk ×5 co + embedded) | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |

### Group cockpit (most are NOT yet frontend-converted — bigger lift)
master-accounts (FE done, 8 php — finish backend to 100%) · employees (3 php) ·
finance · dashboard · crm · reports · analytics · companies · documents ·
automation · notifications · settings · module-manager · approvals · activity-log ·
briefing · meetings.

### Other companies (frontend not converted — currently shared wildcard views)
woodart/projects · it/projects · shop/pos · construction/projects.

## Log (one line per completed gate)
| Date | Module | Gate | Verified by | Commit |
|------|--------|------|-------------|--------|
| 2026-07-26 | — | full backup + tracker + method locked | 9442 files backed up | 702dcaf |
| 2026-07-26 | passport-mgmt | backend 100% (8-file Laravel slice, migrated+seeded+CRUD-tested vs MySQL); FE already HTML/template + read-only so pixel-identical | tinker CRUD test + raw SQL row check + sweep 222/222 | 99e5af4 |
| 2026-07-26 | settings | backend 100% (company_settings JSON table + Model/Service/Request/Controller; migrated+tested vs MySQL, shallow-merge no-clobber proven); FE already HTML/template, untouched | tinker merge test vs MySQL | 34b7d27 |
| 2026-07-26 | file-management | backend 100% (tv_files 8-file slice; migrated+seeded+CRUD-tested vs MySQL, total=embassy+service derived); FE completion owed; api.js HYDRATE wired; sweep 222/222 | tinker CRUD + raw SQL + sweep | 2a3ec78 |
| 2026-07-26 | passport-mgmt | FULL-STACK done — FE detail modal el()→template markup, parity before/after 8/8 pixel-identical; backend tested | parity diff + sweep | ab3bb11 |
| 2026-07-26 | (priority reorder) | owner: Master Accounts → Travels Accounts → rest of Travels → rest; loop mandatory each | master-accounts before-baseline shot (20) | (this) |
| 2026-07-27 | **woodart / production** | module #4 full-stack: Job Register · Workshop Board (fixed columns + proto cards) · Station Load · `api.js` seam owning open/overdue + the demo clock · 8-file slice with `$today` injected · frozen `endpoints.md` | PHP `-l` 8/8 · tw gate green · **sweep 234/234 both themes** · **backend 41/41 vs MySQL** (incl. clock-moves-overdue-moves) | (this) |
| 2026-07-27 | **woodart / procurement** | module #3 full-stack: Orders · Vendors · Spend · `api.js` seam over TWO stores · 12-file slice (2 controllers, 1 shared service) · frozen `endpoints.md`. Ledger posting NOT wired — open owner decision | PHP `-l` 12/12 · tw gate green · **sweep 231/231 both themes** · **backend 40/40 vs MySQL** | (this) |
| 2026-07-27 | **woodart / clients** | module #2 full-stack: 3 real-HTML screens · `api.js` seam owning the client→work NAME join · 9-file Laravel slice · frozen `endpoints.md` · derived seed | PHP `-l` 8/8 · tw gate green · **sweep 228/228 both themes** · **backend 37/37 vs MySQL** (both join branches) | (this) |
| 2026-07-27 | **woodart / materials** | ⭐ REFERENCE MODULE built full-stack: 3 real-HTML screens · `frontend/api.js` data seam · 9-file Laravel slice · frozen `endpoints.md` · README + context.md · all utilities Tailwind (value-exact) · api.js HYDRATE+WRITABLE wired | PHP `-l` 8/8 · tw gate green (additive 17→24 rules, none lost) · **sweep 225/225 both themes, 0 errors** · **backend 26/26 vs Laragon MySQL** | (this) |
| 2026-07-27 | woodart (company) | master context + standards locked — `companies/woodart/CONTEXT.md`, `companies/woodart/MODULE-STANDARD.md`, `platform/design-system/UI-CONTRACT.md`; `build-module.mjs` gained the optional `frontend/api.js` data seam | rebuilt all 20 modules → zero git diff; sweep 222/222 both themes | (this) |
