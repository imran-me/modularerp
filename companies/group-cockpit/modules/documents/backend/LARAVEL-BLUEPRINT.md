# Document Center — Laravel backend blueprint

> Source of truth: `companies/group-cockpit/modules/documents/view.js` (single-screen view
> registered as `group/documents`, view.js:64) plus the shared documents engine
> `platform/engines-library/documents.js` (persistence + serials) and `platform/engines-library/serial.js`.
> Route today: `#/group/documents` (module.json). Rebuild 1:1 — no new features.

## Purpose & screens
One screen (no sub-routes; `module.json.menu` is empty): the group-wide registry of every
branded business document filed by ANY company/module ("Save to Center").
- **KPI row** (view.js:85-101): Total Documents, This Month (documents whose `at` falls in
  current calendar month), Total Value (sum of `amount`), Invoices count, Receipts count.
- **Documents-by-Type doughnut** (view.js:103-120, 163-174): count of docs grouped by `type`,
  sorted descending; per-type color/label from the TYPES map (view.js:30-41).
- **Filed Documents table** (view.js:132-160): columns Serial · Type badge · Title · Company ·
  Party · Amount (money) · Date; search over serial/typeLabel/title/company/party/by;
  dropdown filters on Type and Company; page size 12; CSV export `document-center.csv`;
  row click / "Open" action rebuilds a representative branded document for preview & reprint
  (view.js:153, 269).
- **Header actions** New Invoice / New Receipt / New Voucher (view.js:71-73): a small form
  (title, company, party/narration, amount, optional line description — view.js:282-289)
  builds the branded doc; the doc modal's "Save to Center" is what persists it
  (documents.js:323-342). The list live-refreshes on `data:changed` for store `documents`
  (view.js:181-183).

## Entities & fields
**Document** — today: localStorage collection `documents` (`EPAL.db.col('documents')`,
namespace `epal.v1.documents`). Record shape as written by documents.js:325-335 and read
by view.js:
- `id`         string  — UI uid `DOC-…` today → Laravel: bigint PK (keep a `uid` string if 1:1 needed)
- `serial`     string  — `PREFIX/FY/000NNN`, e.g. `INV/2026/000042` (unique per stream)
- `type`       string enum — invoice · receipt · voucher · quotation · workorder · po · salary · ticket · visacover · document (default) (view.js:30-41)
- `title`      string  — e.g. "Sales Invoice"
- `companyId`  string  — company registry id (`travels`, …) or `group` (default)
- `party`      string  — client/supplier name, or narration for vouchers
- `amount`     decimal — BDT, VAT-inclusive by convention (view.js:251)
- `at`         epoch-ms timestamp → `filed_at` datetime
- `by`         string  — preparer name from `EPAL.auth.current().name`, fallback `System` (documents.js:334) → `created_by` user FK + name snapshot

**Serial counters** — localStorage store `serials`: map `"[company:]PREFIX:FY" -> last int`
(serial.js:12-14). In Laravel this is the SerialService table (see Engines).

Companies are NOT owned here — read from the group registry (view.js:44-55).

## Business rules
1. **Serial format & gapless issue**: `numberFor(type)` maps type→prefix
   (invoice INV, receipt RCP, voucher JV, workorder WO, salary SAL, quotation QUO, po PO,
   visacover VISA, ticket TKT; fallback DOC — documents.js:60-63, 299-303) then
   `serial.next(prefix)` atomically increments a per-(prefix, fiscal-year) counter and
   formats `PREFIX/FY/000000+n` (6-digit pad, `/` sep). Numbers must never repeat or skip
   (serial.js:16-19). FY label = calendar year the fiscal year started in
   (`config.group.fiscalYearStart`, serial.js:50-59).
2. **Save-once (idempotent filing)**: within one open document modal, "Save to Center" files
   the record exactly once; a second click toasts "Already saved" and writes nothing
   (documents.js:321-324, 340).
3. **New-document validation** (view.js:283-287): `title` required; `companyId` required
   (options = enabled companies only, default `travels`); `party` required; `amount` required,
   money, **min 1**.
4. **Preview reconstruction** (specFrom, view.js:208-267): non-voucher docs are rendered as a
   single line with 5% VAT back-calculated from the VAT-inclusive stored amount —
   `vat = round(amount / 1.05 * 0.05)`, `net = amount - vat`; totals = Subtotal(net) +
   VAT 5%(vat) + Grand Total(amount). Vouchers render a two-leg journal presentation:
   Dr `Cash / Bank (1010)` = amount, Cr `Revenue / Adjustment (4000)` = amount
   (view.js:237-249). Amount-in-words uses BD/Indian numbering (crore·lakh·thousand),
   "Taka … Only" (documents.js:30, 84).
