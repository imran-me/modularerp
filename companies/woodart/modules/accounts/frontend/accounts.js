/* ============================================================================
 * WOODART · ACCOUNTS · LOGIC
 * ----------------------------------------------------------------------------
 * BEHAVIOUR ONLY. Every container, card, KPI tile, banner and canvas is real
 * HTML in frontend/template.html, handed to this file by
 * tools/build/build-module.mjs as TEMPLATE_HTML. This file is NOT an IIFE and
 * declares no 'use strict' of its own — the build wraps it.
 *
 * WHERE THE DATA COMES FROM: frontend/api.js — the seam. This file never names
 * `acc_entries` and never names a URL. Grep it: neither is here.
 *
 * THE TAB SET matches Travels Accounts (owner directive 2026-07-28) so a person
 * who knows one concern's books knows them all, plus the two screens only an
 * interiors business can show — Vendor Payables and Project P&L.
 *
 * PAYROLL and MANAGE CASH mount the SHARED desks. `EPAL.payrollDesk(page, cid)`
 * and `EPAL.cashDesk(page, cid)` already take a company id, so Woodart runs the
 * SAME code Travels runs rather than a copy of it — a fix to the cash book
 * reaches both concerns at once. Re-implementing them here would have been the
 * expensive way to get a second thing to keep in sync.
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

/** Give a template canvas a unique id so Chart.js can find it after mounting. */
function canvasId(root, name) {
  var c = root.querySelector('[data-canvas="' + name + '"]');
  if (!c) return null;
  var id = 'wa-acc-' + name + '-' + ui.uid();
  c.id = id;
  c.removeAttribute('data-canvas');
  return id;
}

/* ---- shared chrome ------------------------------------------------------- */

var TAB_COPY = {
  overview:  ['Accounts', 'Income, expenses, journals and payment schedules for Woodart Interiors.'],
  income:    ['Income', 'Project billings, design fees and everything else the business earned.'],
  expenses:  ['Expenses', 'Every cost of running the workshop, with its project or order.'],
  payables:  ['Vendor Payables', 'What Woodart owes, per purchase order — oldest first.'],
  pnl:       ['Project P&L', 'Value against cost against the approved bill of quantities.'],
  payroll:   ['Payroll', 'Salary run, payslips, loans & advances — posted to the ledger.'],
  recurring: ['Recurring', 'Standing monthly costs — rent, utilities, retainers.'],
  banks:     ['Banks', "Woodart's own accounts and what is in them."],
  cash:      ['Manage Cash', 'Cash book, petty cash and cheques.'],
  journals:  ['Journals', 'The double entry behind every screen in this module.'],
  schedules: ['Payment Schedules', 'Money promised for a future date, and what is overdue.']
};

function head(sub) {
  var copy = TAB_COPY[sub] || TAB_COPY.overview;
  var h = shell('head');
  fill(h, 'eyebrow').textContent = sub === 'overview' ? 'Woodart Interiors' : 'Woodart › Accounts';
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
      EPAL.router.navigate(ROUTE + (key === 'overview' ? '' : '/' + key));
    });
  });
  return band;
}

/* ---- permissions + formatters -------------------------------------------- */
function canCreate() { return !EPAL.perm || EPAL.perm.can(CID, 'accounts', 'create'); }
function canDelete() { return !EPAL.perm || EPAL.perm.can(CID, 'accounts', 'delete'); }

var KIND_TONE = { Income: 'good', Expense: '' };

/** Money, with the sign carried by the KIND rather than by the number. */
function signed(e) {
  return (e.kind === 'Income' ? '+' : '−') + ui.money(Math.abs(+e.amount || 0));
}

/** A ref pointing at a record that no longer exists is KEPT, and flagged. */
function refCell(r) {
  if (!r.ref) return '<span class="text-mute">—</span>';
  var known = Books.projectOptions().some(function (o) { return o.value === r.ref; })
    || Books.payables().data.some(function (p) { return p.po === r.ref; });
  return known
    ? '<span class="badge">' + ui.escapeHtml(r.ref) + '</span>'
    : '<span class="badge badge-warn" title="No matching project or order">' + ui.escapeHtml(r.ref) + ' · orphan</span>';
}

