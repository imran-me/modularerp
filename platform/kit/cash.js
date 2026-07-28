/* ============================================================================
 * EPAL KIT · MANAGE CASH  (hard cash · cash in sell · petty cash · cheques)
 * ----------------------------------------------------------------------------
 * ONE DESK FOR EVERY FORM OF CASH — the owner's brief (2026-07-15):
 *   "How am I gonna do the accounts of cash money? How to match with the
 *    book-keeping? I want the cash options under Master Accounts, Manage Bank.
 *    Clicking on the cash will appear all functions that's needed to manage
 *    cash, affect with the master accountings … Hard Cash, Hard Cash in sell,
 *    Petty Cash, Cheque etc."
 *
 * The four books it shows:
 *   1. HARD CASH — physical money in the drawer/safe. THIS book is the real
 *      GL account 1000 ("Cash", debit-normal): the register below is nothing
 *      but the journal lines that touch 1000, with a running balance. Actions
 *      here (cash in / cash out / deposit to bank / withdraw from bank) post
 *      REAL journals — this desk is on the books by design (owner decision
 *      2026-07-15, opposite of the Manage Loan desk which is deliberately off).
 *   2. CASH IN SELL — cash taken over the counter (Shop POS today). Read-only
 *      mirror of sh_orders where payMethod = Cash. NOTE the GL treats every
 *      POS sale as a receivable (DR 1200 — ledger.js boot handler), so the
 *      taka in the drawer is NOT yet on 1000: collecting it is exactly what
 *      the Cash In action is for (DR 1000 / CR 1200), and the form defaults
 *      to that account.
 *   3. PETTY CASH — read-only mirror of the company petty books (tv_petty).
 *      Entry stays where it lives (Travels ▸ Accounts ▸ Petty Cash): an IOU
 *      posts nothing; SETTLEMENT posts DR 5xxx / CR 1000 there, and lands in
 *      this desk's Hard Cash register automatically because it hits 1000.
 *   4. CHEQUES — read-only mirror of the company cheque registers
 *      (tv_cheques). Issued/received with clearing status. The register is a
 *      tracking book (it posts no GL) — mirrored so cash + near-cash read in
 *      one place.
 *
 * ══ THE ACCOUNTING RULE (owner, 2026-07-15) ═════════════════════════════════
 * Cash is ON the main accounts, through account 1000. Every action here is a
 * balanced journal via EPAL.ledger.post (period-lock enforced there):
 *   Cash In           DR 1000 / CR <source: 1200 AR · 4xxx income · 3000 capital>
 *   Cash Out          DR <head: 5xxx expense · 2000 AP> / CR 1000
 *   Deposit to Bank   DR 1010 / CR 1000  + EPAL.bankTxnApply(bank,'deposit')
 *   Withdraw          DR 1000 / CR 1010  + EPAL.bankTxnApply(bank,'withdraw')
 * Deposit/withdraw touch BOTH sides the bank desk keeps honest: the GL leg
 * (1000↔1010) and the bank register (bank.balance + bank_txns, via the same
 * EPAL.bankTxnApply that Manage Banks and Manage Loan use). That is what makes
 * the reconciliation card's "unassigned cash float" move the right way — a
 * deposit shifts GL money from 1000 to 1010 AND raises the register, so
 * float = (1000+1010) − register shrinks by exactly the amount banked.
 *
 * STORES: none of its own. Hard cash = gl_entries (account 1000) — the GL is
 *         the register, so this book can never drift from the books. The
 *         mirrors read sh_orders / tv_petty / tv_cheques, filtered by the
 *         companyId each record already carries.
 *
 * EXPOSES: EPAL.cashDesk(page, companyId, { rightEl }) — the whole section.
 *          EPAL.pay — the shared PAYMENT-SOURCE helpers (see their block below):
 *          which real accounts a concern can pay from, and the register leg a
 *          money entry must move. Lives here because "which account did the
 *          money leave" is this desk's question, and every entry screen
 *          (Travels Accounts, Master Accounts expenses, shared costs) asks it.
 *
 * ==> LARAVEL HANDOFF: no new tables. CashController reads JournalLine
 *     where account_code = 1000 (window function for the running balance);
 *     the four actions are one CashPostingService with four methods, each a
 *     DB::transaction posting a balanced JournalEntry (+ BankTransaction for
 *     the two bank legs). Mirrors are plain scoped queries on orders /
 *     petty_cash / cheques.
 * ==========================================================================*/
