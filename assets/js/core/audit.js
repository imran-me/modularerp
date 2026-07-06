/* ============================================================================
 * EPAL GROUP ERP  ·  core/audit.js
 * ----------------------------------------------------------------------------
 * THE AUDIT TRAIL — a structured, tamper-evident "who did what, when" log.
 *
 * Every meaningful change in the group leaves a footprint here so the owner and
 * admins can answer: which user created that visa file, who edited a salary,
 * when did the accountant post a refund, who logged in. It is the compliance
 * backbone that turns a demo into something that feels enterprise-grade.
 *
 * HOW IT WORKS
 *   - record({action,entity,entityId,entityLabel,companyId,changes,reason})
 *     stamps id / time / user / ip / agent, upserts into the `audit_log` store,
 *     keeps that store capped (last 500 rows) so it never grows unbounded, and
 *     emits 'audit:logged' for any live listener.
 *   - boot() wires the engine into the nervous system: it records a 'login' for
 *     the current user, then listens on 'data:changed' and auto-records
 *     create / update / delete against known entity stores (noise stores are
 *     ignored), and listens on 'auth:changed' to record subsequent logins.
 *   - Money postings on the ledger self-audit inside core/ledger.js, so we do
 *     NOT subscribe to 'ledger:posted' (and skip the gl_entries store) to avoid
 *     double-logging.
 *
 * All reads/writes go through EPAL.store; nothing here touches localStorage
 * directly. Seeds use seedOnce so they survive a db.reset().
 * ==========================================================================*/

