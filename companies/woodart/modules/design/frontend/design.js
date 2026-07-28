/* ============================================================================
 * WOODART · DESIGN & 3D · LOGIC
 * ----------------------------------------------------------------------------
 * BEHAVIOUR ONLY. Every container, card, KPI tile, banner and bar is real HTML
 * in frontend/template.html, handed to this file by tools/build/build-module.mjs
 * as TEMPLATE_HTML. This file is NOT an IIFE — the build wraps it.
 *
 * WHERE THE DATA COMES FROM: frontend/api.js — the seam. This file never names
 * `wa_drawings` / `wa_revisions` and never names a URL. Grep it: neither is here.
 *
 * ==> LARAVEL: register = GET|POST /api/woodart/design/drawings,
 *     queue = GET .../approvals, load = GET .../load. See backend/endpoints.md.
 * ==========================================================================*/

var ui = EPAL.ui, el = ui.el;

var CID = 'woodart';
var ROUTE = 'woodart/design';

/* ---- template plumbing --------------------------------------------------- */
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
  n.removeAttribute('data-proto'); n.removeAttribute('hidden');
  return n;
}
function dropProtos(root) {
  Array.prototype.forEach.call(root.querySelectorAll('[data-proto]'), function (p) { p.parentNode.removeChild(p); });
}

/* ---- shared chrome ------------------------------------------------------- */

var TAB_COPY = {
  register:  ['Drawing Register', 'Plans, elevations, sections, details, 3D models and renders — with their current revision.'],
  approvals: ['Approvals', 'What is sitting with the client. A project’s design phase closes only when all of it is approved.'],
  load:      ['Design Load', 'Who is carrying the design work, and how much of it is still open.']
};

function head(sub) {
  var copy = TAB_COPY[sub] || TAB_COPY.register;
  var h = shell('head');
  fill(h, 'eyebrow').textContent = sub === 'register' ? 'Woodart Interiors' : 'Woodart › Design & 3D';
  fill(h, 'title').appendChild(document.createTextNode(copy[0]));
  var s = fill(h, 'sub');
  s.textContent = copy[1];
  s.setAttribute('title', copy[1]);
  var add = h.querySelector('[data-act="new"]');
  if (!canCreate()) add.parentNode.removeChild(add);
  else add.addEventListener('click', function () { editDrawing(null); });
  return h;
}

function tabs(sub) {
  var band = shell('tabs');
  Array.prototype.forEach.call(band.querySelectorAll('[data-tab]'), function (btn) {
    var key = btn.getAttribute('data-tab');
    if (key === sub) btn.classList.add('active');
    btn.removeAttribute('data-tab');
    btn.addEventListener('click', function () {
      EPAL.router.navigate(ROUTE + (key === 'register' ? '' : '/' + key));
    });
  });
  return band;
}

/* ---- permissions + formatters -------------------------------------------- */
function canCreate() { return !EPAL.perm || EPAL.perm.can(CID, 'design', 'create'); }
function canDelete() { return !EPAL.perm || EPAL.perm.can(CID, 'design', 'delete'); }

var STATUS_TONE = { Approved: 'good', Issued: '', Commented: 'bad', Draft: 'warn' };

function projectCell(r) {
  var p = Design.projectOf(r);
  if (p) return '<span class="strong">' + ui.escapeHtml(r.project) + '</span> <span class="text-mute xs">' + ui.escapeHtml(p.name || '') + '</span>';
  return ui.escapeHtml(r.project || '—') + ' <span class="badge badge-warn">orphan</span>';
}
function revCell(r) {
  var n = Design.revCount(r);
  return '<span class="badge">Rev ' + ui.escapeHtml(r.rev || 'A') + '</span>' +
    (n ? ' <span class="text-mute xs">' + n + ' revision' + (n === 1 ? '' : 's') + '</span>' : '');
}
function waitCell(r) {
  var d = Design.waitingDays(r);
  if (isNaN(d)) return '<span class="text-mute">—</span>';
  var tone = d > 14 ? 'text-bad' : d > 7 ? 'text-warn' : '';
  return '<span class="num ' + tone + '">' + d + 'd</span>';
}

/* ============================================================================
 * THE VIEW
 * ==========================================================================*/
EPAL.view(ROUTE, {
  title: function () { return 'Design & 3D'; },
  render: function (ctx) {
    var sub = ctx.subId || 'register';
    if (!TAB_COPY[sub]) sub = 'register';

    var page = el('div.page');
    page.appendChild(head(sub));
    page.appendChild(tabs(sub));

    ({ register: registerScreen, approvals: approvalsScreen, load: loadScreen }[sub])(page);

    ctx.mount.appendChild(page);
  }
});

