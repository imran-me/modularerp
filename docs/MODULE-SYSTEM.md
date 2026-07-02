# The Module System

> How "everything is modular" actually works. This is the heart of the ERP.

## The registry (`assets/js/core/config.js`)

The whole system is declared as one nested data structure:

```
EPAL.config.companies = [
  { id:'group', type:'group', modules:[ … ] },
  { id:'travels', type:'company', accent:'#2f6bff', modules:[
      { id:'visa-processing', label:'Visa Processing', icon:'passport-fill',
        subs:[ {id:'categories',…}, {id:'new-application',…}, … ] },
      …
  ]},
  … woodart, it, shop, construction
]
```

Every node has `enabled` (default) and, for modules, optional `admin`, `badge`, `subs`.
The **sidebar, rail, command palette, breadcrumbs, router and dashboards read from
here** — nothing is hard-coded in HTML.

## The override layer (`assets/js/core/state.js`)

Defaults live in the registry; the admin's changes live separately as **overrides**
in `localStorage["epal.v1.module-overrides"]`:

```json
{
  "travels": false,                          // whole company off
  "travels/visa-processing": false,          // one module off
  "travels/visa-processing/analysis": false  // one sub-feature off
}
```

Absence of a key = "use the registry default".

### The three functions that matter

```js
EPAL.modules.isEnabled(companyId[, moduleId[, subId]])  // the single truth-check
EPAL.modules.toggle(companyId, moduleId, subId, value)  // persist + broadcast
EPAL.modules.applyOverrides()                            // fold overrides onto config
```

`applyOverrides()` runs at boot and after every toggle, so `config.*.enabled` is always
truthful. `isEnabled()` is what the rail, sidebar, palette and router all consult.

## The reactive loop

```
Admin flips a switch (Module Control)
      │  EPAL.modules.toggle(...)
      ▼
localStorage override written  +  bus.emit('modules:changed')
      │
      ├─▶ app.js re-renders the sidebar & rail (hidden if disabled)
      ├─▶ command palette rebuilds its index
      └─▶ router re-gates: navigating to a disabled route shows a clean
          "switched off" state instead of the view
```

No page reload. No code edit. That's the whole promise.

## Safety locks

`group/dashboard` and `group/module-manager` are hard-locked ON (see `LOCKED` in
`views/admin/module-manager.js`) so you can never disable the screen you'd need to
re-enable everything.

## Permissions vs. modules (two independent gates)

A route renders only if **both** pass:

1. **Enabled?** `EPAL.modules.isEnabled(...)` — the admin's on/off choice.
2. **Permitted?** `EPAL.auth.can(companyId, moduleId)` — the user's role/grants.

The router (`core/router.js`) checks enabled first, then permission, then renders the
view (or the placeholder scaffold). Each failure has its own polished gate screen.

## Adding to the registry

```js
// a new module on Epal Shop, with two features:
m('loyalty', 'Loyalty', 'gift-fill', { desc:'Points, tiers & rewards.',
  subs:[['members','Members'],['rewards','Rewards']] })
```

Drop that into the `SHOP_MODULES` array in `config.js`. It appears in the sidebar and
command palette immediately, with a live scaffold — no other wiring required. Give it a
real screen later via `docs/VIEWS-GUIDE.md`.
