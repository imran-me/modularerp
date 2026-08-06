/* ============================================================================
 * WOODART · SPACES & PHASES (scope) · DATA SEAM
 * ----------------------------------------------------------------------------
 * THE ONLY FILE IN THIS MODULE THAT KNOWS WHERE THE SCOPE DATA COMES FROM.
 *
 * The screen calls `Scope.spaces(projectId)` / `Scope.summary(projectId)`. It
 * does not know, and must never learn, whether that resolves to localStorage
 * (demo mode) or to GET /api/woodart/scope/... (API mode). That is the whole
 * point: when the Laravel backend goes live, no screen is edited.
 *
 * WHAT THIS MODULE IS FOR (companies/woodart/PROJECT-BREAKDOWN-PLAN.md)
 * ---------------------------------------------------------------------------
 * The owner's shape, 2026-08-06: a project is divided into SPACES (Master Bed
 * Room, Kitchen, Dining Room), each space runs through PHASES (Design → Colour →
 * Wood Work → Furniture), and each phase has ONE person responsible for it.
 *
 *   PROJECT (wa_projects, owned by `projects`)
 *     └ SPACE   (wa_spaces)         ← this module
 *         └ PHASE (wa_phases)       ← this module
 *
 * The rule this follows is the one ROOT-MAP.md §1 already froze — "the project
 * owns the phase; the module owns the work" — extended by exactly one clause:
 * the project owns the SPACE, the space owns the PHASE. The delivery modules
 * (design · production · installation · procurement) still own their work
 * records; nothing about them changes.
 *
 * WHY `wa_phases` CHANGED SHAPE (and why that is not an R2 break)
 * ---------------------------------------------------------------------------
 * `wa_phases` was seeded on 2026-07-28 as PROJECT-level parallel rows, for the
 * cost-control plan. No screen ever read it — grep the repo: the only other
 * mentions are the seeder and the plan document. A store with zero consumers
 * cannot change a pixel, so the rows were re-seeded with a `space` foreign key
 * rather than a second, competing phase table being invented next to it. The
 * project-level view of phases is now DERIVED (projectPhases below), so the two
 * levels can never disagree.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * ---------------------------------------------------------------------------
 *   · No money. A phase carries no amount in this slice — requirements
 *     (materials · labour · contracted work) arrive in slice 2 and are what the
 *     quotation builder and the cost matrix read. No bridge event, no posting.
 *   · No HR. The person responsible is a REFERENCE into the group `employees`
 *     store, which HRM owns. This module stores an id and nothing else.
 *
 * THE RECORD SHAPES (seeded by platform/data/seed-bd.js, and the exact shape the
 * Laravel SpaceResource / PhaseResource return — see backend/endpoints.md):
 *
 *   space  { id:'SPC-001', companyId:'woodart', project:'WAP-102',
 *            name:'Master Bed Room', kind:'Bedroom', area:320, sort:1,
 *            note:'', created:'2026-07-05' }
 *
 *   phase  { id:'PHS-0014', companyId:'woodart', project:'WAP-102',
 *            space:'SPC-001', name:'Wood Work', code:'Wood Work', sort:3,
 *            status:'Not started', ownerId:'EPL-0008',
 *            start:null, finish:null, note:'' }
 * ==========================================================================*/

/* Emitted FIRST inside the module IIFE (tools/build/build-module.mjs), so this
 * file owns the shared bindings; frontend/scope.js adds only its view-layer
 * ones. Nothing here touches window. */
var EPAL = window.EPAL, db = EPAL.db;

var SPACES    = 'wa_spaces';           /* ← the one place these collections   */
var PHASES    = 'wa_phases';           /*   are named. Everything else in the */
var TEMPLATES = 'wa_phase_templates';  /*   module goes through Scope.*       */
var PROJECTS  = 'wa_projects';         /* read-only: owned by `projects`      */
var CODES     = 'wa_cost_codes';       /* read-only: the shared cost-code list */

