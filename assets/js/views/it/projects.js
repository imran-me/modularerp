/* ============================================================================
 * EPAL GROUP ERP  ·  views/it/projects.js
 * ----------------------------------------------------------------------------
 * EPAL IT SOLUTIONS — the software-house command center. THREE registered views
 * cover the whole delivery + revenue spine and each branches on ctx.subId (the
 * router falls back from `.../roadmap` to `it/projects`):
 *
 *   it/projects
 *     active   (default) → portfolio cards: progress, stage, margin, deadline
 *     sprints            → delivery Kanban by stage (drag to advance) + burn chart
 *     roadmap            → deadline roadmap bucketed by quarter, schedule risk
 *   it/support           → support desk: table + Kanban by status + SLA breach
 *   it/services          → SaaS subscriptions: MRR / churn / renewals + register
 *
 * A project detail drawer carries timesheets (it_timesheets filtered by project —
 * billable vs non-billable hours), stage/progress, milestone invoices and an
 * "Invoice milestone" action that posts revenue through db.postSale('it',…) and
 * opens a branded invoice via EPAL.doc.open — so IT + Group finance and the
 * ledger all move live. Billable-hours are a first-class KPI everywhere.
 *
 * New store (seeded idempotently below, survives db.reset):
 *   it_invoices {id,project,milestone,amount,date,status,saleRef,customer}
 * ==========================================================================*/

