# Woodart · Procurement — API contract

**Version 1 · frozen 2026-07-27**

> The agreement between the frontend and the backend. Split out of
> `LARAVEL-BLUEPRINT.md` on purpose: the **frontend is built against this
> contract before any PHP exists**. Change a shape only by bumping the version
> and recording what moved.

- **Base path:** `/api/woodart/procurement`
- **Auth:** Sanctum bearer, applied centrally by `ModuleServiceProvider`.
- **Company scope:** every row is `company_id = 'woodart'`.
- **Money:** integer Taka. Never a float (owner decision D10).
- **Implemented by:** `PurchaseOrderController` + `VendorController` → one
  shared `ProcurementService` → `PurchaseOrderResource` / `VendorResource`.

This module owns **two** entities. One controller each (D8); one service,
because the rules that matter span both.

---

## The records

### Purchase order — frontend `wa_purchases`

```json
{
  "id":       "WPO-001",
  "supplier": "Timber World BD",
  "items":    8,
  "amount":   340000,
  "status":   "Received",
  "date":     "2026-04-02",
  "created":  "2026-04-02"
}
```

| Field | Type | Rules |
|---|---|---|
| `id` | string ≤ 40 | **required**, `^[A-Za-z0-9_-]+$`. Frontend-generated (`WPO-000`). Upsert key. |
| `supplier` | string ≤ 160 | **required.** The vendor **NAME** — see invariant 1. Not validated against the vendor master, deliberately (invariant 3). |
| `items` | integer ≥ 1 | **required** |
| `amount` | integer ≥ 0 | **required.** Whole Taka. |
| `status` | enum | **required** — `Ordered` · `Partial` · `Received` |
| `date` | date | optional |
| `created` | date | optional; defaults to today |

### Vendor — frontend `wa_vendors`

```json
{
  "id":       "VEN-005",
  "name":     "Timber World BD",
  "category": "Board",
  "contact":  "Mahmudul Hasan",
  "phone":    "+8801812000005",
  "email":    "timber.world.bd@supply.example.bd",
  "area":     "Wari",
  "terms":    "Net 30",
  "since":    "2022-11-14",
  "created":  "2026-05-14"
}
```

| Field | Type | Rules |
|---|---|---|
| `id` | string ≤ 40 | **required**, `^[A-Za-z0-9_-]+$`. Frontend-generated (`VEN-000`). Upsert key. |
| `name` | string ≤ 160 | **required.** Also the join key from orders. |
| `category` | enum | **required** — `Board` · `Laminate` · `Hardware` · `Adhesive` · `Finish` · `Fabric` · `General` |
| `terms` | enum | optional — `Advance` · `Net 15` · `Net 30` · `Net 45` |
| `contact` · `phone` · `email` · `area` | | optional; `""` when unset, never `null` |
| `since` · `created` | date | optional |

---

## Orders

### `GET /orders`
Newest first. The endpoint `api.js` HYDRATE calls for `wa_purchases`.
```json
200 → { "success": true, "count": 8, "data": [ …order… ] }
```

### `POST /orders`
Create or update. **Upsert keyed on `id`.**
```json
Body → { id*, supplier*, items*, amount*, status*, date?, created? }
200  → { "success": true, "data": { …order… } }
422  → { "message": "…", "errors": { "status": ["…"] } }
503  → { "success": false, "message": "wa_purchases table not migrated yet. Run: php artisan migrate" }
```

### `DELETE /orders/{id}`
Soft delete, **idempotent**. `200 → { "success": true }`

## Vendors

### `GET /vendors` · `POST /vendors` · `DELETE /vendors/{id}`
Same shapes and rules as orders, against `wa_vendors`.
**Deleting a vendor does not delete their orders** — those orders simply become
"unlisted" (invariant 3).

## `GET /spend`

Totals, by category and by vendor. Everything the Spend tab shows.

```json
200 → {
  "success": true,
  "summary": { "orders":8, "value":1499000, "received":1152000, "outstanding":347000,
               "open":3, "vendorsUsed":6, "vendors":5, "idle":0,
               "avg":187375, "top":"Timber World BD", "topCategory":"Board" },
  "byCategory": [ { "name":"Board", "orders":4, "value":1059000 } ],
  "byVendor":   [ { "id":"VEN-005", "name":"Timber World BD", "category":"Board",
                    "terms":"Net 30", "contact":"Mahmudul Hasan", "area":"Wari",
                    "orders":2, "items":17, "value":745000,
                    "received":340000, "outstanding":405000, "last":"2026-06-18" } ]
}
```

> **Note:** the SPA does not call `/spend` today — it computes it client-side
> from the hydrated stores, which is instant and works offline. It exists so the
> join and the outstanding rule have one authoritative server-side definition.

---

## Invariants (the rules a change must not break)

1. **An order stores the vendor by NAME, not by id.** That is how
   `wa_purchases` was already built and this module does not rewrite it (R2).
   The join is a normalised name match — `trim` + lowercase — in **one** place
   each side: `ProcurementService::matchKey()` and `key()` in the frontend seam.
2. **OUTSTANDING is any order whose status is not `Received`.** One definition,
   in `PurchaseOrder::isOpen()` and mirrored in the seam. `Partial` counts as
   fully outstanding: the module does not track a part-received amount, and
   pretending otherwise would understate what is owed.
3. **An order against an unknown supplier is VALID and is counted.** `supplier`
   is not validated against the vendor master. It lands under `Unlisted` in the
   category roll-up and is flagged in the register — never dropped. Money that
   left the business must appear in the totals even when the vendor paperwork is
   behind; refusing the order, or silently discarding it from the analysis,
   would make the spend numbers quietly wrong.
4. **Vendor spend is DERIVED, never stored.** There is no total column on
   `wa_vendors`, so it cannot drift from the orders it came from.
5. **`id` is frontend-generated and stable**; upsert on `(company_id, ext_id)`.
6. **Deletes are soft**, and re-posting a deleted code **revives** it.
7. **Every action is `Schema::hasTable`-guarded.**
8. **`GET /vendors` is ordered case-insensitively by name**, matching MySQL's
   `_ci` collation and the frontend's `localeCompare`.
9. **A goods receipt is an accounting event, and it is a BALANCE-SHEET one.**
   Moving an order to `Received` posts, for the order value:

   ```
   DR 1400  Inventory
   CR 2000  Accounts Payable
   ```

   id `GL-WPO-<po>`, dated the order date, `ref` = the PO number, party = the
   vendor, `source: 'procurement'`. `Ordered` and `Partial` post **nothing** —
   a PO is a commitment, and there is no part-received amount to post (inv. 2).
   It must never touch `5000 Cost of Sales`: stock becomes cost when a project
   consumes it, and `projects` already posts that at sale. Un-receiving,
   re-valuing or deleting a received order posts an equal-and-opposite REVERSAL
   (AUDIT P2), never a delete; a later re-receipt uses a fresh id (`…-R2`).
   Proven by `node tools/verify/books.mjs receipt`.

## Change log

| Version | Date | Change |
|---|---|---|
| 1 | 2026-07-27 | First frozen contract. |
