/* ============================================================================
 * EPAL GROUP ERP  ·  core/approvals.js
 * ----------------------------------------------------------------------------
 * THE MAKER-CHECKER ENGINE — governance for money and sensitive actions.
 *
 * Enterprise ERPs never let one person both raise AND approve a payment. This
 * engine encodes that segregation of duties. A "maker" requests approval for a
 * document (a vendor payment, a refund, a salary change, a client deletion, a
 * credit-limit override); one or more "checkers" then approve or reject it,
 * and — crucially — the maker can never approve their own request.
 *
 * HOW IT WORKS
 *   - An APPROVAL MATRIX (store `approval_matrix`) declares, per document type
 *     and amount band, which roles must sign off. Higher amounts add more
 *     levels (e.g. a payment over 5L needs Finance Manager AND the MD).
 *   - needsApproval(docType, amount) looks up the matrix and returns either
 *     false (no approval needed) or { levels:[role, role...] } — one level per
 *     required role, approved in order.
 *   - request(...) creates a pending record, notifies + audits, and emits
 *     'approval:requested'.
 *   - decide(id, decision, {by, comment}) enforces maker != checker, advances
 *     through the levels, sets the final state, notifies the maker, audits, and
 *     emits 'approval:approved' / 'approval:rejected'. A comment is mandatory
 *     when rejecting.
 *   - onApproved(docType, fn) lets any module register an executor so that when
 *     one of its documents is fully approved, its real-world action runs.
 *
 * Records shape (store `approvals`):
 *   { id, at, docType, docId, companyId, title, amount, maker, makerName,
 *     state:'pending'|'approved'|'rejected'|'recalled', level, levels:[role...],
 *     steps:[{level, role, decidedBy, decidedByName, decision, at, comment}],
 *     created }
 *
 * All reads/writes go through EPAL.store / EPAL.db; seeds use seedOnce so they
 * survive db.reset(). ES5 only. Never write a literal star-slash in a comment.
 * ==========================================================================*/

