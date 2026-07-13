/* ============================================================================
 * EPAL GROUP ERP  ·  companies/travels/modules/ledgers/view.js
 * ----------------------------------------------------------------------------
 * TRAVELS — LEDGERS. The double-entry books of Epal Travels, read straight off
 * the shared ledger engine (EPAL.ledger): a financial-snapshot cockpit plus the
 * General Ledger, Trial Balance, Party subledgers, AR/AP ageing, Balance Sheet
 * and P&L — every table drillable and every statement a branded PDF.
 *
 * Because the router prefers a specific view over the shared "star-slash-ledgers"
 * wildcard, this Travels screen supersedes the generic one WITHOUT touching any
 * other company. Tabs are driven by the `?tab=` query param (ledgers has no
 * sub-modules). Never write a literal star-slash inside this comment block.
 *
 * DRILL-DOWNS (the gold-standard upgrade over the shared view):
 *   - Trial-balance row → that account's running General Ledger (modal).
 *   - Party row (party ledger / ageing) → its Statement of Account (modal + PDF).
 *   - GL row → the full balanced journal entry (modal).
 *
 * ==> LARAVEL: a LedgerController reading the LedgerService (trialBalance / pnl /
 *     balanceSheet / aging); Blade views per tab; the DocumentService for PDFs.
 * ==========================================================================*/

