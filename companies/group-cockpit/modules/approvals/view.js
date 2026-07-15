/* ============================================================================
 * EPAL GROUP ERP  ·  views/group/approvals.js
 * ----------------------------------------------------------------------------
 * APPROVALS INBOX — the maker-checker command desk for the whole group.
 *
 * Enterprise governance in one screen: no single person may both raise AND
 * authorise a big move. This view is the CHECKER's inbox. It reads the live
 * EPAL.approvals engine and lets the owner (or any authorised checker) work a
 * queue of pending requests — vendor payments, ticket refunds, salary changes,
 * credit-limit overrides, client deletions — approving or rejecting each with a
 * full, auditable trail.
 *
 * Three tabs (pill buttons — the module registers no sub-routes):
 *   My Queue       → requests awaiting THIS checker. For the demo owner we show
 *                    every pending request (the owner signs off on everything).
 *   Submitted by me→ requests THIS user raised as a maker (their outbox).
 *   History        → every decided request (approved / rejected), read-only.
 *
 * Each request renders as an .appr-card (icon by docType, title, company, maker,
 * waiting-since, amount right-aligned; .overdue when older than the ~24h SLA).
 * Click a card to open the full approval trail + document summary in a modal,
 * with Approve / Reject controls and an embedded comment thread. Reject demands
 * a mandatory comment. Both decisions route through EPAL.approvals.decide(),
 * which throws if maker===checker — we catch that and surface a toast. A live
 * "Approval Matrix" card documents the rules, read-only.
 *
 * All state lives in the EPAL.approvals engine (store `approvals`); every
 * decision emits engine events + an audit record. ES5 only. Never write a
 * literal star-slash inside a block comment.
 * ==========================================================================*/

