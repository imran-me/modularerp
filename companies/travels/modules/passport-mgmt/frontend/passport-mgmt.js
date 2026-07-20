/* ============================================================================
 * PASSPORT MANAGEMENT · LOGIC
 * ----------------------------------------------------------------------------
 * The behaviour only — markup lives in frontend/template.html and is handed to
 * this file (by tools/build/build-module.mjs) as the string TEMPLATE_HTML.
 *
 * This file is NOT an IIFE and has no 'use strict' of its own: the build wraps
 * it in `(function(){ 'use strict'; var TEMPLATE_HTML=…; <this file> })()`.
 *
 * Data (localStorage store `tv_passports`, seeded by seed-bd.js):
 *   { id, holder, passportNo, type, nationality, dob, issueDate, expiry, phone }
 * Self-registers EPAL.view('travels/passport-mgmt', …). Reuses the shared
 * datatable / form / print / modal kit exactly as before.
 *
 * ==> LARAVEL / PHP MAPPING: a `Passport` model + `PassportController`
 *     (index/store/update); `type` an enum; the radar a scoped query
 *     (whereBetween expiry now..+12m orderBy expiry).
 * ========================================================================== */

var EPAL = window.EPAL, ui = EPAL.ui, el = ui.el, db = EPAL.db, S = EPAL.store;

/* ---- template plumbing: clone a fragment, address its fill-slots ---------- */
var TPL = document.createElement('div');
TPL.innerHTML = TEMPLATE_HTML;
function frag(name) {
  var t = TPL.querySelector('template[data-tpl="' + name + '"]');
  return t.content.firstElementChild.cloneNode(true);
}
function slot(root, name) { return root.querySelector('[data-slot="' + name + '"]'); }

/* ---- data + small helpers (unchanged from the legacy view) ---------------- */
function passports() { return (db.col ? db.col('tv_passports') : S.list('tv_passports')) || []; }
function canCreate() { return !EPAL.perm || EPAL.perm.can('travels', 'passport-mgmt', 'create'); }

var TYPES = ['E-Passport', 'MRP', 'Official'];
function monthsLeft(d) { if (!d) return null; return Math.round((new Date(d).getTime() - Date.now()) / (86400000 * 30.4)); }
function expiryTone(d) { var m = monthsLeft(d); return m == null ? '' : m < 0 ? 'text-bad' : m <= 6 ? 'text-warn' : ''; }

function passMsg(p) {
  return 'Passport reminder — ' + p.holder + '\nPassport: ' + p.passportNo + ' (' + p.type + ')\nExpiry: ' + (p.expiry ? ui.date(p.expiry) : '—') +
    '\n\nYour passport is approaching expiry. Please contact us to renew in time.\n\n— Epal Travels & Consultancy';
}
function printPass(p) {
  function r(k, v) { return '<tr><td>' + k + '</td><td>' + ui.escapeHtml(String(v == null ? '—' : v)) + '</td></tr>'; }
  ui.printDoc({ title: 'Passport Record · ' + p.holder, subtitle: p.passportNo + ' · ' + p.type, meta: 'Passport record',
    bodyHtml: '<table>' + r('Holder', p.holder) + r('Passport No', p.passportNo) + r('Type', p.type) + r('Nationality', p.nationality) +
      r('Date of birth', p.dob ? ui.date(p.dob) : '—') + r('Issued', p.issueDate ? ui.date(p.issueDate) : '—') + r('Expiry', p.expiry ? ui.date(p.expiry) : '—') + r('Phone', p.phone) + '</table>' });
}
function passDetail(p) {
  function kv(k, v) { return el('div.data-row', null, [ el('div.text-mute.sm.flex-1', { text: k }), el('div.strong', { text: v == null ? '—' : String(v) }) ]); }
  ui.modal({ title: p.holder, icon: 'person-vcard', size: 'md', body: el('div.data-list', null, [
    kv('Passport No', p.passportNo), kv('Type', p.type), kv('Nationality', p.nationality),
    kv('Date of birth', p.dob ? ui.date(p.dob) : '—'), kv('Issued', p.issueDate ? ui.date(p.issueDate) : '—'),
    kv('Expiry', p.expiry ? ui.date(p.expiry) : '—'), kv('Phone', p.phone)
  ]) });
}

