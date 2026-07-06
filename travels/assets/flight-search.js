/* ============================================================================
   EPAL TRAVELS ERP  ·  travels/assets/flight-search.js
   ----------------------------------------------------------------------------
   The Alpine.js component behind flight-search.html — a FUNCTIONAL flight search
   & booking flow (the #1 sellable feature). It is a real ERP transaction, not a
   demo screen: search returns fares, the agent picks one, enters the passenger,
   takes payment, and TV.book()/TV.pay() PERSIST a booking + payment that then
   appear in Manage Sales and on the Dashboard.

   Today it searches a built-in fare model (mock inventory). This is exactly the
   seam where a real GDS/NDC/LCC API (Amadeus, Sabre, Travelport, Duffel, TBO)
   plugs in later — replace search() with an API call; everything downstream
   (booking, payment, ledger) stays the same.
   ⇒ Laravel: a FlightSearchController hitting a supplier API + BookingService.
   ========================================================================== */
(function (w) {
  'use strict';

  // Indicative one-way base fare (BDT) per destination — stands in for live fares.
  var BASE = { DXB: 62000, JED: 52000, RUH: 54000, DOH: 58000, SIN: 41000, KUL: 38000, IST: 72000, LHR: 95000, JFK: 120000, BKK: 36000, DAC: 9000, CGP: 7000 };
  var TIMES = [['00:45', '05:10'], ['08:30', '13:05'], ['14:20', '19:00'], ['21:15', '02:40 +1'], ['11:05', '15:50']];
  // Which airlines plausibly fly a given destination (else all).
  var CARRIERS = ['BG', 'EK', 'QR', 'SV', 'SQ', 'TK', 'MH', 'FZ'];

  function fareFor(dest, i) {
    var b = BASE[dest] || 45000;
    var variance = [0, 0.06, -0.04, 0.11, 0.03][i % 5];     // per-airline spread
    return Math.round((b * (1 + variance)) / 100) * 100;
  }

  w.flightApp = function () {
    return {
      /* ---- state ---------------------------------------------------------*/
      airports: (w.TV ? TV.airports() : []),
      form: { from: 'DAC', to: 'DXB', date: '2026-07-20', pax: 1, cabin: 'Economy' },
      results: [], searched: false, searching: false, sort: 'price',
      selected: null,
      booking: { pax: '', passport: '', phone: '', markup: 5000 },
      pay: { method: 'bKash', ref: '', agentId: '' },
      step: 1,            // 1 search · 2 passenger · 3 pay · 4 confirmed
      lastRef: '',
      agents: (w.TV ? TV.agents() : []),

      /* ---- search (swap for a real supplier API) -------------------------*/
      search: function () {
        var self = this;
        if (this.form.from === this.form.to) { alert('Origin and destination must differ'); return; }
        this.searching = true; this.searched = false; this.selected = null; this.step = 1;
        // simulate a short network call so it feels live
        setTimeout(function () {
          var dest = self.form.to, out = [];
          for (var i = 0; i < 5; i++) {
            var code = CARRIERS[(i * 2 + dest.charCodeAt(0)) % CARRIERS.length];
            var al = w.TV ? TV.airline(code) : { code: code, name: code };
            var base = fareFor(dest, i);
            var tax = Math.round(base * 0.18 / 100) * 100;
            var t = TIMES[i % TIMES.length];
            out.push({
              airlineCode: code, airlineName: al.name,
              flightNo: code + (100 + i * 37 % 800),
              dep: t[0], arr: t[1],
              duration: (4 + (i % 4)) + 'h ' + ((i * 25) % 60) + 'm',
              stops: i % 3 === 0 ? 0 : (i % 3 === 1 ? 1 : 0),
              cabin: self.form.cabin, base: base, tax: tax, price: base + tax,
              seats: 3 + (i % 7)
            });
          }
          self.results = out; self.applySort(); self.searching = false; self.searched = true;
        }, 550);
      },
      applySort: function () {
        var key = this.sort;
        this.results.sort(function (a, b) { return key === 'price' ? a.price - b.price : (key === 'dep' ? a.dep.localeCompare(b.dep) : a.duration.localeCompare(b.duration)); });
      },
      routeLabel: function () { return this.form.from + ' → ' + this.form.to; },

      /* ---- pick a fare → collect passenger -------------------------------*/
      pick: function (f) {
        this.selected = f;
        this.booking.markup = Math.round(f.base * 0.06 / 100) * 100;   // suggested 6% markup
        this.step = 2;
        this.$nextTick ? this.$nextTick(function () {}) : 0;
      },
      get total() { return (this.selected ? this.selected.price : 0) + (+this.booking.markup || 0); },
      get profit() { return (+this.booking.markup || 0) - 0; },

      toPay: function () {
        if (!this.booking.pax.trim()) { alert('Passenger name is required'); return; }
        this.step = 3;
      },

      /* ---- confirm: PERSIST booking + payment (the ERP transaction) ------*/
      confirm: function () {
        if (this.pay.method === 'Agent Credit' && !this.pay.agentId) { alert('Select the agent'); return; }
        var f = this.selected;
        var b = TV.book({
          type: 'flight', pax: this.booking.pax.trim(), passport: this.booking.passport,
          phone: this.booking.phone, route: this.routeLabel(), airlineCode: f.airlineCode,
          pnr: (Math.random().toString(36).slice(2, 6) + Math.floor(1000 + Math.random() * 9000)).toUpperCase(),
          travelDate: this.form.date, base: f.base, tax: f.tax, markup: +this.booking.markup || 0,
          commission: 0, status: 'Issued',
          agentId: this.pay.method === 'Agent Credit' ? this.pay.agentId : ''
        });
        TV.pay({ bookingId: b.id, amount: b.sale, method: this.pay.method, ref: this.pay.ref || (this.pay.method + '-' + Date.now().toString().slice(-6)), agentId: this.pay.agentId, status: 'Paid' });
        this.lastRef = b.id + ' · PNR ' + b.pnr;
        this.step = 4;
      },
      reset: function () { this.step = 1; this.selected = null; this.booking = { pax: '', passport: '', phone: '', markup: 5000 }; this.pay = { method: 'bKash', ref: '', agentId: '' }; },

      fmt: function (n) { return w.TV ? TV.money(n) : n; }
    };
  };
})(window);
