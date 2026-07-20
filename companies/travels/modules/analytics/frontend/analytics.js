/* ============================================================================
 * TRAVELS · ANALYTICS & INTELLIGENCE · LOGIC
 * ----------------------------------------------------------------------------
 * Behaviour only — markup lives in frontend/template.html and is handed to this
 * file (by tools/build/build-module.mjs) as the string TEMPLATE_HTML. This file
 * is NOT an IIFE and has no 'use strict' of its own: the build wraps it.
 *
 * The forward-looking, signal-finding view: revenue trend + forecast, a Profit-
 * Leak scanner, a Fraud Sentinel, and Travel-DNA (customer RFM + service mix +
 * seasonality). ONE registered view branches on ctx.subId; all heuristics are
 * transparent and computed from live data (sales register + journal). Charts via
 * EPAL.charts; datatables via EPAL.table. Never write a literal star-slash here.
 * ==> LARAVEL: an AnalyticsController backed by the IntelligenceService.
 * ========================================================================== */

var EPAL = window.EPAL, ui = EPAL.ui, el = ui.el, db = EPAL.db;
var CID = 'travels';
var ACCENT = '#2f6bff';

/* ---- template plumbing: clone a fragment, address its fill-slots ---------- */
var TPL = document.createElement('div');
TPL.innerHTML = TEMPLATE_HTML;
function frag(name) {
  var t = TPL.querySelector('template[data-tpl="' + name + '"]');
  return t.content.firstElementChild.cloneNode(true);
}
function slot(root, name) { return root.querySelector('[data-slot="' + name + '"]'); }

function sales() { return db.sales ? db.sales(CID) : []; }
function expenses() { return db.col('acc_entries').filter(function (e) { return e.companyId === CID && e.kind === 'Expense'; }); }

/* one KPI card (tone applied to the value) */
function kpi(label, value, icon, tone) {
  var n = frag('kpi');
  slot(n, 'label').textContent = label;
  slot(n, 'ico').innerHTML = '<i class="bi bi-' + icon + '"></i>';
  var v = slot(n, 'value'); if (tone) v.classList.add(tone); v.textContent = String(value);
  return n;
}
/* chart card: head (icon+title, optional sub) + body (relative box + canvas) */
function chartCard(title, icon, canvasId, subLabel, height) {
  var c = frag('chart-card');
  slot(c, 'title').innerHTML = ui.icon(icon) + ' ' + title;
  var sub = slot(c, 'sub'); if (subLabel) sub.textContent = subLabel; else sub.remove();
  slot(c, 'box').style.height = (height || 260) + 'px';
  slot(c, 'canvas').id = canvasId;
  return c;
}
/* build-banner: a bi icon + an html message */
function buildBanner(icon, html) {
  var b = frag('build-banner');
  slot(b, 'ico').classList.add('bi-' + icon);
  slot(b, 'msg').innerHTML = html;
  return b;
}

/* ==========================================================================
 * VIEW ENTRY
 * ========================================================================*/
EPAL.view('travels/analytics', {
  render: function (ctx) {
    var sub = ctx.subId || 'overview';
    if (['overview', 'profit-leak', 'fraud', 'travel-dna'].indexOf(sub) < 0) sub = 'overview';
    var page = frag('page');
    var titles = { overview: 'Analytics & Intelligence', 'profit-leak': 'Profit Leak', fraud: 'Fraud Sentinel', 'travel-dna': 'Travel DNA' };
    var subs = { overview: 'Trends, forecast and drivers for Epal Travels — the forward-looking view.',
      'profit-leak': 'Where margin is quietly bleeding — low-margin and loss-making business.',
      fraud: 'Anomaly sentinel — the transactions that deserve a second look.',
      'travel-dna': 'Who your travellers are — RFM segments, service mix and seasonality.' };
    page.appendChild(EPAL.pageHead({
      eyebrow: sub === 'overview' ? 'Epal Travels' : 'Travels › Analytics', icon: 'graph-up', title: titles[sub], sub: subs[sub],
      actions: [ el('a.btn.btn-ghost', { href: '#/travels/reports', html: ui.icon('file-earmark-bar-graph') + ' Reports' }) ]
    }));
    // SECTION NAV — the house full-bleed underline band
    var pills = frag('nav');
    [['overview', 'Overview'], ['profit-leak', 'Profit Leak'], ['fraud', 'Fraud Sentinel'], ['travel-dna', 'Travel DNA']].forEach(function (p) {
      var btn = frag('nav-btn');
      if (sub === p[0]) btn.classList.add('active');
      btn.textContent = p[1];
      btn.addEventListener('click', function () { EPAL.router.navigate('travels/analytics' + (p[0] === 'overview' ? '' : '/' + p[0])); });
      pills.appendChild(btn);
    });
    page.appendChild(pills);
    ({ overview: overview, 'profit-leak': profitLeak, fraud: fraudSentinel, 'travel-dna': travelDna }[sub])(page);
    ctx.mount.appendChild(page);
  }
});

