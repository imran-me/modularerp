/* ============================================================================
 * EPAL GROUP ERP  ·  companies/group-cockpit/modules/master-accounts/view.js
 * ----------------------------------------------------------------------------
 * MASTER ACCOUNTS — the group-level accounting desk (owner's reference-ERP menu):
 * everything you can do inside one company's Accounts/Payroll, done from the
 * GROUP with a COMPANY SWITCHER (buttons on top: All · Group HQ · Travels ·
 * Interior · IT · Shop · Construction).
 *
 *   expenses     → All Expenses across the chosen company (or every company),
 *                  add/edit with Category → Sub-category, method, party, bill no.
 *   categories   → Category & Sub-Category manager (exp_categories store).
 *   budget       → Budget Setup per company + category (monthly/annual) with
 *                  live budget-vs-actual bars.
 *   report       → Expense Report — Daily / Weekly / Monthly / Custom range,
 *                  grouped totals, CSV + print.
 *   journals     → Manage Journals — the master GL register (source filter +
 *                  filtered totals) + New Journal into any company.
 *   schedules    → Payment Schedules across companies (add · detail · Mark Paid).
 *   party-types  → Party Types manager (party_types store).
 *   payroll      → MASTER PAYROLL — the full payroll desk with company buttons.
 *   banks        → cash position per company + jump to Manage Banks.
 *
 * DATA: acc_entries / acc_schedules / gl_entries / banks (existing stores, all
 * carry companyId) + NEW exp_categories, party_types. Expense saves mirror to
 * the ledger (GL-MX-<id>) tagged with the chosen company so the consolidated
 * P&L by concern stays truthful.
 * ==> LARAVEL: a Group\AccountsController with a company scope param; categories
 *     + party_types are plain lookup tables; reports are GROUP BY date buckets.
 * ==========================================================================*/

