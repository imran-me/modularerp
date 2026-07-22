/* ============================================================================
 * EPAL GROUP ERP  ·  views/travels/vendor-agent.js
 * ----------------------------------------------------------------------------
 * TRAVELS — VENDOR & AGENT PARTY LEDGERS. The counterparty side of the travel
 * business: the GSAs / consolidators we BUY from (payables) and the sub-agents
 * who SELL for us (receivables + commission). ONE registered view branches on
 * ctx.subId (the router falls back from `.../accounts` to `travels/vendor-agent`):
 *
 *   (overview)  → KPIs: vendors/agents count, total payable, agent receivable, overdue
 *   vendors     → Vendors CRUD (GSAs / consolidators) + row-click party statement
 *   agents      → Sub-agents CRUD + row-click party statement & commission
 *   portals     → Booking / settlement portals CRUD (GDS, BSP, VFS…)
 *   accounts    → THE PARTY LEDGER: pick a party, running-balance statement,
 *                 ageing buckets, credit-limit utilisation, branded Statement,
 *                 Record Invoice / Record Payment (append + balanced ledger post)
 *   commission  → agent commission (expected vs received vs outstanding) + slabs
 *
 * A dedicated `party_txns` store powers the ledger; it is seeded idempotently via
 * the engine registry (survives db.reset) and every mutation flows through
 * EPAL.db + EPAL.ledger so Travels + Group finance stay in sync.
 * NOTE: never write a literal star-slash inside this comment block.
 * ==========================================================================*/

var EPAL = window.EPAL, ui = EPAL.ui, el = ui.el, db = EPAL.db, S = EPAL.store;

