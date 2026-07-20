/* ============================================================================
 * TRAVELS · CONTRACT FILE · LOGIC
 * ----------------------------------------------------------------------------
 * Behaviour only — markup lives in frontend/template.html and is handed to this
 * file (by tools/build/build-module.mjs) as the string TEMPLATE_HTML. This file
 * is NOT an IIFE and has no 'use strict' of its own: the build wraps it in
 * `(function(){ 'use strict'; var TEMPLATE_HTML=…; <this file> })()`.
 *
 * The repository of airline / vendor CONTRACTS behind Contract Flight: block-
 * seat & charter agreements, net-fare / PLB deals, their validity window,
 * commercial terms and attached documents. Screens (ctx.subId): contracts /
 * add / documents. Data = one store `tv_contracts`, seeded once via a Deep-Core
 * seed engine. The row-click contract modal (cfView) keeps its legacy el()-built
 * DOM verbatim — it is not part of the default render.
 *
 * ==> Laravel: Contract model + ContractController; see backend/LARAVEL-BLUEPRINT.md.
 * ========================================================================== */

var EPAL = window.EPAL, ui = EPAL.ui, el = ui.el, S = EPAL.store;

/* ---- template plumbing: clone a fragment, address its fill-slots ---------- */
var TPL = document.createElement('div');
TPL.innerHTML = TEMPLATE_HTML;
function frag(name) {
  var t = TPL.querySelector('template[data-tpl="' + name + '"]');
  return t.content.firstElementChild.cloneNode(true);
}
function slot(root, name) { return root.querySelector('[data-slot="' + name + '"]'); }

/* ---- constants + seed (unchanged from the legacy view) -------------------- */
var TODAY = '2026-07-05';                                   // demo "now" (matches the app clock)
var KINDS = ['Block Seat', 'Charter', 'Net Fare', 'PLB / Incentive'];

EPAL.registerEngine({ name: 'contract-file-seed', seed: function () {
  if (!S || !S.seedOnce) return;
  S.seedOnce('tv_contracts', sample());
}});
function sample() {
  return [
    { id:'CF1', ref:'CTR-2601', counterparty:'Biman Bangladesh (BG)', kind:'Block Seat', route:'DAC → JED', seats:120, buyPrice:58000, sellPrice:72000, validFrom:'2026-04-01', validTo:'2026-09-30', doc:'BG-BLOCK-26.pdf' },
    { id:'CF2', ref:'CTR-2602', counterparty:'Saudia (SV)',          kind:'Charter',    route:'DAC → MED', seats:180, buyPrice:61000, sellPrice:78000, validFrom:'2026-05-15', validTo:'2026-07-20', doc:'SV-UMRAH-26.pdf' },
    { id:'CF3', ref:'CTR-2603', counterparty:'US-Bangla (BS)',       kind:'Block Seat', route:'DAC → DXB', seats:60,  buyPrice:34000, sellPrice:42000, validFrom:'2026-01-01', validTo:'2026-06-30', doc:'BS-DXB-26.pdf' },
    { id:'CF4', ref:'CTR-2604', counterparty:'Emirates (EK)',        kind:'Net Fare',   route:'DAC → LHR', seats:0,   buyPrice:0,     sellPrice:0,     validFrom:'2026-03-01', validTo:'2027-02-28', doc:'EK-NET-26.pdf' },
    { id:'CF5', ref:'CTR-2605', counterparty:'Qatar Airways (QR)',   kind:'PLB / Incentive', route:'All sectors', seats:0, buyPrice:0, sellPrice:0, validFrom:'2026-01-01', validTo:'2026-12-31', doc:'QR-PLB-26.pdf' },
    { id:'CF6', ref:'CTR-2606', counterparty:'Salam Air (OV)',       kind:'Charter',    route:'DAC → MCT', seats:150, buyPrice:39000, sellPrice:51000, validFrom:'2026-06-01', validTo:'2026-08-31', doc:'OV-MCT-26.pdf' }
  ];
}
function contracts() { return S.list('tv_contracts'); }

/* status from the validity window (vs the demo clock) --------------------*/
function statusOf(c) {
  if (c.validTo < TODAY) return 'expired';
  if (daysTo(c.validTo) <= 30) return 'expiring';
  return 'active';
}
function daysTo(ymd) {
  var a = new Date(TODAY), b = new Date(ymd);
  return Math.round((b - a) / 86400000);
}
function badge(status) {
  var cls = status === 'active' ? 'badge-good' : status === 'expiring' ? 'badge-warn' : 'badge-bad';
  return el('span.badge.' + cls, { text: status.charAt(0).toUpperCase() + status.slice(1) });
}

