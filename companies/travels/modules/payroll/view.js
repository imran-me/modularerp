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
  // COMPANY-AGNOSTIC payroll desk: one implementation registered for EVERY sister
  // concern (roadmap #7 UI roll-out). CID is stamped at render time — click
  // handlers run while that company's page is on screen, so it stays correct.
  var CID = 'travels';
  function PR() { return EPAL.payroll; }
  var TABS = [['template', 'Salary Template'], ['manage', 'Salary Manage'], ['loans', 'Loan Management'], ['payslip', 'Payslip'], ['advance', 'Advance Salary'], ['reports', 'Reports']];
  var payYm = null;

  function team() { return (db.employees ? db.employees({ companyId: CID }) : []).slice().sort(function (a, b) { return (a.name || '') < (b.name || '') ? -1 : 1; }); }
  function empById(id) { return team().filter(function (e) { return e.id === id; })[0] || (db.employee ? db.employee(id) : null); }
  function canCreate() { return !EPAL.perm || EPAL.perm.can(CID, 'payroll', 'create'); }
  function esc(s) { return ui.escapeHtml(String(s == null ? '' : s)); }
  function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }
  function today() { return PR() ? PR().today() : '2026-07-05'; }
  function sum(a, f) { return a.reduce(function (x, y) { return x + (f(y) || 0); }, 0); }
  function coShort(cid) { var c = EPAL.config && EPAL.config.company ? EPAL.config.company(cid) : null; return c ? c.short : cid; }

  ['travels', 'woodart', 'it', 'shop', 'construction'].forEach(function (cid) {
    EPAL.view(cid + '/payroll', {
      render: function (ctx) {
        if (CID !== cid) payYm = null;          // reset month only when switching company
        CID = cid;
        var sub = ctx.subId || 'manage';
        if (TABS.map(function (t) { return t[0]; }).indexOf(sub) < 0) sub = 'manage';
        var page = el('div.page');
        var titles = { template: 'Salary Template', manage: 'Salary Manage', loans: 'Loan Management', payslip: 'Payslip', advance: 'Advance Salary', reports: 'Payroll Reports' };
        var subs = { template: 'The statutory salary structure — components, tax, provident fund and the leave-encashment rule.',
          manage: 'The monthly payroll run — generate, correct, finalize and pay. Posts to the ledger.', loans: 'Staff loans — disburse, track balances and record repayments.',
          payslip: 'Salary statements per employee & month, with the annual Leave-Encashment benefit.', advance: 'Advance salary — disburse and recover against future pay.',
          reports: 'Leave-encashment liability, salary due, advance & loan registers, department cost.' };
        page.appendChild(EPAL.pageHead({ eyebrow: coShort(cid) + ' › Payroll', icon: 'cash-coin', title: titles[sub], sub: subs[sub] }));
        var pills = el('div.pill-tab.mb-3');
        TABS.forEach(function (t) { pills.appendChild(el('button' + (sub === t[0] ? '.active' : ''), { text: t[1], onclick: function () { EPAL.router.navigate(cid + '/payroll/' + t[0]); } })); });
        page.appendChild(pills);
        if (!PR()) { page.appendChild(card('Payroll engine unavailable.')); ctx.mount.appendChild(page); return; }
        ({ template: tplView, manage: manageView, loans: loansView, payslip: payslipView, advance: advanceView, reports: reportsView }[sub])(page);
        ctx.mount.appendChild(page);
      }
    });
  });

  /* ---- EMBEDDED MODE — the payroll desk mounted INSIDE the Accounts section
   * (owner: "payroll goes in the accounts section — no side menus, buttons at the
   * top"). The six sections render as a second pill row; state survives re-renders. */
  var deskTab = 'manage';
  // opts.rightEl — an element (e.g. Master Accounts' company switcher) laid
  // in the SAME row as the section pills, pushed to the right (owner mark)
  EPAL.payrollDesk = function (page, cid, opts) {
    if (CID !== cid) { payYm = null; deskTab = 'manage'; }
    CID = cid;
    var host = el('div');
    function draw() {
      host.innerHTML = '';
      var bar = el('div.pill-tab');
      TABS.forEach(function (t) { bar.appendChild(el('button' + (deskTab === t[0] ? '.active' : ''), { text: t[1], onclick: function () { deskTab = t[0]; draw(); } })); });
      // ONE row (owner): section pills + company switcher share the line
      // with a hairline separator; both groups shrink fluidly, never wrap
      var row = el('div.nav-row.mb-3');
      row.appendChild(bar);
      if (opts && opts.rightEl) {
        row.appendChild(el('div.vsep'));
        opts.rightEl.classList.remove('mb-3'); opts.rightEl.classList.remove('flex-wrap');
        opts.rightEl.classList.add('co-sw');
        row.appendChild(opts.rightEl);
      }
      host.appendChild(row);
      if (!PR()) { host.appendChild(card('Payroll engine unavailable.')); return; }
      var section = el('div');
      ({ template: tplView, manage: manageView, loans: loansView, payslip: payslipView, advance: advanceView, reports: reportsView }[deskTab])(section);
      host.appendChild(section);
    }
    draw();
    page.appendChild(host);
  };

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
        formField('Overtime rate / hour (0 = auto 1.5×)', 'overtimeRate', t.overtimeRate || 0),
        formField('Lates per absent day', 'latesPerAbsent', t.latesPerAbsent || 3),
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
    t.taxThreshold = g('taxThreshold'); t.taxPct = g('taxPct') / 100; t.pfPct = g('pfPct') / 100; t.overtimeRate = g('overtimeRate'); t.latesPerAbsent = g('latesPerAbsent') || 3;
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
    var gross = sum(slips, function (s) { return s.earnedGross; }), net = sum(slips, function (s) { return PR().slipPayable(s); });
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
    actions.appendChild(el('button.btn.btn-ghost', { html: ui.icon('printer') + ' Print Sheet', onclick: function () { printSheetForm(slips, ym); } }));
    if (canCreate()) {
      if (st === 'draft') actions.appendChild(el('button.btn.btn-primary', { html: ui.icon('lock') + ' Finalize & Accrue', onclick: function () { finalizeRun(ym, net); } }));
      if (st !== 'draft') actions.appendChild(el('button.btn.btn-outline', { html: ui.icon('arrow-counterclockwise') + ' Reopen Draft',
        title: 'Rewind to the BEFORE-ACCRUED state — repeatable (demo-safe)',
        onclick: function () {
          var paidCount = slips.filter(function (s) { return s.paid > 0; }).length;
          ui.confirm({ title: 'Reopen ' + PR().mLabel(ym) + ' as Draft?', confirmLabel: 'Reopen Draft',
            text: 'Shows the month as it was BEFORE accrual: ' + (paidCount ? paidCount + ' payment(s) are reversed, ' : '') + 'the accrual is lifted from the books, and ✎ adjustments unlock. You can Finalize & Accrue again any time — fully repeatable.' })
            .then(function (ok) { if (!ok) return; PR().unfinalize(CID, ym); ui.toast('Back to draft — before-accrued state', 'success'); EPAL.router.render(); });
        } }));
      if (st !== 'draft' && due > 0) actions.appendChild(el('button.btn.btn-primary', { html: ui.icon('cash-coin') + ' Pay All', onclick: function () { payAll(ym); } }));
    }
    page.appendChild(el('div.card.mb-3', null, [ el('div.card-body', null, [
      el('div.flex.justify-between.items-center.flex-wrap.gap-2', null, [
        el('div.flex.items-center.gap-2.flex-wrap', null, [ sel, el('span.badge.badge-' + (st === 'paid' ? 'good' : st === 'due' ? 'bad' : st === 'draft' ? 'warn' : 'info'), { text: cap(st) }) ]), actions ]),
      el('div.text-mute.sm.mt-2', { html: st === 'draft'
        ? (inWin ? ('<b>Correction window open</b> until ' + ui.date(run.correctionUntil) + ' — adjust per head, then finalize.') : ('Correction window closed (' + ui.date(run.correctionUntil) + ') — finalize to accrue.'))
        : ('Finalized — pay by ' + ui.date(run.dueAfter) + ' or unpaid salaries flag Due.') })
    ]) ]));

    // The FULL salary sheet (spec E6.3): Gross | OT | Bonus | Encash | Advance adj |
    // Loan EMI | Absent | Other ded | Net Payable | Paid | Due | Status per head.
    function advOf(s) { var auto = Math.min(PR().advanceOutstanding(s.empId), Math.max(0, PR().slipPayable(s))); return (s.paid > 0) ? (s.advanceRecovered || 0) : ((s.advCap == null || s.advCap === '') ? auto : Math.min(auto, +s.advCap)); }
    function emiOf(s) { return (s.paid > 0) ? (s.loanRecovered || 0) : ((s.emiCap == null || s.emiCap === '') ? PR().emiInstallment(s.empId) : +s.emiCap); }
    function otherOf(s) { return (s.tax || 0) + (s.pf || 0) + (s.lateDeduction || 0) + (s.earlyDeduction || 0) + (s.otherDeduction || 0); }
    function dueOf(s) { return Math.max(0, PR().slipPayable(s) - (s.paid || 0)); }
    var tbl = EPAL.table({
      columns: [
        { key: 'empName', label: 'Employee', render: function (s) { return EPAL.people ? EPAL.people.linkify(s.empName, s.empId) : '<span class="strong">' + esc(s.empName) + '</span>'; } },
        { key: 'gross', label: 'Gross', num: true, money: true },
        { key: 'overtime', label: 'OT', num: true, render: function (s) { return s.overtime ? ui.money(s.overtime) : '—'; }, sortVal: function (s) { return s.overtime || 0; } },
        { key: 'bonus', label: 'Bonus', num: true, render: function (s) { return s.bonus ? ui.money(s.bonus) : '—'; }, sortVal: function (s) { return s.bonus || 0; } },
        { key: 'encashAmt', label: 'Encash', num: true, money: true },
        { key: 'adv', label: 'Advance', num: true, sortVal: advOf, render: function (s) { var v = advOf(s); return v ? '<span class="text-warn">' + ui.money(v) + '</span>' : '—'; } },
        { key: 'emi', label: 'Loan EMI', num: true, sortVal: emiOf, render: function (s) { var v = emiOf(s); return v ? '<span class="text-warn">' + ui.money(v) + '</span>' : '—'; } },
        { key: 'absentDeduction', label: 'Absent', num: true, sortVal: function (s) { return s.absentDeduction || 0; }, render: function (s) { return s.absentDeduction ? '<span class="text-bad">' + ui.money(s.absentDeduction) + '</span>' : '—'; } },
        { key: 'other', label: 'Other Ded.', num: true, sortVal: otherOf, render: function (s) { var v = otherOf(s); return v ? ui.money(v) : '—'; } },
        { key: 'net', label: 'Net Payable', num: true, sortVal: function (s) { return PR().slipPayable(s); }, render: function (s) { return '<span class="num strong">' + ui.money(PR().slipPayable(s)) + '</span>'; } },
        { key: 'paid', label: 'Paid', num: true, sortVal: function (s) { return s.paid || 0; }, render: function (s) { return s.paid ? '<span class="text-good">' + ui.money(s.paid) + '</span>' : '—'; } },
        { key: 'due', label: 'Due', num: true, sortVal: dueOf, render: function (s) { var v = dueOf(s); return v ? '<span class="num strong text-bad">' + ui.money(v) + '</span>' : '—'; } },
        { key: 'status', label: 'Status', badge: { draft: '', accrued: 'info', partial: 'warn', due: 'bad', paid: 'good' } }
      ],
      rows: slips, searchKeys: ['empName', 'dept'], quickFilter: 'status', filterPanel: true, filters: [{ key: 'dept', label: 'Dept' }],
      totalKey: 'net',
      exportName: 'salary-sheet-' + ym + '.csv', pdfTitle: 'Salary Sheet — ' + PR().mLabel(ym),
      onRow: function (s) { var e = empById(s.empId); if (e) statement(e, ym); },
      actions: (canCreate() ? [{ icon: 'wallet2', title: 'Manage salary — pay / partial / due / advance / status', onClick: function (s) { manageSalary(s, ym); } }] : []).concat(ui.actions({
        // editing stays open even AFTER finalization (owner rule) — the engine
        // re-posts the accrual under its stable id so the books follow exactly.
        edit: canCreate() ? function (s) { correctionForm(s, ym); } : null,
        print: function (s) { var e = empById(s.empId); if (e) statementPrint(e, ym); }
      })),
      empty: { icon: 'cash-stack', title: 'No employees to pay' }
    });
    page.appendChild(el('div.card', null, [ el('div.card-head', null, [ el('h3', { html: ui.icon('cash-stack') + ' Salary Sheet — ' + PR().mLabel(ym) }), el('span.card-sub', { text: 'click a row = payslip · 💰 manage pay/due/status · ✎ adjust' }) ]), el('div.card-body', null, [ tbl.el ]) ]));

    if (st !== 'draft' && due > 0 && canCreate()) {
      var grid = el('div.grid-auto.kpi-compact');
      slips.forEach(function (s) { var payable = PR().slipPayable(s), out = payable - (s.paid || 0); if (out <= 0) return;
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
    var payable = PR().slipPayable(s), out = payable - (s.paid || 0);
    EPAL.formModal({ title: 'Pay — ' + s.empName, icon: 'cash-coin', size: 'sm', record: { amount: out, method: 'Bank' },
      fields: [ { key: 'amount', label: 'Amount (৳)', type: 'money', default: out, min: 0, max: out, hint: 'Outstanding ' + ui.money(out) + ' — pay less for a partial (rest becomes Due, shown on next month\'s payslip).' },
        { key: 'method', label: 'Method', type: 'select', options: ['Bank', 'Cash', 'bKash', 'Nagad', 'Rocket', 'Upay', 'Card', 'Cheque'], default: 'Bank' } ],
      saveLabel: 'Post Payment', onSave: function (v) { try { PR().pay(s.empId, ym, +v.amount, v.method); ui.toast('Payment posted', 'success'); EPAL.router.render(); return true; } catch (e) { ui.toast(e.message || 'Failed', 'error'); return false; } } });
  }

  /* ---- MANAGE SALARY — the one modal that answers "how do I pay / set the due /
   * handle the advance / flip Paid-Unpaid for this person this month". ------*/
  function manageSalary(s, ym) {
    var e = empById(s.empId); if (!e) { ui.toast('Employee not found', 'error'); return; }
    var run = PR().getRun(CID, ym), st = run ? run.status : 'draft';
    var payable = PR().slipPayable(s), out = Math.max(0, payable - (s.paid || 0));
    var advOut = PR().advanceOutstanding(e.id), arrears = PR().previousDue(e.id, ym);
    var body = el('div');
    var m = ui.modal({ title: 'Manage Salary — ' + s.empName + ' · ' + PR().mLabel(ym), icon: 'wallet2', size: 'md', body: body, footer: false });
    function act(label, icon2, kind, fn, hint) {
      return el('button.btn' + (kind || '.btn-outline'), { html: ui.icon(icon2) + ' ' + label, title: hint || '', onclick: fn });
    }
    body.appendChild(el('div.card', null, [ el('div.card-body', null, [
      el('div.flex.items-center.gap-2.flex-wrap.mb-2', null, [
        el('div.flex-1', null, [ el('div.fw-700', { html: EPAL.people ? EPAL.people.linkify(s.empName, s.empId) : esc(s.empName) }),
          el('div.text-mute.sm', { text: PR().mLabel(ym) + ' · run ' + cap(st) }) ]),
        el('span.badge.badge-' + (s.status === 'paid' ? 'good' : s.status === 'due' ? 'bad' : s.status === 'partial' ? 'warn' : 'info'), { text: cap(s.status) })
      ]),
      el('div.stat-row.mb-3', null, [
        el('div.stat', null, [el('div.stat-label', { text: 'Net payable' }), el('div.stat-value', { text: ui.money(payable) })]),
        el('div.stat', null, [el('div.stat-label', { text: 'Paid' }), el('div.stat-value', { text: ui.money(s.paid || 0) })]),
        el('div.stat', null, [el('div.stat-label', { text: 'Due (this month)' }), el('div.stat-value', { text: ui.money(out) })]),
        el('div.stat', null, [el('div.stat-label', { text: 'Advance out' }), el('div.stat-value', { text: ui.money(advOut) })]),
        arrears ? el('div.stat', null, [el('div.stat-label', { text: 'Past-months due' }), el('div.stat-value', { text: ui.money(arrears) })]) : null
      ].filter(Boolean)),
      st === 'draft' ? el('div.text-mute.sm.mb-2', { html: ui.icon('info-circle') + ' This month is still a <b>draft</b> — adjust freely, then <b>Finalize & Accrue</b> (top of the sheet) to unlock payment.' }) : null,
      el('div.flex.gap-1.flex-wrap', null, [
        (st !== 'draft' && out > 0) ? act('Pay… (partial allowed)', 'cash-coin', '.btn-primary', function () { m.close(); payForm(s, ym); }, 'Choose how much to pay now — the rest stays Due') : null,
        (st !== 'draft' && out > 0) ? act('Pay Full (' + ui.money(out) + ')', 'check2-circle', null, function () { try { PR().pay(s.empId, ym); ui.toast('Paid in full', 'success'); m.close(); EPAL.router.render(); } catch (x) { ui.toast(x.message || 'Failed', 'error'); } }) : null,
        (s.paid > 0) ? act('Mark Unpaid (undo payment)', 'arrow-counterclockwise', null, function () {
          ui.confirm({ title: 'Undo this month\'s payment?', text: ui.money(s.paid) + ' will be reversed in the books (cash restored, salary payable + advance/loan balances restored).', danger: true, confirmLabel: 'Mark Unpaid' })
            .then(function (ok) { if (!ok) return; PR().unpay(s.empId, ym); ui.toast('Payment reversed — status back to unpaid', 'success'); m.close(); EPAL.router.render(); }); }, 'Flips Paid → Unpaid with a clean reversal') : null,
        (st === 'draft') ? act('Adjust (absent/late/OT/bonus/deduction)', 'sliders', null, function () { m.close(); correctionForm(s, ym); }) : null,
        act('Give Advance', 'cash', null, function () { m.close(); moneyForm(e, 'advance'); }, 'Auto-deducts from the next payslip'),
        arrears > 0 && canCreate() ? act('Pay Arrears (' + ui.money(arrears) + ')', 'hourglass-split', null, function () {
          ui.confirm({ title: 'Pay all past-month dues?', text: ui.money(arrears) + ' across earlier months.', confirmLabel: 'Pay Arrears' })
            .then(function (ok) { if (!ok) return; PR().payArrears(e.id); ui.toast('Arrears paid', 'success'); m.close(); EPAL.router.render(); }); }) : null,
        act('Payslip', 'receipt', null, function () { m.close(); statement(e, ym); })
      ].filter(Boolean))
    ]) ]));
  }

  /* ---- PRINT SHEET with column MARKS — tick exactly what to print (e.g. untick
   * Leave Encashment) and the printed salary sheet shows only those columns. --*/
  function printSheetForm(slips, ym) {
    var COLS = [
      ['gross', 'Gross', function (s) { return s.gross; }],
      ['overtime', 'Overtime', function (s) { return s.overtime || 0; }],
      ['bonus', 'Bonus', function (s) { return s.bonus || 0; }],
      ['encash', 'Leave Encashment', function (s) { return s.encashAmt || 0; }],
      ['advance', 'Advance', function (s) { return (s.paid > 0) ? (s.advanceRecovered || 0) : Math.min(PR().advanceOutstanding(s.empId), Math.max(0, PR().slipPayable(s))); }],
      ['emi', 'Loan EMI', function (s) { return (s.paid > 0) ? (s.loanRecovered || 0) : PR().emiInstallment(s.empId); }],
      ['absent', 'Absent', function (s) { return s.absentDeduction || 0; }],
      ['other', 'Other Ded.', function (s) { return (s.tax || 0) + (s.pf || 0) + (s.lateDeduction || 0) + (s.earlyDeduction || 0) + (s.otherDeduction || 0); }],
      ['net', 'Net Payable', function (s) { return PR().slipPayable(s); }],
      ['paid', 'Paid', function (s) { return s.paid || 0; }],
      ['due', 'Due', function (s) { return Math.max(0, PR().slipPayable(s) - (s.paid || 0)); }],
      ['status', 'Status', function (s) { return cap(s.status || ''); }]
    ];
    var record = {}; COLS.forEach(function (c) { record['col_' + c[0]] = true; });
    EPAL.formModal({
      title: 'Print Salary Sheet — ' + PR().mLabel(ym), icon: 'printer', size: 'md', record: record,
      fields: [{ type: 'section', label: 'Tick the columns to print' }].concat(COLS.map(function (c) {
        return { key: 'col_' + c[0], label: c[1], type: 'checkbox', default: true };
      })),
      saveLabel: 'Print',
      onSave: function (v) {
        var chosen = COLS.filter(function (c) { return v['col_' + c[0]] !== false; });
        if (!chosen.length) { ui.toast('Tick at least one column', 'error'); return false; }
        var head2 = '<tr><th>Employee</th>' + chosen.map(function (c) { return '<th style="text-align:right">' + esc(c[1]) + '</th>'; }).join('') + '</tr>';
        var totals = {};
        var rows = slips.map(function (s) {
          return '<tr><td>' + esc(s.empName) + '</td>' + chosen.map(function (c) {
            var val = c[2](s);
            if (typeof val === 'number') { totals[c[0]] = (totals[c[0]] || 0) + val; return '<td style="text-align:right">' + ui.money(val) + '</td>'; }
            return '<td style="text-align:right">' + esc(String(val)) + '</td>';
          }).join('') + '</tr>';
        }).join('');
        var totRow = '<tr><th>Total</th>' + chosen.map(function (c) { return '<th style="text-align:right">' + (totals[c[0]] != null ? ui.money(totals[c[0]]) : '') + '</th>'; }).join('') + '</tr>';
        ui.printDoc({ title: 'Salary Sheet — ' + PR().mLabel(ym), subtitle: coShort(CID) + ' · Payroll', meta: slips.length + ' employees · generated ' + ui.date(today()), footer: 'System-generated salary sheet — Confidential',
          bodyHtml: '<table>' + head2 + rows + totRow + '</table>' });
        return true;
      }
    });
  }
  /* ---- edit-from-the-PAYSLIP hook: the kit's "Edit (OT · Bonus)" button lands
   * here — opens the full adjust form for that slip (draft months; finalized
   * months point to Reopen Draft). ------------------------------------------*/
  EPAL.payrollEdit = function (empId, ym) {
    var s = PR().slip(empId, ym);
    if (!s) { ui.toast('No payslip for that month', 'error'); return; }
    CID = s.companyId;
    correctionForm(s, ym);   // finalized months stay editable — the accrual re-posts
  };

  /* ---- EDIT SALARY (owner: "simple — every amount visible, auto-calculated but
   * I can change any figure"). Amount boxes come PRE-FILLED with the automatic
   * value; leave one untouched and it stays automatic (re-follows the counts),
   * type a different figure and THAT amount is used. ------------------------*/
  function correctionForm(s, ym) {
    var payableNow = PR().slipPayable(s);
    var pre = {   // what the form opens with — used to detect "did the owner touch it"
      absentAmt: s.absentDeduction || 0, lateAmt: s.lateDeduction || 0,
      earlyAmt: s.earlyDeduction || 0, otAmt: s.overtime || 0,
      advCap: (s.advCap != null && s.advCap !== '') ? +s.advCap : Math.min(PR().advanceOutstanding(s.empId), Math.max(0, payableNow)),
      emiCap: (s.emiCap != null && s.emiCap !== '') ? +s.emiCap : PR().emiInstallment(s.empId)
    };
    EPAL.formModal({ title: 'Edit Salary — ' + s.empName + ' · ' + PR().mLabel(ym), icon: 'sliders', size: 'md',
      record: { leaveDeductDays: s.leaveDeductDays || 0, lateDays: s.lateDays || 0, earlyDays: s.earlyDays || 0, overtimeHours: s.overtimeHours || 0,
        absentAmt: pre.absentAmt, lateAmt: pre.lateAmt, earlyAmt: pre.earlyAmt, otAmt: pre.otAmt,
        advCap: pre.advCap, emiCap: pre.emiCap,
        otherDeduction: s.otherDeduction || 0, bonus: s.bonus || 0, adjustment: s.adjustment || 0 },
      fields: [
        { type: 'section', label: 'Attendance counts (drive the automatic amounts)' },
        { key: 'leaveDeductDays', label: 'Absent days', type: 'number', min: 0, max: 30, default: 0 },
        { key: 'lateDays', label: 'Late count', type: 'number', min: 0, default: 0, hint: 'Every ' + (PR().template(CID).latesPerAbsent || 3) + ' lates = one day.' },
        { key: 'earlyDays', label: 'Early-leave count', type: 'number', min: 0, default: 0 },
        { key: 'overtimeHours', label: 'Overtime hours', type: 'number', min: 0, default: 0 },
        { type: 'section', label: 'Amounts (৳) — automatic; change any figure to override it' },
        { key: 'absentAmt', label: 'Absent deduction (৳)', type: 'money', min: 0, hint: s.absentOverride != null ? 'Currently overridden.' : 'Auto from absent days — edit to override.' },
        { key: 'lateAmt', label: 'Late deduction (৳)', type: 'money', min: 0, hint: s.lateOverride != null ? 'Currently overridden.' : 'Auto from late count.' },
        { key: 'earlyAmt', label: 'Early-leave deduction (৳)', type: 'money', min: 0 },
        { key: 'otAmt', label: 'Overtime pay (৳)', type: 'money', min: 0, hint: s.otOverride != null ? 'Currently overridden.' : 'Auto from OT hours × rate.' },
        { key: 'otherDeduction', label: 'Other deduction (৳)', type: 'money', min: 0, default: 0 },
        { key: 'bonus', label: 'Bonus (৳)', type: 'money', min: 0, default: 0 },
        { key: 'adjustment', label: 'Salary adjustment (± ৳)', type: 'number', default: 0, hint: 'Signed: positive adds, negative deducts.' },
        { type: 'section', label: 'Agreed pay-time deductions (auto — change what the company takes this month)' },
        { key: 'advCap', label: 'Advance to recover this month (৳)', type: 'money', min: 0, hint: 'Outstanding advance ' + ui.money(PR().advanceOutstanding(s.empId)) + ' — auto takes what fits.' },
        { key: 'emiCap', label: 'Loan EMI this month (৳)', type: 'money', min: 0, hint: 'Scheduled EMI ' + ui.money(PR().emiInstallment(s.empId)) + ' — edit what the company agrees to deduct.' }
      ],
      saveLabel: 'Apply',
      onSave: function (v) {
        // untouched amount box → stays automatic; changed → becomes the override
        function pick(entered, prefill, existingOvr) { return (+entered === +prefill) ? (existingOvr != null ? existingOvr : null) : +entered; }
        try {
          PR().adjustSlip(s.empId, ym, {
            leaveDeductDays: +v.leaveDeductDays, lateDays: +v.lateDays, earlyDays: +v.earlyDays, overtimeHours: +v.overtimeHours,
            absentOverride: pick(v.absentAmt, pre.absentAmt, s.absentOverride),
            lateOverride: pick(v.lateAmt, pre.lateAmt, s.lateOverride),
            earlyOverride: pick(v.earlyAmt, pre.earlyAmt, s.earlyOverride),
            otOverride: pick(v.otAmt, pre.otAmt, s.otOverride),
            advCap: pick(v.advCap, pre.advCap, s.advCap),
            emiCap: pick(v.emiCap, pre.emiCap, s.emiCap),
            otherDeduction: +v.otherDeduction, bonus: +v.bonus, adjustment: +v.adjustment
          });
          ui.toast('Salary updated', 'success'); EPAL.router.render(); return true;
        } catch (e) { ui.toast(e.message || 'Blocked', 'error'); return false; }
      } });
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
    // EMI DEDUCTION HISTORY — every automatic salary-time EMI, individually dated
    // (owner: "10,000 deducted as loan EMI at xyz date — history individually")
    var emis = txns.filter(function (x) { return x.type === 'loan-repay' && /EMI auto-deducted/.test(x.memo || ''); });
    if (emis.length) {
      var et = EPAL.table({
        columns: [
          { key: 'date', label: 'Deducted on', date: true },
          { key: 'empName', label: 'Employee', render: function (x) { return EPAL.people ? EPAL.people.linkify(x.empName, x.empId) : esc(x.empName); } },
          { key: 'memo', label: 'From which salary', render: function (x) { return esc(String(x.memo || '').replace('EMI auto-deducted from ', '')); } },
          { key: 'amount', label: 'EMI deducted', num: true, money: true }
        ],
        rows: emis, pageSize: 8, totalKey: 'amount', exportName: 'emi-history.csv', pdfTitle: 'Loan EMI Deduction History',
        empty: { icon: 'bank', title: 'No EMI deductions yet' }
      });
      page.appendChild(el('div.card', null, [ el('div.card-head', null, [ el('h3', { html: ui.icon('calendar2-check') + ' EMI Deduction History' }), el('span.card-sub', { text: 'auto-deducted from salary · dated individually' }) ]), el('div.card-body', null, [ et.el ]) ]));
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
        { key: 'empName', label: 'Employee', render: function (s) { return EPAL.people ? EPAL.people.linkify(s.empName, s.empId) : '<span class="strong">' + esc(s.empName) + '</span>'; } },
        { key: 'ym', label: 'Month', render: function (s) { return PR().mLabel(s.ym); } },
        { key: 'earnedGross', label: 'Gross', num: true, money: true },
        { key: 'net', label: 'Net', num: true, sortVal: function (s) { return PR().slipPayable(s); }, render: function (s) { return '<span class="num strong">' + ui.money(PR().slipPayable(s)) + '</span>'; } },
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

  /* ---- salary statement / payslip — the SHARED real-format implementation
   * (platform/kit/emp-profile.js). One payslip everywhere. ------------------*/
  function statement(e, ym) { if (EPAL.people) EPAL.people.statement(e, ym); }
  function statementPrint(e, ym) { if (EPAL.people) EPAL.people.payslipPrint(e, ym); }

  /* =================================================== PAYROLL REPORTS */
  function reportsView(page) {
    var t = team();
    var liability = PR().encashmentLiability(CID);
    var salaryDue = sum(t, function (e) { return PR().salaryDue(e.id); });
    var advOut = sum(t, function (e) { return PR().advanceOutstanding(e.id); });
    var loanOut = sum(t, function (e) { return PR().loanOutstanding(e.id); });

    page.appendChild(el('div.kpi-grid.kpi-compact.stagger', null, [
      kpi('Leave Encash Liability', ui.money(liability, { compact: true }), 'piggy-bank', 'text-warn'),
      kpi('Salary Due', ui.money(salaryDue, { compact: true }), 'hourglass-split', salaryDue > 0 ? 'text-bad' : 'text-good'),
      kpi('Advance Outstanding', ui.money(advOut, { compact: true }), 'cash'),
      kpi('Loan Outstanding', ui.money(loanOut, { compact: true }), 'bank')
    ]));

    // Leave Encashment Liability — the future obligation, with a pay-out action
    var encRows = t.map(function (e) { var ls = PR().leaveState(e); return { e: e, name: e.name, dept: e.dept, days: ls.encashableDays, value: ls.value, eligible: ls.eligibleFullYear }; }).filter(function (r) { return r.value > 0; });
    var encTbl = EPAL.table({
      columns: [
        { key: 'name', label: 'Employee', render: function (r) { return EPAL.people ? EPAL.people.linkify(r.name, r.e.id) : '<span class="strong">' + esc(r.name) + '</span>'; } },
        { key: 'dept', label: 'Dept', badge: {} },
        { key: 'days', label: 'Accrued days', num: true, sortVal: function (r) { return r.days; }, render: function (r) { return r.days.toFixed(2); } },
        { key: 'value', label: 'Value', num: true, money: true },
        { key: 'eligible', label: 'Eligibility', render: function (r) { return r.eligible ? '<span class="badge badge-good">Eligible</span>' : '<span class="badge badge-warn">Accruing</span>'; } }
      ],
      rows: encRows, pageSize: 10, exportName: 'leave-encashment-liability.csv', pdfTitle: 'Leave Encashment Liability',
      actions: ui.actions({ edit: canCreate() ? function (r) { payEncashFlow(r.e); } : null }),
      onRow: function (r) { statement(r.e, PR().curYm()); }, empty: { icon: 'piggy-bank', title: 'No accrued encashment' }
    });
    page.appendChild(reportCard('Leave Encashment Liability', 'piggy-bank', ui.money(liability) + ' total provision · ✎ to pay out & reset', encTbl.el));

    var dueRows = t.map(function (e) { return { id: e.id, name: e.name, dept: e.dept, amt: PR().salaryDue(e.id) }; }).filter(function (r) { return r.amt > 0; });
    if (dueRows.length) page.appendChild(reportCard('Salary Due', 'hourglass-split', dueRows.length + ' employees owed', simpleTbl(dueRows, 'Outstanding')));
    var advRows = t.map(function (e) { return { id: e.id, name: e.name, dept: e.dept, amt: PR().advanceOutstanding(e.id) }; }).filter(function (r) { return r.amt > 0; });
    if (advRows.length) page.appendChild(reportCard('Advance Register', 'cash', 'who holds advance now', simpleTbl(advRows, 'Advance held')));
    var loanRows = t.map(function (e) { return { id: e.id, name: e.name, dept: e.dept, amt: PR().loanOutstanding(e.id) }; }).filter(function (r) { return r.amt > 0; });
    if (loanRows.length) page.appendChild(reportCard('Loan Outstanding', 'bank', 'staff loans in progress', simpleTbl(loanRows, 'Loan balance')));

    var dc = PR().departmentCost(CID);
    var dcTbl = EPAL.table({
      columns: [ { key: 'dept', label: 'Department', render: function (r) { return '<span class="strong">' + esc(r.dept) + '</span>'; } },
        { key: 'heads', label: 'Headcount', num: true, render: function (r) { return String(t.filter(function (e) { return (e.dept || '—') === r.dept; }).length); } },
        { key: 'cost', label: 'Monthly Cost', num: true, money: true } ],
      rows: dc, pageSize: 10, exportName: 'department-cost.csv', empty: { icon: 'diagram-3', title: 'No data' }
    });
    page.appendChild(reportCard('Department Cost (monthly gross)', 'diagram-3', 'salary cost by department', dcTbl.el));

    var incRows = []; t.forEach(function (e) { (e.salaryHistory || []).forEach(function (h) { incRows.push({ name: e.name, date: h.date, from: h.from, to: h.to, by: h.by || '' }); }); });
    incRows.sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    if (incRows.length) {
      var incTbl = EPAL.table({
        columns: [ { key: 'date', label: 'Date', date: true }, { key: 'name', label: 'Employee' },
          { key: 'from', label: 'From', num: true, money: true }, { key: 'to', label: 'To', num: true, money: true },
          { key: 'change', label: 'Change', num: true, sortVal: function (r) { return (r.to || 0) - (r.from || 0); }, render: function (r) { var d = (r.to || 0) - (r.from || 0); return '<span class="num ' + (d >= 0 ? 'text-good' : 'text-bad') + '">' + (d >= 0 ? '+' : '') + ui.money(d) + '</span>'; } } ],
        rows: incRows, pageSize: 10, exportName: 'increment-history.csv', empty: { icon: 'graph-up-arrow', title: 'No increments' }
      });
      page.appendChild(reportCard('Increment History', 'graph-up-arrow', incRows.length + ' salary revisions', incTbl.el));
    }
  }
  function reportCard(title, icon, sub, node) { return el('div.card', null, [ el('div.card-head', null, [ el('h3', { html: ui.icon(icon) + ' ' + title }), el('span.card-sub', { text: sub }) ]), el('div.card-body', null, [ node ]) ]); }
  function simpleTbl(rows, label) {
    return EPAL.table({ columns: [ { key: 'name', label: 'Employee', render: function (r) { return EPAL.people ? EPAL.people.linkify(r.name, r.id || r.name) : '<span class="strong">' + esc(r.name) + '</span>'; } }, { key: 'dept', label: 'Dept', badge: {} }, { key: 'amt', label: label, num: true, money: true } ], rows: rows, pageSize: 8, empty: { icon: 'inbox', title: 'Nothing outstanding' } }).el;
  }
  function payEncashFlow(e) {
    var ls = PR().leaveState(e);
    ui.confirm({ title: 'Pay leave encashment — ' + e.name + '?', text: 'Pays ' + ls.encashableDays.toFixed(2) + ' accrued days = ' + ui.money(ls.value) + ' (DR Leave-Encash Payable / CR Bank) and resets the accrual.', confirmLabel: 'Pay Encashment' })
      .then(function (ok) { if (!ok) return; try { PR().payEncashment(e.id); ui.toast('Encashment paid', 'success'); EPAL.router.render(); } catch (x) { ui.toast(x.message || 'Failed', 'error'); } });
  }

  /* ---- small helpers ----------------------------------------------------*/
  function kpi(label, value, icon, tone) { return el('div.kpi-card', null, [ el('div.kpi-top', null, [ el('span.kpi-label', { text: label }), el('span.kpi-ico', { html: '<i class="bi bi-' + icon + '"></i>' }) ]), el('div.kpi-value' + (tone ? '.' + tone : ''), { text: String(value) }) ]); }
  function drow(k, v) { return el('div.data-row', null, [ el('div.text-mute.sm.flex-1', { text: k }), el('div.strong', { text: v == null || v === '' ? '—' : String(v) }) ]); }
  function card(text) { return el('div.card', null, [ el('div.card-body', { text: text }) ]); }

})(window.EPAL = window.EPAL || {});
