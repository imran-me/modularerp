/* ============================================================================
 * EPAL GROUP ERP  ·  core/engines.js
 * ----------------------------------------------------------------------------
 * THE ENGINE REGISTRY — Deep Core Pass backbone.
 *
 * The Deep Core Pass adds several cross-cutting "engines" (double-entry ledger,
 * audit trail, approvals, documents, automation scheduler, intelligence…). Each
 * lives in its own core/*.js file and must (a) seed its own store idempotently
 * and (b) optionally run boot logic AFTER the router is live. Rather than wire
 * each into database.js/app.js by hand (collision-prone), every engine
 * self-registers here:
 *
 *   EPAL.registerEngine({
 *     name: 'ledger',
 *     seed: function () { EPAL.store.seedOnce('coa', COA); … },   // idempotent
 *     boot: function () { EPAL.bus.on('sale:recorded', …); }       // after start
 *   });
 *
 * database.js  → calls EPAL.seedEngines()  at the end of db.seed()
 * app.js       → calls EPAL.bootEngines()  after router.start()
 *
 * Both are ordered by registration order and isolate errors so one bad engine
 * never blocks the rest. Load order in index.html: engines.js must come BEFORE
 * any engine that calls registerEngine, and after eventbus/state/ui.
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
