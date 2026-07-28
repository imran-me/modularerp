/* ============================================================================
 * WOODART · ACCOUNTS · DATA SEAM
 * ----------------------------------------------------------------------------
 * THE ONLY FILE IN THIS MODULE THAT KNOWS WHERE MONEY DATA COMES FROM.
 *
 * The screen calls `Books.register()` / `Books.payables()` / `Books.projectPnl()`.
 * It does not know whether that resolves to localStorage (demo mode) or to
 * GET /api/woodart/accounts/... (API mode).
 *
 * ⚠️ THIS MODULE OWNS NO STORE OF ITS OWN. It reads the SHARED `acc_entries`
 * register that Master Accounts hydrates group-wide, scoped to Woodart, plus
 * four stores owned by other Woodart modules — purchases, projects, estimates
 * and stock movements. That is the whole design: a desk over shared books, not
 * a second set of books. See backend/endpoints.md, invariant 1.
 *
 * EVERY RULE HERE MIRRORS backend/Services/AccountsService.php. The two must
 * agree, because demo mode reads this file and a real host reads that one — if
 * they drift, the same business shows two different margins depending on
 * whether anyone has run a migration.
 *
 * THE RECORD SHAPE (the exact shape the Laravel EntryResource returns):
 *   { id:'JV-WA108', companyId:'woodart', kind:'Income', amount:3600000,
 *     category:'Project Billing', desc:'Stage 2 — Square Pharma (WAP-102)',
 *     method:'Bank', date:'2026-06-18', ref:'WAP-102', party:'', bankId:'',
 *     fundedBy:'', alloc:false, created:'2026-06-18' }
 * ==========================================================================*/

/* Emitted FIRST inside the module IIFE (build-module.mjs), so this file owns the
 * shared bindings; frontend/accounts.js adds only its view-layer ones. */
var EPAL = window.EPAL, db = EPAL.db;

var STORE     = 'acc_entries';   /* ← SHARED. Scoped by companyId on every read */
var PURCHASES = 'wa_purchases';  /* read-only: owned by Procurement            */
var PROJECTS  = 'wa_projects';   /* read-only: owned by Projects               */
var ESTIMATES = 'wa_estimates';  /* read-only: the BOQ that IS the budget      */
var MOVEMENTS = 'wa_movements';  /* read-only: owned by Materials              */
var MATERIALS = 'wa_materials';  /* read-only: for unit cost                   */

var CID = 'woodart';
var TODAY = '2026-07-05';        /* the demo clock — same anchor as every module */

var INCOME = 'Income', EXPENSE = 'Expense';
var VENDOR_PAYMENT = 'Vendor Payment';

var METHODS = ['Bank', 'Cash', 'bKash', 'Nagad', 'Debit Card', 'Credit Card', 'Cheque'];

/* The categories this desk offers. Income heads first, then the running costs a
 * fit-out business actually carries — mirrored from the seeded register so the
 * dropdown and the history describe the same business. */
var CATEGORIES = {
  Income:  ['Project Billing', 'Design Fee', 'Consultancy', 'Other Income'],
  Expense: ['Vendor Payment', 'Salaries', 'Office Rent', 'Utilities',
            'Fuel & Transport', 'Tools & Equipment', 'Site Expense', 'Other Expense']
};

function num(v) { return +v || 0; }

/* Days between a date and the demo clock; 0 if unknown or in the future. */
function daysSince(date) {
  if (!date) return 0;
  var then = Date.parse(String(date).slice(0, 10));
  var now = Date.parse(TODAY);
  if (isNaN(then) || isNaN(now)) return 0;
  return Math.max(0, Math.floor((now - then) / 86400000));
}

