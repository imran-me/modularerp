/* ============================================================================
 * EPAL GROUP ERP · tools/demo/payroll-backfill.js
 * ----------------------------------------------------------------------------
 * PAYROLL HISTORY, JANUARY → LAST MONTH (owner 2026-07-29: "I have wanted datas
 * from january 2026 to now, realistic datas, logical, in every where of
 * payroll").
 *
 * The live database has the staff directory and exactly ONE payroll month — the
 * current one, still a draft. So every payroll screen that reads history is
 * empty by construction: no runs, no payslips, no payments, no advances, no
 * loans, no ledger. This builds the missing months.
 *
 * WHAT IT DOES *NOT* DO: invent rows in tables. Every record is produced by
 * calling the payroll ENGINE's own operations — generate ▸ attendance ▸
 * adjust ▸ finalize ▸ pay, plus advance / loan / bonus — so the data obeys
 * every posting rule the app enforces on a human:
 *   · payslips compute from each employee's REAL salary and the company's own
 *     salary structure (working days, tax, PF, late/absence rules);
 *   · finalizing accrues to the GENERAL LEDGER, dated to its own month, so
 *     Payroll ↔ Ledger reconciles instead of showing a variance;
 *   · paying recovers outstanding advances and loan EMIs automatically, exactly
 *     as it would if someone clicked Pay;
 *   · every figure is derived, never typed — no number in here is a guess about
 *     what an employee earns.
 *
 * DETERMINISTIC. Attendance, overtime and fines come from a hash of
 * (employee id + month), not Math.random(), so a second run produces the same
 * history rather than a different one, and months already present are skipped.
 *
 * PACED. In API mode every store write is its own POST (api.js wireWrites), and
 * the host runs at a load average around 50. The script therefore awaits a gap
 * between operations instead of firing ~250 requests at once, which the server
 * would refuse — and a refused write rolls the row back.
 *
 * USAGE — paste this whole file into the browser console on the live site while
 * signed in, then:
 *
 *   await EPAL.payrollBackfill({ dryRun: true })    // print the plan, write nothing
 *   await EPAL.payrollBackfill()                    // build it
 *   await EPAL.payrollBackfill({ undo: true })      // remove what it built
 *
 * Options: { from:'2026-01', to:'2026-06', companies:['travels'], gap:120,
 *            dryRun:false, undo:false }
 * `to` defaults to LAST month — the current month is left alone, because it is
 * the month the owner is actually working in.
 * ==========================================================================*/

