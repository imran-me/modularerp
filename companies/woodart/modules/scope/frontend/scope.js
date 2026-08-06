/* ============================================================================
 * WOODART · SPACES & PHASES (scope) · LOGIC
 * ----------------------------------------------------------------------------
 * BEHAVIOUR ONLY. Every container, card, KPI tile, banner, badge and bar on this
 * screen is real HTML in frontend/template.html, handed to this file by
 * tools/build/build-module.mjs as the string TEMPLATE_HTML. This file is NOT an
 * IIFE and declares no 'use strict' of its own: the build wraps it.
 *
 * WHAT THIS FILE DOES, AND ONLY THIS:
 *   1. clones a screen / shell block out of the markup
 *   2. writes live values into its [data-k] and [data-fill] slots
 *   3. clones the [data-proto] card/row once per record (the count is data)
 *   4. removes the [data-when] blocks whose condition is false
 *   5. wires the [data-act] buttons, the tab band and the project picker
 *   6. opens the space form, the phase drawer and the confirm dialogs
 * It never builds a card, a head bar, a tab band or a KPI tile.
 *
 * WHERE THE DATA COMES FROM: frontend/api.js — the seam. This file never names
 * the store keys `wa_spaces` / `wa_phases` and never names a URL. Search it: you
 * will not find either. That is what makes the Laravel switch a one-file change.
 *
 * THE PROJECT IS IN THE URL. `#/woodart/scope/spaces?p=WAP-102` — the router
 * already parses `?` into ctx.params (platform/core/router.js), so a project
 * that has been broken down is a link somebody can send to site. Team Load is
 * deliberately company-wide, so the picker is removed on that tab.
 *
 * ==> LARAVEL MAPPING: the three tabs are reads of one endpoint group
 *     (GET /api/woodart/scope/spaces?project=…, /phases?project=…, /load); the
 *     space form and phase drawer are POSTs; the row delete is DELETE. Full
 *     contract in backend/endpoints.md.
 * ==========================================================================*/

var ui = EPAL.ui, el = ui.el;

var CID = 'woodart';
var ROUTE = 'woodart/scope';

/* ---- template plumbing ----------------------------------------------------
 * The markup IS the screen; these helpers are the whole bridge to it.
 * mountScreen moves the section's element children onto the page so the shipped
 * DOM carries no wrapper <section> and no stray whitespace text nodes. */
var TPL = document.createElement('div');
TPL.innerHTML = TEMPLATE_HTML;

function screen(name) { return TPL.querySelector('[data-screen="' + name + '"]').cloneNode(true); }
function shell(name) { return TPL.querySelector('[data-shell="' + name + '"]').cloneNode(true); }
function fill(root, k) { return root.querySelector('[data-fill="' + k + '"]'); }
function fillK(root, k, v) { var n = root.querySelector('[data-k="' + k + '"]'); if (n) n.textContent = String(v); }
function slot(root, k) { return root.querySelector('[data-slot="' + k + '"]'); }
function act(root, k) { return root.querySelector('[data-act="' + k + '"]'); }
function mountScreen(page, s) { Array.prototype.slice.call(s.children).forEach(function (c) { page.appendChild(c); }); }

/** Remove a [data-when] block, or keep it and strip the hook. One call per
 *  conditional block, so a screen's states are declared in HTML, not assembled. */
function when(root, name, keep) {
  var n = root.querySelector('[data-when="' + name + '"]');
  if (!n) return null;
  if (!keep) { n.parentNode.removeChild(n); return null; }
  n.removeAttribute('data-when');
  return n;
}

/** Clone a hidden [data-proto] element. The prototype stays in the markup and
 *  is removed once the real ones are in — the sanctioned replacement for
 *  <template> cloning (MODULE-STANDARD §2.1). */
function proto(host, name) {
  var p = host.querySelector('[data-proto="' + name + '"]');
  var n = p.cloneNode(true);
  n.removeAttribute('data-proto');
  n.removeAttribute('hidden');
  return n;
}
function dropProtos(host) {
  Array.prototype.forEach.call(host.querySelectorAll('[data-proto]'), function (p) { p.parentNode.removeChild(p); });
}

/** A span carrying `tw-` utilities. Built here rather than written as an el()
 *  selector because a class like `tw-text-[11px]` contains brackets, which the
 *  el() selector grammar does not parse — and a class name must never be
 *  composed at runtime (UI-CONTRACT §6). Whole literals only. */
function muted(text) {
  var n = document.createElement('span');
  n.className = 'tw-text-ink-mute tw-text-[11px]';
  n.textContent = text;
  return n;
}

/* ---- shared chrome -------------------------------------------------------- */

var TAB_COPY = {
  spaces:    ['Spaces', 'The rooms and areas this project is built in — Bed Room, Kitchen, Dining — each with its own phase list.'],
  phases:    ['Phase Board', 'Where every space stands: design, colour, wood work, furniture — and who is responsible for each.'],
  materials: ['Material Demand', 'What this project has to buy — every phase’s material needs, rolled up per item and set against stock.'],
  load:      ['Team Load', 'Who is carrying which phases, across every project — and what nobody has picked up yet.']
};

