/* ============================================================================
 * TRAVELS · FILE MANAGEMENT · LOGIC
 * ----------------------------------------------------------------------------
 * Behaviour only — markup lives in frontend/template.html and is handed to this
 * file (by tools/build/build-module.mjs) as the string TEMPLATE_HTML. This file
 * is NOT an IIFE and has no 'use strict' of its own: the build wraps it in
 * `(function(){ 'use strict'; var TEMPLATE_HTML=…; <this file> })()`.
 *
 * The embassy-submission desk for the Travels vertical: every visa/immigration
 * FILE with its country, agent, submission slot, decision-due date, embassy
 * status and fees. Three screens: files (register + PDF) / add-file / slot-
 * tracker. Data = localStorage store `tv_files` (seeded by seed-bd.js). Reuses
 * the shared datatable / form / print kit exactly as before.
 *
 * ==> LARAVEL / PHP MAPPING: an `EmbassyFile` model + `FileController`
 *     (index/store/update), country + status as enums; fees as a Money cast.
 * ========================================================================== */

var EPAL = window.EPAL, ui = EPAL.ui, el = ui.el, db = EPAL.db, S = EPAL.store;

/* ---- template plumbing: clone a fragment, address its fill-slots ---------- */
var TPL = document.createElement('div');
TPL.innerHTML = TEMPLATE_HTML;
function frag(name) {
  var t = TPL.querySelector('template[data-tpl="' + name + '"]');
  return t.content.firstElementChild.cloneNode(true);
}
function slot(root, name) { return root.querySelector('[data-slot="' + name + '"]'); }

/* ---- data + small helpers (unchanged from the legacy view) ---------------- */
function files() { return (db.col ? db.col('tv_files') : S.list('tv_files')) || []; }
function canCreate() { return !EPAL.perm || EPAL.perm.can('travels', 'file-management', 'create'); }

var STATUS_TONE = { 'Approved': 'good', 'Rejected': 'bad', 'Decision Pending': 'warn', 'Submitted': 'info', 'Slot Booked': 'accent' };
var STATUSES = ['Slot Booked', 'Submitted', 'Decision Pending', 'Approved', 'Rejected'];
var COUNTRIES = ['Cyprus', 'Romania', 'Croatia', 'Malta', 'Serbia', 'Poland', 'Hungary'];
function statusBadge(s) { return el('span.badge' + (STATUS_TONE[s] ? '.badge-' + STATUS_TONE[s] : ''), { text: s || '—' }); }
function daysLeft(d) { if (!d) return null; return Math.round((new Date(d).getTime() - Date.now()) / 86400000); }

function fileMsg(f) {
  return 'Embassy file ' + f.id + '\nApplicant: ' + f.applicant + '\nCountry: ' + f.country +
    '\nStatus: ' + f.embassyStatus + '\nDecision due: ' + (f.decisionDue ? ui.date(f.decisionDue) : '—') +
    '\nTotal: ' + ui.money(f.total) + '\n\n— Epal Travels & Consultancy';
}
function printFile(f) {
  function r(k, v) { return '<tr><td>' + k + '</td><td>' + ui.escapeHtml(String(v == null ? '—' : v)) + '</td></tr>'; }
  ui.printDoc({ title: 'Embassy File · ' + f.id, subtitle: f.applicant + ' · ' + f.country, meta: 'Visa / immigration file',
    bodyHtml: '<table>' + r('Applicant', f.applicant) + r('Passport', f.passport) + r('Country', f.country) +
      r('Agent', f.agent) + r('Submitted', f.submitDate ? ui.date(f.submitDate) : '—') + r('Decision due', f.decisionDue ? ui.date(f.decisionDue) : '—') +
      r('Embassy status', f.embassyStatus) + r('Embassy fee', ui.money(f.embassyFee)) + r('Service fee', ui.money(f.serviceFee)) +
      r('Total', ui.money(f.total)) + r('Payment', f.payStatus) + '</table>' });
}
function fileDetail(f) {
  function kv(k, v) { return el('div.data-row', null, [ el('div.text-mute.sm.flex-1', { text: k }), el('div.strong', { text: v == null ? '—' : String(v) }) ]); }
  ui.modal({ title: f.id + ' · ' + f.applicant, icon: 'folder-fill', size: 'md', body: el('div.data-list', null, [
    kv('Applicant', f.applicant), kv('Passport', f.passport), kv('Country', f.country), kv('Agent', f.agent),
    kv('Submitted', f.submitDate ? ui.date(f.submitDate) : '—'), kv('Decision due', f.decisionDue ? ui.date(f.decisionDue) : '—'),
    kv('Embassy status', f.embassyStatus), kv('Embassy fee', ui.money(f.embassyFee)), kv('Service fee', ui.money(f.serviceFee)),
    kv('Total', ui.money(f.total)), kv('Payment', f.payStatus)
  ]) });
}

