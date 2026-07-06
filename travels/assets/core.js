/* ============================================================================
   EPAL TRAVELS ERP  ·  travels/assets/core.js
   ----------------------------------------------------------------------------
   THE DATA BACKBONE. This is what makes the Travels front-end a real ERP and not
   a static website: every screen reads and writes REAL records that PERSIST
   (localStorage) and flow between pages — a flight booked on flight-search.html
   shows up in air-ticketing.html (Manage Sales) and on the dashboard, and its
   payment lands in the payments ledger.

   It is deliberately structured like a backend so a Laravel developer can port
   it 1:1:
     TV.store         → the persistence layer          ⇒ Eloquent / the database
     TV.seed()        → first-run demo data            ⇒ Database Seeders
     TV.bookings()... → repository-style accessors      ⇒ Models + Repositories
     TV.book()/pay()  → business transactions           ⇒ Services (BookingService…)
     helpers (money…) → formatting                      ⇒ Blade helpers

   Stores (localStorage keys under the "epalTravels." namespace):
     tv.bookings   {id, type(flight|hotel|visa|package), pax, route, airlineCode,
                    pnr, travelDate, base, tax, markup, commission, cost, sale,
                    profit, status, agentId, paid, created}
     tv.payments   {id, bookingId, amount, method(bKash|Nagad|Card|Bank|Agent Credit),
                    ref, status(Paid|Pending), at}
     tv.agents     {id, name, agency, phone, creditLimit, balance, commissionPct, status}
     tv.hotels     {id, name, city, country, star, board, nightlyFrom}
     tv.airlines   {code, name, country}   tv.airports {code, city, country}
   ========================================================================== */
