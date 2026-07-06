/* ============================================================================
 * EPAL GROUP ERP  ·  core/search.js
 * ----------------------------------------------------------------------------
 * GLOBAL DATA SEARCH — EPAL.search.
 *
 * This engine owns NO store of its own. It is a pure read-model over the live
 * data already sitting in EPAL.store / EPAL.db. The Ctrl+K command palette in
 * core/app.js first lists matching MODULES (navigation), then appends the DATA
 * records this engine surfaces — so typing a customer name, a PNR, a passport
 * number, an invoice serial or a journal ref jumps you straight to the record's
 * owning module.
 *
 * WHAT IT SCANS (store  ->  deep-link route):
 *   customers            -> group/crm/customers
 *   leads                -> group/crm/leads
 *   visaApps             -> travels/visa-processing/application-board
 *   airTickets           -> travels/air-ticketing/manage-sales
 *   tv_files             -> travels/file-management
 *   tv_passports         -> travels/passport-mgmt
 *   employees            -> group/employees/directory
 *   sales                -> <companyId>/accounts
 *   documents            -> group/documents
 *   gl_entries           -> <companyId>/ledgers
 *   tv_contract_flights  -> travels/contract-flight/schedule
 *   sh_products          -> shop/inventory
 *
 * HOW IT RANKS: the query (lowercased) is tested against each record's most
 * identifying fields (name / title / id / pnr / passenger / applicant /
 * passport …). A hit's rank is the earliest index-of position across those
 * fields (an earlier match = a stronger match). Results are capped at 20 and
 * drawn ROUND-ROBIN across the categories, so one busy store can never crowd
 * out the rest. Every store scan is wrapped in try/catch, so a store that has
 * not been seeded yet simply contributes nothing.
 *
 * Each result: { label, sub, icon, route, accent } — the exact shape the
 * command palette renders (icon = a Bootstrap Icons name, accent = a colour).
 *
 * It self-registers with core/engines.js. seed() only stamps an idempotent
 * config marker (there is no data store); boot() is a no-op — every lookup is
 * lazy and pulls live data at call time.
 *
 * ES5 only (no arrow fns / let / const / template literals / classes). Never
 * write a literal star-slash inside this comment (it would close it).
 * ==========================================================================*/

