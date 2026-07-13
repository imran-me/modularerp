/* ============================================================================
 * EPAL GROUP ERP  ·  views/group/finance.js
 * ----------------------------------------------------------------------------
 * CONSOLIDATED FINANCE — the group CFO console (route: group/finance).
 *
 * One view, six sub-screens (branch on ctx.subId):
 *   (none)          Overview — consolidated KPI hero, group trend chart,
 *                   per-company P&L table with drill-through to each concern.
 *   pnl             Month-by-month group P&L + per-company revenue matrix,
 *                   revenue-vs-expense bars, manual CSV statement export.
 *   cashflow        Monthly net cash movement bars + cumulative curve + table.
 *   balance-sheet   Management balance sheet derived live from operations:
 *                   bank balances + receivables vs payables vs derived equity.
 *   receivables     AR aging (Current, 1-30, 31-60, 60+) + mark-collected.
 *   payables        AP aging with the same buckets + mark-settled.
 *   banks           Every bank account across the group, add and edit accounts,
 *                   masked account numbers, balance mix doughnut.
 *
 * Data: db.series, db.finance, db.groupSnapshot, db.momRevenue and the
 * acc_entries, acc_schedules, banks and sales stores (see docs CONTRACT).
 * Read-mostly by design: the only mutations are schedule settlement and bank
 * account maintenance — sales are recorded by the operating modules.
 * ==========================================================================*/

