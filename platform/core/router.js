/* ============================================================================
 * EPAL GROUP ERP  ·  assets/js/kernel/router.js
 * ----------------------------------------------------------------------------
 * WHAT: THE HASH ROUTER — turns the URL fragment #/<company>/<module>/<sub>[?params]
 *   into a rendered view mounted in #view. It parses the hash, tears down the
 *   previous view + its charts, enforces the enable/permission gates, resolves the
 *   most specific registered view (falling back to a placeholder so EVERY nav item
 *   is live from day one), themes the page to the company accent, and emits
 *   route:changed. Dead ends are designed too (a premium 404, gate states).
 *
 * DATA IT OWNS (localStorage stores): none. Reads config, modules, auth, views.
 *
 * BUSINESS RULES (the "why" a developer must preserve):
 *   - VIEW RESOLUTION ORDER, first hit wins: (1) 'co/mod/sub' exact, (2) 'co/mod',
 *     (3) the "star-slash-mod" wildcard (a screen shared by every company), (4) the placeholder
 *     scaffold. This is why any route always renders something real.
 *   - TWO GATES run before render, in order: (1) enabled? company/module/sub via
 *     EPAL.modules.isEnabled -> else a "switched off" state; (2) permitted? via
 *     EPAL.auth.can -> else "access restricted". Never render a gated view.
 *   - Unknown company -> redirect to group/dashboard; unknown module -> premium 404.
 *   - Always teardown() the old view and destroyAll() charts first (no SPA leaks).
 *   - A throwing view is caught and shown as an inline error, never a blank page.
 *
 * PUBLIC API (window.EPAL.router):
 *   .mount                         -> the DOM node views render into (set by app.js)
 *   .parse()                       -> { companyId, moduleId, subId, params }
 *   .navigate(route, params?)      -> set the hash (or re-render if unchanged)
 *   .resolve(co, mod, sub)         -> the view object per the order above | null
 *   .render()                      -> render the current hash (gates + teardown)
 *   .start()                       -> attach hashchange + do the first render
 *   view shape: { title(ctx)?, render(ctx), teardown()? };
 *   ctx = { mount, companyId, moduleId, subId, company, module, sub, params, router }
 *
 * ==> LARAVEL / PHP MAPPING: web.php route `/{company}/{module}/{sub?}` -> a
 *     controller that resolves a Blade view by the same specificity fallback. The
 *     two gates become route middleware (a module-enabled check + an authorize()
 *     policy call). 404 -> the framework's not-found handler.
 * ========================================================================*/

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
