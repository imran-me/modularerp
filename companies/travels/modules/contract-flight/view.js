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

  // real local today (was a hardcoded demo date — deadline math drifted as
  // days passed). Local parts, NOT toISOString(): UTC lands on yesterday in +06.
  var TODAY = (function () { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();
  var RISK_WINDOW = 15;               // days-left threshold for the red alert
  var CATEGORIES = ['Umrah', 'Hajj', 'Tourist', 'Worker', 'Medical', 'Business', 'Student'];
  var CAT_COLOR = {
    Umrah:'#23c17e', Hajj:'#1A43BF', Tourist:'#2f6bff', Worker:'#e2721b',
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
      var map = { schedule:'Flight Schedule', 'day-board':'Departures Board', 'add-flight':'Add Contract Flight',
        category:'Seat Blocks by Category', 'manage-sales':'Contract-Seat Sales' };

      page.appendChild(EPAL.pageHead({
        eyebrow: 'Travels › Contract Flight', icon:'airplane-engines-fill',
        title: map[sub] || 'Contract Flight', sub: subDesc(sub),
        actions: [
          sub !== 'schedule' ? el('a.btn.btn-ghost', { href:'#/travels/contract-flight/schedule', html: ui.icon('calendar3') + ' Schedule' }) : null,
          sub !== 'add-flight' ? el('a.btn.btn-primary', { href:'#/travels/contract-flight/add-flight', html: ui.icon('plus-lg') + ' Add Flight' }) : null
        ]
      }));

      ({ schedule:schedule, 'day-board':dayBoard, 'add-flight':addFlight, category:category, 'manage-sales':manageSales }[sub] || schedule)(page, ctx);
      ctx.mount.appendChild(page);
    }
  });

  function subDesc(sub) {
    return ({ schedule:'Every contracted seat block — capacity, sold, unsold and departure-deadline risk.',
      'day-board':'The day-by-day departures board — yesterday · today · tomorrow, live statuses and tomorrow\'s reminder strip.',
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
      var lf = totSeats ? Math.round(totSold / totSeats * 100) : 0;
      var revenue = fl.reduce(function (s, f){ return s + revOf(f); }, 0);
      var netPnl = fl.reduce(function (s, f){ return s + pnlOf(f); }, 0);
      // 7 KPIs — slim cards, one row (~30% smaller, same text); click any for a breakdown.
      host.appendChild(el('div.kpi-grid.kpi-slim.kpi-onerow.stagger', null, [
        kpi('Total Seats', ui.num(totSeats), 'grid-3x3-gap-fill', function(){ flightsModal('Seat Blocks — '+ui.num(totSeats)+' seats', 'grid-3x3-gap-fill', [['Seats', ui.num(totSeats)], ['Sold', ui.num(totSold)], ['Unsold', ui.num(totUnsold)], ['Blocks', fl.length]], fl); }),
        kpi('Seats Sold', ui.num(totSold), 'check2-circle', function(){ flightsModal('Seats Sold — '+ui.num(totSold), 'check2-circle', [['Sold', ui.num(totSold)], ['Load factor', lf+'%'], ['Revenue', ui.money(revenue)]], fl); }),
        kpi('Load Factor', lf + '%', 'speedometer2', function(){ var byL=fl.slice().filter(function(f){return f.seats;}).sort(function(a,b){ return loadPct(b)-loadPct(a); }); flightsModal('Load Factor — '+lf+'%', 'speedometer2', [['Overall', lf+'%'], ['Best', byL[0]? byL[0].airline+' '+loadPct(byL[0])+'%':'—'], ['Weakest', byL.length? byL[byL.length-1].airline+' '+loadPct(byL[byL.length-1])+'%':'—']], fl); }),
        kpi('Unsold Seats', ui.num(totUnsold), 'exclamation-diamond', function(){ flightsModal('Unsold Seats — '+ui.num(totUnsold), 'exclamation-diamond', [['Unsold', ui.num(totUnsold)], ['At-risk blocks', riskCount]], fl.filter(function(f){ return unsoldOf(f)>0; })); }),
        kpi('Blocked Capital', ui.money(blocked, { compact:true }), 'lock-fill', function(){ flightsModal('Blocked Capital — '+ui.money(blocked), 'lock-fill', [['Trapped capital', ui.money(blocked)], ['Unsold seats', ui.num(totUnsold)]], fl.filter(function(f){ return unsoldOf(f)>0; })); }),
        kpi('Revenue', ui.money(revenue, { compact:true }), 'cash-coin', function(){ flightsModal('Seat-Sale Revenue — '+ui.money(revenue), 'cash-coin', [['Revenue', ui.money(revenue)], ['Seats sold', ui.num(totSold)], ['Avg / seat', ui.money(totSold?Math.round(revenue/totSold):0)]], fl); }),
        kpi('Net P&L', ui.money(netPnl, { compact:true }), netPnl>=0?'graph-up-arrow':'graph-down-arrow', function(){ pnlModal(fl); })
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

      // --- Seat-Block Occupancy gauges + Category Mix --------------------
      occupancyBoard(host, fl);
      categoryMix(host, fl);

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
              var col = pct >= 90 ? '#23c17e' : pct >= 50 ? '#1A43BF' : '#f0506e';
              return '<div style="display:flex;align-items:center;gap:8px">' +
                '<div style="flex:1;height:7px;border-radius:6px;background:rgba(255,255,255,.08);overflow:hidden">' +
                '<div style="width:' + pct + '%;height:100%;background:' + col + '"></div></div>' +
                '<span class="num xs" style="min-width:34px">' + pct + '%</span></div>'; } },
          { key:'status', label:'Status', badge:{ Selling:'good', 'Sold Out':'', Departed:'warn' } }
        ],
        rows: function () { return flights(); },
        searchKeys: ['airline','flightNo','route','category','vendor','id'],
        quickFilter: 'category', filterPanel: true, dateKey: 'depDate',
        filters: [{ key:'status', label:'Status' }], pdfTitle: 'Contract Flight Schedule',
        onRow: function (r) { drawer(r.id, draw); },
        actions: ui.actions({
          print: function (r) { blockVoucher(r); },
          wa:    function (r) { return { phone:'', text: flightMsg(r) }; },
          gmail: function (r) { return { to:'', subject:'Contract flight '+(r.flightNo||r.id)+' — Epal Travels', body: flightMsg(r) }; }
        }),
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
          ref: cur.id + '-' + Date.now().toString(36), desc:'Contract seats ' + cur.route + ' (' + qty + '×)',
          customer: (v.customer || '').trim(),
          category: 'contract', vendor: cur.airline || cur.counterparty || ''   // own P&L line (4050) + AP sub-ledger
        });

        ui.toast(qty + ' seat' + (qty === 1 ? '' : 's') + ' sold · ' + ui.money(qty * price), 'success');
        db.notify({ level:'success', title:'Contract seats sold', companyId:'travels', icon:'cart-check-fill',
          text: qty + ' × ' + cur.route + ' to ' + (v.customer || '—') });
        done && done();
        return true;
      }
    });
  }

  function flightMsg(r) {
    return 'Contract flight ' + (r.flightNo || r.id) + '\nAirline: ' + (r.airline || '—') + '\nRoute: ' + (r.route || '—') +
      '\nDeparture: ' + ui.date(r.depDate) + '\nSeats: ' + (r.seats || 0) + ' (sold ' + (r.sold || 0) + ')' +
      '\n\n— Epal Travels & Consultancy';
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
  function printSeatSale(r) {
    var f = flight(r.ref);
    function row(k, v) { return '<tr><td>' + k + '</td><td>' + ui.escapeHtml(String(v == null ? '—' : v)) + '</td></tr>'; }
    ui.printDoc({ title: 'Seat Sale · ' + r.ref, subtitle: (f ? f.route + ' · ' : '') + (r.customer || ''), meta: 'Contract-seat sale',
      bodyHtml: '<table>' + row('Date', r.date) + row('Flight', r.ref) + (f ? row('Route', f.route) : '') + row('Description', r.desc) +
        row('Customer', r.customer) + row('Sale', ui.money(r.amount)) + row('Profit', ui.money(r.profit)) + '</table>' });
  }
  function seatSaleMsg(r) {
    var f = flight(r.ref);
    return 'Contract seat sale ' + r.ref + (f ? '\nRoute: ' + f.route : '') + '\nCustomer: ' + (r.customer || '—') +
      '\nAmount: ' + ui.money(r.amount) + '\n\n— Epal Travels & Consultancy';
  }

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
      filterPanel: true, filters: [], dateKey: 'date', pdfTitle: 'Contract-Seat Sales',
      actions: ui.actions({
        print: function (r) { printSeatSale(r); },
        wa:    function (r) { return { phone:'', text: seatSaleMsg(r) }; },
        gmail: function (r) { return { to:'', subject:'Seat sale '+r.ref, body: seatSaleMsg(r) }; }
      }),
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
      onRow: function (r) { drawer(r.id, function () { EPAL.router.render(); }); },   // each block opens its drawer
      empty: { icon:'airplane', title:'No blocks contracted', hint:'Add a contract flight to see per-block profitability.' }
    });
    page.appendChild(el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon('clipboard-data') + ' Per-Flight Profitability' }),
        el('span.card-sub', { text:'Block pre-bought → cost counts every seat' }) ]),
      el('div.card-body', null, [ brkTbl.el ])
    ]));
  }

  /* ==========================================================================
   * DEPARTURES BOARD — production FlightScheduleController parity: the
   * yesterday · today · tomorrow day window (or any picked date), live
   * status chips, Mark Departed, and tomorrow's reminder strip (the same
   * list production feeds its FLIGHT DEADLINE bulletin from).
   * ========================================================================*/
  var boardDate = '';                    // '' = the rolling 3-day window
  function addD(iso, n) { var d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  // one-time demo-date refresh: the seeded departures were pinned around the
  // old demo "now" — roll PAST, UN-departed blocks forward month-by-month so
  // the board always has live traffic (GL refs untouched; dates only)
  (function () {
    try {
      if (S.get && S.get('cf_dates_v2', null)) return;
      flights().forEach(function (f) {
        if (!f.depDate || f.status === 'Departed') return;
        var d = String(f.depDate).slice(0, 10), guard = 0;
        while (d < addD(TODAY, -1) && guard++ < 24) {
          var dt = new Date(d + 'T00:00:00'); dt.setMonth(dt.getMonth() + 1);
          d = dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
        }
        if (d !== f.depDate) { f.depDate = d; db.save('tv_contract_flights', f); }
      });
      if (S.set) S.set('cf_dates_v2', TODAY);
    } catch (e) {}
  })();
  function dayBoard(page) {
    var fl = flights();
    var yesterday = addD(TODAY, -1), tomorrow = addD(TODAY, 1);
    function dep(f) { return String(f.depDate || '').slice(0, 10); }
    function weekEnd() { return addD(TODAY, 7); }
    var todayAll = fl.filter(function (f) { return dep(f) === TODAY; });
    page.appendChild(el('div.kpi-grid.kpi-compact.stagger', null, [
      kpi('Departed · ' + ui.date(yesterday), fl.filter(function (f) { return dep(f) === yesterday && f.status === 'Departed'; }).length + ' / ' + fl.filter(function (f) { return dep(f) === yesterday; }).length, 'check2-circle'),
      kpi('Today', todayAll.length + ' flight' + (todayAll.length === 1 ? '' : 's'), 'calendar-day'),
      kpi('Today — still to go', String(todayAll.filter(function (f) { return f.status !== 'Departed'; }).length), 'clock-history'),
      kpi('Tomorrow', String(fl.filter(function (f) { return dep(f) === tomorrow; }).length), 'calendar-plus'),
      kpi('Next 7 Days', String(fl.filter(function (f) { return dep(f) >= TODAY && dep(f) <= weekEnd(); }).length), 'calendar-week')
    ]));
    // tomorrow's reminder strip — the production bulletin list
    var rem = fl.filter(function (f) { return dep(f) === tomorrow && f.status !== 'Departed'; });
    if (rem.length) {
      var strip = el('div.grid-auto.kpi-compact.stagger.mb-3');
      rem.slice(0, 6).forEach(function (f) {
        strip.appendChild(el('div.card', null, [el('div.card-pad', null, [
          el('div.flex.items-center.gap-2', null, [
            ui.frag('<span class="notif-ico notif-warn">' + ui.icon('airplane') + '</span>'),
            el('div.flex-1', null, [
              el('div.fw-700', { text: f.airline + ' · ' + f.flightNo }),
              el('div.text-mute.xs', { text: f.route + ' · departs ' + ui.date(f.depDate) + ' · IN 1 DAY' })
            ]),
            el('span.badge.badge-warn', { text: (f.sold || 0) + '/' + (f.seats || 0) + ' sold' })
          ])
        ])]));
      });
      page.appendChild(el('div.section-label.mt-0', { text: 'Departing tomorrow — reminder strip' }));
      page.appendChild(strip);
    }
    // day picker: any date, or the rolling yesterday–tomorrow window
    var picker = el('div.flex.gap-2.items-center.flex-wrap.mb-2', null, [
      el('span.text-mute.sm', { text: 'Show' }),
      el('input.input', { type: 'date', value: boardDate, onchange: function () { boardDate = this.value; EPAL.router.render(); } }),
      el('button.btn.btn-sm' + (boardDate ? '.btn-outline' : '.btn-primary'), { text: 'Yesterday – Tomorrow window', onclick: function () { boardDate = ''; EPAL.router.render(); } })
    ]);
    page.appendChild(picker);
    var rows = (boardDate ? fl.filter(function (f) { return dep(f) === boardDate; })
                          : fl.filter(function (f) { return dep(f) >= yesterday && dep(f) <= tomorrow; }))
      .slice().sort(function (a, b) { return dep(a) < dep(b) ? -1 : dep(a) > dep(b) ? 1 : String(a.flightNo).localeCompare(String(b.flightNo)); });
    function statusChip(f) {
      if (f.status === 'Departed') return '<span class="badge badge-good">Departed</span>';
      var d = dep(f);
      if (d < TODAY) return '<span class="badge badge-bad">Missed — not marked</span>';
      if (d === TODAY) return '<span class="badge badge-warn">Boarding today</span>';
      return '<span class="badge badge-info">Open</span>';
    }
    var tbl = EPAL.table({
      columns: [
        { key: 'flightNo', label: 'Flight', render: function (f) { return '<span class="strong">' + ui.escapeHtml(f.airline) + '</span><div class="text-mute xs">' + ui.escapeHtml(f.flightNo) + ' · ' + ui.escapeHtml(f.route) + '</div>'; } },
        { key: 'category', label: 'Category', badge: {} },
        { key: 'depDate', label: 'Departure', date: true, render: function (f) { return ui.date(f.depDate) + (dep(f) === TODAY ? ' <span class="badge badge-warn">TODAY</span>' : ''); } },
        { key: 'sold', label: 'Seats', num: true, render: function (f) { return '<span class="num">' + (f.sold || 0) + ' / ' + (f.seats || 0) + '</span>'; }, sortVal: function (f) { return +f.sold || 0; } },
        { key: 'status', label: 'Status', render: statusChip, exportVal: function (f) { return f.status === 'Departed' ? 'Departed' : dep(f) < TODAY ? 'Missed' : dep(f) === TODAY ? 'Boarding' : 'Open'; } }
      ],
      rows: rows, pageSize: 12, exportName: 'departures-board.csv',
      actions: [
        { icon: 'check2-circle', title: 'Mark departed', onClick: function (f) {
          if (f.status === 'Departed') { ui.toast('Already departed', 'error'); return; }
          f.status = 'Departed'; db.save('tv_contract_flights', f);
          ui.toast(f.airline + ' ' + f.flightNo + ' marked departed', 'success'); EPAL.router.render();
        } },
        { icon: 'calendar3', title: 'Open in schedule', onClick: function () { EPAL.router.navigate('travels/contract-flight/schedule'); } }
      ],
      empty: { icon: 'calendar-day', title: 'No departures in this window', hint: 'Pick another date, or add a contract flight.' }
    });
    page.appendChild(el('div.card', null, [
      el('div.card-head', null, [el('h3', { html: ui.icon('calendar-day') + ' Departures — ' + (boardDate ? ui.date(boardDate) : ui.date(yesterday) + ' → ' + ui.date(tomorrow)) })]),
      el('div.card-body', null, [tbl.el])
    ]));
  }

  /* ---------------------------------------------------- shared helpers */
  function kpi(label, value, icon, onClick) {
    return el('div.kpi-card' + (onClick ? '.drill' : ''), onClick ? { onclick: onClick } : null, [
      el('div.kpi-top', null, [ el('span.kpi-label', { text:label }), el('span.kpi-ico', { html:'<i class="bi bi-' + icon + '"></i>' }) ]),
      el('div.kpi-value', { text:String(value) })
    ]);
  }

  /* ==========================================================================
   * COCKPIT — KPI drill-downs, seat-block Occupancy Board (load-factor gauges),
   * Category Mix. (Mirrors the Air Ticketing / Visa cockpits for Contract Flight.)
   * ========================================================================*/
  function loadPct(f){ return f.seats ? Math.round((+f.sold||0)/f.seats*100) : 0; }
  function kpiShell(title, icon, stats){
    var body = el('div');
    ui.modal({ title:title, icon:icon, size:'lg', body:body, footer:false });
    if (stats && stats.length) body.appendChild(el('div.card.mb-2', null, [ el('div.card-body', null, [ el('div.stat-row', null, stats.map(function(s){ return st2(s[0], String(s[1])); })) ]) ]));
    return body;
  }
  function flightTable(rows){
    return EPAL.table({
      columns:[
        { key:'airline', label:'Flight', render:function(f){ return '<div class="strong">'+ui.escapeHtml(f.airline||'')+'</div><div class="text-mute xs">'+ui.escapeHtml((f.flightNo||'')+' · '+(f.route||''))+'</div>'; } },
        { key:'category', label:'Category', render:function(f){ return catBadge(f.category).outerHTML; }, sortVal:function(f){ return f.category; } },
        { key:'depDate', label:'Departure', date:true, sortVal:function(f){ return new Date(f.depDate).getTime()||0; } },
        { key:'seats', label:'Seats', num:true }, { key:'sold', label:'Sold', num:true },
        { key:'unsold', label:'Unsold', num:true, sortVal:function(f){ return unsoldOf(f); }, render:function(f){ var u=unsoldOf(f); return '<span class="num '+(u===0?'text-good':atRisk(f)?'text-bad':'')+'">'+u+'</span>'; } },
        { key:'load', label:'Load', num:true, sortVal:function(f){ return loadPct(f); }, render:function(f){ var p=loadPct(f); return '<span class="num '+(p>=90?'text-good':p<50?'text-bad':'')+'">'+p+'%</span>'; } },
        { key:'revenue', label:'Revenue', num:true, sortVal:function(f){ return revOf(f); }, render:function(f){ return ui.money(revOf(f)); } },
        { key:'pnl', label:'P&L', num:true, sortVal:function(f){ return pnlOf(f); }, render:function(f){ var p=pnlOf(f); return '<span class="num '+(p>=0?'text-good':'text-bad')+'">'+ui.money(p)+'</span>'; } }
      ],
      rows:rows, searchKeys:['airline','flightNo','route','category'], quickFilter:'category', filterPanel:true, pageSize:10,
      exportName:'contract-flights.csv', pdfTitle:'Contract Flights', onRow:function(f){ drawer(f.id, function(){ EPAL.router.render(); }); },
      empty:{ icon:'airplane', title:'No flights here' }
    }).el;
  }
  function catStats(fl){
    var m={}; fl.forEach(function(f){ var c=f.category||'—'; if(!m[c]) m[c]={ cat:c, seats:0, sold:0, unsold:0, revenue:0, pnl:0, blocked:0 };
      var o=m[c]; o.seats+=(+f.seats||0); o.sold+=(+f.sold||0); o.unsold+=unsoldOf(f); o.revenue+=revOf(f); o.pnl+=pnlOf(f); o.blocked+=unsoldOf(f)*(+f.costSeat||0); });
    return Object.keys(m).map(function(k){ return m[k]; }).sort(function(a,b){ return b.seats-a.seats; });
  }
  function flightsModal(title, icon, stats, rows){ var body=kpiShell(title, icon, stats); body.appendChild(el('div.card', null, [ el('div.card-body', null, [ flightTable(rows) ]) ])); }
  function pnlModal(fl){
    var rev=fl.reduce(function(s,f){ return s+revOf(f); },0), cost=fl.reduce(function(s,f){ return s+(+f.seats||0)*(+f.costSeat||0); },0), pnl=rev-cost;
    var body=kpiShell('Block P&L — '+ui.money(pnl), 'graph-up-arrow', [['Revenue', ui.money(rev)], ['Block Cost', ui.money(cost)], ['Net P&L', ui.money(pnl)]]);
    var cid=ui.uid('cfp'), cs=catStats(fl);
    body.appendChild(el('div.card.mb-2', null, [ el('div.card-head', null, [ el('h3',{ html: ui.icon('bar-chart')+' P&L by Category' }) ]),
      el('div.card-body', null, [ el('div',{ style:{ height:'240px', position:'relative' } }, [ el('canvas',{ id:cid }) ]) ]) ]));
    requestAnimationFrame(function(){ var c=document.getElementById(cid); if(!c) return;
      EPAL.charts.bar(c, { labels:cs.map(function(r){ return r.cat; }), horizontal:true, money:true, datasets:[{ label:'P&L', data:cs.map(function(r){ return r.pnl; }), colors:cs.map(function(r){ return r.pnl>=0?'#23c17e':'#f0506e'; }) }] }); });
    body.appendChild(el('div.card', null, [ el('div.card-body', null, [ flightTable(fl) ]) ]));
  }

  /* ---- SEAT-BLOCK OCCUPANCY BOARD — one ring-gauge per flight (load factor),
     coloured by category, red when a deadline is at risk. Click for the drawer. */
  function ringGauge(pct, color, size){
    var r=size/2-5, c=2*Math.PI*r, off=c*(1-Math.min(100,pct)/100);
    return '<svg width="'+size+'" height="'+size+'" viewBox="0 0 '+size+' '+size+'">'
      +'<circle cx="'+size/2+'" cy="'+size/2+'" r="'+r+'" fill="none" stroke="currentColor" stroke-opacity="0.12" stroke-width="6"/>'
      +'<circle cx="'+size/2+'" cy="'+size/2+'" r="'+r+'" fill="none" stroke="'+color+'" stroke-width="6" stroke-linecap="round" stroke-dasharray="'+c.toFixed(1)+'" stroke-dashoffset="'+off.toFixed(1)+'" transform="rotate(-90 '+size/2+' '+size/2+')"/>'
      +'<text x="50%" y="50%" text-anchor="middle" dominant-baseline="central" font-size="'+(size*0.24).toFixed(0)+'" font-weight="800" fill="currentColor">'+pct+'%</text></svg>';
  }
  function occupancyBoard(page, fl){
    var active = fl.filter(function(f){ return f.status!=='Departed'; });
    if(!active.length) active=fl; if(!active.length) return;
    active = active.slice().sort(function(a,b){ return daysLeft(a.depDate)-daysLeft(b.depDate); });
    var grid = el('div.grid-auto');
    active.forEach(function(f){
      var pct=loadPct(f), col=CAT_COLOR[f.category]||'#2f6bff', dl=daysLeft(f.depDate), risk=atRisk(f), gc=risk?'#f0506e':col;
      grid.appendChild(el('div.card.hover', { style:{ cursor:'pointer', color:'var(--text)' }, onclick:(function(id){ return function(){ drawer(id, function(){ EPAL.router.render(); }); }; })(f.id) }, [
        el('div.card-body', null, [ el('div.flex.items-center.gap-2', null, [
          el('div', { style:{ color:gc, flex:'none' }, html: ringGauge(pct, gc, 60) }),
          el('div.flex-1', { style:{ minWidth:'120px' } }, [
            el('div.strong', { text: f.airline }), el('div.text-mute.xs', { text: (f.flightNo||'')+' · '+(f.route||'') }),
            el('div.flex.items-center.gap-1.mt-1', null, [ catBadge(f.category), el('span.badge'+(risk?'.badge-bad':''), { text: f.status==='Departed'?'departed':(isNaN(dl)?'—':dl<0?Math.abs(dl)+'d ago':dl+'d left') }) ]),
            el('div.text-mute.xs.mt-1', { text: (f.sold||0)+' / '+(f.seats||0)+' seats · '+unsoldOf(f)+' unsold' })
          ]) ]) ])
      ]));
    });
    page.appendChild(el('div.section-label',{ html: ui.icon('speedometer2')+' Seat-Block Occupancy' }));
    page.appendChild(grid);
  }
  /* ---- CATEGORY MIX — seats by travel category (where the inventory sits). */
  function categoryMix(page, fl){
    var cs=catStats(fl).filter(function(r){ return r.seats; }); if(cs.length<2) return;
    var cid=ui.uid('cmix'), chips=el('div.flex.gap-1.flex-wrap.mt-2');
    cs.forEach(function(r){ var col=CAT_COLOR[r.cat]||'#8b93a7';
      chips.appendChild(el('button.badge', { style:{ cursor:'pointer', background:col+'22', color:col, border:'0' },
        onclick:(function(cat){ return function(){ flightsModal(cat+' blocks', 'airplane-engines', [['Seats', catStats(fl).filter(function(x){return x.cat===cat;})[0].seats]], fl.filter(function(f){ return f.category===cat; })); }; })(r.cat) },
        [ ui.frag(r.cat+' · '+r.seats) ])); });
    page.appendChild(el('div.section-label',{ html: ui.icon('pie-chart-fill')+' Seats by Category' }));
    page.appendChild(el('div.card', null, [ el('div.card-body', null, [ el('div',{ style:{ height:'220px', position:'relative' } }, [ el('canvas',{ id:cid }) ]), chips ]) ]));
    requestAnimationFrame(function(){ var c=document.getElementById(cid); if(!c) return;
      EPAL.charts.doughnut(c, { labels:cs.map(function(r){ return r.cat; }), data:cs.map(function(r){ return r.seats; }), colors:cs.map(function(r){ return CAT_COLOR[r.cat]||'#8b93a7'; }) }); });
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
