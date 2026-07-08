/* ============================================================================
 * EPAL GROUP ERP  ·  views/tasks/board.js
 * ----------------------------------------------------------------------------
 * TASK MANAGEMENT — a ClickUp/Jira-class Kanban board with the exact behaviour
 * the owner specified:
 *
 *   • Kanban columns (To Do / In Progress / Review / Completed / Cancelled),
 *     drag-and-drop between them.
 *   • Multi-PHASE tasks. Each phase has Start ▸ Pause ▸ Done. Starting a phase
 *     records the timestamp and a LIVE counter runs; Done stops it, banks the
 *     hours into the phase and the task total, and bumps the task's completion
 *     bar (25%, 50%, …, 100%).
 *   • ADMIN oversight: from Group ▸ Task Oversight the admin opens ANY
 *     employee's board, can assign tasks, move them, and COMMENT — which fires
 *     a notification and a GLOW on the card (labelled "Admin") that stays until
 *     the employee opens it.
 *   • Admin can RESTRICT or RED-FLAG a task; the employee then cannot delete it
 *     and sees the restriction — only the admin can lift it.
 *
 * The same view serves two routes:
 *   group/tasks              → admin oversight (employee picker, full powers)
 *   any-company + "/tasks"   → the signed-in employee's own board (self-service)
 *                              (registered under the wildcard key at the bottom)
 * ==========================================================================*/

