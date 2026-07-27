/* ============================================================================
 * WOODART · MATERIALS · LOGIC
 * ----------------------------------------------------------------------------
 * BEHAVIOUR ONLY. Every container, card, KPI tile, banner and bar on this screen
 * is real HTML in frontend/template.html — handed to this file by
 * tools/build/build-module.mjs as the string TEMPLATE_HTML. This file is NOT an
 * IIFE and declares no 'use strict' of its own: the build wraps it.
 *
 * WHAT THIS FILE DOES, AND ONLY THIS:
 *   1. clones a screen / shell block out of the markup
 *   2. writes live values into its [data-k] and [data-fill] slots
 *   3. clones the [data-proto] row once per record (the count is data)
 *   4. removes the [data-when] blocks whose condition is false
 *   5. wires the [data-act] / [data-tab] buttons
 *   6. draws the chart and opens the add/edit modal
 * It never builds a card, a head bar, a tab band or a KPI tile.
 *
 * WHERE THE DATA COMES FROM: frontend/api.js — the seam. This file never names
 * the store key `wa_materials` and never names a URL. Search it: you will not
 * find either. That is what makes the Laravel switch a one-file change.
 *
 * ==> LARAVEL MAPPING: the three tabs are three reads of one endpoint
 *     (GET /api/woodart/materials/stock); the modal is POST; the row delete is
 *     DELETE. Full contract in backend/endpoints.md.
 * ==========================================================================*/

var ui = EPAL.ui, el = ui.el;

var CID = 'woodart';
var ROUTE = 'woodart/materials';

/* ---- template plumbing ----------------------------------------------------
 * The markup IS the screen; these five helpers are the whole bridge to it.
 * mountScreen moves the section's element children onto the page so the shipped
 * DOM carries no wrapper <section> and no stray whitespace text nodes. */
var TPL = document.createElement('div');
TPL.innerHTML = TEMPLATE_HTML;

function screen(name) { return TPL.querySelector('[data-screen="' + name + '"]').cloneNode(true); }
function shell(name) { return TPL.querySelector('[data-shell="' + name + '"]').cloneNode(true); }
function fill(root, k) { return root.querySelector('[data-fill="' + k + '"]'); }
function fillK(root, k, v) { var n = root.querySelector('[data-k="' + k + '"]'); if (n) n.textContent = String(v); }
function slot(root, k) { return root.querySelector('[data-slot="' + k + '"]'); }
function mountScreen(page, s) { Array.prototype.slice.call(s.children).forEach(function (c) { page.appendChild(c); }); }

/** Remove a [data-when] block, or keep it and strip the hook. One call per
 *  conditional block, so a screen's states are declared in HTML, not assembled. */
function when(root, name, keep) {
  var n = root.querySelector('[data-when="' + name + '"]');
  if (!n) return null;
  if (!keep) { n.parentNode.removeChild(n); return null; }
  n.removeAttribute('data-when');
  return n;
}

/** Clone a hidden [data-proto] row. The prototype stays in the markup and is
 *  removed once the real rows are in — this is the sanctioned replacement for
 *  <template> cloning (MODULE-STANDARD §2.1). */
function proto(host, name) {
  var p = host.querySelector('[data-proto="' + name + '"]');
  var n = p.cloneNode(true);
  n.removeAttribute('data-proto');
  n.removeAttribute('hidden');
  return n;
}
function dropProtos(host) {
  Array.prototype.forEach.call(host.querySelectorAll('[data-proto]'), function (p) { p.parentNode.removeChild(p); });
}

/* ---- shared chrome -------------------------------------------------------- */

var TAB_COPY = {
  stock:     ['Stock', 'Wood, laminates, hardware and finishes — live quantities and what each is worth.'],
  movements: ['Movements', 'The stock ledger — every receipt, issue, adjustment and wastage, and where it sits.'],
  reorder:   ['Reorder', 'Everything at or below its reorder level, with the refill quantity and cost.'],
  valuation: ['Valuation', 'Where the money is sitting — stock value by category and by item.']
};

