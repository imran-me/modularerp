/* ============================================================================
 * EPAL GROUP ERP  ·  companies/travels/modules/reports/view.js
 * ----------------------------------------------------------------------------
 * TRAVELS — REPORTS. A documentation-grade report centre for Epal Travels: a
 * categorised catalogue (Financial · Sales & CRM · People) where each report
 * opens a rich PREVIEW (KPI strip + data table with built-in CSV + PDF export)
 * and a clean print sheet — every figure pulled live from the ledger, the sales
 * register, the journal and the HR stores.
 *
 * Because the router prefers a specific view over the shared "star-slash-reports"
 * wildcard, this Travels screen supersedes the generic one WITHOUT touching any
 * other company. Never write a literal star-slash inside this comment block.
 *
 * Adding a report = one entry in REPORTS with a build() that returns
 * { kpis, columns, rows } — the preview modal + exports come for free.
 * ==> LARAVEL: a ReportController with one method per report id, each returning a
 *     dataset the Blade preview + the export/DocumentService render.
 * ==========================================================================*/

(function (EPAL) {
  'use strict';
  var ui = EPAL.ui, el = ui.el, db = EPAL.db;
  var CID = 'travels';

  /* ==========================================================================
   * REPORT DEFINITIONS — grouped; each build() returns { kpis, columns, rows }.
   * ========================================================================*/
  var GROUPS = [
    { id: 'financial', label: 'Financial', icon: 'cash-stack' },
    { id: 'sales', label: 'Sales & CRM', icon: 'graph-up-arrow' },
    { id: 'people', label: 'People', icon: 'people-fill' }
  ];

  var REPORTS = [
    // ---- FINANCIAL --------------------------------------------------------
    { id: 'pnl', group: 'financial', title: 'Monthly P&L (12M)', icon: 'graph-up-arrow', desc: 'Revenue, expense and profit by month.', build: rPnl },
    { id: 'trial', group: 'financial', title: 'Trial Balance', icon: 'journal-check', desc: 'Every account head, debit vs credit.', build: rTrial },
    { id: 'balance-sheet', group: 'financial', title: 'Balance Sheet', icon: 'building', desc: 'Assets, liabilities and equity.', build: rBalanceSheet },
    { id: 'ar-ageing', group: 'financial', title: 'AR Ageing', icon: 'arrow-down-left-circle', desc: 'Receivables by ageing bucket.', build: function () { return rAgeing('AR'); } },
    { id: 'ap-ageing', group: 'financial', title: 'AP Ageing', icon: 'arrow-up-right-circle', desc: 'Payables by ageing bucket.', build: function () { return rAgeing('AP'); } },
    { id: 'income', group: 'financial', title: 'Income Register', icon: 'cash-coin', desc: 'Journal income grouped by head.', build: function () { return rRegister('Income'); } },
    { id: 'expense', group: 'financial', title: 'Expense Register', icon: 'wallet2', desc: 'Journal expenses grouped by head.', build: function () { return rRegister('Expense'); } },
    // ---- SALES & CRM ------------------------------------------------------
    { id: 'sales', group: 'sales', title: 'Sales Register', icon: 'receipt', desc: 'Every recorded sale with cost & profit.', build: rSales },
    { id: 'sales-customer', group: 'sales', title: 'Sales by Customer', icon: 'people', desc: 'Billing and profit per customer.', build: rSalesByCustomer },
    { id: 'sales-service', group: 'sales', title: 'Sales by Service Line', icon: 'diagram-3', desc: 'Ticketing / Visa / Package / Other.', build: rSalesByService },
    { id: 'commission', group: 'sales', title: 'Agent Commission', icon: 'percent', desc: 'Expected vs received by sub-agent.', build: rCommission },
    { id: 'leads', group: 'sales', title: 'CRM Leads', icon: 'funnel', desc: 'Every lead with stage, value and owner.', build: rLeads },
    // ---- PEOPLE -----------------------------------------------------------
    { id: 'roster', group: 'people', title: 'Team Roster', icon: 'person-badge', desc: 'The Epal Travels team.', build: rRoster },
    { id: 'attendance', group: 'people', title: 'Attendance Sheet', icon: 'calendar2-check', desc: 'Present / absent / late / leave.', build: rAttendance },
    { id: 'salary', group: 'people', title: 'Salary Sheet', icon: 'cash-stack', desc: 'Gross, deductions and net pay.', build: rSalary },
    { id: 'leave', group: 'people', title: 'Leave Register', icon: 'calendar2-week', desc: 'Applied / approved / rejected leave.', build: rLeave }
  ];

  /* ==========================================================================
   * VIEW
   * ========================================================================*/
  EPAL.view('travels/reports', {
    render: function (ctx) {
      var page = el('div.page');
      page.appendChild(EPAL.pageHead({
        eyebrow: 'Epal Travels', icon: 'file-earmark-bar-graph', title: 'Reports',
        sub: 'Board-ready, print-ready reports for Epal Travels — preview, export CSV/PDF, or print.',
        actions: [ el('a.btn.btn-ghost', { href: '#/travels/analytics', html: ui.icon('graph-up') + ' Analytics' }) ]
      }));

      page.appendChild(el('div.kpi-grid.kpi-compact.stagger', null, [
        kpi('Reports', String(REPORTS.length), 'file-earmark-text'),
        kpi('Financial', String(REPORTS.filter(function (r) { return r.group === 'financial'; }).length), 'cash-stack'),
        kpi('Sales & CRM', String(REPORTS.filter(function (r) { return r.group === 'sales'; }).length), 'graph-up-arrow'),
        kpi('People', String(REPORTS.filter(function (r) { return r.group === 'people'; }).length), 'people-fill')
      ]));

      // live search over the catalogue
      var q = el('input.input', { type: 'search', placeholder: 'Search reports…', style: { maxWidth: '320px' } });
      var host = el('div');
      q.addEventListener('input', function () { paint(host, q.value); });
      page.appendChild(el('div.flex.justify-between.items-center.flex-wrap.gap-2.mb-2', null, [ el('div.section-label.mt-0', { text: 'Report Catalogue' }), q ]));
      page.appendChild(host);
      paint(host, '');
      ctx.mount.appendChild(page);
    }
  });

  function paint(host, query) {
    host.innerHTML = '';
    var ql = (query || '').trim().toLowerCase();
    GROUPS.forEach(function (g) {
      var items = REPORTS.filter(function (r) { return r.group === g.id && (!ql || (r.title + ' ' + r.desc).toLowerCase().indexOf(ql) >= 0); });
      if (!items.length) return;
      host.appendChild(el('div.section-label', { html: ui.icon(g.icon) + ' ' + g.label }));
      var grid = el('div.grid-auto.stagger');
      items.forEach(function (r) {
        grid.appendChild(el('div.card.hover', { style: { cursor: 'pointer' }, onclick: function () { runReport(r); } }, [
          el('div.card-body', null, [ el('div.flex.items-center.gap-2', null, [
            el('div.scaffold-ico', { html: '<i class="bi bi-' + r.icon + '"></i>' }),
            el('div.flex-1', null, [ el('h4', { text: r.title }), el('p.text-mute.sm', { text: r.desc }) ]),
            ui.frag('<i class="bi bi-eye text-accent"></i>')
          ]) ])
        ]));
      });
      host.appendChild(grid);
    });
    if (!host.children.length) host.appendChild(el('div.empty-state', null, [ ui.frag(ui.icon('search')), el('h3', { text: 'No matching reports' }) ]));
  }

  /* ---- preview modal (KPIs + table with CSV/PDF export + print) ----------*/
  function runReport(def) {
    var data;
    try { data = def.build(); } catch (e) { ui.toast('Could not build report: ' + (e.message || e), 'error'); return; }
    var body = el('div');
    ui.modal({ title: def.title, icon: def.icon, size: 'lg', body: body, footer: false });
    if (data.kpis && data.kpis.length) {
      body.appendChild(el('div.kpi-grid.kpi-compact.mb-2', null, data.kpis.map(function (k) { return kpi(k[0], k[1], k[2] || 'dot'); })));
    }
    var t = EPAL.table({
      columns: data.columns, rows: data.rows, pageSize: data.pageSize || 12,
      searchKeys: data.searchKeys || data.columns.map(function (c) { return c.key; }),
      exportName: 'travels-' + def.id + '.csv', pdfTitle: 'Epal Travels — ' + def.title,
      empty: { icon: 'inbox', title: 'No data for this report yet' }
    });
    body.appendChild(el('div.card', null, [ el('div.card-body', null, [ t.el ]) ]));
    body.appendChild(el('div.flex.justify-end.gap-1.mt-2', null, [
      el('button.btn.btn-sm.btn-primary', { html: ui.icon('printer') + ' Print', onclick: function () { printReport(def.title, data); } })
    ]));
  }
  function printReport(title, data) {
    var cols = data.columns;
    var head = '<tr>' + cols.map(function (c) { return '<th>' + esc(c.label) + '</th>'; }).join('') + '</tr>';
    var rowsHtml = data.rows.map(function (r) {
      return '<tr>' + cols.map(function (c) { var v = data.print ? data.print(r, c) : rawCell(r, c); return '<td>' + esc(v) + '</td>'; }).join('') + '</tr>';
    }).join('');
    var kpiHtml = (data.kpis || []).map(function (k) { return '<tr><td>' + esc(k[0]) + '</td><td>' + esc(k[1]) + '</td></tr>'; }).join('');
    ui.printDoc({ title: 'Epal Travels — ' + title, subtitle: 'Epal Travels & Consultancy', meta: 'Generated ' + ui.date('2026-07-05'), footer: 'Epal Group ERP · Confidential — internal documentation',
      bodyHtml: (kpiHtml ? '<h3>Summary</h3><table>' + kpiHtml + '</table>' : '') + '<h3>Detail</h3><table>' + head + rowsHtml + '</table>' });
  }
  function rawCell(r, c) {
    var v = r[c.key];
    if (c.money) return ui.money(+v || 0);
    if (c.date) return v ? ui.date(v) : '';
    return v == null ? '' : String(v);
  }

  /* ==========================================================================
   * REPORT BUILDERS
   * ========================================================================*/
  function acc() { return db.col('acc_entries').filter(function (e) { return e.companyId === CID; }); }
  function sales() { return db.sales ? db.sales(CID) : []; }
  function team() { return db.employees ? db.employees({ companyId: CID }) : []; }

  function rPnl() {
    var s = db.series ? db.series(CID) : { labels: [], revenue: [], expense: [], profit: [] };
    var f = db.finance ? db.finance(CID, 12) : { revenue: 0, expense: 0, profit: 0, margin: 0 };
    var rows = s.labels.map(function (l, i) { return { month: l, revenue: s.revenue[i], expense: s.expense[i], profit: s.profit[i] }; });
    return { kpis: [['Revenue', ui.money(f.revenue, { compact: true }), 'cash-coin'], ['Expense', ui.money(f.expense, { compact: true }), 'wallet2'],
        ['Net Profit', ui.money(f.profit, { compact: true }), 'trophy'], ['Margin', ui.pct ? ui.pct(f.margin) : (Math.round(f.margin) + '%'), 'pie-chart']],
      columns: [ { key: 'month', label: 'Month' }, { key: 'revenue', label: 'Revenue', num: true, money: true }, { key: 'expense', label: 'Expense', num: true, money: true }, { key: 'profit', label: 'Profit', num: true, money: true } ],
      rows: rows };
  }
  function rTrial() {
    var L = EPAL.ledger; var rows = L ? L.trialBalance(CID) : [];
    var td = 0, tc = 0; rows.forEach(function (r) { td += r.debit; tc += r.credit; });
    return { kpis: [['Total Debit', ui.money(td, { compact: true }), 'arrow-up-right-circle'], ['Total Credit', ui.money(tc, { compact: true }), 'arrow-down-left-circle'], ['Accounts', String(rows.length), 'list-ol'], ['Check', Math.abs(td - tc) < 1 ? 'Balanced' : 'Out', 'check2-circle']],
      columns: [ { key: 'code', label: 'Code' }, { key: 'name', label: 'Account' }, { key: 'type', label: 'Type', badge: {} }, { key: 'debit', label: 'Debit', num: true, money: true }, { key: 'credit', label: 'Credit', num: true, money: true } ],
      rows: rows };
  }
  function rBalanceSheet() {
    var L = EPAL.ledger; var bs = L ? L.balanceSheet(CID) : { assets: [], liabilities: [], equity: [], totals: {} };
    var rows = [];
    bs.assets.forEach(function (a) { rows.push({ section: 'Assets', code: a.code, name: a.name, amount: a.amount }); });
    bs.liabilities.forEach(function (a) { rows.push({ section: 'Liabilities', code: a.code, name: a.name, amount: a.amount }); });
    bs.equity.forEach(function (a) { rows.push({ section: 'Equity', code: a.code, name: a.name, amount: a.amount }); });
    return { kpis: [['Assets', ui.money(bs.totals.assets, { compact: true }), 'building'], ['Liabilities', ui.money(bs.totals.liabilities, { compact: true }), 'file-earmark-minus'], ['Equity', ui.money(bs.totals.equity, { compact: true }), 'piggy-bank'], ['Check', bs.totals.balanced ? 'A=L+E' : 'Out', 'check2-circle']],
      columns: [ { key: 'section', label: 'Section', badge: {} }, { key: 'code', label: 'Code' }, { key: 'name', label: 'Account' }, { key: 'amount', label: 'Amount', num: true, money: true } ], rows: rows };
  }
  function rAgeing(kind) {
    var L = EPAL.ledger; var rows = L ? L.aging(kind, { companyId: CID }) : [];
    var sum = rows.reduce(function (a, r) { a.current += r.current; a.d30 += r.d30; a.d60 += r.d60; a.d90 += r.d90; a.total += r.total; return a; }, { current: 0, d30: 0, d60: 0, d90: 0, total: 0 });
    return { kpis: [['Current', ui.money(sum.current, { compact: true }), 'clock'], ['31–60', ui.money(sum.d60, { compact: true }), 'hourglass-split'], ['60+', ui.money(sum.d90, { compact: true }), 'exclamation-octagon'], ['Total ' + kind, ui.money(sum.total, { compact: true }), 'sigma']],
      columns: [ { key: 'party', label: 'Party' }, { key: 'current', label: 'Current', num: true, money: true }, { key: 'd30', label: '1–30', num: true, money: true }, { key: 'd60', label: '31–60', num: true, money: true }, { key: 'd90', label: '60+', num: true, money: true }, { key: 'total', label: 'Total', num: true, money: true } ], rows: rows };
  }
  function rRegister(kind) {
    var list = acc().filter(function (e) { return e.kind === kind; });
    var byCat = {}; list.forEach(function (e) { byCat[e.category || '—'] = (byCat[e.category || '—'] || 0) + (+e.amount || 0); });
    var rows = Object.keys(byCat).sort(function (a, b) { return byCat[b] - byCat[a]; }).map(function (k) { return { category: k, amount: byCat[k], count: list.filter(function (e) { return (e.category || '—') === k; }).length }; });
    var total = rows.reduce(function (a, r) { return a + r.amount; }, 0);
    return { kpis: [['Total ' + kind, ui.money(total, { compact: true }), kind === 'Income' ? 'cash-coin' : 'wallet2'], ['Heads', String(rows.length), 'diagram-3'], ['Entries', String(list.length), 'card-list'], ['Top Head', rows[0] ? rows[0].category : '—', 'trophy']],
      columns: [ { key: 'category', label: 'Head' }, { key: 'count', label: 'Entries', num: true }, { key: 'amount', label: 'Total', num: true, money: true } ], rows: rows };
  }
  function rSales() {
    var list = sales().slice().sort(function (a, b) { return (a.date < b.date) ? 1 : -1; });
    var amt = list.reduce(function (a, s) { return a + (+s.amount || 0); }, 0), profit = list.reduce(function (a, s) { return a + (+s.profit || 0); }, 0);
    return { kpis: [['Sales', ui.money(amt, { compact: true }), 'cash-coin'], ['Profit', ui.money(profit, { compact: true }), 'graph-up'], ['Orders', String(list.length), 'receipt'], ['Avg Ticket', ui.money(list.length ? Math.round(amt / list.length) : 0, { compact: true }), 'tag']],
      columns: [ { key: 'id', label: 'Ref' }, { key: 'date', label: 'Date', date: true }, { key: 'customer', label: 'Customer' }, { key: 'desc', label: 'Description' }, { key: 'amount', label: 'Amount', num: true, money: true }, { key: 'profit', label: 'Profit', num: true, money: true } ], rows: list };
  }
  function rSalesByCustomer() {
    var by = {}; sales().forEach(function (s) { var k = s.customer || 'Walk-in'; if (!by[k]) by[k] = { customer: k, orders: 0, amount: 0, profit: 0 }; by[k].orders++; by[k].amount += (+s.amount || 0); by[k].profit += (+s.profit || 0); });
    var rows = Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return b.amount - a.amount; });
    return { kpis: [['Customers', String(rows.length), 'people'], ['Top', rows[0] ? rows[0].customer : '—', 'trophy'], ['Total', ui.money(rows.reduce(function (a, r) { return a + r.amount; }, 0), { compact: true }), 'cash-coin']],
      columns: [ { key: 'customer', label: 'Customer' }, { key: 'orders', label: 'Orders', num: true }, { key: 'amount', label: 'Billing', num: true, money: true }, { key: 'profit', label: 'Profit', num: true, money: true } ], rows: rows };
  }
  function rSalesByService() {
    var by = {}; sales().forEach(function (s) { var k = serviceOf(s); if (!by[k]) by[k] = { service: k, orders: 0, amount: 0, profit: 0 }; by[k].orders++; by[k].amount += (+s.amount || 0); by[k].profit += (+s.profit || 0); });
    var rows = Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return b.amount - a.amount; });
    return { kpis: [['Service Lines', String(rows.length), 'diagram-3'], ['Top Line', rows[0] ? rows[0].service : '—', 'trophy'], ['Total', ui.money(rows.reduce(function (a, r) { return a + r.amount; }, 0), { compact: true }), 'cash-coin']],
      columns: [ { key: 'service', label: 'Service Line' }, { key: 'orders', label: 'Orders', num: true }, { key: 'amount', label: 'Billing', num: true, money: true }, { key: 'profit', label: 'Profit', num: true, money: true } ], rows: rows };
  }
  function serviceOf(s) {
    var ref = String(s.ref || s.id || '').toUpperCase(), d = String(s.desc || '').toLowerCase();
    if (/^TKT|ticket|air/.test(ref) || /ticket|air/.test(d)) return 'Air Ticketing';
    if (/visa/.test(ref) || /visa/.test(d)) return 'Visa';
    if (/^CF|umrah|hajj|contract|package|itp/.test(ref) || /umrah|hajj|package|tour/.test(d)) return 'Package / Contract';
    if (/wap|hotel/.test(ref) || /hotel/.test(d)) return 'Hotel';
    return 'Other';
  }
  function rCommission() {
    var agents = db.col('tv_agents');
    var rows = agents.map(function (a) { var exp = Math.round((a.totalSales || 0) * ((a.commission || 0) / 100)); var rec = Math.round(exp * 0.7);
      return { name: a.name, agency: a.agency, rate: (a.commission || 0) + '%', sales: a.totalSales || 0, expected: exp, received: rec, outstanding: Math.max(0, exp - rec) }; });
    var exp = rows.reduce(function (a, r) { return a + r.expected; }, 0), out = rows.reduce(function (a, r) { return a + r.outstanding; }, 0);
    return { kpis: [['Agents', String(rows.length), 'person-badge'], ['Expected', ui.money(exp, { compact: true }), 'percent'], ['Outstanding', ui.money(out, { compact: true }), 'hourglass-split']],
      columns: [ { key: 'name', label: 'Agent' }, { key: 'agency', label: 'Agency' }, { key: 'rate', label: 'Rate' }, { key: 'sales', label: 'Sales', num: true, money: true }, { key: 'expected', label: 'Expected', num: true, money: true }, { key: 'received', label: 'Received', num: true, money: true }, { key: 'outstanding', label: 'Outstanding', num: true, money: true } ], rows: rows };
  }
  function rLeads() {
    var list = db.leads(CID);
    var open = list.filter(function (l) { return ['Won', 'Lost'].indexOf(l.stage) < 0; });
    return { kpis: [['Leads', String(list.length), 'card-list'], ['Open', String(open.length), 'funnel'], ['Pipeline', ui.money(open.reduce(function (a, l) { return a + (+l.value || 0); }, 0), { compact: true }), 'cash-coin'], ['Won', String(list.filter(function (l) { return l.stage === 'Won'; }).length), 'trophy']],
      columns: [ { key: 'name', label: 'Lead' }, { key: 'company', label: 'Organisation' }, { key: 'source', label: 'Source' }, { key: 'stage', label: 'Stage', badge: {} }, { key: 'value', label: 'Value', num: true, money: true }, { key: 'owner', label: 'Owner', render: function (l) { var e = db.employee ? db.employee(l.owner) : null; return esc(e ? e.name : l.owner || '—'); } } ], rows: list };
  }
  function rRoster() {
    var t = team();
    return { kpis: [['Team', String(t.length), 'people'], ['Payroll', ui.money(t.reduce(function (a, e) { return a + (+e.salary || 0); }, 0), { compact: true }), 'cash-stack'], ['On Leave', String(t.filter(function (e) { return e.status === 'on-leave'; }).length), 'calendar2-x']],
      columns: [ { key: 'id', label: 'ID' }, { key: 'name', label: 'Employee' }, { key: 'designation', label: 'Designation' }, { key: 'dept', label: 'Department', badge: {} }, { key: 'phone', label: 'Phone' }, { key: 'salary', label: 'Salary', num: true, money: true }, { key: 'status', label: 'Status', badge: { active: 'good', 'on-leave': 'warn' } } ], rows: t };
  }
  function rAttendance() {
    var rows = team().map(function (e) { var a = e.attendance || {}; return { name: e.name, designation: e.designation, present: a.present || 0, absent: a.absent || 0, late: a.late || 0, leave: a.leave || 0 }; });
    return { kpis: [['Team', String(rows.length), 'people'], ['Present (Σ)', String(rows.reduce(function (a, r) { return a + r.present; }, 0)), 'person-check'], ['Absent (Σ)', String(rows.reduce(function (a, r) { return a + r.absent; }, 0)), 'person-x']],
      columns: [ { key: 'name', label: 'Employee' }, { key: 'designation', label: 'Designation' }, { key: 'present', label: 'Present', num: true }, { key: 'absent', label: 'Absent', num: true }, { key: 'late', label: 'Late', num: true }, { key: 'leave', label: 'Leave', num: true } ], rows: rows };
  }
  function rSalary() {
    var rows = team().filter(function (e) { return (+e.salary || 0) > 0; }).map(function (e) {
      var gross = +e.salary || 0, tax = gross > 50000 ? Math.round(gross * 0.05) : 0, pf = Math.round(gross * 0.6 * 0.10);
      return { id: e.id, name: e.name, designation: e.designation, gross: gross, tax: tax, pf: pf, net: gross - tax - pf };
    });
    return { kpis: [['Headcount', String(rows.length), 'people'], ['Gross', ui.money(rows.reduce(function (a, r) { return a + r.gross; }, 0), { compact: true }), 'cash-stack'], ['Net', ui.money(rows.reduce(function (a, r) { return a + r.net; }, 0), { compact: true }), 'wallet2']],
      columns: [ { key: 'id', label: 'ID' }, { key: 'name', label: 'Employee' }, { key: 'designation', label: 'Designation' }, { key: 'gross', label: 'Gross', num: true, money: true }, { key: 'tax', label: 'Tax', num: true, money: true }, { key: 'pf', label: 'PF', num: true, money: true }, { key: 'net', label: 'Net Pay', num: true, money: true } ], rows: rows };
  }
  function rLeave() {
    var ids = {}; team().forEach(function (e) { ids[e.id] = 1; });
    var rows = db.col('tv_leaves').filter(function (l) { return ids[l.empId]; });
    return { kpis: [['Requests', String(rows.length), 'card-list'], ['Approved', String(rows.filter(function (l) { return l.status === 'Approved'; }).length), 'check2-circle'], ['Pending', String(rows.filter(function (l) { return l.status === 'Pending'; }).length), 'hourglass-split'], ['Days', String(rows.filter(function (l) { return l.status === 'Approved'; }).reduce(function (a, l) { return a + (l.days || 0); }, 0)), 'calendar-week']],
      columns: [ { key: 'empName', label: 'Employee' }, { key: 'type', label: 'Type', badge: {} }, { key: 'from', label: 'From', date: true }, { key: 'to', label: 'To', date: true }, { key: 'days', label: 'Days', num: true }, { key: 'status', label: 'Status', badge: { Approved: 'good', Pending: 'warn', Rejected: 'bad' } } ], rows: rows };
  }

  /* ---------------------------------------------------- helpers */
  function esc(s) { return ui.escapeHtml(String(s == null ? '' : s)); }
  function kpi(label, value, icon) {
    return el('div.kpi-card', null, [ el('div.kpi-top', null, [ el('span.kpi-label', { text: label }), el('span.kpi-ico', { html: '<i class="bi bi-' + icon + '"></i>' }) ]),
      el('div.kpi-value', { text: String(value) }) ]);
  }

})(window.EPAL = window.EPAL || {});
