# Woodart · Spaces & Phases (`scope`) — module context

The per-module memory. **Append, never rewrite.**

## Purpose

The owner's brief of 2026-08-06: *"There will be option to register a new
project, where we will divide the project into subproject like Bed Room,
Kitchen, Dining Room. Each sub project will have phases — first phase is design,
then colour, then wood work, then furniture. Each phase will have option to
assign a specific person who is responsible for that phase, and what materials
will be needed in that phase."*

This module is the **hierarchy** half of that: project → space → phase → person.
The materials half (`wa_requirements`), the quotation builder and contractor
hiring are slices 2–4 of `companies/woodart/PROJECT-BREAKDOWN-PLAN.md`.

## Decisions (locked)

| # | Date | Decision | Why |
|---|---|---|---|
| S1 | 2026-08-06 | The record is a **Space** (`SPC`), not a room / sub-project / unit / package | *Space planning* is the interior industry's own term for this breakdown, and unlike "room" it does not lie about a balcony, a lobby or an open-plan zone. The owner asked for "whatever suits the standard in interior". |
| S2 | 2026-08-06 | **`wa_phases` moved down a level** — a phase belongs to a SPACE — rather than a second phase table being created next to it | It was seeded 2026-07-28 as project-level rows and read by **no screen** (grep-verified: only the seeder and the plan document mentioned it), so reshaping it cannot change a pixel. Two phase tables would have drifted the day someone wrote to one of them. The project-level view is now derived. |
| S3 | 2026-08-06 | **Project registration stays in `projects`** | Two creation paths for `wa_projects` would have to be kept in sync, and `projects` is a working legacy screen scheduled for rebuild (R2). The Spaces screen picks an existing project and links out to the New Project form. |
| S4 | 2026-08-06 | The responsible person is an **id into the group `employees` store**, read-only | HRM owns employee records. Duplicating a name here would go stale the first time somebody changed a designation. An owner whose record has gone is shown as `(orphan)`, kept, never blanked. |
| S5 | 2026-08-06 | **Phase templates are seeded data, not code** (`wa_phase_templates`, keyed by space kind) | Same principle as the cost-code list: adding "Smart Home" to the bedroom sequence is a row, not a deploy. Ten kinds seeded; the fallback list in `api.js` exists so a space can never end up with zero phases. |
| S6 | 2026-08-06 | Applying a template **appends only the missing phases** | Pressing "Apply template" twice must never wipe phases that have already been assigned or completed. Proven by `tools/verify/scope.mjs`. |
| S7 | 2026-08-06 | **Deleting a space deletes its phases** | A phase whose space is gone still counts in every roll-up while being impossible to open. Same rule the materials register applies to a deleted material's movement history. |
| S8 | 2026-08-06 | Progress = phases complete ÷ phases total, **for now** | Weighting by phase cost needs `wa_requirements` (slice 2). It is one function (`Scope.progressOf`) in one file precisely so that change lands in one place — the plan's §10 default is to weight by planned cost. |
| S9 | 2026-08-06 | The project is a **query param** (`?p=`), not a path segment | The router already parses `?` into `ctx.params`, so this needed no router change, and the three tabs keep their own sub-routes. A stale id falls back to a real project rather than rendering an empty screen. |

## State

| | |
|---|---|
| Frontend | ✅ three screens, real HTML, seam, module CSS, rebuilt `view.js` |
| Registry | ✅ `platform/core/config.js` · `companies/woodart/module.json` (`built:true`) · this folder's `module.json` · `index.html` script tag |
| Seeds | ✅ `wa_spaces`, `wa_phases` (reshaped, with an upgrade guard for browsers holding the old shape), `wa_phase_templates` |
| Verification | ✅ sweep **257/257 both themes, 0 errors** · tailwind gate green (0 new classes) · `tools/verify/scope.mjs` **20/20** |
| Backend | ⬜ **owed** — `endpoints.md` + blueprint are written and frozen; the PHP slice is slice 6 of the plan |
| Screens shot | ✅ dark + light, read against `platform/design-system/UI-CONTRACT.md` |

## Data

**Owns:** `wa_spaces` · `wa_phases` · `wa_phase_templates`
**Reads:** `wa_projects` · `wa_cost_codes` · `employees`
**Emits:** nothing. No bridge event, no ledger posting, no money of any kind.

