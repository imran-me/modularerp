/* ============================================================================
 * EPAL GROUP ERP  ·  views/admin/employees.js
 * ----------------------------------------------------------------------------
 * WORKFORCE / EMPLOYEE MANAGEMENT — the group-wide people system.
 *
 * One view serves every sub-route under Group ▸ Workforce:
 *   directory   → searchable employee card grid (+ add/edit, profile drawer)
 *   attendance  → present / absent / late / leave matrix
 *   leaves      → leave balances + requests
 *   payroll     → salary sheet with deductions/net + run-payroll
 *   performance → ratings + task throughput
 *   org-chart   → company → department → people
 *
 * From a profile the admin can DOWNLOAD a documentation-grade report (used for
 * liability/records), open the employee's task board, and edit details.
 * ==========================================================================*/

(function (EPAL) {
  'use strict';
  var ui = EPAL.ui, el = ui.el, db = EPAL.db, S = EPAL.store;
  function esc(s) { return ui.escapeHtml(String(s == null ? '' : s)); }
  function canManage() { return !EPAL.perm || EPAL.perm.can('group', 'employees', 'create') || (EPAL.auth && EPAL.auth.isAdmin && EPAL.auth.isAdmin()); }

  /* ---- workforce constants + new-store seed ----------------------------- */
  var LEAVE_TYPES = ['Casual', 'Sick', 'Annual', 'Unpaid'];
  var ANNUAL_QUOTA = 20;                       // default annual leave days / yr

  var LEAVE_SEED = [
    { id:'LV-2001', empId:'EPL-DEV1', type:'Sick',   from:'2026-06-12', to:'2026-06-13', days:2, reason:'Fever — rest advised by doctor.',            status:'Approved', created:'2026-06-10' },
    { id:'LV-2002', empId:'EPL-0002', type:'Casual', from:'2026-06-20', to:'2026-06-20', days:1, reason:'Family matter at home.',                     status:'Approved', created:'2026-06-18' },
    { id:'LV-2003', empId:'EPL-0005', type:'Annual', from:'2026-07-10', to:'2026-07-14', days:5, reason:'Family trip to Cox’s Bazar.',           status:'Pending',  created:'2026-07-01' },
    { id:'LV-2004', empId:'EPL-0008', type:'Sick',   from:'2026-07-02', to:'2026-07-03', days:2, reason:'Dengue recovery at home.',                   status:'Pending',  created:'2026-07-01' },
    { id:'LV-2005', empId:'EPL-0011', type:'Casual', from:'2026-06-25', to:'2026-06-25', days:1, reason:'Personal errand in Dhaka.',                  status:'Rejected', created:'2026-06-24' },
    { id:'LV-2006', empId:'EPL-0014', type:'Annual', from:'2026-08-01', to:'2026-08-05', days:5, reason:'Eid holiday extension with family.',        status:'Pending',  created:'2026-07-04' },
    { id:'LV-2007', empId:'EPL-0017', type:'Unpaid', from:'2026-07-20', to:'2026-07-24', days:5, reason:'Extended personal leave — no pay.',         status:'Pending',  created:'2026-07-03' },
    { id:'LV-2008', empId:'EPL-0003', type:'Sick',   from:'2026-06-05', to:'2026-06-06', days:2, reason:'Severe migraine.',                           status:'Approved', created:'2026-06-04' }
  ];

  EPAL.registerEngine({ name: 'employees-view-seed', seed: function () {
    S.seedOnce('leave_requests', LEAVE_SEED);
  } });

  // Section band — labels mirror the registry (config.js subs); the default
  // section owns the bare route.
  var SECTIONS = [['directory', 'Directory'], ['attendance', 'Attendance'], ['leaves', 'Leaves'],
    ['payroll', 'Payroll'], ['performance', 'Performance'], ['org-chart', 'Org Chart']];
  function sectionNav(sub) {
    var nav = el('div.tab-underline.mb-3');
    SECTIONS.forEach(function (s) {
      nav.appendChild(el('button' + (sub === s[0] ? '.active' : ''), { text: s[1],
        onclick: function () { EPAL.router.navigate('group/employees' + (s[0] === 'directory' ? '' : '/' + s[0])); } }));
    });
    return nav;
  }

  function view() {
    return { render: function (ctx) {
      if (!EPAL.auth.isAdmin() && EPAL.auth.role() !== 'hr') { ctx.mount.innerHTML = ''; return; }
      var sub = ctx.subId || 'directory';
      var page = el('div.page');
      var titles = { directory:'Employee Directory', attendance:'Attendance', leaves:'Leave Management',
        payroll:'Payroll', performance:'Performance', 'org-chart':'Organisation Chart' };
      page.appendChild(EPAL.pageHead({
        eyebrow:'Workforce', icon:'person-badge-fill', title: titles[sub] || 'Workforce',
        sub:'All ' + db.employees().length + ' people across Epal Group — profiles, time, pay and performance.',
        actions: [
          sub === 'payroll' ? el('button.btn.btn-ghost', { html: ui.icon('download') + ' Salary sheet CSV', onclick: exportPayroll }) : null,
          sub === 'directory' ? el('button.btn.btn-ghost', { html: ui.icon('download') + ' Export CSV', onclick: exportDirectory }) : null,
          sub === 'leaves' ? el('button.btn.btn-primary', { html: ui.icon('calendar-plus') + ' Apply Leave', onclick: function () { applyLeave(function(){ EPAL.router.render(); }); } }) : null,
          sub === 'attendance' ? el('button.btn.btn-primary', { html: ui.icon('clock') + ' Punch / Adjust', onclick: function () { punchModal(null, function(){ EPAL.router.render(); }); } }) : null,
          el('button.btn' + (sub === 'leaves' || sub === 'attendance' ? '.btn-ghost' : '.btn-primary'), { html: ui.icon('person-plus-fill') + ' Add Employee', onclick: function () { editEmployee(null, function(){ EPAL.router.render(); }); } })
        ]
      }));
      // SECTION NAV — the house full-bleed underline band (owner grammar
      // 2026-07-15). Every page-action above is a REAL action (exports, Apply
      // Leave, Punch, Add Employee), so they all stay buttons; only the
      // missing section nav is added.
      page.appendChild(sectionNav(sub));

      if (sub === 'directory') renderDirectory(page);
      else if (sub === 'attendance') renderAttendance(page);
      else if (sub === 'leaves') renderLeaves(page);
      else if (sub === 'payroll') renderPayroll(page);
      else if (sub === 'performance') renderPerformance(page);
      else if (sub === 'org-chart') renderOrg(page);
      else renderDirectory(page);

      ctx.mount.appendChild(page);
    } };
  }

  /* ---- DIRECTORY --------------------------------------------------------*/
  function renderDirectory(page) {
    var state = { q:'', company:'all', status:'all', view:'cards' };
    var companies = EPAL.config.companies;

    // Search + company chips.
    var filters = el('div.flex.items-center.gap-2.flex-wrap.mb-2', null, [
      el('div.search-trigger', { style:{ cursor:'text', minWidth:'240px' } }, [
        ui.frag(ui.icon('search')),
        el('input.input', { placeholder:'Search name, designation, email…', style:{ border:'none', background:'none', padding:'0' },
          oninput: ui.debounce(function (e) { state.q = e.target.value.toLowerCase(); draw(); }, 150) })
      ]),
      el('div.flex.gap-1.scroll-row', null, [{ id:'all', name:'All' }].concat(companies).map(function (c) {
        return el('button.chip' + (c.id === 'all' ? '.active' : ''), { 'data-co': c.id, text: c.short || c.name,
          onclick: function (e) { state.company = c.id; ui.$$('.chip', filters).forEach(function (x){x.classList.remove('active');}); e.target.classList.add('active'); draw(); } });
      }))
    ]);
    page.appendChild(filters);

    // Status filter + view toggle (Cards / List) + Print.
    function statusChip(k, label) {
      return el('button.chip' + (state.status === k ? '.active' : ''), { text: label,
        onclick: function () { state.status = k; ui.$$('.st-chip .chip', bar2).forEach(function (x){x.classList.remove('active');}); this.classList.add('active'); draw(); } });
    }
    function viewBtn(k, icon, title) {
      return el('button.btn.btn-sm' + (state.view === k ? '.btn-primary' : '.btn-outline'), { title: title, html: ui.icon(icon),
        onclick: function () { state.view = k; ui.$$('.vw-btn button', bar2).forEach(function (x){ x.className = 'btn btn-sm btn-outline'; }); this.className = 'btn btn-sm btn-primary'; draw(); } });
    }
    var bar2 = el('div.flex.items-center.gap-2.flex-wrap.mb-3', null, [
      el('span.text-mute.xs', { text: 'Status' }),
      el('div.flex.gap-1.st-chip', null, [ statusChip('all','All'), statusChip('active','Active'), statusChip('onleave','On leave') ]),
      el('div.flex.gap-1.vw-btn', { style:{ marginLeft:'auto' } }, [ viewBtn('cards','grid-3x3-gap-fill','Card view'), viewBtn('list','list-ul','List view') ]),
      el('button.btn.btn-sm.btn-ghost', { html: ui.icon('printer') + ' Print', onclick: function () { printList(filtered()); } })
    ]);
    page.appendChild(bar2);

    var host = el('div');
    page.appendChild(host);

    function filtered() {
      return db.employees().filter(function (e) {
        if (state.company !== 'all' && e.companyId !== state.company) return false;
        if (state.status === 'active' && (e.status || 'active') !== 'active') return false;
        if (state.status === 'onleave' && (e.status || 'active') === 'active') return false;
        if (state.q && (e.name + ' ' + e.designation + ' ' + e.email + ' ' + e.dept).toLowerCase().indexOf(state.q) < 0) return false;
        return true;
      });
    }

    function listView(list) {
      var tbl = EPAL.table({
        columns: [
          { key:'name', label:'Name', render: function (e) { return '<span class="strong">' + esc(e.name) + '</span><div class="text-mute xs">' + esc(e.designation || '') + '</div>'; } },
          { key:'company', label:'Company', render: function (e) { var co = EPAL.config.company(e.companyId) || { short:'Group' }; return '<span class="badge">' + esc(co.short || co.name || 'Group') + '</span>'; }, sortVal: function (e) { return e.companyId; } },
          { key:'dept', label:'Department', render: function (e) { return esc(e.dept || '—'); } },
          { key:'status', label:'Status', render: function (e) { return (e.status || 'active') === 'active' ? '<span class="badge badge-good">Active</span>' : '<span class="badge badge-warn">On leave</span>'; }, sortVal: function (e) { return e.status || 'active'; } },
          { key:'present', label:'Present', num:true, render: function (e) { return String((e.attendance||{}).present||0); }, sortVal: function (e) { return (e.attendance||{}).present||0; } },
          { key:'absent', label:'Absent', num:true, render: function (e) { return String((e.attendance||{}).absent||0); }, sortVal: function (e) { return (e.attendance||{}).absent||0; } },
          { key:'hours', label:'Hours', num:true, render: function (e) { return hoursOf(e) + 'h'; }, sortVal: function (e) { return hoursOf(e); } },
          { key:'overtime', label:'Overtime', num:true, render: function (e) { return (e.overtime||0) + 'h'; }, sortVal: function (e) { return e.overtime||0; } }
        ],
        rows: list, pageSize: 20, exportName: 'employee-directory.csv',
        searchKeys: ['name','designation','email','dept'],
        onRow: function (e) { openProfile(e); },
        actions: canManage() ? [
          { icon:'pencil', title:'Edit', onClick: function (e) { editEmployee(e, function () { EPAL.router.render(); }); } },
          { icon:'trash', title:'Delete employee', onClick: function (e) { deleteEmployee(e); } }
        ] : [],
        empty: { icon:'people', title:'No matches', hint:'Adjust the search or filters.' }
      });
      return el('div.card', null, [ el('div.card-body', null, [tbl.el]) ]);
    }

    function printList(list) {
      var head = '<tr><th>#</th><th>Name</th><th>Designation</th><th>Company</th><th>Department</th><th>Status</th>' +
        '<th style="text-align:right">Present</th><th style="text-align:right">Absent</th><th style="text-align:right">Hours</th><th style="text-align:right">Overtime</th></tr>';
      var body = list.map(function (e, i) {
        var co = EPAL.config.company(e.companyId) || { short:'Group' };
        var a = e.attendance || {};
        return '<tr><td>' + (i+1) + '</td><td>' + esc(e.name) + '</td><td>' + esc(e.designation||'') + '</td><td>' + esc(co.short||co.name||'Group') + '</td>' +
          '<td>' + esc(e.dept||'') + '</td><td>' + ((e.status||'active')==='active'?'Active':'On leave') + '</td>' +
          '<td style="text-align:right">' + (a.present||0) + '</td><td style="text-align:right">' + (a.absent||0) + '</td>' +
          '<td style="text-align:right">' + hoursOf(e) + 'h</td><td style="text-align:right">' + (e.overtime||0) + 'h</td></tr>';
      }).join('');
      var scope = (state.company === 'all' ? 'All companies' : (EPAL.config.company(state.company)||{}).name || state.company) +
        ' · ' + (state.status === 'all' ? 'All' : state.status === 'active' ? 'Active' : 'On leave');
      ui.printDoc({ title:'Employee Directory', subtitle: list.length + ' people · ' + scope,
        meta:'Epal Group — Workforce', footer:'Attendance & hours are for the latest recorded month.',
        bodyHtml:'<table>' + head + body + '</table>' });
    }

    function draw() {
      var list = filtered();
      host.innerHTML = '';
      if (!list.length) { host.appendChild(el('div.empty-state', null, [ ui.frag(ui.icon('search')), el('h3', { text:'No matches' }) ])); return; }
      if (state.view === 'list') { host.appendChild(listView(list)); return; }
      var grid = el('div.grid-auto.stagger', { style: { gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' } });
      list.forEach(function (e) { grid.appendChild(employeeCard(e)); });
      host.appendChild(grid);
    }
    draw();
  }

  function employeeCard(e) {
    var co = EPAL.config.company(e.companyId) || { name:'Group', accent:'var(--gold)', short:'Group' };
    var att = e.attendance || { present:0, absent:0, late:0, leave:0 };
    var card = el('div.card.hover', { style:{ cursor:'pointer' }, onclick: function () { openProfile(e); } }, [
      el('div.card-pad', null, [
        el('div.flex.items-center.gap-2', null, [
          el('div.avatar.lg', { style:{ background: ui.colorFor(e.name) }, text: ui.initials(e.name) }),
          el('div.flex-1.min-w-0', null, [
            el('div.fw-700', { text: e.name }),
            el('div.text-muted.sm', { text: e.designation }),
            el('div.mt-1', null, [ el('span.badge', { style:{ color: co.accent }, html: '<i class="bi bi-' + co.icon + '"></i> ' + co.short }) ])
          ]),
          e.status === 'active' ? el('span.badge.badge-good', { text:'Active' }) : el('span.badge.badge-warn', { text:'On leave' })
        ]),
        el('div.stat-row.mt-3', null, [
          miniStat('Present', att.present),
          miniStat('Absent', att.absent),
          miniStat('Hours', hoursOf(e) + 'h'),
          miniStat('Overtime', (e.overtime || 0) + 'h')
        ])
      ])
    ]);
    return card;
  }
  function miniStat(l, v) { return el('div.stat', null, [ el('div.stat-label', { text:l }), el('div.stat-value', { text:String(v) }) ]); }
  // Monthly worked hours: REAL from the API (check-in/out); in demo mode there
  // is no punch data, so estimate from present days × the 9h standard so the
  // card never shows a bare 0h for a seeded employee.
  function hoursOf(e) { return (e.hours != null) ? e.hours : Math.round((((e.attendance || {}).present) || 0) * 9); }
  // Delete one employee (confirm → API soft-delete via db.remove → wireWrites).
  // Shared by the list-view row action and the profile drawer.
  function deleteEmployee(e) {
    // A super-admin (role admin/owner) is a LOGIN account — deleting it from the
    // workforce soft-deletes the login row and locks everyone out (real incident
    // 2026-07-20). Refuse here too, so the button never fires the guarded API.
    var cur = EPAL.auth.current() || {};
    if (['admin', 'owner'].indexOf(e.role) >= 0) { ui.toast('A super-admin is a login account and cannot be deleted here.', 'error'); return; }
    if (e.id === cur.id || (e.email && e.email === cur.email)) { ui.toast('You cannot delete your own account.', 'error'); return; }
    ui.confirm({ title: 'Delete ' + e.name + '?', text: 'Remove ' + e.name + ' from the directory. This cannot be undone.', danger: true, confirmLabel: 'Delete' })
      .then(function (ok) {
        if (!ok) return;
        db.remove('employees', e.id);
        db.log(EPAL.auth.current().name, 'Deleted employee ' + e.name, e.companyId);
        ui.toast(e.name + ' deleted', 'success');
        EPAL.router.render();
      });
  }

  /* ---- PROFILE DRAWER ---------------------------------------------------*/
  function openProfile(e) {
    var co = EPAL.config.company(e.companyId) || { name:'Group', accent:'var(--gold)' };
    var att = e.attendance || {};
    var tasks = db.tasksFor(e.id);
    var body = el('div');

    // header
    body.appendChild(el('div.flex.items-center.gap-3.mb-3', null, [
      el('div.avatar.lg', { style:{ background: ui.colorFor(e.name), width:'60px', height:'60px', fontSize:'20px' }, text: ui.initials(e.name) }),
      el('div.flex-1', null, [
        el('h3', { text: e.name }),
        el('div.text-muted', { text: e.designation + ' · ' + e.dept }),
        el('div.mt-1.flex.gap-1', null, [
          el('span.badge.badge-accent', { text: co.name }),
          el('span.badge', { text: e.id }),
          el('span.badge' + (e.status === 'active' ? '.badge-good' : '.badge-warn'), { text: e.status })
        ])
      ])
    ]));

    // key stats
    body.appendChild(el('div.stat-row.mb-3', null, [
      miniStat('Present', att.present || 0), miniStat('Absent', att.absent || 0),
      miniStat('Leave', att.leave || 0),
      miniStat('Hours', hoursOf(e) + 'h'), miniStat('Overtime', (e.overtime || 0) + 'h')
    ]));

    // details grid
    body.appendChild(el('div.section-label', { text:'Details' }));
    body.appendChild(el('div.form-grid', null, [
      kv('Email', e.email), kv('Phone', e.phone),
      kv('Company', co.name), kv('Department', e.dept),
      kv('Designation', e.designation), kv('Role', e.role),
      kv('Joined', ui.date(e.joinDate, 'long')), kv('Monthly Salary', ui.money(e.salary))
    ]));

    // task snapshot
    body.appendChild(el('div.section-label', { text:'Task Snapshot' }));
    var by = function (s) { return tasks.filter(function (t){return t.status===s;}).length; };
    body.appendChild(el('div.stat-row', null, [
      miniStat('Total', tasks.length), miniStat('In Progress', by('inprogress')),
      miniStat('Completed', by('done')), miniStat('Cancelled', by('cancelled'))
    ]));

    // discussion thread (HR notes, @mentions notify)
    if (EPAL.comments && EPAL.comments.widget) {
      body.appendChild(el('div.section-label', { text:'Notes & Discussion' }));
      body.appendChild(EPAL.comments.widget('employee', e.id));
    }

    ui.modal({
      title:'Employee Profile', icon:'person-vcard', size:'lg', body: body,
      actions: [
        { label:'Delete', variant:'danger', icon:'trash', onClick: function () { deleteEmployee(e); } },
        { label:'Download Report', variant:'ghost', icon:'file-earmark-arrow-down', keepOpen:true, onClick: function () { downloadProfile(e); } },
        { label:'Open Task Board', variant:'ghost', icon:'kanban', onClick: function () { EPAL.router.navigate('group/tasks', { emp: e.id }); } },
        { label:'Edit', variant:'primary', icon:'pencil', onClick: function () { editEmployee(e, function(){ EPAL.router.render(); }); } }
      ]
    });
  }
  function kv(k, v) { return el('div.field', null, [ el('label', { text:k }), el('div.fw-600', { text: v == null ? '—' : String(v) }) ]); }

  /* ---- ATTENDANCE -------------------------------------------------------*/
  /* Local YYYY-MM-DD for an offset from today (0 = today, -1 = yesterday). */
  function ymd(offset) { var d = new Date(); d.setDate(d.getDate() + (offset || 0)); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); }

  /* DAY-BASIS attendance totals for one date. On the real backend this hits the
   * per-day endpoint (GET group/employees/attendance?date=…); in demo mode it
   * counts the local attendance_log punches for that date. Always calls back. */
  function attendanceDayTotals(date, cb) {
    var zero = { present:0, absent:0, late:0, leave:0 };
    if (EPAL.api && EPAL.api.enabled && EPAL.api.enabled()) {
      EPAL.api.call('group/employees/attendance?date=' + encodeURIComponent(date))
        .then(function (j) { cb((j && j.totals) || zero); }, function () { cb(zero); });
    } else {
      var t = { present:0, absent:0, late:0, leave:0 };
      (db.col ? db.col('attendance_log') : []).forEach(function (r) { if (r.date === date && t[r.status] != null) t[r.status]++; });
      cb(t);
    }
  }

  function renderAttendance(page) {
    var host = el('div');
    page.appendChild(host);
    var selDate = ymd(0);                       // day-basis KPI date — defaults to today
    draw();

    function draw() {
      host.innerHTML = '';
      var emps = db.employees();

      // Day selector — Today / Yesterday / custom date. Drives the KPI strip only
      // (owner: matrix stays month-basis). Present/Absent/Late/On Leave then read
      // the chosen calendar day, not the running month.
      var today = ymd(0), yday = ymd(-1);
      host.appendChild(el('div.flex.items-center.gap-2.mb-3.flex-wrap', null, [
        el('span.text-mute.sm', { text: 'KPIs for' }),
        el('button.btn.btn-sm' + (selDate === today ? '.btn-primary' : '.btn-ghost'), { text: 'Today', onclick: function () { selDate = today; draw(); } }),
        el('button.btn.btn-sm' + (selDate === yday ? '.btn-primary' : '.btn-ghost'), { text: 'Yesterday', onclick: function () { selDate = yday; draw(); } }),
        el('input.input', { type: 'date', value: selDate, max: today, style: { maxWidth: '170px' }, onchange: function (e) { if (e.target.value) { selDate = e.target.value; draw(); } } })
      ]));

      // KPI strip — day-basis. Rendered immediately, filled once the totals resolve
      // (a round-trip on the real backend); a placeholder keeps the layout stable.
      var kgrid = el('div.kpi-grid', null, [
        kpi('Total Present', '…', 'check2-circle'), kpi('Total Absent', '…', 'x-circle'),
        kpi('Late Arrivals', '…', 'alarm'), kpi('On Leave', '…', 'airplane')
      ]);
      host.appendChild(kgrid);
      attendanceDayTotals(selDate, function (t) {
        kgrid.innerHTML = '';
        kgrid.appendChild(kpi('Total Present', t.present, 'check2-circle'));
        kgrid.appendChild(kpi('Total Absent', t.absent, 'x-circle'));
        kgrid.appendChild(kpi('Late Arrivals', t.late, 'alarm'));
        kgrid.appendChild(kpi('On Leave', t.leave, 'airplane'));
      });

      host.appendChild(el('div.flex.justify-between.items-center.mb-2', null, [
        el('div.section-label', { style:{ margin:'0' }, text:'Attendance Matrix · ' + payPeriod() }),
        el('button.btn.btn-primary.btn-sm', { html: ui.icon('clock') + ' Punch / Adjust', onclick: function () { punchModal(null, draw); } })
      ]));
      var t = EPAL.table({
        columns: [
          { key:'name', label:'Employee', render: function (e) { return nameCell(e); } },
          { key:'company', label:'Company', render: function (e) { return (EPAL.config.company(e.companyId)||{short:'Group'}).short; }, sortVal: function (e) { return e.companyId; } },
          { key:'present', label:'Present', num:true, render: function (e) { return numCell((e.attendance||{}).present||0); }, sortVal: function (e) { return (e.attendance||{}).present||0; } },
          { key:'absent', label:'Absent', num:true, render: function (e) { return numCell((e.attendance||{}).absent||0); }, sortVal: function (e) { return (e.attendance||{}).absent||0; } },
          { key:'late', label:'Late', num:true, render: function (e) { return numCell((e.attendance||{}).late||0); }, sortVal: function (e) { return (e.attendance||{}).late||0; } },
          { key:'leave', label:'Leave', num:true, render: function (e) { return numCell((e.attendance||{}).leave||0); }, sortVal: function (e) { return (e.attendance||{}).leave||0; } },
          { key:'rate', label:'Rate', render: function (e) { var a = e.attendance||{}; var rate = Math.round(((a.present||0)/22)*100); return '<span class="badge ' + (rate>=90?'badge-good':rate>=75?'badge-warn':'badge-bad') + '">' + rate + '%</span>'; }, sortVal: function (e) { return (e.attendance||{}).present||0; } }
        ],
        rows: emps, pageSize: 12, exportName:'epal-attendance.csv', searchKeys:['name'],
        actions: [ { icon:'clock-history', title:'Punch / Adjust', onClick: function (e) { punchModal(e, draw); } } ],
        empty: { icon:'calendar', title:'No employees', hint:'Add staff to track attendance.' }
      });
      var card = el('div.card', null, [ el('div.card-body') ]);
      card.querySelector('.card-body').appendChild(t.el);
      host.appendChild(card);
    }
  }

  /* Daily punch / adjust — increments the chosen counter on the employee's
   * attendance object AND appends to the 'attendance_log' store.            */
  function punchModal(preEmp, done) {
    var empOpts = db.employees().map(function (e) { return [e.id, e.name + ' · ' + (EPAL.config.company(e.companyId)||{short:'Group'}).short]; });
    EPAL.formModal({
      title:'Daily Punch / Adjust', icon:'clock', size:'md',
      fields: [
        { key:'empId', label:'Employee', type:'select', required:true, options: empOpts, default: preEmp ? preEmp.id : (empOpts[0] && empOpts[0][0]) },
        { key:'status', label:'Mark as', type:'select', required:true, options:[['present','Present'],['late','Late'],['absent','Absent'],['leave','On Leave']], default:'present' },
        { key:'date', label:'Date', type:'date', default: new Date().toISOString().slice(0,10) },
        { key:'note', label:'Note', type:'text', col2:true, placeholder:'Optional remark (e.g. WFH, medical)' }
      ],
      saveLabel:'Record Punch',
      onSave: function (v) {
        var e = db.employee(v.empId);
        if (!e) { ui.toast('Select an employee', 'error'); return false; }
        e.attendance = e.attendance || { present:0, absent:0, late:0, leave:0 };
        var key = v.status;
        e.attendance[key] = (e.attendance[key] || 0) + 1;
        db.saveEmployee(e);
        var log = { id:'ATL-' + Date.now().toString(36).toUpperCase(), empId:e.id, empName:e.name, companyId:e.companyId,
          date: v.date || new Date().toISOString().slice(0,10), status: key, note:(v.note||'').trim(), at: Date.now() };
        db.save('attendance_log', log);
        db.log((EPAL.auth.current()||{}).name || 'HR', 'Attendance · ' + e.name + ' marked ' + key + ' (' + log.date + ')', e.companyId);
        ui.toast(e.name + ' marked ' + key, 'success');
        done && done();
        return true;
      }
    });
  }

  /* ---- LEAVES · apply → approve workflow --------------------------------*/
  function leaveById(id) { return db.col('leave_requests').filter(function (r) { return r.id === id; })[0]; }
  function nextLeaveId() {
    var max = 2000;
    db.col('leave_requests').forEach(function (r) { var n = parseInt(String(r.id).replace(/[^0-9]/g, ''), 10); if (n > max) max = n; });
    return 'LV-' + (max + 1);
  }
  function dayspan(from, to) {
    if (!from || !to) return 1;
    var d = Math.round((new Date(to) - new Date(from)) / 86400000) + 1;
    return d > 0 ? d : 1;
  }
  function annualQuota() {
    var s = S.get('settings', {}) || {};
    return +s.leaveQuota || +s.annualLeave || ANNUAL_QUOTA;
  }
  function leaveStatusMeta(s) {
    return s === 'Approved' ? ['badge-good', 'Approved'] : s === 'Rejected' ? ['badge-bad', 'Rejected'] : ['badge-warn', 'Pending'];
  }
  function leaveStatusBadge(s) { var m = leaveStatusMeta(s); return '<span class="badge ' + m[0] + '">' + m[1] + '</span>'; }
  function leaveStatusBadgeEl(s) { var m = leaveStatusMeta(s); return el('span.badge.' + m[0], { text: m[1] }); }

  function renderLeaves(page) {
    var host = el('div');
    page.appendChild(host);
    draw();

    function draw() {
      host.innerHTML = '';
      var reqs = db.col('leave_requests').slice().sort(function (a, b) { return (a.created < b.created) ? 1 : -1; });
      var pending = reqs.filter(function (r) { return r.status === 'Pending'; }).length;
      var approved = reqs.filter(function (r) { return r.status === 'Approved'; }).length;
      var daysTaken = reqs.reduce(function (a, r) { return a + (r.status === 'Approved' ? (+r.days || 0) : 0); }, 0);

      host.appendChild(el('div.kpi-grid', null, [
        kpi('Pending Requests', pending, 'hourglass-split'),
        kpi('Approved', approved, 'check2-circle'),
        kpi('Leave Days Taken', daysTaken, 'calendar-check'),
        kpi('Annual Quota', annualQuota() + ' / yr', 'award')
      ]));

      host.appendChild(el('div.flex.justify-between.items-center.mb-2', null, [
        el('div.section-label', { style:{ margin:'0' }, text:'Leave Requests · apply → approve → balance' }),
        el('button.btn.btn-primary.btn-sm', { html: ui.icon('calendar-plus') + ' Apply Leave', onclick: function () { applyLeave(draw); } })
      ]));

      var admin = EPAL.auth.isAdmin();
      var rows = reqs.map(function (r) {
        var e = db.employee(r.empId) || { name: r.empId };
        return { _id:r.id, empId:r.empId, name:e.name, type:r.type, from:r.from, to:r.to, days:r.days, status:r.status, reason:r.reason };
      });
      var t = EPAL.table({
        columns: [
          { key:'name', label:'Employee', render: function (x) { return nameCell(db.employee(x.empId) || { name:x.name }); } },
          { key:'type', label:'Type' },
          { key:'from', label:'From', render: function (x) { return ui.date(x.from); } },
          { key:'to', label:'To', render: function (x) { return ui.date(x.to); } },
          { key:'days', label:'Days', num:true },
          { key:'status', label:'Status', render: function (x) { return leaveStatusBadge(x.status); }, sortVal: function (x) { return x.status; } }
        ],
        rows: rows, pageSize: 10, exportName:'leave-requests.csv',
        filters: [ { key:'status', label:'Status' }, { key:'type', label:'Type' } ],
        searchKeys: ['name', 'type', 'reason'],
        actions: admin ? [
          { icon:'check-lg', title:'Approve', onClick: function (x) { var r = leaveById(x._id); if (r && r.status === 'Pending') decideLeave(r, 'Approved', draw); else ui.toast('Already ' + (r ? r.status.toLowerCase() : 'gone'), 'info'); } },
          { icon:'x-lg', title:'Reject', onClick: function (x) { var r = leaveById(x._id); if (r && r.status === 'Pending') decideLeave(r, 'Rejected', draw); else ui.toast('Already ' + (r ? r.status.toLowerCase() : 'gone'), 'info'); } }
        ] : [],
        onRow: function (x) { var r = leaveById(x._id); if (r) openLeaveDetail(r, draw); },
        empty: { icon:'calendar-x', title:'No leave requests', hint:'Use “Apply Leave” to start the workflow.' }
      });
      var card = el('div.card', null, [
        el('div.card-head', null, [ el('h3', { html: ui.icon('calendar2-week') + ' Requests' }), el('span.card-sub', { text:'Click a row for detail · admins approve or reject' }) ]),
        el('div.card-body')
      ]);
      card.querySelector('.card-body').appendChild(t.el);
      host.appendChild(card);

      host.appendChild(balancesCard());
    }
  }

  function balancesCard() {
    var quota = annualQuota();
    var takenByEmp = {};
    db.col('leave_requests').forEach(function (r) {
      if (r.status === 'Approved') takenByEmp[r.empId] = (takenByEmp[r.empId] || 0) + (+r.days || 0);
    });
    var emps = db.employees().filter(function (e) { return e.id !== 'EPL-0001'; });
    return tableCard('Leave Balances · ' + quota + ' days annual quota', ['Employee','Company','Quota','Approved / Taken','Remaining'],
      emps.map(function (e) {
        var taken = takenByEmp[e.id] || 0; var remaining = quota - taken;
        return [ nameCell(e), (EPAL.config.company(e.companyId)||{short:'Group'}).short,
          numCell(quota), numCell(taken),
          '<span class="badge ' + (remaining <= 3 ? 'badge-bad' : remaining <= 8 ? 'badge-warn' : 'badge-good') + '">' + remaining + ' days</span>' ];
      }));
  }

  /* Apply for leave → creates a leave_requests record AND raises an approval
   * request through the maker-checker engine.                               */
  function applyLeave(done) {
    var empOpts = db.employees().filter(function (e) { return e.id !== 'EPL-0001'; })
      .map(function (e) { return [e.id, e.name + ' · ' + (EPAL.config.company(e.companyId)||{short:'Group'}).short]; });
    EPAL.formModal({
      title:'Apply for Leave', icon:'calendar-plus', size:'lg',
      fields: [
        { key:'empId', label:'Employee', type:'select', required:true, options: empOpts, default: empOpts[0] && empOpts[0][0] },
        { key:'type', label:'Leave type', type:'select', required:true, options: LEAVE_TYPES, default:'Casual' },
        { key:'from', label:'From date', type:'date', required:true, default: new Date().toISOString().slice(0,10) },
        { key:'to', label:'To date', type:'date', required:true, default: new Date().toISOString().slice(0,10) },
        { key:'days', label:'Days', type:'number', required:true, min:1, default:1 },
        { key:'reason', label:'Reason', type:'textarea', required:true, col2:true, placeholder:'Brief reason for the leave request' }
      ],
      saveLabel:'Submit Request',
      onSave: function (v) {
        var emp = db.employee(v.empId);
        if (!emp) { ui.toast('Select an employee', 'error'); return false; }
        var days = +v.days || dayspan(v.from, v.to);
        if (days < 1) { ui.toast('Days must be at least 1', 'error'); return false; }
        var cu = EPAL.auth.current() || {};
        var rec = { id: nextLeaveId(), empId: v.empId, type: v.type, from: v.from, to: v.to,
          days: days, reason: (v.reason || '').trim(), status:'Pending', created: new Date().toISOString().slice(0,10) };
        // Raise a maker-checker approval request (salary=0 → routes to default level).
        if (EPAL.approvals && EPAL.approvals.request) {
          try {
            var apr = EPAL.approvals.request({ docType:'leave', docId: rec.id, companyId: emp.companyId,
              title: emp.name + ' · ' + rec.type + ' leave · ' + rec.days + ' day(s)', amount: 0,
              maker: cu.id, makerName: cu.name });
            if (apr && apr.id) rec.approvalId = apr.id;
          } catch (e) { /* approval engine optional — never block the request */ }
        }
        db.save('leave_requests', rec);
        db.notify({ level:'info', title:'Leave requested', companyId: emp.companyId, icon:'calendar-plus',
          text: emp.name + ' · ' + rec.type + ' · ' + rec.days + ' day(s)' });
        db.log(cu.name || 'HR', 'Leave request ' + rec.id + ' raised for ' + emp.name, emp.companyId);
        ui.toast('Leave request submitted', 'success');
        done && done();
        return true;
      }
    });
  }

  function openLeaveDetail(r, done) {
    var emp = db.employee(r.empId) || { name:r.empId };
    var co = EPAL.config.company(emp.companyId) || { name:'Group' };
    var body = el('div');
    body.appendChild(el('div.flex.gap-1.flex-wrap.mb-3', null, [
      leaveStatusBadgeEl(r.status), el('span.badge', { text:r.type }), el('span.badge', { text: r.days + ' day(s)' }), el('span.badge', { text:r.id })
    ]));
    body.appendChild(el('div.form-grid', null, [
      kv('Employee', emp.name), kv('Company', co.name),
      kv('From', ui.date(r.from, 'long')), kv('To', ui.date(r.to, 'long')),
      kv('Days', r.days), kv('Applied', ui.date(r.created, 'long'))
    ]));
    body.appendChild(el('div.section-label', { text:'Reason' }));
    body.appendChild(el('p.text-muted.sm', { text: r.reason || '—' }));

    var actions;
    if (r.status === 'Pending' && EPAL.auth.isAdmin()) {
      actions = [
        { label:'Reject', variant:'danger', icon:'x-lg', onClick: function () { decideLeave(r, 'Rejected', done); } },
        { label:'Approve', variant:'primary', icon:'check-lg', onClick: function () { decideLeave(r, 'Approved', done); } }
      ];
    } else {
      actions = [ { label:'Close', variant:'ghost' } ];
    }
    ui.modal({ title:'Leave Request · ' + r.id, icon:'calendar2-week', size:'md', body: body, actions: actions });
  }

  /* Approve / reject — updates status, syncs the approval engine (if a live
   * pending request exists), notifies + logs.                               */
  function decideLeave(r, decision, done) {
    var cu = EPAL.auth.current() || {};
    if (decision === 'Rejected') {
      var ta = el('textarea.input', { rows:'3', placeholder:'Reason for rejection (required — recorded on the audit trail).' });
      ui.modal({
        title:'Reject leave', icon:'x-octagon', size:'sm',
        body: el('div', null, [
          el('p.text-muted.sm.mb-2', { text:'Rejecting leave for ' + ((db.employee(r.empId)||{}).name || r.empId) }),
          el('div.field', null, [ el('label', { text:'Rejection reason' }), ta ])
        ]),
        actions: [
          { label:'Cancel', variant:'ghost' },
          { label:'Reject', variant:'danger', onClick: function () {
              var c = (ta.value || '').trim();
              if (!c) { ui.toast('A reason is required to reject', 'error'); return false; }
              commitLeaveDecision(r, 'Rejected', c, cu, done);
            } }
        ]
      });
      return;
    }
    commitLeaveDecision(r, 'Approved', '', cu, done);
  }

  function commitLeaveDecision(r, status, comment, cu, done) {
    r.status = status;
    db.save('leave_requests', r);
    // Mirror the decision into the maker-checker engine if a live request remains.
    if (r.approvalId && EPAL.approvals && EPAL.approvals.get) {
      var apr = EPAL.approvals.get(r.approvalId);
      if (apr && apr.state === 'pending') {
        try {
          EPAL.approvals.decide(r.approvalId, status === 'Approved' ? 'approved' : 'rejected',
            { by: cu.id, byName: cu.name, comment: comment });
        } catch (e) { /* maker===checker or already decided — non-fatal for the HR view */ }
      }
    }
    var emp = db.employee(r.empId) || { name:r.empId, companyId:'group' };
    db.notify({ level: status === 'Approved' ? 'success' : 'warning', title:'Leave ' + status,
      text: emp.name + ' · ' + r.type + ' · ' + r.days + ' day(s)', companyId: emp.companyId, icon:'calendar-check' });
    db.log(cu.name || 'Admin', 'Leave ' + r.id + ' ' + status.toLowerCase() + ' for ' + emp.name, emp.companyId);
    ui.toast('Leave ' + status.toLowerCase(), 'success');
    done && done();
  }

  /* ---- PAYROLL · run generates slips + posts to the ledger --------------*/
  function payPeriod() { var d = new Date(); return d.toLocaleString('en', { month:'long', year:'numeric' }); }

  function renderPayroll(page) {
    var host = el('div');
    page.appendChild(host);
    draw();

    function draw() {
      host.innerHTML = '';
      var emps = db.employees().filter(function (e) { return e.salary > 0; });
      var gross = emps.reduce(function (a, e) { return a + e.salary; }, 0);
      var tax = Math.round(gross * 0.05), net = gross - tax;
      var runs = db.col('payroll_runs').slice().sort(function (a, b) { return (b.at||0) - (a.at||0); });
      var last = runs[0];

      host.appendChild(el('div.kpi-grid', null, [
        kpi('Gross Payroll', ui.money(gross, { compact:true }), 'cash-stack'),
        kpi('Deductions (5%)', ui.money(tax, { compact:true }), 'dash-circle'),
        kpi('Net Payable', ui.money(net, { compact:true }), 'wallet2'),
        kpi('Headcount', emps.length, 'people')
      ]));
      host.appendChild(el('div.flex.justify-between.items-center.mb-2', null, [
        el('div.section-label', { style:{ margin:'0' }, text:'Salary Sheet · ' + payPeriod() + (last ? ' · last run ' + last.id + ' (' + ui.ago(last.at) + ')' : '') }),
        el('button.btn.btn-primary.btn-sm', { html: ui.icon('play-fill') + ' Run Payroll', onclick: function () { runPayroll(emps, draw); } })
      ]));
      var t = EPAL.table({
        columns: [
          { key:'name', label:'Employee', render: function (e) { return nameCell(e); } },
          { key:'designation', label:'Designation' },
          { key:'company', label:'Company', render: function (e) { return (EPAL.config.company(e.companyId)||{short:'Group'}).short; }, sortVal: function (e) { return e.companyId; } },
          { key:'salary', label:'Gross', num:true, money:true },
          { key:'tax', label:'Tax (5%)', num:true, render: function (e) { return '<span class="num">' + ui.money(Math.round(e.salary*0.05)) + '</span>'; }, sortVal: function (e) { return Math.round(e.salary*0.05); } },
          { key:'net', label:'Net', num:true, render: function (e) { return '<span class="num strong">' + ui.money(e.salary - Math.round(e.salary*0.05)) + '</span>'; }, sortVal: function (e) { return e.salary - Math.round(e.salary*0.05); } }
        ],
        rows: emps, pageSize: 12, exportName:'epal-payroll.csv', searchKeys:['name','designation'],
        actions: [ { icon:'receipt', title:'Salary Slip', onClick: function (e) { salarySlipDoc(e, payPeriod()); } } ],
        empty: { icon:'cash-stack', title:'No salaried staff', hint:'Add employees with a salary to run payroll.' }
      });
      var card = el('div.card', null, [ el('div.card-body') ]);
      card.querySelector('.card-body').appendChild(t.el);
      host.appendChild(card);

      if (runs.length) {
        host.appendChild(tableCard('Recent Payroll Runs', ['Run','Period','Headcount','Gross','Net','Run By','When'],
          runs.slice(0, 6).map(function (r) {
            return [ '<span class="strong">' + ui.escapeHtml(r.id) + '</span>', ui.escapeHtml(r.period || '—'),
              numCell(r.headcount), numCell(ui.money(r.gross)), '<span class="num strong">' + ui.money(r.net) + '</span>',
              ui.escapeHtml(r.by || '—'), ui.ago(r.at) ];
          })));
      }
    }
  }

  /* Execute a payroll run: post net salaries to the ledger per company
   * (DR 5100 Salaries / CR 1010 Bank), record a payroll_runs entry, then open
   * a branded salary slip for the first employee (others via the row action). */
  function runPayroll(emps, done) {
    if (!emps.length) { ui.toast('No salaried staff to pay', 'error'); return; }
    var period = payPeriod();
    var gross = emps.reduce(function (a, e) { return a + (+e.salary || 0); }, 0);
    var tax = Math.round(gross * 0.05), net = gross - tax;
    ui.confirm({
      title:'Run payroll for ' + period + '?',
      text:'Generate ' + emps.length + ' salary slips, post ' + ui.money(net) + ' net to the ledger and record the run.',
      confirmLabel:'Run Payroll'
    }).then(function (ok) {
      if (!ok) return;
      var byCo = {};
      emps.forEach(function (e) {
        var g = +e.salary || 0, t = Math.round(g * 0.05);
        var c = byCo[e.companyId] = byCo[e.companyId] || { gross:0, net:0, count:0 };
        c.gross += g; c.net += (g - t); c.count++;
      });
      var runId = 'PR-' + Date.now().toString(36).toUpperCase();
      var today = new Date().toISOString().slice(0, 10);
      Object.keys(byCo).forEach(function (cid) {
        var c = byCo[cid];
        if (c.net <= 0) return;
        if (EPAL.ledger && EPAL.ledger.post) {
          try {
            EPAL.ledger.post({ date: today, companyId: cid, ref: runId,
              memo:'Payroll ' + period + ' · ' + c.count + ' staff', source:'payroll', party:'',
              lines:[ { account:'5100', dr: c.net, cr:0 }, { account:'1010', dr:0, cr: c.net } ] });
          } catch (e) { console.error('[payroll] ledger post failed for ' + cid, e); }
        }
      });
      var run = { id: runId, date: today, period: period, headcount: emps.length,
        gross: gross, tax: tax, net: net, at: Date.now(),
        by: (EPAL.auth.current()||{}).name || 'Admin',
        companies: Object.keys(byCo).map(function (cid) { return { companyId:cid, gross:byCo[cid].gross, net:byCo[cid].net, count:byCo[cid].count }; }) };
      db.save('payroll_runs', run);
      db.notify({ level:'success', title:'Payroll processed', companyId:'group', icon:'cash-coin',
        text: period + ' · ' + ui.money(net) + ' net across ' + emps.length + ' staff · posted to ledger' });
      db.log(run.by, 'Payroll ' + period + ' run · ' + ui.money(net) + ' net · ' + emps.length + ' staff', 'group');
      if (EPAL.audit && EPAL.audit.record) {
        EPAL.audit.record({ action:'post', entity:'payroll_runs', entityId: runId, entityLabel:'Payroll ' + period, companyId:'group' });
      }
      ui.toast('Payroll run ' + runId + ' complete · opening first payslip', 'success');
      done && done();
      if (emps[0]) salarySlipDoc(emps[0], period);
    });
  }

  /* Branded salary slip document (earnings / deductions / net + words). */
  function salarySlipDoc(e, period) {
    if (!EPAL.doc || !EPAL.doc.open) { ui.toast('Document engine unavailable', 'error'); return; }
    var co = EPAL.config.company(e.companyId) || { name:'Epal Group' };
    var gross = +e.salary || 0;
    var basic = Math.round(gross * 0.6);
    var houseRent = Math.round(gross * 0.3);
    var medical = gross - basic - houseRent;
    var tax = Math.round(gross * 0.05);
    var net = gross - tax;
    EPAL.doc.open({
      type:'salary', title:'Salary Slip', serial: EPAL.doc.numberFor('salary'),
      badge: period, watermark:'PAYSLIP',
      parties: [
        { label:'Employee', lines:[ e.name, e.designation || '', (e.dept || '') + ' · ' + co.name, 'ID: ' + e.id ] },
        { label:'Employer', lines:[ 'Epal Group', co.name, 'Gulshan-2, Dhaka' ] }
      ],
      meta: [
        { label:'Pay Period', value: period },
        { label:'Payment Date', value: ui.date(new Date()) },
        { label:'Method', value:'Bank Transfer' },
        { label:'Status', value:'Paid' }
      ],
      columns: [ { key:'k', label:'Description' }, { key:'v', label:'Amount (BDT)', num:true, money:true } ],
      rows: [
        { k:'Basic Salary', v: basic },
        { k:'House Rent Allowance', v: houseRent },
        { k:'Medical & Other Allowance', v: medical },
        { k:'Less: Income Tax (5%)', v: -tax }
      ],
      totals: [
        { label:'Gross Earnings', value: ui.money(gross) },
        { label:'Total Deductions', value: ui.money(tax) },
        { label:'Net Pay', value: ui.money(net), grand:true }
      ],
      words: EPAL.doc.amountInWords ? EPAL.doc.amountInWords(net) : '',
      terms:'This is a system-generated salary slip and does not require a signature. All figures are in Bangladeshi Taka (BDT). For queries contact HR & Payroll, Epal Group.',
      sign:'For Epal Group · HR & Payroll'
    });
  }

  /* ---- PERFORMANCE ------------------------------------------------------*/
  /* ---- PERFORMANCE — real reviews drive the rating (no invented score) --*/
  function reviewsFor(empId) { return S.list('perf_reviews').filter(function (r) { return r.empId === empId; }); }
  // Rating = average of an employee's REAL review scores. In demo mode there
  // are no reviews yet, so fall back to the seeded e.rating so the leaderboard
  // isn't blank; in API mode it's purely review-driven (0 until first review).
  function ratingOf(e) {
    var revs = reviewsFor(e.id);
    if (revs.length) return revs.reduce(function (a, r) { return a + (+r.score || 0); }, 0) / revs.length;
    return +e.rating || 0;
  }
  function reviewForm(emp, done) {
    var emps = db.employees();
    var fields = [];
    if (!emp) fields.push({ key: 'empId', label: 'Employee', type: 'select', required: true, options: emps.map(function (x) { return [x.id, x.name]; }) });
    fields = fields.concat([
      { key: 'period', label: 'Period', type: 'text', placeholder: 'e.g. 2026-07 or Q2 2026' },
      { key: 'score', label: 'Score (0–5)', type: 'number', required: true, min: 0, max: 5, step: 0.5 },
      { key: 'reviewedOn', label: 'Review date', type: 'date' },
      { key: 'reviewer', label: 'Reviewer', type: 'text' },
      { key: 'strengths', label: 'Strengths', type: 'textarea', col2: true },
      { key: 'improvements', label: 'Areas to improve', type: 'textarea', col2: true }
    ]);
    EPAL.formModal({
      title: 'Performance Review' + (emp ? ' — ' + emp.name : ''), icon: 'star-fill', size: 'md',
      record: { period: new Date().toISOString().slice(0, 7), score: 4, reviewedOn: new Date().toISOString().slice(0, 10), reviewer: (EPAL.auth.current() || {}).name || '' },
      fields: fields,
      onSave: function (v) {
        var target = emp || db.employee(v.empId) || emps.filter(function (x) { return x.id === v.empId; })[0];
        if (!target) { ui.toast('Pick an employee', 'error'); return false; }
        db.save('perf_reviews', {
          id: 'PR-' + Date.now().toString().slice(-6), empId: target.id, userId: target.id,
          period: v.period, score: +v.score || 0, strengths: v.strengths, improvements: v.improvements,
          reviewer: v.reviewer, reviewedOn: v.reviewedOn
        });
        ui.toast('Review saved for ' + target.name, 'success');
        done && done();
      }
    });
  }

  function renderPerformance(page) {
    var emps = db.employees();
    if (canManage()) page.appendChild(el('div.flex.gap-1.flex-wrap.mb-2', null, [
      el('button.btn.btn-sm.btn-primary', { html: ui.icon('star-fill') + ' New Review', onclick: function () { reviewForm(null, function () { EPAL.router.render(); }); } })
    ]));

    var ranked = emps.slice().sort(function (a, b) { return ratingOf(b) - ratingOf(a); });
    page.appendChild(el('div.section-label', { style: { marginTop: 0 }, text: 'Performance Leaderboard' }));
    var grid = el('div.grid-auto', { style: { gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' } });
    ranked.slice(0, 12).forEach(function (e, i) {
      var revs = reviewsFor(e.id);
      var tasks = db.tasksFor(e.id); var done = tasks.filter(function (t) { return t.status === 'done'; }).length;
      var comp = tasks.length ? Math.round(done / tasks.length * 100) : 0;
      grid.appendChild(el('div.card.hover', { style: { cursor: 'pointer' }, onclick: function () { reviewForm(e, function () { EPAL.router.render(); }); } }, [ el('div.card-pad', null, [
        el('div.flex.items-center.gap-2', null, [
          el('div.avatar', { style: { background: ui.colorFor(e.name) }, text: ui.initials(e.name) }),
          el('div.flex-1.min-w-0', null, [ el('div.fw-600', { text: e.name }), el('div.text-muted.xs', { text: e.designation }) ]),
          el('span.badge.badge-accent', { text: '#' + (i + 1) })
        ]),
        el('div.stat-row.mt-3', null, [
          miniStat('Rating', ratingOf(e).toFixed(1)),
          miniStat('Reviews', String(revs.length)),
          miniStat('Tasks', comp + '%')
        ])
      ]) ]));
    });
    page.appendChild(grid);

    // recent reviews register
    var byId = {}; emps.forEach(function (e) { byId[e.id] = e; });
    var allRevs = S.list('perf_reviews').slice().sort(function (a, b) { return (a.reviewedOn || '') < (b.reviewedOn || '') ? 1 : -1; });
    if (allRevs.length) {
      page.appendChild(el('div.section-label', { text: 'Recent Reviews' }));
      var tbl = EPAL.table({
        columns: [
          { key: 'reviewedOn', label: 'Date', date: true },
          { key: 'emp', label: 'Employee', render: function (r) { var e = byId[r.empId]; return '<span class="strong">' + esc(e ? e.name : r.empId) + '</span>'; }, sortVal: function (r) { var e = byId[r.empId]; return e ? e.name : r.empId; } },
          { key: 'period', label: 'Period', render: function (r) { return esc(r.period || '—'); } },
          { key: 'score', label: 'Score', num: true, render: function (r) { return '<span class="num strong">' + (+r.score || 0).toFixed(1) + '</span>'; }, sortVal: function (r) { return +r.score || 0; } },
          { key: 'reviewer', label: 'Reviewer', render: function (r) { return esc(r.reviewer || '—'); } }
        ],
        rows: allRevs, pageSize: 15, searchKeys: ['reviewer', 'period'], exportName: 'performance-reviews.csv',
        actions: canManage() ? [{ icon: 'trash', title: 'Delete review', onClick: function (r) {
          ui.confirm({ title: 'Delete this review?', danger: true, confirmLabel: 'Delete' }).then(function (ok) { if (ok) { db.remove('perf_reviews', r.id); EPAL.router.render(); } });
        } }] : [],
        empty: { icon: 'star', title: 'No reviews yet', hint: 'Add one with New Review.' }
      });
      page.appendChild(el('div.card', null, [ el('div.card-body', null, [tbl.el]) ]));
    }
  }

  /* ---- ORG CHART --------------------------------------------------------*/
  function renderOrg(page) {
    EPAL.config.companies.filter(function (c){return c.type==='company';}).forEach(function (co) {
      var emps = db.employees({ companyId: co.id });
      if (!emps.length) return;
      var byDept = {};
      emps.forEach(function (e) { (byDept[e.dept] = byDept[e.dept] || []).push(e); });
      var card = el('div.card.mb-2', { style:{ '--accent': co.accent } }, [
        el('div.card-head', null, [ el('h3', { html:'<i class="bi bi-' + co.icon + '"></i> ' + co.name }),
          el('span.card-sub', { text: emps.length + ' people' }) ]),
        el('div.card-body.three-col', null, Object.keys(byDept).map(function (d) {
          return el('div', null, [ el('div.section-label', { style:{ marginTop:0 }, text: d }),
            el('div.data-list', null, byDept[d].map(function (e) {
              return el('div.data-row', null, [
                el('div.avatar', { style:{ background: ui.colorFor(e.name), width:'28px', height:'28px', fontSize:'10px' }, text: ui.initials(e.name) }),
                el('div.flex-1.sm', null, [ el('div.fw-600', { text:e.name }), el('div.text-mute.xs', { text:e.designation }) ]) ]);
            })) ]);
        }))
      ]);
      page.appendChild(card);
    });
  }

  /* ---- ADD / EDIT EMPLOYEE ---------------------------------------------*/
  function editEmployee(e, done) {
    var isNew = !e;
    e = e || { id:'EPL-' + Date.now().toString().slice(-4), name:'', companyId:'it', dept:'Engineering', designation:'',
      role:'employee', email:'', phone:'', joinDate:new Date().toISOString().slice(0,10), salary:40000, status:'active',
      attendance:{present:0,absent:0,late:0,leave:0}, rating:3.5 };
    var companyOpts = EPAL.config.companies.filter(function(c){return c.type==='company';});
    // Only a real admin may assign privileged roles; non-admin editors (e.g. HR)
    // get a restricted, read-only role picker so they cannot self-escalate.
    var canSetRole = EPAL.auth.isAdmin();
    var roleOpts = canSetRole
      ? [['owner','Owner'],['admin','Admin'],['manager','Manager'],['accountant','Accountant'],['hr','HR'],['employee','Employee'],['agent','Agent']]
      : [['manager','Manager'],['accountant','Accountant'],['hr','HR'],['employee','Employee'],['agent','Agent']];
    var roleField = selInp('Role','role',e.role, roleOpts);
    if (!canSetRole) {
      var roleSel = roleField.querySelector('#f-role');
      if (roleSel) { roleSel.disabled = true; roleSel.setAttribute('title', 'Only an admin can change roles'); }
    }
    var body = el('div.form-grid', null, [
      inp('Full name','name',e.name,'col-2'),
      selInp('Company','companyId',e.companyId, companyOpts.map(function(c){return [c.id,c.name];})),
      inp('Department','dept',e.dept),
      inp('Designation','designation',e.designation),
      roleField,
      inp('Email','email',e.email), inp('Phone','phone',e.phone),
      inp('Join date','joinDate',e.joinDate,'','date'), inp('Monthly salary','salary',e.salary,'','number'),
      selInp('Status','status',e.status || 'active',[['active','Active'],['on-leave','On leave']])
    ]);
    ui.modal({ title: isNew ? 'Add Employee' : 'Edit Employee', icon:'person-badge', size:'lg', body: body,
      actions: [ { label:'Cancel', variant:'ghost' }, { label: isNew?'Create':'Save', variant:'primary', onClick: function (boxEl) {
        var g = function (id){ return (boxEl.querySelector('#f-'+id)||{}).value; };
        if (!g('name').trim()) { ui.toast('Name required','error'); return false; }
        // Never let a non-admin write the role field (guards against privilege
        // escalation even if the disabled/restricted select is bypassed).
        var applyKeys = canSetRole
          ? ['name','companyId','dept','designation','role','email','phone','joinDate','status']
          : ['name','companyId','dept','designation','email','phone','joinDate','status'];
        applyKeys.forEach(function (k){ e[k] = g(k); });
        e.salary = +g('salary') || 0;
        db.saveEmployee(e);
        db.log(EPAL.auth.current().name, (isNew?'Added':'Updated') + ' employee ' + e.name, e.companyId);
        done && done(); ui.toast(isNew?'Employee added':'Saved','success');
      } } ] });
  }

  /* ---- shared table + cell helpers -------------------------------------*/
  function tableCard(title, headers, rows) {
    var thead = '<thead><tr>' + headers.map(function (h){ return '<th>' + h + '</th>'; }).join('') + '</tr></thead>';
    var tbody = '<tbody>' + rows.map(function (r) { return '<tr>' + r.map(function (c){ return '<td>' + c + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody>';
    var wrap = el('div.card');
    if (title) wrap.appendChild(el('div.card-head', null, [ el('h3', { text: title }) ]));
    wrap.appendChild(el('div.table-wrap', { html: '<table class="tbl">' + thead + tbody + '</table>' }));
    return wrap;
  }
  function nameCell(e) { return '<div class="flex items-center gap-1"><span class="avatar" style="background:' + ui.colorFor(e.name) + ';width:26px;height:26px;font-size:10px">' + ui.initials(e.name) + '</span><span class="strong">' + ui.escapeHtml(e.name) + '</span></div>'; }
  function numCell(v) { return '<span class="num">' + v + '</span>'; }
  function kpi(label, value, icon) {
    return el('div.kpi-card', null, [ el('div.kpi-top', null, [ el('span.kpi-label', { text:label }),
      el('span.kpi-ico', { html:'<i class="bi bi-' + icon + '"></i>' }) ]), el('div.kpi-value', { text:String(value) }) ]);
  }
  function inp(label,id,val,cls,type){ return el('div.field'+(cls?'.'+cls:''),null,[ el('label',{text:label}), el('input.input',{id:'f-'+id,type:type||'text',value:val==null?'':val}) ]); }
  function selInp(label,id,val,opts){ var s=el('select.select',{id:'f-'+id}); opts.forEach(function(o){ var op=el('option',{value:o[0],text:o[1]}); if(o[0]===val)op.selected=true; s.appendChild(op); }); return el('div.field',null,[el('label',{text:label}),s]); }

  /* ---- downloads --------------------------------------------------------*/
  function downloadFile(name, content, mime) {
    var blob = new Blob([content], { type: mime || 'text/plain' });
    var a = el('a', { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click(); a.remove();
  }
  function exportDirectory() {
    var rows = [['ID','Name','Company','Department','Designation','Role','Email','Phone','Salary','Status']];
    db.employees().forEach(function (e) { rows.push([e.id,e.name,e.companyId,e.dept,e.designation,e.role,e.email,e.phone,e.salary,e.status]); });
    downloadFile('epal-employees.csv', rows.map(function (r){ return r.map(function(c){return '"'+String(c).replace(/"/g,'""')+'"';}).join(','); }).join('\n'), 'text/csv');
    ui.toast('Directory exported','success');
  }
  function exportPayroll() {
    var rows = [['ID','Name','Company','Designation','Gross','Tax','Net']];
    db.employees().filter(function(e){return e.salary>0;}).forEach(function (e) { var t=Math.round(e.salary*0.05); rows.push([e.id,e.name,e.companyId,e.designation,e.salary,t,e.salary-t]); });
    downloadFile('epal-payroll.csv', rows.map(function (r){ return r.join(','); }).join('\n'), 'text/csv');
    ui.toast('Payroll sheet exported','success');
  }
  function downloadProfile(e) {
    var co = EPAL.config.company(e.companyId) || { name:'Group' };
    var att = e.attendance || {}; var tasks = db.tasksFor(e.id);
    var html = '<!doctype html><html><head><meta charset="utf-8"><title>' + e.name + ' — Profile</title>' +
      '<style>body{font-family:Inter,Arial,sans-serif;color:#111;max-width:760px;margin:40px auto;padding:0 20px}' +
      'h1{margin:0}h2{border-bottom:2px solid #1A43BF;padding-bottom:6px;margin-top:28px;font-size:16px}' +
      'table{width:100%;border-collapse:collapse;margin-top:10px}td,th{border:1px solid #ddd;padding:8px;text-align:left;font-size:13px}' +
      '.head{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #1A43BF;padding-bottom:14px}' +
      '.muted{color:#666;font-size:13px}.brand{font-weight:800;color:#1A43BF}</style></head><body>' +
      '<div class="head"><div><h1>' + e.name + '</h1><div class="muted">' + e.designation + ' · ' + e.dept + ' · ' + co.name + '</div></div>' +
      '<div class="brand">EPAL GROUP</div></div>' +
      '<h2>Personal & Employment</h2><table>' +
      row('Employee ID', e.id) + row('Company', co.name) + row('Department', e.dept) + row('Designation', e.designation) +
      row('Role', e.role) + row('Email', e.email) + row('Phone', e.phone) + row('Joined', ui.date(e.joinDate,'long')) +
      row('Monthly Salary', ui.money(e.salary)) + row('Status', e.status) + '</table>' +
      '<h2>Attendance (current month)</h2><table>' +
      row('Present', att.present||0) + row('Absent', att.absent||0) + row('Late', att.late||0) + row('Leave', att.leave||0) + '</table>' +
      '<h2>Task Summary</h2><table>' +
      row('Total Tasks', tasks.length) + row('Completed', tasks.filter(function(t){return t.status==='done';}).length) +
      row('In Progress', tasks.filter(function(t){return t.status==='inprogress';}).length) +
      row('Cancelled', tasks.filter(function(t){return t.status==='cancelled';}).length) + '</table>' +
      '<p class="muted" style="margin-top:30px">Generated by Epal Group ERP · ' + ui.date(new Date(),'full') + ' · Confidential — for internal documentation.</p>' +
      '</body></html>';
    downloadFile('profile-' + e.id + '.html', html, 'text/html');
    ui.toast('Profile report downloaded','success');
    function row(k, v) { return '<tr><th style="width:40%">' + k + '</th><td>' + v + '</td></tr>'; }
  }

  EPAL.view('group/employees', view());

})(window.EPAL = window.EPAL || {});