5. **KPI math**: "This Month" = current calendar month of `at`; "Total Value" = plain sum of
   `amount` across all types (view.js:87-91).
6. **List order**: newest first by `at` (view.js:57-59).
7. No edit/delete of filed documents exists in this module — append-only registry.

## Routes
```
GET    /group/documents                 index — records + KPI aggregates + by-type counts
POST   /group/documents                 file a document (the "Save to Center" action)
GET    /group/documents/{document}      show — record + rebuilt print spec (preview/reprint)
GET    /group/documents/export          CSV export (same columns as the table)
GET    /group/documents/serial/peek     next serial for a type WITHOUT consuming (form display)
```
Query params on index mirroring the table: `q` (search), `type`, `company`, `page` (size 12).

## Controllers
**DocumentCenterController**
- `index(Request)`  → paginated filtered documents + `kpis{total, thisMonth, totalValue,
  invoices, receipts}` + `byType[]` for the doughnut.
- `store(StoreDocumentRequest)` → validates rule 3, draws serial via SerialService inside a
  DB transaction, sets `filed_at=now()`, `created_by=auth user`; returns 201 with the record.
  Idempotency: accept a client `uid`/idempotency key so a repeated save is a no-op (rule 2).
- `show(Document)` → record + `spec` payload built exactly like specFrom (rule 4) for the
  print/PDF layer.
- `export(Request)` → streamed CSV `document-center.csv` (Serial, Type, Title, Company,
  Party, Amount, Date).
**SerialController** — `peek(type)` → `{serial}` without consuming.

## Models & migrations
**Document** (`documents` table)
- fillable: `serial, type, title, company_id, party, amount, filed_at, created_by, created_by_name, uid`
- casts: `amount: decimal:2`, `filed_at: datetime`, `type: string` (or PHP enum DocumentType
  with the 10 values above)
- migration: `id`; `uid` string unique nullable; `serial` string unique; `type` string index;
  `title` string; `company_id` string index; `party` string; `amount` decimal(14,2);
  `filed_at` datetime index; `created_by` FK users nullable; `created_by_name` string;
  timestamps.

**SerialCounter** (`serial_counters`, owned by SerialService)
- migration: `id`; `prefix` string; `company_id` string nullable; `fiscal_year` smallint;
  `last_number` unsignedInteger default 0; unique(`prefix`,`company_id`,`fiscal_year`).
- increment with `lockForUpdate()` in the same transaction as the document insert (gapless).

## Policies / permissions
The view gates nothing beyond login: any authenticated user can list, preview, and file;
`by` records the current user's name (view.js:301, documents.js:334). DocumentPolicy:
`viewAny/view/create` = authenticated; **no `update`/`delete`** (append-only, rule 7).
This is a group-cockpit module — restrict to users with group-level access if/when the
platform role model lands; today `EPAL.auth.current()` is the only auth touchpoint.

## Events
- `DocumentFiled(Document)` — emitted on store(); mirrors today's `data:changed
  {store:'documents'}` bus event that drives the live table redraw and the audit engine's
  auto-record (documents.js:336-338, view.js:181-183). Consumers: activity-log/audit,
  any dashboard doc counts. This module records document metadata only — it posts **no**
  ledger money movement itself, so no `*.sold`/ledger events here.

## Engine dependencies
- **EPAL.doc** (documents.js) → Laravel `DocumentService`: spec builder + HTML/PDF renderer
  (build/print/download), `numberFor`, `amountInWords` (BD numbering helper).
- **EPAL.serial** (serial.js) → `SerialService`: gapless per-(prefix, company?, FY) counters,
  `next/peek`, fiscal-year derivation from group config.
- **EPAL.db / bus `data:changed`** → Eloquent + domain event `DocumentFiled` (audit listener
  replaces the audit engine's auto-record).
- **EPAL.auth** → Laravel auth (`Auth::user()->name` for `created_by_name`).
- **EPAL.config companies registry** → company lookup service/table for names & enabled flag
  (view.js:44-55); Company filter options come from it.
- Chart/table/CSV/formModal are frontend-only (EPAL.charts/EPAL.table/EPAL.formModal) — no
  backend beyond the index aggregates and CSV route above.
