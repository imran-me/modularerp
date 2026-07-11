/* ============================================================================
 * EPAL GROUP ERP  ·  companies/travels/modules/hrm/view.js
 * ----------------------------------------------------------------------------
 * TRAVELS — HRM. The people desk for Epal Travels: the team directory, an
 * attendance board, a leave register, a payroll run (that posts salaries into the
 * general ledger), and a performance view. ONE registered view branches on
 * ctx.subId (pill-tabs), and — because the router prefers a specific view over the
 * shared "star-slash-hrm" wildcard — this Travels screen supersedes the generic
 * one WITHOUT touching any other company's HRM.
 *
 *   directory    → roster: headcount / attendance / payroll / rating KPIs, dept
 *                  chips, rich table, row-click full employee profile, add/edit.
 *   attendance   → present / absent / late / leave board + per-employee chart.
 *   leaves       → leave register (apply · approve · reject) over a seeded store.
 *   payroll      → payslip per head + a monthly Run Payroll that posts to the GL.
 *   performance  → ratings distribution, top performers, per-employee reviews.
 *
 * DATA:
 *   employees   (shared HR store; db.employees({companyId:'travels'}) → 6 heads)
 *               { id, name, companyId, dept, designation, role, email, phone,
 *                 joinDate, salary, status:'active'|'on-leave',
 *                 attendance:{present,absent,late,leave}, rating, photo? }
 *   tv_leaves   (this module's own store, seeded idempotently below)
 *               { id, empId, empName, type, from, to, days, status, reason, applied }
 *   gl_entries  payroll runs post DR 5100 Salaries / CR 1010 Bank (stable id).
 *
 * The full employee lifecycle (hire→exit) lives in Group ▸ Workforce; this is the
 * Travels-scoped operational cockpit. Never write a literal star-slash here.
 * ==> LARAVEL: Employee + Leave + Payslip models; a PayrollController that runs a
 *     month through the LedgerService; a Blade view per tab.
 * ==========================================================================*/

