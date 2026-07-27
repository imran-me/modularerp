/* ============================================================================
 * WOODART · WORKSHOP (production) · LOGIC
 * ----------------------------------------------------------------------------
 * BEHAVIOUR ONLY. Every container, card, KPI tile, banner, board COLUMN and bar
 * is real HTML in frontend/template.html, handed to this file by
 * tools/build/build-module.mjs as TEMPLATE_HTML. This file is NOT an IIFE and
 * declares no 'use strict' of its own — the build wraps it.
 *
 * The board is the interesting case: its four COLUMNS are fixed markup (they
 * are the workshop's four states), and only the CARDS are cloned from a
 * [data-proto], because the number of cards is data. That is exactly the line
 * the build law draws.
 *
 * WHERE THE DATA COMES FROM: frontend/api.js — the seam. This file never names
 * `wa_production` and never names a URL. Grep it: neither is here.
 *
 * ==> LARAVEL MAPPING: jobs = GET|POST /api/woodart/production/jobs,
 *     load = GET .../load. Full contract in backend/endpoints.md.
 * ==========================================================================*/

var ui = EPAL.ui, el = ui.el;

var CID = 'woodart';
var ROUTE = 'woodart/production';

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
  jobs:  ['Job Register', 'Every fabrication job on the shop floor — station, owner, due date and status.'],
  board: ['Workshop Board', 'The four workshop states side by side. Click a card to open the job.'],
  load:  ['Station Load', 'Where the workshop is busy — open jobs, blockages and overdue work per station.']
};

function head(sub) {
  var copy = TAB_COPY[sub] || TAB_COPY.jobs;
  var h = shell('head');
  fill(h, 'eyebrow').textContent = 'Woodart › Workshop';
  fill(h, 'title').appendChild(document.createTextNode(copy[0]));
  var s = fill(h, 'sub');
  s.textContent = copy[1];
  s.setAttribute('title', copy[1]);
  var add = h.querySelector('[data-act="new"]');
  if (!canCreate()) add.parentNode.removeChild(add);
  else add.addEventListener('click', function () { editJob(null); });
  return h;
}

function tabs(sub) {
  var band = shell('tabs');
  Array.prototype.forEach.call(band.querySelectorAll('[data-tab]'), function (btn) {
    var key = btn.getAttribute('data-tab');
    if (key === sub) btn.classList.add('active');
    btn.removeAttribute('data-tab');
    btn.addEventListener('click', function () {
      EPAL.router.navigate(ROUTE + (key === 'jobs' ? '' : '/' + key));
    });
  });
  return band;
}

/* ---- permissions + formatters -------------------------------------------- */
function canCreate() { return !EPAL.perm || EPAL.perm.can(CID, 'production', 'create'); }
function canDelete() { return !EPAL.perm || EPAL.perm.can(CID, 'production', 'delete'); }

var STATUS_TONE = { Done: 'good', Running: '', Queued: 'warn', Blocked: 'bad' };
var STATUS_COLOR = { Queued: '#f4b740', Running: '#2f6bff', Blocked: '#f0506e', Done: '#23c17e' };

/** Due-date label + tone, shared by the register and the board cards so the
 *  same job never reads "3d left" in one place and "overdue" in another. */
function dueLabel(j) {
  var d = Workshop.daysLeft(j);
  if (isNaN(d)) return { text: '—', tone: '' };
  if (!Workshop.isOpen(j)) return { text: ui.date(j.due), tone: '' };
  if (d < 0) return { text: Math.abs(d) + 'd overdue', tone: 'text-bad' };
  if (d <= 7) return { text: d + 'd left', tone: 'text-warn' };
  return { text: d + 'd left', tone: '' };
}

/* ============================================================================
 * THE VIEW — one registration, three screens, chosen by ctx.subId.
 * ==========================================================================*/
EPAL.view(ROUTE, {
  title: function () { return 'Workshop'; },
  render: function (ctx) {
    var sub = ctx.subId || 'jobs';
    if (!TAB_COPY[sub]) sub = 'jobs';

    var page = el('div.page');
    page.appendChild(head(sub));
    page.appendChild(tabs(sub));

    ({ jobs: jobsScreen, board: boardScreen, load: loadScreen }[sub])(page);

    ctx.mount.appendChild(page);
  }
});

