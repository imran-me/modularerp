/* ============================================================================
 * EPAL GROUP ERP  ·  core/auth.js
 * ----------------------------------------------------------------------------
 * IDENTITY · ROLES · PERMISSIONS · "VIEW AS".
 *
 * Employees ARE the users of this ERP (the owner adds an employee, assigns a
 * company + designation + role, and grants module permissions). This module
 * answers one central question everywhere in the app:
 *
 *      can this user open THIS company's THIS module?
 *
 * ROLE MODEL (coarse defaults; per-employee `permissions[]` can override):
 *   owner       → everything, all companies (that's you).
 *   admin       → everything except owner-only settings.
 *   manager     → their own company only; no group admin modules.
 *   accountant  → finance/accounts/ledgers/reports in their company + group finance (read).
 *   hr          → workforce/hrm/attendance/payroll.
 *   employee    → General Dashboard + their own Tasks + own Profile (ESS).  ← self-service
 *   agent       → (Travels) CRM + visa/ticketing services + own tasks.
 *
 * Fine-grained grants live on the employee record as:
 *   permissions: ['travels/visa-processing', 'group/dashboard', ...]
 *   accessLevel: 'full' | 'general'   (general = no confidential finance widgets)
 * ==========================================================================*/

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
