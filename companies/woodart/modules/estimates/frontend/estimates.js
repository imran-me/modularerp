/* ============================================================================
 * WOODART · ESTIMATES & BOQ · LOGIC
 * ----------------------------------------------------------------------------
 * BEHAVIOUR ONLY. Every container, card, KPI tile and banner is real HTML in
 * frontend/template.html, handed to this file by tools/build/build-module.mjs
 * as TEMPLATE_HTML. This file is NOT an IIFE and declares no 'use strict' of
 * its own — the build wraps it.
 *
 * WHERE THE DATA COMES FROM: frontend/api.js — the seam. This file never names
 * `wa_estimates` and never names a URL. Grep it: neither is here.
 *
 * WHAT THIS MODULE IS FOR: a quotation is a PROMISE about cost. This screen
 * exists to show when that promise has stopped being true — the Drift column
 * compares every quoted unit cost against the live Materials register, because
 * a quote written months ago against plywood that has since gone up is the
 * commonest way an interiors job loses its margin before a sheet is cut.
 *
 * ==> LARAVEL MAPPING: quotations = GET|POST /api/woodart/estimates/quotations,
 *     boq = GET .../boq, costing = GET .../costing.
 *     Full contract in backend/endpoints.md.
 * ==========================================================================*/

var ui = EPAL.ui, el = ui.el;

var CID = 'woodart';
var ROUTE = 'woodart/estimates';

/* ---- template plumbing — the whole bridge to the markup ------------------ */
var TPL = document.createElement('div');
TPL.innerHTML = TEMPLATE_HTML;

function screen(name) { return TPL.querySelector('[data-screen="' + name + '"]').cloneNode(true); }
function shell(name) { return TPL.querySelector('[data-shell="' + name + '"]').cloneNode(true); }
function fill(root, k) { return root.querySelector('[data-fill="' + k + '"]'); }
function fillK(root, k, v) { var n = root.querySelector('[data-k="' + k + '"]'); if (n) n.textContent = String(v); }
function mountScreen(page, s) { Array.prototype.slice.call(s.children).forEach(function (c) { page.appendChild(c); }); }

function when(root, name, keep) {
  var n = root.querySelector('[data-when="' + name + '"]');
  if (!n) return null;
  if (!keep) { n.parentNode.removeChild(n); return null; }
  n.removeAttribute('data-when');
  return n;
}

/* ---- shared chrome ------------------------------------------------------- */

var TAB_COPY = {
  quotations: ['Quotations', 'What Woodart has quoted, and what the client said.'],
  boq:        ['Bill of Materials', "Every quoted line, against today's register price."],
  costing:    ['Costing', 'Which quotations actually make money.']
};

function head(sub) {
  var copy = TAB_COPY[sub] || TAB_COPY.quotations;
  var h = shell('head');
  fill(h, 'eyebrow').textContent = sub === 'quotations' ? 'Woodart Interiors' : 'Woodart › Estimates';
  fill(h, 'title').appendChild(document.createTextNode(copy[0]));
  var s = fill(h, 'sub');
  s.textContent = copy[1];
  s.setAttribute('title', copy[1]);
  var add = h.querySelector('[data-act="new"]');
  if (!canCreate()) add.parentNode.removeChild(add);
  else add.addEventListener('click', function () { editEstimate(null); });
  return h;
}

function tabs(sub) {
  var band = shell('tabs');
  Array.prototype.forEach.call(band.querySelectorAll('[data-tab]'), function (btn) {
    var key = btn.getAttribute('data-tab');
    if (key === sub) btn.classList.add('active');
    btn.removeAttribute('data-tab');
    btn.addEventListener('click', function () {
      EPAL.router.navigate(ROUTE + (key === 'quotations' ? '' : '/' + key));
    });
  });
  return band;
}

/* ---- permissions + formatters -------------------------------------------- */
function canCreate() { return !EPAL.perm || EPAL.perm.can(CID, 'estimates', 'create'); }
function canDelete() { return !EPAL.perm || EPAL.perm.can(CID, 'estimates', 'delete'); }

var STATUS_TONE = { Approved: 'good', Sent: 'warn', Draft: '', Rejected: 'bad' };

/** A margin the business should worry about reads differently from a healthy one. */
function marginCell(pct) {
  var tone = pct < 15 ? 'text-bad strong' : (pct < 25 ? 'text-warn' : 'text-good');
  return '<span class="' + tone + '">' + pct + '%</span>';
}

