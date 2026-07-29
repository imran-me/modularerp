/* ============================================================================
 * EPAL KIT · SAMPLE PAYROLL — January 2026 to today, as it would really have run
 * ----------------------------------------------------------------------------
 * Owner, 2026-07-28: "in travels, push some realistic data of past 6 month, in
 * the travels accounts section only, in payroll".
 * Owner, 2026-07-29: "from january 2026 to present real time, with all scenario,
 * employee based deduction, bonus, attendances, etc. All should be functional, and
 * logical data. like someone taken a loan, his next month payroll should deduct the
 * EMI automatically, an employee can also repay the loan at once."
 *
 * WHAT THIS IS. Not a fixture: it runs the REAL payroll engine month by month —
 * attendance → generate → per-head adjustments → finalize (accrue) → pay — plus
 * everything that actually happens to a salary in Bangladesh. So every book fills
 * exactly as it would have if the months had been run at the time:
 *
 *   accrual   DR 5100 Salaries / CR 2120 Tax · CR 2110 PF · CR 2100 Salary Payable
 *   payment   DR 2100 / CR 1250 advance recovered · CR 1260 EMI · CR <the account>
 *   advance   DR 1250 / CR <account>      loan  DR 1260 / CR <account>
 *   bonus     DR 5100 / CR <account>
 *
 * Each month's accrual is dated to that month (the engine has always done this)
 * and each payment to the 7th of the month after — payroll.pay() takes a date for
 * exactly this reason. The result is a history with real shape: outstanding rising
 * and falling, a loan balance amortising, advances recovered automatically.
 *
 * WHAT EACH MONTH CARRIES
 *   attendance   per head, per month — absent days, lates (3 = one day) and
 *                early-leaves, written BEFORE generate() so the engine turns them
 *                into real deduction lines rather than a flat salary for everyone
 *   overtime     hours on the heads who are eligible, some months
 *   bonus        an Eid festival bonus for everyone (half a month), plus the
 *                occasional individual performance bonus
 *   deduction    the rare one-off — a damaged handset, an over-claimed allowance
 *   loan #1      taken in month 2 on a 6-month schedule → the EMI comes out of
 *                every payment after it, automatically, with no one touching it
 *   loan #2      taken in month 3 with NO schedule and then SETTLED IN FULL in one
 *                payment in month 5 — the owner asked for both ways out of a loan
 *   advance      taken in month 4, recovered from month 5's payslip by the engine
 *   the live one the current month is left with real work in it: a few heads
 *                unpaid, one part-paid, so Outstanding is a true figure
 *
 * TWO ENGINE FACTS THIS DEPENDS ON (verified, not assumed):
 *   · generate() reads attendanceFor(empId, ym) only when it CREATES a slip, so
 *     attendance has to be written first or it is ignored.
 *   · adjustSlip() recomputes the slip from exactly the adj it is handed — a
 *     partial one silently WIPES whatever it omits. Always pass the whole set.
 *
 * DETERMINISTIC. No Math.random() anywhere: the boot sweep asserts the same
 * screens every run, and a generator that disagreed with itself between runs would
 * show up as a phantom regression. Variety is a hash of employee id + month.
 *
 * ONE HOLLOW-MONTH REWIND. The payroll engine's own seedDemo() closes the last few
 * months before this ever runs, and closes them FLAT — no attendance on file, so
 * every head takes a clean salary and those months sit hollow in the middle of a
 * range that is otherwise full of life. A month that is closed but has no
 * attendance for the team is therefore rewound once, through the engine's own
 * demo-safe `unfinalize` (the same path behind Salary Manage's "Reopen Draft"),
 * refilled and closed again. It reverses with real journals, so the audit trail
 * says what happened instead of the books quietly changing shape.
 *
 * IDEMPOTENT. Months finalized WITH attendance already on file are left completely
 * alone — not rewound, not re-adjusted, not re-paid — because recomputing a slip
 * the ledger has already accrued would move the books out from under their own
 * postings. The rewind above tests for the attendance it then writes, so it fires
 * at most once per month. Running the whole thing twice changes nothing.
 *
 * SCOPE: Travels only, payroll only. It touches no other company and no other
 * module, exactly as asked.
 *
 * EXPOSES: EPAL.samplePayroll.write() -> report
 *          EPAL.samplePayroll.months() -> January 2026 … the current month
 * ==========================================================================*/
