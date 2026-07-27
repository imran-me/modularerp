# Woodart · Clients — API contract

**Version 1 · frozen 2026-07-27**

> The agreement between the frontend and the backend. Split out of
> `LARAVEL-BLUEPRINT.md` on purpose: the **frontend is built against this
> contract before any PHP exists**, and the PHP is written to satisfy it.
> Change a shape only by bumping the version and recording what moved.

- **Base path:** `/api/woodart/clients`
- **Auth:** Sanctum bearer, applied centrally by `ModuleServiceProvider`.
- **Company scope:** every row is `company_id = 'woodart'`.
- **Money:** integer Taka. Never a float (owner decision D10).
- **Implemented by:** `ClientController` → `ClientService` → `ClientResource`.

---

## The record

Every endpoint that returns a client returns **exactly** this shape — the shape
the frontend `wa_clients` store already uses, so `api.js` hydrates with a plain
write and no JavaScript mapping layer can drift.

```json
{
  "id":      "CLI-004",
  "name":    "Bashundhara Group",
  "type":    "Developer",
  "contact": "Farzana Yasmin",
  "phone":   "+8801712000004",
  "email":   "bashundhara.group@corp.example.bd",
  "area":    "Bashundhara R/A",
  "since":   "2023-06-24",
  "created": "2026-05-14"
}
```

| Field | Type | Rules |
|---|---|---|
| `id` | string ≤ 40 | **required**, `^[A-Za-z0-9_-]+$`. Frontend-generated (`CLI-000` series). The upsert key. |
| `name` | string ≤ 160 | **required.** Also the join key to projects/estimates — see invariant 1. |
| `type` | enum | **required** — `Homeowner` · `Developer` · `Corporate` · `Retail` |
| `contact` | string ≤ 160 | optional; `""` when unset, never `null` |
| `phone` | string ≤ 40 | optional; `""` when unset |
| `email` | email ≤ 160 | optional; `""` when unset |
| `area` | string ≤ 120 | optional; `""` when unset |
| `since` | date `YYYY-MM-DD` | optional |
| `created` | date `YYYY-MM-DD` | optional on write; defaults to today |

---

## `GET /directory`

The whole directory, A→Z by name. This is the endpoint `api.js` HYDRATE calls.

```json
200 → { "success": true, "count": 10, "data": [ …client… ] }
```

Before `php artisan migrate`, returns an empty list rather than an error.

## `POST /directory`

Create or update. **Upsert keyed on `id`** — re-posting the same record updates
it and never duplicates.

```json
Body → { id*, name*, type*, contact?, phone?, email?, area?, since?, created? }
200  → { "success": true, "data": { …client… } }
422  → { "message": "…", "errors": { "type": ["…"] } }
503  → { "success": false, "message": "wa_clients table not migrated yet. Run: php artisan migrate" }
```

## `DELETE /directory/{id}`

Soft delete by frontend id. **Idempotent** — deleting an id that is already gone
still returns success.

```json
200 → { "success": true }
```

## `GET /portfolio`

Each client with their work rolled up, highest contract value first.

```json
200 → {
  "success": true,
  "summary": { "clients":10, "value":48200000, "cost":31300000, "margin":16900000,
               "live":6, "repeat":3, "idle":1, "segments":3,
               "avg":4820000, "top":"Bashundhara Group" },
  "data": [ { "id":"CLI-004", "name":"Bashundhara Group", "type":"Developer",
              "area":"Bashundhara R/A", "projects":3, "live":2,
              "value":12400000, "cost":8100000, "margin":4300000,
              "quotes":2, "won":1, "open":1 } ]
}
```

## `GET /segments`

Contract value by segment, largest first.

```json
200 → {
  "success": true,
  "summary": { …same as /portfolio… },
  "data": [ { "name":"Developer", "clients":4, "projects":9,
              "value":28600000, "margin":9900000 } ]
}
```

> **Note:** the SPA does not call `/portfolio` or `/segments` today — it computes
> both client-side from the hydrated stores, which is instant and works offline.
> They exist so the client→work join has one authoritative server-side
> definition, and for reports or any future client that cannot hold the whole
> project table in memory.

---

## Invariants (the rules a change must not break)

1. **Projects and estimates reference a client by NAME, not by id.** That is how
   `wa_projects` / `wa_estimates` were built and this module does not rewrite
   them (R2). The join is a name match normalised through **one** function —
   `ClientService::matchKey()` server-side, `key()` in the frontend seam. Both
   are `trim` + lowercase. Change one, change the other.
2. **A client's value is DERIVED, never stored.** There is no money column on
   `wa_clients`. Storing a total would let it drift from the projects it came
   from; recomputing cannot.
3. **`id` is frontend-generated and stable.** The server upserts on
   `(company_id, ext_id)` and never renumbers it.
4. **Every response row is already in the frontend shape.** The Resource is the
   translation seam.
5. **Deletes are soft**, and re-posting a deleted code **revives** it.
   Deleting a client does **not** delete their projects or estimates — those are
   another module's records. They simply stop matching a client.
6. **The projects/estimates tables are OPTIONAL.** `/portfolio` and `/segments`
   degrade to zero-value rows when those tables do not exist, so a partially
   migrated host serves a working directory instead of a 500.
7. **Every action is `Schema::hasTable`-guarded** — the live host pulls code
   before anyone runs migrations.
8. **`GET /directory` is ordered case-insensitively by name**, matching MySQL's
   `utf8mb4_*_ci` collation and the frontend's `localeCompare`. Do not "fix"
   this to a byte-order sort: PHP's `sort()` would disagree with both.

## Change log

| Version | Date | Change |
|---|---|---|
| 1 | 2026-07-27 | First frozen contract. |
