/* ============================================================================
 * EPAL GROUP ERP  ·  views/registry.js
 * ----------------------------------------------------------------------------
 * THE VIEW REGISTRY + the generic PLACEHOLDER SCAFFOLD.
 *
 * `EPAL.views` maps route keys → view objects. Each module view file registers
 * itself here (see views/group/dashboard.js for the pattern). The router looks
 * views up; if none is registered it falls back to `__placeholder__`.
 *
 * The placeholder is NOT a "coming soon" page — it renders a real, navigable
 * module workspace (header, live sub-module cards, contextual stats) so the
 * entire 200+ item navigation is usable from day one, and every module can be
 * "graduated" to a full custom view incrementally without breaking the app.
 *
 * Register a view:   EPAL.view('travels/visa-processing', { render(ctx){...} })
 * ==========================================================================*/

(function (EPAL) {
  'use strict';

  EPAL.views = EPAL.views || {};

  // Registration helper used by every view file.
  EPAL.view = function (key, def) { EPAL.views[key] = def; return def; };

  var ui = EPAL.ui, el = ui.el;

  /* Small reusable page-header builder shared by scaffold + real views ------*/
  EPAL.pageHead = function (opts) {
    var head = el('div.page-head', null, [
      el('div', null, [
        el('h1.page-title', null, [
          opts.eyebrow ? el('span.eyebrow', { text: opts.eyebrow }) : null,
          opts.icon ? ui.frag('<i class="bi bi-' + opts.icon + '"></i>') : null,
          document.createTextNode(opts.title || '')
        ]),
        opts.sub ? el('p.page-sub', { text: opts.sub }) : null
      ]),
      opts.actions ? el('div.page-actions', null, opts.actions) : null
    ]);
    return head;
  };

  /* ==========================================================================
   * PLACEHOLDER SCAFFOLD
   * ========================================================================*/
  EPAL.view('__placeholder__', {
    render: function (ctx) {
      var page = el('div.page.stagger');
      var co = ctx.company, mod = ctx.module, sub = ctx.sub;

      // ---- Sub-module focused scaffold ------------------------------------
      if (sub) {
        page.appendChild(EPAL.pageHead({
          eyebrow: co.name + ' › ' + mod.label,
          title: sub.label, icon: mod.icon,
          sub: sub.desc || ('Manage ' + sub.label.toLowerCase() + ' for ' + co.name + '.'),
          actions: [
            el('a.btn.btn-ghost', { href: '#/' + co.id + '/' + mod.id, html: ui.icon('arrow-left') + ' ' + mod.label }),
            el('button.btn.btn-primary', { html: ui.icon('plus-lg') + ' New ' + sub.label,
              onclick: function () { comingSoon(sub.label); } })
          ]
        }));
        page.appendChild(buildBanner(sub.label));
        page.appendChild(genericWorkspace(sub.label));
        ctx.mount.appendChild(page);
        return;
      }

      // ---- Module scaffold: list its sub-modules as entry cards -----------
      page.appendChild(EPAL.pageHead({
        eyebrow: co.name, title: mod.label, icon: mod.icon, sub: mod.desc,
        actions: [ el('button.btn.btn-primary', { html: ui.icon('plus-lg') + ' New Record',
          onclick: function () { comingSoon(mod.label); } }) ]
      }));
      page.appendChild(buildBanner(mod.label));

      var subs = (mod.subs || []).filter(function (s) { return EPAL.modules.isEnabled(co.id, mod.id, s.id); });
      if (subs.length) {
        page.appendChild(el('div.section-label', { text: mod.label + ' — Sections' }));
        var grid = el('div.scaffold-grid');
        subs.forEach(function (s) {
          grid.appendChild(el('a.scaffold-card', { href: '#/' + co.id + '/' + mod.id + '/' + s.id }, [
            el('div.scaffold-ico', { html: '<i class="bi bi-' + (s.icon === 'dot' ? 'grid-3x3-gap' : s.icon) + '"></i>' }),
            el('div', null, [ el('h4', { text: s.label }),
              el('p', { text: s.desc || ('Open ' + s.label.toLowerCase()) }) ])
          ]));
        });
        page.appendChild(grid);
      } else {
        page.appendChild(genericWorkspace(mod.label));
      }
      ctx.mount.appendChild(page);
    }
  });

  function buildBanner(label) {
    return el('div.build-banner', null, [
      ui.frag(ui.icon('stars')),
      el('div', null, [
        ui.frag('<strong>Live module scaffold.</strong> This ' + ui.escapeHtml(label) +
          ' workspace is wired into the system (routing, permissions, module toggles all active). ' +
          'Full data-entry forms and tables are being built out module-by-module — see the roadmap in the module README.')
      ])
    ]);
  }

  // A generic "workspace" body: a few stat tiles + an empty data table.
  function genericWorkspace(label) {
    var wrap = el('div');
    var stats = el('div.kpi-grid', null, [
      statTile('Records', '—', 'database', 'Total in this module'),
      statTile('This Month', '—', 'calendar3', 'New entries'),
      statTile('Pending', '—', 'hourglass-split', 'Awaiting action'),
      statTile('Value', '—', 'cash-coin', 'Associated amount')
    ]);
    wrap.appendChild(stats);
    var card = el('div.card');
    card.appendChild(el('div.card-head', null, [
      el('h3', { html: ui.icon('table') + ' ' + ui.escapeHtml(label) }),
      el('div.flex.gap-1', null, [
        el('button.btn.btn-sm.btn-ghost', { html: ui.icon('funnel') + ' Filter', onclick: function () { comingSoon(label); } }),
        el('button.btn.btn-sm.btn-ghost', { html: ui.icon('download') + ' Export', onclick: function () { comingSoon(label); } })
      ])
    ]));
    card.appendChild(el('div.empty-state', null, [
      ui.frag(ui.icon('inbox')),
      el('h3', { text: 'No records yet' }),
      el('p.text-muted', { text: 'Create your first entry to populate ' + label + '.' }),
      el('button.btn.btn-primary.mt-2', { html: ui.icon('plus-lg') + ' Add ' + label, onclick: function () { comingSoon(label); } })
    ]));
    wrap.appendChild(card);
    return wrap;
  }

  function statTile(label, value, icon, sub) {
    return el('div.kpi-card', null, [
      el('div.kpi-top', null, [ el('span.kpi-label', { text: label }),
        el('span.kpi-ico', { html: '<i class="bi bi-' + icon + '"></i>' }) ]),
      el('div.kpi-value', { text: value }),
      el('div.kpi-foot', null, [ el('span.text-muted', { text: sub }) ])
    ]);
  }

  function comingSoon(label) {
    ui.modal({
      title: label, icon: 'hammer', size: 'sm',
      body: el('div', null, [
        el('p.text-muted', { text: 'The full data-entry experience for "' + label + '" is on the build roadmap.' }),
        el('p.text-muted.mt-2', { html: 'The architecture, routing, permissions and module toggles are already live — ' +
          'this screen graduates to a complete form + table the same way ' +
          '<strong>Visa Processing</strong> and the <strong>Task Board</strong> already have.' })
      ]),
      actions: [{ label: 'Got it', variant: 'primary' }]
    });
  }
  EPAL.comingSoon = comingSoon;

})(window.EPAL = window.EPAL || {});
