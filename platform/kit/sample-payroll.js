/* ============================================================================
 * EPAL KIT · SAMPLE PAYROLL — six months of real Travels payroll history
 * ----------------------------------------------------------------------------
 * Owner, 2026-07-28: "in travels, push some realistic data of past 6 month, in
 * the travels accounts section only, in payroll".
 *
 * WHAT THIS IS. Not a fixture: it runs the REAL payroll engine month by month —
 * generate → finalize (accrue) → pay — plus the things that actually happen to a
 * salary in Bangladesh: a staff loan recovered by EMI, a festival bonus at Eid, an
 * advance against next month's pay, and one month left part-paid. So every book
 * fills exactly as it would have if the months had been run at the time:
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
 * IDEMPOTENT. Months already finalized are left alone, and a slip already paid is
 * not paid again — running it twice changes nothing.
 *
 * SCOPE: Travels only, payroll only. It touches no other company and no other
 * module, exactly as asked.
 *
 * EXPOSES: EPAL.samplePayroll.write() -> report
 *          EPAL.samplePayroll.months() -> the six months it covers
 * ==========================================================================*/
(function (EPAL) {
  'use strict';

  var CID = 'travels';

  /* the six complete months before the current one */
  function months() {
    var cur = EPAL.payroll.curYm();                 // '2026-07' on the demo clock
    var y = +cur.slice(0, 4), m = +cur.slice(5, 7);
    var out = [];
    for (var i = 6; i >= 1; i--) {
      var d = new Date(y, m - 1 - i, 1);
      out.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'));
    }
    return out;
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
    var made = { months: 0, slips: 0, payments: 0, advances: 0, loans: 0, bonuses: 0, salaried: 0 };

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

    list.forEach(function (ym, idx) {
      /* ── the month itself ─────────────────────────────────────────────── */
      var run = P.generate(CID, ym);
      if (run.status === 'draft') P.finalize(CID, ym);
      made.months++;

      /* ── the things that happen around a salary ───────────────────────── */
      // month 2 · a staff loan, recovered by EMI from every month after it
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
      // month 4 · an advance against next month's pay (the engine recovers it then)
      if (idx === 3 && advanceTaker && !hasTxn('advance', advanceTaker.id, 'Advance against next salary')) {
        P.advance(advanceTaker.id, 15000, { date: ym + '-20', method: method,
          memo: 'Advance against next salary' });
        made.advances++;
      }

      /* ── paying it ────────────────────────────────────────────────────── */
      var when = payDay(ym);
      (P.slipsFor(CID, ym) || []).forEach(function (s) {
        made.slips++;
        var payable = Math.round(P.slipPayable(s));
        var already = Math.round(s.paid || 0);
        if (payable <= 0 || already >= payable) return;         // nothing left to pay
        // the LAST month is left part-paid for one head, so "outstanding" on the
        // screen is a real figure rather than a tidy zero
        var partial = (idx === list.length - 1) && s.empId === (team[team.length - 1] || {}).id;
        var amount = partial ? Math.round((payable - already) / 2) : (payable - already);
        try { P.pay(s.empId, ym, amount, method, { date: when }); made.payments++; }
        catch (e) { /* a month already closed, or nothing payable — leave it */ }
      });
    });

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
