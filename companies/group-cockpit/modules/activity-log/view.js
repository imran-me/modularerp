/* ============================================================================
 * EPAL GROUP ERP  ·  views/group/activity-log.js
 * ----------------------------------------------------------------------------
 * GLOBAL ACTIVITY LOG — the group-wide audit trail viewer (compliance backbone).
 *
 * An admin-only "who did what, when, from where" console over EPAL.audit. It
 * offers a rich filter bar (user, action, entity, company, free-text, date
 * range), four live KPI tiles (events today, logins, changes, deletes), a
 * premium event timeline (.audit-ev rows with per-action dot classes and an
 * inline field-level changes diff), and a one-click CSV export that itself is
 * recorded to the audit trail via EPAL.audit.record({action:'export', ...}).
 *
 * It feels live: the view subscribes to 'audit:logged' on the bus and redraws
 * (debounced) whenever a new footprint is written anywhere in the group. The
 * subscription is torn down on route change. Non-admins get a denied state.
 * ==========================================================================*/

(function (EPAL) {
  'use strict';

  var ui = EPAL.ui, el = ui.el, db = EPAL.db;
  var disposer = null;   // bus subscription, cleaned up on teardown

  /* action -> presentation (icon + fallback colour for dots the CSS doesn't
   * already style). The `.audit-<action>` class drives the styled ones. -----*/
  var ACTIONS = {
    create:     { label:'Created',    icon:'plus-lg',            color:'#23c17e' },
    update:     { label:'Updated',    icon:'pencil-fill',        color:'#2f6bff' },
    delete:     { label:'Deleted',    icon:'trash-fill',         color:'#f0506e' },
    post:       { label:'Posted',     icon:'journal-text',       color:'#1A43BF' },
    login:      { label:'Signed in',  icon:'box-arrow-in-right', color:'#1A43BF' },
    logout:     { label:'Signed out', icon:'box-arrow-right',    color:'#8b93a7' },
    approve:    { label:'Approved',   icon:'patch-check-fill',   color:'#1A43BF' },
    reject:     { label:'Rejected',   icon:'x-octagon-fill',     color:'#f0506e' },
    export:     { label:'Exported',   icon:'download',           color:'#12b3a6' },
    config:     { label:'Configured', icon:'toggles2',           color:'#7b5cff' },
    permission: { label:'Permission', icon:'shield-lock-fill',   color:'#e2721b' },
    state:      { label:'State',      icon:'arrow-repeat',       color:'#2f6bff' }
  };
  // Actions the stylesheet already gives a dot background to (leave those alone).
  var CSS_STYLED = { create:1, update:1, delete:1, login:1, approve:1 };

  var ENTITY_LABELS = {
    visaApps:'Visa Application', visaCats:'Visa Category', airTickets:'Air Ticket',
    airlines:'Airline', airports:'Airport', airRefunds:'Air Refund', employees:'Employee',
    customers:'Customer', leads:'Lead', vendors:'Vendor', sales:'Sale', tasks:'Task',
    financials:'Financials', approvals:'Approval', documents:'Document', comments:'Comment',
    role_templates:'Role Template', automation_rules:'Automation Rule', audit_log:'Audit Log',
    auth:'Authentication', reports:'Report', 'module-manager':'Module'
  };
  function entityLabel(e) { return ENTITY_LABELS[e] || (e ? cap(e) : '—'); }
  function actionMeta(a) { return ACTIONS[a] || { label:cap(a || 'event'), icon:'dot', color:'#8b93a7' }; }
  function cap(s) { s = String(s || ''); return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  function companies() {
    return (EPAL.config && EPAL.config.companies ? EPAL.config.companies : [])
      .filter(function (c) { return c.enabled; });
  }
  function companyName(id) {
    var c = companies().filter(function (x) { return x.id === id; })[0];
    return c ? (c.short || c.name) : (id || 'Group');
  }

  /* pull the whole log once (newest-first) for building option lists ---------*/
  function allRows() { return EPAL.audit.log({}); }

  function distinct(rows, key) {
    var seen = {}, out = [];
    rows.forEach(function (r) { var v = r[key]; if (v && !seen[v]) { seen[v] = 1; out.push(v); } });
    return out;
  }

  /* ==========================================================================
   * VIEW
   * ========================================================================*/
  EPAL.view('group/activity-log', {
    render: function (ctx) {
      var page = el('div.page');
      page.appendChild(EPAL.pageHead({
        eyebrow:'Epal Group · Compliance', icon:'shield-lock-fill', title:'Activity Log',
        sub:'The full audit trail — who did what, when and from where, across every sister concern.'
      }));

      /* ---- admin gate --------------------------------------------------- */
      if (!(EPAL.auth && EPAL.auth.isAdmin && EPAL.auth.isAdmin())) {
        page.appendChild(deniedState());
        ctx.mount.appendChild(page);
        return;
      }

      /* ---- filter state controls ---------------------------------------- */
      var base = allRows();
      var userNames = {};
      db.employees().forEach(function (e) { userNames[e.name] = 1; });
      distinct(base, 'userName').forEach(function (n) { userNames[n] = 1; });

      var selUser   = selectEl('user', 'All users', Object.keys(userNames).sort().map(function (n) { return [n, n]; }));
      var selAction = selectEl('action', 'All actions', distinct(base, 'action').sort().map(function (a) { return [a, actionMeta(a).label]; }));
      var selEntity = selectEl('entity', 'All entities', distinct(base, 'entity').sort().map(function (e) { return [e, entityLabel(e)]; }));
      var selCompany= selectEl('company', 'All companies', companies().map(function (c) { return [c.id, c.short || c.name]; }));
      var inpQ      = el('input.input', { type:'search', placeholder:'Search text, id, reason…' });
      var inpFrom   = el('input.input', { type:'date' });
      var inpTo     = el('input.input', { type:'date' });

      var kpiHost = el('div');
      var listHost = el('div');

      function buildFilter() {
        var f = {};
        if (selUser.value)    f.user = selUser.value;
        if (selAction.value)  f.action = selAction.value;
        if (selEntity.value)  f.entity = selEntity.value;
        if (selCompany.value) f.companyId = selCompany.value;
        if (inpQ.value.trim()) f.q = inpQ.value.trim();
        if (inpFrom.value) { var a = new Date(inpFrom.value + 'T00:00:00'); if (!isNaN(a)) f.from = a.getTime(); }
        if (inpTo.value)   { var b = new Date(inpTo.value + 'T23:59:59'); if (!isNaN(b)) f.to = b.getTime(); }
        return f;
      }

      function currentRows() { return EPAL.audit.log(buildFilter()); }

      function draw() {
        var rows = currentRows();
        drawKpis(kpiHost, rows);
        drawTimeline(listHost, rows);
      }
      var drawDebounced = ui.debounce(draw, 140);

      /* ---- filter bar UI ------------------------------------------------- */
      var bar = el('div.card', null, [
        el('div.card-body', null, [
          el('div.filter-grid', { style:{ display:'grid', gap:'12px',
            gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))' } }, [
            fieldWrap('User', selUser),
            fieldWrap('Action', selAction),
            fieldWrap('Entity', selEntity),
            fieldWrap('Company', selCompany),
            fieldWrap('Search', inpQ),
            fieldWrap('From', inpFrom),
            fieldWrap('To', inpTo)
          ]),
          el('div.flex.justify-between.items-center.mt-3', { style:{ display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:'12px', flexWrap:'wrap', gap:'8px' } }, [
            el('button.btn.btn-ghost.btn-sm', { html: ui.icon('x-circle') + ' Clear filters',
              onclick: function () {
                selUser.value = ''; selAction.value = ''; selEntity.value = '';
                selCompany.value = ''; inpQ.value = ''; inpFrom.value = ''; inpTo.value = '';
                draw();
              } }),
            el('button.btn.btn-primary.btn-sm', { html: ui.icon('filetype-csv') + ' Export CSV',
              onclick: function () { exportCsv(currentRows(), buildFilter()); } })
          ])
        ])
      ]);
      page.appendChild(bar);

      // wire filter events
      [selUser, selAction, selEntity, selCompany, inpFrom, inpTo].forEach(function (n) {
        n.addEventListener('change', draw);
      });
      inpQ.addEventListener('input', drawDebounced);

      page.appendChild(kpiHost);
      page.appendChild(el('div.section-label', { text:'Event Timeline' }));
      page.appendChild(listHost);

      draw();
      ctx.mount.appendChild(page);

      /* ---- live updates -------------------------------------------------- */
      if (disposer) { disposer(); disposer = null; }
      disposer = EPAL.bus.on('audit:logged', drawDebounced);
    },
    teardown: function () { if (disposer) { disposer(); disposer = null; } }
  });

  /* ==========================================================================
   * KPI TILES
   * ========================================================================*/
  function drawKpis(host, rows) {
    host.innerHTML = '';
    var start = new Date(); start.setHours(0, 0, 0, 0);
    var todayMs = start.getTime();
    var today = 0, logins = 0, changes = 0, deletes = 0;
    rows.forEach(function (r) {
      if ((r.at || 0) >= todayMs) today++;
      if (r.action === 'login' || r.action === 'logout') logins++;
      if (r.action === 'create' || r.action === 'update') changes++;
      if (r.action === 'delete') deletes++;
    });
    host.appendChild(el('div.kpi-grid.stagger', null, [
      kpi('Events Today', String(today), 'activity'),
      kpi('Logins', String(logins), 'box-arrow-in-right'),
      kpi('Changes', String(changes), 'pencil-square'),
      kpi('Deletes', String(deletes), 'trash')
    ]));
  }

  /* ==========================================================================
   * TIMELINE
   * ========================================================================*/
  function drawTimeline(host, rows) {
    host.innerHTML = '';
    var card = el('div.card');
    card.appendChild(el('div.card-head', null, [
      el('h3', { html: ui.icon('clock-history') + ' Audit Events' }),
      el('span.card-sub', { text: rows.length + ' event' + (rows.length === 1 ? '' : 's') })
    ]));
    if (!rows.length) {
      card.appendChild(el('div.empty-state', null, [
        ui.frag(ui.icon('shield-check')),
        el('h3', { text:'No matching events' }),
        el('p.text-muted', { text:'Adjust the filters above — the audit trail records every change as it happens.' })
      ]));
      host.appendChild(card);
      return;
    }
    var body = el('div.card-body');
    rows.slice(0, 300).forEach(function (r) { body.appendChild(eventRow(r)); });
    card.appendChild(body);
    host.appendChild(card);
  }

  function eventRow(r) {
    var meta = actionMeta(r.action);
    var dot = el('span.audit-dot', { html: ui.icon(meta.icon) });
    if (!CSS_STYLED[r.action]) { dot.style.background = meta.color + '26'; dot.style.color = meta.color; }

    var line = el('div.audit-line', null, [
      el('strong', { text: r.userName || r.user || 'System' }),
      document.createTextNode(' ' + meta.label.toLowerCase() + ' '),
      el('span', { text: r.entityLabel || entityLabel(r.entity) })
    ]);
    if (r.reason) line.appendChild(el('span.text-muted', { text: ' · ' + r.reason }));

    var metaBits = [companyName(r.companyId), ui.date(r.at, 'full'), ui.ago(r.at)];
    if (r.ip) metaBits.push(r.ip);
    var metaLine = el('div.audit-meta', { text: metaBits.join('  ·  ') });

    var bodyChildren = [line, metaLine];
    var diff = changesDiff(r.changes);
    if (diff) bodyChildren.push(diff);

    return el('div.audit-ev.audit-' + (r.action || 'event'), null, [
      dot, el('div.audit-body', null, bodyChildren)
    ]);
  }

  function changesDiff(changes) {
    if (!changes || typeof changes !== 'object') return null;
    var keys = Object.keys(changes);
    if (!keys.length) return null;
    var wrap = el('div.audit-diff');
    keys.forEach(function (k) {
      var c = changes[k] || {};
      var row = el('div', null, [
        el('span.text-muted', { text: k + ': ' }),
        el('span.old', { text: fmtVal(c.old) }),
        document.createTextNode('  →  '),
        el('span.new', { text: fmtVal(c.new) })
      ]);
      wrap.appendChild(row);
    });
    return wrap;
  }
  function fmtVal(v) {
    if (v == null) return '—';
    if (typeof v === 'object') { try { return JSON.stringify(v); } catch (e) { return String(v); } }
    return String(v);
  }

  /* ==========================================================================
   * CSV EXPORT  (records itself to the audit trail, then downloads)
   * ========================================================================*/
  function exportCsv(rows, filter) {
    var head = ['Time', 'User', 'User ID', 'Action', 'Entity', 'Entity ID', 'Label', 'Company', 'Reason', 'Changes', 'IP'];
    var lines = [head.map(csvCell).join(',')];
    rows.forEach(function (r) {
      lines.push([
        ui.date(r.at, 'full'), r.userName || '', r.user || '', r.action || '',
        entityLabel(r.entity), r.entityId || '', r.entityLabel || '',
        companyName(r.companyId), r.reason || '', changesText(r.changes), r.ip || ''
      ].map(csvCell).join(','));
    });
    var csv = lines.join('\r\n');

    // Log the export itself before downloading (audit the auditor).
    EPAL.audit.record({
      action: 'export', entity: 'audit_log', entityId: 'AUDIT-CSV',
      entityLabel: 'Activity Log · ' + rows.length + ' rows',
      companyId: filter.companyId || 'group',
      reason: 'CSV export' + describeFilter(filter)
    });

    var blob = new Blob([csv], { type:'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var stamp = new Date().toISOString().slice(0, 10);
    var link = el('a', { href:url, download:'epal-activity-log-' + stamp + '.csv' });
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    ui.toast(rows.length + ' audit rows exported', 'success');
  }
  function describeFilter(f) {
    var bits = [];
    if (f.user) bits.push('user=' + f.user);
    if (f.action) bits.push('action=' + f.action);
    if (f.entity) bits.push('entity=' + f.entity);
    if (f.companyId) bits.push('company=' + f.companyId);
    if (f.q) bits.push('q=' + f.q);
    return bits.length ? ' (' + bits.join(', ') + ')' : '';
  }
  function changesText(changes) {
    if (!changes || typeof changes !== 'object') return '';
    return Object.keys(changes).map(function (k) {
      var c = changes[k] || {}; return k + ': ' + fmtVal(c.old) + ' -> ' + fmtVal(c.new);
    }).join('; ');
  }
  function csvCell(v) {
    var s = v == null ? '' : String(v);
    if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  /* ==========================================================================
   * DENIED STATE (non-admins)
   * ========================================================================*/
  function deniedState() {
    return el('div.card', null, [
      el('div.empty-state', { style:{ padding:'48px 24px' } }, [
        ui.frag('<span class="notif-ico notif-error" style="width:56px;height:56px;font-size:24px">' + ui.icon('shield-lock-fill') + '</span>'),
        el('h3', { text:'Restricted — Admins only' }),
        el('p.text-muted', { text:'The global activity log contains sensitive audit data for the whole group. You need owner or admin access to view it.' }),
        el('a.btn.btn-ghost.mt-3', { href:'#/group/dashboard', html: ui.icon('arrow-left') + ' Back to Command Center' })
      ])
    ]);
  }

  /* ==========================================================================
   * SHARED HELPERS
   * ========================================================================*/
  function kpi(label, value, icon) {
    return el('div.kpi-card', null, [
      el('div.kpi-top', null, [
        el('span.kpi-label', { text:label }),
        el('span.kpi-ico', { html:'<i class="bi bi-' + icon + '"></i>' })
      ]),
      el('div.kpi-value', { text:String(value) })
    ]);
  }
  function fieldWrap(label, control) {
    return el('div.field', null, [ el('label', { text:label }), control ]);
  }
  function selectEl(name, allLabel, pairs) {
    var s = el('select.select', { 'data-f':name });
    s.appendChild(el('option', { value:'', text:allLabel }));
    pairs.forEach(function (p) { s.appendChild(el('option', { value:p[0], text:p[1] })); });
    return s;
  }

})(window.EPAL = window.EPAL || {});
