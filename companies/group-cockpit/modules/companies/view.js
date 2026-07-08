/* ============================================================================
 * EPAL GROUP ERP  ·  views/group/companies.js
 * ----------------------------------------------------------------------------
 * SISTER CONCERNS — the premium portfolio overview (route: group/companies).
 *
 * One rich card per enabled concern (from db.groupSnapshot): identity (icon,
 * name, tagline), 12-month revenue with a live spark line, profit, margin and
 * headcount stats, MoM trend badge, composite risk meter and a health pill —
 * plus one-click drills into that concern's Dashboard, Analytics and Accounts.
 * A KPI summary strip and a revenue-vs-profit comparison chart sit on top so
 * the owner reads the whole portfolio before touching a single card.
 *
 * Data: db.groupSnapshot() and db.series(companyId) — all live, so a sale
 * posted by any operating module moves these cards immediately.
 * ==========================================================================*/

(function (EPAL) {
  'use strict';
  var ui = EPAL.ui, el = ui.el;
  var db = function () { return EPAL.db; };

  var GREEN = '#23c17e';

  function kpi(label, value, icon, foot, drill) {
    return el('div.kpi-card' + (drill ? '.drill' : ''),
      drill ? { onclick: function () { EPAL.router.navigate(drill); }, title: 'Open ' + label } : null, [
      el('div.kpi-top', null, [ el('span.kpi-label', { text: label }),
        el('span.kpi-ico', { html: '<i class="bi bi-' + icon + '"></i>' }) ]),
      el('div.kpi-value', { text: String(value) }),
      foot ? el('div.kpi-foot', null, [ el('span.text-muted', { text: foot }) ]) : null
    ]);
  }

  function healthOf(risk) {
    return risk < 30 ? ['g', 'Healthy'] : risk < 55 ? ['y', 'Watch'] : ['r', 'At Risk'];
  }

  EPAL.view('group/companies', { render: function (ctx) {
    var snap = db().groupSnapshot();
    var page = el('div.page');

    page.appendChild(EPAL.pageHead({
      eyebrow: 'Epal Group · Portfolio', icon: 'diagram-3-fill',
      title: 'Sister Concerns',
      sub: snap.companies.length + ' active concerns · ' + ui.money(snap.revenue, { compact: true }) +
        ' consolidated revenue · ' + ui.pct(snap.margin) + ' blended margin.',
      actions: [
        el('button.btn.btn-ghost', { html: ui.icon('graph-up-arrow') + ' Compare Side-by-Side',
          onclick: function () { EPAL.router.navigate('group/analytics/compare'); } }),
        EPAL.auth.isAdmin() ? el('button.btn.btn-primary', { html: ui.icon('toggles2') + ' Module Control',
          onclick: function () { EPAL.router.navigate('group/module-manager'); } }) : null
      ]
    }));

    /* ---- summary strip ---------------------------------------------------*/
    page.appendChild(el('div.kpi-grid.stagger', null, [
      kpi('Portfolio Revenue', ui.money(snap.revenue, { compact: true }), 'cash-coin',
        'trailing 12 months, all concerns', 'group/finance'),
      kpi('Portfolio Profit', ui.money(snap.profit, { compact: true }), 'cash-stack',
        ui.pct(snap.margin) + ' blended margin', 'group/finance/pnl'),
      kpi('Active Concerns', snap.companies.length, 'buildings',
        'switch any on or off in Module Control', 'group/module-manager'),
      kpi('Group Workforce', ui.num(snap.headcount), 'people-fill',
        'across every concern', 'group/employees/directory'),
      kpi('Shared Customers', ui.num(snap.customers), 'person-hearts',
        'one customer graph, five businesses', 'group/crm/customers')
    ]));

    /* ---- portfolio comparison chart ---------------------------------------*/
    var cmpId = ui.uid('sc-cmp');
    page.appendChild(el('div.card', null, [
      el('div.card-head', null, [
        el('h3', { html: ui.icon('bar-chart') + ' Revenue vs Profit by Concern' }),
        el('span.card-sub', { text: 'trailing 12 months' })
      ]),
      el('div.card-body', null, [
        el('div', { style: { height: '260px', position: 'relative' } }, [ el('canvas', { id: cmpId }) ])
      ])
    ]));

    /* ---- one premium card per concern -------------------------------------*/
    page.appendChild(el('div.section-label', { text: 'The Concerns' }));
    var grid = el('div.grid-auto.stagger', { style: { gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' } });
    var sparks = [];

    snap.companies.forEach(function (c) {
      var co = EPAL.config.company(c.id) || {};
      var hl = healthOf(c.risk);
      var lvl = c.risk < 30 ? 'low' : c.risk < 55 ? 'mid' : 'high';
      var momUp = c.mom >= 0;
      var sparkId = ui.uid('sc-sp');
      sparks.push({ id: sparkId, cid: c.id, accent: c.accent });

      var card = el('div.card.hover', { style: { '--co': c.accent } }, [
        el('div.card-pad', null, [
          // identity row
          el('div.flex.items-center.gap-2', null, [
            el('div.co-perf-ico', { style: { background: c.accent, width: '42px', height: '42px', fontSize: '19px' },
              html: '<i class="bi bi-' + c.icon + '"></i>' }),
            el('div.flex-1', { style: { minWidth: '0' } }, [
              el('div.fw-600', { text: c.name, style: { fontSize: '15px' } }),
              el('div.text-mute.xs', { text: co.tagline || 'Sister concern' })
            ]),
            el('span.health.' + hl[0], { text: hl[1] })
          ]),
          // revenue + MoM trend
          el('div.flex.items-center.gap-2.mt-3', null, [
            el('div.flex-1', null, [
              el('div.text-mute.xs', { text: 'Revenue · 12M' }),
              el('div', { text: ui.money(c.revenue, { compact: true }),
                style: { fontSize: '24px', fontWeight: '700', fontVariantNumeric: 'tabular-nums' } })
            ]),
            el('span.kpi-trend.' + (momUp ? 'up' : 'down'), {
              html: ui.icon(momUp ? 'arrow-up-right' : 'arrow-down-right') + ' ' +
                (momUp ? '+' : '') + c.mom.toFixed(1) + '% MoM'
            })
          ]),
          // spark line of monthly revenue
          el('div.mt-2', { style: { height: '48px', position: 'relative' } }, [ el('canvas', { id: sparkId }) ]),
          // profit / margin / team stats
          el('div.stat-row.mt-3', null, [
            el('div.stat', null, [ el('div.stat-label', { text: 'Profit' }),
              el('div.stat-value', { text: ui.money(c.profit, { compact: true }),
                style: { color: c.profit >= 0 ? GREEN : '#f0506e' } }) ]),
            el('div.stat', null, [ el('div.stat-label', { text: 'Margin' }),
              el('div.stat-value', { text: ui.pct(c.margin) }) ]),
            el('div.stat', null, [ el('div.stat-label', { text: 'Team' }),
              el('div.stat-value', { text: String(c.employees) }) ])
          ]),
          // risk meter
          el('div.flex.items-center.gap-2.mt-3', null, [
            el('span.text-mute.xs', { text: 'Risk', style: { flex: 'none' } }),
            el('div.meter.flex-1', null, [ el('span', { class: 'lvl-' + lvl, style: { width: c.risk + '%' } }) ]),
            el('span.text-mute.xs.num', { text: c.risk + '/100' })
          ]),
          // drill buttons
          el('div.flex.gap-1.mt-3', null, [
            el('button.btn.btn-sm.btn-primary.flex-1', { html: ui.icon('speedometer2') + ' Dashboard',
              onclick: function () { EPAL.router.navigate(c.id + '/dashboard'); } }),
            el('button.btn.btn-sm.btn-ghost', { html: ui.icon('graph-up') + ' Analytics',
              title: c.short + ' analytics',
              onclick: function () { EPAL.router.navigate(c.id + '/analytics'); } }),
            el('button.btn.btn-sm.btn-ghost', { html: ui.icon('cash-stack') + ' Accounts',
              title: c.short + ' accounts',
              onclick: function () { EPAL.router.navigate(c.id + '/accounts'); } })
          ])
        ])
      ]);
      grid.appendChild(card);
    });
    page.appendChild(grid);
    ctx.mount.appendChild(page);

    /* ---- charts after mount -----------------------------------------------*/
    requestAnimationFrame(function () {
      var cmp = document.getElementById(cmpId);
      if (cmp) EPAL.charts.bar(cmp, {
        labels: snap.companies.map(function (c) { return c.short; }),
        legend: true,
        datasets: [
          { label: 'Revenue', data: snap.companies.map(function (c) { return c.revenue; }),
            colors: snap.companies.map(function (c) { return c.accent; }) },
          { label: 'Profit', data: snap.companies.map(function (c) { return c.profit; }), color: GREEN }
        ]
      });
      sparks.forEach(function (sp) {
        var cv = document.getElementById(sp.id);
        if (cv) EPAL.charts.spark(cv, db().series(sp.cid).revenue, sp.accent);
      });
    });
  } });

})(window.EPAL = window.EPAL || {});
