/* ============================================================================
 * EPAL KIT · OPERATIONAL EXPENSES  (budget · report · categories)
 * ----------------------------------------------------------------------------
 * WHY THIS EXISTS: these three screens were written inside Master Accounts and
 * were reachable ONLY at group level. The owner asked for them on Travels too
 * (2026-07-15). Rather than copy them — two copies drift, and these decide
 * money — they were LIFTED VERBATIM out of master-accounts/view.js (lines
 * 330-656) into this kit and parameterised by company. Master Accounts and
 * Travels Accounts now render the SAME code; they cannot disagree.
 *
 * WHAT SCOPES AND WHAT DOESN'T (owner decision 2026-07-15):
 *   · Budget Setup   — scopes per company (group_budgets carries companyId).
 *   · Expense Report — scopes per company (acc_entries carries companyId).
 *   · Categories     — does NOT scope. exp_categories is ONE list shared by all
 *     six companies, exactly like the chart of accounts, and the entry counts
 *     span every company. So a company desk shows it READ-ONLY (opts.canEdit
 *     false): Travels staff can see which heads exist without silently editing
 *     the list Woodart posts against. Master Accounts keeps it editable.
 *
 * EXPOSES: EPAL.expenseViews = { budget(page,cid), report(page,cid),
 *          categories(page,cid,{canEdit}) }  — cid 'all' means every company.
 *
 * ==> LARAVEL HANDOFF: budgets = a Budget model scoped by company_id;
 *     the report is a query over expense entries between two dates; categories
 *     = a global ExpenseCategory table (no company_id) with subs as a child
 *     table. The read-only flag is a policy, not a different query.
 * ==========================================================================*/
