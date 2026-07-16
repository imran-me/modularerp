/* ============================================================================
 * EPAL GROUP ERP  ·  views/woodart/projects.js
 * ----------------------------------------------------------------------------
 * WOODART INTERIORS — the design-build command center. TWO registered views
 * cover the full project spine; each branches on ctx.subId (the router falls
 * back from `.../gallery` to `woodart/projects`):
 *
 *   woodart/projects
 *     active     (default) → portfolio cards: stage, progress, margin, deadline
 *     design                → Design Studio — stage pipeline board (drag to advance)
 *     milestones            → production / install milestones + billing ledger
 *     gallery               → visual portfolio wall of every project
 *   woodart/estimates
 *     quotations (default)  → estimate ledger (add/edit BOM, Approve→Project, Quote)
 *     boq                   → aggregated bill-of-materials across estimates
 *     costing               → margin / cost analysis
 *
 * The project detail drawer carries four tabs — ESTIMATE / BOM (wa_estimates),
 * PRODUCTION jobs (wa_production: station/assignedTo/status), INSTALL & SNAGS
 * (wa_installs: site/team/status/snag checklist) and BILLING. "Bill on Handover"
 * posts revenue through db.postSale('woodart',…) once the stage reaches Handover
 * and opens a branded invoice via EPAL.doc.open — so Woodart + Group finance and
 * the ledger all move live. Per-project profit = value - cost.
 *
 * Stores are seeded by core/seed-bd.js (wa_projects, wa_estimates, wa_production,
 * wa_installs). This file NEVER re-seeds them; it reads/writes via EPAL.db so
 * every mutation emits events and keeps the group in sync.
 * ==========================================================================*/

