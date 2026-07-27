# Woodart · Design & 3D — module context

> Module memory. Company context: `companies/woodart/CONTEXT.md`.
> Why it exists: `companies/woodart/ROOT-MAP.md` §1.

## Purpose

Module #6, and the first built from the root map rather than from the inherited
registry. The owner's answer — *"a project may have several phases, architecture
or 3D modeling is one of them"* — produced the organising principle, and the
principle immediately exposed this gap: every other delivery phase had a module
owning its work; the design phase had none.

## Decisions (locked)

| # | Date | Decision | Why |
|---|---|---|---|
| G1 | 2026-07-27 | **`Issued` is the only state where the wait is the CLIENT's** | Draft is on us; Commented came back to us. The approval queue is exactly the Issued set — including Commented would blame the client for our own backlog. |
| G2 | 2026-07-27 | **The revision trail is its own TABLE**, not a JSON blob (unlike `wa_installs.snag_list`) | A snag is a checklist item; a revision is EVIDENCE — who issued it, what was said, when it was approved. Evidence gets a row so it can be queried and never silently rewritten. |
| G3 | 2026-07-27 | **The service writes the trail; `RevisionController` is READ-ONLY** | A write endpoint would let a client fabricate an approval that never happened — exactly what an audit trail exists to prevent. |
| G4 | 2026-07-27 | **Phase gate: complete = HAS deliverables AND all Approved** | A project with none has NOT STARTED design. Treating "no work" as "finished" would let a project sail through the gate having done nothing — the most dangerous way to get this wrong, and asserted explicitly in the tests. |
| G5 | 2026-07-27 | **Deleting a drawing deletes its trail** | Orphaned evidence describes a record nobody can look at. |
| G6 | 2026-07-27 | **No file storage** | The register and the trail, not the PDF/DWG binary. Documents are a platform concern (`EPAL.doc`); a per-module uploader would fork it. |
| G7 | 2026-07-27 | **It REPORTS design completeness; it does not move the project's phase** | `projects` owns that field. Writing another module's record is what the root map forbids. |

## State

| | |
|---|---|
| Frontend | ✅ 3 real-HTML screens + a drawer showing the trail (a per-record detail view — the sanctioned place for JS DOM, UI-CONTRACT §4.2) |
| Data seam | ✅ `frontend/api.js` — owns both stores, the lifecycle, the phase gate and the demo clock |
| Styling | ✅ all utilities Tailwind; no new classes needed, gate green |
| Registered | ✅ `config.js` + company `module.json` + own `module.json` + `index.html` |
| api.js | ✅ **CONDITIONAL**, not WRITABLE — built after the persistence fix, so it never carried that bug |
| Backend | ✅ 10-file slice, 2 controllers + 1 shared service, frozen `endpoints.md` v1 |
| Backend tested | ✅ **41/41 vs real MySQL** |
| Sweep | ✅ **241/241 both themes, 0 errors** (237 → 241) |

### What the 41 assertions cover

Seeded 8 deliverables + 12 trail rows, then a probe over the service, both model
rule sets and the resource:

- shape and ordering (most-recently-issued first, never-issued last);
- **the lifecycle** — all four states classified, and specifically that
  `Commented` is open but **not** waiting on the client;
- revision arithmetic from the letter (B = 1, C = 2, next after C is D);
- **the queue** — only the Issued set, longest-wait first, 31 days measured
  against the injected clock, and 62 when the clock moves forward a month;
- **the phase gate** — a fully-approved project reads complete, one with open
  work does not, and a project with **no deliverables does not appear as
  complete at all**;
- **the trail** — a status change writes exactly one row naming the action and
  stamped with the demo clock; an edit changing neither status nor revision
  writes **none** but still saves; a revision bump records `Revised` with note;
- create/update-without-duplicate, soft delete **taking the trail with it**,
  idempotent delete, revive, orphan kept, company scoping, seeder idempotence.

## Data

- **Owns:** `wa_drawings`, `wa_revisions`.
- **Reads, never writes:** `wa_projects`, the employee directory (frontend only).
- **Seeded twice, in step:** `platform/data/seed-bd.js` (derived from real
  projects) and `DesignSeeder.php`.

## Open questions

1. **File attachments** — the most likely next request. Needs a platform
   decision on storage, not a module one.
2. **Should Estimates be gated on design approval?** Technically easy now the
   gate is computed. It is a business policy, so it is not assumed.
3. **A client portal** for real client-side approval, rather than staff
   recording it on the client's behalf.

## Log

| Date | What | Commit |
|---|---|---|
| 2026-07-27 | Built full-stack. 3 screens + a revision-trail drawer; `api.js` seam owning the lifecycle, the phase gate and the clock; 10-file Laravel slice with a read-only revision controller; frozen `endpoints.md` v1. Stores wired CONDITIONAL from the start. PHP lint clean, sweep 241/241, backend **41/41 vs MySQL**. | — |