/* one KPI card (frag('kpi') — also reused by the contract modal) */
function kpi(label, value, icon) {
  var n = frag('kpi');
  slot(n, 'label').textContent = label;
  slot(n, 'ico').innerHTML = ui.icon(icon);
  slot(n, 'value').textContent = String(value);
  return n;
}

/* section band — labels mirror the registry (config.js subs) */
var SECTIONS = [['contracts', 'All Contracts'], ['add', 'New Contract'], ['documents', 'Documents']];
function sectionNav(sub) {
  var nav = frag('nav');
  SECTIONS.forEach(function (s) {
    var btn = frag('nav-btn');
    if (sub === s[0]) btn.classList.add('active');
    btn.textContent = s[1];
    btn.addEventListener('click', function () { EPAL.router.navigate('travels/contract-file' + (s[0] === 'contracts' ? '' : '/' + s[0])); });
    nav.appendChild(btn);
  });
  return nav;
}

EPAL.view('travels/contract-file', {
  render: function (ctx) {
    var sub = ctx.subId || 'contracts';
    var page = frag('page');
    var titles = { contracts: 'All Contracts', add: 'New Contract', documents: 'Contract Documents' };
    var descs = {
      contracts: 'Airline & vendor agreements — block seats, charters, net fares and PLB incentives.',
      add: 'Record a new airline / vendor contract and its validity window.',
      documents: 'Every contract document on file, with its validity status.'
    };
    page.appendChild(EPAL.pageHead({
      eyebrow: sub === 'contracts' ? 'Epal Travels' : 'Travels › Contract File',
      icon: 'file-earmark-medical', title: titles[sub] || 'Contract File', sub: descs[sub]
    }));
    page.appendChild(sectionNav(sub));
    ({ contracts: listView, add: addView, documents: docsView }[sub] || listView)(page, ctx);
    ctx.mount.appendChild(page);
  }
});

/* ============================================================ ALL CONTRACTS */
function listView(page) {
  var list = contracts();
  var active = list.filter(function (c) { return statusOf(c) === 'active'; });
  var expiring = list.filter(function (c) { return statusOf(c) === 'expiring'; });
  var seats = list.reduce(function (a, c) { return a + (c.seats || 0); }, 0);
  var value = list.reduce(function (a, c) { return a + (c.sellPrice || 0) * (c.seats || 0); }, 0);
  page.appendChild(el('div.kpi-grid.stagger', null, [
    kpi('Active Contracts', active.length, 'file-earmark-check'),
    kpi('Seats Contracted', ui.num(seats), 'airplane'),
    kpi('Contract Value', ui.money(value, { compact: true }), 'cash-stack'),
    kpi('Expiring ≤30d', expiring.length, 'hourglass-split')
  ]));
  var t = EPAL.table({
    columns: [
      { key: 'ref', label: 'Ref', render: function (c) { return '<div class="strong">' + ui.escapeHtml(c.ref) + '</div><div class="text-mute xs">' + ui.escapeHtml(c.kind || '') + '</div>'; } },
      { key: 'counterparty', label: 'Counterparty' },
      { key: 'route', label: 'Route' },
      { key: 'seats', label: 'Seats', num: true, render: function (c) { return c.seats ? ui.num(c.seats) : '—'; } },
      { key: 'buyPrice', label: 'Buy', num: true, render: function (c) { return c.buyPrice ? ui.money(c.buyPrice) : '—'; }, sortVal: function (c) { return c.buyPrice || 0; } },
      { key: 'sellPrice', label: 'Sell', num: true, render: function (c) { return c.sellPrice ? ui.money(c.sellPrice) : '—'; }, sortVal: function (c) { return c.sellPrice || 0; } },
      { key: 'margin', label: 'Margin', num: true, render: function (c) { var m = c.sellPrice && c.buyPrice ? Math.round((1 - c.buyPrice / c.sellPrice) * 100) : null; return m === null ? '—' : m + '%'; },
        sortVal: function (c) { return c.sellPrice && c.buyPrice ? (1 - c.buyPrice / c.sellPrice) : -1; } },
      { key: 'validTo', label: 'Validity', render: function (c) { return ui.escapeHtml(c.validFrom + ' → ' + c.validTo); } },
      { key: 'status', label: 'Status', render: function (c) { return badge(statusOf(c)).outerHTML; }, sortVal: function (c) { return statusOf(c); } }
    ],
    rows: list.slice().sort(function (a, b) { return a.validTo < b.validTo ? -1 : 1; }),
    searchKeys: ['ref', 'kind', 'counterparty', 'route'],
    quickFilter: 'kind', filterPanel: true, filters: [], exportName: 'contracts.csv', pdfTitle: 'Airline / Vendor Contracts',
    onRow: function (c) { cfView(c); },
    actions: ui.actions({
      del:   function (c) { cfDelete(c); },
      print: function (c) { cfPrint(c); },
      wa:    function (c) { return { phone: '', text: cfMsg(c) }; },
      gmail: function (c) { return { to: '', subject: 'Contract ' + c.ref + ' — ' + c.counterparty, body: cfMsg(c) }; }
    }),
    empty: { icon: 'file-earmark-medical', title: 'No contracts on file', hint: 'Add an airline or vendor contract.' }
  });
  var card = frag('register-card');
  slot(card, 'title').innerHTML = ui.icon('file-earmark-medical') + ' Contracts';
  slot(card, 'sub').textContent = list.length + ' on file';
  slot(card, 'body').appendChild(t.el);
  page.appendChild(card);
}

