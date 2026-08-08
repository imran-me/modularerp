/* ============================================================================
 * WOODART · DESIGN & 3D · DATA SEAM
 * ----------------------------------------------------------------------------
 * THE ONLY FILE IN THIS MODULE THAT KNOWS WHERE DESIGN DATA COMES FROM.
 *
 * The screen calls `Design.register()` / `Design.queue()`. It does not know
 * whether that resolves to localStorage (demo mode) or to
 * GET /api/woodart/design/... (API mode).
 *
 * WHY THIS MODULE EXISTS (companies/woodart/ROOT-MAP.md §1)
 * ---------------------------------------------------------------------------
 * A project moves through PHASES, and each delivery phase has ONE module that
 * owns the work records produced during it. Production owns fabrication jobs;
 * Installation owns site visits. The ARCHITECTURE & 3D phase had no owner at
 * all — its work lived in a kanban column called "Design Studio" and nowhere
 * else. This module is that owner.
 *
 * TWO STORES, ONE LIFECYCLE
 * ---------------------------------------------------------------------------
 *   wa_drawings   the deliverable, carrying its CURRENT revision and status
 *   wa_revisions  the trail — one row per revision letter, per action
 *
 * The trail is a separate store, not a JSON blob on the drawing, because a
 * revision is an AUDIT record: who issued it, what the client said, when it was
 * approved. Installation embeds its snag list because a snag is a checklist
 * item; a revision is evidence, and evidence gets its own row.
 *
 * THE RECORD SHAPES (seeded by platform/data/seed-bd.js; the exact shapes the
 * Laravel Resources return — see backend/endpoints.md):
 *   drawing  { id:'DWG-001', project:'WAP-001', title:'Plan — Office Fit-out',
 *              kind:'Plan', rev:'B', status:'Issued', designer:'Nasrin Sultana',
 *              issued:'2026-06-14', approved:null, created:'2026-06-01' }
 *   revision { id:'RVN-001', drawing:'DWG-001', rev:'A', action:'Revised',
 *              by:'Nasrin Sultana', note:'Client comments incorporated',
 *              date:'2026-06-02' }
 * ==========================================================================*/

/* Emitted FIRST inside the module IIFE (build-module.mjs), so this file owns the
 * shared bindings; frontend/design.js adds only its view-layer ones. */
var EPAL = window.EPAL, db = EPAL.db;

var DRAWINGS = 'wa_drawings';    /* ← the one place these are named */
var REVISIONS = 'wa_revisions';
var PROJECTS = 'wa_projects';    /* read-only: this module never writes projects */

var TODAY = '2026-07-05';        /* the demo clock — same anchor as every module */

var KINDS = ['Plan', 'Elevation', 'Section', 'Detail', '3D Model', 'Render'];
var STATUSES = ['Draft', 'Issued', 'Commented', 'Approved'];
var ACTIONS = ['Drafted', 'Issued', 'Commented', 'Revised', 'Approved'];