/** Navigate inside this module, carrying the project in the URL. */
function go(sub, projectId) {
  EPAL.router.navigate(ROUTE + (sub === 'spaces' ? '' : '/' + sub), projectId ? { p: projectId } : null);
}

/** The page-head bar, cloned from markup. Mirrors EPAL.pageHead exactly: the
 *  title is a TEXT NODE appended after the icon, and the sub carries title= so
 *  the pinned one-line head still reveals a long sentence on hover. */
function head(sub, projectId) {
  var copy = TAB_COPY[sub] || TAB_COPY.spaces;
  var h = shell('head');
  fill(h, 'eyebrow').textContent = sub === 'spaces' ? 'Woodart Interiors' : 'Woodart › Spaces & Phases';
  fill(h, 'title').appendChild(document.createTextNode(copy[0]));
  var s = fill(h, 'sub');
  s.textContent = copy[1];
  s.setAttribute('title', copy[1]);

  paintPicker(h, sub, projectId);
  paintAction(h, sub, projectId);
  return h;
}

/** The project picker. It is in the markup and is REMOVED where it has no
 *  meaning — the same grammar as a [data-when] block, never built on demand.
 *  Team Load spans every project, so a picker there would be a lie. */
function paintPicker(h, sub, projectId) {
  var sel = fill(h, 'project');
  var options = Scope.projectOptions();
  if (sub === 'load' || !options.length) { sel.parentNode.removeChild(sel); return; }

  options.forEach(function (o) {
    var op = el('option', { value: o[0], text: o[1] });
    if (o[0] === projectId) op.selected = true;
    sel.appendChild(op);
  });
  sel.addEventListener('change', function () { go(sub, sel.value); });
}

/** The primary action, which is different per tab and absent without the
 *  permission. Removed rather than disabled, for the same reason. */
function paintAction(h, sub, projectId) {
  var btn = act(h, 'new');
  var projects = Scope.projects();
  /* Material Demand has no "add" of its own — what it shows is the sum of what
   * the phases need, and the thing you actually do from it (raise the order)
   * belongs to Procurement. */
  if (!canCreate() || sub === 'load' || sub === 'materials' || !projects.length) {
    btn.parentNode.removeChild(btn); return;
  }

  if (sub === 'phases') {
    btn.innerHTML = '<i class="bi bi-plus-lg"></i> Add Phase';
    btn.addEventListener('click', function () { addPhaseSomewhere(projectId); });
  } else {
    btn.addEventListener('click', function () { editSpace(null, projectId); });
  }
}

/** The 3-tab band. Marks the active tab, wires navigation, then STRIPS the
 *  data-tab hooks so they never reach the shipped DOM. */
function tabs(sub, projectId) {
  var band = shell('tabs');
  Array.prototype.forEach.call(band.querySelectorAll('[data-tab]'), function (btn) {
    var key = btn.getAttribute('data-tab');
    if (key === sub) btn.classList.add('active');
    btn.removeAttribute('data-tab');
    btn.addEventListener('click', function () { go(key, projectId); });
  });
  return band;
}

/* ---- permissions ---------------------------------------------------------- */
function canCreate() { return !EPAL.perm || EPAL.perm.can(CID, 'scope', 'create'); }
function canDelete() { return !EPAL.perm || EPAL.perm.can(CID, 'scope', 'delete'); }

/* ---- the shared status vocabulary -----------------------------------------
 * One place, so the space card, the phase row, the board KPIs and the data grid
 * can never disagree about what a status looks like. */
var STATUS_TONE = { 'Not started': '', 'Active': 'accent', 'Complete': 'good' };
var STEP_CLASS  = { 'Not started': '', 'Active': 'is-active', 'Complete': 'is-complete' };

/** Money on a card or a row is COMPACT (৳4.2L): a space card is 245px wide and
 *  a full figure wraps. The data grid and the drawer footer use the full number,
 *  because that is where somebody checks it. */
function money(v) { return ui.money(v, { compact: true }); }

function badgeClass(status) {
  var tone = STATUS_TONE[status];
  return 'badge' + (tone ? ' badge-' + tone : '');
}

/** The date run a phase row shows, and whether it is late. */
function dateText(ph) {
  if (!ph.start && !ph.finish) return '';
  return (ph.start ? ui.date(ph.start) : '—') + ' → ' + (ph.finish ? ui.date(ph.finish) : '—');
}

/* ============================================================================
 * THE VIEW — one registration, three screens, chosen by ctx.subId.
 * ==========================================================================*/
EPAL.view(ROUTE, {
  title: function () { return 'Spaces & Phases'; },
  render: function (ctx) {
    var sub = ctx.subId || 'spaces';
    if (!TAB_COPY[sub]) sub = 'spaces';

    // A stale or deleted ?p= must fall back to a real project, never render an
    // empty screen that looks like lost data.
    var projectId = Scope.resolveProject((ctx.params || {}).p);

    var page = el('div.page');
    page.appendChild(head(sub, projectId));
    page.appendChild(tabs(sub, projectId));

    ({ spaces: spacesScreen, phases: phasesScreen,
       materials: materialsScreen, load: loadScreen }[sub])(page, projectId);

    ctx.mount.appendChild(page);
  }
});

