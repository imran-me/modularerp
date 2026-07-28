/* ============================================================================
 * WOODART · PROCUREMENT · LOGIC
 * ----------------------------------------------------------------------------
 * BEHAVIOUR ONLY. Every container, card, KPI tile, banner and bar is real HTML
 * in frontend/template.html, handed to this file by tools/build/build-module.mjs
 * as TEMPLATE_HTML. This file is NOT an IIFE and declares no 'use strict' of its
 * own — the build wraps it.
 *
 * WHAT THIS FILE DOES, AND ONLY THIS: clone a screen block, fill its
 * [data-k]/[data-fill] slots, clone the [data-proto] row once per record,
 * remove the [data-when] blocks whose condition is false, wire the buttons,
 * draw the chart. It never builds a card, a head bar, a tab band or a KPI tile.
 *
 * WHERE THE DATA COMES FROM: frontend/api.js — the seam. This file never names
 * `wa_purchases` / `wa_vendors` and never names a URL. Grep it: neither is here.
 *
 * ==> LARAVEL MAPPING: orders = GET|POST /api/woodart/procurement/orders,
 *     vendors = GET|POST .../vendors, spend = GET .../spend.
 *     Full contract in backend/endpoints.md.
 * ==========================================================================*/

var ui = EPAL.ui, el = ui.el;

var CID = 'woodart';
var ROUTE = 'woodart/procurement';
var TODAY = '2026-07-05';          // the demo clock, same anchor as every module

/* ---- template plumbing — the whole bridge to the markup ------------------ */
var TPL = document.createElement('div');
TPL.innerHTML = TEMPLATE_HTML;

function screen(name) { return TPL.querySelector('[data-screen="' + name + '"]').cloneNode(true); }
function shell(name) { return TPL.querySelector('[data-shell="' + name + '"]').cloneNode(true); }
function fill(root, k) { return root.querySelector('[data-fill="' + k + '"]'); }
function fillK(root, k, v) { var n = root.querySelector('[data-k="' + k + '"]'); if (n) n.textContent = String(v); }
function slot(root, k) { return root.querySelector('[data-slot="' + k + '"]'); }
function mountScreen(page, s) { Array.prototype.slice.call(s.children).forEach(function (c) { page.appendChild(c); }); }

/** Keep or remove a [data-when] block. A screen's states are DECLARED in HTML
 *  and pruned here — never assembled on demand. */
function when(root, name, keep) {
  var n = root.querySelector('[data-when="' + name + '"]');
  if (!n) return null;
  if (!keep) { n.parentNode.removeChild(n); return null; }
  n.removeAttribute('data-when');
  return n;
}

/** Clone a hidden [data-proto] row — the sanctioned replacement for <template>
 *  cloning (MODULE-STANDARD §2.1). */
function proto(host, name) {
  var n = host.querySelector('[data-proto="' + name + '"]').cloneNode(true);
  n.removeAttribute('data-proto');
  n.removeAttribute('hidden');
  return n;
}
function dropProtos(host) {
  Array.prototype.forEach.call(host.querySelectorAll('[data-proto]'), function (p) { p.parentNode.removeChild(p); });
}

/* ---- shared chrome ------------------------------------------------------- */

var TAB_COPY = {
  orders:  ['Purchase Orders', 'Every order raised on a vendor — what is on its way and what is still owed.'],
  vendors: ['Vendors', 'Who Woodart buys board, laminate, hardware, finishes and fabric from.'],
  spend:   ['Spend', 'Where the procurement money goes — by category and by vendor.']
};

function head(sub) {
  var copy = TAB_COPY[sub] || TAB_COPY.orders;
  var h = shell('head');
  fill(h, 'eyebrow').textContent = sub === 'orders' ? 'Woodart Interiors' : 'Woodart › Procurement';
  fill(h, 'title').appendChild(document.createTextNode(copy[0]));
  var s = fill(h, 'sub');
  s.textContent = copy[1];
  s.setAttribute('title', copy[1]);
  // The button is IN the markup and is REMOVED without the permission — same
  // grammar as a [data-when] block, never built on demand. On the Vendors tab
  // it raises a vendor instead of an order, because that is what you came for.
  var add = h.querySelector('[data-act="new"]');
  if (!canCreate()) {
    add.parentNode.removeChild(add);
  } else if (sub === 'vendors') {
    add.innerHTML = '<i class="bi bi-plus-lg"></i> New Vendor';
    add.addEventListener('click', function () { editVendor(null); });
  } else {
    add.addEventListener('click', function () { editOrder(null); });
  }
  return h;
}

