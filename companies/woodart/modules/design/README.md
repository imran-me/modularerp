# Woodart · Design & 3D

The **architecture & 3D phase** of a project: drawings, 3D models, their
revisions, and the client approval that closes the phase.

This is the module the root map exposed as missing. Production got a desk for
its jobs and Installation got one for its site visits, but the design phase —
the one the owner named — had nowhere to live except a kanban column. Its work,
its revision history and its approvals were simply not recorded anywhere.

## Screens

| Route | Tab | What it shows |
|---|---|---|
| `#/woodart/design` | Drawing Register | 5 KPIs, an attention banner, and every deliverable with its current revision and days-with-client |
| `#/woodart/design/approvals` | Approvals | What is sitting with the client, longest wait first — plus how many projects are design-complete |
| `#/woodart/design/load` | Design Load | Open work per designer (bars), the deliverable mix (doughnut), revisions carried |

Clicking a row opens the **drawer**: the record, its full revision trail, and
the lifecycle buttons — Issue → Client commented → Issue revision B → Approve.
Every one of those writes a trail row.

## Data it owns

| Store | Table | Endpoint |
|---|---|---|
| `wa_drawings` | `wa_drawings` | `/api/woodart/design/drawings` |
| `wa_revisions` | `wa_revisions` | `/api/woodart/design/revisions` *(read-only)* |

Both in `api.js` **HYDRATE + CONDITIONAL** — writable only once the server
confirms the tables exist (the 2026-07-27 persistence fix).

## The three rules worth knowing

**1 · `Issued` is the only state where the wait is the client's.** Draft is on
us, Commented is back with us. That is why the approval queue is exactly the
Issued set, and why Commented is deliberately excluded from it.

**2 · The trail is evidence, and the service writes it.** A status or revision
change records who moved it and when; an edit that changes neither writes no
row. `RevisionController` is **read-only on purpose** — a write endpoint would
let a client fabricate an approval that never happened.

**3 · The phase gate.** A project is design-complete only when it **has**
deliverables **and** every one is Approved. A project with **none has not
started** — which is not the same as having finished, and never counts as
complete. This is what `projects` will read when it gains its `phase` field.

## Working on it

```bash
node tools/build/build-module.mjs companies/woodart/modules/design
node tools/verify/sweep.mjs both

php artisan migrate --path=../../companies/woodart/modules/design/backend/migrations
php artisan db:seed --class="Epal\Modules\Woodart\Design\Database\Seeders\DesignSeeder"
```

## What it deliberately does NOT do

**No file storage** — the register entry and its trail, not the PDF or the DWG;
document storage is a platform concern. **It does not move the project's phase**
— it reports design completeness; `projects` owns that field, and writing to
another module's record is what the root map forbids. **It does not gate
Estimates** — blocking a quotation until design is approved is a business policy
nobody has stated.

## Read next

`companies/woodart/ROOT-MAP.md` (why this module exists) ·
`MODULE-STANDARD.md` · `NAMING-AND-TERMINOLOGY.md`.