/* =========================================================== SCREEN · SPACES */
function spacesScreen(page, projectId) {
  var s = screen('spaces');
  var hasProject = !!projectId;
  var sum = hasProject ? Scope.summary(projectId)
                       : { spaces: 0, phases: 0, complete: 0, unassigned: 0, area: 0, progress: 0 };

  fillK(s, 'spaces', ui.num(sum.spaces));
  fillK(s, 'phases', ui.num(sum.phases));
  fillK(s, 'complete', ui.num(sum.complete));
  fillK(s, 'completeFoot', sum.progress + '% of this project’s phases');
  fillK(s, 'unassigned', ui.num(sum.unassigned));
  fillK(s, 'area', sum.area ? ui.num(sum.area) + ' sft' : '—');

  var banner = when(s, 'unassigned', sum.unassigned > 0);
  if (banner) {
    fillK(banner, 'unassignedInline', ui.num(sum.unassigned));
    act(banner, 'goBoard').addEventListener('click', function () { go('phases', projectId); });
  }

  // Three states, all authored in HTML. Exactly one survives.
  when(s, 'noproject', !hasProject);
  var empty = when(s, 'empty', hasProject && sum.spaces === 0);
  var body = when(s, 'some', hasProject && sum.spaces > 0);

  if (empty) {
    var add = act(empty, 'addFirst');
    if (!canCreate()) add.parentNode.removeChild(add);
    else add.addEventListener('click', function () { editSpace(null, projectId); });
  }

  if (body) {
    var host = fill(body, 'spaces');
    Scope.spaces(projectId).forEach(function (space) { host.appendChild(spaceCard(host, space)); });
    dropProtos(host);
  }

  mountScreen(page, s);
}

/** One space card — the count of cards is data, so this is a proto clone. */
function spaceCard(host, space) {
  var c = Scope.card(space);
  var node = proto(host, 'space');

  slot(node, 'name').textContent = space.name;
  slot(node, 'meta').textContent = space.id +
    (space.area ? ' · ' + ui.num(space.area) + ' sft' : '') +
    ' · ' + c.phases.length + ' phase' + (c.phases.length === 1 ? '' : 's') +
    (c.planned.cost ? ' · ' + money(c.planned.cost) + ' planned' : '') +
    (c.unassigned ? ' · ' + c.unassigned + ' unassigned' : '');

  slot(node, 'kind').textContent = space.kind || 'Common';

  var st = slot(node, 'status');
  st.textContent = c.status;
  st.className = badgeClass(c.status);

  slot(node, 'pct').textContent = c.progress.pct + '%';
  // A computed width is a VALUE, not a utility — inline style is correct here.
  slot(node, 'bar').style.width = c.progress.pct + '%';

  var strip = slot(node, 'strip');
  c.phases.forEach(function (ph) { strip.appendChild(stripStep(strip, ph)); });
  dropProtos(strip);
  if (!c.phases.length) strip.appendChild(muted('No phases yet — apply a template from the phase board.'));

  act(node, 'board').addEventListener('click', function () { go('phases', space.project); });

  var edit = act(node, 'edit');
  if (!canCreate()) edit.parentNode.removeChild(edit);
  else edit.addEventListener('click', function () { editSpace(space, space.project); });

  var del = act(node, 'del');
  if (!canDelete()) del.parentNode.removeChild(del);
  else del.addEventListener('click', function () { deleteSpace(space); });

  return node;
}

/** One step of the phase strip: the sequence, in order, with its tone. */
function stripStep(strip, ph) {
  var step = proto(strip, 'step');
  var cls = ['wa-scope-step'];
  if (STEP_CLASS[ph.status]) cls.push(STEP_CLASS[ph.status]);
  if (Scope.isOverdue(ph)) cls.push('is-late');
  if (Scope.isUnassigned(ph) && Scope.isOpen(ph)) cls.push('is-unassigned');
  step.className = cls.join(' ');
  slot(step, 'label').textContent = ph.name;
  step.setAttribute('title', ph.name + ' · ' + ph.status +
    (ph.ownerId ? ' · ' + Scope.personName(ph.ownerId) : ' · unassigned'));
  return step;
}

/* =========================================================== SCREEN · BOARD */
function phasesScreen(page, projectId) {
  var s = screen('phases');
  var spaces = projectId ? Scope.spaces(projectId) : [];
  var sum = projectId ? Scope.summary(projectId)
                      : { notStarted: 0, active: 0, complete: 0, unassigned: 0, overdue: 0 };
  var orphans = projectId ? Scope.orphanPhases(projectId) : [];

  fillK(s, 'notStarted', ui.num(sum.notStarted));
  fillK(s, 'active', ui.num(sum.active));
  fillK(s, 'complete', ui.num(sum.complete));
  fillK(s, 'unassigned', ui.num(sum.unassigned));
  fillK(s, 'overdue', ui.num(sum.overdue));

  var late = when(s, 'overdue', sum.overdue > 0);
  if (late) fillK(late, 'overdueInline', ui.num(sum.overdue));

  var orph = when(s, 'orphan', orphans.length > 0);
  if (orph) {
    fillK(orph, 'orphanInline', ui.num(orphans.length));
    act(orph, 'showOrphans').addEventListener('click', function () { showOrphans(orphans); });
  }

  var empty = when(s, 'empty', spaces.length === 0);
  var body = when(s, 'some', spaces.length > 0);

  if (empty) {
    var add = act(empty, 'addFirst');
    if (!canCreate() || !projectId) add.parentNode.removeChild(add);
    else add.addEventListener('click', function () { editSpace(null, projectId); });
  }

  if (body) {
    spaces.forEach(function (space) { body.appendChild(spaceBlock(body, space)); });
    dropProtos(body);
  }

  mountScreen(page, s);
}