/* ======================================================= OVERVIEW */
function overview(page) {
  var f = db.finance ? db.finance(CID, 12) : { revenue: 0, margin: 0 };
  var mom = db.momRevenue ? db.momRevenue(CID) : 0;
  var risk = db.riskScore ? db.riskScore(CID) : 0;
  var health = risk < 30 ? ['good', 'Healthy'] : risk < 55 ? ['warn', 'Watch'] : ['bad', 'At Risk'];
  var grid = frag('kpi-grid');
  grid.appendChild(kpi('Revenue (12M)', ui.money(f.revenue, { compact: true }), 'cash-coin'));
  grid.appendChild(kpi('Net Margin', ui.pct ? ui.pct(f.margin) : Math.round(f.margin) + '%', 'pie-chart'));
  grid.appendChild(kpi('MoM Growth', (mom >= 0 ? '+' : '') + mom.toFixed(1) + '%', mom >= 0 ? 'graph-up-arrow' : 'graph-down-arrow', mom >= 0 ? 'text-good' : 'text-bad'));
  grid.appendChild(kpi('Health · Risk ' + risk, health[1], 'heart-pulse', 'text-' + (health[0] === 'good' ? 'good' : health[0] === 'warn' ? 'warn' : 'bad')));
  page.appendChild(grid);

  var fcId = ui.uid('fc'), catId = ui.uid('ct'), custId = ui.uid('cu');
  page.appendChild(chartCard('Revenue Trend + 3-Month Forecast', 'stars', fcId, 'dashed = projected (least-squares)', 300));
  var row = frag('grid-auto'); row.classList.add('mt-3');
  row.appendChild(chartCard('Expense Drivers', 'pie-chart', catId, 'journal categories', 240));
  row.appendChild(chartCard('Top Clients by Billing', 'people', custId, 'sales ledger', 240));
  page.appendChild(row);
  requestAnimationFrame(function () {
    var s = db.series ? db.series(CID) : { labels: [], revenue: [] };
    var fc = (EPAL.forecast ? EPAL.forecast(s.revenue, 3) : []);
    var labels = s.labels.concat(['+1', '+2', '+3']);
    var hist = s.revenue.concat([null, null, null]);
    var proj = s.revenue.map(function () { return null; });
    if (fc.length) proj[proj.length - 1] = s.revenue[s.revenue.length - 1];
    var projFull = proj.concat(fc);
    var c1 = document.getElementById(fcId);
    if (c1) { EPAL.charts.line(c1, { labels: labels, legend: true, datasets: [ { label: 'Revenue', data: hist, color: ACCENT }, { label: 'Forecast', data: projFull, color: '#f4b740' } ] });
      var inst = window.Chart && Chart.getChart ? Chart.getChart(c1) : null;
      if (inst && inst.data.datasets[1]) { inst.data.datasets[1].borderDash = [6, 5]; inst.data.datasets[1].pointRadius = 3; inst.update(); } }
    var byCat = {}; expenses().forEach(function (e) { byCat[e.category || '—'] = (byCat[e.category || '—'] || 0) + (+e.amount || 0); });
    var cats = Object.keys(byCat).sort(function (a, b) { return byCat[b] - byCat[a]; }).slice(0, 7);
    var c2 = document.getElementById(catId);
    if (c2 && cats.length) EPAL.charts.doughnut(c2, { labels: cats, data: cats.map(function (k) { return byCat[k]; }) });
    var byCust = {}; sales().forEach(function (s2) { var k = s2.customer || 'Walk-in'; byCust[k] = (byCust[k] || 0) + (+s2.amount || 0); });
    var custs = Object.keys(byCust).sort(function (a, b) { return byCust[b] - byCust[a]; }).slice(0, 7);
    var c3 = document.getElementById(custId);
    if (c3 && custs.length) EPAL.charts.bar(c3, { labels: custs, datasets: [{ label: 'Billed', data: custs.map(function (k) { return byCust[k]; }) }], horizontal: true, money: true });
  });
}

