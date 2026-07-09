# Group Settings — Laravel backend blueprint

Source of truth: `companies/group-cockpit/modules/settings/view.js` (route `group/settings`,
registered at view.js:566). Single-page screen with no sub-routes (`module.json` menu is empty),
but many independent cards, each persisting to its own store.

## Purpose & screens
One screen, `#/group/settings`, composed of cards (view.js:566-696):
1. **KPI row** — data stores count, total records, storage KB, app version (view.js:581-586). Backend equivalent: a stats endpoint over DB tables.
2. **Group Profile & Preferences** — identity (name, legalName, tagline), locale (currencySymbol readonly BDT, fiscalNote, dateFormat), default theme; saving persists `settings.group` + `ui.theme` and applies theme instantly (view.js:589-633).
3. **Data Management** — full backup download of every `epal.v1.*` key as one JSON payload; restore from JSON with namespace validation; danger-zone "Reset Demo Data" → `EPAL.db.reset()` (view.js:643-671, 713-760).
4. **Storage Footprint chart** — top-8 stores by byte size (view.js:673-710).
5. **Financial Year & Finance** — fiscal-year start month, VAT rates, working calendar, doc-numbering prefixes with live serial preview via `EPAL.serial.peek` (view.js:128-194).
6. **Leave & Salary Policy** — leave day allowances, overtime rule/cap, salary component percentages that must total 100% (view.js:197-257).
7. **Dropdown & Master Data** — tabbed CRUD managers for Expense Heads, Designations, Visa Categories, Airlines (view.js:300-365).
8. **Approval Matrix** — maker-checker amount bands per document type, feeding `EPAL.approvals.needsApproval` (view.js:368-431).
9. **Role Templates** — action-level permission grants per role × company/module with wildcard resolution (view.js:434-530).
10. **Per-Company Branding** — display name + accent color per company, stored under `settings.<companyId>` (view.js:533-561).

