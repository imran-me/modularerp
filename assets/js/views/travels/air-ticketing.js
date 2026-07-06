/* ============================================================================
 * EPAL GROUP ERP  ·  views/travels/air-ticketing.js
 * ----------------------------------------------------------------------------
 * AIR TICKETING — a full airline-agency lifecycle (Travels' second deep module,
 * after Visa Processing). ONE registered view serves every sub-route; the router
 * falls back from `.../refunds` to `travels/air-ticketing` and we branch on
 * ctx.subId:
 *
 *   (overview)     → hub: KPIs + section cards + recent tickets
 *   ticketing      → Direct Sale — multi-passenger fare model, markup + agent
 *                    commission, live fare summary, branded IATA-style invoice,
 *                    and payable/receivable schedule capture
 *   manage-sales   → sales ledger (base/tax/commission/net-profit columns) +
 *                    detail drawer (reissue/void/refund + comments) + per-airline
 *                    & per-agent profit report with a bar chart + CSV
 *   airlines       → Airlines master CRUD (name / IATA / country / status)
 *   airports       → Airports master CRUD (name / IATA / city / country)
 *   bsp            → BSP / ADM reconciliation (match, ADM dispute countdown)
 *   refunds        → Refund tracker (5-stage lifecycle + payout math)
 *
 * Persists in localStorage (airTickets / airlines / airports / airRefunds /
 * airBsp) and reads sub-agents from tv_agents. Issuing a ticket flows through
 * EPAL.db.postSale() (so Travels + Group finance move live) and the Deep Core
 * ledger auto-posts; documents print through EPAL.doc.open().
 * ==========================================================================*/