var Books = {

  methods:    function () { return METHODS.slice(); },
  categories: function (kind) { return (CATEGORIES[kind] || CATEGORIES.Expense).slice(); },
  kinds:      function () { return [INCOME, EXPENSE]; },
  today:      function () { return TODAY; },

  /* ---- the register ----------------------------------------------------- */

  /**
   * Woodart's rows only. `acc_entries` is group-wide, so the companyId filter
   * is not a convenience — without it this desk would show, and let a user
   * delete, another concern's money.
   */
  all: function () {
    return db.col(STORE).filter(function (e) { return e.companyId === CID; });
  },

  /** Newest first — what the register screen lists. */
  register: function () {
    return this.all().slice().sort(function (a, b) {
      var d = String(b.date || '').localeCompare(String(a.date || ''));
      return d !== 0 ? d : String(b.id || '').localeCompare(String(a.id || ''));
    });
  },

  find: function (id) {
    return this.all().filter(function (e) { return e.id === id; })[0] || null;
  },

  summary: function () {
    var rows = this.all(), income = 0, expense = 0;
    rows.forEach(function (e) {
      if (e.kind === INCOME) income += num(e.amount); else expense += num(e.amount);
    });
    var pay = this.payables();
    return {
      income: income, expense: expense, net: income - expense,
      unpaidVendors: pay.summary.vendors, outstanding: pay.summary.outstanding
    };
  },

  /* ---- payables --------------------------------------------------------- */

  /**
   * What is still owed per purchase order.
   *
   * A payment is matched to its order by `ref` holding the PO id — the same key
   * the seeder uses. Matching on vendor name or a date window would pay down the
   * wrong order the first time a vendor has two open POs.
   */
  payables: function () {
    var paid = {};
    this.all().forEach(function (e) {
      if (e.kind === EXPENSE && e.category === VENDOR_PAYMENT && e.ref) {
        paid[e.ref] = num(paid[e.ref]) + num(e.amount);
      }
    });

    var rows = [], outstanding = 0, vendors = {}, oldest = 0, settled = 0;

    db.col(PURCHASES).forEach(function (po) {
      if (po.status === 'Cancelled') return;          /* not a liability */
      var ordered = num(po.amount);
      var done = num(paid[po.id]);
      var due = Math.max(0, ordered - done);
      var days = daysSince(po.date);

      if (due > 0) {
        outstanding += due;
        vendors[po.supplier] = 1;
        if (days > oldest) oldest = days;
      } else { settled++; }

      rows.push({
        vendor: po.supplier, po: po.id, ordered: ordered, paid: done,
        due: due, status: po.status, date: po.date, days: days
      });
    });

    /* Owing money is the point of the screen: unpaid first, oldest at the top. */
    rows.sort(function (a, b) {
      if ((a.due > 0) !== (b.due > 0)) return b.due - a.due;
      return b.days - a.days;
    });

    return {
      summary: {
        outstanding: outstanding,
        vendors: Object.keys(vendors).length,
        oldestDays: oldest,
        settled: settled
      },
      data: rows
    };
  },

  /* ---- project P&L ------------------------------------------------------ */

  /**
   * Value vs cost vs the approved BOQ, per project.
   *
   * `budget` is read from the estimate's lines rather than stored on the
   * project: a copied budget column drifts from the estimate it came from the
   * first time a BOQ is revised, and then the variance is quietly lying.
   */
  projectPnl: function () {
    var billed = {}, spent = {};
    this.all().forEach(function (e) {
      if (!e.ref) return;
      var bag = e.kind === INCOME ? billed : spent;
      bag[e.ref] = num(bag[e.ref]) + num(e.amount);
    });

    var boq = {};
    db.col(ESTIMATES).forEach(function (est) {
      /* A draft is a guess, and budgeting against a guess makes the variance
       * meaningless — only quoted work counts. */
      if (est.status !== 'Approved' && est.status !== 'Sent') return;
      if (!est.project) return;
      var cost = 0, sale = 0;
      (est.lines || []).forEach(function (l) {
        cost += num(l.qty) * num(l.unitCost);
        sale += num(l.qty) * num(l.unitSale);
      });
      var cur = boq[est.project] || { cost: 0, sale: 0 };
      boq[est.project] = { cost: cur.cost + cost, sale: cur.sale + sale };
    });

    /* The REAL cost of stock issued to each job, from the movement ledger —
     * not a guess and not a share of the total. This is the dependency that
     * made the stock ledger a prerequisite for this module. */
    var rate = {};
    db.col(MATERIALS).forEach(function (m) { rate[m.id] = num(m.unitCost); });

    var issued = {};
    db.col(MOVEMENTS).forEach(function (mv) {
      if (mv.kind !== 'Issue' || !mv.ref) return;
      issued[mv.ref] = num(issued[mv.ref]) + Math.abs(num(mv.qty)) * num(rate[mv.material]);
    });

    return db.col(PROJECTS).map(function (p) {
      var value = num(p.value), cost = num(p.cost), margin = value - cost;
      var budget = boq[p.id] || { cost: 0, sale: 0 };
      var mat = num(issued[p.id]);
      return {
        project: p.id, name: p.name, client: p.client, stage: p.stage,
        value: value, cost: cost, margin: margin,
        marginPct: value > 0 ? Math.round(margin / value * 100) : 0,
        budget: budget.cost, budgetSale: budget.sale,
        billed: num(billed[p.id]), spent: num(spent[p.id]),
        materialIssued: mat,
        /* NEGATIVE means the job is consuming more material than it was quoted
         * for. That is the alarm this whole module was built for. */
        variance: budget.cost - mat
      };
    }).sort(function (a, b) { return String(a.project).localeCompare(String(b.project)); });
  },

  /* ---- option lists (the seam owns every store name, including these) ---- */

  /**
   * Woodart's own accounts, for the payment-source picker.
   *
   * Scoped to this concern on purpose: paying a Woodart vendor out of the
   * Travels account is exactly the mistake the kernel's posting services refuse,
   * and offering it in a dropdown invites the user to try.
   */
  bankOptions: function () {
    return db.col('banks')
      .filter(function (b) { return String(b.companyId) === CID || +b.companyId === 6; })
      .map(function (b) { return { value: b.id, label: b.name + ' · ' + (b.accountNumber || b.account_number || '') }; });
  },

  /** Projects a register entry may be tagged against. */
  projectOptions: function () {
    return db.col(PROJECTS).map(function (p) {
      return { value: p.id, label: p.id + ' · ' + (p.name || '') };
    });
  },

  /** Purchase orders that still owe money — what the pay modal offers. */
  openOrders: function () {
    return this.payables().data.filter(function (r) { return r.due > 0; });
  },

  /* ---- writes ----------------------------------------------------------- */

  /**
   * Save a register entry.
   *
   * In API mode `db.save` posts to the module's write endpoint, which routes the
   * money through the KERNEL posting services — so the ledger and the paying
   * account move with it. In demo mode it is a localStorage write and only this
   * register moves. That difference is intentional and is why the GL is never
   * computed here: a browser must not be allowed to invent a journal.
   */
  save: function (rec) {
    rec.companyId = CID;
    rec.kind = rec.kind === INCOME ? INCOME : EXPENSE;
    rec.amount = Math.abs(num(rec.amount));
    if (!rec.id) rec.id = 'JV-WA' + String(Date.now()).slice(-6);
    if (!rec.created) rec.created = rec.date;
    return db.save(STORE, rec);
  },

  /**
   * Void an entry. Named `void` on the server, where it posts a REVERSAL; here
   * it removes the row the browser is holding. The audit trail is the server's
   * job — see backend/endpoints.md invariant 3.
   */
  remove: function (id) { db.remove(STORE, id); },

  /** Settle a purchase order — an expense whose `ref` is the order id. */
  payOrder: function (po, spec) {
    var order = db.col(PURCHASES).filter(function (p) { return p.id === po; })[0];
    if (!order) return null;

    var line = this.payables().data.filter(function (r) { return r.po === po; })[0];
    var due = line ? line.due : num(order.amount);
    var amount = Math.abs(num(spec.amount));

    /* Overpaying a settled order is how a payables report starts disagreeing
     * with the ledger. Refuse rather than record a number nobody can explain. */
    if (!amount || amount > due) return null;

    return this.save({
      kind: EXPENSE,
      category: VENDOR_PAYMENT,
      desc: spec.note || (order.supplier + ' — settles ' + po),
      amount: amount,
      method: spec.method || 'Bank',
      bankId: spec.bankId || '',
      date: spec.date || TODAY,
      party: order.supplier,
      ref: po
    });
  }
};