/** The register columns, shared by Income and Expenses so they cannot drift. */
function registerColumns(showKind) {
  var cols = [
    { key: 'id', label: 'Voucher', render: function (r) { return '<span class="strong">' + ui.escapeHtml(r.id) + '</span>'; } },
    { key: 'date', label: 'Date', date: true }
  ];
  if (showKind) cols.push({ key: 'kind', label: 'Kind', badge: KIND_TONE });
  return cols.concat([
    { key: 'category', label: 'Category' },
    { key: 'desc', label: 'Description' },
    { key: 'ref', label: 'Against', render: refCell },
    { key: 'method', label: 'Method', render: function (r) { return '<span class="badge">' + ui.escapeHtml(r.method || '—') + '</span>'; } },
    { key: 'amount', label: 'Amount', num: true,
      sortVal: function (r) { return +r.amount || 0; },
      render: function (r) {
        return '<span class="' + (r.kind === 'Income' ? 'text-good' : '') + '">' + signed(r) + '</span>';
      } }
  ]);
}

function registerTable(rows, name, showKind) {
  return EPAL.table({
    columns: registerColumns(showKind),
    rows: rows,
    searchKeys: ['id', 'category', 'desc', 'ref', 'party'],
    filters: [{ key: 'category', label: 'Category' }, { key: 'method', label: 'Method' }],
    onRow: function (r) { editEntry(Books.find(r.id)); },
    actions: canDelete() ? [{ icon: 'trash', title: 'Void entry', danger: true, onClick: voidEntry }] : null,
    exportName: name,
    pageSize: 12,
    empty: { icon: 'journal-text', title: 'Nothing recorded yet', hint: 'Record the first entry.' }
  }).el;
}

/* ============================================================================
   SCREEN · OVERVIEW
   ========================================================================= */
