/* ============================================================================
 * EPAL GROUP ERP  ·  platform/kit/emp-profile.js
 * ----------------------------------------------------------------------------
 * UNIVERSAL EMPLOYEE PROFILE + PAYSLIP  (EPAL.people)
 *
 * ONE shared implementation of "click an employee's name → their full A-Z file",
 * used from EVERYWHERE an employee appears (Payroll, Accounts, HRM, dashboards):
 *
 *   EPAL.people.open(empId, opts?)      → the full profile modal:
 *        header (photo, designation, badges) · money stat-row (salary, net
 *        position, salary due, advance, loan, leave-encash balance) · personal &
 *        job details (NID, passport, DOB, blood, addresses, bank…) · salary
 *        structure · attendance (per-month store) · leave history · the ACCOUNTS
 *        LEDGER (every salary/advance/loan/bonus/settlement row with running
 *        net-due) · payslip history (click → payslip) · money actions
 *        (advance / loan / repay / bonus / pay-encashment / final settlement).
 *   EPAL.people.statement(empId, ym)    → the REAL payslip modal (group format):
 *        Payslip # · period · method · EARNINGS (basic/house/medical/conveyance/
 *        bonus/overtime → gross) · DEDUCTIONS (advance/loan/absent/late/early/
 *        tax/PF → total) · salary adjustment · NET PAYABLE + amount-in-words ·
 *        Leave-Encashment benefit block · paid/outstanding.
 *   EPAL.people.payslipPrint(empId, ym) → branded printable payslip.
 *   EPAL.people.linkify(name, empId)    → an <a>-style clickable name (HTML) for
 *        table cells; resolves by id OR exact name via EPAL.people.resolve().
 *
 * ==> LARAVEL: an EmployeeProfileController + a PayslipPdf service; every module
 *     deep-links to /employees/{id} the way views call EPAL.people.open here.
 * ==========================================================================*/

