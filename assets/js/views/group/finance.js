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

  var GREEN = '#23c17e', RED = '#f0506e', AMBER = '#f4b740', ORANGE = '#e2721b', GOLD = '#c8a24a';

  var TABS = [
    [null, 'Overview'], ['pnl', 'P&L'], ['cashflow', 'Cash Flow'],
    ['balance-sheet', 'Balance Sheet'], ['receivables', 'Receivables'],
    ['payables', 'Payables'], ['banks', 'Banks']
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
    var s = db().series(null), yms = db().months(12), perCo = perCompanySeries();
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
    else renderOverview(page);
    ctx.mount.appendChild(page);
  } });

  /* ==========================================================================
   * OVERVIEW — the consolidated cockpit
   * ========================================================================*/
  function renderOverview(page) {
    var f = db().finance(null, 12);
    var snap = db().groupSnapshot();
    var cash = bankTotal();
    var ar = outstandingOf('Receivable'), ap = outstandingOf('Payable');

    page.appendChild(head('Consolidated Finance', 'cash-coin',
      'Group-wide P&L, cash position, receivables and payables across ' + snap.companies.length + ' concerns · trailing 12 months.', [
      el('button.btn.btn-ghost', { html: ui.icon('download') + ' P&L CSV', onclick: exportPnlCsv }),
      el('button.btn.btn-primary', { html: ui.icon('bank') + ' Bank Positions',
        onclick: function () { EPAL.router.navigate('group/finance/banks'); } })
    ]));
    page.appendChild(pills(null));

    page.appendChild(el('div.kpi-grid.stagger', null, [
      kpi('Revenue (12M)', ui.money(f.revenue, { compact: true }), 'graph-up-arrow', 'group/finance/pnl', 'all concerns'),
      kpi('Expense (12M)', ui.money(f.expense, { compact: true }), 'wallet2', 'group/finance/pnl', 'all concerns'),
      kpi('Net Profit', ui.money(f.profit, { compact: true }), 'cash-stack', 'group/finance/pnl', 'revenue less expense'),
      kpi('Blended Margin', ui.pct(f.margin), 'pie-chart-fill', 'group/finance/pnl', 'group-wide'),
      kpi('Cash in Banks', ui.money(cash, { compact: true }), 'bank', 'group/finance/banks', db().col('banks').length + ' accounts'),
      kpi('AR Outstanding', ui.money(ar, { compact: true }), 'arrow-down-left-circle', 'group/finance/receivables', 'to collect'),
      kpi('AP Outstanding', ui.money(ap, { compact: true }), 'arrow-up-right-circle', 'group/finance/payables', 'to settle')
    ]));

    var trendId = ui.uid('gfTrend');
    page.appendChild(chartCard('Revenue, Expense & Profit — Consolidated', 'activity', trendId, 'monthly · all concerns combined', 300));

    page.appendChild(el('div.section-label', { text: 'Per-Company Performance (12M) — click a row to open that concern’s accounts' }));
    var rows = activeCompanies().map(function (c) {
      var cf = db().finance(c.id, 12);
      return { id: c.id, short: c.short, accent: c.accent, icon: c.icon,
        revenue: cf.revenue, expense: cf.expense, profit: cf.profit, margin: cf.margin,
        mom: db().momRevenue(c.id) };
    });
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
      onRow: function (r) { EPAL.router.navigate(r.id + '/accounts'); },
      empty: { icon: 'diagram-3', title: 'No active concerns' }
    });
    page.appendChild(el('div.card', null, [ el('div.card-pad', null, [ table.el ]) ]));

    requestAnimationFrame(function () {
      var s = db().series(null);
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
    var s = db().series(null), yms = db().months(12), perCo = perCompanySeries();
    var f = db().finance(null, 12);
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
    var s = db().series(null), yms = db().months(12);
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

})(window.EPAL = window.EPAL || {});