/* ---- template plumbing: clone a fragment, address its fill-slots ---------- */
var TPL = document.createElement('div');
TPL.innerHTML = TEMPLATE_HTML;
function frag(name) {
  var t = TPL.querySelector('template[data-tpl="' + name + '"]');
  return t.content.firstElementChild.cloneNode(true);
}
function slot(root, name) { return root.querySelector('[data-slot="' + name + '"]'); }
// kgrid: same first arg as the old kgrid('div.kpi-grid…', null, children) — clones
// the base grid shell and stamps the screen's exact class list (variants vary
// per screen, so the modifier classes legitimately stay in the logic, as in hrm).
function kgrid(sel, _p, children) { var g = frag('kpi-grid'); g.className = sel.replace(/^div\./, '').replace(/\./g, ' '); (children || []).forEach(function (c) { if (c) g.appendChild(c); }); return g; }
function navBtn(label, active, onClick) { var b = frag('nav-btn'); if (active) b.classList.add('active'); b.textContent = label; b.addEventListener('click', onClick); return b; }

  var TODAY = new Date(2026, 6, 5);           // demo "today" = 2026-07-05 (ageing)
  var VENDOR_TYPES = ['Ticketing', 'Visa', 'Hotel', 'Umrah', 'Multi-service'];
  var TERMS = ['Cash', 'Net 7', 'Net 15', 'Net 30', 'Net 45'];
  var CURRENCIES = ['BDT', 'USD', 'SAR', 'AED', 'EUR'];
  var PORTAL_TYPES = ['GDS', 'Visa', 'Hotel Aggregator', 'Insurance', 'BSP-Settlement', 'Embassy Tracker'];
  var SYNC_OPTS = ['15 min', 'Hourly', 'Daily'];
  var DEBIT_KINDS = ['Invoice', 'Purchase', 'ADM', 'Service Charge'];
  var CREDIT_KINDS = ['Payment', 'Refund', 'Credit Note', 'Adjustment'];

  var SLABS = [
    { tier: 'Bronze',   range: 'Below ৳5,00,000',   rate: '2%', color: '#b08d57' },
    { tier: 'Silver',   range: '৳5L – ৳20L',        rate: '4%', color: '#9aa4b2' },
    { tier: 'Gold',     range: '৳20L – ৳50L',       rate: '6%', color: '#1A43BF' },
    { tier: 'Platinum', range: 'Above ৳50,00,000',  rate: '7%', color: '#7b5cff' }
  ];

  /* ==========================================================================
   * SEED — party_txns (idempotent; runs during db.seed + on db.reset).
   * ========================================================================*/
  EPAL.registerEngine({ name: 'vendor-agent-seed', seed: function () {
    S.seedOnce('party_txns', seedPartyTxns());
  }});

  function seedPartyTxns() {
    var parties = [
      { name: 'Galaxy GSA',        type: 'vendor' },
      { name: 'Zamzam Travels',    type: 'vendor' },
      { name: 'Emirates GSA',      type: 'vendor' },
      { name: 'Sky Holidays',      type: 'vendor' },
      { name: 'Al-Haramain',       type: 'vendor' },
      { name: 'GDS Aggregator BD', type: 'vendor' },
      { name: 'Sky Travels',       type: 'agent' },
      { name: 'Green Tours',       type: 'agent' },
      { name: 'Metro Aviation',    type: 'agent' },
      { name: 'Royal Holidays',    type: 'agent' }
    ];
    var dates = ['2026-04-06', '2026-04-24', '2026-05-11', '2026-05-27',
                 '2026-06-09', '2026-06-20', '2026-06-30', '2026-07-02'];
    var out = [], id = 940001, seed = 1234567;
    function rr(n) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; }
    parties.forEach(function (p) {
      // Each party: charge, part-payment, charge, small settlement → open balance.
      var plan = [
        { debit: true,  amt: (rr(10) + 8) * 6000 },   // ~48k–102k
        { debit: false, amt: (rr(6) + 3) * 6000 },    // partial payment
        { debit: true,  amt: (rr(8) + 4) * 5000 },    // second charge
        { debit: false, amt: (rr(4) + 1) * 5000 }     // small settlement
      ];
      for (var i = 0; i < plan.length; i++) {
        var isDebit = plan[i].debit;
        var kind = isDebit ? DEBIT_KINDS[rr(DEBIT_KINDS.length)] : CREDIT_KINDS[rr(CREDIT_KINDS.length)];
        var dt = dates[(i * 2 + rr(2)) % dates.length];
        var amt = plan[i].amt;
        out.push({
          id: 'PT-' + (id++), party: p.name, partyType: p.type, companyId: 'travels',
          date: dt, ref: refFor(kind, id), desc: descFor(kind, p),
          kind: kind, debit: isDebit ? amt : 0, credit: isDebit ? 0 : amt,
          due: isDebit ? addDays(dt, 30) : '', created: Date.now()
        });
      }
    });
    // sort by date so seeded ledgers read chronologically
    out.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1; });
    return out;
  }
  function refFor(kind, n) {
    var pfx = { 'Invoice':'PINV', 'Purchase':'PO', 'ADM':'ADM', 'Service Charge':'SVC',
      'Payment':'PV', 'Refund':'RF', 'Credit Note':'CN', 'Adjustment':'ADJ' }[kind] || 'TX';
    return pfx + '-' + String(1000 + (n % 9000));
  }
  function descFor(kind, p) {
    if (kind === 'Invoice')       return 'Ticket / service invoice';
    if (kind === 'Purchase')      return 'Seat block purchase';
    if (kind === 'ADM')           return 'Airline debit memo';
    if (kind === 'Service Charge')return 'Processing / service charge';
    if (kind === 'Payment')       return p.type === 'agent' ? 'Received from agent' : 'Paid to vendor';
    if (kind === 'Refund')        return 'Refund adjustment';
    if (kind === 'Credit Note')   return 'Credit note issued';
    return 'Balance adjustment';
  }

  /* ==========================================================================
   * DATA ACCESSORS
   * ========================================================================*/
  function vendors() { return db.vendors(); }
  function agents()  { return db.col('tv_agents'); }
  function portals() { return db.col('tv_portals'); }
  function txns()    { return S.list('party_txns'); }
  function txnsFor(name) {
    return txns().filter(function (t) { return t.party === name; }).sort(byTxn);
  }
  function byTxn(a, b) {
    if (a.date === b.date) return (a.created || 0) - (b.created || 0);
    return a.date < b.date ? -1 : 1;
  }

  // Every distinct party we can pick, keyed by name → meta.
  function allParties() {
    var map = {};
    vendors().forEach(function (v) {
      map[v.name] = { name: v.name, partyType: 'vendor', creditLimit: +v.creditLimit || 500000,
        location: v.city || v.country || 'Dhaka', phone: v.phone, email: v.email, status: v.status || 'Active',
        photo: v.photo, responsible: v.responsible, login: v.login };
    });
    agents().forEach(function (a) {
      map[a.name] = { name: a.name, partyType: 'agent', creditLimit: +a.creditLimit || 800000,
        location: a.location || 'Dhaka', commission: +a.commission || 0, totalSales: +a.totalSales || 0,
        phone: a.phone, email: a.email, status: a.status || 'Active', photo: a.photo, responsible: a.responsible, login: a.login };
    });
    txns().forEach(function (t) {
      if (!map[t.party]) map[t.party] = { name: t.party, partyType: t.partyType || 'vendor',
        creditLimit: t.partyType === 'agent' ? 800000 : 500000, location: 'Dhaka' };
    });
    return map;
  }

  /* ==========================================================================
   * LEDGER / AGEING COMPUTATION
   * ========================================================================*/
  function computeLedger(name) {
    var list = txnsFor(name), rows = [], bal = 0, dr = 0, cr = 0;
    list.forEach(function (t) {
      bal += (t.debit || 0) - (t.credit || 0);
      dr += (t.debit || 0); cr += (t.credit || 0);
      rows.push({ id: t.id, date: t.date, ref: t.ref, desc: t.desc, kind: t.kind,
        debit: t.debit || 0, credit: t.credit || 0, due: t.due || '', balance: bal });
    });
    return { rows: rows, balance: bal, debit: dr, credit: cr, ageing: ageingFor(list) };
  }

  // FIFO: apply all credits to oldest debits, bucket the unpaid remainder by
  // the debit's DUE date (falls back to txn date) versus TODAY.
  function ageingFor(list) {
    var debits = [], pay = 0;
    list.forEach(function (t) {
      if (t.debit > 0) debits.push({ ref: t.due || t.date, amt: t.debit });
      if (t.credit > 0) pay += t.credit;
    });
    debits.sort(function (a, b) { return a.ref < b.ref ? -1 : 1; });
    var g = { current: 0, d30: 0, d60: 0, d90: 0, total: 0 };
    for (var i = 0; i < debits.length; i++) {
      var remain = debits[i].amt;
      if (pay > 0) { var used = Math.min(pay, remain); remain -= used; pay -= used; }
      if (remain <= 0.5) continue;
      var age = daysBetween(debits[i].ref);
      if (age <= 0) g.current += remain;
      else if (age <= 30) g.d30 += remain;
      else if (age <= 60) g.d60 += remain;
      else g.d90 += remain;
      g.total += remain;
    }
    return g;
  }
  function daysBetween(str) {
    var d = new Date(str); if (isNaN(d)) return 0;
    return Math.floor((TODAY.getTime() - d.getTime()) / 86400000);
  }
  function addDays(str, n) {
    var d = new Date(str); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10);
  }

  // Group-level roll-up used by the overview & commission KPIs.
  function rollup() {
    var map = {}, r = { payable: 0, receivable: 0, overdue: 0 };
    txns().forEach(function (t) {
      var k = t.party; if (!map[k]) map[k] = { type: t.partyType || 'vendor', list: [] };
      map[k].list.push(t);
    });
    Object.keys(map).forEach(function (name) {
      var e = map[name], led = computeLedger(name), ag = led.ageing;
      if (e.type === 'agent') { if (led.balance > 0) r.receivable += led.balance; }
      else { if (led.balance > 0) r.payable += led.balance; }
      r.overdue += ag.d30 + ag.d60 + ag.d90;
    });
    return r;
  }

  /* ==========================================================================
   * VIEW ENTRY
   * ========================================================================*/
  /* Section band. Labels mirror the registry (config.js subs), plus Overview —
     which the view renders on the bare route but the registry does not list as
     a sub (the sidebar treats the module root as Overview implicitly, so the
     band spells it out). 7 sections → .tabs-dense, as Finance/Master Accounts
     do for their long rows. */
  var SECTIONS = [['overview', 'Overview'], ['vendors', 'Manage Vendors'], ['agents', 'Manage Agents'],
    ['customers', 'Customers'], ['portals', 'Portals / GDS'], ['accounts', 'Party Accounts'], ['commission', 'Commission']];
  function sectionNav(sub) {
    var nav = frag('nav');
    SECTIONS.forEach(function (s) {
      nav.appendChild(navBtn(s[1], sub === s[0], function () { EPAL.router.navigate('travels/vendor-agent' + (s[0] === 'overview' ? '' : '/' + s[0])); }));
    });
    return nav;
  }

  EPAL.view('travels/vendor-agent', {
    render: function (ctx) {
      var sub = ctx.subId || 'overview';
      var page = frag('page');
      var titles = { overview: 'Vendor, Agent & Customer', vendors: 'Vendors', agents: 'Sub-Agents', customers: 'Customers',
        portals: 'Portals & Channels', accounts: 'Party Ledger', commission: 'Agent Commission' };
      page.appendChild(EPAL.pageHead({
        eyebrow: sub === 'overview' ? 'Epal Travels' : 'Travels › Vendor, Agent & Customer',
        icon: 'people-fill', title: titles[sub] || 'Vendor, Agent & Customer', sub: subDesc(sub)
      }));
      // SECTION NAV — the house full-bleed underline band (owner grammar
      // 2026-07-15). Replaces the page-action buttons ("Overview" / "Party
      // Ledger") that were navigating between sections.
      page.appendChild(sectionNav(sub));
      ({ overview: overview, vendors: vendorsView, agents: agentsView, customers: customersView,
         portals: portalsView, accounts: accountsView, commission: commissionView }[sub] || overview)(page, ctx);
      ctx.mount.appendChild(page);
    }
  });

  function subDesc(sub) {
    return ({ overview: 'Payables to vendors, receivables from sub-agents, customers, and the party ledger.',
      vendors: 'GSAs, consolidators and suppliers — credit limits, terms and balances.',
      agents: 'Sub-agents who sell on our behalf — commission, sales and balances.',
      customers: 'Travellers who buy directly — contact, lifetime value and history.',
      portals: 'Booking, settlement and tracking channels (GDS, BSP, VFS, embassy).',
      accounts: 'Running-balance statement, ageing and credit control for any party.',
      commission: 'Expected vs received vs outstanding commission by sub-agent.' }[sub]) || '';
  }

  /* ======================================================= CUSTOMERS
   * Merged in from the old standalone Travels › Customers module (2026-07-09):
   * direct travellers now live alongside vendors & agents as a party type. */
  function customersView(page) {
    var SV = ['Ticketing', 'Visa', 'Hotel', 'Package'];
    var list = db.customers('travels').map(function (c, i) { return enrichCust(c, i, SV); });
    var totVal = list.reduce(function (a, c) { return a + (c.value || 0); }, 0);
    var goldPlus = list.filter(function (c) { return c.tier === 'Gold' || c.tier === 'Platinum'; }).length;
    var pxSoon = list.filter(function (c) { var m = monthsToExpiry(c.passportExpiry); return m != null && m >= 0 && m <= 6; })
      .sort(function (a, b) { return (a.passportExpiry || '') < (b.passportExpiry || '') ? -1 : 1; });
    page.appendChild(kgrid('div.kpi-grid.kpi-compact.stagger', null, [
      kpi('Customers', list.length, 'person-hearts'),
      kpi('Lifetime Value', ui.money(totVal, { compact: true }), 'cash-coin'),
      kpi('Avg / Customer', ui.money(list.length ? Math.round(totVal / list.length) : 0, { compact: true }), 'graph-up'),
      kpi('Gold+ Tier', goldPlus, 'star-fill'),
      kpi('Passports ≤6m', pxSoon.length, 'person-vcard')
    ]));
    if (pxSoon.length) page.appendChild(el('div.build-banner.mb-3', null, [ ui.frag(ui.icon('exclamation-triangle-fill')),
      el('div', { html: '<strong>Passport renewals due.</strong> ' + pxSoon.length + ' customer' + (pxSoon.length === 1 ? '' : 's') + ' with a passport expiring within 6 months — a renewal/upsell opportunity: ' +
        pxSoon.slice(0, 6).map(function (c) { return ui.escapeHtml(c.name) + ' (' + ui.date(c.passportExpiry) + ')'; }).join(', ') + (pxSoon.length > 6 ? ' …' : '') }) ]));
    var t = EPAL.table({
      columns: [
        { key: 'name', label: 'Customer', render: function (c) {
            var av = c.photo
              ? '<span class="avatar" style="width:26px;height:26px;background-image:url(' + c.photo + ');background-size:cover;background-position:center"></span>'
              : '<span class="avatar" style="width:26px;height:26px;font-size:10px;background:' + ui.colorFor(c.name) + '">' + ui.initials(c.name) + '</span>';
            return '<div class="flex items-center gap-1">' + av + '<div><div class="strong">' + ui.escapeHtml(c.name) + '</div>' + (c.contact ? '<div class="text-mute xs">' + ui.escapeHtml(c.contact) + '</div>' : '') + '</div></div>'; } },
        { key: 'service', label: 'Interest', badge: {} },
        { key: 'phone', label: 'Phone' },
        { key: 'email', label: 'Email' },
        { key: 'value', label: 'Lifetime Value', num: true, money: true },
        { key: 'since', label: 'Since' }
      ],
      rows: (function () { var SV = ['Ticketing', 'Visa', 'Hotel', 'Package']; return list.slice().sort(function (a, b) { return (b.value || 0) - (a.value || 0); }).map(function (c, i) { if (!c.service) c.service = SV[i % SV.length]; return c; }); })(),
      searchKeys: ['name', 'contact', 'phone', 'email', 'service'],
      quickFilter: 'service', filterPanel: true, filters: [], exportName: 'travel-customers.csv', pdfTitle: 'Travel Customers',
      onRow: function (c) { custView(c); },
      actions: ui.actions({
        edit:  function (c) { custEdit(c); },
        del:   function (c) { custDelete(c); },
        print: function (c) { custPrint(c); },
        wa:    function (c) { return { phone: c.phone, text: custMsg(c) }; },
        gmail: function (c) { return { to: c.email, subject: 'Epal Travels & Consultancy', body: custMsg(c) }; }
      }),
      empty: { icon: 'person-hearts', title: 'No customers yet', hint: 'Direct travellers you sell to will appear here.' }
    });
    page.appendChild(el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon('person-hearts') + ' Travel Customers' }),
        el('div.flex.items-center.gap-2', null, [
          el('span.card-sub', { text: list.length + ' travellers' }),
          canCreate() ? el('button.btn.btn-sm.btn-primary', { html: ui.icon('person-plus') + ' New Customer', onclick: function () { custEdit(null); } }) : null
        ]) ]),
      el('div.card-body', null, [ t.el ])
    ]));
  }
  // months until a date (null if no date) — drives the passport-expiry radar
  function monthsToExpiry(d) { if (!d) return null; return Math.round((new Date(d).getTime() - Date.now()) / (86400000 * 30.4)); }
  // give demo customers a plausible travel profile so the radar/KPIs have data
  // (real values, once entered on the form, always win). Deterministic per index.
  function enrichCust(c, i, SV) {
    if (!c.service) c.service = SV[i % SV.length];
    if (!c.nationality) c.nationality = 'Bangladeshi';
    if (!c.passportNo) c.passportNo = 'B' + (7000000 + (i * 74329) % 2999999);
    // spread demo expiries around "now" (some within 6 months → the radar has data)
    if (!c.passportExpiry) { var d = new Date(2026, 6, 15); d.setMonth(d.getMonth() + (((i * 7) % 16) - 2)); c.passportExpiry = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-15'; }
    return c;
  }
  /* ---- customer detail — the SAME rich layout as a party: header + KPIs +
         purchase history + print/WhatsApp/Gmail (with profile attach) --------*/
  function custView(c) {
    var body = el('div');
    var m = ui.modal({ title: c.name, icon: 'person-hearts', size: 'lg', body: body, footer: false });
    renderCustomer(body, c);
    return m;
  }
  function renderCustomer(host, c) {
    host.innerHTML = '';
    var sales = (db.sales ? db.sales('travels') : []).filter(function (s) { return String(s.customer || '').toLowerCase() === String(c.name || '').toLowerCase(); })
      .sort(function (a, b) { return (a.date < b.date) ? 1 : -1; });
    var spend = sales.reduce(function (a, s) { return a + (+s.amount || 0); }, 0);
    var lastOrder = sales.length ? sales[0].date : null;

    var actions = el('div.flex.gap-1.items-center.flex-wrap', { style: { marginLeft: 'auto' } });
    if (canCreate()) actions.appendChild(el('button.btn.btn-sm.btn-outline', { html: ui.icon('pencil') + ' Edit', onclick: function () { custEdit(c); } }));
    actions.appendChild(el('button.btn.btn-sm.btn-primary', { html: ui.icon('printer') + ' Statement', onclick: function () { custPrint(c); } }));
    actions.appendChild(ui.rowActions(ui.actions({
      wa: { phone: c.phone, text: custMsg(c) }, gmail: { to: c.email, subject: 'Epal Travels & Consultancy', body: custMsg(c) },
      profile: { name: c.name,
        card: { title: c.name, subtitle: 'Customer · ' + (c.tier || 'Standard'), lines: [
          ['Lifetime value', ui.money(c.value || 0)], ['Recorded spend', ui.money(spend)], ['Orders', String(sales.length)], ['Phone', c.phone || '—'], ['Email', c.email || '—'] ] },
        pdf: function () { custPrint(c); } }
    })));

    host.appendChild(el('div.card', null, [ el('div.card-body', null, [
      el('div.flex.items-center.gap-2.flex-wrap.mb-3', null, [
        c.photo
          ? ui.frag('<span class="avatar" style="width:42px;height:42px;background-image:url(' + c.photo + ');background-size:cover;background-position:center"></span>')
          : ui.frag('<span class="notif-ico notif-info">' + ui.icon('person-hearts') + '</span>'),
        el('div.flex-1', { style: { minWidth: '180px' } }, [ el('div.fw-700', { style: { fontSize: '17px' }, text: c.name }),
          el('div.flex.items-center.gap-2.flex-wrap', null, [
            el('div.text-mute.sm', { text: (c.contact ? c.contact + ' · ' : '') + (c.phone || '—') }),
            el('span.badge' + (c.tier === 'Platinum' ? '.badge-accent' : c.tier === 'Gold' ? '.badge-warn' : ''), { text: c.tier || 'Standard' }),
            c.service ? el('span.badge', { text: c.service }) : null,
            (c.login && c.login.enabled) ? el('span.badge.badge-good', { html: ui.icon('person-check') + ' Portal login' }) : null
          ]) ]),
        actions
      ]),
      el('div.stat-row', null, [
        st2('Lifetime Value', ui.money(c.value || 0)), st2('Recorded Spend', ui.money(spend)),
        st2('Orders', String(sales.length)), st2('Last Order', lastOrder ? ui.date(lastOrder) : '—')
      ])
    ]) ]));

    // Travel Profile — passport & traveller details (the domain fields a TMC needs)
    if (c.passportNo || c.nationality || c.dob || c.passportExpiry || c.frequentFlyer) {
      var pxTone = '';
      if (c.passportExpiry) { var mo = Math.round((new Date(c.passportExpiry).getTime() - Date.now()) / (86400000 * 30.4)); pxTone = mo < 0 ? 'text-bad' : mo <= 6 ? 'text-warn' : ''; }
      host.appendChild(el('div.card', null, [
        el('div.card-head', null, [ el('h3', { html: ui.icon('person-vcard') + ' Travel Profile' }) ]),
        el('div.card-body', null, [ el('div.data-list', null, [
          drow('Passport No', c.passportNo), drow('Nationality', c.nationality),
          el('div.data-row', null, [ el('div.text-mute.sm.flex-1', { text: 'Passport expiry' }), el('div.strong' + (pxTone ? '.' + pxTone : ''), { text: c.passportExpiry ? ui.date(c.passportExpiry) : '—' }) ]),
          drow('Date of birth', c.dob ? ui.date(c.dob) : '—'), drow('Frequent flyer', c.frequentFlyer), drow('Preferred airline', c.preferredAirline)
        ]) ])
      ]));
    }

    if (sales.length) {
      var t = EPAL.table({
        columns: [
          { key: 'date', label: 'Date', date: true }, { key: 'ref', label: 'Reference' }, { key: 'desc', label: 'Description' },
          { key: 'amount', label: 'Amount', num: true, money: true },
          { key: 'profit', label: 'Profit', num: true, render: function (r) { return '<span class="text-good">' + ui.money(r.profit) + '</span>'; }, sortVal: function (r) { return r.profit; } }
        ],
        rows: sales, searchKeys: ['ref', 'desc'], pageSize: 8, dateKey: 'date',
        exportName: 'customer-' + String(c.name).replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '.csv', pdfTitle: 'Purchases — ' + c.name,
        empty: { icon: 'bag', title: 'No purchases' }
      });
      host.appendChild(el('div.card', null, [ el('div.card-head', null, [ el('h3', { html: ui.icon('bag-check') + ' Purchase History' }), el('span.card-sub', { text: sales.length + ' orders' }) ]), el('div.card-body', null, [ t.el ]) ]));
    } else {
      host.appendChild(el('div.empty-state', null, [ ui.frag(ui.icon('bag')), el('h3', { text: 'No recorded purchases' }), el('p.text-muted', { text: 'Sales recorded against this customer will appear here.' }) ]));
    }
    if (EPAL.comments && EPAL.comments.widget) { host.appendChild(el('div.section-label', { text: 'Notes & Discussion' })); host.appendChild(EPAL.comments.widget('customer', c.name)); }
  }
  /* ---- customer add/edit — the SAME rich form pattern as vendors ----------*/
  function custEdit(c) {
    var isNew = !c || !c.name;
    var rec = c || {};
    EPAL.formModal({
      title: isNew ? 'Add Customer' : 'Edit Customer', icon: 'person-hearts', size: 'lg', record: rec,
      fields: [
        { type: 'section', label: 'Identity' },
        { key: 'photo', label: 'Profile picture', type: 'image', icon: 'person', col2: true, round: true },
        { key: 'name', label: 'Customer name', type: 'text', required: true, col2: true, placeholder: 'e.g. Rahim Uddin' },
        { key: 'contact', label: 'Contact person', type: 'text' },
        { key: 'service', label: 'Interest', type: 'select', options: ['Ticketing', 'Visa', 'Hotel', 'Package'], default: 'Ticketing' },
        { key: 'phone', label: 'Phone', type: 'phone' },
        { key: 'email', label: 'Email', type: 'email' },
        { type: 'section', label: 'Travel Profile' },
        { key: 'passportNo', label: 'Passport No', type: 'text', placeholder: 'e.g. B1234567' },
        { key: 'passportExpiry', label: 'Passport expiry', type: 'date' },
        { key: 'nationality', label: 'Nationality', type: 'text', default: 'Bangladeshi' },
        { key: 'dob', label: 'Date of birth', type: 'date' },
        { key: 'frequentFlyer', label: 'Frequent flyer No', type: 'text' },
        { key: 'preferredAirline', label: 'Preferred airline', type: 'text' },
        { type: 'section', label: 'Commercial' },
        { key: 'tier', label: 'Tier', type: 'select', options: ['Standard', 'Silver', 'Gold', 'Platinum'], default: 'Standard' },
        { key: 'value', label: 'Lifetime value', type: 'money', default: 0, min: 0 },
        { key: 'since', label: 'Customer since', type: 'text', placeholder: 'e.g. 2021-06' },
        { key: 'address', label: 'Address', type: 'textarea', col2: true },
        { type: 'section', label: 'ERP Access (Customer portal)' },
        { key: 'createLogin', label: 'Give this customer a portal login', type: 'checkbox', col2: true,
          hint: 'Provisions a customer-role user in the ERP user list. Access control is enforced by the backend (RBAC — later).' },
        { key: 'loginEmail', label: 'Login email', type: 'email', showIf: function (x) { return x.createLogin; } },
        { key: 'loginPassword', label: 'Password', type: 'password', showIf: function (x) { return x.createLogin; } }
      ],
      saveLabel: isNew ? 'Add Customer' : 'Save',
      onSave: function (val) {
        var t = isNew ? { id: 'CU-' + ui.uid('').slice(-4).toUpperCase(), companyIds: ['travels'], since: val.since || '' } : rec;
        t.name = (val.name || '').trim(); t.contact = val.contact; t.phone = val.phone; t.email = val.email;
        t.service = val.service; t.tier = val.tier; t.value = +val.value || 0; t.since = val.since || t.since;
        t.address = val.address; t.photo = val.photo || '';
        t.passportNo = val.passportNo; t.passportExpiry = val.passportExpiry; t.nationality = val.nationality;
        t.dob = val.dob; t.frequentFlyer = val.frequentFlyer; t.preferredAirline = val.preferredAirline;
        if (!t.companyIds) t.companyIds = ['travels']; else if (t.companyIds.indexOf('travels') < 0) t.companyIds.push('travels');
        if (val.createLogin && (val.loginEmail || t.email)) { t.login = { email: val.loginEmail || t.email, role: 'customer', enabled: true }; provisionPartyUser(t, 'customer', val.loginPassword); }
        db.saveCustomer(t);
        ui.toast('Customer "' + t.name + '" saved' + (val.createLogin ? ' · portal login provisioned' : ''), 'success');
        EPAL.router.render();
        return true;
      }
    });
  }
  function custDelete(c) {
    ui.confirm({ title: 'Delete customer', text: 'Remove ' + c.name + '? This cannot be undone.', danger: true, confirmLabel: 'Delete' })
      .then(function (ok) { if (!ok) return; EPAL.store.removeFrom('customers', c); ui.toast(c.name + ' deleted', 'good'); EPAL.router.render(); });
  }
  function custPrint(c) {
    function pr(k, v) { return '<tr><td>' + ui.escapeHtml(k) + '</td><td>' + ui.escapeHtml(String(v || '—')) + '</td></tr>'; }
    ui.printDoc({ title: 'Customer Statement — ' + c.name, subtitle: 'Epal Travels & Consultancy', meta: 'Customer record', footer: 'Confidential',
      bodyHtml: '<table><tr><th>Field</th><th>Value</th></tr>' + pr('Contact person', c.contact) + pr('Phone', c.phone) +
        pr('Email', c.email) + pr('Lifetime value', ui.money(c.value || 0)) + pr('Customer since', c.since) + '</table>' });
  }
  function custMsg(c) {
    return 'Dear ' + c.name + ',\n\nThank you for choosing Epal Travels & Consultancy. Please let us know how we can assist with your next booking.\n\nWarm regards,\nEpal Travels & Consultancy';
  }

  /* ======================================================= OVERVIEW */
  function overview(page) {
    var r = rollup();
    page.appendChild(kgrid('div.kpi-grid.stagger', null, [
      kpi('Vendors', vendors().length, 'truck'),
      kpi('Sub-Agents', agents().length, 'person-badge'),
      kpi('Total Payable', ui.money(r.payable, { compact: true }), 'arrow-up-right-circle'),
      kpi('Agent Receivable', ui.money(r.receivable, { compact: true }), 'arrow-down-left-circle'),
      kpi('Overdue', ui.money(r.overdue, { compact: true }), 'exclamation-triangle')
    ]));
    var sections = [
      ['vendors', 'Vendors', 'truck', 'GSAs, consolidators & suppliers'],
      ['agents', 'Sub-Agents', 'person-badge', 'Sales network & commission'],
      ['portals', 'Portals & Channels', 'hdd-network', 'GDS · BSP · VFS · embassy'],
      ['accounts', 'Party Ledger', 'journal-text', 'Statements, ageing & credit control'],
      ['commission', 'Agent Commission', 'percent', 'Expected vs received vs outstanding']
    ];
    page.appendChild(el('div.section-label', { text: 'Sections' }));
    page.appendChild(el('div.scaffold-grid.stagger', null, sections.map(function (s) {
      return el('a.scaffold-card', { href: '#/travels/vendor-agent/' + s[0] }, [
        el('div.scaffold-ico', { html: '<i class="bi bi-' + s[2] + '"></i>' }),
        el('div', null, [ el('h4', { text: s[1] }), el('p', { text: s[3] }) ])
      ]);
    })));

    // Top exposures — the biggest open party balances right now.
    var pm = allParties(), exp = [];
    Object.keys(pm).forEach(function (nm) {
      var led = computeLedger(nm);
      if (Math.abs(led.balance) > 0.5) exp.push({ name: nm, meta: pm[nm], balance: led.balance,
        overdue: led.ageing.d30 + led.ageing.d60 + led.ageing.d90 });
    });
    exp.sort(function (a, b) { return Math.abs(b.balance) - Math.abs(a.balance); });
    if (exp.length) {
      page.appendChild(el('div.section-label', { text: 'Top Open Balances' }));
      var t = EPAL.table({
        columns: [
          { key: 'name', label: 'Party', render: function (r2) { return '<span class="strong">' + ui.escapeHtml(r2.name) + '</span>'; } },
          { key: 'type', label: 'Type', render: function (r2) { return typeBadge(r2.meta.partyType); }, sortVal: function (r2) { return r2.meta.partyType; } },
          { key: 'balance', label: 'Balance', num: true, render: function (r2) {
              return '<span class="num strong">' + ui.money(r2.balance) + '</span>'; }, sortVal: function (r2) { return r2.balance; } },
          { key: 'overdue', label: 'Overdue', num: true, render: function (r2) {
              return r2.overdue > 0 ? '<span class="num text-bad">' + ui.money(r2.overdue) + '</span>' : '—'; }, sortVal: function (r2) { return r2.overdue; } }
        ],
        rows: exp, pageSize: 8, exportName: 'party-exposures.csv',
        onRow: function (r2) { openLedgerModal(r2.meta); },
        empty: { icon: 'inbox', title: 'No open balances', hint: 'Party balances appear here.' }
      });
      var card = el('div.card', null, [ el('div.card-body') ]);
      card.querySelector('.card-body').appendChild(t.el);
      page.appendChild(card);
    }
  }

  /* ======================================================= VENDORS */
  function vendorsView(page) {
    if (canCreate()) page.querySelector('.page-actions').prepend(el('button.btn.btn-ghost', {
      html: ui.icon('plus-lg') + ' Add Vendor', onclick: function () { editVendor(null); } }));
    var host = el('div'); page.appendChild(host);
    draw();
    function draw() {
      host.innerHTML = '';
      var t = EPAL.table({
        columns: [
          { key: 'id', label: 'Vendor ID', render: function (v) { return '<span class="mono xs text-mute">' + ui.escapeHtml(v.id || '—') + '</span>'; } },
          { key: 'name', label: 'Vendor', render: function (v) {
              var av = v.photo
                ? '<span class="avatar" style="width:26px;height:26px;background-image:url(' + v.photo + ');background-size:cover;background-position:center"></span>'
                : '<span class="avatar" style="width:26px;height:26px;font-size:10px;background:' + ui.colorFor(v.name) + '">' + ui.initials(v.name) + '</span>';
              return '<div class="flex items-center gap-1">' + av + '<span class="strong">' + ui.escapeHtml(v.name) + '</span></div>'; } },
          { key: 'type', label: 'Type', badge: {} },
          { key: 'phone', label: 'Contact', render: function (v) { return ui.escapeHtml(v.phone || v.contact || '—'); } },
          { key: 'terms', label: 'Terms' },
          { key: 'creditLimit', label: 'Credit Limit', num: true, money: true },
          { key: 'balance', label: 'Payable', num: true, render: function (v) {
              var b = ledgerBalance(v.name, v.balance);
              return '<span class="num ' + (b > 0 ? 'text-bad' : 'text-good') + '">' + ui.money(b) + '</span>'; },
            sortVal: function (v) { return ledgerBalance(v.name, v.balance); } },
          { key: 'lastActivity', label: 'Last Activity', sort: true, sortVal: function (v) { return lastActivityTs(v.name); },
            render: function (v) { var d = lastActivityOf(v.name); return d ? '<span class="text-mute">' + ui.ago(d) + '</span>' : '<span class="text-mute">—</span>'; } },
          { key: 'status', label: 'Status', sortVal: function (v) { return v.status || 'Active'; },
            render: function (v) { var s = v.status || 'Active'; return '<span class="badge' + (s === 'Active' ? ' badge-good' : '') + '">' + s + '</span>'; } }
        ],
        rows: function () { return vendors().map(function (v) { if (!v.status) v.status = 'Active'; return v; }); },
        searchKeys: ['id', 'name', 'type', 'phone', 'terms'],
        quickFilter: 'type',                                   // Type values become chips
        filterPanel: true,                                     // Terms/Status + sort in the Filter card
        filters: [{ key: 'terms', label: 'Terms' }, { key: 'status', label: 'Status' }],
        pageSize: 10, exportName: 'vendors.csv', pdfTitle: 'Vendor Register',
        onRow: function (v) { openLedgerModal(metaFromVendor(v)); },
        actions: actionsFor(function (v) { editVendor(v); }, function (v) { removeRec('vendors', v, draw); }, metaFromVendor),
        empty: { icon: 'truck', title: 'No vendors yet', hint: 'Add your first GSA or supplier.' }
      });
      host.appendChild(t.el);
    }
  }
  function editVendor(v) {
    var isNew = !v;
    EPAL.formModal({
      title: isNew ? 'Add Vendor' : 'Edit Vendor', icon: 'truck', size: 'lg', record: v || {},
      fields: [
        { type: 'section', label: 'Identity' },
        { key: 'photo', label: 'Vendor profile picture', type: 'image', icon: 'buildings', col2: true, round: false, hint: 'Logo or photo — shown on the vendor card & statements.' },
        { key: 'name', label: 'Vendor name', type: 'text', required: true, col2: true, placeholder: 'e.g. Galaxy GSA' },
        { key: 'type', label: 'Type', type: 'select', options: VENDOR_TYPES, default: 'Ticketing' },
        { key: 'contact', label: 'Contact person', type: 'text' },
        { key: 'email', label: 'Email', type: 'email' },
        { key: 'phone', label: 'Phone', type: 'phone' },
        { type: 'section', label: 'Responsible Contact' },
        { key: 'respName', label: 'Responsible person', type: 'text', placeholder: 'Who we deal with' },
        { key: 'respDesignation', label: 'Designation', type: 'text', placeholder: 'e.g. Sales Manager' },
        { key: 'respPhone', label: 'Direct phone', type: 'phone' },
        { key: 'respEmail', label: 'Direct email', type: 'email' },
        { type: 'section', label: 'Address' },
        { key: 'country', label: 'Country', type: 'text', default: 'Bangladesh' },
        { key: 'city', label: 'City', type: 'text', default: 'Dhaka' },
        { key: 'address', label: 'Address', type: 'textarea', col2: true },
        { type: 'section', label: 'Commercial' },
        { key: 'currency', label: 'Currency', type: 'select', options: CURRENCIES, default: 'BDT' },
        { key: 'openingBalance', label: 'Opening balance (payable)', type: 'money', default: 0 },
        { key: 'creditLimit', label: 'Credit limit', type: 'money', default: 500000, min: 0 },
        { key: 'paymentTerms', label: 'Payment terms', type: 'select', options: TERMS, default: 'Net 15' },
        { key: 'status', label: 'Status', type: 'select', options: ['Active', 'Inactive'], default: 'Active' },
        { key: 'bank', label: 'Bank / account', type: 'text', col2: true },
        { type: 'section', label: 'ERP Access (Vendor role)' },
        { key: 'createLogin', label: 'Give this vendor an ERP login (vendor role)', type: 'checkbox', col2: true,
          hint: 'Provisions a vendor-role user in the ERP user list. Access control is enforced by the backend (RBAC — coming later).' },
        { key: 'loginEmail', label: 'Login email', type: 'email', showIf: function (x) { return x.createLogin; } },
        { key: 'loginPassword', label: 'Password', type: 'password', showIf: function (x) { return x.createLogin; }, placeholder: 'Set an initial password' }
      ],
      onSave: function (val) {
        var rec = v || { id: 'VN-' + ui.uid('').slice(-4) };
        rec.name = val.name.trim(); rec.type = val.type; rec.contact = val.contact; rec.email = val.email;
        rec.phone = val.phone; rec.country = val.country; rec.city = val.city; rec.address = val.address;
        rec.currency = val.currency; rec.creditLimit = +val.creditLimit || 0; rec.terms = val.paymentTerms;
        rec.paymentTerms = val.paymentTerms; rec.bank = val.bank; rec.status = val.status || 'Active';
        rec.photo = val.photo || '';
        rec.responsible = { name: val.respName || '', designation: val.respDesignation || '', phone: val.respPhone || '', email: val.respEmail || '' };
        if (isNew) rec.balance = +val.openingBalance || 0; else rec.openingBalance = +val.openingBalance || 0;
        // ERP user provisioning (data only — RBAC enforcement lands with the backend)
        if (val.createLogin && (val.loginEmail || rec.email)) {
          rec.login = { email: val.loginEmail || rec.email, role: 'vendor', enabled: true };
          provisionPartyUser(rec, 'vendor', val.loginPassword);
        }
        db.save('vendors', rec);
        // the opening balance lands in the BOOKS too (party statement + AP aging),
        // not just on the record — stable id, so edits update rather than duplicate
        var ob = +val.openingBalance || 0;
        try {
          if (EPAL.ledger && EPAL.ledger.post) {
            if (ob > 0) EPAL.ledger.post({ id: 'GL-OPVD-' + rec.id, date: new Date().toISOString().slice(0, 10), companyId: 'travels', ref: 'OPEN-' + rec.id, memo: 'Opening balance · ' + rec.name, source: 'opening', party: rec.name, override: true, lines: [ { account: '3100', dr: ob, cr: 0 }, { account: '2000', dr: 0, cr: ob } ] });
            else if (EPAL.ledger.remove) EPAL.ledger.remove('GL-OPVD-' + rec.id);
          }
        } catch (e) {}
        ui.toast('Vendor "' + rec.name + '" saved' + (val.createLogin ? ' · ERP login provisioned' : ''), 'success');
        EPAL.router.render();
        return true;
      }
    });
  }
  // Provision a role-scoped user in the ERP user directory (a separate store so it
  // never pollutes HR headcount). The Laravel backend maps this to a User + role;
  // here we just persist the record so it exists in the user list. Shared by
  // vendors / sub-agents / customers — any party that logs into a portal.
  function provisionPartyUser(rec, role, password) {
    var u = {
      id: 'USR-' + String(rec.id || ui.uid('')).replace(/[^0-9A-Za-z]/g, ''),
      name: rec.name, email: (rec.login && rec.login.email) || rec.email || '',
      role: role, scope: 'travels', partyType: role, partyId: rec.id,
      photo: rec.photo || '', phone: rec.phone || '', status: rec.status || 'Active',
      designation: cap(role) + (rec.type ? ' · ' + rec.type : ''), createdAt: Date.now()
    };
    if (password) u.password = password;   // demo only — hashed server-side in Laravel
    try { db.save('erp_users', u); } catch (e) {}
    if (EPAL.bus && EPAL.bus.emit) EPAL.bus.emit('data:changed', { store: 'erp_users', action: 'upsert', record: u });
  }
  function metaFromVendor(v) {
    return { name: v.name, partyType: 'vendor', creditLimit: +v.creditLimit || 500000,
      location: v.city || v.country || 'Dhaka', phone: v.phone, email: v.email,
      photo: v.photo, responsible: v.responsible, login: v.login };
  }

  /* ======================================================= AGENTS */
  function agentsView(page) {
    if (canCreate()) page.querySelector('.page-actions').prepend(el('button.btn.btn-ghost', {
      html: ui.icon('plus-lg') + ' Add Agent', onclick: function () { editAgent(null); } }));
    var host = el('div'); page.appendChild(host);
    draw();
    function draw() {
      host.innerHTML = '';
      var t = EPAL.table({
        columns: [
          { key: 'name', label: 'Agent', render: function (a) { return '<span class="strong">' + ui.escapeHtml(a.name) + '</span>'; } },
          { key: 'agency', label: 'Agency' },
          { key: 'service', label: 'Service', badge: {} },
          { key: 'commission', label: 'Comm %', num: true, render: function (a) { return (a.commission || 0) + '%'; }, sortVal: function (a) { return a.commission || 0; } },
          { key: 'totalSales', label: 'Sales', num: true, money: true },
          { key: 'balance', label: 'Receivable', num: true, render: function (a) {
              var b = ledgerBalance(a.name, a.balance);
              return '<span class="num ' + (b > 0 ? 'text-good' : 'text-mute') + '">' + ui.money(b) + '</span>'; },
            sortVal: function (a) { return ledgerBalance(a.name, a.balance); } },
          { key: 'lastActivity', label: 'Last Activity', sortVal: function (a) { return lastActivityTs(a.name); },
            render: function (a) { var d = lastActivityOf(a.name); return '<span class="text-mute">' + (d ? ui.ago(d) : '—') + '</span>'; } },
          { key: 'status', label: 'Status', badge: { Active: 'good', Inactive: '' } }
        ],
        // location dropped from the grid (it shows in the detail); kept searchable + in the Filter card
        rows: function () { var SV = ['Ticketing', 'Visa', 'Hotel', 'Package']; return agents().map(function (a, i) { if (!a.status) a.status = 'Active'; if (!a.service) a.service = SV[i % SV.length]; return a; }); },
        searchKeys: ['name', 'agency', 'location', 'service'],
        quickFilter: 'service',                                // Ticketing / Visa / Hotel / Package chips
        filterPanel: true,                                     // Status + Location + sort in the Filter card
        filters: [{ key: 'status', label: 'Status' }, { key: 'location', label: 'Location' }],
        pageSize: 10, exportName: 'agents.csv', pdfTitle: 'Sub-Agent Register',
        onRow: function (a) { openLedgerModal(metaFromAgent(a), a); },
        actions: actionsFor(function (a) { editAgent(a); }, function (a) { removeRec('tv_agents', a, draw); }, metaFromAgent),
        empty: { icon: 'person-badge', title: 'No agents yet', hint: 'Add your first sub-agent.' }
      });
      host.appendChild(t.el);
    }
  }
  function editAgent(a) {
    var isNew = !a;
    EPAL.formModal({
      title: isNew ? 'Add Sub-Agent' : 'Edit Sub-Agent', icon: 'person-badge', size: 'lg', record: a || {},
      fields: [
        { type: 'section', label: 'Agent' },
        { key: 'photo', label: 'Profile picture', type: 'image', icon: 'person-badge', col2: true, round: true },
        { key: 'name', label: 'Agent name', type: 'text', required: true, col2: true },
        { key: 'agency', label: 'Agency', type: 'text', required: true },
        { key: 'service', label: 'Service line', type: 'select', options: ['Ticketing', 'Visa', 'Hotel', 'Package'], default: 'Ticketing' },
        { key: 'phone', label: 'Phone', type: 'phone' },
        { key: 'email', label: 'Email', type: 'email' },
        { key: 'location', label: 'Location', type: 'text', default: 'Dhaka' },
        { type: 'section', label: 'Responsible Contact' },
        { key: 'respName', label: 'Responsible person', type: 'text', placeholder: 'Who we deal with' },
        { key: 'respDesignation', label: 'Designation', type: 'text' },
        { key: 'respPhone', label: 'Direct phone', type: 'phone' },
        { key: 'respEmail', label: 'Direct email', type: 'email' },
        { type: 'section', label: 'Commercial' },
        { key: 'commission', label: 'Commission %', type: 'number', default: 4, min: 0, max: 20 },
        { key: 'totalSales', label: 'Total sales (YTD)', type: 'money', default: 0, min: 0 },
        { key: 'balance', label: 'Opening balance (receivable)', type: 'money', default: 0 },
        { key: 'status', label: 'Status', type: 'select', options: ['Active', 'Inactive'], default: 'Active' },
        { type: 'section', label: 'ERP Access (Agent portal)' },
        { key: 'createLogin', label: 'Give this sub-agent an ERP login (agent role)', type: 'checkbox', col2: true,
          hint: 'Provisions an agent-role user in the ERP user list (RBAC enforced by the backend later).' },
        { key: 'loginEmail', label: 'Login email', type: 'email', showIf: function (x) { return x.createLogin; } },
        { key: 'loginPassword', label: 'Password', type: 'password', showIf: function (x) { return x.createLogin; } }
      ],
      onSave: function (val) {
        var rec = a || { id: 'AGT-' + ui.uid('').slice(-4) };
        rec.name = val.name.trim(); rec.agency = val.agency; rec.phone = val.phone; rec.email = val.email;
        rec.location = val.location; rec.service = val.service || 'Ticketing'; rec.photo = val.photo || '';
        rec.commission = +val.commission || 0; rec.totalSales = +val.totalSales || 0;
        rec.balance = +val.balance || 0; rec.status = val.status;
        rec.responsible = { name: val.respName || '', designation: val.respDesignation || '', phone: val.respPhone || '', email: val.respEmail || '' };
        if (val.createLogin && (val.loginEmail || rec.email)) { rec.login = { email: val.loginEmail || rec.email, role: 'agent', enabled: true }; provisionPartyUser(rec, 'agent', val.loginPassword); }
        db.save('tv_agents', rec);
        // agent opening balance (receivable) lands in the books as well
        var ob2 = +val.balance || 0;
        try {
          if (EPAL.ledger && EPAL.ledger.post) {
            if (ob2 > 0) EPAL.ledger.post({ id: 'GL-OPAG-' + rec.id, date: new Date().toISOString().slice(0, 10), companyId: 'travels', ref: 'OPEN-' + rec.id, memo: 'Opening balance · ' + rec.name, source: 'opening', party: rec.name, override: true, lines: [ { account: '1150', dr: ob2, cr: 0 }, { account: '3100', dr: 0, cr: ob2 } ] });
            else if (EPAL.ledger.remove) EPAL.ledger.remove('GL-OPAG-' + rec.id);
          }
        } catch (e) {}
        ui.toast('Agent "' + rec.name + '" saved', 'success');
        EPAL.router.render();
        return true;
      }
    });
  }
  function metaFromAgent(a) {
    return { name: a.name, partyType: 'agent', creditLimit: +a.creditLimit || 800000,
      location: a.location || 'Dhaka', commission: +a.commission || 0, totalSales: +a.totalSales || 0,
      phone: a.phone, email: a.email, photo: a.photo, responsible: a.responsible, login: a.login };
  }

  /* ======================================================= PORTALS */
  function portalsView(page) {
    if (canCreate()) page.querySelector('.page-actions').prepend(el('button.btn.btn-ghost', {
      html: ui.icon('plus-lg') + ' Add Portal', onclick: function () { editPortal(null); } }));
    var host = el('div'); page.appendChild(host);
    draw();
    function draw() {
      host.innerHTML = '';
      var list = portals();
      var totalWallet = list.reduce(function (a, p) { return a + (+p.balance || 0); }, 0);
      var connected = list.filter(function (p) { return p.status === 'Connected'; }).length;
      var attention = list.filter(function (p) { return p.status !== 'Connected'; });
      var lowWallet = list.filter(function (p) { return (+p.balance || 0) < 20000 && p.type !== 'Settlement'; });
      host.appendChild(kgrid('div.kpi-grid.kpi-compact.stagger', null, [
        kpi('Total Wallet', ui.money(totalWallet, { compact: true }), 'wallet2'),
        kpi('Connected', connected + ' / ' + list.length, 'plug'),
        kpi('Needs Attention', attention.length, 'exclamation-triangle'),
        kpi('Channels', list.length, 'hdd-network')
      ]));
      if (attention.length) host.appendChild(el('div.build-banner.mb-3', null, [ ui.frag(ui.icon('exclamation-octagon-fill')),
        el('div', { html: '<strong>' + attention.length + ' channel' + (attention.length === 1 ? '' : 's') + ' not connected.</strong> ' + attention.map(function (p) { return ui.escapeHtml(p.name) + ' (' + p.status + ')'; }).join(', ') }) ]));
      if (lowWallet.length) host.appendChild(el('div.build-banner.mb-3', null, [ ui.frag(ui.icon('exclamation-triangle-fill')),
        el('div', { html: '<strong>Low wallet.</strong> ' + lowWallet.length + ' channel' + (lowWallet.length === 1 ? '' : 's') + ' below ' + ui.money(20000) + ' — top up to avoid booking failures: ' + lowWallet.map(function (p) { return ui.escapeHtml(p.name); }).join(', ') }) ]));
      var t = EPAL.table({
        columns: [
          { key: 'name', label: 'Portal', render: function (p) {
              var av = p.logo ? '<span class="avatar" style="width:26px;height:26px;background-image:url(' + p.logo + ');background-size:cover;background-position:center"></span>'
                : '<span class="avatar" style="width:26px;height:26px;font-size:10px;background:' + ui.colorFor(p.name) + '">' + ui.initials(p.name) + '</span>';
              return '<div class="flex items-center gap-1">' + av + '<span class="strong">' + ui.escapeHtml(p.name) + '</span></div>'; } },
          { key: 'type', label: 'Type', badge: {} },
          { key: 'url', label: 'Endpoint', render: function (p) { return '<span class="text-mute sm">' + ui.escapeHtml(p.url || '—') + '</span>'; } },
          { key: 'balance', label: 'Wallet', num: true, render: function (p) { var b = +p.balance || 0; return '<span class="num ' + (b < 20000 && p.type !== 'Settlement' ? 'text-warn' : '') + '">' + ui.money(b) + '</span>'; }, sortVal: function (p) { return +p.balance || 0; } },
          { key: 'autoSync', label: 'Auto-sync' },
          { key: 'status', label: 'Status', badge: { Connected: 'good', Disconnected: 'bad', Error: 'warn' } }
        ],
        rows: portals(),
        searchKeys: ['name', 'type', 'url'],
        quickFilter: 'type', filterPanel: true,
        filters: [{ key: 'status', label: 'Status' }],
        pageSize: 10, exportName: 'portals.csv', pdfTitle: 'Portals & Channels',
        onRow: function (p) { portalDetail(p); },
        actions: actionsFor(function (p) { editPortal(p); }, function (p) { removeRec('tv_portals', p, draw); }),
        empty: { icon: 'hdd-network', title: 'No portals yet', hint: 'Connect your first channel.' }
      });
      host.appendChild(t.el);
    }
  }
  function portalMsg(p) {
    return 'Channel: ' + p.name + ' (' + (p.type || '—') + ')\nEndpoint: ' + (p.url || '—') + '\nWallet: ' + ui.money(p.balance || 0) +
      '\nStatus: ' + (p.status || '—') + '\n\n— Epal Travels & Consultancy';
  }
  function printPortal(p) {
    function r(k, v) { return '<tr><td>' + k + '</td><td>' + ui.escapeHtml(String(v == null ? '—' : v)) + '</td></tr>'; }
    ui.printDoc({ title: 'Channel · ' + p.name, subtitle: (p.type || '') + ' · Epal Travels & Consultancy', meta: 'Portal / channel',
      bodyHtml: '<table>' + r('Name', p.name) + r('Type', p.type) + r('Endpoint', p.url) + r('Wallet balance', ui.money(p.balance || 0)) +
        r('Auto-sync', p.autoSync) + r('Status', p.status) + r('Account manager', p.responsible && p.responsible.name) + '</table>' });
  }
  /* ---- portal detail — the SAME rich layout: header + KPIs + connection info */
  function portalDetail(p) {
    var body = el('div');
    ui.modal({ title: p.name, icon: 'hdd-network', size: 'lg', body: body, footer: false });
    var resp = p.responsible || {};
    var actions = el('div.flex.gap-1.items-center.flex-wrap', { style: { marginLeft: 'auto' } });
    if (canCreate()) actions.appendChild(el('button.btn.btn-sm.btn-outline', { html: ui.icon('pencil') + ' Edit', onclick: function () { editPortal(p); } }));
    actions.appendChild(el('button.btn.btn-sm.btn-primary', { html: ui.icon('printer') + ' Print', onclick: function () { printPortal(p); } }));
    actions.appendChild(ui.rowActions(ui.actions({
      wa: { phone: resp.phone, text: portalMsg(p) }, gmail: { to: resp.email, subject: 'Epal Travels — ' + p.name, body: portalMsg(p) },
      profile: { name: p.name, card: { title: p.name, subtitle: (p.type || 'Channel'), lines: [
        ['Endpoint', p.url || '—'], ['Wallet', ui.money(p.balance || 0)], ['Auto-sync', p.autoSync || '—'], ['Status', p.status || '—'] ] }, pdf: function () { printPortal(p); } }
    })));
    var tone = p.status === 'Connected' ? 'good' : p.status === 'Error' ? 'warn' : 'bad';
    body.appendChild(el('div.card', null, [ el('div.card-body', null, [
      el('div.flex.items-center.gap-2.flex-wrap.mb-3', null, [
        p.logo ? ui.frag('<span class="avatar" style="width:42px;height:42px;background-image:url(' + p.logo + ');background-size:cover;background-position:center"></span>')
               : ui.frag('<span class="notif-ico notif-info">' + ui.icon('hdd-network') + '</span>'),
        el('div.flex-1', { style: { minWidth: '180px' } }, [ el('div.fw-700', { style: { fontSize: '17px' }, text: p.name }),
          el('div.flex.items-center.gap-2.flex-wrap', null, [ el('span.badge', { text: p.type || '—' }),
            el('span.badge.badge-' + tone, { text: p.status || '—' }),
            p.url ? el('div.text-mute.sm', { text: p.url }) : null ]) ]),
        actions
      ]),
      el('div.stat-row', null, [
        st2('Wallet Balance', ui.money(p.balance || 0)), st2('Auto-sync', p.autoSync || '—'),
        st2('Status', p.status || '—'), st2('Type', p.type || '—')
      ])
    ]) ]));
    body.appendChild(el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon('sliders') + ' Connection & Contact' }) ]),
      el('div.card-body', null, [ el('div.data-list', null, [
        drow('Endpoint / URL', p.url), drow('API key / username', p.apiKey ? String(p.apiKey).replace(/.(?=.{4})/g, '•') : '—'),
        p.pcc ? drow('PCC / Office ID', p.pcc) : null, p.iataNo ? drow('IATA / ARC number', p.iataNo) : null,
        p.bspRegion ? drow('BSP region', p.bspRegion) : null, p.vfsAccount ? drow('VFS / embassy account', p.vfsAccount) : null,
        p.propertyAccess ? drow('Property / rate access', p.propertyAccess) : null,
        drow('Auto-sync', p.autoSync), drow('Account manager', resp.name), drow('Manager phone', resp.phone), drow('Manager email', resp.email),
        drow('Notes', p.notes)
      ]) ])
    ]));
  }
  function drow(k, v) { return el('div.data-row', null, [ el('div.text-mute.sm.flex-1', { text: k }), el('div.strong', { text: v == null || v === '' ? '—' : String(v) }) ]); }
  function editPortal(p) {
    var isNew = !p;
    EPAL.formModal({
      title: isNew ? 'Add Portal / Channel' : 'Edit Portal', icon: 'hdd-network', size: 'lg', record: p || {},
      fields: [
        { type: 'section', label: 'Channel' },
        { key: 'logo', label: 'Logo', type: 'image', icon: 'hdd-network', col2: true },
        { key: 'name', label: 'Portal name', type: 'text', required: true, col2: true },
        { key: 'type', label: 'Type', type: 'select', options: PORTAL_TYPES, default: 'GDS' },
        { key: 'url', label: 'Endpoint / URL', type: 'text' },
        { type: 'section', label: 'Credentials' },
        { key: 'apiKey', label: 'API key / username', type: 'text' },
        { key: 'apiSecret', label: 'API secret / password', type: 'password' },
        { key: 'autoSync', label: 'Auto-sync', type: 'select', options: SYNC_OPTS, default: 'Hourly' },
        { type: 'section', label: 'Channel Config' },
        { key: 'pcc', label: 'PCC / Office ID', type: 'text', hint: 'GDS pseudo-city / office ID', showIf: function (x) { return ['GDS', 'Settlement'].indexOf(x.type) >= 0; } },
        { key: 'iataNo', label: 'IATA / ARC number', type: 'text', showIf: function (x) { return ['GDS', 'Settlement', 'Aggregator'].indexOf(x.type) >= 0; } },
        { key: 'bspRegion', label: 'BSP region / market', type: 'text', default: 'Bangladesh', showIf: function (x) { return x.type === 'Settlement'; } },
        { key: 'vfsAccount', label: 'VFS / embassy account', type: 'text', showIf: function (x) { return x.type === 'Visa'; } },
        { key: 'propertyAccess', label: 'Property / rate access', type: 'text', showIf: function (x) { return x.type === 'Hotel Aggregator'; } },
        { type: 'section', label: 'Account Manager' },
        { key: 'respName', label: 'Contact name', type: 'text' },
        { key: 'respPhone', label: 'Phone', type: 'phone' },
        { key: 'respEmail', label: 'Email', type: 'email' },
        { type: 'section', label: 'Commercial' },
        { key: 'balance', label: 'Wallet / balance', type: 'money', default: 0 },
        { key: 'status', label: 'Status', type: 'select', options: ['Connected', 'Disconnected', 'Error'], default: 'Connected' },
        { key: 'notes', label: 'Notes', type: 'textarea', col2: true }
      ],
      onSave: function (val) {
        var rec = p || { id: 'PTL-' + ui.uid('').slice(-4) };
        rec.name = val.name.trim(); rec.type = val.type; rec.url = val.url; rec.logo = val.logo || '';
        rec.apiKey = val.apiKey; rec.apiSecret = val.apiSecret; rec.autoSync = val.autoSync;
        rec.pcc = val.pcc; rec.iataNo = val.iataNo; rec.bspRegion = val.bspRegion; rec.vfsAccount = val.vfsAccount; rec.propertyAccess = val.propertyAccess;
        rec.responsible = { name: val.respName || '', phone: val.respPhone || '', email: val.respEmail || '' };
        rec.balance = +val.balance || 0; rec.status = val.status; rec.notes = val.notes;
        db.save('tv_portals', rec);
        ui.toast('Portal "' + rec.name + '" saved', 'success');
        EPAL.router.render();
        return true;
      }
    });
  }

  /* ======================================================= ACCOUNTS (LEDGER) */
  function accountsView(page) {
    var pm = allParties();
    var names = Object.keys(pm).sort();
    if (!names.length) {
      page.appendChild(el('div.empty-state', null, [ ui.frag(ui.icon('inbox')),
        el('h3', { text: 'No parties yet' }), el('p.text-muted', { text: 'Add a vendor or agent first.' }) ]));
      return;
    }
    // A searchable LIST of every party — click a row to open its full ledger.
    var rows = names.map(function (nm) {
      var p = pm[nm], bal = ledgerBalance(nm, 0), last = lastActivityOf(nm);
      var limit = +p.creditLimit || (p.partyType === 'agent' ? 800000 : 500000);
      return { name: nm, partyType: cap(p.partyType), creditLimit: limit,
        util: limit ? Math.round(Math.max(0, bal) / limit * 100) : 0, txns: txnsFor(nm).length,
        balance: bal, lastTs: lastActivityTs(nm), lastLabel: last ? ui.ago(last) : '—',
        status: p.status || 'Active', _meta: p };
    });
    var t = EPAL.table({
      columns: [
        { key: 'name', label: 'Party', render: function (r) {
            var p = r._meta;
            var av = p.photo
              ? '<span class="avatar" style="width:26px;height:26px;background-image:url(' + p.photo + ');background-size:cover;background-position:center"></span>'
              : '<span class="avatar" style="width:26px;height:26px;font-size:10px;background:' + ui.colorFor(r.name) + '">' + ui.initials(r.name) + '</span>';
            return '<div class="flex items-center gap-1">' + av + '<span class="strong">' + ui.escapeHtml(r.name) + '</span></div>'; } },
        { key: 'partyType', label: 'Type', render: function (r) { return typeBadgeNode(r._meta.partyType).outerHTML; }, sortVal: function (r) { return r.partyType; } },
        { key: 'creditLimit', label: 'Credit Limit', num: true, money: true },
        { key: 'balance', label: 'Balance', num: true, render: function (r) {
            return '<span class="num ' + (r.balance > 0 ? (r._meta.partyType === 'agent' ? 'text-good' : 'text-bad') : 'text-mute') + '">' + ui.money(r.balance) + '</span>'; },
          sortVal: function (r) { return r.balance; } },
        { key: 'util', label: 'Credit Used', sort: true, sortVal: function (r) { return r.util; }, render: function (r) {
            var col = r.util > 90 ? '#f0506e' : r.util > 70 ? '#f4b740' : '#23c17e';
            return '<div style="display:flex;align-items:center;gap:8px;min-width:132px">' +
              '<div style="flex:1;height:6px;border-radius:6px;background:var(--surface-3,#2a3350);overflow:hidden">' +
              '<div style="width:' + Math.min(100, r.util) + '%;height:100%;background:' + col + '"></div></div>' +
              '<span class="num xs" style="min-width:30px">' + r.util + '%</span></div>'; } },
        { key: 'txns', label: 'Txns', num: true, render: function (r) { return '<span class="text-mute">' + r.txns + '</span>'; } },
        { key: 'lastLabel', label: 'Last Activity', sortVal: function (r) { return r.lastTs; },
          render: function (r) { return '<span class="text-mute">' + r.lastLabel + '</span>'; } },
        { key: 'status', label: 'Status', render: function (r) { return '<span class="badge' + (r.status === 'Active' ? ' badge-good' : '') + '">' + r.status + '</span>'; } }
      ],
      rows: rows, searchKeys: ['name', 'partyType'],
      quickFilter: 'partyType', filterPanel: true, filters: [{ key: 'status', label: 'Status' }],
      exportName: 'party-ledger.csv', pdfTitle: 'Party Ledger',
      onRow: function (r) { openLedgerModal(r._meta, r._meta.agentRec); },
      actions: ui.actions({
        print: function (r) { printParty({ name: r.name, balance: r.balance, phone: r._meta.phone, email: r._meta.email }); },
        wa:    function (r) { return { phone: r._meta.phone, text: partyMsg({ name: r.name, balance: r.balance }) }; },
        gmail: function (r) { return { to: r._meta.email, subject: 'Epal Travels & Consultancy', body: partyMsg({ name: r.name, balance: r.balance }) }; }
      }),
      empty: { icon: 'people', title: 'No parties yet', hint: 'Add a vendor or sub-agent first.' }
    });
    page.appendChild(el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon('people-fill') + ' Party Ledger' }),
        el('span.card-sub', { text: rows.length + ' parties · click to open the full statement' }) ]),
      el('div.card-body', null, [ t.el ])
    ]));
  }

  // Full party ledger — shared by the accounts sub AND the row-click modal.
  function renderLedger(host, meta, agentRec) {
    host.innerHTML = '';
    var led = computeLedger(meta.name), ag = led.ageing;
    var limit = meta.creditLimit || 500000;
    var util = limit ? Math.round(Math.max(0, led.balance) / limit * 100) : 0;
    var over = util > 90;

    // --- actions: sit TOP-RIGHT of the header, in the vacant space beside the
    //     name (not their own row) — one clean line of controls. ---
    var actions = el('div.flex.gap-1.items-center.flex-wrap', { style: { marginLeft: 'auto' } });
    if (canCreate()) {
      actions.appendChild(el('button.btn.btn-sm.btn-outline', { html: ui.icon('file-earmark-plus') + ' Record Invoice',
        onclick: function () { recordTxn(meta, true, function () { renderLedger(host, meta, agentRec); }); } }));
      actions.appendChild(el('button.btn.btn-sm.btn-outline', { html: ui.icon('cash-coin') + ' Record Payment',
        onclick: function () { recordTxn(meta, false, function () { renderLedger(host, meta, agentRec); }); } }));
    }
    actions.appendChild(el('button.btn.btn-sm.btn-primary', { html: ui.icon('printer') + ' Statement',
      onclick: function () { openStatement(meta); } }));
    // WhatsApp + Gmail — icon-only; offers to attach the party profile (PDF/JPG)
    // before opening the chat (or just send the message).
    actions.appendChild(ui.rowActions(ui.actions({
      wa:    { phone: meta.phone, text: partyMsg({ name: meta.name, balance: led.balance }) },
      gmail: { to: meta.email, subject: 'Epal Travels & Consultancy', body: partyMsg({ name: meta.name, balance: led.balance }) },
      profile: { name: meta.name,
        card: { title: meta.name, subtitle: cap(meta.partyType) + ' · ' + (meta.location || 'Dhaka'), lines: [
          [meta.partyType === 'agent' ? 'Receivable' : 'Payable', ui.money(led.balance)],
          ['Total Charged', ui.money(led.debit)], ['Total Settled', ui.money(led.credit)],
          ['Credit Limit', ui.money(limit)], ['Phone', meta.phone || '—'], ['Email', meta.email || '—'] ] },
        pdf: function () { printParty({ name: meta.name, phone: meta.phone, email: meta.email, balance: led.balance, type: cap(meta.partyType) }); } }
    })));

    // --- header / credit control card ---
    var head = el('div.card', null, [ el('div.card-body', null, [
      el('div.flex.items-center.gap-2.flex-wrap.mb-3', null, [
        meta.photo
          ? ui.frag('<span class="avatar" style="width:42px;height:42px;background-image:url(' + meta.photo + ');background-size:cover;background-position:center"></span>')
          : ui.frag('<span class="notif-ico notif-' + (meta.partyType === 'agent' ? 'success' : 'info') + '">' + ui.icon(meta.partyType === 'agent' ? 'person-badge' : 'truck') + '</span>'),
        el('div.flex-1', { style: { minWidth: '180px' } }, [ el('div.fw-700', { style: { fontSize: '17px' }, text: meta.name }),
          el('div.flex.items-center.gap-2.flex-wrap', null, [
            el('div.text-mute.sm', { text: cap(meta.partyType) + ' · ' + (meta.location || 'Dhaka') }),
            typeBadgeNode(meta.partyType),
            (meta.login && meta.login.enabled) ? el('span.badge.badge-good', { html: ui.icon('person-check') + ' ERP login' }) : null
          ]),
          (meta.responsible && meta.responsible.name)
            ? el('div.text-mute.xs.mt-1', { text: 'Responsible: ' + meta.responsible.name + (meta.responsible.designation ? ' · ' + meta.responsible.designation : '') + (meta.responsible.phone ? ' · ' + meta.responsible.phone : '') })
            : null
        ]),
        actions
      ]),
      el('div.stat-row', null, [
        st2(meta.partyType === 'agent' ? 'Receivable' : 'Payable', ui.money(led.balance)),
        st2('Total Charged', ui.money(led.debit)),
        st2('Total Settled', ui.money(led.credit)),
        st2('Credit Limit', ui.money(limit))
      ]),
      el('div.mt-3', null, [
        el('div.flex.justify-between.sm.mb-1', null, [
          el('span.text-mute', { text: 'Credit utilisation' }),
          el('span', { html: '<span class="' + (over ? 'text-bad' : util > 70 ? 'text-warn' : 'text-good') + ' strong">' + util + '%</span>' }) ]),
        util > 100 ? null : el('div', { style: { height: '8px', borderRadius: '99px', background: 'var(--surface-3,#2a3350)', overflow: 'hidden' } }, [
          el('div', { style: { height: '100%', width: Math.min(100, util) + '%',
            background: over ? '#f0506e' : util > 70 ? '#f4b740' : '#23c17e' } }) ]),
        over ? el('div.build-banner.mt-2', null, [ ui.frag(ui.icon('exclamation-triangle-fill')),
          el('div', { html: '<strong>Credit limit alert.</strong> ' + ui.escapeHtml(meta.name) + ' is at ' + util + '% of the ' + ui.money(limit) + ' limit.' }) ]) : null
      ])
    ]) ]);
    host.appendChild(head);

    // --- ageing summary (compact cards, roomier gap) ---
    host.appendChild(kgrid('div.kpi-grid.kpi-compact', null, [
      agBucket('Current', ag.current, ag.total, '#23c17e'),
      agBucket('1 – 30 days', ag.d30, ag.total, '#f4b740'),
      agBucket('31 – 60 days', ag.d60, ag.total, '#e2721b'),
      agBucket('60+ days', ag.d90, ag.total, '#f0506e')
    ]));

    // --- ledger table ---
    var t = EPAL.table({
      columns: [
        { key: 'date', label: 'Date', date: true },
        { key: 'ref', label: 'Reference' },
        { key: 'kind', label: 'Type', render: function (r) { return kindBadge(r.kind); }, sortVal: function (r) { return r.kind; } },
        { key: 'desc', label: 'Description' },
        { key: 'debit', label: 'Debit', num: true, render: function (r) { return r.debit ? ui.money(r.debit) : '—'; }, sortVal: function (r) { return r.debit; } },
        { key: 'credit', label: 'Credit', num: true, render: function (r) { return r.credit ? '<span class="text-good">' + ui.money(r.credit) + '</span>' : '—'; }, sortVal: function (r) { return r.credit; } },
        { key: 'balance', label: 'Balance', num: true, render: function (r) { return '<span class="num strong">' + ui.money(r.balance) + '</span>'; }, sortVal: function (r) { return r.balance; } }
      ],
      rows: led.rows, searchKeys: ['ref', 'kind', 'desc'],
      filters: [{ key: 'kind', label: 'Type' }], pageSize: 12,
      exportName: 'statement-' + meta.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '.csv',
      empty: { icon: 'journal', title: 'No transactions yet', hint: 'Record an invoice or payment to start the ledger.' }
    });
    var tcard = el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon('journal-text') + ' Statement of Account' }),
        el('span.card-sub', { text: led.rows.length + ' transactions' }) ]),
      el('div.card-body') ]);
    tcard.querySelector('.card-body').appendChild(t.el);
    host.appendChild(tcard);

    // agent commission snapshot
    if (meta.partyType === 'agent' && (meta.totalSales || (agentRec && agentRec.totalSales))) {
      var ts = meta.totalSales || agentRec.totalSales, cm = meta.commission || (agentRec ? agentRec.commission : 0);
      var expected = Math.round(ts * (cm / 100));
      host.appendChild(el('div.card', null, [ el('div.card-body', null, [
        el('div.section-label', { text: 'Commission Snapshot' }),
        el('div.stat-row', null, [
          st2('Total Sales', ui.money(ts)), st2('Rate', cm + '%'),
          st2('Expected', ui.money(expected)), st2('Tier', tierFor(ts)) ])
      ]) ]));
    }

    // discussion thread
    if (EPAL.comments && EPAL.comments.widget) {
      host.appendChild(el('div.section-label', { text: 'Notes & Discussion' }));
      host.appendChild(EPAL.comments.widget('party', meta.name));
    }
  }

  function openLedgerModal(meta, agentRec) {
    var body = el('div');
    ui.modal({ title: meta.name, icon: meta.partyType === 'agent' ? 'person-badge' : 'truck',
      size: 'lg', body: body, footer: false });
    renderLedger(body, meta, agentRec);
  }

  /* ---- record a transaction (append + balanced ledger post) --------------*/
  function recordTxn(meta, isDebit, done) {
    var kinds = isDebit ? DEBIT_KINDS : CREDIT_KINDS;
    EPAL.formModal({
      title: isDebit ? 'Record Invoice / Charge' : 'Record Payment / Credit',
      icon: isDebit ? 'file-earmark-plus' : 'cash-coin', size: 'md',
      fields: [
        { key: 'kind', label: 'Kind', type: 'select', options: kinds, default: kinds[0] },
        { key: 'date', label: 'Date', type: 'date', required: true, default: '2026-07-05' },
        { key: 'amount', label: 'Amount (BDT)', type: 'money', required: true, min: 1 },
        { key: 'desc', label: 'Description', type: 'text', col2: true,
          placeholder: isDebit ? 'e.g. Ticket invoice DAC-JED' : 'e.g. bKash payment' }
      ],
      saveLabel: isDebit ? 'Post Invoice' : 'Post Payment',
      onSave: function (val) {
        var amount = +val.amount || 0;
        if (amount <= 0) { ui.toast('Enter a valid amount', 'error'); return false; }
        var kind = val.kind, date = val.date || '2026-07-05';
        var ref = refFor(kind, Date.now());
        var t = { id: ui.uid('PT'), party: meta.name, partyType: meta.partyType, companyId: 'travels',
          date: date, ref: ref, desc: (val.desc || '').trim() || descFor(kind, { type: meta.partyType }),
          kind: kind, debit: isDebit ? amount : 0, credit: isDebit ? 0 : amount,
          due: isDebit ? addDays(date, 30) : '', created: Date.now() };
        db.save('party_txns', t);
        postToLedger(meta, kind, amount, ref, isDebit, date);
        ui.toast((isDebit ? 'Invoice' : 'Payment') + ' ' + ref + ' posted', 'success');
        if (done) done();
        return true;
      }
    });
  }

  function postToLedger(meta, kind, amount, ref, isDebit, date) {
    if (!EPAL.ledger || !EPAL.ledger.post) return;
    var isAgent = meta.partyType === 'agent', lines;
    if (isDebit) {
      // A charge raises what is owed.
      if (isAgent) lines = [ { account: '1150', dr: amount, cr: 0 }, { account: '4000', dr: 0, cr: amount } ];
      else         lines = [ { account: '5000', dr: amount, cr: 0 }, { account: '2000', dr: 0, cr: amount } ];
    } else {
      // A settlement clears what is owed.
      if (isAgent) lines = [ { account: '1010', dr: amount, cr: 0 }, { account: '1150', dr: 0, cr: amount } ];
      else         lines = [ { account: '2000', dr: amount, cr: 0 }, { account: '1010', dr: 0, cr: amount } ];
    }
    try {
      EPAL.ledger.post({ date: date, companyId: 'travels', ref: ref,
        memo: kind + ' · ' + meta.name, source: 'manual', party: meta.name, lines: lines });
    } catch (e) { console.error('[vendor-agent] ledger post failed', e); }
  }

  /* ---- branded statement document ---------------------------------------*/
  function openStatement(meta) {
    if (!EPAL.doc || !EPAL.doc.open) { ui.toast('Document engine unavailable', 'error'); return; }
    var led = computeLedger(meta.name), ag = led.ageing;
    var serial = safeSerial('STMT');
    var rows = [ { date: '', ref: '', kind: '', desc: 'Opening Balance', debit: '', credit: '', balance: ui.money(0) } ];
    led.rows.forEach(function (r) {
      rows.push({ date: ui.date(r.date), ref: r.ref, kind: r.kind, desc: r.desc,
        debit: r.debit ? ui.money(r.debit) : '', credit: r.credit ? ui.money(r.credit) : '',
        balance: ui.money(r.balance) });
    });
    var isAgent = meta.partyType === 'agent';
    EPAL.doc.open({
      type: 'voucher',
      title: isAgent ? 'Agent Statement of Account' : 'Vendor Statement of Account',
      serial: serial, companyId: 'travels', badge: 'STATEMENT', watermark: 'STATEMENT',
      parties: [
        { label: isAgent ? 'Sub-Agent' : 'Vendor', name: meta.name,
          lines: [ cap(meta.partyType) + ' — Epal Travels', (meta.location || 'Dhaka') + ', Bangladesh' ] },
        { label: 'Issued By', name: 'Epal Travels & Consultancy',
          lines: [ 'Epal Group of Companies', 'Dhaka, Bangladesh', 'accounts@epalgroup.com' ] }
      ],
      meta: [
        { label: 'Statement No', value: serial },
        { label: 'As of', value: ui.date('2026-07-05') },
        { label: 'Credit Limit', value: ui.money(meta.creditLimit || 0) },
        { label: 'Closing Balance', value: ui.money(led.balance) }
      ],
      columns: [
        { key: 'date', label: 'Date' }, { key: 'ref', label: 'Reference' },
        { key: 'kind', label: 'Type' }, { key: 'desc', label: 'Description' },
        { key: 'debit', label: 'Debit', num: true }, { key: 'credit', label: 'Credit', num: true },
        { key: 'balance', label: 'Balance', num: true }
      ],
      rows: rows,
      totals: [ { label: 'Closing Balance (' + (isAgent ? 'Receivable' : 'Payable') + ')', value: led.balance, grand: true } ],
      words: EPAL.doc.amountInWords(Math.round(Math.abs(led.balance))),
      terms: 'Ageing — Current: ' + ui.money(ag.current) + ' · 1-30: ' + ui.money(ag.d30) +
             ' · 31-60: ' + ui.money(ag.d60) + ' · 60+: ' + ui.money(ag.d90) + '.  E&OE.',
      sign: 'Accounts Department'
    });
  }

  /* ======================================================= COMMISSION */
  // real PAYOUTS: what we've actually paid an agent (tv_comm_paid rows, each one
  // posted to the books as DR 5350 Agent Commission / CR cash, party-tagged)
  function commissionPaid(agentKey) {
    return S.list('tv_comm_paid').filter(function (p) { return p.agent === agentKey; })
      .reduce(function (a, p) { return a + (+p.amount || 0); }, 0);
  }
  function payCommissionForm(r) {
    var out = r.outstanding;
    EPAL.formModal({
      title: 'Pay Commission — ' + r.name, icon: 'percent', size: 'sm', record: { amount: out, date: '2026-07-05', method: 'Bank' },
      fields: [
        { key: 'amount', label: 'Payout (৳)', type: 'money', required: true, min: 1, max: out, hint: 'Outstanding commission ' + ui.money(out) + '.' },
        { key: 'method', label: 'Method', type: 'select', options: ['Bank', 'Cash', 'bKash', 'Nagad', 'Cheque'], default: 'Bank' },
        { key: 'date', label: 'Date', type: 'date', default: '2026-07-05' },
        { key: 'note', label: 'Note', type: 'text' }
      ],
      saveLabel: 'Pay Commission',
      onSave: function (v) {
        var amt = Math.min(+v.amount || 0, out);
        if (amt <= 0) { ui.toast('Enter the payout amount', 'error'); return false; }
        try {
          if (EPAL.ledger && EPAL.ledger.post) EPAL.ledger.post({
            id: 'GL-COMM-' + ui.uid('').slice(-6), date: v.date, companyId: 'travels', ref: 'COMM-' + (r.id || r.name),
            memo: 'Agent commission payout · ' + r.name + (v.note ? ' · ' + v.note : ''), source: 'payment', party: r.name,
            lines: [ { account: '5350', dr: amt, cr: 0 }, { account: v.method === 'Cash' ? '1000' : '1010', dr: 0, cr: amt } ] });
          S.upsert('tv_comm_paid', { id: 'CP-' + ui.uid('').slice(-6), agent: r.id || r.name, name: r.name, amount: amt, date: v.date, method: v.method, note: v.note || '' });
          ui.toast('Paid ' + ui.money(amt) + ' commission to ' + r.name, 'success'); EPAL.router.render(); return true;
        } catch (e) { ui.toast(e.message || 'Failed', 'error'); return false; }
      }
    });
  }
  function commissionView(page) {
    var list = agents().map(function (a) {
      var expected = Math.round((a.totalSales || 0) * ((a.commission || 0) / 100));
      var received = Math.round(expected * receivedRatio(a.id || a.name));
      var paidOut = commissionPaid(a.id || a.name);
      return { id: a.id, name: a.name, agency: a.agency, commission: a.commission || 0,
        totalSales: a.totalSales || 0, expected: expected, received: received, paidOut: paidOut,
        outstanding: Math.max(0, expected - received - paidOut), tier: tierFor(a.totalSales || 0), status: a.status };
    });
    var totExp = 0, totRec = 0, totOut = 0;
    list.forEach(function (r) { totExp += r.expected; totRec += r.received; totOut += r.outstanding; });
    var top = list.slice().sort(function (a, b) { return b.expected - a.expected; })[0];

    page.appendChild(kgrid('div.kpi-grid.kpi-compact.stagger', null, [
      kpi('Expected Commission', ui.money(totExp, { compact: true }), 'percent'),
      kpi('Received', ui.money(totRec, { compact: true }), 'check2-circle'),
      kpi('Outstanding', ui.money(totOut, { compact: true }), 'hourglass-split'),
      kpi('Top Agent', top ? top.name : '—', 'trophy')
    ]));

    function agentRec(r) { return agents().filter(function (a) { return a.id === r.id || a.name === r.name; })[0]; }
    function commissionMsg(r) {
      return 'Dear ' + r.name + ',\n\nCommission summary (Epal Travels & Consultancy):\nExpected: ' + ui.money(r.expected) +
        '\nReceived: ' + ui.money(r.received) + '\nOutstanding: ' + ui.money(r.outstanding) + '\n\nWarm regards,\nAccounts, Epal Travels & Consultancy';
    }

    // the ledger — search (half) + Filter card (sort) + WhatsApp/Gmail per agent
    var t = EPAL.table({
      columns: [
        { key: 'name', label: 'Agent', render: function (r) { return '<span class="strong">' + ui.escapeHtml(r.name) + '</span>'; } },
        { key: 'agency', label: 'Agency' },
        { key: 'tier', label: 'Tier', badge: {} },
        { key: 'totalSales', label: 'Sales', num: true, money: true },
        { key: 'commission', label: 'Rate', num: true, render: function (r) { return r.commission + '%'; }, sortVal: function (r) { return r.commission; } },
        { key: 'expected', label: 'Expected', num: true, money: true },
        { key: 'received', label: 'Received', num: true, render: function (r) { return '<span class="text-good">' + ui.money(r.received) + '</span>'; }, sortVal: function (r) { return r.received; } },
        { key: 'paidOut', label: 'Paid Out', num: true, render: function (r) { return r.paidOut ? '<span class="text-good">' + ui.money(r.paidOut) + '</span>' : '—'; }, sortVal: function (r) { return r.paidOut; } },
        { key: 'outstanding', label: 'Outstanding', num: true, render: function (r) { return r.outstanding > 0 ? '<span class="text-bad">' + ui.money(r.outstanding) + '</span>' : '—'; }, sortVal: function (r) { return r.outstanding; } }
      ],
      rows: list, searchKeys: ['name', 'agency'],
      filterPanel: true, filters: [], pageSize: 12, exportName: 'agent-commission.csv', pdfTitle: 'Agent Commission',
      onRow: function (r) { openLedgerModal(metaFromAgent(agentRec(r) || { name: r.name, commission: r.commission, totalSales: r.totalSales }), r); },
      actions: (canCreate() ? [{ icon: 'cash-coin', title: 'Pay out commission (posts to the books)', onClick: function (r) { if (r.outstanding > 0) payCommissionForm(r); else ui.toast('Nothing outstanding for ' + r.name, 'info'); } }] : []).concat(ui.actions({
        wa:    function (r) { var a = agentRec(r); return { phone: a && a.phone, text: commissionMsg(r) }; },
        gmail: function (r) { var a = agentRec(r); return { to: a && a.email, subject: 'Commission — Epal Travels', body: commissionMsg(r) }; }
      })),
      empty: { icon: 'percent', title: 'No agents yet', hint: 'Add sub-agents to track commission.' }
    });

    // clickable slab tiers — Bronze/Silver/Gold/Platinum filter the ledger by tier
    var selectedTier = null;
    var tierGrid = el('div.grid-auto.kpi-compact.stagger.mb-3');
    function paintTiers() {
      tierGrid.innerHTML = '';
      SLABS.forEach(function (s) {
        var active = selectedTier === s.tier;
        tierGrid.appendChild(el('button.card.tier-card' + (active ? '.active' : ''), { type: 'button', onclick: function () {
          selectedTier = active ? null : s.tier;
          t.state.filters.tier = selectedTier || '__all'; t.state.page = 0; t.refresh(); paintTiers();
        } }, [ el('div.card-pad', null, [
          el('div.flex.items-center.gap-2', null, [
            el('span', { style: { width: '10px', height: '10px', borderRadius: '99px', background: s.color, display: 'inline-block' } }),
            el('div.flex-1', null, [ el('div.fw-700', { text: s.tier }), el('div.text-mute.sm', { text: s.range }) ]),
            el('span.badge.badge-good', { text: s.rate }) ])
        ]) ]));
      });
    }
    paintTiers();
    page.appendChild(el('div.section-label.mt-0', { text: 'Commission Slab Tiers — tap to filter' }));
    page.appendChild(tierGrid);
    page.appendChild(el('div.section-label', { text: 'Agent Commission Ledger' }));
    page.appendChild(el('div.card', null, [ el('div.card-body', null, [ t.el ]) ]));

    // PAYOUT HISTORY — every commission actually paid, individually dated
    var payouts = S.list('tv_comm_paid').slice().sort(function (a, b) { return (a.date || '') < (b.date || '') ? 1 : -1; });
    if (payouts.length) {
      var pt = EPAL.table({
        columns: [
          { key: 'date', label: 'Paid on', date: true },
          { key: 'name', label: 'Agent', render: function (p) { return '<span class="strong">' + ui.escapeHtml(p.name) + '</span>'; } },
          { key: 'method', label: 'Method', badge: {} },
          { key: 'note', label: 'Note', render: function (p) { return ui.escapeHtml(p.note || '—'); } },
          { key: 'amount', label: 'Paid', num: true, money: true }
        ],
        rows: payouts, pageSize: 8, totalKey: 'amount', exportName: 'commission-payouts.csv', pdfTitle: 'Commission Payout History',
        empty: { icon: 'cash-coin', title: 'No payouts yet' }
      });
      page.appendChild(el('div.card', null, [ el('div.card-head', null, [ el('h3', { html: ui.icon('cash-coin') + ' Payout History' }), el('span.card-sub', { text: 'posted to the books (5350 Agent Commission)' }) ]), el('div.card-body', null, [ pt.el ]) ]));
    }
  }
  function receivedRatio(key) {
    var s = String(key), h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0xffff;
    return 0.5 + (h % 45) / 100;   // 0.50 – 0.94
  }
  function tierFor(sales) {
    if (sales >= 5000000) return 'Platinum';
    if (sales >= 2000000) return 'Gold';
    if (sales >= 500000) return 'Silver';
    return 'Bronze';
  }

  /* ---------------------------------------------------- shared helpers */
  function canCreate() { return !EPAL.perm || EPAL.perm.can('travels', 'vendor-agent', 'create'); }
  function canDelete() { return !EPAL.perm || EPAL.perm.can('travels', 'vendor-agent', 'delete'); }

  // The canonical action set for every party row (row-click opens the statement):
  // edit · delete │ print · WhatsApp · Gmail. `toMeta` kept for signature parity.
  function actionsFor(onEdit, onDelete, toMeta) {
    return ui.actions({
      edit:  onEdit,
      del:   canDelete() ? onDelete : null,
      print: function (r) { printParty(r); },
      wa:    function (r) { return { phone: r.phone, text: partyMsg(r) }; },
      gmail: function (r) { return { to: r.email, subject: 'Epal Travels & Consultancy', body: partyMsg(r) }; }
    });
  }
  function partyMsg(r) {
    var bal = ledgerBalance(r.name, r.balance);
    return 'Dear ' + r.name + ',\n\nYour current account balance with Epal Travels & Consultancy is ' + ui.money(bal) +
      '.\nPlease contact us for any queries.\n\nWarm regards,\nEpal Travels & Consultancy';
  }
  function printParty(r) {
    var bal = ledgerBalance(r.name, r.balance);
    function row(k, v) { return '<tr><td>' + k + '</td><td>' + ui.escapeHtml(String(v == null ? '—' : v)) + '</td></tr>'; }
    ui.printDoc({ title: 'Statement — ' + r.name, subtitle: (r.type || r.agency || 'Party') + ' · Epal Travels & Consultancy', meta: 'Party statement',
      bodyHtml: '<table>' + row('Name', r.name) + row('Contact', r.contact || r.phone) + row('Phone', r.phone) + row('Email', r.email) + row('Balance', ui.money(bal)) + '</table>' });
  }
  function removeRec(store, rec, done) {
    ui.confirm({ title: 'Delete "' + rec.name + '"?', danger: true, confirmLabel: 'Delete' }).then(function (ok) {
      if (!ok) return;
      db.remove(store, rec.id);
      ui.toast('Deleted', 'success');
      if (done) done();
    });
  }
  // Most recent ledger movement for a party (drives the "Last Activity" column).
  function lastActivityOf(name) {
    var list = txnsFor(name); if (!list.length) return null;
    var best = null;
    list.forEach(function (t) { var d = t.date || t.created; if (d && (!best || String(d) > String(best))) best = d; });
    return best;
  }
  function lastActivityTs(name) { var d = lastActivityOf(name); return d ? new Date(d).getTime() : 0; }
  function ledgerBalance(name, fallback) {
    var list = txnsFor(name);
    if (!list.length) return +fallback || 0;
    var b = 0; list.forEach(function (t) { b += (t.debit || 0) - (t.credit || 0); });
    return b;
  }

  function kpi(label, value, icon) {
    var n = frag('kpi');
    slot(n, 'label').textContent = label;
    slot(n, 'ico').innerHTML = '<i class="bi bi-' + icon + '"></i>';
    slot(n, 'value').textContent = String(value);
    return n;
  }
  function agBucket(label, value, total, color) {
    var pct = total ? Math.round(value / total * 100) : 0;
    return el('div.kpi-card', null, [
      el('div.kpi-top', null, [ el('span.kpi-label', { text: label }),
        el('span.badge', { text: pct + '%' }) ]),
      el('div.kpi-value', { style: { color: value > 0 ? color : 'inherit' }, text: ui.money(value) })
    ]);
  }
  function st2(l, v) { return el('div.stat', null, [ el('div.stat-label', { text: l }), el('div.stat-value', { text: v }) ]); }
  function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }
  function typeBadge(pt) {
    return '<span class="badge ' + (pt === 'agent' ? 'badge-good' : '') + '">' + cap(pt) + '</span>';
  }
  function typeBadgeNode(pt) { var b = el('span.badge' + (pt === 'agent' ? '.badge-good' : ''), { text: cap(pt) }); return b; }
  function kindBadge(kind) {
    var debit = DEBIT_KINDS.indexOf(kind) >= 0;
    return '<span class="badge ' + (debit ? 'badge-bad' : 'badge-good') + '">' + ui.escapeHtml(kind) + '</span>';
  }
  function safeSerial(prefix) {
    try { if (EPAL.serial && EPAL.serial.next) return EPAL.serial.next(prefix, { company: 'travels' }); } catch (e) {}
    return prefix + '/' + TODAY.getFullYear() + '/' + String(Date.now()).slice(-6);
  }

