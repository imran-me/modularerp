/* ============================================================================
 * EPAL GROUP ERP  ·  assets/js/engines/intel.js
 * ----------------------------------------------------------------------------
 * WHAT: The INTELLIGENCE LAYER (EPAL.intel) — a pure read-model / analytics
 *   service. Every number it returns is COMPUTED on demand from the live data
 *   already in EPAL.db / EPAL.store (sales, employees, tasks, financials,
 *   refunds, vendors, ledger). It derives customer analytics (RFM segments,
 *   lifetime value, top / sleeping / at-risk), a workforce productivity index,
 *   anomaly detection, a per-company risk register, and the narrated MD daily
 *   briefing (headline KPIs, exceptions, per-company table, top collections).
 *
 * DATA IT OWNS (localStorage stores):
 *   intel_config — { id, today:'YYYY-MM-DD', rfmQuintiles:5,
 *                    thresholds:{ sleepingDays, expenseSpikePct, refundAlert,
 *                    marginDropPct } } — an idempotent config MARKER only.
 *                    intel persists NO analytics; it re-derives every call.
 *
 * BUSINESS RULES (the "why" a developer must preserve):
 *   - Read-model only: because it never persists results, it can never drift
 *     out of sync with the source of truth — it re-derives on every call.
 *   - Customers are keyed by the `sales.customer` NAME STRING (no customer id).
 *   - RFM: quintile ranking (1..5) when >=10 customers; falls back to fixed
 *     absolute bands when too few to quintile meaningfully. Recency is INVERTED
 *     (fewer days since last purchase = higher score).
 *   - Segment grid is computed from recency (r) vs a fused freq+monetary (fm).
 *   - Demo clock is frozen at 2026-07-05 so every recency/aging calc is
 *     deterministic across reloads.
 *   - Every EPAL.ledger / EPAL.approvals reference is GUARDED so intel is safe
 *     even if those engines have not booted yet (falls back to schedules etc.).
 *   - The chairman (role 'owner') is excluded from productivity scoring.
 *
 * PUBLIC API (window.EPAL.intel.<x>):
 *   rfm() -> [{name,r,f,m,score,segment,recencyDays,frequency,monetary}]
 *   ltv(name) -> number — predictive lifetime value for one customer.
 *   topCustomers(n) / sleepingCustomers() / atRisk() -> customer arrays.
 *   employeeProductivity() -> [{empId,name,score,completion,hours,onTimePct,…}]
 *   anomalies() -> [{type,severity,companyId,title,detail,route}]
 *   riskRegister(companyId) -> [{area,severity,title,detail}] (max 6).
 *   mdBriefing() -> {date,narrative(html),headline[],exceptions[],perCompany[],
 *                    collections[]} — the executive daily snapshot.
 *
 * ==> LARAVEL / PHP MAPPING: an Analytics/Reporting Service class (or query
 *     objects) — e.g. IntelService with rfm(), mdBriefing() reading via Eloquent
 *     aggregates. Nothing to migrate as a table (intel_config is a config value).
 *     Heavy briefings could be a cached read-model or a scheduled snapshot job.
 *
 * ES5 only (no arrow fns / let / const / template literals / classes). Never
 * write a literal star-slash inside this comment (it would close it).
 * ==========================================================================*/