/** The page-head bar, cloned from markup. Mirrors EPAL.pageHead exactly: the
 *  title is a TEXT NODE appended after the icon, and the sub carries title= so
 *  the pinned one-line head still reveals a long sentence on hover. */
function head(sub) {
  var copy = TAB_COPY[sub] || TAB_COPY.stock;
  var h = shell('head');
  fill(h, 'eyebrow').textContent = 'Woodart › Materials';
  fill(h, 'title').appendChild(document.createTextNode(copy[0]));
  var s = fill(h, 'sub');
  s.textContent = copy[1];
  s.setAttribute('title', copy[1]);
  // The New Material button is in the markup and is REMOVED without the
  // permission — the same grammar as a [data-when] block, never built on demand.
  var add = h.querySelector('[data-act="new"]');
  if (!canCreate()) {
    add.parentNode.removeChild(add);
  } else if (sub === 'movements') {
    // On the ledger, the thing you came to do is move stock, not define a material.
    add.innerHTML = '<i class="bi bi-box-arrow-in-down"></i> Receive Stock';
    add.addEventListener('click', function () { moveStock(null, 'Receipt'); });
  } else {
    add.addEventListener('click', function () { editMaterial(null); });
  }
  return h;
}

/** The 3-tab band. Marks the active tab, wires navigation, then STRIPS the
 *  data-tab hooks so they never reach the shipped DOM. */
function tabs(sub) {
  var band = shell('tabs');
  Array.prototype.forEach.call(band.querySelectorAll('[data-tab]'), function (btn) {
    var key = btn.getAttribute('data-tab');
    if (key === sub) btn.classList.add('active');
    btn.removeAttribute('data-tab');
    btn.addEventListener('click', function () {
      EPAL.router.navigate(ROUTE + (key === 'stock' ? '' : '/' + key));
    });
  });
  return band;
}

/* ---- permissions ---------------------------------------------------------- */
function canCreate() { return !EPAL.perm || EPAL.perm.can(CID, 'materials', 'create'); }
function canDelete() { return !EPAL.perm || EPAL.perm.can(CID, 'materials', 'delete'); }

/* ---- small formatters shared by the three screens ------------------------- */
function money(v) { return ui.money(v, { compact: true }); }

/* Movement vocabulary — one place, so the ledger, the grid and the buttons
   never disagree about what a kind looks like. */
var KIND_TONE = { Receipt: 'good', Issue: '', Adjustment: 'warn', Wastage: 'bad' };
var KIND_ICON = { Receipt: 'box-arrow-in-down', Issue: 'box-arrow-up',
                  Adjustment: 'sliders', Wastage: 'trash3' };
function stockCell(m) {
  var low = Materials.isLow(m);
  return '<span class="num ' + (low ? 'text-bad' : '') + '">' + ui.num(+m.stock || 0) + '</span>' +
    ' <span class="text-mute xs">' + ui.escapeHtml(m.unit || '') + '</span>';
}

/* ============================================================================
 * THE VIEW — one registration, three screens, chosen by ctx.subId.
 * ==========================================================================*/
EPAL.view(ROUTE, {
  title: function () { return 'Materials'; },
  render: function (ctx) {
    var sub = ctx.subId || 'stock';
    if (!TAB_COPY[sub]) sub = 'stock';

    var page = el('div.page');
    page.appendChild(head(sub));
    page.appendChild(tabs(sub));

    ({ stock: stockScreen, movements: movementsScreen,
       reorder: reorderScreen, valuation: valuationScreen }[sub])(page);

    ctx.mount.appendChild(page);
  }
});

/* ============================================================ SCREEN · STOCK */
function stockScreen(page) {
  var s = screen('stock');
  var sum = Materials.summary();

  fillK(s, 'items', ui.num(sum.items));
  fillK(s, 'value', money(sum.value));
  fillK(s, 'low', ui.num(sum.low));
  fillK(s, 'cats', ui.num(sum.categories));
  fillK(s, 'suppliers', ui.num(sum.suppliers));

  // The low-stock banner is HTML that gets REMOVED when nothing is low.
  var banner = when(s, 'low', sum.low > 0);
  if (banner) {
    fillK(banner, 'lowInline', ui.num(sum.low));
    banner.querySelector('[data-act="goReorder"]')
      .addEventListener('click', function () { EPAL.router.navigate(ROUTE + '/reorder'); });
  }

  fill(s, 'register').appendChild(registerTable(Materials.all()).el);
  mountScreen(page, s);
}

