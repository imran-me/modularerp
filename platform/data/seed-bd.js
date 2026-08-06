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

    /* ========================================================================
     * ONE-TIME INTERIOR RESET (owner, 2026-08-06)
     * ------------------------------------------------------------------------
     * A seed is written once and never again — that is what makes it safe to
     * ship next to live data. But the Interior demo has just been replaced
     * wholesale (16 random projects + 3 story projects → the single Munshi
     * Villa job), and a browser that already holds the old rows would never see
     * it: every block below is guarded on "has this store ever been written".
     *
     * So the reset is versioned. When the marker does not match, every `wa_*`
     * store is dropped and every woodart row is removed from the three SHARED
     * money stores, and the blocks below rebuild them from scratch. It runs
     * exactly once per version, and it touches nothing belonging to Travels,
     * IT, Shop, Construction or the Group — "interior only", literally.
     *
     * Bump WA_DEMO_VERSION to force the next reset. Do not reuse a version
     * string: a browser that already ran it will skip it.
     * ====================================================================== */
    var WA_DEMO_VERSION = 'munshi-villa-v1';
    if (S.get('wa.demo.version', null) !== WA_DEMO_VERSION) {
      Object.keys(localStorage)
        .filter(function (k) { return k.indexOf(S.namespace + 'wa_') === 0; })
        .forEach(function (k) { localStorage.removeItem(k); });

      ['acc_entries', 'acc_schedules', 'sales'].forEach(function (store) {
        if (localStorage.getItem(S.namespace + store) === null) return;
        S.set(store, S.list(store).filter(function (r) { return r.companyId !== 'woodart'; }));
      });

      /* Interiors must own a bank account (PROJECT-PROFILE-PLAN §7). If the old
       * random draw left it with none, give it the one the fixed list assigns
       * rather than re-seeding every company's banks over it. */
      var bk = S.list('banks');
      if (bk.length > 2 && !bk.some(function (b) { return b.companyId === 'woodart'; })) {
        bk[2].companyId = 'woodart';
        S.set('banks', bk);
      }

      S.set('wa.demo.version', WA_DEMO_VERSION);
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
      /* Ownership is FIXED, not picked at random: Interiors was given its own
       * account (PROJECT-PROFILE-PLAN §7), and a random draw could leave it
       * with three accounts or none. */
      var bankOwner = ['group','travels','woodart','it','shop','construction','travels','group'];
      return { id: seq('BNK', i, 2), name: banks[i][0], branch: banks[i][1],
        account: '15' + ri(10000000, 99999999), companyId: bankOwner[i],
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
    /* Accounts journal entries per company (income/expense feed for Accounts
     * modules).
     *
     * ⚠️ WOODART IS DELIBERATELY ABSENT from this random feed (owner,
     * 2026-08-06: "remove demo data from interior only"). Interior's books are
     * authored from the Munshi Villa sheet further down, so a random ৳4L
     * "Project Billing" here would reference no project and quietly break the
     * one thing that section exists to prove: every taka traces to the job. */
    gen('acc_entries', 180, function (i) {
      var cid = pick(['travels','it','shop','construction']);
      var isIncome = rnd() > 0.45;
      var cats = isIncome
        ? { travels:['Ticket Sales','Visa Fees','Consultancy'],
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
      /* woodart excluded — its two payables and one receivable are authored
         against the villa's own orders (see THE VILLA'S MONEY below). */
      return { id: seq('SCH', i, 3), companyId: pick(['travels','it','shop','construction']),
        party: kind === 'Payable' ? pick(['Galaxy GSA','BSRM Steels','Walton Distribution','Timber World BD','Data Center BD']) : pick(CORPORATES),
        kind: kind, amount: ri(20, 600) * 1000, due: rnd() > 0.35 ? future(60) : dt(1),
        status: pick(['Pending','Pending','Partial','Paid']), ref: 'INV-' + ri(1000, 9999), created: dt() };
    });
    // Seeded sales register (runtime postSale() appends to this same store; the
    // seeded rows are already reflected inside the seeded financials, so they
    // do NOT mutate financials here).
    gen('sales', 40, function (i) {
      /* woodart excluded — its three sales ARE the client's three payments. */
      var cid = pick(['travels','travels','it','shop','shop','construction']);
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

    /* ========================================================================
     * WOODART — ONE PROJECT, THREADED THROUGH THE WHOLE CONCERN
     * (owner, 2026-08-06: "remove demo data from interior only, and make only
     *  one demo project across all the system of interior, in different phase,
     *  related fields")
     * ------------------------------------------------------------------------
     * Interior used to carry 16 randomly generated projects PLUS three hand-
     * written "story" projects. It now carries exactly ONE — Munshi Villa
     * Duplex — and every record in every Woodart module hangs off it: spaces,
     * phases, drawings, BOQ, per-head budgets, purchase orders, stock movements,
     * workshop jobs, site visits, income, expenses and schedules. Open any
     * Interior screen and you are looking at the same job.
     *
     * THE NUMBERS ARE REAL. They come from companies/woodart/Assets/
     * MUNSHI-VILLA-SHEET.md — the analysis of the spreadsheet the business runs
     * this project on today:
     *
     *     contract               ৳70,00,000
     *     received (3 payments)  ৳40,00,000    10L + 20L + 10L
     *     still to collect       ৳30,00,000
     *     spent to date          ৳23,48,257    the 13 heads in WA_SPENT below,
     *                                          which sum to exactly that figure
     *
     * WHAT IS THE SHEET AND WHAT IS NOT: the contract, the three receipts, the
     * spend per head, and six of the budgets are the sheet's own figures. Room
     * names, areas, drawing titles, and budgets for the heads the sheet leaves
     * blank are demo detail — the sheet carries no room schedule.
     *
     * THE PHASES THE SHEET LEAVES EMPTY ARE THE POINT. Tiles · Paint · Metal ·
     * Aluminium · Wood Work sit in its summary with no rows because the project
     * has not reached them (sheet §3a). They are seeded as `Not started` phases,
     * so the Phase Board shows exactly what the spreadsheet shows.
     * ====================================================================== */

    /* THE SCOPE OF WORK — the single source for BOTH the BOQ and the per-head
     * budget, so a budget can never disagree with the quotation it came from.
     *
     *     [ cost code, line item, qty, unit, unit cost, kind ]
     *
     * Cost codes are ids from wa_cost_codes above: one vocabulary for the
     * estimate, the purchase order and the expense (PROJECT-PROFILE-PLAN §2).
     *
     * KIND is what makes the bill honest. A `material` line names a material in
     * the register EXACTLY, so Estimates › Bill of Materials resolves it and
     * `books.mjs refs` fails if a name is ever mistyped. A `work` line prices
     * labour or a contract — nobody stocks a rajmistri — and is exempt from
     * that check by design rather than by accident. */
    /* The markup that turns the costed scope into the ৳70,00,000 the client
     * signed for. It is a constant rather than 24 typed sale prices so the
     * quotation can never drift from the contract by more than per-line
     * rounding (it lands within ৳1,000 of it). */
    var WA_MARKUP = 1.1492;
    var WA_WORK = [
      ['3D & Visualisation', '3D design, walkthrough & drawings',     1, 'lot',      50000, 'work'],
      ['Soil & Excavation',  'Soil excavation, cutting & fill',       1, 'lot',      75000, 'work'],
      ['Bricks & Breaking',  'Bricks (1st class)',                37500, 'pcs',         12, 'material'],
      ['Cement',             'Cement — 50 kg bag',                  550, 'bag',        545, 'material'],
      ['Rod',                'Rod — BSRM 60 grade',               10000, 'kg',          85, 'material'],
      ['Sand & Bali',        'Sand & bali',                        4000, 'cft',         65, 'material'],
      ['Contractor',         'Rajmistri contract — Younus Mia',       1, 'lot',    1344000, 'work'],
      ['Electrical',         'Electrical points & wiring',          120, 'point',     2900, 'work'],
      ['Sanitary',           'Sanitary & plumbing set',               5, 'set',      80000, 'work'],
      ['Tiles Work',         'Floor & wall tiles — supply & lay',  2000, 'sft',        160, 'work'],
      ['Paint',              'Putty, primer & paint',              6000, 'sft',         30, 'work'],
      ['Aluminium',          'Aluminium windows & glazing',         400, 'sft',        400, 'work'],
      ['Metal',              'MS railing & grill',                   60, 'rft',       1500, 'work'],
      ['Wood Work',          'Joinery labour & site fitting',         1, 'lot',     350000, 'work'],
      ['Boards & Ply',       'Marine Plywood 18mm',                  90, 'sheet',     3610, 'material'],
      ['Boards & Ply',       'Veneer Board',                         30, 'sheet',     4200, 'material'],
      ['Laminates & Veneer', 'Formica Laminate',                     45, 'sheet',     1250, 'material'],
      ['Hardware',           'German Hinge (Hettich)',              200, 'pcs',        335, 'material'],
      ['Hardware',           'Drawer Channel 18"',                   70, 'pcs',        540, 'material'],
      ['Hardware',           'SS Handle',                           110, 'pcs',        185, 'material'],
      ['Finishes',           'NC Lacquer',                           30, 'litre',     1065, 'material'],
      ['Extra Labour',       'Extra labour — call-outs',              1, 'lot',      60000, 'work'],
      ['Transport & Visit',  'Transport & site visits',               1, 'lot',     100000, 'work'],
      ['Other Expense',      'Extra / others',                        1, 'lot',      90215, 'work']
    ];

    /* The BOQ lines and the budgeted cost, computed from ONE table so no
     * arithmetic can drift between the quotation, the budget and the project. */
    var waBoqLines = WA_WORK.map(function (w) {
      return { item: w[1], qty: w[2], unit: w[3], unitCost: w[4],
               unitSale: Math.round(w[4] * WA_MARKUP), code: w[0], kind: w[5] };
    });
    var waBudget = waBoqLines.reduce(function (t, l) { return t + l.qty * l.unitCost; }, 0);
    var waQuoted = waBoqLines.reduce(function (t, l) { return t + l.qty * l.unitSale; }, 0);

    gen('wa_projects', 1, function () {
      return { id: 'WAP-101', companyId: 'woodart',
        name: 'Munshi Villa Duplex — build & full interior', client: 'Munshi Billah',
        type: 'Residential', area: 2520,
        value: 7000000,            /* the contract, from the sheet            */
        cost: waBudget,            /* the budget, from the scope of work      */
        stage: 'Production',       /* civil done, services running, joinery next */
        progress: 42, start: '2026-02-27', deadline: '2026-11-30',
        designer: 'Imtiaz Chowdhury', created: '2026-02-20' };
    });

    /* ONE approved BOQ. `project` (not `projectId`) is the field every reader
     * joins on — Accounts' Project P&L, the budget derivation and the Estimates
     * seam all use it. */
    gen('wa_estimates', 1, function () {
      return { id: 'EST-101', companyId: 'woodart',
        title: 'Munshi Villa Duplex — bill of quantities', client: 'Munshi Billah',
        project: 'WAP-101', status: 'Approved', validTill: '2026-12-31',
        items: waBoqLines.length, value: waQuoted, cost: waBudget,
        lines: waBoqLines, created: '2026-02-24' };
    });
    /* Woodart COST CONTROL — codes, per-code budgets and phases.
     *
     * MIRRORS the backend CostCodeSeeder / BudgetSeeder exactly, so demo mode
     * and a migrated host describe ONE cost structure. See
     * companies/woodart/PROJECT-PROFILE-PLAN.md and Assets/MUNSHI-VILLA-SHEET.md.
     *
     * The code list is derived from the REAL working spreadsheet, so it spans a
     * job WITH civil work and one that is pure joinery. `kind:'overhead'`
     * separates site costs from work packages — mixing them manufactures
     * overruns that never happened. */
    if (localStorage.getItem(S.namespace + 'wa_cost_codes') === null) {
      var WA_CODES = [
        ['Design Fee','Design & Consultancy','Design','direct'],
        ['3D & Visualisation','3D Design / Visualisation','Design','direct'],
        ['Drawings & Approval','Drawings & Approvals','Design','direct'],
        ['Bricks & Breaking','Bricks & Breaking','Structure','direct'],
        ['Cement','Cement','Structure','direct'],
        ['Rod','Steel / Rod','Structure','direct'],
        ['Sand & Bali','Sand / Bali','Structure','direct'],
        ['Soil & Excavation','Soil Excavation & Fill','Structure','direct'],
        ['Boards & Ply','Boards, Ply & MDF','Joinery','direct'],
        ['Laminates & Veneer','Laminates & Veneer','Joinery','direct'],
        ['Hardware','Hardware & Fittings','Joinery','direct'],
        ['Adhesives','Adhesives & Consumables','Joinery','direct'],
        ['Finishes','Lacquer, Polish & Finish','Joinery','direct'],
        ['Fabric & Foam','Fabric, Foam & Upholstery','Joinery','direct'],
        ['Wood Work','Wood Work (contracted)','Joinery','direct'],
        ['Electrical','Electrical','Services','direct'],
        ['Sanitary','Sanitary & Plumbing','Services','direct'],
        ['HVAC','HVAC & Ventilation','Services','direct'],
        ['Tiles Work','Tiles & Stone','Finishes','direct'],
        ['Paint','Paint & Wall Finish','Finishes','direct'],
        ['Metal','Metal Work','Finishes','direct'],
        ['Aluminium','Aluminium & Glazing','Finishes','direct'],
        ['False Ceiling','False Ceiling','Finishes','direct'],
        ['Contractor','Contractor (Rajmistri)','Site','direct'],
        ['Extra Labour','Extra Labour','Site','direct'],
        ['Installation','Delivery & Installation','Site','direct'],
        ['Transport & Visit','Transport & Site Visits','Overheads','overhead'],
        ['Site Expense','Site Allowance & Sundries','Overheads','overhead'],
        ['Vendor Payment','Vendor Payment (on account)','Overheads','overhead'],
        ['Salaries','Salaries','Overheads','overhead'],
        ['Office Rent','Workshop / Office Rent','Overheads','overhead'],
        ['Utilities','Utilities','Overheads','overhead'],
        ['Tools & Equipment','Tools & Equipment','Overheads','overhead'],
        ['Other Expense','Extra / Others','Overheads','overhead']
      ];
      S.set('wa_cost_codes', WA_CODES.map(function (c, i) {
        return { id: c[0], code: c[0], label: c[1], phase: c[2], kind: c[3], sort: i, active: true, companyId: 'woodart' };
      }));
    }

    /* Budgets DERIVED from the approved BOQ, grouped by the cost code each
     * material belongs to via the Materials register's own category — so the
     * budget and the quotation it was won on cannot disagree. A project with no
     * approved BOQ gets no rows, which is correct: the Munshi sheet budgets only
     * 6 of its 18 heads. */
    if (localStorage.getItem(S.namespace + 'wa_budget_lines') === null) {
      /* Each BOQ line now carries its own cost code (WA_WORK), so the budget is
       * a straight roll-up of the quotation rather than a guess made by mapping
       * a material's category. Budget and quotation cannot disagree: they are
       * the same rows added up two ways. */
      var budget = [];
      S.list('wa_estimates').forEach(function (e) {
        if (e.status !== 'Approved' && e.status !== 'Sent') return;
        if (!e.project) return;
        var bag = {};
        (e.lines || []).forEach(function (l) {
          var code = l.code || 'Other Expense';
          bag[code] = (bag[code] || 0) + (+l.qty || 0) * (+l.unitCost || 0);
        });
        Object.keys(bag).forEach(function (code) {
          budget.push({ id: e.project + '::' + code, companyId: 'woodart', project: e.project,
            code: code, budget: Math.round(bag[code]), source: 'boq', note: 'From ' + e.id });
        });
      });
      S.set('wa_budget_lines', budget);
    }

    /* ==================== WOODART · SPACES → PHASES ==========================
     * The owner's shape (2026-08-06, companies/woodart/PROJECT-BREAKDOWN-PLAN.md):
     * a project is divided into SPACES (Master Bed Room · Kitchen · Dining Room),
     * and each space runs its own PHASES (Design → Colour → Wood Work →
     * Furniture), each with one person responsible.
     *
     *   wa_projects → wa_spaces → wa_phases          (wa_phase_templates seeds
     *                                                 the phase list per kind)
     *
     * ⚠️ `wa_phases` CHANGED SHAPE HERE. It was seeded on 2026-07-28 as
     * PROJECT-level parallel rows for the cost-control plan and read by NO
     * screen — grep the repo, the only mentions were this seeder and the plan
     * document. Phases now belong to a SPACE (a fit-out finishes the kitchen
     * while the bedroom has not started; one flat list per project cannot say
     * that), and the project-level view is DERIVED, so the two levels can never
     * disagree. Because nothing consumed the old rows, replacing them cannot
     * change a pixel — see the re-seed guard below, which also upgrades a
     * browser that still holds the old shape. */

    /* The phase list per space kind. DATA, NOT CODE — adding "Smart Home" to a
     * bedroom is a row here, not a deploy, exactly like the cost-code list.
     * Every `code` is an id from wa_cost_codes above, so plan, purchase and
     * actual all speak one vocabulary. */
    if (localStorage.getItem(S.namespace + 'wa_phase_templates') === null) {
      var TPL = [
        ['Bedroom',   [['Design','Design Fee'],['Electrical','Electrical'],['False Ceiling','False Ceiling'],
                       ['Wood Work','Wood Work'],['Colour & Paint','Paint'],['Furniture','Boards & Ply'],
                       ['Handover','Installation']]],
        ['Kitchen',   [['Design','Design Fee'],['Civil & Breaking','Bricks & Breaking'],['Plumbing','Sanitary'],
                       ['Electrical','Electrical'],['Tiles','Tiles Work'],['Wood Work','Wood Work'],
                       ['Counter & Stone','Metal'],['Colour & Paint','Paint'],['Appliances & Fit-out','Hardware'],
                       ['Handover','Installation']]],
        ['Dining',    [['Design','Design Fee'],['Electrical','Electrical'],['False Ceiling','False Ceiling'],
                       ['Wood Work','Wood Work'],['Colour & Paint','Paint'],['Furniture','Boards & Ply'],
                       ['Handover','Installation']]],
        ['Living',    [['Design','Design Fee'],['3D & Visualisation','3D & Visualisation'],['Electrical','Electrical'],
                       ['False Ceiling','False Ceiling'],['Wood Work','Wood Work'],['Colour & Paint','Paint'],
                       ['Furniture','Fabric & Foam'],['Handover','Installation']]],
        ['Bath',      [['Design','Design Fee'],['Civil & Breaking','Bricks & Breaking'],['Plumbing','Sanitary'],
                       ['Tiles','Tiles Work'],['Electrical','Electrical'],['Fittings','Hardware'],
                       ['Handover','Installation']]],
        ['Balcony',   [['Design','Design Fee'],['Tiles','Tiles Work'],['Aluminium & Glazing','Aluminium'],
                       ['Colour & Paint','Paint'],['Handover','Installation']]],
        ['Office',    [['Design','Design Fee'],['Electrical','Electrical'],['False Ceiling','False Ceiling'],
                       ['Wood Work','Wood Work'],['Colour & Paint','Paint'],['Furniture','Boards & Ply'],
                       ['Handover','Installation']]],
        ['Reception', [['Design','Design Fee'],['3D & Visualisation','3D & Visualisation'],['Electrical','Electrical'],
                       ['False Ceiling','False Ceiling'],['Wood Work','Wood Work'],['Metal & Signage','Metal'],
                       ['Colour & Paint','Paint'],['Handover','Installation']]],
        ['Retail',    [['Design','Design Fee'],['Electrical','Electrical'],['False Ceiling','False Ceiling'],
                       ['Wood Work','Wood Work'],['Metal & Signage','Metal'],['Colour & Paint','Paint'],
                       ['Handover','Installation']]],
        ['Common',    [['Design','Design Fee'],['Electrical','Electrical'],['Wood Work','Wood Work'],
                       ['Colour & Paint','Paint'],['Handover','Installation']]]
      ];
      S.set('wa_phase_templates', TPL.map(function (t, i) {
        return { id: seq('TPL', i, 3), companyId: 'woodart', kind: t[0], sort: i,
          phases: t[1].map(function (p) { return { name: p[0], code: p[1] }; }) };
      }));
    }

    /* THE VILLA'S ROOMS — the project's spaces, ground floor then upper floor.
     * Their areas sum to the 2,520 sft on the project record, so the Spaces
     * screen's "Area Planned" KPI and the project's own area agree. The sheet
     * carries no room schedule, so the names and areas are demo detail; every
     * figure that touches money is not. */
    var WA_SPACES = [
      ['Living Room',       'Living',  420, 'Ground'],
      ['Dining Room',       'Dining',  300, 'Ground'],
      ['Kitchen',           'Kitchen', 180, 'Ground'],
      ['Guest Bed Room',    'Bedroom', 240, 'Ground'],
      ['Guest Bath',        'Bath',     70, 'Ground'],
      ['Master Bed Room',   'Bedroom', 360, 'Upper'],
      ['Master Bath',       'Bath',     90, 'Upper'],
      ['Kids Bed Room',     'Bedroom', 260, 'Upper'],
      ['Family Lounge',     'Living',  280, 'Upper'],
      ['Staircase & Lobby', 'Common',  200, 'Upper'],
      ['Balcony — Upper',   'Balcony', 120, 'Upper']
    ];
    if (localStorage.getItem(S.namespace + 'wa_spaces') === null) {
      S.set('wa_spaces', WA_SPACES.map(function (s, i) {
        return { id: seq('SPC', i, 3), companyId: 'woodart', project: 'WAP-101',
          name: s[0], kind: s[1], area: s[2], sort: i + 1,
          note: s[3] + ' floor', created: '2026-02-27' };
      }));
    }

    /* THE PHASES OF EACH ROOM — what it runs through, and where the villa
     * actually stands today (demo clock 2026-07-05).
     *
     * THE STATUSES ARE THE SHEET'S, not a generator's (MUNSHI-VILLA-SHEET §2/§3a):
     *   Design            complete    3D design office ৳30,000 of ৳50,000 spent
     *   Civil & Breaking  complete    bricks, cement, rod and sand are ~95% spent
     *   Electrical        RUNNING     ৳22,800 of ৳3,50,000 — first fix, ground floor
     *   Plumbing          RUNNING     ৳7,530 of ৳4,00,000 — kitchen + master bath
     *   Tiles · Paint · Metal · Aluminium · Wood Work · Furniture   NOT STARTED
     *                                 — the five empty sheets in its summary
     *
     * COLOUR & PAINT IS DELIBERATELY LEFT UNASSIGNED on every room: it is far
     * enough out that nobody has been put on it, which is exactly the queue the
     * Phase Board's "unassigned" banner exists to surface. The kitchen's
     * plumbing finish date has passed with the phase still open, so the overdue
     * rule has one real row to report instead of always showing zero.
     *
     * The guard also re-seeds a browser still holding the pre-2026-08-06
     * project-level rows (no `space` key). */
    var WA_PHASE_PLAN = {
      Living:  ['Design','Civil & Breaking','Electrical','Tiles','Wood Work','Colour & Paint','Furniture','Handover'],
      Dining:  ['Design','Civil & Breaking','Electrical','Tiles','Wood Work','Colour & Paint','Furniture','Handover'],
      Bedroom: ['Design','Civil & Breaking','Electrical','Tiles','Wood Work','Colour & Paint','Furniture','Handover'],
      Kitchen: ['Design','Civil & Breaking','Plumbing','Electrical','Tiles','Wood Work','Counter & Stone','Colour & Paint','Handover'],
      Bath:    ['Design','Civil & Breaking','Plumbing','Electrical','Tiles','Fittings','Colour & Paint','Handover'],
      Balcony: ['Design','Civil & Breaking','Tiles','Aluminium & Glazing','Colour & Paint','Handover'],
      Common:  ['Design','Civil & Breaking','Electrical','Tiles','MS Railing','Colour & Paint','Handover']
    };
    /* Every phase carries a cost code, so the plan, the purchase order and the
     * expense against it are all filed under one head. */
    var WA_PHASE_CODE = {
      'Design':'3D & Visualisation', 'Civil & Breaking':'Bricks & Breaking',
      'Plumbing':'Sanitary',         'Electrical':'Electrical',
      'Tiles':'Tiles Work',          'Wood Work':'Wood Work',
      'Counter & Stone':'Metal',     'MS Railing':'Metal',
      'Aluminium & Glazing':'Aluminium', 'Fittings':'Sanitary',
      'Colour & Paint':'Paint',      'Furniture':'Boards & Ply',
      'Handover':'Installation'
    };
    /* Who is responsible — the REAL Woodart roster (database.js seedEmployees):
     *   EPL-0007 Imtiaz Chowdhury · Lead Interior Designer  → the drawing board
     *   EPL-0008 Sumaiya Akter    · Production Supervisor   → the workshop
     *   EPL-0009 Jahangir Alam    · Installation Foreman    → the site */
    var WA_PHASE_OWNER = {
      'Design':'EPL-0007',
      'Wood Work':'EPL-0008', 'Counter & Stone':'EPL-0008', 'Furniture':'EPL-0008',
      'Civil & Breaking':'EPL-0009', 'Plumbing':'EPL-0009', 'Electrical':'EPL-0009',
      'Tiles':'EPL-0009', 'Fittings':'EPL-0009', 'MS Railing':'EPL-0009',
      'Aluminium & Glazing':'EPL-0009', 'Handover':'EPL-0009'
      /* 'Colour & Paint' is absent on purpose — see the block comment above. */
    };
    var phasesRaw = localStorage.getItem(S.namespace + 'wa_phases');
    var phasesLegacy = phasesRaw !== null && (S.list('wa_phases')[0] || {}).space === undefined;
    if (phasesRaw === null || phasesLegacy) {
      var phaseRows = [], pn = 0;
      S.list('wa_spaces').forEach(function (sp) {
        var plan = WA_PHASE_PLAN[sp.kind] || WA_PHASE_PLAN.Common;
        var ground = /Ground/.test(sp.note || '');
        plan.forEach(function (name, i) {
          var status = 'Not started', start = null, finish = null;
          if (name === 'Design') {
            status = 'Complete'; start = '2026-02-27'; finish = '2026-03-10';
          } else if (name === 'Civil & Breaking') {
            status = 'Complete'; start = '2026-03-12'; finish = '2026-06-20';
          } else if (name === 'Electrical' && ground) {
            status = 'Active';   start = '2026-06-22'; finish = '2026-07-31';
          } else if (name === 'Plumbing' && (sp.name === 'Kitchen' || sp.name === 'Master Bath')) {
            status = 'Active';   start = '2026-06-18';
            finish = sp.name === 'Kitchen' ? '2026-06-30' : '2026-07-20';
          }
          phaseRows.push({ id: seq('PHS', pn++, 4), companyId: 'woodart', project: sp.project,
            space: sp.id, name: name, code: WA_PHASE_CODE[name] || '', sort: i + 1,
            status: status, ownerId: WA_PHASE_OWNER[name] || '',
            start: start, finish: finish, note: '' });
        });
      });
      S.set('wa_phases', phaseRows);
    }

    /* Woodart RECURRING COSTS — the bills that arrive every month whether or not
     * a project is running. Deliberately NOT random: these are the same heads the
     * seeded register already carries (Workshop rent Tejgaon, workshop power,
     * design-team salaries), so the Recurring tab and the Expense register
     * describe one business rather than two. A standing cost with no matching
     * history would read as a data-entry error the first time anyone checked. */
    /* SALARIES ARE THE REAL ROSTER, not a round number: Woodart employs three
     * people (Imtiaz ৳72,000 · Sumaiya ৳42,000 · Jahangir ৳34,000 = ৳1,48,000).
     * The old rows claimed ৳3,85,000 of designers plus ৳2,68,000 of site crew,
     * which no payslip in the system could ever match. */
    gen('wa_recurring', 5, function (i) {
      var rows = [
        { name: 'Workshop rent — Tejgaon',    category: 'Office Rent',      amount: 180000, party: 'Tejgaon Industrial Estate', dayOfMonth: 5,  method: 'Bank', status: 'Active' },
        { name: 'Workshop power & utilities', category: 'Utilities',        amount: 64200,  party: 'DESCO',                     dayOfMonth: 12, method: 'Bank', status: 'Active' },
        { name: 'Salaries — design & site',   category: 'Salaries',         amount: 148000, party: 'Payroll',                   dayOfMonth: 28, method: 'Bank', status: 'Active' },
        { name: 'Delivery van lease',         category: 'Fuel & Transport', amount: 42000,  party: 'Rangs Motors',              dayOfMonth: 8,  method: 'Bank', status: 'Active' },
        { name: 'CNC service retainer',       category: 'Tools & Equipment',amount: 25000,  party: 'Homag Bangladesh',          dayOfMonth: 20, method: 'Cheque', status: 'Paused' }
      ];
      var r = rows[i];
      return { id: 'REC-WA' + String(i + 1).padStart(3, '0'), companyId: 'woodart',
        name: r.name, category: r.category, amount: r.amount, party: r.party,
        dayOfMonth: r.dayOfMonth, method: r.method, status: r.status, created: '2026-01-05' };
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
      /* The villa's drawing set. The build ones are approved (the site is
       * already up), the joinery ones are still moving — which is what a
       * project at this phase looks like: the client signed off the shell and
       * is still choosing what goes inside it. `Issued` is the only state where
       * the wait is the CLIENT's, so the Approvals queue has exactly one row. */
      S.set('wa_drawings', [
        { id:'DWG-101', project:'WAP-101', title:'Ground floor plan',           kind:'Plan',      rev:'B', status:'Approved',  designer:'Imtiaz Chowdhury', issued:'2026-03-02', approved:'2026-03-10', created:'2026-02-27' },
        { id:'DWG-102', project:'WAP-101', title:'Upper floor plan',            kind:'Plan',      rev:'B', status:'Approved',  designer:'Imtiaz Chowdhury', issued:'2026-03-02', approved:'2026-03-10', created:'2026-02-27' },
        { id:'DWG-103', project:'WAP-101', title:'Front elevation',             kind:'Elevation', rev:'A', status:'Approved',  designer:'Imtiaz Chowdhury', issued:'2026-03-04', approved:'2026-03-10', created:'2026-03-01' },
        { id:'DWG-104', project:'WAP-101', title:'Staircase & lobby section',   kind:'Section',   rev:'A', status:'Approved',  designer:'Imtiaz Chowdhury', issued:'2026-03-06', approved:'2026-03-12', created:'2026-03-02' },
        { id:'DWG-105', project:'WAP-101', title:'Living room — 3D view',       kind:'3D Model',  rev:'C', status:'Commented', designer:'Imtiaz Chowdhury', issued:'2026-06-24', approved:null,         created:'2026-05-18' },
        { id:'DWG-106', project:'WAP-101', title:'Master wardrobe detail',      kind:'Detail',    rev:'A', status:'Issued',    designer:'Imtiaz Chowdhury', issued:'2026-06-28', approved:null,         created:'2026-06-20' },
        { id:'DWG-107', project:'WAP-101', title:'Kitchen joinery detail',      kind:'Detail',    rev:'A', status:'Draft',     designer:'Imtiaz Chowdhury', issued:null,         approved:null,         created:'2026-07-01' }
      ]);
      /* The trail is EVIDENCE — one row per revision letter, up to the current
       * one, so how a drawing reached its state is readable months later. */
      S.set('wa_revisions', [
        { id:'RVN-101', drawing:'DWG-101', rev:'A', action:'Revised',   by:'Imtiaz Chowdhury', note:'Store room moved under the stair', date:'2026-02-29' },
        { id:'RVN-102', drawing:'DWG-101', rev:'B', action:'Approved',  by:'Imtiaz Chowdhury', note:'', date:'2026-03-10' },
        { id:'RVN-103', drawing:'DWG-102', rev:'A', action:'Revised',   by:'Imtiaz Chowdhury', note:'Kids bed room widened by 1 ft', date:'2026-03-01' },
        { id:'RVN-104', drawing:'DWG-102', rev:'B', action:'Approved',  by:'Imtiaz Chowdhury', note:'', date:'2026-03-10' },
        { id:'RVN-105', drawing:'DWG-103', rev:'A', action:'Approved',  by:'Imtiaz Chowdhury', note:'', date:'2026-03-10' },
        { id:'RVN-106', drawing:'DWG-104', rev:'A', action:'Approved',  by:'Imtiaz Chowdhury', note:'', date:'2026-03-12' },
        { id:'RVN-107', drawing:'DWG-105', rev:'A', action:'Revised',   by:'Imtiaz Chowdhury', note:'Ceiling height corrected to 9 ft', date:'2026-05-30' },
        { id:'RVN-108', drawing:'DWG-105', rev:'B', action:'Revised',   by:'Imtiaz Chowdhury', note:'Veneer tone changed to walnut', date:'2026-06-14' },
        { id:'RVN-109', drawing:'DWG-105', rev:'C', action:'Commented', by:'Imtiaz Chowdhury', note:'Client wants the TV wall reworked', date:'2026-07-02' },
        { id:'RVN-110', drawing:'DWG-106', rev:'A', action:'Issued',    by:'Imtiaz Chowdhury', note:'', date:'2026-06-28' },
        { id:'RVN-111', drawing:'DWG-107', rev:'A', action:'Drafted',   by:'Imtiaz Chowdhury', note:'', date:'2026-07-01' }
      ]);
    }

    /* Woodart MATERIALS — a MIRROR of the backend MaterialSeeder, not a generator.
     *
     * This used to be gen('wa_materials', 22, …) cycling 12 names with a random
     * unitCost of ri(120, 8500). Two things were wrong with that, and both were
     * visible on screen:
     *   1. 22 rows from 12 names meant DUPLICATES — MAT-006 and MAT-018 were
     *      both 'Drawer Channel 18"' at different prices, so the register showed
     *      one material twice and neither row was authoritative.
     *   2. the random cost disagreed with the BOQ, which quotes these same
     *      materials at their REAL prices (ProjectSeeder). Estimates › Bill of
     *      Materials compares the two, and reported plywood quoted at 3,400 now
     *      costing 6,513 — a 92% price rise that never happened.
     *
     * The list below is byte-for-byte the backend seeder's, so demo mode and a
     * migrated host describe ONE register.
     *
     * THREE items deliberately cost MORE than the BOQ quoted them at — plywood,
     * lacquer and hinges — because that is a real thing that happens to a joinery
     * business between quoting and building, and the Drift column exists to
     * catch it. Every other item sits exactly at its quoted cost, so a non-zero
     * drift always means something. */
    gen('wa_materials', 16, function (i) {
      var mats = [
        ['MAT-001','Marine Plywood 18mm',    'Board',   'sheet', 142,  40, 3610, 'Timber World BD'],
        ['MAT-002','Veneer Board',           'Board',   'sheet',  38,  25, 4200, 'Akij Board'],
        ['MAT-003','MDF 12mm',               'Board',   'sheet',  16,  30, 1850, 'Partex Star'],
        ['MAT-004','Formica Laminate',       'Laminate','sheet',  88,  35, 1250, 'Hatil Trade'],
        ['MAT-005','German Hinge (Hettich)', 'Hardware','pcs',   420, 150,  335, 'RFL Hardware'],
        ['MAT-006','Drawer Channel 18"',     'Hardware','pcs',    64, 100,  540, 'RFL Hardware'],
        ['MAT-007','SS Handle',              'Hardware','pcs',   210,  80,  185, 'RFL Hardware'],
        ['MAT-008','Wood Glue 5kg',          'Adhesive','kg',     52,  20,  760, 'Timber World BD'],
        ['MAT-009','NC Lacquer',             'Finish',  'litre',  28,  30, 1065, 'Akij Board'],
        ['MAT-010','PU Polish',              'Finish',  'litre',  44,  20, 1420, 'Akij Board'],
        ['MAT-011','Fabric — Velvet',        'Fabric',  'sft',   160,  60,  420, 'Hatil Trade'],
        ['MAT-012','Foam 4"',                'Fabric',  'sft',     0,  50,  260, 'Hatil Trade'],
        /* CIVIL BULK — the four materials the Munshi Villa build actually
         * bought and consumed (MUNSHI-VILLA-SHEET §2). Their unit costs are the
         * sheet's own rates, so a purchase order, the BOQ line and the stock
         * value all quote the same number. Almost everything is issued to site,
         * which is why the register shows them nearly empty: a villa does not
         * warehouse its rod. */
        ['MAT-013','Rod — BSRM 60 grade',    'Civil',   'kg',    181, 500,   85, 'Haji Enterprise'],
        ['MAT-014','Cement — 50 kg bag',     'Civil',   'bag',    12,  50,  545, 'Meghna Cement Depot'],
        ['MAT-015','Bricks (1st class)',     'Civil',   'pcs',   500,2000,   12, 'Munshiganj Brick Field'],
        ['MAT-016','Sand & bali',            'Civil',   'cft',    68, 300,   65, 'Buriganga Sand Traders']
      ];
      var m = mats[i];
      return { id: m[0], name: m[1], category: m[2], unit: m[3],
        stock: m[4], reorder: m[5], unitCost: m[6], supplier: m[7], created: '2026-01-12' };
    });
    /* WORKSHOP — the joinery phase has NOT started on site (the sheet's Wood
     * Work sheet is empty), so what the workshop is doing is preparing for it:
     * a sample door for the client to approve, two carcasses queued behind it,
     * and the handrail cap blocked until the MS railing goes in. That is an
     * honest board for a project at this phase — four jobs, four states. */
    gen('wa_production', 4, function (i) {
      var jobs = [
        ['JOB-101','Kitchen cabinet — sample door',  'Finishing','Sumaiya Akter',  '2026-07-12','Running','2026-06-24'],
        ['JOB-102','Master wardrobe carcass',        'Cutting',  'Sumaiya Akter',  '2026-08-05','Queued', '2026-06-30'],
        ['JOB-103','TV wall panel — living room',    'CNC',      'Sumaiya Akter',  '2026-08-18','Queued', '2026-07-02'],
        ['JOB-104','Staircase handrail — wood cap',  'Assembly', 'Jahangir Alam',  '2026-07-20','Blocked','2026-06-18']
      ];
      var j = jobs[i];
      return { id: j[0], companyId: 'woodart', job: j[1], project: 'WAP-101', station: j[2],
        assignedTo: j[3], due: j[4], status: j[5], created: j[6] };
    });

    /* SITE & INSTALL — the villa is a live building site, so these are site
     * visits rather than deliveries: civil supervision running, the electrical
     * first-fix inspection booked, and the ground-floor civil handover being
     * snagged. The snag list is itemised, which is the shape the Installation
     * module recomputes its count from. */
    gen('wa_installs', 3, function (i) {
      var rows = [
        { id:'INS-101', site:'Munshiganj', team:'Team Alpha', date:'2026-07-02', status:'In Progress', snags:0, created:'2026-06-20' },
        { id:'INS-102', site:'Munshiganj', team:'Team Alpha', date:'2026-07-14', status:'Scheduled',   snags:0, created:'2026-06-28' },
        { id:'INS-103', site:'Munshiganj', team:'Team Bravo', date:'2026-06-26', status:'Snagging',    snags:2, created:'2026-06-22',
          snagList:[
            { text:'Plaster crack — dining room north wall', done:false },
            { text:'Floor level off by 8mm — guest bath',    done:false },
            { text:'Window opening 2" narrow — kids room',   done:true }
          ] }
      ];
      var r = rows[i];
      return { id: r.id, companyId: 'woodart', project: 'WAP-101', site: r.site, team: r.team,
        date: r.date, status: r.status, snags: r.snags, snagList: r.snagList, created: r.created };
    });

    /* PROCUREMENT — every order this project raised, at the sheet's own
     * amounts. The four civil orders are received (the shell is built); the
     * electrical order is part-delivered and the sanitary one is only just
     * placed, which is why those two heads have barely any spend against a
     * large budget. Together with the contractor, transport, labour, soil and
     * design payments these add up to the sheet's ৳23,48,257. */
    gen('wa_purchases', 7, function (i) {
      var pos = [
        ['WPO-101','Haji Enterprise',        3, 856397,'Received','2026-03-14'],
        ['WPO-102','Meghna Cement Depot',    1, 273780,'Received','2026-03-22'],
        ['WPO-103','Munshiganj Brick Field', 1, 414000,'Received','2026-03-08'],
        ['WPO-104','Buriganga Sand Traders', 1, 244920,'Received','2026-03-05'],
        ['WPO-105','RFL Hardware',           4,  24160,'Received','2026-05-18'],
        ['WPO-106','Dhaka Electric House',   6,  22800,'Partial', '2026-06-20'],
        ['WPO-107','Sanitary World BD',      5,   7530,'Ordered', '2026-06-28']
      ];
      var p = pos[i];
      return { id: p[0], companyId: 'woodart', project: 'WAP-101', supplier: p[1],
        items: p[2], amount: p[3], status: p[4], date: p[5], created: p[5] };
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
     * WOODART — THE VILLA'S MONEY (owner, 2026-08-06)
     * ------------------------------------------------------------------------
     * Interior's books are this project's books. Every income row is one of the
     * three payments the client has made, and every project expense is one of
     * the thirteen heads on the sheet's cost summary, at the sheet's own
     * figures — they sum to exactly ৳23,48,257, which is what the spreadsheet
     * says has been spent.
     *
     *     received   ৳40,00,000   of a ৳70,00,000 contract
     *     spent      ৳23,48,257   across 13 heads
     *     to collect ৳30,00,000   sitting on the schedule as a receivable
     *
     * `ref` carries the project id, because that is the field Accounts › Project
     * P&L joins on (billed and spent per ref). An entry without it reads as
     * company overhead rather than job cost — which is exactly why the standing
     * costs at the end deliberately have none: workshop rent is not this
     * villa's cost.
     *
     * WHO MOVED THE MONEY is kept in the description. The sheet's REF. NAME
     * column (MOHSIN BOSS · NAYEEM · EMAN VAI · AZIZUL VAI) is an audit trail
     * the business actually relies on, and the ERP has no handler field yet
     * (MUNSHI-VILLA-SHEET §4) — so it is written where it can still be read,
     * and no column is invented to hold it.
     * ====================================================================== */
    (function seedMunshiVillaMoney() {
      if (S.list('acc_entries').some(function (e) { return e.id === 'JV-WA101'; })) return;
      function add(store, rows) { S.set(store, S.list(store).concat(rows)); }

      /* THE CLIENT'S PAYMENTS — sheet §1, rows 77-85 of Over all Accounts. */
      var WA_RECEIPTS = [
        ['2026-03-05', 1000000, '1st payment — on signing'],
        ['2026-04-22', 2000000, '2nd payment — on structure'],
        ['2026-06-10', 1000000, '3rd payment — on brickwork']
      ];

      /* THE 13 HEADS THAT HAVE SPEND — sheet §2, Over All Cost Summary.
       * [ cost code, amount, date, method, who moved it, what for ] */
      var WA_SPENT = [
        ['3D & Visualisation',  30000, '2026-03-04', 'Bank', 'MOHSIN BOSS',     '3D design office — concept & walkthrough'],
        ['Soil & Excavation',   59980, '2026-03-06', 'Cash', 'NAYEEM',          'Soil test, cutting & fill'],
        ['Sand & Bali',        244920, '2026-03-09', 'Bank', 'AZIZUL VAI',      'Sand & bali — Buriganga Sand Traders (WPO-104)'],
        ['Bricks & Breaking',  414000, '2026-03-16', 'Bank', 'EMAN VAI',        'Bricks & breaking — Munshiganj Brick Field (WPO-103)'],
        ['Rod',                856397, '2026-03-24', 'Bank', 'MOHSIN BOSS',     'BSRM rod — Haji Enterprise (WPO-101)'],
        ['Cement',             273780, '2026-04-02', 'Bank', 'EMAN VAI',        'Cement — Meghna Cement Depot (WPO-102)'],
        ['Contractor',         341000, '2026-05-10', 'Bank', 'RONY & EMAN VAI', 'Rajmistri contract — Younus Mia, part payment'],
        ['Hardware',            24160, '2026-05-20', 'Cash', 'NAYEEM',          'Civil hardware & fixings — RFL Hardware (WPO-105)'],
        ['Extra Labour',        16300, '2026-06-04', 'Cash', 'NAYEEM',          'Extra labour — call-outs'],
        ['Electrical',          22800, '2026-06-22', 'Bank', 'AZIZUL VAI',      'Electrical first fix — Dhaka Electric House (WPO-106)'],
        ['Transport & Visit',   43790, '2026-06-26', 'Cash', 'MOHSIN BOSS',     'Transport & site visits'],
        ['Sanitary',             7530, '2026-06-30', 'Cash', 'NAYEEM',          'Sanitary advance — Sanitary World BD (WPO-107)'],
        ['Other Expense',       13600, '2026-07-02', 'Cash', 'MOHSIN BOSS',     'Extra / others']
      ];

      var n = 100;
      function jv() { return 'JV-WA' + (++n); }

      add('acc_entries', WA_RECEIPTS.map(function (r) {
        return { id: jv(), companyId: 'woodart', kind: 'Income', category: 'Project Billing',
          desc: 'Munshi Villa Duplex — ' + r[2], amount: r[1], method: 'Bank',
          ref: 'WAP-101', date: r[0], created: r[0] };
      }).concat(WA_SPENT.map(function (s) {
        return { id: jv(), companyId: 'woodart', kind: 'Expense', category: s[0],
          desc: s[5] + ' · handled by ' + s[4], amount: s[1], method: s[3],
          ref: 'WAP-101', date: s[2], created: s[2] };
      })).concat([
        /* Standing costs — the concern's own overheads. NO ref: charging the
         * workshop's rent to the villa would overstate the job and understate
         * every job after it. */
        { id: jv(), companyId:'woodart', kind:'Expense', category:'Office Rent',
          desc:'Workshop rent — Tejgaon, June', amount:180000, method:'Bank', date:'2026-06-05', created:'2026-06-05' },
        { id: jv(), companyId:'woodart', kind:'Expense', category:'Salaries',
          desc:'Salaries — design & site team, June', amount:148000, method:'Bank', date:'2026-06-28', created:'2026-06-28' },
        { id: jv(), companyId:'woodart', kind:'Expense', category:'Utilities',
          desc:'Workshop power — June', amount:64200, method:'Bank', date:'2026-07-02', created:'2026-07-02' }
      ]));

      /* WHAT IS STILL OWED, both ways. The contractor figure is not typed: it
       * is the ৳13,44,000 contract in the BOQ minus the ৳3,41,000 already paid,
       * so it cannot drift from either. */
      add('acc_schedules', [
        { id:'SCH-WA1', companyId:'woodart', party:'Munshi Billah', kind:'Receivable',
          amount:3000000, due:'2026-09-15', status:'Pending', ref:'WAP-101', created:'2026-06-10' },
        { id:'SCH-WA2', companyId:'woodart', party:'Younus Mia', kind:'Payable',
          amount:1344000 - 341000, due:'2026-08-10', status:'Partial', ref:'WAP-101', created:'2026-05-10' },
        { id:'SCH-WA3', companyId:'woodart', party:'Dhaka Electric House', kind:'Payable',
          amount:22800, due:'2026-07-20', status:'Partial', ref:'WPO-106', created:'2026-06-20' }
      ]);

      /* The sales register mirrors the three receipts. Cost per receipt is the
       * project's own spend-to-billing ratio, so Woodart's margin on the group
       * dashboard is this villa's margin rather than an unrelated number. */
      var ratio = WA_SPENT.reduce(function (t, s) { return t + s[1]; }, 0) /
                  WA_RECEIPTS.reduce(function (t, r) { return t + r[1]; }, 0);
      add('sales', WA_RECEIPTS.map(function (r, i) {
        var cost = Math.round(r[1] * ratio);
        return { id: 'SL-WA' + String(i + 1).padStart(2, '0'), companyId: 'woodart', date: r[0],
          amount: r[1], cost: cost, profit: r[1] - cost, ref: 'WAP-101',
          desc: 'Munshi Villa Duplex — ' + r[2], customer: 'Munshi Billah', created: r[0] };
      }));
    })();

    /* ========================================================================
     * WOODART — STOCK LOCATIONS + THE MOVEMENT LEDGER (owner, 2026-07-27)
     * ------------------------------------------------------------------------
     * Until now a material's `stock` was a bare number: you could see that only
     * 26 sheets of marine ply were left, but nothing anywhere said WHY. That is
     * the one thing every other balance in this system refuses to do — a bank
     * balance never moves without a row in its transaction log (EPAL.bankTxnApply),
     * and stock is now held to the same standard.
     *
     *   wa_locations  where stock sits — workshop, site store, finishing bay
     *   wa_movements  every change: receipt · issue · adjustment · wastage
     *
     * THE INVARIANT, which the seed below establishes and Materials.reconcile()
     * proves at any time: for every material, the sum of its movements EQUALS
     * its stored stock. The number and its history can never disagree.
     *
     * The movements are generated BACKWARDS from the stock each material already
     * carries — an opening receipt, then the real issues the three story
     * projects consumed — so the ledger explains the numbers already on screen
     * rather than contradicting them.
     * ====================================================================== */
    if (localStorage.getItem(S.namespace + 'wa_locations') === null) {
      S.set('wa_locations', [
        { id:'LOC-001', name:'Main Workshop',  kind:'Workshop', area:'Tejgaon I/A',  primary:true,  created:dt(6) },
        { id:'LOC-002', name:'Finishing Bay',  kind:'Workshop', area:'Tejgaon I/A',  primary:false, created:dt(6) },
        { id:'LOC-003', name:'Site Store',     kind:'Site',     area:'Munshiganj',   primary:false, created:dt(3) }
      ]);
    }
    if (localStorage.getItem(S.namespace + 'wa_movements') === null) {
      var moves = [], mv = 0;
      /* WHAT THE VILLA HAS ACTUALLY CONSUMED, by material name. Only the four
       * civil bulk materials appear: the joinery phases have not started, so
       * not one sheet of plywood has left the workshop for this job — which is
       * exactly what the sheet's empty Wood Work page says.
       *
       * The quantities are derived from the SPEND, not invented. Rod: ৳8,56,397
       * at ৳85/kg is 10,075 kg received, of which 9,700 went to site and 194
       * (2%) was cutting waste, leaving the 181 kg the register shows. All four
       * reconcile the same way. */
      var CONSUMED = {
        'Rod — BSRM 60 grade': [['WAP-101', 9700,  '2026-03-26']],
        'Cement — 50 kg bag':  [['WAP-101', 480,   '2026-04-04']],
        'Bricks (1st class)':  [['WAP-101', 33333, '2026-03-18']],
        'Sand & bali':         [['WAP-101', 3627,  '2026-03-12']]
      };
      /* Civil bulk is delivered to the SITE STORE and issued from there; the
       * workshop materials sit in the workshop. Both legs of a material's
       * ledger stay in one place, so no location can report a negative balance. */
      var SITE_STORE = { Civil: 'LOC-003' };
      S.list('wa_materials').forEach(function (m) {
        var loc = SITE_STORE[m.category] || 'LOC-001';
        var used = CONSUMED[m.name] || [];
        var out = used.reduce(function (s, u) { return s + u[1]; }, 0);
        var wastage = out ? Math.max(1, Math.round(out * 0.02)) : 0;
        /* opening receipt = whatever is left, plus everything that left again,
           so the ledger nets EXACTLY to the stock already on the record */
        var opening = (+m.stock || 0) + out + wastage;
        moves.push({ id: seq('MOV', mv++, 4), material: m.id, kind: 'Receipt',
          qty: opening, location: loc, ref: 'OPENING',
          note: 'Opening stock on hand', by: 'System', date: dt(5), created: dt(5) });
        used.forEach(function (u) {
          moves.push({ id: seq('MOV', mv++, 4), material: m.id, kind: 'Issue',
            qty: -u[1], location: loc, ref: u[0],
            note: 'Issued to ' + u[0], by: 'Jahangir Alam', date: u[2], created: u[2] });
        });
        if (wastage) {
          moves.push({ id: seq('MOV', mv++, 4), material: m.id, kind: 'Wastage',
            qty: -wastage, location: loc, ref: '',
            note: 'Cutting waste and breakage', by: 'Jahangir Alam', date: dt(1), created: dt(1) });
        }
      });
      S.set('wa_movements', moves);
    }

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
