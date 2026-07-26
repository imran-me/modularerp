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

## Order (simplest → hardest; Travels first — deepest & already frontend-converted)

Legend: ⬜ not started · ◑ in progress · ✅ done (all 7 gates)

> NOTE on the Travels frontends: all 18 were converted to HTML+Tailwind `template.html`
> + logic-only JS in PRIOR sessions (MIGRATION_STATUS "18/18"), so the per-module
> frontend work here is a COMPLETION pass — convert any residual `el()` DOM to template
> markup + polish + prove pixel-perfect — not a ground-up rebuild. The GROUND-UP frontend
> rebuilds are the Group-cockpit modules + the 4 other companies (still legacy view.js /
> shared wildcard views).

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
| 2026-07-26 | file-management | backend 100% (tv_files 8-file slice; migrated+seeded+CRUD-tested vs MySQL, total=embassy+service derived); FE already HTML, untouched; api.js HYDRATE wired; sweep 222/222 | tinker CRUD + raw SQL + sweep | (this) |
