# Notification Center — Laravel backend blueprint

> Source of truth: `companies/group-cockpit/modules/notifications/view.js` (route `#/group/notifications`,
> registered via `EPAL.view('group/notifications', …)` — view.js:46) plus the shared writer
> `EPAL.db.notify()` in `platform/data/database.js:613`. Rebuild 1:1; no invented features.

## Purpose & screens

Single screen — the group-wide alert inbox for the owner account (module.json: menu is empty; one route).

1. **Header actions** (view.js:57-80)
   - *Clear Read*: confirm-guarded bulk delete of all `read == true` notifications; toast "Nothing to clear" if none (view.js:61-73).
   - *Mark All Read*: sets `read = true` on every notification (view.js:74-78 → database.js:609-612).
2. **KPI row** (view.js:83-88): Unread (`!read`), Today (`at >= start of today`, view.js:39-41,52), Critical (`level === 'error'`), Total.
3. **Alert Mix doughnut** (view.js:91-99,171-184): notification counts grouped by `level`; fixed colors info `#2f6bff`, success `#23c17e`, warning `#f4b740`, error `#f0506e`, fallback `#8b93a7` (view.js:23,181).
4. **Preferences card** (view.js:188-214): four boolean switches persisted to the `notif_prefs` store key; "Stored group-wide · applies to the owner account".
5. **Inbox table** (view.js:104-167): pill tabs All/Unread/Read (view.js:105-121); columns Level (badge), Title, Message, Company (company badge, fallback label `group` — view.js:34-38,130), When (relative time; export as ISO), State (Read/Unread badge). Level dropdown filter; search over `title,text,companyId`; CSV export `group-notifications.csv`; page size 12 (view.js:141-144). Row actions: **Mark read** (no-op toast "Already read" if already read — view.js:146-152) and **Delete** (confirm-guarded permanent remove — view.js:153-163).

## Entities & fields

**Notification** — today: localStorage store `notifications` (ns `epal.v1.`), sorted `at` DESC on read (database.js:455). Shape set by `db.notify()` (database.js:613-616) + view usage:

| field     | type                                            | notes |
|-----------|-------------------------------------------------|-------|
| id        | string PK (uid prefix `N`)                      | server-generated |
| level     | enum `info|success|warning|error`, default `info` (view.js:175) | severity |
| title     | string                                          | e.g. "Automation · <rule>" |
| text      | string nullable                                 | message body |
| companyId | string nullable, FK to company registry, fallback `group` (view.js:36) | which sister concern |
| icon      | string nullable                                 | bootstrap-icon name, set by some producers |
| at        | timestamp (ms epoch today), default now         | created-at |
| read      | boolean, default false on create (database.js:614) | inbox state |

**NotificationPreference** — today: store key `notif_prefs`, one object per owner account (view.js:189-198):
`saleAlerts`, `riskAlerts`, `taskComments`, `hrEvents` — all boolean, all default `true`.

## Business rules

- Creation is centralised: producers (automation rules, approvals, comments, task board, CRM wins) call `db.notify(n)`; it stamps `id`, `at = now`, forces `read = false`, and emits a `notify` event (database.js:613-616). Laravel: one `NotificationService::push()` used by all modules.
- "Today" KPI = `at >= midnight local` (view.js:39-41,52). "Critical" = `level === 'error'` (view.js:53).
- Mark-read is idempotent per row (already-read rows rejected with info message, view.js:147).
- Clear-Read deletes only read rows and keeps unread; irreversible; requires confirmation (view.js:62-72).
- Delete of a single notification is permanent and confirm-guarded (view.js:153-163).
- Any mutation must emit a data-changed signal so the topbar bell/unread count refreshes (view.js:69,159; platform/core/app.js:326). Laravel: broadcast event or polled unread-count endpoint.
- Preferences save is a whole-object overwrite of the 4 switches (view.js:207-209). Note: the view only *stores* prefs; no code path currently reads them to suppress alerts — replicate as stored settings, do not invent filtering.

