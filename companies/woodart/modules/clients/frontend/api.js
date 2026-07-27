/* ============================================================================
 * WOODART · CLIENTS · DATA SEAM
 * ----------------------------------------------------------------------------
 * THE ONLY FILE IN THIS MODULE THAT KNOWS WHERE CLIENT DATA COMES FROM.
 *
 * The screen calls `Clients.directory()` / `Clients.portfolio()`. It does not
 * know, and must never learn, whether that resolves to localStorage (demo mode)
 * or to GET /api/woodart/clients/... (API mode). When Laravel goes live the
 * screen is not edited at all.
 *
 * READS  — platform/data/api.js hydrates `wa_clients` from the endpoint at boot
 *          into the same EPAL.store cache `db.col()` reads, so the calls below
 *          already return real rows in API mode with no change here.
 * WRITES — `wa_clients` is in api.js WRITABLE, so create/edit/delete persist.
 *
 * THE JOIN THIS MODULE OWNS (and why it lives here)
 * ---------------------------------------------------------------------------
 * Woodart's projects and estimates reference a client by NAME, not by id —
 * that is how the existing `wa_projects` / `wa_estimates` stores were built and
 * this module does not get to rewrite them (R2). So the client→work join is a
 * name match, normalised through ONE function, `key()`. If that ever becomes a
 * real foreign key, this file is the only place that changes.
 *
 * THE RECORD SHAPE (seeded by platform/data/seed-bd.js, and the exact shape the
 * Laravel ClientResource returns — see backend/endpoints.md):
 *   { id:'CLI-001', name:'Bashundhara Group', type:'Developer',
 *     contact:'Nasrin Sultana', phone:'+8801712345678',
 *     email:'bashundhara.group@corp.example.bd', area:'Gulshan-2',
 *     since:'2025-02-11', created:'2026-05-14' }
 * ==========================================================================*/

/* Emitted FIRST inside the module IIFE (build-module.mjs), so this file owns the
 * shared bindings; frontend/clients.js adds only its view-layer ones (ui, el). */
var EPAL = window.EPAL, db = EPAL.db;

var STORE = 'wa_clients';        /* ← the one place this collection is named */
var PROJECTS = 'wa_projects';    /* read-only: this module never writes these */
var ESTIMATES = 'wa_estimates';

/* The segmentation. The backend validates against the same list — two halves
 * of one contract (see backend/endpoints.md). */
var TYPES = ['Homeowner', 'Developer', 'Corporate', 'Retail'];

/** Normalise a client name for matching. ONE definition, so the directory, the
 *  portfolio and the segment roll-up can never disagree about who is who. */
function key(name) { return String(name || '').trim().toLowerCase(); }

var Clients = {

  types: function () { return TYPES.slice(); },

  /** Every client, A→Z by name (case-insensitive, matching the server's
   *  collation — see backend/endpoints.md invariant 8). */
  directory: function () {
    return db.col(STORE).slice().sort(function (a, b) {
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
  },

  find: function (id) {
    return db.col(STORE).filter(function (c) { return c.id === id; })[0] || null;
  },

  /** Every project belonging to one client (matched by name — see the header). */
  projectsOf: function (client) {
    var k = key(client.name);
    return db.col(PROJECTS).filter(function (p) { return key(p.client) === k; });
  },

  /** Every estimate belonging to one client. */
  estimatesOf: function (client) {
    var k = key(client.name);
    return db.col(ESTIMATES).filter(function (e) { return key(e.client) === k; });
  },

  /** A client with its work rolled up. The one shape the portfolio screen uses. */
  withWork: function (client) {
    var projects = Clients.projectsOf(client);
    var estimates = Clients.estimatesOf(client);
    var value = 0, cost = 0, live = 0;
    projects.forEach(function (p) {
      value += (+p.value || 0);
      cost += (+p.cost || 0);
      if (p.stage !== 'Completed' && p.stage !== 'Handover') live++;
    });
    var won = estimates.filter(function (e) { return e.status === 'Approved'; }).length;
    var open = estimates.filter(function (e) { return e.status === 'Draft' || e.status === 'Sent'; }).length;
    return {
      id: client.id, name: client.name, type: client.type, area: client.area,
      contact: client.contact, phone: client.phone, email: client.email, since: client.since,
      projects: projects.length, live: live, value: value, cost: cost, margin: value - cost,
      won: won, open: open, quotes: estimates.length
    };
  },

  /** Every client with their work, highest contract value first. */
  portfolio: function () {
    return Clients.directory().map(Clients.withWork)
      .sort(function (a, b) { return b.value - a.value; });
  },

  /** Contract value grouped by segment, largest first. */
  bySegment: function () {
    var acc = {};
    Clients.portfolio().forEach(function (r) {
      var k = r.type || 'Unsegmented';
      if (!acc[k]) acc[k] = { name: k, clients: 0, projects: 0, value: 0, margin: 0 };
      acc[k].clients += 1;
      acc[k].projects += r.projects;
      acc[k].value += r.value;
      acc[k].margin += r.margin;
    });
    return Object.keys(acc).map(function (k) { return acc[k]; })
      .sort(function (a, b) { return b.value - a.value; });
  },

  /** The header figures every screen quotes. One calculation, one truth. */
  summary: function () {
    var rows = Clients.portfolio();
    var value = 0, cost = 0, live = 0, repeat = 0, idle = 0, segs = {};
    rows.forEach(function (r) {
      value += r.value; cost += r.cost;
      if (r.live > 0) live++;
      if (r.projects > 1) repeat++;
      if (r.projects === 0 && r.quotes === 0) idle++;
      if (r.type) segs[r.type] = 1;
    });
    return {
      clients: rows.length, value: value, cost: cost, margin: value - cost,
      live: live, repeat: repeat, idle: idle,
      segments: Object.keys(segs).length,
      avg: rows.length ? Math.round(value / rows.length) : 0,
      top: rows.length && rows[0].value ? rows[0].name : '—'
    };
  },

  /** Next free id in the seeded CLI-000 series. */
  nextId: function () {
    var max = 0;
    db.col(STORE).forEach(function (c) {
      var n = parseInt(String(c.id || '').replace(/^CLI-?/, ''), 10);
      if (!isNaN(n) && n > max) max = n;
    });
    return 'CLI-' + String(max + 1).replace(/^(\d)$/, '00$1').replace(/^(\d\d)$/, '0$1');
  },

  /** Create or update. db.save emits data:changed, so open screens repaint. */
  save: function (rec) { return db.save(STORE, rec); },

  /** Delete by id. */
  remove: function (id) { return db.remove(STORE, id); }
};
