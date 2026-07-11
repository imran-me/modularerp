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

  // Ancillary service catalogue (EMD) — label + icon + a typical BDT cost band.
  var EMD_SERVICES = [
    { id:'Excess Baggage',   icon:'bag-fill',           color:'#2f6bff' },
    { id:'Seat Upgrade',     icon:'star-fill',          color:'#7b5cff' },
    { id:'Meal',             icon:'cup-hot-fill',       color:'#23c17e' },
    { id:'Airport Tax',      icon:'building',           color:'#f4b740' },
    { id:'Visa Fee',         icon:'passport-fill',      color:'#00b8d9' },
    { id:'Travel Insurance', icon:'shield-fill-check',  color:'#f0506e' },
    { id:'Lounge Access',    icon:'door-open-fill',     color:'#1A43BF' },
    { id:'Other',            icon:'three-dots',         color:'#8b93a7' }
  ];
  var TTL_STATUSES = ['Hold','Ticketed','Expired'];

  /* ==========================================================================
   * SEED — air_emd (ancillary EMDs) + air_ttl (ticketing-deadline queue).
   * Idempotent; runs during db.seed + on db.reset. Deterministic PRNG so the
   * demo reads the same every load.
   * ========================================================================*/
  EPAL.registerEngine({ name: 'air-ticketing-seed', seed: function () {
    S.seedOnce('air_emd', seedEmd());
    S.seedOnce('air_ttl', seedTtl());
    S.seedOnce('air_stock', seedStock());
    S.seedOnce('air_countries', seedCountries());
    S.seedOnce('air_states', seedStates());
    S.seedOnce('air_purchases', seedPurchases());
  }});

  /* Ticket Purchase — the passport-holder PURCHASE register (buying a ticket for a
     passenger; paid / due / total). Mirrors the legacy "Ticket Purchase". */
  function seedPurchases() {
    var data = [
      { ticketNo:'09PPXW', purchaseDate:'2026-07-10', passenger:'HOSSAIN AHMED',              passport:'A1234567', vendor:'',                  fromCode:'KTM', toCode:'DAC', via:'',    airlineCode:'BG', tripType:'One-way', total:15800, paid:15800 },
      { ticketNo:'SLRSTN', purchaseDate:'2026-07-08', passenger:'HASAN/MD MEHEDI MR',          passport:'B7654321', vendor:'GDS Aggregator BD', fromCode:'DAC', toCode:'KUL', via:'BKK', airlineCode:'MH', tripType:'Two-way', total:78927, paid:0 },
      { ticketNo:'SLRSTN', purchaseDate:'2026-07-08', passenger:'MONDAL/MD ASHRAFUL ALAM MR',  passport:'B7654322', vendor:'GDS Aggregator BD', fromCode:'DAC', toCode:'KUL', via:'BKK', airlineCode:'MH', tripType:'Two-way', total:78927, paid:40000 },
      { ticketNo:'RKPQ21', purchaseDate:'2026-07-04', passenger:'RAHIM UDDIN',                 passport:'A9988776', vendor:'Emirates GSA',      fromCode:'DAC', toCode:'DXB', via:'',    airlineCode:'EK', tripType:'One-way', total:62000, paid:62000 },
      { ticketNo:'BGAA74', purchaseDate:'2026-07-02', passenger:'SHIRIN SULTANA',              passport:'A5544332', vendor:'Galaxy GSA',        fromCode:'DAC', toCode:'JED', via:'',    airlineCode:'SV', tripType:'Two-way', total:58000, paid:0 }
    ];
    return data.map(function (p, i) { p.id='PUR-'+(4001+i); p.due=Math.max(0, (p.total||0)-(p.paid||0));
      p.payStatus = p.due<=0 ? 'Confirm' : (p.paid>0 ? 'Partial' : 'Pending');
      p.route = p.via ? (p.fromCode+' → '+p.via+' → '+p.toCode) : (p.fromCode+' → '+p.toCode);
      p.status='Confirm'; p.created=Date.now()-(i*5400000); return p; });
  }

  /* Country + States masters (geography used across ticketing & business services).
     A representative set — the Laravel backend ships the full ISO dataset. */
  function seedCountries() {
    var C = 'Afghanistan AF, Albania AL, Algeria DZ, American Samoa AS, Australia AU, Bahrain BH, Bangladesh BD, Belgium BE, Bhutan BT, Brazil BR, Canada CA, China CN, Cyprus CY, Denmark DK, Egypt EG, France FR, Germany DE, Greece GR, India IN, Indonesia ID, Iran IR, Iraq IQ, Italy IT, Japan JP, Jordan JO, Kuwait KW, Malaysia MY, Maldives MV, Nepal NP, Netherlands NL, Oman OM, Pakistan PK, Philippines PH, Qatar QA, Romania RO, Russia RU, Saudi Arabia SA, Singapore SG, South Korea KR, Spain ES, Sri Lanka LK, Sweden SE, Switzerland CH, Thailand TH, Turkey TR, United Arab Emirates AE, United Kingdom GB, United States US, Vietnam VN';
    return C.split(', ').map(function (pair, i) { var m=pair.split(' '); var code=m.pop(), name=m.join(' ');
      return { id:'CTY-'+(1001+i), name:name, code:code, status:'Active', created:'2025-12-08' }; });
  }
  function seedStates() {
    var map = {
      'Bangladesh':['Dhaka','Chattogram','Khulna','Rajshahi','Sylhet','Barishal','Rangpur','Mymensingh'],
      'India':['West Bengal','Delhi','Maharashtra','Tamil Nadu','Karnataka'],
      'Saudi Arabia':['Makkah','Madinah','Riyadh','Eastern Province'],
      'United Arab Emirates':['Dubai','Abu Dhabi','Sharjah'],
      'Malaysia':['Kuala Lumpur','Selangor','Penang'],
      'Thailand':['Bangkok','Phuket','Chiang Mai'],
      'United Kingdom':['England','Scotland','Wales'],
      'Canada':['Ontario','Quebec','British Columbia'],
      'United States':['California','New York','Texas'],
      'Afghanistan':['Balkh','Herat','Kabul','Kandahar']
    };
    var out=[], n=2001;
    Object.keys(map).forEach(function (country) { map[country].forEach(function (st) {
      out.push({ id:'STA-'+(n++), country:country, state:st, status:'Active', created:'2025-12-08' }); }); });
    return out;
  }

  /* Ticket Manage — route STOCK / inventory (pre-loaded ticket routes with price
     + quantity; remaining = qty − sold). Mirrors the legacy "Ticket Manage". */
  function seedStock() {
    var data = [
      { fromCode:'DAC', toCode:'KUL', via:'BKK', airlineCode:'MH', vendor:'GDS Aggregator BD', portal:'Amadeus',  price:78927, cost:71000, qty:2,  sold:1 },
      { fromCode:'DAC', toCode:'DXB', via:'',    airlineCode:'EK', vendor:'Emirates GSA',       portal:'Sabre',    price:62000, cost:54000, qty:12, sold:5 },
      { fromCode:'DAC', toCode:'JED', via:'',    airlineCode:'SV', vendor:'Galaxy GSA',         portal:'BSP IATA', price:58000, cost:51000, qty:20, sold:8 },
      { fromCode:'KTM', toCode:'DAC', via:'',    airlineCode:'BG', vendor:'',                   portal:'',         price:15700, cost:14200, qty:6,  sold:6 },
      { fromCode:'DAC', toCode:'DOH', via:'',    airlineCode:'QR', vendor:'GDS Aggregator BD',  portal:'Galileo',  price:64000, cost:57000, qty:8,  sold:2 },
      { fromCode:'DAC', toCode:'SIN', via:'',    airlineCode:'SQ', vendor:'Sky Holidays',       portal:'Sabre',    price:71000, cost:63000, qty:5,  sold:0 },
      { fromCode:'DAC', toCode:'IST', via:'',    airlineCode:'TK', vendor:'GDS Aggregator BD',  portal:'Amadeus',  price:82000, cost:73000, qty:4,  sold:1, status:'Inactive' }
    ];
    return data.map(function (d, i) {
      return Object.assign({ id:'STK-'+(6001+i), status:'Active',
        route: d.via ? (d.fromCode+' → '+d.via+' → '+d.toCode) : (d.fromCode+' → '+d.toCode),
        created: Date.now() - (i*7200000) }, d);
    });
  }

  function prng(seed) { var s = seed; return function (n) { s = (s * 1103515245 + 12345) & 0x7fffffff; return s % n; }; }

  function seedEmd() {
    var rr = prng(70021);
    var pax = ['Rahim Uddin','Nasreen Akter','Kamal Hossain','Farhana Yasmin','Tanvir Ahmed',
      'Shirin Sultana','Jahangir Alam','Mitu Rahman','Sabbir Khan','Rokeya Begum'];
    var refs = ['BG7421','EK5093','QR8810','SQ2274','TK6650','BS4417','MH3391','KU7120','GF5582','WY9043'];
    var vendors = ['Biman Bangladesh','Emirates GSA','Qatar Airways','Singapore Airlines','Turkish Airlines',
      'US-Bangla','Malaysia Airlines','Kuwait Airways','Gulf Air','Oman Air'];
    var svc = [ ['Excess Baggage',4500,6500],['Seat Upgrade',3500,5000],['Meal',900,1500],
      ['Airport Tax',1200,2200],['Visa Fee',6000,8500],['Travel Insurance',1800,3200],
      ['Lounge Access',2500,4000],['Excess Baggage',5000,7500],['Seat Upgrade',4000,6000],['Other',1500,3000] ];
    var dates = ['2026-06-18','2026-06-22','2026-06-27','2026-06-30','2026-07-01','2026-07-02','2026-07-03','2026-07-04'];
    var out = [], n = 130450090001;
    for (var i = 0; i < 10; i++) {
      var s = svc[i], cost = s[1] + rr(s[2] - s[1]);
      var margin = 500 + rr(1600);
      out.push({
        id:'EMD-' + (7001 + i), emdNo: String(n + i), date: dates[i % dates.length],
        passenger: pax[i], ticketRef: refs[i], serviceType: s[0], vendor: vendors[i],
        description: emdDesc(s[0]), cost: cost, sale: cost + margin,
        payStatus: (i % 3 === 0 ? 'Due' : 'Paid'), agent: '', created: Date.now() - (i * 3600000)
      });
    }
    return out;
  }
  function emdDesc(t) {
    return ({ 'Excess Baggage':'+10kg checked baggage', 'Seat Upgrade':'Preferred / extra-legroom seat',
      'Meal':'Special hot meal', 'Airport Tax':'Embarkation / security tax', 'Visa Fee':'Visa processing fee',
      'Travel Insurance':'Single-trip cover', 'Lounge Access':'Departure lounge pass',
      'Other':'Miscellaneous ancillary' }[t]) || 'Ancillary service';
  }

  function seedTtl() {
    // ttl dates spread around demo-today 2026-07-05: overdue, imminent, comfortable.
    var rows = [
      { pnr:'RKPQ21', passenger:'Rahim Uddin',    airline:'Emirates',            route:'DAC → DXB', ttl:'2026-07-03T18:00', status:'Hold', amount:  86500 },
      { pnr:'MHTZ88', passenger:'Nasreen Akter',  airline:'Qatar Airways',       route:'DAC → DOH', ttl:'2026-07-04T12:00', status:'Hold', amount: 112000 },
      { pnr:'BSVL07', passenger:'Kamal Hossain',  airline:'US-Bangla',           route:'DAC → CXB', ttl:'2026-07-05T20:00', status:'Hold', amount:  14500 },
      { pnr:'SQWX24', passenger:'Farhana Yasmin', airline:'Singapore Airlines',  route:'DAC → SIN', ttl:'2026-07-06T09:00', status:'Hold', amount: 138000 },
      { pnr:'TKMN65', passenger:'Tanvir Ahmed',   airline:'Turkish Airlines',    route:'DAC → IST', ttl:'2026-07-07T15:00', status:'Hold', amount: 154500 },
      { pnr:'BGAA74', passenger:'Shirin Sultana', airline:'Biman Bangladesh',    route:'DAC → JED', ttl:'2026-07-10T10:00', status:'Hold', amount:  92000 },
      { pnr:'KUZZ12', passenger:'Jahangir Alam',  airline:'Kuwait Airways',      route:'DAC → KWI', ttl:'2026-07-12T23:59', status:'Hold', amount:  78500 },
      { pnr:'GFOM58', passenger:'Mitu Rahman',    airline:'Gulf Air',            route:'DAC → BAH', ttl:'2026-07-02T14:00', status:'Expired', amount: 69000 }
    ];
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i]; r.id = 'TTL-' + (5001 + i); r.created = Date.now() - (i * 5400000);
      out.push(r);
    }
    return out;
  }

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
        overview:'Air Ticketing', stock:'Ticket Manage', purchase:'Ticket Purchase',
        ticketing:'Ticket Operations', 'manage-sales':'Manage Sales',
        emd:'EMD & Ancillary', ttl:'Ticketing Deadlines',
        masters:'Masters', airlines:'Airlines', airports:'Airports', countries:'Country', states:'States',
        bsp:'BSP / ADM Recon', refunds:'Refund Tracker'
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

      ({ overview:overview, stock:stockView, purchase:purchaseView, ticketing:ticketOps, 'manage-sales':manageSales,
         emd:emdView, ttl:ttlView,
         masters:mastersView, airlines:airlinesView, airports:airportsView, countries:countriesView, states:statesView,
         bsp:bspView, refunds:refundsView }[sub] || overview)(page, ctx);

      ctx.mount.appendChild(page);
    }
  });

  function subDesc(sub) {
    return ({ overview:'Issue, re-issue, refund and void air tickets — with BSP/ADM reconciliation.',
      stock:'Ticket routes, pricing and stock — pre-loaded inventory with remaining vs sold quantity.',
      purchase:'Passenger ticket purchases — passport holder, route, trip type and paid / due / total.',
      ticketing:'Every ticketing operation in one place — Direct Sale · Refund · Re-Issue · Void · EMD / Ancillary.',
      'manage-sales':'Costing, sale, commission and net profit for every ticket — plus per-airline/agent reports.',
      emd:'Sell ancillary services (baggage, seats, meals, insurance, lounge) as EMDs with a branded receipt.',
      ttl:'Held-PNR ticketing-deadline queue — countdowns by urgency, ticket-now and extend actions.',
      masters:'Airlines, Airports, Country & States — all reference masters in one place.',
      airlines:'Airline master — carriers, IATA designators and status.',
      airports:'Airport master — stations, IATA codes and cities.',
      countries:'Country master — used across ticketing and business services.',
      states:'Country-wise states master — used across ticketing and business services.',
      bsp:'Import the BSP billing file, auto-match against issued tickets and clear reconciliation exceptions; track ADMs with a dispute-deadline countdown.',
      refunds:'Every refund request from filing to payout, with airline-penalty math.' }[sub]) || '';
  }

  /* ======================================================= OVERVIEW HUB */
  function overview(page) {
    var t = tickets();
    var revenue = t.reduce(function (s,x){ return s + (x.sale||0); }, 0);
    var profit  = t.reduce(function (s,x){ return s + netProfitOf(x); }, 0);
    var issued  = t.filter(function (x){ return x.status==='Issued'; });
    var held    = t.filter(function (x){ return x.status==='Hold'; });
    var unpaid  = t.filter(function (x){ return x.payStatus && x.payStatus!=='Paid'; });
    var outstanding = unpaid.reduce(function (s,x){ return s + outstandingOf(x); }, 0);
    var margin  = revenue ? Math.round(profit/revenue*100) : 0;
    // 7 KPIs — slim cards (~30% smaller, same text size/colour), all on ONE row;
    // click any for a full breakdown.
    page.appendChild(el('div.kpi-grid.kpi-slim.kpi-onerow.stagger', null, [
      kpi('Tickets Sold', t.length, 'ticket-perforated', function(){ kpiTickets(t); }, momentum(t)),
      kpi('Issued', issued.length, 'check2-circle', function(){ kpiList('Issued Tickets — '+issued.length, 'check2-circle', issued,
        [['Issued', issued.length], ['Issue rate', t.length?Math.round(issued.length/t.length*100)+'%':'—'], ['Value', ui.money(issued.reduce(function(s,x){ return s+(x.sale||0); },0))]]); }),
      kpi('Held', held.length, 'hourglass-split', function(){ kpiList('Held — awaiting issue', 'hourglass-split', held,
        [['Held', held.length], ['At-risk value', ui.money(held.reduce(function(s,x){ return s+(x.sale||0); },0))]]); }),
      kpi('Sales Value', ui.money(revenue,{compact:true}), 'cash-coin', function(){ kpiSales(t); }, momentum(t, function(x){ return x.sale||0; })),
      kpi('Net Profit', ui.money(profit,{compact:true}), 'graph-up-arrow', function(){ kpiProfit(t); }, momentum(t, function(x){ return netProfitOf(x); })),
      kpi('Avg Margin', margin+'%', 'percent', function(){ kpiMargin(t); }),
      kpi('Outstanding', ui.money(outstanding,{compact:true}), 'wallet2', function(){ kpiList('Outstanding Payment', 'wallet2', unpaid,
        [['Unpaid tickets', unpaid.length], ['Total outstanding', ui.money(outstanding)]]); })
    ]));

    // --- Action Center: what needs attention (each row navigates) ---
    var ttls = db.col ? db.col('air_ttl') : [];
    var refs = db.airRefunds ? db.airRefunds() : [];
    var acNow = Date.now();
    function acDaysLeft(d){ return d ? Math.round((new Date(d).getTime()-acNow)/86400000) : null; }
    var held = t.filter(function(x){ return x.status==='Hold'; });
    var duePay = t.filter(function(x){ return ['Due','Unpaid','Partial'].indexOf(x.payStatus)>=0; });
    var ttlDue = ttls.filter(function(r){ var dl=acDaysLeft(r.ttl||r.deadline||r.due); return dl!=null && dl<=3 && r.status!=='Ticketed'; });
    var refPending = refs.filter(function(r){ return ['Requested','Filed','Received'].indexOf(r.status)>=0; });
    var acAlerts = [
      held.length      ? { icon:'pause-circle-fill',      tone:'warning', n:held.length,       text:'held tickets awaiting issue',       route:'travels/air-ticketing/manage-sales' } : null,
      ttlDue.length    ? { icon:'alarm-fill',             tone:'error',   n:ttlDue.length,      text:'ticketing deadlines within 3 days', route:'travels/air-ticketing/ttl' } : null,
      duePay.length    ? { icon:'cash-coin',              tone:'warning', n:duePay.length,      text:'tickets with outstanding payment',  route:'travels/air-ticketing/manage-sales' } : null,
      refPending.length ? { icon:'arrow-counterclockwise', tone:'info',   n:refPending.length,  text:'refunds in progress',               route:'travels/air-ticketing/refunds' } : null
    ].filter(Boolean);
    if (acAlerts.length) {
      page.appendChild(el('div.section-label',{text:'Action Center — needs attention'}));
      page.appendChild(el('div.card', null, [ el('div.card-body', null, acAlerts.map(function(a){
        return el('div.data-row', { style:{cursor:'pointer'}, onclick:(function(rt){ return function(){ EPAL.router.navigate(rt); }; })(a.route) }, [
          ui.frag('<span class="notif-ico notif-'+a.tone+'">'+ui.icon(a.icon)+'</span>'),
          el('div.flex-1', null, [ el('span.strong',{text:a.n+' '}), el('span.text-dim',{text:a.text}) ]),
          ui.frag('<span class="text-mute">'+ui.icon('chevron-right')+'</span>')
        ]);
      })) ]));
    }

    // Route Network map + Top Routes, Airline League, Forward Bookings
    bspCountdown(page);
    routeNetwork(page, t);
    airlineLeague(page, t);
    demandRow(page, t);

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

  /* ======================================================= TICKET MANAGE (stock) */
  function stock() { return S.list('air_stock'); }
  function remOf(s) { return Math.max(0, (+s.qty||0) - (+s.sold||0)); }
  function airlineNameOf(code) { var a=(airlines()||[]).filter(function(x){ return x.iata===code; })[0]; return a ? a.name+' ('+code+')' : (code||'—'); }
  var STOCK_PORTALS = ['', 'Sabre', 'Amadeus', 'Galileo', 'BSP IATA', 'Direct'];

  function stockView(page) {
    page.querySelector('.page-actions').prepend(el('button.btn.btn-ghost', { html: ui.icon('plus-lg')+' Add New Ticket', onclick:function(){ stockForm(null); } }));
    var host = el('div'); page.appendChild(host);
    drawStock(host);
  }
  function drawStock(host) {
    host.innerHTML = '';
    var list = stock();
    var totQty=0, totSold=0, stockVal=0, totSales=0, active=0;
    list.forEach(function(s){ totQty+=(+s.qty||0); totSold+=(+s.sold||0); stockVal+=remOf(s)*(+s.cost||0); totSales+=(+s.sold||0)*(+s.price||0); if(s.status!=='Inactive') active++; });
    var rem = totQty - totSold;
    host.appendChild(el('div.kpi-grid.kpi-slim.kpi-onerow.stagger', null, [
      kpi('Routes', list.length, 'signpost-split', function(){ stockList('All Routes — '+list.length, list); }),
      kpi('Total Stock', ui.num(totQty), 'stack', function(){ stockList('Ticket Stock — '+ui.num(totQty), list); }),
      kpi('Sold', ui.num(totSold), 'check2-circle', function(){ stockList('Sold', list.filter(function(s){ return (+s.sold||0)>0; })); }),
      kpi('Remaining', ui.num(rem), 'box-seam', function(){ stockList('Remaining stock', list.filter(function(s){ return remOf(s)>0; })); }),
      kpi('Stock Value', ui.money(stockVal,{compact:true}), 'lock-fill', function(){ stockList('Unsold stock value', list.filter(function(s){ return remOf(s)>0; })); }),
      kpi('Total Sales', ui.money(totSales,{compact:true}), 'cash-coin', function(){ stockList('Sales by route', list); }),
      kpi('Active Routes', String(active), 'toggle-on', function(){ stockList('Active routes', list.filter(function(s){ return s.status!=='Inactive'; })); })
    ]));
    var t = stockTable(list, function(){ drawStock(host); });
    host.appendChild(el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon('card-list')+' Ticket List' }), el('span.card-sub', { text: list.length+' route'+(list.length===1?'':'s')+' · price, stock & sales' }) ]),
      el('div.card-body', null, [ t.el ])
    ]));
  }
  function stockTable(rows, refresh) {
    return EPAL.table({
      columns: [
        { key:'route', label:'Ticket Route', render:function(s){ return '<div class="strong">'+ui.escapeHtml(s.route||'')+'</div><div class="mt-1"><span class="badge">'+ui.escapeHtml((s.fromCode||'')+' ⇄ '+(s.toCode||''))+'</span></div>'; }, sortVal:function(s){ return s.route; } },
        { key:'airlineCode', label:'Airline', render:function(s){ return ui.escapeHtml(airlineNameOf(s.airlineCode)); }, sortVal:function(s){ return s.airlineCode; } },
        { key:'vendor', label:'Vendor', render:function(s){ return ui.escapeHtml(s.vendor||'—'); } },
        { key:'portal', label:'Portal', render:function(s){ return s.portal? '<span class="badge">'+ui.escapeHtml(s.portal)+'</span>' : '—'; } },
        { key:'price', label:'Price', num:true, money:true },
        { key:'remaining', label:'Remaining Qty', num:true, sortVal:function(s){ return remOf(s); }, render:function(s){ var r=remOf(s); return '<span class="num '+(r===0?'text-mute':r<=2?'text-warn':'')+'">'+r+'</span>'; } },
        { key:'sold', label:'Sale Qty', num:true, render:function(s){ return String(+s.sold||0); } },
        { key:'totalSales', label:'Total Sales', num:true, sortVal:function(s){ return (+s.sold||0)*(+s.price||0); }, render:function(s){ return '<span class="num strong">'+ui.money((+s.sold||0)*(+s.price||0))+'</span>'; } },
        { key:'status', label:'Status', badge:{ Active:'good', Inactive:'' } }
      ],
      rows:rows, searchKeys:['route','fromCode','toCode','airlineCode','vendor','portal'],
      quickFilter:'airlineCode', filterPanel:true, filters:[{ key:'status', label:'Status' }, { key:'vendor', label:'Vendor' }],
      pageSize:12, exportName:'ticket-stock.csv', pdfTitle:'Ticket Stock',
      onRow:function(s){ stockDetail(s, refresh); },
      actions: ui.actions({
        edit:  function(s){ stockForm(s, refresh); },
        del:   function(s){ ui.confirm({ title:'Delete route "'+s.route+'"?', danger:true, confirmLabel:'Delete' }).then(function(ok){ if(ok){ S.removeFrom('air_stock', s.id); ui.toast('Deleted','success'); if(refresh) refresh(); }}); },
        print: function(s){ stockPrint(s); }
      }),
      empty:{ icon:'ticket-perforated', title:'No ticket stock yet', hint:'Add a route with its price & quantity.' }
    });
  }
  function stockList(title, rows) { var body=kpiShell(title, 'ticket-perforated', [['Routes', rows.length], ['Stock', ui.num(rows.reduce(function(a,s){return a+(+s.qty||0);},0))], ['Sold', ui.num(rows.reduce(function(a,s){return a+(+s.sold||0);},0))], ['Sales', ui.money(rows.reduce(function(a,s){return a+(+s.sold||0)*(+s.price||0);},0))]]); body.appendChild(el('div.card', null, [ el('div.card-body', null, [ stockTable(rows, null).el ]) ])); }

  function stockDetail(s, refresh) {
    var body = el('div');
    var m = ui.modal({ title: s.route, icon:'ticket-perforated', size:'lg', body:body, footer:false });
    var rem = remOf(s), totalSales = (+s.sold||0)*(+s.price||0), margin = s.price? Math.round((s.price-(+s.cost||0))/s.price*100):0;
    var actions = el('div.flex.gap-1.items-center.flex-wrap', { style:{ marginLeft:'auto' } });
    actions.appendChild(el('button.btn.btn-sm.btn-outline', { html: ui.icon('pencil')+' Edit', onclick:function(){ m.close(); stockForm(s, refresh); } }));
    actions.appendChild(el('button.btn.btn-sm.btn-primary', { html: ui.icon('printer')+' Print', onclick:function(){ stockPrint(s); } }));
    body.appendChild(el('div.card', null, [ el('div.card-body', null, [
      el('div.flex.items-center.gap-2.flex-wrap.mb-3', null, [
        ui.frag('<span class="notif-ico notif-info">'+ui.icon('airplane-fill')+'</span>'),
        el('div.flex-1', { style:{ minWidth:'180px' } }, [ el('div.fw-700', { style:{ fontSize:'17px' }, text: s.route }),
          el('div.flex.items-center.gap-2.flex-wrap', null, [ el('span.badge', { text: s.fromCode+' ⇄ '+s.toCode }), el('span.badge', { text: airlineNameOf(s.airlineCode) }),
            el('span.badge.badge-'+(s.status==='Inactive'?'':'good'), { text: s.status||'Active' }) ]) ]),
        actions
      ]),
      el('div.stat-row', null, [ st2('Price', ui.money(s.price||0)), st2('Total Qty', ui.num(s.qty||0)), st2('Sold', ui.num(s.sold||0)), st2('Remaining', ui.num(rem)) ]),
      el('div.stat-row.mt-2', null, [ st2('Total Sales', ui.money(totalSales)), st2('Cost / seat', ui.money(s.cost||0)), st2('Margin', margin+'%'), st2('Stock Value', ui.money(rem*(+s.cost||0))) ])
    ]) ]));
    body.appendChild(el('div.card', null, [ el('div.card-head', null, [ el('h3', { html: ui.icon('info-circle')+' Route & Sourcing' }) ]),
      el('div.card-body', null, [ el('div.data-list', null, [
        drow('From', s.fromCode), drow('Via', s.via), drow('To', s.toCode), drow('Airline', airlineNameOf(s.airlineCode)),
        drow('Vendor', s.vendor), drow('Portal / GDS', s.portal), drow('Status', s.status||'Active')
      ]) ]) ]));
    if (EPAL.comments && EPAL.comments.widget) { body.appendChild(el('div.section-label', { text:'Notes' })); body.appendChild(EPAL.comments.widget('air-stock', s.id)); }
  }
  function stockForm(s, refresh) {
    var isNew = !s;
    var apOpts = (airports()||[]).map(function(a){ return [a.iata, a.iata+' · '+a.city]; });
    var alOpts = (airlines()||[]).filter(function(a){ return a.status==='active' || !a.status; }).map(function(a){ return [a.iata, a.name+' ('+a.iata+')']; });
    var vnOpts = [['','— none —']].concat((db.vendors?db.vendors():[]).map(function(v){ return [v.name, v.name]; }));
    EPAL.formModal({
      title: isNew ? 'Add New Ticket' : 'Edit Ticket Route', icon:'ticket-perforated', size:'lg', record: s || { status:'Active', qty:1, sold:0 },
      fields: [
        { type:'section', label:'Route' },
        { key:'fromCode', label:'From', type:'select', options:apOpts, required:true },
        { key:'via', label:'Via (optional)', type:'select', options:[['','— direct —']].concat(apOpts) },
        { key:'toCode', label:'To', type:'select', options:apOpts, required:true },
        { key:'airlineCode', label:'Airline', type:'select', options:alOpts, required:true },
        { type:'section', label:'Sourcing' },
        { key:'vendor', label:'Vendor', type:'select', options:vnOpts },
        { key:'portal', label:'Portal / GDS', type:'select', options:STOCK_PORTALS.map(function(p){ return [p, p||'— none —']; }), default:'' },
        { type:'section', label:'Pricing & Stock' },
        { key:'cost', label:'Cost / seat (৳)', type:'money', default:0, min:0 },
        { key:'price', label:'Sale price (৳)', type:'money', required:true, min:0 },
        { key:'qty', label:'Total quantity (stock)', type:'number', required:true, min:0, default:1 },
        { key:'sold', label:'Sold quantity', type:'number', default:0, min:0 },
        { key:'status', label:'Status', type:'select', options:['Active','Inactive'], default:'Active' }
      ],
      saveLabel: isNew ? 'Add Ticket' : 'Save',
      onSave: function(val){
        if (val.fromCode === val.toCode) { ui.toast('From and To must differ','error'); return false; }
        var r = s || { id:'STK-'+ui.uid('').slice(-4).toUpperCase(), created:Date.now() };
        r.fromCode=val.fromCode; r.toCode=val.toCode; r.via=val.via||''; r.airlineCode=val.airlineCode;
        r.vendor=val.vendor||''; r.portal=val.portal||''; r.cost=+val.cost||0; r.price=+val.price||0;
        r.qty=+val.qty||0; r.sold=Math.min(+val.sold||0, +val.qty||0); r.status=val.status||'Active';
        r.route = r.via ? (r.fromCode+' → '+r.via+' → '+r.toCode) : (r.fromCode+' → '+r.toCode);
        S.upsert('air_stock', r);
        ui.toast('Ticket route "'+r.route+'" saved','success');
        if (refresh) refresh(); else EPAL.router.render();
        return true;
      }
    });
  }
  function stockPrint(s) {
    function row(k,v){ return '<tr><td>'+ui.escapeHtml(k)+'</td><td>'+ui.escapeHtml(String(v==null||v===''?'—':v))+'</td></tr>'; }
    ui.printDoc({ title:'Ticket Route · '+s.route, subtitle:'Epal Travels & Consultancy · Ticket Stock', meta:airlineNameOf(s.airlineCode), footer:'Ticketing Desk',
      bodyHtml:'<table>'+row('Route', s.route)+row('Sector', s.fromCode+' ⇄ '+s.toCode)+row('Airline', airlineNameOf(s.airlineCode))+row('Vendor', s.vendor)+row('Portal', s.portal)+
        row('Cost / seat', ui.money(s.cost||0))+row('Price', ui.money(s.price||0))+row('Total qty', s.qty||0)+row('Sold', s.sold||0)+row('Remaining', remOf(s))+
        '<tr><th>Total Sales</th><th>'+ui.money((+s.sold||0)*(+s.price||0))+'</th></tr></table>' });
  }

  /* ======================================================= TICKET PURCHASE */
  function purchases() { return S.list('air_purchases'); }
  var TRIP_TYPES = ['One-way', 'Two-way', 'Multi-City'];
  function purchaseView(page) {
    page.querySelector('.page-actions').prepend(el('button.btn.btn-ghost', { html: ui.icon('cart-plus')+' Add New Ticket Purchase', onclick:function(){ purchaseForm(null); } }));
    var host = el('div'); page.appendChild(host); drawPurchases(host);
  }
  function drawPurchases(host) {
    host.innerHTML='';
    var list = purchases();
    var total=0, paid=0, due=0, confirmed=0, pending=0;
    list.forEach(function(p){ total+=(+p.total||0); paid+=(+p.paid||0); due+=(+p.due||0); if(p.due<=0) confirmed++; else pending++; });
    host.appendChild(el('div.kpi-grid.kpi-slim.kpi-onerow.stagger', null, [
      kpi('Purchases', list.length, 'cart-check', function(){ purchaseList('All Purchases', list); }),
      kpi('Total Value', ui.money(total,{compact:true}), 'cash-stack', function(){ purchaseList('All Purchases', list); }),
      kpi('Paid', ui.money(paid,{compact:true}), 'check2-circle', function(){ purchaseList('Fully paid', list.filter(function(p){ return p.due<=0; })); }),
      kpi('Due', ui.money(due,{compact:true}), 'wallet2', function(){ purchaseList('With outstanding', list.filter(function(p){ return p.due>0; })); }),
      kpi('Settled', confirmed, 'patch-check-fill', function(){ purchaseList('Settled', list.filter(function(p){ return p.due<=0; })); }),
      kpi('Outstanding', pending, 'hourglass-split', function(){ purchaseList('Outstanding', list.filter(function(p){ return p.due>0; })); }),
      kpi('Passengers', list.length, 'people', function(){ purchaseList('Passengers', list); })
    ]));
    var t = purchaseTable(list, function(){ drawPurchases(host); });
    host.appendChild(el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon('cart-check-fill')+' Ticket Purchase List' }), el('span.card-sub', { text: list.length+' purchase'+(list.length===1?'':'s') }) ]),
      el('div.card-body', null, [ t.el ])
    ]));
  }
  function purchaseTable(rows, refresh) {
    return EPAL.table({
      columns:[
        { key:'ticketNo', label:'Ticket No', render:function(p){ return '<div class="strong">'+ui.escapeHtml(p.ticketNo||'—')+'</div><div class="text-mute xs">'+ui.date(p.purchaseDate)+'</div>'; }, sortVal:function(p){ return p.ticketNo; } },
        { key:'passenger', label:'Passport Holder', render:function(p){ return '<span class="strong">'+ui.escapeHtml(p.passenger||'—')+'</span>'; } },
        { key:'vendor', label:'Vendor', render:function(p){ return ui.escapeHtml(p.vendor||'—'); } },
        { key:'route', label:'Ticket', render:function(p){ return '<span class="badge badge-accent">By Air</span> <span class="badge">'+ui.escapeHtml(p.route||'')+'</span>'; }, sortVal:function(p){ return p.route; } },
        { key:'tripType', label:'Trip Type', badge:{} },
        { key:'amount', label:'Amount Info', num:true, sortVal:function(p){ return +p.total||0; }, render:function(p){ return '<div class="num"><div class="xs text-good">Paid: '+ui.money(p.paid||0)+'</div><div class="xs '+((p.due||0)>0?'text-bad':'text-mute')+'">Due: '+ui.money(p.due||0)+'</div><div class="strong">Total: '+ui.money(p.total||0)+'</div></div>'; } },
        { key:'payStatus', label:'Status', badge:{ Confirm:'good', Partial:'warn', Pending:'bad' } }
      ],
      rows:rows, searchKeys:['ticketNo','passenger','passport','vendor','route'],
      quickFilter:'tripType', filterPanel:true, filters:[{ key:'payStatus', label:'Status' }, { key:'vendor', label:'Vendor' }],
      dateKey:'purchaseDate', pageSize:12, exportName:'ticket-purchases.csv', pdfTitle:'Ticket Purchases',
      onRow:function(p){ purchaseDetail(p, refresh); },
      actions: ui.actions({
        edit:  function(p){ purchaseForm(p, refresh); },
        del:   function(p){ ui.confirm({ title:'Delete purchase "'+p.ticketNo+'"?', danger:true, confirmLabel:'Delete' }).then(function(ok){ if(ok){ S.removeFrom('air_purchases', p.id); ui.toast('Deleted','success'); if(refresh)refresh(); }}); },
        print: function(p){ purchasePrint(p); }
      }),
      empty:{ icon:'cart', title:'No ticket purchases yet', hint:'Record your first passenger ticket purchase.' }
    });
  }
  function purchaseList(title, rows) { var body=kpiShell(title+' — '+rows.length, 'cart-check', [['Purchases', rows.length], ['Total', ui.money(rows.reduce(function(a,p){return a+(+p.total||0);},0))], ['Paid', ui.money(rows.reduce(function(a,p){return a+(+p.paid||0);},0))], ['Due', ui.money(rows.reduce(function(a,p){return a+(+p.due||0);},0))]]); body.appendChild(el('div.card', null, [ el('div.card-body', null, [ purchaseTable(rows, null).el ]) ])); }
  function purchaseDetail(p, refresh) {
    var body = el('div');
    var m = ui.modal({ title: p.passenger+' · '+p.ticketNo, icon:'cart-check', size:'lg', body:body, footer:false });
    var actions = el('div.flex.gap-1.items-center.flex-wrap', { style:{ marginLeft:'auto' } });
    actions.appendChild(el('button.btn.btn-sm.btn-outline', { html: ui.icon('pencil')+' Edit', onclick:function(){ m.close(); purchaseForm(p, refresh); } }));
    actions.appendChild(el('button.btn.btn-sm.btn-primary', { html: ui.icon('printer')+' Print', onclick:function(){ purchasePrint(p); } }));
    body.appendChild(el('div.card', null, [ el('div.card-body', null, [
      el('div.flex.items-center.gap-2.flex-wrap.mb-3', null, [
        ui.frag('<span class="notif-ico notif-info">'+ui.icon('person-vcard')+'</span>'),
        el('div.flex-1', { style:{ minWidth:'180px' } }, [ el('div.fw-700', { style:{ fontSize:'17px' }, text: p.passenger }),
          el('div.flex.items-center.gap-2.flex-wrap', null, [ el('span.badge.badge-accent', { text:'By Air' }), el('span.badge', { text: p.route }), el('span.badge', { text: p.tripType }), el('span.badge.badge-'+(p.due<=0?'good':p.paid>0?'warn':'bad'), { text: p.payStatus }) ]) ]),
        actions
      ]),
      el('div.stat-row', null, [ st2('Total', ui.money(p.total||0)), st2('Paid', ui.money(p.paid||0)), st2('Due', ui.money(p.due||0)), st2('Airline', airlineNameOf(p.airlineCode)) ])
    ]) ]));
    body.appendChild(el('div.card', null, [ el('div.card-head', null, [ el('h3', { html: ui.icon('info-circle')+' Purchase Details' }) ]),
      el('div.card-body', null, [ el('div.data-list', null, [
        drow('Ticket No', p.ticketNo), drow('Purchase date', p.purchaseDate?ui.date(p.purchaseDate):'—'), drow('Passport No', p.passport),
        drow('Route', p.route), drow('Trip type', p.tripType), drow('Airline', airlineNameOf(p.airlineCode)), drow('Vendor', p.vendor)
      ]) ]) ]));
    if (EPAL.comments && EPAL.comments.widget) { body.appendChild(el('div.section-label', { text:'Notes' })); body.appendChild(EPAL.comments.widget('air-purchase', p.id)); }
  }
  function purchaseForm(p, refresh) {
    var isNew = !p;
    var apOpts = (airports()||[]).map(function(a){ return [a.iata, a.iata+' · '+a.city]; });
    var alOpts = (airlines()||[]).map(function(a){ return [a.iata, a.name+' ('+a.iata+')']; });
    var vnOpts = [['','— none —']].concat((db.vendors?db.vendors():[]).map(function(v){ return [v.name, v.name]; }));
    EPAL.formModal({
      title: isNew ? 'Add New Ticket Purchase' : 'Edit Ticket Purchase', icon:'cart-plus', size:'lg', record: p || { tripType:'One-way', purchaseDate:'2026-07-05' },
      fields:[
        { type:'section', label:'Passenger & Ticket' },
        { key:'passenger', label:'Passport holder', type:'text', required:true, col2:true, placeholder:'e.g. HOSSAIN AHMED' },
        { key:'passport', label:'Passport No', type:'text', placeholder:'e.g. A1234567' },
        { key:'ticketNo', label:'Ticket No / PNR', type:'text', required:true, placeholder:'e.g. 09PPXW' },
        { key:'purchaseDate', label:'Purchase date', type:'date', default:'2026-07-05' },
        { type:'section', label:'Route' },
        { key:'fromCode', label:'From', type:'select', options:apOpts, required:true },
        { key:'via', label:'Via (optional)', type:'select', options:[['','— direct —']].concat(apOpts) },
        { key:'toCode', label:'To', type:'select', options:apOpts, required:true },
        { key:'airlineCode', label:'Airline', type:'select', options:alOpts },
        { key:'tripType', label:'Trip type', type:'select', options:TRIP_TYPES, default:'One-way' },
        { key:'vendor', label:'Vendor', type:'select', options:vnOpts },
        { type:'section', label:'Amount' },
        { key:'total', label:'Total (৳)', type:'money', required:true, min:0 },
        { key:'paid', label:'Paid (৳)', type:'money', default:0, min:0 }
      ],
      saveLabel: isNew ? 'Add Purchase' : 'Save',
      onSave: function(val){
        if (val.fromCode === val.toCode) { ui.toast('From and To must differ','error'); return false; }
        var r = p || { id:'PUR-'+ui.uid('').slice(-4).toUpperCase(), created:Date.now(), status:'Confirm' };
        r.passenger=(val.passenger||'').trim(); r.passport=val.passport; r.ticketNo=(val.ticketNo||'').trim(); r.purchaseDate=val.purchaseDate;
        r.fromCode=val.fromCode; r.toCode=val.toCode; r.via=val.via||''; r.airlineCode=val.airlineCode; r.tripType=val.tripType||'One-way'; r.vendor=val.vendor||'';
        r.total=+val.total||0; r.paid=Math.min(+val.paid||0, +val.total||0); r.due=Math.max(0, r.total-r.paid);
        r.payStatus = r.due<=0 ? 'Confirm' : (r.paid>0 ? 'Partial' : 'Pending');
        r.route = r.via ? (r.fromCode+' → '+r.via+' → '+r.toCode) : (r.fromCode+' → '+r.toCode);
        S.upsert('air_purchases', r);
        ui.toast('Ticket purchase for "'+r.passenger+'" saved','success');
        if (refresh) refresh(); else EPAL.router.render();
        return true;
      }
    });
  }
  function purchasePrint(p) {
    function row(k,v){ return '<tr><td>'+ui.escapeHtml(k)+'</td><td>'+ui.escapeHtml(String(v==null||v===''?'—':v))+'</td></tr>'; }
    ui.printDoc({ title:'Ticket Purchase · '+p.ticketNo, subtitle:'Epal Travels & Consultancy', meta:p.passenger+' · '+p.route, footer:'Ticketing Desk',
      bodyHtml:'<table>'+row('Passport holder', p.passenger)+row('Passport No', p.passport)+row('Ticket No', p.ticketNo)+row('Purchase date', p.purchaseDate)+
        row('Route', p.route)+row('Trip type', p.tripType)+row('Airline', airlineNameOf(p.airlineCode))+row('Vendor', p.vendor)+
        row('Paid', ui.money(p.paid||0))+row('Due', ui.money(p.due||0))+'<tr><th>Total</th><th>'+ui.money(p.total||0)+'</th></tr></table>' });
  }

  /* ======================================================= COUNTRY master */
  function countries() { return S.list('air_countries'); }
  function countriesView(page) {
    page.querySelector('.page-actions').prepend(el('button.btn.btn-ghost', { html: ui.icon('plus-lg')+' Add Country', onclick:function(){ countryForm(null); } }));
    var host = el('div'); page.appendChild(host); drawCountries(host);
  }
  function drawCountries(host) {
    host.innerHTML='';
    var list = countries();
    var active=list.filter(function(c){ return c.status==='Active'; }).length;
    var inactive=list.filter(function(c){ return c.status==='Inactive'; }).length;
    var archived=list.filter(function(c){ return c.status==='Archived'; }).length;
    host.appendChild(el('div.kpi-grid.kpi-slim.kpi-onerow.stagger', null, [
      kpi('Total Countries', list.length, 'globe-americas', function(){ masterList('All Countries', 'globe', list, countryTable); }),
      kpi('Active', active, 'check2-circle', function(){ masterList('Active Countries', 'check2-circle', list.filter(function(c){ return c.status==='Active'; }), countryTable); }),
      kpi('Inactive', inactive, 'pause-circle', function(){ masterList('Inactive Countries', 'pause-circle', list.filter(function(c){ return c.status==='Inactive'; }), countryTable); }),
      kpi('Archived', archived, 'archive', function(){ masterList('Archived Countries', 'archive', list.filter(function(c){ return c.status==='Archived'; }), countryTable); })
    ]));
    host.appendChild(el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon('flag-fill')+' Countries' }), el('span.card-sub', { text: list.length+' countries' }) ]),
      el('div.card-body', null, [ countryTable(list, function(){ drawCountries(host); }).el ])
    ]));
  }
  function countryTable(rows, refresh) {
    return EPAL.table({
      columns:[
        { key:'name', label:'Country', render:function(c){ return '<span class="strong">'+ui.icon('flag')+' '+ui.escapeHtml(c.name)+'</span>'; } },
        { key:'code', label:'Code', render:function(c){ return '<span class="mono">'+ui.escapeHtml(c.code||'—')+'</span>'; } },
        { key:'status', label:'Status', badge:{ Active:'good', Inactive:'warn', Archived:'' } },
        { key:'created', label:'Created', date:true }
      ],
      rows:rows, searchKeys:['name','code'], quickFilter:'status', filterPanel:true, pageSize:15,
      exportName:'countries.csv', pdfTitle:'Countries',
      actions: ui.actions({
        edit:  function(c){ countryForm(c, refresh); },
        del:   function(c){ ui.confirm({ title:'Delete "'+c.name+'"?', danger:true, confirmLabel:'Delete' }).then(function(ok){ if(ok){ S.removeFrom('air_countries', c.id); ui.toast('Deleted','success'); if(refresh)refresh(); }}); }
      }),
      empty:{ icon:'globe', title:'No countries' }
    });
  }
  function countryForm(c, refresh) {
    var isNew = !c;
    EPAL.formModal({
      title: isNew ? 'Add Country' : 'Edit Country', icon:'flag-fill', size:'md', record: c || { status:'Active' },
      fields:[
        { key:'name', label:'Country name', type:'text', required:true, col2:true, placeholder:'e.g. Bangladesh' },
        { key:'code', label:'ISO code', type:'text', placeholder:'e.g. BD' },
        { key:'status', label:'Status', type:'select', options:['Active','Inactive','Archived'], default:'Active' }
      ],
      saveLabel: isNew ? 'Add Country' : 'Save',
      onSave: function(val){ var r=c||{ id:'CTY-'+ui.uid('').slice(-4).toUpperCase(), created:new Date().toISOString().slice(0,10) };
        r.name=(val.name||'').trim(); r.code=(val.code||'').trim().toUpperCase(); r.status=val.status||'Active';
        S.upsert('air_countries', r); ui.toast('Country "'+r.name+'" saved','success'); if(refresh)refresh(); else EPAL.router.render(); return true; }
    });
  }

  /* ======================================================= STATES master */
  function statesList() { return S.list('air_states'); }
  function statesView(page) {
    page.querySelector('.page-actions').prepend(el('button.btn.btn-ghost', { html: ui.icon('plus-lg')+' Add State', onclick:function(){ stateForm(null); } }));
    var host = el('div'); page.appendChild(host); drawStates(host);
  }
  function drawStates(host) {
    host.innerHTML='';
    var list = statesList();
    var active=list.filter(function(s){ return s.status==='Active'; }).length;
    var cover={}; list.forEach(function(s){ cover[s.country]=1; });
    host.appendChild(el('div.kpi-grid.kpi-slim.kpi-onerow.stagger', null, [
      kpi('Total States', list.length, 'geo-alt-fill', function(){ masterList('All States', 'geo-alt', list, stateTable); }),
      kpi('Active', active, 'check2-circle', function(){ masterList('Active States', 'check2-circle', list.filter(function(s){ return s.status==='Active'; }), stateTable); }),
      kpi('Inactive', list.length-active, 'pause-circle', function(){ masterList('Inactive States', 'pause-circle', list.filter(function(s){ return s.status!=='Active'; }), stateTable); }),
      kpi('Countries Covered', Object.keys(cover).length, 'globe-americas', function(){ masterList('States', 'geo-alt', list, stateTable); })
    ]));
    host.appendChild(el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon('geo-alt-fill')+' States' }), el('span.card-sub', { text: list.length+' states · '+Object.keys(cover).length+' countries' }) ]),
      el('div.card-body', null, [ stateTable(list, function(){ drawStates(host); }).el ])
    ]));
  }
  function stateTable(rows, refresh) {
    return EPAL.table({
      columns:[
        { key:'country', label:'Country', render:function(s){ return '<span class="strong">'+ui.icon('flag')+' '+ui.escapeHtml(s.country)+'</span>'; } },
        { key:'state', label:'State', render:function(s){ return '<span class="strong">'+ui.escapeHtml(s.state)+'</span>'; } },
        { key:'status', label:'Status', badge:{ Active:'good', Inactive:'warn' } },
        { key:'created', label:'Created', date:true }
      ],
      rows:rows, searchKeys:['country','state'], quickFilter:'country', filterPanel:true, filters:[{ key:'status', label:'Status' }], pageSize:15,
      exportName:'states.csv', pdfTitle:'States',
      actions: ui.actions({
        edit:  function(s){ stateForm(s, refresh); },
        del:   function(s){ ui.confirm({ title:'Delete "'+s.state+'"?', danger:true, confirmLabel:'Delete' }).then(function(ok){ if(ok){ S.removeFrom('air_states', s.id); ui.toast('Deleted','success'); if(refresh)refresh(); }}); }
      }),
      empty:{ icon:'geo-alt', title:'No states' }
    });
  }
  function stateForm(s, refresh) {
    var isNew = !s;
    var cOpts = countries().map(function(c){ return [c.name, c.name]; });
    EPAL.formModal({
      title: isNew ? 'Add State' : 'Edit State', icon:'geo-alt-fill', size:'md', record: s || { status:'Active' },
      fields:[
        { key:'country', label:'Country', type:'select', options:cOpts, required:true, col2:true },
        { key:'state', label:'State / division', type:'text', required:true, col2:true, placeholder:'e.g. Dhaka' },
        { key:'status', label:'Status', type:'select', options:['Active','Inactive'], default:'Active' }
      ],
      saveLabel: isNew ? 'Add State' : 'Save',
      onSave: function(val){ var r=s||{ id:'STA-'+ui.uid('').slice(-4).toUpperCase(), created:new Date().toISOString().slice(0,10) };
        r.country=val.country; r.state=(val.state||'').trim(); r.status=val.status||'Active';
        S.upsert('air_states', r); ui.toast('State "'+r.state+'" saved','success'); if(refresh)refresh(); else EPAL.router.render(); return true; }
    });
  }
  // shared "open a filtered list in a modal" helper for the master KPIs
  function masterList(title, icon, rows, tableFn) { var body=kpiShell(title+' — '+rows.length, icon, null); body.appendChild(el('div.card', null, [ el('div.card-body', null, [ tableFn(rows, null).el ]) ])); }

  /* ======================================================= TICKET OPERATIONS hub
     One screen, five tabs — record EVERY ticketing operation: Direct Sale,
     Refund, Re-Issue, Void, EMD / Ancillary. Mirrors the legacy Ticketing screen. */
  function ticketOps(page, ctx) {
    var op = (ctx && ctx.params && ctx.params.op) || 'direct';
    var TABS = [ ['direct','Direct Sale','cart-plus'], ['refund','Refund','arrow-counterclockwise'],
      ['reissue','Re-Issue','arrow-repeat'], ['void','Void','x-octagon'], ['emd','EMD / Ancillary','bag-plus'] ];
    var bar = el('div.pill-tab.mb-3');
    var host = el('div');
    TABS.forEach(function (tb) {
      bar.appendChild(el('button' + (op===tb[0]?'.active':''), { html: ui.icon(tb[2])+' '+tb[1], onclick: function () {
        op = tb[0]; Array.prototype.forEach.call(bar.children, function (b) { b.classList.remove('active'); }); this.classList.add('active'); paint();
      } }));
    });
    page.appendChild(bar); page.appendChild(host);
    function paint() { host.innerHTML=''; ({ direct:directSale, refund:refundForm, reissue:reissueForm, void:voidForm, emd:emdOpForm }[op] || directSale)(host); }
    paint();
  }

  /* ---- shared bits for the operation forms -------------------------------*/
  var EMD_SERVICES = ['Excess Baggage','Seat Upgrade','Meal','Airport Tax','Visa Fee','Travel Insurance','Lounge Access','Date Change','Other'];
  function opAgents(){ return [['','— Select agent —']].concat(subAgents().map(function(a){ return [a.id, a.name+(a.agency?' · '+a.agency:'')]; })); }
  function opVendors(){ return [['','— Select vendor —']].concat((db.vendors?db.vendors():[]).map(function(v){ return [v.name, v.name]; })); }
  function opPortals(){ return [['','— Select portal —']].concat((db.col('tv_portals')||[]).map(function(p){ return [p.name, p.name]; })); }
  function opTickets(){ return [['','— Select ticket / invoice —']].concat(tickets().map(function(t){ return [t.id, t.id+' · '+t.passenger+' · '+t.route]; })); }
  function opAirports(){ return (airports()||[]).map(function(a){ return [a.iata, a.iata+' · '+a.city]; }); }
  function num(form,k){ var v=form.values(); return +v[k]||0; }
  function setInp(form,k,v){ if(form.ctrls&&form.ctrls[k]&&form.ctrls[k].input) form.ctrls[k].input.value=v; }
  function opBanner(html){ return el('div.build-banner.mb-3', null, [ ui.frag(ui.icon('exclamation-triangle-fill')), el('div',{html:html}) ]); }
  function opTotals(rows){ var box=el('div',{style:{maxWidth:'380px',marginLeft:'auto'}});
    rows.forEach(function(r,i){ box.appendChild(el('div.flex.justify-between.items-center'+(r[2]?'.strong':''),{style:{padding:'7px 2px',borderTop:(r[2]||i)?'1px solid var(--border)':'none'}},
      [ el('span'+(r[2]?'':'.text-mute'),{text:r[0]}), el('span.num',{style:(r[1]<0?{color:'#f0506e'}:null),text:ui.money(r[1])}) ])); });
    return box; }
  function opFooter(label, fn){ return el('div.flex.justify-end.gap-1.mt-3', null, [
    el('a.btn.btn-ghost',{ href:'#/travels/air-ticketing/manage-sales', html:ui.icon('arrow-left')+' Cancel' }),
    el('button.btn.btn-primary.btn-lg',{ html:ui.icon('check-lg')+' '+label, onclick:fn }) ]); }
  function opCard(title, icon, formEl){ return el('div.card', null, [ el('div.card-head', null, [ el('h3',{ html: ui.icon(icon)+' '+title }) ]), el('div.card-body', null, [ formEl ]) ]); }
  function opSummary(title, sumEl){ return el('div.card', null, [ el('div.card-head', null, [ el('h3',{ html: ui.icon('calculator')+' '+title }) ]), el('div.card-body', null, [ sumEl ]) ]); }
  function stepper(steps, active){ return el('div.flex.gap-1.flex-wrap.mb-3', null, steps.map(function(s,i){ return el('span.badge'+(i===active?'.badge-accent':''), { text:(i+1)+' — '+s }); })); }

  /* ---- REFUND ------------------------------------------------------------*/
  function refundForm(page) {
    var sum = el('div');
    var form = EPAL.form([
      { type:'section', label:'Refund Header' },
      { key:'agent', label:'Agent', type:'select', options:opAgents() },
      { key:'refundDate', label:'Refund date', type:'date', required:true, default:'2026-07-05' },
      { key:'ticketId', label:'Original ticket / invoice', type:'select', options:opTickets(), required:true },
      { key:'refundStatus', label:'Refund status', type:'select', options:['Requested','Confirm','Filed','Paid'], default:'Confirm' },
      { type:'section', label:'Original Ticket Info' },
      { key:'vendor', label:'Vendor', type:'select', options:opVendors() },
      { key:'portal', label:'Portal', type:'select', options:opPortals() },
      { key:'refundRef', label:'Refund PNR / Ref No', type:'text' },
      { type:'section', label:'Refund Calculation (per ticket)' },
      { key:'ticketCost', label:'Original ticket cost', type:'money', default:0 },
      { key:'salePrice', label:'Original sale price', type:'money', default:0 },
      { key:'airlineRefund', label:'Airline refund amount', type:'money', required:true, default:0 },
      { key:'penalty', label:'Airline penalty / fee', type:'money', default:0 },
      { key:'serviceCharge', label:'Agent service charge', type:'money', default:0 },
      { key:'method', label:'Refund method', type:'select', options:['Bank','bKash','Cash','Card Reversal'], default:'Bank' }
    ], {});
    function recalc(){ var net = num(form,'airlineRefund') - num(form,'penalty') - num(form,'serviceCharge');
      sum.innerHTML=''; sum.appendChild(opTotals([ ['Airline refund', num(form,'airlineRefund')], ['Airline penalty', -num(form,'penalty')], ['Agent service charge', -num(form,'serviceCharge')], ['Net refund to customer', net, true] ])); }
    ['airlineRefund','penalty','serviceCharge'].forEach(function(k){ if(form.ctrls[k]) form.ctrls[k].input.addEventListener('input', recalc); });
    if (form.ctrls.ticketId) form.ctrls.ticketId.input.addEventListener('change', function(){ var t=tickets().filter(function(x){ return x.id===this.value; })[0]; if(t){ setInp(form,'ticketCost',t.cost||0); setInp(form,'salePrice',t.sale||0); setInp(form,'airlineRefund',t.cost||0); } recalc(); });
    recalc();
    page.appendChild(opBanner('<strong>Refund reverses the original sale.</strong> Ensure the airline has confirmed the refund amount before proceeding.'));
    page.appendChild(opCard('Ticket Refund', 'arrow-counterclockwise', form.el));
    page.appendChild(opSummary('Refund Summary', sum));
    page.appendChild(opFooter('Process Refund', function(){
      if(!form.validate()){ ui.toast('Complete the highlighted fields','error'); return; }
      var v=form.values(), t=tickets().filter(function(x){ return x.id===v.ticketId; })[0]||{}, net=num(form,'airlineRefund')-num(form,'penalty')-num(form,'serviceCharge');
      var rec={ id:ui.uid('RF'), date:v.refundDate, pnr:t.pnr||v.refundRef||'', passenger:t.passenger||'', airline:airlineNameOf(t.airlineCode||''), ticketNo:t.ticketNo||'',
        gross:num(form,'ticketCost'), airlineRefund:num(form,'airlineRefund'), penalty:num(form,'penalty'), fee:num(form,'serviceCharge'), netRefund:net, method:v.method, status:v.refundStatus||'Confirm', created:Date.now() };
      if(db.saveAirRefund) db.saveAirRefund(rec); else S.upsert('airRefunds', rec);
      if(t.id){ t.status='Refunded'; if(db.saveAirTicket) db.saveAirTicket(t); }
      ui.toast('Refund '+rec.id+' processed · net '+ui.money(net),'success'); EPAL.router.navigate('travels/air-ticketing/refunds');
    }));
  }

  /* ---- RE-ISSUE ----------------------------------------------------------*/
  function reissueForm(page) {
    var sum = el('div');
    var form = EPAL.form([
      { type:'section', label:'Original Ticket Reference' },
      { key:'agent', label:'Agent', type:'select', options:opAgents() },
      { key:'reissueDate', label:'Re-issue date', type:'date', required:true, default:'2026-07-05' },
      { key:'ticketId', label:'Original ticket / invoice', type:'select', options:opTickets(), required:true },
      { type:'section', label:'New Ticket Details' },
      { key:'newFrom', label:'New route — From', type:'select', options:opAirports() },
      { key:'newTo', label:'New route — To', type:'select', options:opAirports() },
      { key:'newTrip', label:'New trip type', type:'select', options:TRIP_TYPES, default:'One-way' },
      { key:'newPnr', label:'New PNR / Ticket No', type:'text' },
      { key:'newVendor', label:'New vendor', type:'select', options:opVendors() },
      { key:'newTravelDate', label:'New travel date', type:'date' },
      { type:'section', label:'Re-Issue Charges & Pricing' },
      { key:'origCost', label:'Original cost price', type:'money', default:0 },
      { key:'origSale', label:'Original sale price', type:'money', default:0 },
      { key:'penalty', label:'Airline re-issue penalty', type:'money', default:0 },
      { key:'fareDiff', label:'Fare difference (new − old)', type:'money', default:0 },
      { key:'serviceCharge', label:'Agent service charge', type:'money', default:0 }
    ], {});
    function recalc(){ var newCost=num(form,'origCost')+num(form,'penalty')+num(form,'fareDiff'); var addl=num(form,'penalty')+num(form,'fareDiff')+num(form,'serviceCharge');
      sum.innerHTML=''; sum.appendChild(opTotals([ ['Airline penalty', num(form,'penalty')], ['Fare difference', num(form,'fareDiff')], ['Agent service charge', num(form,'serviceCharge')], ['New total cost', newCost], ['Additional charge to customer', addl, true] ])); }
    ['origCost','penalty','fareDiff','serviceCharge'].forEach(function(k){ if(form.ctrls[k]) form.ctrls[k].input.addEventListener('input', recalc); });
    if (form.ctrls.ticketId) form.ctrls.ticketId.input.addEventListener('change', function(){ var t=tickets().filter(function(x){ return x.id===this.value; })[0]; if(t){ setInp(form,'origCost',t.cost||0); setInp(form,'origSale',t.sale||0); } recalc(); });
    recalc();
    page.appendChild(stepper(['Original Ticket','New Ticket Details','Charges & Pricing','Payment'], 1));
    page.appendChild(opBanner('<strong>Re-issue changes the flight / date / route.</strong> Both old and new ticket details are recorded for a full audit trail.'));
    page.appendChild(opCard('Ticket Re-Issue', 'arrow-repeat', form.el));
    page.appendChild(opSummary('Re-Issue Summary', sum));
    page.appendChild(opFooter('Process Re-Issue', function(){
      if(!form.validate()){ ui.toast('Complete the highlighted fields','error'); return; }
      var v=form.values(), t=tickets().filter(function(x){ return x.id===v.ticketId; })[0]||{};
      var newCost=num(form,'origCost')+num(form,'penalty')+num(form,'fareDiff'), addl=num(form,'penalty')+num(form,'fareDiff')+num(form,'serviceCharge');
      var rec={ id:ui.uid('RI'), date:v.reissueDate, ticketId:v.ticketId, passenger:t.passenger||'', oldRoute:t.route||'',
        newRoute:(v.newFrom&&v.newTo)?(v.newFrom+' → '+v.newTo):(t.route||''), newPnr:v.newPnr, penalty:num(form,'penalty'), fareDiff:num(form,'fareDiff'), serviceCharge:num(form,'serviceCharge'), newCost:newCost, addlCharge:addl, created:Date.now() };
      S.upsert('air_reissues', rec);
      if(t.id){ t.status='Re-issued'; if(v.newFrom&&v.newTo){ t.route=v.newFrom+' → '+v.newTo; t.fromCode=v.newFrom; t.toCode=v.newTo; } if(v.newPnr) t.pnr=v.newPnr; t.cost=newCost; if(db.saveAirTicket) db.saveAirTicket(t); }
      ui.toast('Ticket re-issued · new cost '+ui.money(newCost),'success'); EPAL.router.navigate('travels/air-ticketing/manage-sales');
    }));
  }

  /* ---- VOID --------------------------------------------------------------*/
  function voidForm(page) {
    var sum = el('div');
    var form = EPAL.form([
      { type:'section', label:'Void Header' },
      { key:'agent', label:'Agent', type:'select', options:opAgents() },
      { key:'voidDate', label:'Void date', type:'date', required:true, default:'2026-07-05' },
      { key:'ticketId', label:'Ticket to void', type:'select', options:opTickets(), required:true },
      { key:'voidReason', label:'Void reason', type:'select', options:['Duplicate booking','Wrong fare','Customer cancelled','Schedule change','Other'] },
      { key:'confirmNo', label:'Airline confirmation No', type:'text' },
      { type:'section', label:'Void Charges & Reversal' },
      { key:'origCost', label:'Original cost price', type:'money', default:0 },
      { key:'origSale', label:'Original sale price', type:'money', default:0 },
      { key:'voidPenalty', label:'Void penalty / fee', type:'money', default:0 },
      { key:'agentVoidFee', label:'Agent void fee', type:'money', default:0 }
    ], {});
    function recalc(){ var refund=num(form,'origSale')-num(form,'voidPenalty')-num(form,'agentVoidFee');
      sum.innerHTML=''; sum.appendChild(opTotals([ ['Original sale price', num(form,'origSale')], ['Void penalty', -num(form,'voidPenalty')], ['Agent void fee', -num(form,'agentVoidFee')], ['Refund to agent / customer', refund, true] ])); }
    ['origSale','voidPenalty','agentVoidFee'].forEach(function(k){ if(form.ctrls[k]) form.ctrls[k].input.addEventListener('input', recalc); });
    if (form.ctrls.ticketId) form.ctrls.ticketId.input.addEventListener('change', function(){ var t=tickets().filter(function(x){ return x.id===this.value; })[0]; if(t){ setInp(form,'origCost',t.cost||0); setInp(form,'origSale',t.sale||0); } recalc(); });
    recalc();
    page.appendChild(opBanner('<strong>Void is only allowed within the airline’s void window (usually same day / 24 hrs).</strong> A late void may incur full penalty. This action cannot be undone.'));
    page.appendChild(opCard('Ticket Void', 'x-octagon', form.el));
    page.appendChild(opSummary('Void Summary', sum));
    page.appendChild(opFooter('Process Void', function(){
      if(!form.validate()){ ui.toast('Complete the highlighted fields','error'); return; }
      var v=form.values(), t=tickets().filter(function(x){ return x.id===v.ticketId; })[0]||{}, refund=num(form,'origSale')-num(form,'voidPenalty')-num(form,'agentVoidFee');
      var rec={ id:ui.uid('VD'), date:v.voidDate, ticketId:v.ticketId, passenger:t.passenger||'', reason:v.voidReason, confirmNo:v.confirmNo, penalty:num(form,'voidPenalty'), agentFee:num(form,'agentVoidFee'), refund:refund, created:Date.now() };
      S.upsert('air_voids', rec);
      if(t.id){ t.status='Void'; if(db.saveAirTicket) db.saveAirTicket(t); }
      ui.toast('Ticket voided · refund '+ui.money(refund),'success'); EPAL.router.navigate('travels/air-ticketing/manage-sales');
    }));
  }

  /* ---- EMD / ANCILLARY ---------------------------------------------------*/
  function emdOpForm(page) {
    var sum = el('div');
    var form;
    function recalc(){ if(!form) return; var v=form.values(), c=0, s=0; (v.items||[]).forEach(function(r){ c+=(+r.cost||0); s+=(+r.sale||0); });
      sum.innerHTML=''; sum.appendChild(opTotals([ ['Total cost', c], ['Total sale', s], ['Gross profit', s-c, true] ])); }
    form = EPAL.form([
      { type:'section', label:'EMD / Ancillary Header' },
      { key:'agent', label:'Agent', type:'select', options:opAgents() },
      { key:'issueDate', label:'Issue date', type:'date', required:true, default:'2026-07-05' },
      { key:'items', type:'items', label:'Ancillary / EMD Items (one row per service)', required:true, min:1, addLabel:'Add Item',
        columns:[
          { key:'passenger', label:'Passenger / Customer', type:'text', width:'2fr' },
          { key:'serviceType', label:'Service Type', type:'select', options:EMD_SERVICES, width:'1.4fr' },
          { key:'emdNo', label:'EMD / Ref No', type:'text', width:'1.4fr' },
          { key:'vendor', label:'Vendor / Airline', type:'text', width:'1.4fr' },
          { key:'cost', label:'Cost', type:'money' },
          { key:'sale', label:'Sale', type:'money' }
        ],
        footer:function(rows){ var c=0,s=0; (rows||[]).forEach(function(r){ c+=(+r.cost||0); s+=(+r.sale||0); }); return 'Cost: <strong>'+ui.money(c)+'</strong> · Sale: <strong>'+ui.money(s)+'</strong> · Profit: <strong>'+ui.money(s-c)+'</strong>'; },
        onChange:function(){ recalc(); } },
      { type:'section', label:'Payment from Agent' },
      { key:'received', label:'Amount received', type:'money', default:0 },
      { key:'payStatus', label:'Payment status', type:'select', options:['Paid','Partial','Due'], default:'Due' }
    ], { items:[{}] });
    recalc();
    page.appendChild(opBanner('<strong>EMD</strong> is used for ancillary charges: excess baggage, seat upgrade, meals, airport tax, visa fee, travel insurance and other services.'));
    page.appendChild(opCard('EMD / Ancillary', 'bag-plus', form.el));
    page.appendChild(opSummary('EMD Summary', sum));
    page.appendChild(opFooter('Save EMD', function(){
      if(!form.validate()){ ui.toast('Add at least one item','error'); return; }
      var v=form.values(), items=(v.items||[]).filter(function(r){ return (r.passenger||'').trim() || (+r.sale||0)>0; });
      if(!items.length){ ui.toast('Add at least one item','error'); return; }
      var n=130450090000+Date.now()%900000;
      items.forEach(function(r,i){ S.upsert('air_emd', { id:ui.uid('EMD'), emdNo:r.emdNo||String(n+i), date:v.issueDate, passenger:r.passenger, ticketRef:r.emdNo||'', serviceType:r.serviceType, vendor:r.vendor, description:r.serviceType, cost:+r.cost||0, sale:+r.sale||0, payStatus:v.payStatus||'Due', created:Date.now() }); });
      ui.toast(items.length+' EMD item'+(items.length===1?'':'s')+' saved','success'); EPAL.router.navigate('travels/air-ticketing/emd');
    }));
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
          { key:'passport', label:'Passport No', type:'text', width:'1.4fr' },
          { key:'ticketNo', label:'Ticket No', type:'text', width:'1.4fr' },
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
          passenger:(p.passenger||'').trim(), phone:'', passport:(p.passport||'').trim(),
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
          td(payBadge(x.payStatus).outerHTML), td(statusBadge(x.status).outerHTML),
          el('td', null, [ ui.rowActions(ui.actions({
            print: (function(tk){return function(){ printTicket(tk); };})(x),
            wa:    { phone:'', text: ticketMsg(x) },
            gmail: { to:'', subject:'Your e-ticket '+x.id+' — '+x.route, body: ticketMsg(x) }
          })) ]) ]);
      });
      host.innerHTML='';
      host.appendChild(tableCard('Ticket Sales Ledger',
        ['Ticket','Passenger','Route','Airline · PNR','Base','Tax','Cost','Sale','Comm','Net Profit','Payment','Status',''], rows, 'No tickets sold yet.', { chipCol: 11 }));
    }
    draw();
  }

  /* print / share a ticket (e-ticket to the passenger) --------------------*/
  function printTicket(x) {
    function r(k, v) { return '<tr><td>' + k + '</td><td>' + ui.escapeHtml(String(v == null ? '—' : v)) + '</td></tr>'; }
    ui.printDoc({ title: 'e-Ticket · ' + x.id, subtitle: x.passenger + ' · ' + x.route, meta: 'Air Ticket',
      bodyHtml: '<table>' + r('Passenger', x.passenger) + r('Route', x.route) + r('Airline / PNR', x.airlineCode + ' · ' + x.pnr) +
        r('Fare (sale)', ui.money(x.sale)) + r('Payment', x.payStatus) + r('Status', x.status) + '</table>' });
  }
  function ticketMsg(x) {
    return 'e-Ticket ' + x.id + '\nPassenger: ' + x.passenger + '\nRoute: ' + x.route +
      '\nFlight: ' + x.airlineCode + ' ' + x.pnr + '\nFare: ' + ui.money(x.sale) + '\nStatus: ' + x.status +
      '\n\n— Epal Travels & Consultancy';
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
      // print e-ticket · WhatsApp · Gmail (with e-ticket card attach)
      body.appendChild(el('div.flex.gap-1.flex-wrap.mt-2', null, [ ui.rowActions(ui.actions({
        print: function(){ printTicket(t); },
        wa:    { phone: t.phone, text: ticketMsg(t) },
        gmail: { to: '', subject: 'Your e-ticket '+t.id+' — '+t.route, body: ticketMsg(t) },
        profile: { name: t.passenger, card: { title: t.passenger, subtitle: t.route+' · '+t.id, lines: [
          ['Airline / PNR', (t.airlineCode||'')+' '+(t.pnr||'—')], ['Travel date', t.travelDate?ui.date(t.travelDate):'—'],
          ['Fare', ui.money(t.sale)], ['Status', t.status], ['Payment', t.payStatus] ] }, pdf: function(){ printTicket(t); } }
      })) ]));

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
    var pa = page.querySelector('.page-actions'); if (pa) pa.prepend(el('button.btn.btn-ghost',{html:ui.icon('plus-lg')+' Add Airline',onclick:function(){ editAirline(null, function(){ drawAirlines(host); }); }}));
    var host = el('div'); page.appendChild(host); drawAirlines(host);
  }
  function drawAirlines(host) {
    host.innerHTML='';
    var rows = airlines().map(function (a) {
      return el('tr.row-click', { onclick:(function(al){ return function(){ airlineDetail(al, function(){ drawAirlines(host); }); }; })(a) }, [
        td('<span class="badge mono">'+ui.escapeHtml(a.iata)+'</span>'),
        td('<span class="strong">'+ui.escapeHtml(a.name)+'</span>'),
        td(ui.escapeHtml(a.country||'—')),
        td('<span class="badge '+(a.status==='active'?'badge-good':'')+'">'+a.status+'</span>') ]);
    });
    host.appendChild(el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon('airplane-engines-fill')+' Airlines' }), el('span.card-sub', { text: airlines().length+' carriers' }) ]),
      el('div.card-body', null, [ tableCard(null, ['IATA','Airline','Country','Status'], rows, 'No airlines. Add your first carrier.', { chipCol: 3 }) ])
    ]));
  }

  /* ======================================================= MASTERS (consolidated)
     One nav item, four tabs — Airlines · Airports · Country · States — instead of
     four separate sidebar entries. The Add button adapts to the active tab. */
  function mastersView(page, ctx) {
    var tab = (ctx && ctx.params && ctx.params.tab) || 'airlines';
    var TABS = [ ['airlines','Airlines','airplane-engines-fill'], ['airports','Airports','geo-alt-fill'], ['countries','Country','flag-fill'], ['states','States','geo-alt'] ];
    var ADD = { airlines:'Add Airline', airports:'Add Airport', countries:'Add Country', states:'Add State' };
    var DRAW = { airlines:drawAirlines, airports:drawAirports, countries:drawCountries, states:drawStates };
    var pa = page.querySelector('.page-actions');
    var addBtn = el('button.btn.btn-ghost'); if (pa) pa.prepend(addBtn);
    var bar = el('div.pill-tab.mb-3'); var host = el('div');
    TABS.forEach(function (tb) { bar.appendChild(el('button' + (tab===tb[0]?'.active':''), { html: ui.icon(tb[2])+' '+tb[1], onclick: function () {
      tab = tb[0]; Array.prototype.forEach.call(bar.children, function (b) { b.classList.remove('active'); }); this.classList.add('active'); paint();
    } })); });
    page.appendChild(bar); page.appendChild(host);
    function addFn(){ ({ airlines:function(){ editAirline(null, paint); }, airports:function(){ editAirport(null, paint); }, countries:function(){ countryForm(null, paint); }, states:function(){ stateForm(null, paint); } }[tab])(); }
    function paint(){ if(addBtn){ addBtn.innerHTML = ui.icon('plus-lg')+' '+ADD[tab]; addBtn.onclick = addFn; } host.innerHTML=''; (DRAW[tab]||drawAirlines)(host); }
    paint();
  }
  // rich airline profile — carrier stats + the tickets sold on it (row-click opens it)
  function airlineDetail(a, refresh) {
    var body = el('div');
    ui.modal({ title: a.name + ' · ' + a.iata, icon: 'airplane-engines', size: 'lg', body: body, footer: false });
    var tks = tickets().filter(function (t) { return t.airlineCode === a.iata || t.airline === a.name; });
    var revenue = tks.reduce(function (s, t) { return s + (t.sale || 0); }, 0);
    var profit = tks.reduce(function (s, t) { return s + netProfitOf(t); }, 0);
    var actions = el('div.flex.gap-1.items-center', { style: { marginLeft: 'auto' } });
    actions.appendChild(el('button.btn.btn-sm.btn-outline', { html: ui.icon('pencil') + ' Edit', onclick: function () { editAirline(a, refresh || function () { EPAL.router.render(); }); } }));
    body.appendChild(el('div.card', null, [ el('div.card-body', null, [ el('div.flex.items-center.gap-2.flex-wrap', null, [
      ui.frag('<span class="notif-ico notif-info">' + ui.icon('airplane-engines-fill') + '</span>'),
      el('div.flex-1', { style: { minWidth: '180px' } }, [ el('div.fw-700', { style: { fontSize: '17px' }, text: a.name }),
        el('div.flex.items-center.gap-2', null, [ el('span.badge.mono', { text: a.iata }), el('div.text-mute.sm', { text: a.country || '—' }), el('span.badge' + (a.status === 'active' ? '.badge-good' : ''), { text: a.status }) ]) ]),
      actions ]) ]) ]));
    body.appendChild(el('div.kpi-grid.kpi-compact.stagger', null, [
      kpi('Tickets', tks.length, 'ticket-perforated'), kpi('Sales Value', ui.money(revenue, { compact: true }), 'cash-coin'),
      kpi('Net Profit', ui.money(profit, { compact: true }), 'graph-up-arrow'), kpi('Avg Fare', ui.money(tks.length ? Math.round(revenue / tks.length) : 0, { compact: true }), 'calculator')
    ]));
    if (tks.length) {
      var trs = tks.slice().sort(function (x, y) { return x.created < y.created ? 1 : -1; }).slice(0, 10).map(function (x) {
        return el('tr.row-click', { onclick: (function (tk) { return function () { ticketDetail(tk); }; })(x) }, [
          td('<span class="strong">' + x.id + '</span>'), td(ui.escapeHtml(x.passenger)), td('<span class="mono">' + x.route + '</span>'), tdN(ui.money(x.sale)), td(statusBadge(x.status).outerHTML) ]);
      });
      body.appendChild(el('div.section-label', { text: 'Recent tickets on ' + a.iata }));
      body.appendChild(tableCard(null, ['Ticket', 'Passenger', 'Route', 'Sale', 'Status'], trs, ''));
    } else body.appendChild(el('div.empty-state', null, [ ui.frag(ui.icon('ticket-perforated')), el('h3', { text: 'No tickets yet on this carrier' }) ]));
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
    page.querySelector('.page-actions').prepend(el('button.btn.btn-ghost',{html:ui.icon('plus-lg')+' Add Airport',onclick:function(){ editAirport(null, function(){ drawAirports(host); }); }}));
    var host = el('div'); page.appendChild(host); drawAirports(host);
  }
  function drawAirports(host) {
    host.innerHTML='';
    var list = airports();
    var cc={}, sc={}, ct={};
    list.forEach(function(a){ if(a.country) cc[a.country]=1; if(a.state) sc[a.country+'/'+a.state]=1; if(a.city) ct[a.city]=1; });
    host.appendChild(el('div.kpi-grid.kpi-slim.kpi-onerow.stagger', null, [
      kpi('Total Airports', ui.num(list.length), 'airplane-fill', function(){ airportModalList('All Airports', list); }),
      kpi('Countries Covered', Object.keys(cc).length, 'globe-americas', function(){ airportModalList('Airports by Country', list); }),
      kpi('States Covered', Object.keys(sc).length, 'geo-alt-fill', function(){ airportModalList('Airports by State', list); }),
      kpi('Cities Covered', Object.keys(ct).length, 'buildings', function(){ airportModalList('Airports by City', list); })
    ]));
    host.appendChild(el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon('geo-alt-fill')+' Airports' }), el('span.card-sub', { text: list.length+' stations' }) ]),
      el('div.card-body', null, [ airportTable(list, function(){ drawAirports(host); }).el ])
    ]));
  }
  function airportTable(rows, refresh) {
    return EPAL.table({
      columns:[
        { key:'iata', label:'IATA', render:function(a){ return '<span class="badge mono">'+ui.escapeHtml(a.iata||'—')+'</span>'; } },
        { key:'name', label:'Airport', render:function(a){ return '<span class="strong">'+ui.icon('airplane')+' '+ui.escapeHtml(a.name||'')+'</span>'; } },
        { key:'city', label:'City', render:function(a){ return ui.escapeHtml(a.city||'—'); } },
        { key:'state', label:'State', render:function(a){ return ui.escapeHtml(a.state||'—'); } },
        { key:'country', label:'Country', render:function(a){ return ui.escapeHtml(a.country||'—'); } }
      ],
      rows:rows, searchKeys:['iata','name','city','state','country'], quickFilter:'country', filterPanel:true, filters:[{ key:'state', label:'State' }], pageSize:15,
      exportName:'airports.csv', pdfTitle:'Airports',
      onRow:function(a){ airportDetail(a, refresh); },
      actions: ui.actions({
        edit:  function(a){ editAirport(a, refresh); },
        del:   function(a){ ui.confirm({ title:'Delete "'+a.name+'"?', danger:true, confirmLabel:'Delete' }).then(function(ok){ if(ok){ try{ db.remove('airports', a.id); }catch(e){ S.removeFrom('airports', a.id); } ui.toast('Deleted','success'); if(refresh)refresh(); }}); }
      }),
      empty:{ icon:'airplane', title:'No airports', hint:'Add your first station.' }
    });
  }
  function airportModalList(title, rows) { var body=kpiShell(title+' — '+rows.length, 'geo-alt-fill', null); body.appendChild(el('div.card', null, [ el('div.card-body', null, [ airportTable(rows, null).el ]) ])); }
  // rich airport profile — station stats + tickets routed through it
  function airportDetail(a, refresh) {
    var body = el('div');
    ui.modal({ title: a.name + ' · ' + a.iata, icon: 'geo-alt-fill', size: 'lg', body: body, footer: false });
    var tks = tickets().filter(function (t) { return String(t.route || '').indexOf(a.iata) >= 0; });
    var revenue = tks.reduce(function (s, t) { return s + (t.sale || 0); }, 0);
    var actions = el('div.flex.gap-1.items-center', { style: { marginLeft: 'auto' } });
    actions.appendChild(el('button.btn.btn-sm.btn-outline', { html: ui.icon('pencil') + ' Edit', onclick: function () { editAirport(a, refresh || function () { EPAL.router.render(); }); } }));
    body.appendChild(el('div.card', null, [ el('div.card-body', null, [ el('div.flex.items-center.gap-2.flex-wrap', null, [
      ui.frag('<span class="notif-ico notif-info">' + ui.icon('geo-alt-fill') + '</span>'),
      el('div.flex-1', { style: { minWidth: '180px' } }, [ el('div.fw-700', { style: { fontSize: '17px' }, text: a.name }),
        el('div.flex.items-center.gap-2', null, [ el('span.badge.mono', { text: a.iata }), el('div.text-mute.sm', { text: (a.city || '—') + ' · ' + (a.country || '—') }) ]) ]),
      actions ]) ]) ]));
    body.appendChild(el('div.kpi-grid.kpi-compact.stagger', null, [
      kpi('Tickets Routed', tks.length, 'ticket-perforated'), kpi('Sales Value', ui.money(revenue, { compact: true }), 'cash-coin'),
      kpi('City', a.city || '—', 'buildings'), kpi('Country', a.country || '—', 'globe')
    ]));
    if (tks.length) {
      var trs = tks.slice().sort(function (x, y) { return x.created < y.created ? 1 : -1; }).slice(0, 10).map(function (x) {
        return el('tr.row-click', { onclick: (function (tk) { return function () { ticketDetail(tk); }; })(x) }, [
          td('<span class="strong">' + x.id + '</span>'), td(ui.escapeHtml(x.passenger)), td('<span class="mono">' + x.route + '</span>'), td(x.airlineCode + ' · ' + x.pnr), td(statusBadge(x.status).outerHTML) ]);
      });
      body.appendChild(el('div.section-label', { text: 'Tickets routed through ' + a.iata }));
      body.appendChild(tableCard(null, ['Ticket', 'Passenger', 'Route', 'Airline · PNR', 'Status'], trs, ''));
    } else body.appendChild(el('div.empty-state', null, [ ui.frag(ui.icon('airplane')), el('h3', { text: 'No tickets through this station yet' }) ]));
  }
  function editAirport(a, done) {
    var isNew = !a;
    var cOpts = [['','— select —']].concat(countries().map(function(c){ return [c.name, c.name]; }));
    EPAL.formModal({
      title: isNew ? 'Add Airport' : 'Edit Airport', icon:'geo-alt-fill', size:'md', record: a || {},
      fields:[
        { key:'name', label:'Airport name', type:'text', required:true, col2:true, placeholder:'e.g. Hazrat Shahjalal Intl' },
        { key:'iata', label:'IATA code', type:'text', required:true, placeholder:'e.g. DAC' },
        { key:'city', label:'City', type:'text', placeholder:'e.g. Dhaka' },
        { key:'country', label:'Country', type:'select', options:cOpts },
        { key:'state', label:'State', type:'text', placeholder:'e.g. Dhaka' }
      ],
      saveLabel: isNew ? 'Add Airport' : 'Save',
      onSave: function(val){
        var r = a || { id:'AP-'+ui.uid('').slice(-4).toUpperCase() };
        r.name=(val.name||'').trim(); r.iata=(val.iata||'').toUpperCase().trim(); r.city=(val.city||'').trim(); r.country=val.country||''; r.state=(val.state||'').trim();
        if (db.saveAirport) db.saveAirport(r); else db.save('airports', r);
        ui.toast('Airport "'+r.name+'" saved','success'); if(done)done(); else EPAL.router.render(); return true;
      }
    });
  }

  /* ======================================================= BSP / ADM RECON */
  function bspView(page) {
    page.querySelector('.page-actions').prepend(el('button.btn.btn-primary',{
      html:ui.icon('upload')+' Import BSP file', onclick:function(){ importBspModal(); } }));

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

    // BSP FILE IMPORT + RECONCILIATION
    renderBspRecon(page, bsp);

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

  /* ---- BSP file import + reconciliation ---------------------------------*/
  function persistBsp(bsp) { S.set('airBsp', bsp); }

  function importBspModal() {
    var body = el('div');
    body.appendChild(el('p.text-muted',{ text:'Paste the BSP billing file below (CSV: ticketNo,gross,commission,net) or generate a mock statement from issued tickets. Rows auto-match against the ERP by ticket number / PNR.' }));
    var ta = el('textarea.input', { rows:9, style:{ width:'100%', fontFamily:'monospace', whiteSpace:'pre' },
      placeholder:'ticketNo,gross,commission,net\n0577421,86500,6055,80445\n...' });
    body.appendChild(ta);
    body.appendChild(el('div.flex.gap-1.mt-2', null, [
      el('button.btn.btn-sm.btn-outline',{ html:ui.icon('magic')+' Generate mock statement',
        onclick:function(){ ta.value = mockBspCsv(); ui.toast('Mock BSP statement generated','success'); } }) ]));
    ui.modal({ title:'Import BSP File', icon:'upload', size:'lg', body:body,
      actions:[{ label:'Cancel', variant:'ghost' }, { label:'Import & Reconcile', variant:'primary', onClick:function(){
        var importRows = parseBspCsv(ta.value);
        if (!importRows.length) { ui.toast('No valid rows found — paste CSV or generate a mock statement','error'); return false; }
        var recon = reconcileBsp(importRows);
        var bsp = db.airBsp(); bsp.recon = recon; persistBsp(bsp);
        db.notify({ level:'info', title:'BSP File Imported', text:importRows.length+' rows · '+recon.exceptions.length+' exception(s)',
          companyId:'travels', icon:'upload' });
        ui.toast('Imported '+importRows.length+' rows · '+recon.exceptions.length+' exception(s)','success');
        EPAL.router.render();
      }}] });
  }

  function mockBspCsv() {
    var t = tickets().filter(function(x){ return x.status==='Issued' || x.status==='Re-issued'; });
    var lines = ['ticketNo,gross,commission,net'];
    // Drop the last ticket (→ in-ERP-not-in-BSP), nudge one amount (→ mismatch).
    var use = t.slice(0, Math.max(0, t.length-1));
    for (var i=0;i<use.length;i++){
      var x = use[i];
      var key = (x.ticketNo||'').trim() || x.pnr;
      var base = x.baseFare!=null ? x.baseFare : (x.cost||0);
      var gross = (x.sale||0) + (i===1 ? 750 : 0);   // deliberate discrepancy on row 2
      var comm = Math.round(base * 0.07);
      lines.push(key+','+gross+','+comm+','+(gross-comm));
    }
    // one extra BSP-only row not present in the ERP
    lines.push('TKT-BSP-9001,42000,2940,39060');
    return lines.join('\n');
  }

  function parseBspCsv(text) {
    var out = [];
    String(text||'').split(/\r?\n/).forEach(function(ln){
      ln = ln.trim(); if (!ln) return;
      var parts = ln.split(',');
      var key = (parts[0]||'').trim();
      if (!key || /ticket\s*no/i.test(key)) return;   // skip header
      out.push({ ticketNo:key, gross:+parts[1]||0, commission:+parts[2]||0, net:+parts[3]||0 });
    });
    return out;
  }

  function reconcileBsp(importRows) {
    var t = tickets();
    var matchedIds = {}, exceptions = [], matched = 0;
    importRows.forEach(function(row){
      var hit = null;
      for (var i=0;i<t.length;i++){
        var x = t[i];
        if ((x.ticketNo && x.ticketNo===row.ticketNo) || x.pnr===row.ticketNo) { hit = x; break; }
      }
      if (hit) {
        matchedIds[hit.id] = true;
        var diff = row.gross - (hit.sale||0);
        if (Math.abs(diff) > 1) exceptions.push({ type:'mismatch', key:row.ticketNo, passenger:hit.passenger,
          erpAmt:hit.sale||0, bspAmt:row.gross, diff:diff, waived:false, note:'' });
        else matched++;
      } else {
        exceptions.push({ type:'bsp-only', key:row.ticketNo, passenger:'—', erpAmt:0, bspAmt:row.gross, diff:row.gross, waived:false, note:'' });
      }
    });
    t.forEach(function(x){
      if (x.status!=='Issued' && x.status!=='Re-issued') return;
      if (matchedIds[x.id]) return;
      exceptions.push({ type:'erp-only', key:(x.ticketNo||'').trim()||x.pnr, passenger:x.passenger,
        erpAmt:x.sale||0, bspAmt:0, diff:-(x.sale||0), waived:false, note:'' });
    });
    return { period: bspPeriodLabel(), importedAt: today(), count: importRows.length,
      matched: matched, exceptions: exceptions, reconciled: false };
  }

  function bspPeriodLabel() {
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return months[NOW.getMonth()] + ' ' + NOW.getFullYear();
  }

  function renderBspRecon(page, bsp) {
    page.appendChild(el('div.section-label',{ text:'BSP File Reconciliation' }));
    var recon = bsp.recon;
    if (!recon) {
      page.appendChild(el('div.card', null, [ el('div.empty-state', null, [
        ui.frag(ui.icon('file-earmark-arrow-up')), el('h3',{text:'No BSP file imported'}),
        el('p.text-muted',{text:'Click "Import BSP file" to paste or generate a billing statement and auto-reconcile it against issued tickets.'}) ]) ]));
      return;
    }

    var open = recon.exceptions.filter(function(e){ return !e.waived; }).length;
    var discrepancies = recon.exceptions.filter(function(e){ return e.type==='mismatch' && !e.waived; }).length;
    var unmatched = recon.exceptions.filter(function(e){ return (e.type==='bsp-only'||e.type==='erp-only') && !e.waived; }).length;

    page.appendChild(el('div.kpi-grid', null, [
      kpi('Imported Rows', recon.count, 'file-earmark-spreadsheet'),
      kpi('Matched', recon.matched, 'check2-circle'),
      kpi('Unmatched', unmatched, 'question-octagon'),
      kpi('Discrepancies', discrepancies, 'exclamation-diamond')
    ]));

    // status banner
    if (recon.reconciled) {
      page.appendChild(el('div.build-banner', { style:{ borderLeft:'3px solid #23c17e' } }, [
        ui.frag(ui.icon('check2-circle')),
        el('div',{ html:'<strong>Period '+ui.escapeHtml(recon.period)+' reconciled</strong> · imported '+ui.escapeHtml(recon.importedAt)+' · '+recon.matched+' matched, all exceptions cleared or waived.' }) ]));
    } else {
      var barColor = open>0 ? '#f4b740' : '#23c17e';
      page.appendChild(el('div.build-banner', { style:{ borderLeft:'3px solid '+barColor } }, [
        ui.frag(ui.icon(open>0?'exclamation-triangle':'check2-circle')),
        el('div',{ html:'<strong>'+ui.escapeHtml(recon.period)+'</strong> · '+open+' open exception'+(open===1?'':'s')+' remaining. '+(open===0?'Ready to mark reconciled.':'Resolve or waive exceptions to reconcile.') }),
        el('button.btn.btn-sm'+(open===0?'.btn-primary':'.btn-outline'), { style:{ marginLeft:'auto' },
          html:ui.icon('shield-check')+' Mark Reconciled',
          onclick:function(){
            if (open>0) { ui.toast('Clear or waive all exceptions first','error'); return; }
            var b = db.airBsp(); if (b.recon) { b.recon.reconciled = true; persistBsp(b); }
            db.notify({ level:'success', title:'BSP Reconciled', text:'Period '+recon.period+' marked reconciled', companyId:'travels', icon:'shield-check' });
            ui.toast('Period marked reconciled','success'); EPAL.router.render();
          } }) ]));
    }

    // exceptions table
    if (recon.exceptions.length) {
      var exRows = recon.exceptions.map(function(e, idx){
        var typeLbl = e.type==='mismatch' ? 'Amount mismatch' : e.type==='bsp-only' ? 'In BSP, not in ERP' : 'In ERP, not in BSP';
        var typeCls = e.type==='mismatch' ? 'badge-warn' : 'badge-bad';
        var actTd = el('td');
        if (e.waived) {
          actTd.appendChild(el('span.badge.badge-good',{ text:'Waived', title:e.note||'' }));
        } else {
          var btnLabel = e.type==='mismatch' ? 'Accept BSP figure' : 'Waive';
          actTd.appendChild(el('button.btn.btn-sm.btn-outline',{ html:ui.icon('check2')+' '+btnLabel,
            onclick:(function(i){ return function(){ waiveException(i); }; })(idx) }));
        }
        return el('tr'+(e.waived?'':'') , null, [
          td('<span class="badge '+typeCls+'">'+typeLbl+'</span>'),
          td('<span class="mono strong">'+ui.escapeHtml(e.key)+'</span>'),
          td(ui.escapeHtml(e.passenger||'—')),
          tdN(e.erpAmt?ui.money(e.erpAmt):'—'),
          tdN(e.bspAmt?ui.money(e.bspAmt):'—'),
          td('<span class="num '+(e.diff===0?'text-mute':'text-bad')+'">'+(e.diff?ui.money(e.diff):'—')+'</span>'),
          actTd
        ]);
      });
      page.appendChild(tableCard('Reconciliation Exceptions',
        ['Type','Ticket / PNR','Passenger','ERP','BSP','Diff',''], exRows, 'No exceptions — fully matched.'));
    } else {
      page.appendChild(el('div.card', null, [ el('div.empty-state', null, [
        ui.frag(ui.icon('check2-circle')), el('h3',{text:'Fully matched'}),
        el('p.text-muted',{text:'Every imported row matched an issued ticket with no discrepancy.'}) ]) ]));
    }
  }

  function waiveException(idx) {
    var bsp = db.airBsp();
    if (!bsp.recon || !bsp.recon.exceptions[idx]) return;
    var e = bsp.recon.exceptions[idx];
    e.waived = true;
    e.note = e.type==='mismatch'
      ? 'Accepted BSP figure '+ui.money(e.bspAmt)+' (ERP '+ui.money(e.erpAmt)+', diff '+ui.money(e.diff)+') — adjustment recorded '+today()
      : (e.type==='bsp-only' ? 'BSP-only row waived — logged for follow-up '+today()
                             : 'ERP-only ticket waived — not yet in BSP file '+today());
    persistBsp(bsp);
    db.notify({ level:'info', title:'Exception Waived', text:e.key+' · '+e.note, companyId:'travels', icon:'check2' });
    ui.toast(e.type==='mismatch'?'BSP figure accepted · adjustment noted':'Exception waived','success');
    EPAL.router.render();
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
          td(refundBadge(r.status).outerHTML),
          el('td', null, [ ui.rowActions(ui.actions({
            print: (function(rf){ return function(){ printRefund(rf); }; })(r),
            wa:    { phone:'', text: refundMsg(r) },
            gmail: { to:'', subject:'Your refund '+r.id+' — Epal Travels', body: refundMsg(r) }
          })) ]) ]);
      });
      host.appendChild(tableCard('Refund Requests', ['Ref','Passenger','PNR','Airline','Gross','Penalty','Net Refund','Status',''], rows, 'No refunds yet.', { chipCol: 7 }));
    }
    draw();
  }
  function refundMsg(r) {
    return 'Refund ' + r.id + '\nPassenger: ' + r.passenger + '\nPNR: ' + (r.pnr || '—') +
      '\nNet refund: ' + ui.money(r.netRefund) + '\nStatus: ' + r.status + '\n\n— Epal Travels & Consultancy';
  }
  function printRefund(r) {
    function row(k, v) { return '<tr><td>' + k + '</td><td>' + ui.escapeHtml(String(v == null ? '—' : v)) + '</td></tr>'; }
    ui.printDoc({ title: 'Refund Voucher · ' + r.id, subtitle: r.passenger + (r.airline ? ' · ' + r.airline : ''), meta: 'Ticket refund',
      bodyHtml: '<table>' + row('Passenger', r.passenger) + row('PNR', r.pnr) + row('Airline', r.airline) +
        row('Gross fare', ui.money(r.gross)) + row('Penalty', ui.money(r.penalty)) + row('Net refund', ui.money(r.netRefund)) + row('Status', r.status) + '</table>' });
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

  /* ======================================================= EMD & ANCILLARY */
  function emdView(page) {
    page.querySelector('.page-actions').prepend(el('button.btn.btn-primary',{
      html:ui.icon('plus-lg')+' New EMD', onclick:function(){ newEmd(function(){ EPAL.router.render(); }); } }));

    var rows = db.col('air_emd');
    var revenue = rows.reduce(function(s,x){ return s+(x.sale||0); }, 0);
    var cost    = rows.reduce(function(s,x){ return s+(x.cost||0); }, 0);
    page.appendChild(el('div.kpi-grid.stagger', null, [
      kpi('EMDs Issued', rows.length, 'receipt'),
      kpi('Ancillary Revenue', ui.money(revenue,{compact:true}), 'cash-coin'),
      kpi('Ancillary Profit', ui.money(revenue-cost,{compact:true}), 'graph-up-arrow'),
      kpi('Avg. Margin', rows.length ? ui.money(Math.round((revenue-cost)/rows.length)) : ui.money(0), 'percent')
    ]));

    // mix by service type — small doughnut
    var byType = {}; EMD_SERVICES.forEach(function(s){ byType[s.id]=0; });
    rows.forEach(function(x){ byType[x.serviceType] = (byType[x.serviceType]||0) + (x.sale||0); });
    var mixKeys = EMD_SERVICES.map(function(s){ return s.id; }).filter(function(k){ return byType[k]>0; });
    if (mixKeys.length) {
      var cid = ui.uid('c');
      page.appendChild(el('div.card', { style:{ marginBottom:'14px' } }, [
        el('div.card-head', null, [ el('h3',{ html: ui.icon('pie-chart')+' Revenue by Service Type' }) ]),
        el('div.card-body', null, [ el('div',{ style:{ height:'240px', position:'relative' } }, [ el('canvas',{ id:cid }) ]) ])
      ]));
      requestAnimationFrame(function(){
        var c = ui.$('#'+cid); if(!c || !EPAL.charts) return;
        EPAL.charts.doughnut(c, { labels:mixKeys, data:mixKeys.map(function(k){ return byType[k]; }),
          colors:mixKeys.map(function(k){ return svcColor(k); }), money:true });
      });
    }

    var tbl = EPAL.table({
      columns:[
        { key:'emdNo', label:'EMD No', render:function(r){ return '<span class="mono">'+ui.escapeHtml(r.emdNo)+'</span>'; } },
        { key:'passenger', label:'Passenger', render:function(r){ return '<span class="strong">'+ui.escapeHtml(r.passenger)+'</span>'; } },
        { key:'serviceType', label:'Service', render:function(r){ return svcChip(r.serviceType); }, sortVal:function(r){ return r.serviceType; } },
        { key:'ticketRef', label:'Ticket / PNR', render:function(r){ return '<span class="mono">'+ui.escapeHtml(r.ticketRef||'—')+'</span>'; } },
        { key:'vendor', label:'Vendor', render:function(r){ return ui.escapeHtml(r.vendor||'—'); } },
        { key:'cost', label:'Cost', num:true, money:true },
        { key:'sale', label:'Sale', num:true, money:true },
        { key:'profit', label:'Profit', num:true, render:function(r){ var p=(r.sale||0)-(r.cost||0);
            return '<span class="num '+(p>=0?'text-good':'text-bad')+'">'+ui.money(p)+'</span>'; }, sortVal:function(r){ return (r.sale||0)-(r.cost||0); } },
        { key:'payStatus', label:'Payment', render:function(r){ return payBadge(r.payStatus).outerHTML; }, sortVal:function(r){ return r.payStatus; } }
      ],
      rows: rows,
      searchKeys:['emdNo','passenger','serviceType','ticketRef','vendor'],
      quickFilter:'serviceType', filterPanel:true, filters:[{ key:'payStatus', label:'Payment' }],
      pageSize:10, exportName:'emd-ancillary.csv', pdfTitle:'EMD & Ancillary',
      onRow:function(r){ emdDetail(r); },
      actions: ui.actions({
        print: function(r){ emdReceipt([r], r.emdNo, r.passenger, r.sale||0, r.cost||0); },
        wa:    function(r){ return { phone:'', text: emdMsg(r) }; },
        gmail: function(r){ return { to:'', subject:'EMD '+r.emdNo+' — Epal Travels', body: emdMsg(r) }; }
      }),
      empty:{ icon:'receipt', title:'No EMDs yet', hint:'Sell an ancillary service to raise your first EMD.' }
    });
    var card = el('div.card', null, [ el('div.card-body') ]);
    card.querySelector('.card-body').appendChild(tbl.el);
    page.appendChild(el('div.section-label',{text:'EMD Register'}));
    page.appendChild(card);
  }

  function emdDetail(r) {
    var body = el('div');
    body.appendChild(el('div.flex.gap-1.flex-wrap.mb-3', null, [
      svcBadgeEl(r.serviceType), payBadge(r.payStatus), el('span.badge',{text:r.emdNo}) ]));
    body.appendChild(el('div.form-grid', null, [
      kv('Passenger', r.passenger||'—'), kv('Ticket / PNR', r.ticketRef||'—'),
      kv('Service', r.serviceType), kv('Description', r.description||'—'),
      kv('Vendor', r.vendor||'—'), kv('Date', r.date?ui.date(r.date):'—'),
      kv('Cost', ui.money(r.cost||0)), kv('Sale', ui.money(r.sale||0)),
      kv('Profit', ui.money((r.sale||0)-(r.cost||0)))
    ]));
    var m = ui.modal({ title:'EMD '+r.emdNo, icon:'receipt', size:'lg', body:body,
      actions:[
        { label:'Close', variant:'ghost' },
        { label: (r.payStatus==='Paid'?'Mark Due':'Mark Paid'), variant:'outline', onClick:function(){
            r.payStatus = r.payStatus==='Paid' ? 'Due' : 'Paid'; db.save('air_emd', r);
            ui.toast('Payment status updated','success'); EPAL.router.render(); } },
        { label:'Print Receipt', variant:'primary', onClick:function(){ emdReceipt([r], r.emdNo, r.passenger, r.sale||0, r.cost||0); return true; } }
      ] });
    return m;
  }

  function newEmd(after) {
    var vendors = db.vendors();
    var vendorPairs = [['Direct Airline','Direct Airline']].concat(vendors.map(function(v){ return [v.name, v.name]; }));
    var svcPairs = EMD_SERVICES.map(function(s){ return [s.id, s.id]; });

    EPAL.formModal({
      title:'New EMD — Ancillary Services', icon:'receipt', size:'lg', saveLabel:'Issue EMD',
      fields:[
        { type:'section', label:'Booking' },
        { key:'passenger', label:'Passenger', type:'text', required:true },
        { key:'ticketRef', label:'Ticket No / PNR', type:'text' },
        { key:'vendor', label:'Vendor', type:'select', options:vendorPairs, default:'Direct Airline' },
        { key:'date', label:'Date', type:'date', default:today() },
        { key:'payStatus', label:'Payment', type:'select', options:['Paid','Due'], default:'Due' },
        { type:'section', label:'Ancillary Lines' },
        { key:'lines', type:'items', label:'Services (one EMD each)', required:true, min:1, addLabel:'Add service',
          columns:[
            { key:'serviceType', label:'Service', type:'select', options:svcPairs, width:'1.6fr' },
            { key:'description', label:'Description', type:'text', width:'2fr' },
            { key:'cost', label:'Cost', type:'money' },
            { key:'sale', label:'Sale', type:'money' }
          ],
          footer:function(rows){
            var c=0,s=0; rows.forEach(function(r){ c+=(+r.cost||0); s+=(+r.sale||0); });
            return 'Cost: <strong>'+ui.money(c)+'</strong> · Sale: <strong>'+ui.money(s)+'</strong> · Profit: <strong>'+ui.money(s-c)+'</strong>';
          }
        }
      ],
      onSave:function(v){
        var lines = (v.lines||[]).filter(function(l){ return l.serviceType && (+l.sale||0) > 0; });
        if (!lines.length) { ui.toast('Add at least one ancillary line with a sale amount','error'); return false; }
        if (!(v.passenger||'').trim()) { ui.toast('Passenger required','error'); return false; }

        var totalSale=0, totalCost=0, docRows=[], firstNo='';
        lines.forEach(function(l){
          var emdNo = EPAL.serial ? EPAL.serial.next('EMD') : String(Date.now());
          if (!firstNo) firstNo = emdNo;
          var cost = +l.cost||0, sale = +l.sale||0;
          var rec = {
            id: ui.uid('EMD'), emdNo:emdNo, date: v.date||today(),
            passenger:(v.passenger||'').trim(), ticketRef:(v.ticketRef||'').trim(),
            serviceType:l.serviceType, vendor:v.vendor||'Direct Airline',
            description:(l.description||'').trim() || emdDesc(l.serviceType),
            cost:cost, sale:sale, payStatus:v.payStatus||'Due', agent:'', created:Date.now()
          };
          db.save('air_emd', rec);
          totalSale += sale; totalCost += cost;
          docRows.push({ serviceType:l.serviceType, description:rec.description, cost:cost, sale:sale });
        });

        // one cross-company sale for the EMD total (Travels + Group finance + ledger)
        db.postSale('travels', { amount:totalSale, cost:totalCost, ref:firstNo,
          desc:'EMD ancillary · '+(v.passenger||'').trim(), customer:(v.passenger||'').trim() });

        db.notify({ level:'success', title:'EMD Issued', text:lines.length+' service'+(lines.length>1?'s':'')+' · '+ui.money(totalSale),
          companyId:'travels', icon:'receipt' });
        ui.toast('EMD issued · '+lines.length+' line'+(lines.length>1?'s':'')+' · profit '+ui.money(totalSale-totalCost),'success');

        emdReceipt(docRows, firstNo, (v.passenger||'').trim(), totalSale, totalCost);
        after && after();
        return true;
      }
    });
  }

  function emdMsg(r) {
    return 'EMD ' + r.emdNo + '\nPassenger: ' + r.passenger + '\nService: ' + (r.serviceType || '—') +
      '\nTicket/PNR: ' + (r.ticketRef || '—') + '\nAmount: ' + ui.money(r.sale || 0) + '\nPayment: ' + (r.payStatus || '—') +
      '\n\n— Epal Travels & Consultancy';
  }
  function emdReceipt(rows, emdNo, passenger, totalSale, totalCost) {
    if (!(EPAL.doc && EPAL.doc.open)) return;
    EPAL.doc.open({
      type:'receipt', title:'EMD — Ancillary Services Receipt', serial: emdNo,
      badge:'EMD', watermark:'ANCILLARY',
      parties:[
        { label:'Issuing Agent', lines:['Epal Travels & Consultancy','IATA Accredited Agent','Dhaka, Bangladesh'] },
        { label:'Passenger', lines:[ passenger, 'EMD '+emdNo ] }
      ],
      meta:[
        { label:'EMD No', value:emdNo }, { label:'Passenger', value:passenger },
        { label:'Issued', value: ui.date(today()) }
      ],
      columns:[
        { key:'serviceType', label:'Service' }, { key:'description', label:'Description' },
        { key:'cost', label:'Cost', money:true }, { key:'sale', label:'Amount', money:true }
      ],
      rows:rows,
      totals:[
        { label:'Total Cost', value:totalCost }, { label:'Grand Total', value:totalSale, grand:true }
      ],
      words: EPAL.doc.amountInWords ? EPAL.doc.amountInWords(totalSale) : '',
      terms:'Ancillary EMD services are subject to airline rules and are generally non-refundable once utilised.',
      sign:'For Epal Travels & Consultancy'
    });
  }

  /* ======================================================= TICKETING DEADLINES */
  function ttlView(page) {
    var rows = db.col('air_ttl');

    // KPIs
    var held = rows.filter(function(r){ return r.status==='Hold'; });
    var expiring24 = held.filter(function(r){ var h=hoursLeft(r.ttl); return h>=0 && h<24; }).length;
    var expired = rows.filter(function(r){ return r.status==='Expired' || (r.status==='Hold' && hoursLeft(r.ttl)<0); }).length;
    var heldValue = held.reduce(function(s,r){ return s+(r.amount||0); }, 0);
    page.appendChild(el('div.kpi-grid.stagger', null, [
      kpi('Held PNRs', held.length, 'hourglass-split'),
      kpi('Expiring < 24h', expiring24, 'alarm'),
      kpi('Expired', expired, 'x-octagon'),
      kpi('Held Value', ui.money(heldValue,{compact:true}), 'cash-stack')
    ]));

    // urgency buckets (Hold rows only)
    var red=0, amber=0, green=0;
    held.forEach(function(r){ var b=urgencyBucket(r); if(b==='red') red++; else if(b==='amber') amber++; else green++; });

    // queue-health banner
    var healthColor = red>0 ? '#f0506e' : amber>0 ? '#f4b740' : '#23c17e';
    var healthText = red>0 ? (red+' PNR'+(red>1?'s':'')+' need immediate ticketing (overdue or < 24h)')
      : amber>0 ? (amber+' PNR'+(amber>1?'s':'')+' due within 72 hours — plan ticketing')
      : 'Queue healthy — no imminent deadlines';
    page.appendChild(el('div.build-banner', { style:{ borderLeft:'3px solid '+healthColor } }, [
      ui.frag(ui.icon(red>0?'exclamation-triangle-fill':amber>0?'clock-history':'check2-circle')),
      el('div',{ html:'<strong>Queue health:</strong> '+healthText }) ]));

    // urgency doughnut
    if (held.length) {
      var cid = ui.uid('c');
      var row = el('div.two-col');
      row.appendChild(el('div', null, [
        el('div.card', null, [
          el('div.card-head', null, [ el('h3',{ html: ui.icon('pie-chart')+' Deadlines by Urgency' }) ]),
          el('div.card-body', null, [ el('div',{ style:{ height:'220px', position:'relative' } }, [ el('canvas',{ id:cid }) ]) ])
        ]) ]));
      row.appendChild(el('div', null, [
        el('div.card', null, [
          el('div.card-head', null, [ el('h3',{ html: ui.icon('list-check')+' Bucket Summary' }) ]),
          el('div.card-body', null, [ el('div.form-grid', null, [
            kv('Overdue / < 24h', red+' PNR'),
            kv('Due within 72h', amber+' PNR'),
            kv('Comfortable', green+' PNR'),
            kv('Total held value', ui.money(heldValue))
          ]) ]) ]) ]));
      page.appendChild(row);
      requestAnimationFrame(function(){
        var c = ui.$('#'+cid); if(!c || !EPAL.charts) return;
        EPAL.charts.doughnut(c, { labels:['Overdue / <24h','< 72h','Comfortable'],
          data:[red,amber,green], colors:['#f0506e','#f4b740','#23c17e'] });
      });
    }

    // sorted deadline board
    var order = { red:0, amber:1, green:2, done:3 };
    var sorted = rows.slice().sort(function(a,b){
      var ba=urgencyBucket(a), bb=urgencyBucket(b);
      if (order[ba]!==order[bb]) return order[ba]-order[bb];
      return hoursLeft(a.ttl) - hoursLeft(b.ttl);
    });

    var trs = sorted.map(function(r){
      var bucket = urgencyBucket(r);
      var cd = countdownLabel(r);
      var acts = el('div.flex.gap-1');
      if (r.status==='Hold') {
        acts.appendChild(el('button.btn.btn-sm.btn-primary',{ html:ui.icon('ticket-perforated')+' Ticket now',
          onclick:(function(rec){ return function(e){ e.stopPropagation(); ticketNow(rec); }; })(r) }));
        acts.appendChild(el('button.btn.btn-sm.btn-outline',{ html:ui.icon('clock')+' Extend',
          onclick:(function(rec){ return function(e){ e.stopPropagation(); extendTtl(rec); }; })(r) }));
      } else {
        acts.appendChild(el('span.text-mute',{ text:r.status }));
      }
      var actTd = el('td'); actTd.appendChild(acts);
      return el('tr', null, [
        td('<span class="mono strong">'+ui.escapeHtml(r.pnr)+'</span>'),
        td(ui.escapeHtml(r.passenger)),
        td(ui.escapeHtml(r.airline||'—')),
        td('<span class="mono">'+ui.escapeHtml(r.route||'—')+'</span>'),
        td('<span class="mono">'+ttlLabel(r.ttl)+'</span>'),
        td('<span class="mono" style="color:'+bucketColor(bucket)+'">'+cd+'</span>'),
        tdN(ui.money(r.amount||0)),
        td(ttlBadge(r.status).outerHTML),
        actTd
      ]);
    });
    page.appendChild(el('div.section-label',{text:'Deadline Queue — sorted by urgency'}));
    page.appendChild(tableCard(null,
      ['PNR','Passenger','Airline','Route','Deadline','Countdown','Value','Status',''], trs, 'No held PNRs in the queue.', { chipCol: 7 }));
  }

  function hoursLeft(ttl) {
    if (!ttl) return 1e9;
    var s = String(ttl);
    var d = new Date(s.indexOf('T') >= 0 ? s : s + 'T00:00:00');
    return (d - NOW) / 3600000;
  }
  function urgencyBucket(r) {
    if (r.status==='Ticketed') return 'done';
    if (r.status==='Expired') return 'red';
    var h = hoursLeft(r.ttl);
    if (h < 24) return 'red';
    if (h < 72) return 'amber';
    return 'green';
  }
  function bucketColor(b) { return b==='red' ? '#f0506e' : b==='amber' ? '#f4b740' : b==='done' ? '#8b93a7' : '#23c17e'; }
  function countdownLabel(r) {
    if (r.status==='Ticketed') return 'Ticketed';
    if (r.status==='Expired') return 'Expired';
    var h = hoursLeft(r.ttl);
    if (h < 0) { var od = Math.round(-h); return od < 48 ? 'Overdue '+od+'h' : 'Overdue '+Math.round(od/24)+'d'; }
    if (h < 48) return Math.round(h)+'h left';
    return Math.round(h/24)+'d left';
  }
  function ttlLabel(ttl) {
    var s = String(ttl||'');
    if (s.indexOf('T') >= 0) { var p = s.split('T'); return ui.date(p[0]) + ' ' + p[1]; }
    return ui.date(s);
  }
  function ttlBadge(s) { return el('span.badge'+(s==='Ticketed'?'.badge-good':s==='Expired'?'.badge-bad':'.badge-warn'),{text:s}); }

  function ticketNow(r) {
    ui.confirm({ title:'Ticket PNR '+r.pnr+'?', body:'Issue the held booking for '+r.passenger+' ('+ui.money(r.amount||0)+') and record the sale.',
      confirmLabel:'Ticket now' }).then(function(ok){
      if (!ok) return;
      r.status = 'Ticketed'; db.save('air_ttl', r);
      var cost = Math.round((r.amount||0) * 0.92);   // typical net fare vs. sold price
      db.postSale('travels', { amount:r.amount||0, cost:cost, ref:r.pnr,
        desc:'Ticketed held PNR '+r.pnr+' · '+(r.route||''), customer:r.passenger });
      db.notify({ level:'success', title:'PNR Ticketed', text:r.pnr+' · '+ui.money(r.amount||0), companyId:'travels', icon:'ticket-perforated-fill' });
      ui.toast('PNR '+r.pnr+' ticketed','success');
      EPAL.router.render();
    });
  }
  function extendTtl(r) {
    var body = el('div.form-grid', null, [
      sec('Extend ticketing deadline'),
      inp('New deadline','newTtl', (String(r.ttl||'').indexOf('T')>=0 ? String(r.ttl) : String(r.ttl||'')+'T00:00'), 'col-2', 'datetime-local')
    ]);
    var note = el('div.build-banner',{style:{marginTop:'6px'}},[ ui.frag(ui.icon('info-circle')),
      el('div',{ html:'Current deadline: <strong>'+ttlLabel(r.ttl)+'</strong> · '+countdownLabel(r) }) ]);
    body.appendChild(note);
    ui.modal({ title:'Extend '+r.pnr, icon:'clock', body:body,
      actions:[{ label:'Cancel', variant:'ghost' }, { label:'Extend', variant:'primary', onClick:function(box){
        var val = (box.querySelector('#f-newTtl')||{}).value;
        if (!val) { ui.toast('Pick a new deadline','error'); return false; }
        if (new Date(val) <= NOW) { ui.toast('New deadline must be in the future','error'); return false; }
        r.ttl = val;   // datetime-local 'YYYY-MM-DDTHH:MM'
        if (r.status==='Expired') r.status='Hold';
        db.save('air_ttl', r);
        db.notify({ level:'info', title:'Deadline Extended', text:r.pnr+' → '+ttlLabel(r.ttl), companyId:'travels', icon:'clock-history' });
        ui.toast('Deadline extended','success'); EPAL.router.render();
      }}] });
  }

  // EMD service helpers
  function svcMeta(t) { for (var i=0;i<EMD_SERVICES.length;i++){ if(EMD_SERVICES[i].id===t) return EMD_SERVICES[i]; } return { id:t, icon:'three-dots', color:'#8b93a7' }; }
  function svcColor(t) { return svcMeta(t).color; }
  function svcChip(t) {
    var m = svcMeta(t);
    return '<span class="badge" style="color:'+m.color+';background:'+m.color+'22"><i class="bi bi-'+m.icon+'"></i> '+ui.escapeHtml(t)+'</span>';
  }
  function svcBadgeEl(t) { var s=el('span'); s.innerHTML = svcChip(t); return s.firstChild; }

  /* ---------------------------------------------------- shared helpers */
  function kpi(label, value, icon, onClick, delta) {
    var top = [ el('span.kpi-label',{text:label}) ];
    if (delta) top.push(el('span', { title:'last 30 days vs prior 30', style:{ marginLeft:'auto', fontSize:'10.5px', fontWeight:'700', whiteSpace:'nowrap', color: delta.dir==='up'?'#23c17e':'#f0506e' }, html:(delta.dir==='up'?'▲ ':'▼ ')+delta.txt }));
    top.push(el('span.kpi-ico', { html:'<i class="bi bi-'+icon+'"></i>', style: delta?{ marginLeft:'8px' }:null }));
    return el('div.kpi-card' + (onClick ? '.drill' : ''), onClick ? { onclick: onClick } : null,
      [ el('div.kpi-top', null, top), el('div.kpi-value',{text:String(value)}) ]);
  }
  // Momentum: metric over the last 30 days vs the prior 30 (by ticket created date).
  function momentum(list, valFn){
    var now = new Date('2026-07-05').getTime(), d30 = now - 30*86400000, d60 = now - 60*86400000, cur = 0, prev = 0;
    list.forEach(function(x){ var t=new Date(x.created||x.purchaseDate||'').getTime(); if(isNaN(t)) return; var v=valFn?valFn(x):1;
      if(t>d30 && t<=now) cur+=v; else if(t>d60 && t<=d30) prev+=v; });
    if(prev<=0) return cur>0 ? { dir:'up', txt:'new' } : null;
    var pct = Math.round((cur-prev)/prev*100);
    return { dir: pct>=0?'up':'down', txt: Math.abs(pct)+'%' };
  }

  /* ---- KPI drill-downs: click a card on the overview for the full breakdown --*/
  function st2(l, v) { return el('div.stat', null, [ el('div.stat-label',{text:l}), el('div.stat-value',{text:String(v)}) ]); }
  function drow(k, v) { return el('div.data-row', null, [ el('div.text-mute.sm.flex-1', { text:k }), el('div.strong', { text: v==null||v===''?'—':String(v) }) ]); }
  function outstandingOf(x){ return (x.receivable && +x.receivable.amount) ? +x.receivable.amount : (x.sale||0); }
  function byAirlineStats(list){
    var m = {}; list.forEach(function(x){ var k=x.airlineCode||'—'; if(!m[k]) m[k]={ code:k, tickets:0, sale:0, cost:0, comm:0, profit:0 };
      var a=m[k]; a.tickets++; a.sale+=(x.sale||0); a.cost+=(x.cost||0); a.comm+=(x.commission||0); a.profit+=netProfitOf(x); });
    return Object.keys(m).map(function(k){ return m[k]; }).sort(function(a,b){ return b.sale-a.sale; });
  }
  function kpiShell(title, icon, stats){
    var body = el('div');
    ui.modal({ title:title, icon:icon, size:'lg', body:body, footer:false });
    if (stats && stats.length) body.appendChild(el('div.card.mb-2', null, [ el('div.card-body', null, [ el('div.stat-row', null, stats.map(function(s){ return st2(s[0], s[1]); })) ]) ]));
    return body;
  }
  function ticketsTable(list){
    return EPAL.table({
      columns:[
        { key:'id', label:'Ticket', render:function(x){ return '<span class="mono xs text-mute">'+ui.escapeHtml(x.id||'')+'</span>'; } },
        { key:'passenger', label:'Passenger', render:function(x){ return '<span class="strong">'+ui.escapeHtml(x.passenger||'—')+'</span>'; } },
        { key:'route', label:'Route' }, { key:'airlineCode', label:'Airline', badge:{} },
        { key:'sale', label:'Sale', num:true, money:true },
        { key:'profit', label:'Net Profit', num:true, sortVal:function(x){ return netProfitOf(x); }, render:function(x){ var p=netProfitOf(x); return '<span class="num '+(p>=0?'text-good':'text-bad')+'">'+ui.money(p)+'</span>'; } },
        { key:'status', label:'Status', render:function(x){ return statusBadge(x.status).outerHTML; }, sortVal:function(x){ return x.status; } }
      ],
      rows:list, searchKeys:['id','passenger','route','airlineCode'], quickFilter:'status', filterPanel:true, pageSize:8,
      exportName:'air-tickets.csv', pdfTitle:'Air Tickets', onRow:function(x){ ticketDetail(x, function(){}); },
      empty:{ icon:'ticket-perforated', title:'No tickets here' }
    }).el;
  }
  function airlineStatsTable(list){
    var rby = refundByCode();
    return EPAL.table({
      columns:[
        { key:'code', label:'Airline', render:function(r){ return '<span class="strong">'+ui.escapeHtml(r.code)+'</span>'; } },
        { key:'tickets', label:'Tickets', num:true },
        { key:'sale', label:'Sales', num:true, money:true }, { key:'cost', label:'Cost', num:true, money:true },
        { key:'profit', label:'Net Profit', num:true, sortVal:function(r){ return r.profit; }, render:function(r){ return '<span class="num '+(r.profit>=0?'text-good':'text-bad')+'">'+ui.money(r.profit)+'</span>'; } },
        { key:'margin', label:'Margin', num:true, sortVal:function(r){ return r.sale? r.profit/r.sale*100 : 0; }, render:function(r){ var m=r.sale?Math.round(r.profit/r.sale*100):0; return '<span class="num '+(m>=0?'':'text-bad')+'">'+m+'%</span>'; } },
        { key:'refunds', label:'Refund %', num:true, sortVal:function(r){ return r.tickets? (rby[r.code]||0)/r.tickets*100 : 0; }, render:function(r){ var n=rby[r.code]||0, pct=r.tickets?Math.round(n/r.tickets*100):0; return n? '<span class="num '+(pct>=25?'text-bad':pct>=10?'text-warn':'')+'">'+pct+'% ('+n+')</span>' : '<span class="text-mute">—</span>'; } }
      ],
      rows:byAirlineStats(list), pageSize:12, exportName:'air-by-airline.csv', pdfTitle:'By Airline', empty:{ icon:'airplane', title:'No data' }
    }).el;
  }
  function airlineChart(body, list, key, title){
    var cid = ui.uid('kpc');
    body.appendChild(el('div.card.mb-2', null, [ el('div.card-head', null, [ el('h3',{ html: ui.icon('bar-chart')+' '+title }) ]),
      el('div.card-body', null, [ el('div',{ style:{ height:'240px', position:'relative' } }, [ el('canvas',{ id:cid }) ]) ]) ]));
    requestAnimationFrame(function(){ var c=document.getElementById(cid); if(!c) return;
      var rows = byAirlineStats(list).slice().sort(function(a,b){ return b[key]-a[key]; }).slice(0,8);
      EPAL.charts.bar(c, { labels:rows.map(function(r){ return r.code; }), horizontal:true, money:true,
        datasets:[{ label:title, data:rows.map(function(r){ return r[key]; }), colors: key==='profit' ? rows.map(function(r){ return r.profit>=0?'#23c17e':'#f0506e'; }) : null }] }); });
  }
  // one builder per KPI card
  function kpiTickets(t){
    var byStatus={}; t.forEach(function(x){ byStatus[x.status||'—']=(byStatus[x.status||'—']||0)+1; });
    var stats = STATUSES.filter(function(s){ return byStatus[s.id]; }).map(function(s){ return [s.id, byStatus[s.id]]; });
    if(!stats.length) stats=[['Tickets', t.length]];
    var body = kpiShell('Tickets Sold — '+t.length, 'ticket-perforated', stats);
    body.appendChild(el('div.section-label',{text:'By Airline'}));
    body.appendChild(el('div.card.mb-2',null,[ el('div.card-body',null,[ airlineStatsTable(t) ]) ]));
    body.appendChild(el('div.section-label',{text:'All Tickets'}));
    body.appendChild(el('div.card',null,[ el('div.card-body',null,[ ticketsTable(t) ]) ]));
  }
  function kpiList(title, icon, list, stats){
    var body = kpiShell(title, icon, stats);
    body.appendChild(el('div.card',null,[ el('div.card-body',null,[ ticketsTable(list) ]) ]));
  }
  function kpiSales(t){
    var total=t.reduce(function(s,x){ return s+(x.sale||0); },0), avg=t.length?Math.round(total/t.length):0;
    var body = kpiShell('Sales Value — '+ui.money(total), 'cash-coin', [['Total sales', ui.money(total)], ['Tickets', t.length], ['Avg / ticket', ui.money(avg)]]);
    airlineChart(body, t, 'sale', 'Sales by Airline');
    body.appendChild(el('div.card',null,[ el('div.card-body',null,[ airlineStatsTable(t) ]) ]));
  }
  function kpiProfit(t){
    var revenue=t.reduce(function(s,x){ return s+(x.sale||0); },0), cost=t.reduce(function(s,x){ return s+(x.cost||0); },0);
    var comm=t.reduce(function(s,x){ return s+(x.commission||0); },0), net=t.reduce(function(s,x){ return s+netProfitOf(x); },0);
    var body = kpiShell('Net Profit — '+ui.money(net), 'graph-up-arrow', [['Sales', ui.money(revenue)], ['Cost', ui.money(cost)], ['Gross', ui.money(revenue-cost)], ['Commission', ui.money(comm)], ['Net', ui.money(net)]]);
    // profit waterfall: Sales → − Cost → − Commission → Net (floating bars)
    var gross = revenue - cost, wid = ui.uid('wf');
    body.appendChild(el('div.card.mb-2', null, [ el('div.card-head', null, [ el('h3',{ html: ui.icon('bar-chart-steps')+' Profit Waterfall' }), el('span.card-sub',{ text:'sales → cost → commission → net' }) ]),
      el('div.card-body', null, [ el('div',{ style:{ height:'240px', position:'relative' } }, [ el('canvas',{ id:wid }) ]) ]) ]));
    requestAnimationFrame(function(){ var c=document.getElementById(wid); if(!c) return;
      EPAL.charts.bar(c, { labels:['Sales','− Cost','− Commission','Net Profit'],
        datasets:[{ label:'৳', data:[[0,revenue],[gross,revenue],[net,gross],[0,net]], colors:['#2f6bff','#f0506e','#f4b740','#23c17e'] }] }); });
    airlineChart(body, t, 'profit', 'Net Profit by Airline');
    body.appendChild(el('div.card',null,[ el('div.card-body',null,[ airlineStatsTable(t) ]) ]));
  }
  function kpiMargin(t){
    var revenue=t.reduce(function(s,x){ return s+(x.sale||0); },0), net=t.reduce(function(s,x){ return s+netProfitOf(x); },0);
    var withSale = byAirlineStats(t).filter(function(r){ return r.sale; });
    var best=withSale.slice().sort(function(a,b){ return (b.profit/b.sale)-(a.profit/a.sale); })[0];
    var worst=withSale.slice().sort(function(a,b){ return (a.profit/a.sale)-(b.profit/b.sale); })[0];
    var body = kpiShell('Average Margin — '+(revenue?Math.round(net/revenue*100):0)+'%', 'percent', [
      ['Overall', (revenue?Math.round(net/revenue*100):0)+'%'],
      ['Best airline', best? best.code+' · '+Math.round(best.profit/best.sale*100)+'%':'—'],
      ['Weakest', worst? worst.code+' · '+Math.round(worst.profit/worst.sale*100)+'%':'—']
    ]);
    body.appendChild(el('div.section-label',{text:'Margin by Airline'}));
    body.appendChild(el('div.card',null,[ el('div.card-body',null,[ airlineStatsTable(t) ]) ]));
  }

  /* ---- ROUTE NETWORK MAP — a live, geo-projected arc map of the sectors we fly.
     Airport nodes sit at real (equirectangular) coordinates; arcs bow between them
     with a bright flight-dot tracking each one and a pulse on the Dhaka hub. Arc
     thickness ∝ ticket volume. Click any sector (arc or table row) for its stats. */
  var AIRPORTS = {
    DAC:[23.84,90.40], CGP:[22.25,91.81], ZYL:[24.96,91.87], CXB:[21.45,91.96],
    DXB:[25.25,55.36], DOH:[25.27,51.61], AUH:[24.43,54.65], JED:[21.68,39.16],
    MED:[24.55,39.70], RUH:[24.96,46.70], MCT:[23.59,58.28], KUL:[2.75,101.71],
    SIN:[1.36,103.99], BKK:[13.69,100.75], IST:[41.26,28.74], LHR:[51.47,-0.46],
    CCU:[22.65,88.45], DEL:[28.56,77.10], KTM:[27.70,85.36], JFK:[40.64,-73.78]
  };
  var MAP_W = 1000, MAP_H = 430, LNG0 = -18, LNG1 = 116, LAT0 = -6, LAT1 = 56;
  function proj(iata){ var c = AIRPORTS[iata]; if(!c) return null;
    return [ (c[1]-LNG0)/(LNG1-LNG0)*MAP_W, (LAT1-c[0])/(LAT1-LAT0)*MAP_H ]; }
  function arcPath(a, b){
    var mx=(a[0]+b[0])/2, my=(a[1]+b[1])/2, dx=b[0]-a[0], dy=b[1]-a[1], d=Math.hypot(dx,dy)||1;
    var nx=-dy/d, ny=dx/d, k=Math.min(0.32, 40/d+0.14);
    var cx=mx+nx*d*k, cy=my+ny*d*k; if(cy>my){ cx=mx-nx*d*k; cy=my-ny*d*k; }   // bow upward
    return 'M'+r1(a[0])+' '+r1(a[1])+' Q '+r1(cx)+' '+r1(cy)+' '+r1(b[0])+' '+r1(b[1]);
  }
  function r1(n){ return Math.round(n*10)/10; }
  function parseRoute(s){ var m = String(s||'').split(/→|-&gt;|->|—|-/).map(function(x){ return x.trim().toUpperCase(); }).filter(Boolean);
    if(m.length<2) return null; var o=m[0], d=m[m.length-1];
    return (/^[A-Z]{3}$/.test(o) && /^[A-Z]{3}$/.test(d)) ? [o,d] : null; }
  function apCity(iata){ var a=(db.airports?db.airports():[]).filter(function(x){ return x.iata===iata; })[0]; return a ? a.city : iata; }

  function routeNetwork(page, t){
    var routes = {}, traffic = {};
    t.forEach(function(x){ var pr=parseRoute(x.route); if(!pr) return; var key=pr[0]+'-'+pr[1];
      if(!routes[key]) routes[key]={ o:pr[0], d:pr[1], key:key, tickets:0, sale:0, profit:0 };
      var r=routes[key]; r.tickets++; r.sale+=(x.sale||0); r.profit+=netProfitOf(x);
      traffic[pr[0]]=(traffic[pr[0]]||0)+1; traffic[pr[1]]=(traffic[pr[1]]||0)+1; });
    var list = Object.keys(routes).map(function(k){ return routes[k]; })
      .filter(function(r){ return proj(r.o) && proj(r.d); }).sort(function(a,b){ return b.tickets-a.tickets; });
    if(!list.length) return;
    var top = list.slice(0, 14), maxT = top[0].tickets || 1;

    // grid
    var svg = '<svg viewBox="0 0 '+MAP_W+' '+MAP_H+'" preserveAspectRatio="xMidYMid meet" aria-hidden="true" style="width:100%;height:auto;display:block">';
    var g = '';
    for (var gx=0; gx<=MAP_W; gx+=50) g += '<line x1="'+gx+'" y1="0" x2="'+gx+'" y2="'+MAP_H+'" stroke="currentColor" stroke-width="0.5" opacity="0.05"/>';
    for (var gy=0; gy<=MAP_H; gy+=50) g += '<line x1="0" y1="'+gy+'" x2="'+MAP_W+'" y2="'+gy+'" stroke="currentColor" stroke-width="0.5" opacity="0.05"/>';
    svg += g;
    // arcs + flight dots + wide transparent hit paths
    top.forEach(function(r, i){ var a=proj(r.o), b=proj(r.d), path=arcPath(a,b);
      var w=1.1 + (r.tickets/maxT)*4.6, op=0.30 + 0.5*(r.tickets/maxT), dur=(6.5 + i*0.55).toFixed(1);
      svg += '<path id="arc-'+i+'" d="'+path+'" fill="none" stroke="#2f6bff" stroke-opacity="'+op.toFixed(2)+'" stroke-width="'+w.toFixed(1)+'" stroke-linecap="round"/>'
        + '<circle r="'+(1.8 + (r.tickets/maxT)*2.4).toFixed(1)+'" fill="#8fd4ff"><animateMotion dur="'+dur+'s" repeatCount="indefinite" rotate="auto"><mpath href="#arc-'+i+'"/></animateMotion></circle>'
        + '<path class="route-hit" data-idx="'+i+'" d="'+path+'" fill="none" stroke="transparent" stroke-width="16" style="cursor:pointer"/>';
    });
    // nodes + labels
    Object.keys(traffic).forEach(function(k){ var p=proj(k); if(!p) return; var rad=3 + Math.sqrt(traffic[k])*1.5; var hub = (k==='DAC');
      if (hub) svg += '<circle cx="'+r1(p[0])+'" cy="'+r1(p[1])+'" r="'+(rad+4)+'" fill="#2f6bff" opacity="0.22">'
        + '<animate attributeName="r" values="'+(rad+3)+';'+(rad+13)+';'+(rad+3)+'" dur="3s" repeatCount="indefinite"/>'
        + '<animate attributeName="opacity" values="0.28;0;0.28" dur="3s" repeatCount="indefinite"/></circle>';
      svg += '<circle cx="'+r1(p[0])+'" cy="'+r1(p[1])+'" r="'+rad.toFixed(1)+'" fill="'+(hub?'#1A43BF':'#2f6bff')+'" stroke="#ffffff" stroke-width="1" stroke-opacity="0.45"/>';
      var right = p[0] > MAP_W-90;
      svg += '<text x="'+r1(p[0] + (right?-7:7))+'" y="'+r1(p[1]-7)+'" font-size="12.5" font-weight="700" fill="currentColor" opacity="0.8" text-anchor="'+(right?'end':'start')+'">'+k+'</text>';
    });
    svg += '</svg>';

    page.appendChild(el('div.section-label', { html: ui.icon('globe-americas') + ' Route Network' }));
    var mapCard = el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon('globe-americas') + ' Sectors We Fly' }),
        el('span.card-sub', { text: list.length + ' sectors · click any route for details' }) ]),
      el('div.card-body', null, [ el('div.route-map', { style:{ color:'var(--text-mute)', position:'relative' }, html: svg }) ])
    ]);
    page.appendChild(mapCard);
    var svgEl = mapCard.querySelector('.route-map svg');
    if (svgEl) Array.prototype.forEach.call(svgEl.querySelectorAll('.route-hit'), function(hit){
      hit.addEventListener('click', function(){ routeModal(top[+hit.getAttribute('data-idx')], t); }); });

    // Top Routes league table
    var tbl = EPAL.table({
      columns:[
        { key:'sector', label:'Sector', render:function(r){ return '<span class="mono strong">'+r.o+' → '+r.d+'</span>'; }, sortVal:function(r){ return r.key; } },
        { key:'cities', label:'Route', render:function(r){ return ui.escapeHtml(apCity(r.o)+' → '+apCity(r.d)); }, sortVal:function(r){ return apCity(r.o); } },
        { key:'tickets', label:'Tickets', num:true },
        { key:'sale', label:'Sales', num:true, money:true },
        { key:'profit', label:'Net Profit', num:true, sortVal:function(r){ return r.profit; }, render:function(r){ return '<span class="num '+(r.profit>=0?'text-good':'text-bad')+'">'+ui.money(r.profit)+'</span>'; } },
        { key:'avg', label:'Avg Fare', num:true, sortVal:function(r){ return r.tickets? r.sale/r.tickets : 0; }, render:function(r){ return '<span class="num">'+ui.money(Math.round(r.tickets? r.sale/r.tickets : 0))+'</span>'; } }
      ],
      rows:list, searchKeys:['o','d'], pageSize:8, exportName:'air-routes.csv', pdfTitle:'Route Performance',
      onRow:function(r){ routeModal(r, t); }, empty:{ icon:'globe', title:'No routes yet' }
    });
    page.appendChild(el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon('signpost-split') + ' Top Routes' }), el('span.card-sub', { text:'by ticket volume' }) ]),
      el('div.card-body', null, [ tbl.el ]) ]));
  }

  function routeModal(r, allT){
    var onRoute = allT.filter(function(x){ var pr=parseRoute(x.route); return pr && pr[0]===r.o && pr[1]===r.d; });
    var avg = r.tickets ? Math.round(r.sale/r.tickets) : 0;
    var body = kpiShell(r.o+' → '+r.d+'  ·  '+apCity(r.o)+' → '+apCity(r.d), 'globe-americas',
      [['Tickets', r.tickets], ['Sales', ui.money(r.sale)], ['Net Profit', ui.money(r.profit)], ['Avg Fare', ui.money(avg)]]);
    body.appendChild(el('div.section-label',{ text:'Airlines on this sector' }));
    body.appendChild(el('div.card.mb-2', null, [ el('div.card-body', null, [ airlineStatsTable(onRoute) ]) ]));
    body.appendChild(el('div.section-label',{ text:'Tickets on this sector' }));
    body.appendChild(el('div.card', null, [ el('div.card-body', null, [ ticketsTable(onRoute) ]) ]));
  }

  /* ---- AIRLINE LEAGUE — a ranked carrier table with medals, IATA "logo" chips
     and a volume bar; click a carrier for its tickets & stats. */
  function airlineName(code){ var a=(airlines()||[]).filter(function(x){ return x.iata===code; })[0]; return a? a.name : code; }
  function airlineLeague(page, t){
    var rows = byAirlineStats(t).slice(0, 10);
    if(!rows.length) return;
    var maxSale = rows[0].sale || 1, medals = ['#f4c542','#c9ccd3','#cd7f32'];
    var list = el('div');
    rows.forEach(function(r, i){
      var margin = r.sale ? Math.round(r.profit/r.sale*100) : 0, barW = Math.max(4, Math.round(r.sale/maxSale*100));
      var rank = i<3
        ? '<span style="display:inline-grid;place-items:center;width:22px;height:22px;border-radius:50%;background:'+medals[i]+';color:#1b2438;font-weight:800;font-size:11px">'+(i+1)+'</span>'
        : '<span class="text-mute" style="width:22px;display:inline-block;text-align:center">'+(i+1)+'</span>';
      var chip = '<span class="mono" style="display:inline-grid;place-items:center;min-width:34px;height:24px;padding:0 6px;border-radius:7px;background:'+ui.colorFor(r.code)+';color:#fff;font-weight:700;font-size:11px">'+r.code+'</span>';
      list.appendChild(el('div.data-row', { style:{ cursor:'pointer' }, onclick:(function(rr){ return function(){
          kpiList(airlineName(rr.code)+' · '+rr.code, 'airplane', t.filter(function(x){ return x.airlineCode===rr.code; }),
            [['Tickets', rr.tickets], ['Sales', ui.money(rr.sale)], ['Net Profit', ui.money(rr.profit)], ['Margin', (rr.sale?Math.round(rr.profit/rr.sale*100):0)+'%']]);
        }; })(r) }, [
        ui.frag(rank), ui.frag(chip),
        el('div.flex-1', { style:{ minWidth:'120px' } }, [ el('div.strong',{ text: airlineName(r.code) }),
          el('div', { style:{ height:'6px', borderRadius:'6px', background:'var(--surface-3,#2a3350)', overflow:'hidden', marginTop:'5px', maxWidth:'240px' } },
            [ el('div', { style:{ height:'100%', width:barW+'%', background:'#2f6bff' } }) ]) ]),
        el('div', { style:{ textAlign:'right', minWidth:'150px' } }, [ el('div.num.strong',{ text: ui.money(r.sale,{compact:true}) }),
          el('div.num.xs' + (r.profit>=0?'.text-good':'.text-bad'), { text: ui.money(r.profit,{compact:true})+' · '+margin+'%' }) ])
      ]));
    });
    page.appendChild(el('div.section-label',{ html: ui.icon('trophy') + ' Airline League' }));
    page.appendChild(el('div.card', null, [ el('div.card-body', null, [ list ]) ]));
  }

  /* ---- DEMAND & PIPELINE — Forward Bookings (departures ahead) + Status Mix
     (pipeline health), shown side-by-side. Status chips open that status's list. */
  function mLabelYM(ym){ var p=String(ym).split('-'); if(p.length<2) return ym; return new Date(p[0], p[1]-1, 1).toLocaleString('en',{ month:'short' }); }
  function fwdCard(t){
    var byMonth={}; t.forEach(function(x){ var m=String(x.travelDate||'').slice(0,7); if(!m) return; byMonth[m]=(byMonth[m]||0)+1; });
    var months=Object.keys(byMonth).sort(); if(months.length<2) return null;
    var cid=ui.uid('fwd');
    var card = el('div.card', null, [ el('div.card-head', null, [ el('h3',{ html: ui.icon('calendar3')+' Forward Bookings' }), el('span.card-sub',{ text:'departures ahead' }) ]),
      el('div.card-body', null, [ el('div',{ style:{ height:'220px', position:'relative' } }, [ el('canvas',{ id:cid }) ]) ]) ]);
    requestAnimationFrame(function(){ var c=document.getElementById(cid); if(!c) return;
      EPAL.charts.bar(c, { labels:months.map(mLabelYM), money:false, datasets:[{ label:'Departures', data:months.map(function(m){ return byMonth[m]; }), color:'#1A43BF' }] }); });
    return card;
  }
  function statusCard(t){
    var by={}; t.forEach(function(x){ by[x.status||'—']=(by[x.status||'—']||0)+1; });
    var labels=STATUSES.map(function(s){ return s.id; }).filter(function(s){ return by[s]; }); if(labels.length<2) return null;
    var colors=labels.map(function(s){ var m=STATUSES.filter(function(x){ return x.id===s; })[0]; return m? m.color : '#8b93a7'; });
    var cid=ui.uid('sm'), chips=el('div.flex.gap-1.flex-wrap.mt-2');
    labels.forEach(function(s){ var m=STATUSES.filter(function(x){ return x.id===s; })[0]||{};
      chips.appendChild(el('button.badge', { style:{ cursor:'pointer', background:(m.color||'#888')+'22', color:m.color||'#888', border:'0' },
        onclick:(function(st, mm){ return function(){ kpiList(st+' tickets', mm.icon||'ticket-perforated', t.filter(function(x){ return x.status===st; }), [['Count', by[st]]]); }; })(s, m) },
        [ ui.frag((m.icon? ui.icon(m.icon)+' ':'')+s+' · '+by[s]) ])); });
    var card = el('div.card', null, [ el('div.card-head', null, [ el('h3',{ html: ui.icon('pie-chart-fill')+' Ticket Status Mix' }), el('span.card-sub',{ text:'pipeline health' }) ]),
      el('div.card-body', null, [ el('div',{ style:{ height:'220px', position:'relative' } }, [ el('canvas',{ id:cid }) ]), chips ]) ]);
    requestAnimationFrame(function(){ var c=document.getElementById(cid); if(!c) return;
      EPAL.charts.doughnut(c, { labels:labels, data:labels.map(function(s){ return by[s]; }), colors:colors }); });
    return card;
  }
  function demandRow(page, t){
    var host=el('div.grid-auto'), f=fwdCard(t), s=statusCard(t);
    if(f) host.appendChild(f); if(s) host.appendChild(s);
    if(host.children.length){ page.appendChild(el('div.section-label',{ html: ui.icon('activity')+' Demand & Pipeline' })); page.appendChild(host); }
  }

  /* ---- BSP SETTLEMENT COUNTDOWN — next BSP billing settlement, open ADM
     dispute deadlines (raised + 30d) and recoverable unused-ticket value. */
  function ymd(y,m,d){ return y+'-'+String(m+1).padStart(2,'0')+'-'+String(d).padStart(2,'0'); }
  function daysToDate(str){ var a=new Date(str).getTime(), b=new Date('2026-07-05').getTime(); return Math.round((a-b)/86400000); }
  function addDaysStr(str,n){ var d=new Date(str); d.setDate(d.getDate()+n); return d.toISOString().slice(0,10); }
  function nextBspSettlement(){ var t=new Date('2026-07-05'), y=t.getFullYear(), m=t.getMonth(), d=t.getDate();
    if(d<15) return ymd(y,m,15); var eom=new Date(y,m+1,0).getDate(); if(d<eom) return ymd(y,m,eom); return ymd(y,m+1,15); }
  function bspTile(label, value, sub, tone){
    return el('div.kpi-card', null, [ el('div.kpi-top', null, [ el('span.kpi-label',{text:label}) ]),
      el('div.kpi-value' + (tone?'.'+tone:''), { text:String(value) }), sub? el('div.kpi-foot',null,[ el('span.text-muted',{text:sub}) ]) : null ]);
  }
  function bspCountdown(page){
    var bsp = db.airBsp ? db.airBsp() : { adms:[], unused:[] };
    var next = nextBspSettlement(), dTo = daysToDate(next);
    var openAdms = (bsp.adms||[]).filter(function(x){ return x.status!=='Settled'; });
    var admTotal = openAdms.reduce(function(s,x){ return s+(x.amount||0); }, 0);
    var soonest = openAdms.map(function(x){ return { x:x, due:addDaysStr(x.date, 30) }; }).sort(function(a,b){ return new Date(a.due)-new Date(b.due); })[0];
    var admSub = soonest ? ('soonest dispute in '+daysToDate(soonest.due)+'d') : 'no open ADMs';
    var unusedVal = (bsp.unused||[]).reduce(function(s,x){ return s+(x.value||0); }, 0);
    page.appendChild(el('div.section-label',{ html: ui.icon('shield-check')+' BSP Settlement & ADM Watch' }));
    var grid = el('div.kpi-grid.kpi-compact', { style:{ cursor:'pointer' }, onclick:function(){ EPAL.router.navigate('travels/air-ticketing/bsp'); } }, [
      bspTile('Next BSP Settlement', dTo+' days', ui.date(next), dTo<=3?'text-warn':''),
      bspTile('Open ADMs', String(openAdms.length), ui.money(admTotal)+' · '+admSub, openAdms.length?'text-bad':'text-good'),
      bspTile('Unused Recoverable', ui.money(unusedVal,{compact:true}), 'file back / reissue', unusedVal?'text-warn':'')
    ]);
    page.appendChild(grid);
  }

  /* ---- refund counts per airline (refunds carry the airline NAME) ----------*/
  function refundByCode(){
    var als=airlines()||[], nameToCode={}; als.forEach(function(a){ nameToCode[a.name]=a.iata; nameToCode[a.iata]=a.iata; });
    var by={}; (db.airRefunds?db.airRefunds():[]).forEach(function(r){ var code=nameToCode[r.airline]||r.airline; by[code]=(by[code]||0)+1; });
    return by;
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
    function cells(tr) { return [].map.call(tr.children, function (td) { return (td.textContent || '').trim(); }); }
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