function tabs(sub) {
  var band = shell('tabs');
  Array.prototype.forEach.call(band.querySelectorAll('[data-tab]'), function (btn) {
    var key = btn.getAttribute('data-tab');
    if (key === sub) btn.classList.add('active');
    btn.removeAttribute('data-tab');
    btn.addEventListener('click', function () {
      EPAL.router.navigate(ROUTE + (key === 'orders' ? '' : '/' + key));
    });
  });
  return band;
}

/* ---- permissions + formatters -------------------------------------------- */
function canCreate() { return !EPAL.perm || EPAL.perm.can(CID, 'procurement', 'create'); }
function canDelete() { return !EPAL.perm || EPAL.perm.can(CID, 'procurement', 'delete'); }

function money(v) { return ui.money(v, { compact: true }); }

var STATUS_TONE = { Received: 'good', Partial: 'warn', Ordered: '' };

/* ============================================================================
 * THE VIEW — one registration, three screens, chosen by ctx.subId.
 * ==========================================================================*/
EPAL.view(ROUTE, {
  title: function () { return 'Procurement'; },
  render: function (ctx) {
    var sub = ctx.subId || 'orders';
    if (!TAB_COPY[sub]) sub = 'orders';

    var page = el('div.page');
    page.appendChild(head(sub));
    page.appendChild(tabs(sub));

    ({ orders: ordersScreen, vendors: vendorsScreen, spend: spendScreen }[sub])(page);

    ctx.mount.appendChild(page);
  }
});

/* =========================================================== SCREEN · ORDERS */
function ordersScreen(page) {
  var s = screen('orders');
  var sum = Procurement.summary();

  fillK(s, 'orders', ui.num(sum.orders));
  fillK(s, 'value', money(sum.value));
  fillK(s, 'received', money(sum.received));
  fillK(s, 'open', ui.num(sum.open));
  fillK(s, 'vendors', ui.num(sum.vendorsUsed));

  var banner = when(s, 'open', sum.open > 0);
  if (banner) {
    fillK(banner, 'openInline', ui.num(sum.open));
    fillK(banner, 'openValue', money(sum.outstanding));
  }

  fill(s, 'register').appendChild(EPAL.table({
    columns: [
      { key: 'id', label: 'PO', render: function (r) { return '<span class="strong">' + ui.escapeHtml(r.id) + '</span>'; } },
      { key: 'date', label: 'Raised', date: true },
      { key: 'supplier', label: 'Vendor',
        render: function (r) {
          // An order whose supplier has no vendor record is FLAGGED, not hidden —
          // it is money leaving the business against a name nobody owns.
          var v = Procurement.vendorOf(r);
          return ui.escapeHtml(r.supplier || '—') +
            (v ? '' : ' <span class="badge badge-warn">unlisted</span>');
        } },
      { key: 'items', label: 'Lines', num: true },
      { key: 'amount', label: 'Order Value', num: true, money: true },
      { key: 'status', label: 'Status', badge: STATUS_TONE },
      { key: 'outstanding', label: 'Outstanding', num: true,
        sortVal: function (r) { return Procurement.isOpen(r) ? (+r.amount || 0) : 0; },
        render: function (r) {
          if (!Procurement.isOpen(r)) return '<span class="text-mute">—</span>';
          return '<span class="num text-warn">' + ui.money(+r.amount || 0) + '</span>';
        } }
    ],
    rows: Procurement.orders(),
    searchKeys: ['id', 'supplier', 'status'],
    filters: [{ key: 'status', label: 'Status' }],
    onRow: function (r) { editOrder(Procurement.order(r.id)); },
    actions: canDelete() ? [{ icon: 'trash', title: 'Delete order', onClick: deleteOrder }] : null,
    exportName: 'woodart-purchase-orders.csv',
    pageSize: 12,
    empty: { icon: 'receipt', title: 'No purchase orders yet', hint: 'Raise the first order on a vendor.' }
  }).el);

  mountScreen(page, s);
}

