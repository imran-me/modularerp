/* ============================================================================
 * EPAL GROUP ERP  ·  core/seed-bd.js
 * ----------------------------------------------------------------------------
 * DEEP DEMO SEED — Bangladesh-context operational data for EVERY company, so
 * the system feels like a live, running group (not a skeleton). Idempotent:
 * each store seeds only once (state.seedOnce). Called from database.js seed().
 *
 * ⚠ STORE SHAPES BELOW ARE THE CONTRACT for all module views. If you add a
 *   field, update docs/CONTRACT.md too.
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