/* ======================================================= PROFIT LEAK */
function profitLeak(page) {
  var list = sales().map(function (s) { var margin = s.amount ? (s.profit / s.amount * 100) : 0; return Object.assign({ margin: margin }, s); });
  var totAmt = list.reduce(function (a, s) { return a + (+s.amount || 0); }, 0);
  var totProfit = list.reduce(function (a, s) { return a + (+s.profit || 0); }, 0);
  var avgMargin = totAmt ? (totProfit / totAmt * 100) : 0;
  var loss = list.filter(function (s) { return (+s.profit || 0) <= 0; });
  var thin = list.filter(function (s) { return s.margin > 0 && s.margin < 10; });
  var leak = list.filter(function (s) { return s.margin < 12; }).reduce(function (a, s) { return a + Math.max(0, s.amount * 0.12 - s.profit); }, 0);

  var grid = frag('kpi-grid');
  grid.appendChild(kpi('Avg Margin', avgMargin.toFixed(1) + '%', 'pie-chart', avgMargin >= 12 ? 'text-good' : 'text-warn'));
  grid.appendChild(kpi('Loss-making', String(loss.length), 'graph-down-arrow', loss.length ? 'text-bad' : 'text-good'));
  grid.appendChild(kpi('Thin (<10%)', String(thin.length), 'exclamation-triangle', thin.length ? 'text-warn' : ''));
  grid.appendChild(kpi('Est. Leak', ui.money(leak, { compact: true }), 'droplet', leak ? 'text-bad' : 'text-good'));
  page.appendChild(grid);
  if (loss.length || leak > 0) page.appendChild(buildBanner('droplet-half',
    '<strong>Margin is leaking ~' + ui.money(leak) + '.</strong> ' + loss.length + ' order' + (loss.length === 1 ? '' : 's') + ' at or below cost and ' + thin.length + ' below 10% margin — review pricing/markup on these.'));

  // margin by service line
  var byS = {}; list.forEach(function (s) { var k = serviceOf(s); if (!byS[k]) byS[k] = { service: k, amount: 0, profit: 0 }; byS[k].amount += (+s.amount || 0); byS[k].profit += (+s.profit || 0); });
  var svc = Object.keys(byS).map(function (k) { return { service: k, amount: byS[k].amount, profit: byS[k].profit, margin: byS[k].amount ? byS[k].profit / byS[k].amount * 100 : 0 }; }).sort(function (a, b) { return a.margin - b.margin; });
  var chId = ui.uid('svc');
  page.appendChild(chartCard('Margin by Service Line', 'bar-chart', chId, 'lowest first — where to fix pricing', 240));
  requestAnimationFrame(function () { var c = document.getElementById(chId); if (!c) return;
    EPAL.charts.bar(c, { labels: svc.map(function (r) { return r.service; }), horizontal: true, money: false,
      datasets: [{ label: 'Margin %', data: svc.map(function (r) { return Math.round(r.margin); }), colors: svc.map(function (r) { return r.margin < 10 ? '#f0506e' : r.margin < 15 ? '#f4b740' : '#23c17e'; }) }] }); });

  var t = EPAL.table({
    columns: [
      { key: 'id', label: 'Ref' }, { key: 'date', label: 'Date', date: true }, { key: 'customer', label: 'Customer' },
      { key: 'service', label: 'Service', render: function (s) { return esc(serviceOf(s)); }, sortVal: function (s) { return serviceOf(s); } },
      { key: 'amount', label: 'Amount', num: true, money: true }, { key: 'profit', label: 'Profit', num: true, render: function (s) { return '<span class="num ' + ((+s.profit || 0) <= 0 ? 'text-bad' : '') + '">' + ui.money(s.profit) + '</span>'; }, sortVal: function (s) { return +s.profit || 0; } },
      { key: 'margin', label: 'Margin', num: true, sortVal: function (s) { return s.margin; }, render: function (s) { var m = s.margin; return '<span class="num ' + (m < 0 ? 'text-bad' : m < 10 ? 'text-warn' : 'text-good') + '">' + m.toFixed(1) + '%</span>'; } }
    ],
    rows: list.slice().sort(function (a, b) { return a.margin - b.margin; }), searchKeys: ['id', 'customer', 'desc'], pageSize: 12,
    exportName: 'travels-profit-leak.csv', pdfTitle: 'Profit Leak — Epal Travels',
    empty: { icon: 'droplet', title: 'No sales to analyse' }
  });
  var lbl = frag('section-label'); lbl.textContent = 'Orders by Margin (lowest first)'; page.appendChild(lbl);
  var card = frag('table-card'); slot(card, 'body').appendChild(t.el); page.appendChild(card);
}

