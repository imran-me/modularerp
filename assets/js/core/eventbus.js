/* ============================================================================
 * EPAL GROUP ERP  ·  core/eventbus.js
 * ----------------------------------------------------------------------------
 * THE NERVOUS SYSTEM — this is what makes the group "intelligently connected".
 *
 * Every meaningful change publishes an event here. Dashboards, analytics, the
 * notification centre and other companies SUBSCRIBE. So when Travels books a
 * sale, the Group Command Center's revenue tile and the CRM customer graph can
 * both react — without any direct coupling between those modules.
 *
 * Canonical event names (keep this list current):
 *   data:changed        { store, action:'create|update|delete', record }
 *   sale:recorded       { companyId, amount, profit, customerId }
 *   customer:upserted   { customerId, companyId }
 *   task:updated        { empId, taskId, action }
 *   task:commented      { empId, taskId, byAdmin }
 *   modules:changed     { key, enabled }
 *   auth:changed        { user }
 *   theme:changed       { theme }
 *   company:switched     { companyId }
 *   notify              { level, title, text, ... }   (raise a notification)
 *
 * Cross-tab: writes to localStorage also fire the browser `storage` event, so
 * two open tabs of the ERP stay loosely in sync (we re-broadcast those).
 * ==========================================================================*/

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
