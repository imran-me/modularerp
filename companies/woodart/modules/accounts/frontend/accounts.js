/* ============================================================================
 * WOODART · ACCOUNTS · LOGIC
 * ----------------------------------------------------------------------------
 * BEHAVIOUR ONLY. Every container, card, KPI tile, banner and bar is real HTML
 * in frontend/template.html, handed to this file by tools/build/build-module.mjs
 * as TEMPLATE_HTML. This file is NOT an IIFE and declares no 'use strict' of its
 * own — the build wraps it.
 *
 * WHERE THE DATA COMES FROM: frontend/api.js — the seam. This file never names
 * `acc_entries` and never names a URL. Grep it: neither is here.
 *
 * ==> LARAVEL MAPPING: register = GET|POST /api/woodart/accounts/register,
 *     payables = GET .../payables, pay = POST .../payables/{po}/pay,
 *     P&L = GET .../project-pnl. Full contract in backend/endpoints.md.
 * ==========================================================================*/

var ui = EPAL.ui, el = ui.el;

var CID = 'woodart';
var ROUTE = 'woodart/accounts';

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
  register: ['Income & Expense', 'Every rupee the interiors business earned and spent.'],
  payables: ['Vendor Payables', 'What Woodart owes, per purchase order — oldest first.'],
  pnl:      ['Project P&L', 'Value against cost against the approved bill of quantities.']
};

function head(sub) {
  var copy = TAB_COPY[sub] || TAB_COPY.register;
  var h = shell('head');
  fill(h, 'eyebrow').textContent = sub === 'register' ? 'Woodart Interiors' : 'Woodart › Accounts';
  fill(h, 'title').appendChild(document.createTextNode(copy[0]));
  var s = fill(h, 'sub');
  s.textContent = copy[1];
  s.setAttribute('title', copy[1]);
  var add = h.querySelector('[data-act="new"]');
  if (!canCreate()) add.parentNode.removeChild(add);
  else add.addEventListener('click', function () { editEntry(null); });
  return h;
}

function tabs(sub) {
  var band = shell('tabs');
  Array.prototype.forEach.call(band.querySelectorAll('[data-tab]'), function (btn) {
    var key = btn.getAttribute('data-tab');
    if (key === sub) btn.classList.add('active');
    btn.removeAttribute('data-tab');
    btn.addEventListener('click', function () {
      EPAL.router.navigate(ROUTE + (key === 'register' ? '' : '/' + key));
    });
  });
  return band;
}

/* ---- permissions + formatters -------------------------------------------- */
function canCreate() { return !EPAL.perm || EPAL.perm.can(CID, 'accounts', 'create'); }
function canDelete() { return !EPAL.perm || EPAL.perm.can(CID, 'accounts', 'delete'); }

var KIND_TONE = { Income: 'good', Expense: '' };

/** Money, always with its sign carried by the KIND rather than the number. */
function signed(e) {
  return (e.kind === 'Income' ? '+' : '−') + ui.money(Math.abs(+e.amount || 0));
}

/** A ref that points at a record which no longer exists is kept, and flagged. */
function refCell(r) {
  if (!r.ref) return '<span class="text-mute">—</span>';
  var known = Books.projectOptions().some(function (o) { return o.value === r.ref; })
    || Books.payables().data.some(function (p) { return p.po === r.ref; });
  return known
    ? '<span class="badge">' + ui.escapeHtml(r.ref) + '</span>'
    : '<span class="badge badge-warn" title="No matching project or order">' + ui.escapeHtml(r.ref) + ' · orphan</span>';
}

/* ============================================================================
   SCREEN 1 · REGISTER
   ========================================================================= */
