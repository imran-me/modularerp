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
var MOVEMENTS = 'wa_movements';  /* the stock ledger — see THE MOVEMENT LEDGER */
var LOCATIONS = 'wa_locations';  /* where stock sits: workshop, bay, site store */
/* READ-ONLY, owned by other modules. Stock has to be issued TO somewhere and
 * received AGAINST something, and those two facts live next door: a room is a
 * phase of a space (scope), an order is a purchase order (procurement). Read
 * through db.col so deleting either folder leaves this module working with an
 * empty picker instead of a crash. */
var PHASES   = 'wa_phases';
var SPACES   = 'wa_spaces';
var PROJECTS = 'wa_projects';
var ORDERS   = 'wa_purchases';

var TODAY = '2026-07-05';        /* the demo clock — same anchor as every module */

/* The taxonomy the seed data uses. Kept here (not in the screen) because the
 * backend validates against the same list — they are two halves of one contract. */
/* `Civil` (and the bag/cft units) landed 2026-08-06 with the Munshi Villa demo:
 * a design-build house that pours its own structure buys rod, cement, bricks and
 * sand, and those have to be registered, valued and issued like any other
 * material. Leaving them out would have meant either a register that cannot
 * explain the largest spend on the job, or a category typed as free text that
 * the add/edit form could never offer again. */