/** The material register data grid. A grid is one of the five places JS is
 *  allowed to make DOM — its row count is data, not layout. */
function registerTable(rows) {
  return EPAL.table({
    columns: [
      { key: 'id', label: 'Code', render: function (r) { return '<span class="strong">' + ui.escapeHtml(r.id) + '</span>'; } },
      { key: 'name', label: 'Material' },
      { key: 'category', label: 'Category', render: function (r) { return '<span class="badge">' + ui.escapeHtml(r.category || '—') + '</span>'; } },
      { key: 'stock', label: 'In Stock', num: true, render: stockCell },
      { key: 'reorder', label: 'Reorder At', num: true },
      { key: 'unitCost', label: 'Unit Cost', num: true, money: true },
      { key: 'value', label: 'Stock Value', num: true,
        sortVal: function (r) { return Materials.valueOf(r); },
        render: function (r) { return '<span class="num strong">' + ui.money(Materials.valueOf(r)) + '</span>'; } },
      { key: 'supplier', label: 'Supplier' }
    ],
    rows: rows,
    searchKeys: ['id', 'name', 'category', 'supplier'],
    filters: [{ key: 'category', label: 'Category' }],
    onRow: function (r) { editMaterial(Materials.find(r.id)); },
    actions: stockRowActions(),
    exportName: 'woodart-materials.csv',
    pageSize: 12,
    empty: { icon: 'boxes', title: 'No materials yet', hint: 'Add your first item to start tracking stock.' }
  });
}

/** The per-row actions on the register. Moving stock lives HERE, next to the
 *  material it moves, rather than behind a separate desk — and every one of
 *  them goes through Materials.apply(), so the ledger is never bypassed. */
function stockRowActions() {
  var acts = [];
  if (canCreate()) {
    acts.push({ icon: 'box-arrow-in-down', title: 'Receive stock',
      onClick: function (r) { moveStock(Materials.find(r.id), 'Receipt'); } });
    acts.push({ icon: 'box-arrow-up', title: 'Issue to a project',
      onClick: function (r) { moveStock(Materials.find(r.id), 'Issue'); } });
    acts.push({ icon: 'clock-history', title: 'Movement history',
      onClick: function (r) { showHistory(Materials.find(r.id)); } });
  }
  if (canDelete()) {
    acts.push({ icon: 'trash', title: 'Delete material', onClick: deleteMaterial });
  }
  return acts.length ? acts : null;
}

/** One material's ledger + where it sits — the answer to "why is it only 26?". */
function showHistory(m) {
  if (!m) return;
  var rows = Materials.historyOf(m.id);
  var body = el('div');

  body.appendChild(el('div.stat-row.mb-2', null, [
    st2('In stock', ui.num(m.stock) + ' ' + (m.unit || '')),
    st2('Movements', String(rows.length)),
    st2('Value', ui.money(Materials.valueOf(m)))
  ]));

  var byLoc = Materials.byLocation(m.id);
  if (byLoc.length) {
    body.appendChild(el('div.section-label', { text: 'Where it sits' }));
    var ll = el('div.data-list');
    byLoc.forEach(function (l) {
      ll.appendChild(el('div.data-row', null, [
        el('span.flex-1', { text: l.name }),
        el('span.num' + (l.qty < 0 ? '.text-bad' : ''), { text: ui.num(l.qty) })
      ]));
    });
    body.appendChild(ll);
  }

  body.appendChild(el('div.section-label', { text: 'Ledger' }));
  if (!rows.length) {
    body.appendChild(el('p.text-mute.sm', { text: 'No movements recorded yet.' }));
  } else {
    var list = el('div.data-list');
    rows.forEach(function (v) {
      var q = +v.qty || 0;
      list.appendChild(el('div.data-row', null, [
        el('span.badge' + (KIND_TONE[v.kind] ? '.badge-' + KIND_TONE[v.kind] : ''), { text: v.kind }),
        el('div.flex-1', null, [
          el('div.fw-600', { text: (q >= 0 ? '+' : '') + ui.num(q) + ' · ' + Materials.locationName(v.location) }),
          el('div.text-mute.xs', { text: (v.ref ? v.ref + ' · ' : '') + (v.note || '') + (v.by ? ' — ' + v.by : '') })
        ]),
        el('span.text-mute.xs', { text: v.date ? ui.date(v.date) : '' })
      ]));
    });
    body.appendChild(list);
  }

  ui.modal({ title: m.name + ' · stock ledger', icon: 'clock-history', size: 'lg', body: body, footer: false });
}