/** A project ref that no longer resolves is KEPT and flagged, never hidden. */
function projectCell(r) {
  if (!r.project) return '<span class="text-mute">—</span>';
  var known = Boq.projectOptions().some(function (o) { return o.value === r.project; });
  return known
    ? '<span class="badge">' + ui.escapeHtml(r.project) + '</span>'
    : '<span class="badge badge-warn" title="No matching project">' + ui.escapeHtml(r.project) + ' · orphan</span>';
}

/* ============================================================================
   SCREEN 1 · QUOTATIONS
   ========================================================================= */
function quotationsScreen(page) {
  var s = screen('quotations');
  var sum = Boq.summary();

  fillK(s, 'count', sum.count);
  fillK(s, 'pipeline', ui.compact(sum.pipeline));
  fillK(s, 'approved', ui.compact(sum.approved));
  fillK(s, 'winRate', sum.winRate + '%');
  fillK(s, 'expired', sum.expired);

  var banner = when(s, 'expired', sum.expired > 0);
  if (banner) fillK(banner, 'expiredInline', sum.expired);

  fill(s, 'register').appendChild(EPAL.table({
    columns: [
      { key: 'id', label: 'Quote', render: function (r) { return '<span class="strong">' + ui.escapeHtml(r.id) + '</span>'; } },
      { key: 'title', label: 'Title' },
      { key: 'client', label: 'Client' },
      { key: 'project', label: 'Project', render: projectCell },
      { key: 'lineCount', label: 'Lines', num: true },
      { key: 'cost', label: 'Cost', num: true, render: function (r) { return ui.money(r.cost); } },
      { key: 'sale', label: 'Quoted', num: true, render: function (r) { return '<span class="strong">' + ui.money(r.sale) + '</span>'; } },
      { key: 'marginPct', label: 'Margin', num: true, render: function (r) { return marginCell(r.marginPct); } },
      { key: 'validTill', label: 'Valid Till', date: true,
        render: function (r) {
          if (!r.validTill) return '<span class="text-mute">—</span>';
          return r.expired
            ? '<span class="text-bad" title="Past validity, still unanswered">' + ui.date(r.validTill) + '</span>'
            : ui.date(r.validTill);
        } },
      { key: 'status', label: 'Status', badge: STATUS_TONE }
    ],
    rows: Boq.register(),
    searchKeys: ['id', 'title', 'client', 'project'],
    filters: [{ key: 'status', label: 'Status' }, { key: 'client', label: 'Client' }],
    onRow: function (r) { editEstimate(Boq.find(r.id)); },
    actions: canDelete() ? [{ icon: 'trash', title: 'Delete quotation', danger: true, onClick: deleteEstimate }] : null,
    exportName: 'woodart-quotations.csv',
    pageSize: 12,
    empty: { icon: 'file-earmark-text', title: 'No quotations yet', hint: 'Quote the first job.' }
  }).el);

  mountScreen(page, s);
}

/* ============================================================================
   SCREEN 2 · BILL OF MATERIALS
   ========================================================================= */
