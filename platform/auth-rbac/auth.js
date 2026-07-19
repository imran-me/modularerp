/* ============================================================================
 * EPAL GROUP ERP  ·  assets/js/kernel/auth.js
 * ----------------------------------------------------------------------------
 * WHAT: IDENTITY, ROLES, PERMISSIONS and "VIEW AS". Employees ARE the users of
 *   this ERP; an employee record carries a role, a home company, and optional
 *   fine-grained grants. This module answers the one question asked everywhere in
 *   the app: "can THIS user open THIS company's THIS module?" It also drives the
 *   demo role-impersonation switcher used to test the UI as any role live.
 *
 * DATA IT OWNS (localStorage stores):
 *   auth.currentUserId — string employee id (e.g. 'EPL-0001'); the logged-in/
 *                        impersonated user. Defaults to the owner if unset. The
 *                        employee RECORDS themselves live in db (store 'employees').
 *
 * BUSINESS RULES (the "why" a developer must preserve):
 *   - Role ladder: owner > admin > manager > accountant > hr > employee > agent.
 *   - owner/admin bypass all gates (can() returns true immediately).
 *   - EXPLICIT per-employee grants WIN over role defaults: a 'company/module' or
 *     'company/*' entry in permissions[] grants access even if the role would deny.
 *   - Non-admins are SCOPED to their homeCompany; they cannot open other companies'
 *     modules. Everyone can see the 'group' shell but only its general modules
 *     (dashboard/notifications) — GROUP_ADMIN_ONLY modules stay owner/admin-only.
 *   - accessLevel 'general' hides confidential finance widgets; 'full' shows them.
 *   - A plain employee is ESS: only their own dashboard + tasks (+ own profile).
 *   - viewAs() is DEMO impersonation — it swaps the current user and stamps a role
 *     without mutating the underlying employee record.
 *
 * PUBLIC API (window.EPAL.auth):
 *   .current() -> user; .setUser(id) -> user (+emits auth:changed)
 *   .role()/.isOwner()/.isAdmin()/.homeCompany()/.accessLevel()
 *   .canCompany(companyId) -> bool  (visible in the company switcher?)
 *   .can(companyId, moduleId) -> bool  (THE gate used by router + nav + palette)
 *   .roles (list for the switcher); .viewAs(roleKey) -> user (demo impersonation)
 *
 * ==> LARAVEL / PHP MAPPING: Laravel Auth (guard/session) for current(); a Gate or
 *     Policy for can()/canCompany() (the module gate becomes a `before` super-admin
 *     hook + per-ability checks); route middleware enforces it. Grants map to a
 *     spatie/laravel-permission style role+permission set on the User model.
 * ========================================================================*/

