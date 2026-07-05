/* ============================================================================
 * EPAL GROUP ERP  ·  views/travels/air-ticketing.js
 * ----------------------------------------------------------------------------
 * AIR TICKETING — the second fully-operational Travels module (after Visa
 * Processing). ONE registered view serves every sub-route; the router falls
 * back from `.../refunds` to `travels/air-ticketing` and we branch on
 * ctx.subId:
 *
 *   (overview)     → hub: KPIs + section cards + recent tickets
 *   ticketing      → Direct Sale — issue a ticket (auto profit, masters-driven)
 *   manage-sales   → sales ledger + detail drawer (void/re-issue/refund) + CSV
 *   airlines       → Airlines master CRUD (name / IATA / country / status)
 *   airports       → Airports master CRUD (name / IATA / city / country)
 *   bsp            → BSP / ADM reconciliation (match, ADM tracker, unused)
 *   refunds        → Refund tracker (5-stage lifecycle + payout math)
 *
 * Persists in localStorage (airTickets / airlines / airports / airRefunds /
 * airBsp). Issuing a ticket flows through EPAL.db.postSale() so the Travels +
 * Group dashboards and consolidated finance move in real time — the module is a
 * live node on the cross-company artery, not an island.
 * ==========================================================================*/

(function (EPAL) {
  'use strict';
  var ui = EPAL.ui, el = ui.el, db = EPAL.db, S = EPAL.store;

  // Ticket status vocabulary + colours (mirrors real GDS booking states).
  var STATUSES = [
    { id:'Hold',       color:'#f4b740', icon:'hourglass-split' },
    { id:'Confirmed',  color:'#2f6bff', icon:'check2-circle' },
    { id:'Issued',     color:'#23c17e', icon:'ticket-perforated' },
    { id:'Re-issued',  color:'#7b5cff', icon:'arrow-repeat' },
    { id:'Void',       color:'#8b93a7', icon:'x-octagon' },
    { id:'Refunded',   color:'#f0506e', icon:'cash-coin' }
  ];
  var REFUND_STAGES = ['Requested','Filed','Received','Paid','Rejected'];

  function tickets()  { return db.airTickets(); }
  function airlines() { return db.airlines(); }
  function airports() { return db.airports(); }

  EPAL.view('travels/air-ticketing', {
    render: function (ctx) {
      var sub = ctx.subId || 'overview';
      var page = el('div.page');
      var map = {
        overview:'Air Ticketing', ticketing:'Direct Sale', 'manage-sales':'Manage Sales',
        airlines:'Airlines', airports:'Airports', bsp:'BSP / ADM Recon', refunds:'Refund Tracker'
      };
      page.appendChild(EPAL.pageHead({
        eyebrow: sub === 'overview' ? 'Epal Travels' : 'Travels › Air Ticketing',
        icon:'airplane-fill', title: map[sub] || 'Air Ticketing',
        sub: subDesc(sub),
        actions: [
          sub !== 'overview' ? el('a.btn.btn-ghost', { href:'#/travels/air-ticketing', html: ui.icon('grid') + ' Overview' }) : null,
          sub !== 'ticketing' ? el('a.btn.btn-primary', { href:'#/travels/air-ticketing/ticketing', html: ui.icon('plus-lg') + ' Direct Sale' }) : null
        ]
      }));

      ({ overview:overview, ticketing:directSale, 'manage-sales':manageSales,
         airlines:airlinesView, airports:airportsView, bsp:bspView, refunds:refundsView }[sub] || overview)(page, ctx);

      ctx.mount.appendChild(page);
    }
  });

  function subDesc(sub) {
    return ({ overview:'Issue, re-issue, refund and void air tickets — with BSP/ADM reconciliation.',
      ticketing:'Issue a new ticket. Fare and profit compute live; masters drive every dropdown.',
      'manage-sales':'Costing, sale value, profit and payment status for every ticket sold.',
      airlines:'Airline master — carriers, IATA designators and status.',
      airports:'Airport master — stations, IATA codes and cities.',
      bsp:'Reconcile agency sales against the BSP billing file; track ADMs and unused tickets.',
      refunds:'Every refund request from filing to payout, with airline-penalty math.' }[sub]) || '';
  }

  /* ======================================================= OVERVIEW HUB */
  function overview(page) {
    var t = tickets();
    var revenue = t.reduce(function (s,x){ return s + (x.sale||0); }, 0);
    var profit  = t.reduce(function (s,x){ return s + ((x.sale||0)-(x.cost||0)); }, 0);
    var issued  = t.filter(function (x){ return x.status==='Issued'; }).length;
    var pendRef = db.airRefunds().filter(function (r){ return ['Requested','Filed','Received'].indexOf(r.status)>=0; }).length;
    page.appendChild(el('div.kpi-grid.stagger', null, [
      kpi('Tickets Sold', t.length, 'ticket-perforated'),
      kpi('Issued', issued, 'check2-circle'),
      kpi('Sales Value', ui.money(revenue,{compact:true}), 'cash-coin'),
      kpi('Gross Profit', ui.money(profit,{compact:true}), 'graph-up-arrow')
    ]));

    var sections = [
      ['ticketing','Direct Sale','ticket-detailed-fill','Issue a new ticket'],
      ['manage-sales','Manage Sales','cash-stack','Costing, profit & payments'],
      ['airlines','Airlines','airplane-engines-fill','Carrier master & IATA'],
      ['airports','Airports','geo-alt-fill','Stations & IATA codes'],
      ['bsp','BSP / ADM Recon','shield-check','Match sales, track ADMs'],
      ['refunds','Refund Tracker','arrow-counterclockwise','Filing → payout lifecycle']
    ];
    page.appendChild(el('div.section-label',{text:'Sections'}));
    page.appendChild(el('div.scaffold-grid.stagger', null, sections.map(function (s){
      return el('a.scaffold-card', { href:'#/travels/air-ticketing/'+s[0] }, [
        el('div.scaffold-ico',{html:'<i class="bi bi-'+s[2]+'"></i>'}),
        el('div', null, [ el('h4',{text:s[1]}), el('p',{text:s[3]}) ]) ]);
    })));

    // recent tickets
    page.appendChild(el('div.section-label',{text:'Recent Tickets'}));
    var recent = t.slice().sort(function (a,b){ return a.created<b.created?1:-1; }).slice(0,8);
    var rows = recent.map(function (x) {
      return el('tr.row-click', { onclick: (function(tk){ return function(){ ticketDetail(tk, function(){ EPAL.router.render(); }); }; })(x) }, [
        td('<span class="strong">'+x.id+'</span>'), td(ui.escapeHtml(x.passenger)),
        td('<span class="mono">'+x.route+'</span>'), td(x.airlineCode+' · '+x.flightNo),
        tdN(ui.money(x.sale)), td(statusBadge(x.status).outerHTML) ]);
    });
    page.appendChild(tableCard(null, ['Ticket','Passenger','Route','Flight','Sale','Status'], rows, 'No tickets issued yet.'));
  }

  /* ======================================================= DIRECT SALE (issue) */
  function directSale(page) {
    var als = airlines().filter(function(a){ return a.status==='active'; });
    var aps = airports();
    var vendors = db.vendors();
    var agents = db.employees({ companyId:'travels' });

    if (!als.length || !aps.length) {
      page.appendChild(el('div.empty-state', null, [ ui.frag(ui.icon('airplane')),
        el('h3',{text:'Set up masters first'}),
        el('p.text-muted',{text:'Add at least one active airline and one airport before issuing tickets.'}),
        el('div.flex.gap-1.justify-center.mt-2', null, [
          el('a.btn.btn-primary',{href:'#/travels/air-ticketing/airlines',html:ui.icon('airplane-engines')+' Airlines'}),
          el('a.btn.btn-outline',{href:'#/travels/air-ticketing/airports',html:ui.icon('geo-alt')+' Airports'}) ]) ]));
      return;
    }

    var apPairs = aps.map(function(a){ return [a.iata, a.iata+' · '+a.city]; });
    var form = el('div.card', null, [ el('div.card-body') ]);
    var b = form.querySelector('.card-body');

    b.appendChild(el('div.form-grid', null, [
      sec('Passenger'),
      inp('Full name','passenger','','col-2'),
      inp('Phone','phone',''), inp('Passport No','passport',''),

      sec('Itinerary'),
      selDyn('From','fromCode', apPairs),
      selDyn('To','toCode', apPairs),
      sel('Trip type','tripType','One-way',['One-way','Round','Multi-City']),
      selDyn('Airline','airlineCode', als.map(function(a){ return [a.iata, a.iata+' · '+a.name]; })),
      inp('Flight number','flightNo',''),
      inp('PNR / Booking ref','pnr',''),
      inp('Travel date','travelDate','','','date'),
      inp('Ticket number','ticketNo',''),

      sec('Sourcing & Fare'),
      selDyn('Vendor / Source','vendor', [['Direct Airline','Direct Airline']].concat(vendors.map(function(v){ return [v.name, v.name]; }))),
      sel('Portal / GDS','portal','Sabre',['Sabre','Amadeus','Galileo','Direct']),
      inp('Cost price','cost',0,'','number'),
      inp('Sale price','sale',0,'','number'),
      sel('Pay status (to vendor)','payStatus','Due',['Paid','Partial','Due']),
      selDyn('Assigned agent','agent', agents.map(function(e){ return [e.id, e.name]; }))
    ]));

    var profitBar = el('div.build-banner', { style:{ marginTop:'6px' } }, [ ui.frag(ui.icon('calculator')),
      el('div', null, [ el('span',{id:'tk-readout',html:'Gross profit: <strong>—</strong>'}) ]) ]);
    b.appendChild(profitBar);

    function val(id){ var n=ui.$('#f-'+id); return n?n.value:''; }
    function recompute() {
      var cost = +val('cost')||0, sale = +val('sale')||0;
      var p = sale - cost, m = sale ? Math.round(p/sale*100) : 0;
      ui.$('#tk-readout').innerHTML = 'Gross profit: <strong class="'+(p>=0?'text-good':'text-bad')+'">'+ui.money(p)+'</strong> · margin '+m+'%';
    }
    b.querySelector('#f-cost').addEventListener('input', recompute);
    b.querySelector('#f-sale').addEventListener('input', recompute);
    recompute();

    b.appendChild(el('div.flex.justify-between.mt-3', null, [
      el('a.btn.btn-ghost', { href:'#/travels/air-ticketing/manage-sales', html: ui.icon('arrow-left')+' Cancel' }),
      el('button.btn.btn-primary.btn-lg', { html: ui.icon('check-lg')+' Issue Ticket', onclick: save })
    ]));
    page.appendChild(form);

    function save() {
      if (!val('passenger').trim()) { ui.toast('Passenger name is required','error'); return; }
      if (val('fromCode') === val('toCode')) { ui.toast('Origin and destination must differ','error'); return; }
      var al = als.filter(function(a){ return a.iata===val('airlineCode'); })[0] || {};
      var t = {
        id:'TK-' + Date.now().toString().slice(-5),
        pnr: val('pnr') || (String.fromCharCode(65+Math.floor(Math.random()*26))+String.fromCharCode(65+Math.floor(Math.random()*26))+Math.floor(1000+Math.random()*9000)),
        ticketNo: val('ticketNo'),
        passenger: val('passenger').trim(), phone: val('phone'), passport: val('passport'),
        fromCode: val('fromCode'), toCode: val('toCode'), route: val('fromCode')+' → '+val('toCode'),
        tripType: val('tripType'), airlineCode: val('airlineCode'), airline: al.name || val('airlineCode'),
        flightNo: val('flightNo'), vendor: val('vendor'), portal: val('portal'),
        travelDate: val('travelDate'), purchaseDate: new Date().toISOString().slice(0,10),
        cost:+val('cost')||0, sale:+val('sale')||0, costPaid: val('payStatus')==='Paid' ? (+val('cost')||0) : 0,
        payStatus: val('payStatus'), agent: val('agent'), currency:'BDT',
        status:'Issued', created:new Date().toISOString().slice(0,10),
        timeline:[{ at: Date.now(), text:'Ticket issued' }]
      };
      db.saveAirTicket(t);
      // fire the cross-company sale so Travels + Group finance move live
      db.postSale('travels', { amount:t.sale, cost:t.cost, ref:t.id, desc:'Air ticket '+t.route+' ('+t.airlineCode+')', customer:t.passenger });
      db.notify({ level:'success', title:'Ticket Issued', text:t.passenger+' · '+t.route+' · '+ui.money(t.sale), companyId:'travels', icon:'ticket-perforated-fill' });
      ui.toast('Ticket '+t.id+' issued','success');
      EPAL.router.navigate('travels/air-ticketing/manage-sales');
    }
  }

  /* ======================================================= MANAGE SALES */
  function manageSales(page) {
    page.querySelector('.page-actions').prepend(el('button.btn.btn-ghost',{html:ui.icon('download')+' Export CSV',onclick:exportSales}));
    var search = el('input.input', { placeholder:'Search passenger, PNR, route…', style:{maxWidth:'320px'},
      oninput: ui.debounce(function(){ draw(); }, 150) });
    var kpis = el('div.kpi-grid'); page.appendChild(kpis);
    page.appendChild(el('div.my-3', null, [ search ]));
    var host = el('div'); page.appendChild(host);

    function draw() {
      var q = search.value.toLowerCase();
      var t = tickets().filter(function (x){ return !q || (x.passenger+' '+x.pnr+' '+x.route+' '+x.id).toLowerCase().indexOf(q)>=0; });
      var all = tickets();
      var totalCost=0,totalSale=0,collected=0;
      all.forEach(function(x){ totalCost+=x.cost||0; totalSale+=x.sale||0; if(x.payStatus==='Paid')collected+=x.sale||0; });
      kpis.innerHTML='';
      [ kpi('Total Sales', ui.money(totalSale,{compact:true}), 'cash-coin'),
        kpi('Total Cost', ui.money(totalCost,{compact:true}), 'wallet2'),
        kpi('Gross Profit', ui.money(totalSale-totalCost,{compact:true}), 'graph-up-arrow'),
        kpi('Tickets', all.length, 'ticket-perforated') ].forEach(function(k){ kpis.appendChild(k); });

      var rows = t.map(function (x) {
        var p=(x.sale||0)-(x.cost||0);
        return el('tr.row-click', { onclick: (function(tk){ return function(){ ticketDetail(tk, draw); }; })(x) }, [
          td('<span class="strong">'+x.id+'</span>'), td(ui.escapeHtml(x.passenger)),
          td('<span class="mono">'+x.route+'</span>'), td(x.airlineCode+' · '+x.pnr),
          tdN(ui.money(x.cost)), tdN(ui.money(x.sale)),
          td('<span class="num '+(p>=0?'text-good':'text-bad')+'">'+ui.money(p)+'</span>'),
          td(payBadge(x.payStatus).outerHTML), td(statusBadge(x.status).outerHTML) ]);
      });
      host.innerHTML='';
      host.appendChild(tableCard('Ticket Sales Ledger',
        ['Ticket','Passenger','Route','Airline · PNR','Cost','Sale','Profit','Payment','Status'], rows, 'No tickets sold yet.'));
    }
    draw();
  }
  function exportSales() {
    var rows=[['Ticket','Passenger','Route','Airline','PNR','Cost','Sale','Profit','Payment','Status']];
    tickets().forEach(function(x){ rows.push([x.id,x.passenger,x.route,x.airline,x.pnr,x.cost,x.sale,(x.sale||0)-(x.cost||0),x.payStatus,x.status]); });
    downloadCsv(rows, 'air-ticket-sales.csv');
    ui.toast('Sales exported','success');
  }

  function ticketDetail(t, refresh) {
    var body = el('div');
    var m = ui.modal({ title:t.passenger+' · '+t.route, icon:'ticket-perforated', size:'lg', body:body, footer:false });
    function redraw() {
      body.innerHTML='';
      body.appendChild(el('div.flex.gap-1.flex-wrap.mb-3', null, [
        statusBadge(t.status), el('span.badge',{text:t.tripType}), payBadge(t.payStatus), el('span.badge',{text:t.id}) ]));
      body.appendChild(el('div.form-grid', null, [
        kv('PNR', t.pnr||'—'), kv('Ticket No', t.ticketNo||'—'),
        kv('Airline', (t.airlineCode||'')+' · '+(t.airline||'—')), kv('Flight', t.flightNo||'—'),
        kv('Passport', t.passport||'—'), kv('Phone', t.phone||'—'),
        kv('Travel date', t.travelDate?ui.date(t.travelDate):'—'), kv('Purchased', t.purchaseDate?ui.date(t.purchaseDate):'—'),
        kv('Vendor', t.vendor||'—'), kv('Portal', t.portal||'—'),
        kv('Cost', ui.money(t.cost)), kv('Sale', ui.money(t.sale)),
        kv('Profit', ui.money((t.sale||0)-(t.cost||0))), kv('Agent', (db.employee(t.agent)||{name:'—'}).name)
      ]));
      body.appendChild(el('div.section-label',{text:'Timeline'}));
      body.appendChild(el('div.timeline', null, (t.timeline||[]).slice().reverse().map(function (e){
        return el('div.tl-item', null, [ el('div.tl-time',{text:ui.ago(e.at)}), el('div.tl-text',{text:e.text}) ]); })));
      body.appendChild(el('div.divider'));

      var moveSel = el('select.select',{style:{width:'auto'},onchange:function(){ setStatus(moveSel.value); }});
      STATUSES.forEach(function(s){ var o=el('option',{value:s.id,text:'Status → '+s.id}); if(s.id===t.status)o.selected=true; moveSel.appendChild(o); });
      body.appendChild(el('div.flex.gap-1.flex-wrap', null, [
        moveSel,
        el('button.btn.btn-sm.btn-outline',{html:ui.icon('cash')+' '+(t.payStatus==='Paid'?'Mark Due':'Mark Paid'),onclick:function(){ t.payStatus=t.payStatus==='Paid'?'Due':'Paid'; db.saveAirTicket(t); redraw(); refresh&&refresh(); }}),
        el('button.btn.btn-sm.btn-outline',{html:ui.icon('arrow-counterclockwise')+' Refund',onclick:function(){ m.close(); refundFromTicket(t, refresh); }}),
        el('button.btn.btn-sm.btn-danger',{html:ui.icon('trash')+' Delete',onclick:function(){ ui.confirm({title:'Delete ticket?',danger:true,confirmLabel:'Delete'}).then(function(ok){ if(ok){ S.removeFrom('airTickets',t.id); EPAL.bus.emit('data:changed',{store:'airTickets',action:'delete'}); m.close(); refresh&&refresh(); ui.toast('Ticket deleted','success'); } }); }})
      ]));
    }
    function setStatus(next) {
      if (next === t.status) return;
      t.status = next; t.timeline = (t.timeline||[]).concat([{ at: Date.now(), text:'Status → '+next }]);
      db.saveAirTicket(t);
      if (next==='Refunded') { m.close(); refundFromTicket(t, refresh); return; }
      redraw(); refresh && refresh();
    }
    redraw();
  }

  /* ======================================================= AIRLINES master */
  function airlinesView(page) {
    page.querySelector('.page-actions').prepend(el('button.btn.btn-ghost',{html:ui.icon('plus')+' Add Airline',onclick:function(){ editAirline(null, draw); }}));
    var host = el('div'); page.appendChild(host);
    function draw() {
      host.innerHTML='';
      var rows = airlines().map(function (a) {
        return el('tr.row-click', { onclick:(function(al){ return function(){ editAirline(al, draw); }; })(a) }, [
          td('<span class="badge mono">'+ui.escapeHtml(a.iata)+'</span>'),
          td('<span class="strong">'+ui.escapeHtml(a.name)+'</span>'),
          td(ui.escapeHtml(a.country||'—')),
          td('<span class="badge '+(a.status==='active'?'badge-good':'')+'">'+a.status+'</span>') ]);
      });
      host.appendChild(tableCard(null, ['IATA','Airline','Country','Status'], rows, 'No airlines. Add your first carrier.'));
    }
    draw();
  }
  function editAirline(a, done) {
    var isNew = !a;
    a = a || { id:'AL-'+Date.now().toString().slice(-4), name:'', iata:'', country:'', status:'active' };
    var body = el('div.form-grid', null, [
      inp('Airline name','name',a.name,'col-2'),
      inp('IATA code','iata',a.iata), inp('Country','country',a.country),
      sel('Status','status',a.status,['active','inactive'])
    ]);
    ui.modal({ title:isNew?'Add Airline':'Edit Airline', icon:'airplane-engines', body:body,
      actions:[{label:'Cancel',variant:'ghost'},{label:isNew?'Add':'Save',variant:'primary',onClick:function(box){
        var g=function(i){return (box.querySelector('#f-'+i)||{}).value;};
        if(!g('name').trim()){ ui.toast('Airline name required','error'); return false; }
        a.name=g('name').trim(); a.iata=(g('iata')||'').toUpperCase().trim(); a.country=g('country').trim(); a.status=g('status');
        db.saveAirline(a); done&&done(); ui.toast('Airline saved','success');
      }}] });
  }

  /* ======================================================= AIRPORTS master */
  function airportsView(page) {
    page.querySelector('.page-actions').prepend(el('button.btn.btn-ghost',{html:ui.icon('plus')+' Add Airport',onclick:function(){ editAirport(null, draw); }}));
    var host = el('div'); page.appendChild(host);
    function draw() {
      host.innerHTML='';
      var rows = airports().map(function (a) {
        return el('tr.row-click', { onclick:(function(ap){ return function(){ editAirport(ap, draw); }; })(a) }, [
          td('<span class="badge mono">'+ui.escapeHtml(a.iata)+'</span>'),
          td('<span class="strong">'+ui.escapeHtml(a.name)+'</span>'),
          td(ui.escapeHtml(a.city||'—')), td(ui.escapeHtml(a.country||'—')) ]);
      });
      host.appendChild(tableCard(null, ['IATA','Airport','City','Country'], rows, 'No airports. Add your first station.'));
    }
    draw();
  }
  function editAirport(a, done) {
    var isNew = !a;
    a = a || { id:'AP-'+Date.now().toString().slice(-4), name:'', iata:'', city:'', country:'' };
    var body = el('div.form-grid', null, [
      inp('Airport name','name',a.name,'col-2'),
      inp('IATA code','iata',a.iata), inp('City','city',a.city), inp('Country','country',a.country)
    ]);
    ui.modal({ title:isNew?'Add Airport':'Edit Airport', icon:'geo-alt', body:body,
      actions:[{label:'Cancel',variant:'ghost'},{label:isNew?'Add':'Save',variant:'primary',onClick:function(box){
        var g=function(i){return (box.querySelector('#f-'+i)||{}).value;};
        if(!g('name').trim()){ ui.toast('Airport name required','error'); return false; }
        if(!g('iata').trim()){ ui.toast('IATA code required','error'); return false; }
        a.name=g('name').trim(); a.iata=(g('iata')||'').toUpperCase().trim(); a.city=g('city').trim(); a.country=g('country').trim();
        db.saveAirport(a); done&&done(); ui.toast('Airport saved','success');
      }}] });
  }

  /* ======================================================= BSP / ADM RECON */
  function bspView(page) {
    var bsp = db.airBsp();
    var api = bsp.api || {};
    var matched = (bsp.txns||[]).filter(function(x){ return x.status==='Matched'; }).length;
    var openAdm = (bsp.adms||[]).filter(function(x){ return x.status!=='Settled'; }).length;
    var admTotal = (bsp.adms||[]).reduce(function(s,x){ return s+(x.amount||0); }, 0);
    var unusedVal = (bsp.unused||[]).reduce(function(s,x){ return s+(x.value||0); }, 0);

    // API connection banner
    page.appendChild(el('div.build-banner', null, [ ui.frag(ui.icon(api.connected?'plug-fill':'plug')),
      el('div',{html:'<strong>BSPlink</strong> '+(api.connected?'connected':'disconnected')+' · '+ui.escapeHtml(api.endpoint||'—')+' · key '+ui.escapeHtml(api.keyMasked||'—')+' · last sync '+ui.escapeHtml(api.lastSync||'—')}),
      el('button.btn.btn-sm.btn-outline',{style:{marginLeft:'auto'},html:ui.icon('arrow-repeat')+' Sync now',onclick:function(){ ui.toast('BSP file re-synced (mock)','success'); }}) ]));

    page.appendChild(el('div.kpi-grid', null, [
      kpi('Matched', matched+' / '+(bsp.txns||[]).length, 'check2-circle'),
      kpi('Open ADMs', openAdm, 'exclamation-octagon'),
      kpi('ADM Exposure', ui.money(admTotal,{compact:true}), 'cash-stack'),
      kpi('Unused Value', ui.money(unusedVal,{compact:true}), 'recycle')
    ]));

    // reconciliation table
    var txRows = (bsp.txns||[]).map(function (x) {
      var diff = (x.bspAmt||0)-(x.agencyAmt||0);
      return el('tr', null, [
        td('<span class="strong">'+ui.escapeHtml(x.passenger)+'</span>'), td(ui.escapeHtml(x.airline)),
        td(ui.date(x.issueDate)), tdN(ui.money(x.agencyAmt)), tdN(ui.money(x.bspAmt)),
        td('<span class="num '+(diff===0?'text-mute':'text-bad')+'">'+(diff?ui.money(diff):'—')+'</span>'),
        td(reconBadge(x.status).outerHTML) ]);
    });
    page.appendChild(tableCard('Sales vs BSP Billing', ['Passenger','Airline','Issued','Agency','BSP','Diff','Match'], txRows, 'Nothing to reconcile.'));

    // ADM tracker + unused tickets side by side
    var row = el('div.two-col');
    var admRows = (bsp.adms||[]).map(function (x) {
      return el('tr', null, [ td('<span class="strong">'+ui.escapeHtml(x.airline)+'</span>'),
        td('<span class="mono">'+ui.escapeHtml(x.ticketNo)+'</span>'), td(ui.escapeHtml(x.reason)),
        tdN(ui.money(x.amount)), td(admBadge(x.status).outerHTML) ]);
    });
    row.appendChild(el('div', null, [ el('div.section-label',{text:'ADM Tracker'}),
      tableCard(null, ['Airline','Ticket','Reason','Amount','Status'], admRows, 'No ADMs raised.') ]));
    var unRows = (bsp.unused||[]).map(function (x) {
      return el('tr', null, [ td('<span class="strong">'+ui.escapeHtml(x.passenger)+'</span>'),
        td(ui.escapeHtml(x.airline)), tdN(ui.money(x.value)), td(ui.date(x.expiry)) ]);
    });
    row.appendChild(el('div', null, [ el('div.section-label',{text:'Unused Tickets (recoverable)'}),
      tableCard(null, ['Passenger','Airline','Value','Expiry'], unRows, 'No unused tickets.') ]));
    page.appendChild(row);
  }

  /* ======================================================= REFUND TRACKER */
  function refundsView(page) {
    page.querySelector('.page-actions').prepend(el('button.btn.btn-ghost',{html:ui.icon('plus')+' New Refund',onclick:function(){ editRefund(null, draw); }}));
    var host = el('div'); page.appendChild(host);
    function draw() {
      host.innerHTML='';
      var refs = db.airRefunds();
      var pending = refs.filter(function(r){ return ['Requested','Filed','Received'].indexOf(r.status)>=0; });
      var payout = refs.reduce(function(s,r){ return s+(r.netRefund||0); }, 0);
      host.appendChild(el('div.kpi-grid', null, [
        kpi('Total Refunds', refs.length, 'arrow-counterclockwise'),
        kpi('In Progress', pending.length, 'hourglass-split'),
        kpi('Customer Payout', ui.money(payout,{compact:true}), 'cash-coin'),
        kpi('Penalties', ui.money(refs.reduce(function(s,r){ return s+(r.penalty||0); },0),{compact:true}), 'dash-circle')
      ]));
      var rows = refs.map(function (r) {
        return el('tr.row-click', { onclick:(function(rf){ return function(){ editRefund(rf, draw); }; })(r) }, [
          td('<span class="strong">'+r.id+'</span>'), td(ui.escapeHtml(r.passenger)),
          td('<span class="mono">'+ui.escapeHtml(r.pnr||'—')+'</span>'), td(ui.escapeHtml(r.airline||'—')),
          tdN(ui.money(r.gross)), tdN(ui.money(r.penalty)), tdN(ui.money(r.netRefund)),
          td(refundBadge(r.status).outerHTML) ]);
      });
      host.appendChild(tableCard('Refund Requests', ['Ref','Passenger','PNR','Airline','Gross','Penalty','Net Refund','Status'], rows, 'No refunds yet.'));
    }
    draw();
  }
  function refundFromTicket(t, after) {
    editRefund({ id:'RF-'+Date.now().toString().slice(-4), pnr:t.pnr, passenger:t.passenger, airline:t.airline,
      ticketNo:t.ticketNo, gross:t.sale||0, airlineRefund:Math.max(0,(t.cost||0)-3000), penalty:3000, fee:1000,
      netRefund:Math.max(0,(t.sale||0)-4000), method:'Bank', status:'Requested',
      date:new Date().toISOString().slice(0,10), _fromTicket:t.id }, after, true);
  }
  function editRefund(r, done, isNew) {
    isNew = isNew || !r;
    r = r || { id:'RF-'+Date.now().toString().slice(-4), pnr:'', passenger:'', airline:'', ticketNo:'',
      gross:0, airlineRefund:0, penalty:0, fee:0, netRefund:0, method:'Bank', status:'Requested', date:new Date().toISOString().slice(0,10) };
    var body = el('div');
    body.appendChild(el('div.form-grid', null, [
      sec('Booking'),
      inp('Passenger','passenger',r.passenger,'col-2'),
      inp('PNR','pnr',r.pnr), inp('Airline','airline',r.airline),
      inp('Ticket No','ticketNo',r.ticketNo), inp('Refund date','date',r.date,'','date'),
      sec('Calculation'),
      inp('Original sale (gross)','gross',r.gross,'','number'),
      inp('Airline refund','airlineRefund',r.airlineRefund,'','number'),
      inp('Airline penalty','penalty',r.penalty,'','number'),
      inp('Agent service fee','fee',r.fee,'','number'),
      sec('Payout'),
      sel('Method','method',r.method,['Bank','bKash','Nagad','Cash','Card Reversal']),
      sel('Status','status',r.status, REFUND_STAGES)
    ]));
    var net = el('div.build-banner',{style:{marginTop:'6px'}},[ ui.frag(ui.icon('calculator')),
      el('div',null,[ el('span',{id:'rf-net',html:'Net refund to customer: <strong>—</strong>'}) ]) ]);
    body.appendChild(net);
    function g(i){ return (body.querySelector('#f-'+i)||{}).value; }
    function recompute(){ var n=(+g('gross')||0)-(+g('penalty')||0)-(+g('fee')||0);
      body.querySelector('#rf-net').innerHTML='Net refund to customer: <strong>'+ui.money(n)+'</strong>'; return n; }
    ['gross','penalty','fee'].forEach(function(id){ var n=body.querySelector('#f-'+id); if(n) n.addEventListener('input',recompute); });
    recompute();
    ui.modal({ title:isNew?'New Refund':'Refund '+r.id, icon:'arrow-counterclockwise', size:'lg', body:body,
      actions:[{label:'Cancel',variant:'ghost'},{label:isNew?'Create':'Save',variant:'primary',onClick:function(){
        if(!g('passenger').trim()){ ui.toast('Passenger required','error'); return false; }
        r.passenger=g('passenger').trim(); r.pnr=g('pnr'); r.airline=g('airline'); r.ticketNo=g('ticketNo'); r.date=g('date');
        r.gross=+g('gross')||0; r.airlineRefund=+g('airlineRefund')||0; r.penalty=+g('penalty')||0; r.fee=+g('fee')||0;
        r.netRefund=recompute(); r.method=g('method'); r.status=g('status');
        db.saveAirRefund(r);
        if (r.status==='Paid') db.notify({ level:'info', title:'Refund Paid', text:r.passenger+' · '+ui.money(r.netRefund), companyId:'travels', icon:'cash-coin' });
        done&&done(); ui.toast('Refund saved','success');
      }}] });
  }

  /* ---------------------------------------------------- shared helpers */
  function kpi(label, value, icon) {
    return el('div.kpi-card', null, [ el('div.kpi-top',null,[ el('span.kpi-label',{text:label}), el('span.kpi-ico',{html:'<i class="bi bi-'+icon+'"></i>'}) ]),
      el('div.kpi-value',{text:String(value)}) ]);
  }
  function tableCard(title, headers, rows, emptyMsg) {
    var card = el('div.card');
    if (title) card.appendChild(el('div.card-head', null, [ el('h3',{text:title}) ]));
    if (!rows.length) { card.appendChild(el('div.empty-state',null,[ ui.frag(ui.icon('inbox')), el('h3',{text:'Nothing here yet'}), el('p.text-muted',{text:emptyMsg||''}) ])); return card; }
    var table = el('table.tbl');
    table.innerHTML = '<thead><tr>'+headers.map(function(h){return '<th>'+h+'</th>';}).join('')+'</tr></thead>';
    var tb = el('tbody'); rows.forEach(function(r){ tb.appendChild(r); }); table.appendChild(tb);
    card.appendChild(el('div.table-wrap', null, [ table ]));
    return card;
  }
  function downloadCsv(rows, name) {
    var csv = rows.map(function(r){ return r.map(function(c){ var s=String(c==null?'':c); return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s; }).join(','); }).join('\n');
    var blob=new Blob([csv],{type:'text/csv'});
    var link=el('a',{href:URL.createObjectURL(blob),download:name}); document.body.appendChild(link); link.click(); link.remove();
  }
  function td(html){ var t=el('td'); t.innerHTML=html; return t; }
  function tdN(html){ var t=el('td.num'); t.innerHTML=html; return t; }
  function kv(k,v){ return el('div.field',null,[ el('label',{text:k}), el('div.fw-600',{text:String(v)}) ]); }
  function statusBadge(s){ var m=STATUSES.filter(function(x){return x.id===s;})[0]||{color:'#8b93a7'};
    var b=el('span.badge',{text:s}); b.style.color=m.color; b.style.background=m.color+'22'; return b; }
  function payBadge(p){ return el('span.badge'+(p==='Paid'?'.badge-good':p==='Partial'?'.badge-warn':'.badge-bad'),{text:p}); }
  function reconBadge(s){ return el('span.badge'+(s==='Matched'?'.badge-good':s==='Discrepancy'?'.badge-bad':'.badge-warn'),{text:s}); }
  function admBadge(s){ return el('span.badge'+(s==='Settled'?'.badge-good':s==='Disputed'?'.badge-warn':'.badge-bad'),{text:s}); }
  function refundBadge(s){ return el('span.badge'+(s==='Paid'?'.badge-good':s==='Rejected'?'.badge-bad':'.badge-warn'),{text:s}); }
  function inp(label,id,val,cls,type){ return el('div.field'+(cls?'.'+cls:''),null,[ el('label',{text:label}), el('input.input',{id:'f-'+id,type:type||'text',value:val==null?'':val}) ]); }
  function sel(label,id,val,opts){ var s=el('select.select',{id:'f-'+id}); opts.forEach(function(o){var op=el('option',{value:o,text:o});if(o===val)op.selected=true;s.appendChild(op);}); return el('div.field',null,[el('label',{text:label}),s]); }
  function selDyn(label,id,pairs){ var s=el('select.select',{id:'f-'+id}); pairs.forEach(function(p){ s.appendChild(el('option',{value:p[0],text:p[1]})); }); return el('div.field',null,[el('label',{text:label}),s]); }
  function sec(t){ return el('div.form-section-title',{text:t}); }

})(window.EPAL = window.EPAL || {});