var titles = { holders: 'Passport Holders', categories: 'Passport Categories', expiry: 'Expiry Radar' };
var descs = { holders: 'Every passport on record — type, nationality, issue & expiry.',
  categories: 'How the register breaks down by document type — tap a card to filter.',
  expiry: 'Passports approaching expiry — renew before the window closes.' };

/* one KPI card (frag('kpi') → kpi-card > kpi-top(label,ico) + kpi-value) */
function kpi(label, value, icon) {
  var n = frag('kpi');
  slot(n, 'label').textContent = label;
  slot(n, 'ico').innerHTML = '<i class="bi bi-' + icon + '"></i>';
  slot(n, 'value').textContent = String(value);
  return n;
}

/* section band — same house full-bleed underline tabs as the other modules */
var SECTIONS = [['holders', 'Holders'], ['categories', 'Categories'], ['expiry', 'Expiry Radar']];
function sectionNav(sub) {
  var nav = frag('nav');
  SECTIONS.forEach(function (s) {
    var btn = frag('nav-btn');
    if (sub === s[0]) btn.classList.add('active');
    btn.textContent = s[1];
    btn.addEventListener('click', function () { EPAL.router.navigate('travels/passport-mgmt' + (s[0] === 'holders' ? '' : '/' + s[0])); });
    nav.appendChild(btn);
  });
  return nav;
}

EPAL.view('travels/passport-mgmt', {
  render: function (ctx) {
    var sub = ctx.subId || 'holders';
    var page = frag('page');
    page.appendChild(EPAL.pageHead({
      eyebrow: sub === 'holders' ? 'Epal Travels' : 'Travels › Passport Management',
      icon: 'person-vcard', title: titles[sub] || 'Passport Management', sub: descs[sub]
    }));
    page.appendChild(sectionNav(sub));
    ({ holders: holdersView, categories: categoriesView, expiry: expiryView }[sub] || holdersView)(page, ctx);
    ctx.mount.appendChild(page);
  }
});

/* -------------------------------------------------------------- holders */
function holdersView(page, ctx) {
  var list = passports();
  var soon = list.filter(function (p) { var m = monthsLeft(p.expiry); return m != null && m >= 0 && m <= 6; });
  var grid = frag('kpi-grid');
  grid.appendChild(kpi('Passports', list.length, 'person-vcard'));
  grid.appendChild(kpi('E-Passports', list.filter(function (p) { return p.type === 'E-Passport'; }).length, 'cpu'));
  grid.appendChild(kpi('Expiring ≤6m', soon.length, 'hourglass-split'));
  grid.appendChild(kpi('Expired', list.filter(function (p) { var m = monthsLeft(p.expiry); return m != null && m < 0; }).length, 'exclamation-octagon'));
  page.appendChild(grid);

  var preType = ctx && ctx.query && ctx.query.type;
  var t = EPAL.table({
    columns: [
      { key: 'id', label: 'ID', render: function (p) { return '<span class="mono xs text-mute">' + ui.escapeHtml(p.id) + '</span>'; } },
      { key: 'holder', label: 'Holder', render: function (p) { return '<span class="strong">' + ui.escapeHtml(p.holder) + '</span>'; } },
      { key: 'passportNo', label: 'Passport No', render: function (p) { return '<span class="mono">' + ui.escapeHtml(p.passportNo) + '</span>'; } },
      { key: 'type', label: 'Type', badge: {} },
      { key: 'nationality', label: 'Nationality' },
      { key: 'issueDate', label: 'Issued', date: true },
      { key: 'expiry', label: 'Expiry', sortVal: function (p) { return p.expiry || ''; },
        render: function (p) { var m = monthsLeft(p.expiry); return '<span class="' + expiryTone(p.expiry) + '">' + (p.expiry ? ui.date(p.expiry) : '—') + (m != null && m >= 0 && m <= 6 ? ' <span class="text-mute xs">(' + m + 'm)</span>' : '') + '</span>'; } },
      { key: 'phone', label: 'Phone' }
    ],
    rows: list, searchKeys: ['id', 'holder', 'passportNo', 'nationality'],
    quickFilter: 'type', filterPanel: true, filters: [{ key: 'nationality', label: 'Nationality' }],
    pageSize: 12, exportName: 'passports.csv', pdfTitle: 'Passport Register',
    onRow: function (p) { passDetail(p); },
    actions: ui.actions({
      print: function (p) { printPass(p); },
      wa:    function (p) { return { phone: p.phone, text: passMsg(p) }; },
      gmail: function (p) { return { to: '', subject: 'Passport renewal reminder — ' + p.holder, body: passMsg(p) }; }
    }),
    empty: { icon: 'person-vcard', title: 'No passports yet', hint: 'Add passport records to build the register.' }
  });
  if (preType) t.state.filters.type = preType;

  var card = frag('register-card');
  slot(card, 'title').innerHTML = ui.icon('person-vcard') + ' Passport Register';
  slot(card, 'sub').textContent = list.length + ' on record';
  slot(card, 'body').appendChild(t.el);
  page.appendChild(card);
  if (preType) t.refresh();
}

