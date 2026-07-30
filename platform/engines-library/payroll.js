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
 *   pay_salary_tpl salary PACKAGES — one per pay grade / person: the components as
 *                  fixed taka, standing bonus, OT switch + rate, standing fine
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

  /* --------------------------------------------- SALARY PACKAGES (per person)
   * `pay_templates` above is the company's STATUTORY structure — the percentages,
   * the tax rule, the PF rule, the leave rule. It answers "how is a salary split".
   *
   * A SALARY PACKAGE (`pay_salary_tpl`) answers the other question — "what is THIS
   * person actually paid": the five components as FIXED taka figures, a standing
   * monthly bonus, whether overtime is allowed for them (and at what rate), and any
   * standing disciplinary fine. Owner 2026-07-29, modelled on the group's existing
   * Salary Templates List.
   *
   *   { id, companyId, name, basic, house, medical, conveyance, other, bonus,
   *     otEligible, otRate, fine, fineNote, empIds:[…] }
   *
   * THE RULE THAT KEEPS TODAY'S FIGURES STILL: an employee with no package is
   * computed exactly as before — percentages of `emp.salary`. A package REPLACES
   * only the component split and the gross (its five components added up); tax, PF,
   * absence, lateness, encashment and the correction window keep coming from the
   * company template, so the statutory rules stay in ONE place.
   *
   * ASSIGNMENT LIVES ON THE PACKAGE (`empIds`), not on the employee record: the
   * employees store is hydrated from the group directory and a payroll desk has no
   * business writing into it. A package with no empIds is a library entry — a pay
   * grade you can hand to someone later; it changes nobody's pay until it is.
   * ==> LARAVEL: salary_templates + a salary_template_employee pivot. */
  function stTotal(t) {
    if (!t) return 0;
    return round(+t.basic || 0) + round(+t.house || 0) + round(+t.medical || 0)
         + round(+t.conveyance || 0) + round(+t.other || 0);
  }
  function allPackages() { return S.list('pay_salary_tpl'); }
  function packageOf(empId) {
    if (!empId) return null;
    var all = allPackages();
    for (var i = 0; i < all.length; i++) {
      var ids = all[i].empIds || [];
      for (var j = 0; j < ids.length; j++) if (ids[j] === empId) return all[i];
    }
    return null;
  }
  // The list behind the Salary Templates screen. Seeds ONCE per company, DERIVED
  // from the staff who are actually on the payroll — an invented list would show
  // packages nobody is paid on, and an empty list would hide the structure the
  // company already runs. Because each seeded package is exactly what the company
  // percentages compute for that salary (conveyance is the same remainder), every
  // existing payslip figure is unchanged by the seed.
  function salaryPackages(cid) {
    ensurePackages(cid);
    return allPackages().filter(function (p) { return p.companyId === cid; });
  }
  function ensurePackages(cid) {
    var t = template(cid);
    if (t.pkgSeeded) return;
    var existing = allPackages().filter(function (p) { return p.companyId === cid; });
    if (!existing.length) {
      activeTeam(cid).forEach(function (e, i) {
        var gross = +e.salary || 0;
        if (gross <= 0) return;
        var basic = round(gross * t.basicPct), house = round(gross * t.housePct), medical = round(gross * t.medicalPct);
        savePackage({
          id: 'STPL-' + cid + '-' + String(i + 1).padStart(3, '0'), companyId: cid,
          name: e.name, basic: basic, house: house, medical: medical,
          conveyance: gross - basic - house - medical, other: 0, bonus: 0,
          otEligible: e.otEligible !== false, otRate: 0, fine: 0, fineNote: '',
          empIds: [e.id], seeded: true
        }, true);
      });
    }
    t.pkgSeeded = today(); saveTemplate(t);
  }
  function packageId(cid) {
    var n = 0;
    allPackages().forEach(function (p) {
      var m = /-(\d+)$/.exec(String(p.id || ''));
      if (p.companyId === cid && m) n = Math.max(n, +m[1]);
    });
    return 'STPL-' + cid + '-' + String(n + 1).padStart(3, '0');
  }
  /* Save a package. ONE EMPLOYEE, ONE PACKAGE: assigning someone here detaches them
   * from whatever they were on, so two packages can never both claim to be a
   * person's pay (the payslip would then depend on record order). */
  /* A PARTIAL SAVE IS A PARTIAL SAVE. The overtime switch on the list sends
   * {id, otEligible} and nothing else; deriving empIds/total from that alone would
   * silently detach the employee and zero the package — flipping one switch would
   * quietly change someone's pay. So the incoming fields are merged ONTO the stored
   * record and the derived fields are computed from the result. */
  function savePackage(p, quiet) {
    var cur = p.id ? allPackages().filter(function (o) { return o.id === p.id; })[0] : null;
    var rec = Object.assign({}, cur || {}, p);
    if (!rec.id) rec.id = packageId(rec.companyId);
    rec.empIds = (rec.empIds || []).filter(Boolean);
    rec.total = stTotal(rec);
    if (rec.empIds.length) {
      allPackages().forEach(function (o) {
        if (o.id === rec.id) return;
        var keep = (o.empIds || []).filter(function (id) { return rec.empIds.indexOf(id) < 0; });
        if (keep.length !== (o.empIds || []).length) S.upsert('pay_salary_tpl', { id: o.id, empIds: keep });
      });
    }
    S.upsert('pay_salary_tpl', rec);
    if (!quiet) bus.emit('data:changed', { store: 'pay_salary_tpl' });
    return rec;
  }
  function deletePackage(id) {
    S.removeFrom('pay_salary_tpl', id);
    bus.emit('data:changed', { store: 'pay_salary_tpl' });
  }

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
    // the employee's own salary package, when they are on one (see savePackage)
    var pkg = packageOf(emp.id);
    var gross = pkg ? stTotal(pkg) : (+emp.salary || 0);
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
    // a package states its components in taka; without one they are percentages
    // of the gross and CONVEYANCE is the remainder, exactly as it always was
    var basic = pkg ? round(+pkg.basic || 0) : round(gross * t.basicPct);
    var house = pkg ? round(+pkg.house || 0) : round(gross * t.housePct);
    var medical = pkg ? round(+pkg.medical || 0) : round(gross * t.medicalPct);
    var transport = pkg ? round(+pkg.conveyance || 0) : gross - basic - house - medical;
    var otherAllow = pkg ? round(+pkg.other || 0) : 0;
    var tax = earnedGross > t.taxThreshold ? round(earnedGross * t.taxPct) : 0;
    var pf = round(basic * t.pfPct);
    var otherDeduction = round(+adj.otherDeduction || 0);
    // STANDING lines from the package: a bonus paid every month, and a
    // disciplinary fine that runs until it is taken off the package. Both are
    // their own slip fields — folding them into `bonus`/`otherDeduction` would
    // double them the next time Edit Salary round-tripped those figures.
    var tplBonus = (emp.bonusEligible === false || !pkg) ? 0 : round(+pkg.bonus || 0);
    var pkgFine = (pkg && +pkg.fine > 0) ? round(+pkg.fine) : 0;
    var fineExtra = Math.max(0, round(+adj.fineExtra || 0));
    var fine = pkgFine + fineExtra;
    // fineExtraNote is the reason for the ONE-OFF part only, kept apart from the
    // combined display line so a round-trip through Edit Salary cannot re-append
    // the package's standing reason to itself
    var fineExtraNote = fineExtra ? ((adj.fineNote != null && String(adj.fineNote)) ? String(adj.fineNote) : 'Disciplinary deduction') : '';
    var fineNote = [
      pkgFine ? (pkg.fineNote || 'Standing fine · ' + pkg.name) : '',
      fineExtraNote
    ].filter(Boolean).join(' · ');
    // eligibility marks: overtime/bonus only count for employees flagged eligible
    // (emp.otEligible / emp.bonusEligible — default true when unset)
    var bonus = (emp.bonusEligible === false) ? 0 : round(+adj.bonus || 0);
    var adjustment = round(+adj.adjustment || 0);            // signed: + adds, − deducts
    // overtime is allowed by the employee record AND by the package (the switch on
    // the Salary Templates screen); the package may carry its own ৳/hour rate
    var otOff = emp.otEligible === false || (pkg && pkg.otEligible === false);
    var otHours = otOff ? 0 : Math.max(0, +adj.overtimeHours || 0);
    var otRate = (pkg && pkg.otRate > 0) ? round(pkg.otRate)
      : ((t.overtimeRate > 0) ? t.overtimeRate : Math.round((gross / wd / 8) * 1.5));   // default 1.5× the hourly rate
    var overtime = otOff ? 0 : ovr(adj.otOverride, round(otHours * otRate));
    var net = gross + overtime + bonus + tplBonus + adjustment
            - absentDeduction - lateDeduction - earlyDeduction - tax - pf - otherDeduction - fine;
    var encashDays = (t.leaveDaysPerYear || 23) / 12;        // 1.92
    var encashAmt = round(encashDays * perDayF);
    return {
      gross: gross, earnedGross: earnedGross, workedDays: workedDays, leaveDeductDays: absentDays,
      absentDeduction: absentDeduction, lateDays: lateDays, lateDeduction: lateDeduction,
      earlyDays: earlyDays, earlyDeduction: earlyDeduction, adjustment: adjustment,
      absentOverride: keepOvr(adj.absentOverride), lateOverride: keepOvr(adj.lateOverride),
      earlyOverride: keepOvr(adj.earlyOverride), otOverride: keepOvr(adj.otOverride),
      basic: basic, house: house, medical: medical, transport: transport, otherAllow: otherAllow,
      tax: tax, pf: pf, otherDeduction: otherDeduction, bonus: bonus, tplBonus: tplBonus,
      fine: fine, fineExtra: fineExtra, fineNote: fineNote, fineExtraNote: fineExtraNote,
      pkgId: pkg ? pkg.id : null, pkgName: pkg ? pkg.name : null, otEligible: !otOff, otRate: otRate,
      overtimeHours: otHours, overtime: overtime,
      net: net, encashDays: encashDays, perDay: round(perDayF), encashAmt: encashAmt
    };
  }
  /* EARNINGS LESS THE MONTH'S OWN DEDUCTIONS — everything except the two
   * RECOVERIES (advance, loan EMI), which slipPayable takes off next.
   * Old slips (no late/early/adjustment fields) compute identically since the new
   * fields default to 0 and earnedGross === gross − absentDeduction.
   * (a slip written before salary packages existed carries no tplBonus/fine, so
   * both default to 0 and it computes to exactly the figure it always did) */
  function slipEarned(s) {
    return round((s.earnedGross || 0) + (s.overtime || 0) + (s.bonus || 0) + (s.tplBonus || 0) + (s.adjustment || 0)
      - (s.tax || 0) - (s.pf || 0) - (s.otherDeduction || 0) - (s.lateDeduction || 0) - (s.earlyDeduction || 0) - (s.fine || 0));
  }

  /* ====================== THE TWO RECOVERIES (owner 2026-07-30) ===============
   * "Loan EMI is displayed in the table but is not being subtracted from net
   * payable… every deduction column that shows an amount must actually reduce
   * net payable." It did not, and neither did the advance: until now BOTH came
   * off at PAYMENT time — pay() split the payable into advance recovery + EMI +
   * cash, so the sheet's Net Payable was the figure BEFORE the two columns
   * printed beside it. The row did not add up, and a month that was accrued but
   * not yet paid had an EMI on the sheet that had touched nothing.
   *
   * The recovery is now part of the payslip: net payable IS the cash to hand
   * over, the accrual credits 1250/1260 the moment the month is approved, and
   * the loan balance falls when the EMI is deducted — not a payment later.
   *
   * WHICH FIGURE a slip carries depends on where it stands, and this is the ONE
   * place that decides (the sheet columns, the payslip, the ledger and the
   * approval check all read it, so they cannot disagree):
   *   · deducted at accrual  → the FROZEN figures the accrual posted
   *   · paid under the old rule → what the payment actually recovered, so a
   *     settled month keeps the books and the Due it always had
   *   · anything else        → the PLAN: what this month would take, capped by
   *     what this month can bear
   * ENCASHMENT is not here and never was: it accrues to 2150 as a yearly
   * liability and is paid once, so it moves neither net payable, paid nor due. */
  function planRecovery(s) {
    var empId = s.empId;
    // what the company means to take: the schedule, unless Edit Salary agreed
    // a different figure for this month (advCap / emiCap)
    var advOut = advanceOutstanding(empId, s.id);
    var advWant = (s.advCap == null || s.advCap === '') ? advOut : Math.min(advOut, round(+s.advCap));
    var emiOut = loanOutstanding(empId, s.id);
    var emiWant = (s.emiCap == null || s.emiCap === '') ? emiInstallment(empId, s.id) : Math.min(emiOut, round(+s.emiCap));
    /* …and never more than the BOOKS say is outstanding (2026-07-28).
     * advanceOutstanding/emiInstallment read the pay_txns trail; 1250 and 1260 are
     * what the ledger actually carries, and on an imported or seeded book the two
     * can disagree. Recovering past the ledger balance drives an ASSET negative —
     * the company appears to collect back money it never lent. */
    advWant = Math.max(0, Math.min(advWant, onBooks('1250', s.companyId)));
    emiWant = Math.max(0, Math.min(emiWant, onBooks('1260', s.companyId)));
    /* NET PAYABLE CAN NEVER GO NEGATIVE (owner 2026-07-30): "deduct only what is
     * available, carry the rest to the next month, and mark that row." The month
     * can only bear what is left after its own deductions; whatever the schedule
     * asked for beyond that is simply NOT deducted, which leaves it outstanding —
     * so next month's plan picks it up by itself, no carry-forward record to keep
     * in step with anything. `short` is what was left behind, for the mark. */
    var room = Math.max(0, slipEarned(s));
    var adv = clamp(advWant, 0, room);
    var emi = clamp(emiWant, 0, room - adv);
    return { adv: round(adv), emi: round(emi), short: round((advWant - adv) + (emiWant - emi)) };
  }
  /* THE LEDGER CEILING, READ ONCE PER CHANGE. ledger.balance walks every journal
   * line in the book, and the salary sheet now asks for it while drawing each of
   * a hundred rows (net payable, the two columns, the foot). Cached per account
   * per company and dropped the moment ANY store changes — the bus is synchronous,
   * so a posting inside a finalize loop invalidates this before the next slip is
   * planned, and no row is ever sized from a stale balance. */
  var bookMemo = {};
  bus.on('data:changed', function () { bookMemo = {}; });
  function onBooks(code, cid) {
    var k = code + '|' + (cid || '');
    if (k in bookMemo) return bookMemo[k];
    var v;
    try { v = Math.max(0, round(L().balance(code, { companyId: cid }))); }
    catch (e) { v = Infinity; }                       // ledger unavailable → old behaviour
    bookMemo[k] = v; return v;
  }
  function slipRecovery(s) {
    if (s.deductedAt) return { adv: round(s.advanceDeduct || 0), emi: round(s.loanDeduct || 0), short: round(s.carryShort || 0), frozen: true };
    if ((s.paid || 0) > 0) return { adv: round(s.advanceRecovered || 0), emi: round(s.loanRecovered || 0), short: 0, legacy: true };
    return planRecovery(s);
  }

  // The single source of truth for the net owed to an employee for a month —
  // the CASH to hand over: earnings − the month's deductions − advance − EMI.
  function slipPayable(s) {
    var r = slipRecovery(s);
    return Math.max(0, round(slipEarned(s) - r.adv - r.emi));
  }
  /* What the employee actually RECEIVED. Under the old rule pay() booked the
   * whole payable as `paid` and handed over less, because the advance and the EMI
   * came out of it; those months keep their journals untouched and are simply
   * READ correctly here, so Net payable − Paid = Due holds on every row ever
   * written. A month deducted at accrual recovers nothing at payment, so its
   * `paid` is already the cash and this returns it unchanged. */
  function slipPaid(s) {
    var legacy = s.deductedAt ? 0 : ((s.advanceRecovered || 0) + (s.loanRecovered || 0));
    return Math.max(0, round((s.paid || 0) - legacy));
  }
  function slipDue(s) { return Math.max(0, round(slipPayable(s) - slipPaid(s))); }
  // the recovery that has actually HAPPENED on a slip (a plan has not happened)
  function slipRealized(s) {
    return s.deductedAt ? round((s.advanceDeduct || 0) + (s.loanDeduct || 0))
      : round((s.advanceRecovered || 0) + (s.loanRecovered || 0));
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

  /* Who is ON this payroll. Resigned staff drop off — and so does the OWNER.
   *
   * The owner row (role:'owner') is the proprietor, not an employee: it carries no
   * salary, and every month it was generating a ৳0 payslip that sat in the salary
   * sheet with dashes across every column, was counted in Headcount, and appeared
   * in the Autopilot's "employee(s) have no salary set" warning for ever. The
   * owner spotted it on Master Payroll — two of five rows reading ৳0 (2026-07-29).
   *
   * A proprietor's drawings are equity, not a payslip. Anyone who genuinely should
   * be paid through payroll is an employee/manager/accountant and is unaffected. */
  function activeTeam(cid) {
    var all = (db() && db().employees) ? db().employees({ companyId: cid }) : S.list('employees').filter(function (e) { return e.companyId === cid; });
    return all.filter(function (e) { return e.status !== 'resigned' && e.role !== 'owner'; });
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
    if (s && run && run.status === 'draft') {
      var adj = slipAdj(s);                       // everything the slip already carries…
      adj.leaveDeductDays = a.absent || 0; adj.lateDays = a.late || 0; adj.earlyDays = a.earlyLeave || 0;   // …with the new counts
      try { adjustSlip(empId, ym, adj); } catch (x) {}
    }
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
            absentOverride: existing.absentOverride, lateOverride: existing.lateOverride, earlyOverride: existing.earlyOverride, otOverride: existing.otOverride,
            fineExtra: existing.fineExtra, fineNote: existing.fineExtraNote }
        : (att ? { leaveDeductDays: att.absent || 0, lateDays: att.late || 0, earlyDays: att.earlyLeave || 0 } : {});
      var c = computeSlip(e, ym, adj);
      var s = existing || { id: slipId(e.id, ym), runId: run.id, empId: e.id, companyId: cid, ym: ym, paid: 0, advanceRecovered: 0, loanRecovered: 0, status: 'draft', slipNo: ym + '-' + String(++seq).padStart(3, '0') };
      if (!s.slipNo) s.slipNo = ym + '-' + String(++seq).padStart(3, '0');
      s.empName = e.name; s.dept = e.dept;
      // copy computed figures onto the slip
      ['gross', 'earnedGross', 'workedDays', 'leaveDeductDays', 'absentDeduction', 'lateDays', 'lateDeduction',
        'earlyDays', 'earlyDeduction', 'adjustment', 'absentOverride', 'lateOverride', 'earlyOverride', 'otOverride',
        'basic', 'house', 'medical', 'transport', 'otherAllow', 'pkgId', 'pkgName',
        'tax', 'pf', 'otherDeduction', 'bonus', 'tplBonus', 'fine', 'fineExtra', 'fineNote', 'fineExtraNote',
        'overtimeHours', 'overtime', 'net', 'encashDays', 'perDay', 'encashAmt'].forEach(function (k) { s[k] = c[k]; });
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
    var emp = db().employee ? db().employee(empId) : { id: empId, salary: s.gross, companyId: s.companyId };
    var c = computeSlip(emp, ym, adj);
    ['leaveDeductDays', 'absentDeduction', 'lateDays', 'lateDeduction', 'earlyDays', 'earlyDeduction', 'adjustment',
      'absentOverride', 'lateOverride', 'earlyOverride', 'otOverride',
      'otherDeduction', 'bonus', 'tplBonus', 'fine', 'fineExtra', 'fineNote', 'fineExtraNote', 'overtimeHours', 'overtime', 'earnedGross', 'workedDays',
      'basic', 'house', 'medical', 'transport', 'otherAllow', 'pkgId', 'pkgName', 'gross', 'tax', 'pf', 'net'].forEach(function (k) { s[k] = c[k]; });
    // agreed pay-time deductions (auto when null): how much advance / loan EMI
    // the company takes out of THIS month's payment
    if ('advCap' in adj) s.advCap = keepOvr(adj.advCap);
    if ('emiCap' in adj) s.emiCap = keepOvr(adj.emiCap);
    // FINALIZED month? Editing stays open (owner rule) — the accrual is simply
    // RE-POSTED under its stable id, so the books follow the new figures exactly.
    if (run && run.status !== 'draft') accrueSlip(s, s.companyId, ym);
    else S.upsert('pay_slips', s);
    bus.emit('data:changed', { store: 'pay_slips' });
    return s;
  }

  /* The month's adjustments AS THEY STAND — every caller that edits one figure has
   * to hand adjustSlip the whole set, because it recomputes the slip from scratch.
   * Reading them off the slip in ONE place means a new field (fineExtra was the
   * one that showed this up) cannot be silently dropped by one caller and kept by
   * another — which would quietly erase a real deduction. */
  function slipAdj(s) {
    return { leaveDeductDays: s.leaveDeductDays, lateDays: s.lateDays, earlyDays: s.earlyDays,
      overtimeHours: s.overtimeHours, otherDeduction: s.otherDeduction, bonus: s.bonus, adjustment: s.adjustment,
      absentOverride: s.absentOverride, lateOverride: s.lateOverride, earlyOverride: s.earlyOverride, otOverride: s.otOverride,
      fineExtra: s.fineExtra, fineNote: s.fineExtraNote };
  }
  /* A ONE-OFF DISCIPLINARY DEDUCTION on one month (owner 2026-07-29). It ADDS to
   * whatever fine that month already carries — a second incident is a second fine,
   * not a correction of the first — and lands on the payslip as its own line with
   * its reason. `amount` 0 clears the one-off part (the package's standing fine, if
   * any, stays: that is taken off the package). */
  function fineSlip(empId, ym, amount, note) {
    var s = slip(empId, ym);
    if (!s) throw new Error('No payslip for ' + empId + ' in ' + ym);
    var amt = round(amount);
    var adj = slipAdj(s);
    if (amt <= 0) { adj.fineExtra = 0; adj.fineNote = ''; }
    else {
      adj.fineExtra = Math.max(0, round(+s.fineExtra || 0)) + amt;
      var old = (+s.fineExtra > 0 && s.fineExtraNote) ? String(s.fineExtraNote) : '';
      adj.fineNote = [old, note || 'Disciplinary deduction'].filter(Boolean).join(' · ');
    }
    return adjustSlip(empId, ym, adj);
  }

  // Post (or RE-post — stable ids upsert) one slip's accrual + encashment into
  // the GL and refresh its status against what's already been paid.
  function accrueSlip(s, cid, ym) {
    var adjPos = Math.max(0, s.adjustment || 0), adjNeg = Math.max(0, -(s.adjustment || 0));
    var recovered = (s.otherDeduction || 0) + (s.lateDeduction || 0) + (s.earlyDeduction || 0) + (s.fine || 0) + adjNeg;
    /* THE MONTH'S ADVANCE + EMI ARE DEDUCTED HERE (owner 2026-07-30), not at
     * payment. Approving the month is what makes the deduction real, so this is
     * where the two asset accounts come down and where the loan book is told.
     * The figures are FROZEN onto the slip: re-posting reads the same numbers,
     * and the plan excludes the slip's own deduction so a re-post cannot shrink
     * the balance it is sized from.
     *
     * A MONTH THAT WAS ALREADY PAID UNDER THE OLD RULE IS LEFT EXACTLY AS IT WAS
     * POSTED. Its payment journal has already credited 1250/1260 with what it
     * recovered and debited 2100 with the pre-recovery figure; re-posting the new
     * shape over it would credit both assets a second time and drive 2100
     * negative. Settled history is read correctly (slipRecovery/slipPaid) — it is
     * not rewritten. */
    var legacyPaid = !s.deductedAt && (s.paid || 0) > 0;
    var rec = legacyPaid
      ? { adv: round(s.advanceRecovered || 0), emi: round(s.loanRecovered || 0), short: 0 }
      : planRecovery(s);
    if (!legacyPaid) { s.advanceDeduct = rec.adv; s.loanDeduct = rec.emi; s.carryShort = rec.short; s.deductedAt = ym; }
    // AUDIT FIX: recovered deductions REDUCE salary cost — they are not income.
    // (Booking them to 4900 Other Income inflated the group's topline.)
    // Net expense = earned + OT + bonus + adj⁺ − recovered = tax + pf + advance +
    // EMI + payable, so the entry balances by construction.
    var expense = (s.earnedGross || 0) + (s.overtime || 0) + (s.bonus || 0) + (s.tplBonus || 0) + adjPos - recovered;
    var payable = slipPayable(s);
    var lines;
    if (expense >= 0) {
      lines = [{ account: '5100', dr: expense, cr: 0 }];
      if (s.tax) lines.push({ account: '2120', dr: 0, cr: s.tax });
      if (s.pf) lines.push({ account: '2110', dr: 0, cr: s.pf });
    } else {
      // degenerate case (recoveries exceed the month's pay): keep the books
      // legal with the old other-income form rather than a negative debit
      lines = [{ account: '5100', dr: expense + recovered, cr: 0 }];
      if (s.tax) lines.push({ account: '2120', dr: 0, cr: s.tax });
      if (s.pf) lines.push({ account: '2110', dr: 0, cr: s.pf });
      lines.push({ account: '4900', dr: 0, cr: recovered });
    }
    if (!legacyPaid && rec.adv > 0) lines.push({ account: '1250', dr: 0, cr: rec.adv });   // the advance comes back
    if (!legacyPaid && rec.emi > 0) lines.push({ account: '1260', dr: 0, cr: rec.emi });   // …and so does the loan
    lines.push({ account: '2100', dr: 0, cr: payable });
    glPost('GL-PAYA-' + s.empId + '-' + ym, ym + '-01', cid, 'PAY-' + ym, 'Salary accrual · ' + s.empName + ' · ' + ym, 'payroll', s.empId, lines);
    if (s.encashAmt > 0) glPost('GL-ENC-' + s.empId + '-' + ym, ym + '-01', cid, 'ENC-' + ym, 'Leave encashment accrual · ' + s.empName + ' · ' + ym, 'payroll', s.empId,
      [{ account: '5150', dr: s.encashAmt, cr: 0 }, { account: '2150', dr: 0, cr: s.encashAmt }]);
    /* THE LOAN BOOK IS TOLD THE SAME MOMENT (owner: "the loan ledger and the
     * payroll must always agree"). One repayment per slip under a STABLE id, so
     * re-posting the accrual restates it instead of adding a second one, and
     * `slipId` is what lets the plan and unfinalize find their own row again. */
    var emiTxnId = 'PT-EMI-' + s.empId + '-' + ym;
    if (!legacyPaid) {
      if (rec.emi > 0) {
        S.upsert('pay_txns', { id: emiTxnId, type: 'loan-repay', empId: s.empId, empName: s.empName, companyId: cid,
          date: ym + '-01', amount: rec.emi, slipId: s.id, method: 'Salary deduction',
          memo: 'EMI deducted from ' + mLabel(ym) + ' salary' });
      } else {
        S.set('pay_txns', S.list('pay_txns').filter(function (x) { return x.id !== emiTxnId; }));
      }
      bus.emit('data:changed', { store: 'pay_txns' });
    }
    var paidCash = slipPaid(s);
    s.status = paidCash >= payable ? 'paid' : (paidCash > 0 ? 'partial' : 'accrued');
    S.upsert('pay_slips', s);
  }

  /* ============ THE ROW-BY-ROW PROOF (owner 2026-07-30) ======================
   * "Before a payroll run can be approved, check every row: earnings − all
   * deductions = net payable. If any row fails, block approval and show which
   * rows and by how much."
   *
   * It re-derives the arithmetic from the slip's own fields rather than calling
   * slipPayable — a check that asks the same function it is checking proves
   * nothing. A row fails if the two disagree by a taka or more, if the net is
   * negative, or if the month tried to recover more than the employee owes.
   * Returns { ok, rows[], failed[], shorted[] } and never throws: the caller
   * decides what to do with a failure. */
  function runCheck(cid, ym) {
    var rows = slipsFor(cid, ym).map(function (s) {
      var r = slipRecovery(s);
      var earnings = round((s.earnedGross || 0) + (s.overtime || 0) + (s.bonus || 0) + (s.tplBonus || 0) + Math.max(0, s.adjustment || 0));
      var deductions = round((s.tax || 0) + (s.pf || 0) + (s.otherDeduction || 0) + (s.lateDeduction || 0)
        + (s.earlyDeduction || 0) + (s.fine || 0) + Math.max(0, -(s.adjustment || 0)) + r.adv + r.emi);
      var expected = round(earnings - deductions), actual = slipPayable(s);
      var diff = round(actual - expected);
      return { empId: s.empId, empName: s.empName, earnings: earnings, deductions: deductions,
        advance: r.adv, emi: r.emi, expected: expected, actual: actual, diff: diff,
        negative: expected < 0, short: r.short || 0,
        ok: Math.abs(diff) < 1 && expected >= 0 };
    });
    var failed = rows.filter(function (r) { return !r.ok; });
    return { ok: !failed.length, cid: cid, ym: ym, rows: rows, failed: failed,
      shorted: rows.filter(function (r) { return r.short > 0; }) };
  }

  /* ================ EMI RECORDED BUT NEVER DEDUCTED (owner 2026-07-30) ========
   * "Recheck every past month from the first run to July 2026 and tell me the
   * total amount of loan EMI that was recorded but never actually deducted."
   *
   * Under the old rule the EMI came off at PAYMENT time, so every month that was
   * approved and not yet paid printed an EMI on the salary sheet that had touched
   * neither the net, the cash nor the loan book. This walks every non-draft slip
   * ever written and reports, per month and per person, the EMI the sheet showed
   * against the EMI that actually moved. A slip approved under the new rule shows
   * a gap of zero by construction — the accrual deducted it. */
  function emiGap(opts) {
    opts = opts || {};
    var out = { total: 0, advanceTotal: 0, months: {}, rows: [] };
    S.list('pay_slips').filter(function (s) {
      return s.status !== 'draft' && (!opts.companyId || s.companyId === opts.companyId)
        && (!opts.untilYm || s.ym <= opts.untilYm);
    }).sort(function (a, b) { return a.ym < b.ym ? -1 : (a.ym > b.ym ? 1 : 0); }).forEach(function (s) {
      var shown = s.deductedAt ? round(s.loanDeduct || 0)
        : ((s.paid || 0) > 0 ? round(s.loanRecovered || 0) : planRecovery(s).emi);
      var moved = round((s.deductedAt ? (s.loanDeduct || 0) : 0) + (s.deductedAt ? 0 : (s.loanRecovered || 0)));
      var advShown = s.deductedAt ? round(s.advanceDeduct || 0)
        : ((s.paid || 0) > 0 ? round(s.advanceRecovered || 0) : planRecovery(s).adv);
      var advMoved = round((s.deductedAt ? (s.advanceDeduct || 0) : 0) + (s.deductedAt ? 0 : (s.advanceRecovered || 0)));
      var gap = round(shown - moved), advGap = round(advShown - advMoved);
      if (gap <= 0 && advGap <= 0) return;
      out.total += gap; out.advanceTotal += advGap;
      out.months[s.ym] = round((out.months[s.ym] || 0) + gap);
      out.rows.push({ ym: s.ym, empId: s.empId, empName: s.empName, companyId: s.companyId,
        status: s.status, emiShown: shown, emiDeducted: moved, gap: gap, advanceGap: advGap });
    });
    out.total = round(out.total); out.advanceTotal = round(out.advanceTotal);
    return out;
  }

  /* ============ MONEY EVENTS WITH NO JOURNAL (audit 2026-07-30) ==============
   * The books can only be trusted if every advance, loan, repayment and bonus in
   * pay_txns has an entry behind it. This finds the ones that do not — by AMOUNT
   * against the account each type must have touched, so it catches a journal that
   * was overwritten (see txnGlId) as well as one that was never written.
   * READ-ONLY on purpose: it reports, it does not post. Posting a journal for a
   * record is a decision about someone's books, not a repair a page load makes. */
  function journalGap(opts) {
    opts = opts || {};
    var WANT = { advance: { acct: '1250', side: 'dr' }, loan: { acct: '1260', side: 'dr' },
                 'loan-repay': { acct: '1260', side: 'cr' }, bonus: { acct: '5100', side: 'dr' } };
    var entries = (L() && L().entries) ? L().entries() : [];
    var used = {};
    var out = { total: 0, rows: [] };
    S.list('pay_txns').filter(function (x) {
      return WANT[x.type] && (!opts.companyId || x.companyId === opts.companyId);
    }).sort(function (a, b) { return (a.date || '') < (b.date || '') ? -1 : 1; }).forEach(function (x) {
      // an EMI deducted from a payslip is carried by that month's ACCRUAL entry,
      // not by one of its own — it is not missing, it is somewhere else
      if (x.type === 'loan-repay' && x.slipId) return;
      var w = WANT[x.type], amt = round(x.amount);
      var hit = entries.filter(function (e) {
        if (used[e.id]) return false;
        if (e.party && x.empId && e.party !== x.empId) return false;
        return (e.lines || []).some(function (l) { return l.account === w.acct && Math.abs(round(l[w.side] || 0) - amt) < 1; });
      })[0];
      if (hit) { used[hit.id] = true; return; }
      out.total += amt;
      out.rows.push({ txnId: x.id, type: x.type, ym: String(x.date || '').slice(0, 7), date: x.date,
        empId: x.empId, empName: x.empName, companyId: x.companyId, amount: amt, memo: x.memo || '' });
    });
    out.total = round(out.total);
    return out;
  }

  // Finalize: lock the run and ACCRUE every payslip into the GL (idempotent per head).
  // The row-by-row proof runs FIRST and a failure blocks the approval outright —
  // an unbalanced row must not reach the general ledger.
  function finalize(cid, ym) {
    var run = generate(cid, ym);
    if (run.status !== 'draft') return run;
    var chk = runCheck(cid, ym);
    if (!chk.ok) {
      var err = new Error('Payroll check failed on ' + chk.failed.length + ' row(s) — approval blocked.');
      err.check = chk; throw err;
    }
    slipsFor(cid, ym).forEach(function (s) { accrueSlip(s, cid, ym); });
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
      /* …and UN-DEDUCT the month. The accrual is what took the advance and the
       * EMI (owner 2026-07-30), so walking back past it must give both back:
       * the frozen figures come off the slip and the salary repayment leaves the
       * loan book, which is the only thing keeping the loan ledger and the
       * payroll in step. Re-finalizing plans and posts them again. */
      S.set('pay_txns', S.list('pay_txns').filter(function (x) { return x.id !== 'PT-EMI-' + s.empId + '-' + ym; }));
      s.deductedAt = null; s.advanceDeduct = 0; s.loanDeduct = 0; s.carryShort = 0;
      s.status = 'draft'; S.upsert('pay_slips', s);
    });
    bus.emit('data:changed', { store: 'pay_txns' });
    run.status = 'draft'; run.finalizedAt = null; S.upsert('pay_runs', run);
    bus.emit('data:changed', { store: 'pay_runs' });
    return run;
  }

  /* Pay a slip (full by default, or a partial `amount`). Recovers outstanding advance first.
   *
   * `method` may now be a PAYMENT SOURCE as well as a plain label (owner 2026-07-27):
   * pass 'bank:<id>' — the value the shared account pickers use — and the salary
   * leaves THAT account: its own GL side (a cash box IS hard cash 1000), its balance,
   * and a row in its transaction history. Passing 'Bank'/'Cash' as before still works
   * and behaves exactly as it always did, so no existing caller changes.
   *
   * A PARTIAL payment leaves the rest where it belongs: 2100 Salary Payable keeps the
   * unpaid balance — that is the company's debt to the employee — and the slip reads
   * 'partial' until it is cleared. */
  /* opts.date — pay it AS OF a past date, for back-filling a real month
   * (the sample-payroll generator). Everything else is unchanged and every
   * existing caller keeps today. */
  function pay(empId, ym, amount, method, opts) {
    var when = (opts && opts.date) || today();
    var s = slip(empId, ym); if (!s) throw new Error('No payslip for ' + empId + ' ' + ym);
    var run = getRun(s.companyId, ym);
    if (!run || run.status === 'draft') throw new Error('Finalize the payroll before paying.');
    /* A MONTH ACCRUED UNDER THE OLD RULE HEALS ITSELF HERE (owner 2026-07-30).
     * Its accrual credited 2100 with the pre-recovery figure and told 1250/1260
     * nothing; paying it as cash-only would leave the advance and the EMI stranded
     * in Salary Payable for ever. Nothing has moved on it yet (paid is 0), so
     * re-posting the accrual under its stable id is safe and exact: the entry is
     * restated, the loan book is told, and the payment below is plain cash. */
    if (!s.deductedAt && !(s.paid > 0)) { accrueSlip(s, s.companyId, ym); s = slip(empId, ym) || s; }
    var payable = slipPayable(s);
    var outstanding = payable - slipPaid(s);
    var amt = amount == null ? outstanding : clamp(round(amount), 0, outstanding);
    if (amt <= 0) return s;
    /* THE RECOVERIES ARE ALREADY OFF THE PAYABLE. Net payable IS the cash to hand
     * over (the advance and the EMI came off when the month was approved), so a
     * payment moves cash and nothing else. Only a slip still running under the old
     * rule — one that was part-paid before this change — keeps the old split, so
     * a half-settled month is never re-cut mid-flight. */
    var legacy = !s.deductedAt && (s.paid || 0) > 0;
    var recover = 0, emiRecover = 0;
    if (legacy) {
      var advWant = (s.advCap == null || s.advCap === '') ? advanceOutstanding(empId, s.id) : Math.min(advanceOutstanding(empId, s.id), round(+s.advCap));
      var emiWant = (s.emiCap == null || s.emiCap === '') ? emiInstallment(empId, s.id) : round(+s.emiCap);
      advWant = Math.min(advWant, onBooks('1250', s.companyId));
      emiWant = Math.min(emiWant, onBooks('1260', s.companyId));
      recover = clamp(advWant, 0, amt);                // agreed advance recovery out of this pay
      emiRecover = clamp(emiWant, 0, amt - recover);   // agreed loan EMI installment
    }
    var cash = amt - recover - emiRecover;
    // WHICH account pays the salary. 'bank:<id>' names a real one; anything else
    // keeps the old generic behaviour (Cash → 1000, everything else → 1010).
    var src = (EPAL.pay && EPAL.pay.resolve && String(method || '').indexOf('bank:') === 0)
      ? EPAL.pay.resolve(method) : null;
    var cashAcct = src ? src.gl : (method === 'Cash' ? '1000' : '1010');
    var lines = [{ account: '2100', dr: amt, cr: 0 }];
    if (recover > 0) lines.push({ account: '1250', dr: 0, cr: recover });
    if (emiRecover > 0) lines.push({ account: '1260', dr: 0, cr: emiRecover });   // reduce the staff loan
    lines.push({ account: cashAcct, dr: 0, cr: cash });
    var glId = 'GL-PAYP-' + s.empId + '-' + ym + '-' + ((s.payCount || 0) + 1);
    glPost(glId, when, s.companyId, 'PAY-' + ym, 'Salary paid · ' + s.empName + ' · ' + ym +
      (src && src.bank ? ' · ' + src.bank.name : ''), 'payroll', s.empId, lines);
    // …and the account's own book, for the cash that actually left it (recoveries
    // are book entries against the employee, not money out of the account)
    if (src && src.bank && cash > 0 && EPAL.pay.syncRegister) {
      EPAL.pay.syncRegister({ id: glId, bankId: src.bank.id, kind: 'Expense', amount: cash,
        category: 'Salary · ' + mLabel(ym), party: s.empName || s.empId, ref: 'PAY-' + ym,
        date: when, companyId: s.companyId, glId: glId }, null);
    }
    if (emiRecover > 0) txn({ type: 'loan-repay', empId: empId, empName: s.empName, companyId: s.companyId, date: when, amount: emiRecover, memo: 'EMI auto-deducted from ' + mLabel(ym) + ' salary' });
    s.paid = (s.paid || 0) + amt; s.advanceRecovered = (s.advanceRecovered || 0) + recover; s.loanRecovered = (s.loanRecovered || 0) + emiRecover;
    s.payMethod = method || s.payMethod || 'Bank'; s.payCount = (s.payCount || 0) + 1; s.paidDate = when;
    s.status = slipPaid(s) >= payable ? 'paid' : 'partial';
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
    // drop the auto-EMI txns this month's PAYMENTS recorded (loan balance restores).
    // The accrual's own repayment (PT-EMI-…, written when the month was approved)
    // is deliberately spared: un-paying a month does not un-approve it, and the
    // deduction belongs to the accrual — unfinalize is what gives that one back.
    S.set('pay_txns', S.list('pay_txns').filter(function (x) {
      return !(x.empId === empId && x.type === 'loan-repay' && x.id !== 'PT-EMI-' + empId + '-' + ym
        && String(x.memo || '').indexOf('EMI auto-deducted from ' + mLabel(ym)) === 0);
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

  /* WHICH ACCOUNT THE MONEY MOVES THROUGH (audit 2026-07-28).
   * pay() has named a real account since the July review; advance, staff loan,
   * loan repayment, bonus and leave encashment did not — they all posted to the
   * abstract 1010 and moved no register, so handing an employee ৳20,000 changed
   * the ledger and left every bank balance and every account history untouched.
   * One helper now does for all of them what pay() does: resolve 'bank:<id>' to
   * a real account, post to THAT account's own code, and move its register.
   *   opts.method — 'bank:<id>' names a real account; 'Cash' → 1000; else 1010
   *   dir         — 'out' money leaves the account · 'in' money arrives */
  function payThrough(opts, dir, amount, ref, label, empId, cid, glId) {
    var method = (opts && opts.method) || '';
    var src = (EPAL.pay && EPAL.pay.resolve && String(method).indexOf('bank:') === 0)
      ? EPAL.pay.resolve(method) : null;
    var acct = src ? src.gl : (method === 'Cash' ? '1000' : '1010');
    if (src && src.bank && amount > 0 && EPAL.pay.syncRegister) {
      EPAL.pay.syncRegister({ id: glId, bankId: src.bank.id, kind: dir === 'in' ? 'Income' : 'Expense',
        amount: amount, category: label, party: empName(empId) || empId, ref: ref,
        date: (opts && opts.date) || today(), companyId: cid, glId: glId }, null);
    }
    return { account: acct, name: src && src.bank ? src.bank.name : '' };
  }
  /* ============ A JOURNAL ID IS AN IDENTITY, NOT A COUNT ====================
   * (audit 2026-07-30 — the demo book shipped ৳92,000 of staff loans that had a
   * pay_txns record and NO journal, so 1260 read ৳4 while the loan register read
   * ৳92,004.)
   *
   * Every one of these postings used to name its entry
   * GL-LOAN-<emp>-<how many loans this person already has + 1>. A COUNT IS NOT AN
   * IDENTITY: delete or reorder one money event — unpay() deletes repayment rows,
   * a correction removes an advance — and the next posting computes a number that
   * is already in use. glPost upserts by id, so it does not ADD an entry, it
   * OVERWRITES the live one: the record survives, its journal does not, and the
   * ledger silently understates by exactly that amount. Proved with two loans and
   * one deletion.
   *
   * The txn's own id is unique for ever (PT-<time36>-<random>), so the entry is
   * built FROM it and can never collide. Rows posted under the old scheme keep
   * their ids — nothing re-posts them — so no history moves. */
  function txnGlId(prefix, rec) { return 'GL-' + prefix + '-' + rec.id; }
  function advance(empId, amount, opts) {
    opts = opts || {}; amount = round(amount); if (amount <= 0) return null;
    var cid = compOf(empId);
    var rec = txn({ type: 'advance', empId: empId, empName: empName(empId), companyId: cid, date: opts.date || today(), amount: amount, method: opts.method || 'Bank', memo: opts.memo || 'Advance salary' });
    var glId = txnGlId('ADV', rec);
    var src = payThrough(opts, 'out', amount, 'ADV-' + empId, 'Advance salary', empId, cid, glId);
    glPost(glId, opts.date || today(), cid, 'ADV-' + empId,
      'Advance salary · ' + empName(empId) + (src.name ? ' · ' + src.name : ''), 'payroll', empId,
      [{ account: '1250', dr: amount, cr: 0 }, { account: src.account, dr: 0, cr: amount }]);
    return rec;
  }
  /* ====================================================================== *
   * ADVANCE SALARY REQUESTS — the ask, and the decision on it
   * ---------------------------------------------------------------------
   * Owner 2026-07-29: "in the advance salary option, employees' advance salary
   * request option will appear, boss will allow or disallow, also can customize
   * the amount. For which month advanced — that should indicate."
   *
   * Until now advance() fired immediately: whoever opened the form moved the
   * money. That is the whole gap — there was no ask, so there was nothing to
   * allow or disallow. A REQUEST is now a record in its own right and approval is
   * what disburses; nothing leaves an account until someone decides.
   *
   * WHICH MONTH. An advance is taken against a FUTURE month's salary, and which
   * month was never recorded anywhere — the advance transaction has no such
   * field. `forYm` is that missing fact, defaulted to next month because that is
   * what "advance salary" almost always means, and shown wherever the request is.
   *
   * THE AMOUNT ON THE REQUEST IS THE ASK, NOT THE ANSWER. The approver may
   * disburse a different figure (asked 20,000, approved 12,000 — extremely common),
   * so the record keeps BOTH: `amount` is what was requested, forever, and
   * `approvedAmount` is what was actually paid. Overwriting the ask would erase
   * the fact that a decision was made at all.
   *
   * store pay_adv_requests
   *   { id, empId, empName, companyId, amount, forYm, reason, status:
   *     pending|approved|rejected, requestedOn, requestedBy,
   *     decidedOn, decidedBy, approvedAmount, note, txnId }
   * ====================================================================== */
  function advRequests(f) {
    f = f || {};
    return S.list('pay_adv_requests').filter(function (r) {
      if (f.companyId && r.companyId !== f.companyId) return false;
      if (f.status && r.status !== f.status) return false;
      if (f.empId && r.empId !== f.empId) return false;
      return true;
    }).sort(function (a, b) { return (a.requestedOn || '') < (b.requestedOn || '') ? 1 : -1; });
  }
  function advRequest(id) { return S.list('pay_adv_requests').filter(function (r) { return r.id === id; })[0] || null; }
  // the month AFTER ym — an advance is against pay not yet earned
  function nextYm(ym) {
    var y = +String(ym).slice(0, 4), m = +String(ym).slice(5, 7) + 1;
    if (m > 12) { m = 1; y++; }
    return y + '-' + String(m).padStart(2, '0');
  }
  function requestAdvance(empId, amount, opts) {
    opts = opts || {};
    amount = round(amount);
    if (!empId) throw new Error('Choose an employee.');
    if (amount <= 0) throw new Error('Enter how much is being asked for.');
    var cid = compOf(empId);
    var req = {
      id: 'AR-' + empId + '-' + String(S.list('pay_adv_requests').length + 1).padStart(3, '0'),
      empId: empId, empName: empName(empId), companyId: cid,
      amount: amount,
      forYm: opts.forYm || nextYm(curYm()),
      reason: opts.reason || '',
      status: 'pending',
      requestedOn: opts.date || today(),
      requestedBy: opts.by || empId,
      approvedAmount: 0, decidedOn: '', decidedBy: '', note: '', txnId: ''
    };
    S.upsert('pay_adv_requests', req);
    bus.emit('data:changed', { store: 'pay_adv_requests' });
    if (EPAL.audit && EPAL.audit.record) {
      try { EPAL.audit.record({ action: 'create', entity: 'pay_adv_requests', entityId: req.id,
        entityLabel: 'Advance request · ' + req.empName + ' · ' + round(amount), companyId: cid }); } catch (e) {}
    }
    return req;
  }
  /* APPROVE (optionally for a different amount) or REJECT.
   * Approval is the only thing that moves money: it calls advance(), so the
   * request inherits the whole existing chain — DR 1250 / CR the named account,
   * the account's own register row, and automatic recovery from a later payslip.
   * A rejection needs a reason: "no" without a why is not a decision anyone can
   * act on later. */
  function decideAdvance(id, decision, opts) {
    opts = opts || {};
    var req = advRequest(id);
    if (!req) throw new Error('Request not found.');
    if (req.status !== 'pending') throw new Error('This request was already ' + req.status + '.');
    if (decision === 'rejected') {
      if (!String(opts.note || '').trim()) throw new Error('Give a reason for turning it down.');
      req.status = 'rejected';
      req.note = String(opts.note).trim();
    } else {
      var amt = (opts.amount == null || opts.amount === '') ? req.amount : round(opts.amount);
      if (amt <= 0) throw new Error('An approved advance has to be more than zero.');
      var txn = advance(req.empId, amt, {
        date: opts.date || today(), method: opts.method,
        memo: 'Advance salary · against ' + mLabel(req.forYm)
      });
      req.status = 'approved';
      req.approvedAmount = amt;                 // what was PAID — req.amount stays the ask
      req.note = String(opts.note || '').trim();
      req.txnId = txn ? txn.id : '';
    }
    req.decidedOn = opts.date || today();
    req.decidedBy = opts.by || (EPAL.auth && EPAL.auth.current ? (EPAL.auth.current() || {}).id : '') || '';
    S.upsert('pay_adv_requests', req);
    bus.emit('data:changed', { store: 'pay_adv_requests' });
    if (EPAL.audit && EPAL.audit.record) {
      try { EPAL.audit.record({ action: 'update', entity: 'pay_adv_requests', entityId: req.id,
        entityLabel: 'Advance ' + req.status + ' · ' + req.empName, companyId: req.companyId }); } catch (e) {}
    }
    return req;
  }

  function loan(empId, amount, opts) {
    opts = opts || {}; amount = round(amount); if (amount <= 0) return null;
    var cid = compOf(empId);
    var rec = txn({ type: 'loan', empId: empId, empName: empName(empId), companyId: cid, date: opts.date || today(), amount: amount, method: opts.method || 'Bank', memo: opts.memo || 'Staff loan', emiMonths: +opts.emiMonths || 0 });
    var glId = txnGlId('LOAN', rec);
    var src = payThrough(opts, 'out', amount, 'LOAN-' + empId, 'Staff loan', empId, cid, glId);
    glPost(glId, opts.date || today(), cid, 'LOAN-' + empId,
      'Staff loan · ' + empName(empId) + (src.name ? ' · ' + src.name : ''), 'payroll', empId,
      [{ account: '1260', dr: amount, cr: 0 }, { account: src.account, dr: 0, cr: amount }]);
    return rec;
  }
  function repayLoan(empId, amount, opts) {
    opts = opts || {}; amount = round(amount); if (amount <= 0) return null;
    var cid = compOf(empId);
    var rec = txn({ type: 'loan-repay', empId: empId, empName: empName(empId), companyId: cid, date: opts.date || today(), amount: amount, method: opts.method || 'Bank', memo: opts.memo || 'Loan repayment' });
    var glId = txnGlId('LREP', rec);
    var src = payThrough(opts, 'in', amount, 'LREP-' + empId, 'Staff loan repayment', empId, cid, glId);
    glPost(glId, opts.date || today(), cid, 'LREP-' + empId,
      'Loan repayment · ' + empName(empId) + (src.name ? ' · ' + src.name : ''), 'payroll', empId,
      [{ account: src.account, dr: amount, cr: 0 }, { account: '1260', dr: 0, cr: amount }]);
    return rec;
  }
  function bonus(empId, amount, opts) {
    opts = opts || {}; amount = round(amount); if (amount <= 0) return null;
    var cid = compOf(empId);
    var rec = txn({ type: 'bonus', empId: empId, empName: empName(empId), companyId: cid, date: opts.date || today(), amount: amount, method: opts.method || 'Bank', memo: opts.memo || 'Bonus' });
    var glId = txnGlId('BON', rec);
    var src = payThrough(opts, 'out', amount, 'BON-' + empId, 'Bonus', empId, cid, glId);
    glPost(glId, opts.date || today(), cid, 'BON-' + empId,
      'Bonus · ' + empName(empId) + (src.name ? ' · ' + src.name : ''), 'payroll', empId,
      [{ account: '5100', dr: amount, cr: 0 }, { account: src.account, dr: 0, cr: amount }]);
    return rec;
  }

  /* ----------------------------------------------------- derived balances */
  function txnsFor(empId) { return S.list('pay_txns').filter(function (x) { return x.empId === empId; }); }
  /* `exceptSlip` — the slip currently being PLANNED or RE-ACCRUED. Its own
   * deduction must not count against the balance it is being sized from, or
   * re-posting an accrual would shrink the very figure it is re-posting (the
   * second pass would deduct half, the third a quarter…). Everyone else's
   * deduction counts, which is what makes two months in a row recover twice. */
  function advanceOutstanding(empId, exceptSlip) {
    var given = txnsFor(empId).filter(function (x) { return x.type === 'advance'; }).reduce(function (a, x) { return a + x.amount; }, 0);
    var recovered = S.list('pay_slips').filter(function (s) { return s.empId === empId && s.id !== exceptSlip; })
      .reduce(function (a, s) { return a + (s.deductedAt ? (s.advanceDeduct || 0) : (s.advanceRecovered || 0)); }, 0);
    var settled = txnsFor(empId).filter(function (x) { return x.type === 'settlement'; }).reduce(function (a, x) { return a + (x.advanceCleared || 0); }, 0);
    return Math.max(0, given - recovered - settled);
  }
  function loanOutstanding(empId, exceptSlip) {
    var t = txnsFor(empId);
    var given = t.filter(function (x) { return x.type === 'loan'; }).reduce(function (a, x) { return a + x.amount; }, 0);
    /* ⚠ THE BUG THIS GUARD FIXES (found 2026-07-30 by footing the loan register:
     * the register summed ৳92,004 still due while this function said ৳3,59,505).
     * A MANUAL repayment — cash or bank, not deducted from a payslip — carries no
     * slipId. The test used to be `x.slipId !== exceptSlip`, and with no
     * exceptSlip passed that reads `undefined !== undefined`, which is FALSE — so
     * every hand-recorded repayment was silently dropped and the loan stayed
     * outstanding at its full principal for ever. It also fed emiInstallment(),
     * which caps the monthly deduction at this figure, so payroll would keep
     * recovering EMI from a loan the employee had already paid off in cash.
     * Exclude a slip's own repayment ONLY when a slip is actually being sized. */
    var repaid = t.filter(function (x) {
      return x.type === 'loan-repay' && !(exceptSlip && x.slipId === exceptSlip);
    }).reduce(function (a, x) { return a + x.amount; }, 0);
    var settled = t.filter(function (x) { return x.type === 'settlement'; }).reduce(function (a, x) { return a + (x.loanCleared || 0); }, 0);
    return Math.max(0, given - repaid - settled);
  }
  /* ------------------------------------------------------------- LOAN BOOK
   * loanOutstanding() above answers "how much does this person still owe" —
   * one number for the whole person. But a loan is a THING that happened:
   * "৳20,000 taken on 20 May, ৳6,000 back so far, ৳14,000 still due, and it
   * came back out of salary." Every loan row in the app has to be able to say
   * that (owner 2026-07-29), and nothing in the store does today.
   *
   * The engine records MOVEMENTS, not loan documents — a `loan` txn out,
   * `loan-repay` txns back (manual or the auto payslip EMI), and a final
   * settlement clearing whatever is left. So the book is REBUILT here the way
   * the money actually moved: every disbursement is a loan, and every
   * repayment is applied to the OLDEST loan still open — FIFO, the way a
   * cashier clears the oldest bill first. It is a read; nothing is stored, so
   * no existing number moves.
   *
   * It agrees with loanOutstanding() by construction rather than by care:
   * FIFO allocates min(given, repaid + settled), so Σ due across the book is
   * max(0, given − repaid − settled) — that function, line for line. Money
   * repaid beyond everything ever lent (bad data) allocates to nothing and is
   * dropped, exactly as the Math.max(0, …) there drops it.
   *
   * Returns, oldest first: { id, seq, date, principal, paid, due, emiMonths,
   * emi, method, memo, closed, closedOn, lastPaidOn, viaSalary, viaCash,
   * payments:[{ date, amount, kind:'salary'|'cash'|'settlement', method, memo,
   * balance }] }.
   */
  /* IS THIS REPAYMENT A SALARY DEDUCTION, or money the employee handed back?
   * The loan register answers "repaid via" from this, and it used to answer by
   * sniffing the memo for one exact phrase. Since the deduction moved to the
   * ACCRUAL (owner 2026-07-30) the phrase changed — "EMI deducted from July 2026
   * salary", no "auto-" — and every EMI taken out of a payslip was being filed as
   * cash the employee walked in with. The txn now SAYS which it is: an accrual
   * repayment carries the slip it came out of. The memo test stays for the rows
   * written before that field existed. */
  function isEmiRepay(x) { return !!(x && (x.slipId || isEmiMemo(x.memo))); }
  function isEmiMemo(memo) { return /^EMI (auto-)?deducted from /.test(String(memo || '')); }
  function loanBook(empId) {
    var t = txnsFor(empId).slice().sort(function (a, b) {
      if (a.date === b.date) return String(a.id) < String(b.id) ? -1 : 1;
      return a.date < b.date ? -1 : 1;
    });
    var loans = [], pays = [];
    t.forEach(function (x) {
      if (x.type === 'loan') {
        var amt = round(x.amount);
        loans.push({ id: x.id, empId: empId, empName: x.empName || empName(empId), companyId: x.companyId,
          date: x.date, principal: amt, due: amt, paid: 0,
          emiMonths: +x.emiMonths || 0, emi: (+x.emiMonths || 0) ? Math.round(amt / (+x.emiMonths)) : 0,
          // WHICH ACCOUNT handed the loan over — see "where the money moved" below
          method: x.method || '', source: methodSource(x.method), memo: x.memo || '', seq: loans.length + 1,
          closed: false, closedOn: '', lastPaidOn: '', viaSalary: 0, viaCash: 0, payments: [] });
      } else if (x.type === 'loan-repay') {
        var emi = isEmiRepay(x);
        pays.push({ txnId: x.id, date: x.date, amount: round(x.amount), method: x.method || '',
          memo: x.memo || '', kind: emi ? 'salary' : 'cash',
          // where the money came back FROM: the salary it was deducted out of, or
          // the account it was received into
          source: emi ? 'Deducted from the ' + emiFrom(x.memo) : methodSource(x.method) });
      } else if (x.type === 'settlement' && (+x.loanCleared || 0) > 0) {
        pays.push({ txnId: x.id, date: x.date, amount: round(x.loanCleared), method: x.method || '',
          memo: x.memo || 'Final settlement', kind: 'settlement',
          source: 'Cleared in the final settlement' });
      }
    });
    pays.forEach(function (p) {
      var left = p.amount;
      for (var i = 0; i < loans.length && left > 0; i++) {
        var L = loans[i];
        if (L.due <= 0) continue;
        var take = Math.min(L.due, left);
        L.due -= take; L.paid += take; left -= take;
        if (p.kind === 'salary') L.viaSalary += take; else L.viaCash += take;
        L.lastPaidOn = p.date;
        L.payments.push({ txnId: p.txnId, date: p.date, amount: take, kind: p.kind,
          method: p.method, source: p.source, memo: p.memo, balance: L.due });
        if (L.due <= 0 && !L.closed) { L.closed = true; L.closedOn = p.date; }
      }
    });
    return loans;
  }

  // the monthly EMI to auto-deduct from salary = Σ(loan amount ÷ emiMonths) for loans
  // set up with an installment plan, capped at what's still owed.
  function emiInstallment(empId, exceptSlip) {
    var emi = txnsFor(empId).filter(function (x) { return x.type === 'loan' && (+x.emiMonths || 0) > 0; })
      .reduce(function (a, x) { return a + Math.round(x.amount / x.emiMonths); }, 0);
    return Math.min(emi, loanOutstanding(empId, exceptSlip));
  }
  /* ====================================================== WHERE THE MONEY MOVED
   * Owner 2026-07-29: "all transactions across payroll should contain from where
   * the transaction has been done — the company paid from which bank or cash;
   * a loan repayment was done from the employee's salary, or from bank / cash."
   *
   * NOTHING NEW IS STORED. Every payroll movement already knows its account, in
   * one of two places, and this reads both:
   *   · the JOURNAL is the definitive answer — its cash line names the real
   *     account the money moved through, and ONE salary payment can carry a bank
   *     line AND advance/loan recovery lines. That is the difference between
   *     "৳17,911 left the bank" and "৳16,000 left the bank, ৳1,911 was recovered
   *     out of the same payment and never touched an account";
   *   · the transaction's own `method`, for a movement whose journal cannot be
   *     addressed by a stable id (advance/loan/bonus ids are rebuilt from a
   *     counter, and unpay() shifts that counter — see payroll.js monthTxns).
   *
   * A stored method is 'bank:<id>' (a real account), 'm:<Method>' (a generic with
   * no account behind it), or a LEGACY PLAIN 'Bank' / 'Cash' / 'bKash'. EPAL.pay
   * .resolve() cannot be used as the reader: handed a plain 'Cash' it falls
   * through to its Bank default, so every legacy cash payment would read as a
   * bank payment. The plain case is therefore answered BEFORE resolve() is asked.
   *
   * The engine never formats money, so a row carries the FIGURES and the view
   * writes the sentence:
   *   source        one line naming the account / the salary it came out of
   *   sourceKind    'account' money moved through a real account · 'salary' it
   *                 was taken out of a salary and no cash moved · 'accrual'
   *                 nothing was paid at all · 'internal' recovered, not paid
   *   sourceDir     'out' left the company · 'in' came back · '' nothing moved
   *   sourceCash    what actually left/entered an account
   *   sourceOffset  the part of the row that never touched cash (recovery)
   *   sourceGuess   true when the answer comes from the record's own method
   *                 because no journal accounts for it (older / seeded data)
   * ======================================================================== */
  function acctLabel(code) {
    if (!code) return '';
    var a = (L() && L().account) ? L().account(code) : null;
    return a ? a.name : String(code);
  }
  function methodSource(method) {
    var m = String(method || '');
    if (m.indexOf('bank:') === 0) {
      var src = (EPAL.pay && EPAL.pay.resolve) ? EPAL.pay.resolve(m) : null;
      if (src && src.bank) return src.bank.name + (src.bank.branch && src.bank.branch !== '—' ? ' · ' + src.bank.branch : '');
      return 'Account no longer on file';          // the bank record was deleted — say so
    }
    if (m.indexOf('m:') === 0) return m.slice(2) || 'Bank';
    return m || 'Bank';                            // legacy plain label, kept verbatim
  }
  function glById(id) {
    var rows = S.list('gl_entries');
    for (var i = 0; i < rows.length; i++) if (rows[i].id === id) return rows[i];
    return null;
  }
  /* The cash side of a journal: which accounts, and the SIGNED net. Positive is
   * money leaving (a credit to cash), negative is money arriving — a loan
   * repayment is DR cash / CR 1260, so reading its cash as an outflow would add
   * money that came IN to the money that went OUT. */
  function glCash(e) {
    var names = [], net = 0;
    ((e && e.lines) || []).forEach(function (l) {
      if (!(L() && L().isCashAccount && L().isCashAccount(l.account))) return;
      var v = (+l.cr || 0) - (+l.dr || 0);
      if (!v) return;
      net += v;
      var n = acctLabel(l.account);
      if (n && names.indexOf(n) < 0) names.push(n);
    });
    // two accounts in one voucher is legal and worth saying plainly
    return { names: names, label: names.join(' + '), net: net };
  }
  // 'EMI auto-deducted from July 2026 salary' → 'July 2026 salary'
  // "EMI deducted from July 2026 salary" / the older "auto-deducted" form → "July 2026 salary"
  function emiFrom(memo) { return String(memo || '').replace(/^EMI (auto-)?deducted from /, '') || 'the salary'; }

  /* Where ONE salary payment row came from. A month can be paid in instalments,
   * so every live GL-PAYP journal for the slip is read and the accounts are
   * merged; a REVERSED instalment (unpay() posts GL-UNPAY and deliberately keeps
   * payCount so reversal ids stay unique) names no account, because that money
   * came back. With no journal at all the slip's own last method answers, marked
   * as a guess rather than dressed up as a fact. */
  function slipPaidSource(s) {
    var names = [], cash = 0, found = 0;
    for (var n = 1; n <= (s.payCount || 0); n++) {
      var e = glById('GL-PAYP-' + s.empId + '-' + s.ym + '-' + n);
      if (!e || glById('GL-UNPAY-' + s.empId + '-' + s.ym + '-' + n)) continue;
      var c = glCash(e);
      found++; cash += c.net;
      c.names.forEach(function (x) { if (names.indexOf(x) < 0) names.push(x); });
    }
    var recovered = round((s.advanceRecovered || 0) + (s.loanRecovered || 0));
    if (!found) return { source: methodSource(s.payMethod), sourceKind: 'account', sourceDir: 'out',
      sourceCash: Math.max(0, round((s.paid || 0) - recovered)), sourceOffset: recovered, sourceGuess: true };
    cash = round(cash);
    if (cash <= 0 && recovered > 0) return { source: 'Recovered from advance / loan — no account moved',
      sourceKind: 'internal', sourceDir: '', sourceCash: 0, sourceOffset: recovered, sourceGuess: false };
    return { source: names.length ? names.join(' + ') : methodSource(s.payMethod),
      sourceKind: 'account', sourceDir: 'out', sourceCash: Math.max(0, cash),
      sourceOffset: recovered, sourceGuess: !names.length };
  }
  /* Where one pay_txns row moved its money. */
  function txnSource(x) {
    if (x.type === 'loan-repay' && isEmiMemo(x.memo))
      return { source: 'Deducted from the ' + emiFrom(x.memo), sourceKind: 'salary', sourceDir: '',
        sourceCash: 0, sourceOffset: round(x.amount), sourceGuess: false };
    if (x.type === 'settlement') {
      var c = glCash(glById('GL-SETL-' + x.empId));
      var cleared = round((+x.advanceCleared || 0) + (+x.loanCleared || 0));
      return { source: c.label || methodSource(x.method), sourceKind: 'account', sourceDir: 'out',
        sourceCash: Math.max(0, round(c.net)), sourceOffset: cleared, sourceGuess: !c.label };
    }
    return { source: methodSource(x.method), sourceKind: 'account',
      sourceDir: x.type === 'loan-repay' ? 'in' : 'out',
      sourceCash: round(x.amount), sourceOffset: 0, sourceGuess: false };
  }
  function withSource(row, src) {
    row.source = src.source; row.sourceKind = src.sourceKind; row.sourceDir = src.sourceDir;
    row.sourceCash = src.sourceCash; row.sourceOffset = src.sourceOffset; row.sourceGuess = !!src.sourceGuess;
    return row;
  }
  // an accrual is not a payment — it says so instead of naming an account it never used
  function accrualSource(account) {
    return { source: 'Accrued to ' + account + ' — no money moved', sourceKind: 'accrual', sourceDir: '',
      sourceCash: 0, sourceOffset: 0, sourceGuess: false };
  }

  // Salary currently owed to the employee (accrued but unpaid across all months).
  function salaryDue(empId) {
    return S.list('pay_slips').filter(function (s) { return s.empId === empId && s.status !== 'draft'; })
      .reduce(function (a, s) { return a + slipDue(s); }, 0);
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
    /* WHICH ACCOUNT PAYS THE SETTLEMENT (owner 2026-07-29 — "every payroll
     * transaction must say where it was done from"). The settlement was the last
     * money movement still posting to the abstract 1010 and moving no register.
     * With no method passed payThrough() resolves to exactly 1010, so every
     * existing caller posts precisely where it always did. */
    var setlGl = 'GL-SETL-' + empId;
    var setlSrc = payThrough(opts, 'out', cash, 'SETL-' + empId, 'Final settlement', empId, cid, setlGl);
    lines.push({ account: setlSrc.account, dr: 0, cr: cash });
    glPost(setlGl, today(), cid, 'SETL-' + empId,
      'Final settlement · ' + emp.name + (setlSrc.name ? ' · ' + setlSrc.name : ''), 'payroll', empId, lines);
    txn({ type: 'settlement', empId: empId, empName: emp.name, companyId: cid, date: today(), amount: p.net,
      advanceCleared: p.advanceOutstanding, loanCleared: p.loanOutstanding,
      method: opts.method || '', memo: 'Final settlement' });
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
    var encGl = 'GL-ENCP-' + empId + '-' + today().slice(0, 4);
    var encSrc = payThrough(opts, 'out', ls.value, 'ENCP-' + empId, 'Leave encashment', empId, cid, encGl);
    glPost(encGl, opts.date || today(), cid, 'ENCP-' + empId,
      'Leave encashment payout · ' + emp.name + (encSrc.name ? ' · ' + encSrc.name : ''), 'payroll', empId,
      [{ account: '2150', dr: ls.value, cr: 0 }, { account: encSrc.account, dr: 0, cr: ls.value }]);
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
      /* This sheet runs on the PRE-RECOVERY figure on both sides, and has to:
       * the advance and the loan repayment are rows of their own further down, so
       * netting them off the salary as well would count them twice. What the
       * employee earned is credited, and what the company settled — cash handed
       * over PLUS whatever of it went straight onto an advance or a loan — is
       * debited. Every historical row keeps the exact figures it always had. */
      var settled = round(slipPaid(s) + slipRealized(s));
      rows.push(withSource({ date: s.ym + '-01', ref: s.id, kind: 'Salary earned', memo: mLabel(s.ym) + ' salary (net of tax/PF)', credit: slipEarned(s), debit: 0 }, accrualSource('Salary Payable')));
      if (s.encashAmt) rows.push(withSource({ date: s.ym + '-01', ref: s.id, kind: 'Leave encashment', memo: mLabel(s.ym) + ' leave accrual', credit: s.encashAmt, debit: 0 }, accrualSource('Leave Encashment Payable')));
      if (settled) rows.push(withSource({ date: s.paidDate || (s.ym + '-10'), ref: s.id, kind: 'Salary paid',
        memo: mLabel(s.ym) + ' salary' + (slipPaid(s) > 0 ? ' paid' : ' applied to advance / loan'), credit: 0, debit: settled }, slipPaidSource(s)));
      /* AN ADVANCE THAT COMES BACK HAS TO BE CREDITED BACK (audit 2026-07-30).
       * Handing one over is a debit — the employee holds the company's money —
       * and taking it out of a payslip is the employee giving it back, exactly as
       * a loan repayment is. A loan has always had its own repayment row to close
       * that loop; an advance never did, so every advance ever recovered stayed a
       * debit for ever and the sheet closed that much BELOW what the person was
       * owed (one ledger closed at −৳12,875 against a true ৳20,125 of accrued
       * leave, the ৳33,000 of recovered advances having been counted twice). */
      var advBack = s.deductedAt ? round(s.advanceDeduct || 0) : round(s.advanceRecovered || 0);
      if (advBack > 0) rows.push(withSource({ date: s.paidDate || (s.ym + '-10'), ref: s.id, kind: 'Advance recovered',
        memo: 'Recovered from ' + mLabel(s.ym) + ' salary', credit: advBack, debit: 0 },
        { source: 'Deducted from the ' + mLabel(s.ym) + ' salary', sourceKind: 'salary', sourceDir: '', sourceCash: 0, sourceOffset: advBack, sourceGuess: false }));
    });
    txnsFor(empId).forEach(function (x) {
      if (x.type === 'advance') rows.push(withSource({ date: x.date, ref: x.id, kind: 'Advance', memo: x.memo, credit: 0, debit: x.amount }, txnSource(x)));
      else if (x.type === 'loan') rows.push(withSource({ date: x.date, ref: x.id, kind: 'Loan', memo: x.memo, credit: 0, debit: x.amount }, txnSource(x)));
      else if (x.type === 'loan-repay') rows.push(withSource({ date: x.date, ref: x.id, kind: 'Loan repaid', memo: x.memo, credit: x.amount, debit: 0 }, txnSource(x)));
      /* A BONUS IS EARNED AND PAID IN THE SAME BREATH (audit 2026-07-30), so it
       * needs BOTH legs. bonus() hands the money over there and then — DR 5100,
       * CR the account it came out of — but this sheet only ever credited it, so
       * every bonus ever paid sat in the closing balance for ever as money the
       * company still owed. One person's ledger closed at ৳73,881 owed when the
       * true figure was ৳34,881 of leave accrual: the ৳39,000 Eid bonus, paid in
       * March, was still being counted as due in August. */
      else if (x.type === 'bonus') {
        rows.push(withSource({ date: x.date, ref: x.id, kind: 'Bonus', memo: x.memo, credit: x.amount, debit: 0 }, accrualSource('the bonus')));
        rows.push(withSource({ date: x.date, ref: x.id, kind: 'Bonus paid', memo: x.memo, credit: 0, debit: x.amount }, txnSource(x)));
      }
      // …and a leave encashment PAID OUT settles the accrual this sheet credited
      // as it built up, for the same reason
      else if (x.type === 'encash-paid') rows.push(withSource({ date: x.date, ref: x.id, kind: 'Leave encashment paid', memo: x.memo, credit: 0, debit: x.amount }, txnSource(x)));
      else if (x.type === 'settlement') rows.push(withSource({ date: x.date, ref: x.id, kind: 'Final settlement', memo: x.memo, credit: 0, debit: x.amount }, txnSource(x)));
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
      .reduce(function (a, s) { return a + slipDue(s); }, 0);
  }
  // The arrears BREAKDOWN with dates (owner: "for every due there should be a
  // date record of WHICH month's due that is"): one row per unpaid month —
  // month, label, amount still owed, and since when it counts as due (the
  // month's pay-by date), plus what was part-paid and when.
  function previousDueList(empId, ym) {
    return S.list('pay_slips')
      .filter(function (s) { return s.empId === empId && s.ym < ym && s.status !== 'draft' && slipDue(s) > 0.5; })
      .sort(function (a, b) { return a.ym < b.ym ? -1 : 1; })
      .map(function (s) {
        var run = getRun(s.companyId, s.ym);
        return { ym: s.ym, label: mLabel(s.ym), amount: slipDue(s),
          dueSince: (run && run.dueAfter) || (s.ym + '-10'), paid: slipPaid(s), paidDate: s.paidDate || null };
      });
  }
  function statement(emp, ym) {
    var s = slip(emp.id, ym) || Object.assign({ empName: emp.name }, computeSlip(emp, ym, {}));
    var ls = leaveState(emp);
    var payable = slipPayable(s);
    /* The advance and the loan are ORDINARY DEDUCTION LINES on the payslip now
     * (owner 2026-07-30): the same figures the salary sheet shows, already taken
     * off the net below, so the printed slip's own arithmetic closes —
     * earnings − every deduction = net payable = the cash handed over. */
    var rec = slipRecovery(s);
    var advLine = rec.adv, loanLine = rec.emi;
    var cashAfter = payable;
    var arrears = previousDue(emp.id, ym);
    var arrearsList = previousDueList(emp.id, ym);
    return {
      ym: ym, emp: emp, slip: s,
      slipNo: s.slipNo || (ym + '-001'),
      payMethod: s.payMethod || emp.salaryMethod || 'Bank',
      generated: today(),
      earnings: [
        ['Basic Salary', s.basic], ['House Rent Allowance', s.house], ['Medical Allowance', s.medical],
        ['Conveyance Allowance', s.transport]
      ].concat(s.otherAllow ? [['Other Allowance', s.otherAllow]] : [])
       .concat([['Bonus', (s.bonus || 0) + (s.tplBonus || 0)], ['Overtime', s.overtime || 0]]),
      grossEarnings: (s.gross || 0) + (s.overtime || 0) + (s.bonus || 0) + (s.tplBonus || 0),
      grossEarned: s.earnedGross,
      deductions: [
        ['Advance Salary', advLine], ['Loan', loanLine],
        ['Absent', s.absentDeduction || 0], ['Late', s.lateDeduction || 0], ['Early leave', s.earlyDeduction || 0],
        ['Income tax', s.tax || 0], ['Provident fund', s.pf || 0]
      ].concat(s.otherDeduction ? [['Other deduction', s.otherDeduction]] : [])
       .concat(s.fine ? [['Fine / penalty' + (s.fineNote ? ' (' + s.fineNote + ')' : ''), s.fine]] : []),
      totalDeductions: advLine + loanLine + (s.absentDeduction || 0) + (s.lateDeduction || 0) + (s.earlyDeduction || 0) + (s.tax || 0) + (s.pf || 0) + (s.otherDeduction || 0) + (s.fine || 0),
      adjustment: s.adjustment || 0,
      leaveEncashment: { days: s.encashDays, amount: s.encashAmt, accruedDays: ls.encashableDays, accruedValue: ls.value, eligible: ls.eligibleFullYear, fullYearDays: ls.fullYearDays, fullYearValue: ls.fullYearValue },
      netPayable: payable, netCash: cashAfter, inWords: amountInWords(payable),
      previousDue: arrears, previousDueItems: arrearsList, totalPayable: payable + arrears, totalInWords: amountInWords(payable + arrears),
      paid: slipPaid(s), outstanding: slipDue(s), status: s.status || 'draft'
    };
  }
  // Pay off every earlier month still owed (walks old unpaid/partial slips oldest-first).
  function payArrears(empId, method) {
    var owed = S.list('pay_slips')
      .filter(function (s) { return s.empId === empId && s.status !== 'draft' && slipDue(s) > 0; })
      .sort(function (a, b) { return a.ym < b.ym ? -1 : 1; });
    var total = 0;
    owed.forEach(function (s) { try { var before = slipPaid(s); pay(empId, s.ym, null, method); var after = slipPaid(slip(empId, s.ym) || s); total += after - before; } catch (e) {} });
    return total;
  }

  /* --------------------------------------------------------------- helpers */
  function glPost(id, date, cid, ref, memo, source, party, lines) {
    // a money event with no journal is how a ledger quietly loses money — if the
    // ledger is not there to take it, SAY SO rather than return in silence
    if (!L() || !L().post) { console.warn('[payroll] no ledger to post to — ' + ref + ' left no journal'); return null; }
    bookMemo = {};              // this entry moves balances the next plan reads
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

  /* A decision queue with nothing in it teaches nobody what the screen is for, so
   * the demo opens with two real asks waiting and one that was turned down.
   * ITS OWN GATE, deliberately not seedDemo's: every browser already carries
   * pay_seeded_v3, so anything added there would never appear for anyone who has
   * run this app before.
   * NOTHING HERE IS PRE-APPROVED. Approving moves money out of a real account,
   * and money should move because somebody decided it should — the approved rows
   * on this screen are the ones the owner creates by approving. */
  function seedAdvReqs() {
    if (S.get('pay_advreq_seeded_v1', false)) return;
    var t = activeTeam('travels');
    if (t.length >= 4) {
      var nx = nextYm(curYm());
      var on = function (day) {                     // never date a request in the future
        var d = curYm() + '-' + day;
        return d > today() ? today() : d;
      };
      try {
        requestAdvance(t[2].id, 20000, { forYm: nx, date: on('18'),
          reason: 'School admission fee for my daughter' });
        requestAdvance((t[4] || t[3]).id, 12000, { forYm: nx, date: on('21'),
          reason: 'Medical — my father is admitted' });
        var r = requestAdvance(t[3].id, 45000, { forYm: nx, date: on('09'),
          reason: 'Home renovation' });
        decideAdvance(r.id, 'rejected', { date: on('10'),
          note: 'More than a month of salary. Reapply for a smaller amount, or take it as a staff loan on EMI so it clears over time.' });
      } catch (e) { /* a thin demo team — leave the queue empty */ }
    }
    S.set('pay_advreq_seeded_v1', true);
  }

  /* --------------------------------------------------------------- API */
  EPAL.payroll = {
    template: template, saveTemplate: saveTemplate, computeSlip: computeSlip, slipPayable: slipPayable,
    /* THE SLIP, READ ONE WAY (owner 2026-07-30). Every screen that shows an
     * advance, an EMI, a net, a paid or a due reads these — the columns and the
     * net payable beside them cannot disagree, because they are the same call.
     *   slipEarned    earnings − the month's own deductions (before recovery)
     *   slipRecovery  { adv, emi, short } — the two recoveries, and what would
     *                 not fit this month and rides on to the next
     *   slipPayable   the CASH to hand over = earned − advance − EMI
     *   slipPaid      the cash actually handed over · slipDue  what is left
     *   runCheck      the row-by-row proof that blocks an approval
     *   emiGap        EMI a sheet showed but nothing ever deducted */
    slipEarned: slipEarned, slipRecovery: slipRecovery, slipRealized: slipRealized,
    slipPaid: slipPaid, slipDue: slipDue, runCheck: runCheck, emiGap: emiGap, journalGap: journalGap,
    salaryPackages: salaryPackages, packageOf: packageOf, savePackage: savePackage,
    deletePackage: deletePackage, packageTotal: stTotal, fineSlip: fineSlip, slipAdj: slipAdj,
    amountInWords: amountInWords, attendanceFor: attendanceFor, saveAttendance: saveAttendance,
    generate: generate, getRun: getRun, run: getRun, slipsFor: slipsFor, slip: slip,
    inCorrectionWindow: inCorrectionWindow, adjustSlip: adjustSlip,
    finalize: finalize, unfinalize: unfinalize, pay: pay, unpay: unpay, autoDue: autoDue, refreshRunStatus: refreshRunStatus,
    advance: advance, loan: loan, repayLoan: repayLoan, bonus: bonus,
    advRequests: advRequests, advRequest: advRequest, requestAdvance: requestAdvance,
    decideAdvance: decideAdvance, nextYm: nextYm,
    advanceOutstanding: advanceOutstanding, loanOutstanding: loanOutstanding, loanBook: loanBook,
    emiInstallment: emiInstallment, salaryDue: salaryDue,
    leaveState: leaveState, settlementPreview: settlementPreview, settle: settle,
    encashmentLiability: encashmentLiability, payEncashment: payEncashment, departmentCost: departmentCost,
    previousDue: previousDue, previousDueList: previousDueList, payArrears: payArrears,
    empLedger: empLedger, statement: statement, txnsFor: txnsFor,
    // where the money moved — ONE reader, so no screen can name the account its
    // own way (see "WHERE THE MONEY MOVED" above)
    methodSource: methodSource, txnSource: txnSource, slipPaidSource: slipPaidSource,
    curYm: curYm, today: today, mLabel: mLabel
  };

  EPAL.registerEngine({
    name: 'payroll',
    seed: function () { ensureAccounts(); S.list('employees'); seedDemo(); seedAdvReqs(); },
    boot: function () { ensureAccounts(); autoDue(); }
  });

})(window.EPAL = window.EPAL || {});
