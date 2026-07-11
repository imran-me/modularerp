/* ============================================================================
 * EPAL GROUP ERP  ·  companies/travels/modules/automation/view.js
 * ----------------------------------------------------------------------------
 * TRAVELS — AUTOMATION. The unattended operator for Epal Travels: a rules & bots
 * engine, a live Document-Expiry Radar, and a Markup Engine. ONE registered view
 * branches on ctx.subId (pill-tabs). This graduates the module off the generic
 * placeholder into a fully-operational screen.
 *
 *   overview   → what the bots would do RIGHT NOW (live match counts) + activity
 *   rules      → the rule/bot register: trigger → action → schedule, toggle, run
 *   radar      → document-expiry radar over passports & airline contracts
 *   markup     → per-service markup rates + a live net→sell price calculator
 *
 * Bots are bound to REAL data: each rule has a `key` whose matcher counts live
 * items (passports expiring, contracts ending, held tickets, low portal wallets,
 * overdue receivables) so "pending actions" is never fictional. Two small stores
 * (`tv_automation`, `tv_markup`) are seeded idempotently. Never write a literal
 * star-slash inside this comment block.
 * ==> LARAVEL: an AutomationRule model + a scheduler (Laravel Task Scheduling);
 *     each `key` maps to a Job that queries + notifies; markup a config table.
 * ==========================================================================*/

