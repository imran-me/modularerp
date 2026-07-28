/* ============================================================================
 * WOODART · CLIENTS · LOGIC
 * ----------------------------------------------------------------------------
 * BEHAVIOUR ONLY. Every container, card, KPI tile, banner and bar is real HTML
 * in frontend/template.html, handed to this file by tools/build/build-module.mjs
 * as TEMPLATE_HTML. This file is NOT an IIFE and declares no 'use strict' of its
 * own — the build wraps it.
 *
 * WHAT THIS FILE DOES, AND ONLY THIS:
 *   1. clones a screen / shell block out of the markup
 *   2. writes live values into its [data-k] and [data-fill] slots
 *   3. clones the [data-proto] row once per record (the count is data)
 *   4. removes the [data-when] blocks whose condition is false
 *   5. wires the [data-act] / [data-tab] buttons
 *   6. draws the chart and opens the add/edit modal
 * It never builds a card, a head bar, a tab band or a KPI tile.
 *
 * WHERE THE DATA COMES FROM: frontend/api.js — the seam. This file never names
 * the store key `wa_clients` and never names a URL. Grep it: neither is here.
 *
 * ==> LARAVEL MAPPING: directory = GET /api/woodart/clients/directory,
 *     portfolio = GET .../portfolio, the modal = POST, the row action = DELETE.
 *     Full contract in backend/endpoints.md.
 * ==========================================================================*/

var ui = EPAL.ui, el = ui.el;

var CID = 'woodart';
var ROUTE = 'woodart/clients';

/* ---- template plumbing — the whole bridge to the markup ------------------ */
var TPL = document.createElement('div');
TPL.innerHTML = TEMPLATE_HTML;

function screen(name) { return TPL.querySelector('[data-screen="' + name + '"]').cloneNode(true); }
function shell(name) { return TPL.querySelector('[data-shell="' + name + '"]').cloneNode(true); }
function fill(root, k) { return root.querySelector('[data-fill="' + k + '"]'); }
function fillK(root, k, v) { var n = root.querySelector('[data-k="' + k + '"]'); if (n) n.textContent = String(v); }
function slot(root, k) { return root.querySelector('[data-slot="' + k + '"]'); }
function mountScreen(page, s) { Array.prototype.slice.call(s.children).forEach(function (c) { page.appendChild(c); }); }

/** Keep or remove a [data-when] block. A screen's states are DECLARED in HTML
 *  and pruned here — never assembled on demand. */
function when(root, name, keep) {
  var n = root.querySelector('[data-when="' + name + '"]');
  if (!n) return null;
  if (!keep) { n.parentNode.removeChild(n); return null; }
  n.removeAttribute('data-when');
  return n;
}

/** Clone a hidden [data-proto] row — the sanctioned replacement for <template>
 *  cloning (MODULE-STANDARD §2.1). dropProtos() removes the prototypes after. */
function proto(host, name) {
  var n = host.querySelector('[data-proto="' + name + '"]').cloneNode(true);
  n.removeAttribute('data-proto');
  n.removeAttribute('hidden');
  return n;
}
function dropProtos(host) {
  Array.prototype.forEach.call(host.querySelectorAll('[data-proto]'), function (p) { p.parentNode.removeChild(p); });
}

/* ---- shared chrome ------------------------------------------------------- */

var TAB_COPY = {
  directory: ['Directory', 'Homeowners, developers and corporates — who Woodart builds for.'],
  portfolio: ['Portfolio', 'What each client is worth: projects, contract value, margin and open quotes.'],
  segments:  ['Segments', 'Which kind of client the business actually runs on.']
};

/** The page-head bar, cloned from markup. Mirrors EPAL.pageHead exactly: the
 *  title is a TEXT NODE after the icon, and the sub carries title= so the
 *  pinned one-line head still reveals a long sentence on hover. */
function head(sub) {
  var copy = TAB_COPY[sub] || TAB_COPY.directory;
  var h = shell('head');
  fill(h, 'eyebrow').textContent = sub === 'directory' ? 'Woodart Interiors' : 'Woodart › Clients';
  fill(h, 'title').appendChild(document.createTextNode(copy[0]));
  var s = fill(h, 'sub');
  s.textContent = copy[1];
  s.setAttribute('title', copy[1]);
  // The New Client button is in the markup and is REMOVED without the
  // permission — same grammar as a [data-when] block, never built on demand.
  var add = h.querySelector('[data-act="new"]');
  if (!canCreate()) add.parentNode.removeChild(add);
  else add.addEventListener('click', function () { editClient(null); });
  return h;
}

/** The 3-tab band. Marks the active tab, wires navigation, then STRIPS the
 *  data-tab hooks so they never reach the shipped DOM. */
function tabs(sub) {
  var band = shell('tabs');
  Array.prototype.forEach.call(band.querySelectorAll('[data-tab]'), function (btn) {
    var key = btn.getAttribute('data-tab');
    if (key === sub) btn.classList.add('active');
    btn.removeAttribute('data-tab');
    btn.addEventListener('click', function () {
      EPAL.router.navigate(ROUTE + (key === 'directory' ? '' : '/' + key));
    });
  });
  return band;
}