(function (EPAL) {
  'use strict';

  var ui = EPAL.ui, S = EPAL.store;

  var TODAY = new Date(2026, 6, 5);        // demo "today" = 2026-07-05
  var TODAY_STR = '2026-07-05';
  var CUR_MONTH = '2026-07';               // month-to-date prefix
  var YESTERDAY_STR = '2026-07-04';

  function money(n, opts) { return ui.money(n, opts); }
  function esc(s) { return ui.escapeHtml(s); }

  function daysSince(dateStr) {
    if (!dateStr) return 999;
    var d = new Date(dateStr);
    if (isNaN(d)) return 999;
    return Math.floor((TODAY.getTime() - d.getTime()) / 86400000);
  }

  function round(n) { return Math.round(n); }
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  /* ==========================================================================
   * CUSTOMER ANALYTICS
   * ========================================================================*/

  // Aggregate the group-wide sales ledger by customer name.
  // → [{ name, frequency, monetary, profit, lastDate, recencyDays }]
  function salesAgg() {
    var rows = (EPAL.db && EPAL.db.sales) ? EPAL.db.sales() : S.list('sales');
    var map = {};
    for (var i = 0; i < rows.length; i++) {
      var s = rows[i];
      var name = (s.customer || '').toString().trim();
      if (!name) continue;
      var a = map[name];
      if (!a) { a = map[name] = { name: name, frequency: 0, monetary: 0, profit: 0, lastDate: '' }; }
      var amt = +s.amount || 0;
      var cost = +s.cost || 0;
      a.frequency += 1;
      a.monetary += amt;
      a.profit += (s.profit != null ? +s.profit : (amt - cost));
      if (!a.lastDate || (s.date && s.date > a.lastDate)) a.lastDate = s.date || a.lastDate;
    }
    var out = [];
    Object.keys(map).forEach(function (k) {
      var a = map[k];
      a.recencyDays = daysSince(a.lastDate);
      out.push(a);
    });
    return out;
  }

  // Quintile ranker → { name: 1..5 }. invert=true means a LOW value scores HIGH
  // (used for recency, where fewer days since last purchase is better).
  function scoreMap(rows, valFn, invert) {
    var arr = rows.slice().sort(function (a, b) { return valFn(a) - valFn(b); });
    var n = arr.length, m = {};
    for (var i = 0; i < n; i++) {
      var q = Math.floor(i * 5 / n) + 1;   // 1..5 ascending (lowest value → 1)
      if (q > 5) q = 5;
      m[arr[i].name] = invert ? (6 - q) : q;
    }
    return m;
  }

  // Fixed absolute bands used when there are too few customers to quintile.
  function bandRecency(d) { return d <= 15 ? 5 : d <= 45 ? 4 : d <= 90 ? 3 : d <= 180 ? 2 : 1; }
  function bandFreq(f) { return f >= 8 ? 5 : f >= 5 ? 4 : f >= 3 ? 3 : f >= 2 ? 2 : 1; }
  function bandMon(v) { return v >= 1000000 ? 5 : v >= 500000 ? 4 : v >= 200000 ? 3 : v >= 80000 ? 2 : 1; }

  // Standard RFM segmentation grid over recency (r) and a fused freq+monetary (fm).
  function segmentFor(r, f, m) {
    var fm = Math.round((f + m) / 2);
    if (r >= 4) {
      if (fm >= 4) return 'Champions';
      if (fm >= 3) return 'Loyal';
      if (fm >= 2) return 'Potential Loyalist';
      return 'New';
    }
    if (r === 3) {
      if (fm >= 4) return 'Loyal';
      if (fm >= 2) return 'Potential Loyalist';
      return 'Need Attention';
    }
    if (r === 2) {
      if (fm >= 3) return 'At Risk';
      if (fm >= 2) return 'Hibernating';
      return 'Lost';
    }
    // r <= 1  (long time since last purchase)
    if (fm >= 4) return 'Cant Lose';
    if (fm >= 2) return 'Hibernating';
    return 'Lost';
  }

  function rfm() {
    var rows = salesAgg();
    if (!rows.length) return [];
    var rM, fM, mM;
    if (rows.length < 10) {
      rM = {}; fM = {}; mM = {};
      rows.forEach(function (a) {
        rM[a.name] = bandRecency(a.recencyDays);
        fM[a.name] = bandFreq(a.frequency);
        mM[a.name] = bandMon(a.monetary);
      });
    } else {
      rM = scoreMap(rows, function (a) { return a.recencyDays; }, true);
      fM = scoreMap(rows, function (a) { return a.frequency; }, false);
      mM = scoreMap(rows, function (a) { return a.monetary; }, false);
    }
    return rows.map(function (a) {
      var r = rM[a.name], f = fM[a.name], m = mM[a.name];
      return {
        name: a.name, r: r, f: f, m: m, score: '' + r + f + m,
        segment: segmentFor(r, f, m),
        recencyDays: a.recencyDays, frequency: a.frequency, monetary: a.monetary
      };
    }).sort(function (x, y) { return y.monetary - x.monetary; });
  }

  // Simple predictive lifetime value: realised spend + a recency-weighted
  // projection of continued custom.
  function ltvFor(a) {
    if (!a) return 0;
    var freq = a.frequency, mon = a.monetary;
    var avg = freq ? mon / freq : 0;
    var retain = a.recencyDays < 60 ? 1.5
               : a.recencyDays < 120 ? 1.0
               : a.recencyDays < 240 ? 0.5 : 0.2;
    return round(mon + avg * freq * retain * 0.3);
  }

  function ltv(name) {
    var rows = salesAgg();
    for (var i = 0; i < rows.length; i++) if (rows[i].name === name) return ltvFor(rows[i]);
    return 0;
  }

  function topCustomers(n) {
    n = n || 5;
    var rf = rfm(), agg = salesAgg(), am = {};
    agg.forEach(function (a) { am[a.name] = a; });
    return rf.slice(0, n).map(function (x) {
      return {
        name: x.name, monetary: x.monetary, frequency: x.frequency,
        recencyDays: x.recencyDays, segment: x.segment, score: x.score,
        ltv: ltvFor(am[x.name])
      };
    });
  }

  function sleepingCustomers() {
    return salesAgg().filter(function (a) { return a.recencyDays > 120; })
      .sort(function (a, b) { return b.recencyDays - a.recencyDays; })
      .map(function (a) {
        return { name: a.name, recencyDays: a.recencyDays, monetary: a.monetary,
          frequency: a.frequency, lastDate: a.lastDate };
      });
  }

  function atRisk() {
    var risky = { 'At Risk': 1, 'Cant Lose': 1, 'Hibernating': 1 };
    return rfm().filter(function (x) { return risky[x.segment]; })
      .map(function (x) {
        return { name: x.name, score: x.score, segment: x.segment,
          monetary: x.monetary, recencyDays: x.recencyDays };
      });
  }

  /* ==========================================================================
   * WORKFORCE PRODUCTIVITY
   * ========================================================================*/

  function timesheetHours(name) {
    var ts = S.list('it_timesheets'), h = 0;
    for (var i = 0; i < ts.length; i++) if (ts[i].employee === name) h += (+ts[i].hours || 0);
    return h;
  }

  function taskHours(tasks) {
    var ms = 0;
    for (var i = 0; i < tasks.length; i++) {
      var ph = tasks[i].phases || [];
      for (var j = 0; j < ph.length; j++) ms += (+ph[j].accumMs || 0);
    }
    return ms / 3600000;
  }

  function avgPhasePct(task) {
    var ph = task.phases || [];
    if (!ph.length) return task.status === 'done' ? 100 : 0;
    var t = 0;
    for (var i = 0; i < ph.length; i++) t += (+ph[i].pct || 0);
    return t / ph.length;
  }

  function productivityFromTasks(emp, tasks) {
    var active = tasks.filter(function (t) { return t.status !== 'cancelled'; });
    var total = active.length || 1;
    var doneCount = 0, onTime = 0, compSum = 0;
    active.forEach(function (t) {
      if (t.status === 'done') doneCount += 1;
      compSum += avgPhasePct(t);
      var ok = (t.status === 'done') || (t.due && t.due >= TODAY_STR);
      if (ok) onTime += 1;
    });
    var completion = round(compSum / total);
    var onTimePct = round(onTime / total * 100);
    var ratingPct = (+emp.rating || 0) / 5 * 100;
    var hours = round(taskHours(tasks) + timesheetHours(emp.name));
    var score = clamp(round(completion * 0.4 + onTimePct * 0.3 + ratingPct * 0.3), 0, 100);
    return { empId: emp.id, name: emp.name, companyId: emp.companyId,
      score: score, completion: completion, hours: hours, onTimePct: onTimePct,
      done: doneCount, tasks: active.length };
  }

  function productivityDerived(emp) {
    var at = emp.attendance || { present: 20, absent: 1, late: 1, leave: 0 };
    var days = (at.present || 0) + (at.absent || 0) + (at.late || 0) + (at.leave || 0);
    var attendancePct = days ? (at.present / days) * 100 : 90;
    var punctual = (at.present + at.late) ? (at.present / (at.present + at.late)) * 100 : 95;
    var ratingPct = (+emp.rating || 0) / 5 * 100;
    var tsHours = timesheetHours(emp.name);
    var hours = round(tsHours > 0 ? tsHours : (at.present || 0) * 8);
    var completion = round(ratingPct);
    var onTimePct = round(punctual);
    var score = clamp(round(ratingPct * 0.55 + attendancePct * 0.30 + punctual * 0.15), 0, 100);
    return { empId: emp.id, name: emp.name, companyId: emp.companyId,
      score: score, completion: completion, hours: hours, onTimePct: onTimePct,
      done: 0, tasks: 0 };
  }

  function employeeProductivity() {
    var emps = (EPAL.db && EPAL.db.employees) ? EPAL.db.employees() : S.list('employees');
    var out = [];
    for (var i = 0; i < emps.length; i++) {
      var e = emps[i];
      if (e.role === 'owner') continue;                 // the chairman is not scored
      var tasks = (EPAL.db && EPAL.db.tasksFor) ? EPAL.db.tasksFor(e.id) : S.list('tasks.' + e.id);
      if (tasks && tasks.length) out.push(productivityFromTasks(e, tasks));
      else out.push(productivityDerived(e));
    }
    return out.sort(function (a, b) { return b.score - a.score; });
  }

  /* ==========================================================================
   * ANOMALY DETECTION
   * ========================================================================*/

  function companyName(cid) {
    var c = EPAL.config && EPAL.config.company ? EPAL.config.company(cid) : null;
    return (c && c.name) || cid;
  }

  function financialsFor(cid) {
    var rows = (EPAL.db && EPAL.db.financials) ? EPAL.db.financials() : S.list('financials');
    return rows.filter(function (r) { return r.companyId === cid; })
      .sort(function (a, b) { return a.ym < b.ym ? -1 : 1; });
  }

  function anomalies() {
    var out = [];

    // 1) Negative-margin sales (sold below cost).
    var sales = (EPAL.db && EPAL.db.sales) ? EPAL.db.sales() : S.list('sales');
    var neg = sales.filter(function (s) { return (+s.amount || 0) < (+s.cost || 0); })
      .sort(function (a, b) { return (a.amount - a.cost) - (b.amount - b.cost); });
    for (var i = 0; i < Math.min(neg.length, 3); i++) {
      var s = neg[i];
      out.push({ type: 'negative-margin', severity: 'high', companyId: s.companyId,
        title: 'Negative-margin sale · ' + companyName(s.companyId),
        detail: (s.desc || 'Sale') + ' (' + (s.ref || s.id) + ') sold at ' + money(s.amount) +
          ' against cost ' + money(s.cost) + ' — loss of ' + money((s.cost || 0) - (s.amount || 0)) + '.',
        route: '#/' + s.companyId + '/accounts' });
    }

    // 2) Expense spike vs prior 3-month average (>30%).
    var companies = ['travels', 'woodart', 'it', 'shop', 'construction'];
    companies.forEach(function (cid) {
      var f = financialsFor(cid);
      if (f.length < 4) return;
      var latest = f[f.length - 1];
      var prior = f.slice(f.length - 4, f.length - 1);
      var avg = 0;
      prior.forEach(function (r) { avg += (+r.expense || 0); });
      avg = avg / prior.length;
      if (avg > 0 && latest.expense > avg * 1.3) {
        var pctUp = round((latest.expense - avg) / avg * 100);
        out.push({ type: 'expense-spike', severity: pctUp >= 50 ? 'high' : 'med', companyId: cid,
          title: 'Expense spike · ' + companyName(cid),
          detail: latest.ym + ' expenses ' + money(latest.expense) + ' are up ' + pctUp +
            '% on the prior 3-month average of ' + money(round(avg)) + '.',
          route: '#/' + cid + '/accounts' });
      }
    });

    // 3) Unusually large refunds (> 50k) in the Air Ticketing refund tracker.
    var refunds = (EPAL.db && EPAL.db.airRefunds) ? EPAL.db.airRefunds() : S.list('airRefunds');
    var bigR = refunds.filter(function (r) { return (+r.gross || 0) > 50000; })
      .sort(function (a, b) { return (b.gross || 0) - (a.gross || 0); });
    for (var k = 0; k < Math.min(bigR.length, 2); k++) {
      var r = bigR[k];
      out.push({ type: 'unusual-refund', severity: (+r.gross || 0) > 90000 ? 'high' : 'med',
        companyId: 'travels',
        title: 'Large refund · ' + (r.airline || 'Airline'),
        detail: 'Refund of ' + money(r.gross) + ' (net ' + money(r.netRefund) + ') for ' +
          (r.passenger || 'passenger') + ' — status ' + (r.status || '—') + '.',
        route: '#/travels/air-ticketing' });
    }

    // 4) Parties over their credit limit (vendors, sub-agents).
    var vendors = (EPAL.db && EPAL.db.vendors) ? EPAL.db.vendors() : S.list('vendors');
    vendors.forEach(function (v) {
      if ((+v.balance || 0) > (+v.creditLimit || 0) && (+v.creditLimit || 0) > 0) {
        out.push({ type: 'over-credit-limit', severity: 'med', companyId: 'travels',
          title: 'Over credit limit · ' + v.name,
          detail: 'Outstanding ' + money(v.balance) + ' exceeds the ' + money(v.creditLimit) +
            ' credit limit for ' + v.name + '.',
          route: '#/travels/vendor-agent/vendors' });
      }
    });
    var agents = S.list('tv_agents');
    agents.forEach(function (ag) {
      var limit = (+ag.creditLimit || 200000);          // agents carry an implicit limit
      if ((+ag.balance || 0) > limit) {
        out.push({ type: 'over-credit-limit', severity: 'low', companyId: 'travels',
          title: 'Agent over limit · ' + (ag.name || ag.agency),
          detail: (ag.agency || ag.name) + ' carries ' + money(ag.balance) +
            ' outstanding against a ' + money(limit) + ' limit.',
          route: '#/travels/vendor-agent/agents' });
      }
    });

    // 5) Sharp revenue / margin drop month-over-month (< -15%).
    companies.forEach(function (cid) {
      var mom = (EPAL.db && EPAL.db.momRevenue) ? EPAL.db.momRevenue(cid) : 0;
      if (mom < -15) {
        out.push({ type: 'margin-drop', severity: mom < -30 ? 'high' : 'med', companyId: cid,
          title: 'Revenue drop · ' + companyName(cid),
          detail: companyName(cid) + ' revenue fell ' + Math.abs(mom).toFixed(1) +
            '% month-over-month — investigate pipeline and collections.',
          route: '#/' + cid + '/analytics' });
      }
    });

    var rank = { high: 0, med: 1, low: 2 };
    out.sort(function (a, b) { return (rank[a.severity] || 3) - (rank[b.severity] || 3); });
    return out;
  }

  /* ==========================================================================
   * PER-COMPANY RISK REGISTER
   * ========================================================================*/

  function financeSnap(cid, months) {
    if (EPAL.db && EPAL.db.finance) return EPAL.db.finance(cid, months);
    return { revenue: 0, expense: 0, profit: 0, margin: 0 };
  }

  function arOpenFor(cid) {
    // Prefer the ledger aging; fall back to accounts-receivable schedules.
    if (EPAL.ledger && EPAL.ledger.aging) {
      var rows = EPAL.ledger.aging('AR', { companyId: cid }), t = 0;
      rows.forEach(function (r) { t += (r.current + r.d30 + r.d60 + r.d90); });
      return t;
    }
    var sch = S.list('acc_schedules').filter(function (s) {
      return s.companyId === cid && s.kind === 'Receivable' && s.status !== 'Paid';
    });
    var sum = 0; sch.forEach(function (s) { sum += (+s.amount || 0); });
    return sum;
  }

  function riskRegister(companyId) {
    var out = [];
    var f3 = financeSnap(companyId, 3);
    var mom = (EPAL.db && EPAL.db.momRevenue) ? EPAL.db.momRevenue(companyId) : 0;

    // --- Financial: margin health ---
    if (f3.margin < 15) {
      out.push({ area: 'financial', severity: f3.margin < 8 ? 'high' : 'med',
        title: 'Thin operating margin',
        detail: 'Trailing 3-month margin is ' + f3.margin.toFixed(1) + '% (profit ' +
          money(f3.profit) + ' on ' + money(f3.revenue) + ' revenue).' });
    } else {
      out.push({ area: 'financial', severity: mom < 0 ? 'med' : 'low',
        title: mom < 0 ? 'Revenue softening' : 'Margins within range',
        detail: 'Trailing 3-month margin ' + f3.margin.toFixed(1) + '%, month-over-month revenue ' +
          (mom >= 0 ? '+' : '') + mom.toFixed(1) + '%.' });
    }

    // --- Financial: receivables exposure ---
    var arOpen = arOpenFor(companyId);
    if (arOpen > 0) {
      out.push({ area: 'financial', severity: arOpen > 1500000 ? 'high' : arOpen > 500000 ? 'med' : 'low',
        title: 'Receivables exposure',
        detail: money(arOpen) + ' in open receivables outstanding — monitor collections and DSO.' });
    }

    // --- Operational (company-specific) ---
    if (companyId === 'travels') {
      var files = S.list('tv_files').filter(function (fl) {
        var pending = /Submitted|Decision Pending|Slot Booked/.test(fl.embassyStatus || '');
        return pending && daysSince(fl.submitDate) > 30;
      });
      if (files.length) {
        out.push({ area: 'operational', severity: files.length >= 5 ? 'high' : 'med',
          title: files.length + ' idle visa file' + (files.length === 1 ? '' : 's'),
          detail: files.length + ' embassy file' + (files.length === 1 ? ' has' : 's have') +
            ' been pending a decision for over 30 days — chase the embassies.' });
      }
      var flights = S.list('tv_contract_flights').filter(function (cf) { return cf.status !== 'Departed'; });
      var unsold = 0;
      flights.forEach(function (cf) { unsold += Math.max(0, (+cf.seats || 0) - (+cf.sold || 0)); });
      if (unsold > 0) {
        out.push({ area: 'operational', severity: unsold > 200 ? 'high' : unsold > 80 ? 'med' : 'low',
          title: unsold + ' unsold contract seats',
          detail: unsold + ' seats remain unsold across ' + flights.length +
            ' live contract flights — a perishable, at-risk block-seat commitment.' });
      }
    } else if (companyId === 'shop') {
      var low = S.list('sh_products').filter(function (p) { return (+p.stock || 0) <= (+p.reorder || 0); });
      if (low.length) {
        out.push({ area: 'operational', severity: low.length >= 6 ? 'high' : 'med',
          title: low.length + ' SKUs below reorder level',
          detail: low.length + ' products are at or under their reorder point — stock-out risk on the floor.' });
      }
    } else if (companyId === 'construction') {
      var idle = S.list('cn_equipment').filter(function (e) { return e.status === 'Idle' || e.status === 'Maintenance'; });
      if (idle.length) {
        out.push({ area: 'operational', severity: 'med',
          title: idle.length + ' equipment units idle',
          detail: idle.length + ' machines are idle or under maintenance — sunk rental / depreciation cost.' });
      }
    } else if (companyId === 'woodart') {
      var behind = S.list('wa_projects').filter(function (p) {
        return p.deadline && p.deadline < TODAY_STR && (+p.progress || 0) < 100;
      });
      if (behind.length) {
        out.push({ area: 'operational', severity: behind.length >= 3 ? 'high' : 'med',
          title: behind.length + ' projects past deadline',
          detail: behind.length + ' fit-out project' + (behind.length === 1 ? '' : 's') +
            ' are past their deadline yet incomplete — liquidated-damages exposure.' });
      }
    } else if (companyId === 'it') {
      var pastDue = S.list('it_subscriptions').filter(function (s) { return s.status === 'Past Due'; });
      if (pastDue.length) {
        out.push({ area: 'operational', severity: 'med',
          title: pastDue.length + ' subscriptions past due',
          detail: pastDue.length + ' recurring subscription' + (pastDue.length === 1 ? '' : 's') +
            ' are past due — churn and cash-flow risk on MRR.' });
      }
    }

    // --- HR: on-leave headcount ---
    var emps = (EPAL.db && EPAL.db.employees) ? EPAL.db.employees({ companyId: companyId }) : [];
    var onLeave = emps.filter(function (e) { return e.status === 'on-leave'; });
    if (onLeave.length) {
      out.push({ area: 'hr', severity: onLeave.length >= 3 ? 'med' : 'low',
        title: onLeave.length + ' staff on leave',
        detail: onLeave.length + ' of ' + emps.length + ' team members are currently on leave — cover critical roles.' });
    } else if (emps.length) {
      out.push({ area: 'hr', severity: 'low',
        title: 'Full attendance',
        detail: 'All ' + emps.length + ' team members are active — no leave gaps to cover.' });
    }

    return out.slice(0, 6);
  }

  /* ==========================================================================
   * MD BRIEFING  (executive daily snapshot)
   * ========================================================================*/

  function bankSum(cid) {
    var banks = S.list('banks');
    var t = 0;
    for (var i = 0; i < banks.length; i++) {
      if (cid && banks[i].companyId !== cid) continue;
      t += (+banks[i].balance || 0);
    }
    return t;
  }

  function collections() {
    if (EPAL.ledger && EPAL.ledger.aging) {
      var rows = EPAL.ledger.aging('AR');
      return rows.slice(0, 5).map(function (r) {
        var days = r.d90 > 0 ? 90 : r.d60 > 0 ? 60 : r.d30 > 0 ? 30 : 0;
        return { party: r.party, amount: r.total, days: days };
      });
    }
    var sch = S.list('acc_schedules').filter(function (s) {
      return s.kind === 'Receivable' && s.status !== 'Paid';
    }).sort(function (a, b) { return (+b.amount || 0) - (+a.amount || 0); });
    return sch.slice(0, 5).map(function (s) {
      var d = daysSince(s.due);
      return { party: s.party, amount: +s.amount || 0, days: d > 0 ? d : 0 };
    });
  }

  function mdBriefing() {
    var sales = (EPAL.db && EPAL.db.sales) ? EPAL.db.sales() : S.list('sales');
    var mtd = 0, yest = 0;
    sales.forEach(function (s) {
      if (s.date && s.date.indexOf(CUR_MONTH) === 0) mtd += (+s.amount || 0);
      if (s.date === YESTERDAY_STR) yest += (+s.amount || 0);
    });

    var snap = (EPAL.db && EPAL.db.groupSnapshot) ? EPAL.db.groupSnapshot() : { companies: [], profit: 0, revenue: 0 };
    var groupMom = (EPAL.db && EPAL.db.momRevenue) ? EPAL.db.momRevenue() : 0;

    // Group profit for the latest month (from the monthly series).
    var series = (EPAL.db && EPAL.db.series) ? EPAL.db.series() : { profit: [] };
    var pn = series.profit.length;
    var lastMonthProfit = pn ? series.profit[pn - 1] : snap.profit;
    var prevMonthProfit = pn > 1 ? series.profit[pn - 2] : 0;
    var profitDelta = prevMonthProfit ? ((lastMonthProfit - prevMonthProfit) / Math.abs(prevMonthProfit)) * 100 : 0;

    var cash = bankSum(null);
    var arRows = collections();
    var arOverdue = 0;
    if (EPAL.ledger && EPAL.ledger.aging) {
      EPAL.ledger.aging('AR').forEach(function (r) { arOverdue += (r.d30 + r.d60 + r.d90); });
    } else {
      arRows.forEach(function (r) { if (r.days > 0) arOverdue += r.amount; });
    }
    var topParty = arRows[0] || null;
    var atRiskList = atRisk();
    var anomalyList = anomalies();

    function dir(v) { return v >= 0 ? 'up' : 'down'; }

    var headline = [
      { label: 'Sales MTD', value: money(mtd), delta: (groupMom >= 0 ? '+' : '') + groupMom.toFixed(1) + '%', dir: dir(groupMom) },
      { label: 'Cash Position', value: money(cash), delta: bankSum ? '' : '', dir: 'up' },
      { label: 'AR Overdue', value: money(arOverdue), delta: topParty ? esc(topParty.party) : '', dir: 'down' },
      { label: 'Group Profit (mo)', value: money(lastMonthProfit), delta: (profitDelta >= 0 ? '+' : '') + profitDelta.toFixed(1) + '%', dir: dir(profitDelta) }
    ];

    // Exceptions = anomalies + pending approvals (guarded).
    var exceptions = anomalyList.map(function (a) {
      return { severity: a.severity, title: a.title, detail: a.detail, route: a.route };
    });
    if (EPAL.approvals && EPAL.approvals.pending) {
      var pend = EPAL.approvals.pending();
      pend.forEach(function (p) {
        exceptions.push({
          severity: (+p.amount || 0) > 500000 ? 'high' : 'med',
          title: 'Approval pending · ' + (p.title || p.docType),
          detail: 'Raised by ' + (p.makerName || p.maker || 'staff') + ' — awaiting ' +
            ((p.levels && p.levels[p.level - 1]) || 'sign-off') + '.',
          route: '#/group/approvals'
        });
      });
    }
    var exRank = { high: 0, med: 1, low: 2 };
    exceptions.sort(function (a, b) { return (exRank[a.severity] || 3) - (exRank[b.severity] || 3); });
    exceptions = exceptions.slice(0, 8);

    // Per-company table.
    var perCompany = (snap.companies || []).map(function (c) {
      return {
        id: c.id, name: c.name,
        sales: financeSnap(c.id, 3).revenue,
        mtd: financeSnap(c.id, 1).revenue,
        cash: bankSum(c.id),
        arOverdue: arOpenFor(c.id)
      };
    });

    // Narrative HTML referencing real figures.
    var narrative =
      '<p>Good morning. As of <strong>' + esc(TODAY_STR) + '</strong>, the group has booked ' +
      '<strong>' + money(mtd) + '</strong> in month-to-date sales' +
      (yest ? ' (<strong>' + money(yest) + '</strong> yesterday)' : '') + '. ' +
      'Consolidated profit for the latest month is <strong>' + money(lastMonthProfit) + '</strong>, ' +
      (profitDelta >= 0 ? 'up' : 'down') + ' <strong>' + Math.abs(profitDelta).toFixed(1) + '%</strong> ' +
      'versus the prior month.</p>' +
      '<p>Cash on hand across the group stands at <strong>' + money(cash) + '</strong>. ' +
      'Overdue receivables total <strong>' + money(arOverdue) + '</strong>' +
      (topParty ? ', led by <strong>' + esc(topParty.party) + '</strong> at ' + money(topParty.amount) : '') + '. ' +
      '<strong>' + atRiskList.length + '</strong> customer' + (atRiskList.length === 1 ? ' is' : 's are') +
      ' flagged at-risk, and <strong>' + exceptions.length + '</strong> exception' +
      (exceptions.length === 1 ? '' : 's') + ' need your attention today.</p>';

    return {
      date: TODAY_STR,
      narrative: narrative,
      headline: headline,
      exceptions: exceptions,
      perCompany: perCompany,
      collections: arRows
    };
  }

  /* ==========================================================================
   * PUBLIC API
   * ========================================================================*/
  EPAL.intel = {
    rfm: rfm,
    ltv: ltv,
    topCustomers: topCustomers,
    sleepingCustomers: sleepingCustomers,
    atRisk: atRisk,
    employeeProductivity: employeeProductivity,
    anomalies: anomalies,
    riskRegister: riskRegister,
    mdBriefing: mdBriefing
  };

  /* ==========================================================================
   * ENGINE REGISTRATION
   * ========================================================================*/
  EPAL.registerEngine({
    name: 'intel',
    seed: function () {
      // No data store — intel computes on demand. Stamp an idempotent config
      // marker so the engine participates in the seed lifecycle cleanly and the
      // marker survives db.reset() via seedOnce.
      EPAL.store.seedOnce('intel_config', {
        id: 'AL-01', today: TODAY_STR, rfmQuintiles: 5,
        thresholds: { sleepingDays: 120, expenseSpikePct: 30, refundAlert: 50000, marginDropPct: 15 }
      });
    },
    boot: function () {
      // Nothing to wire at boot — every computation is lazy and pulls live data
      // from EPAL.db / EPAL.store at call time.
    }
  });

})(window.EPAL = window.EPAL || {});
