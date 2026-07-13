/* ============================================================================
 * EPAL GROUP ERP  ·  companies/travels/modules/payroll/view.js
 * ----------------------------------------------------------------------------
 * TRAVELS — PAYROLL. A dedicated payroll desk sitting beside Accounts, driven
 * entirely by the shared payroll engine (EPAL.payroll). One registered view
 * branches on ctx.subId into five pill-tabs:
 *
 *   template  → Salary Template — edit the statutory salary structure (component
 *               %s, income-tax, PF, leave rule, pay-by / correction days) + a live
 *               payslip preview.
 *   manage    → Salary Manage — the monthly run: generate → 1st–3rd correction
 *               window → finalize (accrue) → pay (full/partial) → auto-Due.
 *   loans     → Loan Management — staff loans: disburse, per-employee balances,
 *               repayment, transaction log.
 *   payslip   → Payslip — pick an employee + month → full salary statement (with
 *               the Leave Encashment row + eligibility) + print; all payslips list.
 *   advance   → Advance Salary — advances: disburse, per-employee outstanding,
 *               recovery status, transaction log.
 *
 * All accounting (accruals, payments, advances, loans, encashment) is posted to
 * the general ledger by the engine, tagged companyId:'travels', so it flows into
 * the group's consolidated P&L by concern automatically.
 * ==> LARAVEL: a PayrollController over the PayrollService (see backend blueprint).
 * ==========================================================================*/