function st2(k, v) {
  return el('div.stat', null, [ el('div.stat-label', { text: k }), el('div.stat-value', { text: String(v) }) ]);
}

/** Delete always asks first, and always names what is being removed — a stock
 *  line is a real asset, and there is no undo. */
function deleteMaterial(row) {
  ui.confirm({
    title: 'Delete ' + row.id + '?',
    body: row.name + ' (' + ui.num(+row.stock || 0) + ' ' + (row.unit || 'units') + ', worth ' +
      ui.money(Materials.valueOf(row)) + ') will be removed from the register, along with its ' +
      Materials.historyOf(row.id).length + ' movement record(s) — a ledger for a material nobody ' +
      'can look at is orphaned evidence. This cannot be undone.',
    confirmLabel: 'Delete'
  }).then(function (ok) {
    if (!ok) return;
    Materials.remove(row.id);
    ui.toast(row.id + ' deleted', 'success');
    EPAL.router.render();
  });
}

/* ======================================================== SCREEN · MOVEMENTS */
function movementsScreen(page) {
  var s = screen('movements');
  var sum = Materials.movementSummary();
  var locs = Materials.locationTotals();
  var drift = Materials.reconcile();

  fillK(s, 'movements', ui.num(sum.movements));
  fillK(s, 'received', ui.num(sum.received));
  fillK(s, 'issued', ui.num(sum.issued));
  fillK(s, 'wasted', ui.num(sum.wasted));
  fillK(s, 'locations', ui.num(sum.locations));

  // The drift banner is the invariant made visible. Healthy = removed.
  var banner = when(s, 'drift', drift.length > 0);
  if (banner) {
    fillK(banner, 'driftInline', ui.num(drift.length));
    banner.querySelector('[data-act="showDrift"]')
      .addEventListener('click', function () { showDrift(drift); });
  }

  // one cloned row per location — the count is data
  var host = fill(s, 'locations');
  var max = locs.reduce(function (t, l) { return Math.max(t, l.value); }, 0);
  locs.forEach(function (l) {
    var row = proto(host, 'loc');
    slot(row, 'name').textContent = l.name + ' · ' + l.kind;
    slot(row, 'value').textContent = ui.money(l.value);
    slot(row, 'detail').textContent = ui.num(l.qty) + ' units' + (l.area ? ' · ' + l.area : '');
    slot(row, 'bar').style.width = (max ? Math.round(l.value / max * 100) : 0) + '%';
    host.appendChild(row);
  });
  dropProtos(host);

  fill(s, 'register').appendChild(EPAL.table({
    columns: [
      { key: 'date', label: 'Date', date: true },
      { key: 'id', label: 'Ref', render: function (r) { return '<span class="strong">' + ui.escapeHtml(r.id) + '</span>'; } },
      { key: 'material', label: 'Material',
        render: function (r) {
          var m = Materials.find(r.material);
          return m ? ui.escapeHtml(m.name) + ' <span class="text-mute xs">' + ui.escapeHtml(r.material) + '</span>'
                   : ui.escapeHtml(r.material) + ' <span class="badge badge-warn">removed</span>';
        } },
      { key: 'kind', label: 'Kind', badge: KIND_TONE },
      { key: 'qty', label: 'Qty', num: true,
        render: function (r) {
          var q = +r.qty || 0;
          return '<span class="num ' + (q >= 0 ? 'text-good' : 'text-bad') + '">' +
            (q >= 0 ? '+' : '') + ui.num(q) + '</span>';
        } },
      { key: 'location', label: 'Location', render: function (r) { return '<span class="badge">' + ui.escapeHtml(Materials.locationName(r.location)) + '</span>'; } },
      { key: 'ref', label: 'Against' },
      { key: 'by', label: 'By' }
    ],
    rows: Materials.movements(),
    searchKeys: ['id', 'material', 'kind', 'ref', 'by', 'note'],
    filters: [{ key: 'kind', label: 'Kind' }],
    exportName: 'woodart-stock-movements.csv',
    pageSize: 14,
    empty: { icon: 'arrow-left-right', title: 'No movements yet', hint: 'Receive stock in to start the ledger.' }
  }).el);

  var canvas = fill(s, 'chart');
  mountScreen(page, s);

  requestAnimationFrame(function () {
    var mix = [['Received', sum.received], ['Issued', sum.issued], ['Wastage', sum.wasted]]
      .filter(function (r) { return r[1] > 0; });
    if (!EPAL.charts || !mix.length || !canvas.isConnected) return;
    EPAL.charts.doughnut(canvas, {
      labels: mix.map(function (r) { return r[0]; }),
      data: mix.map(function (r) { return r[1]; })
    });
  });
}

