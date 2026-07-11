# CRM — Laravel backend blueprint

The Travels demand desk: leads → pipeline → won business, plus the activity /
communication log. Source of truth for the SPA screen:
`companies/travels/modules/crm/view.js`. Travels-specific override of the shared
`*/crm` view. A **won** lead posts a sale through the same artery as the rest of
the group (`db.postSale`), so Travels + Group finance move live.

## Purpose & screens
- **Overview** (`/crm`, default) — cockpit: open / pipeline / weighted-forecast /
  won / win-rate / follow-ups KPIs, an Action Center (stale leads, hot
  negotiations, owed follow-ups), a stage funnel, source mix, recent activity.
- **Pipeline** (`/pipeline`) — drag-drop Kanban across the 7 stages; a drop on
  **Won** posts the sale once (guarded).
- **Leads** (`/leads`) — rich register (chips by stage) + row-click lead detail.
- **Follow-ups** (`/follow-ups`) — touchpoints needing follow-up, with mark-done.
- **Comm Hub** (`/comm-hub`) — full activity stream + log call/email/meeting/WA.

## Entities & fields
`Lead` (store `leads`; `db.leads('travels')`):
| field | type | notes |
|-------|------|-------|
| id | string PK | `LD-####` |
| company_id | string | `travels` |
| name | string | person / lead name |
| company | string? | organisation |
| contact / phone / email | string? | contact channel (for WA/Gmail) |
| source | enum | Website·Referral·WhatsApp·Facebook·Walk-in·Cold Call·Fair |
| stage | enum | New·Contacted·Qualified·Proposal·Negotiation·Won·Lost |
| value | int (BDT) | estimated deal value |
| owner | string | employee id (EPL-####) |
| close_date | date? | expected close |
| created | date | |
| posted | bool | true once a Won lead has posted its sale (idempotency guard) |

`Activity` (shared store `crm_activities`; Travels rows tagged `company_id`):
| field | type | notes |
|-------|------|-------|
| id | string PK | `ACT-######` |
| company_id | string? | `travels` on rows logged here (seed feed has none) |
| type | enum | Call·Email·Meeting·WhatsApp·Site Visit·Follow-up |
| lead / company | string | who / which org |
| outcome | enum | Positive·Neutral·Needs follow-up |
| note / by / date | string | narration, author, when |

Derived: weighted value = value × stage probability (New .1 → Negotiation .8 →
Won 1); idle days = today − last touch (last activity for that lead, else created);
stale = open lead idle > 14 days.

## Business rules
- Stage → **Won** posts a sale via SaleService exactly once (`posted` guard) →
  DR AR / CR Revenue in the ledger, Group consolidation updates.
- Stage → **Lost** closes with no financial impact.
- Win rate = won / (won + lost); pipeline & forecast use open stages only.

## Routes (Laravel)
```
GET  /travels/crm                 -> overview (KPIs + cockpit)
GET  /travels/crm/pipeline        -> kanban board
PUT  /travels/crm/leads/{l}/stage -> move stage (Won → SaleService)
GET  /travels/crm/leads           -> register
POST /travels/crm/leads           -> store
PUT  /travels/crm/leads/{l}       -> update
DELETE /travels/crm/leads/{l}     -> destroy
GET  /travels/crm/follow-ups      -> pending follow-ups
GET  /travels/crm/comm-hub        -> activity stream
POST /travels/crm/activities      -> log activity
```

## Controllers
- `LeadController@index/@store/@update/@destroy` — Travels-scoped leads + KPIs.
- `PipelineController@move` — validated stage transition; Won → `SaleService::post`.
- `ActivityController@index/@store` — scoped activity feed + logging; mark-done.

## Models & migrations
- `Lead` (fillable name, company, contact, phone, email, source, stage, value,
  owner_id, close_date, company_id; casts value int, close_date date; belongsTo
  Employee owner). Accessor `weighted`, scope `open()`.
- `Activity` (fillable type, lead, company, outcome, note, by, date, company_id).
- migrations `leads`, `crm_activities` (+ company/stage indexes).

## Policies / permissions
- `crm.view` (Travels sales+), `crm.create`/`crm.delete` (sales/manager/owner).
  Mirrors `EPAL.perm.can('travels','crm',...)`.

## Events (group bridge)
- Won lead → SaleService → `sale:recorded` (ledger auto-posts) → Group
  consolidation. A large enquiry may also emit `payment.received` on advance.

## Engine dependencies
- Sale/Ledger (won→revenue) · Comments (per-lead discussion) · Notifications
  (deal-won toast) · Audit (stage moves). Laravel: shared Services.
