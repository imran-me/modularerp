/* ============================================================================
   EPAL TRAVELS ERP  ·  travels/assets/packages.js
   ----------------------------------------------------------------------------
   Alpine component for packages.html — the PACKAGE BUILDER. A package is a
   booking that bundles ANY mix of services as line items (flight ticket, hotel,
   visa, transfer, insurance, tour…). The agent adds lines, prices each (cost &
   sale), sees live totals + profit, then books & takes payment as ONE deal. It
   persists via TV.bookPackage()/TV.pay() and flows into Manage Sales/Dashboard.
   ⇒ Laravel: a PackageController + a Booking has-many BookingLine + Services.
   ========================================================================== */
(function (w) {
  'use strict';
  w.packageApp = function () {
    return {
      serviceTypes: (w.TV ? TV.serviceTypes() : []),
      agents: (w.TV ? TV.agents() : []),
      recent: (w.TV ? TV.bookings().filter(function (b) { return b.type === 'package'; }) : []),
      pkg: {
        customer: '', title: '',
        lines: [{ type: 'Flight Ticket', desc: '', cost: null, sale: null }]
      },
      pay: { method: 'bKash', ref: '', agentId: '' },
      step: 1,            // 1 build · 2 payment · 3 done
      lastRef: '',

      addLine: function () { this.pkg.lines.push({ type: 'Hotel', desc: '', cost: null, sale: null }); },
      removeLine: function (i) { this.pkg.lines.splice(i, 1); },

      get totalCost() { return this.pkg.lines.reduce(function (s, l) { return s + (+l.cost || 0); }, 0); },
      get totalSale() { return this.pkg.lines.reduce(function (s, l) { return s + (+l.sale || 0); }, 0); },
      get profit() { return this.totalSale - this.totalCost; },
      lineProfit: function (l) { return (+l.sale || 0) - (+l.cost || 0); },

      toPay: function () {
        if (!this.pkg.customer.trim()) { alert('Customer name is required'); return; }
        if (this.totalSale <= 0) { alert('Add at least one line with a sale price'); return; }
        this.step = 2;
      },

      confirm: function () {
        if (this.pay.method === 'Agent Credit' && !this.pay.agentId) { alert('Select the agent'); return; }
        var clean = this.pkg.lines.filter(function (l) { return (+l.sale || 0) > 0 || (l.desc || '').trim(); });
        var b = TV.bookPackage({
          customer: this.pkg.customer.trim(),
          title: this.pkg.title.trim() || 'Custom Package',
          lines: clean,
          agentId: this.pay.method === 'Agent Credit' ? this.pay.agentId : ''
        });
        TV.pay({ bookingId: b.id, amount: b.sale, method: this.pay.method, ref: this.pay.ref || (this.pay.method + '-' + Date.now().toString().slice(-6)), agentId: this.pay.agentId, status: 'Paid' });
        this.lastRef = b.id + ' · ' + b.title;
        this.step = 3;
      },

      reset: function () {
        this.pkg = { customer: '', title: '', lines: [{ type: 'Flight Ticket', desc: '', cost: null, sale: null }] };
        this.pay = { method: 'bKash', ref: '', agentId: '' };
        this.recent = TV.bookings().filter(function (b) { return b.type === 'package'; });
        this.step = 1;
      },

      fmt: function (n) { return w.TV ? TV.money(n) : n; }
    };
  };
})(window);
