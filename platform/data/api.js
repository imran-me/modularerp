/* ============================================================================
 * EPAL GROUP ERP  ·  platform/data/api.js
 * ----------------------------------------------------------------------------
 * WHAT: THE REAL-DATA BRIDGE — connects the SPA's synchronous store to the
 *   modular Laravel backend (platform/backend + companies/x/modules/x/backend).
 *
 * HOW IT WORKS (the "load-at-boot" strategy — see docs/BACKEND-ARCHITECTURE):
 *   The whole app reads data synchronously (`db.col('coa')` returns instantly),
 *   500+ call sites across 50 files. Rewriting them async would be a rewrite of
 *   the app. Instead, at boot we fetch every REAL collection the backend serves
 *   (in parallel, one round-trip each) and write them into the same EPAL.store
 *   cache the app already reads. After hydration the app runs unchanged — same
 *   sync reads, real data underneath.
 *
 * MODES (decided once per page load, in this order):
 *   1. localStorage EPAL_API_BASE set  -> API mode against that base URL
 *      (local dev: SPA on one port, `php artisan serve` on another).
 *   2. same-origin /api/health responds -> API mode against '' (deployed case:
 *      Laravel serves BOTH the SPA and /api on dev.epal.com.bd).
 *   3. neither -> DEMO mode: exactly the old behaviour, seeded demo data.
 *      (This is why the static GitHub-Pages/dev site keeps working untouched.)
 *
 * TOKENS & IDENTITY live in NON-`epal.v1.` keys (EPAL_TOKEN / EPAL_USER):
 *   `store.nuke()` (the Reset-Data admin tool) wipes every `epal.*` key — a
 *   data reset must NOT log the user out or drop the API connection.
 *
 * WHAT HYDRATES: only stores whose module has a real `backend/` today
 *   (group + travels first — owner directive). Everything else stays absent in
 *   API mode, so screens without a backend render their honest empty states —
 *   real data is NEVER mixed with demo data.
 *
 * ==> LARAVEL MAPPING: login/logout/me = kernel AuthController (Sanctum);
 *     each HYDRATE entry = one module's GET route (see its backend/routes.php).
 * ==========================================================================*/
