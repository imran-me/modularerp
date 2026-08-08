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
var REQS      = 'wa_requirements';     /*   what each phase needs (slice 2)   */
var PROJECTS  = 'wa_projects';         /* read-only: owned by `projects`      */
var CODES     = 'wa_cost_codes';       /* read-only: the shared cost-code list */
var MATERIALS = 'wa_materials';        /* read-only: owned by `materials` —
                                          stock levels, for the shortfall     */

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

/* WHAT A PHASE CAN NEED. One line table, three kinds — the decision the whole
 * of slice 2 hangs off (PROJECT-BREAKDOWN-PLAN §4.3): the quotation builder,
 * the material listing, the labour estimate and the cost matrix are then ONE
 * query with a filter, instead of four features that can disagree.
 *
 *   material  qty of a real material          24 sheet × ৳3,610
 *   labour    man-days at a day rate          (2 men × 6 days) × ৳900
 *   contract  work bought whole, as a lump    1 lot × ৳3,41,000
 *
 * `labour` keeps men and days in the UNIT ('man-day') and the quantity for now;
 * the hiring desk that needs them as separate fields is slice 4, and splitting
 * them before it exists would be a column nothing reads. */
var REQ_KINDS = ['material', 'labour', 'contract'];

/* A requirement's life: planned → quoted to the client → ordered from a vendor →
 * issued to the job. It is deliberately NOT the phase's status: a phase can be
 * running while half its material is still on order. */
