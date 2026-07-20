/* ============================================================================
 * TRAVELS · CRM · LOGIC
 * ----------------------------------------------------------------------------
 * Behaviour only — markup lives in frontend/template.html and is handed to this
 * file (by tools/build/build-module.mjs) as the string TEMPLATE_HTML. This file
 * is NOT an IIFE and has no 'use strict' of its own: the build wraps it.
 *
 * The demand desk: leads → pipeline → won business + the activity log
 * (overview / pipeline / leads / follow-ups / comm-hub). A won lead posts a sale
 * once (guarded by lead.posted). The rich lead-detail modal, the stage stepper
 * and the lead/activity forms keep their legacy el()-built DOM. Never write a
 * literal star-slash in this comment block.
 * ==> LARAVEL: Lead + Activity models; a PipelineController; won→SaleService.
 * ========================================================================== */

var EPAL = window.EPAL, ui = EPAL.ui, el = ui.el, db = EPAL.db, S = EPAL.store;

/* ---- template plumbing: clone a fragment, address its fill-slots ---------- */
var TPL = document.createElement('div');
TPL.innerHTML = TEMPLATE_HTML;
function frag(name) {
  var t = TPL.querySelector('template[data-tpl="' + name + '"]');
  return t.content.firstElementChild.cloneNode(true);
}
function slot(root, name) { return root.querySelector('[data-slot="' + name + '"]'); }

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

/* one KPI card + a drill KPI card + a chart card + a build-banner ---------- */
function kpi(label, value, icon, tone) {
  var n = frag('kpi'); slot(n, 'label').textContent = label; slot(n, 'ico').innerHTML = '<i class="bi bi-' + icon + '"></i>';
  var v = slot(n, 'value'); if (tone) v.classList.add(tone); v.textContent = String(value); return n;
}
function kpiDrill(label, value, icon, route, foot) {
  var n = frag('kpi-drill'); n.addEventListener('click', function () { EPAL.router.navigate(route); });
  slot(n, 'label').textContent = label; slot(n, 'ico').innerHTML = '<i class="bi bi-' + icon + '"></i>'; slot(n, 'value').textContent = String(value);
  var f = slot(n, 'foot'); if (foot) f.appendChild(el('span.text-muted', { text: foot })); else f.remove(); return n;
}
function chartCard(title, icon, canvasId, subLabel, height) {
  var c = frag('chart-card'); slot(c, 'title').innerHTML = ui.icon(icon) + ' ' + title;
  var sub = slot(c, 'sub'); if (subLabel) sub.textContent = subLabel; else sub.remove();
  slot(c, 'box').style.height = (height || 260) + 'px'; slot(c, 'canvas').id = canvasId; return c;
}
function buildBanner(icon, html) { var b = frag('build-banner'); slot(b, 'ico').classList.add('bi-' + icon); slot(b, 'msg').innerHTML = html; return b; }

/* ==========================================================================
 * VIEW ENTRY
 * ========================================================================*/
var SECTIONS = [['overview', 'Overview'], ['pipeline', 'Pipeline'], ['leads', 'Leads'], ['follow-ups', 'Follow-ups'], ['comm-hub', 'Comm Hub']];
function sectionNav(sub) {
  var nav = frag('nav');
  SECTIONS.forEach(function (s) {
    var btn = frag('nav-btn'); if (sub === s[0]) btn.classList.add('active'); btn.textContent = s[1];
    btn.addEventListener('click', function () { EPAL.router.navigate('travels/crm' + (s[0] === 'overview' ? '' : '/' + s[0])); });
    nav.appendChild(btn);
  });
  return nav;
}

