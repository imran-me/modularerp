# Visa Processing — Laravel backend blueprint

> Source of truth: `companies/travels/modules/visa-processing/view.js` (one registered view
> `travels/visa-processing`, branching on sub-route, view.js:126-151) + `module.json` (menu/routes).
> Rebuild 1:1 — no new features.

## Purpose & screens
End-to-end visa lifecycle for Epal Travels. Sub-screens (view.js:130-147, module.json menu):
- **overview** — KPIs (total apps, approval rate = Approved/all, sales value, profit) + section cards + links (view.js:166-194).
- **categories** — CRUD table of visa categories (country/flag/type/cost/sale/margin%/days/status); margin = round((sale-cost)/sale*100) (view.js:197-235).
- **new-application** — intake form; selecting a category auto-fills embassyFee←cost, vfsCharge←0, serviceFee←max(0, sale-cost); live readout total = embassy+vfs+service, profit = serviceFee (view.js:270-285). Save creates app in stage `New` with a materialised document checklist + timeline entry (view.js:297-319).
- **application-board** — Kanban across 6 stages (`New, Documents, Submitted, Under Process, Approved, Rejected`, view.js:27-34); drag/drop or select advances stage; text search over applicant/passport/country; detail drawer with doc checklist, timeline, pay toggle, cover sheet, delete, discussion (view.js:322-435).
- **manage-sales** — sales ledger (embassy/vfs/serviceFee/customerTotal/payStatus/stage) + KPI totals + CSV export `visa-sales.csv` (view.js:474-501).
- **visa-rates** — category cards (cost/sale/margin/days), click-to-edit same category modal (view.js:504-520).
- **embassy-tracking** — apps in stages Submitted/Under Process/Approved/Rejected; decision due = created + category.days (default 14) days; overdue when stage=`Under Process` and due < today (view.js:523-543).
- **documents** — read-only display of per-country embassy checklists (`DOC_REQS_COUNTRY`, 8 countries, view.js:47-56) and per-visa-type fallback checklists (`DOC_REQS`, 6 types, view.js:36-43).
- **analysis** — approval rate = approved/(approved+rejected), avg sale, active pipeline, revenue-by-country bar (top 8 by sum of `sale`), stage-funnel chart (view.js:581-608).

## Entities & fields
**VisaCategory** — localStorage store `visaCats` (via `db.visaCats()`/`db.saveVisaCat`, view.js:124,233):
`id` string 'VC-###' (Date.now last 3, view.js:219) · `country` string (required) · `flag` string emoji ·
`type` enum[Tourist,Business,Umrah,Hajj,Work,Visit,Student,Transit] · `cost` number · `sale` number ·
`days` int (processing days) · `status` enum[active,inactive].

**VisaApplication** — store `visaApps` (`S.list('visaApps')`, `db.saveVisaApp`, view.js:123,315). Shape (view.js:302-314):
`id` 'VA-#####' (Date.now last 5) · `applicant` string required · `phone,email,passport,nationality` string ·
`dob,travelDate,created` date (ISO yyyy-mm-dd) · `catId` FK→VisaCategory · `country,flag,visaType` denormalised from category ·
`embassyFee,vfsCharge,serviceFee,customerTotal` number · `cost,sale` number (legacy mirror: cost=embassy+vfs, sale=total, view.js:309) ·
`payStatus` enum[Paid,Partial,Due] · `agent` FK→Employee (travels) · `notes` text · `posted` bool (finance-post guard) ·
`stage` enum(6 stages) · `docs` array[{name string, done bool}] · `timeline` array[{at ms-epoch, text string}].

**ApplicationDocument** (embedded `docs[]`) and **TimelineEvent** (embedded `timeline[]`) — normalise to child tables in SQL.
Fee derivation for legacy rows (view.js:80-93): if all four fee fields are 0 → embassy←cost, vfs←0, total←sale, service←max(0,total-embassy); else if total 0 → total = embassy+vfs+service. Always: cost = embassy+vfs, profit = total-cost.

## Business rules
1. **Document gate** — an app cannot move to `Submitted`, `Under Process`, or `Approved` while any required doc is `done:false`; blocked with error toast (view.js:96-106, enforced on drag view.js:343 and stage select view.js:416).
2. **Checklist assignment** — on create, docs come from `DOC_REQS_COUNTRY[country]` else `DOC_REQS[visaType]` else Tourist list (view.js:60-63,312). Legacy apps without `docs` derive the checklist on read (view.js:65-68).
3. **Finance posting, exactly once** — `postVisaToFinance` guarded by `app.posted` (view.js:108-121). Triggers: creation with payStatus=Paid (view.js:316), stage→Approved (drag view.js:346, select view.js:418), toggle Mark Paid (view.js:424). Posts `db.postSale('travels', {amount:customerTotal, cost:embassy+vfs, ref:id, desc:'Visa '+country, customer:applicant})` then sets posted=true, saves, and emits an info notification.
4. **Stage changes append timeline** — `{at:now, text:'Moved to <stage>'}` (view.js:344,417); creation appends 'Application created' (view.js:313).
5. **Approved notification** — success notification 'Visa Approved' on drag to Approved (view.js:346).
6. **Category validation** — country required (view.js:230); numeric coercion with 0 defaults; new-app validation: applicant name required (view.js:298).
7. **Decision-due / overdue** — due = created + days*86400000; overdue only in `Under Process` (view.js:526-528).
8. **Delete** — confirm dialog, removes from `visaApps`, emits `data:changed` delete (view.js:426). No soft delete.
9. **Serials** — VC-xxx / VA-xxxxx timestamp-derived today; in Laravel use a serial service with the same prefixes. Cover sheet serial via `EPAL.doc.numberFor('visacover')` (view.js:445).