function registerScreen(page) {
  var s = screen('register');
  var sum = Books.summary();

  fillK(s, 'income', ui.compact(sum.income));
  fillK(s, 'expense', ui.compact(sum.expense));
  fillK(s, 'net', ui.compact(sum.net));
  fillK(s, 'unpaidVendors', sum.unpaidVendors);
  fillK(s, 'outstanding', ui.compact(sum.outstanding));

  var owing = Books.openOrders().length;
  var banner = when(s, 'owing', owing > 0);
  if (banner) {
    fillK(banner, 'owingInline', owing);
    banner.querySelector('[data-act="goPayables"]')
      .addEventListener('click', function () { EPAL.router.navigate(ROUTE + '/payables'); });
  }

  fill(s, 'register').appendChild(EPAL.table({
    columns: [
      { key: 'id', label: 'Voucher', render: function (r) { return '<span class="strong">' + ui.escapeHtml(r.id) + '</span>'; } },
      { key: 'date', label: 'Date', date: true },
      { key: 'kind', label: 'Kind', badge: KIND_TONE },
      { key: 'category', label: 'Category' },
      { key: 'desc', label: 'Description' },
      { key: 'ref', label: 'Against', render: refCell },
      { key: 'method', label: 'Method', render: function (r) { return '<span class="badge">' + ui.escapeHtml(r.method || '—') + '</span>'; } },
      { key: 'amount', label: 'Amount', num: true,
        sortVal: function (r) { return (r.kind === 'Income' ? 1 : -1) * (+r.amount || 0); },
        render: function (r) {
          return '<span class="' + (r.kind === 'Income' ? 'text-good' : '') + '">' + signed(r) + '</span>';
        } }
    ],
    rows: Books.register(),
    searchKeys: ['id', 'category', 'desc', 'ref', 'party'],
    filters: [{ key: 'kind', label: 'Kind' }, { key: 'category', label: 'Category' }, { key: 'method', label: 'Method' }],
    onRow: function (r) { editEntry(Books.find(r.id)); },
    actions: canDelete() ? [{ icon: 'trash', title: 'Void entry', danger: true, onClick: voidEntry }] : null,
    exportName: 'woodart-register.csv',
    pageSize: 12,
    empty: { icon: 'journal-text', title: 'Nothing recorded yet', hint: 'Record the first income or expense.' }
  }).el);

  mountScreen(page, s);
}

/* ============================================================================
   SCREEN 2 · VENDOR PAYABLES
   ========================================================================= */
function payablesScreen(page) {
  var s = screen('payables');
  var book = Books.payables();

  fillK(s, 'outstanding', ui.compact(book.summary.outstanding));
  fillK(s, 'vendors', book.summary.vendors);
  fillK(s, 'oldest', book.summary.oldestDays ? book.summary.oldestDays + 'd' : '—');
  fillK(s, 'settled', book.summary.settled);

  var owing = book.summary.outstanding > 0;
  when(s, 'clear', !owing);
  var body = when(s, 'some', owing);

  if (body) {
    fill(body, 'register').appendChild(EPAL.table({
      columns: [
        { key: 'po', label: 'Order', render: function (r) { return '<span class="strong">' + ui.escapeHtml(r.po) + '</span>'; } },
        { key: 'vendor', label: 'Vendor' },
        { key: 'date', label: 'Ordered', date: true },
        { key: 'days', label: 'Age', num: true,
          render: function (r) {
            var tone = r.due > 0 && r.days > 30 ? 'text-bad' : (r.due > 0 && r.days > 14 ? 'text-warn' : 'text-mute');
            return '<span class="' + tone + '">' + r.days + 'd</span>';
          } },
        { key: 'ordered', label: 'Ordered', num: true, render: function (r) { return ui.money(r.ordered); } },
        { key: 'paid', label: 'Paid', num: true, render: function (r) { return ui.money(r.paid); } },
        { key: 'due', label: 'Due', num: true,
          render: function (r) {
            return r.due > 0
              ? '<span class="text-bad strong">' + ui.money(r.due) + '</span>'
              : '<span class="text-good">settled</span>';
          } }
      ],
      rows: book.data,
      searchKeys: ['po', 'vendor', 'status'],
      filters: [{ key: 'vendor', label: 'Vendor' }, { key: 'status', label: 'Status' }],
      onRow: function (r) { if (r.due > 0) payOrder(r); },
      exportName: 'woodart-payables.csv',
      pageSize: 12,
      empty: { icon: 'receipt', title: 'No purchase orders', hint: 'Raise one in Procurement.' }
    }).el);
  }

  mountScreen(page, s);
}

