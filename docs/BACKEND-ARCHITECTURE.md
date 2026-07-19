# Backend Architecture — Modular Laravel Kernel

> Companion to `EPAL_GROUP_ERP_Modular_Architecture.md` (the frontend's modular
> design). This document is the **backend half** of the same idea, applied
> consistently: a module's backend lives in the same folder as its frontend,
> and deleting that folder removes both together.

## The core idea (unchanged from the frontend)

> **A module is a folder you can delete or drop back in — now on the backend too.**

```
companies/group-cockpit/modules/master-accounts/
├── view.js            <- frontend screen (existing)
├── module.json         <- manifest (existing)
└── backend/            <- NEW: this module's Laravel slice
    ├── routes.php       its API routes
    ├── *Controller.php  its logic (namespaced, autoloaded by the kernel)
    ├── migrations/       its own tables (optional — most modules read
    │                     tables that already exist in the imported DB)
    └── bridge.map        what it rolls up to the Group (future phase)
```

Delete `master-accounts/backend/` → its API routes and migrations vanish.
The screen (`view.js`) still exists but simply has no backend to call — an
honest "unavailable" state, not a crash. Nothing else in the system notices.

## Where the kernel itself lives

```
platform/backend/                    <- the Laravel APPLICATION (never a module)
├── app/Providers/ModuleServiceProvider.php   <- THE auto-discovery engine
├── app/Http/Controllers/AuthController.php   <- kernel-level login (Sanctum)
├── app/Models/User.php
├── routes/api.php                    <- ONLY: /login /logout /me /health
├── routes/web.php                    <- serves the SPA shell at "/"
├── public/                            <- the web root (see deploy.sh)
├── .env                               <- REAL secrets. Never committed.
└── deploy.sh                          <- run after every `git pull` on the server
```

`platform/backend/routes/api.php` intentionally carries almost nothing.
**Every module's own routes are registered by the module itself** — the
kernel only owns the pieces that belong to no single module: sign-in and the
health check.

## How auto-discovery works (`ModuleServiceProvider`)

On every request boot, the provider:

1. Scans `companies/*/modules/*/backend/` and `companies/*/app/backend/` with
   a filesystem `glob()` — no central list, no config file to edit.
2. For each folder found, `require`s its `routes.php` under the shared
   `/api` prefix, and registers its `migrations/` folder with the migrator.
3. Resolves classes under the namespace `Epal\Modules\<Company>\<Module>\*`
   to that folder at runtime (a tiny custom autoloader) — so a freshly
   dropped module needs no `composer dump-autoload`.

```
boot -> scan companies/*/modules/*/backend -> for each folder found:
           load routes.php, add migrations/, autoload its classes
                                          |
                       folder missing? -> nothing registered, module absent
```

This is **proven, not theoretical** — verified 2026-07-16 by physically
renaming a module's `backend/` folder away and confirming its route
disappeared from `php artisan route:list`, then reappeared when restored.

## Why "import the data, not the old accounting logic"

The owner's explicit instruction (2026-07-16): the OLD ERP's books are
wrong — bugs, double-postings, missing entries (see the bookkeeping audit
memory). So:

- **Reused from the old system:** its real data (326 accounts, banks,
  customers, employees…), its password hashes (bcrypt — `Hash::check`
  works unmodified), its schema (176 tables, imported as-is).
- **NOT reused:** its ticket-sale/journal-posting PHP logic. Every module
  controller in `companies/*/backend/` is a fresh, deliberately simple
  READ/translate layer — old-schema row in, frontend-shape JSON out. No
  accounting decisions are made in these controllers. The correct posting
  logic is the NEW system's ledger engine (`platform/engines-library/ledger.js`,
  already audited and fixed) — write endpoints will call into equivalent
  *new* logic, not the old one, when that phase starts.

## The frontend swap (how real data reaches the screen)

Three pieces, entirely additive — the old demo-data path is untouched and
still runs standalone (e.g. the static GitHub Pages preview):

| File | Job |
|---|---|
| `platform/data/api.js` | Resolves **demo vs. real** mode once per load, hydrates the store from the backend in parallel, one call per collection. |
| `platform/auth-rbac/login-screen.js` | The pre-boot sign-in gate — shown only in real-data mode with no valid token. |
| `platform/core/app.js` (`init`/`start`) | The boot split: real-data mode fetches from the API instead of seeding demo fixtures; demo mode is `start(false)`, byte-identical to before. |

**Mode detection is intentionally strict** — a stray same-origin `/api/health`
returning `200` (e.g. a static host's SPA-fallback) is NOT enough to trigger
real-data mode. The response body must contain the kernel's exact marker
(`{"service":"epal-kernel"}`). This is what keeps the static preview site
safely in demo mode even after the backend exists elsewhere.

## Deployment shape — ONE origin for frontend + API

Owner directive (2026-07-16): one subdomain serves both, like the old ERP —
no second subdomain, no CORS.

```
dev.epal.com.bd  (docroot -> platform/backend/public/)
        |
        +-- "/"          -> Laravel serves the real index.html (routes/web.php)
        +-- "/api/*"      -> Laravel API routes (kernel + every discovered module)
        +-- "/platform/*" -> symlinks to platform/'s FRONTEND subfolders only
        +-- "/companies/*"-> symlink to companies/ (frontend assets; the
                              backend/ subfolders inside are read by PHP
                              `require`, never served over HTTP)
```

**`platform/backend/` is never reachable over HTTP as a folder.** Its `public/`
subfolder IS the docroot (that's normal Laravel); everything else in
`platform/backend/` — `.env`, `app/`, `vendor/`, `storage/` — is symlinked
from nowhere and therefore has no URL. See `platform/backend/deploy.sh` for
the exact mechanism and the reasoning (the script's header explains the one
security decision that matters: never symlink `platform/` as a whole).

## Running deploy.sh (on the server, after `git pull`)

```bash
cd domains/epal.com.bd/public_html/modularerp/platform/backend
bash deploy.sh
```

Idempotent — safe to run after every pull, even when nothing backend-related
changed. First run creates `.env` from the example and stops with a reminder
to fill in the real `DB_DATABASE` / `DB_USERNAME` / `DB_PASSWORD`; re-run
after that to finish (key generation + config cache).

**Then point the subdomain's document root at `platform/backend/public`**
(one-time hPanel change, same place the original `dev` subdomain docroot was
set — see the hosting-pipeline notes in project memory for the exact panel
path).

## Deliberately not done yet (next phases)

- **Write endpoints.** Every module route today is a `GET` (read-only). A
  ticket sale, a journal post, a bank deposit from the new UI going all the
  way to the real database is the next phase, and it must call the *new*
  ledger logic — not the old system's — per the "don't import the wrong
  accounting" rule above.
- **Route caching is deliberately OFF** (`deploy.sh` never runs
  `route:cache`). This app discovers module routes live, on every request —
  that's what makes the drop-a-folder behaviour real-time. Caching the route
  table would freeze it and silently break that until someone remembered to
  re-cache after every module change.
- **Company-scoped logins.** Today's `AuthController` maps `company_id IS
  NULL` → group scope, otherwise → that company. Real per-company user
  provisioning (so a Travels staff member logs in and sees only Travels)
  is unbuilt.
- **The other four companies' backends** (Woodart, IT, Shop, Construction) —
  Group + Travels were the explicit starting scope; the same pattern
  (blueprint already exists per module in most cases) repeats for the rest.
