/* ============================================================================
 * WOODART · SITE & INSTALL (installation) · LOGIC
 * ----------------------------------------------------------------------------
 * BEHAVIOUR ONLY. Every container, card, KPI tile, banner and bar is real HTML
 * in frontend/template.html, handed to this file by tools/build/build-module.mjs
 * as TEMPLATE_HTML. This file is NOT an IIFE and declares no 'use strict' of its
 * own — the build wraps it.
 *
 * WHERE THE DATA COMES FROM: frontend/api.js — the seam. This file never names
 * `wa_installs` and never names a URL. Grep it: neither is here.
 *
 * ==> LARAVEL MAPPING: schedule = GET|POST /api/woodart/installation/installs,
 *     teams = GET .../teams. Full contract in backend/endpoints.md.
 * ==========================================================================*/

var ui = EPAL.ui, el = ui.el;

var CID = 'woodart';
var ROUTE = 'woodart/installation';

/* ---- template plumbing — the whole bridge to the markup ------------------ */
var TPL = document.createElement('div');
TPL.innerHTML = TEMPLATE_HTML;

function screen(name) { return TPL.querySelector('[data-screen="' + name + '"]').cloneNode(true); }
function shell(name) { return TPL.querySelector('[data-shell="' + name + '"]').cloneNode(true); }
function fill(root, k) { return root.querySelector('[data-fill="' + k + '"]'); }
function fillK(root, k, v) { var n = root.querySelector('[data-k="' + k + '"]'); if (n) n.textContent = String(v); }
function slot(root, k) { return root.querySelector('[data-slot="' + k + '"]'); }
function mountScreen(page, s) { Array.prototype.slice.call(s.children).forEach(function (c) { page.appendChild(c); }); }

function when(root, name, keep) {
  var n = root.querySelector('[data-when="' + name + '"]');
  if (!n) return null;
  if (!keep) { n.parentNode.removeChild(n); return null; }
  n.removeAttribute('data-when');
  return n;
}

function proto(root, name) {
  var n = root.querySelector('[data-proto="' + name + '"]').cloneNode(true);
  n.removeAttribute('data-proto');
  n.removeAttribute('hidden');
  return n;
}
function dropProtos(root) {
  Array.prototype.forEach.call(root.querySelectorAll('[data-proto]'), function (p) { p.parentNode.removeChild(p); });
}

/* ---- shared chrome ------------------------------------------------------- */

var TAB_COPY = {
  schedule: ['Schedule', 'Every site visit — team, date, status and open snags.'],
  snags:    ['Snag List', 'What is stopping handover, worst site first.'],
  teams:    ['Teams', 'Who is where, and which crew is carrying the snags.']
};

function head(sub) {
  var copy = TAB_COPY[sub] || TAB_COPY.schedule;
  var h = shell('head');
  fill(h, 'eyebrow').textContent = 'Woodart › Site & Install';
  fill(h, 'title').appendChild(document.createTextNode(copy[0]));
  var s = fill(h, 'sub');
  s.textContent = copy[1];
  s.setAttribute('title', copy[1]);
  var add = h.querySelector('[data-act="new"]');
  if (!canCreate()) add.parentNode.removeChild(add);
  else add.addEventListener('click', function () { editInstall(null); });
  return h;
}

function tabs(sub) {
  var band = shell('tabs');
  Array.prototype.forEach.call(band.querySelectorAll('[data-tab]'), function (btn) {
    var key = btn.getAttribute('data-tab');
    if (key === sub) btn.classList.add('active');
    btn.removeAttribute('data-tab');
    btn.addEventListener('click', function () {
      EPAL.router.navigate(ROUTE + (key === 'schedule' ? '' : '/' + key));
    });
  });
  return band;
}

/* ---- permissions + formatters -------------------------------------------- */
function canCreate() { return !EPAL.perm || EPAL.perm.can(CID, 'installation', 'create'); }
function canDelete() { return !EPAL.perm || EPAL.perm.can(CID, 'installation', 'delete'); }

var STATUS_TONE = { Handover: 'good', 'In Progress': '', Scheduled: 'warn', Snagging: 'bad' };

