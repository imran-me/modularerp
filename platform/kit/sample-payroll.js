/* ============================================================================
 * EPAL KIT · SAMPLE PAYROLL — every concern, January 2026 to today
 * ----------------------------------------------------------------------------
 * Owner, 2026-07-28: "in travels, push some realistic data of past 6 month … in
 * payroll".
 * Owner, 2026-07-29: "from january 2026 to present real time, with all scenario,
 * employee based deduction, bonus, attendances, etc. All should be functional, and
 * logical data. like someone taken a loan, his next month payroll should deduct the
 * EMI automatically, an employee can also repay the loan at once."
 * Owner, 2026-07-29 (after seeing an empty Master Payroll): "i have said to push
 * some realistic data from january 2026 to now, but you havent yet!!!! List 5
 * Employee in Travels, 3 In interiors, 3 In constructions, 2 in group (CEO &
 * Director), In IT 3, in shop 1. realistic logical datas should be everywhere
 * across payroll."
 *
 * ⚠ WHY IT WAS EMPTY, AND WHAT CHANGED. The first version was right in every
 * respect except the two that mattered: it covered **Travels only**, and it ran
 * **only when someone clicked a button** buried in Master Accounts. So the Group's
 * Master Payroll — which is where the owner actually looked — showed one draft
 * month and nothing else. Now it covers EVERY concern and runs ITSELF at seed
 * time (EPAL.onSeed, registered after the payroll engine so the engine has
 * already seeded). The button stays, and forces a re-run.
 *
 * WHAT THIS IS. Not a fixture: it runs the REAL payroll engine month by month —
 * roster → attendance → generate → per-head adjustments → finalize (accrue) → pay
 * — so every book fills exactly as it would have if the months had been run at
 * the time:
 *
 *   accrual   DR 5100 Salaries / CR 2120 Tax · CR 2110 PF · CR 2100 Salary Payable
 *   payment   DR 2100 / CR 1250 advance recovered · CR 1260 EMI · CR <the account>
 *   advance   DR 1250 / CR <account>      loan  DR 1260 / CR <account>
 *   bonus     DR 5100 / CR <account>
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
 * IDEMPOTENT. Months finalized WITH attendance already on file are left completely
 * alone — recomputing a slip the ledger has already accrued would move the books
 * out from under their own postings. A slip already paid is not paid again.
 *
 * ONE HOLLOW-MONTH REWIND. The payroll engine's own seedDemo() closes the last few
 * months FLAT — no attendance, so every head takes a clean salary. A month that is
 * closed but has no attendance for the team is rewound once through the engine's
 * own demo-safe `unfinalize` (the path behind "Reopen Draft"), refilled, closed
 * again. It reverses with real journals, so the audit trail says what happened.
 *
 * EXPOSES: EPAL.samplePayroll.write()      -> report (all concerns)
 *          EPAL.samplePayroll.months()     -> January 2026 … the current month
 *          EPAL.samplePayroll.companies()  -> the concerns it covers
 * ==========================================================================*/
