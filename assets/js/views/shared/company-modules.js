/* ============================================================================
 * EPAL GROUP ERP  ·  views/shared/company-modules.js
 * ----------------------------------------------------------------------------
 * SHARED COMPANY MODULES — one file, ~40 live module routes.
 *
 * Every sister concern needs HRM, Accounts, Ledgers, Reports, Analytics,
 * Customers, CRM and Settings. Rather than five copies of each, these are
 * registered once under wildcard keys ("star-slash-module") and scope
 * themselves to ctx.companyId at render time. A company can still override
 * any of them later by registering a specific view (router prefers specific).
 *
 * Data sources (see core/seed-bd.js for shapes):
 *   acc_entries    company journal (Income / Expense)
 *   acc_schedules  payable / receivable schedules
 *   sales          the group-wide sales ledger (postSale + seed)
 *   customers      shared cross-company customer graph
 *   leads          CRM leads (companyId scoped)
 *   crm_activities CRM touchpoints
 * ==========================================================================*/

(function (EPAL) {
  'use strict';
  var ui = EPAL.ui, el = ui.el;
  var db = function () { return EPAL.db; };

  /* ---- tiny shared helpers ------------------------------------------------*/
  function kpi(label, value, icon, drill, foot) {
    return el('div.kpi-card' + (drill ? '.drill' : ''), drill ? { onclick: function () { EPAL.router.navigate(drill); } } : null, [
      el('div.kpi-top', null, [ el('span.kpi-label', { text: label }),
        el('span.kpi-ico', { html: '<i class="bi bi-' + icon + '"></i>' }) ]),
      el('div.kpi-value', { text: String(value) }),
      foot ? el('div.kpi-foot', null, [ el('span.text-muted', { text: foot }) ]) : null
    ]);
  }
  function head(ctx, title, icon, sub, actions) {
    return EPAL.pageHead({ eyebrow: ctx.company.name, icon: icon, title: title, sub: sub, actions: actions });
  }
  function chartCard(title, icon, canvasId, subLabel, height) {
    return el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon(icon) + ' ' + title }),
        subLabel ? el('span.card-sub', { text: subLabel }) : null ]),
      el('div.card-body', null, [ el('div', { style: { height: (height || 260) + 'px', position: 'relative' } }, [ el('canvas', { id: canvasId }) ]) ])
    ]);
  }
  // simple least-squares linear regression → forecast the next `n` points
  function forecast(series, n) {
    var pts = series.map(function (y, i) { return [i, y]; }).filter(function (p) { return p[1] > 0; });
    if (pts.length < 3) return [];
    var N = pts.length, sx = 0, sy = 0, sxy = 0, sxx = 0;
    pts.forEach(function (p) { sx += p[0]; sy += p[1]; sxy += p[0] * p[1]; sxx += p[0] * p[0]; });
    var slope = (N * sxy - sx * sy) / (N * sxx - sx * sx || 1);
    var intercept = (sy - slope * sx) / N;
    var out = [];
    for (var i = series.length; i < series.length + n; i++) out.push(Math.max(0, Math.round(slope * i + intercept)));
    return out;
  }
  EPAL.forecast = forecast;   // reused by group analytics

  /* ==========================================================================
   * HRM  (company-scoped team management)
   * ========================================================================*/
  EPAL.view('*/hrm', { render: function (ctx) {
    var cid = ctx.companyId;
    var page = el('div.page');
    var team = db().employees({ companyId: cid });
    var payroll = team.reduce(function (a, e) { return a + (e.salary || 0); }, 0);
    var present = team.reduce(function (a, e) { return a + ((e.attendance || {}).present || 0); }, 0);
    var absent = team.reduce(function (a, e) { return a + ((e.attendance || {}).absent || 0); }, 0);

    page.appendChild(head(ctx, 'HRM — ' + ctx.company.short + ' Team', 'people-fill',
      'Attendance, payroll and performance for this concern. Full lifecycle lives in Group ▸ Workforce.',
      EPAL.auth.isAdmin() ? [ el('a.btn.btn-ghost', { href: '#/group/employees/directory', html: ui.icon('person-badge') + ' Group Workforce' }) ] : null));

    page.appendChild(el('div.kpi-grid', null, [
      kpi('Team Size', team.length, 'people'),
      kpi('Attendance Rate', team.length ? Math.round(present / (present + absent || 1) * 100) + '%' : '—', 'check2-circle'),
      kpi('Monthly Payroll', ui.money(payroll, { compact: true }), 'cash-stack'),
      kpi('Avg Rating', team.length ? (team.reduce(function (a, e) { return a + (e.rating || 0); }, 0) / team.length).toFixed(1) : '—', 'star-fill')
    ]));

    var table = EPAL.table({
      columns: [
        { key: 'name', label: 'Employee', render: function (e) {
          return '<div class="flex items-center gap-1"><span class="avatar" style="background:' + ui.colorFor(e.name) + ';width:26px;height:26px;font-size:10px">' + ui.initials(e.name) + '</span><span class="strong">' + ui.escapeHtml(e.name) + '</span></div>'; } },
        { key: 'designation', label: 'Designation' },
        { key: 'dept', label: 'Department' },
        { key: 'salary', label: 'Salary', num: true, money: true },
        { key: 'rating', label: 'Rating', num: true },
        { key: 'status', label: 'Status', badge: { active: 'good', 'on-leave': 'warn' } }
      ],
      rows: function () { return db().employees({ companyId: cid }); },
      filters: [{ key: 'dept', label: 'Dept' }, { key: 'status', label: 'Status' }],
      searchKeys: ['name', 'designation', 'dept', 'email'],
      exportName: cid + '-team.csv',
      onRow: EPAL.auth.isAdmin() ? function (e) { EPAL.router.navigate('group/employees/directory'); } : null,
      empty: { icon: 'people', title: 'No team members yet' }
    });
    page.appendChild(el('div.card', null, [ el('div.card-pad', null, [ table.el ]) ]));
    ctx.mount.appendChild(page);
  } });

  /* ==========================================================================
   * ACCOUNTS  (journal entries + payment schedules)
   * ========================================================================*/
  EPAL.view('*/accounts', { render: function (ctx) {
    var cid = ctx.companyId;
    var sub = ctx.subId || 'all';
    var page = el('div.page');

    function entries() { return db().col('acc_entries').filter(function (e) { return e.companyId === cid; }); }
    function schedules() { return db().col('acc_schedules').filter(function (s) { return s.companyId === cid; }); }

    var inc = 0, exp = 0;
    entries().forEach(function (e) { if (e.kind === 'Income') inc += e.amount; else exp += e.amount; });
    var pendingSch = schedules().filter(function (s) { return s.status !== 'Paid'; });

    page.appendChild(head(ctx, 'Accounts', 'cash-stack',
      'Income, expenses, journals and payment schedules for ' + ctx.company.short + '.', [
      el('button.btn.btn-primary', { html: ui.icon('plus-lg') + ' New Entry', onclick: function () { newEntry(); } })
    ]));

    // sub-route pills
    var pills = el('div.pill-tab.mb-3');
    [['all', 'All'], ['income', 'Income'], ['expenses', 'Expenses'], ['journals', 'Journals'], ['schedules', 'Schedules']].forEach(function (p) {
      pills.appendChild(el('button' + (sub === p[0] ? '.active' : ''), { text: p[1],
        onclick: function () { EPAL.router.navigate(cid + '/accounts' + (p[0] === 'all' ? '' : '/' + p[0])); } }));
    });
    page.appendChild(el('div', null, [pills]));

    page.appendChild(el('div.kpi-grid', null, [
      kpi('Income (journal)', ui.money(inc, { compact: true }), 'arrow-down-left-circle'),
      kpi('Expenses (journal)', ui.money(exp, { compact: true }), 'arrow-up-right-circle'),
      kpi('Net', ui.money(inc - exp, { compact: true }), 'cash-coin'),
      kpi('Open Schedules', pendingSch.length, 'calendar2-week', cid + '/accounts/schedules',
        ui.money(pendingSch.reduce(function (a, s) { return a + s.amount; }, 0), { compact: true }) + ' outstanding')
    ]));

    if (sub === 'schedules') {
      var schTable = EPAL.table({
        columns: [
          { key: 'id', label: 'Ref' },
          { key: 'party', label: 'Party', render: function (s) { return '<span class="strong">' + ui.escapeHtml(s.party) + '</span>'; } },
          { key: 'kind', label: 'Type', badge: { Payable: 'bad', Receivable: 'good' } },
          { key: 'amount', label: 'Amount', num: true, money: true },
          { key: 'due', label: 'Due', date: true },
          { key: 'status', label: 'Status', badge: { Paid: 'good', Partial: 'warn', Pending: 'bad' } }
        ],
        rows: schedules, filters: [{ key: 'kind', label: 'Type' }, { key: 'status', label: 'Status' }],
        exportName: cid + '-schedules.csv',
        actions: [{ icon: 'check2-circle', title: 'Mark paid', onClick: function (s) {
          s.status = 'Paid'; db().save('acc_schedules', s); schTable.refresh(); ui.toast('Marked paid', 'success'); } }],
        empty: { icon: 'calendar2-week', title: 'No schedules' }
      });
      page.appendChild(el('div.card', null, [ el('div.card-pad', null, [ schTable.el ]) ]));
    } else if (sub === 'journals') {
      renderJournal();
    } else {
      var kindFilter = sub === 'income' ? 'Income' : sub === 'expenses' ? 'Expense' : null;
      var enTable = EPAL.table({
        columns: [
          { key: 'id', label: 'JV' },
          { key: 'date', label: 'Date', date: true },
          { key: 'kind', label: 'Kind', badge: { Income: 'good', Expense: 'bad' } },
          { key: 'category', label: 'Category' },
          { key: 'desc', label: 'Description' },
          { key: 'method', label: 'Method' },
          { key: 'amount', label: 'Amount', num: true, money: true }
        ],
        rows: function () { return kindFilter ? entries().filter(function (e) { return e.kind === kindFilter; }) : entries(); },
        filters: [{ key: 'category', label: 'Category' }, { key: 'method', label: 'Method' }],
        searchKeys: ['id', 'category', 'desc'],
        exportName: cid + '-journal.csv',
        actions: [
          { icon: 'pencil', title: 'Edit', onClick: function (e) { newEntry(e); } },
          { icon: 'trash', title: 'Delete', onClick: function (e) {
            ui.confirm({ title: 'Delete entry ' + e.id + '?', danger: true, confirmLabel: 'Delete' }).then(function (ok) {
              if (ok) { db().remove('acc_entries', e.id); EPAL.router.render(); } }); } }
        ],
        empty: { icon: 'journal', title: 'No entries yet' }
      });
      page.appendChild(el('div.card', null, [ el('div.card-pad', null, [ enTable.el ]) ]));

      // income vs expense trend
      page.appendChild(el('div.section-label', { text: 'Cash Movement — monthly' }));
      var cId = ui.uid('acc');
      page.appendChild(chartCard('Income vs Expense', 'activity', cId, 'journal entries', 240));
      requestAnimationFrame(function () {
        var months = lastYm(8);
        var incS = months.map(function (ym) { return sumMonth(entries(), ym, 'Income'); });
        var expS = months.map(function (ym) { return sumMonth(entries(), ym, 'Expense'); });
        var c = document.getElementById(cId);
        if (c) EPAL.charts.bar(c, { labels: months.map(mLabel), legend: true,
          datasets: [{ label: 'Income', data: incS, color: '#23c17e' }, { label: 'Expense', data: expS, color: '#f0506e' }] });
      });
    }

    ctx.mount.appendChild(page);

    function newEntry(rec) {
      EPAL.formModal({
        title: rec ? 'Edit Entry' : 'New Journal Entry', icon: 'journal-plus',
        record: rec, fields: [
          { key: 'kind', label: 'Kind', type: 'select', options: ['Income', 'Expense'], required: true },
          { key: 'amount', label: 'Amount (৳)', type: 'money', required: true, min: 1 },
          { key: 'category', label: 'Category', type: 'text', required: true, placeholder: 'e.g. Office Rent' },
          { key: 'method', label: 'Method', type: 'select', options: ['Bank', 'Cash', 'bKash', 'Cheque'], required: true },
          { key: 'date', label: 'Date', type: 'date', required: true, default: new Date().toISOString().slice(0, 10) },
          { key: 'desc', label: 'Description', type: 'text', col2: true }
        ],
        onSave: function (vals) {
          var record = Object.assign({}, rec || { id: 'JV-' + Date.now().toString().slice(-6), companyId: cid, created: new Date().toISOString().slice(0, 10) }, vals);
          db().save('acc_entries', record);
          mirrorToLedger(record);   // quick entry -> balanced double-entry in the real ledger
          ui.toast('Entry saved & posted to the ledger', 'success');
          EPAL.router.render();
        }
      });
    }

    /* --- mirror a single-entry quick posting into the double-entry ledger --
     * Income  -> DR 1010 Bank      / CR 4000 Sales Revenue
     * Expense -> DR 5xxx (by head) / CR 1010 Bank
     * Uses a deterministic GL id so editing the quick entry re-posts (upsert)
     * rather than duplicating the ledger entry. -----------------------------*/
    function mirrorToLedger(record) {
      if (!EPAL.ledger || !EPAL.ledger.post) return;
      var amt = +record.amount || 0;
      if (amt <= 0) return;
      var lines;
      if (record.kind === 'Income') {
        lines = [ { account: '1010', dr: amt, cr: 0 }, { account: '4000', dr: 0, cr: amt } ];
      } else {
        lines = [ { account: expenseAccountFor(record.category), dr: amt, cr: 0 }, { account: '1010', dr: 0, cr: amt } ];
      }
      try {
        EPAL.ledger.post({ id: 'GL-ACC-' + record.id, date: record.date, companyId: cid,
          ref: record.id, memo: record.desc || record.category || (record.kind + ' entry'),
          source: 'manual', party: '', lines: lines });
      } catch (e) { /* mirror is best-effort — never block the quick entry */ }
    }
    function expenseAccountFor(cat) {
      var c = String(cat || '').toLowerCase();
      if (/rent|lease/.test(c)) return '5200';
      if (/salary|payroll|wage|staff/.test(c)) return '5100';
      if (/utility|electric|internet|wifi|gas|water|bill/.test(c)) return '5300';
      if (/market|ad\b|promo|campaign/.test(c)) return '5400';
      if (/bank|charge|fee/.test(c)) return '6000';
      if (/adm|penalt|fine/.test(c)) return '5900';
      return '5300';
    }

    /* --- JOURNAL sub: post a balanced double-entry journal via EPAL.ledger --*/
    function renderJournal() {
      var accts = (EPAL.ledger && EPAL.ledger.accounts) ? EPAL.ledger.accounts() : [];
      var acctOpts = accts.map(function (a) { return [a.code, a.code + ' · ' + a.name]; });

      var balStrip = el('div.flex.gap-2.items-center');
      var postBtn = el('button.btn.btn-primary', { disabled: true, html: ui.icon('journal-plus') + ' Post Journal' });

      function tally(rows) {
        var dr = 0, cr = 0;
        (rows || []).forEach(function (r) { dr += +r.debit || 0; cr += +r.credit || 0; });
        return { dr: dr, cr: cr, diff: dr - cr };
      }
      function refreshBalance(rows) {
        var t = tally(rows);
        var ok = t.dr > 0.5 && Math.abs(t.diff) < 0.5;
        postBtn.disabled = !ok;
        balStrip.innerHTML = '';
        balStrip.appendChild(el('span.badge', { html: 'Dr ' + ui.money(t.dr) }));
        balStrip.appendChild(el('span.badge', { html: 'Cr ' + ui.money(t.cr) }));
        balStrip.appendChild(el('span.badge', { style: { color: ok ? '#23c17e' : '#f0506e' },
          html: ok ? (ui.icon('check-circle-fill') + ' Balanced') : ('Δ ' + ui.money(Math.abs(t.diff))) }));
      }

      var form = EPAL.form([
        { key: 'date', label: 'Date', type: 'date', required: true, default: new Date().toISOString().slice(0, 10) },
        { key: 'ref', label: 'Reference', type: 'text', placeholder: 'e.g. JV/ADJ-001' },
        { key: 'party', label: 'Party (optional)', type: 'text', placeholder: 'Customer / vendor name' },
        { key: 'memo', label: 'Narration', type: 'text', col2: true, placeholder: 'What is this entry for?' },
        { key: 'lines', type: 'items', label: 'Journal Lines', required: true, min: 2, addLabel: 'Add line',
          columns: [
            { key: 'account', label: 'Account', type: 'select', width: '2.4fr', options: acctOpts },
            { key: 'debit', label: 'Debit', type: 'money', width: '1fr' },
            { key: 'credit', label: 'Credit', type: 'money', width: '1fr' }
          ],
          footer: function (rows) { var t = tally(rows);
            return 'Dr ' + ui.money(t.dr) + '  ·  Cr ' + ui.money(t.cr) + (t.dr > 0.5 && Math.abs(t.diff) < 0.5 ? '  ✓' : '  Δ ' + ui.money(Math.abs(t.diff))); },
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
          EPAL.ledger.post({ date: v.date, companyId: cid, ref: v.ref || '', memo: v.memo || 'Manual journal',
            source: 'manual', party: v.party || '', lines: lines });
          ui.toast('Journal posted to the ledger', 'success');
          EPAL.router.render();
        } catch (e) { ui.toast(e.message || 'Entry does not balance', 'error'); }
      });

      refreshBalance([]);

      page.appendChild(el('div.card', null, [
        el('div.card-head', null, [ el('h3', { html: ui.icon('journal-plus') + ' New Double-Entry Journal' }),
          el('span.card-sub', { text: 'Debits must equal credits' }) ]),
        el('div.card-body', null, [ form.el,
          el('div.flex.justify-between.items-center.mt-2', null, [ balStrip, postBtn ]) ])
      ]));

      // recent gl_entries for this company (newest first)
      var glRows = (EPAL.ledger && EPAL.ledger.entries) ? EPAL.ledger.entries({ companyId: cid }).slice().reverse() : [];
      function glTotal(e) { var t = 0; (e.lines || []).forEach(function (l) { t += +l.dr || 0; }); return t; }
      var glTable = EPAL.table({
        columns: [
          { key: 'date', label: 'Date', date: true },
          { key: 'id', label: 'JV' },
          { key: 'ref', label: 'Reference' },
          { key: 'memo', label: 'Narration' },
          { key: 'source', label: 'Source', badge: { sale: 'good', manual: 'info', opening: 'accent', payroll: 'warn', refund: 'bad' } },
          { key: 'party', label: 'Party' },
          { key: 'amount', label: 'Amount', num: true, render: function (e) { return '<span class="num">' + ui.money(glTotal(e)) + '</span>'; }, exportVal: function (e) { return glTotal(e); } }
        ],
        rows: glRows, searchKeys: ['id', 'ref', 'memo', 'party', 'source'],
        exportName: cid + '-gl-entries.csv',
        onRow: function (e) { showEntry(e); },
        empty: { icon: 'journal-text', title: 'No ledger entries yet — post one above' }
      });
      page.appendChild(el('div.section-label', { text: 'Recent Ledger Entries' }));
      page.appendChild(el('div.card', null, [ el('div.card-pad', null, [ glTable.el ]) ]));

      function showEntry(e) {
        var lines = (e.lines || []).map(function (l) { var a = EPAL.ledger.account(l.account);
          return { account: l.account + ' · ' + (a ? a.name : ''), debit: +l.dr || 0, credit: +l.cr || 0 }; });
        var lt = EPAL.table({
          columns: [ { key: 'account', label: 'Account' },
            { key: 'debit', label: 'Debit', num: true, money: true },
            { key: 'credit', label: 'Credit', num: true, money: true } ],
          rows: lines, empty: { icon: 'journal', title: 'No lines' }
        });
        ui.modal({ title: 'Journal ' + e.id, icon: 'journal-text', size: 'lg',
          body: el('div', null, [ el('div.text-mute.sm.mb-2', { text: ui.date(e.date) + ' · ' + (e.memo || '') + (e.party ? ' · ' + e.party : '') }), lt.el ]),
          actions: [ { label: 'Close', variant: 'ghost' } ] });
      }
    }
  } });

  function lastYm(n) {
    var out = [], now = new Date();
    for (var i = n - 1; i >= 0; i--) { var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      out.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')); }
    return out;
  }
  function mLabel(ym) { var p = ym.split('-'); return new Date(p[0], p[1] - 1, 1).toLocaleString('en', { month: 'short' }); }
  function sumMonth(list, ym, kind) {
    return list.filter(function (e) { return String(e.date || '').indexOf(ym) === 0 && (!kind || e.kind === kind); })
      .reduce(function (a, e) { return a + (e.amount || 0); }, 0);
  }

  /* ==========================================================================
   * LEDGERS  (general ledger with running balance + trial balance + parties)
   * ========================================================================*/
  EPAL.view('*/ledgers', { render: function (ctx) {
    var cid = ctx.companyId, co = ctx.company, page = el('div.page');
    var L = EPAL.ledger;
    var mode = (ctx.params && ctx.params.tab) || 'general';

    // Statement print — each tab points statementFn at the doc it should print.
    var statementFn = function () {
      if (!L) return;
      var r = L.trialBalance(cid), td = 0, tc = 0;
      r.forEach(function (x) { td += x.debit; tc += x.credit; });
      printTrial(r, td, tc, Math.abs(td - tc) < 1);
    };

    page.appendChild(head(ctx, 'Ledgers', 'journal-text',
      'Real double-entry general ledger, trial balance, party subledgers, ageing and statements for ' + co.short + '.',
      [ el('button.btn.btn-ghost', { html: ui.icon('printer') + ' Statement', onclick: function () { statementFn(); } }) ]));

    if (!L) {
      page.appendChild(el('div.card', null, [ el('div.card-pad', null, [ el('p.text-mute', { text: 'The ledger engine is not available.' }) ]) ]));
      ctx.mount.appendChild(page); return;
    }

    var pills = el('div.pill-tab.mb-3');
    [['general', 'General Ledger'], ['trial', 'Trial Balance'], ['party', 'Party Ledger'],
     ['ar', 'AR Ageing'], ['ap', 'AP Ageing'], ['bs', 'Balance Sheet'], ['pnl', 'P&L']].forEach(function (p) {
      pills.appendChild(el('button' + (mode === p[0] ? '.active' : ''), { text: p[1],
        onclick: function () { EPAL.router.navigate(cid + '/ledgers', { tab: p[0] }); } }));
    });
    page.appendChild(el('div', null, [pills]));

    /* ---- GENERAL LEDGER : account picker -> running balance ---------------*/
    if (mode === 'general') {
      var used = {};
      L.entries({ companyId: cid }).forEach(function (e) { (e.lines || []).forEach(function (l) { used[l.account] = true; }); });
      var gAccts = L.accounts().filter(function (a) { return used[a.code]; });
      if (!gAccts.length) gAccts = L.accounts();
      var gSel = el('select.select', { style: { maxWidth: '340px' } });
      gAccts.forEach(function (a) { gSel.appendChild(el('option', { value: a.code, text: a.code + ' · ' + a.name })); });
      var gBody = el('div.mt-3');
      var gCode = (ctx.params && ctx.params.code) || gAccts[0].code;
      gSel.value = gCode;

      function drawGl(code) {
        gBody.innerHTML = '';
        var acc = L.account(code);
        var rows = L.ledgerFor(code, { companyId: cid });
        var td = 0, tc = 0; rows.forEach(function (r) { td += r.debit; tc += r.credit; });
        var closing = rows.length ? rows[rows.length - 1].balance : 0;
        gBody.appendChild(el('div.kpi-grid', null, [
          kpi('Total Debit', ui.money(td, { compact: true }), 'arrow-up-right-circle'),
          kpi('Total Credit', ui.money(tc, { compact: true }), 'arrow-down-left-circle'),
          kpi('Closing Balance', ui.money(closing, { compact: true }), 'wallet2'),
          kpi('Entries', rows.length, 'list-ol')
        ]));
        var t = EPAL.table({
          columns: [
            { key: 'date', label: 'Date', date: true },
            { key: 'ref', label: 'Reference' },
            { key: 'memo', label: 'Narration' },
            { key: 'party', label: 'Party' },
            { key: 'debit', label: 'Debit', num: true, render: function (r) { return r.debit ? '<span class="num text-bad">' + ui.money(r.debit) + '</span>' : '—'; }, exportVal: function (r) { return r.debit; } },
            { key: 'credit', label: 'Credit', num: true, render: function (r) { return r.credit ? '<span class="num text-good">' + ui.money(r.credit) + '</span>' : '—'; }, exportVal: function (r) { return r.credit; } },
            { key: 'balance', label: 'Balance', num: true, money: true }
          ],
          rows: rows.slice().reverse(), searchKeys: ['ref', 'memo', 'party'],
          exportName: cid + '-' + code + '-ledger.csv',
          empty: { icon: 'journal-text', title: 'No movement on this account' }
        });
        gBody.appendChild(el('div.card', null, [ el('div.card-pad', null, [ t.el ]) ]));
        statementFn = function () { printAccountStatement(acc, rows.slice().reverse(), closing); };
      }
      gSel.addEventListener('change', function () { drawGl(gSel.value); });
      page.appendChild(el('div.card', null, [ el('div.card-pad', null, [
        el('div.section-label', { text: 'Select account' }), gSel ]) ]));
      page.appendChild(gBody);
      drawGl(gCode);

    /* ---- TRIAL BALANCE : real, balanced ----------------------------------*/
    } else if (mode === 'trial') {
      var tbRows = L.trialBalance(cid);
      var Td = 0, Tc = 0; tbRows.forEach(function (r) { Td += r.debit; Tc += r.credit; });
      var balanced = Math.abs(Td - Tc) < 1;
      page.appendChild(el('div.kpi-grid', null, [
        kpi('Total Debit', ui.money(Td, { compact: true }), 'arrow-up-right-circle'),
        kpi('Total Credit', ui.money(Tc, { compact: true }), 'arrow-down-left-circle'),
        el('div.kpi-card', null, [
          el('div.kpi-top', null, [ el('span.kpi-label', { text: 'Balance Check' }), el('span.kpi-ico', { html: ui.icon(balanced ? 'check2-circle' : 'exclamation-triangle') }) ]),
          el('div.mt-1', null, [ el('span.health.' + (balanced ? 'g' : 'r'), { text: balanced ? 'Balanced' : 'Out by ' + ui.money(Math.abs(Td - Tc)) }) ])
        ])
      ]));
      var tbTable = EPAL.table({
        columns: [
          { key: 'code', label: 'Code' },
          { key: 'name', label: 'Account Head', render: function (r) { return '<span class="strong">' + ui.escapeHtml(r.name) + '</span>'; } },
          { key: 'type', label: 'Type', badge: { asset: 'info', liability: 'warn', equity: 'accent', income: 'good', expense: 'bad' } },
          { key: 'debit', label: 'Debit', num: true, money: true },
          { key: 'credit', label: 'Credit', num: true, money: true }
        ],
        rows: tbRows, filters: [{ key: 'type', label: 'Type' }], exportName: cid + '-trial-balance.csv', pageSize: 25,
        empty: { icon: 'journal-check', title: 'No postings yet' }
      });
      page.appendChild(el('div.card', null, [ el('div.card-pad', null, [ tbTable.el ]) ]));
      statementFn = function () { printTrial(tbRows, Td, Tc, balanced); };

    /* ---- PARTY LEDGER : party picker -> running balance -------------------*/
    } else if (mode === 'party') {
      var parties = {};
      L.entries({ companyId: cid }).forEach(function (e) { if (e.party) parties[e.party] = true; });
      var plist = Object.keys(parties).sort();
      var pSel = el('select.select', { style: { maxWidth: '340px' } });
      if (!plist.length) pSel.appendChild(el('option', { value: '', text: 'No parties on the ledger yet' }));
      plist.forEach(function (p) { pSel.appendChild(el('option', { value: p, text: p })); });
      var pBody = el('div.mt-3');

      function drawParty(p) {
        pBody.innerHTML = '';
        if (!p) { pBody.appendChild(el('div.card', null, [ el('div.card-pad', null, [ el('p.text-mute', { text: 'No party movement recorded for this concern yet.' }) ]) ])); statementFn = function () {}; return; }
        var rows = L.partyLedger(p, { companyId: cid });
        var td = 0, tc = 0; rows.forEach(function (r) { td += r.debit; tc += r.credit; });
        var closing = rows.length ? rows[rows.length - 1].balance : 0;
        pBody.appendChild(el('div.kpi-grid', null, [
          kpi('Total Debit', ui.money(td, { compact: true }), 'arrow-up-right-circle'),
          kpi('Total Credit', ui.money(tc, { compact: true }), 'arrow-down-left-circle'),
          kpi(closing >= 0 ? 'Owes Us' : 'We Owe', ui.money(Math.abs(closing), { compact: true }), 'person-lines-fill'),
          kpi('Transactions', rows.length, 'list-ol')
        ]));
        var t = EPAL.table({
          columns: [
            { key: 'date', label: 'Date', date: true },
            { key: 'ref', label: 'Reference' },
            { key: 'memo', label: 'Narration' },
            { key: 'source', label: 'Source', badge: { sale: 'good', manual: 'info', refund: 'bad', payment: 'accent' } },
            { key: 'debit', label: 'Debit', num: true, render: function (r) { return r.debit ? '<span class="num text-bad">' + ui.money(r.debit) + '</span>' : '—'; }, exportVal: function (r) { return r.debit; } },
            { key: 'credit', label: 'Credit', num: true, render: function (r) { return r.credit ? '<span class="num text-good">' + ui.money(r.credit) + '</span>' : '—'; }, exportVal: function (r) { return r.credit; } },
            { key: 'balance', label: 'Balance', num: true, money: true }
          ],
          rows: rows.slice().reverse(), searchKeys: ['ref', 'memo'],
          exportName: cid + '-party-ledger.csv',
          empty: { icon: 'people', title: 'No transactions for this party' }
        });
        pBody.appendChild(el('div.card', null, [ el('div.card-pad', null, [ t.el ]) ]));
        statementFn = function () { printPartyStatement(p, rows.slice().reverse(), closing); };
      }
      pSel.addEventListener('change', function () { drawParty(pSel.value); });
      page.appendChild(el('div.card', null, [ el('div.card-pad', null, [
        el('div.section-label', { text: 'Select party' }), pSel ]) ]));
      page.appendChild(pBody);
      drawParty(plist[0] || '');

    /* ---- AR / AP AGEING --------------------------------------------------*/
    } else if (mode === 'ar' || mode === 'ap') {
      var kind = mode === 'ap' ? 'AP' : 'AR';
      var agRows = L.aging(kind, { companyId: cid });
      var sum = { current: 0, d30: 0, d60: 0, d90: 0, total: 0 };
      agRows.forEach(function (r) { sum.current += r.current; sum.d30 += r.d30; sum.d60 += r.d60; sum.d90 += r.d90; sum.total += r.total; });
      page.appendChild(el('div.kpi-grid', null, [
        kpi('Current', ui.money(sum.current, { compact: true }), 'clock'),
        kpi('1–30 days', ui.money(sum.d30, { compact: true }), 'clock-history'),
        kpi('31–60 days', ui.money(sum.d60, { compact: true }), 'hourglass-split'),
        kpi('60+ days', ui.money(sum.d90, { compact: true }), 'exclamation-octagon'),
        kpi('Total ' + kind, ui.money(sum.total, { compact: true }), kind === 'AR' ? 'arrow-down-left-circle' : 'arrow-up-right-circle')
      ]));
      var agTable = EPAL.table({
        columns: [
          { key: 'party', label: 'Party', render: function (r) { return '<span class="strong">' + ui.escapeHtml(r.party) + '</span>'; } },
          { key: 'current', label: 'Current', num: true, money: true },
          { key: 'd30', label: '1–30', num: true, money: true },
          { key: 'd60', label: '31–60', num: true, money: true },
          { key: 'd90', label: '60+', num: true, render: function (r) { return r.d90 ? '<span class="num text-bad">' + ui.money(r.d90) + '</span>' : '—'; }, exportVal: function (r) { return r.d90; } },
          { key: 'total', label: 'Total', num: true, money: true }
        ],
        rows: agRows, searchKeys: ['party'], exportName: cid + '-' + kind + '-ageing.csv',
        empty: { icon: 'check2-circle', title: 'Nothing outstanding — all settled' }
      });
      page.appendChild(el('div.card', null, [ el('div.card-pad', null, [ agTable.el ]) ]));
      statementFn = function () { printAging(kind, agRows, sum); };

    /* ---- BALANCE SHEET ---------------------------------------------------*/
    } else if (mode === 'bs') {
      var bs = L.balanceSheet(cid);
      page.appendChild(el('div.kpi-grid', null, [
        kpi('Total Assets', ui.money(bs.totals.assets, { compact: true }), 'building'),
        kpi('Total Liabilities', ui.money(bs.totals.liabilities, { compact: true }), 'file-earmark-minus'),
        kpi('Total Equity', ui.money(bs.totals.equity, { compact: true }), 'piggy-bank'),
        el('div.kpi-card', null, [
          el('div.kpi-top', null, [ el('span.kpi-label', { text: 'Balance Check' }), el('span.kpi-ico', { html: ui.icon(bs.totals.balanced ? 'check2-circle' : 'exclamation-triangle') }) ]),
          el('div.mt-1', null, [ el('span.health.' + (bs.totals.balanced ? 'g' : 'r'), { text: bs.totals.balanced ? 'A = L + E' : 'Out of balance' }) ])
        ])
      ]));
      var bsRow = el('div.two-col.mt-3');
      bsRow.appendChild(sectionTable('Assets', 'building', bs.assets, bs.totals.assets));
      var bsRight = el('div');
      bsRight.appendChild(sectionTable('Liabilities', 'file-earmark-minus', bs.liabilities, bs.totals.liabilities));
      bsRight.appendChild(el('div.mt-3', null, [ sectionTable('Equity', 'piggy-bank', bs.equity, bs.totals.equity) ]));
      bsRow.appendChild(bsRight);
      page.appendChild(bsRow);
      statementFn = function () { printBalanceSheet(bs); };

    /* ---- PROFIT & LOSS ---------------------------------------------------*/
    } else if (mode === 'pnl') {
      var pl = L.pnl(cid);
      page.appendChild(el('div.kpi-grid', null, [
        kpi('Revenue', ui.money(pl.revenue, { compact: true }), 'cash-coin'),
        kpi('Gross Profit', ui.money(pl.gross, { compact: true }), 'graph-up'),
        kpi('Expenses', ui.money(pl.expenses, { compact: true }), 'wallet2'),
        kpi('Net Profit', ui.money(pl.net, { compact: true }), pl.net >= 0 ? 'trophy' : 'exclamation-triangle')
      ]));
      var summ = el('div.card', null, [
        el('div.card-head', null, [ el('h3', { html: ui.icon('graph-up-arrow') + ' Income Statement' }), el('span.card-sub', { text: 'Real ledger P&L' }) ]),
        el('div.card-body', null, [
          pnlLine('Revenue', pl.revenue, false),
          pnlLine('Cost of Sales', -pl.cogs, false),
          pnlLine('Gross Profit', pl.gross, true),
          pnlLine('Operating Expenses', -pl.expenses, false),
          pnlLine('Net Profit', pl.net, true)
        ])
      ]);
      page.appendChild(summ);
      var plTable = EPAL.table({
        columns: [
          { key: 'code', label: 'Code' },
          { key: 'name', label: 'Account', render: function (r) { return '<span class="strong">' + ui.escapeHtml(r.name) + '</span>'; } },
          { key: 'amount', label: 'Amount', num: true, money: true }
        ],
        rows: pl.lines, exportName: cid + '-pnl.csv',
        empty: { icon: 'graph-up', title: 'No income or expense postings yet' }
      });
      page.appendChild(el('div.section-label', { text: 'Detail by Account' }));
      page.appendChild(el('div.card', null, [ el('div.card-pad', null, [ plTable.el ]) ]));
      statementFn = function () { printPnl(pl); };
    }

    ctx.mount.appendChild(page);

    /* ---- shared builders -------------------------------------------------*/
    function sectionTable(title, icon, items, total) {
      var t = EPAL.table({
        columns: [
          { key: 'code', label: 'Code' },
          { key: 'name', label: 'Account', render: function (r) { return '<span class="strong">' + ui.escapeHtml(r.name) + '</span>'; } },
          { key: 'amount', label: 'Amount', num: true, money: true }
        ],
        rows: items, exportName: cid + '-' + title.toLowerCase() + '.csv',
        empty: { icon: 'dash-circle', title: 'None' }
      });
      return el('div.card', null, [
        el('div.card-head', null, [ el('h3', { html: ui.icon(icon) + ' ' + title }), el('span.card-sub', { text: ui.money(total) }) ]),
        el('div.card-pad', null, [ t.el ])
      ]);
    }
    function pnlLine(label, val, strong) {
      return el('div.flex.justify-between.items-center' + (strong ? '.strong' : ''),
        { style: { padding: '9px 4px', borderBottom: '1px solid rgba(150,150,170,.14)' } },
        [ el('span', { text: label }), el('span.num', { style: strong && val < 0 ? { color: '#f0506e' } : null, text: ui.money(val) }) ]);
    }

    /* ---- branded statements via EPAL.doc.open ----------------------------*/
    function today() { return new Date().toISOString().slice(0, 10); }
    function docReady() { if (!EPAL.doc || !EPAL.doc.open) { ui.toast('Document engine unavailable', 'error'); return false; } return true; }

    function printTrial(rows, td, tc, balanced) {
      if (!docReady()) return;
      EPAL.doc.open({
        type: 'document', title: 'Trial Balance', badge: balanced ? 'Balanced' : 'Unbalanced',
        date: today(), companyId: cid,
        parties: [ { label: 'Entity', name: co.name, lines: [ 'Trial Balance as at ' + ui.date(today()) ] },
          { label: 'Prepared By', name: 'Group Finance', lines: [ 'Epal Group', 'Dhaka, Bangladesh' ] } ],
        meta: [ { label: 'Total Debit', value: ui.money(td) }, { label: 'Total Credit', value: ui.money(tc) },
          { label: 'Status', value: balanced ? 'Balanced' : 'Out by ' + ui.money(Math.abs(td - tc)) } ],
        columns: [ { key: 'code', label: 'Code' }, { key: 'name', label: 'Account' },
          { key: 'debit', label: 'Debit', num: true, money: true }, { key: 'credit', label: 'Credit', num: true, money: true } ],
        rows: rows,
        totals: [ { label: 'Total Debit', value: td }, { label: 'Total Credit', value: tc, grand: true } ],
        terms: 'Generated by Epal Group ERP · Confidential — for internal documentation.', sign: 'Group Finance'
      });
    }
    function printAccountStatement(acc, rows, closing) {
      if (!docReady()) return;
      EPAL.doc.open({
        type: 'document', title: (acc ? acc.name : 'Account') + ' — Account Statement', badge: acc ? acc.code : '',
        date: today(), companyId: cid,
        parties: [ { label: 'Account', name: (acc ? acc.code + ' · ' + acc.name : ''), lines: [ 'General Ledger' ] },
          { label: 'Entity', name: co.name, lines: [ 'Dhaka, Bangladesh' ] } ],
        meta: [ { label: 'Account Type', value: acc ? acc.type : '' }, { label: 'Closing Balance', value: ui.money(closing) } ],
        columns: [ { key: 'date', label: 'Date' }, { key: 'ref', label: 'Reference' }, { key: 'memo', label: 'Narration' },
          { key: 'debit', label: 'Debit', num: true, money: true }, { key: 'credit', label: 'Credit', num: true, money: true },
          { key: 'balance', label: 'Balance', num: true, money: true } ],
        rows: rows,
        totals: [ { label: 'Closing Balance', value: closing, grand: true } ],
        sign: 'Group Finance'
      });
    }
    function printPartyStatement(party, rows, closing) {
      if (!docReady()) return;
      EPAL.doc.open({
        type: 'invoice', title: 'Statement of Account', badge: closing >= 0 ? 'Receivable' : 'Payable',
        date: today(), companyId: cid, amount: Math.abs(closing), party: party,
        parties: [ { label: 'Statement For', name: party, lines: [ 'As at ' + ui.date(today()) ] },
          { label: 'Issued By', name: co.name, lines: [ 'Accounts Department', 'Dhaka, Bangladesh' ] } ],
        meta: [ { label: 'Statement Date', value: ui.date(today()) },
          { label: closing >= 0 ? 'Balance Receivable' : 'Balance Payable', value: ui.money(Math.abs(closing)) } ],
        columns: [ { key: 'date', label: 'Date' }, { key: 'ref', label: 'Reference' }, { key: 'memo', label: 'Narration' },
          { key: 'debit', label: 'Debit', num: true, money: true }, { key: 'credit', label: 'Credit', num: true, money: true },
          { key: 'balance', label: 'Balance', num: true, money: true } ],
        rows: rows,
        totals: [ { label: closing >= 0 ? 'Total Receivable' : 'Total Payable', value: Math.abs(closing), grand: true } ],
        words: EPAL.doc.amountInWords ? EPAL.doc.amountInWords(Math.round(Math.abs(closing))) : '',
        terms: 'Please reconcile against your records and settle any outstanding balance at your earliest convenience. E&OE.',
        sign: 'Accounts Department'
      });
    }
    function printAging(kind, rows, sum) {
      if (!docReady()) return;
      EPAL.doc.open({
        type: 'document', title: (kind === 'AP' ? 'Accounts Payable' : 'Accounts Receivable') + ' Ageing', badge: kind,
        date: today(), companyId: cid,
        parties: [ { label: 'Entity', name: co.name, lines: [ 'Ageing as at ' + ui.date(today()) ] },
          { label: 'Prepared By', name: 'Group Credit Control', lines: [ 'Epal Group' ] } ],
        meta: [ { label: 'Current', value: ui.money(sum.current) }, { label: '31–60 days', value: ui.money(sum.d60) },
          { label: '60+ days', value: ui.money(sum.d90) }, { label: 'Total ' + kind, value: ui.money(sum.total) } ],
        columns: [ { key: 'party', label: 'Party' }, { key: 'current', label: 'Current', num: true, money: true },
          { key: 'd30', label: '1–30', num: true, money: true }, { key: 'd60', label: '31–60', num: true, money: true },
          { key: 'd90', label: '60+', num: true, money: true }, { key: 'total', label: 'Total', num: true, money: true } ],
        rows: rows,
        totals: [ { label: 'Total ' + kind + ' Outstanding', value: sum.total, grand: true } ],
        terms: 'Ageing computed FIFO from open ledger invoices. E&OE.', sign: 'Group Credit Control'
      });
    }
    function printBalanceSheet(bs) {
      if (!docReady()) return;
      var rows = [];
      bs.assets.forEach(function (a) { rows.push({ section: 'Assets', name: a.code + ' · ' + a.name, amount: a.amount }); });
      bs.liabilities.forEach(function (a) { rows.push({ section: 'Liabilities', name: a.code + ' · ' + a.name, amount: a.amount }); });
      bs.equity.forEach(function (a) { rows.push({ section: 'Equity', name: a.code + ' · ' + a.name, amount: a.amount }); });
      EPAL.doc.open({
        type: 'document', title: 'Balance Sheet', badge: bs.totals.balanced ? 'Balanced' : 'Unbalanced',
        date: today(), companyId: cid,
        parties: [ { label: 'Entity', name: co.name, lines: [ 'As at ' + ui.date(today()) ] },
          { label: 'Prepared By', name: 'Group Finance', lines: [ 'Epal Group' ] } ],
        meta: [ { label: 'Total Assets', value: ui.money(bs.totals.assets) },
          { label: 'Total Liabilities', value: ui.money(bs.totals.liabilities) },
          { label: 'Total Equity', value: ui.money(bs.totals.equity) } ],
        columns: [ { key: 'section', label: 'Section' }, { key: 'name', label: 'Account' }, { key: 'amount', label: 'Amount', num: true, money: true } ],
        rows: rows,
        totals: [ { label: 'Total Assets', value: bs.totals.assets },
          { label: 'Liabilities + Equity', value: bs.totals.liabilities + bs.totals.equity, grand: true } ],
        terms: 'Prepared on the double-entry ledger. Current-year earnings folded into equity. E&OE.', sign: 'Group Finance'
      });
    }
    function printPnl(pl) {
      if (!docReady()) return;
      EPAL.doc.open({
        type: 'document', title: 'Profit & Loss Statement', badge: pl.net >= 0 ? 'Profit' : 'Loss',
        date: today(), companyId: cid,
        parties: [ { label: 'Entity', name: co.name, lines: [ 'Income Statement to ' + ui.date(today()) ] },
          { label: 'Prepared By', name: 'Group Finance', lines: [ 'Epal Group' ] } ],
        meta: [ { label: 'Revenue', value: ui.money(pl.revenue) }, { label: 'Gross Profit', value: ui.money(pl.gross) },
          { label: 'Net Profit', value: ui.money(pl.net) } ],
        columns: [ { key: 'code', label: 'Code' }, { key: 'name', label: 'Account' }, { key: 'amount', label: 'Amount', num: true, money: true } ],
        rows: pl.lines,
        totals: [ { label: 'Gross Profit', value: pl.gross }, { label: 'Net Profit', value: pl.net, grand: true } ],
        terms: 'Generated by Epal Group ERP from the live ledger · Confidential.', sign: 'Group Finance'
      });
    }
  } });

  /* ==========================================================================
   * REPORTS  (documentation-grade downloadable reports)
   * ========================================================================*/
  EPAL.view('*/reports', { render: function (ctx) {
    var cid = ctx.companyId, co = ctx.company, page = el('div.page');
    page.appendChild(head(ctx, 'Reports', 'file-earmark-bar-graph',
      'Download documentation-grade reports for ' + co.short + ' — board-ready, print-ready.'));

    var defs = [
      { id: 'pnl', title: 'Monthly P&L Statement', icon: 'graph-up-arrow', desc: 'Revenue, expense and profit by month (12M).' },
      { id: 'sales', title: 'Sales Register', icon: 'receipt', desc: 'Every recorded sale with cost, profit and customer.' },
      { id: 'expense', title: 'Expense Register', icon: 'wallet2', desc: 'Journal expenses grouped by category.' },
      { id: 'attendance', title: 'Team Attendance Sheet', icon: 'calendar2-check', desc: 'Present / absent / late / leave per employee.' },
      { id: 'salary', title: 'Salary Sheet (CSV)', icon: 'cash-stack', desc: 'Gross, deductions and net pay per employee.' }
    ];
    var grid = el('div.grid-auto.stagger');
    defs.forEach(function (d) {
      grid.appendChild(el('div.card.hover', { style: { cursor: 'pointer' }, onclick: function () { runReport(d.id); } }, [
        el('div.card-pad', null, [
          el('div.flex.items-center.gap-2', null, [
            el('div.scaffold-ico', { html: '<i class="bi bi-' + d.icon + '"></i>' }),
            el('div.flex-1', null, [ el('h4', { text: d.title }), el('p.text-mute.sm', { text: d.desc }) ]),
            ui.frag('<i class="bi bi-download text-accent"></i>')
          ])
        ])
      ]));
    });
    page.appendChild(grid);
    ctx.mount.appendChild(page);

    function dl(name, content, mime) {
      var blob = new Blob([content], { type: mime || 'text/html' });
      var a2 = el('a', { href: URL.createObjectURL(blob), download: name });
      document.body.appendChild(a2); a2.click(); a2.remove();
      ui.toast('Report downloaded', 'success');
    }
    function htmlDoc(title, bodyHtml) {
      return '<!doctype html><html><head><meta charset="utf-8"><title>' + title + '</title><style>' +
        'body{font-family:Inter,Arial,sans-serif;color:#111;max-width:860px;margin:36px auto;padding:0 20px}' +
        'h1{margin:0;font-size:24px}h2{border-bottom:2px solid #3B6FA8;padding-bottom:6px;margin-top:26px;font-size:15px}' +
        'table{width:100%;border-collapse:collapse;margin-top:10px}td,th{border:1px solid #ddd;padding:7px 9px;text-align:left;font-size:12.5px}' +
        'th{background:#f6f6f6}.num{text-align:right;font-variant-numeric:tabular-nums}' +
        '.head{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #3B6FA8;padding-bottom:12px}' +
        '.muted{color:#666;font-size:12.5px}.brand{font-weight:800;color:#3B6FA8;font-size:14px}</style></head><body>' +
        '<div class="head"><div><h1>' + title + '</h1><div class="muted">' + co.name + ' · generated ' + ui.date(new Date(), 'full') + '</div></div>' +
        '<div class="brand">EPAL GROUP</div></div>' + bodyHtml +
        '<p class="muted" style="margin-top:28px">Generated by Epal Group ERP · Confidential — for internal documentation.</p></body></html>';
    }
    function runReport(id) {
      if (id === 'pnl') {
        var s = db().series(cid);
        var rows = s.labels.map(function (l, i) {
          return '<tr><td>' + l + '</td><td class="num">' + ui.money(s.revenue[i]) + '</td><td class="num">' + ui.money(s.expense[i]) + '</td><td class="num">' + ui.money(s.profit[i]) + '</td></tr>';
        }).join('');
        var f = db().finance(cid, 12);
        dl(cid + '-pnl.html', htmlDoc('Profit & Loss — 12 Months',
          '<h2>Summary</h2><table><tr><th>Revenue</th><td class="num">' + ui.money(f.revenue) + '</td></tr>' +
          '<tr><th>Expense</th><td class="num">' + ui.money(f.expense) + '</td></tr>' +
          '<tr><th>Net Profit</th><td class="num">' + ui.money(f.profit) + '</td></tr>' +
          '<tr><th>Margin</th><td class="num">' + ui.pct(f.margin) + '</td></tr></table>' +
          '<h2>Monthly Breakdown</h2><table><tr><th>Month</th><th>Revenue</th><th>Expense</th><th>Profit</th></tr>' + rows + '</table>'));
      } else if (id === 'sales') {
        var sales = db().sales(cid);
        var rows2 = sales.map(function (x) {
          return '<tr><td>' + x.id + '</td><td>' + ui.date(x.date) + '</td><td>' + ui.escapeHtml(x.customer || '—') + '</td><td>' + ui.escapeHtml(x.desc || '') + '</td><td class="num">' + ui.money(x.amount) + '</td><td class="num">' + ui.money(x.profit) + '</td></tr>';
        }).join('');
        dl(cid + '-sales-register.html', htmlDoc('Sales Register',
          '<table><tr><th>Ref</th><th>Date</th><th>Customer</th><th>Description</th><th>Amount</th><th>Profit</th></tr>' + rows2 + '</table>'));
      } else if (id === 'expense') {
        var exp = db().col('acc_entries').filter(function (e) { return e.companyId === cid && e.kind === 'Expense'; });
        var byCat = {}; exp.forEach(function (e) { byCat[e.category] = (byCat[e.category] || 0) + e.amount; });
        var rows3 = Object.keys(byCat).sort(function (a3, b3) { return byCat[b3] - byCat[a3]; })
          .map(function (k) { return '<tr><td>' + ui.escapeHtml(k) + '</td><td class="num">' + ui.money(byCat[k]) + '</td></tr>'; }).join('');
        dl(cid + '-expense-register.html', htmlDoc('Expense Register',
          '<table><tr><th>Category</th><th>Total</th></tr>' + rows3 + '</table>'));
      } else if (id === 'attendance') {
        var team = db().employees({ companyId: cid });
        var rows4 = team.map(function (e) { var t = e.attendance || {};
          return '<tr><td>' + ui.escapeHtml(e.name) + '</td><td>' + ui.escapeHtml(e.designation) + '</td><td class="num">' + (t.present || 0) + '</td><td class="num">' + (t.absent || 0) + '</td><td class="num">' + (t.late || 0) + '</td><td class="num">' + (t.leave || 0) + '</td></tr>'; }).join('');
        dl(cid + '-attendance.html', htmlDoc('Team Attendance Sheet',
          '<table><tr><th>Employee</th><th>Designation</th><th>Present</th><th>Absent</th><th>Late</th><th>Leave</th></tr>' + rows4 + '</table>'));
      } else if (id === 'salary') {
        var team2 = db().employees({ companyId: cid }).filter(function (e) { return e.salary > 0; });
        var lines = [['ID', 'Name', 'Designation', 'Gross', 'Tax5%', 'Net']].concat(team2.map(function (e) {
          var t = Math.round(e.salary * 0.05); return [e.id, e.name, e.designation, e.salary, t, e.salary - t];
        }));
        dl(cid + '-salary.csv', lines.map(function (l) { return l.join(','); }).join('\n'), 'text/csv');
      }
    }
  } });

  /* ==========================================================================
   * ANALYTICS  (company BI: trend + FORECAST + breakdowns + health)
   * ========================================================================*/
  EPAL.view('*/analytics', { render: function (ctx) {
    var cid = ctx.companyId, page = el('div.page');
    var f = db().finance(cid, 12), mom = db().momRevenue(cid), risk = db().riskScore(cid);
    var health = risk < 30 ? ['g', 'Healthy'] : risk < 55 ? ['y', 'Watch'] : ['r', 'At Risk'];

    page.appendChild(head(ctx, 'Analytics & Intelligence', 'graph-up',
      'Trends, forecast and drivers for ' + ctx.company.short + ' — the forward-looking view.'));

    page.appendChild(el('div.kpi-grid', null, [
      kpi('Revenue (12M)', ui.money(f.revenue, { compact: true }), 'cash-coin'),
      kpi('Net Margin', ui.pct(f.margin), 'pie-chart'),
      kpi('MoM Growth', (mom >= 0 ? '+' : '') + mom.toFixed(1) + '%', mom >= 0 ? 'trending-up' : 'trending-down'),
      el('div.kpi-card', null, [
        el('div.kpi-top', null, [ el('span.kpi-label', { text: 'Health Signal' }), el('span.kpi-ico', { html: ui.icon('heart-pulse') }) ]),
        el('div.mt-1', null, [ el('span.health.' + health[0], { text: health[1] + ' · risk ' + risk }) ]),
        el('div.meter.mt-2', null, [ el('span', { class: risk < 30 ? 'lvl-low' : risk < 55 ? 'lvl-mid' : 'lvl-high', style: { width: risk + '%' } }) ])
      ])
    ]));

    var fcId = ui.uid('fc'), catId = ui.uid('ct'), custId = ui.uid('cu');
    page.appendChild(chartCard('Revenue Trend + 3-Month Forecast', 'stars', fcId, 'dashed = projected (least-squares)', 300));
    var row = el('div.two-col.mt-3');
    row.appendChild(chartCard('Expense Drivers', 'pie-chart', catId, 'journal categories', 240));
    row.appendChild(chartCard('Top Customers by Billing', 'people', custId, 'sales ledger', 240));
    page.appendChild(row);
    ctx.mount.appendChild(page);

    requestAnimationFrame(function () {
      var s = db().series(cid);
      var fc = forecast(s.revenue, 3);
      var labels = s.labels.concat(['+1', '+2', '+3']);
      var hist = s.revenue.concat([null, null, null]);
      var proj = s.revenue.map(function () { return null; });
      if (fc.length) { proj[proj.length - 1] = s.revenue[s.revenue.length - 1]; }
      var projFull = proj.concat(fc);
      var c1 = document.getElementById(fcId);
      if (c1) EPAL.charts.line(c1, { labels: labels, legend: true, datasets: [
        { label: 'Revenue', data: hist, color: ctx.company.accent },
        { label: 'Forecast', data: projFull, color: '#f4b740' }
      ] });
      // dash the forecast dataset
      var inst = window.Chart && Chart.getChart ? Chart.getChart(c1) : null;
      if (inst && inst.data.datasets[1]) { inst.data.datasets[1].borderDash = [6, 5]; inst.data.datasets[1].pointRadius = 3; inst.update(); }

      var exp = db().col('acc_entries').filter(function (e) { return e.companyId === cid && e.kind === 'Expense'; });
      var byCat = {}; exp.forEach(function (e) { byCat[e.category] = (byCat[e.category] || 0) + e.amount; });
      var cats = Object.keys(byCat).sort(function (a4, b4) { return byCat[b4] - byCat[a4]; }).slice(0, 7);
      var c2 = document.getElementById(catId);
      if (c2 && cats.length) EPAL.charts.doughnut(c2, { labels: cats, data: cats.map(function (k) { return byCat[k]; }) });

      var byCust = {}; db().sales(cid).forEach(function (s2) { var k = s2.customer || 'Walk-in'; byCust[k] = (byCust[k] || 0) + s2.amount; });
      var custs = Object.keys(byCust).sort(function (a5, b5) { return byCust[b5] - byCust[a5]; }).slice(0, 7);
      var c3 = document.getElementById(custId);
      if (c3 && custs.length) EPAL.charts.bar(c3, { labels: custs, datasets: [{ label: 'Billed', data: custs.map(function (k) { return byCust[k]; }) }], horizontal: true, money: true });
    });
  } });

  /* ==========================================================================
   * CUSTOMERS / CLIENTS  (the shared cross-company customer graph)
   * ========================================================================*/
  function customersView(ctx) {
    var cid = ctx.companyId, page = el('div.page');
    function rows() { return db().customers(cid); }
    var all = rows();
    page.appendChild(head(ctx, ctx.moduleId === 'clients' ? 'Clients' : 'Customers', 'person-hearts',
      'Shared group customer graph, scoped to ' + ctx.company.short + ' — a client added here is instantly known to every concern.', [
      el('button.btn.btn-primary', { html: ui.icon('person-plus') + ' New Customer', onclick: function () { edit(null); } })
    ]));
    page.appendChild(el('div.kpi-grid', null, [
      kpi('Customers', all.length, 'people'),
      kpi('Lifetime Value', ui.money(all.reduce(function (a, c) { return a + (c.value || 0); }, 0), { compact: true }), 'gem'),
      kpi('Gold+ Tier', all.filter(function (c) { return c.tier === 'Gold' || c.tier === 'Platinum'; }).length, 'star-fill'),
      kpi('Shared with Other Concerns', all.filter(function (c) { return (c.companyIds || []).length > 1; }).length, 'diagram-3')
    ]));
    var table = EPAL.table({
      columns: [
        { key: 'name', label: 'Customer', render: function (c) {
          return '<div class="flex items-center gap-1"><span class="avatar" style="background:' + ui.colorFor(c.name) + ';width:26px;height:26px;font-size:10px">' + ui.initials(c.name) + '</span><span class="strong">' + ui.escapeHtml(c.name) + '</span></div>'; } },
        { key: 'contact', label: 'Contact' }, { key: 'phone', label: 'Phone' },
        { key: 'tier', label: 'Tier', badge: { Platinum: 'accent', Gold: 'warn', Silver: 'info' } },
        { key: 'value', label: 'Lifetime Value', num: true, money: true },
        { key: 'companyIds', label: 'Known By', render: function (c) {
          return (c.companyIds || []).map(function (id) { var co2 = EPAL.config.company(id);
            return co2 ? '<span class="badge" style="color:' + co2.accent + '">' + co2.short + '</span>' : ''; }).join(' '); }, sort: false }
      ],
      rows: rows, searchKeys: ['name', 'contact', 'phone', 'email'],
      filters: [{ key: 'tier', label: 'Tier' }], exportName: cid + '-customers.csv',
      onRow: function (c) { edit(c); },
      empty: { icon: 'person-hearts', title: 'No customers yet' }
    });
    page.appendChild(el('div.card', null, [ el('div.card-pad', null, [ table.el ]) ]));
    ctx.mount.appendChild(page);

    function edit(c) {
      var isNew = !c;
      EPAL.formModal({
        title: isNew ? 'New Customer' : 'Edit Customer', icon: 'person-hearts', record: c,
        fields: [
          { key: 'name', label: 'Name / Organisation', type: 'text', required: true, col2: true },
          { key: 'contact', label: 'Contact Person', type: 'text' },
          { key: 'phone', label: 'Phone', type: 'phone', required: true },
          { key: 'email', label: 'Email', type: 'email' },
          { key: 'tier', label: 'Tier', type: 'select', options: ['Standard', 'Silver', 'Gold', 'Platinum'], default: 'Standard' },
          { key: 'value', label: 'Lifetime Value (৳)', type: 'money', min: 0, default: 0 },
          { key: 'status', label: 'Status', type: 'select', options: ['active', 'inactive'], default: 'active' }
        ],
        onSave: function (vals) {
          var rec = Object.assign({}, c || { id: 'CUS-' + Date.now().toString().slice(-5), companyIds: [cid], since: new Date().toISOString().slice(0, 7) }, vals);
          if (rec.companyIds.indexOf(cid) < 0) rec.companyIds.push(cid);
          db().saveCustomer(rec);
          table.refresh(); ui.toast('Customer saved — now visible group-wide', 'success');
        }
      });
    }
  }
  EPAL.view('*/customers', { render: customersView });
  EPAL.view('*/clients', { render: customersView });

  /* ==========================================================================
   * CRM  (company pipeline: kanban + leads table + activity log)
   * ========================================================================*/
  var LEAD_STAGES = [
    { id: 'New', color: '#8b93a7' }, { id: 'Contacted', color: '#7b5cff' }, { id: 'Qualified', color: '#2f6bff' },
    { id: 'Proposal', color: '#f4b740' }, { id: 'Negotiation', color: '#e2721b' }, { id: 'Won', color: '#23c17e' }, { id: 'Lost', color: '#f0506e' }
  ];
  EPAL.view('*/crm', { render: function (ctx) {
    var cid = ctx.companyId, page = el('div.page');
    var sub = ctx.subId || 'pipeline';
    function leads() { return db().leads(cid); }

    var open = leads().filter(function (l) { return ['Won', 'Lost'].indexOf(l.stage) < 0; });
    var won = leads().filter(function (l) { return l.stage === 'Won'; });
    var winRate = (won.length + leads().filter(function (l) { return l.stage === 'Lost'; }).length) ?
      Math.round(won.length / (won.length + leads().filter(function (l) { return l.stage === 'Lost'; }).length) * 100) : 0;

    page.appendChild(head(ctx, 'CRM — ' + ctx.company.short, 'person-lines-fill',
      'Pipeline, follow-ups and communication for this concern.', [
      el('button.btn.btn-primary', { html: ui.icon('person-plus') + ' New Lead', onclick: function () { editLead(null); } })
    ]));

    var pills = el('div.pill-tab.mb-3');
    [['pipeline', 'Pipeline'], ['leads', 'Leads'], ['follow-ups', 'Follow-ups'], ['comm-hub', 'Comm Hub']].forEach(function (p) {
      pills.appendChild(el('button' + (sub === p[0] ? '.active' : ''), { text: p[1],
        onclick: function () { EPAL.router.navigate(cid + '/crm/' + p[0]); } }));
    });
    page.appendChild(el('div', null, [pills]));

    page.appendChild(el('div.kpi-grid', null, [
      kpi('Open Leads', open.length, 'funnel'),
      kpi('Pipeline Value', ui.money(open.reduce(function (a, l) { return a + (l.value || 0); }, 0), { compact: true }), 'cash-coin'),
      kpi('Won', won.length, 'trophy'),
      kpi('Win Rate', winRate + '%', 'bullseye')
    ]));

    var body = el('div');
    page.appendChild(body);
    ctx.mount.appendChild(page);

    function draw() {
      body.innerHTML = '';
      if (sub === 'pipeline') {
        var kb = el('div.kanban');
        LEAD_STAGES.forEach(function (st) {
          var colLeads = leads().filter(function (l) { return l.stage === st.id; });
          var lst = el('div.kb-list');
          colLeads.forEach(function (l) {
            var card = el('div.kb-card', { draggable: 'true', onclick: function () { editLead(l); } }, [
              el('div.kb-card-title', { text: l.name }),
              el('div.text-mute.xs', { text: (l.source || '') + ' · ' + ui.date(l.created) }),
              el('div.kb-card-foot', null, [
                el('span.num.strong', { text: ui.money(l.value, { compact: true }) }),
                el('span.badge', { text: (db().employee(l.owner) || { name: '—' }).name.split(' ')[0] })
              ])
            ]);
            card.addEventListener('dragstart', function (e) { e.dataTransfer.setData('text/plain', l.id); card.classList.add('dragging'); });
            card.addEventListener('dragend', function () { card.classList.remove('dragging'); });
            lst.appendChild(card);
          });
          lst.addEventListener('dragover', function (e) { e.preventDefault(); lst.parentNode.classList.add('drag-over'); });
          lst.addEventListener('dragleave', function () { lst.parentNode.classList.remove('drag-over'); });
          lst.addEventListener('drop', function (e) {
            e.preventDefault(); lst.parentNode.classList.remove('drag-over');
            var id = e.dataTransfer.getData('text/plain');
            var l = leads().filter(function (x) { return x.id === id; })[0];
            if (l && l.stage !== st.id) {
              l.stage = st.id;
              if (st.id === 'Won') {
                if (!l.posted) {
                  l.posted = true;
                  db().postSale(cid, { amount: l.value || 0, cost: 0, ref: l.id, desc: 'CRM deal: ' + l.name, customer: l.name });
                }
                db().notify({ level: 'success', title: 'Deal won 🎉', text: l.name + ' · ' + ui.money(l.value), companyId: cid, icon: 'trophy-fill' });
              }
              db().save('leads', l);
              EPAL.router.render();
            }
          });
          kb.appendChild(el('div.kb-col', { style: { '--kb': st.color } }, [
            el('div.kb-col-head', null, [ el('span.kb-col-dot'), el('span.kb-col-title', { text: st.id }),
              el('span.kb-count', { text: String(colLeads.length) }) ]), lst ]));
        });
        body.appendChild(kb);
      } else if (sub === 'leads') {
        var t = EPAL.table({
          columns: [
            { key: 'name', label: 'Lead', render: function (l) { return '<span class="strong">' + ui.escapeHtml(l.name) + '</span>'; } },
            { key: 'source', label: 'Source' },
            { key: 'stage', label: 'Stage', badge: { Won: 'good', Lost: 'bad', Negotiation: 'warn' } },
            { key: 'value', label: 'Value', num: true, money: true },
            { key: 'created', label: 'Created', date: true }
          ],
          rows: leads, filters: [{ key: 'stage', label: 'Stage' }, { key: 'source', label: 'Source' }],
          searchKeys: ['name', 'source'], exportName: cid + '-leads.csv',
          onRow: function (l) { editLead(l); },
          actions: [{ icon: 'trash', title: 'Delete', onClick: function (l) {
            ui.confirm({ title: 'Delete lead?', danger: true, confirmLabel: 'Delete' }).then(function (ok) { if (ok) { db().remove('leads', l.id); draw(); } }); } }],
          empty: { icon: 'funnel', title: 'No leads yet' }
        });
        body.appendChild(el('div.card', null, [ el('div.card-pad', null, [ t.el ]) ]));
      } else {
        // follow-ups & comm hub share the activity stream
        var acts = db().col('crm_activities');
        if (sub === 'follow-ups') acts = acts.filter(function (a6) { return a6.outcome === 'Needs follow-up' || a6.type === 'Follow-up'; });
        var t2 = EPAL.table({
          columns: [
            { key: 'date', label: 'Date', date: true },
            { key: 'type', label: 'Type', badge: { Call: 'info', Meeting: 'accent', WhatsApp: 'good', Email: 'info' } },
            { key: 'lead', label: 'Lead' }, { key: 'company', label: 'Company' },
            { key: 'note', label: 'Note' }, { key: 'by', label: 'By' },
            { key: 'outcome', label: 'Outcome', badge: { Positive: 'good', 'Needs follow-up': 'warn' } }
          ],
          rows: function () { return acts; }, searchKeys: ['lead', 'company', 'note', 'by'],
          filters: [{ key: 'type', label: 'Type' }], exportName: cid + '-activities.csv',
          empty: { icon: 'chat-left-dots', title: sub === 'follow-ups' ? 'No pending follow-ups' : 'No activities logged' }
        });
        var logBtn = el('button.btn.btn-ghost.mb-2', { html: ui.icon('plus') + ' Log Activity', onclick: function () {
          EPAL.formModal({ title: 'Log Activity', icon: 'chat-left-text', fields: [
            { key: 'type', label: 'Type', type: 'select', options: ['Call', 'Email', 'Meeting', 'WhatsApp', 'Site Visit', 'Follow-up'], required: true },
            { key: 'lead', label: 'Lead / Person', type: 'text', required: true },
            { key: 'company', label: 'Organisation', type: 'text' },
            { key: 'outcome', label: 'Outcome', type: 'select', options: ['Positive', 'Neutral', 'Needs follow-up'] },
            { key: 'note', label: 'Note', type: 'textarea', col2: true, required: true }
          ], onSave: function (vals) {
            var rec = Object.assign({ id: 'ACT-' + Date.now().toString().slice(-6), by: EPAL.auth.current().name,
              date: new Date().toISOString().slice(0, 10), created: new Date().toISOString().slice(0, 10) }, vals);
            db().save('crm_activities', rec); EPAL.router.render(); ui.toast('Activity logged', 'success');
          } });
        } });
        body.appendChild(logBtn);
        body.appendChild(el('div.card', null, [ el('div.card-pad', null, [ t2.el ]) ]));
      }
    }
    draw();

    function editLead(l) {
      var isNew = !l;
      EPAL.formModal({
        title: isNew ? 'New Lead' : 'Edit Lead', icon: 'person-plus', record: l,
        fields: [
          { key: 'name', label: 'Lead Name', type: 'text', required: true, col2: true },
          { key: 'source', label: 'Source', type: 'select', options: ['Website', 'Referral', 'WhatsApp', 'Facebook', 'Walk-in', 'Cold Call', 'Fair'], required: true },
          { key: 'stage', label: 'Stage', type: 'select', options: LEAD_STAGES.map(function (s) { return s.id; }), default: 'New' },
          { key: 'value', label: 'Estimated Value (৳)', type: 'money', required: true, min: 0 }
        ],
        onSave: function (vals) {
          var wasWon = l && l.stage === 'Won';
          var rec = Object.assign({}, l || { id: 'LD-' + Date.now().toString().slice(-5), companyId: cid,
            owner: EPAL.auth.current().id, created: new Date().toISOString().slice(0, 10) }, vals);
          if (vals.stage === 'Won' && !wasWon && !rec.posted) {
            rec.posted = true;
            db().postSale(cid, { amount: vals.value, cost: 0, ref: rec.id, desc: 'CRM deal: ' + vals.name, customer: vals.name });
          }
          db().save('leads', rec);
          EPAL.router.render(); ui.toast('Lead saved', 'success');
        }
      });
    }
  } });

  /* ==========================================================================
   * SETTINGS  (per-company preferences)
   * ========================================================================*/
  EPAL.view('*/settings', { render: function (ctx) {
    var cid = ctx.companyId, page = el('div.page');
    var key = 'settings.' + cid;
    var cur = EPAL.store.get(key, {}) || {};
    page.appendChild(head(ctx, 'Settings', 'gear-fill', 'Preferences for ' + ctx.company.name + '. Module visibility lives in Group ▸ Module Control.'));

    var form = EPAL.form([
      { type: 'section', label: 'Identity' },
      { key: 'displayName', label: 'Display Name', type: 'text', default: ctx.company.name, col2: true },
      { key: 'tagline', label: 'Tagline', type: 'text', default: ctx.company.tagline || '', col2: true },
      { type: 'section', label: 'Documents & Numbering' },
      { key: 'invoicePrefix', label: 'Invoice Prefix', type: 'text', default: (cid.slice(0, 2).toUpperCase() + '-INV') },
      { key: 'fiscalNote', label: 'Fiscal Year Note', type: 'text', default: 'July – June (BD standard)' },
      { type: 'section', label: 'Alerts' },
      { key: 'lowMarginAlert', label: 'Low-margin alert threshold (%)', type: 'number', min: 0, max: 100, default: 12 },
      { key: 'notifyOnSale', label: 'Notify on every recorded sale', type: 'checkbox', default: true }
    ], cur);
    page.appendChild(el('div.card', null, [ el('div.card-body', null, [ form.el,
      el('div.flex.justify-between.mt-2', null, [
        el('button.btn.btn-ghost', { html: ui.icon('toggles2') + ' Open Module Control', onclick: function () { EPAL.router.navigate('group/module-manager'); } }),
        el('button.btn.btn-primary', { html: ui.icon('check-lg') + ' Save Settings', onclick: function () {
          if (!form.validate()) { ui.toast('Please fix the highlighted fields', 'error'); return; }
          EPAL.store.set(key, form.values()); ui.toast('Settings saved', 'success');
        } })
      ]) ]) ]));
    ctx.mount.appendChild(page);
  } });

})(window.EPAL = window.EPAL || {});
