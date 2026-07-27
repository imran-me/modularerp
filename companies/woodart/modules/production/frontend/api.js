/* ============================================================================
 * WOODART · WORKSHOP (production) · DATA SEAM
 * ----------------------------------------------------------------------------
 * THE ONLY FILE IN THIS MODULE THAT KNOWS WHERE JOB DATA COMES FROM.
 *
 * The screen calls `Workshop.jobs()` / `Workshop.byStation()`. It does not
 * know, and must never learn, whether that resolves to localStorage (demo mode)
 * or to GET /api/woodart/production/... (API mode).
 *
 * READS  — platform/data/api.js hydrates `wa_production` at boot into the same
 *          EPAL.store cache `db.col()` reads.
 * WRITES — `wa_production` is in api.js WRITABLE, so edits persist.
 *
 * THE DATE RULE (why TODAY is a constant here)
 * ---------------------------------------------------------------------------
 * "Overdue" is relative to a date, and this app runs on a fixed DEMO CLOCK
 * (2026-07-05) so that seeded data tells a stable story and screenshots are
 * reproducible. Using the real `new Date()` would make the KPIs drift every day
 * and the parity harness unrepeatable. Every module in this repo anchors to the
 * same constant; when the app goes live this is the one line that changes.
 *
 * THE RECORD SHAPE (seeded by platform/data/seed-bd.js; the exact shape the
 * Laravel JobResource returns — see backend/endpoints.md):
 *   { id:'JOB-001', job:'Wardrobe shutters', project:'WAP-004',
 *     station:'CNC', assignedTo:'Omar Faruk', due:'2026-07-18',
 *     status:'Running', created:'2026-06-11' }
 * ==========================================================================*/

/* Emitted FIRST inside the module IIFE (build-module.mjs), so this file owns the
 * shared bindings; frontend/production.js adds only its view-layer ones. */
var EPAL = window.EPAL, db = EPAL.db;

var STORE = 'wa_production';   /* ← the one place this collection is named */
var PROJECTS = 'wa_projects';  /* read-only: this module never writes projects */

var TODAY = '2026-07-05';      /* the demo clock — see the header */

/* The shop floor's vocabulary. The backend validates against the same lists. */
var STATIONS = ['CNC', 'Cutting', 'Edge Banding', 'Assembly', 'Finishing'];
var STATUSES = ['Queued', 'Running', 'Blocked', 'Done'];

var Workshop = {

  stations: function () { return STATIONS.slice(); },
  statuses: function () { return STATUSES.slice(); },
  today: function () { return TODAY; },

  /** THE open rule, defined once: anything not Done is still work. */
  isOpen: function (j) { return j.status !== 'Done'; },

  /** THE overdue rule: past its due date and not finished. A Done job is never
   *  overdue however late it was — it is finished, and the register should not
   *  keep shouting about it. */
  isOverdue: function (j) {
    return Workshop.isOpen(j) && !!j.due && String(j.due) < TODAY;
  },

  /** Days until due (negative = days late). NaN when there is no due date. */
  daysLeft: function (j) {
    if (!j.due) return NaN;
    var a = new Date(j.due).getTime(), b = new Date(TODAY).getTime();
    if (isNaN(a)) return NaN;
    return Math.round((a - b) / 86400000);
  },

  /** Every job, soonest due first, undated last — the register's order and the
   *  order the board columns fill, so the most urgent card is always on top. */
  jobs: function () {
    return db.col(STORE).slice().sort(function (a, b) {
      var x = a.due || '9999-12-31', y = b.due || '9999-12-31';
      return x < y ? -1 : x > y ? 1 : String(a.id).localeCompare(String(b.id));
    });
  },

  job: function (id) {
    return db.col(STORE).filter(function (j) { return j.id === id; })[0] || null;
  },

  /** The jobs in one board column. */
  byStatus: function (status) {
    return Workshop.jobs().filter(function (j) { return j.status === status; });
  },

  /** The project a job belongs to, or null when it points at a project that no
   *  longer exists. The card shows the raw id in that case rather than hiding
   *  the job — an orphan job is a data problem you want to SEE. */
  projectOf: function (j) {
    return db.col(PROJECTS).filter(function (p) { return p.id === j.project; })[0] || null;
  },

  /** Project ids + names, for the job form's picker. */
  projectOptions: function () {
    return db.col(PROJECTS).slice()
      .sort(function (a, b) { return String(a.id).localeCompare(String(b.id)); })
      .map(function (p) { return [p.id, p.id + ' · ' + (p.name || '')]; });
  },

  /** Who can be assigned — the real Woodart employees, falling back to the
   *  names already used on jobs so the picker is never empty on a fresh DB. */
  crewOptions: function () {
    var seen = {};
    (db.employees ? db.employees({ companyId: 'woodart' }) : []).forEach(function (e) { seen[e.name] = 1; });
    db.col(STORE).forEach(function (j) { if (j.assignedTo) seen[j.assignedTo] = 1; });
    return Object.keys(seen).sort();
  },

  /** Load per station, busiest (most OPEN jobs) first. Open jobs are what a
   *  workshop manager schedules around; finished ones are history. */
  byStation: function () {
    var acc = {};
    db.col(STORE).forEach(function (j) {
      var k = j.station || 'Unassigned';
      if (!acc[k]) acc[k] = { name: k, total: 0, open: 0, running: 0, blocked: 0, overdue: 0, done: 0 };
      acc[k].total += 1;
      if (Workshop.isOpen(j)) acc[k].open += 1; else acc[k].done += 1;
      if (j.status === 'Running') acc[k].running += 1;
      if (j.status === 'Blocked') acc[k].blocked += 1;
      if (Workshop.isOverdue(j)) acc[k].overdue += 1;
    });
    return Object.keys(acc).map(function (k) { return acc[k]; })
      .sort(function (a, b) { return b.open - a.open || b.total - a.total; });
  },

  /** The header figures every screen quotes. One calculation, one truth. */
  summary: function () {
    var js = db.col(STORE);
    var running = 0, blocked = 0, overdue = 0, done = 0, crew = {}, stations = {};
    js.forEach(function (j) {
      if (j.status === 'Running') running += 1;
      if (j.status === 'Blocked') blocked += 1;
      if (!Workshop.isOpen(j)) done += 1;
      if (Workshop.isOverdue(j)) overdue += 1;
      if (j.assignedTo) crew[j.assignedTo] = 1;
      if (j.station) stations[j.station] = 1;
    });
    var load = Workshop.byStation();
    return {
      jobs: js.length, running: running, blocked: blocked, overdue: overdue, done: done,
      open: js.length - done,
      attention: blocked + overdue,
      pct: js.length ? Math.round(done / js.length * 100) : 0,
      crew: Object.keys(crew).length,
      stations: Object.keys(stations).length,
      top: load.length && load[0].open ? load[0].name : '—'
    };
  },

  nextId: function () {
    var max = 0;
    db.col(STORE).forEach(function (j) {
      var n = parseInt(String(j.id || '').replace(/^JOB-?/, ''), 10);
      if (!isNaN(n) && n > max) max = n;
    });
    return 'JOB-' + String(max + 1).replace(/^(\d)$/, '00$1').replace(/^(\d\d)$/, '0$1');
  },

  save: function (rec) { return db.save(STORE, rec); },
  remove: function (id) { return db.remove(STORE, id); }
};