(function (EPAL) {
  'use strict';

  var S = EPAL.store;

  var GROUP_GOLD = '#c8a24a';
  var CAP = 20;

  /* --- little helpers -----------------------------------------------------*/

  // Safe store read — never throws, always an array.
  function rows(key) {
    try { return S.list(key) || []; } catch (e) { return []; }
  }

  // Accent colour for a company id (falls back to group gold).
  function accentFor(cid) {
    try {
      var co = EPAL.config && EPAL.config.company ? EPAL.config.company(cid) : null;
      return (co && co.accent) || GROUP_GOLD;
    } catch (e) { return GROUP_GOLD; }
  }

  // Friendly company label for the result subtitle.
  function compName(cid) {
    try {
      var co = EPAL.config && EPAL.config.company ? EPAL.config.company(cid) : null;
      return (co && co.name) || 'Epal Group';
    } catch (e) { return 'Epal Group'; }
  }

  // Earliest index-of the query across a record's identifying fields.
  // Returns -1 when none of the fields contain the query.
  function matchPos(rec, fields, q) {
    var best = -1;
    for (var i = 0; i < fields.length; i++) {
      var v = rec[fields[i]];
      if (v == null) continue;
      var idx = String(v).toLowerCase().indexOf(q);
      if (idx >= 0 && (best < 0 || idx < best)) best = idx;
    }
    return best;
  }

  /* --- companyId resolvers (defensive) ------------------------------------*/
  function cidField(rec) { return (rec && rec.companyId) || 'group'; }
  function cidTravels() { return 'travels'; }
  function cidShop() { return 'shop'; }
  function cidCustomer(rec) {
    return (rec && rec.companyIds && rec.companyIds.length) ? rec.companyIds[0] : 'group';
  }

  /* --- the category descriptors -------------------------------------------
   * Each descriptor knows how to fetch its rows, which fields identify a
   * record, what to show, and where the record lives.                       */
  function descriptors() {
    return [
      { key: 'customers', type: 'Customer', icon: 'person-hearts',
        fields: ['name', 'contact', 'phone', 'email', 'id'],
        primary: function (r) { return r.name; },
        cid: cidCustomer,
        route: function () { return 'group/crm/customers'; } },

      { key: 'leads', type: 'Lead', icon: 'person-plus-fill',
        fields: ['name', 'source', 'id'],
        primary: function (r) { return r.name; },
        cid: cidField,
        route: function () { return 'group/crm/leads'; } },

      { key: 'visaApps', type: 'Visa Application', icon: 'passport-fill',
        fields: ['applicant', 'passport', 'country', 'phone', 'id'],
        primary: function (r) { return r.applicant; },
        cid: cidTravels,
        route: function () { return 'travels/visa-processing/application-board'; } },

      { key: 'airTickets', type: 'Air Ticket', icon: 'airplane-fill',
        fields: ['pnr', 'passenger', 'ticketNo', 'route', 'airline', 'id'],
        primary: function (r) { return r.passenger + ' · ' + r.pnr; },
        cid: cidTravels,
        route: function () { return 'travels/air-ticketing/manage-sales'; } },

      { key: 'tv_files', type: 'Embassy File', icon: 'folder-fill',
        fields: ['applicant', 'passport', 'country', 'id'],
        primary: function (r) { return r.applicant; },
        cid: cidTravels,
        route: function () { return 'travels/file-management'; } },

      { key: 'tv_passports', type: 'Passport', icon: 'person-vcard',
        fields: ['holder', 'passportNo', 'phone', 'id'],
        primary: function (r) { return r.holder + ' · ' + r.passportNo; },
        cid: cidTravels,
        route: function () { return 'travels/passport-mgmt'; } },

      { key: 'employees', type: 'Employee', icon: 'person-badge-fill',
        fields: ['name', 'designation', 'dept', 'email', 'id'],
        primary: function (r) { return r.name; },
        cid: cidField,
        route: function () { return 'group/employees/directory'; } },

      { key: 'sales', type: 'Sale', icon: 'cash-stack',
        fields: ['customer', 'desc', 'ref', 'id'],
        primary: function (r) { return (r.customer || r.desc || r.ref || r.id); },
        cid: cidField,
        route: function (r) { return cidField(r) + '/accounts'; } },

      { key: 'documents', type: 'Document', icon: 'file-earmark-richtext-fill',
        fields: ['title', 'serial', 'party', 'id'],
        primary: function (r) { return r.title; },
        cid: cidField,
        route: function () { return 'group/documents'; } },

      { key: 'gl_entries', type: 'Journal Entry', icon: 'journal-text',
        fields: ['ref', 'memo', 'party', 'id'],
        primary: function (r) { return (r.memo || r.ref || r.id); },
        cid: cidField,
        route: function (r) { return cidField(r) + '/ledgers'; } },

      { key: 'tv_contract_flights', type: 'Contract Flight', icon: 'airplane-engines',
        fields: ['airline', 'flightNo', 'route', 'category', 'id'],
        primary: function (r) { return r.airline + ' · ' + r.flightNo; },
        cid: cidTravels,
        route: function () { return 'travels/contract-flight/schedule'; } },

      { key: 'sh_products', type: 'Product', icon: 'box-seam',
        fields: ['name', 'sku', 'brand', 'category', 'id'],
        primary: function (r) { return r.name; },
        cid: cidShop,
        route: function () { return 'shop/inventory'; } }
    ];
  }

  /* ==========================================================================
   * PUBLIC API
   * ========================================================================*/

  // all(query) -> [{label, sub, icon, route, accent}]
  function all(query) {
    var q = String(query == null ? '' : query).toLowerCase().trim();
    if (!q) return [];

    var cats = descriptors();
    var perCat = [];

    cats.forEach(function (d) {
      var data = rows(d.key);
      var hits = [];
      try {
        for (var i = 0; i < data.length; i++) {
          var rec = data[i];
          if (!rec) continue;
          var pos = matchPos(rec, d.fields, q);
          if (pos < 0) continue;
          var cid = d.cid(rec);
          var label;
          try { label = d.primary(rec); } catch (e) { label = rec.id; }
          hits.push({
            label: String(label == null ? (rec.id || '') : label),
            sub: d.type + ' · ' + compName(cid),
            icon: d.icon,
            route: d.route(rec),
            accent: accentFor(cid),
            _pos: pos
          });
        }
      } catch (err) { hits = []; }   // a malformed store never breaks the search
      hits.sort(function (a, b) { return a._pos - b._pos; });
      perCat.push(hits);
    });

    // Round-robin across categories so no single store dominates the 20 slots.
    var out = [], round = 0, added = true;
    while (out.length < CAP && added) {
      added = false;
      for (var c = 0; c < perCat.length; c++) {
        var h = perCat[c][round];
        if (h) {
          delete h._pos;
          out.push(h);
          added = true;
          if (out.length >= CAP) break;
        }
      }
      round++;
    }
    return out;
  }

  EPAL.search = { all: all };

  /* ==========================================================================
   * ENGINE REGISTRATION
   * ========================================================================*/
  EPAL.registerEngine({
    name: 'search',
    seed: function () {
      // No data store — search computes on demand. Stamp an idempotent config
      // marker so the engine joins the seed lifecycle cleanly and survives
      // db.reset() via seedOnce.
      EPAL.store.seedOnce('search_config', {
        id: 'SR-01',
        cap: CAP,
        stores: ['customers', 'leads', 'visaApps', 'airTickets', 'tv_files',
                 'tv_passports', 'employees', 'sales', 'documents', 'gl_entries',
                 'tv_contract_flights', 'sh_products']
      });
    },
    boot: function () {
      // Nothing to wire — every lookup is lazy and reads live data at call time.
    }
  });

})(window.EPAL = window.EPAL || {});
