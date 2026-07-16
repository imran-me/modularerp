/* ============================================================================
 * EPAL GROUP ERP  ·  views/shop/pos.js
 * ----------------------------------------------------------------------------
 * EPAL SHOP — Point of Sale terminal + Inventory control. TWO views live here:
 *
 *   shop/pos        A fast retail checkout: searchable product grid on the left,
 *                   a live cart on the right (qty +/-, remove, discount %, 7.5%
 *                   VAT, grand total). "Charge" opens a payment sheet (Cash /
 *                   bKash / Nagad / Card, amount tendered, change). CHECKOUT
 *                   guards every line against live stock, decrements product
 *                   stock, fires db.postSale('shop', …) so Shop + Group finance
 *                   and the ledger all move, appends to sh_orders, records any
 *                   unpaid balance as a customer due, and opens a branded
 *                   printable RECEIPT via EPAL.doc.open (serial via numberFor).
 *
 *   shop/inventory  Product master table (add / edit / delete) with a stock-value
 *                   KPI band, a category doughnut, a LOW-STOCK sub-view (stock at
 *                   or below reorder, flagged red, one-click restock) and a
 *                   supplier-dues + customer-dues summary. Sub-routes branch on
 *                   ctx.subId (overview / stock / low-stock / …) and pills.
 *
 * Products live in sh_products, orders in sh_orders, suppliers in sh_suppliers
 * (all seeded by core/seed-bd.js). Customer dues live in sh_dues (seeded here,
 * idempotently) and are mirrored into party_txns so the ledgers stay in sync.
 * Every mutation flows through EPAL.db so the Shop + Group dashboards react live.
 * ==========================================================================*/