var REQ_STATUSES = ['Planned', 'Quoted', 'Ordered', 'Issued'];

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
   *
   * ONE request. `ScopeService::deleteSpace` runs the same cascade server-side
   * in a transaction, so the children are cleared from this browser with
   * `removeLocal` and only the space DELETE travels. Looping `db.remove` here
   * would fire one HTTP call per phase and per requirement — the shape that
   * flooded the host's connection cap on 2026-08-08. Change one side, change
   * the other.
   */
  removeSpace: function (id) {
    Scope.phases(id).forEach(function (ph) {
      Scope.requirements(ph.id).forEach(function (r) { db.removeLocal(REQS, r.id); });
      db.removeLocal(PHASES, ph.id);
    });
    /* belt and braces: a line whose phase was already gone would otherwise
     * survive its own room and keep counting in the project's demand */
    Scope.spaceRequirements(id).forEach(function (r) { db.removeLocal(REQS, r.id); });
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

  /** Deleting a phase takes its requirements with it — a planned line whose
   *  phase is gone would still be counted by the demand list and the quotation
   *  while being impossible to open or edit. Same rule as space → phases, and
   *  the same one-request rule: `ScopeService::deletePhase` clears the lines
   *  server-side, so only the phase DELETE travels. */
  removePhase: function (id) {
    Scope.requirements(id).forEach(function (r) { db.removeLocal(REQS, r.id); });
    return db.remove(PHASES, id);
  },

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
   * REQUIREMENTS — what a phase needs: material, labour or contracted work.
   * The owner's sentence this implements: "what materials will be needed in
   * that specific phase — that materials will be added to the master quotation
   * builder or material listing."
   * ==================================================================== */

  reqKinds:    function () { return REQ_KINDS.slice(); },
  reqStatuses: function () { return REQ_STATUSES.slice(); },

  /** One phase's lines, in entry order. */
  requirements: function (phaseId) {
    return db.col(REQS).filter(function (r) { return mine(r) && r.phase === phaseId; });
  },

  spaceRequirements: function (spaceId) {
    return db.col(REQS).filter(function (r) { return mine(r) && r.space === spaceId; });
  },

  projectRequirements: function (projectId) {
    return db.col(REQS).filter(function (r) { return mine(r) && r.project === projectId; });
  },

  requirement: function (id) {
    return db.col(REQS).filter(function (r) { return r.id === id; })[0] || null;
  },

  /** THE line formulas, defined once. Everything downstream — the phase drawer's
   *  footer, the space card, the demand list, the quotation builder in slice 3 —
   *  totals with these two and nothing else. */
  amount: function (r) { return num(r.qty) * num(r.unitCost); },
  quote:  function (r) { return num(r.qty) * num(r.unitSale); },

  /** Cost and quote of any set of lines, plus its margin. */
  totals: function (rows) {
    var cost = 0, quote = 0;
    (rows || []).forEach(function (r) { cost += Scope.amount(r); quote += Scope.quote(r); });
    return { lines: (rows || []).length, cost: cost, quote: quote, margin: quote - cost,
             marginPct: quote > 0 ? Math.round((quote - cost) / quote * 100) : 0 };
  },

  costOfPhase:   function (phaseId)   { return Scope.totals(Scope.requirements(phaseId)); },
  costOfSpace:   function (spaceId)   { return Scope.totals(Scope.spaceRequirements(spaceId)); },
  costOfProject: function (projectId) { return Scope.totals(Scope.projectRequirements(projectId)); },

  nextReqId: function () {
    var max = 0;
    db.col(REQS).forEach(function (r) {
      var n = parseInt(String(r.id || '').replace(/^REQ-?/, ''), 10);
      if (!isNaN(n) && n > max) max = n;
    });
    return 'REQ-' + String(max + 1).padStart(4, '0');
  },

  saveRequirement: function (rec) { return db.save(REQS, rec); },
  removeRequirement: function (id) { return db.remove(REQS, id); },

  /**
   * REPLACE a phase's requirement lines with what the editor returned.
   *
   * The platform's line-item repeater hands back only the columns it was given,
   * so an id cannot survive the round trip. Rather than mint a fresh id for
   * every line on every save — which would break the engagement → requirement
   * link the hiring desk needs in slice 4 — ids are reused POSITIONALLY: row 1
   * keeps row 1's id. Editing a quantity therefore leaves the id alone, and
   * only genuinely new rows get new ids.
   */
  saveRequirements: function (phase, rows) {
    if (!phase) return [];
    var existing = Scope.requirements(phase.id);
    var kept = [];

    (rows || []).forEach(function (row, i) {
      var item = String(row.item || '').trim();
      if (!item) return;                                  // a blank line is not a requirement
      var old = existing[kept.length] || null;
      var kind = REQ_KINDS.indexOf(row.kind) >= 0 ? row.kind : 'material';
      var rec = {
        id: (old && old.id) || Scope.nextReqId(),
        companyId: CID, project: phase.project, space: phase.space, phase: phase.id,
        kind: kind,
        code: row.code || (old && old.code) || phase.code || '',
        item: item,
        materialId: kind === 'material' ? (Scope.materialIdOf(item) || null) : null,
        qty: num(row.qty),
        unit: row.unit || (kind === 'labour' ? 'man-day' : kind === 'contract' ? 'lot' : ''),
        unitCost: num(row.unitCost),
        unitSale: num(row.unitSale),
        status: REQ_STATUSES.indexOf(row.status) >= 0 ? row.status : ((old && old.status) || 'Planned'),
        note: row.note || ''
      };
      db.save(REQS, rec);
      kept.push(rec);
    });

    /* whatever the editor dropped, drop from the store too */
    existing.slice(kept.length).forEach(function (r) { db.remove(REQS, r.id); });
    return kept;
  },

  /* ---- the material listing --------------------------------------------- */

  /** The register, read-only — the picker and the shortfall both need it. */
  materials: function () {
    return db.col(MATERIALS).slice().sort(function (a, b) {
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
  },
  materialIdOf: function (name) {
    var m = db.col(MATERIALS).filter(function (x) { return x.name === name; })[0];
    return m ? m.id : null;
  },
  materialByName: function (name) {
    return db.col(MATERIALS).filter(function (x) { return x.name === name; })[0] || null;
  },

  /**
   * MATERIAL DEMAND — every `material` line of a project rolled up per item,
   * against what the register actually holds.
   *
   * `short` is what has to be bought. It is the honest number only because the
   * roll-up is by ITEM NAME across every phase: asking each phase separately
   * would order the same plywood four times.
   */
  demand: function (projectId) {
    var bag = {};
    Scope.projectRequirements(projectId).forEach(function (r) {
      if (r.kind !== 'material') return;
      var key = r.item;
      if (!bag[key]) {
        bag[key] = { item: r.item, unit: r.unit || '', materialId: r.materialId || null,
                     qty: 0, committed: 0, cost: 0, quote: 0, phases: 0, spaces: {}, codes: {} };
      }
      var row = bag[key];
      row.qty += num(r.qty);
      /* Already ordered or already issued is NOT demand. The rod on this villa
       * was bought and poured months ago; a list that still asked for 9,819 kg
       * of it would send somebody to buy the building twice. */
      if (r.status === 'Ordered' || r.status === 'Issued') row.committed += num(r.qty);
      row.cost += Scope.amount(r);
      row.quote += Scope.quote(r);
      row.phases += 1;
      row.spaces[r.space] = 1;
      if (r.code) row.codes[r.code] = 1;
    });

    return Object.keys(bag).map(function (k) {
      var row = bag[k];
      var mat = Scope.materialByName(row.item);
      row.outstanding = Math.max(0, row.qty - row.committed);
      row.stock = mat ? num(mat.stock) : null;      // null = not a stocked item
      /* what has to be BOUGHT: what is still to come, less what is on the shelf */
      row.short = mat ? Math.max(0, row.outstanding - num(mat.stock)) : row.outstanding;
      row.shortCost = row.short * (mat ? num(mat.unitCost) : (row.qty ? row.cost / row.qty : 0));
      row.spaceCount = Object.keys(row.spaces).length;
      row.code = Object.keys(row.codes)[0] || '';
      row.listed = !!mat;
      return row;
    }).sort(function (a, b) { return b.cost - a.cost; });
  },

  /** The demand screen's header figures. */
  demandSummary: function (projectId) {
    var rows = Scope.demand(projectId);
    var reqs = Scope.projectRequirements(projectId);
    var short = rows.filter(function (r) { return r.short > 0; });
    var work = reqs.filter(function (r) { return r.kind !== 'material'; });
    var stillToBuy = rows.filter(function (r) { return r.outstanding > 0; });
    return {
      items: rows.length,
      lines: reqs.filter(function (r) { return r.kind === 'material'; }).length,
      cost: rows.reduce(function (t, r) { return t + r.cost; }, 0),
      openItems: stillToBuy.length,
      shortItems: short.length,
      shortCost: short.reduce(function (t, r) { return t + r.shortCost; }, 0),
      unlisted: rows.filter(function (r) { return !r.listed; }).length,
      workCost: Scope.totals(work).cost,
      workLines: work.length
    };
  },

  /* ======================================================================
   * DERIVED FIGURES — computed on read, never stored. A stored total is a
   * total that drifts, which is exactly how the Munshi spreadsheet's summary
   * stopped matching its own detail sheets (PROJECT-PROFILE-PLAN §5).
   * ==================================================================== */

  /**
   * A space's progress — WEIGHTED BY WHAT EACH PHASE IS WORTH (slice 2).
   *
   * Counting phases treats a ৳4 lakh wood-work phase and a ৳15,000 handover as
   * the same thing, which flatters a job that has finished the cheap parts.
   * Now that a phase carries requirements it carries a cost, so the weight is
   * that cost. A phase with nothing planned against it still counts as one
   * unit — otherwise an unpriced phase would silently vanish from the total.
   *
   * `done`/`total` stay a COUNT, because "3 of 8 phases" is what a person
   * wants read back to them; only `pct` is weighted.
   */
  progressOf: function (spaceId) {
    return weightedProgress(Scope.phases(spaceId));
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
    return weightedProgress(Scope.projectPhases(projectId));
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
      progress: Scope.projectProgress(projectId).pct,
      planned: Scope.costOfProject(projectId)
    };
  },

  /** One space with everything a card needs, so the screen formats and nothing
   *  more. */
  card: function (space) {
    var phases = Scope.phases(space.id);
    return {
      rec: space,
      phases: phases,
      progress: Scope.progressOf(space.id),
      status: Scope.statusOf(space.id),
      planned: Scope.costOfSpace(space.id),
      unassigned: phases.filter(function (p) {
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

/**
 * PROGRESS, WEIGHTED BY WHAT EACH PHASE IS WORTH.
 *
 * Module-private, and used by both progressOf() and projectProgress() so a
 * space and its project can never be measured two different ways. A phase with
 * nothing planned against it weighs 1 — enough to count, not enough to distort
 * a job where the priced phases are what matter.
 */
function weightedProgress(phases) {
  var done = 0, weightDone = 0, weightAll = 0;
  phases.forEach(function (p) {
    var w = Scope.costOfPhase(p.id).cost || 1;
    weightAll += w;
    if (p.status === 'Complete') { done++; weightDone += w; }
  });
  return { done: done, total: phases.length,
           pct: weightAll ? Math.round(weightDone / weightAll * 100) : 0 };
}

/* Exposed READ-ONLY for the verification harness — MODULE-STANDARD §3: a test
 * that re-implements a rule proves nothing, because it passes even when the
 * shipped rule is wrong. Nothing else in this module goes on a global. */
(EPAL.diag = EPAL.diag || {}).woodartScope = Scope;