(function (EPAL) {
  'use strict';
  var ui = EPAL.ui, el = ui.el, S = EPAL.store;
  function db() { return EPAL.db; }
  function esc(s) { return ui.escapeHtml(String(s == null ? '' : s)); }
  var TODAY_STR = (function () { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();
  function comps() { return EPAL.config.companies.filter(function (c) { return c.type === 'company' && c.enabled !== false; }); }
  function coName(cid) { if (cid === 'all') return 'All companies'; if (cid === 'group') return 'Group HQ'; var c = EPAL.config.company(cid); return c ? c.short : cid; }
  function canCreate() { return !EPAL.perm || EPAL.perm.can('group', 'master-accounts', 'create'); }
  function cats() { return S.list('exp_categories'); }
  // the expense register, scoped to one company (or all)
  function entriesFor(kind, cid) {
    return db().col('acc_entries').filter(function (e) {
      if (kind && e.kind !== kind) return false;
      return cid === 'all' ? true : e.companyId === cid;
    });
  }
  function kpi(label, value, icon, tone) {
    return el('div.kpi-card', null, [
      el('div.kpi-top', null, [el('span.kpi-label', { text: label }), el('span.kpi-ico', { html: '<i class="bi bi-' + icon + '"></i>' })]),
      el('div.kpi-value' + (tone ? '.' + tone : ''), { text: String(value) })
    ]);
  }
  /* The report's period state travels WITH the report — it moved out of
     master-accounts along with the view that owns it. Kept at module scope (not
     per-call) so the picker survives a re-render, exactly as it did before. */
  var reportMode = 'monthly';                         // expense-report period mode
  var reportDate = TODAY_STR;                         // daily / weekly anchor
  var reportMonth = TODAY_STR.slice(0, 7);            // monthly anchor (YYYY-MM)
  var reportFrom = '2026-07-01', reportTo = TODAY_STR;
  // The "Back to Expenses" button switches a tab the HOST owns, so the host
  // hands in how to do that; the kit never touches another module's state.
  var goBack = function () { EPAL.router.render(); };

  function categoriesView(page, cid, opts) {
    opts = opts || {};
    var canEditCats = function () { return canCreate() && opts.canEdit !== false; };
    var list = cats();
    var subRows = [];
    list.forEach(function (c) { (c.subs || []).forEach(function (s) { subRows.push({ id: c.id + '::' + s, name: s, parent: c.name, parentId: c.id }); }); });
    var activeN = list.filter(function (c) { return c.active !== false; }).length;
    function usedBy(catName, subName) {
      return db().col('acc_entries').filter(function (e) { return e.category === catName && (subName == null || (e.subCategory || '') === subName); }).length;
    }
    page.appendChild(el('div.kpi-grid.kpi-compact.stagger', null, [
      kpi('Categories', String(list.length), 'folder'),
      kpi('Active', String(activeN), 'check-circle'),
      kpi('Inactive', String(list.length - activeN), 'slash-circle'),
      kpi('Sub-categories', String(subRows.length), 'tags')
    ]));
    if (canEditCats()) page.appendChild(el('div.flex.gap-1.mb-2', null, [
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
      actions: canEditCats() ? [
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
      actions: canEditCats() ? [
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
          db().col('acc_entries').forEach(function (e) {
            if (e.category === row.parent && (e.subCategory || '') === row.name) { e.category = target.name; e.subCategory = name; db().save('acc_entries', e); }
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
        if (oldName && oldName !== r.name) db().col('acc_entries').forEach(function (e) { if (e.category === oldName) { e.category = r.name; db().save('acc_entries', e); } });
        ui.toast('Category saved', 'success'); EPAL.router.render(); return true;
      }
    });
  }

  /* ======================================================= BUDGET SETUP */
  function budgetView(page, cid) {
    var budgets = S.list('group_budgets').filter(function (b) { return cid === 'all' ? true : (b.companyId || 'group') === cid; });
    if (canCreate()) page.appendChild(el('div.mb-2', null, [el('button.btn.btn-primary', { html: ui.icon('bullseye') + ' Set Budget', onclick: function () { budgetForm(null, cid); } })]));
    var body = el('div.card-body');
    if (!budgets.length) body.appendChild(el('div.text-mute.sm', { text: 'No budgets in this scope yet — Set Budget to start.' }));
    var yr = TODAY_STR.slice(0, 4);
    var PERIOD_X = { Weekly: 52, Monthly: 12, Quarterly: 4, Annual: 1, Yearly: 1 };
    budgets.forEach(function (b) {
      var cid = b.companyId || 'group';
      var annual = (b.amount || 0) * (PERIOD_X[b.period] || 1);
      var threshold = b.threshold > 0 ? b.threshold : 80;      // warn at N% (ported)
      var actual = db().col('acc_entries').filter(function (e) { return e.kind === 'Expense' && e.companyId === cid && e.category === b.category && String(e.date).slice(0, 4) === yr; })
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
  function budgetForm(b, cid) {
    EPAL.formModal({
      title: 'Set Budget', icon: 'bullseye', size: 'sm', record: b || { period: 'Monthly', companyId: cid === 'all' ? 'group' : cid },
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
  function reportView(page, cid) {
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
    picker.appendChild(el('button.btn.btn-sm.btn-outline', { style: { marginLeft: 'auto' }, html: ui.icon('arrow-left') + ' Back to Expenses', onclick: function () { goBack(); } }));
    picker.appendChild(el('button.btn.btn-sm.btn-primary', { html: ui.icon('printer') + ' Print', onclick: function () { printReport(); } }));
    page.appendChild(picker);

    // ---- office expenses inside the selected period ------------------------
    var list = entriesFor('Expense', cid).filter(function (e) { var d = String(e.date).slice(0, 10); return d >= from && d <= to; });
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
      pdfTitle: 'Expense Report (' + periodLabel + ') — ' + coName(cid),
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
        '<div class="head"><div><h1>EPAL GROUP</h1><div class="mut">' + esc(coName(cid)) + ' · Operational Expenses</div></div>' +
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

  EPAL.expenseViews = {
    budget: function (page, cid) { budgetView(page, cid); },
    // opts.onBack — what the host's "Back to Expenses" button should do
    report: function (page, cid, opts) { goBack = (opts && opts.onBack) || function () { EPAL.router.render(); }; reportView(page, cid); },
    categories: function (page, cid, opts) { categoriesView(page, cid, opts); }
  };
})(window.EPAL);
