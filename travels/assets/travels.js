/* ============================================================================
   EPAL TRAVELS ERP  ·  travels/assets/travels.js
   ----------------------------------------------------------------------------
   Shared JavaScript for the real, multi-page Travels front-end (HTML + Tailwind
   + Alpine). This is plain, framework-light JS: sample data, formatting helpers,
   and Chart.js initialisers. Page-level interactivity (menus, tabs, drawers)
   uses Alpine.js directly in the HTML via x-data / x-show attributes.

   ⇒ Laravel port: this data comes from your API/Eloquent; the helpers become
     Blade @php helpers or a small resources/js bundle; charts stay client-side.
   ========================================================================== */
(function (w) {
  'use strict';

  /* ---- formatting helpers (BDT, Bangladesh lakh/crore) --------------------*/
  var Travels = {
    money: function (n, opts) {
      opts = opts || {};
      n = +n || 0;
      if (opts.compact) {
        var a = Math.abs(n);
        if (a >= 1e7) return '৳' + (n / 1e7).toFixed(2).replace(/\.00$/, '') + ' Cr';
        if (a >= 1e5) return '৳' + (n / 1e5).toFixed(2).replace(/\.00$/, '') + ' L';
        if (a >= 1e3) return '৳' + (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
      }
      return '৳' + n.toLocaleString('en-BD');
    },
    num: function (n) { return (+n || 0).toLocaleString('en-BD'); },
    pct: function (n) { return (n > 0 ? '+' : '') + (+n || 0).toFixed(1) + '%'; }
  };

  /* ---- sample data (stand-in for the API; a Laravel dev swaps this) --------*/
  Travels.data = {
    kpis: [
      { label: 'Sales (MTD)', value: 4820000, delta: 12.4, icon: 'cash-coin', spark: [30,42,38,55,48,62,71] },
      { label: 'Tickets Issued', value: 386, money: false, delta: 8.1, icon: 'ticket-perforated', spark: [22,26,24,31,29,35,38] },
      { label: 'Gross Profit', value: 612000, delta: 5.6, icon: 'graph-up-arrow', spark: [12,14,13,16,15,18,19] },
      { label: 'Cash Collected', value: 3910000, delta: -3.2, icon: 'wallet2', spark: [40,38,42,39,36,35,34] }
    ],
    revenue: {
      labels: ['Jan','Feb','Mar','Apr','May','Jun','Jul'],
      revenue: [3.2, 3.6, 3.4, 4.1, 3.9, 4.5, 4.8].map(function (x) { return x * 1e6; }),
      profit:  [0.42,0.47,0.44,0.55,0.52,0.58,0.61].map(function (x) { return x * 1e6; })
    },
    mix: { labels: ['Air Ticketing', 'Visa', 'Umrah/Hajj', 'Hotels', 'Packages'], data: [58, 18, 12, 8, 4] },
    bookings: [
      { id: 'TK-7042', pax: 'Rahim Uddin', route: 'DAC → DXB', airline: 'EK', pnr: 'HX42Q7', fare: 84200, status: 'Issued' },
      { id: 'VA-5031', pax: 'Nusrat Jahan', route: 'Malaysia Tourist', airline: '—', pnr: 'MY-2231', fare: 26000, status: 'Under Process' },
      { id: 'TK-7041', pax: 'Sadia Islam', route: 'DAC → JED', airline: 'SV', pnr: 'KK81TZ', fare: 61500, status: 'Issued' },
      { id: 'CF-318',  pax: 'Group · 12 pax', route: 'DAC → JED (Umrah)', airline: 'BG', pnr: 'BLOCK-12', fare: 720000, status: 'Confirmed' },
      { id: 'TK-7039', pax: 'Tanvir Hasan', route: 'DAC → SIN', airline: 'SQ', pnr: 'Q2M4PL', fare: 47200, status: 'Hold' }
    ],
    deadlines: [
      { pnr: 'HX42Q7', pax: 'Rahim Uddin', airline: 'EK', hrs: 6, kind: 'Ticketing deadline' },
      { pnr: 'Q2M4PL', pax: 'Tanvir Hasan', airline: 'SQ', hrs: 21, kind: 'Ticketing deadline' },
      { pnr: 'CY-8841', pax: 'Farhana Akter', airline: '—', hrs: 44, kind: 'Visa decision due' }
    ]
  };

  /* ---- Chart.js initialisers ----------------------------------------------*/
  function baseFont() { return { family: 'Inter', size: 12 }; }

  Travels.drawRevenue = function (canvasId) {
    var el = document.getElementById(canvasId); if (!el || !w.Chart) return;
    var d = Travels.data.revenue;
    var g = el.getContext('2d').createLinearGradient(0, 0, 0, 240);
    g.addColorStop(0, 'rgba(59,111,168,0.38)'); g.addColorStop(1, 'rgba(59,111,168,0.02)');   // ocean-blue fill
    new w.Chart(el, {
      type: 'line',
      data: { labels: d.labels, datasets: [
        { label: 'Revenue', data: d.revenue, borderColor: '#3B6FA8', backgroundColor: g, fill: true, tension: 0.4, borderWidth: 2, pointRadius: 0, pointHoverRadius: 5 },
        { label: 'Profit', data: d.profit, borderColor: '#9BBBD8', backgroundColor: 'transparent', tension: 0.4, borderWidth: 2, pointRadius: 0, borderDash: [5,4] }   // sky-blue
      ]},
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#9fb0c9', font: baseFont(), usePointStyle: true, boxWidth: 8 } },
          tooltip: { callbacks: { label: function (c) { return c.dataset.label + ': ' + Travels.money(c.parsed.y, { compact: true }); } } } },
        scales: {
          x: { grid: { color: 'rgba(148,163,184,0.08)' }, ticks: { color: '#7c8aa5', font: baseFont() } },
          y: { grid: { color: 'rgba(148,163,184,0.08)' }, ticks: { color: '#7c8aa5', font: baseFont(), callback: function (v) { return Travels.money(v, { compact: true }); } } }
        }
      }
    });
  };

  Travels.drawMix = function (canvasId) {
    var el = document.getElementById(canvasId); if (!el || !w.Chart) return;
    var d = Travels.data.mix;
    new w.Chart(el, {
      type: 'doughnut',
      data: { labels: d.labels, datasets: [{ data: d.data,
        backgroundColor: ['#3B6FA8','#2C5486','#6E9AC6','#4E86B5','#7FA6CC'], borderColor: 'rgba(0,0,0,0.2)', borderWidth: 2 }] },   // blue family
      options: { responsive: true, maintainAspectRatio: false, cutout: '68%',
        plugins: { legend: { position: 'right', labels: { color: '#9fb0c9', font: baseFont(), usePointStyle: true, boxWidth: 8, padding: 12 } } } }
    });
  };

  /* status pill helper (returns Tailwind classes) ---------------------------*/
  Travels.statusClass = function (s) {
    return ({ 'Issued': 'text-emerald-300 bg-emerald-500/10', 'Confirmed': 'text-sky-300 bg-sky-500/10',
      'Under Process': 'text-amber-300 bg-amber-500/10', 'Hold': 'text-amber-300 bg-amber-500/10',
      'Void': 'text-slate-300 bg-slate-500/10', 'Refunded': 'text-rose-300 bg-rose-500/10' })[s] || 'text-slate-300 bg-slate-500/10';
  };

  w.Travels = Travels;
})(window);