var CID   = 'woodart';
var TODAY = '2026-07-05';              /* the demo clock — same anchor as every module */

/* The space taxonomy. Kept here (not in the screen) because the phase TEMPLATE
 * is keyed by it and the backend validates against the same list — they are two
 * halves of one contract. */
var KINDS = ['Bedroom', 'Kitchen', 'Dining', 'Living', 'Bath', 'Balcony',
             'Office', 'Reception', 'Retail', 'Common'];

/* A phase's terminal state is `Complete` (NAMING-AND-TERMINOLOGY §2: "open"
 * means one thing per module — here it means "not Complete"). */
var STATUSES = ['Not started', 'Active', 'Complete'];

/* The fallback phase list for a space kind with no seeded template. Never
 * silently empty: a space with no phases cannot be planned, assigned or costed,
 * and an empty card reads as a bug rather than as a decision. */
var FALLBACK_PHASES = [
  { name: 'Design',        code: 'Design Fee' },
  { name: 'Wood Work',     code: 'Wood Work' },
  { name: 'Colour & Paint', code: 'Paint' },
  { name: 'Furniture',     code: 'Boards & Ply' },
  { name: 'Handover',      code: 'Installation' }
];

function num(v) { return +v || 0; }

/** Company scoping, applied identically to every collection this module reads.
 *  A row with no companyId is treated as ours — the seeded stores predate the
 *  field on some rows and dropping them would hide real data. */
function mine(r) { return !r.companyId || r.companyId === CID; }

function bySort(a, b) {
  var d = num(a.sort) - num(b.sort);
  return d !== 0 ? d : String(a.id || '').localeCompare(String(b.id || ''));
}