/* ---- permissions + formatters -------------------------------------------- */
function canCreate() { return !EPAL.perm || EPAL.perm.can(CID, 'clients', 'create'); }
function canDelete() { return !EPAL.perm || EPAL.perm.can(CID, 'clients', 'delete'); }

function money(v) { return ui.money(v, { compact: true }); }
function typeBadge(t) { return '<span class="badge">' + ui.escapeHtml(t || '—') + '</span>'; }

/* ============================================================================
 * THE VIEW — one registration, three screens, chosen by ctx.subId.
 * ==========================================================================*/
EPAL.view(ROUTE, {
  title: function () { return 'Clients'; },
  render: function (ctx) {
    var sub = ctx.subId || 'directory';
    if (!TAB_COPY[sub]) sub = 'directory';

    var page = el('div.page');
    page.appendChild(head(sub));
    page.appendChild(tabs(sub));

    ({ directory: directoryScreen, portfolio: portfolioScreen, segments: segmentsScreen }[sub])(page);

    ctx.mount.appendChild(page);
  }
});

/* ======================================================== SCREEN · DIRECTORY */
function directoryScreen(page) {
  var s = screen('directory');
  var sum = Clients.summary();

  fillK(s, 'clients', ui.num(sum.clients));
  fillK(s, 'live', ui.num(sum.live));
  fillK(s, 'value', money(sum.value));
  fillK(s, 'repeat', ui.num(sum.repeat));
  fillK(s, 'segments', ui.num(sum.segments));

  var banner = when(s, 'idle', sum.idle > 0);
  if (banner) {
    fillK(banner, 'idleInline', ui.num(sum.idle));
    banner.querySelector('[data-act="goPortfolio"]')
      .addEventListener('click', function () { EPAL.router.navigate(ROUTE + '/portfolio'); });
  }

  fill(s, 'register').appendChild(EPAL.table({
    columns: [
      { key: 'id', label: 'Code', render: function (r) { return '<span class="strong">' + ui.escapeHtml(r.id) + '</span>'; } },
      { key: 'name', label: 'Client' },
      { key: 'type', label: 'Segment', render: function (r) { return typeBadge(r.type); } },
      { key: 'contact', label: 'Contact' },
      { key: 'phone', label: 'Phone' },
      { key: 'area', label: 'Area' },
      { key: 'since', label: 'Client Since', date: true }
    ],
    rows: Clients.directory(),
    searchKeys: ['id', 'name', 'contact', 'phone', 'email', 'area'],
    filters: [{ key: 'type', label: 'Segment' }],
    onRow: function (r) { editClient(Clients.find(r.id)); },
    actions: canDelete() ? [{ icon: 'trash', title: 'Delete client', onClick: deleteClient }] : null,
    exportName: 'woodart-clients.csv',
    pageSize: 12,
    empty: { icon: 'person-hearts', title: 'No clients yet', hint: 'Add the first homeowner, developer or corporate.' }
  }).el);

  mountScreen(page, s);
}

/* ======================================================== SCREEN · PORTFOLIO */
function portfolioScreen(page) {
  var s = screen('portfolio');
  var rows = Clients.portfolio();
  var sum = Clients.summary();

  fillK(s, 'value', money(sum.value));
  fillK(s, 'cost', money(sum.cost));
  fillK(s, 'margin', money(sum.margin));
  fillK(s, 'top', sum.top);

  var hasWork = rows.some(function (r) { return r.projects > 0 || r.quotes > 0; });
  when(s, 'none', !hasWork);
  var body = when(s, 'some', hasWork);

  if (body) {
    fill(body, 'register').appendChild(EPAL.table({
      columns: [
        { key: 'name', label: 'Client', render: function (r) { return '<span class="strong">' + ui.escapeHtml(r.name) + '</span>'; } },
        { key: 'type', label: 'Segment', render: function (r) { return typeBadge(r.type); } },
        { key: 'projects', label: 'Projects', num: true },
        { key: 'live', label: 'Live', num: true },
        { key: 'value', label: 'Contract Value', num: true, money: true },
        { key: 'cost', label: 'Cost', num: true, money: true },
        { key: 'margin', label: 'Margin', num: true,
          sortVal: function (r) { return r.margin; },
          render: function (r) {
            return '<span class="num ' + (r.margin >= 0 ? 'text-good' : 'text-bad') + '">' + ui.money(r.margin) + '</span>';
          } },
        { key: 'won', label: 'Won', num: true },
        { key: 'open', label: 'Open', num: true }
      ],
      rows: rows,
      searchKeys: ['name', 'type'],
      filters: [{ key: 'type', label: 'Segment' }],
      onRow: function (r) { editClient(Clients.find(r.id)); },
      exportName: 'woodart-client-portfolio.csv',
      pageSize: 12,
      empty: { icon: 'bar-chart-steps', title: 'No client work', hint: 'Raise a project or estimate against a client.' }
    }).el);
  }

  mountScreen(page, s);
}