(function (EPAL) {
  'use strict';
  var ui = EPAL.ui, el = ui.el, db = EPAL.db, S = EPAL.store;

  var CID = 'travels';
  var TODAY = new Date(2026, 6, 5);
  var TODAY_STR = '2026-07-05';
  var SERVICES = ['Air Ticketing', 'Visa', 'Package / Umrah', 'Hotel', 'Insurance'];
  var CHANNELS = ['WhatsApp', 'Email', 'SMS', 'Push', 'System'];
  var SCHEDULES = ['On event', 'Hourly', 'Daily 09:00', 'Weekly Mon 09:00'];

  /* ==========================================================================
   * SEED — tv_automation (rules/bots) + tv_markup (rate config). Idempotent.
   * ========================================================================*/
  EPAL.registerEngine({ name: 'travels-automation-seed', seed: function () {
    S.seedOnce('tv_automation', seedRules());
    S.seedOnce('tv_markup', seedMarkup());
  }});

  function seedRules() {
    return [
      { id: 'AUT-01', name: 'Passport Renewal Reminder', key: 'passport', kind: 'Bot', status: 'Active',
        trigger: 'Traveller passport expires within 6 months', action: 'WhatsApp + Email a renewal & re-booking offer',
        schedule: 'Daily 09:00', channel: 'WhatsApp', runs: 146, lastRun: '2026-07-05' },
      { id: 'AUT-02', name: 'Contract Expiry Alert', key: 'contract', kind: 'Bot', status: 'Active',
        trigger: 'Airline / vendor contract expires within 30 days', action: 'Alert operations to renegotiate the block',
        schedule: 'Daily 09:00', channel: 'Email', runs: 62, lastRun: '2026-07-05' },
      { id: 'AUT-03', name: 'Ticketing Deadline (TTL) Bot', key: 'ttl', kind: 'Bot', status: 'Active',
        trigger: 'Held ticket / TTL within 3 days', action: 'Push the desk to issue or release the seat',
        schedule: 'Hourly', channel: 'Push', runs: 512, lastRun: '2026-07-05' },
      { id: 'AUT-04', name: 'Low-Wallet Portal Bot', key: 'wallet', kind: 'Bot', status: 'Active',
        trigger: 'GDS / portal wallet below ৳20,000', action: 'Alert accounts to top up before booking fails',
        schedule: 'Hourly', channel: 'Email', runs: 88, lastRun: '2026-07-05' },
      { id: 'AUT-05', name: 'Overdue Receivable Chaser', key: 'ar', kind: 'Bot', status: 'Active',
        trigger: 'Receivable overdue by 30+ days', action: 'Send a polite payment reminder to the party',
        schedule: 'Weekly Mon 09:00', channel: 'WhatsApp', runs: 24, lastRun: '2026-06-30' },
      { id: 'AUT-06', name: 'Auto-Markup Pricing', key: 'markup', kind: 'Rule', status: 'Active',
        trigger: 'A net fare is entered on a sale', action: 'Apply the service markup + VAT to compute the sell price',
        schedule: 'On event', channel: 'System', runs: 1340, lastRun: '2026-07-05' }
    ];
  }
  function seedMarkup() {
    return [
      { service: 'Air Ticketing', markup: 8, tax: 0, enabled: true },
      { service: 'Visa', markup: 12, tax: 0, enabled: true },
      { service: 'Package / Umrah', markup: 10, tax: 0, enabled: true },
      { service: 'Hotel', markup: 15, tax: 0, enabled: true },
      { service: 'Insurance', markup: 20, tax: 0, enabled: true }
    ];
  }

  /* ==========================================================================
   * LIVE MATCHERS — each rule.key resolves to a real, current item list.
   * ========================================================================*/
  function passports() { return (db.col ? db.col('tv_passports') : S.list('tv_passports')) || []; }
  function contracts() { return S.list('tv_contracts'); }
  function portals() { return S.list('tv_portals'); }
  function airTickets() { return (db.col ? db.col('airTickets') : []) || []; }
  function ttlRows() { return (db.col ? db.col('air_ttl') : []) || []; }

  function daysTo(str) { var d = new Date(str); if (isNaN(d)) return null; return Math.floor((d.getTime() - TODAY.getTime()) / 86400000); }
  function monthsTo(str) { var d = daysTo(str); return d == null ? null : Math.round(d / 30.4); }

  // returns { items:[{label, detail, go}], count } for a rule key
  function matches(key) {
    var items = [];
    if (key === 'passport') {
      passports().forEach(function (p) { var m = monthsTo(p.expiry); if (m != null && m >= 0 && m <= 6) items.push({ label: p.holder, detail: 'passport ' + (p.passportNo || '') + ' expires ' + ui.date(p.expiry), go: 'travels/passport-mgmt/expiry' }); });
    } else if (key === 'contract') {
      contracts().forEach(function (c) { var d = daysTo(c.validTo); if (d != null && d >= 0 && d <= 30) items.push({ label: c.counterparty, detail: c.ref + ' ends ' + ui.date(c.validTo) + ' (' + d + 'd)', go: 'travels/contract-file/contracts' }); });
    } else if (key === 'ttl') {
      airTickets().forEach(function (t) { if (t.status === 'Hold') items.push({ label: t.pnr || t.id, detail: 'held ticket awaiting issue', go: 'travels/air-ticketing/manage-sales' }); });
      ttlRows().forEach(function (r) { var d = daysTo(r.ttl || r.deadline || r.due); if (d != null && d >= 0 && d <= 3 && r.status !== 'Ticketed') items.push({ label: r.pnr || r.id || 'TTL', detail: 'deadline in ' + d + 'd', go: 'travels/air-ticketing/ttl' }); });
    } else if (key === 'wallet') {
      portals().forEach(function (p) { if ((+p.balance || 0) < 20000 && p.type !== 'Settlement' && p.status === 'Connected') items.push({ label: p.name, detail: 'wallet ' + ui.money(p.balance || 0), go: 'travels/vendor-agent/portals' }); });
    } else if (key === 'ar') {
      var L = EPAL.ledger; if (L && L.aging) L.aging('AR', { companyId: CID }).forEach(function (r) { var over = r.d30 + r.d60 + r.d90; if (over > 0) items.push({ label: r.party, detail: ui.money(over) + ' overdue 30d+', go: 'travels/ledgers' }); });
    } else if (key === 'markup') {
      markup().filter(function (m) { return m.enabled; }).forEach(function (m) { items.push({ label: m.service, detail: m.markup + '% markup active', go: 'travels/automation/markup' }); });
    }
    return { items: items, count: items.length };
  }
  function rules() { return S.list('tv_automation'); }
  function markup() { return S.list('tv_markup'); }

  /* ==========================================================================
   * VIEW ENTRY
   * ========================================================================*/
  EPAL.view('travels/automation', {
    render: function (ctx) {
      var sub = ctx.subId || 'overview';
      if (['overview', 'rules', 'radar', 'markup'].indexOf(sub) < 0) sub = 'overview';
      var page = el('div.page');
      var titles = { overview: 'Automation', rules: 'Rules & Bots', radar: 'Document-Expiry Radar', markup: 'Markup Engine' };
      var subs = { overview: 'Doc-expiry radar, markup engine and bots — the unattended operator for Epal Travels.',
        rules: 'Every rule and bot: its trigger, action, schedule and what it would do right now.',
        radar: 'Passports and airline contracts approaching expiry — act before they lapse.',
        markup: 'Per-service markup rates and a live net → sell price calculator.' };
      page.appendChild(EPAL.pageHead({
        eyebrow: sub === 'overview' ? 'Epal Travels' : 'Travels › Automation', icon: 'robot', title: titles[sub], sub: subs[sub],
        actions: [ canCreate() && sub === 'rules' ? el('button.btn.btn-ghost', { html: ui.icon('plus-lg') + ' New Rule', onclick: function () { ruleForm(null); } }) : null ].filter(Boolean)
      }));
      var pills = el('div.pill-tab.mb-3');
      [['overview', 'Overview'], ['rules', 'Rules & Bots'], ['radar', 'Doc-Expiry Radar'], ['markup', 'Markup Engine']].forEach(function (p) {
        pills.appendChild(el('button' + (sub === p[0] ? '.active' : ''), { text: p[1],
          onclick: function () { EPAL.router.navigate('travels/automation' + (p[0] === 'overview' ? '' : '/' + p[0])); } }));
      });
      page.appendChild(pills);
      ({ overview: overview, rules: rulesView, radar: radarView, markup: markupView }[sub])(page);
      ctx.mount.appendChild(page);
    }
  });

  /* ======================================================= OVERVIEW */
  function overview(page) {
    var rs = rules();
    var active = rs.filter(function (r) { return r.status === 'Active'; });
    var pending = active.reduce(function (a, r) { return a + matches(r.key).count; }, 0);
    var docs = radarItems();
    var soon = docs.filter(function (d) { return d.days != null && d.days >= 0 && d.days <= 30; });
    var avgMk = markup().length ? Math.round(markup().reduce(function (a, m) { return a + (+m.markup || 0); }, 0) / markup().length) : 0;

    page.appendChild(el('div.kpi-grid.kpi-compact.stagger', null, [
      kpi('Active Automations', active.length + ' / ' + rs.length, 'robot', 'text-good'),
      kpiDrill('Pending Actions', String(pending), 'lightning-charge', 'travels/automation/rules', 'across active bots'),
      kpiDrill('Docs Expiring ≤30d', String(soon.length), 'calendar-x', 'travels/automation/radar', soon.length ? 'act now' : 'all clear'),
      kpiDrill('Avg Markup', avgMk + '%', 'percent', 'travels/automation/markup')
    ]));

    // what the bots would do right now
    var acts = [];
    active.forEach(function (r) { var mc = matches(r.key); if (mc.count > 0 && r.key !== 'markup') acts.push({ rule: r, mc: mc }); });
    acts.sort(function (a, b) { return b.mc.count - a.mc.count; });
    page.appendChild(el('div.section-label', { text: 'What the bots would do right now' }));
    if (acts.length) {
      page.appendChild(el('div.card', null, [ el('div.card-body', null, acts.map(function (a) {
        return el('div.data-row', { style: { cursor: 'pointer' }, onclick: (function (rl) { return function () { ruleDetail(rl); }; })(a.rule) }, [
          ui.frag('<span class="notif-ico notif-' + (a.rule.channel === 'Push' ? 'warning' : 'info') + '">' + ui.icon('robot') + '</span>'),
          el('div.flex-1', null, [ el('span.strong', { text: a.rule.name + ' ' }), el('span.text-dim', { text: '· would action ' + a.mc.count + ' item' + (a.mc.count === 1 ? '' : 's') + ' via ' + a.rule.channel }) ]),
          el('span.badge.badge-warn', { text: String(a.mc.count) }), ui.frag('<span class="text-mute">' + ui.icon('chevron-right') + '</span>')
        ]);
      })) ]));
    } else {
      page.appendChild(el('div.build-banner.mb-3', null, [ ui.frag(ui.icon('check-circle-fill')), el('div', { html: '<strong>Nothing queued.</strong> Every active bot has a clean queue — no expiries, deadlines or overdue items to chase.' }) ]));
    }

    // recent automation activity (from lastRun + runs)
    page.appendChild(el('div.section-label', { text: 'Automation Log' }));
    var logRows = rs.slice().sort(function (a, b) { return (a.lastRun < b.lastRun) ? 1 : -1; }).map(function (r) { return { name: r.name, channel: r.channel, schedule: r.schedule, runs: r.runs, lastRun: r.lastRun, status: r.status }; });
    var t = EPAL.table({
      columns: [ { key: 'name', label: 'Automation', render: function (r) { return '<span class="strong">' + esc(r.name) + '</span>'; } }, { key: 'channel', label: 'Channel', badge: {} },
        { key: 'schedule', label: 'Schedule' }, { key: 'runs', label: 'Runs', num: true }, { key: 'lastRun', label: 'Last Run', date: true }, { key: 'status', label: 'Status', badge: { Active: 'good', Paused: 'warn' } } ],
      rows: logRows, pageSize: 8, exportName: 'travels-automation-log.csv', empty: { icon: 'robot', title: 'No automations' }
    });
    page.appendChild(el('div.card', null, [ el('div.card-body', null, [ t.el ]) ]));
  }

  /* ======================================================= RULES & BOTS */
  function rulesView(page) {
    var rs = rules();
    var active = rs.filter(function (r) { return r.status === 'Active'; });
    var pending = active.reduce(function (a, r) { return a + (r.key === 'markup' ? 0 : matches(r.key).count); }, 0);
    page.appendChild(el('div.kpi-grid.kpi-compact.stagger', null, [
      kpi('Automations', String(rs.length), 'robot'),
      kpi('Active', String(active.length), 'check2-circle', 'text-good'),
      kpi('Paused', String(rs.length - active.length), 'pause-circle', rs.length - active.length ? 'text-warn' : ''),
      kpi('Pending Actions', String(pending), 'lightning-charge')
    ]));
    var t = EPAL.table({
      columns: [
        { key: 'name', label: 'Automation', render: function (r) { return '<span class="strong">' + esc(r.name) + '</span>'; } },
        { key: 'kind', label: 'Kind', badge: { Bot: 'accent', Rule: 'info' } },
        { key: 'trigger', label: 'Trigger', render: function (r) { return esc(r.trigger); } },
        { key: 'schedule', label: 'Schedule' }, { key: 'channel', label: 'Channel', badge: {} },
        { key: 'matches', label: 'Matches Now', num: true, sortVal: function (r) { return r.key === 'markup' ? 0 : matches(r.key).count; }, render: function (r) { if (r.key === 'markup') return '—'; var c = matches(r.key).count; return '<span class="num ' + (c ? 'text-warn' : 'text-mute') + '">' + c + '</span>'; } },
        { key: 'status', label: 'Status', badge: { Active: 'good', Paused: 'warn' } }
      ],
      rows: rs, searchKeys: ['name', 'trigger', 'action', 'channel'], quickFilter: 'kind', filterPanel: true, filters: [{ key: 'status', label: 'Status' }, { key: 'channel', label: 'Channel' }],
      pageSize: 12, exportName: 'travels-automation-rules.csv', pdfTitle: 'Automation Rules & Bots',
      onRow: function (r) { ruleDetail(r); },
      actions: ui.actions({
        edit: canCreate() ? function (r) { ruleForm(r); } : null,
        del:  canDelete() ? function (r) { ui.confirm({ title: 'Delete "' + r.name + '"?', danger: true, confirmLabel: 'Delete' }).then(function (ok) { if (ok) { S.removeFrom('tv_automation', r.id); ui.toast('Deleted', 'success'); EPAL.router.render(); } }); } : null
      }),
      empty: { icon: 'robot', title: 'No automations yet', hint: 'Create your first rule or bot.' }
    });
    page.appendChild(el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon('robot') + ' Rules & Bots' }), el('span.card-sub', { text: rs.length + ' automations · click to inspect & run' }) ]),
      el('div.card-body', null, [ t.el ])
    ]));
  }
  function ruleDetail(r) {
    var body = el('div');
    var m = ui.modal({ title: r.name, icon: 'robot', size: 'lg', body: body, footer: false });
    render();
    function render() {
      body.innerHTML = '';
      var mc = r.key === 'markup' ? { items: [], count: 0 } : matches(r.key);
      var actions = el('div.flex.gap-1.items-center.flex-wrap', { style: { marginLeft: 'auto' } });
      if (canCreate()) actions.appendChild(el('button.btn.btn-sm.btn-primary', { html: ui.icon('play-fill') + ' Run Now', onclick: function () { runRule(r, mc); render(); } }));
      if (canCreate()) actions.appendChild(el('button.btn.btn-sm.btn-outline', { html: ui.icon(r.status === 'Active' ? 'pause' : 'play') + ' ' + (r.status === 'Active' ? 'Pause' : 'Activate'), onclick: function () { r.status = r.status === 'Active' ? 'Paused' : 'Active'; S.upsert('tv_automation', r); ui.toast(r.name + ' ' + r.status.toLowerCase(), 'success'); render(); EPAL.router.render(); } }));
      if (canCreate()) actions.appendChild(el('button.btn.btn-sm.btn-ghost', { html: ui.icon('pencil') + ' Edit', onclick: function () { m.close(); ruleForm(r); } }));
      body.appendChild(el('div.card', null, [ el('div.card-body', null, [
        el('div.flex.items-center.gap-2.flex-wrap.mb-3', null, [
          ui.frag('<span class="notif-ico notif-' + (r.status === 'Active' ? 'success' : 'warning') + '">' + ui.icon('robot') + '</span>'),
          el('div.flex-1', { style: { minWidth: '180px' } }, [ el('div.fw-700', { style: { fontSize: '17px' }, text: r.name }),
            el('div.flex.items-center.gap-2.flex-wrap', null, [ el('span.badge.badge-' + (r.kind === 'Bot' ? 'accent' : 'info'), { text: r.kind }), el('span.badge.badge-' + (r.status === 'Active' ? 'good' : 'warn'), { text: r.status }), el('span.badge', { text: r.channel }) ]) ]),
          actions
        ]),
        el('div.stat-row', null, [ st2('Schedule', r.schedule), st2('Runs', String(r.runs || 0)), st2('Last Run', r.lastRun ? ui.date(r.lastRun) : '—'), st2('Matches Now', r.key === 'markup' ? '—' : String(mc.count)) ]),
        el('div.data-list.mt-2', null, [ drow('Trigger', r.trigger), drow('Action', r.action) ])
      ]) ]));
      if (mc.count) {
        body.appendChild(el('div.card', null, [ el('div.card-head', null, [ el('h3', { html: ui.icon('list-check') + ' Would action now' }), el('span.card-sub', { text: mc.count + ' items' }) ]),
          el('div.card-body', null, [ el('div', null, mc.items.slice(0, 20).map(function (it) {
            return el('div.data-row', { style: { cursor: it.go ? 'pointer' : 'default' }, onclick: it.go ? function () { m.close(); EPAL.router.navigate(it.go); } : null }, [
              el('div.flex-1', null, [ el('span.strong', { text: it.label + ' ' }), el('span.text-dim', { text: '· ' + it.detail }) ]), it.go ? ui.frag('<span class="text-mute">' + ui.icon('chevron-right') + '</span>') : null ]);
          })) ]) ]));
      } else if (r.key !== 'markup') {
        body.appendChild(el('div.build-banner', null, [ ui.frag(ui.icon('check-circle-fill')), el('div', { html: '<strong>Nothing to do.</strong> This bot has no matching items right now.' }) ]));
      }
    }
  }
  function runRule(r, mc) {
    r.runs = (r.runs || 0) + 1; r.lastRun = TODAY_STR; S.upsert('tv_automation', r);
    var n = mc ? mc.count : 0;
    ui.toast(r.name + ' ran · ' + (n ? ('actioned ' + n + ' item' + (n === 1 ? '' : 's') + ' via ' + r.channel) : 'nothing to action'), 'success');
    EPAL.router.render && EPAL.router.render();
  }
  function ruleForm(r) {
    var isNew = !r;
    EPAL.formModal({
      title: isNew ? 'New Automation' : 'Edit Automation', icon: 'robot', size: 'md', record: r || { kind: 'Bot', status: 'Active', channel: 'Email', schedule: 'Daily 09:00', key: 'custom' },
      fields: [
        { key: 'name', label: 'Name', type: 'text', required: true, col2: true },
        { key: 'kind', label: 'Kind', type: 'select', options: ['Bot', 'Rule'], default: 'Bot' },
        { key: 'channel', label: 'Channel', type: 'select', options: CHANNELS, default: 'Email' },
        { key: 'trigger', label: 'Trigger (when)', type: 'text', required: true, col2: true, placeholder: 'e.g. Invoice overdue by 15 days' },
        { key: 'action', label: 'Action (do)', type: 'text', required: true, col2: true, placeholder: 'e.g. Send a reminder' },
        { key: 'schedule', label: 'Schedule', type: 'select', options: SCHEDULES, default: 'Daily 09:00' },
        { key: 'status', label: 'Status', type: 'select', options: ['Active', 'Paused'], default: 'Active' }
      ],
      saveLabel: isNew ? 'Create' : 'Save',
      onSave: function (val) {
        var rec = r || { id: 'AUT-' + ui.uid('').slice(-4).toUpperCase(), key: 'custom', runs: 0, lastRun: '' };
        rec.name = val.name; rec.kind = val.kind; rec.channel = val.channel; rec.trigger = val.trigger; rec.action = val.action; rec.schedule = val.schedule; rec.status = val.status;
        S.upsert('tv_automation', rec);
        ui.toast('Automation saved', 'success'); EPAL.router.render();
        return true;
      }
    });
  }

  /* ======================================================= DOC-EXPIRY RADAR */
  function radarItems() {
    var out = [];
    passports().forEach(function (p) { var d = daysTo(p.expiry); if (d == null) return; out.push({ item: p.holder, type: 'Passport', ref: p.passportNo || '', expiry: p.expiry, days: d, go: 'travels/passport-mgmt/expiry' }); });
    contracts().forEach(function (c) { var d = daysTo(c.validTo); if (d == null) return; out.push({ item: c.counterparty, type: 'Contract', ref: c.ref || '', expiry: c.validTo, days: d, go: 'travels/contract-file/contracts' }); });
    return out;
  }
  function sevOf(days) { return days < 0 ? 'Expired' : days <= 30 ? '≤30 days' : days <= 90 ? '≤90 days' : 'OK'; }
  function radarView(page) {
    var items = radarItems().sort(function (a, b) { return a.days - b.days; });
    var expired = items.filter(function (i) { return i.days < 0; });
    var d30 = items.filter(function (i) { return i.days >= 0 && i.days <= 30; });
    var d90 = items.filter(function (i) { return i.days > 30 && i.days <= 90; });
    page.appendChild(el('div.kpi-grid.kpi-compact.stagger', null, [
      kpi('Tracked Documents', String(items.length), 'file-earmark-text'),
      kpi('Expired', String(expired.length), 'x-octagon', expired.length ? 'text-bad' : 'text-good'),
      kpi('≤30 days', String(d30.length), 'calendar-x', d30.length ? 'text-warn' : ''),
      kpi('≤90 days', String(d90.length), 'calendar-week')
    ]));
    if (expired.length || d30.length) page.appendChild(el('div.build-banner.mb-3', null, [ ui.frag(ui.icon('exclamation-triangle-fill')),
      el('div', { html: '<strong>' + (expired.length + d30.length) + ' document' + (expired.length + d30.length === 1 ? '' : 's') + ' need attention.</strong> ' + expired.length + ' expired · ' + d30.length + ' expiring within 30 days — renew or renegotiate now.' }) ]));
    var t = EPAL.table({
      columns: [
        { key: 'item', label: 'Holder / Party', render: function (r) { return '<span class="strong">' + esc(r.item) + '</span>'; } },
        { key: 'type', label: 'Type', badge: { Passport: 'info', Contract: 'accent' } },
        { key: 'ref', label: 'Reference' },
        { key: 'expiry', label: 'Expiry', date: true },
        { key: 'days', label: 'Days Left', num: true, sortVal: function (r) { return r.days; }, render: function (r) { return '<span class="num ' + (r.days < 0 ? 'text-bad' : r.days <= 30 ? 'text-warn' : '') + '">' + (r.days < 0 ? Math.abs(r.days) + 'd ago' : r.days + 'd') + '</span>'; } },
        { key: 'sev', label: 'Severity', render: function (r) { var s = sevOf(r.days); var b = s === 'Expired' ? 'bad' : s === '≤30 days' ? 'warn' : s === '≤90 days' ? '' : 'good'; return '<span class="badge badge-' + b + '">' + s + '</span>'; }, sortVal: function (r) { return r.days; } }
      ],
      rows: items, searchKeys: ['item', 'ref', 'type'], quickFilter: 'type', filterPanel: true, dateKey: 'expiry',
      pageSize: 14, exportName: 'travels-expiry-radar.csv', pdfTitle: 'Document-Expiry Radar — Epal Travels',
      onRow: function (r) { EPAL.router.navigate(r.go); },
      empty: { icon: 'calendar-check', title: 'Nothing expiring', hint: 'Passports & contracts approaching expiry will appear here.' }
    });
    page.appendChild(el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon('radar') + ' Expiry Radar' }), el('span.card-sub', { text: 'passports & airline contracts · soonest first' }) ]),
      el('div.card-body', null, [ t.el ])
    ]));
  }

  /* ======================================================= MARKUP ENGINE */
  function markupView(page) {
    var mk = markup();
    var enabled = mk.filter(function (m) { return m.enabled; });
    var avg = enabled.length ? Math.round(enabled.reduce(function (a, m) { return a + (+m.markup || 0); }, 0) / enabled.length) : 0;
    page.appendChild(el('div.kpi-grid.kpi-compact.stagger', null, [
      kpi('Services', String(mk.length), 'diagram-3'),
      kpi('Active Rules', String(enabled.length), 'check2-circle', 'text-good'),
      kpi('Avg Markup', avg + '%', 'percent'),
      kpi('Highest', (mk.slice().sort(function (a, b) { return b.markup - a.markup; })[0] || {}).service || '—', 'trophy')
    ]));

    // live calculator
    var svcSel = el('select.select', { style: { maxWidth: '220px' } });
    mk.forEach(function (m) { svcSel.appendChild(el('option', { value: m.service, text: m.service })); });
    var netInp = el('input.input', { type: 'number', min: '0', placeholder: 'Net fare (৳)', style: { maxWidth: '180px' } });
    var out = el('div.stat-row.mt-3');
    function recalc() {
      var svc = mk.filter(function (m) { return m.service === svcSel.value; })[0] || mk[0] || { markup: 0, tax: 0 };
      var net = +netInp.value || 0;
      var mkAmt = Math.round(net * (svc.markup / 100));
      var taxable = net + mkAmt;
      var taxAmt = Math.round(taxable * ((svc.tax || 0) / 100));
      var sell = taxable + taxAmt;
      out.innerHTML = '';
      [ ['Net Fare', ui.money(net)], ['Markup (' + svc.markup + '%)', ui.money(mkAmt)], ['Tax (' + (svc.tax || 0) + '%)', ui.money(taxAmt)], ['Sell Price', ui.money(sell)], ['Margin', net ? Math.round(mkAmt / sell * 100) + '%' : '—'] ]
        .forEach(function (p) { out.appendChild(st2(p[0], p[1])); });
    }
    svcSel.addEventListener('change', recalc); netInp.addEventListener('input', recalc);
    page.appendChild(el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon('calculator') + ' Live Price Calculator' }) ]),
      el('div.card-body', null, [ el('div.flex.gap-2.items-end.flex-wrap', null, [
        el('div', null, [ el('div.text-mute.sm.mb-1', { text: 'Service' }), svcSel ]),
        el('div', null, [ el('div.text-mute.sm.mb-1', { text: 'Net fare' }), netInp ]) ]), out ])
    ]));

    // rates
    var t = EPAL.table({
      columns: [
        { key: 'service', label: 'Service', render: function (m) { return '<span class="strong">' + esc(m.service) + '</span>'; } },
        { key: 'markup', label: 'Markup %', num: true, render: function (m) { return m.markup + '%'; }, sortVal: function (m) { return m.markup; } },
        { key: 'tax', label: 'Tax / VAT %', num: true, render: function (m) { return (m.tax || 0) + '%'; }, sortVal: function (m) { return m.tax || 0; } },
        { key: 'example', label: 'Net ৳10,000 → Sell', num: true, sortVal: function (m) { return sellOf(m, 10000); }, render: function (m) { return '<span class="num">' + ui.money(sellOf(m, 10000)) + '</span>'; } },
        { key: 'enabled', label: 'Status', render: function (m) { return '<span class="badge badge-' + (m.enabled ? 'good' : 'warn') + '">' + (m.enabled ? 'Active' : 'Off') + '</span>'; }, sortVal: function (m) { return m.enabled ? 1 : 0; } }
      ],
      rows: mk, pageSize: 10, exportName: 'travels-markup.csv', pdfTitle: 'Markup Rates — Epal Travels',
      onRow: canCreate() ? function (m) { markupForm(m); } : null,
      actions: canCreate() ? ui.actions({ edit: function (m) { markupForm(m); } }) : null,
      empty: { icon: 'percent', title: 'No markup rules' }
    });
    page.appendChild(el('div.section-label', { text: 'Markup Rates — click to edit' }));
    page.appendChild(el('div.card', null, [ el('div.card-body', null, [ t.el ]) ]));
    recalc();
  }
  function sellOf(m, net) { var mk = net * ((m.markup || 0) / 100); var taxable = net + mk; return Math.round(taxable + taxable * ((m.tax || 0) / 100)); }
  function markupForm(m) {
    EPAL.formModal({
      title: 'Edit Markup · ' + m.service, icon: 'percent', size: 'sm', record: m,
      fields: [
        { key: 'markup', label: 'Markup %', type: 'number', min: 0, max: 100, required: true },
        { key: 'tax', label: 'Tax / VAT %', type: 'number', min: 0, max: 50, default: 0 },
        { key: 'enabled', label: 'Rule active', type: 'checkbox', col2: true }
      ],
      onSave: function (val) { m.markup = +val.markup || 0; m.tax = +val.tax || 0; m.enabled = !!val.enabled; S.upsert('tv_markup', m); ui.toast('Markup updated', 'success'); EPAL.router.render(); return true; }
    });
  }

  /* ---------------------------------------------------- helpers */
  function canCreate() { return !EPAL.perm || EPAL.perm.can('travels', 'automation', 'create'); }
  function canDelete() { return !EPAL.perm || EPAL.perm.can('travels', 'automation', 'delete'); }
  function esc(s) { return ui.escapeHtml(String(s == null ? '' : s)); }
  function kpi(label, value, icon, tone) {
    return el('div.kpi-card', null, [ el('div.kpi-top', null, [ el('span.kpi-label', { text: label }), el('span.kpi-ico', { html: '<i class="bi bi-' + icon + '"></i>' }) ]),
      el('div.kpi-value' + (tone ? '.' + tone : ''), { text: String(value) }) ]);
  }
  function kpiDrill(label, value, icon, route, foot) {
    return el('div.kpi-card.drill', { onclick: function () { EPAL.router.navigate(route); } }, [
      el('div.kpi-top', null, [ el('span.kpi-label', { text: label }), el('span.kpi-ico', { html: '<i class="bi bi-' + icon + '"></i>' }) ]),
      el('div.kpi-value', { text: String(value) }), foot ? el('div.kpi-foot', null, [ el('span.text-muted', { text: foot }) ]) : null ]);
  }
  function st2(l, v) { return el('div.stat', null, [ el('div.stat-label', { text: l }), el('div.stat-value', { text: v }) ]); }
  function drow(k, v) { return el('div.data-row', null, [ el('div.text-mute.sm.flex-1', { text: k }), el('div.strong', { text: v == null || v === '' ? '—' : String(v) }) ]); }

})(window.EPAL = window.EPAL || {});
