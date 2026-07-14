/* ============================================================================
 * EPAL GROUP ERP  ·  assets/js/engines/ledger.js   (EPAL.ledger)
 * ----------------------------------------------------------------------------
 * WHAT: The double-entry accounting engine — the single financial source of
 *   truth for the whole group. Every taka that moves is recorded as a balanced
 *   journal entry (Sum of debits === Sum of credits). From this one journal it
 *   derives the Trial Balance, P&L, Balance Sheet, AR/AP party subledgers,
 *   aging buckets, and a CONSOLIDATED (multi-company) trial balance that
 *   eliminates inter-company balances. It self-registers with engines.js:
 *   seed() builds the COA and backfills history from seeded sales/banks/expenses;
 *   boot() subscribes to `sale:recorded` so any new sale anywhere auto-posts.
 *
 * DATA IT OWNS (localStorage stores; seeded idempotently via seedOnce):
 *   coa        — { code:string, name:string,
 *                  type:enum(asset|liability|equity|income|expense),
 *                  normal:enum(debit|credit), group:string, intercompany?:bool }
 *   gl_entries — { id:'JV-…'|'GL-…', date:'YYYY-MM-DD', companyId, ref, memo,
 *                  source:enum(sale|manual|payroll|refund|opening|intercompany|…),
 *                  party:string, lines:[{account:code, dr:number, cr:number}],
 *                  posted:true, created:ms }
 *
 * BUSINESS RULES (the "why" a developer MUST preserve):
 *   - BALANCING INVARIANT: an entry may only post if |Sum(dr) - Sum(cr)| <= TOL
 *     (0.5 float tolerance). post() THROWS on imbalance — never persist a
 *     lopsided journal. This is the one rule the whole finance model rests on.
 *   - normal side is derived from account type (asset/expense => debit, else
 *     credit); a signed balance is measured on that normal side.
 *   - CONSOLIDATION: accounts flagged intercompany (1300/2400) net to zero at
 *     group level — their balance moves into an "elimination" column so the
 *     group figures aren't double-counted when A invoices B inside the group.
 *   - AUTO-POST ON SALE: one sale => DR 1200 AR / CR 4000 Revenue, plus (if
 *     cost>0) DR 5000 COGS / CR 2000 AP. Guarded against double-posting by sale
 *     ref / GL-S<id> so replaying `sale:recorded` cannot post twice (idempotent).
 *   - AGING is FIFO: payments settle the OLDEST open invoice first, then the
 *     remaining balance is bucketed current / 1-30 / 31-60 / 60+ by invoice age.
 *   - SEED is idempotent and deterministic (survives db.reset): expenses are a
 *     fixed fraction of each company's own revenue so the demo P&L is stable.
 *
 * PUBLIC API (window.EPAL.ledger):
 *   accounts() / account(code) / ensureAccount(code,name,type)
 *   post({date,companyId,ref,memo,source,party,lines}) -> entry  (validates + emits)
 *   entries(filter{companyId,account,party,source,from,to}) -> rows asc
 *   balance(code,{companyId,asOf}) -> signed number on normal side
 *   trialBalance(companyId?) -> [{code,name,type,debit,credit}]
 *   ledgerFor(code,{companyId}) / partyLedger(party,{companyId}) -> running rows
 *   aging('AR'|'AP',{companyId}) -> [{party,current,d30,d60,d90,total}]
 *   pnl(companyId?,{from,to}) -> {revenue,cogs,gross,expenses,net,lines}
 *   balanceSheet(companyId?) -> {assets,liabilities,equity,totals{balanced}}
 *   consolidatedTrialBalance() -> per-company + elimination + group columns
 *   postIntercompany(fromCo,toCo,amount,opts) -> two mirrored balanced entries
 *
 * ==> LARAVEL / PHP MAPPING: `coa` -> Account model (migration accounts) and
 *   `gl_entries` -> JournalEntry hasMany JournalLine (entries + entry_lines).
 *   post() becomes a LedgerService::post() that opens a DB::transaction, asserts
 *   Sum(dr)===Sum(cr) (else throws / rolls back), and fires a LedgerPosted event.
 *   The sale:recorded auto-post is a queued listener (PostSaleToLedger job) on a
 *   SaleRecorded event — idempotent via a unique index on (source,ref). Trial
 *   balance / P&L / balance sheet / aging are read-model query methods (or DB
 *   views); consolidation is a scope that groups by company and zeroes the
 *   intercompany accounts. Auditing rides on Laravel model events.
 *
 * NOTE: never write a literal star-slash inside this comment (it would close it).
 * ==========================================================================*/

