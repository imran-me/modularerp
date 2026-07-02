/* ============================================================================
 * EPAL GROUP ERP  ·  core/router.js
 * ----------------------------------------------------------------------------
 * HASH ROUTER — turns  #/<company>/<module>/<sub>  into a rendered view.
 *
 * Resolution order for a route (first hit wins):
 *   1. views['<company>/<module>/<sub>']   ← most specific
 *   2. views['<company>/<module>']
 *   3. a wildcard "any-company" view (key: star + slash + module) — see resolve()
 *   4. the generic placeholder scaffold    ← so EVERY nav item is always live
 *
 * Before rendering it enforces two gates:
 *   - MODULE ENABLED?  (EPAL.modules.isEnabled) → else "module switched off".
 *   - PERMISSION?      (EPAL.auth.can)          → else "access restricted".
 *
 * Views are objects: { title(ctx)?:string, render(ctx):void, teardown()?:void }
 * `ctx` = { mount, companyId, moduleId, subId, company, module, sub, params }
 * ==========================================================================*/

(function (EPAL) {
  'use strict';

  var current = null;   // the currently mounted view (for teardown)

  var Router = {
    mount: null,        // the DOM element views render into (set by app.js)

    parse: function () {
      var hash = (location.hash || '').replace(/^#\/?/, '');
      var q = '';
      var qi = hash.indexOf('?');
      if (qi >= 0) { q = hash.slice(qi + 1); hash = hash.slice(0, qi); }
      var seg = hash.split('/').filter(Boolean);
      var params = {};
      q.split('&').filter(Boolean).forEach(function (kv) { var p = kv.split('='); params[p[0]] = decodeURIComponent(p[1] || ''); });
      return { companyId: seg[0] || 'group', moduleId: seg[1] || 'dashboard', subId: seg[2] || null, params: params };
    },

    navigate: function (route, params) {
      var h = '#/' + route.replace(/^#?\/?/, '');
      if (params) { h += '?' + Object.keys(params).map(function (k) { return k + '=' + encodeURIComponent(params[k]); }).join('&'); }
      if (location.hash === h) this.render(); else location.hash = h;
    },

    resolve: function (companyId, moduleId, subId) {
      var V = EPAL.views || {};
      return V[companyId + '/' + moduleId + '/' + subId]
          || V[companyId + '/' + moduleId]
          || V['*/' + moduleId]
          || null;
    },

    render: function () {
      var r = this.parse();
      var company = EPAL.config.company(r.companyId);
      var mount = this.mount;
      if (!mount) return;

      // teardown previous view + charts
      if (current && current.teardown) { try { current.teardown(); } catch (e) {} }
      current = null;
      EPAL.charts && EPAL.charts.destroyAll();
      mount.scrollTop = 0;

      // unknown company → group dashboard
      if (!company) return this.navigate('group/dashboard');

      var module = EPAL.config.module(r.companyId, r.moduleId);
      // unknown module on a known company → premium 404 (never a broken page)
      if (!module) return render404(mount, r);
      var ctx = { mount: mount, companyId: r.companyId, moduleId: r.moduleId, subId: r.subId,
                  company: company, module: module,
                  sub: module ? (module.subs || []).filter(function (s) { return s.id === r.subId; })[0] : null,
                  params: r.params, router: this };

      // GATE 1 — company / module enabled?
      if (!EPAL.modules.isEnabled(r.companyId) && r.companyId !== 'group') return renderState(ctx, 'company-off');
      if (module && !EPAL.modules.isEnabled(r.companyId, r.moduleId)) return renderState(ctx, 'module-off');
      if (ctx.sub && !EPAL.modules.isEnabled(r.companyId, r.moduleId, r.subId)) return renderState(ctx, 'sub-off');

      // GATE 2 — permission?
      if (module && !EPAL.auth.can(r.companyId, r.moduleId)) return renderState(ctx, 'denied');

      // Resolve the view (or placeholder scaffold).
      var view = this.resolve(r.companyId, r.moduleId, r.subId) || (EPAL.views && EPAL.views['__placeholder__']);
      mount.innerHTML = '';
      mount.setAttribute('data-route', r.companyId + '/' + r.moduleId + (r.subId ? '/' + r.subId : ''));
      mount.style.setProperty('--accent', company.accent);   // theme the page to the company

      try {
        view.render(ctx);
        current = view;
      } catch (e) {
        console.error('[router] view render failed', e);
        mount.innerHTML = '<div class="empty-state"><i class="bi bi-bug"></i><h3>Something broke rendering this view.</h3>' +
                          '<p class="text-muted">' + EPAL.ui.escapeHtml(e.message) + '</p></div>';
      }

      EPAL.bus.emit('route:changed', ctx);
      document.title = (module ? module.label + ' · ' : '') + company.name + ' — Epal ERP';
    },

    start: function () {
      var self = this;
      window.addEventListener('hashchange', function () { self.render(); });
      if (!location.hash) location.hash = '#/group/dashboard';
      this.render();
    }
  };

  /* Premium 404 — even the dead-end feels designed. ------------------------*/
  function render404(mount, r) {
    var ui = EPAL.ui;
    mount.innerHTML = '';
    mount.appendChild(ui.el('div.err-404', null, [
      ui.el('div.err-code', { text: '404' }),
      ui.el('h2', { text: 'This route does not exist' }),
      ui.el('p', { text: '"' + r.companyId + '/' + r.moduleId + '" is not a registered module. It may have been renamed or removed from the registry.' }),
      ui.el('div.flex.gap-2', null, [
        ui.el('button.btn.btn-ghost', { html: ui.icon('search') + ' Search modules', onclick: function () { EPAL.app.openCommandPalette(); } }),
        ui.el('button.btn.btn-primary', { html: ui.icon('grid-1x2') + ' Command Center', onclick: function () { EPAL.router.navigate('group/dashboard'); } })
      ])
    ]));
    document.title = '404 — Epal ERP';
  }

  /* Built-in gate/error states (rendered without a view file) --------------*/
  function renderState(ctx, kind) {
    var ui = EPAL.ui, m = ctx.module, co = ctx.company;
    var states = {
      'company-off': { icon:'building-slash', title: co.name + ' is switched off',
        text:'This sister concern is currently disabled in Module Control.' },
      'module-off':  { icon:'toggle-off', title: (m ? m.label : 'This module') + ' is switched off',
        text:'An administrator has disabled this module for ' + co.name + '.' },
      'sub-off':     { icon:'toggle-off', title:'This feature is switched off',
        text:'This sub-module has been disabled in Module Control.' },
      'denied':      { icon:'shield-lock', title:'Access restricted',
        text:'Your role (' + EPAL.auth.role() + ') does not have permission to open this module.' }
    };
    var s = states[kind];
    ctx.mount.innerHTML = '';
    var box = ui.el('div.gate-state', null, [
      ui.frag('<div class="gate-ico">' + ui.icon(s.icon) + '</div>'),
      ui.el('h2', { text: s.title }),
      ui.el('p.text-muted', { text: s.text }),
      EPAL.auth.isAdmin() && (kind === 'module-off' || kind === 'company-off' || kind === 'sub-off')
        ? ui.el('button.btn.btn-primary', { html: ui.icon('toggles2') + ' Open Module Control',
            onclick: function () { EPAL.router.navigate('group/module-manager'); } })
        : ui.el('button.btn.btn-ghost', { html: ui.icon('arrow-left') + ' Back to Command Center',
            onclick: function () { EPAL.router.navigate('group/dashboard'); } })
    ]);
    ctx.mount.appendChild(box);
    document.title = s.title + ' — Epal ERP';
  }

  EPAL.router = Router;

})(window.EPAL = window.EPAL || {});
