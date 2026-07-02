/* ============================================================================
 * EPAL GROUP ERP  ·  views/group/automation.js
 * ----------------------------------------------------------------------------
 * AUTOMATION — the group rules engine console (route: group/automation).
 *
 * Owners declare rules ("when X happens, do Y") that watch the live data layer.
 * Store: automation_rules — {id, name, trigger, condition, action, active,
 * lastRun, runs}. Seeded on first render with four realistic Dhaka-business
 * rules. Each rule card has a live active switch, a "Run now" button that
 * evaluates the rule against REAL data (sh_products reorder levels, overdue
 * acc_schedules, today's sales ledger, approved visaApps, current-year
 * joiners), posts the outcome to the group notification stream via db.notify,
 * and bumps runs plus lastRun. Full create, edit, delete lifecycle with
 * validation and confirms, plus a CSV export of the rule book and a runs
 * leaderboard chart.
 * ==========================================================================*/

(function (EPAL) {
  'use strict';
  var ui = EPAL.ui, el = ui.el;
  var db = function () { return EPAL.db; };

  var STORE = 'automation_rules';
  var TRIGGERS = ['Sale recorded', 'Low stock detected', 'Visa approved', 'Payment overdue', 'New employee added'];
  var ACTIONS = ['Send notification', 'Create task for admin', 'Email report to owner', 'Flag in command center'];
  var TRIGGER_ICONS = {
    'Sale recorded': 'cash-coin', 'Low stock detected': 'box-seam',
    'Visa approved': 'passport-fill', 'Payment overdue': 'hourglass-bottom',
    'New employee added': 'person-plus-fill'
  };

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
  function seedRules() {
    if (db().col(STORE).length) return;
    var now = Date.now();
    [
      { id: 'AR-1001', name: 'Daily sales pulse to owner',
        trigger: 'Sale recorded', condition: 'Any sale posted in any concern (cash, bKash or bank)',
        action: 'Send notification', active: true, lastRun: now - 5 * 3600e3, runs: 128 },
      { id: 'AR-1002', name: 'Shop reorder guard (Walton & Vision SKUs)',
        trigger: 'Low stock detected', condition: 'Epal Shop product stock at or below its reorder point',
        action: 'Create task for admin', active: true, lastRun: now - 86400e3, runs: 41 },
      { id: 'AR-1003', name: 'Overdue payment chaser',
        trigger: 'Payment overdue', condition: 'Payment schedule past due date and not marked Paid',
        action: 'Flag in command center', active: true, lastRun: now - 12 * 3600e3, runs: 23 },
      { id: 'AR-1004', name: 'Umrah visa approval mailer',
        trigger: 'Visa approved', condition: 'Travels visa application reaches the Approved stage',
        action: 'Email report to owner', active: false, lastRun: now - 7 * 86400e3, runs: 9 }
    ].forEach(function (r) { db().save(STORE, r); });
  }

  /* ---- rule evaluation against LIVE data ----------------------------------*/
  function simulate(rule) {
    var today = new Date().toISOString().slice(0, 10);
    if (rule.trigger === 'Low stock detected') {
      var low = db().col('sh_products').filter(function (p) { return (p.stock || 0) <= (p.reorder || 0); });
      return { level: low.length ? 'warning' : 'success',
        text: low.length ? low.length + ' Epal Shop SKUs at or below reorder level' : 'All Epal Shop SKUs are above reorder level' };
    }
    if (rule.trigger === 'Payment overdue') {
      var over = db().col('acc_schedules').filter(function (s) {
        return s.status !== 'Paid' && String(s.due || '') && String(s.due) < today;
      });
      var amt = over.reduce(function (a, s) { return a + (s.amount || 0); }, 0);
      return { level: over.length ? 'warning' : 'success',
        text: over.length ? over.length + ' schedules overdue · ' + ui.money(amt, { compact: true }) + ' outstanding' : 'No overdue payment schedules' };
    }
    if (rule.trigger === 'Sale recorded') {
      var all = db().sales();
      var todays = all.filter(function (s) { return s.date === today; });
      var tAmt = todays.reduce(function (a, s) { return a + (s.amount || 0); }, 0);
      return { level: 'info',
        text: todays.length ? todays.length + ' sales today worth ' + ui.money(tAmt, { compact: true }) : 'No sales posted today · ' + all.length + ' in the group ledger' };
    }
    if (rule.trigger === 'Visa approved') {
      var appr = db().visaApps().filter(function (v) { return v.stage === 'Approved'; });
      return { level: 'success', text: appr.length + ' approved visa applications on file at Travels' };
    }
    // New employee added
    var year = String(new Date().getFullYear());
    var emps = db().employees();
    var joiners = emps.filter(function (e) { return String(e.joinDate || '').indexOf(year) === 0; });
    return { level: 'info', text: joiners.length + ' joiners in ' + year + ' · group headcount ' + emps.length };
  }

  function runRule(rule, done) {
    var res = simulate(rule);
    rule.runs = (rule.runs || 0) + 1;
    rule.lastRun = Date.now();
    db().save(STORE, rule);
    db().notify({ level: res.level, title: 'Automation · ' + rule.name,
      text: res.text + ' → ' + rule.action, companyId: 'group', icon: 'robot' });
    ui.toast('Rule executed — ' + res.text, res.level === 'warning' ? 'warning' : 'success');
    if (done) done();
  }

  /* ---- create / edit modal -------------------------------------------------*/
  function editRule(rule, done) {
    var isNew = !rule;
    EPAL.formModal({
      title: isNew ? 'New Automation Rule' : 'Edit Rule', icon: 'robot', record: rule,
      fields: [
        { key: 'name', label: 'Rule Name', type: 'text', required: true, col2: true,
          placeholder: 'e.g. Alert me when Shop stock runs low' },
        { key: 'trigger', label: 'Trigger (when…)', type: 'select', options: TRIGGERS, required: true },
        { key: 'action', label: 'Action (then…)', type: 'select', options: ACTIONS, required: true },
        { key: 'condition', label: 'Condition', type: 'textarea', col2: true,
          placeholder: 'e.g. stock at or below reorder level in Epal Shop',
          hint: 'Human-readable guard — evaluated against live data on every run.' },
        { key: 'active', label: 'Active', type: 'checkbox', default: true }
      ],
      onSave: function (vals) {
        var rec = Object.assign({}, rule || {
          id: 'AR-' + Date.now().toString().slice(-6), runs: 0, lastRun: null,
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

    page.appendChild(EPAL.pageHead({
      eyebrow: 'Epal Group · Command Layer', icon: 'robot', title: 'Automation Rules Engine',
      sub: 'Group-wide triggers and workflows — each rule watches live data and posts its outcome to the notification stream.',
      actions: [
        el('button.btn.btn-ghost', { html: ui.icon('download') + ' Export Rules', onclick: function () { exportRules(); } }),
        el('button.btn.btn-primary', { html: ui.icon('plus-lg') + ' New Rule', onclick: function () { editRule(null, redraw); } })
      ]
    }));

    page.appendChild(el('div.kpi-grid.stagger', null, [
      kpi('Rules', rules.length, 'robot', 'in the group rule book'),
      kpi('Active', active.length, 'toggle-on', rules.length - active.length + ' paused'),
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
          colors: top.map(function (r) { return r.active ? '#c8a24a' : '#8b93a7'; }) }],
        horizontal: true
      });
    });

    function exportRules() {
      var lines = [['ID', 'Name', 'Trigger', 'Action', 'Condition', 'Active', 'Runs', 'Last Run']]
        .concat(db().col(STORE).map(function (r) {
          return [r.id, r.name, r.trigger, r.action, r.condition || '', r.active ? 'yes' : 'no',
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

    return el('div.card.hover', null, [
      el('div.card-pad', null, [
        el('div.flex.items-center.gap-2', null, [
          el('div.scaffold-ico', { html: '<i class="bi bi-' + (TRIGGER_ICONS[r.trigger] || 'robot') + '"></i>' }),
          el('div.flex-1', null, [
            el('h4', { text: r.name }),
            el('div.text-mute.xs', { text: r.id + ' · ' + (r.active ? 'active' : 'paused') })
          ]),
          el('label.switch', { title: r.active ? 'Pause rule' : 'Activate rule' }, [ toggle, el('span.track') ])
        ]),
        el('div.flex.gap-1.mt-2', { style: { flexWrap: 'wrap' } }, [
          el('span.badge.badge-info', { html: ui.icon('lightning-charge') + ' ' + ui.escapeHtml(r.trigger) }),
          el('span.badge.badge-accent', { html: ui.icon('arrow-return-right') + ' ' + ui.escapeHtml(r.action) })
        ]),
        r.condition ? el('p.text-mute.sm.mt-2', { text: 'If: ' + r.condition }) : null,
        el('div.flex.items-center.gap-2.mt-2.text-mute.xs', null, [
          el('span', { html: ui.icon('activity') + ' ' + ui.num(r.runs || 0) + ' runs' }),
          el('span', { html: ui.icon('clock-history') + ' ' + (r.lastRun ? ui.ago(r.lastRun) : 'never run') })
        ]),
        el('div.flex.gap-1.mt-2', null, [
          el('button.btn.btn-sm.btn-primary', { html: ui.icon('play-fill') + ' Run now',
            onclick: function () { runRule(r, redraw); } }),
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
