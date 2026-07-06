/* ============================================================================
 * EPAL GROUP ERP  ·  views/travels/contract-flight.js
 * ----------------------------------------------------------------------------
 * CONTRACT FLIGHT — block-seat inventory for the Travels desk. Epal buys blocks
 * of seats up-front on charters/allotments (Umrah, Hajj, worker & tourist runs)
 * and re-sells them seat-by-seat. Because the whole block is PRE-BOUGHT, every
 * unsold seat is trapped working capital and a hard deadline (departure day),
 * so the module is built around one anxiety: "sell the block before it flies".
 *
 * ONE registered view handles every sub-route (router falls back from
 * `.../manage-sales` to `travels/contract-flight`) and branches on ctx.subId:
 *
 *   schedule       (default) → cards/table per flight, seats/sold/UNSOLD, KPIs,
 *                              DEADLINE-RISK alerts, detail drawer + Sell Seats
 *   add-flight               → EPAL.formModal to contract a fresh seat block
 *   category                 → seat-block summary grouped by category + bar chart
 *   manage-sales             → contract-seat sales ledger + per-flight P&L + CSV
 *
 * Data lives in store `tv_contract_flights` (seeded idempotently by seed-bd.js):
 *   {id,airline,flightNo,route,category,depDate,seats,sold,costSeat,saleSeat,
 *    vendor,status,...}. Selling seats fires db.postSale('travels',…) so Travels
 *  + Group finance and the ledger all move live.
 * ==========================================================================*/