(function (EPAL) {
  'use strict';
  var ui = EPAL.ui, el = ui.el, db = EPAL.db, S = EPAL.store;

  // A stable demo "today" so BSP/ADM dispute countdowns are deterministic.
  var NOW = new Date('2026-07-05T00:00:00');

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
  function subAgents(){ return db.col('tv_agents'); }
  function agentById(id){ if(!id) return null; return subAgents().filter(function(a){ return a.id===id; })[0] || null; }
  function agentLabel(x){
    if (x.agentName) return x.agentName;
    if (x.agent) { var ag = agentById(x.agent); if (ag) return ag.name; var e = db.employee(x.agent); if (e) return e.name; }
    return 'Direct / House';
  }
  function today(){ return new Date().toISOString().slice(0,10); }
  function randPnr(){ return String.fromCharCode(65+Math.floor(Math.random()*26))+String.fromCharCode(65+Math.floor(Math.random()*26))+Math.floor(1000+Math.random()*9000); }
  function netProfitOf(x){ return (x.sale||0) - (x.cost||0) - (x.commission||0); }

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
      ticketing:'Multi-passenger fare model with markup, agent commission, live profit and a branded invoice.',
      'manage-sales':'Costing, sale, commission and net profit for every ticket — plus per-airline/agent reports.',
      airlines:'Airline master — carriers, IATA designators and status.',
      airports:'Airport master — stations, IATA codes and cities.',
      bsp:'Reconcile agency sales against the BSP billing file; track ADMs with a dispute-deadline countdown.',
      refunds:'Every refund request from filing to payout, with airline-penalty math.' }[sub]) || '';
  }

  /* ======================================================= OVERVIEW HUB */
  function overview(page) {
    var t = tickets();
    var revenue = t.reduce(function (s,x){ return s + (x.sale||0); }, 0);
    var profit  = t.reduce(function (s,x){ return s + netProfitOf(x); }, 0);
    var issued  = t.filter(function (x){ return x.status==='Issued'; }).length;
    page.appendChild(el('div.kpi-grid.stagger', null, [
      kpi('Tickets Sold', t.length, 'ticket-perforated'),
      kpi('Issued', issued, 'check2-circle'),
      kpi('Sales Value', ui.money(revenue,{compact:true}), 'cash-coin'),
      kpi('Net Profit', ui.money(profit,{compact:true}), 'graph-up-arrow')
    ]));

    var sections = [
      ['ticketing','Direct Sale','ticket-detailed-fill','Issue a new ticket'],
      ['manage-sales','Manage Sales','cash-stack','Costing, profit & reports'],
      ['airlines','Airlines','airplane-engines-fill','Carrier master & IATA'],
      ['airports','Airports','geo-alt-fill','Stations & IATA codes'],
      ['bsp','BSP / ADM Recon','shield-check','Match sales, dispute ADMs'],
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
    var agents = subAgents().filter(function(a){ return a.status==='Active' || !a.status; });

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
    var alPairs = als.map(function(a){ return [a.iata, a.iata+' · '+a.name]; });
    var vendorPairs = [['Direct Airline','Direct Airline']].concat(vendors.map(function(v){ return [v.name, v.name]; }));
    var agentPairs = [['','— No sub-agent (house) —']].concat(agents.map(function(a){ return [a.id, a.name+' · '+(a.agency||'')+' ('+(a.commission||0)+'%)']; }));

    var form;  // assigned below; items.onChange may fire during build → guarded.
    var summaryEl = el('div');

    var fields = [
      { type:'section', label:'Passengers & Fare' },
      { key:'pax', type:'items', label:'Passengers (one ticket each)', required:true, min:1, addLabel:'Add passenger',
        columns:[
          { key:'passenger', label:'Passenger', type:'text', width:'2fr' },
          { key:'ticketNo', label:'Ticket No', type:'text', width:'1.5fr' },
          { key:'baseFare', label:'Base Fare', type:'money' },
          { key:'taxes', label:'Taxes', type:'money' },
          { key:'vendor', label:'Vendor', type:'select', options:vendorPairs, width:'1.5fr' }
        ],
        footer: function (rows) {
          var b=0, x=0; rows.forEach(function(r){ b+=(+r.baseFare||0); x+=(+r.taxes||0); });
          return 'Base: <strong>'+ui.money(b)+'</strong> · Taxes: <strong>'+ui.money(x)+'</strong> · Cost: <strong>'+ui.money(b+x)+'</strong>';
        },
        onChange: function () { recompute(); }
      },
      { type:'section', label:'Itinerary' },
      { key:'fromCode', label:'From', type:'select', options:apPairs, required:true },
      { key:'toCode', label:'To', type:'select', options:apPairs, required:true },
      { key:'tripType', label:'Trip type', type:'select', options:['One-way','Round','Multi-City'], default:'One-way' },
      { key:'airlineCode', label:'Airline', type:'select', options:alPairs, required:true },
      { key:'flightNo', label:'Flight number', type:'text' },
      { key:'pnr', label:'PNR / Booking ref', type:'text' },
      { key:'travelDate', label:'Travel date', type:'date' },
      { type:'section', label:'Sourcing, Markup & Commission' },
      { key:'portal', label:'Portal / GDS', type:'select', options:['Sabre','Amadeus','Galileo','Direct'], default:'Sabre' },
      { key:'markup', label:'Markup / service charge', type:'money', default:0 },
      { key:'agentId', label:'Sub-agent (commission)', type:'select', options:agentPairs },
      { type:'section', label:'Payable Schedule — to vendor / portal' },
      { key:'payTo', label:'Pay to', type:'text', placeholder:'Vendor · BSP · Portal' },
      { key:'payableAmount', label:'Payable amount', type:'money', default:0 },
      { key:'payableDate', label:'Payable by', type:'date' },
      { type:'section', label:'Receivable Schedule — from customer / agent' },
      { key:'receiveFrom', label:'Receive from', type:'text', placeholder:'Customer · Sub-agent' },
      { key:'receivableAmount', label:'Receivable amount', type:'money', default:0 },
      { key:'receivableDate', label:'Receivable by', type:'date' },
      { key:'payStatus', label:'Pay status (to vendor)', type:'select', options:['Paid','Partial','Due'], default:'Due' }
    ];

    form = EPAL.form(fields, {});

    var card = el('div.card', null, [ el('div.card-body', null, [ form.el ]) ]);
    page.appendChild(card);

    page.appendChild(el('div.card', { style:{ marginTop:'14px' } }, [
      el('div.card-head', null, [ el('h3',{ html: ui.icon('calculator')+' Fare Summary' }) ]),
      el('div.card-body', null, [ summaryEl ])
    ]));

    // live recompute wiring for non-items inputs
    if (form.ctrls.markup) form.ctrls.markup.input.addEventListener('input', recompute);
    if (form.ctrls.agentId) form.ctrls.agentId.input.addEventListener('change', recompute);
    recompute();

    page.appendChild(el('div.flex.justify-between.mt-3', null, [
      el('a.btn.btn-ghost', { href:'#/travels/air-ticketing/manage-sales', html: ui.icon('arrow-left')+' Cancel' }),
      el('button.btn.btn-primary.btn-lg', { html: ui.icon('check-lg')+' Issue Ticket(s)', onclick: save })
    ]));

    function fare() {
      var v = form ? form.values() : {};
      var pax = v.pax || [];
      var totalBase=0, totalTaxes=0;
      pax.forEach(function(p){ totalBase += (+p.baseFare||0); totalTaxes += (+p.taxes||0); });
      var totalCost = totalBase + totalTaxes;
      var markup = +v.markup || 0;
      var totalSale = totalCost + markup;
      var gross = totalSale - totalCost;                 // = markup
      var ag = agentById(v.agentId);
      var commPct = ag ? (+ag.commission||0) : 0;
      var commission = Math.round(totalBase * commPct / 100);
      var net = gross - commission;
      return { totalBase:totalBase, totalTaxes:totalTaxes, totalCost:totalCost, markup:markup,
        totalSale:totalSale, gross:gross, commPct:commPct, commission:commission, net:net,
        pax:pax, values:v };
    }
    function line(label, val, cls) {
      return '<div style="display:flex;justify-content:space-between;gap:12px;padding:2px 0">'
        + '<span class="text-mute">'+label+'</span>'
        + '<span class="mono'+(cls?' '+cls:'')+'">'+val+'</span></div>';
    }
    function recompute() {
      if (!form) return;
      var s = fare();
      summaryEl.innerHTML = '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px 28px">'
        + line('Total base fare', ui.money(s.totalBase))
        + line('Total taxes', ui.money(s.totalTaxes))
        + line('Total cost', ui.money(s.totalCost))
        + line('Markup / service', ui.money(s.markup))
        + line('Total sale', ui.money(s.totalSale))
        + line('Gross profit', ui.money(s.gross), s.gross>=0?'text-good':'text-bad')
        + line('Agent commission ('+s.commPct+'%)', ui.money(s.commission))
        + line('Net profit', ui.money(s.net), s.net>=0?'text-good':'text-bad')
        + '</div>';
    }

    function save() {
      if (!form.validate()) { ui.toast('Please fix the highlighted fields','error'); return; }
      var s = fare(), v = s.values;
      var pax = (s.pax||[]).filter(function(p){ return (p.passenger||'').trim(); });
      if (!pax.length) { ui.toast('Add at least one passenger','error'); return; }
      if (v.fromCode === v.toCode) { ui.toast('Origin and destination must differ','error'); return; }

      var al = als.filter(function(a){ return a.iata===v.airlineCode; })[0] || {};
      var ag = agentById(v.agentId);
      var commPct = ag ? (+ag.commission||0) : 0;
      var markup = +v.markup || 0;
      var n = pax.length;
      var route = v.fromCode + ' → ' + v.toCode;
      var batchPnr = v.pnr || randPnr();
      var stamp = Date.now().toString().slice(-5);

      var docRows = [], sumBase=0, sumTax=0, sumSale=0, sumComm=0;
      pax.forEach(function (p, idx) {
        var base = +p.baseFare||0, tax = +p.taxes||0, cost = base + tax;
        var mShare = idx === n-1 ? (markup - Math.round(markup/n)*(n-1)) : Math.round(markup/n);
        var sale = cost + mShare;
        var comm = Math.round(base * commPct / 100);
        var t = {
          id:'TK-' + stamp + '-' + (idx+1),
          pnr: batchPnr, ticketNo:(p.ticketNo||'').trim(),
          passenger:(p.passenger||'').trim(), phone:'', passport:'',
          fromCode:v.fromCode, toCode:v.toCode, route:route,
          tripType:v.tripType, airlineCode:v.airlineCode, airline: al.name || v.airlineCode,
          flightNo:v.flightNo, vendor:(p.vendor||'Direct Airline'), portal:v.portal,
          travelDate:v.travelDate, purchaseDate: today(),
          baseFare:base, taxes:tax, markup:mShare, commission:comm, commissionPct:commPct,
          agent:v.agentId||'', agentName: ag ? ag.name : '',
          cost:cost, sale:sale, costPaid: v.payStatus==='Paid' ? cost : 0, payStatus:v.payStatus,
          payable:{ to:v.payTo||'', amount:+v.payableAmount||0, date:v.payableDate||'' },
          receivable:{ from:v.receiveFrom||'', amount:+v.receivableAmount||0, date:v.receivableDate||'' },
          currency:'BDT', status:'Issued', created: today(),
          timeline:[{ at: Date.now(), text:'Ticket issued' }]
        };
        db.saveAirTicket(t);
        // cross-company sale → Travels + Group finance + ledger auto-post.
        // Include agent commission in the posted cost so ledger profit
        // (sale - cost - commission) reconciles with the module's Net Profit.
        db.postSale('travels', { amount:t.sale, cost:t.cost + (t.commission||0), ref:t.id,
          desc:'Air ticket '+route+' ('+v.airlineCode+') · '+t.passenger, customer:t.passenger });
        docRows.push({ passenger:t.passenger, ticketNo:t.ticketNo||'—', sector:route, base:base, tax:tax, fee:mShare, total:sale });
        sumBase+=base; sumTax+=tax; sumSale+=sale; sumComm+=comm;
      });

      // branded IATA-style invoice
      if (EPAL.doc && EPAL.doc.open) {
        EPAL.doc.open({
          type:'ticket', title:'Air Ticket Invoice', serial: EPAL.doc.numberFor('ticket'),
          badge:'ISSUED', watermark:'E-TICKET',
          parties:[
            { label:'Issuing Agent', lines:['Epal Travels & Consultancy','IATA Accredited Agent','Dhaka, Bangladesh'] },
            { label:'Passenger / Customer', lines:[ pax[0].passenger, 'PNR '+batchPnr, (al.name||v.airlineCode) ] }
          ],
          meta:[
            { label:'PNR', value:batchPnr }, { label:'Airline', value:(al.name||v.airlineCode) },
            { label:'Route', value:route }, { label:'Travel Date', value: v.travelDate ? ui.date(v.travelDate) : '—' },
            { label:'Issued', value: ui.date(today()) }
          ],
          columns:[
            { key:'passenger', label:'Passenger' }, { key:'ticketNo', label:'Ticket No' }, { key:'sector', label:'Sector' },
            { key:'base', label:'Base Fare', money:true }, { key:'tax', label:'Taxes', money:true },
            { key:'fee', label:'Service Fee', money:true }, { key:'total', label:'Amount', money:true }
          ],
          rows:docRows,
          totals:[
            { label:'Total Base Fare', value:sumBase }, { label:'Total Taxes', value:sumTax },
            { label:'Service Charge', value:markup }, { label:'Grand Total', value:sumSale, grand:true }
          ],
          words: EPAL.doc.amountInWords ? EPAL.doc.amountInWords(sumSale) : '',
          terms:'Fares are subject to airline rules. Taxes and service charges are non-refundable. Reissue and void penalties apply per fare conditions.',
          sign:'For Epal Travels & Consultancy'
        });
      }

      db.notify({ level:'success', title:'Ticket'+(n>1?'s':'')+' Issued',
        text:n+' pax · '+route+' · '+ui.money(sumSale), companyId:'travels', icon:'ticket-perforated-fill' });
      ui.toast(n+' ticket'+(n>1?'s':'')+' issued · net '+ui.money(sumSale-sumBase-sumTax-sumComm),'success');
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
    page.appendChild(profitSection());   // rendered once (chart survives ledger redraws)

    function draw() {
      var q = search.value.toLowerCase();
      var t = tickets().filter(function (x){ return !q || (x.passenger+' '+x.pnr+' '+x.route+' '+x.id).toLowerCase().indexOf(q)>=0; });
      var all = tickets();
      var totalCost=0,totalSale=0,totalComm=0;
      all.forEach(function(x){ totalCost+=x.cost||0; totalSale+=x.sale||0; totalComm+=x.commission||0; });
      var net = totalSale-totalCost-totalComm;
      kpis.innerHTML='';
      [ kpi('Total Sales', ui.money(totalSale,{compact:true}), 'cash-coin'),
        kpi('Total Cost', ui.money(totalCost,{compact:true}), 'wallet2'),
        kpi('Gross Profit', ui.money(totalSale-totalCost,{compact:true}), 'graph-up-arrow'),
        kpi('Agent Commission', ui.money(totalComm,{compact:true}), 'person-badge'),
        kpi('Net Profit', ui.money(net,{compact:true}), 'gem'),
        kpi('Tickets', all.length, 'ticket-perforated') ].forEach(function(k){ kpis.appendChild(k); });

      var rows = t.map(function (x) {
        var base = x.baseFare!=null ? x.baseFare : (x.cost||0);
        var tax = x.taxes||0, comm = x.commission||0, np = netProfitOf(x);
        return el('tr.row-click', { onclick: (function(tk){ return function(){ ticketDetail(tk, draw); }; })(x) }, [
          td('<span class="strong">'+x.id+'</span>'), td(ui.escapeHtml(x.passenger)),
          td('<span class="mono">'+x.route+'</span>'), td(x.airlineCode+' · '+x.pnr),
          tdN(ui.money(base)), tdN(ui.money(tax)), tdN(ui.money(x.cost)), tdN(ui.money(x.sale)),
          tdN(ui.money(comm)),
          td('<span class="num '+(np>=0?'text-good':'text-bad')+'">'+ui.money(np)+'</span>'),
          td(payBadge(x.payStatus).outerHTML), td(statusBadge(x.status).outerHTML) ]);
      });
      host.innerHTML='';
      host.appendChild(tableCard('Ticket Sales Ledger',
        ['Ticket','Passenger','Route','Airline · PNR','Base','Tax','Cost','Sale','Comm','Net Profit','Payment','Status'], rows, 'No tickets sold yet.'));
    }
    draw();
  }

  /* per-airline & per-agent profit report + bar chart (built once) */
  function profitSection() {
    var wrap = el('div');
    wrap.appendChild(el('div.section-label',{text:'Profitability — by Airline & Sub-Agent'}));
    var all = tickets();
    var byAir={}, byAgent={};
    all.forEach(function (x) {
      var comm = x.commission||0, np = netProfitOf(x);
      var ak = x.airline || x.airlineCode || '—';
      var A = byAir[ak] || (byAir[ak]={ n:0, sale:0, cost:0, comm:0, net:0 });
      A.n++; A.sale+=x.sale||0; A.cost+=x.cost||0; A.comm+=comm; A.net+=np;
      var gk = agentLabel(x);
      var G = byAgent[gk] || (byAgent[gk]={ n:0, sale:0, cost:0, comm:0, net:0 });
      G.n++; G.sale+=x.sale||0; G.cost+=x.cost||0; G.comm+=comm; G.net+=np;
    });
    var airKeys = Object.keys(byAir).sort(function(p,q){ return byAir[q].net-byAir[p].net; });
    var agentKeys = Object.keys(byAgent).sort(function(p,q){ return byAgent[q].net-byAgent[p].net; });

    var cid = ui.uid('c');
    wrap.appendChild(el('div.card', null, [
      el('div.card-head', null, [ el('h3',{ html: ui.icon('bar-chart')+' Net Profit by Airline' }) ]),
      el('div.card-body', null, [ el('div',{ style:{ height:'260px', position:'relative' } }, [ el('canvas',{ id:cid }) ]) ])
    ]));

    var two = el('div.two-col');
    var airRows = airKeys.map(function (k) { var a=byAir[k];
      return el('tr', null, [ td('<span class="strong">'+ui.escapeHtml(k)+'</span>'), tdN(String(a.n)),
        tdN(ui.money(a.sale)), tdN(ui.money(a.cost)), tdN(ui.money(a.comm)),
        td('<span class="num '+(a.net>=0?'text-good':'text-bad')+'">'+ui.money(a.net)+'</span>') ]);
    });
    two.appendChild(el('div', null, [ el('div.section-label',{text:'By Airline'}),
      tableCard(null, ['Airline','Tkts','Sale','Cost','Comm','Net Profit'], airRows, 'No data.') ]));
    var agRows = agentKeys.map(function (k) { var a=byAgent[k];
      return el('tr', null, [ td('<span class="strong">'+ui.escapeHtml(k)+'</span>'), tdN(String(a.n)),
        tdN(ui.money(a.sale)), tdN(ui.money(a.comm)),
        td('<span class="num '+(a.net>=0?'text-good':'text-bad')+'">'+ui.money(a.net)+'</span>') ]);
    });
    two.appendChild(el('div', null, [ el('div.section-label',{text:'By Sub-Agent'}),
      tableCard(null, ['Sub-Agent','Tkts','Sale','Comm','Net Profit'], agRows, 'No data.') ]));
    wrap.appendChild(two);

    requestAnimationFrame(function () {
      var c = ui.$('#'+cid); if (!c || !EPAL.charts) return;
      var top = airKeys.slice(0,8);
      EPAL.charts.bar(c, { labels:top, datasets:[{ label:'Net Profit', data: top.map(function(k){ return byAir[k].net; }) }], horizontal:true, money:true });
    });
    return wrap;
  }

  function exportSales() {
    var rows=[['Ticket','Passenger','Route','Airline','PNR','Base','Tax','Cost','Sale','Commission','NetProfit','Payment','Status']];
    tickets().forEach(function(x){
      var base = x.baseFare!=null ? x.baseFare : (x.cost||0);
      rows.push([x.id,x.passenger,x.route,x.airline,x.pnr,base,x.taxes||0,x.cost,x.sale,x.commission||0,netProfitOf(x),x.payStatus,x.status]);
    });
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

      var base = t.baseFare!=null ? t.baseFare : (t.cost||0);
      body.appendChild(el('div.form-grid', null, [
        kv('PNR', t.pnr||'—'), kv('Ticket No', t.ticketNo||'—'),
        kv('Airline', (t.airlineCode||'')+' · '+(t.airline||'—')), kv('Flight', t.flightNo||'—'),
        kv('Passport', t.passport||'—'), kv('Phone', t.phone||'—'),
        kv('Travel date', t.travelDate?ui.date(t.travelDate):'—'), kv('Purchased', t.purchaseDate?ui.date(t.purchaseDate):'—'),
        kv('Vendor', t.vendor||'—'), kv('Portal', t.portal||'—'),
        kv('Sub-agent', agentLabel(t))
      ]));

      body.appendChild(el('div.section-label',{text:'Fare & Profit'}));
      body.appendChild(el('div.form-grid', null, [
        kv('Base fare', ui.money(base)), kv('Taxes', ui.money(t.taxes||0)),
        kv('Markup / service', ui.money(t.markup||0)), kv('Cost', ui.money(t.cost)),
        kv('Sale', ui.money(t.sale)), kv('Commission'+(t.commissionPct?' ('+t.commissionPct+'%)':''), ui.money(t.commission||0)),
        kv('Net profit', ui.money(netProfitOf(t)))
      ]));

      if (t.payable || t.receivable) {
        body.appendChild(el('div.section-label',{text:'Payable / Receivable Schedule'}));
        var pa = t.payable||{}, re = t.receivable||{};
        body.appendChild(el('div.form-grid', null, [
          kv('Pay to', pa.to||'—'), kv('Payable', ui.money(pa.amount||0)+(pa.date?' · '+ui.date(pa.date):'')),
          kv('Receive from', re.from||'—'), kv('Receivable', ui.money(re.amount||0)+(re.date?' · '+ui.date(re.date):''))
        ]));
      }

      body.appendChild(el('div.section-label',{text:'Timeline'}));
      body.appendChild(el('div.timeline', null, (t.timeline||[]).slice().reverse().map(function (e){
        return el('div.tl-item', null, [ el('div.tl-time',{text:ui.ago(e.at)}), el('div.tl-text',{text:e.text}) ]); })));
      body.appendChild(el('div.divider'));

      var moveSel = el('select.select',{style:{width:'auto'},onchange:function(){ setStatus(moveSel.value); }});
      STATUSES.forEach(function(s){ var o=el('option',{value:s.id,text:'Status → '+s.id}); if(s.id===t.status)o.selected=true; moveSel.appendChild(o); });
      body.appendChild(el('div.flex.gap-1.flex-wrap', null, [
        moveSel,
        el('button.btn.btn-sm.btn-outline',{html:ui.icon('cash')+' '+(t.payStatus==='Paid'?'Mark Due':'Mark Paid'),onclick:function(){ t.payStatus=t.payStatus==='Paid'?'Due':'Paid'; db.saveAirTicket(t); redraw(); refresh&&refresh(); }}),
        el('button.btn.btn-sm.btn-outline',{html:ui.icon('arrow-repeat')+' Reissue',onclick:function(){ m.close(); reissueTicket(t, refresh); }}),
        el('button.btn.btn-sm.btn-outline',{html:ui.icon('x-octagon')+' Void',onclick:function(){ m.close(); voidTicket(t, refresh); }}),
        el('button.btn.btn-sm.btn-outline',{html:ui.icon('arrow-counterclockwise')+' Refund',onclick:function(){ m.close(); refundFromTicket(t, refresh); }}),
        el('button.btn.btn-sm.btn-danger',{html:ui.icon('trash')+' Delete',onclick:function(){ ui.confirm({title:'Delete ticket?',danger:true,confirmLabel:'Delete'}).then(function(ok){ if(ok){ db.remove('airTickets', t.id); m.close(); refresh&&refresh(); ui.toast('Ticket deleted','success'); } }); }})
      ]));

      if (EPAL.comments && EPAL.comments.widget) {
        body.appendChild(el('div.section-label',{text:'Discussion'}));
        body.appendChild(EPAL.comments.widget('airTickets', t.id));
      }
    }
    function setStatus(next) {
      if (next === t.status) return;
      if (next==='Refunded') { m.close(); refundFromTicket(t, refresh); return; }
      if (next==='Re-issued') { m.close(); reissueTicket(t, refresh); return; }
      if (next==='Void') { m.close(); voidTicket(t, refresh); return; }
      t.status = next; t.timeline = (t.timeline||[]).concat([{ at: Date.now(), text:'Status → '+next }]);
      db.saveAirTicket(t);
      redraw(); refresh && refresh();
    }
    redraw();
  }

  /* ---- Reissue: airline penalty + fare difference → new total -----------*/
  function reissueTicket(t, refresh) {
    var body = el('div');
    body.appendChild(el('div.form-grid', null, [
      sec('Reissue — penalty & fare difference'),
      inp('Airline penalty','rePenalty',0,'','number'),
      inp('Fare difference (new − old)','reFareDiff',0,'','number')
    ]));
    var out = el('div.build-banner',{style:{marginTop:'6px'}},[ ui.frag(ui.icon('calculator')),
      el('div',null,[ el('span',{id:'re-out',html:''}) ]) ]);
    body.appendChild(out);
    function g(i){ return +(body.querySelector('#f-'+i)||{}).value || 0; }
    function calc(){ var add=g('rePenalty')+g('reFareDiff');
      body.querySelector('#re-out').innerHTML='Additional charge to customer: <strong>'+ui.money(add)+'</strong> · New ticket total: <strong>'+ui.money((t.sale||0)+add)+'</strong>'; }
    ['rePenalty','reFareDiff'].forEach(function(id){ var n=body.querySelector('#f-'+id); if(n) n.addEventListener('input',calc); });
    calc();
    ui.modal({ title:'Reissue '+t.id, icon:'arrow-repeat', body:body,
      actions:[{label:'Cancel',variant:'ghost'},{label:'Reissue',variant:'primary',onClick:function(){
        var pen=g('rePenalty'), diff=g('reFareDiff'), add=pen+diff;
        if (add<=0) { ui.toast('Enter a penalty or fare difference','error'); return false; }
        t.cost=(t.cost||0)+diff; t.baseFare=(t.baseFare!=null?t.baseFare:(t.cost-diff||0))+diff; t.sale=(t.sale||0)+add;
        t.status='Re-issued';
        t.timeline=(t.timeline||[]).concat([{ at:Date.now(), text:'Re-issued · penalty '+ui.money(pen)+' + fare diff '+ui.money(diff) }]);
        db.saveAirTicket(t);
        db.postSale('travels', { amount:add, cost:diff, ref:t.id+'-RE', desc:'Reissue '+t.route+' ('+t.airlineCode+')', customer:t.passenger });
        db.notify({ level:'info', title:'Ticket Reissued', text:t.passenger+' · +'+ui.money(add), companyId:'travels', icon:'arrow-repeat' });
        ui.toast('Ticket reissued','success'); refresh && refresh();
      }}] });
  }

  /* ---- Void: penalty retained + reversal (negative postSale) -------------*/
  function voidTicket(t, refresh) {
    var body = el('div');
    body.appendChild(el('div.form-grid', null, [
      sec('Void — reversal & penalty'),
      inp('Void penalty (retained as income)','voidPenalty',0,'','number')
    ]));
    var out = el('div.build-banner',{style:{marginTop:'6px'}},[ ui.frag(ui.icon('calculator')),
      el('div',null,[ el('span',{id:'vd-out',html:''}) ]) ]);
    body.appendChild(out);
    function g(i){ return +(body.querySelector('#f-'+i)||{}).value || 0; }
    function calc(){ body.querySelector('#vd-out').innerHTML='Sale reversed: <strong class="text-bad">-'+ui.money(t.sale||0)+'</strong> · Cost reversed: <strong>-'+ui.money(t.cost||0)+'</strong> · Penalty retained: <strong class="text-good">'+ui.money(g('voidPenalty'))+'</strong>'; }
    var vn=body.querySelector('#f-voidPenalty'); if(vn) vn.addEventListener('input',calc); calc();
    ui.modal({ title:'Void '+t.id, icon:'x-octagon', body:body,
      actions:[{label:'Cancel',variant:'ghost'},{label:'Void Ticket',variant:'danger',onClick:function(){
        var pen=g('voidPenalty');
        // reverse the original recognised sale
        db.postSale('travels', { amount:-(t.sale||0), cost:-(t.cost||0), ref:t.id+'-VOID', desc:'Void reversal '+t.route+' ('+t.airlineCode+')', customer:t.passenger });
        if (pen>0) db.postSale('travels', { amount:pen, cost:0, ref:t.id+'-VOIDFEE', desc:'Void penalty '+t.route, customer:t.passenger });
        t.status='Void'; t.payStatus='Due'; t.voidPenalty=pen;
        t.timeline=(t.timeline||[]).concat([{ at:Date.now(), text:'Voided · reversal '+ui.money(t.sale||0)+' · penalty '+ui.money(pen) }]);
        db.saveAirTicket(t);
        db.notify({ level:'warning', title:'Ticket Voided', text:t.passenger+' · reversed '+ui.money(t.sale||0), companyId:'travels', icon:'x-octagon' });
        ui.toast('Ticket voided & finance reversed','success'); refresh && refresh();
      }}] });
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
        tdN(ui.money(x.amount)), td(admBadge(x.status).outerHTML), td(admCountdown(x)) ]);
    });
    row.appendChild(el('div', null, [ el('div.section-label',{text:'ADM Tracker — dispute deadline (30 days)'}),
      tableCard(null, ['Airline','Ticket','Reason','Amount','Status','Dispute In'], admRows, 'No ADMs raised.') ]));
    var unRows = (bsp.unused||[]).map(function (x) {
      return el('tr', null, [ td('<span class="strong">'+ui.escapeHtml(x.passenger)+'</span>'),
        td(ui.escapeHtml(x.airline)), tdN(ui.money(x.value)), td(ui.date(x.expiry)) ]);
    });
    row.appendChild(el('div', null, [ el('div.section-label',{text:'Unused Tickets (recoverable)'}),
      tableCard(null, ['Passenger','Airline','Value','Expiry'], unRows, 'No unused tickets.') ]));
    page.appendChild(row);
  }

  // ADM dispute-deadline countdown (raised date + 30 days), coloured by risk.
  function admCountdown(x) {
    if (x.status==='Settled') return '<span class="text-mute">Settled</span>';
    if (!x.date) return '<span class="text-mute">—</span>';
    var dl = new Date(x.date+'T00:00:00'); dl.setDate(dl.getDate()+30);
    var days = Math.round((dl - NOW)/86400000);
    var lbl = days<0 ? 'Overdue '+(-days)+'d' : days+' days left';
    var color = days<0 ? '#f0506e' : days<=7 ? '#f4b740' : '#23c17e';
    return '<span class="mono" style="color:'+color+'" title="Dispute by '+dl.toISOString().slice(0,10)+'">'+lbl+'</span>';
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
      date:new Date().toISOString().slice(0,10),
      _fromTicket:t.id, _origCost:(t.cost||0), _origComm:(t.commission||0) }, after, true);
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
        // When a ticket-linked refund becomes terminal (Paid), reverse the
        // recognised sale — mirroring voidTicket so Group Finance/ledger no
        // longer carry the refunded revenue. Guarded by _reversed so the
        // Requested→Filed→Received→Paid re-saves never double-post.
        if (r.status==='Paid' && !r._reversed && r._fromTicket) {
          var origCost = (r._origCost||0) + (r._origComm||0);
          db.postSale('travels', { amount:-(r.gross||0), cost:-origCost, ref:r._fromTicket+'-REFUND',
            desc:'Refund reversal '+(r.pnr||'')+' '+(r.airline||''), customer:r.passenger });
          var retained = (+r.penalty||0) + (+r.fee||0);
          if (retained>0) db.postSale('travels', { amount:retained, cost:0, ref:r._fromTicket+'-REFUNDFEE',
            desc:'Refund penalty/fee retained '+(r.pnr||''), customer:r.passenger });
          r._reversed = true;
          // flip the originating ticket to Refunded (symmetric with void)
          var src = tickets().filter(function(x){ return x.id===r._fromTicket; })[0];
          if (src && src.status!=='Refunded') {
            src.status='Refunded';
            src.timeline=(src.timeline||[]).concat([{ at:Date.now(), text:'Refunded · net '+ui.money(r.netRefund||0) }]);
            db.saveAirTicket(src);
          }
        }
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
