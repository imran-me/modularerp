/* ============================================================================
 * EPAL GROUP ERP  ·  assets/js/engines/permissions.js
 * ----------------------------------------------------------------------------
 * WHAT: EPAL.perm — ACTION-LEVEL PERMISSIONS layered on top of EPAL.auth.
 *   auth.js answers the coarse question "may this user OPEN company/module?".
 *   This engine refines it to "may this user perform THIS ACTION here?", where
 *   an action is one of view / create / edit / delete / export / approve. Each
 *   role has a grant map ("companyId/moduleId" -> allowed actions), and can()
 *   is the single gate the view layer and destructive buttons consult.
 *
 * DATA IT OWNS (localStorage stores):
 *   role_templates — [{ id:string, role:string, label:string, desc:string,
 *                       grants:{ "companyId/moduleId": ['view','create','edit',
 *                         'delete','export','approve'] | '*' } }]
 *     Grant keys support wildcards in BOTH slots — "company/module",
 *     "company/*", "* /module", "* /*", "*" (spaced here to avoid star-slash).
 *
 * BUSINESS RULES (the "why" a developer must preserve):
 *   - ADVISORY / NON-BREAKING: this must never dead-end the "View As" demo, so
 *     can() FAILS OPEN — any error, and any unknown/non-destructive action,
 *     returns true.
 *   - owner/admin BYPASS everything (auth.isAdmin() short-circuits).
 *   - VIEW falls back to auth.can(): anything a role can SEE today stays visible
 *     even without a fine-grained grant.
 *   - ONLY destructive actions are truly enforced: delete/approve are hard-denied
 *     for a non-admin with no covering grant. create/edit/export stay advisory.
 *   - MOST-SPECIFIC KEY WINS: lookupGrant() tries exact company/module first,
 *     then progressively broader wildcards.
 *   - Seed templates are deterministic (fixed ids) and idempotent (seedOnce).
 *
 * PUBLIC API (window.EPAL.perm):
 *   actions -> ['view','create','edit','delete','export','approve'] (the vocab).
 *   can(companyId, moduleId, action) -> bool — the gate (never throws).
 *   templates() -> all role templates.
 *   template(role) -> one role's template (synthesised from defaults if absent).
 *   setTemplate(role, grants) -> row — persist a role's grant map; emits change.
 *
 * ==> LARAVEL / PHP MAPPING: Gates/Policies. Each action maps to an ability
 *     (viewAny/create/update/delete/export/approve on a per-module Policy).
 *     role_templates becomes a roles+permissions store (e.g. spatie/laravel-
 *     permission) or a config-driven Gate::define. can() = Gate::allows(); the
 *     "admin bypass" = Gate::before(); "view falls back to coarse auth" and
 *     "fail open" become explicit before/after hooks. setTemplate() = an admin
 *     controller writing the role's permission set.
 * ==========================================================================*/

