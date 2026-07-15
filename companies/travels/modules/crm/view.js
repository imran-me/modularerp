/* ============================================================================
 * EPAL GROUP ERP  ·  companies/travels/modules/crm/view.js
 * ----------------------------------------------------------------------------
 * TRAVELS — CRM. The demand desk: leads → pipeline → won business, plus the
 * activity/communication log. ONE registered view branches on ctx.subId
 * (pill-tabs). Because the router prefers a specific view over the shared
 * "star-slash-crm" wildcard, this Travels screen supersedes the generic one
 * WITHOUT touching any other company's CRM.
 *
 *   (overview)  → cockpit: open/won/win-rate/pipeline/weighted KPIs, an Action
 *                 Center (stale leads, hot negotiations, follow-ups due), a
 *                 stage funnel, source mix, and the recent activity feed.
 *   pipeline    → drag-drop Kanban across the seven stages; drop on Won posts a sale.
 *   leads       → rich lead register (chips by stage) + row-click lead detail.
 *   follow-ups  → the touchpoints that need a follow-up, with "mark done".
 *   comm-hub    → the full activity stream + log a call/email/meeting/WhatsApp.
 *
 * DATA:
 *   leads          { id, companyId, name, source, stage, value, owner(empId),
 *                    created, posted?, company?, contact?, phone?, email?, closeDate? }
 *   crm_activities shared feed { id, type, lead, company, by, note, outcome, date }
 *                  (no companyId in seed — Travels rows are tagged companyId on log)
 *   sales          won deals post through db.postSale (Travels + Group move live).
 *
 * A won lead posts a sale exactly once (guarded by lead.posted). Never write a
 * literal star-slash inside this comment block.
 * ==> LARAVEL: Lead + Activity models; a PipelineController; won→SaleService.
 * ==========================================================================*/