/** The invariant, spelled out. Only ever opened from the drift banner, which
 *  in a healthy system is not on the page at all. */
function showDrift(rows) {
  var body = el('div');
  body.appendChild(el('p.text-mute.sm', { text:
    'These stored stock levels do not equal the sum of their movements. Until the ' +
    'difference is explained by an adjustment, the number on the register cannot be trusted.' }));
  var list = el('div.data-list');
  rows.forEach(function (r) {
    list.appendChild(el('div.data-row', null, [
      el('div.flex-1', null, [
        el('div.fw-600', { text: r.name }),
        el('div.text-mute.xs', { text: r.id })
      ]),
      el('div', { style: { textAlign: 'right' } }, [
        el('div.num', { text: 'stored ' + ui.num(r.stock) + ' · ledger ' + ui.num(r.moved) }),
        el('div.num.text-bad.xs', { text: 'drift ' + (r.drift > 0 ? '+' : '') + ui.num(r.drift) })
      ])
    ]));
  });
  body.appendChild(list);
  ui.modal({ title: 'Stock that does not reconcile', icon: 'exclamation-octagon', size: 'md', body: body, footer: false });
}

/** Move stock — the ONLY path, and it always writes a row. */
function moveStock(material, kind) {
  if (!canCreate()) { ui.toast('You do not have permission to move stock', 'error'); return; }
  var m = material || null;

  EPAL.formModal({
    title: kind + (m ? ' · ' + m.name : ''),
    icon: KIND_ICON[kind] || 'arrow-left-right',
    size: 'sm',
    record: { material: m ? m.id : null, kind: kind, qty: null,
      location: Materials.defaultLocation(), date: Materials.today ? Materials.today() : undefined },
    fields: [
      { key: 'material', label: 'Material', type: 'select', required: true, searchable: true,
        options: Materials.all().map(function (x) { return [x.id, x.name + ' · ' + ui.num(x.stock) + ' ' + (x.unit || '')]; }) },
      { key: 'qty', label: kind === 'Adjustment' ? 'Adjust by (+/-)' : 'Quantity', type: 'number', required: true,
        hint: kind === 'Receipt' ? 'Adds to stock.'
            : kind === 'Adjustment' ? 'A count correction. Negative reduces, positive increases.'
            : 'Comes out of stock — enter a positive number.' },
      { key: 'location', label: 'Location', type: 'select', required: true, options: Materials.locationOptions() },
      { key: 'ref', label: 'Against', type: 'text', col2: true,
        hint: kind === 'Issue' ? 'The project or job this went to, e.g. WAP-102.' : 'Optional reference.' },
      { key: 'by', label: 'Recorded by', type: 'text', col2: true },
      { key: 'note', label: 'Note', type: 'text' }
    ],
    saveLabel: kind,
    onSave: function (v) {
      var row = Materials.apply({
        material: v.material, kind: kind, qty: v.qty, location: v.location,
        ref: v.ref, note: v.note, by: v.by || 'Staff'
      });
      if (!row) { ui.toast('Nothing to move', 'error'); return true; }
      var mm = Materials.find(v.material);
      ui.toast(kind + ' ' + ui.num(Math.abs(row.qty)) + ' · ' + mm.name + ' now ' + ui.num(mm.stock), 'success');
      EPAL.router.render();
      return true;
    }
  });
}

