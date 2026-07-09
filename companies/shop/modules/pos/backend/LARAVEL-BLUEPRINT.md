# Epal Shop — Point of Sale & Inventory · Laravel backend blueprint

> Source of truth: `companies/shop/modules/pos/view.js` (line refs below). One view file registers
> TWO SPA views: `shop/pos` (view.js:68) and `shop/inventory` (view.js:395).

## Purpose & screens
- **POS terminal** `#/shop/pos` (view.js:68-390): today KPIs (today's sales amount + order count from
  the group `sales` store filtered `companyId='shop'` and `date=today`, active products, low-stock count;
  view.js:81-90); searchable/category-filtered product grid of ACTIVE products, out-of-stock cards disabled
  (view.js:113-145); cart with qty +/-, remove, clear-confirm, discount %, 7.5% VAT, grand total
  (view.js:147-247); payment sheet (method, tendered, customer name/phone, live change/balance; view.js:250-282);
  checkout (view.js:284-342); branded printable receipt via document engine (view.js:344-377).
- **Inventory overview** `#/shop/inventory` and `/stock` (view.js:395-488): KPIs (SKUs, stock value at cost,
  retail value, low-stock count; view.js:427-437), stock-value-by-category doughnut (view.js:480-487),
  outstanding-balances panel (supplier payables top-5 + open customer dues top-6 with Settle; view.js:491-543),
  product master table with search/filters/CSV export and add/edit/delete (view.js:455-477, 618-670).
- **Low stock** `#/shop/inventory/low-stock` (view.js:546-615): products with `stock <= reorder` sorted
  ascending, out-of-stock rows flagged, KPIs (low/out count, reorder value = reorder*costPrice), one-click
  Restock modal (qty + supplier) that adds stock and books the purchase onto the supplier balance.

## Entities & fields  (today's localStorage stores, ns `epal.v1.`)
1. **Product** — store `sh_products` (seeded in platform/data/seed-bd.js; written view.js:643-653)
   `id` string 'PRD-######' · `name` string · `sku` string · `category` string · `brand` string ·
   `unit` enum(pcs|box|kg|ltr|set|pack) · `costPrice` decimal · `salePrice` decimal · `stock` int ·
   `reorder` int · `status` enum(Active|Inactive) · `created` date
2. **Order** — store `sh_orders` (written view.js:305-313, 330)
   `id` 'ORD-' + last-6-of-epoch-ms (view.js:292) · `customer` string (default 'Walk-in Customer') ·
   `phone` string · `items` int (line count) · `amount` decimal (grand) · `subtotal` · `discount` ·
   `discountPct` · `vat` · `cost` decimals · `channel` const 'Counter' · `payMethod` enum(Cash|bKash|Nagad|Card) ·
   `tendered` decimal · `change` decimal · `status` const 'Completed' · `payStatus` enum(Paid|Partial|Due) ·
   `date` date · `created` epoch-ms · `lines[]` {id, name, qty, price} (view.js:311)
3. **CustomerDue** — store `sh_dues` (seeded idempotently view.js:38-47; written view.js:319-321, 531-543)
   `id` 'SD-' + base36-epoch · `customer` · `phone` · `amount` int (rounded) · `orderRef` · `date` ·
   `status` enum(Open|Paid) · `settledAt` epoch-ms nullable · `created` epoch-ms
4. **Supplier** — store `sh_suppliers` (seeded elsewhere; this module reads name/terms/category/balance and
   INCREMENTS `balance` on restock, view.js:606-607). Fields used: `id, name, terms, category, balance` decimal.
5. **PartyTxn** (shared customer/supplier subledger) — store `party_txns` (written view.js:322-324, 537-539)
   `id` 'PT-' + base36-epoch · `party` · `partyType` 'customer' · `companyId` 'shop' · `date` · `ref` ·
   `desc` · `kind` enum(Invoice|Payment) · `debit` int · `credit` int · `due` date (Invoice only) · `created`
6. **Sale** (group-wide, owned by platform) — store `sales`, appended via `db.postSale('shop', …)`
   (view.js:302): `{amount: grand, cost, ref: orderId, desc: 'POS sale', customer}`; platform adds
   id/date/profit and rolls into monthly `financials` (platform/data/database.js:543-558).

## Business rules
- **VAT 7.5% flat** on (subtotal − discount); discount is a whole-cart %, clamped 0-100
  (view.js:32, 229-237). grand = taxable + vat. Cart also carries costPrice to compute order COGS.
- **Stock guards**: cannot add/increment beyond live stock (view.js:187, 218); out-of-stock products
  unclickable (view.js:136); checkout re-validates EVERY line against live stock and aborts whole sale
  if any line exceeds it (view.js:286-288). Stock decremented per line on success (view.js:295-299).
- **Unpaid balance → due**: if `grand − tendered > 0.5`, order.payStatus = Partial (tendered>0) or Due,
  a CustomerDue (rounded) is created, a mirroring `party_txns` Invoice (debit=due, due-date=today) is
  written, and a warning notification is raised (view.js:317-327). Else payStatus=Paid.
