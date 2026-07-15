/* ============================================================================
 * EPAL KIT · MANAGE LOAN  (external loan book + the staff-loan mirror)
 * ----------------------------------------------------------------------------
 * TWO BOOKS, ONE DESK — the owner's brief:
 *   1. EXTERNAL LOANS (this desk's real job): money the group lends to people
 *      and businesses OUTSIDE the company — no payslip, no EMI deduction. They
 *      are an asset that must be disbursed, scheduled, collected, chased when
 *      overdue, and written off when dead.
 *   2. EMPLOYEE LOANS (mirror only): staff loans already live in Payroll ▸ Loan
 *      Management and recover automatically as payslip EMI. Nothing there moves
 *      — this desk only SHOWS that book beside the external one so the owner
 *      sees one loan portfolio, and links back to payroll for every action.
 *
 * LEDGER (the two books never mix):
 *   1270 Loans Receivable (External)   ← this desk         [asset]
 *   1260 Staff Loans Receivable        ← payroll engine    [asset]
 *   4060 Interest Income               ← interest portion of every collection
 *   5700 Bad Debt Written Off          ← write-offs
 *   Disburse : DR 1270 / CR bank(1010)          + bank register withdrawal
 *   Collect  : DR bank(1010) / CR 1270 + CR 4060 (principal / interest split)
 *   Write-off: DR 5700 / CR 1270 (outstanding principal)
 *   Seeded (historical) loans are brought onto the books at their OUTSTANDING
 *   balance: DR 1270 / CR 3100 — an opening, so no cash is invented.
 *
 * STORES: loan_products (setup) · loans_ext (loan + embedded schedule) ·
 *         loan_txns (disbursement / collection / write-off audit trail)
 *
 * EXPOSES: EPAL.loanDesk(page, companyId, { rightEl }) — the whole section.
 *
 * ==> LARAVEL HANDOFF: loans_ext = loans table + loan_schedules (rows), loan_txns
 *     = loan_transactions; every posting here maps 1:1 to a JournalEntry with
 *     JournalItems, exactly like TicketSale → journal in the production app.
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
  function daysPastDue(l) {
    var t = today(), first = null;
    (l.schedule || []).forEach(function (r) { if (!first && (+r.paid || 0) < (+r.total || 0) && r.due < t) first = r; });
    if (!first) return 0;
    return Math.round((new Date(t + 'T00:00:00') - new Date(first.due + 'T00:00:00')) / 86400000);
  }
  function loans() { return S.list('loans_ext'); }
  function loansIn(cid) { return loans().filter(function (l) { return cid === 'all' ? true : (l.companyId || 'group') === cid; }); }

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
          txns.push({ id: 'LT-' + l.id + '-' + (k + 1), loanId: l.id, companyId: l.companyId, type: 'collection',
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
    /* Bring the seeded book onto the LEDGER at its OUTSTANDING principal —
     * an opening (DR 1270 / CR 3100), never inventing cash. Guarded + stable
     * ids, exactly like the bank-opening migration. */
    if (L() && !S.get('loans_gl_open_v1', null)) {
      try {
        var have = {}; (L().entries({}) || []).forEach(function (e) { have[e.id] = 1; });
        var n = 0, amt = 0;
        loans().forEach(function (l) {
          var gid = 'GL-LNOPEN-' + l.id, owed = principalOutstandingOf(l);
          if (have[gid] || owed <= 0) return;
          try {
            L().post({ id: gid, date: l.disbursedDate || l.startDate, companyId: l.companyId || 'group', ref: 'OPENING',
              memo: 'Loan opening balance · ' + l.borrower, source: 'opening', party: l.borrower, override: true,
              lines: [{ account: '1270', dr: owed, cr: 0 }, { account: '3100', dr: 0, cr: owed }] });
            n++; amt += owed;
          } catch (x) {}
        });
        S.set('loans_gl_open_v1', { loans: n, amount: amt });
      } catch (x) {}
    }
  } });

  /* ==========================================================================
   * THE DESK
   * ========================================================================*/
  var TABS = [['overview', 'Overview'], ['external', 'External Loans'], ['employee', 'Employee Loans'], ['setup', 'Loan Setup'], ['reports', 'Reports']];
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
      ({ overview: overviewView, external: externalView, employee: employeeView, setup: setupView, reports: reportsView }[tab] || overviewView)(body, cid);
      host.appendChild(body);
    }
    draw();
    page.appendChild(host);
  };

  /* ---------------------------------------------------------- OVERVIEW */
  function empBook(cid) {
    // read-only mirror of the payroll staff-loan book
    var out = [], PR = EPAL.payroll;
    if (!PR || !PR.loanOutstanding) return out;
    var cos = cid === 'all' ? comps().map(function (c) { return c.id; }) : [cid];
    cos.forEach(function (c) {
      (db().employees ? db().employees({ companyId: c }) : []).forEach(function (e) {
        var o = PR.loanOutstanding(e.id);
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
    var ymNow = today().slice(0, 7);
    var collected = S.list('loan_txns').filter(function (t) { return t.type === 'collection' && (cid === 'all' || t.companyId === cid) && String(t.date).slice(0, 7) === ymNow; })
      .reduce(function (a, t) { return a + (+t.amount || 0); }, 0);
    // interest COLLECTED per the loan book's own history. (GL 4060 only holds
    // interest booked since each loan came onto the books — historical loans
    // were opened at their outstanding balance, so pre-opening interest was
    // never ours to book. The register is the operational truth here.)
    var interestEarned = S.list('loan_txns').filter(function (t) { return t.type === 'collection' && (cid === 'all' || t.companyId === cid); })
      .reduce(function (a, t) { return a + (+t.interest || 0); }, 0);

    page.appendChild(el('div.kpi-grid.kpi-compact.stagger', null, [
      kpi('Loan Book (total)', ui.money(extOut + empOut, { compact: true }), 'safe2'),
      kpi('External Outstanding', ui.money(extOut, { compact: true }), 'people'),
      kpi('Employee Outstanding', ui.money(empOut, { compact: true }), 'person-badge'),
      kpi('Overdue', ui.money(overdue, { compact: true }), 'exclamation-octagon', overdue ? 'text-bad' : null),
      kpi('Collected · ' + ymNow, ui.money(collected, { compact: true }), 'cash-coin', 'text-good')
    ]));

    // the two books, side by side — the owner's "one portfolio" view
    var two = el('div.two-col');
    two.appendChild(el('div.card', null, [
      el('div.card-head', null, [el('h3', { html: ui.icon('people') + ' External Book' }), el('span.card-sub', { text: 'lent outside the group' })]),
      el('div.card-body', null, [
        el('div.stat-row.mb-2', null, [
          el('div.stat', null, [el('div.stat-label', { text: 'Active loans' }), el('div.stat-value', { text: String(active.length) })]),
          el('div.stat', null, [el('div.stat-label', { text: 'Outstanding' }), el('div.stat-value.num', { text: ui.money(extOut, { compact: true }) })]),
          el('div.stat', null, [el('div.stat-label', { text: 'Interest collected' }), el('div.stat-value.num.text-good', { text: ui.money(interestEarned, { compact: true }) })])
        ]),
        el('div.text-mute.xs', { text: 'Ledger: 1270 Loans Receivable (External) · interest → 4060' }),
        el('button.btn.btn-sm.btn-primary.mt-2', { html: ui.icon('list-ul') + ' Open the register', onclick: function () { tab = 'external'; EPAL.router.render(); } })
      ])
    ]));
    two.appendChild(el('div.card', null, [
      el('div.card-head', null, [el('h3', { html: ui.icon('person-badge') + ' Employee Book' }), el('span.card-sub', { text: 'recovered as payslip EMI' })]),
      el('div.card-body', null, [
        el('div.stat-row.mb-2', null, [
          el('div.stat', null, [el('div.stat-label', { text: 'Staff with loans' }), el('div.stat-value', { text: String(emp.length) })]),
          el('div.stat', null, [el('div.stat-label', { text: 'Outstanding' }), el('div.stat-value.num', { text: ui.money(empOut, { compact: true }) })]),
          el('div.stat', null, [el('div.stat-label', { text: 'Recovery' }), el('div.stat-value', { text: 'Automatic' })])
        ]),
        el('div.text-mute.xs', { text: 'Ledger: 1260 Staff Loans Receivable · EMI deducted on the payslip (Payroll owns it)' }),
        el('button.btn.btn-sm.btn-outline.mt-2', { html: ui.icon('person-badge') + ' See the staff book', onclick: function () { tab = 'employee'; EPAL.router.render(); } })
      ])
    ]));
    page.appendChild(two);

    // needs attention — the loans that actually need a phone call today
    var risk = list.filter(function (l) { return overdueOf(l) > 0 || l.status === 'Defaulted'; })
      .sort(function (a, b) { return daysPastDue(b) - daysPastDue(a); });
    var bodyR = el('div.card-body');
    if (!risk.length) bodyR.appendChild(el('div.text-mute.sm', { text: 'Nothing overdue — every installment is on time.' }));
    risk.slice(0, 6).forEach(function (l) {
      var d = daysPastDue(l);
      bodyR.appendChild(el('div.data-row', { style: { cursor: 'pointer' }, onclick: function () { loanDetail(l); } }, [
        ui.frag('<span class="notif-ico notif-' + (d > 60 ? 'error' : 'warning') + '">' + ui.icon('exclamation-triangle') + '</span>'),
        el('div.flex-1', null, [el('div.fw-600.sm', { text: l.borrower + ' · ' + coName(l.companyId) }),
          el('div.text-mute.xs', { text: (l.status === 'Defaulted' ? 'DEFAULTED · ' : '') + ui.money(overdueOf(l)) + ' overdue · ' + d + ' days past due' })]),
        el('span.badge' + (d > 60 ? '.badge-bad' : '.badge-warn'), { text: d > 60 ? 'CRITICAL' : 'FOLLOW UP' })
      ]));
    });
    page.appendChild(el('div.card.mt-2', null, [
      el('div.card-head', null, [el('h3', { html: ui.icon('flag') + ' Needs Attention' }), el('span.card-sub', { text: 'overdue & defaulted — oldest first' })]), bodyR
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
      var n = nextDueOf(l), od = overdueOf(l);
      body.appendChild(el('div.card.mb-2', null, [el('div.card-body', null, [
        el('div.flex.items-center.gap-2.flex-wrap.mb-3', null, [
          el('div.flex-1', null, [el('div.fw-700', { text: l.borrower }),
            el('div.text-mute.sm', { text: (l.borrowerType || '') + (l.phone ? ' · ' + l.phone : '') + ' · ' + coName(l.companyId) })]),
          ui.frag(statusBadge(l)), acts]),
        el('div.stat-row', null, [
          el('div.stat', null, [el('div.stat-label', { text: 'Principal' }), el('div.stat-value.num', { text: ui.money(l.principal) })]),
          el('div.stat', null, [el('div.stat-label', { text: 'Outstanding' }), el('div.stat-value.num' + (od ? '.text-bad' : ''), { text: ui.money(outstandingOf(l)) })]),
          el('div.stat', null, [el('div.stat-label', { text: 'Collected' }), el('div.stat-value.num.text-good', { text: ui.money(paidOf(l)) })]),
          el('div.stat', null, [el('div.stat-label', { text: 'Next due' }), el('div.stat-value', { text: n ? (ui.date(n.due) + (n.late ? ' · LATE' : '')) : '—' })])
        ]),
        el('div.data-list.mt-2', null, [
          row2('Terms', (+l.rate || 0) + '% p.a. · ' + (l.method === 'reducing' ? 'reducing balance' : 'flat') + ' · ' + l.tenureMonths + ' months · EMI ' + ui.money(l.emi)),
          row2('Disbursed', (l.disbursed ? ui.date(l.disbursedDate || l.startDate) : 'not disbursed yet') + ' · first installment ' + ui.date(addMonths(l.startDate, 1))),
          row2('Purpose', l.purpose || '—'),
          row2('Security', l.security || '—'),
          row2('Guarantor', l.guarantor || '—'),
          od ? row2('Overdue', ui.money(od) + ' · ' + daysPastDue(l) + ' days past due') : null,
          l.notes ? row2('Notes', l.notes) : null
        ].filter(Boolean))
      ])]));
      // schedule
      var st = EPAL.table({
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
        rows: (l.schedule || []), pageSize: 12, exportName: 'loan-schedule-' + l.id + '.csv',
        empty: { icon: 'calendar3', title: 'No schedule' }
      });
      body.appendChild(el('div.card.mb-2', null, [
        el('div.card-head', null, [el('h3', { html: ui.icon('calendar3') + ' Repayment Schedule' }),
          el('span.card-sub', { text: (l.schedule || []).filter(function (r) { return (+r.paid || 0) >= (+r.total || 0); }).length + ' of ' + (l.schedule || []).length + ' installments settled' })]),
        el('div.card-body', null, [st.el])
      ]));
      // history
      var hx = S.list('loan_txns').filter(function (t) { return t.loanId === l.id; }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
      var ht = EPAL.table({
        columns: [
          { key: 'date', label: 'Date', date: true },
          { key: 'type', label: 'Type', badge: { disbursement: 'info', collection: 'good', 'write-off': 'bad' } },
          { key: 'memo', label: 'Detail', render: function (t) { return esc(t.memo || '—'); } },
          { key: 'principal', label: 'Principal', num: true, money: true },
          { key: 'interest', label: 'Interest', num: true, money: true },
          { key: 'amount', label: 'Amount', num: true, money: true }
        ],
        rows: hx, pageSize: 8, totalKey: 'amount', exportName: 'loan-history-' + l.id + '.csv',
        empty: { icon: 'clock-history', title: 'No transactions yet' }
      });
      body.appendChild(el('div.card', null, [
        el('div.card-head', null, [el('h3', { html: ui.icon('clock-history') + ' Transaction History' })]),
        el('div.card-body', null, [ht.el])
      ]));
    }
    function row2(k, v) { return el('div.data-row', null, [el('div.text-mute.sm.flex-1', { text: k }), el('div.strong', { text: String(v) })]); }
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
        { key: 'bankId', label: 'Pay out from', type: 'select', options: banks.map(function (b) { return [b.id, b.name + ' (' + ui.money(b.balance, { compact: true }) + ')']; }),
          showIf: function () { return isNew; }, hint: 'The money leaves this account and the loan becomes an asset (1270).' },
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
          var bank = db().col('banks').filter(function (b) { return b.id === v.bankId; })[0];
          if (!bank) { ui.toast('Pick the bank the money leaves from', 'error'); return false; }
          if ((+bank.balance || 0) < P) { ui.toast('Insufficient balance in ' + bank.name + ' — available ' + ui.money(bank.balance), 'error'); return false; }
          var glId = 'GL-LOAN-' + rec.id;
          try {
            L().post({ id: glId, date: rec.startDate, companyId: rec.companyId, ref: rec.id,
              memo: 'Loan disbursed · ' + rec.borrower + (rec.purpose ? ' — ' + rec.purpose : ''), source: 'manual', party: rec.borrower,
              lines: [{ account: '1270', dr: P, cr: 0 }, { account: '1010', dr: 0, cr: P }] });
          } catch (e) { ui.toast(e.message || 'Ledger post failed', 'error'); return false; }
          if (EPAL.bankTxnApply) EPAL.bankTxnApply(bank, 'withdraw', P, rec.startDate, 'Loan disbursed · ' + rec.borrower, rec.id, glId);
          else { bank.balance = (+bank.balance || 0) - P; db().save('banks', bank); }
          rec.disbursed = true; rec.disbursedDate = rec.startDate; rec.bankId = bank.id; rec.glId = glId;
          S.upsert('loan_txns', { id: 'LT-' + rec.id + '-D', loanId: rec.id, companyId: rec.companyId, type: 'disbursement',
            date: rec.startDate, amount: P, principal: P, interest: 0, memo: 'Loan disbursed from ' + bank.name, by: whoAmI() });
        }
        S.upsert('loans_ext', rec);
        ui.toast(isNew ? ('Loan ' + rec.id + ' disbursed · EMI ' + ui.money(rec.emi)) : 'Loan updated', 'success');
        EPAL.router.render(); return true;
      }
    });
  }
  function whoAmI() { try { var u = EPAL.auth && EPAL.auth.current && EPAL.auth.current(); return (u && (u.name || u.email)) || 'Owner'; } catch (e) { return 'Owner'; } }

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
        { key: 'bankId', label: 'Deposited to', type: 'select', required: true, options: banks.map(function (b) { return [b.id, b.name]; }) },
        { key: 'memo', label: 'Note', type: 'text', col2: true, placeholder: 'e.g. cheque no / cash received by' }
      ],
      saveLabel: 'Record Collection',
      onSave: function (v) {
        var amt = Math.min(+v.amount || 0, owed);
        if (amt <= 0) { ui.toast('Enter the amount received', 'error'); return false; }
        var bank = db().col('banks').filter(function (b) { return b.id === v.bankId; })[0];
        if (!bank) { ui.toast('Pick the receiving account', 'error'); return false; }
        // allocate oldest-first, tracking the principal / interest split
        var left = amt, prin = 0, intr = 0;
        (l.schedule || []).forEach(function (r) {
          if (left <= 0) return;
          var due = Math.max(0, (+r.total || 0) - (+r.paid || 0));
          if (due <= 0) return;
          var take = Math.min(left, due);
          var share = (+r.total || 0) ? (+r.principal || 0) / r.total : 1;
          prin += take * share; intr += take * (1 - share);
          r.paid = (+r.paid || 0) + take;
          if (r.paid >= r.total - 0.5) r.paidDate = v.date;
          left -= take;
        });
        prin = Math.round(prin); intr = Math.round(amt - prin);
        var glId = 'GL-LREP-' + ui.uid('').slice(-6).toUpperCase();
        var lines = [{ account: '1010', dr: amt, cr: 0 }, { account: '1270', dr: 0, cr: prin }];
        if (intr > 0) lines.push({ account: '4060', dr: 0, cr: intr });
        try {
          L().post({ id: glId, date: v.date, companyId: l.companyId, ref: l.id,
            memo: 'Loan collection · ' + l.borrower + (v.memo ? ' — ' + v.memo : ''), source: 'payment', party: l.borrower, lines: lines });
        } catch (e) { ui.toast(e.message || 'Ledger post failed', 'error'); return false; }
        if (EPAL.bankTxnApply) EPAL.bankTxnApply(bank, 'deposit', amt, v.date, 'Loan collection · ' + l.borrower, l.id, glId);
        else { bank.balance = (+bank.balance || 0) + amt; db().save('banks', bank); }
        S.upsert('loan_txns', { id: 'LT-' + ui.uid('').slice(-6).toUpperCase(), loanId: l.id, companyId: l.companyId, type: 'collection',
          date: v.date, amount: amt, principal: prin, interest: intr, memo: v.memo || 'Collection', by: whoAmI() });
        if (outstandingOf(l) <= 0.5) l.status = 'Closed';
        else if (l.status === 'Defaulted' && overdueOf(l) <= 0) l.status = 'Active';
        S.upsert('loans_ext', l);
        ui.toast('Collected ' + ui.money(amt) + ' (principal ' + ui.money(prin) + ' · interest ' + ui.money(intr) + ')' + (l.status === 'Closed' ? ' — loan CLOSED' : ''), 'success');
        EPAL.router.render(); return true;
      }
    });
  }
  function writeOffForm(l) {
    var owed = principalOutstandingOf(l);
    EPAL.formModal({
      title: 'Write Off · ' + l.borrower, icon: 'x-octagon', size: 'sm', record: { date: today() },
      fields: [
        { key: 'reason', label: 'Reason (goes on the books)', type: 'textarea', required: true, placeholder: 'e.g. borrower untraceable since Jan; legal cost exceeds recovery' },
        { key: 'date', label: 'Write-off date', type: 'date', required: true }
      ],
      saveLabel: 'Write Off ' + ui.money(owed),
      onSave: function (v) {
        if (owed <= 0) { ui.toast('Nothing left to write off', 'error'); return false; }
        try {
          L().post({ id: 'GL-LNWO-' + l.id, date: v.date, companyId: l.companyId, ref: l.id,
            memo: 'Loan written off · ' + l.borrower + ' — ' + v.reason, source: 'manual', party: l.borrower, override: true,
            lines: [{ account: '5700', dr: owed, cr: 0 }, { account: '1270', dr: 0, cr: owed }] });
        } catch (e) { ui.toast(e.message || 'Ledger post failed', 'error'); return false; }
        S.upsert('loan_txns', { id: 'LT-' + l.id + '-WO', loanId: l.id, companyId: l.companyId, type: 'write-off',
          date: v.date, amount: owed, principal: owed, interest: 0, memo: v.reason, by: whoAmI() });
        l.status = 'Written-off'; l.writeOffReason = v.reason; l.writeOffDate = v.date;
        S.upsert('loans_ext', l);
        ui.toast('Written off ' + ui.money(owed) + ' to Bad Debt (5700)', 'success'); EPAL.router.render(); return true;
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
          { key: 'name', label: 'Employee', render: function (r) { return EPAL.people && EPAL.people.linkify ? EPAL.people.linkify(r.emp.name, r.emp.id) : '<span class="strong">' + esc(r.emp.name) + '</span>'; },
            exportVal: function (r) { return r.emp.name; } },
          { key: 'dept', label: 'Department', render: function (r) { return esc(r.emp.dept || '—'); } },
          { key: 'companyId', label: 'Company', render: function (r) { return '<span class="badge">' + esc(coName(r.companyId)) + '</span>'; }, exportVal: function (r) { return r.companyId; } },
          { key: 'out', label: 'Outstanding', num: true, sortVal: function (r) { return r.out; }, render: function (r) { return '<span class="num strong text-warn">' + ui.money(r.out) + '</span>'; }, exportVal: function (r) { return r.out; } }
        ],
        rows: emp, pageSize: 10, searchKeys: ['emp.name'], exportName: 'employee-loans.csv', pdfTitle: 'Employee Loan Book — ' + coName(cid),
        empty: { icon: 'person-badge', title: 'No staff loans outstanding' }
      });
      page.appendChild(el('div.card.mb-2', null, [
        el('div.card-head', null, [el('h3', { html: ui.icon('person-badge') + ' Staff Loan Book — ' + coName(cid) }), el('span.card-sub', { text: 'ledger 1260 · recovered via payslip EMI' })]),
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
    // how the books are wired — so an accountant can see it without reading code
    page.appendChild(el('div.card', null, [
      el('div.card-head', null, [el('h3', { html: ui.icon('diagram-2') + ' How loans hit the books' })]),
      el('div.card-body', null, [el('div.data-list', null, [
        gl('Disburse an external loan', 'DR 1270 Loans Receivable (External) / CR 1010 Bank', 'the money leaves the bank and becomes an asset'),
        gl('Collect an installment', 'DR 1010 Bank / CR 1270 (principal) + CR 4060 Interest Income', 'every collection splits principal from interest automatically'),
        gl('Write off a dead loan', 'DR 5700 Bad Debt Written Off / CR 1270', 'the asset leaves the books as an expense, with the reason recorded'),
        gl('Employee loan (Payroll owns it)', 'DR 1260 Staff Loans Receivable · EMI recovery credits 1260 on the payslip', 'never mixed with the external book')
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
    var interest = S.list('loan_txns').filter(function (t) { return t.type === 'collection' && (cid === 'all' || t.companyId === cid); })
      .reduce(function (a, t) { return a + (+t.interest || 0); }, 0);
    var written = 0;
    try { written = L().balance('5700', cid === 'all' ? {} : { companyId: cid }); } catch (e) {}
    page.appendChild(el('div.kpi-grid.kpi-compact.stagger', null, [
      kpi('Portfolio', ui.money(extOut + empOut, { compact: true }), 'safe2'),
      kpi('At Risk (overdue)', ui.money(buckets.slice(1).reduce(function (a, b) { return a + b[1]; }, 0), { compact: true }), 'exclamation-octagon', 'text-bad'),
      kpi('Interest Collected', ui.money(interest, { compact: true }), 'graph-up-arrow', 'text-good'),
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
    // collection history
    var hx = S.list('loan_txns').filter(function (t) { return t.type === 'collection' && (cid === 'all' || t.companyId === cid); })
      .sort(function (a, b) { return a.date < b.date ? 1 : -1; }).slice(0, 60);
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
