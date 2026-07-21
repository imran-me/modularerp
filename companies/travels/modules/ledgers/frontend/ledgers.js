/* ============================================================================
 * TRAVELS · LEDGERS · LOGIC
 * ----------------------------------------------------------------------------
 * Behaviour only — markup lives in frontend/template.html and is handed to this
 * file (by tools/build/build-module.mjs) as the string TEMPLATE_HTML. This file
 * is NOT an IIFE and has no 'use strict' of its own: the build wraps it.
 *
 * The double-entry books of Epal Travels, read straight off EPAL.ledger: a
 * snapshot cockpit plus General Ledger, Trial Balance, Party subledgers, AR/AP
 * ageing, Balance Sheet and P&L — tabs driven by ?tab=. The drill-down modals,
 * the receive-payment cashier and every branded PDF keep their legacy el()-built
 * DOM. Never write a literal star-slash in this comment block.
 * ==> LARAVEL: a LedgerController reading the LedgerService; DocumentService PDFs.
 * ========================================================================== */

var EPAL = window.EPAL, ui = EPAL.ui, el = ui.el, db = EPAL.db;

/* ---- template plumbing: clone a fragment, address its fill-slots ---------- */
var TPL = document.createElement('div');
TPL.innerHTML = TEMPLATE_HTML;
function frag(name) {
  var t = TPL.querySelector('template[data-tpl="' + name + '"]');
  return t.content.firstElementChild.cloneNode(true);
}
function slot(root, name) { return root.querySelector('[data-slot="' + name + '"]'); }

var CID = 'travels';
var CO_NAME = 'Epal Travels & Consultancy';
var TODAY_STR = '2026-07-05';

var TABS = [['overview', 'Overview'], ['general', 'General Ledger'], ['trial', 'Trial Balance'], ['party', 'Party Ledger'],
  ['ar', 'AR Ageing'], ['ap', 'AP Ageing'], ['bs', 'Balance Sheet'], ['pnl', 'P&L']];

/* one KPI card + drill KPI card + chart card + build-banner ---------------- */
function kpi(label, value, icon, tone) {
  var n = frag('kpi'); slot(n, 'label').textContent = label; slot(n, 'ico').innerHTML = '<i class="bi bi-' + icon + '"></i>';
  var v = slot(n, 'value'); if (tone) v.classList.add(tone); v.textContent = String(value); return n;
}
function kpiDrill(label, value, icon, tab, foot) {
  var n = frag('kpi-drill'); n.addEventListener('click', function () { EPAL.router.navigate('travels/ledgers', { tab: tab }); });
  slot(n, 'label').textContent = label; slot(n, 'ico').innerHTML = '<i class="bi bi-' + icon + '"></i>'; slot(n, 'value').textContent = String(value);
  var f = slot(n, 'foot'); if (foot) f.appendChild(el('span.text-muted', { text: foot })); else f.remove(); return n;
}
function chartCard(title, icon, canvasId, subLabel, height) {
  var c = frag('chart-card'); slot(c, 'title').innerHTML = ui.icon(icon) + ' ' + title;
  var sub = slot(c, 'sub'); if (subLabel) sub.textContent = subLabel; else sub.remove();
  slot(c, 'box').style.height = (height || 260) + 'px'; slot(c, 'canvas').id = canvasId; return c;
}
function buildBanner(icon, html) { var b = frag('build-banner'); slot(b, 'ico').classList.add('bi-' + icon); slot(b, 'msg').innerHTML = html; return b; }

function sectionNav(tab) {
  var nav = frag('nav');
  TABS.forEach(function (p) {
    var btn = frag('nav-btn'); if (tab === p[0]) btn.classList.add('active'); btn.textContent = p[1];
    btn.addEventListener('click', function () { EPAL.router.navigate('travels/ledgers', { tab: p[0] }); });
    nav.appendChild(btn);
  });
  return nav;
}