(function (EPAL) {
  'use strict';

  var FROM = '2026-01';                             // owner: "from january 2026 to present"

  /* THE ROSTER the owner asked for, by concern. Created only where a matching id
   * is missing, so a live directory of real staff is never touched or duplicated —
   * these ids are unique to this generator. Join dates are all well before January
   * 2026, because a payroll that starts before someone joined is not "logical
   * data", and leave encashment accrues on length of service. */
  var ROSTER = {
    travels: [
      ['Rezaul Karim',        'Operations',   'Operations Manager',       68000, '2021-03-01'],
      ['Farhana Ahmed',       'Ticketing',    'Senior Ticketing Executive', 45000, '2022-06-15'],
      ['Shahriar Kabir',      'Ticketing',    'Ticketing Executive',      32000, '2023-09-01'],
      ['Nusrat Jahan',        'Visa',         'Visa Consultant',          36000, '2023-02-01'],
      ['Abdul Mannan',        'Accounts',     'Accounts Officer',         38000, '2022-01-10']
    ],
    woodart: [
      ['Tanvir Hasan',        'Design',       'Lead Interior Designer',   72000, '2021-08-01'],
      ['Sumaiya Akter',       'Production',   'Production Supervisor',    42000, '2022-11-01'],
      ['Jahangir Alam',       'Installation', 'Installation Foreman',     34000, '2023-04-15']
    ],
    construction: [
      ['Mizanur Rahman',      'Projects',     'Project Engineer',         85000, '2020-05-01'],
      ['Kamrul Hasan',        'Site',         'Site Supervisor',          40000, '2022-02-01'],
      ['Ruhul Amin',          'Procurement',  'Procurement Officer',      38000, '2023-01-15']
    ],
    group: [
      ['Nasir Uddin Ahmed',   'Executive',    'Chief Executive Officer', 150000, '2019-01-01'],
      ['Farzana Rahman',      'Executive',    'Director',                120000, '2019-06-01']
    ],
    it: [
      ['Arif Mahmud',         'Engineering',  'Software Lead',            95000, '2021-02-01'],
      ['Rakib Hossain',       'Engineering',  'Software Engineer',        60000, '2022-07-01'],
      ['Sadia Islam',         'QA',           'QA Engineer',              45000, '2023-03-01']
    ],
    shop: [
      ['Jasim Uddin',         'Retail',       'Shop Manager',             35000, '2022-09-01']
    ]
  };
  var PREFIX = { travels: 'TRV', woodart: 'WDA', construction: 'CNS', group: 'GRP', it: 'ITS', shop: 'SHP' };
  function companies() { return Object.keys(ROSTER); }

  /* Every month from January 2026 up to and INCLUDING the current one. The engine's
   * own calendar says a month is due by the 10th OF THAT MONTH (template.payByDay),
   * so the current month is one that should already have been run — it is not a
   * future month, and leaving it out was the first version's one real gap. */
  function months() {
    var cur = EPAL.payroll.curYm();
    var y = +FROM.slice(0, 4), m = +FROM.slice(5, 7), out = [];
    for (var guard = 0; guard < 120; guard++) {     // guard: never loop forever on a bad clock
      var ym = y + '-' + String(m).padStart(2, '0');
      out.push(ym);
      if (ym >= cur) break;
      if (++m > 12) { m = 1; y++; }
    }
    return out;
  }

  /* DETERMINISTIC VARIETY — see the header. A hash, never Math.random(). */
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

  /* ---- the roster ---------------------------------------------------------
   * The owner asked for a HEADCOUNT per concern — 5 travels, 3 interiors, 3
   * construction, 2 group, 3 IT, 1 shop — so this TOPS UP to that number rather
   * than always adding. A concern that already has people (a live directory
   * hydrated from the API, or the demo seed's own staff) keeps them and gets only
   * the shortfall; a concern with nobody gets the whole list.
   *
   * NOBODY IS EVER DELETED OR DEACTIVATED here. Retiring somebody else's employee
   * record to make a headcount match is not a demo-data decision — a person on
   * this list may be on a task board, a project or an approval chain, and the
   * owner is the only one who can say who should come off the payroll.
   *
   * The OWNER row is excluded from the count: a chairman's drawings are not a
   * payslip, and this generator never invents a salary for the account you are
   * logged in as. */
  function payrollEligible(cid) {
    return (EPAL.db.employees() || []).filter(function (e) {
      return (e.companyId || '') === cid && (e.status || 'active') !== 'inactive' && e.role !== 'owner';
    });
  }
  function ensureRoster(made) {
    var db = EPAL.db;
    companies().forEach(function (cid) {
      var have = payrollEligible(cid);
      made.headcount[cid] = { wanted: ROSTER[cid].length, before: have.length, added: 0 };
      /* THE DIRECTORY IS THE SOURCE OF TRUTH, not this file. seedEmployees() in
       * platform/data/database.js now IS the owner's roster, so on a demo database
       * the right people are already here and this adds nothing. The top-up below
       * exists only for a LIVE database hydrated from the API, where a concern may
       * genuinely have no staff on file yet and every payroll screen would
       * otherwise be blank. It never renames, deletes or deactivates anybody —
       * deciding who comes off a payroll is the owner's call, not a seed's. */
      for (var i = 0; i < ROSTER[cid].length && have.length + made.headcount[cid].added < ROSTER[cid].length; i++) {
        var r = ROSTER[cid][i], id = 'EPL-' + PREFIX[cid] + '-' + (i + 1);
        if (db.employee && db.employee(id)) continue;
        db.saveEmployee({
          id: id, name: r[0], companyId: cid, dept: r[1], designation: r[2],
          role: /Chief|Director|Manager|Lead/.test(r[2]) ? 'manager' : 'employee',
          email: r[0].toLowerCase().replace(/[^a-z]+/g, '.') + '@epalgroup.com',
          phone: '+88017' + String(10000000 + hash(id) % 89999999).slice(0, 8),
          joinDate: r[4], salary: r[3], status: 'active',
          attendance: { present: 22, absent: 0, late: 0, leave: 0 }, rating: 4
        });
        made.headcount[cid].added++; made.hired++;
      }
      made.headcount[cid].after = payrollEligible(cid).length;
    });
  }

  function write() {
    var made = { months: 0, slips: 0, payments: 0, advances: 0, loans: 0, bonuses: 0, salaried: 0,
      attendance: 0, overtime: 0, slipBonuses: 0, deductions: 0, lumpRepayments: 0, rewound: 0,
      hired: 0, companies: 0, headcount: {} };
    ensureRoster(made);
    var list = months(), perCompany = {};
    companies().forEach(function (cid) {
      try { perCompany[cid] = runCompany(cid, list, made); made.companies++; }
      catch (e) { perCompany[cid] = { error: e.message || String(e) }; }
    });
    return report(made, list, perCompany);
  }

  /* ---- one concern, all its months ---------------------------------------- */
  function runCompany(CID, list, made) {
    var db = EPAL.db, P = EPAL.payroll, S = EPAL.store, pay = EPAL.pay;

    /* the account the salaries are paid from — a real one, so every payment moves
     * a balance and lands in that account's history */
    var accounts = pay.accountsOf(CID) || [];
    var bank = accounts.filter(function (b) { return b.type === 'Bank'; })[0] || accounts[0];
    if (!bank) {
      var bid = 'PAYROLL-' + CID.toUpperCase();
      db.save('banks', { id: bid, name: coShort(CID) + ' — Payroll Account', type: 'Bank',
        status: 'Active', companyId: CID, balance: 0, account: '15960001' + String(hash(CID) % 100000).padStart(5, '0'),
        branch: 'Gulshan', currency: 'BDT' });
      bank = pay.byId(bid);
    }
    var method = 'bank:' + bank.id;

    /* everyone on this payroll needs a salary to be paid one. The OWNER is skipped
     * on purpose — a chairman's drawings are not a payslip, and inventing a salary
     * for the account you are logged in as is exactly the kind of made-up number
     * that makes a demo untrustworthy. */
    var team = db.employees().filter(function (e) {
      return (e.companyId || '') === CID && (e.status || 'active') !== 'inactive' && e.role !== 'owner';
    });
    if (!team.length) return { heads: 0, note: 'no staff on this payroll' };
    team.forEach(function (e, i) {
      if (!(+e.salary > 0)) { e.salary = [42000, 35000, 28000, 24000, 20000][i % 5]; db.saveEmployee(e); made.salaried++; }
    });

    /* THE ACCOUNT HAS TO BE ABLE TO PAY. Seven months of salary is real money, and
     * an account opened with less would simply go negative — which is not
     * "realistic data", it is a broken-looking screen. So if it cannot cover the
     * run, the owner funds it first, the way a business actually starts a payroll
     * account: DR the account / CR 3000 Owner Equity, dated before the first
     * month. Balanced, on the books, visible in the account's own history. */
    var monthly = team.reduce(function (a, e) { return a + (+e.salary || 0); }, 0);
    var need = Math.round(monthly * list.length * 1.5);        // salaries + bonus + loan headroom
    if ((+bank.balance || 0) < need) {
      var top = Math.round((need - (+bank.balance || 0)) / 100000) * 100000 || 100000;
      var fundId = 'GL-PAYFUND-' + CID;
      if (!EPAL.ledger.entries({ companyId: CID }).some(function (e) { return e.id === fundId; })) {
        var openOn = list[0] + '-01';
        EPAL.ledger.post({ id: fundId, date: openOn, companyId: CID, ref: 'FUND-PAYROLL',
          source: 'opening', party: 'Owner',
          memo: 'Owner funding for the payroll account · ' + bank.name,
          lines: [{ account: pay.glAcctOf(bank), dr: top, cr: 0 }, { account: '3000', dr: 0, cr: top }] });
        pay.syncRegister({ id: 'PAYFUND-' + CID, companyId: CID, bankId: bank.id, kind: 'Income',
          amount: top, category: 'Owner funding', party: 'Owner', ref: 'FUND-PAYROLL',
          date: openOn, glId: fundId }, null);
      }
    }

    var loanTaker = team[0], advanceTaker = team[1] || team[0], lumpTaker = team[2] || team[team.length - 1];
    var wd = P.template(CID).workingDays || 30;
    var last = list.length - 1;

    list.forEach(function (ym, idx) {
      var pre = P.getRun(CID, ym);
      var alreadyFinal = !!pre && pre.status !== 'draft';

      // 0 · rewind a hollow month (see the header)
      if (alreadyFinal) {
        var onFile = team.filter(function (e) { return P.attendanceFor(e.id, ym); }).length;
        if (onFile < team.length) {
          try { P.unfinalize(CID, ym); alreadyFinal = false; made.rewound++; } catch (e) {}
        }
      }

      // 1 · ATTENDANCE FIRST — generate() only reads it when it CREATES a slip
      if (!alreadyFinal) {
        team.forEach(function (e) {
          if (P.attendanceFor(e.id, ym)) return;
          P.saveAttendance(e.id, ym, attendanceOf(e.id, ym, wd));
          made.attendance++;
        });
      }

      // 2 · the month itself
      var run = P.generate(CID, ym);
      made.months++;

      // 3 · what makes one payslip differ from the next.
      // ⚠ adjustSlip RECOMPUTES from what it is handed — a partial adj would wipe
      // the attendance written above, so the whole set goes every time.
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
          } catch (e) {}
        });
      }

      // 4 · the things that happen AROUND a salary
      if (idx === 1 && loanTaker && !hasTxn('loan', loanTaker.id, 'Staff loan · 6 monthly instalments')) {
        P.loan(loanTaker.id, Math.round((+loanTaker.salary || 40000) * 1.5 / 1000) * 1000,
          { date: ym + '-12', method: method, emiMonths: 6, memo: 'Staff loan · 6 monthly instalments' });
        made.loans++;
      }
      if (idx === 2) {
        team.forEach(function (e) {
          if (hasTxn('bonus', e.id, 'Eid festival bonus')) return;
          P.bonus(e.id, Math.round((+e.salary || 0) / 2), { date: ym + '-18', method: method, memo: 'Eid festival bonus' });
          made.bonuses++;
        });
      }
      // a SECOND loan — settled in one payment two months later, because the owner
      // asked for both ways out of a loan
      if (idx === 2 && lumpTaker && lumpTaker.id !== (loanTaker || {}).id &&
          !hasTxn('loan', lumpTaker.id, 'Staff loan · settled early in full')) {
        P.loan(lumpTaker.id, Math.round((+lumpTaker.salary || 30000) * 0.8 / 1000) * 1000,
          { date: ym + '-08', method: method, emiMonths: 0, memo: 'Staff loan · settled early in full' });
        made.loans++;
      }
      if (idx === 3 && advanceTaker && !hasTxn('advance', advanceTaker.id, 'Advance against next salary')) {
        P.advance(advanceTaker.id, Math.round((+advanceTaker.salary || 20000) * 0.4 / 1000) * 1000,
          { date: ym + '-20', method: method, memo: 'Advance against next salary' });
        made.advances++;
      }
      if (idx === 4 && lumpTaker && !hasTxn('loan-repay', lumpTaker.id, 'Loan settled in full — one payment')) {
        var owed = Math.round(P.loanOutstanding(lumpTaker.id));
        if (owed > 0) {
          P.repayLoan(lumpTaker.id, owed, { date: ym + '-22', method: method,
            memo: 'Loan settled in full — one payment' });
          made.lumpRepayments++;
        }
      }

      // 5 · close it and pay it
      if (run.status === 'draft') P.finalize(CID, ym);

      var when = payDay(ym);
      (P.slipsFor(CID, ym) || []).forEach(function (s) {
        made.slips++;
        var payable = Math.round(P.slipPayable(s));
        var already = Math.round(s.paid || 0);
        if (payable <= 0 || already >= payable) return;
        /* THE CURRENT MONTH IS LEFT LIVE — a couple of heads unpaid, one part-paid,
         * so the desk opens on a month with real work in it. Every earlier month is
         * settled in full. */
        if (idx === last && pick(s.empId, ym, 'unpaid', 100) < 34) return;
        var partial = idx === last && pick(s.empId, ym, 'partial', 100) < 25;
        var amount = partial ? Math.round((payable - already) / 2) : (payable - already);
        if (amount <= 0) return;
        try { P.pay(s.empId, ym, amount, method, { date: when }); made.payments++; }
        catch (e) {}
      });
    });

    function hasTxn(type, empId, memo) {
      return EPAL.store.list('pay_txns').some(function (t) {
        return t.type === type && t.empId === empId && (t.memo || '') === memo;
      });
    }
    return { heads: team.length, account: bank.name };
  }

  /* Per-head, per-month extras — overtime, a performance bonus, the occasional
   * deduction. Deliberately sparse: if everyone gets overtime every month it stops
   * looking like a payroll and starts looking like noise. */
  function perHead(s, ym, idx) {
    var ot = pick(s.empId, ym, 'ot', 100);
    var overtimeHours = ot < 62 ? 0 : ot < 82 ? 4 : ot < 94 ? 8 : 14;
    var bp = pick(s.empId, ym, 'perf', 100);
    var bonus = (idx !== 2 && bp < 9) ? Math.round((+s.gross || 0) * 0.1 / 100) * 100 : 0;
    var dp = pick(s.empId, ym, 'ded', 100);
    var otherDeduction = dp < 7 ? (500 + (pick(s.empId, ym, 'dedamt', 6) * 250)) : 0;
    return { overtimeHours: overtimeHours, bonus: bonus, otherDeduction: otherDeduction };
  }

  function coShort(cid) {
    var c = EPAL.config && EPAL.config.company ? EPAL.config.company(cid) : null;
    return c ? (c.short || c.name || cid) : cid;
  }

  /* what it wrote, read back out of the books */
  function report(made, list, perCompany) {
    var P = EPAL.payroll, L = EPAL.ledger, S = EPAL.store;
    var rows = [];
    companies().forEach(function (cid) {
      list.forEach(function (ym) {
        var slips = P.slipsFor(cid, ym) || [];
        if (!slips.length) return;
        var payable = 0, paid = 0;
        slips.forEach(function (s) { payable += P.slipPayable(s); paid += (+s.paid || 0); });
        var run = S.list('pay_runs').filter(function (r) { return r.companyId === cid && r.ym === ym; })[0];
        rows.push({ companyId: cid, ym: ym, heads: slips.length, payable: Math.round(payable),
          paid: Math.round(paid), due: Math.round(payable - paid), status: run ? run.status : '—' });
      });
    });
    var dr = 0, cr = 0;
    companies().forEach(function (cid) {
      L.trialBalance(cid).forEach(function (r) { dr += +r.debit || 0; cr += +r.credit || 0; });
    });
    return {
      made: made, months: list, perCompany: perCompany, rows: rows,
      salaryCost: companies().reduce(function (a, cid) { return a + Math.round(L.balance('5100', { companyId: cid })); }, 0),
      stillOwed: companies().reduce(function (a, cid) { return a + Math.round(L.balance('2100', { companyId: cid })); }, 0),
      txns: S.list('pay_txns').length,
      trial: { debit: Math.round(dr), credit: Math.round(cr), out: Math.round(dr - cr) }
    };
  }

  EPAL.samplePayroll = {
    write: write, months: months, companies: companies,
    present: function () {
      try {
        var ms = months();
        return EPAL.store.list('pay_runs').some(function (r) { return r.ym === ms[0] && r.status !== 'draft'; });
      } catch (e) { return false; }
    }
  };

  /* RUNS ITSELF. Registered AFTER the payroll engine in index.html, and
   * registration order is execution order, so payroll has already seeded its
   * accounts and its own demo months by the time this fires. The version gate
   * keeps a page load cheap once the history exists; the Master Accounts button
   * still forces a full re-run. */
  EPAL.onSeed('sample-payroll', function () {
    try {
      if (EPAL.store.get('pay_history_v2', false)) return;
      write();
      EPAL.store.set('pay_history_v2', true);
    } catch (e) { if (window.console) console.warn('[sample-payroll] ' + (e.message || e)); }
  });

})(window.EPAL = window.EPAL || {});