/* ========================================================== SCREEN · REGISTER */
function registerScreen(page) {
  var s = screen('register');
  var sum = Design.summary();

  fillK(s, 'drawings', ui.num(sum.drawings));
  fillK(s, 'issued', ui.num(sum.issued));
  fillK(s, 'commented', ui.num(sum.commented));
  fillK(s, 'approved', ui.num(sum.approved));
  fillK(s, 'designers', ui.num(sum.designers));

  var banner = when(s, 'attention', sum.attention > 0);
  if (banner) {
    fillK(banner, 'attentionInline', ui.num(sum.attention));
    banner.querySelector('[data-act="goApprovals"]')
      .addEventListener('click', function () { EPAL.router.navigate(ROUTE + '/approvals'); });
  }

  fill(s, 'register').appendChild(EPAL.table({
    columns: [
      { key: 'id', label: 'Ref', render: function (r) { return '<span class="strong">' + ui.escapeHtml(r.id) + '</span>'; } },
      { key: 'title', label: 'Deliverable' },
      { key: 'kind', label: 'Kind', render: function (r) { return '<span class="badge">' + ui.escapeHtml(r.kind || '—') + '</span>'; } },
      { key: 'project', label: 'Project', render: projectCell },
      { key: 'designer', label: 'Designer' },
      { key: 'rev', label: 'Revision', render: revCell },
      { key: 'status', label: 'Status', badge: STATUS_TONE },
      { key: 'wait', label: 'With Client', num: true,
        sortVal: function (r) { var d = Design.waitingDays(r); return isNaN(d) ? -1 : d; },
        render: waitCell }
    ],
    rows: Design.register(),
    searchKeys: ['id', 'title', 'kind', 'project', 'designer'],
    filters: [{ key: 'status', label: 'Status' }, { key: 'kind', label: 'Kind' }],
    onRow: function (r) { drawingDrawer(r.id); },
    actions: canDelete() ? [{ icon: 'trash', title: 'Delete deliverable', onClick: deleteDrawing }] : null,
    exportName: 'woodart-drawings.csv',
    pageSize: 12,
    empty: { icon: 'vector-pen', title: 'No design work yet', hint: 'Add the first drawing or 3D model.' }
  }).el);

  mountScreen(page, s);
}

/* ========================================================= SCREEN · APPROVALS */
function approvalsScreen(page) {
  var s = screen('approvals');
  var sum = Design.summary();
  var q = Design.queue();

  fillK(s, 'waiting', ui.num(sum.waiting));
  fillK(s, 'oldest', sum.oldest);
  fillK(s, 'complete', sum.complete + ' / ' + sum.projects);
  fillK(s, 'avgRev', sum.avgRev);

  when(s, 'clear', q.length === 0);
  var body = when(s, 'some', q.length > 0);

  if (body) {
    var rows = q.map(function (r) {
      return { id: r.rec.id, title: r.rec.title, kind: r.rec.kind, project: r.rec.project,
        designer: r.rec.designer, rev: r.rec.rev, issued: r.rec.issued, days: r.days };
    });
    fill(body, 'register').appendChild(EPAL.table({
      columns: [
        { key: 'id', label: 'Ref', render: function (r) { return '<span class="strong">' + ui.escapeHtml(r.id) + '</span>'; } },
        { key: 'title', label: 'Deliverable' },
        { key: 'project', label: 'Project', render: projectCell },
        { key: 'designer', label: 'Designer' },
        { key: 'rev', label: 'Rev', render: function (r) { return '<span class="badge">' + ui.escapeHtml(r.rev || 'A') + '</span>'; } },
        { key: 'issued', label: 'Issued', date: true },
        { key: 'days', label: 'Waiting', num: true,
          render: function (r) {
            var tone = r.days > 14 ? 'text-bad' : r.days > 7 ? 'text-warn' : '';
            return '<span class="num strong ' + tone + '">' + ui.num(r.days) + 'd</span>';
          } }
      ],
      rows: rows,
      searchKeys: ['id', 'title', 'project', 'designer'],
      onRow: function (r) { drawingDrawer(r.id); },
      exportName: 'woodart-design-approvals.csv',
      pageSize: 12,
      empty: { icon: 'check2-circle', title: 'Nothing waiting', hint: 'Everything issued has been approved.' }
    }).el);
  }

  mountScreen(page, s);
}