/* ======================================================= FRAUD SENTINEL */
function fraudSentinel(page) {
  var flags = [];
  var sl = sales();
  sl.forEach(function (s) { if ((+s.profit || 0) <= 0 && (+s.amount || 0) > 0) flags.push({ sev: 'High', type: 'Loss sale', ref: s.id, party: s.customer, amount: s.amount, reason: 'Sold at or below cost (profit ' + ui.money(s.profit) + ')' }); });
  var refCount = {}; sl.forEach(function (s) { var r = s.ref || s.id; refCount[r] = (refCount[r] || 0) + 1; });
  Object.keys(refCount).forEach(function (r) { if (refCount[r] > 1) flags.push({ sev: 'High', type: 'Duplicate ref', ref: r, party: '', amount: 0, reason: r + ' appears ' + refCount[r] + ' times — possible double-entry' }); });
  var ex = expenses().map(function (e) { return e; });
  var amts = ex.map(function (e) { return +e.amount || 0; });
  var mean = avg(amts), sd = std(amts, mean);
  ex.forEach(function (e) { if (sd > 0 && (+e.amount || 0) > mean + 2 * sd) flags.push({ sev: 'Medium', type: 'Expense outlier', ref: e.id, party: e.category, amount: e.amount, reason: 'Expense far above norm (avg ' + ui.money(Math.round(mean)) + ')' }); });
  sl.forEach(function (s) { var a = +s.amount || 0; if (a >= 200000 && a % 50000 === 0) flags.push({ sev: 'Low', type: 'Round-number', ref: s.id, party: s.customer, amount: a, reason: 'Suspiciously round large amount' }); });
  sl.forEach(function (s) { var d = String(s.desc || '').toLowerCase(); if (/refund|void|reversal|cancel/.test(d) || (+s.amount || 0) < 0) flags.push({ sev: 'Medium', type: 'Refund/Void', ref: s.id, party: s.customer, amount: s.amount, reason: 'Refund/void/reversal recorded' }); });

  var sevRank = { High: 3, Medium: 2, Low: 1 };
  flags.sort(function (a, b) { return (sevRank[b.sev] - sevRank[a.sev]) || (Math.abs(b.amount) - Math.abs(a.amount)); });
  var high = flags.filter(function (f) { return f.sev === 'High'; });
  var atRisk = flags.reduce(function (a, f) { return a + Math.abs(+f.amount || 0); }, 0);

  var grid = frag('kpi-grid');
  grid.appendChild(kpi('Anomalies', String(flags.length), 'shield-exclamation', flags.length ? 'text-warn' : 'text-good'));
  grid.appendChild(kpi('High Severity', String(high.length), 'exclamation-octagon', high.length ? 'text-bad' : 'text-good'));
  grid.appendChild(kpi('Amount at Risk', ui.money(atRisk, { compact: true }), 'cash-stack'));
  grid.appendChild(kpi('Checks Run', '5', 'clipboard-check'));
  page.appendChild(grid);
  page.appendChild(buildBanner(flags.length ? 'shield-exclamation' : 'shield-check',
    flags.length ? ('<strong>' + flags.length + ' transaction' + (flags.length === 1 ? '' : 's') + ' flagged</strong> across 5 heuristics (loss sales, duplicate refs, expense outliers, round-number amounts, refund/void). Review the high-severity items first.') : '<strong>Nothing suspicious.</strong> All five sentinel checks came back clean.'));

  var t = EPAL.table({
    columns: [
      { key: 'sev', label: 'Severity', badge: { High: 'bad', Medium: 'warn', Low: '' } },
      { key: 'type', label: 'Signal', badge: {} },
      { key: 'ref', label: 'Reference' }, { key: 'party', label: 'Party', render: function (f) { return esc(f.party || '—'); } },
      { key: 'amount', label: 'Amount', num: true, render: function (f) { return f.amount ? ui.money(Math.abs(f.amount)) : '—'; }, sortVal: function (f) { return Math.abs(f.amount || 0); } },
      { key: 'reason', label: 'Why flagged', render: function (f) { return esc(f.reason); } }
    ],
    rows: flags, searchKeys: ['ref', 'party', 'type', 'reason'], quickFilter: 'sev', filterPanel: true, filters: [{ key: 'type', label: 'Signal' }],
    pageSize: 12, exportName: 'travels-fraud-sentinel.csv', pdfTitle: 'Fraud Sentinel — Epal Travels',
    empty: { icon: 'shield-check', title: 'No anomalies detected', hint: 'All sentinel checks are clean.' }
  });
  var card = frag('reg-card');
  slot(card, 'title').innerHTML = ui.icon('shield-exclamation') + ' Flagged Transactions';
  slot(card, 'sub').textContent = flags.length + ' signals';
  slot(card, 'body').appendChild(t.el);
  page.appendChild(card);
}

