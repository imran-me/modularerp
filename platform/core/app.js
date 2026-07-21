/* ============================================================================
 * EPAL GROUP ERP  ·  assets/js/kernel/app.js
 * ----------------------------------------------------------------------------
 * WHAT: THE APPLICATION SHELL + BOOTSTRAP. This is the composition root. It seeds
 *   data, applies saved module on/off overrides, paints the theme, then builds the
 *   whole chrome around the router-rendered content — the company-switcher RAIL,
 *   the per-company module SIDEBAR (collapsible single-open accordion), and the
 *   TOPBAR (breadcrumb, command palette, notifications, quick-add, user menu) —
 *   and finally starts the router and the deep-core engines. Everything in the
 *   rail/sidebar/palette is generated from the config registry and filtered by
 *   module-enabled AND auth-permission, so the UI reshapes itself per role/toggles.
 *
 * DATA IT OWNS (localStorage stores):
 *   ui.theme — 'dark' | 'light'  (the persisted colour theme; applied before first
 *              paint, toggled from the rail, emits theme:changed).
 *
 * BUSINESS RULES (the "why" a developer must preserve):
 *   - BOOT ORDER MATTERS (see init): seed -> applyOverrides -> theme -> shell ->
 *     bindings -> set router mount -> router.start -> bootEngines. Engines boot
 *     AFTER the router so their post-boot hooks run against a live view.
 *   - The rail hides companies that are switched off or not permitted; the sidebar
 *     hides modules the same way — the single source of truth is isEnabled + can.
 *   - refreshNav() is called explicitly in renderShell because the first route's
 *     company equals the default, so onRoute's "company changed?" guard won't fire.
 *   - The module nav is a SINGLE-OPEN accordion (opening one group collapses the
 *     rest) and keeps NO persisted open-state, so nothing piles up.
 *   - Ctrl/Cmd+K opens the command palette which searches BOTH modules and, via
 *     EPAL.search, live data records (customers, tickets, invoices, ...).
 *
 * PUBLIC API (window.EPAL.app):
 *   .init()                 -> boot the whole app (auto-invoked at file end)
 *   .toggleTheme() / .applyTheme()
 *   .gotoCompany(id), .refreshNav(), .openCommandPalette()
 *   .openNotifications(e), .openUserMenu(e), .openQuickAdd(e), .toggleSidebar(force)
 *   (also window.EPAL._closePop -> closes the active anchored popover)
 *
 * ==> LARAVEL / PHP MAPPING: AppServiceProvider::boot (seeders/config) PLUS the
 *     main layout Blade (`layouts/app.blade.php`) that renders rail/sidebar/topbar
 *     from the modules the Gate permits; a Blade `@yield('content')` replaces the
 *     #view mount. The command palette / notifications become small API endpoints.
 * ========================================================================*/

