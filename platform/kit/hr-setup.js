/* ============================================================================
 * EPAL KIT · HR SETUP + NOTICEBOARD  (ported from the production Laravel ERP)
 * ----------------------------------------------------------------------------
 * Production parity:
 *   ShiftController      → shifts:      name, start_time, end_time, holidays[]
 *                          (weekly off days — array on the model)
 *   HolidayController    → holidays:    name, start_date, end_date, note
 *   LeaveTypeController  → leave types: name, max_leaves_count,
 *                          requires_time, exempts_early_out_deduction
 *   NoticeController     → notices:     company_id, department, title,
 *                          description, publish_date, expiry_date,
 *                          status draft|published
 *
 * Scoping mirrors production: shifts / holidays / leave types are GROUP-WIDE
 * (their models carry no company_id); notices are PER COMPANY.
 *
 * Exposes:
 *   EPAL.hrSetup(page, cid)      — the three config cards (Shifts · Holidays ·
 *                                  Leave Types) stacked on one screen
 *   EPAL.noticeBoard(page, cid)  — the company noticeboard (draft/published,
 *                                  publish + expiry window, active badges)
 *   EPAL.leaveTypeNames()        — names for leave forms (falls back sanely)
 *
 * LARAVEL HANDOFF: each card maps 1:1 onto the production controller of the
 * same name — reuse those controllers/models as-is; only the Blade views need
 * the layout shown here.
 * ==========================================================================*/