/* ----------------------------------------------------------- categories */
function categoriesView(page) {
  var list = passports(), by = {};
  TYPES.forEach(function (t) { by[t] = 0; });
  list.forEach(function (p) { by[p.type] = (by[p.type] || 0) + 1; });

  var lbl = frag('section-label');
  lbl.textContent = 'By document type — tap to open the register filtered';
  page.appendChild(lbl);

  var ICON = { 'E-Passport': 'cpu', 'MRP': 'card-heading', 'Official': 'patch-check' };
  var grid = frag('type-grid');
  Object.keys(by).forEach(function (type) {
    var card = frag('type-card');
    card.setAttribute('href', '#/travels/passport-mgmt/holders?type=' + encodeURIComponent(type));
    slot(card, 'ico').innerHTML = ui.icon(ICON[type] || 'person-vcard');
    slot(card, 'type').textContent = type;
    slot(card, 'count').textContent = String(by[type] || 0);
    grid.appendChild(card);
  });
  page.appendChild(grid);
}

/* -------------------------------------------------------- expiry radar */
function expiryView(page) {
  var list = passports().map(function (p) { return { p: p, m: monthsLeft(p.expiry) }; })
    .filter(function (x) { return x.m != null && x.m <= 12; })
    .sort(function (a, b) { return a.m - b.m; });
  var grid = frag('kpi-grid-compact');
  grid.appendChild(kpi('Expired', list.filter(function (x) { return x.m < 0; }).length, 'exclamation-octagon'));
  grid.appendChild(kpi('≤3 months', list.filter(function (x) { return x.m >= 0 && x.m <= 3; }).length, 'hourglass-bottom'));
  grid.appendChild(kpi('≤6 months', list.filter(function (x) { return x.m >= 0 && x.m <= 6; }).length, 'hourglass-split'));
  grid.appendChild(kpi('≤12 months', list.length, 'hourglass-top'));
  page.appendChild(grid);

  if (!list.length) { page.appendChild(frag('empty')); return; }

  var table = frag('radar-table');
  var tb = slot(table, 'rows');
  list.forEach(function (x) {
    var p = x.p, m = x.m;
    var row = frag('radar-row');
    slot(row, 'holder').innerHTML = '<span class="strong">' + ui.escapeHtml(p.holder) + '</span>';
    slot(row, 'passportNo').innerHTML = '<span class="mono">' + ui.escapeHtml(p.passportNo) + '</span>';
    slot(row, 'type').innerHTML = '<span class="badge">' + ui.escapeHtml(p.type) + '</span>';
    slot(row, 'expiry').innerHTML = p.expiry ? ui.date(p.expiry) : '—';
    slot(row, 'window').innerHTML = '<span class="' + (m < 0 ? 'text-bad' : m <= 3 ? 'text-warn' : 'text-good') + '">' + (m < 0 ? Math.abs(m) + 'm overdue' : m + 'm left') + '</span>';
    slot(row, 'actions').appendChild(ui.rowActions(ui.actions({
      print: (function (pp) { return function () { printPass(pp); }; })(p),
      wa:    { phone: p.phone, text: passMsg(p) },
      gmail: { to: '', subject: 'Passport renewal reminder — ' + p.holder, body: passMsg(p) }
    })));
    row.addEventListener('click', (function (pp) { return function () { passDetail(pp); }; })(p));
    tb.appendChild(row);
  });

  var card = frag('radar-card');
  slot(card, 'title').innerHTML = ui.icon('radar') + ' Expiry Radar';
  slot(card, 'sub').textContent = list.length + ' within 12 months';
  slot(card, 'tablewrap').appendChild(table);
  page.appendChild(card);
}