(function (EPAL) {
  'use strict';
  var ui = EPAL.ui, el = ui.el, db = EPAL.db, S = EPAL.store;

  var VAT_RATE = 0.075;                    // Epal Shop VAT — 7.5%
  var PAY_METHODS = ['Cash', 'bKash', 'Nagad', 'Card'];
  var UNITS = ['pcs', 'box', 'kg', 'ltr', 'set', 'pack'];
  var DEFAULT_CATS = ['Electronics', 'Appliance', 'Mobile', 'Furniture', 'Footwear', 'Clothing', 'Grocery'];

  /* --- seed shop customer dues (idempotent; survives db.reset) -------------*/
  EPAL.registerEngine({ name: 'shop-pos-seed', seed: function () {
    S.seedOnce('sh_dues', seedDues());
  }});
  function seedDues() {
    return [
      { id: 'SD-1001', customer: 'Rahim Enterprise', phone: '+8801811001100', amount: 12500, orderRef: 'ORD-000112', date: '2026-06-28', status: 'Open', created: Date.now() },
      { id: 'SD-1002', customer: 'Nusrat Akter',     phone: '+8801711220033', amount: 3400,  orderRef: 'ORD-000131', date: '2026-07-01', status: 'Open', created: Date.now() },
      { id: 'SD-1003', customer: 'City Homes',       phone: '+8801922556677', amount: 21800, orderRef: 'ORD-000140', date: '2026-07-03', status: 'Open', created: Date.now() }
    ];
  }

  /* --- data accessors ------------------------------------------------------*/
  function products()  { return db.col('sh_products'); }
  function orders()    { return db.col('sh_orders'); }
  function suppliers() { return db.col('sh_suppliers'); }
  function dues()      { return S.list('sh_dues'); }
  function productById(id) { return products().filter(function (p) { return p.id === id; })[0] || null; }
  function categories() {
    var seen = {}, out = [];
    DEFAULT_CATS.forEach(function (c) { if (!seen[c]) { seen[c] = 1; out.push(c); } });
    products().forEach(function (p) { if (p.category && !seen[p.category]) { seen[p.category] = 1; out.push(p.category); } });
    return out;
  }
  function isActive(p) { return !p.status || String(p.status).toLowerCase() === 'active'; }
  function today() { return new Date().toISOString().slice(0, 10); }
  function me() { return (EPAL.auth && EPAL.auth.current && EPAL.auth.current()) || { name: 'Counter' }; }

  /* ==========================================================================
   * VIEW 1 — POINT OF SALE
   * ========================================================================*/
  EPAL.view('shop/pos', {
    render: function (ctx) {
      var page = el('div.page');
      page.appendChild(EPAL.pageHead({
        eyebrow: 'Epal Shop', icon: 'upc-scan', title: 'Point of Sale',
        sub: 'Fast retail checkout — pick products, charge and print a receipt.',
        actions: [
          el('a.btn.btn-ghost', { href: '#/shop/inventory', html: ui.icon('boxes') + ' Inventory' }),
          el('a.btn.btn-ghost', { href: '#/shop/inventory/low-stock', html: ui.icon('exclamation-triangle') + ' Low Stock' })
        ]
      }));

      // --- today KPIs -----------------------------------------------------
      var td = today();
      var todaySales = db.sales('shop').filter(function (s) { return s.date === td; });
      var todayAmt = todaySales.reduce(function (a, s) { return a + (s.amount || 0); }, 0);
      var lowCount = products().filter(function (p) { return (p.stock || 0) <= (p.reorder || 0); }).length;
      page.appendChild(el('div.kpi-grid.stagger', null, [
        kpi("Today's Sales", ui.money(todayAmt, { compact: true }), 'cash-coin'),
        kpi("Today's Orders", todaySales.length, 'bag-check'),
        kpi('Active Products', products().filter(isActive).length, 'box-seam'),
        kpi('Low Stock', lowCount, 'exclamation-triangle')
      ]));

      /* ---- terminal state ---- */
      var cart = [];

      /* ---- LEFT: product picker ---- */
      var left = el('div', { style: { flex: '1 1 58%', minWidth: '300px' } });
      var search = el('input.input', { placeholder: 'Search product, SKU or brand…',
        oninput: ui.debounce(function () { drawProducts(); }, 120) });
      var catSel = el('select.select', { onchange: drawProducts });
      catSel.appendChild(el('option', { value: '__all', text: 'All categories' }));
      categories().forEach(function (c) { catSel.appendChild(el('option', { value: c, text: c })); });
      var pickerCard = el('div.card', null, [
        el('div.card-body', null, [
          el('div.flex.gap-1.mb-3', { style: { flexWrap: 'wrap' } }, [
            el('div', { style: { flex: '1 1 220px' } }, [ search ]),
            el('div', { style: { flex: '0 0 190px' } }, [ catSel ])
          ]),
          (function () { var g = el('div', { style: { display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '10px' } }); grid = g; return g; })()
        ])
      ]);
      var grid;
      function drawProducts() {
        var q = (search.value || '').toLowerCase();
        var cat = catSel.value;
        var list = products().filter(function (p) {
          if (!isActive(p)) return false;
          if (cat && cat !== '__all' && p.category !== cat) return false;
          if (q && ((p.name || '') + ' ' + (p.sku || '') + ' ' + (p.brand || '')).toLowerCase().indexOf(q) < 0) return false;
          return true;
        });
        grid.innerHTML = '';
        if (!list.length) {
          grid.appendChild(el('div', { style: { gridColumn: '1 / -1' } }, [
            el('div.empty-state', null, [ ui.frag(ui.icon('search')),
              el('h3', { text: 'No products match' }), el('p.text-muted', { text: 'Try another search or category.' }) ]) ]));
          return;
        }
        list.forEach(function (p) { grid.appendChild(productCard(p)); });
      }
      function productCard(p) {
        var out = (p.stock || 0) <= 0;
        return el('div.row-click', { style: { border: '1px solid var(--border)', borderRadius: '12px',
            padding: '10px', cursor: out ? 'not-allowed' : 'pointer', background: 'var(--surface)',
            opacity: out ? 0.5 : 1, display: 'flex', flexDirection: 'column', gap: '5px', minHeight: '96px' },
            onclick: function () { if (out) { ui.toast(p.name + ' is out of stock', 'error'); return; } addToCart(p); } }, [
          el('div.strong.sm', { text: p.name, style: { lineHeight: '1.2' } }),
          el('div.text-mute.xs', { text: (p.brand || '—') + ' · ' + (p.category || '—') }),
          el('div.flex.items-center.justify-between', { style: { marginTop: 'auto' } }, [
            el('span.num.strong', { text: ui.money(p.salePrice) }),
            el('span.badge' + ((p.stock || 0) <= (p.reorder || 0) ? '.badge-warn' : '.badge-good'),
              { text: (p.stock || 0) + ' ' + (p.unit || 'pcs') })
          ])
        ]);
      }

      /* ---- RIGHT: cart ---- */
      var linesHost = el('div', { style: { minHeight: '120px', maxHeight: '360px', overflowY: 'auto' } });
      var subEl = el('span.num', { text: ui.money(0) });
      var discEl = el('span.num', { text: ui.money(0) });
      var vatEl = el('span.num', { text: ui.money(0) });
      var totEl = el('span.num.strong', { text: ui.money(0), style: { fontSize: '18px' } });
      var discountInput = el('input.input', { type: 'number', value: '0', min: '0', max: '100',
        style: { width: '84px', textAlign: 'right' }, oninput: recompute });
      var chargeBtn = el('button.btn.btn-primary.btn-lg', { style: { width: '100%' },
        html: ui.icon('credit-card') + ' Charge', onclick: charge });

      var right = el('div', { style: { flex: '1 1 330px', minWidth: '300px' } }, [
        el('div.card', null, [
          el('div.card-head', null, [
            el('h3', { html: ui.icon('cart3') + ' Current Sale' }),
            el('button.btn.btn-sm.btn-ghost', { html: ui.icon('trash') + ' Clear',
              onclick: function () { if (!cart.length) return;
                ui.confirm({ title: 'Clear the cart?', confirmLabel: 'Clear' }).then(function (ok) {
                  if (ok) { cart = []; renderCart(); } }); } })
          ]),
          el('div.card-body', null, [
            linesHost,
            el('div.divider'),
            totalsRow('Subtotal', subEl),
            el('div.flex.items-center.justify-between', { style: { padding: '6px 0' } }, [
              el('span.text-mute.sm', { text: 'Discount %' }),
              el('div.flex.items-center.gap-1', null, [ discountInput, discEl ])
            ]),
            totalsRow('VAT (7.5%)', vatEl),
            el('div.divider'),
            el('div.flex.items-center.justify-between', { style: { padding: '4px 0 12px' } }, [
              el('span.strong', { text: 'Grand Total' }), totEl ]),
            chargeBtn
          ])
        ])
      ]);

      function addToCart(p) {
        var line = cart.filter(function (l) { return l.id === p.id; })[0];
        if (line) {
          if (line.qty >= (p.stock || 0)) { ui.toast('Only ' + (p.stock || 0) + ' in stock', 'error'); return; }
          line.qty++;
        } else {
          cart.push({ id: p.id, name: p.name, salePrice: +p.salePrice || 0, costPrice: +p.costPrice || 0,
            qty: 1, stock: p.stock || 0, unit: p.unit || 'pcs' });
        }
        renderCart();
      }
      function renderCart() {
        linesHost.innerHTML = '';
        if (!cart.length) {
          linesHost.appendChild(el('div.empty-state', { style: { padding: '22px 8px' } }, [
            ui.frag(ui.icon('cart-x')), el('h3', { text: 'Cart is empty' }),
            el('p.text-muted', { text: 'Tap a product to add it.' }) ]));
        } else {
          cart.forEach(function (l) { linesHost.appendChild(cartLine(l)); });
        }
        recompute();
      }
      function cartLine(l) {
        return el('div', { style: { display: 'flex', alignItems: 'center', gap: '7px',
            padding: '8px 0', borderBottom: '1px solid var(--border)' } }, [
          el('div', { style: { flex: '1', minWidth: '0' } }, [
            el('div.sm.strong', { text: l.name, style: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }),
            el('div.text-mute.xs', { text: ui.money(l.salePrice) + ' each' })
          ]),
          qtyBtn('dash-lg', function () {
            if (l.qty > 1) { l.qty--; renderCart(); }
            else { cart = cart.filter(function (x) { return x.id !== l.id; }); renderCart(); } }),
          el('span.num', { text: String(l.qty), style: { minWidth: '22px', textAlign: 'center' } }),
          qtyBtn('plus-lg', function () {
            if (l.qty >= l.stock) { ui.toast('Only ' + l.stock + ' in stock', 'error'); return; }
            l.qty++; renderCart(); }),
          el('span.num.strong', { text: ui.money(l.salePrice * l.qty), style: { minWidth: '72px', textAlign: 'right' } }),
          el('button.icon-btn', { title: 'Remove', html: ui.icon('x-lg'),
            onclick: function () { cart = cart.filter(function (x) { return x.id !== l.id; }); renderCart(); } })
        ]);
      }
      function qtyBtn(icon, fn) {
        return el('button.btn.btn-sm.btn-outline', { html: ui.icon(icon),
          style: { padding: '2px 8px' }, onclick: fn });
      }
      function compute() {
        var sub = 0, cost = 0;
        cart.forEach(function (l) { sub += l.salePrice * l.qty; cost += l.costPrice * l.qty; });
        var dPct = Math.min(100, Math.max(0, +discountInput.value || 0));
        var discAmt = sub * dPct / 100;
        var taxable = sub - discAmt;
        var vat = taxable * VAT_RATE;
        return { sub: sub, cost: cost, dPct: dPct, discAmt: discAmt, vat: vat, grand: taxable + vat };
      }
      function recompute() {
        var t = compute();
        subEl.textContent = ui.money(t.sub);
        discEl.textContent = '- ' + ui.money(t.discAmt);
        vatEl.textContent = ui.money(t.vat);
        totEl.textContent = ui.money(t.grand);
        chargeBtn.innerHTML = ui.icon('credit-card') + ' Charge ' + (cart.length ? ui.money(t.grand) : '');
        chargeBtn.disabled = !cart.length;
        chargeBtn.style.opacity = cart.length ? 1 : 0.55;
      }

      /* ---- payment + checkout ---- */
      function charge() {
        if (!cart.length) { ui.toast('Cart is empty', 'error'); return; }
        var t = compute();
        var methodSel = el('select.select'); PAY_METHODS.forEach(function (mth) { methodSel.appendChild(el('option', { value: mth, text: mth })); });
        var custIn = el('input.input', { placeholder: 'Walk-in Customer' });
        var phoneIn = el('input.input', { type: 'tel', placeholder: 'Phone (optional)' });
        var tenderIn = el('input.input', { type: 'number', min: '0', value: String(Math.round(t.grand)) });
        var changeEl = el('div.strong', { style: { fontSize: '16px' } });
        function upd() {
          var tn = +tenderIn.value || 0, diff = tn - t.grand;
          if (diff >= 0) { changeEl.innerHTML = 'Change: <span class="text-good num">' + ui.money(diff) + '</span>'; }
          else { changeEl.innerHTML = 'Balance due: <span class="text-bad num">' + ui.money(-diff) + '</span>'; }
        }
        tenderIn.addEventListener('input', upd);
        upd();
        var body = el('div', null, [
          el('div.flex.justify-between.mb-3', { style: { alignItems: 'baseline' } }, [
            el('span.text-mute', { text: 'Amount payable' }),
            el('span.num.strong', { text: ui.money(t.grand), style: { fontSize: '20px' } })
          ]),
          el('div.form-grid', null, [
            field('Payment method', methodSel),
            field('Amount tendered', tenderIn),
            field('Customer name', custIn),
            field('Customer phone', phoneIn)
          ]),
          el('div.build-banner', { style: { marginTop: '10px' } }, [ ui.frag(ui.icon('calculator')), changeEl ])
        ]);
        ui.modal({ title: 'Take Payment', icon: 'credit-card-2-front', size: 'md', body: body,
          actions: [ { label: 'Cancel', variant: 'ghost' },
            { label: 'Complete Sale', variant: 'primary', icon: 'check-lg',
              onClick: function () { return checkout(t, methodSel.value, custIn.value, phoneIn.value, +tenderIn.value || 0); } } ] });
      }

      function checkout(t, method, customer, phone, tendered) {
        // 1) guard every line against live stock
        var bad = null;
        cart.forEach(function (l) { var p = productById(l.id); if (!p || l.qty > (p.stock || 0)) bad = l.name; });
        if (bad) { ui.toast('Not enough stock for ' + bad, 'error'); return false; }

        customer = (customer || '').trim() || 'Walk-in Customer';
        var td = today();
        var orderId = 'ORD-' + Date.now().toString().slice(-6);

        // 2) decrement stock
        cart.forEach(function (l) {
          var p = productById(l.id);
          p.stock = (p.stock || 0) - l.qty;
          db.save('sh_products', p);
        });

        // 3) revenue → finance + ledger (the cross-company artery)
        // A fully-tendered counter sale is CASH — book it to 1010, not a
        // receivable. Any shortfall is recorded as a customer due below (and
        // books to AR). Before this, every POS sale — even cash — posted as debt,
        // which is why 1000/1010 Cash had zero postings. (Bookkeeping audit fix 2.)
        var fullyPaid = (t.grand - tendered) <= 0.5;
        // vat: the 7.5% VAT inside grand — the ledger books it to 2130 VAT Payable,
        // not revenue. (Bookkeeping audit fix 6 — VAT was booked as income.)
        db.postSale('shop', { amount: t.grand, cost: t.cost, vat: t.vat, ref: orderId, desc: 'POS sale', customer: customer,
          paid: fullyPaid, payStatus: fullyPaid ? 'Paid' : (tendered > 0 ? 'Partial' : 'Due') });

        // 4) append to the shop order book
        var order = {
          id: orderId, customer: customer, phone: phone || '',
          items: cart.length, amount: t.grand, subtotal: t.sub, discount: t.discAmt,
          discountPct: t.dPct, vat: t.vat, cost: t.cost, channel: 'Counter', payMethod: method,
          tendered: tendered, change: Math.max(0, tendered - t.grand),
          status: 'Completed', date: td, created: Date.now(),
          lines: cart.map(function (l) { return { id: l.id, name: l.name, qty: l.qty, price: l.salePrice }; })
        };
        db.save('sh_orders', order);

        // 5) unpaid balance → customer due (sh_dues + party_txns subledger)
        var due = t.grand - tendered;
        if (due > 0.5) {
          order.payStatus = tendered > 0 ? 'Partial' : 'Due';
          var dueRec = { id: 'SD-' + Date.now().toString(36), customer: customer, phone: phone || '',
            amount: Math.round(due), orderRef: orderId, date: td, status: 'Open', created: Date.now() };
          db.save('sh_dues', dueRec);
          db.save('party_txns', { id: 'PT-' + Date.now().toString(36), party: customer, partyType: 'customer',
            companyId: 'shop', date: td, ref: orderId, desc: 'POS sale — unpaid balance', kind: 'Invoice',
            debit: Math.round(due), credit: 0, due: td, created: Date.now() });
          db.notify({ level: 'warning', title: 'Customer Due Recorded', text: customer + ' · ' + ui.money(due) + ' on ' + orderId,
            companyId: 'shop', icon: 'exclamation-triangle-fill' });
        } else {
          order.payStatus = 'Paid';
        }
        db.save('sh_orders', order);

        // 6) branded receipt
        openReceipt(order, t, method, customer, phone, tendered, due);

        // 7) reset terminal
        cart = [];
        discountInput.value = '0';
        renderCart();
        drawProducts();
        ui.toast('Sale ' + orderId + ' completed', 'success');
        return true;
      }

      function openReceipt(order, t, method, customer, phone, tendered, due) {
        if (!EPAL.doc || !EPAL.doc.open) { ui.toast('Receipt engine unavailable', 'error'); return; }
        var serial = EPAL.doc.numberFor ? EPAL.doc.numberFor('receipt') : order.id;
        var totals = [
          { label: 'Subtotal', value: ui.money(t.sub) },
          { label: 'Discount (' + t.dPct + '%)', value: '- ' + ui.money(t.discAmt) },
          { label: 'VAT (7.5%)', value: ui.money(t.vat) },
          { label: 'Grand Total', value: ui.money(t.grand), grand: true },
          { label: 'Tendered (' + method + ')', value: ui.money(tendered) },
          { label: due > 0.5 ? 'Balance Due' : 'Change', value: ui.money(due > 0.5 ? due : Math.max(0, tendered - t.grand)) }
        ];
        EPAL.doc.open({
          type: 'receipt', title: 'Sales Receipt', serial: serial, companyId: 'shop',
          badge: due > 0.5 ? 'DUE' : 'PAID', watermark: due > 0.5 ? 'DUE' : 'PAID',
          parties: [
            { label: 'Sold To', name: customer, lines: [ phone || 'Cash Customer' ] },
            { label: 'Outlet', name: 'Epal Shop', lines: [ 'Epal Group of Companies', 'Dhaka, Bangladesh', 'shop@epalgroup.com' ] }
          ],
          meta: [
            { label: 'Receipt No', value: serial }, { label: 'Order No', value: order.id },
            { label: 'Date', value: ui.date(order.date) }, { label: 'Cashier', value: me().name || 'Counter' },
            { label: 'Payment', value: method }
          ],
          columns: [ { key: 'name', label: 'Item' }, { key: 'qty', label: 'Qty', num: true },
            { key: 'rate', label: 'Rate', num: true }, { key: 'amount', label: 'Amount', num: true } ],
          rows: order.lines.map(function (l) {
            return { name: l.name, qty: String(l.qty), rate: ui.money(l.price), amount: ui.money(l.price * l.qty) };
          }),
          totals: totals,
          words: EPAL.doc.amountInWords ? EPAL.doc.amountInWords(Math.round(t.grand)) : '',
          terms: 'Goods sold are exchangeable within 7 days on production of this receipt. Prices include 7.5% VAT. Thank you for shopping at Epal Shop.',
          sign: 'Authorised Signature'
        });
      }

      /* mount terminal */
      page.appendChild(el('div.section-label', { text: 'Checkout Terminal' }));
      page.appendChild(el('div', { style: { display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'flex-start' } }, [
        left, right
      ]));
      left.appendChild(pickerCard);
      drawProducts();
      renderCart();

      ctx.mount.appendChild(page);
    }
  });

  /* ==========================================================================
   * VIEW 2 — INVENTORY
   * ========================================================================*/
  EPAL.view('shop/inventory', {
    render: function (ctx) {
      var sub = ctx.subId || 'overview';
      var isLow = sub === 'low-stock';
      var page = el('div.page');
      page.appendChild(EPAL.pageHead({
        eyebrow: 'Epal Shop › Inventory', icon: isLow ? 'exclamation-triangle-fill' : 'boxes',
        title: isLow ? 'Low Stock' : 'Inventory',
        sub: isLow ? 'Products at or below their reorder level — restock before they sell out.'
                   : 'Stock master, valuation, category mix and supplier / customer dues.',
        actions: [
          el('a.btn.btn-ghost', { href: '#/shop/pos', html: ui.icon('upc-scan') + ' Open POS' }),
          el('button.btn.btn-primary', { html: ui.icon('plus-lg') + ' New Product',
            onclick: function () { editProduct(null); } })
        ]
      }));

      page.appendChild(el('div.flex.gap-1.mb-3', { style: { flexWrap: 'wrap' } }, [
        pill('Overview', '#/shop/inventory', 'grid', !isLow),
        pill('Stock Master', '#/shop/inventory/stock', 'box-seam', sub === 'stock'),
        pill('Low Stock', '#/shop/inventory/low-stock', 'exclamation-triangle', isLow)
      ]));

      if (isLow) lowStock(page); else inventoryMain(page);
      ctx.mount.appendChild(page);
    }
  });

  function redraw() { EPAL.router.render(); }

  /* -------------------------------------------------- INVENTORY OVERVIEW */
  function inventoryMain(page) {
    var ps = products();
    var stockValue = ps.reduce(function (a, p) { return a + (p.stock || 0) * (p.costPrice || 0); }, 0);
    var retailValue = ps.reduce(function (a, p) { return a + (p.stock || 0) * (p.salePrice || 0); }, 0);
    var lowCount = ps.filter(function (p) { return (p.stock || 0) <= (p.reorder || 0); }).length;

    page.appendChild(el('div.kpi-grid.stagger', null, [
      kpi('Total SKUs', ps.length, 'box-seam'),
      kpi('Stock Value (cost)', ui.money(stockValue, { compact: true }), 'wallet2'),
      kpi('Retail Value', ui.money(retailValue, { compact: true }), 'cash-coin'),
      kpi('Low Stock', lowCount, 'exclamation-triangle')
    ]));

    // charts + dues
    var row = el('div.two-col');
    var chartCanvas = el('canvas', { id: ui.uid('c') });
    row.appendChild(el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon('pie-chart') + ' Stock Value by Category' }) ]),
      el('div.card-body', null, [ el('div', { style: { height: '260px', position: 'relative' } }, [ chartCanvas ]) ])
    ]));
    row.appendChild(duesPanel());
    page.appendChild(row);

    // product master table
    page.appendChild(el('div.section-label', { text: 'Stock Master' }));
    var canDelete = !EPAL.perm || EPAL.perm.can('shop', 'inventory', 'delete');
    var actions = [ { icon: 'pencil', title: 'Edit', onClick: function (r) { editProduct(r); } } ];
    if (canDelete) actions.push({ icon: 'trash', title: 'Delete', onClick: function (r) { deleteProduct(r); } });

    var table = EPAL.table({
      columns: [
        { key: 'name', label: 'Product', render: function (r) {
            return '<span class="strong">' + ui.escapeHtml(r.name) + '</span><div class="text-mute xs">' + ui.escapeHtml(r.sku || '') + '</div>'; } },
        { key: 'category', label: 'Category' },
        { key: 'brand', label: 'Brand' },
        { key: 'stock', label: 'Stock', num: true, render: function (r) {
            var low = (r.stock || 0) <= (r.reorder || 0);
            return '<span class="badge ' + (low ? 'badge-bad' : 'badge-good') + '">' + (r.stock || 0) + ' ' + ui.escapeHtml(r.unit || 'pcs') + '</span>'; } },
        { key: 'reorder', label: 'Reorder', num: true },
        { key: 'costPrice', label: 'Cost', num: true, money: true },
        { key: 'salePrice', label: 'Sale', num: true, money: true },
        { key: 'status', label: 'Status', badge: { Active: 'good', Inactive: '' } }
      ],
      rows: function () { return products(); },
      searchKeys: ['name', 'sku', 'brand', 'category'],
      filters: [ { key: 'category', label: 'Category' }, { key: 'status', label: 'Status' } ],
      exportName: 'shop-inventory.csv',
      onRow: function (r) { editProduct(r); },
      actions: actions,
      empty: { icon: 'box-seam', title: 'No products yet', hint: 'Add your first product to start selling.' }
    });
    page.appendChild(el('div.card', null, [ el('div.card-body', null, [ table.el ]) ]));

    // draw doughnut after mount
    var byCat = {};
    ps.forEach(function (p) { byCat[p.category || 'Other'] = (byCat[p.category || 'Other'] || 0) + (p.stock || 0) * (p.costPrice || 0); });
    var labels = Object.keys(byCat).sort(function (a, b) { return byCat[b] - byCat[a]; });
    requestAnimationFrame(function () {
      if (EPAL.charts && EPAL.charts.doughnut && labels.length) {
        EPAL.charts.doughnut(chartCanvas, { labels: labels, data: labels.map(function (c) { return byCat[c]; }), legend: 'right' });
      }
    });
  }

  /* -------------------------------------------------- DUES SUMMARY PANEL */
  function duesPanel() {
    var supDue = suppliers().filter(function (s) { return (s.balance || 0) > 0; })
      .sort(function (a, b) { return (b.balance || 0) - (a.balance || 0); });
    var supTotal = supDue.reduce(function (a, s) { return a + (s.balance || 0); }, 0);
    var custOpen = dues().filter(function (d) { return d.status !== 'Paid'; })
      .sort(function (a, b) { return (b.amount || 0) - (a.amount || 0); });
    var custTotal = custOpen.reduce(function (a, d) { return a + (d.amount || 0); }, 0);

    var card = el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon('cash-stack') + ' Outstanding Balances' }) ])
    ]);
    var body = el('div.card-body');
    card.appendChild(body);

    body.appendChild(el('div.flex.gap-1.mb-3', null, [
      miniStat('Supplier Payables', ui.money(supTotal, { compact: true }), 'text-bad'),
      miniStat('Customer Dues', ui.money(custTotal, { compact: true }), 'text-warn')
    ]));

    body.appendChild(el('div.section-label', { text: 'Supplier Payables' }));
    if (!supDue.length) body.appendChild(el('p.text-muted.sm', { text: 'No supplier balances outstanding.' }));
    supDue.slice(0, 5).forEach(function (s) {
      body.appendChild(el('div.data-row', null, [
        el('div.flex-1', null, [ el('div.sm.strong', { text: s.name }), el('div.text-mute.xs', { text: (s.terms || 'Cash') + ' · ' + (s.category || '') }) ]),
        el('span.num.text-bad', { text: ui.money(s.balance) })
      ]));
    });

    body.appendChild(el('div.section-label', { text: 'Customer Dues' }));
    if (!custOpen.length) body.appendChild(el('p.text-muted.sm', { text: 'No customer dues outstanding.' }));
    custOpen.slice(0, 6).forEach(function (d) {
      body.appendChild(el('div.data-row', null, [
        el('div.flex-1', null, [ el('div.sm.strong', { text: d.customer }), el('div.text-mute.xs', { text: (d.orderRef || '') + ' · ' + ui.date(d.date) }) ]),
        el('span.num.text-warn', { text: ui.money(d.amount) }),
        el('button.btn.btn-sm.btn-outline', { html: ui.icon('check2') + ' Settle',
          onclick: function () { settleDue(d); } })
      ]));
    });
    return card;
  }
  function settleDue(d) {
    ui.confirm({ title: 'Settle ' + d.customer + '?', text: 'Mark ' + ui.money(d.amount) + ' as received.', confirmLabel: 'Settle' })
      .then(function (ok) {
        if (!ok) return;
        d.status = 'Paid'; d.settledAt = Date.now();
        db.save('sh_dues', d);
        db.save('party_txns', { id: 'PT-' + Date.now().toString(36), party: d.customer, partyType: 'customer',
          companyId: 'shop', date: today(), ref: d.orderRef || '', desc: 'Due settlement', kind: 'Payment',
          debit: 0, credit: d.amount || 0, created: Date.now() });
        ui.toast('Due settled', 'success');
        redraw();
      });
  }

  /* -------------------------------------------------- LOW STOCK VIEW */
  function lowStock(page) {
    var low = products().filter(function (p) { return (p.stock || 0) <= (p.reorder || 0); })
      .sort(function (a, b) { return (a.stock || 0) - (b.stock || 0); });
    var atRisk = low.reduce(function (a, p) { return a + (p.reorder || 0) * (p.costPrice || 0); }, 0);
    var outCount = low.filter(function (p) { return (p.stock || 0) <= 0; }).length;

    page.appendChild(el('div.kpi-grid.stagger', null, [
      kpi('Low / Out Items', low.length, 'exclamation-triangle'),
      kpi('Out of Stock', outCount, 'x-octagon'),
      kpi('Reorder Value', ui.money(atRisk, { compact: true }), 'cart-plus')
    ]));

    var card = el('div.card');
    card.appendChild(el('div.card-head', null, [ el('h3', { html: ui.icon('exclamation-triangle-fill') + ' Reorder List' }) ]));
    if (!low.length) {
      card.appendChild(el('div.empty-state', null, [ ui.frag(ui.icon('check2-circle')),
        el('h3', { text: 'All stocked up' }), el('p.text-muted', { text: 'Every product is above its reorder level.' }) ]));
      page.appendChild(card);
      return;
    }
    var table = el('table.tbl');
    table.innerHTML = '<thead><tr><th>Product</th><th>Category</th><th class="num">In Stock</th><th class="num">Reorder At</th><th class="num">Cost</th><th></th></tr></thead>';
    var tb = el('tbody');
    low.forEach(function (p) {
      var out = (p.stock || 0) <= 0;
      var tr = el('tr', { style: { background: out ? 'rgba(240,80,110,0.14)' : 'rgba(244,183,64,0.10)' } }, [
        td('<span class="strong">' + ui.escapeHtml(p.name) + '</span><div class="text-mute xs">' + ui.escapeHtml(p.sku || '') + '</div>'),
        td(ui.escapeHtml(p.category || '—')),
        tdN('<span class="badge ' + (out ? 'badge-bad' : 'badge-warn') + '">' + (p.stock || 0) + ' ' + ui.escapeHtml(p.unit || 'pcs') + '</span>'),
        tdN(String(p.reorder || 0)),
        tdN(ui.money(p.costPrice)),
        td('')
      ]);
      var actTd = tr.lastChild;
      actTd.appendChild(el('button.btn.btn-sm.btn-primary', { html: ui.icon('cart-plus') + ' Restock',
        onclick: function () { restock(p); } }));
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    card.appendChild(el('div.table-wrap', null, [ table ]));
    page.appendChild(card);
  }
  function restock(p) {
    var suggested = Math.max((p.reorder || 0) * 3 - (p.stock || 0), (p.reorder || 5));
    EPAL.formModal({
      title: 'Restock · ' + p.name, icon: 'cart-plus', size: 'md',
      fields: [
        { key: 'qty', label: 'Quantity to add', type: 'number', required: true, min: 1, default: suggested,
          hint: 'Current stock: ' + (p.stock || 0) + ' ' + (p.unit || 'pcs') + ' · reorder at ' + (p.reorder || 0) },
        { key: 'supplier', label: 'Supplier', type: 'select',
          options: suppliers().map(function (s) { return s.name; }) }
      ],
      record: {},
      saveLabel: 'Add Stock',
      onSave: function (v) {
        var qty = +v.qty || 0;
        if (qty <= 0) { ui.toast('Enter a valid quantity', 'error'); return false; }
        p.stock = (p.stock || 0) + qty;
        db.save('sh_products', p);
        // book the purchase against the supplier balance (payable)
        var sup = suppliers().filter(function (s) { return s.name === v.supplier; })[0];
        if (sup) { sup.balance = (sup.balance || 0) + qty * (p.costPrice || 0); db.save('sh_suppliers', sup); }
        db.notify({ level: 'info', title: 'Stock Replenished', text: p.name + ' +' + qty + ' ' + (p.unit || 'pcs'),
          companyId: 'shop', icon: 'box-seam' });
        ui.toast('Added ' + qty + ' to ' + p.name, 'success');
        redraw();
        return true;
      }
    });
  }

  /* -------------------------------------------------- PRODUCT ADD / EDIT */
  function editProduct(p) {
    var isNew = !p;
    var cats = categories();
    EPAL.formModal({
      title: isNew ? 'New Product' : 'Edit Product', icon: 'box-seam', size: 'lg',
      fields: [
        { type: 'section', label: 'Product' },
        { key: 'name', label: 'Product name', required: true, col2: true },
        { key: 'sku', label: 'SKU / Barcode', required: true },
        { key: 'category', label: 'Category', type: 'select', options: cats, default: cats[0] },
        { key: 'brand', label: 'Brand' },
        { key: 'unit', label: 'Unit', type: 'select', options: UNITS, default: 'pcs' },
        { type: 'section', label: 'Pricing & Stock' },
        { key: 'costPrice', label: 'Cost price (৳)', type: 'money', required: true, min: 0 },
        { key: 'salePrice', label: 'Sale price (৳)', type: 'money', required: true, min: 0 },
        { key: 'stock', label: 'Stock quantity', type: 'number', min: 0, default: 0 },
        { key: 'reorder', label: 'Reorder level', type: 'number', min: 0, default: 5 },
        { key: 'status', label: 'Status', type: 'select', options: ['Active', 'Inactive'], default: 'Active' }
      ],
      record: p || {},
      saveLabel: isNew ? 'Create Product' : 'Save Changes',
      onSave: function (v) {
        if ((+v.salePrice || 0) < (+v.costPrice || 0)) {
          if (!confirmMargin()) { /* still allow; just warn */ }
        }
        var rec = p || {};
        rec.id = rec.id || 'PRD-' + Date.now().toString().slice(-6);
        rec.name = (v.name || '').trim();
        rec.sku = (v.sku || '').trim();
        rec.category = v.category; rec.brand = v.brand || '';
        rec.unit = v.unit || 'pcs';
        rec.costPrice = +v.costPrice || 0; rec.salePrice = +v.salePrice || 0;
        rec.stock = +v.stock || 0; rec.reorder = +v.reorder || 0;
        rec.status = v.status || 'Active';
        if (!rec.created) rec.created = today();
        db.save('sh_products', rec);
        ui.toast('Product ' + (isNew ? 'created' : 'saved'), 'success');
        redraw();
        return true;
      }
    });
  }
  function confirmMargin() { ui.toast('Note: sale price is below cost', 'warning'); return true; }
  function deleteProduct(p) {
    ui.confirm({ title: 'Delete ' + p.name + '?', danger: true, confirmLabel: 'Delete',
      text: 'This removes the product from the catalog. Stock history is unaffected.' })
      .then(function (ok) {
        if (!ok) return;
        db.remove('sh_products', p.id);
        ui.toast('Product deleted', 'success');
        redraw();
      });
  }

  /* -------------------------------------------------- shared helpers */
  function kpi(label, value, icon) {
    return el('div.kpi-card', null, [
      el('div.kpi-top', null, [ el('span.kpi-label', { text: label }),
        el('span.kpi-ico', { html: '<i class="bi bi-' + icon + '"></i>' }) ]),
      el('div.kpi-value', { text: String(value) })
    ]);
  }
  function totalsRow(label, valEl) {
    return el('div.flex.items-center.justify-between', { style: { padding: '5px 0' } }, [
      el('span.text-mute.sm', { text: label }), valEl ]);
  }
  function field(label, node) {
    return el('div.field', null, [ el('label', { text: label }), node ]);
  }
  function miniStat(label, value, tone) {
    return el('div', { style: { flex: '1', border: '1px solid var(--border)', borderRadius: '10px', padding: '10px 12px' } }, [
      el('div.text-mute.xs', { text: label }),
      el('div.num.strong' + (tone ? '.' + tone : ''), { text: value, style: { fontSize: '18px' } })
    ]);
  }
  function pill(label, href, icon, active) {
    return el('a.btn.btn-sm' + (active ? '.btn-primary' : '.btn-ghost'), { href: href, html: ui.icon(icon) + ' ' + label });
  }
  function td(html) { var t = el('td'); t.innerHTML = html; return t; }
  function tdN(html) { var t = el('td.num'); t.innerHTML = html; return t; }

})(window.EPAL = window.EPAL || {});