(function (EPAL) {
  'use strict';
  var ui = EPAL.ui, el = ui.el, db = EPAL.db, S = EPAL.store;

  var CID = 'travels';
  var TODAY = new Date(2026, 6, 5);
  var TODAY_STR = '2026-07-05';
  var STAGES = [
    { id: 'New', color: '#8b93a7', prob: 0.10 }, { id: 'Contacted', color: '#7b5cff', prob: 0.20 },
    { id: 'Qualified', color: '#2f6bff', prob: 0.40 }, { id: 'Proposal', color: '#f4b740', prob: 0.60 },
    { id: 'Negotiation', color: '#e2721b', prob: 0.80 }, { id: 'Won', color: '#23c17e', prob: 1 }, { id: 'Lost', color: '#f0506e', prob: 0 }
  ];
  var STAGE_IDS = STAGES.map(function (s) { return s.id; });
  var OPEN_STAGES = ['New', 'Contacted', 'Qualified', 'Proposal', 'Negotiation'];
  var SOURCES = ['Website', 'Referral', 'WhatsApp', 'Facebook', 'Walk-in', 'Cold Call', 'Fair'];
  var ACT_TYPES = ['Call', 'Email', 'Meeting', 'WhatsApp', 'Site Visit', 'Follow-up'];

  function prob(stage) { var s = STAGES.filter(function (x) { return x.id === stage; })[0]; return s ? s.prob : 0; }
  function stageColor(stage) { var s = STAGES.filter(function (x) { return x.id === stage; })[0]; return s ? s.color : '#8b93a7'; }

  /* ==========================================================================
   * DATA ACCESSORS
   * ========================================================================*/
  function leads() { return db.leads(CID); }
  function openLeads() { return leads().filter(function (l) { return OPEN_STAGES.indexOf(l.stage) >= 0; }); }
  function wonLeads() { return leads().filter(function (l) { return l.stage === 'Won'; }); }
  function lostLeads() { return leads().filter(function (l) { return l.stage === 'Lost'; }); }
  function team() { return db.employees ? db.employees({ companyId: CID }) : []; }
  function ownerName(id) { var e = db.employee ? db.employee(id) : null; return e ? e.name : (id || '—'); }

  // Travels-scoped activity feed: rows we tagged travels, OR whose lead/company
  // matches a Travels lead or customer name (the seed feed has no companyId).
  function travelsNames() {
    var set = {};
    leads().forEach(function (l) { if (l.name) set[l.name.toLowerCase()] = 1; if (l.company) set[String(l.company).toLowerCase()] = 1; });
    (db.customers ? db.customers(CID) : []).forEach(function (c) { if (c.name) set[c.name.toLowerCase()] = 1; });
    return set;
  }
  function activities() {
    var names = travelsNames();
    var all = db.col('crm_activities');
    var scoped = all.filter(function (a) { return a.companyId === CID || names[String(a.lead || '').toLowerCase()] || names[String(a.company || '').toLowerCase()]; });
    return (scoped.length ? scoped : all).slice().sort(function (a, b) { return (a.date < b.date) ? 1 : -1; });
  }
  function activitiesFor(name) { var n = String(name || '').toLowerCase(); return db.col('crm_activities').filter(function (a) { return String(a.lead || '').toLowerCase() === n; }).sort(function (a, b) { return (a.date < b.date) ? 1 : -1; }); }
  function daysSince(str) { var d = new Date(str); if (isNaN(d)) return 0; return Math.floor((TODAY.getTime() - d.getTime()) / 86400000); }
  function lastTouch(l) { var a = activitiesFor(l.name)[0]; return a ? a.date : l.created; }

  /* ==========================================================================
   * VIEW ENTRY
   * ========================================================================*/
  EPAL.view('travels/crm', {
    render: function (ctx) {
      var sub = ctx.subId || 'overview';
      if (['overview', 'pipeline', 'leads', 'follow-ups', 'comm-hub'].indexOf(sub) < 0) sub = 'overview';
      var page = el('div.page');
      var titles = { overview: 'CRM', pipeline: 'Sales Pipeline', leads: 'Leads', 'follow-ups': 'Follow-ups', 'comm-hub': 'Communication Hub' };
      var subs = { overview: 'Leads, pipeline, follow-ups and communication for Epal Travels.',
        pipeline: 'Drag deals across the stages — a win posts the sale live.', leads: 'Every enquiry with its stage, value and owner.',
        'follow-ups': 'The touchpoints that still need a follow-up.', 'comm-hub': 'Calls, emails, meetings and WhatsApp — the full log.' };
      page.appendChild(EPAL.pageHead({
        eyebrow: sub === 'overview' ? 'Epal Travels' : 'Travels › CRM', icon: 'person-lines-fill', title: titles[sub], sub: subs[sub],
        actions: [
          canCreate() ? el('button.btn.btn-ghost', { html: ui.icon('person-plus') + ' New Lead', onclick: function () { leadForm(null); } }) : null,
          canCreate() && (sub === 'comm-hub' || sub === 'follow-ups') ? el('button.btn.btn-ghost', { html: ui.icon('chat-left-text') + ' Log Activity', onclick: function () { activityForm(null); } }) : null,
          el('a.btn.btn-primary', { href: '#/travels/crm/pipeline', html: ui.icon('kanban') + ' Pipeline' })
        ].filter(Boolean)
      }));
      // SECTION NAV — the house full-bleed underline band (owner grammar 2026-07-15)
      var pills = el('div.tab-underline.mb-3');
      [['overview', 'Overview'], ['pipeline', 'Pipeline'], ['leads', 'Leads'], ['follow-ups', 'Follow-ups'], ['comm-hub', 'Comm Hub']].forEach(function (p) {
        pills.appendChild(el('button' + (sub === p[0] ? '.active' : ''), { text: p[1],
          onclick: function () { EPAL.router.navigate('travels/crm' + (p[0] === 'overview' ? '' : '/' + p[0])); } }));
      });
      page.appendChild(pills);
      ({ overview: overview, pipeline: pipelineView, leads: leadsView, 'follow-ups': followUpsView, 'comm-hub': commHubView }[sub])(page, ctx);
      ctx.mount.appendChild(page);
    }
  });

  /* ======================================================= OVERVIEW (cockpit) */
  function overview(page) {
    var open = openLeads(), won = wonLeads(), lost = lostLeads();
    var pipeline = open.reduce(function (a, l) { return a + (+l.value || 0); }, 0);
    var weighted = open.reduce(function (a, l) { return a + (+l.value || 0) * prob(l.stage); }, 0);
    var winRate = (won.length + lost.length) ? Math.round(won.length / (won.length + lost.length) * 100) : 0;
    var pendingFollow = activities().filter(function (a) { return a.outcome === 'Needs follow-up'; });

    page.appendChild(el('div.kpi-grid.kpi-compact.stagger', null, [
      kpiDrill('Open Leads', String(open.length), 'funnel', 'travels/crm/leads'),
      kpi('Pipeline Value', ui.money(pipeline, { compact: true }), 'cash-coin'),
      kpi('Weighted Forecast', ui.money(weighted, { compact: true }), 'graph-up-arrow', 'text-good'),
      kpi('Won', String(won.length), 'trophy', 'text-good'),
      kpi('Win Rate', winRate + '%', 'bullseye'),
      kpiDrill('Follow-ups Due', String(pendingFollow.length), 'bell', 'travels/crm/follow-ups', pendingFollow.length ? 'needs attention' : 'all clear')
    ]));

    // Action Center
    var acts = [];
    var stale = open.filter(function (l) { return daysSince(lastTouch(l)) > 14; }).sort(function (a, b) { return daysSince(lastTouch(b)) - daysSince(lastTouch(a)); });
    stale.slice(0, 3).forEach(function (l) { acts.push({ tone: 'warning', icon: 'hourglass-split', text: '<strong>' + esc(l.name) + '</strong> untouched ' + daysSince(lastTouch(l)) + 'd · ' + l.stage + ' · ' + ui.money(l.value), go: l }); });
    open.filter(function (l) { return l.stage === 'Negotiation'; }).sort(function (a, b) { return (b.value || 0) - (a.value || 0); }).slice(0, 3).forEach(function (l) {
      acts.push({ tone: 'info', icon: 'fire', text: 'Hot: <strong>' + esc(l.name) + '</strong> in Negotiation · ' + ui.money(l.value) + ' — close it', go: l });
    });
    pendingFollow.slice(0, 2).forEach(function (a) { acts.push({ tone: 'error', icon: 'bell-fill', text: 'Follow-up owed: <strong>' + esc(a.lead) + '</strong> — ' + esc(a.note || ''), go: null }); });

    page.appendChild(el('div.section-label', { text: 'Action Center — needs attention' }));
    if (acts.length) {
      page.appendChild(el('div.card', null, [ el('div.card-body', null, acts.map(function (a) {
        return el('div.data-row', { style: { cursor: a.go ? 'pointer' : 'default' }, onclick: a.go ? (function (l) { return function () { leadDetail(l); }; })(a.go) : function () { EPAL.router.navigate('travels/crm/follow-ups'); } }, [
          ui.frag('<span class="notif-ico notif-' + a.tone + '">' + ui.icon(a.icon) + '</span>'),
          el('div.flex-1', { html: a.text }), ui.frag('<span class="text-mute">' + ui.icon('chevron-right') + '</span>')
        ]);
      })) ]));
    } else {
      page.appendChild(el('div.build-banner.mb-3', null, [ ui.frag(ui.icon('check-circle-fill')), el('div', { html: '<strong>Pipeline is healthy.</strong> No stale leads or owed follow-ups right now.' }) ]));
    }

    // funnel + source mix
    page.appendChild(el('div.section-label', { text: 'Pipeline Shape' }));
    var funId = ui.uid('fun'), srcId = ui.uid('src');
    page.appendChild(el('div.grid-auto', null, [ chartCard('Stage Funnel', 'funnel', funId, 'open leads by stage', 250), chartCard('Lead Sources', 'diagram-2', srcId, 'where leads come from', 250) ]));
    requestAnimationFrame(function () {
      var c1 = document.getElementById(funId);
      if (c1) EPAL.charts.bar(c1, { labels: OPEN_STAGES, horizontal: true, money: false,
        datasets: [{ label: 'Leads', data: OPEN_STAGES.map(function (s) { return open.filter(function (l) { return l.stage === s; }).length; }), colors: OPEN_STAGES.map(stageColor) }] });
      var bySrc = {}; leads().forEach(function (l) { bySrc[l.source || '—'] = (bySrc[l.source || '—'] || 0) + 1; });
      var c2 = document.getElementById(srcId);
      if (c2) EPAL.charts.doughnut(c2, { labels: Object.keys(bySrc), data: Object.values(bySrc) });
    });

    // recent activity feed
    page.appendChild(el('div.section-label', { text: 'Recent Activity' }));
    page.appendChild(el('div.card', null, [ el('div.card-body', null, [ activityTable(activities().slice(0, 30)) ]) ]));
  }

  /* ======================================================= PIPELINE (kanban) */
  function pipelineView(page) {
    var body = el('div');
    page.appendChild(body);
    draw();
    function draw() {
      body.innerHTML = '';
      var all = leads();
      var open = openLeads();
      body.appendChild(el('div.kpi-grid.kpi-compact.stagger.mb-3', null, [
        kpi('Open', String(open.length), 'funnel'),
        kpi('Pipeline', ui.money(open.reduce(function (a, l) { return a + (+l.value || 0); }, 0), { compact: true }), 'cash-coin'),
        kpi('Weighted', ui.money(open.reduce(function (a, l) { return a + (+l.value || 0) * prob(l.stage); }, 0), { compact: true }), 'graph-up-arrow'),
        kpi('Won', String(wonLeads().length), 'trophy', 'text-good')
      ]));
      var kb = el('div.kanban');
      STAGES.forEach(function (st) {
        var colLeads = all.filter(function (l) { return l.stage === st.id; });
        var colVal = colLeads.reduce(function (a, l) { return a + (+l.value || 0); }, 0);
        var lst = el('div.kb-list');
        colLeads.forEach(function (l) {
          var age = daysSince(lastTouch(l));
          var card = el('div.kb-card', { draggable: 'true', onclick: function () { leadDetail(l); } }, [
            el('div.kb-card-title', { text: l.name }),
            el('div.text-mute.xs', { text: (l.source || '') + ' · ' + (age ? age + 'd idle' : 'today') }),
            el('div.kb-card-foot', null, [
              el('span.num.strong', { text: ui.money(l.value, { compact: true }) }),
              el('span.badge', { text: String(ownerName(l.owner)).split(' ')[0] })
            ])
          ]);
          if (age > 14 && OPEN_STAGES.indexOf(l.stage) >= 0) card.appendChild(el('div.text-warn.xs.mt-1', { html: ui.icon('exclamation-triangle') + ' stale' }));
          card.addEventListener('dragstart', function (e) { e.dataTransfer.setData('text/plain', l.id); card.classList.add('dragging'); });
          card.addEventListener('dragend', function () { card.classList.remove('dragging'); });
          lst.appendChild(card);
        });
        lst.addEventListener('dragover', function (e) { e.preventDefault(); lst.parentNode.classList.add('drag-over'); });
        lst.addEventListener('dragleave', function () { lst.parentNode.classList.remove('drag-over'); });
        lst.addEventListener('drop', function (e) {
          e.preventDefault(); lst.parentNode.classList.remove('drag-over');
          var id = e.dataTransfer.getData('text/plain');
          var l = leads().filter(function (x) { return x.id === id; })[0];
          if (l && l.stage !== st.id) { moveStage(l, st.id); draw(); }
        });
        kb.appendChild(el('div.kb-col', { style: { '--kb': st.color } }, [
          el('div.kb-col-head', null, [ el('span.kb-col-dot'), el('span.kb-col-title', { text: st.id }), el('span.kb-count', { text: String(colLeads.length) }) ]),
          colVal ? el('div.text-mute.xs.px-2', { text: ui.money(colVal, { compact: true }) }) : null, lst ]));
      });
      body.appendChild(kb);
    }
  }
  function moveStage(l, stage) {
    l.stage = stage;
    if (stage === 'Won' && !l.posted) {
      l.posted = true;
      if (db.postSale) db.postSale(CID, { amount: l.value || 0, cost: 0, ref: l.id, desc: 'CRM deal: ' + l.name, customer: l.company || l.name });
      if (db.notify) db.notify({ level: 'success', title: 'Deal won 🎉', text: l.name + ' · ' + ui.money(l.value), companyId: CID, icon: 'trophy-fill' });
    }
    db.save('leads', l);
    ui.toast('Moved to ' + stage, 'success');
  }

  /* ======================================================= LEADS (register) */
  function leadsView(page) {
    var list = leads();
    var open = openLeads();
    page.appendChild(el('div.kpi-grid.kpi-compact.stagger', null, [
      kpi('Total Leads', String(list.length), 'card-list'),
      kpi('Open', String(open.length), 'funnel'),
      kpi('Pipeline', ui.money(open.reduce(function (a, l) { return a + (+l.value || 0); }, 0), { compact: true }), 'cash-coin'),
      kpi('Won', String(wonLeads().length), 'trophy', 'text-good'),
      kpi('Avg Deal', ui.money(list.length ? Math.round(list.reduce(function (a, l) { return a + (+l.value || 0); }, 0) / list.length) : 0, { compact: true }), 'graph-up')
    ]));
    var t = EPAL.table({
      columns: [
        { key: 'name', label: 'Lead', render: function (l) { return '<div class="flex items-center gap-1"><span class="avatar" style="width:24px;height:24px;font-size:9px;background:' + ui.colorFor(l.name) + '">' + ui.initials(l.name) + '</span><div><div class="strong">' + esc(l.name) + '</div>' + (l.company ? '<div class="text-mute xs">' + esc(l.company) + '</div>' : '') + '</div></div>'; } },
        { key: 'source', label: 'Source', badge: {} },
        { key: 'stage', label: 'Stage', render: function (l) { return '<span class="badge" style="background:' + stageColor(l.stage) + '22;color:' + stageColor(l.stage) + '">' + l.stage + '</span>'; }, sortVal: function (l) { return STAGE_IDS.indexOf(l.stage); } },
        { key: 'value', label: 'Value', num: true, money: true },
        { key: 'weighted', label: 'Weighted', num: true, sortVal: function (l) { return (l.value || 0) * prob(l.stage); }, render: function (l) { return '<span class="num text-mute">' + ui.money(Math.round((l.value || 0) * prob(l.stage))) + '</span>'; } },
        { key: 'owner', label: 'Owner', render: function (l) { return esc(String(ownerName(l.owner)).split(' ')[0]); } },
        { key: 'age', label: 'Idle', num: true, sortVal: function (l) { return daysSince(lastTouch(l)); }, render: function (l) { var d = daysSince(lastTouch(l)); return '<span class="' + (d > 14 && OPEN_STAGES.indexOf(l.stage) >= 0 ? 'text-warn' : 'text-mute') + '">' + d + 'd</span>'; } }
      ],
      rows: list, searchKeys: ['name', 'company', 'source', 'stage'], quickFilter: 'stage', filterPanel: true,
      filters: [{ key: 'source', label: 'Source' }], dateKey: 'created', pageSize: 12,
      exportName: 'travels-leads.csv', pdfTitle: 'Travels CRM Leads',
      onRow: function (l) { leadDetail(l); },
      actions: ui.actions({
        edit: canCreate() ? function (l) { leadForm(l); } : null,
        del:  canDelete() ? function (l) { ui.confirm({ title: 'Delete lead?', danger: true, confirmLabel: 'Delete' }).then(function (ok) { if (ok) { db.remove('leads', l.id); ui.toast('Deleted', 'success'); EPAL.router.render(); } }); } : null,
        wa:   function (l) { return { phone: l.phone, text: leadMsg(l) }; },
        gmail: function (l) { return { to: l.email, subject: 'Epal Travels & Consultancy', body: leadMsg(l) }; }
      }),
      empty: { icon: 'funnel', title: 'No leads yet', hint: 'Add your first enquiry.' }
    });
    page.appendChild(el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon('funnel-fill') + ' Leads' }), el('span.card-sub', { text: list.length + ' leads · click for detail' }) ]),
      el('div.card-body', null, [ t.el ])
    ]));
  }

  /* ---- rich lead detail --------------------------------------------------*/
  function leadDetail(l) {
    var body = el('div');
    var m = ui.modal({ title: l.name, icon: 'person-lines-fill', size: 'lg', body: body, footer: false });
    renderLead(body, l, m);
  }
  function renderLead(host, l, m) {
    host.innerHTML = '';
    var acts = activitiesFor(l.name);
    var weighted = Math.round((l.value || 0) * prob(l.stage));
    var isOpen = OPEN_STAGES.indexOf(l.stage) >= 0;

    var actions = el('div.flex.gap-1.items-center.flex-wrap', { style: { marginLeft: 'auto' } });
    if (canCreate() && isOpen) actions.appendChild(el('button.btn.btn-sm.btn-primary', { html: ui.icon('trophy') + ' Mark Won', onclick: function () { moveStage(l, 'Won'); renderLead(host, l, m); } }));
    if (canCreate()) actions.appendChild(el('button.btn.btn-sm.btn-outline', { html: ui.icon('chat-left-text') + ' Log', onclick: function () { activityForm(l, function () { renderLead(host, l, m); }); } }));
    if (canCreate()) actions.appendChild(el('button.btn.btn-sm.btn-ghost', { html: ui.icon('pencil') + ' Edit', onclick: function () { m.close(); leadForm(l); } }));
    actions.appendChild(ui.rowActions(ui.actions({
      wa: { phone: l.phone, text: leadMsg(l) }, gmail: { to: l.email, subject: 'Epal Travels & Consultancy', body: leadMsg(l) }
    })));

    host.appendChild(el('div.card', null, [ el('div.card-body', null, [
      el('div.flex.items-center.gap-2.flex-wrap.mb-3', null, [
        ui.frag('<span class="avatar" style="width:44px;height:44px;font-size:15px;background:' + ui.colorFor(l.name) + '">' + ui.initials(l.name) + '</span>'),
        el('div.flex-1', { style: { minWidth: '190px' } }, [ el('div.fw-700', { style: { fontSize: '17px' }, text: l.name }),
          el('div.flex.items-center.gap-2.flex-wrap', null, [
            l.company ? el('div.text-mute.sm', { text: l.company }) : null,
            el('span.badge', { style: { background: stageColor(l.stage) + '22', color: stageColor(l.stage) }, text: l.stage }),
            l.source ? el('span.badge', { text: l.source }) : null,
            el('span.text-mute.xs', { text: 'Owner: ' + ownerName(l.owner) })
          ]) ]),
        actions
      ]),
      el('div.stat-row', null, [ st2('Value', ui.money(l.value || 0)), st2('Weighted', ui.money(weighted)), st2('Age', daysSince(l.created) + 'd'), st2('Idle', daysSince(lastTouch(l)) + 'd') ]),
      stageStepper(l.stage)
    ]) ]));

    // contact facts
    if (l.contact || l.phone || l.email || l.closeDate) {
      host.appendChild(el('div.card', null, [ el('div.card-head', null, [ el('h3', { html: ui.icon('person-vcard') + ' Contact' }) ]),
        el('div.card-body', null, [ el('div.data-list', null, [ drow('Contact person', l.contact), drow('Phone', l.phone), drow('Email', l.email), drow('Expected close', l.closeDate ? ui.date(l.closeDate) : '—') ]) ]) ]));
    }

    // activity timeline for this lead
    host.appendChild(el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon('chat-left-dots') + ' Activity Timeline' }), el('span.card-sub', { text: acts.length + ' touchpoints' }) ]),
      el('div.card-body', null, [ acts.length ? activityTable(acts) : el('div.empty-state', null, [ ui.frag(ui.icon('chat-left')), el('h3', { text: 'No activity yet' }), el('p.text-muted', { text: 'Log a call, email or meeting for this lead.' }) ]) ])
    ]));
    if (EPAL.comments && EPAL.comments.widget) { host.appendChild(el('div.section-label', { text: 'Notes & Discussion' })); host.appendChild(EPAL.comments.widget('lead', l.id)); }
  }
  function stageStepper(stage) {
    if (['Won', 'Lost'].indexOf(stage) >= 0) {
      return el('div.mt-3', null, [ el('span.badge.badge-' + (stage === 'Won' ? 'good' : 'bad'), { html: ui.icon(stage === 'Won' ? 'trophy' : 'x-circle') + ' ' + stage }) ]);
    }
    var idx = OPEN_STAGES.indexOf(stage);
    return el('div.flex.gap-1.mt-3.flex-wrap', null, OPEN_STAGES.map(function (s, i) {
      return el('span.badge' + (i <= idx ? '' : ''), { style: { background: i <= idx ? stageColor(s) + '22' : 'var(--surface-3,#2a3350)', color: i <= idx ? stageColor(s) : 'var(--text-mute,#8b93a7)' }, text: s });
    }));
  }
  function leadMsg(l) { return 'Dear ' + (l.contact || l.name) + ',\n\nThank you for your interest in Epal Travels & Consultancy. We would love to help with your ' + (l.source === 'Fair' ? 'travel plans' : 'enquiry') + '. May we schedule a quick call?\n\nWarm regards,\nEpal Travels & Consultancy'; }

  /* ---- lead add / edit ---------------------------------------------------*/
  function leadForm(l) {
    var isNew = !l;
    EPAL.formModal({
      title: isNew ? 'New Lead' : 'Edit Lead', icon: 'person-plus', size: 'lg', record: l || { stage: 'New', source: 'Website' },
      fields: [
        { type: 'section', label: 'Lead' },
        { key: 'name', label: 'Lead / person name', type: 'text', required: true, col2: true, placeholder: 'e.g. Sadia Khan' },
        { key: 'company', label: 'Organisation', type: 'text', placeholder: 'e.g. Bashundhara Group' },
        { key: 'contact', label: 'Contact person', type: 'text' },
        { key: 'phone', label: 'Phone', type: 'phone' },
        { key: 'email', label: 'Email', type: 'email' },
        { type: 'section', label: 'Deal' },
        { key: 'source', label: 'Source', type: 'select', options: SOURCES, default: 'Website', required: true },
        { key: 'stage', label: 'Stage', type: 'select', options: STAGE_IDS, default: 'New' },
        { key: 'value', label: 'Estimated value (৳)', type: 'money', required: true, min: 0 },
        { key: 'owner', label: 'Owner', type: 'select', options: team().map(function (e) { return [e.id, e.name]; }) },
        { key: 'closeDate', label: 'Expected close', type: 'date' }
      ],
      saveLabel: isNew ? 'Add Lead' : 'Save',
      onSave: function (val) {
        var wasWon = l && l.stage === 'Won';
        var r = l || { id: 'LD-' + ui.uid('').slice(-5).toUpperCase(), companyId: CID, created: TODAY_STR, owner: (EPAL.auth.current() || {}).id };
        r.name = (val.name || '').trim(); r.company = val.company; r.contact = val.contact; r.phone = val.phone; r.email = val.email;
        r.source = val.source; r.stage = val.stage; r.value = +val.value || 0; r.owner = val.owner || r.owner; r.closeDate = val.closeDate;
        r.companyId = CID;
        if (val.stage === 'Won' && !wasWon && !r.posted) {
          r.posted = true;
          if (db.postSale) db.postSale(CID, { amount: r.value, cost: 0, ref: r.id, desc: 'CRM deal: ' + r.name, customer: r.company || r.name });
        }
        db.save('leads', r);
        ui.toast('Lead saved', 'success'); EPAL.router.render();
        return true;
      }
    });
  }

  /* ======================================================= FOLLOW-UPS */
  function followUpsView(page) {
    var pending = activities().filter(function (a) { return a.outcome === 'Needs follow-up' || a.type === 'Follow-up'; });
    page.appendChild(el('div.kpi-grid.kpi-compact.stagger', null, [
      kpi('Open Follow-ups', String(pending.length), 'bell', pending.length ? 'text-warn' : 'text-good'),
      kpi('This Week', String(pending.filter(function (a) { return daysSince(a.date) <= 7; }).length), 'calendar-week'),
      kpi('Leads Needing Care', String(openLeads().filter(function (l) { return daysSince(lastTouch(l)) > 14; }).length), 'hourglass-split')
    ]));
    if (!pending.length) page.appendChild(el('div.build-banner.mb-3', null, [ ui.frag(ui.icon('check-circle-fill')), el('div', { html: '<strong>Nothing owed.</strong> No follow-ups pending — great job keeping the pipeline warm.' }) ]));
    page.appendChild(el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon('bell-fill') + ' Pending Follow-ups' }),
        canCreate() ? el('button.btn.btn-sm.btn-primary', { html: ui.icon('plus') + ' Log', onclick: function () { activityForm(null); } }) : null ]),
      el('div.card-body', null, [ activityTable(pending, true) ])
    ]));
  }

  /* ======================================================= COMM HUB */
  function commHubView(page) {
    var acts = activities();
    var byType = {}; acts.forEach(function (a) { byType[a.type || '—'] = (byType[a.type || '—'] || 0) + 1; });
    page.appendChild(el('div.kpi-grid.kpi-compact.stagger', null, [
      kpi('Total Activities', String(acts.length), 'chat-left-dots'),
      kpi('Calls', String(byType['Call'] || 0), 'telephone'),
      kpi('Meetings', String(byType['Meeting'] || 0), 'people'),
      kpi('WhatsApp', String(byType['WhatsApp'] || 0), 'whatsapp'),
      kpi('Emails', String(byType['Email'] || 0), 'envelope')
    ]));
    page.appendChild(el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon('chat-left-dots') + ' Communication Log' }),
        canCreate() ? el('button.btn.btn-sm.btn-primary', { html: ui.icon('plus') + ' Log Activity', onclick: function () { activityForm(null); } }) : null ]),
      el('div.card-body', null, [ activityTable(acts) ])
    ]));
  }

  // shared activity table
  function activityTable(rows, markDone) {
    return EPAL.table({
      columns: [
        { key: 'date', label: 'Date', date: true },
        { key: 'type', label: 'Type', badge: { Call: 'info', Meeting: 'accent', WhatsApp: 'good', Email: 'info', 'Follow-up': 'warn' } },
        { key: 'lead', label: 'Lead', render: function (a) { return '<span class="strong">' + esc(a.lead || '—') + '</span>'; } },
        { key: 'company', label: 'Organisation', render: function (a) { return esc(a.company || '—'); } },
        { key: 'note', label: 'Note', render: function (a) { return esc(a.note || '—'); } },
        { key: 'by', label: 'By' },
        { key: 'outcome', label: 'Outcome', badge: { Positive: 'good', 'Needs follow-up': 'warn', Neutral: '' } }
      ],
      rows: rows, searchKeys: ['lead', 'company', 'note', 'by', 'type'], quickFilter: 'type', filterPanel: true,
      filters: [{ key: 'outcome', label: 'Outcome' }], dateKey: 'date', pageSize: 10, exportName: 'travels-activities.csv', pdfTitle: 'Travels CRM Activities',
      actions: markDone ? ui.actions({ edit: canCreate() ? function (a) { a.outcome = 'Positive'; db.save('crm_activities', a); ui.toast('Marked done', 'success'); EPAL.router.render(); } : null }) : null,
      empty: { icon: 'chat-left-dots', title: 'No activities', hint: 'Log a call, email or meeting.' }
    }).el;
  }

  /* ---- log activity ------------------------------------------------------*/
  function activityForm(lead, done) {
    EPAL.formModal({
      title: 'Log Activity', icon: 'chat-left-text', size: 'md',
      record: lead ? { lead: lead.name, company: lead.company } : {},
      fields: [
        { key: 'type', label: 'Type', type: 'select', options: ACT_TYPES, required: true, default: 'Call' },
        { key: 'lead', label: 'Lead / person', type: 'text', required: true },
        { key: 'company', label: 'Organisation', type: 'text' },
        { key: 'outcome', label: 'Outcome', type: 'select', options: ['Positive', 'Neutral', 'Needs follow-up'], default: 'Positive' },
        { key: 'note', label: 'Note', type: 'textarea', col2: true, required: true }
      ],
      saveLabel: 'Log',
      onSave: function (val) {
        var rec = { id: 'ACT-' + ui.uid('').slice(-6).toUpperCase(), companyId: CID, by: (EPAL.auth.current() || { name: 'Staff' }).name,
          date: TODAY_STR, created: TODAY_STR, type: val.type, lead: val.lead, company: val.company, outcome: val.outcome, note: val.note };
        db.save('crm_activities', rec);
        ui.toast('Activity logged', 'success');
        if (done) done(); else EPAL.router.render();
        return true;
      }
    });
  }

  /* ---------------------------------------------------- helpers */
  function canCreate() { return !EPAL.perm || EPAL.perm.can('travels', 'crm', 'create'); }
  function canDelete() { return !EPAL.perm || EPAL.perm.can('travels', 'crm', 'delete'); }
  function esc(s) { return ui.escapeHtml(String(s == null ? '' : s)); }
  function kpi(label, value, icon, tone) {
    return el('div.kpi-card', null, [ el('div.kpi-top', null, [ el('span.kpi-label', { text: label }), el('span.kpi-ico', { html: '<i class="bi bi-' + icon + '"></i>' }) ]),
      el('div.kpi-value' + (tone ? '.' + tone : ''), { text: String(value) }) ]);
  }
  function kpiDrill(label, value, icon, route, foot) {
    return el('div.kpi-card.drill', { onclick: function () { EPAL.router.navigate(route); } }, [
      el('div.kpi-top', null, [ el('span.kpi-label', { text: label }), el('span.kpi-ico', { html: '<i class="bi bi-' + icon + '"></i>' }) ]),
      el('div.kpi-value', { text: String(value) }), foot ? el('div.kpi-foot', null, [ el('span.text-muted', { text: foot }) ]) : null ]);
  }
  function st2(l, v) { return el('div.stat', null, [ el('div.stat-label', { text: l }), el('div.stat-value', { text: v }) ]); }
  function drow(k, v) { return el('div.data-row', null, [ el('div.text-mute.sm.flex-1', { text: k }), el('div.strong', { text: v == null || v === '' ? '—' : String(v) }) ]); }
  function chartCard(title, icon, canvasId, subLabel, height) {
    return el('div.card', null, [ el('div.card-head', null, [ el('h3', { html: ui.icon(icon) + ' ' + title }), subLabel ? el('span.card-sub', { text: subLabel }) : null ]),
      el('div.card-body', null, [ el('div', { style: { height: (height || 260) + 'px', position: 'relative' } }, [ el('canvas', { id: canvasId }) ]) ]) ]);
  }

})(window.EPAL = window.EPAL || {});