(function (EPAL) {
  'use strict';
  var ui = EPAL.ui, el = ui.el, db = EPAL.db, S = EPAL.store;
  var TODAY_STR = '2026-07-05';
  var METHODS = ['Bank', 'Cash', 'bKash', 'Nagad', 'Debit Card', 'Credit Card', 'Cheque'];
  var SECTIONS = [['expenses', 'All Expenses'], ['categories', 'Categories'], ['budget', 'Budget Setup'], ['report', 'Expense Report'],
    ['journals', 'Manage Journals'], ['schedules', 'Payment Schedules'], ['party-types', 'Party Types'], ['payroll', 'Master Payroll'], ['banks', 'Manage Banks']];
  var selCo = 'all';                                  // the company switcher state
  var reportMode = 'daily';                           // expense-report bucket
  var reportFrom = '2026-07-01', reportTo = TODAY_STR;

  /* ---- seeds -------------------------------------------------------------*/
  EPAL.registerEngine({ name: 'master-accounts-seed', seed: function () {
    S.seedOnce('exp_categories', [
      { id: 'CAT-OFF', name: 'Office Management', subs: ['Stationery', 'Cleaning', 'Repair & Maintenance', 'Furniture'] },
      { id: 'CAT-FOOD', name: 'Food & Entertainment', subs: ['Staff Lunch', 'Guest Entertainment', 'Tea & Snacks'] },
      { id: 'CAT-UTIL', name: 'Utilities', subs: ['Electricity', 'Water', 'Gas', 'Internet', 'Phone'] },
      { id: 'CAT-RENT', name: 'Office Rent', subs: [] },
      { id: 'CAT-SAL', name: 'Staff Salary', subs: ['Salary', 'Bonus', 'Overtime'] },
      { id: 'CAT-MKT', name: 'Marketing', subs: ['Facebook Ads', 'Boosting', 'Design', 'Print', 'SMS Campaign'] },
      { id: 'CAT-FEES', name: 'Fees & Charges', subs: ['Bank Charge', 'Trade License', 'Software', 'IATA Fee'] },
      { id: 'CAT-CONV', name: 'Conveyance & Travel', subs: ['Local Transport', 'Fuel'] },
      { id: 'CAT-MISC', name: 'Miscellaneous', subs: [] }
    ]);
    S.seedOnce('party_types', [
      { id: 'PT-1', name: 'Customer' }, { id: 'PT-2', name: 'Vendor' }, { id: 'PT-3', name: 'Sub-Agent' },
      { id: 'PT-4', name: 'Officer' }, { id: 'PT-5', name: 'Staff' }, { id: 'PT-6', name: 'Bank' }, { id: 'PT-7', name: 'Other' }
    ]);
  } });

  /* ---- helpers -----------------------------------------------------------*/
  function comps() { return EPAL.config.companies.filter(function (c) { return c.type === 'company' && c.enabled !== false; }); }
  function coName(cid) { if (cid === 'group') return 'Group HQ'; var c = EPAL.config.company(cid); return c ? c.short : cid; }
  function canCreate() { return !EPAL.perm || EPAL.perm.can('group', 'master-accounts', 'create'); }
  function esc(s) { return ui.escapeHtml(String(s == null ? '' : s)); }
  function entriesFor(kind) {
    return db.col('acc_entries').filter(function (e) {
      if (kind && e.kind !== kind) return false;
      return selCo === 'all' ? true : e.companyId === selCo;
    });
  }
  function cats() { return S.list('exp_categories'); }
  function expenseAccountFor(cat) {
    var c = String(cat || '').toLowerCase();
    if (/rent|lease/.test(c)) return '5200';
    if (/salary|payroll|wage|staff/.test(c)) return '5100';
    if (/utility|electric|internet|wifi|gas|water|phone|bill/.test(c)) return '5300';
    if (/market|ad\b|promo|campaign|boost|sms|design/.test(c)) return '5400';
    if (/bank|charge|fee|license|iata|software/.test(c)) return '6000';
    if (/adm|penalt|fine/.test(c)) return '5900';
    if (/food|lunch|tea|snack|entertain|canteen/.test(c)) return '5550';
    if (/office|stationer|clean|repair|furniture/.test(c)) return '5500';
    if (/conveyance|travel|transport|fuel/.test(c)) return '5600';
    return '5800';
  }
  function kpi(label, value, icon, tone) {
    return el('div.kpi-card', null, [
      el('div.kpi-top', null, [el('span.kpi-label', { text: label }), el('span.kpi-ico', { html: '<i class="bi bi-' + icon + '"></i>' })]),
      el('div.kpi-value' + (tone ? '.' + tone : ''), { text: String(value) })
    ]);
  }
  function coCell(cid) { var c = EPAL.config.company(cid); return '<span class="badge"' + (c ? ' style="color:' + c.accent + '"' : '') + '>' + esc(coName(cid)) + '</span>'; }

  /* ==========================================================================
   * VIEW
   * ========================================================================*/
  EPAL.view('group/master-accounts', {
    render: function (ctx) {
      var sub = ctx.subId || 'expenses';
      if (!SECTIONS.some(function (s) { return s[0] === sub; })) sub = 'expenses';
      var page = el('div.page');
      var titles = {}; SECTIONS.forEach(function (s) { titles[s[0]] = s[1]; });
      page.appendChild(EPAL.pageHead({
        eyebrow: 'Epal Group · Master Accounts', icon: 'safe2', title: titles[sub],
        sub: 'Group-level accounting across every sister concern — switch company with the buttons below.'
      }));
      // section pills
      var pills = el('div.pill-tab.mb-2');
      SECTIONS.forEach(function (s) { pills.appendChild(el('button' + (sub === s[0] ? '.active' : ''), { text: s[1], onclick: function () { EPAL.router.navigate('group/master-accounts/' + s[0]); } })); });
      page.appendChild(pills);
      // COMPANY SWITCHER — the owner's "button-wise switch of companies at the top"
      var swWrap = el('div.flex.gap-1.flex-wrap.mb-3');
      var swOpts = [['all', 'All Companies'], ['group', 'Group HQ']].concat(comps().map(function (c) { return [c.id, c.short]; }));
      swOpts.forEach(function (o) {
        if (sub === 'payroll' && o[0] === 'all') return;      // payroll needs one company
        swWrap.appendChild(el('button.btn.btn-sm' + ((selCo === o[0]) ? '.btn-primary' : '.btn-outline'), {
          text: o[1], onclick: function () { selCo = o[0]; EPAL.router.render(); } }));
      });
      page.appendChild(swWrap);
      if (sub === 'payroll' && (selCo === 'all')) selCo = 'travels';
      ({ expenses: expensesView, categories: categoriesView, budget: budgetView, report: reportView,
         journals: journalsView, schedules: schedulesView, 'party-types': partyTypesView, payroll: payrollView, banks: banksView }[sub])(page);
      ctx.mount.appendChild(page);
    }
  });

  /* ======================================================= ALL EXPENSES */
  function expensesView(page) {
    var list = entriesFor('Expense').slice().sort(function (a, b) { return (a.date || '') < (b.date || '') ? 1 : -1; });
    var total = list.reduce(function (a, e) { return a + (+e.amount || 0); }, 0);
    var mtd = list.filter(function (e) { return String(e.date).slice(0, 7) === TODAY_STR.slice(0, 7); }).reduce(function (a, e) { return a + (+e.amount || 0); }, 0);
    page.appendChild(el('div.kpi-grid.kpi-compact.stagger', null, [
      kpi('Expenses (Σ)', ui.money(total, { compact: true }), 'wallet2'),
      kpi('This Month', ui.money(mtd, { compact: true }), 'calendar-event'),
      kpi('Entries', String(list.length), 'card-list'),
      kpi('Scope', selCo === 'all' ? 'All companies' : coName(selCo), 'diagram-3')
    ]));
    if (canCreate()) page.appendChild(el('div.mb-2', null, [el('button.btn.btn-primary', { html: ui.icon('plus-lg') + ' New Expense', onclick: function () { expenseForm(null); } })]));
    var cols = [
      { key: 'date', label: 'Date', date: true },
      { key: 'category', label: 'Category', badge: {} },
      { key: 'subCategory', label: 'Sub-category', render: function (e) { return esc(e.subCategory || '—'); } },
      { key: 'desc', label: 'Detail', render: function (e) { return esc(e.desc || '—'); } },
      { key: 'party', label: 'Paid to', render: function (e) { return esc(e.party || '—'); } },
      { key: 'method', label: 'Method', badge: {} },
      { key: 'amount', label: 'Amount', num: true, money: true }
    ];
    if (selCo === 'all') cols.splice(1, 0, { key: 'companyId', label: 'Company', render: function (e) { return coCell(e.companyId); }, exportVal: function (e) { return e.companyId; } });
    var tbl = EPAL.table({
      columns: cols, rows: list, searchKeys: ['category', 'subCategory', 'desc', 'party'], quickFilter: 'category', filterPanel: true,
      filters: [{ key: 'method', label: 'Method' }].concat(selCo === 'all' ? [{ key: 'companyId', label: 'Company' }] : []),
      dateKey: 'date', totalKey: 'amount', pageSize: 12, exportName: 'master-expenses.csv', pdfTitle: 'Master Expenses — ' + coName(selCo),
      actions: ui.actions({ edit: canCreate() ? function (e) { expenseForm(e); } : null }),
      empty: { icon: 'wallet2', title: 'No expenses in this scope', hint: 'Record one with New Expense.' }
    });
    page.appendChild(el('div.card', null, [el('div.card-head', null, [el('h3', { html: ui.icon('wallet2') + ' All Expenses — ' + coName(selCo) })]), el('div.card-body', null, [tbl.el])]));
  }
  function expenseForm(rec) {
    var catList = cats();
    var catOpts = catList.map(function (c) { return c.name; });
    function subsOf(name) { var c = catList.filter(function (x) { return x.name === name; })[0]; return (c && c.subs && c.subs.length) ? c.subs : []; }
    EPAL.formModal({
      title: rec ? 'Edit Expense' : 'New Expense', icon: 'wallet2', size: 'md',
      record: rec || { date: TODAY_STR, method: 'Bank', companyId: selCo === 'all' ? 'group' : selCo },
      fields: [
        { key: 'companyId', label: 'Company', type: 'select', required: true, options: [['group', 'Group HQ']].concat(comps().map(function (c) { return [c.id, c.short]; })) },
        { key: 'category', label: 'Category', type: 'select', required: true, options: catOpts },
        { key: 'subCategory', label: 'Sub-category', type: 'text', placeholder: 'e.g. ' + (subsOf(catOpts[0]) || []).slice(0, 3).join(', '), hint: 'Pick from the category\'s sub-list or type your own.' },
        { key: 'date', label: 'Date', type: 'date', default: TODAY_STR },
        { key: 'method', label: 'Paid from / method', type: 'select', options: METHODS, default: 'Bank' },
        { key: 'party', label: 'Paid to', type: 'text' },
        { key: 'ref', label: 'Bill / voucher no', type: 'text' },
        // LINE ITEMS (ported from the production ERP's expense_items): several
        // rows per expense; the header amount is the SUM of the item amounts.
        { key: 'items', type: 'items', label: 'Expense Items', required: true, min: 1, addLabel: 'Add item',
          columns: [
            { key: 'description', label: 'Item / detail', type: 'text', width: '2.4fr' },
            { key: 'amount', label: 'Amount', type: 'money', width: '1fr' }
          ] },
        { key: 'desc', label: 'Notes', type: 'textarea', col2: true }
      ],
      saveLabel: rec ? 'Save' : 'Record Expense',
      onSave: function (v) {
        var items = (v.items || []).map(function (i) { return { description: (i.description || '').trim(), amount: +i.amount || 0 }; }).filter(function (i) { return i.amount > 0; });
        var total = items.reduce(function (a, i) { return a + i.amount; }, 0);
        if (total <= 0) { ui.toast('Add at least one item with an amount', 'error'); return false; }
        var r = rec || { id: 'JV-' + ui.uid('').slice(-6).toUpperCase(), kind: 'Expense', created: TODAY_STR };
        r.companyId = v.companyId; r.category = v.category; r.subCategory = (v.subCategory || '').trim();
        r.items = items; r.amount = total; r.date = v.date; r.method = v.method; r.party = v.party || ''; r.ref = v.ref || ''; r.desc = v.desc || '';
        db.save('acc_entries', r);
        try { EPAL.ledger.post({ id: 'GL-MX-' + r.id, date: r.date, companyId: r.companyId, ref: r.ref || r.id, memo: r.category + (r.subCategory ? ' · ' + r.subCategory : '') + (r.desc ? ' — ' + r.desc : ''), source: 'manual', party: r.party, lines: [{ account: expenseAccountFor(r.category + ' ' + r.subCategory), dr: r.amount, cr: 0 }, { account: '1010', dr: 0, cr: r.amount }] }); } catch (e) { ui.toast(e.message || 'Ledger mirror failed', 'error'); }
        ui.toast('Expense recorded', 'success'); EPAL.router.render(); return true;
      }
    });
  }

  /* ======================================================= CATEGORIES */
  function categoriesView(page) {
    var list = cats();
    if (canCreate()) page.appendChild(el('div.mb-2', null, [el('button.btn.btn-primary', { html: ui.icon('plus-lg') + ' New Category', onclick: function () { categoryForm(null); } })]));
    var tbl = EPAL.table({
      columns: [
        { key: 'name', label: 'Category', render: function (c) { return '<span class="strong">' + esc(c.name) + '</span>'; } },
        { key: 'subs', label: 'Sub-categories', render: function (c) { return (c.subs || []).length ? (c.subs || []).map(function (s) { return '<span class="badge">' + esc(s) + '</span>'; }).join(' ') : '—'; }, exportVal: function (c) { return (c.subs || []).join('; '); } },
        { key: 'used', label: 'Entries', num: true, sortVal: function (c) { return db.col('acc_entries').filter(function (e) { return e.category === c.name; }).length; }, render: function (c) { return String(db.col('acc_entries').filter(function (e) { return e.category === c.name; }).length); } }
      ],
      rows: list, searchKeys: ['name'], pageSize: 12, exportName: 'expense-categories.csv',
      actions: ui.actions({
        edit: canCreate() ? function (c) { categoryForm(c); } : null,
        del: canCreate() ? function (c) {
          var used = db.col('acc_entries').some(function (e) { return e.category === c.name; });
          if (used) { ui.toast('In use by expenses — rename instead of deleting', 'error'); return; }
          ui.confirm({ title: 'Delete category "' + c.name + '"?', danger: true, confirmLabel: 'Delete' }).then(function (ok) { if (ok) { S.removeFrom('exp_categories', c.id); ui.toast('Deleted', 'success'); EPAL.router.render(); } });
        } : null
      }),
      empty: { icon: 'folder', title: 'No categories' }
    });
    page.appendChild(el('div.card', null, [el('div.card-head', null, [el('h3', { html: ui.icon('folder') + ' Expense Categories & Sub-Categories' })]), el('div.card-body', null, [tbl.el])]));
  }
  function categoryForm(c) {
    EPAL.formModal({
      title: c ? 'Edit Category' : 'New Category', icon: 'folder', size: 'md', record: c ? { name: c.name, subsText: (c.subs || []).join(', ') } : {},
      fields: [
        { key: 'name', label: 'Category name', type: 'text', required: true },
        { key: 'subsText', label: 'Sub-categories (comma-separated)', type: 'textarea', col2: true, placeholder: 'e.g. Electricity, Water, Gas' }
      ],
      saveLabel: c ? 'Save' : 'Add',
      onSave: function (v) {
        var r = c || { id: 'CAT-' + ui.uid('').slice(-5).toUpperCase() };
        var oldName = c ? c.name : null;
        r.name = (v.name || '').trim(); r.subs = (v.subsText || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
        S.upsert('exp_categories', r);
        // renaming cascades onto existing expenses so reports stay grouped correctly
        if (oldName && oldName !== r.name) db.col('acc_entries').forEach(function (e) { if (e.category === oldName) { e.category = r.name; db.save('acc_entries', e); } });
        ui.toast('Category saved', 'success'); EPAL.router.render(); return true;
      }
    });
  }

  /* ======================================================= BUDGET SETUP */
  function budgetView(page) {
    var budgets = S.list('group_budgets').filter(function (b) { return selCo === 'all' ? true : (b.companyId || 'group') === selCo; });
    if (canCreate()) page.appendChild(el('div.mb-2', null, [el('button.btn.btn-primary', { html: ui.icon('bullseye') + ' Set Budget', onclick: function () { budgetForm(null); } })]));
    var body = el('div.card-body');
    if (!budgets.length) body.appendChild(el('div.text-mute.sm', { text: 'No budgets in this scope yet — Set Budget to start.' }));
    var yr = TODAY_STR.slice(0, 4);
    var PERIOD_X = { Weekly: 52, Monthly: 12, Quarterly: 4, Annual: 1, Yearly: 1 };
    budgets.forEach(function (b) {
      var cid = b.companyId || 'group';
      var annual = (b.amount || 0) * (PERIOD_X[b.period] || 1);
      var threshold = b.threshold > 0 ? b.threshold : 80;      // warn at N% (ported)
      var actual = db.col('acc_entries').filter(function (e) { return e.kind === 'Expense' && e.companyId === cid && e.category === b.category && String(e.date).slice(0, 4) === yr; })
        .reduce(function (a, e) { return a + (+e.amount || 0); }, 0);
      var pct = annual ? Math.min(150, Math.round(actual / annual * 100)) : 0, over = annual && actual > annual;
      var state = over ? 'Over Budget' : pct >= threshold ? 'Near Limit' : 'Under Budget';
      body.appendChild(el('div', { style: { marginBottom: '12px' } }, [
        el('div.flex.justify-between.items-center', null, [
          el('div.fw-600', { html: esc(b.category) + ' <span class="badge">' + esc(coName(cid)) + '</span> <span class="text-mute xs">' + esc(b.period || 'Annual') + ' · warn ' + threshold + '%</span> <span class="badge badge-' + (over ? 'bad' : pct >= threshold ? 'warn' : 'good') + '">' + state + '</span>' }),
          el('div.text-mute.sm', { html: ui.money(actual) + ' <span class="text-mute">/ ' + ui.money(annual) + ' (annualised)</span>' })
        ]),
        el('div', { style: { height: '7px', background: 'var(--surface-3)', borderRadius: '5px', overflow: 'hidden', marginTop: '4px' } }, [
          el('div', { style: { height: '100%', width: Math.min(100, pct) + '%', background: over ? '#f0506e' : pct >= threshold ? '#f4b740' : '#23c17e', borderRadius: '5px' } })
        ]),
        el('div.text-mute.xs', { style: { marginTop: '2px' }, text: over ? ('Over by ' + ui.money(actual - annual)) : (pct + '% used · ' + ui.money(annual - actual) + ' left') })
      ]));
    });
    page.appendChild(el('div.card', null, [el('div.card-head', null, [el('h3', { html: ui.icon('bullseye') + ' Budget vs Actual — ' + yr }), el('span.card-sub', { text: 'actuals from the expense register' })]), body]));
  }
  function budgetForm(b) {
    EPAL.formModal({
      title: 'Set Budget', icon: 'bullseye', size: 'sm', record: b || { period: 'Monthly', companyId: selCo === 'all' ? 'group' : selCo },
      fields: [
        { key: 'companyId', label: 'Company', type: 'select', required: true, options: [['group', 'Group HQ']].concat(comps().map(function (c) { return [c.id, c.short]; })) },
        { key: 'category', label: 'Category', type: 'select', required: true, options: cats().map(function (c) { return c.name; }) },
        { key: 'period', label: 'Period', type: 'select', options: ['Weekly', 'Monthly', 'Quarterly', 'Annual'], default: 'Monthly' },
        { key: 'amount', label: 'Budget amount (৳)', type: 'money', required: true, min: 0 },
        { key: 'threshold', label: 'Warning threshold (%)', type: 'number', min: 1, max: 100, default: 80, hint: 'Flag "Near Limit" once usage passes this.' }
      ],
      saveLabel: 'Save Budget',
      onSave: function (v) {
        var prev = S.list('group_budgets').filter(function (x) { return (x.companyId || 'group') === v.companyId && x.category === v.category; })[0];
        var r = prev || { id: 'BUD-' + v.companyId + '-' + String(v.category).replace(/[^A-Za-z]/g, ''), history: [] };
        if (prev && prev.amount !== +v.amount) (r.history = r.history || []).push({ date: TODAY_STR, from: prev.amount, to: +v.amount });   // revision log
        r.companyId = v.companyId; r.category = v.category; r.period = v.period; r.amount = +v.amount || 0; r.threshold = Math.min(100, Math.max(1, +v.threshold || 80));
        S.upsert('group_budgets', r);
        ui.toast('Budget saved', 'success'); EPAL.router.render(); return true;
      }
    });
  }

  /* ======================================================= EXPENSE REPORT */
  function reportView(page) {
    var modes = [['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly'], ['custom', 'Custom']];
    var bar = el('div.pill-tab.mb-2');
    modes.forEach(function (m) { bar.appendChild(el('button' + (reportMode === m[0] ? '.active' : ''), { text: m[1], onclick: function () { reportMode = m[0]; EPAL.router.render(); } })); });
    page.appendChild(bar);
    var list = entriesFor('Expense');
    if (reportMode === 'custom') {
      var fromI = el('input.input', { type: 'date', value: reportFrom, onchange: function () { reportFrom = this.value; EPAL.router.render(); } });
      var toI = el('input.input', { type: 'date', value: reportTo, onchange: function () { reportTo = this.value; EPAL.router.render(); } });
      page.appendChild(el('div.flex.gap-2.items-center.mb-2', null, [el('span.text-mute.sm', { text: 'From' }), fromI, el('span.text-mute.sm', { text: 'to' }), toI]));
      list = list.filter(function (e) { var d = String(e.date).slice(0, 10); return d >= reportFrom && d <= reportTo; });
    }
    function bucketOf(e) {
      var d = String(e.date).slice(0, 10);
      if (reportMode === 'monthly') return d.slice(0, 7);
      if (reportMode === 'weekly') { var dt = new Date(d); var onejan = new Date(dt.getFullYear(), 0, 1); var wk = Math.ceil((((dt - onejan) / 86400000) + onejan.getDay() + 1) / 7); return d.slice(0, 4) + ' · W' + String(wk).padStart(2, '0'); }
      return d;                                        // daily + custom → per day
    }
    var byBucket = {};
    list.forEach(function (e) {
      var k = bucketOf(e);
      byBucket[k] = byBucket[k] || { bucket: k, count: 0, total: 0, byCat: {} };
      byBucket[k].count++; byBucket[k].total += (+e.amount || 0);
      byBucket[k].byCat[e.category || '—'] = (byBucket[k].byCat[e.category || '—'] || 0) + (+e.amount || 0);
    });
    var rows = Object.keys(byBucket).sort().reverse().map(function (k) {
      var b = byBucket[k];
      var top = Object.keys(b.byCat).sort(function (x, y) { return b.byCat[y] - b.byCat[x]; })[0];
      return { bucket: b.bucket, count: b.count, top: top ? (top + ' (' + ui.money(b.byCat[top]) + ')') : '—', total: b.total };
    });
    var grand = rows.reduce(function (a, r) { return a + r.total; }, 0);
    page.appendChild(el('div.kpi-grid.kpi-compact.stagger', null, [
      kpi('Total Spend', ui.money(grand, { compact: true }), 'cash-stack'),
      kpi('Periods', String(rows.length), 'calendar3'),
      kpi('Entries', String(list.length), 'card-list'),
      kpi('Scope', selCo === 'all' ? 'All companies' : coName(selCo), 'diagram-3')
    ]));
    var tbl = EPAL.table({
      columns: [
        { key: 'bucket', label: reportMode === 'monthly' ? 'Month' : reportMode === 'weekly' ? 'Week' : 'Date', render: function (r) { return '<span class="strong">' + esc(r.bucket) + '</span>'; } },
        { key: 'count', label: 'Entries', num: true },
        { key: 'top', label: 'Biggest head' },
        { key: 'total', label: 'Total', num: true, money: true }
      ],
      rows: rows, pageSize: 15, totalKey: 'total', exportName: 'expense-report-' + reportMode + '.csv', pdfTitle: 'Expense Report (' + reportMode + ') — ' + coName(selCo),
      empty: { icon: 'graph-down', title: 'No expenses in this range' }
    });
    page.appendChild(el('div.card', null, [el('div.card-head', null, [el('h3', { html: ui.icon('graph-down-arrow') + ' Expense Report — ' + reportMode.charAt(0).toUpperCase() + reportMode.slice(1) })]), el('div.card-body', null, [tbl.el])]));

    // --- breakdowns (ported from the production report): Category Split · Payment
    // Modes · Top expenses — all over the same filtered range. -----------------
    function splitCard(title, icon, keyFn) {
      var m = {}; list.forEach(function (e) { var k = keyFn(e) || '—'; m[k] = m[k] || { n: 0, amt: 0 }; m[k].n++; m[k].amt += (+e.amount || 0); });
      var rows2 = Object.keys(m).map(function (k) { return { k: k, n: m[k].n, amt: m[k].amt }; }).sort(function (a, b) { return b.amt - a.amt; });
      var bodyEl = el('div.card-body');
      if (!rows2.length) bodyEl.appendChild(el('div.text-mute.sm', { text: 'Nothing in range.' }));
      rows2.slice(0, 8).forEach(function (r) {
        var pct = grand ? Math.round(r.amt / grand * 100) : 0;
        bodyEl.appendChild(el('div', { style: { marginBottom: '9px' } }, [
          el('div.flex.justify-between.items-center', null, [el('div.fw-600.sm', { text: r.k }), el('div.text-mute.xs', { text: r.n + ' · ' + ui.money(r.amt) + ' · ' + pct + '%' })]),
          el('div', { style: { height: '6px', background: 'var(--surface-3)', borderRadius: '4px', overflow: 'hidden', marginTop: '3px' } }, [
            el('div', { style: { height: '100%', width: Math.max(2, pct) + '%', background: 'var(--accent)', borderRadius: '4px' } })])
        ]));
      });
      return el('div.card', null, [el('div.card-head', null, [el('h3', { html: ui.icon(icon) + ' ' + title })]), bodyEl]);
    }
    var row2 = el('div.two-col');
    row2.appendChild(splitCard('Category Split', 'pie-chart', function (e) { return e.category; }));
    row2.appendChild(splitCard('Payment Modes', 'credit-card', function (e) { return e.method; }));
    page.appendChild(row2);
    var top = list.slice().sort(function (a, b) { return (+b.amount || 0) - (+a.amount || 0); }).slice(0, 6);
    if (top.length) page.appendChild(el('div.card', null, [
      el('div.card-head', null, [el('h3', { html: ui.icon('trophy') + ' Top Expenses' })]),
      el('div.card-body', null, [el('div.data-list', null, top.map(function (e) {
        return el('div.data-row', null, [el('div.flex-1', null, [el('div.fw-600.sm', { text: (e.category || '—') + (e.subCategory ? ' · ' + e.subCategory : '') }), el('div.text-mute.xs', { text: ui.date(e.date) + ' · ' + coName(e.companyId) + (e.party ? ' · ' + e.party : '') })]),
          el('div.strong', { text: ui.money(e.amount) })]);
      }))])
    ]));
  }

  /* ======================================================= MANAGE JOURNALS */
  function journalsView(page) {
    var L = EPAL.ledger;
    if (!L || !L.entries) { page.appendChild(el('div.card', null, [el('div.card-body', { text: 'Ledger unavailable.' })])); return; }
    var list = L.entries(selCo === 'all' ? {} : { companyId: selCo }).slice().reverse();
    function glTotal(e) { var t = 0; (e.lines || []).forEach(function (l) { t += +l.dr || 0; }); return t; }
    if (canCreate()) page.appendChild(el('div.mb-2', null, [el('button.btn.btn-primary', { html: ui.icon('journal-plus') + ' New Journal', onclick: function () { EPAL.router.navigate('group/finance/journal'); } })]));
    var cols = [
      { key: 'date', label: 'Date', date: true }, { key: 'id', label: 'JV', render: function (e) { return '<span class="mono xs text-mute">' + esc(e.id) + '</span>'; } },
      { key: 'memo', label: 'Narration', render: function (e) { return esc(e.memo || e.ref || '—'); } },
      { key: 'source', label: 'Source', badge: { sale: 'good', manual: 'info', opening: 'accent', payroll: 'warn', refund: 'bad', intercompany: 'accent' } },
      { key: 'party', label: 'Party', render: function (e) { return (EPAL.people && EPAL.people.resolve && EPAL.people.resolve(e.party)) ? EPAL.people.linkify(EPAL.people.resolve(e.party).name, EPAL.people.resolve(e.party).id) : esc(e.party || '—'); } },
      { key: 'amount', label: 'Amount', num: true, sortVal: glTotal, render: function (e) { return '<span class="num">' + ui.money(glTotal(e)) + '</span>'; }, exportVal: glTotal }
    ];
    if (selCo === 'all') cols.splice(1, 0, { key: 'companyId', label: 'Company', render: function (e) { return coCell(e.companyId); }, exportVal: function (e) { return e.companyId; } });
    var tbl = EPAL.table({
      columns: cols, rows: list, searchKeys: ['id', 'ref', 'memo', 'party', 'source'], quickFilter: 'source', filterPanel: true,
      filters: selCo === 'all' ? [{ key: 'companyId', label: 'Company' }] : [], dateKey: 'date', totalKey: 'amount',
      pageSize: 15, exportName: 'master-journals.csv', pdfTitle: 'Master Journals — ' + coName(selCo),
      onRow: function (e) { journalDetail(e); },
      empty: { icon: 'journal-text', title: 'No journal entries in this scope' }
    });
    page.appendChild(el('div.card', null, [el('div.card-head', null, [el('h3', { html: ui.icon('journal-text') + ' Manage Journals — ' + coName(selCo) }), el('span.card-sub', { text: 'filter by Source to see its total' })]), el('div.card-body', null, [tbl.el])]));
  }
  function journalDetail(e) {
    var body = el('div');
    ui.modal({ title: e.id, icon: 'journal-text', size: 'md', body: body, footer: false });
    var acc = {}; (EPAL.ledger.accounts() || []).forEach(function (a) { acc[a.code] = a.name; });
    body.appendChild(el('div.card', null, [el('div.card-body', null, [
      el('div.data-list', null, [
        el('div.data-row', null, [el('div.text-mute.sm.flex-1', { text: 'Date / Company' }), el('div.strong', { text: ui.date(e.date) + ' · ' + coName(e.companyId) })]),
        el('div.data-row', null, [el('div.text-mute.sm.flex-1', { text: 'Narration' }), el('div.strong', { text: e.memo || '—' })]),
        el('div.data-row', null, [el('div.text-mute.sm.flex-1', { text: 'Source / Ref' }), el('div.strong', { text: (e.source || '—') + ' · ' + (e.ref || '—') })])
      ]),
      el('div.section-label', { text: 'Lines' }),
      el('div.data-list', null, (e.lines || []).map(function (l) {
        return el('div.data-row', null, [el('div.flex-1.sm', { text: l.account + ' · ' + (acc[l.account] || '') }),
          el('div.num', { text: (l.dr ? 'DR ' + ui.money(l.dr) : 'CR ' + ui.money(l.cr)) })]);
      }))
    ])]));
  }

  /* ======================================================= PAYMENT SCHEDULES */
  function schedulesView(page) {
    var list = db.col('acc_schedules').filter(function (s) { return selCo === 'all' ? true : s.companyId === selCo; })
      .slice().sort(function (a, b) { return (a.due || '') < (b.due || '') ? -1 : 1; });
    var open = list.filter(function (s) { return s.status !== 'Paid'; });
    page.appendChild(el('div.kpi-grid.kpi-compact.stagger', null, [
      kpi('Open Schedules', String(open.length), 'calendar2-week'),
      kpi('Payable', ui.money(open.filter(function (s) { return s.kind === 'Payable'; }).reduce(function (a, s) { return a + (+s.amount || 0); }, 0), { compact: true }), 'arrow-up-right-circle', 'text-warn'),
      kpi('Receivable', ui.money(open.filter(function (s) { return s.kind === 'Receivable'; }).reduce(function (a, s) { return a + (+s.amount || 0); }, 0), { compact: true }), 'arrow-down-left-circle', 'text-good'),
      kpi('Scope', selCo === 'all' ? 'All companies' : coName(selCo), 'diagram-3')
    ]));
    if (canCreate()) page.appendChild(el('div.mb-2', null, [el('button.btn.btn-primary', { html: ui.icon('calendar2-plus') + ' Add Schedule', onclick: function () { masterScheduleForm(null); } })]));
    var cols = [
      { key: 'party', label: 'Party', render: function (s) { return '<span class="strong">' + esc(s.party) + '</span>'; } },
      { key: 'kind', label: 'Type', badge: { Payable: 'bad', Receivable: 'good' } },
      { key: 'priority', label: 'Priority', render: function (s) { var p = s.priority || 'medium'; return '<span class="badge badge-' + (p === 'high' ? 'bad' : p === 'low' ? '' : 'warn') + '">' + esc(p) + '</span>'; }, exportVal: function (s) { return s.priority || 'medium'; } },
      { key: 'due', label: 'Due', date: true, render: function (s) { return ui.date(s.due) + (s.rescheduleCount ? ' <span class="badge badge-warn" title="' + esc(s.rescheduleReason || '') + '">↻' + s.rescheduleCount + '</span>' : ''); } },
      { key: 'amount', label: 'Amount', num: true, money: true },
      { key: 'paidAmount', label: 'Paid', num: true, render: function (s) { return s.paidAmount ? '<span class="text-good">' + ui.money(s.paidAmount) + '</span>' : '—'; }, sortVal: function (s) { return s.paidAmount || 0; } },
      { key: 'status', label: 'Status', badge: { Paid: 'good', Partial: 'warn', Pending: 'bad' } }
    ];
    if (selCo === 'all') cols.splice(1, 0, { key: 'companyId', label: 'Company', render: function (s) { return coCell(s.companyId); }, exportVal: function (s) { return s.companyId; } });
    var tbl = EPAL.table({
      columns: cols, rows: list, searchKeys: ['party', 'desc'], quickFilter: 'status', filterPanel: true,
      filters: [{ key: 'kind', label: 'Type' }, { key: 'priority', label: 'Priority' }].concat(selCo === 'all' ? [{ key: 'companyId', label: 'Company' }] : []),
      dateKey: 'due', totalKey: 'amount', pageSize: 12, exportName: 'master-schedules.csv', pdfTitle: 'Payment Schedules — ' + coName(selCo),
      onRow: function (s) { masterScheduleDetail(s); },
      actions: ui.actions({ edit: canCreate() ? function (s) { masterScheduleForm(s); } : null }),
      empty: { icon: 'calendar2-week', title: 'No schedules in this scope' }
    });
    page.appendChild(el('div.card', null, [el('div.card-head', null, [el('h3', { html: ui.icon('calendar2-week') + ' Payment Schedules — ' + coName(selCo) }), el('span.card-sub', { text: 'click a row: pay (partial → auto-remainder) · reschedule · priority' })]), el('div.card-body', null, [tbl.el])]));
  }
  // detail with the production ERP's lifecycle: Payment Done (partial pay spawns an
  // auto-REMAINDER schedule), Reschedule (keeps count + reason), priority setter.
  function masterScheduleDetail(s) {
    var body = el('div');
    var m = ui.modal({ title: s.party + ' · ' + ui.money(s.amount), icon: 'calendar2-week', size: 'md', body: body, footer: false });
    var acts = el('div.flex.gap-1.flex-wrap', { style: { marginLeft: 'auto' } });
    if (canCreate() && s.status !== 'Paid') {
      acts.appendChild(el('button.btn.btn-sm.btn-primary', { html: ui.icon('cash-coin') + ' Payment Done', onclick: function () { m.close(); schedulePayForm(s); } }));
      acts.appendChild(el('button.btn.btn-sm.btn-outline', { html: ui.icon('calendar2-plus') + ' Reschedule', onclick: function () { m.close(); rescheduleForm(s); } }));
    }
    body.appendChild(el('div.card', null, [el('div.card-body', null, [
      el('div.flex.items-center.gap-2.flex-wrap.mb-3', null, [
        el('div.flex-1', null, [el('div.fw-700', { text: s.party }), el('div.text-mute.sm', { text: (s.kind || '') + ' · ' + coName(s.companyId) + (s.partyType ? ' · ' + s.partyType : '') })]),
        el('span.badge.badge-' + (s.status === 'Paid' ? 'good' : s.status === 'Partial' ? 'warn' : 'bad'), { text: s.status }), acts]),
      el('div.data-list', null, [
        el('div.data-row', null, [el('div.text-mute.sm.flex-1', { text: 'Amount / Paid' }), el('div.strong', { text: ui.money(s.amount) + (s.paidAmount ? ' · paid ' + ui.money(s.paidAmount) : '') })]),
        el('div.data-row', null, [el('div.text-mute.sm.flex-1', { text: 'Due' }), el('div.strong', { text: ui.date(s.due) + (s.rescheduleCount ? ' (rescheduled ×' + s.rescheduleCount + (s.rescheduleReason ? ' — ' + s.rescheduleReason : '') + ')' : '') })]),
        el('div.data-row', null, [el('div.text-mute.sm.flex-1', { text: 'Priority' }), el('div', null, [(function () {
          var sel = el('select.input', { style: { width: 'auto' }, onchange: function () { s.priority = this.value; db.save('acc_schedules', s); ui.toast('Priority set', 'success'); } });
          ['high', 'medium', 'low'].forEach(function (p) { var o = el('option', { value: p, text: p }); if ((s.priority || 'medium') === p) o.selected = true; sel.appendChild(o); });
          return canCreate() ? sel : el('span.badge', { text: s.priority || 'medium' });
        })()])]),
        s.desc ? el('div.data-row', null, [el('div.text-mute.sm.flex-1', { text: 'Note' }), el('div', { text: s.desc })]) : null
      ].filter(Boolean))
    ])]));
  }
  function schedulePayForm(s) {
    var outstanding = (+s.amount || 0) - (+s.paidAmount || 0);
    EPAL.formModal({
      title: 'Payment Done — ' + s.party, icon: 'cash-coin', size: 'sm', record: { amount: outstanding, date: TODAY_STR, method: 'Bank' },
      fields: [
        { key: 'amount', label: 'Paid amount (৳)', type: 'money', required: true, min: 1, max: outstanding, hint: 'Outstanding ' + ui.money(outstanding) + ' — pay less and a REMAINDER schedule is created automatically.' },
        { key: 'date', label: 'Payment date', type: 'date', default: TODAY_STR },
        { key: 'method', label: 'Method', type: 'select', options: METHODS, default: 'Bank' },
        { key: 'remainderDate', label: 'Remainder due date (if partial)', type: 'date' }
      ],
      saveLabel: 'Payment Done',
      onSave: function (v) {
        var amt = Math.min(+v.amount || 0, outstanding);
        if (amt <= 0) { ui.toast('Enter the paid amount', 'error'); return false; }
        var partial = amt < outstanding - 0.001;
        s.paidAmount = (+s.paidAmount || 0) + amt; s.paidDate = v.date; s.payMethod = v.method;
        s.status = 'Paid';
        db.save('acc_schedules', s);
        if (partial) {
          db.save('acc_schedules', { id: 'SCH-' + ui.uid('').slice(-5).toUpperCase(), companyId: s.companyId, party: s.party, partyType: s.partyType,
            kind: s.kind, amount: Math.round(outstanding - amt), due: v.remainderDate || s.due, status: 'Pending', priority: s.priority || 'medium',
            desc: 'Remainder from partial payment (' + s.id + ')' });
          ui.toast('Paid ' + ui.money(amt) + ' — remainder schedule created', 'success');
        } else ui.toast('Payment done', 'success');
        EPAL.router.render(); return true;
      }
    });
  }
  function rescheduleForm(s) {
    EPAL.formModal({
      title: 'Reschedule — ' + s.party, icon: 'calendar2-plus', size: 'sm', record: { due: s.due },
      fields: [
        { key: 'due', label: 'New due date', type: 'date', required: true },
        { key: 'reason', label: 'Reason', type: 'text', required: true }
      ],
      saveLabel: 'Reschedule',
      onSave: function (v) {
        if (!s.originalDue) s.originalDue = s.due;
        s.due = v.due; s.rescheduleCount = (s.rescheduleCount || 0) + 1; s.rescheduleReason = v.reason; s.status = 'Pending';
        db.save('acc_schedules', s);
        ui.toast('Rescheduled to ' + ui.date(v.due), 'success'); EPAL.router.render(); return true;
      }
    });
  }
  function masterScheduleForm(s) {
    EPAL.formModal({
      title: s ? 'Edit Schedule' : 'Add Payment Schedule', icon: 'calendar2-plus', size: 'md',
      record: s || { kind: 'Payable', status: 'Pending', companyId: selCo === 'all' ? 'group' : selCo, due: TODAY_STR },
      fields: [
        { key: 'companyId', label: 'Company', type: 'select', required: true, options: [['group', 'Group HQ']].concat(comps().map(function (c) { return [c.id, c.short]; })) },
        { key: 'party', label: 'Party', type: 'text', required: true },
        { key: 'partyType', label: 'Party type', type: 'select', options: S.list('party_types').map(function (p) { return p.name; }) },
        { key: 'kind', label: 'Kind', type: 'select', options: ['Payable', 'Receivable'], default: 'Payable' },
        { key: 'amount', label: 'Amount (৳)', type: 'money', required: true, min: 1 },
        { key: 'due', label: 'Due date', type: 'date', required: true },
        { key: 'status', label: 'Status', type: 'select', options: ['Pending', 'Partial', 'Paid'], default: 'Pending' },
        { key: 'desc', label: 'Note', type: 'textarea', col2: true }
      ],
      saveLabel: s ? 'Save' : 'Add',
      onSave: function (v) {
        var r = s || { id: 'SCH-' + ui.uid('').slice(-5).toUpperCase() };
        ['companyId', 'party', 'partyType', 'kind', 'due', 'status', 'desc'].forEach(function (k) { r[k] = v[k]; });
        r.amount = +v.amount || 0;
        db.save('acc_schedules', r);
        ui.toast('Schedule saved', 'success'); EPAL.router.render(); return true;
      }
    });
  }

  /* ======================================================= PARTY TYPES */
  function partyTypesView(page) {
    var list = S.list('party_types');
    if (canCreate()) page.appendChild(el('div.mb-2', null, [el('button.btn.btn-primary', { html: ui.icon('plus-lg') + ' New Party Type', onclick: function () { partyTypeForm(null); } })]));
    var tbl = EPAL.table({
      columns: [
        { key: 'name', label: 'Party Type', render: function (p) { return '<span class="strong">' + esc(p.name) + '</span>'; } },
        { key: 'used', label: 'Schedules using it', num: true, render: function (p) { return String(db.col('acc_schedules').filter(function (s) { return s.partyType === p.name; }).length); }, sortVal: function (p) { return db.col('acc_schedules').filter(function (s) { return s.partyType === p.name; }).length; } }
      ],
      rows: list, pageSize: 10, exportName: 'party-types.csv',
      actions: ui.actions({
        edit: canCreate() ? function (p) { partyTypeForm(p); } : null,
        del: canCreate() ? function (p) { ui.confirm({ title: 'Delete party type "' + p.name + '"?', danger: true, confirmLabel: 'Delete' }).then(function (ok) { if (ok) { S.removeFrom('party_types', p.id); ui.toast('Deleted', 'success'); EPAL.router.render(); } }); } : null
      }),
      empty: { icon: 'tags', title: 'No party types' }
    });
    page.appendChild(el('div.card', null, [el('div.card-head', null, [el('h3', { html: ui.icon('tags') + ' Party Types' }), el('span.card-sub', { text: 'used on schedules & party records' })]), el('div.card-body', null, [tbl.el])]));
  }
  function partyTypeForm(p) {
    EPAL.formModal({
      title: p ? 'Edit Party Type' : 'New Party Type', icon: 'tags', size: 'sm', record: p || {},
      fields: [{ key: 'name', label: 'Name', type: 'text', required: true }],
      saveLabel: p ? 'Save' : 'Add',
      onSave: function (v) { var r = p || { id: 'PT-' + ui.uid('').slice(-5).toUpperCase() }; r.name = (v.name || '').trim(); S.upsert('party_types', r); ui.toast('Saved', 'success'); EPAL.router.render(); return true; }
    });
  }

  /* ======================================================= MASTER PAYROLL */
  function payrollView(page) {
    // the company buttons above already switch selCo; the full payroll desk mounts here
    if (EPAL.payrollDesk) EPAL.payrollDesk(page, selCo === 'all' ? 'travels' : selCo);
    else page.appendChild(el('div.card', null, [el('div.card-body', { text: 'Payroll desk unavailable.' })]));
  }

  /* ======================================================= MANAGE BANKS */
  function banksView(page) {
    var banks = db.col('banks').filter(function (b) { return selCo === 'all' ? true : (b.companyId || 'group') === selCo; });
    var total = banks.reduce(function (a, b) { return a + (+b.balance || 0); }, 0);
    page.appendChild(el('div.kpi-grid.kpi-compact.stagger', null, [
      kpi('Cash Position', ui.money(total, { compact: true }), 'safe2'),
      kpi('Accounts', String(banks.length), 'bank'),
      kpi('Scope', selCo === 'all' ? 'All companies' : coName(selCo), 'diagram-3')
    ]));
    var cols = [
      { key: 'name', label: 'Account', render: function (b) { return '<span class="strong">' + esc(b.name) + '</span>'; } },
      { key: 'type', label: 'Type', render: function (b) { return '<span class="badge">' + esc(b.type || 'Bank') + '</span>'; }, exportVal: function (b) { return b.type || 'Bank'; } },
      { key: 'balance', label: 'Balance', num: true, money: true }
    ];
    if (selCo === 'all') cols.splice(1, 0, { key: 'companyId', label: 'Company', render: function (b) { return coCell(b.companyId || 'group'); }, exportVal: function (b) { return b.companyId; } });
    var tbl = EPAL.table({ columns: cols, rows: banks, pageSize: 10, totalKey: 'balance', exportName: 'master-banks.csv', empty: { icon: 'bank', title: 'No accounts in scope' } });
    page.appendChild(el('div.card', null, [
      el('div.card-head', null, [el('h3', { html: ui.icon('bank') + ' Accounts — ' + coName(selCo) }),
        el('a.btn.btn-sm.btn-primary', { href: '#/group/finance/banks', style: { marginLeft: 'auto' }, html: ui.icon('gear') + ' Manage Banks (add · transfer · types)' })]),
      el('div.card-body', null, [tbl.el])
    ]));
  }

})(window.EPAL = window.EPAL || {});
