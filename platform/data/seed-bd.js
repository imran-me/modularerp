/* ============================================================================
 * EPAL GROUP ERP  ·  assets/js/data/seed-bd.js
 * ----------------------------------------------------------------------------
 * WHAT: The DEEP demo seeder — Bangladesh-context operational data for EVERY
 *   sister company, so the system feels like a live running group (not a
 *   skeleton). Exposes ONE function, EPAL.seedBD(), called from db.seed() after
 *   the core stores are seeded. It uses its OWN deterministic PRNG (independent
 *   seed) and a `gen(store,count,factory)` helper that writes each store only
 *   if it has never been written (idempotent). database.js owns the "core"
 *   stores; this file owns the per-company operational stores below.
 *
 * DATA IT OWNS (localStorage stores; each seeded only once):
 *   GROUP / SHARED
 *     banks          [{id, name, branch, account, companyId, balance, created}]
 *     crm_activities [{id, type, lead, company, by, note, outcome, date, created}]
 *     acc_entries    [{id, companyId, kind:enum(Income|Expense), category, desc, amount,
 *                      method, date, created}]   monthly income/expense feed per company
 *     acc_schedules  [{id, companyId, party, kind:enum(Payable|Receivable), amount, due,
 *                      status:enum(Pending|Partial|Paid), ref, created}]
 *     sales          [{id, companyId, date, amount, cost, profit, ref, desc, customer}]
 *                      NOTE: same store db.postSale() appends to at runtime.
 *   TRAVELS   tv_tickets, tv_contract_flights, tv_agents, tv_portals, tv_files, tv_passports
 *   WOODART   wa_projects, wa_estimates, wa_materials, wa_production, wa_installs, wa_purchases
 *   IT        it_projects, it_subscriptions, it_tickets, it_timesheets, it_contracts
 *   SHOP      sh_products, sh_orders, sh_purchases, sh_suppliers
 *   CONSTRUCTION  cn_projects, cn_tenders, cn_boq, cn_materials, cn_equipment,
 *                 cn_subcontractors, cn_labor, cn_incidents
 *   (per-row field shapes are declared inline at each gen(...) call below — those
 *    shapes ARE the contract that module views read against.)
 *
 * BUSINESS RULES (the "why" a developer must preserve):
 *   - Idempotent: gen() no-ops if the store key already exists, so this runs on
 *     every boot without ever clobbering existing/edited data.
 *   - Deterministic: a fixed-seed PRNG makes the demo identical across reloads.
 *   - Referential integrity by construction: child rows reference parents via
 *     built ids, e.g. cn_boq.project = seq('CNP', n) points at a real cn_project;
 *     wa_production.project / it_timesheets.project follow the same convention.
 *   - Seeded `sales` here are already inside the seeded `financials` totals (see
 *     database.js) — do NOT re-roll them into financials.
 *   - STORE SHAPES ARE THE CONTRACT for all module views: change a field here
 *     and update docs/DATA_MODEL.md (and the reading view) too.
 *
 * PUBLIC API (window.EPAL.seedBD):
 *   EPAL.seedBD() -> void — seed all deep per-company stores (idempotent).
 *
 * ==> LARAVEL / PHP MAPPING: This is a set of database Seeders (one per store /
 *     module) wired into DatabaseSeeder, each using a deterministic Faker seed.
 *     Every store => an Eloquent Model + migration with the inline column shapes;
 *     the seq('CNP', n) parent references become real foreign keys. gen()'s
 *     "skip if exists" guard maps to seeders that check `Model::count()` (or rely
 *     on `migrate:fresh --seed`). This file has NO query/mutation API — it is
 *     pure seed data, so at the backend it is Seeders only, not a Service.
 * ==========================================================================*/

