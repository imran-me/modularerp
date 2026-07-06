/* ============================================================================
 * EPAL GROUP ERP  ·  views/group/settings.js
 * ----------------------------------------------------------------------------
 * GROUP SETTINGS (route: group/settings) — the command-layer configuration.
 *
 * Registered specifically for the group so it overrides the wildcard company
 * settings view. Three form sections persisted to the settings.group store:
 *   Identity          — group name, legal name, tagline.
 *   Locale & Finance  — currency symbol (readonly BDT taka), fiscal year note,
 *                       date format.
 *   Appearance        — default theme; saving applies data-theme immediately
 *                       and persists ui.theme so the whole shell follows.
 *
 * Plus a Data Management card wired to REAL operations:
 *   Download full backup — serialises every namespaced localStorage key
 *                          (epal.v1. prefix) into one JSON file.
 *   Restore backup       — reads a JSON file, validates the key namespace,
 *                          writes everything back and reloads (with confirm).
 *   Reset demo data      — confirm, then EPAL.db.reset() and reload.
 *
 * KPI row + storage-footprint chart give the owner a live view of the data
 * layer this screen guards.
 * ==========================================================================*/

(function (EPAL) {
  'use strict';
  var ui = EPAL.ui, el = ui.el;
  var NS = EPAL.store.namespace;            // 'epal.v1.'

  /* ---- tiny shared helpers ------------------------------------------------*/
  function kpi(label, value, icon, foot) {
    return el('div.kpi-card', null, [
      el('div.kpi-top', null, [ el('span.kpi-label', { text: label }),
        el('span.kpi-ico', { html: '<i class="bi bi-' + icon + '"></i>' }) ]),
      el('div.kpi-value', { text: String(value) }),
      foot ? el('div.kpi-foot', null, [ el('span.text-muted', { text: foot }) ]) : null
    ]);
  }
  function nsKeys() {
    return Object.keys(localStorage).filter(function (k) { return k.indexOf(NS) === 0; });
  }
  function storageStats() {
    var keys = nsKeys(), bytes = 0, records = 0, perStore = [];
    keys.forEach(function (k) {
      var v = localStorage.getItem(k) || '';
      var b = (k.length + v.length) * 2;    // UTF-16 storage estimate
      bytes += b;
      var count = 0;
      try { var parsed = JSON.parse(v); if (Array.isArray(parsed)) count = parsed.length; } catch (e) {}
      records += count;
      perStore.push({ key: k.slice(NS.length), bytes: b, records: count });
    });
    perStore.sort(function (a, b) { return b.bytes - a.bytes; });
    return { keys: keys.length, bytes: bytes, records: records, perStore: perStore };
  }
  function dl(name, content, mime) {
    var blob = new Blob([content], { type: mime || 'application/json' });
    var a = el('a', { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click(); a.remove();
  }

  /* ==========================================================================
   * SETTINGS ENGINE — deep configuration (persists under settings.*)
   * --------------------------------------------------------------------------
   * Everything below turns the group Settings screen into a real configuration
   * engine: fiscal/finance, HR policy, master-data pickers, the approval matrix,
   * role templates and per-company branding. New stores (expenseHeads,
   * designations) are seeded idempotently via the engine registry so they
   * survive db.reset() and are ready before first render.
   * ========================================================================*/
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'];
  var MAXV = 999999999999;                 // JSON-safe "infinity" for matrix bands

  function defaultExpenseHeads() {
    return [
      { id: 'EH-01', name: 'Office Rent',                     type: 'Fixed' },
      { id: 'EH-02', name: 'Utilities (Electricity/Gas/Water)', type: 'Variable' },
      { id: 'EH-03', name: 'Salaries & Wages',                type: 'Fixed' },
      { id: 'EH-04', name: 'Internet & Telephone',            type: 'Fixed' },
      { id: 'EH-05', name: 'Marketing & Advertising',         type: 'Variable' },
      { id: 'EH-06', name: 'Travel & Conveyance',             type: 'Variable' },
      { id: 'EH-07', name: 'Printing & Stationery',           type: 'Variable' },
      { id: 'EH-08', name: 'Bank Charges',                    type: 'Variable' },
      { id: 'EH-09', name: 'Repairs & Maintenance',           type: 'Variable' },
      { id: 'EH-10', name: 'Government Fees & VAT',            type: 'Statutory' }
    ];
  }
  function defaultDesignations() {
    return [
      { id: 'DS-01', name: 'Managing Director',  dept: 'Executive' },
      { id: 'DS-02', name: 'General Manager',    dept: 'Management' },
      { id: 'DS-03', name: 'Accounts Manager',   dept: 'Accounts' },
      { id: 'DS-04', name: 'Senior Accountant',  dept: 'Accounts' },
      { id: 'DS-05', name: 'Ticketing Officer',  dept: 'Air Ticketing' },
      { id: 'DS-06', name: 'Visa Officer',       dept: 'Visa' },
      { id: 'DS-07', name: 'Sales Executive',    dept: 'Sales' },
      { id: 'DS-08', name: 'HR Officer',         dept: 'HR' },
      { id: 'DS-09', name: 'Office Executive',   dept: 'Operations' },
      { id: 'DS-10', name: 'Support Engineer',   dept: 'Support' }
    ];
  }

  /* Seed the two new master stores idempotently (survives db.reset). --------*/
  EPAL.registerEngine({
    name: 'group-settings-seed',
    seed: function () {
      EPAL.store.seedOnce('expenseHeads', defaultExpenseHeads());
      EPAL.store.seedOnce('designations', defaultDesignations());
    }
  });

  function auditConfig(entity, id, label) {
    if (EPAL.audit && EPAL.audit.record) {
      EPAL.audit.record({ action: 'config', entity: entity, entityId: id,
        entityLabel: label, companyId: 'group' });
    }
  }
  function cardShell(icon, title, sub, bodyChildren) {
    return el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon(icon) + ' ' + title }),
        sub ? el('span.card-sub', { text: sub }) : null ]),
      el('div.card-body', null, bodyChildren)
    ]);
  }

  /* ---- Financial Year & Finance -----------------------------------------*/
  function buildFinanceCard() {
    var cur = EPAL.store.get('settings.finance', {}) || {};
    var monthOpts = MONTHS.map(function (mn, i) { return [String(i + 1), mn]; });
    var form = EPAL.form([
      { type: 'section', label: 'Fiscal Year' },
      { key: 'fyStartMonth', label: 'Financial Year Starts', type: 'select', options: monthOpts,
        default: String(EPAL.config.group.fiscalYearStart || 7), col2: true,
        hint: 'Reference only. The live serial engine reads config.group.fiscalYearStart (Bangladesh standard is July).' },
      { key: 'baseCurrency', label: 'Base Currency', type: 'text', readonly: true,
        default: 'BDT (৳ Bangladeshi Taka)', col2: true },
      { key: 'vatRate', label: 'Standard VAT / Tax Rate (%)', type: 'number', min: 0, max: 100,
        default: cur.vatRate != null ? cur.vatRate : 15, col2: true },
      { key: 'reducedVatRate', label: 'Reduced VAT Rate (%)', type: 'number', min: 0, max: 100,
        default: cur.reducedVatRate != null ? cur.reducedVatRate : 7.5, col2: true },

      { type: 'section', label: 'Working Calendar' },
      { key: 'workingDays', label: 'Working Days / Week', type: 'number', min: 1, max: 7,
        default: cur.workingDays != null ? cur.workingDays : 6, col2: true },
      { key: 'weekend', label: 'Weekend', type: 'select',
        options: ['Friday', 'Friday & Saturday', 'Saturday & Sunday', 'Sunday'],
        default: cur.weekend || 'Friday', col2: true },

      { type: 'section', label: 'Document Numbering (preview only)' },
      { key: 'invoicePrefix', label: 'Invoice Prefix', type: 'text', default: cur.invoicePrefix || 'INV', col2: true,
        hint: 'Illustrative — drives the preview below only. Each module issues its own series via the serial engine.' },
      { key: 'invoicePad', label: 'Number Padding (digits)', type: 'number', min: 1, max: 10,
        default: cur.invoicePad != null ? cur.invoicePad : 6, col2: true },
      { key: 'receiptPrefix', label: 'Receipt Prefix', type: 'text', default: cur.receiptPrefix || 'RCP', col2: true },
      { key: 'voucherPrefix', label: 'Voucher Prefix', type: 'text', default: cur.voucherPrefix || 'JV', col2: true }
    ], cur);

    var previewBox = el('div', { style: { marginTop: '10px', padding: '10px 12px', borderRadius: '10px',
      background: 'rgba(200,162,74,.06)', border: '1px dashed rgba(200,162,74,.35)' } });
    function fmtSerial(prefix, pad) {
      return EPAL.serial.peek(prefix || 'X', { pad: Math.max(1, Math.min(10, +pad || 6)) });
    }
    function renderPreview() {
      var v = form.values();
      previewBox.innerHTML = '';
      previewBox.appendChild(el('div.text-mute.xs', { text: 'NEXT-NUMBER PREVIEW · illustrative, peek (not consumed)' }));
      [['Invoice', v.invoicePrefix || 'INV'], ['Receipt', v.receiptPrefix || 'RCP'], ['Voucher', v.voucherPrefix || 'JV']]
        .forEach(function (p) {
          previewBox.appendChild(el('div', { style: { display: 'flex', justifyContent: 'space-between', marginTop: '5px' } }, [
            el('span.sm', { text: p[0] }),
            el('span', { text: fmtSerial(p[1], v.invoicePad),
              style: { fontFamily: 'var(--font-mono, ui-monospace, monospace)', fontWeight: '600', letterSpacing: '.02em' } })
          ]));
        });
    }
    ['invoicePrefix', 'invoicePad', 'receiptPrefix', 'voucherPrefix'].forEach(function (k) {
      var c = form.ctrls[k]; if (c && c.input) c.input.addEventListener('input', renderPreview);
    });
    renderPreview();

    return cardShell('cash-coin', 'Financial Year & Finance', 'persisted to settings.finance', [
      form.el, previewBox,
      el('div.flex.justify-end.mt-2', null, [
        el('button.btn.btn-primary', { html: ui.icon('check-lg') + ' Save Finance Settings', onclick: function () {
          if (!form.validate()) { ui.toast('Please fix the highlighted fields', 'error'); return; }
          EPAL.store.set('settings.finance', form.values());
          auditConfig('settings', 'finance', 'Financial Year & Finance settings');
          ui.toast('Finance settings saved', 'success');
          renderPreview();
        } })
      ])
    ]);
  }

  /* ---- Leave & Salary policy --------------------------------------------*/
  function buildHrPolicyCard() {
    var cur = EPAL.store.get('settings.hrPolicy', {}) || {};
    var form = EPAL.form([
      { type: 'section', label: 'Leave Policy (days / year)' },
      { key: 'annualLeave', label: 'Annual / Earned Leave', type: 'number', min: 0, max: 60,
        default: cur.annualLeave != null ? cur.annualLeave : 20, col2: true },
      { key: 'casualLeave', label: 'Casual Leave', type: 'number', min: 0, max: 30,
        default: cur.casualLeave != null ? cur.casualLeave : 10, col2: true },
      { key: 'sickLeave', label: 'Sick Leave', type: 'number', min: 0, max: 30,
        default: cur.sickLeave != null ? cur.sickLeave : 14, col2: true },
      { key: 'maternityLeave', label: 'Maternity Leave', type: 'number', min: 0, max: 180,
        default: cur.maternityLeave != null ? cur.maternityLeave : 112, col2: true },

      { type: 'section', label: 'Overtime' },
      { key: 'overtimeRule', label: 'Overtime Multiplier', type: 'select',
        options: [['1', '1.0× (flat)'], ['1.5', '1.5× (standard)'], ['2', '2.0× (double)']],
        default: cur.overtimeRule != null ? String(cur.overtimeRule) : '1.5', col2: true },
      { key: 'overtimeCap', label: 'Monthly OT Cap (hours)', type: 'number', min: 0, max: 200,
        default: cur.overtimeCap != null ? cur.overtimeCap : 60, col2: true },

      { type: 'section', label: 'Salary Components (% of gross)' },
      { key: 'basicPct', label: 'Basic', type: 'number', min: 0, max: 100,
        default: cur.basicPct != null ? cur.basicPct : 60, col2: true },
      { key: 'houseRentPct', label: 'House Rent', type: 'number', min: 0, max: 100,
        default: cur.houseRentPct != null ? cur.houseRentPct : 25, col2: true },
      { key: 'medicalPct', label: 'Medical', type: 'number', min: 0, max: 100,
        default: cur.medicalPct != null ? cur.medicalPct : 10, col2: true },
      { key: 'conveyancePct', label: 'Conveyance', type: 'number', min: 0, max: 100,
        default: cur.conveyancePct != null ? cur.conveyancePct : 5, col2: true }
    ], cur);

    var sumEl = el('span.sm', { text: '' });
    function compSum() {
      var v = form.values();
      return (+v.basicPct || 0) + (+v.houseRentPct || 0) + (+v.medicalPct || 0) + (+v.conveyancePct || 0);
    }
    function refreshSum() {
      var s = compSum();
      sumEl.textContent = 'Salary components total: ' + s + '% ' + (s === 100 ? '✓' : '(must equal 100%)');
      sumEl.style.color = s === 100 ? '#3fb37f' : '#e0a030';
    }
    ['basicPct', 'houseRentPct', 'medicalPct', 'conveyancePct'].forEach(function (k) {
      var c = form.ctrls[k]; if (c && c.input) c.input.addEventListener('input', refreshSum);
    });
    refreshSum();

    return cardShell('calendar-heart-fill', 'Leave & Salary Policy', 'persisted to settings.hrPolicy', [
      form.el,
      el('div.flex.justify-between.items-center.mt-2', null, [
        sumEl,
        el('button.btn.btn-primary', { html: ui.icon('check-lg') + ' Save Policy', onclick: function () {
          if (!form.validate()) { ui.toast('Please fix the highlighted fields', 'error'); return; }
          var s = compSum();
          if (s !== 100) { ui.toast('Salary components must total 100% (now ' + s + '%)', 'error'); return; }
          EPAL.store.set('settings.hrPolicy', form.values());
          auditConfig('settings', 'hrPolicy', 'Leave & Salary policy');
          ui.toast('Leave & salary policy saved', 'success');
        } })
      ])
    ]);
  }

  /* ---- Generic master-data CRUD manager ---------------------------------*/
  function buildManager(cfg) {
    var wrap = el('div'), t;
    function rows() { return EPAL.store.list(cfg.store); }
    function openForm(rec) {
      EPAL.formModal({
        title: (rec ? 'Edit ' : 'Add ') + cfg.singular, icon: cfg.icon || 'plus-lg',
        fields: cfg.fields, record: rec || {},
        onSave: function (vals) {
          var out = Object.assign({}, rec || {}, vals);
          if (!out.id) out.id = cfg.idPrefix + Date.now().toString(36).slice(-5).toUpperCase();
          cfg.save(out);
          ui.toast(cfg.singular + ' saved', 'success');
          t.refresh();
        }
      });
    }
    var actions = [
      { icon: 'pencil', title: 'Edit', onClick: function (r) { openForm(r); } },
      { icon: 'trash', title: 'Delete', onClick: function (r) {
          if (!EPAL.perm.can('group', 'settings', 'delete')) { ui.toast('You do not have permission to delete', 'error'); return; }
          ui.confirm({ title: 'Delete ' + cfg.singular + '?',
            text: '“' + (r.name || r.country || r.id) + '” will be removed.',
            danger: true, confirmLabel: 'Delete' }).then(function (ok) {
            if (!ok) return; cfg.remove(r.id); ui.toast(cfg.singular + ' deleted', 'success'); t.refresh();
          });
      } }
    ];
    t = EPAL.table({ columns: cfg.tableColumns, rows: rows, searchKeys: cfg.searchKeys,
      exportName: cfg.store + '.csv', actions: actions,
      empty: { icon: cfg.icon || 'inbox', title: 'No ' + cfg.singular + ' yet', hint: 'Add your first one.' } });
    wrap.appendChild(el('div.flex.justify-between.items-center.mb-2', null, [
      el('span.text-mute.sm', { text: cfg.hint || '' }),
      el('button.btn.btn-sm.btn-primary', { html: ui.icon('plus-lg') + ' Add ' + cfg.singular,
        onclick: function () { openForm(null); } })
    ]));
    wrap.appendChild(t.el);
    return wrap;
  }

  /* ---- Dropdown Managers (tabbed master data) ---------------------------*/
  function buildMastersCard() {
    var tabs = [
      { label: 'Expense Heads', build: function () { return buildManager({
          store: 'expenseHeads', singular: 'Expense Head', idPrefix: 'EH-', icon: 'wallet2',
          hint: 'Used across Accounts → Expenses in every company.',
          fields: [ { key: 'name', label: 'Head Name', type: 'text', required: true, col2: true },
            { key: 'type', label: 'Type', type: 'select', options: ['Fixed', 'Variable', 'Statutory'], default: 'Variable', col2: true } ],
          tableColumns: [ { key: 'name', label: 'Expense Head' },
            { key: 'type', label: 'Type', badge: { Fixed: 'good', Variable: 'info', Statutory: 'warn' } } ],
          searchKeys: ['name', 'type'],
          save: function (r) { EPAL.db.save('expenseHeads', r); },
          remove: function (id) { EPAL.db.remove('expenseHeads', id); }
        }); } },
      { label: 'Designations', build: function () { return buildManager({
          store: 'designations', singular: 'Designation', idPrefix: 'DS-', icon: 'person-badge',
          hint: 'The designation picker used by Workforce / HRM.',
          fields: [ { key: 'name', label: 'Designation', type: 'text', required: true, col2: true },
            { key: 'dept', label: 'Department', type: 'text', col2: true } ],
          tableColumns: [ { key: 'name', label: 'Designation' }, { key: 'dept', label: 'Department' } ],
          searchKeys: ['name', 'dept'],
          save: function (r) { EPAL.db.save('designations', r); },
          remove: function (id) { EPAL.db.remove('designations', id); }
        }); } },
      { label: 'Visa Categories', build: function () { return buildManager({
          store: 'visaCats', singular: 'Visa Category', idPrefix: 'VC-', icon: 'passport',
          hint: 'Mirrors Travels → Visa Processing → Visa Categories.',
          fields: [ { key: 'country', label: 'Country', type: 'text', required: true, col2: true },
            { key: 'type', label: 'Visa Type', type: 'select', options: ['Tourist', 'Business', 'Visit', 'Umrah', 'Student', 'Work'], default: 'Tourist', col2: true },
            { key: 'cost', label: 'Cost (৳)', type: 'money', min: 0, col2: true },
            { key: 'sale', label: 'Sale (৳)', type: 'money', min: 0, col2: true },
            { key: 'days', label: 'Processing Days', type: 'number', min: 0, col2: true },
            { key: 'status', label: 'Status', type: 'select', options: ['active', 'inactive'], default: 'active', col2: true } ],
          tableColumns: [ { key: 'country', label: 'Country' }, { key: 'type', label: 'Type' },
            { key: 'cost', label: 'Cost', num: true, money: true }, { key: 'sale', label: 'Sale', num: true, money: true },
            { key: 'days', label: 'Days', num: true }, { key: 'status', label: 'Status', badge: { active: 'good', inactive: 'bad' } } ],
          searchKeys: ['country', 'type'],
          save: function (r) { EPAL.db.saveVisaCat(r); },
          remove: function (id) { EPAL.db.remove('visaCats', id); }
        }); } },
      { label: 'Airlines', build: function () { return buildManager({
          store: 'airlines', singular: 'Airline', idPrefix: 'AL-', icon: 'airplane',
          hint: 'Mirrors Travels → Air Ticketing → Airlines.',
          fields: [ { key: 'name', label: 'Airline Name', type: 'text', required: true, col2: true },
            { key: 'iata', label: 'IATA Code', type: 'text', col2: true, pattern: /^[A-Za-z0-9]{2,3}$/, patternMsg: '2–3 character code' },
            { key: 'country', label: 'Country', type: 'text', col2: true },
            { key: 'status', label: 'Status', type: 'select', options: ['active', 'inactive'], default: 'active', col2: true } ],
          tableColumns: [ { key: 'name', label: 'Airline' }, { key: 'iata', label: 'IATA' },
            { key: 'country', label: 'Country' }, { key: 'status', label: 'Status', badge: { active: 'good', inactive: 'bad' } } ],
          searchKeys: ['name', 'iata', 'country'],
          save: function (r) { EPAL.db.saveAirline(r); },
          remove: function (id) { EPAL.db.remove('airlines', id); }
        }); } }
    ];
    var body = el('div'), btns = [];
    function select(i) {
      btns.forEach(function (b, j) { b.className = 'btn btn-sm ' + (j === i ? 'btn-primary' : 'btn-ghost'); });
      body.innerHTML = ''; body.appendChild(tabs[i].build());
    }
    var bar = el('div.flex.gap-2.mb-3', { style: { flexWrap: 'wrap' } }, tabs.map(function (tb, i) {
      var b = el('button', { text: tb.label, onclick: function () { select(i); } });
      btns.push(b); return b;
    }));
    var card = cardShell('ui-checks', 'Dropdown & Master Data', 'CRUD for the pickers used across the group', [ bar, body ]);
    select(0);
    return card;
  }

  /* ---- Approval Matrix editor -------------------------------------------*/
  function buildApprovalMatrixCard() {
    var working = EPAL.approvals.matrix().map(function (r) { return Object.assign({}, r); });
    var t;
    function persist() {
      EPAL.approvals.setMatrix(working);
      auditConfig('approval_matrix', 'matrix', 'Approval matrix updated');
    }
    function openForm(idx) {
      var rec = idx != null ? working[idx] : null;
      EPAL.formModal({
        title: (rec ? 'Edit' : 'Add') + ' Approval Rule', icon: 'diagram-2',
        fields: [
          { key: 'docType', label: 'Document Type', type: 'text', required: true, col2: true,
            hint: 'e.g. payment, refund, salary-change, credit-limit-override' },
          { key: 'minAmount', label: 'Min Amount (৳)', type: 'money', min: 0, default: 0, col2: true },
          { key: 'maxAmount', label: 'Max Amount (৳ · blank = ∞)', type: 'money', min: 0, col2: true },
          { key: 'roles', label: 'Approver Roles (in order)', type: 'text', required: true, col2: true,
            hint: 'comma-separated, e.g. Finance Manager, MD' }
        ],
        record: rec ? { docType: rec.docType, minAmount: rec.minAmount,
          maxAmount: rec.maxAmount >= MAXV ? null : rec.maxAmount, roles: (rec.roles || []).join(', ') } : {},
        onSave: function (vals) {
          var row = { docType: vals.docType, minAmount: +vals.minAmount || 0,
            maxAmount: (vals.maxAmount == null || vals.maxAmount === '') ? MAXV : +vals.maxAmount,
            roles: String(vals.roles).split(',').map(function (s) { return s.trim(); }).filter(Boolean) };
          if (idx != null) working[idx] = row; else working.push(row);
          persist(); ui.toast('Approval rule saved', 'success'); t.refresh();
        }
      });
    }
    function tableRows() {
      return working.map(function (r, i) {
        return { __i: i, docType: r.docType, min: r.minAmount || 0,
          max: (r.maxAmount >= MAXV ? '∞' : r.maxAmount), roles: (r.roles || []).join(' → ') };
      });
    }
    t = EPAL.table({
      columns: [
        { key: 'docType', label: 'Document Type' },
        { key: 'min', label: 'Min', num: true, money: true },
        { key: 'max', label: 'Max', num: true, render: function (r) {
            return r.max === '∞' ? '<span style="opacity:.6">∞ unlimited</span>' : '<span class="num">' + ui.money(r.max) + '</span>'; } },
        { key: 'roles', label: 'Approval Chain' }
      ],
      rows: tableRows, searchKeys: ['docType', 'roles'], exportName: 'approval-matrix.csv',
      actions: [
        { icon: 'pencil', title: 'Edit', onClick: function (r) { openForm(r.__i); } },
        { icon: 'trash', title: 'Delete', onClick: function (r) {
            ui.confirm({ title: 'Delete rule?', text: 'The “' + r.docType + '” rule will be removed.',
              danger: true, confirmLabel: 'Delete' }).then(function (ok) {
              if (!ok) return; working.splice(r.__i, 1); persist(); t.refresh(); ui.toast('Rule deleted', 'success');
            });
        } }
      ],
      empty: { icon: 'diagram-2', title: 'No approval rules', hint: 'Add a rule to require maker-checker sign-off.' }
    });
    var body = el('div');
    body.appendChild(el('div.flex.justify-between.items-center.mb-2', null, [
      el('span.text-mute.sm', { text: 'Governs EPAL.approvals.needsApproval — bands per document type & amount.' }),
      el('button.btn.btn-sm.btn-primary', { html: ui.icon('plus-lg') + ' Add Rule', onclick: function () { openForm(null); } })
    ]));
    body.appendChild(t.el);
    return cardShell('diagram-2-fill', 'Approval Matrix', 'maker-checker rules · approval_matrix', [ body ]);
  }

  /* ---- Role Templates editor --------------------------------------------*/
  function buildRoleTemplatesCard() {
    var ACTIONS = EPAL.perm.actions;
    var roleRows = EPAL.perm.templates();
    var companies = EPAL.config.companies;
    var state = { role: roleRows[0].role, companyId: companies[0].id, grants: {} };

    function loadGrants(role) {
      var tpl = EPAL.perm.template(role);
      state.grants = JSON.parse(JSON.stringify(tpl.grants || {}));
    }
    loadGrants(state.role);

    function resolveGrant(key) {
      var parts = key.split('/'), co = parts[0], mod = parts[1];
      var cands = [co + '/' + mod, co + '/*', '*/' + mod, '*/*', '*'];
      for (var i = 0; i < cands.length; i++) {
        if (Object.prototype.hasOwnProperty.call(state.grants, cands[i])) return state.grants[cands[i]];
      }
      return null;
    }
    function isChecked(key, action) {
      var g = resolveGrant(key);
      if (!g) return false;
      if (g === '*') return true;
      return g.indexOf('*') >= 0 || g.indexOf(action) >= 0;
    }
    function setAction(key, action, on) {
      var g = state.grants[key], arr;
      // When this exact scope has no explicit grant, materialise it from the
      // EFFECTIVE (wildcard-resolved) access so toggling one cell does not drop
      // the actions inherited from a broader wildcard grant.
      if (g == null) g = resolveGrant(key);
      if (g === '*') arr = ACTIONS.slice();
      else if (Object.prototype.toString.call(g) === '[object Array]') arr = g.slice();
      else arr = [];
      var idx = arr.indexOf(action);
      if (on && idx < 0) arr.push(action);
      if (!on && idx >= 0) arr.splice(idx, 1);
      if (!arr.length) delete state.grants[key]; else state.grants[key] = arr;
    }

    var grid = el('div');
    function renderGrid() {
      grid.innerHTML = '';
      var co = EPAL.config.company(state.companyId);
      var gridRows = [{ key: state.companyId + '/*', label: 'All modules (wildcard)', wild: true }];
      (co.modules || []).forEach(function (mod) { gridRows.push({ key: state.companyId + '/' + mod.id, label: mod.label }); });
      var table = el('table.tbl');
      var htr = el('tr');
      htr.appendChild(el('th', { text: 'Module' }));
      ACTIONS.forEach(function (a) { htr.appendChild(el('th', { text: a, style: { textAlign: 'center', textTransform: 'capitalize' } })); });
      table.appendChild(el('thead', null, [ htr ]));
      var tb = el('tbody');
      gridRows.forEach(function (rw) {
        var tr = el('tr');
        tr.appendChild(el('td', { html: (rw.wild ? '<b>' : '') + ui.escapeHtml(rw.label) + (rw.wild ? '</b>' : '') }));
        ACTIONS.forEach(function (a) {
          var td = el('td', { style: { textAlign: 'center' } });
          var cb = el('input', { type: 'checkbox' });
          cb.checked = isChecked(rw.key, a);
          (function (key, action, box) {
            box.addEventListener('change', function () { setAction(key, action, box.checked); renderGrid(); });
          })(rw.key, a, cb);
          td.appendChild(cb); tr.appendChild(td);
        });
        tb.appendChild(tr);
      });
      table.appendChild(tb);
      grid.appendChild(el('div.table-wrap', null, [ table ]));
    }

    var roleSel = el('select.select', { onchange: function () { state.role = roleSel.value; loadGrants(state.role); renderGrid(); } });
    roleRows.forEach(function (r) { roleSel.appendChild(el('option', { value: r.role, text: r.label || r.role })); });
    var coSel = el('select.select', { onchange: function () { state.companyId = coSel.value; renderGrid(); } });
    companies.forEach(function (c) { coSel.appendChild(el('option', { value: c.id, text: c.name })); });

    renderGrid();

    return cardShell('shield-check', 'Role Templates', 'action-level grants · role_templates', [
      el('div.flex.gap-2.items-end.mb-2', { style: { flexWrap: 'wrap' } }, [
        el('div.field', { style: { minWidth: '180px' } }, [ el('label', { text: 'Role' }), roleSel ]),
        el('div.field', { style: { minWidth: '200px' } }, [ el('label', { text: 'Company' }), coSel ])
      ]),
      el('p.text-mute.xs', { text: 'Checkboxes show effective access (including wildcards). Editing a row writes an explicit grant for that exact scope, which overrides broader wildcards.' }),
      grid,
      el('div.flex.justify-end.mt-2', null, [
        el('button.btn.btn-primary', { html: ui.icon('check-lg') + ' Save Role Template', onclick: function () {
          EPAL.perm.setTemplate(state.role, state.grants);
          if (EPAL.audit && EPAL.audit.record) {
            EPAL.audit.record({ action: 'permission', entity: 'role_templates', entityId: state.role,
              entityLabel: 'Role template · ' + state.role, companyId: 'group' });
          }
          ui.toast('Role template saved for ' + state.role, 'success');
        } })
      ])
    ]);
  }

  /* ---- Per-company Branding ---------------------------------------------*/
  function buildBrandingCard() {
    var companies = EPAL.config.companies;
    var inputs = {};
    var listRows = companies.map(function (c) {
      var saved = EPAL.store.get('settings.' + c.id, {}) || {};
      var nameIn = el('input.input', { type: 'text', value: saved.displayName || c.name, placeholder: c.name });
      var colorIn = el('input', { type: 'color', value: saved.accent || c.accent,
        style: { width: '52px', height: '38px', border: 'none', background: 'none', cursor: 'pointer', padding: '0' } });
      inputs[c.id] = { name: nameIn, color: colorIn };
      return el('div.flex.items-center.gap-2', { style: { padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,.06)' } }, [
        el('span', { html: ui.icon(c.icon), style: { color: c.accent, width: '22px', textAlign: 'center' } }),
        el('div', { style: { flex: '1 1 auto' } }, [ el('div.text-mute.xs', { text: c.id }), nameIn ]),
        colorIn
      ]);
    });
    return cardShell('palette-fill', 'Per-Company Branding', 'accent + display name · settings.<companyId>',
      listRows.concat([
        el('div.flex.justify-end.mt-2', null, [
          el('button.btn.btn-primary', { html: ui.icon('check-lg') + ' Save Branding', onclick: function () {
            companies.forEach(function (c) {
              var v = inputs[c.id];
              EPAL.store.set('settings.' + c.id, { displayName: v.name.value || c.name, accent: v.color.value });
            });
            auditConfig('settings', 'branding', 'Per-company branding');
            ui.toast('Per-company branding saved', 'success');
          } })
        ])
      ]));
  }

  /* ==========================================================================
   * VIEW
   * ========================================================================*/
  EPAL.view('group/settings', { render: function (ctx) {
    var page = el('div.page');
    var cur = EPAL.store.get('settings.group', {}) || {};
    var stats = storageStats();

    page.appendChild(EPAL.pageHead({
      eyebrow: 'Epal Group · Command Layer', icon: 'gear-fill', title: 'Group Settings',
      sub: 'Identity, locale, appearance and the data-management vault for the whole group.',
      actions: [
        el('button.btn.btn-ghost', { html: ui.icon('toggles2') + ' Module Control',
          onclick: function () { EPAL.router.navigate('group/module-manager'); } })
      ]
    }));

    /* ---- KPI row ---------------------------------------------------------*/
    page.appendChild(el('div.kpi-grid.stagger', null, [
      kpi('Data Stores', stats.keys, 'database-fill', 'namespaced localStorage keys'),
      kpi('Total Records', ui.num(stats.records), 'collection-fill', 'rows across all collections'),
      kpi('Storage Used', (stats.bytes / 1024).toFixed(1) + ' KB', 'hdd-fill', 'estimated on-device footprint'),
      kpi('App Version', 'v' + EPAL.config.version, 'stars', 'codename ' + EPAL.config.codename)
    ]));

    /* ---- settings form -----------------------------------------------------*/
    var form = EPAL.form([
      { type: 'section', label: 'Identity' },
      { key: 'name', label: 'Group Name', type: 'text', required: true,
        default: EPAL.config.group.name, col2: true },
      { key: 'legalName', label: 'Legal Name', type: 'text', required: true,
        default: EPAL.config.group.legalName, col2: true },
      { key: 'tagline', label: 'Tagline', type: 'text',
        default: EPAL.config.group.tagline, col2: true },

      { type: 'section', label: 'Locale & Finance' },
      { key: 'currencySymbol', label: 'Currency Symbol', type: 'text', readonly: true,
        default: EPAL.config.group.currencySymbol,
        hint: 'BDT (Bangladeshi Taka) — fixed across the group ledger.' },
      { key: 'fiscalNote', label: 'Fiscal Year', type: 'text',
        default: 'July – June (Bangladesh standard)',
        hint: 'Informational — reports label periods with this note.' },
      { key: 'dateFormat', label: 'Date Format', type: 'select',
        options: ['DD Mon YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD'], default: 'DD Mon YYYY' },

      { type: 'section', label: 'Appearance' },
      { key: 'theme', label: 'Default Theme', type: 'select',
        options: [['dark', 'Dark — Command'], ['light', 'Light — Daylight']],
        default: EPAL.store.get('ui.theme', 'dark'),
        hint: 'Applied instantly on save, remembered for every session.' }
    ], cur);

    var formCard = el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon('sliders') + ' Group Profile & Preferences' }),
        el('span.card-sub', { text: 'persisted to settings.group' }) ]),
      el('div.card-body', null, [
        form.el,
        el('div.flex.justify-between.items-center.mt-2', null, [
          el('span.text-mute.xs', { text: 'Company-level preferences live in each concern’s own Settings.' }),
          el('button.btn.btn-primary', { html: ui.icon('check-lg') + ' Save Settings', onclick: function () {
            if (!form.validate()) { ui.toast('Please fix the highlighted fields', 'error'); return; }
            var vals = form.values();
            EPAL.store.set('settings.group', vals);
            document.documentElement.setAttribute('data-theme', vals.theme);
            EPAL.store.set('ui.theme', vals.theme);
            EPAL.bus.emit('theme:changed', { theme: vals.theme });
            ui.toast('Group settings saved · theme applied', 'success');
          } })
        ])
      ])
    ]);

    /* ---- data management ---------------------------------------------------*/
    var fileInput = el('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' } });
    fileInput.addEventListener('change', function () {
      var f = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      if (f) restoreBackup(f);
    });

    var dataCard = el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon('shield-lock-fill') + ' Data Management' }),
        el('span.card-sub', { text: 'backup · restore · reset' }) ]),
      el('div.card-body', null, [
        el('p.text-mute.sm', { text: 'The entire ERP state lives in the ' + NS + ' namespace. Take a full backup before big changes; restore it on any machine.' }),
        el('div.flex.gap-2.mt-2', { style: { flexWrap: 'wrap' } }, [
          el('button.btn.btn-primary', { html: ui.icon('cloud-arrow-down-fill') + ' Download Full Backup',
            onclick: function () { downloadBackup(); } }),
          el('button.btn.btn-ghost', { html: ui.icon('cloud-arrow-up') + ' Restore Backup',
            onclick: function () { fileInput.click(); } })
        ]),
        fileInput,
        el('div.mt-3', null, [
          el('div.section-label', { text: 'Danger Zone' }),
          el('p.text-mute.sm', { text: 'Wipe every store and reseed the demo dataset. All manual entries will be lost.' }),
          el('button.btn.btn-danger.mt-1', { html: ui.icon('arrow-counterclockwise') + ' Reset Demo Data',
            onclick: function () {
              ui.confirm({ title: 'Reset ALL demo data?',
                text: 'Every store (' + stats.keys + ' keys, ' + ui.num(stats.records) + ' records) will be wiped and reseeded. This cannot be undone.',
                danger: true, confirmLabel: 'Wipe & Reseed' }).then(function (ok) {
                if (!ok) return;
                EPAL.db.reset();
                ui.toast('Demo data reset — reloading…', 'success');
                setTimeout(function () { location.reload(); }, 700);
              });
            } })
        ])
      ])
    ]);

    /* ---- storage footprint chart ------------------------------------------*/
    var footId = ui.uid('gset');
    var chart = el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon('hdd-stack') + ' Storage Footprint' }),
        el('span.card-sub', { text: 'largest stores by size (KB)' }) ]),
      el('div.card-body', null, [
        el('div', { style: { height: '240px', position: 'relative' } }, [ el('canvas', { id: footId }) ])
      ])
    ]);

    var row = el('div.two-col');
    row.appendChild(formCard);
    row.appendChild(el('div.flex.flex-col.gap-3', { style: { display: 'flex', flexDirection: 'column', gap: '16px' } }, [
      dataCard, chart ]));
    page.appendChild(row);

    /* ---- SETTINGS ENGINE sections -----------------------------------------*/
    page.appendChild(el('div.form-section-title.mt-3', { text: 'Settings Engine' }));
    page.appendChild(el('div.two-col', null, [ buildFinanceCard(), buildHrPolicyCard() ]));
    page.appendChild(buildMastersCard());
    page.appendChild(buildApprovalMatrixCard());
    page.appendChild(buildRoleTemplatesCard());
    page.appendChild(buildBrandingCard());

    ctx.mount.appendChild(page);

    requestAnimationFrame(function () {
      var c = document.getElementById(footId);
      if (!c) return;
      var top = stats.perStore.slice(0, 8);
      if (!top.length) return;
      EPAL.charts.bar(c, {
        labels: top.map(function (s) { return s.key; }),
        datasets: [{ label: 'KB', data: top.map(function (s) { return +(s.bytes / 1024).toFixed(1); }),
          colors: top.map(function () { return '#1A43BF'; }) }],
        horizontal: true
      });
    });

    /* ---- backup / restore engines ------------------------------------------*/
    function downloadBackup() {
      var keys = nsKeys();
      if (!keys.length) { ui.toast('Nothing to back up yet', 'warning'); return; }
      var data = {};
      keys.forEach(function (k) { data[k] = localStorage.getItem(k); });
      var payload = {
        app: 'epal-group-erp', version: EPAL.config.version,
        exportedAt: new Date().toISOString(), keys: keys.length, data: data
      };
      dl('epal-group-backup-' + new Date().toISOString().slice(0, 10) + '.json',
        JSON.stringify(payload, null, 2), 'application/json');
      ui.toast('Backup downloaded — ' + keys.length + ' stores', 'success');
    }

    function restoreBackup(file) {
      var reader = new FileReader();
      reader.onload = function () {
        var parsed;
        try { parsed = JSON.parse(String(reader.result)); }
        catch (e) { ui.toast('Invalid backup — file is not valid JSON', 'error'); return; }
        var map = parsed && parsed.data && typeof parsed.data === 'object' ? parsed.data : parsed;
        if (!map || typeof map !== 'object' || Array.isArray(map)) {
          ui.toast('Invalid backup — no data map found', 'error'); return;
        }
        var keys = Object.keys(map);
        if (!keys.length) { ui.toast('Invalid backup — the file contains no keys', 'error'); return; }
        var bad = keys.filter(function (k) { return k.indexOf(NS) !== 0; });
        if (bad.length) {
          ui.toast('Invalid backup — ' + bad.length + ' keys are outside the ' + NS + ' namespace', 'error');
          return;
        }
        ui.confirm({ title: 'Restore this backup?',
          text: keys.length + ' stores will overwrite the current data' +
            (parsed.exportedAt ? ' (backup taken ' + ui.date(parsed.exportedAt, 'full') + ')' : '') +
            '. The app will reload afterwards.',
          danger: true, confirmLabel: 'Restore & Reload' }).then(function (ok) {
          if (!ok) return;
          keys.forEach(function (k) {
            var v = map[k];
            localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
          });
          ui.toast('Backup restored — reloading…', 'success');
          setTimeout(function () { location.reload(); }, 700);
        });
      };
      reader.onerror = function () { ui.toast('Could not read the selected file', 'error'); };
      reader.readAsText(file);
    }
  } });

})(window.EPAL = window.EPAL || {});
