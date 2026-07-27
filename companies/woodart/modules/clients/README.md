# Woodart · Clients

The people and companies Woodart builds for — homeowners, developers and
corporates. The master record behind every project and estimate, and where the
business answers *"who is worth the most, and who has gone quiet"*.

Built to the Woodart standard; `materials` is the reference module.

## Screens

| Route | Tab | What it shows |
|---|---|---|
| `#/woodart/clients` | Directory | 5 KPIs, an idle-client banner, and a searchable/filterable grid of every client |
| `#/woodart/clients/portfolio` | Portfolio | Each client's projects, contract value, cost, margin and won/open quotes — highest value first |
| `#/woodart/clients/segments` | Segments | Value by segment (bars + doughnut) and a per-segment breakdown |

Add / edit is a modal on **New Client** or by clicking any row. Delete is the
row action on the Directory grid, and it **warns when the client still has
projects or estimates** — those records are not deleted, they just stop matching
a client. Both respect `EPAL.perm.can('woodart','clients',…)`.

## Data it owns

| Frontend store | Table | Endpoint |
|---|---|---|
| `wa_clients` | `wa_clients` | `/api/woodart/clients/directory` |

Wired into `platform/data/api.js` **HYDRATE** and **WRITABLE**.

It also **reads** `wa_projects` and `wa_estimates` — never writes them.

Demo data is seeded two ways, deliberately in step: `platform/data/seed-bd.js`
(derived from the client names that actually appear on Woodart projects, so the
portfolio join finds real work) and `Database/Seeders/ClientSeeder.php` for MySQL.

## ⚠️ The join you need to know about

**Projects and estimates reference a client by NAME, not by id.** That is how
those stores were built and this module does not rewrite them (R2). The match is
`trim` + lowercase, defined in exactly two places that must stay in step:

- `frontend/api.js` → `key()`
- `backend/Services/ClientService.php` → `matchKey()`

Consequence: renaming a client breaks their history until the projects are
renamed too. The fix (a real `client_id` FK) is deferred until `projects` and
`estimates` are rebuilt — see `backend/LARAVEL-BLUEPRINT.md` § Known gaps.

## Files

```
frontend/
  template.html    THE SCREEN — all three tabs as plain HTML. No <script>, no <template>.
  api.js           THE DATA SEAM — the only file naming the store key. Read this first.
  clients.js       behaviour only: fill slots, clone proto rows, wire buttons, draw the chart
view.js            BUILD OUTPUT — never hand-edit
backend/
  endpoints.md     the frozen API contract (build the frontend against this)
  LARAVEL-BLUEPRINT.md  entities, business rules, and the honest list of gaps
  routes.php · ClientController.php · Services/ · Models/ · Http/ · migrations/ · Database/Seeders/
context.md         this module's memory — decisions, state, log
```

## Working on it

```bash
# after ANY edit under frontend/ — index.html loads view.js, not the sources
node tools/build/build-module.mjs companies/woodart/modules/clients

# if you added a tw- class, regenerate and prove the CSS is safe
npm run tw:build && npm run verify:tw

node tools/verify/sweep.mjs both        # 0 console errors, both themes
```

Backend, against local Laragon MySQL:

```bash
php artisan migrate --path=../../companies/woodart/modules/clients/backend/migrations
php artisan db:seed --class="Epal\Modules\Woodart\Clients\Database\Seeders\ClientSeeder"
```

Routes, classes and migrations are **auto-discovered**. Delete this folder and
the module disappears from the menus, the API and the migrator.

## Depends on

`EPAL.table` · `EPAL.formModal` · `EPAL.charts.doughnut` · `EPAL.ui` ·
`EPAL.perm`. No ledger or cash-kit dependency.

## What it deliberately does NOT do

**No ledger posting** — a client is a master record; money moves when a project
is billed. **No receivables or ageing** — that is Accounts/Ledgers, off the real
GL, and duplicating it here would give two answers to one question. **No CRM
pipeline** — leads belong to `crm`; this module starts once someone is a client.

## Read next

`companies/woodart/MODULE-STANDARD.md` · `platform/design-system/UI-CONTRACT.md` ·
`companies/woodart/CONTEXT.md`.
