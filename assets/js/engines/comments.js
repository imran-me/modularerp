/* ============================================================================
 * EPAL GROUP ERP  ·  core/comments.js
 * ----------------------------------------------------------------------------
 * COLLABORATION THREADS + @MENTIONS.
 *
 * A tiny, embeddable discussion engine. Any detail drawer in the group (a visa
 * file, an air ticket, a task, a customer 360) can drop in a live comment
 * thread with one call — EPAL.comments.widget(entityType, entityId) — and get:
 *   - the existing conversation rendered with avatars, author, relative time,
 *     and @mentions highlighted,
 *   - a compose box (textarea + Post) that appends a new comment,
 *   - automatic @Name resolution: a token like "@Mohsin" is matched against the
 *     employee directory, stored as mentions:[empId], and each mentioned person
 *     is pinged through EPAL.db.notify (the topbar glow).
 *
 * Every write goes through EPAL.store + emits 'data:changed', so the audit
 * engine auto-logs it and any other open widget on the same entity refreshes.
 * Seeds are idempotent (seedOnce) so they survive db.reset().
 *
 * Comment row shape:
 *   { id, entityType, entityId, at, by, byName, text, mentions:[empId] }
 * ==========================================================================*/

(function (EPAL) {
  'use strict';

  var STORE = 'comments';

  /* A mention is an "@" followed by a single word (letters, then word chars,
   * dots, apostrophes or hyphens). Single-word keeps parsing unambiguous —
   * "@Mohsin please review" tags only "Mohsin", never the trailing words.
   * We build a fresh RegExp per use so the global lastIndex never leaks. -----*/
  var MENTION_SRC = '@([a-zA-Z][\\w.\'\\-]*)';

  var ui = EPAL.ui;

  function currentUserId() {
    var u = (EPAL.auth && EPAL.auth.current) ? EPAL.auth.current() : null;
    return (u && u.id) || 'EPL-0001';
  }

  function nameFor(empId) {
    var e = EPAL.db.employee ? EPAL.db.employee(empId) : null;
    return e ? e.name : empId;
  }

  /* Deep-link a mention notification back to the owning module. Best-effort;
   * unknown entity types just get no route (still a valid notification). -----*/
  function routeFor(entityType, entityId) {
    var map = {
      visaApps: '#/travels/visa-processing',
      airTickets: '#/travels/air-ticketing',
      airRefunds: '#/travels/air-ticketing/refunds',
      task: '#/group/tasks',
      tasks: '#/group/tasks',
      customer: '#/group/crm',
      customers: '#/group/crm',
      lead: '#/group/crm',
      leads: '#/group/crm'
    };
    return map[entityType] || null;
  }

  function snippet(text, n) {
    text = String(text || '').replace(/\s+/g, ' ').trim();
    n = n || 64;
    return text.length > n ? text.slice(0, n - 1) + '…' : text;
  }

  /* --- @mention resolution -------------------------------------------------
   * Extract every @token, then resolve each against the employee directory by
   * exact-name, first-name, or name-prefix match (case-insensitive). Returns a
   * de-duplicated array of employee ids. "@Mohsin" → "Mohsin (Owner)". --------*/
  function parseMentions(text) {
    var emps = (EPAL.db && EPAL.db.employees) ? EPAL.db.employees() : [];
    var re = new RegExp(MENTION_SRC, 'g');
    var ids = [], seen = {}, m;
    while ((m = re.exec(text))) {
      var token = String(m[1] || '').toLowerCase();
      if (!token) continue;
      var hit = null;
      for (var i = 0; i < emps.length; i++) {
        var nm = String(emps[i].name || '').toLowerCase();
        var first = nm.split(/\s+/)[0];
        if (nm === token || first === token || nm.indexOf(token) === 0) { hit = emps[i]; break; }
      }
      if (hit && !seen[hit.id]) { seen[hit.id] = 1; ids.push(hit.id); }
    }
    return ids;
  }

  /* Render comment text into a DOM node, wrapping every @token in
   * <span class="mention"> — done with textNodes + el() so user text is never
   * injected as raw HTML (no innerHTML for content). -------------------------*/
  function renderCommentText(text) {
    var wrap = ui.el('div.cmt-text');
    text = String(text == null ? '' : text);
    var re = new RegExp(MENTION_SRC, 'g');
    var last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) wrap.appendChild(document.createTextNode(text.slice(last, m.index)));
      wrap.appendChild(ui.el('span.mention', { text: '@' + m[1] }));
      last = re.lastIndex;
    }
    if (last < text.length) wrap.appendChild(document.createTextNode(text.slice(last)));
    return wrap;
  }

  function commentRow(c) {
    var who = c.byName || nameFor(c.by) || 'Unknown';
    var avatar = ui.el('div.cmt-avatar', {
      style: { background: ui.colorFor(who), color: '#fff' },
      text: ui.initials(who)
    });
    var head = ui.el('div.cmt-head', null, [
      ui.el('span.cmt-who', { text: who }),
      ui.el('span.cmt-ago', { text: ui.ago(c.at) })
    ]);
    var main = ui.el('div.cmt-main', null, [head, renderCommentText(c.text)]);
    return ui.el('div.cmt-item', null, [avatar, main]);
  }

  /* ==========================================================================
   * PUBLIC API
   * ========================================================================*/
  var COMMENTS = {
    /* All comments on one entity, oldest → newest. -------------------------*/
    thread: function (entityType, entityId) {
      return EPAL.store.list(STORE).filter(function (c) {
        return c.entityType === entityType && String(c.entityId) === String(entityId);
      }).sort(function (a, b) { return (a.at || 0) - (b.at || 0); });
    },

    /* Post a comment. Parses @mentions, notifies them, emits data:changed
     * (which the audit engine picks up automatically). ---------------------*/
    add: function (entityType, entityId, text, opts) {
      opts = opts || {};
      text = String(text == null ? '' : text);
      var by = opts.by || currentUserId();
      var byName = opts.byName || nameFor(by) || 'User';
      var mentions = parseMentions(text);

      var row = {
        id: ui.uid('CMT'),
        entityType: entityType,
        entityId: entityId,
        at: Date.now(),
        by: by,
        byName: byName,
        text: text,
        mentions: mentions
      };
      EPAL.store.upsert(STORE, row);

      mentions.forEach(function (empId) {
        if (empId === by) return;                       // never ping yourself
        var target = EPAL.db.employee ? EPAL.db.employee(empId) : null;
        EPAL.db.notify({
          level: 'info', icon: 'at',
          title: 'You were mentioned',
          text: byName + ' mentioned you: "' + snippet(text) + '"',
          companyId: (target && target.companyId) || 'group',
          to: empId,
          route: routeFor(entityType, entityId)
        });
      });

      if (EPAL.bus) EPAL.bus.emit('data:changed', { store: STORE, action: 'create', record: row });
      return row;
    },

    /* An embeddable thread widget: renders the conversation + a compose box.
     * Returns an HTMLElement containing a .cmt-thread. by defaults to the
     * current user inside add(). --------------------------------------------*/
    widget: function (entityType, entityId) {
      var wrap = ui.el('div.cmt-widget');
      var thread = ui.el('div.cmt-thread');

      function refresh() {
        thread.innerHTML = '';
        var rows = COMMENTS.thread(entityType, entityId);
        if (!rows.length) {
          thread.appendChild(ui.el('div.cmt-empty', {
            text: 'No comments yet — start the conversation. Use @name to mention a teammate.'
          }));
        } else {
          rows.forEach(function (c) { thread.appendChild(commentRow(c)); });
        }
      }
      refresh();

      var ta = ui.el('textarea.cmt-input', {
        rows: 2, placeholder: 'Write a comment…  use @name to mention'
      });
      function post() {
        var val = (ta.value || '').trim();
        if (!val) { ui.toast('Write something first', 'warning'); return; }
        COMMENTS.add(entityType, entityId, val, {});
        ta.value = '';
        refresh();
        thread.scrollTop = thread.scrollHeight;
      }
      // Ctrl/Cmd+Enter also posts.
      ta.addEventListener('keydown', function (e) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); post(); }
      });
      var btn = ui.el('button.btn.btn-primary.cmt-post', {
        type: 'button', html: ui.icon('send') + ' Post', onclick: post
      });
      var compose = ui.el('div.cmt-compose', null, [
        ta, ui.el('div.cmt-compose-actions', null, [btn])
      ]);

      wrap.appendChild(thread);
      wrap.appendChild(compose);

      // Live-sync: if a comment lands on this entity from elsewhere, refresh —
      // but only while this widget is still in the document.
      if (EPAL.bus) {
        var off = EPAL.bus.on('data:changed', function (p) {
          if (!document.body.contains(wrap)) { off(); return; }
          if (!p || p.store !== STORE) return;
          var r = p.record;
          if (r && (r.entityType !== entityType || String(r.entityId) !== String(entityId))) return;
          refresh();
        });
      }

      return wrap;
    }
  };

  EPAL.comments = COMMENTS;

  /* ==========================================================================
   * SEED — believable Bangladesh-context threads across sample entities.
   * Fixed ids + fixed timestamps + hardcoded mention ids keep the boot sweep
   * deterministic. Several tag @Mohsin (the owner, EPL-0001).
   * ========================================================================*/
  function seedRows() {
    var B = 1783000000000, H = 3600000;   // fixed demo epoch + one hour in ms
    return [
      { id: 'CMT-01', entityType: 'visaApps', entityId: 'VA-5003', at: B - 96 * H,
        by: 'EPL-0004', byName: 'Nusrat Akter',
        text: 'Applicant submitted the bank statement and NOC. Malaysia file is ready for submission.',
        mentions: [] },
      { id: 'CMT-02', entityType: 'visaApps', entityId: 'VA-5003', at: B - 90 * H,
        by: 'EPL-0007', byName: 'Tanvir Rahman',
        text: '@Mohsin can you approve the vendor payment to Galaxy GSA before we lodge?',
        mentions: ['EPL-0001'] },
      { id: 'CMT-03', entityType: 'visaApps', entityId: 'VA-5003', at: B - 84 * H,
        by: 'EPL-0001', byName: 'Mohsin (Owner)',
        text: 'Approved. Please make sure the return ticket is on hold, not issued.',
        mentions: [] },
      { id: 'CMT-04', entityType: 'airTickets', entityId: 'TK-7001', at: B - 70 * H,
        by: 'EPL-0006', byName: 'Rakib Hasan',
        text: 'Passenger requested seat 12A on the Emirates leg. Coordinating with the GSA now.',
        mentions: [] },
      { id: 'CMT-05', entityType: 'airTickets', entityId: 'TK-7001', at: B - 60 * H,
        by: 'EPL-0012', byName: 'Sharmin Begum',
        text: 'Fare has gone up ৳3,500 since the quote. @Mohsin should we absorb it or re-quote the client?',
        mentions: ['EPL-0001'] },
      { id: 'CMT-06', entityType: 'task', entityId: 'T-1001', at: B - 40 * H,
        by: 'EPL-0001', byName: 'Mohsin (Owner)',
        text: 'Prioritise refresh-token rotation. @Tanvir please add unit tests before the review stage.',
        mentions: ['EPL-DEV1'] },
      { id: 'CMT-07', entityType: 'task', entityId: 'T-1001', at: B - 34 * H,
        by: 'EPL-DEV1', byName: 'Tanvir Hasan',
        text: 'Rotation is done and covered by tests. Moving API endpoints to 80% today.',
        mentions: [] },
      { id: 'CMT-08', entityType: 'customer', entityId: 'CUS-1001', at: B - 18 * H,
        by: 'EPL-0009', byName: 'Sadia Chowdhury',
        text: 'Rahim Enterprise wants a group rate for 14 Umrah passengers in Ramadan. @Mohsin flagging for pricing.',
        mentions: ['EPL-0001'] }
    ];
  }

  /* ==========================================================================
   * ENGINE REGISTRATION
   * ========================================================================*/
  EPAL.registerEngine({
    name: 'comments',
    seed: function () {
      EPAL.store.seedOnce(STORE, seedRows());
    },
    boot: function () {
      // No runtime wiring needed: add() emits data:changed, the audit engine
      // logs it, and every open widget on the same entity self-refreshes.
    }
  });

})(window.EPAL = window.EPAL || {});
