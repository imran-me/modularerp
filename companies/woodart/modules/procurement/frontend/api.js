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
 * shared bindings; frontend/procurement.js adds only its view-layer ones.
 * The seam stays module-private apart from ONE documented diagnostics hook at
 * the bottom of this file — see the note there for why that earns its keep. */
var EPAL = window.EPAL, db = EPAL.db;

var ORDERS = 'wa_purchases';   /* ← the one place these collections are named */
var LINES  = 'wa_purchase_lines';  /* what an order actually orders, per material */
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
  /** The lines of one order — material, quantity, rate. Empty for an order
   *  raised before lines existed, which is why every caller treats "no lines"
   *  as "quantity not recorded" rather than as zero. */
  linesOf: function (orderId) {
    return db.col(LINES).filter(function (l) { return l.order === orderId; });
  },

  /**
   * WHAT AN ORDER ORDERED, as a readable quantity.
   *
   * The register used to show the number of LINES here, and a one-line order for
   * 34,500 bricks read as "1" — which is exactly how somebody concludes the
   * system thinks a truck of brick is one brick (owner, 2026-08-07). When every
   * line shares a unit, the real quantity is shown with it; when they differ,
   * a summed number would be meaningless, so the line count is labelled as such.
   */
  quantityOf: function (orderId) {
    var lines = this.linesOf(orderId);
    if (!lines.length) return null;
    var units = {};
    var total = 0;
    lines.forEach(function (l) { units[l.unit || ''] = 1; total += (+l.qty || 0); });
    var keys = Object.keys(units);
    return keys.length === 1 ? { qty: total, unit: keys[0] } : { lines: lines.length };
  },

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

  /* ---- WRITES (and the accounting that goes with them) ------------------ */

  /** Save an order AND keep the books in step. See THE ACCOUNTING below.
   *
   *  `glAttempt` is bookkeeping metadata, not a form field, so the edit modal's
   *  values object does not carry it. Carrying it forward here is what stops a
   *  routine edit from orphaning a live journal entry — without this line the
   *  record would forget which posting belongs to it and a later reversal would
   *  target the wrong id (or nothing at all). */
  saveOrder: function (rec) {
    var before = Procurement.order(rec.id);
    if (before && before.glAttempt && !rec.glAttempt) rec.glAttempt = before.glAttempt;
    var saved = db.save(ORDERS, rec) || rec;
    syncReceiptPosting(before, saved);
    return saved;
  },

  /** Delete an order and reverse its receipt posting if it had one. */
  removeOrder: function (id) {
    var before = Procurement.order(id);
    if (before && isPosted(before)) reverseReceipt(before, 'order deleted');
    return db.remove(ORDERS, id);
  },

  saveVendor: function (rec) { return db.save(VENDORS, rec); },
  removeVendor: function (id) { return db.remove(VENDORS, id); },

  /* Exposed for the UI's "what will this do to the books" note + the tests. */
  glRefFor: glRefFor,
  isPosted: isPosted,
  receiptLines: receiptLines
};

/* ============================================================================
 * THE ACCOUNTING  —  goods receipt
 * ----------------------------------------------------------------------------
 * THE DECISION (2026-07-27), and why it is not a guess. The three questions
 * that blocked this are answered by the chart of accounts that already exists
 * in platform/engines-library/ledger.js:
 *
 *  1. WHEN?  On RECEIPT, never on order. A purchase order is a commitment, not
 *     a transaction — there is nothing to journalise until goods arrive. This
 *     is also why `Partial` does not post: the store has no part-received
 *     amount (rule P2), so posting the FULL value for partly-delivered goods
 *     would overstate inventory. Only `Received` posts.
 *
 *  2. EXPENSE OR ASSET?  ASSET — `1400 Inventory`, which is already in the
 *     standard COA. Board sitting in the workshop is stock, not a cost; it
 *     becomes cost when it is consumed on a project, exactly as Travels'
 *     COGS-at-sale posts `5000 Cost of Sales` at the moment of the sale.
 *     THIS IS WHAT DISSOLVES THE DOUBLE-COUNT RISK: a receipt touches the
 *     BALANCE SHEET (1400) while `projects` touches the P&L (5000) at sale, so
 *     the two can never count the same money twice.
 *
 *  3. WHAT PAYS IT?  Nothing, yet — receipt raises the liability:
 *     `CR 2000 Accounts Payable`. Goods receipt and payment are two different
 *     events, and settling a vendor needs a bank/cash account this module has
 *     no business choosing. That is the Accounts desk's job (it owns EPAL.pay)
 *     and is recorded as the next step in backend/LARAVEL-BLUEPRINT.md.
 *
 * So one receipt = DR 1400 Inventory / CR 2000 Accounts Payable, for the order
 * value, dated the order date, against the vendor as the party.
 *
 * REVERSALS ARE REAL REVERSALS (AUDIT P2): un-receiving an order or deleting a
 * received one posts an equal-and-opposite entry rather than erasing history.
 * Re-receiving afterwards posts under a FRESH id (…-R2, -R3) so a corrected
 * delivery never collides with the reversed one and the trail stays readable.
 * ==========================================================================*/

var INVENTORY = '1400';      // asset  — stock on hand
var PAYABLE = '2000';        // liability — owed to the vendor

