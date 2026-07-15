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
  // real local today (was a hardcoded seed date — broke TODAY chips + report
  // anchors). Local parts, NOT toISOString(): UTC lands on yesterday in +06.
  var TODAY_STR = (function () { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();
  var METHODS = ['Bank', 'Cash', 'bKash', 'Nagad', 'Debit Card', 'Credit Card', 'Cheque'];
  // OWNER LAYOUT: the group's operational expenses live in ONE section — all
  // expenses, budget setup, the D/W/M/custom report and the combined
  // category + sub-category screen switch with buttons at the top of it.
  // OWNER ORDER: Banks → Payroll → Schedules → Journals → Expenses →
  // Accounts → Party Types (Manage Banks is the landing section)
  var SECTIONS = [['banks', 'Manage Banks'], ['payroll', 'Master Payroll'], ['schedules', 'Payment Schedules'],
    ['journals', 'Manage Journals'], ['expenses', 'Operational Expenses'], ['accounts', 'Manage Accounts'], ['party-types', 'Party Types']];
  var EXP_TABS = [['all', 'All Expenses'], ['budget', 'Budget Setup'], ['report', 'Expense Report'], ['categories', 'Category & Sub-category']];
  var expTab = 'all';                                 // active button inside Operational Expenses
  var selCo = 'all';                                  // the company switcher state
  var reportMode = 'monthly';                         // expense-report period mode
  var reportDate = TODAY_STR;                         // daily / weekly anchor
  var reportMonth = TODAY_STR.slice(0, 7);            // monthly anchor (YYYY-MM)
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
  // AUDIT FIX: one mapper for every screen — the ledger owns the head mapping.
  function expenseAccountFor(cat) {
    if (EPAL.ledger && EPAL.ledger.expenseAccountFor) return EPAL.ledger.expenseAccountFor(cat);
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
      var sub = ctx.subId || 'banks';
      // legacy deep-links from the pre-consolidation layout land on the right tab
      if (sub === 'categories' || sub === 'budget' || sub === 'report') { expTab = sub; sub = 'expenses'; }
      if (!SECTIONS.some(function (s) { return s[0] === sub; })) sub = 'banks';
      var page = el('div.page');
      var titles = {}; SECTIONS.forEach(function (s) { titles[s[0]] = s[1]; });
      page.appendChild(EPAL.pageHead({
        eyebrow: 'Epal Group · Master Accounts', icon: 'safe2', title: titles[sub],
        sub: 'Group-level accounting across every sister concern — switch company with the buttons below.'
      }));
      // section nav — calm underline tabs (primary), per the owner's mock
      var pills = el('div.tab-underline.mb-3');
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
      if (sub === 'expenses') {
        // buttons at the top of the ONE expenses section (owner directive)
        var tb = el('div.pill-tab.mb-3');
        EXP_TABS.forEach(function (t) {
          tb.appendChild(el('button' + (expTab === t[0] ? '.active' : ''), { text: t[1], onclick: function () { expTab = t[0]; EPAL.router.render(); } }));
        });
        page.appendChild(tb);
        ({ all: expensesView, budget: budgetView, report: reportView, categories: categoriesView }[expTab] || expensesView)(page);
      } else {
        ({ accounts: accountsView, journals: journalsView, schedules: schedulesView,
           'party-types': partyTypesView, payroll: payrollView, banks: banksView }[sub])(page);
      }
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
    var catOpts = catList.filter(function (c) { return c.active !== false; }).map(function (c) { return c.name; });
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

  /* ======================================================= CATEGORY & SUB-CATEGORY
   * Production parity: the Category list and the Sub Category list (parent
   * badge · usage · status) live in ONE screen, stacked. */
  function categoriesView(page) {
    var list = cats();
    var subRows = [];
    list.forEach(function (c) { (c.subs || []).forEach(function (s) { subRows.push({ id: c.id + '::' + s, name: s, parent: c.name, parentId: c.id }); }); });
    var activeN = list.filter(function (c) { return c.active !== false; }).length;
    function usedBy(catName, subName) {
      return db.col('acc_entries').filter(function (e) { return e.category === catName && (subName == null || (e.subCategory || '') === subName); }).length;
    }
    page.appendChild(el('div.kpi-grid.kpi-compact.stagger', null, [
      kpi('Categories', String(list.length), 'folder'),
      kpi('Active', String(activeN), 'check-circle'),
      kpi('Inactive', String(list.length - activeN), 'slash-circle'),
      kpi('Sub-categories', String(subRows.length), 'tags')
    ]));
    if (canCreate()) page.appendChild(el('div.flex.gap-1.mb-2', null, [
      el('button.btn.btn-sm.btn-primary', { html: ui.icon('plus-lg') + ' Add Category', onclick: function () { categoryForm(null); } }),
      el('button.btn.btn-sm.btn-outline', { html: ui.icon('plus-lg') + ' Add Sub-category', onclick: function () { subCategoryForm(null); } })
    ]));

    // ---- 1) Expense Category List -------------------------------------------
    var tbl = EPAL.table({
      columns: [
        { key: 'name', label: 'Category', render: function (c) { return '<span class="strong' + (c.active === false ? ' text-mute' : '') + '">' + esc(c.name) + '</span>'; } },
        { key: 'subs', label: 'Sub-categories', render: function (c) { return (c.subs || []).length ? (c.subs || []).map(function (s) { return '<span class="badge">' + esc(s) + '</span>'; }).join(' ') : '—'; }, exportVal: function (c) { return (c.subs || []).join('; '); } },
        { key: 'used', label: 'Entries', num: true, sortVal: function (c) { return usedBy(c.name); }, render: function (c) { return String(usedBy(c.name)); } },
        { key: 'active', label: 'Status', render: function (c) { return c.active === false ? '<span class="badge">Inactive</span>' : '<span class="badge badge-good">Active</span>'; }, exportVal: function (c) { return c.active === false ? 'Inactive' : 'Active'; } }
      ],
      rows: list, searchKeys: ['name'], pageSize: 12, exportName: 'expense-categories.csv',
      actions: canCreate() ? [
        { icon: 'pencil', title: 'Edit', onClick: function (c) { categoryForm(c); } },
        { icon: 'power', title: 'Activate / deactivate', onClick: function (c) {
          c.active = c.active === false;                 // toggle; inactive heads leave the pickers
          S.upsert('exp_categories', c);
          ui.toast('Category ' + (c.active === false ? 'deactivated' : 'reactivated'), 'success'); EPAL.router.render();
        } },
        { icon: 'trash', title: 'Delete', onClick: function (c) {
          if (usedBy(c.name)) { ui.toast('In use by expenses — rename or deactivate instead', 'error'); return; }
          ui.confirm({ title: 'Delete category "' + c.name + '"?', danger: true, confirmLabel: 'Delete' }).then(function (ok) { if (ok) { S.removeFrom('exp_categories', c.id); ui.toast('Deleted', 'success'); EPAL.router.render(); } });
        } }
      ] : [],
      empty: { icon: 'folder', title: 'No categories' }
    });
    page.appendChild(el('div.card.mb-2', null, [el('div.card-head', null, [el('h3', { html: ui.icon('folder') + ' Expense Category List' })]), el('div.card-body', null, [tbl.el])]));

    // ---- 2) Sub Category List (parent badge, like the production screen) ----
    var st = EPAL.table({
      columns: [
        { key: 'name', label: 'Sub Category', render: function (r) { return '<span class="strong">' + esc(r.name) + '</span>'; } },
        { key: 'parent', label: 'Parent Category', render: function (r) { return '<span class="badge badge-info">' + esc(r.parent) + '</span>'; } },
        { key: 'used', label: 'Entries', num: true, sortVal: function (r) { return usedBy(r.parent, r.name); }, render: function (r) { return String(usedBy(r.parent, r.name)); } }
      ],
      rows: subRows, searchKeys: ['name', 'parent'], pageSize: 12, exportName: 'expense-sub-categories.csv',
      filters: [{ key: 'parent', label: 'Parent' }],
      actions: canCreate() ? [
        { icon: 'pencil', title: 'Edit / move', onClick: function (r) { subCategoryForm(r); } },
        { icon: 'trash', title: 'Delete', onClick: function (r) {
          if (usedBy(r.parent, r.name)) { ui.toast('In use by expenses — rename instead', 'error'); return; }
          ui.confirm({ title: 'Delete sub-category "' + r.name + '"?', danger: true, confirmLabel: 'Delete' }).then(function (ok) {
            if (!ok) return;
            var c = cats().filter(function (x) { return x.id === r.parentId; })[0];
            if (c) { c.subs = (c.subs || []).filter(function (s) { return s !== r.name; }); S.upsert('exp_categories', c); }
            ui.toast('Deleted', 'success'); EPAL.router.render();
          });
        } }
      ] : [],
      empty: { icon: 'tags', title: 'No sub-categories', hint: 'Add one with Add Sub-category.' }
    });
    page.appendChild(el('div.card', null, [el('div.card-head', null, [el('h3', { html: ui.icon('tags') + ' Sub Category List' })]), el('div.card-body', null, [st.el])]));
  }
  function subCategoryForm(row) {
    var list = cats();
    if (!list.length) { ui.toast('Create a category first', 'error'); return; }
    EPAL.formModal({
      title: row ? 'Edit Sub-category' : 'Add Sub-category', icon: 'tags', size: 'sm',
      record: row ? { parentId: row.parentId, name: row.name } : { parentId: list[0].id },
      fields: [
        { key: 'parentId', label: 'Parent category', type: 'select', required: true, options: list.map(function (c) { return [c.id, c.name]; }) },
        { key: 'name', label: 'Sub-category name', type: 'text', required: true }
      ],
      saveLabel: row ? 'Save' : 'Add',
      onSave: function (v) {
        var name = (v.name || '').trim(); if (!name) { ui.toast('Enter a name', 'error'); return false; }
        var target = list.filter(function (c) { return c.id === v.parentId; })[0];
        if (!target) { ui.toast('Pick a parent category', 'error'); return false; }
        var dupe = (target.subs || []).some(function (s) { return s.toLowerCase() === name.toLowerCase() && !(row && row.parentId === target.id && row.name === s); });
        if (dupe) { ui.toast('"' + name + '" already exists under ' + target.name, 'error'); return false; }
        if (row) {
          // remove from the old parent + cascade the rename/move onto expenses
          var old = list.filter(function (c) { return c.id === row.parentId; })[0];
          if (old) { old.subs = (old.subs || []).filter(function (s) { return s !== row.name; }); S.upsert('exp_categories', old); }
          db.col('acc_entries').forEach(function (e) {
            if (e.category === row.parent && (e.subCategory || '') === row.name) { e.category = target.name; e.subCategory = name; db.save('acc_entries', e); }
          });
        }
        target.subs = (target.subs || []).concat([name]);
        S.upsert('exp_categories', target);
        ui.toast('Sub-category saved', 'success'); EPAL.router.render(); return true;
      }
    });
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
        { key: 'category', label: 'Category', type: 'select', required: true, options: cats().filter(function (c) { return c.active !== false; }).map(function (c) { return c.name; }) },
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

  /* ======================================================= EXPENSE REPORT
   * Production parity (Expense Report screen): reports the OFFICE /
   * operational expenses only (the acc_entries register — never payroll
   * accruals or sales money). Pick ONE period — a day, a week, a month
   * (month + year selects) or a custom range — and get the Total / Active
   * transaction KPIs, a day-by-day Period Overview (zero days included) and
   * the category / payment-mode breakdowns, with Print. */
  function reportView(page) {
    var modes = [['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly'], ['custom', 'Custom']];
    var bar = el('div.pill-tab.mb-2');
    modes.forEach(function (m) { bar.appendChild(el('button' + (reportMode === m[0] ? '.active' : ''), { text: m[1], onclick: function () { reportMode = m[0]; EPAL.router.render(); } })); });
    page.appendChild(bar);

    // ---- resolve the selected period into a [from..to] day range ----------
    function addDays(iso, n) {
      // format from LOCAL date parts — toISOString() shifts to UTC and lands
      // on the previous day in +06 Dhaka time
      var d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n);
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
    var from, to, periodLabel;
    if (reportMode === 'daily') { from = to = reportDate; periodLabel = ui.date(reportDate); }
    else if (reportMode === 'weekly') {
      var dow = (new Date(reportDate + 'T00:00:00').getDay() + 6) % 7;      // Monday-start week
      from = addDays(reportDate, -dow); to = addDays(from, 6);
      periodLabel = 'Week of ' + ui.date(from);
    } else if (reportMode === 'monthly') {
      from = reportMonth + '-01';
      var y = +reportMonth.slice(0, 4), mo = +reportMonth.slice(5, 7);
      to = reportMonth + '-' + String(new Date(y, mo, 0).getDate()).padStart(2, '0');
      periodLabel = new Date(from + 'T00:00:00').toLocaleString('en', { month: 'long' }) + ' ' + y;
    } else { from = reportFrom; to = reportTo; periodLabel = ui.date(from) + ' – ' + ui.date(to); }
    if (from > to) { var sw = from; from = to; to = sw; }

    // ---- the period picker row (per mode, like the production filters) ----
    var picker = el('div.flex.gap-2.items-center.flex-wrap.mb-2');
    if (reportMode === 'daily' || reportMode === 'weekly') {
      picker.appendChild(el('span.text-mute.sm', { text: reportMode === 'daily' ? 'Date' : 'Any day in the week' }));
      picker.appendChild(el('input.input', { type: 'date', value: reportDate, onchange: function () { reportDate = this.value || TODAY_STR; EPAL.router.render(); } }));
    } else if (reportMode === 'monthly') {
      var mSel = el('select.input', { style: { width: 'auto' }, onchange: function () { reportMonth = reportMonth.slice(0, 4) + '-' + this.value; EPAL.router.render(); } });
      for (var mi = 1; mi <= 12; mi++) { var mv = String(mi).padStart(2, '0'); var o = el('option', { value: mv, text: new Date(2026, mi - 1, 1).toLocaleString('en', { month: 'long' }) }); if (reportMonth.slice(5, 7) === mv) o.selected = true; mSel.appendChild(o); }
      var ySel = el('input.input', { type: 'number', value: reportMonth.slice(0, 4), min: 2020, max: 2040, style: { width: '110px' },
        onchange: function () { var yv = String(this.value || '2026'); reportMonth = yv + '-' + reportMonth.slice(5, 7); EPAL.router.render(); } });
      picker.appendChild(el('span.text-mute.sm', { text: 'Month' })); picker.appendChild(mSel);
      picker.appendChild(el('span.text-mute.sm', { text: 'Year' })); picker.appendChild(ySel);
    } else {
      picker.appendChild(el('span.text-mute.sm', { text: 'From' }));
      picker.appendChild(el('input.input', { type: 'date', value: reportFrom, onchange: function () { reportFrom = this.value; EPAL.router.render(); } }));
      picker.appendChild(el('span.text-mute.sm', { text: 'to' }));
      picker.appendChild(el('input.input', { type: 'date', value: reportTo, onchange: function () { reportTo = this.value; EPAL.router.render(); } }));
    }
    picker.appendChild(el('button.btn.btn-sm.btn-outline', { style: { marginLeft: 'auto' }, html: ui.icon('arrow-left') + ' Back to Expenses', onclick: function () { expTab = 'all'; EPAL.router.render(); } }));
    picker.appendChild(el('button.btn.btn-sm.btn-primary', { html: ui.icon('printer') + ' Print', onclick: function () { printReport(); } }));
    page.appendChild(picker);

    // ---- office expenses inside the selected period ------------------------
    var list = entriesFor('Expense').filter(function (e) { var d = String(e.date).slice(0, 10); return d >= from && d <= to; });
    var total = list.reduce(function (a, e) { return a + (+e.amount || 0); }, 0);
    page.appendChild(el('div.kpi-grid.kpi-compact.stagger', null, [
      kpi('Total Transactions', String(list.length), 'card-list'),
      kpi('Total Amount', ui.money(total, { compact: true }), 'cash-stack'),
      kpi('Active Transactions', String(list.length), 'check-circle'),
      kpi('Average Amount', list.length ? ui.money(total / list.length, { compact: true }) : '৳0', 'distribute-vertical')
    ]));

    // ---- Period Overview — one row per day, zero days included -------------
    var byDay = {};
    list.forEach(function (e) {
      var d = String(e.date).slice(0, 10);
      byDay[d] = byDay[d] || { n: 0, total: 0 };
      byDay[d].n++; byDay[d].total += (+e.amount || 0);
    });
    var days = [];
    for (var d2 = from, guard = 0; d2 <= to && guard < 370; d2 = addDays(d2, 1), guard++) {
      days.push({ date: d2, n: (byDay[d2] || {}).n || 0, total: (byDay[d2] || {}).total || 0, active: (byDay[d2] || {}).total || 0 });
    }
    var tbl = EPAL.table({
      columns: [
        { key: 'date', label: 'Date', date: true, render: function (r) { return '<span class="strong">' + ui.date(r.date) + '</span>' + (r.date === TODAY_STR ? ' <span class="badge badge-warn">TODAY</span>' : ''); } },
        { key: 'n', label: 'Transactions', num: true },
        { key: 'total', label: 'Total Amount', num: true, money: true },
        { key: 'active', label: 'Active Amount', num: true, money: true }
      ],
      rows: days, pageSize: 16, totalKey: 'total', exportName: 'expense-report-' + reportMode + '.csv',
      pdfTitle: 'Expense Report (' + periodLabel + ') — ' + coName(selCo),
      empty: { icon: 'graph-down', title: 'No days in range' }
    });
    page.appendChild(el('div.card.mb-2', null, [
      el('div.card-head', null, [el('h3', { html: ui.icon('graph-down-arrow') + ' Period Overview' }),
        el('span.card-sub', { text: periodLabel + ' · ' + list.length + ' transaction' + (list.length === 1 ? '' : 's') })]),
      el('div.card-body', null, [tbl.el])
    ]));
    var grand = total;
    function printReport() {
      var catM = {}; list.forEach(function (e) { var k = e.category || '—'; catM[k] = (catM[k] || 0) + (+e.amount || 0); });
      var catRows = Object.keys(catM).sort(function (a, b) { return catM[b] - catM[a]; })
        .map(function (k) { return '<tr><td>' + esc(k) + '</td><td class="num">' + ui.money(catM[k]) + '</td></tr>'; }).join('');
      var dayRows = days.filter(function (r) { return r.n > 0; })
        .map(function (r) { return '<tr><td>' + ui.date(r.date) + '</td><td class="num">' + r.n + '</td><td class="num">' + ui.money(r.total) + '</td></tr>'; }).join('');
      var html = '<html><head><title>Expense Report — ' + esc(periodLabel) + '</title><style>' +
        'body{font-family:Arial,sans-serif;color:#111;margin:36px;font-size:13px}h1{font-size:19px;margin:0}.mut{color:#555}' +
        '.head{display:flex;justify-content:space-between;border-bottom:2px solid #111;padding-bottom:10px;margin-bottom:14px}' +
        'table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border:1px solid #999;padding:6px 9px;text-align:left}' +
        'th{background:#eef1f6}.num{text-align:right;font-variant-numeric:tabular-nums}h2{font-size:14px;margin:18px 0 0}' +
        '</style></head><body>' +
        '<div class="head"><div><h1>EPAL GROUP</h1><div class="mut">' + esc(coName(selCo)) + ' · Operational Expenses</div></div>' +
        '<div style="text-align:right"><h1>EXPENSE REPORT</h1><div class="mut">' + esc(periodLabel) + '</div></div></div>' +
        '<div><b>Transactions:</b> ' + list.length + ' &nbsp; <b>Total:</b> ' + ui.money(grand) +
        ' &nbsp; <b>Average:</b> ' + (list.length ? ui.money(grand / list.length) : '—') + '</div>' +
        '<h2>Day by day</h2><table><thead><tr><th>Date</th><th class="num">Transactions</th><th class="num">Total</th></tr></thead><tbody>' +
        (dayRows || '<tr><td colspan="3" class="mut">No transactions in this period.</td></tr>') + '</tbody></table>' +
        '<h2>Category split</h2><table><thead><tr><th>Category</th><th class="num">Amount</th></tr></thead><tbody>' +
        (catRows || '<tr><td colspan="2" class="mut">No category data.</td></tr>') + '</tbody></table>' +
        '<script>window.print()<\/script></body></html>';
      var w = window.open('', '_blank'); if (!w) { ui.toast('Allow pop-ups to print', 'error'); return; }
      w.document.write(html); w.document.close();
    }

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

  /* ======================================================= MANAGE JOURNALS
   * Production parity (JournalController): Credit Journal (money IN — the
   * bank is debited), Debit Journal (money OUT — the bank is credited),
   * Opening Balance entries vs Retained Earnings that auto-create payment
   * schedules, per-entry debit/credit totals with a Balanced badge, and a
   * printable voucher per entry. */
  function journalsView(page) {
    var L = EPAL.ledger;
    if (!L || !L.entries) { page.appendChild(el('div.card', null, [el('div.card-body', { text: 'Ledger unavailable.' })])); return; }
    var list = L.entries(selCo === 'all' ? {} : { companyId: selCo }).slice().reverse();
    function drTotal(e) { var t = 0; (e.lines || []).forEach(function (l) { t += +l.dr || 0; }); return t; }
    function crTotal(e) { var t = 0; (e.lines || []).forEach(function (l) { t += +l.cr || 0; }); return t; }
    var sumDr = 0, sumCr = 0, balancedN = 0;
    list.forEach(function (e) { var d = drTotal(e), c = crTotal(e); sumDr += d; sumCr += c; if (Math.abs(d - c) < 0.01) balancedN++; });
    page.appendChild(el('div.kpi-grid.kpi-compact.stagger', null, [
      kpi('Total Entries', String(list.length), 'journal-text'),
      kpi('Total Debit', ui.money(sumDr, { compact: true }), 'arrow-up-circle'),
      kpi('Total Credit', ui.money(sumCr, { compact: true }), 'arrow-down-circle'),
      kpi('Balanced', balancedN + ' / ' + list.length, 'check-circle', balancedN === list.length ? 'text-good' : 'text-warn')
    ]));
    if (canCreate()) {
      page.appendChild(el('div.flex.gap-1.flex-wrap.mb-2', null, [
        el('button.btn.btn-sm.btn-primary', { html: ui.icon('arrow-down-circle') + ' Credit Journal (Money In)', onclick: function () { bankJournalForm('credit'); } }),
        el('button.btn.btn-sm.btn-outline', { html: ui.icon('arrow-up-circle') + ' Debit Journal (Money Out)', onclick: function () { bankJournalForm('debit'); } }),
        el('button.btn.btn-sm.btn-outline', { html: ui.icon('layers') + ' Opening Receivable', onclick: function () { openingPartyForm('Receivable'); } }),
        el('button.btn.btn-sm.btn-outline', { html: ui.icon('layers') + ' Opening Payable', onclick: function () { openingPartyForm('Payable'); } }),
        el('button.btn.btn-sm.btn-outline', { html: ui.icon('layers-half') + ' Opening Asset', onclick: function () { openingAssetForm(); } })
      ]));
    }
    var cols = [
      { key: 'date', label: 'Date', date: true },
      { key: 'ref', label: 'Reference', render: function (e) { return '<span class="mono xs text-mute">' + esc(e.ref || e.id) + '</span>'; } },
      { key: 'source', label: 'Source', badge: { sale: 'good', manual: 'info', opening: 'accent', payroll: 'warn', refund: 'bad', intercompany: 'accent', bank: 'info', payment: 'good' } },
      { key: 'memo', label: 'Description', render: function (e) { return esc(e.memo || '—'); } },
      { key: 'dr', label: 'Total Debit', num: true, sortVal: drTotal, render: function (e) { return '<span class="num">' + ui.money(drTotal(e)) + '</span>'; }, exportVal: drTotal },
      { key: 'cr', label: 'Total Credit', num: true, sortVal: crTotal, render: function (e) { return '<span class="num">' + ui.money(crTotal(e)) + '</span>'; }, exportVal: crTotal },
      { key: 'bal', label: 'Balanced', render: function (e) { return Math.abs(drTotal(e) - crTotal(e)) < 0.01 ? '<span class="badge badge-good">✓ Yes</span>' : '<span class="badge badge-bad">No</span>'; }, exportVal: function (e) { return Math.abs(drTotal(e) - crTotal(e)) < 0.01 ? 'Yes' : 'No'; } }
    ];
    if (selCo === 'all') cols.splice(1, 0, { key: 'companyId', label: 'Company', render: function (e) { return coCell(e.companyId); }, exportVal: function (e) { return e.companyId; } });
    var tbl = EPAL.table({
      columns: cols, rows: list, searchKeys: ['id', 'ref', 'memo', 'party', 'source'], quickFilter: 'source', filterPanel: true,
      filters: selCo === 'all' ? [{ key: 'companyId', label: 'Company' }] : [], dateKey: 'date',
      pageSize: 15, exportName: 'master-journals.csv', pdfTitle: 'Master Journals — ' + coName(selCo),
      onRow: function (e) { journalDetail(e); },
      actions: [
        { icon: 'eye', title: 'View lines', onClick: function (e) { journalDetail(e); } },
        { icon: 'printer', title: 'Print voucher', onClick: function (e) { journalVoucherPrint(e); } }
      ],
      empty: { icon: 'journal-text', title: 'No journal entries in this scope' }
    });
    page.appendChild(el('div.card', null, [el('div.card-head', null, [el('h3', { html: ui.icon('journal-text') + ' Journal Entries — ' + coName(selCo) }), el('span.card-sub', { text: 'filter by Source to see its total' })]), el('div.card-body', null, [tbl.el])]));
  }
  // Credit Journal (money IN): DR bank control / CR income-liability-equity.
  // Debit Journal (money OUT): DR expense-asset / CR bank control.
  function bankJournalForm(kind, presetBankId) {
    var isCr = kind === 'credit';
    var banks = db.col('banks').filter(function (b) { return (b.status || 'Active') !== 'Inactive'; });
    if (!banks.length) { ui.toast('Add a bank account first (Manage Banks)', 'error'); return; }
    var accts = EPAL.ledger.accounts().filter(function (a) {
      return a.active !== false && (isCr ? (a.type === 'income' || a.type === 'liability' || a.type === 'equity')
                                          : (a.type === 'expense' || a.type === 'asset'));
    });
    EPAL.formModal({
      title: isCr ? 'Credit Journal — Money In' : 'Debit Journal — Money Out', icon: isCr ? 'arrow-down-circle' : 'arrow-up-circle', size: 'md',
      record: { date: TODAY_STR, companyId: selCo === 'all' ? 'group' : selCo, bankId: presetBankId || banks[0].id },
      fields: [
        { key: 'companyId', label: 'Company', type: 'select', required: true, options: [['group', 'Group HQ']].concat(comps().map(function (c) { return [c.id, c.short]; })) },
        { key: 'date', label: 'Date', type: 'date', required: true, default: TODAY_STR },
        { key: 'bankId', label: 'Bank', type: 'select', required: true, options: banks.map(function (b) { return [b.id, b.name + ' (' + ui.money(b.balance, { compact: true }) + ')']; }) },
        { key: 'account', label: isCr ? 'Credit account' : 'Debit account', type: 'select', required: true, options: accts.map(function (a) { return [a.code, a.code + ' · ' + a.name]; }) },
        { key: 'amount', label: 'Amount (৳)', type: 'money', required: true, min: 1 },
        { key: 'ref', label: 'Reference', type: 'text', placeholder: 'e.g. JV-001' },
        { key: 'desc', label: 'Description', type: 'textarea', col2: true }
      ],
      saveLabel: isCr ? 'Save Credit Journal' : 'Save Debit Journal',
      onSave: function (v) {
        var amt = +v.amount || 0; if (amt <= 0) { ui.toast('Enter an amount', 'error'); return false; }
        var bank = db.col('banks').filter(function (b) { return b.id === v.bankId; })[0];
        if (!bank) { ui.toast('Pick a bank', 'error'); return false; }
        if (!isCr && (+bank.balance || 0) < amt) { ui.toast('Insufficient balance — available ' + ui.money(bank.balance), 'error'); return false; }
        var memo = (isCr ? 'Deposit to ' : 'Withdrawal from ') + bank.name + (v.desc ? ' — ' + v.desc : '');
        var glId = 'GL-BK-' + ui.uid('').slice(-6).toUpperCase();
        try {
          EPAL.ledger.post({ id: glId, date: v.date, companyId: v.companyId,
            ref: v.ref || ('BANK-' + (isCr ? 'DEP' : 'WDR')), memo: memo, source: 'bank',
            lines: isCr ? [{ account: '1010', dr: amt, cr: 0 }, { account: v.account, dr: 0, cr: amt }]
                        : [{ account: v.account, dr: amt, cr: 0 }, { account: '1010', dr: 0, cr: amt }] });
        } catch (e) { ui.toast(e.message || 'Ledger post failed', 'error'); return false; }
        bankTxnApply(bank, isCr ? 'deposit' : 'withdraw', amt, v.date, memo, v.ref || '', glId);
        ui.toast((isCr ? 'Credit' : 'Debit') + ' journal posted', 'success'); EPAL.router.render(); return true;
      }
    });
  }
  // Opening Receivable / Payable — party rows against Retained Earnings (3100);
  // rows with a due date auto-create payment schedules (production behaviour).
  function openingPartyForm(kind) {
    var isRcv = kind === 'Receivable';
    EPAL.formModal({
      title: 'Opening ' + kind + ' Balances', icon: 'layers', size: 'md',
      record: { date: '2026-07-01', companyId: selCo === 'all' ? 'group' : selCo },
      fields: [
        { key: 'companyId', label: 'Company', type: 'select', required: true, options: [['group', 'Group HQ']].concat(comps().map(function (c) { return [c.id, c.short]; })) },
        { key: 'date', label: 'As-of date', type: 'date', required: true },
        { key: 'items', type: 'items', label: kind + ' rows (a due date auto-creates a payment schedule)', required: true, min: 1, addLabel: 'Add party',
          columns: [
            { key: 'party', label: 'Party name', type: 'text', width: '1.6fr' },
            { key: 'amount', label: 'Amount', type: 'money', width: '1fr' },
            { key: 'due', label: 'Due date', type: 'date', width: '1fr' }
          ] }
      ],
      saveLabel: 'Post Opening ' + kind,
      onSave: function (v) {
        var rows = (v.items || []).map(function (i) { return { party: (i.party || '').trim(), amount: +i.amount || 0, due: i.due || '' }; })
          .filter(function (i) { return i.party && i.amount > 0; });
        if (!rows.length) { ui.toast('Add at least one party row', 'error'); return false; }
        try {
          rows.forEach(function (r) {
            var ctrl = isRcv ? (EPAL.ledger.isAgentParty && EPAL.ledger.isAgentParty(r.party) ? '1150' : '1200') : '2000';
            EPAL.ledger.post({ id: 'GL-OP' + (isRcv ? 'RC' : 'PY') + '-' + ui.uid('').slice(-6).toUpperCase(), date: v.date,
              companyId: v.companyId, ref: 'OPENING', memo: 'Opening ' + kind.toLowerCase() + ' · ' + r.party,
              source: 'opening', party: r.party, override: true,
              lines: isRcv ? [{ account: ctrl, dr: r.amount, cr: 0 }, { account: '3100', dr: 0, cr: r.amount }]
                           : [{ account: '3100', dr: r.amount, cr: 0 }, { account: ctrl, dr: 0, cr: r.amount }] });
            if (r.due) db.save('acc_schedules', { id: 'SCH-' + ui.uid('').slice(-5).toUpperCase(), companyId: v.companyId,
              party: r.party, kind: kind, amount: r.amount, due: r.due, status: 'Pending', priority: 'medium',
              desc: 'Opening ' + kind.toLowerCase() + ' balance' });
          });
        } catch (e) { ui.toast(e.message || 'Ledger post failed', 'error'); return false; }
        ui.toast('Opening ' + kind.toLowerCase() + ' posted (' + rows.length + ' parties)', 'success'); EPAL.router.render(); return true;
      }
    });
  }
  // Opening Asset — asset rows in one balanced entry against 3100.
  function openingAssetForm() {
    var assets = EPAL.ledger.accounts().filter(function (a) { return a.type === 'asset' && a.active !== false; });
    EPAL.formModal({
      title: 'Opening Asset Balances', icon: 'layers-half', size: 'md',
      record: { date: '2026-07-01', companyId: selCo === 'all' ? 'group' : selCo },
      fields: [
        { key: 'companyId', label: 'Company', type: 'select', required: true, options: [['group', 'Group HQ']].concat(comps().map(function (c) { return [c.id, c.short]; })) },
        { key: 'date', label: 'As-of date', type: 'date', required: true },
        { key: 'items', type: 'items', label: 'Asset rows', required: true, min: 1, addLabel: 'Add asset',
          columns: [
            { key: 'account', label: 'Asset account', type: 'select', options: assets.map(function (a) { return [a.code, a.code + ' · ' + a.name]; }), width: '1.6fr' },
            { key: 'amount', label: 'Amount', type: 'money', width: '1fr' }
          ] }
      ],
      saveLabel: 'Post Opening Assets',
      onSave: function (v) {
        var rows = (v.items || []).map(function (i) { return { account: i.account, amount: +i.amount || 0 }; }).filter(function (i) { return i.account && i.amount > 0; });
        if (!rows.length) { ui.toast('Add at least one asset row', 'error'); return false; }
        var total = rows.reduce(function (a, r) { return a + r.amount; }, 0);
        var lines = rows.map(function (r) { return { account: r.account, dr: r.amount, cr: 0 }; });
        lines.push({ account: '3100', dr: 0, cr: total });
        try {
          EPAL.ledger.post({ id: 'GL-OPAS-' + ui.uid('').slice(-6).toUpperCase(), date: v.date, companyId: v.companyId,
            ref: 'OPENING', memo: 'Opening asset balances', source: 'opening', override: true, lines: lines });
        } catch (e) { ui.toast(e.message || 'Ledger post failed', 'error'); return false; }
        ui.toast('Opening assets posted ' + ui.money(total), 'success'); EPAL.router.render(); return true;
      }
    });
  }
  // printable JOURNAL VOUCHER (production journals.voucher)
  function journalVoucherPrint(e) {
    var acc = {}; (EPAL.ledger.accounts() || []).forEach(function (a) { acc[a.code] = a.name; });
    var dr = 0, cr = 0;
    var rows = (e.lines || []).map(function (l) {
      dr += +l.dr || 0; cr += +l.cr || 0;
      return '<tr><td>' + esc(l.account) + ' · ' + esc(acc[l.account] || '') + '</td>' +
        '<td class="num">' + (l.dr ? ui.money(l.dr) : '—') + '</td><td class="num">' + (l.cr ? ui.money(l.cr) : '—') + '</td></tr>';
    }).join('');
    var html = '<html><head><title>Journal Voucher ' + esc(e.id) + '</title><style>' +
      'body{font-family:Arial,sans-serif;color:#111;margin:36px;font-size:13px}' +
      'h1{font-size:19px;margin:0}.mut{color:#555}.head{display:flex;justify-content:space-between;border-bottom:2px solid #111;padding-bottom:10px;margin-bottom:14px}' +
      'table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border:1px solid #999;padding:6px 9px;text-align:left}' +
      'th{background:#eef1f6}.num{text-align:right;font-variant-numeric:tabular-nums}tfoot td{font-weight:700;background:#f4f6fa}' +
      '.sig{display:flex;justify-content:space-between;margin-top:64px}.sig div{border-top:1px solid #333;width:30%;text-align:center;padding-top:6px}' +
      '</style></head><body>' +
      '<div class="head"><div><h1>EPAL GROUP</h1><div class="mut">' + esc(coName(e.companyId)) + '</div></div>' +
      '<div style="text-align:right"><h1>JOURNAL VOUCHER</h1><div class="mut">' + esc(e.id) + '</div></div></div>' +
      '<div><b>Date:</b> ' + ui.date(e.date) + ' &nbsp; <b>Reference:</b> ' + esc(e.ref || '—') + ' &nbsp; <b>Source:</b> ' + esc(e.source || '—') +
      (e.party ? ' &nbsp; <b>Party:</b> ' + esc(e.party) : '') + '</div>' +
      (e.memo ? '<div class="mut" style="margin-top:6px">' + esc(e.memo) + '</div>' : '') +
      '<table><thead><tr><th>Account</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead>' +
      '<tbody>' + rows + '</tbody><tfoot><tr><td>Totals</td><td class="num">' + ui.money(dr) + '</td><td class="num">' + ui.money(cr) + '</td></tr></tfoot></table>' +
      '<div class="sig"><div>Prepared By</div><div>Checked By</div><div>Approved By</div></div>' +
      '<script>window.print()<\/script></body></html>';
    var w = window.open('', '_blank'); if (!w) { ui.toast('Allow pop-ups to print', 'error'); return; }
    w.document.write(html); w.document.close();
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

  /* ======================================================= PAYMENT SCHEDULES
   * Production parity (PaymentScheduleController): RECEIVABLE and PAYABLE as
   * two stacked sections with their own totals; TODAY / OVERDUE chips;
   * approve · reschedule (count + reason) · cancel · payment-done (partial
   * spawns a remainder schedule) actions per row; inline priority. */
  function schedulesView(page) {
    var list = db.col('acc_schedules').filter(function (s) { return selCo === 'all' ? true : s.companyId === selCo; })
      .slice().sort(function (a, b) { return (a.due || '') < (b.due || '') ? -1 : 1; });
    var open = list.filter(function (s) { return s.status !== 'Paid' && s.status !== 'Cancelled'; });
    var dueToday = open.filter(function (s) { return s.due === TODAY_STR; });
    var overdue = open.filter(function (s) { return (s.due || '') < TODAY_STR; });
    page.appendChild(el('div.kpi-grid.kpi-compact.stagger', null, [
      kpi('Open Schedules', String(open.length), 'calendar2-week'),
      kpi('Due Today', ui.money(dueToday.reduce(function (a, s) { return a + (+s.amount || 0) - (+s.paidAmount || 0); }, 0), { compact: true }), 'alarm', dueToday.length ? 'text-warn' : null),
      kpi('Overdue', ui.money(overdue.reduce(function (a, s) { return a + (+s.amount || 0) - (+s.paidAmount || 0); }, 0), { compact: true }), 'exclamation-octagon', overdue.length ? 'text-bad' : null),
      kpi('Scope', selCo === 'all' ? 'All companies' : coName(selCo), 'diagram-3')
    ]));
    if (canCreate()) page.appendChild(el('div.mb-2', null, [el('button.btn.btn-sm.btn-primary', { html: ui.icon('calendar2-plus') + ' Add Schedule', onclick: function () { masterScheduleForm(null); } })]));

    function section(kind, icon, sub) {
      var rows = list.filter(function (s) { return (s.kind || 'Payable') === kind; });
      var openTotal = rows.filter(function (s) { return s.status !== 'Paid' && s.status !== 'Cancelled'; })
        .reduce(function (a, s) { return a + (+s.amount || 0) - (+s.paidAmount || 0); }, 0);
      var cols = [
        { key: 'party', label: 'Party', render: function (s) { return '<span class="strong">' + esc(s.party) + '</span>' + (s.partyType ? '<div class="text-mute xs">' + esc(s.partyType) + '</div>' : ''); } },
        { key: 'id', label: 'Reference', render: function (s) { return '<span class="mono xs text-mute">' + esc(s.ref || s.id) + '</span>'; } },
        { key: 'due', label: 'Scheduled Date', date: true, render: function (s) {
          var chip = '';
          if (s.status !== 'Paid' && s.status !== 'Cancelled') {
            if (s.due === TODAY_STR) chip = ' <span class="badge badge-warn">TODAY</span>';
            else if ((s.due || '') < TODAY_STR) chip = ' <span class="badge badge-bad">OVERDUE</span>';
          }
          return ui.date(s.due) + chip + (s.rescheduleCount ? ' <span class="badge" title="' + esc(s.rescheduleReason || '') + '">↻' + s.rescheduleCount + '</span>' : '');
        } },
        { key: 'desc', label: 'Note', render: function (s) { return s.desc ? '<span class="text-mute sm">' + esc(String(s.desc).slice(0, 60)) + '</span>' : '—'; } },
        { key: 'priority', label: 'Priority', render: function (s) { var p = s.priority || 'medium'; return '<span class="badge badge-' + (p === 'high' ? 'bad' : p === 'low' ? '' : 'warn') + '">' + esc(p) + '</span>'; }, exportVal: function (s) { return s.priority || 'medium'; } },
        { key: 'status', label: 'Status', badge: { Paid: 'good', Partial: 'warn', Pending: 'bad', Approved: 'info', Cancelled: '' } },
        { key: 'amount', label: 'Amount (৳)', num: true, sortVal: function (s) { return +s.amount || 0; }, render: function (s) {
          var due = (+s.amount || 0) - (+s.paidAmount || 0);
          return '<span class="num strong">' + ui.money(s.amount) + '</span>' +
            (s.paidAmount && due > 0.001 ? '<div class="text-mute xs num">Due: ' + ui.money(due) + '</div>' : '');
        }, exportVal: function (s) { return s.amount; } }
      ];
      if (selCo === 'all') cols.splice(1, 0, { key: 'companyId', label: 'Company', render: function (s) { return coCell(s.companyId); }, exportVal: function (s) { return s.companyId; } });
      var openActs = function (s) { return s.status !== 'Paid' && s.status !== 'Cancelled'; };
      var tbl = EPAL.table({
        columns: cols, rows: rows, searchKeys: ['party', 'desc'], quickFilter: 'status', filterPanel: true,
        filters: [{ key: 'priority', label: 'Priority' }].concat(selCo === 'all' ? [{ key: 'companyId', label: 'Company' }] : []),
        dateKey: 'due', totalKey: 'amount', pageSize: 10,
        exportName: kind.toLowerCase() + '-schedules.csv', pdfTitle: kind + ' Schedules — ' + coName(selCo),
        onRow: function (s) { masterScheduleDetail(s); },
        actions: canCreate() ? [
          { icon: 'file-earmark-text', title: 'Details', onClick: function (s) { masterScheduleDetail(s); } },
          { icon: 'check-lg', title: 'Approve', onClick: function (s) {
            if (!openActs(s) || s.status === 'Approved') { ui.toast('Nothing to approve', 'error'); return; }
            s.status = 'Approved'; s.approvedAt = TODAY_STR; db.save('acc_schedules', s);
            ui.toast('Approved', 'success'); EPAL.router.render();
          } },
          { icon: 'cash-coin', title: 'Payment done', onClick: function (s) { if (openActs(s)) schedulePayForm(s); else ui.toast('Already settled', 'error'); } },
          { icon: 'calendar2-plus', title: 'Reschedule', onClick: function (s) { if (openActs(s)) rescheduleForm(s); else ui.toast('Already settled', 'error'); } },
          { icon: 'x-circle', title: 'Cancel', onClick: function (s) {
            if (!openActs(s)) { ui.toast('Already settled', 'error'); return; }
            ui.confirm({ title: 'Cancel this schedule?', text: s.party + ' · ' + ui.money(s.amount), danger: true, confirmLabel: 'Cancel Schedule' })
              .then(function (ok) { if (ok) { s.status = 'Cancelled'; db.save('acc_schedules', s); ui.toast('Cancelled', 'success'); EPAL.router.render(); } });
          } }
        ] : [{ icon: 'file-earmark-text', title: 'Details', onClick: function (s) { masterScheduleDetail(s); } }],
        empty: { icon: 'calendar2-week', title: 'No ' + kind.toLowerCase() + ' schedules' }
      });
      page.appendChild(el('div.card.mb-2', null, [
        el('div.card-head', null, [
          el('h3', { html: ui.icon(icon) + ' ' + (kind === 'Receivable' ? 'Receivable — amounts to collect' : 'Payable — amounts due to suppliers / vendors') }),
          el('span.strong.num.' + (kind === 'Receivable' ? 'text-good' : 'text-warn'), { style: { marginLeft: 'auto' }, text: 'Open total ' + ui.money(openTotal) })
        ]),
        el('div.card-body', null, [tbl.el])
      ]));
    }
    section('Receivable', 'arrow-down-left-circle');
    section('Payable', 'arrow-up-right-circle');
  }
  // detail with the production ERP's lifecycle: Payment Done (partial pay spawns an
  // auto-REMAINDER schedule), Reschedule (keeps count + reason), priority setter.
  function masterScheduleDetail(s) {
    var body = el('div');
    var m = ui.modal({ title: s.party + ' · ' + ui.money(s.amount), icon: 'calendar2-week', size: 'md', body: body, footer: false });
    var acts = el('div.flex.gap-1.flex-wrap', { style: { marginLeft: 'auto' } });
    if (canCreate() && s.status !== 'Paid' && s.status !== 'Cancelled') {
      acts.appendChild(el('button.btn.btn-sm.btn-primary', { html: ui.icon('cash-coin') + ' Payment Done', onclick: function () { m.close(); schedulePayForm(s); } }));
      acts.appendChild(el('button.btn.btn-sm.btn-outline', { html: ui.icon('calendar2-plus') + ' Reschedule', onclick: function () { m.close(); rescheduleForm(s); } }));
    }
    body.appendChild(el('div.card', null, [el('div.card-body', null, [
      el('div.flex.items-center.gap-2.flex-wrap.mb-3', null, [
        el('div.flex-1', null, [el('div.fw-700', { text: s.party }), el('div.text-mute.sm', { text: (s.kind || '') + ' · ' + coName(s.companyId) + (s.partyType ? ' · ' + s.partyType : '') })]),
        el('span.badge.badge-' + (s.status === 'Paid' ? 'good' : s.status === 'Partial' ? 'warn' : s.status === 'Approved' ? 'info' : s.status === 'Cancelled' ? '' : 'bad'), { text: s.status }), acts]),
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
        { key: 'status', label: 'Status', type: 'select', options: ['Pending', 'Approved', 'Partial', 'Paid', 'Cancelled'], default: 'Pending' },
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

  /* ======================================================= PARTY TYPES
   * Production parity (PartyTypeController): party types are PER COMPANY with
   * an auto slug and a "Maps To" binding — Customer, Supplier, or free text
   * ("Others"). Duplicate slug per company is rejected. */
  function ptSlug(name) { return String(name || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''); }
  function partyTypesView(page) {
    var list = S.list('party_types');
    page.appendChild(el('div.kpi-grid.kpi-compact.stagger', null, [
      kpi('Party Types', String(list.length), 'tags'),
      kpi('Mapped', String(list.filter(function (p) { return p.mapsTo; }).length), 'link-45deg'),
      kpi('Free text', String(list.filter(function (p) { return !p.mapsTo; }).length), 'pencil'),
      kpi('Scope', selCo === 'all' ? 'All companies' : coName(selCo), 'diagram-3')
    ]));
    if (canCreate()) page.appendChild(el('div.mb-2', null, [el('button.btn.btn-sm.btn-primary', { html: ui.icon('plus-lg') + ' Add New', onclick: function () { partyTypeForm(null); } })]));
    var rows = list.filter(function (p) { return selCo === 'all' ? true : (p.companyId || 'group') === selCo; });
    var cols = [
      { key: 'companyId', label: 'Company', render: function (p) { return coCell(p.companyId || 'group'); }, exportVal: function (p) { return p.companyId || 'group'; } },
      { key: 'name', label: 'Name', render: function (p) { return '<span class="strong">' + esc(p.name) + '</span>'; } },
      { key: 'slug', label: 'Slug', render: function (p) { return '<span class="mono xs text-mute">' + esc(p.slug || ptSlug(p.name)) + '</span>'; }, exportVal: function (p) { return p.slug || ptSlug(p.name); } },
      { key: 'mapsTo', label: 'Maps To', render: function (p) {
        return p.mapsTo === 'Customer' ? '<span class="badge badge-info">Customer</span>'
          : p.mapsTo === 'Supplier' ? '<span class="badge badge-warn">Supplier</span>'
          : '<span class="badge">Free text</span>';
      }, exportVal: function (p) { return p.mapsTo || 'Free text'; } },
      { key: 'used', label: 'Schedules', num: true, render: function (p) { return String(db.col('acc_schedules').filter(function (s) { return s.partyType === p.name; }).length); }, sortVal: function (p) { return db.col('acc_schedules').filter(function (s) { return s.partyType === p.name; }).length; } }
    ];
    var tbl = EPAL.table({
      columns: cols, rows: rows, pageSize: 15, searchKeys: ['name', 'slug'], exportName: 'party-types.csv',
      filters: selCo === 'all' ? [{ key: 'companyId', label: 'Company' }] : [],
      actions: ui.actions({
        edit: canCreate() ? function (p) { partyTypeForm(p); } : null,
        del: canCreate() ? function (p) { ui.confirm({ title: 'Delete party type "' + p.name + '"?', danger: true, confirmLabel: 'Delete' }).then(function (ok) { if (ok) { S.removeFrom('party_types', p.id); ui.toast('Deleted', 'success'); EPAL.router.render(); } }); } : null
      }),
      empty: { icon: 'tags', title: 'No party types in scope' }
    });
    page.appendChild(el('div.card', null, [el('div.card-head', null, [el('h3', { html: ui.icon('tags') + ' Party Types — ' + coName(selCo) }), el('span.card-sub', { text: 'used on schedules & party records' })]), el('div.card-body', null, [tbl.el])]));
  }
  function partyTypeForm(p) {
    EPAL.formModal({
      title: p ? 'Edit Party Type' : 'New Party Type', icon: 'tags', size: 'sm',
      record: p ? { name: p.name, companyId: p.companyId || 'group', mapsTo: p.mapsTo || '' }
                : { companyId: selCo === 'all' ? 'group' : selCo, mapsTo: '' },
      fields: [
        { key: 'companyId', label: 'Company', type: 'select', required: true, options: [['group', 'Group HQ']].concat(comps().map(function (c) { return [c.id, c.short]; })) },
        { key: 'name', label: 'Name', type: 'text', required: true, hint: 'The slug is generated automatically.' },
        { key: 'mapsTo', label: 'Maps to', type: 'select', options: [['', '— None (Free text / Others) —'], ['Customer', 'Customer'], ['Supplier', 'Supplier']] }
      ],
      saveLabel: p ? 'Save' : 'Add',
      onSave: function (v) {
        var name = (v.name || '').trim(); if (!name) { ui.toast('Enter a name', 'error'); return false; }
        var slug = ptSlug(name);
        var dupe = S.list('party_types').some(function (x) {
          return (x.companyId || 'group') === v.companyId && (x.slug || ptSlug(x.name)) === slug && (!p || x.id !== p.id);
        });
        if (dupe) { ui.toast('A party type with this name already exists for ' + coName(v.companyId), 'error'); return false; }
        var r = p || { id: 'PT-' + ui.uid('').slice(-5).toUpperCase() };
        r.name = name; r.slug = slug; r.companyId = v.companyId; r.mapsTo = v.mapsTo || '';
        S.upsert('party_types', r);
        ui.toast('Party type saved', 'success'); EPAL.router.render(); return true;
      }
    });
  }

  /* ======================================================= MASTER PAYROLL */
  function payrollView(page) {
    // the company buttons above already switch selCo; the full payroll desk mounts here
    if (EPAL.payrollDesk) EPAL.payrollDesk(page, selCo === 'all' ? 'travels' : selCo);
    else page.appendChild(el('div.card', null, [el('div.card-body', { text: 'Payroll desk unavailable.' })]));
  }

  /* ======================================================= MANAGE ACCOUNTS
   * The group chart of accounts, managed right here (same 'coa' store the
   * Group Finance tab uses, so both screens always agree). Balances respect
   * the company switcher — pick a concern to see ITS balance on each head. */
  function accountsView(page) {
    if (!EPAL.ledger) { page.appendChild(el('div.card', null, [el('div.card-body', { text: 'Ledger engine unavailable.' })])); return; }
    var L = EPAL.ledger;
    var scope = selCo === 'all' ? {} : { companyId: selCo };
    var accts = L.accounts();
    var TYPE_META = [['asset', 'Assets', 'safe2'], ['liability', 'Liabilities', 'file-earmark-minus'],
      ['equity', 'Equity', 'gem'], ['income', 'Income', 'graph-up-arrow'], ['expense', 'Expenses', 'wallet2']];
    var counts = {}; accts.forEach(function (a) { counts[a.type] = (counts[a.type] || 0) + 1; });
    page.appendChild(el('div.kpi-grid.kpi-compact.stagger', null, TYPE_META.map(function (t) {
      return kpi(t[1], String(counts[t[0]] || 0), t[2]);
    })));
    if (canCreate()) {
      page.appendChild(el('div.flex.gap-1.mb-2', null, [
        el('button.btn.btn-sm.btn-primary', { html: ui.icon('plus-square') + ' Add Account', onclick: addAccountForm }),
        el('button.btn.btn-sm.btn-outline', { html: ui.icon('flag') + ' Opening Balance', onclick: openingBalanceForm })
      ]));
    }
    TYPE_META.forEach(function (t) {
      var list = accts.filter(function (a) { return a.type === t[0]; });
      if (!list.length) return;
      var rows = list.map(function (a) {
        return { code: a.code, name: a.name, group: a.group || '—', normal: a.normal, active: a.active !== false, balance: L.balance(a.code, scope) };
      });
      var tbl = EPAL.table({
        columns: [
          { key: 'code', label: 'Code', render: function (r) { return '<span class="num strong">' + esc(r.code) + '</span>'; } },
          { key: 'name', label: 'Account', render: function (r) { return '<span class="strong' + (r.active ? '' : ' text-mute') + '">' + esc(r.name) + '</span>' + (r.active ? '' : ' <span class="badge">Inactive</span>'); } },
          { key: 'group', label: 'Group' },
          { key: 'normal', label: 'Normal', badge: { debit: 'info', credit: 'accent' } },
          { key: 'balance', label: 'Balance — ' + (selCo === 'all' ? 'Group' : coName(selCo)), num: true, money: true }
        ],
        rows: rows, pageSize: 25, searchKeys: ['code', 'name', 'group'], exportName: 'master-coa-' + t[0] + '.csv',
        onRow: function (r) { openAccountLedger(r.code, r.name); },
        // deactivate — never delete: history stays, the head just leaves the pickers
        actions: canCreate() ? [{ icon: 'power', title: 'Deactivate / reactivate', onClick: function (r) {
          var coa = S.list('coa');
          var acc2 = coa.filter(function (a) { return a.code === r.code; })[0];
          if (!acc2) return;
          acc2.active = acc2.active === false;
          S.set('coa', coa);
          ui.toast('Account ' + r.code + (acc2.active === false ? ' deactivated (history kept)' : ' reactivated'), 'success');
          EPAL.router.render();
        } }] : [],
        empty: { icon: 'diagram-2', title: 'No accounts' }
      });
      page.appendChild(el('div.card.mb-2', null, [
        el('div.card-head', null, [el('h3', { html: ui.icon(t[2]) + ' ' + t[1] })]),
        el('div.card-body', null, [tbl.el])
      ]));
    });
    function openAccountLedger(code, name) {
      var rows = L.ledgerFor(code, scope) || [];
      var t = el('table.tbl');
      t.appendChild(el('thead', null, [el('tr', null, [el('th', { text: 'Date' }), el('th', { text: 'Ref' }), el('th', { text: 'Memo' }),
        el('th.num', { text: 'Debit' }), el('th.num', { text: 'Credit' }), el('th.num', { text: 'Balance' })])]));
      var tb = el('tbody');
      rows.forEach(function (r) {
        tb.appendChild(el('tr', null, [el('td', { text: ui.date(r.date) }), el('td', { text: r.ref || '—' }), el('td', { text: r.memo || '—' }),
          el('td.num', { html: r.debit ? ui.money(r.debit) : '—' }), el('td.num', { html: r.credit ? ui.money(r.credit) : '—' }),
          el('td.num', { html: '<span class="num">' + ui.money(r.balance) + '</span>' })]));
      });
      t.appendChild(tb);
      var body = rows.length ? el('div.table-wrap', null, [t]) : el('div.text-mute', { text: 'No movement in this scope.' });
      ui.modal({ title: code + ' · ' + name + ' — ' + (selCo === 'all' ? 'Group' : coName(selCo)), icon: 'journal-text', size: 'xl', body: body, footer: false });
    }
    function addAccountForm() {
      EPAL.formModal({
        title: 'Add Ledger Account', icon: 'plus-square', size: 'md', record: { type: 'expense' },
        fields: [
          { key: 'code', label: 'Account code', type: 'text', required: true, placeholder: 'e.g. 5450' },
          { key: 'name', label: 'Account name', type: 'text', required: true },
          { key: 'type', label: 'Type', type: 'select', required: true, options: ['asset', 'liability', 'equity', 'income', 'expense'] },
          { key: 'group', label: 'Group / class', type: 'text', placeholder: 'e.g. Operating Expenses' }
        ],
        saveLabel: 'Add Account',
        onSave: function (val) {
          var code = (val.code || '').trim(); if (!code) { ui.toast('Enter a code', 'error'); return false; }
          var coa = S.list('coa');
          if (coa.some(function (a) { return a.code === code; })) { ui.toast('Account ' + code + ' already exists', 'error'); return false; }
          var type = val.type;
          coa.push({ id: code, code: code, name: (val.name || '').trim() || code, type: type,
            normal: (type === 'asset' || type === 'expense') ? 'debit' : 'credit', group: val.group || 'Other', intercompany: false });
          S.set('coa', coa);
          ui.toast('Account ' + code + ' added', 'success'); EPAL.router.render(); return true;
        }
      });
    }
    function openingBalanceForm() {
      EPAL.formModal({
        title: 'Post Opening Balance', icon: 'flag', size: 'md', record: { date: '2026-07-01', companyId: selCo === 'all' ? 'group' : selCo },
        fields: [
          { key: 'companyId', label: 'Company', type: 'select', required: true, options: [['group', 'Group HQ']].concat(comps().map(function (c) { return [c.id, c.short]; })) },
          { key: 'account', label: 'Account', type: 'select', required: true, options: accts.map(function (a) { return [a.code, a.code + ' · ' + a.name]; }) },
          { key: 'amount', label: 'Amount (৳)', type: 'money', required: true, min: 0 },
          { key: 'date', label: 'As-of date', type: 'date', default: '2026-07-01' }
        ],
        saveLabel: 'Post Opening',
        onSave: function (val) {
          var acct = L.account(val.account); if (!acct) { ui.toast('Pick an account', 'error'); return false; }
          var amt = +val.amount || 0; if (amt <= 0) { ui.toast('Enter an amount', 'error'); return false; }
          // opening balances against Retained Earnings (3100), same as Group Finance
          var lines = acct.normal === 'debit' ? [{ account: val.account, dr: amt, cr: 0 }, { account: '3100', dr: 0, cr: amt }]
            : [{ account: '3100', dr: amt, cr: 0 }, { account: val.account, dr: 0, cr: amt }];
          try {
            L.post({ id: 'GL-OPEN-' + val.companyId + '-' + val.account, date: val.date, companyId: val.companyId, ref: 'OPENING',
              memo: 'Opening balance · ' + acct.name, source: 'opening', override: true, lines: lines });
            ui.toast('Opening balance posted', 'success'); EPAL.router.render(); return true;
          } catch (e) { ui.toast(e.message || 'Failed', 'error'); return false; }
        }
      });
    }
  }

  /* ======================================================= MANAGE BANKS
   * Production parity (BankControllerV2): a Bank Accounts DASHBOARD (total
   * position + per-company cards + a combined Recent Bank Transactions ledger
   * with running balances and reversals), ALL BANKS (branch · owner · acc
   * type · routing · full account no · status) and BANK TRANSFERS. Deposits
   * and withdrawals are journal-integrated (source 'bank' via the Credit /
   * Debit journal flow) and every movement lands in the 'bank_txns' log. */
  function bankTxnApply(bank, type, amt, date, desc, ref, glId, extra) {
    var isIn = type === 'deposit' || type === 'transfer-in';
    bank.balance = (+bank.balance || 0) + (isIn ? amt : -amt);
    bank.lastTxnDate = date; bank.lastTxnAmount = amt; bank.lastTxnType = isIn ? 'credit' : 'debit';
    db.save('banks', bank);
    S.upsert('bank_txns', Object.assign({ id: 'BTX-' + ui.uid('').slice(-7).toUpperCase(), bankId: bank.id, bankName: bank.name,
      type: type, amount: amt, date: date, desc: desc || '', ref: ref || '', glId: glId || '' }, extra || {}));
  }
  function banksView(page) {
    var allBanks = db.col('banks');
    var banks = allBanks.filter(function (b) { return selCo === 'all' ? true : (b.companyId || 'group') === selCo; });
    var total = banks.reduce(function (a, b) { return a + (+b.balance || 0); }, 0);

    // ---- 1) BANK ACCOUNTS DASHBOARD -----------------------------------------
    page.appendChild(el('div.kpi-grid.kpi-compact.stagger', null, [
      kpi('Total Balance', ui.money(total, { compact: true }), 'safe2'),
      kpi('Accounts', String(banks.length), 'bank'),
      kpi('Active', String(banks.filter(function (b) { return (b.status || 'Active') !== 'Inactive'; }).length), 'check-circle'),
      kpi('Scope', selCo === 'all' ? 'All companies' : coName(selCo), 'diagram-3')
    ]));
    // per-company cards, like the production dashboard header
    (function () {
      var byCo = {};
      allBanks.forEach(function (b) { var k = b.companyId || 'group'; byCo[k] = byCo[k] || { total: 0, n: 0 }; byCo[k].total += +b.balance || 0; byCo[k].n++; });
      var strip = el('div.flex.gap-2.flex-wrap.mb-2');
      Object.keys(byCo).forEach(function (k) {
        strip.appendChild(el('div.card', { style: { padding: '10px 14px', cursor: 'pointer', minWidth: '170px' }, onclick: function () { selCo = k; EPAL.router.render(); } }, [
          el('div.fw-600.sm', { text: coName(k) }),
          el('div.strong.num' + (byCo[k].total < 0 ? '.text-bad' : ''), { text: ui.money(byCo[k].total) }),
          el('div.text-mute.xs', { text: byCo[k].n + ' account' + (byCo[k].n === 1 ? '' : 's') + ' · filter' })
        ]));
      });
      page.appendChild(strip);
    })();
    if (canCreate()) {
      page.appendChild(el('div.flex.gap-1.flex-wrap.mb-2', null, [
        el('button.btn.btn-sm.btn-primary', { html: ui.icon('plus-lg') + ' Add New Bank', onclick: function () { editBank(null); } }),
        el('button.btn.btn-sm.btn-outline', { html: ui.icon('arrow-down-circle') + ' Deposit', onclick: function () { bankJournalForm('credit'); } }),
        el('button.btn.btn-sm.btn-outline', { html: ui.icon('arrow-up-circle') + ' Withdraw', onclick: function () { bankJournalForm('debit'); } }),
        el('button.btn.btn-sm.btn-outline', { html: ui.icon('arrow-left-right') + ' Transfer', onclick: transferForm }),
        el('a.btn.btn-sm.btn-outline', { href: '#/group/finance/banks', html: ui.icon('pie-chart') + ' Charts view' })
      ]));
    }

    // ---- 2) ALL BANKS (production columns + filters) -------------------------
    var cols = [
      { key: 'name', label: 'Name', render: function (b) { return '<span class="strong">' + esc(b.name) + '</span>' + (b.type && b.type !== 'Bank' ? ' <span class="badge">' + esc(b.type) + '</span>' : ''); } },
      { key: 'branch', label: 'Branch', render: function (b) { return esc(b.branch || '—'); } },
      { key: 'accountName', label: 'Account', render: function (b) { return esc(b.accountName || coName(b.companyId || 'group')); }, exportVal: function (b) { return b.accountName || coName(b.companyId || 'group'); } },
      { key: 'accType', label: 'Acc Type', render: function (b) { return '<span class="badge badge-info">' + esc(b.accType || 'Current') + '</span>'; }, exportVal: function (b) { return b.accType || 'Current'; } },
      { key: 'routing', label: 'Routing No.', render: function (b) { return '<span class="mono xs text-mute">' + esc(b.routing || '—') + '</span>'; } },
      { key: 'account', label: 'Account No.', render: function (b) { return '<span class="mono xs">' + esc(b.account || '—') + '</span>'; } },
      { key: 'balance', label: 'Balance', num: true, sortVal: function (b) { return +b.balance || 0; }, render: function (b) { return '<span class="num strong' + ((+b.balance || 0) < 0 ? ' text-bad' : '') + '">' + ui.money(b.balance) + '</span>'; }, exportVal: function (b) { return b.balance; } },
      { key: 'status', label: 'Status', render: function (b) { return (b.status || 'Active') === 'Inactive' ? '<span class="badge">Inactive</span>' : '<span class="badge badge-good">Active</span>'; }, exportVal: function (b) { return b.status || 'Active'; } }
    ];
    if (selCo === 'all') cols.splice(1, 0, { key: 'companyId', label: 'Company', render: function (b) { return coCell(b.companyId || 'group'); }, exportVal: function (b) { return b.companyId; } });
    var tbl = EPAL.table({
      columns: cols, rows: banks, pageSize: 10, totalKey: 'balance', exportName: 'master-banks.csv',
      searchKeys: ['name', 'branch', 'account'], filterPanel: true,
      filters: [{ key: 'accType', label: 'Acc Type' }, { key: 'status', label: 'Status' }].concat(selCo === 'all' ? [{ key: 'companyId', label: 'Company' }] : []),
      onRow: canCreate() ? function (b) { editBank(b); } : null,
      actions: canCreate() ? [
        { icon: 'pencil', title: 'Edit', onClick: function (b) { editBank(b); } },
        { icon: 'arrow-down-circle', title: 'Deposit', onClick: function (b) { bankJournalForm('credit', b.id); } },
        { icon: 'arrow-up-circle', title: 'Withdraw', onClick: function (b) { bankJournalForm('debit', b.id); } },
        { icon: 'trash', title: 'Remove', onClick: function (b) {
          ui.confirm({ title: 'Remove ' + b.name + ' account?', text: 'Balance ' + ui.money(b.balance) + ' will leave the cash position.', danger: true, confirmLabel: 'Remove' })
            .then(function (ok) { if (ok) { db.remove('banks', b.id); ui.toast('Bank account removed', 'success'); EPAL.router.render(); } });
        } }
      ] : [],
      empty: { icon: 'bank', title: 'No accounts in scope', hint: 'Add the first account with Add New Bank.' }
    });
    page.appendChild(el('div.card.mb-2', null, [
      el('div.card-head', null, [el('h3', { html: ui.icon('bank') + ' All Banks — ' + coName(selCo) })]),
      el('div.card-body', null, [tbl.el])
    ]));

    // ---- 3) RECENT BANK TRANSACTIONS (running balance per bank) --------------
    (function () {
      var scopeIds = {}; banks.forEach(function (b) { scopeIds[b.id] = b; });
      var txns = S.list('bank_txns').filter(function (t) { return !!scopeIds[t.bankId]; });
      // derive the balance AFTER each txn by walking each bank backward from
      // its live balance (newest txn's after-balance = the current balance)
      var byBank = {};
      txns.forEach(function (t, i) { t._seq = i; (byBank[t.bankId] = byBank[t.bankId] || []).push(t); });
      Object.keys(byBank).forEach(function (bid) {
        var rows = byBank[bid].slice().sort(function (a, b) { return (a.date === b.date) ? b._seq - a._seq : (a.date < b.date ? 1 : -1); });
        var bal = +(scopeIds[bid].balance) || 0;
        rows.forEach(function (t) {
          t._after = bal;
          bal -= (t.type === 'deposit' || t.type === 'transfer-in') ? (+t.amount || 0) : -(+t.amount || 0);
        });
      });
      var recent = txns.slice().sort(function (a, b) { return (a.date === b.date) ? b._seq - a._seq : (a.date < b.date ? 1 : -1); }).slice(0, 50);
      var tt2 = EPAL.table({
        columns: [
          { key: 'date', label: 'Date', date: true },
          { key: 'bankName', label: 'Bank', render: function (t) {
            var b = scopeIds[t.bankId] || {};
            return '<span class="strong">' + esc(t.bankName) + '</span><div class="text-mute xs">' + esc(b.account || '') + ' · ' + esc(coName(b.companyId || 'group')) + '</div>';
          } },
          { key: 'desc', label: 'Description', render: function (t) { return esc(t.desc || t.type); } },
          { key: 'in', label: 'Debit', num: true, render: function (t) { return (t.type === 'deposit' || t.type === 'transfer-in') ? '<span class="num text-good">' + ui.money(t.amount) + '</span>' : '—'; }, sortVal: function (t) { return (t.type === 'deposit' || t.type === 'transfer-in') ? +t.amount : 0; }, exportVal: function (t) { return (t.type === 'deposit' || t.type === 'transfer-in') ? t.amount : ''; } },
          { key: 'out', label: 'Credit', num: true, render: function (t) { return (t.type === 'withdraw' || t.type === 'transfer-out') ? '<span class="num text-bad">' + ui.money(t.amount) + '</span>' : '—'; }, sortVal: function (t) { return (t.type === 'withdraw' || t.type === 'transfer-out') ? +t.amount : 0; }, exportVal: function (t) { return (t.type === 'withdraw' || t.type === 'transfer-out') ? t.amount : ''; } },
          { key: 'bal', label: 'Balance', num: true, render: function (t) { var v = +t._after || 0; return '<span class="num ' + (v < 0 ? 'text-bad' : '') + '">' + ui.money(Math.abs(v)) + ' ' + (v < 0 ? 'Cr' : 'Dr') + '</span>'; }, sortVal: function (t) { return +t._after || 0; }, exportVal: function (t) { return t._after; } }
        ],
        rows: recent, pageSize: 10, exportName: 'bank-transactions.csv',
        searchKeys: ['bankName', 'desc', 'ref'],
        actions: canCreate() ? [{ icon: 'arrow-counterclockwise', title: 'Reverse this transaction', onClick: function (t) { reverseTxn(t); } }] : [],
        empty: { icon: 'clock-history', title: 'No bank transactions yet', hint: 'Deposits, withdrawals and transfers appear here.' }
      });
      page.appendChild(el('div.card.mb-2', null, [
        el('div.card-head', null, [el('h3', { html: ui.icon('clock-history') + ' Recent Bank Transactions' }), el('span.card-sub', { text: 'all accounts in scope — newest first' })]),
        el('div.card-body', null, [tt2.el])
      ]));
    })();

    // ---- 4) BANK TRANSFERS ---------------------------------------------------
    var transfers = S.list('bank_transfers').slice().sort(function (a, b) { return (a.date || '') < (b.date || '') ? 1 : -1; });
    var tt = EPAL.table({
      columns: [
        { key: 'date', label: 'Date', date: true },
        { key: 'from', label: 'From', render: function (t) { return esc(t.fromName || t.from); } },
        { key: 'to', label: 'To', render: function (t) { return esc(t.toName || t.to); } },
        { key: 'memo', label: 'Note', render: function (t) { return esc(t.memo || '—'); } },
        { key: 'amount', label: 'Amount', num: true, money: true }
      ],
      rows: transfers, pageSize: 8, exportName: 'master-bank-transfers.csv', totalKey: 'amount',
      actions: canCreate() ? [{ icon: 'trash', title: 'Delete (reverses balances)', onClick: function (t) { deleteTransfer(t); } }] : [],
      empty: { icon: 'arrow-left-right', title: 'No transfers yet', hint: 'Move money between accounts with Transfer.' }
    });
    page.appendChild(el('div.card', null, [
      el('div.card-head', null, [el('h3', { html: ui.icon('arrow-left-right') + ' Bank Transfers' }),
        canCreate() ? el('button.btn.btn-sm.btn-primary', { style: { marginLeft: 'auto' }, html: ui.icon('plus-lg') + ' New Transfer', onclick: transferForm }) : null]),
      el('div.card-body', null, [tt.el])
    ]));

    // reverse a deposit/withdrawal: opposite GL entry + opposite txn row,
    // exactly like production's "Reversal of: …" rows
    function reverseTxn(t) {
      if (t.type !== 'deposit' && t.type !== 'withdraw') { ui.toast('Transfers are reversed from the Transfers card', 'error'); return; }
      if (t.reversed) { ui.toast('Already reversed', 'error'); return; }
      if (t.reversal) { ui.toast('This row IS a reversal', 'error'); return; }
      ui.confirm({ title: 'Reverse this transaction?', text: (t.desc || t.type) + ' · ' + ui.money(t.amount), danger: true, confirmLabel: 'Reverse' })
        .then(function (ok) {
          if (!ok) return;
          var bank = db.col('banks').filter(function (b) { return b.id === t.bankId; })[0];
          if (!bank) { ui.toast('Bank not found', 'error'); return; }
          var isDep = t.type === 'deposit';
          if (t.glId) {
            var orig = (EPAL.ledger.entries({}) || []).filter(function (e2) { return e2.id === t.glId; })[0];
            if (orig) {
              try {
                EPAL.ledger.post({ id: 'GL-BKR-' + ui.uid('').slice(-6).toUpperCase(), date: TODAY_STR, companyId: orig.companyId,
                  ref: 'REV-' + (orig.ref || orig.id), memo: 'Reversal of: ' + (orig.memo || t.desc), source: 'bank', override: true,
                  lines: (orig.lines || []).map(function (l) { return { account: l.account, dr: +l.cr || 0, cr: +l.dr || 0 }; }) });
              } catch (e) { ui.toast(e.message || 'Ledger reversal failed', 'error'); return; }
            }
          }
          bankTxnApply(bank, isDep ? 'withdraw' : 'deposit', +t.amount || 0, TODAY_STR, 'Reversal of: ' + (t.desc || t.type), 'REV-' + (t.ref || t.id), '', { reversal: true });
          t.reversed = true; S.upsert('bank_txns', t);
          ui.toast('Transaction reversed', 'success'); EPAL.router.render();
        });
    }
    function editBank(b) {
      EPAL.formModal({
        title: b ? 'Edit Bank' : 'Add New Bank', icon: 'bank', size: 'md',
        record: b || { type: 'Bank', accType: 'Current', bankType: 'National', status: 'Active', companyId: selCo === 'all' ? 'group' : selCo },
        fields: [
          { key: 'name', label: 'Bank / account name', type: 'text', required: true, placeholder: 'e.g. BRAC Bank (Travels)', col2: true },
          { key: 'type', label: 'Payment type', type: 'select', required: true, default: 'Bank', options: ['Bank', 'bKash', 'Nagad', 'Cash Box', 'Card'] },
          { key: 'branch', label: 'Branch', type: 'text', placeholder: 'e.g. Shantinagar Branch, Dhaka' },
          { key: 'accountName', label: 'Account holder / entity', type: 'text', placeholder: 'e.g. EPAL TRAVELS & CONSULTANCY' },
          { key: 'accType', label: 'Account type', type: 'select', options: ['Current', 'Savings', 'Fixed'], default: 'Current' },
          { key: 'bankType', label: 'Bank type', type: 'select', options: ['National', 'International'], default: 'National' },
          { key: 'routing', label: 'Routing number', type: 'text', placeholder: 'e.g. 060274289', showIf: function (x) { return x.type === 'Bank'; } },
          { key: 'account', label: 'Account / wallet number', type: 'text', pattern: /^\d{4,20}$/,
            hint: '4–20 digits', placeholder: '15XXXXXXXX',
            showIf: function (x) { return x.type !== 'Cash Box'; } },
          { key: 'companyId', label: 'Owned By', type: 'select', required: true,
            options: [['group', 'Group HQ']].concat(comps().map(function (c) { return [c.id, c.short]; })) },
          { key: 'status', label: 'Status', type: 'select', options: ['Active', 'Inactive'], default: 'Active' },
          { key: 'balance', label: 'Current Balance (৳)', type: 'money', required: true }
        ],
        onSave: function (vals) {
          var rec = Object.assign({}, b || { id: 'BNK-' + Date.now().toString().slice(-5), created: TODAY_STR }, vals);
          rec.type = vals.type || 'Bank';
          if (rec.type === 'Cash Box' && !rec.account) rec.account = '0000';
          if (!rec.accountName) rec.accountName = coName(rec.companyId || 'group');
          db.save('banks', rec);
          ui.toast('Bank saved', 'success'); EPAL.router.render();
        }
      });
    }
    function transferForm() {
      var all = db.col('banks').filter(function (b) { return (b.status || 'Active') !== 'Inactive'; });
      if (all.length < 2) { ui.toast('Need at least two active accounts to transfer', 'error'); return; }
      var opts = all.map(function (b) { return [b.id, (b.type && b.type !== 'Bank' ? b.type + ' · ' : '') + b.name + ' (' + ui.money(b.balance, { compact: true }) + ')']; });
      EPAL.formModal({
        title: 'Transfer Between Accounts', icon: 'arrow-left-right', size: 'md', record: { date: TODAY_STR },
        fields: [
          { key: 'from', label: 'From account', type: 'select', required: true, options: opts },
          { key: 'to', label: 'To account', type: 'select', required: true, options: opts },
          { key: 'amount', label: 'Amount (৳)', type: 'money', required: true, min: 1 },
          { key: 'date', label: 'Date', type: 'date', default: TODAY_STR },
          { key: 'memo', label: 'Note', type: 'text', col2: true }
        ],
        saveLabel: 'Transfer',
        onSave: function (v) {
          if (v.from === v.to) { ui.toast('Pick two different accounts', 'error'); return false; }
          var amt = +v.amount || 0;
          var from = all.filter(function (b) { return b.id === v.from; })[0];
          var to = all.filter(function (b) { return b.id === v.to; })[0];
          if (!from || !to) { ui.toast('Account not found', 'error'); return false; }
          var tid = 'BT-' + Date.now().toString(36).toUpperCase();
          bankTxnApply(from, 'transfer-out', amt, v.date, 'Transfer to ' + to.name + (v.memo ? ' — ' + v.memo : ''), tid);
          bankTxnApply(to, 'transfer-in', amt, v.date, 'Transfer from ' + from.name + (v.memo ? ' — ' + v.memo : ''), tid);
          S.upsert('bank_transfers', { id: tid, from: from.id, fromName: from.name, to: to.id, toName: to.name, amount: amt, date: v.date, memo: v.memo || '' });
          ui.toast('Transferred ' + ui.money(amt), 'success'); EPAL.router.render(); return true;
        }
      });
    }
    function deleteTransfer(t) {
      ui.confirm({ title: 'Delete this transfer?', text: ui.money(t.amount) + ' will move back ' + (t.toName || t.to) + ' → ' + (t.fromName || t.from) + '.', danger: true, confirmLabel: 'Delete & Reverse' })
        .then(function (ok) {
          if (!ok) return;
          var all = db.col('banks');
          var from = all.filter(function (b) { return b.id === t.from; })[0];
          var to = all.filter(function (b) { return b.id === t.to; })[0];
          if (from) bankTxnApply(from, 'transfer-in', +t.amount || 0, TODAY_STR, 'Reversal of: Transfer to ' + (t.toName || t.to), 'REV-' + t.id, '', { reversal: true });
          if (to) bankTxnApply(to, 'transfer-out', +t.amount || 0, TODAY_STR, 'Reversal of: Transfer from ' + (t.fromName || t.from), 'REV-' + t.id, '', { reversal: true });
          S.removeFrom('bank_transfers', t.id);
          ui.toast('Transfer deleted & reversed', 'success'); EPAL.router.render();
        });
    }
  }

})(window.EPAL = window.EPAL || {});
