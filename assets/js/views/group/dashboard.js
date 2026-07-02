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
 * Sections: greeting + period → KPI hero → revenue/expense trend + revenue mix
 * → per-company performance strip → profit ranking + risk radar & alerts
 * → group activity timeline.
 * ==========================================================================*/

(function (EPAL) {
  'use strict';
  var ui = EPAL.ui, el = ui.el, db = EPAL.db, charts = EPAL.charts;

  EPAL.view('group/dashboard', {
    render: function (ctx) {
      var snap = db.groupSnapshot();
      var series = db.series();                 // whole-group monthly series
      var page = el('div.page');

      /* ---- greeting + period ------------------------------------------- */
      var hr = new Date().getHours();
      var greet = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
      var owner = EPAL.auth.current();
      page.appendChild(EPAL.pageHead({
        eyebrow: greet + ', ' + owner.name.split(' ')[0],
        title: 'Group Command Center',
        sub: 'Consolidated health across ' + snap.companies.length + ' active sister concerns · fiscal year ' + EPAL.config.group.established + '→now.',
        actions: [
          el('div.pill-tab', null, ['12M','6M','3M'].map(function (p, i) {
            return el('button' + (i === 0 ? '.active' : ''), { text: p, onclick: function (e) {
              ui.$$('.pill-tab button', e.target.parentNode).forEach(function (b) { b.classList.remove('active'); });
              e.target.classList.add('active');
            } });
          })),
          el('button.btn.btn-ghost', { html: ui.icon('download') + ' Export', onclick: function () {
            EPAL.exportReport ? EPAL.exportReport('group-snapshot') : ui.toast('Report queued', 'info'); } }),
          el('button.btn.btn-primary', { html: ui.icon('toggles2') + ' Module Control',
            onclick: function () { EPAL.router.navigate('group/module-manager'); } })
        ]
      }));

      /* ---- KPI hero ---------------------------------------------------- */
      var kpis = el('div.kpi-grid.stagger');
      kpiTile(kpis, 'Group Revenue', ui.money(snap.revenue, { compact: true }), 'graph-up-arrow',
        trendFrom(series.revenue), series.revenue, 'trailing 12 months');
      kpiTile(kpis, 'Net Profit', ui.money(snap.profit, { compact: true }), 'cash-stack',
        trendFrom(series.profit), series.profit, ui.pct(snap.margin) + ' net margin');
      kpiTile(kpis, 'Blended Margin', ui.pct(snap.margin), 'pie-chart-fill',
        { dir: snap.margin >= 20 ? 'up' : 'down', val: '' }, series.profit.map(function (p, i) { return series.revenue[i] ? p / series.revenue[i] * 100 : 0; }), 'across all concerns', true);
      kpiTile(kpis, 'Workforce', ui.num(snap.headcount), 'people-fill',
        { dir: 'up', val: '+3' }, null, 'active employees');
      kpiTile(kpis, 'Pipeline Value', ui.money(snap.pipelineValue, { compact: true }), 'funnel-fill',
        { dir: 'up', val: snap.openLeads + ' open' }, null, 'weighted leads (Group CRM)');
      page.appendChild(kpis);

      /* ---- trend + mix ------------------------------------------------- */
      var row2 = el('div.two-col');
      var trendCard = el('div.card', null, [
        el('div.card-head', null, [
          el('h3', { html: ui.icon('activity') + ' Revenue, Expense & Profit' }),
          el('span.card-sub', { text: 'Monthly · consolidated group' })
        ]),
        el('div.card-body', null, [ el('div', { style:{ height:'280px', position:'relative' } }, [ el('canvas#chart-trend') ]) ])
      ]);
      var mixCard = el('div.card', null, [
        el('div.card-head', null, [ el('h3', { html: ui.icon('pie-chart') + ' Revenue Mix' }), el('span.card-sub', { text:'by concern' }) ]),
        el('div.card-body', null, [ el('div', { style:{ height:'280px', position:'relative' } }, [ el('canvas#chart-mix') ]) ])
      ]);
      row2.appendChild(trendCard); row2.appendChild(mixCard);
      page.appendChild(row2);

      /* ---- company performance strip ----------------------------------- */
      page.appendChild(el('div.section-label', { text: 'Sister Concern Performance' }));
      var strip = el('div.co-strip.stagger');
      snap.companies.forEach(function (c) {
        var momUp = c.mom >= 0;
        strip.appendChild(el('div.co-perf', { style:{ '--co': c.accent }, onclick: function () { EPAL.app.gotoCompany(c.id); } }, [
          el('div.co-perf-head', null, [
            el('div.co-perf-ico', { style:{ background:c.accent }, html: '<i class="bi bi-' + c.icon + '"></i>' }),
            el('div', null, [ el('div.co-perf-name', { text: c.short }),
              el('div.text-mute.xs', { text: c.employees + ' staff · risk ' + c.risk }) ])
          ]),
          el('div.co-perf-rev', { text: ui.money(c.revenue, { compact: true }) }),
          el('div.co-perf-meta', null, [
            el('span', { html: ui.icon('pie-chart') + ' ' + ui.pct(c.margin, 0) + ' margin' }),
            el('span.kpi-trend.' + (momUp ? 'up' : 'down'), { html: ui.icon(momUp ? 'arrow-up-right' : 'arrow-down-right') + ' ' + ui.pct(Math.abs(c.mom)) })
          ]),
          el('div.meter.mt-2', null, [ el('span', { class: c.risk < 30 ? 'lvl-low' : c.risk < 55 ? 'lvl-mid' : 'lvl-high',
            style:{ width: c.risk + '%' } }) ])
        ]));
      });
      page.appendChild(strip);

      /* ---- profit ranking + risk & alerts ------------------------------ */
      var row3 = el('div.two-col');
      row3.appendChild(el('div.card', null, [
        el('div.card-head', null, [ el('h3', { html: ui.icon('bar-chart-line') + ' Profit by Concern' }), el('span.card-sub', { text:'trailing 12M' }) ]),
        el('div.card-body', null, [ el('div', { style:{ height:'260px', position:'relative' } }, [ el('canvas#chart-profit') ]) ])
      ]));
      row3.appendChild(buildAlertsCard(snap));
      page.appendChild(row3);

      /* ---- activity timeline ------------------------------------------- */
      page.appendChild(el('div.section-label', { text: 'Group Activity' }));
      var actCard = el('div.card', null, [ el('div.card-body', null, [ buildTimeline() ]) ]);
      page.appendChild(actCard);

      ctx.mount.appendChild(page);

      /* ---- charts (after DOM is in the document) ----------------------- */
      requestAnimationFrame(function () {
        charts.area(ui.$('#chart-trend'), {
          labels: series.labels,
          datasets: [
            { label: 'Revenue', data: series.revenue, color: getAccent('group') },
            { label: 'Profit', data: series.profit, color: '#23c17e' },
            { label: 'Expense', data: series.expense, color: '#f0506e' }
          ]
        });
        charts.doughnut(ui.$('#chart-mix'), {
          labels: snap.companies.map(function (c) { return c.short; }),
          data: snap.companies.map(function (c) { return c.revenue; }),
          colors: snap.companies.map(function (c) { return c.accent; }),
          legend: 'bottom'
        });
        var ranked = snap.companies.slice().sort(function (a, b) { return b.profit - a.profit; });
        charts.bar(ui.$('#chart-profit'), {
          labels: ranked.map(function (c) { return c.short; }),
          datasets: [{ label: 'Profit', data: ranked.map(function (c) { return c.profit; }),
            colors: ranked.map(function (c) { return c.accent; }) }],
          horizontal: true, money: true
        });
      });
    }
  });

  /* ---- helpers ------------------------------------------------------------*/
  function getAccent(id) { var c = EPAL.config.company(id); return c ? c.accent : '#c8a24a'; }

  function trendFrom(seriesArr) {
    var n = seriesArr.length;
    if (n < 2 || !seriesArr[n - 2]) return { dir: 'flat', val: '' };
    var pct = (seriesArr[n - 1] - seriesArr[n - 2]) / Math.abs(seriesArr[n - 2]) * 100;
    return { dir: pct > 0.5 ? 'up' : pct < -0.5 ? 'down' : 'flat', val: (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%' };
  }

  function kpiTile(host, label, value, icon, trend, spark, foot, isPct) {
    var id = ui.uid('spark');
    var tile = el('div.kpi-card', null, [
      el('div.kpi-top', null, [ el('span.kpi-label', { text: label }),
        el('span.kpi-ico', { html: '<i class="bi bi-' + icon + '"></i>' }) ]),
      el('div.kpi-value', { text: value }),
      el('div.kpi-foot', null, [
        trend.val ? el('span.kpi-trend.' + trend.dir, { html: ui.icon(trend.dir === 'up' ? 'arrow-up-right' : trend.dir === 'down' ? 'arrow-down-right' : 'dash') + ' ' + trend.val }) : null,
        el('span.text-muted', { text: foot })
      ]),
      spark ? el('canvas.kpi-spark', { id: id }) : null
    ]);
    host.appendChild(tile);
    if (spark) requestAnimationFrame(function () { var c = document.getElementById(id); if (c) EPAL.charts.spark(c, spark, trend.dir === 'down' ? '#f0506e' : '#23c17e'); });
  }

  function buildAlertsCard(snap) {
    var atRisk = snap.companies.slice().sort(function (a, b) { return b.risk - a.risk; }).slice(0, 3);
    var notifs = db.notifications().slice(0, 4);
    return el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon('shield-exclamation') + ' Risk Radar & Alerts' }) ]),
      el('div.card-body', null, [
        el('div.section-label', { style:{ marginTop:'0' }, text:'Highest risk concerns' }),
        el('div.data-list', null, atRisk.map(function (c) {
          var lvl = c.risk < 30 ? 'low' : c.risk < 55 ? 'mid' : 'high';
          return el('div.data-row', null, [
            el('div.co-perf-ico', { style:{ background:c.accent, width:'30px', height:'30px', fontSize:'14px' }, html:'<i class="bi bi-' + c.icon + '"></i>' }),
            el('div.flex-1', null, [ el('div.fw-600', { text: c.short }),
              el('div.meter.mt-1', null, [ el('span', { class:'lvl-' + lvl, style:{ width:c.risk + '%' } }) ]) ]),
            el('span.badge.badge-' + (lvl === 'low' ? 'good' : lvl === 'mid' ? 'warn' : 'bad'), { text: 'Risk ' + c.risk })
          ]);
        })),
        el('div.section-label', { text:'Live alerts' }),
        el('div.data-list', null, notifs.map(function (n) {
          return el('div.data-row', null, [
            ui.frag('<span class="notif-ico notif-' + n.level + '">' + ui.icon(n.icon || 'dot') + '</span>'),
            el('div.flex-1', null, [ el('div.fw-600.sm', { text:n.title }), el('div.text-mute.xs', { text:n.text }) ]),
            el('span.text-mute.xs', { text: ui.ago(n.at) })
          ]);
        }))
      ])
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
