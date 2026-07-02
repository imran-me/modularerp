# Architecture

## Principles

1. **Data-driven** — the app is generated from `core/config.js`, not hand-written HTML.
2. **One door per concern** — persistence (`state.js`), events (`eventbus.js`),
   formatting/DOM (`ui.js`), data (`database.js`). Swap the backend by rewriting
   `state.js` + `database.js` only.
3. **No build step** — plain `<script>` tags, self-registering views, CDN vendors.
   Works from `file://`.
4. **Progressive depth** — unbuilt screens fall back to a live scaffold, so the app is
   always fully navigable and modules graduate one at a time.

## Boot sequence (`core/app.js` → `App.init`)

```
1. EPAL.db.seed()                 idempotent demo data
2. EPAL.modules.applyOverrides()  fold saved on/off flags onto config
3. applyTheme()                   paint dark/light before first render
4. renderShell()                  build rail + sidebar + topbar from registry
5. bindGlobal()                   Ctrl-K, bus subscriptions
6. router.mount = #view
7. router.start()                 render the current hash route
```

## The layers

| Layer | File | Responsibility |
|---|---|---|
| Registry | `core/config.js` | companies → modules → subs; the source of truth |
| Persistence | `core/state.js` | namespaced localStorage + module override engine |
| Events | `core/eventbus.js` | pub/sub; cross-company sync + cross-tab rebroadcast |
| UI kit | `core/ui.js` | `el()` hyperscript, formatting, toast/modal/confirm |
| Charts | `core/charts.js` | theme-aware Chart.js factory (destroy-on-route) |
| Data | `core/database.js` | seeded mock DB + aggregators (`groupSnapshot`, `series`, `riskScore`) |
| Auth | `core/auth.js` | roles, `can()`, company scoping, View-As |
| Router | `core/router.js` | `#/co/mod/sub` → gates → view resolution |
| Shell | `core/app.js` | rail, sidebar, topbar, command palette, notifications |
| Views | `views/**` | one screen per file, self-registered into `EPAL.views` |

## Data flow (why the group stays "connected")

```
A view mutates data
   └─ calls EPAL.db.saveX(...)          (never localStorage directly)
        ├─ writes through EPAL.store    (localStorage)
        └─ EPAL.bus.emit('data:changed' | 'sale:recorded' | 'task:updated' | …)
             └─ dashboards / notifications / other companies react
```

Because dashboards **compute** from `EPAL.db` on every render (rather than caching),
any navigation back to a dashboard reflects the latest state. The event bus additionally
enables live widgets and cross-tab updates.

## Rendering model

- A **view** is `{ title?, render(ctx), teardown? }`. `render` receives
  `ctx = { mount, companyId, moduleId, subId, company, module, sub, params, router }`.
- Views build DOM with `EPAL.ui.el()` and append to `ctx.mount`.
- On every route change the router calls the previous view's `teardown()` (used e.g. by
  the task board to clear its 1-second timer) and `EPAL.charts.destroyAll()` to avoid
  Chart.js canvas leaks.

## Why not Bootstrap / a framework?

The brief explicitly asked for a look that is **not** a generic Bootstrap dashboard, and
for something maintainable with clear file navigation. A bespoke CSS design system
(driven by custom properties) delivers the premium aesthetic without class conflicts,
and vanilla self-registering views keep the mental model tiny. Bootstrap *Icons* are the
only Bootstrap dependency. Migrating to a framework later is straightforward because the
data/auth/routing layers are framework-agnostic.

## Security note (current stage)

This stage is a **client-side prototype**: all data and "permissions" live in the
browser. Role gating here is UX, not security. When a backend is added, enforce
auth /permissions server-side; `core/auth.js` then becomes the client mirror of the
server's policy.