/** Visit-date label + tone, shared by every screen so the same site never reads
 *  "3d left" in one place and "overdue" in another. */
function dateLabel(i) {
  var d = Installs.daysLeft(i);
  if (isNaN(d)) return { text: '—', tone: '' };
  if (!Installs.isOpen(i)) return { text: ui.date(i.date), tone: '' };
  if (d < 0) return { text: Math.abs(d) + 'd overdue', tone: 'text-bad' };
  if (d <= 7) return { text: d + 'd away', tone: 'text-warn' };
  return { text: d + 'd away', tone: '' };
}

function snagCell(r) {
  var open = Installs.openSnags(r);
  if (!open) return '<span class="text-mute">—</span>';
  return '<span class="num text-bad">' + ui.num(open) + '</span>';
}

function projectCell(r) {
  // An orphan install (project deleted) shows the raw id and is FLAGGED.
  var p = Installs.projectOf(r);
  if (p) return '<span class="strong">' + ui.escapeHtml(r.project) + '</span> <span class="text-mute xs">' + ui.escapeHtml(p.name || '') + '</span>';
  return ui.escapeHtml(r.project || '—') + ' <span class="badge badge-warn">orphan</span>';
}

/* ============================================================================
 * THE VIEW — one registration, three screens, chosen by ctx.subId.
 * ==========================================================================*/
EPAL.view(ROUTE, {
  title: function () { return 'Site & Install'; },
  render: function (ctx) {
    var sub = ctx.subId || 'schedule';
    if (!TAB_COPY[sub]) sub = 'schedule';

    var page = el('div.page');
    page.appendChild(head(sub));
    page.appendChild(tabs(sub));

    ({ schedule: scheduleScreen, snags: snagsScreen, teams: teamsScreen }[sub])(page);

    ctx.mount.appendChild(page);
  }
});

/* ========================================================= SCREEN · SCHEDULE */
function scheduleScreen(page) {
  var s = screen('schedule');
  var sum = Installs.summary();

  fillK(s, 'installs', ui.num(sum.installs));
  fillK(s, 'active', ui.num(sum.active));
  fillK(s, 'snags', ui.num(sum.snags));
  fillK(s, 'handover', ui.num(sum.handover));
  fillK(s, 'teams', ui.num(sum.teams));

  var banner = when(s, 'attention', sum.attention > 0);
  if (banner) {
    fillK(banner, 'attentionInline', ui.num(sum.attention));
    banner.querySelector('[data-act="goSnags"]')
      .addEventListener('click', function () { EPAL.router.navigate(ROUTE + '/snags'); });
  }

  fill(s, 'register').appendChild(EPAL.table({
    columns: [
      { key: 'id', label: 'Install', render: function (r) { return '<span class="strong">' + ui.escapeHtml(r.id) + '</span>'; } },
      { key: 'site', label: 'Site' },
      { key: 'project', label: 'Project', render: projectCell },
      { key: 'team', label: 'Team', render: function (r) { return '<span class="badge">' + ui.escapeHtml(r.team || '—') + '</span>'; } },
      { key: 'date', label: 'Visit', date: true },
      { key: 'countdown', label: 'Countdown',
        sortVal: function (r) { var d = Installs.daysLeft(r); return isNaN(d) ? 99999 : d; },
        render: function (r) {
          var d = dateLabel(r);
          return '<span class="' + (d.tone || 'text-mute') + '">' + ui.escapeHtml(d.text) + '</span>';
        } },
      { key: 'status', label: 'Status', badge: STATUS_TONE },
      { key: 'snags', label: 'Open Snags', num: true,
        sortVal: function (r) { return Installs.openSnags(r); }, render: snagCell }
    ],
    rows: Installs.schedule(),
    searchKeys: ['id', 'site', 'project', 'team', 'status'],
    filters: [{ key: 'status', label: 'Status' }, { key: 'team', label: 'Team' }],
    onRow: function (r) { editInstall(Installs.find(r.id)); },
    actions: canDelete() ? [{ icon: 'trash', title: 'Delete install', onClick: deleteInstall }] : null,
    exportName: 'woodart-installs.csv',
    pageSize: 12,
    empty: { icon: 'truck', title: 'No installs scheduled', hint: 'Schedule the first site visit.' }
  }).el);

  mountScreen(page, s);
}