(function (EPAL) {
  'use strict';
  var ui = EPAL.ui, el = ui.el, S = EPAL.store;
  function db() { return EPAL.db; }
  function L() { return EPAL.ledger; }
  function esc(s) { return ui.escapeHtml(String(s == null ? '' : s)); }
  function today() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function coName(cid) { if (cid === 'group') return 'Group HQ'; var c = EPAL.config.company(cid); return c ? c.short : cid; }
  function comps() { return EPAL.config.companies.filter(function (c) { return c.type === 'company' && c.enabled !== false; }); }
  function can() { return !EPAL.perm || EPAL.perm.can('group', 'master-accounts', 'create'); }
  function kpi(label, value, icon, tone) {
    return el('div.kpi-card', null, [
      el('div.kpi-top', null, [el('span.kpi-label', { text: label }), el('span.kpi-ico', { html: '<i class="bi bi-' + icon + '"></i>' })]),
      el('div.kpi-value' + (tone ? '.' + tone : ''), { text: String(value) })
    ]);
  }
  // scope: 'all' means every company; anything else filters to that company.
  function scopeOf(cid) { return cid === 'all' ? {} : { companyId: cid }; }
  function inScope(cid, recCo) { return cid === 'all' ? true : (recCo || 'group') === cid; }

  /* ==========================================================================
   * EPAL.pay — PAYMENT SOURCES + THE REGISTER LEG  (owner 2026-07-26)
   * --------------------------------------------------------------------------
   * "I need here all listed bank including cash, petty cash etc. … ordering will
   *  be travels bank, and cash first" — money never leaves "Bank" in the
   * abstract, it leaves a NAMED account. So every money-entry form offers the
   * REAL accounts opened in Master Accounts › Manage Banks (bank accounts,
   * cash boxes = hard cash / petty cash, bKash/Nagad wallets, cards) belonging
   * to whoever is paying, banks first then cash then the wallets.
   *
   * And picking a real account has to MEAN something: the entry then moves that
   * account's own book too — balance, and a row in its transaction history —
   * not just the GL. syncRegister() is that leg, and it works by DELTA, so one
   * function serves posting, editing and deleting: an edited amount posts a
   * visible adjustment row, a delete posts a visible reversal row, and a
   * balance never changes without a row explaining why (AUDIT P2).
   *
   * ONE implementation, used by Travels › Accounts (expense + journal entry),
   * Master Accounts › Operational Expenses and the Shared Cost desk — a second
   * copy of this would drift the day someone fixes a bug in only one of them.
   *
   * ==> LARAVEL: App\Services\BankRegisterService (balance + bank_transactions)
   *     and App\Services\ExpensePostingService, which do the same three books
   *     inside one DB::transaction.
   * ========================================================================*/
  // Ordering the owner asked for: bank → cash (incl. petty cash) → wallets → card.
  var SRC_ORDER = { 'Bank': 0, 'Cash Box': 1, 'bKash': 2, 'Nagad': 3, 'Card': 4 };
  var GENERIC = ['Bank', 'Cash', 'bKash', 'Nagad', 'Debit Card', 'Credit Card', 'Cheque'];

  function srcRank(b) { var r = SRC_ORDER[b.type || 'Bank']; return r == null ? 9 : r; }

  /* EVERY CONCERN HAS A CASH DRAWER, AND IT MUST BE SELECTABLE (owner 2026-07-28:
   * "in the expense sheet we can see the from bank we are expensing, but we can
   * not select the travels cash — why? solve that").
   *
   * Because hard cash was only ever an ACCOUNT CODE (1000), never an account you
   * could open: Manage Cash showed a real drawer with real money in it, read
   * straight from the ledger, while every payment picker offered banks plus a
   * vague "Cash — no registered account". So the money existed on the books and
   * had no name to pick.
   *
   * A concern's drawer is now a real payment account like any other. It is opened
   * at whatever hard cash that company's books already show, so the register and
   * the ledger agree from the first moment WITHOUT posting anything: no journal,
   * no double count — the opening figure is READ from 1000, not added to it.
   * After this every cash movement posts to the drawer's own code (1000-<id>) and
   * moves its balance, and 1000 still answers for the lot because a control
   * account includes its children. */
  var cashBoxChecked = {};
  function ensureCashBox(owner) {
    if (!owner || cashBoxChecked[owner]) return;
    cashBoxChecked[owner] = true;
    /* NEVER INVENT MASTER DATA ON A LIVE DATABASE (live fix 2026-07-28).
     * Creating a drawer here is a WRITE, and `banks` is a writable store — so
     * rendering any picker fired one POST per company at the host. Under load the
     * host answers "Operation not permitted" (its connection cap, see api.js) and
     * the screen filled with "Not saved" toasts. A convenience must never write to
     * a real database behind the user's back: on live the drawer is added once, on
     * purpose, in Manage Banks. In demo mode nothing is at stake, so it still
     * appears by itself. */
    if (EPAL.api && EPAL.api.live) return;
    try {
      var mine = db().col('banks').filter(function (b) { return (b.companyId || 'group') === owner; });
      if (mine.some(function (b) { return b.type === 'Cash Box'; })) return;
      var onBooks = 0;
      try { onBooks = Math.round((EPAL.ledger.balance('1000', { companyId: owner }) || 0) * 100) / 100; } catch (e) {}
      db().save('banks', {
        id: 'CASH-' + owner.toUpperCase(),
        name: coName(owner) + ' — Hard Cash',
        type: 'Cash Box', status: 'Active', companyId: owner,
        balance: onBooks,             // what the books already say is in the drawer
        account: '', branch: 'Office', currency: 'BDT',
        note: 'The office cash drawer. Opened at the hard cash already on the books (GL 1000).'
      });
    } catch (e) { /* a picker must never fail because of this */ }
  }

  var Pay = {
    /** Every ACTIVE payment account one concern owns, in the owner's order. */
    accountsOf: function (owner) {
      ensureCashBox(owner);        // the drawer is an account too — see above
      return db().col('banks').filter(function (b) {
        return (b.companyId || 'group') === owner && (b.status || 'Active') !== 'Inactive';
      }).sort(function (a, b) { return (srcRank(a) - srcRank(b)) || String(a.name || '').localeCompare(String(b.name || '')); });
    },

    byId: function (id) { return db().col('banks').filter(function (b) { return b.id === id; })[0] || null; },

    /* THE ACCOUNT AN ACCOUNT POSTS TO (owner 2026-07-28).
     * Every real bank and cash box now has its OWN code on the chart, hanging
     * under the control account it belongs to: a cash box under 1000 Cash, any
     * other account under 1010 Bank. Code is 1010-<bank id>, created the first
     * time the account is used and named after it.
     *
     * WHY: until now every bank collapsed into a single 1010 line, so the
     * ledger could not say WHICH account held the money — only the register
     * could, and the two were kept in step by hand. A transfer between two
     * accounts posted nothing at all, because on the books it moved nothing.
     * Now the ledger itself carries the detail. Nothing on screen changes:
     * ledger.balance('1010') still answers for every bank, because a control
     * account includes its children (see SUB-ACCOUNTS in ledger.js).
     *
     * Postings made before this stayed on the bare control account and are
     * still counted — the roll-up sees both. */
    controlAcctOf: function (bank) { return (bank && bank.type === 'Cash Box') ? '1000' : '1010'; },

    /* THE SUB-ACCOUNT, SAFELY (live fix 2026-07-28).
     *
     * A journal may only name codes the BOOKS already know. On a real database
     * the chart is hydrated from the host and the host refuses any code it has
     * never heard of — so the first sale after this feature shipped died with
     * "Save failed: Unknown account code: 1010-4". Correct of the server: a typo
     * must not quietly create an account.
     *
     * So the rule is ask, don't assume:
     *   · the chart already has the sub-account  → post to it
     *   · it doesn't                             → create it (which, in API mode,
     *     pushes it to the host like any other chart head) and post THIS entry to
     *     the CONTROL account, which is exactly where it went before sub-accounts
     *     existed and is never refused
     * Nothing fails, nothing is lost, and once the host confirms the account the
     * next posting starts using it. `pending` is what "not confirmed yet" looks
     * like locally; hydration replaces the chart wholesale, so the flag survives
     * only until the server answers — and if the server rejected it, the account
     * is simply gone and we keep using the control account. */
    subAcct: function (control, id, name, group) {
      var L = EPAL.ledger;
      if (!L || !L.ensureAccount || !id) return control;
      var code = control + '-' + id;
      var have = L.account ? L.account(code) : null;
      if (have && !have.pending) return code;                 // the books know it
      /* ON A LIVE DATABASE, DON'T CREATE IT AT ALL (live fix 2026-07-28).
       * `coa` is a writable store, so ensureAccount() here fired a POST per bank
       * per render — a burst the host refuses under load, and the screen filled
       * with "Not saved" toasts. The real chart on a production install already
       * carries an account per bank anyway (1001 Brac Bank, 1005 Dutch-Bangla…),
       * so inventing 1010-<id> was solving a problem that host does not have. Post
       * to the control account, which is always there and always right. */
      if (EPAL.api && EPAL.api.live) return control;
      if (!have) {
        var parent = L.account ? L.account(control) : null;
        L.ensureAccount(code, name || code, (parent && parent.type) || 'asset',
          { parent: control, group: group || (parent && parent.group) || 'Current Assets' });
      }
      return code;
    },
    glAcctOf: function (bank) {
      var control = Pay.controlAcctOf(bank);
      if (!bank || !bank.id) return control;
      /* THE ACCOUNT THE BUSINESS ALREADY KEEPS COMES FIRST (2026-07-28).
       * A production chart links each bank to its own head (banks.account_id →
       * "1001 Brac Bank Ltd (Travels)"), and the API now hands that code over as
       * `glAccount`. Using it means the browser posts where this company's books
       * have always posted, instead of a parallel code invented in the browser.
       * Only when there is no such link do we fall back — to a derived
       * sub-account in demo mode, or the control account on a live database. */
      if (bank.glAccount && EPAL.ledger && EPAL.ledger.account && EPAL.ledger.account(bank.glAccount)) {
        return String(bank.glAccount);
      }
      return Pay.subAcct(control, bank.id, bank.name || bank.id, 'Current Assets');
    },

    /* ==========================================================================
     * PORTAL & GDS WALLETS  (owner 2026-07-28)
     * --------------------------------------------------------------------------
     * A booking portal holds our money: we wire Sabre ৳5,00,000 and draw tickets
     * against it. Until now that float lived in one number on the portal record
     * that NOTHING ever moved — an automation alert read it, and it was wrong the
     * moment anyone booked. The reference ERP does keep a portal_balances ledger,
     * but its wallets sit outside the chart of accounts, so the float never shows
     * on the balance sheet.
     *
     * Here a wallet IS an account: 1180-<portal id> under 1180 Portal & GDS
     * Wallets, so the money is a prepayment asset while it sits there.
     *   top up   DR 1180-<portal> / CR <the bank it was wired from>
     *   booking  DR 5000 Cost of Sales / CR 1180-<portal>
     * Every movement also writes a wallet-register row (tv_portal_txns) with the
     * balance before and after, so the portal has its own statement — and the
     * portal's `balance` field stays the fast read every screen already uses.
     * ========================================================================*/
    portalById: function (id) { return db().col('tv_portals').filter(function (p) { return p.id === id || p.name === id; })[0] || null; },

    /** The wallet's own account on the chart, created the first time it is used. */
    portalAcctOf: function (portal) {
      if (!portal || !portal.id) return '1180';
      // same ask-don't-assume rule as a bank sub-account (see subAcct)
      return Pay.subAcct('1180', portal.id, (portal.name || portal.id) + ' wallet', 'Current Assets');
    },

    /** One wallet movement: the GL leg, the portal balance, and the register row.
     *  kind 'topup' | 'booking' | 'refund' | 'adjustment' — sign is up to the caller
     *  (positive = money INTO the wallet). Returns the register row. */
    portalMove: function (opts) {
      opts = opts || {};
      var portal = opts.portal || Pay.portalById(opts.portalId);
      if (!portal) return null;
      var amt = +opts.amount || 0;
      if (!amt) return null;
      var before = +portal.balance || 0;
      portal.balance = Math.round((before + amt) * 100) / 100;
      db().save('tv_portals', portal);
      var row = { id: opts.id || ('PW-' + ui.uid('').slice(-6).toUpperCase()),
        portalId: portal.id, portalName: portal.name || '', companyId: opts.companyId || 'travels',
        kind: opts.kind || (amt > 0 ? 'topup' : 'booking'), amount: amt,
        openingBalance: before, balance: portal.balance,
        date: opts.date || today(), ref: opts.ref || '', memo: opts.memo || '',
        glId: opts.glId || '', bankId: opts.bankId || '' };
      S.upsert('tv_portal_txns', row);
      EPAL.bus.emit('data:changed', { store: 'tv_portal_txns', action: 'create', record: row });
      return row;
    },

    /** The wallet's statement, newest first. */
    portalLedger: function (portalId) {
      return S.list('tv_portal_txns').filter(function (r) { return r.portalId === portalId; })
        .sort(function (a, b) { return (a.date || '') < (b.date || '') ? 1 : -1; });
    },

    /** Wire money to a portal: it leaves a real account and becomes a prepayment. */
    portalTopUp: function (opts) {
      opts = opts || {};
      var portal = opts.portal || Pay.portalById(opts.portalId);
      var amt = +opts.amount || 0;
      if (!portal || amt <= 0) return null;
      var src = Pay.resolve(opts.source || '');
      var co = opts.companyId || portal.companyId || 'travels';
      var id = 'PW-' + (opts.ref || ui.uid('').slice(-6).toUpperCase());
      var glId = 'GL-' + id;
      try {
        EPAL.ledger.post({ id: glId, date: opts.date || today(), companyId: co,
          ref: opts.ref || id, source: 'payment', party: portal.name || '',
          memo: 'Portal top-up · ' + (portal.name || '') + (src.bank ? ' · from ' + src.bank.name : ''),
          lines: [ { account: Pay.portalAcctOf(portal), dr: amt, cr: 0 },
                   { account: src.gl, dr: 0, cr: amt } ] });
      } catch (e) { ui.toast(e.message || 'Ledger posting failed', 'error'); return null; }
      if (src.bank) Pay.syncRegister({ id: id, companyId: co, bankId: src.bank.id, kind: 'Expense',
        amount: amt, category: 'Portal top-up', party: portal.name || '', ref: opts.ref || id,
        date: opts.date || today(), glId: glId }, null);
      return Pay.portalMove({ id: id, portal: portal, amount: amt, kind: 'topup', companyId: co,
        date: opts.date || today(), ref: opts.ref || id, memo: opts.memo || 'Top-up',
        glId: glId, bankId: src.bank ? src.bank.id : '' });
    },

    /** "Cash Box · Travels Petty Cash · Gulshan — ৳ 40K" */
    label: function (b) {
      var bits = [b.name];
      if (b.branch && b.branch !== '—') bits.push(b.branch);
      if (b.account && b.type !== 'Cash Box') bits.push('…' + String(b.account).slice(-4));
      return (b.type && b.type !== 'Bank' ? b.type + ' · ' : '') + bits.join(' · ') + ' — ' + ui.money(b.balance || 0, { compact: true });
    },

    /** Options for a "Paid from" select: the owner's real accounts, then the
     *  generic methods LAST — a cheque or a card swipe that no registered
     *  account carries must still be recordable (nothing is ever removed). */
    options: function (owner) {
      return Pay.accountsOf(owner).map(function (b) { return ['bank:' + b.id, Pay.label(b)]; })
        .concat(GENERIC.map(function (m) { return ['m:' + m, m + ' — no registered account']; }));
    },

    /** The select value for a record being edited — its account, else its method. */
    valueOf: function (rec) {
      if (rec && rec.bankId && Pay.byId(rec.bankId)) return 'bank:' + rec.bankId;
      return 'm:' + ((rec && rec.method) || 'Bank');
    },

    /** 'bank:<id>' | 'm:<Method>' -> { bank, method, gl }. `method` stays one of
     *  the short GENERIC values, so every Method badge, filter facet and
     *  method-mix chart in the app keeps reading exactly as it does today. */
    resolve: function (val) {
      val = String(val || '');
      if (val.indexOf('bank:') === 0) {
        var b = Pay.byId(val.slice(5));
        if (b) return { bank: b, method: b.type === 'Cash Box' ? 'Cash' : (b.type || 'Bank'), gl: Pay.glAcctOf(b) };
      }
      var m = val.indexOf('m:') === 0 ? val.slice(2) : 'Bank';
      return { bank: null, method: m, gl: m === 'Cash' ? '1000' : '1010' };
    },

    /** Stamp the resolved source onto a record: what every save path writes. */
    stamp: function (rec, val) {
      var src = Pay.resolve(val);
      rec.method = src.method;
      rec.payAcct = src.gl;
      rec.bankId = src.bank ? src.bank.id : '';
      rec.bankName = src.bank ? src.bank.name : '';
      return src;
    },

    /** Signed effect on cash: Income puts money IN, anything else takes it OUT. */
    cashEffect: function (rec) {
      var a = +(rec && rec.amount) || 0;
      return (rec && rec.kind === 'Income') ? a : -a;
    },

    /**
     * Move the paying account's own book by the DELTA between `prev` and `rec`.
     *   post   → syncRegister(rec, null)                  … a withdrawal (or deposit for income)
     *   edit   → syncRegister(rec, before, 'Adjustment ·') … only the difference
     *   delete → reverseRegister(rec)                      … the whole thing back
     * `amount` may be overridden for a partial leg (a shared cost's payer credits
     * the FULL bill even though its own share is smaller).
     */
    syncRegister: function (rec, prev, note, amountOverride) {
      if (!rec || !rec.bankId || !EPAL.bankTxnApply) return null;
      var bank = Pay.byId(rec.bankId); if (!bank) return null;
      var delta = amountOverride != null
        ? (rec.kind === 'Income' ? +amountOverride : -amountOverride)
        : Pay.cashEffect(rec) - Pay.cashEffect(prev);
      if (Math.abs(delta) < 0.005) return null;
      var isIn = delta > 0, amt = Math.abs(delta);
      var what = (rec.category || rec.kind || 'Entry') + (rec.subCategory ? ' · ' + rec.subCategory : '') + (rec.party ? ' — ' + rec.party : '');
      // The journal this movement belongs to: an explicit rec.glId when the
      // caller knows it, else <prefix><voucher id>. An entry another concern
      // FUNDED points at the funder's leg — that is whose account moved.
      var glId = rec.glId ||
        ((rec.fundedBy && rec.fundedBy !== rec.companyId ? 'GL-ACF-' : (rec.glPrefix || 'GL-ACC-')) + rec.id);
      return EPAL.bankTxnApply(bank, isIn ? 'deposit' : 'withdraw', amt, rec.date || today(),
        (note ? note + ' ' : '') + what, rec.ref || rec.id, glId,
        { entryId: rec.id, reversal: note === 'Reversal of:' });
    },

    /**
     * "Money is arriving / leaving — WHICH account?" One prompt, so every desk
     * that moves money (a ticket receipt, a customer payment, a refund) asks the
     * question the same way and books it the same way. Without this the GL says
     * "bank went up" while Manage Banks shows the old balance and its history has
     * no row — the exact drift this whole payment-source change exists to end.
     *   ask({ title, owner, amount, label, onPick(src) })   src = resolve() shape
     */
    /* opts.allowNone — offer "not paid yet" as the FIRST choice and the default,
     * for the callers where not-yet-collected is a legitimate answer (a deal just
     * won, an invoice raised on credit). onPick then gets null, and the caller
     * books its receivable exactly as it did before naming accounts existed. */
    ask: function (opts) {
      opts = opts || {};
      var owner = opts.owner || 'group';
      var options = Pay.options(owner);
      if (opts.allowNone) options = [['m:Due', opts.noneLabel || 'Not paid yet']].concat(options);
      EPAL.formModal({
        title: opts.title || 'Which account?', icon: opts.icon || 'bank', size: 'sm',
        record: { source: options.length ? options[0][0] : 'm:Bank' },
        fields: [
          { key: 'source', label: opts.label || 'Received into (bank / cash account)', type: 'select',
            required: true, searchable: true, options: options, col2: true,
            hint: opts.amount != null
              ? ui.money(opts.amount) + ' lands here — its balance rises and the movement shows in its transaction history.'
              : 'Its balance moves and the movement shows in its transaction history.' }
        ],
        saveLabel: opts.saveLabel || 'Confirm',
        onSave: function (v) {
          opts.onPick(v.source === 'm:Due' ? null : Pay.resolve(v.source));
          return true;
        }
      });
    },

    /** Give the account its money back for a deleted voucher, and flag the
     *  original row so Manage Banks cannot reverse it a second time. `asOf`
     *  dates the reversal row (callers on the demo clock pass their own today). */
    reverseRegister: function (rec, asOf) {
      if (!rec || !rec.bankId) return;
      Pay.syncRegister({ id: rec.id, bankId: rec.bankId, kind: rec.kind, amount: 0, category: rec.category,
        subCategory: rec.subCategory, party: rec.party, ref: rec.ref, date: asOf || today(),
        companyId: rec.companyId, fundedBy: rec.fundedBy, glPrefix: rec.glPrefix }, rec, 'Reversal of:');
      try {
        S.list('bank_txns').forEach(function (t) {
          if (t.entryId === rec.id && !t.reversal && !t.reversed) { t.reversed = true; db().save('bank_txns', t); }
        });
      } catch (e) {}
    }
  };
  EPAL.pay = Pay;

  /* ==========================================================================
   * HARD CASH — the GL-1000 register, derived (never stored) from the journal
   * ========================================================================*/
  // Every journal entry that touches 1000, flattened to one register row with
  // the entry's net effect on cash. entries() comes back ascending by date, so
  // the running balance accumulates forward and the table shows newest first.
  function cashRows(cid) {
    var entries = L() ? L().entries(Object.assign({ account: '1000' }, scopeOf(cid))) : [];
    var bal = 0;
    var rows = entries.map(function (e) {
      var dr = 0, cr = 0;
      (e.lines || []).forEach(function (l) { if (EPAL.ledger.isUnder(l.account, '1000')) { dr += (+l.dr || 0); cr += (+l.cr || 0); } });
      bal += dr - cr;
      return { id: e.id, date: e.date, companyId: e.companyId || 'group', ref: e.ref || '',
        memo: e.memo || '', party: e.party || '', source: e.source || '', dr: dr, cr: cr, after: bal };
    });
    return rows.reverse();                                  // newest first
  }
  function cashBal(cid) { return L() ? L().balance('1000', scopeOf(cid)) : 0; }
  // The reconciliation card's number, scope-aware: business cash on the books
  // (1000 + 1010) that no bank record holds yet. Same formula as Manage Banks.
  function floatOf(cid) {
    if (!L()) return 0;
    var gl = L().balance('1000', scopeOf(cid)) + L().balance('1010', scopeOf(cid));
    var reg = db().col('banks').filter(function (b) { return inScope(cid, b.companyId); })
      .reduce(function (a, b) { return a + (+b.balance || 0); }, 0);
    return gl - reg;
  }

  /* ==========================================================================
   * MIRRORS — the sub-books this desk aggregates READ-ONLY (owner decision:
   * entry stays on each company's own screen; this desk is the group lens)
   * ========================================================================*/
  function cashSales(cid) {
    return db().col('sh_orders').filter(function (o) {
      return o.payMethod === 'Cash' && inScope(cid, 'shop');
    }).map(function (o) {
      // display fallback only (never written back): seeded history predates
      // the payStatus field — a Completed cash order with no due is Paid
      if (!o.payStatus) o = Object.assign({}, o, { payStatus: 'Paid' });
      return o;
    }).sort(function (a, b) { return (a.date || '') < (b.date || '') ? 1 : -1; });
  }
  // Cash actually kept from a POS order: tendered minus change. Orders that
  // never recorded a tendered figure (the seeded history predates the field)
  // are Completed cash sales — treat the bill as fully tendered, otherwise the
  // whole seeded book reads "৳0 kept" against real bills (review finding).
  function keptOf(o) {
    var t = (o.tendered == null) ? (+o.amount || 0) : (+o.tendered || 0);
    return Math.max(0, Math.min(t, +o.amount || 0));
  }
  function pettyList(cid) {
    return S.list('tv_petty').filter(function (p) { return inScope(cid, p.companyId); })
      .sort(function (a, b) { return (a.date || '') < (b.date || '') ? 1 : -1; });
  }
  function chequeList(cid) {
    return S.list('tv_cheques').filter(function (c) { return inScope(cid, c.companyId); })
      .sort(function (a, b) { return (a.date || '') < (b.date || '') ? 1 : -1; });
  }

  /* ==========================================================================
   * POSTING ACTIONS — four forms, four balanced journals
   * ========================================================================*/
  // Account pickers come from the LIVE chart of accounts — no invented codes.
  function acctOpts(kinds) {
    var coa = L() ? L().accounts() : [];
    return coa.filter(function (a) { return kinds.indexOf(a.code) >= 0 || kinds.indexOf(a.type) >= 0; })
      .map(function (a) { return [a.code, a.code + ' · ' + a.name]; });
  }
  function companyField(cid) {
    return { key: 'companyId', label: 'Company', type: 'select', required: true,
      options: [['group', 'Group HQ']].concat(comps().map(function (c) { return [c.id, c.short]; })),
      default: cid === 'all' ? 'group' : cid };
  }
  function postCash(spec, okMsg, after) {
    // one funnel for every journal this desk writes — the ledger enforces
    // balance and the period lock; surface its message instead of crashing.
    // `after` runs between the post and the re-render: the bank-register leg
    // hangs off it, so (a) the register can never move when the journal was
    // refused, and (b) the screen repaints only once BOTH legs are in — a
    // render in between would flash the journal without its register entry.
    try {
      L().post(spec);
      if (after) after();
      ui.toast(okMsg, 'success'); EPAL.router.render(); return true;
    }
    catch (err) { ui.toast(String(err && err.message || err), 'error'); return false; }
  }

  function cashInForm(cid) {
    EPAL.formModal({
      title: 'Cash In — money into the drawer', icon: 'box-arrow-in-down-left', size: 'md',
      record: { companyId: cid === 'all' ? 'group' : cid, date: today(), account: '1200' },
      fields: [
        companyField(cid),
        { key: 'date', label: 'Date', type: 'date', required: true },
        { key: 'amount', label: 'Amount (৳)', type: 'money', required: true, min: 1 },
        { key: 'account', label: 'Where it came from', type: 'select', required: true,
          options: acctOpts(['1200', '1150', '3000', 'income']),
          hint: 'Collecting a sale already on the books = 1200 Accounts Receivable (the default — POS cash sits there until collected) or 1150 for a sub-agent. Fresh income = a 4xxx head. Owner putting money in = 3000.' },
        { key: 'party', label: 'From (party)', type: 'text', placeholder: 'e.g. Concord Group · walk-in customers' },
        { key: 'ref', label: 'Reference', type: 'text', placeholder: 'e.g. money receipt no' },
        { key: 'memo', label: 'Note', type: 'text', col2: true }
      ],
      saveLabel: 'Post Cash In',
      onSave: function (v) {
        var amt = Math.round(+v.amount || 0);
        if (amt <= 0) { ui.toast('Enter the amount', 'error'); return false; }
        return postCash({ id: 'GL-CSH-' + ui.uid('').slice(-7).toUpperCase(), date: v.date, companyId: v.companyId,
          ref: v.ref || '', memo: v.memo || ('Cash in — ' + (v.party || 'counter')), source: 'cash', party: v.party || '',
          lines: [{ account: '1000', dr: amt, cr: 0 }, { account: v.account, dr: 0, cr: amt }] },
          'Cash in ' + ui.money(amt) + ' → drawer');
      }
    });
  }

  function cashOutForm(cid) {
    EPAL.formModal({
      title: 'Cash Out — money out of the drawer', icon: 'box-arrow-up-right', size: 'md',
      record: { companyId: cid === 'all' ? 'group' : cid, date: today() },
      fields: [
        companyField(cid),
        { key: 'date', label: 'Date', type: 'date', required: true },
        { key: 'amount', label: 'Amount (৳)', type: 'money', required: true, min: 1,
          hint: 'Cash on hand now: ' + ui.money(cashBal(cid)) },
        { key: 'account', label: 'What it paid for', type: 'select', required: true,
          options: acctOpts(['2000', 'expense']),
          hint: 'An expense head (5xxx), or 2000 Accounts Payable when settling a vendor bill already on the books.' },
        { key: 'party', label: 'Paid to (party)', type: 'text' },
        { key: 'ref', label: 'Reference', type: 'text', placeholder: 'e.g. voucher / bill no' },
        { key: 'memo', label: 'Note', type: 'text', col2: true }
      ],
      saveLabel: 'Post Cash Out',
      onSave: function (v) {
        var amt = Math.round(+v.amount || 0);
        if (amt <= 0) { ui.toast('Enter the amount', 'error'); return false; }
        if (!v.account) { ui.toast('Pick the head it paid for', 'error'); return false; }
        return postCash({ id: 'GL-CSH-' + ui.uid('').slice(-7).toUpperCase(), date: v.date, companyId: v.companyId,
          ref: v.ref || '', memo: v.memo || ('Cash out — ' + (v.party || 'payment')), source: 'cash', party: v.party || '',
          lines: [{ account: v.account, dr: amt, cr: 0 }, { account: '1000', dr: 0, cr: amt }] },
          'Cash out ' + ui.money(amt));
      }
    });
  }

  // Deposit / withdraw are ONE form because they are the same movement in two
  // directions: GL 1000↔1010 plus the bank-register leg via EPAL.bankTxnApply —
  // the same shared applier Manage Banks and Manage Loan use, so the register,
  // bank.balance and the reconciliation float all stay honest.
  function bankMoveForm(cid, dir) {
    var toBank = dir === 'deposit';
    // SCOPE RULE (review finding 2026-07-15): the journal books BOTH legs under
    // the bank's company — a deposit is that company's drawer going into that
    // company's bank. So when the desk is scoped to one company, only ITS banks
    // are offered; otherwise a Travels-scoped user could pick a Woodart bank
    // and move Woodart's drawer while watching Travels' numbers not change.
    // Cross-company money movements belong to the ledger's inter-company flow
    // (1300/2400), not to a cash deposit.
    var bankList = db().col('banks').filter(function (b) {
      return (b.status || 'Active') !== 'Inactive' && (b.type || '') !== 'Cash Box' && inScope(cid, b.companyId);
    });
    if (!bankList.length) { ui.toast(cid === 'all' ? 'No bank accounts yet — add one in Manage Banks first' : 'No bank accounts for ' + coName(cid) + ' — add one in Manage Banks first', 'error'); return; }
    EPAL.formModal({
      title: toBank ? 'Deposit Cash to Bank' : 'Withdraw Cash from Bank', icon: toBank ? 'bank' : 'cash-stack', size: 'md',
      record: { date: today(), bankId: bankList[0].id },
      fields: [
        { key: 'bankId', label: toBank ? 'Into bank' : 'From bank', type: 'select', required: true,
          options: bankList.map(function (b) { return [b.id, b.name + ' · ' + (b.account || '') + ' · ' + coName(b.companyId || 'group')]; }) },
        { key: 'date', label: 'Date', type: 'date', required: true },
        { key: 'amount', label: 'Amount (৳)', type: 'money', required: true, min: 1,
          hint: toBank ? ('Cash on hand: ' + ui.money(cashBal(cid)) + ' — depositing more than this drives the drawer negative; record the Cash In first.') : '' },
        { key: 'ref', label: 'Reference', type: 'text', placeholder: 'e.g. deposit slip no' },
        { key: 'memo', label: 'Note', type: 'text', col2: true }
      ],
      saveLabel: toBank ? 'Deposit' : 'Withdraw',
      onSave: function (v) {
        var amt = Math.round(+v.amount || 0);
        if (amt <= 0) { ui.toast('Enter the amount', 'error'); return false; }
        var bank = bankList.filter(function (b) { return b.id === v.bankId; })[0];
        if (!bank) { ui.toast('Pick the bank', 'error'); return false; }
        // the journal carries the BANK's company — that is whose money moved
        var co = bank.companyId || 'group';
        var glId = 'GL-CSH-' + ui.uid('').slice(-7).toUpperCase();
        var desc = (toBank ? 'Cash deposit' : 'Cash withdrawal') + ' — ' + bank.name;
        return postCash({ id: glId, date: v.date, companyId: co, ref: v.ref || '', memo: v.memo || desc,
          source: 'cash', party: bank.name,
          lines: toBank
            ? [{ account: '1010', dr: amt, cr: 0 }, { account: '1000', dr: 0, cr: amt }]
            : [{ account: '1000', dr: amt, cr: 0 }, { account: '1010', dr: 0, cr: amt }] },
          (toBank ? 'Deposited ' : 'Withdrew ') + ui.money(amt) + (toBank ? ' → ' : ' ← ') + bank.name,
          // the register leg — runs only after the journal is accepted (a
          // locked period throws before this) and before the single re-render
          function () { if (EPAL.bankTxnApply) EPAL.bankTxnApply(bank, toBank ? 'deposit' : 'withdraw', amt, v.date, desc, v.ref || '', glId); });
      }
    });
  }

  /* ==========================================================================
   * THE DESK
   * ========================================================================*/
  /* The desk's own tabs. A COMPANY desk can hand in its own (see opts.tabs
     below): at group level the sub-books are read-only mirrors — entry belongs
     to each company's screens (owner decision) — but when Travels mounts this
     desk INSIDE its own Accounts module, that desk IS the company screen, so it
     supplies its real entry views instead of the mirrors. */
  var BASE_TABS = [['overview', 'Overview', function (p, c) { overviewView(p, c); }],
    ['hard', 'Hard Cash', function (p, c) { hardView(p, c); }],
    ['sales', 'Cash in Sell', function (p, c) { salesView(p, c); }],
    ['petty', 'Petty Cash', function (p, c) { pettyView(p, c); }],
    ['cheques', 'Cheques', function (p, c) { chequesView(p, c); }]];

  // Cash-in-Sell only means something where there is a till. The POS book is
  // the shop's, so a scope with no POS module (e.g. Travels) would otherwise
  // show a permanently empty tab.
  function scopeHasPos(cid) {
    if (cid === 'all') return true;
    return !!(EPAL.config && EPAL.config.module && EPAL.config.module(cid, 'pos'));
  }

  /* opts.tabs — [[id, label, renderFn], …]. An id that already exists REPLACES
     that tab (same slot, so the order stays predictable); a new id is inserted
     right after Hard Cash, next to the book it belongs with. */
  function deskTabs(cid, opts) {
    // Owner 2026-07-19: show "Cash in Sell" on EVERY company (not only where a
    // POS till exists) — each concern takes cash against sales. Companies with
    // no POS show its honest empty state until cash sales are recorded.
    void scopeHasPos;   // retained for reference; no longer gates the tab
    var tabs = BASE_TABS.map(function (t) { return t.slice(); });
    ((opts && opts.tabs) || []).forEach(function (x) {
      var i = -1;
      tabs.forEach(function (t, n) { if (t[0] === x[0]) i = n; });
      if (i >= 0) { tabs[i] = x.slice(); return; }
      var after = -1;
      tabs.forEach(function (t, n) { if (t[0] === 'hard') after = n; });
      tabs.splice(after + 1, 0, x.slice());
    });
    return tabs;
  }

  var tab = 'overview';
  EPAL.cashDesk = function (page, cid, opts) {
    opts = opts || {};
    // opts.tab — open on a given book. Lets a host module keep deep links alive
    // (Travels' old /cheques, /cashbook, /pettycash routes open the desk on that
    // tab instead of 404-ing) without the desk owning the router.
    if (opts.tab) tab = opts.tab;
    var host = el('div');
    function draw() {
      host.innerHTML = '';
      var TABS = deskTabs(cid, opts);
      // a tab that vanished with the scope (Cash in Sell) must not strand the desk
      if (!TABS.some(function (t) { return t[0] === tab; })) tab = TABS[0][0];
      var bar = el('div.pill-tab');
      TABS.forEach(function (t) { bar.appendChild(el('button' + (tab === t[0] ? '.active' : ''), { text: t[1], onclick: function () { tab = t[0]; draw(); } })); });
      var row = el('div.nav-row.mb-3');
      row.appendChild(bar);
      if (opts && opts.rightEl) {
        row.appendChild(el('div.vsep'));
        opts.rightEl.classList.remove('mb-3'); opts.rightEl.classList.remove('flex-wrap'); opts.rightEl.classList.add('co-sw');
        row.appendChild(opts.rightEl);
      }
      host.appendChild(row);
      var body = el('div');
      // render through the resolved tab list, so an injected/overridden tab
      // (a company desk's own entry screen) is what actually draws
      var cur = TABS.filter(function (t) { return t[0] === tab; })[0] || TABS[0];
      cur[2](body, cid);
      host.appendChild(body);
    }
    draw();
    page.appendChild(host);
  };

  /* ---------------------------------------------------------- OVERVIEW */
  function overviewView(page, cid) {
    var ym = today().slice(0, 7);
    var onHand = cashBal(cid);
    var flt = floatOf(cid);
    var sales = cashSales(cid);
    var salesMtd = sales.filter(function (o) { return String(o.date).slice(0, 7) === ym; })
      .reduce(function (a, o) { return a + keptOf(o); }, 0);
    var petty = pettyList(cid);
    var pettyOpen = petty.filter(function (p) { return p.status === 'Open'; })
      .reduce(function (a, p) { return a + (+p.amount || 0); }, 0);
    var chq = chequeList(cid);
    var chqPending = chq.filter(function (c) { return c.status === 'Pending'; })
      .reduce(function (a, c) { return a + (+c.amount || 0); }, 0);

    // five facts, five tiles — the house cap; each names one of the books
    page.appendChild(el('div.kpi-grid.kpi-compact.stagger', null, [
      kpi('Cash on Hand', ui.money(onHand, { compact: true }), 'cash-stack', onHand < 0 ? 'text-bad' : null),
      kpi('Unbanked Float', ui.money(flt, { compact: true }), 'shield-check', Math.abs(flt) < 1 ? 'text-good' : 'text-warn'),
      kpi('Cash Sales MTD', ui.money(salesMtd, { compact: true }), 'basket'),
      kpi('Petty Open', ui.money(pettyOpen, { compact: true }), 'wallet2'),
      kpi('Cheques Pending', ui.money(chqPending, { compact: true }), 'receipt', chqPending ? 'text-warn' : null)
    ]));

    // The four books side by side — mirrors what Manage Loan does for its
    // portfolio. Money is NOT netted across books: drawer cash, uncollected
    // counter cash, staff IOUs and uncleared cheques are different promises.
    var rows = cashRows(cid);
    var mtdIn = 0, mtdOut = 0;
    rows.forEach(function (r) { if (String(r.date).slice(0, 7) === ym) { mtdIn += r.dr; mtdOut += r.cr; } });
    var grid = el('div.grid-auto');
    grid.appendChild(el('div.card', null, [
      el('div.card-head', null, [el('h3', { html: ui.icon('cash-stack') + ' Hard Cash' }), el('span.card-sub', { text: 'GL 1000' })]),
      el('div.card-body', null, [
        el('div.stat-row.stat-2.mb-2', null, [
          el('div.stat', null, [el('div.stat-label', { text: 'In the drawer' }), el('div.stat-value.num' + (onHand < 0 ? '.text-bad' : ''), { text: ui.money(onHand, { compact: true }) })]),
          el('div.stat', null, [el('div.stat-label', { text: 'Movements' }), el('div.stat-value', { text: String(rows.length) })]),
          el('div.stat', null, [el('div.stat-label', { text: 'In · ' + ym }), el('div.stat-value.num.text-good', { text: ui.money(mtdIn, { compact: true }) })]),
          el('div.stat', null, [el('div.stat-label', { text: 'Out · ' + ym }), el('div.stat-value.num', { text: ui.money(mtdOut, { compact: true }) })])
        ]),
        el('div.text-mute.xs', { text: 'The real ledger account — every row here is a posted journal.' }),
        el('button.btn.btn-sm.btn-primary.mt-2', { html: ui.icon('list-ul') + ' Open the register', onclick: function () { tab = 'hard'; EPAL.router.render(); } })
      ])
    ]));
    grid.appendChild(el('div.card', null, [
      el('div.card-head', null, [el('h3', { html: ui.icon('basket') + ' Cash in Sell' }), el('span.card-sub', { text: 'POS' })]),
      el('div.card-body', null, [
        el('div.stat-row.stat-2.mb-2', null, [
          el('div.stat', null, [el('div.stat-label', { text: 'Cash orders' }), el('div.stat-value', { text: String(sales.length) })]),
          el('div.stat', null, [el('div.stat-label', { text: 'Taken · ' + ym }), el('div.stat-value.num', { text: ui.money(salesMtd, { compact: true }) })])
        ]),
        el('div.text-mute.xs', { text: 'Counter cash sits in 1200 Receivable until collected — use Cash In to bring it onto 1000.' }),
        el('button.btn.btn-sm.btn-outline.mt-2', { html: ui.icon('basket') + ' See the sales', onclick: function () { tab = 'sales'; EPAL.router.render(); } })
      ])
    ]));
    grid.appendChild(el('div.card', null, [
      el('div.card-head', null, [el('h3', { html: ui.icon('wallet2') + ' Petty Cash' }), el('span.card-sub', { text: 'company books' })]),
      el('div.card-body', null, [
        el('div.stat-row.stat-2.mb-2', null, [
          el('div.stat', null, [el('div.stat-label', { text: 'Open IOUs' }), el('div.stat-value', { text: String(petty.filter(function (p) { return p.status === 'Open'; }).length) })]),
          el('div.stat', null, [el('div.stat-label', { text: 'With staff' }), el('div.stat-value.num' + (pettyOpen ? '.text-warn' : ''), { text: ui.money(pettyOpen, { compact: true }) })])
        ]),
        el('div.text-mute.xs', { text: 'Entered on each company’s own screen; settlement posts to 1000 by itself.' }),
        el('button.btn.btn-sm.btn-outline.mt-2', { html: ui.icon('wallet2') + ' See the book', onclick: function () { tab = 'petty'; EPAL.router.render(); } })
      ])
    ]));
    grid.appendChild(el('div.card', null, [
      el('div.card-head', null, [el('h3', { html: ui.icon('receipt') + ' Cheques' }), el('span.card-sub', { text: 'tracking' })]),
      el('div.card-body', null, [
        el('div.stat-row.stat-2.mb-2', null, [
          el('div.stat', null, [el('div.stat-label', { text: 'Pending' }), el('div.stat-value', { text: String(chq.filter(function (c) { return c.status === 'Pending'; }).length) })]),
          el('div.stat', null, [el('div.stat-label', { text: 'Value pending' }), el('div.stat-value.num' + (chqPending ? '.text-warn' : ''), { text: ui.money(chqPending, { compact: true }) })])
        ]),
        el('div.text-mute.xs', { text: 'Issued & received with clearing status — a tracking book, off the GL.' }),
        el('button.btn.btn-sm.btn-outline.mt-2', { html: ui.icon('receipt') + ' See the register', onclick: function () { tab = 'cheques'; EPAL.router.render(); } })
      ])
    ]));
    page.appendChild(grid);

    // last few drawer movements right on the overview — the pulse
    page.appendChild(el('div.section-label', { html: ui.icon('clock-history') + ' Latest cash movements' }));
    page.appendChild(el('div.card', null, [el('div.card-pad', null, [registerTable(rows.slice(0, 8), cid, { pageSize: 8, slim: true }).el])]));
  }

  /* ---------------------------------------------------------- HARD CASH */
  function registerTable(rows, cid, opts) {
    opts = opts || {};
    function drcr(v) { v = +v || 0; return '<span class="num nowrap' + (v < 0 ? ' text-bad' : '') + '">' + ui.money(Math.abs(v)) + ' ' + (v < 0 ? 'Cr' : 'Dr') + '</span>'; }
    return EPAL.table({
      columns: [
        { key: 'date', label: 'Date', date: true },
        { key: 'ref', label: 'Reference', render: function (r) { return r.ref ? '<span class="mono">' + esc(r.ref) + '</span>' : '<span class="text-mute">—</span>'; } },
        { key: 'memo', label: 'Description / Note', render: function (r) {
          return esc(r.memo || '') + (r.party ? '<div class="text-mute xs">' + esc(r.party) + '</div>' : ''); } },
        { key: 'companyId', label: 'Company', render: function (r) { return '<span class="badge">' + esc(coName(r.companyId)) + '</span>'; },
          sortVal: function (r) { return coName(r.companyId); }, exportVal: function (r) { return coName(r.companyId); } },
        { key: 'dr', label: 'In', num: true, render: function (r) { return r.dr ? '<span class="num text-good">' + ui.money(r.dr) + '</span>' : '—'; }, exportVal: function (r) { return r.dr || ''; } },
        { key: 'cr', label: 'Out', num: true, render: function (r) { return r.cr ? '<span class="num text-bad">' + ui.money(r.cr) + '</span>' : '—'; }, exportVal: function (r) { return r.cr || ''; } },
        { key: 'after', label: 'Cash Balance', num: true, render: function (r) { return drcr(r.after); }, exportVal: function (r) { return r.after; } }
      ],
      rows: rows, pageSize: opts.pageSize || 15,
      searchKeys: opts.slim ? undefined : ['memo', 'party', 'ref'],
      exportName: 'hard-cash-register.csv', pdfTitle: 'Hard Cash Register — ' + coName(cid === 'all' ? 'group' : cid),
      empty: { icon: 'cash-stack', title: 'No cash movements yet', hint: 'Cash In / Cash Out and bank deposits & withdrawals appear here as posted journals.' }
    });
  }
  function hardView(page, cid) {
    var rows = cashRows(cid);
    // actions live on THIS book because this is the book they post to
    if (can()) page.appendChild(el('div.flex.gap-1.flex-wrap.mb-2', null, [
      el('button.btn.btn-sm.btn-primary', { html: ui.icon('box-arrow-in-down-left') + ' Cash In', onclick: function () { cashInForm(cid); } }),
      el('button.btn.btn-sm', { html: ui.icon('box-arrow-up-right') + ' Cash Out', onclick: function () { cashOutForm(cid); } }),
      el('button.btn.btn-sm.btn-outline', { html: ui.icon('bank') + ' Deposit to Bank', onclick: function () { bankMoveForm(cid, 'deposit'); } }),
      el('button.btn.btn-sm.btn-outline', { html: ui.icon('cash-coin') + ' Withdraw from Bank', onclick: function () { bankMoveForm(cid, 'withdraw'); } })
    ]));
    // per-company drawer balances — tap to see one company's cash story
    if (cid === 'all') {
      var strip = el('div.flex.gap-2.flex-wrap.mb-2');
      [['group', 'Group HQ']].concat(comps().map(function (c) { return [c.id, c.short]; })).forEach(function (o) {
        var b = cashBal(o[0]);
        if (!b && !cashRows(o[0]).length) return;            // silent zero books stay out of the strip
        strip.appendChild(el('div.card', { style: { padding: '10px 14px', minWidth: '150px' } }, [
          el('div.fw-600.sm', { text: o[1] }),
          el('div.strong.num' + (b < 0 ? '.text-bad' : ''), { text: ui.money(b) })
        ]));
      });
      if (strip.children.length) page.appendChild(strip);
    }
    page.appendChild(el('div.card', null, [el('div.card-pad', null, [registerTable(rows, cid).el])]));
  }

  /* ---------------------------------------------------------- CASH IN SELL */
  function salesView(page, cid) {
    var rows = cashSales(cid);
    var t = EPAL.table({
      columns: [
        { key: 'date', label: 'Date', date: true },
        { key: 'id', label: 'Order', render: function (o) { return '<span class="mono">' + esc(o.id) + '</span>'; } },
        { key: 'customer', label: 'Customer', render: function (o) { return '<span class="strong">' + esc(o.customer || 'Walk-in') + '</span>'; } },
        { key: 'payStatus', label: 'Status', badge: { Paid: 'good', Partial: 'warn', Due: 'bad' } },
        { key: 'amount', label: 'Bill', num: true, money: true },
        { key: 'tendered', label: 'Tendered', num: true, money: true },
        { key: 'kept', label: 'Cash Kept', num: true, render: function (o) { return '<span class="num text-good">' + ui.money(keptOf(o)) + '</span>'; },
          sortVal: keptOf, exportVal: keptOf }
      ],
      rows: rows, pageSize: 15, searchKeys: ['id', 'customer'], quickFilter: 'payStatus',
      exportName: 'cash-sales.csv', pdfTitle: 'Cash Sales — ' + coName(cid === 'all' ? 'group' : cid),
      empty: { icon: 'basket', title: 'No cash sales yet for ' + coName(cid === 'all' ? 'group' : cid), hint: 'Cash taken at the counter against a sale appears here once recorded.' }
    });
    page.appendChild(el('div.card', null, [
      el('div.card-head', null, [el('h3', { html: ui.icon('basket') + ' Cash Taken at the Counter — ' + coName(cid === 'all' ? 'group' : cid) }),
        el('span.card-sub', { text: 'read-only — recorded against sales' })]),
      el('div.card-body', null, [
        el('div.text-mute.sm.mb-2', { html: 'Book-keeping note: the GL posts a cash sale to <span class="mono">1200 Accounts Receivable</span>, so the drawer money below is not on <span class="mono">1000 Cash</span> until it is collected — post a <b>Cash In</b> (defaults to 1200) from the Hard Cash book to bring it on.' }),
        t.el
      ])
    ]));
  }

  /* ---------------------------------------------------------- PETTY CASH */
  function pettyView(page, cid) {
    var rows = pettyList(cid);
    var t = EPAL.table({
      columns: [
        { key: 'date', label: 'Given', date: true },
        { key: 'staff', label: 'Staff', render: function (p) { return '<span class="strong">' + esc(p.staff) + '</span>'; } },
        { key: 'purpose', label: 'Purpose' },
        { key: 'companyId', label: 'Company', render: function (p) { return '<span class="badge">' + esc(coName(p.companyId)) + '</span>'; },
          sortVal: function (p) { return coName(p.companyId); }, exportVal: function (p) { return coName(p.companyId); } },
        { key: 'status', label: 'Status', badge: { Open: 'warn', Settled: 'good' } },
        { key: 'amount', label: 'IOU', num: true, money: true },
        { key: 'billAmount', label: 'Billed', num: true, render: function (p) { return p.billAmount ? '<span class="num">' + ui.money(p.billAmount) + '</span>' : '—'; }, exportVal: function (p) { return p.billAmount || ''; } }
      ],
      rows: rows, pageSize: 15, searchKeys: ['staff', 'purpose'], quickFilter: 'status', totalKey: 'amount',
      exportName: 'petty-cash.csv', pdfTitle: 'Petty Cash — group view',
      empty: { icon: 'wallet2', title: 'No petty-cash slips', hint: 'IOUs are issued on each company’s Accounts › Petty Cash screen.' }
    });
    page.appendChild(el('div.card', null, [
      el('div.card-head', null, [el('h3', { html: ui.icon('wallet2') + ' Petty Cash — all companies' }),
        el('span.card-sub', { text: 'read-only — entry stays on the company screens' })]),
      el('div.card-body', null, [
        el('div.text-mute.sm.mb-2', { html: 'Issue & settle in <a class="text-accent" href="#/travels/accounts/pettycash">Travels › Accounts › Petty Cash</a>. A settlement posts <span class="mono">DR expense / CR 1000</span> on its own, so it lands in the Hard Cash register automatically.' }),
        t.el
      ])
    ]));
  }

  /* ---------------------------------------------------------- CHEQUES */
  function chequesView(page, cid) {
    var rows = chequeList(cid);
    var t = EPAL.table({
      columns: [
        { key: 'date', label: 'Date', date: true },
        { key: 'number', label: 'Cheque No', render: function (c) { return '<span class="mono">' + esc(c.number) + '</span>'; } },
        { key: 'type', label: 'Type', badge: { Issued: 'info', Received: 'accent' } },
        { key: 'bank', label: 'Bank' },
        { key: 'party', label: 'Party', render: function (c) { return '<span class="strong">' + esc(c.party) + '</span>'; } },
        { key: 'companyId', label: 'Company', render: function (c) { return '<span class="badge">' + esc(coName(c.companyId)) + '</span>'; },
          sortVal: function (c) { return coName(c.companyId); }, exportVal: function (c) { return coName(c.companyId); } },
        { key: 'status', label: 'Status', badge: { Pending: 'warn', Cleared: 'good', Bounced: 'bad' } },
        { key: 'amount', label: 'Amount', num: true, money: true }
      ],
      rows: rows, pageSize: 15, searchKeys: ['number', 'party', 'bank'], quickFilter: 'status', totalKey: 'amount',
      exportName: 'cheque-register.csv', pdfTitle: 'Cheque Register — group view',
      empty: { icon: 'receipt', title: 'No cheques on record', hint: 'Cheques are registered on each company’s Accounts › Cheque Register screen.' }
    });
    page.appendChild(el('div.card', null, [
      el('div.card-head', null, [el('h3', { html: ui.icon('receipt') + ' Cheque Register — all companies' }),
        el('span.card-sub', { text: 'read-only — entry stays on the company screens' })]),
      el('div.card-body', null, [
        el('div.text-mute.sm.mb-2', { html: 'Register & clear in <a class="text-accent" href="#/travels/accounts/cheques">Travels › Accounts › Cheque Register</a>. The cheque book tracks paper — the money itself moves on the bank/cash books when it clears.' }),
        t.el
      ])
    ]));
  }
})(window.EPAL);
