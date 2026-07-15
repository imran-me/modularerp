/* ============================================================================
 * EPAL GROUP ERP  ·  companies/travels/modules/accounts/view.js
 * ----------------------------------------------------------------------------
 * TRAVELS — ACCOUNTS. The money desk of the travel house: day-to-day income &
 * expense journal, the double-entry journal poster (into the real GL), and the
 * payable / receivable payment-schedule tracker. ONE registered view branches on
 * ctx.subId (pill-tabs), and — because the router prefers a specific view over the
 * shared "star-slash-accounts" wildcard — this Travels-only screen supersedes the
 * generic one WITHOUT touching any other company.
 *
 *   (overview)  → cockpit: Income / Expense / Net / Cash KPIs, an Action Center
 *                 (overdue + due-soon schedules, top expense head, low cash),
 *                 monthly Income-vs-Expense trend, expense-by-head & method mix,
 *                 and the recent-entries register.
 *   income      → Income register (chips by head) + KPIs + top heads.
 *   expenses    → Expense register (chips by head) + KPIs + top heads.
 *   journals    → post a BALANCED double-entry journal via EPAL.ledger + recent GL.
 *   schedules   → payable / receivable schedule tracker (chips, mark-paid, ageing).
 *
 * DATA (localStorage, seeded in platform/data/seed-bd.js):
 *   acc_entries    { id, companyId, date, kind:'Income'|'Expense', category,
 *                    method, desc, amount, party?, ref?, created }
 *   acc_schedules  { id, companyId, party, kind:'Payable'|'Receivable',
 *                    amount, due, status:'Paid'|'Partial'|'Pending', desc? }
 *   gl_entries     the double-entry ledger (EPAL.ledger) — quick entries mirror here.
 *
 * Every quick entry mirrors into the double-entry ledger (upsert by a stable GL id)
 * so Travels + Group finance stay reconciled. Never write a literal star-slash in
 * this comment block — it would close the comment.
 * ==> LARAVEL: AccountEntry + PaymentSchedule Eloquent models; JournalController
 *     posting through the LedgerService; a Blade view per tab.
 * ==========================================================================*/