/** One space's block on the board: its phases, in running order. */
function spaceBlock(host, space) {
  var block = proto(host, 'spaceBlock');
  var phases = Scope.phases(space.id);
  var prog = Scope.progressOf(space.id);

  slot(block, 'name').textContent = space.name;
  slot(block, 'meta').textContent = (space.kind || 'Common') +
    (space.area ? ' · ' + ui.num(space.area) + ' sft' : '') +
    ' · ' + prog.done + ' of ' + prog.total + ' phases complete (' + prog.pct + '%)';

  var list = slot(block, 'phases');
  phases.forEach(function (ph, i) { list.appendChild(phaseRow(list, ph, space, i + 1)); });
  dropProtos(list);
  if (!phases.length) {
    var row = el('div.data-row');
    row.appendChild(muted('No phases yet. "Apply template" creates the standard ' +
      (space.kind || 'Common').toLowerCase() + ' phase list; "Add phase" adds one by hand.'));
    list.appendChild(row);
  }

  var addBtn = act(block, 'addPhase');
  var tplBtn = act(block, 'template');
  if (!canCreate()) {
    addBtn.parentNode.removeChild(addBtn);
    tplBtn.parentNode.removeChild(tplBtn);
  } else {
    addBtn.addEventListener('click', function () { editPhase(null, space); });
    tplBtn.addEventListener('click', function () { applyTemplateTo(space); });
  }

  return block;
}

/** One phase row. The row opens the drawer; the trash button does not. */
function phaseRow(list, ph, space, seq) {
  var row = proto(list, 'phase');

  var planned = Scope.costOfPhase(ph.id);
  slot(row, 'seq').textContent = String(seq);
  slot(row, 'name').textContent = ph.name;
  slot(row, 'code').textContent = (ph.code ? Scope.codeLabel(ph.code) : 'No cost code') +
    (planned.lines ? ' · ' + planned.lines + ' line' + (planned.lines === 1 ? '' : 's') +
                     ' · ' + money(planned.cost) + ' planned'
                   : ' · nothing planned yet');

  var owner = slot(row, 'owner');
  if (ph.ownerId) {
    owner.textContent = Scope.personName(ph.ownerId);
    owner.className = 'badge badge-info';
  } else {
    owner.textContent = 'Unassigned';
    owner.className = 'badge' + (Scope.isOpen(ph) ? ' badge-warn' : '');
  }

  var st = slot(row, 'status');
  st.textContent = ph.status;
  st.className = badgeClass(ph.status);

  var dates = slot(row, 'dates');
  dates.textContent = dateText(ph) || 'No dates set';
  if (Scope.isOverdue(ph)) {
    dates.textContent = dateText(ph) + ' · overdue';
    dates.className = 'text-bad tw-text-[11px] tw-text-right tw-min-w-[180px]';
  }

  row.addEventListener('click', function () { editPhase(ph, space); });

  var del = slot(row, 'del');
  if (!canDelete()) {
    del.parentNode.removeChild(del);
  } else {
    del.addEventListener('click', function (e) {
      e.stopPropagation();          // the row opens the drawer; this must not
      deletePhase(ph, space);
    });
  }

  return row;
}

/* ========================================================== SCREEN · DEMAND */
function materialsScreen(page, projectId) {
  var s = screen('materials');
  var rows = projectId ? Scope.demand(projectId) : [];
  var sum = projectId ? Scope.demandSummary(projectId)
                      : { items: 0, lines: 0, cost: 0, shortItems: 0, shortCost: 0,
                          unlisted: 0, workCost: 0, workLines: 0 };

  fillK(s, 'items', ui.num(sum.items));
  fillK(s, 'itemsFoot', sum.lines + ' line' + (sum.lines === 1 ? '' : 's') + ' · ' +
    sum.openItems + ' still to come');
  fillK(s, 'cost', money(sum.cost));
  fillK(s, 'short', ui.num(sum.shortItems));
  fillK(s, 'shortCost', money(sum.shortCost));
  fillK(s, 'work', money(sum.workCost));
  fillK(s, 'workFoot', sum.workLines + ' line' + (sum.workLines === 1 ? '' : 's') + ' hired, not bought');

  var short = when(s, 'short', sum.shortItems > 0);
  if (short) fillK(short, 'shortInline', ui.num(sum.shortItems));

  var unlisted = when(s, 'unlisted', sum.unlisted > 0);
  if (unlisted) fillK(unlisted, 'unlistedInline', ui.num(sum.unlisted));

  var empty = when(s, 'empty', rows.length === 0 && sum.workLines === 0);
  var body = when(s, 'some', rows.length > 0 || sum.workLines > 0);

  if (empty) {
    act(empty, 'goBoard').addEventListener('click', function () { go('phases', projectId); });
  }

  if (body) {
    fill(body, 'register').appendChild(demandTable(rows));
    paintWorkLines(fill(body, 'work'), projectId);
  }

  mountScreen(page, s);
}