function boqScreen(page) {
  var s = screen('boq');
  var lines = Boq.lines();
  var demand = Boq.demand();

  var cost = 0, drifted = 0, driftValue = 0, unknown = 0;
  lines.forEach(function (l) {
    cost += l.lineCost;
    if (!l.known) { unknown++; return; }
    if (l.drift > 0 && l.status !== 'Rejected') { drifted++; driftValue += l.drift * l.qty; }
  });

  fillK(s, 'lines', lines.length);
  fillK(s, 'materials', demand.length);
  fillK(s, 'cost', ui.compact(cost));
  fillK(s, 'drifted', drifted);
  fillK(s, 'unknown', unknown);

  var banner = when(s, 'drift', drifted > 0);
  if (banner) {
    fillK(banner, 'driftInline', drifted);
    fillK(banner, 'driftValue', ui.money(driftValue));
  }

  fill(s, 'register').appendChild(EPAL.table({
    columns: [
      { key: 'estimate', label: 'Quote', render: function (r) { return '<span class="strong">' + ui.escapeHtml(r.estimate) + '</span>'; } },
      { key: 'item', label: 'Material' },
      { key: 'qty', label: 'Qty', num: true },
      { key: 'unitCost', label: 'Quoted Cost', num: true, render: function (r) { return ui.money(r.unitCost); } },
      { key: 'liveCost', label: 'Register Today', num: true,
        render: function (r) {
          return r.known
            ? ui.money(r.liveCost)
            : '<span class="text-mute" title="This item is not in the Materials register">not stocked</span>';
        } },
      /* THE column this screen exists for. */
      { key: 'drift', label: 'Drift', num: true,
        sortVal: function (r) { return r.drift === null ? -1e12 : r.drift * r.qty; },
        render: function (r) {
          if (!r.known) return '<span class="text-mute">—</span>';
          var v = r.drift * r.qty;
          if (r.drift > 0) return '<span class="text-bad strong" title="Costs more now than quoted">+' + ui.money(v) + '</span>';
          if (r.drift < 0) return '<span class="text-good" title="Cheaper now than quoted">−' + ui.money(Math.abs(v)) + '</span>';
          return '<span class="text-mute">level</span>';
        } },
      { key: 'lineSale', label: 'Line Value', num: true, render: function (r) { return ui.money(r.lineSale); } },
      { key: 'status', label: 'Status', badge: STATUS_TONE }
    ],
    rows: lines,
    searchKeys: ['estimate', 'item', 'client', 'project'],
    filters: [{ key: 'item', label: 'Material' }, { key: 'status', label: 'Status' }],
    exportName: 'woodart-boq-lines.csv',
    pageSize: 14,
    empty: { icon: 'list-ol', title: 'No quoted lines', hint: 'Add materials to a quotation.' }
  }).el);

  fill(s, 'demand').appendChild(EPAL.table({
    columns: [
      { key: 'item', label: 'Material', render: function (r) { return '<span class="strong">' + ui.escapeHtml(r.item) + '</span>'; } },
      { key: 'estimates', label: 'On Quotes', num: true },
      { key: 'qty', label: 'Total Qty', num: true },
      { key: 'cost', label: 'At Quoted Cost', num: true, render: function (r) { return ui.money(r.cost); } }
    ],
    rows: demand,
    searchKeys: ['item'],
    exportName: 'woodart-material-demand.csv',
    pageSize: 10,
    empty: { icon: 'boxes', title: 'Nothing quoted', hint: 'Material demand appears once work is quoted.' }
  }).el);

  mountScreen(page, s);
}

/* ============================================================================
   SCREEN 3 · COSTING
   ========================================================================= */
function costingScreen(page) {
  var s = screen('costing');
  var rows = Boq.costing();

  var sale = 0, cost = 0, today = 0;
  rows.forEach(function (r) { sale += r.sale; cost += r.cost; today += r.marginToday; });
  var worst = rows.filter(function (r) { return r.status !== 'Rejected'; })[0];

  fillK(s, 'sale', ui.compact(sale));
  fillK(s, 'cost', ui.compact(cost));
  fillK(s, 'margin', ui.compact(sale - cost));
  fillK(s, 'today', ui.compact(today));
  fillK(s, 'worst', worst ? worst.marginPct + '%' : '—');

  fill(s, 'register').appendChild(EPAL.table({
    columns: [
      { key: 'id', label: 'Quote', render: function (r) { return '<span class="strong">' + ui.escapeHtml(r.id) + '</span>'; } },
      { key: 'title', label: 'Title' },
      { key: 'client', label: 'Client' },
      { key: 'cost', label: 'Cost', num: true, render: function (r) { return ui.money(r.cost); } },
      { key: 'sale', label: 'Quoted', num: true, render: function (r) { return ui.money(r.sale); } },
      { key: 'margin', label: 'Margin', num: true, render: function (r) { return ui.money(r.margin); } },
      { key: 'marginPct', label: '%', num: true, render: function (r) { return marginCell(r.marginPct); } },
      { key: 'drifted', label: 'Lines Up', num: true,
        render: function (r) {
          return r.drifted
            ? '<span class="text-warn">' + r.drifted + '</span>'
            : '<span class="text-mute">—</span>';
        } },
      /* What the margin becomes if today's material prices hold. */
      { key: 'marginToday', label: 'Margin Today', num: true,
        render: function (r) {
          if (!r.driftValue) return '<span class="text-mute">' + ui.money(r.margin) + '</span>';
          return '<span class="text-bad strong" title="After material price drift">' + ui.money(r.marginToday) + '</span>';
        } },
      { key: 'status', label: 'Status', badge: STATUS_TONE }
    ],
    rows: rows,
    searchKeys: ['id', 'title', 'client', 'project'],
    filters: [{ key: 'status', label: 'Status' }, { key: 'client', label: 'Client' }],
    onRow: function (r) { editEstimate(Boq.find(r.id)); },
    exportName: 'woodart-costing.csv',
    pageSize: 12,
    empty: { icon: 'percent', title: 'Nothing to cost', hint: 'Quote a job first.' }
  }).el);

  mountScreen(page, s);
}

