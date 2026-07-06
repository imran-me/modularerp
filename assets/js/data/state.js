/* ============================================================================
 * EPAL GROUP ERP  ·  core/state.js
 * ----------------------------------------------------------------------------
 * PERSISTENCE + LIVE MODULE TOGGLES.
 *
 * This is the thin, namespaced wrapper around localStorage that every store in
 * the system uses. The old system scattered raw `localStorage['epal_tv_*']`
 * calls everywhere; here it all goes through one door so we can later swap the
 * backend for a real API by changing ONLY this file.
 *
 * It also owns the "module override" layer: the admin Module Manager writes
 * enable/disable flags here, and `applyOverrides()` folds them back onto the
 * in-memory EPAL.config registry so the whole UI reacts instantly.
 * ==========================================================================*/

(function (EPAL) {
  'use strict';

  var NS = 'epal.v1.';                    // storage namespace / schema version
  var OVERRIDES_KEY = 'module-overrides'; // where on/off flags live

  var Store = {
    /* --- raw JSON get/set -------------------------------------------------*/
    get: function (key, fallback) {
      try {
        var raw = localStorage.getItem(NS + key);
        return raw === null ? (fallback === undefined ? null : fallback) : JSON.parse(raw);
      } catch (e) { return fallback === undefined ? null : fallback; }
    },
    set: function (key, value) {
      try { localStorage.setItem(NS + key, JSON.stringify(value)); }
      catch (e) { console.warn('[state] write failed for', key, e); }
      return value;
    },
    /* Patch an object store (shallow merge) --------------------------------*/
    patch: function (key, partial) {
      var cur = this.get(key, {}) || {};
      Object.keys(partial).forEach(function (k) { cur[k] = partial[k]; });
      return this.set(key, cur);
    },
    remove: function (key) { localStorage.removeItem(NS + key); },

    /* Collection helpers (arrays of {id,...}) ------------------------------*/
    list: function (key) { return this.get(key, []) || []; },
    upsert: function (key, record) {
      var arr = this.list(key);
      var i = arr.findIndex(function (r) { return r.id === record.id; });
      if (i >= 0) arr[i] = Object.assign({}, arr[i], record); else arr.push(record);
      this.set(key, arr);
      return record;
    },
    removeFrom: function (key, id) {
      this.set(key, this.list(key).filter(function (r) { return r.id !== id; }));
    },

    /* Only seed if the store has never been written (idempotent) -----------*/
    seedOnce: function (key, data) {
      if (localStorage.getItem(NS + key) === null) this.set(key, data);
      return this.get(key);
    },

    /* Wipe every epal.* key (used by "Reset demo data") --------------------*/
    nuke: function () {
      Object.keys(localStorage).filter(function (k) { return k.indexOf(NS) === 0; })
        .forEach(function (k) { localStorage.removeItem(k); });
    },

    namespace: NS
  };

  /* ==========================================================================
   * MODULE OVERRIDES  ──  the engine behind "everything is modular"
   * --------------------------------------------------------------------------
   * Shape stored under `module-overrides`:
   *   { "travels": false,                         // whole company off
   *     "travels/visa-processing": false,         // one module off
   *     "travels/visa-processing/analysis": false // one sub-module off
   *   }
   * Absence of a key means "use the default from config.js".
   * ========================================================================*/
  var Modules = {
    overrides: function () { return Store.get(OVERRIDES_KEY, {}) || {}; },

    keyFor: function (companyId, moduleId, subId) {
      return [companyId, moduleId, subId].filter(Boolean).join('/');
    },

    /* Is this node enabled? (respects override, else config default) -------*/
    isEnabled: function (companyId, moduleId, subId) {
      var ov = this.overrides();
      var key = this.keyFor(companyId, moduleId, subId);
      if (key in ov) return ov[key];
      // fall back to the declared default on the config object
      var node;
      if (subId)      node = findSub(companyId, moduleId, subId);
      else if (moduleId) node = EPAL.config.module(companyId, moduleId);
      else            node = EPAL.config.company(companyId);
      return node ? (node.enabled !== false) : false;
    },

    /* Flip a node and fan the change out to the whole app ------------------*/
    toggle: function (companyId, moduleId, subId, value) {
      var ov = this.overrides();
      var key = this.keyFor(companyId, moduleId, subId);
      ov[key] = (value === undefined) ? !this.isEnabled(companyId, moduleId, subId) : !!value;
      Store.set(OVERRIDES_KEY, ov);
      this.applyOverrides();
      EPAL.bus && EPAL.bus.emit('modules:changed', { key: key, enabled: ov[key] });
      return ov[key];
    },

    /* Fold overrides onto the live config so `enabled` is always truthful --*/
    applyOverrides: function () {
      var ov = this.overrides();
      EPAL.config.companies.forEach(function (co) {
        var ck = co.id;
        if (ck in ov) co.enabled = ov[ck];
        co.modules.forEach(function (mod) {
          var mk = co.id + '/' + mod.id;
          if (mk in ov) mod.enabled = ov[mk];
          (mod.subs || []).forEach(function (sub) {
            var sk = co.id + '/' + mod.id + '/' + sub.id;
            if (sk in ov) sub.enabled = ov[sk];
          });
        });
      });
    }
  };

  function findSub(companyId, moduleId, subId) {
    var mod = EPAL.config.module(companyId, moduleId);
    if (!mod) return null;
    return (mod.subs || []).filter(function (s) { return s.id === subId; })[0] || null;
  }

  EPAL.store = Store;
  EPAL.modules = Modules;

})(window.EPAL = window.EPAL || {});