/** The demand grid. Stock and shortfall are the two columns anybody came for. */
function demandTable(rows) {
  return EPAL.table({
    columns: [
      { key: 'item', label: 'Material',
        render: function (r) {
          return '<span class="strong">' + ui.escapeHtml(r.item) + '</span>' +
            (r.listed ? '' : ' <span class="badge badge-warn">unlisted</span>');
        } },
      { key: 'code', label: 'Head', render: function (r) { return r.code ? '<span class="badge">' + ui.escapeHtml(Scope.codeLabel(r.code)) + '</span>' : '—'; } },
      { key: 'qty', label: 'Needed', num: true,
        render: function (r) {
          /* the whole scope on top, what is left to come underneath — a phase
             that is already built has consumed its share and is not demand */
          var sub = !r.outstanding ? 'all received'
                  : r.committed ? ui.num(r.outstanding) + ' still to come'
                  : 'none ordered yet';
          return '<span class="num strong">' + ui.num(r.qty) + '</span> <span class="tw-text-ink-mute tw-text-[11px]">' +
            ui.escapeHtml(r.unit || '') + '</span>' +
            '<div class="tw-text-ink-mute tw-text-[11px]">' + sub + '</div>';
        } },
      { key: 'stock', label: 'In Stock', num: true,
        render: function (r) {
          if (r.stock === null) return '<span class="tw-text-ink-mute">not stocked</span>';
          return '<span class="num">' + ui.num(r.stock) + '</span>';
        } },
      { key: 'short', label: 'To Buy', num: true,
        render: function (r) {
          if (!r.outstanding) return '<span class="text-good">done</span>';
          if (!r.short) return '<span class="text-good">covered</span>';
          return '<span class="num strong text-bad">' + ui.num(r.short) + '</span>';
        } },
      { key: 'shortCost', label: 'Cost to Buy', num: true, money: true },
      { key: 'cost', label: 'Planned Cost', num: true, money: true },
      { key: 'spaceCount', label: 'Rooms', num: true,
        render: function (r) { return ui.num(r.spaceCount) + ' <span class="tw-text-ink-mute tw-text-[11px]">' + r.phases + ' phases</span>'; } }
    ],
    rows: rows,
    searchKeys: ['item', 'code', 'unit'],
    exportName: 'woodart-material-demand.csv',
    pageSize: 14,
    empty: { icon: 'boxes', title: 'No material planned', hint: 'Add material lines to a phase and they roll up here.' }
  }).el;
}

/** Labour and contracted work, grouped by what it is — the money that is hired
 *  rather than bought, and which the quotation has to carry too. */
function paintWorkLines(host, projectId) {
  var bag = {};
  Scope.projectRequirements(projectId).forEach(function (r) {
    if (r.kind === 'material') return;
    var key = r.kind + '::' + r.item;
    if (!bag[key]) bag[key] = { kind: r.kind, item: r.item, cost: 0, quote: 0, phases: 0, spaces: {} };
    bag[key].cost += Scope.amount(r);
    bag[key].quote += Scope.quote(r);
    bag[key].phases += 1;
    bag[key].spaces[r.space] = 1;
  });

  var rows = Object.keys(bag).map(function (k) { return bag[k]; })
    .sort(function (a, b) { return b.cost - a.cost; });

  rows.forEach(function (r) {
    var row = proto(host, 'work');
    var kind = slot(row, 'kind');
    kind.textContent = r.kind;
    kind.className = 'badge' + (r.kind === 'labour' ? ' badge-info' : '');
    slot(row, 'item').textContent = r.item;
    slot(row, 'where').textContent = r.phases + ' phase' + (r.phases === 1 ? '' : 's') +
      ' · ' + Object.keys(r.spaces).length + ' room' + (Object.keys(r.spaces).length === 1 ? '' : 's');
    slot(row, 'amount').textContent = ui.money(r.cost);
    slot(row, 'quote').textContent = 'quoted ' + ui.money(r.quote);
    host.appendChild(row);
  });
  dropProtos(host);
  if (!rows.length) host.appendChild(muted('No labour or contracted work planned yet.'));
}

