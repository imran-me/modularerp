/* ============================================================================
 * EPAL KIT · DEMO DATA SWITCH
 * ----------------------------------------------------------------------------
 * Owner, 2026-07-29: "why does after reload all data vanishes????? Just make a
 * option in the settings, load demo data, if click that, demo data will be
 * permanent, after turning off the demo data in the same place in settings, the
 * data will be vanished, and the real database will work perfectly."
 *
 * WHY IT VANISHED. On a live host the app HYDRATES from the server on every page
 * load: api.js fetches each store and does S.set(key, serverRows). pay_runs,
 * pay_slips and pay_txns are all hydrated stores, so anything generated in the
 * browser was overwritten by whatever the server holds — which for January to
 * July is nothing. The demo history was never deleted; it was replaced, every
 * reload, by the truth from the database.
 *
 * HOW THIS MAKES IT PERMANENT WITHOUT TOUCHING THE DATABASE. It does not store
 * the demo data at all. It stores ONE FLAG, and re-generates the history after
 * every hydration. That works because the generator is deterministic (variety is
 * a hash of employee id + month, never Math.random) and idempotent — it produces
 * the identical seven months every time. So the data survives reloads, and the
 * server never receives a single row of it.
 *
 * Turning it off clears the browser-side stores and reloads: hydration then
 * refills them from the database and the real books are back, untouched, because
 * they were never written to in the first place.
 *
 * ORDER MATTERS. applyIfOn() is called from App.start(), which runs AFTER
 * api.hydrate() resolves and AFTER api.wireWrites() — so the server's rows are
 * already in place (we add to them, never fight them) and EPAL.api.live is set,
 * which is what makes withoutDbWrites() suspend the push.
 * ==========================================================================*/
(function (EPAL) {
  'use strict';

  var FLAG = 'demo_payroll_on';

  /* Stores the sample payroll owns. The hydrated ones (pay_*) are refilled from
   * the server on the next load anyway; att_monthly and pay_adv_requests are NOT
   * hydrated, so switching off has to clear them by hand or they would linger as
   * the one bit of demo data that outlived the switch. */
  var DEMO_STORES = ['pay_runs', 'pay_slips', 'pay_txns', 'att_monthly', 'pay_adv_requests'];
  /* the seed gates — cleared too, or re-enabling would find them already set and
   * quietly write nothing */
  var GATES = ['pay_history_v2', 'pay_seeded_v3', 'pay_advreq_seeded_v1'];

  function live() { return !!(EPAL.api && EPAL.api.live); }
  function S() { return EPAL.store; }

  /* Default: ON for a demo database (it IS the data there), OFF on a live one —
   * nobody should find generated payroll on their real books because a default
   * said so. */
  function enabled() {
    var v = S().get(FLAG, null);
    return v === null ? !live() : !!v;
  }

  function apply() {
    if (!EPAL.samplePayroll) return null;
    try {
      return EPAL.samplePayroll.write();          // suspends DB writes itself when live
    } catch (e) {
      if (window.console) console.warn('[demo-data] ' + (e.message || e));
      return null;
    }
  }

  /* Called once per boot from App.start(). On a demo database the engines have
   * already seeded, so this is a cheap no-op; on a live one it is what puts the
   * history back after hydration replaced it. */
  function applyIfOn() {
    if (!enabled()) return;
    apply();
  }

  function enable() {
    S().set(FLAG, true);
    GATES.forEach(function (g) { S().set(g, false); });   // let it write again
    return apply();
  }

  /* OFF = forget it. The browser-side stores are emptied and the caller reloads:
   * hydration then refills the hydrated ones from the database, which is the real
   * data, exactly as it always was. Nothing is deleted server-side because
   * nothing was ever written there. */
  function disable() {
    S().set(FLAG, false);
    DEMO_STORES.forEach(function (k) { S().set(k, []); });
    GATES.forEach(function (g) { S().set(g, false); });
  }

  EPAL.demoData = {
    enabled: enabled, enable: enable, disable: disable, applyIfOn: applyIfOn,
    live: live, stores: DEMO_STORES,
    /* what the switch is currently worth, for the settings screen */
    summary: function () {
      var s = S(), ms = (EPAL.samplePayroll && EPAL.samplePayroll.months()) || [];
      return {
        on: enabled(), live: live(),
        months: ms.length, from: ms[0] || '', to: ms[ms.length - 1] || '',
        runs: s.list('pay_runs').length,
        slips: s.list('pay_slips').length,
        txns: s.list('pay_txns').length,
        attendance: s.list('att_monthly').length
      };
    }
  };
})(window.EPAL = window.EPAL || {});