(function (EPAL) {
  'use strict';
  var ui = EPAL.ui, el = ui.el, db = EPAL.db, S = EPAL.store;
  var CID = 'travels';
  function PR() { return EPAL.payroll; }
  var TABS = [['template', 'Salary Template'], ['manage', 'Salary Manage'], ['loans', 'Loan Management'], ['payslip', 'Payslip'], ['advance', 'Advance Salary']];
  var payYm = null;

  function team() { return (db.employees ? db.employees({ companyId: CID }) : []).slice().sort(function (a, b) { return (a.name || '') < (b.name || '') ? -1 : 1; }); }
  function empById(id) { return team().filter(function (e) { return e.id === id; })[0] || (db.employee ? db.employee(id) : null); }
  function canCreate() { return !EPAL.perm || EPAL.perm.can('travels', 'payroll', 'create'); }
  function esc(s) { return ui.escapeHtml(String(s == null ? '' : s)); }
  function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }
  function today() { return PR() ? PR().today() : '2026-07-05'; }
  function sum(a, f) { return a.reduce(function (x, y) { return x + (f(y) || 0); }, 0); }

  EPAL.view('travels/payroll', {
    render: function (ctx) {
      var sub = ctx.subId || 'manage';
      if (TABS.map(function (t) { return t[0]; }).indexOf(sub) < 0) sub = 'manage';
      var page = el('div.page');
      var titles = { template: 'Salary Template', manage: 'Salary Manage', loans: 'Loan Management', payslip: 'Payslip', advance: 'Advance Salary' };
      var subs = { template: 'The statutory salary structure — components, tax, provident fund and the leave-encashment rule.',
        manage: 'The monthly payroll run — generate, correct, finalize and pay. Posts to the ledger.', loans: 'Staff loans — disburse, track balances and record repayments.',
        payslip: 'Salary statements per employee & month, with the annual Leave-Encashment benefit.', advance: 'Advance salary — disburse and recover against future pay.' };
      page.appendChild(EPAL.pageHead({ eyebrow: 'Travels › Payroll', icon: 'cash-coin', title: titles[sub], sub: subs[sub] }));
      var pills = el('div.pill-tab.mb-3');
      TABS.forEach(function (t) { pills.appendChild(el('button' + (sub === t[0] ? '.active' : ''), { text: t[1], onclick: function () { EPAL.router.navigate('travels/payroll/' + t[0]); } })); });
      page.appendChild(pills);
      if (!PR()) { page.appendChild(card('Payroll engine unavailable.')); ctx.mount.appendChild(page); return; }
      ({ template: tplView, manage: manageView, loans: loansView, payslip: payslipView, advance: advanceView }[sub])(page);
      ctx.mount.appendChild(page);
    }
  });

  /* =================================================== SALARY TEMPLATE */
  function tplView(page) {
    var t = PR().template(CID);
    var preview = el('div');
    function drawPreview(salary) {
      var e = { salary: salary || 50000, companyId: CID };
      var c = PR().computeSlip(e, PR().curYm(), {});
      preview.innerHTML = '';
      preview.appendChild(el('div.data-list', null, [
        drow('Sample gross', ui.money(c.gross)),
        drow('Basic (' + Math.round(t.basicPct * 100) + '%)', ui.money(c.basic)), drow('House (' + Math.round(t.housePct * 100) + '%)', ui.money(c.house)),
        drow('Medical (' + Math.round(t.medicalPct * 100) + '%)', ui.money(c.medical)), drow('Transport', ui.money(c.transport)),
        drow('Income tax', '−' + ui.money(c.tax)), drow('Provident fund', '−' + ui.money(c.pf)),
        drow('Leave encashment / mo', c.encashDays.toFixed(2) + ' day · ' + ui.money(c.encashAmt)),
        el('div.data-row', null, [ el('div.strong.flex-1', { text: 'Net payable' }), el('div.strong.text-good', { text: ui.money(c.net) }) ])
      ]));
    }
    page.appendChild(el('div.two-col', null, [
      el('div.card', null, [ el('div.card-head', null, [ el('h3', { html: ui.icon('sliders') + ' Structure' }) ]), el('div.card-body', null, [
        formField('Basic %', 'basicPct', Math.round(t.basicPct * 100)), formField('House rent %', 'housePct', Math.round(t.housePct * 100)),
        formField('Medical %', 'medicalPct', Math.round(t.medicalPct * 100)), el('div.text-mute.xs.mb-2', { text: 'Transport = the remainder of gross.' }),
        formField('Income-tax threshold (৳)', 'taxThreshold', t.taxThreshold), formField('Income-tax %', 'taxPct', Math.round(t.taxPct * 100)),
        formField('Provident fund % (of basic)', 'pfPct', Math.round(t.pfPct * 100)),
        formField('Annual leave days', 'leaveDaysPerYear', t.leaveDaysPerYear), formField('Working days / month', 'workingDays', t.workingDays),
        formField('Pay-by day', 'payByDay', t.payByDay), formField('Correction until day', 'correctionDay', t.correctionDay),
        canCreate() ? el('button.btn.btn-primary.mt-2', { html: ui.icon('save') + ' Save Template', onclick: function () { saveTpl(t); } }) : null
      ]) ]),
      el('div.card', null, [ el('div.card-head', null, [ el('h3', { html: ui.icon('receipt') + ' Live Preview' }), el('span.card-sub', { text: 'a ৳50,000 salary' }) ]), el('div.card-body', null, [ preview ]) ])
    ]));
    drawPreview(50000);
  }
  function formField(label, key, val) {
    return el('div.form-row', { style: { marginBottom: '9px' } }, [
      el('label.text-mute.sm', { text: label, style: { display: 'block', marginBottom: '3px' } }),
      el('input.input', { type: 'number', value: String(val), 'data-key': key, style: { width: '100%' } })
    ]);
  }
  function saveTpl(t) {
    var page = document.querySelector('#view');
    function g(k) { var i = page.querySelector('[data-key="' + k + '"]'); return i ? +i.value : 0; }
    t.basicPct = g('basicPct') / 100; t.housePct = g('housePct') / 100; t.medicalPct = g('medicalPct') / 100;
    t.taxThreshold = g('taxThreshold'); t.taxPct = g('taxPct') / 100; t.pfPct = g('pfPct') / 100;
    t.leaveDaysPerYear = g('leaveDaysPerYear'); t.workingDays = g('workingDays'); t.payByDay = g('payByDay'); t.correctionDay = g('correctionDay');
    if (t.basicPct + t.housePct + t.medicalPct > 1) { ui.toast('Basic + House + Medical cannot exceed 100%', 'error'); return; }
    PR().saveTemplate(t); ui.toast('Template saved', 'success'); EPAL.router.render();
  }

  /* =================================================== SALARY MANAGE */
  function manageView(page) {
    var ym = payYm || PR().curYm();
    PR().generate(CID, ym); PR().refreshRunStatus(CID, ym);
    var run = PR().getRun(CID, ym);
    var slips = PR().slipsFor(CID, ym).slice().sort(function (a, b) { return (a.empName || '') < (b.empName || '') ? -1 : 1; });
    var gross = sum(slips, function (s) { return s.earnedGross; }), net = sum(slips, function (s) { return s.earnedGross - s.tax - s.pf; });
    var paid = sum(slips, function (s) { return s.paid || 0; }), due = net - paid;
    var st = run ? run.status : 'draft', inWin = PR().inCorrectionWindow(CID, ym);

    page.appendChild(el('div.kpi-grid.kpi-compact.stagger', null, [
      kpi('Headcount', String(slips.length), 'people'), kpi('Gross', ui.money(gross, { compact: true }), 'cash-stack'),
      kpi('Net Payable', ui.money(net, { compact: true }), 'wallet2'), kpi('Paid', ui.money(paid, { compact: true }), 'check2-circle', 'text-good'),
      kpi('Outstanding', ui.money(due, { compact: true }), 'hourglass-split', due > 0 ? 'text-warn' : 'text-good')
    ]));

    var runs = S.list('pay_runs').filter(function (r) { return r.companyId === CID; }).sort(function (a, b) { return a.ym < b.ym ? 1 : -1; });
    var sel = el('select.input', { style: { maxWidth: '230px' }, onchange: function () { payYm = this.value; EPAL.router.render(); } });
    runs.forEach(function (r) { var o = el('option', { value: r.ym, text: PR().mLabel(r.ym) + '  ·  ' + cap(r.status) }); if (r.ym === ym) o.selected = true; sel.appendChild(o); });
    var actions = el('div.flex.gap-1.flex-wrap');
    if (canCreate()) {
      if (st === 'draft') actions.appendChild(el('button.btn.btn-primary', { html: ui.icon('lock') + ' Finalize & Accrue', onclick: function () { finalizeRun(ym, net); } }));
      if (st !== 'draft' && due > 0) actions.appendChild(el('button.btn.btn-primary', { html: ui.icon('cash-coin') + ' Pay All', onclick: function () { payAll(ym); } }));
    }
    page.appendChild(el('div.card.mb-3', null, [ el('div.card-body', null, [
      el('div.flex.justify-between.items-center.flex-wrap.gap-2', null, [
        el('div.flex.items-center.gap-2.flex-wrap', null, [ sel, el('span.badge.badge-' + (st === 'paid' ? 'good' : st === 'due' ? 'bad' : st === 'draft' ? 'warn' : 'info'), { text: cap(st) }) ]), actions ]),
      el('div.text-mute.sm.mt-2', { html: st === 'draft'
        ? (inWin ? ('<b>Correction window open</b> until ' + ui.date(run.correctionUntil) + ' — adjust per head, then finalize.') : ('Correction window closed (' + ui.date(run.correctionUntil) + ') — finalize to accrue.'))
        : ('Finalized — pay by ' + ui.date(run.dueAfter) + ' or unpaid salaries flag Due.') })
    ]) ]));

    var tbl = EPAL.table({
      columns: [
        { key: 'empName', label: 'Employee', render: function (s) { return '<span class="strong">' + esc(s.empName) + '</span>'; } },
        { key: 'dept', label: 'Dept', badge: {} },
        { key: 'earnedGross', label: 'Gross', num: true, money: true },
        { key: 'ded', label: 'Tax+PF', num: true, sortVal: function (s) { return s.tax + s.pf; }, render: function (s) { var d = s.tax + s.pf; return d ? '<span class="text-warn">' + ui.money(d) + '</span>' : '—'; } },
        { key: 'encashAmt', label: 'Leave Encash', num: true, money: true },
        { key: 'net', label: 'Net', num: true, sortVal: function (s) { return s.earnedGross - s.tax - s.pf; }, render: function (s) { return '<span class="num strong">' + ui.money(s.earnedGross - s.tax - s.pf) + '</span>'; } },
        { key: 'paid', label: 'Paid', num: true, sortVal: function (s) { return s.paid || 0; }, render: function (s) { return s.paid ? '<span class="text-good">' + ui.money(s.paid) + '</span>' : '—'; } },
        { key: 'status', label: 'Status', badge: { draft: '', accrued: 'info', partial: 'warn', due: 'bad', paid: 'good' } }
      ],
      rows: slips, searchKeys: ['empName', 'dept'], quickFilter: 'dept', filterPanel: true, filters: [{ key: 'status', label: 'Status' }],
      exportName: 'payroll-' + ym + '.csv', pdfTitle: 'Travels Payroll — ' + PR().mLabel(ym),
      onRow: function (s) { var e = empById(s.empId); if (e) statement(e, ym); },
      actions: ui.actions({
        edit: (canCreate() && st === 'draft' && inWin) ? function (s) { correctionForm(s, ym); } : null,
        print: function (s) { var e = empById(s.empId); if (e) statementPrint(e, ym); }
      }),
      empty: { icon: 'cash-stack', title: 'No employees to pay' }
    });
    page.appendChild(el('div.card', null, [ el('div.card-head', null, [ el('h3', { html: ui.icon('cash-stack') + ' Payslips — ' + PR().mLabel(ym) }), el('span.card-sub', { text: 'click a row for the statement' }) ]), el('div.card-body', null, [ tbl.el ]) ]));

    if (st !== 'draft' && due > 0 && canCreate()) {
      var grid = el('div.grid-auto.kpi-compact');
      slips.forEach(function (s) { var payable = s.earnedGross - s.tax - s.pf, out = payable - (s.paid || 0); if (out <= 0) return;
        grid.appendChild(el('div.card.tier-card', { onclick: function () { payForm(s, ym); } }, [ el('div.card-pad', null, [ el('div.fw-700', { text: s.empName }), el('div.text-mute.sm', { text: 'Outstanding ' + ui.money(out) }), el('span.badge.badge-' + (s.status === 'due' ? 'bad' : 'warn'), { text: cap(s.status) }) ]) ])); });
      page.appendChild(el('div.card', null, [ el('div.card-head', null, [ el('h3', { html: ui.icon('cash-coin') + ' Pay individual salaries' }) ]), el('div.card-body', null, [grid]) ]));
    }
  }
  function finalizeRun(ym, net) {
    ui.confirm({ title: 'Finalize ' + PR().mLabel(ym) + '?', text: 'Locks corrections and accrues salaries + leave encashment to the ledger. Net ' + ui.money(net) + '.', confirmLabel: 'Finalize' })
      .then(function (ok) { if (!ok) return; try { PR().finalize(CID, ym); ui.toast('Payroll finalized', 'success'); EPAL.router.render(); } catch (e) { ui.toast(e.message || 'Failed', 'error'); } });
  }
  function payAll(ym) {
    ui.confirm({ title: 'Pay all outstanding?', text: 'Posts each payment (recovers any advance).', confirmLabel: 'Pay All' })
      .then(function (ok) { if (!ok) return; PR().slipsFor(CID, ym).forEach(function (s) { try { PR().pay(s.empId, ym); } catch (e) {} }); ui.toast('Salaries paid', 'success'); EPAL.router.render(); });
  }
  function payForm(s, ym) {
    var payable = s.earnedGross - s.tax - s.pf, out = payable - (s.paid || 0);
    EPAL.formModal({ title: 'Pay — ' + s.empName, icon: 'cash-coin', size: 'sm', record: { amount: out, method: 'Bank' },
      fields: [ { key: 'amount', label: 'Amount (৳)', type: 'money', default: out, min: 0, max: out, hint: 'Outstanding ' + ui.money(out) + ' — pay less for a partial.' },
        { key: 'method', label: 'Method', type: 'select', options: ['Bank', 'Cash', 'bKash', 'Cheque'], default: 'Bank' } ],
      saveLabel: 'Post Payment', onSave: function (v) { try { PR().pay(s.empId, ym, +v.amount, v.method); ui.toast('Payment posted', 'success'); EPAL.router.render(); return true; } catch (e) { ui.toast(e.message || 'Failed', 'error'); return false; } } });
  }
  function correctionForm(s, ym) {
    EPAL.formModal({ title: 'Correction — ' + s.empName, icon: 'sliders', size: 'sm', record: { leaveDeductDays: s.leaveDeductDays || 0, otherDeduction: s.otherDeduction || 0, bonus: s.bonus || 0 },
      fields: [ { key: 'leaveDeductDays', label: 'Unpaid-leave days', type: 'number', min: 0, max: 30, default: 0 }, { key: 'otherDeduction', label: 'Other deduction (৳)', type: 'money', min: 0, default: 0 }, { key: 'bonus', label: 'Bonus (৳)', type: 'money', min: 0, default: 0 } ],
      saveLabel: 'Apply', onSave: function (v) { try { PR().adjustSlip(s.empId, ym, { leaveDeductDays: +v.leaveDeductDays, otherDeduction: +v.otherDeduction, bonus: +v.bonus }); ui.toast('Applied', 'success'); EPAL.router.render(); return true; } catch (e) { ui.toast(e.message || 'Blocked', 'error'); return false; } } });
  }

  /* =================================================== LOAN MANAGEMENT */
  function loansView(page) {
    var t = team();
    var byEmp = t.map(function (e) { return { e: e, out: PR().loanOutstanding(e.id) }; });
    var txns = S.list('pay_txns').filter(function (x) { return x.companyId === CID && (x.type === 'loan' || x.type === 'loan-repay'); }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    var totalOut = sum(byEmp, function (x) { return x.out; });
    var disbursed = sum(txns.filter(function (x) { return x.type === 'loan'; }), function (x) { return x.amount; });
    var active = byEmp.filter(function (x) { return x.out > 0; });

    page.appendChild(el('div.kpi-grid.kpi-compact.stagger', null, [
      kpi('Loan Outstanding', ui.money(totalOut, { compact: true }), 'bank', 'text-warn'),
      kpi('Total Disbursed', ui.money(disbursed, { compact: true }), 'cash-stack'),
      kpi('Active Loans', String(active.length), 'people'),
      kpi('Repaid', ui.money(disbursed - totalOut, { compact: true }), 'check2-circle', 'text-good')
    ]));
    if (canCreate()) page.appendChild(el('div.mb-3', null, [ el('button.btn.btn-primary', { html: ui.icon('bank') + ' Disburse Loan', onclick: function () { moneyForm(null, 'loan'); } }) ]));

    if (active.length) {
      var lt = EPAL.table({
        columns: [ { key: 'name', label: 'Employee', render: function (r) { return '<span class="strong">' + esc(r.e.name) + '</span>'; } },
          { key: 'out', label: 'Outstanding', num: true, render: function (r) { return '<span class="num strong text-warn">' + ui.money(r.out) + '</span>'; }, sortVal: function (r) { return r.out; } } ],
        rows: active, pageSize: 8, onRow: function (r) { moneyForm(r.e, 'loan-repay'); },
        actions: ui.actions({ edit: canCreate() ? function (r) { moneyForm(r.e, 'loan-repay'); } : null }), empty: { icon: 'bank', title: 'No active loans' }
      });
      page.appendChild(el('div.card', null, [ el('div.card-head', null, [ el('h3', { html: ui.icon('people') + ' Employees with loans' }), el('span.card-sub', { text: 'click to record a repayment' }) ]), el('div.card-body', null, [ lt.el ]) ]));
    }
    page.appendChild(txnTable('Loan transactions', txns));
  }

  /* =================================================== ADVANCE SALARY */
  function advanceView(page) {
    var t = team();
    var byEmp = t.map(function (e) { return { e: e, out: PR().advanceOutstanding(e.id) }; });
    var txns = S.list('pay_txns').filter(function (x) { return x.companyId === CID && x.type === 'advance'; }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    var totalOut = sum(byEmp, function (x) { return x.out; });
    var given = sum(txns, function (x) { return x.amount; });
    var active = byEmp.filter(function (x) { return x.out > 0; });

    page.appendChild(el('div.kpi-grid.kpi-compact.stagger', null, [
      kpi('Advance Outstanding', ui.money(totalOut, { compact: true }), 'cash', 'text-warn'),
      kpi('Total Given', ui.money(given, { compact: true }), 'cash-stack'),
      kpi('Recovered', ui.money(given - totalOut, { compact: true }), 'check2-circle', 'text-good'),
      kpi('Employees', String(active.length), 'people')
    ]));
    if (canCreate()) page.appendChild(el('div.mb-3', null, [ el('button.btn.btn-primary', { html: ui.icon('cash') + ' Give Advance', onclick: function () { moneyForm(null, 'advance'); } }) ]));

    if (active.length) {
      var at = EPAL.table({
        columns: [ { key: 'name', label: 'Employee', render: function (r) { return '<span class="strong">' + esc(r.e.name) + '</span>'; } },
          { key: 'out', label: 'Outstanding', num: true, render: function (r) { return '<span class="num strong text-warn">' + ui.money(r.out) + '</span>'; }, sortVal: function (r) { return r.out; } } ],
        rows: active, pageSize: 8, empty: { icon: 'cash', title: 'No outstanding advances' }
      });
      page.appendChild(el('div.card', null, [ el('div.card-head', null, [ el('h3', { html: ui.icon('people') + ' Outstanding advances' }), el('span.card-sub', { text: 'recovered automatically from the next salary' }) ]), el('div.card-body', null, [ at.el ]) ]));
    }
    page.appendChild(txnTable('Advance transactions', txns));
  }
  function txnTable(title, txns) {
    var tbl = EPAL.table({
      columns: [ { key: 'date', label: 'Date', date: true }, { key: 'empName', label: 'Employee' },
        { key: 'type', label: 'Type', badge: { advance: 'warn', loan: 'warn', 'loan-repay': 'good' } },
        { key: 'memo', label: 'Note' }, { key: 'method', label: 'Method', badge: {} },
        { key: 'amount', label: 'Amount', num: true, money: true } ],
      rows: txns, searchKeys: ['empName', 'memo'], pageSize: 10, exportName: 'payroll-txns.csv', empty: { icon: 'journal', title: 'No transactions' }
    });
    return el('div.card', null, [ el('div.card-head', null, [ el('h3', { html: ui.icon('journal-text') + ' ' + title }) ]), el('div.card-body', null, [ tbl.el ]) ]);
  }
  function moneyForm(emp, type) {
    var meta = { advance: ['Give Advance Salary', 'cash', 'Advance salary'], loan: ['Disburse Staff Loan', 'bank', 'Staff loan'], 'loan-repay': ['Record Loan Repayment', 'arrow-return-left', 'Loan repayment'] }[type];
    var rec = { date: today(), method: 'Bank' }; if (emp) rec.empId = emp.id;
    EPAL.formModal({
      title: meta[0], icon: meta[1], size: 'sm', record: rec,
      fields: [
        { key: 'empId', label: 'Employee', type: 'select', required: true, options: team().map(function (e) { return [e.id, e.name + ' · ' + e.dept]; }) },
        { key: 'amount', label: 'Amount (৳)', type: 'money', required: true, min: 0 },
        type === 'loan' ? { key: 'emiMonths', label: 'Repay over (months)', type: 'number', min: 0, default: 0 } : null,
        { key: 'date', label: 'Date', type: 'date', default: today() },
        { key: 'method', label: 'Method', type: 'select', options: ['Bank', 'Cash', 'bKash', 'Cheque'], default: 'Bank' },
        { key: 'memo', label: 'Note', type: 'text', placeholder: meta[2] }
      ].filter(Boolean),
      saveLabel: meta[0],
      onSave: function (v) {
        var fn = { advance: PR().advance, loan: PR().loan, 'loan-repay': PR().repayLoan }[type];
        try { fn(v.empId, +v.amount, { date: v.date, method: v.method, memo: v.memo || meta[2], emiMonths: +v.emiMonths || 0 }); ui.toast(meta[0] + ' recorded', 'success'); EPAL.router.render(); return true; } catch (x) { ui.toast(x.message || 'Failed', 'error'); return false; }
      }
    });
  }

  /* =================================================== PAYSLIP */
  function payslipView(page) {
    var t = team();
    var slips = S.list('pay_slips').filter(function (s) { return s.companyId === CID && s.status !== 'draft'; }).sort(function (a, b) { return a.ym < b.ym ? 1 : -1; });
    // employee + month picker
    var months = S.list('pay_runs').filter(function (r) { return r.companyId === CID; }).map(function (r) { return r.ym; }).sort().reverse();
    var pick = el('div.card.mb-3', null, [ el('div.card-body', null, [ el('div.flex.gap-2.flex-wrap.items-end', null, [
      field('Employee', (function () { var s = el('select.input', { id: 'ps-emp' }); t.forEach(function (e) { s.appendChild(el('option', { value: e.id, text: e.name })); }); return s; })()),
      field('Month', (function () { var s = el('select.input', { id: 'ps-ym' }); (months.length ? months : [PR().curYm()]).forEach(function (m) { s.appendChild(el('option', { value: m, text: PR().mLabel(m) })); }); return s; })()),
      el('button.btn.btn-primary', { html: ui.icon('receipt') + ' View Statement', onclick: function () { var e = empById(document.getElementById('ps-emp').value); var ym = document.getElementById('ps-ym').value; if (e) statement(e, ym); } })
    ]) ]) ]);
    page.appendChild(pick);

    var tbl = EPAL.table({
      columns: [
        { key: 'empName', label: 'Employee', render: function (s) { return '<span class="strong">' + esc(s.empName) + '</span>'; } },
        { key: 'ym', label: 'Month', render: function (s) { return PR().mLabel(s.ym); } },
        { key: 'earnedGross', label: 'Gross', num: true, money: true },
        { key: 'net', label: 'Net', num: true, sortVal: function (s) { return s.earnedGross - s.tax - s.pf; }, render: function (s) { return '<span class="num strong">' + ui.money(s.earnedGross - s.tax - s.pf) + '</span>'; } },
        { key: 'encashAmt', label: 'Leave Encash', num: true, money: true },
        { key: 'status', label: 'Status', badge: { accrued: 'info', partial: 'warn', due: 'bad', paid: 'good' } }
      ],
      rows: slips, searchKeys: ['empName'], quickFilter: 'status', pageSize: 12, exportName: 'payslips.csv', pdfTitle: 'Travels Payslips',
      onRow: function (s) { var e = empById(s.empId); if (e) statement(e, s.ym); },
      actions: ui.actions({ print: function (s) { var e = empById(s.empId); if (e) statementPrint(e, s.ym); } }),
      empty: { icon: 'receipt', title: 'No payslips yet', hint: 'Finalize a payroll month in Salary Manage.' }
    });
    page.appendChild(el('div.card', null, [ el('div.card-head', null, [ el('h3', { html: ui.icon('card-list') + ' All Payslips' }) ]), el('div.card-body', null, [ tbl.el ]) ]));
  }
  function field(label, input) { return el('div', null, [ el('label.text-mute.sm', { text: label, style: { display: 'block', marginBottom: '3px' } }), input ]); }

  /* ---- salary statement (shared) ----------------------------------------*/
  function statement(e, ym) {
    var s = PR().statement(e, ym), body = el('div');
    ui.modal({ title: 'Salary Statement — ' + e.name, icon: 'receipt', size: 'md', body: body, footer: false });
    var le = s.leaveEncashment;
    body.appendChild(el('div.card', null, [ el('div.card-body', null, [
      el('div.flex.items-center.gap-2.mb-3', null, [ el('div.flex-1', null, [ el('div.fw-700', { text: e.name }), el('div.text-mute.sm', { text: PR().mLabel(ym) + ' · ' + (e.designation || '') }) ]),
        el('span.badge.badge-' + (s.status === 'paid' ? 'good' : s.status === 'due' ? 'bad' : s.status === 'partial' ? 'warn' : 'info'), { text: cap(s.status) }),
        el('button.btn.btn-sm.btn-primary', { html: ui.icon('printer') + ' Print', onclick: function () { statementPrint(e, ym); } }) ]),
      el('div.data-list', null, [
        el('div.section-label', { text: 'Earnings' }),
        drow('Basic', ui.money(s.slip.basic)), drow('House rent', ui.money(s.slip.house)), drow('Medical', ui.money(s.slip.medical)), drow('Transport', ui.money(s.slip.transport)),
        s.slip.leaveDeductDays ? drow('Unpaid leave', s.slip.leaveDeductDays + ' day(s)') : null,
        el('div.data-row', null, [ el('div.strong.flex-1', { text: 'Gross earned' }), el('div.strong', { text: ui.money(s.grossEarned) }) ]),
        el('div.section-label', { text: 'Deductions' }),
        drow('Income tax', '−' + ui.money(s.slip.tax)), drow('Provident fund', '−' + ui.money(s.slip.pf)),
        s.slip.otherDeduction ? drow('Other deduction', '−' + ui.money(s.slip.otherDeduction)) : null,
        el('div.section-label', { text: 'Leave Encashment (annual benefit)' }),
        drow('Accrued this month', le.days.toFixed(2) + ' day · ' + ui.money(le.amount)),
        drow('Balance to date', le.accruedDays.toFixed(2) + ' days · ' + ui.money(le.accruedValue)),
        el('div.data-row', null, [ el('div.text-mute.sm.flex-1', { text: 'Full-year eligibility' }), el('div', null, [ le.eligible ? el('span.badge.badge-good', { text: 'Eligible — ' + le.fullYearDays + ' days' }) : el('span.badge.badge-warn', { text: 'Accruing' }) ]) ]),
        el('div.divider'),
        el('div.data-row', null, [ el('div.strong.flex-1', { text: 'Net Payable' }), el('div.strong.text-good', { text: ui.money(s.netPayable) }) ]),
        s.paid ? drow('Paid', ui.money(s.paid)) : null,
        s.outstanding ? el('div.data-row', null, [ el('div.strong.flex-1', { text: 'Outstanding' }), el('div.strong.text-warn', { text: ui.money(s.outstanding) }) ]) : null
      ].filter(Boolean))
    ]) ]));
  }
  function statementPrint(e, ym) {
    var s = PR().statement(e, ym), le = s.leaveEncashment;
    function r(k, v, neg) { return '<tr><td>' + esc(k) + '</td><td>' + (neg ? '−' : '') + ui.money(v) + '</td></tr>'; }
    ui.printDoc({ title: 'Salary Statement — ' + e.name, subtitle: 'Epal Travels & Consultancy · Payroll', meta: (e.designation || '') + ' · ' + PR().mLabel(ym), footer: 'System-generated — Confidential',
      bodyHtml: '<table><tr><th>Component</th><th>Amount</th></tr>' + r('Basic', s.slip.basic) + r('House rent', s.slip.house) + r('Medical', s.slip.medical) + r('Transport', s.slip.transport) +
        '<tr><th>Gross earned</th><th>' + ui.money(s.grossEarned) + '</th></tr>' + r('Income tax', s.slip.tax, true) + r('Provident fund', s.slip.pf, true) +
        '<tr><td>Leave Encashment (' + le.days.toFixed(2) + ' d)</td><td>' + ui.money(le.amount) + '</td></tr>' +
        '<tr><td>Leave balance</td><td>' + le.accruedDays.toFixed(2) + ' days' + (le.eligible ? ' (eligible)' : '') + '</td></tr>' +
        '<tr><th>Net Payable</th><th>' + ui.money(s.netPayable) + '</th></tr></table>' });
  }

  /* ---- small helpers ----------------------------------------------------*/
  function kpi(label, value, icon, tone) { return el('div.kpi-card', null, [ el('div.kpi-top', null, [ el('span.kpi-label', { text: label }), el('span.kpi-ico', { html: '<i class="bi bi-' + icon + '"></i>' }) ]), el('div.kpi-value' + (tone ? '.' + tone : ''), { text: String(value) }) ]); }
  function drow(k, v) { return el('div.data-row', null, [ el('div.text-mute.sm.flex-1', { text: k }), el('div.strong', { text: v == null || v === '' ? '—' : String(v) }) ]); }
  function card(text) { return el('div.card', null, [ el('div.card-body', { text: text }) ]); }

})(window.EPAL = window.EPAL || {});