function overviewScreen(page) {
  var s = screen('overview');
  var sum = Books.summary();

  fillK(s, 'income', ui.compact(sum.income));
  fillK(s, 'expense', ui.compact(sum.expense));
  fillK(s, 'net', ui.compact(sum.net));
  fillK(s, 'cash', ui.compact(Books.cashBalance()));
  fillK(s, 'outstanding', ui.compact(sum.outstanding));
  fillK(s, 'outstandingFoot', sum.unpaidVendors + ' vendor(s) unpaid');

  /* The action center — only real, actionable facts. An empty list here means
   * nothing needs a decision, which is worth showing rather than hiding. */
  var acts = [];
  var pay = Books.payables();
  pay.data.filter(function (p) { return p.due > 0 && p.days > 30; }).slice(0, 4).forEach(function (p) {
    acts.push({ icon: 'exclamation-diamond', tone: 'bad',
      text: p.vendor + ' payable ' + ui.money(p.due) + ' overdue by ' + p.days + 'd',
      go: ROUTE + '/payables' });
  });
  Books.projectPnl().filter(function (r) { return r.budget > 0 && r.variance < 0; }).slice(0, 3).forEach(function (r) {
    acts.push({ icon: 'fire', tone: 'bad',
      text: r.project + ' has issued ' + ui.money(Math.abs(r.variance)) + ' more material than its BOQ budgeted',
      go: ROUTE + '/pnl' });
  });
  var topHead = Books.byHead('Expense')[0];
  if (topHead) {
    acts.push({ icon: 'pie-chart-fill', tone: '',
      text: 'Biggest expense head: ' + topHead.head + ' · ' + ui.money(topHead.total),
      go: ROUTE + '/expenses' });
  }
  if (Books.cashBalance() < 0) {
    acts.push({ icon: 'wallet2', tone: 'bad', text: 'Cash & bank position is negative — review upcoming payables.', go: ROUTE + '/banks' });
  }

  var box = fill(s, 'actions');
  if (!acts.length) {
    box.appendChild(el('div.empty-state', null, [
      el('i.bi.bi-check2-circle'), el('h3', { text: 'Nothing needs attention' }),
      el('p.tw-text-ink-dim', { text: 'No overdue payables, no job over its BOQ budget.' })
    ]));
  } else {
    acts.forEach(function (a) {
      box.appendChild(el('button.data-row.row-link', {
        onclick: function () { EPAL.router.navigate(a.go); }
      }, [
        el('span.row-ico' + (a.tone ? '.tone-' + a.tone : ''), { html: ui.icon(a.icon) }),
        el('span.row-text', { text: a.text }),
        el('i.bi.bi-chevron-right.row-chev')
      ]));
    });
  }

  var trendId = canvasId(s, 'trend');
  var mixId = canvasId(s, 'mix');

  mountScreen(page, s);

  /* Charts draw AFTER the screen is in the document — Chart.js measures its
   * canvas, and a detached node has no size. */
  requestAnimationFrame(function () {
    var months = Books.monthly(8);
    var c1 = trendId && document.getElementById(trendId);
    if (c1) EPAL.charts.bar(c1, {
      labels: months.map(function (m) { return m.label; }), legend: true,
      datasets: [
        { label: 'Income', data: months.map(function (m) { return m.income; }), color: '#23c17e' },
        { label: 'Expense', data: months.map(function (m) { return m.expense; }), color: '#f0506e' }
      ]
    });
    var mix = Books.byHead('Expense').slice(0, 7);
    var c2 = mixId && document.getElementById(mixId);
    if (c2 && mix.length) EPAL.charts.doughnut(c2, {
      labels: mix.map(function (m) { return m.head; }),
      data: mix.map(function (m) { return m.total; })
    });
  });
}

/* ============================================================================
   SCREEN · INCOME
   ========================================================================= */
function incomeScreen(page) {
  var s = screen('income');
  var rows = Books.income();
  var total = rows.reduce(function (t, r) { return t + (+r.amount || 0); }, 0);
  var top = Books.byHead('Income')[0];
  var projects = rows.filter(function (r) { return r.ref; })
    .reduce(function (t, r) { return t + (+r.amount || 0); }, 0);

  fillK(s, 'total', ui.compact(total));
  fillK(s, 'count', rows.length);
  fillK(s, 'top', top ? top.head : '—');
  fillK(s, 'projects', ui.compact(projects));

  fill(s, 'register').appendChild(registerTable(rows, 'woodart-income.csv', false));
  mountScreen(page, s);
}

/* ============================================================================
   SCREEN · EXPENSES
   ========================================================================= */
function expensesScreen(page) {
  var s = screen('expenses');
  var rows = Books.expenses();
  var total = rows.reduce(function (t, r) { return t + (+r.amount || 0); }, 0);
  var top = Books.byHead('Expense')[0];
  var vendors = rows.filter(function (r) { return r.category === 'Vendor Payment'; })
    .reduce(function (t, r) { return t + (+r.amount || 0); }, 0);

  fillK(s, 'total', ui.compact(total));
  fillK(s, 'count', rows.length);
  fillK(s, 'top', top ? top.head : '—');
  fillK(s, 'vendors', ui.compact(vendors));

  fill(s, 'register').appendChild(registerTable(rows, 'woodart-expenses.csv', false));
  mountScreen(page, s);
}

/* ============================================================================
   SCREEN · VENDOR PAYABLES
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
   SCREEN · PROJECT P&L
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
   SCREEN · RECURRING
   ========================================================================= */