/* ----------------------------------------------------------------------------
 * AND THE STOCK, not just the books.
 * ----------------------------------------------------------------------------
 * A goods receipt is two facts at once: money is now owed (DR 1400 / CR 2000)
 * AND there is physically more material in the workshop. Posting only the first
 * is what left the material register a number nobody could explain.
 *
 * A purchase order carries an OPTIONAL `lines` array — [{ material, qty }] —
 * exactly like an estimate's BOQ. When it has them, receiving the order applies
 * a Receipt movement per line through Materials.apply(), so stock and its
 * ledger move together. When it has none (every order seeded before today), the
 * receipt still books correctly and simply moves no stock: an order without
 * lines genuinely does not say WHAT arrived, and inventing a guess would be
 * worse than recording nothing.
 *
 * Un-receiving reverses the same lines, so the ledger cannot drift from the
 * order's status.
 * --------------------------------------------------------------------------*/

/** The lines an order delivers, or [] when it was raised without any. */
function receiptLinesOf(order) {
  return (order && order.lines && order.lines.length) ? order.lines : [];
}

/** Does the Materials module exist on this deployment? It owns the ledger, and
 *  a company that dropped that folder must not break procurement. */
function stockLedger() {
  return (EPAL.diag && EPAL.diag.woodartMaterials) || null;
}

function receiveIntoStock(order) {
  var M = stockLedger(), lines = receiptLinesOf(order);
  if (!M || !lines.length) return 0;
  var n = 0;
  lines.forEach(function (l) {
    if (M.apply({ material: l.material, kind: 'Receipt', qty: l.qty,
                  ref: order.id, note: 'Goods received · ' + (order.supplier || ''),
                  by: 'Procurement', date: order.date })) n++;
  });
  return n;
}

function reverseIntoStock(order) {
  var M = stockLedger(), lines = receiptLinesOf(order);
  if (!M || !lines.length) return 0;
  var n = 0;
  lines.forEach(function (l) {
    if (M.apply({ material: l.material, kind: 'Adjustment', qty: -Math.abs(+l.qty || 0),
                  ref: order.id, note: 'Delivery un-received · ' + (order.supplier || ''),
                  by: 'Procurement' })) n++;
  });
  return n;
}

/** The journal id for an order's Nth receipt posting. */
function glRefFor(order, attempt) {
  var n = attempt || 1;
  return 'GL-WPO-' + order.id + (n > 1 ? '-R' + n : '');
}

/** Has this order got a live (un-reversed) receipt posting on the books? */
function isPosted(order) {
  if (!EPAL.ledger || !order) return false;
  var id = glRefFor(order, order.glAttempt || 1);
  return EPAL.ledger.entries().some(function (e) {
    return e.id === id && !e.reversedBy;
  });
}

/** The two lines a receipt posts. Pulled out so the UI can preview them and
 *  the tests can assert them without re-deriving the rule. */
function receiptLines(order) {
  var amt = +order.amount || 0;
  return [
    { account: INVENTORY, dr: amt, cr: 0 },
    { account: PAYABLE, dr: 0, cr: amt }
  ];
}

/** Post the goods receipt. Returns the entry, or null when it cannot/should not. */
function postReceipt(order) {
  if (!EPAL.ledger || (+order.amount || 0) <= 0) return null;
  var attempt = (order.glAttempt || 0) + 1;
  var entry = EPAL.ledger.post({
    id: glRefFor(order, attempt),
    companyId: 'woodart',
    date: order.date || undefined,
    ref: order.id,
    memo: 'Goods received · ' + (order.supplier || 'vendor') + ' · ' + order.items + ' line(s)',
    source: 'procurement',
    party: order.supplier || '',
    lines: receiptLines(order)
  });
  // Remember which attempt is live, so a later reversal targets the right one.
  order.glAttempt = attempt;
  db.save(ORDERS, order);
  // Tell the Group a purchase landed (bridge.map: material.purchased).
  if (EPAL.bridge && EPAL.bridge.emit) {
    EPAL.bridge.emit('woodart', 'material.purchased', { amount: +order.amount || 0, ref: order.id });
  }
  return entry;
}

/** Reverse a live receipt posting — an equal-and-opposite entry, not a delete. */
function reverseReceipt(order, reason) {
  if (!EPAL.ledger || !EPAL.ledger.reverse) return null;
  return EPAL.ledger.reverse(glRefFor(order, order.glAttempt || 1), { reason: reason || '' });
}

/**
 * Keep the books in step with a saved order.
 *   not received → Received      post the receipt
 *   Received     → not received  reverse it (a correction, fully audited)
 *   Received     → Received      value changed? reverse and re-post the new value
 */
function syncReceiptPosting(before, after) {
  var wasReceived = !!before && before.status === 'Received';
  var isReceived = after.status === 'Received';

  if (!wasReceived && isReceived) { postReceipt(after); receiveIntoStock(after); return; }

  if (wasReceived && !isReceived) {
    if (isPosted(before)) reverseReceipt(before, 'delivery un-received');
    reverseIntoStock(before);
    return;
  }

  if (wasReceived && isReceived) {
    var moved = (+before.amount || 0) !== (+after.amount || 0);
    if (moved && isPosted(before)) {
      reverseReceipt(before, 'order value corrected');
      after.glAttempt = before.glAttempt;   // next post gets a fresh -Rn id
      postReceipt(after);
    }
  }
}

/* ----------------------------------------------------------------------------
 * DIAGNOSTICS HOOK — the ONE thing this module puts on a global.
 *
 * `tools/verify/books.mjs receipt` drives the REAL seam through this: it saves
 * an order, receives it, un-receives it, and asserts what the ledger did. The
 * alternative was a test that re-implements the posting rule, which proves
 * nothing — it would pass even if the shipped rule were wrong.
 *
 * Read-only surface, no behaviour of its own, namespaced under EPAL.diag so it
 * cannot collide with anything. Sanctioned by MODULE-STANDARD.md §3.
 * --------------------------------------------------------------------------*/
(EPAL.diag = EPAL.diag || {}).woodartProcurement = Procurement;

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