/* ============================================================================
   SCREEN 3 · PROJECT P&L
   ========================================================================= */
function pnlScreen(page) {
  var s = screen('pnl');
  var rows = Books.projectPnl();

  var value = 0, cost = 0, billed = 0, over = 0;
  rows.forEach(function (r) {
    value += r.value; cost += r.cost; billed += r.billed;
    if (r.budget > 0 && r.variance < 0) over++;
  });

  fillK(s, 'value', ui.compact(value));
  fillK(s, 'cost', ui.compact(cost));
  fillK(s, 'margin', ui.compact(value - cost));
  fillK(s, 'billed', ui.compact(billed));
  fillK(s, 'over', over);

  var banner = when(s, 'over', over > 0);
  if (banner) fillK(banner, 'overInline', over);

  fill(s, 'register').appendChild(EPAL.table({
    columns: [
      { key: 'project', label: 'Project', render: function (r) { return '<span class="strong">' + ui.escapeHtml(r.project) + '</span>'; } },
      { key: 'name', label: 'Job' },
      { key: 'client', label: 'Client' },
      { key: 'stage', label: 'Stage', render: function (r) { return '<span class="badge">' + ui.escapeHtml(r.stage || '—') + '</span>'; } },
      { key: 'value', label: 'Value', num: true, render: function (r) { return ui.money(r.value); } },
      { key: 'margin', label: 'Margin', num: true,
        render: function (r) { return ui.money(r.margin) + ' <span class="text-mute">· ' + r.marginPct + '%</span>'; } },
      { key: 'billed', label: 'Billed', num: true, render: function (r) { return ui.money(r.billed); } },
      { key: 'budget', label: 'BOQ Budget', num: true,
        render: function (r) { return r.budget ? ui.money(r.budget) : '<span class="text-mute">no BOQ</span>'; } },
      { key: 'materialIssued', label: 'Material Issued', num: true, render: function (r) { return ui.money(r.materialIssued); } },
      /* THE column this module exists for. */
      { key: 'variance', label: 'Variance', num: true,
        render: function (r) {
          if (!r.budget) return '<span class="text-mute">—</span>';
          return r.variance < 0
            ? '<span class="text-bad strong" title="Issued more material than the BOQ budgeted">−' + ui.money(Math.abs(r.variance)) + '</span>'
            : '<span class="text-good">' + ui.money(r.variance) + '</span>';
        } }
    ],
    rows: rows,
    searchKeys: ['project', 'name', 'client', 'stage'],
    filters: [{ key: 'stage', label: 'Stage' }, { key: 'client', label: 'Client' }],
    exportName: 'woodart-project-pnl.csv',
    pageSize: 12,
    empty: { icon: 'clipboard-data', title: 'No projects', hint: 'Projects appear here once the portfolio has work.' }
  }).el);

  mountScreen(page, s);
}

/* ============================================================================
   ACTIONS
   ========================================================================= */

