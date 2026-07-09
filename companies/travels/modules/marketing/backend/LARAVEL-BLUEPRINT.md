# Marketing & Messaging (Travels) — Laravel backend blueprint

Source of truth: `companies/travels/modules/marketing/view.js` (single registered view
`travels/marketing`, view.js:152). Route today: `#/travels/marketing`; four workspaces are local
pill tabs — `campaigns` (default), `templates`, `bot`, `sendlog` (view.js:145-150, 186-189).

## Purpose & screens
- **Campaigns** (view.js:199-246): KPI row (campaign count, total sent, delivery %, open %) +
  filterable/searchable table with CSV export, "New Campaign" modal, per-row "Send now" action and
  a detail modal (funnel bars, template preview, Send/Duplicate/Delete).
- **Templates** (view.js:393-512): CRUD library of message templates; live preview substitutes
  sample values into `{{name}}/{{destination}}/{{fare}}/{{date}}/{{agency}}` placeholders.
- **WhatsApp Bot** (view.js:515-707): chat simulator; bot answers fare/Umrah/visa queries from
  static fare book + live issued air tickets, offers "Create draft booking" into bot bookings;
  transcript persists; side panel lists draft bookings.
- **Send Log** (view.js:710-740): read-only delivery ledger of every send, with KPIs
  (sends, delivered, opened, avg open rate) and CSV export.

## Entities & fields
All persisted today via `EPAL.store` in localStorage, seeded idempotently (view.js:60-66).

**Campaign** — store `tv_campaigns` (shape view.js:102-106, 264-269)
- id: string, `CMP-###` seed / `ui.uid('CMP')` — name: string, required
- channel: enum WhatsApp|SMS|Email (view.js:35) — audience: enum All Customers|Leads|Visa Applicants|Ticket Buyers|Custom (view.js:36)
- template: string (template *name*, loose FK; lookup by name view.js:748)
- status: enum Draft|Scheduled|Sent — recipients, sent, delivered, opened: int
- scheduledFor: date string (YYYY-MM-DD) or '' — created: epoch ms

**Template** — store `tv_templates` (view.js:84-87, 477, 508-510)
- id: `TPL-###` / uid('TPL') — name: string, required — channel: enum (above)
- category: enum Promotional|Reminder|Transactional|Greeting (view.js:37)
- body: text, required, with `{{placeholder}}` tokens — created: epoch ms

**Message (send-log row)** — store `tv_messages` (view.js:118-122, 299-303)
- id: `MSG-####` / uid('MSG') — campaignId, campaignName, channel, audience
- recipients, delivered, opened: int — status: 'Delivered' (badges also style Failed/Queued, view.js:730)
- at: epoch ms

**BotBooking** — store `tv_bot_bookings` (view.js:128-132, 586-588)
- id: `BB-####` / uid('BB') — kind: enum Ticket|Umrah|Visa — route: string ('DAC → DXB')
- city, airline: string — fare: int (BDT) — passenger: string (always 'WhatsApp Guest')
- query: string (originating user text) — status: 'Draft' — created: epoch ms

**BotChatMessage** — store `tv_bot_chat` (view.js:137-139, 749)
- id: uid('BM') — from: enum bot|user — text: text — at: epoch ms
- offer: nullable object {kind, route, city, airline, fare, query} attached to bot replies (view.js:580)