(function (EPAL) {
  'use strict';
  var ui = EPAL.ui, el = ui.el, db = EPAL.db, S = EPAL.store;

  var TODAY = '2026-07-05';           // demo "now" (matches the group clock)
  var RISK_WINDOW = 15;               // days-left threshold for the red alert
  var CATEGORIES = ['Umrah', 'Hajj', 'Tourist', 'Worker', 'Medical', 'Business', 'Student'];
  var CAT_COLOR = {
    Umrah:'#23c17e', Hajj:'#3B6FA8', Tourist:'#2f6bff', Worker:'#e2721b',
    Medical:'#f0506e', Business:'#7b5cff', Student:'#18a0a0'
  };

  function flights() { return db.col('tv_contract_flights'); }
  function flight(id) { return flights().filter(function (f) { return f.id === id; })[0] || null; }
  function unsoldOf(f) { return Math.max(0, (+f.seats || 0) - (+f.sold || 0)); }

  function daysLeft(depDate) {
    if (!depDate) return NaN;
    var a = new Date(depDate).getTime(), b = new Date(TODAY).getTime();
    if (isNaN(a)) return NaN;
    return Math.round((a - b) / 86400000);
  }
  function atRisk(f) {
    return unsoldOf(f) > 0 && f.status !== 'Departed' && daysLeft(f.depDate) <= RISK_WINDOW;
  }
  // Realized block revenue = sum of actual posted seat sales (finance ledger),
  // so P&L reconciles with db.postSale amounts and the Seat-Sale Revenue KPI
  // instead of the block LIST price (saleSeat), which sellSeats can override.
  function revOf(f) {
    var r = 0;
    db.sales('travels').forEach(function (s) {
      if (String(s.ref) === String(f.id)) r += (+s.amount || 0);
    });
    return r;
  }
  // Block is pre-bought → cost is ALL seats; revenue is only what's sold.
  function pnlOf(f) { return revOf(f) - (+f.seats || 0) * (+f.costSeat || 0); }

  /* ================================================================ VIEW */
  EPAL.view('travels/contract-flight', {
    render: function (ctx) {
      var sub = ctx.subId || 'schedule';
      var page = el('div.page');
      var map = { schedule:'Flight Schedule', 'add-flight':'Add Contract Flight',
        category:'Seat Blocks by Category', 'manage-sales':'Contract-Seat Sales' };

      page.appendChild(EPAL.pageHead({
        eyebrow: 'Travels › Contract Flight', icon:'airplane-engines-fill',
        title: map[sub] || 'Contract Flight', sub: subDesc(sub),
        actions: [
          sub !== 'schedule' ? el('a.btn.btn-ghost', { href:'#/travels/contract-flight/schedule', html: ui.icon('calendar3') + ' Schedule' }) : null,
          sub !== 'add-flight' ? el('a.btn.btn-primary', { href:'#/travels/contract-flight/add-flight', html: ui.icon('plus-lg') + ' Add Flight' }) : null
        ]
      }));

      ({ schedule:schedule, 'add-flight':addFlight, category:category, 'manage-sales':manageSales }[sub] || schedule)(page, ctx);
      ctx.mount.appendChild(page);
    }
  });

  function subDesc(sub) {
    return ({ schedule:'Every contracted seat block — capacity, sold, unsold and departure-deadline risk.',
      'add-flight':'Contract a fresh block of seats from a charter or GSA allotment.',
      category:'Seat inventory, sell-through and revenue grouped by travel category.',
      'manage-sales':'Every seat sold off a contract block, with per-flight profit & CSV.' }[sub]) || '';
  }

  /* ============================================================ SCHEDULE */
  function schedule(page) {
    var host = el('div');
    page.appendChild(host);

    function draw() {
      host.innerHTML = '';
      var fl = flights();

      // --- KPIs -----------------------------------------------------------
      var totSeats = 0, totSold = 0, blocked = 0, riskCount = 0;
      fl.forEach(function (f) {
        totSeats += (+f.seats || 0); totSold += (+f.sold || 0);
        blocked += unsoldOf(f) * (+f.costSeat || 0);
        if (atRisk(f)) riskCount++;
      });
      var totUnsold = totSeats - totSold;
      host.appendChild(el('div.kpi-grid.stagger', null, [
        kpi('Total Seats', ui.num(totSeats), 'grid-3x3-gap-fill'),
        kpi('Seats Sold', ui.num(totSold), 'check2-circle'),
        kpi('Unsold Seats', ui.num(totUnsold), 'exclamation-diamond'),
        kpi('Blocked Capital', ui.money(blocked, { compact:true }), 'lock-fill'),
        kpi('Deadline Risk', String(riskCount), 'alarm-fill')
      ]));

      // --- deadline-risk alerts ------------------------------------------
      var risky = fl.filter(atRisk).sort(function (a, b) { return daysLeft(a.depDate) - daysLeft(b.depDate); });
      if (risky.length) {
        var alertBox = el('div.stagger', { style:{ margin:'4px 0 6px' } });
        risky.forEach(function (f) {
          var dl = daysLeft(f.depDate), un = unsoldOf(f);
          var msg = 'You have ' + un + ' unsold seat' + (un === 1 ? '' : 's') + ', ' +
            (dl < 0 ? 'departure passed ' + Math.abs(dl) + ' day' + (Math.abs(dl) === 1 ? '' : 's') + ' ago'
                    : dl + ' day' + (dl === 1 ? '' : 's') + ' left');
          alertBox.appendChild(el('div.alert.alert-danger', {
            style:{ display:'flex', alignItems:'center', gap:'10px', cursor:'pointer',
              background:'rgba(240,80,110,.12)', border:'1px solid rgba(240,80,110,.4)',
              borderRadius:'12px', padding:'12px 14px', marginBottom:'8px' },
            onclick: function () { drawer(f.id, draw); } }, [
            ui.frag('<i class="bi bi-exclamation-octagon-fill" style="color:#f0506e;font-size:20px"></i>'),
            el('div.flex-1', null, [
              el('div', { style:{ fontWeight:'700' }, html: ui.escapeHtml(f.airline) + ' · ' + ui.escapeHtml(f.flightNo) + ' · ' + ui.escapeHtml(f.route) }),
              el('div.text-bad.sm', { style:{ color:'#f0506e', fontWeight:'600' }, text: msg })
            ]),
            el('span.badge', { text: f.category })
          ]));
        });
        host.appendChild(alertBox);
      }

      // --- table ----------------------------------------------------------
      var tbl = EPAL.table({
        columns: [
          { key:'route', label:'Flight', render:function (r) {
              return '<div class="strong">' + ui.escapeHtml(r.airline) + '</div>' +
                     '<div class="text-mute xs">' + ui.escapeHtml(r.flightNo) + ' · ' + ui.escapeHtml(r.route) + '</div>'; } },
          { key:'category', label:'Category', render:function (r) { return catBadge(r.category).outerHTML; } },
          { key:'depDate', label:'Departure', render:function (r) {
              var dl = daysLeft(r.depDate);
              var tone = r.status === 'Departed' ? 'text-mute' : dl <= RISK_WINDOW ? 'text-bad' : dl <= 30 ? 'text-warn' : '';
              var lbl = r.status === 'Departed' ? 'departed' : (dl < 0 ? Math.abs(dl) + 'd ago' : dl + 'd left');
              return ui.date(r.depDate) + ' <span class="' + tone + ' xs">(' + lbl + ')</span>'; },
            sortVal:function (r) { return daysLeft(r.depDate); } },
          { key:'seats', label:'Seats', num:true },
          { key:'sold', label:'Sold', num:true },
          { key:'unsold', label:'Unsold', num:true, sortVal:function (r) { return unsoldOf(r); },
            render:function (r) { var u = unsoldOf(r);
              return '<span class="num ' + (u === 0 ? 'text-good' : atRisk(r) ? 'text-bad' : '') + '">' + u + '</span>'; } },
          { key:'fill', label:'Sell-through', sort:false, render:function (r) {
              var pct = r.seats ? Math.round((+r.sold || 0) / r.seats * 100) : 0;
              var col = pct >= 90 ? '#23c17e' : pct >= 50 ? '#3B6FA8' : '#f0506e';
              return '<div style="display:flex;align-items:center;gap:8px">' +
                '<div style="flex:1;height:7px;border-radius:6px;background:rgba(255,255,255,.08);overflow:hidden">' +
                '<div style="width:' + pct + '%;height:100%;background:' + col + '"></div></div>' +
                '<span class="num xs" style="min-width:34px">' + pct + '%</span></div>'; } },
          { key:'status', label:'Status', badge:{ Selling:'good', 'Sold Out':'', Departed:'warn' } }
        ],
        rows: function () { return flights(); },
        searchKeys: ['airline','flightNo','route','category','vendor','id'],
        filters: [{ key:'category', label:'Category' }, { key:'status', label:'Status' }],
        onRow: function (r) { drawer(r.id, draw); },
        exportName: 'contract-flights.csv',
        empty: { icon:'airplane', title:'No contract flights yet', hint:'Contract your first seat block from the Add Flight screen.' }
      });
      host.appendChild(el('div.card', null, [
        el('div.card-head', null, [ el('h3', { html: ui.icon('calendar3') + ' Contract Flight Schedule' }),
          el('span.card-sub', { text: fl.length + ' block' + (fl.length === 1 ? '' : 's') + ' contracted' }) ]),
        el('div.card-body', null, [ tbl.el ])
      ]));
    }
    draw();
  }

  /* ---- detail drawer + Sell Seats ------------------------------------- */
  function drawer(id, refresh) {
    var body = el('div');
    var m = ui.modal({ title:'Contract Flight', icon:'airplane-engines', size:'lg', body:body, footer:false });

    function redraw() {
      var f = flight(id);
      if (!f) { m.close(); return; }
      var un = unsoldOf(f), dl = daysLeft(f.depDate), pnl = pnlOf(f);
      body.innerHTML = '';

      body.appendChild(el('div.flex.gap-1.flex-wrap.mb-3.items-center', null, [
        el('span', { style:{ fontSize:'17px', fontWeight:'700' }, text: f.airline + ' · ' + f.flightNo }),
        catBadge(f.category), statusBadge(f.status), el('span.badge', { text: f.route }), el('span.badge', { text: f.id })
      ]));

      if (atRisk(f)) {
        body.appendChild(el('div.alert', {
          style:{ background:'rgba(240,80,110,.12)', border:'1px solid rgba(240,80,110,.4)', borderRadius:'10px',
            padding:'10px 12px', marginBottom:'12px', color:'#f0506e', fontWeight:'600', display:'flex', gap:'8px', alignItems:'center' },
          html: '<i class="bi bi-exclamation-octagon-fill"></i> You have ' + un + ' unsold seat' + (un === 1 ? '' : 's') + ', ' +
            (dl < 0 ? 'departure has passed' : dl + ' day' + (dl === 1 ? '' : 's') + ' left') + '.' }));
      }

      body.appendChild(el('div.form-grid', null, [
        kv('Departure', f.depDate ? ui.date(f.depDate) : '—'),
        kv('Days left', f.status === 'Departed' ? 'Departed' : (isNaN(dl) ? '—' : (dl < 0 ? Math.abs(dl) + 'd ago' : dl + ' days'))),
        kv('Total seats', ui.num(f.seats || 0)), kv('Sold', ui.num(f.sold || 0)),
        kv('Unsold', String(un)), kv('Vendor', f.vendor || '—'),
        kv('Cost / seat', ui.money(f.costSeat || 0)), kv('Sale / seat', ui.money(f.saleSeat || 0))
      ]));

      // Per-flight P&L card (block pre-bought) — revenue from realized sales
      var booked = revOf(f);
      var blockCost = (+f.seats || 0) * (+f.costSeat || 0);
      body.appendChild(el('div.section-label', { text:'Block Profit & Loss' }));
      body.appendChild(el('div.stat-row', null, [
        st2('Revenue booked', ui.money(booked)),
        st2('Block cost', ui.money(blockCost)),
        st2('Net P&L', ui.money(pnl))
      ]));
      body.appendChild(el('div.build-banner', { style:{ marginTop:'6px' } }, [ ui.frag(ui.icon('info-circle')),
        el('div', { html:'Whole block is pre-bought — the ' + un + ' unsold seat' + (un === 1 ? '' : 's') +
          ' represent <strong class="' + (pnl >= 0 ? 'text-good' : 'text-bad') + '">' + ui.money(un * (+f.costSeat || 0)) +
          '</strong> of blocked capital until sold.' }) ]));

      // Controls
      body.appendChild(el('div.divider'));
      var canDelete = !EPAL.perm || EPAL.perm.can('travels', 'contract-flight', 'delete');
      body.appendChild(el('div.flex.gap-1.flex-wrap', null, [
        el('button.btn.btn-primary', { html: ui.icon('cart-plus') + ' Sell Seats',
          disabled: un <= 0 ? 'disabled' : null,
          onclick: function () { sellSeats(id, function () { redraw(); refresh && refresh(); }); } }),
        el('button.btn.btn-sm.btn-outline', { html: ui.icon('printer') + ' Block Voucher',
          onclick: function () { blockVoucher(f); } }),
        f.status !== 'Departed' ? el('button.btn.btn-sm.btn-ghost', { html: ui.icon('airplane') + ' Mark Departed',
          onclick: function () { f.status = 'Departed'; db.save('tv_contract_flights', f); ui.toast('Flight marked departed', 'success'); redraw(); refresh && refresh(); } }) : null,
        canDelete ? el('button.btn.btn-sm.btn-danger', { html: ui.icon('trash') + ' Delete',
          onclick: function () { ui.confirm({ title:'Delete contract flight?', body:'This removes the block ' + f.id + '.', danger:true, confirmLabel:'Delete' }).then(function (ok) {
            if (ok) { db.remove('tv_contract_flights', f.id); m.close(); refresh && refresh(); ui.toast('Contract flight deleted', 'success'); } }); } }) : null
      ]));

      // Comments thread
      if (EPAL.comments && EPAL.comments.widget) {
        body.appendChild(el('div.section-label', { text:'Discussion' }));
        body.appendChild(EPAL.comments.widget('contract-flight', f.id));
      }
    }
    redraw();
  }

  function sellSeats(id, done) {
    var f = flight(id);
    if (!f) return;
    var un = unsoldOf(f);
    EPAL.formModal({
      title:'Sell Seats · ' + f.route, icon:'cart-plus', size:'md',
      fields: [
        { type:'section', label:f.airline + ' · ' + f.flightNo + ' — ' + un + ' seat' + (un === 1 ? '' : 's') + ' available' },
        { key:'qty', label:'Seats to sell', type:'number', required:true, min:1, max:un, default:1,
          hint:'Maximum ' + un + ' unsold seat' + (un === 1 ? '' : 's') + ' on this block.' },
        { key:'customer', label:'Customer / Agent', type:'text', required:true, placeholder:'e.g. Al-Madina Hajj Kafela' },
        { key:'salePrice', label:'Sale price / seat', type:'money', required:true, min:1, default:f.saleSeat,
          hint:'Contract cost is ' + ui.money(f.costSeat) + ' / seat.' }
      ],
      saveLabel:'Confirm Sale',
      onSave: function (v) {
        var cur = flight(id); if (!cur) return true;
        var avail = unsoldOf(cur);
        var qty = Math.round(+v.qty || 0);
        var price = +v.salePrice || 0;
        if (qty <= 0) { ui.toast('Enter at least 1 seat', 'error'); return false; }
        if (qty > avail) { ui.toast('Only ' + avail + ' seat' + (avail === 1 ? '' : 's') + ' left to sell', 'error'); return false; }

        cur.sold = (+cur.sold || 0) + qty;
        if (cur.sold >= (+cur.seats || 0)) cur.status = 'Sold Out';
        else if (cur.status !== 'Departed') cur.status = 'Selling';
        db.save('tv_contract_flights', cur);

        db.postSale('travels', {
          amount: qty * price, cost: qty * (+cur.costSeat || 0),
          ref: cur.id, desc:'Contract seats ' + cur.route + ' (' + qty + '×)',
          customer: (v.customer || '').trim()
        });

        ui.toast(qty + ' seat' + (qty === 1 ? '' : 's') + ' sold · ' + ui.money(qty * price), 'success');
        db.notify({ level:'success', title:'Contract seats sold', companyId:'travels', icon:'cart-check-fill',
          text: qty + ' × ' + cur.route + ' to ' + (v.customer || '—') });
        done && done();
        return true;
      }
    });
  }

  function blockVoucher(f) {
    if (!EPAL.doc || !EPAL.doc.open) { ui.toast('Document engine unavailable', 'error'); return; }
    var un = unsoldOf(f);
    EPAL.doc.open({
      type:'voucher', title:'Contract Flight Block', serial: EPAL.doc.numberFor('voucher'),
      badge:f.status, watermark:'CONTRACT',
      parties: [
        { label:'Charter / Vendor', lines:[ f.vendor || '—', f.airline, 'Flight ' + f.flightNo ] },
        { label:'Route & Category', lines:[ f.route, f.category + ' block', 'Departs ' + (f.depDate ? ui.date(f.depDate) : '—') ] }
      ],
      meta: [ { label:'Block ID', value:f.id }, { label:'Status', value:f.status },
        { label:'Days to departure', value: f.status === 'Departed' ? 'Departed' : (daysLeft(f.depDate) + ' days') } ],
      columns: [ { key:'k', label:'Item' }, { key:'v', label:'Detail', num:true } ],
      rows: [
        { k:'Total contracted seats', v: String(f.seats || 0) },
        { k:'Seats sold', v: String(f.sold || 0) },
        { k:'Seats unsold', v: String(un) },
        { k:'Cost per seat', v: ui.money(f.costSeat || 0) },
        { k:'Sale per seat', v: ui.money(f.saleSeat || 0) }
      ],
      totals: [
        { label:'Block cost', value: ui.money((+f.seats || 0) * (+f.costSeat || 0)) },
        { label:'Revenue booked', value: ui.money(revOf(f)) },
        { label:'Net P&L', value: ui.money(pnlOf(f)), grand:true }
      ],
      terms:'Block seats are pre-purchased and non-refundable to Epal Travels once contracted. Sell before departure.'
    });
  }

  /* =========================================================== ADD FLIGHT */
  function addFlight(page) {
    page.appendChild(el('div.card', { style:{ maxWidth:'620px', margin:'0 auto' } }, [
      el('div.card-body', { style:{ textAlign:'center', padding:'34px 24px' } }, [
        ui.frag('<div style="font-size:44px;line-height:1"><i class="bi bi-airplane-engines-fill" style="color:var(--accent,#2f6bff)"></i></div>'),
        el('h2', { style:{ margin:'12px 0 6px' }, text:'Contract a New Seat Block' }),
        el('p.text-muted', { style:{ maxWidth:'440px', margin:'0 auto 18px' },
          text:'Lock a block of seats from a charter or GSA allotment. Every seat is pre-bought, so pricing and departure feed straight into the deadline-risk radar.' }),
        el('button.btn.btn-primary.btn-lg', { html: ui.icon('plus-lg') + ' Open Contract Form', onclick: openForm })
      ])
    ]));
    // auto-open the form on landing for a fast path
    openForm();

    function openForm() {
      EPAL.formModal({
        title:'Add Contract Flight', icon:'airplane-engines', size:'lg',
        fields: [
          { type:'section', label:'Carrier & Route' },
          { key:'airline', label:'Airline', type:'select', required:true,
            options:['Biman Bangladesh','Saudia','US-Bangla','flydubai','Salam Air','Air Arabia','Qatar Airways','Emirates'] },
          { key:'flightNo', label:'Flight No', type:'text', required:true, placeholder:'e.g. BG1401' },
          { key:'origin', label:'Origin', type:'text', required:true, default:'DAC', placeholder:'DAC' },
          { key:'destination', label:'Destination', type:'text', required:true, placeholder:'JED' },
          { key:'aircraft', label:'Aircraft', type:'text', placeholder:'e.g. Boeing 777-300ER' },
          { type:'section', label:'Schedule' },
          { key:'depDate', label:'Departure date', type:'date', required:true },
          { key:'depTime', label:'Departure time', type:'text', placeholder:'e.g. 02:45' },
          { key:'arrTime', label:'Arrival time', type:'text', placeholder:'e.g. 06:10' },
          { key:'category', label:'Category', type:'select', required:true, options:CATEGORIES },
          { type:'section', label:'Block & Pricing' },
          { key:'totalSeats', label:'Total seats', type:'number', required:true, min:1, default:80 },
          { key:'class', label:'Class', type:'select', options:['Economy','Premium Economy','Business'] },
          { key:'contractVendor', label:'Contract vendor', type:'select', required:true,
            options:['Al-Haramain','Galaxy GSA','Zamzam Travels','Sky Holidays','Emirates GSA','Direct Airline'] },
          { key:'costSeat', label:'Cost / seat', type:'money', required:true, min:1, default:55000 },
          { key:'saleSeat', label:'Sale / seat', type:'money', required:true, min:1, default:64000 },
          { key:'commission', label:'Commission %', type:'number', min:0, default:3 },
          { key:'status', label:'Status', type:'select', options:['Selling','Sold Out','Departed'], default:'Selling' }
        ],
        saveLabel:'Contract Block',
        onSave: function (v) {
          if ((+v.saleSeat || 0) < (+v.costSeat || 0)) { ui.toast('Sale price is below cost — check your margin', 'error'); return false; }
          var origin = (v.origin || '').trim().toUpperCase();
          var dest = (v.destination || '').trim().toUpperCase();
          var rec = {
            id: nextId(), airline: v.airline, flightNo: (v.flightNo || '').trim(),
            origin: origin, destination: dest, route: origin + ' → ' + dest,
            aircraft: v.aircraft || '', category: v.category,
            depDate: v.depDate, depTime: v.depTime || '', arrTime: v.arrTime || '',
            seats: Math.round(+v.totalSeats || 0), sold: 0, class: v.class || 'Economy',
            vendor: v.contractVendor, costSeat: +v.costSeat || 0, saleSeat: +v.saleSeat || 0,
            commission: +v.commission || 0, status: v.status || 'Selling',
            created: new Date().toISOString().slice(0, 10)
          };
          db.save('tv_contract_flights', rec);
          ui.toast('Contract flight ' + rec.id + ' created', 'success');
          EPAL.router.navigate('travels/contract-flight/schedule');
          return true;
        }
      });
    }
  }

  function nextId() {
    var max = 0;
    flights().forEach(function (f) { var n = parseInt(String(f.id).replace(/\D/g, ''), 10); if (!isNaN(n) && n > max) max = n; });
    return 'CF-' + String(max + 1).padStart(3, '0');
  }

  /* ============================================================= CATEGORY */
  function category(page) {
    var fl = flights();
    var by = {};
    CATEGORIES.forEach(function (c) { by[c] = { seats:0, sold:0, revenue:0, cost:0, flights:0 }; });
    fl.forEach(function (f) {
      var c = f.category || 'Tourist';
      if (!by[c]) by[c] = { seats:0, sold:0, revenue:0, cost:0, flights:0 };
      by[c].seats += (+f.seats || 0); by[c].sold += (+f.sold || 0);
      by[c].revenue += revOf(f);
      by[c].cost += (+f.seats || 0) * (+f.costSeat || 0);
      by[c].flights += 1;
    });
    var cats = Object.keys(by).filter(function (c) { return by[c].flights > 0; });

    var totSeats = 0, totSold = 0, totRev = 0;
    cats.forEach(function (c) { totSeats += by[c].seats; totSold += by[c].sold; totRev += by[c].revenue; });
    page.appendChild(el('div.kpi-grid.stagger', null, [
      kpi('Categories Active', String(cats.length), 'diagram-3-fill'),
      kpi('Seats Contracted', ui.num(totSeats), 'grid-3x3-gap-fill'),
      kpi('Seats Unsold', ui.num(totSeats - totSold), 'exclamation-diamond'),
      kpi('Revenue Booked', ui.money(totRev, { compact:true }), 'cash-stack')
    ]));

    var cv = ui.uid('c');
    page.appendChild(el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon('bar-chart-fill') + ' Unsold Seats by Category' }) ]),
      el('div.card-body', null, [ el('div', { style:{ height:'260px', position:'relative' } }, [ el('canvas', { id:cv }) ]) ])
    ]));

    var rows = cats.map(function (c) {
      var d = by[c], unsold = d.seats - d.sold;
      var fill = d.seats ? Math.round(d.sold / d.seats * 100) : 0;
      return { category:c, flights:d.flights, seats:d.seats, sold:d.sold, unsold:unsold, fill:fill,
        revenue:d.revenue, pnl: d.revenue - d.cost };
    });
    var tbl = EPAL.table({
      columns: [
        { key:'category', label:'Category', render:function (r) { return catBadge(r.category).outerHTML; } },
        { key:'flights', label:'Blocks', num:true },
        { key:'seats', label:'Seats', num:true },
        { key:'sold', label:'Sold', num:true },
        { key:'unsold', label:'Unsold', num:true, render:function (r) {
            return '<span class="num ' + (r.unsold === 0 ? 'text-good' : 'text-bad') + '">' + r.unsold + '</span>'; } },
        { key:'fill', label:'Sell-through', num:true, render:function (r) { return r.fill + '%'; } },
        { key:'revenue', label:'Revenue', num:true, money:true },
        { key:'pnl', label:'Block P&L', num:true, render:function (r) {
            return '<span class="num ' + (r.pnl >= 0 ? 'text-good' : 'text-bad') + '">' + ui.money(r.pnl) + '</span>'; } }
      ],
      rows: rows, exportName:'contract-flight-categories.csv', pageSize: 20,
      empty: { icon:'diagram-3', title:'No categories yet', hint:'Contract a seat block to populate category analytics.' }
    });
    page.appendChild(el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon('list-columns-reverse') + ' Seat Block Summary' }) ]),
      el('div.card-body', null, [ tbl.el ])
    ]));

    requestAnimationFrame(function () {
      var canvas = ui.$('#' + cv); if (!canvas || !EPAL.charts) return;
      EPAL.charts.bar(canvas, {
        labels: cats,
        datasets: [{ label:'Unsold seats', data: cats.map(function (c) { return by[c].seats - by[c].sold; }),
          colors: cats.map(function (c) { return CAT_COLOR[c] || '#2f6bff'; }) }],
        money: false
      });
    });
  }

  /* ========================================================= MANAGE SALES */
  function manageSales(page) {
    var fl = flights();
    var sales = db.sales('travels').filter(function (s) { return /^CF/i.test(String(s.ref || '')); })
      .sort(function (a, b) { return (a.date < b.date ? 1 : -1); });

    // KPIs from the contract-seat ledger
    var revenue = 0, cost = 0, seatsSold = 0;
    sales.forEach(function (s) { revenue += (+s.amount || 0); cost += (+s.cost || 0); });
    fl.forEach(function (f) { seatsSold += (+f.sold || 0); });
    page.appendChild(el('div.kpi-grid.stagger', null, [
      kpi('Seat-Sale Revenue', ui.money(revenue, { compact:true }), 'cash-coin'),
      kpi('Seat Cost', ui.money(cost, { compact:true }), 'wallet2'),
      kpi('Gross Profit', ui.money(revenue - cost, { compact:true }), 'graph-up-arrow'),
      kpi('Seats Sold (all blocks)', ui.num(seatsSold), 'ticket-perforated-fill')
    ]));

    // Ledger of every contract-seat sale
    var ledger = EPAL.table({
      columns: [
        { key:'date', label:'Date', date:true },
        { key:'ref', label:'Flight', render:function (r) {
            var f = flight(r.ref);
            return '<span class="strong">' + ui.escapeHtml(r.ref) + '</span>' + (f ? ' <span class="text-mute xs">' + ui.escapeHtml(f.route) + '</span>' : ''); } },
        { key:'desc', label:'Description' },
        { key:'customer', label:'Customer / Agent', render:function (r) { return ui.escapeHtml(r.customer || '—'); } },
        { key:'cost', label:'Cost', num:true, money:true },
        { key:'amount', label:'Sale', num:true, money:true },
        { key:'profit', label:'Profit', num:true, render:function (r) {
            var p = +r.profit || 0; return '<span class="num ' + (p >= 0 ? 'text-good' : 'text-bad') + '">' + ui.money(p) + '</span>'; } }
      ],
      rows: sales, searchKeys:['ref','desc','customer'], exportName:'contract-seat-sales.csv',
      empty: { icon:'cart', title:'No seat sales yet', hint:'Open a flight on the Schedule and use “Sell Seats” — each sale lands here and in Travels finance.' }
    });
    page.appendChild(el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon('receipt') + ' Contract-Seat Sales Ledger' }),
        el('span.card-sub', { text: sales.length + ' sale' + (sales.length === 1 ? '' : 's') }) ]),
      el('div.card-body', null, [ ledger.el ])
    ]));

    // Per-flight profitability breakdown (always populated)
    var brk = fl.map(function (f) {
      return { id:f.id, route:f.airline + ' · ' + f.route, category:f.category,
        seats:(+f.seats || 0), sold:(+f.sold || 0), unsold: unsoldOf(f),
        booked: revOf(f), blockCost:(+f.seats || 0) * (+f.costSeat || 0), pnl: pnlOf(f) };
    }).sort(function (a, b) { return a.pnl - b.pnl; });
    var brkTbl = EPAL.table({
      columns: [
        { key:'route', label:'Flight' },
        { key:'category', label:'Category', render:function (r) { return catBadge(r.category).outerHTML; } },
        { key:'seats', label:'Seats', num:true },
        { key:'sold', label:'Sold', num:true },
        { key:'unsold', label:'Unsold', num:true },
        { key:'booked', label:'Revenue', num:true, money:true },
        { key:'blockCost', label:'Block Cost', num:true, money:true },
        { key:'pnl', label:'Net P&L', num:true, render:function (r) {
            return '<span class="num ' + (r.pnl >= 0 ? 'text-good' : 'text-bad') + '">' + ui.money(r.pnl) + '</span>'; } }
      ],
      rows: brk, searchKeys:['route','category','id'], exportName:'contract-flight-pnl.csv', pageSize: 15,
      empty: { icon:'airplane', title:'No blocks contracted', hint:'Add a contract flight to see per-block profitability.' }
    });
    page.appendChild(el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon('clipboard-data') + ' Per-Flight Profitability' }),
        el('span.card-sub', { text:'Block pre-bought → cost counts every seat' }) ]),
      el('div.card-body', null, [ brkTbl.el ])
    ]));
  }

  /* ---------------------------------------------------- shared helpers */
  function kpi(label, value, icon) {
    return el('div.kpi-card', null, [
      el('div.kpi-top', null, [ el('span.kpi-label', { text:label }), el('span.kpi-ico', { html:'<i class="bi bi-' + icon + '"></i>' }) ]),
      el('div.kpi-value', { text:String(value) })
    ]);
  }
  function kv(k, v) { return el('div.field', null, [ el('label', { text:k }), el('div.fw-600', { text:String(v) }) ]); }
  function st2(l, v) { return el('div.stat', null, [ el('div.stat-label', { text:l }), el('div.stat-value', { text:v }) ]); }
  function catBadge(c) {
    var col = CAT_COLOR[c] || '#8b93a7';
    var b = el('span.badge', { text: c || '—' });
    b.style.color = col; b.style.background = col + '22';
    return b;
  }
  function statusBadge(s) {
    var tone = s === 'Sold Out' ? 'badge-good' : s === 'Departed' ? 'badge-warn' : '';
    return el('span.badge' + (tone ? '.' + tone : ''), { text: s || '—' });
  }

})(window.EPAL = window.EPAL || {});