function editEntry(rec) {
  var isNew = !rec;
  var kind = (rec && rec.kind) || 'Expense';

  EPAL.formModal({
    title: isNew ? 'Record Entry' : 'Edit · ' + rec.id,
    icon: 'cash-stack',
    size: 'md',
    record: rec || { kind: 'Expense', method: 'Bank', date: Books.today() },
    fields: [
      { key: 'kind', label: 'Kind', type: 'select', required: true, col2: true, options: Books.kinds(),
        hint: 'Income credits a revenue head; expense debits a cost head.' },
      { key: 'category', label: 'Category', type: 'select', required: true, col2: true, searchable: true,
        options: Books.categories(kind),
        hint: 'The category picks the chart-of-accounts head the ledger posts to.' },
      { key: 'desc', label: 'Description', type: 'text', placeholder: 'e.g. Stage 2 — Square Pharma HQ' },
      { key: 'amount', label: 'Amount (৳)', type: 'number', required: true, min: 1, col2: true },
      { key: 'date', label: 'Date', type: 'date', required: true, col2: true },
      { key: 'method', label: 'Method', type: 'select', required: true, col2: true, options: Books.methods() },
      { key: 'bankId', label: 'Account', type: 'select', col2: true, searchable: true,
        options: Books.bankOptions(),
        hint: 'Which account the money moved through. Leave blank for an unregistered method.' },
      { key: 'ref', label: 'Against', type: 'select', searchable: true, options: Books.projectOptions(),
        hint: 'The project this belongs to. Project P&L reads this to work out what each job has billed and cost.' },
      { key: 'party', label: 'Party', type: 'text', placeholder: 'Client or vendor name' }
    ],
    saveLabel: isNew ? 'Record' : 'Save Changes',
    onSave: function (v) {
      Books.save(v);
      ui.toast(isNew ? 'Entry recorded' : v.id + ' updated', 'success');
      EPAL.router.render();
      return true;
    }
  });
}

/**
 * Void, not delete.
 *
 * The wording matters: on a real host this posts a REVERSAL journal, so the
 * money is unwound with a row explaining why rather than vanishing. Calling the
 * button "Delete" would promise something the books deliberately refuse to do.
 */
function voidEntry(row) {
  ui.confirm({
    title: 'Void ' + row.id + '?',
    body: 'A reversing entry will be posted for ' + ui.money(Math.abs(+row.amount || 0)) +
      '. The original stays in the audit trail — a balance never moves without a row explaining why.',
    confirmLabel: 'Void Entry'
  }).then(function (ok) {
    if (!ok) return;
    Books.remove(row.id);
    ui.toast(row.id + ' voided', 'success');
    EPAL.router.render();
  });
}

/** Settle a purchase order — amount pre-filled to what is actually owed. */
function payOrder(row) {
  EPAL.formModal({
    title: 'Settle ' + row.po,
    icon: 'receipt',
    size: 'sm',
    record: { amount: row.due, date: Books.today(), method: 'Bank' },
    fields: [
      { key: 'amount', label: 'Amount (৳)', type: 'number', required: true, min: 1, max: row.due,
        hint: 'Outstanding on this order: ' + ui.money(row.due) + '. A payment cannot exceed it.' },
      { key: 'date', label: 'Date', type: 'date', required: true, col2: true },
      { key: 'method', label: 'Method', type: 'select', required: true, col2: true, options: Books.methods() },
      { key: 'bankId', label: 'Paid From', type: 'select', searchable: true, options: Books.bankOptions(),
        hint: 'The account the money leaves. Its balance and history move with this entry.' },
      { key: 'note', label: 'Note', type: 'text', placeholder: 'Optional' }
    ],
    saveLabel: 'Record Payment',
    onSave: function (v) {
      if (!Books.payOrder(row.po, v)) {
        ui.toast('Payment must be between 0 and ' + ui.money(row.due), 'error');
        return false;
      }
      ui.toast(row.po + ' — ' + ui.money(+v.amount) + ' paid', 'success');
      EPAL.router.render();
      return true;
    }
  });
}

/* ============================================================================
   ROUTE
   ========================================================================= */
EPAL.view(ROUTE, {
  title: function () { return 'Accounts'; },
  render: function (ctx) {
    var sub = ctx.subId || 'register';
    if (!TAB_COPY[sub]) sub = 'register';

    var page = el('div.page');
    page.appendChild(head(sub));
    page.appendChild(tabs(sub));

    ({ register: registerScreen, payables: payablesScreen, pnl: pnlScreen }[sub])(page);

    ctx.mount.appendChild(page);
  }
});