(function (EPAL) {
  'use strict';
  var ui = EPAL.ui, el = ui.el, db = EPAL.db, S = EPAL.store;

  var TODAY = '2026-07-05';
  var NOW = new Date('2026-07-05').getTime();
  var CID = 'it';

  var STAGES = ['Discovery', 'Development', 'Testing', 'UAT', 'Live', 'Maintenance'];
  var STAGE_COLOR = {
    Discovery:'#8b93a7', Development:'#7b5cff', Testing:'#2f6bff',
    UAT:'#f4b740', Live:'#23c17e', Maintenance:'#18a0a0'
  };
  var PROJ_TYPES = ['Web', 'ERP', 'Mobile', 'Cloud', 'AMC'];

  var TICKET_STATUS = ['Open', 'In Progress', 'Waiting', 'Resolved', 'Closed'];
  var TICKET_STATUS_COLOR = {
    Open:'#f0506e', 'In Progress':'#2f6bff', Waiting:'#f4b740',
    Resolved:'#23c17e', Closed:'#8b93a7'
  };
  var PRIORITY_COLOR = { Urgent:'#f0506e', High:'#e2721b', Medium:'#2f6bff', Low:'#8b93a7' };
  var PRIORITIES = ['Urgent', 'High', 'Medium', 'Low'];

  var SUB_STATUS = ['Active', 'Past Due', 'Cancelled'];
  var PLANS = ['Basic', 'Pro', 'Enterprise'];

  /* ============================================ IDEMPOTENT STORE SEED */
  EPAL.registerEngine({
    name: 'it-projects-seed',
    seed: function () {
      S.seedOnce('it_invoices', seedInvoices());
    }
  });

  function seedInvoices() {
    return [
      { id:'ITI-0001', project:'ITP-001', milestone:'Discovery & SRS Sign-off', amount:420000, date:'2026-03-12', status:'Paid',      customer:'', saleRef:'' },
      { id:'ITI-0002', project:'ITP-001', milestone:'Module 1 — UAT Delivery',  amount:680000, date:'2026-05-08', status:'Sent',      customer:'', saleRef:'' },
      { id:'ITI-0003', project:'ITP-002', milestone:'Design & Prototype',       amount:350000, date:'2026-04-02', status:'Paid',      customer:'', saleRef:'' },
      { id:'ITI-0004', project:'ITP-003', milestone:'Phase-1 Go-Live',          amount:920000, date:'2026-06-01', status:'Sent',      customer:'', saleRef:'' },
      { id:'ITI-0005', project:'ITP-005', milestone:'Cloud Migration Complete', amount:540000, date:'2026-05-22', status:'Paid',      customer:'', saleRef:'' }
    ];
  }

  /* ============================================ DATA ACCESS */
  function projects() { return db.col('it_projects'); }
  function project(id) { return projects().filter(function (p) { return p.id === id; })[0] || null; }
  function timesheets() { return db.col('it_timesheets'); }
  function tsOf(pid) { return timesheets().filter(function (t) { return t.project === pid; }); }
  function invoicesOf(pid) { return db.col('it_invoices').filter(function (v) { return v.project === pid; }); }

  function billableHours(list) {
    return list.filter(function (t) { return t.billable === 'Yes'; })
      .reduce(function (s, t) { return s + (+t.hours || 0); }, 0);
  }
  function totalHours(list) { return list.reduce(function (s, t) { return s + (+t.hours || 0); }, 0); }
  function invoicedTotal(pid) {
    return invoicesOf(pid).reduce(function (s, v) { return s + (+v.amount || 0); }, 0);
  }
  function collectedTotal(pid) {
    return invoicesOf(pid).filter(function (v) { return v.status === 'Paid'; })
      .reduce(function (s, v) { return s + (+v.amount || 0); }, 0);
  }

  function daysLeft(deadline) {
    if (!deadline) return NaN;
    var a = new Date(deadline).getTime();
    if (isNaN(a)) return NaN;
    return Math.round((a - NOW) / 86400000);
  }
  function people() {
    var e = db.employees({ companyId: CID }).map(function (x) { return x.name; });
    return e.length ? e : ['Ashraful Karim', 'Nasrin Sultana', 'Mahmudul Hasan', 'Farzana Yasmin', 'Kamrul Islam'];
  }

  /* ================================================================ VIEW: PROJECTS */
  EPAL.view('it/projects', {
    render: function (ctx) {
      var sub = ctx.subId || 'active';
      var page = el('div.page');
      var map = { active:'Active Projects', sprints:'Sprints & Delivery', roadmap:'Roadmap' };
      page.appendChild(EPAL.pageHead({
        eyebrow:'IT Solutions › Projects', icon:'kanban-fill',
        title: map[sub] || 'Projects', sub: projSubDesc(sub),
        actions: [
          sub !== 'active' ? el('a.btn.btn-ghost', { href:'#/it/projects/active', html: ui.icon('grid') + ' Portfolio' }) : null,
          el('a.btn.btn-ghost', { href:'#/it/support', html: ui.icon('life-preserver') + ' Support' }),
          el('button.btn.btn-primary', { html: ui.icon('plus-lg') + ' New Project', onclick: function () { editProject(null); } })
        ]
      }));
      ({ active:activeProjects, sprints:sprints, roadmap:roadmap }[sub] || activeProjects)(page, ctx);
      ctx.mount.appendChild(page);
    }
  });

  function projSubDesc(sub) {
    return ({ active:'Live delivery portfolio — progress, stage, margin and deadline countdown per engagement.',
      sprints:'Delivery Kanban across stages — drag to advance a project and track burn.',
      roadmap:'Deadline roadmap bucketed by quarter with schedule-risk flags.' }[sub]) || '';
  }

  /* ============================================================ ACTIVE PROJECTS */
  function activeProjects(page) {
    var host = el('div'); page.appendChild(host);
    function draw() {
      host.innerHTML = '';
      var ps = projects();
      var totVal = 0, totCost = 0, live = 0;
      ps.forEach(function (p) {
        totVal += (+p.value || 0); totCost += (+p.cost || 0);
        if (p.stage === 'Live' || p.stage === 'Maintenance') live++;
      });
      var bh = billableHours(timesheets());
      host.appendChild(el('div.kpi-grid.stagger', null, [
        kpi('Portfolio Value', ui.money(totVal, { compact:true }), 'briefcase-fill'),
        kpi('Delivery Cost', ui.money(totCost, { compact:true }), 'wallet2'),
        kpi('Portfolio Margin', ui.money(totVal - totCost, { compact:true }), 'graph-up-arrow'),
        kpi('Billable Hours', ui.num(bh) + ' h', 'clock-history'),
        kpi('Live / AMC', String(live), 'broadcast-pin')
      ]));

      if (!ps.length) {
        host.appendChild(el('div.empty-state', null, [ ui.frag(ui.icon('kanban')),
          el('h3', { text:'No projects yet' }), el('p.text-muted', { text:'Create your first engagement.' }) ]));
        return;
      }

      host.appendChild(el('div.section-label', { text:'Active Engagements' }));
      var grid = el('div.grid-auto.stagger');
      ps.forEach(function (p) {
        var cost = +p.cost || 0, margin = (+p.value || 0) - cost;
        var mPct = p.value ? Math.round(margin / p.value * 100) : 0;
        var prog = Math.max(0, Math.min(100, +p.progress || 0));
        var dl = daysLeft(p.deadline);
        var dlTone = isNaN(dl) ? '' : dl < 0 ? 'text-bad' : dl < 21 ? 'text-warn' : '';
        var dlLbl = isNaN(dl) ? '—' : (dl < 0 ? Math.abs(dl) + 'd overdue' : dl + 'd left');
        var col = STAGE_COLOR[p.stage] || '#7b5cff';
        grid.appendChild(el('div.card.hover', { style:{ cursor:'pointer' }, onclick: (function (pid) { return function () { projectDrawer(pid, draw); }; })(p.id) }, [
          el('div.card-pad', null, [
            el('div.flex.items-center.gap-2', null, [
              el('div.flex-1', null, [
                el('div.fw-700', { text: shortName(p.name) }),
                el('div.text-muted.sm', { text: (p.client || '—') + ' · ' + p.id + ' · ' + (p.type || '—') })
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
              st2('Cost', ui.money(cost, { compact:true })),
              st2('Margin', ui.money(margin, { compact:true }) + ' · ' + mPct + '%')
            ]),
            el('div.flex.justify-between.items-center.mt-3', null, [
              el('span.text-mute.xs', { html: ui.icon('person-badge') + ' ' + ui.escapeHtml(p.lead || '—') }),
              el('span.badge' + (dlTone === 'text-bad' ? '.badge-bad' : dlTone === 'text-warn' ? '.badge-warn' : ''), { text: dlLbl })
            ])
          ])
        ]));
      });
      host.appendChild(grid);
    }
    draw();
  }

  /* ============================================================ SPRINTS (Kanban) */
  function sprints(page) {
    var search = el('input.input', { placeholder:'Search project, client, lead…', style:{ maxWidth:'320px' },
      oninput: ui.debounce(function () { draw(); }, 150) });
    page.appendChild(el('div.mb-3', null, [ search ]));
    var host = el('div'); page.appendChild(host);

    function draw() {
      host.innerHTML = '';
      var q = (search.value || '').toLowerCase();
      var ps = projects().filter(function (p) {
        return !q || (p.name + ' ' + (p.client || '') + ' ' + (p.lead || '') + ' ' + p.id).toLowerCase().indexOf(q) >= 0;
      });
      var avg = ps.length ? Math.round(ps.reduce(function (s, p) { return s + (+p.progress || 0); }, 0) / ps.length) : 0;
      host.appendChild(el('div.kpi-grid.stagger', null, [
        kpi('In Delivery', String(ps.filter(function (p) { return p.stage === 'Development' || p.stage === 'Testing' || p.stage === 'UAT'; }).length), 'code-slash'),
        kpi('Avg Progress', avg + '%', 'speedometer2'),
        kpi('Live', String(ps.filter(function (p) { return p.stage === 'Live'; }).length), 'broadcast-pin'),
        kpi('Billable Hours', ui.num(billableHours(timesheets())) + ' h', 'clock-history')
      ]));

      var kb = el('div.kanban');
      STAGES.forEach(function (st) {
        var col = ps.filter(function (p) { return p.stage === st; });
        var lst = el('div.kb-list', { 'data-stage': st });
        col.forEach(function (p) { lst.appendChild(projCard(p, draw)); });
        lst.addEventListener('dragover', function (e) { e.preventDefault(); lst.parentNode.classList.add('drag-over'); });
        lst.addEventListener('dragleave', function () { lst.parentNode.classList.remove('drag-over'); });
        lst.addEventListener('drop', function (e) {
          e.preventDefault(); lst.parentNode.classList.remove('drag-over');
          var id = e.dataTransfer.getData('text/plain');
          var p = project(id);
          if (p && p.stage !== st) {
            p.stage = st;
            if (st === 'Live' && (+p.progress || 0) < 100) p.progress = 100;
            db.save('it_projects', p);
            db.notify({ level:'info', title:'Project moved', companyId: CID, icon:'kanban',
              text: shortName(p.name) + ' → ' + st });
            draw();
          }
        });
        kb.appendChild(el('div.kb-col', { style:{ '--kb': STAGE_COLOR[st] } }, [
          el('div.kb-col-head', null, [ el('span.kb-col-dot'),
            el('span.kb-col-title', { text: st }), el('span.kb-count', { text: String(col.length) }) ]),
          lst
        ]));
      });
      host.appendChild(kb);

      // burn chart — value vs invoiced per project
      var cv = ui.uid('c');
      host.appendChild(el('div.card.mt-3', null, [
        el('div.card-head', null, [ el('h3', { html: ui.icon('bar-chart-line-fill') + ' Contract Value vs Invoiced' }) ]),
        el('div.card-body', null, [ el('div', { style:{ height:'280px', position:'relative' } }, [ el('canvas', { id: cv }) ]) ])
      ]));
      requestAnimationFrame(function () {
        var canvas = ui.$('#' + cv); if (!canvas || !EPAL.charts) return;
        EPAL.charts.bar(canvas, {
          labels: ps.map(function (p) { return p.id; }),
          datasets: [
            { label:'Contract Value', data: ps.map(function (p) { return +p.value || 0; }) },
            { label:'Invoiced', data: ps.map(function (p) { return invoicedTotal(p.id); }) }
          ],
          money: true
        });
      });
    }
    draw();
  }

  function projCard(p, refresh) {
    var prog = Math.max(0, Math.min(100, +p.progress || 0));
    var col = STAGE_COLOR[p.stage] || '#7b5cff';
    var card = el('div.kb-card', { draggable:'true', 'data-id':p.id, onclick:function () { projectDrawer(p.id, refresh); } });
    card.addEventListener('dragstart', function (e) { e.dataTransfer.setData('text/plain', p.id); card.classList.add('dragging'); });
    card.addEventListener('dragend', function () { card.classList.remove('dragging'); });
    card.appendChild(el('div.kb-card-title', { style:{ margin:'0 0 4px' }, text: shortName(p.name) }));
    card.appendChild(el('div.text-mute.xs', { text: (p.client || '—') + ' · ' + p.id }));
    card.appendChild(el('div', { style:{ margin:'8px 0 6px', display:'flex', alignItems:'center', gap:'6px' } }, [
      el('div', { style:{ flex:'1', height:'6px', borderRadius:'6px', background:'rgba(255,255,255,.08)', overflow:'hidden' } }, [
        el('div', { style:{ width: prog + '%', height:'100%', background: col } }) ]),
      el('span.num.xs', { text: prog + '%' })
    ]));
    card.appendChild(el('div.kb-card-foot', null, [
      el('span', { html:'<span class="num strong">' + ui.money(p.value, { compact:true }) + '</span>' }),
      el('span.text-mute.xs', { html: ui.icon('person') + ' ' + ui.escapeHtml((p.lead || '—').split(' ')[0]) })
    ]));
    return card;
  }

  /* ============================================================ ROADMAP */
  function roadmap(page) {
    var ps = projects().slice().sort(function (a, b) {
      var da = a.deadline || '9999', db2 = b.deadline || '9999';
      return da < db2 ? -1 : da > db2 ? 1 : 0;
    });
    var upcoming = 0, overdue = 0, live = 0;
    ps.forEach(function (p) {
      var dl = daysLeft(p.deadline);
      if (p.stage === 'Live' || p.stage === 'Maintenance') live++;
      else if (!isNaN(dl) && dl < 0) overdue++;
      else if (!isNaN(dl) && dl <= 30) upcoming++;
    });
    var avg = ps.length ? Math.round(ps.reduce(function (s, p) { return s + (+p.progress || 0); }, 0) / ps.length) : 0;
    page.appendChild(el('div.kpi-grid.stagger', null, [
      kpi('Due ≤ 30 days', String(upcoming), 'calendar-event'),
      kpi('Overdue', String(overdue), 'alarm-fill'),
      kpi('Delivered / Live', String(live), 'flag-fill'),
      kpi('Avg Progress', avg + '%', 'speedometer2')
    ]));

    var buckets = {}, order = [];
    ps.forEach(function (p) {
      var q = quarterOf(p.deadline);
      if (!buckets[q]) { buckets[q] = []; order.push(q); }
      buckets[q].push(p);
    });

    order.forEach(function (q) {
      var list = el('div.data-list');
      buckets[q].forEach(function (p) {
        var prog = Math.max(0, Math.min(100, +p.progress || 0));
        var dl = daysLeft(p.deadline);
        var tone = isNaN(dl) ? '' : dl < 0 ? 'text-bad' : dl <= 30 ? 'text-warn' : '';
        var dlLbl = isNaN(dl) ? 'No deadline' : (dl < 0 ? Math.abs(dl) + 'd overdue' : dl + 'd left');
        var col = STAGE_COLOR[p.stage] || '#7b5cff';
        list.appendChild(el('div.data-row', { style:{ cursor:'pointer', alignItems:'center', gap:'10px', padding:'10px 4px' },
          onclick: (function (pid) { return function () { projectDrawer(pid); }; })(p.id) }, [
          el('div.flex-1', null, [
            el('div.fw-600', { text: shortName(p.name) }),
            el('div.text-mute.xs', { text: (p.client || '—') + ' · ' + p.id + ' · ' + (p.deadline ? ui.date(p.deadline) : '—') })
          ]),
          el('div', { style:{ minWidth:'140px' }, html: progressBar(prog, col) }),
          stageBadge(p.stage),
          el('span.badge' + (tone === 'text-bad' ? '.badge-bad' : tone === 'text-warn' ? '.badge-warn' : ''), { text: dlLbl })
        ]));
      });
      page.appendChild(el('div.card.mt-3', null, [
        el('div.card-head', null, [ el('h3', { html: ui.icon('signpost-split-fill') + ' ' + q }),
          el('span.card-sub', { text: buckets[q].length + ' project' + (buckets[q].length === 1 ? '' : 's') }) ]),
        el('div.card-body', null, [ list ])
      ]));
    });

    if (!ps.length) {
      page.appendChild(el('div.empty-state', null, [ ui.frag(ui.icon('signpost')),
        el('h3', { text:'Nothing scheduled' }), el('p.text-muted', { text:'Create a project with a deadline.' }) ]));
    }
  }

  function quarterOf(dateStr) {
    if (!dateStr) return 'Unscheduled';
    var d = new Date(dateStr);
    if (isNaN(d.getTime())) return 'Unscheduled';
    return d.getFullYear() + ' · Q' + (Math.floor(d.getMonth() / 3) + 1);
  }

  /* ============================================================ PROJECT DRAWER */
  function projectDrawer(id, refresh) {
    var body = el('div');
    var tab = 'time';
    var m = ui.modal({ title:'Project', icon:'kanban', size:'xl', body:body, footer:false });

    function redraw() {
      var p = project(id);
      if (!p) { m.close(); return; }
      body.innerHTML = '';
      var cost = +p.cost || 0, value = +p.value || 0, profit = value - cost;
      var invd = invoicedTotal(id), coll = collectedTotal(id);
      var ts = tsOf(id);

      body.appendChild(el('div.flex.gap-1.flex-wrap.items-center.mb-3', null, [
        el('span', { style:{ fontSize:'17px', fontWeight:'700' }, text: shortName(p.name) }),
        stageBadge(p.stage), el('span.badge', { text: p.id }),
        el('span.badge', { text: (p.type || '—') }),
        el('span.badge', { text: (p.progress || 0) + '% done' })
      ]));

      body.appendChild(el('div.section-label', { text:'Project P&L' }));
      body.appendChild(el('div.stat-row', null, [
        st2('Contract Value', ui.money(value)),
        st2('Delivery Cost', ui.money(cost)),
        st2('Projected Profit', ui.money(profit) + ' · ' + (value ? Math.round(profit / value * 100) : 0) + '%'),
        st2('Invoiced', ui.money(invd)),
        st2('Collected', ui.money(coll))
      ]));
      body.appendChild(el('div.build-banner', { style:{ marginTop:'6px' } }, [ ui.frag(ui.icon('info-circle')),
        el('div', { html:'Billable <strong>' + ui.num(billableHours(ts)) + ' h</strong> of ' + ui.num(totalHours(ts)) +
          ' h logged · Outstanding to invoice: <strong>' + ui.money(Math.max(0, value - invd)) + '</strong>.' }) ]));

      body.appendChild(el('div.form-grid', null, [
        kv('Client', p.client || '—'), kv('Lead', p.lead || '—'),
        kv('Type', p.type || '—'), kv('Deadline', p.deadline ? ui.date(p.deadline) : '—')
      ]));

      var tabs = [['time','Timesheets','clock-history'], ['invoices','Milestone Invoices','receipt']];
      var nav = el('div.flex.gap-1.flex-wrap', { style:{ margin:'14px 0 10px' } });
      tabs.forEach(function (t) {
        nav.appendChild(el('button.btn.btn-sm' + (tab === t[0] ? '.btn-primary' : '.btn-ghost'),
          { html: ui.icon(t[2]) + ' ' + t[1], onclick: (function (k) { return function () { tab = k; redraw(); }; })(t[0]) }));
      });
      body.appendChild(nav);

      var content = el('div');
      body.appendChild(content);
      if (tab === 'time') tabTime(content, p);
      else tabInvoices(content, p);

      body.appendChild(el('div.divider'));
      body.appendChild(el('div.flex.gap-1.flex-wrap', null, [
        el('button.btn.btn-sm.btn-outline', { html: ui.icon('pencil') + ' Edit Project',
          onclick: function () { editProject(p, function () { redraw(); refresh && refresh(); }); } }),
        el('button.btn.btn-sm.btn-primary', { html: ui.icon('receipt') + ' Invoice Milestone',
          onclick: function () { raiseInvoice(p, function () { redraw(); refresh && refresh(); }); } })
      ]));
      if (EPAL.comments && EPAL.comments.widget) {
        body.appendChild(el('div.section-label', { text:'Discussion' }));
        body.appendChild(EPAL.comments.widget('it_project', p.id));
      }
    }

    function tabTime(host, p) {
      var ts = tsOf(p.id);
      host.appendChild(el('div.flex.justify-between.items-center.mb-2', null, [
        el('span.text-mute.sm', { text: ts.length + ' entr' + (ts.length === 1 ? 'y' : 'ies') + ' · ' +
          ui.num(billableHours(ts)) + ' billable / ' + ui.num(totalHours(ts)) + ' total h' }),
        el('button.btn.btn-sm.btn-ghost', { html: ui.icon('plus') + ' Log Time',
          onclick: function () { logTime(p.id, redraw); } })
      ]));
      if (!ts.length) {
        host.appendChild(el('div.empty-state', null, [ ui.frag(ui.icon('clock-history')),
          el('h3', { text:'No time logged' }), el('p.text-muted', { text:'Log the first billable hours.' }) ]));
        return;
      }
      var tbl = EPAL.table({
        columns: [
          { key:'date', label:'Date', date:true },
          { key:'employee', label:'Engineer' },
          { key:'note', label:'Work' },
          { key:'hours', label:'Hours', num:true },
          { key:'billable', label:'Billable', badge:{ Yes:'good', No:'bad' } }
        ],
        rows: ts, searchKeys:['employee','note','date'], exportName:'timesheet-' + p.id + '.csv', pageSize: 8,
        onRow: function (r) { logTime(p.id, redraw, r); },
        empty:{ icon:'clock-history', title:'No time logged', hint:'Log the first billable hours.' }
      });
      host.appendChild(tbl.el);
    }

    function tabInvoices(host, p) {
      var lines = invoicesOf(p.id);
      host.appendChild(el('div.flex.justify-between.items-center.mb-2', null, [
        el('span.text-mute.sm', { text: lines.length + ' invoice' + (lines.length === 1 ? '' : 's') + ' · ' +
          ui.money(invoicedTotal(p.id)) + ' invoiced · ' + ui.money(collectedTotal(p.id)) + ' collected' }),
        el('button.btn.btn-sm.btn-primary', { html: ui.icon('plus') + ' Invoice Milestone',
          onclick: function () { raiseInvoice(p, redraw); } })
      ]));
      if (!lines.length) {
        host.appendChild(el('div.empty-state', null, [ ui.frag(ui.icon('receipt')),
          el('h3', { text:'No invoices' }), el('p.text-muted', { text:'Raise a milestone invoice.' }) ]));
        return;
      }
      var list = el('div.data-list');
      lines.forEach(function (v) {
        list.appendChild(el('div.data-row', { style:{ alignItems:'center', gap:'10px', padding:'10px 4px' } }, [
          el('div.flex-1', null, [
            el('div.fw-600', { text: v.milestone }),
            el('div.text-mute.xs', { text: v.id + ' · ' + (v.date ? ui.date(v.date) : '—') })
          ]),
          el('div', { style:{ textAlign:'right' } }, [
            el('div.num.strong', { text: ui.money(v.amount) }),
            invStatusBadge(v.status)
          ]),
          v.status === 'Sent'
            ? el('button.btn.btn-sm.btn-outline', { html: ui.icon('cash') + ' Mark Paid',
                onclick: (function (vid) { return function () { var cur = invLine(vid); if (cur) { cur.status = 'Paid'; db.save('it_invoices', cur); ui.toast('Invoice marked paid', 'success'); redraw(); refresh && refresh(); } }; })(v.id) })
            : el('button.btn.btn-sm.btn-outline', { html: ui.icon('printer') + ' Invoice',
                onclick: (function (vid) { return function () { openInvoiceDoc(invLine(vid), p); }; })(v.id) })
        ]));
      });
      host.appendChild(list);
    }

    redraw();
  }

  function invLine(id) { return db.col('it_invoices').filter(function (v) { return v.id === id; })[0] || null; }

  /* --- Invoice milestone: post revenue + branded invoice ------------------ */
  function raiseInvoice(p, done) {
    var outstanding = Math.max(0, (+p.value || 0) - invoicedTotal(p.id));
    EPAL.formModal({
      title:'Invoice Milestone · ' + p.id, icon:'receipt', size:'md',
      fields: [
        { key:'milestone', label:'Milestone / description', type:'text', required:true, col2:true, placeholder:'e.g. Module 2 — UAT Delivery' },
        { key:'amount', label:'Amount (BDT)', type:'money', required:true, min:1, default: outstanding || 100000 },
        { key:'date', label:'Invoice date', type:'date', default: TODAY }
      ],
      saveLabel:'Post & Generate Invoice',
      onSave: function (v) {
        var amount = +v.amount || 0;
        if (amount <= 0) { ui.toast('Amount must be greater than zero', 'error'); return false; }
        var inv = {
          id: nextInvId(), project: p.id, milestone:(v.milestone || '').trim(),
          amount: amount, date: v.date || TODAY, status:'Sent',
          customer: p.client || '', saleRef:''
        };
        var sale = db.postSale(CID, {
          amount: amount, cost: 0, ref: inv.id,
          desc:'Invoice ' + inv.milestone + ' · ' + p.id,
          customer: p.client || shortName(p.name)
        });
        inv.saleRef = sale.id;
        db.save('it_invoices', inv);
        db.notify({ level:'success', title:'Invoice Raised', companyId: CID, icon:'receipt',
          text: inv.id + ' · ' + (p.client || '—') + ' · ' + ui.money(amount) });
        ui.toast('Invoice ' + inv.id + ' posted · ' + ui.money(amount), 'success');
        openInvoiceDoc(inv, p);
        if (done) done();
        return true;
      }
    });
  }

  function openInvoiceDoc(v, p) {
    if (!v) return;
    if (!EPAL.doc || !EPAL.doc.open) { ui.toast('Document engine unavailable', 'error'); return; }
    EPAL.doc.open({
      type:'invoice', title:'Tax Invoice', serial: EPAL.doc.numberFor('invoice'),
      badge: v.status, watermark:'INVOICE',
      parties: [
        { label:'Bill To', lines:[ p.client || '—', 'Project ' + p.id, shortName(p.name) ] },
        { label:'From', lines:[ 'Epal IT Solutions', 'Gulshan-2, Dhaka', 'Software & Cloud Services' ] }
      ],
      meta: [
        { label:'Invoice No', value: v.id },
        { label:'Milestone', value: v.milestone },
        { label:'Project', value: p.id },
        { label:'Date', value: ui.date(v.date || TODAY) }
      ],
      columns: [ { key:'k', label:'Description' }, { key:'v', label:'Amount (BDT)', num:true, money:true } ],
      rows: [ { k: v.milestone + ' — ' + (p.type || 'Services') + ' engagement', v: +v.amount || 0 } ],
      totals: [
        { label:'Subtotal', value: ui.money(v.amount) },
        { label:'Amount Payable', value: ui.money(v.amount), grand:true }
      ],
      words: EPAL.doc.amountInWords ? EPAL.doc.amountInWords(+v.amount || 0) : '',
      terms:'Payment due within 15 days of invoice date. Please quote the invoice number on remittance. Thank you for your business.',
      sign:'For Epal IT Solutions'
    });
  }

  /* --- Log time ----------------------------------------------------------- */
  function logTime(projectId, done, rec) {
    var isNew = !rec;
    EPAL.formModal({
      title: isNew ? 'Log Time' : 'Edit Timesheet', icon:'clock-history', size:'md',
      record: rec || {},
      fields: [
        { key:'employee', label:'Engineer', type:'select', required:true, optionsFrom: people },
        { key:'date', label:'Date', type:'date', required:true, default: TODAY },
        { key:'hours', label:'Hours', type:'number', required:true, min:0.5, step:0.5, default:4 },
        { key:'billable', label:'Billable', type:'select', options:['Yes', 'No'], default:'Yes' },
        { key:'note', label:'Work note', type:'text', col2:true, placeholder:'e.g. API development' }
      ],
      saveLabel: isNew ? 'Log Time' : 'Save',
      onSave: function (v, record) {
        var r = record && record.id ? record : { id: nextTsId(), project: projectId, created: TODAY };
        r.project = r.project || projectId;
        r.employee = v.employee;
        r.date = v.date || TODAY;
        r.hours = +v.hours || 0;
        r.billable = v.billable || 'Yes';
        r.note = (v.note || '').trim();
        db.save('it_timesheets', r);
        ui.toast('Time logged · ' + r.hours + ' h', 'success');
        if (done) done();
        return true;
      }
    });
  }

  /* --- Project form ------------------------------------------------------- */
  function editProject(rec, done) {
    var isNew = !rec;
    EPAL.formModal({
      title: isNew ? 'New Project' : 'Edit Project', icon:'kanban', size:'lg',
      record: rec || {},
      fields: [
        { type:'section', label:'Engagement' },
        { key:'name', label:'Project name', type:'text', required:true, col2:true, placeholder:'e.g. ERP System — Bashundhara Group' },
        { key:'client', label:'Client', type:'text', required:true, placeholder:'e.g. Square Pharmaceuticals' },
        { key:'type', label:'Type', type:'select', options: PROJ_TYPES, default:'Web' },
        { type:'section', label:'Commercials' },
        { key:'value', label:'Contract value', type:'money', required:true, min:1 },
        { key:'cost', label:'Delivery cost', type:'money', min:0, default:0 },
        { key:'stage', label:'Stage', type:'select', options: STAGES, default:'Discovery' },
        { key:'progress', label:'Progress %', type:'number', min:0, max:100, default:0 },
        { type:'section', label:'Delivery' },
        { key:'lead', label:'Project lead', type:'select', optionsFrom: people },
        { key:'deadline', label:'Deadline', type:'date' }
      ],
      saveLabel: isNew ? 'Create Project' : 'Save',
      onSave: function (v, record) {
        var r = record && record.id ? record : { id: nextProjectId(), created: TODAY };
        r.name = (v.name || '').trim();
        r.client = (v.client || '').trim();
        r.type = v.type || 'Web';
        r.value = +v.value || 0;
        r.cost = +v.cost || 0;
        r.stage = v.stage || 'Discovery';
        r.progress = Math.max(0, Math.min(100, +v.progress || 0));
        r.lead = v.lead || '';
        r.deadline = v.deadline || '';
        db.save('it_projects', r);
        ui.toast('Project ' + r.id + ' saved', 'success');
        if (done) done(); else EPAL.router.render();
        return true;
      }
    });
  }

  /* ================================================================ VIEW: SUPPORT */
  EPAL.view('it/support', {
    render: function (ctx) {
      var page = el('div.page');
      page.appendChild(EPAL.pageHead({
        eyebrow:'IT Solutions › Support', icon:'life-preserver',
        title:'Support Desk', sub:'Client tickets, SLA tracking and a live status board — breaches flagged against ' + ui.date(TODAY) + '.',
        actions: [
          el('a.btn.btn-ghost', { href:'#/it/projects/active', html: ui.icon('kanban') + ' Projects' }),
          el('button.btn.btn-primary', { html: ui.icon('plus-lg') + ' New Ticket', onclick: function () { editTicket(null); } })
        ]
      }));
      var host = el('div'); page.appendChild(host);

      function draw() {
        host.innerHTML = '';
        var all = db.col('it_tickets');
        var open = all.filter(isOpen);
        var breached = all.filter(isBreached);
        var urgent = open.filter(function (t) { return t.priority === 'Urgent'; });
        var resolved = all.filter(function (t) { return t.status === 'Resolved' || t.status === 'Closed'; });
        host.appendChild(el('div.kpi-grid.stagger', null, [
          kpi('Open Tickets', String(open.length), 'envelope-open'),
          kpi('SLA Breaches', String(breached.length), 'exclamation-triangle-fill'),
          kpi('Urgent Open', String(urgent.length), 'fire'),
          kpi('Resolved', String(resolved.length), 'check2-circle')
        ]));

        // Kanban by status
        var kb = el('div.kanban');
        TICKET_STATUS.forEach(function (st) {
          var col = all.filter(function (t) { return t.status === st; });
          var lst = el('div.kb-list', { 'data-stage': st });
          col.forEach(function (t) { lst.appendChild(ticketCard(t, draw)); });
          lst.addEventListener('dragover', function (e) { e.preventDefault(); lst.parentNode.classList.add('drag-over'); });
          lst.addEventListener('dragleave', function () { lst.parentNode.classList.remove('drag-over'); });
          lst.addEventListener('drop', function (e) {
            e.preventDefault(); lst.parentNode.classList.remove('drag-over');
            var id = e.dataTransfer.getData('text/plain');
            var t = ticket(id);
            if (t && t.status !== st) {
              t.status = st; db.save('it_tickets', t);
              if (st === 'Resolved') db.notify({ level:'success', title:'Ticket Resolved', companyId: CID, icon:'check-circle-fill', text: t.id + ' · ' + shortName(t.subject) });
              draw();
            }
          });
          kb.appendChild(el('div.kb-col', { style:{ '--kb': TICKET_STATUS_COLOR[st] } }, [
            el('div.kb-col-head', null, [ el('span.kb-col-dot'),
              el('span.kb-col-title', { text: st }), el('span.kb-count', { text: String(col.length) }) ]),
            lst
          ]));
        });
        host.appendChild(el('div.section-label', { text:'Status Board' }));
        host.appendChild(kb);

        // Table
        var tbl = EPAL.table({
          columns: [
            { key:'id', label:'Ticket', render:function (r) { return '<span class="strong">' + ui.escapeHtml(r.id) + '</span>'; } },
            { key:'subject', label:'Subject' },
            { key:'client', label:'Client' },
            { key:'priority', label:'Priority', render:function (r) { return priorityBadge(r.priority).outerHTML; } },
            { key:'assignee', label:'Assignee' },
            { key:'slaHours', label:'SLA', num:true, render:function (r) { return r.slaHours + 'h'; } },
            { key:'sla', label:'SLA Status', sortVal:function (r) { return slaRemaining(r); },
              render:function (r) {
                if (!isOpen(r)) return '<span class="badge">Closed</span>';
                if (isBreached(r)) return '<span class="badge badge-bad">Breached</span>';
                var rem = Math.round(slaRemaining(r) / 3600000);
                return '<span class="badge badge-good">' + rem + 'h left</span>';
              } },
            { key:'status', label:'Status', badge:{ Open:'bad', 'In Progress':'', Waiting:'warn', Resolved:'good', Closed:'' } }
          ],
          rows: function () { return db.col('it_tickets'); },
          searchKeys:['id','subject','client','assignee'],
          filters:[{ key:'priority', label:'Priority' }, { key:'status', label:'Status' }],
          onRow: function (r) { ticketDrawer(r.id, draw); },
          exportName:'it-support-tickets.csv', pageSize: 15,
          empty:{ icon:'life-preserver', title:'No tickets', hint:'Raise the first support ticket.' }
        });
        host.appendChild(el('div.card.mt-3', null, [
          el('div.card-head', null, [ el('h3', { html: ui.icon('inbox-fill') + ' Ticket Queue' }),
            el('span.card-sub', { text:'Breached SLA rows are highlighted' }) ]),
          el('div.card-body', null, [ tbl.el ])
        ]));
      }
      draw();
      ctx.mount.appendChild(page);
    }
  });

  function ticket(id) { return db.col('it_tickets').filter(function (t) { return t.id === id; })[0] || null; }
  function ticketDue(t) { return new Date(t.created).getTime() + (+t.slaHours || 0) * 3600000; }
  function isOpen(t) { return ['Resolved', 'Closed'].indexOf(t.status) < 0; }
  function isBreached(t) { return isOpen(t) && ticketDue(t) < NOW; }
  function slaRemaining(t) { return ticketDue(t) - NOW; }

  function ticketCard(t, refresh) {
    var breached = isBreached(t);
    var card = el('div.kb-card', { draggable:'true', 'data-id':t.id, onclick:function () { ticketDrawer(t.id, refresh); } });
    card.addEventListener('dragstart', function (e) { e.dataTransfer.setData('text/plain', t.id); card.classList.add('dragging'); });
    card.addEventListener('dragend', function () { card.classList.remove('dragging'); });
    if (breached) card.style.borderLeft = '3px solid #f0506e';
    card.appendChild(el('div.flex.items-center.gap-1.mb-1', null, [
      priorityDot(t.priority),
      el('span.kb-card-title', { style:{ margin:0 }, text: shortName(t.subject) })
    ]));
    card.appendChild(el('div.text-mute.xs', { text: (t.client || '—') + ' · ' + t.id }));
    card.appendChild(el('div.kb-card-foot', null, [
      el('span.text-mute.xs', { html: ui.icon('person') + ' ' + ui.escapeHtml((t.assignee || '—').split(' ')[0]) }),
      breached ? el('span.badge.badge-bad', { text:'SLA breach' }) : el('span.badge', { text: t.slaHours + 'h SLA' })
    ]));
    return card;
  }

  function ticketDrawer(id, refresh) {
    var t = ticket(id);
    if (!t) return;
    var body = el('div');
    var m = ui.modal({ title:'Ticket ' + t.id, icon:'life-preserver', size:'md', body:body, footer:false });
    function redraw() {
      var cur = ticket(id);
      if (!cur) { m.close(); return; }
      body.innerHTML = '';
      body.appendChild(el('div.flex.gap-1.flex-wrap.mb-3', null, [
        priorityBadge(cur.priority), el('span.badge', { text: cur.status }),
        isBreached(cur) ? el('span.badge.badge-bad', { text:'SLA Breached' }) : el('span.badge.badge-good', { text:'Within SLA' })
      ]));
      body.appendChild(el('div.form-grid', null, [
        kv('Subject', cur.subject), kv('Client', cur.client || '—'),
        kv('Assignee', cur.assignee || '—'), kv('Priority', cur.priority || '—'),
        kv('SLA', cur.slaHours + ' hours'), kv('Raised', cur.created ? ui.date(cur.created) : '—'),
        kv('SLA Due', ui.date(new Date(ticketDue(cur)).toISOString().slice(0, 10)))
      ]));
      body.appendChild(el('div.divider'));
      var statusSel = el('select.select', { style:{ width:'auto' }, onchange: function () {
        var c = ticket(id); c.status = statusSel.value; db.save('it_tickets', c); redraw(); refresh && refresh();
      } });
      TICKET_STATUS.forEach(function (s) { var o = el('option', { value:s, text:'Status → ' + s }); if (s === cur.status) o.selected = true; statusSel.appendChild(o); });
      body.appendChild(el('div.flex.gap-1.flex-wrap', null, [
        statusSel,
        el('button.btn.btn-sm.btn-outline', { html: ui.icon('pencil') + ' Edit',
          onclick: function () { editTicket(cur, function () { redraw(); refresh && refresh(); }); } }),
        cur.status !== 'Resolved' ? el('button.btn.btn-sm.btn-primary', { html: ui.icon('check-lg') + ' Resolve',
          onclick: function () { var c = ticket(id); c.status = 'Resolved'; db.save('it_tickets', c); ui.toast('Ticket resolved', 'success'); redraw(); refresh && refresh(); } }) : null
      ]));
      if (EPAL.comments && EPAL.comments.widget) {
        body.appendChild(el('div.section-label', { text:'Discussion' }));
        body.appendChild(EPAL.comments.widget('it_ticket', cur.id));
      }
    }
    redraw();
  }

  function editTicket(rec, done) {
    var isNew = !rec;
    EPAL.formModal({
      title: isNew ? 'New Ticket' : 'Edit Ticket', icon:'life-preserver', size:'md',
      record: rec || {},
      fields: [
        { key:'subject', label:'Subject', type:'text', required:true, col2:true, placeholder:'e.g. Payment gateway error' },
        { key:'client', label:'Client', type:'text', required:true, placeholder:'e.g. ACI Limited' },
        { key:'priority', label:'Priority', type:'select', options: PRIORITIES, default:'Medium' },
        { key:'assignee', label:'Assignee', type:'select', optionsFrom: people },
        { key:'slaHours', label:'SLA (hours)', type:'select', options:['4', '8', '24', '48'], default:'24' },
        { key:'status', label:'Status', type:'select', options: TICKET_STATUS, default:'Open' }
      ],
      saveLabel: isNew ? 'Create Ticket' : 'Save',
      onSave: function (v, record) {
        var r = record && record.id ? record : { id: nextTicketId(), created: TODAY };
        r.subject = (v.subject || '').trim();
        r.client = (v.client || '').trim();
        r.priority = v.priority || 'Medium';
        r.assignee = v.assignee || '';
        r.slaHours = +v.slaHours || 24;
        r.status = v.status || 'Open';
        db.save('it_tickets', r);
        ui.toast('Ticket ' + r.id + ' saved', 'success');
        if (done) done(); else EPAL.router.render();
        return true;
      }
    });
  }

  /* ================================================================ VIEW: SERVICES */
  EPAL.view('it/services', {
    render: function (ctx) {
      var page = el('div.page');
      page.appendChild(EPAL.pageHead({
        eyebrow:'IT Solutions › Services', icon:'cloud-fill',
        title:'Managed Services & SaaS', sub:'Recurring revenue book — MRR, churn, renewals due and the subscription register.',
        actions: [
          el('a.btn.btn-ghost', { href:'#/it/projects/active', html: ui.icon('kanban') + ' Projects' }),
          el('button.btn.btn-primary', { html: ui.icon('plus-lg') + ' Add Subscription', onclick: function () { editSubscription(null); } })
        ]
      }));
      var host = el('div'); page.appendChild(host);

      function draw() {
        host.innerHTML = '';
        var all = db.col('it_subscriptions');
        var active = all.filter(function (s) { return s.status === 'Active'; });
        var cancelled = all.filter(function (s) { return s.status === 'Cancelled'; });
        var mrr = active.reduce(function (s, x) { return s + (+x.mrr || 0); }, 0);
        var churnRate = all.length ? Math.round(cancelled.length / all.length * 100) : 0;
        var renewals = all.filter(function (s) {
          if (s.status === 'Cancelled') return false;
          var d = daysLeft(s.renewal);
          return !isNaN(d) && d >= 0 && d <= 30;
        }).sort(function (a, b) { return (a.renewal || '') < (b.renewal || '') ? -1 : 1; });

        host.appendChild(el('div.kpi-grid.stagger', null, [
          kpi('MRR', ui.money(mrr, { compact:true }), 'arrow-repeat'),
          kpi('ARR', ui.money(mrr * 12, { compact:true }), 'graph-up-arrow'),
          kpi('Active Subs', String(active.length), 'cloud-check'),
          kpi('Churn Rate', churnRate + '%', 'cloud-slash'),
          kpi('Renewals ≤ 30d', String(renewals.length), 'calendar-check')
        ]));

        // Renewals due list
        var rl = el('div.data-list');
        if (!renewals.length) {
          rl.appendChild(el('div.data-row', null, [ el('span.text-mute.sm', { text:'No renewals due in the next 30 days.' }) ]));
        } else {
          renewals.forEach(function (s) {
            var d = daysLeft(s.renewal);
            rl.appendChild(el('div.data-row', { style:{ cursor:'pointer', alignItems:'center', gap:'10px', padding:'10px 4px' },
              onclick: (function (sid) { return function () { var r = subscription(sid); if (r) editSubscription(r, draw); }; })(s.id) }, [
              el('div.flex-1', null, [
                el('div.fw-600', { text: s.product }),
                el('div.text-mute.xs', { text: (s.client || '—') + ' · ' + s.plan + ' · ' + s.id })
              ]),
              el('div.num.strong', { text: ui.money(s.mrr) + '/mo' }),
              el('span.badge' + (d <= 7 ? '.badge-bad' : '.badge-warn'), { text: ui.date(s.renewal) + ' · ' + d + 'd' })
            ]));
          });
        }
        host.appendChild(el('div.card.mt-3', null, [
          el('div.card-head', null, [ el('h3', { html: ui.icon('calendar-check-fill') + ' Renewals Due' }),
            el('span.card-sub', { text:'Next 30 days — reach out before they lapse' }) ]),
          el('div.card-body', null, [ rl ])
        ]));

        // Subscription register
        var tbl = EPAL.table({
          columns: [
            { key:'id', label:'Ref', render:function (r) { return '<span class="strong">' + ui.escapeHtml(r.id) + '</span>'; } },
            { key:'product', label:'Product' },
            { key:'client', label:'Client' },
            { key:'plan', label:'Plan', render:function (r) { return '<span class="badge">' + ui.escapeHtml(r.plan || '—') + '</span>'; } },
            { key:'mrr', label:'MRR', num:true, money:true },
            { key:'startDate', label:'Started', date:true },
            { key:'renewal', label:'Renews', render:function (r) {
                var d = daysLeft(r.renewal);
                var tone = isNaN(d) ? '' : d < 0 ? 'text-bad' : d <= 30 ? 'text-warn' : '';
                return '<span class="' + tone + '">' + (r.renewal ? ui.date(r.renewal) : '—') + '</span>'; },
              sortVal:function (r) { var d = daysLeft(r.renewal); return isNaN(d) ? 99999 : d; } },
            { key:'status', label:'Status', badge:{ Active:'good', 'Past Due':'warn', Cancelled:'bad' } }
          ],
          rows: function () { return db.col('it_subscriptions'); },
          searchKeys:['id','product','client','plan'],
          filters:[{ key:'plan', label:'Plan' }, { key:'status', label:'Status' }],
          onRow: function (r) { editSubscription(r, draw); },
          exportName:'it-subscriptions.csv', pageSize: 15,
          empty:{ icon:'cloud', title:'No subscriptions', hint:'Add the first recurring service.' }
        });
        host.appendChild(el('div.card.mt-3', null, [
          el('div.card-head', null, [ el('h3', { html: ui.icon('cloud-fill') + ' Subscription Register' }),
            el('span.card-sub', { text: all.length + ' subscription' + (all.length === 1 ? '' : 's') + ' · ' + ui.money(mrr) + ' MRR' }) ]),
          el('div.card-body', null, [ tbl.el ])
        ]));
      }
      draw();
      ctx.mount.appendChild(page);
    }
  });

  function subscription(id) { return db.col('it_subscriptions').filter(function (s) { return s.id === id; })[0] || null; }

  function editSubscription(rec, done) {
    var isNew = !rec;
    EPAL.formModal({
      title: isNew ? 'Add Subscription' : 'Edit Subscription', icon:'cloud', size:'md',
      record: rec || {},
      fields: [
        { key:'product', label:'Product', type:'select', required:true, options:['Epal HRM Cloud', 'Epal POS', 'Epal School Suite', 'Hosting + Care Plan', 'Epal Books'] },
        { key:'client', label:'Client', type:'text', required:true, placeholder:'e.g. PRAN-RFL Group' },
        { key:'plan', label:'Plan', type:'select', options: PLANS, default:'Pro' },
        { key:'mrr', label:'MRR (BDT/month)', type:'money', required:true, min:1 },
        { key:'startDate', label:'Start date', type:'date', default: TODAY },
        { key:'renewal', label:'Renewal date', type:'date' },
        { key:'status', label:'Status', type:'select', options: SUB_STATUS, default:'Active' }
      ],
      saveLabel: isNew ? 'Add Subscription' : 'Save',
      onSave: function (v, record) {
        var r = record && record.id ? record : { id: nextSubId(), created: TODAY };
        r.product = v.product || 'Epal HRM Cloud';
        r.client = (v.client || '').trim();
        r.plan = v.plan || 'Pro';
        r.mrr = +v.mrr || 0;
        r.startDate = v.startDate || TODAY;
        r.renewal = v.renewal || '';
        r.status = v.status || 'Active';
        db.save('it_subscriptions', r);
        ui.toast('Subscription ' + r.id + ' saved', 'success');
        if (done) done(); else EPAL.router.render();
        return true;
      }
    });
  }

  /* ============================================================ ID GENERATORS */
  function nextIdNum(store) {
    var max = 0;
    db.col(store).forEach(function (r) { var n = parseInt(String(r.id).replace(/\D/g, ''), 10); if (!isNaN(n) && n > max) max = n; });
    return max + 1;
  }
  function nextProjectId() { return 'ITP-' + String(nextIdNum('it_projects')).padStart(3, '0'); }
  function nextInvId() { return 'ITI-' + String(nextIdNum('it_invoices')).padStart(4, '0'); }
  function nextTsId() { return 'TS-' + String(nextIdNum('it_timesheets')).padStart(4, '0'); }
  function nextTicketId() { return 'TIC-' + String(nextIdNum('it_tickets')).padStart(4, '0'); }
  function nextSubId() { return 'SUB-' + String(nextIdNum('it_subscriptions')).padStart(3, '0'); }

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
  function priorityBadge(p) {
    var col = PRIORITY_COLOR[p] || '#8b93a7';
    var b = el('span.badge', { text: p || '—' });
    b.style.color = col; b.style.background = col + '22';
    return b;
  }
  function priorityDot(p) {
    var col = PRIORITY_COLOR[p] || '#8b93a7';
    return el('span', { style:{ width:'8px', height:'8px', borderRadius:'50%', background: col, display:'inline-block', flex:'0 0 auto' } });
  }
  function invStatusBadge(s) {
    var tone = s === 'Paid' ? 'badge-good' : s === 'Sent' ? 'badge-warn' : '';
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
    return String(name).length > 40 ? String(name).slice(0, 39) + '…' : String(name);
  }

})(window.EPAL = window.EPAL || {});
