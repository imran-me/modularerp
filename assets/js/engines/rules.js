/* ============================================================================
 * EPAL GROUP ERP  ·  assets/js/engines/rules.js
 * ----------------------------------------------------------------------------
 * WHAT: The AUTOMATION ENGINE + SCHEDULER (EPAL.automation) — "when X happens
 *   in the live data, do Y." A set of declarative rules that each watch REAL
 *   data (Shop reorder points, near-due / overdue payment schedules, idle
 *   embassy files, overdue task boards, contract flights about to depart with
 *   unsold seats, vendors/agents past their credit limit, month-end payroll)
 *   and, when a rule matches, fire an ACTION: post a notification, spin up an
 *   admin task, escalate to the MD (red-flag + alert), or mark a recurring
 *   document ready. A background tick() re-runs due rules on an interval.
 *
 * DATA IT OWNS (localStorage stores):
 *   automation_rules — { id, name, trigger:enum, condition, action:enum,
 *       active:bool, schedule:'realtime'|'daily', lastRun:ms|null, runs:int,
 *       lastFired:'YYYY-MM-DD'|null, history:[{at,count,note}], created }
 *       (seeds ~8 rules; this engine OWNS the seed).
 *   automation_meta — { escalatedDay } — dedupe marker so the MD escalation
 *       alert fires at most once per demo-day.
 *
 * BUSINESS RULES (the "why" a developer must preserve):
 *   - This engine OWNS the automation_rules seed; the group/automation.js
 *     console only READS these rows and must NOT re-seed (its seedOnce no-ops
 *     because this engine seeds first).
 *   - Idempotent / deduped firing: isDue() lets each rule fire at most ONCE per
 *     frozen demo-day (lastFired !== today), so a 60s tick never spams.
 *   - Bookkeeping upsert is SILENT (no data:changed) to avoid audit spam every
 *     60 seconds; history is capped at the 10 most recent runs.
 *   - escalate() red-flags overdue tasks but pushes the admin alert only once
 *     per demo-day (automation_meta.escalatedDay guard).
 *   - Demo clock frozen at 2026-07-05 (new Date(2026,6,5)) so every date
 *     comparison is deterministic across reloads.
 *
 * PUBLIC API (window.EPAL.automation.<x>):
 *   triggers -> string[] — supported trigger names.
 *   actions  -> string[] — supported action names.
 *   evaluate(rule) -> { count, matched:[{label,detail,route}] } — query live
 *       data for a rule's trigger (matched capped at 8); no side effects.
 *   runRule(rule) -> evaluation — evaluate, perform action if count>0, then
 *       update runs/lastRun/lastFired/history and audit.
 *   tick() -> void — run every active + due rule (deduped by demo-day).
 *   escalate() -> {overdue,flagged} — red-flag overdue tasks, alert admin once.
 *
 * ==> LARAVEL / PHP MAPPING: automation_rules -> Eloquent model + migration; the
 *     scheduler is a scheduled Artisan command (Kernel schedule, ->everyMinute())
 *     that dispatches per-rule QUEUED jobs; each action maps to a Notification /
 *     job. tick()/escalate() -> the command's handle(). lastFired is the
 *     withoutOverlapping / once-per-day guard.
 *
 * The demo clock is frozen at 2026-07-05 (new Date(2026,6,5)) so every date
 * comparison is deterministic across reloads. All reads/writes go through
 * EPAL.store / EPAL.db; seeds use seedOnce so they survive db.reset().
 * boot(): tick() once (guarded), then setInterval(tick, 60000).
 * ==========================================================================*/