/* ============================================================== SCREEN · LOAD */
function loadScreen(page) {
  var s = screen('load');
  var sum = Design.summary();
  var load = Design.byDesigner();
  var kinds = Design.byKind();

  fillK(s, 'designers', ui.num(sum.designers));
  fillK(s, 'top', sum.top);
  fillK(s, 'open', ui.num(sum.open));
  fillK(s, 'rate', sum.rate + '%');

  when(s, 'none', sum.drawings === 0);
  var body = when(s, 'some', sum.drawings > 0);

  if (body) {
    var host = fill(body, 'designers');
    var max = load.length ? load[0].open : 0;
    load.forEach(function (c) {
      var row = proto(body, 'designer');
      slot(row, 'name').textContent = c.name;
      slot(row, 'open').textContent = ui.num(c.open);
      slot(row, 'detail').textContent = c.total + ' total' +
        (c.waiting ? ' · ' + c.waiting + ' with client' : '') +
        (c.revisions ? ' · ' + c.revisions + ' revision' + (c.revisions === 1 ? '' : 's') : '');
      slot(row, 'bar').style.width = (max ? Math.round(c.open / max * 100) : 0) + '%';
      host.appendChild(row);
    });
    dropProtos(body);

    fill(body, 'register').appendChild(EPAL.table({
      columns: [
        { key: 'name', label: 'Designer', render: function (r) { return '<span class="strong">' + ui.escapeHtml(r.name) + '</span>'; } },
        { key: 'total', label: 'Deliverables', num: true },
        { key: 'open', label: 'Open', num: true },
        { key: 'waiting', label: 'With Client', num: true },
        { key: 'revisions', label: 'Revisions', num: true,
          render: function (r) {
            if (!r.revisions) return '<span class="text-mute">—</span>';
            return '<span class="num text-warn">' + ui.num(r.revisions) + '</span>';
          } },
        { key: 'approved', label: 'Approved', num: true }
      ],
      rows: load,
      searchKeys: ['name'],
      exportName: 'woodart-design-load.csv',
      pageSize: 10,
      empty: { icon: 'people', title: 'No designers assigned', hint: 'Assign a designer to a deliverable.' }
    }).el);

    var canvas = fill(body, 'chart');
    mountScreen(page, s);

    requestAnimationFrame(function () {
      if (!EPAL.charts || !kinds.length || !canvas.isConnected) return;
      EPAL.charts.doughnut(canvas, {
        labels: kinds.map(function (c) { return c.name; }),
        data: kinds.map(function (c) { return c.count; })
      });
    });
    return;
  }

  mountScreen(page, s);
}

/* ============================================== THE DRAWER (revision trail) ==
 * A per-record detail view whose row count is data — the sanctioned place for
 * JS to build DOM (UI-CONTRACT §4.2). It shows the audit trail, which is the
 * whole reason revisions are their own store rather than a blob.
 * ==========================================================================*/
function drawingDrawer(id) {
  var d = Design.find(id);
  if (!d) return;
  var body = el('div');
  var m = ui.modal({ title: d.id + ' · ' + (d.title || ''), icon: 'vector-pen', size: 'lg', body: body, footer: false });

  function redraw() {
    var cur = Design.find(id);
    if (!cur) { m.close(); return; }
    body.innerHTML = '';
    var p = Design.projectOf(cur);

    body.appendChild(el('div.flex.gap-1.flex-wrap.items-center.mb-3', null, [
      el('span.badge', { text: cur.kind || '—' }),
      el('span.badge', { text: 'Rev ' + (cur.rev || 'A') }),
      el('span.badge' + (STATUS_TONE[cur.status] ? '.badge-' + STATUS_TONE[cur.status] : ''), { text: cur.status || '—' })
    ]));

    body.appendChild(el('div.form-grid', null, [
      kv('Project', p ? cur.project + ' · ' + p.name : (cur.project || '—') + ' (orphan)'),
      kv('Designer', cur.designer || '—'),
      kv('Issued', cur.issued ? ui.date(cur.issued) : '—'),
      kv('Approved', cur.approved ? ui.date(cur.approved) : '—')
    ]));

    body.appendChild(el('div.section-label', { text: 'Revision trail' }));
    var trail = Design.trail(id);
    if (!trail.length) {
      body.appendChild(el('p.text-mute.sm', { text: 'No revisions recorded yet.' }));
    } else {
      var list = el('div.data-list');
      trail.forEach(function (r) {
        list.appendChild(el('div.data-row', null, [
          el('span.badge', { text: 'Rev ' + r.rev }),
          el('div.flex-1', null, [
            el('div.fw-600', { text: r.action }),
            el('div.text-mute.xs', { text: (r.by || '—') + (r.note ? ' · ' + r.note : '') })
          ]),
          el('span.text-mute.xs', { text: r.date ? ui.date(r.date) : '' })
        ]));
      });
      body.appendChild(list);
    }

    // The lifecycle buttons — each one records a row in the trail.
    body.appendChild(el('div.divider'));
    var acts = el('div.flex.gap-1.flex-wrap');
    if (canCreate()) {
      if (cur.status === 'Draft') acts.appendChild(btn('Issue to client', 'send', function () { move(cur, 'Issued'); }));
      if (cur.status === 'Issued') {
        acts.appendChild(btn('Client commented', 'chat-left-text', function () { move(cur, 'Commented'); }));
        acts.appendChild(btn('Approve', 'patch-check-fill', function () { move(cur, 'Approved'); }, true));
      }
      if (cur.status === 'Commented') acts.appendChild(btn('Issue revision ' + Design.nextRev(cur), 'arrow-counterclockwise', function () { revise(cur); }));
      acts.appendChild(btn('Edit', 'pencil', function () { m.close(); editDrawing(cur); }));
    }
    body.appendChild(acts);
  }

  function btn(label, icon, onclick, primary) {
    return el('button.btn.btn-sm' + (primary ? '.btn-primary' : '.btn-outline'),
      { html: ui.icon(icon) + ' ' + ui.escapeHtml(label), onclick: onclick });
  }
  function kv(k, v) {
    return el('div', null, [ el('div.text-mute.xs', { text: k }), el('div.fw-600', { text: String(v) }) ]);
  }

  /** A status move. The seam writes the trail row — this only says what and why. */
  function move(cur, status) {
    var rec = Object.assign({}, cur, { status: status });
    if (status === 'Issued' && !rec.issued) rec.issued = Design.today();
    if (status === 'Approved') rec.approved = Design.today();
    Design.save(rec);
    ui.toast(cur.id + ' → ' + status, 'success');
    redraw();
    EPAL.router.render();
  }

  /** A revision bumps the letter and puts it back with the client. */
  function revise(cur) {
    var rec = Object.assign({}, cur, {
      rev: Design.nextRev(cur), status: 'Issued', issued: Design.today(), approved: null
    });
    Design.save(rec, { note: 'Client comments incorporated' });
    ui.toast(cur.id + ' issued as Rev ' + rec.rev, 'success');
    redraw();
    EPAL.router.render();
  }

  redraw();
}

