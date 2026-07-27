# Woodart · Site & Install — API contract

**Version 1 · frozen 2026-07-27**

> The agreement between the frontend and the backend. Split out of
> `LARAVEL-BLUEPRINT.md`: the **frontend is built against this contract before
> any PHP exists**. Change a shape only by bumping the version.

- **Base path:** `/api/woodart/installation`
- **Auth:** Sanctum bearer, applied centrally by `ModuleServiceProvider`.
- **Company scope:** every row is `company_id = 'woodart'`.
- **Implemented by:** `InstallController` → `InstallationService` → `InstallResource`.

---

## The record

```json
{
  "id":      "INS-005",
  "project": "WAP-005",
  "site":    "Bashundhara R/A",
  "team":    "Team Bravo",
  "status":  "Snagging",
  "date":    "2026-07-01",
  "snags":   2,
  "snagList": [
    { "text": "Hinge alignment on wardrobe shutter", "done": false },
    { "text": "Skirting gap in living room",        "done": true  }
  ],
  "created": "2026-06-01"
}
```

| Field | Type | Rules |
|---|---|---|
| `id` | string ≤ 40 | **required**, `^[A-Za-z0-9_-]+$`. Frontend-generated (`INS-000`). Upsert key. |
| `site` | string ≤ 160 | **required** |
| `project` | string ≤ 40 | optional. The project's **frontend id**, not a DB key — see invariant 1. |
| `team` | string ≤ 120 | optional; `""` when unset |
| `status` | enum | **required** — `Scheduled` · `In Progress` · `Snagging` · `Handover` |
| `date` | date | optional. The site-visit date. |
| `snags` | integer ≥ 0 | The **OPEN** snag count. Always authoritative — see invariant 2. |
| `snagList` | array | optional. `[{ text, done }]`. **Omitted entirely** when the record was never itemised. |
| `created` | date | optional; defaults to today |

---

## `GET /installs`

Soonest visit first, undated last. The endpoint `api.js` HYDRATE calls.

```json
200 → { "success": true, "count": 7, "data": [ …install… ] }
```

## `POST /installs`

Create or update. **Upsert keyed on `id`.** If `snagList` is sent, `snags` is
**recomputed from it** and any number the client sent is ignored (invariant 2).

```json
Body → { id*, site*, project?, team?, status*, date?, snags?, snagList?, created? }
200  → { "success": true, "data": { …install… } }
422  → { "message": "…", "errors": { "status": ["…"] } }
503  → { "success": false, "message": "wa_installs table not migrated yet. Run: php artisan migrate" }
```

## `DELETE /installs/{id}`

Soft delete, **idempotent**. Does not touch the project.

## `GET /snags`

The handover queue — only sites with open snags, worst first.

```json
200 → { "success": true, "summary": { … }, "data": [
  { "id":"INS-002", "site":"Banani DOHS", "project":"WAP-002",
    "team":"Team Bravo", "status":"Snagging", "date":"2026-06-28", "open":3 } ] }
```

## `GET /teams`

Summary plus team load, busiest first. Echoes `today` for the same reason
Workshop does — every overdue figure depends on it.

```json
200 → {
  "success": true,
  "today": "2026-07-05",
  "summary": { "installs":7, "active":3, "handover":2, "overdue":2, "snags":5,
               "sites":2, "clean":2, "open":5, "attention":3, "teams":3,
               "allTeams":4, "rate":29, "top":"Team Bravo", "worst":"Banani DOHS" },
  "data": [ { "name":"Team Bravo", "sites":2, "open":2, "snags":5,
              "overdue":2, "handover":0 } ]
}
```

---

## Invariants (the rules a change must not break)

1. **`project` holds the project's FRONTEND id**, not a database key, and is
   **not validated** against the projects table — which may not be migrated on
   this host. An install whose project has gone is **kept and flagged
   "orphan"**, never hidden or refused: losing a real site visit because its
   parent vanished would destroy history.
2. **The snag count reads BOTH shapes, list first, and is authoritative.**
   The seeded store carries a plain number; the Projects snag modal itemises it
   into `[{text, done}]` and keeps the number in step. A record may carry
   either, so `openSnags()` counts the un-done items when a list exists and
   falls back to the number. **On write, a supplied list always RECOMPUTES the
   number** — a client sending a stale count cannot corrupt the figure the
   handover queue is ordered by. Reading only one shape would make this module
   disagree with the project drawer for exactly the records a user has touched.
3. **`snagList` is omitted from the response when empty**, so a never-itemised
   record looks exactly like the seeded frontend record.
4. **OPEN = status is not `Handover`. OVERDUE = open AND past `date`.** A
   handed-over site is never overdue however late it was.
5. **A clean handover = handed over AND zero open snags.**
6. **Dates run on a fixed DEMO CLOCK, `2026-07-05`** — a constructor argument on
   the service, never a hidden `now()`, echoed by `GET /teams`.
7. **Team load is ranked by OPEN sites**, not total.
8. **`id` is frontend-generated and stable**; upsert on `(company_id, ext_id)`;
   deletes are soft and a re-post revives.
9. **Every action is `Schema::hasTable`-guarded.**

## Change log

| Version | Date | Change |
|---|---|---|
| 1 | 2026-07-27 | First frozen contract. |
