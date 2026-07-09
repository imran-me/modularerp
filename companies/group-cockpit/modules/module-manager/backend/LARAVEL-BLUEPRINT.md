# Module Control (group/module-manager) — Laravel backend blueprint

> Source of truth: `companies/group-cockpit/modules/module-manager/view.js` (screen + rules)
> and `platform/data/state.js` (the `EPAL.modules` override engine it drives).
> This is an **admin-only feature-toggle console**: no business documents, no money.

## Purpose & screens
Single screen, route `#/group/module-manager` (view.js:20). It realises the owner directive
"if I add Travels it appears; if I turn it off it disappears — everywhere, no code change" (view.js:4-6).

1. **Summary KPI row** (view.js:47-63) — four computed tiles:
   - *Active Concerns* = count of `type==='company'` companies currently enabled, shown as `n / 5` (view.js:50, 54).
   - *Live Modules* = modules enabled AND whose parent company is enabled, `on / total` (view.js:51, 55).
   - *Overrides Set* = number of keys in the persisted override map (view.js:56).
   - *System Health* = static label "Optimal" (view.js:57) — cosmetic, no backend logic.
2. **Company accordion cards** (view.js:76-112) — one card per registry company; header shows
   name, tagline, `modsOn/total modules on`, Enabled/Disabled badge, and a **master switch**
   toggling the whole company (view.js:114-122). The `group` company shows "Always on" instead
   of a switch (view.js:92-93).
3. **Module rows** inside each card (view.js:124-159) — per-module switch, Admin/badge chips,
   `x/y features on` counter, and an expandable **sub-feature drawer** with a switch per sub
   (view.js:147-155).
4. **Reset to defaults** header action (view.js:29-34) — confirm dialog, then wipes the whole
   override map (`EPAL.store.set('module-overrides', {})`), re-applies, emits `modules:changed`.

## Entities & fields
Today's persistence: ONE localStorage store, `epal.v1.module-overrides` (state.js:55, 109-114).

**ModuleOverride** (table `module_overrides`, a.k.a. feature toggles) — sparse map, key -> bool:
- `path` : string, unique — `companyId` | `companyId/moduleId` | `companyId/moduleId/subId`
  (built by `keyFor`, `.join('/')`, state.js:119-121)
- `enabled` : boolean — the override value. **Absence of a row = use registry default** (state.js:114).

**Registry (read-only input, not owned here)** — from `platform/core/config.js` / module.json manifests;
in Laravel this is config/seed data, not user-editable via this module:
- `Company`: `id`, `name`, `short`, `tagline`, `type` ('group'|'company'), `icon`, `accent`, `modules[]` (view.js:49-51, 81-93)
- `Module`: `id`, `label`, `icon`, `admin?` bool, `badge?` string, `subs[]` (view.js:124-141)
- `SubFeature`: `id`, `label` (view.js:148-153)

## Business rules
- **Resolution order**: override map wins; else registry default `enabled !== false`; a path the
  registry does not declare resolves to **disabled** (state.js:25-28, 124-133).
- **Cascade**: a module only counts as "live" if its company is also enabled (view.js:51); the shell
  hides companies/modules/subs the same way — `isEnabled` is the single truth-check (state.js:36).
- **Locked nodes**: `group/dashboard` and `group/module-manager` can never be switched off — the row
  renders a "Locked" badge instead of a switch (view.js:17-18, 140-141). Server MUST reject writes
  to these two paths (422) so you cannot lock yourself out.
- **Group always on**: company `group` has no master switch (view.js:92-93); reject company-level
  toggle of `group`.
- **Toggle semantics**: `toggle(co,mod,sub,val)` sets `ov[path] = !!val` (or negates current when
  val omitted), persists, re-folds onto config, emits `modules:changed` (state.js:137-145).
- **Reset**: replaces the entire map with `{}` (view.js:32) — i.e. delete all rows.
- **Access**: screen renders blank for non-admins (view.js:22) — hard admin gate, see Policies.
- No serials, deadlines, maker-checker, or calculations exist in this module.

## Routes
```
GET    /api/group/module-manager/summary        # KPI tiles (activeConcerns, liveModules, overridesCount)
GET    /api/group/module-manager/tree           # registry tree with resolved enabled flags per node
GET    /api/module-overrides                    # raw override map (path -> enabled)
PUT    /api/module-overrides/{path}             # body {enabled: bool} — upsert one toggle (path URL-encoded)
DELETE /api/module-overrides                    # "Reset to defaults" — truncate all overrides
```
All under `auth` + `can:manage-modules` middleware. `GET /api/modules/enabled` (public-ish, any
authenticated user) serves the resolved map the SPA shell needs for nav/router gating — the
Laravel equivalent of `applyOverrides` at boot (state.js:47-48, app.js:54).

## Controllers
**ModuleOverrideController**
- `summary()` → `{ activeConcerns, totalConcerns:5, liveModules, totalModules, overridesCount, health:'Optimal' }` (mirrors view.js:48-57)
- `tree()` → companies -> modules -> subs, each with `{default, override|null, effective}` enabled state
- `index()` → key/value list of `module_overrides`
- `update($path)` → validates path exists in registry, not LOCKED, not `group` company-level;
  upserts row; broadcasts `ModulesChanged`; returns `{path, enabled}`
- `destroy()` → deletes all rows (reset); broadcasts `ModulesChanged`; returns fresh resolved map

## Models & migrations
**ModuleOverride** — `$fillable = ['path','enabled']`; `$casts = ['enabled'=>'boolean']`.
```php
Schema::create('module_overrides', function (Blueprint $t) {
    $t->id();
    $t->string('path')->unique();   // 'travels' | 'travels/visa-processing' | 'travels/visa-processing/analysis'
    $t->boolean('enabled');
    $t->timestamps();
});
```
Registry stays as versioned config (`config/epal-modules.php`) seeded from the per-module
`module.json` manifests — matching today's config.js-is-the-registry design. No other tables.

## Policies / permissions
- View + all writes: **admin only** — view.js:22 (`EPAL.auth.isAdmin()`); owner/admin bypass all
  permission checks (platform/auth-rbac/permissions.js:22). Gate: `manage-modules` => role in
  `['owner','admin']`.
- Read of the *resolved* enabled map: every authenticated user (the shell needs it to build nav).
- Immutable paths enforced server-side: `group` (company level), `group/dashboard`,
  `group/module-manager` → 422 on write attempts.

## Events
No money/sales here — no ledger events. Emit one infrastructure event:
- **`ModulesChanged { path, enabled }`** — Laravel equivalent of `EPAL.bus.emit('modules:changed')`
  (state.js:143, view.js:33). Broadcast (e.g. Laravel Echo) so open clients re-render nav/router
  gates instantly; also invalidate any cached resolved-module map. Fired on update and on reset.

## Engine dependencies
- **EPAL.store / EPAL.modules** (state.js) → the ModuleOverride repository + a `Modules` service
  (`isEnabled($co,$mod=null,$sub=null)`), consumed as route middleware/Gate exactly as the SPA
  router gates routes (platform/core/app.js:110, 184, 386-392). state.js:41-48 itself prescribes
  this mapping: `module-overrides` -> `feature_toggles` table, `isEnabled` -> Gate/middleware.
- **EPAL.auth** → standard Laravel auth + `manage-modules` Gate.
- **EPAL.bus** → Laravel events/broadcasting (`ModulesChanged`).
- No ledger, serial, approvals, documents, intel, rules, or comments engines are used.