/* ============================================================ ADD / EDIT ==== */
function editDrawing(rec) {
  var isNew = !rec;
  if (isNew && !canCreate()) { ui.toast('You do not have permission to add design work', 'error'); return; }

  EPAL.formModal({
    title: isNew ? 'New Deliverable' : 'Edit · ' + rec.id,
    icon: 'vector-pen',
    size: 'md',
    record: rec || { id: Design.nextId(), kind: 'Plan', status: 'Draft', rev: 'A' },
    fields: [
      { key: 'id', label: 'Ref', type: 'text', required: true, readonly: !isNew, col2: true,
        hint: isNew ? 'Auto-numbered in the DWG-000 series.' : 'The ref is the record key and cannot change.' },
      { key: 'kind', label: 'Kind', type: 'select', required: true, col2: true, options: Design.kinds() },
      { key: 'title', label: 'Title', type: 'text', required: true, placeholder: 'e.g. Ground floor plan' },
      { key: 'project', label: 'Project', type: 'select', required: true, searchable: true,
        options: Design.projectOptions(),
        hint: 'A deliverable pointing at a deleted project is flagged "orphan" in the register.' },
      { key: 'designer', label: 'Designer', type: 'select', col2: true, searchable: true,
        options: Design.designerOptions() },
      { key: 'rev', label: 'Revision', type: 'text', col2: true,
        hint: 'A single letter. Use the drawer’s "Issue revision" button rather than editing this by hand.' },
      { key: 'status', label: 'Status', type: 'select', required: true, col2: true, options: Design.statuses(),
        hint: 'Draft → Issued → Commented → Approved. Approved closes it.' },
      { key: 'issued', label: 'Issued', type: 'date', col2: true }
    ],
    saveLabel: isNew ? 'Add Deliverable' : 'Save Changes',
    onSave: function (v) {
      if (v.status === 'Approved' && !v.approved) v.approved = Design.today();
      Design.save(v);
      ui.toast(isNew ? v.id + ' added' : v.id + ' updated', 'success');
      EPAL.router.render();
      return true;
    }
  });
}

function deleteDrawing(row) {
  var n = Design.trail(row.id).length;
  ui.confirm({
    title: 'Delete ' + row.id + '?',
    body: (row.title || 'This deliverable') + ' will be removed, along with its ' + n +
      ' revision record(s) — the trail has no meaning without it. The project is not affected. ' +
      'This cannot be undone.',
    confirmLabel: 'Delete'
  }).then(function (ok) {
    if (!ok) return;
    Design.remove(row.id);
    ui.toast(row.id + ' deleted', 'success');
    EPAL.router.render();
  });
}
