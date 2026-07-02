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
  var ui = EPAL.ui, el = ui.el, db = EPAL.db;

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
          el('button.btn.btn-primary', { html: ui.icon('person-plus-fill') + ' Add Employee', onclick: function () { editEmployee(null, function(){ EPAL.router.render(); }); } })
        ]
      }));

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
    var state = { q:'', company:'all' };
    var companies = EPAL.config.companies;

    var filters = el('div.flex.items-center.gap-2.flex-wrap.mb-3', null, [
      el('div.search-trigger', { style:{ cursor:'text', minWidth:'260px' } }, [
        ui.frag(ui.icon('search')),
        el('input.input', { placeholder:'Search name, designation, email…', style:{ border:'none', background:'none', padding:'0' },
          oninput: ui.debounce(function (e) { state.q = e.target.value.toLowerCase(); draw(); }, 150) })
      ]),
      el('div.flex.gap-1.flex-wrap', null, [{ id:'all', name:'All' }].concat(companies).map(function (c) {
        return el('button.chip' + (c.id === 'all' ? '.active' : ''), { 'data-co': c.id, text: c.short || c.name,
          onclick: function (e) { state.company = c.id; ui.$$('.chip', filters).forEach(function (x){x.classList.remove('active');}); e.target.classList.add('active'); draw(); } });
      }))
    ]);
    page.appendChild(filters);

    var grid = el('div.grid-auto.stagger');
    page.appendChild(grid);

    function draw() {
      var list = db.employees().filter(function (e) {
        if (state.company !== 'all' && e.companyId !== state.company) return false;
        if (state.q && (e.name + ' ' + e.designation + ' ' + e.email + ' ' + e.dept).toLowerCase().indexOf(state.q) < 0) return false;
        return true;
      });
      grid.innerHTML = '';
      list.forEach(function (e) { grid.appendChild(employeeCard(e)); });
      if (!list.length) grid.appendChild(el('div.empty-state', null, [ ui.frag(ui.icon('search')), el('h3', { text:'No matches' }) ]));
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
          miniStat('Rating', (e.rating || 0).toFixed(1))
        ])
      ])
    ]);
    return card;
  }
  function miniStat(l, v) { return el('div.stat', null, [ el('div.stat-label', { text:l }), el('div.stat-value', { text:String(v) }) ]); }

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
      miniStat('Late', att.late || 0), miniStat('Leave', att.leave || 0),
      miniStat('Rating', (e.rating || 0).toFixed(1))
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

    ui.modal({
      title:'Employee Profile', icon:'person-vcard', size:'lg', body: body,
      actions: [
        { label:'Download Report', variant:'ghost', icon:'file-earmark-arrow-down', keepOpen:true, onClick: function () { downloadProfile(e); } },
        { label:'Open Task Board', variant:'ghost', icon:'kanban', onClick: function () { EPAL.router.navigate('group/tasks', { emp: e.id }); } },
        { label:'Edit', variant:'primary', icon:'pencil', onClick: function () { editEmployee(e, function(){ EPAL.router.render(); }); } }
      ]
    });
  }
  function kv(k, v) { return el('div.field', null, [ el('label', { text:k }), el('div.fw-600', { text: v == null ? '—' : String(v) }) ]); }

  /* ---- ATTENDANCE -------------------------------------------------------*/
  function renderAttendance(page) {
    var emps = db.employees();
    var totals = emps.reduce(function (a, e) { var t = e.attendance || {}; a.p += t.present||0; a.ab += t.absent||0; a.l += t.late||0; a.lv += t.leave||0; return a; }, { p:0, ab:0, l:0, lv:0 });
    page.appendChild(el('div.kpi-grid', null, [
      kpi('Total Present', totals.p, 'check2-circle'), kpi('Total Absent', totals.ab, 'x-circle'),
      kpi('Late Arrivals', totals.l, 'alarm'), kpi('On Leave', totals.lv, 'airplane')
    ]));
    page.appendChild(tableCard('Attendance Matrix · this month', ['Employee','Company','Present','Absent','Late','Leave','Rate'],
      emps.map(function (e) {
        var t = e.attendance || {}; var wd = 22; var rate = Math.round(((t.present||0) / wd) * 100);
        return [ nameCell(e), (EPAL.config.company(e.companyId)||{short:'Group'}).short,
          numCell(t.present||0), numCell(t.absent||0), numCell(t.late||0), numCell(t.leave||0),
          '<span class="badge ' + (rate>=90?'badge-good':rate>=75?'badge-warn':'badge-bad') + '">' + rate + '%</span>' ];
      })));
  }

  /* ---- LEAVES -----------------------------------------------------------*/
  function renderLeaves(page) {
    var emps = db.employees();
    page.appendChild(el('div.build-banner', null, [ ui.frag(ui.icon('info-circle')),
      el('div', { html:'Leave balances are derived from the demo dataset. A full request/approval workflow (apply → approve → deduct) is on the module roadmap.' }) ]));
    page.appendChild(tableCard('Leave Balances', ['Employee','Company','Annual (20)','Sick (10)','Taken','Remaining'],
      emps.map(function (e) {
        var taken = (e.attendance||{}).leave || 0; var remaining = 30 - taken;
        return [ nameCell(e), (EPAL.config.company(e.companyId)||{short:'Group'}).short,
          numCell(20 - Math.min(taken,20)), numCell(10), numCell(taken),
          '<span class="badge badge-good">' + remaining + ' days</span>' ];
      })));
  }

  /* ---- PAYROLL ----------------------------------------------------------*/
  function renderPayroll(page) {
    var emps = db.employees().filter(function (e) { return e.salary > 0; });
    var gross = emps.reduce(function (a, e) { return a + e.salary; }, 0);
    var tax = Math.round(gross * 0.05), net = gross - tax;
    page.appendChild(el('div.kpi-grid', null, [
      kpi('Gross Payroll', ui.money(gross, { compact:true }), 'cash-stack'),
      kpi('Deductions (5%)', ui.money(tax, { compact:true }), 'dash-circle'),
      kpi('Net Payable', ui.money(net, { compact:true }), 'wallet2'),
      kpi('Headcount', emps.length, 'people')
    ]));
    page.appendChild(el('div.flex.justify-between.items-center.mb-2', null, [
      el('div.section-label', { style:{ margin:'0' }, text:'Salary Sheet · ' + ui.date(new Date(), 'long') }),
      el('button.btn.btn-primary.btn-sm', { html: ui.icon('play-fill') + ' Run Payroll', onclick: function () {
        ui.confirm({ title:'Run payroll?', text:'Generate payslips for ' + emps.length + ' employees totalling ' + ui.money(net) + '.', confirmLabel:'Run' })
          .then(function (ok) { if (ok) { db.notify({ level:'success', title:'Payroll processed', text: ui.money(net) + ' net across ' + emps.length + ' staff.', icon:'cash-coin' }); } }); } })
    ]));
    page.appendChild(tableCard(null, ['Employee','Designation','Company','Gross','Tax (5%)','Net'],
      emps.map(function (e) {
        var t = Math.round(e.salary * 0.05);
        return [ nameCell(e), e.designation, (EPAL.config.company(e.companyId)||{short:'Group'}).short,
          numCell(ui.money(e.salary)), numCell(ui.money(t)), '<span class="num strong">' + ui.money(e.salary - t) + '</span>' ];
      })));
  }

  /* ---- PERFORMANCE ------------------------------------------------------*/
  function renderPerformance(page) {
    var emps = db.employees().slice().sort(function (a, b) { return (b.rating||0) - (a.rating||0); });
    page.appendChild(el('div.section-label', { style:{ marginTop:0 }, text:'Performance Leaderboard' }));
    var grid = el('div.grid-auto');
    emps.slice(0, 12).forEach(function (e, i) {
      var tasks = db.tasksFor(e.id); var done = tasks.filter(function (t){return t.status==='done';}).length;
      var comp = tasks.length ? Math.round(done / tasks.length * 100) : 0;
      grid.appendChild(el('div.card', null, [ el('div.card-pad', null, [
        el('div.flex.items-center.gap-2', null, [
          el('div.avatar', { style:{ background: ui.colorFor(e.name) }, text: ui.initials(e.name) }),
          el('div.flex-1', null, [ el('div.fw-600', { text: e.name }), el('div.text-muted.xs', { text: e.designation }) ]),
          el('span.badge.badge-accent', { text: '#' + (i+1) })
        ]),
        el('div.flex.justify-between.mt-3.sm', null, [ el('span.text-muted', { text:'Rating' }),
          el('strong', { html: ui.icon('star-fill') + ' ' + (e.rating||0).toFixed(1) }) ]),
        el('div.kb-prog.mt-1', null, [ el('div.progress', null, [ el('div.progress-bar', { style:{ width: comp+'%' } }) ]), el('small', { text: comp+'%' }) ])
      ]) ]));
    });
    page.appendChild(grid);
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
    var body = el('div.form-grid', null, [
      inp('Full name','name',e.name,'col-2'),
      selInp('Company','companyId',e.companyId, companyOpts.map(function(c){return [c.id,c.name];})),
      inp('Department','dept',e.dept),
      inp('Designation','designation',e.designation),
      selInp('Role','role',e.role,[['owner','Owner'],['admin','Admin'],['manager','Manager'],['accountant','Accountant'],['hr','HR'],['employee','Employee'],['agent','Agent']].map(function(x){return x;})),
      inp('Email','email',e.email), inp('Phone','phone',e.phone),
      inp('Join date','joinDate',e.joinDate,'','date'), inp('Monthly salary','salary',e.salary,'','number')
    ]);
    ui.modal({ title: isNew ? 'Add Employee' : 'Edit Employee', icon:'person-badge', size:'lg', body: body,
      actions: [ { label:'Cancel', variant:'ghost' }, { label: isNew?'Create':'Save', variant:'primary', onClick: function (boxEl) {
        var g = function (id){ return (boxEl.querySelector('#f-'+id)||{}).value; };
        if (!g('name').trim()) { ui.toast('Name required','error'); return false; }
        ['name','companyId','dept','designation','role','email','phone','joinDate'].forEach(function (k){ e[k] = g(k); });
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
      'h1{margin:0}h2{border-bottom:2px solid #c8a24a;padding-bottom:6px;margin-top:28px;font-size:16px}' +
      'table{width:100%;border-collapse:collapse;margin-top:10px}td,th{border:1px solid #ddd;padding:8px;text-align:left;font-size:13px}' +
      '.head{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #c8a24a;padding-bottom:14px}' +
      '.muted{color:#666;font-size:13px}.brand{font-weight:800;color:#c8a24a}</style></head><body>' +
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
