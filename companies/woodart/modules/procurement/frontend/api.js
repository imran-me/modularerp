/* ============================================================================
 * WOODART · PROCUREMENT · DATA SEAM
 * ----------------------------------------------------------------------------
 * THE ONLY FILE IN THIS MODULE THAT KNOWS WHERE PROCUREMENT DATA COMES FROM.
 *
 * The screen calls `Procurement.orders()` / `Procurement.vendors()`. It does
 * not know, and must never learn, whether that resolves to localStorage (demo
 * mode) or to GET /api/woodart/procurement/... (API mode). When Laravel goes
 * live the screen is not edited at all.
 *
 * READS  — platform/data/api.js hydrates `wa_purchases` and `wa_vendors` at
 *          boot into the same EPAL.store cache `db.col()` reads.
 * WRITES — both stores are in api.js WRITABLE, so edits persist.
 *
 * THIS MODULE OWNS TWO STORES AND ONE JOIN
 * ---------------------------------------------------------------------------
 * `wa_purchases` (the orders) and `wa_vendors` (who we buy from). Orders
 * reference a vendor by NAME — that is how `wa_purchases` was already built and
 * this module does not rewrite it (R2) — so the order→vendor join is a
 * normalised name match through ONE function, `key()`. Identical rule to the
 * Clients module's client→project join, and mirrored server-side in
 * ProcurementService::matchKey(). If it ever becomes a real foreign key, this
 * file is the only place that changes on the client.
 *
 * THE RECORD SHAPES (seeded by platform/data/seed-bd.js; the exact shapes the
 * Laravel Resources return — see backend/endpoints.md):
 *   order  { id:'WPO-001', supplier:'Akij Board', items:7, amount:180000,
 *            status:'Ordered', date:'2026-05-02', created:'2026-05-02' }
 *   vendor { id:'VEN-001', name:'Akij Board', category:'Board',
 *            contact:'Omar Faruk', phone:'+8801812345678',
 *            email:'akij.board@supply.example.bd', area:'Tejgaon I/A',
 *            terms:'Net 30', since:'2024-11-02', created:'2026-05-14' }
 * ==========================================================================*/

/* Emitted FIRST inside the module IIFE (build-module.mjs), so this file owns the
 * shared bindings; frontend/procurement.js adds only its view-layer ones. */
var EPAL = window.EPAL, db = EPAL.db;

var ORDERS = 'wa_purchases';   /* ← the one place these collections are named */
var VENDORS = 'wa_vendors';

/* The order lifecycle and the vendor categories. The backend validates against
 * the same lists — two halves of one contract (backend/endpoints.md). */
var STATUSES = ['Ordered', 'Partial', 'Received'];
var CATEGORIES = ['Board', 'Laminate', 'Hardware', 'Adhesive', 'Finish', 'Fabric', 'General'];
var TERMS = ['Advance', 'Net 15', 'Net 30', 'Net 45'];

/** Normalise a vendor name for matching. ONE definition, so the order register,
 *  the vendor directory and the spend roll-up can never disagree. */
function key(name) { return String(name || '').trim().toLowerCase(); }

