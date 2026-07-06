/* ============================================================================
 * EPAL GROUP ERP  ·  core/serial.js
 * ----------------------------------------------------------------------------
 * GAPLESS DOCUMENT NUMBERING — "no magic numbers, full traceability".
 *
 * Every branded business object (invoice, receipt, voucher, journal, work
 * order, salary slip, PO…) gets a stable, sequential, human-readable serial
 * from ONE authority so numbers never collide or repeat. Counters persist in
 * the `serials` store keyed by a template code.
 *
 *   EPAL.serial.next('INV')            → 'INV/2026/000042'   (advances + saves)
 *   EPAL.serial.peek('INV')            → 'INV/2026/000043'   (does not advance)
 *   EPAL.serial.next('JV', {company:'travels'})              → per-company stream
 *
 * Format is `PREFIX/FY/000NNN` where FY is the fiscal year of the group config;
 * width is 6 by default. Pass {pad, sep, fy} to override. Counters reset per
 * (prefix, fiscal-year) automatically. This is the single source of truth an
 * auditor can trust for sequence integrity.
 * ==========================================================================*/

(function (EPAL) {
  'use strict';
  var S = EPAL.store;

  function fiscalYear() {
    // Group fiscal year starts in config.group.fiscalYearStart (month, 1-12).
    // Demo "now" is anchored mid-2026; use a fixed anchor so serials are stable.
    var g = (EPAL.config && EPAL.config.group) || {};
    var now = new Date(2026, 6, 5);           // Jul 2026 demo anchor (stable)
    var startMonth = (g.fiscalYearStart || 1) - 1;
    var y = now.getFullYear();
    // Fiscal year label = the year the FY started in.
    if (now.getMonth() < startMonth) y -= 1;
    return y;
  }

  function keyFor(prefix, company) {
    return (company ? company + ':' : '') + prefix + ':' + fiscalYear();
  }

  /* Establish the runtime `serials` counters so streams start ABOVE any serial
   * already printed on a SEEDED document (documents.js seeds fixed serials such
   * as INV/2026/000001..2, RCP/2026/000001..2, WO/2026/000001, QUO/2026/000001).
   * Without this, the first next('INV') would reissue INV/2026/000001 — a
   * byte-for-byte duplicate of a seeded document, breaking sequence integrity.
   *
   * Idempotent + reset-safe: once the counters store exists we leave it alone;
   * after a db.reset() nukes the store we rebuild it from the freshly-seeded
   * documents. Order-independent: serial.js loads before documents.js, so the
   * engine seed hook may run before documents are seeded — in that case we write
   * nothing and reconcile lazily on the first counters() read (which always
   * happens at runtime, long after all seeding is complete). */
  function reconcile() {
    if (S.get('serials')) return;               // counters already established
    var docs = S.get('documents', []) || [];
    if (!docs.length) return;                   // documents not seeded yet
    var counters = {};
    for (var i = 0; i < docs.length; i++) {
      var d = docs[i];
      if (!d || !d.serial) continue;
      var m = /^([A-Z]+)\/(\d+)\/(\d+)$/.exec(d.serial);
      if (!m) continue;
      var k = m[1] + ':' + parseInt(m[2], 10);  // e.g. 'INV:2026' — matches keyFor
      var n = parseInt(m[3], 10);
      if (!counters[k] || n > counters[k]) counters[k] = n;
    }
    S.set('serials', counters);
  }

  var Serial = {
    counters: function () { reconcile(); return S.get('serials', {}) || {}; },

    /* Advance and return the next serial for a stream. */
    next: function (prefix, opts) {
      opts = opts || {};
      var all = this.counters();
      var k = keyFor(prefix, opts.company);
      var n = (all[k] || 0) + 1;
      all[k] = n;
      S.set('serials', all);
      return this.format(prefix, n, opts);
    },

    /* What the next serial WOULD be, without consuming it. */
    peek: function (prefix, opts) {
      opts = opts || {};
      var all = this.counters();
      var k = keyFor(prefix, opts.company);
      return this.format(prefix, (all[k] || 0) + 1, opts);
    },

    /* Current highest issued (0 if none). */
    current: function (prefix, opts) {
      opts = opts || {};
      return this.counters()[keyFor(prefix, opts.company)] || 0;
    },

    format: function (prefix, n, opts) {
      opts = opts || {};
      var pad = opts.pad != null ? opts.pad : 6;
      var sep = opts.sep || '/';
      var fy = opts.fy != null ? opts.fy : fiscalYear();
      var num = String(n);
      while (num.length < pad) num = '0' + num;
      return [prefix, fy, num].join(sep);
    },

    fiscalYear: fiscalYear
  };

  EPAL.serial = Serial;

  // Reconcile counters with the seeded documents so runtime serials continue
  // past them and never duplicate. Runs during EPAL.seedEngines(); if it fires
  // before documents.js has seeded (registration order) it is a no-op and the
  // lazy reconcile() inside counters() establishes the store on first use.
  EPAL.registerEngine({
    name: 'serial',
    seed: reconcile,
    boot: function () {}
  });

})(window.EPAL = window.EPAL || {});