(function (EPAL) {
  'use strict';

  var STORE = 'approvals';
  var MATRIX = 'approval_matrix';
  var MAX = 999999999999;      // "infinity" sentinel (JSON-safe, unlike Infinity)

  // Executor registry — modules register onApproved(docType, fn) so their
  // real action fires the moment a document is fully approved.
  var executors = {};

  function empName(id) {
    var e = (EPAL.db && EPAL.db.employee) ? EPAL.db.employee(id) : null;
    return (e && e.name) || id || 'Unknown';
  }

  var APPROVALS = {

    /* --- Matrix ----------------------------------------------------------*/
    matrix: function () { return EPAL.store.list(MATRIX); },

    setMatrix: function (rules) {
      EPAL.store.set(MATRIX, rules || []);
      if (EPAL.bus) EPAL.bus.emit('data:changed', { store: MATRIX, action: 'update' });
      return this.matrix();
    },

    /* --- Does this document need approval? -------------------------------
     * Returns false, or { levels:[role, role...] } — one required role per
     * approval level (approved bottom-up in array order).                 */
    needsApproval: function (docType, amount) {
      amount = +amount || 0;
      var rules = this.matrix(), match = null;
      for (var i = 0; i < rules.length; i++) {
        var r = rules[i];
        if (r.docType !== docType) continue;
        var min = (r.minAmount == null) ? 0 : r.minAmount;
        var max = (r.maxAmount == null) ? MAX : r.maxAmount;
        if (amount >= min && amount < max) { match = r; break; }
      }
      return match ? { levels: (match.roles || []).slice() } : false;
    },

    /* --- Raise an approval request ---------------------------------------*/
    request: function (o) {
      o = o || {};
      var need = this.needsApproval(o.docType, o.amount);
      // If a caller invokes request() the matrix should already say "yes", but
      // never drop the request on the floor — fall back to a single MD level.
      var roles = need ? need.levels : ['MD'];
      var now = Date.now();
      var req = {
        id: EPAL.ui.uid('APR'),
        at: now,
        docType: o.docType || '',
        docId: o.docId || '',
        companyId: o.companyId || 'group',
        title: o.title || '',
        amount: +o.amount || 0,
        maker: o.maker || '',
        makerName: o.makerName || empName(o.maker),
        state: 'pending',
        level: 1,
        levels: roles,
        steps: [],
        created: now
      };
      EPAL.store.upsert(STORE, req);

      if (EPAL.db && EPAL.db.notify) {
        EPAL.db.notify({
          level: 'warning',
          title: 'Approval needed',
          text: req.title,
          companyId: req.companyId,
          icon: 'patch-question-fill'
        });
      }
      if (EPAL.audit) {
        EPAL.audit.record({
          action: 'create', entity: STORE, entityId: req.id,
          entityLabel: req.title || ('Approval ' + req.id), companyId: req.companyId
        });
      }
      if (EPAL.bus) EPAL.bus.emit('approval:requested', req);
      return req;
    },

    /* --- Approve or reject a pending request -----------------------------
     * decision: 'approved' | 'rejected'. Enforces maker != checker and, on
     * reject, a mandatory comment. Advances through levels; the final level's
     * approval flips state to 'approved' and runs any registered executor.  */
    decide: function (id, decision, opts) {
      opts = opts || {};
      var req = this.get(id);
      if (!req) throw new Error('Approval request not found: ' + id);
      if (req.state !== 'pending') throw new Error('This request has already been ' + req.state + '.');

      var by = opts.by || (EPAL.auth && EPAL.auth.current ? (EPAL.auth.current() || {}).id : '');
      if (by && by === req.maker) throw new Error('Maker cannot approve own request');

      var comment = opts.comment || '';
      if (decision === 'rejected' && !String(comment).trim()) {
        throw new Error('A comment is required to reject a request.');
      }

      var role = req.levels[req.level - 1] || 'MD';
      var step = {
        level: req.level,
        role: role,
        decidedBy: by || '',
        decidedByName: opts.byName || empName(by),
        decision: decision,
        at: Date.now(),
        comment: comment
      };
      req.steps = (req.steps || []).concat([step]);

      var finalState;
      if (decision === 'rejected') {
        req.state = 'rejected';
        finalState = 'rejected';
      } else {
        // approved this level — advance, or finalise if that was the last level
        if (req.level < req.levels.length) {
          req.level = req.level + 1;
          req.state = 'pending';
          finalState = 'advanced';
        } else {
          req.state = 'approved';
          finalState = 'approved';
        }
      }
      EPAL.store.upsert(STORE, req);

      // Audit the decision.
      if (EPAL.audit) {
        EPAL.audit.record({
          action: decision === 'rejected' ? 'reject' : 'approve',
          entity: STORE, entityId: req.id,
          entityLabel: req.title || ('Approval ' + req.id),
          companyId: req.companyId,
          reason: comment
        });
      }

      // Notify the maker of the outcome.
      if (EPAL.db && EPAL.db.notify) {
        var note = finalState === 'rejected'
          ? { level: 'error', title: 'Request rejected', icon: 'x-octagon-fill' }
          : finalState === 'approved'
            ? { level: 'success', title: 'Request approved', icon: 'patch-check-fill' }
            : { level: 'info', title: 'Approval advanced', icon: 'arrow-up-circle-fill' };
        EPAL.db.notify({
          level: note.level, title: note.title, text: req.title,
          companyId: req.companyId, icon: note.icon
        });
      }

      // Emit the outcome events.
      if (EPAL.bus) {
        if (finalState === 'approved') EPAL.bus.emit('approval:approved', req);
        else if (finalState === 'rejected') EPAL.bus.emit('approval:rejected', req);
        else EPAL.bus.emit('approval:advanced', req);
      }

      // Fully approved → run the module's registered executor, if any.
      if (finalState === 'approved' && executors[req.docType]) {
        try { executors[req.docType](req); }
        catch (e) { console.error('[approvals] executor for ' + req.docType + ' threw:', e); }
      }

      return req;
    },

    /* --- Register a "run on full approval" action for a document type ----*/
    onApproved: function (docType, fn) {
      if (docType && typeof fn === 'function') executors[docType] = fn;
      return this;
    },

    /* --- Queries ---------------------------------------------------------*/
    // Pending requests. Pass { forUser } to exclude the user's own requests
    // (a maker can never be the checker of their own document).
    pending: function (o) {
      o = o || {};
      var uid = typeof o.forUser === 'string' ? o.forUser : (o.forUser && o.forUser.id);
      return EPAL.store.list(STORE).filter(function (r) {
        if (r.state !== 'pending') return false;
        if (uid && r.maker === uid) return false;
        return true;
      }).sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
    },

    list: function (f) {
      f = f || {};
      var rows = EPAL.store.list(STORE).filter(function (r) {
        if (f.state && r.state !== f.state) return false;
        if (f.docType && r.docType !== f.docType) return false;
        if (f.companyId && r.companyId !== f.companyId) return false;
        if (f.maker && r.maker !== f.maker) return false;
        return true;
      });
      rows.sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
      return rows;
    },

    get: function (id) {
      var rows = EPAL.store.list(STORE);
      for (var i = 0; i < rows.length; i++) { if (rows[i].id === id) return rows[i]; }
      return null;
    }
  };

  EPAL.approvals = APPROVALS;

  /* ==========================================================================
   * SEED — default approval matrix + believable pending queue (BD context).
   * Fixed ids + fixed timestamps keep the boot sweep deterministic.
   * ========================================================================*/
  function defaultMatrix() {
    return [
      // Vendor / supplier payments: banded by amount.
      { docType: 'payment', minAmount: 50000,  maxAmount: 500000, roles: ['Finance Manager'] },
      { docType: 'payment', minAmount: 500000, maxAmount: MAX,     roles: ['Finance Manager', 'MD'] },
      // Refunds of any size need Finance sign-off.
      { docType: 'refund', minAmount: 0, maxAmount: MAX, roles: ['Finance Manager'] },
      // Sensitive, non-money actions.
      { docType: 'salary-change',          minAmount: 0, maxAmount: MAX, roles: ['MD'] },
      { docType: 'credit-limit-override',  minAmount: 0, maxAmount: MAX, roles: ['MD'] },
      { docType: 'client-delete',          minAmount: 0, maxAmount: MAX, roles: ['admin'] }
    ];
  }

  function seedRequests() {
    var B = 1783000000000, H = 3600000; // fixed base, 1h in ms
    return [
      { id: 'AP-3001', at: B - 20 * H, docType: 'payment', docId: 'VN-301',
        companyId: 'travels',
        title: 'Vendor payment ' + EPAL.ui.money(620000) + ' · Galaxy GSA',
        amount: 620000, maker: 'EPL-0003', makerName: 'Imran Karim',
        state: 'pending', level: 1, levels: ['Finance Manager', 'MD'], steps: [], created: B - 20 * H },

      { id: 'AP-3002', at: B - 16 * H, docType: 'refund', docId: 'RF-9002',
        companyId: 'travels',
        title: 'Ticket refund ' + EPAL.ui.money(45000) + ' · Nusrat Akter (DAC→DXB)',
        amount: 45000, maker: 'EPL-0006', makerName: 'Rakib Hasan',
        state: 'pending', level: 1, levels: ['Finance Manager'], steps: [], created: B - 16 * H },

      { id: 'AP-3003', at: B - 11 * H, docType: 'salary-change', docId: 'EPL-DEV1',
        companyId: 'it',
        title: 'Salary revision · Tanvir Hasan → ' + EPAL.ui.money(92000) + ' / month',
        amount: 92000, maker: 'EPL-0004', makerName: 'Nusrat Akter',
        state: 'pending', level: 1, levels: ['MD'], steps: [], created: B - 11 * H },

      { id: 'AP-3004', at: B - 7 * H, docType: 'client-delete', docId: 'CUS-1013',
        companyId: 'group',
        title: 'Delete client · City Homes (duplicate account)',
        amount: 0, maker: 'EPL-0009', makerName: 'Sadia Chowdhury',
        state: 'pending', level: 1, levels: ['admin'], steps: [], created: B - 7 * H },

      { id: 'AP-3005', at: B - 3 * H, docType: 'credit-limit-override', docId: 'CUS-1005',
        companyId: 'travels',
        title: 'Credit-limit override · BRAC Corp → ' + EPAL.ui.money(1500000),
        amount: 1500000, maker: 'EPL-0007', makerName: 'Tanvir Rahman',
        state: 'pending', level: 1, levels: ['MD'], steps: [], created: B - 3 * H }
    ];
  }

  /* ==========================================================================
   * ENGINE REGISTRATION
   * ========================================================================*/
  EPAL.registerEngine({
    name: 'approvals',

    seed: function () {
      EPAL.store.seedOnce(MATRIX, defaultMatrix());
      EPAL.store.seedOnce(STORE, seedRequests());
    },

    boot: function () {
      // No runtime wiring required at boot — the engine reacts to explicit
      // request()/decide() calls from the views. Executors register lazily via
      // EPAL.approvals.onApproved(docType, fn). Reserved for future automation
      // (e.g. auto-escalation of stale approvals).
    }
  });

})(window.EPAL = window.EPAL || {});