var CATEGORIES = ['Board', 'Laminate', 'Hardware', 'Adhesive', 'Finish', 'Fabric', 'Civil'];
var UNITS = ['pcs', 'sheet', 'kg', 'litre', 'sft', 'bag', 'cft'];
var KINDS = ['Receipt', 'Issue', 'Adjustment', 'Wastage'];

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

  /**
   * THE ROOMS STOCK CAN BE ISSUED TO — every open phase, labelled with its
   * project and room: "WAP-101 · Master Bed Room — Wood Work".
   *
   * ONE picker, not two dependent ones: the platform's form kit has no dynamic
   * options, and a project select that repopulates a room select is exactly the
   * kind of thing that half-works. The phase carries its project and its space,
   * so choosing a room says everything.
   */
  roomOptions: function () {
    var spaceName = {}, spaceOf = {};
    db.col(SPACES).forEach(function (s) { spaceName[s.id] = s.name; spaceOf[s.id] = s.project; });
    return db.col(PHASES)
      .filter(function (p) { return p.status !== 'Complete'; })
      .map(function (p) {
        return [p.id, (p.project || spaceOf[p.space] || '') + ' · ' +
          (spaceName[p.space] || p.space) + ' — ' + p.name];
      });
  },

  /** The project and room a phase belongs to — so a movement files itself. */
  phaseContext: function (phaseId) {
    var ph = db.col(PHASES).filter(function (p) { return p.id === phaseId; })[0];
    if (!ph) return null;
    return { project: ph.project, space: ph.space, name: ph.name };
  },

  /** Orders still awaiting delivery — what a receipt can arrive against. */
  orderOptions: function () {
    return db.col(ORDERS)
      .filter(function (o) { return o.status !== 'Received'; })
      .map(function (o) {
        return [o.id, o.id + ' · ' + (o.supplier || '') + (o.project ? ' · ' + o.project : '')];
      });
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

  /** Create or update. db.save emits data:changed, so open screens repaint.
   *  NOTE: this saves the RECORD. It must not be used to change `stock` —
   *  that is what apply() is for, so the number always has a row behind it. */
  save: function (rec) { return db.save(STORE, rec); },

  /** Delete by id, taking its movement history with it — a ledger for a
   *  material nobody can look at is orphaned evidence.
   *  ONE request: `MaterialService::delete` cascades the movements server-side
   *  in a transaction, so they leave this browser with `removeLocal` and only
   *  the material DELETE travels. A DELETE per movement is the flood shape that
   *  broke the project delete on 2026-08-08. Change one side, change the other. */
  remove: function (id) {
    db.col(MOVEMENTS).filter(function (v) { return v.material === id; })
      .forEach(function (v) { db.removeLocal(MOVEMENTS, v.id); });
    return db.remove(STORE, id);
  },

  /* ======================================================================
   * THE MOVEMENT LEDGER
   * ----------------------------------------------------------------------
   * Until 2026-07-27 `stock` was a bare number: you could see that only 26
   * sheets were left, but nothing said WHY. Every other balance in this
   * system refuses to behave that way — a bank balance never moves without a
   * row in its log (EPAL.bankTxnApply) — and stock is now held to the same
   * standard: apply() writes the row and the number together.
   * ==================================================================== */

  kinds: function () { return KINDS.slice(); },
  locations: function () { return db.col(LOCATIONS).slice(); },
  location: function (id) {
    return db.col(LOCATIONS).filter(function (l) { return l.id === id; })[0] || null;
  },
  locationName: function (id) {
    var l = Materials.location(id);
    return l ? l.name : (id || '—');
  },
  locationOptions: function () {
    return Materials.locations().map(function (l) { return [l.id, l.name + ' · ' + l.kind]; });
  },
  defaultLocation: function () {
    var all = Materials.locations();
    var p = all.filter(function (l) { return l.primary; })[0];
    return (p || all[0] || {}).id || null;
  },

  /** Every movement, newest first. */
  movements: function () {
    return db.col(MOVEMENTS).slice().sort(function (a, b) {
      var x = String(a.date || ''), y = String(b.date || '');
      if (x === y) return String(b.id).localeCompare(String(a.id));
      return x < y ? 1 : -1;
    });
  },

  /** One material's history — the answer to "why is it only 26?". */
  historyOf: function (materialId) {
    return Materials.movements().filter(function (v) { return v.material === materialId; });
  },

  /**
   * APPLY A MOVEMENT — the ONLY sanctioned way stock changes.
   *
   *   apply({ material, kind, qty, location, ref, note, by, date })
   *
   * The SIGN belongs to the KIND, not to the caller: a caller that passed a
   * positive Issue would otherwise double the stock it meant to consume, so
   * signedQty() derives it. Returns the movement row, or null if the material
   * is unknown or the quantity is zero.
   */
  apply: function (spec) {
    spec = spec || {};
    var m = Materials.find(spec.material);
    if (!m) return null;

    var kind = KINDS.indexOf(spec.kind) >= 0 ? spec.kind : 'Adjustment';
    var qty = signedQty(kind, spec.qty);
    if (!qty) return null;

    /* A room says which project it is in, so choosing one fills the reference
     * too — a movement that names a room but not its job would be half-filed. */
    var ctx = spec.phase ? Materials.phaseContext(spec.phase) : null;

    var row = {
      id: nextMovementId(), material: m.id, kind: kind, qty: qty,
      location: spec.location || Materials.defaultLocation(),
      ref: (ctx && ctx.project) || spec.ref || '',
      phase: spec.phase || '', space: (ctx && ctx.space) || '',
      order: spec.order || '',
      note: spec.note || '', by: spec.by || 'System',
      date: spec.date || TODAY, created: spec.date || TODAY
    };
    db.save(MOVEMENTS, row);

    // ...and the balance, in the same breath.
    m.stock = (+m.stock || 0) + qty;
    db.save(STORE, m);

    return row;
  },

  /** Stock per location for one material, derived from its movements. */
  byLocation: function (materialId) {
    var acc = {};
    Materials.historyOf(materialId).forEach(function (v) {
      var k = v.location || 'unassigned';
      acc[k] = (acc[k] || 0) + (+v.qty || 0);
    });
    return Object.keys(acc).map(function (k) {
      return { location: k, name: Materials.locationName(k), qty: acc[k] };
    }).sort(function (a, b) { return b.qty - a.qty; });
  },

  /** Every location with what it currently holds — the warehouse view. */
  locationTotals: function () {
    var qty = {}, val = {};
    Materials.movements().forEach(function (v) {
      var k = v.location || 'unassigned';
      var m = Materials.find(v.material);
      qty[k] = (qty[k] || 0) + (+v.qty || 0);
      val[k] = (val[k] || 0) + (+v.qty || 0) * ((m && +m.unitCost) || 0);
    });
    return Materials.locations().map(function (l) {
      return { id: l.id, name: l.name, kind: l.kind, area: l.area,
        qty: qty[l.id] || 0, value: val[l.id] || 0 };
    }).sort(function (a, b) { return b.value - a.value; });
  },

  /** The movement screen's header figures. */
  movementSummary: function () {
    var vs = Materials.movements();
    var received = 0, issued = 0, wasted = 0, adjusted = 0;
    vs.forEach(function (v) {
      var q = +v.qty || 0;
      if (v.kind === 'Receipt') received += q;
      else if (v.kind === 'Issue') issued += -q;
      else if (v.kind === 'Wastage') wasted += -q;
      else adjusted += q;
    });
    return { movements: vs.length, received: received, issued: issued,
      wasted: wasted, adjusted: adjusted,
      locations: Materials.locations().length,
      lastDate: vs.length ? vs[0].date : null };
  },

  /**
   * THE INVARIANT: for every material, the sum of its movements equals its
   * stored stock. Returns the rows that DISAGREE — an empty array is health,
   * and `node tools/verify/books.mjs stock` asserts exactly that.
   * A balance you cannot prove is a balance you cannot trust, which is the
   * entire reason this ledger exists.
   */
  reconcile: function () {
    var net = {};
    db.col(MOVEMENTS).forEach(function (v) {
      net[v.material] = (net[v.material] || 0) + (+v.qty || 0);
    });
    return Materials.all().map(function (m) {
      var moved = net[m.id] || 0;
      return { id: m.id, name: m.name, stock: +m.stock || 0, moved: moved,
        drift: (+m.stock || 0) - moved };
    }).filter(function (r) { return r.drift !== 0; });
  }
};

/** The sign belongs to the KIND, not the caller. */
function signedQty(kind, qty) {
  var n = Math.abs(+qty || 0);
  if (!n) return 0;
  if (kind === 'Receipt') return n;
  if (kind === 'Issue' || kind === 'Wastage') return -n;
  return (+qty || 0);                     // Adjustment keeps the caller's sign
}

function nextMovementId() {
  var max = 0;
  db.col(MOVEMENTS).forEach(function (v) {
    var n = parseInt(String(v.id || '').replace(/^MOV-?/, ''), 10);
    if (!isNaN(n) && n > max) max = n;
  });
  return 'MOV-' + String(max + 1).padStart(4, '0');
}

/* Exposed for the verification harness — see MODULE-STANDARD §3: a test that
 * re-implements the rule proves nothing, so books.mjs drives the real seam. */
(EPAL.diag = EPAL.diag || {}).woodartMaterials = Materials;