/* ============================================================= SCREEN · JOBS */
function jobsScreen(page) {
  var s = screen('jobs');
  var sum = Workshop.summary();

  fillK(s, 'jobs', ui.num(sum.jobs));
  fillK(s, 'running', ui.num(sum.running));
  fillK(s, 'blocked', ui.num(sum.blocked));
  fillK(s, 'overdue', ui.num(sum.overdue));
  fillK(s, 'done', sum.pct + '%');

  var banner = when(s, 'attention', sum.attention > 0);
  if (banner) {
    fillK(banner, 'attentionInline', ui.num(sum.attention));
    banner.querySelector('[data-act="goBoard"]')
      .addEventListener('click', function () { EPAL.router.navigate(ROUTE + '/board'); });
  }

  fill(s, 'register').appendChild(EPAL.table({
    columns: [
      { key: 'id', label: 'Job', render: function (r) { return '<span class="strong">' + ui.escapeHtml(r.id) + '</span>'; } },
      { key: 'job', label: 'Item' },
      { key: 'project', label: 'Project',
        render: function (r) {
          // An orphan job (project deleted) shows the raw id and is FLAGGED —
          // a job pointing at nothing is a data problem you want to see.
          var p = Workshop.projectOf(r);
          if (p) return '<span class="strong">' + ui.escapeHtml(r.project) + '</span> <span class="text-mute xs">' + ui.escapeHtml(p.name || '') + '</span>';
          return ui.escapeHtml(r.project || '—') + ' <span class="badge badge-warn">orphan</span>';
        } },
      { key: 'station', label: 'Station', render: function (r) { return '<span class="badge">' + ui.escapeHtml(r.station || '—') + '</span>'; } },
      { key: 'assignedTo', label: 'Assigned' },
      { key: 'status', label: 'Status', badge: STATUS_TONE },
      { key: 'due', label: 'Due', date: true },
      { key: 'countdown', label: 'Countdown',
        sortVal: function (r) { var d = Workshop.daysLeft(r); return isNaN(d) ? 99999 : d; },
        render: function (r) {
          var d = dueLabel(r);
          return '<span class="' + (d.tone || 'text-mute') + '">' + ui.escapeHtml(d.text) + '</span>';
        } }
    ],
    rows: Workshop.jobs(),
    searchKeys: ['id', 'job', 'project', 'station', 'assignedTo'],
    filters: [{ key: 'status', label: 'Status' }, { key: 'station', label: 'Station' }],
    onRow: function (r) { editJob(Workshop.job(r.id)); },
    actions: canDelete() ? [{ icon: 'trash', title: 'Delete job', onClick: deleteJob }] : null,
    exportName: 'woodart-workshop-jobs.csv',
    pageSize: 12,
    empty: { icon: 'hammer', title: 'No jobs yet', hint: 'Break a project into workshop jobs.' }
  }).el);

  mountScreen(page, s);
}

/* ============================================================ SCREEN · BOARD */
function boardScreen(page) {
  var s = screen('board');

  // The four columns are already in the markup. Fill each with its cards.
  Array.prototype.forEach.call(s.querySelectorAll('[data-col]'), function (col) {
    var status = col.getAttribute('data-col');
    var jobs = Workshop.byStatus(status);
    var list = fill(col, 'list');

    slot(col, 'count').textContent = String(jobs.length);
    // The column accent is a computed value, so it is an inline style.
    col.style.setProperty('--kb', STATUS_COLOR[status] || 'var(--accent)');
    col.removeAttribute('data-col');

    when(list, 'empty', jobs.length === 0);

    jobs.forEach(function (j) {
      var card = proto(s, 'job');
      var p = Workshop.projectOf(j);
      slot(card, 'job').textContent = j.job || j.id;
      slot(card, 'meta').textContent = j.id + ' · ' + (p ? p.name : (j.project || '—')) +
        (j.assignedTo ? ' · ' + j.assignedTo : '');
      slot(card, 'station').textContent = j.station || '—';
      var d = dueLabel(j);
      var due = slot(card, 'due');
      due.textContent = d.text;
      if (d.tone) due.classList.add(d.tone);
      card.addEventListener('click', (function (id) {
        return function () { editJob(Workshop.job(id)); };
      })(j.id));
      list.appendChild(card);
    });
  });

  dropProtos(s);
  mountScreen(page, s);
}