/* ============================================================ SCREEN · LOAD */
function loadScreen(page) {
  var s = screen('load');
  var rows = Scope.load();
  var all = Scope.allPhases();
  var open = all.filter(Scope.isOpen);
  var unassigned = Scope.unassignedPhases();
  var overdue = open.filter(Scope.isOverdue);

  fillK(s, 'people', ui.num(rows.length));
  fillK(s, 'open', ui.num(open.length));
  fillK(s, 'unassigned', ui.num(unassigned.length));
  fillK(s, 'overdue', ui.num(overdue.length));

  var banner = when(s, 'unassigned', unassigned.length > 0);
  if (banner) fillK(banner, 'unassignedInline', ui.num(unassigned.length));

  // one cloned row per person — the count is data
  var host = fill(s, 'people');
  var max = rows.reduce(function (t, r) { return Math.max(t, r.open); }, 0);
  rows.forEach(function (r) {
    var row = proto(host, 'person');
    slot(row, 'name').textContent = r.name + (r.designation ? ' · ' + r.designation : '');
    slot(row, 'open').textContent = ui.num(r.open);
    slot(row, 'detail').textContent = r.open
      ? r.active + ' active · ' + r.spaces + ' space' + (r.spaces === 1 ? '' : 's') +
        ' · ' + r.projects + ' project' + (r.projects === 1 ? '' : 's') +
        (r.overdue ? ' · ' + r.overdue + ' overdue' : '')
      : 'nothing open';
    slot(row, 'bar').style.width = (max ? Math.round(r.open / max * 100) : 0) + '%';
    host.appendChild(row);
  });
  dropProtos(host);

  fill(s, 'register').appendChild(openPhaseTable(open));

  var canvas = fill(s, 'chart');
  mountScreen(page, s);

  // Charts own their own pixels — drawn after the canvas is in the document.
  requestAnimationFrame(function () {
    var mix = Scope.statuses().map(function (st) {
      return [st, all.filter(function (p) { return p.status === st; }).length];
    }).filter(function (r) { return r[1] > 0; });
    if (!EPAL.charts || !mix.length || !canvas.isConnected) return;
    EPAL.charts.doughnut(canvas, {
      labels: mix.map(function (r) { return r[0]; }),
      data: mix.map(function (r) { return r[1]; })
    });
  });
}

/** Every open phase in the company. A data grid is one of the five places JS is
 *  allowed to make DOM — its row count is data, not layout. */
function openPhaseTable(open) {
  var rows = open.map(function (p) {
    return {
      id: p.id, name: p.name, status: p.status,
      space: Scope.spaceName(p.space),
      project: Scope.projectName(p.project),
      owner: p.ownerId ? Scope.personName(p.ownerId) : 'Unassigned',
      code: p.code ? Scope.codeLabel(p.code) : '',
      finish: p.finish || '',
      overdue: Scope.isOverdue(p)
    };
  });

  return EPAL.table({
    columns: [
      { key: 'id', label: 'Phase', render: function (r) { return '<span class="strong">' + ui.escapeHtml(r.id) + '</span>'; } },
      { key: 'name', label: 'Stage' },
      { key: 'space', label: 'Space' },
      { key: 'project', label: 'Project' },
      { key: 'owner', label: 'Responsible',
        render: function (r) {
          return r.owner === 'Unassigned'
            ? '<span class="badge badge-warn">Unassigned</span>'
            : ui.escapeHtml(r.owner);
        } },
      { key: 'status', label: 'Status', badge: STATUS_TONE },
      { key: 'finish', label: 'Finish By', date: true,
        render: function (r) {
          if (!r.finish) return '<span class="tw-text-ink-mute">—</span>';
          return '<span class="' + (r.overdue ? 'text-bad' : '') + '">' + ui.date(r.finish) +
            (r.overdue ? ' · overdue' : '') + '</span>';
        } }
    ],
    rows: rows,
    searchKeys: ['id', 'name', 'space', 'project', 'owner', 'code'],
    filters: [{ key: 'status', label: 'Status' }, { key: 'owner', label: 'Responsible' }],
    onRow: function (r) {
      var ph = Scope.phase(r.id);
      if (ph) editPhase(ph, Scope.space(ph.space));
    },
    exportName: 'woodart-open-phases.csv',
    pageSize: 12,
    empty: { icon: 'check2-circle', title: 'Nothing open', hint: 'Every phase in every project is complete.' }
  }).el;
}

/* ============================================================== SPACE FORM = */
/** The add/edit form is a config-driven platform form (EPAL.formModal), which is
 *  the sanctioned way to build a form — the field schema is the spec the Laravel
 *  FormRequest mirrors one-for-one (see backend/endpoints.md). */
function editSpace(rec, projectId) {
  var isNew = !rec;
  if (isNew && !canCreate()) { ui.toast('You do not have permission to add spaces', 'error'); return; }

  var project = rec ? rec.project : projectId;
  if (!project) { ui.toast('Pick a project first', 'error'); return; }

  var existing = Scope.spaces(project);

  EPAL.formModal({
    title: isNew ? 'Add Space · ' + Scope.projectName(project) : 'Edit · ' + rec.name,
    icon: 'door-open',
    size: 'md',
    record: rec || { id: Scope.nextSpaceId(), kind: 'Bedroom', area: 0,
      sort: existing.length + 1, applyTemplate: true },
    fields: [
      { key: 'id', label: 'Code', type: 'text', required: true, readonly: !isNew, col2: true,
        hint: isNew ? 'Auto-numbered in the SPC-000 series.' : 'The code is the record key and cannot change.' },
      { key: 'sort', label: 'Order', type: 'number', min: 1, col2: true,
        hint: 'Where this space sits in the list.' },
      { key: 'name', label: 'Space', type: 'text', required: true,
        placeholder: 'e.g. Master Bed Room' },
      { key: 'kind', label: 'Kind', type: 'select', required: true, col2: true, options: Scope.kinds(),
        hint: isNew ? 'Chooses which phase list is created below.' : 'Used by the phase template.' },
      { key: 'area', label: 'Area (sft)', type: 'number', min: 0, col2: true },
      { key: 'applyTemplate', label: 'Create its phases from the template', type: 'checkbox',
        showIf: function () { return isNew; },
        hint: 'Design → services → wood work → colour → furniture → handover, for this kind of space. ' +
              'Every phase can be renamed, reordered or removed afterwards.' },
      { key: 'note', label: 'Note', type: 'textarea', rows: 2 }
    ],
    saveLabel: isNew ? 'Add Space' : 'Save Changes',
    onSave: function (v) {
      var row = rec || { created: Scope.today() };
      row.id = isNew ? (v.id || Scope.nextSpaceId()) : rec.id;
      row.companyId = CID;
      row.project = project;
      row.name = String(v.name || '').trim();
      row.kind = v.kind || 'Common';
      row.area = +v.area || 0;
      row.sort = +v.sort || existing.length + 1;
      row.note = v.note || '';
      Scope.saveSpace(row);

      var made = (isNew && v.applyTemplate) ? Scope.applyTemplate(row).length : 0;
      ui.toast(isNew
        ? row.name + ' added' + (made ? ' with ' + made + ' phases' : '')
        : row.name + ' updated', 'success');
      EPAL.router.render();
      return true;
    }
  });
}

