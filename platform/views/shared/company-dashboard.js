/* ============================================================================
 * EPAL GROUP ERP  ·  views/shared/company-dashboard.js
 * ----------------------------------------------------------------------------
 * COMPANY DASHBOARD — the premium generic command view for any sister concern
 * (route key: wildcard star + slash + dashboard). Woodart, IT Solutions, Shop
 * and Construction land here; Travels and Group keep their bespoke dashboards
 * because the router always prefers a company-specific registration.
 *
 * Sections: company page head with a live "Record Sale" action (db.postSale —
 * the cross-company artery) → KPI hero (12M revenue count-up, profit, margin,
 * MoM, headcount, open leads — every tile drills) → revenue/profit area chart
 * + expense-driver doughnut from acc_entries → recent sales ledger + health
 * signal card (pill + risk meter + computed signals) → recent activity →
 * shortcut cards for every ENABLED module the current user may open.
 *
 * Data: db.finance, db.series, db.sales, db.leads, db.employees, db.activity,
 * db.riskScore and the acc_entries store. Zero hard-coded numbers.
 * ==========================================================================*/

(function (EPAL) {
  'use strict';
  var ui = EPAL.ui, el = ui.el;
  var db = function () { return EPAL.db; };

  var GREEN = '#23c17e', RED = '#f0506e';

  function kpiTile(label, icon, valueText, countTo, foot, trend, drill) {
    var valueEl = el('div.kpi-value');
    if (countTo != null) ui.countUp(valueEl, countTo, function (v) { return ui.money(v, { compact: true }); });
    else valueEl.textContent = valueText;
    return el('div.kpi-card' + (drill ? '.drill' : ''),
      drill ? { onclick: function () { EPAL.router.navigate(drill); }, title: 'Open ' + label } : null, [
      el('div.kpi-top', null, [ el('span.kpi-label', { text: label }),
        el('span.kpi-ico', { html: '<i class="bi bi-' + icon + '"></i>' }) ]),
      valueEl,
      el('div.kpi-foot', null, [
        trend ? el('span.kpi-trend.' + trend.dir, {
          html: ui.icon(trend.dir === 'up' ? 'arrow-up-right' : trend.dir === 'down' ? 'arrow-down-right' : 'dash') +
            (trend.val ? ' ' + trend.val : '') }) : null,
        foot ? el('span.text-muted', { text: foot }) : null
      ])
    ]);
  }

  EPAL.view('*/dashboard', { render: function (ctx) {
    var cid = ctx.companyId, co = ctx.company;
    var f = db().finance(cid, 12);
    var s = db().series(cid);
    var mom = db().momRevenue(cid);
    var risk = db().riskScore(cid);
    var health = risk < 30 ? ['g', 'Healthy'] : risk < 55 ? ['y', 'Watch'] : ['r', 'At Risk'];
    var team = db().employees({ companyId: cid });
    var openLeads = db().leads(cid).filter(function (l) { return ['Won', 'Lost'].indexOf(l.stage) < 0; });
    var pipelineValue = openLeads.reduce(function (a, l) { return a + (l.value || 0); }, 0);
    var hasCrm = co.modules.some(function (m) { return m.id === 'crm'; }) && EPAL.modules.isEnabled(cid, 'crm');
    var page = el('div.page');

    /* ---- page head with live actions --------------------------------------*/
    page.appendChild(EPAL.pageHead({
      eyebrow: co.tagline || 'Sister Concern', icon: co.icon, title: co.name,
      sub: 'Live operational command — revenue, pipeline, team and every enabled module.',
      actions: [
        el('button.btn.btn-ghost', { html: ui.icon('graph-up') + ' Analytics',
          onclick: function () { EPAL.router.navigate(cid + '/analytics'); } }),
        el('button.btn.btn-primary', { html: ui.icon('cash-coin') + ' Record Sale',
          onclick: function () { recordSale(); } })
      ]
    }));

    /* ---- KPI hero ----------------------------------------------------------*/
    page.appendChild(el('div.kpi-grid.stagger', null, [
      kpiTile('Revenue (12M)', 'graph-up-arrow', null, f.revenue, 'trailing 12 months',
        { dir: mom >= 0 ? 'up' : 'down' }, cid + '/accounts'),
      kpiTile('Net Profit', 'cash-stack', ui.money(f.profit, { compact: true }), null,
        ui.pct(f.margin) + ' net margin', { dir: f.profit >= 0 ? 'up' : 'down' }, cid + '/ledgers'),
      kpiTile('Margin', 'pie-chart-fill', ui.pct(f.margin), null, 'revenue kept as profit',
        { dir: f.margin >= 20 ? 'up' : 'down' }, cid + '/analytics'),
      kpiTile('MoM Growth', mom >= 0 ? 'graph-up-arrow' : 'graph-down-arrow',
        (mom >= 0 ? '+' : '') + mom.toFixed(1) + '%', null, 'last month vs previous',
        { dir: mom >= 0 ? 'up' : 'down' }, cid + '/analytics'),
      kpiTile('Headcount', 'people-fill', ui.num(team.length), null, 'active team members',
        null, cid + '/hrm'),
      kpiTile('Open Leads', 'funnel-fill', ui.num(openLeads.length), null,
        ui.money(pipelineValue, { compact: true }) + ' pipeline', null,
        hasCrm ? cid + '/crm/leads' : 'group/crm/leads')
    ]));

    /* ---- trend + expense drivers -------------------------------------------*/
    var trendId = ui.uid('cd-tr');
    var expBox = el('div', { style: { height: '280px', position: 'relative' } }, [ el('canvas', { id: ui.uid('cd-ex') }) ]);
    var expCanvasId = expBox.firstChild.id;
    var row = el('div.two-col');
    row.appendChild(el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon('activity') + ' Revenue & Profit' }),
        el('span.card-sub', { text: 'monthly · trailing 12 months' }) ]),
      el('div.card-body', null, [
        el('div', { style: { height: '280px', position: 'relative' } }, [ el('canvas', { id: trendId }) ])
      ])
    ]));
    row.appendChild(el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon('pie-chart') + ' Expense Drivers' }),
        el('span.card-sub', { text: 'journal categories' }) ]),
      el('div.card-body', null, [ expBox ])
    ]));
    page.appendChild(row);

    /* ---- recent sales + health signal ---------------------------------------*/
    var sales = db().sales(cid).slice().sort(function (a, b) {
      return String(b.date || b.created || '').localeCompare(String(a.date || a.created || ''));
    });
    var salesCard = el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon('receipt') + ' Recent Sales' }),
        el('a.link-btn', { href: '#/' + cid + '/reports', text: 'Sales register' }) ]),
      el('div.card-body', null, [
        sales.length ? el('div.data-list', null, sales.slice(0, 7).map(function (x) {
          return el('div.data-row', { style: { cursor: 'pointer' }, title: 'Open party ledger',
            onclick: function () { EPAL.router.navigate(cid + '/ledgers', { tab: 'party' }); } }, [
            el('span.avatar', { style: { background: ui.colorFor(x.customer || x.ref || x.id),
              width: '28px', height: '28px', fontSize: '10px', flex: 'none' },
              text: ui.initials(x.customer || 'WI') }),
            el('div.flex-1', { style: { minWidth: '0' } }, [
              el('div.fw-600.sm', { text: (x.ref ? x.ref + ' · ' : '') + (x.desc || 'Sale') }),
              el('div.text-mute.xs', { text: (x.customer || 'Walk-in') + ' · ' + ui.ago(x.date || x.created) })
            ]),
            el('div', { style: { textAlign: 'right' } }, [
              el('div.num.strong.sm', { text: ui.money(x.amount) }),
              el('div.text-mute.xs', { text: ui.money(x.profit, { compact: true }) + ' profit' })
            ])
          ]);
        })) : el('div.empty-state', null, [
          ui.frag(ui.icon('receipt')),
          el('h3', { text: 'No sales recorded yet' }),
          el('p.text-muted', { text: 'Use "Record Sale" above — it feeds accounts, ledgers and the group command center.' })
        ])
      ])
    ]);

    var snap = db().groupSnapshot();
    var healthCard = el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon('heart-pulse') + ' Health Signal' }),
        el('span.health.' + health[0], { text: health[1] }) ]),
      el('div.card-body', null, [
        el('div.flex.items-center.gap-2', null, [
          el('span.text-mute.xs', { text: 'Composite risk', style: { flex: 'none' } }),
          el('div.meter.flex-1', null, [ el('span', {
            class: risk < 30 ? 'lvl-low' : risk < 55 ? 'lvl-mid' : 'lvl-high',
            style: { width: risk + '%' } }) ]),
          el('span.text-mute.xs.num', { text: risk + '/100' })
        ]),
        el('div.data-list.mt-2', null, [
          signalRow(mom >= 0 ? 'rocket-takeoff' : 'droplet-half', mom >= 0 ? 'success' : 'error',
            mom >= 0 ? 'Revenue is climbing' : 'Revenue is slipping',
            (mom >= 0 ? '+' : '') + mom.toFixed(1) + '% month-over-month', cid + '/analytics'),
          signalRow(f.margin >= snap.margin ? 'gem' : 'exclamation-triangle',
            f.margin >= snap.margin ? 'info' : 'warning',
            f.margin >= snap.margin ? 'Margin beats the group blend' : 'Margin trails the group blend',
            ui.pct(f.margin) + ' vs ' + ui.pct(snap.margin) + ' group blended', cid + '/analytics'),
          signalRow('funnel', 'info', openLeads.length + ' open leads in play',
            ui.money(pipelineValue, { compact: true }) + ' potential pipeline',
            hasCrm ? cid + '/crm/pipeline' : 'group/crm/pipeline')
        ]),
        el('button.btn.btn-ghost.mt-2', { html: ui.icon('graph-up') + ' Deep Analytics',
          onclick: function () { EPAL.router.navigate(cid + '/analytics'); } })
      ])
    ]);

    var row2 = el('div.two-col');
    row2.appendChild(salesCard);
    row2.appendChild(healthCard);
    page.appendChild(row2);

    /* ---- recent activity -----------------------------------------------------*/
    var acts = db().activity().filter(function (a) { return a.companyId === cid; }).slice(0, 6);
    var tl = el('div.timeline');
    acts.forEach(function (a) {
      tl.appendChild(el('div.tl-item', null, [
        el('div.tl-time', { text: ui.ago(a.at) + ' · ' + a.actor }),
        el('div.tl-text', { text: a.text })
      ]));
    });
    if (!acts.length) tl.appendChild(el('div.text-muted', { text: 'No recent activity for ' + co.short + ' yet.' }));
    page.appendChild(el('div.section-label', { text: 'Recent Activity' }));
    page.appendChild(el('div.card', null, [ el('div.card-pad', null, [ tl ]) ]));

    /* ---- module shortcuts (only enabled + permitted) --------------------------*/
    var mods = co.modules.filter(function (m) {
      return m.id !== 'dashboard' && EPAL.modules.isEnabled(cid, m.id) && EPAL.auth.can(cid, m.id);
    });
    if (mods.length) {
      page.appendChild(el('div.section-label', { text: co.short + ' — Modules' }));
      var mgrid = el('div.scaffold-grid.stagger');
      mods.forEach(function (m) {
        mgrid.appendChild(el('a.scaffold-card', { href: '#/' + cid + '/' + m.id }, [
          el('div.scaffold-ico', { html: '<i class="bi bi-' + m.icon + '"></i>' }),
          el('div', null, [ el('h4', { text: m.label }),
            el('p', { text: m.desc || ('Open ' + m.label.toLowerCase()) }) ])
        ]));
      });
      page.appendChild(mgrid);
    }

    ctx.mount.appendChild(page);

    /* ---- charts after mount ----------------------------------------------------*/
    requestAnimationFrame(function () {
      var c1 = document.getElementById(trendId);
      if (c1) EPAL.charts.area(c1, { labels: s.labels, legend: true, datasets: [
        { label: 'Revenue', data: s.revenue, color: co.accent },
        { label: 'Profit', data: s.profit, color: GREEN }
      ] });
      var exp = db().col('acc_entries').filter(function (e) { return e.companyId === cid && e.kind === 'Expense'; });
      var byCat = {};
      exp.forEach(function (e) { byCat[e.category] = (byCat[e.category] || 0) + (e.amount || 0); });
      var cats = Object.keys(byCat).sort(function (a, b) { return byCat[b] - byCat[a]; }).slice(0, 7);
      var c2 = document.getElementById(expCanvasId);
      if (c2 && cats.length) {
        EPAL.charts.doughnut(c2, { labels: cats,
          data: cats.map(function (k) { return byCat[k]; }), legend: 'bottom' });
      } else if (!cats.length) {
        expBox.innerHTML = '';
        expBox.style.height = 'auto';
        expBox.appendChild(el('div.empty-state', null, [
          ui.frag(ui.icon('pie-chart')),
          el('h3', { text: 'No expense journal yet' }),
          el('p.text-muted', { text: 'Post expenses in Accounts to see the drivers here.' })
        ]));
      }
    });

    function signalRow(icon, tone, title, text, drill) {
      return el('div.data-row', { style: { cursor: 'pointer' },
        onclick: function () { EPAL.router.navigate(drill); } }, [
        ui.frag('<span class="notif-ico notif-' + tone + '">' + ui.icon(icon) + '</span>'),
        el('div.flex-1', null, [ el('div.fw-600.sm', { text: title }),
          el('div.text-mute.xs', { text: text }) ]),
        ui.frag('<i class="bi bi-chevron-right text-mute"></i>')
      ]);
    }

    /* Record a completed sale — THE cross-company chain (db.postSale). --------*/
    function recordSale() {
      EPAL.formModal({
        title: 'Record Sale — ' + co.short, icon: 'cash-coin',
        fields: [
          { key: 'amount', label: 'Sale Amount (৳)', type: 'money', required: true, min: 1 },
          { key: 'cost', label: 'Cost (৳)', type: 'money', min: 0, default: 0 },
          { key: 'customer', label: 'Customer', type: 'text', required: true, placeholder: 'e.g. Meghna Group' },
          { key: 'ref', label: 'Reference', type: 'text', placeholder: co.short.slice(0, 2).toUpperCase() + '-INV-1024' },
          { key: 'desc', label: 'Description', type: 'text', col2: true, placeholder: 'What was sold or billed' }
        ],
        onSave: function (vals) {
          db().postSale(cid, { amount: vals.amount, cost: vals.cost, ref: vals.ref,
            desc: vals.desc, customer: vals.customer });
          ui.toast('Sale posted — accounts, ledgers and the Command Center are updated', 'success');
          EPAL.router.render();
        }
      });
    }
  } });

})(window.EPAL = window.EPAL || {});