function recurringScreen(page) {
  var s = screen('recurring');
  var rows = Books.recurring();
  var active = rows.filter(function (r) { return r.status !== 'Paused'; });
  var monthly = active.reduce(function (t, r) { return t + (+r.amount || 0); }, 0);
  var dueThis = active.filter(function (r) { return Books.isDueThisMonth(r); }).length;

  fillK(s, 'active', active.length);
  fillK(s, 'monthly', ui.compact(monthly));
  fillK(s, 'due', dueThis);
  fillK(s, 'paused', rows.length - active.length);

  fill(s, 'register').appendChild(EPAL.table({
    columns: [
      { key: 'id', label: 'Ref', render: function (r) { return '<span class="strong">' + ui.escapeHtml(r.id) + '</span>'; } },
      { key: 'name', label: 'What' },
      { key: 'category', label: 'Head' },
      { key: 'party', label: 'Paid To' },
      { key: 'dayOfMonth', label: 'Day', num: true,
        render: function (r) { return r.dayOfMonth ? 'day ' + r.dayOfMonth : '—'; } },
      { key: 'method', label: 'Method', render: function (r) { return '<span class="badge">' + ui.escapeHtml(r.method || '—') + '</span>'; } },
      { key: 'status', label: 'Status', badge: { Active: 'good', Paused: 'warn' } },
      { key: 'amount', label: 'Amount', num: true, render: function (r) { return ui.money(r.amount); } }
    ],
    rows: rows,
    searchKeys: ['id', 'name', 'category', 'party'],
    filters: [{ key: 'status', label: 'Status' }, { key: 'category', label: 'Head' }],
    onRow: function (r) { editRecurring(r); },
    actions: canDelete() ? [{ icon: 'trash', title: 'Delete', danger: true, onClick: deleteRecurring }] : null,
    exportName: 'woodart-recurring.csv',
    pageSize: 12,
    empty: { icon: 'arrow-repeat', title: 'No recurring costs', hint: 'Add the workshop rent, utilities or a retainer.' }
  }).el);

  mountScreen(page, s);
}

/* ============================================================================
   SCREEN · BANKS
   ========================================================================= */
function banksScreen(page) {
  var s = screen('banks');
  var rows = Books.banks();
  var total = rows.reduce(function (t, b) { return t + (+b.balance || 0); }, 0);
  var largest = rows.slice().sort(function (a, b) { return (+b.balance || 0) - (+a.balance || 0); })[0];

  fillK(s, 'count', rows.length);
  fillK(s, 'total', ui.compact(total));
  fillK(s, 'largest', largest ? largest.name : '—');

  fill(s, 'register').appendChild(EPAL.table({
    columns: [
      { key: 'name', label: 'Account', render: function (r) { return '<span class="strong">' + ui.escapeHtml(r.name || '—') + '</span>'; } },
      { key: 'accountName', label: 'Held By' },
      { key: 'accountNumber', label: 'Number' },
      { key: 'branchName', label: 'Branch' },
      { key: 'type', label: 'Type', render: function (r) { return '<span class="badge">' + ui.escapeHtml(r.type || r.accountType || '—') + '</span>'; } },
      { key: 'balance', label: 'Balance', num: true,
        render: function (r) {
          var v = +r.balance || 0;
          return '<span class="' + (v < 0 ? 'text-bad strong' : '') + '">' + ui.money(v) + '</span>';
        } }
    ],
    rows: rows,
    searchKeys: ['name', 'accountName', 'accountNumber', 'branchName'],
    exportName: 'woodart-banks.csv',
    pageSize: 12,
    empty: { icon: 'bank', title: 'No accounts', hint: 'Add one on Master Accounts › Manage Banks.' }
  }).el);

  mountScreen(page, s);
}

/* ============================================================================
   SCREEN · JOURNALS
   ========================================================================= */