/* ============================================================================
   ACTIONS
   ========================================================================= */

function editEstimate(rec) {
  var isNew = !rec;

  EPAL.formModal({
    title: isNew ? 'New Quotation' : 'Edit · ' + rec.id,
    icon: 'calculator-fill',
    size: 'lg',
    record: rec || { id: Boq.nextId(), status: 'Draft', lines: [] },
    fields: [
      { key: 'id', label: 'Quote No.', type: 'text', required: true, readonly: !isNew, col2: true,
        hint: isNew ? 'Auto-numbered in the EST-000 series.' : 'The quote number is the record key and cannot change.' },
      { key: 'status', label: 'Status', type: 'select', required: true, col2: true, options: Boq.statuses(),
        hint: 'Only Approved and Sent count as budget in Project P&L — a draft is a guess.' },
      { key: 'title', label: 'Title', type: 'text', required: true, placeholder: 'e.g. Office Fit-out — Square Pharma HQ' },
      { key: 'client', label: 'Client', type: 'select', required: true, searchable: true, col2: true,
        options: Boq.clientOptions() },
      { key: 'project', label: 'Project', type: 'select', searchable: true, col2: true,
        options: Boq.projectOptions(),
        hint: 'Links the BOQ to a job. Project P&L reads these lines as that job’s budget.' },
      { key: 'validTill', label: 'Valid Till', type: 'date', col2: true,
        hint: 'Past this date with no answer, the quote is flagged for re-pricing.' },
      /* `items` is the house line-item repeater (platform/kit/forms.js) — the
       * same one the journal-entry modal uses. min:1 because a quotation with no
       * quantities is not a bill of quantities. */
      { key: 'lines', label: 'Bill of Quantities', type: 'items', min: 1, addLabel: 'Add material',
        columns: [
          { key: 'item', label: 'Material', type: 'select', width: '2.4fr', options: Boq.materialOptions() },
          { key: 'qty', label: 'Qty', type: 'number', width: '1fr' },
          { key: 'unitCost', label: 'Unit Cost', type: 'money', width: '1fr' },
          { key: 'unitSale', label: 'Unit Sale', type: 'money', width: '1fr' }
        ],
        hint: 'Cost is what we pay, Sale is what the client pays. The gap is the margin this job is quoted to earn.' }
    ],
    saveLabel: isNew ? 'Create Quotation' : 'Save Changes',
    onSave: function (v) {
      Boq.save(v);
      ui.toast(isNew ? v.id + ' created' : v.id + ' updated', 'success');
      EPAL.router.render();
      return true;
    }
  });
}

function deleteEstimate(row) {
  var linked = row.project
    ? ' It is the BOQ budget for ' + row.project + ' — that project’s P&L will lose its budget and variance columns.'
    : '';
  ui.confirm({
    title: 'Delete ' + row.id + '?',
    body: 'The quotation "' + (row.title || '') + '" and its ' + (row.lineCount || 0) +
      ' quoted line(s) will be removed.' + linked + ' This cannot be undone.',
    confirmLabel: 'Delete'
  }).then(function (ok) {
    if (!ok) return;
    Boq.remove(row.id);
    ui.toast(row.id + ' deleted', 'success');
    EPAL.router.render();
  });
}

/* ============================================================================
   ROUTE
   ========================================================================= */
var SCREENS = { quotations: quotationsScreen, boq: boqScreen, costing: costingScreen };

EPAL.view(ROUTE, {
  title: function () { return 'Estimates & BOQ'; },
  render: function (ctx) {
    var sub = ctx.subId || 'quotations';
    if (!SCREENS[sub]) sub = 'quotations';

    var page = el('div.page');
    page.appendChild(head(sub));
    page.appendChild(tabs(sub));

    SCREENS[sub](page);

    ctx.mount.appendChild(page);
  }
});