## Routes

```
GET    /group/notifications                 index (filters: state=all|unread|read, level, q; paginate 12)
GET    /group/notifications/export          CSV (group-notifications.csv; `at` as ISO-8601, state as read|unread)
GET    /group/notifications/stats           KPIs {unread, today, critical, total} + level mix counts
PATCH  /group/notifications/{id}/read       mark one read (409/no-op message if already read)
POST   /group/notifications/mark-all-read   bulk mark read
DELETE /group/notifications/{id}            delete one
DELETE /group/notifications/read            bulk-delete all read ("Clear Read")
GET    /group/notification-preferences      fetch prefs (defaults all true)
PUT    /group/notification-preferences      save the 4 booleans
POST   /internal/notifications             (service-only) producer endpoint = db.notify()
```

## Controllers

- **NotificationController**
  - `index(Request)` → paginated JSON/view; applies state pill, level filter, search on title/text/companyId; default sort `at` DESC.
  - `stats()` → `{unread, today, critical, total, mix: {level: count}}`.
  - `export(Request)` → streamed CSV with the 6 table columns.
  - `markRead(Notification)` → updates `read=true`; returns fresh unread count.
  - `markAllRead()` → mass update; returns count affected.
  - `destroy(Notification)` → deletes; returns 204.
  - `clearRead()` → deletes where `read=true`; returns count deleted (used in confirm copy, view.js:64).
- **NotificationPreferenceController**: `show()` → the 4 booleans (with defaults); `update(Request)` → validated booleans, upsert per owner.

## Models & migrations

**Notification** (`notifications` table — rename to `erp_notifications` if it clashes with Laravel's built-in):
- fillable: `level, title, text, company_id, icon, read`
- casts: `read => boolean`, `at => datetime` (or use `created_at` as `at`)
- migration: `id (string/ulid pk)`, `level enum(info,success,warning,error) default info`, `title string`,
  `text text nullable`, `company_id string nullable index`, `icon string nullable`, `read boolean default false index`,
  `at timestamp index`, timestamps. Indexes on `(read)`, `(at)`, `(level)` mirror the KPI/filter queries.

**NotificationPreference** (`notification_preferences`):
- fillable: `user_id, sale_alerts, risk_alerts, task_comments, hr_events`
- casts: all four flags `boolean` (default `true`)
- migration: `id`, `user_id unique FK`, four `boolean default true` columns, timestamps.

## Policies / permissions

The SPA gates this route to the Group command layer (owner/admin session); the view itself checks no
granular permissions — Preferences copy says "applies to the owner account" (view.js:206). Laravel:
`NotificationPolicy` — `viewAny/markRead/markAllRead/delete/clearRead` allowed only for group-admin (owner)
role; preference endpoints scoped to the authenticated owner. Producer endpoint is internal/service-auth only.

## Events

This module records no money/sales — it only consumes alerts. Emit infrastructure events, not bridge events:
- `NotificationCreated` (fired by the service on push — mirrors bus `notify`, database.js:615) → drives topbar bell.
- `NotificationsChanged` (on read/mark-all/delete/clear — mirrors `data:changed {store:'notifications'}`, view.js:69,159; database.js:611) → unread-count refresh for dashboards.

## Engine dependencies

- **EPAL.db / EPAL.store** (`notifications`, `notif_prefs` keys) → Eloquent models above + a `NotificationService` facade every other module injects (rules.js, approvals.js, comments.js, tasks board, CRM all call `db.notify`).
- **EPAL.bus** (`data:changed`, `notify`) → Laravel events + broadcasting (or polling `GET /stats`).
- **EPAL.config.company(cid)** (badge colors/short names, view.js:34-38) → company registry lookup/service.
- **EPAL.table / EPAL.charts / EPAL.form** are pure frontend; backend only supplies the filtered list, stats mix, and CSV.
- No ledger, serial, approvals, documents, intel, or comments engine calls inside this view.