(function (EPAL) {
  'use strict';

  function PR() { return EPAL.payroll; }
  function S() { return EPAL.store; }
  function db() { return EPAL.db; }

  /* ---- deterministic pseudo-random: same seed → same history ------------- */
  function hash(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0) / 4294967295;
  }
  function pick(seed, lo, hi) { return lo + Math.floor(hash(seed) * (hi - lo + 1)); }

  function ymAdd(ym, n) {
    var p = String(ym).split('-'), y = +p[0], m = +p[1] + n;
    y += Math.floor((m - 1) / 12); m = ((m - 1) % 12 + 12) % 12 + 1;
    return y + '-' + String(m).padStart(2, '0');
  }
  function ymList(from, to) {
    var out = [], cur = from, guard = 0;
    while (cur <= to && guard++ < 240) { out.push(cur); cur = ymAdd(cur, 1); }
    return out;
  }
  function d(ym, day) { return ym + '-' + String(day).padStart(2, '0'); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function money(n) { return '৳' + Math.round(n).toLocaleString('en-IN'); }

  /* ---- the shape of a Bangladeshi payroll year --------------------------
   * Ramadan ran 18 Feb – 19 Mar 2026, so Eid-ul-Fitr falls in MARCH and
   * Eid-ul-Adha in MAY. Festival bonus is paid with those months' salary, at
   * one BASIC — the customary figure here, and taken from the slip's own
   * computed basic rather than a number chosen by this script. */
  var FESTIVAL = { '2026-03': 'Eid-ul-Fitr bonus', '2026-05': 'Eid-ul-Adha bonus' };

  /* who gets what, decided by position in the team list so it is stable:
   *   idx 0 — the senior: a staff loan, repaid by EMI
   *   idx 1 — an approved advance, recovered from the next salary
   *   idx 2 — an advance REQUEST that was turned down (the decision trail)
   *   idx 3 — a small advance still outstanding
   * Everyone else simply gets paid, which is what most months look like. */

  function plan(cid, months) {
    var team = (db().employees ? db().employees({ companyId: cid }) : [])
      .filter(function (e) { return (e.status || 'active') === 'active'; })
      .slice().sort(function (a, b) { return (a.name || '') < (b.name || '') ? -1 : 1; });
    return { cid: cid, team: team, months: months };
  }

  /* ---- one month, end to end ------------------------------------------- */
  async function buildMonth(p, ym, cfg, log) {
    var P = PR(), cid = p.cid, wd = (P.template(cid).workingDays || 30);

    // 1. the run + a draft slip per employee
    P.generate(cid, ym);
    await sleep(cfg.gap);

    // 2. attendance — the month as it was actually worked
    for (var i = 0; i < p.team.length; i++) {
      var e = p.team[i], seed = e.id + '|' + ym;
      var absent = hash(seed + '|a') < 0.72 ? 0 : pick(seed + '|a2', 1, 2);
      var leave = hash(seed + '|l') < 0.78 ? 0 : pick(seed + '|l2', 1, 2);
      var late = hash(seed + '|t') < 0.45 ? 0 : pick(seed + '|t2', 1, 5);
      var early = hash(seed + '|e') < 0.80 ? 0 : pick(seed + '|e2', 1, 2);
      P.saveAttendance(e.id, ym, { present: Math.max(0, wd - absent - leave), absent: absent,
        leave: leave, late: late, earlyLeave: early });
      await sleep(cfg.gap);
    }

    // 3. what made this month different: festival bonus, overtime, the odd fine
    for (var j = 0; j < p.team.length; j++) {
      var emp = p.team[j], s = P.slip(emp.id, ym);
      if (!s) continue;
      var sd = emp.id + '|' + ym, adj = P.slipAdj(s), touched = false;
      if (FESTIVAL[ym]) { adj.bonus = Math.round(s.basic || 0); touched = true; }        // one basic
      if (hash(sd + '|ot') > 0.72) { adj.overtimeHours = pick(sd + '|oth', 4, 16); touched = true; }
      if (hash(sd + '|f') > 0.94) { adj.fineExtra = pick(sd + '|fa', 2, 6) * 100;
        adj.fineExtraNote = 'Late arrival penalty · ' + P.mLabel(ym); touched = true; }
      if (touched) { P.adjustSlip(emp.id, ym, adj); await sleep(cfg.gap); }
    }

    // 4. lock it and accrue to the ledger (dated to this month, not to today)
    P.finalize(cid, ym);
    await sleep(cfg.gap);
    log('  ' + P.mLabel(ym) + ' · ' + p.team.length + ' payslips accrued');
  }

  /* ---- the money events, in the month they happened --------------------- */
  async function moneyEvents(p, ym, cfg, log) {
    var P = PR(), t = p.team;
    if (!t.length) return;
    var bank = 'Bank';

    if (ym === ymAdd(cfg.from, 1) && t[0]) {                    // month 2: the staff loan
      var amt = Math.round((+t[0].salary || 20000) * 1.5 / 1000) * 1000;
      P.loan(t[0].id, amt, { date: d(ym, 10), method: bank, emiMonths: 12,
        memo: 'Staff loan · repaid by monthly EMI' });
      log('  ' + P.mLabel(ym) + ' · staff loan ' + money(amt) + ' → ' + t[0].name + ' (12 EMIs)');
      await sleep(cfg.gap);
    }
    if (ym === ymAdd(cfg.from, 2) && t[1]) {                    // month 3: an approved advance
      var ask = Math.round((+t[1].salary || 20000) * 0.4 / 500) * 500;
      var req = P.requestAdvance(t[1].id, ask, { forYm: ymAdd(ym, 1), reason: 'Family medical expense' });
      await sleep(cfg.gap);
      P.decideAdvance(req.id, 'approved', { amount: ask, date: d(ym, 12), method: bank,
        note: 'Approved in full · recovered from next salary' });
      log('  ' + P.mLabel(ym) + ' · advance ' + money(ask) + ' → ' + t[1].name + ' (approved)');
      await sleep(cfg.gap);
    }
    if (ym === ymAdd(cfg.from, 3) && t[3 % t.length]) {         // month 4: a performance bonus
      var who = t[3 % t.length];
      P.bonus(who.id, 5000, { date: d(ym, 20), method: bank, memo: 'Performance bonus · Q1' });
      log('  ' + P.mLabel(ym) + ' · performance bonus ' + money(5000) + ' → ' + who.name);
      await sleep(cfg.gap);
    }
    if (ym === cfg.to && t[2]) {                                // last month: a refused request
      var r2 = P.requestAdvance(t[2].id, Math.round((+t[2].salary || 20000) * 0.8 / 500) * 500,
        { forYm: ymAdd(ym, 1), reason: 'Personal' });
      await sleep(cfg.gap);
      P.decideAdvance(r2.id, 'rejected', { note: 'An advance is already being recovered this quarter.' });
      log('  ' + P.mLabel(ym) + ' · advance request from ' + t[2].name + ' — turned down');
      await sleep(cfg.gap);
    }
    if (ym === cfg.to && t[3]) {                                // last month: one still outstanding
      P.advance(t[3].id, 5000, { date: d(ym, 18), method: bank, memo: 'Advance salary' });
      log('  ' + P.mLabel(ym) + ' · advance ' + money(5000) + ' → ' + t[3].name + ' (outstanding)');
      await sleep(cfg.gap);
    }
  }

  /* ---- paying the month, in the month AFTER it ------------------------- */
  async function payMonth(p, ym, cfg, log) {
    var P = PR(), next = ymAdd(ym, 1), paid = 0, part = 0;
    // payday: the 6th–9th of the following month, one month late (the 12th)
    var payDay = (ym === ymAdd(cfg.from, 4)) ? 12 : pick(p.cid + ym, 6, 9);
    for (var i = 0; i < p.team.length; i++) {
      var e = p.team[i], s = P.slip(e.id, ym);
      if (!s) continue;
      var payable = P.slipPayable(s), out = payable - (s.paid || 0);
      if (out <= 0) continue;
      // the LAST backfilled month leaves one person part-paid, so the desk has a
      // real outstanding balance to show rather than a perfectly clean book
      var partial = (ym === cfg.to && i === p.team.length - 1);
      var amount = partial ? Math.round(out * 0.6) : null;
      P.pay(e.id, ym, amount, hash(e.id + ym + '|m') > 0.75 ? 'Cash' : 'Bank', { date: d(next, payDay) });
      partial ? part++ : paid++;
      await sleep(cfg.gap);
    }
    log('  ' + P.mLabel(ym) + ' · paid ' + paid + (part ? ' · ' + part + ' part-paid' : '') +
        ' on ' + d(next, payDay));
  }

  /* ---- undo: lift every month this built back out of the books ---------- */
  async function undo(cfg, log) {
    var P = PR();
    for (var c = 0; c < cfg.companies.length; c++) {
      var cid = cfg.companies[c], months = ymList(cfg.from, cfg.to).slice().reverse();
      for (var m = 0; m < months.length; m++) {
        var ym = months[m], run = P.getRun(cid, ym);
        if (!run) continue;
        var slips = P.slipsFor(cid, ym);
        for (var i = 0; i < slips.length; i++) {
          if (slips[i].paid > 0) { P.unpay(slips[i].empId, ym); await sleep(cfg.gap); }
        }
        P.unfinalize(cid, ym);
        await sleep(cfg.gap);
        for (var j = 0; j < slips.length; j++) { S().removeFrom('pay_slips', slips[j].id); await sleep(cfg.gap); }
        S().removeFrom('pay_runs', run.id);
        log('  removed ' + P.mLabel(ym) + ' · ' + cid);
        await sleep(cfg.gap);
      }
    }
    // the money events this script created carry its own memos
    var mine = S().list('pay_txns').filter(function (t) {
      return /Staff loan · repaid by monthly EMI|recovered from next salary|Performance bonus · Q1|^Advance salary$/.test(t.memo || '');
    });
    for (var k = 0; k < mine.length; k++) { S().removeFrom('pay_txns', mine[k].id); await sleep(cfg.gap); }
    log('removed ' + mine.length + ' money events');
  }

  /* ---- the entry point -------------------------------------------------- */
  EPAL.payrollBackfill = async function (opts) {
    opts = opts || {};
    var P = PR();
    if (!P) { console.error('[backfill] the payroll engine is not loaded on this screen'); return; }

    var curYm = P.curYm();
    var cfg = {
      from: opts.from || '2026-01',
      to: opts.to || ymAdd(curYm, -1),          // never touch the month in progress
      gap: opts.gap == null ? 120 : +opts.gap,
      dryRun: !!opts.dryRun,
      companies: opts.companies || null
    };
    if (!cfg.companies) {                        // every company that has staff
      var seen = {};
      (S().list('employees') || []).forEach(function (e) {
        if ((e.status || 'active') === 'active' && e.companyId) seen[e.companyId] = 1;
      });
      cfg.companies = Object.keys(seen);
    }
    var lines = [];
    function log(t) { lines.push(t); try { console.log('[backfill] ' + t); } catch (e) {} }

    if (opts.undo) { log('UNDO ' + cfg.from + ' → ' + cfg.to); await undo(cfg, log); return lines.join('\n'); }

    var months = ymList(cfg.from, cfg.to);
    log('payroll history ' + cfg.from + ' → ' + cfg.to + '  ·  ' + cfg.companies.join(', ') +
        (cfg.dryRun ? '  (DRY RUN — nothing is written)' : ''));

    for (var c = 0; c < cfg.companies.length; c++) {
      var p = plan(cfg.companies[c], months);
      if (!p.team.length) { log(p.cid + ': nobody on the payroll — skipped'); continue; }
      log(p.cid + ': ' + p.team.length + ' on the payroll');
      if (cfg.dryRun) {
        months.forEach(function (ym) {
          var have = P.getRun(p.cid, ym);
          log('  ' + P.mLabel(ym) + (have ? ' — already exists, would skip' : ' — would generate, accrue and pay ' + p.team.length + ' payslips'));
        });
        continue;
      }
      for (var m = 0; m < months.length; m++) {
        var ym = months[m], existing = P.getRun(p.cid, ym);
        if (existing && existing.status !== 'draft') { log('  ' + P.mLabel(ym) + ' — already on the books, skipped'); continue; }
        await moneyEvents(p, ym, cfg, log);      // advances/loans first: they are recovered on pay
        await buildMonth(p, ym, cfg, log);
        await payMonth(p, ym, cfg, log);
      }
    }
    if (!cfg.dryRun) {
      P.autoDue();
      if (EPAL.router && EPAL.router.render) EPAL.router.render();
      log('done — reopen Master Payroll to see it');
    }
    return lines.join('\n');
  };

  try { console.log('[backfill] ready — run: await EPAL.payrollBackfill({ dryRun: true })'); } catch (e) {}
})(window.EPAL = window.EPAL || {});