/** Delete always asks first, and always names what goes with it — a space
 *  carries its phases, and there is no undo. */
function deleteSpace(space) {
  var phases = Scope.phases(space.id);
  ui.confirm({
    title: 'Delete ' + space.name + '?',
    body: space.id + ' and its ' + phases.length + ' phase(s) will be removed from ' +
      Scope.projectName(space.project) + '. A phase whose space no longer exists is ' +
      'orphaned work — it would still count in every roll-up while being impossible ' +
      'to open. This cannot be undone.',
    confirmLabel: 'Delete'
  }).then(function (ok) {
    if (!ok) return;
    Scope.removeSpace(space.id);
    ui.toast(space.name + ' deleted', 'success');
    EPAL.router.render();
  });
}

/* ============================================================== PHASE DRAWER */
/** Assign the person, set the status, set the dates. This is the screen the
 *  owner asked for in one sentence: "each phase will have option to assign a
 *  specific person who is responsible for that phase". */
function editPhase(rec, space) {
  var isNew = !rec;
  if (isNew && !canCreate()) { ui.toast('You do not have permission to add phases', 'error'); return; }
  if (!space) { ui.toast('That phase points at a space that no longer exists', 'error'); return; }

  var existing = Scope.phases(space.id);
  var people = Scope.personOptions();
  var codes = Scope.codeOptions();

  /* The phase's requirement lines, in the shape the repeater understands. The
   * editor is the whole set for this phase: what comes back replaces what was
   * there (Scope.saveRequirements), which is why the rows are loaded here. */
  var reqRows = (rec ? Scope.requirements(rec.id) : []).map(function (r) {
    return { kind: r.kind, item: r.item, qty: r.qty, unit: r.unit,
             unitCost: r.unitCost, unitSale: r.unitSale };
  });

  EPAL.formModal({
    title: isNew ? 'Add Phase · ' + space.name : rec.name + ' · ' + space.name,
    icon: 'diagram-3',
    size: 'xl',
    record: rec ? Object.assign({}, rec, { requirements: reqRows })
                : { id: Scope.nextPhaseId(), status: 'Not started', ownerId: '',
                    sort: existing.length + 1, code: '', requirements: [] },
    fields: [
      { key: 'id', label: 'Code', type: 'text', required: true, readonly: !isNew, col2: true },
      { key: 'sort', label: 'Order', type: 'number', min: 1, col2: true,
        hint: 'Phases run in this order.' },
      { key: 'name', label: 'Phase', type: 'text', required: true,
        placeholder: 'e.g. Wood Work' },
      { key: 'ownerId', label: 'Responsible', type: 'select', col2: true, searchable: true,
        options: [['', '— Unassigned —']].concat(people),
        hint: 'Epal staff. The person, not the team — one name is who you call.' },
      { key: 'status', label: 'Status', type: 'select', required: true, col2: true,
        options: Scope.statuses() },
      { key: 'code', label: 'Cost code', type: 'select', col2: true, searchable: true,
        options: [['', '— none —']].concat(codes),
        hint: 'The shared head this phase’s materials and labour are budgeted under.' },
      { key: 'start', label: 'Start', type: 'date', col2: true },
      { key: 'finish', label: 'Finish by', type: 'date', col2: true },
      { key: 'note', label: 'Note', type: 'textarea', rows: 2 },

      /* WHAT THIS PHASE NEEDS — the owner's second sentence, in the same drawer
       * as the person responsible, because they are decided together. One line
       * table, three kinds: what you buy, who you hire, what you contract out.
       * The repeater is the platform's line-item kit, the same one the estimate
       * form uses — a form is never hand-rolled here. */
      { key: 'requirements', type: 'items', label: 'What this phase needs', addLabel: 'Add a line', min: 0,
        columns: [
          { key: 'kind', label: 'Kind', type: 'select', options: Scope.reqKinds(), width: '110px' },
          { key: 'item', label: 'Item / work', type: 'text', width: '2fr' },
          { key: 'qty', label: 'Qty', type: 'number', width: '80px' },
          { key: 'unit', label: 'Unit', type: 'text', width: '90px' },
          { key: 'unitCost', label: 'Unit cost', type: 'money' },
          { key: 'unitSale', label: 'Quote', type: 'money' }
        ],
        footer: requirementsFooter }
    ],
    saveLabel: isNew ? 'Add Phase' : 'Save Changes',
    onSave: function (v) {
      var row = rec || {};
      row.id = isNew ? (v.id || Scope.nextPhaseId()) : rec.id;
      row.companyId = CID;
      row.project = space.project;
      row.space = space.id;
      row.name = String(v.name || '').trim();
      row.code = v.code || '';
      row.ownerId = v.ownerId || '';
      row.status = v.status || 'Not started';
      row.sort = +v.sort || existing.length + 1;
      row.start = v.start || null;
      row.finish = v.finish || null;
      row.note = v.note || '';
      Scope.savePhase(row);

      /* The phase must exist before its lines can point at it — hence after. */
      var lines = Scope.saveRequirements(row, v.requirements);
      var planned = Scope.totals(lines);

      ui.toast(row.name + ' · ' + space.name + ' — ' + row.status.toLowerCase() +
        (row.ownerId ? ' · ' + Scope.personName(row.ownerId) : ' · unassigned') +
        (planned.lines ? ' · ' + planned.lines + ' line(s), ' + ui.money(planned.cost) : ''), 'success');
      EPAL.router.render();
      return true;
    }
  });
}

