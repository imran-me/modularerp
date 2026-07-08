/* ============================================================================
 * EPAL GROUP ERP  ·  views/group/notifications.js
 * ----------------------------------------------------------------------------
 * NOTIFICATION CENTER (route: group/notifications) — the group-wide inbox.
 *
 * Every alert the system raises (sales, automation runs, visa approvals, risk
 * flags…) lands in the notifications store and is managed here: a full
 * data table with level filter, unread pills, search, CSV export, per-row
 * mark-read and delete (with confirm), plus one-click "mark all read" and
 * "clear read". A level-mix doughnut shows what the system is shouting about,
 * and a Preferences card persists per-category alert switches to the
 * notif_prefs store key.
 *
 * Data: db.notifications(), db.markNotificationsRead(), EPAL.store.removeFrom
 * with a data:changed emit so the topbar bell and dashboards stay in sync.
 * ==========================================================================*/

(function (EPAL) {
  'use strict';
  var ui = EPAL.ui, el = ui.el;
  var db = function () { return EPAL.db; };

  var LEVEL_COLORS = { info: '#2f6bff', success: '#23c17e', warning: '#f4b740', error: '#f0506e' };

  /* ---- tiny shared helpers ------------------------------------------------*/
  function kpi(label, value, icon, foot) {
    return el('div.kpi-card', null, [
      el('div.kpi-top', null, [ el('span.kpi-label', { text: label }),
        el('span.kpi-ico', { html: '<i class="bi bi-' + icon + '"></i>' }) ]),
      el('div.kpi-value', { text: String(value) }),
      foot ? el('div.kpi-foot', null, [ el('span.text-muted', { text: foot }) ]) : null
    ]);
  }
  function coBadge(cid) {
    var co = EPAL.config.company(cid);
    if (!co) return '<span class="badge">' + ui.escapeHtml(cid || 'group') + '</span>';
    return '<span class="badge" style="color:' + co.accent + '">' + ui.escapeHtml(co.short) + '</span>';
  }
  function startOfToday() {
    var d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime();
  }

  /* ==========================================================================
   * VIEW
   * ========================================================================*/
  EPAL.view('group/notifications', { render: function (ctx) {
    var page = el('div.page');
    var mode = 'all';                       // all | unread | read (pill state)

    var all = db().notifications();
    var unread = all.filter(function (n) { return !n.read; });
    var today = all.filter(function (n) { return (n.at || 0) >= startOfToday(); });
    var critical = all.filter(function (n) { return n.level === 'error'; });

    function redraw() { EPAL.router.render(); }

    page.appendChild(EPAL.pageHead({
      eyebrow: 'Epal Group · Command Layer', icon: 'bell-fill', title: 'Notification Center',
      sub: 'Every alert, approval and system signal across all sister concerns — triage it here.',
      actions: [
        el('button.btn.btn-ghost', { html: ui.icon('trash3') + ' Clear Read', onclick: function () {
          var read = db().notifications().filter(function (n) { return n.read; });
          if (!read.length) { ui.toast('Nothing to clear — no read notifications', 'info'); return; }
          ui.confirm({ title: 'Clear ' + read.length + ' read notifications?',
            text: 'Unread notifications are kept. This cannot be undone.',
            danger: true, confirmLabel: 'Clear' }).then(function (ok) {
            if (!ok) return;
            EPAL.store.set('notifications', db().notifications().filter(function (n) { return !n.read; }));
            EPAL.bus.emit('data:changed', { store: 'notifications' });
            ui.toast('Read notifications cleared', 'success');
            redraw();
          });
        } }),
        el('button.btn.btn-primary', { html: ui.icon('check2-all') + ' Mark All Read', onclick: function () {
          db().markNotificationsRead();
          ui.toast('All notifications marked read', 'success');
          redraw();
        } })
      ]
    }));

    /* ---- KPI row ---------------------------------------------------------*/
    page.appendChild(el('div.kpi-grid.stagger', null, [
      kpi('Unread', unread.length, 'envelope-exclamation-fill', 'awaiting your attention'),
      kpi('Today', today.length, 'calendar2-day', 'received since midnight'),
      kpi('Critical', critical.length, 'exclamation-octagon-fill', 'error-level alerts'),
      kpi('Total', all.length, 'bell', 'in the notification store')
    ]));

    /* ---- level mix + preferences -----------------------------------------*/
    var mixId = ui.uid('nmix');
    var row = el('div.two-col');
    row.appendChild(el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon('pie-chart') + ' Alert Mix' }),
        el('span.card-sub', { text: 'by severity level' }) ]),
      el('div.card-body', null, [
        el('div', { style: { height: '220px', position: 'relative' } }, [ el('canvas', { id: mixId }) ])
      ])
    ]));
    row.appendChild(prefsCard());
    page.appendChild(row);

    /* ---- pills + table ----------------------------------------------------*/
    page.appendChild(el('div.section-label', { text: 'Inbox' }));
    var pills = el('div.pill-tab.mb-3');
    [['all', 'All'], ['unread', 'Unread'], ['read', 'Read']].forEach(function (p) {
      pills.appendChild(el('button' + (mode === p[0] ? '.active' : ''), { text: p[1], onclick: function (e) {
        mode = p[0];
        ui.$$('button', pills).forEach(function (b) { b.classList.remove('active'); });
        e.target.classList.add('active');
        table.refresh();
      } }));
    });
    page.appendChild(el('div', null, [pills]));

    function rows() {
      var list = db().notifications();
      if (mode === 'unread') list = list.filter(function (n) { return !n.read; });
      if (mode === 'read') list = list.filter(function (n) { return n.read; });
      return list;
    }

    var table = EPAL.table({
      columns: [
        { key: 'level', label: 'Level', badge: { error: 'bad', warning: 'warn', success: 'good', info: 'info' } },
        { key: 'title', label: 'Title', render: function (n) {
          return '<span class="strong">' + ui.escapeHtml(n.title || '') + '</span>'; } },
        { key: 'text', label: 'Message', render: function (n) {
          return '<span class="text-mute">' + ui.escapeHtml(n.text || '') + '</span>'; } },
        { key: 'companyId', label: 'Company', render: function (n) { return coBadge(n.companyId); } },
        { key: 'at', label: 'When', render: function (n) {
            return '<span class="text-mute">' + ui.ago(n.at) + '</span>'; },
          sortVal: function (n) { return n.at || 0; },
          exportVal: function (n) { return n.at ? new Date(n.at).toISOString() : ''; } },
        { key: 'read', label: 'State', render: function (n) {
            return n.read ? '<span class="badge badge-good">Read</span>' : '<span class="badge badge-warn">Unread</span>'; },
          sortVal: function (n) { return n.read ? 1 : 0; },
          exportVal: function (n) { return n.read ? 'read' : 'unread'; } }
      ],
      rows: rows,
      filters: [{ key: 'level', label: 'Level' }],
      searchKeys: ['title', 'text', 'companyId'],
      exportName: 'group-notifications.csv',
      pageSize: 12,
      actions: [
        { icon: 'check2-circle', title: 'Mark read', onClick: function (n) {
          if (n.read) { ui.toast('Already read', 'info'); return; }
          n.read = true;
          db().save('notifications', n);
          ui.toast('Marked read', 'success');
          redraw();
        } },
        { icon: 'trash', title: 'Delete', onClick: function (n) {
          ui.confirm({ title: 'Delete this notification?',
            text: (n.title || 'This notification') + ' will be removed permanently.',
            danger: true, confirmLabel: 'Delete' }).then(function (ok) {
            if (!ok) return;
            EPAL.store.removeFrom('notifications', n.id);
            EPAL.bus.emit('data:changed', { store: 'notifications' });
            ui.toast('Notification deleted', 'success');
            redraw();
          });
        } }
      ],
      empty: { icon: 'bell-slash', title: 'No notifications here', hint: 'You are all caught up.' }
    });
    page.appendChild(el('div.card', null, [ el('div.card-pad', null, [ table.el ]) ]));

    ctx.mount.appendChild(page);

    requestAnimationFrame(function () {
      var c = document.getElementById(mixId);
      if (!c) return;
      var counts = {};
      all.forEach(function (n) { var l = n.level || 'info'; counts[l] = (counts[l] || 0) + 1; });
      var labels = Object.keys(counts);
      if (!labels.length) return;
      EPAL.charts.doughnut(c, {
        labels: labels,
        data: labels.map(function (l) { return counts[l]; }),
        colors: labels.map(function (l) { return LEVEL_COLORS[l] || '#8b93a7'; }),
        legend: 'bottom'
      });
    });
  } });

  /* ---- preferences card (persisted to notif_prefs) --------------------------*/
  function prefsCard() {
    var prefs = EPAL.store.get('notif_prefs', {
      saleAlerts: true, riskAlerts: true, taskComments: true, hrEvents: true
    }) || {};

    var form = EPAL.form([
      { key: 'saleAlerts', label: 'Sale alerts — notify on every completed sale', type: 'checkbox', default: true },
      { key: 'riskAlerts', label: 'Risk alerts — company health crossing the watch line', type: 'checkbox', default: true },
      { key: 'taskComments', label: 'Task comments — replies on employee task boards', type: 'checkbox', default: true },
      { key: 'hrEvents', label: 'HR events — joiners, leaves and payroll runs', type: 'checkbox', default: true }
    ], prefs);

    return el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon('sliders') + ' Preferences' }),
        el('span.card-sub', { text: 'which events raise alerts' }) ]),
      el('div.card-body', null, [
        form.el,
        el('div.flex.justify-between.items-center.mt-2', null, [
          el('span.text-mute.xs', { text: 'Stored group-wide · applies to the owner account.' }),
          el('button.btn.btn-primary', { html: ui.icon('check-lg') + ' Save Preferences', onclick: function () {
            EPAL.store.set('notif_prefs', form.values());
            ui.toast('Notification preferences saved', 'success');
          } })
        ])
      ])
    ]);
  }

})(window.EPAL = window.EPAL || {});