/* ========================================================== SCREEN · VENDORS */
function vendorsScreen(page) {
  var s = screen('vendors');
  var sum = Procurement.summary();
  var rows = Procurement.spendByVendor();

  fillK(s, 'vendors', ui.num(sum.vendors));
  fillK(s, 'spend', money(sum.value));
  fillK(s, 'top', sum.top);
  fillK(s, 'idle', ui.num(sum.idle));

  fill(s, 'register').appendChild(EPAL.table({
    columns: [
      { key: 'id', label: 'Code', render: function (r) { return '<span class="strong">' + ui.escapeHtml(r.id) + '</span>'; } },
      { key: 'name', label: 'Vendor' },
      { key: 'category', label: 'Supplies', render: function (r) { return '<span class="badge">' + ui.escapeHtml(r.category || '—') + '</span>'; } },
      { key: 'contact', label: 'Contact' },
      { key: 'phone', label: 'Phone' },
      { key: 'terms', label: 'Terms' },
      { key: 'orders', label: 'Orders', num: true },
      { key: 'value', label: 'Spend', num: true, money: true },
      { key: 'outstanding', label: 'Outstanding', num: true,
        render: function (r) {
          if (!r.outstanding) return '<span class="text-mute">—</span>';
          return '<span class="num text-warn">' + ui.money(r.outstanding) + '</span>';
        } }
    ],
    rows: rows,
    searchKeys: ['id', 'name', 'category', 'contact', 'phone', 'area'],
    filters: [{ key: 'category', label: 'Supplies' }],
    onRow: function (r) { editVendor(Procurement.vendor(r.id)); },
    actions: canDelete() ? [{ icon: 'trash', title: 'Delete vendor', onClick: deleteVendor }] : null,
    exportName: 'woodart-vendors.csv',
    pageSize: 12,
    empty: { icon: 'shop', title: 'No vendors yet', hint: 'Add the suppliers Woodart buys from.' }
  }).el);

  mountScreen(page, s);
}

/* ============================================================ SCREEN · SPEND */
function spendScreen(page) {
  var s = screen('spend');
  var sum = Procurement.summary();
  var cats = Procurement.spendByCategory();
  var rows = Procurement.spendByVendor().filter(function (r) { return r.orders > 0; });

  fillK(s, 'spend', money(sum.value));
  fillK(s, 'avg', money(sum.avg));
  fillK(s, 'top', sum.topCategory);
  fillK(s, 'outstanding', money(sum.outstanding));

  when(s, 'none', sum.orders === 0);
  var body = when(s, 'some', sum.orders > 0);

  if (body) {
    // One cloned row per category — the count is data, so this is a proto clone.
    var host = fill(body, 'cats');
    var max = cats.length ? cats[0].value : 0;
    cats.forEach(function (c) {
      var row = proto(host, 'cat');
      slot(row, 'name').textContent = c.name + ' · ' + c.orders + ' order' + (c.orders === 1 ? '' : 's');
      slot(row, 'value').textContent = ui.money(c.value);
      slot(row, 'share').textContent = (sum.value ? Math.round(c.value / sum.value * 100) : 0) + '% of spend';
      // A computed width is a VALUE, not a utility — inline style is correct.
      slot(row, 'bar').style.width = (max ? Math.round(c.value / max * 100) : 0) + '%';
      host.appendChild(row);
    });
    dropProtos(host);

    fill(body, 'register').appendChild(EPAL.table({
      columns: [
        { key: 'name', label: 'Vendor', render: function (r) { return '<span class="strong">' + ui.escapeHtml(r.name) + '</span>'; } },
        { key: 'category', label: 'Supplies', render: function (r) { return '<span class="badge">' + ui.escapeHtml(r.category || '—') + '</span>'; } },
        { key: 'orders', label: 'Orders', num: true },
        { key: 'items', label: 'Lines', num: true },
        { key: 'value', label: 'Spend', num: true, money: true },
        { key: 'received', label: 'Received', num: true, money: true },
        { key: 'outstanding', label: 'Outstanding', num: true,
          render: function (r) {
            if (!r.outstanding) return '<span class="text-mute">—</span>';
            return '<span class="num text-warn">' + ui.money(r.outstanding) + '</span>';
          } },
        { key: 'last', label: 'Last Order', date: true }
      ],
      rows: rows,
      searchKeys: ['name', 'category'],
      exportName: 'woodart-spend-by-vendor.csv',
      pageSize: 12,
      empty: { icon: 'cart', title: 'No spend yet', hint: 'Raise an order on a vendor.' }
    }).el);

    var canvas = fill(body, 'chart');
    mountScreen(page, s);

    requestAnimationFrame(function () {
      if (!EPAL.charts || !cats.length || !canvas.isConnected) return;
      EPAL.charts.doughnut(canvas, {
        labels: cats.map(function (c) { return c.name; }),
        data: cats.map(function (c) { return c.value; })
      });
    });
    return;
  }

  mountScreen(page, s);
}

