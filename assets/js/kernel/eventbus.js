/* ============================================================================
 * EPAL GROUP ERP  ·  assets/js/kernel/eventbus.js
 * ----------------------------------------------------------------------------
 * WHAT: THE NERVOUS SYSTEM — a tiny in-memory publish/subscribe bus that makes
 *   the group "intelligently connected" WITHOUT direct coupling. Every
 *   meaningful change emits a named event; dashboards, analytics, the deep-core
 *   engines (ledger/audit/approvals) and the notification centre subscribe. So a
 *   Travels sale can move the Group revenue tile and auto-post a journal entry,
 *   with neither module referencing the other. It also re-broadcasts the
 *   browser `storage` event so two open tabs stay loosely in sync.
 *
 * DATA IT OWNS (localStorage stores): none. Purely runtime pub/sub.
 *
 * BUSINESS RULES (the "why" a developer must preserve):
 *   - A throwing handler is caught and logged, never allowed to break emit() —
 *     one bad listener must not stop the others (fan-out must be resilient).
 *   - A wildcard '*' subscriber receives EVERY event (used by audit/debug taps).
 *   - Canonical events (keep current): data:changed {store,action,record},
 *     sale:recorded {companyId,amount,profit,customerId}, customer:upserted,
 *     task:updated, task:commented, modules:changed {key,enabled}, auth:changed,
 *     theme:changed, company:switched, notify {level,title,text},
 *     ledger:posted, approval:requested/approved/rejected, audit:logged,
 *     route:changed, storage:external.
 *
 * PUBLIC API (window.EPAL.bus):
 *   .on(event, fn)   -> disposer fn — subscribe (returns an off() you can call)
 *   .off(event, fn)  -> void        — unsubscribe
 *   .once(event, fn) -> disposer    — auto-unsubscribes after first fire
 *   .emit(event, payload)           — fan out to subscribers + '*' wildcard taps
 *
 * ==> LARAVEL / PHP MAPPING: Laravel Events + Listeners (event dispatcher). Cross-
 *     tab sync maps to broadcasting (Laravel Echo / websockets). `notify` maps to
 *     the Notifications system.
 * ========================================================================*/

(function (EPAL) {
  'use strict';

  var handlers = {};   // { eventName: [fn, fn, ...] }

  var Bus = {
    on: function (event, fn) {
      (handlers[event] = handlers[event] || []).push(fn);
      return function off() { Bus.off(event, fn); };   // returns disposer
    },
    off: function (event, fn) {
      if (!handlers[event]) return;
      handlers[event] = handlers[event].filter(function (h) { return h !== fn; });
    },
    once: function (event, fn) {
      var off = Bus.on(event, function (payload) { off(); fn(payload); });
      return off;
    },
    emit: function (event, payload) {
      (handlers[event] || []).slice().forEach(function (fn) {
        try { fn(payload, event); }
        catch (e) { console.error('[bus] handler for "' + event + '" threw:', e); }
      });
      // wildcard listeners ('*') receive every event — handy for debug/audit
      (handlers['*'] || []).slice().forEach(function (fn) {
        try { fn(payload, event); } catch (e) { /* noop */ }
      });
    }
  };

  // Re-broadcast cross-tab storage changes so other tabs update live.
  window.addEventListener('storage', function (e) {
    if (e.key && e.key.indexOf(EPAL.store.namespace) === 0) {
      Bus.emit('storage:external', { key: e.key.replace(EPAL.store.namespace, '') });
    }
  });

  EPAL.bus = Bus;

})(window.EPAL = window.EPAL || {});
