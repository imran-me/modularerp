/* ============================================================================
 * EPAL KIT · MANAGE LOAN  (three books: lent out · staff · borrowed)
 * ----------------------------------------------------------------------------
 * THREE BOOKS, ONE DESK — the owner's brief:
 *   1. EXTERNAL LOANS — money the group LENDS OUT: a personal or business loan,
 *      a goodwill loan, or a service someone takes now and pays for monthly
 *      (a VISA on instalments is treated as a loan here). Disburse, schedule,
 *      collect, chase when overdue, write off when dead.
 *   2. EMPLOYEE LOANS (mirror only) — staff loans live in Payroll ▸ Loan
 *      Management and recover automatically as payslip EMI. Nothing here moves
 *      them; this desk only SHOWS that book so the portfolio reads in one place.
 *   3. LOANS WE TOOK — what the group BORROWS: a bank loan, a car EMI, an
 *      office/equipment loan. Tracks total, paid, due, next date and how much
 *      of it is behind us.
 *
 * ══ THE ACCOUNTING RULE (owner, 2026-07-15) ═════════════════════════════════
 * The loan books are kept SEPARATE from the main accounts. Lending out and
 * borrowing post NO journals and move NO bank balance — this desk carries its
 * own numbers. The ONE exception is EMPLOYEE loans: those are payroll's, and
 * their disbursement and EMI recovery DO hit the main accounts (GL 1260),
 * exactly as they always have.
 *
 * Why it is also the right treatment, not just a preference: when a customer
 * takes a VISA and pays monthly, the sale ALREADY put that money on the books
 * as a receivable. Booking it a second time as a loan asset would count the
 * same taka twice. So the loan book tracks the arrangement; the main accounts
 * keep the money. The earlier GL-wired build is undone by the one-time
 * `loans_gl_detach_v1` cleanup in the seed engine below.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * STORES: loan_products (setup) · loans_ext (lent out + embedded schedule) ·
 *         loans_taken (borrowed + embedded schedule) ·
 *         loan_txns (collection / repayment / write-off trail; `book` = which)
 *
 * EXPOSES: EPAL.loanDesk(page, companyId, { rightEl }) — the whole section.
 *
 * ==> LARAVEL HANDOFF: loans_ext + loans_taken = loans table (a `direction`
 *     column: receivable | payable) + loan_schedules (rows); loan_txns =
 *     loan_transactions. These are STANDALONE tables — no JournalEntry is
 *     written for them, unlike TicketSale → journal in the production app.
 *     If the owner later wants them on the books, that is one posting service
 *     over these same tables; nothing here needs restructuring.
 * ==========================================================================*/
