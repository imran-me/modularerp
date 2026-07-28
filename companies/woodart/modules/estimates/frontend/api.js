/* ============================================================================
 * WOODART · ESTIMATES & BOQ · DATA SEAM
 * ----------------------------------------------------------------------------
 * THE ONLY FILE IN THIS MODULE THAT KNOWS WHERE ESTIMATE DATA COMES FROM.
 *
 * The screen calls `Boq.all()` / `Boq.lines()` / `Boq.costing()`. It does not
 * know whether that resolves to localStorage (demo mode) or to
 * GET /api/woodart/estimates/... (API mode).
 *
 * ⚠️ OWNERSHIP: `wa_estimates` is CREATED by the projects module — its
 * migration, model and seeder live there, because the estimates existed as the
 * spine every other Woodart seeder pointed at long before this module was
 * built. This module owns the SCREENS and the write path; projects keeps the
 * table. Same arrangement as Accounts over `acc_entries`, and documented for
 * the same reason: a local model over a table owned elsewhere is deliberate,
 * not an oversight to be tidied away.
 *
 * THE RECORD SHAPE (the exact shape the Laravel EstimateResource returns):
 *   { id:'EST-102', title:'Office Fit-out — Square Pharma HQ',
 *     client:'Square Pharmaceuticals', project:'WAP-102', status:'Approved',
 *     lines:[{ item:'Marine Plywood 18mm', qty:420, unitCost:3400, unitSale:4500 }],
 *     validTill:'2026-06-30', created:'2026-04-18' }
 * ==========================================================================*/

/* Emitted FIRST inside the module IIFE (build-module.mjs), so this file owns the
 * shared bindings; frontend/estimates.js adds only its view-layer ones. */
var EPAL = window.EPAL, db = EPAL.db;

var STORE     = 'wa_estimates';  /* ← the one place this collection is named */
var PROJECTS  = 'wa_projects';   /* read-only: owned by Projects            */
var MATERIALS = 'wa_materials';  /* read-only: for the live-cost comparison */
var CLIENTS   = 'wa_clients';    /* read-only: owned by Clients             */

var CID = 'woodart';
var TODAY = '2026-07-05';        /* the demo clock — same anchor as every module */

var STATUSES = ['Draft', 'Sent', 'Approved', 'Rejected'];

function num(v) { return +v || 0; }