/* ========================================================== SCREEN · REORDER */
function reorderScreen(page) {
  var s = screen('reorder');
  var low = Materials.belowReorder();

  var short = low.reduce(function (t, r) { return t + r.short; }, 0);
  var cost = low.reduce(function (t, r) { return t + r.refill; }, 0);
  var sups = {};
  low.forEach(function (r) { if (r.rec.supplier) sups[r.rec.supplier] = 1; });

  fillK(s, 'count', ui.num(low.length));
  fillK(s, 'short', ui.num(short));
  fillK(s, 'cost', money(cost));
  fillK(s, 'suppliers', ui.num(Object.keys(sups).length));

  // Two states, both authored in HTML. Exactly one survives.
  when(s, 'clear', low.length === 0);
  var body = when(s, 'short', low.length > 0);

  if (body) {
    var rows = low.map(function (r) {
      return { id: r.rec.id, name: r.rec.name, category: r.rec.category, unit: r.rec.unit,
        stock: r.rec.stock, reorder: r.rec.reorder, short: r.short,
        unitCost: r.rec.unitCost, refill: r.refill, supplier: r.rec.supplier };
    });
    fill(body, 'register').appendChild(EPAL.table({
      columns: [
        { key: 'id', label: 'Code', render: function (r) { return '<span class="strong">' + ui.escapeHtml(r.id) + '</span>'; } },
        { key: 'name', label: 'Material' },
        { key: 'stock', label: 'In Stock', num: true, render: stockCell },
        { key: 'reorder', label: 'Reorder At', num: true },
        { key: 'short', label: 'Refill Qty', num: true,
          render: function (r) { return '<span class="num strong text-warn">' + ui.num(r.short) + '</span>'; } },
        { key: 'unitCost', label: 'Unit Cost', num: true, money: true },
        { key: 'refill', label: 'Est. Cost', num: true, money: true },
        { key: 'supplier', label: 'Supplier' }
      ],
      rows: rows,
      searchKeys: ['id', 'name', 'supplier'],
      onRow: function (r) { editMaterial(Materials.find(r.id)); },
      exportName: 'woodart-reorder.csv',
      pageSize: 12,
      empty: { icon: 'cart-plus', title: 'Nothing to reorder', hint: 'All stock is above its reorder level.' }
    }).el);
  }

  mountScreen(page, s);
}

