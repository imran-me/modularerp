# Construction — the phase model, and why it needs work orders

> **A decision recorded before the build, so it is already made when Construction
> comes up.** Owner, 2026-07-27: *"for construction, that too a phase + also
> individual work sell."*
>
> Construction has not been rebuilt yet — it still renders the shared wildcard
> view. This file exists so the shape is settled now, while the reasoning is
> fresh from designing Woodart's map.

---

## The rule Construction shares with Woodart

A project moves through **phases**, and each delivery phase has exactly one
module that owns the work records produced during it. **Architecture is one of
those phases** — the same as it is for Woodart Interiors (see
`companies/woodart/ROOT-MAP.md` §1).

So Construction gets the same spine: a phased `projects` module, with the
architecture/design phase owning its drawings, models, revisions and client
approvals rather than hiding them in a kanban column.

## Where Construction is DIFFERENT

**Architecture is also sold on its own.** A client can buy drawings, a 3D model
or a consultancy deliverable with **no build attached** — it is a complete,
billable piece of work in its own right, not a project that stopped early.

That distinction matters more than it looks:

- **Forcing standalone sales through `projects`** would put half-empty projects
  in every portfolio figure. Contract value, committed cost, margin %,
  deadline risk and stage distribution would all be computed over records that
  were never meant to have a build. The KPIs would be quietly wrong, and
  "quietly wrong" is the worst failure mode a report has.
- **A phase is not a product.** A phase belongs to a parent and only means
  something in sequence. A standalone sale has no parent and no sequence.

They are two different record types and they need two different homes.

## The shape

| Record | Module | What it is |
|---|---|---|
| **Project** | `projects` | Phased work: tender → architecture → structure → build → handover. Reports on portfolio value, progress, margin. |
| **Work order** | **`work-orders`** *(new)* | A standalone sellable unit of work — architecture, a 3D model, a survey, a consultancy deliverable. Bills on its own. No parent project. |

Both can produce drawings, so both point at the same design records; the
`design` module owns those, keyed by whichever parent raised them.

**Reporting rule:** portfolio KPIs cover **projects**. Work orders report as
**services revenue**, separately. A combined figure is a deliberate roll-up on
the dashboard, never the default — otherwise a month of small drawing sales
distorts the build portfolio's margin.

## Does Woodart need `work-orders` too?

**Not today.** Woodart sells fit-out; the architecture/3D phase is part of that
sale. If Woodart ever sells design without the build, the same module drops in
unchanged — which is the point of building it as a module rather than as a flag
on `projects`.

## What this does NOT decide

- The Construction **phase list** itself (tender · architecture · structure ·
  MEP · finishing · handover?) — that is a business question for whoever runs
  Construction, and inventing it here would be exactly the guessing this repo
  keeps refusing to do.
- Whether a work order can later be **promoted** into a project when a client
  comes back for the build. Probable, and worth asking — it is the difference
  between a link and a copy.
- The bridge mapping. `bridge.map` currently declares `tender.won` and
  `progress.billed` as revenue; a standalone work-order sale needs its own
  event rather than being squeezed into `progress.billed`.

---

**Related:** `companies/woodart/ROOT-MAP.md` (the phase model in full) ·
`companies/woodart/MODULE-STANDARD.md` (how a module is built) ·
`companies/woodart/NAMING-AND-TERMINOLOGY.md`.