var Design = {

  kinds: function () { return KINDS.slice(); },
  statuses: function () { return STATUSES.slice(); },
  today: function () { return TODAY; },

  /** THE open rule: anything not Approved is still design work in flight. */
  isOpen: function (d) { return d.status !== 'Approved'; },

  /** Sitting with the CLIENT — issued and not yet answered. This is the only
   *  state where the wait is somebody else's; everything else is on us. */
  isWaiting: function (d) { return d.status === 'Issued'; },

  /** Days a drawing has been sitting with the client. NaN when not issued. */
  waitingDays: function (d) {
    if (!Design.isWaiting(d) || !d.issued) return NaN;
    var a = new Date(d.issued).getTime(), b = new Date(TODAY).getTime();
    if (isNaN(a)) return NaN;
    return Math.max(0, Math.round((b - a) / 86400000));
  },

  /** Every deliverable, most recently issued first, undated last. */
  register: function () {
    return db.col(DRAWINGS).slice().sort(function (a, b) {
      var x = a.issued || '', y = b.issued || '';
      if (x === y) return String(a.id).localeCompare(String(b.id));
      if (!x) return 1;
      if (!y) return -1;
      return x < y ? 1 : -1;
    });
  },

  find: function (id) {
    return db.col(DRAWINGS).filter(function (d) { return d.id === id; })[0] || null;
  },

  /** The full revision trail of one deliverable, oldest first. */
  trail: function (drawingId) {
    return db.col(REVISIONS).filter(function (r) { return r.drawing === drawingId; })
      .sort(function (a, b) { return String(a.rev).localeCompare(String(b.rev)); });
  },

  /** How many times a deliverable has been revised (A = none). */
  revCount: function (d) {
    var n = String(d.rev || 'A').charCodeAt(0) - 65;
    return n > 0 ? n : 0;
  },

  /** The next revision letter after the current one. */
  nextRev: function (d) {
    return String.fromCharCode(Math.min(90, String(d.rev || 'A').charCodeAt(0) + 1));
  },

  /** Only what is with the client, longest wait first — the approval queue. */
  queue: function () {
    return Design.register().filter(Design.isWaiting)
      .map(function (d) { return { rec: d, days: Design.waitingDays(d) }; })
      .sort(function (a, b) { return (b.days || 0) - (a.days || 0); });
  },

  /** The project behind a deliverable, or null when it points at a deleted one.
   *  Kept and flagged, never hidden — an orphan is a data problem to SEE. */
  projectOf: function (d) {
    return db.col(PROJECTS).filter(function (p) { return p.id === d.project; })[0] || null;
  },

  projectOptions: function () {
    return db.col(PROJECTS).slice()
      .sort(function (a, b) { return String(a.id).localeCompare(String(b.id)); })
      .map(function (p) { return [p.id, p.id + ' · ' + (p.name || '')]; });
  },

  designerOptions: function () {
    var seen = {};
    (db.employees ? db.employees({ companyId: 'woodart' }) : []).forEach(function (e) { seen[e.name] = 1; });
    db.col(DRAWINGS).forEach(function (d) { if (d.designer) seen[d.designer] = 1; });
    return Object.keys(seen).sort();
  },

  /** THE PHASE GATE, and the reason this module matters to the project spine:
   *  a project's design phase is complete only when it HAS deliverables and
   *  every one of them is Approved. A project with none has not started design
   *  — which is NOT the same as being finished, and must never count as such. */
  projectStatus: function () {
    var acc = {};
    db.col(DRAWINGS).forEach(function (d) {
      var k = d.project || 'Unassigned';
      if (!acc[k]) acc[k] = { project: k, total: 0, open: 0, waiting: 0, approved: 0 };
      acc[k].total += 1;
      if (Design.isOpen(d)) acc[k].open += 1; else acc[k].approved += 1;
      if (Design.isWaiting(d)) acc[k].waiting += 1;
    });
    return Object.keys(acc).map(function (k) {
      var r = acc[k];
      r.complete = r.total > 0 && r.open === 0;
      return r;
    }).sort(function (a, b) { return b.open - a.open || b.total - a.total; });
  },

  /** Load per designer, busiest (most OPEN deliverables) first. */
  byDesigner: function () {
    var acc = {};
    db.col(DRAWINGS).forEach(function (d) {
      var k = d.designer || 'Unassigned';
      if (!acc[k]) acc[k] = { name: k, total: 0, open: 0, waiting: 0, revisions: 0, approved: 0 };
      acc[k].total += 1;
      acc[k].revisions += Design.revCount(d);
      if (Design.isOpen(d)) acc[k].open += 1; else acc[k].approved += 1;
      if (Design.isWaiting(d)) acc[k].waiting += 1;
    });
    return Object.keys(acc).map(function (k) { return acc[k]; })
      .sort(function (a, b) { return b.open - a.open || b.total - a.total; });
  },

  /** Deliverables grouped by kind — the mix chart. */
  byKind: function () {
    var acc = {};
    db.col(DRAWINGS).forEach(function (d) {
      var k = d.kind || 'Other';
      if (!acc[k]) acc[k] = { name: k, count: 0 };
      acc[k].count += 1;
    });
    return Object.keys(acc).map(function (k) { return acc[k]; })
      .sort(function (a, b) { return b.count - a.count; });
  },

  /** The header figures every screen quotes. One calculation, one truth. */
  summary: function () {
    var all = db.col(DRAWINGS);
    var issued = 0, commented = 0, approved = 0, draft = 0, revs = 0, designers = {};
    all.forEach(function (d) {
      if (d.status === 'Issued') issued += 1;
      if (d.status === 'Commented') commented += 1;
      if (d.status === 'Draft') draft += 1;
      if (!Design.isOpen(d)) approved += 1;
      revs += Design.revCount(d);
      if (d.designer) designers[d.designer] = 1;
    });
    var q = Design.queue();
    var projects = Design.projectStatus();
    var load = Design.byDesigner();
    return {
      drawings: all.length, issued: issued, commented: commented,
      approved: approved, draft: draft,
      open: all.length - approved,
      attention: issued + commented,
      waiting: q.length,
      oldest: q.length && !isNaN(q[0].days) ? q[0].days + 'd' : '—',
      complete: projects.filter(function (p) { return p.complete; }).length,
      projects: projects.length,
      avgRev: all.length ? (revs / all.length).toFixed(1) : '0.0',
      designers: Object.keys(designers).length,
      rate: all.length ? Math.round(approved / all.length * 100) : 0,
      top: load.length && load[0].open ? load[0].name : '—'
    };
  },

  nextId: function () { return nextSeq(DRAWINGS, 'DWG'); },
  nextRevId: function () { return nextSeq(REVISIONS, 'RVN'); },

  /** Save a deliverable AND record what happened to it in the trail.
   *  A status change is evidence, so it is never saved without a row saying
   *  who did it and when — the same principle as a ledger reversal. */
  save: function (rec, opts) {
    opts = opts || {};
    var before = Design.find(rec.id);
    var saved = db.save(DRAWINGS, rec) || rec;
    var changed = !before || before.status !== saved.status || before.rev !== saved.rev;
    if (changed) {
      db.save(REVISIONS, {
        id: Design.nextRevId(), drawing: saved.id, rev: saved.rev || 'A',
        action: actionFor(before, saved), by: saved.designer || '',
        note: opts.note || '', date: TODAY
      });
    }
    return saved;
  },

  /** Delete a deliverable and its trail — the trail has no meaning without it.
   *  ONE request: `DesignService::delete` already clears the revisions on the
   *  server, so the trail goes from this browser with `removeLocal` and only the
   *  drawing DELETE travels. A DELETE per revision is the flood shape that broke
   *  the project delete on 2026-08-08. */
  remove: function (id) {
    db.col(REVISIONS).filter(function (r) { return r.drawing === id; })
      .forEach(function (r) { db.removeLocal(REVISIONS, r.id); });
    return db.remove(DRAWINGS, id);
  }
};

/** What to call the transition that just happened. Named rather than inlined so
 *  the trail's vocabulary lives in one place (NAMING-AND-TERMINOLOGY §1.2). */
function actionFor(before, after) {
  if (!before) return after.status === 'Draft' ? 'Drafted' : after.status;
  if (before.rev !== after.rev) return 'Revised';
  return ACTIONS.indexOf(after.status) >= 0 ? after.status : 'Revised';
}

/** Next free id in a seeded PREFIX-000 series. */
function nextSeq(store, prefix) {
  var max = 0, re = new RegExp('^' + prefix + '-?');
  db.col(store).forEach(function (r) {
    var n = parseInt(String(r.id || '').replace(re, ''), 10);
    if (!isNaN(n) && n > max) max = n;
  });
  return prefix + '-' + String(max + 1).replace(/^(\d)$/, '00$1').replace(/^(\d\d)$/, '0$1');
}
