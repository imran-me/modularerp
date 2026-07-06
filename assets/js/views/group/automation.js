/* ============================================================================
 * EPAL GROUP ERP  ·  views/group/automation.js
 * ----------------------------------------------------------------------------
 * AUTOMATION — the group rules engine console (route: group/automation).
 *
 * Owners declare rules ("when X happens, do Y") that watch the live data layer.
 * This console is now a thin operator surface over the deep core engine
 * EPAL.automation (core/rules.js): that engine OWNS the automation_rules seed
 * (8 rules covering the extended trigger set), performs the real evaluation,
 * fires the actions, keeps run history, escalates overdue tasks, and runs a
 * background scheduler tick() every 60s from boot.
 *
 * The view keeps the full rule lifecycle — create, edit, delete, live on/off
 * switch, CSV export of the rule book, and a runs leaderboard chart — but the
 * intelligence now comes from the engine:
 *   · "Preview" calls EPAL.automation.evaluate(rule) → {count, matched}
 *     and renders each matched item as a clickable row that deep-links to its
 *     owning module route.
 *   · "Run now" calls EPAL.automation.runRule(rule) (which mutates the rule
 *     silently — fires the action, bumps runs/lastRun, appends history) and then
 *     redraws.
 *   · Each card exposes a run-history panel (rule.history) plus lastRun / runs.
 *   · Group actions "Run all now" and "Escalate overdue tasks" drive the engine
 *     globally with a result toast; a "Scheduler active" pill shows the tick.
 * ==========================================================================*/

