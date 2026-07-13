/* ============================================================================
 * EPAL GROUP ERP  ·  views/construction/projects.js
 * ----------------------------------------------------------------------------
 * EPAL CONSTRUCTION — the project-lifecycle command center. TWO registered
 * views cover the whole "build" spine and each branches on ctx.subId (the
 * router falls back from `.../milestones` to `construction/projects`):
 *
 *   construction/projects
 *     active      (default) → portfolio cards: progress, stage, margin, deadline
 *     wbs                   → Work Breakdown Structure — every work order/trade
 *     progress              → physical vs financial progress across all sites
 *     milestones            → milestone billing + IPC ledger, retention held
 *   construction/boq        → cross-project BOQ workspace (category totals + add)
 *
 * A project detail drawer carries three tabs — BOQ (cn_boq), WORK ORDERS
 * (cn_workorders), MILESTONES & CLIENT BILLING (cn_billing) — plus a per-project
 * P&L (value vs material+labor+boq cost) with retention held. "Raise IPC"
 * posts revenue NET of retention through db.postSale('construction',…) and opens
 * a branded Interim Payment Certificate via EPAL.doc.open — so Construction +
 * Group finance and the ledger all move live.
 *
 * New stores (seeded idempotently below, survive db.reset):
 *   cn_workorders {id,project,title,trade,assignedTo,materialCost,laborCost,status,due,created}
 *   cn_billing    {id,project,milestone,pct,amount,retentionPct,retentionAmount,status,date}
 * ==========================================================================*/