EPAL.view('travels/crm', {
  render: function (ctx) {
    var sub = ctx.subId || 'overview';
    if (['overview', 'pipeline', 'leads', 'follow-ups', 'comm-hub'].indexOf(sub) < 0) sub = 'overview';
    var page = frag('page');
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
    page.appendChild(sectionNav(sub));
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

  var grid = frag('kpi-grid');
  grid.appendChild(kpiDrill('Open Leads', String(open.length), 'funnel', 'travels/crm/leads'));
  grid.appendChild(kpi('Pipeline Value', ui.money(pipeline, { compact: true }), 'cash-coin'));
  grid.appendChild(kpi('Weighted Forecast', ui.money(weighted, { compact: true }), 'graph-up-arrow', 'text-good'));
  grid.appendChild(kpi('Won', String(won.length), 'trophy', 'text-good'));
  grid.appendChild(kpi('Win Rate', winRate + '%', 'bullseye'));
  grid.appendChild(kpiDrill('Follow-ups Due', String(pendingFollow.length), 'bell', 'travels/crm/follow-ups', pendingFollow.length ? 'needs attention' : 'all clear'));
  page.appendChild(grid);

  // Action Center
  var acts = [];
  var stale = open.filter(function (l) { return daysSince(lastTouch(l)) > 14; }).sort(function (a, b) { return daysSince(lastTouch(b)) - daysSince(lastTouch(a)); });
  stale.slice(0, 3).forEach(function (l) { acts.push({ tone: 'warning', icon: 'hourglass-split', text: '<strong>' + esc(l.name) + '</strong> untouched ' + daysSince(lastTouch(l)) + 'd · ' + l.stage + ' · ' + ui.money(l.value), go: l }); });
  open.filter(function (l) { return l.stage === 'Negotiation'; }).sort(function (a, b) { return (b.value || 0) - (a.value || 0); }).slice(0, 3).forEach(function (l) {
    acts.push({ tone: 'info', icon: 'fire', text: 'Hot: <strong>' + esc(l.name) + '</strong> in Negotiation · ' + ui.money(l.value) + ' — close it', go: l });
  });
  pendingFollow.slice(0, 2).forEach(function (a) { acts.push({ tone: 'error', icon: 'bell-fill', text: 'Follow-up owed: <strong>' + esc(a.lead) + '</strong> — ' + esc(a.note || ''), go: null }); });

  var lbl1 = frag('section-label'); lbl1.textContent = 'Action Center — needs attention'; page.appendChild(lbl1);
  if (acts.length) {
    var acard = frag('card-body-card'); var abody = slot(acard, 'body');
    acts.forEach(function (a) {
      var row = frag('action-row');
      var ico = slot(row, 'ico'); ico.classList.add('notif-' + a.tone); ico.innerHTML = ui.icon(a.icon);
      slot(row, 'text').innerHTML = a.text;
      if (a.go) row.classList.add('tw-cursor-pointer');
      row.addEventListener('click', a.go ? (function (l) { return function () { leadDetail(l); }; })(a.go) : function () { EPAL.router.navigate('travels/crm/follow-ups'); });
      abody.appendChild(row);
    });
    page.appendChild(acard);
  } else {
    page.appendChild(buildBanner('check-circle-fill', '<strong>Pipeline is healthy.</strong> No stale leads or owed follow-ups right now.'));
  }

  // funnel + source mix
  var lbl2 = frag('section-label'); lbl2.textContent = 'Pipeline Shape'; page.appendChild(lbl2);
  var funId = ui.uid('fun'), srcId = ui.uid('src');
  var row2 = frag('grid-auto');
  row2.appendChild(chartCard('Stage Funnel', 'funnel', funId, 'open leads by stage', 250));
  row2.appendChild(chartCard('Lead Sources', 'diagram-2', srcId, 'where leads come from', 250));
  page.appendChild(row2);
  requestAnimationFrame(function () {
    var c1 = document.getElementById(funId);
    if (c1) EPAL.charts.bar(c1, { labels: OPEN_STAGES, horizontal: true, money: false,
      datasets: [{ label: 'Leads', data: OPEN_STAGES.map(function (s) { return open.filter(function (l) { return l.stage === s; }).length; }), colors: OPEN_STAGES.map(stageColor) }] });
    var bySrc = {}; leads().forEach(function (l) { bySrc[l.source || '—'] = (bySrc[l.source || '—'] || 0) + 1; });
    var c2 = document.getElementById(srcId);
    if (c2) EPAL.charts.doughnut(c2, { labels: Object.keys(bySrc), data: Object.values(bySrc) });
  });

  // recent activity feed
  var lbl3 = frag('section-label'); lbl3.textContent = 'Recent Activity'; page.appendChild(lbl3);
  var acard2 = frag('card-body-card'); slot(acard2, 'body').appendChild(activityTable(activities().slice(0, 30))); page.appendChild(acard2);
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
    var grid = frag('kpi-grid'); grid.classList.add('mb-3');
    grid.appendChild(kpi('Open', String(open.length), 'funnel'));
    grid.appendChild(kpi('Pipeline', ui.money(open.reduce(function (a, l) { return a + (+l.value || 0); }, 0), { compact: true }), 'cash-coin'));
    grid.appendChild(kpi('Weighted', ui.money(open.reduce(function (a, l) { return a + (+l.value || 0) * prob(l.stage); }, 0), { compact: true }), 'graph-up-arrow'));
    grid.appendChild(kpi('Won', String(wonLeads().length), 'trophy', 'text-good'));
    body.appendChild(grid);
    var kb = frag('kanban');
    STAGES.forEach(function (st) {
      var colLeads = all.filter(function (l) { return l.stage === st.id; });
      var colVal = colLeads.reduce(function (a, l) { return a + (+l.value || 0); }, 0);
      var lst = frag('kb-list');
      colLeads.forEach(function (l) {
        var age = daysSince(lastTouch(l));
        var card = frag('kb-card');
        slot(card, 'title').textContent = l.name;
        slot(card, 'sub').textContent = (l.source || '') + ' · ' + (age ? age + 'd idle' : 'today');
        slot(card, 'value').textContent = ui.money(l.value, { compact: true });
        slot(card, 'owner').textContent = String(ownerName(l.owner)).split(' ')[0];
        card.addEventListener('click', (function (ll) { return function () { leadDetail(ll); }; })(l));
        if (age > 14 && OPEN_STAGES.indexOf(l.stage) >= 0) card.appendChild(el('div.text-warn.xs.mt-1', { html: ui.icon('exclamation-triangle') + ' stale' }));
        card.addEventListener('dragstart', (function (ll, cc) { return function (e) { e.dataTransfer.setData('text/plain', ll.id); cc.classList.add('dragging'); }; })(l, card));
        card.addEventListener('dragend', (function (cc) { return function () { cc.classList.remove('dragging'); }; })(card));
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
      var col = frag('kb-col');
      Object.assign(col.style, { '--kb': st.color });   // match legacy ui.el() style handling exactly (byte-identical)
      slot(col, 'title').textContent = st.id;
      slot(col, 'count').textContent = String(colLeads.length);
      if (colVal) col.appendChild(el('div.text-mute.xs.px-2', { text: ui.money(colVal, { compact: true }) }));
      col.appendChild(lst);
      kb.appendChild(col);
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
  var grid = frag('kpi-grid');
  grid.appendChild(kpi('Total Leads', String(list.length), 'card-list'));
  grid.appendChild(kpi('Open', String(open.length), 'funnel'));
  grid.appendChild(kpi('Pipeline', ui.money(open.reduce(function (a, l) { return a + (+l.value || 0); }, 0), { compact: true }), 'cash-coin'));
  grid.appendChild(kpi('Won', String(wonLeads().length), 'trophy', 'text-good'));
  grid.appendChild(kpi('Avg Deal', ui.money(list.length ? Math.round(list.reduce(function (a, l) { return a + (+l.value || 0); }, 0) / list.length) : 0, { compact: true }), 'graph-up'));
  page.appendChild(grid);
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
  var card = frag('reg-card');
  slot(card, 'title').innerHTML = ui.icon('funnel-fill') + ' Leads';
  slot(card, 'sub').textContent = list.length + ' leads · click for detail';
  slot(card, 'body').appendChild(t.el);
  page.appendChild(card);
}

/* ---- rich lead detail (legacy el()-built MODAL; not the default render) -- */
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

  if (l.contact || l.phone || l.email || l.closeDate) {
    host.appendChild(el('div.card', null, [ el('div.card-head', null, [ el('h3', { html: ui.icon('person-vcard') + ' Contact' }) ]),
      el('div.card-body', null, [ el('div.data-list', null, [ drow('Contact person', l.contact), drow('Phone', l.phone), drow('Email', l.email), drow('Expected close', l.closeDate ? ui.date(l.closeDate) : '—') ]) ]) ]));
  }

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
  var grid = frag('kpi-grid');
  grid.appendChild(kpi('Open Follow-ups', String(pending.length), 'bell', pending.length ? 'text-warn' : 'text-good'));
  grid.appendChild(kpi('This Week', String(pending.filter(function (a) { return daysSince(a.date) <= 7; }).length), 'calendar-week'));
  grid.appendChild(kpi('Leads Needing Care', String(openLeads().filter(function (l) { return daysSince(lastTouch(l)) > 14; }).length), 'hourglass-split'));
  page.appendChild(grid);
  if (!pending.length) page.appendChild(buildBanner('check-circle-fill', '<strong>Nothing owed.</strong> No follow-ups pending — great job keeping the pipeline warm.'));
  var card = frag('head-btn-card');
  slot(card, 'title').innerHTML = ui.icon('bell-fill') + ' Pending Follow-ups';
  var act = slot(card, 'action');
  if (canCreate()) act.replaceWith(el('button.btn.btn-sm.btn-primary', { html: ui.icon('plus') + ' Log', onclick: function () { activityForm(null); } }));
  else act.remove();
  slot(card, 'body').appendChild(activityTable(pending, true));
  page.appendChild(card);
}

/* ======================================================= COMM HUB */
function commHubView(page) {
  var acts = activities();
  var byType = {}; acts.forEach(function (a) { byType[a.type || '—'] = (byType[a.type || '—'] || 0) + 1; });
  var grid = frag('kpi-grid');
  grid.appendChild(kpi('Total Activities', String(acts.length), 'chat-left-dots'));
  grid.appendChild(kpi('Calls', String(byType['Call'] || 0), 'telephone'));
  grid.appendChild(kpi('Meetings', String(byType['Meeting'] || 0), 'people'));
  grid.appendChild(kpi('WhatsApp', String(byType['WhatsApp'] || 0), 'whatsapp'));
  grid.appendChild(kpi('Emails', String(byType['Email'] || 0), 'envelope'));
  page.appendChild(grid);
  var card = frag('head-btn-card');
  slot(card, 'title').innerHTML = ui.icon('chat-left-dots') + ' Communication Log';
  var act = slot(card, 'action');
  if (canCreate()) act.replaceWith(el('button.btn.btn-sm.btn-primary', { html: ui.icon('plus') + ' Log Activity', onclick: function () { activityForm(null); } }));
  else act.remove();
  slot(card, 'body').appendChild(activityTable(acts));
  page.appendChild(card);
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
function st2(l, v) { return el('div.stat', null, [ el('div.stat-label', { text: l }), el('div.stat-value', { text: v }) ]); }
function drow(k, v) { return el('div.data-row', null, [ el('div.text-mute.sm.flex-1', { text: k }), el('div.strong', { text: v == null || v === '' ? '—' : String(v) }) ]); }
