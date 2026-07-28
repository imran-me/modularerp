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
    bank_txns:     'group/master-accounts/bank-transactions',   // read always; WRITES are conditional — see CONDITIONAL
    customers:     'group/master-accounts/customers',
    suppliers:     'group/master-accounts/suppliers',
    acc_schedules: 'group/master-accounts/schedules',
    employees:     'group/employees/directory',
    perf_reviews:  'group/employees/reviews',
    airlines:      'travels/air-ticketing/airlines',
    airports:      'travels/air-ticketing/airports',
    air_purchases: 'travels/air-ticketing/purchases',
    visaCats:      'travels/visa-processing/categories',
    visaApps:      'travels/visa-processing/sales',
    tv_passports:  'travels/passport-mgmt/passports',
    tv_files:      'travels/file-management/files',
    party_types:   'group/master-accounts/party-types',
    exp_categories: 'group/master-accounts/expense-categories',
    acc_entries:   'group/master-accounts/entries',
    loan_products: 'group/master-accounts/loans/products',
    loans_ext:     'group/master-accounts/loans/ext',
    loans_taken:   'group/master-accounts/loans/taken',
    loan_txns:     'group/master-accounts/loans/txns',
    pay_templates: 'group/master-accounts/payroll/templates',
    pay_runs:      'group/master-accounts/payroll/runs',
    pay_slips:     'group/master-accounts/payroll/slips',
    pay_txns:      'group/master-accounts/payroll/txns',
    tv_recurring:  'travels/accounts/books/recurring',
    tv_cheques:    'travels/accounts/books/cheques',
    tv_petty:      'travels/accounts/books/petty',
    tv_campaigns:  'travels/marketing/books/campaigns',
    tv_templates:  'travels/marketing/books/templates',
    tv_messages:   'travels/marketing/books/messages',
    tv_bot_bookings: 'travels/marketing/books/bookings',
    tv_bot_chat:   'travels/marketing/books/chat',
    tv_automation: 'travels/automation/books/rules',
    tv_markup:     'travels/automation/books/markup',
    tv_contracts:  'travels/contract-file/contracts',
    leads:         'travels/crm/books/leads',
    crm_activities: 'travels/crm/books/activities',
    tv_contract_flights: 'travels/contract-flight/flights',
    tv_leaves:     'travels/hrm/leaves',
    tv_agents:     'travels/vendor-agent/books/agents',
    vendors:       'travels/vendor-agent/books/vendors',
    party_txns:    'travels/vendor-agent/books/party-txns',
    tv_comm_paid:  'travels/vendor-agent/books/commissions',
    tv_portals:    'travels/vendor-agent/books/portals',
    wa_materials:  'woodart/materials/stock',
    wa_clients:    'woodart/clients/directory',
    wa_purchases:  'woodart/procurement/orders',
    wa_vendors:    'woodart/procurement/vendors',
    wa_production: 'woodart/production/jobs',
    wa_installs:   'woodart/installation/installs',
    wa_drawings:   'woodart/design/drawings',
    wa_revisions:  'woodart/design/revisions',
    wa_movements:  'woodart/materials/movements',
    wa_locations:  'woodart/materials/locations',
    // READ-ONLY (absent from WRITABLE and CONDITIONAL on purpose): the portfolio
    // screen still writes through EPAL.db to localStorage until the projects
    // module gets its own build slot. Hydrating the reads is what stops eight
    // seeded projects sitting in MySQL behind no route — the state that made a
    // migrated host show "No projects yet".
    wa_projects:   'woodart/projects/portfolio',
    wa_estimates:  'woodart/projects/estimates'
  };

  /* Stores with a WRITE endpoint (subset of HYDRATE — safe master data only;
   * ledger-affecting stores like coa/gl_entries stay read-only until the
   * corrected posting logic is built). Rolled out module by module. */
  var WRITABLE = {
    coa:       'group/master-accounts/accounts',   // ADD a chart-of-accounts head only (definition, not a posting) — via db.save('coa', rec)
    // Journal entries (deposits, withdrawals, manual journals, mirrors) now
    // persist to the DB (JournalController::store) — idempotent by client id,
    // so transactions survive a reload instead of living only in the browser.
    gl_entries: 'group/master-accounts/journals',
    // bank_txns is NOT here: it is CONDITIONALLY writable — see CONDITIONAL below.
    customers: 'group/master-accounts/customers',
    suppliers: 'group/master-accounts/suppliers',
    banks:     'group/master-accounts/banks',
    employees: 'group/employees/directory',
    airlines:  'travels/air-ticketing/airlines',
    airports:  'travels/air-ticketing/airports',
    air_purchases: 'travels/air-ticketing/purchases',
    visaCats:  'travels/visa-processing/categories',
    visaApps:  'travels/visa-processing/sales',
    acc_schedules: 'group/master-accounts/schedules',
    party_types: 'group/master-accounts/party-types',
    exp_categories: 'group/master-accounts/expense-categories',
    acc_entries: 'group/master-accounts/entries',
    loan_products: 'group/master-accounts/loans/products',
    loans_ext:   'group/master-accounts/loans/ext',
    loans_taken: 'group/master-accounts/loans/taken',
    loan_txns:   'group/master-accounts/loans/txns',
    pay_templates: 'group/master-accounts/payroll/templates',
    pay_runs:    'group/master-accounts/payroll/runs',
    pay_slips:   'group/master-accounts/payroll/slips',
    pay_txns:    'group/master-accounts/payroll/txns',
    tv_recurring: 'travels/accounts/books/recurring',
    tv_cheques:  'travels/accounts/books/cheques',
    tv_petty:    'travels/accounts/books/petty',
    tv_campaigns: 'travels/marketing/books/campaigns',
    tv_templates: 'travels/marketing/books/templates',
    tv_messages: 'travels/marketing/books/messages',
    tv_bot_bookings: 'travels/marketing/books/bookings',
    tv_bot_chat: 'travels/marketing/books/chat',
    tv_automation: 'travels/automation/books/rules',
    tv_markup:   'travels/automation/books/markup',
    tv_contracts: 'travels/contract-file/contracts',
    leads:       'travels/crm/books/leads',
    crm_activities: 'travels/crm/books/activities',
    tv_contract_flights: 'travels/contract-flight/flights',
    tv_leaves:   'travels/hrm/leaves',
    tv_agents:   'travels/vendor-agent/books/agents',
    vendors:     'travels/vendor-agent/books/vendors',
    party_txns:  'travels/vendor-agent/books/party-txns',
    tv_comm_paid: 'travels/vendor-agent/books/commissions',
    tv_portals:  'travels/vendor-agent/books/portals',
    perf_reviews: 'group/employees/reviews',
    // NOTE: the six Woodart stores are NOT here. Their tables ship as module
    // migrations that no host has necessarily run yet, so they are CONDITIONAL
    // (below) — writable only once the server says the table exists.
  };

  /* Stores whose WRITE side depends on the server actually having their table.
   * ------------------------------------------------------------------------
   * `bank_txns` is the case (owner 2026-07-26). Its log table ships as a
   * migration (platform/backend/database/migrations/2026_07_22_100000), but the
   * shared live DB denies DDL at request time, so on a host that never ran
   * `php artisan migrate` the table is simply absent — and blind POSTing into it
   * is what caused the old save-fail → rollback → re-render LOOP. Hence:
   *   · it hydrates like any other store (an unprovisioned host answers with an
   *     empty list, which costs nothing and mixes in no demo data), and
   *   · its endpoint reports `provisioned: true|false`, which is the ONLY thing
   *     that promotes it into WRITABLE below.
   * So the bank movement log starts persisting BY ITSELF the moment the table is
   * provisioned — no code change, no redeploy, and no loop if it never is. */
  var CONDITIONAL = {
    bank_txns:    'group/master-accounts/bank-transactions',
    /* The Woodart modules (2026-07-27). Every one of their tables arrives as a
     * module migration, so on a host that has pulled the code but not run
     * `php artisan migrate` they are simply absent. Listing them here instead
     * of in WRITABLE is what stops the exact failure the owner reported: a
     * saved workshop job that vanishes on reload. */
    wa_materials: 'woodart/materials/stock',
    wa_clients:   'woodart/clients/directory',
    wa_purchases: 'woodart/procurement/orders',
    wa_vendors:   'woodart/procurement/vendors',
    wa_production:'woodart/production/jobs',
    wa_installs:  'woodart/installation/installs',
    wa_drawings:  'woodart/design/drawings',
    wa_revisions: 'woodart/design/revisions',
    wa_movements: 'woodart/materials/movements',
    wa_locations: 'woodart/materials/locations'
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
      /* THROTTLED, and this matters on real hosting.
       *
       * This used to be Promise.all over every key — 30+ requests fired at
       * once. Shared hosting caps concurrent PHP workers and MySQL connections,
       * and when that cap is hit PDO throws "Operation not permitted", which
       * this app's exception handler dresses up as "Database rejected the
       * write" and returns as a 422. The result on dev.epal.com.bd was a
       * random third of the stores failing on EVERY boot — scattered across
       * woodart, travels and group — while the rest loaded fine. It reads
       * exactly like a per-module bug and is not one: the same endpoint
       * succeeds on its own and fails in a crowd.
       *
       * A small pool plus ONE retry fixes it without touching any endpoint.
       * Boot is marginally slower and actually completes. */
      var POOL = 3, RETRIES = 3, RETRY_MS = 300;

      function fetchStore(key, attempt) {
        return call(HYDRATE[key]).then(function (j) {
          // A CONDITIONAL store whose table the server does NOT have is, for this
          // host, a module with no backend at all — and this file's rule for
          // those is that they keep their existing data rather than being
          // emptied. Writing the endpoint's empty list over the top instead was
          // the second half of the vanishing-data bug: hydration blanked the
          // register on every boot, so even a save that HAD worked looked lost.
          var unprovisioned = CONDITIONAL[key] && !j.provisioned;
          if (!unprovisioned) S.set(key, j.data || []);
          // a CONDITIONAL store is promoted to writable only if the server says
          // its table is really there (see CONDITIONAL)
          if (CONDITIONAL[key] && j.provisioned) WRITABLE[key] = CONDITIONAL[key];
          return { key: key, n: unprovisioned ? 0 : (j.data || []).length, writable: !!WRITABLE[key] };
        }, function (err) {
          if (err.auth) throw err;                  // stale token — abort to login
          // A resource-limit refusal is transient by definition: the same call
          // succeeds once the crowd thins. Retry once before giving up, so a
          // momentary squeeze does not blank a store for the whole session.
          // EXPONENTIAL backoff, not a fixed pause. The host refuses the
          // connection because it is saturated (observed load average ~50), so
          // retrying immediately just adds to the pile-up that caused the
          // refusal. Waiting progressively longer is the only thing that
          // actually clears it. 300ms, then 900ms, then 2.7s.
          if (attempt < RETRIES) {
            var wait = RETRY_MS * Math.pow(3, attempt);
            return new Promise(function (go) { setTimeout(go, wait); })
              .then(function () { return fetchStore(key, attempt + 1); });
          }
          return { key: key, n: -1, err: String(err.message || err) };   // one endpoint down ≠ dead app
        });
      }

      // A fixed number of workers draining one shared queue — the simplest
      // concurrency limiter that needs no library.
      var queue = keys.slice(), results = [];

      function worker() {
        var key = queue.shift();
        if (!key) return Promise.resolve();
        return fetchStore(key, 0).then(function (r) { results.push(r); return worker(); });
      }

      var workers = [];
      for (var w = 0; w < Math.min(POOL, keys.length); w++) workers.push(worker());

      return Promise.all(workers).then(function () {
        var report = { ms: Date.now() - t0, loaded: {}, failed: {}, readOnly: [] };
        results.forEach(function (r) {
          if (r.n >= 0) report.loaded[r.key] = r.n; else report.failed[r.key] = r.err;
          if (r.n >= 0 && CONDITIONAL[r.key] && !r.writable) report.readOnly.push(r.key);
        });
        try {
          console.info('[api] hydrated in ' + report.ms + 'ms', report.loaded, Object.keys(report.failed).length ? report.failed : '');
          // say it out loud: this store reads but cannot save until its table is
          // migrated — silence here is what made the gap hard to spot before
          if (report.readOnly.length) console.warn('[api] read-only until migrated (run: php artisan migrate): ' + report.readOnly.join(', '));
        } catch (e) {}
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
      // SAY OUT LOUD that this browser is talking to a real database. Code that
      // may only use data the SERVER already knows about has to be able to ask:
      // the chart of accounts is hydrated from the host, so inventing a code the
      // host has never heard of gets the whole journal refused (live 2026-07-28,
      // "Save failed: Unknown account code: 1010-4"). See EPAL.pay.subAcct.
      EPAL.api.live = true;
      // one notice per store, not one per save — a bookkeeper entering twenty
      // expenses should not be told twenty times that the table needs migrating
      var warned = {};
      function warnUnprovisioned(store, message) {
        if (warned[store]) return;
        warned[store] = true;
        var text = message || ('“' + store + '” is not migrated on the server yet — entries stay in this browser. Run: php artisan migrate');
        try { console.warn('[api] ' + store + ': ' + text); } catch (e) {}
        EPAL.bus.emit('notify', { text: text, level: 'warning', title: 'Saved in this browser only' });
      }
      EPAL.bus.on('data:changed', function (e) {
        var path = WRITABLE[e.store];
        if (!path) return;                 // not a writable store — read-only for now
        if (e.local) return;               // DERIVED entry (bank-opening / historical
                                           // mirror), recomputed each load from a store
                                           // that already persists — never a DB write.
        if (e.action === 'upsert') {
          var before = e.record.id;
          call(path, { method: 'POST', body: e.record }).then(function (j) {
            // THE SERVER ISN'T READY (a table this deploy hasn't migrated yet) is NOT
            // a rejection. It used to be treated as one: the row was rolled back and
            // the user watched a just-recorded expense vanish, register reading "No
            // entries yet" (owner, live, 2026-07-27). The endpoint now answers
            // provisioned:false instead, and we KEEP the optimistic row — the app
            // stays usable browser-side — and say so once, plainly.
            if (j && j.provisioned === false) { warnUnprovisioned(e.store, j.message); return; }
            if (j.data && j.data.id && j.data.id !== before) {
              S.removeFrom(e.store, before);   // temp client id -> real server id
              if (j.data) S.upsert(e.store, j.data);
              // The optimistic row still carries the TEMP id on screen; re-render
              // so the list shows the server-confirmed record (real id) and later
              // row-actions target it, not the now-removed temp id.
              if (EPAL.router && EPAL.router.render) EPAL.router.render();
            } else if (j.data) {
              S.upsert(e.store, j.data);       // same id — in-place refresh, no re-render needed
            }
          }, function (err) {
            S.removeFrom(e.store, before);     // roll back the optimistic local write
            EPAL.bus.emit('notify', { text: 'Save failed: ' + (err.message || err), level: 'danger', title: 'Not saved' });
            // Re-render so the rolled-back row actually disappears from the screen
            // — otherwise the UI keeps showing a record the server rejected, which
            // is exactly the "it said saved but never persisted" confusion.
            if (EPAL.router && EPAL.router.render) EPAL.router.render();
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