var Boq = {

  statuses: function () { return STATUSES.slice(); },
  today: function () { return TODAY; },

  /* ---- the register ----------------------------------------------------- */

  all: function () {
    return db.col(STORE).filter(function (e) {
      return !e.companyId || e.companyId === CID;
    });
  },

  find: function (id) {
    return this.all().filter(function (e) { return e.id === id; })[0] || null;
  },

  /** Cost and sale value of one estimate, from its lines. */
  totals: function (est) {
    var cost = 0, sale = 0, qty = 0;
    (est.lines || []).forEach(function (l) {
      cost += num(l.qty) * num(l.unitCost);
      sale += num(l.qty) * num(l.unitSale);
      qty += num(l.qty);
    });
    return { cost: cost, sale: sale, qty: qty, margin: sale - cost,
             marginPct: sale > 0 ? Math.round((sale - cost) / sale * 100) : 0 };
  },

  /** The register rows, richest first — an estimate IS its value. */
  register: function () {
    var self = this;
    return this.all().map(function (e) {
      var t = self.totals(e);
      return {
        id: e.id, title: e.title, client: e.client, project: e.project,
        status: e.status, validTill: e.validTill, created: e.created,
        lineCount: (e.lines || []).length,
        cost: t.cost, sale: t.sale, margin: t.margin, marginPct: t.marginPct,
        expired: self.isExpired(e)
      };
    }).sort(function (a, b) { return b.sale - a.sale; });
  },

  /**
   * Past its validity and still awaiting an answer.
   *
   * An APPROVED estimate is never "expired" — it has already been accepted, and
   * flagging it red because a date passed would be telling the user off for
   * winning the job.
   */
  isExpired: function (est) {
    if (!est.validTill) return false;
    if (est.status === 'Approved' || est.status === 'Rejected') return false;
    return String(est.validTill) < TODAY;
  },

  summary: function () {
    var self = this;
    var rows = this.all();
    var pipeline = 0, approved = 0, expired = 0;
    rows.forEach(function (e) {
      var t = self.totals(e);
      if (e.status === 'Approved') approved += t.sale;
      else if (e.status !== 'Rejected') pipeline += t.sale;
      if (self.isExpired(e)) expired++;
    });
    return {
      count: rows.length, pipeline: pipeline, approved: approved, expired: expired,
      winRate: rows.length
        ? Math.round(rows.filter(function (e) { return e.status === 'Approved'; }).length / rows.length * 100)
        : 0
    };
  },

  /* ---- the bill of materials -------------------------------------------- */

  /**
   * Every BOQ line across every estimate, flattened.
   *
   * `liveCost` is what the SAME material costs in the register today, and
   * `drift` is the gap. A quote written three months ago against plywood that
   * has since gone up is the single most common way an interiors job loses its
   * margin before a single sheet is cut — and nothing else in the system was
   * showing it.
   */
  lines: function () {
    var live = {};
    db.col(MATERIALS).forEach(function (m) { live[m.name] = num(m.unitCost); });

    var out = [];
    this.all().forEach(function (e) {
      (e.lines || []).forEach(function (l, i) {
        var qty = num(l.qty), unitCost = num(l.unitCost), unitSale = num(l.unitSale);
        var liveCost = live[l.item];
        out.push({
          key: e.id + '#' + i,
          estimate: e.id, project: e.project, client: e.client, status: e.status,
          item: l.item, qty: qty, unitCost: unitCost, unitSale: unitSale,
          lineCost: qty * unitCost, lineSale: qty * unitSale,
          margin: qty * (unitSale - unitCost),
          /* undefined, not 0, when the item is not in the register at all —
           * "we do not stock this" and "it costs nothing" are different facts. */
          liveCost: liveCost === undefined ? null : liveCost,
          drift: liveCost === undefined ? null : liveCost - unitCost,
          known: liveCost !== undefined
        });
      });
    });
    return out.sort(function (a, b) { return b.lineSale - a.lineSale; });
  },

  /** Totals per material across every BOQ — what the pipeline will consume. */
  demand: function () {
    var bag = {};
    this.lines().forEach(function (l) {
      /* Only quoted work counts. A rejected estimate is not future demand, and
       * counting it would have the workshop buying timber for a job we lost. */
      if (l.status === 'Rejected') return;
      var b = bag[l.item] || { item: l.item, qty: 0, cost: 0, estimates: {} };
      b.qty += l.qty;
      b.cost += l.lineCost;
      b.estimates[l.estimate] = 1;
      bag[l.item] = b;
    });
    return Object.keys(bag).map(function (k) {
      var b = bag[k];
      return { item: b.item, qty: b.qty, cost: b.cost, estimates: Object.keys(b.estimates).length };
    }).sort(function (a, b) { return b.cost - a.cost; });
  },

  /* ---- costing ----------------------------------------------------------- */

  /** Per-estimate margin, worst first — the ones worth arguing about. */
  costing: function () {
    var self = this;
    return this.all().map(function (e) {
      var t = self.totals(e);
      var drifted = 0, driftValue = 0;
      self.lines().forEach(function (l) {
        if (l.estimate !== e.id || l.drift === null || l.drift <= 0) return;
        drifted++;
        driftValue += l.drift * l.qty;
      });
      return {
        id: e.id, title: e.title, client: e.client, project: e.project,
        status: e.status, lineCount: (e.lines || []).length,
        cost: t.cost, sale: t.sale, margin: t.margin, marginPct: t.marginPct,
        drifted: drifted, driftValue: driftValue,
        /* what the margin becomes if today's material prices hold */
        marginToday: t.margin - driftValue
      };
    }).sort(function (a, b) { return a.marginPct - b.marginPct; });
  },

  /* ---- option lists ------------------------------------------------------ */

  projectOptions: function () {
    return db.col(PROJECTS).map(function (p) {
      return { value: p.id, label: p.id + ' · ' + (p.name || '') };
    });
  },

  clientOptions: function () {
    var seen = {};
    db.col(CLIENTS).forEach(function (c) { if (c.name) seen[c.name] = 1; });
    this.all().forEach(function (e) { if (e.client) seen[e.client] = 1; });
    return Object.keys(seen).sort();
  },

  materialOptions: function () {
    return db.col(MATERIALS).map(function (m) { return m.name; }).sort();
  },

  nextId: function () {
    var max = 0;
    this.all().forEach(function (e) {
      var n = parseInt(String(e.id).replace(/\D+/g, ''), 10);
      if (n > max) max = n;
    });
    return 'EST-' + String(max + 1).padStart(3, '0');
  },

  /* ---- writes ------------------------------------------------------------ */

  save: function (rec) {
    rec.companyId = CID;
    if (!rec.id) rec.id = this.nextId();
    if (!rec.created) rec.created = TODAY;
    rec.lines = (rec.lines || []).map(function (l) {
      return { item: l.item, qty: num(l.qty), unitCost: num(l.unitCost), unitSale: num(l.unitSale) };
    });
    return db.save(STORE, rec);
  },

  remove: function (id) { db.remove(STORE, id); }
};