/* ======================================================= TRAVEL DNA */
function travelDna(page) {
  var sl = sales();
  var TODAY = new Date(2026, 6, 5);
  var by = {};
  sl.forEach(function (s) { var k = s.customer || 'Walk-in'; if (!by[k]) by[k] = { customer: k, orders: 0, monetary: 0, last: null };
    by[k].orders++; by[k].monetary += (+s.amount || 0); if (!by[k].last || s.date > by[k].last) by[k].last = s.date; });
  var rows = Object.keys(by).map(function (k) {
    var r = by[k]; var recency = r.last ? Math.floor((TODAY.getTime() - new Date(r.last).getTime()) / 86400000) : 999;
    var seg = segmentOf(recency, r.orders, r.monetary);
    return { customer: k, recency: recency, frequency: r.orders, monetary: r.monetary, segment: seg };
  }).sort(function (a, b) { return b.monetary - a.monetary; });
  var repeat = rows.filter(function (r) { return r.frequency > 1; }).length;
  var repeatRate = rows.length ? Math.round(repeat / rows.length * 100) : 0;
  var champions = rows.filter(function (r) { return r.segment === 'Champion'; }).length;
  var avgVal = rows.length ? Math.round(rows.reduce(function (a, r) { return a + r.monetary; }, 0) / rows.length) : 0;
  var byMonth = {}; sl.forEach(function (s) { var m = String(s.date || '').slice(0, 7); byMonth[m] = (byMonth[m] || 0) + (+s.amount || 0); });
  var months = Object.keys(byMonth).sort();
  var peakM = months.slice().sort(function (a, b) { return byMonth[b] - byMonth[a]; })[0];

  var grid = frag('kpi-grid');
  grid.appendChild(kpi('Travellers', String(rows.length), 'people'));
  grid.appendChild(kpi('Repeat Rate', repeatRate + '%', 'arrow-repeat', repeatRate >= 40 ? 'text-good' : 'text-warn'));
  grid.appendChild(kpi('Champions', String(champions), 'trophy', 'text-good'));
  grid.appendChild(kpi('Avg Value', ui.money(avgVal, { compact: true }), 'gem'));
  grid.appendChild(kpi('Peak Month', peakM ? mLabel(peakM) : '—', 'calendar-heart'));
  page.appendChild(grid);

  var mixId = ui.uid('mix'), seaId = ui.uid('sea');
  var row = frag('grid-auto');
  row.appendChild(chartCard('Service Mix', 'diagram-2', mixId, 'billing by service line', 240));
  row.appendChild(chartCard('Seasonality', 'calendar3', seaId, 'billing by month', 240));
  page.appendChild(row);
  requestAnimationFrame(function () {
    var byS = {}; sl.forEach(function (s) { var k = serviceOf(s); byS[k] = (byS[k] || 0) + (+s.amount || 0); });
    var c1 = document.getElementById(mixId); if (c1 && Object.keys(byS).length) EPAL.charts.doughnut(c1, { labels: Object.keys(byS), data: Object.values(byS) });
    var c2 = document.getElementById(seaId); if (c2 && months.length) EPAL.charts.bar(c2, { labels: months.map(mLabel), datasets: [{ label: 'Billing', data: months.map(function (m) { return byMonth[m]; }), color: ACCENT }] });
  });

  var segColors = { Champion: 'good', Loyal: 'accent', 'At Risk': 'warn', New: 'info', Dormant: 'bad' };
  var t = EPAL.table({
    columns: [
      { key: 'customer', label: 'Traveller', render: function (r) { return '<div class="flex items-center gap-1"><span class="avatar" style="width:24px;height:24px;font-size:9px;background:' + ui.colorFor(r.customer) + '">' + ui.initials(r.customer) + '</span><span class="strong">' + esc(r.customer) + '</span></div>'; } },
      { key: 'segment', label: 'Segment', badge: segColors },
      { key: 'recency', label: 'Recency (d)', num: true, render: function (r) { return '<span class="num ' + (r.recency > 120 ? 'text-warn' : '') + '">' + (r.recency === 999 ? '—' : r.recency) + '</span>'; } },
      { key: 'frequency', label: 'Orders', num: true },
      { key: 'monetary', label: 'Lifetime Billing', num: true, money: true }
    ],
    rows: rows, searchKeys: ['customer', 'segment'], quickFilter: 'segment', filterPanel: true, pageSize: 12,
    exportName: 'travels-travel-dna.csv', pdfTitle: 'Travel DNA — Epal Travels',
    empty: { icon: 'people', title: 'No traveller data yet' }
  });
  var lbl = frag('section-label'); lbl.textContent = 'Traveller Segments (RFM)'; page.appendChild(lbl);
  var card = frag('table-card'); slot(card, 'body').appendChild(t.el); page.appendChild(card);
}
function segmentOf(recency, freq, monetary) {
  if (freq >= 3 && recency <= 90) return 'Champion';
  if (freq >= 2 && recency <= 150) return 'Loyal';
  if (recency > 240) return 'Dormant';
  if (recency > 120) return 'At Risk';
  return 'New';
}

/* ---------------------------------------------------- helpers */
function serviceOf(s) {
  var ref = String(s.ref || s.id || '').toUpperCase(), d = String(s.desc || '').toLowerCase();
  if (/^TKT|ticket|air/.test(ref) || /ticket|air/.test(d)) return 'Air Ticketing';
  if (/visa/.test(ref) || /visa/.test(d)) return 'Visa';
  if (/^CF|umrah|hajj|contract|package|itp/.test(ref) || /umrah|hajj|package|tour/.test(d)) return 'Package';
  if (/wap|hotel/.test(ref) || /hotel/.test(d)) return 'Hotel';
  return 'Other';
}
function avg(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : 0; }
function std(a, m) { if (a.length < 2) return 0; return Math.sqrt(a.reduce(function (x, y) { return x + (y - m) * (y - m); }, 0) / a.length); }
function mLabel(ym) { var p = String(ym).split('-'); if (p.length < 2) return ym; return new Date(p[0], p[1] - 1, 1).toLocaleString('en', { month: 'short', year: '2-digit' }); }
function esc(s) { return ui.escapeHtml(String(s == null ? '' : s)); }
