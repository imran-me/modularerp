/* ============================================================================
 * EPAL GROUP ERP  ·  companies/travels/modules/passport-mgmt/view.js
 * ----------------------------------------------------------------------------
 * PASSPORT MANAGEMENT — the passport register for the Travels vertical: every
 * holder with document type, nationality, issue/expiry and an EXPIRY RADAR that
 * surfaces passports coming up for renewal. Three screens:
 *   holders    · the full register (search + type chips + Filter card + PDF)
 *   categories · counts by document type (tap to filter the register)
 *   expiry     · the expiry radar — passports expiring soonest first
 *
 * DATA (localStorage store `tv_passports`, seeded by seed-bd.js):
 *   { id, holder, passportNo, type, nationality, dob, issueDate, expiry, phone, created }
 *
 * Self-registers EPAL.view('travels/passport-mgmt', …); reuses the shared
 * datatable / form / print kit — same house pattern as the other modules.
 *
 * ==> LARAVEL / PHP MAPPING: a `Passport` Eloquent model + `PassportController`
 *     (index/store/update); `type` an enum; expiry radar a scoped query
 *     (whereBetween expiry now..+Nmonths orderBy expiry).
 * ========================================================================== */
(function () {
  'use strict';
  var EPAL = window.EPAL, ui = EPAL.ui, el = ui.el, db = EPAL.db, S = EPAL.store;

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

  // The section band. Labels match the registry (config.js subs) so the
  // sidebar and the band can never disagree; the default section routes to the
  // bare module route, exactly as the other converted modules do.
  var SECTIONS = [['holders', 'Holders'], ['categories', 'Categories'], ['expiry', 'Expiry Radar']];
  function sectionNav(sub) {
    var nav = el('div.tab-underline.mb-3');
    SECTIONS.forEach(function (s) {
      nav.appendChild(el('button' + (sub === s[0] ? '.active' : ''), { text: s[1],
        onclick: function () { EPAL.router.navigate('travels/passport-mgmt' + (s[0] === 'holders' ? '' : '/' + s[0])); } }));
    });
    return nav;
  }

  EPAL.view('travels/passport-mgmt', {
    render: function (ctx) {
      var sub = ctx.subId || 'holders';
      var page = el('div.page');
      page.appendChild(EPAL.pageHead({
        eyebrow: sub === 'holders' ? 'Epal Travels' : 'Travels › Passport Management',
        icon: 'person-vcard', title: titles[sub] || 'Passport Management', sub: descs[sub]
      }));
      // SECTION NAV — the house full-bleed underline band (owner grammar
      // 2026-07-15: sections = underline tabs; pills are filters below).
      // This module had NO section band: it navigated through page-action
      // buttons ("Holders" / "Expiry Radar"), a third grammar for the same
      // job. The band carries every section, so those buttons are gone rather
      // than left duplicating it.
      page.appendChild(sectionNav(sub));
      ({ holders: holdersView, categories: categoriesView, expiry: expiryView }[sub] || holdersView)(page, ctx);
      ctx.mount.appendChild(page);
    }
  });

  /* -------------------------------------------------------------- holders */
  function holdersView(page, ctx) {
    var list = passports();
    var soon = list.filter(function (p) { var m = monthsLeft(p.expiry); return m != null && m >= 0 && m <= 6; });
    page.appendChild(el('div.kpi-grid.stagger', null, [
      kpi('Passports', list.length, 'person-vcard'),
      kpi('E-Passports', list.filter(function (p) { return p.type === 'E-Passport'; }).length, 'cpu'),
      kpi('Expiring ≤6m', soon.length, 'hourglass-split'),
      kpi('Expired', list.filter(function (p) { var m = monthsLeft(p.expiry); return m != null && m < 0; }).length, 'exclamation-octagon')
    ]));
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
    page.appendChild(el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon('person-vcard') + ' Passport Register' }), el('span.card-sub', { text: list.length + ' on record' }) ]),
      el('div.card-body', null, [ t.el ])
    ]));
    if (preType) t.refresh();
  }

  /* ----------------------------------------------------------- categories */
  function categoriesView(page) {
    var list = passports(), by = {};
    TYPES.forEach(function (t) { by[t] = 0; });
    list.forEach(function (p) { by[p.type] = (by[p.type] || 0) + 1; });
    page.appendChild(el('div.section-label.mt-0', { text: 'By document type — tap to open the register filtered' }));
    var ICON = { 'E-Passport': 'cpu', 'MRP': 'card-heading', 'Official': 'patch-check' };
    page.appendChild(el('div.grid-auto.kpi-compact.stagger', null, Object.keys(by).map(function (type) {
      return el('a.card.tier-card', { href: '#/travels/passport-mgmt/holders?type=' + encodeURIComponent(type) }, [ el('div.card-pad', null, [
        el('div.flex.items-center.gap-2', null, [
          ui.frag('<span class="notif-ico notif-info">' + ui.icon(ICON[type] || 'person-vcard') + '</span>'),
          el('div.flex-1', null, [ el('div.fw-700', { text: type }), el('div.text-mute.sm', { text: 'document type' }) ]),
          el('div.kpi-value', { style: { fontSize: '24px' }, text: String(by[type] || 0) })
        ])
      ]) ]);
    })));
  }

  /* -------------------------------------------------------- expiry radar */
  function expiryView(page) {
    var list = passports().map(function (p) { return { p: p, m: monthsLeft(p.expiry) }; })
      .filter(function (x) { return x.m != null && x.m <= 12; })
      .sort(function (a, b) { return a.m - b.m; });
    page.appendChild(el('div.kpi-grid.kpi-compact.stagger', null, [
      kpi('Expired', list.filter(function (x) { return x.m < 0; }).length, 'exclamation-octagon'),
      kpi('≤3 months', list.filter(function (x) { return x.m >= 0 && x.m <= 3; }).length, 'hourglass-bottom'),
      kpi('≤6 months', list.filter(function (x) { return x.m >= 0 && x.m <= 6; }).length, 'hourglass-split'),
      kpi('≤12 months', list.length, 'hourglass-top')
    ]));
    if (!list.length) { page.appendChild(el('div.empty-state', null, [ ui.frag(ui.icon('radar')), el('h3', { text: 'Nothing expiring soon' }), el('p.text-muted', { text: 'Passports expiring within 12 months appear here.' }) ])); return; }
    var rows = list.map(function (x) {
      var p = x.p, m = x.m;
      return el('tr.row-click', { onclick: (function (pp) { return function () { passDetail(pp); }; })(p) }, [
        td('<span class="strong">' + ui.escapeHtml(p.holder) + '</span>'), td('<span class="mono">' + ui.escapeHtml(p.passportNo) + '</span>'),
        td('<span class="badge">' + ui.escapeHtml(p.type) + '</span>'), td(p.expiry ? ui.date(p.expiry) : '—'),
        td('<span class="' + (m < 0 ? 'text-bad' : m <= 3 ? 'text-warn' : 'text-good') + '">' + (m < 0 ? Math.abs(m) + 'm overdue' : m + 'm left') + '</span>'),
        el('td', null, [ ui.rowActions(ui.actions({
          print: (function (pp) { return function () { printPass(pp); }; })(p),
          wa:    { phone: p.phone, text: passMsg(p) },
          gmail: { to: '', subject: 'Passport renewal reminder — ' + p.holder, body: passMsg(p) }
        })) ])
      ]);
    });
    var table = el('table.tbl');
    table.innerHTML = '<thead><tr>' + ['Holder', 'Passport No', 'Type', 'Expiry', 'Window', ''].map(function (h) { return '<th>' + h + '</th>'; }).join('') + '</tr></thead>';
    var tb = el('tbody'); rows.forEach(function (r) { tb.appendChild(r); }); table.appendChild(tb);
    page.appendChild(el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon('radar') + ' Expiry Radar' }), el('span.card-sub', { text: list.length + ' within 12 months' }) ]),
      el('div.table-wrap', null, [ table ])
    ]));
  }

  function kpi(label, value, icon) {
    return el('div.kpi-card', null, [
      el('div.kpi-top', null, [ el('span.kpi-label', { text: label }), el('span.kpi-ico', { html: '<i class="bi bi-' + icon + '"></i>' }) ]),
      el('div.kpi-value', { text: String(value) })
    ]);
  }
  function td(html) { var t = el('td'); t.innerHTML = html; return t; }
})();
