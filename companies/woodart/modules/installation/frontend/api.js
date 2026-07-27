/* ============================================================================
 * WOODART · SITE & INSTALL (installation) · DATA SEAM
 * ----------------------------------------------------------------------------
 * THE ONLY FILE IN THIS MODULE THAT KNOWS WHERE INSTALL DATA COMES FROM.
 *
 * The screen calls `Installs.schedule()` / `Installs.byTeam()`. It does not
 * know whether that resolves to localStorage (demo mode) or to
 * GET /api/woodart/installation/... (API mode).
 *
 * READS  — api.js hydrates `wa_installs` at boot into the same EPAL.store cache
 *          `db.col()` reads.  WRITES — it is in api.js WRITABLE.
 *
 * THE SNAG COUNT — TWO SHAPES, ONE ANSWER
 * ---------------------------------------------------------------------------
 * The seeded store has a numeric `snags` count. The Projects module's snag
 * modal, when a user opens it, MIGRATES that number into a `snagList` array of
 * {text, done} and keeps `snags` in step. So a record in the wild may carry
 * either shape, and this module must read both — `openSnags()` prefers the
 * list when it exists and falls back to the number. Picking only one would make
 * the count disagree with the Projects drawer for exactly the records a user
 * has touched, which is the worst possible half of the data to be wrong about.
 *
 * THE RECORD SHAPE (seeded by platform/data/seed-bd.js; the exact shape the
 * Laravel InstallResource returns — see backend/endpoints.md):
 *   { id:'INS-001', project:'WAP-003', site:'Gulshan-2', team:'Team Alpha',
 *     date:'2026-07-14', status:'Snagging', snags:3,
 *     snagList:[{text:'Hinge alignment', done:false}], created:'2026-06-11' }
 * ==========================================================================*/

/* Emitted FIRST inside the module IIFE (build-module.mjs), so this file owns the
 * shared bindings; frontend/installation.js adds only its view-layer ones. */
var EPAL = window.EPAL, db = EPAL.db;

var STORE = 'wa_installs';     /* ← the one place this collection is named */
var PROJECTS = 'wa_projects';  /* read-only: this module never writes projects */

var TODAY = '2026-07-05';      /* the demo clock — same anchor as every module */

var STATUSES = ['Scheduled', 'In Progress', 'Snagging', 'Handover'];

var Installs = {

  statuses: function () { return STATUSES.slice(); },
  today: function () { return TODAY; },

  /** THE open rule: anything not handed over is still live work. */
  isOpen: function (i) { return i.status !== 'Handover'; },

  /** THE overdue rule: past its visit date and not handed over. */
  isOverdue: function (i) {
    return Installs.isOpen(i) && !!i.date && String(i.date) < TODAY;
  },

  /** THE snag count — reads BOTH shapes. See the header for why. */
  openSnags: function (i) {
    if (i.snagList && i.snagList.length) {
      return i.snagList.filter(function (s) { return !s.done; }).length;
    }
    return Math.max(0, +i.snags || 0);
  },

  /** Days until the visit (negative = days late). NaN when undated. */
  daysLeft: function (i) {
    if (!i.date) return NaN;
    var a = new Date(i.date).getTime(), b = new Date(TODAY).getTime();
    if (isNaN(a)) return NaN;
    return Math.round((a - b) / 86400000);
  },

  /** Every install, soonest visit first, undated last. */
  schedule: function () {
    return db.col(STORE).slice().sort(function (a, b) {
      var x = a.date || '9999-12-31', y = b.date || '9999-12-31';
      return x < y ? -1 : x > y ? 1 : String(a.id).localeCompare(String(b.id));
    });
  },

  find: function (id) {
    return db.col(STORE).filter(function (i) { return i.id === id; })[0] || null;
  },

  /** Only the sites still carrying snags, worst first — the handover queue. */
  snagging: function () {
    return Installs.schedule()
      .map(function (i) { return { rec: i, open: Installs.openSnags(i) }; })
      .filter(function (r) { return r.open > 0; })
      .sort(function (a, b) { return b.open - a.open; });
  },

  /** The project behind an install, or null when it points at a deleted one.
   *  Kept and flagged rather than hidden — an orphan is a data problem to SEE. */
  projectOf: function (i) {
    return db.col(PROJECTS).filter(function (p) { return p.id === i.project; })[0] || null;
  },

  projectOptions: function () {
    return db.col(PROJECTS).slice()
      .sort(function (a, b) { return String(a.id).localeCompare(String(b.id)); })
      .map(function (p) { return [p.id, p.id + ' · ' + (p.name || '')]; });
  },

  /** Team names in use, for the form's picker. */
  teamOptions: function () {
    var seen = {};
    db.col(STORE).forEach(function (i) { if (i.team) seen[i.team] = 1; });
    var names = Object.keys(seen).sort();
    return names.length ? names : ['Team Alpha', 'Team Bravo', 'Team Charlie', 'Team Delta'];
  },

  /** Load per team, busiest (most OPEN sites) first. */
  byTeam: function () {
    var acc = {};
    db.col(STORE).forEach(function (i) {
      var k = i.team || 'Unassigned';
      if (!acc[k]) acc[k] = { name: k, sites: 0, open: 0, snags: 0, overdue: 0, handover: 0 };
      acc[k].sites += 1;
      acc[k].snags += Installs.openSnags(i);
      if (Installs.isOpen(i)) acc[k].open += 1; else acc[k].handover += 1;
      if (Installs.isOverdue(i)) acc[k].overdue += 1;
    });
    return Object.keys(acc).map(function (k) { return acc[k]; })
      .sort(function (a, b) { return b.open - a.open || b.sites - a.sites; });
  },

  /** The header figures every screen quotes. One calculation, one truth. */
  summary: function () {
    var is = db.col(STORE);
    var snags = 0, active = 0, handover = 0, overdue = 0, sites = 0, clean = 0, teams = {};
    is.forEach(function (i) {
      var open = Installs.openSnags(i);
      snags += open;
      if (open > 0) sites += 1;
      if (i.status === 'In Progress' || i.status === 'Snagging') active += 1;
      if (!Installs.isOpen(i)) { handover += 1; if (open === 0) clean += 1; }
      if (Installs.isOverdue(i)) overdue += 1;
      if (i.team && Installs.isOpen(i)) teams[i.team] = 1;
    });
    var load = Installs.byTeam();
    var worst = Installs.snagging()[0];
    return {
      installs: is.length, active: active, handover: handover, overdue: overdue,
      snags: snags, sites: sites, clean: clean,
      open: is.length - handover,
      attention: is.filter(function (i) {
        return i.status === 'Snagging' || Installs.isOverdue(i);
      }).length,
      teams: Object.keys(teams).length,
      allTeams: load.length,
      rate: is.length ? Math.round(handover / is.length * 100) : 0,
      top: load.length && load[0].open ? load[0].name : '—',
      worst: worst ? (worst.rec.site || worst.rec.id) : '—'
    };
  },

  nextId: function () {
    var max = 0;
    db.col(STORE).forEach(function (i) {
      var n = parseInt(String(i.id || '').replace(/^INS-?/, ''), 10);
      if (!isNaN(n) && n > max) max = n;
    });
    return 'INS-' + String(max + 1).replace(/^(\d)$/, '00$1').replace(/^(\d\d)$/, '0$1');
  },

  save: function (rec) { return db.save(STORE, rec); },
  remove: function (id) { return db.remove(STORE, id); }
};
