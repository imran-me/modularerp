/* ============================================================================
 * EPAL KIT · SAMPLE BOOK — one month of real-shaped trading, posted for real
 * ----------------------------------------------------------------------------
 * Owner, 2026-07-28: "push 5 ticket sell, 5 visa sell, 5 others sells, put some
 * sell related expenses, other expense, so i have a full view of all. These
 * should be like real data."
 *
 * WHAT THIS IS. Not a fixture and not a SQL dump: it calls the same functions the
 * desks call — db.postSale, EPAL.pay.*, EPAL.ledger.post — so every book fills
 * exactly as it would if a person had typed each entry, and on a live install
 * every write goes to the database through the normal writable-store path. If a
 * chain is broken this shows it instead of papering over it.
 *
 * WHAT IT WRITES (July 2026, Epal Travels)
 *   5 air tickets   — two settled on the spot, one on credit, one through a
 *                     sub-agent who earns commission, one bought on the GDS wallet
 *   5 visa files    — four collected, one still awaiting payment
 *   5 other sales   — contract seats, hotel, EMD baggage, Umrah package, consultancy
 *   sale-related    — two agent-commission payouts, BSP settlement fee, courier,
 *                     ticket stationery
 *   running costs   — rent, salary, electricity, internet, marketing, tea, fuel, AC
 *   housekeeping    — GDS wallet top-up, petty-cash IOU + settlement, daily banking
 *
 * IDEMPOTENT: every id is fixed (TK-88101…, JV-SB01…), so running it twice
 * updates the same rows instead of doubling the book. Journals are keyed by the
 * same ids, and ledger.post upserts by id.
 *
 * EXPOSES: EPAL.sampleBook.write() -> a report object (what it wrote + the books)
 *          EPAL.sampleBook.present() -> true if this book is already in the data
 * ==========================================================================*/