## Entities & fields (today's localStorage stores, ns `epal.v1.`)
1. **settings.group** (singleton, view.js:589-613): name:string(required) · legalName:string(required) · tagline:string · currencySymbol:string(readonly "৳") · fiscalNote:string · dateFormat:enum(DD Mon YYYY|DD/MM/YYYY|YYYY-MM-DD) · theme:enum(dark|light)
2. **settings.finance** (singleton, view.js:128-157): fyStartMonth:string("1"-"12") · baseCurrency:string(readonly) · vatRate:number 0-100 (default 15) · reducedVatRate:number 0-100 (default 7.5) · workingDays:int 1-7 (default 6) · weekend:enum(Friday|Friday & Saturday|Saturday & Sunday|Sunday) · invoicePrefix:string(default INV) · invoicePad:int 1-10 (default 6) · receiptPrefix:string(RCP) · voucherPrefix:string(JV)
3. **settings.hrPolicy** (singleton, view.js:197-226): annualLeave:int 0-60 (20) · casualLeave:int 0-30 (10) · sickLeave:int 0-30 (14) · maternityLeave:int 0-180 (112) · overtimeRule:decimal enum 1|1.5|2 · overtimeCap:int 0-200 (60) · basicPct/houseRentPct/medicalPct/conveyancePct:number 0-100
4. **expenseHeads** (collection, seeded view.js:75-88): id:string "EH-xx" · name:string(required) · type:enum(Fixed|Variable|Statutory)
5. **designations** (collection, seeded view.js:89-102): id:string "DS-xx" · name:string(required) · dept:string
6. **visaCats** (collection, view.js:323-338, shared with Travels→Visa Processing): id:"VC-xx" · country:string(required) · type:enum(Tourist|Business|Visit|Umrah|Student|Work) · cost:money≥0 · sale:money≥0 · days:int≥0 · status:enum(active|inactive)
7. **airlines** (collection, view.js:339-351, shared with Travels→Air Ticketing): id:"AL-xx" · name:string(required) · iata:string /^[A-Za-z0-9]{2,3}$/ · country:string · status:enum(active|inactive)
8. **approval_matrix** (via EPAL.approvals.matrix/setMatrix, view.js:368-431): docType:string(required) · minAmount:money(default 0) · maxAmount:money (999999999999 = ∞ sentinel, view.js:73) · roles:string[] (ordered approval chain)
9. **role_templates** (via EPAL.perm.templates/template/setTemplate, view.js:434-530): role:string · grants:map<scopeKey,'*'|action[]> where scopeKey ∈ {co/mod, co/*, */mod, */*, *}
10. **settings.<companyId>** (one singleton per company, view.js:533-561): displayName:string · accent:string(hex color)

## Business rules
- Salary components basicPct+houseRentPct+medicalPct+conveyancePct MUST equal exactly 100 or save is rejected (view.js:249-250).
- Approval matrix: blank maxAmount is stored as sentinel 999999999999 meaning unlimited (view.js:391); roles input is comma-split, trimmed, empties dropped (view.js:392); matrix bands drive `approvals.needsApproval` per docType+amount (view.js:426).
- Role-template grant resolution is most-specific-first: `co/mod` → `co/*` → `*/mod` → `*/*` → `*` (view.js:446-453); toggling a cell materialises the wildcard-resolved effective grant into an explicit scope grant so inherited actions aren't lost (view.js:460-472); empty action arrays delete the grant key (view.js:472).
- Master-data delete requires `perm.can('group','settings','delete')` (view.js:279) and a confirm dialog; new record ids are `<prefix>` + base36-time suffix uppercased (view.js:269).
- IATA code validated against `^[A-Za-z0-9]{2,3}$` (view.js:343). Finance/HR/group forms use `form.validate()` (required + min/max) before save.
- Doc-numbering prefixes are *preview-only* (peek, never consumes a serial — view.js:150-152, 161-163); live serials remain per-module via the serial engine; fyStartMonth is reference-only, live value is `config.group.fiscalYearStart` (view.js:135).
- Saving theme applies `data-theme` immediately, persists `ui.theme`, emits `theme:changed` (view.js:626-628).
- Backup restore rejects: non-JSON files, payloads without a data map, empty key sets, and any key outside the `epal.v1.` namespace (view.js:730-742); restore overwrites then reloads. Reset wipes and reseeds everything (view.js:664).
- Every config save writes an audit record `{action:'config'|'permission', entity, entityId, companyId:'group'}` (view.js:113-118, 522-525).
- Seed data for expenseHeads/designations is idempotent (`seedOnce`) and survives resets (view.js:104-111).

## Routes (prefix `/api/group/settings`, auth:sanctum)
- GET/PUT  `/group`                      — settings.group singleton
- GET/PUT  `/finance`                    — settings.finance singleton
- GET/PUT  `/hr-policy`                  — settings.hrPolicy singleton (server re-checks 100% rule)
- apiResource `/expense-heads`, `/designations`, `/visa-categories`, `/airlines` (index/store/update/destroy)
- GET/PUT  `/approval-matrix`            — whole-matrix read/replace (UI edits then persists full list)
- GET      `/role-templates`             — list roles; GET `/role-templates/{role}`; PUT `/role-templates/{role}` (replace grants map)
- GET/PUT  `/branding` or `/branding/{companyId}` — per-company displayName+accent
- GET      `/stats`                      — store counts/records/bytes (KPI row + footprint chart)
- GET      `/backup`  · POST `/restore`  — full-tenant JSON export/import (namespace-validated)
- POST     `/reset-demo`                 — wipe + reseed (guard behind admin, confirm client-side)

## Controllers
- `GroupSettingsController` — showGroup/updateGroup, showFinance/updateFinance, showHrPolicy/updateHrPolicy (return the singleton JSON; update validates + audits + returns saved values)
- `ExpenseHeadController`, `DesignationController`, `VisaCategoryController`, `AirlineController` — standard resource CRUD returning the record / 204 on delete
- `ApprovalMatrixController` — index (rules array), replace (validated full array, audits `approval_matrix`)
- `RoleTemplateController` — index (roles+labels), show(role) (grants map), update(role) (replace grants, audit `permission`)
- `BrandingController` — index (all companies with saved overrides), update (bulk save, audit)
- `DataVaultController` — stats, backup (StreamedResponse JSON `{app,version,exportedAt,keys,data}` — mirror payload shape view.js:718-721), restore, resetDemo

## Models & migrations
- `Setting` (key-value singleton store): fillable [scope, key, value]; casts value:array. Migration: id, scope:string(index, e.g. 'group','finance','hrPolicy','company:<id>'), key:string, value:json, timestamps, unique(scope,key). Backs entities 1,2,3,10.
- `ExpenseHead`: fillable [code,name,type]; migration: id, code:string unique ("EH-01"), name:string, type:enum(Fixed,Variable,Statutory), timestamps.
- `Designation`: fillable [code,name,dept]; migration: id, code unique ("DS-01"), name, dept nullable, timestamps.
- `VisaCategory`: fillable [code,country,type,cost,sale,days,status]; casts cost/sale:decimal:2, days:integer; migration: id, code unique, country, type enum, cost decimal(14,2), sale decimal(14,2), days unsignedInteger, status enum(active,inactive) default active, timestamps.
- `Airline`: fillable [code,name,iata,country,status]; migration: id, code unique, name, iata string(3) nullable, country nullable, status enum default active, timestamps.
- `ApprovalRule`: fillable [doc_type,min_amount,max_amount,roles]; casts roles:array, min/max_amount:decimal:2 (max_amount nullable = unlimited, replacing the ∞ sentinel); migration: id, doc_type string, min_amount decimal(16,2) default 0, max_amount decimal(16,2) nullable, roles json, position unsignedInteger, timestamps.
- `RoleTemplate`: fillable [role,label,grants]; casts grants:array; migration: id, role string unique, label nullable, grants json, timestamps.
- Seeders: ExpenseHeadSeeder + DesignationSeeder with the exact 10-row defaults (view.js:75-102); idempotent (`firstOrCreate` by code).

## Policies / permissions
- Mirror `EPAL.perm.can(company, module, action)` with actions from `EPAL.perm.actions` (view.js:435) resolved through the wildcard chain above.
- The only explicit gate in this view: destroy on master-data requires `can('group','settings','delete')` (view.js:279). Apply a `SettingsPolicy`: view→can(...,'view'); create/update→'edit'; destroy→'delete'; role-template + approval-matrix writes and backup/restore/reset → admin-level (module is flagged `admin: true` in module.json).
- Role-template resolution belongs in a shared `PermissionService` (Gate::before) implementing the co/mod → co/* → */mod → */* → * lookup.

## Events
- No sales/money is recorded here — do NOT emit ledger events. Emit config-change domain events for the group bridge/audit: `settings.group.updated`, `settings.finance.updated`, `settings.hr_policy.updated`, `approval_matrix.updated`, `role_template.updated`, `branding.updated`, `data.restored`, `data.reset` — matching today's audit calls (view.js:113-118, 188, 252, 373, 522, 556).
- `theme:changed` (view.js:628) is UI-only; no backend event needed beyond persisting `settings.group.theme`.

## Engine dependencies
- `EPAL.store` (get/set/list/seedOnce, view.js:129,187,262,608) → Setting model + Eloquent collections.
- `EPAL.db` (save/remove/saveVisaCat/saveAirline/reset, view.js:310-350,664) → resource controllers + `php artisan migrate:fresh --seed` for reset.
- `EPAL.serial.peek` (view.js:162) → shared `SerialService::peek(prefix,pad)` that reads next number WITHOUT incrementing (preview must not consume).
- `EPAL.approvals` matrix/setMatrix (view.js:369,372) → `ApprovalService` reading approval_rules; `needsApproval(docType,amount)` selects the band where min ≤ amount < max.
- `EPAL.perm` actions/templates/template/setTemplate/can (view.js:279,435-442,521) → PermissionService + role_templates table.
- `EPAL.audit.record` (view.js:114) → `AuditService::record()` writing an activity_log row (action, entity, entity_id, entity_label, company_id).
- `EPAL.bus` events → Laravel event dispatcher; `EPAL.charts` is frontend-only (stats endpoint supplies data).
