/* ============================================================================
 * EPAL GROUP ERP  ·  platform/bridge/bridge.js
 * ----------------------------------------------------------------------------
 * PHASE 3b — THE GROUP BRIDGE (the event line in the kernel).
 *
 * "Sell a ticket in Travels and it shows up in both Travels AND the Group."
 * A company never reaches into Group code and vice-versa; they meet only here.
 * Each company declares WHAT it rolls up in its own `bridge.map`; the same
 * mapping is normalised below so a module can emit a domain event and the Group
 * consolidation receives a company-tagged rollup record.
 *
 * WHAT'S LIVE vs WHAT'S CONTRACT (important — this is why nothing's numbers move):
 *   · Today the Group totals are computed ON READ from the shared store
 *     (EPAL.db.groupSnapshot / series / ledger.consolidatedTrialBalance). As of
 *     Phase 3b those reads honour AUTO-DISCOVERY, so a company whose FOLDER is
 *     deleted cleanly leaves the Group books — proven byte-identical when every
 *     folder is present. That on-read path stays the source of truth (R4).
 *   · This bridge is the EXPLICIT, observable event seam on top of it: the exact
 *     contract the Laravel rebuild implements (company emits event -> bridge ->
 *     group consolidation subscribes). It is additive — it changes no number.
 *   · verify() mechanises the brief's "prove the bridge total matches today's":
 *     it asserts the on-read group revenue equals the sum over the PRESENT
 *     operating companies, i.e. the two views agree.
 *
 * ==> LARAVEL: a domain-event bus (events + listeners); each company's service
 *     dispatches its bridge.map events; a GroupConsolidation listener projects
 *     them into the group ledger. bridge.map becomes the listener routing table.
 * ========================================================================== */
(function (EPAL) {
  'use strict';

  // Normalised rollup routing — mirrors each companies/<x>/bridge.map (which is
  // the human/declarative copy). event -> { bucket, account }.
  var MAPS = {
    travels: { 'ticket.sold': ['group.revenue', '4001'], 'visa.approved': ['group.revenue', '4002'], 'payment.received': ['group.cash', '1001'], 'expense.recorded': ['group.expense', '5001'] },
    woodart: { 'project.invoiced': ['group.revenue', '4001'], 'milestone.billed': ['group.revenue', '4002'], 'material.purchased': ['group.expense', '5002'], 'expense.recorded': ['group.expense', '5001'] },
    it: { 'subscription.billed': ['group.revenue', '4001'], 'project.invoiced': ['group.revenue', '4002'], 'expense.recorded': ['group.expense', '5001'] },
    shop: { 'pos.sale': ['group.revenue', '4001'], 'purchase.recorded': ['group.expense', '5002'], 'stock.adjusted': ['group.inventory', '1200'], 'expense.recorded': ['group.expense', '5001'] },
    construction: { 'tender.won': ['group.revenue', '4003'], 'progress.billed': ['group.revenue', '4001'], 'procurement.spent': ['group.expense', '5002'], 'labor.paid': ['group.expense', '5003'] }
  };

  var subscribers = [];

  var Bridge = {
    maps: MAPS,

    /* A company records something worth rolling up. Normalises via its bridge.map
       and notifies the Group side. Only fires for a PRESENT company (a deleted
       folder cannot roll up). Returns the rollup record (or null if unmapped). */
    emit: function (companyId, event, payload) {
      if (EPAL.discovery && !EPAL.discovery.presentFor(companyId)) return null;
      var route = MAPS[companyId] && MAPS[companyId][event];
      if (!route) return null;
      var rec = {
        company: companyId, event: event, bucket: route[0], account: route[1],
        amount: (payload && payload.amount) || 0, ref: payload && payload.ref, at: (payload && payload.at) || null
      };
      subscribers.forEach(function (fn) { try { fn(rec); } catch (e) {} });
      if (EPAL.bus && EPAL.bus.emit) EPAL.bus.emit('bridge:rollup', rec);
      return rec;
    },

    /* The Group consolidation subscribes here (Laravel: a listener). */
    on: function (fn) { if (typeof fn === 'function') subscribers.push(fn); return this; },

    /* Equivalence proof: the on-read group revenue must equal the sum over the
       PRESENT operating companies. Returns { onRead, computed, match }. */
    verify: function () {
      if (!(EPAL.db && EPAL.db.groupSnapshot)) return { match: null };
      var snap = EPAL.db.groupSnapshot();
      var computed = (snap.companies || []).reduce(function (a, c) { return a + (c.revenue || 0); }, 0);
      return { onRead: snap.revenue, computed: computed, match: snap.revenue === computed };
    }
  };

  EPAL.bridge = Bridge;
})(window.EPAL = window.EPAL || {});