(function (w) {
  'use strict';

  var NS = 'epalTravels.';

  /* ---- persistence layer (the swap seam for a real API) -------------------*/
  var store = {
    get: function (k, fb) { try { var r = localStorage.getItem(NS + k); return r == null ? (fb === undefined ? null : fb) : JSON.parse(r); } catch (e) { return fb; } },
    set: function (k, v) { try { localStorage.setItem(NS + k, JSON.stringify(v)); } catch (e) {} return v; },
    list: function (k) { return store.get(k, []) || []; },
    save: function (k, rec) {
      var arr = store.list(k), i = -1, j;
      for (j = 0; j < arr.length; j++) { if (arr[j].id === rec.id) { i = j; break; } }
      if (i >= 0) arr[i] = rec; else arr.unshift(rec);
      store.set(k, arr); return rec;
    },
    remove: function (k, id) { store.set(k, store.list(k).filter(function (r) { return r.id !== id; })); },
    seedOnce: function (k, data) { if (localStorage.getItem(NS + k) == null) store.set(k, data); }
  };

  /* ---- helpers ------------------------------------------------------------*/
  var seq = 0;
  function uid(prefix) { seq++; return (prefix || 'ID') + '-' + Date.now().toString().slice(-6) + seq; }
  function todayISO() { return new Date().toISOString().slice(0, 10); }
  function money(n, opts) {
    opts = opts || {}; n = +n || 0;
    if (opts.compact) {
      var a = Math.abs(n);
      if (a >= 1e7) return '৳' + (n / 1e7).toFixed(2).replace(/\.00$/, '') + ' Cr';
      if (a >= 1e5) return '৳' + (n / 1e5).toFixed(2).replace(/\.00$/, '') + ' L';
      if (a >= 1e3) return '৳' + Math.round(n / 1e3) + 'K';
    }
    return '৳' + n.toLocaleString('en-BD');
  }

  /* ---- seed data (Bangladesh travel context) ------------------------------*/
  var AIRLINES = [
    { code: 'BG', name: 'Biman Bangladesh', country: 'Bangladesh' },
    { code: 'EK', name: 'Emirates', country: 'UAE' },
    { code: 'QR', name: 'Qatar Airways', country: 'Qatar' },
    { code: 'SV', name: 'Saudia', country: 'Saudi Arabia' },
    { code: 'SQ', name: 'Singapore Airlines', country: 'Singapore' },
    { code: 'TK', name: 'Turkish Airlines', country: 'Turkey' },
    { code: 'MH', name: 'Malaysia Airlines', country: 'Malaysia' },
    { code: 'FZ', name: 'Flydubai', country: 'UAE' }
  ];
  var AIRPORTS = [
    { code: 'DAC', city: 'Dhaka', country: 'Bangladesh' }, { code: 'CGP', city: 'Chittagong', country: 'Bangladesh' },
    { code: 'DXB', city: 'Dubai', country: 'UAE' }, { code: 'JED', city: 'Jeddah', country: 'Saudi Arabia' },
    { code: 'RUH', city: 'Riyadh', country: 'Saudi Arabia' }, { code: 'SIN', city: 'Singapore', country: 'Singapore' },
    { code: 'KUL', city: 'Kuala Lumpur', country: 'Malaysia' }, { code: 'DOH', city: 'Doha', country: 'Qatar' },
    { code: 'IST', city: 'Istanbul', country: 'Turkey' }, { code: 'LHR', city: 'London', country: 'UK' },
    { code: 'JFK', city: 'New York', country: 'USA' }, { code: 'BKK', city: 'Bangkok', country: 'Thailand' }
  ];
  var AGENTS = [
    { id: 'AGT-01', name: 'Galaxy Travels', agency: 'Galaxy', phone: '+8801711000001', creditLimit: 1500000, balance: 420000, commissionPct: 3, status: 'active' },
    { id: 'AGT-02', name: 'Zamzam Tours', agency: 'Zamzam', phone: '+8801711000002', creditLimit: 800000, balance: 610000, commissionPct: 2.5, status: 'active' },
    { id: 'AGT-03', name: 'Sky Holidays', agency: 'Sky', phone: '+8801711000003', creditLimit: 500000, balance: 90000, commissionPct: 2, status: 'active' }
  ];
  var HOTELS = [
    { id: 'HTL-01', name: 'Swissôtel Al Maqam', city: 'Makkah', country: 'Saudi Arabia', star: 5, board: 'Room Only', nightlyFrom: 22000 },
    { id: 'HTL-02', name: 'Anwar Al Madinah Mövenpick', city: 'Madinah', country: 'Saudi Arabia', star: 5, board: 'Breakfast', nightlyFrom: 18000 },
    { id: 'HTL-03', name: 'Rove Downtown', city: 'Dubai', country: 'UAE', star: 4, board: 'Room Only', nightlyFrom: 12500 },
    { id: 'HTL-04', name: 'Sunway Putra', city: 'Kuala Lumpur', country: 'Malaysia', star: 4, board: 'Breakfast', nightlyFrom: 8500 }
  ];
  var BOOKINGS = [
    { id: 'TK-7042', type: 'flight', pax: 'Rahim Uddin', route: 'DAC → DXB', airlineCode: 'EK', pnr: 'HX42Q7', travelDate: '2026-07-18', base: 66000, tax: 12000, markup: 6200, commission: 0, cost: 78000, sale: 84200, profit: 6200, status: 'Issued', agentId: '', paid: true, created: '2026-07-04' },
    { id: 'TK-7041', type: 'flight', pax: 'Sadia Islam', route: 'DAC → JED', airlineCode: 'SV', pnr: 'KK81TZ', travelDate: '2026-07-22', base: 48000, tax: 8000, markup: 5500, commission: 0, cost: 56000, sale: 61500, profit: 5500, status: 'Issued', agentId: '', paid: true, created: '2026-07-03' },
    { id: 'TK-7039', type: 'flight', pax: 'Tanvir Hasan', route: 'DAC → SIN', airlineCode: 'SQ', pnr: 'Q2M4PL', travelDate: '2026-07-30', base: 37000, tax: 6000, markup: 4200, commission: 0, cost: 43000, sale: 47200, profit: 4200, status: 'Hold', agentId: '', paid: false, created: '2026-07-05' }
  ];
  var PAYMENTS = [
    { id: 'PAY-1001', bookingId: 'TK-7042', amount: 84200, method: 'bKash', ref: 'BKH8842', status: 'Paid', at: '2026-07-04' },
    { id: 'PAY-1002', bookingId: 'TK-7041', amount: 61500, method: 'Bank', ref: 'DBBL-5521', status: 'Paid', at: '2026-07-03' }
  ];

  function seed() {
    store.seedOnce('tv.airlines', AIRLINES);
    store.seedOnce('tv.airports', AIRPORTS);
    store.seedOnce('tv.agents', AGENTS);
    store.seedOnce('tv.hotels', HOTELS);
    store.seedOnce('tv.bookings', BOOKINGS);
    store.seedOnce('tv.payments', PAYMENTS);
  }

  /* ---- repository-style accessors + business transactions -----------------*/
  var TV = {
    store: store, uid: uid, money: money, todayISO: todayISO, seed: seed,

    airlines: function () { return store.list('tv.airlines'); },
    airports: function () { return store.list('tv.airports'); },
    airline: function (code) { return TV.airlines().filter(function (a) { return a.code === code; })[0] || { code: code, name: code }; },
    agents: function () { return store.list('tv.agents'); },
    agent: function (id) { return TV.agents().filter(function (a) { return a.id === id; })[0] || null; },
    hotels: function () { return store.list('tv.hotels'); },
    bookings: function () { return store.list('tv.bookings'); },
    payments: function () { return store.list('tv.payments'); },

    /* Create a booking record (the core ERP transaction). Computes cost/sale/
       profit so the numbers are always traceable. Returns the saved booking. */
    book: function (b) {
      b.id = b.id || uid(b.type === 'hotel' ? 'HB' : 'TK');
      b.base = +b.base || 0; b.tax = +b.tax || 0; b.markup = +b.markup || 0; b.commission = +b.commission || 0;
      b.cost = b.base + b.tax;
      b.sale = b.base + b.tax + b.markup;
      b.profit = b.markup - b.commission;
      b.status = b.status || 'Issued';
      b.paid = !!b.paid;
      b.created = b.created || todayISO();
      return store.save('tv.bookings', b);
    },

    /* Record a payment against a booking and mark it paid. If paid on agent
       credit, draw down the agent's available credit (balance). */
    pay: function (p) {
      p.id = p.id || uid('PAY');
      p.amount = +p.amount || 0;
      p.status = p.status || 'Paid';
      p.at = p.at || todayISO();
      store.save('tv.payments', p);
      var b = TV.bookings().filter(function (x) { return x.id === p.bookingId; })[0];
      if (b) { b.paid = true; if (b.status === 'Hold') b.status = 'Issued'; store.save('tv.bookings', b); }
      if (p.method === 'Agent Credit' && p.agentId) {
        var ag = TV.agent(p.agentId);
        if (ag) { ag.balance = Math.max(0, (ag.balance || 0) - p.amount); store.save('tv.agents', ag); }
      }
      return p;
    },

    /* Dashboard/report aggregates (read-model). */
    stats: function () {
      var bk = TV.bookings();
      var sale = 0, cost = 0, profit = 0, issued = 0, collected = 0;
      bk.forEach(function (b) { sale += b.sale || 0; cost += b.cost || 0; profit += b.profit || 0; if (b.status === 'Issued') issued++; if (b.paid) collected += b.sale || 0; });
      return { count: bk.length, sale: sale, cost: cost, profit: profit, issued: issued, collected: collected, receivable: sale - collected };
    },

    statusClass: function (s) {
      return ({ 'Issued': 'text-emerald-300 bg-emerald-500/10', 'Confirmed': 'text-sky-300 bg-sky-500/10',
        'Under Process': 'text-amber-300 bg-amber-500/10', 'Hold': 'text-amber-300 bg-amber-500/10',
        'Void': 'text-slate-300 bg-slate-500/10', 'Refunded': 'text-rose-300 bg-rose-500/10' })[s] || 'text-slate-300 bg-slate-500/10';
    }
  };

  seed();            // ensure demo data exists on first load
  w.TV = TV;
})(window);
