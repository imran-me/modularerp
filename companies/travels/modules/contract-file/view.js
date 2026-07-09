/* ============================================================================
 * EPAL TRAVELS  ·  companies/travels/modules/contract-file/view.js
 * ----------------------------------------------------------------------------
 * CONTRACT FILE — the repository of airline / vendor CONTRACTS (the paperwork
 * behind Contract Flight): block-seat & charter agreements, net-fare / PLB deals,
 * their validity window, commercial terms, and attached documents. Distinct from
 * Contract Flight (which schedules & sells the seats) and from File Management
 * (embassy/visa case files).
 *
 * Screens (ctx.subId): contracts (default) · add · documents.
 * Data: one store `tv_contracts` (localStorage epal.v1.tv_contracts), seeded once
 *   via a Deep-Core seed engine so the list is real and "New Contract" persists.
 *
 * ==> Laravel: Contract model + ContractController; see backend/LARAVEL-BLUEPRINT.md.
 * ========================================================================== */
(function (EPAL) {
  'use strict';
  var ui = EPAL.ui, el = ui.el, S = EPAL.store;
  var TODAY = '2026-07-05';                                   // demo "now" (matches the app clock)
  var KINDS = ['Block Seat', 'Charter', 'Net Fare', 'PLB / Incentive'];

  /* ---- seed a handful of realistic contracts, once -----------------------*/
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
  function kpi(label, value, icon) {
    return el('div.kpi-card', null, [
      el('div.kpi-top', null, [ el('span.kpi-label', { text: label }), el('span.kpi-ico', { html: ui.icon(icon) }) ]),
      el('div.kpi-value', { text: String(value) })
    ]);
  }

  EPAL.view('travels/contract-file', {
    render: function (ctx) {
      var sub = ctx.subId || 'contracts';
      var page = el('div.page');
      var titles = { contracts: 'All Contracts', add: 'New Contract', documents: 'Contract Documents' };
      var descs = {
        contracts: 'Airline & vendor agreements — block seats, charters, net fares and PLB incentives.',
        add: 'Record a new airline / vendor contract and its validity window.',
        documents: 'Every contract document on file, with its validity status.'
      };
      page.appendChild(EPAL.pageHead({
        eyebrow: sub === 'contracts' ? 'Epal Travels' : 'Travels › Contract File',
        icon: 'file-earmark-medical', title: titles[sub] || 'Contract File', sub: descs[sub],
        actions: [
          sub !== 'contracts' ? el('a.btn.btn-ghost', { href: '#/travels/contract-file/contracts', html: ui.icon('grid') + ' All Contracts' }) : null,
          sub !== 'add' ? el('a.btn.btn-primary', { href: '#/travels/contract-file/add', html: ui.icon('plus-lg') + ' New Contract' }) : null
        ]
      }));
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
    page.appendChild(el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon('file-earmark-medical') + ' Contracts' }),
        el('span.card-sub', { text: list.length + ' on file' }) ]),
      el('div.card-body', null, [ t.el ])
    ]));
  }

  /* ---- contract row actions (view / print / share / delete) --------------*/
  function cfRow(k, v) { return el('div.data-row', null, [ el('div.text-mute.sm.flex-1', { text: k }), el('div.strong', { text: v || '—' }) ]); }
  function cfView(c) {
    ui.modal({ title: c.ref + ' · ' + c.counterparty, icon: 'file-earmark-medical', size: 'md', body: el('div.data-list', null, [
      cfRow('Type', c.kind), cfRow('Route', c.route), cfRow('Seats', c.seats ? ui.num(c.seats) : '—'),
      cfRow('Buy / seat', c.buyPrice ? ui.money(c.buyPrice) : '—'), cfRow('Sell / seat', c.sellPrice ? ui.money(c.sellPrice) : '—'),
      cfRow('Validity', c.validFrom + ' → ' + c.validTo), cfRow('Status', statusOf(c)), cfRow('Document', c.doc)
    ]) });
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
      var input;
      if (type === 'select') {
        input = el('select.select', { onchange: function (e) { f[key] = e.target.value; } },
          opts.map(function (o) { return el('option', { value: o, text: o }); }));
        f[key] = opts[0];
      } else {
        input = el('input.input', { type: type || 'text', oninput: function (e) { f[key] = e.target.value; } });
      }
      return el('div.field', null, [ el('label', { text: label }), input ]);
    }
    var form = el('div.card', null, [
      el('div.card-body', null, [
        el('div.grid-auto', null, [
          field('Counterparty (airline / vendor)', 'counterparty', 'text'),
          field('Contract type', 'kind', 'select', KINDS),
          field('Route / sector', 'route', 'text'),
          field('Seats (0 for net-fare / PLB)', 'seats', 'number'),
          field('Buy price (per seat)', 'buyPrice', 'number'),
          field('Sell price (per seat)', 'sellPrice', 'number'),
          field('Valid from', 'validFrom', 'date'),
          field('Valid to', 'validTo', 'date')
        ]),
        el('div.mt-3', null, [
          el('button.btn.btn-primary', { html: ui.icon('check-lg') + ' Save Contract', onclick: function () { save(f); } }),
          el('a.btn.btn-ghost.ml-2', { href: '#/travels/contract-file/contracts', text: 'Cancel' })
        ])
      ])
    ]);
    page.appendChild(form);
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
    var rows = contracts().map(function (c) {
      return el('tr', null, [
        el('td', null, [ el('span', { html: ui.icon('file-earmark-pdf') + ' ' }), el('span.strong', { text: c.doc }) ]),
        el('td', { text: c.ref }),
        el('td', { text: c.counterparty }),
        el('td', { text: 'Valid to ' + c.validTo }),
        el('td', null, [ badge(statusOf(c)) ])
      ]);
    });
    page.appendChild(el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon('folder2-open') + ' Documents' }),
        el('span.card-sub', { text: rows.length + ' files' }) ]),
      el('div.table-wrap', null, [
        el('table.tbl', null, [
          el('thead', null, [ el('tr', null, ['Document', 'Contract', 'Counterparty', 'Validity', 'Status'].map(function (h) { return el('th', { text: h }); })) ]),
          el('tbody', null, rows)
        ])
      ])
    ]));
  }
})(window.EPAL);