var Scope = {

  today:    function () { return TODAY; },
  kinds:    function () { return KINDS.slice(); },
  statuses: function () { return STATUSES.slice(); },

  /* ======================================================================
   * PROJECTS — read-only. `projects` owns this store; registering a project
   * stays on its screen so there is only ever one creation path.
   * ==================================================================== */

  projects: function () {
    return db.col(PROJECTS).filter(mine).slice().sort(function (a, b) {
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
  },

  project: function (id) {
    return db.col(PROJECTS).filter(function (p) { return p.id === id; })[0] || null;
  },

  projectName: function (id) {
    var p = Scope.project(id);
    return p ? p.name : (id || '—');
  },

  /** The picker's options — the id is part of the label because that is what
   *  people quote to each other on site. */
  projectOptions: function () {
    return Scope.projects().map(function (p) { return [p.id, p.id + ' · ' + p.name]; });
  },

  /** Which project a screen opens on when the URL names none: the first one
   *  that has actually been broken down, so the screen opens on work rather
   *  than on an empty state. */
  defaultProject: function () {
    var list = Scope.projects();
    if (!list.length) return null;
    var withSpaces = list.filter(function (p) { return Scope.spaces(p.id).length > 0; });
    return (withSpaces[0] || list[0]).id;
  },

  /** Resolve the ?p= param against reality — a stale or deleted id must fall
   *  back to a real project instead of rendering an empty screen. */
  resolveProject: function (id) {
    return (id && Scope.project(id)) ? id : Scope.defaultProject();
  },

  /* ======================================================================
   * SPACES — the project's sub-projects.
   * ==================================================================== */

  spaces: function (projectId) {
    return db.col(SPACES).filter(function (s) {
      return mine(s) && s.project === projectId;
    }).slice().sort(bySort);
  },

  space: function (id) {
    return db.col(SPACES).filter(function (s) { return s.id === id; })[0] || null;
  },

  spaceName: function (id) {
    var s = Scope.space(id);
    return s ? s.name : (id || '—');
  },

  /** Every space in the company — the Team Load screen reads across projects. */
  allSpaces: function () { return db.col(SPACES).filter(mine).slice().sort(bySort); },

  nextSpaceId: function () {
    var max = 0;
    db.col(SPACES).forEach(function (s) {
      var n = parseInt(String(s.id || '').replace(/^SPC-?/, ''), 10);
      if (!isNaN(n) && n > max) max = n;
    });
    return 'SPC-' + String(max + 1).padStart(3, '0');
  },

  /** Create or update. db.save emits data:changed, so open screens repaint. */
  saveSpace: function (rec) { return db.save(SPACES, rec); },

  /**
   * Delete a space AND its phases. A phase whose space no longer exists is
   * orphaned evidence — it would still count in every roll-up while being
   * impossible to open. Same rule the materials register applies to a deleted
   * material's movement history.
   */
  removeSpace: function (id) {
    Scope.phases(id).forEach(function (ph) { db.remove(PHASES, ph.id); });
    return db.remove(SPACES, id);
  },

  /* ======================================================================
   * PHASES — a phase belongs to a space, and to exactly one person.
   * ==================================================================== */

  /** One space's phases, in running order. */
  phases: function (spaceId) {
    return db.col(PHASES).filter(function (p) {
      return mine(p) && p.space === spaceId;
    }).slice().sort(bySort);
  },

  /** Every phase of a project — the project-level view, DERIVED from the
   *  spaces rather than stored a second time. */
  projectPhases: function (projectId) {
    return db.col(PHASES).filter(function (p) {
      return mine(p) && p.project === projectId;
    }).slice().sort(bySort);
  },

  allPhases: function () { return db.col(PHASES).filter(mine).slice().sort(bySort); },

  phase: function (id) {
    return db.col(PHASES).filter(function (p) { return p.id === id; })[0] || null;
  },

  nextPhaseId: function () {
    var max = 0;
    db.col(PHASES).forEach(function (p) {
      var n = parseInt(String(p.id || '').replace(/^PHS-?/, ''), 10);
      if (!isNaN(n) && n > max) max = n;
    });
    return 'PHS-' + String(max + 1).padStart(4, '0');
  },

  savePhase: function (rec) { return db.save(PHASES, rec); },
  removePhase: function (id) { return db.remove(PHASES, id); },

  /** THE open rule, defined once: a phase is open until it is Complete. */
  isOpen: function (ph) { return (ph && ph.status) !== 'Complete'; },

  /** THE overdue rule, defined once. The clock is the explicit demo anchor,
   *  never a bare now() — the server must not disagree with the screen about
   *  what "overdue" means (NAMING-AND-TERMINOLOGY §1.3). */
  isOverdue: function (ph) {
    return !!(ph && ph.finish && Scope.isOpen(ph) && String(ph.finish) < TODAY);
  },

  /** A phase nobody owns. The single most useful thing this screen can show:
   *  work that is planned but has no name against it. */
  isUnassigned: function (ph) { return !(ph && ph.ownerId); },

  /**
   * A phase whose space no longer exists. KEPT and flagged, never hidden —
   * the house rule for orphans. Only data drift produces one (removeSpace
   * takes its phases with it), which is exactly when it must be visible.
   */
  orphanPhases: function (projectId) {
    return Scope.projectPhases(projectId).filter(function (p) { return !Scope.space(p.space); });
  },

  /* ======================================================================
   * PHASE TEMPLATES — so nobody retypes the phase list for every room.
   * Data, not code: adding a phase type is a row, not a deploy. The same
   * principle the cost-code list already follows.
   * ==================================================================== */

  templates: function () { return db.col(TEMPLATES).filter(mine).slice().sort(bySort); },

  /** The phase list for a space kind, or the safe fallback. */
  template: function (kind) {
    var t = Scope.templates().filter(function (x) { return x.kind === kind; })[0];
    var list = (t && t.phases && t.phases.length) ? t.phases : FALLBACK_PHASES;
    return list.map(function (p) { return { name: p.name, code: p.code || '' }; });
  },

  /**
   * Create the phase rows for a space from its kind's template.
   * Returns the rows written. Existing phases are left alone and the template
   * is appended after them, so applying a template twice cannot wipe work that
   * has already been assigned or completed.
   */
  applyTemplate: function (space) {
    if (!space) return [];
    var have = Scope.phases(space.id);
    var haveNames = {};
    have.forEach(function (p) { haveNames[String(p.name).toLowerCase()] = 1; });

    var sort = have.length ? num(have[have.length - 1].sort) + 1 : 1;
    var written = [];
    Scope.template(space.kind).forEach(function (t) {
      if (haveNames[String(t.name).toLowerCase()]) return;   // never duplicate
      var row = {
        id: Scope.nextPhaseId(), companyId: CID, project: space.project, space: space.id,
        name: t.name, code: t.code || '', sort: sort++,
        status: 'Not started', ownerId: '', start: null, finish: null, note: ''
      };
      db.save(PHASES, row);
      written.push(row);
    });
    return written;
  },

  /* ======================================================================
   * DERIVED FIGURES — computed on read, never stored. A stored total is a
   * total that drifts, which is exactly how the Munshi spreadsheet's summary
   * stopped matching its own detail sheets (PROJECT-PROFILE-PLAN §5).
   * ==================================================================== */

  /**
   * A space's progress = phases complete ÷ phases total.
   *
   * ⚠️ Slice 2 changes this to WEIGHT BY PHASE COST once requirements exist
   * (a ৳4 lakh wood-work phase should not count the same as a ৳15,000 handover).
   * It is one function in one file precisely so that change lands in one place.
   */
  progressOf: function (spaceId) {
    var list = Scope.phases(spaceId);
    var done = list.filter(function (p) { return p.status === 'Complete'; }).length;
    return { done: done, total: list.length,
             pct: list.length ? Math.round(done / list.length * 100) : 0 };
  },

  /** A space's status, DERIVED from its phases so the card and the board can
   *  never contradict each other. */
  statusOf: function (spaceId) {
    var list = Scope.phases(spaceId);
    if (!list.length) return 'Not started';
    if (list.every(function (p) { return p.status === 'Complete'; })) return 'Complete';
    if (list.some(function (p) { return p.status !== 'Not started'; })) return 'Active';
    return 'Not started';
  },

  /** The same for a whole project — the strip a project profile would show. */
  projectProgress: function (projectId) {
    var list = Scope.projectPhases(projectId);
    var done = list.filter(function (p) { return p.status === 'Complete'; }).length;
    return { done: done, total: list.length,
             pct: list.length ? Math.round(done / list.length * 100) : 0 };
  },

  /** The header figures every screen in this module quotes. One calculation. */
  summary: function (projectId) {
    var phases = Scope.projectPhases(projectId);
    var counts = { 'Not started': 0, 'Active': 0, 'Complete': 0 };
    var unassigned = 0, overdue = 0;
    phases.forEach(function (p) {
      if (counts[p.status] === undefined) counts[p.status] = 0;
      counts[p.status]++;
      if (Scope.isUnassigned(p) && Scope.isOpen(p)) unassigned++;
      if (Scope.isOverdue(p)) overdue++;
    });
    var spaces = Scope.spaces(projectId);
    return {
      spaces: spaces.length,
      phases: phases.length,
      notStarted: counts['Not started'],
      active: counts['Active'],
      complete: counts['Complete'],
      unassigned: unassigned,
      overdue: overdue,
      area: spaces.reduce(function (t, s) { return t + num(s.area); }, 0),
      progress: Scope.projectProgress(projectId).pct
    };
  },

  /** One space with everything a card needs, so the screen formats and nothing
   *  more. */
  card: function (space) {
    return {
      rec: space,
      phases: Scope.phases(space.id),
      progress: Scope.progressOf(space.id),
      status: Scope.statusOf(space.id),
      unassigned: Scope.phases(space.id).filter(function (p) {
        return Scope.isUnassigned(p) && Scope.isOpen(p);
      }).length
    };
  },

  /* ======================================================================
   * PEOPLE — read-only from the group `employees` store, which HRM owns.
   * This module stores an id on the phase and nothing else: no employee data
   * is duplicated and no HR feature is invented here.
   * ==================================================================== */

  /** Woodart's own staff first, then group-level people who can also carry a
   *  phase (the owner, the group directors). */
  people: function () {
    var all = (db.employees ? db.employees() : []).filter(function (e) {
      return e.companyId === CID || e.companyId === 'group';
    });
    return all.sort(function (a, b) {
      if ((a.companyId === CID) !== (b.companyId === CID)) return a.companyId === CID ? -1 : 1;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
  },

  person: function (id) {
    return Scope.people().filter(function (e) { return e.id === id; })[0] || null;
  },

  /** A name for an id — including one whose employee record has gone. An owner
   *  who no longer exists is shown as Orphan and kept, never silently blanked. */
  personName: function (id) {
    if (!id) return '';
    var e = Scope.person(id) || (db.employee ? db.employee(id) : null);
    return e ? e.name : id + ' (orphan)';
  },

  personOptions: function () {
    return Scope.people().map(function (e) {
      return [e.id, e.name + ' · ' + (e.designation || e.dept || '')];
    });
  },

  /** Initials for the assignee pill. Two letters, upper case, no punctuation. */
  initials: function (id) {
    var n = Scope.personName(id).replace(/\(.*\)/, '').trim();
    if (!n) return '—';
    var parts = n.split(/\s+/);
    return ((parts[0] || '')[0] + (parts.length > 1 ? (parts[parts.length - 1] || '')[0] : '')).toUpperCase();
  },

  /**
   * TEAM LOAD — who is carrying what, across every project.
   * Everyone on the roster appears, including people with nothing open: "who is
   * free" is half the question this screen answers.
   */
  load: function () {
    var open = Scope.allPhases().filter(Scope.isOpen);
    var byPerson = {};
    open.forEach(function (p) {
      var k = p.ownerId || '';
      if (!byPerson[k]) byPerson[k] = { phases: [], projects: {}, spaces: {}, overdue: 0 };
      byPerson[k].phases.push(p);
      byPerson[k].projects[p.project] = 1;
      byPerson[k].spaces[p.space] = 1;
      if (Scope.isOverdue(p)) byPerson[k].overdue++;
    });

    var rows = Scope.people().map(function (e) {
      var b = byPerson[e.id] || { phases: [], projects: {}, spaces: {}, overdue: 0 };
      return { id: e.id, name: e.name, dept: e.dept || '', designation: e.designation || '',
        open: b.phases.length, projects: Object.keys(b.projects).length,
        spaces: Object.keys(b.spaces).length, overdue: b.overdue,
        active: b.phases.filter(function (p) { return p.status === 'Active'; }).length };
    });

    return rows.sort(function (a, b) { return b.open - a.open || a.name.localeCompare(b.name); });
  },

  /** Open phases with nobody against them — the queue the load screen exists
   *  to shrink. */
  unassignedPhases: function () {
    return Scope.allPhases().filter(function (p) {
      return Scope.isOpen(p) && Scope.isUnassigned(p);
    });
  },

  /* ======================================================================
   * COST CODES — read-only. The shared vocabulary every estimate, purchase
   * order and expense is already tagged with (PROJECT-PROFILE-PLAN §2). A
   * phase carries one so that plan, purchase and actual can be compared
   * without a second list to keep aligned.
   * ==================================================================== */

  codes: function () {
    return db.col(CODES).filter(mine).slice().sort(bySort);
  },

  codeOptions: function () {
    return Scope.codes().map(function (c) { return [c.id, c.label || c.code || c.id]; });
  },

  codeLabel: function (id) {
    if (!id) return '';
    var c = Scope.codes().filter(function (x) { return x.id === id; })[0];
    return c ? (c.label || c.code || c.id) : id;
  }
};

/* Exposed READ-ONLY for the verification harness — MODULE-STANDARD §3: a test
 * that re-implements a rule proves nothing, because it passes even when the
 * shipped rule is wrong. Nothing else in this module goes on a global. */
(EPAL.diag = EPAL.diag || {}).woodartScope = Scope;