(function (EPAL) {
  'use strict';
  var ui = EPAL.ui, el = ui.el, db = EPAL.db, S = EPAL.store;

  var TODAY = '2026-07-05';
  var CID = 'construction';

  var STAGE_COLOR = {
    Mobilization:'#7b5cff', Structure:'#2f6bff', Finishing:'#18a0a0',
    Handover:'#23c17e', 'On Hold':'#f0506e', Completed:'#23c17e'
  };
  var TRADE_COLOR = {
    Civil:'#e2721b', Structure:'#2f6bff', Electrical:'#f4b740',
    Plumbing:'#18a0a0', Finishing:'#7b5cff', 'Earthwork':'#8b6a3f'
  };
  var TRADES = ['Civil','Structure','Electrical','Plumbing','Finishing','Earthwork'];
  var WO_STATUS = ['Planned','In Progress','On Hold','Completed'];
  var BILL_STATUS = ['Draft','Submitted','Certified','Paid'];

  /* ============================================ IDEMPOTENT STORE SEEDS */
  EPAL.registerEngine({
    name: 'construction-projects-seed',
    seed: function () {
      S.seedOnce('cn_workorders', seedWorkOrders());
      S.seedOnce('cn_billing', seedBilling());
    }
  });

  function seedWorkOrders() {
    return [
      { id:'WO-001', project:'CNP-001', title:'Raft Foundation Casting',        trade:'Civil',     assignedTo:'Ashraful Karim',   materialCost:1850000, laborCost:620000, status:'Completed',   due:'2026-03-20', created:'2026-02-18' },
      { id:'WO-002', project:'CNP-001', title:'GF Column & Beam RCC',           trade:'Structure', assignedTo:'Mahmudul Hasan',   materialCost:2400000, laborCost:780000, status:'In Progress', due:'2026-08-15', created:'2026-04-10' },
      { id:'WO-003', project:'CNP-002', title:'Pile Boring (28 nos)',           trade:'Earthwork', assignedTo:'Shafiqur Rahman',  materialCost:3100000, laborCost:1150000, status:'Completed',  due:'2026-02-28', created:'2026-01-15' },
      { id:'WO-004', project:'CNP-002', title:'Basement Waterproofing',         trade:'Civil',     assignedTo:'Omar Faruk',       materialCost:640000,  laborCost:210000, status:'In Progress', due:'2026-07-30', created:'2026-05-02' },
      { id:'WO-005', project:'CNP-003', title:'Steel Shed Fabrication',         trade:'Structure', assignedTo:'Kamrul Islam',     materialCost:4200000, laborCost:960000, status:'In Progress', due:'2026-09-10', created:'2026-04-22' },
      { id:'WO-006', project:'CNP-003', title:'Internal Electrical Wiring',     trade:'Electrical',assignedTo:'Delwar Mia',       materialCost:520000,  laborCost:280000, status:'Planned',     due:'2026-10-05', created:'2026-06-01' },
      { id:'WO-007', project:'CNP-004', title:'Plumbing & Sanitary Rough-in',   trade:'Plumbing',  assignedTo:'Jashim Uddin',     materialCost:380000,  laborCost:190000, status:'In Progress', due:'2026-08-20', created:'2026-05-18' },
      { id:'WO-008', project:'CNP-005', title:'Brick Work — 1st to 3rd Floor',  trade:'Civil',     assignedTo:'Alamgir Hossain',  materialCost:1250000, laborCost:540000, status:'In Progress', due:'2026-07-25', created:'2026-05-06' },
      { id:'WO-009', project:'CNP-006', title:'Plaster & Weather Coat',         trade:'Finishing', assignedTo:'Touhidul Alam',    materialCost:720000,  laborCost:410000, status:'Planned',     due:'2026-11-12', created:'2026-06-14' },
      { id:'WO-010', project:'CNP-007', title:'Road Sub-base & Compaction',     trade:'Earthwork', assignedTo:'Monirul Haque',    materialCost:2650000, laborCost:720000, status:'In Progress', due:'2026-08-05', created:'2026-04-28' },
      { id:'WO-011', project:'CNP-008', title:'Tiles & Flooring',              trade:'Finishing', assignedTo:'Habibur Sheikh',   materialCost:1480000, laborCost:520000, status:'On Hold',     due:'2026-09-30', created:'2026-05-25' },
      { id:'WO-012', project:'CNP-009', title:'DB Board & Panel Installation',  trade:'Electrical',assignedTo:'Rafiul Alam',      materialCost:890000,  laborCost:260000, status:'Planned',     due:'2026-10-18', created:'2026-06-20' }
    ];
  }

  function bill(id, project, milestone, pct, amount, retPct, status, date) {
    return { id:id, project:project, milestone:milestone, pct:pct, amount:amount,
      retentionPct:retPct, retentionAmount:Math.round(amount * retPct / 100), status:status, date:date };
  }
  function seedBilling() {
    return [
      bill('IPC-001','CNP-001','Mobilization Advance',      10, 3200000, 10, 'Paid',      '2026-02-25'),
      bill('IPC-002','CNP-001','Foundation Complete',       20, 6400000, 10, 'Certified', '2026-04-05'),
      bill('IPC-003','CNP-002','Piling & Substructure',     25, 9500000, 10, 'Paid',      '2026-03-12'),
      bill('IPC-004','CNP-002','Basement Complete',         15, 5700000, 10, 'Submitted', '2026-06-18'),
      bill('IPC-005','CNP-003','Structure 50%',             30, 7800000, 5,  'Certified', '2026-05-20'),
      bill('IPC-006','CNP-004','Superstructure Milestone',  25, 4200000, 10, 'Paid',      '2026-05-30'),
      bill('IPC-007','CNP-005','Brick & Block Work',        20, 3600000, 10, 'Submitted', '2026-06-22'),
      bill('IPC-008','CNP-006','Finishing Stage-1',         15, 2400000, 5,  'Draft',     '2026-06-28'),
      bill('IPC-009','CNP-007','Road Sub-base Complete',    30, 5100000, 10, 'Certified', '2026-06-10'),
      bill('IPC-010','CNP-009','Electrical First Fix',      10, 1600000, 5,  'Draft',     '2026-07-01')
    ];
  }

  /* ============================================ DATA ACCESS */
  function projects() { return db.col('cn_projects'); }
  function project(id) { return projects().filter(function (p) { return p.id === id; })[0] || null; }
  function boqOf(id) { return db.col('cn_boq').filter(function (b) { return b.project === id; }); }
  function woOf(id) { return db.col('cn_workorders').filter(function (w) { return w.project === id; }); }
  function billingOf(id) { return db.col('cn_billing').filter(function (b) { return b.project === id; }); }

  function boqCost(id) { return boqOf(id).reduce(function (s, b) { return s + (+b.amount || 0); }, 0); }
  function woMaterial(id) { return woOf(id).reduce(function (s, w) { return s + (+w.materialCost || 0); }, 0); }
  function woLabor(id) { return woOf(id).reduce(function (s, w) { return s + (+w.laborCost || 0); }, 0); }
  function realCost(id) { return boqCost(id) + woMaterial(id) + woLabor(id); }
  function retentionHeld(id) {
    return billingOf(id).filter(function (b) { return b.status === 'Certified' || b.status === 'Paid'; })
      .reduce(function (s, b) { return s + (+b.retentionAmount || 0); }, 0);
  }
  function certifiedValue(id) {
    return billingOf(id).filter(function (b) { return b.status === 'Certified' || b.status === 'Paid'; })
      .reduce(function (s, b) { return s + (+b.amount || 0); }, 0);
  }

  function daysLeft(deadline) {
    if (!deadline) return NaN;
    var a = new Date(deadline).getTime(), b = new Date(TODAY).getTime();
    if (isNaN(a)) return NaN;
    return Math.round((a - b) / 86400000);
  }
  function engineers() {
    var e = db.employees({ companyId: CID }).map(function (x) { return x.name; });
    return e.length ? e : ['Ashraful Karim','Mahmudul Hasan','Shafiqur Rahman','Kamrul Islam'];
  }

  /* ================================================================ VIEW: PROJECTS */
  EPAL.view('construction/projects', {
    render: function (ctx) {
      var sub = ctx.subId || 'active';
      var page = el('div.page');
      var map = { active:'Active Sites', wbs:'Work Breakdown', progress:'Progress', milestones:'Milestones & Billing' };
      page.appendChild(EPAL.pageHead({
        eyebrow:'Construction › Projects', icon:'buildings-fill',
        title: map[sub] || 'Projects', sub: subDesc(sub),
        actions: [
          sub !== 'active' ? el('a.btn.btn-ghost', { href:'#/construction/projects/active', html: ui.icon('grid') + ' Portfolio' }) : null,
          el('a.btn.btn-ghost', { href:'#/construction/boq', html: ui.icon('calculator') + ' BOQ Workspace' }),
          el('button.btn.btn-primary', { html: ui.icon('plus-lg') + ' New Project', onclick: function () { editProject(null); } })
        ]
      }));
      ({ active:activeSites, wbs:wbs, progress:progress, milestones:milestones }[sub] || activeSites)(page, ctx);
      ctx.mount.appendChild(page);
    }
  });

  function subDesc(sub) {
    return ({ active:'Live portfolio — progress, stage, margin and deadline countdown per site.',
      wbs:'Work Breakdown Structure — every work order and trade across all sites.',
      progress:'Physical vs financial progress, budget burn and schedule risk across the portfolio.',
      milestones:'Milestone billing, IPC certification, retention held and client collections.' }[sub]) || '';
  }

  /* ============================================================ ACTIVE SITES */
  function activeSites(page) {
    var host = el('div'); page.appendChild(host);
    function draw() {
      host.innerHTML = '';
      var ps = projects();
      var totVal = 0, totCost = 0, atRisk = 0, held = 0;
      ps.forEach(function (p) {
        totVal += (+p.value || 0); totCost += realCost(p.id); held += retentionHeld(p.id);
        var dl = daysLeft(p.deadline);
        if ((+p.progress || 0) < 100 && !isNaN(dl) && dl < 30 && p.stage !== 'Handover') atRisk++;
      });
      host.appendChild(el('div.kpi-grid.stagger', null, [
        kpi('Portfolio Value', ui.money(totVal, { compact:true }), 'buildings'),
        kpi('Committed Cost', ui.money(totCost, { compact:true }), 'wallet2'),
        kpi('Portfolio Margin', ui.money(totVal - totCost, { compact:true }), 'graph-up-arrow'),
        kpi('Retention Held', ui.money(held, { compact:true }), 'lock-fill'),
        kpi('Deadline Risk', String(atRisk), 'alarm-fill')
      ]));

      if (!ps.length) {
        host.appendChild(el('div.empty-state', null, [ ui.frag(ui.icon('buildings')),
          el('h3', { text:'No projects yet' }), el('p.text-muted', { text:'Create your first construction project.' }) ]));
        return;
      }

      host.appendChild(el('div.section-label', { text:'Active Sites' }));
      var grid = el('div.grid-auto.stagger');
      ps.forEach(function (p) {
        var cost = realCost(p.id), margin = (+p.value || 0) - cost;
        var mPct = p.value ? Math.round(margin / p.value * 100) : 0;
        var prog = Math.max(0, Math.min(100, +p.progress || 0));
        var dl = daysLeft(p.deadline);
        var dlTone = isNaN(dl) ? '' : dl < 0 ? 'text-bad' : dl < 30 ? 'text-warn' : '';
        var dlLbl = isNaN(dl) ? '—' : (dl < 0 ? Math.abs(dl) + 'd overdue' : dl + 'd left');
        var col = STAGE_COLOR[p.stage] || '#e2721b';
        grid.appendChild(el('div.card.hover', { style:{ cursor:'pointer' }, onclick: (function (pid) { return function () { projectDrawer(pid, draw); }; })(p.id) }, [
          el('div.card-pad', null, [
            el('div.flex.items-center.gap-2', null, [
              el('div.flex-1', null, [
                el('div.fw-700', { text: p.name }),
                el('div.text-muted.sm', { text: (p.client || '—') + ' · ' + p.id })
              ]),
              stageBadge(p.stage)
            ]),
            el('div', { style:{ margin:'14px 0 4px', display:'flex', alignItems:'center', gap:'8px' } }, [
              el('div', { style:{ flex:'1', height:'8px', borderRadius:'6px', background:'rgba(255,255,255,.08)', overflow:'hidden' } }, [
                el('div', { style:{ width: prog + '%', height:'100%', background: col } }) ]),
              el('span.num.xs', { style:{ minWidth:'38px' }, text: prog + '%' })
            ]),
            el('div.stat-row.mt-3', null, [
              st2('Value', ui.money(p.value, { compact:true })),
              st2('Budget', ui.money(+p.cost || 0, { compact:true })),
              st2('Cost', ui.money(cost, { compact:true })),
              st2('Margin', ui.money(margin, { compact:true }) + ' · ' + mPct + '%')
            ]),
            el('div.flex.justify-between.items-center.mt-3', null, [
              el('span.text-mute.xs', { html: ui.icon('person-badge') + ' ' + ui.escapeHtml(p.engineer || '—') }),
              el('span.badge' + (dlTone === 'text-bad' ? '.badge-bad' : dlTone === 'text-warn' ? '.badge-warn' : ''), { text: dlLbl })
            ])
          ])
        ]));
      });
      host.appendChild(grid);
    }
    draw();
  }

  /* ============================================================ WBS (work orders) */
  function wbs(page) {
    var host = el('div'); page.appendChild(host);
    page.querySelector('.page-actions').prepend(el('button.btn.btn-ghost', { html: ui.icon('plus') + ' Add Work Order',
      onclick: function () { editWorkOrder(null, null, draw); } }));
    function draw() {
      host.innerHTML = '';
      var wos = db.col('cn_workorders');
      var mat = 0, lab = 0, done = 0;
      wos.forEach(function (w) { mat += (+w.materialCost || 0); lab += (+w.laborCost || 0); if (w.status === 'Completed') done++; });
      host.appendChild(el('div.kpi-grid.stagger', null, [
        kpi('Work Orders', String(wos.length), 'tools'),
        kpi('Completed', String(done), 'check2-circle'),
        kpi('Material Cost', ui.money(mat, { compact:true }), 'bricks'),
        kpi('Labor Cost', ui.money(lab, { compact:true }), 'people')
      ]));

      var tbl = EPAL.table({
        columns: [
          { key:'id', label:'WO', render:function (r) { return '<span class="strong">' + ui.escapeHtml(r.id) + '</span>'; } },
          { key:'title', label:'Work Order' },
          { key:'project', label:'Site', render:function (r) { var p = project(r.project); return ui.escapeHtml(r.project) + (p ? ' <span class="text-mute xs">' + ui.escapeHtml(shortName(p.name)) + '</span>' : ''); } },
          { key:'trade', label:'Trade', render:function (r) { return tradeBadge(r.trade).outerHTML; } },
          { key:'assignedTo', label:'Assigned' },
          { key:'materialCost', label:'Material', num:true, money:true },
          { key:'laborCost', label:'Labor', num:true, money:true },
          { key:'cost', label:'Total', num:true, sortVal:function (r) { return (+r.materialCost || 0) + (+r.laborCost || 0); },
            render:function (r) { return '<span class="num strong">' + ui.money((+r.materialCost || 0) + (+r.laborCost || 0)) + '</span>'; } },
          { key:'status', label:'Status', badge:{ Completed:'good', 'In Progress':'', Planned:'warn', 'On Hold':'bad' } },
          { key:'due', label:'Due', date:true }
        ],
        rows: function () { return db.col('cn_workorders'); },
        searchKeys:['id','title','project','trade','assignedTo'],
        filters:[{ key:'trade', label:'Trade' }, { key:'status', label:'Status' }],
        onRow: function (r) { editWorkOrder(r.project, r, draw); },
        exportName:'construction-work-orders.csv', pageSize: 15,
        empty:{ icon:'tools', title:'No work orders yet', hint:'Add a work order to build the WBS.' }
      });
      host.appendChild(el('div.card', null, [
        el('div.card-head', null, [ el('h3', { html: ui.icon('diagram-3-fill') + ' Work Breakdown Structure' }),
          el('span.card-sub', { text:'Every trade package across all sites' }) ]),
        el('div.card-body', null, [ tbl.el ])
      ]));
    }
    draw();
  }

  /* ============================================================ PROGRESS */
  function progress(page) {
    var ps = projects();
    var avg = ps.length ? Math.round(ps.reduce(function (s, p) { return s + (+p.progress || 0); }, 0) / ps.length) : 0;
    var onHold = ps.filter(function (p) { return p.stage === 'On Hold'; }).length;
    var handover = ps.filter(function (p) { return p.stage === 'Handover' || (+p.progress || 0) >= 100; }).length;
    var overdue = ps.filter(function (p) { var d = daysLeft(p.deadline); return (+p.progress || 0) < 100 && !isNaN(d) && d < 0; }).length;
    page.appendChild(el('div.kpi-grid.stagger', null, [
      kpi('Avg Physical Progress', avg + '%', 'speedometer2'),
      kpi('Near Handover', String(handover), 'flag-fill'),
      kpi('On Hold', String(onHold), 'pause-circle'),
      kpi('Overdue', String(overdue), 'alarm-fill')
    ]));

    var cv = ui.uid('c');
    page.appendChild(el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon('bar-chart-line-fill') + ' Physical vs Financial Progress' }) ]),
      el('div.card-body', null, [ el('div', { style:{ height:'300px', position:'relative' } }, [ el('canvas', { id: cv }) ]) ])
    ]));

    var rows = ps.map(function (p) {
      var cost = realCost(p.id);
      var financial = p.value ? Math.round(certifiedValue(p.id) / p.value * 100) : 0;
      var dl = daysLeft(p.deadline);
      return { id:p.id, name: shortName(p.name), stage:p.stage, physical:+p.progress || 0, financial: financial,
        value:+p.value || 0, cost:cost, deadline:p.deadline, dl: isNaN(dl) ? 99999 : dl };
    });
    var tbl = EPAL.table({
      columns: [
        { key:'name', label:'Site', render:function (r) { return '<span class="strong">' + ui.escapeHtml(r.name) + '</span> <span class="text-mute xs">' + ui.escapeHtml(r.id) + '</span>'; } },
        { key:'stage', label:'Stage', render:function (r) { return stageBadge(r.stage).outerHTML; } },
        { key:'physical', label:'Physical', sort:true, render:function (r) { return progressBar(r.physical, STAGE_COLOR[r.stage] || '#e2721b'); } },
        { key:'financial', label:'Financial', sort:true, render:function (r) { return progressBar(r.financial, '#23c17e'); } },
        { key:'value', label:'Value', num:true, money:true },
        { key:'deadline', label:'Deadline', render:function (r) {
            if (r.dl === 99999) return '—';
            var tone = r.dl < 0 ? 'text-bad' : r.dl < 30 ? 'text-warn' : '';
            return ui.date(r.deadline) + ' <span class="' + tone + ' xs">(' + (r.dl < 0 ? Math.abs(r.dl) + 'd over' : r.dl + 'd') + ')</span>'; },
          sortVal:function (r) { return r.dl; } }
      ],
      rows: rows, searchKeys:['name','id','stage'], exportName:'construction-progress.csv', pageSize: 15,
      onRow: function (r) { projectDrawer(r.id); },
      empty:{ icon:'graph-up', title:'No projects', hint:'Create a project to track progress.' }
    });
    page.appendChild(el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon('list-check') + ' Progress Register' }) ]),
      el('div.card-body', null, [ tbl.el ])
    ]));

    requestAnimationFrame(function () {
      var canvas = ui.$('#' + cv); if (!canvas || !EPAL.charts) return;
      var labels = rows.map(function (r) { return r.id; });
      EPAL.charts.bar(canvas, {
        labels: labels,
        datasets: [
          { label:'Physical %', data: rows.map(function (r) { return r.physical; }) },
          { label:'Financial %', data: rows.map(function (r) { return r.financial; }) }
        ],
        money: false
      });
    });
  }

  /* ============================================================ MILESTONES & BILLING */
  function milestones(page) {
    var host = el('div'); page.appendChild(host);
    function draw() {
      host.innerHTML = '';
      var all = db.col('cn_billing');
      var certified = 0, collected = 0, held = 0, pending = 0;
      all.forEach(function (b) {
        var net = (+b.amount || 0) - (+b.retentionAmount || 0);
        if (b.status === 'Certified' || b.status === 'Paid') certified += (+b.amount || 0);
        if (b.status === 'Paid') collected += net;
        if (b.status === 'Certified' || b.status === 'Paid') held += (+b.retentionAmount || 0);
        if (b.status === 'Submitted' || b.status === 'Certified') pending += net;
      });
      host.appendChild(el('div.kpi-grid.stagger', null, [
        kpi('Certified Value', ui.money(certified, { compact:true }), 'patch-check-fill'),
        kpi('Collected (net)', ui.money(collected, { compact:true }), 'cash-coin'),
        kpi('Retention Held', ui.money(held, { compact:true }), 'lock-fill'),
        kpi('Awaiting Payment', ui.money(pending, { compact:true }), 'hourglass-split')
      ]));

      var tbl = EPAL.table({
        columns: [
          { key:'id', label:'IPC', render:function (r) { return '<span class="strong">' + ui.escapeHtml(r.id) + '</span>'; } },
          { key:'project', label:'Site', render:function (r) { var p = project(r.project); return ui.escapeHtml(r.project) + (p ? ' <span class="text-mute xs">' + ui.escapeHtml(shortName(p.name)) + '</span>' : ''); } },
          { key:'milestone', label:'Milestone' },
          { key:'pct', label:'% Work', num:true, render:function (r) { return r.pct + '%'; } },
          { key:'amount', label:'Gross', num:true, money:true },
          { key:'retentionAmount', label:'Retention', num:true, render:function (r) { return '<span class="num text-warn">-' + ui.money(r.retentionAmount) + '</span>'; } },
          { key:'net', label:'Net', num:true, sortVal:function (r) { return (+r.amount || 0) - (+r.retentionAmount || 0); },
            render:function (r) { return '<span class="num strong">' + ui.money((+r.amount || 0) - (+r.retentionAmount || 0)) + '</span>'; } },
          { key:'status', label:'Status', badge:{ Paid:'good', Certified:'', Submitted:'warn', Draft:'bad' } },
          { key:'date', label:'Date', date:true }
        ],
        rows: function () { return db.col('cn_billing'); },
        searchKeys:['id','project','milestone'],
        filters:[{ key:'status', label:'Status' }],
        onRow: function (r) { billingDrawer(r.id, draw); },
        exportName:'construction-ipc.csv', pageSize: 15,
        empty:{ icon:'receipt', title:'No IPCs yet', hint:'Raise a milestone invoice from a project drawer.' }
      });
      host.appendChild(el('div.card', null, [
        el('div.card-head', null, [ el('h3', { html: ui.icon('receipt-cutoff') + ' Milestone Billing & IPC Ledger' }),
          el('span.card-sub', { text:'Retention deducted at source, held until final account' }) ]),
        el('div.card-body', null, [ tbl.el ])
      ]));
    }
    draw();
  }

  /* ============================================================ PROJECT DRAWER (tabs) */
  function projectDrawer(id, refresh) {
    var body = el('div');
    var tab = 'boq';
    var m = ui.modal({ title:'Project', icon:'buildings', size:'xl', body:body, footer:false });

    function redraw() {
      var p = project(id);
      if (!p) { m.close(); return; }
      body.innerHTML = '';
      var cost = realCost(id), value = +p.value || 0, profit = value - cost;
      var held = retentionHeld(id);

      // header
      body.appendChild(el('div.flex.gap-1.flex-wrap.items-center.mb-3', null, [
        el('span', { style:{ fontSize:'17px', fontWeight:'700' }, text: p.name }),
        stageBadge(p.stage), el('span.badge', { text: p.id }),
        el('span.badge', { text: (p.progress || 0) + '% done' })
      ]));

      // P&L strip
      body.appendChild(el('div.section-label', { text:'Project P&L' }));
      var budget = +p.cost || 0;
      body.appendChild(el('div.stat-row', null, [
        st2('Contract Value', ui.money(value)),
        st2('Budgeted Cost', ui.money(budget)),
        st2('Committed Cost', ui.money(cost)),
        st2('Projected Profit', ui.money(profit) + ' · ' + (value ? Math.round(profit / value * 100) : 0) + '%'),
        st2('Retention Held', ui.money(held))
      ]));
      body.appendChild(el('div.build-banner', { style:{ marginTop:'6px' } }, [ ui.frag(ui.icon('info-circle')),
        el('div', { html:'Cost = BOQ ' + ui.money(boqCost(id)) + ' + Material ' + ui.money(woMaterial(id)) +
          ' + Labor ' + ui.money(woLabor(id)) + '. Retention of <strong>' + ui.money(held) +
          '</strong> is withheld by the client until the final account is settled.' }) ]));

      // meta grid
      body.appendChild(el('div.form-grid', null, [
        kv('Client', p.client || '—'), kv('Engineer', p.engineer || '—'),
        kv('Start', p.start ? ui.date(p.start) : '—'), kv('Deadline', p.deadline ? ui.date(p.deadline) : '—')
      ]));

      // tabs
      var tabs = [['boq','BOQ','list-columns-reverse'], ['wo','Work Orders','tools'], ['billing','Milestones & Billing','receipt']];
      var nav = el('div.flex.gap-1.flex-wrap', { style:{ margin:'14px 0 10px' } });
      tabs.forEach(function (t) {
        nav.appendChild(el('button.btn.btn-sm' + (tab === t[0] ? '.btn-primary' : '.btn-ghost'),
          { html: ui.icon(t[2]) + ' ' + t[1], onclick: (function (k) { return function () { tab = k; redraw(); }; })(t[0]) }));
      });
      body.appendChild(nav);

      var content = el('div');
      body.appendChild(content);
      if (tab === 'boq') tabBOQ(content, p);
      else if (tab === 'wo') tabWO(content, p);
      else tabBilling(content, p);

      // edit + comments
      body.appendChild(el('div.divider'));
      body.appendChild(el('div.flex.gap-1.flex-wrap', null, [
        el('button.btn.btn-sm.btn-outline', { html: ui.icon('pencil') + ' Edit Project',
          onclick: function () { editProject(p, function () { redraw(); refresh && refresh(); }); } })
      ]));
      if (EPAL.comments && EPAL.comments.widget) {
        body.appendChild(el('div.section-label', { text:'Discussion' }));
        body.appendChild(EPAL.comments.widget('cn_project', p.id));
      }
    }

    function tabBOQ(host, p) {
      var lines = boqOf(p.id);
      var total = lines.reduce(function (s, b) { return s + (+b.amount || 0); }, 0);
      host.appendChild(el('div.flex.justify-between.items-center.mb-2', null, [
        el('span.text-mute.sm', { text: lines.length + ' line item' + (lines.length === 1 ? '' : 's') + ' · ' + ui.money(total) }),
        el('button.btn.btn-sm.btn-ghost', { html: ui.icon('plus') + ' Add BOQ Line',
          onclick: function () { editBoqLine(p.id, null, redraw); } })
      ]));
      var tbl = EPAL.table({
        columns: [
          { key:'item', label:'Item' },
          { key:'category', label:'Category', render:function (r) { return '<span class="badge">' + ui.escapeHtml(r.category || '—') + '</span>'; } },
          { key:'unit', label:'Unit' },
          { key:'qty', label:'Qty', num:true },
          { key:'rate', label:'Rate', num:true, money:true },
          { key:'amount', label:'Amount', num:true, money:true }
        ],
        rows: lines, searchKeys:['item','category'], exportName:'boq-' + p.id + '.csv', pageSize: 8,
        onRow: function (r) { editBoqLine(p.id, r, redraw); },
        empty:{ icon:'calculator', title:'No BOQ lines', hint:'Add the first bill-of-quantity line.' }
      });
      host.appendChild(tbl.el);
    }

    function tabWO(host, p) {
      var wos = woOf(p.id);
      var mat = woMaterial(p.id), lab = woLabor(p.id);
      host.appendChild(el('div.flex.justify-between.items-center.mb-2', null, [
        el('span.text-mute.sm', { text: wos.length + ' work order' + (wos.length === 1 ? '' : 's') + ' · Material ' + ui.money(mat) + ' · Labor ' + ui.money(lab) }),
        el('button.btn.btn-sm.btn-ghost', { html: ui.icon('plus') + ' Add Work Order',
          onclick: function () { editWorkOrder(p.id, null, redraw); } })
      ]));
      var tbl = EPAL.table({
        columns: [
          { key:'id', label:'WO' },
          { key:'title', label:'Title' },
          { key:'trade', label:'Trade', render:function (r) { return tradeBadge(r.trade).outerHTML; } },
          { key:'assignedTo', label:'Assigned' },
          { key:'materialCost', label:'Material', num:true, money:true },
          { key:'laborCost', label:'Labor', num:true, money:true },
          { key:'status', label:'Status', badge:{ Completed:'good', 'In Progress':'', Planned:'warn', 'On Hold':'bad' } },
          { key:'due', label:'Due', date:true }
        ],
        rows: wos, searchKeys:['id','title','trade','assignedTo'], exportName:'wo-' + p.id + '.csv', pageSize: 8,
        onRow: function (r) { editWorkOrder(p.id, r, redraw); },
        empty:{ icon:'tools', title:'No work orders', hint:'Break the site into trade packages.' }
      });
      host.appendChild(tbl.el);
    }

    function tabBilling(host, p) {
      var lines = billingOf(p.id);
      host.appendChild(el('div.flex.justify-between.items-center.mb-2', null, [
        el('span.text-mute.sm', { text:'Retention held ' + ui.money(retentionHeld(p.id)) + ' · Certified ' + ui.money(certifiedValue(p.id)) }),
        el('button.btn.btn-sm.btn-ghost', { html: ui.icon('plus') + ' Add Milestone',
          onclick: function () { editBilling(p.id, null, redraw); } })
      ]));
      if (!lines.length) {
        host.appendChild(el('div.empty-state', null, [ ui.frag(ui.icon('receipt')),
          el('h3', { text:'No milestones' }), el('p.text-muted', { text:'Add a milestone then raise an IPC.' }) ]));
        return;
      }
      var list = el('div.data-list');
      lines.forEach(function (b) {
        var net = (+b.amount || 0) - (+b.retentionAmount || 0);
        var canRaise = b.status === 'Draft' || b.status === 'Submitted';
        list.appendChild(el('div.data-row', { style:{ alignItems:'center', gap:'10px', padding:'10px 4px' } }, [
          el('div.flex-1', null, [
            el('div.fw-600', { text: b.milestone }),
            el('div.text-mute.xs', { text: b.id + ' · ' + b.pct + '% work · Gross ' + ui.money(b.amount) + ' · Retention ' + ui.money(b.retentionAmount) + ' @ ' + b.retentionPct + '%' })
          ]),
          el('div', { style:{ textAlign:'right' } }, [
            el('div.num.strong', { text: ui.money(net) }),
            billStatusBadge(b.status)
          ]),
          canRaise
            ? el('button.btn.btn-sm.btn-primary', { html: ui.icon('file-earmark-check') + ' Raise IPC',
                onclick: (function (bid) { return function () { raiseIPC(bid, p, redraw, refresh); }; })(b.id) })
            : el('button.btn.btn-sm.btn-outline', { html: ui.icon('printer') + ' Certificate',
                onclick: (function (bid) { return function () { openIPCDoc(billLine(bid), p); }; })(b.id) })
        ]));
      });
      host.appendChild(list);
    }

    redraw();
  }

  function billLine(id) { return db.col('cn_billing').filter(function (b) { return b.id === id; })[0] || null; }

  /* --- Raise IPC: post revenue net of retention + branded certificate ----- */
  function raiseIPC(billId, p, redraw, refresh) {
    var b = billLine(billId);
    if (!b) return;
    var net = (+b.amount || 0) - (+b.retentionAmount || 0);
    ui.confirm({
      title:'Raise IPC · ' + b.milestone,
      body:'Certify ' + ui.money(b.amount) + ' gross, withhold ' + ui.money(b.retentionAmount) +
        ' retention (' + b.retentionPct + '%) and post ' + ui.money(net) + ' net to Construction finance?',
      confirmLabel:'Certify & Post'
    }).then(function (ok) {
      if (!ok) return;
      var sale = db.postSale(CID, {
        amount: net, cost: 0, ref: b.id,
        desc: 'IPC ' + b.milestone + ' · ' + p.id,
        customer: p.client || p.name
      });
      b.status = 'Certified';
      b.saleRef = sale.id;
      b.date = TODAY;
      db.save('cn_billing', b);
      db.notify({ level:'success', title:'IPC Certified', companyId: CID, icon:'file-earmark-check-fill',
        text: b.id + ' · ' + p.client + ' · ' + ui.money(net) + ' net' });
      ui.toast('IPC ' + b.id + ' certified · ' + ui.money(net) + ' posted', 'success');
      openIPCDoc(billLine(b.id), p);
      redraw && redraw();
      refresh && refresh();
    });
  }

  function openIPCDoc(b, p) {
    if (!b) return;
    if (!EPAL.doc || !EPAL.doc.open) { ui.toast('Document engine unavailable', 'error'); return; }
    var net = (+b.amount || 0) - (+b.retentionAmount || 0);
    EPAL.doc.open({
      type:'invoice', title:'Interim Payment Certificate', serial: EPAL.doc.numberFor('invoice'),
      badge: b.status, watermark:'IPC',
      parties: [
        { label:'Employer / Client', lines:[ p.client || '—', p.name, 'Project ' + p.id ] },
        { label:'Contractor', lines:[ 'Epal Construction Ltd', 'Gulshan-2, Dhaka', 'Engineer: ' + (p.engineer || '—') ] }
      ],
      meta: [
        { label:'Certificate No', value: b.id },
        { label:'Milestone', value: b.milestone },
        { label:'Work Done', value: b.pct + '%' },
        { label:'Date', value: ui.date(b.date || TODAY) }
      ],
      columns: [ { key:'k', label:'Description' }, { key:'v', label:'Amount (BDT)', num:true, money:true } ],
      rows: [
        { k:'Gross value of work certified (' + b.pct + '%)', v: +b.amount || 0 },
        { k:'Less: Retention @ ' + b.retentionPct + '%', v: -(+b.retentionAmount || 0) }
      ],
      totals: [
        { label:'Gross Certified', value: ui.money(b.amount) },
        { label:'Retention Held', value: ui.money(b.retentionAmount) },
        { label:'Net Payable This Certificate', value: ui.money(net), grand:true }
      ],
      words: EPAL.doc.amountInWords ? EPAL.doc.amountInWords(net) : '',
      terms:'This certificate acknowledges work executed to date. Net amount is payable within 30 days. Retention is released on final completion and defect-liability expiry per the contract.',
      sign:'For Epal Construction Ltd'
    });
  }

  /* --- billing detail drawer (from the milestones ledger) ----------------- */
  function billingDrawer(id, refresh) {
    var b = billLine(id);
    if (!b) return;
    var p = project(b.project) || { id:b.project, name:b.project, client:'—' };
    var net = (+b.amount || 0) - (+b.retentionAmount || 0);
    var body = el('div');
    var m = ui.modal({ title:'IPC ' + b.id, icon:'receipt', size:'md', body:body, footer:false });
    body.appendChild(el('div.flex.gap-1.flex-wrap.mb-3', null, [ billStatusBadge(b.status), el('span.badge', { text:b.project }), el('span.badge', { text:b.pct + '% work' }) ]));
    body.appendChild(el('div.form-grid', null, [
      kv('Project', shortName(p.name)), kv('Client', p.client || '—'),
      kv('Milestone', b.milestone), kv('Date', b.date ? ui.date(b.date) : '—'),
      kv('Gross', ui.money(b.amount)), kv('Retention', ui.money(b.retentionAmount) + ' @ ' + b.retentionPct + '%'),
      kv('Net', ui.money(net)), kv('Status', b.status)
    ]));
    body.appendChild(el('div.divider'));
    var canRaise = b.status === 'Draft' || b.status === 'Submitted';
    var canPay = b.status === 'Certified';
    body.appendChild(el('div.flex.gap-1.flex-wrap', null, [
      canRaise ? el('button.btn.btn-primary', { html: ui.icon('file-earmark-check') + ' Raise IPC',
        onclick: function () { m.close(); raiseIPC(b.id, p, null, refresh); } }) : null,
      canPay ? el('button.btn.btn-sm.btn-outline', { html: ui.icon('cash') + ' Mark Paid',
        onclick: function () { var cur = billLine(b.id); if (!cur) { ui.toast('IPC record not found', 'error'); return; } cur.status = 'Paid'; db.save('cn_billing', cur); ui.toast('IPC marked paid', 'success'); m.close(); refresh && refresh(); } }) : null,
      el('button.btn.btn-sm.btn-outline', { html: ui.icon('printer') + ' Certificate', onclick: function () { openIPCDoc(billLine(b.id), p); } })
    ]));
  }

  /* ============================================================ FORMS */
  function editProject(rec, done) {
    var isNew = !rec;
    EPAL.formModal({
      title: isNew ? 'New Project' : 'Edit Project', icon:'buildings', size:'lg',
      record: rec || {},
      fields: [
        { type:'section', label:'Project' },
        { key:'name', label:'Project name', type:'text', required:true, col2:true, placeholder:'e.g. 8-Storey Commercial Building · Uttara' },
        { key:'client', label:'Client', type:'text', required:true, placeholder:'e.g. Bashundhara Group' },
        { key:'engineer', label:'Project Engineer', type:'select', optionsFrom: engineers },
        { type:'section', label:'Commercials' },
        { key:'value', label:'Contract value', type:'money', required:true, min:1 },
        { key:'cost', label:'Budgeted cost', type:'money', min:0 },
        { key:'progress', label:'Progress %', type:'number', min:0, max:100, default:0 },
        { key:'stage', label:'Stage', type:'select', options:['Mobilization','Structure','Finishing','Handover','On Hold','Completed'], default:'Mobilization' },
        { type:'section', label:'Schedule' },
        { key:'start', label:'Start date', type:'date' },
        { key:'deadline', label:'Deadline', type:'date' }
      ],
      saveLabel: isNew ? 'Create Project' : 'Save',
      onSave: function (v, record) {
        var r = record && record.id ? record : { id: nextProjectId(), created: TODAY };
        r.name = (v.name || '').trim();
        r.client = (v.client || '').trim();
        r.engineer = v.engineer || '';
        r.value = +v.value || 0;
        r.cost = +v.cost || 0;
        r.progress = Math.max(0, Math.min(100, +v.progress || 0));
        r.stage = v.stage || 'Mobilization';
        r.start = v.start || '';
        r.deadline = v.deadline || '';
        db.save('cn_projects', r);
        ui.toast('Project ' + r.id + ' saved', 'success');
        if (done) done(); else EPAL.router.render();
        return true;
      }
    });
  }

  function editWorkOrder(projectId, rec, done) {
    var isNew = !rec;
    var projOpts = projects().map(function (p) { return [p.id, p.id + ' · ' + shortName(p.name)]; });
    EPAL.formModal({
      title: isNew ? 'Add Work Order' : 'Edit Work Order', icon:'tools', size:'lg',
      record: rec || {},
      fields: [
        { key:'project', label:'Site / Project', type:'select', required:true, options: projOpts, default: projectId || (projOpts[0] && projOpts[0][0]) },
        { key:'title', label:'Work order title', type:'text', required:true, col2:true, placeholder:'e.g. Ground Floor Column & Beam RCC' },
        { key:'trade', label:'Trade', type:'select', required:true, options: TRADES },
        { key:'assignedTo', label:'Assigned to', type:'select', optionsFrom: engineers },
        { key:'materialCost', label:'Material cost', type:'money', min:0, default:0 },
        { key:'laborCost', label:'Labor cost', type:'money', min:0, default:0 },
        { key:'status', label:'Status', type:'select', options: WO_STATUS, default:'Planned' },
        { key:'due', label:'Due date', type:'date' }
      ],
      saveLabel: isNew ? 'Add Work Order' : 'Save',
      onSave: function (v, record) {
        var r = record && record.id ? record : { id: nextWoId(), created: TODAY };
        r.project = v.project;
        r.title = (v.title || '').trim();
        r.trade = v.trade;
        r.assignedTo = v.assignedTo || '';
        r.materialCost = +v.materialCost || 0;
        r.laborCost = +v.laborCost || 0;
        r.status = v.status || 'Planned';
        r.due = v.due || '';
        db.save('cn_workorders', r);
        ui.toast('Work order ' + r.id + ' saved', 'success');
        if (done) done();
        return true;
      }
    });
  }

  function editBoqLine(projectId, rec, done) {
    var isNew = !rec;
    EPAL.formModal({
      title: isNew ? 'Add BOQ Line' : 'Edit BOQ Line', icon:'calculator', size:'md',
      record: rec || {},
      fields: [
        { key:'item', label:'Item description', type:'text', required:true, col2:true, placeholder:'e.g. RCC (1:1.5:3)' },
        { key:'category', label:'Category', type:'select', required:true, options:['Civil','Structure','Electrical','Plumbing','Finishing','Earthwork'] },
        { key:'unit', label:'Unit', type:'text', required:true, placeholder:'cum / sqm / ton / pcs' },
        { key:'qty', label:'Quantity', type:'number', required:true, min:0 },
        { key:'rate', label:'Rate', type:'money', required:true, min:0 }
      ],
      saveLabel: isNew ? 'Add Line' : 'Save',
      onSave: function (v, record) {
        var r = record && record.id ? record : { id: nextBoqId(), project: projectId, created: TODAY };
        r.project = r.project || projectId;
        r.item = (v.item || '').trim();
        r.category = v.category;
        r.unit = (v.unit || '').trim();
        r.qty = +v.qty || 0;
        r.rate = +v.rate || 0;
        r.amount = r.qty * r.rate;
        db.save('cn_boq', r);
        ui.toast('BOQ line saved · ' + ui.money(r.amount), 'success');
        if (done) done();
        return true;
      }
    });
  }

  function editBilling(projectId, rec, done) {
    var isNew = !rec;
    EPAL.formModal({
      title: isNew ? 'Add Milestone' : 'Edit Milestone', icon:'receipt', size:'md',
      record: rec || {},
      fields: [
        { key:'milestone', label:'Milestone', type:'text', required:true, col2:true, placeholder:'e.g. Superstructure Complete' },
        { key:'pct', label:'% of work', type:'number', required:true, min:0, max:100, default:10 },
        { key:'amount', label:'Gross amount', type:'money', required:true, min:1 },
        { key:'retentionPct', label:'Retention %', type:'number', min:0, max:20, default:10 },
        { key:'status', label:'Status', type:'select', options: BILL_STATUS, default:'Draft' }
      ],
      saveLabel: isNew ? 'Add Milestone' : 'Save',
      onSave: function (v, record) {
        var r = record && record.id ? record : { id: nextIpcId(), project: projectId, date: TODAY };
        r.project = r.project || projectId;
        r.milestone = (v.milestone || '').trim();
        r.pct = +v.pct || 0;
        r.amount = +v.amount || 0;
        r.retentionPct = +v.retentionPct || 0;
        r.retentionAmount = Math.round(r.amount * r.retentionPct / 100);
        r.status = v.status || 'Draft';
        db.save('cn_billing', r);
        ui.toast('Milestone ' + r.id + ' saved', 'success');
        if (done) done();
        return true;
      }
    });
  }

  /* ================================================================ VIEW: BOQ */
  EPAL.view('construction/boq', {
    render: function (ctx) {
      var page = el('div.page');
      page.appendChild(EPAL.pageHead({
        eyebrow:'Construction › BOQ & Estimation', icon:'calculator-fill',
        title:'BOQ Workspace', sub:'Bill of quantities across every project — category totals, rate analysis and line entry.',
        actions: [
          el('a.btn.btn-ghost', { href:'#/construction/projects/active', html: ui.icon('buildings') + ' Projects' }),
          el('button.btn.btn-primary', { html: ui.icon('plus-lg') + ' Add BOQ Line', onclick: function () { addGlobalBoqLine(refresh); } })
        ]
      }));
      var host = el('div'); page.appendChild(host);

      function refresh() { draw(); }
      function draw() {
        host.innerHTML = '';
        var lines = db.col('cn_boq');
        var byCat = {}, grand = 0;
        lines.forEach(function (b) {
          var c = b.category || 'Other';
          byCat[c] = (byCat[c] || 0) + (+b.amount || 0);
          grand += (+b.amount || 0);
        });
        var cats = Object.keys(byCat).sort();

        host.appendChild(el('div.kpi-grid.stagger', null, [
          kpi('BOQ Lines', String(lines.length), 'list-ol'),
          kpi('Total BOQ Value', ui.money(grand, { compact:true }), 'calculator'),
          kpi('Categories', String(cats.length), 'tags-fill'),
          kpi('Projects Covered', String(uniqueProjects(lines)), 'buildings')
        ]));

        // category totals
        var chips = el('div.stat-row.mb-3');
        cats.forEach(function (c) { chips.appendChild(st2(c, ui.money(byCat[c], { compact:true }))); });
        host.appendChild(el('div.card', null, [
          el('div.card-head', null, [ el('h3', { html: ui.icon('bar-chart-steps') + ' Totals by Category' }) ]),
          el('div.card-body', null, [ chips ])
        ]));

        var tbl = EPAL.table({
          columns: [
            { key:'id', label:'Code', render:function (r) { return '<span class="strong">' + ui.escapeHtml(r.id) + '</span>'; } },
            { key:'project', label:'Site', render:function (r) { var p = project(r.project); return ui.escapeHtml(r.project) + (p ? ' <span class="text-mute xs">' + ui.escapeHtml(shortName(p.name)) + '</span>' : ''); } },
            { key:'item', label:'Item' },
            { key:'category', label:'Category', render:function (r) { return '<span class="badge">' + ui.escapeHtml(r.category || '—') + '</span>'; } },
            { key:'unit', label:'Unit' },
            { key:'qty', label:'Qty', num:true },
            { key:'rate', label:'Rate', num:true, money:true },
            { key:'amount', label:'Amount', num:true, money:true }
          ],
          rows: function () { return db.col('cn_boq'); },
          searchKeys:['id','project','item','category','unit'],
          filters:[{ key:'category', label:'Category' }, { key:'project', label:'Site' }],
          onRow: function (r) { editBoqLine(r.project, r, refresh); },
          exportName:'construction-boq.csv', pageSize: 15,
          empty:{ icon:'calculator', title:'No BOQ lines yet', hint:'Add your first bill-of-quantity line.' }
        });
        host.appendChild(el('div.card', null, [
          el('div.card-head', null, [ el('h3', { html: ui.icon('table') + ' Bill of Quantities' }),
            el('span.card-sub', { text: lines.length + ' line' + (lines.length === 1 ? '' : 's') + ' · ' + ui.money(grand) }) ]),
          el('div.card-body', null, [ tbl.el ])
        ]));
      }
      draw();
      ctx.mount.appendChild(page);
    }
  });

  function addGlobalBoqLine(done) {
    var projOpts = projects().map(function (p) { return [p.id, p.id + ' · ' + shortName(p.name)]; });
    EPAL.formModal({
      title:'Add BOQ Line', icon:'calculator', size:'md',
      fields: [
        { key:'project', label:'Site / Project', type:'select', required:true, options: projOpts },
        { key:'item', label:'Item description', type:'text', required:true, col2:true, placeholder:'e.g. Brick Work 10"' },
        { key:'category', label:'Category', type:'select', required:true, options:['Civil','Structure','Electrical','Plumbing','Finishing','Earthwork'] },
        { key:'unit', label:'Unit', type:'text', required:true, placeholder:'cum / sqm / ton' },
        { key:'qty', label:'Quantity', type:'number', required:true, min:0 },
        { key:'rate', label:'Rate', type:'money', required:true, min:0 }
      ],
      saveLabel:'Add Line',
      onSave: function (v) {
        var qty = +v.qty || 0, rate = +v.rate || 0;
        var r = { id: nextBoqId(), project: v.project, item:(v.item || '').trim(), category: v.category,
          unit:(v.unit || '').trim(), qty: qty, rate: rate, amount: qty * rate, created: TODAY };
        db.save('cn_boq', r);
        ui.toast('BOQ line added · ' + ui.money(r.amount), 'success');
        if (done) done();
        return true;
      }
    });
  }

  /* ============================================================ ID GENERATORS */
  function nextIdNum(store, prefix) {
    var max = 0;
    db.col(store).forEach(function (r) { var n = parseInt(String(r.id).replace(/\D/g, ''), 10); if (!isNaN(n) && n > max) max = n; });
    return max + 1;
  }
  function nextProjectId() { return 'CNP-' + String(nextIdNum('cn_projects', 'CNP')).padStart(3, '0'); }
  function nextWoId() { return 'WO-' + String(nextIdNum('cn_workorders', 'WO')).padStart(3, '0'); }
  function nextBoqId() { return 'BOQ-' + String(nextIdNum('cn_boq', 'BOQ')).padStart(4, '0'); }
  function nextIpcId() { return 'IPC-' + String(nextIdNum('cn_billing', 'IPC')).padStart(3, '0'); }

  /* ============================================================ SHARED HELPERS */
  function kpi(label, value, icon) {
    return el('div.kpi-card', null, [
      el('div.kpi-top', null, [ el('span.kpi-label', { text: label }), el('span.kpi-ico', { html:'<i class="bi bi-' + icon + '"></i>' }) ]),
      el('div.kpi-value', { text: String(value) })
    ]);
  }
  function kv(k, v) { return el('div.field', null, [ el('label', { text: k }), el('div.fw-600', { text: String(v) }) ]); }
  function st2(l, v) { return el('div.stat', null, [ el('div.stat-label', { text: l }), el('div.stat-value', { text: v }) ]); }
  function stageBadge(s) {
    var col = STAGE_COLOR[s] || '#8b93a7';
    var b = el('span.badge', { text: s || '—' });
    b.style.color = col; b.style.background = col + '22';
    return b;
  }
  function tradeBadge(t) {
    var col = TRADE_COLOR[t] || '#8b93a7';
    var b = el('span.badge', { text: t || '—' });
    b.style.color = col; b.style.background = col + '22';
    return b;
  }
  function billStatusBadge(s) {
    var tone = s === 'Paid' ? 'badge-good' : s === 'Submitted' ? 'badge-warn' : s === 'Draft' ? 'badge-bad' : '';
    return el('span.badge' + (tone ? '.' + tone : ''), { text: s || '—' });
  }
  function progressBar(pct, col) {
    pct = Math.max(0, Math.min(100, +pct || 0));
    return '<div style="display:flex;align-items:center;gap:8px">' +
      '<div style="flex:1;height:7px;border-radius:6px;background:rgba(255,255,255,.08);overflow:hidden">' +
      '<div style="width:' + pct + '%;height:100%;background:' + col + '"></div></div>' +
      '<span class="num xs" style="min-width:34px">' + pct + '%</span></div>';
  }
  function shortName(name) {
    if (!name) return '—';
    return String(name).length > 34 ? String(name).slice(0, 33) + '…' : String(name);
  }
  function uniqueProjects(lines) {
    var seen = {}; lines.forEach(function (b) { if (b.project) seen[b.project] = 1; });
    return Object.keys(seen).length;
  }

})(window.EPAL = window.EPAL || {});