(function (EPAL) {
  'use strict';
  var ui = EPAL.ui, el = ui.el, S = EPAL.store;
  function esc(s) { return ui.escapeHtml(String(s == null ? '' : s)); }
  function todayStr() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  var WEEKDAYS = ['Friday', 'Saturday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday'];
  var TIME_RX = /^([01]\d|2[0-3]):[0-5]\d$/;

  /* ---- seeds (Bangladesh calendar + the usual duty patterns) --------------*/
  EPAL.registerEngine({ name: 'hr-setup-seed', seed: function () {
    S.seedOnce('hr_shifts', [
      { id: 'SH-OFFICE', name: 'Office Day', start: '09:00', end: '18:00', daysOff: ['Friday', 'Saturday'] },
      { id: 'SH-EVENING', name: 'Showroom Evening', start: '12:00', end: '21:00', daysOff: ['Friday'] },
      { id: 'SH-FACTORY', name: 'Factory Morning', start: '08:00', end: '17:00', daysOff: ['Friday'] }
    ]);
    S.seedOnce('hr_holidays', [
      { id: 'HD-1', name: 'Shaheed Day & Int. Mother Language Day', start: '2026-02-21', end: '2026-02-21', note: 'National' },
      { id: 'HD-2', name: 'Eid-ul-Fitr', start: '2026-03-20', end: '2026-03-22', note: 'Subject to moon sighting' },
      { id: 'HD-3', name: 'Independence Day', start: '2026-03-26', end: '2026-03-26', note: 'National' },
      { id: 'HD-4', name: 'Pahela Baishakh', start: '2026-04-14', end: '2026-04-14', note: 'Bengali New Year' },
      { id: 'HD-5', name: 'May Day', start: '2026-05-01', end: '2026-05-01', note: 'National' },
      { id: 'HD-6', name: 'Eid-ul-Adha', start: '2026-05-27', end: '2026-05-29', note: 'Subject to moon sighting' },
      { id: 'HD-7', name: 'National Mourning Day', start: '2026-08-15', end: '2026-08-15', note: 'National' },
      { id: 'HD-8', name: 'Victory Day', start: '2026-12-16', end: '2026-12-16', note: 'National' },
      { id: 'HD-9', name: 'Christmas Day', start: '2026-12-25', end: '2026-12-25', note: 'National' }
    ]);
    S.seedOnce('hr_leave_types', [
      { id: 'LT-CAS', name: 'Casual', maxPerYear: 10, requiresTime: false, exemptsEarlyOut: false },
      { id: 'LT-SICK', name: 'Sick', maxPerYear: 14, requiresTime: false, exemptsEarlyOut: false },
      { id: 'LT-ANN', name: 'Annual', maxPerYear: 15, requiresTime: false, exemptsEarlyOut: false },
      { id: 'LT-MAT', name: 'Maternity', maxPerYear: 120, requiresTime: false, exemptsEarlyOut: false },
      { id: 'LT-PAT', name: 'Paternity', maxPerYear: 7, requiresTime: false, exemptsEarlyOut: false },
      { id: 'LT-SHORT', name: 'Short Leave', maxPerYear: 12, requiresTime: true, exemptsEarlyOut: true },
      { id: 'LT-UNP', name: 'Unpaid', maxPerYear: 30, requiresTime: false, exemptsEarlyOut: false }
    ]);
    S.seedOnce('hr_notices', [
      { id: 'NT-1', companyId: 'travels', dept: 'All Departments', title: 'Eid-ul-Adha office closure', status: 'published',
        publish: '2026-05-20', expiry: '2026-05-30', desc: 'Office remains closed 27–29 May for Eid-ul-Adha. Emergency ticketing desk stays on-call.', by: 'HR' },
      { id: 'NT-2', companyId: 'travels', dept: 'Accounts', title: 'June salary sheet sign-off', status: 'published',
        publish: '2026-07-01', expiry: '2026-07-20', desc: 'Department heads must sign off attendance corrections before the 20th.', by: 'HR' },
      { id: 'NT-3', companyId: 'travels', dept: 'Sales', title: 'Umrah season briefing (draft)', status: 'draft',
        publish: '2026-07-25', expiry: '2026-08-10', desc: 'Package pricing + vendor SLAs for the coming Umrah season.', by: 'HR' }
    ]);
  } });

  function can(cid) { return !EPAL.perm || EPAL.perm.can(cid || 'travels', 'hrm', 'create'); }

  /* ==========================================================================
   * SHIFTS · HOLIDAYS · LEAVE TYPES — one stacked setup screen
   * ========================================================================*/
  EPAL.hrSetup = function (page, cid) {
    var editable = can(cid);

    /* ---- 1) SHIFTS ---------------------------------------------------------*/
    var shifts = S.list('hr_shifts');
    var st = EPAL.table({
      columns: [
        { key: 'name', label: 'Shift', render: function (s) { return '<span class="strong">' + esc(s.name) + '</span>'; } },
        { key: 'start', label: 'Starts', render: function (s) { return '<span class="num">' + esc(s.start) + '</span>'; } },
        { key: 'end', label: 'Ends', render: function (s) { return '<span class="num">' + esc(s.end) + '</span>'; } },
        { key: 'hours', label: 'Duty Hours', num: true, render: function (s) {
          var h = (parseInt(s.end, 10) * 60 + parseInt(s.end.slice(3), 10) - parseInt(s.start, 10) * 60 - parseInt(s.start.slice(3), 10)) / 60;
          return (h < 0 ? h + 24 : h).toFixed(1) + 'h';
        }, sortVal: function (s) { return parseInt(s.end, 10) - parseInt(s.start, 10); } },
        { key: 'daysOff', label: 'Weekly Off', render: function (s) { return (s.daysOff || []).length ? (s.daysOff || []).map(function (d) { return '<span class="badge">' + esc(d) + '</span>'; }).join(' ') : '—'; }, exportVal: function (s) { return (s.daysOff || []).join('; '); } }
      ],
      rows: shifts, pageSize: 8, exportName: 'shifts.csv',
      actions: editable ? ui.actions({
        edit: function (s) { shiftForm(s); },
        del: function (s) { ui.confirm({ title: 'Delete shift "' + s.name + '"?', danger: true, confirmLabel: 'Delete' }).then(function (ok) { if (ok) { S.removeFrom('hr_shifts', s.id); ui.toast('Deleted', 'success'); EPAL.router.render(); } }); }
      }) : [],
      empty: { icon: 'clock', title: 'No shifts defined' }
    });
    page.appendChild(el('div.card.mb-2', null, [
      el('div.card-head', null, [el('h3', { html: ui.icon('clock') + ' Shifts' }), el('span.card-sub', { text: 'duty windows + weekly off days' }),
        editable ? el('button.btn.btn-sm.btn-primary', { style: { marginLeft: 'auto' }, html: ui.icon('plus-lg') + ' Add Shift', onclick: function () { shiftForm(null); } }) : null]),
      el('div.card-body', null, [st.el])
    ]));

    /* ---- 2) HOLIDAYS -------------------------------------------------------*/
    var hols = S.list('hr_holidays').slice().sort(function (a, b) { return (a.start || '') < (b.start || '') ? -1 : 1; });
    var today = todayStr();
    var ht = EPAL.table({
      columns: [
        { key: 'name', label: 'Holiday', render: function (h) {
          var upcoming = (h.end || h.start) >= today;
          return '<span class="strong' + (upcoming ? '' : ' text-mute') + '">' + esc(h.name) + '</span>' + (upcoming ? '' : ' <span class="badge">past</span>');
        } },
        { key: 'start', label: 'From', date: true },
        { key: 'end', label: 'To', date: true },
        { key: 'days', label: 'Days', num: true, render: function (h) {
          var ms = (new Date(h.end + 'T00:00:00') - new Date(h.start + 'T00:00:00'));
          return String(Math.round(ms / 86400000) + 1);
        }, sortVal: function (h) { return (new Date(h.end)) - (new Date(h.start)); } },
        { key: 'note', label: 'Note', render: function (h) { return esc(h.note || '—'); } }
      ],
      rows: hols, pageSize: 10, exportName: 'holidays.csv', searchKeys: ['name', 'note'],
      actions: editable ? ui.actions({
        edit: function (h) { holidayForm(h); },
        del: function (h) { ui.confirm({ title: 'Delete holiday "' + h.name + '"?', danger: true, confirmLabel: 'Delete' }).then(function (ok) { if (ok) { S.removeFrom('hr_holidays', h.id); ui.toast('Deleted', 'success'); EPAL.router.render(); } }); }
      }) : [],
      empty: { icon: 'calendar-heart', title: 'No holidays yet' }
    });
    page.appendChild(el('div.card.mb-2', null, [
      el('div.card-head', null, [el('h3', { html: ui.icon('calendar-heart') + ' Holidays' }), el('span.card-sub', { text: 'the group holiday calendar' }),
        editable ? el('button.btn.btn-sm.btn-primary', { style: { marginLeft: 'auto' }, html: ui.icon('plus-lg') + ' Add Holiday', onclick: function () { holidayForm(null); } }) : null]),
      el('div.card-body', null, [ht.el])
    ]));

    /* ---- 3) LEAVE TYPES ----------------------------------------------------*/
    var types = S.list('hr_leave_types');
    var lt = EPAL.table({
      columns: [
        { key: 'name', label: 'Leave Type', render: function (r) { return '<span class="strong">' + esc(r.name) + '</span>'; } },
        { key: 'maxPerYear', label: 'Max / Year', num: true },
        { key: 'requiresTime', label: 'Needs Time Slot', render: function (r) { return r.requiresTime ? '<span class="badge badge-info">Yes</span>' : '—'; }, exportVal: function (r) { return r.requiresTime ? 'Yes' : 'No'; } },
        { key: 'exemptsEarlyOut', label: 'Exempts Early-out Deduction', render: function (r) { return r.exemptsEarlyOut ? '<span class="badge badge-good">Yes</span>' : '—'; }, exportVal: function (r) { return r.exemptsEarlyOut ? 'Yes' : 'No'; } }
      ],
      rows: types, pageSize: 10, exportName: 'leave-types.csv',
      actions: editable ? ui.actions({
        edit: function (r) { leaveTypeForm(r); },
        del: function (r) { ui.confirm({ title: 'Delete leave type "' + r.name + '"?', danger: true, confirmLabel: 'Delete' }).then(function (ok) { if (ok) { S.removeFrom('hr_leave_types', r.id); ui.toast('Deleted', 'success'); EPAL.router.render(); } }); }
      }) : [],
      empty: { icon: 'calendar2-week', title: 'No leave types' }
    });
    page.appendChild(el('div.card', null, [
      el('div.card-head', null, [el('h3', { html: ui.icon('calendar2-week') + ' Leave Types' }), el('span.card-sub', { text: 'used by the leave register forms' }),
        editable ? el('button.btn.btn-sm.btn-primary', { style: { marginLeft: 'auto' }, html: ui.icon('plus-lg') + ' Add Leave Type', onclick: function () { leaveTypeForm(null); } }) : null]),
      el('div.card-body', null, [lt.el])
    ]));

    function shiftForm(s) {
      EPAL.formModal({
        title: s ? 'Edit Shift' : 'Add Shift', icon: 'clock', size: 'sm',
        record: s ? { name: s.name, start: s.start, end: s.end, daysOffText: (s.daysOff || []).join(', ') } : { start: '09:00', end: '18:00', daysOffText: 'Friday' },
        fields: [
          { key: 'name', label: 'Shift name', type: 'text', required: true, placeholder: 'e.g. Office Day' },
          { key: 'start', label: 'Start time (24h)', type: 'text', required: true, pattern: TIME_RX, placeholder: '09:00', hint: 'HH:MM' },
          { key: 'end', label: 'End time (24h)', type: 'text', required: true, pattern: TIME_RX, placeholder: '18:00', hint: 'HH:MM' },
          { key: 'daysOffText', label: 'Weekly off days (comma-separated)', type: 'text', col2: true, placeholder: 'Friday, Saturday', hint: WEEKDAYS.join(' · ') }
        ],
        saveLabel: s ? 'Save' : 'Add',
        onSave: function (v) {
          if (!TIME_RX.test(v.start) || !TIME_RX.test(v.end)) { ui.toast('Times must be HH:MM (24h)', 'error'); return false; }
          var days = (v.daysOffText || '').split(',').map(function (d) { return d.trim(); }).filter(Boolean)
            .map(function (d) { return WEEKDAYS.filter(function (w) { return w.toLowerCase() === d.toLowerCase(); })[0] || d; });
          var r = s || { id: 'SH-' + ui.uid('').slice(-5).toUpperCase() };
          r.name = (v.name || '').trim(); r.start = v.start; r.end = v.end; r.daysOff = days;
          S.upsert('hr_shifts', r);
          ui.toast('Shift saved', 'success'); EPAL.router.render(); return true;
        }
      });
    }
    function holidayForm(h) {
      EPAL.formModal({
        title: h ? 'Edit Holiday' : 'Add Holiday', icon: 'calendar-heart', size: 'sm',
        record: h || { start: todayStr(), end: todayStr() },
        fields: [
          { key: 'name', label: 'Holiday name', type: 'text', required: true },
          { key: 'start', label: 'From', type: 'date', required: true },
          { key: 'end', label: 'To', type: 'date', required: true },
          { key: 'note', label: 'Note', type: 'text', col2: true, placeholder: 'e.g. National / moon sighting' }
        ],
        saveLabel: h ? 'Save' : 'Add',
        onSave: function (v) {
          if ((v.end || '') < (v.start || '')) { ui.toast('"To" cannot be before "From"', 'error'); return false; }
          var r = h || { id: 'HD-' + ui.uid('').slice(-5).toUpperCase() };
          r.name = (v.name || '').trim(); r.start = v.start; r.end = v.end; r.note = v.note || '';
          S.upsert('hr_holidays', r);
          ui.toast('Holiday saved', 'success'); EPAL.router.render(); return true;
        }
      });
    }
    function leaveTypeForm(r0) {
      EPAL.formModal({
        title: r0 ? 'Edit Leave Type' : 'Add Leave Type', icon: 'calendar2-week', size: 'sm',
        record: r0 || { maxPerYear: 10 },
        fields: [
          { key: 'name', label: 'Name', type: 'text', required: true },
          { key: 'maxPerYear', label: 'Max leaves / year', type: 'number', required: true, min: 0, max: 366 },
          { key: 'requiresTime', label: 'Requires a time slot (hour leave)', type: 'checkbox' },
          { key: 'exemptsEarlyOut', label: 'Exempts the early-out deduction', type: 'checkbox' }
        ],
        saveLabel: r0 ? 'Save' : 'Add',
        onSave: function (v) {
          var name = (v.name || '').trim(); if (!name) { ui.toast('Enter a name', 'error'); return false; }
          var dupe = S.list('hr_leave_types').some(function (x) { return x.name.toLowerCase() === name.toLowerCase() && (!r0 || x.id !== r0.id); });
          if (dupe) { ui.toast('"' + name + '" already exists', 'error'); return false; }
          var r = r0 || { id: 'LT-' + ui.uid('').slice(-5).toUpperCase() };
          r.name = name; r.maxPerYear = +v.maxPerYear || 0; r.requiresTime = !!v.requiresTime; r.exemptsEarlyOut = !!v.exemptsEarlyOut;
          S.upsert('hr_leave_types', r);
          ui.toast('Leave type saved', 'success'); EPAL.router.render(); return true;
        }
      });
    }
  };

  /* leave forms everywhere read the configured names (with a sane fallback) */
  EPAL.leaveTypeNames = function () {
    var names = S.list('hr_leave_types').map(function (t) { return t.name; });
    return names.length ? names : ['Annual', 'Sick', 'Casual', 'Unpaid'];
  };

  /* ==========================================================================
   * NOTICEBOARD — per company, draft/published with a publish→expiry window
   * ========================================================================*/
  EPAL.noticeBoard = function (page, cid) {
    var editable = can(cid);
    var today = todayStr();
    var list = S.list('hr_notices').filter(function (n) { return (n.companyId || 'travels') === cid; })
      .slice().sort(function (a, b) { return (a.publish || '') < (b.publish || '') ? 1 : -1; });
    function isLive(n) { return n.status === 'published' && (n.publish || '') <= today && (n.expiry || '9999') >= today; }
    var live = list.filter(isLive);

    page.appendChild(el('div.kpi-grid.kpi-compact.stagger', null, [
      (function () { var k = el('div.kpi-card'); k.appendChild(el('div.kpi-top', null, [el('span.kpi-label', { text: 'Notices' }), el('span.kpi-ico', { html: ui.icon('megaphone') })])); k.appendChild(el('div.kpi-value', { text: String(list.length) })); return k; })(),
      (function () { var k = el('div.kpi-card'); k.appendChild(el('div.kpi-top', null, [el('span.kpi-label', { text: 'Active Now' }), el('span.kpi-ico', { html: ui.icon('broadcast') })])); k.appendChild(el('div.kpi-value.text-good', { text: String(live.length) })); return k; })(),
      (function () { var k = el('div.kpi-card'); k.appendChild(el('div.kpi-top', null, [el('span.kpi-label', { text: 'Drafts' }), el('span.kpi-ico', { html: ui.icon('pencil-square') })])); k.appendChild(el('div.kpi-value', { text: String(list.filter(function (n) { return n.status === 'draft'; }).length) })); return k; })()
    ]));
    if (editable) page.appendChild(el('div.mb-2', null, [el('button.btn.btn-sm.btn-primary', { html: ui.icon('plus-lg') + ' Add Notice', onclick: function () { noticeForm(null); } })]));

    // live notices as cards — what the team actually reads
    if (live.length) {
      var wrap = el('div.grid-auto.kpi-compact.stagger.mb-3');
      live.slice(0, 6).forEach(function (n) {
        wrap.appendChild(el('div.card', { style: { cursor: 'pointer' }, onclick: function () { noticeDetail(n); } }, [
          el('div.card-pad', null, [
            el('div.flex.items-center.gap-2', null, [
              ui.frag('<span class="notif-ico notif-info">' + ui.icon('megaphone') + '</span>'),
              el('div.flex-1', null, [
                el('div.fw-700', { text: n.title }),
                el('div.text-mute.xs', { text: (n.dept || 'All Departments') + ' · until ' + ui.date(n.expiry) })
              ])
            ]),
            el('div.text-mute.sm.mt-1', { text: String(n.desc || '').slice(0, 90) + (String(n.desc || '').length > 90 ? '…' : '') })
          ])
        ]));
      });
      page.appendChild(el('div.section-label.mt-0', { text: 'On the board now' }));
      page.appendChild(wrap);
    }

    var tbl = EPAL.table({
      columns: [
        { key: 'title', label: 'Title', render: function (n) { return '<span class="strong">' + esc(n.title) + '</span>'; } },
        { key: 'dept', label: 'Department', render: function (n) { return esc(n.dept || 'All Departments'); } },
        { key: 'publish', label: 'Publish', date: true },
        { key: 'expiry', label: 'Expires', date: true },
        { key: 'status', label: 'Status', render: function (n) {
          if (n.status === 'draft') return '<span class="badge">Draft</span>';
          return isLive(n) ? '<span class="badge badge-good">Live</span>' : '<span class="badge badge-warn">Published (off-window)</span>';
        }, exportVal: function (n) { return n.status; } }
      ],
      rows: list, pageSize: 10, searchKeys: ['title', 'dept', 'desc'], exportName: 'notices.csv',
      quickFilter: 'status', dateKey: 'publish',
      onRow: function (n) { noticeDetail(n); },
      actions: editable ? [
        { icon: 'pencil', title: 'Edit', onClick: function (n) { noticeForm(n); } },
        { icon: 'broadcast', title: 'Publish / unpublish', onClick: function (n) {
          n.status = n.status === 'published' ? 'draft' : 'published';
          S.upsert('hr_notices', n);
          ui.toast(n.status === 'published' ? 'Published' : 'Moved to drafts', 'success'); EPAL.router.render();
        } },
        { icon: 'trash', title: 'Delete', onClick: function (n) {
          ui.confirm({ title: 'Delete notice "' + n.title + '"?', danger: true, confirmLabel: 'Delete' })
            .then(function (ok) { if (ok) { S.removeFrom('hr_notices', n.id); ui.toast('Deleted', 'success'); EPAL.router.render(); } });
        } }
      ] : [],
      empty: { icon: 'megaphone', title: 'No notices yet', hint: 'Post the first one with Add Notice.' }
    });
    page.appendChild(el('div.card', null, [
      el('div.card-head', null, [el('h3', { html: ui.icon('megaphone') + ' All Notices' })]),
      el('div.card-body', null, [tbl.el])
    ]));

    function noticeDetail(n) {
      var body = el('div', null, [
        el('div.flex.items-center.gap-2.mb-2', null, [
          el('span.badge' + (n.status === 'draft' ? '' : isLive(n) ? '.badge-good' : '.badge-warn'), { text: n.status === 'draft' ? 'Draft' : isLive(n) ? 'Live' : 'Off-window' }),
          el('span.text-mute.sm', { text: (n.dept || 'All Departments') + ' · ' + ui.date(n.publish) + ' → ' + ui.date(n.expiry) })
        ]),
        el('div', { text: n.desc || '—' })
      ]);
      ui.modal({ title: n.title, icon: 'megaphone', size: 'md', body: body, footer: false });
    }
    function noticeForm(n) {
      EPAL.formModal({
        title: n ? 'Edit Notice' : 'Add Notice', icon: 'megaphone', size: 'md',
        record: n || { status: 'draft', publish: today, dept: 'All Departments' },
        fields: [
          { key: 'title', label: 'Title', type: 'text', required: true, col2: true },
          { key: 'dept', label: 'Department', type: 'text', placeholder: 'All Departments' },
          { key: 'status', label: 'Status', type: 'select', options: [['draft', 'Draft'], ['published', 'Published']], default: 'draft' },
          { key: 'publish', label: 'Publish date', type: 'date', required: true },
          { key: 'expiry', label: 'Expiry date', type: 'date', required: true },
          { key: 'desc', label: 'Notice body', type: 'textarea', col2: true, required: true }
        ],
        saveLabel: n ? 'Save' : 'Add',
        onSave: function (v) {
          if ((v.expiry || '') < (v.publish || '')) { ui.toast('Expiry cannot be before publish', 'error'); return false; }
          var r = n || { id: 'NT-' + ui.uid('').slice(-5).toUpperCase(), companyId: cid, by: 'HR' };
          r.title = (v.title || '').trim(); r.dept = (v.dept || '').trim() || 'All Departments';
          r.status = v.status || 'draft'; r.publish = v.publish; r.expiry = v.expiry; r.desc = v.desc || '';
          S.upsert('hr_notices', r);
          ui.toast('Notice saved', 'success'); EPAL.router.render(); return true;
        }
      });
    }
  };
})(window.EPAL = window.EPAL || {});