(function (EPAL) {
  'use strict';
  var ui = EPAL.ui, el = ui.el, db = EPAL.db, S = EPAL.store;

  var CID = 'travels';
  var TODAY = new Date(2026, 6, 5);                 // demo "today" = 2026-07-05
  var TODAY_STR = '2026-07-05';
  // Payment sources — Debit Card and Credit Card are SEPARATE sources from a bank
  // transfer (checklist 06 clarification); 'Card' kept for legacy records.
  var METHODS = ['Bank', 'Cash', 'bKash', 'Nagad', 'Debit Card', 'Credit Card', 'Cheque'];
  // Common Bangladeshi travel-agency posting heads — offered on the form, but the
  // field stays free-text so bookkeepers can add their own.
  var INCOME_HEADS = ['Air Ticket', 'Visa Service', 'Package Tour', 'Umrah / Hajj', 'Hotel Booking',
    'Insurance', 'Service Charge', 'Commission', 'Other Income'];
  var EXPENSE_HEADS = ['Office Rent', 'Staff Salary', 'Utilities', 'Marketing', 'Airline / GSA Payment',
    'Bank Charge', 'ADM / Penalty', 'Travel & Conveyance', 'Printing & Stationery', 'Software / GDS', 'Other Expense'];
  var SCHEDULE_KINDS = ['Payable', 'Receivable'];
  var SCHEDULE_STATUS = ['Pending', 'Partial', 'Paid'];

  // seed a little recurring-expense + cheque demo data (idempotent; survives db.reset)
  EPAL.registerEngine({ name: 'travels-accounts-seed', seed: function () {
    S.seedOnce('tv_recurring', [
      { id: 'REC-RENT', companyId: CID, category: 'Office Rent', amount: 85000, dayOfMonth: 1, method: 'Bank', party: 'Landlord', active: true },
      { id: 'REC-NET', companyId: CID, category: 'Internet & Utilities', amount: 12000, dayOfMonth: 5, method: 'Bank', party: 'ISP / DESCO', active: true }
    ]);
    S.seedOnce('tv_cheques', [
      { id: 'CHQ-1', companyId: CID, type: 'Issued', number: 'A-4471209', bank: 'City Bank', party: 'Biman Bangladesh', amount: 249000, date: '2026-07-02', dueDate: '2026-07-15', status: 'Pending' },
      { id: 'CHQ-2', companyId: CID, type: 'Received', number: 'B-8830112', bank: 'BRAC Bank', party: 'Concord Group', amount: 279000, date: '2026-06-28', dueDate: '2026-07-08', status: 'Cleared' }
    ]);
    S.seedOnce('tv_petty', [
      { id: 'PC-1', companyId: CID, staff: 'Naeem Chowdhury', amount: 5000, purpose: 'Office supplies & courier', date: '2026-07-03', status: 'Open' },
      { id: 'PC-2', companyId: CID, staff: 'Rafiul Islam', amount: 3000, purpose: 'Client refreshments', date: '2026-06-29', status: 'Settled', category: 'Travel & Conveyance', billAmount: 2650, billNo: 'BR-118', settledDate: '2026-07-01' }
    ]);
  } });

  /* ==========================================================================
   * DATA ACCESSORS
   * ========================================================================*/
  function entries() { return db.col('acc_entries').filter(function (e) { return e.companyId === CID; }); }
  function schedules() { return db.col('acc_schedules').filter(function (s) { return s.companyId === CID; }); }

  function sum(list, pred) { return list.reduce(function (a, e) { return a + (pred ? (pred(e) ? (+e.amount || 0) : 0) : (+e.amount || 0)); }, 0); }
  function incomeTotal() { return sum(entries(), function (e) { return e.kind === 'Income'; }); }
  function expenseTotal() { return sum(entries(), function (e) { return e.kind === 'Expense'; }); }

  // Cash / bank position straight from the double-entry ledger (account 1010,
  // an asset → balance() returns Dr − Cr on its normal side), falling back to
  // income − expense if the ledger engine is unavailable.
  function cashPosition() {
    try { if (EPAL.ledger && EPAL.ledger.balance) return EPAL.ledger.balance('1010', { companyId: CID }); } catch (e) {}
    return incomeTotal() - expenseTotal();
  }

  // Group a list of entries by a key → [{ label, value, pct }] sorted desc.
  function groupBy(list, key) {
    var map = {}, total = 0;
    list.forEach(function (e) { var k = e[key] || '—'; map[k] = (map[k] || 0) + (+e.amount || 0); total += (+e.amount || 0); });
    return Object.keys(map).map(function (k) { return { label: k, value: map[k], pct: total ? Math.round(map[k] / total * 100) : 0 }; })
      .sort(function (a, b) { return b.value - a.value; });
  }

  // Party name cell: when the party is an EMPLOYEE (payroll postings use the emp id,
  // people may also type the name), render the universal clickable profile link.
  function partyCell(party, strong) {
    if (!party) return '—';
    if (EPAL.people && EPAL.people.resolve && EPAL.people.resolve(party)) {
      var emp = EPAL.people.resolve(party);
      return EPAL.people.linkify(emp.name, emp.id);
    }
    return strong ? '<span class="strong">' + esc(party) + '</span>' : esc(party);
  }
  function daysTo(str) { var d = new Date(str); if (isNaN(d)) return 0; return Math.floor((d.getTime() - TODAY.getTime()) / 86400000); }
  function openSchedules() { return schedules().filter(function (s) { return s.status !== 'Paid'; }); }
  function overdueSchedules() { return openSchedules().filter(function (s) { return daysTo(s.due) < 0; }); }
  function dueSoon(n) { return openSchedules().filter(function (s) { var d = daysTo(s.due); return d >= 0 && d <= (n || 7); }); }

  /* ==========================================================================
   * VIEW ENTRY — one registered view, branches on the sub (pill-tab).
   * ========================================================================*/
  EPAL.view('travels/accounts', {
    render: function (ctx) {
      var sub = ctx.subId || 'overview';
      if (['overview', 'income', 'expenses', 'payroll', 'journals', 'schedules', 'recurring', 'cheques', 'cashbook', 'pettycash'].indexOf(sub) < 0) sub = 'overview';
      var page = el('div.page');

      var titles = { overview: 'Accounts', income: 'Income', expenses: 'Expenses', payroll: 'Payroll', journals: 'Journals', schedules: 'Payment Schedules', recurring: 'Recurring Expenses', cheques: 'Cheque Register', cashbook: 'Cash Book', pettycash: 'Petty Cash' };
      var subs = { overview: 'Income, expenses, journals and payment schedules for Epal Travels.',
        income: 'Every rupee earned — by head, method and month.', expenses: 'Every rupee spent — controlled by head and method.',
        journals: 'Post balanced double-entry journals straight into the general ledger.',
        schedules: 'Payables and receivables with due dates, ageing and settlement.',
        recurring: 'Rent, internet and other monthly costs — auto-created on their day each month.',
        cheques: 'Issued and received cheques with clearing status (pending / cleared / bounced).',
        cashbook: 'Every cash & bank movement, dated, with a running balance — straight from the ledger.',
        pettycash: 'Petty-cash IOU slips to staff and their settlement against bills.',
        payroll: 'Salary template, monthly run, loans, payslips & advances — posted to the ledger.' };

      page.appendChild(EPAL.pageHead({
        eyebrow: sub === 'overview' ? 'Epal Travels' : 'Travels › Accounts',
        icon: 'cash-stack', title: titles[sub], sub: subs[sub],
        actions: [
          canCreate() && ['overview', 'income', 'expenses'].indexOf(sub) >= 0
            ? el('button.btn.btn-ghost', { html: ui.icon('journal-plus') + ' New Entry', onclick: function () { entryForm(null); } }) : null,
          canCreate() && sub === 'schedules'
            ? el('button.btn.btn-ghost', { html: ui.icon('calendar2-plus') + ' New Schedule', onclick: function () { scheduleForm(null); } }) : null,
          canCreate() && sub === 'recurring'
            ? el('button.btn.btn-ghost', { html: ui.icon('arrow-repeat') + ' New Recurring', onclick: function () { recurringForm(null); } }) : null,
          canCreate() && sub === 'cheques'
            ? el('button.btn.btn-ghost', { html: ui.icon('bank') + ' New Cheque', onclick: function () { chequeForm(null); } }) : null,
          canCreate() && sub === 'pettycash'
            ? el('button.btn.btn-ghost', { html: ui.icon('cash') + ' Give IOU', onclick: function () { pettyForm(null); } }) : null,
          el('a.btn.btn-primary', { href: '#/travels/ledgers', html: ui.icon('journal-text') + ' Ledgers' })
        ]
      }));

      // pill-tab navigation across the accounts sub-screens
      var pills = el('div.pill-tab.mb-3');
      [['overview', 'Overview'], ['income', 'Income'], ['expenses', 'Expenses'], ['payroll', 'Payroll'], ['recurring', 'Recurring'], ['cheques', 'Cheques'], ['cashbook', 'Cash Book'], ['pettycash', 'Petty Cash'], ['journals', 'Journals'], ['schedules', 'Schedules']].forEach(function (p) {
        pills.appendChild(el('button' + (sub === p[0] ? '.active' : ''), { text: p[1],
          onclick: function () { EPAL.router.navigate('travels/accounts' + (p[0] === 'overview' ? '' : '/' + p[0])); } }));
      });
      page.appendChild(pills);
      // AUDIT P2: the period lock is VISIBLE wherever money is handled
      var lockYm = (EPAL.ledger && EPAL.ledger.lockedThrough) ? EPAL.ledger.lockedThrough() : null;
      if (lockYm) page.appendChild(el('div.mb-2', null, [
        el('span.badge.badge-warn', { html: ui.icon('lock-fill') + ' Books locked through ' + ui.escapeHtml(lockYm) + ' — back-dated entries are blocked' })
      ]));

      ({ overview: overview, income: incomeView, expenses: expenseView, journals: journalsView, schedules: schedulesView, recurring: recurringView, cheques: chequesView, cashbook: cashBookView, pettycash: pettyView,
         payroll: function (p) { if (EPAL.payrollDesk) EPAL.payrollDesk(p, CID); else p.appendChild(el('div.card', null, [el('div.card-body', { text: 'Payroll desk unavailable.' })])); } }[sub] || overview)(page);
      ctx.mount.appendChild(page);
    }
  });

  /* ======================================================= OVERVIEW (cockpit) */
  function overview(page) {
    var inc = incomeTotal(), exp = expenseTotal(), net = inc - exp;
    var cash = cashPosition();
    var open = openSchedules(), overdue = overdueSchedules();
    var outstanding = open.reduce(function (a, s) { return a + (+s.amount || 0); }, 0);

    page.appendChild(el('div.kpi-grid.kpi-compact.stagger', null, [
      kpiDrill('Income', ui.money(inc, { compact: true }), 'arrow-down-left-circle', 'travels/accounts/income'),
      kpiDrill('Expenses', ui.money(exp, { compact: true }), 'arrow-up-right-circle', 'travels/accounts/expenses'),
      kpi('Net Result', ui.money(net, { compact: true }), net >= 0 ? 'graph-up-arrow' : 'graph-down-arrow', net >= 0 ? 'text-good' : 'text-bad'),
      kpi('Cash & Bank', ui.money(cash, { compact: true }), 'bank2'),
      kpiDrill('Open Schedules', String(open.length), 'calendar2-week', 'travels/accounts/schedules', ui.money(outstanding, { compact: true }) + ' outstanding'),
      kpi('Overdue', ui.money(overdue.reduce(function (a, s) { return a + (+s.amount || 0); }, 0), { compact: true }), 'exclamation-triangle', overdue.length ? 'text-bad' : '')
    ]));

    // ---- Action Center — what the money desk must act on TODAY -------------
    var actions = [];
    overdue.slice(0, 4).forEach(function (s) {
      actions.push({ tone: 'error', icon: 'exclamation-octagon-fill',
        text: '<strong>' + esc(s.party) + '</strong> ' + (s.kind === 'Payable' ? 'payable' : 'receivable') + ' ' + ui.money(s.amount) + ' overdue by ' + Math.abs(daysTo(s.due)) + 'd',
        go: 'travels/accounts/schedules' });
    });
    dueSoon(7).slice(0, 3).forEach(function (s) {
      actions.push({ tone: 'warning', icon: 'clock-history',
        text: '<strong>' + esc(s.party) + '</strong> ' + s.kind.toLowerCase() + ' ' + ui.money(s.amount) + ' due in ' + daysTo(s.due) + 'd',
        go: 'travels/accounts/schedules' });
    });
    var topExp = groupBy(monthEntries(entries(), curYm()).filter(function (e) { return e.kind === 'Expense'; }), 'category')[0];
    if (topExp) actions.push({ tone: 'info', icon: 'pie-chart-fill',
      text: 'Biggest expense head this month: <strong>' + esc(topExp.label) + '</strong> · ' + ui.money(topExp.value),
      go: 'travels/accounts/expenses' });
    if (cash < 100000) actions.push({ tone: 'error', icon: 'wallet2',
      text: '<strong>Low cash.</strong> Cash & bank position is ' + ui.money(cash) + ' — review upcoming payables.', go: 'travels/accounts/schedules' });

    page.appendChild(el('div.section-label', { text: 'Action Center — needs attention' }));
    if (actions.length) {
      page.appendChild(el('div.card', null, [ el('div.card-body', null, actions.map(function (a) {
        return el('div.data-row', { style: { cursor: 'pointer' }, onclick: (function (go) { return function () { EPAL.router.navigate(go); }; })(a.go) }, [
          ui.frag('<span class="notif-ico notif-' + a.tone + '">' + ui.icon(a.icon) + '</span>'),
          el('div.flex-1', { html: a.text }),
          ui.frag('<span class="text-mute">' + ui.icon('chevron-right') + '</span>')
        ]);
      })) ]));
    } else {
      page.appendChild(el('div.build-banner.mb-3', null, [ ui.frag(ui.icon('check-circle-fill')),
        el('div', { html: '<strong>All clear.</strong> No overdue or imminent settlements — the books are current.' }) ]));
    }

    // ---- charts: monthly income vs expense + expense mix + method mix ------
    page.appendChild(el('div.section-label', { text: 'Cash Movement' }));
    var trendId = ui.uid('acc-trend'), mixId = ui.uid('acc-mix'), methId = ui.uid('acc-meth');
    page.appendChild(el('div.grid-auto', null, [
      chartCard('Income vs Expense — monthly', 'activity', trendId, 'last 8 months', 250),
      chartCard('Expense by Head', 'pie-chart', mixId, 'where the money goes', 250)
    ]));
    var methods = groupBy(entries(), 'method');
    page.appendChild(chartCard('Payment Method Mix', 'credit-card', methId, 'income + expense by channel', 220));

    requestAnimationFrame(function () {
      var months = lastYm(8);
      var incS = months.map(function (ym) { return monthSum(entries(), ym, 'Income'); });
      var expS = months.map(function (ym) { return monthSum(entries(), ym, 'Expense'); });
      var c1 = document.getElementById(trendId);
      if (c1) EPAL.charts.bar(c1, { labels: months.map(mLabel), legend: true,
        datasets: [{ label: 'Income', data: incS, color: '#23c17e' }, { label: 'Expense', data: expS, color: '#f0506e' }] });
      var mix = groupBy(entries().filter(function (e) { return e.kind === 'Expense'; }), 'category').slice(0, 7);
      var c2 = document.getElementById(mixId);
      if (c2 && mix.length) EPAL.charts.doughnut(c2, { labels: mix.map(function (m) { return m.label; }), data: mix.map(function (m) { return m.value; }) });
      var c3 = document.getElementById(methId);
      if (c3 && methods.length) EPAL.charts.bar(c3, { labels: methods.map(function (m) { return m.label; }), horizontal: true, money: true,
        datasets: [{ label: 'Volume', data: methods.map(function (m) { return m.value; }) }] });
    });

    // ---- recent entries register ------------------------------------------
    page.appendChild(el('div.section-label', { text: 'Recent Entries' }));
    page.appendChild(el('div.card', null, [ el('div.card-body', null, [ entriesTable(entries(), null) ]) ]));
  }

  /* ======================================================= INCOME / EXPENSES */
  function incomeView(page) { kindRegister(page, 'Income', INCOME_HEADS, '#23c17e'); }
  function expenseView(page) { kindRegister(page, 'Expense', EXPENSE_HEADS, '#f0506e'); }

  function kindRegister(page, kind, heads, color) {
    var list = entries().filter(function (e) { return e.kind === kind; });
    var total = list.reduce(function (a, e) { return a + (+e.amount || 0); }, 0);
    var thisMonth = monthSum(list, curYm(), kind);
    var heads2 = groupBy(list, 'category');
    var avg = list.length ? Math.round(total / list.length) : 0;

    page.appendChild(el('div.kpi-grid.kpi-compact.stagger', null, [
      kpi('Total ' + kind, ui.money(total, { compact: true }), kind === 'Income' ? 'arrow-down-left-circle' : 'arrow-up-right-circle', kind === 'Income' ? 'text-good' : 'text-bad'),
      kpi('This Month', ui.money(thisMonth, { compact: true }), 'calendar3'),
      kpi('Entries', String(list.length), 'card-list'),
      kpi('Average', ui.money(avg, { compact: true }), 'graph-up'),
      kpi('Top Head', heads2[0] ? heads2[0].label : '—', 'trophy')
    ]));

    // clickable head chips — biggest posting heads, tap to filter the register
    if (heads2.length) {
      page.appendChild(el('div.section-label.mt-0', { text: kind + ' Heads — tap to filter' }));
      var chipWrap = el('div.grid-auto.kpi-compact.stagger.mb-3');
      var selected = null, tableRef = null;
      heads2.slice(0, 8).forEach(function (h) {
        chipWrap.appendChild(el('button.card.tier-card', { type: 'button', onclick: function () {
          selected = selected === h.label ? null : h.label;
          if (tableRef) { tableRef.state.filters.category = selected || '__all'; tableRef.state.page = 0; tableRef.refresh(); }
          Array.prototype.forEach.call(chipWrap.children, function (c) { c.classList.remove('active'); });
          if (selected) this.classList.add('active');
        } }, [ el('div.card-pad', null, [
          el('div.flex.items-center.gap-2', null, [
            el('span', { style: { width: '10px', height: '10px', borderRadius: '99px', background: color, display: 'inline-block' } }),
            el('div.flex-1', null, [ el('div.fw-700', { text: h.label }), el('div.text-mute.sm', { text: h.pct + '% of ' + kind.toLowerCase() }) ]),
            el('span.badge', { text: ui.money(h.value, { compact: true }) }) ])
        ]) ]));
      });
      page.appendChild(chipWrap);
      page.appendChild(el('div.card', null, [ el('div.card-body', null, [ (tableRef = entriesTable(list, kind)) && tableRef.el ]) ]));
    } else {
      page.appendChild(el('div.card', null, [ el('div.card-body', null, [ entriesTable(list, kind).el ]) ]));
    }
  }

  // The entries datatable — chips by head, filter card, PDF, row-click rich detail,
  // canonical row actions (edit · delete │ print). Returns the table instance.
  function entriesTable(rows, kind) {
    var t = EPAL.table({
      columns: [
        { key: 'id', label: 'JV', render: function (e) { return '<span class="mono xs text-mute">' + esc(e.id) + '</span>'; } },
        { key: 'date', label: 'Date', date: true },
        { key: 'kind', label: 'Kind', badge: { Income: 'good', Expense: 'bad' } },
        { key: 'category', label: 'Head', render: function (e) { return '<span class="strong">' + esc(e.category || '—') + '</span>'; } },
        { key: 'desc', label: 'Description', render: function (e) { return esc(e.desc || '—'); } },
        { key: 'method', label: 'Method', badge: {} },
        { key: 'amount', label: 'Amount', num: true, render: function (e) {
            return '<span class="num ' + (e.kind === 'Income' ? 'text-good' : 'text-bad') + '">' + ui.money(e.amount) + '</span>'; }, sortVal: function (e) { return +e.amount || 0; } }
      ],
      rows: rows, dateKey: 'date',
      quickFilter: 'category', filterPanel: true,
      filters: kind ? [{ key: 'method', label: 'Method' }] : [{ key: 'kind', label: 'Kind' }, { key: 'method', label: 'Method' }],
      searchKeys: ['id', 'category', 'desc', 'method', 'party'],
      pageSize: 12, exportName: 'travels-' + (kind ? kind.toLowerCase() : 'accounts') + '.csv', pdfTitle: 'Travels ' + (kind || 'Accounts') + ' Register',
      onRow: function (e) { entryDetail(e); },
      actions: ui.actions({
        edit:  canCreate() ? function (e) { entryForm(e); } : null,
        del:   canDelete() ? function (e) { deleteEntry(e); } : null,
        print: function (e) { printEntry(e); }
      }),
      empty: { icon: 'journal', title: 'No entries yet', hint: 'Record income or an expense to start the register.' }
    });
    return t;
  }

  /* ---- rich entry detail (row-click) ------------------------------------*/
  function entryDetail(e) {
    var body = el('div');
    ui.modal({ title: (e.category || 'Entry') + ' · ' + e.id, icon: e.kind === 'Income' ? 'arrow-down-left-circle' : 'arrow-up-right-circle', size: 'lg', body: body, footer: false });
    var actions = el('div.flex.gap-1.items-center.flex-wrap', { style: { marginLeft: 'auto' } });
    if (canCreate()) actions.appendChild(el('button.btn.btn-sm.btn-outline', { html: ui.icon('pencil') + ' Edit', onclick: function () { entryForm(e); } }));
    actions.appendChild(el('button.btn.btn-sm.btn-primary', { html: ui.icon('printer') + ' Voucher', onclick: function () { printEntry(e); } }));

    body.appendChild(el('div.card', null, [ el('div.card-body', null, [
      el('div.flex.items-center.gap-2.flex-wrap.mb-3', null, [
        ui.frag('<span class="notif-ico notif-' + (e.kind === 'Income' ? 'success' : 'error') + '">' + ui.icon(e.kind === 'Income' ? 'cash-coin' : 'cart-dash') + '</span>'),
        el('div.flex-1', { style: { minWidth: '180px' } }, [
          el('div.fw-700', { style: { fontSize: '17px' }, text: e.category || 'Entry' }),
          el('div.flex.items-center.gap-2.flex-wrap', null, [
            el('span.badge.badge-' + (e.kind === 'Income' ? 'good' : 'bad'), { text: e.kind }),
            el('span.badge', { text: e.method || '—' }),
            el('div.text-mute.sm', { text: ui.date(e.date) })
          ]) ]),
        actions
      ]),
      el('div.stat-row', null, [
        st2('Amount', ui.money(e.amount)), st2('Kind', e.kind), st2('Method', e.method || '—'), st2('Date', ui.date(e.date))
      ]),
      e.party ? el('div.data-list.mt-2', null, [ drow('Party', e.party), drow('Reference', e.ref) ]) : null,
      e.desc ? el('p.text-mute.mt-2', { text: e.desc }) : null
    ]) ]));

    // the double-entry posting this quick entry mirrored into the GL
    var gl = glFor(e);
    if (gl) {
      var lt = EPAL.table({
        columns: [ { key: 'account', label: 'Account' }, { key: 'debit', label: 'Debit', num: true, money: true }, { key: 'credit', label: 'Credit', num: true, money: true } ],
        rows: (gl.lines || []).map(function (l) { var a = EPAL.ledger.account ? EPAL.ledger.account(l.account) : null; return { account: l.account + (a ? ' · ' + a.name : ''), debit: +l.dr || 0, credit: +l.cr || 0 }; }),
        empty: { icon: 'journal', title: 'No ledger lines' }
      });
      body.appendChild(el('div.card', null, [ el('div.card-head', null, [ el('h3', { html: ui.icon('journal-text') + ' Ledger Posting' }), el('span.card-sub', { text: gl.id }) ]), el('div.card-body', null, [ lt.el ]) ]));
    }
    if (EPAL.comments && EPAL.comments.widget) { body.appendChild(el('div.section-label', { text: 'Notes & Discussion' })); body.appendChild(EPAL.comments.widget('acc-entry', e.id)); }
  }
  function glFor(e) {
    try { if (EPAL.ledger && EPAL.ledger.entries) return EPAL.ledger.entries({ companyId: CID }).filter(function (g) { return g.id === 'GL-ACC-' + e.id || g.ref === e.id; })[0]; } catch (x) {}
    return null;
  }

  /* ---- rich add / edit entry form ---------------------------------------*/
  function entryForm(rec) {
    var isNew = !rec;
    var kind = (rec && rec.kind) || 'Expense';
    EPAL.formModal({
      title: isNew ? 'New Journal Entry' : 'Edit Entry', icon: 'journal-plus', size: 'md', record: rec || { kind: kind, date: TODAY_STR },
      fields: [
        { type: 'section', label: 'Entry' },
        { key: 'kind', label: 'Kind', type: 'select', options: ['Income', 'Expense'], default: kind, required: true },
        { key: 'amount', label: 'Amount (৳)', type: 'money', required: true, min: 1 },
        { key: 'category', label: 'Head / Category', type: 'text', required: true, placeholder: 'e.g. Air Ticket, Office Rent',
          hint: 'Income: ' + INCOME_HEADS.slice(0, 4).join(', ') + '… · Expense: ' + EXPENSE_HEADS.slice(0, 4).join(', ') + '…' },
        { key: 'method', label: 'Method', type: 'select', options: METHODS, default: 'Bank', required: true },
        { key: 'date', label: 'Date', type: 'date', required: true, default: TODAY_STR },
        { type: 'section', label: 'Reference' },
        { key: 'party', label: 'Party (optional)', type: 'text', placeholder: 'Customer / vendor / staff' },
        { key: 'ref', label: 'Reference / voucher no', type: 'text', placeholder: 'e.g. INV-2201, cheque no' },
        { key: 'desc', label: 'Description', type: 'textarea', col2: true, placeholder: 'What is this entry for?' }
      ],
      saveLabel: isNew ? 'Post Entry' : 'Save',
      onSave: function (val) {
        var amt = +val.amount || 0;
        if (amt <= 0) { ui.toast('Enter a valid amount', 'error'); return false; }
        var r = rec || { id: 'JV-' + ui.uid('').slice(-6).toUpperCase(), companyId: CID, created: TODAY_STR };
        r.kind = val.kind; r.amount = amt; r.category = (val.category || '').trim(); r.method = val.method;
        r.date = val.date || TODAY_STR; r.party = val.party; r.ref = val.ref; r.desc = val.desc;
        db.save('acc_entries', r);
        mirrorToLedger(r);
        ui.toast('Entry ' + r.id + ' saved & posted to the ledger', 'success');
        EPAL.router.render();
        return true;
      }
    });
  }
  function deleteEntry(e) {
    // AUDIT P2 (immutability): the books never lose a posting. Deleting a
    // voucher posts an equal-and-opposite REVERSAL journal dated today; the
    // original + REV- pair stay in the ledger forever and net to zero, while
    // the voucher leaves the register.
    ui.confirm({ title: 'Delete entry ' + e.id + '?', text: 'The voucher leaves this register; its ledger posting is REVERSED (not erased) — the original and the reversal stay on the books for audit.', danger: true, confirmLabel: 'Delete & Reverse' })
      .then(function (ok) { if (!ok) return;
        db.remove('acc_entries', e.id);
        try {
          if (EPAL.ledger && EPAL.ledger.reverse) {
            var rev = EPAL.ledger.reverse('GL-ACC-' + e.id, { reason: 'Voucher ' + e.id + ' deleted' });
            if (rev) { ui.toast('Entry removed — ledger reversal ' + rev.id + ' posted', 'success'); EPAL.router.render(); return; }
          }
        } catch (x) { ui.toast(x.message || 'Reversal failed', 'error'); }
        ui.toast('Entry deleted', 'success'); EPAL.router.render(); });
  }
  function printEntry(e) {
    function r(k, v) { return '<tr><td>' + esc(k) + '</td><td>' + esc(String(v == null || v === '' ? '—' : v)) + '</td></tr>'; }
    ui.printDoc({ title: (e.kind === 'Income' ? 'Receipt Voucher' : 'Payment Voucher') + ' · ' + e.id,
      subtitle: 'Epal Travels & Consultancy', meta: e.kind + ' entry · ' + ui.date(e.date), footer: 'Accounts Department · Confidential',
      bodyHtml: '<table>' + r('Voucher No', e.id) + r('Date', ui.date(e.date)) + r('Kind', e.kind) + r('Head', e.category) +
        r('Method', e.method) + r('Party', e.party) + r('Reference', e.ref) + r('Description', e.desc) +
        '<tr><th>Amount</th><th>' + ui.money(e.amount) + '</th></tr></table>' });
  }

  /* --- mirror a single quick entry into the double-entry ledger -----------
   * Income  → DR 1010 Cash/Bank      / CR 4000 Revenue
   * Expense → DR 5xxx (by head)      / CR 1010 Cash/Bank
   * A stable GL id (GL-ACC-<id>) makes an edit re-post (upsert), never duplicate. */
  function mirrorToLedger(rec) {
    if (!EPAL.ledger || !EPAL.ledger.post) return;
    var amt = +rec.amount || 0; if (amt <= 0) return;
    var lines = rec.kind === 'Income'
      ? [ { account: '1010', dr: amt, cr: 0 }, { account: '4000', dr: 0, cr: amt } ]
      : [ { account: expenseAccountFor(rec.category), dr: amt, cr: 0 }, { account: '1010', dr: 0, cr: amt } ];
    try {
      EPAL.ledger.post({ id: 'GL-ACC-' + rec.id, date: rec.date, companyId: CID, ref: rec.id,
        memo: rec.desc || rec.category || (rec.kind + ' entry'), source: 'manual', party: rec.party || '', lines: lines });
    } catch (e) { /* mirror is best-effort — never block the quick entry */ }
  }
  // AUDIT FIX: the head mapping is owned by the ledger (one mapper for every
  // screen). The local copy defaulted misc spends into 5300 Utilities and
  // missed food/office/conveyance entirely — misclassifying the P&L by head.
  function expenseAccountFor(cat) {
    if (EPAL.ledger && EPAL.ledger.expenseAccountFor) return EPAL.ledger.expenseAccountFor(cat);
    return '5800';
  }

  /* ======================================================= JOURNALS (GL) */
  function journalsView(page) {
    var accts = (EPAL.ledger && EPAL.ledger.accounts) ? EPAL.ledger.accounts() : [];
    var acctOpts = accts.filter(function (a) { return a.active !== false; }).map(function (a) { return [a.code, a.code + ' · ' + a.name]; });

    var balStrip = el('div.flex.gap-2.items-center');
    var postBtn = el('button.btn.btn-primary', { disabled: true, html: ui.icon('journal-plus') + ' Post Journal' });

    function tally(rows) { var dr = 0, cr = 0; (rows || []).forEach(function (r) { dr += +r.debit || 0; cr += +r.credit || 0; }); return { dr: dr, cr: cr, diff: dr - cr }; }
    function refreshBalance(rows) {
      var t = tally(rows), ok = t.dr > 0.5 && Math.abs(t.diff) < 0.5;
      postBtn.disabled = !ok;
      balStrip.innerHTML = '';
      balStrip.appendChild(el('span.badge', { html: 'Dr ' + ui.money(t.dr) }));
      balStrip.appendChild(el('span.badge', { html: 'Cr ' + ui.money(t.cr) }));
      balStrip.appendChild(el('span.badge', { style: { color: ok ? '#23c17e' : '#f0506e' }, html: ok ? (ui.icon('check-circle-fill') + ' Balanced') : ('Δ ' + ui.money(Math.abs(t.diff))) }));
    }

    var form = EPAL.form([
      { key: 'date', label: 'Date', type: 'date', required: true, default: TODAY_STR },
      { key: 'ref', label: 'Reference', type: 'text', placeholder: 'e.g. JV/ADJ-001' },
      { key: 'party', label: 'Party (optional)', type: 'text', placeholder: 'Customer / vendor name' },
      { key: 'memo', label: 'Narration', type: 'text', col2: true, placeholder: 'What is this entry for?' },
      { key: 'lines', type: 'items', label: 'Journal Lines', required: true, min: 2, addLabel: 'Add line',
        columns: [
          { key: 'account', label: 'Account', type: 'select', width: '2.4fr', options: acctOpts },
          { key: 'debit', label: 'Debit', type: 'money', width: '1fr' },
          { key: 'credit', label: 'Credit', type: 'money', width: '1fr' }
        ],
        footer: function (rows) { var t = tally(rows); return 'Dr ' + ui.money(t.dr) + '  ·  Cr ' + ui.money(t.cr) + (t.dr > 0.5 && Math.abs(t.diff) < 0.5 ? '  ✓' : '  Δ ' + ui.money(Math.abs(t.diff))); },
        onChange: function (rows) { refreshBalance(rows); }
      }
    ], { lines: [{}, {}] });

    postBtn.addEventListener('click', function () {
      if (!EPAL.ledger || !EPAL.ledger.post) { ui.toast('Ledger engine unavailable', 'error'); return; }
      if (!form.validate()) { ui.toast('Please complete the journal', 'error'); return; }
      var v = form.values();
      var lines = (v.lines || []).filter(function (r) { return r.account && ((+r.debit || 0) > 0 || (+r.credit || 0) > 0); })
        .map(function (r) { return { account: r.account, dr: +r.debit || 0, cr: +r.credit || 0 }; });
      if (lines.length < 2) { ui.toast('A journal needs at least two lines', 'error'); return; }
      try {
        EPAL.ledger.post({ date: v.date, companyId: CID, ref: v.ref || '', memo: v.memo || 'Manual journal', source: 'manual', party: v.party || '', lines: lines });
        ui.toast('Journal posted to the ledger', 'success'); EPAL.router.render();
      } catch (e) { ui.toast(e.message || 'Entry does not balance', 'error'); }
    });
    refreshBalance([]);

    page.appendChild(el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon('journal-plus') + ' New Double-Entry Journal' }), el('span.card-sub', { text: 'Debits must equal credits' }) ]),
      el('div.card-body', null, [ form.el, el('div.flex.justify-between.items-center.mt-2', null, [ balStrip, postBtn ]) ])
    ]));

    // recent GL entries for Travels (newest first)
    var glRows = (EPAL.ledger && EPAL.ledger.entries) ? EPAL.ledger.entries({ companyId: CID }).slice().reverse() : [];
    function glTotal(e) { var t = 0; (e.lines || []).forEach(function (l) { t += +l.dr || 0; }); return t; }
    var glTable = EPAL.table({
      columns: [
        { key: 'date', label: 'Date', date: true }, { key: 'id', label: 'JV' }, { key: 'ref', label: 'Reference' }, { key: 'memo', label: 'Narration' },
        { key: 'source', label: 'Source', badge: { sale: 'good', manual: 'info', opening: 'accent', payroll: 'warn', refund: 'bad' } },
        { key: 'party', label: 'Party', render: function (g) { return partyCell(g.party); } },
        { key: 'amount', label: 'Amount', num: true, sortVal: glTotal, render: function (e) { return '<span class="num">' + ui.money(glTotal(e)) + '</span>'; }, exportVal: function (e) { return glTotal(e); } }
      ],
      rows: glRows, searchKeys: ['id', 'ref', 'memo', 'party', 'source'], quickFilter: 'source', filterPanel: true, dateKey: 'date',
      totalKey: 'amount',   // filter Source = Salary (or anything) → live filtered total
      exportName: 'travels-gl-entries.csv', pdfTitle: 'Travels Ledger Entries',
      onRow: function (e) { showEntry(e); },
      empty: { icon: 'journal-text', title: 'No ledger entries yet — post one above' }
    });
    page.appendChild(el('div.section-label', { text: 'Recent Ledger Entries' }));
    page.appendChild(el('div.card', null, [ el('div.card-body', null, [ glTable.el ]) ]));

    function showEntry(e) {
      var lines = (e.lines || []).map(function (l) { var a = EPAL.ledger.account(l.account); return { account: l.account + ' · ' + (a ? a.name : ''), debit: +l.dr || 0, credit: +l.cr || 0 }; });
      var lt = EPAL.table({
        columns: [ { key: 'account', label: 'Account' }, { key: 'debit', label: 'Debit', num: true, money: true }, { key: 'credit', label: 'Credit', num: true, money: true } ],
        rows: lines, empty: { icon: 'journal', title: 'No lines' }
      });
      ui.modal({ title: 'Journal ' + e.id, icon: 'journal-text', size: 'lg',
        body: el('div', null, [ el('div.text-mute.sm.mb-2', { text: ui.date(e.date) + ' · ' + (e.memo || '') + (e.party ? ' · ' + e.party : '') }), lt.el ]),
        actions: [{ label: 'Close', variant: 'ghost' }] });
    }
  }

  /* ======================================================= SCHEDULES */
  function schedulesView(page) {
    var list = schedules();
    var payable = list.filter(function (s) { return s.kind === 'Payable' && s.status !== 'Paid'; }).reduce(function (a, s) { return a + (+s.amount || 0); }, 0);
    var receivable = list.filter(function (s) { return s.kind === 'Receivable' && s.status !== 'Paid'; }).reduce(function (a, s) { return a + (+s.amount || 0); }, 0);
    var overdue = overdueSchedules();
    var soon = dueSoon(7);

    // Upcoming 15 days — FIRST, above everything (checklist 06: "shobar age/upore")
    var in15 = dueSoon(15);
    var sum15 = in15.reduce(function (a, s) { return a + (+s.amount || 0); }, 0);
    page.appendChild(el('div.build-banner.mb-3', null, [ ui.frag(ui.icon('calendar-week')),
      el('div.flex-1', { html: '<strong>Upcoming 15 days: ' + in15.length + ' settlement' + (in15.length === 1 ? '' : 's') + ' · ' + ui.money(sum15) + '.</strong> ' +
        (in15.length ? in15.slice(0, 6).map(function (s) { return esc(s.party) + ' (' + ui.money(s.amount) + ' · ' + ui.date(s.due) + ')'; }).join(', ') + (in15.length > 6 ? ' …' : '') : 'Nothing due.') }) ]));

    page.appendChild(el('div.kpi-grid.kpi-compact.stagger', null, [
      kpi('Payable', ui.money(payable, { compact: true }), 'arrow-up-right-circle', payable ? 'text-bad' : ''),
      kpi('Receivable', ui.money(receivable, { compact: true }), 'arrow-down-left-circle', receivable ? 'text-good' : ''),
      kpi('Overdue', String(overdue.length), 'exclamation-triangle', overdue.length ? 'text-bad' : ''),
      kpi('Due ≤7 days', String(soon.length), 'clock-history', soon.length ? 'text-warn' : ''),
      kpi('Open Items', String(openSchedules().length), 'calendar2-week')
    ]));

    if (overdue.length) page.appendChild(el('div.build-banner.mb-3', null, [ ui.frag(ui.icon('exclamation-octagon-fill')),
      el('div', { html: '<strong>' + overdue.length + ' overdue settlement' + (overdue.length === 1 ? '' : 's') + '.</strong> ' +
        overdue.slice(0, 6).map(function (s) { return esc(s.party) + ' (' + ui.money(s.amount) + ')'; }).join(', ') + (overdue.length > 6 ? ' …' : '') }) ]));

    var t = EPAL.table({
      columns: [
        { key: 'id', label: 'Ref', render: function (s) { return '<span class="mono xs text-mute">' + esc(s.id) + '</span>'; } },
        { key: 'party', label: 'Party', render: function (s) { return partyCell(s.party, true); } },
        { key: 'kind', label: 'Type', badge: { Payable: 'bad', Receivable: 'good' } },
        { key: 'amount', label: 'Amount', num: true, money: true },
        { key: 'due', label: 'Due', sortVal: function (s) { return new Date(s.due).getTime() || 0; }, render: function (s) {
            var d = daysTo(s.due), tone = s.status === 'Paid' ? '' : d < 0 ? 'text-bad' : d <= 7 ? 'text-warn' : '';
            return '<span class="' + tone + '">' + ui.date(s.due) + (s.status !== 'Paid' && d < 0 ? ' · ' + Math.abs(d) + 'd late' : '') + '</span>'; } },
        { key: 'status', label: 'Status', badge: { Paid: 'good', Partial: 'warn', Pending: 'bad' } }
      ],
      rows: list, dateKey: 'due', totalKey: 'amount',
      quickFilter: 'kind', filterPanel: true, filters: [{ key: 'status', label: 'Status' }],
      searchKeys: ['id', 'party', 'desc'], pageSize: 12, exportName: 'travels-schedules.csv', pdfTitle: 'Travels Payment Schedules',
      onRow: function (s) { scheduleDetail(s); },
      actions: ui.actions({
        edit:  canCreate() ? function (s) { scheduleForm(s); } : null,
        del:   canDelete() ? function (s) { ui.confirm({ title: 'Delete schedule?', danger: true, confirmLabel: 'Delete' }).then(function (ok) { if (ok) { db.remove('acc_schedules', s.id); ui.toast('Deleted', 'success'); EPAL.router.render(); } }); } : null,
        print: function (s) { printSchedule(s); },
        wa:    function (s) { return { phone: s.phone, text: scheduleMsg(s) }; },
        gmail: function (s) { return { to: s.email, subject: 'Payment reminder — Epal Travels', body: scheduleMsg(s) }; }
      }),
      empty: { icon: 'calendar2-week', title: 'No schedules yet', hint: 'Add a payable or receivable to track it.' }
    });
    page.appendChild(el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon('calendar2-week') + ' Payment Schedules' }), el('span.card-sub', { text: list.length + ' items · click for detail' }) ]),
      el('div.card-body', null, [ t.el ])
    ]));
  }

  function scheduleDetail(s) {
    var body = el('div');
    var m = ui.modal({ title: s.party + ' · ' + s.id, icon: s.kind === 'Payable' ? 'arrow-up-right-circle' : 'arrow-down-left-circle', size: 'md', body: body, footer: false });
    var d = daysTo(s.due);
    var actions = el('div.flex.gap-1.items-center.flex-wrap', { style: { marginLeft: 'auto' } });
    if (canCreate() && s.status !== 'Paid') actions.appendChild(el('button.btn.btn-sm.btn-primary', { html: ui.icon('check2-circle') + ' Mark Paid', onclick: function () {
      s.status = 'Paid'; db.save('acc_schedules', s); ui.toast('Marked paid', 'success'); m.close(); EPAL.router.render(); } }));
    if (canCreate()) actions.appendChild(el('button.btn.btn-sm.btn-outline', { html: ui.icon('pencil') + ' Edit', onclick: function () { m.close(); scheduleForm(s); } }));
    actions.appendChild(ui.rowActions(ui.actions({
      wa: { phone: s.phone, text: scheduleMsg(s) }, gmail: { to: s.email, subject: 'Payment reminder — Epal Travels', body: scheduleMsg(s) }
    })));
    body.appendChild(el('div.card', null, [ el('div.card-body', null, [
      el('div.flex.items-center.gap-2.flex-wrap.mb-3', null, [
        ui.frag('<span class="notif-ico notif-' + (s.kind === 'Payable' ? 'error' : 'success') + '">' + ui.icon('calendar2-week') + '</span>'),
        el('div.flex-1', { style: { minWidth: '160px' } }, [ el('div.fw-700', { style: { fontSize: '17px' }, text: s.party }),
          el('div.flex.items-center.gap-2.flex-wrap', null, [ el('span.badge.badge-' + (s.kind === 'Payable' ? 'bad' : 'good'), { text: s.kind }),
            el('span.badge.badge-' + (s.status === 'Paid' ? 'good' : s.status === 'Partial' ? 'warn' : 'bad'), { text: s.status }) ]) ]),
        actions
      ]),
      el('div.stat-row', null, [ st2('Amount', ui.money(s.amount)), st2('Due', ui.date(s.due)),
        st2('Status', s.status), st2('Ageing', s.status === 'Paid' ? 'Settled' : d < 0 ? Math.abs(d) + 'd late' : 'in ' + d + 'd') ]),
      s.desc ? el('p.text-mute.mt-2', { text: s.desc }) : null
    ]) ]));
    if (EPAL.comments && EPAL.comments.widget) { body.appendChild(el('div.section-label', { text: 'Notes' })); body.appendChild(EPAL.comments.widget('acc-schedule', s.id)); }
  }
  function scheduleForm(rec) {
    var isNew = !rec;
    EPAL.formModal({
      title: isNew ? 'New Payment Schedule' : 'Edit Schedule', icon: 'calendar2-plus', size: 'md', record: rec || { status: 'Pending', due: TODAY_STR },
      fields: [
        { key: 'party', label: 'Party', type: 'text', required: true, col2: true, placeholder: 'Vendor / customer / staff' },
        { key: 'kind', label: 'Type', type: 'select', options: SCHEDULE_KINDS, default: 'Payable', required: true },
        { key: 'amount', label: 'Amount (৳)', type: 'money', required: true, min: 1 },
        { key: 'due', label: 'Due date', type: 'date', required: true, default: TODAY_STR },
        { key: 'status', label: 'Status', type: 'select', options: SCHEDULE_STATUS, default: 'Pending' },
        { key: 'phone', label: 'Contact phone', type: 'phone' },
        { key: 'email', label: 'Contact email', type: 'email' },
        { key: 'desc', label: 'Note', type: 'textarea', col2: true }
      ],
      saveLabel: isNew ? 'Add Schedule' : 'Save',
      onSave: function (val) {
        var r = rec || { id: 'SCH-' + ui.uid('').slice(-5).toUpperCase(), companyId: CID };
        r.party = (val.party || '').trim(); r.kind = val.kind; r.amount = +val.amount || 0; r.due = val.due;
        r.status = val.status || 'Pending'; r.phone = val.phone; r.email = val.email; r.desc = val.desc;
        db.save('acc_schedules', r);
        ui.toast('Schedule saved', 'success'); EPAL.router.render();
        return true;
      }
    });
  }
  function printSchedule(s) {
    function r(k, v) { return '<tr><td>' + esc(k) + '</td><td>' + esc(String(v == null || v === '' ? '—' : v)) + '</td></tr>'; }
    ui.printDoc({ title: 'Payment Schedule · ' + s.id, subtitle: 'Epal Travels & Consultancy', meta: s.kind + ' · ' + s.status, footer: 'Accounts Department',
      bodyHtml: '<table>' + r('Party', s.party) + r('Type', s.kind) + r('Due', ui.date(s.due)) + r('Status', s.status) + r('Note', s.desc) +
        '<tr><th>Amount</th><th>' + ui.money(s.amount) + '</th></tr></table>' });
  }
  function scheduleMsg(s) {
    return 'Dear ' + s.party + ',\n\n' + (s.kind === 'Payable' ? 'This is regarding our payable of ' : 'This is a gentle reminder for the receivable of ') +
      ui.money(s.amount) + ' due on ' + ui.date(s.due) + '.\n\nWarm regards,\nAccounts, Epal Travels & Consultancy';
  }

  /* ---------------------------------------------------- month / date helpers */
  function curYm() { return TODAY.getFullYear() + '-' + String(TODAY.getMonth() + 1).padStart(2, '0'); }
  function lastYm(n) { var out = []; for (var i = n - 1; i >= 0; i--) { var d = new Date(TODAY.getFullYear(), TODAY.getMonth() - i, 1); out.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')); } return out; }
  function mLabel(ym) { var p = ym.split('-'); return new Date(p[0], p[1] - 1, 1).toLocaleString('en', { month: 'short' }); }
  function monthEntries(list, ym) { return list.filter(function (e) { return String(e.date || '').indexOf(ym) === 0; }); }
  function monthSum(list, ym, kind) { return list.filter(function (e) { return String(e.date || '').indexOf(ym) === 0 && (!kind || e.kind === kind); }).reduce(function (a, e) { return a + (+e.amount || 0); }, 0); }

  /* ---------------------------------------------------- shared UI helpers */
  /* ======================================================= RECURRING EXPENSES (spec D4) */
  function recurring() { return db.col('tv_recurring').filter(function (r) { return r.companyId === CID; }); }
  function recurringDue() {
    var ym = TODAY_STR.slice(0, 7), day = TODAY.getDate();
    return recurring().filter(function (r) { return r.active !== false && r.lastGenerated !== ym && (+r.dayOfMonth || 1) <= day; });
  }
  // Generate this month's actual expense from a recurring template (posts to the ledger).
  function generateRecurring(r) {
    var ym = TODAY_STR.slice(0, 7);
    var e = { id: 'JV-' + ui.uid('').slice(-6).toUpperCase(), companyId: CID, created: TODAY_STR, kind: 'Expense',
      amount: +r.amount || 0, category: r.category, method: r.method || 'Bank',
      date: ym + '-' + String(r.dayOfMonth || 1).padStart(2, '0'), party: r.party || '', ref: 'REC-' + r.id, desc: (r.desc || r.category) + ' (recurring)', auto: true };
    db.save('acc_entries', e); mirrorToLedger(e);
    r.lastGenerated = ym; db.save('tv_recurring', r);
    return e;
  }
  function recurringView(page) {
    var list = recurring(), due = recurringDue();
    var monthly = list.filter(function (r) { return r.active !== false; }).reduce(function (a, r) { return a + (+r.amount || 0); }, 0);
    page.appendChild(el('div.kpi-grid.kpi-compact.stagger', null, [
      kpi('Recurring Heads', String(list.length), 'arrow-repeat'),
      kpi('Monthly Total', ui.money(monthly, { compact: true }), 'cash-stack'),
      kpi('Due This Month', String(due.length), 'calendar-check', due.length ? 'text-warn' : 'text-good'),
      kpi('Active', String(list.filter(function (r) { return r.active !== false; }).length), 'toggle-on', 'text-good')
    ]));
    if (due.length) page.appendChild(el('div.build-banner.mb-3', null, [ ui.frag(ui.icon('calendar-check')),
      el('div.flex-1', { html: '<strong>' + due.length + ' recurring expense' + (due.length > 1 ? 's' : '') + ' due this month.</strong> ' + due.map(function (r) { return esc(r.category) + ' (' + ui.money(r.amount) + ')'; }).join(', ') }),
      canCreate() ? el('button.btn.btn-sm.btn-primary', { html: ui.icon('play-circle') + ' Generate All', onclick: function () { due.forEach(generateRecurring); ui.toast(due.length + ' expenses posted', 'success'); EPAL.router.render(); } }) : null ]));
    var tbl = EPAL.table({
      columns: [
        { key: 'category', label: 'Head', render: function (r) { return '<span class="strong">' + esc(r.category) + '</span>'; } },
        { key: 'amount', label: 'Amount', num: true, money: true },
        { key: 'dayOfMonth', label: 'Day', num: true, render: function (r) { return 'Day ' + (r.dayOfMonth || 1); } },
        { key: 'method', label: 'Method', badge: {} },
        { key: 'party', label: 'Paid to', render: function (r) { return esc(r.party || '—'); } },
        { key: 'lastGenerated', label: 'Last run', render: function (r) { return r.lastGenerated || '—'; } },
        { key: 'active', label: 'Status', render: function (r) { return r.active === false ? '<span class="badge">Paused</span>' : '<span class="badge badge-good">Active</span>'; } }
      ],
      rows: list, searchKeys: ['category', 'party'], pageSize: 10, exportName: 'recurring-expenses.csv',
      actions: ui.actions({
        edit: canCreate() ? function (r) { recurringForm(r); } : null,
        del: canDelete() ? function (r) { ui.confirm({ title: 'Delete recurring "' + r.category + '"?', danger: true, confirmLabel: 'Delete' }).then(function (ok) { if (ok) { db.remove('tv_recurring', r.id); ui.toast('Deleted', 'success'); EPAL.router.render(); } }); } : null
      }),
      empty: { icon: 'arrow-repeat', title: 'No recurring expenses', hint: 'Add rent, internet or other monthly costs to auto-generate.' }
    });
    page.appendChild(el('div.card', null, [ el('div.card-head', null, [ el('h3', { html: ui.icon('arrow-repeat') + ' Recurring Expenses' }), el('span.card-sub', { text: 'auto-created monthly on their day' }) ]), el('div.card-body', null, [ tbl.el ]) ]));
  }
  function recurringForm(rec) {
    var isNew = !rec;
    EPAL.formModal({
      title: isNew ? 'New Recurring Expense' : 'Edit Recurring', icon: 'arrow-repeat', size: 'md', record: rec || { method: 'Bank', dayOfMonth: 1, active: true },
      fields: [
        { key: 'category', label: 'Expense head', type: 'text', required: true, placeholder: 'e.g. Office Rent, Internet' },
        { key: 'amount', label: 'Amount (৳)', type: 'money', required: true, min: 1 },
        { key: 'dayOfMonth', label: 'Day of month', type: 'number', min: 1, max: 28, default: 1 },
        { key: 'method', label: 'Method', type: 'select', options: METHODS, default: 'Bank' },
        { key: 'party', label: 'Paid to (vendor)', type: 'text' },
        { key: 'active', label: 'Active', type: 'checkbox', default: true, col2: true },
        { key: 'desc', label: 'Note', type: 'textarea', col2: true }
      ],
      saveLabel: isNew ? 'Add' : 'Save',
      onSave: function (val) {
        var r = rec || { id: 'REC-' + ui.uid('').slice(-5).toUpperCase(), companyId: CID };
        r.category = (val.category || '').trim(); r.amount = +val.amount || 0; r.dayOfMonth = +val.dayOfMonth || 1; r.method = val.method; r.party = val.party || ''; r.desc = val.desc || ''; r.active = val.active !== false;
        db.save('tv_recurring', r);
        ui.toast('Recurring expense saved', 'success'); EPAL.router.render(); return true;
      }
    });
  }

  /* ======================================================= CHEQUE REGISTER (spec D5) */
  function cheques() { return db.col('tv_cheques').filter(function (c) { return c.companyId === CID; }); }
  function chequesView(page) {
    var list = cheques().slice().sort(function (a, b) { return (a.dueDate || a.date || '') < (b.dueDate || b.date || '') ? 1 : -1; });
    var pending = list.filter(function (c) { return c.status === 'Pending'; });
    var issued = list.filter(function (c) { return c.type === 'Issued'; }).reduce(function (a, c) { return a + (+c.amount || 0); }, 0);
    var received = list.filter(function (c) { return c.type === 'Received'; }).reduce(function (a, c) { return a + (+c.amount || 0); }, 0);
    page.appendChild(el('div.kpi-grid.kpi-compact.stagger', null, [
      kpi('Cheques', String(list.length), 'bank'),
      kpi('Pending', String(pending.length), 'hourglass-split', pending.length ? 'text-warn' : ''),
      kpi('Issued (Σ)', ui.money(issued, { compact: true }), 'arrow-up-right-circle'),
      kpi('Received (Σ)', ui.money(received, { compact: true }), 'arrow-down-left-circle', 'text-good')
    ]));
    var tbl = EPAL.table({
      columns: [
        { key: 'number', label: 'Cheque No', render: function (c) { return '<span class="mono">' + esc(c.number || '—') + '</span>'; } },
        { key: 'type', label: 'Type', badge: { Issued: 'warn', Received: 'info' } },
        { key: 'party', label: 'Party', render: function (c) { return esc(c.party || '—'); } },
        { key: 'bank', label: 'Bank', render: function (c) { return esc(c.bank || '—'); } },
        { key: 'dueDate', label: 'Due', date: true },
        { key: 'amount', label: 'Amount', num: true, money: true },
        { key: 'status', label: 'Status', badge: { Pending: 'warn', Cleared: 'good', Bounced: 'bad' } }
      ],
      rows: list, searchKeys: ['number', 'party', 'bank'], quickFilter: 'status', filterPanel: true, filters: [{ key: 'type', label: 'Type' }], dateKey: 'dueDate',
      exportName: 'cheque-register.csv', pdfTitle: 'Cheque Register',
      onRow: function (c) { chequeDetail(c); },
      actions: ui.actions({
        edit: canCreate() ? function (c) { chequeForm(c); } : null,
        del: canDelete() ? function (c) { ui.confirm({ title: 'Delete cheque?', danger: true, confirmLabel: 'Delete' }).then(function (ok) { if (ok) { db.remove('tv_cheques', c.id); ui.toast('Deleted', 'success'); EPAL.router.render(); } }); } : null
      }),
      empty: { icon: 'bank', title: 'No cheques', hint: 'Record issued & received cheques to track clearing.' }
    });
    page.appendChild(el('div.card', null, [ el('div.card-head', null, [ el('h3', { html: ui.icon('bank') + ' Cheque Register' }), el('span.card-sub', { text: 'issued & received · clearing status' }) ]), el('div.card-body', null, [ tbl.el ]) ]));
  }
  function chequeDetail(c) {
    var body = el('div');
    var m = ui.modal({ title: 'Cheque ' + (c.number || c.id), icon: 'bank', size: 'md', body: body, footer: false });
    var actions = el('div.flex.gap-1.flex-wrap', { style: { marginLeft: 'auto' } });
    if (canCreate() && c.status === 'Pending') {
      actions.appendChild(el('button.btn.btn-sm.btn-primary', { html: ui.icon('check2') + ' Mark Cleared', onclick: function () { setChequeStatus(c, 'Cleared'); m.close(); } }));
      actions.appendChild(el('button.btn.btn-sm.btn-outline.text-bad', { html: ui.icon('x') + ' Bounced', onclick: function () { setChequeStatus(c, 'Bounced'); m.close(); } }));
    }
    body.appendChild(el('div.card', null, [ el('div.card-body', null, [
      el('div.flex.items-center.gap-2.flex-wrap.mb-3', null, [ el('div.flex-1', null, [ el('div.fw-700', { text: (c.type || '') + ' · ' + ui.money(c.amount) }), el('div.text-mute.sm', { text: 'Cheque ' + (c.number || '—') + ' · ' + (c.bank || '') }) ]),
        el('span.badge.badge-' + (c.status === 'Cleared' ? 'good' : c.status === 'Bounced' ? 'bad' : 'warn'), { text: c.status }), actions ]),
      el('div.data-list', null, [ drow('Type', c.type), drow('Party', c.party), drow('Bank', c.bank), drow('Issue date', c.date ? ui.date(c.date) : '—'), drow('Due / clearing date', c.dueDate ? ui.date(c.dueDate) : '—'), drow('Reference', c.ref) ])
    ]) ]));
  }
  function setChequeStatus(c, status) { c.status = status; db.save('tv_cheques', c); ui.toast('Cheque ' + status.toLowerCase(), 'success'); EPAL.router.render(); }
  function chequeForm(rec) {
    var isNew = !rec;
    EPAL.formModal({
      title: isNew ? 'New Cheque' : 'Edit Cheque', icon: 'bank', size: 'md', record: rec || { type: 'Issued', status: 'Pending', date: TODAY_STR, dueDate: TODAY_STR },
      fields: [
        { key: 'type', label: 'Type', type: 'select', options: ['Issued', 'Received'], required: true },
        { key: 'number', label: 'Cheque no', type: 'text', required: true },
        { key: 'bank', label: 'Bank', type: 'text' },
        { key: 'party', label: 'Party', type: 'text', placeholder: 'Payee / drawer' },
        { key: 'amount', label: 'Amount (৳)', type: 'money', required: true, min: 1 },
        { key: 'date', label: 'Issue date', type: 'date', default: TODAY_STR },
        { key: 'dueDate', label: 'Clearing date', type: 'date', default: TODAY_STR },
        { key: 'status', label: 'Status', type: 'select', options: ['Pending', 'Cleared', 'Bounced'], default: 'Pending' },
        { key: 'ref', label: 'Reference', type: 'text', col2: true }
      ],
      saveLabel: isNew ? 'Add' : 'Save',
      onSave: function (val) {
        var r = rec || { id: 'CHQ-' + ui.uid('').slice(-5).toUpperCase(), companyId: CID };
        ['type', 'number', 'bank', 'party', 'date', 'dueDate', 'status', 'ref'].forEach(function (k) { r[k] = val[k]; });
        r.amount = +val.amount || 0;
        db.save('tv_cheques', r);
        ui.toast('Cheque saved', 'success'); EPAL.router.render(); return true;
      }
    });
  }

  /* ======================================================= CASH BOOK (spec D5) */
  // Every movement on Cash (1000) + Bank (1010) for the company, dated, with a
  // combined running balance — read straight from the double-entry ledger.
  function cashBookView(page) {
    if (!EPAL.ledger || !EPAL.ledger.entries) { page.appendChild(el('div.card', null, [ el('div.card-body', { text: 'Ledger engine unavailable.' }) ])); return; }
    var recon = S.get('tv_recon', {});                 // { glEntryId: true } — reconciled vs the bank statement
    var rows = [], bal = 0, inflow = 0, outflow = 0;
    EPAL.ledger.entries({ companyId: CID }).forEach(function (e) {
      var d = 0, c = 0;
      e.lines.forEach(function (l) { if (l.account === '1000' || l.account === '1010') { d += (+l.dr || 0); c += (+l.cr || 0); } });
      if (d === 0 && c === 0) return;
      bal += d - c; inflow += d; outflow += c;
      rows.push({ id: e.id, date: e.date, ref: e.ref || e.id, memo: e.memo || '', party: e.party || '', inflow: d, outflow: c, balance: bal, reconciled: !!recon[e.id] });
    });
    var closing = bal;
    var reconRows = rows.filter(function (r) { return r.reconciled; });
    var unrecon = rows.filter(function (r) { return !r.reconciled; });
    var unreconAmt = unrecon.reduce(function (a, r) { return a + (r.inflow - r.outflow); }, 0);
    rows.reverse();   // newest first for display

    page.appendChild(el('div.kpi-grid.kpi-compact.stagger', null, [
      kpi('Cash & Bank', ui.money(closing, { compact: true }), 'bank', closing < 0 ? 'text-bad' : ''),
      kpi('Reconciled', reconRows.length + ' / ' + rows.length, 'check2-circle', reconRows.length === rows.length && rows.length ? 'text-good' : ''),
      kpi('Unreconciled', ui.money(unreconAmt, { compact: true }), 'question-circle', unrecon.length ? 'text-warn' : 'text-good'),
      kpi('Total In / Out', ui.money(inflow, { compact: true }) + ' / ' + ui.money(outflow, { compact: true }), 'arrow-down-up')
    ]));
    page.appendChild(el('div.text-mute.sm.mb-2', { html: ui.icon('info-circle') + ' Bank reconciliation — click a row to tick it off against your bank statement.' }));
    var tbl = EPAL.table({
      columns: [
        { key: 'reconciled', label: '✓', render: function (r) { return r.reconciled ? '<span class="text-good">' + ui.icon('check-circle-fill') + '</span>' : '<span class="text-mute">' + ui.icon('circle') + '</span>'; } },
        { key: 'date', label: 'Date', date: true },
        { key: 'ref', label: 'Ref', render: function (r) { return '<span class="mono xs text-mute">' + esc(r.ref) + '</span>'; } },
        { key: 'memo', label: 'Particulars', render: function (r) { return esc(r.memo || r.party || '—'); } },
        { key: 'inflow', label: 'In', num: true, render: function (r) { return r.inflow ? '<span class="num text-good">' + ui.money(r.inflow) + '</span>' : '—'; }, sortVal: function (r) { return r.inflow; } },
        { key: 'outflow', label: 'Out', num: true, render: function (r) { return r.outflow ? '<span class="num text-warn">' + ui.money(r.outflow) + '</span>' : '—'; }, sortVal: function (r) { return r.outflow; } },
        { key: 'balance', label: 'Balance', num: true, render: function (r) { return '<span class="num strong ' + (r.balance < 0 ? 'text-bad' : '') + '">' + ui.money(r.balance) + '</span>'; }, sortVal: function (r) { return r.balance; } }
      ],
      rows: rows, searchKeys: ['memo', 'party', 'ref'], pageSize: 15, exportName: 'cash-book.csv', pdfTitle: 'Cash Book — Epal Travels',
      onRow: canCreate() ? function (r) { var m = S.get('tv_recon', {}); if (m[r.id]) delete m[r.id]; else m[r.id] = true; S.set('tv_recon', m); EPAL.router.render(); } : null,
      empty: { icon: 'bank', title: 'No cash movements yet' }
    });
    page.appendChild(el('div.card', null, [ el('div.card-head', null, [ el('h3', { html: ui.icon('bank') + ' Cash & Bank Book' }), el('span.card-sub', { text: 'closing balance ' + ui.money(closing) } ) ]), el('div.card-body', null, [ tbl.el ]) ]));
  }

  /* ======================================================= PETTY CASH (spec D5) */
  function petty() { return db.col('tv_petty').filter(function (p) { return p.companyId === CID; }); }
  function pettyView(page) {
    var list = petty().slice().sort(function (a, b) { return (a.date || '') < (b.date || '') ? 1 : -1; });
    var open = list.filter(function (p) { return p.status !== 'Settled'; });
    var openAmt = open.reduce(function (a, p) { return a + (+p.amount || 0); }, 0);
    var settled = list.filter(function (p) { return p.status === 'Settled'; }).reduce(function (a, p) { return a + (+p.billAmount || 0); }, 0);
    page.appendChild(el('div.kpi-grid.kpi-compact.stagger', null, [
      kpi('Open IOUs', String(open.length), 'cash', open.length ? 'text-warn' : 'text-good'),
      kpi('Held by Staff', ui.money(openAmt, { compact: true }), 'people'),
      kpi('Settled (Σ)', ui.money(settled, { compact: true }), 'check2-circle', 'text-good'),
      kpi('Slips', String(list.length), 'card-list')
    ]));
    var tbl = EPAL.table({
      columns: [
        { key: 'staff', label: 'Staff', render: function (p) { return '<span class="strong">' + esc(p.staff) + '</span>'; } },
        { key: 'purpose', label: 'Purpose', render: function (p) { return esc(p.purpose || '—'); } },
        { key: 'date', label: 'Date', date: true },
        { key: 'amount', label: 'IOU', num: true, money: true },
        { key: 'billAmount', label: 'Bill', num: true, render: function (p) { return p.billAmount ? ui.money(p.billAmount) : '—'; }, sortVal: function (p) { return p.billAmount || 0; } },
        { key: 'status', label: 'Status', badge: { Open: 'warn', Settled: 'good' } }
      ],
      rows: list, searchKeys: ['staff', 'purpose'], quickFilter: 'status', pageSize: 10, exportName: 'petty-cash.csv', pdfTitle: 'Petty Cash Register',
      onRow: function (p) { if (p.status !== 'Settled' && canCreate()) settlePetty(p); },
      actions: ui.actions({
        edit: canCreate() ? function (p) { if (p.status !== 'Settled') settlePetty(p); else ui.toast('Already settled', 'info'); } : null,
        del: canDelete() ? function (p) { ui.confirm({ title: 'Delete IOU slip?', danger: true, confirmLabel: 'Delete' }).then(function (ok) { if (ok) { db.remove('tv_petty', p.id); ui.toast('Deleted', 'success'); EPAL.router.render(); } }); } : null
      }),
      empty: { icon: 'cash', title: 'No petty-cash slips', hint: 'Give an IOU to staff for petty expenses.' }
    });
    page.appendChild(el('div.card', null, [ el('div.card-head', null, [ el('h3', { html: ui.icon('cash') + ' Petty Cash — IOU Register' }), el('span.card-sub', { text: 'click an open slip to settle against a bill' }) ]), el('div.card-body', null, [ tbl.el ]) ]));
  }
  function pettyForm(rec) {
    EPAL.formModal({
      title: 'Give Petty-Cash IOU', icon: 'cash', size: 'md', record: { date: TODAY_STR },
      fields: [
        { key: 'staff', label: 'Staff', type: 'text', required: true, placeholder: 'Who is holding the cash' },
        { key: 'amount', label: 'IOU amount (৳)', type: 'money', required: true, min: 1 },
        { key: 'purpose', label: 'Purpose', type: 'text', required: true, placeholder: 'e.g. Office supplies, courier' },
        { key: 'date', label: 'Date', type: 'date', default: TODAY_STR }
      ],
      saveLabel: 'Give IOU',
      onSave: function (val) {
        var r = { id: 'PC-' + ui.uid('').slice(-5).toUpperCase(), companyId: CID, staff: (val.staff || '').trim(), amount: +val.amount || 0, purpose: val.purpose || '', date: val.date || TODAY_STR, status: 'Open' };
        db.save('tv_petty', r);
        ui.toast('IOU given to ' + r.staff, 'success'); EPAL.router.render(); return true;
      }
    });
  }
  // settle an IOU against a bill — books the actual spend (DR expense / CR Cash).
  function settlePetty(p) {
    EPAL.formModal({
      title: 'Settle IOU — ' + p.staff, icon: 'check2-circle', size: 'md', record: { billAmount: p.amount, category: 'Travel & Conveyance' },
      fields: [
        { key: 'category', label: 'Expense head', type: 'text', required: true, default: 'Travel & Conveyance', hint: 'What the petty cash was spent on.' },
        { key: 'billAmount', label: 'Bill amount (৳)', type: 'money', required: true, min: 0, max: p.amount, hint: 'IOU was ' + ui.money(p.amount) + '; any balance is returned to cash.' },
        { key: 'billNo', label: 'Bill / voucher no', type: 'text' }
      ],
      saveLabel: 'Settle',
      onSave: function (val) {
        var bill = Math.min(+val.billAmount || 0, p.amount);
        if (EPAL.ledger && EPAL.ledger.post && bill > 0) {
          try { EPAL.ledger.post({ id: 'GL-PCS-' + p.id, date: TODAY_STR, companyId: CID, ref: p.id, memo: 'Petty cash · ' + p.staff + ' · ' + val.category, source: 'manual', party: p.staff, lines: [{ account: expenseAccountFor(val.category), dr: bill, cr: 0 }, { account: '1000', dr: 0, cr: bill }] }); } catch (e) {}
        }
        p.status = 'Settled'; p.category = val.category; p.billAmount = bill; p.billNo = val.billNo || ''; p.settledDate = TODAY_STR;
        db.save('tv_petty', p);
        ui.toast('IOU settled', 'success'); EPAL.router.render(); return true;
      }
    });
  }

  function canCreate() { return !EPAL.perm || EPAL.perm.can('travels', 'accounts', 'create'); }
  function canDelete() { return !EPAL.perm || EPAL.perm.can('travels', 'accounts', 'delete'); }
  function esc(s) { return ui.escapeHtml(String(s == null ? '' : s)); }
  function kpi(label, value, icon, tone) {
    return el('div.kpi-card', null, [
      el('div.kpi-top', null, [ el('span.kpi-label', { text: label }), el('span.kpi-ico', { html: '<i class="bi bi-' + icon + '"></i>' }) ]),
      el('div.kpi-value' + (tone ? '.' + tone : ''), { text: String(value) })
    ]);
  }
  function kpiDrill(label, value, icon, route, foot) {
    return el('div.kpi-card.drill', { onclick: function () { EPAL.router.navigate(route); } }, [
      el('div.kpi-top', null, [ el('span.kpi-label', { text: label }), el('span.kpi-ico', { html: '<i class="bi bi-' + icon + '"></i>' }) ]),
      el('div.kpi-value', { text: String(value) }),
      foot ? el('div.kpi-foot', null, [ el('span.text-muted', { text: foot }) ]) : null
    ]);
  }
  function st2(l, v) { return el('div.stat', null, [ el('div.stat-label', { text: l }), el('div.stat-value', { text: v }) ]); }
  function drow(k, v) { return el('div.data-row', null, [ el('div.text-mute.sm.flex-1', { text: k }), el('div.strong', { text: v == null || v === '' ? '—' : String(v) }) ]); }
  function chartCard(title, icon, canvasId, subLabel, height) {
    return el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon(icon) + ' ' + title }), subLabel ? el('span.card-sub', { text: subLabel }) : null ]),
      el('div.card-body', null, [ el('div', { style: { height: (height || 260) + 'px', position: 'relative' } }, [ el('canvas', { id: canvasId }) ]) ])
    ]);
  }

})(window.EPAL = window.EPAL || {});