(function (EPAL) {
  'use strict';

  var CID = 'travels';
  var FROM = '2026-01';                             // owner: "from january 2026 to present"

  /* Every month from January 2026 up to and INCLUDING the current one. The engine's
   * own calendar says a month is due by the 10th OF THAT MONTH (template.payByDay),
   * so on any day past the 10th the current month is a month that should already be
   * finalized and paid — it is not a future month, and leaving it out was the
   * previous version's one real gap. */
  function months() {
    var cur = EPAL.payroll.curYm();                 // '2026-07' on the demo clock
    var y = +FROM.slice(0, 4), m = +FROM.slice(5, 7), out = [];
    for (var guard = 0; guard < 120; guard++) {     // guard: never loop forever on a bad clock
      var ym = y + '-' + String(m).padStart(2, '0');
      out.push(ym);
      if (ym >= cur) break;
      if (++m > 12) { m = 1; y++; }
    }
    return out;
  }

  /* DETERMINISTIC VARIETY. The boot sweep asserts the same screens every run, so
   * this file must never call Math.random() — two runs would disagree and the
   * harness would flag a phantom regression. Everything "random" below is a hash of
   * the employee id and the month, so it is stable forever and still uncorrelated
   * enough to look like real life. */
  function hash(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = (h * 16777619) >>> 0; }
    return h;
  }
  function pick(empId, ym, salt, mod) { return hash(empId + '|' + ym + '|' + salt) % mod; }

  /* One month of attendance for one head. Most people show up; a few do not.
   * Weighted so the common case is a clean month — an office where everybody is
   * absent four days a month is not realistic data, it is noise. */
  function attendanceOf(empId, ym, wd) {
    var a = pick(empId, ym, 'abs', 100);
    var absent = a < 55 ? 0 : a < 80 ? 1 : a < 92 ? 2 : a < 98 ? 3 : 4;
    var l = pick(empId, ym, 'late', 100);
    var late = l < 45 ? 0 : l < 70 ? 1 : l < 85 ? 2 : l < 95 ? 3 : 5;   // 3 lates = one day
    var e = pick(empId, ym, 'early', 100);
    var early = e < 75 ? 0 : e < 92 ? 1 : 2;
    return { present: wd - absent, absent: absent, late: late, earlyLeave: early, leave: 0 };
  }
  function payDay(ym) {                              // paid on the 7th of the NEXT month
    var y = +ym.slice(0, 4), m = +ym.slice(5, 7);
    var d = new Date(y, m, 7);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-07';
  }

  /* A believable salary for a head who has none yet — the demo data ships two
   * employees on ৳0, which makes an empty sheet rather than a payroll. */
  var STARTER = [42000, 35000, 28000, 24000, 20000];

  function write() {
    var db = EPAL.db, P = EPAL.payroll, S = EPAL.store, pay = EPAL.pay;
    var made = { months: 0, slips: 0, payments: 0, advances: 0, loans: 0, bonuses: 0, salaried: 0,
      attendance: 0, overtime: 0, slipBonuses: 0, deductions: 0, lumpRepayments: 0, rewound: 0 };

    /* the account the salaries are paid from — a real one, so every payment moves
     * a balance and lands in that account's history */
    var accounts = pay.accountsOf(CID);
    var bank = accounts.filter(function (b) { return b.type === 'Bank'; })[0] || accounts[0];
    if (!bank) {
      db.save('banks', { id: 'PAYROLL-TRAVELS', name: 'Travels — Payroll Account', type: 'Bank',
        status: 'Active', companyId: CID, balance: 2500000, account: '1596000112233',
        branch: 'Gulshan', currency: 'BDT' });
      bank = pay.byId('PAYROLL-TRAVELS');
    }
    var method = 'bank:' + bank.id;

    /* everyone on the payroll needs a salary to be paid one */
    var team = db.employees().filter(function (e) {
      return (e.companyId || CID) === CID && (e.status || 'active') !== 'inactive';
    });
    team.forEach(function (e, i) {
      if (!(+e.salary > 0)) { e.salary = STARTER[i % STARTER.length]; db.saveEmployee(e); made.salaried++; }
    });

    var list = months();
    var loanTaker = team[0], advanceTaker = team[1] || team[0];

    /* THE ACCOUNT HAS TO BE ABLE TO PAY. Six months of salary is real money, and
     * an account opened with less than that would simply go negative — which is
     * not "realistic data", it is a broken-looking screen. So if it cannot cover
     * the run, the owner funds it first, the way a business actually starts a
     * payroll account: DR the account / CR 3000 Owner Equity, dated before the
     * first month. Balanced, on the books, and visible in the account's history. */
    var monthly = team.reduce(function (a, e) { return a + (+e.salary || 0); }, 0);
    var need = Math.round(monthly * list.length * 1.35);        // salaries + bonus + loan headroom
    if ((+bank.balance || 0) < need) {
      var top = Math.round((need - (+bank.balance || 0)) / 100000) * 100000 || 100000;
      var fundId = 'GL-PAYFUND-' + CID;
      if (!EPAL.ledger.entries({ companyId: CID }).some(function (e) { return e.id === fundId; })) {
        var openOn = list[0] + '-01';
        EPAL.ledger.post({ id: fundId, date: openOn, companyId: CID, ref: 'FUND-PAYROLL',
          source: 'opening', party: 'Owner',
          memo: 'Owner funding for the payroll account · ' + bank.name,
          lines: [{ account: pay.glAcctOf(bank), dr: top, cr: 0 },
                  { account: '3000', dr: 0, cr: top }] });
        pay.syncRegister({ id: 'PAYFUND-' + CID, companyId: CID, bankId: bank.id, kind: 'Income',
          amount: top, category: 'Owner funding', party: 'Owner', ref: 'FUND-PAYROLL',
          date: openOn, glId: fundId }, null);
        made.funded = top;
      }
    }

    var lumpTaker = team[2] || team[team.length - 1];       // clears a loan in ONE payment
    var wd = P.template(CID).workingDays || 30;
    var last = list.length - 1;

    list.forEach(function (ym, idx) {
      var pre = P.getRun(CID, ym);
      var alreadyFinal = !!pre && pre.status !== 'draft';

      /* ── 0 · REWIND A HOLLOW MONTH ───────────────────────────────────────
       * The payroll engine's own seedDemo() closes the last few months before
       * this generator ever runs, and it closes them FLAT — generate() with no
       * attendance on file, so every head takes home a clean salary with no
       * absence, no late, no overtime. Left alone that puts hollow months in the
       * middle of the range while the months either side are full of life.
       *
       * A month is hollow if it is closed but the team has no attendance on file.
       * Rewinding it is the engine's own documented, demo-safe path (the same
       * `unfinalize` behind Salary Manage's "Reopen Draft" — it reverses the
       * accrual and any payment with real reversal journals, so the audit trail
       * says what happened rather than the books quietly changing shape).
       *
       * Runs ONCE: afterwards the month HAS attendance, so the test below is
       * false and the second run rewinds nothing. If the rewind fails for any
       * reason the month is simply left exactly as it was. */
      if (alreadyFinal) {
        var onFile = team.filter(function (e) { return P.attendanceFor(e.id, ym); }).length;
        if (onFile < team.length) {
          try { P.unfinalize(CID, ym); alreadyFinal = false; made.rewound++; }
          catch (e) { /* leave the month closed and untouched */ }
        }
      }

      /* ── 1 · ATTENDANCE, before anything else ─────────────────────────────
       * generate() reads attendanceFor(empId, ym) when it CREATES a slip, so
       * writing it here is what turns a flat salary into a payslip with real
       * absence and late lines. Skipped once a month is finalized: recomputing a
       * slip the ledger has already accrued would move the books out from under
       * their own postings. */
      if (!alreadyFinal) {
        team.forEach(function (e) {
          if (P.attendanceFor(e.id, ym)) return;             // already recorded — leave it
          P.saveAttendance(e.id, ym, attendanceOf(e.id, ym, wd));
          made.attendance++;
        });
      }

      /* ── 2 · the month itself ─────────────────────────────────────────── */
      var run = P.generate(CID, ym);
      made.months++;

      /* ── 3 · what makes one payslip differ from the next ──────────────────
       * ⚠ adjustSlip RECOMPUTES the slip from exactly what it is handed, so a
       * partial adj (just the overtime, say) would silently WIPE the attendance
       * written above. The whole set goes every time. */
      if (run.status === 'draft') {
        (P.slipsFor(CID, ym) || []).forEach(function (s) {
          var x = perHead(s, ym, idx);
          if (!x.overtimeHours && !x.bonus && !x.otherDeduction) return;
          try {
            P.adjustSlip(s.empId, ym, {
              leaveDeductDays: s.leaveDeductDays || 0, lateDays: s.lateDays || 0, earlyDays: s.earlyDays || 0,
              overtimeHours: x.overtimeHours, bonus: x.bonus, otherDeduction: x.otherDeduction, adjustment: 0
            });
            if (x.overtimeHours) made.overtime++;
            if (x.bonus) made.slipBonuses++;
            if (x.otherDeduction) made.deductions++;
          } catch (e) { /* leave the slip as generated */ }
        });
      }

      /* ── 4 · the things that happen AROUND a salary ───────────────────── */
      // month 2 · a staff loan, amortised by EMI out of every month after it
      if (idx === 1 && loanTaker && !hasTxn('loan', loanTaker.id, 'Staff loan · 6 monthly instalments')) {
        P.loan(loanTaker.id, 60000, { date: ym + '-12', method: method, emiMonths: 6,
          memo: 'Staff loan · 6 monthly instalments' });
        made.loans++;
      }
      // month 3 · Eid festival bonus for everyone, half a month's salary
      if (idx === 2) {
        team.forEach(function (e) {
          if (hasTxn('bonus', e.id, 'Eid festival bonus')) return;
          P.bonus(e.id, Math.round((+e.salary || 0) / 2), { date: ym + '-18', method: method,
            memo: 'Eid festival bonus' });
          made.bonuses++;
        });
      }
      // month 3 · a SECOND loan — this one the employee clears in one payment two
      // months later, because the owner asked for both ways out of a loan: pay it
      // down by instalment, or settle the lot (see month 5 below)
      if (idx === 2 && lumpTaker && lumpTaker.id !== (loanTaker || {}).id &&
          !hasTxn('loan', lumpTaker.id, 'Staff loan · settled early in full')) {
        P.loan(lumpTaker.id, 30000, { date: ym + '-08', method: method, emiMonths: 0,
          memo: 'Staff loan · settled early in full' });
        made.loans++;
      }
      // month 4 · an advance against next month's pay (the engine recovers it then)
      if (idx === 3 && advanceTaker && !hasTxn('advance', advanceTaker.id, 'Advance against next salary')) {
        P.advance(advanceTaker.id, 15000, { date: ym + '-20', method: method,
          memo: 'Advance against next salary' });
        made.advances++;
      }
      // month 5 · …and that second loan is repaid in a single lump sum. No EMI was
      // ever scheduled on it, so without this it would have sat on the books for
      // ever — which is exactly the "loan with no repayment schedule" the payroll
      // Autopilot warns about, and worth having ONE of, cleared, in the history.
      if (idx === 4 && lumpTaker && !hasTxn('loan-repay', lumpTaker.id, 'Loan settled in full — one payment')) {
        var owed = Math.round(P.loanOutstanding(lumpTaker.id));
        if (owed > 0) {
          P.repayLoan(lumpTaker.id, owed, { date: ym + '-22', method: method,
            memo: 'Loan settled in full — one payment' });
          made.lumpRepayments++;
        }
      }

      /* ── 5 · close it and pay it ──────────────────────────────────────── */
      if (run.status === 'draft') P.finalize(CID, ym);

      var when = payDay(ym);
      (P.slipsFor(CID, ym) || []).forEach(function (s) {
        made.slips++;
        var payable = Math.round(P.slipPayable(s));
        var already = Math.round(s.paid || 0);
        if (payable <= 0 || already >= payable) return;         // nothing left to pay
        /* THE CURRENT MONTH IS LEFT LIVE. Two heads stay unpaid and one part-paid,
         * so the desk opens on a month with real work left in it — an Outstanding
         * figure, a payment meter short of 100%, and an Autopilot with something
         * true to propose. Every earlier month is settled in full. */
        var skip = idx === last && pick(s.empId, ym, 'unpaid', 100) < 34;
        if (skip) return;
        var partial = idx === last && pick(s.empId, ym, 'partial', 100) < 25;
        var amount = partial ? Math.round((payable - already) / 2) : (payable - already);
        if (amount <= 0) return;
        try { P.pay(s.empId, ym, amount, method, { date: when }); made.payments++; }
        catch (e) { /* a month already closed, or nothing payable — leave it */ }
      });
    });

    /* Per-head, per-month extras — overtime, a performance bonus, the occasional
     * deduction. Deterministic (see hash) and deliberately sparse: if everyone gets
     * overtime every month it stops looking like a payroll and starts looking like
     * a spreadsheet someone filled with noise. */
    function perHead(s, ym, idx) {
      var ot = pick(s.empId, ym, 'ot', 100);
      var overtimeHours = ot < 62 ? 0 : ot < 82 ? 4 : ot < 94 ? 8 : 14;
      // a performance bonus for one head in some months — never in the Eid month,
      // where everyone already has one and a second would read as a mistake
      var bp = pick(s.empId, ym, 'perf', 100);
      var bonus = (idx !== 2 && bp < 9) ? Math.round((+s.gross || 0) * 0.1 / 100) * 100 : 0;
      // and the rare one-off: a damaged handset, a personal courier, an
      // over-claimed allowance clawed back
      var dp = pick(s.empId, ym, 'ded', 100);
      var otherDeduction = dp < 7 ? (500 + (pick(s.empId, ym, 'dedamt', 6) * 250)) : 0;
      return { overtimeHours: overtimeHours, bonus: bonus, otherDeduction: otherDeduction };
    }

    // OUR row, not any row: the demo data already carries loans and advances, and a
    // type-only guard meant this generator silently wrote none of its own.
    function hasTxn(type, empId, memo) {
      return S.list('pay_txns').some(function (t) {
        return t.type === type && t.empId === empId && (t.memo || '') === memo;
      });
    }

    return report(made, list, bank);
  }

  /* what it wrote, read back out of the books */
  function report(made, list, bank) {
    var P = EPAL.payroll, L = EPAL.ledger, S = EPAL.store, db = EPAL.db;
    var rows = list.map(function (ym) {
      var slips = P.slipsFor(CID, ym) || [];
      var payable = 0, paid = 0;
      slips.forEach(function (s) { payable += P.slipPayable(s); paid += (+s.paid || 0); });
      var run = S.list('pay_runs').filter(function (r) { return r.companyId === CID && r.ym === ym; })[0];
      return { ym: ym, heads: slips.length, payable: Math.round(payable), paid: Math.round(paid),
               due: Math.round(payable - paid), status: run ? run.status : '—' };
    });
    var dr = 0, cr = 0;
    L.trialBalance(CID).forEach(function (r) { dr += +r.debit || 0; cr += +r.credit || 0; });
    var acct = db.col('banks').filter(function (b) { return b.id === (bank || {}).id; })[0] || {};
    return {
      made: made, months: rows,
      salaryCost: Math.round(L.balance('5100', { companyId: CID })),
      stillOwed: Math.round(L.balance('2100', { companyId: CID })),
      advancesOut: Math.round(L.balance('1250', { companyId: CID })),
      loansOut: Math.round(L.balance('1260', { companyId: CID })),
      account: { name: acct.name, balance: Math.round(acct.balance || 0) },
      registerRows: S.list('bank_txns').filter(function (t) { return t.bankId === (bank || {}).id; }).length,
      txns: S.list('pay_txns').filter(function (t) { return t.companyId === CID; }).length,
      trial: { debit: Math.round(dr), credit: Math.round(cr), out: Math.round(dr - cr) }
    };
  }

  EPAL.samplePayroll = {
    write: write,
    months: months,
    present: function () {
      try {
        var ms = months();
        return S().list('pay_runs').some(function (r) { return r.companyId === CID && r.ym === ms[0] && r.status !== 'draft'; });
      } catch (e) { return false; }
    }
  };
  function S() { return EPAL.store; }
})(window.EPAL = window.EPAL || {});