var titles = { files: 'File Management', 'add-file': 'Add Embassy File', 'slot-tracker': 'Slot Tracker' };
var descs = { files: 'Every embassy file — country, agent, submission slot, decision-due date and fees.',
  'add-file': 'Open a new embassy file for a visa applicant.',
  'slot-tracker': 'Files with a booked slot or a decision falling due soon.' };

/* one KPI card (frag('kpi') → kpi-card > kpi-top(label,ico) + kpi-value) */
function kpi(label, value, icon) {
  var n = frag('kpi');
  slot(n, 'label').textContent = label;
  slot(n, 'ico').innerHTML = '<i class="bi bi-' + icon + '"></i>';
  slot(n, 'value').textContent = String(value);
  return n;
}

/* section band — labels mirror the registry (config.js subs) */
var SECTIONS = [['files', 'All Files'], ['add-file', 'Add File'], ['slot-tracker', 'Slot Tracker']];
function sectionNav(sub) {
  var nav = frag('nav');
  SECTIONS.forEach(function (s) {
    var btn = frag('nav-btn');
    if (sub === s[0]) btn.classList.add('active');
    btn.textContent = s[1];
    btn.addEventListener('click', function () { EPAL.router.navigate('travels/file-management' + (s[0] === 'files' ? '' : '/' + s[0])); });
    nav.appendChild(btn);
  });
  return nav;
}

EPAL.view('travels/file-management', {
  render: function (ctx) {
    var sub = ctx.subId || 'files';
    var page = frag('page');
    page.appendChild(EPAL.pageHead({
      eyebrow: sub === 'files' ? 'Epal Travels' : 'Travels › File Management',
      icon: 'folder-fill', title: titles[sub] || 'File Management', sub: descs[sub]
    }));
    page.appendChild(sectionNav(sub));
    ({ files: filesView, 'add-file': addFileView, 'slot-tracker': slotView }[sub] || filesView)(page, ctx);
    ctx.mount.appendChild(page);
  }
});

/* ------------------------------------------------------------ all files */
function filesView(page) {
  var list = files();
  var pending = list.filter(function (f) { return ['Submitted', 'Decision Pending', 'Slot Booked'].indexOf(f.embassyStatus) >= 0; });
  var value = list.reduce(function (a, f) { return a + (+f.total || 0); }, 0);
  var grid = frag('kpi-grid');
  grid.appendChild(kpi('Total Files', list.length, 'folder2-open'));
  grid.appendChild(kpi('In Process', pending.length, 'hourglass-split'));
  grid.appendChild(kpi('Approved', list.filter(function (f) { return f.embassyStatus === 'Approved'; }).length, 'patch-check-fill'));
  grid.appendChild(kpi('Fees Value', ui.money(value, { compact: true }), 'cash-coin'));
  page.appendChild(grid);

  var t = EPAL.table({
    columns: [
      { key: 'id', label: 'File', render: function (f) { return '<span class="strong">' + ui.escapeHtml(f.id) + '</span>'; } },
      { key: 'applicant', label: 'Applicant' },
      { key: 'country', label: 'Country', badge: {} },
      { key: 'agent', label: 'Agent' },
      { key: 'submitDate', label: 'Submitted', date: true },
      { key: 'decisionDue', label: 'Decision Due', sortVal: function (f) { return f.decisionDue || ''; },
        render: function (f) { var dl = daysLeft(f.decisionDue); var tone = dl == null ? '' : dl < 0 ? 'text-bad' : dl <= 14 ? 'text-warn' : ''; return '<span class="' + tone + '">' + (f.decisionDue ? ui.date(f.decisionDue) : '—') + '</span>'; } },
      { key: 'embassyStatus', label: 'Status', render: function (f) { return statusBadge(f.embassyStatus).outerHTML; }, sortVal: function (f) { return f.embassyStatus; } },
      { key: 'total', label: 'Total', num: true, money: true },
      { key: 'payStatus', label: 'Payment', render: function (f) { return '<span class="badge' + (f.payStatus === 'Paid' ? ' badge-good' : f.payStatus === 'Partial' ? ' badge-warn' : ' badge-bad') + '">' + ui.escapeHtml(f.payStatus || '—') + '</span>'; }, sortVal: function (f) { return f.payStatus; } }
    ],
    rows: list, searchKeys: ['id', 'applicant', 'passport', 'country', 'agent'],
    quickFilter: 'country', filterPanel: true, filters: [{ key: 'embassyStatus', label: 'Status' }, { key: 'payStatus', label: 'Payment' }],
    dateKey: 'submitDate', pageSize: 12, exportName: 'embassy-files.csv', pdfTitle: 'Embassy Files',
    onRow: function (f) { fileDetail(f); },
    actions: ui.actions({
      print: function (f) { printFile(f); },
      wa:    function (f) { return { phone: '', text: fileMsg(f) }; },
      gmail: function (f) { return { to: '', subject: 'Your ' + f.country + ' file — ' + f.id, body: fileMsg(f) }; }
    }),
    empty: { icon: 'folder', title: 'No files yet', hint: 'Open your first embassy file.' }
  });
  var card = frag('register-card');
  slot(card, 'title').innerHTML = ui.icon('folder-fill') + ' Embassy Files';
  slot(card, 'sub').textContent = list.length + ' on file';
  slot(card, 'body').appendChild(t.el);
  page.appendChild(card);
}