/* ---- contract row actions (view / print / share / delete) --------------*/
/* The MODAL keeps its legacy el()-built DOM verbatim (not part of default
 * render → stays the verified-equivalent legacy code, inline styles and all). */
function cfRow(k, v) { return el('div.data-row', null, [ el('div.text-mute.sm.flex-1', { text: k }), el('div.strong', { text: v || '—' }) ]); }
function cfView(c) {
  var body = el('div');
  ui.modal({ title: c.ref + ' · ' + c.counterparty, icon: 'file-earmark-medical', size: 'lg', body: body, footer: false });
  var margin = c.sellPrice && c.buyPrice ? Math.round((1 - c.buyPrice / c.sellPrice) * 100) : null;
  var value = (c.sellPrice || 0) * (c.seats || 0);
  var st = statusOf(c);
  var actions = el('div.flex.gap-1.items-center', { style: { marginLeft: 'auto' } });
  actions.appendChild(el('button.btn.btn-sm.btn-primary', { html: ui.icon('printer') + ' Print', onclick: function () { cfPrint(c); } }));
  actions.appendChild(ui.rowActions(ui.actions({
    wa: { phone: '', text: cfMsg(c) }, gmail: { to: '', subject: 'Contract ' + c.ref + ' — ' + c.counterparty, body: cfMsg(c) },
    profile: { name: c.ref, card: { title: c.ref + ' — ' + c.counterparty, subtitle: c.kind + ' · ' + c.route, lines: [
      ['Seats', c.seats || '—'], ['Buy / seat', ui.money(c.buyPrice || 0)], ['Sell / seat', ui.money(c.sellPrice || 0)], ['Validity', c.validFrom + ' → ' + c.validTo] ] }, pdf: function () { cfPrint(c); } }
  })));
  body.appendChild(el('div.card', null, [ el('div.card-body', null, [ el('div.flex.items-center.gap-2.flex-wrap', null, [
    ui.frag('<span class="notif-ico notif-info">' + ui.icon('file-earmark-medical') + '</span>'),
    el('div.flex-1', { style: { minWidth: '180px' } }, [ el('div.fw-700', { style: { fontSize: '17px' }, text: c.counterparty }),
      el('div.flex.items-center.gap-2.flex-wrap', null, [ el('span.badge.mono', { text: c.ref }), el('span.badge', { text: c.kind }), badge(st) ]) ]),
    actions ]) ]) ]));
  body.appendChild(el('div.kpi-grid.kpi-compact.stagger', null, [
    kpi('Seats', c.seats ? ui.num(c.seats) : '—', 'airplane'),
    kpi('Margin', margin === null ? '—' : margin + '%', 'graph-up-arrow'),
    kpi('Contract Value', ui.money(value, { compact: true }), 'cash-stack'),
    kpi('Sell / Buy', ui.money(c.sellPrice || 0) + ' / ' + ui.money(c.buyPrice || 0), 'tags')
  ]));
  body.appendChild(el('div.card', null, [ el('div.card-head', null, [ el('h3', { html: ui.icon('info-circle') + ' Contract Details' }) ]),
    el('div.card-body', null, [ el('div.data-list', null, [
      cfRow('Route', c.route), cfRow('Validity', c.validFrom + ' → ' + c.validTo), cfRow('Status', st), cfRow('Document', c.doc)
    ]) ]) ]));
}
function cfPrint(c) {
  function pr(k, v) { return '<tr><td>' + k + '</td><td>' + ui.escapeHtml(String(v == null ? '—' : v)) + '</td></tr>'; }
  ui.printDoc({ title: 'Contract ' + c.ref, subtitle: c.counterparty + ' · ' + c.kind, meta: 'Airline / vendor contract',
    bodyHtml: '<table>' + pr('Route', c.route) + pr('Seats', c.seats || '—') + pr('Buy price / seat', c.buyPrice ? ui.money(c.buyPrice) : '—') +
      pr('Sell price / seat', c.sellPrice ? ui.money(c.sellPrice) : '—') + pr('Valid from', c.validFrom) + pr('Valid to', c.validTo) +
      pr('Document', c.doc) + '</table>' });
}
function cfMsg(c) {
  return 'Contract ' + c.ref + ' — ' + c.counterparty + '\n' +
    'Type: ' + c.kind + '\nRoute: ' + c.route + (c.seats ? '\nSeats: ' + c.seats : '') +
    '\nValidity: ' + c.validFrom + ' to ' + c.validTo + '\n\n— Epal Travels & Consultancy';
}
function cfDelete(c) {
  ui.confirm({ title: 'Delete contract', text: 'Delete ' + c.ref + ' (' + c.counterparty + ')?', danger: true, confirmLabel: 'Delete' })
    .then(function (ok) { if (!ok) return; S.removeFrom('tv_contracts', c); ui.toast(c.ref + ' deleted', 'good'); EPAL.router.navigate('travels/contract-file/contracts'); });
}

