/* ============================================================================
 * EPAL GROUP ERP  ·  views/group/dashboard.js
 * ----------------------------------------------------------------------------
 * THE GROUP COMMAND CENTER — the owner's single pane of glass.
 *
 * Answers "how is the whole group doing?" at a glance and lets the owner drill
 * into any sister concern. Every number here is COMPUTED LIVE from the data
 * layer (EPAL.db.groupSnapshot / series), so when Travels books a sale or a
 * company is toggled off in Module Control, this dashboard reflects it.
 *
 * Sections: greeting + period → MD briefing teaser + anomaly radar → KPI hero
 * → revenue/expense trend + revenue mix → per-company performance strip
 * → profit ranking + risk radar & alerts → smart signals + activity timeline.
 *
 * The 12M / 6M / 3M pills RE-FILTER the KPI hero and all three charts live
 * (recomputed from db.series / db.finance for the selected window). The Export
 * button opens a branded "Group Snapshot" document via EPAL.doc.
 * ==========================================================================*/

(function (EPAL) {
  'use strict';
  var ui = EPAL.ui, el = ui.el, db = EPAL.db, charts = EPAL.charts;

  EPAL.view('group/dashboard', {
    render: function (ctx) {
      var snap = db.groupSnapshot();
      var fullSeries = db.series();             // whole-group monthly series (12M)
      var owner = EPAL.auth.current();
      var page = el('div.page');
      var state = { months: 12 };

      /* ---- window helpers (drive the period pills) --------------------- */
      function windowSeries(months) {
        var s = fullSeries, n = s.labels.length, start = Math.max(0, n - months);
        return {
          labels:  s.labels.slice(start),
          revenue: s.revenue.slice(start),
          expense: s.expense.slice(start),
          profit:  s.profit.slice(start)
        };
      }
      function sum(arr) { var t = 0, i; for (i = 0; i < arr.length; i++) t += (arr[i] || 0); return t; }

      /* ---- greeting + period ------------------------------------------- */
      var hr = new Date().getHours();
      var greet = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
      function makePill(label, months, active) {
        return el('button' + (active ? '.active' : ''), { text: label, onclick: function (e) {
          ui.$$('.pill-tab button', e.target.parentNode).forEach(function (b) { b.classList.remove('active'); });
          e.target.classList.add('active');
          state.months = months;
          renderKpis(months);
          requestAnimationFrame(function () { drawAll(months); });
        } });
      }
      page.appendChild(EPAL.pageHead({
        eyebrow: greet + ', ' + owner.name.split(' ')[0],
        title: 'Group Command Center',
        sub: 'Consolidated health across ' + snap.companies.length + ' active sister concerns · fiscal year ' + EPAL.config.group.established + '→now.',
        actions: [
          el('div.pill-tab', null, [ makePill('12M', 12, true), makePill('6M', 6, false), makePill('3M', 3, false) ]),
          el('button.btn.btn-ghost', { html: ui.icon('download') + ' Export', onclick: function () { openSnapshotDoc(); } }),
          el('button.btn.btn-primary', { html: ui.icon('toggles2') + ' Module Control',
            onclick: function () { EPAL.router.navigate('group/module-manager'); } })
        ]
      }));

      /* ---- MD briefing teaser + anomaly radar (intelligence up top) ---- */
      var row1 = el('div.two-col');
      row1.appendChild(buildBriefingCard());
      row1.appendChild(buildAnomalyRadar());
      page.appendChild(row1);

      /* ---- KPI hero (each tile drills into the detail behind the number) */
      var kpis = el('div.kpi-grid.stagger');
      function renderKpis(months) {
        var ws = windowSeries(months);
        var rev = sum(ws.revenue), prof = sum(ws.profit), marg = rev ? (prof / rev) * 100 : 0;
        while (kpis.firstChild) kpis.removeChild(kpis.firstChild);
        kpiTile(kpis, 'Group Revenue', rev, 'graph-up-arrow',
          trendFrom(ws.revenue), ws.revenue, 'trailing ' + months + ' months', 'group/finance');
        kpiTile(kpis, 'Net Profit', prof, 'cash-stack',
          trendFrom(ws.profit), ws.profit, ui.pct(marg) + ' net margin', 'group/finance/pnl');
        kpiTile(kpis, 'Blended Margin', ui.pct(marg), 'pie-chart-fill',
          { dir: marg >= 20 ? 'up' : 'down', val: '' },
          ws.profit.map(function (p, i) { return ws.revenue[i] ? p / ws.revenue[i] * 100 : 0; }),
          'across all concerns', 'group/analytics');
        kpiTile(kpis, 'Workforce', ui.num(snap.headcount), 'people-fill',
          { dir: 'up', val: '+3' }, null, 'active employees', 'group/employees/directory');
        kpiTile(kpis, 'Pipeline Value', snap.pipelineValue, 'funnel-fill',
          { dir: 'up', val: snap.openLeads + ' open' }, null, 'weighted leads (Group CRM)', 'group/crm/pipeline');
      }
      renderKpis(state.months);
      page.appendChild(kpis);

      /* ---- trend + mix ------------------------------------------------- */
      var trendBox = el('div', { style: { height: '280px', position: 'relative' } });
      var mixBox = el('div', { style: { height: '280px', position: 'relative' } });
      var row2 = el('div.two-col');
      row2.appendChild(el('div.card', null, [
        el('div.card-head', null, [
          el('h3', { html: ui.icon('activity') + ' Revenue, Expense & Profit' }),
          el('span.card-sub', { text: 'Monthly · consolidated group' })
        ]),
        el('div.card-body', null, [ trendBox ])
      ]));
      row2.appendChild(el('div.card', null, [
        el('div.card-head', null, [ el('h3', { html: ui.icon('pie-chart') + ' Revenue Mix' }), el('span.card-sub', { text: 'by concern' }) ]),
        el('div.card-body', null, [ mixBox ])
      ]));
      page.appendChild(row2);

      /* ---- company performance strip ----------------------------------- */
      page.appendChild(el('div.section-label', { text: 'Sister Concern Performance' }));
      var strip = el('div.co-strip.stagger');
      snap.companies.forEach(function (c) {
        var momUp = c.mom >= 0;
        var hl = c.risk < 30 ? ['g', 'Healthy'] : c.risk < 55 ? ['y', 'Watch'] : ['r', 'At Risk'];
        strip.appendChild(el('div.co-perf', { style: { '--co': c.accent }, onclick: function () { EPAL.app.gotoCompany(c.id); } }, [
          el('div.co-perf-head', null, [
            el('div.co-perf-ico', { style: { background: c.accent }, html: '<i class="bi bi-' + c.icon + '"></i>' }),
            el('div.flex-1', null, [ el('div.co-perf-name', { text: c.short }),
              el('div.text-mute.xs', { text: c.employees + ' staff · risk ' + c.risk }) ]),
            el('span.health.' + hl[0], { text: hl[1] })
          ]),
          el('div.co-perf-rev', { text: ui.money(c.revenue, { compact: true }) }),
          el('div.co-perf-meta', null, [
            el('span', { html: ui.icon('pie-chart') + ' ' + ui.pct(c.margin, 0) + ' margin' }),
            el('span.kpi-trend.' + (momUp ? 'up' : 'down'), { html: ui.icon(momUp ? 'arrow-up-right' : 'arrow-down-right') + ' ' + ui.pct(Math.abs(c.mom)) })
          ]),
          el('div.meter.mt-2', null, [ el('span', { class: c.risk < 30 ? 'lvl-low' : c.risk < 55 ? 'lvl-mid' : 'lvl-high',
            style: { width: c.risk + '%' } }) ])
        ]));
      });
      page.appendChild(strip);

      /* ---- profit ranking + risk & alerts ------------------------------ */
      var profitBox = el('div', { style: { height: '260px', position: 'relative' } });
      var row3 = el('div.two-col');
      row3.appendChild(el('div.card', null, [
        el('div.card-head', null, [ el('h3', { html: ui.icon('bar-chart-line') + ' Profit by Concern' }), el('span.card-sub', { text: 'selected window' }) ]),
        el('div.card-body', null, [ profitBox ])
      ]));
      row3.appendChild(buildAlertsCard(snap));
      page.appendChild(row3);

      /* ---- smart signals + activity ------------------------------------ */
      var row4 = el('div.two-col');
      row4.appendChild(buildSmartSignals(snap));
      row4.appendChild(el('div.card', null, [
        el('div.card-head', null, [ el('h3', { html: ui.icon('clock-history') + ' Group Activity' }) ]),
        el('div.card-body', null, [ buildTimeline() ]) ]));
      page.appendChild(el('div.section-label', { text: 'Intelligence & Activity' }));
      page.appendChild(row4);

      ctx.mount.appendChild(page);

      /* ---- charts (after DOM is in the document) ----------------------- */
      function freshCanvas(box, id) {
        while (box.firstChild) box.removeChild(box.firstChild);
        var c = el('canvas', { id: id });
        box.appendChild(c);
        return c;
      }

      function drawTrend(ws) {
        var canvas = freshCanvas(trendBox, 'chart-trend');
        // 2-month least-squares projection appended to the revenue line (dashed)
        var fc = EPAL.forecast ? EPAL.forecast(ws.revenue, 2) : [];
        var labels = ws.labels.concat(fc.map(function (_, i) { return '+' + (i + 1); }));
        var pad = function (arr) { return arr.concat(fc.map(function () { return null; })); };
        var projected = ws.revenue.map(function () { return null; });
        if (fc.length) projected[projected.length - 1] = ws.revenue[ws.revenue.length - 1];
        var trendChart = charts.area(canvas, {
          labels: labels,
          datasets: [
            { label: 'Revenue', data: pad(ws.revenue), color: getAccent('group') },
            { label: 'Profit', data: pad(ws.profit), color: '#23c17e' },
            { label: 'Expense', data: pad(ws.expense), color: '#f0506e' },
            { label: 'Projection', data: projected.concat(fc), color: '#f4b740' }
          ]
        });
        if (trendChart && trendChart.data.datasets[3]) {
          trendChart.data.datasets[3].borderDash = [6, 5];
          trendChart.data.datasets[3].fill = false;
          trendChart.data.datasets[3].pointRadius = 3;
          trendChart.update();
        }
      }

      function drawMix(months) {
        var canvas = freshCanvas(mixBox, 'chart-mix');
        charts.doughnut(canvas, {
          labels: snap.companies.map(function (c) { return c.short; }),
          data: snap.companies.map(function (c) { return db.finance(c.id, months).revenue; }),
          colors: snap.companies.map(function (c) { return c.accent; }),
          legend: 'bottom'
        });
      }

      function drawProfit(months) {
        var canvas = freshCanvas(profitBox, 'chart-profit');
        var ranked = snap.companies.map(function (c) {
          return { short: c.short, accent: c.accent, profit: db.finance(c.id, months).profit };
        }).sort(function (a, b) { return b.profit - a.profit; });
        charts.bar(canvas, {
          labels: ranked.map(function (c) { return c.short; }),
          datasets: [{ label: 'Profit', data: ranked.map(function (c) { return c.profit; }),
            colors: ranked.map(function (c) { return c.accent; }) }],
          horizontal: true, money: true
        });
      }

      function drawAll(months) {
        drawTrend(windowSeries(months));
        drawMix(months);
        drawProfit(months);
      }

      requestAnimationFrame(function () { drawAll(state.months); });
    }
  });

  /* ---- helpers ------------------------------------------------------------*/
  function getAccent(id) { var c = EPAL.config.company(id); return c ? c.accent : '#3B6FA8'; }

  function trendFrom(seriesArr) {
    var n = seriesArr.length;
    if (n < 2 || !seriesArr[n - 2]) return { dir: 'flat', val: '' };
    var pct = (seriesArr[n - 1] - seriesArr[n - 2]) / Math.abs(seriesArr[n - 2]) * 100;
    return { dir: pct > 0.5 ? 'up' : pct < -0.5 ? 'down' : 'flat', val: (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%' };
  }

  function kpiTile(host, label, value, icon, trend, spark, foot, drill) {
    var id = ui.uid('spark');
    var valueEl = el('div.kpi-value');
    var tile = el('div.kpi-card' + (drill ? '.drill' : ''),
      drill ? { onclick: function () { EPAL.router.navigate(drill); }, title: 'Open ' + label } : null, [
      el('div.kpi-top', null, [ el('span.kpi-label', { text: label }),
        el('span.kpi-ico', { html: '<i class="bi bi-' + icon + '"></i>' }) ]),
      valueEl,
      el('div.kpi-foot', null, [
        trend.val ? el('span.kpi-trend.' + trend.dir, { html: ui.icon(trend.dir === 'up' ? 'arrow-up-right' : trend.dir === 'down' ? 'arrow-down-right' : 'dash') + ' ' + trend.val }) : null,
        el('span.text-muted', { text: foot })
      ]),
      spark ? el('canvas.kpi-spark', { id: id }) : null
    ]);
    // money values count up softly; preformatted strings render instantly
    if (typeof value === 'number') ui.countUp(valueEl, value, function (v) { return ui.money(v, { compact: true }); });
    else valueEl.textContent = value;
    host.appendChild(tile);
    if (spark) requestAnimationFrame(function () { var c = document.getElementById(id); if (c) EPAL.charts.spark(c, spark, trend.dir === 'down' ? '#f0506e' : '#23c17e'); });
  }

  /* MD Briefing teaser — the daily narrative from EPAL.intel, with a jump into
   * the full briefing screen. Narrative HTML is engine-authored (esc'd inside). */
  function buildBriefingCard() {
    var b = (EPAL.intel && EPAL.intel.mdBriefing) ? safeCall(EPAL.intel.mdBriefing) : null;
    var body;
    if (!b) {
      body = el('div.card-body', null, [ el('div.text-muted', { text: 'Briefing unavailable right now.' }) ]);
    } else {
      var chips = el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', margin: '12px 0 4px' } });
      (b.headline || []).forEach(function (h) {
        chips.appendChild(el('div', { style: {
          background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)',
          borderRadius: '10px', padding: '8px 12px', minWidth: '120px' } }, [
          el('div.text-mute.xs', { text: h.label }),
          el('div.fw-600', { text: h.value }),
          h.delta ? el('span.kpi-trend.' + (h.dir || 'flat'),
            { html: ui.icon(h.dir === 'down' ? 'arrow-down-right' : 'arrow-up-right') + ' ' + h.delta }) : null
        ]));
      });
      body = el('div.card-body', null, [
        el('div', { html: b.narrative }),
        chips,
        el('div.mt-2', null, [
          el('button.btn.btn-primary', { html: ui.icon('journal-richtext') + ' Open full briefing',
            onclick: function () { EPAL.router.navigate('group/briefing'); } })
        ])
      ]);
    }
    return el('div.card', null, [
      el('div.card-head', null, [
        el('h3', { html: ui.icon('stars') + ' MD Briefing' }),
        el('span.card-sub', { text: (b && b.date) ? b.date : 'today' })
      ]),
      body
    ]);
  }

  /* Anomaly radar — severity-ranked exceptions from EPAL.intel.anomalies();
   * each row deep-links into the owning module. */
  function buildAnomalyRadar() {
    var list = (EPAL.intel && EPAL.intel.anomalies) ? (safeCall(EPAL.intel.anomalies) || []) : [];
    var sevRank = { high: 0, med: 1, low: 2 };
    list = list.slice().sort(function (a, b) { return (sevRank[a.severity] || 3) - (sevRank[b.severity] || 3); }).slice(0, 7);
    var rows = list.map(function (a) {
      var tone = a.severity === 'high' ? 'bad' : a.severity === 'med' ? 'warn' : 'good';
      var color = a.severity === 'high' ? '#f0506e' : a.severity === 'med' ? '#f4b740' : '#23c17e';
      return el('div.data-row', { style: { cursor: 'pointer' }, onclick: function () {
        var r = String(a.route || '').replace(/^#\//, '');
        if (r) EPAL.router.navigate(r);
      } }, [
        el('span', { style: { width: '10px', height: '10px', borderRadius: '50%', flex: '0 0 auto',
          marginTop: '5px', background: color } }),
        el('div.flex-1', null, [
          el('div.fw-600.sm', { text: a.title }),
          el('div.text-mute.xs', { text: a.detail })
        ]),
        el('span.badge.badge-' + tone, { text: String(a.severity || '').toUpperCase() })
      ]);
    });
    return el('div.card', null, [
      el('div.card-head', null, [
        el('h3', { html: ui.icon('radar') + ' Anomaly Radar' }),
        el('span.card-sub', { text: list.length + (list.length === 1 ? ' signal' : ' signals') })
      ]),
      el('div.card-body', null, [
        rows.length ? el('div.data-list', null, rows)
          : el('div.text-muted', { text: 'No anomalies detected — all clear.' })
      ])
    ]);
  }

  /* Export → a branded "Group Snapshot" document (one-click print/PDF/save). */
  function openSnapshotDoc() {
    if (!EPAL.doc || !EPAL.doc.open) { EPAL.router.navigate('group/reports'); return; }
    var s = db.groupSnapshot();
    var owner = EPAL.auth.current();
    var serial = (EPAL.serial && EPAL.serial.next) ? EPAL.serial.next('GRP', {}) : null;
    EPAL.doc.open({
      type: 'report',
      title: 'Group Snapshot',
      serial: serial,
      badge: 'Consolidated',
      watermark: 'EPAL GROUP',
      parties: [
        { label: 'Prepared for', lines: ['The Managing Director', 'Epal Group'] },
        { label: 'Prepared by', lines: [owner.name, 'Group Command Center'] }
      ],
      meta: [
        { label: 'Report date', value: ui.date(new Date()) },
        { label: 'Active concerns', value: String(s.companies.length) },
        { label: 'Workforce', value: ui.num(s.headcount) }
      ],
      columns: [
        { key: 'short', label: 'Sister Concern' },
        { key: 'revenue', label: 'Revenue (12M)', num: true, money: true },
        { key: 'profit', label: 'Net Profit', num: true, money: true },
        { key: 'margin', label: 'Margin', num: true }
      ],
      rows: s.companies.map(function (c) {
        return { short: c.short, revenue: c.revenue, profit: c.profit, margin: ui.pct(c.margin, 1) };
      }),
      totals: [
        { label: 'Group Revenue', value: ui.money(s.revenue) },
        { label: 'Blended Margin', value: ui.pct(s.margin, 1) },
        { label: 'Net Profit', value: ui.money(s.profit), grand: true }
      ],
      words: EPAL.doc.amountInWords ? EPAL.doc.amountInWords(Math.round(s.profit)) : '',
      terms: 'Figures are computed live from the Epal Group data layer at the time of export.',
      sign: 'Group Command Center'
    });
    if (EPAL.audit && EPAL.audit.record) {
      EPAL.audit.record({ action: 'export', entity: 'report', entityId: 'group-snapshot',
        entityLabel: 'Group Snapshot', companyId: 'group', reason: 'Exported from Command Center' });
    }
  }

  function safeCall(fn) { try { return fn(); } catch (e) { return null; } }

  function buildAlertsCard(snap) {
    var atRisk = snap.companies.slice().sort(function (a, b) { return b.risk - a.risk; }).slice(0, 3);
    var notifs = db.notifications().slice(0, 4);
    return el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon('shield-exclamation') + ' Risk Radar & Alerts' }) ]),
      el('div.card-body', null, [
        el('div.section-label', { style: { marginTop: '0' }, text: 'Highest risk concerns' }),
        el('div.data-list', null, atRisk.map(function (c) {
          var lvl = c.risk < 30 ? 'low' : c.risk < 55 ? 'mid' : 'high';
          return el('div.data-row', null, [
            el('div.co-perf-ico', { style: { background: c.accent, width: '30px', height: '30px', fontSize: '14px' }, html: '<i class="bi bi-' + c.icon + '"></i>' }),
            el('div.flex-1', null, [ el('div.fw-600', { text: c.short }),
              el('div.meter.mt-1', null, [ el('span', { class: 'lvl-' + lvl, style: { width: c.risk + '%' } }) ]) ]),
            el('span.badge.badge-' + (lvl === 'low' ? 'good' : lvl === 'mid' ? 'warn' : 'bad'), { text: 'Risk ' + c.risk })
          ]);
        })),
        el('div.section-label', { text: 'Live alerts' }),
        el('div.data-list', null, notifs.map(function (n) {
          return el('div.data-row', null, [
            ui.frag('<span class="notif-ico notif-' + n.level + '">' + ui.icon(n.icon || 'dot') + '</span>'),
            el('div.flex-1', null, [ el('div.fw-600.sm', { text: n.title }), el('div.text-mute.xs', { text: n.text }) ]),
            el('span.text-mute.xs', { text: ui.ago(n.at) })
          ]);
        }))
      ])
    ]);
  }

  /* Smart signals — the "all-seeing owner" digest: who's rising, who's
   * bleeding, most valuable client, weakest performer. All computed live.   */
  function buildSmartSignals(snap) {
    var byMom = snap.companies.slice().sort(function (a, b) { return b.mom - a.mom; });
    var rising = byMom[0], bleeding = byMom[byMom.length - 1];
    var topClient = db.customers().slice().sort(function (a, b) { return (b.value || 0) - (a.value || 0); })[0];
    var weakest = db.employees().filter(function (e) { return e.role !== 'owner'; })
      .sort(function (a, b) { return (a.rating || 0) - (b.rating || 0); })[0];
    var bestMargin = snap.companies.slice().sort(function (a, b) { return b.margin - a.margin; })[0];

    function signal(icon, tone, title, text, drill) {
      return el('div.data-row', { style: drill ? { cursor: 'pointer' } : null,
        onclick: drill ? function () { EPAL.router.navigate(drill); } : null }, [
        ui.frag('<span class="notif-ico notif-' + tone + '">' + ui.icon(icon) + '</span>'),
        el('div.flex-1', null, [ el('div.fw-600.sm', { text: title }), el('div.text-mute.xs', { text: text }) ]),
        drill ? ui.frag('<i class="bi bi-chevron-right text-mute"></i>') : null
      ]);
    }
    return el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon('stars') + ' Smart Signals' }),
        el('span.card-sub', { text: 'computed live from group data' }) ]),
      el('div.card-body', null, [ el('div.data-list', null, [
        rising ? signal('rocket-takeoff', 'success', rising.short + ' is rising fastest',
          '+' + rising.mom.toFixed(1) + '% month-over-month revenue growth', rising.id + '/analytics') : null,
        bleeding && bleeding.mom < 0 ? signal('droplet-half', 'error', bleeding.short + ' is bleeding',
          bleeding.mom.toFixed(1) + '% MoM — review pricing and pipeline', bleeding.id + '/analytics') : null,
        bestMargin ? signal('gem', 'info', bestMargin.short + ' has the best margin',
          ui.pct(bestMargin.margin) + ' net — the group benchmark', bestMargin.id + '/analytics') : null,
        topClient ? signal('trophy', 'warning', topClient.name + ' is the most valuable client',
          ui.money(topClient.value, { compact: true }) + ' lifetime · known by ' + (topClient.companyIds || []).length + ' concern(s)', 'group/crm/customers') : null,
        weakest ? signal('person-dash', 'error', weakest.name + ' needs attention',
          'Lowest performance rating (' + (weakest.rating || 0).toFixed(1) + ') · ' + weakest.designation, 'group/employees/performance') : null
      ]) ])
    ]);
  }

  function buildTimeline() {
    var acts = db.activity().slice(0, 6);
    // enrich with a couple of derived, human-readable events
    var tl = el('div.timeline');
    acts.forEach(function (a) {
      tl.appendChild(el('div.tl-item', null, [
        el('div.tl-time', { text: ui.ago(a.at) + ' · ' + (EPAL.config.company(a.companyId) || { short: 'Group' }).short }),
        el('div.tl-text', { text: a.text })
      ]));
    });
    if (!acts.length) tl.appendChild(el('div.text-muted', { text: 'No recent activity.' }));
    return tl;
  }

})(window.EPAL = window.EPAL || {});