(function (EPAL) {
  'use strict';
  var ui = EPAL.ui, el = ui.el;
  var db = function () { return EPAL.db; };
  var A = function () { return EPAL.automation || {}; };

  var STORE = 'automation_rules';
  /* Trigger / action vocabularies come from the engine when present, with an
     ES5 fallback that mirrors core/rules.js so the form never breaks. */
  function TRIGGERS() {
    return (A().triggers && A().triggers.slice()) ||
      ['Sale recorded', 'Low stock', 'Visa file idle',
       'Payment due', 'Task overdue', 'Contract flight deadline',
       'Credit limit breached', 'Month-end recurring'];
  }
  function ACTIONS() {
    return (A().actions && A().actions.slice()) ||
      ['Send notification', 'Create task for admin', 'Escalate to MD',
       'Generate document', 'Email report'];
  }
  var TRIGGER_ICONS = {
    'Sale recorded': 'cash-coin',
    'Low stock': 'box-seam',
    'Low stock detected': 'box-seam',
    'Visa approved': 'passport-fill',
    'Visa file idle': 'hourglass-split',
    'Payment due': 'calendar2-check',
    'Payment overdue': 'hourglass-bottom',
    'Task overdue': 'exclamation-octagon-fill',
    'Contract flight deadline': 'airplane-fill',
    'Credit limit breached': 'shield-exclamation',
    'New employee': 'person-plus-fill',
    'New employee added': 'person-plus-fill',
    'Month-end recurring': 'calendar-month'
  };
  function triggerIcon(t) { return TRIGGER_ICONS[t] || 'robot'; }

  /* ---- tiny shared helpers ------------------------------------------------*/
  function kpi(label, value, icon, foot) {
    return el('div.kpi-card', null, [
      el('div.kpi-top', null, [ el('span.kpi-label', { text: label }),
        el('span.kpi-ico', { html: '<i class="bi bi-' + icon + '"></i>' }) ]),
      el('div.kpi-value', { text: String(value) }),
      foot ? el('div.kpi-foot', null, [ el('span.text-muted', { text: foot }) ]) : null
    ]);
  }
  function chartCard(title, icon, canvasId, subLabel, height) {
    return el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon(icon) + ' ' + title }),
        subLabel ? el('span.card-sub', { text: subLabel }) : null ]),
      el('div.card-body', null, [
        el('div', { style: { height: (height || 240) + 'px', position: 'relative' } }, [ el('canvas', { id: canvasId }) ])
      ])
    ]);
  }

  /* ---- LEGACY seed guard --------------------------------------------------
   * The engine (core/rules.js) now OWNS the automation_rules seed and runs
   * first, so this is a no-op the moment any rule exists. Kept only as a
   * belt-and-braces fallback if the engine failed to load. */
  function seedRules() {
    if (db().col(STORE).length) return;
    var now = Date.now();
    [
      { id: 'AR-01', name: 'Daily sales pulse to owner',
        trigger: 'Sale recorded', condition: 'Any sale posted this month across the group ledger',
        action: 'Send notification', active: true, schedule: 'realtime',
        lastRun: now - 5 * 3600e3, runs: 0, lastFired: null, history: [] }
    ].forEach(function (r) { db().save(STORE, r); });
  }

  /* ---- evaluation via the core engine -------------------------------------*/
  function evaluateRule(rule) {
    if (A().evaluate) { try { return A().evaluate(rule); } catch (e) { /* fall through */ } }
    return { count: 0, matched: [] };
  }

  /* Run a single rule through the engine (fires action, mutates silently),
     then redraw so the mutated runs/lastRun/history surface. */
  function runRule(rule, redraw) {
    var ev;
    if (A().runRule) { ev = A().runRule(rule); }
    else { ev = evaluateRule(rule); }
    var n = (ev && ev.count) || 0;
    ui.toast(rule.name + ' — ' + n + ' match' + (n === 1 ? '' : 'es') + ' → ' + rule.action,
      n ? 'success' : 'info');
    if (redraw) redraw();
  }

  /* ---- matched-item row (clickable deep-link) -----------------------------*/
  function matchedRow(m) {
    var row = el('div.list-row.hover', {
      style: { cursor: m.route ? 'pointer' : 'default' },
      title: m.route ? 'Open ' + m.route : ''
    }, [
      el('div.flex-1', null, [
        el('div.sm.fw-600', { text: m.label || '—' }),
        m.detail ? el('div.text-mute.xs', { text: m.detail }) : null
      ]),
      m.route ? el('span.text-mute', { html: ui.icon('box-arrow-up-right') }) : null
    ]);
    if (m.route) {
      row.addEventListener('click', function () { EPAL.router.navigate(m.route); });
    }
    return row;
  }

  /* ---- preview modal (evaluate only, no side effects) ---------------------*/
  function previewRule(rule, redraw) {
    var ev = evaluateRule(rule);
    var body = el('div');
    body.appendChild(el('div.flex.items-center.gap-2.mb-2', null, [
      el('div.scaffold-ico', { html: '<i class="bi bi-' + triggerIcon(rule.trigger) + '"></i>' }),
      el('div.flex-1', null, [
        el('div.fw-600', { text: rule.name }),
        el('div.text-mute.xs', { text: rule.trigger + '  →  ' + rule.action })
      ]),
      el('span.badge' + (ev.count ? '.badge-accent' : '.badge-info'),
        { text: ev.count + ' match' + (ev.count === 1 ? '' : 'es') })
    ]));
    if (rule.condition) body.appendChild(el('p.text-mute.sm.mb-2', { text: 'If: ' + rule.condition }));

    if (!ev.matched || !ev.matched.length) {
      body.appendChild(el('div.empty-state.sm', null, [
        ui.frag(ui.icon('check2-circle')),
        el('p.text-muted', { text: ev.count ? ev.count + ' matches (details capped)' : 'Nothing matches right now — the rule would stay quiet.' })
      ]));
    } else {
      var list = el('div.list');
      ev.matched.forEach(function (m) { list.appendChild(matchedRow(m)); });
      body.appendChild(list);
      body.appendChild(el('p.text-mute.xs.mt-2', { text: 'Click any row to jump to its module. Matched preview is capped at 8 items.' }));
    }

    ui.modal({
      title: 'Preview · ' + rule.name, icon: 'search', size: 'md', body: body,
      actions: [
        { label: 'Close', variant: 'ghost' },
        { label: 'Run now', variant: 'primary', icon: 'play-fill',
          onClick: function () { runRule(rule, redraw); } }
      ]
    });
  }

  /* ---- create / edit modal -------------------------------------------------*/
  function editRule(rule, done) {
    var isNew = !rule;
    EPAL.formModal({
      title: isNew ? 'New Automation Rule' : 'Edit Rule', icon: 'robot', record: rule,
      fields: [
        { key: 'name', label: 'Rule Name', type: 'text', required: true, col2: true,
          placeholder: 'e.g. Alert me when Shop stock runs low' },
        { key: 'trigger', label: 'Trigger (when…)', type: 'select', options: TRIGGERS(), required: true },
        { key: 'action', label: 'Action (then…)', type: 'select', options: ACTIONS(), required: true },
        { key: 'schedule', label: 'Schedule', type: 'select', options: ['realtime', 'daily'], default: 'daily' },
        { key: 'condition', label: 'Condition', type: 'textarea', col2: true,
          placeholder: 'e.g. stock at or below reorder level in Epal Shop',
          hint: 'Human-readable guard — the engine evaluates the trigger against live data on every run.' },
        { key: 'active', label: 'Active', type: 'checkbox', default: true }
      ],
      onSave: function (vals) {
        var rec = Object.assign({}, rule || {
          id: 'AR-' + Date.now().toString().slice(-6), runs: 0, lastRun: null,
          lastFired: null, history: [],
          created: new Date().toISOString().slice(0, 10)
        }, vals);
        db().save(STORE, rec);
        ui.toast(isNew ? 'Rule created' : 'Rule updated', 'success');
        if (done) done();
      }
    });
  }

  /* ==========================================================================
   * VIEW
   * ========================================================================*/
  EPAL.view('group/automation', { render: function (ctx) {
    seedRules();
    var page = el('div.page');
    var rules = db().col(STORE);
    var active = rules.filter(function (r) { return r.active; });
    var totalRuns = rules.reduce(function (a, r) { return a + (r.runs || 0); }, 0);
    var lastAct = rules.reduce(function (a, r) { return Math.max(a, r.lastRun || 0); }, 0);

    function redraw() { EPAL.router.render(); }

    /* --- global engine actions ------------------------------------------*/
    function runAll() {
      var list = db().col(STORE).filter(function (r) { return r.active; });
      if (!list.length) { ui.toast('No active rules to run', 'info'); return; }
      var fired = 0, matches = 0;
      list.forEach(function (r) {
        var ev = A().runRule ? A().runRule(r) : evaluateRule(r);
        if (ev && ev.count > 0) { fired += 1; matches += ev.count; }
      });
      ui.toast('Ran ' + list.length + ' active rules · ' + fired + ' fired · ' + matches + ' total matches', 'success');
      redraw();
    }
    function escalateNow() {
      if (!A().escalate) { ui.toast('Escalation engine unavailable', 'warning'); return; }
      var res = A().escalate() || {};
      var overdue = res.overdue || 0, flagged = res.flagged || 0;
      ui.toast(overdue
        ? overdue + ' overdue task' + (overdue === 1 ? '' : 's') + ' escalated to MD · ' + flagged + ' newly red-flagged'
        : 'No overdue tasks — nothing to escalate', overdue ? 'warning' : 'success');
      redraw();
    }

    page.appendChild(EPAL.pageHead({
      eyebrow: 'Epal Group · Command Layer', icon: 'robot', title: 'Automation Rules Engine',
      sub: 'Group-wide triggers and workflows — each rule watches live data and fires its action through the core scheduler.',
      actions: [
        el('button.btn.btn-ghost', { html: ui.icon('shield-exclamation') + ' Escalate overdue', onclick: function () { escalateNow(); } }),
        el('button.btn.btn-ghost', { html: ui.icon('lightning-charge-fill') + ' Run all now', onclick: function () { runAll(); } }),
        el('button.btn.btn-ghost', { html: ui.icon('download') + ' Export Rules', onclick: function () { exportRules(); } }),
        el('button.btn.btn-primary', { html: ui.icon('plus-lg') + ' New Rule', onclick: function () { editRule(null, redraw); } })
      ]
    }));

    /* --- scheduler indicator --------------------------------------------*/
    var schedulerLive = !!(EPAL.automation && EPAL.automation.tick);
    page.appendChild(el('div.flex.items-center.gap-2.mb-2', { style: { flexWrap: 'wrap' } }, [
      el('span.badge' + (schedulerLive ? '.badge-success' : '.badge-warning'), {
        html: (schedulerLive ? '<span class="rec-dot"></span> ' : ui.icon('exclamation-triangle') + ' ')
          + (schedulerLive ? 'Scheduler active' : 'Scheduler offline')
      }),
      el('span.text-mute.xs', { text: schedulerLive
        ? 'Background tick runs every 60s from boot — due rules fire automatically.'
        : 'The core engine did not load; rules run only on demand.' })
    ]));

    page.appendChild(el('div.kpi-grid.stagger', null, [
      kpi('Rules', rules.length, 'robot', 'in the group rule book'),
      kpi('Active', active.length, 'toggle-on', (rules.length - active.length) + ' paused'),
      kpi('Total Runs', ui.num(totalRuns), 'lightning-charge-fill', 'lifetime executions'),
      kpi('Last Activity', lastAct ? ui.ago(lastAct) : '—', 'clock-history', 'most recent execution')
    ]));

    /* ---- rule cards ------------------------------------------------------*/
    page.appendChild(el('div.section-label', { text: 'Rule Book' }));
    if (!rules.length) {
      page.appendChild(el('div.card', null, [ el('div.empty-state', null, [
        ui.frag(ui.icon('robot')),
        el('h3', { text: 'No automation rules yet' }),
        el('p.text-muted', { text: 'Create your first rule to put the group on autopilot.' }),
        el('button.btn.btn-primary.mt-2', { html: ui.icon('plus-lg') + ' New Rule', onclick: function () { editRule(null, redraw); } })
      ]) ]));
    } else {
      var grid = el('div.grid-auto.stagger');
      rules.forEach(function (r) { grid.appendChild(ruleCard(r, redraw)); });
      page.appendChild(grid);
    }

    /* ---- analytics ------------------------------------------------------*/
    page.appendChild(el('div.section-label', { text: 'Engine Analytics' }));
    var runsId = ui.uid('auto');
    page.appendChild(chartCard('Runs per Rule', 'bar-chart-line', runsId, 'lifetime execution leaderboard', 240));
    ctx.mount.appendChild(page);

    requestAnimationFrame(function () {
      var c = document.getElementById(runsId);
      if (!c || !rules.length) return;
      var top = rules.slice().sort(function (a, b) { return (b.runs || 0) - (a.runs || 0); });
      EPAL.charts.bar(c, {
        labels: top.map(function (r) { return r.name.length > 34 ? r.name.slice(0, 32) + '…' : r.name; }),
        datasets: [{ label: 'Runs', data: top.map(function (r) { return r.runs || 0; }),
          colors: top.map(function (r) { return r.active ? '#2591D9' : '#8b93a7'; }) }],
        horizontal: true
      });
    });

    function exportRules() {
      var lines = [['ID', 'Name', 'Trigger', 'Action', 'Condition', 'Schedule', 'Active', 'Runs', 'Last Run']]
        .concat(db().col(STORE).map(function (r) {
          return [r.id, r.name, r.trigger, r.action, r.condition || '', r.schedule || '', r.active ? 'yes' : 'no',
            r.runs || 0, r.lastRun ? new Date(r.lastRun).toISOString() : ''];
        }));
      var csv = lines.map(function (l) {
        return l.map(function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(',');
      }).join('\n');
      var blob = new Blob([csv], { type: 'text/csv' });
      var a = el('a', { href: URL.createObjectURL(blob), download: 'group-automation-rules.csv' });
      document.body.appendChild(a); a.click(); a.remove();
      ui.toast('Rule book exported', 'success');
    }
  } });

  /* ---- one rule card --------------------------------------------------------*/
  function ruleCard(r, redraw) {
    var toggle = el('input', { type: 'checkbox' });
    toggle.checked = !!r.active;
    toggle.addEventListener('change', function () {
      r.active = toggle.checked;
      db().save(STORE, r);
      ui.toast(r.active ? 'Rule activated' : 'Rule paused', r.active ? 'success' : 'info');
      redraw();
    });

    /* live preview count (evaluate — no side effects) */
    var ev = evaluateRule(r);
    var matchBadge = el('span.badge' + (ev.count ? '.badge-accent' : '.badge-muted'),
      { html: ui.icon('bullseye') + ' ' + ev.count + ' match' + (ev.count === 1 ? '' : 'es') + ' now' });

    /* run-history panel */
    var history = (r.history || []).slice(0, 5);
    var historyBlock;
    if (history.length) {
      historyBlock = el('div.mt-2', null, [
        el('div.text-mute.xs.fw-600', { text: 'Run history' }),
        el('div.list.mt-1', null, history.map(function (h) {
          return el('div.list-row', null, [
            el('div.flex-1', null, [
              el('div.xs', { text: h.note || (h.count + ' matched') }),
              el('div.text-mute.xs', { text: h.at ? ui.ago(h.at) : '' })
            ]),
            el('span.badge.badge-info.xs', { text: (h.count || 0) + '' })
          ]);
        }))
      ]);
    } else {
      historyBlock = el('div.text-mute.xs.mt-2', { text: 'No run history yet — Run now or wait for the scheduler.' });
    }

    return el('div.card.hover', null, [
      el('div.card-pad', null, [
        el('div.flex.items-center.gap-2', null, [
          el('div.scaffold-ico', { html: '<i class="bi bi-' + triggerIcon(r.trigger) + '"></i>' }),
          el('div.flex-1', null, [
            el('h4', { text: r.name }),
            el('div.text-mute.xs', { text: r.id + ' · ' + (r.active ? 'active' : 'paused') + (r.schedule ? ' · ' + r.schedule : '') })
          ]),
          el('label.switch', { title: r.active ? 'Pause rule' : 'Activate rule' }, [ toggle, el('span.track') ])
        ]),
        el('div.flex.gap-1.mt-2', { style: { flexWrap: 'wrap' } }, [
          el('span.badge.badge-info', { html: ui.icon('lightning-charge') + ' ' + ui.escapeHtml(r.trigger) }),
          el('span.badge.badge-accent', { html: ui.icon('arrow-return-right') + ' ' + ui.escapeHtml(r.action) }),
          matchBadge
        ]),
        r.condition ? el('p.text-mute.sm.mt-2', { text: 'If: ' + r.condition }) : null,
        el('div.flex.items-center.gap-2.mt-2.text-mute.xs', { style: { flexWrap: 'wrap' } }, [
          el('span', { html: ui.icon('activity') + ' ' + ui.num(r.runs || 0) + ' runs' }),
          el('span', { html: ui.icon('clock-history') + ' ' + (r.lastRun ? ui.ago(r.lastRun) : 'never run') }),
          r.lastFired ? el('span', { html: ui.icon('calendar-check') + ' fired ' + r.lastFired }) : null
        ]),
        historyBlock,
        el('div.flex.gap-1.mt-2', { style: { flexWrap: 'wrap' } }, [
          el('button.btn.btn-sm.btn-primary', { html: ui.icon('play-fill') + ' Run now',
            onclick: function () { runRule(r, redraw); } }),
          el('button.btn.btn-sm.btn-ghost', { html: ui.icon('search') + ' Preview',
            onclick: function () { previewRule(r, redraw); } }),
          el('button.btn.btn-sm.btn-ghost', { html: ui.icon('pencil') + ' Edit',
            onclick: function () { editRule(r, redraw); } }),
          el('button.btn.btn-sm.btn-ghost', { html: ui.icon('trash') + ' Delete',
            onclick: function () {
              ui.confirm({ title: 'Delete rule "' + r.name + '"?',
                text: 'The rule and its run history will be removed permanently.',
                danger: true, confirmLabel: 'Delete' }).then(function (ok) {
                if (!ok) return;
                db().remove(STORE, r.id);
                ui.toast('Rule deleted', 'success');
                redraw();
              });
            } })
        ])
      ])
    ]);
  }

})(window.EPAL = window.EPAL || {});