(function (EPAL) {
  'use strict';

  var S = EPAL.store, bus = EPAL.bus, ui = EPAL.ui;

  var COA_KEY = 'coa';
  var GL_KEY  = 'gl_entries';

  var TOL = 0.5;                       // float tolerance for balance check
  var TODAY = new Date(2026, 6, 5);    // demo "today" = 2026-07-05 (for aging)

  var _seq = 0;                        // runtime entry-id counter

  /* ==========================================================================
   * STANDARD CHART OF ACCOUNTS
   * ========================================================================*/
  var STANDARD_COA = [
    { code: '1000', name: 'Cash',                  type: 'asset',     group: 'Current Assets' },
    { code: '1010', name: 'Bank',                  type: 'asset',     group: 'Current Assets' },
    { code: '1150', name: 'Sub-Agent Receivable',  type: 'asset',     group: 'Current Assets' },
    { code: '1200', name: 'Accounts Receivable',   type: 'asset',     group: 'Current Assets' },
    { code: '1300', name: 'Inter-company Receivable', type: 'asset',  group: 'Current Assets', intercompany: true },
    { code: '1400', name: 'Inventory',             type: 'asset',     group: 'Current Assets' },
    { code: '1500', name: 'Fixed Assets',          type: 'asset',     group: 'Non-current Assets' },
    { code: '2000', name: 'Accounts Payable',      type: 'liability', group: 'Current Liabilities' },
    { code: '2050', name: 'BSP Payable',           type: 'liability', group: 'Current Liabilities' },
    { code: '2200', name: 'VAT Payable',           type: 'liability', group: 'Current Liabilities' },
    { code: '2400', name: 'Inter-company Payable',  type: 'liability', group: 'Current Liabilities', intercompany: true },
    { code: '2300', name: 'Customer Advances',     type: 'liability', group: 'Current Liabilities' },
    { code: '3000', name: 'Owner Equity',          type: 'equity',    group: 'Equity' },
    { code: '3100', name: 'Retained Earnings',     type: 'equity',    group: 'Equity' },
    { code: '4000', name: 'Sales Revenue',         type: 'income',    group: 'Revenue' },
    { code: '4010', name: 'Air Ticket Sales',      type: 'income',    group: 'Revenue' },
    { code: '4020', name: 'Visa Services',         type: 'income',    group: 'Revenue' },
    { code: '4030', name: 'Package & Tour',        type: 'income',    group: 'Revenue' },
    { code: '4040', name: 'Hotel & Other Travel',  type: 'income',    group: 'Revenue' },
    { code: '4100', name: 'Commission Income',     type: 'income',    group: 'Revenue' },
    { code: '4900', name: 'Other Income',          type: 'income',    group: 'Revenue' },
    { code: '5000', name: 'Cost of Sales',         type: 'expense',   group: 'Cost of Sales' },
    { code: '5100', name: 'Salaries',              type: 'expense',   group: 'Operating Expenses' },
    { code: '5200', name: 'Rent',                  type: 'expense',   group: 'Operating Expenses' },
    { code: '5300', name: 'Utilities',             type: 'expense',   group: 'Operating Expenses' },
    { code: '5400', name: 'Marketing',             type: 'expense',   group: 'Operating Expenses' },
    { code: '5900', name: 'ADM & Penalties',       type: 'expense',   group: 'Operating Expenses' },
    { code: '6000', name: 'Bank Charges',          type: 'expense',   group: 'Operating Expenses' }
  ];

  function normalFor(type) {
    return (type === 'asset' || type === 'expense') ? 'debit' : 'credit';
  }
  function withNormal(row) {
    return { code: row.code, name: row.name, type: row.type,
             normal: row.normal || normalFor(row.type), group: row.group || '',
             intercompany: !!row.intercompany };
  }

  /* ==========================================================================
   * ACCOUNTS
   * ========================================================================*/
  function accounts() { return S.list(COA_KEY); }

  function account(code) {
    var list = accounts();
    for (var i = 0; i < list.length; i++) if (list[i].code === String(code)) return list[i];
    return null;
  }

  function ensureAccount(code, name, type) {
    code = String(code);
    var existing = account(code);
    if (existing) return existing;
    var row = withNormal({ code: code, name: name || code, type: type || 'asset', group: 'Other' });
    S.upsert(COA_KEY, row);
    return row;
  }

  /* ==========================================================================
   * POSTING
   * ========================================================================*/
  function sumSide(lines, side) {
    var t = 0;
    for (var i = 0; i < lines.length; i++) t += (+lines[i][side] || 0);
    return t;
  }

  function nextId() {
    _seq += 1;
    return 'JV-' + Date.now().toString(36).toUpperCase() + '-' + _seq;
  }

  function post(spec) {
    spec = spec || {};
    var lines = spec.lines || [];
    if (!lines.length) throw new Error('ledger.post: entry has no lines');

    // period lock (governance): a closed month blocks back-dated posting unless the
    // caller explicitly overrides (MD action). Seeds run before any lock is set.
    var lockedThrough = S.get('period_lock', null);
    if (lockedThrough && !spec.override) {
      var mo = String(spec.date || new Date().toISOString().slice(0, 10)).slice(0, 7);
      if (mo <= lockedThrough) throw new Error('Accounting period ' + mo + ' is closed (locked through ' + lockedThrough + '). Reopen it to post.');
    }

    // normalise lines to {account,dr,cr}
    var clean = [];
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i] || {};
      clean.push({ account: String(ln.account), dr: +ln.dr || 0, cr: +ln.cr || 0 });
    }
    var dr = sumSide(clean, 'dr'), cr = sumSide(clean, 'cr');
    if (Math.abs(dr - cr) > TOL) {
      throw new Error('ledger.post: entry does not balance (DR ' + dr + ' vs CR ' + cr + ')');
    }

    var entry = {
      id: spec.id || nextId(),
      date: spec.date || new Date().toISOString().slice(0, 10),
      companyId: spec.companyId || 'group',
      ref: spec.ref || '',
      memo: spec.memo || '',
      source: spec.source || 'manual',
      party: spec.party || '',
      lines: clean,
      posted: true,
      created: Date.now()
    };

    S.upsert(GL_KEY, entry);
    bus.emit('data:changed', { store: GL_KEY, action: 'upsert', record: entry });
    bus.emit('ledger:posted', entry);
    if (EPAL.audit && EPAL.audit.record) {
      try {
        EPAL.audit.record({ action: 'post', entity: 'gl_entries', entityId: entry.id,
          entityLabel: entry.ref || entry.memo || entry.id, companyId: entry.companyId });
      } catch (e) { /* audit is best-effort */ }
    }
    return entry;
  }

  /* ==========================================================================
   * QUERIES
   * ========================================================================*/
  function entryHasAccount(entry, code) {
    for (var i = 0; i < entry.lines.length; i++) if (entry.lines[i].account === code) return true;
    return false;
  }

  function entries(filter) {
    filter = filter || {};
    var rows = S.list(GL_KEY);
    var code = filter.account != null ? String(filter.account) : null;
    return rows.filter(function (e) {
      if (filter.companyId && e.companyId !== filter.companyId) return false;
      if (filter.source && e.source !== filter.source) return false;
      if (filter.party && e.party !== filter.party) return false;
      if (code && !entryHasAccount(e, code)) return false;
      if (filter.from && e.date < filter.from) return false;
      if (filter.to && e.date > filter.to) return false;
      return true;
    }).sort(byDate);
  }

  function byDate(a, b) {
    if (a.date === b.date) return (a.created || 0) - (b.created || 0);
    return a.date < b.date ? -1 : 1;
  }

  // net {dr,cr} for one account over a filtered set of entries
  function accountTotals(code, opts) {
    opts = opts || {};
    code = String(code);
    var rows = S.list(GL_KEY), dr = 0, cr = 0;
    for (var i = 0; i < rows.length; i++) {
      var e = rows[i];
      if (opts.companyId && e.companyId !== opts.companyId) continue;
      if (opts.asOf && e.date > opts.asOf) continue;
      if (opts.from && e.date < opts.from) continue;
      if (opts.to && e.date > opts.to) continue;
      for (var j = 0; j < e.lines.length; j++) {
        if (e.lines[j].account === code) { dr += (+e.lines[j].dr || 0); cr += (+e.lines[j].cr || 0); }
      }
    }
    return { dr: dr, cr: cr };
  }

  // signed balance by the account's normal side
  function balance(code, opts) {
    var t = accountTotals(code, opts || {});
    var acc = account(code);
    var normal = acc ? acc.normal : normalFor('asset');
    return normal === 'debit' ? (t.dr - t.cr) : (t.cr - t.dr);
  }

  function trialBalance(companyId) {
    var coa = accounts(), out = [];
    for (var i = 0; i < coa.length; i++) {
      var acc = coa[i];
      var t = accountTotals(acc.code, { companyId: companyId });
      var net = t.dr - t.cr;                 // + => net debit, - => net credit
      if (Math.abs(net) < 0.5 && t.dr === 0 && t.cr === 0) continue; // untouched
      out.push({ code: acc.code, name: acc.name, type: acc.type,
        debit: net > 0 ? net : 0, credit: net < 0 ? -net : 0 });
    }
    return out;
  }

  /* CONSOLIDATED trial balance across all operating companies, with an
   * inter-company elimination column. Returns per-company net columns, an
   * elimination column (inter-company accounts net out), and the group total.
   *   { companies:[{id,name}], rows:[{code,name,type,intercompany,per:{co:net},
   *     elimination, group}], totals:{per:{co:{debit,credit}}, group:{debit,credit}} } */
  function consolidatedTrialBalance() {
    var comps = (EPAL.config.companies || []).filter(function (c) {
      // Phase 3b: a deleted-folder company also drops out of the consolidation
      // (folder-presence only; identical when all present — see database.js present()).
      var present = !EPAL.discovery || EPAL.discovery.presentFor(c.id);
      return c.type === 'company' && c.enabled !== false && present;
    }).map(function (c) { return { id: c.id, name: c.name, short: c.short }; });
    var coa = accounts(), rows = [];
    comps.forEach(function (c) { c._dr = 0; c._cr = 0; });
    var groupDr = 0, groupCr = 0;
    for (var i = 0; i < coa.length; i++) {
      var acc = coa[i];
      var per = {}, touched = false, elim = 0;
      for (var k = 0; k < comps.length; k++) {
        var t = accountTotals(acc.code, { companyId: comps[k].id });
        var net = t.dr - t.cr;                 // + net debit, - net credit
        per[comps[k].id] = net;
        if (Math.abs(net) >= 0.5) touched = true;
        comps[k]._dr += net > 0 ? net : 0;
        comps[k]._cr += net < 0 ? -net : 0;
      }
      if (!touched) continue;
      // inter-company accounts are eliminated on consolidation: their summed
      // balance moves into the elimination column and is dropped from the group.
      var summed = 0; for (var p in per) if (per.hasOwnProperty(p)) summed += per[p];
      var groupNet;
      if (acc.intercompany) { elim = -summed; groupNet = 0; }
      else { elim = 0; groupNet = summed; }
      groupDr += groupNet > 0 ? groupNet : 0;
      groupCr += groupNet < 0 ? -groupNet : 0;
      rows.push({ code: acc.code, name: acc.name, type: acc.type,
        intercompany: !!acc.intercompany, per: per, elimination: elim, group: groupNet });
    }
    var totals = { per: {}, group: { debit: groupDr, credit: groupCr } };
    comps.forEach(function (c) { totals.per[c.id] = { debit: c._dr, credit: c._cr }; delete c._dr; delete c._cr; });
    return { companies: comps, rows: rows, totals: totals };
  }

  /* Post an inter-company transaction (company A invoices company B). Creates
   * two balanced, mirrored journal entries linked by an ic pair ref, using the
   * inter-company control accounts (1300 / 2400) so they eliminate on
   * consolidation. amount is the invoiced value.
   *   opts: { date, memo, revenueAccount(seller, default 4000),
   *           expenseAccount(buyer, default 5000) } */
  function postIntercompany(fromCo, toCo, amount, opts) {
    opts = opts || {};
    var amt = +amount || 0;
    var d = opts.date || new Date().toISOString().slice(0, 10);
    var pair = 'IC-' + (opts.ref || (fromCo + '-' + toCo + '-' + Math.round(amt)));
    var memo = opts.memo || ('Inter-company: ' + fromCo + ' → ' + toCo);
    // Seller (fromCo): DR Inter-company Receivable / CR Revenue
    var sell = post({ date: d, companyId: fromCo, ref: pair, memo: memo, source: 'intercompany',
      party: toCo, lines: [ { account: '1300', dr: amt, cr: 0 },
                            { account: opts.revenueAccount || '4000', dr: 0, cr: amt } ] });
    // Buyer (toCo): DR Expense / CR Inter-company Payable
    var buy = post({ date: d, companyId: toCo, ref: pair, memo: memo, source: 'intercompany',
      party: fromCo, lines: [ { account: opts.expenseAccount || '5000', dr: amt, cr: 0 },
                              { account: '2400', dr: 0, cr: amt } ] });
    EPAL.bus.emit('intercompany:posted', { from: fromCo, to: toCo, amount: amt, ref: pair });
    return { seller: sell, buyer: buy, ref: pair };
  }

  function runningRows(matchFn, normal, companyId) {
    var rows = S.list(GL_KEY).filter(function (e) {
      return !companyId || e.companyId === companyId;
    }).sort(byDate);
    var out = [], bal = 0;
    for (var i = 0; i < rows.length; i++) {
      var e = rows[i];
      for (var j = 0; j < e.lines.length; j++) {
        var ln = e.lines[j];
        if (!matchFn(ln, e)) continue;
        var d = +ln.dr || 0, c = +ln.cr || 0;
        bal += normal === 'debit' ? (d - c) : (c - d);
        out.push({ date: e.date, ref: e.ref, memo: e.memo, party: e.party,
          debit: d, credit: c, balance: bal });
      }
    }
    return out;
  }

  function ledgerFor(code, opts) {
    opts = opts || {};
    code = String(code);
    var acc = account(code);
    var normal = acc ? acc.normal : normalFor('asset');
    return runningRows(function (ln) { return ln.account === code; }, normal, opts.companyId);
  }

  // AR/AP subledger accounts
  var AR_ACCOUNTS = ['1200', '1150'];
  var AP_ACCOUNTS = ['2000', '2050', '2300'];
  function inList(code, arr) { return arr.indexOf(code) >= 0; }

  // A party statement blends their receivable + payable movement; a positive
  // running balance means the party owes us (net AR), negative means we owe.
  function partyLedger(party, opts) {
    opts = opts || {};
    return runningRowsForParty(party, opts.companyId);
  }

  function runningRowsForParty(party, companyId) {
    var rows = S.list(GL_KEY).filter(function (e) {
      return e.party === party && (!companyId || e.companyId === companyId);
    }).sort(byDate);
    var out = [], bal = 0;
    for (var i = 0; i < rows.length; i++) {
      var e = rows[i], d = 0, c = 0;
      for (var j = 0; j < e.lines.length; j++) {
        var ln = e.lines[j];
        if (inList(ln.account, AR_ACCOUNTS)) { d += (+ln.dr || 0); c += (+ln.cr || 0); }
        else if (inList(ln.account, AP_ACCOUNTS)) { c += (+ln.dr || 0); d += (+ln.cr || 0); }
      }
      if (d === 0 && c === 0) continue;
      bal += (d - c);
      out.push({ date: e.date, ref: e.ref, memo: e.memo, source: e.source,
        debit: d, credit: c, balance: bal });
    }
    return out;
  }

  /* ==========================================================================
   * AGING  (FIFO bucketing of open AR / AP invoices by invoice date)
   * ========================================================================*/
  function daysBetween(fromStr) {
    var d = new Date(fromStr);
    if (isNaN(d)) return 0;
    return Math.floor((TODAY.getTime() - d.getTime()) / 86400000);
  }

  function aging(kind, opts) {
    opts = opts || {};
    var accs = kind === 'AP' ? AP_ACCOUNTS : AR_ACCOUNTS;
    var rows = S.list(GL_KEY).filter(function (e) {
      return !opts.companyId || e.companyId === opts.companyId;
    }).sort(byDate);

    // per party: collect invoices (opening amounts) + total payments
    var byParty = {};
    function bucket(p) {
      if (!byParty[p]) byParty[p] = { invoices: [], payments: 0 };
      return byParty[p];
    }
    for (var i = 0; i < rows.length; i++) {
      var e = rows[i];
      var party = e.party || '(unassigned)';
      for (var j = 0; j < e.lines.length; j++) {
        var ln = e.lines[j];
        if (!inList(ln.account, accs)) continue;
        var d = +ln.dr || 0, c = +ln.cr || 0;
        // AR: debit raises the invoice, credit is a payment. AP: reversed.
        var invAmt = kind === 'AP' ? c : d;
        var payAmt = kind === 'AP' ? d : c;
        var b = bucket(party);
        if (invAmt > 0) b.invoices.push({ date: e.date, amt: invAmt });
        if (payAmt > 0) b.payments += payAmt;
      }
    }

    var out = [];
    Object.keys(byParty).forEach(function (party) {
      var b = byParty[party];
      var pay = b.payments;
      // FIFO: apply payments to oldest invoices first
      b.invoices.sort(byDate);
      var row = { party: party, current: 0, d30: 0, d60: 0, d90: 0, total: 0 };
      for (var k = 0; k < b.invoices.length; k++) {
        var inv = b.invoices[k], remain = inv.amt;
        if (pay > 0) { var used = Math.min(pay, remain); remain -= used; pay -= used; }
        if (remain <= 0.5) continue;
        var age = daysBetween(inv.date);
        if (age <= 0) row.current += remain;
        else if (age <= 30) row.d30 += remain;
        else if (age <= 60) row.d60 += remain;
        else row.d90 += remain;
        row.total += remain;
      }
      if (row.total > 0.5) out.push(row);
    });
    out.sort(function (a, b2) { return b2.total - a.total; });
    return out;
  }

  /* ==========================================================================
   * FINANCIAL STATEMENTS
   * ========================================================================*/
  function pnl(companyId, opts) {
    opts = opts || {};
    var q = { companyId: companyId, from: opts.from, to: opts.to };
    var coa = accounts();
    var revenue = 0, cogs = 0, expenses = 0, lines = [];
    for (var i = 0; i < coa.length; i++) {
      var a = coa[i];
      if (a.type === 'income') {
        var inc = valueOnNormal(a, q);
        revenue += inc;
        if (Math.abs(inc) > 0.5) lines.push({ code: a.code, name: a.name, amount: inc });
      } else if (a.type === 'expense') {
        var ex = valueOnNormal(a, q);
        if (a.code === '5000') cogs += ex; else expenses += ex;
        if (Math.abs(ex) > 0.5) lines.push({ code: a.code, name: a.name, amount: ex });
      }
    }
    var gross = revenue - cogs;
    return { revenue: revenue, cogs: cogs, gross: gross, expenses: expenses,
      net: gross - expenses, lines: lines };
  }

  function valueOnNormal(acc, q) {
    var t = accountTotals(acc.code, q);
    return acc.normal === 'debit' ? (t.dr - t.cr) : (t.cr - t.dr);
  }

  function balanceSheet(companyId) {
    var coa = accounts();
    var assets = [], liabilities = [], equity = [];
    var totAssets = 0, totLiab = 0, totEquity = 0;
    var income = 0, expense = 0;
    for (var i = 0; i < coa.length; i++) {
      var a = coa[i];
      var v = valueOnNormal(a, { companyId: companyId });
      if (a.type === 'asset') {
        if (Math.abs(v) > 0.5) assets.push({ code: a.code, name: a.name, amount: v });
        totAssets += v;
      } else if (a.type === 'liability') {
        if (Math.abs(v) > 0.5) liabilities.push({ code: a.code, name: a.name, amount: v });
        totLiab += v;
      } else if (a.type === 'equity') {
        if (Math.abs(v) > 0.5) equity.push({ code: a.code, name: a.name, amount: v });
        totEquity += v;
      } else if (a.type === 'income') { income += v; }
      else if (a.type === 'expense') { expense += v; }
    }
    // Fold current-period earnings into equity so the sheet balances.
    var earnings = income - expense;
    if (Math.abs(earnings) > 0.5) {
      equity.push({ code: '3200', name: 'Current Year Earnings', amount: earnings });
      totEquity += earnings;
    }
    return {
      assets: assets, liabilities: liabilities, equity: equity,
      totals: { assets: totAssets, liabilities: totLiab, equity: totEquity,
        balanced: Math.abs(totAssets - (totLiab + totEquity)) < 1 }
    };
  }

  /* ==========================================================================
   * PUBLIC API
   * ========================================================================*/
  EPAL.ledger = {
    accounts: accounts,
    account: account,
    ensureAccount: ensureAccount,
    post: post,
    entries: entries,
    balance: balance,
    trialBalance: trialBalance,
    ledgerFor: ledgerFor,
    partyLedger: partyLedger,
    aging: aging,
    pnl: pnl,
    balanceSheet: balanceSheet,
    consolidatedTrialBalance: consolidatedTrialBalance,
    postIntercompany: postIntercompany,
    // remove one journal by id (used when a mirrored quick-entry is deleted, so
    // the GL doesn't keep an orphaned posting). Prefer reversal entries for real
    // audit trails; this exists for the mirrored-entry lifecycle.
    remove: function (id) {
      var rows = S.list(GL_KEY), before = rows.length;
      rows = rows.filter(function (e) { return e.id !== id; });
      if (rows.length === before) return false;
      S.set(GL_KEY, rows);
      bus.emit('data:changed', { store: GL_KEY, action: 'delete', id: id });
      if (EPAL.audit && EPAL.audit.record) { try { EPAL.audit.record({ action: 'delete', entity: 'gl_entries', entityId: id, entityLabel: id }); } catch (e) {} }
      return true;
    },
    lockPeriod: function (ym) { S.set('period_lock', ym); bus.emit('data:changed', { store: 'period_lock' }); return ym; },
    unlockPeriod: function () { S.remove('period_lock'); bus.emit('data:changed', { store: 'period_lock' }); },
    lockedThrough: function () { return S.get('period_lock', null); }
  };

  /* ==========================================================================
   * SEED  (idempotent — survives db.reset via seedOnce)
   * ========================================================================*/
  // Categorise revenue by travel section from the sale's category/desc so income is
  // not lumped into one account (air ticket / visa / package / hotel). Explicit
  // rec.incomeAccount wins; else infer from keywords; else generic Sales Revenue.
  function incomeAccountFor(rec) {
    if (rec && rec.incomeAccount && account(rec.incomeAccount)) return rec.incomeAccount;
    var s = (((rec && rec.category) || '') + ' ' + ((rec && rec.desc) || '')).toLowerCase();
    if (/visa/.test(s)) return '4020';
    if (/package|tour|umrah|hajj|holiday/.test(s)) return '4030';
    if (/hotel|room/.test(s)) return '4040';
    if (/contract/.test(s)) return '4050';           // contract flights & files — own P&L line
    if (/air|ticket|emd|reissue|re-issue|void|flight|bsp|sector|pnr/.test(s)) return '4010';
    return '4000';
  }
  // ensure the categorised accounts exist for already-seeded installs
  function ensureExtraAccounts() {
    var extra = [
      { code: '4010', name: 'Air Ticket Sales', type: 'income', group: 'Revenue' },
      { code: '4020', name: 'Visa Services', type: 'income', group: 'Revenue' },
      { code: '4030', name: 'Package & Tour', type: 'income', group: 'Revenue' },
      { code: '4040', name: 'Hotel & Other Travel', type: 'income', group: 'Revenue' },
      { code: '4050', name: 'Contract Flights & Files', type: 'income', group: 'Revenue' },
      { code: '5350', name: 'Agent Commission', type: 'expense', group: 'Selling Expenses' }
    ];
    var coa = S.list(COA_KEY); if (!coa.length) return; var have = {}; coa.forEach(function (a) { have[a.code] = true; });
    var add = false; extra.forEach(function (x) { if (!have[x.code]) { coa.push(withNormal({ code: x.code, name: x.name, type: x.type, group: x.group })); add = true; } });
    if (add) S.set(COA_KEY, coa);
  }
  function saleEntry(sale, idx) {
    var lines = [
      { account: '1200', dr: sale.amount, cr: 0 },
      { account: incomeAccountFor(sale), dr: 0, cr: sale.amount }
    ];
    if (sale.cost > 0) {
      lines.push({ account: '5000', dr: sale.cost, cr: 0 });
      lines.push({ account: '2000', dr: 0, cr: sale.cost });
    }
    return {
      id: 'GL-S' + (sale.id || idx),
      date: sale.date || '2026-06-01',
      companyId: sale.companyId || 'group',
      ref: sale.ref || '',
      memo: sale.desc || 'Sale',
      source: 'sale',
      party: sale.customer || '',
      lines: lines,
      posted: true,
      created: sale.created || Date.now()
    };
  }

  // Monthly operating expenses are sized as a deterministic fraction of each
  // company's own posted sales revenue, so the demo P&L reads as a healthy,
  // profitable business regardless of how large the seeded sales sample is.
  var EXP_MONTHS = ['2026-04-28', '2026-05-28', '2026-06-28'];
  var EXP_NAMES = { '5100': 'Salaries', '5200': 'Rent', '5300': 'Utilities' };
  // per-month share of a company's revenue, split across the three expense heads
  var EXP_SPLIT = { '5100': 0.036, '5200': 0.015, '5300': 0.009 }; // ~6%/mo total

  function buildGlSeed() {
    var out = [];

    // 1) backfill one balanced entry per seeded sale
    var sales = (EPAL.db && EPAL.db.sales) ? EPAL.db.sales() : S.list('sales');
    for (var i = 0; i < sales.length; i++) out.push(saleEntry(sales[i], i));

    // 2) opening balances — DR Bank / CR Owner Equity from each bank position
    var banks = S.list('banks');
    for (var b = 0; b < banks.length; b++) {
      var bk = banks[b];
      var bal = +bk.balance || 0;
      if (bal <= 0) continue;
      out.push({
        id: 'GL-OB-' + bk.id, date: '2025-07-01', companyId: bk.companyId || 'group',
        ref: bk.account || bk.id, memo: 'Opening balance · ' + (bk.name || 'Bank'),
        source: 'opening', party: '',
        lines: [ { account: '1010', dr: bal, cr: 0 }, { account: '3000', dr: 0, cr: bal } ],
        posted: true, created: Date.now()
      });
    }

    // 3) summarised monthly operating expenses — DR Expense / CR Bank.
    //    Sized off each company's own seeded sales revenue (deterministic).
    var revByCompany = {};
    for (var s = 0; s < sales.length; s++) {
      var sl = sales[s];
      revByCompany[sl.companyId] = (revByCompany[sl.companyId] || 0) + (+sl.amount || 0);
    }
    Object.keys(revByCompany).forEach(function (cid) {
      var rev = revByCompany[cid];
      if (rev <= 0) return;
      for (var m = 0; m < EXP_MONTHS.length; m++) {
        var dateStr = EXP_MONTHS[m];
        Object.keys(EXP_SPLIT).forEach(function (code) {
          var amt = Math.round(rev * EXP_SPLIT[code] / 1000) * 1000; // tidy to 000s
          if (amt <= 0) return;
          out.push({
            id: 'GL-EX-' + cid + '-' + code + '-' + m,
            date: dateStr, companyId: cid,
            ref: EXP_NAMES[code] + ' ' + dateStr.slice(0, 7),
            memo: EXP_NAMES[code] + ' — ' + cid, source: 'manual', party: '',
            lines: [ { account: code, dr: amt, cr: 0 }, { account: '1010', dr: 0, cr: amt } ],
            posted: true, created: Date.now()
          });
        });
      }
    });

    // 4) inter-company transactions (eliminate on consolidation). Seller DR 1300
    //    Inter-co Receivable / CR Revenue; Buyer DR Expense / CR 2400 Inter-co Payable.
    var IC = [
      { from:'it',      to:'travels',      amt: 850000,  memo:'ERP & IT support (annual)' },
      { from:'woodart', to:'construction', amt: 1250000, memo:'Interior fit-out — site office' },
      { from:'shop',    to:'construction', amt: 180000,  memo:'Site canteen supplies' },
      { from:'it',      to:'shop',         amt: 320000,  memo:'POS software & maintenance' }
    ];
    for (var ic = 0; ic < IC.length; ic++) {
      var x = IC[ic], ref = 'IC-' + (2001 + ic), dt = '2026-06-' + String(10 + ic).padStart(2, '0');
      out.push({ id:'GL-ICS-' + ic, date: dt, companyId: x.from, ref: ref, memo: x.memo,
        source:'intercompany', party: x.to, posted: true, created: Date.now(),
        lines:[ { account:'1300', dr: x.amt, cr: 0 }, { account:'4000', dr: 0, cr: x.amt } ] });
      out.push({ id:'GL-ICB-' + ic, date: dt, companyId: x.to, ref: ref, memo: x.memo,
        source:'intercompany', party: x.from, posted: true, created: Date.now(),
        lines:[ { account:'5000', dr: x.amt, cr: 0 }, { account:'2400', dr: 0, cr: x.amt } ] });
    }

    return out;
  }

  function seed() {
    S.seedOnce(COA_KEY, STANDARD_COA.map(withNormal));
    S.seedOnce(GL_KEY, buildGlSeed());
  }

  /* ==========================================================================
   * BOOT  — auto-post every new sale to the ledger
   * ========================================================================*/
  function saleKey(rec) { return rec.ref || rec.id || ''; }

  function alreadyPosted(rec) {
    var key = saleKey(rec);
    var rows = S.list(GL_KEY);
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].source === 'sale' && (rows[i].ref === rec.ref && rec.ref) ) return true;
      if (rows[i].id === 'GL-S' + (rec.id || '')) return true;
    }
    return false;
  }

  function boot() {
    ensureExtraAccounts();
    var postedKeys = {};
    // pre-load keys from any already-posted sale entries
    var existing = S.list(GL_KEY);
    for (var i = 0; i < existing.length; i++) {
      if (existing[i].source === 'sale') postedKeys[existing[i].ref || existing[i].id] = true;
    }

    bus.on('sale:recorded', function (rec) {
      if (!rec) return;
      var key = saleKey(rec);
      if (postedKeys[key]) return;                 // seen this run
      if (alreadyPosted(rec)) { postedKeys[key] = true; return; } // seen in store
      postedKeys[key] = true;

      var amount = +rec.amount || 0, cost = +rec.cost || 0;
      var incAcct = incomeAccountFor(rec);
      var paid = rec.paid === true || rec.payStatus === 'Paid';
      var debit = paid ? '1010' : '1200';          // cash if the customer has paid, else receivable
      try {
        // revenue leg — categorised income, party = customer
        post({ id: 'GL-S' + (rec.id || key), date: rec.date, companyId: rec.companyId,
          ref: rec.ref, memo: rec.desc || 'Sale', source: 'sale', party: rec.customer || '',
          lines: [ { account: debit, dr: amount, cr: 0 }, { account: incAcct, dr: 0, cr: amount } ] });
        // cost leg — a SEPARATE entry so the vendor's payable sub-ledger is correct;
        // cash-out if the vendor is already paid (costPaid), otherwise a payable.
        if (cost > 0) {
          var creditCost = rec.costPaid === true ? '1010' : '2000';
          post({ id: 'GL-SC' + (rec.id || key), date: rec.date, companyId: rec.companyId,
            ref: rec.ref, memo: (rec.desc || 'Sale') + ' — cost', source: 'sale', party: rec.vendor || rec.customer || '',
            lines: [ { account: '5000', dr: cost, cr: 0 }, { account: creditCost, dr: 0, cr: cost } ] });
        }
      } catch (e) { console.error('[ledger] auto-post failed', e); }
    });
  }

  EPAL.registerEngine({ name: 'ledger', seed: seed, boot: boot });

})(window.EPAL = window.EPAL || {});