(function (EPAL) {
  'use strict';

  var STORE = 'automation_rules';
  var ADMIN = 'EPL-0001';                 // the owner / super-admin task board
  var DAY = 86400000;

  /* --- frozen demo clock --------------------------------------------------*/
  var DEMO_TODAY = new Date(2026, 6, 5);  // 2026-07-05
  var DEMO_MS = DEMO_TODAY.getTime();
  var DEMO_DAY = '2026-07-05';
  var DEMO_MONTH = '2026-07';

  /* --- date helpers (parse 'YYYY-MM-DD' safely) ---------------------------*/
  function parseDay(s) {
    if (!s) return NaN;
    var str = String(s).slice(0, 10);
    var p = str.split('-');
    if (p.length < 3) { var d = new Date(s); return isNaN(d) ? NaN : d.getTime(); }
    return new Date(+p[0], (+p[1]) - 1, +p[2]).getTime();
  }
  function daysUntil(s) { var t = parseDay(s); return isNaN(t) ? NaN : Math.round((t - DEMO_MS) / DAY); }
  function daysSince(s) { var t = parseDay(s); return isNaN(t) ? NaN : Math.round((DEMO_MS - t) / DAY); }

  function money(n) { return EPAL.ui.money(n); }
  function companyName(cid) {
    var c = EPAL.config && EPAL.config.company ? EPAL.config.company(cid) : null;
    return (c && (c.short || c.name)) || cid || 'Group';
  }

  /* Severity of the alert a rule raises, keyed by trigger. -----------------*/
  var LEVEL = {
    'Sale recorded': 'info',
    'Low stock': 'warning',
    'Visa file idle': 'warning',
    'Payment due': 'warning',
    'Task overdue': 'error',
    'Contract flight deadline': 'warning',
    'Credit limit breached': 'error',
    'Month-end recurring': 'info'
  };

  /* ==========================================================================
   * EVALUATE — query LIVE data for a rule's trigger.
   * Returns { count, matched:[{label, detail, route}] } (matched capped at 8).
   * ========================================================================*/
  function evaluate(rule) {
    var db = EPAL.db, matched = [];

    switch (rule.trigger) {

      case 'Sale recorded': {
        // Sales posted in the current demo month (month-to-date).
        var sales = db.sales().filter(function (s) {
          return String(s.date || '').slice(0, 7) === DEMO_MONTH;
        });
        sales.slice(0, 8).forEach(function (s) {
          matched.push({
            label: (s.customer || s.ref || s.id) + ' · ' + companyName(s.companyId),
            detail: money(s.amount) + (s.desc ? ' — ' + s.desc : ''),
            route: 'group/finance/pnl'
          });
        });
        return { count: sales.length, matched: matched };
      }

      case 'Low stock': {
        var low = db.col('sh_products').filter(function (p) {
          return (p.stock || 0) <= (p.reorder || 0);
        });
        low.slice(0, 8).forEach(function (p) {
          matched.push({
            label: p.name,
            detail: 'Stock ' + (p.stock || 0) + ' ≤ reorder ' + (p.reorder || 0) + ' · ' + (p.brand || ''),
            route: 'shop/inventory/low-stock'
          });
        });
        return { count: low.length, matched: matched };
      }

      case 'Visa file idle': {
        // Embassy files sitting >3 days since submission without a decision.
        var files = db.col('tv_files').filter(function (f) {
          var decided = /Approved|Rejected/.test(f.embassyStatus || '');
          var idle = daysSince(f.submitDate);
          return !decided && !isNaN(idle) && idle > 3;
        });
        files.slice(0, 8).forEach(function (f) {
          matched.push({
            label: f.applicant + ' · ' + f.country,
            detail: 'Idle ' + daysSince(f.submitDate) + ' days · ' + (f.embassyStatus || '—'),
            route: 'travels/file-management/files'
          });
        });
        return { count: files.length, matched: matched };
      }

      case 'Payment due': {
        // Schedules not yet Paid, due within the next 3 days (incl. overdue).
        var due = db.col('acc_schedules').filter(function (s) {
          if (s.status === 'Paid') return false;
          var d = daysUntil(s.due);
          return !isNaN(d) && d <= 3;
        });
        due.slice(0, 8).forEach(function (s) {
          var d = daysUntil(s.due);
          matched.push({
            label: s.party + ' · ' + companyName(s.companyId),
            detail: money(s.amount) + ' · ' + (d < 0 ? Math.abs(d) + ' days overdue' : d === 0 ? 'due today' : 'due in ' + d + ' days'),
            route: (s.companyId || 'group') + '/accounts'
          });
        });
        return { count: due.length, matched: matched };
      }

      case 'Task overdue': {
        var over = overdueTasks();
        over.slice(0, 8).forEach(function (o) {
          matched.push({
            label: o.task.title,
            detail: 'Due ' + o.task.due + ' (' + Math.abs(daysUntil(o.task.due)) + 'd late) · ' + o.empName,
            route: 'group/tasks'
          });
        });
        return { count: over.length, matched: matched };
      }

      case 'Contract flight deadline': {
        // Departs within 10 days AND still has unsold seats.
        var flights = db.col('tv_contract_flights').filter(function (f) {
          var d = daysUntil(f.depDate);
          var unsold = (f.seats || 0) - (f.sold || 0);
          return !isNaN(d) && d >= 0 && d <= 10 && unsold > 0;
        });
        flights.slice(0, 8).forEach(function (f) {
          matched.push({
            label: f.airline + ' ' + (f.flightNo || '') + ' · ' + f.route,
            detail: ((f.seats || 0) - (f.sold || 0)) + ' unsold of ' + f.seats + ' · departs in ' + daysUntil(f.depDate) + ' days',
            route: 'travels/contract-flight/schedule'
          });
        });
        return { count: flights.length, matched: matched };
      }

      case 'Credit limit breached': {
        var hits = [];
        db.vendors().forEach(function (v) {
          if ((v.balance || 0) > (v.creditLimit || 0) && (v.creditLimit || 0) > 0) {
            hits.push({ label: v.name + ' (vendor)',
              detail: 'Balance ' + money(v.balance) + ' over limit ' + money(v.creditLimit),
              route: 'travels/vendor-agent/vendors' });
          }
        });
        var AGENT_LIMIT = 150000;
        db.col('tv_agents').forEach(function (a) {
          if ((a.balance || 0) > AGENT_LIMIT) {
            hits.push({ label: a.name + ' · ' + (a.agency || '') + ' (agent)',
              detail: 'Balance ' + money(a.balance) + ' over limit ' + money(AGENT_LIMIT),
              route: 'travels/vendor-agent/agents' });
          }
        });
        return { count: hits.length, matched: hits.slice(0, 8) };
      }

      case 'Month-end recurring': {
        // Salary-sheet preview: employees grouped by company (document is a view
        // concern — here we just quantify the run).
        var byCo = {};
        db.employees().forEach(function (e) {
          if (e.status && e.status !== 'active' && e.status !== 'on-leave') return;
          var cid = e.companyId || 'group';
          if (!byCo[cid]) byCo[cid] = { n: 0, total: 0 };
          byCo[cid].n += 1; byCo[cid].total += (e.salary || 0);
        });
        var total = 0;
        Object.keys(byCo).forEach(function (cid) {
          total += byCo[cid].n;
          matched.push({ label: companyName(cid) + ' payroll',
            detail: byCo[cid].n + ' staff · ' + money(byCo[cid].total) + ' gross',
            route: 'group/employees/payroll' });
        });
        return { count: total, matched: matched.slice(0, 8) };
      }

      default:
        return { count: 0, matched: [] };
    }
  }

  /* Overdue tasks across every employee's board (due < today, not finished). */
  function overdueTasks() {
    var out = [];
    EPAL.db.employees().forEach(function (e) {
      var tasks = EPAL.db.tasksFor(e.id) || [];
      tasks.forEach(function (t) {
        var st = t.status || '';
        if (st === 'done' || st === 'cancelled') return;
        var d = daysUntil(t.due);
        if (isNaN(d) || d >= 0) return;       // only strictly past-due
        out.push({ empId: e.id, empName: e.name, task: t });
      });
    });
    return out;
  }

  /* ==========================================================================
   * RUN ONE RULE — evaluate, and if it matched, perform its action.
   * ========================================================================*/
  function runRule(rule) {
    if (!rule) return { count: 0, matched: [] };
    var ev = evaluate(rule);

    if (ev.count > 0) {
      performAction(rule, ev);
    }

    // Bookkeeping (silent upsert — no data:changed spam every 60s).
    rule.runs = (rule.runs || 0) + 1;
    rule.lastRun = Date.now();
    rule.lastFired = DEMO_DAY;
    var first = ev.matched && ev.matched[0];
    var note = ev.count > 0
      ? ev.count + ' matched → ' + rule.action + (first ? ' · ' + first.label : '')
      : 'no matches';
    rule.history = ([{ at: Date.now(), count: ev.count, note: note }]).concat(rule.history || []).slice(0, 10);
    EPAL.store.upsert(STORE, rule);

    if (EPAL.audit && EPAL.audit.record) {
      EPAL.audit.record({
        action: 'state', entity: STORE, entityId: rule.id,
        entityLabel: 'Automation Rule · ' + rule.name, companyId: 'group',
        reason: note
      });
    }
    return ev;
  }

  /* Perform the rule's configured action given an evaluation result. --------*/
  function performAction(rule, ev) {
    var level = LEVEL[rule.trigger] || 'info';
    var first = ev.matched && ev.matched[0];
    var text = ev.count + ' ' + (ev.count === 1 ? 'match' : 'matches')
      + (first ? ' · ' + first.detail : '');

    switch (rule.action) {

      case 'Create task for admin':
        EPAL.db.notify({ level: level, title: 'Automation · ' + rule.name,
          text: text + ' → task raised for admin', companyId: 'group', icon: 'robot' });
        EPAL.db.saveTask(ADMIN, {
          id: 'AUTO-' + Date.now().toString(36),
          title: 'Auto: ' + rule.name,
          desc: rule.condition + ' — ' + text,
          status: 'todo', priority: level === 'error' ? 'high' : 'medium',
          due: DEMO_DAY, created: DEMO_DAY, createdBy: 'automation',
          labels: ['automation', rule.trigger], restricted: false, redFlag: false,
          comments: [],
          phases: [{ id: 'p1', name: 'Review & act', pct: 0, accumMs: 0, running: false, startedAt: null, done: false }]
        });
        break;

      case 'Escalate to MD':
        escalate();
        EPAL.db.notify({ level: 'error', title: 'ESCALATION · ' + rule.name,
          text: text + ' → escalated to MD', companyId: 'group', icon: 'exclamation-triangle-fill' });
        break;

      case 'Generate document':
        EPAL.db.notify({ level: level, title: 'Automation · ' + rule.name,
          text: 'Document ready — salary sheet covering ' + ev.count + ' employees', companyId: 'group', icon: 'file-earmark-richtext-fill' });
        break;

      case 'Send notification':
      default:
        EPAL.db.notify({ level: level, title: 'Automation · ' + rule.name,
          text: text, companyId: 'group', icon: 'robot' });
        break;
    }
  }

  /* ==========================================================================
   * ESCALATE — red-flag every overdue task, alert admin once per demo-day.
   * ========================================================================*/
  function escalate() {
    var over = overdueTasks();
    var flagged = 0;
    over.forEach(function (o) {
      if (!o.task.redFlag) {
        o.task.redFlag = true;
        EPAL.db.saveTask(o.empId, o.task);
        flagged += 1;
      }
    });

    // Guard: only push the admin alert once per demo-day (avoid spamming).
    var meta = EPAL.store.get('automation_meta', {}) || {};
    if (over.length > 0 && meta.escalatedDay !== DEMO_DAY) {
      EPAL.db.notify({ level: 'error', title: 'Overdue tasks escalated to MD',
        text: over.length + ' overdue task' + (over.length === 1 ? '' : 's') + ' red-flagged for the MD (' + flagged + ' newly flagged).',
        companyId: 'group', icon: 'flag-fill' });
      meta.escalatedDay = DEMO_DAY;
      EPAL.store.set('automation_meta', meta);
      if (EPAL.audit && EPAL.audit.record) {
        EPAL.audit.record({ action: 'state', entity: 'tasks', entityId: 'overdue',
          entityLabel: 'Overdue task escalation', companyId: 'group',
          reason: over.length + ' tasks escalated to MD' });
      }
    }
    return { overdue: over.length, flagged: flagged };
  }

  /* ==========================================================================
   * TICK — run every active rule that is due (deduped by demo-day).
   * ========================================================================*/
  function isDue(rule) {
    if (!rule || !rule.active) return false;
    // Both realtime and daily rules fire at most once per (frozen) demo-day.
    return rule.lastFired !== DEMO_DAY;
  }

  function tick() {
    var rules = EPAL.store.list(STORE);
    rules.forEach(function (rule) {
      if (!isDue(rule)) return;
      try { runRule(rule); }
      catch (e) { console.error('[automation] rule failed: ' + rule.id, e); }
    });
  }

  /* ==========================================================================
   * PUBLIC SURFACE
   * ========================================================================*/
  EPAL.automation = {
    triggers: ['Sale recorded', 'Low stock', 'Visa file idle',
               'Payment due', 'Task overdue', 'Contract flight deadline',
               'Credit limit breached', 'Month-end recurring'],
    actions: ['Send notification', 'Create task for admin', 'Escalate to MD',
              'Generate document', 'Email report'],
    evaluate: evaluate,
    runRule: runRule,
    tick: tick,
    escalate: escalate
  };

  /* ==========================================================================
   * SEED — the extended rule book (Bangladesh-context, deterministic ids).
   * ========================================================================*/
  function seedRules() {
    return [
      { id: 'AR-01', name: 'Daily sales pulse to owner',
        trigger: 'Sale recorded', condition: 'Any sale posted this month across the group ledger',
        action: 'Send notification', active: true, schedule: 'realtime',
        lastRun: null, runs: 0, lastFired: null, history: [], created: '2026-07-01' },

      { id: 'AR-02', name: 'Shop reorder guard (Walton & Vision SKUs)',
        trigger: 'Low stock', condition: 'Epal Shop product stock at or below its reorder point',
        action: 'Create task for admin', active: true, schedule: 'daily',
        lastRun: null, runs: 0, lastFired: null, history: [], created: '2026-07-01' },

      { id: 'AR-03', name: 'Embassy file idle radar',
        trigger: 'Visa file idle', condition: 'Undecided embassy file sitting >3 days since submission',
        action: 'Send notification', active: true, schedule: 'daily',
        lastRun: null, runs: 0, lastFired: null, history: [], created: '2026-07-01' },

      { id: 'AR-04', name: 'Payment due chaser',
        trigger: 'Payment due', condition: 'Unpaid payable/receivable schedule due within 3 days',
        action: 'Send notification', active: true, schedule: 'daily',
        lastRun: null, runs: 0, lastFired: null, history: [], created: '2026-07-01' },

      { id: 'AR-05', name: 'Overdue task escalation to MD',
        trigger: 'Task overdue', condition: 'Any task past its due date and not yet done',
        action: 'Escalate to MD', active: true, schedule: 'daily',
        lastRun: null, runs: 0, lastFired: null, history: [], created: '2026-07-01' },

      { id: 'AR-06', name: 'Contract flight seat alert',
        trigger: 'Contract flight deadline', condition: 'Charter flight departs within 10 days with unsold seats',
        action: 'Send notification', active: true, schedule: 'daily',
        lastRun: null, runs: 0, lastFired: null, history: [], created: '2026-07-01' },

      { id: 'AR-07', name: 'Vendor credit-limit breach',
        trigger: 'Credit limit breached', condition: 'Vendor or agent balance exceeds its credit limit',
        action: 'Send notification', active: true, schedule: 'daily',
        lastRun: null, runs: 0, lastFired: null, history: [], created: '2026-07-01' },

      { id: 'AR-08', name: 'Month-end payroll sheet',
        trigger: 'Month-end recurring', condition: 'Generate the group salary sheet at month close',
        action: 'Generate document', active: true, schedule: 'daily',
        lastRun: null, runs: 0, lastFired: null, history: [], created: '2026-07-01' }
    ];
  }

  /* ==========================================================================
   * ENGINE REGISTRATION
   * ========================================================================*/
  EPAL.registerEngine({
    name: 'rules',

    seed: function () {
      EPAL.store.seedOnce(STORE, seedRules());
    },

    boot: function () {
      try { tick(); } catch (e) { console.error('[automation] initial tick failed', e); }
      setInterval(function () { EPAL.automation.tick(); }, 60000);
    }
  });

})(window.EPAL = window.EPAL || {});
