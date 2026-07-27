# Woodart · Design & 3D — API contract

**Version 1 · frozen 2026-07-27**

- **Base path:** `/api/woodart/design` · **Auth:** Sanctum (central)
- **Company scope:** `company_id = 'woodart'`
- **Implemented by:** `DrawingController` + `RevisionController` → one shared
  `DesignService` → `DrawingResource` / `RevisionResource`

---

## The records

### Drawing — frontend `wa_drawings`

```json
{ "id":"DWG-002", "project":"WAP-001", "title":"Reception elevation",
  "kind":"Elevation", "rev":"B", "status":"Approved",
  "designer":"Nasrin Sultana", "issued":"2026-06-02",
  "approved":"2026-06-11", "created":"2026-05-14" }
```

| Field | Type | Rules |
|---|---|---|
| `id` | string ≤ 40 | **required**, `^[A-Za-z0-9_-]+$`, `DWG-000` series. Upsert key. |
| `title` | string ≤ 200 | **required** |
| `kind` | enum | **required** — `Plan` · `Elevation` · `Section` · `Detail` · `3D Model` · `Render` |
| `project` | string ≤ 40 | optional. The project's **frontend id** — not validated (inv. 1). |
| `designer` | string ≤ 160 | optional, a **name** |
| `rev` | `^[A-Z]$` | single capital letter, `A` = first issue |
| `status` | enum | **required** — `Draft` · `Issued` · `Commented` · `Approved` |
| `issued` · `approved` · `created` | date | optional |

### Revision — frontend `wa_revisions` · **read-only**

```json
{ "id":"RVN-003", "drawing":"DWG-002", "rev":"A", "action":"Revised",
  "by":"Nasrin Sultana", "note":"Client asked for a wider desk",
  "date":"2026-05-29" }
```

`action` ∈ `Drafted` · `Issued` · `Commented` · `Revised` · `Approved`.

---

## Endpoints

| Method | Path | Notes |
|---|---|---|
| `GET` | `/drawings` | most-recently-issued first, undated last. `api.js` HYDRATE. |
| `POST` | `/drawings` | upsert on `id`. Accepts an optional `note` for the trail. `503` when unmigrated. |
| `DELETE` | `/drawings/{id}` | soft delete — **takes the trail with it**. Idempotent. |
| `GET` | `/revisions` | the whole trail. **Read-only** — see invariant 3. |
| `GET` | `/drawings/{id}/revisions` | one deliverable's trail, oldest first. |
| `GET` | `/approvals` | the queue + `summary` + the echoed `today`. |
| `GET` | `/load` | `summary` · designer load · `byKind` · `projects` (the phase gate). |

`GET /drawings` and `GET /revisions` report **`provisioned: true|false`** —
`platform/data/api.js` uses it to decide both *may I write?* and *may I
overwrite the local store?* (the 2026-07-27 vanishing-data fix).

---

## Invariants

1. **`project` is the project's FRONTEND id and `designer` a NAME**, neither a
   foreign key, and `project` is **not validated** — that table may not be
   migrated here. A deliverable whose project is gone is **kept and flagged
   "orphan"**; losing real design work because its parent vanished would destroy
   history.
2. **The lifecycle is `Draft → Issued → (Commented → Issued at rev+1) →
   Approved`.** `Issued` is the **only** state where the wait belongs to the
   client — which is exactly why the approval queue *is* the Issued set, and why
   `Commented` does not appear in it (that work is back with us).
3. **The trail is EVIDENCE and is written by the service, never posted.** A
   status or revision change writes exactly one row naming who moved it and
   when; an edit that changes neither writes none. `RevisionController` is
   **read-only on purpose** — a write endpoint would let a client fabricate an
   approval that never happened, which is what an audit trail exists to prevent.
4. **THE PHASE GATE:** a project's design phase is complete only when it **has**
   deliverables **and** every one is `Approved`. A project with **none has not
   started**, which is not the same as having finished, and must never count as
   complete.
5. **Deleting a drawing deletes its trail.** Orphaned evidence is worse than
   none — it describes a record nobody can look at.
6. **Dates run on the injected demo clock `2026-07-05`** — a constructor
   argument, echoed by `GET /approvals`. Never a hidden `now()`.
7. **`id` is frontend-generated and stable**; upsert on `(company_id, ext_id)`;
   deletes are soft; a re-post revives.
8. **Every action is `Schema::hasTable`-guarded.**

## Change log

| Version | Date | Change |
|---|---|---|
| 1 | 2026-07-27 | First frozen contract. |