/* ========================================================= SCREEN · SEGMENTS */
function segmentsScreen(page) {
  var s = screen('segments');
  var sum = Clients.summary();
  var segs = Clients.bySegment();

  fillK(s, 'segments', ui.num(segs.length));
  fillK(s, 'top', segs.length ? segs[0].name : '—');
  fillK(s, 'avg', money(sum.avg));
  fillK(s, 'idle', ui.num(sum.idle));

  // One cloned row per segment — the count is data, so this is a proto clone.
  var host = fill(s, 'segments');
  var max = segs.length ? segs[0].value : 0;
  segs.forEach(function (c) {
    var row = proto(host, 'seg');
    slot(row, 'name').textContent = c.name + ' · ' + c.clients + ' client' + (c.clients === 1 ? '' : 's');
    slot(row, 'value').textContent = ui.money(c.value);
    slot(row, 'share').textContent = (sum.value ? Math.round(c.value / sum.value * 100) : 0) + '% of contract value';
    // A computed width is a VALUE, not a utility — inline style is correct here.
    slot(row, 'bar').style.width = (max ? Math.round(c.value / max * 100) : 0) + '%';
    host.appendChild(row);
  });
  dropProtos(host);

  fill(s, 'register').appendChild(EPAL.table({
    columns: [
      { key: 'name', label: 'Segment', render: function (r) { return '<span class="strong">' + ui.escapeHtml(r.name) + '</span>'; } },
      { key: 'clients', label: 'Clients', num: true },
      { key: 'projects', label: 'Projects', num: true },
      { key: 'value', label: 'Contract Value', num: true, money: true },
      { key: 'margin', label: 'Margin', num: true,
        render: function (r) {
          return '<span class="num ' + (r.margin >= 0 ? 'text-good' : 'text-bad') + '">' + ui.money(r.margin) + '</span>';
        } }
    ],
    rows: segs,
    searchKeys: ['name'],
    exportName: 'woodart-client-segments.csv',
    pageSize: 10,
    empty: { icon: 'tags', title: 'No segments', hint: 'Add clients to see the mix.' }
  }).el);

  var canvas = fill(s, 'chart');
  mountScreen(page, s);

  // Charts own their own pixels — drawn once the canvas is in the document.
  requestAnimationFrame(function () {
    if (!EPAL.charts || !segs.length || !canvas.isConnected) return;
    EPAL.charts.doughnut(canvas, {
      labels: segs.map(function (c) { return c.name; }),
      data: segs.map(function (c) { return c.value; })
    });
  });
}

/* ============================================================ ADD / EDIT ==== */
/** Config-driven platform form — the field schema is the spec the Laravel
 *  StoreClientRequest mirrors one-for-one (see backend/endpoints.md). */
function editClient(rec) {
  var isNew = !rec;
  if (isNew && !canCreate()) { ui.toast('You do not have permission to add clients', 'error'); return; }

  EPAL.formModal({
    title: isNew ? 'New Client' : 'Edit · ' + rec.name,
    icon: 'person-hearts',
    size: 'md',
    record: rec || { id: Clients.nextId(), type: 'Homeowner' },
    fields: [
      { key: 'id', label: 'Code', type: 'text', required: true, readonly: !isNew, col2: true,
        hint: isNew ? 'Auto-numbered in the CLI-000 series — change it if you use your own codes.'
                    : 'The code is the record key and cannot change.' },
      { key: 'type', label: 'Segment', type: 'select', required: true, col2: true, options: Clients.types() },
      { key: 'name', label: 'Client Name', type: 'text', required: true, placeholder: 'Person, developer or company',
        hint: 'Projects and estimates link to a client by NAME, so keep this exactly as it appears on their work.' },
      { key: 'contact', label: 'Contact Person', type: 'text', col2: true },
      { key: 'phone', label: 'Phone', type: 'phone', col2: true },
      { key: 'email', label: 'Email', type: 'email', col2: true },
      { key: 'area', label: 'Area', type: 'text', col2: true, placeholder: 'e.g. Gulshan-2' },
      { key: 'since', label: 'Client Since', type: 'date', col2: true }
    ],
    saveLabel: isNew ? 'Add Client' : 'Save Changes',
    onSave: function (v) {
      Clients.save(v);
      ui.toast(isNew ? v.name + ' added' : v.name + ' updated', 'success');
      EPAL.router.render();
      return true;
    }
  });
}

/** Delete always asks first, and names what is attached — a client with live
 *  projects is not a safe thing to remove silently. */
function deleteClient(row) {
  var work = Clients.withWork(row);
  ui.confirm({
    title: 'Delete ' + row.id + '?',
    body: row.name + ' will be removed from the directory.' +
      (work.projects || work.quotes
        ? ' They still have ' + work.projects + ' project(s) and ' + work.quotes +
          ' estimate(s) on record — those are NOT deleted, but they will no longer match a client.'
        : ' They have no projects or estimates on record.') +
      ' This cannot be undone.',
    confirmLabel: 'Delete'
  }).then(function (ok) {
    if (!ok) return;
    Clients.remove(row.id);
    ui.toast(row.id + ' deleted', 'success');
    EPAL.router.render();
  });
}
