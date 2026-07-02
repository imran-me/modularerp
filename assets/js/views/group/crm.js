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
              db().postSale(l.companyId, { amount: l.value || 0, cost: 0, ref: l.id,
                desc: 'CRM deal: ' + l.name, customer: l.name });
              ui.toast('Deal won — sale posted to ' + (co ? co.short : l.companyId), 'success');
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
      var state = { q: '', tier: '' };

      var grid = el('div.grid-auto.stagger');
      var countLbl = el('span.dt-count');

      var searchIn = el('input.input', { placeholder: 'Search customers…', style: { maxWidth: '240px' },
        oninput: ui.debounce(function () { state.q = searchIn.value.toLowerCase(); paint(); }, 120) });
      var tierSel = el('select.select', { onchange: function () { state.tier = tierSel.value; paint(); } });
      [['', 'All Tiers'], ['Platinum', 'Platinum'], ['Gold', 'Gold'], ['Silver', 'Silver'], ['Standard', 'Standard']]
        .forEach(function (o) { tierSel.appendChild(el('option', { value: o[0], text: o[1] })); });

      body.appendChild(el('div.flex.items-center.gap-2.mb-3', null, [
        searchIn, tierSel, el('div.spacer'), countLbl
      ]));
      body.appendChild(grid);

      function paint() {
        grid.innerHTML = '';
        var rows = allCustomers().filter(function (c) {
          if (state.tier && c.tier !== state.tier) return false;
          if (state.q) {
            var hay = (c.name + ' ' + (c.contact || '') + ' ' + (c.phone || '') + ' ' + (c.email || '')).toLowerCase();
            if (hay.indexOf(state.q) < 0) return false;
          }
          return true;
        });
        countLbl.textContent = rows.length + ' customer' + (rows.length === 1 ? '' : 's');
        if (!rows.length) {
          grid.appendChild(el('div.card', null, [ el('div.card-pad.text-mute', { text: 'No customers match this filter.' }) ]));
          return;
        }
        rows.forEach(function (c) {
          var tierCls = c.tier === 'Platinum' ? 'badge-accent' : c.tier === 'Gold' ? 'badge-warn' : c.tier === 'Silver' ? 'badge-info' : '';
          var known = (c.companyIds || []).map(function (id) { return coBadge(id); }).join(' ');
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
              el('div.stat-row.mt-2', null, [
                el('div.stat', null, [
                  el('div.text-mute.xs', { text: 'Lifetime Value' }),
                  el('div.num.strong', { text: ui.money(c.value || 0, { compact: true }) })
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
      var m = ui.modal({
        title: c.name, icon: 'person-hearts', size: 'sm',
        body: el('div', null, [
          el('div.data-list', null, [
            detailRow('Contact Person', c.contact || '—'),
            detailRow('Phone', c.phone || '—'),
            detailRow('Email', c.email || '—'),
            detailRow('Tier', c.tier || 'Standard'),
            detailRow('Lifetime Value', ui.money(c.value || 0)),
            detailRow('Customer Since', c.since || '—'),
            detailRow('Status', c.status || 'active')
          ]),
          el('div.mt-2', null, [
            el('div.section-label', { text: 'Known By (shared graph)' }),
            el('div', { html: known || '<span class="text-mute">Not linked to a concern yet</span>' })
          ])
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
          { key: 'value', label: 'Estimated Value (৳)', type: 'money', required: true, min: 1 }
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
            db().postSale(rec.companyId, { amount: rec.value || 0, cost: 0, ref: rec.id,
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
