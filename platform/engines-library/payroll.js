/* ============================================================================
 * EPAL GROUP ERP  ·  platform/engines-library/payroll.js
 * ----------------------------------------------------------------------------
 * PAYROLL & EMPLOYEE-ACCOUNTING ENGINE  (EPAL.payroll)
 *
 * The accounting heart of HR. It turns each employee into a real sub-ledger and
 * runs an ACCRUAL payroll that posts into the double-entry general ledger — so a
 * salary flows Employee → Company (Travels) → Group (by concern) with no manual
 * double entry. It never renders UI; the HRM view calls into it.
 *
 * WHAT IT MODELS (the owner's brief, Phase 1):
 *   · Per-employee accounts ledger — salary earned/paid, advances, loans, EMI,
 *     deductions, bonuses, leave encashment — with a running "net due" balance.
 *   · Statutory salary breakdown (basic/house/medical/transport + income-tax + PF)
 *     via an editable per-company TEMPLATE.
 *   · Monthly run lifecycle: generate → 1st–3rd CORRECTION window → finalize
 *     (accrue) → pay (full or partial) → auto-flag DUE after the 10th if unpaid.
 *   · Partial pay carries forward: pay 50% now → the other 50% stays owed and the
 *     employee is owed 150% next month (tracked as the Salary-Payable balance).
 *   · Leave encashment: 23 paid days/yr ACCRUED at 23/12 = 1.92 days/month, valued
 *     at (gross ÷ working-days). A monthly liability builds; a "Leave Encashment"
 *     row + eligibility show on the statement; full 23 days become payable at one
 *     completed year; on resignation the accrued proportion + last salary settle.
 *
 * ACCOUNTING MODEL (all balanced, tagged companyId + party=empId so it consolidates
 * per concern and drives a per-employee party sub-ledger):
 *   Salary accrual (finalize a month), per head:
 *       DR 5100 Salaries            earnedGross
 *          CR 2120 Tax Payable            tax
 *          CR 2110 PF Payable             pf
 *          CR 2100 Salary Payable         net (= earnedGross − tax − pf)
 *   Leave-encashment accrual (finalize), per head:
 *       DR 5150 Leave Encashment    encashAmt   /  CR 2150 Leave-Encash Payable
 *   Salary payment (full or partial):
 *       DR 2100 Salary Payable      amount
 *          CR 1250 Employee Advances      advanceRecovered
 *          CR 1010 Bank                   cash (= amount − advanceRecovered)
 *   Advance given:   DR 1250 Employee Advances / CR 1010 Bank
 *   Loan given:      DR 1260 Staff Loans / CR 1010 Bank
 *   Loan repayment:  DR 1010 Bank / CR 1260 Staff Loans
 *   Bonus:           DR 5100 Salaries / CR 1010 Bank
 *   Resignation settlement:
 *       DR 2100 Salary Payable + DR 2150 Leave-Encash Payable
 *          CR 1250 Advances (out) + CR 1260 Loans (out) + CR 1010 Bank (net)
 *
 * NEW CHART-OF-ACCOUNTS codes ensured on seed (added beside the ledger's COA):
 *   1250 Employee Advances · 1260 Staff Loans Receivable · 2100 Salary Payable
 *   2110 Provident Fund Payable · 2120 Tax Payable · 2150 Leave Encashment Payable
 *   5150 Leave Encashment (expense)   (5100 Salaries already exists)
 *
 * STORES (localStorage via EPAL.store, ns epal.v1.):
 *   pay_templates  per-company salary template (component %s, tax, PF, leave rule)
 *   pay_runs       one record per company-month  {status, correctionUntil, dueAfter}
 *   pay_slips      one payslip per employee-month {earnings, deductions, paid, status}
 *   pay_txns       advances / loans / repayments / bonuses / settlements
 *
 * ==> LARAVEL: a PayrollServiceProvider. Template→salary_templates; run→payroll_runs;
 *     slip→payslips; txns→employee_ledger. finalize()/pay() call a LedgerService that
 *     posts balanced journal_entries; a scheduled command runs auto-Due after the 10th.
 * ==========================================================================*/