(function (EPAL) {
  'use strict';
  var ui = EPAL.ui, el = ui.el, db = EPAL.db, S = EPAL.store;

  var CID = 'travels';
  var TODAY = new Date(2026, 6, 5);
  var TODAY_STR = '2026-07-05';
  var DEPTS = ['Air Ticketing', 'Visa', 'Operations', 'Accounts', 'Sales'];
  var DESIGN = { 'Air Ticketing': ['Ticketing Officer', 'Reservation Executive', 'Ticketing Manager'],
    'Visa': ['Visa Officer', 'Documentation Executive', 'Visa Manager'], 'Operations': ['Operations Executive', 'Operations Manager'],
    'Accounts': ['Accounts Officer', 'Accountant', 'Finance Manager'], 'Sales': ['Sales Executive', 'Business Development Manager'] };
  var ROLES = ['employee', 'accountant', 'manager'];
  var LEAVE_TYPES = ['Annual', 'Sick', 'Casual', 'Unpaid'];
  var LEAVE_STATUS = ['Pending', 'Approved', 'Rejected'];
  var ANNUAL_QUOTA = 20;   // annual leave days per head — drives the balance meter

  /* ==========================================================================
   * SEED — tv_leaves (idempotent; survives db.reset via the engine registry).
   * ========================================================================*/
  EPAL.registerEngine({ name: 'travels-hrm-seed', seed: function () { S.seedOnce('tv_leaves', seedLeaves()); } });

  function seedLeaves() {
    var team = db.employees ? db.employees({ companyId: CID }) : [];
    var out = [], id = 5001, seed = 20260705;
    function rr(n) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; }
    var reasons = { Annual: 'Family vacation', Sick: 'Fever & rest advised', Casual: 'Personal errand', Unpaid: 'Extended personal leave' };
    team.forEach(function (e) {
      var count = rr(3);   // 0–2 leave records per head
      for (var i = 0; i < count; i++) {
        var type = LEAVE_TYPES[rr(LEAVE_TYPES.length)];
        var days = 1 + rr(4);
        var startMonth = 2 + rr(4);   // Mar–Jun 2026
        var startDay = 1 + rr(24);
        var from = '2026-' + String(startMonth).padStart(2, '0') + '-' + String(startDay).padStart(2, '0');
        var to = addDays(from, days - 1);
        var status = e.status === 'on-leave' && i === 0 ? 'Approved' : LEAVE_STATUS[rr(LEAVE_STATUS.length)];
        out.push({ id: 'LV-' + (id++), empId: e.id, empName: e.name, type: type, from: from, to: to,
          days: days, status: status, reason: reasons[type], applied: addDays(from, -(3 + rr(6))) });
      }
    });
    return out;
  }
  function addDays(str, n) { var d = new Date(str); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }

  /* ==========================================================================
   * DATA ACCESSORS + COMPUTATION
   * ========================================================================*/
  function team() { return (db.employees ? db.employees({ companyId: CID }) : []).slice().sort(function (a, b) { return (a.name || '') < (b.name || '') ? -1 : 1; }); }
  function leaves() { return S.list('tv_leaves'); }
  function leavesFor(empId) { return leaves().filter(function (l) { return l.empId === empId; }); }
  function att(e) { return e.attendance || { present: 0, absent: 0, late: 0, leave: 0 }; }
  function attRate(e) { var a = att(e); var base = (a.present || 0) + (a.absent || 0) + (a.late || 0); return base ? Math.round((a.present || 0) / base * 100) : 0; }
  function tenureYears(e) { if (!e.joinDate) return 0; return Math.max(0, Math.round((TODAY.getTime() - new Date(e.joinDate).getTime()) / (86400000 * 365.25) * 10) / 10); }
  function payrollTotal() { return team().reduce(function (a, e) { return a + (+e.salary || 0); }, 0); }

  // A realistic Bangladeshi payslip breakdown derived from the monthly gross.
  function payslip(e) {
    var gross = +e.salary || 0;
    var basic = Math.round(gross * 0.6), house = Math.round(gross * 0.25), medical = Math.round(gross * 0.10);
    var transport = gross - basic - house - medical;
    var tax = gross > 50000 ? Math.round(gross * 0.05) : 0;
    var pf = Math.round(basic * 0.10);
    return { gross: gross, basic: basic, house: house, medical: medical, transport: transport, tax: tax, pf: pf, deductions: tax + pf, net: gross - tax - pf };
  }

  /* ==========================================================================
   * VIEW ENTRY
   * ========================================================================*/
  EPAL.view('travels/hrm', {
    render: function (ctx) {
      var sub = ctx.subId || 'directory';
      if (['directory', 'attendance', 'leaves', 'payroll', 'performance'].indexOf(sub) < 0) sub = 'directory';
      var page = el('div.page');
      var titles = { directory: 'HRM — Team', attendance: 'Attendance', leaves: 'Leave Register', payroll: 'Payroll', performance: 'Performance' };
      var subs = { directory: 'The Epal Travels team — roster, attendance, payroll and performance.',
        attendance: 'Present, absent, late and leave for the current period.', leaves: 'Apply, approve and track staff leave.',
        payroll: 'Payslips and the monthly payroll run — posted to the ledger.', performance: 'Ratings, top performers and reviews.' };
      page.appendChild(EPAL.pageHead({
        eyebrow: sub === 'directory' ? 'Epal Travels' : 'Travels › HRM', icon: 'people-fill', title: titles[sub], sub: subs[sub],
        actions: [
          canCreate() && sub === 'directory' ? el('button.btn.btn-ghost', { html: ui.icon('person-plus') + ' Add Employee', onclick: function () { empForm(null); } }) : null,
          canCreate() && sub === 'leaves' ? el('button.btn.btn-ghost', { html: ui.icon('calendar2-plus') + ' Apply Leave', onclick: function () { leaveForm(null); } }) : null,
          EPAL.auth.isAdmin() ? el('a.btn.btn-primary', { href: '#/group/employees/directory', html: ui.icon('person-badge') + ' Group Workforce' }) : null
        ].filter(Boolean)
      }));
      var pills = el('div.pill-tab.mb-3');
      [['directory', 'Directory'], ['attendance', 'Attendance'], ['leaves', 'Leaves'], ['payroll', 'Payroll'], ['performance', 'Performance']].forEach(function (p) {
        pills.appendChild(el('button' + (sub === p[0] ? '.active' : ''), { text: p[1],
          onclick: function () { EPAL.router.navigate('travels/hrm' + (p[0] === 'directory' ? '' : '/' + p[0])); } }));
      });
      page.appendChild(pills);
      ({ directory: directoryView, attendance: attendanceView, leaves: leavesView, payroll: payrollView, performance: performanceView }[sub])(page);
      ctx.mount.appendChild(page);
    }
  });

  /* ======================================================= DIRECTORY */
  function directoryView(page) {
    var t = team();
    var payroll = payrollTotal();
    var onLeave = t.filter(function (e) { return e.status === 'on-leave'; }).length;
    var avgRate = t.length ? Math.round(t.reduce(function (a, e) { return a + attRate(e); }, 0) / t.length) : 0;
    var avgRating = t.length ? (t.reduce(function (a, e) { return a + (+e.rating || 0); }, 0) / t.length).toFixed(1) : '—';

    page.appendChild(el('div.kpi-grid.kpi-compact.stagger', null, [
      kpi('Team Size', String(t.length), 'people'),
      kpi('Attendance', avgRate + '%', 'check2-circle', avgRate >= 90 ? 'text-good' : avgRate >= 80 ? 'text-warn' : 'text-bad'),
      kpi('Monthly Payroll', ui.money(payroll, { compact: true }), 'cash-stack'),
      kpi('Avg Rating', avgRating, 'star-fill'),
      kpiDrill('On Leave', String(onLeave), 'calendar2-x', 'travels/hrm/leaves', onLeave ? 'currently away' : 'all present')
    ]));

    // dept chips — tap to filter the roster
    var byDept = {};
    t.forEach(function (e) { byDept[e.dept || '—'] = (byDept[e.dept || '—'] || 0) + 1; });
    var tableRef = null, selDept = null;
    var chipWrap = el('div.grid-auto.kpi-compact.stagger.mb-3');
    Object.keys(byDept).sort().forEach(function (d) {
      chipWrap.appendChild(el('button.card.tier-card', { type: 'button', onclick: function () {
        selDept = selDept === d ? null : d;
        if (tableRef) { tableRef.state.filters.dept = selDept || '__all'; tableRef.state.page = 0; tableRef.refresh(); }
        Array.prototype.forEach.call(chipWrap.children, function (c) { c.classList.remove('active'); });
        if (selDept) this.classList.add('active');
      } }, [ el('div.card-pad', null, [ el('div.flex.items-center.gap-2', null, [
        ui.frag('<span class="notif-ico notif-info">' + ui.icon('diagram-3') + '</span>'),
        el('div.flex-1', null, [ el('div.fw-700', { text: d }), el('div.text-mute.sm', { text: byDept[d] + ' ' + (byDept[d] === 1 ? 'member' : 'members') }) ]) ]) ]) ]));
    });
    page.appendChild(el('div.section-label.mt-0', { text: 'Departments — tap to filter' }));
    page.appendChild(chipWrap);

    tableRef = EPAL.table({
      columns: [
        { key: 'id', label: 'ID', render: function (e) { return '<span class="mono xs text-mute">' + esc(e.id) + '</span>'; } },
        { key: 'name', label: 'Employee', render: function (e) { return avatarCell(e); } },
        { key: 'designation', label: 'Designation' },
        { key: 'dept', label: 'Department', badge: {} },
        { key: 'salary', label: 'Salary', num: true, money: true },
        { key: 'rate', label: 'Attendance', num: true, sortVal: function (e) { return attRate(e); }, render: function (e) { var r = attRate(e); return '<span class="num ' + (r >= 90 ? 'text-good' : r >= 80 ? '' : 'text-warn') + '">' + r + '%</span>'; } },
        { key: 'rating', label: 'Rating', num: true, sortVal: function (e) { return +e.rating || 0; }, render: function (e) { return '<span class="num">' + (e.rating || 0).toFixed(1) + '</span>'; } },
        { key: 'status', label: 'Status', badge: { active: 'good', 'on-leave': 'warn' } }
      ],
      rows: t, searchKeys: ['id', 'name', 'designation', 'dept', 'email', 'phone'],
      quickFilter: 'dept', filterPanel: true, filters: [{ key: 'status', label: 'Status' }, { key: 'role', label: 'Role' }],
      pageSize: 12, exportName: 'travels-team.csv', pdfTitle: 'Epal Travels — Team Roster',
      onRow: function (e) { empDetail(e); },
      actions: ui.actions({
        edit:  canCreate() ? function (e) { empForm(e); } : null,
        del:   canDelete() ? function (e) { deleteEmp(e); } : null,
        print: function (e) { empPrint(e); },
        wa:    function (e) { return { phone: e.phone, text: empMsg(e) }; },
        gmail: function (e) { return { to: e.email, subject: 'Epal Travels & Consultancy — HR', body: empMsg(e) }; }
      }),
      empty: { icon: 'people', title: 'No team members yet', hint: 'Add your first Travels employee.' }
    });
    page.appendChild(el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon('people-fill') + ' Team Roster' }), el('span.card-sub', { text: t.length + ' members · click for full profile' }) ]),
      el('div.card-body', null, [ tableRef.el ])
    ]));
  }

  function avatarCell(e) {
    var av = e.photo
      ? '<span class="avatar" style="width:26px;height:26px;background-image:url(' + e.photo + ');background-size:cover;background-position:center"></span>'
      : '<span class="avatar" style="width:26px;height:26px;font-size:10px;background:' + ui.colorFor(e.name) + '">' + ui.initials(e.name) + '</span>';
    return '<div class="flex items-center gap-1">' + av + '<div><div class="strong">' + esc(e.name) + '</div><div class="text-mute xs">' + esc(e.email || '') + '</div></div></div>';
  }

  /* ---- rich employee profile (row-click) --------------------------------*/
  function empDetail(e) {
    var body = el('div');
    var m = ui.modal({ title: e.name, icon: 'person-badge', size: 'lg', body: body, footer: false });
    var a = att(e), ps = payslip(e), lv = leavesFor(e.id);
    var tasks = (db.tasksFor ? db.tasksFor(e.id) : []) || [];
    var actions = el('div.flex.gap-1.items-center.flex-wrap', { style: { marginLeft: 'auto' } });
    if (canCreate()) actions.appendChild(el('button.btn.btn-sm.btn-outline', { html: ui.icon('pencil') + ' Edit', onclick: function () { m.close(); empForm(e); } }));
    actions.appendChild(el('button.btn.btn-sm.btn-primary', { html: ui.icon('printer') + ' Profile', onclick: function () { empPrint(e); } }));
    actions.appendChild(ui.rowActions(ui.actions({
      wa: { phone: e.phone, text: empMsg(e) }, gmail: { to: e.email, subject: 'Epal Travels — HR', body: empMsg(e) },
      profile: { name: e.name, card: { title: e.name, subtitle: e.designation + ' · ' + e.dept, lines: [
        ['Salary', ui.money(e.salary || 0)], ['Attendance', attRate(e) + '%'], ['Rating', (e.rating || 0).toFixed(1)], ['Tenure', tenureYears(e) + ' yrs'], ['Phone', e.phone || '—'], ['Email', e.email || '—'] ] }, pdf: function () { empPrint(e); } }
    })));

    body.appendChild(el('div.card', null, [ el('div.card-body', null, [
      el('div.flex.items-center.gap-2.flex-wrap.mb-3', null, [
        e.photo ? ui.frag('<span class="avatar" style="width:46px;height:46px;background-image:url(' + e.photo + ');background-size:cover;background-position:center"></span>')
                : ui.frag('<span class="avatar" style="width:46px;height:46px;font-size:16px;background:' + ui.colorFor(e.name) + '">' + ui.initials(e.name) + '</span>'),
        el('div.flex-1', { style: { minWidth: '200px' } }, [ el('div.fw-700', { style: { fontSize: '17px' }, text: e.name }),
          el('div.flex.items-center.gap-2.flex-wrap', null, [
            el('div.text-mute.sm', { text: e.designation + ' · ' + e.dept }),
            el('span.badge', { text: cap(e.role || 'employee') }),
            el('span.badge.badge-' + (e.status === 'active' ? 'good' : 'warn'), { text: e.status === 'active' ? 'Active' : 'On Leave' }),
            el('span.badge.badge-warn', { html: ui.icon('star-fill') + ' ' + (e.rating || 0).toFixed(1) })
          ]) ]),
        actions
      ]),
      el('div.stat-row', null, [
        st2('Salary', ui.money(e.salary || 0)), st2('Attendance', attRate(e) + '%'), st2('Tenure', tenureYears(e) + ' yrs'), st2('Net Pay', ui.money(ps.net))
      ])
    ]) ]));

    // attendance breakdown
    body.appendChild(el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon('calendar-check') + ' Attendance — this period' }) ]),
      el('div.card-body', null, [ el('div.kpi-grid.kpi-compact', null, [
        miniStat('Present', a.present, '#23c17e'), miniStat('Absent', a.absent, '#f0506e'),
        miniStat('Late', a.late, '#f4b740'), miniStat('Leave', a.leave, '#7b5cff')
      ]) ])
    ]));

    // profile facts
    body.appendChild(el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon('person-vcard') + ' Employee Details' }) ]),
      el('div.card-body', null, [ el('div.data-list', null, [
        drow('Employee ID', e.id), drow('Department', e.dept), drow('Designation', e.designation), drow('Role', cap(e.role || 'employee')),
        drow('Join date', e.joinDate ? ui.date(e.joinDate) : '—'), drow('Phone', e.phone), drow('Email', e.email),
        drow('Assigned tasks', tasks.length ? String(tasks.length) : '0')
      ]) ])
    ]));

    // leave history
    if (lv.length) {
      var lt = EPAL.table({
        columns: [ { key: 'type', label: 'Type', badge: {} }, { key: 'from', label: 'From', date: true }, { key: 'to', label: 'To', date: true },
          { key: 'days', label: 'Days', num: true }, { key: 'status', label: 'Status', badge: { Approved: 'good', Pending: 'warn', Rejected: 'bad' } } ],
        rows: lv, pageSize: 6, empty: { icon: 'calendar', title: 'No leave' }
      });
      body.appendChild(el('div.card', null, [ el('div.card-head', null, [ el('h3', { html: ui.icon('calendar2-week') + ' Leave History' }), el('span.card-sub', { text: lv.reduce(function (x, l) { return x + (l.status === 'Approved' ? l.days : 0); }, 0) + ' days taken' }) ]), el('div.card-body', null, [ lt.el ]) ]));
    }
    if (EPAL.comments && EPAL.comments.widget) { body.appendChild(el('div.section-label', { text: 'Reviews & Notes' })); body.appendChild(EPAL.comments.widget('employee', e.id)); }
  }

  /* ---- add / edit employee ----------------------------------------------*/
  function empForm(e) {
    var isNew = !e;
    EPAL.formModal({
      title: isNew ? 'Add Employee' : 'Edit Employee', icon: 'person-badge', size: 'lg', record: e || { status: 'active', role: 'employee', dept: 'Air Ticketing' },
      fields: [
        { type: 'section', label: 'Identity' },
        { key: 'photo', label: 'Profile picture', type: 'image', icon: 'person', col2: true, round: true },
        { key: 'name', label: 'Full name', type: 'text', required: true, col2: true, placeholder: 'e.g. Arif Hasan' },
        { key: 'dept', label: 'Department', type: 'select', options: DEPTS, default: 'Air Ticketing', required: true },
        { key: 'designation', label: 'Designation', type: 'text', placeholder: 'e.g. Ticketing Officer' },
        { key: 'role', label: 'ERP role', type: 'select', options: ROLES, default: 'employee' },
        { type: 'section', label: 'Contact' },
        { key: 'email', label: 'Email', type: 'email' },
        { key: 'phone', label: 'Phone', type: 'phone' },
        { type: 'section', label: 'Employment' },
        { key: 'joinDate', label: 'Join date', type: 'date' },
        { key: 'status', label: 'Status', type: 'select', options: ['active', 'on-leave'], default: 'active' },
        { key: 'salary', label: 'Monthly salary (৳)', type: 'money', default: 40000, min: 0 },
        { key: 'rating', label: 'Rating (0–5)', type: 'number', default: 4, min: 0, max: 5 },
        { type: 'section', label: 'ERP Access' },
        { key: 'createLogin', label: 'Give this employee an ERP login', type: 'checkbox', col2: true,
          hint: 'Provisions a role-scoped user (RBAC enforced by the backend later).' },
        { key: 'loginEmail', label: 'Login email', type: 'email', showIf: function (x) { return x.createLogin; } },
        { key: 'loginPassword', label: 'Password', type: 'password', showIf: function (x) { return x.createLogin; } }
      ],
      saveLabel: isNew ? 'Add Employee' : 'Save',
      onSave: function (val) {
        var r = e || { id: 'EPL-' + ui.uid('').slice(-4).toUpperCase(), companyId: CID, attendance: { present: 22, absent: 0, late: 0, leave: 0 } };
        r.name = (val.name || '').trim(); r.dept = val.dept; r.designation = val.designation || (DESIGN[val.dept] || ['Executive'])[0];
        r.role = val.role || 'employee'; r.email = val.email; r.phone = val.phone; r.joinDate = val.joinDate;
        r.status = val.status || 'active'; r.salary = +val.salary || 0; r.rating = +val.rating || 0; r.photo = val.photo || '';
        r.companyId = CID;
        if (val.createLogin && (val.loginEmail || r.email)) { r.login = { email: val.loginEmail || r.email, role: r.role, enabled: true }; provisionUser(r, val.loginPassword); }
        if (db.saveEmployee) db.saveEmployee(r); else db.save('employees', r);
        ui.toast('Employee "' + r.name + '" saved', 'success');
        EPAL.router.render();
        return true;
      }
    });
  }
  function provisionUser(rec, password) {
    var u = { id: 'USR-' + String(rec.id).replace(/[^0-9A-Za-z]/g, ''), name: rec.name, email: (rec.login && rec.login.email) || rec.email || '',
      role: rec.role || 'employee', scope: CID, photo: rec.photo || '', phone: rec.phone || '', status: 'Active',
      designation: rec.designation || '', createdAt: Date.now() };
    if (password) u.password = password;
    try { db.save('erp_users', u); } catch (x) {}
  }
  function deleteEmp(e) {
    ui.confirm({ title: 'Remove ' + e.name + '?', text: 'Removes them from the Travels roster.', danger: true, confirmLabel: 'Remove' })
      .then(function (ok) { if (!ok) return; db.remove('employees', e.id); ui.toast(e.name + ' removed', 'success'); EPAL.router.render(); });
  }
  function empPrint(e) {
    var ps = payslip(e);
    function r(k, v) { return '<tr><td>' + esc(k) + '</td><td>' + esc(String(v == null || v === '' ? '—' : v)) + '</td></tr>'; }
    ui.printDoc({ title: 'Employee Profile — ' + e.name, subtitle: 'Epal Travels & Consultancy · Human Resources', meta: e.designation + ' · ' + e.dept, footer: 'Confidential — HR',
      bodyHtml: '<table><tr><th>Field</th><th>Value</th></tr>' + r('Employee ID', e.id) + r('Department', e.dept) + r('Designation', e.designation) +
        r('Role', cap(e.role || 'employee')) + r('Join date', e.joinDate) + r('Phone', e.phone) + r('Email', e.email) +
        r('Attendance', attRate(e) + '%') + r('Rating', (e.rating || 0).toFixed(1)) + r('Monthly gross', ui.money(ps.gross)) + r('Net pay', ui.money(ps.net)) + '</table>' });
  }
  function empMsg(e) { return 'Dear ' + e.name + ',\n\nThis is a message from Epal Travels & Consultancy HR. Please reach out if you have any questions regarding your record.\n\nWarm regards,\nHuman Resources'; }

  /* ======================================================= ATTENDANCE */
  function attendanceView(page) {
    var t = team();
    var tot = t.reduce(function (a, e) { var x = att(e); a.present += x.present || 0; a.absent += x.absent || 0; a.late += x.late || 0; a.leave += x.leave || 0; return a; }, { present: 0, absent: 0, late: 0, leave: 0 });
    var avgRate = t.length ? Math.round(t.reduce(function (a, e) { return a + attRate(e); }, 0) / t.length) : 0;
    page.appendChild(el('div.kpi-grid.kpi-compact.stagger', null, [
      kpi('Avg Attendance', avgRate + '%', 'check2-circle', avgRate >= 90 ? 'text-good' : 'text-warn'),
      kpi('Present (Σ)', String(tot.present), 'person-check', 'text-good'),
      kpi('Absent (Σ)', String(tot.absent), 'person-x', tot.absent ? 'text-bad' : ''),
      kpi('Late (Σ)', String(tot.late), 'clock', tot.late ? 'text-warn' : ''),
      kpi('On Leave (Σ)', String(tot.leave), 'calendar2-x')
    ]));

    var chartId = ui.uid('att');
    page.appendChild(chartCard('Attendance by Employee', 'bar-chart', chartId, 'present vs absent + late', 260));
    requestAnimationFrame(function () {
      var c = document.getElementById(chartId); if (!c) return;
      EPAL.charts.bar(c, { labels: t.map(function (e) { return e.name.split(' ')[0]; }), stacked: true, money: false, legend: true,
        datasets: [ { label: 'Present', data: t.map(function (e) { return att(e).present; }), color: '#23c17e' },
          { label: 'Absent', data: t.map(function (e) { return att(e).absent; }), color: '#f0506e' },
          { label: 'Late', data: t.map(function (e) { return att(e).late; }), color: '#f4b740' } ] });
    });

    var rows = t.map(function (e) { var a = att(e); return { id: e.id, name: e.name, dept: e.dept, present: a.present, absent: a.absent, late: a.late, leave: a.leave, rate: attRate(e), _e: e }; });
    var tbl = EPAL.table({
      columns: [
        { key: 'name', label: 'Employee', render: function (r) { return avatarCell(r._e); } },
        { key: 'dept', label: 'Dept', badge: {} },
        { key: 'present', label: 'Present', num: true }, { key: 'absent', label: 'Absent', num: true, render: function (r) { return r.absent ? '<span class="text-bad">' + r.absent + '</span>' : '0'; } },
        { key: 'late', label: 'Late', num: true, render: function (r) { return r.late ? '<span class="text-warn">' + r.late + '</span>' : '0'; } },
        { key: 'leave', label: 'Leave', num: true },
        { key: 'rate', label: 'Rate', num: true, render: function (r) { return '<span class="num ' + (r.rate >= 90 ? 'text-good' : r.rate >= 80 ? '' : 'text-warn') + '">' + r.rate + '%</span>'; } }
      ],
      rows: rows, searchKeys: ['name', 'dept'], quickFilter: 'dept', filterPanel: true,
      exportName: 'travels-attendance.csv', pdfTitle: 'Travels Attendance', onRow: function (r) { empDetail(r._e); },
      empty: { icon: 'calendar-check', title: 'No attendance data' }
    });
    page.appendChild(el('div.card', null, [ el('div.card-body', null, [ tbl.el ]) ]));
  }

  /* ======================================================= LEAVES */
  function leavesView(page) {
    var all = leaves().filter(function (l) { return team().some(function (e) { return e.id === l.empId; }); });
    var pending = all.filter(function (l) { return l.status === 'Pending'; });
    var approved = all.filter(function (l) { return l.status === 'Approved'; });
    var onLeaveNow = team().filter(function (e) { return e.status === 'on-leave'; }).length;
    var totalDays = approved.reduce(function (a, l) { return a + (l.days || 0); }, 0);
    page.appendChild(el('div.kpi-grid.kpi-compact.stagger', null, [
      kpi('Pending', String(pending.length), 'hourglass-split', pending.length ? 'text-warn' : ''),
      kpi('Approved', String(approved.length), 'check2-circle', 'text-good'),
      kpi('On Leave Now', String(onLeaveNow), 'calendar2-x'),
      kpi('Days Taken', String(totalDays), 'calendar-week'),
      kpi('Requests', String(all.length), 'card-list')
    ]));
    if (pending.length) page.appendChild(el('div.build-banner.mb-3', null, [ ui.frag(ui.icon('hourglass-split')),
      el('div', { html: '<strong>' + pending.length + ' leave request' + (pending.length === 1 ? '' : 's') + ' awaiting approval.</strong> ' +
        pending.slice(0, 5).map(function (l) { return esc(l.empName) + ' (' + l.days + 'd ' + l.type + ')'; }).join(', ') }) ]));

    var tbl = EPAL.table({
      columns: [
        { key: 'empName', label: 'Employee', render: function (l) { return '<span class="strong">' + esc(l.empName) + '</span>'; } },
        { key: 'type', label: 'Type', badge: {} },
        { key: 'from', label: 'From', date: true }, { key: 'to', label: 'To', date: true },
        { key: 'days', label: 'Days', num: true },
        { key: 'reason', label: 'Reason', render: function (l) { return esc(l.reason || '—'); } },
        { key: 'status', label: 'Status', badge: { Approved: 'good', Pending: 'warn', Rejected: 'bad' } }
      ],
      rows: all, searchKeys: ['empName', 'type', 'reason'], quickFilter: 'status', filterPanel: true, filters: [{ key: 'type', label: 'Type' }],
      dateKey: 'from', exportName: 'travels-leaves.csv', pdfTitle: 'Travels Leave Register',
      onRow: function (l) { leaveDetail(l); },
      actions: ui.actions({
        edit: canCreate() ? function (l) { leaveForm(l); } : null,
        del:  canDelete() ? function (l) { ui.confirm({ title: 'Delete leave record?', danger: true, confirmLabel: 'Delete' }).then(function (ok) { if (ok) { S.removeFrom('tv_leaves', l.id); ui.toast('Deleted', 'success'); EPAL.router.render(); } }); } : null
      }),
      empty: { icon: 'calendar2-week', title: 'No leave records', hint: 'Apply for leave to populate the register.' }
    });
    page.appendChild(el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon('calendar2-week') + ' Leave Register' }), el('span.card-sub', { text: all.length + ' requests · click to review' }) ]),
      el('div.card-body', null, [ tbl.el ])
    ]));
  }
  function leaveDetail(l) {
    var body = el('div');
    var m = ui.modal({ title: l.empName + ' · ' + l.type + ' Leave', icon: 'calendar2-week', size: 'md', body: body, footer: false });
    var actions = el('div.flex.gap-1.items-center.flex-wrap', { style: { marginLeft: 'auto' } });
    if (canCreate() && l.status === 'Pending') {
      actions.appendChild(el('button.btn.btn-sm.btn-primary', { html: ui.icon('check2') + ' Approve', onclick: function () { setLeaveStatus(l, 'Approved'); m.close(); } }));
      actions.appendChild(el('button.btn.btn-sm.btn-outline', { html: ui.icon('x') + ' Reject', onclick: function () { setLeaveStatus(l, 'Rejected'); m.close(); } }));
    }
    if (canCreate()) actions.appendChild(el('button.btn.btn-sm.btn-ghost', { html: ui.icon('pencil') + ' Edit', onclick: function () { m.close(); leaveForm(l); } }));
    body.appendChild(el('div.card', null, [ el('div.card-body', null, [
      el('div.flex.items-center.gap-2.flex-wrap.mb-3', null, [
        ui.frag('<span class="notif-ico notif-' + (l.status === 'Approved' ? 'success' : l.status === 'Rejected' ? 'error' : 'warning') + '">' + ui.icon('calendar2-week') + '</span>'),
        el('div.flex-1', { style: { minWidth: '160px' } }, [ el('div.fw-700', { style: { fontSize: '17px' }, text: l.empName }),
          el('div.flex.items-center.gap-2.flex-wrap', null, [ el('span.badge', { text: l.type }), el('span.badge.badge-' + (l.status === 'Approved' ? 'good' : l.status === 'Rejected' ? 'bad' : 'warn'), { text: l.status }) ]) ]),
        actions
      ]),
      el('div.stat-row', null, [ st2('From', ui.date(l.from)), st2('To', ui.date(l.to)), st2('Days', String(l.days)), st2('Applied', l.applied ? ui.date(l.applied) : '—') ]),
      l.reason ? el('p.text-mute.mt-2', { text: 'Reason: ' + l.reason }) : null
    ]) ]));
  }
  function setLeaveStatus(l, status) { l.status = status; S.upsert('tv_leaves', l); ui.toast('Leave ' + status.toLowerCase(), 'success'); EPAL.router.render(); }
  function leaveForm(l) {
    var isNew = !l;
    var t = team();
    EPAL.formModal({
      title: isNew ? 'Apply for Leave' : 'Edit Leave', icon: 'calendar2-plus', size: 'md', record: l || { status: 'Pending', from: TODAY_STR, to: TODAY_STR },
      fields: [
        { key: 'empId', label: 'Employee', type: 'select', required: true, options: t.map(function (e) { return [e.id, e.name + ' · ' + e.dept]; }) },
        { key: 'type', label: 'Leave type', type: 'select', options: LEAVE_TYPES, default: 'Annual', required: true },
        { key: 'from', label: 'From', type: 'date', required: true, default: TODAY_STR },
        { key: 'to', label: 'To', type: 'date', required: true, default: TODAY_STR },
        { key: 'status', label: 'Status', type: 'select', options: LEAVE_STATUS, default: 'Pending' },
        { key: 'reason', label: 'Reason', type: 'textarea', col2: true }
      ],
      saveLabel: isNew ? 'Submit' : 'Save',
      onSave: function (val) {
        var days = Math.max(1, Math.round((new Date(val.to).getTime() - new Date(val.from).getTime()) / 86400000) + 1);
        var emp = db.employee ? db.employee(val.empId) : t.filter(function (e) { return e.id === val.empId; })[0];
        var r = l || { id: 'LV-' + ui.uid('').slice(-5).toUpperCase(), applied: TODAY_STR };
        r.empId = val.empId; r.empName = emp ? emp.name : val.empId; r.type = val.type; r.from = val.from; r.to = val.to;
        r.days = days; r.status = val.status || 'Pending'; r.reason = val.reason;
        S.upsert('tv_leaves', r);
        ui.toast('Leave ' + (isNew ? 'submitted' : 'saved'), 'success'); EPAL.router.render();
        return true;
      }
    });
  }

  /* ======================================================= PAYROLL */
  function payrollView(page) {
    var t = team();
    var ym = curYm();
    var rows = t.map(function (e) { var ps = payslip(e); return Object.assign({ id: e.id, name: e.name, dept: e.dept, _e: e }, ps); });
    var gross = rows.reduce(function (a, r) { return a + r.gross; }, 0);
    var ded = rows.reduce(function (a, r) { return a + r.deductions; }, 0);
    var net = rows.reduce(function (a, r) { return a + r.net; }, 0);
    var posted = payrollPosted(ym);

    page.appendChild(el('div.kpi-grid.kpi-compact.stagger', null, [
      kpi('Headcount', String(t.length), 'people'),
      kpi('Gross Payroll', ui.money(gross, { compact: true }), 'cash-stack'),
      kpi('Deductions', ui.money(ded, { compact: true }), 'dash-circle', 'text-warn'),
      kpi('Net Payable', ui.money(net, { compact: true }), 'wallet2', 'text-good'),
      kpi('Status', posted ? 'Posted' : 'Draft', posted ? 'check2-circle' : 'hourglass', posted ? 'text-good' : 'text-warn')
    ]));

    page.appendChild(el('div.card.mb-3', null, [ el('div.card-body', null, [
      el('div.flex.justify-between.items-center.flex-wrap.gap-2', null, [
        el('div', null, [ el('div.fw-700', { text: 'Payroll — ' + mLabel(ym) + ' ' + ym.slice(0, 4) }),
          el('div.text-mute.sm', { text: posted ? 'This month is posted to the ledger (DR Salaries / CR Bank).' : 'Review the payslips, then run payroll to post salaries to the ledger.' }) ]),
        canCreate() ? el('button.btn.btn-primary' + (posted ? '.btn-outline' : ''), { disabled: posted, html: ui.icon('play-circle') + (posted ? ' Payroll Posted' : ' Run Payroll'), onclick: function () { runPayroll(ym, gross); } }) : null
      ])
    ]) ]));

    var tbl = EPAL.table({
      columns: [
        { key: 'name', label: 'Employee', render: function (r) { return avatarCell(r._e); } },
        { key: 'dept', label: 'Dept', badge: {} },
        { key: 'basic', label: 'Basic', num: true, money: true },
        { key: 'house', label: 'House', num: true, money: true },
        { key: 'gross', label: 'Gross', num: true, money: true },
        { key: 'deductions', label: 'Deductions', num: true, render: function (r) { return r.deductions ? '<span class="text-warn">' + ui.money(r.deductions) + '</span>' : '—'; }, sortVal: function (r) { return r.deductions; } },
        { key: 'net', label: 'Net Pay', num: true, render: function (r) { return '<span class="num strong text-good">' + ui.money(r.net) + '</span>'; }, sortVal: function (r) { return r.net; } }
      ],
      rows: rows, searchKeys: ['name', 'dept'], quickFilter: 'dept', filterPanel: true,
      exportName: 'travels-payroll-' + ym + '.csv', pdfTitle: 'Travels Payroll — ' + mLabel(ym),
      onRow: function (r) { payslipModal(r._e); },
      actions: ui.actions({ print: function (r) { payslipPrint(r._e); } }),
      empty: { icon: 'cash-stack', title: 'No employees to pay' }
    });
    page.appendChild(el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon('cash-stack') + ' Payslips' }), el('span.card-sub', { text: 'click a row for the full payslip' }) ]),
      el('div.card-body', null, [ tbl.el ])
    ]));
  }
  function payrollPosted(ym) { try { return !!(EPAL.ledger && EPAL.ledger.entries && EPAL.ledger.entries({ companyId: CID }).some(function (g) { return g.id === 'GL-PAY-' + CID + '-' + ym; })); } catch (x) { return false; } }
  function runPayroll(ym, gross) {
    ui.confirm({ title: 'Run payroll for ' + mLabel(ym) + '?', text: 'Posts ' + ui.money(gross) + ' to the ledger: DR 5100 Salaries / CR 1010 Bank.', confirmLabel: 'Run Payroll' })
      .then(function (ok) {
        if (!ok) return;
        if (!EPAL.ledger || !EPAL.ledger.post) { ui.toast('Ledger engine unavailable', 'error'); return; }
        try {
          EPAL.ledger.post({ id: 'GL-PAY-' + CID + '-' + ym, date: TODAY_STR, companyId: CID, ref: 'PAY-' + ym,
            memo: 'Payroll — ' + mLabel(ym) + ' ' + ym.slice(0, 4), source: 'payroll', party: '',
            lines: [ { account: '5100', dr: gross, cr: 0 }, { account: '1010', dr: 0, cr: gross } ] });
          ui.toast('Payroll posted to the ledger', 'success'); EPAL.router.render();
        } catch (e) { ui.toast(e.message || 'Payroll posting failed', 'error'); }
      });
  }
  function payslipModal(e) {
    var ps = payslip(e), body = el('div');
    ui.modal({ title: 'Payslip — ' + e.name, icon: 'receipt', size: 'md', body: body, footer: false });
    body.appendChild(el('div.card', null, [ el('div.card-body', null, [
      el('div.flex.items-center.gap-2.mb-3', null, [ ui.frag(avatarCell(e)), el('div.flex-1'),
        el('button.btn.btn-sm.btn-primary', { html: ui.icon('printer') + ' Print', onclick: function () { payslipPrint(e); } }) ]),
      el('div.data-list', null, [
        drow('Basic', ui.money(ps.basic)), drow('House rent', ui.money(ps.house)), drow('Medical', ui.money(ps.medical)), drow('Transport', ui.money(ps.transport)),
        el('div.data-row', null, [ el('div.text-mute.sm.flex-1', { text: 'Gross' }), el('div.strong', { text: ui.money(ps.gross) }) ]),
        drow('Income tax', '−' + ui.money(ps.tax)), drow('Provident fund', '−' + ui.money(ps.pf)),
        el('div.data-row', null, [ el('div.strong.flex-1', { text: 'Net Pay' }), el('div.strong.text-good', { text: ui.money(ps.net) }) ])
      ])
    ]) ]));
  }
  function payslipPrint(e) {
    var ps = payslip(e);
    function r(k, v, neg) { return '<tr><td>' + esc(k) + '</td><td>' + (neg ? '−' : '') + ui.money(v) + '</td></tr>'; }
    ui.printDoc({ title: 'Payslip — ' + e.name, subtitle: 'Epal Travels & Consultancy · Payroll', meta: e.designation + ' · ' + e.dept + ' · ' + mLabel(curYm()) + ' ' + curYm().slice(0, 4), footer: 'System-generated payslip — Confidential',
      bodyHtml: '<table><tr><th>Component</th><th>Amount</th></tr>' + r('Basic', ps.basic) + r('House rent', ps.house) + r('Medical', ps.medical) + r('Transport', ps.transport) +
        '<tr><th>Gross</th><th>' + ui.money(ps.gross) + '</th></tr>' + r('Income tax', ps.tax, true) + r('Provident fund', ps.pf, true) +
        '<tr><th>Net Pay</th><th>' + ui.money(ps.net) + '</th></tr></table>' });
  }

  /* ======================================================= PERFORMANCE */
  function performanceView(page) {
    var t = team();
    var avg = t.length ? (t.reduce(function (a, e) { return a + (+e.rating || 0); }, 0) / t.length) : 0;
    var top = t.slice().sort(function (a, b) { return (b.rating || 0) - (a.rating || 0); })[0];
    var buckets = { '4.5–5 · Excellent': 0, '4–4.5 · Strong': 0, '3–4 · Good': 0, 'Below 3 · Needs support': 0 };
    t.forEach(function (e) { var r = +e.rating || 0; if (r >= 4.5) buckets['4.5–5 · Excellent']++; else if (r >= 4) buckets['4–4.5 · Strong']++; else if (r >= 3) buckets['3–4 · Good']++; else buckets['Below 3 · Needs support']++; });

    page.appendChild(el('div.kpi-grid.kpi-compact.stagger', null, [
      kpi('Avg Rating', avg.toFixed(1), 'star-fill'),
      kpi('Top Performer', top ? top.name.split(' ')[0] : '—', 'trophy'),
      kpi('Excellent', String(buckets['4.5–5 · Excellent']), 'award', 'text-good'),
      kpi('Needs Support', String(buckets['Below 3 · Needs support']), 'life-preserver', buckets['Below 3 · Needs support'] ? 'text-warn' : '')
    ]));

    var chartId = ui.uid('perf');
    page.appendChild(chartCard('Rating Distribution', 'bar-chart-steps', chartId, 'team by band', 240));
    requestAnimationFrame(function () { var c = document.getElementById(chartId); if (!c) return;
      EPAL.charts.bar(c, { labels: Object.keys(buckets), horizontal: true, money: false, datasets: [{ label: 'Employees', data: Object.keys(buckets).map(function (k) { return buckets[k]; }), color: '#1A43BF' }] }); });

    var tbl = EPAL.table({
      columns: [
        { key: 'name', label: 'Employee', render: function (e) { return avatarCell(e); } },
        { key: 'designation', label: 'Designation' }, { key: 'dept', label: 'Dept', badge: {} },
        { key: 'rating', label: 'Rating', num: true, sortVal: function (e) { return +e.rating || 0; }, render: function (e) { var r = +e.rating || 0; return '<span class="num ' + (r >= 4.5 ? 'text-good' : r < 3 ? 'text-warn' : '') + '">' + r.toFixed(1) + ' ★</span>'; } },
        { key: 'rate', label: 'Attendance', num: true, sortVal: function (e) { return attRate(e); }, render: function (e) { return attRate(e) + '%'; } },
        { key: 'tenure', label: 'Tenure', num: true, sortVal: function (e) { return tenureYears(e); }, render: function (e) { return tenureYears(e) + ' yrs'; } }
      ],
      rows: t, searchKeys: ['name', 'designation', 'dept'], quickFilter: 'dept', filterPanel: true,
      exportName: 'travels-performance.csv', pdfTitle: 'Travels Performance', onRow: function (e) { empDetail(e); },
      empty: { icon: 'star', title: 'No performance data' }
    });
    page.appendChild(el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon('graph-up-arrow') + ' Performance Review' }), el('span.card-sub', { text: 'click a row to add a review note' }) ]),
      el('div.card-body', null, [ tbl.el ])
    ]));
  }

  /* ---------------------------------------------------- helpers */
  function canCreate() { return !EPAL.perm || EPAL.perm.can('travels', 'hrm', 'create'); }
  function canDelete() { return !EPAL.perm || EPAL.perm.can('travels', 'hrm', 'delete'); }
  function esc(s) { return ui.escapeHtml(String(s == null ? '' : s)); }
  function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }
  function curYm() { return TODAY.getFullYear() + '-' + String(TODAY.getMonth() + 1).padStart(2, '0'); }
  function mLabel(ym) { var p = ym.split('-'); return new Date(p[0], p[1] - 1, 1).toLocaleString('en', { month: 'long' }); }
  function kpi(label, value, icon, tone) {
    return el('div.kpi-card', null, [
      el('div.kpi-top', null, [ el('span.kpi-label', { text: label }), el('span.kpi-ico', { html: '<i class="bi bi-' + icon + '"></i>' }) ]),
      el('div.kpi-value' + (tone ? '.' + tone : ''), { text: String(value) })
    ]);
  }
  function kpiDrill(label, value, icon, route, foot) {
    return el('div.kpi-card.drill', { onclick: function () { EPAL.router.navigate(route); } }, [
      el('div.kpi-top', null, [ el('span.kpi-label', { text: label }), el('span.kpi-ico', { html: '<i class="bi bi-' + icon + '"></i>' }) ]),
      el('div.kpi-value', { text: String(value) }), foot ? el('div.kpi-foot', null, [ el('span.text-muted', { text: foot }) ]) : null
    ]);
  }
  function miniStat(label, value, color) {
    return el('div.kpi-card', null, [ el('div.kpi-top', null, [ el('span.kpi-label', { text: label }) ]),
      el('div.kpi-value', { style: { color: value > 0 ? color : 'inherit' }, text: String(value) }) ]);
  }
  function st2(l, v) { return el('div.stat', null, [ el('div.stat-label', { text: l }), el('div.stat-value', { text: v }) ]); }
  function drow(k, v) { return el('div.data-row', null, [ el('div.text-mute.sm.flex-1', { text: k }), el('div.strong', { text: v == null || v === '' ? '—' : String(v) }) ]); }
  function chartCard(title, icon, canvasId, subLabel, height) {
    return el('div.card', null, [ el('div.card-head', null, [ el('h3', { html: ui.icon(icon) + ' ' + title }), subLabel ? el('span.card-sub', { text: subLabel }) : null ]),
      el('div.card-body', null, [ el('div', { style: { height: (height || 260) + 'px', position: 'relative' } }, [ el('canvas', { id: canvasId }) ]) ]) ]);
  }

})(window.EPAL = window.EPAL || {});