(function (EPAL) {
  'use strict';
  var ui = EPAL.ui, el = ui.el, S = EPAL.store;
  function db() { return EPAL.db; }
  function L() { return EPAL.ledger; }
  function esc(s) { return ui.escapeHtml(String(s == null ? '' : s)); }
  function today() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function addMonths(iso, n) {
    var d = new Date((iso || today()) + 'T00:00:00'); var day = d.getDate();
    d.setMonth(d.getMonth() + n);
    if (d.getDate() < day) d.setDate(0);                       // clamp 31 → month end
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function coName(cid) { if (cid === 'group') return 'Group HQ'; var c = EPAL.config.company(cid); return c ? c.short : cid; }
  function comps() { return EPAL.config.companies.filter(function (c) { return c.type === 'company' && c.enabled !== false; }); }
  function can(cid) { return !EPAL.perm || EPAL.perm.can('group', 'master-accounts', 'create'); }
  function kpi(label, value, icon, tone) {
    return el('div.kpi-card', null, [
      el('div.kpi-top', null, [el('span.kpi-label', { text: label }), el('span.kpi-ico', { html: '<i class="bi bi-' + icon + '"></i>' })]),
      el('div.kpi-value' + (tone ? '.' + tone : ''), { text: String(value) })
    ]);
  }

  /* ==========================================================================
   * LOAN MATH — flat vs reducing-balance, the two methods used in BD lending
   * ========================================================================*/
  function emiOf(P, ratePct, months, method) {
    P = +P || 0; months = +months || 0; ratePct = +ratePct || 0;
    if (!P || !months) return 0;
    if (method === 'reducing') {
      var r = (ratePct / 100) / 12;
      if (r <= 0) return P / months;
      var f = Math.pow(1 + r, months);
      return P * r * f / (f - 1);
    }
    return (P + P * (ratePct / 100) * (months / 12)) / months;   // flat
  }
  function buildSchedule(loan) {
    var P = +loan.principal || 0, n = +loan.tenureMonths || 0, rate = +loan.rate || 0, method = loan.method || 'flat';
    var rows = [], bal = P, emi = emiOf(P, rate, n, method);
    var flatInt = P * (rate / 100) * (n / 12) / (n || 1), flatPrin = P / (n || 1);
    for (var i = 1; i <= n; i++) {
      var interest, principal;
      if (method === 'reducing') { var r = (rate / 100) / 12; interest = bal * r; principal = Math.min(bal, emi - interest); }
      else { interest = flatInt; principal = flatPrin; }
      bal = Math.max(0, bal - principal);
      rows.push({ no: i, due: addMonths(loan.startDate, i), principal: Math.round(principal), interest: Math.round(interest),
        total: Math.round(principal + interest), paid: 0, paidDate: '' });
    }
    return rows;
  }
  // money already collected / still owed, straight off the schedule
  function paidOf(l) { return (l.schedule || []).reduce(function (a, r) { return a + (+r.paid || 0); }, 0); }
  function dueTotalOf(l) { return (l.schedule || []).reduce(function (a, r) { return a + (+r.total || 0); }, 0); }
  function outstandingOf(l) { return Math.max(0, dueTotalOf(l) - paidOf(l)); }
  function principalOutstandingOf(l) {
    var owed = 0;
    (l.schedule || []).forEach(function (r) {
      var unpaid = Math.max(0, (+r.total || 0) - (+r.paid || 0));
      if (unpaid <= 0) return;
      var share = (+r.total || 0) ? (+r.principal || 0) / r.total : 1;
      owed += unpaid * share;
    });
    return Math.round(owed);
  }
  function overdueOf(l) {
    if (l.status !== 'Active') return 0;
    var t = today(), sum = 0;
    (l.schedule || []).forEach(function (r) { if (r.due < t) sum += Math.max(0, (+r.total || 0) - (+r.paid || 0)); });
    return Math.round(sum);
  }
  function nextDueOf(l) {
    var t = today(), row = null;
    (l.schedule || []).forEach(function (r) { if (!row && (+r.paid || 0) < (+r.total || 0)) row = r; });
    return row ? { due: row.due, amount: Math.max(0, row.total - (+row.paid || 0)), late: row.due < t } : null;
  }
  // + = still ahead, − = already late. Whole days, local midnight to local
  // midnight (never via toISOString — that shifts a day back in +06).
  function daysUntil(iso) {
    return Math.round((new Date(iso + 'T00:00:00') - new Date(today() + 'T00:00:00')) / 86400000);
  }
  function daysPastDue(l) {
    var t = today(), first = null;
    (l.schedule || []).forEach(function (r) { if (!first && (+r.paid || 0) < (+r.total || 0) && r.due < t) first = r; });
    if (!first) return 0;
    return Math.round((new Date(t + 'T00:00:00') - new Date(first.due + 'T00:00:00')) / 86400000);
  }
  function loans() { return S.list('loans_ext'); }
  function loansIn(cid) { return loans().filter(function (l) { return cid === 'all' ? true : (l.companyId || 'group') === cid; }); }
  /* ---- the borrowings book (what WE owe) --------------------------------*/
  function taken() { return S.list('loans_taken'); }
  function takenIn(cid) { return taken().filter(function (l) { return cid === 'all' ? true : (l.companyId || 'group') === cid; }); }
  // Transactions carry `book` ('ext' | 'taken'). Rows written before the
  // borrowings book existed have no `book` — they are all external.
  function txnsOf(book, cid) {
    return S.list('loan_txns').filter(function (t) {
      return (t.book || 'ext') === book && (cid === 'all' || t.companyId === cid);
    }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
  }
  // How much of a loan is behind us — the owner's "remaining percentage",
  // read from money actually paid against the money the schedule asks for.
  function progressOf(l) {
    var tot = dueTotalOf(l);
    return tot ? Math.min(100, Math.round(paidOf(l) / tot * 100)) : 0;
  }
  function progressBar(pct, tone) {
    return '<div style="height:6px;background:var(--surface-3);border-radius:4px;overflow:hidden;min-width:70px">' +
      '<div style="height:100%;width:' + Math.max(2, pct) + '%;background:var(--' + (tone || 'accent') + ')"></div></div>' +
      '<span class="text-mute xs">' + pct + '% paid</span>';
  }

  /* ---- staff-loan reads (payroll owns the data; we only read it) --------*/
  function PR() { return EPAL.payroll; }
  function staffTxns(empId) {
    if (!PR() || !PR().txnsFor) return [];
    return PR().txnsFor(empId).filter(function (x) { return x.type === 'loan' || x.type === 'loan-repay'; })
      .sort(function (a, b) { return a.date < b.date ? 1 : -1; });
  }
  function staffEmi(empId) { return PR() && PR().emiInstallment ? PR().emiInstallment(empId) : 0; }
  function staffOut(empId) { return PR() && PR().loanOutstanding ? PR().loanOutstanding(empId) : 0; }
  // A name that LOOKS clickable but is deliberately not EPAL.people.linkify:
  // that helper carries the .emp-link class, and a global listener on it opens
  // the entire employee (accounts, payslips, attendance). On a loan desk the
  // name must open the loan and nothing else, so the row click handles it.
  function nameLink(text) {
    return '<span class="strong" style="text-decoration:underline dotted;text-underline-offset:3px">' + esc(text) + '</span>';
  }

  /* ==========================================================================
   * SEED — a realistic external book + the loan products
   * ========================================================================*/
  EPAL.registerEngine({ name: 'loans-seed', seed: function () {
    S.seedOnce('loan_products', [
      { id: 'LP-STAFF-EXT', name: 'Personal Loan (Individual)', rate: 12, method: 'reducing', tenure: 12, penalty: 2, notes: 'Un-secured, for known individuals · guarantor required' },
      { id: 'LP-BIZ', name: 'Business Loan (Partner/Agent)', rate: 15, method: 'reducing', tenure: 24, penalty: 2, notes: 'For sub-agents & partners · cheque security' },
      { id: 'LP-BRIDGE', name: 'Bridge / Short-term', rate: 18, method: 'flat', tenure: 6, penalty: 3, notes: 'Quick working-capital support, flat interest' },
      { id: 'LP-FRIENDLY', name: 'Interest-free (Goodwill)', rate: 0, method: 'flat', tenure: 10, penalty: 0, notes: 'No interest — relationship lending' }
    ]);
    if (!S.get('loans_ext_seeded_v1', null)) {
      var demo = [
        { borrower: 'Rafiqul Islam Traders', type: 'Business', phone: '01711-456780', companyId: 'travels', product: 'LP-BIZ',
          principal: 800000, rate: 15, method: 'reducing', tenureMonths: 24, start: -8, purpose: 'Ticketing counter expansion (Uttara)',
          security: 'Post-dated cheques ×24', guarantor: 'Md. Shahjahan (brother)', paidUpto: 8 },
        { borrower: 'Nasima Akter', type: 'Individual', phone: '01819-223344', companyId: 'travels', product: 'LP-STAFF-EXT',
          principal: 250000, rate: 12, method: 'reducing', tenureMonths: 12, start: -5, purpose: 'Family medical emergency',
          security: 'Gold ornaments receipt', guarantor: 'Abdul Karim', paidUpto: 5 },
        { borrower: 'Meghna Builders Ltd.', type: 'Company', phone: '02-9887766', companyId: 'construction', product: 'LP-BIZ',
          principal: 1500000, rate: 15, method: 'reducing', tenureMonths: 24, start: -10, purpose: 'Sub-contract mobilisation advance',
          security: 'Corporate guarantee + BG', guarantor: 'Meghna Holdings', paidUpto: 7 },   // 3 installments behind
        { borrower: 'Shahin Enterprise', type: 'Business', phone: '01911-778899', companyId: 'shop', product: 'LP-BRIDGE',
          principal: 300000, rate: 18, method: 'flat', tenureMonths: 6, start: -4, purpose: 'Festival stock purchase',
          security: 'Stock hypothecation', guarantor: '—', paidUpto: 4 },
        { borrower: 'Tanvir Hossain', type: 'Individual', phone: '01521-334455', companyId: 'it', product: 'LP-FRIENDLY',
          principal: 120000, rate: 0, method: 'flat', tenureMonths: 10, start: -3, purpose: 'Goodwill loan to long-term partner',
          security: '—', guarantor: '—', paidUpto: 3 },
        { borrower: 'Delwar Hossain', type: 'Individual', phone: '01633-889900', companyId: 'travels', product: 'LP-STAFF-EXT',
          principal: 180000, rate: 12, method: 'reducing', tenureMonths: 12, start: -11, purpose: 'Personal — vehicle repair',
          security: '—', guarantor: 'Jashim Uddin', paidUpto: 4, defaulted: true }                 // long overdue
      ];
      var out = [], txns = [];
      demo.forEach(function (d, i) {
        var l = { id: 'LN-' + (4001 + i), companyId: d.companyId, borrower: d.borrower, borrowerType: d.type, phone: d.phone,
          productId: d.product, principal: d.principal, rate: d.rate, method: d.method, tenureMonths: d.tenureMonths,
          startDate: addMonths(today(), d.start), purpose: d.purpose, security: d.security, guarantor: d.guarantor,
          status: 'Active', disbursed: true, disbursedDate: addMonths(today(), d.start), notes: '', created: Date.now() - i * 864e5 };
        l.emi = Math.round(emiOf(l.principal, l.rate, l.tenureMonths, l.method));
        l.schedule = buildSchedule(l);
        for (var k = 0; k < Math.min(d.paidUpto, l.schedule.length); k++) {
          l.schedule[k].paid = l.schedule[k].total;
          l.schedule[k].paidDate = l.schedule[k].due;
          txns.push({ id: 'LT-' + l.id + '-' + (k + 1), book: 'ext', loanId: l.id, companyId: l.companyId, type: 'collection',
            date: l.schedule[k].due, amount: l.schedule[k].total, principal: l.schedule[k].principal,
            interest: l.schedule[k].interest, memo: 'Installment ' + (k + 1) + ' collected', by: 'System' });
        }
        if (d.defaulted) l.status = 'Defaulted';
        if (outstandingOf(l) <= 0) l.status = 'Closed';
        out.push(l);
      });
      S.set('loans_ext', out);
      S.set('loan_txns', txns);
      S.set('loans_ext_seeded_v1', today());
    }
    /* ---- the borrowings book: what the GROUP owes -----------------------*/
    if (!S.get('loans_taken_seeded_v1', null)) {
      var borrowed = [
        { lender: 'City Bank PLC', kind: 'Bank Loan', acct: 'CBL-TL-77120', companyId: 'group',
          principal: 5000000, rate: 11, method: 'reducing', tenureMonths: 36, start: -14,
          purpose: 'Head-office floor purchase & fit-out', security: 'Property mortgage (Banani)', paidUpto: 14 },
        { lender: 'IDLC Finance', kind: 'Car Loan', acct: 'IDLC-AL-4432', companyId: 'travels',
          principal: 1800000, rate: 12.5, method: 'reducing', tenureMonths: 48, start: -20,
          purpose: 'Toyota Premio — MD pool car (Dhaka Metro-Ga 17-8842)', security: 'Vehicle hypothecation', paidUpto: 20 },
        { lender: 'BRAC Bank', kind: 'Working Capital', acct: 'BRAC-OD-9910', companyId: 'travels',
          principal: 2500000, rate: 13, method: 'reducing', tenureMonths: 24, start: -9,
          purpose: 'BSP settlement float during peak season', security: 'Corporate guarantee', paidUpto: 9 },
        { lender: 'Lanka Bangla Finance', kind: 'Car Loan', acct: 'LBF-AL-2201', companyId: 'construction',
          principal: 3200000, rate: 12, method: 'reducing', tenureMonths: 60, start: -26,
          purpose: 'Hilux double-cabin — site vehicle', security: 'Vehicle hypothecation', paidUpto: 25 },   // 1 behind
        { lender: 'Eastern Bank', kind: 'Equipment Loan', acct: 'EBL-EL-6070', companyId: 'woodart',
          principal: 1200000, rate: 10.5, method: 'reducing', tenureMonths: 30, start: -6,
          purpose: 'CNC router & dust-extraction plant', security: 'Machine hypothecation', paidUpto: 6 }
      ];
      var tk = [], tkTx = [];
      borrowed.forEach(function (d, i) {
        var b = { id: 'BR-' + (7001 + i), companyId: d.companyId, lender: d.lender, kind: d.kind, acctNo: d.acct,
          principal: d.principal, rate: d.rate, method: d.method, tenureMonths: d.tenureMonths,
          startDate: addMonths(today(), d.start), purpose: d.purpose, security: d.security,
          status: 'Active', notes: '', created: Date.now() - i * 864e5 };
        b.emi = Math.round(emiOf(b.principal, b.rate, b.tenureMonths, b.method));
        b.schedule = buildSchedule(b);
        for (var k = 0; k < Math.min(d.paidUpto, b.schedule.length); k++) {
          b.schedule[k].paid = b.schedule[k].total;
          b.schedule[k].paidDate = b.schedule[k].due;
          tkTx.push({ id: 'TT-' + b.id + '-' + (k + 1), book: 'taken', loanId: b.id, companyId: b.companyId, type: 'repayment',
            date: b.schedule[k].due, amount: b.schedule[k].total, principal: b.schedule[k].principal,
            interest: b.schedule[k].interest, memo: 'Installment ' + (k + 1) + ' paid', by: 'System' });
        }
        if (outstandingOf(b) <= 0) b.status = 'Closed';
        tk.push(b);
      });
      S.set('loans_taken', tk);
      S.set('loan_txns', S.list('loan_txns').concat(tkTx));
      S.set('loans_taken_seeded_v1', today());
    }

    /* ---- DETACH from the main accounts (owner 2026-07-15) ---------------
     * The first build of this desk posted real journals for the external
     * book (DR 1270 / CR 1010 on disburse, interest → 4060, write-offs →
     * 5700, plus GL-LNOPEN openings) and moved bank balances. The owner has
     * since ruled that loan accounts are handled separately here and must not
     * affect the main accounts — only employee loans may. See the file header
     * for why that is also correct (a VISA-on-instalments is already a
     * receivable from the sale; booking it again would double-count).
     *
     * This one-time cleanup unwinds that build completely and idempotently:
     * every journal it posted is removed, any bank movement it made is put
     * back, and the three heads only it used leave the chart — so 1270/4060/
     * 5700 do not sit on the trial balance at zero, telling a half-truth. */
    if (L() && !S.get('loans_gl_detach_v1', null)) {
      try {
        var MINE = /^GL-(LNOPEN|LOAN|LREP|LNWO)-/;
        var journals = 0, restored = 0;
        // 1) put back any bank movement this desk made (balance + register row)
        S.list('bank_txns').filter(function (t) { return MINE.test(t.glId || ''); }).forEach(function (t) {
          var bank = db().col('banks').filter(function (x) { return x.id === t.bankId; })[0];
          if (!bank) return;
          var wasIn = t.type === 'deposit' || t.type === 'transfer-in';
          bank.balance = (+bank.balance || 0) + (wasIn ? -(+t.amount || 0) : (+t.amount || 0));
          db().save('banks', bank); restored++;
        });
        S.set('bank_txns', S.list('bank_txns').filter(function (t) { return !MINE.test(t.glId || ''); }));
        // 2) remove the journals themselves
        (L().entries({}) || []).forEach(function (e) {
          if (!MINE.test(e.id)) return;
          try { L().remove(e.id); journals++; } catch (x) {}
        });
        // 3) drop the heads only this desk used — but never one that still
        //    carries a balance from somewhere else (defensive: 5700/4060 are
        //    loan-only today, and this keeps that assumption from biting later)
        var coa = S.list('coa'), before = coa.length;
        coa = coa.filter(function (a) {
          if (['1270', '4060', '5700'].indexOf(a.code) < 0) return true;
          var bal = 0; try { bal = L().balance(a.code, {}); } catch (x) { bal = 0; }
          return Math.abs(bal) > 0.5;                       // still used → keep it
        });
        if (coa.length !== before) S.set('coa', coa);
        S.set('loans_gl_detach_v1', { journals: journals, bankTxns: restored, accountsDropped: before - coa.length });
      } catch (x) {}
    }
  } });

  /* ==========================================================================
   * THE DESK
   * ========================================================================*/
  var TABS = [['overview', 'Overview'], ['external', 'External Loans'], ['employee', 'Employee Loans'],
    ['taken', 'Loans We Took'], ['setup', 'Loan Setup'], ['reports', 'Reports']];
  var tab = 'overview';
  EPAL.loanDesk = function (page, cid, opts) {
    var host = el('div');
    function draw() {
      host.innerHTML = '';
      var bar = el('div.pill-tab');
      TABS.forEach(function (t) { bar.appendChild(el('button' + (tab === t[0] ? '.active' : ''), { text: t[1], onclick: function () { tab = t[0]; draw(); } })); });
      var row = el('div.nav-row.mb-3');
      row.appendChild(bar);
      if (opts && opts.rightEl) {
        row.appendChild(el('div.vsep'));
        opts.rightEl.classList.remove('mb-3'); opts.rightEl.classList.remove('flex-wrap'); opts.rightEl.classList.add('co-sw');
        row.appendChild(opts.rightEl);
      }
      host.appendChild(row);
      var body = el('div');
      ({ overview: overviewView, external: externalView, employee: employeeView, taken: takenView,
        setup: setupView, reports: reportsView }[tab] || overviewView)(body, cid);
      host.appendChild(body);
    }
    draw();
    page.appendChild(host);
  };

  /* ---------------------------------------------------------- OVERVIEW */
  function empBook(cid) {
    // read-only mirror of the payroll staff-loan book
    var out = [];
    if (!PR() || !PR().loanOutstanding) return out;
    var cos = cid === 'all' ? comps().map(function (c) { return c.id; }) : [cid];
    cos.forEach(function (c) {
      (db().employees ? db().employees({ companyId: c }) : []).forEach(function (e) {
        var o = staffOut(e.id);
        if (o > 0) out.push({ emp: e, companyId: c, out: o });
      });
    });
    return out;
  }
  function overviewView(page, cid) {
    var list = loansIn(cid);
    var active = list.filter(function (l) { return l.status === 'Active'; });
    var extOut = list.reduce(function (a, l) { return a + (l.status === 'Written-off' ? 0 : outstandingOf(l)); }, 0);
    var overdue = list.reduce(function (a, l) { return a + overdueOf(l); }, 0);
    var emp = empBook(cid);
    var empOut = emp.reduce(function (a, x) { return a + x.out; }, 0);
    var tkn = takenIn(cid).filter(function (b) { return b.status !== 'Closed'; });
    var tknOwe = tkn.reduce(function (a, b) { return a + outstandingOf(b); }, 0);
    var ymNow = today().slice(0, 7);
    var collected = txnsOf('ext', cid).filter(function (t) { return t.type === 'collection' && String(t.date).slice(0, 7) === ymNow; })
      .reduce(function (a, t) { return a + (+t.amount || 0); }, 0);
    var interestEarned = txnsOf('ext', cid).filter(function (t) { return t.type === 'collection'; })
      .reduce(function (a, t) { return a + (+t.interest || 0); }, 0);
    var interestPaid = txnsOf('taken', cid).filter(function (t) { return t.type === 'repayment'; })
      .reduce(function (a, t) { return a + (+t.interest || 0); }, 0);
    // the EMIs we owe in the next 30 days — the borrowings book's real alarm
    var soon = tkn.reduce(function (a, b) { var n = nextDueOf(b); return a + (n && daysUntil(n.due) <= 30 ? n.amount : 0); }, 0);

    // Six facts, laid out 3+3 rather than six-abreast (owner review 2026-07-15):
    // squeezed into one row every label wrapped to two lines and the strip read
    // ragged. --kpi-cols is the house cap knob (see .kpi-grid) — an even split
    // beats a ragged 5+1. Labels shortened to fit one line at the new 12px.
    page.appendChild(el('div.kpi-grid.kpi-compact.stagger', { style: '--kpi-cols:3' }, [
      kpi('Lent Out', ui.money(extOut, { compact: true }), 'people'),
      kpi('Staff Loans', ui.money(empOut, { compact: true }), 'person-badge'),
      kpi('We Owe', ui.money(tknOwe, { compact: true }), 'bank', tknOwe ? 'text-warn' : null),
      kpi('Overdue', ui.money(overdue, { compact: true }), 'exclamation-octagon', overdue ? 'text-bad' : null),
      kpi('EMI Due · 30d', ui.money(soon, { compact: true }), 'calendar-event'),
      kpi('Collected MTD', ui.money(collected, { compact: true }), 'cash-coin', 'text-good')
    ]));

    // The three books side by side — the owner's "one portfolio" view. Money
    // in and money out are deliberately not netted: they are different books.
    var three = el('div.three-col');
    three.appendChild(el('div.card', null, [
      el('div.card-head', null, [el('h3', { html: ui.icon('people') + ' We Lent Out' }), el('span.card-sub', { text: 'external' })]),
      el('div.card-body', null, [
        el('div.stat-row.stat-2.mb-2', null, [
          el('div.stat', null, [el('div.stat-label', { text: 'Active loans' }), el('div.stat-value', { text: String(active.length) })]),
          el('div.stat', null, [el('div.stat-label', { text: 'To collect' }), el('div.stat-value.num', { text: ui.money(extOut, { compact: true }) })]),
          el('div.stat', null, [el('div.stat-label', { text: 'Interest earned' }), el('div.stat-value.num.text-good', { text: ui.money(interestEarned, { compact: true }) })])
        ]),
        el('div.text-mute.xs', { text: 'Tracked here only — kept out of the main accounts.' }),
        el('button.btn.btn-sm.btn-primary.mt-2', { html: ui.icon('list-ul') + ' Open the register', onclick: function () { tab = 'external'; EPAL.router.render(); } })
      ])
    ]));
    three.appendChild(el('div.card', null, [
      el('div.card-head', null, [el('h3', { html: ui.icon('person-badge') + ' Staff Loans' }), el('span.card-sub', { text: 'payroll' })]),
      el('div.card-body', null, [
        el('div.stat-row.stat-2.mb-2', null, [
          el('div.stat', null, [el('div.stat-label', { text: 'Staff with loans' }), el('div.stat-value', { text: String(emp.length) })]),
          el('div.stat', null, [el('div.stat-label', { text: 'Outstanding' }), el('div.stat-value.num', { text: ui.money(empOut, { compact: true }) })]),
          el('div.stat', null, [el('div.stat-label', { text: 'Recovery' }), el('div.stat-value', { text: 'Automatic' })])
        ]),
        el('div.text-mute.xs', { text: 'The one loan book that IS on the main accounts (1260) — recovered as payslip EMI.' }),
        el('button.btn.btn-sm.btn-outline.mt-2', { html: ui.icon('person-badge') + ' See the staff book', onclick: function () { tab = 'employee'; EPAL.router.render(); } })
      ])
    ]));
    three.appendChild(el('div.card', null, [
      el('div.card-head', null, [el('h3', { html: ui.icon('bank') + ' We Took' }), el('span.card-sub', { text: 'borrowed' })]),
      el('div.card-body', null, [
        el('div.stat-row.stat-2.mb-2', null, [
          el('div.stat', null, [el('div.stat-label', { text: 'Running loans' }), el('div.stat-value', { text: String(tkn.length) })]),
          el('div.stat', null, [el('div.stat-label', { text: 'Still owed' }), el('div.stat-value.num' + (tknOwe ? '.text-warn' : ''), { text: ui.money(tknOwe, { compact: true }) })]),
          el('div.stat', null, [el('div.stat-label', { text: 'Interest paid' }), el('div.stat-value.num', { text: ui.money(interestPaid, { compact: true }) })])
        ]),
        el('div.text-mute.xs', { text: 'Bank loans, car EMIs, equipment — tracked here only.' }),
        el('button.btn.btn-sm.btn-outline.mt-2', { html: ui.icon('bank') + ' See what we owe', onclick: function () { tab = 'taken'; EPAL.router.render(); } })
      ])
    ]));
    page.appendChild(three);

    // needs attention — both directions: money we must chase, and money we must pay
    var risk = list.filter(function (l) { return overdueOf(l) > 0 || l.status === 'Defaulted'; })
      .sort(function (a, b) { return daysPastDue(b) - daysPastDue(a); });
    var bodyR = el('div.card-body');
    if (!risk.length) bodyR.appendChild(el('div.text-mute.sm', { text: 'Nothing overdue — every installment is on time.' }));
    risk.slice(0, 5).forEach(function (l) {
      var d = daysPastDue(l);
      bodyR.appendChild(el('div.data-row', { style: { cursor: 'pointer' }, onclick: function () { loanDetail(l); } }, [
        ui.frag('<span class="notif-ico notif-' + (d > 60 ? 'error' : 'warning') + '">' + ui.icon('exclamation-triangle') + '</span>'),
        el('div.flex-1', null, [el('div.fw-600.sm', { text: l.borrower + ' · ' + coName(l.companyId) }),
          el('div.text-mute.xs', { text: (l.status === 'Defaulted' ? 'DEFAULTED · ' : '') + ui.money(overdueOf(l)) + ' overdue · ' + d + ' days past due — money to collect' })]),
        el('span.badge' + (d > 60 ? '.badge-bad' : '.badge-warn'), { text: d > 60 ? 'CRITICAL' : 'FOLLOW UP' })
      ]));
    });
    // our own EMIs: late first, then whatever falls due inside a month
    takenIn(cid).filter(function (b) { return b.status === 'Active'; }).map(function (b) { return { b: b, n: nextDueOf(b) }; })
      .filter(function (x) { return x.n && daysUntil(x.n.due) <= 30; })
      .sort(function (a, b) { return daysUntil(a.n.due) - daysUntil(b.n.due); }).slice(0, 5)
      .forEach(function (x) {
        var days = daysUntil(x.n.due), late = days < 0;
        bodyR.appendChild(el('div.data-row', { style: { cursor: 'pointer' }, onclick: function () { takenDetail(x.b); } }, [
          ui.frag('<span class="notif-ico notif-' + (late ? 'error' : 'info') + '">' + ui.icon(late ? 'exclamation-triangle' : 'calendar-event') + '</span>'),
          el('div.flex-1', null, [el('div.fw-600.sm', { text: x.b.lender + ' · ' + x.b.kind + ' · ' + coName(x.b.companyId) }),
            el('div.text-mute.xs', { text: ui.money(x.n.amount) + ' ' + (late ? 'was due ' + ui.date(x.n.due) + ' · ' + Math.abs(days) + ' days late' : 'due ' + ui.date(x.n.due) + ' · in ' + days + ' days') + ' — we pay this' })]),
          el('span.badge' + (late ? '.badge-bad' : '.badge-info'), { text: late ? 'PAY NOW' : 'UPCOMING' })
        ]));
      });
    page.appendChild(el('div.card.mt-2', null, [
      el('div.card-head', null, [el('h3', { html: ui.icon('flag') + ' Needs Attention' }),
        el('span.card-sub', { text: 'overdue collections · our EMIs due within 30 days' })]), bodyR
    ]));
  }

  /* --------------------------------------------------- EXTERNAL LOANS */
  function statusBadge(l) {
    var s = l.status;
    if (s === 'Active' && overdueOf(l) > 0) return '<span class="badge badge-warn">Overdue</span>';
    return '<span class="badge badge-' + ({ Active: 'good', Closed: 'info', Defaulted: 'bad', 'Written-off': '', Draft: 'warn' }[s] || '') + '">' + esc(s) + '</span>';
  }
  function externalView(page, cid) {
    var list = loansIn(cid).slice().sort(function (a, b) { return (b.created || 0) - (a.created || 0); });
    var out = list.reduce(function (a, l) { return a + (l.status === 'Written-off' ? 0 : outstandingOf(l)); }, 0);
    var disbursed = list.reduce(function (a, l) { return a + (+l.principal || 0); }, 0);
    page.appendChild(el('div.kpi-grid.kpi-compact.stagger', null, [
      kpi('Loans', String(list.length), 'file-earmark-text'),
      kpi('Disbursed (principal)', ui.money(disbursed, { compact: true }), 'cash-stack'),
      kpi('Outstanding', ui.money(out, { compact: true }), 'hourglass-split', out ? 'text-warn' : null),
      kpi('Collected', ui.money(list.reduce(function (a, l) { return a + paidOf(l); }, 0), { compact: true }), 'check2-circle', 'text-good'),
      kpi('Scope', cid === 'all' ? 'All companies' : coName(cid), 'diagram-3')
    ]));
    if (can(cid)) page.appendChild(el('div.mb-2', null, [
      el('button.btn.btn-sm.btn-primary', { html: ui.icon('plus-lg') + ' New Loan', onclick: function () { loanForm(null, cid); } })
    ]));
    var cols = [
      { key: 'borrower', label: 'Borrower', render: function (l) {
        return '<span class="strong">' + esc(l.borrower) + '</span><div class="text-mute xs">' + esc(l.borrowerType || '—') + (l.phone ? ' · ' + esc(l.phone) : '') + '</div>'; } },
      { key: 'id', label: 'Loan No', render: function (l) { return '<span class="mono xs text-mute">' + esc(l.id) + '</span>'; } },
      { key: 'principal', label: 'Principal', num: true, money: true },
      { key: 'terms', label: 'Terms', render: function (l) { return (+l.rate || 0) + '% · ' + (l.method === 'reducing' ? 'reducing' : 'flat') + '<div class="text-mute xs">' + (l.tenureMonths || 0) + ' months · EMI ' + ui.money(l.emi) + '</div>'; },
        exportVal: function (l) { return l.rate + '% ' + l.method + ' ' + l.tenureMonths + 'm'; } },
      { key: 'next', label: 'Next Due', render: function (l) {
        var n = nextDueOf(l);
        if (!n) return '<span class="text-mute">—</span>';
        return ui.date(n.due) + (n.late ? ' <span class="badge badge-bad">LATE</span>' : '') + '<div class="text-mute xs num">' + ui.money(n.amount) + '</div>'; },
        sortVal: function (l) { var n = nextDueOf(l); return n ? n.due : '9999'; }, exportVal: function (l) { var n = nextDueOf(l); return n ? n.due : ''; } },
      { key: 'outstanding', label: 'Outstanding', num: true, sortVal: outstandingOf, render: function (l) {
        var o = outstandingOf(l), od = overdueOf(l);
        return '<span class="num strong">' + ui.money(o) + '</span>' + (od ? '<div class="text-mute xs num text-bad">' + ui.money(od) + ' overdue</div>' : ''); },
        exportVal: outstandingOf },
      { key: 'status', label: 'Status', render: statusBadge, exportVal: function (l) { return l.status; } }
    ];
    if (cid === 'all') cols.splice(1, 0, { key: 'companyId', label: 'Company', render: function (l) { var c = EPAL.config.company(l.companyId); return '<span class="badge"' + (c ? ' style="color:' + c.accent + '"' : '') + '>' + esc(coName(l.companyId)) + '</span>'; }, exportVal: function (l) { return l.companyId; } });
    var tbl = EPAL.table({
      columns: cols, rows: list, pageSize: 10, searchKeys: ['borrower', 'id', 'phone', 'purpose'],
      quickFilter: 'status', filterPanel: true,
      filters: [{ key: 'borrowerType', label: 'Type' }].concat(cid === 'all' ? [{ key: 'companyId', label: 'Company' }] : []),
      totalKey: 'principal', exportName: 'external-loans.csv', pdfTitle: 'External Loan Register — ' + coName(cid),
      onRow: function (l) { loanDetail(l); },
      actions: can(cid) ? [
        { icon: 'eye', title: 'Open', onClick: function (l) { loanDetail(l); } },
        { icon: 'cash-coin', title: 'Record collection', onClick: function (l) {
          if (l.status !== 'Active' && l.status !== 'Defaulted') { ui.toast('This loan is ' + l.status.toLowerCase(), 'error'); return; }
          collectForm(l);
        } },
        { icon: 'printer', title: 'Print statement', onClick: function (l) { printStatement(l); } }
      ] : [{ icon: 'eye', title: 'Open', onClick: function (l) { loanDetail(l); } }],
      empty: { icon: 'bank', title: 'No external loans yet', hint: 'Lend to someone outside the group with New Loan.' }
    });
    page.appendChild(el('div.card', null, [
      el('div.card-head', null, [el('h3', { html: ui.icon('bank') + ' External Loan Register — ' + coName(cid) }),
        el('span.card-sub', { text: 'click a row for the schedule & history' })]),
      el('div.card-body', null, [tbl.el])
    ]));
  }

  /* ==========================================================================
   * SHARED DETAIL PARTS — every loan drill-down (lent out · staff · borrowed)
   * is built from these, so the three read identically.
   * ========================================================================*/
  function st(label, value, tone) {
    return el('div.stat', null, [el('div.stat-label', { text: label }),
      el('div.stat-value.num' + (tone ? '.' + tone : ''), { text: String(value) })]);
  }
  function row2(k, v) {
    return el('div.data-row', null, [el('div.text-mute.sm.flex-1', { text: k }),
      el('div.strong.data-v', { text: v == null || v === '' ? '—' : String(v) })]);
  }
  /* The tidy block (owner 2026-07-15: "make the information more structured").
   * One long right-aligned run per fact used to push the value a metre from
   * its label and off the modal edge. Facts are now grouped and split into two
   * columns of short label→value pairs, each fact discrete rather than a
   * run-on sentence. groups = [[title, [[k, v], …]], …] */
  function factCols(groups) {
    var wrap = el('div.detail-cols');
    groups.forEach(function (g) {
      wrap.appendChild(el('div', null, [
        el('div.section-label.mt-0.mb-1', { text: g[0] }),
        el('div.data-list', null, g[1].map(function (p) { return row2(p[0], p[1]); }))
      ]));
    });
    return wrap;
  }
  function scheduleCard(rec, title, doneWord) {
    var done = (rec.schedule || []).filter(function (r) { return (+r.paid || 0) >= (+r.total || 0); }).length;
    var t = EPAL.table({
      columns: [
        { key: 'no', label: '#', num: true },
        { key: 'due', label: 'Due', date: true, render: function (r) {
          var late = (+r.paid || 0) < (+r.total || 0) && r.due < today();
          return ui.date(r.due) + (late ? ' <span class="badge badge-bad">late</span>' : ''); } },
        { key: 'principal', label: 'Principal', num: true, money: true },
        { key: 'interest', label: 'Interest', num: true, money: true },
        { key: 'total', label: 'Installment', num: true, money: true },
        { key: 'paid', label: 'Paid', num: true, render: function (r) {
          var p = +r.paid || 0;
          return p >= (+r.total || 0) ? '<span class="badge badge-good">paid ' + ui.date(r.paidDate) + '</span>'
            : p > 0 ? '<span class="num text-warn">' + ui.money(p) + '</span>' : '<span class="text-mute">—</span>'; },
          sortVal: function (r) { return +r.paid || 0; }, exportVal: function (r) { return r.paid; } }
      ],
      rows: (rec.schedule || []), pageSize: 12, exportName: 'loan-schedule-' + rec.id + '.csv',
      empty: { icon: 'calendar3', title: 'No schedule' }
    });
    return el('div.card.mb-2', null, [
      el('div.card-head', null, [el('h3', { html: ui.icon('calendar3') + ' ' + title }),
        el('span.card-sub', { text: done + ' of ' + (rec.schedule || []).length + ' ' + doneWord })]),
      el('div.card-body', null, [t.el])
    ]);
  }
  function historyCard(loanId, book) {
    var hx = S.list('loan_txns').filter(function (t) { return t.loanId === loanId && (t.book || 'ext') === book; })
      .sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    var t = EPAL.table({
      columns: [
        { key: 'date', label: 'Date', date: true },
        { key: 'type', label: 'Type', badge: { disbursement: 'info', collection: 'good', repayment: 'good', 'write-off': 'bad' } },
        { key: 'memo', label: 'Detail', render: function (x) {
          var where = x.into || x.from || '';
          return esc(x.memo || '—') + (where ? '<div class="text-mute xs">' + esc(where) + '</div>' : ''); } },
        { key: 'principal', label: 'Principal', num: true, money: true },
        { key: 'interest', label: 'Interest', num: true, money: true },
        { key: 'amount', label: 'Amount', num: true, money: true }
      ],
      rows: hx, pageSize: 8, totalKey: 'amount', exportName: 'loan-history-' + loanId + '.csv',
      empty: { icon: 'clock-history', title: 'No transactions yet' }
    });
    return el('div.card', null, [
      el('div.card-head', null, [el('h3', { html: ui.icon('clock-history') + ' Transaction History' })]),
      el('div.card-body', null, [t.el])
    ]);
  }

  /* ---- loan detail: terms · schedule · history · actions ---------------*/
  function loanDetail(l) {
    var body = el('div');
    var m = ui.modal({ title: l.borrower + ' · ' + l.id, icon: 'bank', size: 'xl', body: body, footer: false });
    function repaint() { body.innerHTML = ''; render(); }
    function render() {
      var fresh = loans().filter(function (x) { return x.id === l.id; })[0] || l; l = fresh;
      var acts = el('div.flex.gap-1.flex-wrap', { style: { marginLeft: 'auto' } });
      if (can(l.companyId)) {
        if (l.status === 'Active' || l.status === 'Defaulted') {
          acts.appendChild(el('button.btn.btn-sm.btn-primary', { html: ui.icon('cash-coin') + ' Record Collection', onclick: function () { m.close(); collectForm(l); } }));
          acts.appendChild(el('button.btn.btn-sm.btn-outline', { html: ui.icon('pencil') + ' Edit', onclick: function () { m.close(); loanForm(l, l.companyId); } }));
        }
        acts.appendChild(el('button.btn.btn-sm.btn-outline', { html: ui.icon('printer') + ' Statement', onclick: function () { printStatement(l); } }));
        if (l.status === 'Active') acts.appendChild(el('button.btn.btn-sm.btn-ghost', { html: ui.icon('exclamation-octagon') + ' Mark Defaulted', onclick: function () {
          ui.confirm({ title: 'Mark this loan defaulted?', text: ui.money(outstandingOf(l)) + ' from ' + l.borrower + ' will be flagged for recovery action.', danger: true, confirmLabel: 'Mark Defaulted' })
            .then(function (ok) { if (!ok) return; l.status = 'Defaulted'; S.upsert('loans_ext', l); ui.toast('Marked defaulted', 'success'); repaint(); EPAL.router.render(); });
        } }));
        if (l.status === 'Defaulted') acts.appendChild(el('button.btn.btn-sm.btn-ghost', { html: ui.icon('x-octagon') + ' Write Off', onclick: function () { m.close(); writeOffForm(l); } }));
      }
      var n = nextDueOf(l), od = overdueOf(l), pct = progressOf(l);
      body.appendChild(el('div.card.mb-2', null, [el('div.card-body', null, [
        el('div.flex.items-center.gap-2.flex-wrap.mb-3', null, [
          el('div.flex-1', null, [el('div.fw-700', { text: l.borrower }),
            el('div.text-mute.sm', { text: (l.borrowerType || '') + (l.phone ? ' · ' + l.phone : '') + ' · ' + coName(l.companyId) + ' · ' + l.id })]),
          ui.frag(statusBadge(l)), acts]),
        el('div.stat-row.mb-3', null, [
          st('Principal', ui.money(l.principal)),
          st('Outstanding', ui.money(outstandingOf(l)), od ? 'text-bad' : null),
          st('Collected', ui.money(paidOf(l)), 'text-good'),
          st('Next due', n ? ui.date(n.due) : '—', n && n.late ? 'text-bad' : null),
          st('Recovered', pct + '%')
        ]),
        el('div.mb-3', null, [ui.frag(progressBar(pct))]),
        factCols([
          ['Loan terms', [
            ['Interest rate', (+l.rate || 0) + '% per year'],
            ['Method', l.method === 'reducing' ? 'Reducing balance' : 'Flat'],
            ['Tenure', l.tenureMonths + ' months'],
            ['Monthly EMI', ui.money(l.emi)],
            ['Total repayable', ui.money(dueTotalOf(l))],
            ['Interest earned', ui.money(Math.max(0, dueTotalOf(l) - (+l.principal || 0)))]
          ]],
          ['Schedule & security', [
            ['Disbursed', l.disbursed ? ui.date(l.disbursedDate || l.startDate) : 'Not disbursed yet'],
            ['First installment', ui.date(addMonths(l.startDate, 1))],
            ['Final installment', ui.date(addMonths(l.startDate, l.tenureMonths))],
            ['Installments left', String((l.schedule || []).filter(function (r) { return (+r.paid || 0) < (+r.total || 0); }).length)],
            ['Security', l.security || '—'],
            ['Guarantor', l.guarantor || '—']
          ]]
        ]),
        (l.purpose || od || l.notes || l.writeOffReason) ? el('div.data-list.mt-2', null, [
          l.purpose ? row2('Purpose', l.purpose) : null,
          od ? row2('Overdue', ui.money(od) + ' · ' + daysPastDue(l) + ' days past due') : null,
          l.writeOffReason ? row2('Written off', ui.date(l.writeOffDate) + ' — ' + l.writeOffReason) : null,
          l.notes ? row2('Notes', l.notes) : null
        ].filter(Boolean)) : null
      ].filter(Boolean))]));
      body.appendChild(scheduleCard(l, 'Repayment Schedule', 'installments settled'));
      body.appendChild(historyCard(l.id, 'ext'));
    }
    render();
  }

  /* ---- new / edit loan -------------------------------------------------*/
  function loanForm(l, cid) {
    var prods = S.list('loan_products');
    var banks = db().col('banks').filter(function (b) { return (b.status || 'Active') !== 'Inactive'; });
    var isNew = !l;
    EPAL.formModal({
      title: isNew ? 'New External Loan' : 'Edit Loan · ' + l.id, icon: 'bank', size: 'lg',
      record: l || { companyId: cid === 'all' ? 'travels' : cid, borrowerType: 'Individual', method: 'reducing', rate: 12, tenureMonths: 12,
        startDate: today(), productId: prods[0] && prods[0].id, bankId: banks[0] && banks[0].id },
      fields: [
        { type: 'section', label: 'Borrower' },
        { key: 'borrower', label: 'Borrower name', type: 'text', required: true, col2: true },
        { key: 'borrowerType', label: 'Borrower type', type: 'select', options: ['Individual', 'Business', 'Company', 'Agent', 'Vendor', 'Other'], default: 'Individual' },
        { key: 'phone', label: 'Phone', type: 'phone' },
        { key: 'companyId', label: 'Lending company', type: 'select', required: true, options: [['group', 'Group HQ']].concat(comps().map(function (c) { return [c.id, c.short]; })) },
        { type: 'section', label: 'Loan Terms' },
        { key: 'productId', label: 'Loan product', type: 'select', options: prods.map(function (p) { return [p.id, p.name + ' (' + p.rate + '% · ' + p.method + ')']; }),
          hint: 'Picking a product does not lock the terms — edit the rate/tenure below if this loan is different.' },
        { key: 'principal', label: 'Principal (৳)', type: 'money', required: true, min: 1 },
        { key: 'rate', label: 'Interest rate (% per year)', type: 'number', min: 0, max: 100, default: 12 },
        { key: 'method', label: 'Interest method', type: 'select', options: [['reducing', 'Reducing balance'], ['flat', 'Flat']], default: 'reducing' },
        { key: 'tenureMonths', label: 'Tenure (months)', type: 'number', required: true, min: 1, max: 120, default: 12 },
        { key: 'startDate', label: 'Disbursement date', type: 'date', required: true, hint: 'The first installment falls one month after this date.' },
        { type: 'section', label: 'Disbursement & Security' },
        { key: 'bankId', label: 'Paid out from (for the record)', type: 'select', options: banks.map(function (b) { return [b.id, b.name]; }),
          showIf: function () { return isNew; },
          hint: 'Recorded on the loan so you know where the money came from. The loan book is kept separate from the main accounts, so no journal is posted and this balance does not change.' },
        { key: 'purpose', label: 'Purpose', type: 'text', col2: true },
        { key: 'security', label: 'Security / collateral', type: 'text' },
        { key: 'guarantor', label: 'Guarantor', type: 'text' },
        { key: 'notes', label: 'Notes', type: 'textarea', col2: true }
      ],
      saveLabel: isNew ? 'Create & Disburse' : 'Save',
      onSave: function (v) {
        var P = +v.principal || 0, n = +v.tenureMonths || 0;
        if (P <= 0 || n <= 0) { ui.toast('Enter the principal and tenure', 'error'); return false; }
        var rec = l || { id: 'LN-' + ui.uid('').slice(-5).toUpperCase(), created: Date.now(), status: 'Active', disbursed: false };
        ['borrower', 'borrowerType', 'phone', 'companyId', 'productId', 'method', 'startDate', 'purpose', 'security', 'guarantor', 'notes'].forEach(function (k) { rec[k] = v[k]; });
        rec.principal = P; rec.rate = +v.rate || 0; rec.tenureMonths = n;
        rec.emi = Math.round(emiOf(P, rec.rate, n, rec.method));
        // rebuild the schedule but KEEP what has already been collected
        var oldPaid = (l && l.schedule) ? l.schedule.map(function (r) { return { paid: r.paid, paidDate: r.paidDate }; }) : [];
        rec.schedule = buildSchedule(rec).map(function (r, i) {
          if (oldPaid[i]) { r.paid = oldPaid[i].paid || 0; r.paidDate = oldPaid[i].paidDate || ''; }
          return r;
        });
        if (isNew) {
          // NO journal, NO bank movement — the loan books are kept separate
          // from the main accounts (see the file header). The bank is recorded
          // on the loan purely so the source of the money is known.
          var bank = db().col('banks').filter(function (b) { return b.id === v.bankId; })[0];
          rec.disbursed = true; rec.disbursedDate = rec.startDate; rec.bankId = bank ? bank.id : '';
          S.upsert('loan_txns', { id: 'LT-' + rec.id + '-D', book: 'ext', loanId: rec.id, companyId: rec.companyId, type: 'disbursement',
            date: rec.startDate, amount: P, principal: P, interest: 0,
            memo: 'Loan disbursed' + (bank ? ' from ' + bank.name : ''), by: whoAmI() });
        }
        S.upsert('loans_ext', rec);
        ui.toast(isNew ? ('Loan ' + rec.id + ' disbursed · EMI ' + ui.money(rec.emi)) : 'Loan updated', 'success');
        EPAL.router.render(); return true;
      }
    });
  }
  function whoAmI() { try { var u = EPAL.auth && EPAL.auth.current && EPAL.auth.current(); return (u && (u.name || u.email)) || 'Owner'; } catch (e) { return 'Owner'; } }

  /* ---- allocate money across a schedule, oldest installment first -------
   * Shared by BOTH directions: collecting from a borrower and paying an EMI
   * on what we owe are the same arithmetic — take the oldest unpaid rows
   * first and split each payment into its principal and interest share. */
  function applyToSchedule(rec, amt, date) {
    var left = amt, prin = 0, intr = 0;
    (rec.schedule || []).forEach(function (r) {
      if (left <= 0) return;
      var due = Math.max(0, (+r.total || 0) - (+r.paid || 0));
      if (due <= 0) return;
      var take = Math.min(left, due);
      var share = (+r.total || 0) ? (+r.principal || 0) / r.total : 1;
      prin += take * share; intr += take * (1 - share);
      r.paid = (+r.paid || 0) + take;
      if (r.paid >= r.total - 0.5) r.paidDate = date;
      left -= take;
    });
    prin = Math.round(prin);
    return { principal: prin, interest: Math.round(amt - prin) };
  }

  /* ---- record a collection (allocates oldest-first, splits P vs I) -----*/
  function collectForm(l) {
    var banks = db().col('banks').filter(function (b) { return (b.status || 'Active') !== 'Inactive'; });
    var n = nextDueOf(l), owed = outstandingOf(l);
    EPAL.formModal({
      title: 'Record Collection · ' + l.borrower, icon: 'cash-coin', size: 'md',
      record: { amount: n ? n.amount : owed, date: today(), bankId: banks[0] && banks[0].id },
      fields: [
        { key: 'amount', label: 'Amount received (৳)', type: 'money', required: true, min: 1,
          hint: 'Next installment ' + (n ? ui.money(n.amount) + ' due ' + ui.date(n.due) : '—') + ' · total outstanding ' + ui.money(owed) + '. Money is applied to the OLDEST unpaid installments first; partial amounts are allowed.' },
        { key: 'date', label: 'Received on', type: 'date', required: true },
        { key: 'bankId', label: 'Received into (for the record)', type: 'select', options: banks.map(function (b) { return [b.id, b.name]; }),
          hint: 'Noted on the receipt only — the loan book does not move the main accounts.' },
        { key: 'memo', label: 'Note', type: 'text', col2: true, placeholder: 'e.g. cheque no / cash received by' }
      ],
      saveLabel: 'Record Collection',
      onSave: function (v) {
        var amt = Math.min(+v.amount || 0, owed);
        if (amt <= 0) { ui.toast('Enter the amount received', 'error'); return false; }
        var bank = db().col('banks').filter(function (b) { return b.id === v.bankId; })[0];
        var sp = applyToSchedule(l, amt, v.date);
        S.upsert('loan_txns', { id: 'LT-' + ui.uid('').slice(-6).toUpperCase(), book: 'ext', loanId: l.id, companyId: l.companyId, type: 'collection',
          date: v.date, amount: amt, principal: sp.principal, interest: sp.interest,
          memo: v.memo || 'Collection', into: bank ? bank.name : '', by: whoAmI() });
        if (outstandingOf(l) <= 0.5) l.status = 'Closed';
        else if (l.status === 'Defaulted' && overdueOf(l) <= 0) l.status = 'Active';
        S.upsert('loans_ext', l);
        ui.toast('Collected ' + ui.money(amt) + ' (principal ' + ui.money(sp.principal) + ' · interest ' + ui.money(sp.interest) + ')' + (l.status === 'Closed' ? ' — loan CLOSED' : ''), 'success');
        EPAL.router.render(); return true;
      }
    });
  }
  function writeOffForm(l) {
    var owed = principalOutstandingOf(l);
    EPAL.formModal({
      title: 'Write Off · ' + l.borrower, icon: 'x-octagon', size: 'sm', record: { date: today() },
      fields: [
        { key: 'reason', label: 'Reason (kept on the loan record)', type: 'textarea', required: true, placeholder: 'e.g. borrower untraceable since Jan; legal cost exceeds recovery' },
        { key: 'date', label: 'Write-off date', type: 'date', required: true }
      ],
      saveLabel: 'Write Off ' + ui.money(owed),
      onSave: function (v) {
        if (owed <= 0) { ui.toast('Nothing left to write off', 'error'); return false; }
        S.upsert('loan_txns', { id: 'LT-' + l.id + '-WO', book: 'ext', loanId: l.id, companyId: l.companyId, type: 'write-off',
          date: v.date, amount: owed, principal: owed, interest: 0, memo: v.reason, by: whoAmI() });
        l.status = 'Written-off'; l.writeOffReason = v.reason; l.writeOffDate = v.date;
        S.upsert('loans_ext', l);
        ui.toast('Written off ' + ui.money(owed) + ' — recorded on the loan book', 'success'); EPAL.router.render(); return true;
      }
    });
  }
  function printStatement(l) {
    var rows = (l.schedule || []).map(function (r) {
      var paid = +r.paid || 0;
      return '<tr><td>' + r.no + '</td><td>' + ui.date(r.due) + '</td><td class="num">' + ui.money(r.principal) + '</td><td class="num">' + ui.money(r.interest) +
        '</td><td class="num">' + ui.money(r.total) + '</td><td class="num">' + (paid ? ui.money(paid) : '—') + '</td><td>' + (paid >= r.total ? ui.date(r.paidDate) : (r.due < today() ? 'OVERDUE' : 'pending')) + '</td></tr>';
    }).join('');
    ui.printDoc({
      title: 'Loan Statement · ' + l.id, subtitle: coName(l.companyId) + ' — ' + l.borrower,
      meta: 'Principal ' + ui.money(l.principal) + ' · ' + (+l.rate || 0) + '% ' + (l.method === 'reducing' ? 'reducing' : 'flat') + ' · ' + l.tenureMonths + ' months · EMI ' + ui.money(l.emi) +
        ' · Outstanding ' + ui.money(outstandingOf(l)) + ' · Status ' + l.status,
      footer: 'Accounts Department · Confidential · generated ' + ui.date(today()),
      bodyHtml: '<table><tr><td><b>Borrower</b></td><td>' + esc(l.borrower) + ' (' + esc(l.borrowerType || '') + ')' + (l.phone ? ' · ' + esc(l.phone) : '') + '</td></tr>' +
        '<tr><td><b>Purpose</b></td><td>' + esc(l.purpose || '—') + '</td></tr>' +
        '<tr><td><b>Security</b></td><td>' + esc(l.security || '—') + '</td></tr>' +
        '<tr><td><b>Guarantor</b></td><td>' + esc(l.guarantor || '—') + '</td></tr>' +
        '<tr><td><b>Disbursed</b></td><td>' + ui.date(l.disbursedDate || l.startDate) + '</td></tr></table>' +
        '<h3>Repayment Schedule</h3><table><thead><tr><th>#</th><th>Due</th><th class="num">Principal</th><th class="num">Interest</th><th class="num">Installment</th><th class="num">Paid</th><th>Status</th></tr></thead><tbody>' +
        rows + '</tbody></table>'
    });
  }

  /* --------------------------------------------------- EMPLOYEE LOANS */
  function employeeView(page, cid) {
    var emp = empBook(cid);
    var totalOut = emp.reduce(function (a, x) { return a + x.out; }, 0);
    var txns = S.list('pay_txns').filter(function (x) { return (cid === 'all' || x.companyId === cid) && (x.type === 'loan' || x.type === 'loan-repay'); })
      .sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    var disbursed = txns.filter(function (x) { return x.type === 'loan'; }).reduce(function (a, x) { return a + (+x.amount || 0); }, 0);
    page.appendChild(el('div.kpi-grid.kpi-compact.stagger', null, [
      kpi('Staff with Loans', String(emp.length), 'people'),
      kpi('Outstanding', ui.money(totalOut, { compact: true }), 'hourglass-split', totalOut ? 'text-warn' : null),
      kpi('Total Disbursed', ui.money(disbursed, { compact: true }), 'cash-stack'),
      kpi('Recovered', ui.money(disbursed - totalOut, { compact: true }), 'check2-circle', 'text-good')
    ]));
    page.appendChild(el('div.build-banner.mb-2', null, [ui.frag(ui.icon('info-circle')),
      el('div', { html: '<strong>The staff book lives in Payroll.</strong> Employee loans recover automatically as an EMI on the payslip, so disbursing and repaying them happens in <strong>Payroll ▸ Loan Management</strong> — this page mirrors that book so the whole loan portfolio reads in one place.' })]));
    page.appendChild(el('div.flex.gap-1.flex-wrap.mb-2', null, [
      el('a.btn.btn-sm.btn-primary', { href: '#/group/master-accounts/payroll', html: ui.icon('person-badge') + ' Open Payroll ▸ Loan Management' })
    ]));
    if (emp.length) {
      var lt = EPAL.table({
        columns: [
          // NOT EPAL.people.linkify (owner 2026-07-15): that opens the whole
          // employee — every account, payslip, attendance. On a loan desk the
          // name must open the LOAN only, so it renders as a plain affordance
          // and the row click below opens the staff-loan drill-down.
          { key: 'name', label: 'Employee', render: function (r) { return nameLink(r.emp.name); },
            exportVal: function (r) { return r.emp.name; }, sortVal: function (r) { return r.emp.name; } },
          { key: 'dept', label: 'Department', render: function (r) { return esc(r.emp.dept || '—'); } },
          { key: 'companyId', label: 'Company', render: function (r) { return '<span class="badge">' + esc(coName(r.companyId)) + '</span>'; }, exportVal: function (r) { return r.companyId; } },
          { key: 'emi', label: 'Monthly EMI', num: true, sortVal: function (r) { return staffEmi(r.emp.id); },
            render: function (r) { var e = staffEmi(r.emp.id); return e ? '<span class="num">' + ui.money(e) + '</span>' : '<span class="text-mute">—</span>'; },
            exportVal: function (r) { return staffEmi(r.emp.id); } },
          { key: 'out', label: 'Outstanding', num: true, sortVal: function (r) { return r.out; }, render: function (r) { return '<span class="num strong text-warn">' + ui.money(r.out) + '</span>'; }, exportVal: function (r) { return r.out; } }
        ],
        rows: emp, pageSize: 10, searchKeys: ['emp.name'], exportName: 'employee-loans.csv', pdfTitle: 'Employee Loan Book — ' + coName(cid),
        onRow: function (r) { staffLoanDetail(r.emp); },
        actions: [{ icon: 'eye', title: 'Open the loan', onClick: function (r) { staffLoanDetail(r.emp); } },
          { icon: 'printer', title: 'Print loan statement', onClick: function (r) { printStaffStatement(r.emp); } }],
        empty: { icon: 'person-badge', title: 'No staff loans outstanding' }
      });
      page.appendChild(el('div.card.mb-2', null, [
        el('div.card-head', null, [el('h3', { html: ui.icon('person-badge') + ' Staff Loan Book — ' + coName(cid) }), el('span.card-sub', { text: 'click a row for the loan only · ledger 1260' })]),
        el('div.card-body', null, [lt.el])
      ]));
    }
    var emis = txns.filter(function (x) { return x.type === 'loan-repay' && /EMI auto-deducted/.test(x.memo || ''); });
    var et = EPAL.table({
      columns: [
        { key: 'date', label: 'Deducted on', date: true },
        { key: 'empName', label: 'Employee', render: function (x) { return EPAL.people && EPAL.people.linkify ? EPAL.people.linkify(x.empName, x.empId) : esc(x.empName); } },
        { key: 'memo', label: 'From which salary', render: function (x) { return esc(String(x.memo || '').replace('EMI auto-deducted from ', '')); } },
        { key: 'amount', label: 'EMI deducted', num: true, money: true }
      ],
      rows: emis, pageSize: 8, totalKey: 'amount', exportName: 'emi-history.csv', pdfTitle: 'Loan EMI Deduction History',
      empty: { icon: 'calendar2-check', title: 'No EMI deductions yet' }
    });
    page.appendChild(el('div.card', null, [
      el('div.card-head', null, [el('h3', { html: ui.icon('calendar2-check') + ' EMI Deduction History' }), el('span.card-sub', { text: 'auto-deducted from salary · dated individually' })]),
      el('div.card-body', null, [et.el])
    ]));
  }

  /* ==========================================================================
   * LOANS WE TOOK — the borrowings book (bank loan · car EMI · equipment)
   * Same schedule maths as lending, read from the other side: `paid` is money
   * WE paid out, `outstanding` is what we still owe. Tracked here only.
   * ========================================================================*/
  function takenView(page, cid) {
    var list = takenIn(cid).slice().sort(function (a, b) { return (b.created || 0) - (a.created || 0); });
    var live = list.filter(function (b) { return b.status !== 'Closed'; });
    var borrowed = list.reduce(function (a, b) { return a + (+b.principal || 0); }, 0);
    var owe = live.reduce(function (a, b) { return a + outstandingOf(b); }, 0);
    var paid = list.reduce(function (a, b) { return a + paidOf(b); }, 0);
    var late = live.reduce(function (a, b) { return a + overdueOf(b); }, 0);
    var monthly = live.reduce(function (a, b) { return a + (+b.emi || 0); }, 0);

    page.appendChild(el('div.kpi-grid.kpi-compact.stagger', null, [
      kpi('Total Borrowed', ui.money(borrowed, { compact: true }), 'bank'),
      kpi('Total Paid', ui.money(paid, { compact: true }), 'check2-circle', 'text-good'),
      kpi('Still Owed', ui.money(owe, { compact: true }), 'hourglass-split', owe ? 'text-warn' : null),
      kpi('Monthly EMI', ui.money(monthly, { compact: true }), 'calendar-event'),
      kpi('Behind', ui.money(late, { compact: true }), 'exclamation-octagon', late ? 'text-bad' : null)
    ]));
    if (can(cid)) page.appendChild(el('div.mb-2', null, [
      el('button.btn.btn-sm.btn-primary', { html: ui.icon('plus-lg') + ' Add a Loan We Took', onclick: function () { takenForm(null, cid); } })
    ]));

    var cols = [
      { key: 'lender', label: 'Lender / Asset', render: function (b) {
        return '<span class="strong">' + esc(b.lender) + '</span><div class="text-mute xs">' + esc(b.purpose || b.kind) + '</div>'; } },
      { key: 'kind', label: 'Type', render: function (b) { return '<span class="badge badge-info">' + esc(b.kind) + '</span>'; }, exportVal: function (b) { return b.kind; } },
      { key: 'principal', label: 'Total Loan', num: true, money: true },
      { key: 'paid', label: 'Paid', num: true, sortVal: paidOf, exportVal: paidOf,
        render: function (b) { return '<span class="num text-good">' + ui.money(paidOf(b)) + '</span>'; } },
      { key: 'due', label: 'Due', num: true, sortVal: outstandingOf, exportVal: outstandingOf,
        render: function (b) {
          var od = overdueOf(b);
          return '<span class="num strong">' + ui.money(outstandingOf(b)) + '</span>' + (od ? '<div class="text-mute xs num text-bad">' + ui.money(od) + ' behind</div>' : ''); } },
      { key: 'next', label: 'Next Date', sortVal: function (b) { var n = nextDueOf(b); return n ? n.due : '9999'; },
        exportVal: function (b) { var n = nextDueOf(b); return n ? n.due : ''; },
        render: function (b) {
          var n = nextDueOf(b);
          if (!n) return '<span class="text-mute">—</span>';
          var d = daysUntil(n.due);
          return ui.date(n.due) + (d < 0 ? ' <span class="badge badge-bad">LATE</span>' : '') +
            '<div class="text-mute xs num">' + ui.money(n.amount) + (d >= 0 ? ' · in ' + d + 'd' : '') + '</div>'; } },
      { key: 'progress', label: 'Remaining', sortVal: progressOf, exportVal: function (b) { return progressOf(b) + '%'; },
        render: function (b) { return progressBar(progressOf(b), 'good'); } },
      { key: 'status', label: 'Status', render: function (b) {
        if (b.status === 'Active' && overdueOf(b) > 0) return '<span class="badge badge-warn">Behind</span>';
        return '<span class="badge badge-' + ({ Active: 'good', Closed: 'info' }[b.status] || '') + '">' + esc(b.status) + '</span>'; },
        exportVal: function (b) { return b.status; } }
    ];
    if (cid === 'all') cols.splice(2, 0, { key: 'companyId', label: 'Company', render: function (b) { return '<span class="badge">' + esc(coName(b.companyId)) + '</span>'; }, exportVal: function (b) { return b.companyId; } });
    var tbl = EPAL.table({
      columns: cols, rows: list, pageSize: 10, searchKeys: ['lender', 'kind', 'purpose', 'acctNo', 'id'],
      quickFilter: 'kind', filterPanel: true,
      filters: [{ key: 'status', label: 'Status' }].concat(cid === 'all' ? [{ key: 'companyId', label: 'Company' }] : []),
      totalKey: 'principal', exportName: 'loans-we-took.csv', pdfTitle: 'Loans We Took — ' + coName(cid),
      onRow: function (b) { takenDetail(b); },
      actions: can(cid) ? [
        { icon: 'eye', title: 'Open', onClick: function (b) { takenDetail(b); } },
        { icon: 'cash-coin', title: 'Record a payment', onClick: function (b) {
          if (b.status !== 'Active') { ui.toast('This loan is ' + b.status.toLowerCase(), 'error'); return; }
          payTakenForm(b);
        } },
        { icon: 'printer', title: 'Print statement', onClick: function (b) { printTakenStatement(b); } }
      ] : [{ icon: 'eye', title: 'Open', onClick: function (b) { takenDetail(b); } }],
      empty: { icon: 'bank', title: 'No borrowings recorded', hint: 'Add a bank loan, a car EMI or an equipment loan to track it here.' }
    });
    page.appendChild(el('div.card', null, [
      el('div.card-head', null, [el('h3', { html: ui.icon('bank') + ' What We Owe — ' + coName(cid) }),
        el('span.card-sub', { text: 'click a row for the schedule & history' })]),
      el('div.card-body', null, [tbl.el])
    ]));
  }

  function takenDetail(b) {
    var body = el('div');
    var m = ui.modal({ title: b.lender + ' · ' + b.kind, icon: 'bank', size: 'xl', body: body, footer: false });
    function repaint() { body.innerHTML = ''; render(); }
    function render() {
      b = taken().filter(function (x) { return x.id === b.id; })[0] || b;
      var acts = el('div.flex.gap-1.flex-wrap', { style: { marginLeft: 'auto' } });
      if (can(b.companyId)) {
        if (b.status === 'Active') {
          acts.appendChild(el('button.btn.btn-sm.btn-primary', { html: ui.icon('cash-coin') + ' Record Payment', onclick: function () { m.close(); payTakenForm(b); } }));
          acts.appendChild(el('button.btn.btn-sm.btn-outline', { html: ui.icon('pencil') + ' Edit', onclick: function () { m.close(); takenForm(b, b.companyId); } }));
        }
        acts.appendChild(el('button.btn.btn-sm.btn-outline', { html: ui.icon('printer') + ' Statement', onclick: function () { printTakenStatement(b); } }));
      }
      var n = nextDueOf(b), od = overdueOf(b), pct = progressOf(b);
      var statusHtml = b.status === 'Active' && od > 0 ? '<span class="badge badge-warn">Behind</span>'
        : '<span class="badge badge-' + ({ Active: 'good', Closed: 'info' }[b.status] || '') + '">' + esc(b.status) + '</span>';
      body.appendChild(el('div.card.mb-2', null, [el('div.card-body', null, [
        el('div.flex.items-center.gap-2.flex-wrap.mb-3', null, [
          el('div.flex-1', null, [el('div.fw-700', { text: b.lender + ' · ' + b.kind }),
            el('div.text-mute.sm', { text: (b.acctNo ? b.acctNo + ' · ' : '') + coName(b.companyId) })]),
          ui.frag(statusHtml), acts]),
        el('div.stat-row.mb-3', null, [
          st('Total loan', ui.money(b.principal)),
          st('Paid so far', ui.money(paidOf(b)), 'text-good'),
          st('Still due', ui.money(outstandingOf(b)), od ? 'text-bad' : null),
          st('Next date', n ? ui.date(n.due) : '—'),
          st('Remaining', (100 - pct) + '%')
        ]),
        el('div.mb-3', null, [ui.frag(progressBar(pct, 'good'))]),
        factCols([
          ['Loan terms', [
            ['Interest rate', (+b.rate || 0) + '% per year'],
            ['Method', b.method === 'reducing' ? 'Reducing balance' : 'Flat'],
            ['Tenure', b.tenureMonths + ' months'],
            ['Monthly EMI', ui.money(b.emi)],
            ['Total repayable', ui.money(dueTotalOf(b))],
            ['Interest cost', ui.money(Math.max(0, dueTotalOf(b) - (+b.principal || 0)))]
          ]],
          ['Schedule & security', [
            ['Loan / account no', b.acctNo || '—'],
            ['Taken on', ui.date(b.startDate)],
            ['First installment', ui.date(addMonths(b.startDate, 1))],
            ['Final installment', ui.date(addMonths(b.startDate, b.tenureMonths))],
            ['Installments left', String((b.schedule || []).filter(function (r) { return (+r.paid || 0) < (+r.total || 0); }).length)],
            ['Security', b.security || '—']
          ]]
        ]),
        (b.purpose || od || b.notes) ? el('div.data-list.mt-2', null, [
          b.purpose ? row2('Purpose', b.purpose) : null,
          od ? row2('Behind by', ui.money(od) + ' · ' + daysPastDue(b) + ' days late') : null,
          b.notes ? row2('Notes', b.notes) : null
        ].filter(Boolean)) : null
      ].filter(Boolean))]));
      body.appendChild(scheduleCard(b, 'Payment Schedule', 'installments paid'));
      body.appendChild(historyCard(b.id, 'taken'));
    }
    render();
  }

  function takenForm(b, cid) {
    var isNew = !b;
    EPAL.formModal({
      title: isNew ? 'Add a Loan We Took' : 'Edit · ' + b.lender, icon: 'bank', size: 'lg',
      record: b || { companyId: cid === 'all' ? 'group' : cid, kind: 'Bank Loan', method: 'reducing', rate: 11, tenureMonths: 36, startDate: today() },
      fields: [
        { type: 'section', label: 'Who we borrowed from' },
        { key: 'lender', label: 'Lender', type: 'text', required: true, col2: true, placeholder: 'e.g. City Bank PLC · IDLC Finance' },
        { key: 'kind', label: 'Loan type', type: 'select', required: true,
          options: ['Bank Loan', 'Car Loan', 'Equipment Loan', 'Office / Property', 'Working Capital', 'Personal', 'Other'], default: 'Bank Loan' },
        { key: 'acctNo', label: 'Loan / account no', type: 'text' },
        { key: 'companyId', label: 'Borrowing company', type: 'select', required: true, options: [['group', 'Group HQ']].concat(comps().map(function (c) { return [c.id, c.short]; })) },
        { type: 'section', label: 'Terms' },
        { key: 'principal', label: 'Total loan (৳)', type: 'money', required: true, min: 1 },
        { key: 'rate', label: 'Interest rate (% per year)', type: 'number', min: 0, max: 100, default: 11 },
        { key: 'method', label: 'Interest method', type: 'select', options: [['reducing', 'Reducing balance'], ['flat', 'Flat']], default: 'reducing' },
        { key: 'tenureMonths', label: 'Tenure (months)', type: 'number', required: true, min: 1, max: 240, default: 36 },
        { key: 'startDate', label: 'Loan taken on', type: 'date', required: true, hint: 'The first installment falls one month after this date.' },
        { type: 'section', label: 'Details' },
        { key: 'purpose', label: 'What it is for', type: 'text', col2: true, placeholder: 'e.g. Toyota Premio — MD pool car' },
        { key: 'security', label: 'Security given', type: 'text', placeholder: 'e.g. vehicle hypothecation' },
        { key: 'notes', label: 'Notes', type: 'textarea', col2: true }
      ],
      saveLabel: isNew ? 'Add Loan' : 'Save',
      onSave: function (v) {
        var P = +v.principal || 0, n = +v.tenureMonths || 0;
        if (P <= 0 || n <= 0) { ui.toast('Enter the loan amount and tenure', 'error'); return false; }
        var rec = b || { id: 'BR-' + ui.uid('').slice(-5).toUpperCase(), created: Date.now(), status: 'Active' };
        ['lender', 'kind', 'acctNo', 'companyId', 'method', 'startDate', 'purpose', 'security', 'notes'].forEach(function (k) { rec[k] = v[k]; });
        rec.principal = P; rec.rate = +v.rate || 0; rec.tenureMonths = n;
        rec.emi = Math.round(emiOf(P, rec.rate, n, rec.method));
        var oldPaid = (b && b.schedule) ? b.schedule.map(function (r) { return { paid: r.paid, paidDate: r.paidDate }; }) : [];
        rec.schedule = buildSchedule(rec).map(function (r, i) {
          if (oldPaid[i]) { r.paid = oldPaid[i].paid || 0; r.paidDate = oldPaid[i].paidDate || ''; }
          return r;
        });
        if (outstandingOf(rec) <= 0.5) rec.status = 'Closed';
        S.upsert('loans_taken', rec);
        ui.toast(isNew ? ('Added · EMI ' + ui.money(rec.emi) + ' for ' + n + ' months') : 'Loan updated', 'success');
        EPAL.router.render(); return true;
      }
    });
  }

  function payTakenForm(b) {
    var banks = db().col('banks').filter(function (x) { return (x.status || 'Active') !== 'Inactive'; });
    var n = nextDueOf(b), owed = outstandingOf(b);
    EPAL.formModal({
      title: 'Record Payment · ' + b.lender, icon: 'cash-coin', size: 'md',
      record: { amount: n ? n.amount : owed, date: today(), bankId: banks[0] && banks[0].id },
      fields: [
        { key: 'amount', label: 'Amount paid (৳)', type: 'money', required: true, min: 1,
          hint: 'Next installment ' + (n ? ui.money(n.amount) + ' due ' + ui.date(n.due) : '—') + ' · total still owed ' + ui.money(owed) + '. Applied to the OLDEST unpaid installment first; part-payments are allowed.' },
        { key: 'date', label: 'Paid on', type: 'date', required: true },
        { key: 'bankId', label: 'Paid from (for the record)', type: 'select', options: banks.map(function (x) { return [x.id, x.name]; }),
          hint: 'Noted on the payment only — the loan book does not move the main accounts.' },
        { key: 'memo', label: 'Note', type: 'text', col2: true, placeholder: 'e.g. auto-debit / cheque no' }
      ],
      saveLabel: 'Record Payment',
      onSave: function (v) {
        var amt = Math.min(+v.amount || 0, owed);
        if (amt <= 0) { ui.toast('Enter the amount paid', 'error'); return false; }
        var bank = db().col('banks').filter(function (x) { return x.id === v.bankId; })[0];
        var sp = applyToSchedule(b, amt, v.date);
        S.upsert('loan_txns', { id: 'TT-' + ui.uid('').slice(-6).toUpperCase(), book: 'taken', loanId: b.id, companyId: b.companyId, type: 'repayment',
          date: v.date, amount: amt, principal: sp.principal, interest: sp.interest,
          memo: v.memo || 'Installment paid', from: bank ? bank.name : '', by: whoAmI() });
        if (outstandingOf(b) <= 0.5) b.status = 'Closed';
        S.upsert('loans_taken', b);
        ui.toast('Paid ' + ui.money(amt) + ' (principal ' + ui.money(sp.principal) + ' · interest ' + ui.money(sp.interest) + ')' + (b.status === 'Closed' ? ' — loan CLEARED' : ''), 'success');
        EPAL.router.render(); return true;
      }
    });
  }

  function printTakenStatement(b) {
    var rows = (b.schedule || []).map(function (r) {
      var paid = +r.paid || 0;
      return '<tr><td>' + r.no + '</td><td>' + ui.date(r.due) + '</td><td class="num">' + ui.money(r.principal) + '</td><td class="num">' + ui.money(r.interest) +
        '</td><td class="num">' + ui.money(r.total) + '</td><td class="num">' + (paid ? ui.money(paid) : '—') + '</td><td>' + (paid >= r.total ? ui.date(r.paidDate) : (r.due < today() ? 'OVERDUE' : 'pending')) + '</td></tr>';
    }).join('');
    ui.printDoc({
      title: 'Loan Statement · ' + b.kind, subtitle: coName(b.companyId) + ' — ' + b.lender,
      meta: 'Loan ' + ui.money(b.principal) + ' · ' + (+b.rate || 0) + '% ' + (b.method === 'reducing' ? 'reducing' : 'flat') + ' · ' + b.tenureMonths + ' months · EMI ' + ui.money(b.emi) +
        ' · Paid ' + ui.money(paidOf(b)) + ' · Still due ' + ui.money(outstandingOf(b)) + ' (' + (100 - progressOf(b)) + '% remaining)',
      footer: 'Accounts Department · Confidential · generated ' + ui.date(today()),
      bodyHtml: '<table><tr><td><b>Lender</b></td><td>' + esc(b.lender) + ' (' + esc(b.kind) + ')</td></tr>' +
        '<tr><td><b>Loan / account no</b></td><td>' + esc(b.acctNo || '—') + '</td></tr>' +
        '<tr><td><b>Purpose</b></td><td>' + esc(b.purpose || '—') + '</td></tr>' +
        '<tr><td><b>Security</b></td><td>' + esc(b.security || '—') + '</td></tr>' +
        '<tr><td><b>Taken on</b></td><td>' + ui.date(b.startDate) + '</td></tr></table>' +
        '<h3>Payment Schedule</h3><table><thead><tr><th>#</th><th>Due</th><th class="num">Principal</th><th class="num">Interest</th><th class="num">Installment</th><th class="num">Paid</th><th>Status</th></tr></thead><tbody>' +
        rows + '</tbody></table>'
    });
  }

  /* ---- staff-loan drill-down: THE LOAN ONLY ----------------------------
   * Owner 2026-07-15: "clicking employee name will show only loan related
   * info, with all features upmost." Deliberately NOT the employee profile —
   * no payslips, no attendance, no other accounts. Everything here is read
   * from payroll (it owns the staff book); the actions link back to it. */
  function staffLoanDetail(emp) {
    var body = el('div');
    ui.modal({ title: emp.name + ' · Staff Loan', icon: 'person-badge', size: 'xl', body: body, footer: false });
    var tx = staffTxns(emp.id);
    var given = tx.filter(function (x) { return x.type === 'loan'; });
    var back = tx.filter(function (x) { return x.type === 'loan-repay'; });
    var disbursed = given.reduce(function (a, x) { return a + (+x.amount || 0); }, 0);
    var repaid = back.reduce(function (a, x) { return a + (+x.amount || 0); }, 0);
    var out = staffOut(emp.id), emi = staffEmi(emp.id);
    var pct = disbursed ? Math.min(100, Math.round((disbursed - out) / disbursed * 100)) : 0;
    // How long until it is clear, at the EMI payroll is actually deducting.
    var monthsLeft = emi > 0 ? Math.ceil(out / emi) : 0;
    var clearBy = monthsLeft ? ui.date(addMonths(today(), monthsLeft)) : (out > 0 ? 'No EMI plan set' : '—');
    var plan = given.filter(function (x) { return (+x.emiMonths || 0) > 0; });

    var acts = el('div.flex.gap-1.flex-wrap', { style: { marginLeft: 'auto' } });
    acts.appendChild(el('button.btn.btn-sm.btn-outline', { html: ui.icon('printer') + ' Statement', onclick: function () { printStaffStatement(emp); } }));
    acts.appendChild(el('a.btn.btn-sm.btn-primary', { href: '#/group/master-accounts/payroll', html: ui.icon('person-badge') + ' Manage in Payroll' }));

    body.appendChild(el('div.card.mb-2', null, [el('div.card-body', null, [
      el('div.flex.items-center.gap-2.flex-wrap.mb-3', null, [
        el('div.flex-1', null, [el('div.fw-700', { text: emp.name }),
          el('div.text-mute.sm', { text: [emp.designation, emp.dept, coName(emp.companyId || 'travels')].filter(Boolean).join(' · ') })]),
        ui.frag(out > 0 ? '<span class="badge badge-warn">Loan running</span>' : '<span class="badge badge-good">Cleared</span>'), acts]),
      el('div.stat-row.mb-3', null, [
        st('Total taken', ui.money(disbursed)),
        st('Recovered', ui.money(repaid), 'text-good'),
        st('Outstanding', ui.money(out), out ? 'text-warn' : null),
        st('Monthly EMI', emi ? ui.money(emi) : '—'),
        st('Clears by', clearBy)
      ]),
      el('div.mb-3', null, [ui.frag(progressBar(pct, 'good'))]),
      factCols([
        ['The loan', [
          ['Loans taken', String(given.length)],
          ['First taken on', given.length ? ui.date(given[given.length - 1].date) : '—'],
          ['Last taken on', given.length ? ui.date(given[0].date) : '—'],
          ['EMI plan', plan.length ? plan.map(function (x) { return x.emiMonths + ' months'; }).join(' · ') : 'None — recovered when set'],
          ['Installments left', monthsLeft ? String(monthsLeft) : '—']
        ]],
        ['How it is recovered', [
          ['Method', 'Payslip EMI — automatic'],
          ['Deducted', emi ? ui.money(emi) + ' every payroll run' : 'Nothing scheduled'],
          ['Recoveries so far', String(back.length)],
          ['Last recovery', back.length ? ui.date(back[0].date) + ' · ' + ui.money(back[0].amount) : '—'],
          ['On the books', 'Yes — GL 1260 (payroll owns it)']
        ]]
      ])
    ])]));

    var gt = EPAL.table({
      columns: [
        { key: 'date', label: 'Taken on', date: true },
        { key: 'amount', label: 'Amount', num: true, money: true },
        { key: 'emiMonths', label: 'EMI plan', render: function (x) { return (+x.emiMonths || 0) ? x.emiMonths + ' months' : '<span class="text-mute">—</span>'; } },
        { key: 'perMonth', label: 'Per month', num: true, sortVal: function (x) { return (+x.emiMonths || 0) ? x.amount / x.emiMonths : 0; },
          render: function (x) { return (+x.emiMonths || 0) ? '<span class="num">' + ui.money(Math.round(x.amount / x.emiMonths)) + '</span>' : '<span class="text-mute">—</span>'; },
          exportVal: function (x) { return (+x.emiMonths || 0) ? Math.round(x.amount / x.emiMonths) : ''; } },
        { key: 'method', label: 'Paid via', render: function (x) { return esc(x.method || '—'); } },
        { key: 'memo', label: 'Note', render: function (x) { return esc(x.memo || '—'); } }
      ],
      rows: given, pageSize: 6, totalKey: 'amount', exportName: 'staff-loan-' + emp.id + '.csv',
      empty: { icon: 'cash-stack', title: 'No loan disbursed' }
    });
    body.appendChild(el('div.card.mb-2', null, [
      el('div.card-head', null, [el('h3', { html: ui.icon('cash-stack') + ' Loans Given' }),
        el('span.card-sub', { text: 'disbursed from Payroll ▸ Loan Management' })]),
      el('div.card-body', null, [gt.el])
    ]));

    var rt = EPAL.table({
      columns: [
        { key: 'date', label: 'Deducted on', date: true },
        { key: 'memo', label: 'From which salary', render: function (x) { return esc(String(x.memo || '').replace('EMI auto-deducted from ', '')) || '—'; } },
        { key: 'amount', label: 'Recovered', num: true, money: true }
      ],
      rows: back, pageSize: 8, totalKey: 'amount', dateKey: 'date', exportName: 'staff-loan-recovery-' + emp.id + '.csv',
      empty: { icon: 'calendar2-check', title: 'Nothing recovered yet', hint: 'The EMI comes off the next payslip.' }
    });
    body.appendChild(el('div.card', null, [
      el('div.card-head', null, [el('h3', { html: ui.icon('calendar2-check') + ' Recovery History' }),
        el('span.card-sub', { text: 'every EMI, and the salary it came off' })]),
      el('div.card-body', null, [rt.el])
    ]));
  }
  function printStaffStatement(emp) {
    var tx = staffTxns(emp.id);
    var out = staffOut(emp.id), emi = staffEmi(emp.id);
    var rows = tx.map(function (x) {
      return '<tr><td>' + ui.date(x.date) + '</td><td>' + (x.type === 'loan' ? 'Loan given' : 'EMI recovered') + '</td><td>' + esc(x.memo || '') +
        '</td><td class="num">' + (x.type === 'loan' ? ui.money(x.amount) : '—') + '</td><td class="num">' + (x.type === 'loan-repay' ? ui.money(x.amount) : '—') + '</td></tr>';
    }).join('');
    ui.printDoc({
      title: 'Staff Loan Statement', subtitle: coName(emp.companyId || 'travels') + ' — ' + emp.name,
      meta: 'Outstanding ' + ui.money(out) + ' · Monthly EMI ' + (emi ? ui.money(emi) : 'not set') + ' · recovered automatically from salary (GL 1260)',
      footer: 'Accounts Department · Confidential · generated ' + ui.date(today()),
      bodyHtml: '<table><tr><td><b>Employee</b></td><td>' + esc(emp.name) + (emp.dept ? ' · ' + esc(emp.dept) : '') + '</td></tr>' +
        '<tr><td><b>Outstanding</b></td><td>' + ui.money(out) + '</td></tr></table>' +
        '<h3>Loan History</h3><table><thead><tr><th>Date</th><th>Type</th><th>Detail</th><th class="num">Given</th><th class="num">Recovered</th></tr></thead><tbody>' +
        rows + '</tbody></table>'
    });
  }

  /* ------------------------------------------------------- LOAN SETUP */
  function setupView(page, cid) {
    var prods = S.list('loan_products');
    page.appendChild(el('div.kpi-grid.kpi-compact.stagger', null, [
      kpi('Loan Products', String(prods.length), 'sliders'),
      kpi('Interest-free', String(prods.filter(function (p) { return !+p.rate; }).length), 'gift'),
      kpi('Avg Rate', prods.length ? (prods.reduce(function (a, p) { return a + (+p.rate || 0); }, 0) / prods.length).toFixed(1) + '%' : '—', 'percent')
    ]));
    if (can(cid)) page.appendChild(el('div.mb-2', null, [el('button.btn.btn-sm.btn-primary', { html: ui.icon('plus-lg') + ' Add Loan Product', onclick: function () { productForm(null); } })]));
    var tbl = EPAL.table({
      columns: [
        { key: 'name', label: 'Product', render: function (p) { return '<span class="strong">' + esc(p.name) + '</span>' + (p.notes ? '<div class="text-mute xs">' + esc(p.notes) + '</div>' : ''); } },
        { key: 'rate', label: 'Rate', num: true, render: function (p) { return (+p.rate || 0) + '%'; } },
        { key: 'method', label: 'Method', render: function (p) { return '<span class="badge badge-info">' + esc(p.method === 'reducing' ? 'Reducing' : 'Flat') + '</span>'; }, exportVal: function (p) { return p.method; } },
        { key: 'tenure', label: 'Default Tenure', num: true, render: function (p) { return (+p.tenure || 0) + ' months'; } },
        { key: 'penalty', label: 'Late Penalty', num: true, render: function (p) { return (+p.penalty || 0) + '%'; } },
        { key: 'used', label: 'Loans', num: true, render: function (p) { return String(loans().filter(function (l) { return l.productId === p.id; }).length); },
          sortVal: function (p) { return loans().filter(function (l) { return l.productId === p.id; }).length; } }
      ],
      rows: prods, pageSize: 10, exportName: 'loan-products.csv',
      actions: can(cid) ? ui.actions({
        edit: function (p) { productForm(p); },
        del: function (p) {
          if (loans().some(function (l) { return l.productId === p.id; })) { ui.toast('In use by a loan — edit it instead of deleting', 'error'); return; }
          ui.confirm({ title: 'Delete "' + p.name + '"?', danger: true, confirmLabel: 'Delete' }).then(function (ok) { if (ok) { S.removeFrom('loan_products', p.id); ui.toast('Deleted', 'success'); EPAL.router.render(); } });
        }
      }) : [],
      empty: { icon: 'sliders', title: 'No loan products' }
    });
    page.appendChild(el('div.card.mb-2', null, [
      el('div.card-head', null, [el('h3', { html: ui.icon('sliders') + ' Loan Products' }), el('span.card-sub', { text: 'default terms offered when a new loan is created' })]),
      el('div.card-body', null, [tbl.el])
    ]));
    // Where each book lives — so an accountant can see the rule without
    // reading code, and nobody assumes a loan is on the trial balance.
    page.appendChild(el('div.card', null, [
      el('div.card-head', null, [el('h3', { html: ui.icon('diagram-2') + ' Where the loan money is kept' }),
        el('span.card-sub', { text: 'loan books are handled separately from the main accounts' })]),
      el('div.card-body', null, [el('div.data-list', null, [
        gl('External loans — we lend out', 'Tracked in this desk only', 'no journal, no bank movement: a service taken on instalments is already a receivable from the sale, so booking it again would count the same money twice'),
        gl('Loans we took — bank, car, equipment', 'Tracked in this desk only', 'total, paid, due, next date and how much is left — kept off the main accounts'),
        gl('Employee loans — the exception', 'DR 1260 Staff Loans Receivable · EMI recovery credits 1260 on the payslip', 'the one loan book that IS on the main accounts, because payroll pays and recovers real money'),
        gl('If this ever changes', 'One posting service over these same tables', 'the loan records already carry every date, split and party a journal would need')
      ])])
    ]));
    function gl(k, v, note) {
      return el('div.data-row', null, [el('div.flex-1', null, [el('div.fw-600.sm', { text: k }), el('div.text-mute.xs', { text: note })]),
        el('div.mono.xs', { style: { textAlign: 'right' }, text: v })]);
    }
  }
  function productForm(p) {
    EPAL.formModal({
      title: p ? 'Edit Loan Product' : 'Add Loan Product', icon: 'sliders', size: 'md',
      record: p || { rate: 12, method: 'reducing', tenure: 12, penalty: 2 },
      fields: [
        { key: 'name', label: 'Product name', type: 'text', required: true, col2: true, placeholder: 'e.g. Business Loan (Partner/Agent)' },
        { key: 'rate', label: 'Default rate (% per year)', type: 'number', min: 0, max: 100, required: true },
        { key: 'method', label: 'Interest method', type: 'select', options: [['reducing', 'Reducing balance'], ['flat', 'Flat']], default: 'reducing' },
        { key: 'tenure', label: 'Default tenure (months)', type: 'number', min: 1, max: 120, required: true },
        { key: 'penalty', label: 'Late penalty (% per month)', type: 'number', min: 0, max: 50 },
        { key: 'notes', label: 'Policy note', type: 'textarea', col2: true, placeholder: 'e.g. guarantor required · cheque security' }
      ],
      saveLabel: p ? 'Save' : 'Add',
      onSave: function (v) {
        var r = p || { id: 'LP-' + ui.uid('').slice(-5).toUpperCase() };
        ['name', 'method', 'notes'].forEach(function (k) { r[k] = v[k]; });
        r.rate = +v.rate || 0; r.tenure = +v.tenure || 12; r.penalty = +v.penalty || 0;
        S.upsert('loan_products', r);
        ui.toast('Loan product saved', 'success'); EPAL.router.render(); return true;
      }
    });
  }

  /* ----------------------------------------------------------- REPORTS */
  function reportsView(page, cid) {
    var list = loansIn(cid).filter(function (l) { return l.status !== 'Written-off'; });
    var emp = empBook(cid);
    var extOut = list.reduce(function (a, l) { return a + outstandingOf(l); }, 0);
    var empOut = emp.reduce(function (a, x) { return a + x.out; }, 0);
    // aging buckets on the overdue money — the collection officer's worklist
    var buckets = [['Current', 0, 0], ['1–30 days', 0, 0], ['31–60 days', 0, 0], ['61–90 days', 0, 0], ['90+ days', 0, 0]];
    list.forEach(function (l) {
      var od = overdueOf(l), d = daysPastDue(l);
      if (od <= 0) { buckets[0][1] += outstandingOf(l); buckets[0][2]++; return; }
      var i = d <= 30 ? 1 : d <= 60 ? 2 : d <= 90 ? 3 : 4;
      buckets[i][1] += od; buckets[i][2]++;
    });
    var interest = txnsOf('ext', cid).filter(function (t) { return t.type === 'collection'; })
      .reduce(function (a, t) { return a + (+t.interest || 0); }, 0);
    var interestPaid = txnsOf('taken', cid).filter(function (t) { return t.type === 'repayment'; })
      .reduce(function (a, t) { return a + (+t.interest || 0); }, 0);
    // Written off comes from the loan book's own trail, not GL 5700 — write-offs
    // are recorded here and never posted (see the file header).
    var written = txnsOf('ext', cid).filter(function (t) { return t.type === 'write-off'; })
      .reduce(function (a, t) { return a + (+t.amount || 0); }, 0);
    var tknOwe = takenIn(cid).filter(function (b) { return b.status !== 'Closed'; })
      .reduce(function (a, b) { return a + outstandingOf(b); }, 0);
    page.appendChild(el('div.kpi-grid.kpi-compact.stagger', null, [
      kpi('Owed To Us', ui.money(extOut + empOut, { compact: true }), 'safe2'),
      kpi('We Owe', ui.money(tknOwe, { compact: true }), 'bank', tknOwe ? 'text-warn' : null),
      kpi('At Risk (overdue)', ui.money(buckets.slice(1).reduce(function (a, b) { return a + b[1]; }, 0), { compact: true }), 'exclamation-octagon', 'text-bad'),
      kpi('Interest Earned', ui.money(interest, { compact: true }), 'graph-up-arrow', 'text-good'),
      kpi('Interest Paid', ui.money(interestPaid, { compact: true }), 'graph-down-arrow'),
      kpi('Written Off', ui.money(written, { compact: true }), 'x-octagon', written ? 'text-bad' : null)
    ]));
    // aging
    var at = EPAL.table({
      columns: [
        { key: 'b', label: 'Age bucket', render: function (r) { return '<span class="strong">' + esc(r.b) + '</span>'; } },
        { key: 'n', label: 'Loans', num: true },
        { key: 'amt', label: 'Amount', num: true, money: true },
        { key: 'share', label: 'Share', render: function (r) {
          var tot = buckets.reduce(function (a, b) { return a + b[1]; }, 0);
          var pct = tot ? Math.round(r.amt / tot * 100) : 0;
          return '<div style="height:6px;background:var(--surface-3);border-radius:4px;overflow:hidden;min-width:80px"><div style="height:100%;width:' + Math.max(2, pct) + '%;background:var(--accent)"></div></div><span class="text-mute xs">' + pct + '%</span>'; },
          exportVal: function (r) { var tot = buckets.reduce(function (a, b) { return a + b[1]; }, 0); return tot ? Math.round(r.amt / tot * 100) + '%' : '0%'; } }
      ],
      rows: buckets.map(function (b) { return { b: b[0], amt: Math.round(b[1]), n: b[2] }; }),
      pageSize: 6, totalKey: 'amt', exportName: 'loan-aging.csv', pdfTitle: 'Loan Aging — ' + coName(cid),
      empty: { icon: 'hourglass', title: 'No loans' }
    });
    page.appendChild(el('div.card.mb-2', null, [
      el('div.card-head', null, [el('h3', { html: ui.icon('hourglass-split') + ' Aging — external book' }), el('span.card-sub', { text: 'overdue money by how late it is' })]),
      el('div.card-body', null, [at.el])
    ]));
    // by company + by product
    var two = el('div.two-col');
    function group(title, icon, keyFn, labelFn) {
      var m = {};
      list.forEach(function (l) { var k = keyFn(l); m[k] = m[k] || { n: 0, out: 0 }; m[k].n++; m[k].out += outstandingOf(l); });
      var rows = Object.keys(m).map(function (k) { return { k: labelFn(k), n: m[k].n, out: Math.round(m[k].out) }; }).sort(function (a, b) { return b.out - a.out; });
      var t = EPAL.table({
        columns: [{ key: 'k', label: title, render: function (r) { return '<span class="strong">' + esc(r.k) + '</span>'; } },
          { key: 'n', label: 'Loans', num: true }, { key: 'out', label: 'Outstanding', num: true, money: true }],
        rows: rows, pageSize: 8, totalKey: 'out', exportName: 'loans-by-' + title.toLowerCase().replace(/\W+/g, '-') + '.csv',
        empty: { icon: 'inbox', title: 'Nothing here' }
      });
      return el('div.card', null, [el('div.card-head', null, [el('h3', { html: ui.icon(icon) + ' By ' + title })]), el('div.card-body', null, [t.el])]);
    }
    two.appendChild(group('Company', 'diagram-3', function (l) { return l.companyId || 'group'; }, coName));
    two.appendChild(group('Product', 'sliders', function (l) { return l.productId || '—'; }, function (k) {
      var p = S.list('loan_products').filter(function (x) { return x.id === k; })[0]; return p ? p.name : 'Ad-hoc';
    }));
    page.appendChild(two);
    // what we owe, by lender — the other side of the portfolio
    var tkList = takenIn(cid).filter(function (b) { return b.status !== 'Closed'; });
    var tt = EPAL.table({
      columns: [
        { key: 'lender', label: 'Lender', render: function (b) { return '<span class="strong">' + esc(b.lender) + '</span><div class="text-mute xs">' + esc(b.kind) + '</div>'; } },
        { key: 'companyId', label: 'Company', render: function (b) { return '<span class="badge">' + esc(coName(b.companyId)) + '</span>'; }, exportVal: function (b) { return b.companyId; } },
        { key: 'principal', label: 'Borrowed', num: true, money: true },
        { key: 'due', label: 'Still owed', num: true, sortVal: outstandingOf, exportVal: outstandingOf,
          render: function (b) { return '<span class="num strong">' + ui.money(outstandingOf(b)) + '</span>'; } },
        { key: 'emi', label: 'Monthly EMI', num: true, money: true },
        { key: 'next', label: 'Next date', sortVal: function (b) { var n = nextDueOf(b); return n ? n.due : '9999'; },
          exportVal: function (b) { var n = nextDueOf(b); return n ? n.due : ''; },
          render: function (b) { var n = nextDueOf(b); return n ? ui.date(n.due) : '<span class="text-mute">—</span>'; } },
        { key: 'progress', label: 'Remaining', sortVal: progressOf, exportVal: function (b) { return (100 - progressOf(b)) + '%'; },
          render: function (b) { return progressBar(progressOf(b), 'good'); } }
      ],
      rows: tkList, pageSize: 8, totalKey: 'principal', exportName: 'borrowings.csv', pdfTitle: 'Loans We Took — ' + coName(cid),
      onRow: function (b) { takenDetail(b); },
      empty: { icon: 'bank', title: 'We owe nothing' }
    });
    page.appendChild(el('div.card.mt-2', null, [
      el('div.card-head', null, [el('h3', { html: ui.icon('bank') + ' What We Owe' }),
        el('span.card-sub', { text: 'bank loans, car EMIs & equipment — by lender' })]),
      el('div.card-body', null, [tt.el])
    ]));
    // collection history
    var hx = txnsOf('ext', cid).filter(function (t) { return t.type === 'collection'; }).slice(0, 60);
    var ht = EPAL.table({
      columns: [
        { key: 'date', label: 'Date', date: true },
        { key: 'loanId', label: 'Loan', render: function (t) {
          var l = loans().filter(function (x) { return x.id === t.loanId; })[0];
          return '<span class="strong">' + esc(l ? l.borrower : t.loanId) + '</span><div class="text-mute xs mono">' + esc(t.loanId) + '</div>'; },
          exportVal: function (t) { return t.loanId; } },
        { key: 'principal', label: 'Principal', num: true, money: true },
        { key: 'interest', label: 'Interest', num: true, money: true },
        { key: 'amount', label: 'Collected', num: true, money: true }
      ],
      rows: hx, pageSize: 10, totalKey: 'amount', dateKey: 'date', exportName: 'loan-collections.csv', pdfTitle: 'Loan Collections — ' + coName(cid),
      empty: { icon: 'cash-coin', title: 'No collections yet' }
    });
    page.appendChild(el('div.card.mt-2', null, [
      el('div.card-head', null, [el('h3', { html: ui.icon('cash-coin') + ' Collection History' }), el('span.card-sub', { text: 'principal / interest split per receipt' })]),
      el('div.card-body', null, [ht.el])
    ]));
  }
})(window.EPAL = window.EPAL || {});
