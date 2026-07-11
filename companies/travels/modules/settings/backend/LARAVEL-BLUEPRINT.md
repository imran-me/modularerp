# Settings — Laravel backend blueprint

Travels-specific configuration: company profile, financial defaults, document
numbering, notification preferences and data tools. Source of truth for the SPA
screen: `companies/travels/modules/settings/view.js`. Travels-specific override of
the shared `*/settings` view — it PRESERVES the same store key (`settings.travels`)
and every field the shared form used, so nothing downstream regresses. Admin-gated.

## Purpose & screens (pill-tabs via subId)
- **Profile** — identity: display/legal name, tagline, travel licence, IATA/ARC,
  BIN/VAT, contact, logo.
- **Financial** — currency, fiscal year, low-margin alert threshold (feeds
  Analytics), default credit limit, default VAT, notify-on-sale.
- **Documents** — invoice/voucher/statement prefixes, next running number,
  logo-on-docs, footer; a live sample-numbering preview.
- **Notifications** — primary channel + which alerts fire (passport/TTL/wallet/
  overdue-AR/contract) — these steer the Automation bots.
- **Data & Access** — links to Module Control / Workforce / Automation / Activity
  Log; export settings JSON; restore defaults; reload demo data.

## Entity & fields
`CompanySetting` — one JSON document keyed by company (`settings.travels`), or a
normalised `company_settings` table. Fields (all optional, defaulted in the form):
```
displayName, legalName, tagline, logo, licenseNo, iataNo, binVat,
phone, email, website, address,                                  (profile)
currency, fiscalNote, lowMarginAlert, defaultCreditLimit, invoiceTax, notifyOnSale, (financial)
invoicePrefix, voucherPrefix, statementPrefix, nextNumber, showLogoOnDocs, docFooter, (documents)
notifyChannel, alertPassport, alertTTL, alertLowWallet, alertOverdueAR, alertContract (notifications)
```
Each tab persists with a **shallow merge** (`EPAL.store.patch`) so tabs never
clobber one another — server-side, a partial update on the settings JSON.

## Business rules
- `lowMarginAlert` drives the Profit-Leak flag (Analytics); the `alert*` toggles
  gate the Automation bots; the prefixes/nextNumber feed the Serial/Document engine.
- Admin-only (owner/admin) — mirrors `admin:true` in the registry + `auth.can`.

## Routes (Laravel)
```
GET  /travels/settings[/{tab}]   -> settings tab (profile|financial|documents|notifications|data)
PUT  /travels/settings           -> partial update (per-tab patch)
GET  /travels/settings/export    -> settings JSON download
POST /travels/settings/restore   -> reset to defaults
```

## Controllers
- `SettingsController@show($tab)` / `@update` (validated per-tab, merge) /
  `@export` / `@restore`.

## Policies / permissions
- `settings.manage` (owner/admin only). Mirrors the registry `admin:true` flag.

## Events (group bridge)
- None. Settings are configuration; other modules read them.

## Engine dependencies
- Serial/Documents (prefixes & numbering) · Notifications/Automation (alert
  toggles) · Analytics (low-margin threshold). Laravel: a Settings service read by
  those services.