(function (EPAL) {
  'use strict';
  function ui() { return EPAL.ui; }
  function db() { return EPAL.db; }
  function S() { return EPAL.store; }
  function PR() { return EPAL.payroll; }
  function el() { return EPAL.ui.el.apply(null, arguments); }
  function esc(s) { return EPAL.ui.escapeHtml(String(s == null ? '' : s)); }
  function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }
  function money(v) { return EPAL.ui.money(v || 0); }
  function drow(k, v) { return el('div.data-row', null, [el('div.text-mute.sm.flex-1', { text: k }), el('div.strong', { text: v == null || v === '' ? '—' : String(v) })]); }
  function st2(l, v) { return el('div.stat', null, [el('div.stat-label', { text: l }), el('div.stat-value', { text: v })]); }
  function canPay(e) { return !EPAL.perm || EPAL.perm.can(e.companyId || 'travels', 'payroll', 'create'); }

  function resolve(idOrName) {
    if (!idOrName) return null;
    var emp = db().employee ? db().employee(idOrName) : null;
    if (emp) return emp;
    var all = S().list('employees');
    for (var i = 0; i < all.length; i++) if (all[i].name === idOrName) return all[i];
    return null;
  }

  /* ============================================== THE PAYSLIP (real format) */
  function statement(empIdOrEmp, ym) {
    var emp = typeof empIdOrEmp === 'object' ? empIdOrEmp : resolve(empIdOrEmp);
    if (!emp || !PR()) return;
    ym = ym || PR().curYm();
    var s = PR().statement(emp, ym);
    var body = el('div');
    ui().modal({ title: 'Payslip — ' + emp.name, icon: 'receipt', size: 'lg', body: body, footer: false });
    var le = s.leaveEncashment;
    function line(k, v, neg, strong) {
      return el('div.data-row', null, [el('div' + (strong ? '.strong' : '.text-mute.sm') + '.flex-1', { text: k }),
        el('div' + (strong ? '.strong' : ''), { text: (neg && v ? '−' : '') + money(v) })]);
    }
    body.appendChild(el('div.card', null, [el('div.card-body', null, [
      // header strip — like the printed payslip
      el('div.flex.items-center.gap-2.flex-wrap.mb-3', null, [
        el('div.flex-1', null, [
          el('div.fw-700', { style: { fontSize: '16px' }, html: esc(emp.name) + ' <span class="text-mute sm">· ' + esc(emp.designation || '') + '</span>' }),
          el('div.text-mute.sm', { text: 'Payslip #' + s.slipNo + ' · Period ' + ym + ' · ' + (s.payMethod || 'Bank') + ' · Generated ' + ui().date(s.generated) })
        ]),
        el('span.badge.badge-' + (s.status === 'paid' ? 'good' : s.status === 'due' ? 'bad' : s.status === 'partial' ? 'warn' : 'info'), { text: cap(s.status) }),
        el('button.btn.btn-sm.btn-outline', { html: ui().icon('person-badge') + ' Profile', onclick: function () { open(emp.id); } }),
        el('button.btn.btn-sm.btn-primary', { html: ui().icon('printer') + ' Print', onclick: function () { payslipPrint(emp, ym); } })
      ]),
      el('div.two-col', null, [
        el('div', null, [el('div.section-label.mt-0', { text: 'Earnings' }), el('div.data-list', null,
          s.earnings.map(function (x) { return line(x[0], x[1]); })
            .concat([line('Gross Earnings', s.grossEarnings, false, true)]))]),
        el('div', null, [el('div.section-label.mt-0', { text: 'Deductions' }), el('div.data-list', null,
          s.deductions.map(function (x) { return line(x[0], x[1], true); })
            .concat([line('Total Deductions', s.totalDeductions, true, true)]))])
      ]),
      s.adjustment ? el('div.data-list.mt-2', null, [line('Salary Adjustment', Math.abs(s.adjustment), s.adjustment < 0, true)]) : null,
      el('div.divider'),
      el('div.flex.justify-between.items-center.flex-wrap.gap-2', null, [
        el('div', null, [el('div.strong', { text: 'NET PAYABLE' }), el('div.text-mute.xs', { text: s.inWords })]),
        el('div.fw-700.text-accent', { style: { fontSize: '20px' }, text: money(s.netPayable) })
      ]),
      (s.paid || s.outstanding) ? el('div.data-list.mt-2', null, [
        s.paid ? line('Paid', s.paid) : null,
        s.outstanding ? el('div.data-row', null, [el('div.strong.flex-1', { text: 'Outstanding (Due)' }), el('div.strong.text-warn', { text: money(s.outstanding) })]) : null
      ].filter(Boolean)) : null,
      el('div.section-label', { text: 'Leave Encashment (annual benefit — 23 days)' }),
      el('div.data-list', null, [
        drow('Accrued this month', le.days.toFixed(2) + ' day · ' + money(le.amount)),
        drow('Balance to date', le.accruedDays.toFixed(2) + ' days · ' + money(le.accruedValue)),
        el('div.data-row', null, [el('div.text-mute.sm.flex-1', { text: 'Full-year eligibility' }),
          el('div', null, [le.eligible ? el('span.badge.badge-good', { text: 'Eligible — ' + le.fullYearDays + ' days (' + money(le.fullYearValue) + ')' }) : el('span.badge.badge-warn', { text: 'Accruing — not yet 1 year' })])])
      ])
    ].filter(Boolean))]));
  }

  /* ---- the PRINTED payslip — a faithful reproduction of the group's real
   * payslip layout (letterhead · Payslip # · employee/period grid · EARNINGS |
   * DEDUCTIONS side by side · Salary Adjustment · framed NET PAYABLE with amount
   * in words · note · signature blocks · timestamp). ------------------------*/
  var HQ = {
    addr: 'Feroza Tower, Level 9, 91/B Khilgaon Chowdhury Para, 1219 DIT Rd, Dhaka 1219',
    phone: '01901378620', email: 'epalgroup37@gmail.com'
  };
  function fmt2(v) { return (Math.round((+v || 0) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function payslipHtml(emp, ym) {
    var s = PR().statement(emp, ym);
    var group = (EPAL.config && EPAL.config.group && EPAL.config.group.name) || 'EPAL GROUP';
    function row(k, v, strong) {
      return '<tr' + (strong ? ' class="tot"' : '') + '><td>' + esc(k) + '</td><td class="num">' + fmt2(v) + '</td></tr>';
    }
    var earn = s.earnings.map(function (x) { return row(x[0], x[1]); }).join('') + row('Gross Earnings', s.grossEarnings, true);
    // deductions in the printed order; tax/PF/other only when present
    var dedList = s.deductions.filter(function (x, i) { return i < 5 || x[1] > 0; });
    var ded = dedList.map(function (x) { return row(x[0], x[1]); }).join('') + row('Total Deductions', s.totalDeductions, true);
    var ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
    return '<div class="sheet">' +
      '<div class="hdr">' +
        '<div class="logo">e</div>' +
        '<div class="co"><div class="con">' + esc(group.toUpperCase()) + '</div>' +
          '<div class="coa">' + esc(HQ.addr) + '</div>' +
          '<div class="coa">Phone: ' + esc(HQ.phone) + ' | Email: ' + esc(HQ.email) + '</div></div>' +
        '<div class="sno">Payslip #' + esc(s.slipNo) + '</div>' +
      '</div>' +
      '<table class="grid"><tr>' +
        '<td><div class="gl">EMPLOYEE NAME</div><div class="gv">' + esc(emp.name) + '</div></td>' +
        '<td><div class="gl">DESIGNATION</div><div class="gv">' + esc(emp.designation || '—') + '</div></td>' +
        '<td><div class="gl">EMPLOYEE ID</div><div class="gv">' + esc(emp.id || 'N/A') + '</div></td></tr>' +
        '<tr><td><div class="gl">PAY PERIOD</div><div class="gv">' + esc(ym.replace('-', '/')) + '</div></td>' +
        '<td><div class="gl">PAYMENT METHOD</div><div class="gv">' + esc((s.payMethod || 'Bank').toLowerCase()) + '</div></td>' +
        '<td><div class="gl">GENERATE DATE</div><div class="gv">' + esc(s.generated) + '</div></td></tr></table>' +
      '<table class="cols"><tr><td class="col">' +
        '<div class="sec">EARNINGS</div><table class="lines">' + earn + '</table>' +
      '</td><td class="col">' +
        '<div class="sec">DEDUCTIONS</div><table class="lines">' + ded + '</table>' +
      '</td></tr></table>' +
      '<div class="adj">Salary Adjustment : ' + fmt2(s.adjustment || 0) + '</div>' +
      '<div class="enc">Leave Encashment (Accrued: ' + s.leaveEncashment.accruedDays.toFixed(2) + ' days | ৳' + fmt2(s.leaveEncashment.accruedValue) + ')' + (s.leaveEncashment.eligible ? ' — Eligible ✓' : '') + '</div>' +
      '<div class="net"><div><div class="nl">NET PAYABLE AMOUNT</div><div class="nw">Amount In Words: ' + esc(s.inWords) + '</div></div>' +
        '<div class="na">BDT ' + fmt2(s.netPayable) + '</div></div>' +
      (s.outstanding ? '<div class="due">Outstanding (Due): BDT ' + fmt2(s.outstanding) + (s.paid ? ' · Paid: BDT ' + fmt2(s.paid) : '') + '</div>' : '') +
      '<div class="note">Note: No note available</div>' +
      '<table class="sig"><tr><td><div class="sigl"></div>Employee Signature</td><td><div class="sigl"></div>Authorized Signatory</td></tr></table>' +
      '<div class="ts">TIMESTAMP: ' + ts + '</div>' +
    '</div>';
  }
  var PAYSLIP_CSS =
    'body{font-family:Inter,Arial,sans-serif;color:#1c2434;margin:0;background:#fff;}' +
    '.sheet{max-width:780px;margin:0 auto;padding:38px 44px;}' +
    '.hdr{display:flex;align-items:flex-start;gap:14px;border-bottom:2.5px solid #1c2434;padding-bottom:14px;}' +
    '.logo{width:44px;height:44px;border-radius:50%;background:#0A2472;color:#fff;font-weight:800;font-size:24px;display:flex;align-items:center;justify-content:center;font-family:Georgia,serif;}' +
    '.co{flex:1;text-align:center;}.con{font-size:21px;font-weight:800;letter-spacing:.02em;}' +
    '.coa{font-size:10.5px;color:#6a7387;margin-top:2px;}' +
    '.sno{font-size:12px;font-weight:700;white-space:nowrap;}' +
    '.grid{width:100%;border-collapse:collapse;margin:22px 0;}' +
    '.grid td{border:1px solid #e3e9f4;background:#f6f9fd;padding:9px 12px;width:33.3%;}' +
    '.gl{font-size:9px;color:#8a93a9;letter-spacing:.06em;}.gv{font-size:13px;font-weight:700;margin-top:2px;}' +
    '.cols{width:100%;border-collapse:collapse;}.col{width:50%;vertical-align:top;padding:0 14px 0 0;}.col+.col{padding:0 0 0 14px;}' +
    '.sec{font-size:12px;font-weight:800;letter-spacing:.03em;border-bottom:2px solid #1c2434;padding-bottom:6px;margin-bottom:2px;}' +
    '.lines{width:100%;border-collapse:collapse;}.lines td{padding:8px 2px;border-bottom:1px solid #edf1f8;font-size:12.5px;}' +
    '.lines .num{text-align:right;font-variant-numeric:tabular-nums;}' +
    '.lines .tot td{background:#f2f5fb;font-weight:800;}' +
    '.adj{text-align:center;font-weight:700;font-size:12.5px;margin:16px 0 6px;}' +
    '.enc{text-align:center;font-size:11px;color:#54607d;margin-bottom:12px;}' +
    '.net{display:flex;align-items:center;justify-content:space-between;border:2.5px solid #1c2434;padding:14px 18px;margin:6px 0 14px;}' +
    '.nl{font-weight:800;font-size:13px;}.nw{font-style:italic;font-size:10.5px;color:#54607d;margin-top:3px;}' +
    '.na{font-size:22px;font-weight:800;color:#1A43BF;white-space:nowrap;font-variant-numeric:tabular-nums;}' +
    '.due{font-size:11.5px;font-weight:700;color:#b3261e;margin:-6px 0 10px;}' +
    '.note{font-size:10.5px;color:#8a93a9;margin:16px 0 34px;}' +
    '.sig{width:100%;border-collapse:collapse;margin-bottom:26px;}.sig td{width:50%;text-align:center;font-weight:700;font-size:12px;padding:0 40px;}' +
    '.sigl{border-top:1.5px solid #1c2434;margin:0 10px 8px;}' +
    '.ts{font-size:9.5px;color:#9aa3b8;}' +
    '@media print{.sheet{padding:18px 10px;}}';
  function payslipPrint(empIdOrEmp, ym) {
    var emp = typeof empIdOrEmp === 'object' ? empIdOrEmp : resolve(empIdOrEmp);
    if (!emp || !PR()) return;
    ym = ym || PR().curYm();
    var w = window.open('', '_blank', 'width=840,height=1060');
    if (!w) { ui().toast('Allow pop-ups to print', 'warn'); return; }
    w.document.write('<html><head><title>Payslip — ' + esc(emp.name) + '</title><style>' + PAYSLIP_CSS + '</style></head><body>' + payslipHtml(emp, ym) + '</body></html>');
    w.document.close();
    setTimeout(function () { try { w.focus(); w.print(); } catch (e) {} }, 350);
  }

  /* ============================================== THE FULL A-Z PROFILE */
  function open(empIdOrEmp, opts) {
    opts = opts || {};
    var e = typeof empIdOrEmp === 'object' ? empIdOrEmp : resolve(empIdOrEmp);
    if (!e) { ui().toast('Employee not found', 'error'); return; }
    var body = el('div');
    var m = ui().modal({ title: e.name, icon: 'person-badge', size: 'lg', body: body, footer: false });
    var P = PR();

    // ---- header --------------------------------------------------------
    var av = e.photo
      ? '<span class="avatar" style="width:46px;height:46px;background-image:url(' + e.photo + ');background-size:cover;background-position:center"></span>'
      : '<span class="avatar" style="width:46px;height:46px;font-size:16px;background:' + ui().colorFor(e.name) + '">' + ui().initials(e.name) + '</span>';
    var actions = el('div.flex.gap-1.items-center.flex-wrap', { style: { marginLeft: 'auto' } });
    if (opts.onEdit) actions.appendChild(el('button.btn.btn-sm.btn-outline', { html: ui().icon('pencil') + ' Edit', onclick: function () { m.close(); opts.onEdit(e); } }));
    actions.appendChild(el('button.btn.btn-sm.btn-primary', { html: ui().icon('receipt') + ' Payslip', onclick: function () { statement(e, P ? P.curYm() : null); } }));
    body.appendChild(el('div.card', null, [el('div.card-body', null, [
      el('div.flex.items-center.gap-2.flex-wrap.mb-3', null, [
        ui().frag(av),
        el('div.flex-1', { style: { minWidth: '200px' } }, [
          el('div.fw-700', { style: { fontSize: '17px' }, text: e.name }),
          el('div.flex.items-center.gap-2.flex-wrap', null, [
            el('div.text-mute.sm', { text: (e.designation || '—') + ' · ' + (e.dept || '') + ' · ' + (e.companyId || '') }),
            el('span.badge', { text: e.empType || 'Permanent' }),
            el('span.badge.badge-' + (e.status === 'active' ? 'good' : e.status === 'resigned' ? 'bad' : 'warn'), { text: cap(e.status || 'active') })
          ])
        ]),
        actions
      ]),
      P ? (function () {
        var led = P.empLedger(e.id);
        var netDue = led.length ? led[led.length - 1].balance : 0;
        var ls = P.leaveState(e);
        return el('div.stat-row', null, [
          st2('Salary', money(e.salary)), st2(netDue >= 0 ? 'Company owes' : 'Employee owes', money(Math.abs(netDue))),
          st2('Salary due', money(P.salaryDue(e.id))), st2('Advance out', money(P.advanceOutstanding(e.id))),
          st2('Loan out', money(P.loanOutstanding(e.id))), st2('Leave encash', ls.encashableDays.toFixed(1) + 'd · ' + money(ls.value))
        ]);
      })() : null
    ].filter(Boolean))]));

    // ---- personal & job details (A-Z) -----------------------------------
    body.appendChild(el('div.card', null, [
      el('div.card-head', null, [el('h3', { html: ui().icon('person-vcard') + ' Employee Details' })]),
      el('div.card-body', null, [el('div.data-list', null, [
        drow('Employee ID', e.id), drow('Company', e.companyId), drow('Department', e.dept), drow('Designation', e.designation),
        drow('Employment type', e.empType || 'Permanent'), e.reportsTo ? drow('Reports to', e.reportsTo) : null,
        e.workLocation ? drow('Work location', e.workLocation) : null,
        drow('Join date', e.joinDate ? ui().date(e.joinDate) : '—'), e.confirmDate ? drow('Confirmed', ui().date(e.confirmDate)) : null,
        e.resignedDate ? drow('Resigned', ui().date(e.resignedDate)) : null,
        drow('Phone', e.phone), drow('Email', e.email), e.emergency ? drow('Emergency contact', e.emergency) : null,
        e.nid ? drow('NID', e.nid) : null, e.passport ? drow('Passport', e.passport) : null,
        e.dob ? drow('Date of birth', ui().date(e.dob)) : null, e.bloodGroup ? drow('Blood group', e.bloodGroup) : null,
        e.presentAddress ? drow('Present address', e.presentAddress) : null, e.permanentAddress ? drow('Permanent address', e.permanentAddress) : null,
        drow('Salary via', (e.salaryMethod || 'Bank') + (e.bankName ? ' · ' + e.bankName : '') + (e.bankAccount ? ' · ' + e.bankAccount : ''))
      ].filter(Boolean))])
    ]));

    if (!P) { return; }

    // ---- salary structure + increments ----------------------------------
    var c = P.computeSlip(e, P.curYm(), {});
    body.appendChild(el('div.card', null, [
      el('div.card-head', null, [el('h3', { html: ui().icon('cash-stack') + ' Salary Structure' })]),
      el('div.card-body', null, [el('div.data-list', null, [
        drow('Basic Salary', money(c.basic)), drow('House Rent Allowance', money(c.house)),
        drow('Medical Allowance', money(c.medical)), drow('Conveyance Allowance', money(c.transport)),
        el('div.data-row', null, [el('div.strong.flex-1', { text: 'Gross' }), el('div.strong', { text: money(c.gross) })])
      ].concat((e.salaryHistory || []).slice(-3).reverse().map(function (h) {
        return drow('Increment · ' + ui().date(h.date), money(h.from) + ' → ' + money(h.to));
      })))])
    ]));

    // ---- attendance (per-month) + leave ----------------------------------
    var ym = P.curYm();
    var att = P.attendanceFor(e.id, ym) || {};
    var lv = S().list('tv_leaves').filter(function (l) { return l.empId === e.id; });
    body.appendChild(el('div.card', null, [
      el('div.card-head', null, [el('h3', { html: ui().icon('calendar-check') + ' Attendance — ' + P.mLabel(ym) }),
        canPay(e) ? el('button.btn.btn-sm.btn-ghost', { style: { marginLeft: 'auto' }, html: ui().icon('pencil') + ' Record', onclick: function () { attendanceForm(e, ym); } }) : null].filter(Boolean)),
      el('div.card-body', null, [el('div.stat-row', null, [
        st2('Present', String(att.present || 0)), st2('Absent', String(att.absent || 0)),
        st2('Late', String(att.late || 0)), st2('Early leave', String(att.earlyLeave || 0)), st2('On leave', String(att.leave || 0))
      ]),
      lv.length ? el('div.text-mute.sm.mt-2', { text: lv.length + ' leave request(s) · ' + lv.reduce(function (a, l) { return a + (l.status === 'Approved' ? l.days : 0); }, 0) + ' approved days taken' }) : null].filter(Boolean))
    ]));

    // ---- ACCOUNTS — the personal money book ------------------------------
    var led = P.empLedger(e.id);
    var netDue2 = led.length ? led[led.length - 1].balance : 0;
    var accCard = el('div.card');
    accCard.appendChild(el('div.card-head', null, [
      el('h3', { html: ui().icon('journal-text') + ' Accounts — full transaction history' }),
      el('span.card-sub', { text: (netDue2 >= 0 ? 'company owes ' : 'employee owes ') + money(Math.abs(netDue2)) })
    ]));
    var accBody = el('div.card-body'); accCard.appendChild(accBody);
    if (canPay(e) && e.status !== 'resigned') accBody.appendChild(el('div.flex.gap-1.flex-wrap.mb-3', null, [
      el('button.btn.btn-sm.btn-outline', { html: ui().icon('cash') + ' Advance', onclick: function () { moneyForm(e, 'advance'); } }),
      el('button.btn.btn-sm.btn-outline', { html: ui().icon('bank') + ' Loan', onclick: function () { moneyForm(e, 'loan'); } }),
      P.loanOutstanding(e.id) > 0 ? el('button.btn.btn-sm.btn-outline', { html: ui().icon('arrow-return-left') + ' Repay Loan', onclick: function () { moneyForm(e, 'loan-repay'); } }) : null,
      el('button.btn.btn-sm.btn-outline', { html: ui().icon('gift') + ' Bonus', onclick: function () { moneyForm(e, 'bonus'); } }),
      P.leaveState(e).value > 0 ? el('button.btn.btn-sm.btn-ghost', { html: ui().icon('piggy-bank') + ' Pay Encashment', onclick: function () { payEncash(e); } }) : null,
      el('button.btn.btn-sm.btn-ghost.text-bad', { html: ui().icon('box-arrow-right') + ' Final Settlement', onclick: function () { settlement(e, m); } })
    ].filter(Boolean)));
    if (led.length) {
      accBody.appendChild(EPAL.table({
        columns: [
          { key: 'date', label: 'Date', date: true },
          { key: 'kind', label: 'Type', badge: { 'Salary earned': 'good', 'Leave encashment': 'info', 'Salary paid': '', 'Advance': 'warn', 'Loan': 'warn', 'Bonus': 'good', 'Final settlement': 'bad', 'Loan repaid': '' } },
          { key: 'memo', label: 'Detail' },
          { key: 'credit', label: 'Owed to emp', num: true, render: function (r) { return r.credit ? '<span class="num text-good">' + money(r.credit) + '</span>' : '—'; }, sortVal: function (r) { return r.credit; } },
          { key: 'debit', label: 'Paid / recovered', num: true, render: function (r) { return r.debit ? '<span class="num">' + money(r.debit) + '</span>' : '—'; }, sortVal: function (r) { return r.debit; } },
          { key: 'balance', label: 'Net due', num: true, render: function (r) { return '<span class="num strong ' + (r.balance >= 0 ? 'text-good' : 'text-bad') + '">' + money(r.balance) + '</span>'; }, sortVal: function (r) { return r.balance; } }
        ],
        rows: led, pageSize: 8, exportName: 'employee-ledger-' + e.id + '.csv', pdfTitle: 'Employee Statement — ' + e.name,
        empty: { icon: 'journal', title: 'No movements yet' }
      }).el);
    } else accBody.appendChild(el('div.text-mute.sm', { text: 'No salary movements yet.' }));
    body.appendChild(accCard);

    // ---- payslip history --------------------------------------------------
    var slips = S().list('pay_slips').filter(function (s) { return s.empId === e.id && s.status !== 'draft'; }).sort(function (a, b) { return a.ym < b.ym ? 1 : -1; });
    if (slips.length) {
      body.appendChild(el('div.card', null, [
        el('div.card-head', null, [el('h3', { html: ui().icon('receipt') + ' Payslip History' }), el('span.card-sub', { text: 'click for the payslip' })]),
        el('div.card-body', null, [EPAL.table({
          columns: [
            { key: 'ym', label: 'Month', render: function (s) { return '<span class="strong">' + P.mLabel(s.ym) + '</span>'; } },
            { key: 'net', label: 'Net', num: true, sortVal: function (s) { return P.slipPayable(s); }, render: function (s) { return '<span class="num strong">' + money(P.slipPayable(s)) + '</span>'; } },
            { key: 'paid', label: 'Paid', num: true, render: function (s) { return s.paid ? '<span class="text-good">' + money(s.paid) + '</span>' : '—'; }, sortVal: function (s) { return s.paid || 0; } },
            { key: 'status', label: 'Status', badge: { accrued: 'info', partial: 'warn', due: 'bad', paid: 'good' } }
          ],
          rows: slips, pageSize: 6, onRow: function (s) { statement(e, s.ym); },
          empty: { icon: 'receipt', title: 'No payslips' }
        }).el])
      ]));
    }
    if (EPAL.comments && EPAL.comments.widget) { body.appendChild(el('div.section-label', { text: 'Notes' })); body.appendChild(EPAL.comments.widget('employee', e.id)); }
  }

  /* ---- money forms (advance / loan / repay / bonus) ----------------------*/
  function moneyForm(e, type) {
    var P = PR();
    var meta = { advance: ['Give Advance Salary', 'cash'], loan: ['Give Staff Loan', 'bank'], 'loan-repay': ['Record Loan Repayment', 'arrow-return-left'], bonus: ['Record Bonus', 'gift'] }[type];
    EPAL.formModal({
      title: meta[0] + ' — ' + e.name, icon: meta[1], size: 'sm', record: { date: P.today(), method: 'Bank' },
      fields: [
        { key: 'amount', label: 'Amount (৳)', type: 'money', required: true, min: 0 },
        type === 'loan' ? { key: 'emiMonths', label: 'Repay over (months)', type: 'number', min: 0, default: 0, hint: '0 = manual repayment' } : null,
        { key: 'date', label: 'Date', type: 'date', default: P.today() },
        { key: 'method', label: 'Method', type: 'select', options: ['Bank', 'Cash', 'bKash', 'Cheque'], default: 'Bank' },
        { key: 'memo', label: 'Note', type: 'text' }
      ].filter(Boolean),
      saveLabel: meta[0],
      onSave: function (v) {
        var fn = { advance: P.advance, loan: P.loan, 'loan-repay': P.repayLoan, bonus: P.bonus }[type];
        try { fn(e.id, +v.amount, { date: v.date, method: v.method, memo: v.memo, emiMonths: +v.emiMonths || 0 }); ui().toast(meta[0] + ' recorded', 'success'); EPAL.router.render(); return true; } catch (x) { ui().toast(x.message || 'Failed', 'error'); return false; }
      }
    });
  }
  function payEncash(e) {
    var P = PR(), ls = P.leaveState(e);
    ui().confirm({ title: 'Pay leave encashment — ' + e.name + '?', text: ls.encashableDays.toFixed(2) + ' accrued days = ' + money(ls.value) + '. Pays out and resets the accrual.', confirmLabel: 'Pay Encashment' })
      .then(function (ok) { if (!ok) return; try { P.payEncashment(e.id); ui().toast('Encashment paid', 'success'); EPAL.router.render(); } catch (x) { ui().toast(x.message || 'Failed', 'error'); } });
  }
  function settlement(e, parentModal) {
    var P = PR(), p = P.settlementPreview(e), body = el('div');
    var m2 = ui().modal({ title: 'Final Settlement — ' + e.name, icon: 'box-arrow-right', size: 'md', body: body, footer: false });
    body.appendChild(el('div.card', null, [el('div.card-body', null, [
      el('div.data-list', null, [
        drow('Unpaid salary due', money(p.salaryDue)), drow('Last month salary', money(p.lastSalary)),
        drow('Leave encashment (' + p.encashDays.toFixed(1) + 'd)', money(p.encashValue)),
        drow('Less: advance outstanding', '−' + money(p.advanceOutstanding)), drow('Less: loan outstanding', '−' + money(p.loanOutstanding)),
        el('div.divider'),
        el('div.data-row', null, [el('div.strong.flex-1', { text: 'Net settlement' }), el('div.strong.text-good', { text: money(p.net) })])
      ]),
      el('div.flex.gap-1.justify-between.mt-3.flex-wrap', null, [
        el('button.btn.btn-ghost', { text: 'Cancel', onclick: function () { m2.close(); } }),
        el('button.btn.btn-primary.text-bad', { html: ui().icon('box-arrow-right') + ' Confirm Settlement', onclick: function () {
          try { P.settle(e.id); ui().toast('Settlement posted · ' + e.name + ' resigned', 'success'); m2.close(); if (parentModal) parentModal.close(); EPAL.router.render(); } catch (x) { ui().toast(x.message || 'Failed', 'error'); }
        } })
      ])
    ])]));
  }
  function attendanceForm(e, ym) {
    var P = PR(), a = P.attendanceFor(e.id, ym) || {};
    EPAL.formModal({
      title: 'Attendance — ' + e.name + ' · ' + P.mLabel(ym), icon: 'calendar-check', size: 'sm',
      record: { present: a.present || 0, absent: a.absent || 0, late: a.late || 0, earlyLeave: a.earlyLeave || 0, leave: a.leave || 0 },
      fields: [
        { key: 'present', label: 'Present days', type: 'number', min: 0, max: 31 },
        { key: 'absent', label: 'Absent days', type: 'number', min: 0, max: 31, hint: 'Auto-deducts (gross ÷ 30) × days on the payslip.' },
        { key: 'late', label: 'Late count', type: 'number', min: 0, hint: 'Every 3 lates deduct one day (template).' },
        { key: 'earlyLeave', label: 'Early-leave count', type: 'number', min: 0 },
        { key: 'leave', label: 'Approved leave days', type: 'number', min: 0 }
      ],
      saveLabel: 'Save Attendance',
      onSave: function (v) { P.saveAttendance(e.id, ym, v); ui().toast('Attendance saved & applied to the draft payslip', 'success'); EPAL.router.render(); return true; }
    });
  }

  /* ---- clickable name for table cells ------------------------------------*/
  function linkify(name, empId) {
    return '<span class="strong emp-link" data-emp="' + esc(empId || name) + '" style="cursor:pointer;text-decoration:underline dotted;text-underline-offset:3px">' + esc(name) + '</span>';
  }
  // one delegated listener makes every .emp-link live, wherever it renders
  document.addEventListener('click', function (ev) {
    var t = ev.target && ev.target.closest ? ev.target.closest('.emp-link') : null;
    if (!t) return;
    ev.stopPropagation(); ev.preventDefault();
    open(t.getAttribute('data-emp'));
  }, true);

  EPAL.people = { open: open, statement: statement, payslipPrint: payslipPrint, payslipHtml: payslipHtml, linkify: linkify, resolve: resolve, attendanceForm: attendanceForm };

})(window.EPAL = window.EPAL || {});
