/* ============================================================================
 * EPAL GROUP ERP  ·  views/group/analytics.js
 * ----------------------------------------------------------------------------
 * BUSINESS INTELLIGENCE — cross-company analytics (route: group/analytics).
 *
 * One view, four sub-screens (branch on ctx.subId):
 *   trends    Multi-company revenue lines (one dataset per concern, painted in
 *             its accent) + group profit trend + computed leader KPIs
 *             (fastest grower, best margin, biggest MoM riser and faller).
 *   forecast  Least-squares 3-month revenue projection for the group AND each
 *             concern (EPAL.forecast) — dashed projection dataset + a
 *             next-quarter projection table with growth badges.
 *   compare   Company-vs-company scoreboard: revenue, expense, profit, margin,
 *             MoM, risk, headcount — sortable table + grouped bar chart.
 *             Row click drills into that concern's dashboard.
 *   heatmap   12-month × concern revenue heat grid built from db.series();
 *             cell intensity scales with revenue, cell click opens that
 *             concern's analytics.
 *
 * Data: db.groupSnapshot, db.series, db.momRevenue, db.riskScore — everything
 * is computed live, so a sale posted anywhere moves these screens instantly.
 * ==========================================================================*/

(function (EPAL) {
  'use strict';
  var ui = EPAL.ui, el = ui.el;
  var db = function () { return EPAL.db; };

  var GOLD = '#3B6FA8', GREEN = '#23c17e', RED = '#f0506e', AMBER = '#f4b740';

  var TABS = [
    [null, 'Trends'], ['forecast', 'Forecast'],
    ['compare', 'Company Comparison'], ['heatmap', 'Activity Heatmap']
  ];

  /* ---- tiny shared helpers ------------------------------------------------*/
  function kpi(label, value, icon, foot, drill) {
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
        onclick: function () { EPAL.router.navigate('group/analytics' + (t[0] ? '/' + t[0] : '')); }
      }));
    });
    return el('div', null, [host]);
  }
  function hexA(hex, a) {
    var h = String(hex).replace('#', '');
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    var n = parseInt(h, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }
  function sumLast(arr, n, skip) {
    // sum of the n items ending `skip` places before the end (skip default 0)
    skip = skip || 0;
    var end = arr.length - skip, total = 0;
    for (var i = Math.max(0, end - n); i < end; i++) total += (arr[i] || 0);
    return total;
  }
  function growthBadge(g) {
    if (g == null || isNaN(g)) return el('span.badge', { text: '—' });
    var tone = g > 2 ? 'good' : g < -2 ? 'bad' : 'warn';
    return el('span.badge.badge-' + tone, { text: (g >= 0 ? '+' : '') + g.toFixed(1) + '%' });
  }
  function coDot(c) {
    return '<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:' +
      c.accent + ';margin-right:7px"></span><span class="strong">' + ui.escapeHtml(c.short) + '</span>';
  }
  // Download the live comparison scoreboard as a CSV snapshot.
  function exportSnapshot(snap) {
    var lines = [['Company', 'Revenue 12M', 'Expense 12M', 'Profit 12M', 'Margin %', 'MoM %', 'Risk', 'Headcount']];
    snap.companies.forEach(function (c) {
      lines.push([c.name, c.revenue, c.revenue - c.profit, c.profit,
        c.margin.toFixed(1), c.mom.toFixed(1), c.risk, c.employees]);
    });
    lines.push(['GROUP TOTAL', snap.revenue, snap.revenue - snap.profit, snap.profit,
      snap.margin.toFixed(1), '', '', snap.headcount]);
    var csv = lines.map(function (l) {
      return l.map(function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(',');
    }).join('\n');
    var blob = new Blob([csv], { type: 'text/csv' });
    var a = el('a', { href: URL.createObjectURL(blob), download: 'group-intelligence-snapshot.csv' });
    document.body.appendChild(a); a.click(); a.remove();
    ui.toast('Intelligence snapshot exported', 'success');
  }

  /* ==========================================================================
   * THE VIEW
   * ========================================================================*/
  EPAL.view('group/analytics', { render: function (ctx) {
    var sub = ctx.subId || null;
    var snap = db().groupSnapshot();
    var page = el('div.page');

    var TITLES = {
      '': ['Cross-Company Trends', 'Who is growing, who is bleeding — every concern on one canvas.'],
      forecast: ['Revenue Forecast', 'Least-squares projection of the next quarter, per concern and consolidated.'],
      compare: ['Company Comparison', 'The scoreboard — every sister concern measured on the same eight axes.'],
      heatmap: ['Activity Heatmap', 'Twelve months × every concern — revenue intensity at a glance.']
    };
    var t = TITLES[sub || ''] || TITLES[''];

    page.appendChild(EPAL.pageHead({
      eyebrow: 'Epal Group · Business Intelligence', icon: 'graph-up-arrow',
      title: t[0], sub: t[1],
      actions: [
        el('button.btn.btn-ghost', { html: ui.icon('download') + ' Export Snapshot',
          onclick: function () { exportSnapshot(snap); } }),
        el('button.btn.btn-primary', { html: ui.icon('grid-1x2') + ' Command Center',
          onclick: function () { EPAL.router.navigate('group/dashboard'); } })
      ]
    }));
    page.appendChild(pills(sub));

    if (sub === 'forecast') renderForecast(page, ctx, snap);
    else if (sub === 'compare') renderCompare(page, ctx, snap);
    else if (sub === 'heatmap') renderHeatmap(page, ctx, snap);
    else renderTrends(page, ctx, snap);

    ctx.mount.appendChild(page);
  } });

  /* ==========================================================================
   * TRENDS — multi-company revenue lines + group profit trend + leader KPIs
   * ========================================================================*/
  function renderTrends(page, ctx, snap) {
    // per-company computed stats: H2-vs-H1 growth for "fastest growing"
    var stats = snap.companies.map(function (c) {
      var s = db().series(c.id);
      var h1 = sumLast(s.revenue, 6, 6), h2 = sumLast(s.revenue, 6, 0);
      return { c: c, series: s, hGrowth: h1 ? (h2 - h1) / h1 * 100 : 0 };
    });
    var fastest = stats.slice().sort(function (a, b) { return b.hGrowth - a.hGrowth; })[0];
    var byMargin = snap.companies.slice().sort(function (a, b) { return b.margin - a.margin; });
    var byMom = snap.companies.slice().sort(function (a, b) { return b.mom - a.mom; });
    var riser = byMom[0], faller = byMom[byMom.length - 1];

    page.appendChild(el('div.kpi-grid.stagger', null, [
      fastest ? kpi('Fastest Growing', fastest.c.short, 'rocket-takeoff',
        (fastest.hGrowth >= 0 ? '+' : '') + fastest.hGrowth.toFixed(1) + '% H2 vs H1 revenue', fastest.c.id + '/analytics') : null,
      byMargin[0] ? kpi('Highest Margin', byMargin[0].short, 'gem',
        ui.pct(byMargin[0].margin) + ' net margin (12M)', byMargin[0].id + '/analytics') : null,
      riser ? kpi('Biggest Riser (MoM)', riser.short, 'arrow-up-right-circle',
        '+' + riser.mom.toFixed(1) + '% month-over-month', riser.id + '/analytics') : null,
      faller ? kpi('Biggest Faller (MoM)', faller.short, 'arrow-down-right-circle',
        faller.mom.toFixed(1) + '% month-over-month', faller.id + '/analytics') : null
    ]));

    var revId = ui.uid('bi-rev'), pfId = ui.uid('bi-pf');
    var row = el('div.two-col');
    row.appendChild(chartCard('Revenue by Concern', 'graph-up', revId, 'monthly · one line per company', 320));
    row.appendChild(chartCard('Group Profit Trend', 'cash-stack', pfId, 'consolidated profit vs expense', 320));
    page.appendChild(row);

    requestAnimationFrame(function () {
      var c1 = document.getElementById(revId);
      if (c1) EPAL.charts.line(c1, {
        labels: stats.length ? stats[0].series.labels : [],
        legend: true,
        datasets: stats.map(function (st) {
          return { label: st.c.short, data: st.series.revenue, color: st.c.accent };
        })
      });
      var g = db().series();      // whole-group aggregated series
      var c2 = document.getElementById(pfId);
      if (c2) EPAL.charts.area(c2, {
        labels: g.labels, legend: true,
        datasets: [
          { label: 'Profit', data: g.profit, color: GREEN },
          { label: 'Expense', data: g.expense, color: RED }
        ]
      });
    });
  }

  /* ==========================================================================
   * FORECAST — dashed 3-month projection (group + per concern) + table
   * ========================================================================*/
  function renderForecast(page, ctx, snap) {
    var focus = ctx.params.focus || 'group';

    // projection rows for every concern (reused by KPIs, chart and table)
    var rows = snap.companies.map(function (c) {
      var s = db().series(c.id);
      var fc = EPAL.forecast(s.revenue, 3);
      var lastQ = sumLast(s.revenue, 3);
      var nextQ = fc.length ? fc[0] + fc[1] + fc[2] : 0;
      return { id: c.id, short: c.short, accent: c.accent, series: s, fc: fc,
        lastQ: lastQ, m1: fc[0] || 0, m2: fc[1] || 0, m3: fc[2] || 0, nextQ: nextQ,
        growth: (fc.length && lastQ) ? (nextQ - lastQ) / lastQ * 100 : null };
    });
    var gSeries = db().series();
    var gFc = EPAL.forecast(gSeries.revenue, 3);
    var gLastQ = sumLast(gSeries.revenue, 3);
    var gNextQ = gFc.length ? gFc[0] + gFc[1] + gFc[2] : 0;
    var gGrowth = (gFc.length && gLastQ) ? (gNextQ - gLastQ) / gLastQ * 100 : 0;
    var ranked = rows.filter(function (r) { return r.growth != null; })
      .sort(function (a, b) { return b.growth - a.growth; });
    var best = ranked[0], worst = ranked[ranked.length - 1];

    page.appendChild(el('div.kpi-grid.stagger', null, [
      kpi('Group Next Quarter', ui.money(gNextQ, { compact: true }), 'stars',
        'projected revenue (+1 to +3 months)', 'group/finance'),
      kpi('Projected QoQ', (gGrowth >= 0 ? '+' : '') + gGrowth.toFixed(1) + '%',
        gGrowth >= 0 ? 'graph-up-arrow' : 'graph-down-arrow', 'vs the trailing quarter actual'),
      best ? kpi('Best Trajectory', best.short, 'rocket-takeoff',
        '+' + best.growth.toFixed(1) + '% projected QoQ', best.id + '/analytics') : null,
      worst ? kpi('Weakest Trajectory', worst.short, 'thermometer-low',
        (worst.growth >= 0 ? '+' : '') + worst.growth.toFixed(1) + '% projected QoQ', worst.id + '/analytics') : null
    ]));

    // focus selector: group + every concern
    var focusPills = el('div.pill-tab.mb-3');
    [{ id: 'group', short: 'Group' }].concat(snap.companies).forEach(function (c) {
      focusPills.appendChild(el('button' + (focus === c.id ? '.active' : ''), {
        text: c.short,
        onclick: function () { EPAL.router.navigate('group/analytics/forecast', { focus: c.id }); }
      }));
    });
    page.appendChild(el('div', null, [focusPills]));

    var focusCo = EPAL.config.company(focus === 'group' ? null : focus);
    var focusName = focusCo ? focusCo.short : 'Group';
    var accent = focusCo ? focusCo.accent : GOLD;
    var fcId = ui.uid('bi-fc');
    page.appendChild(chartCard('Revenue + 3-Month Projection — ' + focusName, 'stars', fcId,
      'dashed = least-squares projection', 320));

    // projection table
    var tbl = EPAL.table({
      columns: [
        { key: 'short', label: 'Concern', render: function (r) { return coDot(r); } },
        { key: 'lastQ', label: 'Last Quarter (actual)', num: true, money: true },
        { key: 'm1', label: '+1 Mo', num: true, money: true },
        { key: 'm2', label: '+2 Mo', num: true, money: true },
        { key: 'm3', label: '+3 Mo', num: true, money: true },
        { key: 'nextQ', label: 'Next Quarter (proj.)', num: true, money: true },
        { key: 'growth', label: 'Projected QoQ', num: true,
          render: function (r) { return growthBadge(r.growth); },
          sortVal: function (r) { return r.growth == null ? -9999 : r.growth; },
          exportVal: function (r) { return r.growth == null ? '' : r.growth.toFixed(1); } }
      ],
      rows: rows, searchKeys: ['short'], exportName: 'group-forecast.csv', pageSize: 10,
      onRow: function (r) { EPAL.router.navigate('group/analytics/forecast', { focus: r.id }); },
      empty: { icon: 'stars', title: 'Not enough history to project yet' }
    });
    page.appendChild(el('div.section-label', { text: 'Next-Quarter Projection by Concern' }));
    page.appendChild(el('div.card', null, [ el('div.card-pad', null, [ tbl.el ]) ]));

    requestAnimationFrame(function () {
      var s = focusCo ? db().series(focusCo.id) : gSeries;
      var fc = EPAL.forecast(s.revenue, 3);
      var labels = s.labels.concat(['+1', '+2', '+3']);
      var hist = s.revenue.concat([null, null, null]);
      var proj = s.revenue.map(function () { return null; });
      if (fc.length) proj[proj.length - 1] = s.revenue[s.revenue.length - 1];   // bridge point
      var canvas = document.getElementById(fcId);
      if (!canvas) return;
      EPAL.charts.line(canvas, { labels: labels, legend: true, datasets: [
        { label: 'Actual Revenue', data: hist, color: accent },
        { label: 'Projection', data: proj.concat(fc), color: AMBER }
      ] });
      // dash the projection dataset (same pattern as shared company analytics)
      var inst = window.Chart && Chart.getChart ? Chart.getChart(canvas) : null;
      if (inst && inst.data.datasets[1]) {
        inst.data.datasets[1].borderDash = [6, 5];
        inst.data.datasets[1].pointRadius = 3;
        inst.update();
      }
    });
  }

  /* ==========================================================================
   * COMPARE — the scoreboard table + grouped bar chart
   * ========================================================================*/
  function renderCompare(page, ctx, snap) {
    var byRev = snap.companies.slice().sort(function (a, b) { return b.revenue - a.revenue; });
    var byMargin = snap.companies.slice().sort(function (a, b) { return b.margin - a.margin; });
    var byMom = snap.companies.slice().sort(function (a, b) { return b.mom - a.mom; });
    var byRisk = snap.companies.slice().sort(function (a, b) { return a.risk - b.risk; });

    page.appendChild(el('div.kpi-grid.stagger', null, [
      byRev[0] ? kpi('Revenue Leader', byRev[0].short, 'trophy',
        ui.money(byRev[0].revenue, { compact: true }) + ' trailing 12M', byRev[0].id + '/dashboard') : null,
      byMargin[0] ? kpi('Margin Leader', byMargin[0].short, 'gem',
        ui.pct(byMargin[0].margin) + ' net — group benchmark', byMargin[0].id + '/analytics') : null,
      byMom[0] ? kpi('Growth Leader', byMom[0].short, 'rocket-takeoff',
        '+' + byMom[0].mom.toFixed(1) + '% MoM revenue', byMom[0].id + '/analytics') : null,
      byRisk[0] ? kpi('Lowest Risk', byRisk[0].short, 'shield-check',
        'composite risk score ' + byRisk[0].risk + ' of 100', byRisk[0].id + '/dashboard') : null
    ]));

    var rows = snap.companies.map(function (c) {
      return { id: c.id, short: c.short, name: c.name, accent: c.accent,
        revenue: c.revenue, expense: c.revenue - c.profit, profit: c.profit,
        margin: c.margin, mom: c.mom, risk: c.risk, employees: c.employees };
    });
    var tbl = EPAL.table({
      columns: [
        { key: 'short', label: 'Concern', render: function (r) { return coDot(r); } },
        { key: 'revenue', label: 'Revenue (12M)', num: true, money: true },
        { key: 'expense', label: 'Expense (12M)', num: true, money: true },
        { key: 'profit', label: 'Profit', num: true, money: true },
        { key: 'margin', label: 'Margin', num: true,
          render: function (r) { return '<span class="num">' + ui.pct(r.margin) + '</span>'; },
          exportVal: function (r) { return r.margin.toFixed(1); } },
        { key: 'mom', label: 'MoM Growth', num: true,
          render: function (r) { return growthBadge(r.mom); },
          exportVal: function (r) { return r.mom.toFixed(1); } },
        { key: 'risk', label: 'Risk', num: true, render: function (r) {
          var lvl = r.risk < 30 ? 'low' : r.risk < 55 ? 'mid' : 'high';
          return '<div class="flex items-center gap-1"><div class="meter" style="width:64px">' +
            '<span class="lvl-' + lvl + '" style="width:' + r.risk + '%"></span></div>' +
            '<span class="num sm">' + r.risk + '</span></div>'; },
          exportVal: function (r) { return r.risk; } },
        { key: 'employees', label: 'Headcount', num: true }
      ],
      rows: rows, searchKeys: ['short', 'name'], exportName: 'company-comparison.csv', pageSize: 10,
      onRow: function (r) { EPAL.router.navigate(r.id + '/dashboard'); },
      empty: { icon: 'diagram-3', title: 'No active concerns' }
    });
    page.appendChild(el('div.card', null, [ el('div.card-pad', null, [ tbl.el ]) ]));

    var barId = ui.uid('bi-cmp');
    page.appendChild(el('div.section-label', { text: 'Revenue · Expense · Profit — side by side' }));
    page.appendChild(chartCard('Financial Comparison', 'bar-chart', barId, 'trailing 12 months', 300));

    requestAnimationFrame(function () {
      var c = document.getElementById(barId);
      if (c) EPAL.charts.bar(c, {
        labels: rows.map(function (r) { return r.short; }),
        legend: true,
        datasets: [
          { label: 'Revenue', data: rows.map(function (r) { return r.revenue; }), color: '#2f6bff' },
          { label: 'Expense', data: rows.map(function (r) { return r.expense; }), color: RED },
          { label: 'Profit', data: rows.map(function (r) { return r.profit; }), color: GREEN }
        ]
      });
    });
  }

  /* ==========================================================================
   * HEATMAP — 12-month × concern revenue heat grid (CSS grid, accent alpha)
   * ========================================================================*/
  function renderHeatmap(page, ctx, snap) {
    var data = snap.companies.map(function (c) { return { c: c, s: db().series(c.id) }; });
    var g = db().series();

    // hottest single cell + peak / softest group months (computed KPIs)
    var hottest = null;
    data.forEach(function (d) {
      d.s.revenue.forEach(function (v, i) {
        if (!hottest || v > hottest.v) hottest = { v: v, co: d.c, label: d.s.labels[i] };
      });
    });
    var peakIdx = 0, softIdx = 0;
    g.revenue.forEach(function (v, i) {
      if (v > g.revenue[peakIdx]) peakIdx = i;
      if (v < g.revenue[softIdx]) softIdx = i;
    });

    page.appendChild(el('div.kpi-grid.stagger', null, [
      kpi('Peak Month (Group)', g.labels[peakIdx] || '—', 'fire',
        ui.money(g.revenue[peakIdx] || 0, { compact: true }) + ' consolidated revenue', 'group/finance/pnl'),
      kpi('Softest Month (Group)', g.labels[softIdx] || '—', 'snow',
        ui.money(g.revenue[softIdx] || 0, { compact: true }) + ' consolidated revenue', 'group/finance/pnl'),
      hottest ? kpi('Hottest Cell', hottest.co.short + ' · ' + hottest.label, 'lightning-charge',
        ui.money(hottest.v, { compact: true }) + ' in a single month', hottest.co.id + '/analytics') : null,
      kpi('Total Heat (12M)', ui.money(snap.revenue, { compact: true }), 'graph-up-arrow',
        'all concerns combined', 'group/finance')
    ]));

    var gridCols = '150px repeat(' + (g.labels.length || 12) + ', minmax(0, 1fr))';
    var grid = el('div', { style: { display: 'grid', gridTemplateColumns: gridCols, gap: '6px', alignItems: 'center' } });

    // header row: month labels
    grid.appendChild(el('div.text-mute.xs.fw-600', { text: 'Concern' }));
    g.labels.forEach(function (l) {
      grid.appendChild(el('div.text-mute.xs', { text: l, style: { textAlign: 'center' } }));
    });

    // one row per concern — cell alpha scales to that concern's best month
    data.forEach(function (d) {
      var max = Math.max.apply(null, d.s.revenue.concat([1]));
      grid.appendChild(el('div', {
        style: { display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', minWidth: '0' },
        title: 'Open ' + d.c.name,
        onclick: function () { EPAL.router.navigate(d.c.id + '/dashboard'); }
      }, [
        el('span', { style: { width: '10px', height: '10px', borderRadius: '3px', background: d.c.accent, flex: 'none' } }),
        el('span.fw-600.sm', { text: d.c.short, style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } })
      ]));
      d.s.revenue.forEach(function (v, i) {
        var a = 0.08 + (max ? (v / max) : 0) * 0.87;
        grid.appendChild(el('div', {
          title: d.c.short + ' · ' + d.s.labels[i] + ' — ' + ui.money(v),
          style: { height: '34px', borderRadius: '7px', background: hexA(d.c.accent, a),
            cursor: 'pointer', display: 'grid', placeItems: 'center',
            fontSize: '10px', fontWeight: '600', fontVariantNumeric: 'tabular-nums',
            color: a > 0.5 ? '#fff' : 'var(--text-dim)' },
          onclick: function () { EPAL.router.navigate(d.c.id + '/analytics'); }
        }, [ ui.compact(v) ]));
      });
    });

    // legend: intensity scale
    var legend = el('div.flex.items-center.gap-2.mt-3', null, [
      el('span.text-mute.xs', { text: 'Low' }),
      el('div', { style: { display: 'flex', gap: '3px' } },
        [0.12, 0.3, 0.5, 0.7, 0.95].map(function (a) {
          return el('span', { style: { width: '26px', height: '12px', borderRadius: '4px', background: hexA(GOLD, a) } });
        })),
      el('span.text-mute.xs', { text: 'High' }),
      el('span.text-mute.xs', { text: '· each row is scaled to that concern\'s own best month · click a cell to open its analytics' })
    ]);

    page.appendChild(el('div.card', null, [
      el('div.card-head', null, [
        el('h3', { html: ui.icon('grid-3x3-gap-fill') + ' Revenue Heat — 12 months × ' + data.length + ' concerns' }),
        el('span.card-sub', { text: 'from the consolidated financials ledger' })
      ]),
      el('div.card-body', null, [ grid, legend ])
    ]));

    // supporting chart: seasonality of the whole group (keeps heatmap honest)
    var seasId = ui.uid('bi-heat');
    page.appendChild(chartCard('Group Seasonality', 'activity', seasId, 'consolidated monthly revenue', 240));
    requestAnimationFrame(function () {
      var c = document.getElementById(seasId);
      if (c) EPAL.charts.bar(c, { labels: g.labels,
        datasets: [{ label: 'Revenue', data: g.revenue, color: GOLD }] });
    });
  }

})(window.EPAL = window.EPAL || {});