(function (EPAL) {
  'use strict';

  var TOKEN_KEY = 'EPAL_TOKEN', USER_KEY = 'EPAL_USER', BASE_KEY = 'EPAL_API_BASE';

  /* Which frontend store each backend endpoint fills. A module's backend/
   * serves data ALREADY IN the frontend shape (the controller is the
   * translation seam), so hydration is a plain write — no mapping here. */
  var HYDRATE = {
    coa:           'group/master-accounts/accounts',
    banks:         'group/master-accounts/banks',
    gl_entries:    'group/master-accounts/journals',
    customers:     'group/master-accounts/customers',
    suppliers:     'group/master-accounts/suppliers',
    acc_schedules: 'group/master-accounts/schedules',
    employees:     'group/employees/directory',
    airlines:      'travels/air-ticketing/airlines',
    airports:      'travels/air-ticketing/airports',
    air_purchases: 'travels/air-ticketing/purchases',
    visaCats:      'travels/visa-processing/categories',
    visaApps:      'travels/visa-processing/sales'
  };

  /* Stores with a WRITE endpoint (subset of HYDRATE — safe master data only;
   * ledger-affecting stores like coa/gl_entries stay read-only until the
   * corrected posting logic is built). Rolled out module by module. */
  var WRITABLE = {
    customers: 'group/master-accounts/customers',
    suppliers: 'group/master-accounts/suppliers',
    banks:     'group/master-accounts/banks',
    employees: 'group/employees/directory',
    airlines:  'travels/air-ticketing/airlines',
    airports:  'travels/air-ticketing/airports'
  };

  var mode = null;              // 'api' | 'demo' — resolved once by detect()

  function base() { return localStorage.getItem(BASE_KEY) || ''; }
  function token() { return localStorage.getItem(TOKEN_KEY) || null; }

  function headers() {
    var h = { 'Accept': 'application/json', 'Content-Type': 'application/json' };
    var t = token();
    if (t) h['Authorization'] = 'Bearer ' + t;
    return h;
  }

  // One fetch wrapper: JSON in/out, bearer token, 401 => throws {auth:true}
  // so boot can drop to the login screen instead of half-rendering.
  function call(path, opts) {
    opts = opts || {};
    return fetch(base() + '/api/' + path.replace(/^\/+/, ''), {
      method: opts.method || 'GET',
      headers: headers(),
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (res) {
      if (res.status === 401) { var e = new Error('unauthenticated'); e.auth = true; throw e; }
      return res.json().then(function (j) {
        if (!res.ok) { var er = new Error((j && j.message) || ('HTTP ' + res.status)); er.body = j; throw er; }
        return j;
      });
    });
  }

  var Api = {
    /* ---- mode ------------------------------------------------------------*/
    // Resolve api-vs-demo ONCE. Explicit base wins; else probe same-origin
    // /api/health (the deployed layout); else demo. Always resolves.
    detect: function () {
      if (mode) return Promise.resolve(mode);
      if (localStorage.getItem(BASE_KEY)) { mode = 'api'; return Promise.resolve(mode); }
      // Same-origin probe (the deployed layout). CRUCIAL: a static host with an
      // SPA catch-all answers /api/health with 200 index.html — so `res.ok` is
      // NOT enough. Require the kernel's exact JSON marker; anything else (HTML,
      // 404, network error) means "no backend here" -> demo. This is what keeps
      // the static GitHub-Pages / pre-deploy site safely in demo mode.
      return fetch('/api/health', { headers: { Accept: 'application/json' } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { mode = (j && j.service === 'epal-kernel') ? 'api' : 'demo'; return mode; })
        .catch(function () { mode = 'demo'; return mode; });
    },
    enabled: function () { return mode === 'api'; },

    /* ---- identity --------------------------------------------------------*/
    user: function () {
      try { return JSON.parse(localStorage.getItem(USER_KEY)) || null; }
      catch (e) { return null; }
    },
    login: function (email, password) {
      return call('login', { method: 'POST', body: { email: email, password: password } })
        .then(function (j) {
          localStorage.setItem(TOKEN_KEY, j.token);
          localStorage.setItem(USER_KEY, JSON.stringify(j.user));
          return j.user;
        });
    },
    logout: function () {
      var done = function () {
        localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY);
        location.reload();
      };
      return call('logout', { method: 'POST' }).then(done, done);   // clear even if the call fails
    },

    /* ---- hydration -------------------------------------------------------*/
    // Fetch every backed collection in parallel and write it into the store
    // cache the app reads. Missing/unbacked stores stay absent on purpose.
    // A single 401 aborts the whole boot to the login screen (stale token).
    hydrate: function () {
      var S = EPAL.store, keys = Object.keys(HYDRATE);
      var t0 = Date.now();
      return Promise.all(keys.map(function (key) {
        return call(HYDRATE[key]).then(function (j) {
          S.set(key, j.data || []);
          return { key: key, n: (j.data || []).length };
        }, function (err) {
          if (err.auth) throw err;                  // stale token — abort to login
          return { key: key, n: -1, err: String(err.message || err) };   // one endpoint down ≠ dead app
        });
      })).then(function (results) {
        var report = { ms: Date.now() - t0, loaded: {}, failed: {} };
        results.forEach(function (r) {
          if (r.n >= 0) report.loaded[r.key] = r.n; else report.failed[r.key] = r.err;
        });
        try { console.info('[api] hydrated in ' + report.ms + 'ms', report.loaded, Object.keys(report.failed).length ? report.failed : ''); } catch (e) {}
        return report;
      });
    },

    call: call,           // exposed for module screens' future write paths

    /* ---- write-through ----------------------------------------------------
     * Hooks the SAME bus event every db.save(name,record) / db.remove(name,id)
     * call already emits (see platform/data/database.js: db.save/db.remove
     * and the specific saveXxx helpers) — so wiring a store into WRITABLE is
     * the only change needed; no call site anywhere in the app is touched.
     * Only fires in API mode; call once, after EPAL.bus exists (core/app.js
     * start()). Local store stays optimistic; on a create, the client's temp
     * id is swapped for the server's real id once the response comes back —
     * on failure the temp record is rolled back and the user is told. */
    wireWrites: function () {
      var S = EPAL.store;
      EPAL.bus.on('data:changed', function (e) {
        var path = WRITABLE[e.store];
        if (!path) return;                 // not a writable store — read-only for now
        if (e.action === 'upsert') {
          var before = e.record.id;
          call(path, { method: 'POST', body: e.record }).then(function (j) {
            if (j.data && j.data.id && j.data.id !== before) {
              S.removeFrom(e.store, before);   // temp client id -> real server id
            }
            if (j.data) S.upsert(e.store, j.data);
          }, function (err) {
            S.removeFrom(e.store, before);     // roll back the optimistic local write
            EPAL.bus.emit('notify', { text: 'Save failed: ' + (err.message || err), level: 'danger', title: 'Not saved' });
          });
        } else if (e.action === 'delete') {
          call(path + '/' + e.id, { method: 'DELETE' }).catch(function (err) {
            EPAL.bus.emit('notify', { text: 'Delete failed: ' + (err.message || err), level: 'danger', title: 'Not deleted' });
          });
        }
      });
    }
  };

  EPAL.api = Api;
})(window.EPAL);