/* ================================================================ NEW CONTRACT */
function addView(page) {
  var f = {};
  function field(label, key, type, opts) {
    var isSel = type === 'select';
    var wrap = frag(isSel ? 'field-select' : 'field-text');
    slot(wrap, 'label').textContent = label;
    var input = slot(wrap, 'input');
    if (isSel) {
      opts.forEach(function (o) { input.appendChild(el('option', { value: o, text: o })); });
      input.addEventListener('change', function (e) { f[key] = e.target.value; });
      f[key] = opts[0];
    } else {
      input.type = type || 'text';
      input.addEventListener('input', function (e) { f[key] = e.target.value; });
    }
    return wrap;
  }
  var card = frag('add-card');
  var fields = slot(card, 'fields');
  fields.appendChild(field('Counterparty (airline / vendor)', 'counterparty', 'text'));
  fields.appendChild(field('Contract type', 'kind', 'select', KINDS));
  fields.appendChild(field('Route / sector', 'route', 'text'));
  fields.appendChild(field('Seats (0 for net-fare / PLB)', 'seats', 'number'));
  fields.appendChild(field('Buy price (per seat)', 'buyPrice', 'number'));
  fields.appendChild(field('Sell price (per seat)', 'sellPrice', 'number'));
  fields.appendChild(field('Valid from', 'validFrom', 'date'));
  fields.appendChild(field('Valid to', 'validTo', 'date'));
  slot(card, 'save').addEventListener('click', function () { save(f); });
  page.appendChild(card);
}
function save(f) {
  if (!f.counterparty) { ui.toast('Counterparty is required', 'warn'); return; }
  var n = contracts().length + 2601;
  var rec = {
    id: ui.uid('CF'), ref: 'CTR-' + n, counterparty: f.counterparty, kind: f.kind || 'Block Seat',
    route: f.route || '—', seats: +f.seats || 0, buyPrice: +f.buyPrice || 0, sellPrice: +f.sellPrice || 0,
    validFrom: f.validFrom || TODAY, validTo: f.validTo || TODAY, doc: (f.counterparty.split(' ')[0] || 'CTR') + '-' + n + '.pdf'
  };
  S.upsert('tv_contracts', rec);
  ui.toast('Contract ' + rec.ref + ' saved', 'good');
  EPAL.router.navigate('travels/contract-file/contracts');
}

/* ================================================================= DOCUMENTS */
function docsView(page) {
  var card = frag('docs-card');
  var tb = slot(card, 'rows');
  var list = contracts();
  list.forEach(function (c) {
    var row = frag('docs-row');
    slot(row, 'doc').textContent = c.doc;
    slot(row, 'ref').textContent = c.ref;
    slot(row, 'counterparty').textContent = c.counterparty;
    slot(row, 'validity').textContent = 'Valid to ' + c.validTo;
    slot(row, 'status').appendChild(badge(statusOf(c)));
    tb.appendChild(row);
  });
  slot(card, 'sub').textContent = list.length + ' files';
  page.appendChild(card);
}