## Routes (routes/api.php, prefix `travels/visa-processing`)
```
GET    /overview                          stats hub payload
GET    /categories                        VisaCategoryController@index
POST   /categories                        @store          PUT /categories/{id} @update
GET    /applications?q=&stage=            VisaApplicationController@index (board + search)
POST   /applications                      @store (new-application)
GET    /applications/{id}                 @show (detail drawer)
PATCH  /applications/{id}/stage           @moveStage   (doc-gate enforced server-side)
PATCH  /applications/{id}/pay-status      @togglePay   (posts sale when → Paid)
PATCH  /applications/{id}/documents/{i}   @tickDocument
DELETE /applications/{id}                 @destroy
GET    /sales                             SalesController@index   GET /sales/export (CSV)
GET    /rates                             VisaCategoryController@rates (cards)
GET    /embassy-tracking                  TrackingController@index (due/overdue computed)
GET    /document-requirements             DocRequirementController@index (country + type lists)
GET    /analysis                          AnalysisController@index (rate, funnel, revenue by country)
```

## Controllers
- **VisaCategoryController** — index (list + margin%), store/update (validate country required), rates (same data, card projection).
- **VisaApplicationController** — index (filter q over applicant|passport|country, group by stage); store (apply category pricing defaults, attach checklist, timeline seed, post sale if Paid); show (fees breakdown + missingDocs count); moveStage (reject 422 if target ∈ [Submitted, Under Process, Approved] and missing docs > 0; append timeline; fire Approved side-effects); togglePay; tickDocument; destroy.
- **SalesController** — index returns per-app fee breakdown + KPI totals (customerTotal, embassy+vfs cost, service profit, collected=Paid totals, view.js:477-484); export streams CSV columns App,Applicant,Country,Type,Embassy,VFS,ServiceFee,CustomerTotal,Payment,Stage (view.js:496-497).
- **TrackingController** — index: tracked stages + decisionDue + overdue flag + stage counts.
- **AnalysisController / DocRequirementController** — computed read models only.

## Models & migrations
**VisaCategory** — fillable: country, flag, type, cost, sale, days, status; casts: cost/sale decimal:2, days int.
Migration: id (string PK or serial), country, flag, type, cost, sale, days, status, timestamps.
**VisaApplication** — fillable: applicant, phone, email, passport, nationality, dob, travel_date, visa_category_id,
country, flag, visa_type, embassy_fee, vfs_charge, service_fee, customer_total, pay_status, agent_id, notes, stage;
casts: fees decimal:2, posted bool, dob/travel_date date. Columns add: posted (bool default false), created (date), timestamps.
Accessors mirror `fees()` (cost, profit) and legacy derivation (view.js:80-93).
**VisaApplicationDocument** — visa_application_id FK, name string, done bool, sort int.
**VisaApplicationEvent** — visa_application_id FK, text string, occurred_at datetime (timeline).
**DocRequirement** (seeded reference) — scope enum[country,type], key string, items json — seed from DOC_REQS / DOC_REQS_COUNTRY (view.js:36-56).

## Policies / permissions
The view checks no roles — any authenticated Travels user performs all actions (EPAL.auth is only referenced indirectly by db.log for actor name, database.js:565). Laravel: gate the whole module to users with access to company `travels`; a single `VisaApplicationPolicy` allowing viewAny/create/update/delete for travels staff mirrors today's behaviour. Delete uses a confirm dialog only — no maker-checker in this module.

## Events
- `visa.sale.posted` — the money event; today `db.postSale('travels', …)` appends the group `sales` ledger, rolls revenue/expense into the company's current-month financials row, and emits `sale:recorded` + activity log (database.js:543-568). Emit once per application (posted guard). Group bridge consumes this.
- `visa.application.created` / `visa.application.stage_changed` (payload: id, from, to) — mirror `data:changed` on `visaApps` (view.js:315,345) so dashboards refresh.
- `visa.application.approved` — drives the 'Visa Approved' notification (view.js:346).
- `visa.application.deleted` (view.js:426).

## Engine dependencies
- **EPAL.db / EPAL.store** (`visaApps`, `visaCats`, `sales`, `financials`, `employees`) → Eloquent + the shared **LedgerService::postSale()** (single artery: sales ledger + monthly financial roll-up + event, database.js:537-568).
- **db.notify** (info/success notifications, view.js:120,346) → Laravel Notifications (database channel).
- **db.log** activity entries inside postSale/saveVisaApp → AuditLog service (spatie/activitylog equivalent).
- **EPAL.doc** — branded Visa File Cover Sheet: serial `numberFor('visacover')`, parties/meta/doc-status rows/fee totals/amount-in-words (view.js:438-471) → a DocumentService + PDF template; serials from a SerialService.
- **EPAL.comments.widget('visaApps', id)** — per-application discussion with @mentions (view.js:429-432) → polymorphic `comments` table + mention notifications.
- **EPAL.charts** (analysis bars) and **EPAL.bus** are frontend-only; backend just supplies the aggregates.
