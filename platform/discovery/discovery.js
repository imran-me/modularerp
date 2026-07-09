/* ============================================================================
 * EPAL GROUP ERP  ·  platform/discovery/discovery.js
 * ----------------------------------------------------------------------------
 * PHASE 3a — AUTO-DISCOVERY.  "Folder present = the company/module appears;
 * folder deleted = it's gone."  A browser cannot list folders over HTTP, so
 * (per the owner's decision) discovery works by FETCH-PROBING each company's
 * `module.json`: HTTP 200 = present, 404 = the folder was deleted.
 *
 * SAFETY CONTRACT (why this can never change today's pixels/behaviour):
 *   1. DEFAULT PRESENT. Every check returns "present" until a scan proves a
 *      specific folder absent. Before the async scan resolves, and whenever
 *      fetch is unavailable, EVERYTHING is present → byte-identical to the
 *      pre-discovery app.
 *   2. file:// FALLBACK. Opening index.html directly (documented, supported)
 *      blocks fetch; every probe rejects → `available=false` → all present.
 *      Discovery only ever *takes effect* when the app is served over HTTP
 *      (GitHub Pages, or any local/prod server).
 *   3. It only HIDES. It never creates, renames, or reorders anything.
 *
 * HOW IT PLUGS IN: `EPAL.modules.isEnabled()` (the ONE visibility truth-check
 * used by the rail, sidebar, router gate and search) calls `presentFor()` first
 * — so a deleted folder disappears everywhere, consistently, from one guard.
 * app.js runs `scan()` once after boot and re-renders ONLY if something is
 * actually absent (no re-render, no flicker, in the normal all-present case).
 *
 * CANDIDATES: the set of companies that COULD exist is read from the live
 * config registry; the set of a company's BUILT modules is read from that
 * company's own fetched `module.json` (`built:true`). Discovery checks which of
 * those candidates are actually PRESENT. (Adding a brand-new company still needs
 * a config/candidate entry — an inherent limit of static hosting with no
 * directory listing; deleting any listed folder Just Works.)
 *
 * ==> LARAVEL: becomes a ModuleDiscovery service that scans the companies/
 *     directory on the server (real filesystem listing) and caches the registry.
 * ========================================================================== */
(function (EPAL) {
  'use strict';

  function folderOf(companyId) { return companyId === 'group' ? 'group-cockpit' : companyId; }

  var Discovery = {
    _companyAbsent: {},   // folder            -> true when its module.json 404s
    _moduleAbsent:  {},   // "folder/moduleId" -> true when a BUILT module 404s
    _ran: false,
    available: null,      // null=not scanned · true=probes worked · false=file:// fallback

    folderOf: folderOf,

    /* the one predicate the rest of the app asks. Present by default. */
    presentFor: function (companyId, moduleId) {
      var f = folderOf(companyId);
      if (this._companyAbsent[f]) return false;
      if (moduleId && this._moduleAbsent[f + '/' + moduleId]) return false;
      return true;
    },

    /* did the last scan actually hide anything? (app.js re-renders only if so) */
    changed: function () {
      for (var k in this._companyAbsent) if (this._companyAbsent[k]) return true;
      for (var m in this._moduleAbsent)  if (this._moduleAbsent[m])  return true;
      return false;
    },

    /* probe every candidate once; resolve when done (never rejects). */
    scan: function () {
      var self = this;
      if (self._ran) return Promise.resolve(self);
      self._ran = true;
      if (typeof fetch !== 'function' || !(EPAL.config && EPAL.config.companies)) {
        self.available = false; return Promise.resolve(self);
      }
      var real = 0;                                   // count of probes that got a real HTTP status
      var probes = EPAL.config.companies.map(function (co) {
        var f = folderOf(co.id);
        return fetch('companies/' + f + '/module.json', { cache: 'no-store' })
          .then(function (r) {
            real++;
            if (!r.ok) { self._companyAbsent[f] = true; return null; }
            return r.json().catch(function () { return null; });
          })
          .then(function (manifest) {
            if (!manifest || !manifest.modules) return null;
            // a company is present → verify its BUILT modules still have folders
            var built = manifest.modules.filter(function (m) { return m && m.built; });
            return Promise.all(built.map(function (m) {
              return fetch('companies/' + f + '/modules/' + m.id + '/module.json', { method: 'HEAD', cache: 'no-store' })
                .then(function (r) { real++; if (!r.ok) self._moduleAbsent[f + '/' + m.id] = true; })
                .catch(function () { /* module probe unusable — leave present */ });
            }));
          })
          .catch(function () { /* company fetch rejected (file:///offline) — leave present */ });
      });
      return Promise.all(probes).then(function () {
        if (real === 0) {                             // nothing probed for real → file:// → all present
          self._companyAbsent = {}; self._moduleAbsent = {}; self.available = false;
        } else {
          self.available = true;
        }
        return self;
      });
    }
  };

  EPAL.discovery = Discovery;
})(window.EPAL = window.EPAL || {});