Who else reads this module's stores today: **nobody yet**. Slice 2
(`wa_requirements`) and the quotation builder will read `wa_phases` through this
module's seam, not through `db.col`.

## Open questions

1. **The phase list per space kind** (`wa_phase_templates`) is drafted from the
   owner's sequence plus the Munshi sheet's cost heads. One review from whoever
   runs site work is worth more than any amount of guessing. *Default: as
   seeded, editable per space.*
2. **Can a space be quoted and billed on its own?** *Default: no — one estimate
   per project, grouped by space.* The builder's grouping makes per-space
   billing a later slice, not a rewrite.
3. **Should `wa_projects.stage` eventually be derived from the phases?**
   Not touched here (R2 — it drives the kanban, the billing gate and the P&L).
   Worth deciding when `projects` is rebuilt (ROOT-MAP §6 item 9).

## Decisions — slice 2 (locked)

| # | Date | Decision | Why |
|---|---|---|---|
| S10 | 2026-08-06 | **One line table, three kinds** (`material · labour · contract`) rather than three tables | The quotation builder, the material listing, the labour estimate and the cost matrix become one query with a filter, instead of four features that can disagree. Straight from the plan's §4.3. |
| S11 | 2026-08-06 | The seeded requirements are an **allocation of the BOQ**, split by room area | Σ requirements per cost code == the BOQ per code == the budget per code: one set of numbers cut three ways, so no screen can contradict another. `books.mjs story` asserts the equality. |
| S12 | 2026-08-06 | A **largest-remainder split**, never per-row rounding | 37,500 bricks across eleven rooms must still be 37,500 bricks. Rounding each share independently loses or invents material. |
| S13 | 2026-08-06 | Demand **nets off `Ordered` and `Issued`** lines | The rod on this villa was bought and poured months ago; a list still asking for 9,819 kg of it would send somebody to buy the building twice. |
| S14 | 2026-08-06 | Requirement ids are reused **positionally** when the editor saves | The platform's line-item repeater cannot round-trip an id. Minting a fresh one on every save would break the engagement → requirement link the hiring desk needs in slice 4. |
| S15 | 2026-08-06 | Progress is now **weighted by phase cost**; a phase with nothing planned weighs 1 | Counting phases treats a ৳4 lakh wood-work phase like a ৳15,000 handover, which flatters a job that has finished the cheap parts. Weight 1 keeps an unpriced phase counted instead of vanishing. |
| S16 | 2026-08-06 | `labour` keeps men × days inside the **quantity** (`unit: 'man-day'`) for now | The hiring desk that needs them as separate fields is slice 4; splitting them earlier would be a column nothing reads. |

## Log

| Date | What |
|---|---|
| 2026-08-06 | **SLICE 2 — what each phase needs.** New store `wa_requirements`: material · labour · contracted work, per phase. The phase drawer gained a line-item editor (the platform repeater, with a live cost / quote / margin footer) so the person responsible and what they need are decided in one place. New screen **Material Demand** (`#/woodart/scope/materials`) rolls every material line up per item across phases — needed, already received, in stock, still to buy — and lists labour and contracted work separately, because it is hired rather than bought. Seeded by allocating the Munshi Villa BOQ across the phases that carry each cost code (214 lines, ৳59,01,000 — the BOQ less its two project overheads), so every head still equals the quotation. Progress switched to cost-weighted; space cards and phase rows now carry planned cost. Deleting a phase takes its requirements with it; deleting a space takes both. Probe extended to **34/34**, sweep **258/258 both themes**, `books story` still reconciles to the sheet. |
| 2026-08-06 | **Module built (slice 1 of the project-breakdown plan).** Three screens: Spaces (cards + phase strip), Phase Board (a row per phase with its responsible person, status and dates), Team Load (who is carrying what, company-wide). New stores `wa_spaces` + `wa_phase_templates`; `wa_phases` reshaped to belong to a space, with a guard that upgrades a browser still holding the pre-2026-08-06 project-level rows. Seeded phases carry the REAL Woodart roster (design → Imtiaz Chowdhury, workshop → Sumaiya Akter, site → Jahangir Alam) and leave some work ahead of the current phase deliberately unassigned, because that queue is what the board exists to shrink. New probe `tools/verify/scope.mjs` drives the real seam through template → assign → derive → delete (20/20). Sweep 257/257 both themes. |