/* ============================================================= SCREEN · LOAD */
function loadScreen(page) {
  var s = screen('load');
  var sum = Workshop.summary();
  var load = Workshop.byStation();

  fillK(s, 'stations', ui.num(sum.stations));
  fillK(s, 'top', sum.top);
  fillK(s, 'open', ui.num(sum.open));
  fillK(s, 'crew', ui.num(sum.crew));

  when(s, 'none', sum.jobs === 0);
  var body = when(s, 'some', sum.jobs > 0);

  if (body) {
    var host = fill(body, 'stations');
    var max = load.length ? load[0].open : 0;
    load.forEach(function (c) {
      var row = proto(body, 'station');
      slot(row, 'name').textContent = c.name;
      slot(row, 'open').textContent = ui.num(c.open);
      slot(row, 'detail').textContent = c.total + ' total' +
        (c.blocked ? ' · ' + c.blocked + ' blocked' : '') +
        (c.overdue ? ' · ' + c.overdue + ' overdue' : '');
      // A computed width is a VALUE, not a utility — inline style is correct.
      slot(row, 'bar').style.width = (max ? Math.round(c.open / max * 100) : 0) + '%';
      host.appendChild(row);
    });
    dropProtos(body);

    fill(body, 'register').appendChild(EPAL.table({
      columns: [
        { key: 'name', label: 'Station', render: function (r) { return '<span class="strong">' + ui.escapeHtml(r.name) + '</span>'; } },
        { key: 'total', label: 'Jobs', num: true },
        { key: 'open', label: 'Open', num: true },
        { key: 'running', label: 'Running', num: true },
        { key: 'blocked', label: 'Blocked', num: true,
          render: function (r) {
            if (!r.blocked) return '<span class="text-mute">—</span>';
            return '<span class="num text-bad">' + ui.num(r.blocked) + '</span>';
          } },
        { key: 'overdue', label: 'Overdue', num: true,
          render: function (r) {
            if (!r.overdue) return '<span class="text-mute">—</span>';
            return '<span class="num text-warn">' + ui.num(r.overdue) + '</span>';
          } },
        { key: 'done', label: 'Done', num: true }
      ],
      rows: load,
      searchKeys: ['name'],
      exportName: 'woodart-station-load.csv',
      pageSize: 10,
      empty: { icon: 'diagram-3', title: 'No stations in use', hint: 'Assign jobs to a station.' }
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
function editJob(rec) {
  var isNew = !rec;
  if (isNew && !canCreate()) { ui.toast('You do not have permission to add jobs', 'error'); return; }

  EPAL.formModal({
    title: isNew ? 'New Workshop Job' : 'Edit · ' + rec.id,
    icon: 'hammer',
    size: 'md',
    record: rec || { id: Workshop.nextId(), status: 'Queued', station: 'CNC' },
    fields: [
      { key: 'id', label: 'Job No.', type: 'text', required: true, readonly: !isNew, col2: true,
        hint: isNew ? 'Auto-numbered in the JOB-000 series.' : 'The job number is the record key and cannot change.' },
      { key: 'status', label: 'Status', type: 'select', required: true, col2: true, options: Workshop.statuses(),
        hint: 'Anything other than Done counts as open work — and moves the card on the board.' },
      { key: 'job', label: 'Item', type: 'text', required: true, placeholder: 'e.g. Wardrobe shutters' },
      { key: 'project', label: 'Project', type: 'select', required: true, searchable: true,
        options: Workshop.projectOptions(),
        hint: 'Jobs belong to a project. A job pointing at a deleted project is flagged "orphan" in the register.' },
      { key: 'station', label: 'Station', type: 'select', required: true, col2: true, options: Workshop.stations() },
      { key: 'assignedTo', label: 'Assigned To', type: 'select', col2: true, searchable: true,
        options: Workshop.crewOptions() },
      { key: 'due', label: 'Due', type: 'date', col2: true,
        hint: 'A job past this date and not Done shows as overdue.' }
    ],
    saveLabel: isNew ? 'Add Job' : 'Save Changes',
    onSave: function (v) {
      Workshop.save(v);
      ui.toast(isNew ? v.id + ' added' : v.id + ' updated', 'success');
      EPAL.router.render();
      return true;
    }
  });
}

function deleteJob(row) {
  ui.confirm({
    title: 'Delete ' + row.id + '?',
    body: (row.job || 'This job') + ' (' + (row.station || 'no station') + ', ' +
      (row.status || 'no status').toLowerCase() + ') will be removed from the shop floor. ' +
      'The project it belongs to is not affected. This cannot be undone.',
    confirmLabel: 'Delete'
  }).then(function (ok) {
    if (!ok) return;
    Workshop.remove(row.id);
    ui.toast(row.id + ' deleted', 'success');
    EPAL.router.render();
  });
}
