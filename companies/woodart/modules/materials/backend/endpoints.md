# Woodart · Materials — API contract

**Version 1 · frozen 2026-07-27**

> This document is the agreement between the frontend and the backend. It is
> split out of `LARAVEL-BLUEPRINT.md` on purpose: the **frontend is built against
> this contract before any PHP exists**, and the PHP is written to satisfy it.
> Neither side waits for the other, and neither side may change a shape
> unilaterally — bump the version and record what moved.

- **Base path:** `/api/woodart/materials`
- **Auth:** Sanctum bearer token. Enforced centrally by
  `platform/backend` → `ModuleServiceProvider` (the `/api` group applies
  `auth:sanctum`), so no route below repeats it.
- **Company scope:** every row is `company_id = 'woodart'`. The service scopes
  reads and stamps writes; a client cannot reach another company's rows.
- **Money:** integer Taka. No floats, anywhere, ever (owner decision D10).
- **Implemented by:** `MaterialController` → `MaterialService` →
  `MaterialResource`.

---

## The record

Every endpoint that returns a material returns **exactly** this shape — which is
the shape the frontend `wa_materials` store already uses. That is deliberate:
`platform/data/api.js` hydrates the store with a plain write, with no mapping
layer in JavaScript to drift out of sync.

```json
{
  "id":       "MAT-001",
  "name":     "Marine Plywood 18mm",
  "category": "Board",
  "unit":     "sheet",
  "stock":    142,
  "reorder":  40,
  "unitCost": 3400,
  "supplier": "Timber World BD",
  "created":  "2026-05-14"
}
```

| Field | Type | Rules |
|---|---|---|
| `id` | string ≤ 40 | **required**, `^[A-Za-z0-9_-]+$`. Frontend-generated (`MAT-000` series). The upsert key. |
| `name` | string ≤ 160 | **required** |
| `category` | enum | **required** — `Board` · `Laminate` · `Hardware` · `Adhesive` · `Finish` · `Fabric` |
| `unit` | enum | **required** — `pcs` · `sheet` · `kg` · `litre` · `sft` |
| `stock` | integer ≥ 0 | **required**. Stored signed — see the invariants. |
| `reorder` | integer ≥ 0 | **required** |
| `unitCost` | integer ≥ 0 | **required**. Whole Taka. |
| `supplier` | string ≤ 160 | optional; returned as `""` when unset, never `null` |
| `created` | date `YYYY-MM-DD` | optional on write; defaults to today |

---

## `GET /stock`

The whole register, A→Z by name. This is the endpoint `api.js` HYDRATE calls.

```json
200 → { "success": true, "count": 12, "data": [ …material… ] }
```

Before `php artisan migrate` has run, returns `{"success":true,"count":0,"data":[]}`
rather than an error — an un-migrated host shows an honest empty register
instead of a broken screen.

## `POST /stock`

Create or update. **Upsert keyed on `id`**, so re-posting the same record
updates it and never duplicates.

```json
Body → { id*, name*, category*, unit*, stock*, reorder*, unitCost*, supplier?, created? }
200  → { "success": true, "data": { …material… } }
422  → { "message": "…", "errors": { "category": ["…"] } }
503  → { "success": false, "message": "wa_materials table not migrated yet. Run: php artisan migrate" }
```

## `DELETE /stock/{id}`

Soft delete by frontend id. **Idempotent** — deleting an id that is already gone
still returns success, so a retried request is never an error.

```json
200 → { "success": true }
```

## `GET /reorder`

Everything at or below its reorder level, worst shortfall first.

```json
200 → { "success": true, "count": 3, "data": [ …material… ] }
```

## `GET /valuation`

Totals plus stock value by category, largest first.

```json
200 → {
  "success": true,
  "summary": { "items":12, "value":1284500, "low":3, "dead":1,
               "categories":6, "suppliers":5, "avg":107042 },
  "data": [ { "name":"Board", "items":3, "units":196, "value":712300 } ]
}
```

> **Note:** the SPA does not call `/reorder` or `/valuation` today — it computes
> both client-side from the hydrated store, which is instant and works offline.
> They exist so the reorder rule has one authoritative server-side definition,
> and for reports and any future non-SPA client.

---

## Invariants (the rules a change must not break)

1. **`id` is frontend-generated and stable.** The server upserts on
   `(company_id, ext_id)` and must never renumber it.
2. **Every response row is already in the frontend shape.** The Resource is the
   translation seam; there is no mapping in JavaScript.
3. **Money is an integer number of Taka.** A float anywhere here is a bug.
4. **`stock` is stored signed** even though the API rejects negatives on write.
   Counts can legitimately go negative when issues are recorded before receipts;
   an unsigned column would turn a data problem into a 500.
5. **Deletes are soft.** A consumed material is history, and the group's books
   may still reference it. Re-posting a deleted code **revives** it.
6. **`low` means `stock <= reorder`** — at or below. Defined in
   `MaterialService` and mirrored in the frontend seam
   (`Materials.isLow`). Change one, change the other.
7. **Every action is `Schema::hasTable`-guarded.** The live host pulls code
   before anyone runs migrations.
8. **`GET /stock` is ordered case-insensitively by name**, which is what MySQL's
   `utf8mb4_*_ci` collation does and what the frontend seam's `localeCompare`
   does — both put *Marine Plywood* before *MDF 12mm*. Do **not** "fix" this to
   a byte-order sort: PHP's `sort()` would put `MDF` first (`'D'` 0x44 <
   `'a'` 0x61) and the server and client would disagree on row order.

## Change log

| Version | Date | Change |
|---|---|---|
| 1 | 2026-07-27 | First frozen contract. |
