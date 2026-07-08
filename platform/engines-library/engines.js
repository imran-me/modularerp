/* ============================================================================
 * EPAL GROUP ERP  ·  assets/js/engines/engines.js
 * ----------------------------------------------------------------------------
 * WHAT: The engine REGISTRY (a service-provider pattern). The Deep Core Pass
 *   adds several cross-cutting "engines" (double-entry ledger, audit trail,
 *   approvals, documents, automation scheduler, intelligence, comments,
 *   search). Each lives in its own file and must (a) seed its own store
 *   idempotently and (b) optionally run boot logic AFTER the router is live.
 *   Rather than wire each into database.js / app.js by hand (collision-prone),
 *   every engine self-registers here, and this file drives two lifecycle
 *   phases — seed, then boot — over all registered engines in order.
 *
 * DATA IT OWNS (localStorage stores):
 *   none — this is a pure registry / dispatcher. Individual engines own stores.
 *
 * BUSINESS RULES (the "why" a developer must preserve):
 *   - Registration order IS execution order for both seed() and boot(). Load
 *     order in index.html therefore matters (see note below).
 *   - Each phase isolates errors per engine (try/catch) so one bad engine can
 *     never block the rest from seeding/booting.
 *   - An engine registered LATE (after the phases already ran, e.g. a lazily
 *     loaded module) has its missed phases run immediately, so nothing is
 *     skipped regardless of when it self-registers.
 *   - seed() must be idempotent (engines use EPAL.store.seedOnce) so re-seeding
 *     never duplicates rows. boot() runs after router.start().
 *   - Load order in index.html: engines.js must come BEFORE any engine that
 *     calls registerEngine, and after eventbus/state/ui.
 *
 * PUBLIC API (window.EPAL.<x>):
 *   registerEngine({name,seed?,boot?}) -> engine — self-register; runs missed
 *       phases immediately if seed/boot already happened.
 *   engines() -> array — snapshot copy of the registry.
 *   seedEngines() -> void — run every engine's seed() in order (called at the
 *       end of db.seed()).
 *   bootEngines() -> void — run every engine's boot() in order (called after
 *       router.start()).
 *   onSeed(name, fn) -> engine — convenience to register a pure seed hook (a
 *       view that needs a seeded store but has no runtime engine).
 *
 * ==> LARAVEL / PHP MAPPING: this is a Service Provider registry. Each engine
 *     maps to a Laravel ServiceProvider; seed() -> a database Seeder invoked
 *     from DatabaseSeeder (idempotent updateOrCreate); boot() -> the provider's
 *     boot() method (event listeners, scheduled tasks). seedEngines/bootEngines
 *     are the framework running register()/boot() across all providers in order.
 * ==========================================================================*/

(function (EPAL) {
  'use strict';

  var registry = [];
  var seeded = false, booted = false;

  EPAL.registerEngine = function (engine) {
    if (!engine || !engine.name) { console.warn('[engines] engine needs a name'); return; }
    registry.push(engine);
    // If registration happens after the boot phases already ran (e.g. a lazily
    // loaded module), run the missed phases immediately so nothing is skipped.
    if (seeded && engine.seed) { try { engine.seed(); } catch (e) { console.error('[engines] late seed ' + engine.name, e); } }
    if (booted && engine.boot) { try { engine.boot(); } catch (e) { console.error('[engines] late boot ' + engine.name, e); } }
    return engine;
  };

  EPAL.engines = function () { return registry.slice(); };

  EPAL.seedEngines = function () {
    seeded = true;
    registry.forEach(function (e) {
      if (!e.seed) return;
      try { e.seed(); } catch (err) { console.error('[engines] seed failed: ' + e.name, err); }
    });
  };

  EPAL.bootEngines = function () {
    booted = true;
    registry.forEach(function (e) {
      if (!e.boot) return;
      try { e.boot(); } catch (err) { console.error('[engines] boot failed: ' + e.name, err); }
    });
  };

  /* Convenience: register a pure seed hook (a view that needs a seeded store
   * but has no runtime engine). e.g. EPAL.onSeed('shop-extra', function(){…}) */
  EPAL.onSeed = function (name, fn) { return EPAL.registerEngine({ name: name, seed: fn }); };

})(window.EPAL = window.EPAL || {});