(function (EPAL) {
  'use strict';

  var STORE = 'role_templates';

  // The full, ordered action vocabulary the view layer codes against.
  var ACTIONS = ['view', 'create', 'edit', 'delete', 'export', 'approve'];
  // Actions we actually enforce (default-deny) for a non-admin lacking a grant.
  var DESTRUCTIVE = ['delete', 'approve'];

  /* --------------------------------------------------------------------------
   * DEFAULT ROLE TEMPLATES (seed) — Bangladesh-context, all 7 roles.
   * Every row carries a fixed `id` so the seed is deterministic across reloads.
   * owner/admin get a conceptual wildcard row (isAdmin() short-circuits can()
   * anyway, but the row keeps the Settings > Roles screen honest & editable).
   * ------------------------------------------------------------------------*/
  function defaultTemplates() {
    return [
      {
        id: 'RT-owner', role: 'owner',
        label: 'Owner (Super Admin)',
        desc: 'Unrestricted across the entire group.',
        grants: { '*/*': '*' }
      },
      {
        id: 'RT-admin', role: 'admin',
        label: 'Admin',
        desc: 'Everything except owner-only group settings.',
        grants: { '*/*': '*' }
      },
      {
        id: 'RT-manager', role: 'manager',
        label: 'Manager',
        desc: 'Runs their company — view, create, edit, export & approve; no deletes.',
        grants: {
          '*/*': ['view', 'create', 'edit', 'export', 'approve']
        }
      },
      {
        id: 'RT-accountant', role: 'accountant',
        label: 'Accountant',
        desc: 'Full finance, accounts & ledgers; approves payments.',
        grants: {
          'group/finance':  ['view', 'create', 'edit', 'export', 'approve'],
          'group/reports':  ['view', 'export'],
          'group/dashboard':['view'],
          '*/accounts':     ['view', 'create', 'edit', 'export', 'approve'],
          '*/ledgers':      ['view', 'create', 'edit', 'export'],
          '*/reports':      ['view', 'export'],
          '*/analytics':    ['view', 'export'],
          '*/dashboard':    ['view']
        }
      },
      {
        id: 'RT-hr', role: 'hr',
        label: 'HR',
        desc: 'Manages workforce; creates & edits employees, approves leaves.',
        grants: {
          'group/employees':['view', 'create', 'edit', 'export', 'approve'],
          'group/reports':  ['view', 'export'],
          'group/dashboard':['view'],
          '*/hrm':          ['view', 'create', 'edit', 'export', 'approve'],
          '*/reports':      ['view', 'export'],
          '*/dashboard':    ['view']
        }
      },
      {
        id: 'RT-employee', role: 'employee',
        label: 'Employee (ESS)',
        desc: 'Self-service — own dashboard & own task board only.',
        grants: {
          '*/dashboard':['view'],
          '*/tasks':    ['view', 'create']
        }
      },
      {
        id: 'RT-agent', role: 'agent',
        label: 'Travels Agent',
        desc: 'Travels front-desk — air ticketing, visa processing & customers.',
        grants: {
          'travels/dashboard':       ['view'],
          'travels/air-ticketing':   ['view', 'create'],
          'travels/visa-processing': ['view', 'create'],
          'travels/customers':       ['view', 'create'],
          'travels/tasks':           ['view', 'create']
        }
      }
    ];
  }

  /* --------------------------------------------------------------------------
   * Grant lookup — most-specific key wins, wildcards allowed in both slots.
   * Returns the grant value (array or '*') or null when nothing matches.
   * ------------------------------------------------------------------------*/
  function lookupGrant(grants, companyId, moduleId) {
    if (!grants) return null;
    var keys = [
      companyId + '/' + moduleId,
      companyId + '/*',
      '*/' + moduleId,
      '*/*',
      '*'
    ];
    for (var i = 0; i < keys.length; i++) {
      if (Object.prototype.hasOwnProperty.call(grants, keys[i])) return grants[keys[i]];
    }
    return null;
  }

  function grantAllows(grant, action) {
    if (!grant) return false;
    if (grant === '*') return true;
    if (Object.prototype.toString.call(grant) === '[object Array]') {
      return grant.indexOf('*') >= 0 || grant.indexOf(action) >= 0;
    }
    return false;
  }

  /* ==========================================================================
   * PUBLIC API — EPAL.perm
   * ========================================================================*/
  var Perm = {

    // The action vocabulary (view layer iterates this to render check-grids).
    actions: ACTIONS,

    /* All role templates (array of {id, role, label, desc, grants}). --------*/
    templates: function () {
      var rows = EPAL.store.list(STORE);
      return (rows && rows.length) ? rows : defaultTemplates();
    },

    /* One role's template (falls back to a default or an empty grant map). --*/
    template: function (role) {
      role = role || 'employee';
      var rows = this.templates();
      var found = null;
      rows.forEach(function (r) { if (r.role === role) found = r; });
      if (found) return found;
      // synthesise from defaults if the store was seeded before this role existed
      var defs = defaultTemplates(), fromDef = null;
      defs.forEach(function (r) { if (r.role === role) fromDef = r; });
      return fromDef || { id: 'RT-' + role, role: role, label: role, grants: {} };
    },

    /* Persist a role's grant map (Settings > Roles editor). Emits change. ---*/
    setTemplate: function (role, grants) {
      if (!role) return null;
      var tpl = this.template(role);
      var row = {
        id: tpl.id || ('RT-' + role),
        role: role,
        label: tpl.label || role,
        desc: tpl.desc || '',
        grants: grants || {}
      };
      EPAL.store.upsert(STORE, row);
      if (EPAL.bus) {
        EPAL.bus.emit('permissions:changed', { role: role });
        EPAL.bus.emit('data:changed', { store: STORE, action: 'upsert', record: row });
      }
      return row;
    },

    /* ----------------------------------------------------------------------
     * THE GATE: may the current user perform `action` on company/module?
     * Never throws. owner/admin ⇒ always true. view ⇒ falls back to auth.can
     * so nothing visible today disappears. Non-admin without a grant is
     * denied ONLY for destructive actions; everything else stays advisory.
     * --------------------------------------------------------------------*/
    can: function (companyId, moduleId, action) {
      action = action || 'view';
      try {
        var auth = EPAL.auth;

        // owner / admin bypass everything.
        if (auth && auth.isAdmin && auth.isAdmin()) return true;

        var role = (auth && auth.role) ? auth.role() : 'employee';
        var grants = this.template(role).grants || {};
        var grant = lookupGrant(grants, companyId, moduleId);

        // Explicit grant that covers this action → allow.
        if (grantAllows(grant, action)) return true;

        // VIEW: defer to the coarse auth gate so today's visible screens stay
        // visible even without a fine-grained grant.
        if (action === 'view') {
          if (auth && auth.can) return !!auth.can(companyId, moduleId);
          return true;
        }

        // Destructive actions with no covering grant → hard deny (the only
        // place this engine actually restricts a non-admin).
        if (DESTRUCTIVE.indexOf(action) >= 0) return false;

        // create / edit / export and any unknown action → advisory allow so
        // the demo never dead-ends.
        return true;
      } catch (e) {
        // Fail OPEN — permissions must never brick the demo.
        return true;
      }
    }
  };

  EPAL.perm = Perm;

  /* ==========================================================================
   * ENGINE REGISTRATION — seed idempotently, no boot work required.
   * ========================================================================*/
  EPAL.registerEngine({
    name: 'permissions',
    seed: function () {
      EPAL.store.seedOnce(STORE, defaultTemplates());
    },
    boot: function () {
      // Nothing to wire at boot — the gate is consulted lazily by views and
      // destructive buttons. Kept for symmetry / future audit hooks.
    }
  });

})(window.EPAL = window.EPAL || {});