(function (EPAL) {
  'use strict';
  var ui = EPAL.ui, el = ui.el, db = EPAL.db, S = EPAL.store;

  var SLA_MS = 24 * 3600 * 1000;              // 24h service-level for pending
  var MAX = 999999999999;                     // matrix "infinity" sentinel
  var GREEN_BTN = { '--btn-bg':'var(--good)', color:'#fff', borderColor:'transparent' };

  // Visual identity per document type (icon + accent + human label).
  var DOC = {
    'payment':               { icon:'cash-stack',           color:'#2f6bff', label:'Vendor Payment' },
    'refund':                { icon:'arrow-counterclockwise',color:'#f4b740', label:'Ticket Refund' },
    'salary-change':         { icon:'wallet2',               color:'#7b5cff', label:'Salary Change' },
    'credit-limit-override': { icon:'credit-card-2-front',   color:'#23c17e', label:'Credit-limit Override' },
    'client-delete':         { icon:'person-x',              color:'#f0506e', label:'Client Deletion' }
  };
  function docMeta(t) { return DOC[t] || { icon:'patch-question', color:'#8b93a7', label:(t||'Request') }; }

  function compName(id) {
    var c = (EPAL.config.companies || []).filter(function (x) { return x.id === id; })[0];
    return (c && c.name) || (id || 'Group');
  }
  function A() { return EPAL.approvals; }

  /* ==========================================================================
   * VIEW
   * ========================================================================*/
  EPAL.view('group/approvals', {
    render: function (ctx) {
      var cu = EPAL.auth.current() || { id:'EPL-0001', name:'Owner' };
      var state = { tab: ctx.subId === 'submitted' || ctx.subId === 'history' ? ctx.subId : 'queue' };

      var page = el('div.page');
      var badge = el('span.badge.badge-warn', { style:{ marginLeft:'2px' } });
      page.appendChild(EPAL.pageHead({
        eyebrow:'Epal Group', icon:'patch-check-fill', title:'Approvals Inbox',
        sub:'Maker-checker governance — authorise (or reject) the big moves, with a full audit trail.',
        actions: [ badge ]
      }));

      // SECTION NAV — the house full-bleed underline band (owner grammar
      // 2026-07-15); drawTabs() below rebuilds the buttons with live counts
      var tabsWrap = el('div.tab-underline.mb-3');
      page.appendChild(tabsWrap);

      // content host
      var host = el('div');
      page.appendChild(host);

      ctx.mount.appendChild(page);

      function counts() {
        return {
          queue: myQueue(cu).length,
          submitted: A().list({ maker: cu.id }).length,
          history: A().list().filter(function (r) { return r.state !== 'pending'; }).length
        };
      }

      function drawTabs() {
        var c = counts();
        badge.textContent = c.queue + ' pending';
        tabsWrap.innerHTML = '';
        [ ['queue','My Queue', c.queue], ['submitted','Submitted by me', c.submitted], ['history','History', c.history] ]
          .forEach(function (t) {
            var b = el('button' + (state.tab === t[0] ? '.active' : ''), {
              html: ui.escapeHtml(t[1]) + ' <span class="num" style="opacity:.7">' + t[2] + '</span>',
              onclick: function () { state.tab = t[0]; draw(); }
            });
            tabsWrap.appendChild(b);
          });
      }

      function draw() {
        drawTabs();
        host.innerHTML = '';
        if (state.tab === 'queue') drawQueue(host, cu, draw);
        else if (state.tab === 'submitted') drawSubmitted(host, cu);
        else drawHistory(host);
        host.appendChild(matrixCard());
      }

      draw();
    }
  });

  // My Queue: owner sees ALL pending; anyone else sees requests they may check.
  function myQueue(cu) {
    if (EPAL.auth.isOwner && EPAL.auth.isOwner()) {
      return A().list({ state:'pending' });
    }
    return A().pending({ forUser: cu.id });
  }

  /* ======================================================= MY QUEUE */
  function drawQueue(host, cu, refresh) {
    var rows = myQueue(cu);
    var pendingAmt = rows.reduce(function (s, r) { return s + (r.amount || 0); }, 0);
    var overdue = rows.filter(isOverdue).length;
    host.appendChild(el('div.kpi-grid.mb-3', null, [
      kpi('Awaiting You', rows.length, 'inbox-fill'),
      kpi('Overdue (>24h)', overdue, 'alarm-fill'),
      kpi('Value in Queue', ui.money(pendingAmt, { compact:true }), 'cash-coin'),
      kpi('Doc Types', uniqueDocTypes(rows).length, 'collection-fill')
    ]));
    if (!rows.length) { host.appendChild(emptyState('Queue clear', 'No requests are waiting on you. Nicely done.')); return; }
    host.appendChild(el('div.section-label', { text:'Pending decisions' }));
    var list = el('div.stagger');
    rows.forEach(function (r) { list.appendChild(apprCard(r, cu, refresh, true)); });
    host.appendChild(list);
  }

  /* ======================================================= SUBMITTED BY ME */
  function drawSubmitted(host, cu) {
    var rows = A().list({ maker: cu.id });
    host.appendChild(el('div.section-label', { text:'Requests you raised' }));
    if (!rows.length) {
      host.appendChild(emptyState('Nothing submitted', 'You have not raised any approval requests. When a module asks the engine to approve one of your documents, it will appear here so you can track its progress.'));
      return;
    }
    var list = el('div.stagger');
    rows.forEach(function (r) { list.appendChild(apprCard(r, cu, null, false)); });
    host.appendChild(list);
  }

  /* ======================================================= HISTORY */
  function drawHistory(host) {
    var rows = A().list().filter(function (r) { return r.state !== 'pending'; });
    var approved = rows.filter(function (r) { return r.state === 'approved'; }).length;
    var rejected = rows.filter(function (r) { return r.state === 'rejected'; }).length;
    host.appendChild(el('div.kpi-grid.mb-3', null, [
      kpi('Decided', rows.length, 'clipboard-check-fill'),
      kpi('Approved', approved, 'patch-check-fill'),
      kpi('Rejected', rejected, 'x-octagon-fill'),
      kpi('Approval Rate', (rows.length ? Math.round(approved / rows.length * 100) : 0) + '%', 'graph-up-arrow')
    ]));
    host.appendChild(el('div.section-label', { text:'Decision history' }));
    if (!rows.length) { host.appendChild(emptyState('No history yet', 'Approved and rejected requests will be listed here.')); return; }
    var list = el('div.stagger');
    rows.forEach(function (r) { list.appendChild(apprCard(r, null, null, false)); });
    host.appendChild(list);
  }

  /* ---------------------------------------------------- the card */
  function apprCard(r, cu, refresh, actionable) {
    var m = docMeta(r.docType);
    var over = actionable && isOverdue(r);
    var card = el('div.appr-card' + (over ? '.overdue' : ''), {
      style:{ '--accent': m.color, cursor:'pointer' },
      onclick: function () { openDetail(r, cu, refresh, actionable); }
    });
    card.appendChild(el('div.appr-ico', { html: ui.icon(m.icon) }));

    var sub = compName(r.companyId) + ' · ' + m.label + ' · ' + (r.makerName || r.maker || '—')
            + ' · ' + (r.state === 'pending' ? 'waiting ' + ui.ago(r.at) : ui.ago(r.at));
    var main = el('div.appr-main', null, [
      el('h4', { text: r.title || (m.label + ' ' + r.id) }),
      el('div.appr-sub', { text: sub })
    ]);
    // status / overdue chips
    var chips = el('div.flex.gap-1.mt-1', null, [ stateBadge(r.state), levelBadge(r) ]);
    if (over) chips.appendChild(el('span.badge.badge-bad', { html: ui.icon('alarm') + ' Overdue' }));
    main.appendChild(chips);
    card.appendChild(main);

    card.appendChild(el('div.appr-amt', { text: r.amount ? ui.money(r.amount) : '—' }));

    if (actionable && r.state === 'pending') {
      var acts = el('div.appr-actions', null, [
        el('button.btn.btn-sm', { style: GREEN_BTN, html: ui.icon('check-lg') + ' Approve',
          onclick: function (e) { e.stopPropagation(); doApprove(r, cu, refresh); } }),
        el('button.btn.btn-sm.btn-danger', { html: ui.icon('x-lg') + ' Reject',
          onclick: function (e) { e.stopPropagation(); promptReject(r, cu, refresh); } })
      ]);
      card.appendChild(acts);
    }
    return card;
  }

  /* ---------------------------------------------------- detail modal */
  function openDetail(r, cu, refresh, actionable) {
    var m = docMeta(r.docType);
    var body = el('div');
    var modal = ui.modal({ title: r.title || (m.label + ' ' + r.id), icon: m.icon, size:'lg', body: body, footer:false });

    function redraw() {
      body.innerHTML = '';
      body.appendChild(el('div.flex.gap-1.flex-wrap.mb-3', null, [
        stateBadge(r.state), levelBadge(r), el('span.badge', { text: m.label }),
        el('span.badge', { text: r.id })
      ]));

      // document summary
      body.appendChild(el('div.section-label', { text:'Document summary' }));
      body.appendChild(el('div.form-grid', null, [
        kv('Document type', m.label),
        kv('Reference', r.docId || '—'),
        kv('Company', compName(r.companyId)),
        kv('Amount', r.amount ? ui.money(r.amount) : '—'),
        kv('Raised by', r.makerName || r.maker || '—'),
        kv('Requested', ui.date(r.at, 'full')),
        kv('Waiting', ui.ago(r.at)),
        kv('Required sign-off', (r.levels || []).join(' → ') || '—')
      ]));

      // approval trail
      body.appendChild(el('div.section-label', { text:'Approval trail' }));
      body.appendChild(trailNode(r));

      // comments thread (governance discussion)
      if (EPAL.comments && EPAL.comments.widget) {
        body.appendChild(el('div.section-label', { text:'Discussion' }));
        body.appendChild(EPAL.comments.widget('approval', r.id));
      }

      // decision controls (only when this queue is actionable + still pending)
      if (actionable && r.state === 'pending') {
        body.appendChild(el('div.divider'));
        body.appendChild(el('div.flex.gap-1.flex-wrap', null, [
          el('button.btn', { style: GREEN_BTN, html: ui.icon('check-lg') + ' Approve',
            onclick: function () { doApprove(r, cu, function () { modal.close(); refresh && refresh(); }); } }),
          el('button.btn.btn-danger', { html: ui.icon('x-lg') + ' Reject',
            onclick: function () { promptReject(r, cu, function () { modal.close(); refresh && refresh(); }); } })
        ]));
      }
    }
    redraw();
  }

  function trailNode(r) {
    var wrap = el('div.appr-trail');
    var steps = r.steps || [];
    (r.levels || []).forEach(function (role, i) {
      var lvl = i + 1;
      var step = steps.filter(function (s) { return s.level === lvl; })[0];
      var row = el('div.flex.items-center.gap-2', { style:{ padding:'5px 0' } });
      var ok = step && step.decision === 'approved';
      var no = step && step.decision === 'rejected';
      var cls = ok ? 'ok' : no ? 'no' : '';
      var mark = ok ? ui.icon('check-circle-fill') : no ? ui.icon('x-circle-fill')
               : (r.state === 'pending' && r.level === lvl) ? ui.icon('hourglass-split') : ui.icon('circle');
      row.appendChild(el('span.' + (cls || 'text-mute'), { html: mark }));
      var txt = 'Level ' + lvl + ' · ' + role;
      if (step) txt += ' — ' + (step.decision === 'approved' ? 'Approved' : 'Rejected') + ' by '
                     + (step.decidedByName || step.decidedBy || '—') + ' · ' + ui.ago(step.at);
      else if (r.state === 'pending' && r.level === lvl) txt += ' — awaiting decision';
      else txt += ' — pending';
      var body = el('div.flex-1', null, [ el('div.sm' + (cls ? '.' + cls : ''), { text: txt }) ]);
      if (step && step.comment) body.appendChild(el('div.xs.text-mute', { text: '“' + step.comment + '”' }));
      row.appendChild(body);
      wrap.appendChild(row);
    });
    if (!(r.levels || []).length) wrap.appendChild(el('div.sm.text-mute', { text:'No approval levels configured.' }));
    return wrap;
  }

  /* ---------------------------------------------------- decisions */
  function doApprove(r, cu, done) {
    cu = cu || EPAL.auth.current() || {};
    try {
      A().decide(r.id, 'approved', { by: cu.id, byName: cu.name });
      ui.toast('Approved · ' + (r.title || r.id), 'success');
      done && done();
    } catch (e) {
      ui.toast(e && e.message ? e.message : 'Could not approve this request', 'error');
    }
  }

  function promptReject(r, cu, done) {
    cu = cu || EPAL.auth.current() || {};
    var ta = el('textarea.input', { rows:'3', placeholder:'Reason for rejection (required) — this is recorded on the audit trail.' });
    var body = el('div', null, [
      el('p.text-muted.sm.mb-2', { text: 'Rejecting: ' + (r.title || r.id) }),
      el('div.field', null, [ el('label', { text:'Rejection comment' }), ta ])
    ]);
    ui.modal({
      title:'Reject request', icon:'x-octagon', size:'sm', body: body,
      actions: [
        { label:'Cancel', variant:'ghost' },
        { label:'Reject', variant:'danger', onClick: function () {
            var comment = (ta.value || '').trim();
            if (!comment) { ui.toast('A comment is required to reject', 'error'); return false; }
            try {
              A().decide(r.id, 'rejected', { by: cu.id, byName: cu.name, comment: comment });
              ui.toast('Request rejected', 'success');
              done && done();
            } catch (e) {
              ui.toast(e && e.message ? e.message : 'Could not reject this request', 'error');
              return false;
            }
          } }
      ]
    });
  }

  /* ======================================================= APPROVAL MATRIX */
  function matrixCard() {
    var rules = A().matrix();
    var card = el('div.card.mt-3');
    card.appendChild(el('div.card-head', null, [
      el('h3', { html: ui.icon('diagram-3-fill') + ' Approval Matrix' }),
      el('span.card-sub', { text:'Who must sign off, by document type & amount band (read-only)' })
    ]));
    if (!rules.length) {
      card.appendChild(el('div.card-body', null, [ el('p.text-muted.sm', { text:'No approval rules configured.' }) ]));
      return card;
    }
    var table = el('table.tbl');
    table.innerHTML = '<thead><tr><th>Document Type</th><th>Amount Band</th><th>Required Sign-off</th></tr></thead>';
    var tb = el('tbody');
    rules.forEach(function (r) {
      var meta = docMeta(r.docType);
      var band;
      var min = r.minAmount == null ? 0 : r.minAmount;
      var max = r.maxAmount == null ? MAX : r.maxAmount;
      if (min === 0 && max >= MAX) band = 'Any amount';
      else if (max >= MAX) band = ui.money(min) + ' and above';
      else band = ui.money(min) + ' – ' + ui.money(max);
      var tr = el('tr');
      tr.appendChild(td('<span style="color:' + meta.color + '">' + ui.icon(meta.icon) + '</span> <span class="strong">' + ui.escapeHtml(meta.label) + '</span>'));
      tr.appendChild(td(ui.escapeHtml(band)));
      tr.appendChild(td((r.roles || []).map(function (role) { return '<span class="badge">' + ui.escapeHtml(role) + '</span>'; }).join(' ')));
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    card.appendChild(el('div.table-wrap', null, [ table ]));
    return card;
  }

  /* ---------------------------------------------------- helpers */
  function isOverdue(r) { return r.state === 'pending' && (Date.now() - (r.at || 0)) > SLA_MS; }
  function uniqueDocTypes(rows) {
    var seen = {}, out = [];
    rows.forEach(function (r) { if (!seen[r.docType]) { seen[r.docType] = 1; out.push(r.docType); } });
    return out;
  }
  function stateBadge(state) {
    var map = { pending:['badge-warn','Pending'], approved:['badge-good','Approved'], rejected:['badge-bad','Rejected'], recalled:['','Recalled'] };
    var s = map[state] || ['', state || '—'];
    return el('span.badge' + (s[0] ? '.' + s[0] : ''), { text: s[1] });
  }
  function levelBadge(r) {
    var n = (r.levels || []).length || 1;
    var at = r.state === 'pending' ? r.level : n;
    return el('span.badge', { text: 'Level ' + at + '/' + n });
  }
  function kpi(label, value, icon) {
    return el('div.kpi-card', null, [
      el('div.kpi-top', null, [ el('span.kpi-label', { text: label }), el('span.kpi-ico', { html:'<i class="bi bi-' + icon + '"></i>' }) ]),
      el('div.kpi-value', { text: String(value) })
    ]);
  }
  function emptyState(title, msg) {
    return el('div.empty-state', null, [ ui.frag(ui.icon('inbox')), el('h3', { text: title }), el('p.text-muted', { text: msg || '' }) ]);
  }
  function kv(k, v) { return el('div.field', null, [ el('label', { text: k }), el('div.fw-600', { text: String(v) }) ]); }
  function td(html) { var t = el('td'); t.innerHTML = html; return t; }

})(window.EPAL = window.EPAL || {});