function journalsScreen(page) {
  var s = screen('journals');
  var rows = Books.journals();

  var dr = 0, cr = 0;
  rows.forEach(function (j) {
    (j.lines || []).forEach(function (l) { dr += +l.dr || 0; cr += +l.cr || 0; });
  });

  fillK(s, 'count', rows.length);
  fillK(s, 'dr', ui.compact(dr));
  fillK(s, 'cr', ui.compact(cr));
  /* Rounded to the paisa before comparing: a float sum of many postings is
   * never exactly equal, and reporting "No" for a 0.0000001 drift would send
   * somebody hunting a bug that is not there. */
  fillK(s, 'balanced', Math.abs(dr - cr) < 0.01 ? 'Yes' : 'No');

  fill(s, 'register').appendChild(EPAL.table({
    columns: [
      { key: 'id', label: 'Journal', render: function (r) { return '<span class="strong">' + ui.escapeHtml(r.id || r.ref || '—') + '</span>'; } },
      { key: 'date', label: 'Date', date: true },
      { key: 'source', label: 'Source', render: function (r) { return '<span class="badge">' + ui.escapeHtml(r.source || 'manual') + '</span>'; } },
      { key: 'memo', label: 'Narration' },
      { key: 'party', label: 'Party' },
      { key: 'amount', label: 'Amount', num: true,
        sortVal: function (r) { return journalTotal(r); },
        render: function (r) { return ui.money(journalTotal(r)); } }
    ],
    rows: rows,
    searchKeys: ['id', 'ref', 'memo', 'party', 'source'],
    filters: [{ key: 'source', label: 'Source' }],
    exportName: 'woodart-journals.csv',
    pageSize: 12,
    empty: { icon: 'journal-text', title: 'No journals yet', hint: 'Postings appear here as soon as money moves.' }
  }).el);

  mountScreen(page, s);
}

/** One side of a balanced entry IS the entry's value — summing both doubles it. */
function journalTotal(j) {
  return (j.lines || []).reduce(function (t, l) { return t + (+l.dr || 0); }, 0);
}

/* ============================================================================
   SCREEN · SCHEDULES
   ========================================================================= */
function schedulesScreen(page) {
  var s = screen('schedules');
  var rows = Books.schedules();
  var today = Books.today();

  var open = rows.filter(function (r) { return r.status !== 'Paid' && r.status !== 'Cancelled'; });
  var out = open.reduce(function (t, r) { return t + (+r.amount || 0); }, 0);
  var overdue = open.filter(function (r) { return r.dueDate && r.dueDate < today; });
  var soon = open.filter(function (r) {
    if (!r.dueDate || r.dueDate < today) return false;
    return (Date.parse(r.dueDate) - Date.parse(today)) / 86400000 <= 7;
  });

  fillK(s, 'open', open.length);
  fillK(s, 'out', ui.compact(out));
  fillK(s, 'overdue', overdue.length);
  fillK(s, 'soon', soon.length);

  fill(s, 'register').appendChild(EPAL.table({
    columns: [
      { key: 'id', label: 'Ref', render: function (r) { return '<span class="strong">' + ui.escapeHtml(r.id) + '</span>'; } },
      { key: 'title', label: 'What', render: function (r) { return ui.escapeHtml(r.title || r.desc || '—'); } },
      { key: 'party', label: 'Party' },
      { key: 'dueDate', label: 'Due', date: true },
      { key: 'age', label: 'When', sortVal: function (r) { return r.dueDate || ''; },
        render: function (r) {
          if (!r.dueDate) return '<span class="text-mute">—</span>';
          var d = Math.round((Date.parse(r.dueDate) - Date.parse(today)) / 86400000);
          if (r.status === 'Paid') return '<span class="text-good">paid</span>';
          if (d < 0) return '<span class="text-bad">' + Math.abs(d) + 'd overdue</span>';
          if (d <= 7) return '<span class="text-warn">' + d + 'd away</span>';
          return '<span class="text-mute">' + d + 'd away</span>';
        } },
      { key: 'status', label: 'Status', badge: { Paid: 'good', Pending: 'warn', Cancelled: '' } },
      { key: 'amount', label: 'Amount', num: true, render: function (r) { return ui.money(r.amount); } }
    ],
    rows: rows,
    searchKeys: ['id', 'title', 'desc', 'party'],
    filters: [{ key: 'status', label: 'Status' }],
    exportName: 'woodart-schedules.csv',
    pageSize: 12,
    empty: { icon: 'calendar2-week', title: 'Nothing scheduled', hint: 'Promised payments appear here.' }
  }).el);

  mountScreen(page, s);
}

