/* ============================================================================
 * EPAL GROUP ERP  ·  assets/js/data/database.js
 * ----------------------------------------------------------------------------
 * WHAT: The domain data layer — a browser-only mock "database" (localStorage
 *   via state.js) that behaves like a real backend. It SEEDS once with
 *   realistic, self-consistent, deterministic data across ALL companies;
 *   exposes query + aggregation helpers (the "intelligence"); and every
 *   mutation EMITS an event on EPAL.bus so dashboards and sister companies
 *   update live. Swap this file for real API calls and the rest of the app is
 *   unchanged. It also delegates to seed-bd.js (deep per-company data) and the
 *   engine registry (ledger/audit/approvals…) during seed().
 *
 * DATA IT OWNS (localStorage stores; all namespaced by state.js):
 *   financials     [{companyId, ym:'YYYY-MM', revenue:int, expense:int}]  12 mo x company
 *   employees      [{id, name, companyId, dept, designation, role:enum(owner|manager|
 *                    accountant|employee), email, phone, joinDate, salary, status:enum(
 *                    active|on-leave), attendance:{present,absent,late,leave}, rating}]
 *   customers      [{id, name, companyIds:[], contact, phone, email, value, since,
 *                    tier:enum(Standard|Silver|Gold|Platinum), status}]  <- shared graph
 *   leads          [{id, companyId, name, source, stage:enum(New|Contacted|Qualified|
 *                    Proposal|Negotiation|Won|Lost), value, owner, created}]
 *   sales          [{id, companyId, date, amount, cost, profit, ref, desc, customer}]
 *                    <- the group-wide sales ledger; postSale() appends here
 *   tasks.<empId>  [{id, title, desc, status:enum(todo|inprogress|review|done|cancelled),
 *                    priority, due, labels[], restricted, redFlag, comments[],
 *                    phases:[{id,name,pct,accumMs,running,startedAt,done}]}]  per-employee board
 *   visaCats       [{id, country, flag, type, cost, sale, days, status}]
 *   visaApps       [{id, applicant, phone, passport, country, visaType, catId, cost, sale,
 *                    stage:enum(New|Documents|Submitted|Under Process|Approved|Rejected),
 *                    travelDate, agent, payStatus}]   (Travels exemplar)
 *   airlines       [{id, name, iata, country, status}]        Air Ticketing master
 *   airports       [{id, name, iata, city, country}]          Air Ticketing master
 *   airTickets     [{id, pnr, ticketNo, passenger, fromCode, toCode, route, tripType,
 *                    airlineCode, airline, flightNo, vendor, portal, cost, sale, costPaid,
 *                    payStatus, agent, status:enum(Issued|Confirmed|Hold|Re-issued|Void|
 *                    Refunded), timeline[]}]
 *   airRefunds     [{id, pnr, passenger, airline, gross, airlineRefund, penalty, fee,
 *                    netRefund, method, status}]
 *   airBsp         {txns[], adms[], unused[], api{}}           BSP/ADM recon (single object)
 *   vendors        [{id, name, type, balance, creditLimit, terms}]
 *   notifications  [{id, level:enum(info|success|warning|error), title, text, companyId,
 *                    at:ms, read, icon}]
 *   activity       [{id, at:ms, actor, text, companyId}]       lightweight activity feed
 *
 * BUSINESS RULES (the "why" a developer must preserve):
 *   - Deterministic seed: a fixed-seed PRNG (mulberry32) makes demo data stable
 *     across reloads — same data every boot, so screenshots/tests are reproducible.
 *   - Idempotent: every store goes through seedOnce; reseeding never overwrites.
 *   - postSale() is THE cross-company artery: it appends to `sales`, ROLLS the
 *     amount into that company's CURRENT-month financials row (so company +
 *     group finance both move), and emits `sale:recorded` (which the ledger
 *     engine listens to and auto-posts a balanced double-entry against).
 *   - Seeded `sales` rows are ALREADY reflected inside seeded `financials`, so
 *     they must NOT re-roll into financials (only runtime postSale does that) —
 *     else demo revenue would be double-counted.
 *   - Every mutation emits `data:changed` (and often a specific event) so the
 *     event bus keeps the whole group in sync; audit/intel engines subscribe.
 *   - financials revenue/expense are MONTHLY summaries; margin/risk/MoM are
 *     derived, never stored.
 *
 * PUBLIC API (window.EPAL.db):
 *   seed() / reset()                       — idempotent seed all stores / nuke+reseed
 *   financials()/employees(f)/employee(id)/customers(cid)/leads(cid)/visaCats()/
 *   visaApps()/vendors()/airlines()/airports()/airTickets()/airRefunds()/airBsp()/
 *   notifications()/activity()/tasksFor(empId)/sales(cid)  — collection reads
 *   col(name)/save(name,rec)/remove(name,id)               — generic CRUD (emits events)
 *   finance(cid,months)->{revenue,expense,profit,margin}   — summed finances
 *   series(cid)->{labels,revenue,expense,profit}           — 12-mo chart series
 *   momRevenue(cid)/riskScore(cid)                         — derived KPIs
 *   groupSnapshot()                                        — everything the Command Center needs
 *   postSale(cid,sale)->rec                                — record a sale + fan out
 *   saveTask/deleteTask/saveVisaApp/saveAirTicket/saveAirline/saveAirport/
 *   saveAirRefund/saveEmployee/saveCustomer/saveVisaCat    — typed mutations (emit events)
 *   notify(n)/markNotificationsRead()/log(actor,text,cid)  — notifications + activity feed
 *
 * ==> LARAVEL / PHP MAPPING: Each store becomes an Eloquent Model + migration
 *     (Financial, Employee, Customer, Lead, Sale, Task, VisaApplication,
 *     Airline, Airport, AirTicket, ...) with the columns/enums above; the
 *     seed*() functions become DatabaseSeeder classes (deterministic faker).
 *     The read helpers are Eloquent scopes/queries; finance/series/groupSnapshot
 *     are a ReportingService (SQL GROUP BY month/company). postSale() is a
 *     SalesService::record() in a DB transaction that also dispatches a
 *     `SaleRecorded` event -> a listener posts the ledger journal (see
 *     ledger.js). The bus emits map to Laravel Events/Observers. This file +
 *     state.js are the ONLY two you rewrite to attach a real backend.
 * ==========================================================================*/