/* ============================================================ SCREEN · SNAGS */
function snagsScreen(page) {
  var s = screen('snags');
  var sum = Installs.summary();
  var snagging = Installs.snagging();

  fillK(s, 'snags', ui.num(sum.snags));
  fillK(s, 'sites', ui.num(sum.sites));
  fillK(s, 'worst', sum.worst);
  fillK(s, 'clean', ui.num(sum.clean));

  when(s, 'clear', snagging.length === 0);
  var body = when(s, 'some', snagging.length > 0);

  if (body) {
    var rows = snagging.map(function (r) {
      return { id: r.rec.id, site: r.rec.site, project: r.rec.project, team: r.rec.team,
        date: r.rec.date, status: r.rec.status, open: r.open };
    });
    fill(body, 'register').appendChild(EPAL.table({
      columns: [
        { key: 'id', label: 'Install', render: function (r) { return '<span class="strong">' + ui.escapeHtml(r.id) + '</span>'; } },
        { key: 'site', label: 'Site' },
        { key: 'project', label: 'Project', render: projectCell },
        { key: 'team', label: 'Team', render: function (r) { return '<span class="badge">' + ui.escapeHtml(r.team || '—') + '</span>'; } },
        { key: 'date', label: 'Visit', date: true },
        { key: 'status', label: 'Status', badge: STATUS_TONE },
        { key: 'open', label: 'Open Snags', num: true,
          render: function (r) { return '<span class="num strong text-bad">' + ui.num(r.open) + '</span>'; } }
      ],
      rows: rows,
      searchKeys: ['id', 'site', 'team'],
      onRow: function (r) { editInstall(Installs.find(r.id)); },
      exportName: 'woodart-snags.csv',
      pageSize: 12,
      empty: { icon: 'check2-circle', title: 'No open snags', hint: 'Every site is clean.' }
    }).el);
  }

  mountScreen(page, s);
}

/* ============================================================ SCREEN · TEAMS */
function teamsScreen(page) {
  var s = screen('teams');
  var sum = Installs.summary();
  var load = Installs.byTeam();

  fillK(s, 'teams', ui.num(sum.allTeams));
  fillK(s, 'top', sum.top);
  fillK(s, 'open', ui.num(sum.open));
  fillK(s, 'rate', sum.rate + '%');

  when(s, 'none', sum.installs === 0);
  var body = when(s, 'some', sum.installs > 0);

  if (body) {
    var host = fill(body, 'teams');
    var max = load.length ? load[0].open : 0;
    load.forEach(function (c) {
      var row = proto(body, 'team');
      slot(row, 'name').textContent = c.name;
      slot(row, 'open').textContent = ui.num(c.open);
      slot(row, 'detail').textContent = c.sites + ' site' + (c.sites === 1 ? '' : 's') +
        (c.snags ? ' · ' + c.snags + ' snag' + (c.snags === 1 ? '' : 's') : '') +
        (c.overdue ? ' · ' + c.overdue + ' overdue' : '');
      // A computed width is a VALUE, not a utility — inline style is correct.
      slot(row, 'bar').style.width = (max ? Math.round(c.open / max * 100) : 0) + '%';
      host.appendChild(row);
    });
    dropProtos(body);

    fill(body, 'register').appendChild(EPAL.table({
      columns: [
        { key: 'name', label: 'Team', render: function (r) { return '<span class="strong">' + ui.escapeHtml(r.name) + '</span>'; } },
        { key: 'sites', label: 'Sites', num: true },
        { key: 'open', label: 'Open', num: true },
        { key: 'snags', label: 'Snags Carried', num: true,
          render: function (r) {
            if (!r.snags) return '<span class="text-mute">—</span>';
            return '<span class="num text-bad">' + ui.num(r.snags) + '</span>';
          } },
        { key: 'overdue', label: 'Overdue', num: true,
          render: function (r) {
            if (!r.overdue) return '<span class="text-mute">—</span>';
            return '<span class="num text-warn">' + ui.num(r.overdue) + '</span>';
          } },
        { key: 'handover', label: 'Handed Over', num: true }
      ],
      rows: load,
      searchKeys: ['name'],
      exportName: 'woodart-install-teams.csv',
      pageSize: 10,
      empty: { icon: 'people', title: 'No teams out', hint: 'Assign a team to an install.' }
    }).el);

    var canvas = fill(body, 'chart');
    mountScreen(page, s);

    requestAnimationFrame(function () {
      var open = load.filter(function (c) { return c.open > 0; });
      if (!EPAL.charts || !open.length || !canvas.isConnected) return;
      EPAL.charts.doughnut(canvas, {
        labels: open.map(function (c) { return c.name; }),
        data: open.map(function (c) { return c.open; })
      });
    });
    return;
  }

  mountScreen(page, s);
}