(function (EPAL) {
  'use strict';

  var S = EPAL.store, bus = EPAL.bus;
  var KEY = 'auth.currentUserId';

  // Modules an ordinary employee may always reach for their OWN self-service.
  var ESS_MODULES = ['dashboard', 'tasks'];          // + their own profile (handled in views)
  // Group modules that are strictly owner/admin.
  var GROUP_ADMIN_ONLY = ['module-manager', 'settings', 'employees', 'tasks', 'automation'];

  var Auth = {
    _user: null,

    /* Resolve & cache the current user (defaults to the owner) --------------*/
    current: function () {
      if (this._user) return this._user;
      // API MODE: the REAL signed-in user (Sanctum identity stored by api.js)
      // IS the current user — the EPL-0001 default and the View-As demo
      // impersonation below belong to demo mode only. scope 'group' (super
      // admin / no company) maps to the owner role; company-scoped users get
      // manager-of-their-company. (Old-DB numeric company ids will map to
      // company slugs in the backend identity when company logins land.)
      if (EPAL.api && EPAL.api.enabled && EPAL.api.enabled()) {
        var api = EPAL.api.user();
        if (api) {
          this._user = {
            id: 'API-' + api.id, name: api.name, email: api.email,
            role: api.scope === 'group' ? 'owner' : 'manager',
            companyId: api.companyId || 'group',
            accessLevel: 'full', permissions: [], _api: true
          };
          return this._user;
        }
      }
      var id = S.get(KEY, 'EPL-0001');
      this._user = EPAL.db.employee(id) || EPAL.db.employee('EPL-0001');
      // apply sensible default permissions/accessLevel if none stored
      if (this._user && !this._user.role) this._user.role = 'employee';
      return this._user;
    },

    setUser: function (id) {
      S.set(KEY, id);
      this._user = null;
      var u = this.current();
      bus.emit('auth:changed', { user: u });
      return u;
    },

    /* Convenience role/scoping checks --------------------------------------*/
    role: function () { return (this.current() || {}).role || 'employee'; },
    isOwner: function () { return this.role() === 'owner'; },
    isAdmin: function () { return ['owner', 'admin'].indexOf(this.role()) >= 0; },
    // The company a scoped role is confined to (managers/employees/etc.)
    homeCompany: function () {
      var u = this.current();
      return (u && u.companyId && u.companyId !== 'group') ? u.companyId : null;
    },
    // 'full' users see confidential finance; 'general' users don't.
    accessLevel: function () {
      var u = this.current();
      if (this.isAdmin() || this.role() === 'manager' || this.role() === 'accountant') return 'full';
      return (u && u.accessLevel) || 'general';
    },

    /* Can the user even see this company in the switcher? -------------------*/
    canCompany: function (companyId) {
      if (this.isAdmin()) return true;
      if (companyId === 'group') return true;               // everyone sees the group shell (limited)
      var home = this.homeCompany();
      return home ? home === companyId : true;
    },

    /* THE gate: may this user open company/module? -------------------------*/
    can: function (companyId, moduleId) {
      var u = this.current(); if (!u) return false;
      if (this.isAdmin()) return true;

      // explicit per-employee grants win
      var grants = u.permissions || [];
      if (grants.indexOf(companyId + '/' + moduleId) >= 0) return true;
      if (grants.indexOf(companyId + '/*') >= 0) return true;

      var role = this.role();

      // Group layer: only a few modules for non-admins, and only "general" ones.
      if (companyId === 'group') {
        if (GROUP_ADMIN_ONLY.indexOf(moduleId) >= 0) return false;
        return ['dashboard', 'notifications'].indexOf(moduleId) >= 0;
      }

      // Company scoping for non-admins.
      var home = this.homeCompany();
      if (home && home !== companyId) return false;

      if (role === 'manager') return moduleId !== 'settings';
      if (role === 'accountant') return ['dashboard','accounts','ledgers','reports','analytics'].indexOf(moduleId) >= 0;
      if (role === 'hr') return ['dashboard','hrm','reports'].indexOf(moduleId) >= 0;
      if (role === 'agent') return ['dashboard','crm','visa-processing','air-ticketing','customers','tasks'].indexOf(moduleId) >= 0;

      // plain employee → self-service only
      return ESS_MODULES.indexOf(moduleId) >= 0;
    },

    /* List roles for the demo "View As" switcher ---------------------------*/
    roles: [
      { key:'owner', label:'Owner (Super Admin)', icon:'stars' },
      { key:'admin', label:'Admin', icon:'shield-lock-fill' },
      { key:'manager', label:'Manager', icon:'person-badge-fill' },
      { key:'accountant', label:'Accountant', icon:'calculator' },
      { key:'hr', label:'HR', icon:'people-fill' },
      { key:'employee', label:'Employee (ESS)', icon:'person-workspace' },
      { key:'agent', label:'Travels Agent', icon:'airplane' }
    ],

    /* Demo helper: impersonate a role without changing the underlying record.
       Uses the demo developer for employee/agent so ESS has real task data.  */
    viewAs: function (roleKey) {
      var map = {
        owner: 'EPL-0001', admin: 'EPL-0001',
        employee: 'EPL-DEV1', agent: 'EPL-DEV1'
      };
      if (map[roleKey]) { this.setUser(map[roleKey]); this._user.role = roleKey; }
      else {
        // pick a representative employee for manager/accountant/hr
        var pool = EPAL.db.employees().filter(function (e) {
          return roleKey === 'accountant' ? e.dept === 'Accounts'
               : roleKey === 'manager' ? /Manager|Lead|Head/.test(e.designation)
               : true;
        });
        var e = pool[0] || EPAL.db.employee('EPL-DEV1');
        this.setUser(e.id); this._user.role = roleKey;
      }
      bus.emit('auth:changed', { user: this._user });
      return this._user;
    }
  };

  EPAL.auth = Auth;

})(window.EPAL = window.EPAL || {});