(function (EPAL) {
  'use strict';
  var ui = EPAL.ui, el = ui.el, db = EPAL.db;
  var CID = 'travels';
  var CO_NAME = 'Epal Travels & Consultancy';
  var TODAY_STR = '2026-07-05';

  var TABS = [['overview', 'Overview'], ['general', 'General Ledger'], ['trial', 'Trial Balance'], ['party', 'Party Ledger'],
    ['ar', 'AR Ageing'], ['ap', 'AP Ageing'], ['bs', 'Balance Sheet'], ['pnl', 'P&L']];

  EPAL.view('travels/ledgers', {
    render: function (ctx) {
      var L = EPAL.ledger;
      var tab = (ctx.params && ctx.params.tab) || 'overview';
      if (!TABS.some(function (t) { return t[0] === tab; })) tab = 'overview';
      var page = el('div.page');
      page.appendChild(EPAL.pageHead({
        eyebrow: tab === 'overview' ? 'Epal Travels' : 'Travels › Ledgers', icon: 'journal-text',
        title: tab === 'overview' ? 'Ledgers' : (TABS.filter(function (t) { return t[0] === tab; })[0][1]),
        sub: 'Real double-entry general ledger, trial balance, party subledgers, ageing and statements for Epal Travels.',
        actions: [ el('a.btn.btn-ghost', { href: '#/travels/accounts', html: ui.icon('cash-stack') + ' Accounts' }) ]
      }));
      if (!L) { page.appendChild(el('div.card', null, [ el('div.card-body', null, [ el('p.text-mute', { text: 'The ledger engine is not available.' }) ]) ])); ctx.mount.appendChild(page); return; }

      var pills = el('div.pill-tab.mb-3');
      TABS.forEach(function (p) { pills.appendChild(el('button' + (tab === p[0] ? '.active' : ''), { text: p[1],
        onclick: function () { EPAL.router.navigate('travels/ledgers', { tab: p[0] }); } })); });
      page.appendChild(pills);

      ({ overview: overview, general: generalView, trial: trialView, party: partyView, ar: ageingView, ap: ageingView, bs: bsView, pnl: pnlView }[tab])(page, L, ctx, tab);
      ctx.mount.appendChild(page);
    }
  });

  /* ======================================================= OVERVIEW (cockpit) */
  function overview(page, L) {
    var pl = L.pnl(CID), bs = L.balanceSheet(CID);
    var tb = L.trialBalance(CID); var Td = 0, Tc = 0; tb.forEach(function (r) { Td += r.debit; Tc += r.credit; });
    var balanced = Math.abs(Td - Tc) < 1;
    var cash = safeBal(L, '1010') + safeBal(L, '1000');
    var ar = L.aging('AR', { companyId: CID }), ap = L.aging('AP', { companyId: CID });
    var arTot = ar.reduce(function (a, r) { return a + r.total; }, 0), apTot = ap.reduce(function (a, r) { return a + r.total; }, 0);
    var arOverdue = ar.reduce(function (a, r) { return a + r.d30 + r.d60 + r.d90; }, 0), apOverdue = ap.reduce(function (a, r) { return a + r.d30 + r.d60 + r.d90; }, 0);

    page.appendChild(el('div.kpi-grid.kpi-compact.stagger', null, [
      kpiDrill('Revenue', ui.money(pl.revenue, { compact: true }), 'cash-coin', 'pnl'),
      kpi('Net Profit', ui.money(pl.net, { compact: true }), pl.net >= 0 ? 'trophy' : 'exclamation-triangle', pl.net >= 0 ? 'text-good' : 'text-bad'),
      kpi('Cash & Bank', ui.money(cash, { compact: true }), 'bank2'),
      kpiDrill('Receivable', ui.money(arTot, { compact: true }), 'arrow-down-left-circle', 'ar', arOverdue ? ui.money(arOverdue, { compact: true }) + ' overdue' : 'all current'),
      kpiDrill('Payable', ui.money(apTot, { compact: true }), 'arrow-up-right-circle', 'ap', apOverdue ? ui.money(apOverdue, { compact: true }) + ' overdue' : 'all current'),
      kpi('Total Assets', ui.money(bs.totals.assets, { compact: true }), 'building')
    ]));

    // balance-check + action center
    var acts = [];
    if (!balanced) acts.push({ tone: 'error', icon: 'exclamation-triangle-fill', text: '<strong>Trial balance is out</strong> by ' + ui.money(Math.abs(Td - Tc)) + ' — investigate before reporting.', go: 'trial' });
    if (!bs.totals.balanced) acts.push({ tone: 'error', icon: 'exclamation-octagon-fill', text: '<strong>Balance sheet does not balance</strong> (A ≠ L + E).', go: 'bs' });
    ar.slice().sort(function (a, b) { return (b.d60 + b.d90) - (a.d60 + a.d90); }).filter(function (r) { return r.d60 + r.d90 > 0; }).slice(0, 3).forEach(function (r) {
      acts.push({ tone: 'warning', icon: 'hourglass-bottom', text: 'Overdue receivable: <strong>' + esc(r.party) + '</strong> · ' + ui.money(r.d60 + r.d90) + ' 31d+', go: 'ar', party: r.party });
    });
    ap.slice().sort(function (a, b) { return (b.d60 + b.d90) - (a.d60 + a.d90); }).filter(function (r) { return r.d60 + r.d90 > 0; }).slice(0, 2).forEach(function (r) {
      acts.push({ tone: 'info', icon: 'clock-history', text: 'Overdue payable: <strong>' + esc(r.party) + '</strong> · ' + ui.money(r.d60 + r.d90) + ' 31d+', go: 'ap', party: r.party });
    });
    page.appendChild(el('div.section-label', { text: 'Action Center — needs attention' }));
    if (acts.length) {
      page.appendChild(el('div.card', null, [ el('div.card-body', null, acts.map(function (a) {
        return el('div.data-row', { style: { cursor: 'pointer' }, onclick: (function (go) { return function () { EPAL.router.navigate('travels/ledgers', { tab: go }); }; })(a.go) }, [
          ui.frag('<span class="notif-ico notif-' + a.tone + '">' + ui.icon(a.icon) + '</span>'), el('div.flex-1', { html: a.text }), ui.frag('<span class="text-mute">' + ui.icon('chevron-right') + '</span>')
        ]);
      })) ]));
    } else {
      page.appendChild(el('div.build-banner.mb-3', null, [ ui.frag(ui.icon('check-circle-fill')), el('div', { html: '<strong>Books are clean.</strong> Trial balance and balance sheet both balance; nothing seriously overdue.' }) ]));
    }

    // income statement snapshot + assets/claims chart
    page.appendChild(el('div.section-label', { text: 'Financial Snapshot' }));
    var pId = ui.uid('bsmix');
    page.appendChild(el('div.grid-auto', null, [
      el('div.card', null, [ el('div.card-head', null, [ el('h3', { html: ui.icon('graph-up-arrow') + ' Income Statement' }), el('span.card-sub', { text: 'live ledger P&L' }) ]),
        el('div.card-body', null, [ pnlLine('Revenue', pl.revenue, false), pnlLine('Cost of Sales', -pl.cogs, false), pnlLine('Gross Profit', pl.gross, true), pnlLine('Operating Expenses', -pl.expenses, false), pnlLine('Net Profit', pl.net, true) ]) ]),
      chartCard('Assets vs Claims', 'pie-chart', pId, 'A = L + E', 240)
    ]));
    requestAnimationFrame(function () { var c = document.getElementById(pId); if (!c) return;
      EPAL.charts.doughnut(c, { labels: ['Assets', 'Liabilities', 'Equity'], data: [bs.totals.assets, bs.totals.liabilities, bs.totals.equity], colors: ['#1A43BF', '#f4b740', '#23c17e'] }); });
  }

  /* ======================================================= GENERAL LEDGER */
  function generalView(page, L, ctx) {
    var used = {};
    L.entries({ companyId: CID }).forEach(function (e) { (e.lines || []).forEach(function (l) { used[l.account] = true; }); });
    var gAccts = L.accounts().filter(function (a) { return used[a.code]; });
    if (!gAccts.length) gAccts = L.accounts();
    var sel = el('select.select', { style: { maxWidth: '360px' } });
    gAccts.forEach(function (a) { sel.appendChild(el('option', { value: a.code, text: a.code + ' · ' + a.name })); });
    var code = (ctx.params && ctx.params.code) || gAccts[0].code;
    sel.value = code;
    var body = el('div.mt-3');
    sel.addEventListener('change', function () { draw(sel.value); });
    page.appendChild(el('div.card', null, [ el('div.card-body', null, [ el('div.section-label.mt-0', { text: 'Select account' }), sel ]) ]));
    page.appendChild(body);
    draw(code);

    function draw(code) {
      body.innerHTML = '';
      var acc = L.account(code), rows = L.ledgerFor(code, { companyId: CID });
      var td = 0, tc = 0; rows.forEach(function (r) { td += r.debit; tc += r.credit; });
      var closing = rows.length ? rows[rows.length - 1].balance : 0;
      body.appendChild(el('div.kpi-grid.kpi-compact', null, [
        kpi('Total Debit', ui.money(td, { compact: true }), 'arrow-up-right-circle'),
        kpi('Total Credit', ui.money(tc, { compact: true }), 'arrow-down-left-circle'),
        kpi('Closing Balance', ui.money(closing, { compact: true }), 'wallet2'),
        kpi('Entries', String(rows.length), 'list-ol')
      ]));
      var t = EPAL.table({
        columns: [
          { key: 'date', label: 'Date', date: true }, { key: 'ref', label: 'Reference' }, { key: 'memo', label: 'Narration' }, { key: 'party', label: 'Party' },
          { key: 'debit', label: 'Debit', num: true, render: function (r) { return r.debit ? '<span class="num text-bad">' + ui.money(r.debit) + '</span>' : '—'; }, exportVal: function (r) { return r.debit; } },
          { key: 'credit', label: 'Credit', num: true, render: function (r) { return r.credit ? '<span class="num text-good">' + ui.money(r.credit) + '</span>' : '—'; }, exportVal: function (r) { return r.credit; } },
          { key: 'balance', label: 'Balance', num: true, money: true }
        ],
        rows: rows.slice().reverse(), searchKeys: ['ref', 'memo', 'party'], dateKey: 'date', pageSize: 15,
        exportName: 'travels-' + code + '-ledger.csv', pdfTitle: (acc ? acc.name : code) + ' — General Ledger',
        onRow: function (r) { journalByRef(L, r.ref); },
        empty: { icon: 'journal-text', title: 'No movement on this account' }
      });
      body.appendChild(el('div.card', null, [
        el('div.card-head', null, [ el('h3', { html: ui.icon('journal-text') + ' ' + (acc ? acc.code + ' · ' + acc.name : code) }),
          el('button.btn.btn-sm.btn-primary', { html: ui.icon('printer') + ' Statement', onclick: function () { printAccountStatement(acc, rows.slice().reverse(), closing); } }) ]),
        el('div.card-body', null, [ t.el ])
      ]));
    }
  }

  /* ======================================================= TRIAL BALANCE */
  function trialView(page, L) {
    var rows = L.trialBalance(CID); var Td = 0, Tc = 0; rows.forEach(function (r) { Td += r.debit; Tc += r.credit; });
    var balanced = Math.abs(Td - Tc) < 1;
    page.appendChild(el('div.kpi-grid.kpi-compact.stagger', null, [
      kpi('Total Debit', ui.money(Td, { compact: true }), 'arrow-up-right-circle'),
      kpi('Total Credit', ui.money(Tc, { compact: true }), 'arrow-down-left-circle'),
      kpi('Accounts', String(rows.length), 'list-ol'),
      kpi('Balance Check', balanced ? 'Balanced' : 'Out by ' + ui.money(Math.abs(Td - Tc)), balanced ? 'check2-circle' : 'exclamation-triangle', balanced ? 'text-good' : 'text-bad')
    ]));
    if (!balanced) page.appendChild(el('div.build-banner.mb-3', null, [ ui.frag(ui.icon('exclamation-triangle-fill')), el('div', { html: '<strong>Trial balance is out by ' + ui.money(Math.abs(Td - Tc)) + '.</strong> A posting is unbalanced — review recent journals.' }) ]));
    var t = EPAL.table({
      columns: [
        { key: 'code', label: 'Code', render: function (r) { return '<span class="mono xs text-mute">' + esc(r.code) + '</span>'; } },
        { key: 'name', label: 'Account Head', render: function (r) { return '<span class="strong">' + esc(r.name) + '</span>'; } },
        { key: 'type', label: 'Type', badge: { asset: 'info', liability: 'warn', equity: 'accent', income: 'good', expense: 'bad' } },
        { key: 'debit', label: 'Debit', num: true, money: true }, { key: 'credit', label: 'Credit', num: true, money: true }
      ],
      rows: rows, quickFilter: 'type', filterPanel: true, searchKeys: ['code', 'name'], pageSize: 30,
      exportName: 'travels-trial-balance.csv', pdfTitle: 'Trial Balance — Epal Travels',
      onRow: function (r) { accountLedgerModal(L, r.code); },
      empty: { icon: 'journal-check', title: 'No postings yet' }
    });
    page.appendChild(el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon('journal-check') + ' Trial Balance' }),
        el('button.btn.btn-sm.btn-primary', { html: ui.icon('printer') + ' Print', onclick: function () { printTrial(rows, Td, Tc, balanced); } }) ]),
      el('div.card-body', null, [ t.el ])
    ]));
  }

  /* ======================================================= PARTY LEDGER */
  function partyView(page, L) {
    var parties = {};
    L.entries({ companyId: CID }).forEach(function (e) { if (e.party) parties[e.party] = true; });
    var names = Object.keys(parties).sort();
    if (!names.length) { page.appendChild(el('div.empty-state', null, [ ui.frag(ui.icon('people')), el('h3', { text: 'No party movement yet' }), el('p.text-muted', { text: 'Party postings (sales, payments) will appear here.' }) ])); return; }
    var rows = names.map(function (p) { var led = L.partyLedger(p, { companyId: CID }); var closing = led.length ? led[led.length - 1].balance : 0;
      return { party: p, txns: led.length, balance: closing, side: closing >= 0 ? 'Receivable' : 'Payable' }; });
    var t = EPAL.table({
      columns: [
        { key: 'party', label: 'Party', render: function (r) { return '<div class="flex items-center gap-1"><span class="avatar" style="width:24px;height:24px;font-size:9px;background:' + ui.colorFor(r.party) + '">' + ui.initials(r.party) + '</span><span class="strong">' + esc(r.party) + '</span></div>'; } },
        { key: 'side', label: 'Position', badge: { Receivable: 'good', Payable: 'bad' } },
        { key: 'balance', label: 'Balance', num: true, sortVal: function (r) { return r.balance; }, render: function (r) { return '<span class="num strong ' + (r.balance >= 0 ? 'text-good' : 'text-bad') + '">' + ui.money(Math.abs(r.balance)) + '</span>'; } },
        { key: 'txns', label: 'Txns', num: true }
      ],
      rows: rows, searchKeys: ['party'], quickFilter: 'side', filterPanel: true, pageSize: 15,
      exportName: 'travels-party-ledger.csv', pdfTitle: 'Party Ledger — Epal Travels',
      onRow: function (r) { partyStatementModal(L, r.party); },
      empty: { icon: 'people', title: 'No parties' }
    });
    page.appendChild(el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon('people-fill') + ' Party Ledger' }), el('span.card-sub', { text: rows.length + ' parties · click for statement' }) ]),
      el('div.card-body', null, [ t.el ])
    ]));
  }

  /* ======================================================= AR / AP AGEING */
  function ageingView(page, L, ctx, tab) {
    var kind = tab === 'ap' ? 'AP' : 'AR';
    var rows = L.aging(kind, { companyId: CID });
    var sum = rows.reduce(function (a, r) { a.current += r.current; a.d30 += r.d30; a.d60 += r.d60; a.d90 += r.d90; a.total += r.total; return a; }, { current: 0, d30: 0, d60: 0, d90: 0, total: 0 });
    page.appendChild(el('div.kpi-grid.kpi-compact.stagger', null, [
      kpi('Current', ui.money(sum.current, { compact: true }), 'clock', 'text-good'),
      kpi('1–30 days', ui.money(sum.d30, { compact: true }), 'clock-history'),
      kpi('31–60 days', ui.money(sum.d60, { compact: true }), 'hourglass-split', 'text-warn'),
      kpi('60+ days', ui.money(sum.d90, { compact: true }), 'exclamation-octagon', sum.d90 ? 'text-bad' : ''),
      kpi('Total ' + kind, ui.money(sum.total, { compact: true }), kind === 'AR' ? 'arrow-down-left-circle' : 'arrow-up-right-circle')
    ]));
    var t = EPAL.table({
      columns: [
        { key: 'party', label: 'Party', render: function (r) { return '<span class="strong">' + esc(r.party) + '</span>'; } },
        { key: 'current', label: 'Current', num: true, money: true }, { key: 'd30', label: '1–30', num: true, money: true },
        { key: 'd60', label: '31–60', num: true, money: true },
        { key: 'd90', label: '60+', num: true, render: function (r) { return r.d90 ? '<span class="num text-bad">' + ui.money(r.d90) + '</span>' : '—'; }, exportVal: function (r) { return r.d90; } },
        { key: 'total', label: 'Total', num: true, money: true }
      ],
      rows: rows, searchKeys: ['party'], pageSize: 15, exportName: 'travels-' + kind + '-ageing.csv', pdfTitle: kind + ' Ageing — Epal Travels',
      onRow: function (r) { partyStatementModal(L, r.party); },
      empty: { icon: 'check2-circle', title: 'Nothing outstanding — all settled' }
    });
    page.appendChild(el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon(kind === 'AR' ? 'arrow-down-left-circle' : 'arrow-up-right-circle') + ' ' + (kind === 'AR' ? 'Receivable' : 'Payable') + ' Ageing' }),
        el('button.btn.btn-sm.btn-primary', { html: ui.icon('printer') + ' Print', onclick: function () { printAging(kind, rows, sum); } }) ]),
      el('div.card-body', null, [ t.el ])
    ]));
  }

  /* ======================================================= BALANCE SHEET */
  function bsView(page, L) {
    var bs = L.balanceSheet(CID);
    page.appendChild(el('div.kpi-grid.kpi-compact.stagger', null, [
      kpi('Total Assets', ui.money(bs.totals.assets, { compact: true }), 'building'),
      kpi('Liabilities', ui.money(bs.totals.liabilities, { compact: true }), 'file-earmark-minus'),
      kpi('Equity', ui.money(bs.totals.equity, { compact: true }), 'piggy-bank'),
      kpi('Balance Check', bs.totals.balanced ? 'A = L + E' : 'Out of balance', bs.totals.balanced ? 'check2-circle' : 'exclamation-triangle', bs.totals.balanced ? 'text-good' : 'text-bad')
    ]));
    page.appendChild(el('div.flex.justify-end.mb-2', null, [ el('button.btn.btn-sm.btn-primary', { html: ui.icon('printer') + ' Print Balance Sheet', onclick: function () { printBalanceSheet(bs); } }) ]));
    var wrap = el('div.grid-auto');
    wrap.appendChild(sectionTable('Assets', 'building', bs.assets, bs.totals.assets));
    var right = el('div');
    right.appendChild(sectionTable('Liabilities', 'file-earmark-minus', bs.liabilities, bs.totals.liabilities));
    right.appendChild(el('div.mt-3', null, [ sectionTable('Equity', 'piggy-bank', bs.equity, bs.totals.equity) ]));
    wrap.appendChild(right);
    page.appendChild(wrap);
  }

  /* ======================================================= P&L */
  function pnlView(page, L) {
    var pl = L.pnl(CID);
    page.appendChild(el('div.kpi-grid.kpi-compact.stagger', null, [
      kpi('Revenue', ui.money(pl.revenue, { compact: true }), 'cash-coin'),
      kpi('Gross Profit', ui.money(pl.gross, { compact: true }), 'graph-up', 'text-good'),
      kpi('Expenses', ui.money(pl.expenses, { compact: true }), 'wallet2'),
      kpi('Net Profit', ui.money(pl.net, { compact: true }), pl.net >= 0 ? 'trophy' : 'exclamation-triangle', pl.net >= 0 ? 'text-good' : 'text-bad')
    ]));
    page.appendChild(el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon('graph-up-arrow') + ' Income Statement' }),
        el('button.btn.btn-sm.btn-primary', { html: ui.icon('printer') + ' Print', onclick: function () { printPnl(pl); } }) ]),
      el('div.card-body', null, [ pnlLine('Revenue', pl.revenue, false), pnlLine('Cost of Sales', -pl.cogs, false), pnlLine('Gross Profit', pl.gross, true), pnlLine('Operating Expenses', -pl.expenses, false), pnlLine('Net Profit', pl.net, true) ])
    ]));
    var t = EPAL.table({
      columns: [ { key: 'code', label: 'Code' }, { key: 'name', label: 'Account', render: function (r) { return '<span class="strong">' + esc(r.name) + '</span>'; } }, { key: 'amount', label: 'Amount', num: true, money: true } ],
      rows: pl.lines, exportName: 'travels-pnl.csv', pdfTitle: 'P&L Detail — Epal Travels', searchKeys: ['code', 'name'],
      empty: { icon: 'graph-up', title: 'No income or expense postings yet' }
    });
    page.appendChild(el('div.section-label', { text: 'Detail by Account' }));
    page.appendChild(el('div.card', null, [ el('div.card-body', null, [ t.el ]) ]));
  }

  /* ======================================================= DRILL-DOWN MODALS */
  function accountLedgerModal(L, code) {
    var acc = L.account(code), rows = L.ledgerFor(code, { companyId: CID });
    var closing = rows.length ? rows[rows.length - 1].balance : 0;
    var body = el('div');
    ui.modal({ title: (acc ? acc.code + ' · ' + acc.name : code), icon: 'journal-text', size: 'lg', body: body, footer: false });
    body.appendChild(el('div.stat-row.mb-2', null, [ st2('Type', acc ? cap(acc.type) : '—'), st2('Entries', String(rows.length)), st2('Closing', ui.money(closing)) ]));
    var t = EPAL.table({
      columns: [ { key: 'date', label: 'Date', date: true }, { key: 'ref', label: 'Ref' }, { key: 'memo', label: 'Narration' }, { key: 'party', label: 'Party' },
        { key: 'debit', label: 'Debit', num: true, render: function (r) { return r.debit ? ui.money(r.debit) : '—'; }, exportVal: function (r) { return r.debit; } },
        { key: 'credit', label: 'Credit', num: true, render: function (r) { return r.credit ? ui.money(r.credit) : '—'; }, exportVal: function (r) { return r.credit; } },
        { key: 'balance', label: 'Balance', num: true, money: true } ],
      rows: rows.slice().reverse(), pageSize: 10, exportName: 'travels-' + code + '.csv', empty: { icon: 'journal', title: 'No movement' }
    });
    body.appendChild(t.el);
    body.appendChild(el('div.flex.justify-end.mt-2', null, [ el('button.btn.btn-sm.btn-primary', { html: ui.icon('printer') + ' Statement', onclick: function () { printAccountStatement(acc, rows.slice().reverse(), closing); } }) ]));
  }
  function partyStatementModal(L, party) {
    var rows = L.partyLedger(party, { companyId: CID });
    var closing = rows.length ? rows[rows.length - 1].balance : 0;
    var body = el('div');
    ui.modal({ title: party, icon: 'person-lines-fill', size: 'lg', body: body, footer: false });
    body.appendChild(el('div.stat-row.mb-2', null, [ st2(closing >= 0 ? 'Owes Us' : 'We Owe', ui.money(Math.abs(closing))), st2('Transactions', String(rows.length)),
      st2('Position', closing >= 0 ? 'Receivable' : 'Payable') ]));
    var t = EPAL.table({
      columns: [ { key: 'date', label: 'Date', date: true }, { key: 'ref', label: 'Ref' }, { key: 'memo', label: 'Narration' },
        { key: 'source', label: 'Source', badge: { sale: 'good', manual: 'info', refund: 'bad', payment: 'accent' } },
        { key: 'debit', label: 'Debit', num: true, render: function (r) { return r.debit ? ui.money(r.debit) : '—'; }, exportVal: function (r) { return r.debit; } },
        { key: 'credit', label: 'Credit', num: true, render: function (r) { return r.credit ? ui.money(r.credit) : '—'; }, exportVal: function (r) { return r.credit; } },
        { key: 'balance', label: 'Balance', num: true, money: true } ],
      rows: rows.slice().reverse(), pageSize: 10, exportName: 'travels-' + slug(party) + '-statement.csv', empty: { icon: 'people', title: 'No transactions' },
      // checklist 04: statement searchable BOTH ways — custom (date-range via the
      // Filter card + text search) or overall; totals follow the active filter.
      searchKeys: ['ref', 'memo', 'source'], dateKey: 'date', filterPanel: true, totalKey: ['debit', 'credit']
    });
    body.appendChild(t.el);
    body.appendChild(el('div.flex.justify-end.mt-2', null, [ el('button.btn.btn-sm.btn-primary', { html: ui.icon('printer') + ' Statement', onclick: function () { printPartyStatement(party, rows.slice().reverse(), closing); } }) ]));
  }
  function journalByRef(L, ref) {
    var entries = L.entries({ companyId: CID }).filter(function (e) { return e.ref === ref; });
    var e = entries[0]; if (!e) return;
    var lines = (e.lines || []).map(function (l) { var a = L.account(l.account); return { account: l.account + ' · ' + (a ? a.name : ''), debit: +l.dr || 0, credit: +l.cr || 0 }; });
    var t = EPAL.table({ columns: [ { key: 'account', label: 'Account' }, { key: 'debit', label: 'Debit', num: true, money: true }, { key: 'credit', label: 'Credit', num: true, money: true } ], rows: lines, empty: { icon: 'journal', title: 'No lines' } });
    ui.modal({ title: 'Journal ' + e.id, icon: 'journal-text', size: 'lg',
      body: el('div', null, [ el('div.text-mute.sm.mb-2', { text: ui.date(e.date) + ' · ' + (e.memo || '') + (e.party ? ' · ' + e.party : '') + ' · ' + (e.source || '') }), t.el ]),
      actions: [{ label: 'Close', variant: 'ghost' }] });
  }

  /* ======================================================= BRANDED STATEMENTS */
  function docReady() { if (!EPAL.doc || !EPAL.doc.open) { ui.toast('Document engine unavailable', 'error'); return false; } return true; }
  function printTrial(rows, td, tc, balanced) {
    if (!docReady()) return;
    EPAL.doc.open({ type: 'document', title: 'Trial Balance', badge: balanced ? 'Balanced' : 'Unbalanced', date: TODAY_STR, companyId: CID,
      parties: [ { label: 'Entity', name: CO_NAME, lines: ['Trial Balance as at ' + ui.date(TODAY_STR)] }, { label: 'Prepared By', name: 'Travels Accounts', lines: ['Epal Group', 'Dhaka, Bangladesh'] } ],
      meta: [ { label: 'Total Debit', value: ui.money(td) }, { label: 'Total Credit', value: ui.money(tc) }, { label: 'Status', value: balanced ? 'Balanced' : 'Out by ' + ui.money(Math.abs(td - tc)) } ],
      columns: [ { key: 'code', label: 'Code' }, { key: 'name', label: 'Account' }, { key: 'debit', label: 'Debit', num: true, money: true }, { key: 'credit', label: 'Credit', num: true, money: true } ],
      rows: rows, totals: [ { label: 'Total Debit', value: td }, { label: 'Total Credit', value: tc, grand: true } ],
      terms: 'Generated by Epal Group ERP · Confidential — for internal documentation.', sign: 'Travels Accounts' });
  }
  function printAccountStatement(acc, rows, closing) {
    if (!docReady()) return;
    EPAL.doc.open({ type: 'document', title: (acc ? acc.name : 'Account') + ' — Account Statement', badge: acc ? acc.code : '', date: TODAY_STR, companyId: CID,
      parties: [ { label: 'Account', name: (acc ? acc.code + ' · ' + acc.name : ''), lines: ['General Ledger'] }, { label: 'Entity', name: CO_NAME, lines: ['Dhaka, Bangladesh'] } ],
      meta: [ { label: 'Account Type', value: acc ? acc.type : '' }, { label: 'Closing Balance', value: ui.money(closing) } ],
      columns: [ { key: 'date', label: 'Date' }, { key: 'ref', label: 'Reference' }, { key: 'memo', label: 'Narration' }, { key: 'debit', label: 'Debit', num: true, money: true }, { key: 'credit', label: 'Credit', num: true, money: true }, { key: 'balance', label: 'Balance', num: true, money: true } ],
      rows: rows.map(fmtRow), totals: [ { label: 'Closing Balance', value: closing, grand: true } ], sign: 'Travels Accounts' });
  }
  function printPartyStatement(party, rows, closing) {
    if (!docReady()) return;
    EPAL.doc.open({ type: 'invoice', title: 'Statement of Account', badge: closing >= 0 ? 'Receivable' : 'Payable', date: TODAY_STR, companyId: CID, amount: Math.abs(closing), party: party,
      parties: [ { label: 'Statement For', name: party, lines: ['As at ' + ui.date(TODAY_STR)] }, { label: 'Issued By', name: CO_NAME, lines: ['Accounts Department', 'Dhaka, Bangladesh'] } ],
      meta: [ { label: 'Statement Date', value: ui.date(TODAY_STR) }, { label: closing >= 0 ? 'Balance Receivable' : 'Balance Payable', value: ui.money(Math.abs(closing)) } ],
      columns: [ { key: 'date', label: 'Date' }, { key: 'ref', label: 'Reference' }, { key: 'memo', label: 'Narration' }, { key: 'debit', label: 'Debit', num: true, money: true }, { key: 'credit', label: 'Credit', num: true, money: true }, { key: 'balance', label: 'Balance', num: true, money: true } ],
      rows: rows.map(fmtRow), totals: [ { label: closing >= 0 ? 'Total Receivable' : 'Total Payable', value: Math.abs(closing), grand: true } ],
      words: EPAL.doc.amountInWords ? EPAL.doc.amountInWords(Math.round(Math.abs(closing))) : '',
      terms: 'Please reconcile against your records and settle any outstanding balance at your earliest convenience. E&OE.', sign: 'Accounts Department' });
  }
  function printAging(kind, rows, sum) {
    if (!docReady()) return;
    EPAL.doc.open({ type: 'document', title: (kind === 'AP' ? 'Accounts Payable' : 'Accounts Receivable') + ' Ageing', badge: kind, date: TODAY_STR, companyId: CID,
      parties: [ { label: 'Entity', name: CO_NAME, lines: ['Ageing as at ' + ui.date(TODAY_STR)] }, { label: 'Prepared By', name: 'Travels Credit Control', lines: ['Epal Group'] } ],
      meta: [ { label: 'Current', value: ui.money(sum.current) }, { label: '31–60 days', value: ui.money(sum.d60) }, { label: '60+ days', value: ui.money(sum.d90) }, { label: 'Total ' + kind, value: ui.money(sum.total) } ],
      columns: [ { key: 'party', label: 'Party' }, { key: 'current', label: 'Current', num: true, money: true }, { key: 'd30', label: '1–30', num: true, money: true }, { key: 'd60', label: '31–60', num: true, money: true }, { key: 'd90', label: '60+', num: true, money: true }, { key: 'total', label: 'Total', num: true, money: true } ],
      rows: rows, totals: [ { label: 'Total ' + kind + ' Outstanding', value: sum.total, grand: true } ],
      terms: 'Ageing computed FIFO from open ledger invoices. E&OE.', sign: 'Travels Credit Control' });
  }
  function printBalanceSheet(bs) {
    if (!docReady()) return;
    var rows = [];
    bs.assets.forEach(function (a) { rows.push({ section: 'Assets', name: a.code + ' · ' + a.name, amount: a.amount }); });
    bs.liabilities.forEach(function (a) { rows.push({ section: 'Liabilities', name: a.code + ' · ' + a.name, amount: a.amount }); });
    bs.equity.forEach(function (a) { rows.push({ section: 'Equity', name: a.code + ' · ' + a.name, amount: a.amount }); });
    EPAL.doc.open({ type: 'document', title: 'Balance Sheet', badge: bs.totals.balanced ? 'Balanced' : 'Unbalanced', date: TODAY_STR, companyId: CID,
      parties: [ { label: 'Entity', name: CO_NAME, lines: ['As at ' + ui.date(TODAY_STR)] }, { label: 'Prepared By', name: 'Travels Accounts', lines: ['Epal Group'] } ],
      meta: [ { label: 'Total Assets', value: ui.money(bs.totals.assets) }, { label: 'Total Liabilities', value: ui.money(bs.totals.liabilities) }, { label: 'Total Equity', value: ui.money(bs.totals.equity) } ],
      columns: [ { key: 'section', label: 'Section' }, { key: 'name', label: 'Account' }, { key: 'amount', label: 'Amount', num: true, money: true } ],
      rows: rows, totals: [ { label: 'Total Assets', value: bs.totals.assets }, { label: 'Liabilities + Equity', value: bs.totals.liabilities + bs.totals.equity, grand: true } ],
      terms: 'Prepared on the double-entry ledger. Current-year earnings folded into equity. E&OE.', sign: 'Travels Accounts' });
  }
  function printPnl(pl) {
    if (!docReady()) return;
    EPAL.doc.open({ type: 'document', title: 'Profit & Loss Statement', badge: pl.net >= 0 ? 'Profit' : 'Loss', date: TODAY_STR, companyId: CID,
      parties: [ { label: 'Entity', name: CO_NAME, lines: ['Income Statement to ' + ui.date(TODAY_STR)] }, { label: 'Prepared By', name: 'Travels Accounts', lines: ['Epal Group'] } ],
      meta: [ { label: 'Revenue', value: ui.money(pl.revenue) }, { label: 'Gross Profit', value: ui.money(pl.gross) }, { label: 'Net Profit', value: ui.money(pl.net) } ],
      columns: [ { key: 'code', label: 'Code' }, { key: 'name', label: 'Account' }, { key: 'amount', label: 'Amount', num: true, money: true } ],
      rows: pl.lines, totals: [ { label: 'Gross Profit', value: pl.gross }, { label: 'Net Profit', value: pl.net, grand: true } ],
      terms: 'Generated by Epal Group ERP from the live ledger · Confidential.', sign: 'Travels Accounts' });
  }
  function fmtRow(r) { return { date: ui.date(r.date), ref: r.ref, memo: r.memo, debit: r.debit ? ui.money(r.debit) : '', credit: r.credit ? ui.money(r.credit) : '', balance: ui.money(r.balance) }; }

  /* ---------------------------------------------------- helpers */
  function safeBal(L, code) { try { return L.balance(code, { companyId: CID }) || 0; } catch (e) { return 0; } }
  function esc(s) { return ui.escapeHtml(String(s == null ? '' : s)); }
  function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }
  function slug(s) { return String(s).replace(/[^a-z0-9]+/gi, '-').toLowerCase(); }
  function kpi(label, value, icon, tone) {
    return el('div.kpi-card', null, [ el('div.kpi-top', null, [ el('span.kpi-label', { text: label }), el('span.kpi-ico', { html: '<i class="bi bi-' + icon + '"></i>' }) ]),
      el('div.kpi-value' + (tone ? '.' + tone : ''), { text: String(value) }) ]);
  }
  function kpiDrill(label, value, icon, tab, foot) {
    return el('div.kpi-card.drill', { onclick: function () { EPAL.router.navigate('travels/ledgers', { tab: tab }); } }, [
      el('div.kpi-top', null, [ el('span.kpi-label', { text: label }), el('span.kpi-ico', { html: '<i class="bi bi-' + icon + '"></i>' }) ]),
      el('div.kpi-value', { text: String(value) }), foot ? el('div.kpi-foot', null, [ el('span.text-muted', { text: foot }) ]) : null ]);
  }
  function st2(l, v) { return el('div.stat', null, [ el('div.stat-label', { text: l }), el('div.stat-value', { text: v }) ]); }
  function pnlLine(label, val, strong) {
    return el('div.flex.justify-between.items-center' + (strong ? '.strong' : ''), { style: { padding: '9px 4px', borderBottom: '1px solid rgba(150,150,170,.14)' } },
      [ el('span', { text: label }), el('span.num', { style: strong && val < 0 ? { color: '#f0506e' } : null, text: ui.money(val) }) ]);
  }
  function sectionTable(title, icon, items, total) {
    var t = EPAL.table({ columns: [ { key: 'code', label: 'Code' }, { key: 'name', label: 'Account', render: function (r) { return '<span class="strong">' + esc(r.name) + '</span>'; } }, { key: 'amount', label: 'Amount', num: true, money: true } ],
      rows: items, exportName: 'travels-' + slug(title) + '.csv', empty: { icon: 'dash-circle', title: 'None' } });
    return el('div.card', null, [ el('div.card-head', null, [ el('h3', { html: ui.icon(icon) + ' ' + title }), el('span.card-sub', { text: ui.money(total) }) ]), el('div.card-body', null, [ t.el ]) ]);
  }
  function chartCard(title, icon, canvasId, subLabel, height) {
    return el('div.card', null, [ el('div.card-head', null, [ el('h3', { html: ui.icon(icon) + ' ' + title }), subLabel ? el('span.card-sub', { text: subLabel }) : null ]),
      el('div.card-body', null, [ el('div', { style: { height: (height || 260) + 'px', position: 'relative' } }, [ el('canvas', { id: canvasId }) ]) ]) ]);
  }

})(window.EPAL = window.EPAL || {});