/* ============================================================================
   SCREENS · PAYROLL and MANAGE CASH — the SHARED desks.

   Both already take a company id, so Woodart runs the same code Travels runs.
   If the kit is missing the screen says so rather than rendering an empty page
   that looks like "no data".
   ========================================================================= */
function deskScreen(page, deskFn) {
  var s = screen('desk');
  var host = fill(s, 'desk');
  var ok = typeof deskFn === 'function';
  when(s, 'missing', !ok);
  if (ok) deskFn(host, CID);
  mountScreen(page, s);
}

function payrollScreen(page) { deskScreen(page, EPAL.payrollDesk); }
function cashScreen(page) { deskScreen(page, EPAL.cashDesk); }

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
    danger: true,
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

function editRecurring(rec) {
  var isNew = !rec;
  EPAL.formModal({
    title: isNew ? 'New Recurring Cost' : 'Edit · ' + rec.id,
    icon: 'arrow-repeat',
    size: 'md',
    record: rec || { status: 'Active', method: 'Bank', dayOfMonth: 1 },
    fields: [
      { key: 'name', label: 'What', type: 'text', required: true, placeholder: 'e.g. Workshop rent — Tejgaon' },
      { key: 'category', label: 'Head', type: 'select', required: true, col2: true, searchable: true,
        options: Books.categories('Expense') },
      { key: 'amount', label: 'Amount (৳)', type: 'number', required: true, min: 1, col2: true },
      { key: 'party', label: 'Paid To', type: 'text', col2: true },
      { key: 'dayOfMonth', label: 'Day of Month', type: 'number', min: 1, max: 31, col2: true,
        hint: 'Which day the bill falls due.' },
      { key: 'method', label: 'Method', type: 'select', col2: true, options: Books.methods() },
      { key: 'status', label: 'Status', type: 'select', col2: true, options: ['Active', 'Paused'],
        hint: 'Paused keeps the record but stops counting it in the monthly commitment.' }
    ],
    saveLabel: isNew ? 'Add' : 'Save Changes',
    onSave: function (v) {
      Books.saveRecurring(v);
      ui.toast(isNew ? 'Recurring cost added' : v.id + ' updated', 'success');
      EPAL.router.render();
      return true;
    }
  });
}

function deleteRecurring(row) {
  ui.confirm({
    title: 'Delete ' + row.id + '?',
    body: 'The standing cost "' + (row.name || '') + '" will be removed. Entries already ' +
      'recorded against it stay in the register — this only stops it being counted as a ' +
      'future commitment.',
    danger: true,
    confirmLabel: 'Delete'
  }).then(function (ok) {
    if (!ok) return;
    Books.removeRecurring(row.id);
    ui.toast(row.id + ' deleted', 'success');
    EPAL.router.render();
  });
}

/* ============================================================================
   ROUTE
   ========================================================================= */
var SCREENS = {
  overview: overviewScreen, income: incomeScreen, expenses: expensesScreen,
  payables: payablesScreen, pnl: pnlScreen, payroll: payrollScreen,
  recurring: recurringScreen, banks: banksScreen, cash: cashScreen,
  journals: journalsScreen, schedules: schedulesScreen
};

EPAL.view(ROUTE, {
  title: function () { return 'Accounts'; },
  render: function (ctx) {
    var sub = ctx.subId || 'overview';
    if (!SCREENS[sub]) sub = 'overview';

    var page = el('div.page');
    page.appendChild(head(sub));
    page.appendChild(tabs(sub));

    SCREENS[sub](page);

    ctx.mount.appendChild(page);
  }
});
