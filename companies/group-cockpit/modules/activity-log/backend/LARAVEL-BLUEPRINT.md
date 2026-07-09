# Activity Log — Laravel backend blueprint

Source of truth: `companies/group-cockpit/modules/activity-log/view.js` (viewer) +
`platform/engines-library/audit.js` (the EPAL.audit engine that owns the data).
Route today: `#/group/activity-log`, admin-only (`module.json` sets `"admin": true`).

## Purpose & screens
Single screen — the group-wide, append-only audit-trail console ("who did what, when,
from where"). Registered as view `group/activity-log` (view.js:76). It contains:
- **Admin gate**: non-admins (`EPAL.auth.isAdmin()`) get a "Restricted — Admins only"
  denied state with a link back to the dashboard (view.js:85-89, 326-335).
- **Filter bar**: selects for User / Action / Entity / Company, free-text search,
  From/To date pickers, "Clear filters" and "Export CSV" buttons (view.js:97-153).
  Option lists are built from distinct values in the existing log plus employee
  names from `db.employees()` (view.js:92-100).
- **KPI tiles** over the *filtered* rows: Events Today (`at >= today 00:00`),
  Logins (`login`+`logout`), Changes (`create`+`update`), Deletes (view.js:179-196).
- **Event timeline**: newest-first rows, hard-capped at the first **300** events
  (view.js:218). Each row shows actor, verb, entity label, optional reason,
  company · full date · relative age · IP, plus an inline field-level diff of
  `changes` rendered as `field: old → new` (view.js:223-264).
- **CSV export**: downloads the filtered rows and *first records the export itself*
  to the audit trail — "audit the auditor" (view.js:274-301).
- **Live updates**: subscribes to bus event `audit:logged` and redraws (debounced
  140 ms); subscription torn down on route change (view.js:127, 170-173).

## Entities & fields
One entity. localStorage store key today: **`audit_log`** (audit.js:52, capped at 500 rows).

`audit_log` row (audit.js:104-118):
- `id` : string — `EPAL.ui.uid('AL')`, e.g. `AL-…`
- `at` : integer — ms epoch timestamp
- `user` : string — employee id (e.g. `EPL-0001`) or `'system'`
- `userName` : string — display name or `'System'`
- `action` : enum — create|update|delete|post|login|logout|approve|reject|export|config|permission|state (view.js:26-39)
- `entity` : string — source store name (visaApps, airTickets, employees, …)
- `entityId` : string
- `entityLabel` : string — human label, e.g. `Air Ticket TK-7009`
- `companyId` : string — company id or `'group'`
- `changes` : object|null — `{ field: { old, new } }` field-level diff
- `reason` : string
- `ip` : string (demo constant `127.0.0.1`)
- `agent` : string — user-agent

Read-only side data used for filter options: `employees` store (names) and
`EPAL.config.companies` filtered to `enabled` (view.js:55-62, 94).

## Business rules
- **Append-only**: rows are only ever added, never edited or deleted (audit.js
  header, lines 21-23). Today capped to the newest 500 rows (audit.js:53, 92-97);
  a real backend should retain everything (or prune via scheduled command).
- **Auto-audit firehose**: the engine listens to `data:changed` and records
  create/update/delete only for whitelisted stores (`LABELS`, audit.js:60-67);
  stores in `IGNORE` (notifications, serials, gl_entries, coa, audit_log itself…)
  are never audited (audit.js:71-74). `gl_entries`/`coa` are excluded because the
  ledger engine writes its own audit rows — no double-logging (audit.js:296-297).
- **create-vs-update disambiguation**: the FIRST write for an entityId is `create`;
  once a create exists, every later upsert is `update` (fallback: `create` only if
  the record's `created` date is today) (audit.js:256-271).
- **Explicit verbs**: transient `__auditAction` / `__auditReason` markers on a
  record let a flow (void/reissue) name its own action; they are stripped after
  reading (audit.js:251-254).
- **Login logging**: a `login` row is written at boot for the current user and on
  every `auth:changed` (View As / role switch) (audit.js:228-234, 286-294).
- **Filter semantics** (audit.js:126-144): user matches `user` OR `userName`
  exactly; action/entity/companyId exact; from/to inclusive ms-epoch bounds
  (view builds from as `date T00:00:00`, to as `date T23:59:59`, view.js:115-116);
  `q` is case-insensitive substring over userName+action+entity+entityLabel+
  entityId+reason. Results always sorted newest-first (audit.js:143).
- **Export is itself audited** before the file downloads: action `export`,
  entity `audit_log`, entityId `AUDIT-CSV`, entityLabel `Activity Log · N rows`,
  companyId from the active filter or `group`, reason `CSV export (user=…, …)`
  (view.js:287-292, 302-310).
- **Admin-only access** to the whole screen (view.js:85).

## Routes
```
GET  /group/activity-log                 -> viewer page (SPA)  [today: #/group/activity-log]
GET  /api/audit-logs                     -> filtered list (query: user, action, entity,
                                            company_id, q, from, to, limit<=300)
GET  /api/audit-logs/options             -> distinct users/actions/entities + enabled companies
GET  /api/audit-logs/kpis                -> {events_today, logins, changes, deletes} for same filter
POST /api/audit-logs/export              -> streams CSV; writes the self-audit row first
GET  /api/audit-logs/entity/{entity}/{id}-> forEntity() history (used by other modules)
```
No create/update/delete endpoints — the trail is written server-side only.

## Controllers
- `AuditLogController`
  - `index(Request)` — applies the filter semantics above, orders `at desc`,
    paginates (view caps display at 300); returns rows.
  - `options()` — distinct userName/action/entity values + enabled companies
    (mirrors view.js:92-100).
  - `kpis(Request)` — aggregate counts over the same filter (mirrors view.js:179-196).
  - `export(Request)` — records the `export` audit row via AuditService, then
    streams CSV with columns: Time, User, User ID, Action, Entity, Entity ID,
    Label, Company, Reason, Changes (`field: old -> new; …`), IP (view.js:275-284).
  - `forEntity(entity, entityId)` — newest-first history for one record.

## Models & migrations
`AuditLog` model — **read-only**: no `update()`/`delete()`; guard with a model
`updating`/`deleting` exception or DB trigger.
- `$fillable = ['at','user','user_name','action','entity','entity_id','entity_label','company_id','changes','reason','ip','agent']`
- `$casts = ['at' => 'datetime', 'changes' => 'array']`

Migration `audit_logs`:
- `id` (string PK `AL-…` or bigint + public uid), `at` timestamp (indexed),
  `user` string(32) indexed, `user_name` string, `action` string(16) indexed,
  `entity` string(64) indexed, `entity_id` string(64), `entity_label` string,
  `company_id` string(32) indexed, `changes` json nullable, `reason` string
  nullable, `ip` string(45), `agent` string. Composite index (`entity`,`entity_id`).
No `updated_at`; drop the 500-row cap (audit.js:44-46 recommends retaining all).

## Policies / permissions
- `AuditLogPolicy@viewAny` — owner/admin only, mirroring `EPAL.auth.isAdmin()`
  (view.js:85); everyone else gets 403 (the denied state, view.js:326-335).
- Export requires the same admin gate (button only exists inside the gated page).
- Writes are never user-initiated: only the AuditService (observer/listeners) inserts.

## Events
This module records no money/sales — it emits no business bridge events. It does
emit/consume the infrastructure event **`audit:logged`** (audit.js:121, view.js:171):
in Laravel, an `AuditLogged` event broadcast (e.g. private `audit` channel via
Echo/Reverb) so the viewer live-refreshes, replacing the bus subscription.

## Engine dependencies
- **EPAL.audit** (platform/engines-library/audit.js) — the owner of the data.
  Laravel: an `AuditService` (`record()`, `log()`, `forEntity()`, `diff()`) fed by
  a global Model Observer on created/updated/deleted (or spatie/laravel-activitylog)
  plus `Login`/`Logout` auth-event listeners. `diff()` = `Model::getChanges()`.
- **EPAL.auth** — `isAdmin()` gate + `current()` actor stamping → Gate/Policy + `auth()->user()`.
- **EPAL.db.employees()** + **EPAL.config.companies** — filter option sources →
  `Employee::pluck('name')`, `Company::where('enabled', true)`.
- **EPAL.bus** (`audit:logged`, `data:changed`, `auth:changed`) → Laravel events
  + broadcasting; `data:changed` firehose becomes the model observer.
- No use of ledger/approvals/serial/documents/intel/rules/comments engines here.
