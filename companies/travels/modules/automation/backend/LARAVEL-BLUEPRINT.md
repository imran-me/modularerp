# Automation — Laravel backend blueprint

The unattended operator for Epal Travels: a rules & bots engine, a live
Document-Expiry Radar, and a Markup Engine. Source of truth for the SPA screen:
`companies/travels/modules/automation/view.js`. This graduates the module off the
generic placeholder. Bots are bound to REAL data, so "pending actions" is never
fictional.

## Purpose & screens (pill-tabs via subId)
- **Overview** — active-automations / pending-actions / docs-≤30d / avg-markup
  KPIs, a "what the bots would do right now" panel (live match counts), and the
  automation log.
- **Rules & Bots** — the register: trigger → action → schedule → channel, live
  "matches now", toggle Active/Paused, Run Now, add/edit/delete.
- **Doc-Expiry Radar** — passports (`tv_passports.expiry`) + airline contracts
  (`tv_contracts.validTo`) approaching expiry, severity-bucketed.
- **Markup Engine** — per-service markup/tax rates + a live net → sell calculator.

## Entities & fields
`AutomationRule` (store `tv_automation`, seeded once):
| field | type | notes |
|-------|------|-------|
| id | string PK | `AUT-##` |
| name | string | |
| key | string | matcher binding: passport·contract·ttl·wallet·ar·markup·custom |
| kind | enum | Bot · Rule |
| trigger / action | string | human description |
| schedule | enum | On event · Hourly · Daily 09:00 · Weekly Mon 09:00 |
| channel | enum | WhatsApp · Email · SMS · Push · System |
| status | enum | Active · Paused |
| runs | int | lifetime run count |
| last_run | date | |

`MarkupRate` (store `tv_markup`, seeded once):
| field | type | notes |
|-------|------|-------|
| service | string PK | Air Ticketing·Visa·Package·Hotel·Insurance |
| markup | int (%) | applied to net |
| tax | int (%) | VAT on (net+markup) |
| enabled | bool | |

## Live matchers (each `key` → a real query)
| key | matches | source |
|-----|---------|--------|
| passport | passports expiring ≤6 months | `tv_passports.expiry` |
| contract | contracts expiring ≤30 days | `tv_contracts.validTo` |
| ttl | held tickets + TTL ≤3 days | `airTickets` / `air_ttl` |
| wallet | portals wallet < ৳20,000 (connected) | `tv_portals.balance` |
| ar | receivables overdue 30d+ | LedgerService `aging('AR')` |
| markup | active markup services | `tv_markup` |

## Business rules
- Run Now increments `runs`, stamps `last_run`, and (server-side) enqueues one Job
  per matched item on the rule's channel.
- Sell price = (net + net·markup%) then + tax% of that. Margin = markup / sell.
- Radar severity: Expired (days<0), ≤30, ≤90, OK.

## Routes (Laravel)
```
GET  /travels/automation                 -> overview
GET  /travels/automation/rules           -> rules & bots
POST /travels/automation/rules           -> create / update
PUT  /travels/automation/rules/{r}/toggle-> pause/activate
POST /travels/automation/rules/{r}/run   -> run now (dispatch Jobs)
GET  /travels/automation/radar           -> expiry radar
GET  /travels/automation/markup          -> markup rates + calculator
PUT  /travels/automation/markup/{s}      -> update a rate
```

## Controllers & scheduler
- `AutomationController@index|rules|store|toggle|run` — CRUD + dispatch.
- Each `key` maps to a Job (e.g. `NotifyExpiringPassports`) queried on its schedule
  via Laravel Task Scheduling (`app/Console/Kernel`).
- `RadarController@index`, `MarkupController@index|update`.

## Policies / permissions
- `automation.view` (Travels managers/owner), `automation.create`/`delete`
  (manager/owner). Mirrors `EPAL.perm.can('travels','automation',...)`.

## Events (group bridge)
- Bots notify (Notifications engine); the markup rule feeds pricing on sales
  (which post through the ledger/bridge as usual). Automation itself changes no
  numbers directly.

## Engine dependencies
- Notifications (bot dispatch) · Ledger (AR matcher) · the passport/contract/portal
  stores · a Scheduler. Laravel: Jobs + Task Scheduling + config.