Cross-store reads (other modules' data): `db.customers()`, `db.leads()`, `db.visaApps()`,
`db.airTickets()` (view.js:312-322, 699-707).

## Business rules
- **Audience reach** (view.js:312-322): All Customers = count(customers); Leads = count(leads);
  Visa Applicants = count(visa apps); Ticket Buyers = distinct air-ticket passengers
  (case-insensitive); Custom = fixed 250.
- **New campaign** (view.js:262-275): status = `Scheduled` if scheduledFor set else `Draft`;
  recipients = audienceCount; sent/delivered/opened = 0; emits an in-app notification.
- **Send now** (view.js:281-310): blocked if already Sent; requires confirm. reach =
  audienceCount || recipients, floor 50. delivered = round(reach × rand(0.90–0.98)). opened =
  round(delivered × channel rate): Email 0.28–0.56, SMS 0.08–0.18, WhatsApp 0.52–0.82. Sets
  status=Sent, scheduledFor defaults to today, appends a `tv_messages` row (status Delivered),
  fires notification + toast. In Laravel: make delivered/opened webhook-updated counters; keep
  the same single-send guard.
- **Duplicate** (view.js:365-370): new id, name + ' (copy)', status Draft, counters zeroed.
- **Rates** (view.js:205-206, 342-343, 718): delivery% = delivered/sent; open% = opened/delivered
  (rounded); computed, never stored.
- **Template validation** (view.js:506-507): name and body both required (trimmed).
- **Placeholder substitution** (view.js:752-759): case-insensitive `{{ name }}` etc. for
  name/destination/agency/date/fare only.
- **Bot intent routing** (view.js:640-696): regex intents — Umrah/Hajj → fixed package ৳165,000
  + JED flight quote; "visa" → ৳6,500 service fee quote + live visa-app count; destination
  detected from keyword map (9 airport codes, view.js:686-693) → fare list sorted ascending,
  cheapest flagged "(best)"; generic fare words → destination prompt; else greeting fallback.
- **Live fare override** (view.js:699-707, 677-681): min positive `sale||cost` among issued air
  tickets matching `toCode`/route; used when lower than the static book's cheapest.
- **Draft booking** (view.js:585-597): from a bot offer; passenger 'WhatsApp Guest', status
  'Draft'; notification + confirmation bot message with reference id.
- **Chat reset** (view.js:528-531): replaces transcript with the single seeded greeting.

## Routes
```
GET    /travels/marketing/campaigns            index (+ ?search, ?channel=, ?status=, CSV export)
POST   /travels/marketing/campaigns            store
GET    /travels/marketing/campaigns/{id}       show (detail modal data incl. funnel)
POST   /travels/marketing/campaigns/{id}/send  sendNow (409 if already Sent)
POST   /travels/marketing/campaigns/{id}/duplicate
DELETE /travels/marketing/campaigns/{id}
GET|POST /travels/marketing/templates ; PUT|DELETE /templates/{id}
GET    /travels/marketing/templates/{id}/preview   (rendered with sample values)
GET    /travels/marketing/send-log             index (+ ?channel=, CSV)
GET    /travels/marketing/bot/chat             transcript
POST   /travels/marketing/bot/message          user text → bot reply (+optional offer)
DELETE /travels/marketing/bot/chat             reset to seed greeting
GET|POST /travels/marketing/bot/bookings       list drafts / create from offer
GET    /travels/marketing/audience-count?audience=…
```

## Controllers
- **CampaignController** — index (rows + KPI aggregates), store, show, send (guard + counts +
  MessageLog row + event), duplicate, destroy.
- **TemplateController** — index, store, update, destroy, preview (fillTemplate w/ SAMPLE values).
- **SendLogController** — index (desc by `at`, KPI aggregates).
- **BotController** — chat, message (intent engine port of botReply/detectDest/liveFareFor),
  reset, bookings, storeBooking.
- **AudienceController** — count (port of audienceCount).

## Models & migrations
- `Campaign` fillable: name, channel, audience, template_name, status, recipients, sent,
  delivered, opened, scheduled_for, legacy_id; casts: counters int, scheduled_for date.
  Migration: id, name, channel, audience, template_name nullable, status default 'Draft',
  4 unsignedInteger counters default 0, scheduled_for date nullable, timestamps.
- `MessageTemplate` fillable: name, channel, category, body; body text column.
- `MessageLog` fillable: campaign_id FK, campaign_name, channel, audience, recipients,
  delivered, opened, status default 'Delivered', sent_at timestamp.
- `BotBooking` fillable: kind, route, city, airline, fare, passenger, query, status
  default 'Draft'; fare unsignedInteger (BDT whole taka).
- `BotChatMessage` fillable: sender ('bot'|'user'), text, offer (json nullable), sent_at.
- Seeders must reproduce the seed rows at view.js:68-140 (6 templates, 8 campaigns,
  5 log rows, 2 bookings, 1 greeting) so demo parity holds.

## Policies / permissions
The view uses no `EPAL.auth` / permission checks — any signed-in Travels user can do everything.
Laravel: gate the whole module behind company access (`travels`) only; no per-action roles yet.

## Events
No ledger/money postings exist in this module — do NOT emit financial events. Emit for the
group bridge / notification center (mirrors `db.notify` calls):
- `marketing.campaign.created` (view.js:271) — `marketing.campaign.sent` (view.js:305)
- `marketing.bot.booking_drafted` (view.js:590) — payloads: campaign/booking id, name, reach.

## Engine dependencies
- `EPAL.store` (localStorage CRUD + seedOnce) → Eloquent + DB seeders.
- `db.notify` → Laravel Notification / event → group notification center.
- `ui.uid('CMP'|'MSG'|'BB'|'BM'|'TPL')` → auto-increment ids with prefixed reference strings
  (keep `CMP-`, `MSG-`, `BB-`, `TPL-` display prefixes).
- Read-only dependence on other Travels modules' stores: customers, leads, visa apps, air
  tickets (audience counts + live fare lookup) → repository/service queries, not FK writes.
- No use of EPAL.ledger / approvals / serial / documents / intel / rules / comments engines.