EPAL.view('travels/ledgers', {
  render: function (ctx) {
    var L = EPAL.ledger;
    var tab = (ctx.params && ctx.params.tab) || 'overview';
    if (!TABS.some(function (t) { return t[0] === tab; })) tab = 'overview';
    var page = frag('page');
    page.appendChild(EPAL.pageHead({
      eyebrow: tab === 'overview' ? 'Epal Travels' : 'Travels › Ledgers', icon: 'journal-text',
      title: tab === 'overview' ? 'Ledgers' : (TABS.filter(function (t) { return t[0] === tab; })[0][1]),
      sub: 'Real double-entry general ledger, trial balance, party subledgers, ageing and statements for Epal Travels.',
      actions: [ el('a.btn.btn-ghost', { href: '#/travels/accounts', html: ui.icon('cash-stack') + ' Accounts' }) ]
    }));
    if (!L) { var c = frag('card-body-card'); slot(c, 'body').appendChild(el('p.text-mute', { text: 'The ledger engine is not available.' })); page.appendChild(c); ctx.mount.appendChild(page); return; }

    page.appendChild(sectionNav(tab));
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

  var grid = frag('kpi-grid');
  grid.appendChild(kpiDrill('Revenue', ui.money(pl.revenue, { compact: true }), 'cash-coin', 'pnl'));
  grid.appendChild(kpi('Net Profit', ui.money(pl.net, { compact: true }), pl.net >= 0 ? 'trophy' : 'exclamation-triangle', pl.net >= 0 ? 'text-good' : 'text-bad'));
  grid.appendChild(kpi('Cash & Bank', ui.money(cash, { compact: true }), 'bank2'));
  grid.appendChild(kpiDrill('Receivable', ui.money(arTot, { compact: true }), 'arrow-down-left-circle', 'ar', arOverdue ? ui.money(arOverdue, { compact: true }) + ' overdue' : 'all current'));
  grid.appendChild(kpiDrill('Payable', ui.money(apTot, { compact: true }), 'arrow-up-right-circle', 'ap', apOverdue ? ui.money(apOverdue, { compact: true }) + ' overdue' : 'all current'));
  grid.appendChild(kpi('Total Assets', ui.money(bs.totals.assets, { compact: true }), 'building'));
  page.appendChild(grid);

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
  var lbl1 = frag('section-label'); lbl1.textContent = 'Action Center — needs attention'; page.appendChild(lbl1);
  if (acts.length) {
    var acard = frag('card-body-card'); var abody = slot(acard, 'body');
    acts.forEach(function (a) {
      var row = frag('action-row');
      var ico = slot(row, 'ico'); ico.classList.add('notif-' + a.tone); ico.innerHTML = ui.icon(a.icon);
      slot(row, 'text').innerHTML = a.text;
      row.addEventListener('click', (function (go) { return function () { EPAL.router.navigate('travels/ledgers', { tab: go }); }; })(a.go));
      abody.appendChild(row);
    });
    page.appendChild(acard);
  } else {
    page.appendChild(buildBanner('check-circle-fill', '<strong>Books are clean.</strong> Trial balance and balance sheet both balance; nothing seriously overdue.'));
  }

  // income statement snapshot + assets/claims chart
  var lbl2 = frag('section-label'); lbl2.textContent = 'Financial Snapshot'; page.appendChild(lbl2);
  var pId = ui.uid('bsmix');
  var row2 = frag('grid-auto');
  var incCard = frag('reg-card');
  slot(incCard, 'title').innerHTML = ui.icon('graph-up-arrow') + ' Income Statement';
  slot(incCard, 'sub').textContent = 'live ledger P&L';
  var incBody = slot(incCard, 'body');
  incBody.appendChild(pnlLine('Revenue', pl.revenue, false));
  incBody.appendChild(pnlLine('Cost of Sales', -pl.cogs, false));
  incBody.appendChild(pnlLine('Gross Profit', pl.gross, true));
  incBody.appendChild(pnlLine('Operating Expenses', -pl.expenses, false));
  incBody.appendChild(pnlLine('Net Profit', pl.net, true));
  row2.appendChild(incCard);
  row2.appendChild(chartCard('Assets vs Claims', 'pie-chart', pId, 'A = L + E', 240));
  page.appendChild(row2);
  requestAnimationFrame(function () { var c = document.getElementById(pId); if (!c) return;
    EPAL.charts.doughnut(c, { labels: ['Assets', 'Liabilities', 'Equity'], data: [bs.totals.assets, bs.totals.liabilities, bs.totals.equity], colors: ['#1A43BF', '#f4b740', '#23c17e'] }); });
}

/* ======================================================= GENERAL LEDGER */
function generalView(page, L, ctx) {
  var used = {};
  L.entries({ companyId: CID }).forEach(function (e) { (e.lines || []).forEach(function (l) { used[l.account] = true; }); });
  var gAccts = L.accounts().filter(function (a) { return used[a.code]; });
  if (!gAccts.length) gAccts = L.accounts();
  var scard = frag('select-card');
  var sel = slot(scard, 'sel');
  gAccts.forEach(function (a) { sel.appendChild(el('option', { value: a.code, text: a.code + ' · ' + a.name })); });
  var code = (ctx.params && ctx.params.code) || gAccts[0].code;
  sel.value = code;
  var body = el('div.mt-3');
  sel.addEventListener('change', function () { draw(sel.value); });
  page.appendChild(scard);
  page.appendChild(body);
  draw(code);

  function draw(code) {
    body.innerHTML = '';
    var acc = L.account(code), rows = L.ledgerFor(code, { companyId: CID });
    var td = 0, tc = 0; rows.forEach(function (r) { td += r.debit; tc += r.credit; });
    var closing = rows.length ? rows[rows.length - 1].balance : 0;
    var grid = frag('kpi-grid-plain');
    grid.appendChild(kpi('Total Debit', ui.money(td, { compact: true }), 'arrow-up-right-circle'));
    grid.appendChild(kpi('Total Credit', ui.money(tc, { compact: true }), 'arrow-down-left-circle'));
    grid.appendChild(kpi('Closing Balance', ui.money(closing, { compact: true }), 'wallet2'));
    grid.appendChild(kpi('Entries', String(rows.length), 'list-ol'));
    body.appendChild(grid);
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
    var card = frag('head-btn-card');
    slot(card, 'title').innerHTML = ui.icon('journal-text') + ' ' + (acc ? acc.code + ' · ' + acc.name : code);
    slot(card, 'action').replaceWith(el('button.btn.btn-sm.btn-primary', { html: ui.icon('printer') + ' Statement', onclick: function () { printAccountStatement(acc, rows.slice().reverse(), closing); } }));
    slot(card, 'body').appendChild(t.el);
    body.appendChild(card);
  }
}

/* ======================================================= TRIAL BALANCE */
function trialView(page, L) {
  var rows = L.trialBalance(CID); var Td = 0, Tc = 0; rows.forEach(function (r) { Td += r.debit; Tc += r.credit; });
  var balanced = Math.abs(Td - Tc) < 1;
  var grid = frag('kpi-grid');
  grid.appendChild(kpi('Total Debit', ui.money(Td, { compact: true }), 'arrow-up-right-circle'));
  grid.appendChild(kpi('Total Credit', ui.money(Tc, { compact: true }), 'arrow-down-left-circle'));
  grid.appendChild(kpi('Accounts', String(rows.length), 'list-ol'));
  grid.appendChild(kpi('Balance Check', balanced ? 'Balanced' : 'Out by ' + ui.money(Math.abs(Td - Tc)), balanced ? 'check2-circle' : 'exclamation-triangle', balanced ? 'text-good' : 'text-bad'));
  page.appendChild(grid);
  if (!balanced) page.appendChild(buildBanner('exclamation-triangle-fill', '<strong>Trial balance is out by ' + ui.money(Math.abs(Td - Tc)) + '.</strong> A posting is unbalanced — review recent journals.'));
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
  var card = frag('head-btn-card');
  slot(card, 'title').innerHTML = ui.icon('journal-check') + ' Trial Balance';
  slot(card, 'action').replaceWith(el('button.btn.btn-sm.btn-primary', { html: ui.icon('printer') + ' Print', onclick: function () { printTrial(rows, Td, Tc, balanced); } }));
  slot(card, 'body').appendChild(t.el);
  page.appendChild(card);
}

/* ======================================================= PARTY LEDGER */
function partyView(page, L) {
  var parties = {};
  L.entries({ companyId: CID }).forEach(function (e) { if (e.party) parties[e.party] = true; });
  var names = Object.keys(parties).sort();
  if (!names.length) { page.appendChild(frag('party-empty')); return; }
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
  var card = frag('reg-card');
  slot(card, 'title').innerHTML = ui.icon('people-fill') + ' Party Ledger';
  slot(card, 'sub').textContent = rows.length + ' parties · click for statement';
  slot(card, 'body').appendChild(t.el);
  page.appendChild(card);
}

/* ======================================================= AR / AP AGEING */
function ageingView(page, L, ctx, tab) {
  var kind = tab === 'ap' ? 'AP' : 'AR';
  var rows = L.aging(kind, { companyId: CID });
  var sum = rows.reduce(function (a, r) { a.current += r.current; a.d30 += r.d30; a.d60 += r.d60; a.d90 += r.d90; a.total += r.total; return a; }, { current: 0, d30: 0, d60: 0, d90: 0, total: 0 });
  var grid = frag('kpi-grid');
  grid.appendChild(kpi('Current', ui.money(sum.current, { compact: true }), 'clock', 'text-good'));
  grid.appendChild(kpi('1–30 days', ui.money(sum.d30, { compact: true }), 'clock-history'));
  grid.appendChild(kpi('31–60 days', ui.money(sum.d60, { compact: true }), 'hourglass-split', 'text-warn'));
  grid.appendChild(kpi('60+ days', ui.money(sum.d90, { compact: true }), 'exclamation-octagon', sum.d90 ? 'text-bad' : ''));
  grid.appendChild(kpi('Total ' + kind, ui.money(sum.total, { compact: true }), kind === 'AR' ? 'arrow-down-left-circle' : 'arrow-up-right-circle'));
  page.appendChild(grid);
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
  var card = frag('head-btn-card');
  slot(card, 'title').innerHTML = ui.icon(kind === 'AR' ? 'arrow-down-left-circle' : 'arrow-up-right-circle') + ' ' + (kind === 'AR' ? 'Receivable' : 'Payable') + ' Ageing';
  slot(card, 'action').replaceWith(el('button.btn.btn-sm.btn-primary', { html: ui.icon('printer') + ' Print', onclick: function () { printAging(kind, rows, sum); } }));
  slot(card, 'body').appendChild(t.el);
  page.appendChild(card);
}

/* ======================================================= BALANCE SHEET */
function bsView(page, L) {
  var bs = L.balanceSheet(CID);
  var grid = frag('kpi-grid');
  grid.appendChild(kpi('Total Assets', ui.money(bs.totals.assets, { compact: true }), 'building'));
  grid.appendChild(kpi('Liabilities', ui.money(bs.totals.liabilities, { compact: true }), 'file-earmark-minus'));
  grid.appendChild(kpi('Equity', ui.money(bs.totals.equity, { compact: true }), 'piggy-bank'));
  grid.appendChild(kpi('Balance Check', bs.totals.balanced ? 'A = L + E' : 'Out of balance', bs.totals.balanced ? 'check2-circle' : 'exclamation-triangle', bs.totals.balanced ? 'text-good' : 'text-bad'));
  page.appendChild(grid);
  var prow = frag('print-row');
  var pbtn = slot(prow, 'btn'); pbtn.innerHTML = ui.icon('printer') + ' Print Balance Sheet'; pbtn.addEventListener('click', function () { printBalanceSheet(bs); });
  page.appendChild(prow);
  var wrap = frag('grid-auto');
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
  var grid = frag('kpi-grid');
  grid.appendChild(kpi('Revenue', ui.money(pl.revenue, { compact: true }), 'cash-coin'));
  grid.appendChild(kpi('Gross Profit', ui.money(pl.gross, { compact: true }), 'graph-up', 'text-good'));
  grid.appendChild(kpi('Expenses', ui.money(pl.expenses, { compact: true }), 'wallet2'));
  grid.appendChild(kpi('Net Profit', ui.money(pl.net, { compact: true }), pl.net >= 0 ? 'trophy' : 'exclamation-triangle', pl.net >= 0 ? 'text-good' : 'text-bad'));
  page.appendChild(grid);
  var card = frag('head-btn-card');
  slot(card, 'title').innerHTML = ui.icon('graph-up-arrow') + ' Income Statement';
  slot(card, 'action').replaceWith(el('button.btn.btn-sm.btn-primary', { html: ui.icon('printer') + ' Print', onclick: function () { printPnl(pl); } }));
  var pbody = slot(card, 'body');
  pbody.appendChild(pnlLine('Revenue', pl.revenue, false));
  pbody.appendChild(pnlLine('Cost of Sales', -pl.cogs, false));
  pbody.appendChild(pnlLine('Gross Profit', pl.gross, true));
  pbody.appendChild(pnlLine('Operating Expenses', -pl.expenses, false));
  pbody.appendChild(pnlLine('Net Profit', pl.net, true));
  page.appendChild(card);
  var t = EPAL.table({
    columns: [ { key: 'code', label: 'Code' }, { key: 'name', label: 'Account', render: function (r) { return '<span class="strong">' + esc(r.name) + '</span>'; } }, { key: 'amount', label: 'Amount', num: true, money: true } ],
    rows: pl.lines, exportName: 'travels-pnl.csv', pdfTitle: 'P&L Detail — Epal Travels', searchKeys: ['code', 'name'],
    empty: { icon: 'graph-up', title: 'No income or expense postings yet' }
  });
  var lbl = frag('section-label'); lbl.textContent = 'Detail by Account'; page.appendChild(lbl);
  var dcard = frag('card-body-card'); slot(dcard, 'body').appendChild(t.el); page.appendChild(dcard);
}

/* ======================================================= DRILL-DOWN MODALS (legacy el()) */
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
function receivePaymentForm(L, party, closing, modal) {
  var receivable = closing >= 0;
  var isVendor = db.col('vendors').some(function (v) { return v.name === party; });
  var isAgent = db.col('tv_agents').some(function (a) { return a.name === party; });
  var ctrl = receivable ? (isAgent ? '1150' : '1200') : '2000';
  EPAL.formModal({
    title: (receivable ? 'Receive Payment — ' : 'Pay Vendor — ') + party, icon: 'cash-coin', size: 'sm',
    record: { amount: Math.abs(closing), date: TODAY_STR, method: 'Bank' },
    fields: [
      { key: 'amount', label: (receivable ? 'Amount received (৳)' : 'Amount paid (৳)'), type: 'money', required: true, min: 1, max: Math.abs(closing),
        hint: 'Open ' + (receivable ? 'receivable' : 'payable') + ': ' + ui.money(Math.abs(closing)) + ' — a smaller amount records a part payment.' },
      { key: 'method', label: 'Method', type: 'select', options: ['Bank', 'Cash', 'bKash', 'Nagad', 'Cheque'], default: 'Bank' },
      { key: 'date', label: 'Date', type: 'date', default: TODAY_STR },
      { key: 'note', label: 'Reference / note', type: 'text' }
    ],
    saveLabel: receivable ? 'Receive Payment' : 'Post Payment',
    onSave: function (v) {
      var amt = Math.min(+v.amount || 0, Math.abs(closing));
      if (amt <= 0) { ui.toast('Enter the amount', 'error'); return false; }
      var cashAcct = v.method === 'Cash' ? '1000' : '1010';
      var lines = receivable
        ? [ { account: cashAcct, dr: amt, cr: 0 }, { account: ctrl, dr: 0, cr: amt } ]
        : [ { account: ctrl, dr: amt, cr: 0 }, { account: cashAcct, dr: 0, cr: amt } ];
      try {
        L.post({ id: 'GL-RCPT-' + ui.uid('').slice(-6), date: v.date, companyId: CID, ref: v.note || ('PMT-' + party),
          memo: (receivable ? 'Payment received from ' : 'Payment made to ') + party + (v.note ? ' · ' + v.note : ''),
          source: 'payment', party: party, lines: lines });
        ui.toast((receivable ? 'Received ' : 'Paid ') + ui.money(amt) + ' · ' + v.method, 'success');
        if (modal) modal.close();
        EPAL.router.render();
        setTimeout(function () { partyStatementModal(L, party); }, 60);
        return true;
      } catch (e) { ui.toast(e.message || 'Failed', 'error'); return false; }
    }
  });
}
function partyStatementModal(L, party) {
  var rows = L.partyLedger(party, { companyId: CID });
  var closing = rows.length ? rows[rows.length - 1].balance : 0;
  var body = el('div');
  var m = ui.modal({ title: party, icon: 'person-lines-fill', size: 'lg', body: body, footer: false });
  body.appendChild(el('div.flex.items-center.gap-2.flex-wrap.mb-2', null, [
    el('div.stat-row.flex-1', null, [ st2(closing >= 0 ? 'Owes Us' : 'We Owe', ui.money(Math.abs(closing))), st2('Transactions', String(rows.length)),
      st2('Position', closing >= 0 ? 'Receivable' : 'Payable') ]),
    (Math.abs(closing) > 0.5 && (!EPAL.perm || EPAL.perm.can(CID, 'ledgers', 'create')))
      ? el('button.btn.btn-sm.btn-primary', { html: ui.icon('cash-coin') + (closing >= 0 ? ' Receive Payment' : ' Pay Vendor'), onclick: function () { receivePaymentForm(L, party, closing, m); } })
      : null
  ]));
  var t = EPAL.table({
    columns: [ { key: 'date', label: 'Date', date: true }, { key: 'ref', label: 'Ref' }, { key: 'memo', label: 'Narration' },
      { key: 'source', label: 'Source', badge: { sale: 'good', manual: 'info', refund: 'bad', payment: 'accent' } },
      { key: 'debit', label: 'Debit', num: true, render: function (r) { return r.debit ? ui.money(r.debit) : '—'; }, exportVal: function (r) { return r.debit; } },
      { key: 'credit', label: 'Credit', num: true, render: function (r) { return r.credit ? ui.money(r.credit) : '—'; }, exportVal: function (r) { return r.credit; } },
      { key: 'balance', label: 'Balance', num: true, money: true } ],
    rows: rows.slice().reverse(), pageSize: 10, exportName: 'travels-' + slug(party) + '-statement.csv', empty: { icon: 'people', title: 'No transactions' },
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
function st2(l, v) { return el('div.stat', null, [ el('div.stat-label', { text: l }), el('div.stat-value', { text: v }) ]); }
function pnlLine(label, val, strong) {
  return el('div.flex.justify-between.items-center' + (strong ? '.strong' : ''), { style: { padding: '9px 4px', borderBottom: '1px solid rgba(150,150,170,.14)' } },
    [ el('span', { text: label }), el('span.num', { style: strong && val < 0 ? { color: '#f0506e' } : null, text: ui.money(val) }) ]);
}
function sectionTable(title, icon, items, total) {
  var t = EPAL.table({ columns: [ { key: 'code', label: 'Code' }, { key: 'name', label: 'Account', render: function (r) { return '<span class="strong">' + esc(r.name) + '</span>'; } }, { key: 'amount', label: 'Amount', num: true, money: true } ],
    rows: items, exportName: 'travels-' + slug(title) + '.csv', empty: { icon: 'dash-circle', title: 'None' } });
  var card = frag('reg-card');
  slot(card, 'title').innerHTML = ui.icon(icon) + ' ' + title;
  slot(card, 'sub').textContent = ui.money(total);
  slot(card, 'body').appendChild(t.el);
  return card;
}