(function (EPAL) {
  'use strict';
  var ui = EPAL.ui, el = ui.el, db = EPAL.db;

  var COLUMNS = [
    { id:'todo',       title:'To Do',       color:'#8b93a7', icon:'circle' },
    { id:'inprogress', title:'In Progress', color:'#2f6bff', icon:'play-circle' },
    { id:'review',     title:'Review',      color:'#f4b740', icon:'eye' },
    { id:'done',       title:'Completed',   color:'#23c17e', icon:'check-circle' },
    { id:'cancelled',  title:'Cancelled',   color:'#f0506e', icon:'x-circle' }
  ];
  var LABEL_COLORS = { backend:'#2f6bff', frontend:'#7b5cff', ui:'#e0356e', security:'#f0506e',
    bug:'#f0506e', urgent:'#e2721b', client:'#23c17e', 'tech-debt':'#8b93a7', design:'#6f9c1c' };

  function boardView(defaultAdmin) {
    return {
      _ticker: null,
      render: function (ctx) {
        var self = this;
        var isAdmin = defaultAdmin && EPAL.auth.isAdmin();
        // which employee's board? admin can pick; employee sees their own.
        var empId = ctx.params.emp || (isAdmin ? 'EPL-DEV1' : (EPAL.auth.current().id === 'EPL-0001' ? 'EPL-DEV1' : EPAL.auth.current().id));
        var emp = db.employee(empId) || db.employee('EPL-DEV1');
        var page = el('div.page');

        // ---- header ----
        page.appendChild(EPAL.pageHead({
          eyebrow: isAdmin ? 'Task Oversight' : 'My Workspace',
          icon: 'kanban-fill',
          title: isAdmin ? 'Team Task Board' : 'My Task Board',
          sub: isAdmin ? 'Open any employee\'s board, assign work, comment, restrict or audit progress.'
                       : 'Plan your work in phases; start a phase to track time automatically.',
          actions: [
            isAdmin ? employeePicker(emp, function (id) { EPAL.router.navigate((defaultAdmin ? 'group' : ctx.companyId) + '/tasks', { emp: id }); }) : null,
            el('button.btn.btn-primary', { html: ui.icon('plus-lg') + (isAdmin ? ' Assign Task' : ' New Task'),
              onclick: function () { openEditor(emp, null, isAdmin, function () { render(); }); } })
          ]
        }));

        // ---- employee summary strip ----
        page.appendChild(summaryStrip(emp));

        // ---- board mount ----
        var boardHost = el('div');
        page.appendChild(boardHost);
        ctx.mount.appendChild(page);

        function render() {
          reconcileTimers(emp);   // avoid runaway counters
          boardHost.innerHTML = '';
          boardHost.appendChild(buildBoard(emp, isAdmin, render));
          // refresh the summary numbers too
          var strip = page.querySelector('[data-strip]');
          if (strip) strip.replaceWith(summaryStrip(emp));
        }
        render();

        // live 1s ticker updates any running phase display on cards
        self._ticker = setInterval(function () {
          ui.$$('[data-live-phase]').forEach(function (n) {
            var t = getRunningElapsed(n); if (t != null) n.textContent = longDur(t);
          });
        }, 1000);
      },
      teardown: function () { if (this._ticker) clearInterval(this._ticker); }
    };
  }

  /* ---- employee picker (admin) ------------------------------------------*/
  function employeePicker(current, onPick) {
    var sel = el('select.select', { style:{ minWidth:'220px' }, onchange: function () { onPick(sel.value); } });
    db.employees().filter(function (e) { return e.id !== 'EPL-0001'; }).forEach(function (e) {
      var o = el('option', { value: e.id, text: e.name + ' · ' + (EPAL.config.company(e.companyId) || {short:'Group'}).short });
      if (e.id === current.id) o.selected = true;
      sel.appendChild(o);
    });
    return sel;
  }

  /* ---- summary tiles ----------------------------------------------------*/
  function summaryStrip(emp) {
    var tasks = db.tasksFor(emp.id);
    var by = function (s) { return tasks.filter(function (t) { return t.status === s; }).length; };
    var hours = tasks.reduce(function (a, t) { return a + taskTotalMs(t); }, 0);
    var restricted = tasks.filter(function (t) { return t.restricted; }).length;
    var strip = el('div.kpi-grid', { 'data-strip':'1' });
    [['Total Tasks', tasks.length, 'list-task', ''],
     ['In Progress', by('inprogress'), 'play-circle', ''],
     ['Completed', by('done'), 'check-circle', ''],
     ['Cancelled', by('cancelled'), 'x-circle', ''],
     ['Restricted', restricted, 'shield-lock', restricted ? 'warn' : ''],
     ['Tracked Time', ui.dur(hours), 'clock-history', '']
    ].forEach(function (s) {
      strip.appendChild(el('div.kpi-card', null, [
        el('div.kpi-top', null, [ el('span.kpi-label', { text: s[0] }),
          el('span.kpi-ico', { html:'<i class="bi bi-' + s[2] + '"></i>' }) ]),
        el('div.kpi-value' + (s[3] === 'warn' ? '.text-warn' : ''), { text: String(s[1]) })
      ]));
    });
    return strip;
  }

  /* ---- the board --------------------------------------------------------*/
  function buildBoard(emp, isAdmin, refresh) {
    var tasks = db.tasksFor(emp.id);
    var board = el('div.kanban');
    COLUMNS.forEach(function (col) {
      var colTasks = tasks.filter(function (t) { return t.status === col.id; });
      var list = el('div.kb-list', { 'data-col': col.id });
      colTasks.forEach(function (t) { list.appendChild(taskCard(emp, t, isAdmin, refresh)); });

      // drop target
      list.addEventListener('dragover', function (e) { e.preventDefault(); list.parentNode.classList.add('drag-over'); });
      list.addEventListener('dragleave', function () { list.parentNode.classList.remove('drag-over'); });
      list.addEventListener('drop', function (e) {
        e.preventDefault(); list.parentNode.classList.remove('drag-over');
        var id = e.dataTransfer.getData('text/plain');
        var task = db.tasksFor(emp.id).filter(function (x) { return x.id === id; })[0];
        if (!task) return;
        if (task.status === col.id) return;
        task.status = col.id;
        db.saveTask(emp.id, task);
        db.log(EPAL.auth.current().name, 'Moved "' + task.title + '" → ' + col.title, emp.companyId);
        refresh();
      });

      board.appendChild(el('div.kb-col', { style:{ '--kb': col.color } }, [
        el('div.kb-col-head', null, [
          el('span.kb-col-dot'), el('span.kb-col-title', { text: col.title }),
          el('span.kb-count', { text: String(colTasks.length) })
        ]),
        list
      ]));
    });
    return board;
  }

  function taskCard(emp, t, isAdmin, refresh) {
    var pct = taskProgress(t);
    var running = (t.phases || []).some(function (p) { return p.running; });
    var unseenAdmin = (t.comments || []).some(function (c) { return c.byAdmin && c.unseen; });

    var card = el('div.kb-card' + (unseenAdmin ? '.glow' : '') + (t.restricted ? '.restricted' : '') + (t.redFlag ? '.redflag' : ''),
      { draggable: 'true', 'data-id': t.id });

    card.addEventListener('dragstart', function (e) { e.dataTransfer.setData('text/plain', t.id); card.classList.add('dragging'); });
    card.addEventListener('dragend', function () { card.classList.remove('dragging'); });
    card.addEventListener('click', function () { openDetail(emp, t, isAdmin, refresh); });

    // labels
    if ((t.labels || []).length) {
      card.appendChild(el('div.kb-card-labels', null, t.labels.map(function (lb) {
        var c = LABEL_COLORS[lb] || ui.colorFor(lb);
        return el('span.kb-tag', { text: lb, style:{ background: c + '22', color: c } });
      })));
    }
    // admin/restriction flags
    if (unseenAdmin) card.appendChild(el('div', null, [ el('span.admin-flag', { html: ui.icon('shield-fill') + ' Admin commented' }) ]));
    if (t.restricted) card.appendChild(el('div.mt-1', null, [ el('span.badge.badge-bad', { html: ui.icon('lock-fill') + ' Restricted' }) ]));

    card.appendChild(el('div.kb-card-title', { text: t.title }));

    // progress
    if ((t.phases || []).length) {
      card.appendChild(el('div.kb-prog', null, [
        el('div.progress', null, [ el('div.progress-bar', { style:{ width: pct + '%' } }) ]),
        el('small', { text: pct + '%' })
      ]));
    }

    // footer
    var prioColor = { high:'#f0506e', medium:'#f4b740', low:'#23c17e' }[t.priority] || '#8b93a7';
    card.appendChild(el('div.kb-card-foot', null, [
      el('span', { html: '<span class="badge dot" style="color:' + prioColor + '">' + (t.priority || 'normal') + '</span>' }),
      el('span.flex.items-center.gap-1', null, [
        running ? ui.frag('<span class="rec-dot"></span>') : null,
        t.due ? el('span', { html: ui.icon('calendar3') + ' ' + ui.date(t.due) }) : null
      ])
    ]));
    return card;
  }

  /* ---- task detail modal (phases, timers, comments) ---------------------*/
  function openDetail(emp, t, isAdmin, refresh) {
    // Opening as the employee clears the admin-comment glow.
    if (!isAdmin) {
      (t.comments || []).forEach(function (c) { if (c.byAdmin) c.unseen = false; });
      db.saveTask(emp.id, t);
    }
    var body = el('div');
    var m = ui.modal({ title: t.title, icon:'kanban', size:'lg', body: body, footer: false });

    function redraw() {
      body.innerHTML = '';
      var pct = taskProgress(t);

      // meta chips
      body.appendChild(el('div.flex.gap-1.flex-wrap.mb-3', null, [
        el('span.badge.badge-accent', { text: 'Status: ' + (COLUMNS.filter(function (c){return c.id===t.status;})[0]||{title:t.status}).title }),
        el('span.badge', { text: 'Priority: ' + (t.priority || 'normal') }),
        t.due ? el('span.badge', { html: ui.icon('calendar3') + ' ' + ui.date(t.due) }) : null,
        t.restricted ? el('span.badge.badge-bad', { html: ui.icon('lock-fill') + ' Restricted by Admin' }) : null,
        t.redFlag ? el('span.badge.badge-bad', { html: ui.icon('flag-fill') + ' Red-flagged' }) : null
      ]));

      if (t.desc) body.appendChild(el('p.text-muted.mb-3', { text: t.desc }));

      // overall progress — fluid fill: render at 0, then animate to pct.
      var pbar = el('div.progress-bar.fluid', { style: { width: '0%' } });
      body.appendChild(el('div.flex.items-center.gap-2.mb-2', null, [
        el('div.flex-1', null, [ el('div.progress.progress-lg', null, [ pbar ]) ]),
        el('strong', { text: pct + '%' })
      ]));
      requestAnimationFrame(function () { requestAnimationFrame(function () { pbar.style.width = pct + '%'; }); });

      // phases
      body.appendChild(el('div.section-label', { style:{ marginTop:'14px' }, text:'Phases · time tracking' }));
      var phases = el('div');
      (t.phases || []).forEach(function (p) {
        phases.appendChild(phaseRow(emp, t, p, redraw, refresh));
      });
      if (!(t.phases || []).length) phases.appendChild(el('div.text-muted.sm', { text:'No phases yet.' }));
      body.appendChild(phases);
      body.appendChild(el('button.btn.btn-sm.btn-ghost.mt-2', { html: ui.icon('plus') + ' Add phase',
        onclick: function () {
          ui.modal({ title:'Add phase', size:'sm',
            body: el('div.field', null, [ el('label', { text:'Phase name' }), el('input.input#ph-name', { placeholder:'e.g. Testing' }) ]),
            actions: [{ label:'Cancel', variant:'ghost' }, { label:'Add', variant:'primary', onClick: function () {
              var v = ui.$('#ph-name').value.trim(); if (!v) return false;
              t.phases = t.phases || []; t.phases.push({ id: ui.uid('p'), name:v, pct:0, accumMs:0, running:false, done:false });
              db.saveTask(emp.id, t); redraw(); refresh();
            } }] });
        } }));

      // comments
      body.appendChild(el('div.section-label', { text:'Comments' }));
      var clist = el('div.data-list');
      (t.comments || []).forEach(function (c) {
        var who = c.byAdmin ? 'Admin' : (db.employee(c.by) || {name:'Someone'}).name;
        clist.appendChild(el('div.data-row', null, [
          el('div.avatar', { style:{ background: c.byAdmin ? 'var(--gold)' : ui.colorFor(who), width:'30px', height:'30px', fontSize:'11px' }, text: ui.initials(who) }),
          el('div.flex-1', null, [
            el('div.sm', null, [ el('strong', { text: who }),
              c.byAdmin ? ui.frag(' <span class="admin-flag">Admin</span>') : null,
              el('span.text-mute.xs', { text: ' · ' + ui.ago(c.at) }) ]),
            el('div.text-muted.sm', { text: c.text })
          ])
        ]));
      });
      if (!(t.comments || []).length) clist.appendChild(el('div.text-muted.sm', { text:'No comments yet.' }));
      body.appendChild(clist);

      // add comment
      var cin = el('input.input', { placeholder: isAdmin ? 'Comment as Admin (notifies employee, glows the card)…' : 'Add a comment…' });
      body.appendChild(el('div.flex.gap-1.mt-2', null, [
        cin,
        el('button.btn.btn-primary', { html: ui.icon('send'), onclick: function () {
          var v = cin.value.trim(); if (!v) return;
          t.comments = t.comments || [];
          t.comments.push({ by: EPAL.auth.current().id, byAdmin: isAdmin, at: Date.now(), text: v, unseen: isAdmin });
          db.saveTask(emp.id, t);
          if (isAdmin) {
            db.notify({ level:'info', title:'New comment from Admin', text:'On task: ' + t.title, companyId: emp.companyId, icon:'chat-left-text-fill' });
            EPAL.bus.emit('task:commented', { empId: emp.id, taskId: t.id, byAdmin: true });
          }
          cin.value = ''; redraw(); refresh();
        } })
      ]));

      // admin / owner controls
      body.appendChild(el('div.divider'));
      var controls = el('div.flex.gap-1.flex-wrap');
      if (isAdmin) {
        controls.appendChild(toggleBtn(t.restricted, 'lock-fill', t.restricted ? 'Unrestrict' : 'Restrict', function () {
          t.restricted = !t.restricted; db.saveTask(emp.id, t); redraw(); refresh(); ui.toast(t.restricted ? 'Task restricted' : 'Restriction lifted', 'warning'); }));
        controls.appendChild(toggleBtn(t.redFlag, 'flag-fill', t.redFlag ? 'Clear flag' : 'Red-flag', function () {
          t.redFlag = !t.redFlag; db.saveTask(emp.id, t); redraw(); refresh(); }));
        // move-to select
        var moveSel = el('select.select', { style:{ width:'auto' }, onchange: function () { t.status = moveSel.value; db.saveTask(emp.id, t); redraw(); refresh(); } });
        COLUMNS.forEach(function (c) { var o = el('option', { value:c.id, text:'Move → ' + c.title }); if (c.id === t.status) o.selected = true; moveSel.appendChild(o); });
        controls.appendChild(moveSel);
      }
      controls.appendChild(el('button.btn.btn-sm.btn-ghost', { html: ui.icon('printer') + ' Print report',
        onclick: function () { printTaskReport(emp, t); } }));
      controls.appendChild(el('button.btn.btn-sm.btn-ghost', { html: ui.icon('pencil') + ' Edit',
        onclick: function () { m.close(); openEditor(emp, t, isAdmin, refresh); } }));

      // delete — blocked for employees on restricted tasks
      var canDelete = isAdmin || !t.restricted;
      controls.appendChild(el('button.btn.btn-sm' + (canDelete ? '.btn-danger' : '.btn-ghost'), {
        title: canDelete ? '' : 'Restricted by admin — you cannot delete this task',
        html: ui.icon(canDelete ? 'trash' : 'lock') + ' Delete',
        onclick: function () {
          if (!canDelete) { ui.toast('This task is restricted by Admin — you cannot delete it.', 'error'); return; }
          ui.confirm({ title:'Delete task?', danger:true, confirmLabel:'Delete' }).then(function (ok) {
            if (ok) { db.deleteTask(emp.id, t.id); m.close(); refresh(); ui.toast('Task deleted', 'success'); }
          });
        } }));
      body.appendChild(controls);
    }
    redraw();
  }

  var PRIORITIES = ['high', 'medium', 'low'];

  function phaseRow(emp, t, p, redraw, refresh) {
    var elapsed = phaseElapsed(p);
    var team = db.employees({ companyId: emp.companyId });

    // ---- left: name + live elapsed + the start→end date-time range ----------
    var timeLine = el('div.phase-time' + (p.running ? '.running' : ''), null, [
      p.running ? ui.frag('<span class="rec-dot"></span> ') : null,
      el('span', p.running ? { 'data-live-phase': JSON.stringify({ accumMs: p.accumMs, startedAt: p.startedAt }) } : {},
         p.firstStart || elapsed ? longDur(elapsed) : 'not started')
    ]);
    // e.g. "10.00pm:07/07/2026 → 01.00pm:08/07/2026" (or "→ in progress")
    var rangeLine = p.firstStart
      ? el('div.phase-range' + (p.done ? '.complete' : ''), { text: fmtDT(p.firstStart) + '  →  ' + (p.completedAt ? fmtDT(p.completedAt) : 'in progress') })
      : null;

    // ---- middle: assignee + priority (replaces the old progress bar) --------
    var asgn = el('select.select.phase-assignee', { title: 'Assign this phase',
      onchange: function () { p.assignee = asgn.value; db.saveTask(emp.id, t); redraw(); refresh(); } });
    asgn.appendChild(el('option', { value: '', text: 'Unassigned' }));
    team.forEach(function (e) { var o = el('option', { value: e.id, text: e.name }); if (e.id === p.assignee) o.selected = true; asgn.appendChild(o); });

    var pri = p.priority || 'medium';
    var priSel = el('select.select.phase-priority.pri-' + pri, { title: 'Phase priority',
      onchange: function () { p.priority = priSel.value; db.saveTask(emp.id, t); redraw(); refresh(); } });
    PRIORITIES.forEach(function (x) { var o = el('option', { value: x, text: x.charAt(0).toUpperCase() + x.slice(1) }); if (x === pri) o.selected = true; priSel.appendChild(o); });

    var row = el('div.phase' + (p.done ? '.done' : '') + (p.running ? '.running' : ''), null, [
      el('div.phase-main', null, [
        el('div.phase-name', { text: p.name }),
        // time counting + the start→end timeline BESIDE it (same line)
        el('div.phase-timerow', null, [ timeLine, rangeLine ])
      ]),
      el('div.phase-meta', null, [
        el('label.phase-field', null, [ ui.frag(ui.icon('person')), asgn ]),
        el('label.phase-field', null, [ ui.frag(ui.icon('flag')), priSel ])
      ]),
      el('div.phase-controls')
    ]);

    // ---- right: start / pause / done (records first-start & completed-at) ---
    var ctr = row.querySelector('.phase-controls');
    if (!p.done) {
      if (!p.running) {
        ctr.appendChild(el('button.btn.btn-sm.btn-ghost', { html: ui.icon('play-fill'), title: 'Start', onclick: function () {
          (t.phases || []).forEach(function (o) { if (o.running) { o.accumMs += Date.now() - o.startedAt; o.running = false; } });
          if (!p.firstStart) p.firstStart = Date.now();     // record the very first start time
          p.running = true; p.startedAt = Date.now(); if (t.status === 'todo') t.status = 'inprogress';
          db.saveTask(emp.id, t); redraw(); refresh();
        } }));
      } else {
        ctr.appendChild(el('button.btn.btn-sm.btn-ghost', { html: ui.icon('pause-fill'), title: 'Pause', onclick: function () {
          p.accumMs += Date.now() - p.startedAt; p.running = false; db.saveTask(emp.id, t); redraw(); refresh();
        } }));
      }
      ctr.appendChild(el('button.btn.btn-sm.btn-primary', { html: ui.icon('check-lg'), title: 'Mark phase done', onclick: function () {
        if (p.running) { p.accumMs += Date.now() - p.startedAt; p.running = false; }
        if (!p.firstStart) p.firstStart = Date.now();
        p.done = true; p.pct = 100; p.completedAt = Date.now();   // record the completion time
        db.saveTask(emp.id, t);
        if ((t.phases || []).every(function (x) { return x.done; })) { t.status = 'done'; db.saveTask(emp.id, t); ui.toast('All phases done — task completed!', 'success'); }
        redraw(); refresh();
      } }));
    } else {
      ctr.appendChild(el('span.badge.badge-good', { html: ui.icon('check') + ' Done' }));
    }
    return row;
  }

  function toggleBtn(active, icon, label, onClick) {
    return el('button.btn.btn-sm' + (active ? '.btn-danger' : '.btn-outline'), { html: ui.icon(icon) + ' ' + label, onclick: onClick });
  }

  /* ---- task editor (create / edit) --------------------------------------*/
  function openEditor(emp, task, isAdmin, done) {
    var isNew = !task;
    task = task || { id:'T-' + Date.now().toString().slice(-5), title:'', desc:'', status:'todo', priority:'medium',
      due:'', created: new Date().toISOString().slice(0,10), createdBy: EPAL.auth.current().id,
      labels:[], phases:[], comments:[], restricted:false, redFlag:false };

    var body = el('div.form-grid', null, [
      field('Title', 'title', task.title, 'col-2', 'text', 'e.g. Build reporting module'),
      selField('Priority', 'priority', task.priority, ['high','medium','low']),
      selField('Status', 'status', task.status, COLUMNS.map(function (c){return c.id;})),
      field('Due date', 'due', task.due, '', 'date'),
      field('Labels (comma separated)', 'labels', (task.labels||[]).join(', '), '', 'text', 'backend, urgent'),
      textField('Description', 'desc', task.desc, 'col-2'),
      field('Phases (comma separated, optional)', 'phases', (task.phases||[]).map(function(p){return p.name;}).join(', '), 'col-2', 'text', 'Design, Build, Test')
    ]);

    ui.modal({
      title: isNew ? (isAdmin ? 'Assign new task to ' + emp.name : 'New task') : 'Edit task',
      icon: 'kanban', size:'lg', body: body,
      actions: [
        { label:'Cancel', variant:'ghost' },
        { label: isNew ? 'Create' : 'Save', variant:'primary', onClick: function (boxEl) {
          var g = function (id) { return (boxEl.querySelector('#f-' + id) || {}).value; };
          if (!g('title').trim()) { ui.toast('Title is required', 'error'); return false; }
          task.title = g('title').trim(); task.desc = g('desc'); task.priority = g('priority'); task.status = g('status'); task.due = g('due');
          task.labels = g('labels').split(',').map(function (s){return s.trim();}).filter(Boolean);
          // reconcile phases (keep existing ones by name, add new)
          var names = g('phases').split(',').map(function (s){return s.trim();}).filter(Boolean);
          if (names.length) {
            var existing = {}; (task.phases||[]).forEach(function (p){ existing[p.name] = p; });
            task.phases = names.map(function (n) { return existing[n] || { id: ui.uid('p'), name:n, pct:0, accumMs:0, running:false, done:false }; });
          }
          if (isNew && isAdmin) {
            task.createdBy = 'EPL-0001';
            task.comments = task.comments || [];
            task.comments.push({ by:'EPL-0001', byAdmin:true, at: Date.now(), text:'Assigned to you by Admin.', unseen:true });
            db.notify({ level:'info', title:'New task assigned', text: task.title, companyId: emp.companyId, icon:'clipboard-plus' });
          }
          db.saveTask(emp.id, task);
          db.log(EPAL.auth.current().name, (isNew?'Created':'Updated') + ' task "' + task.title + '"', emp.companyId);
          done && done();
          ui.toast(isNew ? 'Task created' : 'Task saved', 'success');
        } }
      ]
    });
  }

  /* ---- tiny form field builders ----------------------------------------*/
  function field(label, id, val, cls, type, ph) {
    return el('div.field' + (cls ? '.' + cls : ''), null, [
      el('label', { text: label }),
      el('input.input', { id:'f-' + id, type: type || 'text', value: val || '', placeholder: ph || '' })
    ]);
  }
  function textField(label, id, val, cls) {
    return el('div.field' + (cls ? '.' + cls : ''), null, [
      el('label', { text: label }),
      el('textarea.input', { id:'f-' + id, rows:'3', html: ui.escapeHtml(val || '') })
    ]);
  }
  function selField(label, id, val, opts) {
    var s = el('select.select', { id:'f-' + id });
    opts.forEach(function (o) { var op = el('option', { value:o, text: o.charAt(0).toUpperCase()+o.slice(1) }); if (o===val) op.selected = true; s.appendChild(op); });
    return el('div.field', null, [ el('label', { text: label }), s ]);
  }

  /* ---- time math --------------------------------------------------------*/
  function phaseElapsed(p) { return (p.accumMs || 0) + (p.running && p.startedAt ? Date.now() - p.startedAt : 0); }
  function taskTotalMs(t) { return (t.phases || []).reduce(function (a, p) { return a + phaseElapsed(p); }, 0); }
  // Overall progress = share of phases marked Done (phases no longer carry a % bar).
  function taskProgress(t) {
    var ph = t.phases || []; if (!ph.length) return t.status === 'done' ? 100 : 0;
    var done = ph.filter(function (p) { return p.done; }).length;
    return Math.round(done / ph.length * 100);
  }
  // "1 Hour 35 min" style elapsed (long form the owner asked for).
  function longDur(ms) {
    ms = ms || 0; var s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    if (h > 0) return h + ' Hour' + (h > 1 ? 's' : '') + ' ' + m + ' min';
    if (m > 0) return m + ' min';
    return s + ' sec';
  }
  // "10.00pm:07/07/2026" style timestamp.
  function fmtDT(ms) {
    if (!ms) return '';
    var d = new Date(ms), hh = d.getHours(), ap = hh >= 12 ? 'pm' : 'am', h12 = hh % 12 || 12;
    var mm = ('0' + d.getMinutes()).slice(-2), DD = ('0' + d.getDate()).slice(-2), MO = ('0' + (d.getMonth() + 1)).slice(-2);
    return h12 + '.' + mm + ap + ':' + DD + '/' + MO + '/' + d.getFullYear();
  }

  function escHtml(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  /* ---- Branded, print-ready TASK REPORT ---------------------------------
   * A full one-page document of the task + every phase (assignee, priority,
   * time spent, start→end timeline), a mini Gantt, totals and comments — in the
   * EPAL navy/blue identity. Opens a print window and calls print().        */
  function printTaskReport(emp, t) {
    var phases = t.phases || [];
    var pct = taskProgress(t);
    var totalMs = taskTotalMs(t);
    var statusTitle = (COLUMNS.filter(function (c) { return c.id === t.status; })[0] || { title: t.status }).title;
    var priColor = { high: '#c0455a', medium: '#b7841c', low: '#2b8f63' };
    function priBadge(p) { var c = priColor[p || 'medium'] || '#b7841c'; return '<span class="pri" style="color:' + c + ';border:1px solid ' + c + '55;background:' + c + '14">' + escHtml((p || 'medium')) + '</span>'; }

    // rows
    var rows = phases.map(function (p, i) {
      var asg = p.assignee ? (db.employee(p.assignee) || { name: '—' }).name : 'Unassigned';
      var st = p.done ? 'Done' : (p.running ? 'Running' : 'Pending');
      var stc = p.done ? '#2b8f63' : (p.running ? '#1A43BF' : '#8b93a7');
      return '<tr>' +
        '<td class="c mut">' + (i + 1) + '</td>' +
        '<td><strong>' + escHtml(p.name) + '</strong></td>' +
        '<td>' + escHtml(asg) + '</td>' +
        '<td>' + priBadge(p.priority) + '</td>' +
        '<td class="mono r">' + longDur(phaseElapsed(p)) + '</td>' +
        '<td class="mono sm">' + (p.firstStart ? fmtDT(p.firstStart) : '—') + '</td>' +
        '<td class="mono sm">' + (p.completedAt ? fmtDT(p.completedAt) : (p.running ? 'in progress' : '—')) + '</td>' +
        '<td><span class="stt" style="color:' + stc + ';background:' + stc + '18">' + st + '</span></td>' +
        '</tr>';
    }).join('');

    // mini Gantt (only for phases that have started)
    var started = phases.filter(function (p) { return p.firstStart; });
    var gantt = '';
    if (started.length) {
      var lo = Math.min.apply(null, started.map(function (p) { return p.firstStart; }));
      var hi = Math.max.apply(null, started.map(function (p) { return p.completedAt || Date.now(); }));
      if (hi <= lo) hi = lo + 1;
      gantt = '<div class="sec-t">Timeline</div><div class="gantt">' + phases.map(function (p) {
        if (!p.firstStart) return '<div class="grow"><span class="glabel">' + escHtml(p.name) + '</span><div class="gtrack"><span class="gbar none">not started</span></div></div>';
        var end = p.completedAt || Date.now();
        var left = (p.firstStart - lo) / (hi - lo) * 100, w = Math.max(2, (end - p.firstStart) / (hi - lo) * 100);
        var cls = p.done ? 'done' : (p.running ? 'run' : '');
        return '<div class="grow"><span class="glabel">' + escHtml(p.name) + '</span><div class="gtrack"><span class="gbar ' + cls + '" style="left:' + left.toFixed(1) + '%;width:' + w.toFixed(1) + '%">' + longDur(phaseElapsed(p)) + '</span></div></div>';
      }).join('') + '</div><div class="gspan mono">' + fmtDT(lo) + '  →  ' + fmtDT(hi) + '</div>';
    }

    var comments = (t.comments || []).map(function (c) {
      var who = c.byAdmin ? 'Admin' : (db.employee(c.by) || { name: 'Someone' }).name;
      return '<div class="cmt"><div class="cmt-h"><b>' + escHtml(who) + '</b>' + (c.byAdmin ? ' <span class="af">Admin</span>' : '') + ' · <span class="mono sm">' + fmtDT(c.at) + '</span></div><div class="cmt-b">' + escHtml(c.text) + '</div></div>';
    }).join('') || '<div class="mut sm">No comments.</div>';

    var flags = [];
    if (t.restricted) flags.push('<span class="chip red">Restricted</span>');
    if (t.redFlag) flags.push('<span class="chip red">Red-flagged</span>');

    var html =
'<!doctype html><html><head><meta charset="utf-8"><title>Task Report · ' + escHtml(t.id) + '</title>' +
'<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Sora:wght@600;700;800&family=JetBrains+Mono:wght@500;600&display=swap" rel="stylesheet">' +
'<style>' +
'*{box-sizing:border-box;margin:0;padding:0}' +
'body{font-family:Inter,system-ui,Arial,sans-serif;color:#1d2836;background:#eef2f7;padding:24px;-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
'.doc{max-width:820px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 12px 40px rgba(20,40,70,.14)}' +
'.head{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;padding:26px 30px;background:#1B2A4A;color:#fff;border-bottom:4px solid #1A43BF}' +
'.brand{display:flex;align-items:center;gap:14px}' +
'.mark{width:50px;height:50px;border-radius:13px;background:linear-gradient(150deg,#2E56C4,#0A2472);display:flex;align-items:center;justify-content:center;font-family:Sora;font-weight:800;font-size:26px;color:#fff}' +
'.brand h1{font-family:Sora;font-size:19px;letter-spacing:.02em}.brand .tag{font-size:12px;opacity:.8}' +
'.head .meta{text-align:right;font-size:12px;line-height:1.7;opacity:.92}.head .serial{font-family:JetBrains Mono;font-size:15px;font-weight:700;color:#7E9AE8}' +
'.title{padding:20px 30px 6px;font-family:Sora;font-size:22px;font-weight:800;color:#1B2A4A}' +
'.chips{padding:0 30px 6px;display:flex;gap:8px;flex-wrap:wrap}' +
'.chip{font-size:11px;font-weight:600;padding:4px 10px;border-radius:999px;background:#eaf0f7;color:#0A2472;border:1px solid #d7e2ef}' +
'.chip.red{background:#fbeaed;color:#c0455a;border-color:#f2ccd4}' +
'.desc{padding:8px 30px 4px;color:#4a5568;font-size:13.5px;line-height:1.6}' +
'.kpis{display:flex;gap:12px;padding:16px 30px 4px}' +
'.kpi{flex:1;border:1px solid #e4ebf3;border-radius:12px;padding:12px 14px;background:linear-gradient(135deg,#f4f8fc,#fff)}' +
'.kpi .l{font-size:11px;color:#77869a;text-transform:uppercase;letter-spacing:.04em}.kpi .v{font-family:Sora;font-size:20px;font-weight:800;color:#1B2A4A;margin-top:2px}' +
'.pbar{margin:14px 30px 2px;height:12px;border-radius:999px;background:#e7edf4;overflow:hidden}.pbar>span{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,#0A2472,#1A43BF,#2E56C4)}' +
'.pnote{padding:4px 30px 6px;font-size:12px;color:#77869a}' +
'.sec-t{padding:18px 30px 6px;font-family:Sora;font-weight:700;font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:#0A2472}' +
'table{width:calc(100% - 60px);margin:2px 30px;border-collapse:collapse;font-size:12.5px}' +
'thead th{background:#f2f6fb;color:#0A2472;text-align:left;padding:9px 10px;font-size:10.5px;text-transform:uppercase;letter-spacing:.04em;border-bottom:2px solid #dfe8f2}' +
'tbody td{padding:9px 10px;border-bottom:1px solid #edf1f6}tbody tr:nth-child(even){background:#fafcfe}' +
'.mono{font-family:JetBrains Mono}.sm{font-size:11px}.r{text-align:right}.c{text-align:center}.mut{color:#8b96a6}' +
'.pri{font-size:10.5px;font-weight:700;padding:2px 8px;border-radius:999px;text-transform:capitalize}' +
'.stt{font-size:10.5px;font-weight:700;padding:2px 9px;border-radius:999px}' +
'tfoot td{padding:10px;font-weight:800;color:#1B2A4A;border-top:2px solid #1B2A4A}' +
'.gantt{margin:2px 30px}.grow{display:flex;align-items:center;gap:10px;margin:6px 0}.glabel{width:120px;font-size:12px;color:#374356;text-align:right;flex:0 0 120px}' +
'.gtrack{position:relative;flex:1;height:22px;background:#eef3f9;border-radius:6px}' +
'.gbar{position:absolute;top:0;height:22px;border-radius:6px;display:flex;align-items:center;padding:0 8px;font-family:JetBrains Mono;font-size:10px;color:#fff;background:linear-gradient(90deg,#1A43BF,#2E56C4);white-space:nowrap;overflow:hidden}' +
'.gbar.done{background:linear-gradient(90deg,#2b8f63,#57b58c)}.gbar.run{background:linear-gradient(90deg,#0A2472,#1A43BF)}.gbar.none{position:static;background:none;color:#a3adbb;padding-left:0}' +
'.gspan{padding:6px 30px 2px;font-size:11px;color:#8b96a6}' +
'.cmts{padding:2px 30px}.cmt{border-left:3px solid #d7e2ef;padding:4px 0 4px 12px;margin:8px 0}.cmt-h{font-size:12px;color:#374356}.cmt-b{font-size:13px;color:#4a5568;margin-top:2px}.af{background:#1A43BF;color:#fff;font-size:9px;padding:1px 6px;border-radius:6px}' +
'.foot{display:flex;justify-content:space-between;align-items:flex-end;padding:24px 30px 28px;margin-top:10px;border-top:1px dashed #d7e2ef}' +
'.sign .line{width:180px;border-top:1.5px solid #1B2A4A;margin-bottom:5px}.sign{font-size:12px;color:#4a5568}.note{font-size:11px;color:#98a3b2;text-align:right}' +
'@media print{body{background:#fff;padding:0}.doc{box-shadow:none;border-radius:0;max-width:100%}@page{size:A4;margin:14mm}}' +
'</style></head><body><div class="doc">' +
'<div class="head"><div class="brand"><div class="mark">E</div><div><h1>EPAL GROUP</h1><div class="tag">Task Report · Workforce</div></div></div>' +
'<div class="meta"><div class="serial">' + escHtml(t.id) + '</div><div>Generated ' + fmtDT(Date.now()) + '</div></div></div>' +
'<div class="title">' + escHtml(t.title) + '</div>' +
'<div class="chips"><span class="chip">Status: ' + escHtml(statusTitle) + '</span><span class="chip">Priority: ' + escHtml(t.priority || 'normal') + '</span>' + (t.due ? '<span class="chip">Due: ' + escHtml(ui.date(t.due)) + '</span>' : '') + flags.join('') + '</div>' +
(t.desc ? '<div class="desc">' + escHtml(t.desc) + '</div>' : '') +
'<div class="kpis"><div class="kpi"><div class="l">Progress</div><div class="v">' + pct + '%</div></div>' +
'<div class="kpi"><div class="l">Phases</div><div class="v">' + phases.filter(function (p) { return p.done; }).length + ' / ' + phases.length + '</div></div>' +
'<div class="kpi"><div class="l">Total time tracked</div><div class="v">' + longDur(totalMs) + '</div></div></div>' +
'<div class="pbar"><span style="width:' + pct + '%"></span></div><div class="pnote">' + pct + '% complete · ' + phases.length + ' phase' + (phases.length === 1 ? '' : 's') + '</div>' +
'<div class="sec-t">Phases &amp; time tracking</div>' +
'<table><thead><tr><th>#</th><th>Phase</th><th>Assignee</th><th>Priority</th><th class="r">Time spent</th><th>Started</th><th>Completed</th><th>Status</th></tr></thead>' +
'<tbody>' + (rows || '<tr><td colspan="8" class="mut c">No phases.</td></tr>') + '</tbody>' +
(phases.length ? '<tfoot><tr><td colspan="4">Total time tracked</td><td class="mono r">' + longDur(totalMs) + '</td><td colspan="3"></td></tr></tfoot>' : '') + '</table>' +
gantt +
'<div class="sec-t">Comments</div><div class="cmts">' + comments + '</div>' +
'<div class="foot"><div class="sign"><div class="line"></div>Authorised signature</div><div class="note">Generated by Epal Group ERP<br>' + fmtDT(Date.now()) + '</div></div>' +
'</div><script>window.onload=function(){setTimeout(function(){window.print();},350);};<\/script></body></html>';

    var w = window.open('', '_blank');
    if (!w) { ui.toast('Allow pop-ups to print the task report', 'error'); return; }
    w.document.open(); w.document.write(html); w.document.close();
  }
  function getRunningElapsed(node) {
    try { var d = JSON.parse(node.getAttribute('data-live-phase')); return (d.accumMs || 0) + (Date.now() - d.startedAt); }
    catch (e) { return null; }
  }
  // Cap runaway timers (e.g. tab left open overnight) to 8h/phase per session.
  function reconcileTimers(emp) {
    var tasks = db.tasksFor(emp.id), changed = false;
    tasks.forEach(function (t) { (t.phases || []).forEach(function (p) {
      if (p.running && p.startedAt && Date.now() - p.startedAt > 8 * 3600e3) {
        p.accumMs += 8 * 3600e3; p.running = false; changed = true;
      }
    }); if (changed) db.saveTask(emp.id, t); });
  }

  // Register for group oversight AND any company's own /tasks route.
  EPAL.view('group/tasks', boardView(true));
  EPAL.view('*/tasks', boardView(false));

})(window.EPAL = window.EPAL || {});
