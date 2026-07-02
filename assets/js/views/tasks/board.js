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
            var t = getRunningElapsed(n); if (t != null) n.textContent = ui.dur(t);
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

      // overall progress
      body.appendChild(el('div.flex.items-center.gap-2.mb-2', null, [
        el('div.flex-1', null, [ el('div.progress', null, [ el('div.progress-bar', { style:{ width: pct + '%' } }) ]) ]),
        el('strong', { text: pct + '%' })
      ]));

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

  function phaseRow(emp, t, p, redraw, refresh) {
    var elapsed = phaseElapsed(p);
    var row = el('div.phase' + (p.done ? '.done' : ''), null, [
      el('div.phase-main', null, [
        el('div.phase-name', { text: p.name }),
        el('div.phase-time' + (p.running ? '.running' : ''), null, [
          p.running ? ui.frag('<span class="rec-dot"></span> ') : null,
          el('span', p.running ? { 'data-live-phase': JSON.stringify({ accumMs: p.accumMs, startedAt: p.startedAt }) } : {}, ui.dur(elapsed))
        ])
      ]),
      el('div.flex.items-center.gap-2', null, [
        el('div.progress', { style:{ width:'70px' } }, [ el('div.progress-bar', { style:{ width: p.pct + '%' } }) ]),
        el('small.mono', { text: p.pct + '%' })
      ]),
      el('div.phase-controls')
    ]);
    var ctr = row.querySelector('.phase-controls');
    if (!p.done) {
      if (!p.running) {
        ctr.appendChild(el('button.btn.btn-sm.btn-ghost', { html: ui.icon('play-fill'), title:'Start', onclick: function () {
          // auto-pause other running phases (one timer at a time)
          (t.phases || []).forEach(function (o) { if (o.running) { o.accumMs += Date.now() - o.startedAt; o.running = false; } });
          p.running = true; p.startedAt = Date.now(); if (t.status === 'todo') t.status = 'inprogress';
          db.saveTask(emp.id, t); redraw(); refresh();
        } }));
      } else {
        ctr.appendChild(el('button.btn.btn-sm.btn-ghost', { html: ui.icon('pause-fill'), title:'Pause', onclick: function () {
          p.accumMs += Date.now() - p.startedAt; p.running = false; db.saveTask(emp.id, t); redraw(); refresh();
        } }));
      }
      ctr.appendChild(el('button.btn.btn-sm.btn-primary', { html: ui.icon('check-lg'), title:'Mark phase done', onclick: function () {
        if (p.running) { p.accumMs += Date.now() - p.startedAt; p.running = false; }
        p.done = true; p.pct = 100;
        db.saveTask(emp.id, t);
        // if all phases done → move task to Completed
        if ((t.phases || []).every(function (x) { return x.done; })) { t.status = 'done'; db.saveTask(emp.id, t); ui.toast('All phases done — task completed!', 'success'); }
        redraw(); refresh();
      } }));
    } else {
      ctr.appendChild(el('span.badge.badge-good', { html: ui.icon('check') + ' Done' }));
    }
    // quick % setter
    var pctInput = el('input', { type:'range', min:'0', max:'100', step:'25', value: String(p.pct),
      oninput: function () { p.pct = +pctInput.value; p.done = p.pct >= 100; db.saveTask(emp.id, t); redraw(); refresh(); } });
    return el('div', null, [ row ]);
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
  function taskProgress(t) {
    var ph = t.phases || []; if (!ph.length) return t.status === 'done' ? 100 : 0;
    return Math.round(ph.reduce(function (a, p) { return a + (p.pct || 0); }, 0) / ph.length);
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