(function (EPAL) {
  'use strict';

  var STORE = 'audit_log';
  var CAP = 500;                    // hard ceiling on stored rows
  var IP = '127.0.0.1';             // demo constant

  /* Friendly labels for the stores we care to audit. A store missing from this
   * map is treated as noise and skipped (keeps the log signal-rich). Note that
   * gl_entries / coa are intentionally absent — the ledger audits its own
   * postings, so mirroring them here would double-log. -----------------------*/
  var LABELS = {
    visaApps: 'Visa Application', visaCats: 'Visa Category',
    airTickets: 'Air Ticket', airlines: 'Airline', airports: 'Airport', airRefunds: 'Air Refund',
    employees: 'Employee', customers: 'Customer', leads: 'Lead', vendors: 'Vendor',
    sales: 'Sale', tasks: 'Task', financials: 'Financials',
    approvals: 'Approval', documents: 'Document', comments: 'Comment',
    role_templates: 'Role Template', automation_rules: 'Automation Rule'
  };

  /* High-frequency / low-value stores we never audit (also a safety net so a
   * store that somehow slips a label past LABELS is still filtered). ---------*/
  var IGNORE = {
    audit_log: 1, serials: 1, 'module-overrides': 1, 'ui.theme': 1,
    activity: 1, notifications: 1, gl_entries: 1, coa: 1
  };

  function agentString() {
    return (typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent : 'server';
  }

  function currentUser() {
    return (EPAL.auth && EPAL.auth.current) ? (EPAL.auth.current() || {}) : {};
  }

  function todayStr() { return new Date().toISOString().slice(0, 10); }

  function isCreatedToday(rec) {
    if (!rec || !rec.created) return false;
    return String(rec.created).slice(0, 10) === todayStr();
  }

  /* Keep the store to the most-recent CAP rows (by timestamp). ---------------*/
  function capStore() {
    var arr = EPAL.store.list(STORE);
    if (arr.length <= CAP) return;
    arr.sort(function (a, b) { return (a.at || 0) - (b.at || 0); });
    EPAL.store.set(STORE, arr.slice(arr.length - CAP));
  }

  var AUDIT = {
    /* --- Record one audit row --------------------------------------------*/
    record: function (o) {
      o = o || {};
      var u = currentUser();
      var row = {
        id: EPAL.ui.uid('AL'),
        at: Date.now(),
        user: o.user || u.id || 'system',
        userName: o.userName || u.name || 'System',
        action: o.action || 'update',
        entity: o.entity || '',
        entityId: o.entityId || '',
        entityLabel: o.entityLabel || '',
        companyId: o.companyId || u.companyId || 'group',
        changes: o.changes || null,
        reason: o.reason || '',
        ip: IP,
        agent: agentString()
      };
      EPAL.store.upsert(STORE, row);
      capStore();
      if (EPAL.bus) EPAL.bus.emit('audit:logged', row);
      return row;
    },

    /* --- Query the log (newest first) ------------------------------------*/
    log: function (f) {
      f = f || {};
      var rows = EPAL.store.list(STORE).filter(function (r) {
        if (f.user && r.user !== f.user && r.userName !== f.user) return false;
        if (f.action && r.action !== f.action) return false;
        if (f.entity && r.entity !== f.entity) return false;
        if (f.companyId && r.companyId !== f.companyId) return false;
        if (f.from != null && r.at < f.from) return false;
        if (f.to != null && r.at > f.to) return false;
        if (f.q) {
          var q = String(f.q).toLowerCase();
          var hay = ((r.userName || '') + ' ' + (r.action || '') + ' ' + (r.entity || '') + ' ' +
                     (r.entityLabel || '') + ' ' + (r.entityId || '') + ' ' + (r.reason || '')).toLowerCase();
          if (hay.indexOf(q) < 0) return false;
        }
        return true;
      });
      rows.sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
      return rows;
    },

    /* --- All rows touching one entity (newest first) ---------------------*/
    forEntity: function (entity, entityId) {
      return EPAL.store.list(STORE).filter(function (r) {
        return r.entity === entity && String(r.entityId) === String(entityId);
      }).sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
    },

    /* --- Field-level diff helper → {field:{old,new}} ---------------------*/
    diff: function (before, after) {
      before = before || {}; after = after || {};
      var out = {}, keys = {}, k;
      for (k in before) { if (before.hasOwnProperty(k)) keys[k] = 1; }
      for (k in after) { if (after.hasOwnProperty(k)) keys[k] = 1; }
      Object.keys(keys).forEach(function (key) {
        var a = before[key], b = after[key];
        if (JSON.stringify(a) !== JSON.stringify(b)) out[key] = { old: a, new: b };
      });
      return out;
    }
  };

  EPAL.audit = AUDIT;

  /* ==========================================================================
   * SEED — believable historical rows (Bangladesh context), spread across the
   * last few days. Fixed ids + fixed timestamps keep the boot sweep stable.
   * ========================================================================*/
  function seedRows() {
    var B = 1783000000000, H = 3600000; // 1 hour in ms
    return [
      { id: 'AL-01', at: B - 72 * H, user: 'EPL-0001', userName: 'Mohsin (Owner)',
        action: 'login', entity: 'auth', entityId: 'EPL-0001', entityLabel: 'Mohsin (Owner)',
        companyId: 'group', changes: null, reason: '', ip: IP, agent: 'Chrome/Windows' },
      { id: 'AL-02', at: B - 70 * H, user: 'EPL-0004', userName: 'Nusrat Akter',
        action: 'create', entity: 'visaApps', entityId: 'VA-5012', entityLabel: 'Visa Application VA-5012',
        companyId: 'travels', changes: null, reason: 'New Malaysia tourist file', ip: IP, agent: 'Chrome/Windows' },
      { id: 'AL-03', at: B - 66 * H, user: 'EPL-0007', userName: 'Tanvir Rahman',
        action: 'create', entity: 'airTickets', entityId: 'TK-7009', entityLabel: 'Air Ticket TK-7009',
        companyId: 'travels', changes: null, reason: 'DAC → DXB, Emirates', ip: IP, agent: 'Chrome/Windows' },
      { id: 'AL-04', at: B - 52 * H, user: 'EPL-0001', userName: 'Mohsin (Owner)',
        action: 'update', entity: 'employees', entityId: 'EPL-DEV1', entityLabel: 'Employee EPL-DEV1',
        companyId: 'it', changes: { salary: { old: 72000, new: 78000 } }, reason: 'Annual increment', ip: IP, agent: 'Chrome/Windows' },
      { id: 'AL-05', at: B - 48 * H, user: 'EPL-0011', userName: 'Farhana Islam',
        action: 'approve', entity: 'visaApps', entityId: 'VA-5008', entityLabel: 'Visa Application VA-5008',
        companyId: 'travels', changes: { stage: { old: 'Under Process', new: 'Approved' } }, reason: '', ip: IP, agent: 'Chrome/Windows' },
      { id: 'AL-06', at: B - 44 * H, user: 'EPL-0009', userName: 'Sadia Chowdhury',
        action: 'create', entity: 'customers', entityId: 'CUS-1016', entityLabel: 'Customer CUS-1016',
        companyId: 'woodart', changes: null, reason: 'Meghna Group onboarding', ip: IP, agent: 'Chrome/Windows' },
      { id: 'AL-07', at: B - 30 * H, user: 'EPL-0006', userName: 'Rakib Hasan',
        action: 'update', entity: 'airTickets', entityId: 'TK-7003', entityLabel: 'Air Ticket TK-7003',
        companyId: 'travels', changes: { status: { old: 'Issued', new: 'Re-issued' } }, reason: 'Date change request', ip: IP, agent: 'Chrome/Windows' },
      { id: 'AL-08', at: B - 26 * H, user: 'EPL-0003', userName: 'Imran Karim',
        action: 'delete', entity: 'leads', entityId: 'LD-2031', entityLabel: 'Lead LD-2031',
        companyId: 'shop', changes: null, reason: 'Duplicate lead', ip: IP, agent: 'Chrome/Windows' },
      { id: 'AL-09', at: B - 20 * H, user: 'EPL-0001', userName: 'Mohsin (Owner)',
        action: 'export', entity: 'reports', entityId: 'RPT-PNL-06', entityLabel: 'Consolidated P&L · Jun 2026',
        companyId: 'group', changes: null, reason: 'Board pack', ip: IP, agent: 'Chrome/Windows' },
      { id: 'AL-10', at: B - 14 * H, user: 'EPL-0001', userName: 'Mohsin (Owner)',
        action: 'config', entity: 'module-manager', entityId: 'shop/pos', entityLabel: 'Shop · POS module',
        companyId: 'shop', changes: { enabled: { old: false, new: true } }, reason: 'Go-live', ip: IP, agent: 'Chrome/Windows' },
      { id: 'AL-11', at: B - 8 * H, user: 'EPL-0012', userName: 'Sharmin Begum',
        action: 'approve', entity: 'approvals', entityId: 'AP-3002', entityLabel: 'Payment ৳ 1,20,000 · Galaxy GSA',
        companyId: 'travels', changes: null, reason: 'Within limit', ip: IP, agent: 'Chrome/Windows' },
      { id: 'AL-12', at: B - 3 * H, user: 'EPL-0001', userName: 'Mohsin (Owner)',
        action: 'permission', entity: 'role_templates', entityId: 'accountant', entityLabel: 'Role · Accountant',
        companyId: 'group', changes: { grants: { old: 'view', new: 'view,export' } }, reason: 'Allow report export', ip: IP, agent: 'Chrome/Windows' }
    ];
  }

  /* ==========================================================================
   * ENGINE REGISTRATION
   * ========================================================================*/
  EPAL.registerEngine({
    name: 'audit',

    seed: function () {
      EPAL.store.seedOnce(STORE, seedRows());
    },

    boot: function () {
      // 1) Record a login for whoever is currently signed in.
      var u = currentUser();
      if (u && u.id) {
        AUDIT.record({
          action: 'login', entity: 'auth', entityId: u.id,
          entityLabel: u.name || u.id, companyId: u.companyId || 'group'
        });
      }

      // 2) Auto-audit create / update / delete from the data:changed firehose.
      EPAL.bus.on('data:changed', function (p) {
        if (!p || !p.store || p.store === '*') return;
        if (IGNORE[p.store]) return;
        var label = LABELS[p.store];
        if (!label) return;                       // unknown store → treat as noise

        var rec = p.record || {};
        var id = rec.id || p.id || '';

        // Honor an explicit action/reason set by the mutating flow (e.g. a
        // void/reissue/status-change carries t.__auditAction / t.__auditReason).
        // The __audit* markers are transient — they must not persist, so strip
        // them off the live record here (the upsert that triggered this event
        // already ran, but this keeps any later re-save clean).
        var explicitAction = rec.__auditAction || '';
        var explicitReason = rec.__auditReason || '';
        if (rec.__auditAction != null) { try { delete rec.__auditAction; } catch (e1) { rec.__auditAction = undefined; } }
        if (rec.__auditReason != null) { try { delete rec.__auditReason; } catch (e2) { rec.__auditReason = undefined; } }

        var action;
        if (p.action === 'delete') action = 'delete';
        else if (explicitAction) action = explicitAction;
        else if (p.action === 'create') action = 'create';
        else {
          // Upsert with no explicit verb: only the FIRST write for an entity is
          // a 'create'. If we already logged a create for this entity, every
          // later upsert is an 'update' — never a second 'create'. This avoids
          // mislabeling same-day voids/reissues/edits as fresh creates.
          var prior = AUDIT.forEntity(p.store, id);
          var hasCreate = false;
          for (var i = 0; i < prior.length; i++) {
            if (prior[i].action === 'create') { hasCreate = true; break; }
          }
          if (hasCreate) action = 'update';
          else action = isCreatedToday(rec) ? 'create' : 'update';
        }

        AUDIT.record({
          action: action,
          entity: p.store,
          entityId: id,
          entityLabel: label + (id ? ' ' + id : ''),
          companyId: rec.companyId || 'group',
          changes: (rec && rec.changes) || null,
          reason: explicitReason
        });
      });

      // 3) Subsequent logins (View As / role switch).
      EPAL.bus.on('auth:changed', function (p) {
        var user = (p && p.user) ? p.user : currentUser();
        if (!user || !user.id) return;
        AUDIT.record({
          action: 'login', user: user.id, userName: user.name || user.id,
          entity: 'auth', entityId: user.id, entityLabel: user.name || user.id,
          companyId: user.companyId || 'group'
        });
      });

      // NOTE: 'ledger:posted' is intentionally NOT subscribed — core/ledger.js
      // records its own audit rows for every posting.
    }
  });

})(window.EPAL = window.EPAL || {});