/* ======================================================== SCREEN · VALUATION */
function valuationScreen(page) {
  var s = screen('valuation');
  var sum = Materials.summary();
  var cats = Materials.byCategory();

  fillK(s, 'total', money(sum.value));
  fillK(s, 'top', cats.length ? cats[0].name : '—');
  fillK(s, 'avg', money(sum.avg));
  fillK(s, 'dead', ui.num(sum.dead));

  // One cloned row per category — the count is data, so this is a proto clone.
  var host = fill(s, 'cats');
  var max = cats.length ? cats[0].value : 0;
  cats.forEach(function (c) {
    var row = proto(host, 'cat');
    slot(row, 'name').textContent = c.name + ' · ' + c.items + ' item' + (c.items === 1 ? '' : 's');
    slot(row, 'value').textContent = ui.money(c.value);
    slot(row, 'share').textContent = (sum.value ? Math.round(c.value / sum.value * 100) : 0) + '% of stock value';
    // A computed width is a VALUE, not a utility — inline style is correct here.
    slot(row, 'bar').style.width = (max ? Math.round(c.value / max * 100) : 0) + '%';
    host.appendChild(row);
  });
  dropProtos(host);

  var valued = Materials.all().slice().sort(function (a, b) { return Materials.valueOf(b) - Materials.valueOf(a); });
  fill(s, 'register').appendChild(EPAL.table({
    columns: [
      { key: 'id', label: 'Code', render: function (r) { return '<span class="strong">' + ui.escapeHtml(r.id) + '</span>'; } },
      { key: 'name', label: 'Material' },
      { key: 'category', label: 'Category', render: function (r) { return '<span class="badge">' + ui.escapeHtml(r.category || '—') + '</span>'; } },
      { key: 'stock', label: 'In Stock', num: true, render: stockCell },
      { key: 'unitCost', label: 'Unit Cost', num: true, money: true },
      { key: 'value', label: 'Stock Value', num: true,
        sortVal: function (r) { return Materials.valueOf(r); },
        render: function (r) { return '<span class="num strong">' + ui.money(Materials.valueOf(r)) + '</span>'; } }
    ],
    rows: valued,
    searchKeys: ['id', 'name', 'category'],
    exportName: 'woodart-valuation.csv',
    pageSize: 12,
    empty: { icon: 'safe2', title: 'Nothing to value', hint: 'Add materials to see where stock value sits.' }
  }).el);

  var canvas = fill(s, 'chart');
  mountScreen(page, s);

  // Charts own their own pixels — drawn after the canvas is in the document.
  requestAnimationFrame(function () {
    if (!EPAL.charts || !cats.length || !canvas.isConnected) return;
    EPAL.charts.doughnut(canvas, {
      labels: cats.map(function (c) { return c.name; }),
      data: cats.map(function (c) { return c.value; })
    });
  });
}

/* ============================================================ ADD / EDIT ==== */
/** The add/edit modal is a config-driven platform form (EPAL.formModal), which
 *  is the sanctioned way to build a form — the field schema is the spec the
 *  Laravel FormRequest mirrors one-for-one (see backend/endpoints.md). */
function editMaterial(rec) {
  var isNew = !rec;
  if (isNew && !canCreate()) { ui.toast('You do not have permission to add materials', 'error'); return; }

  EPAL.formModal({
    title: isNew ? 'New Material' : 'Edit · ' + rec.name,
    icon: 'boxes',
    size: 'md',
    record: rec || { id: Materials.nextId(), category: 'Board', unit: 'pcs', stock: 0, reorder: 10, unitCost: 0 },
    fields: [
      { key: 'id', label: 'Code', type: 'text', required: true, readonly: !isNew, col2: true,
        hint: isNew ? 'Auto-numbered in the MAT-000 series — change it if you use your own codes.' : 'The code is the record key and cannot change.' },
      { key: 'name', label: 'Material', type: 'text', required: true, placeholder: 'e.g. Marine Plywood 18mm' },
      { key: 'category', label: 'Category', type: 'select', required: true, col2: true, options: Materials.categories() },
      { key: 'unit', label: 'Unit', type: 'select', required: true, col2: true, options: Materials.units() },
      { key: 'stock', label: 'In Stock', type: 'number', required: true, min: 0, col2: true },
      { key: 'reorder', label: 'Reorder At', type: 'number', required: true, min: 0, col2: true,
        hint: 'When stock falls to this number or below, the item appears on the Reorder tab.' },
      { key: 'unitCost', label: 'Unit Cost', type: 'money', required: true, min: 0, col2: true },
      { key: 'supplier', label: 'Supplier', type: 'select', required: true, col2: true, searchable: true,
        options: Materials.suppliers() }
    ],
    saveLabel: isNew ? 'Add Material' : 'Save Changes',
    onSave: function (v) {
      Materials.save(v);
      ui.toast(isNew ? v.name + ' added' : v.name + ' updated', 'success');
      EPAL.router.render();
      return true;
    }
  });
}