/* ====================================================== ADD / EDIT · ORDER == */
function editOrder(rec) {
  var isNew = !rec;
  if (isNew && !canCreate()) { ui.toast('You do not have permission to raise orders', 'error'); return; }

  var vendors = Procurement.vendorNames();

  EPAL.formModal({
    title: isNew ? 'New Purchase Order' : 'Edit · ' + rec.id,
    icon: 'receipt',
    size: 'md',
    record: rec || { id: Procurement.nextOrderId(), status: 'Ordered', date: TODAY, items: 1, amount: 0 },
    fields: [
      { key: 'id', label: 'PO Number', type: 'text', required: true, readonly: !isNew, col2: true,
        hint: isNew ? 'Auto-numbered in the WPO-000 series — change it if you use your own numbering.'
                    : 'The PO number is the record key and cannot change.' },
      { key: 'date', label: 'Raised On', type: 'date', required: true, col2: true },
      { key: 'supplier', label: 'Vendor', type: 'select', required: true, searchable: true, options: vendors,
        hint: 'Orders link to a vendor by NAME. A name with no vendor record still saves, but the register flags it as unlisted.' },
      { key: 'items', label: 'Line Count', type: 'number', required: true, min: 1, col2: true },
      { key: 'amount', label: 'Order Value', type: 'money', required: true, min: 0, col2: true },
      { key: 'status', label: 'Status', type: 'select', required: true, col2: true, options: Procurement.statuses(),
        hint: 'Anything other than Received counts as outstanding.' }
    ],
    saveLabel: isNew ? 'Raise Order' : 'Save Changes',
    onSave: function (v) {
      Procurement.saveOrder(v);
      ui.toast(isNew ? v.id + ' raised' : v.id + ' updated', 'success');
      EPAL.router.render();
      return true;
    }
  });
}

function deleteOrder(row) {
  ui.confirm({
    title: 'Delete ' + row.id + '?',
    body: 'The ' + ui.money(+row.amount || 0) + ' order on ' + (row.supplier || 'this vendor') +
      ' will be removed from the register. This cannot be undone.',
    confirmLabel: 'Delete'
  }).then(function (ok) {
    if (!ok) return;
    Procurement.removeOrder(row.id);
    ui.toast(row.id + ' deleted', 'success');
    EPAL.router.render();
  });
}

/* ===================================================== ADD / EDIT · VENDOR == */
function editVendor(rec) {
  var isNew = !rec;
  if (isNew && !canCreate()) { ui.toast('You do not have permission to add vendors', 'error'); return; }

  EPAL.formModal({
    title: isNew ? 'New Vendor' : 'Edit · ' + rec.name,
    icon: 'shop',
    size: 'md',
    record: rec || { id: Procurement.nextVendorId(), category: 'General', terms: 'Net 30' },
    fields: [
      { key: 'id', label: 'Code', type: 'text', required: true, readonly: !isNew, col2: true,
        hint: isNew ? 'Auto-numbered in the VEN-000 series.' : 'The code is the record key and cannot change.' },
      { key: 'category', label: 'Supplies', type: 'select', required: true, col2: true, options: Procurement.categories() },
      { key: 'name', label: 'Vendor Name', type: 'text', required: true,
        hint: 'Purchase orders link to a vendor by NAME, so keep this exactly as it appears on their orders.' },
      { key: 'contact', label: 'Contact Person', type: 'text', col2: true },
      { key: 'phone', label: 'Phone', type: 'phone', col2: true },
      { key: 'email', label: 'Email', type: 'email', col2: true },
      { key: 'area', label: 'Area', type: 'text', col2: true },
      { key: 'terms', label: 'Payment Terms', type: 'select', col2: true, options: Procurement.terms() },
      { key: 'since', label: 'Vendor Since', type: 'date', col2: true }
    ],
    saveLabel: isNew ? 'Add Vendor' : 'Save Changes',
    onSave: function (v) {
      Procurement.saveVendor(v);
      ui.toast(isNew ? v.name + ' added' : v.name + ' updated', 'success');
      EPAL.router.render();
      return true;
    }
  });
}

function deleteVendor(row) {
  var spend = Procurement.withSpend(row);
  ui.confirm({
    title: 'Delete ' + row.id + '?',
    body: row.name + ' will be removed from the vendor directory.' +
      (spend.orders
        ? ' They still have ' + spend.orders + ' order(s) worth ' + ui.money(spend.value) +
          ' on record — those are NOT deleted, but they will show as "unlisted" in the register.'
        : ' They have no orders on record.') +
      ' This cannot be undone.',
    confirmLabel: 'Delete'
  }).then(function (ok) {
    if (!ok) return;
    Procurement.removeVendor(row.id);
    ui.toast(row.id + ' deleted', 'success');
    EPAL.router.render();
  });
}