/* ============================================================ ADD / EDIT ==== */
function editInstall(rec) {
  var isNew = !rec;
  if (isNew && !canCreate()) { ui.toast('You do not have permission to schedule installs', 'error'); return; }

  // A record a user has already opened in the Projects snag modal carries a
  // snagList; editing the plain number here would silently contradict it, so
  // the field is read-only in that case and the modal says where to change it.
  var hasList = !!(rec && rec.snagList && rec.snagList.length);

  EPAL.formModal({
    title: isNew ? 'Schedule Install' : 'Edit · ' + rec.id,
    icon: 'truck',
    size: 'md',
    record: rec || { id: Installs.nextId(), status: 'Scheduled', snags: 0 },
    fields: [
      { key: 'id', label: 'Install No.', type: 'text', required: true, readonly: !isNew, col2: true,
        hint: isNew ? 'Auto-numbered in the INS-000 series.' : 'The install number is the record key and cannot change.' },
      { key: 'status', label: 'Status', type: 'select', required: true, col2: true, options: Installs.statuses(),
        hint: 'Anything other than Handover counts as a live site.' },
      { key: 'site', label: 'Site', type: 'text', required: true, placeholder: 'e.g. Gulshan-2' },
      { key: 'project', label: 'Project', type: 'select', required: true, searchable: true,
        options: Installs.projectOptions(),
        hint: 'An install pointing at a deleted project is flagged "orphan" in the schedule.' },
      { key: 'team', label: 'Team', type: 'select', required: true, col2: true, searchable: true,
        options: Installs.teamOptions() },
      { key: 'date', label: 'Visit Date', type: 'date', col2: true,
        hint: 'A site past this date and not handed over shows as overdue.' },
      { key: 'snags', label: 'Open Snags', type: 'number', min: 0, col2: true, readonly: hasList,
        hint: hasList
          ? 'This site has an itemised snag list — tick items off in the project drawer and this count follows.'
          : 'A plain count. Itemise it from the project drawer to track individual defects.' }
    ],
    saveLabel: isNew ? 'Schedule' : 'Save Changes',
    onSave: function (v) {
      // Never let the plain number overwrite an itemised list.
      if (hasList) { v.snagList = rec.snagList; v.snags = Installs.openSnags(rec); }
      Installs.save(v);
      ui.toast(isNew ? v.id + ' scheduled' : v.id + ' updated', 'success');
      EPAL.router.render();
      return true;
    }
  });
}

function deleteInstall(row) {
  var open = Installs.openSnags(row);
  ui.confirm({
    title: 'Delete ' + row.id + '?',
    body: 'The visit to ' + (row.site || 'this site') + ' will be removed from the schedule.' +
      (open ? ' It still has ' + open + ' open snag(s) — that history goes with it.' : '') +
      ' The project it belongs to is not affected. This cannot be undone.',
    confirmLabel: 'Delete'
  }).then(function (ok) {
    if (!ok) return;
    Installs.remove(row.id);
    ui.toast(row.id + ' deleted', 'success');
    EPAL.router.render();
  });
}