/* ---------------------------------------------------------- add a file */
function addFileView(page) {
  if (!canCreate()) { page.appendChild(frag('add-locked')); return; }
  var host = el('div'); page.appendChild(host);
  var card = frag('add-card');
  slot(card, 'new').addEventListener('click', openForm);
  host.appendChild(card);
  openForm();
  function openForm() {
    EPAL.formModal({
      title: 'New Embassy File', icon: 'folder-plus', size: 'lg',
      fields: [
        { type: 'section', label: 'Applicant' },
        { key: 'applicant', label: 'Applicant name', type: 'text', required: true, col2: true },
        { key: 'passport', label: 'Passport No', type: 'text' },
        { key: 'country', label: 'Destination country', type: 'select', options: COUNTRIES, default: 'Cyprus' },
        { key: 'agent', label: 'Handling agent', type: 'text' },
        { type: 'section', label: 'Embassy' },
        { key: 'embassyStatus', label: 'Status', type: 'select', options: STATUSES, default: 'Slot Booked' },
        { key: 'submitDate', label: 'Submission date', type: 'date' },
        { key: 'decisionDue', label: 'Decision due', type: 'date' },
        { type: 'section', label: 'Fees' },
        { key: 'embassyFee', label: 'Embassy fee', type: 'money', default: 0, min: 0 },
        { key: 'serviceFee', label: 'Service fee', type: 'money', default: 0, min: 0 },
        { key: 'payStatus', label: 'Payment', type: 'select', options: ['Unpaid', 'Partial', 'Paid'], default: 'Unpaid' }
      ],
      saveLabel: 'Create File',
      onSave: function (v) {
        var rec = { id: 'FL-' + ui.uid('').slice(-4).toUpperCase(), applicant: (v.applicant || '').trim(), passport: v.passport,
          country: v.country, agent: v.agent, embassyStatus: v.embassyStatus, submitDate: v.submitDate, decisionDue: v.decisionDue,
          embassyFee: +v.embassyFee || 0, serviceFee: +v.serviceFee || 0, total: (+v.embassyFee || 0) + (+v.serviceFee || 0),
          payStatus: v.payStatus, created: Date.now() };
        db.save('tv_files', rec);
        ui.toast('File ' + rec.id + ' created', 'success');
        EPAL.router.navigate('travels/file-management/files');
        return true;
      }
    });
  }
}

/* -------------------------------------------------------- slot tracker */
function slotView(page) {
  var list = files().filter(function (f) {
    var dl = daysLeft(f.decisionDue);
    return f.embassyStatus === 'Slot Booked' || (dl != null && dl >= 0 && dl <= 30);
  }).sort(function (a, b) { return (a.decisionDue || '') < (b.decisionDue || '') ? -1 : 1; });
  var grid = frag('kpi-grid-compact');
  grid.appendChild(kpi('Slots Booked', files().filter(function (f) { return f.embassyStatus === 'Slot Booked'; }).length, 'calendar-check'));
  grid.appendChild(kpi('Due ≤30 days', list.length, 'hourglass-split'));
  grid.appendChild(kpi('Overdue', files().filter(function (f) { var dl = daysLeft(f.decisionDue); return dl != null && dl < 0 && ['Approved', 'Rejected'].indexOf(f.embassyStatus) < 0; }).length, 'exclamation-triangle'));
  page.appendChild(grid);

  if (!list.length) { page.appendChild(frag('slot-empty')); return; }

  var card = frag('tracker-card');
  var tb = slot(card, 'rows');
  list.forEach(function (f) {
    var dl = daysLeft(f.decisionDue);
    var row = frag('slot-row');
    slot(row, 'id').innerHTML = '<span class="strong">' + f.id + '</span>';
    slot(row, 'applicant').innerHTML = ui.escapeHtml(f.applicant);
    slot(row, 'country').innerHTML = ui.escapeHtml(f.country);
    slot(row, 'due').innerHTML = f.decisionDue ? ui.date(f.decisionDue) : '—';
    slot(row, 'window').innerHTML = '<span class="' + (dl == null ? '' : dl < 0 ? 'text-bad' : dl <= 7 ? 'text-warn' : 'text-good') + '">' + (dl == null ? '—' : dl < 0 ? Math.abs(dl) + 'd overdue' : dl + 'd left') + '</span>';
    slot(row, 'status').innerHTML = statusBadge(f.embassyStatus).outerHTML;
    row.addEventListener('click', (function (ff) { return function () { fileDetail(ff); }; })(f));
    tb.appendChild(row);
  });
  page.appendChild(card);
}
