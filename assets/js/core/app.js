/* ============================================================================
 * EPAL GROUP ERP  ·  core/app.js
 * ----------------------------------------------------------------------------
 * THE APPLICATION SHELL + BOOTSTRAP.
 *
 * Assembles the whole chrome around the router-rendered content:
 *   ┌──────┬───────────────┬──────────────────────────────────────┐
 *   │ RAIL │   SIDEBAR      │  TOPBAR                               │
 *   │ (co  │  (modules of   ├──────────────────────────────────────┤
 *   │ swch)│   active co)   │  CONTENT  (router mounts views here)  │
 *   └──────┴───────────────┴──────────────────────────────────────┘
 *
 * Everything (rail companies, sidebar modules) is generated from the config
 * registry and filtered by module-enabled + auth-permission. Boot order is
 * important and documented inline below.
 * ==========================================================================*/

(function (EPAL) {
  'use strict';

  var ui = EPAL.ui, el = ui.el, $ = ui.$;

  var App = {
    activeCompany: 'group',

    /* ---- BOOT ------------------------------------------------------------*/
    init: function () {
      EPAL.db.seed();                    // 1. seed demo data (idempotent)
      EPAL.modules.applyOverrides();     // 2. fold saved on/off flags onto config
      this.applyTheme();                 // 3. paint theme before first render
      this.renderShell();                // 4. build rail + sidebar + topbar
      this.bindGlobal();                 // 5. keyboard, bus subscriptions
      EPAL.router.mount = $('#view');    // 6. tell router where to render
      EPAL.router.start();               // 7. go
      // reactive re-renders
      EPAL.bus.on('modules:changed', this.refreshNav.bind(this));
      EPAL.bus.on('auth:changed', function () { App.renderShell(); EPAL.router.render(); });
      EPAL.bus.on('route:changed', this.onRoute.bind(this));
      EPAL.bus.on('notify', function (n) {
        ui.toast(n.text, n.level, { title: n.title });
        App.refreshNotifications();
      });
      // Remove the pre-boot splash.
      var splash = $('#boot-splash'); if (splash) { splash.classList.add('gone'); setTimeout(function () { splash.remove(); }, 500); }
    },

    /* ---- THEME -----------------------------------------------------------*/
    applyTheme: function () {
      var t = EPAL.store.get('ui.theme', 'dark');
      document.documentElement.setAttribute('data-theme', t);
    },
    toggleTheme: function () {
      var t = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', t);
      EPAL.store.set('ui.theme', t);
      EPAL.bus.emit('theme:changed', { theme: t });
      var i = $('#theme-ico'); if (i) i.className = 'bi bi-' + (t === 'dark' ? 'moon-stars-fill' : 'sun-fill');
    },

    /* ---- SHELL -----------------------------------------------------------*/
    renderShell: function () {
      var root = $('#app');
      root.innerHTML = '';
      root.appendChild(this.buildRail());
      root.appendChild(this.buildSidebar());
      root.appendChild(this.buildMain());
      root.appendChild(el('div#sidebar-backdrop.sidebar-backdrop', { onclick: function () { App.toggleSidebar(false); } }));
      // Populate the module nav for the active company immediately. Without this
      // the sidebar would stay empty on first load (the initial route's company
      // equals the default, so onRoute's "company changed?" guard wouldn't fire).
      this.refreshNav();
    },

    /* Company switcher rail (far left) ------------------------------------*/
    buildRail: function () {
      var rail = el('aside.rail');
      rail.appendChild(el('div.rail-brand', { title: 'Epal Group', onclick: function () { EPAL.router.navigate('group/dashboard'); },
        html: '<span>E</span>' }));
      var list = el('div.rail-list');
      EPAL.config.companies.forEach(function (co) {
        if (!EPAL.modules.isEnabled(co.id) && co.id !== 'group') return;   // hidden when off
        if (!EPAL.auth.canCompany(co.id)) return;                          // hidden when not permitted
        var btn = el('button.rail-co', {
          'data-co': co.id, title: co.name,
          style: { '--accent': co.accent },
          onclick: function () { App.gotoCompany(co.id); }
        }, [ ui.frag('<i class="bi bi-' + co.icon + '"></i>'),
             el('span.rail-tip', { text: co.name }) ]);
        if (co.type === 'group') btn.classList.add('is-group');
        list.appendChild(btn);
      });
      rail.appendChild(list);
      rail.appendChild(el('div.rail-foot', null, [
        el('button.rail-icon', { id:'theme-btn', title:'Toggle theme', onclick: function () { App.toggleTheme(); },
          html: '<i id="theme-ico" class="bi bi-' + (document.documentElement.getAttribute('data-theme') === 'dark' ? 'moon-stars-fill' : 'sun-fill') + '"></i>' })
      ]));
      return rail;
    },

    /* Sidebar = active company header + its module nav ---------------------*/
    buildSidebar: function () {
      var side = el('aside#sidebar.sidebar');
      side.appendChild(el('div#sidebar-head.sidebar-head'));
      side.appendChild(el('nav#nav.nav', { 'aria-label':'Modules' }));
      side.appendChild(this.buildUserCard());
      return side;
    },

    buildUserCard: function () {
      var u = EPAL.auth.current();
      var card = el('div.user-card', { id:'user-card', onclick: function (e) { App.openUserMenu(e); } }, [
        el('div.avatar', { style:{ background: ui.colorFor(u.name) }, text: ui.initials(u.name) }),
        el('div.user-meta', null, [
          el('div.user-name', { text: u.name }),
          el('div.user-role', { text: (EPAL.auth.role().charAt(0).toUpperCase() + EPAL.auth.role().slice(1)) + ' · ' + (EPAL.config.company(u.companyId) || {short:'Group'}).short })
        ]),
        ui.frag('<i class="bi bi-chevron-expand"></i>')
      ]);
      return card;
    },

    /* Main column: topbar + scrollable content ----------------------------*/
    buildMain: function () {
      var main = el('main.main');
      main.appendChild(this.buildTopbar());
      main.appendChild(el('div#view.content', { role:'main' }));
      return main;
    },

    buildTopbar: function () {
      var bar = el('header.topbar');
      bar.appendChild(el('button.icon-btn.only-mobile', { 'aria-label':'Menu', onclick: function () { App.toggleSidebar(); },
        html: ui.icon('list') }));
      bar.appendChild(el('div#breadcrumb.breadcrumb'));
      bar.appendChild(el('div.topbar-spacer'));
      // search / command palette trigger
      bar.appendChild(el('button.search-trigger', { onclick: function () { App.openCommandPalette(); } }, [
        ui.frag(ui.icon('search')), el('span', { text:'Search or jump to…' }), el('kbd', { text:'Ctrl K' })
      ]));
      // notifications
      bar.appendChild(el('button.icon-btn', { id:'notif-btn', 'aria-label':'Notifications',
        onclick: function (e) { App.openNotifications(e); },
        html: ui.icon('bell') + '<span id="notif-dot" class="notif-dot" hidden></span>' }));
      // quick add
      bar.appendChild(el('button.icon-btn', { 'aria-label':'Quick add', title:'Quick add',
        onclick: function (e) { App.openQuickAdd(e); }, html: ui.icon('plus-lg') }));
      return bar;
    },

    /* ---- NAV RENDERING ---------------------------------------------------*/
    gotoCompany: function (companyId) {
      // jump to the first permitted, enabled module of that company (its dashboard usually)
      var co = EPAL.config.company(companyId);
      var first = co.modules.filter(function (mm) {
        return EPAL.modules.isEnabled(companyId, mm.id) && EPAL.auth.can(companyId, mm.id);
      })[0];
      EPAL.router.navigate(companyId + '/' + (first ? first.id : 'dashboard'));
    },

    onRoute: function (ctx) {
      if (ctx.companyId !== this.activeCompany) {
        this.activeCompany = ctx.companyId;
        this.refreshNav();
      }
      this.highlightNav(ctx);
      this.renderBreadcrumb(ctx);
      // rail active state
      ui.$$('.rail-co').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-co') === ctx.companyId); });
      this.toggleSidebar(false);
      this.refreshNotifications();
    },

    refreshNav: function () {
      var co = EPAL.config.company(this.activeCompany) || EPAL.config.company('group');
      // sidebar header
      var head = $('#sidebar-head');
      head.innerHTML = '';
      head.style.setProperty('--accent', co.accent);
      head.appendChild(el('div.side-co', null, [
        el('div.side-co-ico', { html:'<i class="bi bi-' + co.icon + '"></i>' }),
        el('div', null, [ el('div.side-co-name', { text: co.name }),
                          el('div.side-co-tag', { text: co.tagline || (co.type==='group'?'Command Layer':'') }) ])
      ]));

      // module list
      var nav = $('#nav'); nav.innerHTML = '';
      var accessible = co.modules.filter(function (mm) {
        return EPAL.modules.isEnabled(co.id, mm.id) && EPAL.auth.can(co.id, mm.id);
      });
      accessible.forEach(function (mm) { nav.appendChild(App.buildNavItem(co, mm)); });
      if (!accessible.length) nav.appendChild(el('div.nav-empty', { text:'No modules available for your role here.' }));
      this.highlightNav(EPAL.router.parse());
    },

    buildNavItem: function (co, mm) {
      var subs = (mm.subs || []).filter(function (s) { return EPAL.modules.isEnabled(co.id, mm.id, s.id); });
      var hasSubs = subs.length > 0;
      var route = co.id + '/' + mm.id;
      var row = el('a.nav-item', { href:'#/' + route, 'data-route': route }, [
        ui.frag('<span class="nav-ico"><i class="bi bi-' + mm.icon + '"></i></span>'),
        el('span.nav-label', { text: mm.label }),
        mm.badge ? el('span.nav-badge', { text: mm.badge }) : null,
        hasSubs ? ui.frag('<span class="nav-caret"><i class="bi bi-chevron-right"></i></span>') : null
      ]);
      if (mm.admin) row.appendChild(ui.frag('<span class="nav-lock" title="Admin only"><i class="bi bi-shield-lock"></i></span>'));

      if (!hasSubs) return row;

      var wrap = el('div.nav-group');
      row.addEventListener('click', function (e) {
        // clicking the row toggles the group AND navigates to the module overview
        wrap.classList.toggle('open');
      });
      wrap.appendChild(row);
      var subWrap = el('div.nav-subs');
      subs.forEach(function (s) {
        var sroute = route + '/' + s.id;
        subWrap.appendChild(el('a.nav-sub', { href:'#/' + sroute, 'data-route': sroute }, [
          el('span.nav-sub-dot'), el('span', { text: s.label })
        ]));
      });
      wrap.appendChild(subWrap);
      return wrap;
    },

    highlightNav: function (r) {
      var active = r.companyId + '/' + r.moduleId + (r.subId ? '/' + r.subId : '');
      var moduleRoute = r.companyId + '/' + r.moduleId;
      ui.$$('#nav [data-route]').forEach(function (a) {
        var rt = a.getAttribute('data-route');
        a.classList.toggle('active', rt === active || (!r.subId && rt === moduleRoute));
      });
      // auto-open the group containing the active sub
      ui.$$('#nav .nav-group').forEach(function (g) {
        var has = g.querySelector('[data-route="' + active + '"]') || g.querySelector('[data-route="' + moduleRoute + '"]');
        if (has) g.classList.add('open');
      });
    },

    renderBreadcrumb: function (ctx) {
      var bc = $('#breadcrumb'); if (!bc) return;
      var parts = [{ label: ctx.company.name, route: ctx.companyId + '/dashboard' }];
      if (ctx.module) parts.push({ label: ctx.module.label, route: ctx.companyId + '/' + ctx.moduleId });
      if (ctx.sub) parts.push({ label: ctx.sub.label });
      bc.innerHTML = '';
      parts.forEach(function (p, i) {
        if (i) bc.appendChild(ui.frag('<span class="bc-sep"><i class="bi bi-chevron-right"></i></span>'));
        bc.appendChild(p.route
          ? el('a.bc-item', { href:'#/' + p.route, text: p.label })
          : el('span.bc-item.current', { text: p.label }));
      });
    },

    /* ---- TOPBAR POPOVERS -------------------------------------------------*/
    refreshNotifications: function () {
      var unread = EPAL.db.notifications().filter(function (n) { return !n.read; }).length;
      var dot = $('#notif-dot'); if (dot) { dot.hidden = unread === 0; dot.textContent = unread || ''; }
    },
    openNotifications: function (e) {
      var list = EPAL.db.notifications();
      popover(e.currentTarget, el('div.pop.pop-notif', null, [
        el('div.pop-head', null, [ el('strong', { text:'Notifications' }),
          el('button.link-btn', { text:'Mark all read', onclick: function () { EPAL.db.markNotificationsRead(); App.refreshNotifications(); closePop(); } }) ]),
        el('div.pop-body', null, list.length ? list.slice(0, 8).map(function (n) {
          return el('div.notif' + (n.read ? '' : '.unread'), null, [
            ui.frag('<span class="notif-ico notif-' + n.level + '">' + ui.icon(n.icon || 'dot') + '</span>'),
            el('div', null, [ el('div.notif-title', { text:n.title }),
              el('div.notif-text', { text:n.text }), el('div.notif-time', { text: ui.ago(n.at) }) ])
          ]);
        }) : [ el('div.pop-empty', { text:'You are all caught up.' }) ])
      ]));
    },
    openUserMenu: function (e) {
      var u = EPAL.auth.current();
      popover($('#user-card'), el('div.pop.pop-user', null, [
        el('div.pop-userhead', null, [
          el('div.avatar.lg', { style:{ background: ui.colorFor(u.name) }, text: ui.initials(u.name) }),
          el('div', null, [ el('strong', { text:u.name }), el('div.text-muted.sm', { text:u.email }) ])
        ]),
        el('div.pop-section-label', { text:'View as (demo role switch)' }),
        el('div.viewas', null, EPAL.auth.roles.map(function (r) {
          return el('button.viewas-btn' + (EPAL.auth.role() === r.key ? '.active' : ''), {
            onclick: function () { EPAL.auth.viewAs(r.key); closePop(); ui.toast('Now viewing as ' + r.label, 'info'); },
            html: ui.icon(r.icon) + '<span>' + r.label + '</span>'
          });
        })),
        el('div.pop-divider'),
        el('button.pop-link', { onclick: function () { closePop(); EPAL.router.navigate('group/settings'); },
          html: ui.icon('gear') + ' Settings' }),
        el('button.pop-link.danger', { onclick: function () {
            closePop(); ui.confirm({ title:'Reset demo data?', text:'This restores all seeded data and clears your changes.', danger:true, confirmLabel:'Reset' })
              .then(function (ok) { if (ok) { EPAL.db.reset(); location.reload(); } }); },
          html: ui.icon('arrow-counterclockwise') + ' Reset demo data' })
      ]));
    },
    openQuickAdd: function (e) {
      var actions = [
        { label:'New Task', icon:'kanban', route:'group/tasks' },
        { label:'New Visa Application', icon:'passport', route:'travels/visa-processing/new-application' },
        { label:'New Lead', icon:'person-plus', route:'group/crm/leads' },
        { label:'New Employee', icon:'person-badge', route:'group/employees/directory' }
      ];
      popover(e.currentTarget, el('div.pop', null, [
        el('div.pop-head', null, [ el('strong', { text:'Quick add' }) ]),
        el('div.pop-body', null, actions.map(function (a) {
          return el('button.pop-link', { onclick: function () { closePop(); EPAL.router.navigate(a.route); },
            html: ui.icon(a.icon) + ' ' + a.label });
        }))
      ]));
    },

    /* ---- COMMAND PALETTE (Ctrl/⌘ K) -------------------------------------*/
    openCommandPalette: function () {
      var items = [];
      EPAL.config.companies.forEach(function (co) {
        if (!EPAL.modules.isEnabled(co.id) && co.id !== 'group') return;
        if (!EPAL.auth.canCompany(co.id)) return;
        co.modules.forEach(function (mm) {
          if (!EPAL.modules.isEnabled(co.id, mm.id) || !EPAL.auth.can(co.id, mm.id)) return;
          items.push({ label: mm.label, sub: co.name, icon: mm.icon, route: co.id + '/' + mm.id, accent: co.accent });
          (mm.subs || []).forEach(function (s) {
            if (!EPAL.modules.isEnabled(co.id, mm.id, s.id)) return;
            items.push({ label: s.label, sub: co.short + ' › ' + mm.label, icon: 'dot', route: co.id + '/' + mm.id + '/' + s.id, accent: co.accent });
          });
        });
      });

      var input = el('input.cmd-input', { placeholder:'Jump to any module, company or feature…', autofocus:true });
      var results = el('div.cmd-results');
      var m = ui.modal({ title:null, size:'cmd', footer:false, dismissable:true,
        body: el('div.cmdk', null, [ el('div.cmd-box', null, [ ui.frag(ui.icon('search','cmd-search')), input ]), results ]) });
      var sel = 0, filtered = items;
      function draw() {
        results.innerHTML = '';
        filtered.slice(0, 40).forEach(function (it, i) {
          results.appendChild(el('button.cmd-item' + (i === sel ? '.sel' : ''), {
            onclick: function () { m.close(); EPAL.router.navigate(it.route); },
            html: '<span class="cmd-ico" style="color:' + it.accent + '"><i class="bi bi-' + it.icon + '"></i></span>' +
                  '<span class="cmd-label">' + ui.escapeHtml(it.label) + '<small>' + ui.escapeHtml(it.sub) + '</small></span>' +
                  '<span class="cmd-go"><i class="bi bi-arrow-return-left"></i></span>'
          }));
        });
        if (!filtered.length) results.appendChild(el('div.pop-empty', { text:'No matches.' }));
      }
      input.addEventListener('input', function () {
        var q = input.value.toLowerCase(); sel = 0;
        filtered = items.filter(function (it) { return (it.label + ' ' + it.sub).toLowerCase().indexOf(q) >= 0; });
        draw();
      });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, filtered.length - 1); draw(); e.preventDefault(); }
        else if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); draw(); e.preventDefault(); }
        else if (e.key === 'Enter' && filtered[sel]) { m.close(); EPAL.router.navigate(filtered[sel].route); }
      });
      draw(); setTimeout(function () { input.focus(); }, 30);
    },

    /* ---- MOBILE ----------------------------------------------------------*/
    toggleSidebar: function (force) {
      var open = force === undefined ? !document.body.classList.contains('sidebar-open') : force;
      document.body.classList.toggle('sidebar-open', open);
    },

    bindGlobal: function () {
      document.addEventListener('keydown', function (e) {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); App.openCommandPalette(); }
      });
    }
  };

  /* --- lightweight popover (anchored dropdown) ----------------------------*/
  var _pop = null;
  function popover(anchor, node) {
    closePop();
    _pop = el('div.popover-layer', null, [node]);
    document.body.appendChild(_pop);
    var r = anchor.getBoundingClientRect();
    var w = node.offsetWidth || 300;
    node.style.position = 'fixed';
    node.style.top = (r.bottom + 8) + 'px';
    node.style.right = Math.max(12, window.innerWidth - r.right) + 'px';
    requestAnimationFrame(function () { node.classList.add('in'); });
    setTimeout(function () { document.addEventListener('click', outside, true); }, 0);
    function outside(e) { if (_pop && !_pop.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) closePop(); }
    _pop._outside = outside;
  }
  function closePop() {
    if (!_pop) return;
    document.removeEventListener('click', _pop._outside, true);
    _pop.remove(); _pop = null;
  }
  EPAL._closePop = closePop;

  EPAL.app = App;

  // AUTO-BOOT once DOM + all core scripts are parsed.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { App.init(); });
  else App.init();

})(window.EPAL = window.EPAL || {});