var Procurement = {

  statuses: function () { return STATUSES.slice(); },
  categories: function () { return CATEGORIES.slice(); },
  terms: function () { return TERMS.slice(); },

  /** THE outstanding rule, defined once: anything not fully Received is owed. */
  isOpen: function (o) { return o.status !== 'Received'; },

  /** Every purchase order, newest first. */
  orders: function () {
    return db.col(ORDERS).slice().sort(function (a, b) {
      return String(b.date || '').localeCompare(String(a.date || ''));
    });
  },

  order: function (id) {
    return db.col(ORDERS).filter(function (o) { return o.id === id; })[0] || null;
  },

  /** Every vendor, A→Z by name. */
  vendors: function () {
    return db.col(VENDORS).slice().sort(function (a, b) {
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
  },

  vendor: function (id) {
    return db.col(VENDORS).filter(function (v) { return v.id === id; })[0] || null;
  },

  /** The vendor record behind an order's supplier name, or null if unknown. */
  vendorOf: function (order) {
    var k = key(order.supplier);
    return db.col(VENDORS).filter(function (v) { return key(v.name) === k; })[0] || null;
  },

  /** Vendor names in use, for the order form's picker. */
  vendorNames: function () {
    return Procurement.vendors().map(function (v) { return v.name; });
  },

  /** Every vendor with their orders rolled up — the directory and spend rows. */
  withSpend: function (vendor) {
    var k = key(vendor.name);
    var mine = db.col(ORDERS).filter(function (o) { return key(o.supplier) === k; });
    var value = 0, outstanding = 0, received = 0, items = 0, last = '';
    mine.forEach(function (o) {
      var amt = +o.amount || 0;
      value += amt;
      items += (+o.items || 0);
      if (Procurement.isOpen(o)) outstanding += amt; else received += amt;
      if (String(o.date || '') > last) last = String(o.date || '');
    });
    return {
      id: vendor.id, name: vendor.name, category: vendor.category, terms: vendor.terms,
      contact: vendor.contact, phone: vendor.phone, email: vendor.email, area: vendor.area,
      orders: mine.length, items: items, value: value,
      received: received, outstanding: outstanding, last: last || null
    };
  },

  /** Every vendor with spend, highest first. */
  spendByVendor: function () {
    return Procurement.vendors().map(Procurement.withSpend)
      .sort(function (a, b) { return b.value - a.value; });
  },

  /** Order value grouped by vendor CATEGORY, largest first. An order whose
   *  supplier has no vendor record is counted as 'Unlisted' rather than being
   *  silently dropped — money that left the business must always show up. */
  spendByCategory: function () {
    var byName = {};
    db.col(VENDORS).forEach(function (v) { byName[key(v.name)] = v.category || 'General'; });
    var acc = {};
    db.col(ORDERS).forEach(function (o) {
      var cat = byName[key(o.supplier)] || 'Unlisted';
      if (!acc[cat]) acc[cat] = { name: cat, orders: 0, value: 0 };
      acc[cat].orders += 1;
      acc[cat].value += (+o.amount || 0);
    });
    return Object.keys(acc).map(function (k) { return acc[k]; })
      .sort(function (a, b) { return b.value - a.value; });
  },

  /** The header figures every screen quotes. One calculation, one truth. */
  summary: function () {
    var os = db.col(ORDERS);
    var value = 0, received = 0, outstanding = 0, open = 0, used = {};
    os.forEach(function (o) {
      var amt = +o.amount || 0;
      value += amt;
      if (Procurement.isOpen(o)) { outstanding += amt; open++; } else received += amt;
      if (o.supplier) used[key(o.supplier)] = 1;
    });
    var vendors = db.col(VENDORS);
    var spend = Procurement.spendByVendor();
    var cats = Procurement.spendByCategory();
    return {
      orders: os.length, value: value, received: received, outstanding: outstanding,
      open: open, vendorsUsed: Object.keys(used).length, vendors: vendors.length,
      idle: spend.filter(function (r) { return r.orders === 0; }).length,
      avg: os.length ? Math.round(value / os.length) : 0,
      top: spend.length && spend[0].value ? spend[0].name : '—',
      topCategory: cats.length ? cats[0].name : '—'
    };
  },

  nextOrderId: function () { return nextId(ORDERS, 'WPO'); },
  nextVendorId: function () { return nextId(VENDORS, 'VEN'); },

  saveOrder: function (rec) { return db.save(ORDERS, rec); },
  removeOrder: function (id) { return db.remove(ORDERS, id); },
  saveVendor: function (rec) { return db.save(VENDORS, rec); },
  removeVendor: function (id) { return db.remove(VENDORS, id); }
};

/** Next free id in a seeded PREFIX-000 series. Shared by both stores so the two
 *  numbering schemes can never drift apart in style. */
function nextId(store, prefix) {
  var max = 0, re = new RegExp('^' + prefix + '-?');
  db.col(store).forEach(function (r) {
    var n = parseInt(String(r.id || '').replace(re, ''), 10);
    if (!isNaN(n) && n > max) max = n;
  });
  return prefix + '-' + String(max + 1).replace(/^(\d)$/, '00$1').replace(/^(\d\d)$/, '0$1');
}
