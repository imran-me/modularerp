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
  var SECTIONS = [['banks', 'Manage Banks'], ['cash', 'Manage Cash'], ['payroll', 'Master Payroll'], ['schedules', 'Payment Schedules'],
    ['journals', 'Manage Journals'], ['expenses', 'Operational Expenses'], ['accounts', 'Manage Accounts'],
    ['party-types', 'Party Types'], ['loans', 'Manage Loan']];
  var EXP_TABS = [['all', 'All Expenses'], ['budget', 'Budget Setup'], ['report', 'Expense Report'], ['categories', 'Category & Sub-category']];
  var expTab = 'all';                                 // active button inside Operational Expenses
  var selCo = 'all';                                  // the company switcher state
  var banksDash = true;                               // Manage Banks: Overview (card dashboard) vs per-company table
  // (the expense-report period state moved WITH the report into
  //  platform/kit/expenses.js — see the dispatch below)
  var taxYm = TODAY_STR.slice(0, 7);                  // VAT/AIT return period (P3)

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

    /* ---- P1-① AUDIT MIGRATION (guarded, one-time): mirror every register
     * expense into the GL. The GL-MX mirror only fired on UI saves, so the
     * seeded register (৳1.04Cr / 71 entries at audit time) never reached the
     * books and the GL P&L under-reported expenses. Same pattern as the
     * agent_reclass_v1 migration: explicit journals, stable ids, override
     * (period locks don't block a books-repair), guard flag records what ran. */
    if (EPAL.ledger && !S.get('exp_gl_backfill_v1', null)) {
      try {
        var glIds = {};
        (EPAL.ledger.entries({}) || []).forEach(function (g) { glIds[g.id] = 1; });
        var bfN = 0, bfAmt = 0;
        db.col('acc_entries').filter(function (e) { return e.kind === 'Expense'; }).forEach(function (e) {
          var gid = 'GL-MX-' + e.id;
          if (glIds[gid] || !(+e.amount > 0)) return;
          try {
            EPAL.ledger.post({ id: gid, date: e.date, companyId: e.companyId || 'group', ref: e.ref || e.id,
              memo: (e.category || 'Expense') + (e.subCategory ? ' · ' + e.subCategory : '') + (e.desc ? ' — ' + e.desc : ''),
              source: 'manual', party: e.party || '', override: true,
              // historical repair credits the BANK control (1010) uniformly —
              // crediting 1000 for old "Cash" rows drove petty cash ৳21L
              // negative, since the GL never held that cash. New entries from
              // the form ARE method-aware (fund petty cash via Withdraw → 1000).
              lines: [{ account: (EPAL.ledger.expenseAccountFor ? EPAL.ledger.expenseAccountFor((e.category || '') + ' ' + (e.subCategory || '')) : '5800'), dr: +e.amount, cr: 0 },
                      { account: '1010', dr: 0, cr: +e.amount }] });
            bfN++; bfAmt += +e.amount;
          } catch (x) {}
        });
        S.set('exp_gl_backfill_v1', { entries: bfN, amount: bfAmt });
      } catch (x) {}
    }

    /* ---- AUDIT FIX 3 (guarded, one-time): the twin of the expense backfill
     * above. It mirrored only kind==='Expense', so every kind==='Income' row in
     * the acc_entries register (manual JV income — ticket sales, visa fees,
     * consultancy, project billing…) NEVER reached the GL: the P&L under-reported
     * REVENUE by the whole income feed (~৳5Cr at audit time), which is the larger
     * half of the −377% margin. Same mechanics: stable GL-MXI-<id> ids, override
     * (a books repair is not blocked by a period lock), its OWN guard so it runs
     * even where the expense backfill already ran. Debits the 1010 bank control
     * uniformly (as the expense backfill credits it) — the reconciliation float
     * card accounts for book-cash vs bank-held. Income head via the shared
     * incomeAccountFor mapper, so it lands on the same 4xxx line a live sale would. */
    if (EPAL.ledger && !S.get('inc_gl_backfill_v1', null)) {
      try {
        var glIdsI = {};
        (EPAL.ledger.entries({}) || []).forEach(function (g) { glIdsI[g.id] = 1; });
        var ibN = 0, ibAmt = 0;
        db.col('acc_entries').filter(function (e) { return e.kind === 'Income'; }).forEach(function (e) {
          var gid = 'GL-MXI-' + e.id;
          if (glIdsI[gid] || !(+e.amount > 0)) return;
          try {
            var incAcct = EPAL.ledger.incomeAccountFor
              ? EPAL.ledger.incomeAccountFor({ category: e.category, desc: e.desc }) : '4000';
            EPAL.ledger.post({ id: gid, date: e.date, companyId: e.companyId || 'group', ref: e.ref || e.id,
              memo: (e.category || 'Income') + (e.desc && e.desc !== '—' ? ' — ' + e.desc : ''),
              source: 'manual', party: e.party || '', override: true,
              lines: [{ account: '1010', dr: +e.amount, cr: 0 }, { account: incAcct, dr: 0, cr: +e.amount }] });
            ibN++; ibAmt += +e.amount;
          } catch (x) {}
        });
        S.set('inc_gl_backfill_v1', { entries: ibN, amount: ibAmt });
      } catch (x) {}
    }

    /* ---- P1-② AUDIT MIGRATION (guarded, one-time): open every bank's live
     * balance into the ledger so the GL finally KNOWS the bank money. One
     * explicit opening per bank vs Retained Earnings (3100), party-tagged
     * with the bank's name (id GL-OPBK-<bank>). From here on, deposits /
     * withdrawals / credit-debit journals already post to the GL, so the
     * bank↔GL reconciliation card can prove the remaining float. */
    if (EPAL.ledger && !S.get('bank_gl_open_v1', null)) {
      try {
        var glIds2 = {};
        (EPAL.ledger.entries({}) || []).forEach(function (g) { glIds2[g.id] = 1; });
        var opN = 0, opAmt = 0;
        db.col('banks').forEach(function (b) {
          var gid = 'GL-OPBK-' + b.id, amt = +b.balance || 0;
          if (glIds2[gid] || !amt) return;
          var cashAcct = b.type === 'Cash Box' ? '1000' : '1010';
          var abs = Math.abs(amt);
          try {
            EPAL.ledger.post({ id: gid, date: b.created || '2026-07-01', companyId: b.companyId || 'group',
              ref: 'OPENING', memo: 'Bank opening balance · ' + b.name, source: 'opening', party: b.name, override: true,
              lines: amt > 0 ? [{ account: cashAcct, dr: abs, cr: 0 }, { account: '3100', dr: 0, cr: abs }]
                             : [{ account: '3100', dr: abs, cr: 0 }, { account: cashAcct, dr: 0, cr: abs }] });
            opN++; opAmt += amt;
          } catch (x) {}
        });
        S.set('bank_gl_open_v1', { banks: opN, amount: opAmt });
      } catch (x) {}
    }

    /* ---- P3: ALERTS SWEEP (runs each boot, deduped by stable ids) ----------
     * Budget breaches → one notification per budget per month.
     * Overdue schedules → one per schedule per due-date. Both land in the
     * group Notifications inbox (bell). */
    try {
      var haveN = {}; S.list('notifications').forEach(function (n) { haveN[n.id] = 1; });
      var ymNow = TODAY_STR.slice(0, 7);
      S.list('group_budgets').forEach(function (b) {
        var spent = db.col('acc_entries').filter(function (e) {
          return e.kind === 'Expense' && e.category === b.category &&
            ((b.companyId || 'group') === 'group' ? true : e.companyId === b.companyId) &&
            String(e.date).slice(0, 7) === ymNow;
        }).reduce(function (a, e) { return a + (+e.amount || 0); }, 0);
        var pct = (+b.amount || 0) ? spent / b.amount * 100 : 0;
        var nid = 'NB-' + b.id + '-' + ymNow;
        if (pct >= (+b.threshold || 80) && !haveN[nid]) {
          db.notify({ id: nid, level: pct >= 100 ? 'error' : 'warn', icon: 'bullseye', companyId: b.companyId || 'group',
            title: 'Budget ' + (pct >= 100 ? 'EXCEEDED' : 'near limit') + ' · ' + b.category,
            text: coName(b.companyId || 'group') + ' — ' + ui.money(spent) + ' of ' + ui.money(b.amount) + ' (' + Math.round(pct) + '%) spent in ' + ymNow });
        }
      });
      db.col('acc_schedules').forEach(function (s) {
        if (s.status === 'Paid' || s.status === 'Cancelled' || !(s.due && s.due < TODAY_STR)) return;
        var nid = 'NS-' + s.id + '-' + s.due;
        if (haveN[nid]) return;
        var open = (+s.amount || 0) - (+s.paidAmount || 0);
        db.notify({ id: nid, level: 'warn', icon: 'calendar2-x', companyId: s.companyId || 'group',
          title: 'Overdue ' + (s.kind === 'Receivable' ? 'receivable' : 'payable') + ' · ' + s.party,
          text: ui.money(open) + ' was due ' + ui.date(s.due) + ' (' + coName(s.companyId || 'group') + ') — open it in Payment Schedules' });
      });
    } catch (x) {}
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
      if (sub === 'loans' && selCo === 'all') { /* the loan desk reads 'all' fine */ }
      var titles = {}; SECTIONS.forEach(function (s) { titles[s[0]] = s[1]; });
      if (sub === 'payroll' && (selCo === 'all')) selCo = 'travels';
      page.appendChild(EPAL.pageHead({
        eyebrow: 'Epal Group · Master Accounts', icon: 'safe2', title: titles[sub],
        sub: 'Group-level accounting across every sister concern — switch company with the buttons below.'
      }));
      // section nav — calm underline tabs (primary), per the owner's mock
      var pills = el('div.tab-underline.tabs-dense.mb-3');   // 9 sections — dense
      SECTIONS.forEach(function (s) { pills.appendChild(el('button' + (sub === s[0] ? '.active' : ''), { text: s[1], onclick: function () { EPAL.router.navigate('group/master-accounts/' + s[0]); } })); });
      page.appendChild(pills);
      // AUDIT P2: the period lock is VISIBLE wherever money is handled
      var lockYm = (EPAL.ledger && EPAL.ledger.lockedThrough) ? EPAL.ledger.lockedThrough() : null;
      if (lockYm) page.appendChild(el('div.mb-2', null, [
        el('span.badge.badge-warn', { html: ui.icon('lock-fill') + ' Books locked through ' + esc(lockYm) + ' — back-dated entries are blocked (reopen in Consolidated Finance)' })
      ]));
      // COMPANY SWITCHER — the owner's "button-wise switch of companies at the top".
      // On Master Payroll it rides IN the desk's section row (owner mark);
      // everywhere else it is its own row under the tabs.
      var swWrap = el('div.flex.gap-1.scroll-row.mb-3');
      // Manage Banks gets an "Overview" button at the FRONT of the company row
      // (owner 2026-07-19): it shows the all-companies bank card DASHBOARD;
      // picking a company shows that company's Manage-Banks table instead.
      if (sub === 'banks') {
        swWrap.appendChild(el('button.btn.btn-sm' + (banksDash ? '.btn-primary' : '.btn-outline'), {
          html: ui.icon('grid-3x3-gap-fill') + ' Overview',
          onclick: function () { banksDash = true; EPAL.router.render(); } }));
      }
      var swOpts = [['all', 'All Companies'], ['group', 'Group HQ']].concat(comps().map(function (c) { return [c.id, c.short]; }));
      swOpts.forEach(function (o) {
        if (sub === 'payroll' && o[0] === 'all') return;      // payroll needs one company
        var active = (selCo === o[0]) && !(sub === 'banks' && banksDash);
        swWrap.appendChild(el('button.btn.btn-sm' + (active ? '.btn-primary' : '.btn-outline'), {
          text: o[1], onclick: function () { selCo = o[0]; if (sub === 'banks') banksDash = false; EPAL.router.render(); } }));
      });
      // payroll + expenses have their own sub-section row — the switcher
      // rides IN that row (one line, hairline separator); other sections
      // keep it as its own row
      if (sub !== 'payroll' && sub !== 'expenses' && sub !== 'loans' && sub !== 'cash') page.appendChild(swWrap);
      else pendingSwitcher = swWrap;
      if (sub === 'expenses') {
        // buttons at the top of the ONE expenses section (owner directive) —
        // sub-tabs + company switcher share ONE row, hairline between
        var tb = el('div.pill-tab');
        EXP_TABS.forEach(function (t) {
          tb.appendChild(el('button' + (expTab === t[0] ? '.active' : ''), { text: t[1], onclick: function () { expTab = t[0]; EPAL.router.render(); } }));
        });
        var expRow = el('div.nav-row.mb-3');
        expRow.appendChild(tb);
        if (pendingSwitcher) {
          expRow.appendChild(el('div.vsep'));
          pendingSwitcher.classList.remove('mb-3'); pendingSwitcher.classList.remove('scroll-row');
          pendingSwitcher.classList.add('co-sw');
          expRow.appendChild(pendingSwitcher); pendingSwitcher = null;
        }
        page.appendChild(expRow);
        ({ all: expensesView, budget: budgetView, report: reportView, categories: categoriesView }[expTab] || expensesView)(page);
      } else {
        ({ accounts: accountsView, journals: journalsView, schedules: schedulesView, 'party-types': partyTypesView,
           payroll: payrollView, banks: (banksDash ? overviewView : banksView), loans: loansSection, cash: cashSection }[sub])(page);
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
        // mirror into the GL — Cash pays from 1000, everything else from 1010
        try { EPAL.ledger.post({ id: 'GL-MX-' + r.id, date: r.date, companyId: r.companyId, ref: r.ref || r.id, memo: r.category + (r.subCategory ? ' · ' + r.subCategory : '') + (r.desc ? ' — ' + r.desc : ''), source: 'manual', party: r.party, lines: [{ account: expenseAccountFor(r.category + ' ' + r.subCategory), dr: r.amount, cr: 0 }, { account: r.method === 'Cash' ? '1000' : '1010', dr: 0, cr: r.amount }] }); } catch (e) { ui.toast(e.message || 'Ledger mirror failed', 'error'); }
        ui.toast('Expense recorded', 'success'); EPAL.router.render(); return true;
      }
    });
  }

  /* ======================================================= CATEGORY & SUB-CATEGORY
   * Production parity: the Category list and the Sub Category list (parent
   * badge · usage · status) live in ONE screen, stacked. */
  /* Budget Setup · Expense Report · Category & Sub-category MOVED OUT
     (owner 2026-07-15: Travels needs them too). They now live in the shared
     kit platform/kit/expenses.js and are rendered from EPAL.expenseViews by
     BOTH this desk and Travels Accounts — one implementation, so the two can
     never drift apart. The dispatch below adapts them to this desk's selCo. */
  function categoriesView(page) { EPAL.expenseViews.categories(page, selCo, { canEdit: true }); }
  function budgetView(page) { EPAL.expenseViews.budget(page, selCo); }
  function reportView(page) { EPAL.expenseViews.report(page, selCo, { onBack: function () { expTab = 'all'; EPAL.router.render(); } }); }
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
    // ---- P3: VAT & AIT RETURN (BD tax cycle: collect → report → deposit) ----
    (function () {
      var scope = selCo === 'all' ? {} : { companyId: selCo };
      function taxRow(code, label) {
        var coll = 0, dep = 0;
        list.forEach(function (e) {
          if (String(e.date).slice(0, 7) !== taxYm) return;
          (e.lines || []).forEach(function (l) { if (l.account === code) { coll += +l.cr || 0; dep += +l.dr || 0; } });
        });
        var closing = 0;
        try { closing = L.balance(code, scope); } catch (e2) { closing = 0; }
        return { code: code, label: label, collected: coll, deposited: dep, closing: closing };
      }
      var rows = [taxRow('2130', 'VAT (output, on services)'), taxRow('2140', 'AIT / TDS (withheld)')];
      var mSel = el('input.input', { type: 'month', value: taxYm, style: { width: 'auto' }, onchange: function () { taxYm = this.value || taxYm; EPAL.router.render(); } });
      var bodyT = el('div.card-body');
      bodyT.appendChild(el('div.flex.gap-2.items-center.mb-2', null, [el('span.text-mute.sm', { text: 'Return period' }), mSel,
        el('span.text-mute.xs', { text: 'collected via the Credit/Debit journal tax fields · deposit clears the payable' })]));
      rows.forEach(function (r) {
        bodyT.appendChild(el('div.data-row', null, [
          el('div.flex-1', null, [el('div.fw-600.sm', { text: r.code + ' · ' + r.label }),
            el('div.text-mute.xs', { text: taxYm + ': collected ' + ui.money(r.collected) + ' · deposited ' + ui.money(r.deposited) })]),
          el('div.num.strong' + (r.closing > 0.5 ? '.text-warn' : ''), { text: 'Payable ' + ui.money(r.closing) }),
          canCreate() && r.closing > 0.5 ? el('button.btn.btn-sm.btn-outline', { style: { marginLeft: '10px' },
            html: ui.icon('bank') + ' Record NBR Deposit', onclick: function () { nbrDepositForm(r.code, r.label, r.closing); } }) : null
        ].filter(Boolean)));
      });
      page.appendChild(el('div.card.mb-2', null, [
        el('div.card-head', null, [el('h3', { html: ui.icon('receipt') + ' VAT & AIT Return — ' + coName(selCo) }),
          el('span.card-sub', { text: 'Bangladesh NBR cycle' })]), bodyT]));
    })();
    var cols = [
      { key: 'date', label: 'Date', date: true },
      { key: 'ref', label: 'Reference', render: function (e) { return '<span class="mono xs text-mute">' + esc(e.ref || e.id) + '</span>'; } },
      { key: 'source', label: 'Source', badge: { sale: 'good', manual: 'info', opening: 'accent', payroll: 'warn', refund: 'bad', reversal: 'bad', intercompany: 'accent', bank: 'info', payment: 'good' } },
      { key: 'memo', label: 'Description', render: function (e) { return esc(e.memo || '—') + (e.reversedBy ? ' <span class="badge badge-bad">reversed</span>' : ''); } },
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
  // P3: deposit a tax payable to the NBR — DR 2130|2140 / CR bank, logged on
  // the bank register too so the reconciliation stays exact.
  function nbrDepositForm(code, label, closing) {
    var banks = db.col('banks').filter(function (b) { return (b.status || 'Active') !== 'Inactive'; });
    if (!banks.length) { ui.toast('Add a bank account first (Manage Banks)', 'error'); return; }
    EPAL.formModal({
      title: 'NBR Deposit — ' + label, icon: 'bank', size: 'sm',
      record: { amount: Math.round(closing), date: TODAY_STR, bankId: banks[0].id, companyId: selCo === 'all' ? 'group' : selCo },
      fields: [
        { key: 'companyId', label: 'Company', type: 'select', required: true, options: [['group', 'Group HQ']].concat(comps().map(function (c) { return [c.id, c.short]; })) },
        { key: 'bankId', label: 'Paid from bank', type: 'select', required: true, options: banks.map(function (b) { return [b.id, b.name + ' (' + ui.money(b.balance, { compact: true }) + ')']; }) },
        { key: 'amount', label: 'Deposit amount (৳)', type: 'money', required: true, min: 1, hint: 'Payable to date: ' + ui.money(closing) },
        { key: 'date', label: 'Deposit date', type: 'date', required: true },
        { key: 'ref', label: 'Challan / reference no', type: 'text', placeholder: 'e.g. TR-6 challan no' }
      ],
      saveLabel: 'Record Deposit',
      onSave: function (v) {
        var amt = +v.amount || 0; if (amt <= 0) { ui.toast('Enter an amount', 'error'); return false; }
        var bank = db.col('banks').filter(function (b) { return b.id === v.bankId; })[0];
        if (!bank) { ui.toast('Pick a bank', 'error'); return false; }
        if ((+bank.balance || 0) < amt) { ui.toast('Insufficient balance — available ' + ui.money(bank.balance), 'error'); return false; }
        var memo = label + ' deposit to NBR' + (v.ref ? ' · challan ' + v.ref : '');
        var glId = 'GL-NBR-' + ui.uid('').slice(-6).toUpperCase();
        try {
          EPAL.ledger.post({ id: glId, date: v.date, companyId: v.companyId, ref: v.ref || 'NBR', memo: memo, source: 'bank',
            lines: [{ account: code, dr: amt, cr: 0 }, { account: '1010', dr: 0, cr: amt }] });
        } catch (e) { ui.toast(e.message || 'Ledger post failed', 'error'); return false; }
        bankTxnApply(bank, 'withdraw', amt, v.date, memo, v.ref || '', glId);
        ui.toast(label + ' deposit recorded — ' + ui.money(amt), 'success'); EPAL.router.render(); return true;
      }
    });
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
        // AUDIT P3 (BD tax cycle): optional split — collected VAT rides to
        // 2130 on money-in; withheld AIT/TDS rides to 2140 on money-out
        isCr ? { key: 'vat', label: 'VAT included (৳) → 2130', type: 'money', min: 0, hint: 'Part of the amount that is output VAT (e.g. 15% of the service charge). Leave 0 if none.' }
             : { key: 'tds', label: 'AIT / TDS withheld (৳) → 2140', type: 'money', min: 0, hint: 'Tax withheld from the payee and owed to the NBR. The bank pays amount minus this.' },
        { key: 'ref', label: 'Reference', type: 'text', placeholder: 'e.g. JV-001' },
        { key: 'desc', label: 'Description', type: 'textarea', col2: true }
      ],
      saveLabel: isCr ? 'Save Credit Journal' : 'Save Debit Journal',
      onSave: function (v) {
        var amt = +v.amount || 0; if (amt <= 0) { ui.toast('Enter an amount', 'error'); return false; }
        var vat = isCr ? Math.max(0, +v.vat || 0) : 0;
        var tds = !isCr ? Math.max(0, +v.tds || 0) : 0;
        if (vat >= amt || tds >= amt) { ui.toast('Tax portion must be less than the amount', 'error'); return false; }
        var bank = db.col('banks').filter(function (b) { return b.id === v.bankId; })[0];
        if (!bank) { ui.toast('Pick a bank', 'error'); return false; }
        var bankMove = isCr ? amt : amt - tds;               // withheld tax never leaves the bank
        if (!isCr && (+bank.balance || 0) < bankMove) { ui.toast('Insufficient balance — available ' + ui.money(bank.balance), 'error'); return false; }
        var memo = (isCr ? 'Deposit to ' : 'Withdrawal from ') + bank.name + (v.desc ? ' — ' + v.desc : '')
          + (vat ? ' · VAT ' + ui.money(vat) : '') + (tds ? ' · TDS ' + ui.money(tds) : '');
        var glId = 'GL-BK-' + ui.uid('').slice(-6).toUpperCase();
        var lines = isCr
          ? [{ account: '1010', dr: amt, cr: 0 }, { account: v.account, dr: 0, cr: amt - vat }].concat(vat ? [{ account: '2130', dr: 0, cr: vat }] : [])
          : [{ account: v.account, dr: amt, cr: 0 }, { account: '1010', dr: 0, cr: bankMove }].concat(tds ? [{ account: '2140', dr: 0, cr: tds }] : []);
        try {
          EPAL.ledger.post({ id: glId, date: v.date, companyId: v.companyId,
            ref: v.ref || ('BANK-' + (isCr ? 'DEP' : 'WDR')), memo: memo, source: 'bank', lines: lines });
        } catch (e) { ui.toast(e.message || 'Ledger post failed', 'error'); return false; }
        bankTxnApply(bank, isCr ? 'deposit' : 'withdraw', bankMove, v.date, memo, v.ref || '', glId);
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
        el('div.data-row', null, [el('div.text-mute.sm.flex-1', { text: 'Source / Ref' }), el('div.strong', { text: (e.source || '—') + ' · ' + (e.ref || '—') })]),
        el('div.data-row', null, [el('div.text-mute.sm.flex-1', { text: 'Posted by' }), el('div.strong', { text: e.by || '—' })]),
        e.reversedBy ? el('div.data-row', null, [el('div.text-mute.sm.flex-1', { text: 'Reversed' }), el('div', null, [el('span.badge.badge-bad', { text: 'Reversed by ' + e.reversedBy })])]) : null
      ].filter(Boolean)),
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
          { icon: 'check-lg', title: 'Approve (with note)', onClick: function (s) {
            if (!openActs(s) || s.status === 'Approved') { ui.toast('Nothing to approve', 'error'); return; }
            approveScheduleForm(s);
          } },
          { icon: 'cash-coin', title: 'Payment done', onClick: function (s) { if (openActs(s)) schedulePayForm(s); else ui.toast('Already settled', 'error'); } },
          { icon: 'calendar2-plus', title: 'Reschedule', onClick: function (s) { if (openActs(s)) rescheduleForm(s); else ui.toast('Already settled', 'error'); } },
          { icon: 'x-circle', title: 'Cancel (with reason)', onClick: function (s) {
            if (!openActs(s)) { ui.toast('Already settled', 'error'); return; }
            cancelScheduleForm(s);
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
  // AUDIT P2: every lifecycle action leaves a note on the schedule's TRAIL
  // (production PaymentScheduleLog parity — who, when, what, why).
  function schedTrail(s, action, note) {
    var who = 'Owner';
    try { var u = EPAL.auth && EPAL.auth.current && EPAL.auth.current(); who = (u && (u.name || u.email)) || 'Owner'; } catch (e) {}
    s.trail = (s.trail || []).concat([{ action: action, at: new Date().toISOString().slice(0, 16).replace('T', ' '), by: who, note: note || '' }]);
  }
  function approveScheduleForm(s) {
    EPAL.formModal({
      title: 'Approve — ' + s.party, icon: 'check-lg', size: 'sm', record: {},
      fields: [{ key: 'note', label: 'Approval note (why / on what basis)', type: 'textarea', placeholder: 'e.g. verified against the vendor bill' }],
      saveLabel: 'Approve',
      onSave: function (v) {
        s.status = 'Approved'; s.approvedAt = TODAY_STR;
        schedTrail(s, 'approved', v.note);
        db.save('acc_schedules', s);
        ui.toast('Approved', 'success'); EPAL.router.render(); return true;
      }
    });
  }
  function cancelScheduleForm(s) {
    EPAL.formModal({
      title: 'Cancel — ' + s.party, icon: 'x-circle', size: 'sm', record: {},
      fields: [{ key: 'note', label: 'Cancellation reason', type: 'textarea', required: true }],
      saveLabel: 'Cancel Schedule',
      onSave: function (v) {
        s.status = 'Cancelled';
        schedTrail(s, 'cancelled', v.note);
        db.save('acc_schedules', s);
        ui.toast('Cancelled', 'success'); EPAL.router.render(); return true;
      }
    });
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
      ].filter(Boolean)),
      // AUDIT P2: the action trail — who did what, when, and why
      (s.trail && s.trail.length) ? el('div', null, [
        el('div.section-label', { text: 'Approval & Action Trail' }),
        el('div.data-list', null, s.trail.slice().reverse().map(function (t) {
          var badge = { approved: 'good', paid: 'good', partial_paid: 'warn', rescheduled: 'warn', cancelled: 'bad' }[t.action] || 'info';
          return el('div.data-row', null, [
            el('span.badge.badge-' + badge, { text: t.action.replace('_', ' ') }),
            el('div.flex-1.sm', { style: { marginLeft: '10px' }, text: (t.note || '—') }),
            el('div.text-mute.xs', { text: t.by + ' · ' + t.at })
          ]);
        }))
      ]) : null
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
        schedTrail(s, partial ? 'partial_paid' : 'paid', ui.money(amt) + ' via ' + v.method);
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
        schedTrail(s, 'rescheduled', 'to ' + ui.date(v.due) + ' — ' + v.reason);
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

  /* ======================================================= MANAGE LOAN
   * The external loan book + a read-only mirror of the payroll staff book —
   * the whole desk lives in platform/kit/loans.js (EPAL.loanDesk). */
  function loansSection(page) {
    if (EPAL.loanDesk) EPAL.loanDesk(page, selCo, { rightEl: pendingSwitcher });
    else page.appendChild(el('div.card', null, [el('div.card-body', { text: 'Loan desk unavailable.' })]));
    pendingSwitcher = null;
  }

  /* ======================================================= MANAGE CASH
   * Hard cash (GL 1000) + read-only mirrors of cash-in-sell / petty / cheques —
   * the whole desk lives in platform/kit/cash.js (EPAL.cashDesk). */
  function cashSection(page) {
    if (EPAL.cashDesk) EPAL.cashDesk(page, selCo, { rightEl: pendingSwitcher });
    else page.appendChild(el('div.card', null, [el('div.card-body', { text: 'Cash desk unavailable.' })]));
    pendingSwitcher = null;
  }

  /* ======================================================= MASTER PAYROLL */
  var pendingSwitcher = null;                          // set by render for payroll
  function payrollView(page) {
    // the company switcher rides in the desk's section row (owner mark)
    if (EPAL.payrollDesk) EPAL.payrollDesk(page, selCo === 'all' ? 'travels' : selCo, { rightEl: pendingSwitcher });
    else page.appendChild(el('div.card', null, [el('div.card-body', { text: 'Payroll desk unavailable.' })]));
    pendingSwitcher = null;
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
      var in4000 = 0;
      try { in4000 = L.balance('4000', scope); } catch (e0) {}
      page.appendChild(el('div.flex.gap-1.flex-wrap.mb-2', null, [
        el('button.btn.btn-sm.btn-primary', { html: ui.icon('plus-square') + ' Add Account', onclick: addAccountForm }),
        el('button.btn.btn-sm.btn-outline', { html: ui.icon('flag') + ' Opening Balance', onclick: openingBalanceForm }),
        el('button.btn.btn-sm.btn-outline', { html: ui.icon('shuffle') + ' Reclass 4000 Catch-all' + (in4000 > 0.5 ? ' (' + ui.money(in4000, { compact: true }) + ')' : ''), onclick: reclass4000Tool })
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
          // db.save (NOT S.set) so the write-through layer sees a data:changed
          // event and persists the new head to the real accounts table (coa is
          // WRITABLE for ADD only — see platform/data/api.js). Demo mode just
          // keeps it local, exactly as before.
          db.save('coa', { id: code, code: code, name: (val.name || '').trim() || code, type: type,
            normal: (type === 'asset' || type === 'expense') ? 'debit' : 'credit', group: val.group || 'Other', intercompany: false });
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

  /* ---- P3: 4000 CATCH-ALL RECLASS TOOL --------------------------------------
   * Every sale that landed in the generic 4000 head gets a suggested proper
   * income line (via the ledger's own income mapper). Applying posts an
   * explicit reclass journal (DR 4000 / CR target) per entry — the original
   * stays untouched, the P&L moves to the right line. */
  function reclass4000Tool() {
    var L = EPAL.ledger;
    var glIds = {}; L.entries({}).forEach(function (g) { glIds[g.id] = 1; });
    var rows = [];
    L.entries(selCo === 'all' ? {} : { companyId: selCo }).forEach(function (e) {
      if (glIds['GL-RC4K-' + e.id]) return;                        // already reclassed
      var amt = 0; (e.lines || []).forEach(function (l) { if (l.account === '4000') amt += (+l.cr || 0) - (+l.dr || 0); });
      if (amt < 0.5) return;
      var sug = '4000';
      try { sug = L.incomeAccountFor({ category: e.memo, desc: (e.memo || '') + ' ' + (e.ref || '') }) || '4000'; } catch (x) {}
      rows.push({ e: e, amt: amt, sug: sug === '4000' ? '' : sug });
    });
    if (!rows.length) { ui.toast('Nothing sitting in 4000 for this scope — all clean', 'success'); return; }
    var incomeOpts = L.accounts().filter(function (a) { return a.type === 'income' && a.code !== '4000' && a.active !== false; })
      .map(function (a) { return [a.code, a.code + ' · ' + a.name]; });
    var body = el('div');
    var m = ui.modal({ title: 'Reclass 4000 Catch-all — ' + rows.length + ' entries · ' + ui.money(rows.reduce(function (a, r) { return a + r.amt; }, 0)), icon: 'shuffle', size: 'xl', body: body, footer: false });
    var sels = [];
    body.appendChild(el('p.text-mute.sm.mb-2', { text: 'Pick the proper income line per entry (suggestions pre-filled where the memo gives one away). Applying posts an explicit reclass journal — originals stay untouched.' }));
    var t = el('table.tbl');
    t.appendChild(el('thead', null, [el('tr', null, [el('th', { text: 'Date' }), el('th', { text: 'Company' }), el('th', { text: 'Memo' }),
      el('th.num', { text: 'In 4000' }), el('th', { text: 'Move to' })])]));
    var tb = el('tbody');
    rows.forEach(function (r) {
      var sel = el('select.input', { style: { minWidth: '210px' } });
      sel.appendChild(el('option', { value: '', text: '— keep in 4000 —' }));
      incomeOpts.forEach(function (o) { var op = el('option', { value: o[0], text: o[1] }); if (r.sug === o[0]) op.selected = true; sel.appendChild(op); });
      sels.push({ r: r, sel: sel });
      tb.appendChild(el('tr', null, [
        el('td', { text: ui.date(r.e.date) }), el('td', { text: coName(r.e.companyId) }),
        el('td', { text: (r.e.memo || r.e.ref || r.e.id).slice(0, 48) }),
        el('td.num', { html: ui.money(r.amt) }), el('td', null, [sel])
      ]));
    });
    t.appendChild(tb);
    body.appendChild(el('div.table-wrap', { style: { maxHeight: '420px', overflowY: 'auto' } }, [t]));
    body.appendChild(el('div.flex.justify-between.mt-2', null, [
      el('span.text-mute.xs', { text: 'Reclass journals post as GL-RC4K-<entry> · source manual · one per entry' }),
      el('button.btn.btn-primary', { html: ui.icon('check-lg') + ' Apply Selected Reclasses', onclick: function () {
        var n = 0, amt = 0;
        sels.forEach(function (x) {
          var to = x.sel.value; if (!to) return;
          try {
            EPAL.ledger.post({ id: 'GL-RC4K-' + x.r.e.id, date: TODAY_STR, companyId: x.r.e.companyId, ref: 'RECLASS-' + (x.r.e.ref || x.r.e.id),
              memo: 'Reclass from 4000 → ' + to + ' — ' + (x.r.e.memo || x.r.e.id), source: 'manual', party: x.r.e.party || '', override: true,
              lines: [{ account: '4000', dr: x.r.amt, cr: 0 }, { account: to, dr: 0, cr: x.r.amt }] });
            n++; amt += x.r.amt;
          } catch (e2) {}
        });
        m.close();
        ui.toast(n ? (n + ' entries reclassed · ' + ui.money(amt) + ' moved off 4000') : 'Nothing selected', n ? 'success' : 'error');
        EPAL.router.render();
      } })
    ]));
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
  // shared so other desks (Manage Loan) move bank money the SAME way — one
  // implementation keeps the bank register and the reconciliation card honest
  EPAL.bankTxnApply = bankTxnApply;

  /* Add / edit a bank account — TOP-LEVEL (owner 2026-07-19) so BOTH the
     Overview dashboard and the Manage-Banks table can open it. */
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
  /* Delete a bank account (confirm → API soft-delete via db.remove). */
  function deleteBank(b) {
    ui.confirm({ title: 'Delete ' + b.name + '?', text: 'Balance ' + ui.money(b.balance) + ' leaves the cash position. This cannot be undone.', danger: true, confirmLabel: 'Delete' })
      .then(function (ok) { if (!ok) return; db.remove('banks', b.id); ui.toast(b.name + ' deleted', 'success'); EPAL.router.render(); });
  }

  /* ======================================================= OVERVIEW
   * Bank Accounts Dashboard (owner 2026-07-19, mirrors the production ERP):
   * every sister-concern account combined, as cards; click one → its full
   * ledger (bankAccountDetail). Respects the company switcher scope. */
  function overviewView(page) {
    var allBanks = db.col('banks');
    var banks = allBanks.filter(function (b) { return selCo === 'all' ? true : (b.companyId || 'group') === selCo; });
    var total = banks.reduce(function (a, b) { return a + (+b.balance || 0); }, 0);
    var active = banks.filter(function (b) { return (b.status || 'Active') !== 'Inactive'; }).length;

    page.appendChild(el('div.kpi-grid.kpi-compact.stagger', null, [
      kpi('Total Balance', ui.money(total, { compact: true }), 'safe2'),
      kpi('Accounts', String(banks.length), 'bank'),
      kpi('Active', String(active), 'check-circle'),
      kpi('Scope', selCo === 'all' ? 'All companies' : coName(selCo), 'diagram-3')
    ]));

    if (canCreate()) page.appendChild(el('div.flex.gap-1.flex-wrap.mb-2', null, [
      el('button.btn.btn-sm.btn-primary', { html: ui.icon('plus-lg') + ' Add New Bank', onclick: function () { editBank(null); } }),
      el('a.btn.btn-sm.btn-outline', { href: '#/group/master-accounts/cash', html: ui.icon('cash-stack') + ' Manage cash' })
    ]));

    page.appendChild(el('div.section-label', { text: 'Bank Accounts — ' + (selCo === 'all' ? 'all sister concerns' : coName(selCo)) }));
    if (!banks.length) { page.appendChild(el('div.card', null, [ el('div.card-pad.text-mute', { text: 'No bank accounts in this scope.' }) ])); return; }

    var txns = S.list('bank_txns');
    var detailHost = el('div.mt-3');        // the clicked account's ledger renders INLINE here (not a modal)
    var grid = el('div.grid-auto.stagger', { style: { gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' } });
    // in/out sense for a txn — used to walk a bank's opening back from its
    // current (closing) balance, and to label the last movement on the card.
    var isIn = function (t) { return t.type === 'deposit' || t.type === 'transfer-in'; };
    // one line of the green Opening/Closing/Last-Tranx meta column — a quiet
    // green label + a strong value, 10% smaller than the card body (owner spec).
    function metaRow(label, value, valCls) {
      return el('div', { style: { whiteSpace: 'nowrap', lineHeight: '1.5' } }, [
        el('span', { style: { color: 'var(--good)' }, text: label + ': ' }),
        el('span.strong' + (valCls || ''), { text: value })
      ]);
    }
    banks.forEach(function (b) {
      var mine = txns.filter(function (t) { return t.bankId === b.id; });
      var last = mine.slice().sort(function (x, y) { return (x.date < y.date ? 1 : -1); })[0];
      var closing = +b.balance || 0;
      var opening = closing - mine.reduce(function (a, t) { return a + (isIn(t) ? (+t.amount || 0) : -(+t.amount || 0)); }, 0);
      var lastStr = last ? ui.money(last.amount) + (last.memo ? ' (' + last.memo + ')' : '') : '—';
      var card = el('div.card.hover', { style: { cursor: 'pointer' }, onclick: function () {
          ui.$$('.card', grid).forEach(function (c) { c.classList.remove('sel'); });
          card.classList.add('sel');
          bankAccountDetail(b, detailHost);
          detailHost.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } }, [
        el('div.card-pad', null, [
          // header — avatar · name/branch · status · edit/delete (unchanged actions)
          el('div.flex.items-center.gap-2.mb-2', null, [
            el('div.avatar', { style: { background: ui.colorFor(b.name), width: '32px', height: '32px', fontSize: '12px' },
              html: '<i class="bi bi-' + (b.type === 'Cash Box' ? 'cash-stack' : 'bank') + '"></i>' }),
            el('div.flex-1.min-w-0', null, [
              el('div.fw-700', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, text: b.name }),
              el('div.text-mute.xs', { text: coName(b.companyId || 'group') + (b.branch ? ' · ' + b.branch : '') })
            ]),
            (b.status || 'Active') === 'Inactive' ? el('span.badge', { text: 'Inactive' }) : el('span.badge.badge-good', { text: 'Active' }),
            canCreate() ? el('div.flex.gap-1', null, [
              el('button.icon-btn.btn-sm', { title: 'Edit', html: ui.icon('pencil'),
                onclick: function (e) { e.stopPropagation(); editBank(b); } }),
              el('button.icon-btn.btn-sm', { title: 'Delete', html: ui.icon('trash'),
                onclick: function (e) { e.stopPropagation(); deleteBank(b); } })
            ]) : null
          ]),
          // body — balance + A/C on the left, green Opening/Closing/Last-Tranx on the right
          el('div.flex.items-end.justify-between.gap-3', null, [
            el('div.min-w-0', null, [
              el('div.num.strong' + (closing < 0 ? '.text-bad' : ''), { style: { fontSize: '20px', lineHeight: '1.15' }, text: ui.money(b.balance) }),
              el('div.text-mute.xs.mt-1', { text: b.account ? 'A/C ' + b.account : '—' })
            ]),
            el('div', { style: { borderLeft: '2px solid var(--good)', paddingLeft: '10px', fontSize: '90%' } }, [
              metaRow('Opening', ui.money(opening)),
              metaRow('Closing', ui.money(closing), closing < 0 ? '.text-bad' : ''),
              metaRow('Last Tranx', lastStr)
            ])
          ])
        ])
      ]);
      grid.appendChild(card);
    });
    page.appendChild(grid);
    page.appendChild(detailHost);
    // auto-open the first account so the ledger area is never blank
    if (banks.length) { grid.firstChild.classList.add('sel'); bankAccountDetail(banks[0], detailHost); }
  }

  /* ---- BANK ACCOUNT DETAIL — click an account card → its full ledger.
   * All transactions for ONE account, newest first, with a running balance,
   * date-range + direction (in/out) filters, and print (the current filtered
   * view = all · a single day · a custom range · only-in · only-out) plus a
   * per-row print for a single transaction. Mirrors the production ERP. */
  function bankAccountDetail(bank, host) {
    var isIn = function (t) { return t.type === 'deposit' || t.type === 'transfer-in'; };
    var all = S.list('bank_txns').filter(function (t) { return t.bankId === bank.id; });
    all.forEach(function (t, i) { t._seq = i; });
    function newestFirst(a, b) { return (a.date === b.date) ? b._seq - a._seq : (a.date < b.date ? 1 : -1); }
    // running balance: newest txn's closing IS the live balance; walk backward.
    var bal = +bank.balance || 0;
    all.slice().sort(newestFirst).forEach(function (t) {
      t._after = bal; t._before = bal - (isIn(t) ? (+t.amount || 0) : -(+t.amount || 0)); bal = t._before;
    });

    var state = { from: '', to: '', dir: 'all' };
    function rowsNow() {
      return all.filter(function (t) {
        if (state.from && (t.date || '') < state.from) return false;
        if (state.to && (t.date || '') > state.to) return false;
        if (state.dir === 'in' && !isIn(t)) return false;
        if (state.dir === 'out' && isIn(t)) return false;
        return true;
      }).sort(newestFirst);
    }
    function stat(l, v, cls) { return el('div.stat', null, [ el('div.stat-label', { text: l }), el('div.stat-value.num' + (cls || ''), { html: v }) ]); }
    function drcr(v) { v = +v || 0; return ui.money(Math.abs(v)) + (v < 0 ? ' Cr' : ' Dr'); }
    function printLabel() {
      var d = state.dir === 'in' ? 'In only' : state.dir === 'out' ? 'Out only' : 'All';
      var r = (state.from || state.to) ? ((state.from || '…') + ' → ' + (state.to || '…')) : 'All dates';
      return d + ' · ' + r;
    }
    function printRows(list, label) {
      var head = '<tr><th>#</th><th>Date</th><th>Reference</th><th>Source</th><th>Description / Note</th>' +
        '<th style="text-align:right">Debit</th><th style="text-align:right">Credit</th><th style="text-align:right">Balance</th></tr>';
      var rows = list.map(function (t, i) {
        var v = +t._after || 0;
        return '<tr><td>' + (i + 1) + '</td><td>' + esc(ui.date(t.date)) + '</td><td>' + esc(t.ref || '') + '</td>' +
          '<td>' + esc(t.source || t.type || '') + '</td><td>' + esc(t.desc || t.type || '') + '</td>' +
          '<td style="text-align:right">' + (isIn(t) ? ui.money(t.amount) : '') + '</td>' +
          '<td style="text-align:right">' + (!isIn(t) ? ui.money(t.amount) : '') + '</td>' +
          '<td style="text-align:right">' + drcr(v) + '</td></tr>';
      }).join('');
      ui.printDoc({ title: bank.name + ' — Bank Statement', subtitle: coName(bank.companyId || 'group') + ' · ' + (label || 'All transactions'),
        meta: 'Account: ' + (bank.account || '—') + ' · Closing Balance: ' + drcr(+bank.balance || 0), footer: 'Epal Group — Bank Account Statement',
        bodyHtml: '<table>' + head + rows + '</table>' });
    }

    // INLINE ledger — renders into `host` at the bottom of the Overview page
    // (owner: not a modal), styled like the production ERP bank detail.
    function draw() {
      host.innerHTML = '';
      var rows = rowsNow();
      var tin = rows.filter(isIn).reduce(function (a, t) { return a + (+t.amount || 0); }, 0);
      var tout = rows.filter(function (t) { return !isIn(t); }).reduce(function (a, t) { return a + (+t.amount || 0); }, 0);
      var opening = rows.length ? (+rows[rows.length - 1]._before || 0) : (+bank.balance || 0);
      var closing = rows.length ? (+rows[0]._after || 0) : (+bank.balance || 0);

      // ---- header band (bank name + scope + Print) ----
      host.appendChild(el('div.card.mb-2', { style: { background: 'linear-gradient(135deg, var(--epal-royal,#123499), var(--accent,#1A43BF))', border: 'none', color: '#fff' } }, [
        el('div.card-pad.flex.items-center.gap-2.flex-wrap', null, [
          el('div.flex-1.min-w-0', null, [
            el('div.fw-700', { style: { fontSize: '18px' }, html: ui.icon('bank') + ' ' + esc(bank.name) }),
            el('div', { style: { opacity: '.85', fontSize: '12px' }, text: coName(bank.companyId || 'group') + (bank.branch ? ' · ' + bank.branch : '') + (state.from || state.to ? '  ·  ' + (state.from || '…') + ' → ' + (state.to || '…') : '') })
          ]),
          el('button.btn.btn-sm', { style: { background: '#fff', color: 'var(--accent, #1A43BF)', fontWeight: '700' },
            html: ui.icon('printer') + ' Print', onclick: function () { printRows(rows, printLabel()); } })
        ])
      ]));

      // ---- account info row ----
      host.appendChild(el('div.card.mb-2', null, [ el('div.card-body', null, [
        el('div.stat-row', null, [
          stat('Account Name', esc(bank.accountName || coName(bank.companyId || 'group'))),
          stat('Account Number', esc(bank.account || '—')),
          stat('Type', esc((bank.type || 'Bank') + ' · ' + (bank.accType || 'Current'))),
          stat('Company', esc(coName(bank.companyId || 'group'))),
          stat('Transactions', String(rows.length))
        ])
      ]) ]));

      // ---- opening / debit / credit / closing ----
      host.appendChild(el('div.stat-row.mb-2', null, [
        stat('Opening Balance', drcr(opening)),
        stat('Total Debit (In)', '<span class="text-good">' + ui.money(tin) + '</span>'),
        stat('Total Credit (Out)', '<span class="text-bad">' + ui.money(tout) + '</span>'),
        stat('Closing Balance', drcr(closing), closing < 0 ? '.text-bad' : '')
      ]));

      // ---- filter bar ----
      var fromI = el('input.input', { type: 'date', value: state.from, style: { width: 'auto' } });
      fromI.addEventListener('change', function () { state.from = fromI.value; draw(); });
      var toI = el('input.input', { type: 'date', value: state.to, style: { width: 'auto' } });
      toI.addEventListener('change', function () { state.to = toI.value; draw(); });
      function dirBtn(k, label) { return el('button.btn.btn-sm' + (state.dir === k ? '.btn-primary' : '.btn-outline'), { text: label, onclick: function () { state.dir = k; draw(); } }); }
      host.appendChild(el('div.flex.gap-2.flex-wrap.items-center.mb-2', null, [
        el('span.text-mute.xs', { text: 'From' }), fromI, el('span.text-mute.xs', { text: 'To' }), toI,
        el('button.btn.btn-sm.btn-ghost', { text: 'Today', onclick: function () { var d = (new Date()).toISOString().slice(0, 10); state.from = d; state.to = d; draw(); } }),
        dirBtn('all', 'All'), dirBtn('in', 'Only In'), dirBtn('out', 'Only Out'),
        el('button.btn.btn-sm.btn-outline', { html: ui.icon('x-lg') + ' Clear', onclick: function () { state.from = ''; state.to = ''; state.dir = 'all'; draw(); } }),
        el('button.btn.btn-sm.btn-primary', { style: { marginLeft: 'auto' }, html: ui.icon('printer') + ' Print', onclick: function () { printRows(rows, printLabel()); } })
      ]));

      // ---- transaction table (production columns) ----
      var tbl = EPAL.table({
        columns: [
          { key: 'idx', label: '#', render: function (t) { return String(rows.indexOf(t) + 1); } },
          { key: 'date', label: 'Date', date: true },
          { key: 'ref', label: 'Reference', render: function (t) { return t.ref ? '<span class="mono">' + esc(t.ref) + '</span>' : '<span class="text-mute">—</span>'; } },
          { key: 'source', label: 'Source', render: function (t) { return '<span class="badge">' + esc(t.source || t.type || '—') + '</span>'; }, sortVal: function (t) { return t.source || t.type || ''; } },
          { key: 'desc', label: 'Description / Note', render: function (t) { return esc(t.desc || t.type || '') || '—'; } },
          { key: 'in', label: 'Debit', num: true, render: function (t) { return isIn(t) ? '<span class="num text-good">' + ui.money(t.amount) + '</span>' : '—'; }, sortVal: function (t) { return isIn(t) ? +t.amount : 0; }, exportVal: function (t) { return isIn(t) ? t.amount : ''; } },
          { key: 'out', label: 'Credit', num: true, render: function (t) { return !isIn(t) ? '<span class="num text-bad">' + ui.money(t.amount) + '</span>' : '—'; }, sortVal: function (t) { return !isIn(t) ? +t.amount : 0; }, exportVal: function (t) { return !isIn(t) ? t.amount : ''; } },
          { key: 'bal', label: 'Balance', num: true, render: function (t) { var v = +t._after || 0; return '<span class="num' + (v < 0 ? ' text-bad' : '') + '">' + drcr(v) + '</span>'; }, sortVal: function (t) { return +t._after || 0; }, exportVal: function (t) { return t._after; } }
        ],
        rows: rows, pageSize: 12, exportName: 'bank-statement-' + (bank.account || bank.id) + '.csv',
        searchKeys: ['ref', 'desc', 'source'],
        actions: [{ icon: 'printer', title: 'Print this transaction', onClick: function (t) { printRows([t], 'Single transaction'); } }],
        empty: { icon: 'clock-history', title: 'No transactions found for this account in the selected period.', hint: 'Adjust the date range or the In/Out filter — or this account has no movement yet.' }
      });
      host.appendChild(el('div.card', null, [ el('div.card-body', null, [tbl.el]) ]));
    }
    draw();
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
    // per-company cards, like the production dashboard header. Respects the
    // selected company: on a specific company only THAT company's card shows,
    // not every sister concern (owner 2026-07-19).
    (function () {
      var byCo = {};
      banks.forEach(function (b) { var k = b.companyId || 'group'; byCo[k] = byCo[k] || { total: 0, n: 0 }; byCo[k].total += +b.balance || 0; byCo[k].n++; });
      var strip = el('div.flex.gap-2.flex-wrap.mb-2');
      Object.keys(byCo).forEach(function (k) {
        strip.appendChild(el('div.card', { style: { padding: '10px 14px', cursor: 'pointer', minWidth: '170px' }, onclick: function () { selCo = k; EPAL.router.render(); } }, [
          el('div.fw-600.sm', { text: coName(k) }),
          el('div.strong.num' + (byCo[k].total < 0 ? '.text-bad' : ''), { text: ui.money(byCo[k].total) }),
          el('div.text-mute.xs', { text: byCo[k].n + ' account' + (byCo[k].n === 1 ? '' : 's') + ' · filter' })
        ]));
      });
      // HARD CASH & CHEQUES doorway (owner mark 2026-07-15): cash lives with
      // the banks, so its card rides in this same strip — click → Manage Cash.
      if (EPAL.cashDesk) {
        var cashBal = EPAL.ledger ? EPAL.ledger.balance('1000', selCo === 'all' ? {} : { companyId: selCo }) : 0;
        strip.appendChild(el('div.card', { style: { padding: '10px 14px', cursor: 'pointer', minWidth: '170px' },
          onclick: function () { EPAL.router.navigate('group/master-accounts/cash'); } }, [
          el('div.fw-600.sm', { html: ui.icon('cash-stack') + ' Hard Cash · Cheques' }),
          el('div.strong.num' + (cashBal < 0 ? '.text-bad' : ''), { text: ui.money(cashBal) }),
          el('div.text-mute.xs', { text: 'drawer · petty · cheques → manage cash' })
        ]));
      }
      page.appendChild(strip);
    })();
    // ---- BANK ↔ LEDGER RECONCILIATION (permanent audit card, P1-②) ----------
    (function () {
      if (!EPAL.ledger) return;
      var scope = selCo === 'all' ? {} : { companyId: selCo };
      var gl = EPAL.ledger.balance('1000', scope) + EPAL.ledger.balance('1010', scope);
      var delta = gl - total;
      var ok = Math.abs(delta) < 1;
      var bf = S.get('exp_gl_backfill_v1', null), op = S.get('bank_gl_open_v1', null);
      page.appendChild(el('div.card.mb-2', null, [
        el('div.card-head', null, [el('h3', { html: ui.icon('shield-check') + ' Bank ↔ Ledger Reconciliation' }),
          el('span.badge' + (ok ? '.badge-good' : '.badge-warn'), { style: { marginLeft: 'auto' }, text: ok ? 'RECONCILED' : 'FLOAT ' + ui.money(Math.abs(delta)) })]),
        el('div.card-body', null, [
          el('div.stat-row', null, [
            el('div.stat', null, [el('div.stat-label', { text: 'Ledger cash + bank (1000 + 1010)' }), el('div.stat-value.num', { text: ui.money(gl) })]),
            el('div.stat', null, [el('div.stat-label', { text: 'Bank register total' }), el('div.stat-value.num', { text: ui.money(total) })]),
            el('div.stat', null, [el('div.stat-label', { text: 'Unassigned cash float' }), el('div.stat-value.num' + (ok ? '' : '.text-warn'), { text: ui.money(delta) })])
          ]),
          el('p.text-mute.xs.mt-2', { text: 'Float = business cash in the books not yet held on any bank record (e.g. undeposited collections). Bank openings and the expense backfill are explicit journals (GL-OPBK-* · GL-MX-*)' + (op ? ' — ' + op.banks + ' bank openings ' + ui.money(op.amount) : '') + (bf ? ' · backfilled ' + bf.entries + ' expenses ' + ui.money(bf.amount) : '') + '.' })
        ])
      ]));
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
    // built here; appended AFTER the transactions card (owner order:
    // Recent Transactions first · All Banks in the middle · Transfers last)
    var allBanksCard = el('div.card.mb-2', null, [
      el('div.card-head', null, [el('h3', { html: ui.icon('bank') + ' All Banks — ' + coName(selCo) })]),
      el('div.card-body', null, [tbl.el])
    ]);

    // ---- 3) RECENT BANK TRANSACTIONS — shown FIRST (owner order) -------------
    (function () {
      var scopeIds = {}; banks.forEach(function (b) { scopeIds[b.id] = b; });
      var txns = S.list('bank_txns').filter(function (t) { return !!scopeIds[t.bankId]; });

      // Money direction. One helper so every column, sort and running total
      // agrees on what "in" means — this is the only place that decides it.
      function isIn(t) { return t.type === 'deposit' || t.type === 'transfer-in'; }
      function delta(t) { return isIn(t) ? (+t.amount || 0) : -(+t.amount || 0); }

      // Newest-first ordering (ties broken by insertion order, newest first).
      function newestFirst(a, b) { return (a.date === b.date) ? b._seq - a._seq : (a.date < b.date ? 1 : -1); }
      txns.forEach(function (t, i) { t._seq = i; });

      /* TWO running balances, deliberately, because they answer two different
         questions (owner 2026-07-15):

         1) _before / _after — THIS BANK's own opening and closing around the
            txn. Derived by walking each bank BACKWARD from its live balance:
            the newest txn's closing IS the bank's current balance, so every
            earlier one follows by subtracting the delta. Shown small under the
            bank name.

         2) _overall — the GROUP's balance across every bank in the current
            scope, after this txn. NOT the bank's closing balance. Same backward
            method, but from the scope total: with "All Companies" selected this
            is every company's money combined, so the column answers "what did
            the group hold at that moment", which no per-bank figure can.

         Both are derived, never stored — the bank register stays the single
         source of truth and these can't drift from it. ⇢ Laravel: compute in
         the query layer (window function over date, id) rather than persisting. */
      var byBank = {};
      txns.forEach(function (t) { (byBank[t.bankId] = byBank[t.bankId] || []).push(t); });
      Object.keys(byBank).forEach(function (bid) {
        var bal = +(scopeIds[bid].balance) || 0;
        byBank[bid].slice().sort(newestFirst).forEach(function (t) {
          t._after = bal; t._before = bal - delta(t); bal = t._before;
        });
      });
      var scopeTotal = banks.reduce(function (a, b) { return a + (+b.balance || 0); }, 0);
      txns.slice().sort(newestFirst).forEach(function (t) {
        t._overall = scopeTotal; scopeTotal -= delta(t);
      });

      var recent = txns.slice().sort(newestFirst).slice(0, 50);
      // Dr/Cr presentation for a derived balance: negative = credit (overdrawn).
      function drcr(v) {
        v = +v || 0;
        return '<span class="num nowrap' + (v < 0 ? ' text-bad' : '') + '">' + ui.money(Math.abs(v)) + ' ' + (v < 0 ? 'Cr' : 'Dr') + '</span>';
      }
      var tt2 = EPAL.table({
        columns: [
          { key: 'date', label: 'Date', date: true },
          // Bank identity + this account's own opening/closing around the txn.
          { key: 'bankName', label: 'Bank', render: function (t) {
            var b = scopeIds[t.bankId] || {};
            return '<span class="strong">' + esc(t.bankName) + '</span>' +
              '<div class="text-mute xs">' + esc(b.account || '') + '</div>' +
              '<div class="text-mute xs nowrap">Opening: ' + ui.money(Math.abs(+t._before || 0)) + ((+t._before || 0) < 0 ? ' Cr' : ' Dr') +
              ' · Closing: ' + ui.money(Math.abs(+t._after || 0)) + ((+t._after || 0) < 0 ? ' Cr' : ' Dr') + '</div>';
          } },
          // Reference / purpose and the free note are SEPARATE fields on the
          // record (bankTxnApply stores ref + desc), so they get their own
          // columns rather than being crushed into one "Description".
          { key: 'ref', label: 'Reference / Purpose', render: function (t) {
            return t.ref ? '<span class="mono">' + esc(t.ref) + '</span>' : '<span class="text-mute">—</span>'; } },
          { key: 'desc', label: 'Description / Note', render: function (t) {
            return esc(t.desc || t.type || '') || '<span class="text-mute">—</span>'; } },
          // Whose account this is — promoted out of the bank sub-line into its
          // own sortable/filterable column (the point of the All-Companies view).
          { key: 'company', label: 'Company', render: function (t) {
            var b = scopeIds[t.bankId] || {};
            return '<span class="badge">' + esc(coName(b.companyId || 'group')) + '</span>'; },
            sortVal: function (t) { var b = scopeIds[t.bankId] || {}; return coName(b.companyId || 'group'); },
            exportVal: function (t) { var b = scopeIds[t.bankId] || {}; return coName(b.companyId || 'group'); } },
          { key: 'in', label: 'Debit', num: true, render: function (t) { return isIn(t) ? '<span class="num text-good">' + ui.money(t.amount) + '</span>' : '—'; }, sortVal: function (t) { return isIn(t) ? +t.amount : 0; }, exportVal: function (t) { return isIn(t) ? t.amount : ''; } },
          { key: 'out', label: 'Credit', num: true, render: function (t) { return !isIn(t) ? '<span class="num text-bad">' + ui.money(t.amount) + '</span>' : '—'; }, sortVal: function (t) { return !isIn(t) ? +t.amount : 0; }, exportVal: function (t) { return !isIn(t) ? t.amount : ''; } },
          { key: 'overall', label: 'Overall Balance', num: true, render: function (t) { return drcr(t._overall); },
            sortVal: function (t) { return +t._overall || 0; }, exportVal: function (t) { return t._overall; } }
        ],
        rows: recent, pageSize: 10, exportName: 'bank-transactions.csv',
        searchKeys: ['bankName', 'desc', 'ref'],
        actions: canCreate() ? [{ icon: 'arrow-counterclockwise', title: 'Reverse this transaction', onClick: function (t) { reverseTxn(t); } }] : [],
        empty: { icon: 'clock-history', title: 'No bank transactions yet', hint: 'Deposits, withdrawals and transfers appear here.' }
      });
      page.appendChild(el('div.card.mb-2', null, [
        el('div.card-head', null, [el('h3', { html: ui.icon('clock-history') + ' Recent Bank Transactions' }),
          el('span.card-sub', { text: (selCo === 'all' ? 'all companies' : coName(selCo)) + ' — newest first · Overall Balance = every bank in scope combined' })]),
        el('div.card-body', null, [tt2.el])
      ]));
    })();
    page.appendChild(allBanksCard);                       // All Banks — middle

    // ---- 4) BANK TRANSFERS — last ---------------------------------------------
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