(function (EPAL) {
  'use strict';

  var S = EPAL.store, bus = EPAL.bus;
  function L() { return EPAL.ledger; }                 // resolved lazily — ledger boots first
  function db() { return EPAL.db; }

  // Demo clock — the whole app runs on a fixed "today" so figures are stable.
  // The real backend uses now(); every date-gated rule reads through these.
  var NOW = '2026-07-05';
  function today() { return NOW; }
  function ymOf(d) { return String(d).slice(0, 7); }
  function curYm() { return ymOf(today()); }
  function round(n) { return Math.round(+n || 0); }
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  /* ------------------------------------------------------------- templates */
  // The default statutory template. leaveDaysPerYear/workingDays drive encashment.
  function defaultTemplate(companyId) {
    return {
      id: 'TPL-' + companyId, companyId: companyId, name: 'Standard (statutory)',
      basicPct: 0.60, housePct: 0.25, medicalPct: 0.10,   // transport = remainder
      taxThreshold: 50000, taxPct: 0.05,                  // 5% income tax above threshold
      pfPct: 0.10,                                        // provident fund = 10% of basic
      overtimeRate: 0,                                    // ৳/hour; 0 = auto (1.5× the hourly rate)
      latesPerAbsent: 3,                                  // every N lates deduct one day
      leaveDaysPerYear: 23, workingDays: 30, payByDay: 10, correctionDay: 3
    };
  }
  function template(companyId) {
    var all = S.list('pay_templates');
    for (var i = 0; i < all.length; i++) if (all[i].companyId === companyId) return all[i];
    var t = defaultTemplate(companyId); S.upsert('pay_templates', t); return t;
  }
  function saveTemplate(t) { S.upsert('pay_templates', t); bus.emit('data:changed', { store: 'pay_templates' }); return t; }

  /* --------------------------------------------------------- computation */
  // Pure payslip maths for one employee in one month, matching the group's real
  // payslip format: salary COMPONENTS are shown on the FULL gross; Absent / Late /
  // Early-leave are money DEDUCTION lines; a signed Salary Adjustment closes gaps.
  // `adj` carries correction-window edits + attendance:
  //   { leaveDeductDays(absent), lateDays, earlyDays, overtimeHours, otherDeduction,
  //     bonus, adjustment }
  // AMOUNT OVERRIDES (owner: "deduction is automatic, but I can change the amount"):
  //   absentOverride / lateOverride / earlyOverride / otOverride — when set (৳),
  //   that figure REPLACES the auto-calculated one; null/blank = stay automatic.
  function ovr(v, auto) { return (v == null || v === '' || isNaN(+v)) ? auto : round(+v); }
  function keepOvr(v) { return (v == null || v === '' || isNaN(+v)) ? null : round(+v); }
  function computeSlip(emp, ym, adj) {
    adj = adj || {};
    var t = template(emp.companyId || 'travels');
    var gross = +emp.salary || 0;
    var wd = t.workingDays || 30;
    var perDayF = gross / wd;
    // absent / unpaid-leave — full days deducted at the daily rate (or the override)
    var absentDays = clamp(+adj.leaveDeductDays || 0, 0, wd);
    var absentDeduction = ovr(adj.absentOverride, round(perDayF * absentDays));
    var workedDays = wd - absentDays;
    var earnedGross = gross - absentDeduction;
    // late & early-leave — every `latesPerAbsent` (default 3) counts as one day
    var lpa = t.latesPerAbsent > 0 ? t.latesPerAbsent : 3;
    var lateDays = Math.max(0, +adj.lateDays || 0);
    var earlyDays = Math.max(0, +adj.earlyDays || 0);
    var lateDeduction = ovr(adj.lateOverride, round(perDayF * lateDays / lpa));
    var earlyDeduction = ovr(adj.earlyOverride, round(perDayF * earlyDays / lpa));
    // components presented on the FULL gross (the payslip shows the structure,
    // absences are separate deduction lines)
    var basic = round(gross * t.basicPct);
    var house = round(gross * t.housePct);
    var medical = round(gross * t.medicalPct);
    var transport = gross - basic - house - medical;
    var tax = earnedGross > t.taxThreshold ? round(earnedGross * t.taxPct) : 0;
    var pf = round(basic * t.pfPct);
    var otherDeduction = round(+adj.otherDeduction || 0);
    // eligibility marks: overtime/bonus only count for employees flagged eligible
    // (emp.otEligible / emp.bonusEligible — default true when unset)
    var bonus = (emp.bonusEligible === false) ? 0 : round(+adj.bonus || 0);
    var adjustment = round(+adj.adjustment || 0);            // signed: + adds, − deducts
    var otHours = (emp.otEligible === false) ? 0 : Math.max(0, +adj.overtimeHours || 0);
    var otRate = (t.overtimeRate > 0) ? t.overtimeRate : Math.round((gross / wd / 8) * 1.5);   // default 1.5× the hourly rate
    var overtime = (emp.otEligible === false) ? 0 : ovr(adj.otOverride, round(otHours * otRate));
    var net = gross + overtime + bonus + adjustment
            - absentDeduction - lateDeduction - earlyDeduction - tax - pf - otherDeduction;
    var encashDays = (t.leaveDaysPerYear || 23) / 12;        // 1.92
    var encashAmt = round(encashDays * perDayF);
    return {
      gross: gross, earnedGross: earnedGross, workedDays: workedDays, leaveDeductDays: absentDays,
      absentDeduction: absentDeduction, lateDays: lateDays, lateDeduction: lateDeduction,
      earlyDays: earlyDays, earlyDeduction: earlyDeduction, adjustment: adjustment,
      absentOverride: keepOvr(adj.absentOverride), lateOverride: keepOvr(adj.lateOverride),
      earlyOverride: keepOvr(adj.earlyOverride), otOverride: keepOvr(adj.otOverride),
      basic: basic, house: house, medical: medical, transport: transport,
      tax: tax, pf: pf, otherDeduction: otherDeduction, bonus: bonus, overtimeHours: otHours, overtime: overtime,
      net: net, encashDays: encashDays, perDay: round(perDayF), encashAmt: encashAmt
    };
  }
  // The single source of truth for the net owed to an employee for a month.
  // Old slips (no late/early/adjustment fields) compute identically since the new
  // fields default to 0 and earnedGross === gross − absentDeduction.
  function slipPayable(s) {
    return round((s.earnedGross || 0) + (s.overtime || 0) + (s.bonus || 0) + (s.adjustment || 0)
      - (s.tax || 0) - (s.pf || 0) - (s.otherDeduction || 0) - (s.lateDeduction || 0) - (s.earlyDeduction || 0));
  }
  // Amount in words (Bangladeshi numbering: crore / lakh / thousand) for payslips.
  var W1 = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  var W10 = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  function two(n) { return n < 20 ? W1[n] : (W10[Math.floor(n / 10)] + (n % 10 ? ' ' + W1[n % 10] : '')); }
  function three(n) { return (n >= 100 ? W1[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' : '') : '') + (n % 100 ? two(n % 100) : ''); }
  function amountInWords(n) {
    n = Math.round(Math.abs(+n || 0));
    if (!n) return 'Zero Taka Only';
    var parts = [];
    var crore = Math.floor(n / 10000000); n %= 10000000;
    var lakh = Math.floor(n / 100000); n %= 100000;
    var thousand = Math.floor(n / 1000); n %= 1000;
    if (crore) parts.push(three(crore) + ' Crore');
    if (lakh) parts.push(two(lakh) + ' Lakh');
    if (thousand) parts.push(two(thousand) + ' Thousand');
    if (n) parts.push(three(n));
    return parts.join(' ') + ' Taka Only';
  }

  /* --------------------------------------------------------------- runs */
  function runId(cid, ym) { return 'PR-' + cid + '-' + ym; }
  function slipId(empId, ym) { return 'PS-' + empId + '-' + ym; }
  function getRun(cid, ym) { return S.list('pay_runs').filter(function (r) { return r.id === runId(cid, ym); })[0] || null; }
  function slipsFor(cid, ym) { return S.list('pay_slips').filter(function (s) { return s.companyId === cid && s.ym === ym; }); }
  function slip(empId, ym) { return S.list('pay_slips').filter(function (s) { return s.id === slipId(empId, ym); })[0] || null; }

  function activeTeam(cid) {
    var all = (db() && db().employees) ? db().employees({ companyId: cid }) : S.list('employees').filter(function (e) { return e.companyId === cid; });
    return all.filter(function (e) { return e.status !== 'resigned'; });
  }

  /* ------------------------------------------------ per-month attendance */
  // One record per employee per month: {id, empId, companyId, ym, present, absent,
  // late, earlyLeave, leave}. Feeds payroll auto-deduction (absent days + lates).
  function attId(empId, ym) { return 'AT-' + empId + '-' + ym; }
  function attendanceFor(empId, ym) { return S.list('att_monthly').filter(function (a) { return a.id === attId(empId, ym); })[0] || null; }
  function saveAttendance(empId, ym, rec) {
    var e = db().employee ? db().employee(empId) : null;
    var a = attendanceFor(empId, ym) || { id: attId(empId, ym), empId: empId, companyId: (e && e.companyId) || 'travels', ym: ym };
    ['present', 'absent', 'late', 'earlyLeave', 'leave'].forEach(function (k) { if (rec[k] != null) a[k] = Math.max(0, +rec[k] || 0); });
    S.upsert('att_monthly', a); bus.emit('data:changed', { store: 'att_monthly' });
    // re-apply onto the month's draft slip immediately (if still correctable)
    var s = slip(empId, ym), run = s && getRun(s.companyId, ym);
    if (s && run && run.status === 'draft') { try { adjustSlip(empId, ym, { leaveDeductDays: a.absent || 0, lateDays: a.late || 0, earlyDays: a.earlyLeave || 0, otherDeduction: s.otherDeduction, bonus: s.bonus, overtimeHours: s.overtimeHours, adjustment: s.adjustment, absentOverride: s.absentOverride, lateOverride: s.lateOverride, earlyOverride: s.earlyOverride, otOverride: s.otOverride }); } catch (x) {} }
    return a;
  }

  // Create/refresh DRAFT payslips for a month (idempotent; keeps existing correction adj;
  // auto-applies the month's attendance record on first generation).
  function generate(cid, ym) {
    var run = getRun(cid, ym);
    if (!run) {
      run = { id: runId(cid, ym), companyId: cid, ym: ym, status: 'draft', generatedAt: today(),
        correctionUntil: ym + '-' + String(template(cid).correctionDay || 3).padStart(2, '0'),
        dueAfter: ym + '-' + String(template(cid).payByDay || 10).padStart(2, '0') };
      S.upsert('pay_runs', run);
    }
    var seq = slipsFor(cid, ym).length;
    activeTeam(cid).forEach(function (e) {
      var existing = slip(e.id, ym);
      var att = attendanceFor(e.id, ym);
      var adj = existing
        ? { leaveDeductDays: existing.leaveDeductDays, lateDays: existing.lateDays, earlyDays: existing.earlyDays,
            otherDeduction: existing.otherDeduction, bonus: existing.bonus, overtimeHours: existing.overtimeHours, adjustment: existing.adjustment,
            absentOverride: existing.absentOverride, lateOverride: existing.lateOverride, earlyOverride: existing.earlyOverride, otOverride: existing.otOverride }
        : (att ? { leaveDeductDays: att.absent || 0, lateDays: att.late || 0, earlyDays: att.earlyLeave || 0 } : {});
      var c = computeSlip(e, ym, adj);
      var s = existing || { id: slipId(e.id, ym), runId: run.id, empId: e.id, companyId: cid, ym: ym, paid: 0, advanceRecovered: 0, loanRecovered: 0, status: 'draft', slipNo: ym + '-' + String(++seq).padStart(3, '0') };
      if (!s.slipNo) s.slipNo = ym + '-' + String(++seq).padStart(3, '0');
      s.empName = e.name; s.dept = e.dept;
      // copy computed figures onto the slip
      ['gross', 'earnedGross', 'workedDays', 'leaveDeductDays', 'absentDeduction', 'lateDays', 'lateDeduction',
        'earlyDays', 'earlyDeduction', 'adjustment', 'absentOverride', 'lateOverride', 'earlyOverride', 'otOverride',
        'basic', 'house', 'medical', 'transport',
        'tax', 'pf', 'otherDeduction', 'bonus', 'overtimeHours', 'overtime', 'net', 'encashDays', 'perDay', 'encashAmt'].forEach(function (k) { s[k] = c[k]; });
      S.upsert('pay_slips', s);
    });
    bus.emit('data:changed', { store: 'pay_slips' });
    return getRun(cid, ym);
  }

  // Correction window (1st–3rd): edit a draft slip's leave-deduction / deduction / bonus.
  function inCorrectionWindow(cid, ym) {
    var run = getRun(cid, ym); if (!run) return true;
    return run.status === 'draft' && today() <= run.correctionUntil;
  }
  function adjustSlip(empId, ym, adj) {
    var s = slip(empId, ym); if (!s) return null;
    var run = getRun(s.companyId, ym);
    if (run && run.status !== 'draft') throw new Error('Payroll for ' + ym + ' is finalized — corrections are closed.');
    var emp = db().employee ? db().employee(empId) : { id: empId, salary: s.gross, companyId: s.companyId };
    var c = computeSlip(emp, ym, adj);
    ['leaveDeductDays', 'absentDeduction', 'lateDays', 'lateDeduction', 'earlyDays', 'earlyDeduction', 'adjustment',
      'absentOverride', 'lateOverride', 'earlyOverride', 'otOverride',
      'otherDeduction', 'bonus', 'overtimeHours', 'overtime', 'earnedGross', 'workedDays', 'basic', 'house', 'medical', 'transport', 'tax', 'pf', 'net'].forEach(function (k) { s[k] = c[k]; });
    // agreed pay-time deductions (auto when null): how much advance / loan EMI
    // the company takes out of THIS month's payment
    if ('advCap' in adj) s.advCap = keepOvr(adj.advCap);
    if ('emiCap' in adj) s.emiCap = keepOvr(adj.emiCap);
    S.upsert('pay_slips', s); bus.emit('data:changed', { store: 'pay_slips' });
    return s;
  }

  // Finalize: lock the run and ACCRUE every payslip into the GL (idempotent per head).
  function finalize(cid, ym) {
    var run = generate(cid, ym);
    if (run.status !== 'draft') return run;
    slipsFor(cid, ym).forEach(function (s) {
      // salary accrual — DR 5100 (earned + OT + bonus ± positive adjustment) /
      // CR 2120 tax, 2110 pf, 4900 (other/late/early deductions recovered, and a
      // negative adjustment), 2100 net payable. Always balances by construction:
      // payable = earned + OT + bonus + adj − tax − pf − other − late − early.
      var adjPos = Math.max(0, s.adjustment || 0), adjNeg = Math.max(0, -(s.adjustment || 0));
      var recovered = (s.otherDeduction || 0) + (s.lateDeduction || 0) + (s.earlyDeduction || 0) + adjNeg;
      var expense = (s.earnedGross || 0) + (s.overtime || 0) + (s.bonus || 0) + adjPos;
      var payable = slipPayable(s);
      var lines = [{ account: '5100', dr: expense, cr: 0 }];
      if (s.tax) lines.push({ account: '2120', dr: 0, cr: s.tax });
      if (s.pf) lines.push({ account: '2110', dr: 0, cr: s.pf });
      if (recovered) lines.push({ account: '4900', dr: 0, cr: recovered });
      lines.push({ account: '2100', dr: 0, cr: payable });
      glPost('GL-PAYA-' + s.empId + '-' + ym, ym + '-01', cid, 'PAY-' + ym, 'Salary accrual · ' + s.empName + ' · ' + ym, 'payroll', s.empId, lines);
      // leave-encashment accrual — DR 5150 / CR 2150
      if (s.encashAmt > 0) glPost('GL-ENC-' + s.empId + '-' + ym, ym + '-01', cid, 'ENC-' + ym, 'Leave encashment accrual · ' + s.empName + ' · ' + ym, 'payroll', s.empId,
        [{ account: '5150', dr: s.encashAmt, cr: 0 }, { account: '2150', dr: 0, cr: s.encashAmt }]);
      s.status = s.paid >= payable ? 'paid' : (s.paid > 0 ? 'partial' : 'accrued');
      S.upsert('pay_slips', s);
    });
    run.status = 'finalized'; run.finalizedAt = today(); S.upsert('pay_runs', run);
    bus.emit('data:changed', { store: 'pay_runs' });
    return run;
  }

  // Walk a month back to BEFORE-ACCRUED (owner demos this lifecycle repeatedly):
  // 1) reverse any payments (unpay), 2) lift the accrual entries out of the books
  // (they use STABLE ids, so re-finalize re-posts the very same entries — the
  // cycle is repeatable any number of times), 3) run + slips back to draft, with
  // ✎ adjustments re-enabled.
  function unfinalize(cid, ym) {
    var run = getRun(cid, ym);
    if (!run || run.status === 'draft') return run;
    slipsFor(cid, ym).forEach(function (s) {
      if (s.paid > 0) { unpay(s.empId, ym); s = slip(s.empId, ym) || s; }   // re-fetch: unpay rewrote the record
      try {
        if (EPAL.ledger && EPAL.ledger.remove) {
          EPAL.ledger.remove('GL-PAYA-' + s.empId + '-' + ym);
          EPAL.ledger.remove('GL-ENC-' + s.empId + '-' + ym);
        }
      } catch (e) {}
      s.status = 'draft'; S.upsert('pay_slips', s);
    });
    run.status = 'draft'; run.finalizedAt = null; S.upsert('pay_runs', run);
    bus.emit('data:changed', { store: 'pay_runs' });
    return run;
  }

  // Pay a slip (full by default, or a partial `amount`). Recovers outstanding advance first.
  function pay(empId, ym, amount, method) {
    var s = slip(empId, ym); if (!s) throw new Error('No payslip for ' + empId + ' ' + ym);
    var run = getRun(s.companyId, ym);
    if (!run || run.status === 'draft') throw new Error('Finalize the payroll before paying.');
    var payable = slipPayable(s);
    var outstanding = payable - (s.paid || 0);
    var amt = amount == null ? outstanding : clamp(round(amount), 0, outstanding);
    if (amt <= 0) return s;
    // AUTO deductions, but the company decides how much it agrees to take this
    // month: slip.advCap / slip.emiCap (set in Edit Salary) override the autos.
    var advOut = advanceOutstanding(empId);
    var advWant = (s.advCap == null || s.advCap === '') ? advOut : Math.min(advOut, round(+s.advCap));
    var emiWant = (s.emiCap == null || s.emiCap === '') ? emiInstallment(empId) : round(+s.emiCap);
    var recover = clamp(advWant, 0, amt);                // agreed advance recovery out of this pay
    var emiRecover = clamp(emiWant, 0, amt - recover);   // agreed loan EMI installment
    var cash = amt - recover - emiRecover;
    var lines = [{ account: '2100', dr: amt, cr: 0 }];
    if (recover > 0) lines.push({ account: '1250', dr: 0, cr: recover });
    if (emiRecover > 0) lines.push({ account: '1260', dr: 0, cr: emiRecover });   // reduce the staff loan
    lines.push({ account: '1010', dr: 0, cr: cash });
    glPost('GL-PAYP-' + s.empId + '-' + ym + '-' + ((s.payCount || 0) + 1), today(), s.companyId, 'PAY-' + ym, 'Salary paid · ' + s.empName + ' · ' + ym, 'payroll', s.empId, lines);
    if (emiRecover > 0) txn({ type: 'loan-repay', empId: empId, empName: s.empName, companyId: s.companyId, date: today(), amount: emiRecover, memo: 'EMI auto-deducted from ' + mLabel(ym) + ' salary' });
    s.paid = (s.paid || 0) + amt; s.advanceRecovered = (s.advanceRecovered || 0) + recover; s.loanRecovered = (s.loanRecovered || 0) + emiRecover;
    s.payMethod = method || s.payMethod || 'Bank'; s.payCount = (s.payCount || 0) + 1; s.paidDate = today();
    s.status = s.paid >= payable ? 'paid' : 'partial';
    S.upsert('pay_slips', s);
    refreshRunStatus(s.companyId, ym);
    bus.emit('data:changed', { store: 'pay_slips' });
    return s;
  }

  // Undo a month's payment(s): posts an exact REVERSAL of every payment journal
  // (cash back, payable restored, advance/loan recoveries un-recovered — the GL
  // keeps the full audit trail), resets the slip to unpaid and recomputes status.
  function unpay(empId, ym) {
    var s = slip(empId, ym); if (!s || !(s.paid > 0)) return s;
    for (var n = 1; n <= (s.payCount || 0); n++) {
      var pid = 'GL-PAYP-' + empId + '-' + ym + '-' + n;
      var entry = S.list('gl_entries').filter(function (e) { return e.id === pid; })[0];
      if (!entry) continue;
      glPost('GL-UNPAY-' + empId + '-' + ym + '-' + n, today(), s.companyId, 'UNPAY-' + ym,
        'Payment reversal · ' + s.empName + ' · ' + mLabel(ym), 'payroll', empId,
        entry.lines.map(function (l) { return { account: l.account, dr: l.cr, cr: l.dr }; }));
    }
    // drop the auto-EMI txns this month's payments recorded (loan balance restores)
    S.set('pay_txns', S.list('pay_txns').filter(function (x) {
      return !(x.empId === empId && x.type === 'loan-repay' && String(x.memo || '').indexOf('EMI auto-deducted from ' + mLabel(ym)) === 0);
    }));
    s.paid = 0; s.advanceRecovered = 0; s.loanRecovered = 0; s.paidDate = null;   // payCount stays — reversal ids stay unique
    s.status = 'accrued';
    S.upsert('pay_slips', s);
    refreshRunStatus(s.companyId, ym);
    bus.emit('data:changed', { store: 'pay_slips' });
    return s;
  }

  // After the pay-by day (10th), any finalized-but-unpaid slip is auto-flagged Due.
  function refreshRunStatus(cid, ym) {
    var run = getRun(cid, ym); if (!run || run.status === 'draft') return;
    var slips = slipsFor(cid, ym);
    var allPaid = slips.length && slips.every(function (s) { return s.status === 'paid'; });
    var anyPaid = slips.some(function (s) { return (s.paid || 0) > 0; });
    var overdue = today() > run.dueAfter;
    run.status = allPaid ? 'paid' : (overdue && !allPaid ? 'due' : (anyPaid ? 'partial' : 'finalized'));
    S.upsert('pay_runs', run);
  }
  function autoDue() {
    S.list('pay_runs').forEach(function (r) { if (r.status !== 'draft') refreshRunStatus(r.companyId, r.ym); });
  }

  /* ------------------------------------------------ employee money events */
  function txn(rec) {
    rec.id = rec.id || ('PT-' + Date.now().toString(36).toUpperCase() + '-' + Math.floor(Math.random() * 1e4));
    S.upsert('pay_txns', rec); bus.emit('data:changed', { store: 'pay_txns' }); return rec;
  }
  function empName(empId) { var e = db().employee ? db().employee(empId) : null; return e ? e.name : empId; }
  function compOf(empId) { var e = db().employee ? db().employee(empId) : null; return (e && e.companyId) || 'travels'; }

  function advance(empId, amount, opts) {
    opts = opts || {}; amount = round(amount); if (amount <= 0) return null;
    var cid = compOf(empId);
    glPost(null, opts.date || today(), cid, 'ADV-' + empId, 'Advance salary · ' + empName(empId), 'payroll', empId,
      [{ account: '1250', dr: amount, cr: 0 }, { account: '1010', dr: 0, cr: amount }]);
    return txn({ type: 'advance', empId: empId, empName: empName(empId), companyId: cid, date: opts.date || today(), amount: amount, method: opts.method || 'Bank', memo: opts.memo || 'Advance salary' });
  }
  function loan(empId, amount, opts) {
    opts = opts || {}; amount = round(amount); if (amount <= 0) return null;
    var cid = compOf(empId);
    glPost(null, opts.date || today(), cid, 'LOAN-' + empId, 'Staff loan · ' + empName(empId), 'payroll', empId,
      [{ account: '1260', dr: amount, cr: 0 }, { account: '1010', dr: 0, cr: amount }]);
    return txn({ type: 'loan', empId: empId, empName: empName(empId), companyId: cid, date: opts.date || today(), amount: amount, method: opts.method || 'Bank', memo: opts.memo || 'Staff loan', emiMonths: +opts.emiMonths || 0 });
  }
  function repayLoan(empId, amount, opts) {
    opts = opts || {}; amount = round(amount); if (amount <= 0) return null;
    var cid = compOf(empId);
    glPost(null, opts.date || today(), cid, 'LREP-' + empId, 'Loan repayment · ' + empName(empId), 'payroll', empId,
      [{ account: '1010', dr: amount, cr: 0 }, { account: '1260', dr: 0, cr: amount }]);
    return txn({ type: 'loan-repay', empId: empId, empName: empName(empId), companyId: cid, date: opts.date || today(), amount: amount, method: opts.method || 'Bank', memo: opts.memo || 'Loan repayment' });
  }
  function bonus(empId, amount, opts) {
    opts = opts || {}; amount = round(amount); if (amount <= 0) return null;
    var cid = compOf(empId);
    glPost(null, opts.date || today(), cid, 'BON-' + empId, 'Bonus · ' + empName(empId), 'payroll', empId,
      [{ account: '5100', dr: amount, cr: 0 }, { account: '1010', dr: 0, cr: amount }]);
    return txn({ type: 'bonus', empId: empId, empName: empName(empId), companyId: cid, date: opts.date || today(), amount: amount, method: opts.method || 'Bank', memo: opts.memo || 'Bonus' });
  }

  /* ----------------------------------------------------- derived balances */
  function txnsFor(empId) { return S.list('pay_txns').filter(function (x) { return x.empId === empId; }); }
  function advanceOutstanding(empId) {
    var given = txnsFor(empId).filter(function (x) { return x.type === 'advance'; }).reduce(function (a, x) { return a + x.amount; }, 0);
    var recovered = S.list('pay_slips').filter(function (s) { return s.empId === empId; }).reduce(function (a, s) { return a + (s.advanceRecovered || 0); }, 0);
    var settled = txnsFor(empId).filter(function (x) { return x.type === 'settlement'; }).reduce(function (a, x) { return a + (x.advanceCleared || 0); }, 0);
    return Math.max(0, given - recovered - settled);
  }
  function loanOutstanding(empId) {
    var t = txnsFor(empId);
    var given = t.filter(function (x) { return x.type === 'loan'; }).reduce(function (a, x) { return a + x.amount; }, 0);
    var repaid = t.filter(function (x) { return x.type === 'loan-repay'; }).reduce(function (a, x) { return a + x.amount; }, 0);
    var settled = t.filter(function (x) { return x.type === 'settlement'; }).reduce(function (a, x) { return a + (x.loanCleared || 0); }, 0);
    return Math.max(0, given - repaid - settled);
  }
  // the monthly EMI to auto-deduct from salary = Σ(loan amount ÷ emiMonths) for loans
  // set up with an installment plan, capped at what's still owed.
  function emiInstallment(empId) {
    var emi = txnsFor(empId).filter(function (x) { return x.type === 'loan' && (+x.emiMonths || 0) > 0; })
      .reduce(function (a, x) { return a + Math.round(x.amount / x.emiMonths); }, 0);
    return Math.min(emi, loanOutstanding(empId));
  }
  // Salary currently owed to the employee (accrued but unpaid across all months).
  function salaryDue(empId) {
    return S.list('pay_slips').filter(function (s) { return s.empId === empId && s.status !== 'draft'; })
      .reduce(function (a, s) { var payable = slipPayable(s); return a + Math.max(0, payable - (s.paid || 0)); }, 0);
  }

  /* --------------------------------------------------------- leave state */
  function monthsWorked(emp) {
    if (!emp || !emp.joinDate) return 0;
    var j = new Date(emp.joinDate), n = new Date(today());
    var m = (n.getFullYear() - j.getFullYear()) * 12 + (n.getMonth() - j.getMonth());
    if (n.getDate() < j.getDate()) m -= 1;
    return Math.max(0, m);
  }
  function annualLeaveTaken(empId) {
    // approved Annual leave days in the current calendar year
    return S.list('tv_leaves').filter(function (l) { return l.empId === empId && l.type === 'Annual' && l.status === 'Approved' && String(l.from).slice(0, 4) === today().slice(0, 4); })
      .reduce(function (a, l) { return a + (l.days || 0); }, 0);
  }
  // Leave accrues 23/12 = 1.92 days per month WITHIN the current annual cycle
  // (calendar year here), capped at 23 — not lifetime. Completing a full year of
  // tenure makes the employee eligible for the full 23 days at each anniversary.
  function leaveState(emp) {
    var t = template(emp.companyId || 'travels');
    var perYear = t.leaveDaysPerYear || 23, wd = t.workingDays || 30;
    var mw = monthsWorked(emp);
    var now = new Date(today()), curY = now.getFullYear(), curM = now.getMonth() + 1;
    var j = emp.joinDate ? new Date(emp.joinDate) : now;
    var startMonth = (j.getFullYear() < curY) ? 1 : (j.getMonth() + 1);
    var monthsThisYear = (j.getFullYear() > curY) ? 0 : Math.max(0, curM - startMonth + 1);
    var accruedDays = Math.round(Math.min(monthsThisYear * (perYear / 12), perYear) * 100) / 100;
    var taken = annualLeaveTaken(emp.id);
    var encashable = Math.max(0, accruedDays - taken);
    var perDay = (+emp.salary || 0) / wd;
    return { monthsWorked: mw, monthsThisYear: monthsThisYear, accruedDays: accruedDays, takenDays: taken,
      encashableDays: Math.round(encashable * 100) / 100, perDay: round(perDay), value: round(encashable * perDay),
      eligibleFullYear: mw >= 12, fullYearDays: perYear, fullYearValue: round(perYear * perDay) };
  }

  /* ------------------------------------------------- resignation settlement */
  // Final settlement = unpaid salary + accrued leave encashment − outstanding advance/loan.
  function settlementPreview(emp) {
    var ls = leaveState(emp);
    var sal = salaryDue(emp.id);
    var advOut = advanceOutstanding(emp.id), loanOut = loanOutstanding(emp.id);
    var lastSalary = +emp.salary || 0;                      // "+ monthly salary" per the brief
    var encash = ls.value;
    var gross = sal + lastSalary + encash;
    var net = gross - advOut - loanOut;
    return { salaryDue: sal, lastSalary: lastSalary, encashDays: ls.encashableDays, encashValue: encash,
      advanceOutstanding: advOut, loanOutstanding: loanOut, gross: gross, net: net };
  }
  function settle(empId, opts) {
    opts = opts || {};
    var emp = db().employee(empId); if (!emp) throw new Error('Employee not found');
    var p = settlementPreview(emp), cid = emp.companyId || 'travels';
    var toEmployee = p.salaryDue + p.lastSalary + p.encashValue;
    var lines = [];
    if (p.salaryDue + p.lastSalary > 0) lines.push({ account: '2100', dr: p.salaryDue + p.lastSalary, cr: 0 });
    if (p.encashValue > 0) lines.push({ account: '2150', dr: p.encashValue, cr: 0 });
    if (p.advanceOutstanding > 0) lines.push({ account: '1250', dr: 0, cr: p.advanceOutstanding });
    if (p.loanOutstanding > 0) lines.push({ account: '1260', dr: 0, cr: p.loanOutstanding });
    var cash = toEmployee - p.advanceOutstanding - p.loanOutstanding;
    lines.push({ account: '1010', dr: 0, cr: cash });
    glPost('GL-SETL-' + empId, today(), cid, 'SETL-' + empId, 'Final settlement · ' + emp.name, 'payroll', empId, lines);
    txn({ type: 'settlement', empId: empId, empName: emp.name, companyId: cid, date: today(), amount: p.net,
      advanceCleared: p.advanceOutstanding, loanCleared: p.loanOutstanding, memo: 'Final settlement' });
    // mark any accrued-unpaid slips paid, and the employee resigned
    S.list('pay_slips').filter(function (s) { return s.empId === empId && s.status !== 'draft'; }).forEach(function (s) { s.paid = slipPayable(s); s.status = 'paid'; s.paidDate = today(); S.upsert('pay_slips', s); });
    emp.status = 'resigned'; emp.resignedDate = today();
    if (db().saveEmployee) db().saveEmployee(emp); else db().save('employees', emp);
    bus.emit('data:changed', { store: 'pay_slips' });
    return p;
  }

  // total accrued leave-encashment liability across the active team (the future
  // obligation the MD should see) — sum of each head's current encashable value.
  function encashmentLiability(cid) {
    return activeTeam(cid || 'travels').reduce(function (a, e) { return a + leaveState(e).value; }, 0);
  }
  // Pay out the accrued leave encashment (annual/anniversary) — DR 2150 Payable /
  // CR Bank — and reset the accrual by booking the encashed days as taken this year.
  function payEncashment(empId, opts) {
    opts = opts || {};
    var emp = db().employee(empId); if (!emp) throw new Error('Employee not found');
    var ls = leaveState(emp); if (ls.value <= 0) throw new Error('No leave encashment accrued to pay.');
    var cid = emp.companyId || 'travels';
    glPost(null, opts.date || today(), cid, 'ENCP-' + empId, 'Leave encashment payout · ' + emp.name, 'payroll', empId,
      [{ account: '2150', dr: ls.value, cr: 0 }, { account: '1010', dr: 0, cr: ls.value }]);
    txn({ type: 'encash-paid', empId: empId, empName: emp.name, companyId: cid, date: opts.date || today(), amount: ls.value, memo: 'Leave encashment payout (' + ls.encashableDays.toFixed(2) + ' days)' });
    // reset the year's accrual: record the encashed days as consumed leave
    S.upsert('tv_leaves', { id: 'LV-ENC-' + empId + '-' + today().slice(0, 4), empId: empId, empName: emp.name, type: 'Annual', status: 'Approved', from: today(), to: today(), days: ls.encashableDays, reason: 'Leave encashment paid out', applied: today() });
    bus.emit('data:changed', { store: 'pay_txns' });
    return ls.value;
  }
  // department-wise monthly salary cost (current month, active team) for reports
  function departmentCost(cid) {
    var by = {};
    activeTeam(cid || 'travels').forEach(function (e) { var d = e.dept || '—'; by[d] = (by[d] || 0) + (+e.salary || 0); });
    return Object.keys(by).map(function (k) { return { dept: k, cost: by[k] }; }).sort(function (a, b) { return b.cost - a.cost; });
  }

  /* ----------------------------------------------- the employee accounts sheet */
  // A merged, chronological ledger with a running "net due to employee" balance.
  // credit(+) = company owes employee (salary/encash accrued, bonus);
  // debit(−) = paid to / owed by employee (salary paid, advance, loan, deduction).
  function empLedger(empId) {
    var rows = [];
    S.list('pay_slips').filter(function (s) { return s.empId === empId && s.status !== 'draft'; }).forEach(function (s) {
      var payable = slipPayable(s);
      rows.push({ date: s.ym + '-01', ref: s.id, kind: 'Salary earned', memo: mLabel(s.ym) + ' salary (net of tax/PF)', credit: payable, debit: 0 });
      if (s.encashAmt) rows.push({ date: s.ym + '-01', ref: s.id, kind: 'Leave encashment', memo: mLabel(s.ym) + ' leave accrual', credit: s.encashAmt, debit: 0 });
      if (s.paid) rows.push({ date: s.paidDate || (s.ym + '-10'), ref: s.id, kind: 'Salary paid', memo: mLabel(s.ym) + ' salary paid', credit: 0, debit: s.paid });
    });
    txnsFor(empId).forEach(function (x) {
      if (x.type === 'advance') rows.push({ date: x.date, ref: x.id, kind: 'Advance', memo: x.memo, credit: 0, debit: x.amount });
      else if (x.type === 'loan') rows.push({ date: x.date, ref: x.id, kind: 'Loan', memo: x.memo, credit: 0, debit: x.amount });
      else if (x.type === 'loan-repay') rows.push({ date: x.date, ref: x.id, kind: 'Loan repaid', memo: x.memo, credit: x.amount, debit: 0 });
      else if (x.type === 'bonus') rows.push({ date: x.date, ref: x.id, kind: 'Bonus', memo: x.memo, credit: x.amount, debit: 0 });
      else if (x.type === 'settlement') rows.push({ date: x.date, ref: x.id, kind: 'Final settlement', memo: x.memo, credit: 0, debit: x.amount });
    });
    rows.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    var bal = 0;
    rows.forEach(function (r) { bal += (r.credit || 0) - (r.debit || 0); r.balance = bal; });
    return rows;
  }

  // Full salary statement for one month in the group's REAL payslip format:
  // earnings (full-gross components + bonus + overtime), deductions (advance, loan
  // EMI, absent, late, early leave, tax, PF, other), salary adjustment, net payable
  // with amount-in-words, payslip number and payment method — plus the separate
  // Leave-Encashment benefit block.
  // Arrears: everything still owed to the employee from EARLIER months (partial /
  // unpaid salaries). Surfaced beneath the net on the NEXT month's payslip —
  // "company paid 14,000 of 24,000 → the other 10,000 shows as past-months due".
  function previousDue(empId, ym) {
    return S.list('pay_slips')
      .filter(function (s) { return s.empId === empId && s.ym < ym && s.status !== 'draft'; })
      .reduce(function (a, s) { return a + Math.max(0, slipPayable(s) - (s.paid || 0)); }, 0);
  }
  // The arrears BREAKDOWN with dates (owner: "for every due there should be a
  // date record of WHICH month's due that is"): one row per unpaid month —
  // month, label, amount still owed, and since when it counts as due (the
  // month's pay-by date), plus what was part-paid and when.
  function previousDueList(empId, ym) {
    return S.list('pay_slips')
      .filter(function (s) { return s.empId === empId && s.ym < ym && s.status !== 'draft' && slipPayable(s) - (s.paid || 0) > 0.5; })
      .sort(function (a, b) { return a.ym < b.ym ? -1 : 1; })
      .map(function (s) {
        var run = getRun(s.companyId, s.ym);
        return { ym: s.ym, label: mLabel(s.ym), amount: round(slipPayable(s) - (s.paid || 0)),
          dueSince: (run && run.dueAfter) || (s.ym + '-10'), paid: s.paid || 0, paidDate: s.paidDate || null };
      });
  }
  function statement(emp, ym) {
    var s = slip(emp.id, ym) || Object.assign({ empName: emp.name }, computeSlip(emp, ym, {}));
    var ls = leaveState(emp);
    var payable = slipPayable(s);
    // advance/loan lines: actual recoveries once paid, else the projected AGREED
    // recovery (auto, capped by advCap/emiCap when the company set them)
    var advAuto = Math.min(advanceOutstanding(emp.id), Math.max(0, payable));
    var advLine = (s.paid > 0) ? (s.advanceRecovered || 0) : ((s.advCap == null || s.advCap === '') ? advAuto : Math.min(advAuto, round(+s.advCap)));
    var loanLine = (s.paid > 0) ? (s.loanRecovered || 0) : ((s.emiCap == null || s.emiCap === '') ? emiInstallment(emp.id) : round(+s.emiCap));
    var cashAfter = Math.max(0, payable - advLine - loanLine);
    var arrears = previousDue(emp.id, ym);
    var arrearsList = previousDueList(emp.id, ym);
    return {
      ym: ym, emp: emp, slip: s,
      slipNo: s.slipNo || (ym + '-001'),
      payMethod: s.payMethod || emp.salaryMethod || 'Bank',
      generated: today(),
      earnings: [
        ['Basic Salary', s.basic], ['House Rent Allowance', s.house], ['Medical Allowance', s.medical],
        ['Conveyance Allowance', s.transport], ['Bonus', s.bonus || 0], ['Overtime', s.overtime || 0]
      ],
      grossEarnings: (s.gross || 0) + (s.overtime || 0) + (s.bonus || 0),
      grossEarned: s.earnedGross,
      deductions: [
        ['Advance Salary', advLine], ['Loan', loanLine],
        ['Absent', s.absentDeduction || 0], ['Late', s.lateDeduction || 0], ['Early leave', s.earlyDeduction || 0],
        ['Income tax', s.tax || 0], ['Provident fund', s.pf || 0]
      ].concat(s.otherDeduction ? [['Other deduction', s.otherDeduction]] : []),
      totalDeductions: advLine + loanLine + (s.absentDeduction || 0) + (s.lateDeduction || 0) + (s.earlyDeduction || 0) + (s.tax || 0) + (s.pf || 0) + (s.otherDeduction || 0),
      adjustment: s.adjustment || 0,
      leaveEncashment: { days: s.encashDays, amount: s.encashAmt, accruedDays: ls.encashableDays, accruedValue: ls.value, eligible: ls.eligibleFullYear, fullYearDays: ls.fullYearDays, fullYearValue: ls.fullYearValue },
      netPayable: payable, netCash: cashAfter, inWords: amountInWords(payable),
      previousDue: arrears, previousDueItems: arrearsList, totalPayable: payable + arrears, totalInWords: amountInWords(payable + arrears),
      paid: s.paid || 0, outstanding: Math.max(0, payable - (s.paid || 0)), status: s.status || 'draft'
    };
  }
  // Pay off every earlier month still owed (walks old unpaid/partial slips oldest-first).
  function payArrears(empId, method) {
    var owed = S.list('pay_slips')
      .filter(function (s) { return s.empId === empId && s.status !== 'draft' && slipPayable(s) > (s.paid || 0); })
      .sort(function (a, b) { return a.ym < b.ym ? -1 : 1; });
    var total = 0;
    owed.forEach(function (s) { try { var before = s.paid || 0; pay(empId, s.ym, null, method); var after = (slip(empId, s.ym) || {}).paid || 0; total += after - before; } catch (e) {} });
    return total;
  }

  /* --------------------------------------------------------------- helpers */
  function glPost(id, date, cid, ref, memo, source, party, lines) {
    if (!L() || !L().post) return null;
    try { return L().post({ id: id || undefined, date: date, companyId: cid, ref: ref, memo: memo, source: source, party: party, lines: lines }); }
    catch (e) { console.error('[payroll] GL post failed', e, { ref: ref }); return null; }
  }
  function mLabel(ym) { var p = String(ym).split('-'); return new Date(p[0], (+p[1] || 1) - 1, 1).toLocaleString('en', { month: 'long' }) + ' ' + p[0]; }

  /* -------------------------------------------------- COA + demo seed */
  // NOTE: we register COA rows DIRECTLY (not via ledger.ensureAccount, which upserts
  // by `id` — COA rows have none, so its calls collide on one row and don't persist).
  // Append-by-code with a proper id + normal side, once, idempotently.
  var NEW_ACCOUNTS = [
    ['1250', 'Employee Advances', 'asset'], ['1260', 'Staff Loans Receivable', 'asset'],
    ['2100', 'Salary Payable', 'liability'], ['2110', 'Provident Fund Payable', 'liability'],
    ['2120', 'Withholding Tax Payable', 'liability'], ['2150', 'Leave Encashment Payable', 'liability'],
    ['5150', 'Leave Encashment', 'expense']
  ];
  function ensureAccounts() {
    var coa = S.list('coa'); if (!coa.length) return;    // ledger seeds the COA first
    var have = {}; coa.forEach(function (a) { have[a.code] = true; });
    var added = false;
    NEW_ACCOUNTS.forEach(function (n) {
      if (have[n[0]]) return;
      coa.push({ id: n[0], code: n[0], name: n[1], type: n[2], normal: (n[2] === 'asset' || n[2] === 'expense') ? 'debit' : 'credit', group: 'Payroll', intercompany: false });
      added = true;
    });
    if (added) S.set('coa', coa);
  }

  // Seed a little history so the desk isn't empty: finalize + pay May & June for
  // EVERY sister concern (so the group by-concern P&L shows real salaries across the
  // board), plus one outstanding Travels advance. Idempotent — generate keeps existing
  // slips, finalize/pay are no-ops once done, the advance is de-duped.
  function seedDemo() {
    if (S.get('pay_seeded_v3', false)) return;
    var companies = (EPAL.config && EPAL.config.companies)
      ? EPAL.config.companies.filter(function (c) { return c.type === 'company'; }).map(function (c) { return c.id; })
      : ['travels', 'woodart', 'it', 'shop', 'construction'];
    companies.forEach(function (cid) {
      if (!activeTeam(cid).length) return;
      ['2026-05', '2026-06'].forEach(function (ym) {
        generate(cid, ym);
        finalize(cid, ym);
        var monthSlips = slipsFor(cid, ym);
        // Travels June: the 3rd person is PART-paid → a dated past-month due
        // that then shows itemised on the July payslip (demo scenario).
        var partialId = (cid === 'travels' && ym === '2026-06' && monthSlips[2]) ? monthSlips[2].empId : null;
        monthSlips.forEach(function (s) {
          if (s.empId === partialId) { try { pay(s.empId, ym, Math.round(slipPayable(s) * 0.6), 'Bank'); } catch (e) {} return; }
          try { pay(s.empId, ym); } catch (e) {}
        });
      });
      generate(cid, curYm());   // current (July) draft run
    });
    // ---- rich July texture for Travels so every sheet column shows life ----
    var tt = activeTeam('travels'), ym7 = curYm();
    // browsers seeded before v3 may already hold a finalized July — rewind it so
    // the attendance/OT/bonus texture can apply, then re-finalize below
    try { var r7 = getRun('travels', ym7); if (r7 && r7.status !== 'draft') unfinalize('travels', ym7); } catch (e) {}
    if (tt.length >= 5) {
      // advance + a live loan with monthly EMI (histories: pay_txns keep dates)
      if (!txnsFor(tt[1].id).some(function (x) { return x.type === 'advance'; })) advance(tt[1].id, 15000, { date: '2026-07-02', memo: 'Advance salary (July)' });
      if (!txnsFor(tt[0].id).some(function (x) { return x.type === 'loan'; })) loan(tt[0].id, 40000, { date: '2026-06-15', memo: 'Staff loan · 12 EMIs', emiMonths: 12 });
      if (!txnsFor(tt[3].id).some(function (x) { return x.type === 'loan'; })) loan(tt[3].id, 52000, { date: '2026-05-20', memo: 'Staff loan · 6 EMIs', emiMonths: 6 });
      // July attendance → automatic absent/late deductions on the draft slips
      saveAttendance(tt[2].id, ym7, { present: 22, absent: 2, late: 3, earlyLeave: 0, leave: 0 });
      saveAttendance(tt[4].id, ym7, { present: 25, absent: 1, late: 1, earlyLeave: 1, leave: 0 });
      // overtime + bonus on the drafts (eligible staff)
      try { adjustSlip(tt[0].id, ym7, { leaveDeductDays: 0, lateDays: 0, earlyDays: 0, overtimeHours: 8, otherDeduction: 0, bonus: 0, adjustment: 0 }); } catch (e) {}
      try { adjustSlip(tt[1].id, ym7, { leaveDeductDays: 0, lateDays: 0, earlyDays: 0, overtimeHours: 0, otherDeduction: 0, bonus: 6000, adjustment: 0 }); } catch (e) {}
      // finalize July and pay a mix: one in full, one partial — so Paid/Due/status
      // all show demo values (Reopen Draft rewinds all of this for live demos)
      finalize('travels', ym7);
      try { pay(tt[0].id, ym7); } catch (e) {}
      try { pay(tt[1].id, ym7, 40000, 'Bank'); } catch (e) {}
    }
    S.set('pay_seeded_v3', true);
  }

  /* --------------------------------------------------------------- API */
  EPAL.payroll = {
    template: template, saveTemplate: saveTemplate, computeSlip: computeSlip, slipPayable: slipPayable,
    amountInWords: amountInWords, attendanceFor: attendanceFor, saveAttendance: saveAttendance,
    generate: generate, getRun: getRun, run: getRun, slipsFor: slipsFor, slip: slip,
    inCorrectionWindow: inCorrectionWindow, adjustSlip: adjustSlip,
    finalize: finalize, unfinalize: unfinalize, pay: pay, unpay: unpay, autoDue: autoDue, refreshRunStatus: refreshRunStatus,
    advance: advance, loan: loan, repayLoan: repayLoan, bonus: bonus,
    advanceOutstanding: advanceOutstanding, loanOutstanding: loanOutstanding, emiInstallment: emiInstallment, salaryDue: salaryDue,
    leaveState: leaveState, settlementPreview: settlementPreview, settle: settle,
    encashmentLiability: encashmentLiability, payEncashment: payEncashment, departmentCost: departmentCost,
    previousDue: previousDue, previousDueList: previousDueList, payArrears: payArrears,
    empLedger: empLedger, statement: statement, txnsFor: txnsFor,
    curYm: curYm, today: today, mLabel: mLabel
  };

  EPAL.registerEngine({
    name: 'payroll',
    seed: function () { ensureAccounts(); S.list('employees'); seedDemo(); },
    boot: function () { ensureAccounts(); autoDue(); }
  });

})(window.EPAL = window.EPAL || {});
