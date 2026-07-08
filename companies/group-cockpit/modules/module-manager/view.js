/* ============================================================================
 * EPAL GROUP ERP  ·  views/admin/module-manager.js
 * ----------------------------------------------------------------------------
 * MODULE CONTROL — the single screen that realises the owner's core vision:
 * "if I add Travels it appears; if I turn it off it disappears — everywhere,
 *  with no code change." And the same for every module and sub-module.
 *
 * It reads/writes the override layer in state.js (EPAL.modules.toggle) and the
 * event bus instantly re-renders the rail, sidebar, command palette and router
 * gates. Two safety guards prevent locking yourself out of this very screen.
 * ==========================================================================*/

(function (EPAL) {
  'use strict';
  var ui = EPAL.ui, el = ui.el, M = EPAL.modules;

  // Nodes that must never be switched off (or you'd lose access to the control).
  var LOCKED = { 'group/dashboard': 1, 'group/module-manager': 1 };

  EPAL.view('group/module-manager', {
    render: function (ctx) {
      if (!EPAL.auth.isAdmin()) { ctx.mount.innerHTML = ''; return; }
      var page = el('div.page');

      page.appendChild(EPAL.pageHead({
        eyebrow: 'Administration', icon: 'toggles2', title: 'Module Control',
        sub: 'Switch entire sister concerns, modules or individual features on and off. Changes apply instantly across the whole system.',
        actions: [
          el('button.btn.btn-ghost', { html: ui.icon('arrow-counterclockwise') + ' Reset to defaults',
            onclick: function () {
              ui.confirm({ title:'Reset all module toggles?', text:'Every company, module and feature returns to its default state.', confirmLabel:'Reset' })
                .then(function (ok) { if (ok) { EPAL.store.set('module-overrides', {}); M.applyOverrides();
                  EPAL.bus.emit('modules:changed', {}); render(); ui.toast('Modules reset to defaults', 'success'); } });
            } })
        ]
      }));

      // Summary tiles
      var summary = el('div.kpi-grid');
      page.appendChild(summary);

      var container = el('div.stagger');
      page.appendChild(container);
      ctx.mount.appendChild(page);

      function render() {
        // ---- summary ----
        var totalMods = 0, onMods = 0, onCos = 0;
        EPAL.config.companies.forEach(function (co) {
          if (co.type === 'company') onCos += M.isEnabled(co.id) ? 1 : 0;
          co.modules.forEach(function (mm) { totalMods++; if (M.isEnabled(co.id) && M.isEnabled(co.id, mm.id)) onMods++; });
        });
        summary.innerHTML = '';
        [['Active Concerns', onCos + ' / 5', 'diagram-3-fill'],
         ['Live Modules', onMods + ' / ' + totalMods, 'grid-3x3-gap-fill'],
         ['Overrides Set', String(Object.keys(M.overrides()).length), 'sliders'],
         ['System Health', 'Optimal', 'heart-pulse-fill']
        ].forEach(function (s) {
          summary.appendChild(el('div.kpi-card', null, [
            el('div.kpi-top', null, [ el('span.kpi-label', { text: s[0] }), el('span.kpi-ico', { html:'<i class="bi bi-' + s[2] + '"></i>' }) ]),
            el('div.kpi-value', { text: s[1] })
          ]));
        });

        // ---- company accordions ----
        container.innerHTML = '';
        EPAL.config.companies.forEach(function (co) {
          container.appendChild(companyCard(co, render));
        });
      }

      render();
    }
  });

  function companyCard(co, refresh) {
    var isGroup = co.type === 'group';
    var coOn = EPAL.modules.isEnabled(co.id);
    var modsOn = co.modules.filter(function (mm) { return EPAL.modules.isEnabled(co.id, mm.id); }).length;

    var card = el('div.card.mb-2', { style:{ '--accent': co.accent } });
    var head = el('div.card-head', { style:{ cursor:'pointer' } }, [
      el('div.flex.items-center.gap-2', null, [
        el('div.co-perf-ico', { style:{ background: co.accent, width:'38px', height:'38px' }, html:'<i class="bi bi-' + co.icon + '"></i>' }),
        el('div', null, [
          el('h3', { text: co.name }),
          el('div.text-mute.xs', { text: (isGroup ? 'Group command layer' : co.tagline) + ' · ' + modsOn + '/' + co.modules.length + ' modules on' })
        ])
      ]),
      el('div.flex.items-center.gap-2', null, [
        el('span.badge' + (coOn ? '.badge-good' : ''), { text: coOn ? 'Enabled' : 'Disabled' }),
        isGroup ? el('span.badge.badge-accent', { text:'Always on' })
                : masterSwitch(co, refresh),
        ui.frag('<span class="nav-caret" style="font-size:13px"><i class="bi bi-chevron-down"></i></span>')
      ])
    ]);
    var body = el('div.card-body', { style:{ display:'none' } });

    // module rows
    co.modules.forEach(function (mm) {
      body.appendChild(moduleRow(co, mm, refresh));
    });

    head.addEventListener('click', function (e) {
      if (e.target.closest('.switch')) return;      // don't toggle accordion when flipping a switch
      var open = body.style.display !== 'none';
      body.style.display = open ? 'none' : 'block';
      head.querySelector('.nav-caret').style.transform = open ? '' : 'rotate(180deg)';
    });
    card.appendChild(head); card.appendChild(body);
    return card;
  }

  function masterSwitch(co, refresh) {
    var on = EPAL.modules.isEnabled(co.id);
    var sw = switchEl(on, function (val) {
      EPAL.modules.toggle(co.id, null, null, val);
      ui.toast(co.short + (val ? ' enabled' : ' disabled') + ' across the system', val ? 'success' : 'warning');
      refresh();
    });
    return sw;
  }

  function moduleRow(co, mm, refresh) {
    var key = co.id + '/' + mm.id;
    var locked = !!LOCKED[key];
    var on = EPAL.modules.isEnabled(co.id, mm.id);
    var subs = mm.subs || [];

    var row = el('div.data-row', null, [
      el('span.nav-ico', { html:'<i class="bi bi-' + mm.icon + '"></i>' }),
      el('div.flex-1', null, [
        el('div.fw-600.sm', null, [ document.createTextNode(mm.label),
          mm.admin ? ui.frag(' <span class="badge" style="font-size:9px">Admin</span>') : null,
          mm.badge ? ui.frag(' <span class="nav-badge">' + mm.badge + '</span>') : null ]),
        subs.length ? el('div.text-mute.xs', { text: subs.filter(function (s) { return EPAL.modules.isEnabled(co.id, mm.id, s.id); }).length + '/' + subs.length + ' features on' }) : null
      ]),
      subs.length ? el('button.btn.btn-sm.btn-ghost', { html: ui.icon('list-nested'), title:'Features',
        onclick: function (e) { var sw = e.target.closest('.data-row').nextSibling; if (sw) sw.style.display = sw.style.display === 'none' ? 'block' : 'none'; } }) : null,
      locked ? el('span.badge.badge-accent', { text:'Locked' })
             : switchEl(on, function (val) { EPAL.modules.toggle(co.id, mm.id, null, val); refresh(); })
    ]);

    if (!subs.length) return row;

    // sub-feature drawer
    var drawer = el('div', { style:{ display:'none', paddingLeft:'34px' } });
    subs.forEach(function (s) {
      var son = EPAL.modules.isEnabled(co.id, mm.id, s.id);
      drawer.appendChild(el('div.data-row', null, [
        el('span.nav-sub-dot'),
        el('div.flex-1.sm', { text: s.label }),
        switchEl(son, function (val) { EPAL.modules.toggle(co.id, mm.id, s.id, val); refresh(); })
      ]));
    });
    var wrap = el('div');
    wrap.appendChild(row); wrap.appendChild(drawer);
    return wrap;
  }

  function switchEl(checked, onChange) {
    var input = el('input', { type:'checkbox' });
    input.checked = checked;
    input.addEventListener('change', function () { onChange(input.checked); });
    return el('label.switch', null, [ input, el('span.track') ]);
  }

})(window.EPAL = window.EPAL || {});