(function (EPAL) {
  'use strict';

  var S = EPAL.store, bus = EPAL.bus;

  /* --- deterministic PRNG so seeded demo data is stable across reloads ----*/
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  var rnd = mulberry32(20260702);                 // fixed seed = reproducible
  function ri(min, max) { return Math.floor(rnd() * (max - min + 1)) + min; }
  function pick(arr) { return arr[Math.floor(rnd() * arr.length)]; }

  /* month keys for the last N months, oldest→newest, as 'YYYY-MM' ----------*/
  function lastMonths(n) {
    var out = [], d = new Date(2026, 5, 1); // anchor Jun-2026 (demo "now")
    for (var i = n - 1; i >= 0; i--) {
      var dt = new Date(d.getFullYear(), d.getMonth() - i, 1);
      out.push(dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0'));
    }
    return out;
  }

  // AUTO-DISCOVERY (Phase 3b): a company whose FOLDER was deleted leaves the
  // group books. This checks folder-presence only (NOT the enable/disable toggle),
  // so group totals are byte-identical when every folder is present and the
  // existing Module-Control toggle behaviour is unchanged. On file:// discovery
  // is inert → present() is always true → identical.
  function present(companyId) {
    return !EPAL.discovery || EPAL.discovery.presentFor(companyId);
  }

  /* ==========================================================================
   * SEED DATA — only written the first time (idempotent).
   * ========================================================================*/
  var SCALE = { travels: 4200000, woodart: 2600000, it: 3100000, shop: 1900000, construction: 6800000 };
  var MARGIN = { travels: 0.14, woodart: 0.28, it: 0.42, shop: 0.19, construction: 0.16 };
  var GROWTH = { travels: 1.9, woodart: 1.2, it: 3.1, shop: 0.8, construction: -0.6 }; // %/mo trend

  function seedFinancials() {
    var months = lastMonths(12), rows = [];
    Object.keys(SCALE).forEach(function (cid) {
      months.forEach(function (ym, i) {
        var trend = 1 + (GROWTH[cid] / 100) * i;
        var season = 1 + 0.12 * Math.sin((i / 12) * Math.PI * 2 + (cid === 'travels' ? 1 : 0));
        var noise = 0.9 + rnd() * 0.2;
        var revenue = Math.round(SCALE[cid] * trend * season * noise);
        var expense = Math.round(revenue * (1 - MARGIN[cid]) * (0.95 + rnd() * 0.12));
        rows.push({ companyId: cid, ym: ym, revenue: revenue, expense: expense });
      });
    });
    return rows;
  }

  var DEPTS = {
    travels: ['Air Ticketing', 'Visa', 'Operations', 'Accounts', 'Sales'],
    woodart: ['Design', 'Workshop', 'Site', 'Procurement', 'Accounts'],
    it:      ['Engineering', 'QA', 'Design', 'Support', 'Sales'],
    shop:    ['Floor', 'Cashier', 'Inventory', 'Purchasing', 'Accounts'],
    construction: ['Engineering', 'Site', 'Procurement', 'Safety', 'Accounts']
  };
  var DESIG = {
    Engineering:['Software Engineer','Senior Developer','Tech Lead','DevOps Engineer'],
    QA:['QA Engineer','QA Lead'], Design:['UI/UX Designer','Interior Designer','Design Lead'],
    Support:['Support Executive','Support Lead'], Sales:['Sales Executive','Sales Manager','BDM'],
    'Air Ticketing':['Ticketing Officer','Reservation Executive'], Visa:['Visa Officer','Visa Manager'],
    Operations:['Operations Executive','Ops Manager'], Accounts:['Accountant','Accounts Manager','Finance Lead'],
    Workshop:['Carpenter','Workshop Supervisor','CNC Operator'], Site:['Site Engineer','Site Supervisor','Foreman'],
    Procurement:['Procurement Officer','Purchase Manager'], Floor:['Sales Associate','Floor Manager'],
    Cashier:['Cashier','Head Cashier'], Inventory:['Stock Keeper','Inventory Manager'],
    Purchasing:['Purchase Officer'], Safety:['HSE Officer','Safety Manager']
  };
  var FIRST = ['Arif','Nusrat','Tanvir','Sadia','Rakib','Farhana','Imran','Mitu','Sabbir','Rumi',
               'Jamil','Sharmin','Naeem','Tania','Fahim','Rupa','Shakib','Munia','Rasel','Priya',
               'Habib','Sumaiya','Zahid','Lamia'];
  var LAST = ['Hasan','Akter','Rahman','Islam','Ahmed','Chowdhury','Karim','Begum','Sarker','Khan'];

  function seedEmployees() {
    var emps = [];
    // The owner / super admin (you)
    emps.push({ id: 'EPL-0001', name: 'Mohsin (Owner)', companyId: 'group', dept: 'Executive',
      designation: 'Group Chairman', role: 'owner', email: 'owner@epalgroup.com', phone: '+8801700000000',
      joinDate: '2011-07-01', salary: 0, status: 'active',
      attendance: { present: 22, absent: 0, late: 0, leave: 0 }, rating: 5 });

    var n = 2;
    Object.keys(SCALE).forEach(function (cid) {
      var count = cid === 'construction' ? 7 : cid === 'travels' ? 6 : 5;
      for (var i = 0; i < count; i++) {
        var dept = pick(DEPTS[cid]);
        var desig = pick(DESIG[dept] || ['Executive']);
        var role = /Manager|Lead|Head|Chief|BDM/.test(desig) ? 'manager'
                 : dept === 'Accounts' ? 'accountant' : 'employee';
        var name = pick(FIRST) + ' ' + pick(LAST);
        var present = ri(18, 22), absent = ri(0, 3), late = ri(0, 4), leave = ri(0, 2);
        emps.push({
          id: 'EPL-' + String(n).padStart(4, '0'),
          name: name, companyId: cid, dept: dept, designation: desig, role: role,
          email: name.toLowerCase().replace(/[^a-z]+/g, '.') + '@epal' + cid + '.com',
          phone: '+88017' + ri(10000000, 99999999),
          joinDate: (2015 + ri(0, 9)) + '-' + String(ri(1, 12)).padStart(2, '0') + '-' + String(ri(1, 28)).padStart(2, '0'),
          salary: ri(28, 140) * 1000, status: rnd() > 0.06 ? 'active' : 'on-leave',
          attendance: { present: present, absent: absent, late: late, leave: leave },
          rating: ri(30, 50) / 10
        });
        n++;
      }
    });

    // A named developer in IT Solutions (matches the owner's example use-case).
    emps.push({ id: 'EPL-DEV1', name: 'Tanvir Hasan', companyId: 'it', dept: 'Engineering',
      designation: 'Software Engineer', role: 'employee', email: 'tanvir.dev@epalit.com',
      phone: '+8801711111111', joinDate: '2022-03-15', salary: 78000, status: 'active',
      attendance: { present: 21, absent: 1, late: 2, leave: 1 }, rating: 4.3, demoUser: true });
    return emps;
  }

  function seedCustomers() {
    var names = ['Rahim Enterprise','Skyline Developers','Meghna Group','Padma Textiles','BRAC Corp',
      'Nordic Holidays','Grameen Solutions','Delta Constructions','Aarong Retail','Bengal Foods',
      'Summit Power','Orient Traders','City Homes','Prime Bank','Robi Axiata'];
    var comps = Object.keys(SCALE);
    return names.map(function (nm, i) {
      var ids = [pick(comps)]; if (rnd() > 0.55) { var b = pick(comps); if (ids.indexOf(b) < 0) ids.push(b); }
      return { id: 'CUS-' + String(1001 + i), name: nm, companyIds: ids,
        contact: pick(FIRST) + ' ' + pick(LAST), phone: '+88018' + ri(10000000, 99999999),
        email: nm.toLowerCase().replace(/[^a-z]+/g, '') + '@mail.com',
        value: ri(2, 90) * 100000, since: (2018 + ri(0, 7)) + '-0' + ri(1, 9),
        tier: pick(['Standard','Standard','Silver','Gold','Platinum']), status: 'active' };
    });
  }

  function seedLeads() {
    var stages = ['New','Contacted','Qualified','Proposal','Negotiation','Won','Lost'];
    var comps = Object.keys(SCALE), out = [];
    for (var i = 0; i < 42; i++) {
      out.push({ id: 'LD-' + (2001 + i), companyId: pick(comps), name: pick(FIRST) + ' ' + pick(LAST),
        source: pick(['Website','Referral','WhatsApp','Facebook','Walk-in','Cold Call','Fair']),
        stage: pick(stages), value: ri(1, 60) * 50000, owner: 'EPL-' + String(ri(2, 20)).padStart(4, '0'),
        created: '2026-0' + ri(1, 6) + '-' + String(ri(1, 28)).padStart(2, '0') });
    }
    return out;
  }

  /* --- Travels: Visa exemplar seed ---------------------------------------*/
  function seedVisaCats() {
    return [
      { id:'VC-01', country:'Malaysia', flag:'🇲🇾', type:'Tourist',  cost:18000, sale:26000, days:7,  status:'active' },
      { id:'VC-02', country:'Thailand', flag:'🇹🇭', type:'Tourist',  cost:9000,  sale:14500, days:5,  status:'active' },
      { id:'VC-03', country:'UAE',      flag:'🇦🇪', type:'Tourist',  cost:15000, sale:22000, days:4,  status:'active' },
      { id:'VC-04', country:'Saudi Arabia', flag:'🇸🇦', type:'Umrah', cost:32000, sale:45000, days:10, status:'active' },
      { id:'VC-05', country:'Schengen', flag:'🇪🇺', type:'Tourist',  cost:28000, sale:42000, days:21, status:'active' },
      { id:'VC-06', country:'Singapore',flag:'🇸🇬', type:'Business', cost:12000, sale:19000, days:6,  status:'active' },
      { id:'VC-07', country:'Canada',   flag:'🇨🇦', type:'Visit',    cost:35000, sale:52000, days:45, status:'active' },
      { id:'VC-08', country:'UK',       flag:'🇬🇧', type:'Visit',    cost:38000, sale:58000, days:30, status:'active' }
    ];
  }
  var VISA_STAGES = ['New','Documents','Submitted','Under Process','Approved','Rejected'];
  function seedVisaApps() {
    var cats = seedVisaCats(), out = [];
    for (var i = 0; i < 24; i++) {
      var c = pick(cats);
      var stage = pick(VISA_STAGES.concat(['Under Process','Approved','Submitted'])); // weight mid/positive
      out.push({ id:'VA-' + (5001 + i), applicant: pick(FIRST) + ' ' + pick(LAST),
        phone:'+88019' + ri(10000000, 99999999), passport:'B' + ri(1000000, 9999999),
        country: c.country, flag: c.flag, visaType: c.type, catId: c.id,
        cost: c.cost, sale: c.sale, stage: stage,
        travelDate:'2026-' + String(ri(7, 12)).padStart(2, '0') + '-' + String(ri(1, 28)).padStart(2, '0'),
        created:'2026-0' + ri(4, 6) + '-' + String(ri(1, 28)).padStart(2, '0'),
        agent:'EPL-' + String(ri(2, 8)).padStart(4, '0'),
        payStatus: pick(['Paid','Partial','Due','Paid','Paid']) });
    }
    return out;
  }

  function seedVendors() {
    var t = ['Ticketing','Visa','Hotel','Umrah','Multi-service'];
    return ['Galaxy GSA','Zamzam Travels','Emirates GSA','Sky Holidays','Al-Haramain','GDS Aggregator BD']
      .map(function (nm, i) { return { id:'VN-' + (301 + i), name: nm, type: pick(t),
        balance: ri(-8, 20) * 50000, creditLimit: ri(4, 20) * 100000, terms: pick(['Cash','Net 7','Net 15','Net 30']) }; });
  }

  function seedTasksForDemoDev() {
    // A rich, multi-phase board for the demo developer (matches owner's spec).
    var now = 1751000000000; // fixed demo timestamp base
    return [
      { id:'T-1001', title:'Build ERP Authentication Module', desc:'JWT auth, role guard, session handling.',
        status:'inprogress', priority:'high', due:'2026-07-10', created:'2026-06-20', createdBy:'EPL-DEV1',
        labels:['backend','security'], restricted:false, redFlag:false,
        comments:[{ by:'EPL-0001', byAdmin:true, at: now - 86400000, text:'Prioritise refresh-token rotation.', unseen:true }],
        phases:[
          { id:'p1', name:'Database schema', pct:100, accumMs: 3*3600e3, running:false, startedAt:null, done:true },
          { id:'p2', name:'API endpoints',   pct:60,  accumMs: 2.5*3600e3, running:false, startedAt:null, done:false },
          { id:'p3', name:'Role middleware',  pct:0,   accumMs: 0, running:false, startedAt:null, done:false },
          { id:'p4', name:'Unit tests',       pct:0,   accumMs: 0, running:false, startedAt:null, done:false }
        ] },
      { id:'T-1002', title:'Design Group Dashboard UI', desc:'KPI cards, charts, premium theme.',
        status:'todo', priority:'medium', due:'2026-07-14', created:'2026-06-25', createdBy:'EPL-DEV1',
        labels:['frontend','ui'], restricted:false, redFlag:false, comments:[],
        phases:[ { id:'p1', name:'Wireframe', pct:0, accumMs:0, running:false, done:false },
                 { id:'p2', name:'Components', pct:0, accumMs:0, running:false, done:false } ] },
      { id:'T-1003', title:'Fix production hotfix — payment webhook', desc:'Duplicate charge on retry.',
        status:'review', priority:'high', due:'2026-07-03', created:'2026-06-28', createdBy:'EPL-0001',
        labels:['bug','urgent'], restricted:true, redFlag:false,
        comments:[{ by:'EPL-0001', byAdmin:true, at: now - 3600000, text:'This is restricted — do not close without my review.', unseen:true }],
        phases:[ { id:'p1', name:'Reproduce', pct:100, accumMs: 1.2*3600e3, running:false, done:true },
                 { id:'p2', name:'Patch + deploy', pct:80, accumMs: 2*3600e3, running:false, done:false } ] },
      { id:'T-1004', title:'Client onboarding — Meghna Group', desc:'Kickoff, access, training.',
        status:'done', priority:'low', due:'2026-06-30', created:'2026-06-10', createdBy:'EPL-DEV1',
        labels:['client'], restricted:false, redFlag:false, comments:[],
        phases:[ { id:'p1', name:'Kickoff', pct:100, accumMs: 1.5*3600e3, running:false, done:true } ] },
      { id:'T-1005', title:'Refactor legacy monolith imports', desc:'Split modules, remove dead code.',
        status:'cancelled', priority:'low', due:'2026-06-22', created:'2026-06-05', createdBy:'EPL-DEV1',
        labels:['tech-debt'], restricted:false, redFlag:true, comments:[],
        phases:[ { id:'p1', name:'Audit', pct:40, accumMs: 0.8*3600e3, running:false, done:false } ] }
    ];
  }

  /* --- Travels: Air Ticketing seed ---------------------------------------*/
  function seedAirlines() {
    return [
      { id:'AL-BG', name:'Biman Bangladesh Airlines', iata:'BG', country:'Bangladesh',  status:'active' },
      { id:'AL-BS', name:'US-Bangla Airlines',        iata:'BS', country:'Bangladesh',  status:'active' },
      { id:'AL-EK', name:'Emirates',                  iata:'EK', country:'UAE',          status:'active' },
      { id:'AL-QR', name:'Qatar Airways',             iata:'QR', country:'Qatar',        status:'active' },
      { id:'AL-SV', name:'Saudia',                    iata:'SV', country:'Saudi Arabia', status:'active' },
      { id:'AL-EY', name:'Etihad Airways',            iata:'EY', country:'UAE',          status:'active' },
      { id:'AL-TK', name:'Turkish Airlines',          iata:'TK', country:'Turkey',       status:'active' },
      { id:'AL-MH', name:'Malaysia Airlines',         iata:'MH', country:'Malaysia',     status:'active' },
      { id:'AL-SQ', name:'Singapore Airlines',        iata:'SQ', country:'Singapore',    status:'active' },
      { id:'AL-FZ', name:'Flydubai',                  iata:'FZ', country:'UAE',          status:'active' }
    ];
  }
  function seedAirports() {
    return [
      { id:'AP-DAC', name:'Hazrat Shahjalal Intl',        iata:'DAC', city:'Dhaka',        country:'Bangladesh' },
      { id:'AP-CGP', name:'Shah Amanat Intl',             iata:'CGP', city:'Chittagong',   country:'Bangladesh' },
      { id:'AP-DXB', name:'Dubai Intl',                   iata:'DXB', city:'Dubai',        country:'UAE' },
      { id:'AP-DOH', name:'Hamad Intl',                   iata:'DOH', city:'Doha',         country:'Qatar' },
      { id:'AP-JED', name:'King Abdulaziz Intl',          iata:'JED', city:'Jeddah',       country:'Saudi Arabia' },
      { id:'AP-RUH', name:'King Khalid Intl',             iata:'RUH', city:'Riyadh',       country:'Saudi Arabia' },
      { id:'AP-KUL', name:'Kuala Lumpur Intl',            iata:'KUL', city:'Kuala Lumpur', country:'Malaysia' },
      { id:'AP-SIN', name:'Changi',                       iata:'SIN', city:'Singapore',    country:'Singapore' },
      { id:'AP-IST', name:'Istanbul',                     iata:'IST', city:'Istanbul',     country:'Turkey' },
      { id:'AP-LHR', name:'Heathrow',                     iata:'LHR', city:'London',       country:'United Kingdom' },
      { id:'AP-CCU', name:'Netaji Subhas Chandra Bose',   iata:'CCU', city:'Kolkata',      country:'India' },
      { id:'AP-BKK', name:'Suvarnabhumi',                 iata:'BKK', city:'Bangkok',      country:'Thailand' }
    ];
  }
  var TKT_STATUSES = ['Issued','Issued','Confirmed','Hold','Issued','Re-issued','Void','Refunded'];
  function seedAirTickets() {
    var airlines = seedAirlines(), out = [];
    var routes = [['DAC','DXB'],['DAC','JED'],['DAC','KUL'],['DAC','DOH'],['DAC','SIN'],
                  ['CGP','DXB'],['DAC','IST'],['DAC','LHR'],['DAC','RUH'],['DAC','CCU'],['DAC','BKK']];
    for (var i = 0; i < 18; i++) {
      var al = pick(airlines), rt = pick(routes);
      var cost = ri(38, 120) * 1000;
      var sale = Math.round(cost * (1.06 + rnd() * 0.14));
      out.push({
        id:'TK-' + (7001 + i),
        pnr: String.fromCharCode(65 + ri(0,25)) + String.fromCharCode(65 + ri(0,25)) + ri(1000, 9999),
        ticketNo: '057-' + ri(1000000000, 9999999999),
        passenger: pick(FIRST) + ' ' + pick(LAST),
        phone:'+88016' + ri(10000000, 99999999), passport:'A' + ri(1000000, 9999999),
        fromCode: rt[0], toCode: rt[1], route: rt[0] + ' → ' + rt[1],
        tripType: pick(['One-way','Round','Round','Multi-City']),
        airlineCode: al.iata, airline: al.name, flightNo: al.iata + ri(100, 999),
        vendor: pick(['Galaxy GSA','GDS Aggregator BD','Emirates GSA','Direct Airline']),
        portal: pick(['Sabre','Amadeus','Galileo','Direct']),
        travelDate:'2026-' + String(ri(7,12)).padStart(2,'0') + '-' + String(ri(1,28)).padStart(2,'0'),
        purchaseDate:'2026-0' + ri(4,6) + '-' + String(ri(1,28)).padStart(2,'0'),
        cost: cost, sale: sale, costPaid: pick([cost, cost, 0, Math.round(cost/2)]),
        payStatus: pick(['Paid','Paid','Partial','Due']),
        agent:'EPL-' + String(ri(2,8)).padStart(4,'0'),
        currency:'BDT', status: pick(TKT_STATUSES),
        created:'2026-0' + ri(4,6) + '-' + String(ri(1,28)).padStart(2,'0'),
        timeline:[{ at: Date.now() - ri(1,40) * 86400000, text:'Ticket issued' }]
      });
    }
    return out;
  }
  function seedAirRefunds() {
    var al = seedAirlines();
    return [0,1,2,3,4].map(function (i) {
      var a = pick(al), gross = ri(40,110) * 1000, penalty = ri(3,12) * 1000, fee = ri(1,4) * 1000;
      return { id:'RF-' + (9001 + i), pnr: String.fromCharCode(65+ri(0,25)) + String.fromCharCode(65+ri(0,25)) + ri(1000,9999),
        passenger: pick(FIRST) + ' ' + pick(LAST), airline: a.name, ticketNo:'057-' + ri(1000000000, 9999999999),
        gross: gross, airlineRefund: gross - penalty, penalty: penalty, fee: fee, netRefund: gross - penalty - fee,
        method: pick(['Bank','bKash','Cash','Card Reversal']),
        status: pick(['Requested','Filed','Received','Paid','Rejected']),
        date:'2026-0' + ri(4,6) + '-' + String(ri(1,28)).padStart(2,'0') };
    });
  }
  function seedAirBsp() {
    var al = seedAirlines();
    function txn(i, st) { var a = pick(al), comm = ri(1,6) * 1000, agency = ri(30,90) * 1000;
      return { id:'BX-' + (1 + i), passenger: pick(FIRST) + ' ' + pick(LAST), airline: a.name,
        issueDate:'2026-06-' + String(ri(1,28)).padStart(2,'0'), comm: comm, agencyAmt: agency,
        bspAmt: st === 'Discrepancy' ? agency + ri(1,5) * 1000 : agency, status: st }; }
    return {
      txns: [txn(0,'Matched'), txn(1,'Matched'), txn(2,'Matched'), txn(3,'Unmatched'), txn(4,'Discrepancy'), txn(5,'Matched')],
      adms: [ { id:'ADM-1', airline:'Emirates', ticketNo:'176-2210045566', reason:'Fare rule violation', amount: 8400, date:'2026-06-18', status:'Open' },
              { id:'ADM-2', airline:'Qatar Airways', ticketNo:'157-3340012211', reason:'Incorrect tax', amount: 3200, date:'2026-06-22', status:'Disputed' } ],
      unused: [ { id:'UN-1', passenger:'Rakib Hasan', airline:'Biman Bangladesh Airlines', value: 46000, expiry:'2026-09-30' },
                { id:'UN-2', passenger:'Tania Islam', airline:'Saudia', value: 61000, expiry:'2026-08-15' } ],
      api: { connected: true, endpoint:'bsplink.iata.org', keyMasked:'••••4821', lastSync:'2026-07-05 09:12' }
    };
  }

  function seedNotifications() {
    return [
      { id:'N1', level:'warning', title:'AR Aging Alert', text:'৳12.4L overdue >60 days in Construction.', companyId:'construction', at: Date.now()-7200000, read:false, icon:'exclamation-triangle-fill' },
      { id:'N2', level:'success', title:'Visa Approved', text:'3 Malaysia tourist visas approved today.', companyId:'travels', at: Date.now()-10800000, read:false, icon:'check-circle-fill' },
      { id:'N3', level:'info', title:'New Lead', text:'Skyline Developers enquired about interior fit-out.', companyId:'woodart', at: Date.now()-14400000, read:false, icon:'person-plus-fill' },
      { id:'N4', level:'error', title:'Low Stock', text:'6 SKUs below reorder level in Epal Shop.', companyId:'shop', at: Date.now()-21600000, read:true, icon:'box-seam' }
    ];
  }

  /* ==========================================================================
   * PUBLIC DB API
   * ========================================================================*/
  var DB = {
    seed: function () {
      S.seedOnce('financials', seedFinancials());
      S.seedOnce('employees', seedEmployees());
      S.seedOnce('customers', seedCustomers());
      S.seedOnce('leads', seedLeads());
      S.seedOnce('visaCats', seedVisaCats());
      S.seedOnce('visaApps', seedVisaApps());
      S.seedOnce('vendors', seedVendors());
      S.seedOnce('airlines', seedAirlines());
      S.seedOnce('airports', seedAirports());
      S.seedOnce('airTickets', seedAirTickets());
      S.seedOnce('airRefunds', seedAirRefunds());
      S.seedOnce('airBsp', seedAirBsp());
      S.seedOnce('notifications', seedNotifications());
      S.seedOnce('tasks.EPL-DEV1', seedTasksForDemoDev());
      S.seedOnce('activity', [{ id:'A1', at: Date.now(), actor:'System', text:'ERP initialised · demo data seeded', companyId:'group' }]);
      // Extended deep seed (all companies' operational data) lives in
      // core/seed-bd.js so this file stays readable. It is also idempotent.
      if (EPAL.seedBD) EPAL.seedBD();
      // Deep Core engines (ledger, audit, approvals, documents…) self-seed via
      // the engine registry — all idempotent (core/engines.js).
      if (EPAL.seedEngines) EPAL.seedEngines();
    },

    /* --- raw collections --------------------------------------------------*/
    financials: function () { return S.list('financials'); },
    employees: function (f) {
      var e = S.list('employees');
      if (f && f.companyId) e = e.filter(function (x) { return x.companyId === f.companyId; });
      if (f && f.dept) e = e.filter(function (x) { return x.dept === f.dept; });
      return e;
    },
    employee: function (id) { return S.list('employees').filter(function (e) { return e.id === id; })[0] || null; },
    customers: function (companyId) {
      var c = S.list('customers');
      return companyId ? c.filter(function (x) { return x.companyIds.indexOf(companyId) >= 0; }) : c;
    },
    leads: function (companyId) {
      var l = S.list('leads');
      return companyId ? l.filter(function (x) { return x.companyId === companyId; }) : l;
    },
    visaCats: function () { return S.list('visaCats'); },
    visaApps: function () { return S.list('visaApps'); },
    vendors: function () { return S.list('vendors'); },
    airlines: function () { return S.list('airlines'); },
    airports: function () { return S.list('airports'); },
    airTickets: function () { return S.list('airTickets'); },
    airRefunds: function () { return S.list('airRefunds'); },
    airBsp: function () { return S.get('airBsp', { txns:[], adms:[], unused:[], api:{} }); },
    notifications: function () { return S.list('notifications').sort(function (a, b) { return b.at - a.at; }); },

    /* The notifications ONE user should actually see — their inbox.
       A notification is either BROADCAST (no `toId`: system-wide alerts, the
       original behaviour) or ADDRESSED to a single employee (`toId` set, e.g. a
       meeting invite). Broadcasts reach everyone; an addressed one reaches only
       its recipient, so the owner scheduling a meeting with 8 people does not
       get their own 8 invites echoed back into their bell.
       Every seeded/legacy notification has no toId, so inbox() === notifications()
       for all pre-existing data — this is additive, not a behaviour change. */
    inbox: function (empId) {
      var me = empId || (EPAL.auth ? (EPAL.auth.current() || {}).id : null);
      return this.notifications().filter(function (n) { return !n.toId || n.toId === me; });
    },

    activity: function () { return S.list('activity').sort(function (a, b) { return b.at - a.at; }); },
    tasksFor: function (empId) { return S.list('tasks.' + empId); },

    /* --- aggregations (the "intelligence") --------------------------------*/
    months: lastMonths,

    // Sum a company's finances (optionally last N months). companyId omitted = whole group.
    finance: function (companyId, months) {
      var rows = this.financials();
      if (companyId) rows = rows.filter(function (r) { return r.companyId === companyId; });
      else rows = rows.filter(function (r) { return present(r.companyId); });   // group-wide → present folders only
      if (months) { var keep = lastMonths(months); rows = rows.filter(function (r) { return keep.indexOf(r.ym) >= 0; }); }
      var rev = 0, exp = 0; rows.forEach(function (r) { rev += r.revenue; exp += r.expense; });
      return { revenue: rev, expense: exp, profit: rev - exp, margin: rev ? ((rev - exp) / rev) * 100 : 0 };
    },

    // Monthly series for charts: {labels[], revenue[], expense[], profit[]}
    series: function (companyId) {
      var months = lastMonths(12), rows = this.financials()
        .filter(function (r) { return companyId ? r.companyId === companyId : present(r.companyId); });
      var byM = {};
      rows.forEach(function (r) { (byM[r.ym] = byM[r.ym] || { r:0, e:0 }); byM[r.ym].r += r.revenue; byM[r.ym].e += r.expense; });
      return {
        labels: months.map(function (ym) { var d = ym.split('-'); return new Date(d[0], d[1]-1, 1).toLocaleString('en', { month:'short' }); }),
        revenue: months.map(function (ym) { return byM[ym] ? byM[ym].r : 0; }),
        expense: months.map(function (ym) { return byM[ym] ? byM[ym].e : 0; }),
        profit:  months.map(function (ym) { return byM[ym] ? byM[ym].r - byM[ym].e : 0; })
      };
    },

    // Month-over-month % change of revenue (last vs previous).
    momRevenue: function (companyId) {
      var s = this.series(companyId), n = s.revenue.length;
      if (n < 2 || !s.revenue[n-2]) return 0;
      return ((s.revenue[n-1] - s.revenue[n-2]) / s.revenue[n-2]) * 100;
    },

    // A composite 0-100 "risk score" per company (higher = riskier).
    riskScore: function (companyId) {
      var f = this.finance(companyId, 3), mom = this.momRevenue(companyId);
      var marginRisk = Math.max(0, (25 - f.margin)) * 2;        // thin margins → risk
      var trendRisk  = mom < 0 ? Math.min(40, -mom * 6) : 0;     // shrinking → risk
      var arRisk     = companyId === 'construction' ? 22 : 8;    // demo: heavy AR in construction
      return Math.min(100, Math.round(marginRisk + trendRisk + arRisk));
    },

    // Everything the Group Command Center needs in one call.
    groupSnapshot: function () {
      var self = this;
      var comps = EPAL.config.companies.filter(function (c) { return c.type === 'company' && c.enabled && present(c.id); });
      var per = comps.map(function (c) {
        var f = self.finance(c.id, 12), m3 = self.finance(c.id, 3);
        return { id:c.id, name:c.name, short:c.short, accent:c.accent, icon:c.icon,
          revenue:f.revenue, profit:f.profit, margin:f.margin, mom:self.momRevenue(c.id),
          risk:self.riskScore(c.id), employees:self.employees({ companyId:c.id }).length,
          m3revenue:m3.revenue };
      });
      var tot = per.reduce(function (a, c) { return { revenue:a.revenue+c.revenue, profit:a.profit+c.profit }; }, { revenue:0, profit:0 });
      return {
        companies: per,
        revenue: tot.revenue, profit: tot.profit,
        margin: tot.revenue ? (tot.profit / tot.revenue) * 100 : 0,
        headcount: this.employees().length,
        customers: this.customers().length,
        openLeads: this.leads().filter(function (l) { return ['New','Contacted','Qualified','Proposal','Negotiation'].indexOf(l.stage) >= 0; }).length,
        pipelineValue: this.leads().filter(function (l) { return ['Qualified','Proposal','Negotiation'].indexOf(l.stage) >= 0; }).reduce(function (a, l) { return a + l.value; }, 0)
      };
    },

    /* --- GENERIC COLLECTION API (used by the entity factory + all modules) -*/
    col: function (name) { return S.list(name); },
    save: function (name, record) {
      S.upsert(name, record);
      bus.emit('data:changed', { store: name, action: 'upsert', record: record });
      return record;
    },
    remove: function (name, id) {
      S.removeFrom(name, id);
      bus.emit('data:changed', { store: name, action: 'delete', id: id });
    },

    /* --- THE CROSS-COMPANY CHAIN -------------------------------------------
     * Any module that closes a sale calls postSale(). It:
     *   1. appends to the group-wide `sales` ledger,
     *   2. rolls the amount into that company's CURRENT month financials row
     *      (so company dashboard, Accounts, Group Command Center all move),
     *   3. emits `sale:recorded` for live widgets + drops an activity log.
     * This is the single artery connecting operations → finance → BI. -------*/
    postSale: function (companyId, sale) {
      sale = sale || {};
      var rec = {
        id: 'SL-' + Date.now().toString(36) + Math.floor(Math.random() * 999),
        companyId: companyId,
        date: sale.date || new Date().toISOString().slice(0, 10),
        amount: +sale.amount || 0, cost: +sale.cost || 0,
        profit: (+sale.amount || 0) - (+sale.cost || 0),
        ref: sale.ref || '', desc: sale.desc || '', customer: sale.customer || '',
        // accounting hints for the ledger auto-post: categorised income + whether the
        // customer paid (cash vs receivable) + the vendor and whether they're paid.
        category: sale.category || '', incomeAccount: sale.incomeAccount || '',
        vendor: sale.vendor || '', paid: sale.paid === true, costPaid: sale.costPaid === true,
        payStatus: sale.payStatus || ''
      };
      S.upsert('sales', rec);
      // roll into the company's latest financials month
      var fins = S.list('financials');
      var mine = fins.filter(function (f) { return f.companyId === companyId; })
                     .sort(function (a, b) { return a.ym < b.ym ? -1 : 1; });
      var last = mine[mine.length - 1];
      if (last) {
        last.revenue += rec.amount; last.expense += rec.cost;
        S.set('financials', fins);
      }
      bus.emit('sale:recorded', rec);
      bus.emit('data:changed', { store: 'sales', action: 'create', record: rec });
      this.log(EPAL.auth.current ? (EPAL.auth.current() || {}).name || 'System' : 'System',
        'Sale ' + EPAL.ui.money(rec.amount) + (rec.desc ? ' · ' + rec.desc : ''), companyId);
      return rec;
    },
    sales: function (companyId) {
      var s = S.list('sales');
      return companyId ? s.filter(function (x) { return x.companyId === companyId; }) : s;
    },

    /* Customer-payment SETTLEMENT for a sale that was posted as a receivable:
     * flipping a ticket/visa to Paid posts DR Cash / CR AR under a stable id
     * (GL-SET-<ref>), and flipping back to Due removes that same entry — so the
     * record's payment status and the BOOKS can never drift apart.
     * ==> LARAVEL: a payments table row + posted journal, deleted on reversal. */
    settleSale: function (companyId, ref, amount, party, paid) {
      if (!EPAL.ledger || !EPAL.ledger.post) return;
      var id = 'GL-SET-' + ref;
      if (paid) {
        // settle ONLY when this ref genuinely sits in AR (posted as a receivable
        // sale) — never for cash sales, and never for legacy records that were
        // saved before finance posting existed
        var arAcct = null, cash = false;
        S.list('gl_entries').forEach(function (e) {
          if (e.source === 'sale' && e.ref === ref) (e.lines || []).forEach(function (l) {
            if (l.dr > 0) { if (l.account === '1200' || l.account === '1150') arAcct = l.account; if (l.account === '1010') cash = true; }
          });
        });
        if (!arAcct || cash || !(+amount > 0)) return;
        try {
          EPAL.ledger.post({ id: id, date: new Date().toISOString().slice(0, 10), companyId: companyId,
            ref: ref, memo: 'Customer payment received · ' + ref, source: 'payment', party: party || '',
            lines: [ { account: '1010', dr: +amount, cr: 0 }, { account: arAcct, dr: 0, cr: +amount } ] });   // settle the SAME control account the sale debited
        } catch (e) {}
      } else if (EPAL.ledger.remove) { try { EPAL.ledger.remove(id); } catch (e) {} }
    },

    /* --- mutations (all emit events → live sync) --------------------------*/
    saveTask: function (empId, task) {
      var arr = this.tasksFor(empId);
      var i = arr.findIndex(function (t) { return t.id === task.id; });
      if (i >= 0) arr[i] = task; else arr.push(task);
      S.set('tasks.' + empId, arr);
      bus.emit('task:updated', { empId: empId, taskId: task.id });
      bus.emit('data:changed', { store:'tasks', action: i>=0?'update':'create', record: task });
      return task;
    },
    deleteTask: function (empId, taskId) {
      S.set('tasks.' + empId, this.tasksFor(empId).filter(function (t) { return t.id !== taskId; }));
      bus.emit('task:updated', { empId: empId, taskId: taskId, action:'delete' });
    },
    saveVisaApp: function (app) {
      if (!app.id) app.id = 'VA-' + Date.now().toString().slice(-5);
      S.upsert('visaApps', app);
      bus.emit('data:changed', { store:'visaApps', action:'upsert', record: app });
      this.log('EPL-0001', 'Visa application ' + app.id + ' saved (' + app.country + ')', 'travels');
      return app;
    },
    saveAirTicket: function (t) {
      if (!t.id) t.id = 'TK-' + Date.now().toString().slice(-5);
      S.upsert('airTickets', t);
      bus.emit('data:changed', { store:'airTickets', action:'upsert', record: t });
      this.log('EPL-0001', 'Air ticket ' + t.id + ' saved (' + (t.route || '') + ')', 'travels');
      return t;
    },
    saveAirline: function (a) { S.upsert('airlines', a); bus.emit('data:changed', { store:'airlines', action:'upsert', record:a }); return a; },
    saveAirport: function (a) { S.upsert('airports', a); bus.emit('data:changed', { store:'airports', action:'upsert', record:a }); return a; },
    saveAirRefund: function (r) { S.upsert('airRefunds', r); bus.emit('data:changed', { store:'airRefunds', action:'upsert', record:r }); return r; },
    saveEmployee: function (e) { S.upsert('employees', e); bus.emit('data:changed', { store:'employees', action:'upsert', record:e }); return e; },
    saveCustomer: function (c) { S.upsert('customers', c); bus.emit('customer:upserted', { customerId:c.id }); return c; },
    saveVisaCat: function (c) { S.upsert('visaCats', c); bus.emit('data:changed', { store:'visaCats', action:'upsert', record:c }); return c; },

    /* "Mark all read" only clears what the user can SEE (their inbox) — marking
       someone else's unopened meeting invite as read on their behalf would be a
       lie. With no addressed notifications in the store this is identical to the
       previous mark-everything behaviour. */
    markNotificationsRead: function () {
      var mine = {};
      this.inbox().forEach(function (n) { mine[n.id] = true; });
      var arr = this.notifications().map(function (n) { if (mine[n.id]) n.read = true; return n; });
      S.set('notifications', arr); bus.emit('data:changed', { store:'notifications', action:'read' });
    },
    /* n.toId (optional) addresses the notification to one employee — see inbox(). */
    notify: function (n) {
      n.id = n.id || EPAL.ui.uid('N'); n.at = n.at || Date.now(); n.read = false;
      S.upsert('notifications', n); bus.emit('notify', n); return n;
    },
    log: function (actor, text, companyId) {
      var a = { id: EPAL.ui.uid('A'), at: Date.now(), actor: actor, text: text, companyId: companyId || 'group' };
      S.upsert('activity', a); return a;
    },

    reset: function () { S.nuke(); this.seed(); bus.emit('data:changed', { store:'*', action:'reset' }); }
  };

  EPAL.db = DB;

})(window.EPAL = window.EPAL || {});
