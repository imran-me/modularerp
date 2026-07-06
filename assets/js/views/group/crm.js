/* ============================================================================
 * EPAL GROUP ERP  ·  views/group/crm.js
 * ----------------------------------------------------------------------------
 * GROUP CRM — the unified customer & pipeline layer across ALL five concerns.
 *
 * One route ('group/crm') serves four sub-screens (branch on ctx.subId):
 *   pipeline   drag-and-drop Kanban of every lead in the group, each card
 *              wears the accent-coloured badge of its owning company; dropping
 *              a card into "Won" posts the sale to that company's ledger via
 *              db.postSale (the cross-company chain) and fires a notification.
 *   leads      full searchable / filterable / exportable table of all leads
 *              with create & edit modals (company, source, stage, value).
 *   customers  "Customers 360" — the shared customer graph: card grid showing
 *              tier, lifetime value and WHICH companies know each customer.
 *   activities every CRM touchpoint (calls, meetings, WhatsApp) + logging.
 *
 * Data: 'leads' via db.leads(), 'customers' via db.customers() and
 * db.saveCustomer (companyIds preserved), 'crm_activities' via db.col.
 * ==========================================================================*/

(function (EPAL) {
  'use strict';
  var ui = EPAL.ui, el = ui.el;
  var db = function () { return EPAL.db; };

  /* ---- constants ----------------------------------------------------------*/
  var STAGES = [
    { id: 'New', color: '#8b93a7' }, { id: 'Contacted', color: '#7b5cff' },
    { id: 'Qualified', color: '#2f6bff' }, { id: 'Proposal', color: '#f4b740' },
    { id: 'Negotiation', color: '#e2721b' }, { id: 'Won', color: '#23c17e' },
    { id: 'Lost', color: '#f0506e' }
  ];
  var OPEN_STAGES = ['New', 'Contacted', 'Qualified', 'Proposal', 'Negotiation'];
  var SOURCES = ['Website', 'Referral', 'WhatsApp', 'Facebook', 'Walk-in', 'Cold Call', 'Fair'];

  function sisterCompanies() {
    return EPAL.config.companies.filter(function (c) { return c.type === 'company'; });
  }
  function companyOptions() {
    return sisterCompanies().map(function (c) { return [c.id, c.name]; });
  }
  function coBadge(id) {
    var co = EPAL.config.company(id);
    if (!co) return '<span class="badge">—</span>';
    return '<span class="badge" style="color:' + co.accent + ';border-color:' + co.accent + '33">' +
      ui.escapeHtml(co.short) + '</span>';
  }
  function today() { return new Date().toISOString().slice(0, 10); }

  /* ---- Won-deal costing: a won deal is never pure profit. Estimate a cost of
   * 70% of the deal value so db.postSale records a realistic margin (≈30%)
   * instead of booking the whole amount as profit. -------------------------*/
  function estCost(value) { return Math.round((+value || 0) * 0.7); }

  /* ---- RFM segment styling (EPAL.intel.rfm segments) ---------------------*/
  var SEG_COLOR = {
    'Champions': '#23c17e', 'Loyal': '#2f6bff', 'Potential Loyalist': '#7b5cff',
    'New': '#8b93a7', 'Need Attention': '#f4b740', 'At Risk': '#e2721b',
    'Cant Lose': '#f0506e', 'Hibernating': '#8b93a7', 'Lost': '#f0506e'
  };
  function segColor(seg) { return SEG_COLOR[seg] || '#8b93a7'; }
  function rfmSegBadge(x) {
    var c = segColor(x.segment);
    return el('span.badge.rfm-seg', {
      style: { color: c, borderColor: c + '55' },
      title: 'RFM ' + x.score + ' · R' + x.r + ' F' + x.f + ' M' + x.m,
      text: x.segment
    });
  }
  function fmOf(x) { return Math.round((x.f + x.m) / 2); }

  /* ---- tiny KPI tile ------------------------------------------------------*/
  function kpi(label, value, icon, drill, foot) {
    return el('div.kpi-card' + (drill ? '.drill' : ''),
      drill ? { onclick: function () { EPAL.router.navigate(drill); } } : null, [
      el('div.kpi-top', null, [
        el('span.kpi-label', { text: label }),
        el('span.kpi-ico', { html: '<i class="bi bi-' + icon + '"></i>' })
      ]),
      el('div.kpi-value', { text: String(value) }),
      foot ? el('div.kpi-foot', null, [ el('span.text-muted', { text: foot }) ]) : null
    ]);
  }
  function chartCard(title, icon, canvasId, subLabel, height) {
    return el('div.card', null, [
      el('div.card-head', null, [
        el('h3', { html: ui.icon(icon) + ' ' + title }),
        subLabel ? el('span.card-sub', { text: subLabel }) : null
      ]),
      el('div.card-body', null, [
        el('div', { style: { height: (height || 240) + 'px', position: 'relative' } }, [ el('canvas', { id: canvasId }) ])
      ])
    ]);
  }

  /* ==========================================================================
   * THE VIEW — group/crm  (subs: pipeline · leads · customers · activities)
   * ========================================================================*/
  EPAL.view('group/crm', { render: function (ctx) {
    var sub = ctx.subId || 'pipeline';
    var page = el('div.page');

    function allLeads() { return db().leads(); }
    function allCustomers() { return db().customers(); }
    function allActs() { return db().col('crm_activities'); }

    /* ---- group-wide KPIs -------------------------------------------------*/
    var leads = allLeads();
    var openLeads = leads.filter(function (l) { return OPEN_STAGES.indexOf(l.stage) >= 0; });
    var wonLeads = leads.filter(function (l) { return l.stage === 'Won'; });
    var lostLeads = leads.filter(function (l) { return l.stage === 'Lost'; });
    var pipelineValue = openLeads.reduce(function (a, l) { return a + (l.value || 0); }, 0);
    var winRate = (wonLeads.length + lostLeads.length)
      ? Math.round(wonLeads.length / (wonLeads.length + lostLeads.length) * 100) : 0;
    var ym = new Date().toISOString().slice(0, 7);
    var actsThisMonth = allActs().filter(function (a) { return String(a.date || '').indexOf(ym) === 0; }).length;

    /* ---- page head (action changes per sub — every button does work) -----*/
    var headActions;
    if (sub === 'customers') {
      headActions = [ el('button.btn.btn-primary', { html: ui.icon('person-plus') + ' New Customer',
        onclick: function () { editCustomer(null); } }) ];
    } else if (sub === 'activities') {
      headActions = [ el('button.btn.btn-primary', { html: ui.icon('chat-left-text') + ' Log Activity',
        onclick: function () { logActivity(); } }) ];
    } else {
      headActions = [ el('button.btn.btn-primary', { html: ui.icon('person-plus') + ' New Lead',
        onclick: function () { editLead(null); } }) ];
    }
    page.appendChild(EPAL.pageHead({
      eyebrow: 'Epal Group', icon: 'people-fill', title: 'Group CRM',
      sub: 'One customer graph, one pipeline — every lead and client across all five concerns.',
      actions: headActions
    }));

    /* ---- sub navigation pills --------------------------------------------*/
    var pills = el('div.pill-tab.mb-3');
    [['pipeline', 'Pipeline'], ['leads', 'Leads'], ['customers', 'Customers 360'], ['activities', 'Activities']]
      .forEach(function (p) {
        pills.appendChild(el('button' + (sub === p[0] ? '.active' : ''), { text: p[1],
          onclick: function () { EPAL.router.navigate('group/crm/' + p[0]); } }));
      });
    page.appendChild(el('div', null, [pills]));

    /* ---- KPI row (drill-through where sensible) ---------------------------*/
    page.appendChild(el('div.kpi-grid', null, [
      kpi('Open Leads', openLeads.length, 'funnel', 'group/crm/leads', 'across ' + sisterCompanies().length + ' concerns'),
      kpi('Pipeline Value', ui.money(pipelineValue, { compact: true }), 'cash-coin', 'group/crm/pipeline', 'open stages only'),
      kpi('Win Rate', winRate + '%', 'bullseye', null, wonLeads.length + ' won · ' + lostLeads.length + ' lost'),
      kpi('Customers', allCustomers().length, 'person-hearts', 'group/crm/customers', 'shared group graph'),
      kpi('Activities This Month', actsThisMonth, 'chat-left-dots', 'group/crm/activities', ym)
    ]));

    var body = el('div');
    page.appendChild(body);
    ctx.mount.appendChild(page);

    /* ========================================================================
     * SUB: PIPELINE — group-wide Kanban with drag-and-drop across stages
     * ======================================================================*/
    function drawPipeline() {
      body.innerHTML = '';
      var kb = el('div.kanban');
      STAGES.forEach(function (st) {
        var colLeads = allLeads().filter(function (l) { return l.stage === st.id; });
        var lst = el('div.kb-list');
        colLeads.forEach(function (l) {
          var co = EPAL.config.company(l.companyId);
          var card = el('div.kb-card', { draggable: 'true', onclick: function () { editLead(l); } }, [
            el('div.kb-card-title', { text: l.name }),
            el('div.flex.items-center.gap-1.xs', null, [
              ui.frag(coBadge(l.companyId)),
              el('span.text-mute.xs', { text: (l.source || '—') + ' · ' + ui.date(l.created) })
            ]),
            el('div.kb-card-foot', null, [
              el('span.num.strong', { text: ui.money(l.value, { compact: true }) }),
              el('span.xs', { style: { color: co ? co.accent : 'inherit' }, text: co ? co.short : '—' })
            ])
          ]);
          card.addEventListener('dragstart', function (e) {
            e.dataTransfer.setData('text/plain', l.id); card.classList.add('dragging');
          });
          card.addEventListener('dragend', function () { card.classList.remove('dragging'); });
          lst.appendChild(card);
        });
        lst.addEventListener('dragover', function (e) { e.preventDefault(); lst.parentNode.classList.add('drag-over'); });
        lst.addEventListener('dragleave', function () { lst.parentNode.classList.remove('drag-over'); });
        lst.addEventListener('drop', function (e) {
          e.preventDefault(); lst.parentNode.classList.remove('drag-over');
          var id = e.dataTransfer.getData('text/plain');
          var l = allLeads().filter(function (x) { return x.id === id; })[0];
          if (l && l.stage !== st.id) {
            var wasWon = l.stage === 'Won';
            l.stage = st.id;
            db().save('leads', l);
            if (st.id === 'Won' && !wasWon) {
              var co = EPAL.config.company(l.companyId);
              db().notify({ level: 'success', title: 'Deal won 🎉',
                text: l.name + ' · ' + ui.money(l.value) + (co ? ' · ' + co.short : ''),
                companyId: l.companyId, icon: 'trophy-fill' });
              db().postSale(l.companyId, { amount: l.value || 0, cost: estCost(l.value), ref: l.id,
                desc: 'CRM deal: ' + l.name, customer: l.name });
              ui.toast('Deal won — sale posted to ' + (co ? co.short : l.companyId) +
                ' (cost est. ' + ui.money(estCost(l.value), { compact: true }) + ')', 'success');
            }
            EPAL.router.render();
          }
        });
        kb.appendChild(el('div.kb-col', { style: { '--kb': st.color } }, [
          el('div.kb-col-head', null, [
            el('span.kb-col-dot'), el('span.kb-col-title', { text: st.id }),
            el('span.kb-count', { text: String(colLeads.length) })
          ]), lst
        ]));
      });
      body.appendChild(kb);
      appendLeadsChart(body);
    }

    /* ========================================================================
     * SUB: LEADS — the full group leads register
     * ======================================================================*/
    function drawLeads() {
      body.innerHTML = '';
      var t = EPAL.table({
        columns: [
          { key: 'id', label: 'Ref' },
          { key: 'name', label: 'Lead', render: function (l) {
            return '<span class="strong">' + ui.escapeHtml(l.name) + '</span>'; } },
          { key: 'companyId', label: 'Company', render: function (l) { return coBadge(l.companyId); },
            sortVal: function (l) { var co = EPAL.config.company(l.companyId); return co ? co.short : l.companyId; },
            exportVal: function (l) { var co = EPAL.config.company(l.companyId); return co ? co.short : l.companyId; } },
          { key: 'source', label: 'Source' },
          { key: 'stage', label: 'Stage', badge: { Won: 'good', Lost: 'bad', Negotiation: 'warn', Proposal: 'warn', Qualified: 'info', Contacted: 'info' } },
          { key: 'value', label: 'Value', num: true, money: true },
          { key: 'created', label: 'Created', date: true }
        ],
        rows: allLeads,
        filters: [{ key: 'stage', label: 'Stage' }, { key: 'source', label: 'Source' }, { key: 'companyId', label: 'Company' }],
        searchKeys: ['id', 'name', 'source', 'companyId', 'stage'],
        exportName: 'group-leads.csv',
        onRow: function (l) { editLead(l); },
        actions: [{ icon: 'trash', title: 'Delete', onClick: function (l) {
          ui.confirm({ title: 'Delete lead ' + l.name + '?', danger: true, confirmLabel: 'Delete' })
            .then(function (ok) { if (ok) { db().remove('leads', l.id); ui.toast('Lead deleted', 'success'); EPAL.router.render(); } });
        } }],
        empty: { icon: 'funnel', title: 'No leads yet', hint: 'Create your first group lead.' }
      });
      body.appendChild(el('div.card', null, [ el('div.card-pad', null, [ t.el ]) ]));
      appendLeadsChart(body);
    }

    /* ========================================================================
     * SUB: CUSTOMERS 360 — the shared cross-company customer graph
     * ======================================================================*/
    function drawCustomers() {
      body.innerHTML = '';
      var state = { q: '', tier: '', cell: null };

      /* ---- intelligence read-model (keyed by sales.customer NAME) ---------*/
      var rfmList = [];
      try { rfmList = EPAL.intel.rfm() || []; } catch (e) { rfmList = []; }
      var rfmByName = {};
      rfmList.forEach(function (x) { rfmByName[x.name] = x; });
      function ltvOf(name) { try { return EPAL.intel.ltv(name) || 0; } catch (e) { return 0; } }

      var grid = el('div.grid-auto.stagger');
      var countLbl = el('span.dt-count');

      /* ---- filter bar -----------------------------------------------------*/
      var searchIn = el('input.input', { placeholder: 'Search customers…', style: { maxWidth: '240px' },
        oninput: ui.debounce(function () { state.q = searchIn.value.toLowerCase(); paint(); }, 120) });
      var tierSel = el('select.select', { onchange: function () { state.tier = tierSel.value; paint(); } });
      [['', 'All Tiers'], ['Platinum', 'Platinum'], ['Gold', 'Gold'], ['Silver', 'Silver'], ['Standard', 'Standard']]
        .forEach(function (o) { tierSel.appendChild(el('option', { value: o[0], text: o[1] })); });

      body.appendChild(el('div.flex.items-center.gap-2.mb-3', null, [
        searchIn, tierSel, el('div.spacer'), countLbl
      ]));

      /* ---- RFM heatmap + intelligence lists -------------------------------*/
      body.appendChild(buildIntel());

      body.appendChild(grid);

      /* ---- RFM 5x5 heatmap card (.rfm-grid) — click a cell to filter ------*/
      function buildIntel() {
        var cellCount = {}, maxc = 0;
        rfmList.forEach(function (x) {
          var k = x.r + '-' + fmOf(x);
          cellCount[k] = (cellCount[k] || 0) + 1;
          if (cellCount[k] > maxc) maxc = cellCount[k];
        });

        var gridEl = el('div.rfm-grid', { style: {
          display: 'grid', gridTemplateColumns: 'auto repeat(5, 1fr)', gap: '4px', alignItems: 'stretch'
        } });
        // corner + FM column headers
        gridEl.appendChild(el('div.rfm-axis.xs.text-mute', { style: { display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }, text: 'R \\ FM' }));
        [1, 2, 3, 4, 5].forEach(function (fm) {
          gridEl.appendChild(el('div.rfm-axis.xs.text-mute', { style: { textAlign: 'center' }, text: 'FM' + fm }));
        });
        [5, 4, 3, 2, 1].forEach(function (r) {
          gridEl.appendChild(el('div.rfm-axis.xs.text-mute', { style: { display: 'flex', alignItems: 'center' }, text: 'R' + r }));
          [1, 2, 3, 4, 5].forEach(function (fm) {
            var k = r + '-' + fm, count = cellCount[k] || 0;
            var alpha = maxc ? (0.10 + 0.62 * count / maxc) : 0;
            var active = state.cell && state.cell.r === r && state.cell.fm === fm;
            var cell = el('div.rfm-cell', {
              title: count + ' customer' + (count === 1 ? '' : 's') + ' · R' + r + ' / FM' + fm,
              style: {
                minHeight: '38px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: '7px', cursor: count ? 'pointer' : 'default', fontWeight: '700',
                fontVariantNumeric: 'tabular-nums',
                background: count ? 'rgba(200,162,74,' + alpha.toFixed(3) + ')' : 'rgba(139,147,167,0.08)',
                border: active ? '2px solid #1A43BF' : '1px solid rgba(139,147,167,0.18)',
                color: count ? '' : 'var(--text-muted, #8b93a7)'
              },
              onclick: function () {
                if (!count) return;
                if (state.cell && state.cell.r === r && state.cell.fm === fm) state.cell = null;
                else state.cell = { r: r, fm: fm };
                drawCustomers();   // rebuild so the heatmap highlight redraws too
              }
            }, [ el('span', { text: count ? String(count) : '·' }) ]);
            gridEl.appendChild(cell);
          });
        });

        var heat = el('div.card', null, [
          el('div.card-head', null, [
            el('h3', { html: ui.icon('grid-3x3-gap') + ' RFM Segmentation' }),
            el('span.card-sub', { text: 'Recency × (Frequency+Monetary) · click a cell to filter' })
          ]),
          el('div.card-body', null, [
            gridEl,
            state.cell
              ? el('div.mt-2', null, [ el('button.btn.btn-ghost.btn-sm', {
                  html: ui.icon('x-circle') + ' Clear R' + state.cell.r + '/FM' + state.cell.fm + ' filter',
                  onclick: function () { state.cell = null; drawCustomers(); } }) ])
              : el('div.text-mute.xs.mt-2', { text: rfmList.length + ' customers scored from the group sales ledger.' })
          ])
        ]);

        /* ---- best / sleeping / at-risk lists -------------------------------*/
        function miniList(title, icon, rows, render, empty) {
          var lst = el('div.data-list');
          if (!rows.length) lst.appendChild(el('div.text-mute.xs', { text: empty }));
          else rows.forEach(function (r) { lst.appendChild(render(r)); });
          return el('div.card', null, [
            el('div.card-head', null, [ el('h3', { html: ui.icon(icon) + ' ' + title }) ]),
            el('div.card-body', null, [ lst ])
          ]);
        }
        function nameRow(name, rightHtml, sub) {
          return el('div.data-row', { style: { cursor: 'pointer' }, onclick: function () { openByName(name); } }, [
            el('div', null, [
              el('div.strong', { text: name }),
              sub ? el('div.text-mute.xs', { text: sub }) : null
            ]),
            el('div', { style: { textAlign: 'right' }, html: rightHtml })
          ]);
        }
        var best = [], sleeping = [], risk = [];
        try { best = EPAL.intel.topCustomers(5) || []; } catch (e) {}
        try { sleeping = (EPAL.intel.sleepingCustomers() || []).slice(0, 5); } catch (e) {}
        try { risk = (EPAL.intel.atRisk() || []).slice(0, 5); } catch (e) {}

        var lists = el('div', { style: {
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px'
        } }, [
          miniList('Best Customers', 'trophy', best, function (r) {
            return nameRow(r.name,
              '<span class="num strong">' + ui.escapeHtml(ui.money(r.ltv || r.monetary || 0, { compact: true })) + '</span>',
              r.segment + ' · ' + r.frequency + ' orders');
          }, 'No sales history yet.'),
          miniList('Sleeping Customers', 'moon-stars', sleeping, function (r) {
            return nameRow(r.name,
              '<span class="text-mute xs">' + r.recencyDays + 'd ago</span>',
              ui.money(r.monetary || 0, { compact: true }) + ' lifetime');
          }, 'Everyone is active.'),
          miniList('At-Risk Customers', 'exclamation-triangle', risk, function (r) {
            var c = segColor(r.segment);
            return nameRow(r.name,
              '<span class="badge" style="color:' + c + ';border-color:' + c + '55">' + ui.escapeHtml(r.segment) + '</span>',
              r.recencyDays + ' days since last order');
          }, 'No customers flagged at-risk.')
        ]);

        return el('div.mb-3', null, [ heat, el('div.mt-3', null, [ lists ]) ]);
      }

      function openByName(name) {
        var c = allCustomers().filter(function (x) { return x.name === name; })[0];
        if (c) customerDetail(c);
        else ui.toast(name + ' is a ledger customer — not yet in the shared customer graph.', 'info');
      }

      function paint() {
        grid.innerHTML = '';
        var rows = allCustomers().filter(function (c) {
          if (state.tier && c.tier !== state.tier) return false;
          if (state.cell) {
            var x = rfmByName[c.name];
            if (!x || x.r !== state.cell.r || fmOf(x) !== state.cell.fm) return false;
          }
          if (state.q) {
            var hay = (c.name + ' ' + (c.contact || '') + ' ' + (c.phone || '') + ' ' + (c.email || '')).toLowerCase();
            if (hay.indexOf(state.q) < 0) return false;
          }
          return true;
        });
        countLbl.textContent = rows.length + ' customer' + (rows.length === 1 ? '' : 's') +
          (state.cell ? ' · R' + state.cell.r + '/FM' + state.cell.fm : '');
        if (!rows.length) {
          grid.appendChild(el('div.card', null, [ el('div.card-pad.text-mute', { text: 'No customers match this filter.' }) ]));
          return;
        }
        rows.forEach(function (c) {
          var tierCls = c.tier === 'Platinum' ? 'badge-accent' : c.tier === 'Gold' ? 'badge-warn' : c.tier === 'Silver' ? 'badge-info' : '';
          var known = (c.companyIds || []).map(function (id) { return coBadge(id); }).join(' ');
          var rf = rfmByName[c.name];
          var intelLtv = rf ? ltvOf(c.name) : 0;
          grid.appendChild(el('div.card.hover', { style: { cursor: 'pointer' }, onclick: function () { customerDetail(c); } }, [
            el('div.card-pad', null, [
              el('div.flex.items-center.gap-2', null, [
                el('span.avatar', { style: { background: ui.colorFor(c.name), width: '34px', height: '34px', fontSize: '12px' },
                  text: ui.initials(c.name) }),
                el('div.flex-1', null, [
                  el('div.strong', { text: c.name }),
                  el('div.text-mute.xs', { text: (c.contact || '—') + ' · since ' + (c.since || '—') })
                ]),
                el('span.badge.' + (tierCls || 'badge'), { text: c.tier || 'Standard' })
              ]),
              el('div.flex.items-center.gap-1.mt-1', null, [
                rf ? rfmSegBadge(rf) : el('span.badge.badge-muted', { text: 'Unrated', title: 'No matching sales in the ledger' })
              ]),
              el('div.stat-row.mt-2', null, [
                el('div.stat', null, [
                  el('div.text-mute.xs', { text: 'Lifetime Value' }),
                  el('div.num.strong', { text: ui.money(c.value || 0, { compact: true }) })
                ]),
                el('div.stat', null, [
                  el('div.text-mute.xs', { text: 'Predicted LTV' }),
                  el('div.num.strong', { text: rf ? ui.money(intelLtv, { compact: true }) : '—' })
                ]),
                el('div.stat', null, [
                  el('div.text-mute.xs', { text: 'Known By' }),
                  el('div', { html: known || '<span class="text-mute">—</span>' })
                ])
              ])
            ])
          ]));
        });
      }
      paint();
    }

    function customerDetail(c) {
      var known = (c.companyIds || []).map(function (id) { return coBadge(id); }).join(' ');

      // intelligence for this customer (matched by name against the sales ledger)
      var rf = null;
      try {
        (EPAL.intel.rfm() || []).forEach(function (x) { if (x.name === c.name) rf = x; });
      } catch (e) { rf = null; }
      var predLtv = 0; try { predLtv = EPAL.intel.ltv(c.name) || 0; } catch (e) {}

      var detailRows = [
        detailRow('Contact Person', c.contact || '—'),
        detailRow('Phone', c.phone || '—'),
        detailRow('Email', c.email || '—'),
        detailRow('Tier', c.tier || 'Standard'),
        detailRow('Lifetime Value', ui.money(c.value || 0)),
        detailRow('Customer Since', c.since || '—'),
        detailRow('Status', c.status || 'active')
      ];
      if (rf) {
        detailRows.push(el('div.data-row', null, [
          el('span.text-mute', { text: 'RFM Segment' }),
          rfmSegBadge(rf)
        ]));
        detailRows.push(detailRow('RFM Score', rf.score + '  (R' + rf.r + ' F' + rf.f + ' M' + rf.m + ')'));
        detailRows.push(detailRow('Predicted LTV', ui.money(predLtv)));
      }

      // discussion thread (comments engine) — embedded per contract
      var cw = null;
      try { cw = EPAL.comments.widget('customer', c.id); } catch (e) { cw = null; }

      var m = ui.modal({
        title: c.name, icon: 'person-hearts', size: 'sm',
        body: el('div', null, [
          el('div.data-list', null, detailRows),
          el('div.mt-2', null, [
            el('div.section-label', { text: 'Known By (shared graph)' }),
            el('div', { html: known || '<span class="text-mute">Not linked to a concern yet</span>' })
          ]),
          cw ? el('div.mt-3', null, [
            el('div.section-label', { text: 'Discussion' }), cw
          ]) : null
        ]),
        actions: [
          { label: 'Close', variant: 'ghost', onClick: function () {} },
          { label: 'Edit', icon: 'pencil', variant: 'primary', onClick: function () { editCustomer(c); } }
        ]
      });
      return m;
    }
    function detailRow(label, value) {
      return el('div.data-row', null, [
        el('span.text-mute', { text: label }), el('span.strong', { text: String(value) })
      ]);
    }

    function editCustomer(c) {
      var isNew = !c;
      var fields = [
        { key: 'name', label: 'Name / Organisation', type: 'text', required: true, col2: true },
        { key: 'contact', label: 'Contact Person', type: 'text' },
        { key: 'phone', label: 'Phone', type: 'phone', required: true, placeholder: '+8801…' },
        { key: 'email', label: 'Email', type: 'email' },
        { key: 'tier', label: 'Tier', type: 'select', options: ['Standard', 'Silver', 'Gold', 'Platinum'], default: 'Standard' },
        { key: 'value', label: 'Lifetime Value (৳)', type: 'money', min: 0, default: 0 },
        { key: 'status', label: 'Status', type: 'select', options: ['active', 'inactive'], default: 'active' }
      ];
      if (isNew) {
        fields.push({ key: 'firstCompany', label: 'First Known By (concern)', type: 'select',
          options: companyOptions(), required: true });
      }
      EPAL.formModal({
        title: isNew ? 'New Customer' : 'Edit Customer', icon: 'person-hearts', record: c,
        fields: fields,
        onSave: function (vals) {
          var base = c || { id: 'CUS-' + Date.now().toString().slice(-5),
            companyIds: [], since: new Date().toISOString().slice(0, 7) };
          var rec = Object.assign({}, base, vals);           // companyIds preserved on edit
          if (isNew && vals.firstCompany) {
            if (rec.companyIds.indexOf(vals.firstCompany) < 0) rec.companyIds = rec.companyIds.concat([vals.firstCompany]);
            delete rec.firstCompany;
          }
          db().saveCustomer(rec);
          ui.toast('Customer saved — visible to every concern', 'success');
          EPAL.router.render();
        }
      });
    }

    /* ========================================================================
     * SUB: ACTIVITIES — every CRM touchpoint across the group
     * ======================================================================*/
    function drawActivities() {
      body.innerHTML = '';
      var t = EPAL.table({
        columns: [
          { key: 'date', label: 'Date', date: true },
          { key: 'type', label: 'Type', badge: { Call: 'info', Meeting: 'accent', WhatsApp: 'good', Email: 'info', 'Site Visit': 'warn', 'Follow-up': 'warn' } },
          { key: 'lead', label: 'Lead / Person' },
          { key: 'company', label: 'Organisation' },
          { key: 'note', label: 'Note' },
          { key: 'by', label: 'By' },
          { key: 'outcome', label: 'Outcome', badge: { Positive: 'good', 'Needs follow-up': 'warn', Neutral: 'info' } }
        ],
        rows: allActs,
        searchKeys: ['lead', 'company', 'note', 'by'],
        filters: [{ key: 'type', label: 'Type' }, { key: 'outcome', label: 'Outcome' }],
        exportName: 'group-crm-activities.csv',
        actions: [{ icon: 'trash', title: 'Delete', onClick: function (a) {
          ui.confirm({ title: 'Delete this activity?', danger: true, confirmLabel: 'Delete' })
            .then(function (ok) { if (ok) { db().remove('crm_activities', a.id); ui.toast('Activity deleted', 'success'); EPAL.router.render(); } });
        } }],
        empty: { icon: 'chat-left-dots', title: 'No activities logged', hint: 'Log your first call or meeting.' }
      });
      body.appendChild(el('div.card', null, [ el('div.card-pad', null, [ t.el ]) ]));
    }

    function logActivity() {
      EPAL.formModal({
        title: 'Log Activity', icon: 'chat-left-text',
        fields: [
          { key: 'type', label: 'Type', type: 'select', options: ['Call', 'Email', 'Meeting', 'WhatsApp', 'Site Visit', 'Follow-up'], required: true },
          { key: 'lead', label: 'Lead / Person', type: 'text', required: true },
          { key: 'company', label: 'Organisation', type: 'text' },
          { key: 'outcome', label: 'Outcome', type: 'select', options: ['Positive', 'Neutral', 'Needs follow-up'] },
          { key: 'note', label: 'Note', type: 'textarea', col2: true, required: true }
        ],
        onSave: function (vals) {
          var rec = Object.assign({ id: 'ACT-' + Date.now().toString().slice(-6),
            by: (EPAL.auth.current() || { name: 'Admin' }).name,
            date: today(), created: today() }, vals);
          db().save('crm_activities', rec);
          ui.toast('Activity logged', 'success');
          EPAL.router.render();
        }
      });
    }

    /* ========================================================================
     * LEAD CREATE / EDIT (used by pipeline cards, leads table and page head)
     * ======================================================================*/
    function editLead(l) {
      var isNew = !l;
      EPAL.formModal({
        title: isNew ? 'New Lead' : 'Edit Lead — ' + l.id, icon: 'person-plus', record: l,
        fields: [
          { key: 'name', label: 'Lead Name', type: 'text', required: true, col2: true, placeholder: 'e.g. Tanvir Ahmed / Meghna Group' },
          { key: 'companyId', label: 'Concern', type: 'select', options: companyOptions(), required: true },
          { key: 'source', label: 'Source', type: 'select', options: SOURCES, required: true },
          { key: 'stage', label: 'Stage', type: 'select', options: STAGES.map(function (s) { return s.id; }), default: 'New' },
          { key: 'value', label: 'Estimated Value (৳)', type: 'money', required: true, min: 1 },
          { key: 'cost', label: 'Estimated Cost (৳)', type: 'money', min: 0,
            hint: 'Optional — leave blank to auto-estimate 70% of value when the deal is Won.' }
        ],
        onSave: function (vals) {
          var prevStage = l ? l.stage : null;
          var rec = Object.assign({}, l || { id: 'LD-' + Date.now().toString().slice(-5),
            owner: (EPAL.auth.current() || {}).id, created: today() }, vals);
          db().save('leads', rec);
          if (vals.stage === 'Won' && prevStage !== 'Won') {
            var co = EPAL.config.company(rec.companyId);
            db().notify({ level: 'success', title: 'Deal won 🎉',
              text: rec.name + ' · ' + ui.money(rec.value) + (co ? ' · ' + co.short : ''),
              companyId: rec.companyId, icon: 'trophy-fill' });
            var wonCost = (rec.cost != null && rec.cost !== '') ? (+rec.cost || 0) : estCost(rec.value);
            db().postSale(rec.companyId, { amount: rec.value || 0, cost: wonCost, ref: rec.id,
              desc: 'CRM deal: ' + rec.name, customer: rec.name });
          }
          ui.toast('Lead saved', 'success');
          EPAL.router.render();
        }
      });
    }

    /* ========================================================================
     * ANALYTICS — leads by company, each bar wearing its company accent
     * ======================================================================*/
    function appendLeadsChart(host) {
      var cId = ui.uid('gcrm');
      host.appendChild(el('div.mt-3', null, [
        chartCard('Leads by Company', 'bar-chart', cId, 'all stages · coloured by concern accent', 230)
      ]));
      requestAnimationFrame(function () {
        var comps = sisterCompanies();
        var rows = allLeads();
        var counts = comps.map(function (c) {
          return rows.filter(function (l) { return l.companyId === c.id; }).length;
        });
        var canvas = document.getElementById(cId);
        if (canvas) EPAL.charts.bar(canvas, {
          labels: comps.map(function (c) { return c.short; }),
          datasets: [{ label: 'Leads', data: counts, colors: comps.map(function (c) { return c.accent; }) }],
          money: false
        });
      });
    }

    /* ---- branch ------------------------------------------------------------*/
    if (sub === 'leads') drawLeads();
    else if (sub === 'customers') drawCustomers();
    else if (sub === 'activities') drawActivities();
    else drawPipeline();
  } });

})(window.EPAL = window.EPAL || {});
