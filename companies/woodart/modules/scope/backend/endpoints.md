# Woodart · Spaces & Phases (`scope`) — API contract

**Version 1 · frozen 2026-08-06**

> This document is the agreement between the frontend and the backend. It is
> split out of `LARAVEL-BLUEPRINT.md` on purpose: the **frontend is built against
> this contract before any PHP exists**, and the PHP is written to satisfy it.
> Neither side waits for the other, and neither side may change a shape
> unilaterally — bump the version and record what moved.

- **Base path:** `/api/woodart/scope`
- **Auth:** Sanctum bearer token, applied centrally by the `/api` group — no
  route below repeats it.
- **Company scope:** every row is `company_id = 'woodart'`. The service scopes
  reads and stamps writes; a client cannot reach another company's rows.
- **No money.** Nothing in this module posts to the ledger, raises a payable or
  emits a bridge event. Amounts arrive in slice 2 (`wa_requirements`).
- **Implemented by:** `SpaceController` · `PhaseController` ·
  `PhaseTemplateController` → one shared `ScopeService` → `SpaceResource` /
  `PhaseResource`.

---

## The records

Every endpoint returns **exactly** the shape the frontend stores already use, so
`platform/data/api.js` hydrates with a plain write and no mapping layer exists in
JavaScript to drift out of sync.

### Space

```json
{
  "id":      "SPC-001",
  "project": "WAP-102",
  "name":    "Master Bed Room",
  "kind":    "Bedroom",
  "area":    320,
  "sort":    1,
  "note":    "",
  "created": "2026-07-05"
}
```

| Field | Type | Rules |
|---|---|---|
| `id` | string | `SPC-000` series, frontend-generated, stable. The server **upserts** on it. |
| `project` | string | must be an existing `wa_projects.id` of this company |
| `name` | string | required, 1–80 chars |
| `kind` | enum | `Bedroom · Kitchen · Dining · Living · Bath · Balcony · Office · Reception · Retail · Common` |
| `area` | int | square feet, ≥ 0, `0` = not measured |
| `sort` | int | ≥ 1, display order within the project |

### Phase

```json
{
  "id":      "PHS-0014",
  "project": "WAP-102",
  "space":   "SPC-001",
  "name":    "Wood Work",
  "code":    "Wood Work",
  "sort":    3,
  "status":  "Active",
  "ownerId": "EPL-0008",
  "start":   "2026-07-14",
  "finish":  "2026-07-28",
  "note":    ""
}
```

| Field | Type | Rules |
|---|---|---|
| `id` | string | `PHS-0000` series, frontend-generated, stable, upserted |
| `space` | string | required; must be a space of the same company |
| `project` | string | **derived server-side from the space** — a client-sent value that disagrees is overwritten, never trusted |
| `name` | string | required, 1–60 chars |
| `code` | string\|"" | optional; a `wa_cost_codes.id` when present |
| `status` | enum | `Not started · Active · Complete` |
| `ownerId` | string\|"" | optional; an `employees.id`. `""` = unassigned |
| `start` / `finish` | date\|null | `YYYY-MM-DD` |

---

## GET /spaces?project={id}

Every space of one project, in `sort` order.
`200 → { "data": [ { …space… } ] }`

## POST /spaces

Create or update (upsert by `id`).
`Body → { id?, project*, name*, kind*, area, sort, note }`
`201/200 → { "data": { …space… } }` · `422 → { "message", "errors" }`

## DELETE /spaces/{id}

Deletes the space **and its phases** — a phase whose space is gone still counts
in every roll-up while being impossible to open.
`204 → no content` · `404 → not found / not this company's`

## GET /phases?project={id}

Every phase of a project, in `sort` order, across its spaces.
`200 → { "data": [ { …phase… } ] }`

## POST /phases

Create or update (upsert by `id`). `project` is derived from `space`.
`Body → { id?, space*, name*, code, sort, status*, ownerId, start, finish, note }`
`201/200 → { "data": { …phase… } }`

## DELETE /phases/{id}

`204 → no content`

## GET /templates

The phase list per space kind — seeded data the client applies on space creation.
`200 → { "data": [ { "id":"TPL-002", "kind":"Kitchen", "sort":1,
        "phases":[ { "name":"Design", "code":"Design Fee" } ] } ] }`

## POST /spaces/{id}/apply-template

Creates the phases of the space's kind that **do not already exist on it**, and
returns only the rows written. Pressing it twice must never wipe phases that
have been assigned or completed.
`201 → { "data": [ { …phase… } ] }` (an empty array is a valid, successful answer)

## GET /load

Company-wide: every person on the Woodart + group roster with the count of
**open** phases (status ≠ `Complete`) they are responsible for, plus the
unassigned queue.
```json
{ "data": {
    "people": [ { "id":"EPL-0008", "name":"Sumaiya Akter", "designation":"Production Supervisor",
                  "open":42, "active":13, "spaces":39, "projects":13, "overdue":0 } ],
    "unassigned": 53 } }
```

---

## Invariants

1. **`id` is frontend-generated and stable**; the server upserts on it and never
   duplicates.
2. **A phase's `project` is always its space's `project`.** Derived server-side.
3. **Deleting a space cascades to its phases** (FK `on delete cascade`, and the
   service does it explicitly so the API behaves the same on any driver).
4. **Nothing here is stored that can be derived**: progress, a space's status,
   a project's phase totals and the team load are all computed on read. A stored
   total is a total that drifts.
5. **`overdue` is measured against an injected clock**, never a bare `now()` —
   the server must not disagree with the screen about what "overdue" means. The
   demo anchor is `2026-07-05`.
6. **`ownerId` is a reference, never a copy.** No employee name, designation or
   department is stored on a phase; an id whose employee no longer exists is
   returned as-is and rendered as an orphan, never blanked.