(function (EPAL) {
  'use strict';
  var ui = EPAL.ui, el = ui.el, db = EPAL.db, S = EPAL.store;

  var TODAY = '2026-07-05';
  var CID = 'woodart';

  var STAGES = ['Design', 'Production', 'Installation', 'Handover', 'Completed'];
  var STAGE_COLOR = {
    Design:'#7b5cff', Production:'#2f6bff', Installation:'#f4b740',
    Handover:'#1A43BF', Completed:'#23c17e'
  };
  var TYPE_COLOR = {
    Residential:'#6f9c1c', Office:'#2f6bff', Retail:'#e0356e', Restaurant:'#e2721b'
  };
  var TYPES = ['Residential', 'Office', 'Retail', 'Restaurant'];
  var STATIONS = ['CNC', 'Cutting', 'Edge Banding', 'Assembly', 'Finishing'];
  var JOB_STATUS = ['Queued', 'Running', 'Done', 'Blocked'];
  var INSTALL_STATUS = ['Scheduled', 'In Progress', 'Snagging', 'Handover'];
  var EST_STATUS = ['Draft', 'Sent', 'Approved', 'Rejected'];

  /* ============================================ DATA ACCESS */
  function projects() { return db.col('wa_projects'); }
  function project(id) { return projects().filter(function (p) { return p.id === id; })[0] || null; }
  function estimates() { return db.col('wa_estimates'); }
  function estimate(id) { return estimates().filter(function (e) { return e.id === id; })[0] || null; }
  function productionOf(id) { return db.col('wa_production').filter(function (w) { return w.project === id; }); }
  function installsOf(id) { return db.col('wa_installs').filter(function (w) { return w.project === id; }); }
  function estimatesOf(id) { return estimates().filter(function (e) { return e.projectId === id; }); }

  function profitOf(p) { return (+p.value || 0) - (+p.cost || 0); }
  function snagCount(ins) { return ins.snagList ? ins.snagList.filter(function (s) { return !s.done; }).length : (+ins.snags || 0); }
  function estValue(e) {
    if (e.lines && e.lines.length) return e.lines.reduce(function (s, l) { return s + (+l.qty || 0) * (+l.unitSale || 0); }, 0);
    return +e.value || 0;
  }
  function estCost(e) {
    if (e.lines && e.lines.length) return e.lines.reduce(function (s, l) { return s + (+l.qty || 0) * (+l.unitCost || 0); }, 0);
    return +e.cost || Math.round((+e.value || 0) * 0.65);
  }

  function daysLeft(deadline) {
    if (!deadline) return NaN;
    var a = new Date(deadline).getTime(), b = new Date(TODAY).getTime();
    if (isNaN(a)) return NaN;
    return Math.round((a - b) / 86400000);
  }
  function designers() {
    var e = db.employees({ companyId: CID }).map(function (x) { return x.name; });
    return e.length ? e : ['Nasrin Sultana', 'Farzana Yasmin', 'Touhidul Alam', 'Sharmin Jahan'];
  }

  /* ================================================================ VIEW: PROJECTS */
  // Section bands — labels mirror the registry (config.js subs); each module's
  // default section owns its bare route. This file registers TWO views
  // (projects + estimates), so each gets its own band.
  var PROJECT_SECTIONS = [['active', 'Active Projects'], ['design', 'Design Studio'], ['milestones', 'Milestones'], ['gallery', 'Gallery']];
  function projectsNav(sub) {
    var nav = el('div.tab-underline.mb-3');
    PROJECT_SECTIONS.forEach(function (s) {
      nav.appendChild(el('button' + (sub === s[0] ? '.active' : ''), { text: s[1],
        onclick: function () { EPAL.router.navigate('woodart/projects' + (s[0] === 'active' ? '' : '/' + s[0])); } }));
    });
    return nav;
  }
  var ESTIMATE_SECTIONS = [['quotations', 'Quotations'], ['boq', 'Bill of Materials'], ['costing', 'Costing']];
  function estimatesNav(sub) {
    var nav = el('div.tab-underline.mb-3');
    ESTIMATE_SECTIONS.forEach(function (s) {
      nav.appendChild(el('button' + (sub === s[0] ? '.active' : ''), { text: s[1],
        onclick: function () { EPAL.router.navigate('woodart/estimates' + (s[0] === 'quotations' ? '' : '/' + s[0])); } }));
    });
    return nav;
  }

  EPAL.view('woodart/projects', {
    render: function (ctx) {
      var sub = ctx.subId || 'active';
      var page = el('div.page');
      var map = { active:'Active Projects', design:'Design Studio', milestones:'Milestones & Billing', gallery:'Gallery' };
      page.appendChild(EPAL.pageHead({
        eyebrow:'Woodart › Projects', icon:'easel2-fill',
        title: map[sub] || 'Projects', sub: subDesc(sub),
        actions: [
          // 'Portfolio' is gone — it only jumped to the 'active' SECTION, which
          // the band below carries. Estimates points at a DIFFERENT module and
          // New Project is a real action, so both stay buttons (house grammar).
          el('a.btn.btn-ghost', { href:'#/woodart/estimates/quotations', html: ui.icon('calculator') + ' Estimates' }),
          el('button.btn.btn-primary', { html: ui.icon('plus-lg') + ' New Project', onclick: function () { editProject(null); } })
        ]
      }));
      // SECTION NAV — the house full-bleed underline band (owner grammar 2026-07-15)
      page.appendChild(projectsNav(sub));
      ({ active:activeSites, design:designStudio, milestones:milestones, gallery:gallery }[sub] || activeSites)(page, ctx);
      ctx.mount.appendChild(page);
    }
  });

  function subDesc(sub) {
    return ({ active:'Live portfolio — stage, progress, margin and deadline countdown per fit-out.',
      design:'Design-build pipeline board — drag a project card to advance its stage.',
      milestones:'Production and installation milestones, snag status and client billing ledger.',
      gallery:'Visual portfolio wall — every Woodart interior at a glance.' }[sub]) || '';
  }

  /* ============================================================ ACTIVE SITES */
  function activeSites(page) {
    var host = el('div'); page.appendChild(host);
    function draw() {
      host.innerHTML = '';
      var ps = projects();
      var totVal = 0, totCost = 0, atRisk = 0, live = 0;
      ps.forEach(function (p) {
        totVal += (+p.value || 0); totCost += (+p.cost || 0);
        if (p.stage !== 'Completed' && p.stage !== 'Handover') live++;
        var dl = daysLeft(p.deadline);
        if ((+p.progress || 0) < 100 && !isNaN(dl) && dl < 30 && p.stage !== 'Handover' && p.stage !== 'Completed') atRisk++;
      });
      host.appendChild(el('div.kpi-grid.stagger', null, [
        kpi('Portfolio Value', ui.money(totVal, { compact:true }), 'easel2'),
        kpi('Committed Cost', ui.money(totCost, { compact:true }), 'wallet2'),
        kpi('Portfolio Margin', ui.money(totVal - totCost, { compact:true }), 'graph-up-arrow'),
        kpi('Live Projects', String(live), 'hammer'),
        kpi('Deadline Risk', String(atRisk), 'alarm-fill')
      ]));

      if (!ps.length) {
        host.appendChild(el('div.empty-state', null, [ ui.frag(ui.icon('easel2')),
          el('h3', { text:'No projects yet' }), el('p.text-muted', { text:'Create your first interior project.' }) ]));
        return;
      }

      host.appendChild(el('div.section-label', { text:'Active Projects' }));
      var grid = el('div.grid-auto.stagger');
      ps.forEach(function (p) {
        var profit = profitOf(p);
        var mPct = p.value ? Math.round(profit / p.value * 100) : 0;
        var prog = Math.max(0, Math.min(100, +p.progress || 0));
        var dl = daysLeft(p.deadline);
        var dlTone = isNaN(dl) ? '' : dl < 0 ? 'text-bad' : dl < 30 ? 'text-warn' : '';
        var dlLbl = isNaN(dl) ? '—' : (dl < 0 ? Math.abs(dl) + 'd overdue' : dl + 'd left');
        var col = STAGE_COLOR[p.stage] || '#6f9c1c';
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
              st2('Cost', ui.money(p.cost, { compact:true })),
              st2('Margin', ui.money(profit, { compact:true }) + ' · ' + mPct + '%')
            ]),
            el('div.flex.justify-between.items-center.mt-3', null, [
              el('span.text-mute.xs', { html: ui.icon('person-badge') + ' ' + ui.escapeHtml(p.designer || '—') }),
              el('span.badge' + (dlTone === 'text-bad' ? '.badge-bad' : dlTone === 'text-warn' ? '.badge-warn' : ''), { text: dlLbl })
            ])
          ])
        ]));
      });
      host.appendChild(grid);
    }
    draw();
  }

  /* ============================================================ DESIGN STUDIO (kanban) */
  function designStudio(page) {
    var search = el('input.input', { placeholder:'Search project, client, designer…', style:{ maxWidth:'320px' },
      oninput: ui.debounce(function () { draw(); }, 150) });
    page.appendChild(el('div.mb-3', null, [ search ]));
    var host = el('div'); page.appendChild(host);

    function draw() {
      var q = (search.value || '').toLowerCase();
      var list = projects().filter(function (p) {
        return !q || (p.name + ' ' + p.client + ' ' + p.designer + ' ' + p.id).toLowerCase().indexOf(q) >= 0;
      });
      host.innerHTML = '';
      var kb = el('div.kanban');
      STAGES.forEach(function (st) {
        var colItems = list.filter(function (p) { return p.stage === st; });
        var lst = el('div.kb-list', { 'data-stage': st });
        colItems.forEach(function (p) { lst.appendChild(designCard(p, draw)); });
        lst.addEventListener('dragover', function (e) { e.preventDefault(); lst.parentNode.classList.add('drag-over'); });
        lst.addEventListener('dragleave', function () { lst.parentNode.classList.remove('drag-over'); });
        lst.addEventListener('drop', function (e) {
          e.preventDefault(); lst.parentNode.classList.remove('drag-over');
          var id = e.dataTransfer.getData('text/plain');
          var p = project(id);
          if (p && p.stage !== st) {
            p.stage = st;
            if (st === 'Completed') p.progress = 100;
            db.save('wa_projects', p);
            if (st === 'Handover') db.notify({ level:'success', title:'Ready for Handover', companyId: CID, icon:'flag-fill',
              text: p.name + ' · ' + (p.client || '—') + ' — bill the client from the project drawer.' });
            ui.toast(p.id + ' moved to ' + st, 'success');
            draw();
          }
        });
        kb.appendChild(el('div.kb-col', { style:{ '--kb': STAGE_COLOR[st] } }, [
          el('div.kb-col-head', null, [ el('span.kb-col-dot'),
            el('span.kb-col-title', { text: st }), el('span.kb-count', { text: String(colItems.length) }) ]),
          lst
        ]));
      });
      host.appendChild(kb);
    }
    draw();
  }
  function designCard(p, refresh) {
    var prog = Math.max(0, Math.min(100, +p.progress || 0));
    var col = STAGE_COLOR[p.stage] || '#6f9c1c';
    var card = el('div.kb-card', { draggable:'true', 'data-id':p.id, onclick: function () { projectDrawer(p.id, refresh); } });
    card.addEventListener('dragstart', function (e) { e.dataTransfer.setData('text/plain', p.id); card.classList.add('dragging'); });
    card.addEventListener('dragend', function () { card.classList.remove('dragging'); });
    card.appendChild(el('div.kb-card-title', { style:{ margin:'0 0 2px' }, text: p.name }));
    card.appendChild(el('div.text-mute.xs', { text: (p.client || '—') + ' · ' + p.id }));
    card.appendChild(el('div', { style:{ margin:'8px 0 6px', height:'6px', borderRadius:'6px', background:'rgba(255,255,255,.08)', overflow:'hidden' } }, [
      el('div', { style:{ width: prog + '%', height:'100%', background: col } }) ]));
    card.appendChild(el('div.kb-card-foot', null, [
      el('span', { html:'<span class="num strong">' + ui.money(p.value, { compact:true }) + '</span>' }),
      typeBadge(p.type)
    ]));
    return card;
  }

  /* ============================================================ MILESTONES & BILLING */
  function milestones(page) {
    var host = el('div'); page.appendChild(host);
    function draw() {
      host.innerHTML = '';
      var ps = projects();
      var prod = db.col('wa_production'), inst = db.col('wa_installs');
      var running = prod.filter(function (w) { return w.status === 'Running'; }).length;
      var snagging = inst.filter(function (w) { return w.status === 'Snagging' || snagCount(w) > 0; }).length;
      var billed = db.sales(CID).reduce(function (s, x) { return s + (+x.amount || 0); }, 0);
      var handoverReady = ps.filter(function (p) { return (p.stage === 'Handover' || p.stage === 'Completed') && !p.billed; }).length;

      host.appendChild(el('div.kpi-grid.stagger', null, [
        kpi('Revenue Billed', ui.money(billed, { compact:true }), 'cash-coin'),
        kpi('Jobs Running', String(running), 'gear-wide-connected'),
        kpi('Sites Snagging', String(snagging), 'exclamation-diamond'),
        kpi('Awaiting Billing', String(handoverReady), 'receipt')
      ]));

      // stage distribution doughnut + value-by-type bar
      var cv1 = ui.uid('c'), cv2 = ui.uid('c');
      var row = el('div.two-col');
      row.appendChild(el('div.card', null, [
        el('div.card-head', null, [ el('h3', { html: ui.icon('pie-chart-fill') + ' Projects by Stage' }) ]),
        el('div.card-body', null, [ el('div', { style:{ height:'260px', position:'relative' } }, [ el('canvas', { id: cv1 }) ]) ])
      ]));
      row.appendChild(el('div.card', null, [
        el('div.card-head', null, [ el('h3', { html: ui.icon('bar-chart-fill') + ' Portfolio Value by Type' }) ]),
        el('div.card-body', null, [ el('div', { style:{ height:'260px', position:'relative' } }, [ el('canvas', { id: cv2 }) ]) ])
      ]));
      host.appendChild(row);

      // client billing ledger (woodart sales)
      var sales = db.sales(CID).slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; });
      var tbl = EPAL.table({
        columns: [
          { key:'date', label:'Date', date:true },
          { key:'ref', label:'Project', render:function (r) { var p = project(r.ref); return '<span class="strong">' + ui.escapeHtml(r.ref) + '</span>' + (p ? ' <span class="text-mute xs">' + ui.escapeHtml(shortName(p.name)) + '</span>' : ''); } },
          { key:'customer', label:'Client' },
          { key:'desc', label:'Description' },
          { key:'cost', label:'Cost', num:true, money:true },
          { key:'amount', label:'Billed', num:true, money:true },
          { key:'profit', label:'Profit', num:true, sortVal:function (r) { return +r.profit || 0; },
            render:function (r) { var v = +r.profit || 0; return '<span class="num ' + (v >= 0 ? 'text-good' : 'text-bad') + '">' + ui.money(v) + '</span>'; } }
        ],
        rows: sales, searchKeys:['ref','customer','desc'], exportName:'woodart-billing.csv', pageSize: 12,
        onRow: function (r) { var p = project(r.ref); if (p) projectDrawer(p.id, draw); },
        empty:{ icon:'receipt', title:'Nothing billed yet', hint:'Bill a project on handover from its drawer.' }
      });
      host.appendChild(el('div.card', null, [
        el('div.card-head', null, [ el('h3', { html: ui.icon('receipt-cutoff') + ' Client Billing Ledger' }),
          el('span.card-sub', { text:'Every handover invoice posted to Woodart finance' }) ]),
        el('div.card-body', null, [ tbl.el ])
      ]));

      requestAnimationFrame(function () {
        var c1 = ui.$('#' + cv1), c2 = ui.$('#' + cv2);
        if (c1 && EPAL.charts) EPAL.charts.doughnut(c1, {
          labels: STAGES,
          data: STAGES.map(function (s) { return ps.filter(function (p) { return p.stage === s; }).length; }),
          colors: STAGES.map(function (s) { return STAGE_COLOR[s]; })
        });
        if (c2 && EPAL.charts) {
          var byType = {}; ps.forEach(function (p) { var t = p.type || 'Other'; byType[t] = (byType[t] || 0) + (+p.value || 0); });
          var ts = Object.keys(byType);
          EPAL.charts.bar(c2, { labels: ts,
            datasets: [{ label:'Value', data: ts.map(function (t) { return byType[t]; }), colors: ts.map(function (t) { return TYPE_COLOR[t] || '#6f9c1c'; }) }],
            money: true });
        }
      });
    }
    draw();
  }

  /* ============================================================ GALLERY */
  function gallery(page) {
    var ps = projects();
    if (!ps.length) {
      page.appendChild(el('div.empty-state', null, [ ui.frag(ui.icon('images')),
        el('h3', { text:'Portfolio is empty' }), el('p.text-muted', { text:'Completed and in-progress projects appear here.' }) ]));
      return;
    }
    page.appendChild(el('div.section-label', { text: ps.length + ' projects in the portfolio' }));
    var grid = el('div.grid-auto.stagger');
    ps.forEach(function (p) {
      var col = TYPE_COLOR[p.type] || '#6f9c1c';
      var col2 = STAGE_COLOR[p.stage] || '#2f6bff';
      var thumb = el('div', { style:{ height:'132px', borderRadius:'12px 12px 0 0', position:'relative', overflow:'hidden',
        background:'linear-gradient(135deg,' + col + ' 0%,' + col2 + ' 100%)' } }, [
        el('span', { style:{ position:'absolute', right:'12px', bottom:'8px', fontSize:'46px', opacity:'.28' }, html:'<i class="bi bi-easel2-fill"></i>' }),
        el('span.badge', { style:{ position:'absolute', top:'10px', left:'10px', background:'rgba(0,0,0,.35)', color:'#fff' }, text: p.type || '—' })
      ]);
      grid.appendChild(el('div.card.hover', { style:{ cursor:'pointer', padding:'0', overflow:'hidden' }, onclick: (function (pid) { return function () { projectDrawer(pid); }; })(p.id) }, [
        thumb,
        el('div', { style:{ padding:'12px 14px' } }, [
          el('div.flex.items-center.gap-2', null, [
            el('div.flex-1', null, [ el('div.fw-700', { text: p.name }), el('div.text-mute.xs', { text: (p.client || '—') + ' · ' + (p.area ? ui.num(p.area) + ' sft' : p.id) }) ]),
            stageBadge(p.stage)
          ]),
          el('div.flex.justify-between.items-center.mt-2', null, [
            el('span.num.strong', { text: ui.money(p.value, { compact:true }) }),
            el('span.text-mute.xs', { text: (p.progress || 0) + '% complete' })
          ])
        ])
      ]));
    });
    page.appendChild(grid);
  }

  /* ============================================================ PROJECT DRAWER (tabs) */
  function projectDrawer(id, refresh) {
    var body = el('div');
    var tab = 'estimate';
    var m = ui.modal({ title:'Project', icon:'easel2', size:'xl', body:body, footer:false });

    function redraw() {
      var p = project(id);
      if (!p) { m.close(); return; }
      body.innerHTML = '';
      var value = +p.value || 0, cost = +p.cost || 0, profit = value - cost;

      body.appendChild(el('div.flex.gap-1.flex-wrap.items-center.mb-3', null, [
        el('span', { style:{ fontSize:'17px', fontWeight:'700' }, text: p.name }),
        stageBadge(p.stage), typeBadge(p.type), el('span.badge', { text: p.id }),
        el('span.badge', { text: (p.progress || 0) + '% done' })
      ]));

      // P&L strip
      body.appendChild(el('div.section-label', { text:'Project P&L' }));
      body.appendChild(el('div.stat-row', null, [
        st2('Contract Value', ui.money(value)),
        st2('Committed Cost', ui.money(cost)),
        st2('Profit', ui.money(profit) + ' · ' + (value ? Math.round(profit / value * 100) : 0) + '%'),
        st2('Deadline', p.deadline ? ui.date(p.deadline) : '—')
      ]));

      // meta grid
      body.appendChild(el('div.form-grid', null, [
        kv('Client', p.client || '—'), kv('Designer', p.designer || '—'),
        kv('Type', p.type || '—'), kv('Area', p.area ? ui.num(p.area) + ' sft' : '—'),
        kv('Start', p.start ? ui.date(p.start) : '—'), kv('Deadline', p.deadline ? ui.date(p.deadline) : '—')
      ]));

      // tabs
      var tabs = [['estimate','Estimate / BOM','calculator'], ['production','Production','gear-wide-connected'], ['install','Install & Snags','tools'], ['billing','Billing','receipt']];
      var nav = el('div.flex.gap-1.flex-wrap', { style:{ margin:'14px 0 10px' } });
      tabs.forEach(function (t) {
        nav.appendChild(el('button.btn.btn-sm' + (tab === t[0] ? '.btn-primary' : '.btn-ghost'),
          { html: ui.icon(t[2]) + ' ' + t[1], onclick: (function (k) { return function () { tab = k; redraw(); }; })(t[0]) }));
      });
      body.appendChild(nav);

      var content = el('div');
      body.appendChild(content);
      if (tab === 'estimate') tabEstimate(content, p);
      else if (tab === 'production') tabProduction(content, p);
      else if (tab === 'install') tabInstall(content, p);
      else tabBilling(content, p);

      // edit + comments
      body.appendChild(el('div.divider'));
      body.appendChild(el('div.flex.gap-1.flex-wrap', null, [
        el('button.btn.btn-sm.btn-outline', { html: ui.icon('pencil') + ' Edit Project',
          onclick: function () { editProject(p, function () { redraw(); refresh && refresh(); }); } })
      ]));
      if (EPAL.comments && EPAL.comments.widget) {
        body.appendChild(el('div.section-label', { text:'Discussion' }));
        body.appendChild(EPAL.comments.widget('wa_project', p.id));
      }
    }

    function tabEstimate(host, p) {
      var ests = estimatesOf(p.id);
      host.appendChild(el('div.flex.justify-between.items-center.mb-2', null, [
        el('span.text-mute.sm', { text: ests.length + ' linked estimate' + (ests.length === 1 ? '' : 's') }),
        el('button.btn.btn-sm.btn-ghost', { html: ui.icon('plus') + ' New Estimate',
          onclick: function () { editEstimate(null, function () { redraw(); refresh && refresh(); }, p); } })
      ]));
      if (!ests.length) {
        host.appendChild(el('div.empty-state', null, [ ui.frag(ui.icon('calculator')),
          el('h3', { text:'No estimate linked' }), el('p.text-muted', { text:'Create a BOM estimate for this project.' }) ]));
        return;
      }
      var list = el('div.data-list');
      ests.forEach(function (e) {
        var lines = e.lines || [];
        list.appendChild(el('div.data-row', { style:{ alignItems:'center', gap:'10px', padding:'10px 4px' } }, [
          el('div.flex-1', null, [
            el('div.fw-600', { text: e.title }),
            el('div.text-mute.xs', { text: e.id + ' · ' + (lines.length || e.items || 0) + ' BOM line' + ((lines.length || e.items) === 1 ? '' : 's') + ' · Valid till ' + (e.validTill ? ui.date(e.validTill) : '—') })
          ]),
          el('div', { style:{ textAlign:'right' } }, [ el('div.num.strong', { text: ui.money(estValue(e)) }), estStatusBadge(e.status) ]),
          el('button.btn.btn-sm.btn-outline', { html: ui.icon('pencil'), title:'Edit estimate',
            onclick: (function (eid) { return function () { editEstimate(estimate(eid), function () { redraw(); refresh && refresh(); }, p); }; })(e.id) }),
          el('button.btn.btn-sm.btn-ghost', { html: ui.icon('printer'), title:'Quotation',
            onclick: (function (eid) { return function () { openQuotationDoc(estimate(eid)); }; })(e.id) })
        ]));
      });
      host.appendChild(list);
    }

    function tabProduction(host, p) {
      var jobs = productionOf(p.id);
      var done = jobs.filter(function (w) { return w.status === 'Done'; }).length;
      host.appendChild(el('div.flex.justify-between.items-center.mb-2', null, [
        el('span.text-mute.sm', { text: jobs.length + ' job' + (jobs.length === 1 ? '' : 's') + ' · ' + done + ' done' }),
        el('button.btn.btn-sm.btn-ghost', { html: ui.icon('plus') + ' Add Job',
          onclick: function () { editJob(p.id, null, redraw); } })
      ]));
      if (!jobs.length) {
        host.appendChild(el('div.empty-state', null, [ ui.frag(ui.icon('gear-wide-connected')),
          el('h3', { text:'No production jobs' }), el('p.text-muted', { text:'Break the project into workshop jobs.' }) ]));
        return;
      }
      var tbl = EPAL.table({
        columns: [
          { key:'id', label:'Job', render:function (r) { return '<span class="strong">' + ui.escapeHtml(r.id) + '</span>'; } },
          { key:'job', label:'Item' },
          { key:'station', label:'Station', render:function (r) { return '<span class="badge">' + ui.escapeHtml(r.station || '—') + '</span>'; } },
          { key:'assignedTo', label:'Assigned' },
          { key:'status', label:'Status', badge:{ Done:'good', Running:'', Queued:'warn', Blocked:'bad' } },
          { key:'due', label:'Due', date:true }
        ],
        rows: jobs, searchKeys:['id','job','station','assignedTo'], exportName:'production-' + p.id + '.csv', pageSize: 8,
        onRow: function (r) { editJob(p.id, r, redraw); },
        empty:{ icon:'gear-wide-connected', title:'No jobs', hint:'Add a workshop job.' }
      });
      host.appendChild(tbl.el);
    }

    function tabInstall(host, p) {
      var inst = installsOf(p.id);
      host.appendChild(el('div.flex.justify-between.items-center.mb-2', null, [
        el('span.text-mute.sm', { text: inst.length + ' install' + (inst.length === 1 ? '' : 's') }),
        el('button.btn.btn-sm.btn-ghost', { html: ui.icon('plus') + ' Add Install',
          onclick: function () { editInstall(p.id, null, redraw); } })
      ]));
      if (!inst.length) {
        host.appendChild(el('div.empty-state', null, [ ui.frag(ui.icon('tools')),
          el('h3', { text:'No installs scheduled' }), el('p.text-muted', { text:'Schedule a site installation.' }) ]));
        return;
      }
      var list = el('div.data-list');
      inst.forEach(function (ins) {
        var open = snagCount(ins);
        list.appendChild(el('div.data-row', { style:{ alignItems:'center', gap:'10px', padding:'10px 4px' } }, [
          el('div.flex-1', null, [
            el('div.fw-600', { text: ins.site || '—' }),
            el('div.text-mute.xs', { text: ins.id + ' · ' + (ins.team || '—') + ' · ' + (ins.date ? ui.date(ins.date) : '—') })
          ]),
          el('div', { style:{ textAlign:'right' } }, [
            installStatusBadge(ins.status),
            el('div.text-mute.xs', { text: open + ' open snag' + (open === 1 ? '' : 's') })
          ]),
          el('button.btn.btn-sm.btn-outline', { html: ui.icon('list-check') + ' Snags',
            onclick: (function (iid) { return function () { snagModal(iid, redraw); }; })(ins.id) }),
          el('button.btn.btn-sm.btn-ghost', { html: ui.icon('pencil'),
            onclick: (function (iid) { return function () { editInstall(p.id, installById(iid), redraw); }; })(ins.id) })
        ]));
      });
      host.appendChild(list);
    }

    function tabBilling(host, p) {
      var value = +p.value || 0, cost = +p.cost || 0, profit = value - cost;
      var canBill = (p.stage === 'Handover' || p.stage === 'Completed') && !p.billed;
      host.appendChild(el('div.stat-row.mb-2', null, [
        st2('Contract Value', ui.money(value)),
        st2('Cost', ui.money(cost)),
        st2('Profit', ui.money(profit))
      ]));

      if (p.billed) {
        host.appendChild(el('div.build-banner', { style:{ marginTop:'6px' } }, [ ui.frag(ui.icon('patch-check-fill')),
          el('div', { html:'Invoiced to <strong>' + ui.escapeHtml(p.client || '—') + '</strong> · ' + ui.money(value) +
            ' posted to Woodart finance' + (p.billRef ? ' (' + ui.escapeHtml(p.billRef) + ')' : '') + '.' }) ]));
        host.appendChild(el('div.flex.gap-1.flex-wrap.mt-3', null, [
          el('button.btn.btn-outline', { html: ui.icon('printer') + ' Reprint Invoice', onclick: function () { openInvoiceDoc(project(id)); } })
        ]));
        return;
      }

      if (!canBill) {
        host.appendChild(el('div.build-banner', { style:{ marginTop:'6px' } }, [ ui.frag(ui.icon('info-circle')),
          el('div', { html:'Billing unlocks when the project reaches <strong>Handover</strong>. Current stage: <strong>' +
            ui.escapeHtml(p.stage || '—') + '</strong>. Advance it on the Design Studio board or via Edit Project.' }) ]));
        var nav = STAGES.indexOf(p.stage);
        if (nav >= 0 && nav < 3) {
          host.appendChild(el('div.flex.gap-1.mt-3', null, [
            el('button.btn.btn-sm.btn-outline', { html: ui.icon('arrow-right') + ' Advance to ' + STAGES[nav + 1],
              onclick: function () { var cur = project(id); cur.stage = STAGES[nav + 1]; db.save('wa_projects', cur); ui.toast('Advanced to ' + cur.stage, 'success'); redraw(); refresh && refresh(); } })
          ]));
        }
        return;
      }

      host.appendChild(el('div.build-banner', { style:{ marginTop:'6px' } }, [ ui.frag(ui.icon('flag-fill')),
        el('div', { html:'Project is ready for handover. Bill <strong>' + ui.escapeHtml(p.client || '—') + '</strong> for <strong>' +
          ui.money(value) + '</strong> — this posts revenue to Woodart + Group finance and opens a branded invoice.' }) ]));
      host.appendChild(el('div.flex.gap-1.flex-wrap.mt-3', null, [
        el('button.btn.btn-primary.btn-lg', { html: ui.icon('receipt') + ' Bill on Handover',
          onclick: function () { billOnHandover(id, redraw, refresh); } })
      ]));
    }

    redraw();
  }

  function installById(id) { return db.col('wa_installs').filter(function (x) { return x.id === id; })[0] || null; }

  /* --- Bill on Handover: post revenue + branded invoice ------------------- */
  function billOnHandover(id, redraw, refresh) {
    var p = project(id);
    if (!p) return;
    if (p.billed) { ui.toast('Project already billed', 'info'); return; }
    var value = +p.value || 0, cost = +p.cost || 0;
    ui.confirm({
      title:'Bill on Handover · ' + p.id,
      body:'Invoice ' + (p.client || 'the client') + ' for ' + ui.money(value) + ' and post it to Woodart finance? Cost of ' + ui.money(cost) + ' will be recorded against it.',
      confirmLabel:'Bill & Post'
    }).then(function (ok) {
      if (!ok) return;
      var cur = project(id);
      var sale = db.postSale(CID, {
        amount: value, cost: cost, ref: cur.id,
        desc: 'Interior fit-out · ' + cur.name,
        customer: cur.client || cur.name
      });
      cur.billed = true;
      cur.billRef = sale.id;
      cur.billDate = TODAY;
      if (cur.stage === 'Handover') cur.stage = 'Completed';
      cur.progress = 100;
      db.save('wa_projects', cur);
      db.notify({ level:'success', title:'Project Billed', companyId: CID, icon:'receipt-cutoff',
        text: cur.id + ' · ' + (cur.client || '—') + ' · ' + ui.money(value) });
      ui.toast('Billed ' + ui.money(value) + ' · posted to finance', 'success');
      openInvoiceDoc(project(id));
      redraw && redraw();
      refresh && refresh();
    });
  }

  function openInvoiceDoc(p) {
    if (!p) return;
    if (!EPAL.doc || !EPAL.doc.open) { ui.toast('Document engine unavailable', 'error'); return; }
    var value = +p.value || 0;
    var ests = estimatesOf(p.id);
    var lines = (ests[0] && ests[0].lines) || [];
    var rows, columns;
    if (lines.length) {
      columns = [ { key:'item', label:'Item / Scope' }, { key:'qty', label:'Qty', num:true }, { key:'rate', label:'Rate', num:true, money:true }, { key:'amt', label:'Amount', num:true, money:true } ];
      rows = lines.map(function (l) { return { item:l.item, qty:(+l.qty || 0), rate:(+l.unitSale || 0), amt:(+l.qty || 0) * (+l.unitSale || 0) }; });
    } else {
      columns = [ { key:'k', label:'Description' }, { key:'v', label:'Amount (BDT)', num:true, money:true } ];
      rows = [ { k:'Interior fit-out — ' + p.name + ' (' + (p.area ? ui.num(p.area) + ' sft' : (p.type || '')) + ')', v: value } ];
    }
    EPAL.doc.open({
      type:'invoice', title:'Tax Invoice', serial: EPAL.doc.numberFor('invoice'),
      badge: p.billed ? 'BILLED' : 'HANDOVER', watermark:'WOODART',
      parties: [
        { label:'Bill To', lines:[ p.client || '—', p.name, 'Project ' + p.id ] },
        { label:'From', lines:[ 'Woodart Interiors', 'Design · Build · Fit-out', 'Tejgaon I/A, Dhaka' ] }
      ],
      meta: [
        { label:'Project', value: p.id },
        { label:'Type', value: p.type || '—' },
        { label:'Designer', value: p.designer || '—' },
        { label:'Date', value: ui.date(p.billDate || TODAY) }
      ],
      columns: columns, rows: rows,
      totals: [
        { label:'Contract Value', value: ui.money(value) },
        { label:'Advance / Adjustments', value: ui.money(0) },
        { label:'Net Payable', value: ui.money(value), grand:true }
      ],
      words: EPAL.doc.amountInWords ? EPAL.doc.amountInWords(value) : '',
      terms:'Payable within 15 days of handover. 12 months workmanship warranty on all fitted joinery. Retention, if any, is released on defect-liability expiry.',
      sign:'For Woodart Interiors'
    });
  }

  /* ============================================================ SNAG MODAL */
  function snagModal(installId, done) {
    var ins = installById(installId);
    if (!ins) return;
    var body = el('div');
    var m = ui.modal({ title:'Snag List · ' + (ins.site || ins.id), icon:'list-check', size:'md', body:body, footer:false });

    function migrate(cur) {
      if (!cur.snagList) {
        var n = +cur.snags || 0, arr = [];
        for (var i = 0; i < n; i++) arr.push({ text:'Snag item ' + (i + 1), done:false });
        cur.snagList = arr;
      }
      return cur;
    }

    function redraw() {
      var cur = migrate(installById(installId));
      if (!cur) { m.close(); return; }
      body.innerHTML = '';
      var open = cur.snagList.filter(function (s) { return !s.done; }).length;
      body.appendChild(el('div.flex.gap-1.flex-wrap.mb-3.items-center', null, [
        installStatusBadge(cur.status), el('span.badge', { text: cur.team || '—' }),
        el('span.badge' + (open ? '.badge-warn' : '.badge-good'), { text: open + ' open / ' + cur.snagList.length + ' total' })
      ]));

      if (!cur.snagList.length) {
        body.appendChild(el('div.empty-state', null, [ ui.frag(ui.icon('check2-circle')),
          el('h3', { text:'No snags' }), el('p.text-muted', { text:'Add any defects found during the site walk.' }) ]));
      } else {
        var list = el('div');
        cur.snagList.forEach(function (s, i) {
          list.appendChild(el('label.data-row', { style:{ cursor:'pointer', gap:'10px', alignItems:'center' } }, [
            check(s.done, function (v) { var c = migrate(installById(installId)); c.snagList[i].done = v; c.snags = c.snagList.filter(function (x) { return !x.done; }).length; db.save('wa_installs', c); redraw(); done && done(); }),
            el('span.flex-1.sm' + (s.done ? '.text-mute' : ''), { text: s.text }),
            el('button.icon-btn', { html: ui.icon('x-lg'), title:'Remove',
              onclick: function (e) { e.preventDefault(); e.stopPropagation(); var c = migrate(installById(installId)); c.snagList.splice(i, 1); c.snags = c.snagList.filter(function (x) { return !x.done; }).length; db.save('wa_installs', c); redraw(); done && done(); } })
          ]));
        });
        body.appendChild(list);
      }

      body.appendChild(el('div.divider'));
      var snagIn = el('input.input', { placeholder:'Describe a snag (e.g. Hinge alignment on wardrobe shutter)…' });
      body.appendChild(el('div.flex.gap-1', null, [
        snagIn,
        el('button.btn.btn-primary', { html: ui.icon('plus-lg') + ' Add', onclick: function () {
          var txt = (snagIn.value || '').trim();
          if (!txt) { ui.toast('Enter a snag description', 'error'); return; }
          var c = migrate(installById(installId)); c.snagList.push({ text: txt, done:false });
          if (c.status === 'Scheduled' || c.status === 'In Progress') c.status = 'Snagging';
          c.snags = c.snagList.filter(function (x) { return !x.done; }).length;
          db.save('wa_installs', c); ui.toast('Snag added', 'success'); redraw(); done && done();
        } })
      ]));
      // status control
      var stSel = el('select.select', { style:{ width:'auto' }, onchange: function () { var c = migrate(installById(installId)); c.status = stSel.value; db.save('wa_installs', c); redraw(); done && done(); } });
      INSTALL_STATUS.forEach(function (s) { var o = el('option', { value:s, text:'Status → ' + s }); if (s === cur.status) o.selected = true; stSel.appendChild(o); });
      body.appendChild(el('div.flex.gap-1.flex-wrap.mt-3', null, [ stSel ]));
    }
    redraw();
  }

  /* ================================================================ VIEW: ESTIMATES */
  EPAL.view('woodart/estimates', {
    render: function (ctx) {
      var sub = ctx.subId || 'quotations';
      var page = el('div.page');
      var map = { quotations:'Quotations', boq:'Bill of Materials', costing:'Costing' };
      page.appendChild(EPAL.pageHead({
        eyebrow:'Woodart › Estimates & BOQ', icon:'calculator-fill',
        title: map[sub] || 'Estimates', sub: estDesc(sub),
        actions: [
          el('a.btn.btn-ghost', { href:'#/woodart/projects/active', html: ui.icon('easel2') + ' Projects' }),
          el('button.btn.btn-primary', { html: ui.icon('plus-lg') + ' New Estimate', onclick: function () { editEstimate(null, function () { EPAL.router.render(); }); } })
        ]
      }));
      // SECTION NAV — the house full-bleed underline band (owner grammar 2026-07-15)
      page.appendChild(estimatesNav(sub));
      ({ quotations:quotations, boq:boqView, costing:costing }[sub] || quotations)(page, ctx);
      ctx.mount.appendChild(page);
    }
  });

  function estDesc(sub) {
    return ({ quotations:'Every estimate — BOM line items, quote value and approval into a live project.',
      boq:'Aggregated bill of materials across all estimates — item demand and cost.',
      costing:'Cost vs quote margin analysis across the estimate book.' }[sub]) || '';
  }

  /* --------------------------------------------- QUOTATIONS (estimate ledger) */
  function quotations(page) {
    var host = el('div'); page.appendChild(host);
    function draw() {
      host.innerHTML = '';
      var es = estimates();
      var total = 0, approved = 0, pending = 0, won = 0;
      es.forEach(function (e) {
        var v = estValue(e); total += v;
        if (e.status === 'Approved') { approved++; won += v; }
        if (e.status === 'Draft' || e.status === 'Sent') pending += v;
      });
      host.appendChild(el('div.kpi-grid.stagger', null, [
        kpi('Estimates', String(es.length), 'file-earmark-text'),
        kpi('Quoted Value', ui.money(total, { compact:true }), 'calculator'),
        kpi('Approved', String(approved) + ' · ' + ui.money(won, { compact:true }), 'patch-check-fill'),
        kpi('Open Pipeline', ui.money(pending, { compact:true }), 'hourglass-split')
      ]));

      var tbl = EPAL.table({
        columns: [
          { key:'id', label:'Est', render:function (r) { return '<span class="strong">' + ui.escapeHtml(r.id) + '</span>'; } },
          { key:'title', label:'Estimate' },
          { key:'client', label:'Client' },
          { key:'items', label:'Lines', num:true, sortVal:function (r) { return (r.lines ? r.lines.length : r.items) || 0; },
            render:function (r) { return String((r.lines ? r.lines.length : r.items) || 0); } },
          { key:'value', label:'Value', num:true, sortVal:function (r) { return estValue(r); },
            render:function (r) { return '<span class="num strong">' + ui.money(estValue(r)) + '</span>'; } },
          { key:'status', label:'Status', badge:{ Approved:'good', Sent:'', Draft:'warn', Rejected:'bad' } },
          { key:'validTill', label:'Valid Till', date:true }
        ],
        rows: function () { return estimates(); },
        searchKeys:['id','title','client'],
        filters:[{ key:'status', label:'Status' }],
        onRow: function (r) { estimateDrawer(r.id, draw); },
        exportName:'woodart-estimates.csv', pageSize: 12,
        empty:{ icon:'calculator', title:'No estimates yet', hint:'Create your first BOM estimate.' }
      });
      host.appendChild(el('div.card', null, [
        el('div.card-head', null, [ el('h3', { html: ui.icon('file-earmark-ruled') + ' Estimate Ledger' }),
          el('span.card-sub', { text:'Approve an estimate to spin up a live project' }) ]),
        el('div.card-body', null, [ tbl.el ])
      ]));
    }
    draw();
  }

  /* --------------------------------------------- BOM aggregation */
  function boqView(page) {
    var demand = {};
    estimates().forEach(function (e) {
      (e.lines || []).forEach(function (l) {
        var k = (l.item || 'Unspecified');
        if (!demand[k]) demand[k] = { item:k, qty:0, cost:0, sale:0 };
        demand[k].qty += (+l.qty || 0);
        demand[k].cost += (+l.qty || 0) * (+l.unitCost || 0);
        demand[k].sale += (+l.qty || 0) * (+l.unitSale || 0);
      });
    });
    var rows = Object.keys(demand).map(function (k) { return demand[k]; });
    var totQty = rows.reduce(function (s, r) { return s + r.qty; }, 0);
    var totCost = rows.reduce(function (s, r) { return s + r.cost; }, 0);
    var totSale = rows.reduce(function (s, r) { return s + r.sale; }, 0);

    page.appendChild(el('div.kpi-grid.stagger', null, [
      kpi('Distinct Items', String(rows.length), 'boxes'),
      kpi('Total Quantity', ui.num(totQty), 'stack'),
      kpi('Material Cost', ui.money(totCost, { compact:true }), 'wallet2'),
      kpi('Quoted Value', ui.money(totSale, { compact:true }), 'cash-coin')
    ]));

    if (!rows.length) {
      page.appendChild(el('div.build-banner', null, [ ui.frag(ui.icon('info-circle')),
        el('div', { html:'Add BOM line items to your estimates (via New Estimate → line items) and they roll up here as aggregate material demand.' }) ]));
      return;
    }
    var tbl = EPAL.table({
      columns: [
        { key:'item', label:'Item', render:function (r) { return '<span class="strong">' + ui.escapeHtml(r.item) + '</span>'; } },
        { key:'qty', label:'Qty', num:true },
        { key:'cost', label:'Cost', num:true, money:true },
        { key:'sale', label:'Quoted', num:true, money:true },
        { key:'margin', label:'Margin', num:true, sortVal:function (r) { return r.sale - r.cost; },
          render:function (r) { var mg = r.sale - r.cost; return '<span class="num ' + (mg >= 0 ? 'text-good' : 'text-bad') + '">' + ui.money(mg) + '</span>'; } }
      ],
      rows: rows, searchKeys:['item'], exportName:'woodart-bom.csv', pageSize: 15,
      empty:{ icon:'boxes', title:'No BOM lines', hint:'Add line items to estimates.' }
    });
    page.appendChild(el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon('list-columns-reverse') + ' Aggregated Bill of Materials' }) ]),
      el('div.card-body', null, [ tbl.el ])
    ]));
  }

  /* --------------------------------------------- COSTING analysis */
  function costing(page) {
    var es = estimates();
    var rows = es.map(function (e) {
      var v = estValue(e), c = estCost(e), m = v - c;
      return { id:e.id, title:e.title, client:e.client, cost:c, value:v, margin:m, pct: v ? Math.round(m / v * 100) : 0, status:e.status };
    });
    var totV = rows.reduce(function (s, r) { return s + r.value; }, 0);
    var totC = rows.reduce(function (s, r) { return s + r.cost; }, 0);
    var avgPct = totV ? Math.round((totV - totC) / totV * 100) : 0;

    page.appendChild(el('div.kpi-grid.stagger', null, [
      kpi('Quoted Value', ui.money(totV, { compact:true }), 'cash-coin'),
      kpi('Est. Cost', ui.money(totC, { compact:true }), 'wallet2'),
      kpi('Gross Margin', ui.money(totV - totC, { compact:true }), 'graph-up-arrow'),
      kpi('Avg Margin %', avgPct + '%', 'percent')
    ]));

    var cv = ui.uid('c');
    page.appendChild(el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon('bar-chart-line-fill') + ' Cost vs Quote by Estimate' }) ]),
      el('div.card-body', null, [ el('div', { style:{ height:'300px', position:'relative' } }, [ el('canvas', { id: cv }) ]) ])
    ]));

    var tbl = EPAL.table({
      columns: [
        { key:'id', label:'Est', render:function (r) { return '<span class="strong">' + ui.escapeHtml(r.id) + '</span>'; } },
        { key:'title', label:'Estimate' },
        { key:'client', label:'Client' },
        { key:'cost', label:'Cost', num:true, money:true },
        { key:'value', label:'Quote', num:true, money:true },
        { key:'margin', label:'Margin', num:true, sortVal:function (r) { return r.margin; },
          render:function (r) { return '<span class="num ' + (r.margin >= 0 ? 'text-good' : 'text-bad') + '">' + ui.money(r.margin) + '</span>'; } },
        { key:'pct', label:'%', num:true, render:function (r) { return r.pct + '%'; } },
        { key:'status', label:'Status', badge:{ Approved:'good', Sent:'', Draft:'warn', Rejected:'bad' } }
      ],
      rows: rows, searchKeys:['id','title','client'], exportName:'woodart-costing.csv', pageSize: 15,
      onRow: function (r) { estimateDrawer(r.id); },
      empty:{ icon:'calculator', title:'No estimates', hint:'Create an estimate to analyse costing.' }
    });
    page.appendChild(el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon('table') + ' Margin Register' }) ]),
      el('div.card-body', null, [ tbl.el ])
    ]));

    requestAnimationFrame(function () {
      var c = ui.$('#' + cv); if (!c || !EPAL.charts) return;
      var top = rows.slice().sort(function (a, b) { return b.value - a.value; }).slice(0, 10);
      EPAL.charts.bar(c, {
        labels: top.map(function (r) { return r.id; }),
        datasets: [
          { label:'Cost', data: top.map(function (r) { return r.cost; }) },
          { label:'Quote', data: top.map(function (r) { return r.value; }) }
        ],
        money: true
      });
    });
  }

  /* ============================================================ ESTIMATE DRAWER */
  function estimateDrawer(id, refresh) {
    var e = estimate(id);
    if (!e) return;
    var body = el('div');
    var m = ui.modal({ title:'Estimate ' + e.id, icon:'calculator', size:'lg', body:body, footer:false });

    function redraw() {
      var cur = estimate(id);
      if (!cur) { m.close(); return; }
      body.innerHTML = '';
      var v = estValue(cur), c = estCost(cur), margin = v - c;
      var lines = cur.lines || [];

      body.appendChild(el('div.flex.gap-1.flex-wrap.items-center.mb-3', null, [
        el('span', { style:{ fontSize:'16px', fontWeight:'700' }, text: cur.title }),
        estStatusBadge(cur.status), el('span.badge', { text: cur.id })
      ]));
      body.appendChild(el('div.stat-row', null, [
        st2('Quoted Value', ui.money(v)),
        st2('Est. Cost', ui.money(c)),
        st2('Margin', ui.money(margin) + ' · ' + (v ? Math.round(margin / v * 100) : 0) + '%')
      ]));
      body.appendChild(el('div.form-grid', null, [
        kv('Client', cur.client || '—'), kv('Valid Till', cur.validTill ? ui.date(cur.validTill) : '—'),
        kv('BOM Lines', String(lines.length || cur.items || 0)),
        kv('Linked Project', cur.projectId || '—')
      ]));

      if (lines.length) {
        body.appendChild(el('div.section-label', { text:'Bill of Materials' }));
        var tbl = EPAL.table({
          columns: [
            { key:'item', label:'Item' },
            { key:'qty', label:'Qty', num:true },
            { key:'unitCost', label:'Unit Cost', num:true, money:true },
            { key:'unitSale', label:'Unit Sale', num:true, money:true },
            { key:'amount', label:'Amount', num:true, sortVal:function (r) { return (+r.qty || 0) * (+r.unitSale || 0); },
              render:function (r) { return '<span class="num strong">' + ui.money((+r.qty || 0) * (+r.unitSale || 0)) + '</span>'; } }
          ],
          rows: lines, exportName:false, pageSize: 10,
          empty:{ icon:'boxes', title:'No lines', hint:'' }
        });
        body.appendChild(tbl.el);
      }

      body.appendChild(el('div.divider'));
      var canApprove = cur.status !== 'Approved';
      var canDelete = !EPAL.perm || EPAL.perm.can(CID, 'estimates', 'delete');
      body.appendChild(el('div.flex.gap-1.flex-wrap', null, [
        el('button.btn.btn-sm.btn-outline', { html: ui.icon('pencil') + ' Edit',
          onclick: function () { editEstimate(cur, function () { redraw(); refresh && refresh(); }); } }),
        el('button.btn.btn-sm.btn-outline', { html: ui.icon('printer') + ' Quotation',
          onclick: function () { openQuotationDoc(estimate(id)); } }),
        canApprove ? el('button.btn.btn-sm.btn-primary', { html: ui.icon('patch-check') + ' Approve → Project',
          onclick: function () { approveEstimate(id, function () { redraw(); refresh && refresh(); }); } }) : null,
        canDelete ? el('button.btn.btn-sm.btn-danger', { html: ui.icon('trash') + ' Delete',
          onclick: function () { ui.confirm({ title:'Delete estimate?', body:'This removes ' + cur.id + '.', danger:true, confirmLabel:'Delete' }).then(function (ok) {
            if (ok) { db.remove('wa_estimates', cur.id); m.close(); refresh && refresh(); ui.toast('Estimate deleted', 'success'); } }); } }) : null
      ]));

      if (EPAL.comments && EPAL.comments.widget) {
        body.appendChild(el('div.section-label', { text:'Discussion' }));
        body.appendChild(EPAL.comments.widget('wa_estimate', cur.id));
      }
    }
    redraw();
  }

  /* --- Approve estimate → create project --------------------------------- */
  function approveEstimate(id, done) {
    var e = estimate(id);
    if (!e) return;
    var v = estValue(e), c = estCost(e);
    ui.confirm({
      title:'Approve & Create Project',
      body:'Approve ' + e.id + ' (' + ui.money(v) + ') and spin up a live project for ' + (e.client || 'the client') + '?',
      confirmLabel:'Approve & Create'
    }).then(function (ok) {
      if (!ok) return;
      var cur = estimate(id);
      var proj = {
        id: nextProjectId(),
        name: cur.title,
        client: cur.client || '—',
        type: 'Residential',
        area: 0,
        value: v, cost: c,
        stage: 'Design', progress: 0,
        designer: (designers()[0] || ''),
        start: TODAY,
        deadline: cur.validTill || '',
        estimateId: cur.id,
        created: TODAY
      };
      db.save('wa_projects', proj);
      cur.status = 'Approved';
      cur.projectId = proj.id;
      db.save('wa_estimates', cur);
      db.notify({ level:'success', title:'Estimate Approved', companyId: CID, icon:'patch-check-fill',
        text: cur.id + ' → ' + proj.id + ' · ' + (cur.client || '—') });
      ui.toast('Project ' + proj.id + ' created from ' + cur.id, 'success');
      done && done();
      EPAL.router.navigate('woodart/projects/active');
    });
  }

  function openQuotationDoc(e) {
    if (!e) return;
    if (!EPAL.doc || !EPAL.doc.open) { ui.toast('Document engine unavailable', 'error'); return; }
    var v = estValue(e);
    var lines = e.lines || [];
    var rows, columns;
    if (lines.length) {
      columns = [ { key:'item', label:'Item / Description' }, { key:'qty', label:'Qty', num:true }, { key:'rate', label:'Unit Rate', num:true, money:true }, { key:'amt', label:'Amount', num:true, money:true } ];
      rows = lines.map(function (l) { return { item:l.item, qty:(+l.qty || 0), rate:(+l.unitSale || 0), amt:(+l.qty || 0) * (+l.unitSale || 0) }; });
    } else {
      columns = [ { key:'k', label:'Description' }, { key:'v', label:'Amount (BDT)', num:true, money:true } ];
      rows = [ { k: e.title, v: v } ];
    }
    EPAL.doc.open({
      type:'quotation', title:'Quotation', serial: EPAL.doc.numberFor('quotation'),
      badge: e.status, watermark:'WOODART',
      parties: [
        { label:'Quotation For', lines:[ e.client || '—', e.title ] },
        { label:'From', lines:[ 'Woodart Interiors', 'Design · Build · Fit-out', 'Tejgaon I/A, Dhaka' ] }
      ],
      meta: [
        { label:'Estimate No', value: e.id },
        { label:'Date', value: ui.date(e.created || TODAY) },
        { label:'Valid Till', value: e.validTill ? ui.date(e.validTill) : '—' }
      ],
      columns: columns, rows: rows,
      totals: [
        { label:'Subtotal', value: ui.money(v) },
        { label:'VAT (incl.)', value: ui.money(0) },
        { label:'Total Quoted', value: ui.money(v), grand:true }
      ],
      words: EPAL.doc.amountInWords ? EPAL.doc.amountInWords(v) : '',
      terms:'Quotation valid till the date above. 50% advance to commence works, balance on handover. Prices in BDT, inclusive of standard hardware. Site measurement may adjust final quantities.',
      sign:'For Woodart Interiors'
    });
  }

  /* ============================================================ FORMS */
  function editProject(rec, done) {
    var isNew = !rec;
    EPAL.formModal({
      title: isNew ? 'New Project' : 'Edit Project', icon:'easel2', size:'lg',
      record: rec || {},
      fields: [
        { type:'section', label:'Project' },
        { key:'name', label:'Project name', type:'text', required:true, col2:true, placeholder:'e.g. Penthouse Interior · Gulshan-2' },
        { key:'client', label:'Client', type:'text', required:true, placeholder:'e.g. Bashundhara Group' },
        { key:'designer', label:'Lead Designer', type:'select', optionsFrom: designers },
        { key:'type', label:'Type', type:'select', options: TYPES, default:'Residential' },
        { key:'area', label:'Area (sft)', type:'number', min:0, default:0 },
        { type:'section', label:'Commercials' },
        { key:'value', label:'Contract value', type:'money', required:true, min:1 },
        { key:'cost', label:'Budgeted cost', type:'money', min:0 },
        { key:'progress', label:'Progress %', type:'number', min:0, max:100, default:0 },
        { key:'stage', label:'Stage', type:'select', options: STAGES, default:'Design' },
        { type:'section', label:'Schedule' },
        { key:'start', label:'Start date', type:'date' },
        { key:'deadline', label:'Deadline', type:'date' }
      ],
      saveLabel: isNew ? 'Create Project' : 'Save',
      onSave: function (v, record) {
        var r = record && record.id ? record : { id: nextProjectId(), created: TODAY };
        r.name = (v.name || '').trim();
        r.client = (v.client || '').trim();
        r.designer = v.designer || '';
        r.type = v.type || 'Residential';
        r.area = +v.area || 0;
        r.value = +v.value || 0;
        r.cost = +v.cost || 0;
        r.progress = Math.max(0, Math.min(100, +v.progress || 0));
        r.stage = v.stage || 'Design';
        r.start = v.start || '';
        r.deadline = v.deadline || '';
        db.save('wa_projects', r);
        ui.toast('Project ' + r.id + ' saved', 'success');
        if (done) done(); else EPAL.router.render();
        return true;
      }
    });
  }

  function editEstimate(rec, done, linkProject) {
    var isNew = !rec;
    EPAL.formModal({
      title: isNew ? 'New Estimate' : 'Edit Estimate', icon:'calculator', size:'xl',
      record: rec || {},
      fields: [
        { type:'section', label:'Estimate' },
        { key:'title', label:'Title', type:'text', required:true, col2:true, placeholder:'e.g. Full Interior — Duplex, Banani DOHS' },
        { key:'client', label:'Client', type:'text', required:true, default: linkProject ? linkProject.client : '' },
        { key:'validTill', label:'Valid till', type:'date' },
        { key:'status', label:'Status', type:'select', options: EST_STATUS, default:'Draft' },
        { type:'section', label:'Bill of Materials' },
        { key:'lines', type:'items', label:'BOM Line Items', addLabel:'Add BOM line', min:0,
          columns: [
            { key:'item', label:'Item', type:'text', width:'2fr' },
            { key:'qty', label:'Qty', type:'number', width:'70px' },
            { key:'unitCost', label:'Unit Cost', type:'money' },
            { key:'unitSale', label:'Unit Sale', type:'money' }
          ],
          footer: function (rows) {
            var cost = 0, sale = 0;
            rows.forEach(function (l) { cost += (+l.qty || 0) * (+l.unitCost || 0); sale += (+l.qty || 0) * (+l.unitSale || 0); });
            return 'Cost: <strong>' + ui.money(cost) + '</strong> · Quote: <strong>' + ui.money(sale) +
              '</strong> · Margin: <strong class="' + (sale - cost >= 0 ? 'text-good' : 'text-bad') + '">' + ui.money(sale - cost) + '</strong>';
          }
        }
      ],
      saveLabel: isNew ? 'Create Estimate' : 'Save',
      onSave: function (v, record) {
        var r = record && record.id ? record : { id: nextEstimateId(), created: TODAY };
        var lines = (v.lines || []).filter(function (l) { return (l.item || '').trim() || (+l.qty); });
        r.title = (v.title || '').trim();
        r.client = (v.client || '').trim();
        r.validTill = v.validTill || '';
        r.status = v.status || 'Draft';
        r.lines = lines.map(function (l) { return { item:(l.item || '').trim(), qty:+l.qty || 0, unitCost:+l.unitCost || 0, unitSale:+l.unitSale || 0 }; });
        r.items = r.lines.length || (record && record.items) || 0;
        if (r.lines.length) { r.value = estValue(r); r.cost = estCost(r); }
        else if (isNew) { r.value = 0; r.cost = 0; }
        if (linkProject && !r.projectId) r.projectId = linkProject.id;
        db.save('wa_estimates', r);
        ui.toast('Estimate ' + r.id + ' saved · ' + ui.money(estValue(r)), 'success');
        if (done) done();
        return true;
      }
    });
  }

  function editJob(projectId, rec, done) {
    var isNew = !rec;
    var projOpts = projects().map(function (p) { return [p.id, p.id + ' · ' + shortName(p.name)]; });
    EPAL.formModal({
      title: isNew ? 'Add Production Job' : 'Edit Job', icon:'gear-wide-connected', size:'lg',
      record: rec || {},
      fields: [
        { key:'project', label:'Project', type:'select', required:true, options: projOpts, default: projectId || (projOpts[0] && projOpts[0][0]) },
        { key:'job', label:'Job / Item', type:'text', required:true, col2:true, placeholder:'e.g. Wardrobe shutters' },
        { key:'station', label:'Station', type:'select', required:true, options: STATIONS },
        { key:'assignedTo', label:'Assigned to', type:'select', optionsFrom: designers },
        { key:'status', label:'Status', type:'select', options: JOB_STATUS, default:'Queued' },
        { key:'due', label:'Due date', type:'date' }
      ],
      saveLabel: isNew ? 'Add Job' : 'Save',
      onSave: function (v, record) {
        var r = record && record.id ? record : { id: nextJobId(), created: TODAY };
        r.project = v.project;
        r.job = (v.job || '').trim();
        r.station = v.station;
        r.assignedTo = v.assignedTo || '';
        r.status = v.status || 'Queued';
        r.due = v.due || '';
        db.save('wa_production', r);
        ui.toast('Job ' + r.id + ' saved', 'success');
        if (done) done();
        return true;
      }
    });
  }

  function editInstall(projectId, rec, done) {
    var isNew = !rec;
    var projOpts = projects().map(function (p) { return [p.id, p.id + ' · ' + shortName(p.name)]; });
    EPAL.formModal({
      title: isNew ? 'Add Installation' : 'Edit Installation', icon:'tools', size:'lg',
      record: rec || {},
      fields: [
        { key:'project', label:'Project', type:'select', required:true, options: projOpts, default: projectId || (projOpts[0] && projOpts[0][0]) },
        { key:'site', label:'Site / Location', type:'text', required:true, col2:true, placeholder:'e.g. Gulshan-2, House 42' },
        { key:'team', label:'Install team', type:'select', options:['Team Alpha','Team Bravo','Team Charlie','Team Delta'], default:'Team Alpha' },
        { key:'date', label:'Install date', type:'date' },
        { key:'status', label:'Status', type:'select', options: INSTALL_STATUS, default:'Scheduled' }
      ],
      saveLabel: isNew ? 'Add Installation' : 'Save',
      onSave: function (v, record) {
        var r = record && record.id ? record : { id: nextInstallId(), created: TODAY, snagList: [], snags: 0 };
        r.project = v.project;
        r.site = (v.site || '').trim();
        r.team = v.team || '';
        r.date = v.date || '';
        r.status = v.status || 'Scheduled';
        if (!r.snagList) r.snagList = [];
        db.save('wa_installs', r);
        ui.toast('Installation ' + r.id + ' saved', 'success');
        if (done) done();
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
  function nextProjectId() { return 'WAP-' + String(nextIdNum('wa_projects')).padStart(3, '0'); }
  function nextEstimateId() { return 'EST-' + String(nextIdNum('wa_estimates')).padStart(3, '0'); }
  function nextJobId() { return 'JOB-' + String(nextIdNum('wa_production')).padStart(3, '0'); }
  function nextInstallId() { return 'INS-' + String(nextIdNum('wa_installs')).padStart(3, '0'); }

  /* ============================================================ SHARED HELPERS */
  function kpi(label, value, icon) {
    return el('div.kpi-card', null, [
      el('div.kpi-top', null, [ el('span.kpi-label', { text: label }), el('span.kpi-ico', { html:'<i class="bi bi-' + icon + '"></i>' }) ]),
      el('div.kpi-value', { text: String(value) })
    ]);
  }
  function kv(k, v) { return el('div.field', null, [ el('label', { text: k }), el('div.fw-600', { text: String(v) }) ]); }
  function st2(l, v) { return el('div.stat', null, [ el('div.stat-label', { text: l }), el('div.stat-value', { text: v }) ]); }
  function check(on, onChange) {
    var i = el('input', { type:'checkbox' }); i.checked = on;
    i.addEventListener('change', function (e) { e.stopPropagation(); onChange(i.checked); });
    i.addEventListener('click', function (e) { e.stopPropagation(); });
    return i;
  }
  function stageBadge(s) {
    var col = STAGE_COLOR[s] || '#8b93a7';
    var b = el('span.badge', { text: s || '—' });
    b.style.color = col; b.style.background = col + '22';
    return b;
  }
  function typeBadge(t) {
    var col = TYPE_COLOR[t] || '#8b93a7';
    var b = el('span.badge', { text: t || '—' });
    b.style.color = col; b.style.background = col + '22';
    return b;
  }
  function estStatusBadge(s) {
    var tone = s === 'Approved' ? 'badge-good' : s === 'Sent' ? '' : s === 'Rejected' ? 'badge-bad' : 'badge-warn';
    return el('span.badge' + (tone ? '.' + tone : ''), { text: s || '—' });
  }
  function installStatusBadge(s) {
    var tone = s === 'Handover' ? 'badge-good' : s === 'Snagging' ? 'badge-warn' : s === 'In Progress' ? '' : '';
    return el('span.badge' + (tone ? '.' + tone : ''), { text: s || '—' });
  }
  function shortName(name) {
    if (!name) return '—';
    return String(name).length > 34 ? String(name).slice(0, 33) + '…' : String(name);
  }

})(window.EPAL = window.EPAL || {});