- **Settle due**: sets status=Paid + settledAt, writes party_txns Payment (credit=amount) (view.js:531-543).
- **Restock**: suggested qty = max(reorder*3 − stock, reorder||5) (view.js:589); qty must be > 0; adds to
  product stock and adds `qty × costPrice` to the chosen supplier's payable balance; info notification
  (view.js:600-613).
- **Low stock** definition everywhere: `stock <= reorder` (view.js:84, 430, 547).
- **Product save**: name+sku required (trimmed); numeric coercion with defaults stock=0, reorder=5,
  status=Active; salePrice < costPrice only warns, never blocks (view.js:639-657, 660).
- **Delete product** is a hard delete of the catalog row; orders/history untouched (view.js:661-670).
- **Serial**: receipt number from document engine `EPAL.doc.numberFor('receipt')`, falls back to order id
  (view.js:346); receipt badge/watermark = DUE vs PAID (view.js:357), amount-in-words on receipt (view.js:373).

## Routes  (RESTful mirror of hash routes `#/shop/pos`, `#/shop/inventory[/stock|/low-stock]`)
```
GET    /shop/pos                      terminal bootstrap (today KPIs + active products + categories)
POST   /shop/pos/checkout             body: lines[{product_id,qty}], discount_pct, pay_method, customer, phone, tendered
GET    /shop/pos/orders/{order}/receipt
GET    /shop/inventory                overview KPIs + category valuation + dues panel
GET    /shop/inventory/low-stock
GET|POST /shop/products    GET|PUT|DELETE /shop/products/{product}
POST   /shop/products/{product}/restock      body: qty, supplier_id
POST   /shop/dues/{due}/settle
```

## Controllers
- **PosController** — `terminal()` → KPIs + product grid data; `checkout(CheckoutRequest)` → runs the
  transaction below, returns order + receipt payload; `receipt(Order)` → receipt DTO (parties/meta/columns/
  rows/totals/words/terms exactly as view.js:355-376).
- **InventoryController** — `overview()` → KPIs, category valuation, supplier payables, open customer dues;
  `lowStock()` → sorted reorder list + KPIs.
- **ProductController** — `index/store/update/destroy` (validation per Business rules); `restock(Product)` →
  increment stock, increment supplier balance, notify.
- **DueController** — `settle(CustomerDue)` → mark Paid, write party txn Payment.

## Models & migrations
- **Product** fillable [name, sku, category, brand, unit, cost_price, sale_price, stock, reorder, status];
  casts cost_price/sale_price:decimal:2, stock/reorder:int. Migration: id(prefixed string or ULID+display id),
  name, sku unique, category, brand nullable, unit, cost_price, sale_price, stock default 0, reorder default 5,
  status default 'Active', timestamps.
- **Order** fillable [customer, phone, amount, subtotal, discount, discount_pct, vat, cost, channel,
  pay_method, tendered, change, status, pay_status, date]; casts money fields decimal:2, date:date.
  **OrderLine** child table: order_id FK, product_id, name snapshot, qty int, price decimal (view.js:311
  stores denormalised name+price — keep the snapshot).
- **CustomerDue** fillable [customer, phone, amount, order_ref, date, status, settled_at]; casts amount:int,
  settled_at:datetime.
- **Supplier** (shared shop model) — this module only updates `balance` decimal.
- **PartyTxn** fillable [party, party_type, company_id, date, ref, desc, kind, debit, credit, due]; shared table.
- Checkout runs in **one DB transaction**: lock product rows (`lockForUpdate`), validate stock, decrement,
  create order+lines, SalesService::record(), optional due + party txn — mirroring view.js:284-342 atomicity.

## Policies / permissions
- Only explicit check in the module: `EPAL.perm.can('shop','inventory','delete')` gates the product Delete
  action (view.js:451-453) → `ProductPolicy::delete` = permission `shop.inventory.delete`.
- Everything else is company-scoped access to `shop` (kernel route guard). Cashier identity for the receipt
  comes from the authenticated user, fallback 'Counter' (view.js:63, 364).

## Events
- **SaleRecorded** — emitted by SalesService on checkout (`db.postSale('shop', …)`, view.js:302); the group
  bridge/ledger listener posts the balanced journal and rolls monthly financials (database.js:537-558).
- **CustomerDueRecorded** (view.js:325) and **StockReplenished** (view.js:608) — today `db.notify(...)`
  warning/info notifications; map to events feeding the group notifications feed.
- All writes also emit the generic `data:changed` bus event (database.js contract) → Eloquent model events.

## Engine dependencies → Laravel equivalents
- **EPAL.db.postSale** → `SalesService::record()` in a transaction + `SaleRecorded` event (cross-company artery).
- **EPAL.doc** (document engine: `open`, `numberFor('receipt')`, `amountInWords`) → ReceiptService +
  DocumentNumberService (per-type serial sequence) + number-to-words helper; render as PDF/print view.
- **EPAL.db.notify** → Laravel notifications/broadcast to the group cockpit feed.
- **EPAL.perm** → Gate/Policy (`shop.inventory.delete`). **EPAL.auth.current()** → `auth()->user()`.
- **EPAL.registerEngine seed** (view.js:38-47) → `ShopDuesSeeder` (idempotent, 3 fixture dues SD-1001..1003).
- Charts/tables/toasts are frontend-only; the backend just supplies the aggregates listed under Controllers.