(function (EPAL) {
  'use strict';

  var ui = EPAL.ui, el = ui.el, $ = ui.$;

  var App = {
    activeCompany: 'group',

    /* ---- BOOT ------------------------------------------------------------*/
    // REAL-DATA GATE (see platform/data/api.js): resolve api-vs-demo mode
    // first. API mode = sign-in before anything renders, then hydrate the
    // store from the Laravel backend INSTEAD of seeding demo data — real and
    // demo are never mixed. Demo mode = start(false) = the old path unchanged.
    init: function () {
      var self = this;
      EPAL.api.detect().then(function (m) {
        if (m !== 'api') return self.start(false);
        if (!localStorage.getItem('EPAL_TOKEN')) return EPAL.loginScreen.show();
        EPAL.api.hydrate().then(
          function () { self.start(true); },
          function (err) {                   // hydrate rejects on 401 (stale token) OR any other failure
            localStorage.removeItem('EPAL_TOKEN');
            localStorage.removeItem('EPAL_USER');
            EPAL.loginScreen.show(err);       // pass the failure reason through — shown on the gate
          }
        );
      }).catch(function (err) {
        // detect()/hydrate() itself throwing (not just rejecting) must still
        // surface SOMETHING on screen — a silently blank/stuck boot is worse
        // than an ugly error, and this codebase has no console access
        // guaranteed for whoever is looking at it live.
        var pre = document.createElement('pre');
        pre.style.cssText = 'position:fixed;inset:0;margin:0;padding:24px;background:#1a0000;color:#f88;font:13px/1.5 monospace;white-space:pre-wrap;z-index:99999;overflow:auto;';
        pre.textContent = 'Boot failed:\n' + (err && (err.stack || err.message) || String(err));
        document.body.appendChild(pre);
      });
    },

    start: function (apiMode) {
      if (!apiMode) EPAL.db.seed();      // 1. demo data — DEMO MODE ONLY
      if (apiMode) EPAL.api.wireWrites();// 1b. saves/deletes on writable stores now reach the DB
      EPAL.modules.applyOverrides();     // 2. fold saved on/off flags onto config
      this.applyTheme();                 // 3. paint theme before first render
      this.renderShell();                // 4. build rail + sidebar + topbar
      this.bindGlobal();                 // 5. keyboard, bus subscriptions
      EPAL.router.mount = $('#view');    // 6. tell router where to render
      // Subscribe BEFORE router.start(): the initial render emits route:changed,
      // and onRoute must catch it too (it stamps data-atmos/data-module on #view
      // for the ambient scenes — missing it left the first pageload unthemed).
      EPAL.bus.on('route:changed', this.onRoute.bind(this));
      EPAL.router.start();               // 7. go
      if (EPAL.bootEngines) EPAL.bootEngines();  // 8. start Deep Core engines (scheduler, audit…)
      // reactive re-renders
      EPAL.bus.on('modules:changed', this.refreshNav.bind(this));
      EPAL.bus.on('auth:changed', function () { App.renderShell(); EPAL.router.render(); });
      EPAL.bus.on('notify', function (n) {
        ui.toast(n.text, n.level, { title: n.title });
        App.refreshNotifications();
      });
      // Remove the pre-boot splash.
      var splash = $('#boot-splash'); if (splash) { splash.classList.add('gone'); setTimeout(function () { splash.remove(); }, 500); }

      // AUTO-DISCOVERY (Phase 3a): after the shell is up, probe which company /
      // module folders actually exist (HTTP only; file:// no-ops). Re-render ONLY
      // if a folder was found deleted — so the normal all-present load never
      // re-renders and stays byte-identical to before discovery existed.
      if (EPAL.discovery && EPAL.discovery.scan) {
        EPAL.discovery.scan().then(function (d) {
          if (d.changed()) { App.renderShell(); EPAL.router.render(); }
        });
      }
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
      // My Task — always-available jump to the current vertical's personal board
      bar.appendChild(el('button.btn.btn-ghost.btn-sm.topbar-task', { id:'mytask-btn', title:'My Task',
        onclick: function () { EPAL.router.navigate((App.activeCompany || 'group') + '/tasks'); },
        html: ui.icon('kanban') + ' <span class="tb-task-lbl">My Task</span>' }));
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
      // Stamp the vertical + module onto the content mount so atmosphere.css can
      // paint the right bespoke line-art emblem behind the page header.
      if (EPAL.router.mount) {
        EPAL.router.mount.setAttribute('data-atmos', ctx.companyId || '');
        EPAL.router.mount.setAttribute('data-module', ctx.moduleId || '');
      }
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
      accessible.forEach(function (mm, i) {
        nav.appendChild(App.buildNavItem(co, mm));
        // group divider (config sectionEnd) — only when items still follow, so a
        // module hidden by discovery/permissions never leaves a dangling line.
        if (mm.sectionEnd && i < accessible.length - 1) nav.appendChild(el('div.nav-divider', { 'aria-hidden':'true' }));
      });
      if (!accessible.length) nav.appendChild(el('div.nav-empty', { text:'No modules available for your role here.' }));
      this.highlightNav(EPAL.router.parse());
    },

    /* ---- collapsible module nav (single-open accordion) ------------------
     * Each module with sub-features is a collapsible group. Clicking anywhere on
     * the row (or the caret) expands/collapses it. It is a SINGLE-OPEN accordion:
     * opening one category collapses the others, so the sidebar stays tidy. On
     * navigation the active module's group is the one shown open. No persisted
     * state — nothing piles up. ------------------------------------------------*/
    collapseOtherGroups: function (except) {
      ui.$$('#nav .nav-group.open').forEach(function (g) { if (g !== except) g.classList.remove('open'); });
    },

    buildNavItem: function (co, mm) {
      var subs = (mm.subs || []).filter(function (s) { return EPAL.modules.isEnabled(co.id, mm.id, s.id); });
      var hasSubs = subs.length > 0;
      var route = co.id + '/' + mm.id;
      var row = el('a.nav-item', { href:'#/' + route, 'data-route': route }, [
        ui.frag('<span class="nav-ico"><i class="bi bi-' + mm.icon + '"></i></span>'),
        el('span.nav-label', { text: mm.label }),
        mm.badge ? el('span.nav-badge', { text: mm.badge }) : null,
        hasSubs ? el('span.nav-caret', { role:'button', 'aria-label':'Toggle ' + mm.label,
          title:'Expand / collapse', html:'<i class="bi bi-chevron-right"></i>' }) : null
      ]);
      if (mm.admin) row.appendChild(ui.frag('<span class="nav-lock" title="Admin only"><i class="bi bi-shield-lock"></i></span>'));

      if (!hasSubs) return row;

      var wrap = el('div.nav-group');
      var rt = EPAL.router.parse();
      if (rt.companyId === co.id && rt.moduleId === mm.id) wrap.classList.add('open');   // active starts open

      // Toggle this group open/closed; opening collapses the others (single-open).
      function toggleGroup() {
        var willOpen = !wrap.classList.contains('open');
        if (willOpen) App.collapseOtherGroups(wrap);
        wrap.classList.toggle('open', willOpen);
        return willOpen;
      }
      // Whole row toggles. Expanding also navigates to the module overview;
      // collapsing keeps you where you are.
      row.addEventListener('click', function (e) {
        var opened = toggleGroup();
        if (!opened) e.preventDefault();
      });
      // Caret is a pure toggle — never navigates.
      var caret = row.querySelector('.nav-caret');
      if (caret) caret.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        toggleGroup();
      });

      wrap.appendChild(row);
      // The sub-links live in a SINGLE inner container so the CSS grid
      // collapse (0fr -> 1fr) works — the trick only animates one grid child.
      var subWrap = el('div.nav-subs');
      var subInner = el('div.nav-subs-inner');
      subs.forEach(function (s) {
        var sroute = route + '/' + s.id;
        subInner.appendChild(el('a.nav-sub', { href:'#/' + sroute, 'data-route': sroute }, [
          el('span.nav-sub-dot'), el('span', { text: s.label })
        ]));
      });
      subWrap.appendChild(subInner);
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
      // Single-open accordion: only the active module's group stays expanded.
      ui.$$('#nav .nav-group').forEach(function (g) {
        var head = g.querySelector('.nav-item');
        var gr = head && head.getAttribute('data-route');
        g.classList.toggle('open', gr === moduleRoute);
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
    // The bell rings for the CURRENT user's inbox: every broadcast alert plus the
    // notifications addressed to them (db.inbox() — see database.js). Legacy /
    // seeded notifications carry no `toId`, so they all still ring, exactly as before.
    refreshNotifications: function () {
      var unread = EPAL.db.inbox().filter(function (n) { return !n.read; }).length;
      var dot = $('#notif-dot'); if (dot) { dot.hidden = unread === 0; dot.textContent = unread || ''; }
    },
    openNotifications: function (e) {
      var list = EPAL.db.inbox();
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
        (EPAL.api && EPAL.api.enabled())
          ? el('button.pop-link.danger', { onclick: function () { closePop(); EPAL.api.logout(); },
              html: ui.icon('box-arrow-right') + ' Sign out' })
          : el('button.pop-link.danger', { onclick: function () {
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
        var mods = items.filter(function (it) { return (it.label + ' ' + it.sub).toLowerCase().indexOf(q) >= 0; });
        // Deep Core: also search DATA records (customers, tickets, files, invoices…)
        var data = [];
        if (EPAL.search && q.length >= 2) {
          try { data = EPAL.search.all(input.value).slice(0, 20); } catch (e) { data = []; }
        }
        filtered = mods.slice(0, 20).concat(data);
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
    node.style.position = 'fixed';
    node.style.right = Math.max(12, window.innerWidth - r.right) + 'px';
    // Flip upward (anchor stays below the card, e.g. #user-card at the
    // sidebar footer) when there isn't room to drop down without the
    // popover running off the bottom of the viewport.
    var h = node.offsetHeight || 200;
    if (r.bottom + 8 + h > window.innerHeight) {
      node.style.bottom = (window.innerHeight - r.top + 8) + 'px';
    } else {
      node.style.top = (r.bottom + 8) + 'px';
    }
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
