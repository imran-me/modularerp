# Woodart · Workshop (production) — API contract

**Version 1 · frozen 2026-07-27**

> The agreement between the frontend and the backend. Split out of
> `LARAVEL-BLUEPRINT.md` on purpose: the **frontend is built against this
> contract before any PHP exists**. Change a shape only by bumping the version.

- **Base path:** `/api/woodart/production`
- **Auth:** Sanctum bearer, applied centrally by `ModuleServiceProvider`.
- **Company scope:** every row is `company_id = 'woodart'`.
- **Implemented by:** `JobController` → `ProductionService` → `JobResource`.

---

## The record

```json
{
  "id":         "JOB-003",
  "job":        "Conference table",
  "project":    "WAP-002",
  "station":    "Assembly",
  "assignedTo": "Mahmudul Hasan",
  "status":     "Running",
  "due":        "2026-07-02",
  "created":    "2026-06-01"
}
```

| Field | Type | Rules |
|---|---|---|
| `id` | string ≤ 40 | **required**, `^[A-Za-z0-9_-]+$`. Frontend-generated (`JOB-000`). Upsert key. |
| `job` | string ≤ 160 | **required.** What is being made. |
| `project` | string ≤ 40 | optional. The project's **frontend id** (`WAP-002`), not a DB key — see invariant 1. |
| `station` | enum | **required** — `CNC` · `Cutting` · `Edge Banding` · `Assembly` · `Finishing` |
| `assignedTo` | string ≤ 160 | optional. A person's **name**, not an employee id. `""` when unset. |
| `status` | enum | **required** — `Queued` · `Running` · `Blocked` · `Done` |
| `due` | date | optional |
| `created` | date | optional; defaults to today |

Note the camelCase `assignedTo` against the column `assigned_to` — `JobResource`
is the translation seam, which is why the SPA needs no mapping layer.

---

## `GET /jobs`

Soonest due first, undated last. The endpoint `api.js` HYDRATE calls.

```json
200 → { "success": true, "count": 11, "data": [ …job… ] }
```

## `POST /jobs`

Create or update. **Upsert keyed on `id`.**

```json
Body → { id*, job*, project?, station*, assignedTo?, status*, due?, created? }
200  → { "success": true, "data": { …job… } }
422  → { "message": "…", "errors": { "station": ["…"] } }
503  → { "success": false, "message": "wa_production table not migrated yet. Run: php artisan migrate" }
```

## `DELETE /jobs/{id}`

Soft delete, **idempotent**. Deleting a job does not touch its project.

## `GET /load`

Summary plus station load, busiest first.

```json
200 → {
  "success": true,
  "today": "2026-07-05",
  "summary": { "jobs":11, "running":3, "blocked":1, "overdue":2, "done":2,
               "open":9, "attention":3, "pct":18, "crew":5, "stations":5,
               "top":"CNC" },
  "data": [ { "name":"CNC", "total":3, "open":2, "running":1,
              "blocked":1, "overdue":1, "done":1 } ]
}
```

`today` is echoed back deliberately — every overdue figure depends on it, and a
client that disagrees with the server about the date would show different KPIs
for the same data. See invariant 3.

---

## Invariants (the rules a change must not break)

1. **`project` holds the project's FRONTEND id, and `assignedTo` a NAME.**
   Neither is a database foreign key. That is how `wa_production` was already
   built and this module does not rewrite it (R2).
2. **A job whose project no longer exists is KEPT and flagged "orphan"**, never
   hidden and never deleted. It is real shop-floor history, and an orphan is a
   data problem you want to see. The API therefore does **not** validate
   `project` against the projects table — which may not even be migrated here.
3. **Dates run on a fixed DEMO CLOCK, `2026-07-05`**, so seeded data tells a
   stable story and the screenshot harness is repeatable. It is a constructor
   argument on `ProductionService`, never a hidden `now()`, and it is echoed in
   `GET /load`. When the app goes live, that default is the one line that changes.
4. **OPEN = status is not `Done`.** **OVERDUE = open AND past `due`.** A
   finished job is never overdue however late it was. One definition, in
   `Job::isOpen()` / `Job::isOverdue()`, mirrored in the frontend seam.
5. **Station load is ranked by OPEN jobs**, not total — that is what a workshop
   manager schedules around.
6. **`id` is frontend-generated and stable**; upsert on `(company_id, ext_id)`.
7. **Deletes are soft**, and re-posting a deleted code **revives** it.
8. **Every action is `Schema::hasTable`-guarded.**

## Change log

| Version | Date | Change |
|---|---|---|
| 1 | 2026-07-27 | First frozen contract. |
