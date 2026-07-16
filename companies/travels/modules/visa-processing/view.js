/* ============================================================================
 * EPAL GROUP ERP  ·  views/travels/visa-processing.js
 * ----------------------------------------------------------------------------
 * VISA PROCESSING — the flagship "fully operational, world-class agency" module
 * the owner used as the north-star example. ONE registered view handles every
 * sub-route (the router falls back from `.../analysis` to `travels/visa-processing`)
 * and branches on ctx.subId:
 *
 *   (overview)        → hub: KPIs + section cards + recent applications
 *   categories        → Visa Categories CRUD (country, type, cost, sale, days)
 *   new-application   → full application intake form (auto-prices from category)
 *   application-board → Kanban by embassy stage, drag to advance, detail drawer
 *   manage-sales      → sales ledger (cost/sale/profit/pay-status) + CSV export
 *   visa-rates        → pricing/margin cards (editable)
 *   embassy-tracking  → submission → decision-due tracker
 *   documents         → required-document checklists per visa type
 *   analysis          → approval-rate, revenue-by-country, funnel charts
 *
 * All data persists in localStorage (store key `visaApps` / `visaCats`) and every
 * mutation flows through EPAL.db so the Travels + Group dashboards stay in sync.
 * ==========================================================================*/

(function (EPAL) {
  'use strict';
  var ui = EPAL.ui, el = ui.el, db = EPAL.db, S = EPAL.store;

  var STAGES = [
    { id:'New',           color:'#8b93a7', icon:'inbox' },
    { id:'Documents',     color:'#7b5cff', icon:'folder' },
    { id:'Submitted',     color:'#2f6bff', icon:'send' },
    { id:'Under Process', color:'#f4b740', icon:'hourglass-split' },
    { id:'Approved',      color:'#23c17e', icon:'patch-check' },
    { id:'Rejected',      color:'#f0506e', icon:'x-octagon' }
  ];
  // Standard required documents per visa TYPE (generic fallback checklist).
  var DOC_REQS = {
    Tourist:  ['Passport (6m validity)','Passport-size photo','Bank statement (6m)','Hotel booking','Return air ticket','Travel insurance','NID / Birth certificate'],
    Business: ['Passport','Invitation letter','Company trade license','Bank statement','Board resolution','Photo','Cover letter'],
    Umrah:    ['Passport','Photo (white bg)','Vaccination (Meningitis)','Mahram proof (if applicable)','Hotel & transport voucher','Air ticket'],
    Work:     ['Passport','Work permit / offer letter','Medical report','Police clearance','Educational certificates','Photo'],
    Visit:    ['Passport','Sponsor invitation','Sponsor bank statement','Relationship proof','Photo','Cover letter'],
    Student:  ['Passport','Admission / I-20','Financial proof','Academic transcripts','Language test','Photo']
  };
  // PER-COUNTRY (per-embassy) checklists — the realistic differences a world-class
  // agency actually tracks. Keyed by destination country; falls back to DOC_REQS
  // (by visa type) when the country is unknown. Every item marked here is REQUIRED.
  var DOC_REQS_COUNTRY = {
    'Schengen':     ['Passport (3m beyond return, 2 blank pages)','Signed Schengen application form','2 photos (35x45mm, white bg)','Travel medical insurance (€30,000)','Confirmed round-trip flight reservation','Hotel bookings (full stay)','Bank statement (6 months)','Salary certificate / employer NOC','Cover letter','Visa fee payment slip'],
    'UAE':          ['Passport (6m validity)','Passport-size photo (white bg)','Confirmed return air ticket','Hotel booking / host details','Bank statement (3 months)','Employer NOC','Visa application form'],
    'Saudi Arabia': ['Passport (6m validity, 2 blank pages)','2 photos (40x60mm, white bg)','Meningitis (ACWY) vaccination certificate','COVID vaccination card','Mahram proof (women under 45)','Umrah package voucher (hotel + transport)','Round-trip air ticket','National ID copy'],
    'Canada':       ['Passport (valid)','Digital photo (IRCC spec)','Completed IMM 5257 form','Proof of funds / bank statements (4 months)','Employment letter & NOC','Invitation letter from host','Property / asset documents','Travel history','Biometrics appointment confirmation','Purpose of travel letter'],
    'UK':           ['Passport','Photo','Online application (VAF) printout','Bank statements (6 months)','Employment / salary evidence','Sponsor documents (if sponsored)','Accommodation details','Travel itinerary','TB test certificate'],
    'Malaysia':     ['Passport (6m validity)','Photo (white bg)','Confirmed return air ticket','Hotel booking','Bank statement (3 months)','NID copy'],
    'Thailand':     ['Passport (6m validity)','Photo (4x6cm)','Confirmed return air ticket','Hotel booking','Bank statement (min ৳80,000)','Visa application form'],
    'Singapore':    ['Passport','Photo','Form 14A','Local sponsor / company letter (LOI)','Business invitation','Bank statement','Trade license']
  };

  // Resolve the REQUIRED-document list for an application/category: prefer the
  // destination country's embassy checklist, fall back to the visa-type list.
  function docReqsFor(country, type) {
    if (country && DOC_REQS_COUNTRY[country]) return DOC_REQS_COUNTRY[country];
    return DOC_REQS[type] || DOC_REQS.Tourist;
  }
  // Materialise an app's docs array (backward-compat: derive from checklist if absent).
  function docsFor(a) {
    if (a.docs && a.docs.length) return a.docs;
    return docReqsFor(a.country, a.visaType).map(function (d){ return { name:d, done:false }; });
  }
  // Count still-missing required documents.
  function missingDocs(a) {
    var n = 0;
    docsFor(a).forEach(function (d){ if (!d.done) n++; });
    return n;
  }

  /* ---- fee / service / profit breakdown (backward-compatible) --------------
   * New apps carry embassyFee + vfsCharge + serviceFee -> customerTotal, with
   * profit == serviceFee. Legacy seeded apps only have cost/sale, so we derive:
   * embassyFee<-cost, vfsCharge<-0, serviceFee<-(sale-cost), total<-sale. -----*/
  function fees(a) {
    a = a || {};
    var embassy = +a.embassyFee || 0, vfs = +a.vfsCharge || 0, service = +a.serviceFee || 0;
    var total = +a.customerTotal || 0;
    if (!embassy && !vfs && !service && !total) {         // legacy record
      embassy = +a.cost || 0;
      total = +a.sale || 0;
      service = total - embassy; if (service < 0) service = 0;
    } else if (!total) {
      total = embassy + vfs + service;
    }
    var cost = embassy + vfs;
    return { embassy:embassy, vfs:vfs, service:service, customerTotal:total, cost:cost, profit:total - cost };
  }

  // Stage helpers + advance-gate (block leaving Documents with an incomplete file).
  var ADVANCE_BLOCK = ['Submitted','Under Process','Approved'];
  function canAdvance(a, target) {
    if (ADVANCE_BLOCK.indexOf(target) >= 0) {
      var miss = missingDocs(a);
      if (miss > 0) {
        ui.toast(miss + ' required document' + (miss>1?'s':'') + ' still missing — complete the checklist before submitting', 'error');
        return false;
      }
    }
    return true;
  }
  // Post a visa sale to finance exactly once (guarded by app.posted).
  function postVisaToFinance(a) {
    if (a.posted) return;
    var f = fees(a);
    db.postSale('travels', {
      amount: f.customerTotal || a.sale || 0,
      cost: f.cost || a.cost || 0,
      ref: a.id,
      desc: 'Visa ' + (a.country || ''),
      customer: a.applicant || '',
      category: 'visa', vendor: 'Embassy / VFS'
    });
    a.posted = true;
    db.saveVisaApp(a);
    db.notify({ level:'info', title:'Visa posted to finance', text:a.applicant+' · '+ui.money(f.customerTotal||a.sale||0), companyId:'travels', icon:'cash-coin' });
  }

  function apps() { return S.list('visaApps'); }
  function cats() { return db.visaCats(); }

  /* Section band. Labels mirror the registry (config.js subs), plus Overview —
     rendered on the bare route but not listed as a registry sub. 9 sections →
     .tabs-dense, like Finance's 13. */
  var SECTIONS = [['overview', 'Overview'], ['categories', 'Visa Categories'], ['new-application', 'New Application'],
    ['application-board', 'Application Board'], ['manage-sales', 'Manage Sales'], ['visa-rates', 'Visa Rates'],
    ['embassy-tracking', 'Embassy Tracking'], ['documents', 'Required Documents'], ['analysis', 'Analysis']];
  function sectionNav(sub) {
    var nav = el('div.tab-underline.tabs-dense.mb-3');
    SECTIONS.forEach(function (s) {
      nav.appendChild(el('button' + (sub === s[0] ? '.active' : ''), { text: s[1],
        onclick: function () { EPAL.router.navigate('travels/visa-processing' + (s[0] === 'overview' ? '' : '/' + s[0])); } }));
    });
    return nav;
  }

  EPAL.view('travels/visa-processing', {
    render: function (ctx) {
      var sub = ctx.subId || 'overview';
      var page = el('div.page');
      var map = {
        overview:'Visa Processing', categories:'Visa Categories', 'new-application':'New Application',
        'application-board':'Application Board', 'manage-sales':'Manage Sales', 'visa-rates':'Visa Rates',
        'embassy-tracking':'Embassy Tracking', documents:'Required Documents', analysis:'Analysis'
      };
      page.appendChild(EPAL.pageHead({
        eyebrow: sub === 'overview' ? 'Epal Travels' : 'Travels › Visa Processing',
        icon:'passport-fill', title: map[sub] || 'Visa Processing',
        sub: subDesc(sub)
      }));
      // SECTION NAV — the house full-bleed underline band (owner grammar
      // 2026-07-15). Replaces the page-action buttons ("Overview" / "New
      // Application") that were navigating between sections.
      page.appendChild(sectionNav(sub));

      ({ overview:overview, categories:categories, 'new-application':newApplication,
         'application-board':board, 'manage-sales':manageSales, 'visa-rates':visaRates,
         'embassy-tracking':embassy, documents:documents, analysis:analysis }[sub] || overview)(page, ctx);

      ctx.mount.appendChild(page);
    }
  });

  function subDesc(sub) {
    return ({ overview:'End-to-end visa lifecycle — from enquiry to embassy decision.',
      categories:'Define destinations, visa types, pricing and processing time.',
      'new-application':'Capture a new visa application; pricing auto-fills from the category.',
      'application-board':'Track every application across embassy stages. Drag to advance.',
      'manage-sales':'Costing, sale value, profit and payment status for every application.',
      'visa-rates':'Published rates and margins by destination.',
      'embassy-tracking':'Submissions, appointment slots and decision-due dates.',
      documents:'Standard document checklists per visa type.',
      analysis:'Approval rate, revenue by country and pipeline analytics.' }[sub]) || '';
  }

  /* ======================================================= OVERVIEW HUB */
  function overview(page) {
    var a = apps();
    var revenue = a.reduce(function (s,x){ return s+fees(x).customerTotal; }, 0);
    var profit = a.reduce(function (s,x){ return s+fees(x).profit; }, 0);
    var approved = a.filter(function (x){ return x.stage==='Approved'; });
    var rejected = a.filter(function (x){ return x.stage==='Rejected'; });
    var decided = approved.length + rejected.length;
    var rate = decided ? Math.round(approved.length / decided * 100) : 0;
    var inProcess = a.filter(function (x){ return ['Submitted','Under Process'].indexOf(x.stage)>=0; });
    var unpaid = a.filter(function (x){ return x.payStatus && x.payStatus!=='Paid'; });
    var outstanding = unpaid.reduce(function (s,x){ return s+fees(x).customerTotal; }, 0);
    var margin = revenue ? Math.round(profit/revenue*100) : 0;
    // 7 KPIs — slim cards, one row (~30% smaller, same text); click any for a breakdown.
    page.appendChild(el('div.kpi-grid.kpi-slim.kpi-onerow.stagger', null, [
      kpi('Applications', a.length, 'passport', function(){ kpiApps(a); }),
      kpi('Approval Rate', rate + '%', 'patch-check-fill', function(){ kpiApproval(a); }),
      kpi('In Process', inProcess.length, 'hourglass-split', function(){ kpiList('In Process — '+inProcess.length, 'hourglass-split', inProcess, [['Submitted', a.filter(function(x){return x.stage==='Submitted';}).length], ['Under Process', a.filter(function(x){return x.stage==='Under Process';}).length]]); }),
      kpi('Sales Value', ui.money(revenue,{compact:true}), 'cash-coin', function(){ kpiSales(a); }),
      kpi('Profit', ui.money(profit,{compact:true}), 'graph-up-arrow', function(){ kpiProfit(a); }),
      kpi('Avg Margin', margin + '%', 'percent', function(){ kpiMargin(a); }),
      kpi('Outstanding', ui.money(outstanding,{compact:true}), 'wallet2', function(){ kpiList('Outstanding Payment', 'wallet2', unpaid, [['Unpaid apps', unpaid.length], ['Total outstanding', ui.money(outstanding)]]); })
    ]));

    // --- Action Center: what needs attention (each row navigates) ---
    var cats2 = cats();
    function catDays(x){ var c=cats2.filter(function(c2){return c2.id===x.catId;})[0]||{days:14}; return c.days||14; }
    var overdue    = a.filter(function(x){ return x.stage==='Under Process' && new Date(new Date(x.created).getTime()+catDays(x)*86400000) < new Date(); });
    var needsAction = a.filter(function(x){ return ['New','Documents'].indexOf(x.stage)>=0; });
    var unpaid     = a.filter(function(x){ return x.payStatus && x.payStatus!=='Paid'; });
    var submitted  = a.filter(function(x){ return x.stage==='Submitted'; });
    var acAlerts = [
      overdue.length    ? { icon:'hourglass-bottom',    tone:'error',   n:overdue.length,    text:'visa decisions overdue',                      route:'travels/visa-processing/embassy-tracking' } : null,
      needsAction.length ? { icon:'file-earmark-plus',  tone:'warning', n:needsAction.length, text:'applications awaiting documents / submission', route:'travels/visa-processing/application-board' } : null,
      unpaid.length     ? { icon:'cash-coin',           tone:'warning', n:unpaid.length,     text:'applications with outstanding payment',       route:'travels/visa-processing/manage-sales' } : null,
      submitted.length  ? { icon:'send-fill',           tone:'info',    n:submitted.length,  text:'submitted — awaiting embassy decision',       route:'travels/visa-processing/embassy-tracking' } : null
    ].filter(Boolean);
    if (acAlerts.length) {
      page.appendChild(el('div.section-label',{text:'Action Center — needs attention'}));
      page.appendChild(el('div.card', null, [ el('div.card-body', null, acAlerts.map(function(al){
        return el('div.data-row', { style:{cursor:'pointer'}, onclick:(function(rt){ return function(){ EPAL.router.navigate(rt); }; })(al.route) }, [
          ui.frag('<span class="notif-ico notif-'+al.tone+'">'+ui.icon(al.icon)+'</span>'),
          el('div.flex-1', null, [ el('span.strong',{text:al.n+' '}), el('span.text-dim',{text:al.text}) ]),
          ui.frag('<span class="text-mute">'+ui.icon('chevron-right')+'</span>')
        ]);
      })) ]));
    }

    // Visa Destinations map + Destination League + Embassy Stage funnel
    visaMap(page, a);
    countryLeague(page, a);
    stageFunnel(page, a);

    var sections = [
      ['categories','Visa Categories','tags-fill','Destinations, types & pricing'],
      ['new-application','New Application','file-earmark-plus-fill','Capture a fresh application'],
      ['application-board','Application Board','kanban-fill','Kanban across embassy stages'],
      ['manage-sales','Manage Sales','cash-stack','Costing, profit & payments'],
      ['visa-rates','Visa Rates','currency-exchange','Published rates & margins'],
      ['embassy-tracking','Embassy Tracking','buildings','Slots & decision dates'],
      ['documents','Required Documents','list-check','Checklists per visa type'],
      ['analysis','Analysis','bar-chart-line-fill','Approval & revenue analytics']
    ];
    page.appendChild(el('div.section-label',{text:'Sections'}));
    page.appendChild(el('div.scaffold-grid.stagger', null, sections.map(function (s){
      return el('a.scaffold-card', { href:'#/travels/visa-processing/'+s[0] }, [
        el('div.scaffold-ico',{html:'<i class="bi bi-'+s[2]+'"></i>'}),
        el('div', null, [ el('h4',{text:s[1]}), el('p',{text:s[3]}) ]) ]);
    })));
  }

  /* ======================================================= CATEGORIES */
  function categories(page) {
    var host = el('div'); page.appendChild(host);
    page.querySelector('.page-actions').prepend(el('button.btn.btn-ghost', { html: ui.icon('plus') + ' Add Category',
      onclick: function () { editCategory(null, draw); } }));
    function draw() {
      host.innerHTML = '';
      var rows = cats().map(function (c) {
        var margin = c.sale ? Math.round((c.sale-c.cost)/c.sale*100) : 0;
        return el('tr.row-click', { onclick: (function(cc){ return function () { categoryDetail(cc, draw); }; })(c) }, [
          td('<span style="font-size:18px">'+c.flag+'</span> <span class="strong">'+ui.escapeHtml(c.country)+'</span>'),
          td(c.type), tdN(ui.money(c.cost)), tdN(ui.money(c.sale)),
          td('<span class="badge badge-good">'+margin+'%</span>'), tdN(c.days+' days'),
          td('<span class="badge '+(c.status==='active'?'badge-good':'')+'">'+c.status+'</span>')
        ]);
      });
      host.appendChild(tableCard(null, ['Destination','Type','Cost','Sale','Margin','Processing','Status'], rows,
        'No visa categories. Add your first destination.', { chipCol: 1 }));
    }
    draw();
  }
  // rich category profile — destination stats + the applications filed under it
  function categoryDetail(c, refresh) {
    var body = el('div');
    ui.modal({ title: c.flag + ' ' + c.country + ' · ' + c.type, icon: 'tags-fill', size: 'lg', body: body, footer: false });
    var appsFor = apps().filter(function (a) { return a.catId === c.id || (a.country === c.country && a.visaType === c.type); });
    var revenue = appsFor.reduce(function (s, a) { return s + fees(a).customerTotal; }, 0);
    var approved = appsFor.filter(function (a) { return a.stage === 'Approved'; }).length;
    var margin = c.sale ? Math.round((c.sale - c.cost) / c.sale * 100) : 0;
    var actions = el('div.flex.gap-1.items-center', { style: { marginLeft: 'auto' } });
    actions.appendChild(el('button.btn.btn-sm.btn-outline', { html: ui.icon('pencil') + ' Edit', onclick: function () { editCategory(c, refresh || function () { EPAL.router.render(); }); } }));
    body.appendChild(el('div.card', null, [ el('div.card-body', null, [ el('div.flex.items-center.gap-2.flex-wrap', null, [
      ui.frag('<span class="notif-ico notif-info" style="font-size:20px">' + c.flag + '</span>'),
      el('div.flex-1', { style: { minWidth: '180px' } }, [ el('div.fw-700', { style: { fontSize: '17px' }, text: c.country + ' — ' + c.type }),
        el('div.flex.items-center.gap-2', null, [ el('span.badge.badge-good', { text: margin + '% margin' }), el('div.text-mute.sm', { text: c.days + ' days processing' }), el('span.badge' + (c.status === 'active' ? '.badge-good' : ''), { text: c.status }) ]) ]),
      actions ]) ]) ]));
    body.appendChild(el('div.kpi-grid.kpi-compact.stagger', null, [
      kpi('Applications', appsFor.length, 'passport'), kpi('Approved', approved, 'patch-check'),
      kpi('Revenue', ui.money(revenue, { compact: true }), 'cash-coin'), kpi('Sale / Cost', ui.money(c.sale) + ' / ' + ui.money(c.cost), 'tags')
    ]));
    if (appsFor.length) {
      var trs = appsFor.slice().sort(function (x, y) { return (x.created < y.created) ? 1 : -1; }).slice(0, 10).map(function (x) {
        return el('tr.row-click', { onclick: (function (ap) { return function () { appDetail(ap); }; })(x) }, [
          td('<span class="strong">' + x.id + '</span>'), td((x.flag || '') + ' ' + ui.escapeHtml(x.applicant)), td(stBadge(x.stage).outerHTML), tdN(ui.money(fees(x).customerTotal)) ]);
      });
      body.appendChild(el('div.section-label', { text: 'Applications — ' + c.country + ' ' + c.type }));
      body.appendChild(tableCard(null, ['App', 'Applicant', 'Stage', 'Total'], trs, ''));
    } else body.appendChild(el('div.empty-state', null, [ ui.frag(ui.icon('passport')), el('h3', { text: 'No applications under this category yet' }) ]));
  }
  function editCategory(c, done) {
    var isNew = !c;
    c = c || { id:'VC-'+Date.now().toString().slice(-3), country:'', flag:'🌍', type:'Tourist', cost:0, sale:0, days:7, status:'active' };
    var body = el('div.form-grid', null, [
      inp('Country','country',c.country), inp('Flag emoji','flag',c.flag),
      sel('Visa type','type',c.type,['Tourist','Business','Umrah','Hajj','Work','Visit','Student','Transit']),
      inp('Processing days','days',c.days,'','number'),
      inp('Cost price','cost',c.cost,'','number'), inp('Sale price','sale',c.sale,'','number'),
      sel('Status','status',c.status,['active','inactive'])
    ]);
    ui.modal({ title:isNew?'Add Visa Category':'Edit Category', icon:'tags', body:body,
      actions:[{label:'Cancel',variant:'ghost'},{label:isNew?'Add':'Save',variant:'primary',onClick:function(box){
        var g=function(i){return (box.querySelector('#f-'+i)||{}).value;};
        if(!g('country').trim()){ui.toast('Country required','error');return false;}
        c.country=g('country').trim(); c.flag=g('flag')||'🌍'; c.type=g('type'); c.days=+g('days')||0;
        c.cost=+g('cost')||0; c.sale=+g('sale')||0; c.status=g('status');
        db.saveVisaCat(c); done&&done(); ui.toast('Category saved','success');
      }}] });
  }

  /* ======================================================= NEW APPLICATION */
  function newApplication(page) {
    var cl = cats();
    var form = el('div.card', null, [ el('div.card-body') ]);
    var b = form.querySelector('.card-body');

    b.appendChild(el('div.form-grid', null, [
      sec('Applicant'),
      inp('Full name','applicant','','col-2'),
      inp('Phone','phone',''), inp('Email','email',''),
      inp('Passport No','passport',''), inp('Nationality','nationality','Bangladeshi'),
      inp('Date of birth','dob','','','date'),

      sec('Visa'),
      selDyn('Destination / Category','catId', cl.map(function(c){return [c.id, c.flag+' '+c.country+' · '+c.type];})),
      inp('Travel date','travelDate','','','date'),

      sec('Fee breakdown'),
      inp('Embassy fee','embassyFee',0,'','number'),
      inp('VFS / centre charge','vfsCharge',0,'','number'),
      inp('Service fee (your margin)','serviceFee',0,'','number'),
      sel('Payment status','payStatus','Due',['Paid','Partial','Due']),
      selDyn('Assigned agent','agent', db.employees({companyId:'travels'}).map(function(e){return [e.id,e.name];})),

      sec('Notes'),
      txt('Notes','notes','','col-2')
    ]));

    // fee/profit readout + auto price from category
    var profitBar = el('div.build-banner', { style:{ marginTop:'6px' } }, [ ui.frag(ui.icon('calculator')),
      el('div', null, [ el('span',{id:'vp-readout',html:'Customer total: <strong>—</strong>'}) ]) ]);
    b.appendChild(profitBar);

    function recompute() {
      var em = +val('embassyFee')||0, vf = +val('vfsCharge')||0, sf = +val('serviceFee')||0;
      var total = em + vf + sf; var profit = sf;
      // scope to the form (it may still be detached during build, or already
      // torn down after navigation) — never assume the readout is in document
      var out = b.querySelector('#vp-readout') || ui.$('#vp-readout');
      if (!out) return;
      out.innerHTML = 'Embassy '+ui.money(em)+' + VFS '+ui.money(vf)+' + Service '+ui.money(sf)+
        ' = Customer total <strong>'+ui.money(total)+'</strong> · profit <strong class="text-good">'+ui.money(profit)+'</strong>';
    }
    function applyCat(c) {
      if (!c) return;
      setVal('embassyFee', c.cost); setVal('vfsCharge', 0); setVal('serviceFee', Math.max(0,(c.sale||0)-(c.cost||0))); recompute();
    }
    b.querySelector('#f-catId').addEventListener('change', function (e) {
      applyCat(cl.filter(function(x){return x.id===e.target.value;})[0]);
    });
    b.querySelector('#f-embassyFee').addEventListener('input', recompute);
    b.querySelector('#f-vfsCharge').addEventListener('input', recompute);
    b.querySelector('#f-serviceFee').addEventListener('input', recompute);

    b.appendChild(el('div.flex.justify-between.mt-3', null, [
      el('a.btn.btn-ghost', { href:'#/travels/visa-processing/application-board', html: ui.icon('arrow-left')+' Cancel' }),
      el('button.btn.btn-primary.btn-lg', { html: ui.icon('check-lg')+' Create Application', onclick: save })
    ]));
    page.appendChild(form);
    // preselect first cat prices
    if (cl[0]) applyCat(cl[0]);

    function val(id){ var n=ui.$('#f-'+id); return n?n.value:''; }
    function setVal(id,v){ var n=ui.$('#f-'+id); if(n) n.value=v; }
    function save() {
      if (!val('applicant').trim()) { ui.toast('Applicant name is required','error'); return; }
      var c = cl.filter(function(x){return x.id===val('catId');})[0] || {};
      var em = +val('embassyFee')||0, vf = +val('vfsCharge')||0, sf = +val('serviceFee')||0;
      var total = em + vf + sf;
      var app = {
        id:'VA-'+Date.now().toString().slice(-5),
        applicant:val('applicant').trim(), phone:val('phone'), email:val('email'),
        passport:val('passport'), nationality:val('nationality'), dob:val('dob'),
        catId:val('catId'), country:c.country||'—', flag:c.flag||'🌍', visaType:c.type||'Tourist',
        travelDate:val('travelDate'),
        embassyFee:em, vfsCharge:vf, serviceFee:sf, customerTotal:total,
        cost: em + vf, sale: total,                 // backward-compat mirror
        payStatus:val('payStatus'), agent:val('agent'), notes:val('notes'), posted:false,
        stage:'New', created:new Date().toISOString().slice(0,10),
        docs: docReqsFor(c.country, c.type).map(function (d){ return { name:d, done:false }; }),
        timeline: [{ at: Date.now(), text:'Application created' }]
      };
      db.saveVisaApp(app);
      if (app.payStatus === 'Paid') postVisaToFinance(app);
      ui.toast('Visa application '+app.id+' created','success');
      EPAL.router.navigate('travels/visa-processing/application-board');
    }
  }

  /* ======================================================= APPLICATION BOARD */
  function board(page) {
    var search = el('input.input', { placeholder:'Search applicant, passport, country…', style:{maxWidth:'320px'},
      oninput: ui.debounce(function(){ draw(); }, 150) });
    page.appendChild(el('div.mb-3', null, [ search ]));
    var host = el('div'); page.appendChild(host);

    function draw() {
      var q = search.value.toLowerCase();
      var list = apps().filter(function (a){ return !q || (a.applicant+' '+a.passport+' '+a.country).toLowerCase().indexOf(q)>=0; });
      host.innerHTML = '';
      var kb = el('div.kanban');
      STAGES.forEach(function (st) {
        var col = list.filter(function (a){ return a.stage===st.id; });
        var lst = el('div.kb-list', { 'data-stage': st.id });
        col.forEach(function (a){ lst.appendChild(appCard(a, draw)); });
        lst.addEventListener('dragover', function(e){ e.preventDefault(); lst.parentNode.classList.add('drag-over'); });
        lst.addEventListener('dragleave', function(){ lst.parentNode.classList.remove('drag-over'); });
        lst.addEventListener('drop', function(e){ e.preventDefault(); lst.parentNode.classList.remove('drag-over');
          var id=e.dataTransfer.getData('text/plain'); var a=apps().filter(function(x){return x.id===id;})[0];
          if(a && a.stage!==st.id){
            if(!canAdvance(a, st.id)){ draw(); return; }
            a.stage=st.id; a.timeline=(a.timeline||[]).concat([{at:Date.now(),text:'Moved to '+st.id}]);
            db.saveVisaApp(a);
            if(st.id==='Approved'){ db.notify({level:'success',title:'Visa Approved',text:a.applicant+' · '+a.country,companyId:'travels',icon:'patch-check-fill'}); postVisaToFinance(a); }
            draw(); }
        });
        kb.appendChild(el('div.kb-col', { style:{'--kb':st.color} }, [
          el('div.kb-col-head', null, [ el('span.kb-col-dot'),
            ui.frag('<i class="bi bi-'+st.icon+'" style="color:'+st.color+';margin-right:2px"></i>'),
            el('span.kb-col-title',{text:st.id}), el('span.kb-count',{text:String(col.length)}) ]),
          lst
        ]));
      });
      host.appendChild(kb);
    }
    draw();
  }
  function appCard(a, refresh) {
    var f = fees(a);
    var card = el('div.kb-card', { draggable:'true', 'data-id':a.id, onclick:function(){ appDetail(a, refresh); } });
    card.addEventListener('dragstart', function(e){ e.dataTransfer.setData('text/plain', a.id); card.classList.add('dragging'); });
    card.addEventListener('dragend', function(){ card.classList.remove('dragging'); });
    card.appendChild(el('div.flex.items-center.gap-1.mb-1', null, [ el('span',{style:{fontSize:'18px'},text:a.flag}),
      el('span.kb-card-title',{style:{margin:0},text:a.applicant}) ]));
    card.appendChild(el('div.text-mute.xs', { text: a.country+' · '+a.visaType+' · '+a.id }));
    var miss = missingDocs(a);
    if (miss > 0) card.appendChild(el('div.mt-1', null, [
      el('span.badge.badge-bad', { html: ui.icon('exclamation-triangle-fill')+' '+miss+' document'+(miss>1?'s':'')+' missing' }) ]));
    card.appendChild(el('div.kb-card-foot', null, [
      el('span',{html:'<span class="num strong">'+ui.money(f.customerTotal)+'</span>'}),
      payBadge(a.payStatus)
    ]));
    return card;
  }
  function appDetail(a, refresh) {
    // BUG FIX: several call sites open this detail WITHOUT a refresh callback
    // (Manage Sales row, Embassy Tracking row, category detail) — Mark Paid /
    // stage-move / doc-check / delete then threw "refresh is not a function"
    // AFTER saving. Normalise once: default to a full re-render.
    refresh = (typeof refresh === 'function') ? refresh : function () { try { EPAL.router.render(); } catch (x) {} };
    var body = el('div');
    var m = ui.modal({ title:a.applicant+' · '+a.country, icon:'passport', size:'lg', body:body, footer:false });
    function redraw() {
      body.innerHTML='';
      var f = fees(a);
      var miss = missingDocs(a);
      var badges = [ stBadge(a.stage), el('span.badge',{text:a.visaType}), payBadge(a.payStatus), el('span.badge',{text:a.id}) ];
      if (miss > 0) badges.push(el('span.badge.badge-bad',{ html: ui.icon('exclamation-triangle-fill')+' '+miss+' document'+(miss>1?'s':'')+' missing' }));
      body.appendChild(el('div.flex.gap-1.flex-wrap.mb-3', null, badges));
      body.appendChild(el('div.form-grid', null, [
        kv('Passport', a.passport||'—'), kv('Phone', a.phone||'—'),
        kv('Nationality', a.nationality||'—'), kv('Travel date', a.travelDate?ui.date(a.travelDate):'—'),
        kv('Embassy fee', ui.money(f.embassy)), kv('VFS / centre charge', ui.money(f.vfs)),
        kv('Service fee', ui.money(f.service)), kv('Customer total', ui.money(f.customerTotal)),
        kv('Profit', ui.money(f.profit)), kv('Agent', (db.employee(a.agent)||{name:'—'}).name)
      ]));
      // documents checklist (per-country / per-embassy)
      body.appendChild(el('div.flex.items-center.justify-between', null, [
        el('div.section-label',{text:'Documents'}),
        el('span.badge'+(miss>0?'.badge-bad':'.badge-good'),{text: miss>0 ? (miss+' missing') : 'Complete'}) ]));
      var dl = el('div');
      var docs = docsFor(a).slice();
      a.docs = docs;                          // persist materialised checklist shape
      docs.forEach(function (d, i) {
        dl.appendChild(el('label.data-row', { style:{cursor:'pointer'} }, [
          check(d.done, function(v){ a.docs[i]={name:d.name,done:v}; db.saveVisaApp(a); redraw(); refresh(); }),
          el('span.flex-1.sm'+(d.done?'.text-mute':''),{text:d.name}) ]));
      });
      body.appendChild(dl);
      // timeline
      body.appendChild(el('div.section-label',{text:'Timeline'}));
      body.appendChild(el('div.timeline', null, (a.timeline||[]).slice().reverse().map(function (t){
        return el('div.tl-item', null, [ el('div.tl-time',{text:ui.ago(t.at)}), el('div.tl-text',{text:t.text}) ]); })));
      // controls
      body.appendChild(el('div.divider'));
      var moveSel = el('select.select',{style:{width:'auto'},onchange:function(){
        var target = moveSel.value;
        if (target === a.stage) return;
        if (!canAdvance(a, target)) { moveSel.value = a.stage; return; }
        a.stage=target; a.timeline=(a.timeline||[]).concat([{at:Date.now(),text:'Moved to '+a.stage}]); db.saveVisaApp(a);
        if (target === 'Approved') postVisaToFinance(a);
        redraw(); refresh();
      }});
      STAGES.forEach(function(s){var o=el('option',{value:s.id,text:'Stage → '+s.id});if(s.id===a.stage)o.selected=true;moveSel.appendChild(o);});
      body.appendChild(el('div.flex.gap-1.flex-wrap', null, [
        moveSel,
        el('button.btn.btn-sm.btn-outline',{html:ui.icon('cash')+' '+(a.payStatus==='Paid'?'Mark Due':'Mark Paid'),onclick:function(){ a.payStatus=a.payStatus==='Paid'?'Due':'Paid'; db.saveVisaApp(a); if(a.payStatus==='Paid') postVisaToFinance(a); db.settleSale('travels', a.id, (fees(a).customerTotal||a.sale||0), a.applicant||'', a.payStatus==='Paid'); redraw(); refresh(); }}),
        el('button.btn.btn-sm.btn-ghost',{html:ui.icon('file-earmark-text')+' Cover Sheet',onclick:function(){ openCoverSheet(a); }}),
        el('button.btn.btn-sm.btn-danger',{html:ui.icon('trash')+' Delete',onclick:function(){ ui.confirm({title:'Delete application?',danger:true,confirmLabel:'Delete'}).then(function(ok){ if(ok){ S.removeFrom('visaApps',a.id); EPAL.bus.emit('data:changed',{store:'visaApps',action:'delete'}); m.close(); refresh(); ui.toast('Application deleted','success'); } }); }})
      ]));
      // discussion thread (@mentions notify)
      if (EPAL.comments && EPAL.comments.widget) {
        body.appendChild(el('div.section-label',{text:'Discussion'}));
        body.appendChild(EPAL.comments.widget('visaApps', a.id));
      }
    }
    redraw();
  }

  /* -------- branded Visa File Cover Sheet (EPAL.doc) --------------------- */
  function openCoverSheet(a) {
    if (!EPAL.doc || !EPAL.doc.open) { ui.toast('Document engine unavailable','error'); return; }
    var f = fees(a);
    var docs = docsFor(a);
    EPAL.doc.open({
      type:'visacover',
      title:'Visa File Cover Sheet',
      serial: EPAL.doc.numberFor ? EPAL.doc.numberFor('visacover') : a.id,
      watermark:'EPAL TRAVELS',
      badge: a.stage,
      parties:[
        { label:'Applicant', lines:[ a.applicant||'—', a.passport?('Passport: '+a.passport):'', a.phone||'', a.nationality||'' ] },
        { label:'Destination', lines:[ (a.flag||'')+' '+(a.country||'—'), (a.visaType||'')+' Visa', a.travelDate?('Travel: '+ui.date(a.travelDate)):'' ] }
      ],
      meta:[
        { label:'File No', value:a.id },
        { label:'Created', value: a.created?ui.date(a.created):'—' },
        { label:'Stage', value:a.stage },
        { label:'Agent', value:(db.employee(a.agent)||{name:'—'}).name },
        { label:'Payment', value:a.payStatus }
      ],
      columns:[ { key:'name', label:'Required Document' }, { key:'status', label:'Status' } ],
      rows: docs.map(function(d){ return { name:d.name, status: d.done ? 'Received' : 'Pending' }; }),
      totals:[
        { label:'Embassy Fee', value:ui.money(f.embassy) },
        { label:'VFS / Centre Charge', value:ui.money(f.vfs) },
        { label:'Service Fee', value:ui.money(f.service) },
        { label:'Customer Total', value:ui.money(f.customerTotal), grand:true }
      ],
      words: EPAL.doc.amountInWords ? EPAL.doc.amountInWords(f.customerTotal) : '',
      terms:'This cover sheet accompanies the applicant file. Verify every required document is received before embassy submission.',
      sign:'Processing Officer'
    });
  }

  /* ======================================================= MANAGE SALES */
  function manageSales(page) {
    page.querySelector('.page-actions').prepend(el('button.btn.btn-ghost',{html:ui.icon('download')+' Export CSV',onclick:exportSales}));
    var a = apps();
    var totalCost=0,totalSale=0,totalProfit=0,paid=0;
    a.forEach(function(x){ var f=fees(x); totalCost+=f.cost; totalSale+=f.customerTotal; totalProfit+=f.service; if(x.payStatus==='Paid')paid+=f.customerTotal; });
    page.appendChild(el('div.kpi-grid', null, [
      kpi('Customer Total', ui.money(totalSale,{compact:true}), 'cash-coin'),
      kpi('Embassy + VFS Cost', ui.money(totalCost,{compact:true}), 'wallet2'),
      kpi('Service Profit', ui.money(totalProfit,{compact:true}), 'graph-up-arrow'),
      kpi('Collected', ui.money(paid,{compact:true}), 'check2-circle')
    ]));
    var rows = a.map(function (x) {
      var f=fees(x);
      return el('tr.row-click', { onclick: function () { appDetail(x); } }, [
        td('<span class="strong">'+x.id+'</span>'), td(x.flag+' '+ui.escapeHtml(x.applicant)),
        td(x.country+' · '+x.visaType), tdN(ui.money(f.embassy)), tdN(ui.money(f.vfs)),
        td('<span class="num text-good">'+ui.money(f.service)+'</span>'), tdN(ui.money(f.customerTotal)),
        td(payBadge(x.payStatus).outerHTML), td(stBadge(x.stage).outerHTML),
        el('td', null, [ ui.rowActions(ui.actions({
          print: (function(ap){return function(){ printVisa(ap); };})(x),
          wa:    { phone:'', text: visaMsg(x) },
          gmail: { to:'', subject:'Your '+x.country+' visa — '+x.id, body: visaMsg(x) }
        })) ]) ]);
    });
    page.appendChild(tableCard('Sales Ledger', ['App','Applicant','Service','Embassy','VFS','Service Fee','Customer Total','Payment','Stage',''], rows, 'No sales yet.', { chipCol: 8 }));
  }
  function printVisa(x) {
    var f = fees(x);
    function r(k, v) { return '<tr><td>' + k + '</td><td>' + ui.escapeHtml(String(v == null ? '—' : v)) + '</td></tr>'; }
    ui.printDoc({ title: 'Visa Invoice · ' + x.id, subtitle: x.applicant + ' · ' + x.country + ' ' + x.visaType, meta: 'Visa application',
      bodyHtml: '<table>' + r('Applicant', x.applicant) + r('Service', x.country + ' · ' + x.visaType) + r('Embassy fee', ui.money(f.embassy)) +
        r('VFS', ui.money(f.vfs)) + r('Service fee', ui.money(f.service)) + r('Customer total', ui.money(f.customerTotal)) + r('Payment', x.payStatus) + r('Stage', x.stage) + '</table>' });
  }
  function visaMsg(x) {
    var f = fees(x);
    return 'Visa application ' + x.id + '\nApplicant: ' + x.applicant + '\nService: ' + x.country + ' ' + x.visaType +
      '\nTotal: ' + ui.money(f.customerTotal) + '\nStage: ' + x.stage + '\n\n— Epal Travels & Consultancy';
  }
  function exportSales() {
    var rows=[['App','Applicant','Country','Type','Embassy','VFS','ServiceFee','CustomerTotal','Payment','Stage']];
    apps().forEach(function(x){ var f=fees(x); rows.push([x.id,x.applicant,x.country,x.visaType,f.embassy,f.vfs,f.service,f.customerTotal,x.payStatus,x.stage]); });
    var blob=new Blob([rows.map(function(r){return r.join(',');}).join('\n')],{type:'text/csv'});
    var link=el('a',{href:URL.createObjectURL(blob),download:'visa-sales.csv'}); document.body.appendChild(link); link.click(); link.remove();
    ui.toast('Sales exported','success');
  }

  /* ======================================================= VISA RATES */
  function visaRates(page) {
    var grid = el('div.grid-auto.stagger');
    cats().forEach(function (c) {
      var margin = c.sale ? Math.round((c.sale-c.cost)/c.sale*100) : 0;
      grid.appendChild(el('div.card.hover', { style:{cursor:'pointer'}, onclick:function(){ editCategory(c, function(){ EPAL.router.render(); }); } }, [
        el('div.card-pad', null, [
          el('div.flex.items-center.gap-2', null, [ el('span',{style:{fontSize:'26px'},text:c.flag}),
            el('div.flex-1', null, [ el('div.fw-700',{text:c.country}), el('div.text-muted.sm',{text:c.type+' Visa'}) ]),
            el('span.badge'+(c.status==='active'?'.badge-good':''),{text:c.status}) ]),
          el('div.stat-row.mt-3', null, [
            st2('Cost', ui.money(c.cost)), st2('Sale', ui.money(c.sale)),
            st2('Margin', margin+'%'), st2('Days', String(c.days)) ])
        ])
      ]));
    });
    page.appendChild(grid);
  }

  /* ======================================================= EMBASSY TRACKING */
  function embassy(page) {
    var tracked = apps().filter(function (a){ return ['Submitted','Under Process','Approved','Rejected'].indexOf(a.stage)>=0; });
    var rows = tracked.map(function (a) {
      var cat = cats().filter(function(c){return c.id===a.catId;})[0] || { days:14 };
      var due = new Date(new Date(a.created).getTime() + cat.days*86400000);
      var overdue = a.stage==='Under Process' && due < new Date();
      return el('tr.row-click', { onclick:(function(ap){ return function(){ appDetail(ap); }; })(a) }, [
        td(a.flag+' <span class="strong">'+ui.escapeHtml(a.applicant)+'</span>'),
        td(a.country+' · '+a.visaType), td(ui.date(a.created)),
        td('<span class="'+(overdue?'text-bad':'')+'">'+ui.date(due)+'</span>'),
        td(stBadge(a.stage).outerHTML),
        td(overdue?'<span class="badge badge-bad">Overdue</span>':'<span class="badge badge-good">On track</span>'),
        el('td', null, [ ui.rowActions(ui.actions({
          print: (function(ap){ return function(){ printVisa(ap); }; })(a),
          wa:    { phone:'', text: visaMsg(a) },
          gmail: { to:'', subject:'Your '+a.country+' visa — '+a.id, body: visaMsg(a) }
        })) ]) ]);
    });
    page.appendChild(el('div.kpi-grid', null, [
      kpi('Submitted', apps().filter(function(a){return a.stage==='Submitted';}).length, 'send'),
      kpi('Under Process', apps().filter(function(a){return a.stage==='Under Process';}).length, 'hourglass-split'),
      kpi('Approved', apps().filter(function(a){return a.stage==='Approved';}).length, 'patch-check'),
      kpi('Rejected', apps().filter(function(a){return a.stage==='Rejected';}).length, 'x-octagon')
    ]));
    page.appendChild(tableCard('Embassy & Decision Tracker', ['Applicant','Service','Submitted','Decision Due','Stage','Status',''], rows, 'Nothing submitted yet.', { chipCol: 4 }));
  }

  /* ======================================================= DOCUMENTS */
  function documents(page) {
    page.appendChild(el('div.build-banner', null, [ ui.frag(ui.icon('list-check')),
      el('div',{html:'Per-embassy checklists are attached automatically to every new application by <strong>destination country</strong> (falling back to the visa-type list when the country has no custom checklist). Edit an application to tick items off — missing items raise a red alert and block embassy submission.'}) ]));

    // Per-country (per-embassy) checklists — the differentiators an agency lives by.
    page.appendChild(el('div.section-label',{text:'By destination (embassy-specific)'}));
    var cgrid = el('div.grid-auto.stagger');
    var flags = {};
    cats().forEach(function(c){ flags[c.country]=c.flag; });
    Object.keys(DOC_REQS_COUNTRY).forEach(function (country) {
      var list = DOC_REQS_COUNTRY[country];
      cgrid.appendChild(el('div.card', null, [
        el('div.card-head', null, [
          el('h3',{html:(flags[country]?flags[country]+' ':ui.icon('geo-alt-fill')+' ')+ui.escapeHtml(country)}),
          // compact Print + Send, right in the card header (no extra row)
          el('div.flex.items-center.gap-2', null, [
            el('span.card-sub',{text:list.length}),
            ui.rowActions(ui.actions({
              print: function(){ printDocList(country, list); },
              wa:    { phone:'', text: docListMsg(country, list) },
              gmail: { to:'', subject:'Required documents — '+country+' visa', body: docListMsg(country, list) }
            }))
          ])
        ]),
        el('div.card-body', null, [ el('div.data-list', null, list.map(function (d){
          return el('div.data-row', null, [ ui.frag('<span class="notif-ico notif-info">'+ui.icon('file-earmark-text')+'</span>'),
            el('div.flex-1.sm',{text:d}) ]); })) ])
      ]));
    });
    page.appendChild(cgrid);

    // Generic per-type fallback checklists.
    page.appendChild(el('div.section-label',{text:'By visa type (fallback)'}));
    var grid = el('div.grid-auto.stagger');
    Object.keys(DOC_REQS).forEach(function (type) {
      grid.appendChild(el('div.card', null, [
        el('div.card-head', null, [ el('h3',{html:ui.icon('folder-check')+' '+type+' Visa'}),
          el('div.flex.items-center.gap-2', null, [
            el('span.card-sub',{text:DOC_REQS[type].length+' documents'}),
            ui.rowActions(ui.actions({
              print: (function(t,l){ return function(){ printDocList(t+' Visa', l); }; })(type, DOC_REQS[type]),
              wa:    { phone:'', text: docListMsg(type+' Visa', DOC_REQS[type]) },
              gmail: { to:'', subject:'Required documents — '+type+' Visa', body: docListMsg(type+' Visa', DOC_REQS[type]) }
            }))
          ]) ]),
        el('div.card-body', null, [ el('div.data-list', null, DOC_REQS[type].map(function (d){
          return el('div.data-row', null, [ ui.frag('<span class="notif-ico notif-info">'+ui.icon('file-earmark-text')+'</span>'),
            el('div.flex-1.sm',{text:d}) ]); })) ])
      ]));
    });
    page.appendChild(grid);
  }
  /* ---- send / print a country's required-document checklist ---------------*/
  function printDocList(country, list) {
    ui.printDoc({ title: country + ' Visa — Required Documents', subtitle: list.length + ' documents · Epal Travels & Consultancy',
      meta: 'Visa Document Checklist', footer: 'Tick each item as you collect it.',
      bodyHtml: '<ul>' + list.map(function (d) { return '<li>' + ui.escapeHtml(d) + '</li>'; }).join('') + '</ul>' });
  }
  function docListMsg(country, list) {
    return 'Required documents for your ' + country + ' visa:\n\n' +
      list.map(function (d, i) { return (i + 1) + '. ' + d; }).join('\n') +
      '\n\nPlease prepare the above and share with us. — Epal Travels & Consultancy';
  }

  /* ======================================================= ANALYSIS */
  function analysis(page) {
    var a = apps();
    var approved=a.filter(function(x){return x.stage==='Approved';}).length;
    var rejected=a.filter(function(x){return x.stage==='Rejected';}).length;
    var decided=approved+rejected;
    var rate=decided?Math.round(approved/decided*100):0;
    page.appendChild(el('div.kpi-grid', null, [
      kpi('Approval Rate', rate+'%', 'patch-check-fill'),
      kpi('Total Decided', decided, 'clipboard-check'),
      kpi('Avg Sale', ui.money(a.length?a.reduce(function(s,x){return s+(x.sale||0);},0)/a.length:0,{compact:true}), 'cash'),
      kpi('Active Pipeline', a.length-decided, 'hourglass-split')
    ]));
    var row = el('div.two-col');
    row.appendChild(el('div.card', null, [ el('div.card-head',null,[el('h3',{html:ui.icon('bar-chart')+' Revenue by Country'})]),
      el('div.card-body',null,[ el('div',{style:{height:'260px',position:'relative'}},[el('canvas#va-country')]) ]) ]));
    row.appendChild(el('div.card', null, [ el('div.card-head',null,[el('h3',{html:ui.icon('diagram-2')+' Stage Funnel'})]),
      el('div.card-body',null,[ el('div',{style:{height:'260px',position:'relative'}},[el('canvas#va-funnel')]) ]) ]));
    page.appendChild(row);

    var byC={}; a.forEach(function(x){ byC[x.country]=(byC[x.country]||0)+(x.sale||0); });
    var countries=Object.keys(byC).sort(function(p,q){return byC[q]-byC[p];}).slice(0,8);
    requestAnimationFrame(function () {
      EPAL.charts.bar(ui.$('#va-country'), { labels:countries, datasets:[{label:'Revenue',data:countries.map(function(c){return byC[c];})}], horizontal:true, money:true });
      EPAL.charts.bar(ui.$('#va-funnel'), { labels:STAGES.map(function(s){return s.id;}),
        datasets:[{label:'Apps',data:STAGES.map(function(s){return a.filter(function(x){return x.stage===s.id;}).length;}),
        colors:STAGES.map(function(s){return s.color;})}], money:false });
    });
  }

  /* ---------------------------------------------------- shared helpers */
  function kpi(label, value, icon, onClick) {
    return el('div.kpi-card' + (onClick ? '.drill' : ''), onClick ? { onclick: onClick } : null,
      [ el('div.kpi-top',null,[ el('span.kpi-label',{text:label}), el('span.kpi-ico',{html:'<i class="bi bi-'+icon+'"></i>'}) ]),
        el('div.kpi-value',{text:String(value)}) ]);
  }

  /* ==========================================================================
   * COCKPIT — KPI drill-downs, Visa Destinations map, Destination League,
   * Embassy-Stage funnel. (Mirrors the Air Ticketing cockpit for Visa.)
   * ========================================================================*/
  function kpiShell(title, icon, stats){
    var body = el('div');
    ui.modal({ title:title, icon:icon, size:'lg', body:body, footer:false });
    if (stats && stats.length) body.appendChild(el('div.card.mb-2', null, [ el('div.card-body', null, [ el('div.stat-row', null, stats.map(function(s){ return st2(s[0], String(s[1])); })) ]) ]));
    return body;
  }
  function countryStats(list){
    var m={}; list.forEach(function(x){ var c=x.country||'—'; if(!m[c]) m[c]={ country:c, flag:x.flag||'🌍', apps:0, revenue:0, profit:0, approved:0, decided:0 };
      var o=m[c], f=fees(x); o.apps++; o.revenue+=f.customerTotal; o.profit+=f.profit;
      if(x.stage==='Approved'){ o.approved++; o.decided++; } else if(x.stage==='Rejected'){ o.decided++; } });
    return Object.keys(m).map(function(k){ return m[k]; }).sort(function(a,b){ return b.apps-a.apps; });
  }
  function appsTable(list){
    return EPAL.table({
      columns:[
        { key:'id', label:'App', render:function(x){ return '<span class="mono xs text-mute">'+ui.escapeHtml(x.id||'')+'</span>'; } },
        { key:'applicant', label:'Applicant', render:function(x){ return '<span class="strong">'+(x.flag||'')+' '+ui.escapeHtml(x.applicant||'—')+'</span>'; } },
        { key:'country', label:'Destination' }, { key:'visaType', label:'Type', badge:{} },
        { key:'stage', label:'Stage', render:function(x){ return stBadge(x.stage).outerHTML; }, sortVal:function(x){ return x.stage; } },
        { key:'total', label:'Sale', num:true, sortVal:function(x){ return fees(x).customerTotal; }, render:function(x){ return ui.money(fees(x).customerTotal); } },
        { key:'profit', label:'Profit', num:true, sortVal:function(x){ return fees(x).profit; }, render:function(x){ var p=fees(x).profit; return '<span class="num '+(p>=0?'text-good':'text-bad')+'">'+ui.money(p)+'</span>'; } },
        { key:'payStatus', label:'Pay', render:function(x){ return x.payStatus? payBadge(x.payStatus).outerHTML : '—'; }, sortVal:function(x){ return x.payStatus||''; } }
      ],
      rows:list, searchKeys:['id','applicant','country','visaType'], quickFilter:'stage', filterPanel:true, pageSize:8,
      exportName:'visa-apps.csv', pdfTitle:'Visa Applications', onRow:function(x){ appDetail(x, function(){}); },
      empty:{ icon:'passport', title:'No applications here' }
    }).el;
  }
  function countryTable(rows){
    return EPAL.table({
      columns:[
        { key:'country', label:'Destination', render:function(r){ return '<span class="strong">'+(r.flag||'')+' '+ui.escapeHtml(r.country)+'</span>'; } },
        { key:'apps', label:'Apps', num:true }, { key:'revenue', label:'Sales', num:true, money:true },
        { key:'profit', label:'Profit', num:true, sortVal:function(r){ return r.profit; }, render:function(r){ return '<span class="num '+(r.profit>=0?'text-good':'text-bad')+'">'+ui.money(r.profit)+'</span>'; } },
        { key:'approval', label:'Approval', num:true, sortVal:function(r){ return r.decided? r.approved/r.decided*100 : 0; }, render:function(r){ return '<span class="num">'+(r.decided?Math.round(r.approved/r.decided*100):0)+'%</span>'; } }
      ],
      rows:rows, pageSize:12, exportName:'visa-by-country.csv', pdfTitle:'By Destination', empty:{ icon:'geo-alt', title:'No data' }
    }).el;
  }
  function countryChart(body, rows, key, title){
    var cid=ui.uid('vcc');
    body.appendChild(el('div.card.mb-2', null, [ el('div.card-head', null, [ el('h3',{ html: ui.icon('bar-chart')+' '+title }) ]),
      el('div.card-body', null, [ el('div',{ style:{ height:'240px', position:'relative' } }, [ el('canvas',{ id:cid }) ]) ]) ]));
    requestAnimationFrame(function(){ var c=document.getElementById(cid); if(!c) return;
      var rr=rows.slice().sort(function(a,b){ return b[key]-a[key]; }).slice(0,8);
      EPAL.charts.bar(c, { labels:rr.map(function(r){ return r.country; }), horizontal:true, money:true, datasets:[{ label:title, data:rr.map(function(r){ return r[key]; }) }] }); });
  }
  function kpiList(title, icon, list, stats){ var body=kpiShell(title, icon, stats); body.appendChild(el('div.card', null, [ el('div.card-body', null, [ appsTable(list) ]) ])); }
  function kpiApps(a){
    var byStage={}; a.forEach(function(x){ byStage[x.stage||'—']=(byStage[x.stage||'—']||0)+1; });
    var stats=STAGES.filter(function(s){ return byStage[s.id]; }).map(function(s){ return [s.id, byStage[s.id]]; });
    if(!stats.length) stats=[['Applications', a.length]];
    var body=kpiShell('Applications — '+a.length, 'passport', stats);
    body.appendChild(el('div.section-label',{text:'By Destination'}));
    body.appendChild(el('div.card.mb-2', null, [ el('div.card-body', null, [ countryTable(countryStats(a)) ]) ]));
    body.appendChild(el('div.section-label',{text:'All Applications'}));
    body.appendChild(el('div.card', null, [ el('div.card-body', null, [ appsTable(a) ]) ]));
  }
  function kpiApproval(a){
    var app=a.filter(function(x){ return x.stage==='Approved'; }), rej=a.filter(function(x){ return x.stage==='Rejected'; });
    var pend=a.filter(function(x){ return ['Approved','Rejected'].indexOf(x.stage)<0; });
    var decided=app.length+rej.length, rate=decided?Math.round(app.length/decided*100):0;
    var body=kpiShell('Approval Rate — '+rate+'%', 'patch-check-fill', [['Approved',app.length],['Rejected',rej.length],['Pending',pend.length],['Decided',decided]]);
    body.appendChild(el('div.section-label',{text:'Approval by Destination'}));
    body.appendChild(el('div.card', null, [ el('div.card-body', null, [ countryTable(countryStats(a)) ]) ]));
  }
  function kpiSales(a){
    var total=a.reduce(function(s,x){ return s+fees(x).customerTotal; },0), avg=a.length?Math.round(total/a.length):0;
    var body=kpiShell('Sales Value — '+ui.money(total), 'cash-coin', [['Total',ui.money(total)],['Applications',a.length],['Avg / app',ui.money(avg)]]);
    countryChart(body, countryStats(a), 'revenue', 'Sales by Destination');
    body.appendChild(el('div.card', null, [ el('div.card-body', null, [ countryTable(countryStats(a)) ]) ]));
  }
  function kpiProfit(a){
    var revenue=a.reduce(function(s,x){ return s+fees(x).customerTotal; },0);
    var embassy=a.reduce(function(s,x){ return s+fees(x).embassy; },0), vfs=a.reduce(function(s,x){ return s+fees(x).vfs; },0);
    var profit=a.reduce(function(s,x){ return s+fees(x).profit; },0);
    var body=kpiShell('Profit — '+ui.money(profit), 'graph-up-arrow', [['Sales',ui.money(revenue)],['Embassy',ui.money(embassy)],['VFS',ui.money(vfs)],['Profit',ui.money(profit)]]);
    var wid=ui.uid('vwf');
    body.appendChild(el('div.card.mb-2', null, [ el('div.card-head', null, [ el('h3',{ html: ui.icon('bar-chart-steps')+' Profit Waterfall' }), el('span.card-sub',{ text:'sales → embassy → vfs → profit' }) ]),
      el('div.card-body', null, [ el('div',{ style:{ height:'240px', position:'relative' } }, [ el('canvas',{ id:wid }) ]) ]) ]));
    requestAnimationFrame(function(){ var c=document.getElementById(wid); if(!c) return;
      EPAL.charts.bar(c, { labels:['Sales','− Embassy','− VFS','Profit'], datasets:[{ label:'৳', data:[[0,revenue],[revenue-embassy,revenue],[profit,revenue-embassy],[0,profit]], colors:['#2f6bff','#f0506e','#e2721b','#23c17e'] }] }); });
    body.appendChild(el('div.card', null, [ el('div.card-body', null, [ countryTable(countryStats(a)) ]) ]));
  }
  function kpiMargin(a){
    var revenue=a.reduce(function(s,x){ return s+fees(x).customerTotal; },0), profit=a.reduce(function(s,x){ return s+fees(x).profit; },0);
    var cs=countryStats(a).filter(function(r){ return r.revenue; });
    var best=cs.slice().sort(function(x,y){ return (y.profit/y.revenue)-(x.profit/x.revenue); })[0];
    var worst=cs.slice().sort(function(x,y){ return (x.profit/x.revenue)-(y.profit/y.revenue); })[0];
    var body=kpiShell('Average Margin — '+(revenue?Math.round(profit/revenue*100):0)+'%', 'percent', [
      ['Overall', (revenue?Math.round(profit/revenue*100):0)+'%'],
      ['Best', best? best.country+' · '+Math.round(best.profit/best.revenue*100)+'%':'—'],
      ['Weakest', worst? worst.country+' · '+Math.round(worst.profit/worst.revenue*100)+'%':'—'] ]);
    body.appendChild(el('div.section-label',{text:'Margin by Destination'}));
    body.appendChild(el('div.card', null, [ el('div.card-body', null, [ countryTable(countryStats(a)) ]) ]));
  }

  /* ---- VISA DESTINATIONS MAP — arcs from Dhaka to each destination country,
     bubbles sized by application volume. Click a destination for its stats. */
  var COUNTRY_XY = { 'Malaysia':[3.14,101.69],'Thailand':[13.75,100.5],'UAE':[24.0,54.0],'Saudi Arabia':[24.7,46.7],
    'Schengen':[48.5,9.0],'Singapore':[1.35,103.82],'Canada':[45.42,-75.7],'UK':[51.5,-0.13],'USA':[38.9,-77.0],
    'Qatar':[25.28,51.53],'Turkey':[39.0,35.0],'India':[28.6,77.2],'Australia':[-33.87,151.2] };
  var VISA_ORIGIN=[23.84,90.40], VMAP_W=1000, VMAP_H=440, VLNG0=-92, VLNG1=116, VLAT0=-40, VLAT1=62;
  function vproj(ll){ if(!ll) return null; return [ (ll[1]-VLNG0)/(VLNG1-VLNG0)*VMAP_W, (VLAT1-ll[0])/(VLAT1-VLAT0)*VMAP_H ]; }
  function vr1(n){ return Math.round(n*10)/10; }
  function varc(a, b){ var mx=(a[0]+b[0])/2,my=(a[1]+b[1])/2,dx=b[0]-a[0],dy=b[1]-a[1],d=Math.hypot(dx,dy)||1,nx=-dy/d,ny=dx/d,k=Math.min(0.3,40/d+0.13);
    var cx=mx+nx*d*k,cy=my+ny*d*k; if(cy>my){ cx=mx-nx*d*k; cy=my-ny*d*k; } return 'M'+vr1(a[0])+' '+vr1(a[1])+' Q '+vr1(cx)+' '+vr1(cy)+' '+vr1(b[0])+' '+vr1(b[1]); }

  function visaMap(page, a){
    var list=countryStats(a).filter(function(r){ return vproj(COUNTRY_XY[r.country]); });
    if(!list.length) return;
    var maxA=list[0].apps||1, op=vproj(VISA_ORIGIN);
    var svg='<svg viewBox="0 0 '+VMAP_W+' '+VMAP_H+'" preserveAspectRatio="xMidYMid meet" aria-hidden="true" style="width:100%;height:auto;display:block">';
    for (var gx=0; gx<=VMAP_W; gx+=50) svg+='<line x1="'+gx+'" y1="0" x2="'+gx+'" y2="'+VMAP_H+'" stroke="currentColor" stroke-width="0.5" opacity="0.05"/>';
    for (var gy=0; gy<=VMAP_H; gy+=50) svg+='<line x1="0" y1="'+gy+'" x2="'+VMAP_W+'" y2="'+gy+'" stroke="currentColor" stroke-width="0.5" opacity="0.05"/>';
    list.forEach(function(r,i){ var p=vproj(COUNTRY_XY[r.country]), path=varc(op,p), w=(1+ (r.apps/maxA)*4).toFixed(1), o=(0.30+0.5*(r.apps/maxA)).toFixed(2), dur=(7+i*0.5).toFixed(1);
      svg+='<path id="varc-'+i+'" d="'+path+'" fill="none" stroke="#7b5cff" stroke-opacity="'+o+'" stroke-width="'+w+'" stroke-linecap="round"/>'
        +'<circle r="'+(1.8+(r.apps/maxA)*2).toFixed(1)+'" fill="#c9b8ff"><animateMotion dur="'+dur+'s" repeatCount="indefinite" rotate="auto"><mpath href="#varc-'+i+'"/></animateMotion></circle>'
        +'<path class="visa-hit" data-idx="'+i+'" d="'+path+'" fill="none" stroke="transparent" stroke-width="16" style="cursor:pointer"/>'; });
    list.forEach(function(r){ var p=vproj(COUNTRY_XY[r.country]), rad=(5+Math.sqrt(r.apps)*2.3).toFixed(1);
      svg+='<circle cx="'+vr1(p[0])+'" cy="'+vr1(p[1])+'" r="'+rad+'" fill="#7b5cff" fill-opacity="0.85" stroke="#ffffff" stroke-width="1" stroke-opacity="0.5"/>'
        +'<text x="'+vr1(p[0])+'" y="'+vr1(p[1]-rad-4)+'" font-size="15" text-anchor="middle">'+(r.flag||'')+'</text>'
        +'<text x="'+vr1(p[0])+'" y="'+vr1(p[1]+3.5)+'" font-size="10" font-weight="700" text-anchor="middle" fill="#ffffff">'+r.apps+'</text>'; });
    // origin (Dhaka) with pulse
    svg+='<circle cx="'+vr1(op[0])+'" cy="'+vr1(op[1])+'" r="10" fill="#1A43BF" opacity="0.22"><animate attributeName="r" values="8;18;8" dur="3s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.28;0;0.28" dur="3s" repeatCount="indefinite"/></circle>'
      +'<circle cx="'+vr1(op[0])+'" cy="'+vr1(op[1])+'" r="6" fill="#1A43BF" stroke="#ffffff" stroke-width="1.5" stroke-opacity="0.6"/>'
      +'<text x="'+vr1(op[0])+'" y="'+vr1(op[1]-12)+'" font-size="12.5" font-weight="700" fill="currentColor" opacity="0.85" text-anchor="middle">Dhaka</text>';
    svg+='</svg>';
    page.appendChild(el('div.section-label',{ html: ui.icon('globe-americas')+' Visa Destinations' }));
    var card=el('div.card', null, [ el('div.card-head', null, [ el('h3',{ html: ui.icon('geo-alt-fill')+' Where We Send Travellers' }),
      el('span.card-sub',{ text: list.length+' destinations · click one for details' }) ]),
      el('div.card-body', null, [ el('div.route-map', { style:{ color:'var(--text-mute)' }, html: svg }) ]) ]);
    page.appendChild(card);
    var svgEl=card.querySelector('.route-map svg');
    if(svgEl) Array.prototype.forEach.call(svgEl.querySelectorAll('.visa-hit'), function(hit){ hit.addEventListener('click', function(){ countryModal(list[+hit.getAttribute('data-idx')], a); }); });
  }
  function countryModal(r, all){
    var list=all.filter(function(x){ return x.country===r.country; });
    var rate=r.decided?Math.round(r.approved/r.decided*100):0, avg=r.apps?Math.round(r.revenue/r.apps):0;
    var body=kpiShell((r.flag||'🌍')+' '+r.country, 'geo-alt-fill', [['Applications',r.apps],['Sales',ui.money(r.revenue)],['Profit',ui.money(r.profit)],['Approval',rate+'%'],['Avg / app',ui.money(avg)]]);
    body.appendChild(el('div.section-label',{ text:'Applications' }));
    body.appendChild(el('div.card', null, [ el('div.card-body', null, [ appsTable(list) ]) ]));
  }
  function countryLeague(page, a){
    var rows=countryStats(a).slice(0,10); if(!rows.length) return;
    var maxR=rows[0].revenue||rows[0].apps||1, medals=['#f4c542','#c9ccd3','#cd7f32'], list=el('div');
    rows.forEach(function(r,i){ var rate=r.decided?Math.round(r.approved/r.decided*100):0, barW=Math.max(4,Math.round((r.revenue/maxR)*100));
      var rank=i<3? '<span style="display:inline-grid;place-items:center;width:22px;height:22px;border-radius:50%;background:'+medals[i]+';color:#1b2438;font-weight:800;font-size:11px">'+(i+1)+'</span>'
        : '<span class="text-mute" style="width:22px;display:inline-block;text-align:center">'+(i+1)+'</span>';
      list.appendChild(el('div.data-row', { style:{ cursor:'pointer' }, onclick:(function(rr){ return function(){ countryModal(rr, a); }; })(r) }, [
        ui.frag(rank), ui.frag('<span style="font-size:20px;line-height:1">'+(r.flag||'🌍')+'</span>'),
        el('div.flex-1', { style:{ minWidth:'120px' } }, [ el('div.strong',{ text:r.country }),
          el('div', { style:{ height:'6px', borderRadius:'6px', background:'var(--surface-3,#2a3350)', overflow:'hidden', marginTop:'5px', maxWidth:'240px' } }, [ el('div',{ style:{ height:'100%', width:barW+'%', background:'#7b5cff' } }) ]) ]),
        el('div', { style:{ textAlign:'right', minWidth:'150px' } }, [ el('div.num.strong',{ text: ui.money(r.revenue,{compact:true}) }),
          el('div.num.xs.text-mute',{ text: r.apps+' apps · '+rate+'%' }) ]) ]));
    });
    page.appendChild(el('div.section-label',{ html: ui.icon('trophy')+' Destination League' }));
    page.appendChild(el('div.card', null, [ el('div.card-body', null, [ list ]) ]));
  }
  function stageFunnel(page, a){
    var by={}; a.forEach(function(x){ by[x.stage||'—']=(by[x.stage||'—']||0)+1; });
    var labels=STAGES.map(function(s){ return s.id; }).filter(function(s){ return by[s]; }); if(labels.length<2) return;
    var colors=labels.map(function(s){ return (STAGES.filter(function(x){ return x.id===s; })[0]||{}).color||'#8b93a7'; });
    var cid=ui.uid('vsf'), chips=el('div.flex.gap-1.flex-wrap.mt-2');
    labels.forEach(function(s){ var m=STAGES.filter(function(x){ return x.id===s; })[0]||{};
      chips.appendChild(el('button.badge', { style:{ cursor:'pointer', background:(m.color||'#888')+'22', color:m.color||'#888', border:'0' },
        onclick:(function(st, mm){ return function(){ kpiList(st+' applications', mm.icon||'passport', a.filter(function(x){ return x.stage===st; }), [['Count', by[st]]]); }; })(s, m) },
        [ ui.frag((m.icon? ui.icon(m.icon)+' ':'')+s+' · '+by[s]) ])); });
    page.appendChild(el('div.section-label',{ html: ui.icon('funnel-fill')+' Embassy Stage Funnel' }));
    page.appendChild(el('div.card', null, [ el('div.card-body', null, [ el('div',{ style:{ height:'240px', position:'relative' } }, [ el('canvas',{ id:cid }) ]), chips ]) ]));
    requestAnimationFrame(function(){ var c=document.getElementById(cid); if(!c) return;
      EPAL.charts.bar(c, { labels:labels, horizontal:true, money:false, datasets:[{ label:'Applications', data:labels.map(function(s){ return by[s]; }), colors:colors }] }); });
  }
  function tableCard(title, headers, rows, emptyMsg, opts) {
    var card = el('div.card');
    if (title) card.appendChild(el('div.card-head', null, [ el('h3',{text:title}) ]));
    if (!rows.length) { card.appendChild(el('div.empty-state',null,[ ui.frag(ui.icon('inbox')), el('h3',{text:'Nothing here yet'}), el('p.text-muted',{text:emptyMsg||''}) ])); return card; }
    var table = el('table.tbl');
    // right-align numeric HEADERS over their right-aligned (.num) cells — detect
    // which columns are numeric from the first row so we never mistag a text column.
    var numCol = {}, first = rows[0];
    if (first && first.children) for (var i = 0; i < first.children.length; i++)
      if (first.children[i].classList && first.children[i].classList.contains('num')) numCol[i] = 1;
    table.innerHTML = '<thead><tr>'+headers.map(function(h,i){return '<th'+(numCol[i]?' class="num"':'')+'>'+h+'</th>';}).join('')+'</tr></thead>';
    var tb = el('tbody'); rows.forEach(function(r){ tb.appendChild(r); }); table.appendChild(tb);
    card.appendChild(tcToolbar(title, headers, tb, numCol, opts || {}));
    card.appendChild(el('div.table-wrap', null, [ table ]));
    return card;
  }
  // Toolbar for tableCard lists: half-search + optional value CHIPS (opts.chipCol =
  // header index) + Export CSV + PDF. Search & chips combine; both filter visible rows.
  function tcToolbar(title, headers, tb, numCol, opts) {
    opts = opts || {};
    var countEl = el('span.dt-count');
    var chipState = { col: (opts.chipCol == null ? null : opts.chipCol), val: '__all' };
    var searchIn = el('input.input.dt-search', { placeholder: 'Search…', oninput: apply });
    function cellText(tr, i) { var c = tr.children[i]; return c ? (c.textContent || '').trim() : ''; }
    function apply() {
      var q = searchIn.value.toLowerCase(), n = 0;
      [].forEach.call(tb.children, function (tr) {
        var okQ = !q || (tr.textContent || '').toLowerCase().indexOf(q) >= 0;
        var okC = chipState.col == null || chipState.val === '__all' || cellText(tr, chipState.col) === chipState.val;
        var show = okQ && okC; tr.style.display = show ? '' : 'none'; if (show) n++;
      });
      countEl.textContent = n + ' record' + (n === 1 ? '' : 's');
    }
    var chipWrap = null;
    if (chipState.col != null) {
      chipWrap = el('div.dt-chips'); var vals = {};
      [].forEach.call(tb.children, function (tr) { var v = cellText(tr, chipState.col); if (v) vals[v] = 1; });
      var mk = function (v, label) { var b = el('button.dt-chip' + (chipState.val === v ? '.active' : ''), { text: label, onclick: function () { chipState.val = v; [].forEach.call(chipWrap.children, function (x) { x.classList.toggle('active', x === b); }); apply(); } }); return b; };
      chipWrap.appendChild(mk('__all', 'All'));
      Object.keys(vals).sort().forEach(function (v) { chipWrap.appendChild(mk(v, v)); });
    }
    function vis() { return [].filter.call(tb.children, function (tr) { return tr.style.display !== 'none'; }); }
    function cells(tr) { return [].map.call(tr.children, function (td2) { return (td2.textContent || '').trim(); }); }
    function csv() {
      var lines = [headers].concat(vis().map(cells));
      var blob = new Blob([lines.map(function (l) { return l.map(function (c) { return '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"'; }).join(','); }).join('\n')], { type: 'text/csv' });
      var a = el('a', { href: URL.createObjectURL(blob), download: (title || 'export').replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '.csv' });
      document.body.appendChild(a); a.click(); a.remove(); ui.toast('Exported', 'success');
    }
    function pdf() {
      var head = '<tr>' + headers.map(function (h, i) { return '<th' + (numCol[i] ? ' class="num"' : '') + '>' + ui.escapeHtml(h || '') + '</th>'; }).join('') + '</tr>';
      var body = vis().map(function (tr) { var cs = cells(tr); return '<tr>' + cs.map(function (c, i) { return '<td' + (numCol[i] ? ' class="num"' : '') + '>' + ui.escapeHtml(c) + '</td>'; }).join('') + '</tr>'; }).join('');
      ui.printDoc({ title: title || 'Report', subtitle: vis().length + ' records', meta: 'Export', bodyHtml: '<table>' + head + body + '</table>' });
    }
    countEl.textContent = tb.children.length + ' records';
    return el('div.tc-toolbar', null, [
      el('div.dt-search-wrap.half', null, [ ui.frag(ui.icon('search', 'dt-search-ico')), searchIn ]),
      chipWrap, el('div.spacer'), countEl,
      el('button.btn.btn-sm.btn-ghost', { html: ui.icon('filetype-csv') + ' Export', onclick: csv }),
      el('button.btn.btn-sm.btn-ghost', { html: ui.icon('filetype-pdf') + ' PDF', onclick: pdf })
    ]);
  }
  function td(html){ var t=el('td'); t.innerHTML=html; return t; }
  function tdN(html){ var t=el('td.num'); t.innerHTML=html; return t; }
  function kv(k,v){ return el('div.field',null,[ el('label',{text:k}), el('div.fw-600',{text:String(v)}) ]); }
  function st2(l,v){ return el('div.stat',null,[ el('div.stat-label',{text:l}), el('div.stat-value',{text:v}) ]); }
  function stBadge(stage){ var s=STAGES.filter(function(x){return x.id===stage;})[0]||{color:'#8b93a7'};
    var b=el('span.badge',{text:stage}); b.style.color=s.color; b.style.background=s.color+'22'; return b; }
  function payBadge(p){ return el('span.badge'+(p==='Paid'?'.badge-good':p==='Partial'?'.badge-warn':'.badge-bad'),{text:p}); }
  function check(on, onChange){ var i=el('input',{type:'checkbox'}); i.checked=on; i.addEventListener('change',function(e){e.stopPropagation();onChange(i.checked);}); i.addEventListener('click',function(e){e.stopPropagation();}); return i; }
  function inp(label,id,val,cls,type){ return el('div.field'+(cls?'.'+cls:''),null,[ el('label',{text:label}), el('input.input',{id:'f-'+id,type:type||'text',value:val==null?'':val}) ]); }
  function txt(label,id,val,cls){ return el('div.field'+(cls?'.'+cls:''),null,[ el('label',{text:label}), el('textarea.input',{id:'f-'+id,rows:'2',html:ui.escapeHtml(val||'')}) ]); }
  function sel(label,id,val,opts){ var s=el('select.select',{id:'f-'+id}); opts.forEach(function(o){var op=el('option',{value:o,text:o});if(o===val)op.selected=true;s.appendChild(op);}); return el('div.field',null,[el('label',{text:label}),s]); }
  function selDyn(label,id,pairs){ var s=el('select.select',{id:'f-'+id}); pairs.forEach(function(p){ s.appendChild(el('option',{value:p[0],text:p[1]})); }); return el('div.field',null,[el('label',{text:label}),s]); }
  function sec(t){ return el('div.form-section-title',{text:t}); }

})(window.EPAL = window.EPAL || {});