(function (EPAL) {
  'use strict';

  var CID = 'travels';

  function write() {
    var db = EPAL.db, L = EPAL.ledger, S = EPAL.store, pay = EPAL.pay;
    var made = { tickets: 0, visas: 0, other: 0, expenses: 0, moves: 0 };

    /* the accounts this book trades through */
    function bank(id, name, type, bal, acct) {
      if (!db.col('banks').filter(function (x) { return x.id === id; })[0]) {
        db.save('banks', { id: id, name: name, type: type, status: 'Active', companyId: CID,
          balance: bal, account: acct, branch: 'Gulshan', currency: 'BDT' });
      }
      return id;
    }
    var EBL   = bank('SB-EBL',   'Eastern Bank · Gulshan',  'Bank',     2850000, '1041290085321');
    var DBBL  = bank('SB-DBBL',  'Dutch-Bangla · Banani',   'Bank',     1120000, '1461100094552');
    var BOX   = bank('SB-CASH',  'Office Cash Box',         'Cash Box',   95000, '');
    var BKASH = bank('SB-BKASH', 'bKash Merchant · 01711…', 'bKash',     180000, '01711002233');

    /* the trading partners */
    function agent(id, name, pct) {
      if (!db.col('tv_agents').filter(function (a) { return a.id === id; })[0]) {
        db.save('tv_agents', { id: id, name: name, agency: name, type: 'Sub-Agent', commission: pct,
          phone: '017' + (10000000 + Math.round(pct * 137891)), email: '', balance: 0,
          companyId: CID, status: 'Active' });
      }
      return name;
    }
    var A_SKY = agent('SB-AG1', 'Sky Travels & Tours', 3);
    var A_NEXT = agent('SB-AG2', 'NextStop Holidays', 2.5);
    [['SB-V1', 'Biman Bangladesh Airlines', 'Ticketing'], ['SB-V2', 'Emirates', 'Ticketing'],
     ['SB-V3', 'VFS Global', 'Visa'], ['SB-V4', 'Sea Pearl Beach Resort', 'Hotel']].forEach(function (v) {
      if (!db.col('vendors').filter(function (x) { return x.id === v[0]; })[0]) {
        db.save('vendors', { id: v[0], name: v[1], type: v[2], balance: 0, creditLimit: 500000,
          terms: 'Net 15', companyId: CID, status: 'Active' });
      }
    });
    if (!db.col('tv_portals').filter(function (p) { return p.id === 'SB-PRT'; })[0]) {
      db.save('tv_portals', { id: 'SB-PRT', name: 'Galileo · Travelport', type: 'GDS',
        url: 'https://api.travelport.com', balance: 0, autoSync: 'Hourly', status: 'Connected', companyId: CID });
    }

    /* ── the GDS wallet has to be funded before a booking can draw on it ──── */
    if (!L.entries({ companyId: CID }).some(function (e) { return e.ref === 'WIRE-0720'; })) {
      pay.portalTopUp({ portalId: 'SB-PRT', amount: 400000, source: 'bank:' + EBL,
        date: '2026-07-20', ref: 'WIRE-0720', memo: 'Galileo wallet top-up', companyId: CID });
      made.moves++;
    }

    /* ── 1 · FIVE AIR TICKETS ─────────────────────────────────────────────── */
    var TICKETS = [
      { id: 'TK-88101', pax: 'Md Imran Hossain', pnr: 'LE5275', tno: '997-4410882301', route: 'DAC → DXB',
        from: 'DAC', to: 'DXB', air: 'EK', airline: 'Emirates', base: 64200, tax: 8300, sale: 79500,
        vendor: 'Emirates', date: '2026-07-06', travel: '2026-07-19', into: EBL, paidFrom: EBL, agent: '' },
      { id: 'TK-88102', pax: 'Nusrat Jahan Rimi', pnr: 'QW8812', tno: '997-4410882345', route: 'DAC → KUL',
        from: 'DAC', to: 'KUL', air: 'BG', airline: 'Biman Bangladesh Airlines', base: 38900, tax: 4600, sale: 48200,
        vendor: 'Biman Bangladesh Airlines', date: '2026-07-09', travel: '2026-07-25', into: BKASH, paidFrom: EBL, agent: '' },
      { id: 'TK-88103', pax: 'Abdul Karim Sheikh', pnr: 'RT2290', tno: '997-4410882388', route: 'DAC → JED',
        from: 'DAC', to: 'JED', air: 'SV', airline: 'Saudia', base: 96500, tax: 11200, sale: 118000,
        vendor: 'Saudia', date: '2026-07-13', travel: '2026-08-02', into: '', paidFrom: EBL, agent: '' },
      { id: 'TK-88104', pax: 'Farhana Akter', pnr: 'YU5541', tno: '997-4410882401', route: 'DAC → BKK',
        from: 'DAC', to: 'BKK', air: 'TG', airline: 'Thai Airways', base: 52400, tax: 6100, sale: 66800,
        vendor: 'Thai Airways', date: '2026-07-17', travel: '2026-07-30', into: DBBL, paidFrom: DBBL, agent: 'SB-AG1' },
      { id: 'TK-88105', pax: 'Shahidul Islam', pnr: 'PL7723', tno: '997-4410882437', route: 'DAC → DOH',
        from: 'DAC', to: 'DOH', air: 'QR', airline: 'Qatar Airways', base: 71800, tax: 8900, sale: 89400,
        vendor: 'Qatar Airways', date: '2026-07-22', travel: '2026-08-08', into: EBL, portal: 'SB-PRT', agent: 'SB-AG2' }
    ];
    TICKETS.forEach(function (t) {
      var cost = t.base + t.tax;
      var ag = t.agent ? db.col('tv_agents').filter(function (a) { return a.id === t.agent; })[0] : null;
      var comm = ag ? Math.round(t.base * (+ag.commission || 0) / 100) : 0;
      var paid = !!t.into;
      db.saveAirTicket({ id: t.id, pnr: t.pnr, ticketNo: t.tno, passenger: t.pax, phone: '', passport: '',
        fromCode: t.from, toCode: t.to, route: t.route, tripType: 'One-way', airlineCode: t.air, airline: t.airline,
        flightNo: t.air + (100 + (t.base % 800)), vendor: t.vendor,
        portal: t.portal ? 'Galileo · Travelport' : 'Direct', travelDate: t.travel, purchaseDate: t.date,
        baseFare: t.base, taxes: t.tax, markup: t.sale - cost, commission: comm,
        commissionPct: ag ? ag.commission : 0, agent: t.agent || '', agentName: ag ? ag.name : '',
        cost: cost, sale: t.sale, costPaid: cost, payStatus: 'Paid',
        custStatus: paid ? 'Paid' : 'Due', bankId: t.into || '',
        bankName: paid ? ((pay.byId(t.into) || {}).name || '') : '',
        costBankId: t.portal ? '' : t.paidFrom, costPortalId: t.portal || '',
        currency: 'BDT', status: 'Issued', created: t.date,
        timeline: [{ at: Date.parse(t.date), text: 'Ticket issued' }] });
      db.postSale(CID, { amount: t.sale, cost: cost, ref: t.id, date: t.date,
        desc: 'Air ticket ' + t.route + ' (' + t.air + ') · ' + t.pax, customer: t.pax,
        category: 'air', vendor: t.vendor, commission: comm, agent: ag ? ag.name : '',
        paid: paid, payStatus: paid ? 'Paid' : 'Due', bankId: t.into || '',
        costPaid: true, costBankId: t.portal ? '' : t.paidFrom, costPortalId: t.portal || '' });
      made.tickets++;
    });

    /* ── 2 · FIVE VISA FILES ──────────────────────────────────────────────── */
    var VISAS = [
      { id: 'VA-51201', who: 'Tanvir Ahmed', country: 'United Arab Emirates', type: 'Tourist 30d', cost: 16800, sale: 21500, date: '2026-07-04', into: EBL },
      { id: 'VA-51202', who: 'Sumaiya Khatun', country: 'Malaysia', type: 'eVisa', cost: 9400, sale: 13200, date: '2026-07-08', into: BOX },
      { id: 'VA-51203', who: 'Rafiqul Islam', country: 'Saudi Arabia', type: 'Umrah', cost: 24500, sale: 31000, date: '2026-07-12', into: EBL },
      { id: 'VA-51204', who: 'Jannatul Ferdous', country: 'Thailand', type: 'Tourist 60d', cost: 11200, sale: 15800, date: '2026-07-19', into: BKASH },
      { id: 'VA-51205', who: 'Mahbub Alam Chowdhury', country: 'Schengen · Italy', type: 'Business', cost: 32800, sale: 42500, date: '2026-07-24', into: '' }
    ];
    VISAS.forEach(function (v) {
      var paid = !!v.into;
      db.saveVisaApp({ id: v.id, applicant: v.who, phone: '', passport: 'BX' + (1000000 + v.cost),
        country: v.country, visaType: v.type, cost: v.cost, sale: v.sale, stage: 'Approved',
        travelDate: v.date, agent: '', payStatus: paid ? 'Paid' : 'Due', bankId: v.into || '',
        companyId: CID, created: v.date, posted: true });
      db.postSale(CID, { amount: v.sale, cost: v.cost, ref: v.id, date: v.date,
        desc: 'Visa ' + v.country + ' · ' + v.type, customer: v.who, category: 'visa',
        vendor: 'VFS Global', paid: paid, payStatus: paid ? 'Paid' : 'Due', bankId: v.into || '',
        costPaid: true, costBankId: EBL });
      made.visas++;
    });

    /* ── 3 · FIVE OTHER SALES ─────────────────────────────────────────────── */
    [{ ref: 'CF-7701', desc: 'Contract flight seats · DAC → CXB block of 12', who: 'Bengal Tours Ltd',
       cat: 'contract', cost: 186000, sale: 243000, date: '2026-07-07', into: EBL, vendor: 'Novoair' },
     { ref: 'HB-3310', desc: 'Hotel booking · Sea Pearl Cox’s Bazar · 4 nights', who: 'Rezaul Karim',
       cat: 'hotel', cost: 48000, sale: 61500, date: '2026-07-11', into: DBBL, vendor: 'Sea Pearl Beach Resort' },
     { ref: 'EMD-2204', desc: 'EMD · excess baggage 20kg · DAC → DXB', who: 'Md Imran Hossain',
       cat: 'emd', cost: 7200, sale: 9800, date: '2026-07-14', into: BOX, vendor: 'Emirates' },
     { ref: 'PK-1180', desc: 'Umrah package · 14 days · 2 pax', who: 'Hafizur Rahman',
       cat: 'package', cost: 412000, sale: 498000, date: '2026-07-18', into: EBL, vendor: 'Al Haramain Travels' },
     { ref: 'CS-0904', desc: 'Immigration consultancy · Canada study file', who: 'Ishrat Binte Alam',
       cat: 'consultancy', cost: 0, sale: 35000, date: '2026-07-26', into: BKASH, vendor: '' }
    ].forEach(function (o) {
      db.postSale(CID, { amount: o.sale, cost: o.cost, ref: o.ref, date: o.date, desc: o.desc,
        customer: o.who, category: o.cat, vendor: o.vendor, paid: true, payStatus: 'Paid',
        bankId: o.into, costPaid: o.cost > 0, costBankId: o.cost > 0 ? EBL : '' });
      made.other++;
    });

    /* ── 4 · EXPENSES — the ones a sale drags with it, and the monthly ones ── */
    function voucher(o) {
      var src = pay.resolve('bank:' + o.acct);
      var glId = 'GL-ACC-' + o.id;
      L.post({ id: glId, date: o.date, companyId: CID, ref: o.id, source: 'manual', party: o.party || '',
        memo: o.desc, lines: [{ account: o.head, dr: o.amount, cr: 0 }, { account: src.gl, dr: 0, cr: o.amount }] });
      db.save('acc_entries', { id: o.id, companyId: CID, kind: 'Expense', amount: o.amount,
        category: o.cat, subCategory: o.sub || '', date: o.date, party: o.party || '',
        ref: o.ref || o.id, desc: o.desc, method: src.method,
        payAcct: (src.bank || {}).name || '', bankId: (src.bank || {}).id || '', glId: glId, created: o.date });
      pay.syncRegister({ id: o.id, companyId: CID, bankId: (src.bank || {}).id || '', kind: 'Expense',
        amount: o.amount, category: o.cat, party: o.party || '', ref: o.id, date: o.date, glId: glId }, null);
      made.expenses++;
    }
    // the sub-agents are paid what the sales owed them — clears 2000, never 5350 twice
    [['SB-CP1', A_SKY, 1572, '2026-07-21'], ['SB-CP2', A_NEXT, 1795, '2026-07-27']].forEach(function (c) {
      var src = pay.resolve('bank:' + EBL);
      var glId = 'GL-COMM-' + c[0];
      L.post({ id: glId, date: c[3], companyId: CID, ref: 'COMM-' + c[1], source: 'payment', party: c[1],
        memo: 'Agent commission payout · ' + c[1] + ' · ' + src.bank.name,
        lines: [{ account: '2000', dr: c[2], cr: 0 }, { account: src.gl, dr: 0, cr: c[2] }] });
      S.upsert('tv_comm_paid', { id: c[0], agent: c[1], name: c[1], amount: c[2], date: c[3],
        method: src.method, bankId: src.bank.id, bankName: src.bank.name });
      pay.syncRegister({ id: c[0], bankId: src.bank.id, kind: 'Expense', amount: c[2],
        category: 'Agent commission', party: c[1], ref: 'COMM-' + c[1], date: c[3],
        companyId: CID, glId: glId }, null);
      made.moves++;
    });
    voucher({ id: 'JV-SB01', date: '2026-07-15', head: '6000', cat: 'Fees & Charges', sub: 'BSP Fee',
      desc: 'BSP weekly settlement charge', party: 'IATA BSP Bangladesh', amount: 4850, acct: EBL, ref: 'BSP-W28' });
    voucher({ id: 'JV-SB02', date: '2026-07-16', head: '5600', cat: 'Conveyance & Travel', sub: 'Courier',
      desc: 'Passport & visa courier — 9 files', party: 'Sundarban Courier', amount: 2350, acct: BOX });
    voucher({ id: 'JV-SB03', date: '2026-07-23', head: '5500', cat: 'Office Management', sub: 'Stationery',
      desc: 'Ticket jackets & printing', party: 'Nilkhet Print House', amount: 3900, acct: BOX });
    voucher({ id: 'JV-SB04', date: '2026-07-02', head: '5200', cat: 'Office Rent', sub: '',
      desc: 'Office rent — July 2026', party: 'Gulshan Properties Ltd', amount: 85000, acct: EBL });
    voucher({ id: 'JV-SB05', date: '2026-07-03', head: '5300', cat: 'Utilities', sub: 'Electricity',
      desc: 'DESCO electricity — June bill', party: 'DESCO', amount: 14200, acct: EBL });
    voucher({ id: 'JV-SB06', date: '2026-07-03', head: '5300', cat: 'Utilities', sub: 'Internet',
      desc: 'Broadband + IP phone', party: 'Link3 Technologies', amount: 6500, acct: DBBL });
    voucher({ id: 'JV-SB07', date: '2026-07-10', head: '5400', cat: 'Marketing', sub: 'Facebook Ads',
      desc: 'Facebook campaign — Umrah packages', party: 'Meta Platforms', amount: 22000, acct: DBBL });
    voucher({ id: 'JV-SB08', date: '2026-07-12', head: '5550', cat: 'Food & Entertainment', sub: 'Tea & Snacks',
      desc: 'Office tea, snacks & guest refreshments', party: 'Local vendor', amount: 4600, acct: BOX });
    voucher({ id: 'JV-SB09', date: '2026-07-20', head: '5600', cat: 'Conveyance & Travel', sub: 'Fuel',
      desc: 'Fuel & CNG — office car', party: 'Padma Filling Station', amount: 9800, acct: BOX });
    voucher({ id: 'JV-SB10', date: '2026-07-25', head: '5500', cat: 'Office Management', sub: 'Repair & Maintenance',
      desc: 'AC servicing — 3 units', party: 'Cool Tech Services', amount: 7200, acct: BOX });
    voucher({ id: 'JV-SB11', date: '2026-07-05', head: '5100', cat: 'Staff Salary', sub: 'Salary',
      desc: 'Staff salary — June 2026 (4 staff)', party: 'Payroll', amount: 168000, acct: EBL });

    /* ── 5 · CASH HOUSEKEEPING — an IOU, and banking the drawer ───────────── */
    var iou = { id: 'PC-SB01', companyId: CID, staff: 'Rasel Mahmud', amount: 5000,
      purpose: 'Embassy fees & courier', date: '2026-07-15', status: 'Open', glId: 'GL-PCI-PC-SB01' };
    pay.stamp(iou, 'bank:' + BOX);
    L.post({ id: iou.glId, date: iou.date, companyId: CID, ref: iou.id, source: 'manual', party: iou.staff,
      memo: 'Petty-cash IOU · ' + iou.staff + ' · ' + iou.purpose,
      lines: [{ account: '1250', dr: 5000, cr: 0 }, { account: pay.glAcctOf(pay.byId(BOX)), dr: 0, cr: 5000 }] });
    db.save('tv_petty', iou);
    pay.syncRegister({ id: iou.id, companyId: CID, bankId: BOX, kind: 'Expense', amount: 5000,
      category: 'Petty-cash IOU', party: iou.staff, ref: iou.id, date: iou.date, glId: iou.glId }, null);
    L.post({ id: 'GL-PCS-PC-SB01', date: '2026-07-17', companyId: CID, ref: iou.id, source: 'manual', party: iou.staff,
      memo: 'Petty cash · ' + iou.staff + ' · Embassy & courier',
      lines: [{ account: '5600', dr: 4300, cr: 0 }, { account: '1250', dr: 0, cr: 4300 }] });
    L.post({ id: 'GL-PCR-PC-SB01', date: '2026-07-17', companyId: CID, ref: iou.id, source: 'manual', party: iou.staff,
      memo: 'Petty cash returned · ' + iou.staff,
      lines: [{ account: pay.glAcctOf(pay.byId(BOX)), dr: 700, cr: 0 }, { account: '1250', dr: 0, cr: 700 }] });
    iou.status = 'Settled'; iou.category = 'Courier'; iou.billAmount = 4300; iou.settledDate = '2026-07-17';
    db.save('tv_petty', iou);
    pay.syncRegister({ id: iou.id + '-BACK', companyId: CID, bankId: BOX, kind: 'Income', amount: 700,
      category: 'Petty-cash returned', party: iou.staff, ref: iou.id, date: '2026-07-17', glId: 'GL-PCR-PC-SB01' }, null);
    made.moves++;

    if (!L.entries({ companyId: CID }).some(function (e) { return e.ref === 'BT-SB01'; })) {
      L.post({ id: 'GL-BT-SB01', date: '2026-07-28', companyId: CID, ref: 'BT-SB01', source: 'bank',
        memo: 'Transfer · Office Cash Box → Eastern Bank · Gulshan — daily banking',
        lines: [{ account: pay.glAcctOf(pay.byId(EBL)), dr: 40000, cr: 0 },
                { account: pay.glAcctOf(pay.byId(BOX)), dr: 0, cr: 40000 }] });
      EPAL.bankTxnApply(pay.byId(BOX), 'transfer-out', 40000, '2026-07-28', 'Transfer to Eastern Bank · Gulshan — daily banking', 'BT-SB01');
      EPAL.bankTxnApply(pay.byId(EBL), 'transfer-in', 40000, '2026-07-28', 'Transfer from Office Cash Box — daily banking', 'BT-SB01');
      S.upsert('bank_transfers', { id: 'BT-SB01', from: BOX, fromName: 'Office Cash Box', to: EBL,
        toName: 'Eastern Bank · Gulshan', amount: 40000, date: '2026-07-28', memo: 'Daily banking' });
      made.moves++;
    }

    return report(made, TICKETS, VISAS);
  }

  /* ---- what it wrote, read back out of the books ------------------------- */
  function report(made, TICKETS, VISAS) {
    var db = EPAL.db, L = EPAL.ledger, S = EPAL.store;
    var MINE = {};
    (TICKETS || []).forEach(function (t) { MINE[t.id] = 1; });
    (VISAS || []).forEach(function (v) { MINE[v.id] = 1; });
    ['CF-7701', 'HB-3310', 'EMD-2204', 'PK-1180', 'CS-0904',
     'JV-SB01', 'JV-SB02', 'JV-SB03', 'JV-SB04', 'JV-SB05', 'JV-SB06',
     'JV-SB07', 'JV-SB08', 'JV-SB09', 'JV-SB10', 'JV-SB11',
     'COMM-Sky Travels & Tours', 'COMM-NextStop Holidays',
     'PC-SB01', 'BT-SB01', 'WIRE-0720'].forEach(function (r) { MINE[r] = 1; });

    var mine = { revenue: 0, cogs: 0, opex: 0, byHead: {} };
    L.entries({ companyId: CID }).forEach(function (e) {
      if (!MINE[e.ref]) return;
      (e.lines || []).forEach(function (l) {
        var a = L.account(l.account); if (!a) return;
        var v = (+l.dr || 0) - (+l.cr || 0), key = l.account + ' ' + a.name;
        if (a.type === 'income') { mine.revenue += -v; mine.byHead[key] = (mine.byHead[key] || 0) + -v; }
        else if (a.type === 'expense') {
          if (l.account === '5000') mine.cogs += v; else mine.opex += v;
          mine.byHead[key] = (mine.byHead[key] || 0) + v;
        }
      });
    });
    var p = L.pnl(CID), dr = 0, cr = 0;
    L.trialBalance(CID).forEach(function (r) { dr += +r.debit || 0; cr += +r.credit || 0; });
    function bal(c) { return Math.round(L.balance(c, { companyId: CID })); }
    return {
      made: made,
      mine: { revenue: Math.round(mine.revenue), cogs: Math.round(mine.cogs),
              gross: Math.round(mine.revenue - mine.cogs), opex: Math.round(mine.opex),
              net: Math.round(mine.revenue - mine.cogs - mine.opex),
              heads: Object.keys(mine.byHead).sort().map(function (k) { return k + ' = ' + Math.round(mine.byHead[k]); }) },
      accounts: db.col('banks').filter(function (b) { return b.companyId === CID && String(b.id).indexOf('SB-') === 0; })
        .map(function (b) { return { name: b.name, balance: Math.round(b.balance || 0) }; }),
      wallet: bal('1180'),
      pnl: { revenue: Math.round(p.revenue), cogs: Math.round(p.cogs), gross: Math.round(p.gross),
             opex: Math.round(p.expenses), net: Math.round(p.net) },
      owed: { customers: bal('1200'), agents: bal('1150'), vendors: bal('2000'), staffAdvance: bal('1250') },
      registerRows: S.list('bank_txns').filter(function (t) { return String(t.bankId || '').indexOf('SB-') === 0; }).length,
      journals: L.entries({ companyId: CID }).length,
      trial: { debit: Math.round(dr), credit: Math.round(cr), out: Math.round(dr - cr) },
      group: Math.round(L.consolidatedPnl().totals.group.net)
    };
  }

  EPAL.sampleBook = {
    write: write,
    present: function () {
      try { return EPAL.store.list('airTickets').some(function (t) { return t.id === 'TK-88101'; }); }
      catch (e) { return false; }
    }
  };
})(window.EPAL = window.EPAL || {});