(function (EPAL) {
  'use strict';
  var ui = EPAL.ui, el = ui.el;
  var db = function () { return EPAL.db; };
  var LED = function () { return EPAL.ledger; };
  function hasLedger() { return !!(EPAL.ledger && EPAL.ledger.accounts); }
  function can(action) { return (EPAL.perm && EPAL.perm.can) ? EPAL.perm.can('group', 'finance', action) : true; }

  var GREEN = '#23c17e', RED = '#f0506e', AMBER = '#f4b740', ORANGE = '#e2721b', GOLD = '#1A43BF';

  var TABS = [
    [null, 'Overview'], ['pnl', 'P&L'], ['cashflow', 'Cash Flow'],
    ['balance-sheet', 'Balance Sheet'], ['receivables', 'Receivables'],
    ['payables', 'Payables'], ['banks', 'Banks'],
    ['coa', 'Chart of Accounts'], ['journal', 'Journal'], ['trial-balance', 'Trial Balance'],
    ['consolidation', 'Consolidation'], ['concern-pnl', 'P&L by Concern'], ['expenses', 'Group Expenses']
  ];

  /* ---- tiny shared helpers ------------------------------------------------*/
  function activeCompanies() {
    return EPAL.config.companies.filter(function (c) { return c.type === 'company' && c.enabled; });
  }
  function kpi(label, value, icon, drill, foot) {
    return el('div.kpi-card' + (drill ? '.drill' : ''),
      drill ? { onclick: function () { EPAL.router.navigate(drill); }, title: 'Open ' + label } : null, [
      el('div.kpi-top', null, [ el('span.kpi-label', { text: label }),
        el('span.kpi-ico', { html: '<i class="bi bi-' + icon + '"></i>' }) ]),
      el('div.kpi-value', { text: String(value) }),
      foot ? el('div.kpi-foot', null, [ el('span.text-muted', { text: foot }) ]) : null
    ]);
  }
  function chartCard(title, icon, canvasId, subLabel, height) {
    return el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon(icon) + ' ' + title }),
        subLabel ? el('span.card-sub', { text: subLabel }) : null ]),
      el('div.card-body', null, [
        el('div', { style: { height: (height || 260) + 'px', position: 'relative' } }, [ el('canvas', { id: canvasId }) ])
      ])
    ]);
  }
  function pills(active) {
    var host = el('div.pill-tab.mb-3');
    TABS.forEach(function (t) {
      host.appendChild(el('button' + ((active || null) === t[0] ? '.active' : ''), {
        text: t[1],
        onclick: function () { EPAL.router.navigate('group/finance' + (t[0] ? '/' + t[0] : '')); }
      }));
    });
    return el('div', null, [host]);
  }
  function head(title, icon, sub, actions) {
    return EPAL.pageHead({ eyebrow: 'Epal Group · Consolidated Finance', icon: icon, title: title, sub: sub, actions: actions });
  }
  function dl(name, content, mime) {
    var blob = new Blob([content], { type: mime || 'text/csv' });
    var a = el('a', { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click(); a.remove();
    ui.toast('Downloaded ' + name, 'success');
  }
  function coBadge(cid) {
    var co = EPAL.config.company(cid);
    if (!co) return '<span class="badge">' + ui.escapeHtml(cid || '—') + '</span>';
    return '<span class="badge" style="color:' + co.accent + '">' + ui.escapeHtml(co.short) + '</span>';
  }
  function schedules(kind) {
    return db().col('acc_schedules').filter(function (s) { return s.kind === kind; });
  }
  function outstandingOf(kind) {
    return schedules(kind).filter(function (s) { return s.status !== 'Paid'; })
      .reduce(function (a, s) { return a + (s.amount || 0); }, 0);
  }
  function bankTotal() {
    return db().col('banks').reduce(function (a, b) { return a + (b.balance || 0); }, 0);
  }
  // decorate a schedule row with days-overdue + aging bucket (vs today)
  function decorate(s) {
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var due = new Date(String(s.due || '') + 'T00:00:00');
    var days = isNaN(due) ? 0 : Math.floor((today.getTime() - due.getTime()) / 86400000);
    var bucket = s.status === 'Paid' ? 'Settled'
      : days <= 0 ? 'Current' : days <= 30 ? '1–30d' : days <= 60 ? '31–60d' : '60+d';
    return Object.assign({}, s, { days: days, bucket: bucket });
  }
  // per-company monthly series list [{co, series}] for breakdown tables + CSV
  function perCompanySeries() {
    return activeCompanies().map(function (c) { return { co: c, series: db().series(c.id) }; });
  }
  // The board-grade CSV statement (built by hand, like the shared reports do).
  function exportPnlCsv() {
    var s = ledgerSeries(null), yms = db().months(12), perCo = perCompanySeriesLedger();
    var lines = [['Month', 'Group Revenue', 'Group Expense', 'Group Profit', 'Margin %']
      .concat(perCo.map(function (p) { return p.co.short + ' Revenue'; }))];
    var tr = 0, te = 0;
    yms.forEach(function (ym, i) {
      var rev = s.revenue[i], exp = s.expense[i], pr = s.profit[i];
      tr += rev; te += exp;
      var line = [ym, rev, exp, pr, rev ? (pr / rev * 100).toFixed(1) : '0.0'];
      perCo.forEach(function (p) { line.push(p.series.revenue[i]); });
      lines.push(line);
    });
    var totals = ['TOTAL', tr, te, tr - te, tr ? ((tr - te) / tr * 100).toFixed(1) : '0.0'];
    perCo.forEach(function (p) {
      totals.push(p.series.revenue.reduce(function (a, v) { return a + v; }, 0));
    });
    lines.push(totals);
    dl('group-pnl-12m.csv', lines.map(function (l) { return l.join(','); }).join('\n'));
  }

  /* ==========================================================================
   * THE VIEW — one registration, branches on ctx.subId
   * ========================================================================*/
  EPAL.view('group/finance', { render: function (ctx) {
    var sub = ctx.subId || null;
    var page = el('div.page');
    if (sub === 'pnl') renderPnl(page);
    else if (sub === 'cashflow') renderCashflow(page);
    else if (sub === 'balance-sheet') renderBalanceSheet(page);
    else if (sub === 'receivables') renderAging(page, 'Receivable');
    else if (sub === 'payables') renderAging(page, 'Payable');
    else if (sub === 'banks') renderBanks(page);
    else if (sub === 'coa') renderCoa(page);
    else if (sub === 'journal') renderJournal(page);
    else if (sub === 'trial-balance') renderTrialBalance(page);
    else if (sub === 'consolidation') renderConsolidation(page);
    else if (sub === 'concern-pnl') renderConcernPnl(page);
    else if (sub === 'expenses') renderGroupExpenses(page);
    else renderOverview(page);
    ctx.mount.appendChild(page);
  } });

  /* ==========================================================================
   * P&L BY CONCERN — the consolidated income statement pivoted so every income
   * and expense CATEGORY is shown across each sister concern + a Group total.
   * Ledger-driven (uses consolidatedTrialBalance so inter-company is eliminated),
   * so anything posted per company — e.g. the payroll engine's DR 5100 Salaries /
   * DR 5150 Leave Encashment tagged companyId:'travels' — lands in that concern's
   * column and rolls into the Group automatically. THIS is the Employee→Company→
   * Group flow made visible.
   * ========================================================================*/
  // the P&L entities: each present sister concern + the Group HQ (companyId:'group')
  function pnlEntities() {
    var comps = LED().consolidatedTrialBalance().companies.map(function (c) { return { id: c.id, short: c.short }; });
    return comps.concat([{ id: 'group', short: 'Group HQ' }]);
  }
  // natural P&L amount for one account at one entity (income credit-side +, expense debit-side +)
  function pnlAmt(code, eid) { return Math.round(LED().balance(code, { companyId: eid })); }

  /* ---- LEDGER-DERIVED P&L (single source of truth) -----------------------
   * These replace the old `financials` summary store on the Overview / P&L /
   * Cash Flow screens so every group figure comes from the same double-entry
   * ledger as the by-concern statement — meaning payroll and group expenses are
   * reflected everywhere. eid omitted/null = whole group (all entities). */
  function ledgerFinance(eid) {
    var rev = 0, exp = 0;
    LED().accounts().forEach(function (a) { if (a.type === 'income') rev += pnlAmt(a.code, eid); else if (a.type === 'expense') exp += pnlAmt(a.code, eid); });
    return { revenue: rev, expense: exp, profit: rev - exp, margin: rev ? (rev - exp) / rev * 100 : 0 };
  }
  function ledgerAcctType() { var m = {}; LED().accounts().forEach(function (a) { m[a.code] = a.type; }); return m; }
  function ledgerSeries(eid) {
    var base = db().series(null), months = db().months(12), typ = ledgerAcctType();
    var idx = {}; months.forEach(function (m, i) { idx[m] = i; });
    var rev = months.map(function () { return 0; }), exp = months.map(function () { return 0; });
    LED().entries(eid ? { companyId: eid } : {}).forEach(function (e) {
      var i = idx[String(e.date).slice(0, 7)]; if (i == null) return;
      e.lines.forEach(function (ln) { var t = typ[ln.account];
        if (t === 'income') rev[i] += (+ln.cr || 0) - (+ln.dr || 0);
        else if (t === 'expense') exp[i] += (+ln.dr || 0) - (+ln.cr || 0); });
    });
    return { labels: base.labels, months: months, revenue: rev.map(Math.round), expense: exp.map(Math.round), profit: rev.map(function (r, i) { return Math.round(r - exp[i]); }) };
  }
  function perCompanySeriesLedger() { return activeCompanies().map(function (c) { return { co: c, series: ledgerSeries(c.id) }; }); }

  function renderConcernPnl(page) {
    page.appendChild(head('P&L by Concern', 'diagram-3',
      'Consolidated income statement — every category across each sister concern plus Group HQ. Driven by the general ledger.',
      [ can('export') ? el('button.btn.btn-ghost', { html: ui.icon('download') + ' Export CSV', onclick: exportConcernCsv }) : null ].filter(Boolean)));
    page.appendChild(pills('concern-pnl'));
    if (!hasLedger()) { page.appendChild(el('div.card', null, [ el('div.card-body', { text: 'Ledger engine unavailable.' }) ])); return; }

    var ents = pnlEntities();
    var accts = LED().accounts();
    function vals(a) { return ents.map(function (e) { return pnlAmt(a.code, e.id); }); }
    function nonzero(a) { return vals(a).some(function (v) { return Math.abs(v) >= 1; }); }
    var income = accts.filter(function (a) { return a.type === 'income'; }).sort(byCode).filter(nonzero);
    var expense = accts.filter(function (a) { return a.type === 'expense'; }).sort(byCode).filter(nonzero);
    var revByEnt = ents.map(function (e) { return income.reduce(function (s, a) { return s + pnlAmt(a.code, e.id); }, 0); });
    var expByEnt = ents.map(function (e) { return expense.reduce(function (s, a) { return s + pnlAmt(a.code, e.id); }, 0); });
    function tot(arr) { return arr.reduce(function (x, y) { return x + y; }, 0); }
    var revTotal = tot(revByEnt), expTotal = tot(expByEnt), netTotal = revTotal - expTotal;

    page.appendChild(el('div.kpi-grid.kpi-compact.stagger', null, [
      kpi('Group Revenue', ui.money(revTotal, { compact: true }), 'graph-up-arrow'),
      kpi('Group Expense', ui.money(expTotal, { compact: true }), 'graph-down-arrow'),
      kpi('Group Net', ui.money(netTotal, { compact: true }), 'wallet2'),
      kpi('Group Margin', (revTotal ? (netTotal / revTotal * 100).toFixed(1) : '0.0') + '%', 'percent'),
      kpi('Entities', String(ents.length), 'diagram-3')
    ]));

    // ---- the pivot table (Category | each entity | Total) ----
    var thr = el('tr'); thr.appendChild(el('th', { text: 'Category' }));
    ents.forEach(function (e) { thr.appendChild(el('th.num', { text: e.short })); });
    thr.appendChild(el('th.num', { text: 'Total' }));
    var tbody = el('tbody');
    function money(v) { return v ? ui.money(v) : '—'; }
    function sectionRow(label) { var tr = el('tr', { style: { background: 'var(--surface-2)' } }); var td = el('td.strong', { text: label }); td.setAttribute('colspan', String(ents.length + 2)); tr.appendChild(td); tbody.appendChild(tr); }
    function acctRow(name, rowVals, rowTot, strong) {
      var tr = el('tr'); tr.appendChild(el('td' + (strong ? '.strong' : ''), { text: name }));
      rowVals.forEach(function (v) { tr.appendChild(el('td.num' + (strong ? '.strong' : ''), { text: money(v) })); });
      tr.appendChild(el('td.num.strong', { text: money(rowTot) })); tbody.appendChild(tr);
    }
    sectionRow('Revenue');
    income.forEach(function (a) { var v = vals(a); acctRow(a.name, v, tot(v)); });
    acctRow('Total Revenue', revByEnt, revTotal, true);
    sectionRow('Expenses');
    expense.forEach(function (a) { var v = vals(a); acctRow(a.name, v, tot(v)); });
    acctRow('Total Expenses', expByEnt, expTotal, true);
    var netTr = el('tr', { style: { borderTop: '2px solid var(--border-strong, var(--border))' } });
    netTr.appendChild(el('td.strong', { text: 'Net Profit' }));
    ents.forEach(function (e, i) { var n = revByEnt[i] - expByEnt[i]; netTr.appendChild(el('td.num.strong' + (n >= 0 ? '.text-good' : '.text-bad'), { text: money(n) })); });
    netTr.appendChild(el('td.num.strong' + (netTotal >= 0 ? '.text-good' : '.text-bad'), { text: money(netTotal) }));
    tbody.appendChild(netTr);

    var table = el('table.tbl', null, [ el('thead', null, [thr]), tbody ]);
    page.appendChild(el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon('table') + ' Consolidated Income Statement' }), el('span.card-sub', { text: ents.length + ' entities · concerns + Group HQ' }) ]),
      el('div.card-body', null, [ el('div.table-wrap', null, [table]) ])
    ]));

    // ---- expense mix by entity (stacked) ----
    var expHeads = expense.filter(function (a) { return tot(vals(a)) > 0; });
    if (expHeads.length) {
      var chartId = ui.uid('cpnl');
      page.appendChild(chartCard('Expense by Entity', 'bar-chart', chartId, 'each expense head across the entities', 280));
      requestAnimationFrame(function () {
        var c = document.getElementById(chartId); if (!c) return;
        EPAL.charts.bar(c, { labels: ents.map(function (e) { return e.short; }), stacked: true, legend: true,
          datasets: expHeads.map(function (a, i) { return { label: a.name, data: ents.map(function (e) { return pnlAmt(a.code, e.id); }), color: ['#1A43BF', '#23c17e', '#f4b740', '#e2721b', '#f0506e', '#7b5cff', '#12b5c9', '#a0522d'][i % 8] }; }) });
      });
    }
  }
  function byCode(a, b) { return String(a.code) < String(b.code) ? -1 : 1; }
  function exportConcernCsv() {
    var ents = pnlEntities(), accts = LED().accounts();
    var header = ['Category'].concat(ents.map(function (e) { return e.short; })).concat(['Total']);
    var lines = [header];
    function push(a) { var v = ents.map(function (e) { return pnlAmt(a.code, e.id); }); lines.push([a.name].concat(v).concat([v.reduce(function (x, y) { return x + y; }, 0)])); }
    lines.push(['REVENUE']); accts.filter(function (a) { return a.type === 'income'; }).sort(byCode).forEach(push);
    lines.push(['EXPENSES']); accts.filter(function (a) { return a.type === 'expense'; }).sort(byCode).forEach(push);
    dl('group-pnl-by-concern.csv', lines.map(function (l) { return l.join(','); }).join('\n'));
  }

  /* ==========================================================================
   * GROUP EXPENSES — the Group entity's OWN running costs (office management,
   * food/canteen, utilities, rent…) with BUDGET vs ACTUAL. Each entry posts to
   * the ledger tagged companyId:'group' (DR expense head / CR Bank, or CR AP when
   * unpaid), so it flows into the group P&L exactly like a concern's expenses do.
   * Budgets live in a small group_budgets store; actuals are read live from the GL.
   * ========================================================================*/
  var GROUP_EXP_HEADS = [
    ['Office Management', '5500'], ['Food & Canteen', '5550'], ['Utilities', '5300'], ['Office Rent', '5200'],
    ['Salaries (Group)', '5100'], ['Marketing', '5400'], ['IT & Software', '5700'], ['Travel & Conveyance', '5600'],
    ['Bank Charges', '6000'], ['Miscellaneous', '5800']
  ];
  var NEW_GROUP_ACCOUNTS = { '5500': 'Office & Administration', '5550': 'Food & Canteen', '5600': 'Travel & Conveyance', '5700': 'IT & Software', '5800': 'Miscellaneous Expense' };
  function gToday() { return (EPAL.payroll && EPAL.payroll.today) ? EPAL.payroll.today() : new Date().toISOString().slice(0, 10); }
  function acctForHead(cat) { for (var i = 0; i < GROUP_EXP_HEADS.length; i++) if (GROUP_EXP_HEADS[i][0] === cat) return GROUP_EXP_HEADS[i][1]; return '5800'; }
  // register the new expense accounts directly (ledger.ensureAccount upserts by a
  // non-existent id and collides — see payroll.js); append-by-code, idempotent.
  function ensureGroupAccounts() {
    if (!hasLedger()) return;
    var coa = EPAL.store.list('coa'); if (!coa.length) return;
    var have = {}; coa.forEach(function (a) { have[a.code] = true; });
    var add = [];
    Object.keys(NEW_GROUP_ACCOUNTS).forEach(function (code) { if (!have[code]) add.push({ id: code, code: code, name: NEW_GROUP_ACCOUNTS[code], type: 'expense', normal: 'debit', group: 'Operating Expense', intercompany: false }); });
    if (add.length) EPAL.store.set('coa', coa.concat(add));
  }
  function groupExpenses() { return db().col('acc_entries').filter(function (e) { return e.companyId === 'group' && e.kind === 'Expense'; }); }
  function postGroupExpense(rec) {
    db().save('acc_entries', rec);
    var credit = rec.paid === false ? '2000' : '1010';
    try { LED().post({ id: 'GL-GX-' + rec.id, date: rec.date, companyId: 'group', ref: rec.ref || rec.id, memo: (rec.category || 'Expense') + ' — Group', source: 'manual', party: rec.party || '', lines: [{ account: rec.account, dr: rec.amount, cr: 0 }, { account: credit, dr: 0, cr: rec.amount }] }); } catch (e) { }
  }

  function renderGroupExpenses(page) {
    ensureGroupAccounts();
    page.appendChild(head('Group Expenses', 'building', 'The Group\'s own running costs — office, food, utilities, rent — with budget vs actual. Posted to the group ledger.',
      [ can('create') ? el('button.btn.btn-ghost', { html: ui.icon('bullseye') + ' Set Budget', onclick: function () { setBudgetForm(null); } }) : null,
        can('create') ? el('button.btn.btn-primary', { html: ui.icon('plus-lg') + ' Record Expense', onclick: function () { groupExpenseForm(null); } }) : null ].filter(Boolean)));
    page.appendChild(pills('expenses'));
    if (!hasLedger()) { page.appendChild(el('div.card', null, [ el('div.card-body', { text: 'Ledger engine unavailable.' }) ])); return; }

    var yr = gToday().slice(0, 4), yStart = yr + '-01-01', yEnd = yr + '-12-31';
    var budgets = EPAL.store.list('group_budgets');
    var byHead = {};
    GROUP_EXP_HEADS.forEach(function (h) { byHead[h[0]] = { head: h[0], account: h[1], budget: 0, period: 'Annual', actual: Math.max(0, Math.round(LED().balance(h[1], { companyId: 'group', from: yStart, to: yEnd }))) }; });
    budgets.forEach(function (b) { if (byHead[b.category]) { byHead[b.category].budget = b.period === 'Monthly' ? (b.amount || 0) * 12 : (b.amount || 0); byHead[b.category].period = b.period; } });
    var list = Object.keys(byHead).map(function (k) { return byHead[k]; }).filter(function (x) { return x.budget > 0 || x.actual > 0; });
    var totalActual = list.reduce(function (a, x) { return a + x.actual; }, 0);
    var totalBudget = list.reduce(function (a, x) { return a + x.budget; }, 0);
    var overCount = list.filter(function (x) { return x.budget > 0 && x.actual > x.budget; }).length;
    var biggest = list.slice().sort(function (a, b) { return b.actual - a.actual; })[0];

    page.appendChild(el('div.kpi-grid.kpi-compact.stagger', null, [
      kpi('Spent (' + yr + ')', ui.money(totalActual, { compact: true }), 'cash-stack'),
      kpi('Budget', totalBudget ? ui.money(totalBudget, { compact: true }) : '—', 'bullseye'),
      kpi('Used', totalBudget ? Math.round(totalActual / totalBudget * 100) + '%' : '—', 'speedometer2', null, totalBudget && totalActual > totalBudget ? 'over budget' : ''),
      kpi('Biggest Head', biggest ? biggest.head : '—', 'pie-chart'),
      kpi('Over Budget', String(overCount), 'exclamation-triangle', null, overCount ? 'heads over' : 'all within')
    ]));

    // ---- budget vs actual ----
    var bvaBody = el('div.card-body');
    if (!list.length) bvaBody.appendChild(el('div.text-mute.sm', { text: 'No group expenses yet — record one, or set a budget head.' }));
    list.slice().sort(function (a, b) { return b.actual - a.actual; }).forEach(function (x) {
      var pct = x.budget ? Math.min(150, Math.round(x.actual / x.budget * 100)) : 0;
      var over = x.budget && x.actual > x.budget;
      bvaBody.appendChild(el('div', { style: { marginBottom: '11px' } }, [
        el('div.flex.justify-between.items-center', null, [
          el('div.fw-600', { text: x.head }),
          el('div.text-mute.sm', { html: ui.money(x.actual) + (x.budget ? ' <span class="text-mute">/ ' + ui.money(x.budget) + '</span>' : ' <span class="text-mute">· no budget</span>') })
        ]),
        el('div', { style: { height: '7px', background: 'var(--surface-3)', borderRadius: '5px', overflow: 'hidden', marginTop: '4px' } }, [
          el('div', { style: { height: '100%', width: (x.budget ? Math.min(100, pct) : 0) + '%', background: over ? RED : pct > 85 ? AMBER : GREEN, borderRadius: '5px', transition: 'width .4s' } })
        ]),
        x.budget ? el('div.text-mute.xs', { style: { marginTop: '2px' }, text: over ? ('Over by ' + ui.money(x.actual - x.budget)) : (ui.money(x.budget - x.actual) + ' remaining · ' + pct + '% used') }) : null
      ].filter(Boolean)));
    });
    page.appendChild(el('div.card', null, [ el('div.card-head', null, [ el('h3', { html: ui.icon('speedometer2') + ' Budget vs Actual — ' + yr } ), el('span.card-sub', { text: 'live from the ledger' }) ]), bvaBody ]));

    // ---- expense register ----
    var entries = groupExpenses().slice().sort(function (a, b) { return (a.date || '') < (b.date || '') ? 1 : -1; });
    var tbl = EPAL.table({
      columns: [
        { key: 'date', label: 'Date', date: true },
        { key: 'category', label: 'Head', badge: {} },
        { key: 'desc', label: 'Detail', render: function (e) { return ui.escapeHtml(e.desc || e.category || '—'); } },
        { key: 'party', label: 'Paid to', render: function (e) { return ui.escapeHtml(e.party || '—'); } },
        { key: 'method', label: 'Method', badge: {} },
        { key: 'paid', label: 'Status', render: function (e) { return e.paid === false ? '<span class="badge badge-warn">Payable</span>' : '<span class="badge badge-good">Paid</span>'; } },
        { key: 'amount', label: 'Amount', num: true, money: true }
      ],
      rows: entries, searchKeys: ['category', 'desc', 'party'], quickFilter: 'category', filterPanel: true, dateKey: 'date',
      exportName: 'group-expenses.csv', pdfTitle: 'Epal Group — Expenses',
      actions: ui.actions({
        edit: can('create') ? function (e) { groupExpenseForm(e); } : null,
        del: can('delete') ? function (e) { deleteGroupExpense(e); } : null
      }),
      empty: { icon: 'receipt', title: 'No group expenses', hint: 'Record office, food or utility costs for the group.' }
    });
    page.appendChild(el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon('receipt') + ' Expense Register' }), el('span.card-sub', { text: entries.length + ' entries · posted to the group ledger' }) ]),
      el('div.card-body', null, [ tbl.el ])
    ]));
  }
  function groupExpenseForm(existing) {
    EPAL.formModal({
      title: existing ? 'Edit Group Expense' : 'Record Group Expense', icon: 'receipt', size: 'md',
      record: existing || { date: gToday(), method: 'Bank', paid: true },
      fields: [
        { key: 'category', label: 'Expense head', type: 'select', required: true, options: GROUP_EXP_HEADS.map(function (h) { return h[0]; }) },
        { key: 'amount', label: 'Amount (৳)', type: 'money', required: true, min: 0 },
        { key: 'date', label: 'Date', type: 'date', default: gToday() },
        { key: 'method', label: 'Method', type: 'select', options: ['Bank', 'Cash', 'bKash', 'Cheque', 'Card'], default: 'Bank' },
        { key: 'party', label: 'Paid to (vendor)', type: 'text', placeholder: 'e.g. City Corp, DESCO' },
        { key: 'paid', label: 'Paid now (uncheck for a payable)', type: 'checkbox', default: true, col2: true },
        { key: 'desc', label: 'Note', type: 'textarea', col2: true }
      ],
      saveLabel: existing ? 'Save' : 'Record',
      onSave: function (val) {
        var r = existing || { id: 'JV-' + ui.uid('').slice(-6).toUpperCase(), companyId: 'group', kind: 'Expense', created: Date.now() };
        r.category = val.category; r.account = acctForHead(val.category); r.amount = +val.amount || 0; r.date = val.date;
        r.method = val.method; r.party = val.party || ''; r.desc = val.desc || ''; r.paid = val.paid !== false;
        postGroupExpense(r);
        ui.toast('Group expense recorded', 'success'); EPAL.router.render(); return true;
      }
    });
  }
  function deleteGroupExpense(e) {
    ui.confirm({ title: 'Delete this expense?', text: (e.category || '') + ' · ' + ui.money(e.amount), danger: true, confirmLabel: 'Delete' }).then(function (ok) {
      if (!ok) return;
      db().remove('acc_entries', e.id);
      try { LED().post({ id: 'GL-GXR-' + e.id, date: gToday(), companyId: 'group', ref: 'REV-' + e.id, memo: 'Reversal — ' + (e.category || ''), source: 'adjustment', lines: [{ account: e.paid === false ? '2000' : '1010', dr: e.amount, cr: 0 }, { account: e.account, dr: 0, cr: e.amount }] }); } catch (x) { }
      ui.toast('Deleted', 'success'); EPAL.router.render();
    });
  }
  function setBudgetForm(existing) {
    EPAL.formModal({
      title: 'Set Budget', icon: 'bullseye', size: 'sm', record: existing || { period: 'Annual' },
      fields: [
        { key: 'category', label: 'Expense head', type: 'select', required: true, options: GROUP_EXP_HEADS.map(function (h) { return h[0]; }) },
        { key: 'period', label: 'Period', type: 'select', options: ['Monthly', 'Annual'], default: 'Annual' },
        { key: 'amount', label: 'Budget amount (৳)', type: 'money', required: true, min: 0 }
      ],
      saveLabel: 'Save Budget',
      onSave: function (val) {
        EPAL.store.upsert('group_budgets', { id: 'BUD-' + String(val.category).replace(/[^A-Za-z]/g, ''), companyId: 'group', category: val.category, account: acctForHead(val.category), period: val.period, amount: +val.amount || 0 });
        ui.toast('Budget saved', 'success'); EPAL.router.render(); return true;
      }
    });
  }

  /* ==========================================================================
   * OVERVIEW — the consolidated cockpit
   * ========================================================================*/
  /* ---- MD RED-FLAG PANEL (spec C1) — what needs attention across the group,
   * each flag a door to the screen that fixes it. Computed live from the ledger,
   * payroll runs and budgets. ------------------------------------------------*/
  function groupRedFlags() {
    var flags = [];
    if (!hasLedger()) return flags;
    // 1) overdue salaries — payslips still unpaid after the 10th (auto-Due)
    var dueSlips = EPAL.store.list('pay_slips').filter(function (s) { return s.status === 'due'; });
    if (dueSlips.length) {
      var amt = dueSlips.reduce(function (a, s) { return a + Math.max(0, (s.earnedGross - s.tax - s.pf) - (s.paid || 0)); }, 0);
      flags.push({ sev: 'bad', icon: 'cash-stack', title: dueSlips.length + ' salar' + (dueSlips.length === 1 ? 'y' : 'ies') + ' overdue', detail: ui.money(amt) + ' unpaid past the 10th', route: 'travels/payroll/manage' });
    }
    // 2) negative cash in any entity
    activeCompanies().concat([{ id: 'group', short: 'Group HQ' }]).forEach(function (c) {
      var cash = LED().balance('1010', { companyId: c.id }) + LED().balance('1000', { companyId: c.id });
      if (cash < -1) flags.push({ sev: 'bad', icon: 'bank', title: (c.short || c.id) + ' cash negative', detail: ui.money(cash), route: c.id === 'group' ? 'group/finance/banks' : c.id + '/accounts' });
    });
    // 3) receivables overdue (past 30 days)
    if (LED().aging) {
      var overdue = LED().aging('AR', {}).reduce(function (a, r) { return a + (r.d30 || 0) + (r.d60 || 0) + (r.d90 || 0); }, 0);
      if (overdue > 0) flags.push({ sev: 'warn', icon: 'hourglass-split', title: 'Receivables overdue', detail: ui.money(overdue) + ' past 30 days', route: 'group/finance/receivables' });
    }
    // 4) group budget overruns
    var over = 0;
    EPAL.store.list('group_budgets').forEach(function (b) { var act = Math.max(0, LED().balance(b.account, { companyId: 'group' })); var bud = b.period === 'Monthly' ? (b.amount || 0) * 12 : (b.amount || 0); if (bud > 0 && act > bud) over++; });
    if (over) flags.push({ sev: 'warn', icon: 'exclamation-triangle', title: over + ' budget' + (over > 1 ? 's' : '') + ' exceeded', detail: 'group expense over plan', route: 'group/finance/expenses' });
    return flags;
  }
  function renderRedFlagPanel(page) {
    var flags = groupRedFlags();
    var body = el('div.card-body');
    if (!flags.length) body.appendChild(el('div.flex.items-center.gap-2', null, [ ui.frag('<span class="notif-ico notif-success">' + ui.icon('check2-circle') + '</span>'), el('div.text-mute', { text: 'All clear — no red flags across the group.' }) ]));
    else flags.forEach(function (f, i) {
      body.appendChild(el('div.flex.items-center.gap-2', { style: { padding: '9px 0', borderBottom: i < flags.length - 1 ? '1px solid var(--border)' : 'none', cursor: 'pointer' }, onclick: function () { EPAL.router.navigate(f.route); } }, [
        ui.frag('<span class="notif-ico notif-' + (f.sev === 'bad' ? 'error' : f.sev === 'warn' ? 'warning' : 'info') + '">' + ui.icon(f.icon) + '</span>'),
        el('div.flex-1', null, [ el('div.fw-600', { text: f.title }), el('div.text-mute.sm', { text: f.detail }) ]),
        ui.frag('<i class="bi bi-chevron-right text-mute"></i>')
      ]));
    });
    page.appendChild(el('div.card.mb-3', null, [ el('div.card-head', null, [ el('h3', { html: ui.icon('flag-fill') + ' Needs Attention' }), el('span.card-sub', { text: flags.length ? (flags.length + ' flag' + (flags.length > 1 ? 's' : '')) : 'all clear' }) ]), body ]));
  }

  function renderOverview(page) {
    var f = ledgerFinance(null);
    var snap = db().groupSnapshot();
    var cash = bankTotal();
    // Source AR/AP from the same population the KPI cards drill into: when the
    // Deep Core ledger is loaded the receivables/payables desks show ledger
    // aging (renderAgingLedger), so mirror that total here so the cockpit and
    // the desk reconcile; otherwise fall back to the acc_schedules figures.
    var ar, ap;
    if (EPAL.ledger && EPAL.ledger.aging) {
      ar = LED().aging('AR', {}).reduce(function (a, r) { return a + (r.total || 0); }, 0);
      ap = LED().aging('AP', {}).reduce(function (a, r) { return a + (r.total || 0); }, 0);
    } else {
      ar = outstandingOf('Receivable');
      ap = outstandingOf('Payable');
    }

    page.appendChild(head('Consolidated Finance', 'cash-coin',
      'Group-wide P&L, cash position, receivables and payables across ' + snap.companies.length + ' concerns · trailing 12 months.', [
      el('button.btn.btn-ghost', { html: ui.icon('download') + ' P&L CSV', onclick: exportPnlCsv }),
      el('button.btn.btn-primary', { html: ui.icon('bank') + ' Bank Positions',
        onclick: function () { EPAL.router.navigate('group/finance/banks'); } })
    ]));
    page.appendChild(pills(null));

    if (hasLedger()) {
      page.appendChild(el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '14px' } }, [
        el('button.btn.btn-sm.btn-ghost', { html: ui.icon('diagram-2') + ' Chart of Accounts',
          onclick: function () { EPAL.router.navigate('group/finance/coa'); } }),
        el('button.btn.btn-sm.btn-ghost', { html: ui.icon('journal-text') + ' Group Journal',
          onclick: function () { EPAL.router.navigate('group/finance/journal'); } }),
        el('button.btn.btn-sm.btn-ghost', { html: ui.icon('list-columns-reverse') + ' Trial Balance',
          onclick: function () { EPAL.router.navigate('group/finance/trial-balance'); } }),
        el('button.btn.btn-sm.btn-primary', { html: ui.icon('journal-plus') + ' New Journal',
          onclick: function () { newJournal(); } })
      ]));
    }

    page.appendChild(el('div.kpi-grid.stagger', null, [
      kpi('Revenue (12M)', ui.money(f.revenue, { compact: true }), 'graph-up-arrow', 'group/finance/pnl', 'all concerns'),
      kpi('Expense (12M)', ui.money(f.expense, { compact: true }), 'wallet2', 'group/finance/pnl', 'all concerns'),
      kpi('Net Profit', ui.money(f.profit, { compact: true }), 'cash-stack', 'group/finance/pnl', 'revenue less expense'),
      kpi('Blended Margin', ui.pct(f.margin), 'pie-chart-fill', 'group/finance/pnl', 'group-wide'),
      kpi('Cash in Banks', ui.money(cash, { compact: true }), 'bank', 'group/finance/banks', db().col('banks').length + ' accounts'),
      kpi('AR Outstanding', ui.money(ar, { compact: true }), 'arrow-down-left-circle', 'group/finance/receivables', 'to collect'),
      kpi('AP Outstanding', ui.money(ap, { compact: true }), 'arrow-up-right-circle', 'group/finance/payables', 'to settle')
    ]));

    renderRedFlagPanel(page);

    var trendId = ui.uid('gfTrend');
    page.appendChild(chartCard('Revenue, Expense & Profit — Consolidated', 'activity', trendId, 'monthly · all concerns combined', 300));

    page.appendChild(el('div.section-label', { text: 'Per-Company Performance (12M) — click a row to open that concern’s accounts' }));
    var rows = activeCompanies().map(function (c) {
      var cf = ledgerFinance(c.id);
      return { id: c.id, short: c.short, accent: c.accent, icon: c.icon,
        revenue: cf.revenue, expense: cf.expense, profit: cf.profit, margin: cf.margin,
        mom: db().momRevenue(c.id) };
    });
    var ghq = ledgerFinance('group');   // the Group entity's own overhead (office/food/utilities)
    if (ghq.revenue || ghq.expense) rows.push({ id: 'group', short: 'Group HQ', accent: '#1A43BF', icon: 'building', revenue: ghq.revenue, expense: ghq.expense, profit: ghq.profit, margin: ghq.margin, mom: 0 });
    var table = EPAL.table({
      columns: [
        { key: 'short', label: 'Company', render: function (r) {
          return '<span class="strong" style="color:' + r.accent + '"><i class="bi bi-' + r.icon + '"></i> ' + ui.escapeHtml(r.short) + '</span>'; },
          exportVal: function (r) { return r.short; } },
        { key: 'revenue', label: 'Revenue', num: true, money: true },
        { key: 'expense', label: 'Expense', num: true, money: true },
        { key: 'profit', label: 'Profit', num: true, render: function (r) {
          return '<span class="num" style="color:' + (r.profit >= 0 ? GREEN : RED) + '">' + ui.money(r.profit) + '</span>'; },
          exportVal: function (r) { return r.profit; } },
        { key: 'margin', label: 'Margin', num: true, render: function (r) { return '<span class="num">' + ui.pct(r.margin) + '</span>'; },
          exportVal: function (r) { return r.margin.toFixed(1); } },
        { key: 'mom', label: 'MoM', num: true, render: function (r) {
          var up = r.mom >= 0;
          return '<span class="num" style="color:' + (up ? GREEN : RED) + '"><i class="bi bi-arrow-' + (up ? 'up' : 'down') + '-right"></i> ' +
            (up ? '+' : '') + r.mom.toFixed(1) + '%</span>'; },
          exportVal: function (r) { return r.mom.toFixed(1); } }
      ],
      rows: rows, searchKeys: ['short'], pageSize: 10,
      exportName: 'group-company-pnl.csv',
      onRow: function (r) { EPAL.router.navigate(r.id === 'group' ? 'group/finance/expenses' : r.id + '/accounts'); },
      empty: { icon: 'diagram-3', title: 'No active concerns' }
    });
    page.appendChild(el('div.card', null, [ el('div.card-pad', null, [ table.el ]) ]));

    requestAnimationFrame(function () {
      var s = ledgerSeries(null);
      var c = document.getElementById(trendId);
      if (c) EPAL.charts.area(c, { labels: s.labels, legend: true, datasets: [
        { label: 'Revenue', data: s.revenue, color: GOLD },
        { label: 'Profit', data: s.profit, color: GREEN },
        { label: 'Expense', data: s.expense, color: RED }
      ] });
    });
  }

  /* ==========================================================================
   * P&L — month-by-month statement + per-company revenue matrix
   * ========================================================================*/
  function renderPnl(page) {
    var s = ledgerSeries(null), yms = db().months(12), perCo = perCompanySeriesLedger();
    var f = ledgerFinance(null);
    var best = 0;
    s.profit.forEach(function (p, i) { if (p > s.profit[best]) best = i; });

    page.appendChild(head('Profit & Loss — Group', 'graph-up-arrow',
      'Month-by-month consolidated statement with the per-company revenue matrix underneath.', [
      el('button.btn.btn-primary', { html: ui.icon('download') + ' Export Statement (CSV)', onclick: exportPnlCsv })
    ]));
    page.appendChild(pills('pnl'));

    page.appendChild(el('div.kpi-grid', null, [
      kpi('Revenue (12M)', ui.money(f.revenue, { compact: true }), 'cash-coin'),
      kpi('Expense (12M)', ui.money(f.expense, { compact: true }), 'wallet2'),
      kpi('Net Profit', ui.money(f.profit, { compact: true }), 'cash-stack', null, ui.pct(f.margin) + ' margin'),
      kpi('Best Month', s.labels[best], 'trophy', null, ui.money(s.profit[best], { compact: true }) + ' profit')
    ]));

    var barId = ui.uid('pnlBar');
    page.appendChild(chartCard('Revenue vs Expense', 'bar-chart', barId, 'monthly · consolidated', 280));

    var monthRows = yms.map(function (ym, i) {
      var rev = s.revenue[i];
      return { month: s.labels[i] + ' ' + ym.slice(0, 4), ym: ym, revenue: rev,
        expense: s.expense[i], profit: s.profit[i], margin: rev ? s.profit[i] / rev * 100 : 0 };
    });
    page.appendChild(el('div.section-label', { text: 'Monthly P&L Statement' }));
    var t = EPAL.table({
      columns: [
        { key: 'month', label: 'Month', render: function (r) { return '<span class="strong">' + ui.escapeHtml(r.month) + '</span>'; } },
        { key: 'revenue', label: 'Revenue', num: true, money: true },
        { key: 'expense', label: 'Expense', num: true, money: true },
        { key: 'profit', label: 'Profit', num: true, render: function (r) {
          return '<span class="num" style="color:' + (r.profit >= 0 ? GREEN : RED) + '">' + ui.money(r.profit) + '</span>'; },
          exportVal: function (r) { return r.profit; } },
        { key: 'margin', label: 'Margin %', num: true, render: function (r) { return '<span class="num">' + ui.pct(r.margin) + '</span>'; },
          exportVal: function (r) { return r.margin.toFixed(1); } }
      ],
      rows: monthRows, pageSize: 12, searchKeys: ['month'],
      exportName: 'group-pnl-monthly.csv',
      empty: { icon: 'graph-up-arrow', title: 'No financial rows yet' }
    });
    page.appendChild(el('div.card', null, [ el('div.card-pad', null, [ t.el ]) ]));

    // per-company revenue matrix (Month × Company)
    var matrixCols = [{ key: 'month', label: 'Month', render: function (r) { return '<span class="strong">' + ui.escapeHtml(r.month) + '</span>'; } }];
    perCo.forEach(function (p) {
      matrixCols.push({ key: p.co.id, label: p.co.short, num: true, render: function (r) {
        return '<span class="num" style="color:' + p.co.accent + '">' + ui.money(r[p.co.id], { compact: true }) + '</span>'; },
        exportVal: function (r) { return r[p.co.id]; } });
    });
    var matrixRows = yms.map(function (ym, i) {
      var o = { month: s.labels[i] + ' ' + ym.slice(0, 4) };
      perCo.forEach(function (p) { o[p.co.id] = p.series.revenue[i]; });
      return o;
    });
    page.appendChild(el('div.section-label', { text: 'Revenue by Company by Month' }));
    var t2 = EPAL.table({
      columns: matrixCols, rows: matrixRows, pageSize: 12, searchKeys: ['month'],
      exportName: 'group-revenue-matrix.csv',
      empty: { icon: 'grid-3x3', title: 'No revenue rows yet' }
    });
    page.appendChild(el('div.card', null, [ el('div.card-pad', null, [ t2.el ]) ]));

    requestAnimationFrame(function () {
      var c = document.getElementById(barId);
      if (c) EPAL.charts.bar(c, { labels: s.labels, legend: true, money: true, datasets: [
        { label: 'Revenue', data: s.revenue, color: GOLD },
        { label: 'Expense', data: s.expense, color: RED }
      ] });
    });
  }

  /* ==========================================================================
   * CASH FLOW — monthly net movement + cumulative build-up
   * ========================================================================*/
  function renderCashflow(page) {
    var s = ledgerSeries(null), yms = db().months(12);
    var cum = 0;
    var rows = yms.map(function (ym, i) {
      cum += s.profit[i];
      return { month: s.labels[i] + ' ' + ym.slice(0, 4), inflow: s.revenue[i],
        outflow: s.expense[i], net: s.profit[i], cumulative: cum };
    });
    var inflow = s.revenue.reduce(function (a, v) { return a + v; }, 0);
    var outflow = s.expense.reduce(function (a, v) { return a + v; }, 0);
    var positive = s.profit.filter(function (p) { return p > 0; }).length;

    page.appendChild(head('Cash Flow — Group', 'arrow-left-right',
      'Net operating cash movement per month (revenue less expense) and its cumulative build-up.', [
      el('button.btn.btn-ghost', { html: ui.icon('download') + ' Export (CSV)', onclick: function () {
        var lines = [['Month', 'Inflow', 'Outflow', 'Net Movement', 'Cumulative']];
        rows.forEach(function (r) { lines.push([r.month, r.inflow, r.outflow, r.net, r.cumulative]); });
        dl('group-cashflow-12m.csv', lines.map(function (l) { return l.join(','); }).join('\n'));
      } })
    ]));
    page.appendChild(pills('cashflow'));

    page.appendChild(el('div.kpi-grid', null, [
      kpi('Cash In (12M)', ui.money(inflow, { compact: true }), 'arrow-down-left-circle'),
      kpi('Cash Out (12M)', ui.money(outflow, { compact: true }), 'arrow-up-right-circle'),
      kpi('Net Movement', ui.money(inflow - outflow, { compact: true }), 'cash-coin'),
      kpi('Positive Months', positive + ' / 12', 'calendar2-check', null, 'months with net inflow')
    ]));

    var barId = ui.uid('cfBar'), cumId = ui.uid('cfCum');
    var row = el('div.two-col');
    row.appendChild(chartCard('Net Cash Movement', 'bar-chart-steps', barId, 'green = inflow month · red = outflow month', 270));
    row.appendChild(chartCard('Cumulative Cash Curve', 'graph-up', cumId, 'running total of net movement', 270));
    page.appendChild(row);

    page.appendChild(el('div.section-label', { text: 'Monthly Cash Ledger' }));
    var t = EPAL.table({
      columns: [
        { key: 'month', label: 'Month', render: function (r) { return '<span class="strong">' + ui.escapeHtml(r.month) + '</span>'; } },
        { key: 'inflow', label: 'Inflow', num: true, money: true },
        { key: 'outflow', label: 'Outflow', num: true, money: true },
        { key: 'net', label: 'Net Movement', num: true, render: function (r) {
          return '<span class="num" style="color:' + (r.net >= 0 ? GREEN : RED) + '">' + ui.money(r.net) + '</span>'; },
          exportVal: function (r) { return r.net; } },
        { key: 'cumulative', label: 'Cumulative', num: true, money: true }
      ],
      rows: rows, pageSize: 12, searchKeys: ['month'],
      exportName: 'group-cash-ledger.csv',
      empty: { icon: 'cash-coin', title: 'No cash rows yet' }
    });
    page.appendChild(el('div.card', null, [ el('div.card-pad', null, [ t.el ]) ]));

    requestAnimationFrame(function () {
      var c1 = document.getElementById(barId);
      if (c1) EPAL.charts.bar(c1, { labels: s.labels, money: true, datasets: [{
        label: 'Net Movement', data: s.profit,
        colors: s.profit.map(function (p) { return p >= 0 ? GREEN : RED; })
      }] });
      var c2 = document.getElementById(cumId);
      if (c2) EPAL.charts.area(c2, { labels: s.labels, money: true, datasets: [
        { label: 'Cumulative', data: rows.map(function (r) { return r.cumulative; }), color: GOLD }
      ] });
    });
  }

  /* ==========================================================================
   * BALANCE SHEET — a clearly-labelled management view (derived, not audited)
   * ========================================================================*/
  function renderBalanceSheet(page) {
    if (EPAL.ledger && EPAL.ledger.balanceSheet) { renderBalanceSheetLedger(page); return; }
    var banks = db().col('banks').slice().sort(function (a, b) { return (b.balance || 0) - (a.balance || 0); });
    var cash = bankTotal();
    var ar = outstandingOf('Receivable'), ap = outstandingOf('Payable');
    var assets = cash + ar, equity = assets - ap;
    var arCount = schedules('Receivable').filter(function (x) { return x.status !== 'Paid'; }).length;
    var apCount = schedules('Payable').filter(function (x) { return x.status !== 'Paid'; }).length;

    page.appendChild(head('Balance Sheet — Management View', 'clipboard-data',
      'Position statement as at ' + ui.date(new Date(), 'long') + ' · derived live from operational data.', [
      el('button.btn.btn-ghost', { html: ui.icon('download') + ' Export (CSV)', onclick: function () {
        var lines = [['Section', 'Line', 'Amount']];
        banks.forEach(function (b) { lines.push(['Assets', b.name + ' (' + b.branch + ')', b.balance]); });
        lines.push(['Assets', 'Accounts Receivable — outstanding', ar]);
        lines.push(['Assets', 'TOTAL ASSETS', assets]);
        lines.push(['Liabilities', 'Accounts Payable — outstanding', ap]);
        lines.push(['Equity', 'Retained Surplus (derived)', equity]);
        lines.push(['Total', 'LIABILITIES + EQUITY', ap + equity]);
        dl('group-balance-sheet.csv', lines.map(function (l) { return l.join(','); }).join('\n'));
      } })
    ]));
    page.appendChild(pills('balance-sheet'));

    page.appendChild(el('div.kpi-grid', null, [
      kpi('Total Assets', ui.money(assets, { compact: true }), 'safe2', null, 'cash + receivables'),
      kpi('Total Liabilities', ui.money(ap, { compact: true }), 'file-earmark-minus', 'group/finance/payables', apCount + ' open payables'),
      kpi('Equity (derived)', ui.money(equity, { compact: true }), 'gem', null, 'assets less liabilities'),
      kpi('Liability Coverage', ap ? (assets / ap).toFixed(2) + 'x' : '∞', 'shield-check', null, 'assets ÷ liabilities')
    ]));

    function stRow(label, amount, opts) {
      opts = opts || {};
      return el('div.flex.justify-between.items-center', {
        style: { padding: '9px 2px', borderBottom: '1px solid rgba(128,128,128,.14)',
          paddingLeft: opts.indent ? '18px' : '2px' }
      }, [
        el('span' + (opts.strong ? '.strong' : '.text-mute'), { text: label }),
        el('span.num' + (opts.strong ? '.strong' : ''), {
          text: ui.money(amount),
          style: opts.color ? { color: opts.color } : null
        })
      ]);
    }

    var left = el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon('safe2') + ' Assets' }),
        el('span.card-sub', { text: 'what the group holds' }) ]),
      el('div.card-body', null, (function () {
        var kids = [ el('div.section-label', { style: { marginTop: '0' }, text: 'Cash & Bank Balances' }) ];
        banks.forEach(function (b) {
          kids.push(stRow(b.name + ' · ' + (b.branch || '—'), b.balance, { indent: true }));
        });
        kids.push(stRow('Subtotal — Cash & Bank', cash, { strong: true }));
        kids.push(el('div.section-label', { text: 'Receivables' }));
        kids.push(stRow('Accounts Receivable — outstanding (' + arCount + ' schedules)', ar, { indent: true }));
        kids.push(stRow('TOTAL ASSETS', assets, { strong: true, color: GREEN }));
        return kids;
      })())
    ]);

    var right = el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon('file-earmark-minus') + ' Liabilities & Equity' }),
        el('span.card-sub', { text: 'what the group owes + owner value' }) ]),
      el('div.card-body', null, [
        el('div.section-label', { style: { marginTop: '0' }, text: 'Liabilities' }),
        stRow('Accounts Payable — outstanding (' + apCount + ' schedules)', ap, { indent: true }),
        stRow('Subtotal — Liabilities', ap, { strong: true, color: RED }),
        el('div.section-label', { text: 'Equity' }),
        stRow('Retained Surplus (derived balancing figure)', equity, { indent: true }),
        stRow('Subtotal — Equity', equity, { strong: true }),
        stRow('TOTAL LIABILITIES + EQUITY', ap + equity, { strong: true, color: GOLD }),
        el('div.mt-3', {
          style: { display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '12px',
            borderRadius: '10px', border: '1px dashed rgba(200,162,74,.45)', fontSize: '12.5px' },
          html: ui.icon('info-circle') + ' <span class="text-mute">Management view, not an audited statement: assets are live bank ' +
            'balances plus uncollected receivable schedules; liabilities are unsettled payable schedules; ' +
            'equity is the derived balancing figure. Fixed assets and loans are outside this operational scope.</span>'
        })
      ])
    ]);

    var cols = el('div.two-col');
    cols.appendChild(left); cols.appendChild(right);
    page.appendChild(cols);

    var mixId = ui.uid('bsMix');
    page.appendChild(chartCard('Asset Composition', 'pie-chart', mixId, 'bank balances + receivables', 280));
    requestAnimationFrame(function () {
      var c = document.getElementById(mixId);
      if (c) EPAL.charts.doughnut(c, {
        labels: banks.map(function (b) { return b.name; }).concat(['Receivables (AR)']),
        data: banks.map(function (b) { return b.balance || 0; }).concat([ar]),
        legend: 'bottom'
      });
    });
  }

  /* ==========================================================================
   * RECEIVABLES / PAYABLES — aging buckets, settlement, aging chart
   * ========================================================================*/
  function renderAging(page, kind) {
    if (EPAL.ledger && EPAL.ledger.aging) { renderAgingLedger(page, kind); return; }
    var isAR = kind === 'Receivable';
    var title = isAR ? 'Receivables — Collections Desk' : 'Payables — Settlement Desk';
    var icon = isAR ? 'arrow-down-left-circle' : 'arrow-up-right-circle';
    var subKey = isAR ? 'receivables' : 'payables';

    function rows() { return schedules(kind).map(decorate); }
    function open() { return rows().filter(function (r) { return r.status !== 'Paid'; }); }
    function bucketSum(b) {
      return open().filter(function (r) { return r.bucket === b; })
        .reduce(function (a, r) { return a + r.amount; }, 0);
    }
    function bucketCount(b) { return open().filter(function (r) { return r.bucket === b; }).length; }

    var BUCKETS = ['Current', '1–30d', '31–60d', '60+d'];
    var BUCKET_COLORS = [GREEN, AMBER, ORANGE, RED];

    page.appendChild(head(title, icon,
      (isAR ? 'Who owes the group money and how overdue it is. ' : 'Who the group owes and how overdue it is. ') +
      'Aging is computed against today from each schedule’s due date.', [
      el('button.btn.btn-primary', { html: ui.icon('plus-lg') + ' New ' + kind, onclick: function () { editSchedule(null); } })
    ]));
    page.appendChild(pills(subKey));

    page.appendChild(el('div.kpi-grid', null, BUCKETS.map(function (b, i) {
      var host = kpi(b === 'Current' ? 'Current (not due)' : b + ' overdue',
        ui.money(bucketSum(b), { compact: true }),
        ['check2-circle', 'hourglass-split', 'exclamation-triangle', 'exclamation-octagon'][i],
        null, bucketCount(b) + ' schedule' + (bucketCount(b) === 1 ? '' : 's'));
      host.style.borderTop = '3px solid ' + BUCKET_COLORS[i];
      return host;
    })));

    var agingId = ui.uid('aging');
    page.appendChild(chartCard('Aging Distribution', 'bar-chart', agingId,
      'outstanding ' + (isAR ? 'receivable' : 'payable') + ' value per bucket', 240));

    page.appendChild(el('div.section-label', {
      text: 'All ' + (isAR ? 'Receivable' : 'Payable') + ' Schedules — total outstanding ' + ui.money(outstandingOf(kind), { compact: true })
    }));
    var table = EPAL.table({
      columns: [
        { key: 'id', label: 'Ref' },
        { key: 'party', label: 'Party', render: function (r) { return '<span class="strong">' + ui.escapeHtml(r.party) + '</span>'; } },
        { key: 'companyId', label: 'Company', render: function (r) { return coBadge(r.companyId); },
          exportVal: function (r) { return r.companyId; } },
        { key: 'ref', label: 'Invoice' },
        { key: 'amount', label: 'Amount', num: true, money: true },
        { key: 'due', label: 'Due', date: true },
        { key: 'days', label: 'Overdue', num: true, render: function (r) {
          if (r.status === 'Paid') return '<span class="text-mute">—</span>';
          if (r.days <= 0) return '<span class="num" style="color:' + GREEN + '">in ' + (-r.days) + 'd</span>';
          return '<span class="num" style="color:' + (r.days > 60 ? RED : r.days > 30 ? ORANGE : AMBER) + '">' + r.days + 'd</span>'; },
          exportVal: function (r) { return r.status === 'Paid' ? 0 : r.days; } },
        { key: 'bucket', label: 'Aging', badge: { 'Current': 'good', '1–30d': 'warn', '31–60d': 'accent', '60+d': 'bad', 'Settled': 'info' } },
        { key: 'status', label: 'Status', badge: { Paid: 'good', Partial: 'warn', Pending: 'bad' } }
      ],
      rows: rows,
      filters: [{ key: 'status', label: 'Status' }, { key: 'bucket', label: 'Aging' }, { key: 'companyId', label: 'Company' }],
      searchKeys: ['id', 'party', 'ref'],
      exportName: 'group-' + subKey + '-aging.csv',
      onRow: function (r) { editSchedule(r); },
      actions: [
        { icon: 'check2-circle', title: isAR ? 'Mark collected' : 'Mark settled', onClick: function (r) {
          if (r.status === 'Paid') { ui.toast('Already settled', 'info'); return; }
          ui.confirm({ title: (isAR ? 'Mark ' + r.id + ' as collected?' : 'Mark ' + r.id + ' as settled?'),
            text: ui.money(r.amount) + ' · ' + r.party, icon: 'check2-circle', confirmLabel: 'Yes, mark paid' })
            .then(function (ok) {
              if (!ok) return;
              var rec = db().col('acc_schedules').filter(function (x) { return x.id === r.id; })[0];
              if (!rec) return;
              rec.status = 'Paid';
              db().save('acc_schedules', rec);
              db().notify({ level: 'success', title: kind + ' settled', icon: 'check-circle-fill',
                text: rec.party + ' · ' + ui.money(rec.amount), companyId: rec.companyId });
              db().log(EPAL.auth.current ? (EPAL.auth.current() || {}).name || 'Finance' : 'Finance',
                kind + ' ' + rec.id + ' settled · ' + ui.money(rec.amount), rec.companyId);
              ui.toast(kind + ' marked paid', 'success');
              EPAL.router.render();
            });
        } },
        { icon: 'pencil', title: 'Edit', onClick: function (r) { editSchedule(r); } },
        { icon: 'trash', title: 'Delete', onClick: function (r) {
          ui.confirm({ title: 'Delete schedule ' + r.id + '?', danger: true, confirmLabel: 'Delete' }).then(function (ok) {
            if (ok) { db().remove('acc_schedules', r.id); ui.toast('Schedule deleted', 'success'); EPAL.router.render(); }
          });
        } }
      ],
      empty: { icon: 'calendar2-week', title: 'No ' + subKey + ' yet', hint: 'Add the first schedule to start tracking aging.' }
    });
    page.appendChild(el('div.card', null, [ el('div.card-pad', null, [ table.el ]) ]));

    requestAnimationFrame(function () {
      var c = document.getElementById(agingId);
      if (c) EPAL.charts.bar(c, { labels: ['Current', '1–30 days', '31–60 days', '60+ days'], money: true,
        datasets: [{ label: 'Outstanding', data: BUCKETS.map(bucketSum), colors: BUCKET_COLORS }] });
    });

    function editSchedule(r) {
      // strip decoration so we edit the raw stored record
      var rec = r ? db().col('acc_schedules').filter(function (x) { return x.id === r.id; })[0] : null;
      EPAL.formModal({
        title: rec ? 'Edit ' + kind + ' ' + rec.id : 'New ' + kind, icon: icon, record: rec,
        fields: [
          { key: 'party', label: 'Party', type: 'text', required: true, col2: true,
            placeholder: isAR ? 'e.g. Bashundhara Group' : 'e.g. BSRM Steels' },
          { key: 'companyId', label: 'Company', type: 'select', required: true,
            options: activeCompanies().map(function (c) { return [c.id, c.short]; }) },
          { key: 'amount', label: 'Amount (৳)', type: 'money', required: true, min: 1 },
          { key: 'due', label: 'Due Date', type: 'date', required: true, default: new Date().toISOString().slice(0, 10) },
          { key: 'ref', label: 'Invoice Ref', type: 'text', placeholder: 'INV-XXXX' },
          { key: 'status', label: 'Status', type: 'select', options: ['Pending', 'Partial', 'Paid'], default: 'Pending' }
        ],
        onSave: function (vals) {
          var record = Object.assign({}, rec || { id: 'SCH-' + Date.now().toString().slice(-6), kind: kind,
            created: new Date().toISOString().slice(0, 10) }, vals);
          db().save('acc_schedules', record);
          ui.toast(kind + ' schedule saved', 'success');
          EPAL.router.render();
        }
      });
    }
  }

  /* ==========================================================================
   * BANKS — every account across the group, add / edit, balance mix
   * ========================================================================*/
  function renderBanks(page) {
    function rows() { return db().col('banks'); }
    var all = rows();
    var total = bankTotal();
    var largest = all.slice().sort(function (a, b) { return (b.balance || 0) - (a.balance || 0); })[0];

    page.appendChild(head('Bank Positions', 'bank',
      'Every bank and mobile-money account across the group with live balances. Account numbers are masked on screen.', [
      el('button.btn.btn-primary', { html: ui.icon('plus-lg') + ' Add Bank Account', onclick: function () { editBank(null); } })
    ]));
    page.appendChild(pills('banks'));

    page.appendChild(el('div.kpi-grid', null, [
      kpi('Total Cash Position', ui.money(total, { compact: true }), 'safe2'),
      kpi('Accounts', all.length, 'bank', null, 'across all concerns'),
      kpi('Largest Balance', largest ? ui.money(largest.balance, { compact: true }) : '—', 'trophy',
        null, largest ? largest.name + ' · ' + (largest.branch || '—') : ''),
      kpi('Average Balance', all.length ? ui.money(total / all.length, { compact: true }) : '—', 'distribute-vertical')
    ]));

    var mixId = ui.uid('bankMix');
    var row = el('div.two-col');
    row.appendChild(chartCard('Balance by Bank', 'pie-chart', mixId, 'share of the group cash position', 280));

    // cash held per concern — the CFO's "who is sitting on the cash" card
    var byCo = {};
    all.forEach(function (b) {
      var k = b.companyId || 'group';
      byCo[k] = byCo[k] || { total: 0, count: 0 };
      byCo[k].total += b.balance || 0; byCo[k].count++;
    });
    var coRows = Object.keys(byCo).sort(function (a, b) { return byCo[b].total - byCo[a].total; });
    row.appendChild(el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon('diagram-3') + ' Cash by Concern' }),
        el('span.card-sub', { text: 'holding entity of each account' }) ]),
      el('div.card-body', null, [
        el('div.data-list', null, coRows.map(function (k) {
          var co = EPAL.config.company(k);
          var share = total ? byCo[k].total / total * 100 : 0;
          return el('div.data-row', null, [
            el('div.flex-1', null, [
              el('div.fw-600', { text: co ? co.short : k, style: co ? { color: co.accent } : null }),
              el('div.text-mute.xs', { text: byCo[k].count + ' account' + (byCo[k].count === 1 ? '' : 's') + ' · ' + ui.pct(share) + ' of position' }),
              el('div.progress.mt-1', null, [ el('div.progress-bar', {
                style: { width: Math.max(2, Math.round(share)) + '%', background: co ? co.accent : GOLD } }) ])
            ]),
            el('span.num.strong', { text: ui.money(byCo[k].total, { compact: true }) })
          ]);
        }))
      ])
    ]));
    page.appendChild(row);

    var table = EPAL.table({
      columns: [
        { key: 'name', label: 'Bank', render: function (b) {
          return '<span class="strong">' + ui.icon('bank') + ' ' + ui.escapeHtml(b.name) + '</span>'; } },
        { key: 'branch', label: 'Branch' },
        { key: 'account', label: 'Account', render: function (b) {
          return '<span class="num text-mute">•••• ' + ui.escapeHtml(String(b.account || '').slice(-4)) + '</span>'; },
          exportVal: function (b) { return '****' + String(b.account || '').slice(-4); } },
        { key: 'companyId', label: 'Company', render: function (b) { return coBadge(b.companyId); },
          exportVal: function (b) { return b.companyId; } },
        { key: 'balance', label: 'Balance', num: true, money: true },
        { key: 'created', label: 'Opened', date: true }
      ],
      rows: rows,
      filters: [{ key: 'companyId', label: 'Company' }, { key: 'name', label: 'Bank' }],
      searchKeys: ['name', 'branch'],
      exportName: 'group-bank-positions.csv',
      onRow: function (b) { editBank(b); },
      actions: [
        { icon: 'pencil', title: 'Edit', onClick: function (b) { editBank(b); } },
        { icon: 'trash', title: 'Remove', onClick: function (b) {
          ui.confirm({ title: 'Remove ' + b.name + ' account?', text: 'Balance ' + ui.money(b.balance) + ' will leave the cash position.',
            danger: true, confirmLabel: 'Remove' }).then(function (ok) {
            if (ok) { db().remove('banks', b.id); ui.toast('Bank account removed', 'success'); EPAL.router.render(); }
          });
        } }
      ],
      empty: { icon: 'bank', title: 'No bank accounts yet', hint: 'Add the first account to build the cash position.' }
    });
    page.appendChild(el('div.section-label', { text: 'All Accounts' }));
    page.appendChild(el('div.card', null, [ el('div.card-pad', null, [ table.el ]) ]));

    requestAnimationFrame(function () {
      var c = document.getElementById(mixId);
      var list = rows();
      if (c && list.length) EPAL.charts.doughnut(c, {
        labels: list.map(function (b) { return b.name; }),
        data: list.map(function (b) { return b.balance || 0; }),
        legend: 'bottom'
      });
    });

    function editBank(b) {
      EPAL.formModal({
        title: b ? 'Edit Bank Account' : 'Add Bank Account', icon: 'bank', record: b,
        fields: [
          { key: 'name', label: 'Bank', type: 'text', required: true, placeholder: 'e.g. BRAC Bank', col2: true },
          { key: 'branch', label: 'Branch', type: 'text', required: true, placeholder: 'e.g. Gulshan Avenue' },
          { key: 'account', label: 'Account Number', type: 'text', required: true, pattern: /^\d{6,18}$/,
            hint: '6–18 digits · shown masked everywhere else', placeholder: '15XXXXXXXX' },
          { key: 'companyId', label: 'Owned By', type: 'select', required: true,
            options: EPAL.config.companies.map(function (c) { return [c.id, c.short]; }) },
          { key: 'balance', label: 'Current Balance (৳)', type: 'money', required: true, min: 0 }
        ],
        onSave: function (vals) {
          var rec = Object.assign({}, b || { id: 'BNK-' + Date.now().toString().slice(-5),
            created: new Date().toISOString().slice(0, 10) }, vals);
          db().save('banks', rec);
          db().log(EPAL.auth.current ? (EPAL.auth.current() || {}).name || 'Finance' : 'Finance',
            (b ? 'Bank account updated' : 'Bank account added') + ' · ' + rec.name + ' (' + rec.branch + ')', rec.companyId);
          ui.toast('Bank account saved', 'success');
          EPAL.router.render();
        }
      });
    }
  }

  /* ==========================================================================
   * LEDGER-DERIVED SUB-SCREENS  (powered by EPAL.ledger, the double-entry GL)
   * ========================================================================*/
  function ledgerMissing() {
    return el('div.card', null, [ el('div.empty-state', null, [
      ui.frag(ui.icon('plug')), el('h3', { text: 'Ledger engine unavailable' }),
      el('p.text-muted', { text: 'The double-entry ledger (EPAL.ledger) is not loaded in this build.' })
    ]) ]);
  }
  function metaRow(label, val) {
    return el('div.data-row', null, [
      el('span.text-mute', { text: label }),
      el('span.strong', { text: String(val == null ? '—' : val) })
    ]);
  }
  // a compact running-balance table (account ledger / party statement drawers)
  function miniLedgerTable(rows) {
    if (!rows.length) return el('div.empty-state', null, [ ui.frag(ui.icon('inbox')), el('h3', { text: 'No movement' }) ]);
    var t = el('table.tbl');
    t.appendChild(el('thead', null, [ el('tr', null, [
      el('th', { text: 'Date' }), el('th', { text: 'Ref' }), el('th', { text: 'Memo' }),
      el('th.num', { text: 'Debit' }), el('th.num', { text: 'Credit' }), el('th.num', { text: 'Balance' })
    ]) ]));
    var tb = el('tbody');
    rows.forEach(function (r) {
      tb.appendChild(el('tr', null, [
        el('td', { text: ui.date(r.date) }),
        el('td', { text: r.ref || '—' }),
        el('td', { text: r.memo || '—' }),
        el('td.num', { html: r.debit ? ui.money(r.debit) : '—' }),
        el('td.num', { html: r.credit ? ui.money(r.credit) : '—' }),
        el('td.num', { html: '<span class="num">' + ui.money(r.balance) + '</span>' })
      ]));
    });
    t.appendChild(tb);
    return el('div.table-wrap', null, [ t ]);
  }

  /* ---- Chart of Accounts --------------------------------------------------*/
  var TYPE_META = [
    ['asset', 'Assets', 'safe2'], ['liability', 'Liabilities', 'file-earmark-minus'],
    ['equity', 'Equity', 'gem'], ['income', 'Income', 'graph-up-arrow'], ['expense', 'Expenses', 'wallet2']
  ];
  function renderCoa(page) {
    var accts = hasLedger() ? LED().accounts() : [];
    page.appendChild(head('Chart of Accounts', 'diagram-2',
      'The group double-entry chart of accounts — ' + accts.length + ' ledger accounts in ' +
      TYPE_META.length + ' classes. Live balances are computed from the general ledger.', [
      el('button.btn.btn-primary', { html: ui.icon('journal-plus') + ' New Journal', onclick: function () { newJournal(); } })
    ]));
    page.appendChild(pills('coa'));
    if (!hasLedger()) { page.appendChild(ledgerMissing()); return; }

    var counts = {};
    accts.forEach(function (a) { counts[a.type] = (counts[a.type] || 0) + 1; });
    page.appendChild(el('div.kpi-grid', null, TYPE_META.map(function (t) {
      return kpi(t[1], counts[t[0]] || 0, t[2], null, 'ledger accounts');
    })));

    TYPE_META.forEach(function (t) {
      var list = accts.filter(function (a) { return a.type === t[0]; });
      if (!list.length) return;
      var rows = list.map(function (a) {
        return { code: a.code, name: a.name, group: a.group || '—', normal: a.normal, balance: LED().balance(a.code, {}) };
      });
      page.appendChild(el('div.section-label', { html: ui.icon(t[2]) + ' ' + t[1] }));
      var tbl = EPAL.table({
        columns: [
          { key: 'code', label: 'Code', render: function (r) { return '<span class="num strong">' + ui.escapeHtml(r.code) + '</span>'; } },
          { key: 'name', label: 'Account', render: function (r) { return '<span class="strong">' + ui.escapeHtml(r.name) + '</span>'; } },
          { key: 'group', label: 'Group' },
          { key: 'normal', label: 'Normal', badge: { debit: 'info', credit: 'accent' } },
          { key: 'balance', label: 'Balance', num: true, render: function (r) {
            return '<span class="num" style="color:' + (r.balance >= 0 ? GREEN : RED) + '">' + ui.money(r.balance) + '</span>'; },
            exportVal: function (r) { return r.balance; } }
        ],
        rows: rows, pageSize: 25, searchKeys: ['code', 'name', 'group'],
        exportName: 'coa-' + t[0] + '.csv',
        onRow: function (r) { openAccountLedger(r.code, r.name); },
        empty: { icon: 'diagram-2', title: 'No accounts' }
      });
      page.appendChild(el('div.card', null, [ el('div.card-pad', null, [ tbl.el ]) ]));
    });
  }
  function openAccountLedger(code, name) {
    var rows = hasLedger() ? LED().ledgerFor(code, {}) : [];
    var body = el('div', null, [
      el('div.text-mute.mb-2', { text: 'Running general-ledger movement for account ' + code + '.' }),
      miniLedgerTable(rows)
    ]);
    ui.modal({ title: code + ' · ' + name, icon: 'journal-text', size: 'xl', body: body,
      actions: [{ label: 'Close', variant: 'ghost' }] });
  }

  /* ---- Group Journal ------------------------------------------------------*/
  function entryDebit(e) { var d = 0; e.lines.forEach(function (l) { d += +l.dr || 0; }); return d; }
  function renderJournal(page) {
    var entries = hasLedger() ? LED().entries({}) : [];
    page.appendChild(head('Group Journal', 'journal-text',
      'Every double-entry journal across all concerns — ' + entries.length + ' posted entries. Filter by ' +
      'company or source; open any entry to inspect its debit/credit lines.', [
      el('button.btn.btn-primary', { html: ui.icon('journal-plus') + ' New Journal', onclick: function () { newJournal(); } })
    ]));
    page.appendChild(pills('journal'));
    if (!hasLedger()) { page.appendChild(ledgerMissing()); return; }

    var totalVal = 0, srcSet = {};
    entries.forEach(function (e) { totalVal += entryDebit(e); srcSet[e.source] = 1; });

    page.appendChild(el('div.kpi-grid', null, [
      kpi('Posted Entries', entries.length, 'journals', null, 'across the group'),
      kpi('Posted Value', ui.money(totalVal, { compact: true }), 'cash-stack', null, 'sum of debits'),
      kpi('Sources', Object.keys(srcSet).length, 'tags', null, 'entry origins'),
      kpi('Chart Accounts', LED().accounts().length, 'diagram-2', 'group/finance/coa', 'open CoA')
    ]));

    var rows = entries.map(function (e) {
      return { id: e.id, date: e.date, companyId: e.companyId, source: e.source,
        ref: e.ref || '—', memo: e.memo || '—', party: e.party || '—',
        amount: entryDebit(e), count: e.lines.length, _e: e };
    }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });

    page.appendChild(el('div.section-label', { text: 'Journal Entries — newest first · click a row for its lines' }));
    var table = EPAL.table({
      columns: [
        { key: 'date', label: 'Date', date: true },
        { key: 'id', label: 'Entry', render: function (r) { return '<span class="num">' + ui.escapeHtml(r.id) + '</span>'; } },
        { key: 'companyId', label: 'Company', render: function (r) { return coBadge(r.companyId); }, exportVal: function (r) { return r.companyId; } },
        { key: 'source', label: 'Source', badge: { sale: 'good', manual: 'info', payroll: 'accent', refund: 'warn', opening: 'info', adjustment: 'warn' } },
        { key: 'ref', label: 'Ref' },
        { key: 'memo', label: 'Memo', render: function (r) { return '<span class="text-mute">' + ui.escapeHtml(r.memo) + '</span>'; } },
        { key: 'party', label: 'Party' },
        { key: 'amount', label: 'Amount', num: true, money: true },
        { key: 'count', label: 'Lines', num: true, render: function (r) { return '<span class="badge badge-info">' + r.count + '</span>'; }, exportVal: function (r) { return r.count; } }
      ],
      rows: rows,
      filters: [{ key: 'companyId', label: 'Company' }, { key: 'source', label: 'Source' }],
      searchKeys: ['id', 'ref', 'memo', 'party'], pageSize: 15,
      exportName: 'group-journal.csv',
      onRow: function (r) { openEntry(r._e); },
      empty: { icon: 'journal-x', title: 'No journal entries', hint: 'Post the first entry with New Journal.' }
    });
    page.appendChild(el('div.card', null, [ el('div.card-pad', null, [ table.el ]) ]));
  }
  function openEntry(e) {
    var dr = 0, cr = 0;
    e.lines.forEach(function (l) { dr += +l.dr || 0; cr += +l.cr || 0; });
    var co = EPAL.config.company(e.companyId);
    var body = el('div');
    body.appendChild(el('div.data-list.mb-3', null, [
      metaRow('Entry', e.id), metaRow('Date', ui.date(e.date)),
      metaRow('Company', co ? co.short : e.companyId), metaRow('Source', e.source),
      e.ref ? metaRow('Reference', e.ref) : null,
      e.party ? metaRow('Party', e.party) : null,
      e.memo ? metaRow('Memo', e.memo) : null
    ]));
    var t = el('table.tbl');
    t.appendChild(el('thead', null, [ el('tr', null, [
      el('th', { text: 'Account' }), el('th.num', { text: 'Debit' }), el('th.num', { text: 'Credit' })
    ]) ]));
    var tb = el('tbody');
    e.lines.forEach(function (l) {
      var acc = hasLedger() ? LED().account(l.account) : null;
      tb.appendChild(el('tr', null, [
        el('td', { html: '<span class="num">' + ui.escapeHtml(String(l.account)) + '</span> ' + ui.escapeHtml(acc ? acc.name : '') }),
        el('td.num', { html: l.dr ? ui.money(l.dr) : '—' }),
        el('td.num', { html: l.cr ? ui.money(l.cr) : '—' })
      ]));
    });
    tb.appendChild(el('tr', null, [
      el('td', { html: '<span class="strong">Totals</span>' }),
      el('td.num', { html: '<span class="strong">' + ui.money(dr) + '</span>' }),
      el('td.num', { html: '<span class="strong">' + ui.money(cr) + '</span>' })
    ]));
    t.appendChild(tb);
    body.appendChild(el('div.table-wrap', null, [ t ]));
    if (EPAL.comments && EPAL.comments.widget) {
      body.appendChild(el('div.section-label', { text: 'Discussion' }));
      body.appendChild(EPAL.comments.widget('gl_entries', e.id));
    }
    ui.modal({ title: 'Journal ' + e.id, icon: 'journal-text', size: 'xl', body: body,
      actions: [{ label: 'Close', variant: 'ghost' }] });
  }
  function newJournal() {
    if (!hasLedger()) { ui.toast('Ledger engine not available', 'error'); return; }
    if (!can('create')) { ui.toast('You do not have permission to post journals', 'error'); return; }
    var accOpts = LED().accounts().map(function (a) { return [a.code, a.code + ' · ' + a.name]; });
    function balNote(rowsArr) {
      var dr = 0, cr = 0;
      (rowsArr || []).forEach(function (l) { dr += +l.dr || 0; cr += +l.cr || 0; });
      var diff = dr - cr, ok = Math.abs(diff) < 0.5;
      return '<div class="flex justify-between" style="font-variant-numeric:tabular-nums">' +
        '<span>Debits <b>' + ui.money(dr) + '</b> &nbsp; Credits <b>' + ui.money(cr) + '</b></span>' +
        '<span style="color:' + (ok ? GREEN : RED) + '">' +
        (ok ? '● Balanced' : '● Out by ' + ui.money(Math.abs(diff))) + '</span></div>';
    }
    EPAL.formModal({
      title: 'New Journal Entry', icon: 'journal-plus', size: 'xl',
      fields: [
        { key: 'date', label: 'Date', type: 'date', required: true, default: new Date().toISOString().slice(0, 10), col2: true },
        { key: 'companyId', label: 'Company', type: 'select', required: true,
          options: EPAL.config.companies.map(function (c) { return [c.id, c.short]; }) },
        { key: 'ref', label: 'Reference', type: 'text', placeholder: 'Voucher / doc no', col2: true },
        { key: 'source', label: 'Source', type: 'select', default: 'manual',
          options: ['manual', 'sale', 'payroll', 'refund', 'opening', 'adjustment'] },
        { key: 'party', label: 'Party (optional)', type: 'text', placeholder: 'Customer / vendor name', col2: true },
        { key: 'memo', label: 'Memo', type: 'text', placeholder: 'Narration' },
        { key: 'lines', type: 'items', label: 'Journal Lines', required: true, min: 2, addLabel: 'Add line',
          columns: [
            { key: 'account', label: 'Account', type: 'select', options: accOpts, width: '2fr' },
            { key: 'dr', label: 'Debit', type: 'money', width: '1fr' },
            { key: 'cr', label: 'Credit', type: 'money', width: '1fr' }
          ],
          footer: function (rowsArr) { return balNote(rowsArr); } }
      ],
      onSave: function (vals) {
        var lines = (vals.lines || []).filter(function (l) { return l.account && ((+l.dr) || (+l.cr)); })
          .map(function (l) { return { account: l.account, dr: +l.dr || 0, cr: +l.cr || 0 }; });
        if (lines.length < 2) { ui.toast('A journal needs at least two posting lines', 'error'); return false; }
        try {
          var entry = LED().post({ date: vals.date, companyId: vals.companyId, ref: vals.ref,
            memo: vals.memo, source: vals.source || 'manual', party: vals.party, lines: lines });
          ui.toast('Journal ' + entry.id + ' posted', 'success');
          EPAL.router.render();
        } catch (e) {
          ui.toast(e && e.message ? e.message : 'Entry does not balance', 'error');
          return false;
        }
      }
    });
  }

  /* ---- Consolidated Trial Balance -----------------------------------------*/
  function renderTrialBalance(page) {
    var tb = hasLedger() ? LED().trialBalance() : [];
    var totDr = 0, totCr = 0;
    tb.forEach(function (r) { totDr += r.debit; totCr += r.credit; });
    var balanced = Math.abs(totDr - totCr) < 1;

    page.appendChild(head('Consolidated Trial Balance', 'list-columns-reverse',
      'Every account with a live balance, consolidated across all concerns as at ' + ui.date(new Date(), 'long') + '.', [
      el('button.btn.btn-ghost', { html: ui.icon('download') + ' Export (CSV)', onclick: function () { exportTrialBalance(tb); } })
    ]));
    page.appendChild(pills('trial-balance'));
    if (!hasLedger()) { page.appendChild(ledgerMissing()); return; }

    page.appendChild(el('div.kpi-grid', null, [
      kpi('Total Debits', ui.money(totDr, { compact: true }), 'arrow-down-circle'),
      kpi('Total Credits', ui.money(totCr, { compact: true }), 'arrow-up-circle'),
      kpi('Difference', ui.money(Math.abs(totDr - totCr), { compact: true }),
        balanced ? 'check-circle' : 'exclamation-triangle', null, balanced ? 'in balance' : 'OUT OF BALANCE'),
      kpi('Accounts', tb.length, 'diagram-2', 'group/finance/coa', 'with movement')
    ]));

    page.appendChild(el('div.card', null, [ el('div', {
      style: { padding: '12px 16px', display: 'flex', gap: '10px', alignItems: 'center',
        borderLeft: '4px solid ' + (balanced ? GREEN : RED) },
      html: ui.icon(balanced ? 'check-circle-fill' : 'exclamation-octagon-fill') +
        ' <span class="strong">' + (balanced ? 'The consolidated ledger is in balance' : 'The ledger does NOT balance') +
        '</span> <span class="text-mute">· Debits ' + ui.money(totDr) + ' vs Credits ' + ui.money(totCr) + '</span>'
    }) ]));

    page.appendChild(el('div.section-label', { text: 'Trial Balance — all accounts with movement' }));
    var mainT = EPAL.table({
      columns: [
        { key: 'code', label: 'Code', render: function (r) { return '<span class="num strong">' + ui.escapeHtml(r.code) + '</span>'; } },
        { key: 'name', label: 'Account', render: function (r) { return '<span class="strong">' + ui.escapeHtml(r.name) + '</span>'; } },
        { key: 'type', label: 'Class', badge: { asset: 'info', liability: 'warn', equity: 'accent', income: 'good', expense: 'bad' } },
        { key: 'debit', label: 'Debit', num: true, render: function (r) {
          return r.debit ? '<span class="num">' + ui.money(r.debit) + '</span>' : '<span class="text-mute">—</span>'; }, exportVal: function (r) { return r.debit; } },
        { key: 'credit', label: 'Credit', num: true, render: function (r) {
          return r.credit ? '<span class="num">' + ui.money(r.credit) + '</span>' : '<span class="text-mute">—</span>'; }, exportVal: function (r) { return r.credit; } }
      ],
      rows: tb, pageSize: 30, searchKeys: ['code', 'name'],
      filters: [{ key: 'type', label: 'Class' }],
      exportName: 'group-trial-balance.csv',
      onRow: function (r) { openAccountLedger(r.code, r.name); },
      empty: { icon: 'list-columns', title: 'No ledger movement yet' }
    });
    page.appendChild(el('div.card', null, [ el('div.card-pad', null, [ mainT.el ]) ]));

    // per-company net-balance comparison
    var comps = activeCompanies();
    if (comps.length) {
      var perCo = {};
      comps.forEach(function (c) {
        var m = {};
        LED().trialBalance(c.id).forEach(function (r) { m[r.code] = r.debit - r.credit; });
        perCo[c.id] = m;
      });
      var cmpRows = tb.map(function (r) {
        var o = { code: r.code, name: r.name, grp: (r.debit - r.credit) };
        comps.forEach(function (c) { o[c.id] = perCo[c.id][r.code] || 0; });
        return o;
      });
      var cmpCols = [
        { key: 'code', label: 'Code', render: function (r) { return '<span class="num">' + ui.escapeHtml(r.code) + '</span>'; } },
        { key: 'name', label: 'Account', render: function (r) { return '<span class="strong">' + ui.escapeHtml(r.name) + '</span>'; } }
      ];
      comps.forEach(function (c) {
        cmpCols.push({ key: c.id, label: c.short, num: true, render: function (r) {
          var v = r[c.id];
          if (!v) return '<span class="text-mute">—</span>';
          return '<span class="num" style="color:' + (v >= 0 ? GREEN : RED) + '">' + ui.money(v, { compact: true }) + '</span>'; },
          exportVal: function (r) { return r[c.id]; } });
      });
      cmpCols.push({ key: 'grp', label: 'Group', num: true, render: function (r) {
        return '<span class="num strong" style="color:' + (r.grp >= 0 ? GREEN : RED) + '">' + ui.money(r.grp, { compact: true }) + '</span>'; },
        exportVal: function (r) { return r.grp; } });
      page.appendChild(el('div.section-label', { text: 'Per-Company Comparison — net balance (debit positive · credit negative)' }));
      var cmpT = EPAL.table({
        columns: cmpCols, rows: cmpRows, pageSize: 30, searchKeys: ['code', 'name'],
        exportName: 'trial-balance-by-company.csv',
        empty: { icon: 'grid-3x3', title: 'No comparison data' }
      });
      page.appendChild(el('div.card', null, [ el('div.card-pad', null, [ cmpT.el ]) ]));
    }
  }
  function exportTrialBalance(tb) {
    var lines = [['Code', 'Account', 'Class', 'Debit', 'Credit']];
    var dr = 0, cr = 0;
    tb.forEach(function (r) { lines.push([r.code, r.name, r.type, r.debit, r.credit]); dr += r.debit; cr += r.credit; });
    lines.push(['', 'TOTAL', '', dr, cr]);
    dl('group-trial-balance.csv', lines.map(function (l) { return l.join(','); }).join('\n'));
  }

  /* ---- CONSOLIDATION — group trial balance with inter-company eliminations */
  // Render one net figure the way a trial balance reads: a positive net is a
  // debit shown plainly; a negative net is a credit shown in muted parentheses.
  function consCell(v) {
    if (!v || Math.abs(v) < 0.5) return '<span class="text-mute">—</span>';
    if (v > 0) return '<span class="num">' + ui.money(v) + '</span>';
    return '<span class="num text-mute" style="opacity:.75">(' + ui.money(-v) + ')</span>';
  }

  function renderConsolidation(page) {
    if (!hasLedger()) {
      page.appendChild(head('Consolidation', 'diagram-3',
        'Group trial balance with inter-company eliminations.', []));
      page.appendChild(pills('consolidation'));
      page.appendChild(ledgerMissing());
      return;
    }

    var data = LED().consolidatedTrialBalance();
    var comps = data.companies;

    // KPI inputs -----------------------------------------------------------
    var elimGross = 0, icRowCount = 0, groupAssets = 0;
    data.rows.forEach(function (r) {
      elimGross += Math.abs(r.elimination || 0);
      if (r.intercompany) icRowCount++;
      if (r.type === 'asset') groupAssets += (r.group || 0);
    });
    elimGross = elimGross / 2;                 // each pair is counted on both legs
    // distinct inter-company transactions = distinct refs on IC source entries
    var icRefs = {}, icEntries = LED().entries({ source: 'intercompany' });
    icEntries.forEach(function (e) { if (e.ref) icRefs[e.ref] = 1; });
    var icCount = Object.keys(icRefs).length;

    page.appendChild(head('Consolidation — Group Trial Balance', 'diagram-3',
      'Every account netted across ' + comps.length + ' operating concerns, with inter-company balances ' +
      'eliminated so the group figure reflects only third-party positions. As at ' + ui.date(new Date(), 'long') + '.', [
      el('button.btn.btn-ghost', { html: ui.icon('download') + ' Export (CSV)',
        onclick: function () { exportConsolidated(data); } }),
      el('button.btn.btn-ghost', { html: ui.icon('file-earmark-text') + ' Consolidated Statement',
        onclick: function () { openConsolidatedDoc(data); } }),
      can('create') ? el('button.btn.btn-primary', { html: ui.icon('arrow-left-right') + ' Post Inter-company',
        onclick: function () { postIC(comps); } }) : null
    ]));
    page.appendChild(pills('consolidation'));

    page.appendChild(el('div.kpi-grid', null, [
      kpi('Companies Consolidated', comps.length, 'diagram-3', null, 'operating concerns'),
      kpi('Eliminations', ui.money(elimGross, { compact: true }), 'x-circle', null, 'netted on consolidation'),
      kpi('Consolidated Assets', ui.money(groupAssets, { compact: true }), 'safe2', null, 'group, post-elimination'),
      kpi('IC Transactions', icCount, 'arrow-left-right', null, icRowCount + ' control accounts')
    ]));

    // MAIN TABLE — Account | per-company nets | Elimination | Group ---------
    page.appendChild(el('div.section-label', {
      text: 'Consolidated Trial Balance — debit shown plainly · credit in (parentheses) · inter-company rows eliminated'
    }));

    var t = el('table.tbl');
    var headCells = [ el('th', { text: 'Account' }) ];
    comps.forEach(function (c) { headCells.push(el('th.num', { title: c.name, text: c.short })); });
    headCells.push(el('th.num', { text: 'Elimination' }));
    headCells.push(el('th.num', { text: 'Group' }));
    t.appendChild(el('thead', null, [ el('tr', null, headCells) ]));

    var tb = el('tbody');
    data.rows.forEach(function (r) {
      var acctHtml = '<span class="num strong">' + ui.escapeHtml(r.code) + '</span> ' + ui.escapeHtml(r.name) +
        (r.intercompany ? ' <span class="badge badge-accent" title="Nets to zero on consolidation">eliminated</span>' : '');
      var cells = [ el('td', { html: acctHtml }) ];
      comps.forEach(function (c) { cells.push(el('td.num', { html: consCell(r.per[c.id] || 0) })); });
      cells.push(el('td.num', { html: r.elimination ? consCell(r.elimination) : '<span class="text-mute">—</span>' }));
      cells.push(el('td.num', { html: r.intercompany ? '<span class="text-mute">0</span>' : consCell(r.group) }));
      tb.appendChild(el('tr', r.intercompany ? { style: { background: 'rgba(226,114,27,.07)' } } : null, cells));
    });

    // totals footer — each concern's books balance, so we show the balanced total
    var footCells = [ el('td', { html: '<span class="strong">Totals · Dr = Cr</span>' }) ];
    comps.forEach(function (c) {
      footCells.push(el('td.num', { html: '<span class="num strong">' + ui.money(data.totals.per[c.id].debit) + '</span>' }));
    });
    footCells.push(el('td.num', { html: '<span class="text-mute">—</span>' }));
    footCells.push(el('td.num', { html: '<span class="num strong" style="color:' + GOLD + '">' + ui.money(data.totals.group.debit) + '</span>' }));
    tb.appendChild(el('tr', { style: { borderTop: '2px solid rgba(128,128,128,.3)' } }, footCells));
    t.appendChild(tb);
    page.appendChild(el('div.card', null, [ el('div.card-pad', null, [ el('div.table-wrap', null, [ t ]) ]) ]));

    // explainer + per-company revenue bar ----------------------------------
    var row = el('div.two-col');
    row.appendChild(el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon('info-circle') + ' How consolidation works' }),
        el('span.card-sub', { text: 'why the group column differs from the sum of concerns' }) ]),
      el('div.card-body', null, [
        el('p.text-mute', { style: { fontSize: '13px', lineHeight: '1.7', marginTop: '0' },
          html: 'When one concern sells to another, the seller books <b>1300 Inter-company Receivable</b> and the ' +
            'buyer books <b>2400 Inter-company Payable</b> for the same amount. Across the group these are the same ' +
            'money owed to itself, so on consolidation they are moved into the <b>Elimination</b> column and their ' +
            '<b>Group</b> figure nets to zero — the group only reports what it is owed by, and owes to, outside parties.' }),
        el('div.mt-2', {
          style: { display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '12px',
            borderRadius: '10px', border: '1px dashed rgba(200,162,74,.45)', fontSize: '12.5px' },
          html: ui.icon('x-circle') + ' <span class="text-mute"><b>' + ui.money(elimGross) + '</b> of inter-company ' +
            'balances eliminated across <b>' + icCount + '</b> transaction' + (icCount === 1 ? '' : 's') +
            ', on the <b>1300</b> / <b>2400</b> control accounts.</span>'
        })
      ])
    ]));
    var revBarId = ui.uid('consRev');
    row.appendChild(chartCard('Revenue by Concern', 'bar-chart', revBarId, 'trailing 12 months · per operating company', 280));
    page.appendChild(row);

    requestAnimationFrame(function () {
      var snap = db().groupSnapshot();
      var c = document.getElementById(revBarId);
      if (c && snap.companies.length) EPAL.charts.bar(c, {
        labels: snap.companies.map(function (co) { return co.short; }), money: true,
        datasets: [{ label: 'Revenue', data: snap.companies.map(function (co) { return co.revenue; }),
          colors: snap.companies.map(function (co) { return co.accent; }) }]
      });
    });
  }

  function postIC(comps) {
    if (!can('create')) { ui.toast('You do not have permission to post inter-company entries', 'error'); return; }
    var opts = comps.map(function (c) { return [c.id, c.short]; });
    EPAL.formModal({
      title: 'Post Inter-company Transaction', icon: 'arrow-left-right',
      fields: [
        { key: 'from', label: 'From (Seller — books receivable + revenue)', type: 'select', required: true, col2: true, options: opts },
        { key: 'to', label: 'To (Buyer — books expense + payable)', type: 'select', required: true, options: opts },
        { key: 'amount', label: 'Amount (৳)', type: 'money', required: true, min: 1 },
        { key: 'memo', label: 'Memo', type: 'text', placeholder: 'e.g. Shared services / inter-company supply' }
      ],
      onSave: function (vals) {
        if (vals.from === vals.to) { ui.toast('Seller and buyer must be different concerns', 'error'); return false; }
        try {
          var r = LED().postIntercompany(vals.from, vals.to, +vals.amount, { memo: vals.memo });
          db().log(EPAL.auth.current ? (EPAL.auth.current() || {}).name || 'Finance' : 'Finance',
            'Inter-company ' + vals.from + ' → ' + vals.to + ' · ' + ui.money(+vals.amount) + ' (' + r.ref + ')', vals.from);
          ui.toast('Inter-company transaction posted · ' + r.ref, 'success');
          EPAL.router.render();
        } catch (e) {
          ui.toast(e && e.message ? e.message : 'Could not post inter-company entry', 'error');
          return false;
        }
      }
    });
  }

  function exportConsolidated(data) {
    var header = ['Code', 'Account', 'Type']
      .concat(data.companies.map(function (c) { return c.short; }))
      .concat(['Elimination', 'Group']);
    var lines = [header];
    data.rows.forEach(function (r) {
      var line = [r.code, r.name, r.type];
      data.companies.forEach(function (c) { line.push(r.per[c.id] || 0); });
      line.push(r.elimination || 0);
      line.push(r.group || 0);
      lines.push(line);
    });
    var totalLine = ['', 'TOTAL (Dr=Cr)', ''];
    data.companies.forEach(function (c) { totalLine.push(data.totals.per[c.id].debit); });
    totalLine.push(0);
    totalLine.push(data.totals.group.debit);
    lines.push(totalLine);
    dl('group-consolidated-tb.csv', lines.map(function (l) { return l.join(','); }).join('\n'));
  }

  function openConsolidatedDoc(data) {
    // A clean group-level statement: only the consolidated (post-elimination)
    // figures per account, presented as a branded trial balance.
    var rows = [];
    data.rows.forEach(function (r) {
      if (r.intercompany) return;              // netted to zero on the group
      var g = r.group || 0;
      if (Math.abs(g) < 0.5) return;
      rows.push({ code: r.code, name: r.name, debit: g > 0 ? g : 0, credit: g < 0 ? -g : 0 });
    });
    EPAL.doc.open({
      type: 'voucher', title: 'Consolidated Trial Balance', watermark: 'GROUP',
      companyId: 'group', amount: data.totals.group.debit,
      parties: [{ label: 'Reporting Entity', name: 'Epal Group (Consolidated)',
        lines: [comLine(data.companies) ] }],
      meta: [
        { label: 'As at', value: ui.date(new Date(), 'long') },
        { label: 'Concerns', value: data.companies.length },
        { label: 'Basis', value: 'Inter-company eliminated' }
      ],
      columns: [
        { key: 'code', label: 'Code' },
        { key: 'name', label: 'Account' },
        { key: 'debit', label: 'Debit', num: true, money: true },
        { key: 'credit', label: 'Credit', num: true, money: true }
      ],
      rows: rows,
      totals: [
        { label: 'Group Debits', value: data.totals.group.debit },
        { label: 'Group Credits', value: data.totals.group.credit, grand: true }
      ],
      terms: 'Consolidated management trial balance. Inter-company receivables (1300) and payables (2400) ' +
        'are eliminated on consolidation. Derived live from the group double-entry ledger. E&OE.',
      sign: 'Group Chief Financial Officer'
    });
  }
  function comLine(comps) {
    return comps.map(function (c) { return c.short; }).join(' · ');
  }

  /* ---- Balance Sheet (ledger-derived) -------------------------------------*/
  function renderBalanceSheetLedger(page) {
    var bs = LED().balanceSheet();
    var totA = bs.totals.assets, totL = bs.totals.liabilities, totE = bs.totals.equity;
    var balanced = bs.totals.balanced;

    page.appendChild(head('Balance Sheet — Group', 'clipboard-data',
      'Consolidated statement of financial position as at ' + ui.date(new Date(), 'long') +
      ', derived live from the double-entry ledger.', [
      el('button.btn.btn-ghost', { html: ui.icon('download') + ' Export (CSV)', onclick: function () {
        var lines = [['Section', 'Account', 'Amount']];
        bs.assets.forEach(function (a) { lines.push(['Assets', a.name, a.amount]); });
        lines.push(['Assets', 'TOTAL ASSETS', totA]);
        bs.liabilities.forEach(function (a) { lines.push(['Liabilities', a.name, a.amount]); });
        lines.push(['Liabilities', 'TOTAL LIABILITIES', totL]);
        bs.equity.forEach(function (a) { lines.push(['Equity', a.name, a.amount]); });
        lines.push(['Equity', 'TOTAL EQUITY', totE]);
        lines.push(['Total', 'LIABILITIES + EQUITY', totL + totE]);
        dl('group-balance-sheet.csv', lines.map(function (l) { return l.join(','); }).join('\n'));
      } })
    ]));
    page.appendChild(pills('balance-sheet'));

    page.appendChild(el('div.kpi-grid', null, [
      kpi('Total Assets', ui.money(totA, { compact: true }), 'safe2', null, bs.assets.length + ' accounts'),
      kpi('Total Liabilities', ui.money(totL, { compact: true }), 'file-earmark-minus', 'group/finance/payables', bs.liabilities.length + ' accounts'),
      kpi('Total Equity', ui.money(totE, { compact: true }), 'gem', null, bs.equity.length + ' accounts'),
      kpi('Balance Check', balanced ? 'Balanced' : 'Off by ' + ui.money(Math.abs(totA - (totL + totE)), { compact: true }),
        balanced ? 'check-circle' : 'exclamation-triangle', null, 'Assets = Liabilities + Equity')
    ]));

    function lineRow(a) {
      return el('div.flex.justify-between.items-center', {
        style: { padding: '9px 2px', borderBottom: '1px solid rgba(128,128,128,.14)' }
      }, [
        el('span.text-mute', { html: '<span class="num">' + ui.escapeHtml(String(a.code)) + '</span> ' + ui.escapeHtml(a.name) }),
        el('span.num', { text: ui.money(a.amount) })
      ]);
    }
    function totalRow(label, amt, color) {
      return el('div.flex.justify-between.items-center', {
        style: { padding: '10px 2px', borderTop: '2px solid rgba(128,128,128,.25)' }
      }, [
        el('span.strong', { text: label }),
        el('span.num.strong', { text: ui.money(amt), style: color ? { color: color } : null })
      ]);
    }

    var left = el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon('safe2') + ' Assets' }),
        el('span.card-sub', { text: 'what the group owns' }) ]),
      el('div.card-body', null, (bs.assets.length ? bs.assets.map(lineRow) : [ el('div.text-mute', { text: 'No asset balances.' }) ])
        .concat([ totalRow('TOTAL ASSETS', totA, GREEN) ]))
    ]);
    var right = el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon('file-earmark-minus') + ' Liabilities & Equity' }),
        el('span.card-sub', { text: 'what it owes + owner value' }) ]),
      el('div.card-body', null, [ el('div.section-label', { style: { marginTop: '0' }, text: 'Liabilities' }) ]
        .concat(bs.liabilities.length ? bs.liabilities.map(lineRow) : [ el('div.text-mute', { text: 'No liabilities.' }) ])
        .concat([ totalRow('Subtotal — Liabilities', totL, RED), el('div.section-label', { text: 'Equity' }) ])
        .concat(bs.equity.length ? bs.equity.map(lineRow) : [ el('div.text-mute', { text: 'No equity balances.' }) ])
        .concat([ totalRow('Subtotal — Equity', totE), totalRow('TOTAL LIABILITIES + EQUITY', totL + totE, GOLD) ]))
    ]);
    var cols = el('div.two-col'); cols.appendChild(left); cols.appendChild(right);
    page.appendChild(cols);

    var mixId = ui.uid('bsLedMix');
    page.appendChild(chartCard('Asset Composition', 'pie-chart', mixId, 'by ledger account', 280));
    requestAnimationFrame(function () {
      var c = document.getElementById(mixId);
      if (c && bs.assets.length) EPAL.charts.doughnut(c, {
        labels: bs.assets.map(function (a) { return a.name; }),
        data: bs.assets.map(function (a) { return Math.abs(a.amount); }),
        legend: 'bottom'
      });
    });
  }

  /* ---- Receivables / Payables aging (ledger-derived subledger) ------------*/
  function renderAgingLedger(page, kind) {
    var isAR = kind === 'Receivable';
    var lk = isAR ? 'AR' : 'AP';
    var subKey = isAR ? 'receivables' : 'payables';
    var icon = isAR ? 'arrow-down-left-circle' : 'arrow-up-right-circle';
    var title = isAR ? 'Receivables — Aging' : 'Payables — Aging';
    var rows = LED().aging(lk, {});
    var BUCKETS = [['current', 'Current'], ['d30', '1–30d'], ['d60', '31–60d'], ['d90', '60+d']];
    var BUCKET_COLORS = [GREEN, AMBER, ORANGE, RED];
    function bucketSum(key) { return rows.reduce(function (a, r) { return a + (r[key] || 0); }, 0); }
    var total = rows.reduce(function (a, r) { return a + (r.total || 0); }, 0);

    page.appendChild(head(title, icon,
      (isAR ? 'Who owes the group money and how overdue it is, ' : 'Who the group owes and how overdue it is, ') +
      'aged from the double-entry ' + (isAR ? 'receivable' : 'payable') + ' subledger.', [
      el('button.btn.btn-primary', { html: ui.icon('journal-plus') + ' Post ' + (isAR ? 'Receipt / Invoice' : 'Payment / Bill'),
        onclick: function () { newJournal(); } })
    ]));
    page.appendChild(pills(subKey));

    page.appendChild(el('div.kpi-grid', null, BUCKETS.map(function (b, i) {
      var host = kpi(b[1] === 'Current' ? 'Current (not due)' : b[1] + ' overdue',
        ui.money(bucketSum(b[0]), { compact: true }),
        ['check2-circle', 'hourglass-split', 'exclamation-triangle', 'exclamation-octagon'][i]);
      host.style.borderTop = '3px solid ' + BUCKET_COLORS[i];
      return host;
    })));

    var agingId = ui.uid('ledAging');
    page.appendChild(chartCard('Aging Distribution', 'bar-chart', agingId,
      'outstanding ' + (isAR ? 'receivable' : 'payable') + ' value per bucket', 240));

    page.appendChild(el('div.section-label', { text: 'By Party — total outstanding ' + ui.money(total, { compact: true }) + ' · click a party for its statement' }));
    var table = EPAL.table({
      columns: [
        { key: 'party', label: 'Party', render: function (r) { return '<span class="strong">' + ui.escapeHtml(r.party) + '</span>'; } },
        { key: 'current', label: 'Current', num: true, money: true },
        { key: 'd30', label: '1–30d', num: true, money: true },
        { key: 'd60', label: '31–60d', num: true, money: true },
        { key: 'd90', label: '60+d', num: true, render: function (r) {
          return '<span class="num" style="color:' + (r.d90 ? RED : 'inherit') + '">' + ui.money(r.d90) + '</span>'; }, exportVal: function (r) { return r.d90; } },
        { key: 'total', label: 'Total', num: true, render: function (r) {
          return '<span class="num strong">' + ui.money(r.total) + '</span>'; }, exportVal: function (r) { return r.total; } }
      ],
      rows: rows, pageSize: 15, searchKeys: ['party'],
      exportName: 'group-' + subKey + '-aging.csv',
      onRow: function (r) { openPartyLedger(r.party); },
      empty: { icon: 'calendar2-week', title: 'No open ' + subKey, hint: 'Nothing outstanding in the ledger subledger.' }
    });
    page.appendChild(el('div.card', null, [ el('div.card-pad', null, [ table.el ]) ]));

    requestAnimationFrame(function () {
      var c = document.getElementById(agingId);
      if (c) EPAL.charts.bar(c, { labels: ['Current', '1–30 days', '31–60 days', '60+ days'], money: true,
        datasets: [{ label: 'Outstanding', data: BUCKETS.map(function (b) { return bucketSum(b[0]); }), colors: BUCKET_COLORS }] });
    });
  }
  function openPartyLedger(party) {
    var rows = hasLedger() ? LED().partyLedger(party, {}) : [];
    var body = el('div', null, [
      el('div.text-mute.mb-2', { text: 'Running AR / AP subledger statement for ' + party + '.' }),
      miniLedgerTable(rows)
    ]);
    ui.modal({ title: party + ' · Statement', icon: 'person-lines-fill', size: 'xl', body: body,
      actions: [{ label: 'Close', variant: 'ghost' }] });
  }

})(window.EPAL = window.EPAL || {});
