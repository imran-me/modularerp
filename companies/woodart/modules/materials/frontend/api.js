/* ============================================================================
 * WOODART · MATERIALS · DATA SEAM
 * ----------------------------------------------------------------------------
 * THE ONLY FILE IN THIS MODULE THAT KNOWS WHERE MATERIALS COME FROM.
 *
 * The screen calls `Materials.stock()`. It does not know, and must never learn,
 * whether that resolves to localStorage (demo mode) or to
 * GET /api/woodart/materials/stock (API mode). That is the entire point: when
 * the Laravel backend goes live, the screen is not edited at all.
 *
 * HOW THE SWITCH ACTUALLY HAPPENS (platform/data/api.js)
 * ---------------------------------------------------------------------------
 *   READS  — at boot, api.js fetches every collection listed in its HYDRATE map
 *            and writes the rows into the same EPAL.store cache `db.col()` reads.
 *            So `db.col(STORE)` below already returns REAL rows in API mode; no
 *            change is needed here. `wa_materials` is wired into HYDRATE.
 *   WRITES — `db.save()` / `db.remove()` round-trip to the server only for stores
 *            listed in api.js WRITABLE. `wa_materials` is wired there too, so a
 *            create/edit/delete persists to MySQL.
 *
 * WHY THE QUERIES LIVE HERE AND NOT IN THE SCREEN
 * ---------------------------------------------------------------------------
 * `belowReorder()` is one named rule in one place. Left inline as
 * `.filter(m => m.stock <= m.reorder)` it would be copy-pasted into the stock
 * screen, the reorder screen, the KPI strip and the dashboard — and the day the
 * rule changes to "< reorder" instead of "<=", three of the four get missed.
 *
 * THE RECORD SHAPE (seeded by platform/data/seed-bd.js, and the exact shape the
 * Laravel MaterialResource returns — see backend/endpoints.md):
 *   { id:'MAT-001', name:'Marine Plywood 18mm', category:'Board', unit:'sheet',
 *     stock:42, reorder:20, unitCost:3400, supplier:'Timber World BD',
 *     created:'2026-05-14' }
 * ==========================================================================*/

/* This file is emitted FIRST inside the module's IIFE (see build-module.mjs),
 * so it owns the shared bindings; frontend/materials.js reuses them and only
 * adds its own view-layer ones (ui, el). Nothing here touches window. */
var EPAL = window.EPAL, db = EPAL.db;

var STORE = 'wa_materials';      /* ← the one place this collection is named */

/* The taxonomy the seed data uses. Kept here (not in the screen) because the
 * backend validates against the same list — they are two halves of one contract. */
var CATEGORIES = ['Board', 'Laminate', 'Hardware', 'Adhesive', 'Finish', 'Fabric'];
var UNITS = ['pcs', 'sheet', 'kg', 'litre', 'sft'];

var Materials = {

  categories: function () { return CATEGORIES.slice(); },
  units: function () { return UNITS.slice(); },

  /** Every material, A→Z by name. The register's natural order. */
  all: function () {
    return db.col(STORE).slice().sort(function (a, b) {
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
  },

  /** One material by id, or null when it has been deleted under us. */
  find: function (id) {
    return db.col(STORE).filter(function (m) { return m.id === id; })[0] || null;
  },

  /** Stock value of one line = units on hand × unit cost. */
  valueOf: function (m) { return (+m.stock || 0) * (+m.unitCost || 0); },

  /** THE reorder rule, defined once: at or below the line needs buying. */
  isLow: function (m) { return (+m.stock || 0) <= (+m.reorder || 0); },

  /** Everything that needs buying, worst shortfall first. */
  belowReorder: function () {
    return Materials.all()
      .map(function (m) {
        var short = Math.max(0, (+m.reorder || 0) - (+m.stock || 0));
        return { rec: m, short: short, refill: short * (+m.unitCost || 0) };
      })
      .filter(function (r) { return Materials.isLow(r.rec); })
      .sort(function (a, b) { return b.short - a.short; });
  },

  /** Stock value grouped by category, largest first. Drives the valuation screen. */
  byCategory: function () {
    var acc = {};
    Materials.all().forEach(function (m) {
      var k = m.category || 'Uncategorised';
      if (!acc[k]) acc[k] = { name: k, value: 0, items: 0, units: 0 };
      acc[k].value += Materials.valueOf(m);
      acc[k].units += (+m.stock || 0);
      acc[k].items += 1;
    });
    return Object.keys(acc).map(function (k) { return acc[k]; })
      .sort(function (a, b) { return b.value - a.value; });
  },

  /** The header figures every screen quotes. One calculation, one truth. */
  summary: function () {
    var list = Materials.all();
    var cats = {}, sups = {}, value = 0, dead = 0;
    list.forEach(function (m) {
      value += Materials.valueOf(m);
      if (m.category) cats[m.category] = 1;
      if (m.supplier) sups[m.supplier] = 1;
      if ((+m.stock || 0) === 0) dead++;
    });
    return {
      items: list.length,
      value: value,
      low: list.filter(Materials.isLow).length,
      dead: dead,
      categories: Object.keys(cats).length,
      suppliers: Object.keys(sups).length,
      avg: list.length ? Math.round(value / list.length) : 0
    };
  },

  /** Every supplier name currently in use — for the form's picker. */
  suppliers: function () {
    var seen = {};
    Materials.all().forEach(function (m) { if (m.supplier) seen[m.supplier] = 1; });
    return Object.keys(seen).sort();
  },

  /** Next free id in the seeded MAT-000 series, so hand-added rows keep the shape. */
  nextId: function () {
    var max = 0;
    db.col(STORE).forEach(function (m) {
      var n = parseInt(String(m.id || '').replace(/^MAT-?/, ''), 10);
      if (!isNaN(n) && n > max) max = n;
    });
    return 'MAT-' + String(max + 1).replace(/^(\d)$/, '00$1').replace(/^(\d\d)$/, '0$1');
  },

  /** Create or update. db.save emits data:changed, so open screens repaint. */
  save: function (rec) { return db.save(STORE, rec); },

  /** Delete by id. */
  remove: function (id) { return db.remove(STORE, id); }
};