(function (EPAL) {
  'use strict';

  EPAL.seedBD = function () {
    var S = EPAL.store;

    /* deterministic PRNG (stable demo data across reloads) ------------------*/
    var a = 987654321;
    function rnd() { a |= 0; a = (a + 0x6D2B79F5) | 0; var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
    function ri(min, max) { return Math.floor(rnd() * (max - min + 1)) + min; }
    function pick(arr) { return arr[Math.floor(rnd() * arr.length)]; }
    // a date string inside the last 8 months (so monthly analytics fill up)
    function dt(monthsBack) {
      var mb = monthsBack != null ? monthsBack : ri(0, 7);
      var d = new Date(2026, 6 - mb, ri(1, 28));
      return d.toISOString().slice(0, 10);
    }
    function future(days) { var d = new Date(2026, 6, 2); d.setDate(d.getDate() + ri(3, days || 90)); return d.toISOString().slice(0, 10); }
    function phone() { return '+8801' + pick(['7', '8', '9', '3', '5']) + ri(10000000, 99999999); }
    function seq(prefix, n, w) { return prefix + '-' + String(n + 1).padStart(w || 4, '0'); }
    function gen(store, count, factory) {
      if (localStorage.getItem(S.namespace + store) !== null) return;   // seeded already
      var out = []; for (var i = 0; i < count; i++) out.push(factory(i));
      S.set(store, out);
    }

    /* ---- shared BD vocab ---------------------------------------------------*/
    var PEOPLE = ['Ashraful Karim','Nasrin Sultana','Mahmudul Hasan','Farzana Yasmin','Shafiqur Rahman',
      'Taslima Begum','Omar Faruk','Sharmin Jahan','Kamrul Islam','Rukhsana Parvin','Alamgir Hossain',
      'Mst. Salma Khatun','Rafiul Alam','Nazia Rahman','Delwar Mia','Ismat Ara','Touhidul Alam',
      'Sabina Yeasmin','Monirul Haque','Ayesha Siddiqua','Jashim Uddin','Rina Das','Habibur Sheikh','Shirin Akhter'];
    var CORPORATES = ['Bashundhara Group','Square Pharmaceuticals','Rahimafrooz','ACI Limited','PRAN-RFL Group',
      'Walton Hi-Tech','Akij Group','Navana Group','Concord Group','Shanta Holdings','Edison Group',
      'Runner Group','City Group','Abul Khair Group','Meghna Executive Holdings','Anwar Group'];
    var AREAS = ['Gulshan-2','Banani DOHS','Dhanmondi 27','Uttara Sector 7','Bashundhara R/A','Mirpur DOHS',
      'Baridhara Diplomatic Zone','Motijheel C/A','Tejgaon I/A','Mohakhali DOHS','Wari','Lalmatia'];
    var AIRLINES = ['Biman Bangladesh','US-Bangla','Air Astra','NovoAir','Emirates','Qatar Airways',
      'Saudia','Turkish Airlines','Singapore Airlines','Malaysia Airlines','flydubai','Salam Air'];
    var ROUTES = ['DAC → DXB','DAC → JED','DAC → KUL','DAC → SIN','DAC → BKK','DAC → IST','DAC → LHR',
      'DAC → DOH','DAC → RUH','DAC → MCT','DAC → CXB','DAC → ZYL','CGP → DXB','DAC → KTM'];
    var pay = function () { return pick(['Paid','Paid','Paid','Partial','Due']); };

    /* ========================== GROUP / SHARED ==============================*/
    // Bank accounts across the group (cash position widgets)
    gen('banks', 8, function (i) {
      var banks = [['City Bank','Gulshan Avenue'],['BRAC Bank','Banani'],['Dutch-Bangla','Uttara'],['Eastern Bank','Motijheel'],
        ['Prime Bank','Dhanmondi'],['Islami Bank','Mohakhali'],['Standard Chartered','Gulshan-1'],['bKash Merchant','—']];
      return { id: seq('BNK', i, 2), name: banks[i][0], branch: banks[i][1],
        account: '15' + ri(10000000, 99999999), companyId: pick(['group','travels','woodart','it','shop','construction']),
        balance: ri(4, 90) * 100000, created: dt(7) };
    });
    // CRM activities (calls/meetings against leads)
    gen('crm_activities', 60, function (i) {
      return { id: seq('ACT', i), type: pick(['Call','Email','Meeting','WhatsApp','Site Visit','Follow-up']),
        lead: pick(PEOPLE), company: pick(CORPORATES), by: pick(PEOPLE),
        note: pick(['Discussed requirements','Sent quotation','Negotiating price','Requested documents',
          'Scheduled demo','Waiting for budget approval','Interested — call next week']),
        outcome: pick(['Positive','Neutral','Positive','Needs follow-up']), date: dt(), created: dt() };
    });
    // Accounts journal entries per company (income/expense feed for Accounts modules)
    gen('acc_entries', 180, function (i) {
      var cid = pick(['travels','woodart','it','shop','construction']);
      var isIncome = rnd() > 0.45;
      var cats = isIncome
        ? { travels:['Ticket Sales','Visa Fees','Consultancy'], woodart:['Project Billing','Design Fee'],
            it:['Project Milestone','Subscription','Support Retainer'], shop:['Counter Sales','Online Sales'],
            construction:['IPC Certified','Mobilization Advance'] }[cid]
        : ['Office Rent','Salaries','Utilities','Fuel & Transport','Vendor Payment','Marketing','Equipment','Entertainment','Bank Charges'];
      return { id: seq('JV', i, 5), companyId: cid, kind: isIncome ? 'Income' : 'Expense',
        category: pick(cats), desc: pick(['—','Monthly','Client: ' + pick(CORPORATES),'Ref PO-' + ri(1000, 9999)]),
        amount: isIncome ? ri(20, 900) * 1000 : ri(5, 300) * 1000,
        method: pick(['Bank','Bank','Cash','bKash','Cheque']), date: dt(), created: dt() };
    });

    // Payable / receivable schedules per company (Accounts ▸ Schedules)
    gen('acc_schedules', 30, function (i) {
      var kind = rnd() > 0.5 ? 'Payable' : 'Receivable';
      return { id: seq('SCH', i, 3), companyId: pick(['travels','woodart','it','shop','construction']),
        party: kind === 'Payable' ? pick(['Galaxy GSA','BSRM Steels','Walton Distribution','Timber World BD','Data Center BD']) : pick(CORPORATES),
        kind: kind, amount: ri(20, 600) * 1000, due: rnd() > 0.35 ? future(60) : dt(1),
        status: pick(['Pending','Pending','Partial','Paid']), ref: 'INV-' + ri(1000, 9999), created: dt() };
    });
    // Seeded sales register (runtime postSale() appends to this same store; the
    // seeded rows are already reflected inside the seeded financials, so they
    // do NOT mutate financials here).
    gen('sales', 40, function (i) {
      var cid = pick(['travels','travels','woodart','it','shop','shop','construction']);
      var amount = ri(8, 700) * 1000, cost = Math.round(amount * (0.55 + rnd() * 0.3));
      return { id: seq('SL', i, 4), companyId: cid, date: dt(),
        amount: amount, cost: cost, profit: amount - cost,
        ref: pick(['TKT','ORD','WAP','ITP','CNP']) + '-' + ri(100, 999),
        desc: pick(['Air ticket sale','Visa processing','Interior milestone','Software milestone','Counter sale','IPC billing','Subscription renewal']),
        customer: rnd() > 0.5 ? pick(CORPORATES) : pick(PEOPLE), created: dt() };
    });

    /* ============================== TRAVELS =================================*/
    gen('tv_tickets', 48, function (i) {
      var cost = ri(28, 160) * 1000, sale = Math.round(cost * (1.06 + rnd() * 0.12));
      return { id: seq('TKT', i), pnr: pick(['ZX','QR','EK','BG','TK']) + ri(10000, 99999),
        passenger: pick(PEOPLE), phone: phone(), airline: pick(AIRLINES), route: pick(ROUTES),
        flightNo: pick(['BG','EK','QR','TK','US']) + ri(100, 999), travelDate: rnd() > 0.4 ? future(120) : dt(2),
        class: pick(['Economy','Economy','Economy','Business']), tripType: pick(['One-way','Round Trip','Round Trip']),
        vendor: pick(['Galaxy GSA','Zamzam Travels','Emirates GSA','GDS Aggregator BD','Sky Holidays']),
        cost: cost, sale: sale, payStatus: pay(),
        status: pick(['Issued','Issued','Issued','Hold','Re-issued','Refunded','Void']),
        agent: pick(PEOPLE), created: dt() };
    });
    gen('tv_contract_flights', 12, function (i) {
      var seats = ri(30, 180), sold = ri(5, seats);
      var costSeat = ri(38, 90) * 1000;
      return { id: seq('CF', i, 3), airline: pick(['Biman Bangladesh','Saudia','US-Bangla','flydubai','Salam Air']),
        flightNo: 'BG' + ri(1000, 9999), route: pick(['DAC → JED','DAC → MED','DAC → RUH','DAC → KUL','DAC → MCT']),
        category: pick(['Umrah','Umrah','Hajj','Worker','Tourist']), depDate: future(150),
        seats: seats, sold: sold, costSeat: costSeat, saleSeat: Math.round(costSeat * (1.1 + rnd() * 0.15)),
        vendor: pick(['Al-Haramain','Galaxy GSA','Zamzam Travels']),
        status: sold >= seats ? 'Sold Out' : pick(['Selling','Selling','Selling','Departed']), created: dt() };
    });
    /* Contract-SEAT SALES — reference the seeded flights so the CF sales ledger
       fills (idempotent via its own CF-ref guard; kept out of financials on purpose
       like the note above — the manage-sales view sums the sales store directly). */
    (function () {
      var salesList = S.list('sales');
      if (salesList.some(function (s) { return /^CF/i.test(String(s.ref || '')); })) return;
      var flights = S.list('tv_contract_flights');
      var buyers = ['Al-Madina Hajj Kafela', 'Baitullah Travels', 'Nur Umrah Group', 'Green Crescent Tours', 'Dhaka Hajj Mission', 'Salam Pilgrim Services', 'Makkah Express BD'];
      var add = [];
      flights.forEach(function (f, idx) {
        var soldLeft = +f.sold || 0; if (!soldLeft) return;
        var chunks = Math.min(3, Math.max(1, Math.round(soldLeft / 12)));
        for (var c = 0; c < chunks && soldLeft > 0; c++) {
          var qty = (c === chunks - 1) ? soldLeft : Math.max(1, Math.round((+f.sold || 0) / chunks));
          qty = Math.min(qty, soldLeft); soldLeft -= qty;
          var price = Math.round((+f.saleSeat || 0) * (0.98 + rnd() * 0.08));
          add.push({ id: 'SL-CF' + idx + '' + c + '' + ri(100, 999), companyId: 'travels', date: dt(ri(0, 5)),
            amount: qty * price, cost: qty * (+f.costSeat || 0), profit: qty * price - qty * (+f.costSeat || 0),
            ref: f.id, desc: 'Contract seats ' + f.route + ' (' + qty + '×)', customer: pick(buyers) });
        }
      });
      if (add.length) S.set('sales', salesList.concat(add));
    })();
    /* a couple of vendor-role ERP users (the directory the vendor-login flow writes to) */
    gen('erp_users', 3, function (i) {
      var v = [['Galaxy GSA', 'ops@galaxygsa.com', 'Ticketing'], ['Al-Haramain', 'accounts@alharamain.com', 'Hotel'], ['Zamzam Travels', 'desk@zamzam.com', 'Ticketing']][i];
      return { id: seq('USR', i, 3), name: v[0], email: v[1], role: 'vendor', scope: 'travels',
        partyType: 'vendor', designation: 'Vendor · ' + v[2], status: 'Active', createdAt: 0 };
    });
    gen('tv_agents', 14, function (i) {
      return { id: seq('AGT', i, 3), name: pick(PEOPLE), agency: pick(['Sky','Green','Metro','Royal','Delta','Prime']) + ' ' + pick(['Travels','Tours','Aviation','Holidays']),
        phone: phone(), location: pick(AREAS), commission: ri(2, 7), balance: ri(-5, 25) * 10000,
        totalSales: ri(5, 80) * 100000, status: pick(['Active','Active','Active','Inactive']), created: dt() };
    });
    gen('tv_portals', 6, function (i) {
      var p = [['Sabre GDS','GDS'],['Amadeus','GDS'],['VFS Global','Visa'],['Agoda Partner','Hotel Aggregator'],['IATA BSP','Settlement'],['TravelBoutique','Aggregator']][i];
      return { id: seq('PTL', i, 2), name: p[0], type: p[1], url: 'portal.' + p[0].toLowerCase().replace(/[^a-z]+/g, '') + '.com',
        balance: ri(1, 40) * 10000, autoSync: pick(['15 min','Hourly','Daily']), status: 'Connected', created: dt(6) };
    });
    gen('tv_files', 18, function (i) {
      var emb = ri(15, 45) * 1000, svc = ri(8, 25) * 1000;
      return { id: seq('FL', i, 3), applicant: pick(PEOPLE), passport: 'B' + ri(1000000, 9999999),
        country: pick(['Cyprus','Romania','Croatia','Malta','Serbia','Poland','Hungary']),
        agent: pick(PEOPLE), submitDate: dt(3), decisionDue: future(90),
        embassyStatus: pick(['Slot Booked','Submitted','Submitted','Decision Pending','Approved','Rejected']),
        embassyFee: emb, serviceFee: svc, total: emb + svc, payStatus: pay(), created: dt() };
    });
    gen('tv_passports', 20, function (i) {
      return { id: seq('PP', i), holder: pick(PEOPLE), passportNo: pick(['B','E','A']) + ri(1000000, 9999999),
        type: pick(['E-Passport','E-Passport','MRP','Official']), nationality: 'Bangladeshi',
        dob: (1970 + ri(0, 35)) + '-' + String(ri(1, 12)).padStart(2, '0') + '-' + String(ri(1, 28)).padStart(2, '0'),
        issueDate: dt(7), expiry: '20' + ri(26, 35) + '-' + String(ri(1, 12)).padStart(2, '0') + '-01',
        phone: phone(), created: dt() };
    });

    /* ============================== WOODART =================================*/
    gen('wa_projects', 16, function (i) {
      var value = ri(6, 120) * 100000;
      return { id: seq('WAP', i, 3),
        name: pick(['Apartment Interior','Office Fit-out','Showroom Design','Restaurant Interior','Penthouse Remodel','Duplex Interior','Bank Branch Fit-out']) + ' · ' + pick(AREAS),
        client: rnd() > 0.5 ? pick(CORPORATES) : pick(PEOPLE), type: pick(['Residential','Residential','Office','Retail','Restaurant']),
        area: ri(8, 60) * 100, value: value, cost: Math.round(value * (0.62 + rnd() * 0.15)),
        stage: pick(['Design','Design','Production','Production','Installation','Handover','Completed']),
        progress: ri(5, 100), start: dt(), deadline: future(180), designer: pick(PEOPLE), created: dt() };
    });
    gen('wa_estimates', 14, function (i) {
      return { id: seq('EST', i, 3), title: pick(['Kitchen Cabinets','Full Interior','Office Workstations','Wardrobe Package','False Ceiling & Lighting','Reception Desk']) + ' — ' + pick(AREAS),
        client: rnd() > 0.5 ? pick(CORPORATES) : pick(PEOPLE), items: ri(4, 28), value: ri(2, 60) * 100000,
        status: pick(['Draft','Sent','Sent','Approved','Approved','Rejected']), validTill: future(45), created: dt() };
    });
    /* Woodart CLIENTS — DERIVED, not invented. Every client here is a name that
     * actually appears on a Woodart project or estimate above, so the Clients
     * module's portfolio join finds real work against real people. Seeding a
     * fixed list instead would leave half the directory with zero projects and
     * half the projects with no client record, which reads like a broken join.
     * Classification is a stated rule, not a random pick: a corporate name
     * carrying "Group"/"Holdings" is a Developer, any other corporate name is a
     * Corporate, and an individual is a Homeowner. */
    if (localStorage.getItem(S.namespace + 'wa_clients') === null) {
      var waNames = {};
      S.list('wa_projects').forEach(function (p) { if (p.client) waNames[p.client] = 1; });
      S.list('wa_estimates').forEach(function (e) { if (e.client) waNames[e.client] = 1; });
      var waClients = Object.keys(waNames).sort().map(function (nm, i) {
        var corporate = CORPORATES.indexOf(nm) >= 0;
        var type = corporate ? (/Group|Holdings/.test(nm) ? 'Developer' : 'Corporate') : 'Homeowner';
        return { id: seq('CLI', i, 3), name: nm, type: type,
          contact: corporate ? pick(PEOPLE) : nm,
          phone: '+88017' + String(ri(10000000, 99999999)).slice(0, 8),
          email: nm.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '') + (corporate ? '@corp.example.bd' : '@mail.example.bd'),
          area: pick(AREAS), since: dt(ri(6, 30)), created: dt() };
      });
      S.set('wa_clients', waClients);
    }

    /* Woodart DESIGN DELIVERABLES — the architecture & 3D phase (owner, 2026-07-27:
     * "a project may have several phases, architecture or 3d modeling is one of
     * them"). DERIVED from real projects, like wa_clients and wa_vendors above,
     * so every drawing hangs off a project that exists and the register's join
     * finds real work. One project is deliberately left with no drawings at all
     * (the "not started" state has to be visible), and the last drawing points
     * at a project id that does not exist so the orphan path has real data. */
    if (localStorage.getItem(S.namespace + 'wa_drawings') === null) {
      var KINDS = ['Plan', 'Elevation', 'Section', 'Detail', '3D Model', 'Render'];
      var STATES = ['Approved', 'Issued', 'Commented', 'Draft', 'Approved', 'Issued'];
      var waProjects = S.list('wa_projects');
      var dwgs = [], rvns = [], n = 0, r = 0;
      waProjects.slice(0, 9).forEach(function (p, pi) {
        var count = 2 + (pi % 3);                       // 2..4 deliverables each
        for (var k = 0; k < count; k++) {
          var kind = KINDS[(pi + k) % KINDS.length];
          var status = STATES[(pi + k) % STATES.length];
          var revIdx = (pi + k) % 3;                    // A / B / C
          var rev = String.fromCharCode(65 + revIdx);
          var id = seq('DWG', n++, 3);
          dwgs.push({ id: id, project: p.id, title: kind + ' — ' + (p.name || '').split(' · ')[0],
            kind: kind, rev: rev, status: status, designer: p.designer || pick(PEOPLE),
            issued: status === 'Draft' ? null : dt(1),
            approved: status === 'Approved' ? dt() : null, created: dt(1) });
          /* the trail: one row per revision letter up to the current one */
          for (var q = 0; q <= revIdx; q++) {
            rvns.push({ id: seq('RVN', r++, 3), drawing: id, rev: String.fromCharCode(65 + q),
              action: q < revIdx ? 'Revised' : (status === 'Draft' ? 'Drafted' : status),
              by: p.designer || pick(PEOPLE),
              note: q < revIdx ? 'Client comments incorporated' : '',
              date: dt(1) });
          }
        }
      });
      /* an orphan — its project no longer exists. Kept and flagged, never hidden. */
      dwgs.push({ id: seq('DWG', n++, 3), project: 'WAP-999', title: '3D Model — Salvaged concept',
        kind: '3D Model', rev: 'A', status: 'Issued', designer: pick(PEOPLE),
        issued: dt(2), approved: null, created: dt(2) });
      S.set('wa_drawings', dwgs);
      S.set('wa_revisions', rvns);
    }

    gen('wa_materials', 22, function (i) {
      var mats = [['Marine Plywood 18mm','Board'],['Veneer Board','Board'],['MDF 12mm','Board'],['Formica Laminate','Laminate'],
        ['German Hinge (Hettich)','Hardware'],['Drawer Channel 18"','Hardware'],['SS Handle','Hardware'],['Wood Glue 5kg','Adhesive'],
        ['NC Lacquer','Finish'],['PU Polish','Finish'],['Fabric — Velvet','Fabric'],['Foam 4"','Fabric']];
      var m = mats[i % mats.length];
      return { id: seq('MAT', i, 3), name: m[0], category: m[1], unit: pick(['pcs','sheet','kg','litre','sft']),
        stock: ri(2, 220), reorder: ri(10, 40), unitCost: ri(120, 8500),
        supplier: pick(['Timber World BD','Hatil Trade','RFL Hardware','Akij Board','Partex Star']), created: dt() };
    });
    gen('wa_production', 12, function (i) {
      return { id: seq('JOB', i, 3), job: pick(['Cabinet carcass','Wardrobe shutters','Conference table','Wall paneling','Reception desk','Bed frame','TV unit']),
        project: seq('WAP', ri(0, 15), 3), station: pick(['CNC','Cutting','Edge Banding','Assembly','Finishing']),
        assignedTo: pick(PEOPLE), due: future(30), status: pick(['Queued','Running','Running','Done','Blocked']), created: dt(1) };
    });
    gen('wa_installs', 10, function (i) {
      return { id: seq('INS', i, 3), project: seq('WAP', ri(0, 15), 3), site: pick(AREAS),
        team: 'Team ' + pick(['Alpha','Bravo','Charlie','Delta']), date: rnd() > 0.5 ? future(30) : dt(1),
        status: pick(['Scheduled','In Progress','Snagging','Handover']), snags: ri(0, 6), created: dt(1) };
    });
    gen('wa_purchases', 12, function (i) {
      return { id: seq('WPO', i, 3), supplier: pick(['Timber World BD','Hatil Trade','RFL Hardware','Akij Board','Partex Star']),
        items: ri(2, 12), amount: ri(20, 400) * 1000, status: pick(['Ordered','Received','Received','Partial']), date: dt(), created: dt() };
    });

    /* Woodart VENDORS — DERIVED, exactly like wa_clients above. Every vendor
     * here is a supplier name that actually appears on a Woodart purchase order
     * or material line, so Procurement's spend roll-up finds real orders against
     * real vendors. A fixed invented list would leave half the directory with
     * zero spend and half the orders with no vendor record — which reads like a
     * broken join, not seed data. Category is taken from what they actually
     * supply (the material lines), falling back to General for a vendor who only
     * appears on purchase orders. */
    if (localStorage.getItem(S.namespace + 'wa_vendors') === null) {
      var vendorCat = {};
      S.list('wa_materials').forEach(function (m) {
        if (m.supplier && !vendorCat[m.supplier]) vendorCat[m.supplier] = m.category || 'General';
      });
      var vendorNames = {};
      S.list('wa_purchases').forEach(function (p) { if (p.supplier) vendorNames[p.supplier] = 1; });
      Object.keys(vendorCat).forEach(function (n) { vendorNames[n] = 1; });
      var waVendors = Object.keys(vendorNames).sort().map(function (nm, i) {
        return { id: seq('VEN', i, 3), name: nm, category: vendorCat[nm] || 'General',
          contact: pick(PEOPLE),
          phone: '+88018' + String(ri(10000000, 99999999)).slice(0, 8),
          email: nm.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '') + '@supply.example.bd',
          area: pick(AREAS), terms: pick(['Advance', 'Net 15', 'Net 30', 'Net 30', 'Net 45']),
          since: dt(ri(6, 30)), created: dt() };
      });
      S.set('wa_vendors', waVendors);
    }

    /* ========================================================================
     * WOODART — THREE REAL PROJECT STORIES (owner, 2026-07-27)
     * ------------------------------------------------------------------------
     * The generated data above is deliberately random: it fills every screen,
     * but no single project THREADS through the whole business, so you cannot
     * follow one job from the drawing board to the client's signature.
     *
     * These three do. Each sits at a different phase, so every module shows
     * something real at once, and every record cross-references the others by
     * the ids the modules actually join on:
     *
     *   WAP-101  Gulshan Penthouse   · DESIGN      — drawings out for approval,
     *            ৳48L                              BOQ quoted, first PO placed
     *   WAP-102  Square Pharma HQ    · PRODUCTION  — design signed off, goods
     *            ৳92L                              received, workshop running
     *   WAP-103  Dhanmondi Duplex    · HANDOVER    — everything done, snags
     *            ৳36.5L                            being closed out
     *
     * The BOQ lines quote the SAME material names the register carries, and the
     * purchase orders are raised on the SAME vendors — so Materials, Estimates
     * and Procurement agree with each other instead of each telling its own
     * random story. The budget for each project IS its BOQ: unit cost against
     * unit sale, line by line.
     *
     * Idempotent by design: guarded on WAP-101 already existing, and it APPENDS
     * to the generated lists rather than replacing them.
     * ====================================================================== */
    (function seedWoodartStories() {
      var projects = S.list('wa_projects');
      if (projects.some(function (p) { return p.id === 'WAP-101'; })) return;

      function add(store, rows) { S.set(store, S.list(store).concat(rows)); }

      /* ---- the three projects, each at a different phase ------------------ */
      add('wa_projects', [
        { id:'WAP-101', name:'Full Interior · Gulshan Penthouse', client:'Bashundhara Group',
          type:'Residential', area:4200, value:4800000, cost:3120000, stage:'Design',
          progress:18, start:'2026-06-08', deadline:'2026-11-20', designer:'Nasrin Sultana',
          created:'2026-06-08' },
        { id:'WAP-102', name:'Office Fit-out · Square Pharma HQ', client:'Square Pharmaceuticals',
          type:'Office', area:9800, value:9200000, cost:5980000, stage:'Production',
          progress:56, start:'2026-04-14', deadline:'2026-09-30', designer:'Touhidul Alam',
          created:'2026-04-14' },
        { id:'WAP-103', name:'Duplex Interior · Dhanmondi 27', client:'Ashraful Karim',
          type:'Residential', area:3100, value:3650000, cost:2372500, stage:'Handover',
          progress:96, start:'2026-02-02', deadline:'2026-07-18', designer:'Sharmin Jahan',
          created:'2026-02-02' }
      ]);

      /* ---- DESIGN & 3D — the architecture phase --------------------------
       * 101 is mid-approval (that is what a design-phase project looks like);
       * 102 and 103 are fully approved, so the phase gate has real examples of
       * "complete" as well as "still open". */
      add('wa_drawings', [
        { id:'DWG-101', project:'WAP-101', title:'Ground floor plan', kind:'Plan',
          rev:'B', status:'Approved', designer:'Nasrin Sultana', issued:'2026-06-16', approved:'2026-06-24', created:'2026-06-10' },
        { id:'DWG-102', project:'WAP-101', title:'Living room 3D model', kind:'3D Model',
          rev:'C', status:'Commented', designer:'Nasrin Sultana', issued:'2026-06-28', approved:null, created:'2026-06-12' },
        { id:'DWG-103', project:'WAP-101', title:'Master bedroom render', kind:'Render',
          rev:'A', status:'Issued', designer:'Farzana Yasmin', issued:'2026-06-22', approved:null, created:'2026-06-18' },
        { id:'DWG-104', project:'WAP-101', title:'Kitchen joinery detail', kind:'Detail',
          rev:'A', status:'Draft', designer:'Nasrin Sultana', issued:null, approved:null, created:'2026-07-01' },

        { id:'DWG-105', project:'WAP-102', title:'Floor plate layout', kind:'Plan',
          rev:'B', status:'Approved', designer:'Touhidul Alam', issued:'2026-04-22', approved:'2026-05-02', created:'2026-04-16' },
        { id:'DWG-106', project:'WAP-102', title:'Reception elevation', kind:'Elevation',
          rev:'A', status:'Approved', designer:'Touhidul Alam', issued:'2026-04-25', approved:'2026-05-02', created:'2026-04-18' },
        { id:'DWG-107', project:'WAP-102', title:'Boardroom 3D model', kind:'3D Model',
          rev:'B', status:'Approved', designer:'Farzana Yasmin', issued:'2026-05-04', approved:'2026-05-14', created:'2026-04-20' },

        { id:'DWG-108', project:'WAP-103', title:'Duplex plan — both levels', kind:'Plan',
          rev:'A', status:'Approved', designer:'Sharmin Jahan', issued:'2026-02-10', approved:'2026-02-18', created:'2026-02-04' },
        { id:'DWG-109', project:'WAP-103', title:'Staircase section', kind:'Section',
          rev:'B', status:'Approved', designer:'Sharmin Jahan', issued:'2026-02-24', approved:'2026-03-04', created:'2026-02-08' }
      ]);
      add('wa_revisions', [
        { id:'RVN-101', drawing:'DWG-101', rev:'A', action:'Revised',   by:'Nasrin Sultana', note:'Client wanted the study moved', date:'2026-06-14' },
        { id:'RVN-102', drawing:'DWG-101', rev:'B', action:'Approved',  by:'Nasrin Sultana', note:'', date:'2026-06-24' },
        { id:'RVN-103', drawing:'DWG-102', rev:'A', action:'Revised',   by:'Nasrin Sultana', note:'Ceiling height corrected', date:'2026-06-18' },
        { id:'RVN-104', drawing:'DWG-102', rev:'B', action:'Revised',   by:'Nasrin Sultana', note:'Veneer tone changed to walnut', date:'2026-06-25' },
        { id:'RVN-105', drawing:'DWG-102', rev:'C', action:'Commented', by:'Nasrin Sultana', note:'Client wants the TV wall reworked', date:'2026-07-02' },
        { id:'RVN-106', drawing:'DWG-103', rev:'A', action:'Issued',    by:'Farzana Yasmin', note:'', date:'2026-06-22' },
        { id:'RVN-107', drawing:'DWG-104', rev:'A', action:'Drafted',   by:'Nasrin Sultana', note:'', date:'2026-07-01' },
        { id:'RVN-108', drawing:'DWG-105', rev:'A', action:'Revised',   by:'Touhidul Alam',  note:'Extra workstation bay added', date:'2026-04-28' },
        { id:'RVN-109', drawing:'DWG-105', rev:'B', action:'Approved',  by:'Touhidul Alam',  note:'', date:'2026-05-02' },
        { id:'RVN-110', drawing:'DWG-106', rev:'A', action:'Approved',  by:'Touhidul Alam',  note:'', date:'2026-05-02' },
        { id:'RVN-111', drawing:'DWG-107', rev:'B', action:'Approved',  by:'Farzana Yasmin', note:'', date:'2026-05-14' },
        { id:'RVN-112', drawing:'DWG-108', rev:'A', action:'Approved',  by:'Sharmin Jahan',  note:'', date:'2026-02-18' },
        { id:'RVN-113', drawing:'DWG-109', rev:'B', action:'Approved',  by:'Sharmin Jahan',  note:'', date:'2026-03-04' }
      ]);

      /* ---- ESTIMATES / BOQ — this IS each project's budget -----------------
       * Every line quotes a material the register actually stocks, so the BOQ,
       * the purchase orders and the stock levels describe one business. */
      add('wa_estimates', [
        { id:'EST-101', title:'Full Interior — Gulshan Penthouse', client:'Bashundhara Group',
          projectId:'WAP-101', status:'Sent', validTill:'2026-08-15', created:'2026-06-12',
          lines:[
            { item:'Marine Plywood 18mm', qty:180, unitCost:3400, unitSale:4600 },
            { item:'Veneer Board',        qty:90,  unitCost:4200, unitSale:5900 },
            { item:'German Hinge (Hettich)', qty:320, unitCost:310, unitSale:480 },
            { item:'PU Polish',           qty:70,  unitCost:1420, unitSale:2050 },
            { item:'Fabric — Velvet',     qty:140, unitCost:420,  unitSale:690 }
          ] },
        { id:'EST-102', title:'Office Fit-out — Square Pharma HQ', client:'Square Pharmaceuticals',
          projectId:'WAP-102', status:'Approved', validTill:'2026-06-30', created:'2026-04-18',
          lines:[
            { item:'Marine Plywood 18mm', qty:420, unitCost:3400, unitSale:4500 },
            { item:'Formica Laminate',    qty:360, unitCost:1250, unitSale:1850 },
            { item:'MDF 12mm',            qty:210, unitCost:1850, unitSale:2600 },
            { item:'Drawer Channel 18"',  qty:260, unitCost:540,  unitSale:820 },
            { item:'SS Handle',           qty:480, unitCost:185,  unitSale:310 },
            { item:'NC Lacquer',          qty:120, unitCost:980,  unitSale:1480 }
          ] },
        { id:'EST-103', title:'Duplex Interior — Dhanmondi 27', client:'Ashraful Karim',
          projectId:'WAP-103', status:'Approved', validTill:'2026-03-31', created:'2026-02-06',
          lines:[
            { item:'Marine Plywood 18mm', qty:150, unitCost:3400, unitSale:4550 },
            { item:'Veneer Board',        qty:70,  unitCost:4200, unitSale:5800 },
            { item:'Wood Glue 5kg',       qty:40,  unitCost:760,  unitSale:1120 },
            { item:'Foam 4"',             qty:120, unitCost:260,  unitSale:430 }
          ] }
      ]);

      /* ---- PROCUREMENT — the buying that those BOQs required ---------------
       * 101 has one order placed and nothing delivered (design phase).
       * 102 has most of it received, one part-delivered.
       * 103 is fully received — the project is at handover. */
      add('wa_purchases', [
        { id:'WPO-101', supplier:'Timber World BD', items:5, amount:612000, status:'Ordered',  date:'2026-06-30', created:'2026-06-30' },
        { id:'WPO-102', supplier:'Akij Board',      items:6, amount:1428000, status:'Received', date:'2026-04-28', created:'2026-04-28' },
        { id:'WPO-103', supplier:'RFL Hardware',    items:4, amount:229000, status:'Received', date:'2026-05-12', created:'2026-05-12' },
        { id:'WPO-104', supplier:'Partex Star',     items:3, amount:388500, status:'Partial',  date:'2026-06-16', created:'2026-06-16' },
        { id:'WPO-105', supplier:'Timber World BD', items:4, amount:510000, status:'Received', date:'2026-02-20', created:'2026-02-20' },
        { id:'WPO-106', supplier:'Hatil Trade',     items:2, amount:31200,  status:'Received', date:'2026-03-08', created:'2026-03-08' }
      ]);

      /* ---- WORKSHOP — 102 is the project actually on the floor ------------- */
      add('wa_production', [
        { id:'JOB-101', job:'Reception desk carcass', project:'WAP-102', station:'CNC',
          assignedTo:'Omar Faruk',     due:'2026-07-10', status:'Running', created:'2026-06-20' },
        { id:'JOB-102', job:'Workstation tops',       project:'WAP-102', station:'Cutting',
          assignedTo:'Delwar Mia',     due:'2026-07-14', status:'Running', created:'2026-06-22' },
        { id:'JOB-103', job:'Storage unit shutters',  project:'WAP-102', station:'Edge Banding',
          assignedTo:'Kamrul Islam',   due:'2026-06-30', status:'Blocked', created:'2026-06-18' },
        { id:'JOB-104', job:'Boardroom table',        project:'WAP-102', station:'Assembly',
          assignedTo:'Mahmudul Hasan', due:'2026-06-24', status:'Done',    created:'2026-06-02' },
        { id:'JOB-105', job:'Panelling — lobby',      project:'WAP-102', station:'Finishing',
          assignedTo:'Jashim Uddin',   due:'2026-07-22', status:'Queued',  created:'2026-06-26' },
        { id:'JOB-106', job:'Wardrobe shutters',      project:'WAP-103', station:'Finishing',
          assignedTo:'Kamrul Islam',   due:'2026-06-20', status:'Done',    created:'2026-05-28' },
        { id:'JOB-107', job:'Staircase handrail',     project:'WAP-103', station:'Assembly',
          assignedTo:'Omar Faruk',     due:'2026-06-26', status:'Done',    created:'2026-06-01' }
      ]);

      /* ---- SITE & INSTALL — 103 is being handed over ----------------------- */
      add('wa_installs', [
        { id:'INS-101', project:'WAP-102', site:'Tejgaon I/A', team:'Team Alpha',
          date:'2026-08-04', status:'Scheduled', snags:0, created:'2026-06-28' },
        { id:'INS-102', project:'WAP-103', site:'Dhanmondi 27', team:'Team Bravo',
          date:'2026-06-28', status:'Snagging', snags:2, created:'2026-06-10',
          snagList:[
            { text:'Wardrobe shutter alignment — master bedroom', done:false },
            { text:'Polish touch-up on staircase handrail',       done:false },
            { text:'Skirting gap in the living room',             done:true },
            { text:'Drawer channel replaced — kitchen unit 3',    done:true }
          ] },
        { id:'INS-103', project:'WAP-103', site:'Dhanmondi 27', team:'Team Bravo',
          date:'2026-05-30', status:'Handover', snags:0, created:'2026-05-20' }
      ]);

      /* ---- WOODART OPERATING EXPENSES — what the phases actually cost ------
       * Booked in the same `acc_entries` register Master Accounts reads, so
       * these show up in the Woodart books rather than only in this story. */
      add('acc_entries', [
        { id:'JV-WA101', companyId:'woodart', kind:'Expense', category:'Fuel & Transport',
          desc:'Site survey — Gulshan (WAP-101)', amount:14500, method:'Cash', date:'2026-06-10', created:'2026-06-10' },
        { id:'JV-WA102', companyId:'woodart', kind:'Expense', category:'Salaries',
          desc:'Design team — June', amount:385000, method:'Bank', date:'2026-06-30', created:'2026-06-30' },
        { id:'JV-WA103', companyId:'woodart', kind:'Expense', category:'Vendor Payment',
          desc:'Akij Board — against WPO-102', amount:1428000, method:'Bank', date:'2026-05-06', created:'2026-05-06' },
        { id:'JV-WA104', companyId:'woodart', kind:'Expense', category:'Fuel & Transport',
          desc:'Delivery to site — WAP-103', amount:26800, method:'Cash', date:'2026-06-12', created:'2026-06-12' },
        { id:'JV-WA105', companyId:'woodart', kind:'Expense', category:'Office Rent',
          desc:'Workshop — Tejgaon, June', amount:180000, method:'Bank', date:'2026-06-05', created:'2026-06-05' },
        { id:'JV-WA106', companyId:'woodart', kind:'Expense', category:'Utilities',
          desc:'Workshop power — June', amount:64200, method:'Bank', date:'2026-07-02', created:'2026-07-02' },
        { id:'JV-WA107', companyId:'woodart', kind:'Income', category:'Design Fee',
          desc:'Concept + 3D — Bashundhara Group (WAP-101)', amount:320000, method:'Bank', date:'2026-06-26', created:'2026-06-26' },
        { id:'JV-WA108', companyId:'woodart', kind:'Income', category:'Project Billing',
          desc:'Stage 2 — Square Pharmaceuticals (WAP-102)', amount:3600000, method:'Bank', date:'2026-06-18', created:'2026-06-18' }
      ]);

      /* ---- STOCK, made consistent with the story --------------------------
       * WPO-102/103/105/106 were RECEIVED and WAP-102/103 consumed most of it,
       * so the items those BOQs lean on are the ones running low. This is what
       * puts real entries on the Materials → Reorder tab instead of leaving it
       * an empty state nobody has seen. */
      var lowAfterUse = { 'Marine Plywood 18mm':26, 'Formica Laminate':18, 'MDF 12mm':9,
                          'Drawer Channel 18"':34, 'NC Lacquer':11 };
      var mats = S.list('wa_materials').map(function (m) {
        if (Object.prototype.hasOwnProperty.call(lowAfterUse, m.name)) {
          m = Object.assign({}, m, { stock: lowAfterUse[m.name] });
        }
        return m;
      });
      S.set('wa_materials', mats);
    })();

    /* ============================ IT SOLUTIONS ==============================*/
    gen('it_projects', 14, function (i) {
      var value = ri(3, 80) * 100000;
      return { id: seq('ITP', i, 3),
        name: pick(['ERP System','E-commerce Platform','Corporate Website','Mobile App','HR Portal','POS Integration','Data Migration','Cloud Setup']) + ' — ' + pick(CORPORATES),
        client: pick(CORPORATES), type: pick(['Web','Web','ERP','Mobile','Cloud','AMC']),
        value: value, cost: Math.round(value * (0.45 + rnd() * 0.2)),
        stage: pick(['Discovery','Development','Development','Testing','UAT','Live','Maintenance']),
        progress: ri(10, 100), lead: pick(PEOPLE), deadline: future(150), created: dt() };
    });
    gen('it_subscriptions', 16, function (i) {
      return { id: seq('SUB', i, 3), product: pick(['Epal HRM Cloud','Epal POS','Epal School Suite','Hosting + Care Plan','Epal Books']),
        client: pick(CORPORATES), plan: pick(['Basic','Pro','Pro','Enterprise']), mrr: ri(5, 120) * 1000,
        startDate: dt(), renewal: future(200), status: pick(['Active','Active','Active','Past Due','Cancelled']), created: dt() };
    });
    gen('it_tickets', 24, function (i) {
      return { id: seq('TIC', i), subject: pick(['Login failure','Report not generating','Payment gateway error','Slow dashboard','Data mismatch','Feature request: export','Server down alert','Email not sending']),
        client: pick(CORPORATES), priority: pick(['Urgent','High','Medium','Medium','Low']),
        assignee: pick(PEOPLE), slaHours: pick([4, 8, 24, 48]),
        status: pick(['Open','In Progress','In Progress','Waiting','Resolved','Closed']), created: dt(1) };
    });
    gen('it_timesheets', 30, function (i) {
      return { id: seq('TS', i), employee: pick(PEOPLE), project: seq('ITP', ri(0, 13), 3),
        date: dt(1), hours: ri(2, 9), billable: pick(['Yes','Yes','Yes','No']),
        note: pick(['API development','Bug fixing','Client meeting','UI design','Testing','Deployment']), created: dt(1) };
    });
    gen('it_contracts', 10, function (i) {
      return { id: seq('CON', i, 3), client: pick(CORPORATES), type: pick(['AMC','AMC','SLA','License','NDA']),
        value: ri(1, 30) * 100000, startDate: dt(7), endDate: future(300),
        status: pick(['Active','Active','Active','Expiring','Expired']), created: dt() };
    });

    /* ================================ SHOP ==================================*/
    gen('sh_products', 26, function (i) {
      var prods = [['Walton Smart TV 43"','Electronics','Walton'],['Vision Blender','Appliance','Vision'],['Gazi Fan 56"','Appliance','Gazi'],
        ['Symphony Z60','Mobile','Symphony'],['RFL Chair Deluxe','Furniture','RFL'],['Bata Formal Shoe','Footwear','Bata'],
        ['Aarong Panjabi','Clothing','Aarong'],['Cute Detergent 1kg','Grocery','Square'],['Fresh Soyabean Oil 5L','Grocery','Meghna'],
        ['Panasonic Rice Cooker','Appliance','Panasonic'],['Havit Keyboard','Electronics','Havit'],['Realme Buds','Electronics','Realme'],
        ['LED Bulb 12W','Electronics','Energypac']];
      var p = prods[i % prods.length];
      var costPrice = ri(180, 42000);
      return { id: seq('PRD', i), name: p[0] + (i >= prods.length ? ' (' + pick(['Black','Silver','Blue','XL']) + ')' : ''),
        sku: 'SKU' + ri(10000, 99999), category: p[1], brand: p[2], unit: 'pcs',
        costPrice: costPrice, salePrice: Math.round(costPrice * (1.12 + rnd() * 0.28)),
        stock: ri(0, 140), reorder: ri(5, 20), status: 'Active', created: dt() };
    });
    gen('sh_orders', 36, function (i) {
      return { id: seq('ORD', i), customer: pick(PEOPLE), phone: phone(),
        items: ri(1, 8), amount: ri(3, 600) * 100, channel: pick(['Counter','Counter','Online','Facebook']),
        payMethod: pick(['Cash','Cash','bKash','Nagad','Card']),
        status: pick(['Completed','Completed','Completed','Processing','Delivered','Returned']), date: dt(), created: dt() };
    });
    gen('sh_purchases', 14, function (i) {
      return { id: seq('SPO', i, 3), supplier: pick(['Walton Distribution','RFL Depot','Square Wholesale','Meghna Traders','City Traders']),
        items: ri(3, 30), amount: ri(30, 800) * 1000, status: pick(['Ordered','Received','Received','Partial']), date: dt(), created: dt() };
    });
    gen('sh_suppliers', 8, function (i) {
      var sup = ['Walton Distribution','RFL Depot','Square Wholesale','Meghna Traders','City Traders','Akij Essentials','Pran Dealer Point','Vision Emporium'][i];
      return { id: seq('SUP', i, 2), name: sup, contact: pick(PEOPLE), phone: phone(),
        category: pick(['Electronics','Grocery','Appliance','Furniture','Mixed']),
        balance: ri(-4, 20) * 10000, terms: pick(['Cash','Net 7','Net 15','Net 30']), created: dt(6) };
    });

    /* ============================ CONSTRUCTION ==============================*/
    gen('cn_projects', 10, function (i) {
      var value = ri(80, 900) * 100000;
      return { id: seq('CNP', i, 3),
        name: pick(['6-Storey Commercial Building','Residential Tower (10F)','Warehouse Shed','Factory Extension','School Building','Mosque Complex','Road & Drainage Works']) + ' · ' + pick(['Uttara','Purbachal','Savar','Gazipur','Narayanganj','Keraniganj','Tongi']),
        client: rnd() > 0.4 ? pick(CORPORATES) : pick(['LGED','PWD','RAJUK','City Corporation']),
        value: value, cost: Math.round(value * (0.7 + rnd() * 0.14)), progress: ri(5, 95),
        stage: pick(['Mobilization','Structure','Structure','Finishing','Handover','On Hold']),
        start: dt(), deadline: future(400), engineer: pick(PEOPLE), created: dt() };
    });
    gen('cn_tenders', 10, function (i) {
      return { id: seq('TND', i, 3), title: pick(['Bridge Approach Road','Govt. Office Renovation','Hospital Extension','University Dormitory','Drainage Network','Boundary Wall & Gate']) + ' — ' + pick(['LGED','PWD','RHD','DPHE','EED']),
        authority: pick(['LGED','PWD','RHD','DPHE','Education Engineering Dept']), value: ri(50, 1200) * 100000,
        submission: rnd() > 0.5 ? future(40) : dt(2), emd: ri(1, 20) * 100000,
        status: pick(['Preparing','Submitted','Submitted','Won','Lost']), created: dt() };
    });
    gen('cn_boq', 24, function (i) {
      var items = [['Earthwork Excavation','cum','Civil'],['RCC (1:1.5:3)','cum','Civil'],['Brick Work 10"','cum','Civil'],
        ['MS Rod (60 Grade)','ton','Civil'],['Plaster (1:4)','sqm','Civil'],['Tiles Fitting','sqm','Finishing'],
        ['Distribution Board','pcs','Electrical'],['Wiring — BRB 2.5mm','point','Electrical'],['GI Pipe 1"','rft','Plumbing'],
        ['Sanitary Fixture Set','set','Plumbing'],['Weather Coat Paint','sqm','Finishing'],['Thai Aluminium Window','sqm','Finishing']];
      var it = items[i % items.length];
      var qty = ri(10, 800), rate = ri(150, 90000);
      return { id: seq('BOQ', i), project: seq('CNP', ri(0, 9), 3), item: it[0], unit: it[1],
        category: it[2], qty: qty, rate: rate, amount: qty * rate, created: dt() };
    });
    gen('cn_materials', 16, function (i) {
      var mats = [['Cement (Shah)','bag'],['MS Rod 16mm (BSRM)','ton'],['Brick (1st Class)','pcs'],['Sand (Sylhet)','cft'],
        ['Stone Chips','cft'],['Bitumen Drum','drum'],['Paint (Berger)','gallon'],['GI Wire','kg']];
      var m = mats[i % mats.length];
      return { id: seq('CMT', i, 3), name: m[0], unit: m[1], stock: ri(20, 2000), reorder: ri(50, 300),
        unitCost: ri(8, 95000), site: seq('CNP', ri(0, 9), 3),
        supplier: pick(['BSRM Steels','Shah Cement Depot','Metro Traders','Sylhet Sand Suppliers']), created: dt() };
    });
    gen('cn_equipment', 10, function (i) {
      var eq = ['Concrete Mixer','Tower Crane','Excavator (Volvo)','Vibrator Roller','Generator 250kVA','Bar Bending Machine','Dump Truck','Batching Plant','Pile Rig','Winch Machine'][i];
      return { id: seq('EQP', i, 3), name: eq, type: pick(['Owned','Owned','Rented']), site: seq('CNP', ri(0, 9), 3),
        status: pick(['Working','Working','Working','Idle','Maintenance']), utilization: ri(30, 95),
        nextService: future(90), created: dt(6) };
    });
    gen('cn_subcontractors', 10, function (i) {
      var cv = ri(5, 120) * 100000;
      return { id: seq('SUBC', i, 3), name: pick(PEOPLE) + ' & Sons', trade: pick(['Rod Binding','Shuttering','Brick Work','Electrical','Sanitary','Painting','Tiles','Thai & Glass']),
        site: seq('CNP', ri(0, 9), 3), contractValue: cv, paid: Math.round(cv * rnd() * 0.9),
        status: pick(['Active','Active','Active','Completed']), created: dt() };
    });
    gen('cn_labor', 20, function (i) {
      return { id: seq('LBR', i, 3), name: pick(PEOPLE), trade: pick(['Mason','Helper','Rod Binder','Carpenter','Electrician','Painter','Operator']),
        site: seq('CNP', ri(0, 9), 3), wage: ri(600, 1400), present: ri(16, 26), absent: ri(0, 6),
        status: pick(['Active','Active','Active','Left']), created: dt() };
    });
    gen('cn_incidents', 8, function (i) {
      return { id: seq('HSE', i, 3), site: seq('CNP', ri(0, 9), 3),
        type: pick(['Near Miss','Near Miss','First Aid','Injury','Property Damage']),
        severity: pick(['Low','Low','Medium','High']), date: dt(2),
        status: pick(['Closed','Closed','Investigating','Open']),
        note: pick(['Scaffolding plank slipped','Nail injury — first aid given','Crane load swing near workers','Formwork collapse (minor)','Worker without helmet warned']), created: dt(2) };
    });
  };

})(window.EPAL = window.EPAL || {});