/** The running total under the requirement lines. Cost is what the job costs
 *  us, quote is what the client is charged — the margin between them is the
 *  number this whole hierarchy exists to protect. */
function requirementsFooter(rows) {
  var t = Scope.totals((rows || []).map(function (r) {
    return { qty: r.qty, unitCost: r.unitCost, unitSale: r.unitSale };
  }));
  return 'Cost: <strong>' + ui.money(t.cost) + '</strong> · Quote: <strong>' + ui.money(t.quote) +
    '</strong> · Margin: <strong class="' + (t.margin >= 0 ? 'text-good' : 'text-bad') + '">' +
    ui.money(t.margin) + '</strong>';
}

function deletePhase(ph, space) {
  ui.confirm({
    title: 'Delete ' + ph.name + '?',
    body: 'This phase of ' + space.name + ' will be removed. Anything planned against ' +
      'it goes with it. This cannot be undone.',
    confirmLabel: 'Delete'
  }).then(function (ok) {
    if (!ok) return;
    Scope.removePhase(ph.id);
    ui.toast(ph.name + ' deleted', 'success');
    EPAL.router.render();
  });
}

/** Add a phase without starting from a space — the head bar's action on the
 *  board, where the space is the thing you pick first. */
function addPhaseSomewhere(projectId) {
  var spaces = Scope.spaces(projectId);
  if (!spaces.length) { editSpace(null, projectId); return; }
  if (spaces.length === 1) { editPhase(null, spaces[0]); return; }

  EPAL.formModal({
    title: 'Add Phase · which space?',
    icon: 'diagram-3',
    size: 'sm',
    record: { space: spaces[0].id },
    fields: [
      { key: 'space', label: 'Space', type: 'select', required: true,
        options: spaces.map(function (s) { return [s.id, s.name + ' · ' + (s.kind || 'Common')]; }) }
    ],
    saveLabel: 'Continue',
    onSave: function (v) {
      var space = Scope.space(v.space);
      if (space) setTimeout(function () { editPhase(null, space); }, 0);
      return true;
    }
  });
}

/** Apply the kind's template to a space that already exists. Only the MISSING
 *  phases are added, so pressing it twice cannot wipe assigned work. */
function applyTemplateTo(space) {
  var made = Scope.applyTemplate(space);
  if (!made.length) {
    ui.toast(space.name + ' already has every phase in the ' + (space.kind || 'Common') + ' template', 'info');
    return;
  }
  ui.toast(made.length + ' phase(s) added to ' + space.name, 'success');
  EPAL.router.render();
}

/** The orphan list. Only ever opened from the orphan banner, which in healthy
 *  data is not on the page at all. */
function showOrphans(rows) {
  var body = el('div');
  body.appendChild(el('p.text-muted', { text:
    'These phases point at a space that is no longer in the project. They are kept and ' +
    'counted rather than hidden, because a roll-up that quietly drops rows is worse than ' +
    'one that shows something odd. Delete them, or recreate the space they belong to.' }));

  var list = el('div.data-list');
  rows.forEach(function (p) {
    var row = el('div.data-row');
    var left = el('div.tw-flex-1');
    left.appendChild(el('div.tw-font-semibold', { text: p.name }));
    left.appendChild(muted(p.id + ' · space ' + (p.space || '—') + ' · ' + p.status));
    row.appendChild(left);
    if (canDelete()) {
      row.appendChild(el('button.btn.btn-sm.btn-ghost', {
        html: ui.icon('trash') + ' Delete',
        onclick: function () { Scope.removePhase(p.id); ui.toast(p.id + ' deleted', 'success'); EPAL.router.render(); }
      }));
    }
    list.appendChild(row);
  });
  body.appendChild(list);

  ui.modal({ title: 'Phases with no space', icon: 'exclamation-octagon', size: 'md', body: body, footer: false });
}
