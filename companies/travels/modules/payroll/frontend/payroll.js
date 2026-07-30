/* ============================================================================
 * TRAVELS · PAYROLL · LOGIC  (company-agnostic — one impl for every concern)
 * ----------------------------------------------------------------------------
 * Behaviour only — markup lives in frontend/template.html and is handed to this
 * file (by tools/build/build-module.mjs) as the string TEMPLATE_HTML. This file
 * is NOT an IIFE and has no 'use strict' of its own: the build wraps it.
 *
 * A payroll desk driven by EPAL.payroll and mounted EMBEDDED — in Master Accounts
 * (EPAL.payrollDesk) and in each company's Accounts module. ONE implementation, so
 * Master Accounts > Master Payroll and Travels/Woodart > Accounts > Payroll are the
 * same screen, same design, same logic, always. The sections are TABS (see the TABS
 * array below — do not restate the list here, it goes stale).
 *
 * ⚠ THE STANDALONE ROUTES DO NOT WORK, and this header used to claim they did.
 * EPAL.view() below registers 'cid/payroll' for five companies, but `payroll` is
 * NOT a module in platform/core/config.js and no company manifest lists it, so the
 * router 404s every #/<cid>/payroll/<tab> address. The registrations are kept (they
 * are the standalone render path, ready if the desk is ever given its own menu
 * entry) but nothing reaches them today. Owner decision 2026-07-29: leave it
 * embedded-only — a standalone entry would sit in the sidebar next to the Accounts
 * tab that already opens this exact desk. See modules/payroll/module.json.
 *
 * All accounting posts to the ledger. Every modal/form and the
 * compound-styled leaf helpers (formField, field, drow) keep their legacy
 * el()-built DOM. Never write a literal star-slash in this comment.
 *
 * OVERVIEW (owner 2026-07-28) — the payroll command centre, built to the same
 * design language as Manage Banks: a four-card dashboard row (identity panel
 * with a hero figure + drill facts + the last payroll event · a mirrored
 * sparkline · a reconciliation against the general ledger · a mini stack), then
 * the BRIEF ROW (owner 2026-07-30): an AUTOPILOT of proposed next actions, an
 * anomaly RADAR and the narrated DIGEST, three cards of one fixed height that
 * scroll inside themselves, each list critical-first.
 * The autopilot never posts by itself — every proposal is a button (owner:
 * "automation will [be] on overview, summary"). Salary Manage heads with the
 * same dashboard row, scoped to the selected month.
 * ==> LARAVEL: a PayrollController over the PayrollService.
 * ========================================================================== */

var EPAL = window.EPAL, ui = EPAL.ui, el = ui.el, db = EPAL.db, S = EPAL.store;

/* ---- template plumbing: clone a fragment, address its fill-slots ---------- */
var TPL = document.createElement('div');
TPL.innerHTML = TEMPLATE_HTML;
function frag(name) {
  var t = TPL.querySelector('template[data-tpl="' + name + '"]');
  return t.content.firstElementChild.cloneNode(true);
}
function slot(root, name) { return root.querySelector('[data-slot="' + name + '"]'); }

/* ---- real-HTML plumbing (FRONTEND BUILD LAW) -----------------------------
 * A screen / shell is written out as plain HTML in template.html; the logic only
 * clones it, writes into its [data-k] placeholders, appends widgets into its
 * [data-fill] containers, clones its [data-proto] rows once per record and wires
 * its [data-act] targets. HTML stays the foundation of the screen. */
function screen(name) { return TPL.querySelector('[data-screen="' + name + '"]').cloneNode(true); }
function shell(name) { return TPL.querySelector('[data-shell="' + name + '"]').cloneNode(true); }
function fillK(root, k, v) { var n = root.querySelector('[data-k="' + k + '"]'); if (n) n.textContent = (v == null ? '' : String(v)); return n; }
function fillH(root, k, html) { var n = root.querySelector('[data-k="' + k + '"]'); if (n) n.innerHTML = (html == null ? '' : html); return n; }
function part(root, name) { return root.querySelector('[data-el="' + name + '"]'); }
function box(root, name) { return root.querySelector('[data-fill="' + name + '"]'); }
function act(root, name, fn) {
  var n = root.querySelector('[data-act="' + name + '"]');
  if (n && fn) n.addEventListener('click', fn); else if (n) n.classList.remove('clik');
  return n;
}
// move a screen's element children onto `page` (no wrapper, no whitespace nodes)
function mountScreen(page, s) { Array.prototype.slice.call(s.children).forEach(function (c) { page.appendChild(c); }); }

/* ---- charts this desk owns ------------------------------------------------
 * EPAL.charts tracks every instance globally and the ROUTER destroys them all on
 * a route change (platform/core/router.js). That covers the standalone routes —
 * but the EMBEDDED desk (Master Accounts › Master Payroll, Travels/Woodart ›
 * Accounts › Payroll) redraws IN PLACE on a tab click, with no route change: its
 * canvases are thrown away while live Chart.js instances are still bound to them.
 * So we keep our own list and destroy only ours. A blanket EPAL.charts.destroyAll()
 * here would be wrong — it would also kill the host page's charts, which we do
 * not own and which are not being re-rendered. */
var myCharts = [];
function trackChart(c) { if (c) myCharts.push(c); return c; }
function killCharts() { myCharts.forEach(function (c) { try { c.destroy(); } catch (e) {} }); myCharts = []; }

// COMPANY-AGNOSTIC payroll desk: CID is stamped at render time.
var CID = 'travels';
function PR() { return EPAL.payroll; }

/* ============================================================================
 * ALL COMPANIES — the same desk read as ONE group payroll (owner 2026-07-29)
 * ----------------------------------------------------------------------------
 * "Make another button before Group, 'All Company', so every nav's company
 * switcher gives us a combined view. I am in the Loan section and switch to All
 * Companies, so I see all loan employees with their loan taken, paid, due — and
 * the loan transaction history of all companies."
 *
 * CID carries the sentinel 'all'. NOTHING in this desk compares CID to a company
 * id any more: every read asks `inScope(companyId)` or `scopeCids()`, which
 * answer with the one selected company in normal mode and with every PRESENT
 * company in all-companies mode. Group HQ is one of them — the group employs
 * people, which is exactly why the owner asked for a button BEFORE it. In
 * single-company mode every helper below reduces to what the code did before, so
 * nothing on a company desk moves by a pixel or a taka.
 *
 * ⚠ WHAT ALL-MODE DELIBERATELY DOES NOT DO: post a RUN. A payroll run, and the
 * salary STRUCTURE it is computed from, belong to ONE company —
 * generate/finalize/reopen/Pay-All write `pay_runs` rows keyed by company id, and
 * 'all' is not a company. Handing them the sentinel would create records against
 * a company that does not exist and silently corrupt the books. So those controls
 * are replaced by a note naming the companies and asking for one. Everything
 * keyed by EMPLOYEE keeps working untouched — a loan, an advance, a repayment, a
 * payslip, a payment, a punishment — because the engine derives the company from
 * the employee (loan/advance/bonus call compOf(empId); pay/adjustSlip read
 * slip.companyId). That is the line: read across all six, write through a person.
 * ==========================================================================*/
var ALL = 'all';
function isAll() { return CID === ALL; }
// memoised per CID: inScope() runs inside filters over every payslip/journal, so
// rebuilding the list on each row would turn a scan into a nested loop
var _scopeIds = null, _scopeMap = null, _scopeFor = null;
function scopeCids() {
  if (_scopeFor !== CID) {
    var list = (EPAL.config && EPAL.config.companies) ? EPAL.config.companies : [];
    // discovery has already pruned EPAL.config.companies, so a deleted company
    // folder is out of the group total here exactly as it is everywhere else
    _scopeIds = isAll()
      ? list.filter(function (c) { return c.enabled !== false; }).map(function (c) { return c.id; })
      : [CID];
    _scopeMap = {};
    _scopeIds.forEach(function (c) { _scopeMap[c] = 1; });
    _scopeFor = CID;
  }
  return _scopeIds;
}
function inScope(cid) { scopeCids(); return !!_scopeMap[cid]; }
// every row of a company-stamped store that this scope owns — ONE definition, so
// slips, runs and transactions can never be scoped three slightly different ways
function scoped(store) { return S.list(store).filter(function (r) { return inScope(r.companyId); }); }
function slipsIn(ym) { return scoped('pay_slips').filter(function (s) { return s.ym === ym; }); }

/* Who the screen says it is speaking for. */
function scopeShort() { return isAll() ? 'All Companies' : coShort(CID); }
function scopeFull() { return isAll() ? 'Epal Group · All Companies' : coFull(CID); }
function scopeMeta() { return isAll() ? { accent: 'var(--accent)', icon: 'grid-3x3-gap-fill' } : coMeta(CID); }
function scopeNames() { return scopeCids().map(coShort).join(' · '); }

/* THE MONTH, ACROSS THE SCOPE. A run belongs to one company, so in all-mode a
 * month is 0..6 runs that need not agree: the status is the shared one when they
 * all say the same thing and 'mixed' when they do not — never a guess. The
 * correction / pay-by dates are the LATEST of them, because that is the date by
 * which the whole group is settled, and the correction window is open if it is
 * open anywhere (something can still be corrected). In single-company mode this
 * is exactly `getRun(CID, ym)` with its status, so every caller reads alike. */
function runsIn(ym) {
  var out = [];
  scopeCids().forEach(function (c) { var r = PR().getRun(c, ym); if (r) out.push(r); });
  return out;
}
function runInfo(ym) {
  var rs = runsIn(ym), st = null, cu = '', da = '', win = false;
  rs.forEach(function (r) {
    st = (st === null || st === r.status) ? r.status : 'mixed';
    if ((r.correctionUntil || '') > cu) cu = r.correctionUntil || '';
    if ((r.dueAfter || '') > da) da = r.dueAfter || '';
  });
  scopeCids().forEach(function (c) { if (PR().inCorrectionWindow(c, ym)) win = true; });
  return { runs: rs, n: rs.length, has: rs.length > 0, run: rs[0] || null,
    status: st || 'draft', mixed: st === 'mixed',
    correctionUntil: cu, dueAfter: da, inWindow: win };
}

/* THE COMPANY COLUMN — added to every list only in all-mode, where six payrolls
 * share one table and a name alone no longer says whose employee this is. Same
 * shape Master Accounts uses on its own all-companies tables (a coloured badge,
 * the raw id in the filter), so the two screens read identically. */
function coCell(cid) {
  var c = (EPAL.config && EPAL.config.company) ? EPAL.config.company(cid) : null;
  return '<span class="badge"' + (c ? ' style="color:' + c.accent + '"' : '') + '>' + esc(coShort(cid)) + '</span>';
}
function coCol(get) {
  get = get || function (r) { return r.companyId; };
  return { key: 'companyId', label: 'Company', sortVal: function (r) { return coShort(get(r)); },
    exportVal: function (r) { return coShort(get(r)); },
    render: function (r) { return coCell(get(r)); } };
}
/* Inserted right AFTER whoever the row is about — "who, and from where" is the
 * order the eye reads it in. `at` moves it when the identity spans two columns
 * (name + employee id). The existing column ORDER is never disturbed: in
 * single-company mode this returns the very same array it was handed, so a
 * company desk is pixel-identical to what it was. */
function withCo(cols, get, at) {
  if (!isAll()) return cols;
  var i = (at == null) ? 1 : at;
  return cols.slice(0, i).concat([coCol(get)], cols.slice(i));
}
function coFilter() { return isAll() ? [{ key: 'companyId', label: 'Company' }] : []; }

/* Department cost, merged across the scope — the engine answers one company at a
 * time and "Sales" exists in more than one of them, so the group's Sales line is
 * their sum rather than six rows with the same name. Same shape and the same
 * biggest-first order the engine returns, so both callers (the ring and the
 * table) keep reading it identically. */
function deptCost() {
  if (!isAll()) return PR().departmentCost(CID);
  var by = {};
  scopeCids().forEach(function (c) {
    PR().departmentCost(c).forEach(function (r) { by[r.dept] = (by[r.dept] || 0) + r.cost; });
  });
  return Object.keys(by).map(function (k) { return { dept: k, cost: by[k] }; })
    .sort(function (a, b) { return b.cost - a.cost; });
}

/* "Paid from" options for a real company — NEVER for the 'all' sentinel.
 * EPAL.pay.accountsOf() calls ensureCashBox(owner), which CREATES the owner's
 * cash drawer: handed 'all' it would invent a cash box for a company that does
 * not exist. Every caller therefore passes the company of the row it is acting
 * on (an employee's, a request's), which is also the correct answer — it is that
 * company's account the money leaves. */
function payOptions(cid) {
  var c = (cid && cid !== ALL) ? cid : scopeCids()[0];
  return (EPAL.pay && EPAL.pay.options) ? EPAL.pay.options(c) : [['m:Bank', 'Bank'], ['m:Cash', 'Cash']];
}
function empCo(empId) { var e = empById(empId); return (e && e.companyId) || (isAll() ? scopeCids()[0] : CID); }

/* The panel that says what all-mode is showing and what it deliberately will not
 * do. It is a note, not a disabled button: the control has not been taken away,
 * it has been told which question it belongs to.
 *
 * It starts SHUT — the (i) alone, on the spot the open card's icon occupies —
 * because the note answers a question you ask once per desk, not once per tab
 * (owner 2026-07-30). The open/shut choice is remembered in a module var, so it
 * survives a tab click and a repaint: shutting it on Overview and walking to
 * Loans does not hand you the long paragraph again. It is deliberately NOT
 * persisted to the store — the first sight of all-companies mode in a session
 * should still offer the explanation. */
var noteShut = true;
function scopeNote(title, why) {
  var n = shell('scopenote');
  fillH(n, 'ico', ui.icon('info-circle'));
  fillK(n, 'title', title);
  fillK(n, 'why', why);
  var tog = part(n, 'tog');
  function paint() {
    n.classList.toggle('is-shut', noteShut);
    tog.setAttribute('aria-expanded', noteShut ? 'false' : 'true');
    tog.setAttribute('aria-label', noteShut ? 'What this tab is showing' : 'Hide this note');
    tog.title = noteShut ? title : 'Hide this note';
  }
  tog.addEventListener('click', function () { noteShut = !noteShut; paint(); });
  paint();
  return n;
}
/* TAB LABELS (owner 2026-07-29: "why scroll bar in the nav???? I said to make
 * fit in 100% and 90% windows"). Measured on the real screen: eight tabs plus
 * the six-company switcher wanted 1078px of a 960px row at 100% zoom on a 1366
 * window — it already fitted at 90%, so only 100% was broken, by ~118px. Type is
 * pinned at the 11px --fs-micro floor and the padding clamps are at their
 * minimum, so the only honest lever left was the words.
 * Three lost a qualifier that the tab's own content repeats anyway — the card
 * inside `staff` is still titled "Staff Accounts", `advance` still lists
 * "Advance Salary Requests", and on the standalone route the page H1 still reads
 * the full "Loan Management" / "Staff Accounts" / "Advance Salary" (see the
 * `titles` map below, deliberately left long). "Salary Manage" keeps its full
 * name because the digest and four hints link to it BY that name. */
var TABS = [['overview', 'Overview'], ['manage', 'Salary Manage'], ['staff', 'Staff'], ['template', 'Salary Template'], ['loans', 'Loans'], ['payslip', 'Payslip'], ['advance', 'Advance'], ['reports', 'Reports']];
var payYm = null;

/* The payroll chart-of-accounts (mirrors the engine's posting rules — see
 * platform/engines-library/payroll.js). The overview reconciles the desk's own
 * figures against THESE ledger balances, which is the whole point: the sheet and
 * the books have to say the same thing, and if they don't you should see it here
 * rather than at audit. */
var ACC = { exp: '5100', encashExp: '5150', payable: '2100', pf: '2110', tax: '2120', encashPay: '2150', adv: '1250', loan: '1260' };
function glBal(code) {
  if (!(EPAL.ledger && EPAL.ledger.balance)) return 0;
  return scopeCids().reduce(function (a, c) { return a + EPAL.ledger.balance(code, { companyId: c }); }, 0);
}
// every journal the payroll engine writes carries source:'payroll'
function payEntries(ym) {
  if (!EPAL.ledger || !EPAL.ledger.entries) return [];
  var rows;
  if (isAll()) {
    // entries() answers one company at a time and CHRONOLOGICALLY — payableAsOf()
    // and lastEventCfg() both walk this list in order, so the concatenation is
    // re-sorted by date. The sort is stable, so postings that share a date keep
    // their per-company order rather than being shuffled.
    rows = [];
    scopeCids().forEach(function (c) { rows = rows.concat(EPAL.ledger.entries({ companyId: c, source: 'payroll' }) || []); });
    rows.sort(function (a, b) { return String(a.date || '') < String(b.date || '') ? -1 : (String(a.date || '') > String(b.date || '') ? 1 : 0); });
  } else rows = EPAL.ledger.entries({ companyId: CID, source: 'payroll' });
  return ym ? rows.filter(function (e) { return String(e.date || '').slice(0, 7) === ym; }) : rows;
}

function team() {
  var rows = isAll()
    ? (db.employees ? db.employees({}) : []).filter(function (e) { return inScope(e.companyId); })
    : (db.employees ? db.employees({ companyId: CID }) : []);
  return rows.slice().sort(function (a, b) { return (a.name || '') < (b.name || '') ? -1 : 1; });
}
function empById(id) { return team().filter(function (e) { return e.id === id; })[0] || (db.employee ? db.employee(id) : null); }
// in all-mode the desk is as writable as the most permissive company on it — the
// row's own company still governs, because every write goes through an employee
function canCreate() {
  if (!EPAL.perm) return true;
  return scopeCids().some(function (c) { return EPAL.perm.can(c, 'payroll', 'create'); });
}
function esc(s) { return ui.escapeHtml(String(s == null ? '' : s)); }
function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }
function today() { return PR() ? PR().today() : '2026-07-05'; }
function sum(a, f) { return a.reduce(function (x, y) { return x + (f(y) || 0); }, 0); }
function coShort(cid) { var c = EPAL.config && EPAL.config.company ? EPAL.config.company(cid) : null; return c ? c.short : cid; }

/* THE RICH KPI TILE (owner 2026-07-29) — the same card with the three things the
 * flat one never said: which way it moved, what the number is spread across, and
 * the shape it moved in.
 *
 *   cfg = { label, value, icon, tone, foot, series, spark, goodDown }
 *
 * `series` must be a REAL month-end series (see balanceSeries / headSeries) whose
 * LAST point is the figure on the card — otherwise the pill and the line would
 * describe a different number than the one being read. Omit it and both are
 * removed rather than faked.
 *
 * `goodDown` colours the pill by MEANING rather than by direction: for money owed,
 * lent out or still to recover, falling is the good news, so a down-arrow goes
 * green. The arrow always shows the actual direction; only the colour flips.
 *
 * `spark:false` keeps the pill but drops the 52px sparkline band — used where only
 * SOME of a row's figures have a derivable history and a half-sparked row would
 * read broken. */
function kpi2(cfg) {
  var n = shell('kpitile');
  fillK(n, 'label', cfg.label);
  fillH(n, 'ico', '<i class="bi bi-' + cfg.icon + '"></i>');
  var v = fillK(n, 'value', cfg.value); if (cfg.tone) v.classList.add(cfg.tone);
  fillK(n, 'foot', cfg.foot || '');

  var t = part(n, 'trend'), tr = cfg.series ? trendFrom(cfg.series) : null;
  if (tr) {
    // arrow = which way it went · colour = whether that is good news
    var tone = (cfg.goodDown && tr.dir !== 'flat') ? (tr.dir === 'up' ? 'down' : 'up') : tr.dir;
    t.classList.add(tone);
    t.innerHTML = ui.icon(tr.dir === 'up' ? 'arrow-up-right' : tr.dir === 'down' ? 'arrow-down-right' : 'dash') + ' ' + esc(tr.val);
  } else t.parentNode.removeChild(t);

  var band = part(n, 'spark');
  if (cfg.series && cfg.series.length > 1 && cfg.spark !== false) {
    var cv = part(n, 'canvas');
    // the tile inherits the company accent; sentiment lives in the pill, never in
    // the line colour (charts.js spark() is deliberately monochrome)
    requestAnimationFrame(function () {
      if (!cv.isConnected) return;                 // tab switched before the frame ran
      var col = getComputedStyle(cv).getPropertyValue('--accent').trim() || '#1A43BF';
      trackChart(EPAL.charts.spark(cv, cfg.series, col));
    });
  } else band.parentNode.removeChild(band);
  return n;
}

/* Month-on-month movement of the last two points. Returns null when there is no
 * honest percentage to quote — fewer than two months, or a zero base (everything
 * is an infinite rise from nothing). */
function trendFrom(arr) {
  var n = arr.length;
  if (n < 2 || !arr[n - 2]) return null;
  var pct = (arr[n - 1] - arr[n - 2]) / Math.abs(arr[n - 2]) * 100;
  return { dir: pct > 0.5 ? 'up' : pct < -0.5 ? 'down' : 'flat', val: (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%' };
}

function sectionNav(sub, cid) {
  var nav = frag('nav');
  TABS.forEach(function (t) {
    var btn = frag('nav-btn'); if (sub === t[0]) btn.classList.add('active'); btn.textContent = t[1];
    btn.addEventListener('click', function () { EPAL.router.navigate(cid + '/payroll/' + t[0]); });
    nav.appendChild(btn);
  });
  return nav;
}

['travels', 'woodart', 'it', 'shop', 'construction'].forEach(function (cid) {
  EPAL.view(cid + '/payroll', {
    render: function (ctx) {
      if (CID !== cid) { payYm = null; ovMonth = null; openEmp = null; }   // reset only when switching company
      CID = cid;
      deskRedraw = null;                       // standalone: a tab click is a route change
      var sub = ctx.subId || 'overview';
      if (TABS.map(function (t) { return t[0]; }).indexOf(sub) < 0) sub = 'overview';
      var page = frag('page');
      var titles = { overview: 'Payroll Overview', staff: 'Staff Accounts', template: 'Salary Template', manage: 'Salary Manage', loans: 'Loan Management', payslip: 'Payslip', advance: 'Advance Salary', reports: 'Payroll Reports' };
      var subs = { overview: 'The payroll command centre — position, ledger reconciliation, what to do next, and what looks wrong.',
        staff: 'Everyone on this payroll — search by name or employee ID, open anyone for their complete file.',
        template: 'Every employee\'s saved salary template — components, bonus, overtime and punishments — over the statutory structure that computes everyone else.',
        manage: 'The monthly payroll run — generate, correct, finalize and pay. Posts to the ledger.', loans: 'Staff loans — disburse, track balances and record repayments.',
        payslip: 'Salary statements per employee & month, with the annual Leave-Encashment benefit.', advance: 'Advance salary — disburse and recover against future pay.',
        reports: 'Leave-encashment liability, salary due, advance & loan registers, department cost.' };
      page.appendChild(EPAL.pageHead({ eyebrow: coShort(cid) + ' › Payroll', icon: 'cash-coin', title: titles[sub], sub: subs[sub] }));
      page.appendChild(sectionNav(sub, cid));
      if (!PR()) { page.appendChild(card('Payroll engine unavailable.')); ctx.mount.appendChild(page); return; }
      deskFileOpen = null;               // the section about to draw claims it if it holds the file
      deskChanged(sub);
      VIEWS[sub](page);
      ensureEmpFile(page);               // …and if it did not, every name on it still opens the file
      ctx.mount.appendChild(page);
    }
  });
});

/* ---- EMBEDDED MODE — the SAME desk mounted inside Master Accounts (Master
 * Payroll) and inside each company's Accounts module (Travels > Accounts >
 * Payroll, Woodart > Accounts > Payroll). The sections render as a second pill
 * row; the pill-tab + nav-row shell stays legacy el() (captured there,
 * byte-identical). The section views are literally the same functions as the
 * standalone route, so design, logic and behaviour cannot diverge between the
 * group desk and a company desk. */
var deskTab = 'overview';
EPAL.payrollDesk = function (page, cid, opts) {
  /* SWITCHING COMPANY KEEPS THE SECTION (owner 2026-07-29: "suppose i am in
   * salary manage, if i switch company on the right, the menu also gets changed
   * from salary manage to overview!!! The page should stay where it was, just
   * the switcher applied"). The switcher answers "whose payroll", not "which
   * screen" — comparing Travels' salary run with Woodart's means staying on the
   * salary run. Only the MONTH selections reset: `payYm`/`ovMonth` name a month
   * that was picked from the previous company's own list of runs and need not
   * exist in the new one, so they fall back to that company's current month. The
   * eight sections exist for every company, so the tab always survives. */
  if (CID !== cid) { payYm = null; ovMonth = null; }
  CID = cid;
  var host = el('div');
  function draw() {
    deskRedraw = draw;                 // embedded: a tab click redraws in place
    killCharts();                      // …so nothing stays bound to the canvases we are about to drop
    host.innerHTML = '';
    var bar = el('div.pill-tab');
    TABS.forEach(function (t) { bar.appendChild(el('button' + (deskTab === t[0] ? '.active' : ''), { text: t[1], onclick: function () { deskTab = t[0]; draw(); } })); });
    var row = el('div.nav-row.mb-3');
    row.appendChild(bar);
    if (opts && opts.rightEl) {
      row.appendChild(el('div.vsep'));
      opts.rightEl.classList.remove('mb-3'); opts.rightEl.classList.remove('flex-wrap');
      opts.rightEl.classList.add('co-sw');
      row.appendChild(opts.rightEl);
    }
    host.appendChild(row);
    if (!PR()) { host.appendChild(card('Payroll engine unavailable.')); return; }
    var section = el('div');
    deskFileOpen = null;               // …same on the embedded desk (Master Payroll)
    deskChanged(deskTab);
    (VIEWS[deskTab] || VIEWS.overview)(section);
    ensureEmpFile(section);
    host.appendChild(section);
  }
  draw();
  page.appendChild(host);
};

/* ============================================================================
 * SHARED PIECES — the dashboard row, and the maths behind it
 * ==========================================================================*/

// slip arithmetic, hoisted so the month register, the salary sheet and the
// radar all read a payslip the SAME way. Mirrors the engine's slipPayable():
// earnedGross is already net of absence, so absence is NOT re-deducted here.
/* THE ADVANCE AND THE EMI COME FROM THE ENGINE (owner 2026-07-30: "every
 * deduction column that shows an amount must actually reduce net payable").
 * These two used to work the figure out for themselves, which is exactly how the
 * sheet came to print an EMI that the net beside it had never subtracted. They
 * now read the same slipRecovery() the net payable, the payslip, the accrual and
 * the approval check read, so the row adds up by construction. */
function recOf(s) { return PR().slipRecovery(s); }
function advOf(s) { return recOf(s).adv; }
function emiOf(s) { return recOf(s).emi; }
// what would not fit this month and rides on to the next (0 on a normal row)
function shortOf(s) { return recOf(s).short || 0; }
// (`fine` = the salary template's standing punishment + any one-off deducted on
// this month; `tplBonus` = the template's standing monthly bonus. A slip written
// before salary templates existed carries neither, so both read 0 and every old
// figure is exactly what it was.)
function otherOf(s) { return (s.tax || 0) + (s.pf || 0) + (s.lateDeduction || 0) + (s.earlyDeduction || 0) + (s.otherDeduction || 0) + (s.fine || 0); }
function addOf(s) { return (s.overtime || 0) + (s.bonus || 0) + (s.tplBonus || 0) + Math.max(0, s.adjustment || 0); }
function dedOf(s) { return otherOf(s) + Math.max(0, -(s.adjustment || 0)); }
function bonusOf(s) { return (s.bonus || 0) + (s.tplBonus || 0); }
/* PAID = the cash that actually reached the employee, and DUE = net payable less
 * that. On a month paid under the old rule the stored figure still carries the
 * advance and the EMI inside it — the engine takes them back out, so Net payable
 * − Paid = Due closes on every row ever written, and cash and paid are one
 * number now rather than two. */
function paidOf(s) { return PR().slipPaid(s); }
function dueOf(s) { return PR().slipDue(s); }
function cashOf(s) { return PR().slipPaid(s); }

/* THE NET PAYABLE CELL, and the mark a carried row wears (owner 2026-07-30:
 * "net payable must never go negative. If the deductions are larger than the
 * earnings, deduct only what is available, carry the rest to the next month, and
 * mark that row"). The engine has already capped the recovery at what the month
 * can bear; what it could not take is `short`, and it stays outstanding, so next
 * month's plan picks it up with no carry-forward record to keep in step. The
 * mark is a caret on the figure, not a column — it is one number's story. */
function netCell(s) {
  var v = PR().slipPayable(s), short = shortOf(s);
  return '<span class="num strong">' + ui.money(v) + '</span>' + (short > 0
    ? ' <span class="text-warn" title="' + esc(ui.money(short) + ' of this month\'s advance / loan recovery did not fit — it stays outstanding and comes off next month.') + '">^</span>'
    : '');
}

/* THE SALARY SHEET FOOT. One sum per numeric column, over the rows the table is
 * actually showing (the kit hands us the filtered set, never the page), read
 * through the very same helpers as the cells above them — a foot that added up
 * differently from the column it sits under would be worse than no foot. */
function sheetTotals(rows) {
  if (!rows.length) return null;
  function S(fn) { return ui.money(rows.reduce(function (a, s) { return a + (+fn(s) || 0); }, 0)); }
  return { label: rows.length + ' employee' + (rows.length === 1 ? '' : 's'), values: {
    gross: S(function (s) { return s.gross || 0; }),
    overtime: S(function (s) { return s.overtime || 0; }),
    bonus: S(bonusOf),
    encashAmt: S(function (s) { return s.encashAmt || 0; }),
    adv: S(advOf), emi: S(emiOf),
    absentDeduction: S(function (s) { return s.absentDeduction || 0; }),
    other: S(otherOf),
    net: S(function (s) { return PR().slipPayable(s); }),
    paid: S(paidOf), due: S(dueOf),
    status: '<span class="xs text-mute">' + rows.filter(function (s) { return dueOf(s) > 0; }).length + ' owed</span>'
  } };
}

function coFull(cid) { var c = EPAL.config && EPAL.config.company ? EPAL.config.company(cid) : null; return c ? (c.name || c.short || cid) : cid; }
function coMeta(cid) {
  var c = EPAL.config && EPAL.config.company ? EPAL.config.company(cid) : null;
  return { accent: (c && c.accent) ? c.accent : 'var(--accent)', icon: (c && c.icon) ? c.icon : 'cash-coin' };
}

/* Where a tab click goes depends on how the desk is mounted: standalone it is a
 * route, embedded (Master Accounts · Travels Accounts · Woodart Accounts) it is
 * an in-place redraw. One helper so every screen below is written once. */
var deskRedraw = null;
function goTab(tab) { if (deskRedraw) { deskTab = tab; deskRedraw(); return; } EPAL.router.navigate(CID + '/payroll/' + tab); }
function repaint() { EPAL.router.render(); }

/* A mirrored sparkline — up bars in green, down bars in red, a hairline zero
 * axis between them. rows = [{ up, down, tip }]. Same visual grammar as the
 * cash-flow card on Manage Banks. */
function sparkSvg(rows) {
  var W = 300, H = 52, mid = H / 2, n = Math.max(1, rows.length), slotW = W / n, bw = Math.max(2, Math.min(22, slotW - 3));
  var maxV = 1;
  rows.forEach(function (r) { maxV = Math.max(maxV, r.up || 0, r.down || 0); });
  var bars = rows.map(function (r, i) {
    var x = i * slotW + (slotW - bw) / 2, s = '';
    var hu = (r.up || 0) / maxV * (mid - 3), hd = (r.down || 0) / maxV * (mid - 3);
    var tip = r.tip ? '<title>' + esc(r.tip) + '</title>' : '';
    if ((r.up || 0) > 0) s += '<rect x="' + x.toFixed(1) + '" y="' + (mid - hu).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(1, hu).toFixed(1) + '" rx="1" fill="#23c17e">' + tip + '</rect>';
    if ((r.down || 0) > 0) s += '<rect x="' + x.toFixed(1) + '" y="' + mid.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(1, hd).toFixed(1) + '" rx="1" fill="#f0506e">' + tip + '</rect>';
    return s;
  }).join('');
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">' +
    '<line x1="0" y1="' + mid + '" x2="' + W + '" y2="' + mid + '" stroke="currentColor" stroke-opacity="0.13" stroke-width="1"/>' + bars + '</svg>';
}

/* THE DASHBOARD ROW — four same-height cards, cloned from [data-shell="dash"].
 * Overview fills it with the company's whole payroll position; Salary Manage
 * fills the identical shell with the selected month. */
function dashRow(cfg) {
  var d = shell('dash');
  part(d, 'panel').style.setProperty('--bank-hue', cfg.hue);   // custom prop: setProperty only

  fillH(d, 'ico', ui.icon(cfg.icon));
  fillK(d, 'co', cfg.co); fillK(d, 'co-sub', cfg.coSub);
  var heroV = fillK(d, 'hero', cfg.hero); if (cfg.heroBad) heroV.classList.add('text-bad');
  fillK(d, 'hero-label', cfg.heroLabel);
  var heroEl = act(d, 'hero', cfg.heroOn); if (heroEl) heroEl.setAttribute('title', cfg.heroTitle || '');

  (cfg.facts || []).forEach(function (f, i) {
    var n = i + 1;
    fillK(d, 'f' + n + 'k', f.k); fillK(d, 'f' + n + 'v', f.v);
    var el2 = act(d, 'f' + n, f.on); if (el2 && f.title) el2.setAttribute('title', f.title);
  });

  // LAST EVENT — never blank: with no history it still renders every field at
  // zero, so the card's shape is readable before the first payroll ever runs.
  var L = cfg.last || {}, lastEl = part(d, 'last');
  fillK(d, 'last-label', L.label || 'Last payroll event');
  fillK(d, 'dir', L.dirText || '—').classList.add(L.dir || 'none');
  var amtEl = fillK(d, 'amt', L.amount); if (L.amtTone) amtEl.classList.add(L.amtTone);
  fillK(d, 'when', L.when || '—');
  fillH(d, 'ref', L.refHtml || '');
  fillH(d, 'oc-open', L.openHtml || '');
  fillH(d, 'oc-close', L.closeHtml || '').classList.add(L.up ? 'up' : 'down');
  lastEl.setAttribute('title', L.title || '');
  if (L.empty) lastEl.classList.add('is-empty');
  if (L.on) lastEl.addEventListener('click', L.on);

  var F = cfg.flow;
  fillK(d, 'flow-title', F.title); fillK(d, 'flow-sub', F.sub);
  fillK(d, 'flow-net', F.net).classList.add(F.netUp ? 'is-up' : 'is-down');
  box(d, 'spark').innerHTML = sparkSvg(F.rows || []);
  fillK(d, 'flow-in', F.inText); fillK(d, 'flow-out', F.outText);
  var flowEl = part(d, 'flow');
  flowEl.setAttribute('title', F.hint || '');
  if (F.on) flowEl.addEventListener('click', F.on);

  var R = cfg.recon;
  fillH(d, 'recon-title', ui.icon(R.icon || 'shield-check') + ' ' + esc(R.title));
  (R.stats || []).forEach(function (s, i) {
    var n = i + 1;
    fillK(d, 'r' + n + 'k', s.k);
    var v = fillK(d, 'r' + n + 'v', s.v); if (s.tone) v.classList.add(s.tone);
  });
  var why = part(d, 'why');
  if (R.why) {
    why.removeAttribute('hidden');
    why.innerHTML = ui.icon('question-circle') + ' why?';
    why.addEventListener('click', function (ev) { ev.stopPropagation(); R.why(); });
  } else why.parentNode.removeChild(why);
  var reconEl = part(d, 'recon');
  reconEl.setAttribute('title', R.hint || '');
  if (R.on) reconEl.addEventListener('click', R.on);

  (cfg.minis || []).forEach(function (m, i) {
    var n = i + 1;
    fillH(d, 'm' + n + 't', m.t);
    var v = fillK(d, 'm' + n + 'v', m.v); if (m.bad) v.classList.add('text-bad');
    fillK(d, 'm' + n + 's', m.s);
    part(d, 'm' + n).addEventListener('click', m.on);
  });
  return d;
}

/* What we owe staff (2100 Salary Payable) the moment `entry` was posted — walked
 * from the payroll journals themselves, so opening/closing are exact even when
 * several postings share one date. */
function payableAsOf(entry) {
  var all = payEntries(), bal = 0;
  for (var i = 0; i < all.length; i++) {
    var lines = all[i].lines || [];
    for (var j = 0; j < lines.length; j++) {
      if (EPAL.ledger.isUnder(lines[j].account, ACC.payable)) bal += (+lines[j].cr || 0) - (+lines[j].dr || 0);
    }
    if (all[i].id === entry.id) break;
  }
  return bal;
}

/* The LAST PAYROLL EVENT as the mini-statement wants it. Cash direction comes
 * from the cash line (a payment moves money OUT); an accrual has no cash line at
 * all, so it reads ACCRUED rather than pretending to be a movement. */
function lastEventCfg(ym, label) {
  var rows = payEntries(ym);
  if (!rows.length) {
    return { label: label, empty: true, dir: 'none', dirText: '—', amount: ui.money(0), when: '—',
      refHtml: ym ? 'No payroll posting this month' : 'No payroll posting yet',
      openHtml: 'Owed before <b>' + esc(ui.money(0)) + '</b>', closeHtml: 'Owed after <b>' + esc(ui.money(0)) + '</b>', up: false,
      title: 'Nothing posted yet' };
  }
  var e = rows[rows.length - 1];                 // entries() comes back chronological
  var cashIn = 0, cashOut = 0, totalDr = 0;
  (e.lines || []).forEach(function (l) {
    var dr = +l.dr || 0, cr = +l.cr || 0; totalDr += dr;
    if (EPAL.ledger.isCashAccount(l.account)) { cashIn += dr; cashOut += cr; }
  });
  var cashNet = cashIn - cashOut;
  var dir = cashNet > 0 ? 'in' : (cashNet < 0 ? 'out' : 'none');
  var amount = cashNet !== 0 ? Math.abs(cashNet) : totalDr;
  var closing = payableAsOf(e);
  var opening = closing;
  (e.lines || []).forEach(function (l) { if (EPAL.ledger.isUnder(l.account, ACC.payable)) opening -= ((+l.cr || 0) - (+l.dr || 0)); });
  return {
    label: label,
    dir: dir, dirText: dir === 'in' ? 'IN' : (dir === 'out' ? 'OUT' : 'ACCRUED'),
    amount: (dir === 'in' ? '+' : dir === 'out' ? '−' : '') + ui.money(amount),
    amtTone: dir === 'in' ? 'in' : (dir === 'out' ? 'out' : ''),
    when: ui.date(e.date),
    refHtml: '<span class="txn-id-chip">' + esc(e.ref || e.id) + '</span>' + (e.memo ? ' ' + esc(e.memo) : ''),
    openHtml: 'Owed staff <b>' + esc(ui.money(opening)) + '</b>',
    closeHtml: 'Now owed <b>' + esc(ui.money(closing)) + '</b>',
    up: closing <= opening,                       // paying staff DOWN is the good direction
    title: 'Open this posting in the ledger',
    on: function () { EPAL.router.navigate('group/master-accounts/journals'); }
  };
}

/* The company's whole payroll position, computed once and shared by the
 * overview, the digest, the autopilot and the radar. */
function position() {
  var t = team();
  var slips = scoped('pay_slips');
  var live = slips.filter(function (s) { return s.status !== 'draft'; });
  var sheetOwed = sum(live, dueOf);
  var advOut = sum(t, function (e) { return PR().advanceOutstanding(e.id); });
  var loanOut = sum(t, function (e) { return PR().loanOutstanding(e.id); });
  // MONTHS, not run rows: in all-mode six companies each open January, and
  // "Payroll months: 6" for one month would be a lie. One run per company per
  // month means this is identical to runs.length on a single company.
  var runMonths = {};
  scoped('pay_runs').forEach(function (r) { runMonths[r.ym] = 1; });
  return {
    runMonths: Object.keys(runMonths).length,
    team: t, slips: slips, live: live,
    sheetOwed: sheetOwed,
    glPayable: glBal(ACC.payable),
    glStatutory: glBal(ACC.pf) + glBal(ACC.tax) + glBal(ACC.encashPay),
    glAdvLoan: glBal(ACC.adv) + glBal(ACC.loan),
    advOut: advOut, loanOut: loanOut,
    encashLiability: scopeCids().reduce(function (a, c) { return a + PR().encashmentLiability(c); }, 0),
    runs: scoped('pay_runs').sort(function (a, b) { return a.ym < b.ym ? 1 : -1; })
  };
}

/* The last 12 payroll months as one series (newest last) — the trend line, the
 * Monthly Register, the digest and Payroll History all read this one function,
 * so a month can never exist on one screen and be missing from another.
 * ⚠ These totals INCLUDE draft payslips (a draft month is still a month you want
 * to see); position()/sheetOwed deliberately excludes them, so never compare
 * these figures against the ledger without filtering drafts out first. */
function blankMonth(ym) {
  return { ym: ym, heads: 0, paidHeads: 0, gross: 0, adds: 0, deds: 0, net: 0, encash: 0, paid: 0, due: 0, drafts: 0 };
}
function monthSeries(limit) {
  var byYm = {};
  scoped('pay_slips').forEach(function (s) {
    var m = byYm[s.ym] || (byYm[s.ym] = blankMonth(s.ym));
    m.heads++; m.gross += s.earnedGross || 0; m.adds += addOf(s); m.deds += dedOf(s);
    m.net += PR().slipPayable(s); m.encash += s.encashAmt || 0;
    m.paid += paidOf(s); m.due += dueOf(s);
    // FULLY paid, not merely part-paid: six people each given a token amount
    // must not read as "6 / 6 staff paid" while the month is still owed.
    if (paidOf(s) > 0 && dueOf(s) === 0) m.paidHeads++;
    if (s.status === 'draft') m.drafts++;
  });
  // pay_runs is the OTHER half of the union: a run can exist before any payslip
  // does, and a month with payslips can have no run row — Payroll History has to
  // list both, so the month list is built from both.
  // In all-mode a month is up to six runs that need not agree. The status is the
  // shared one when every company says the same and 'mixed' when they do not —
  // reporting the last company's status as the group's would be a claim the data
  // does not make.
  scoped('pay_runs').forEach(function (r) {
    if (!byYm[r.ym]) byYm[r.ym] = blankMonth(r.ym);
    var m = byYm[r.ym];
    m.status = (m.status == null || m.status === r.status) ? r.status : 'mixed';
    m.runs = (m.runs || 0) + 1;
  });
  var out = Object.keys(byYm).sort().map(function (k) { return byYm[k]; });
  return limit ? out.slice(-limit) : out;
}


/* ============================================================================
 * MONTH-END BALANCE SERIES — the honest way to draw a sparkline on a BALANCE
 * ----------------------------------------------------------------------------
 * A KPI sparkline has to be built from the events that moved the balance, not
 * from a shape fitted to today's figure: every point below is what the book
 * actually said at the end of that month.
 *
 *   events = [{ ym:'YYYY-MM', empId, delta }]   (any order)
 *
 * Anything older than the window folds into the OPENING balance, so the line
 * starts where the book really stood rather than pretending it started at zero.
 * ==========================================================================*/
function monthsUpTo(n) {
  var end = PR().curYm(), y = +end.slice(0, 4), m = +end.slice(5, 7), out = [];
  for (var i = n - 1; i >= 0; i--) {
    var d = new Date(y, m - 1 - i, 1);
    out.push(d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2));
  }
  return out;
}
function balanceSeries(events, n) {
  var months = monthsUpTo(n), first = months[0], bal = 0, by = {};
  events.forEach(function (e) {
    if (!e.ym) return;
    if (e.ym < first) bal += e.delta; else by[e.ym] = (by[e.ym] || 0) + e.delta;
  });
  return months.map(function (m) { bal += (by[m] || 0); return Math.round(bal); });
}
/* The same walk counting HEADS instead of taka: how many people carried a balance
 * at each month end. A total says nothing about how many it is spread across,
 * which is the entire point of the "Active Loans" tile. */
function headSeries(events, n) {
  var months = monthsUpTo(n), first = months[0], bal = {}, by = {};
  events.forEach(function (e) {
    if (!e.ym) return;
    if (e.ym < first) bal[e.empId] = (bal[e.empId] || 0) + e.delta;
    else (by[e.ym] || (by[e.ym] = [])).push(e);
  });
  return months.map(function (m) {
    (by[m] || []).forEach(function (e) { bal[e.empId] = (bal[e.empId] || 0) + e.delta; });
    return Object.keys(bal).filter(function (k) { return bal[k] > 0.5; }).length;
  });
}
/* money going OUT only (lent / advanced) → a cumulative one-direction series */
function outflowOnly(ev) { return ev.filter(function (e) { return e.delta > 0; }); }
/* …and money coming BACK, sign-flipped so it accumulates upward */
function inflowOnly(ev) { return ev.filter(function (e) { return e.delta < 0; }).map(function (e) { return { ym: e.ym, empId: e.empId, delta: -e.delta }; }); }

/* Every dated event that moves the STAFF LOAN book. Mirrors the engine's
 * loanOutstanding() line for line — disbursement adds, a repayment (including the
 * auto EMI) subtracts, a final settlement clears whatever it cleared — so the
 * series' last point IS the figure on the card.
 *
 * Scoped by TEAM MEMBERSHIP, which is the basis loanOutstanding()/advanceOutstanding()
 * already use (they take an empId and the tab sums them over the company's team).
 * The transaction TABLES below still read their own companyId-filtered list; only
 * these tiles read this. */
function teamIds() { var m = {}; team().forEach(function (e) { m[e.id] = 1; }); return m; }
function loanEvents() {
  var ids = teamIds(), out = [];
  S.list('pay_txns').forEach(function (x) {
    if (!ids[x.empId]) return;
    var ym = String(x.date || '').slice(0, 7); if (!ym) return;
    if (x.type === 'loan') out.push({ ym: ym, empId: x.empId, delta: x.amount || 0 });
    else if (x.type === 'loan-repay') out.push({ ym: ym, empId: x.empId, delta: -(x.amount || 0) });
    else if (x.type === 'settlement' && x.loanCleared) out.push({ ym: ym, empId: x.empId, delta: -x.loanCleared });
  });
  return out;
}
/* …and for ADVANCES. One attribution note: a recovery is NOT its own transaction —
 * it is `advanceRecovered` on the payslip — so it is dated by the slip's payment
 * date, falling back to the slip's own month when a slip was never paid. */
function advanceEvents() {
  var ids = teamIds(), out = [];
  S.list('pay_txns').forEach(function (x) {
    if (!ids[x.empId]) return;
    var ym = String(x.date || '').slice(0, 7); if (!ym) return;
    if (x.type === 'advance') out.push({ ym: ym, empId: x.empId, delta: x.amount || 0 });
    else if (x.type === 'settlement' && x.advanceCleared) out.push({ ym: ym, empId: x.empId, delta: -x.advanceCleared });
  });
  S.list('pay_slips').forEach(function (s) {
    if (!ids[s.empId] || !(s.advanceRecovered > 0)) return;
    out.push({ ym: String(s.paidDate || '').slice(0, 7) || s.ym, empId: s.empId, delta: -s.advanceRecovered });
  });
  return out;
}


/* ============================================================================
 * PAYROLL HISTORY — month list → every transaction in a month → one transaction
 * ----------------------------------------------------------------------------
 * Sits under the Salary Sheet on Salary Manage (owner 2026-07-28).
 *
 * THREE THINGS THE DATA ACTUALLY SAYS, which shaped this (all verified against
 * platform/engines-library/payroll.js, not assumed):
 *
 *  1. `pay_txns` rows DO NOT store a glId. The engine builds one from a counter
 *     at post time — 'GL-ADV-<empId>-<n>' where n is that employee's n-th
 *     advance — and only the ledger keeps it. So the voucher link is REBUILT
 *     here and then CHECKED against the ledger; the button only appears when a
 *     real entry is found (glEntryFor). Guessing an id and printing a blank
 *     voucher would be worse than offering nothing.
 *  2. A payslip carries NO bank name — only a free-text `payMethod`, and only
 *     the LAST one. The account a payment truly moved through is on its ledger
 *     line, so 'Paid from' is read from the JOURNAL first and falls back to the
 *     slip's method string only when no journal exists.
 *  3. A slip can be paid in INSTALMENTS. `pay_slips` keeps running totals plus
 *     the last date/method; the individual payments exist only as
 *     'GL-PAYP-<empId>-<ym>-<n>'. So salary rows are enumerated from those
 *     journals — a partial payment shows as its own dated row, which is the
 *     whole point of a history. The slip is used only as a fallback for money
 *     that moved without a journal behind it (older/seeded data), because a
 *     payment that happened must never be invisible.
 * ==========================================================================*/

// One payroll transaction, whatever its origin, normalised to the row the
// history speaks in.
var PURPOSE = { salary: 'Salary', advance: 'Advance', loan: 'Staff loan',
  'loan-repay': 'Loan repayment', bonus: 'Bonus', 'encash-paid': 'Leave encashment',
  settlement: 'Final settlement' };
// the counter-built glId prefix per pay_txns type (see note 1 above)
var GL_PREFIX = { advance: 'GL-ADV-', loan: 'GL-LOAN-', 'loan-repay': 'GL-LREP-', bonus: 'GL-BON-' };

// the `ref` the engine stamps on each kind of journal — used to prove a journal
// found by a rebuilt id is really the RIGHT one (see glEntryFor)
var GL_REF = { advance: 'ADV-', loan: 'LOAN-', 'loan-repay': 'LREP-', bonus: 'BON-', 'encash-paid': 'ENCP-', settlement: 'SETL-' };
var EMI_MEMO = 'EMI auto-deducted from ';

function acctName(code) {
  if (!code) return '';
  var a = (EPAL.ledger && EPAL.ledger.account) ? EPAL.ledger.account(code) : null;
  return a ? a.name : String(code);
}
// A stored method string is one of: 'bank:<id>' (a real account), 'm:<Method>'
// (a generic with no account behind it), or a LEGACY PLAIN 'Bank' / 'Cash' /
// 'bKash'. There is no helper for this anywhere in the repo, and EPAL.pay
// .resolve() cannot be used as one: handed a plain 'Cash' it falls through to
// its 'Bank' default, so every legacy cash payment would read as a bank
// payment. The plain case is therefore answered BEFORE resolve() is consulted.
function paidFrom(method) {
  var m = String(method || '');
  if (m.indexOf('bank:') === 0) {
    var src = (EPAL.pay && EPAL.pay.resolve) ? EPAL.pay.resolve(m) : null;
    if (src && src.bank) return src.bank.name + (src.bank.branch && src.bank.branch !== '—' ? ' · ' + src.bank.branch : '');
    return 'Account no longer on file';           // the bank record was deleted — say so
  }
  if (m.indexOf('m:') === 0) return m.slice(2) || 'Bank';
  return m || 'Bank';                             // legacy plain label, kept verbatim
}
function findGl(id) {
  var rows = payEntries();
  for (var i = 0; i < rows.length; i++) if (rows[i].id === id) return rows[i];
  return null;
}
/* The cash leg of a journal. SIGNED on purpose: a credit to a cash account is
 * money LEAVING (positive), a debit is money ARRIVING (negative) — a loan
 * repayment is DR cash / CR 1260, so treating its cash as an outflow would add
 * money coming in to the total that left the bank. */
function entryCash(e) {
  var acct = null, net = 0;
  (e.lines || []).forEach(function (l) {
    if (!EPAL.ledger.isCashAccount(l.account)) return;
    var v = (+l.cr || 0) - (+l.dr || 0);
    if (v !== 0) { acct = l.account; net += v; }
  });
  return { account: acct, out: net };
}
function entryTotal(e) { var t = 0; (e.lines || []).forEach(function (l) { t += +l.dr || 0; }); return t; }
// an auto-deducted EMI is a LINE inside a salary payment, never its own journal
function isAutoEmi(t) { return t.type === 'loan-repay' && String(t.memo || '').indexOf(EMI_MEMO) === 0; }
// the final-settlement journal that cleared this employee on this date, if any
function settlementOn(empId, date) {
  if (!date) return null;
  var e = findGl('GL-SETL-' + empId);
  return (e && e.date === date) ? e : null;
}

/* Find the journal behind a pay_txns row — and PROVE it is the right one.
 *
 * The id has to be rebuilt from a counter (pay_txns stores none), and that
 * counter is not stable: unpay() DELETES the auto-EMI rows it created, which
 * shifts every later loan-repay's position. A rebuilt id can therefore land on
 * a real journal that belongs to a DIFFERENT transaction — printing the wrong
 * voucher, which is worse than printing none. So every candidate is validated
 * against the row (employee, kind-of-document via its ref, and amount) and a
 * failure falls through to a strictly unique party+date+amount match that is
 * itself kind-checked. Reversals (GL-UNPAY-) are never eligible. */
function glMatches(e, t) {
  if (!e || String(e.id).indexOf('GL-UNPAY-') === 0) return false;
  if (e.party !== t.empId) return false;
  if (Math.abs(entryTotal(e) - (+t.amount || 0)) >= 1) return false;
  var wantRef = GL_REF[t.type];
  return !wantRef || String(e.ref || '').indexOf(wantRef) === 0;
}
function glEntryFor(t) {
  if (isAutoEmi(t)) return null;                  // by construction it has no journal
  var e = null;
  if (t.type === 'encash-paid') e = findGl('GL-ENCP-' + t.empId + '-' + String(t.date || '').slice(0, 4));
  else if (t.type === 'settlement') e = findGl('GL-SETL-' + t.empId);
  else if (GL_PREFIX[t.type]) {
    var peers = S.list('pay_txns').filter(function (x) { return x.empId === t.empId && x.type === t.type; });
    var n = 0;
    for (var i = 0; i < peers.length; i++) if (peers[i].id === t.id) { n = i + 1; break; }
    if (n) e = findGl(GL_PREFIX[t.type] + t.empId + '-' + n);
  }
  if (glMatches(e, t)) return e;
  var hits = payEntries().filter(function (x) { return x.date === t.date && glMatches(x, t); });
  return hits.length === 1 ? hits[0] : null;
}

/* EVERY payroll transaction in one month, newest first.
 *
 * Each row carries a DIRECTION, because a payroll month contains three
 * different kinds of movement and summing them as if they were one number is
 * how a payroll report starts lying:
 *   out       money left an account (salary, advance, loan, bonus, encashment)
 *   in        money came back (a loan repayment)
 *   internal  nothing moved — an advance or a loan EMI recovered out of the
 *             same salary payment, which is real and worth listing but is
 *             already inside the salary figure above it. */
function monthTxns(ym) {
  var out = [];
  slipsIn(ym).forEach(function (s) {
    var covered = 0;
    for (var n = 1; n <= (s.payCount || 0); n++) {
      var e = findGl('GL-PAYP-' + s.empId + '-' + ym + '-' + n);
      if (!e) continue;
      // A REVERSED payment is still on the books (unpay posts the opposite entry
      // and deliberately keeps payCount so reversal ids stay unique). Listing it
      // would show money that was taken back — and after Reopen-Draft → Pay All
      // the same salary would appear twice.
      if (findGl('GL-UNPAY-' + s.empId + '-' + ym + '-' + n)) continue;
      var cash = entryCash(e), amt = entryTotal(e);
      covered += amt;
      out.push({ key: e.id, empId: s.empId, empName: s.empName, companyId: s.companyId, purpose: 'Salary', type: 'salary',
        date: e.date, amount: amt, dir: cash.out > 0 ? 'out' : 'internal', cash: Math.max(0, cash.out),
        from: cash.out > 0 ? acctName(cash.account) : 'Recovered from advance / loan — no cash',
        memo: e.memo || ('Salary paid · ' + PR().mLabel(ym)),
        ym: ym, slip: s, entry: e, glId: e.id, instalment: n, instalments: s.payCount || 1 });
    }
    // Money the slip says was paid but no live journal accounts for. Measured in
    // TAKA, not in journal count, so a month where one instalment posted and
    // another did not still shows the missing money.
    var gap = (s.paid || 0) - covered;
    if (gap > 1) {
      // A RESIGNATION is the honest explanation for most of these: settle()
      // marks every accrued month paid in one go, without a per-month payment
      // journal, because the cash left through the settlement journal instead.
      // Calling that "no journal on file" would be wrong, and counting its cash
      // here would count the settlement twice.
      var settled = settlementOn(s.empId, s.paidDate);
      out.push({ key: 'slip-' + s.empId + '-' + ym, empId: s.empId, empName: s.empName, companyId: s.companyId, purpose: 'Salary', type: 'salary',
        date: s.paidDate || (ym + '-01'), amount: gap,
        dir: settled ? 'internal' : 'out',
        cash: settled ? 0 : Math.max(0, Math.min(gap, cashOf(s))),
        from: settled ? 'Cleared in the final settlement below' : paidFrom(s.payMethod) + ' · no journal on file',
        memo: settled
          ? 'Cleared when ' + s.empName + ' was settled on ' + ui.date(s.paidDate)
          : 'Salary paid · ' + PR().mLabel(ym) + ' — recorded on the payslip with no journal behind it',
        ym: ym, slip: s, entry: settled || null, glId: settled ? settled.id : null, instalment: 1, instalments: 1 });
    }
  });
  S.list('pay_txns').filter(function (t) {
    if (!inScope(t.companyId)) return false;
    // An auto-EMI belongs to the SALARY MONTH it was deducted from, which its
    // memo names — not to the calendar month it happens to be dated in. A June
    // salary paid in July would otherwise strand its EMI in July's sheet, away
    // from the payment it came out of.
    if (isAutoEmi(t)) return String(t.memo).indexOf(EMI_MEMO + PR().mLabel(ym)) === 0;
    return String(t.date || '').slice(0, 7) === ym;
  }).forEach(function (t) {
    var e = glEntryFor(t), cash = e ? entryCash(e) : null;
    var auto = isAutoEmi(t);
    var dir = auto ? 'internal' : (cash && cash.out < 0 ? 'in' : 'out');
    out.push({ key: t.id, empId: t.empId, empName: t.empName, companyId: t.companyId, purpose: PURPOSE[t.type] || cap(t.type || 'Payroll'), type: t.type,
      date: t.date, amount: +t.amount || 0, dir: dir,
      cash: cash ? Math.abs(cash.out) : 0,
      from: auto ? 'Recovered from the salary above — no cash'
        : ((cash && cash.account) ? acctName(cash.account) : paidFrom(t.method)),
      memo: t.memo || '', ym: ym, txn: t, entry: e, glId: e ? e.id : null });
  });
  out.sort(function (a, b) { return a.date === b.date ? (a.empName < b.empName ? -1 : 1) : (a.date < b.date ? 1 : -1); });
  return out;
}

/* The three real totals of a month sheet. Kept apart on purpose — see monthTxns. */
function monthTotals(rows) {
  var t = { listed: 0, out: 0, inn: 0, internal: 0 };
  rows.forEach(function (r) {
    t.listed += r.amount;
    if (r.dir === 'in') t.inn += r.cash;
    else if (r.dir === 'out') { t.out += r.cash; t.internal += Math.max(0, r.amount - r.cash); }
    else t.internal += r.amount;
  });
  return t;
}

/* THE CARD — one row per payroll month, newest first. */
function payrollHistoryCard() {
  var months = monthSeries().slice().reverse();
  var c = shell('history');
  fillH(c, 'title', ui.icon('clock-history') + ' Payroll History');
  fillK(c, 'sub', months.length
    ? 'every payroll month · click one for all its transactions' + (isAll() ? ' across ' + scopeCids().length + ' companies' : '')
    : 'no payroll month has been generated yet');
  box(c, 'body').appendChild(EPAL.table({
    columns: [
      { key: 'ym', label: 'Month', render: function (m) { return '<span class="strong">' + esc(PR().mLabel(m.ym)) + '</span>'; },
        exportVal: function (m) { return PR().mLabel(m.ym); } },
      // `staff` is a rendered pair, not a field — without exportVal the CSV and
      // the PDF would print an empty column (EPAL.table exports row[key]).
      { key: 'staff', label: 'Staff paid', num: true, sortVal: function (m) { return m.paidHeads; },
        render: function (m) { return '<span class="num" title="fully paid / on the payroll">' + m.paidHeads + ' / ' + m.heads + '</span>'; },
        exportVal: function (m) { return m.paidHeads + ' / ' + m.heads; } },
      { key: 'gross', label: 'Gross', num: true, money: true },
      { key: 'paid', label: 'Net paid', num: true, sortVal: function (m) { return m.paid; },
        render: function (m) { return m.paid ? '<span class="text-good">' + ui.money(m.paid) + '</span>' : '—'; },
        exportVal: function (m) { return m.paid; } },
      { key: 'due', label: 'Still outstanding', num: true, sortVal: function (m) { return m.due; },
        render: function (m) { return m.due ? '<span class="num strong text-bad">' + ui.money(m.due) + '</span>' : '—'; },
        exportVal: function (m) { return m.due; } },
      // A month can exist because it has payslips while carrying NO pay_runs row
      // — that is exactly why the month list is a union. Such a month has no run
      // status, and inventing "Draft" for it would be a claim the data does not
      // make, so it says so instead.
      { key: 'status', label: 'Run status',
        render: function (m) {
          if (!m.status) return '<span class="badge" title="This month has payslips but no payroll run record">No run</span>';
          if (m.status === 'mixed') return '<span class="badge" title="The companies on this month are not all at the same stage — open a company to see which">Mixed · ' + (m.runs || 0) + ' runs</span>';
          return '<span class="badge badge-' + (m.status === 'paid' ? 'good' : m.status === 'due' ? 'bad' : m.status === 'draft' ? 'warn' : 'info') + '">' + esc(cap(m.status)) + '</span>';
        },
        exportVal: function (m) { return m.status ? cap(m.status) : 'No run'; } }
    ],
    rows: months, sortKey: 'ym', sortDir: -1, pageSize: 12, totalKey: 'paid',
    exportName: 'payroll-history.csv', pdfTitle: scopeFull() + ' — Payroll History',
    /* PRINT — the SAME document the Monthly Register raises (owner 2026-07-30:
     * "it matches with Salary Manage's Payroll History table, check it").
     * It does, where it counts: both tables are the same monthSeries() — the same
     * months, the same figures, no limit on either — so there is nothing to
     * recompute and nothing to keep in sync. This screen just shows six of those
     * columns instead of ten, so printing here raises the FULLER register
     * (PR-MR-…), which contains every column this card shows and four more.
     * One payroll month register, not two variants of one.
     * ⚠ A month with no run, or a draft one, is listed here but cannot be
     * printed: only approved runs may leave the building. The centre says so. */
    toolbarEl: el('button.btn.btn-sm.btn-ghost', { html: ui.icon('printer') + ' Print',
      title: 'Print the payroll register — choose months and detail level (approved runs only)',
      onclick: function () { printCentre({ from: 'register' }); } }),
    /* THE FOOT — the Monthly Register's rules, applied to this card's columns:
     * sums where a sum is the answer, and a DISTINCT count of PEOPLE, never a sum
     * of monthly headcounts. "Staff paid" foots as the people who have nothing
     * outstanding across the whole period over the people on the payroll in it —
     * which is the question this card asks, asked of the period instead of a month. */
    totals: function (ms) {
      if (!ms.length) return null;
      var yms = ms.map(function (m) { return m.ym; });
      var t = { gross: 0, paid: 0, due: 0 };
      ms.forEach(function (m) { t.gross += m.gross || 0; t.paid += m.paid || 0; t.due += m.due || 0; });
      return { label: ms.length + ' month' + (ms.length === 1 ? '' : 's'), values: {
        staff: '<span class="num" title="people with nothing outstanding across these months / people on the payroll in them">' +
          distinctSettledHeads(yms) + ' / ' + distinctHeads(yms) + '</span>',
        gross: ui.money(t.gross), paid: ui.money(t.paid), due: ui.money(t.due)
      } };
    },
    onRow: function (m) { monthTxnsModal(m.ym); },
    actions: [{ icon: 'list-ul', title: 'Every transaction in this month', onClick: function (m) { monthTxnsModal(m.ym); } }],
    empty: { icon: 'clock-history', title: 'No payroll history yet', hint: 'Generating a month in Salary Manage starts the history.' }
  }).el);
  return c;
}

/* THE MONTH — every payroll transaction in it, printable as one sheet. */
function monthTxnsModal(ym) {
  var rows = monthTxns(ym), tot = monthTotals(rows);
  var body = el('div');
  body.appendChild(el('p.text-mute.sm.mb-2', { html:
    rows.length
      ? esc(String(rows.length)) + ' transaction(s) in <b>' + esc(PR().mLabel(ym)) + '</b> — salary payments (each instalment separately), advances, staff loans, repayments, bonuses and encashment payouts. Click any row for its detail and voucher.'
      : 'Nothing was paid or recorded in <b>' + esc(PR().mLabel(ym)) + '</b>. Salary that is accrued but unpaid does not appear here — it is money owed, not money moved.' }));
  body.appendChild(EPAL.table({
    columns: withCo([
      { key: 'empId', label: 'Employee ID', render: function (r) { return '<span class="mono xs">' + esc(r.empId) + '</span>'; } },
      { key: 'empName', label: 'Employee', render: function (r) { return '<span class="strong">' + esc(r.empName) + '</span>'; } },
      { key: 'purpose', label: 'Purpose', badge: { Salary: 'good', Advance: 'warn', 'Staff loan': 'warn', 'Loan repayment': 'info', Bonus: 'good', 'Leave encashment': 'info', 'Final settlement': 'bad' } },
      { key: 'date', label: 'Date', date: true },
      { key: 'from', label: 'Paid from' },
      { key: 'amount', label: 'Amount', num: true, money: true }
    ], null, 2),
    rows: rows, searchKeys: ['empName', 'empId', 'purpose', 'from', 'memo'], pageSize: 12,
    totalKey: 'amount', exportName: 'payroll-transactions-' + ym + '.csv',
    onRow: function (r) { txnDetailModal(r); },
    empty: { icon: 'journal', title: 'No transactions in ' + PR().mLabel(ym) }
  }).el);
  if (rows.length) body.appendChild(el('p.text-mute.xs.mt-2', { text: totalsNote(tot) }));
  ui.modal({
    title: 'Payroll transactions — ' + PR().mLabel(ym), icon: 'journal-text', size: 'xl', body: body,
    actions: [
      { label: 'Print month', icon: 'printer', onClick: function () { printMonthSheet(ym, rows, tot); return false; } },
      { label: 'Close' }
    ]
  });
}

/* The listed total is the sum of the rows, and it is NOT the money that moved:
 * an advance or an EMI recovered out of a salary is a real transaction that is
 * also already inside the salary figure above it. Saying so plainly is the only
 * honest way to print a payroll month on one sheet. */
function totalsNote(t) {
  var bits = [ui.money(t.out) + ' left an account'];
  if (t.inn > 0) bits.push(ui.money(t.inn) + ' came back in');
  if (t.internal > 0) bits.push(ui.money(t.internal) + ' was recovered inside a salary payment (an advance or a loan EMI), so it is listed but never touched the bank');
  return 'Of the ' + ui.money(t.listed) + ' listed above: ' + bits.join(' · ') + '.';
}

function printMonthSheet(ym, rows, tot) {
  // one extra column, and therefore one wider colspan, when six payrolls share
  // the sheet — a printed group month with no company on it is unreadable
  var co = isAll(), span = co ? 6 : 5;
  var head = '<tr><th>Employee ID</th><th>Employee</th>' + (co ? '<th>Company</th>' : '') +
    '<th>Purpose</th><th>Date</th><th>Paid from</th><th style="text-align:right">Amount</th></tr>';
  var body = rows.map(function (r) {
    return '<tr><td>' + esc(r.empId) + '</td><td>' + esc(r.empName) + '</td>' +
      (co ? '<td>' + esc(coShort(r.companyId)) + '</td>' : '') +
      '<td>' + esc(r.purpose) + '</td><td>' +
      esc(ui.date(r.date)) + '</td><td>' + esc(r.from) + '</td><td style="text-align:right">' + ui.money(r.amount) + '</td></tr>';
  }).join('');
  var totRow = '<tr><th colspan="' + span + '">Total listed</th><th style="text-align:right">' + ui.money(tot.listed) + '</th></tr>' +
    '<tr><td colspan="' + span + '" style="text-align:right">of which cash left an account</td><td style="text-align:right">' + ui.money(tot.out) + '</td></tr>';
  if (tot.inn > 0) totRow += '<tr><td colspan="' + span + '" style="text-align:right">cash received back in</td><td style="text-align:right">' + ui.money(tot.inn) + '</td></tr>';
  if (tot.internal > 0) totRow += '<tr><td colspan="' + span + '" style="text-align:right">recovered inside a salary payment — never touched the bank</td><td style="text-align:right">' + ui.money(tot.internal) + '</td></tr>';
  ui.printDoc({
    title: 'Payroll Transactions — ' + PR().mLabel(ym),
    subtitle: scopeFull() + ' · Payroll',
    meta: rows.length + ' transaction(s) · generated ' + ui.date(today()),
    footer: 'System-generated payroll transaction sheet — Confidential',
    bodyHtml: '<table>' + head + body + totRow + '</table>'
  });
}

/* ONE TRANSACTION — what it was, who it was for, and which account it moved
 * through; printable on its own, and as the formal journal voucher when the
 * posting behind it can actually be found. */
function txnDetailModal(r) {
  var body = el('div');
  var rows = [
    ['Employee', r.empName], ['Employee ID', r.empId],
    // whose payroll this movement belongs to — only worth a line when the screen
    // is showing more than one company, otherwise it repeats the page head
    isAll() ? ['Company', coFull(r.companyId)] : null,
    ['Purpose', r.purpose + (r.instalments > 1 ? '  ·  instalment ' + r.instalment + ' of ' + r.instalments : '')],
    ['Amount', ui.money(r.amount)],
    ['Date', ui.date(r.date)],
    ['Paid from', r.from],
    [r.dir === 'in' ? 'Cash received into the account' : 'Cash that left the account',
      r.dir === 'internal' ? 'nothing moved — recovered inside a salary payment' : (r.cash ? ui.money(r.cash) : 'nothing moved')],
    ['Month', PR().mLabel(r.ym)],
    ['Note', r.memo || '—'],
    ['Journal', r.glId || 'no posting on file']
  ].filter(Boolean);
  body.appendChild(el('div.card', null, [el('div.card-body', null, [
    el('div.data-list', null, rows.map(function (p) { return drow(p[0], p[1]); }))
  ])]));
  if (r.slip) {
    body.appendChild(el('div.card.mt-3', null, [
      el('div.card-head', null, [el('h3', { html: ui.icon('receipt') + ' That month\'s payslip' })]),
      el('div.card-body', null, [el('div.data-list', null, [
        drow('Net payable', ui.money(PR().slipPayable(r.slip))),
        drow('Paid in total', ui.money(paidOf(r.slip))),
        drow('Still due', ui.money(dueOf(r.slip))),
        drow('Advance recovered', ui.money(r.slip.advanceRecovered || 0)),
        drow('Loan EMI recovered', ui.money(r.slip.loanRecovered || 0)),
        drow('Status', cap(r.slip.status || ''))
      ])])
    ]));
  }
  var acts = [{ label: 'Print', icon: 'printer', onClick: function () { printTxn(r, rows); return false; } }];
  // EPAL.journalVoucher wants the whole ledger ENTRY (there is no id lookup on
  // the engine), and its 2nd argument is a display NAME, not a company id.
  // the voucher names the company that POSTED it (r.companyId), never the desk's
  // scope — 'All Companies' is not who signed the journal
  if (r.entry) acts.push({ label: 'Print voucher', icon: 'file-earmark-text', variant: 'primary',
    onClick: function () { EPAL.journalVoucher(r.entry, coFull(r.companyId || CID)); return false; } });
  if (r.slip) acts.push({ label: 'Payslip', icon: 'receipt',
    onClick: function () { var e = empById(r.empId); if (e) statement(e, r.ym); return true; } });
  acts.push({ label: 'Close' });
  ui.modal({ title: r.purpose + ' — ' + r.empName, icon: 'cash-coin', size: 'lg', body: body, actions: acts });
}

function printTxn(r, rows) {
  ui.printDoc({
    title: r.purpose + ' — ' + r.empName,
    subtitle: coFull(r.companyId || CID) + ' · Payroll · ' + PR().mLabel(r.ym),
    meta: (r.glId ? 'journal ' + r.glId + ' · ' : '') + 'generated ' + ui.date(today()),
    footer: 'System-generated payroll transaction record — Confidential',
    bodyHtml: '<table>' + rows.map(function (p) {
      return '<tr><td>' + esc(p[0]) + '</td><td>' + esc(String(p[1])) + '</td></tr>';
    }).join('') + '</table>'
  });
}


/* ============================================================================
 * PAYROLL OVERVIEW — the command centre
 * ==========================================================================*/
var ovMonth = null;                 // set → the Monthly Register drill is open

function overviewView(page) {
  if (ovMonth) { monthView(page); return; }
  var s = screen('overview');
  var P = position(), meta = scopeMeta(), ym = payYm || PR().curYm();
  var series = monthSeries(12);

  /* ---- 1 · the dashboard row -------------------------------------------- */
  var paid12 = sum(series, function (m) { return m.paid; });
  var due12 = sum(series, function (m) { return m.due; });
  var variance = P.glPayable - P.sheetOwed, reconciled = Math.abs(variance) < 1;
  box(s, 'dash').appendChild(dashRow({
    // SHORT name on the panel (as Manage Banks does) — the full legal name is
    // 30+ characters and ellipsises inside a four-card row; it reads in full on
    // the digest below.
    hue: meta.accent, icon: meta.icon, co: scopeShort(),
    coSub: (isAll() ? scopeCids().length + ' companies · ' : '') + 'Payroll position · ' + PR().mLabel(ym),
    hero: ui.money(P.sheetOwed), heroBad: P.sheetOwed > 0, heroLabel: 'Owed to staff',
    heroTitle: 'Open the salary sheet', heroOn: function () { goTab('manage'); },
    facts: [
      { k: 'Headcount', v: String(P.team.length), title: isAll() ? 'Everyone on every payroll in the group' : 'Every employee on this payroll', on: function () { goTab('staff'); } },
      { k: 'Payroll months', v: String(P.runMonths), title: 'Every month ever run', on: function () { goTab('manage'); } },
      { k: 'Postings', v: String(payEntries().length), title: 'Journals payroll has written', on: function () { EPAL.router.navigate('group/master-accounts/journals'); } }
    ],
    last: lastEventCfg(null, 'Last payroll event'),
    flow: {
      title: 'Payroll Cost', sub: 'last ' + series.length + ' months · paid vs still owed' + (series.length ? '' : ' · no runs yet'),
      rows: series.map(function (m) { return { up: m.paid, down: m.due, tip: PR().mLabel(m.ym) + ' · paid ' + ui.money(m.paid) + (m.due ? ' · owed ' + ui.money(m.due) : '') }; }),
      net: due12 > 0 ? '−' + ui.money(due12, { compact: true }) : ui.money(0), netUp: due12 <= 0,
      inText: 'Paid ' + ui.money(paid12), outText: 'Owed ' + ui.money(due12),
      hint: 'Open the Monthly Register', on: function () { var last = series[series.length - 1]; if (last) { ovMonth = last.ym; repaint(); } }
    },
    recon: {
      icon: 'shield-check', title: 'Payroll ↔ Ledger', hint: 'Open the ledger',
      stats: [
        { k: 'Salary payable (2100)', v: ui.money(P.glPayable) },
        { k: 'Sheet says owed', v: ui.money(P.sheetOwed) },
        { k: 'Advances + loans', v: ui.money(P.glAdvLoan) },
        { k: 'Variance', v: ui.money(variance), tone: reconciled ? '' : 'text-warn' }
      ],
      why: reconciled ? null : function () { varianceExplainer(P, variance); },
      on: function () { EPAL.router.navigate('group/master-accounts/journals'); }
    },
    minis: [
      { t: ui.icon('bank') + ' Advances · Loans out', v: ui.money(P.advOut + P.loanOut), s: 'recovered from salary → advance', on: function () { goTab('advance'); } },
      { t: ui.icon('shield-lock') + ' Statutory payable', v: ui.money(P.glStatutory), s: 'PF · income tax · leave encash', on: function () { goTab('reports'); } }
    ]
  }));

  /* ---- 2 · the brief row: autopilot · radar · digest --------------------- */
  fillH(s, 'auto-title', ui.icon('magic') + ' Payroll Autopilot');
  fillK(s, 'auto-sub', 'proposals only — nothing posts until you click');
  rowsInto(box(s, 'auto'), autopilot(ym, P), 'Nothing to do — this payroll is up to date.');

  fillH(s, 'radar-title', ui.icon('radar') + ' Anomaly Radar');
  fillK(s, 'radar-sub', 'click to open the employee');
  rowsInto(box(s, 'radar'), radar(P), 'No anomalies in the payroll book.');

  digest(s, P, ym, series);

  /* ---- 3 · the Monthly Register + department cost ----------------------- */
  fillH(s, 'trend-title', ui.icon('calendar3') + ' Monthly Register');
  fillK(s, 'trend-sub', 'click a month for every employee, every transaction, every figure');
  box(s, 'trend').appendChild(registerTable(monthSeries()));

  fillH(s, 'dept-title', ui.icon('diagram-3') + ' Where the money goes');
  fillK(s, 'dept-sub', 'monthly salary cost by department' + (isAll() ? ' · every company merged' : ''));
  var dc = deptCost();                        // read ONCE — ring and table must agree
  box(s, 'dept').appendChild(deptTable(P, dc));
  deptRing(s, dc);

  mountScreen(page, s);
  // the note goes FIRST on the page, above the dashboard row it explains
  if (isAll()) page.insertBefore(scopeNote('Combined payroll — ' + scopeNames(),
    'Every figure on this tab adds up ' + scopeCids().length + ' payrolls at once. Generating, finalizing and paying a month belong to one company, so those controls appear when you pick one from the switcher; everything driven by a person — a loan, an advance, a repayment, a payslip, a payment — works from here.'), page.firstChild);
}

/* Fill an autopilot/radar card: one cloned [data-proto] row per finding, or the
 * dashed all-clear panel when there are none.
 *
 * ⚠ TRAP (found by the headless driver, 2026-07-28): the `hidden` attribute is
 * NOT enough to keep a prototype off the screen. The UA rule `[hidden]{display:
 * none}` and a house class like `.brief-exc{display:flex}` / `.btn{display:
 * inline-flex}` have the SAME specificity, and the author stylesheet is applied
 * later — so the class WINS and the "hidden" prototype renders as a blank row.
 * Anything that must not appear is therefore REMOVED from the DOM, not hidden. */
function rowsInto(host, items, clearText) {
  var clear = part(host, 'clear');
  var tpl = host.querySelector('[data-proto="row"]');
  tpl.parentNode.removeChild(tpl);                 // the prototype itself never renders
  if (!items.length) { clear.removeAttribute('hidden'); clear.innerHTML = ui.icon('check2-circle') + ' ' + esc(clearText); return; }
  clear.parentNode.removeChild(clear);
  items.forEach(function (it) {
    var r = tpl.cloneNode(true);
    r.removeAttribute('hidden'); r.removeAttribute('data-proto');
    r.classList.add('sev-' + (it.sev || 'low'));
    fillH(r, 'ico', ui.icon(it.icon || 'info-circle'));
    fillK(r, 'title', it.title);
    fillK(r, 'why', it.why);
    var go = part(r, 'go');
    if (it.action) {
      go.removeAttribute('hidden');
      go.innerHTML = ui.icon(it.actionIcon || 'arrow-right') + ' ' + esc(it.action);
      go.addEventListener('click', it.on);
    } else {
      go.parentNode.removeChild(go);                // an actionless row shows no button
      if (it.on) { r.style.cursor = 'pointer'; r.addEventListener('click', it.on); }
    }
    host.appendChild(r);
  });
}

/* THE DIGEST — plain English over live figures. Every number below is read from
 * the payslips and the ledger at render time, so it cannot drift from source. */
function digest(s, P, ym, series) {
  var R = runInfo(ym), st = R.status;
  var slips = slipsIn(ym);
  var gross = sum(slips, function (x) { return x.earnedGross; });
  var net = sum(slips, function (x) { return PR().slipPayable(x); });
  var paid = sum(slips, paidOf);
  var due = net - paid;
  var prev = series.length > 1 ? series[series.length - 2] : null;
  function b(v) { return '<strong>' + esc(v) + '</strong>'; }
  var lines = [];
  lines.push(slips.length
    ? b(String(slips.length)) + ' people are on the ' + b(PR().mLabel(ym)) + ' payroll, costing ' + b(ui.money(gross)) + ' gross and ' + b(ui.money(net)) + ' net.'
    : 'No payslips exist for ' + b(PR().mLabel(ym)) + ' yet.');
  if (prev && prev.net > 0 && net > 0) {
    var delta = net - prev.net, pct = Math.round(Math.abs(delta) / prev.net * 100);
    if (pct >= 1) lines.push('That is ' + b((delta >= 0 ? '+' : '−') + ui.money(Math.abs(delta)) + ' (' + pct + '%)') + ' ' + (delta >= 0 ? 'more' : 'less') + ' than ' + PR().mLabel(prev.ym) + '.');
  }
  /* A MONTH THAT HAS NOT BEEN OPENED YET HAS NO RUN (live crash 2026-07-28:
   * "Cannot read properties of null (reading 'correctionUntil')" took the whole
   * payroll screen down). Salary Manage calls generate() first, so a run always
   * exists by the time it reads one; Overview only READS — correctly, a dashboard
   * must not create records as a side effect of being looked at. So it says what
   * is true instead: the month has not been started. */
  lines.push(!R.has
    ? PR().mLabel(ym) + ' has not been opened yet — generate it on ' + b('Salary Manage') + ' to create this month’s payslips.'
    : st === 'mixed'
      // all-mode only: the concerns are at different stages, and naming one of
      // them as "the" status would be a claim the data does not make
      ? R.n + ' companies have opened ' + b(PR().mLabel(ym)) + ' and they are ' + b('not at the same stage') +
        ' — ' + b(ui.money(paid)) + ' is paid and ' + b(ui.money(Math.max(0, due))) + ' is still owed across them. Pick a company to see and run its own month.'
    : st === 'draft'
      ? 'The month is still a ' + b('draft') + (R.inWindow ? ' and the correction window is open until ' + b(ui.date(R.correctionUntil)) + '.' : ' — the correction window closed on ' + b(ui.date(R.correctionUntil)) + ', so nothing is on the books yet.')
      : 'The month is ' + b(cap(st)) + ' — accrued to the ledger, ' + b(ui.money(paid)) + ' paid and ' + b(ui.money(Math.max(0, due))) + ' still owed.');
  if (P.advOut || P.loanOut) lines.push('Staff hold ' + b(ui.money(P.advOut)) + ' of advances and ' + b(ui.money(P.loanOut)) + ' of loans, recovered automatically from future pay.');
  if (P.encashLiability > 0) lines.push('Leave encashment has built a ' + b(ui.money(P.encashLiability)) + ' liability.');
  var variance = P.glPayable - P.sheetOwed;
  lines.push(Math.abs(variance) < 1
    ? 'The salary sheet and the general ledger ' + b('agree') + ' to the taka.'
    : 'The ledger and the sheet disagree by ' + b(ui.money(variance)) + ' — worth opening before month-end.');

  // the digest is the third card of the brief row (owner 2026-07-30) — the date
  // it was read on rides in the card sub, the scope and month head the narrative
  fillH(s, 'digest-title', ui.icon('journal-text') + ' Payroll Digest');
  fillK(s, 'digest-sub', ui.date(today(), 'long'));
  fillK(s, 'digest-scope', scopeFull() + ' — ' + PR().mLabel(ym));
  fillH(s, 'digest-text', lines.join(' '));
}

/* CRITICAL FIRST (owner 2026-07-30). The autopilot and the radar are read three
 * rows at a time inside a capped card now, so what is wrong must be at the top
 * of the scroll, not wherever the checks happen to run. High before medium
 * before low; inside one severity the original order stands, which keeps the
 * month's own proposals (finalize, pay) above the standing housekeeping ones. */
function bySeverity(list) {
  var rank = { high: 0, med: 1, low: 2 };
  return list.map(function (it, i) { return { it: it, i: i }; })
    .sort(function (a, b) {
      var d = (rank[a.it.sev] == null ? 3 : rank[a.it.sev]) - (rank[b.it.sev] == null ? 3 : rank[b.it.sev]);
      return d || a.i - b.i;                       // stable: ties keep their order
    })
    .map(function (x) { return x.it; });
}

/* AUTOPILOT — everything the payroll calendar and the books say SHOULD happen
 * next, each as a proposal with the button that does it. It never acts on its
 * own (owner 2026-07-28), so an automatic payroll can never surprise the bank. */
function autopilot(ym, P) {
  var out = [], R = runInfo(ym), run = R.run, st = R.status;
  var slips = slipsIn(ym);
  var net = sum(slips, function (s) { return PR().slipPayable(s); });
  var paid = sum(slips, paidOf);
  var due = net - paid, td = today();

  if (isAll()) {
    /* ALL COMPANIES — the month proposals become a BOARD READ-OUT, one row per
     * concern that is behind, because the button behind them (finalize, Pay All)
     * writes a run and a run belongs to ONE company. Naming the company and what
     * it owes is the useful half of the proposal; the click has to happen on that
     * company's own desk, which is one switcher button away. Everything below
     * this block is keyed by employee and works from here unchanged. */
    scopeCids().forEach(function (c) {
      var r = PR().getRun(c, ym);
      var cs = slips.filter(function (x) { return x.companyId === c; });
      if (!cs.length || !r) return;
      var cnet = sum(cs, function (x) { return PR().slipPayable(x); }), cdue = sum(cs, dueOf);
      if (r.status === 'draft' && !PR().inCorrectionWindow(c, ym)) {
        out.push({ sev: 'high', icon: 'lock',
          title: coShort(c) + ' — ' + PR().mLabel(ym) + ' is not accrued · ' + ui.money(cnet),
          why: 'Its correction window closed on ' + ui.date(r.correctionUntil) + ', so its books do not carry the month\'s salary cost yet. Switch the company switcher to ' + coShort(c) + ' to finalize it.' });
      } else if (r.status !== 'draft' && cdue > 0) {
        var lateC = td > r.dueAfter;
        out.push({ sev: lateC ? 'high' : 'med', icon: 'cash-coin',
          title: coShort(c) + ' — ' + ui.money(cdue) + ' still owed for ' + PR().mLabel(ym),
          why: (lateC ? 'The pay-by date (' + ui.date(r.dueAfter) + ') has passed. ' : 'Due by ' + ui.date(r.dueAfter) + '. ') +
            'Pay the whole run from ' + coShort(c) + '\'s own desk, or pay one person from Staff without leaving this view.' });
      }
    });
  } else {
    // both draft proposals quote the correction window, which only a RUN carries —
    // and a hydrated install can hold payslips with no run row (live 2026-07-28)
    if (st === 'draft' && slips.length && run) {
      if (R.inWindow) {
        out.push({ sev: 'low', icon: 'pencil-square', title: 'Correction window is open until ' + ui.date(run.correctionUntil),
          why: 'Record absents, lates, overtime and bonuses now — after that the month should be accrued.',
          action: 'Open sheet', actionIcon: 'table', on: function () { goTab('manage'); } });
      } else {
        out.push({ sev: 'high', icon: 'lock', title: 'Finalize & accrue ' + PR().mLabel(ym) + ' — ' + ui.money(net),
          why: 'The correction window closed on ' + ui.date(run.correctionUntil) + '. Until this is accrued the books do not carry the month\'s salary cost.',
          action: 'Finalize & Accrue', actionIcon: 'lock', on: function () { finalizeRun(ym, net); } });
      }
    }
    if (st !== 'draft' && due > 0 && canCreate()) {
      var late = run && td > run.dueAfter;
      out.push({ sev: late ? 'high' : 'med', icon: 'cash-coin',
        title: 'Pay ' + ui.money(due) + ' to ' + slips.filter(function (s) { return dueOf(s) > 0; }).length + ' staff',
        why: late ? 'The pay-by date (' + ui.date(run.dueAfter) + ') has passed — unpaid salaries are flagged Due.' : 'Due by ' + ui.date(run.dueAfter) + '.',
        action: 'Pay All', actionIcon: 'cash-coin', on: function () { payAll(ym); } });
    }
  }
  var arrearsBy = P.team.map(function (e) { return { e: e, amt: PR().previousDue(e.id, ym) }; }).filter(function (r) { return r.amt > 0; });
  if (arrearsBy.length && canCreate()) {
    out.push({ sev: 'high', icon: 'hourglass-split', title: 'Clear ' + ui.money(sum(arrearsBy, function (r) { return r.amt; })) + ' of past-month arrears',
      why: arrearsBy.length + ' employee(s) are still owed for earlier months — that arrears balance rides on every future payslip.',
      action: 'Pay arrears', actionIcon: 'cash-stack',
      on: function () {
        ui.confirm({ title: 'Pay all past-month dues?', confirmLabel: 'Pay Arrears',
          text: ui.money(sum(arrearsBy, function (r) { return r.amt; })) + ' across ' + arrearsBy.length + ' employee(s) and earlier months.' })
          .then(function (ok) { if (!ok) return; arrearsBy.forEach(function (r) { try { PR().payArrears(r.e.id); } catch (x) {} }); ui.toast('Arrears paid', 'success'); repaint(); });
      } });
  }
  var eligible = P.team.filter(function (e) { var ls = PR().leaveState(e); return ls.eligibleFullYear && ls.value > 0; });
  if (eligible.length) {
    out.push({ sev: 'med', icon: 'piggy-bank', title: eligible.length + ' employee(s) have completed a full year',
      why: 'Their accrued leave is now encashable — ' + ui.money(sum(eligible, function (e) { return PR().leaveState(e).value; })) + ' is payable out of the ' + ui.money(P.encashLiability) + ' provision.',
      action: 'Open reports', actionIcon: 'clipboard-data', on: function () { goTab('reports'); } });
  }
  var noSchedule = P.team.filter(function (e) { return PR().loanOutstanding(e.id) > 0 && PR().emiInstallment(e.id) <= 0; });
  if (noSchedule.length) {
    out.push({ sev: 'med', icon: 'bank', title: noSchedule.length + ' staff loan(s) have no repayment schedule',
      why: 'Nothing is deducted automatically, so ' + ui.money(sum(noSchedule, function (e) { return PR().loanOutstanding(e.id); })) + ' will sit on the books until someone records a repayment by hand.',
      action: 'Open loans', actionIcon: 'bank', on: function () { goTab('loans'); } });
  }
  var noSalary = P.team.filter(function (e) { return !(+e.salary > 0); });
  if (noSalary.length) {
    out.push({ sev: 'med', icon: 'person-exclamation', title: noSalary.length + ' employee(s) have no salary set',
      why: 'They generate a zero payslip every month and quietly understate the payroll cost.',
      action: 'Open staff', actionIcon: 'people', on: function () { goTab('staff'); } });
  }
  var variance = P.glPayable - P.sheetOwed;
  if (Math.abs(variance) >= 1) {
    out.push({ sev: 'high', icon: 'shield-exclamation', title: 'The ledger and the salary sheet disagree by ' + ui.money(variance),
      why: 'Salary Payable (2100) says ' + ui.money(P.glPayable) + ', the payslips say ' + ui.money(P.sheetOwed) + '.',
      action: 'Show me why', actionIcon: 'question-circle', on: function () { varianceExplainer(P, variance); } });
  }
  return bySeverity(out);
}

/* RADAR — the things nobody asked about that a payroll manager would want to be
 * told. Every finding names the employee and opens their file. */
function radar(P) {
  var out = [];
  function openEmp(e) { return function () { showEmp(e.id); }; }
  P.live.forEach(function (s) {
    var payable = PR().slipPayable(s);
    if (paidOf(s) > payable + 1) out.push({ sev: 'high', icon: 'exclamation-octagon',
      title: s.empName + ' was overpaid in ' + PR().mLabel(s.ym),
      why: 'Paid ' + ui.money(paidOf(s)) + ' against a payslip of ' + ui.money(payable) + ' — ' + ui.money(paidOf(s) - payable) + ' more than the sheet allows.',
      on: function () { if (EPAL.people) EPAL.people.statement(s.empId, s.ym); } });
  });
  P.team.forEach(function (e) {
    var owed = PR().previousDueList ? PR().previousDueList(e.id) : [];
    if (owed.length >= 2) out.push({ sev: 'high', icon: 'hourglass-bottom',
      title: e.name + ' is unpaid for ' + owed.length + ' months',
      why: ui.money(sum(owed, function (r) { return r.amount; })) + ' outstanding — oldest ' + owed[owed.length - 1].label + '.', on: openEmp(e) });
    var adv = PR().advanceOutstanding(e.id);
    if (adv > 0 && +e.salary > 0 && adv > +e.salary) out.push({ sev: 'med', icon: 'cash',
      title: e.name + ' holds an advance bigger than a month\'s salary',
      why: ui.money(adv) + ' outstanding against a ' + ui.money(e.salary) + ' salary — it cannot clear in one payslip.', on: openEmp(e) });
    var loan = PR().loanOutstanding(e.id), emi = PR().emiInstallment(e.id);
    if (loan > 0 && emi > 0 && loan / emi > 24) out.push({ sev: 'low', icon: 'bank',
      title: e.name + '\'s loan runs past two years',
      why: ui.money(loan) + ' at ' + ui.money(emi) + ' a month is ' + Math.ceil(loan / emi) + ' more instalments.', on: openEmp(e) });
  });
  var byEmp = {};
  P.live.forEach(function (s) { (byEmp[s.empId] || (byEmp[s.empId] = [])).push(s); });
  Object.keys(byEmp).forEach(function (id) {
    var list = byEmp[id].slice().sort(function (a, b) { return a.ym < b.ym ? -1 : 1; });
    for (var i = 1; i < list.length; i++) {
      var a = list[i - 1], c = list[i], pa = PR().slipPayable(a), pc = PR().slipPayable(c);
      if (pa > 0 && Math.abs(pc - pa) / pa >= 0.25) {
        out.push({ sev: 'med', icon: 'graph-up-arrow',
          title: c.empName + '\'s pay moved ' + Math.round((pc - pa) / pa * 100) + '% in ' + PR().mLabel(c.ym),
          why: ui.money(pa) + ' → ' + ui.money(pc) + '. Usually an increment, absence or overtime — worth confirming which.',
          on: (function (cc) { return function () { if (EPAL.people) EPAL.people.statement(cc.empId, cc.ym); }; })(c) });
        break;                       // one swing per employee is enough to flag
      }
    }
  });
  P.live.forEach(function (s) {
    if ((s.leaveDeductDays || 0) >= 5) out.push({ sev: 'low', icon: 'calendar-x',
      title: s.empName + ' was absent ' + s.leaveDeductDays + ' days in ' + PR().mLabel(s.ym),
      why: ui.money(s.absentDeduction || 0) + ' deducted. Repeated months are an attendance conversation, not a payroll one.',
      on: (function (ss) { return function () { if (EPAL.people) EPAL.people.statement(ss.empId, ss.ym); }; })(s) });
  });
  // sorted BEFORE the cut, so the twelve that survive are the twelve that matter
  return bySeverity(out).slice(0, 12);
}

/* Why the ledger and the sheet differ — the honest answer, month by month, so
 * the number is traceable instead of just red. */
function varianceExplainer(P, variance) {
  var rows = monthSeries().map(function (m) {
    return { ym: m.ym, label: PR().mLabel(m.ym), status: m.status || '—', sheet: m.due, drafts: m.drafts };
  }).filter(function (r) { return r.sheet > 0 || r.drafts > 0; });
  var body = el('div');
  body.appendChild(el('p.text-mute.sm', { html:
    'Salary Payable <b>2100</b> is what the general ledger says the company owes staff. The salary sheet adds up what every ' +
    'payslip still has outstanding. They should be the same figure.<br>Ledger <b>' + esc(ui.money(P.glPayable)) + '</b> − sheet <b>' +
    esc(ui.money(P.sheetOwed)) + '</b> = <b>' + esc(ui.money(variance)) + '</b>.' }));
  body.appendChild(el('p.text-mute.xs.mb-2', { text:
    'The usual causes: a month accrued but its payslips later adjusted; a payment posted straight to the ledger instead of through the desk; ' +
    'or draft months that are not on the books yet (drafts are correctly excluded from the sheet figure below).' }));
  body.appendChild(EPAL.table({
    columns: [
      { key: 'label', label: 'Month', render: function (r) { return '<span class="strong">' + esc(r.label) + '</span>'; } },
      { key: 'status', label: 'Run', badge: { draft: 'warn', accrued: 'info', partial: 'warn', due: 'bad', paid: 'good' } },
      { key: 'sheet', label: 'Sheet says owed', num: true, money: true },
      { key: 'drafts', label: 'Draft payslips', num: true, render: function (r) { return r.drafts ? String(r.drafts) : '—'; } }
    ],
    rows: rows, pageSize: 12, empty: { icon: 'journal', title: 'No months to compare' }
  }).el);
  ui.modal({ title: 'Payroll ↔ Ledger — where the difference is', icon: 'shield-exclamation', size: 'md', body: body, footer: false });
}

/* THE MONTHLY REGISTER — one row per payroll month; the row IS the drill. */
function registerTable(series) {
  var rows = series.slice().reverse();
  return EPAL.table({
    columns: [
      { key: 'ym', label: 'Month', render: function (m) { return '<span class="strong">' + esc(PR().mLabel(m.ym)) + '</span>'; }, sortVal: function (m) { return m.ym; } },
      // 'mixed' is an all-mode value only — the concerns on this month are not at
      // the same stage. It is deliberately left OUT of the tone map: no colour
      // here would be true, so it renders as the plain badge.
      { key: 'status', label: 'Run', badge: { draft: 'warn', accrued: 'info', partial: 'warn', due: 'bad', paid: 'good' } },
      { key: 'heads', label: 'Employees', num: true, sortVal: function (m) { return m.heads; } },
      { key: 'gross', label: 'Gross', num: true, money: true },
      { key: 'adds', label: 'Additions', num: true, sortVal: function (m) { return m.adds; }, render: function (m) { return m.adds ? '<span class="num text-good">+' + ui.money(m.adds) + '</span>' : '—'; } },
      { key: 'deds', label: 'Deductions', num: true, sortVal: function (m) { return m.deds; }, render: function (m) { return m.deds ? '<span class="num text-warn">−' + ui.money(m.deds) + '</span>' : '—'; } },
      { key: 'encash', label: 'Encash', num: true, money: true },
      { key: 'net', label: 'Net Payable', num: true, sortVal: function (m) { return m.net; }, render: function (m) { return '<span class="num strong">' + ui.money(m.net) + '</span>'; } },
      { key: 'paid', label: 'Paid', num: true, sortVal: function (m) { return m.paid; }, render: function (m) { return m.paid ? '<span class="text-good">' + ui.money(m.paid) + '</span>' : '—'; } },
      { key: 'due', label: 'Due', num: true, sortVal: function (m) { return m.due; }, render: function (m) { return m.due ? '<span class="num strong text-bad">' + ui.money(m.due) + '</span>' : '—'; } }
    ],
    rows: rows, pageSize: 12, totalKey: 'net', exportName: 'payroll-monthly-register.csv',
    pdfTitle: scopeFull() + ' — Payroll Monthly Register',
    /* PRINT rides in the table's own toolbar, beside Export and PDF — it is an
     * output of this table, and the reader looks for it where the other two are.
     * It opens the print centre (months · detail level · people), never the
     * printer. */
    toolbarEl: el('button.btn.btn-sm.btn-ghost', { html: ui.icon('printer') + ' Print',
      title: 'Print the payroll register — choose months and detail level',
      onclick: function () { printCentre({ from: 'register' }); } }),
    /* THE FOOT. Sums where a sum is the answer, the CLOSING BALANCE for the
     * encashment accrual (it is a liability balance, not a monthly movement) and
     * a DISTINCT headcount — seven months of 21 staff is 21 people. Same rules,
     * same figures, as the printed register: see paySummaryReport(). */
    totals: function (ms) {
      if (!ms.length) return null;
      var asc = ms.slice().sort(function (a, b) { return a.ym < b.ym ? -1 : 1; });
      var cum = encashRunning(), last = asc[asc.length - 1];
      var t = { gross: 0, adds: 0, deds: 0, net: 0, paid: 0, due: 0 };
      asc.forEach(function (m) { t.gross += m.gross || 0; t.adds += m.adds || 0; t.deds += m.deds || 0;
        t.net += m.net || 0; t.paid += m.paid || 0; t.due += m.due || 0; });
      return { label: asc.length + ' run' + (asc.length === 1 ? '' : 's'), values: {
        heads: String(distinctHeads(asc.map(function (m) { return m.ym; }))),
        gross: ui.money(t.gross), adds: ui.money(t.adds), deds: ui.money(t.deds),
        encash: ui.money(cum[last.ym] || 0) + ' <span class="xs text-mute">cl. bal.</span>',
        net: ui.money(t.net), paid: ui.money(t.paid), due: ui.money(t.due)
      } };
    },
    onRow: function (m) { ovMonth = m.ym; repaint(); },
    actions: [{ icon: 'box-arrow-up-right', title: 'Open this month in full', onClick: function (m) { ovMonth = m.ym; repaint(); } }],
    empty: { icon: 'calendar3', title: 'No payroll months yet', hint: 'Salary Manage generates the current month.' }
  }).el;
}

/* The doughnut beside the department table. Fed the SAME rows in the SAME order,
 * so slice N and row N are the same department and the two can never tell
 * different stories. No legend: the table IS the legend, and printing every
 * department name twice in one card is noise, not clarity.
 * The ring is REMOVED (not hidden) when there is nothing to draw — an empty
 * doughnut is a grey disc that looks like a broken chart. */
function deptRing(s, dc) {
  var ring = part(s, 'ring'), cv = part(s, 'deptcanvas');
  if (!ring) return;
  if (!dc.length || !sum(dc, function (r) { return r.cost; })) { ring.parentNode.removeChild(ring); return; }
  requestAnimationFrame(function () {
    if (!cv.isConnected) return;               // tab switched before the frame ran
    trackChart(EPAL.charts.doughnut(cv, {
      labels: dc.map(function (r) { return r.dept; }),
      data: dc.map(function (r) { return r.cost; }),
      // maintainAspectRatio:false lets it fill the fixed .pay-dept-ring box
      options: { maintainAspectRatio: false, plugins: { legend: { display: false } } }
    }));
  });
}

function deptTable(P, dc) {
  dc = dc || deptCost();
  var total = sum(dc, function (r) { return r.cost; });
  return EPAL.table({
    columns: [
      { key: 'dept', label: 'Department', render: function (r) { return '<span class="strong">' + esc(r.dept) + '</span>'; } },
      { key: 'heads', label: 'Headcount', num: true, sortVal: function (r) { return P.team.filter(function (e) { return (e.dept || '—') === r.dept; }).length; },
        render: function (r) { return String(P.team.filter(function (e) { return (e.dept || '—') === r.dept; }).length); } },
      { key: 'cost', label: 'Monthly Cost', num: true, money: true },
      { key: 'share', label: 'Share', num: true, sortVal: function (r) { return r.cost; },
        render: function (r) { return total > 0 ? Math.round(r.cost / total * 100) + '%' : '—'; } }
    ],
    rows: dc, pageSize: 10, totalKey: 'cost', exportName: 'department-cost.csv',
    empty: { icon: 'diagram-3', title: 'No department data' }
  }).el;
}


/* ============================================================================
 * ONE MONTH, IN FULL — the drill behind a Monthly Register row
 * ==========================================================================*/
function monthView(page) {
  var ym = ovMonth, s = screen('month'), meta = scopeMeta();
  var R = runInfo(ym), st = R.status;
  var slips = slipsIn(ym).slice().sort(function (a, b) { return (a.empName || '') < (b.empName || '') ? -1 : 1; });
  var gross = sum(slips, function (x) { return x.earnedGross; });
  var net = sum(slips, function (x) { return PR().slipPayable(x); });
  var paid = sum(slips, paidOf);
  var due = net - paid;
  var adds = sum(slips, addOf), deds = sum(slips, dedOf);
  var advRec = sum(slips, advOf), emiRec = sum(slips, emiOf);

  /* ---- the control bar -------------------------------------------------- */
  act(s, 'back', function () { ovMonth = null; repaint(); }).innerHTML = ui.icon('arrow-left') + ' Monthly Register';
  /* Print opens the PRINT CENTRE with THIS month ticked and employee-level
   * detail chosen — the reader is looking at one month's people, so that is what
   * "print" means from here (owner spec). The legacy tick-the-columns sheet is
   * untouched and still lives on Salary Manage › Print Sheet. */
  act(s, 'print', function () { printCentre({ from: 'sheet', ym: ym }); }).innerHTML = ui.icon('printer') + ' Print register';
  act(s, 'open-run', function () { payYm = ym; goTab('manage'); })
    .innerHTML = ui.icon('sliders') + (isAll() ? ' Open this month' : ' Manage this run');
  var pick = part(s, 'mpick');
  monthSeries().slice().reverse().forEach(function (m) {
    var o = el('option', { value: m.ym, text: PR().mLabel(m.ym) + '  ·  ' + cap(m.status || 'draft') });
    if (m.ym === ym) o.selected = true; pick.appendChild(o);
  });
  pick.addEventListener('change', function () { ovMonth = this.value; repaint(); });
  fillK(s, 'status', cap(st)).classList.add('badge-' + (st === 'paid' ? 'good' : st === 'due' ? 'bad' : st === 'draft' ? 'warn' : 'info'));
  fillK(s, 'note', slips.length + ' employees · ' + payEntries(ym).length + ' ledger postings · ' +
    scoped('pay_txns').filter(function (x) { return String(x.date || '').slice(0, 7) === ym; }).length +
    ' employee money movements in ' + PR().mLabel(ym) +
    (isAll() ? ', across ' + R.n + ' of ' + scopeCids().length + ' companies.' : '.'));

  /* ---- the dashboard row, scoped to this month -------------------------- */
  box(s, 'dash').appendChild(dashRow({
    hue: meta.accent, icon: 'calendar3', co: PR().mLabel(ym), coSub: scopeShort() + ' · ' + cap(st),
    hero: ui.money(net), heroLabel: 'Net payable', heroTitle: 'Manage this run', heroOn: function () { payYm = ym; goTab('manage'); },
    facts: [
      { k: 'Employees', v: String(slips.length), on: null },
      { k: 'Gross', v: ui.money(gross, { compact: true }), on: null },
      { k: 'Outstanding', v: ui.money(Math.max(0, due), { compact: true }), on: function () { payYm = ym; goTab('manage'); } }
    ],
    last: lastEventCfg(ym, 'Last posting this month'),
    flow: {
      title: 'Payment progress', sub: 'per employee · paid vs outstanding',
      rows: slips.map(function (x) { return { up: paidOf(x), down: dueOf(x), tip: x.empName + ' · paid ' + ui.money(paidOf(x)) + (dueOf(x) ? ' · due ' + ui.money(dueOf(x)) : '') }; }),
      net: due > 0 ? '−' + ui.money(due, { compact: true }) : ui.money(0), netUp: due <= 0,
      inText: 'Paid ' + ui.money(paid), outText: 'Due ' + ui.money(Math.max(0, due)),
      hint: 'Manage this run', on: function () { payYm = ym; goTab('manage'); }
    },
    recon: {
      icon: 'calculator', title: 'How the month adds up', hint: 'Manage this run',
      stats: [
        { k: 'Gross earned', v: ui.money(gross) },
        { k: 'Additions', v: '+' + ui.money(adds), tone: adds ? 'text-good' : '' },
        { k: 'Deductions', v: '−' + ui.money(deds), tone: deds ? 'text-warn' : '' },
        { k: 'Net payable', v: ui.money(net) }
      ],
      on: function () { payYm = ym; goTab('manage'); }
    },
    minis: [
      { t: ui.icon('cash') + ' Advance recovered', v: ui.money(advRec), s: 'taken out of this month\'s pay', on: function () { goTab('advance'); } },
      { t: ui.icon('bank') + ' Loan EMI taken', v: ui.money(emiRec), s: 'auto-deducted → loan management', on: function () { goTab('loans'); } }
    ]
  }));

  /* ---- THE SALARY REGISTER — every component, additions and deductions
   * broken out and subtotalled. Gross here is EARNED gross (contract gross less
   * absence), which is what the net is built from — so the row adds up on paper
   * exactly as the engine computes it, with no hidden step. */
  fillH(s, 'reg-title', ui.icon('table') + ' Salary Register — ' + esc(PR().mLabel(ym)));
  fillK(s, 'reg-sub', (isAll() ? 'every employee of every company · ' : 'every employee · ') + 'click a row for the payslip · export or print the lot');
  box(s, 'reg').appendChild(EPAL.table({
    columns: withCo([
      { key: 'empName', label: 'Employee', render: function (x) { return EPAL.people ? EPAL.people.linkify(x.empName, x.empId) : '<span class="strong">' + esc(x.empName) + '</span>'; } },
      { key: 'empId', label: 'ID', render: function (x) { return '<span class="mono xs text-mute">' + esc(x.empId) + '</span>'; } },
      { key: 'dept', label: 'Dept', badge: {} },
      { key: 'gross', label: 'Gross', num: true, sortVal: function (x) { return x.gross || 0; }, render: function (x) { return ui.money(x.gross || 0); } },
      { key: 'absentDeduction', label: 'Absent', num: true, sortVal: function (x) { return x.absentDeduction || 0; },
        render: function (x) { return x.absentDeduction ? '<span class="text-bad">−' + ui.money(x.absentDeduction) + ' <span class="xs text-mute">(' + (x.leaveDeductDays || 0) + 'd)</span></span>' : '—'; } },
      { key: 'earnedGross', label: 'Earned Gross', num: true, money: true },
      { key: 'overtime', label: 'Overtime', num: true, sortVal: function (x) { return x.overtime || 0; },
        render: function (x) { return x.overtime ? '<span class="text-good">' + ui.money(x.overtime) + ' <span class="xs text-mute">(' + (x.overtimeHours || 0) + 'h)</span></span>' : '—'; } },
      { key: 'bonus', label: 'Bonus', num: true, sortVal: bonusOf, render: function (x) { var v = bonusOf(x); return v ? '<span class="text-good">' + ui.money(v) + '</span>' : '—'; } },
      { key: 'adjustment', label: 'Adjustment', num: true, sortVal: function (x) { return x.adjustment || 0; },
        render: function (x) { var v = x.adjustment || 0; return v ? '<span class="' + (v > 0 ? 'text-good' : 'text-bad') + '">' + (v > 0 ? '+' : '−') + ui.money(Math.abs(v)) + '</span>' : '—'; } },
      { key: 'adds', label: 'Additions', num: true, sortVal: addOf, render: function (x) { var v = addOf(x); return v ? '<span class="num strong text-good">+' + ui.money(v) + '</span>' : '—'; } },
      { key: 'lateDeduction', label: 'Late', num: true, sortVal: function (x) { return x.lateDeduction || 0; },
        render: function (x) { return x.lateDeduction ? '<span class="text-warn">−' + ui.money(x.lateDeduction) + ' <span class="xs text-mute">(' + (x.lateDays || 0) + ')</span></span>' : '—'; } },
      { key: 'earlyDeduction', label: 'Early', num: true, sortVal: function (x) { return x.earlyDeduction || 0; },
        render: function (x) { return x.earlyDeduction ? '<span class="text-warn">−' + ui.money(x.earlyDeduction) + '</span>' : '—'; } },
      { key: 'tax', label: 'Tax', num: true, sortVal: function (x) { return x.tax || 0; }, render: function (x) { return x.tax ? ui.money(x.tax) : '—'; } },
      { key: 'pf', label: 'PF', num: true, sortVal: function (x) { return x.pf || 0; }, render: function (x) { return x.pf ? ui.money(x.pf) : '—'; } },
      { key: 'otherDeduction', label: 'Other Ded.', num: true, sortVal: function (x) { return x.otherDeduction || 0; }, render: function (x) { return x.otherDeduction ? ui.money(x.otherDeduction) : '—'; } },
      { key: 'fine', label: 'Fine', num: true, sortVal: function (x) { return x.fine || 0; },
        render: function (x) { return x.fine ? '<span class="text-bad" title="' + esc(x.fineNote || '') + '">−' + ui.money(x.fine) + '</span>' : '—'; } },
      { key: 'deds', label: 'Deductions', num: true, sortVal: dedOf, render: function (x) { var v = dedOf(x); return v ? '<span class="num strong text-warn">−' + ui.money(v) + '</span>' : '—'; } },
      { key: 'net', label: 'Net Payable', num: true, sortVal: function (x) { return PR().slipPayable(x); }, render: function (x) { return '<span class="num strong">' + ui.money(PR().slipPayable(x)) + '</span>'; } },
      { key: 'encashAmt', label: 'Encash Accrued', num: true, money: true },
      { key: 'adv', label: 'Advance rec.', num: true, sortVal: advOf, render: function (x) { var v = advOf(x); return v ? '<span class="text-warn">' + ui.money(v) + '</span>' : '—'; } },
      { key: 'emi', label: 'Loan EMI', num: true, sortVal: emiOf, render: function (x) { var v = emiOf(x); return v ? '<span class="text-warn">' + ui.money(v) + '</span>' : '—'; } },
      { key: 'cash', label: 'Cash Out', num: true, sortVal: cashOf, render: function (x) { var v = cashOf(x); return v ? '<span class="num">' + ui.money(v) + '</span>' : '—'; } },
      { key: 'paid', label: 'Paid', num: true, sortVal: paidOf, render: function (x) { var v = paidOf(x); return v ? '<span class="text-good">' + ui.money(v) + '</span>' : '—'; } },
      { key: 'due', label: 'Due', num: true, sortVal: dueOf, render: function (x) { var v = dueOf(x); return v ? '<span class="num strong text-bad">' + ui.money(v) + '</span>' : '—'; } },
      { key: 'status', label: 'Status', badge: { draft: '', accrued: 'info', partial: 'warn', due: 'bad', paid: 'good' } }
    ], null, 2),
    rows: slips, searchKeys: ['empName', 'empId', 'dept'], quickFilter: 'status', filterPanel: true,
    filters: [{ key: 'dept', label: 'Dept' }, { key: 'status', label: 'Status' }].concat(coFilter()),
    totalKey: 'net', pageSize: 25,
    /* THE FOOT — every money column of the register, summed over whatever is
     * FILTERED (so filtering to one department foots that department). Encash
     * Accrued is the exception the printed report also makes: it is a balance
     * carried, so it is summed here only because one month's accrual for the
     * filtered people IS this month's movement. Status has no total.
     *
     * PRINT SITS BESIDE EXPORT AND PDF (owner 2026-07-30: "where is, after
     * clicking a single month, then print option, with that month's these
     * infos?"). It was only at the top of the screen, above the dashboard row —
     * out of sight by the time you are reading the register — and a reader looks
     * for Print where the other two outputs of THIS table already are. Both
     * buttons open the same print centre for this month; a second door into one
     * room is not a duplicate feature. */
    toolbarEl: el('button.btn.btn-sm.btn-ghost', { html: ui.icon('printer') + ' Print',
      title: 'Print this month — choose all, just the due, just the paid, or specific employees',
      onclick: function () { printCentre({ from: 'sheet', ym: ym }); } }),
    totals: function (xs) {
      if (!xs.length) return null;
      function S2(f) { return ui.money(sum(xs, f)); }
      return { label: xs.length + (xs.length === 1 ? ' employee' : ' employees'), values: {
        gross: S2(function (x) { return x.gross || 0; }),
        absentDeduction: S2(function (x) { return x.absentDeduction || 0; }),
        earnedGross: S2(function (x) { return x.earnedGross || 0; }),
        overtime: S2(function (x) { return x.overtime || 0; }), bonus: S2(bonusOf),
        adjustment: S2(function (x) { return x.adjustment || 0; }), adds: S2(addOf),
        lateDeduction: S2(function (x) { return x.lateDeduction || 0; }),
        earlyDeduction: S2(function (x) { return x.earlyDeduction || 0; }),
        tax: S2(function (x) { return x.tax || 0; }), pf: S2(function (x) { return x.pf || 0; }),
        otherDeduction: S2(function (x) { return x.otherDeduction || 0; }), fine: S2(function (x) { return x.fine || 0; }),
        deds: S2(dedOf), net: S2(function (x) { return PR().slipPayable(x); }),
        encashAmt: S2(function (x) { return x.encashAmt || 0; }), adv: S2(advOf), emi: S2(emiOf),
        cash: S2(cashOf), paid: S2(paidOf), due: S2(dueOf)
      } };
    },
    exportName: 'salary-register-' + ym + '.csv', pdfTitle: scopeFull() + ' — Salary Register ' + PR().mLabel(ym),
    onRow: function (x) { var e = empById(x.empId); if (e) statement(e, ym); },
    actions: [{ icon: 'person-lines-fill', title: 'Open the employee\'s full file', onClick: function (x) { showEmp(x.empId); } }]
      .concat(ui.actions({ print: function (x) { var e = empById(x.empId); if (e) statementPrint(e, ym); } })),
    empty: { icon: 'table', title: 'No payslips in ' + PR().mLabel(ym) }
  }).el);

  /* ---- every movement that touched an employee's money this month ------- */
  var txns = scoped('pay_txns').filter(function (x) { return String(x.date || '').slice(0, 7) === ym; })
    .sort(function (a, b) { return a.date < b.date ? 1 : -1; });
  fillH(s, 'txn-title', ui.icon('journal-text') + ' Employee money movements');
  fillK(s, 'txn-sub', txns.length + ' in ' + PR().mLabel(ym) + ' · advance · loan · repayment · bonus · encashment');
  box(s, 'txns').appendChild(EPAL.table({
    columns: withCo([
      { key: 'date', label: 'Date', date: true },
      { key: 'empName', label: 'Employee', render: function (x) { return EPAL.people ? EPAL.people.linkify(x.empName, x.empId) : esc(x.empName); } },
      { key: 'type', label: 'Type', badge: { advance: 'warn', loan: 'warn', 'loan-repay': 'good', bonus: 'good', 'encash-paid': 'info', settlement: 'bad' } },
      { key: 'memo', label: 'Detail' },
      { key: 'method', label: 'Through', badge: {} },
      { key: 'amount', label: 'Amount', num: true, money: true }
    ], null, 2),
    rows: txns, searchKeys: ['empName', 'empId', 'memo'], pageSize: 10, totalKey: 'amount',
    exportName: 'payroll-movements-' + ym + '.csv',
    onRow: function (x) { showEmp(x.empId); },
    empty: { icon: 'journal', title: 'No movements in ' + PR().mLabel(ym) }
  }).el);

  /* ---- and every journal payroll wrote into the books that month -------- */
  var posts = payEntries(ym).slice().reverse().map(function (e) {
    var amt = 0; (e.lines || []).forEach(function (l) { amt += +l.dr || 0; });
    return { id: e.id, date: e.date, companyId: e.companyId, ref: e.ref || e.id, memo: e.memo || '', amount: amt, entry: e };
  });
  fillH(s, 'post-title', ui.icon('shield-check') + ' Ledger postings');
  fillK(s, 'post-sub', posts.length + ' journal(s) written by payroll' + (isAll() ? ' into ' + scopeCids().length + ' sets of books' : ''));
  box(s, 'posts').appendChild(EPAL.table({
    columns: withCo([
      { key: 'date', label: 'Date', date: true },
      { key: 'ref', label: 'Ref', render: function (r) { return '<span class="txn-id-chip">' + esc(r.ref) + '</span>'; } },
      { key: 'memo', label: 'Posting' },
      { key: 'amount', label: 'Amount', num: true, money: true }
    ]),
    rows: posts, searchKeys: ['ref', 'memo'], pageSize: 10, totalKey: 'amount',
    exportName: 'payroll-postings-' + ym + '.csv',
    onRow: function () { EPAL.router.navigate('group/master-accounts/journals'); },
    empty: { icon: 'shield-check', title: 'Nothing posted in ' + PR().mLabel(ym), hint: 'A draft month is not on the books until it is finalized.' }
  }).el);

  /* THE EMPLOYEE FILE ON THIS DESK TOO (owner 2026-07-29: the register's profile
   * button "still opens the old layout"). The same file Staff Accounts opens,
   * mounted directly under the register — reached from the row's profile button,
   * from a name in the register, and from a name in the money movements. The
   * register ROW still opens the payslip: that is what a register row is for,
   * and it is unchanged. The two cards are grabbed BEFORE the mount (which
   * empties the screen) and mounted after it (which is when they are on the
   * page and the file can be slid in under the register). */
  var regCard = box(s, 'reg').closest('.card');
  var txnCard = box(s, 'txns').closest('.card');
  mountScreen(page, s);
  empFileUnder(page, el('div.emp-file-host'), [regCard, txnCard]);
}


/* ============================================================================
 * STAFF ACCOUNTS — find anyone by NAME or EMPLOYEE ID, open their whole file
 * ==========================================================================*/

/* SHORT ID (owner 2026-07-29: "like ABC-123"). The live directory keeps ids in
 * whatever shape HR typed them — 'U-76', 'ET 25 317', 'ET24 601' and the
 * generated 'EPL-parvez-hossain-8a8731' — and that last shape alone was wider
 * than three money columns, which is what pushed this table into a horizontal
 * scrollbar. This is DISPLAY ONLY. Nothing is stored, renamed or invented: the
 * series letters and every digit group of the real id survive; what drops out
 * is the punctuation and the person's name repeated inside their own id — and
 * the name is in the very next column anyway. The full id stays in the cell's
 * tooltip and search still matches it.
 *   U-76 -> U-76 · ET 25 317 -> ET-25317 · ET24 601 -> ET-24601
 *   EPL-parvez-hossain-8a8731 -> EPL-8A8731
 * Ids carrying no digit at all are left exactly as they are — better a wide
 * cell than a code that cannot be traced back to the person. */
function shortId(raw) {
  var s = String(raw == null ? '' : raw).trim();
  if (!s) return '';
  var lead = s.match(/^[A-Za-z]+/);                 // the series prefix, if any
  var prefix = lead ? lead[0].toUpperCase().slice(0, 4) : '';
  var rest = lead ? s.slice(lead[0].length) : s;
  // every remaining chunk that carries a digit, in order — pure-letter chunks
  // (the name words) fall away
  var code = (rest.match(/[0-9A-Za-z]*[0-9][0-9A-Za-z]*/g) || []).join('').toUpperCase();
  if (!code) return s;
  return prefix ? prefix + '-' + code : code;
}

function staffView(page) {
  var t = team();
  var fileHost = el('div.emp-file-host');       // the open person's file lives here
  var rows = t.map(function (e) {
    var led = PR().empLedger(e.id);
    var slips = S.list('pay_slips').filter(function (s) { return s.empId === e.id && s.status !== 'draft'; }).sort(function (a, b) { return a.ym < b.ym ? 1 : -1; });
    var lastPaid = null;
    for (var i = 0; i < slips.length; i++) if (slips[i].paid > 0) lastPaid = slips[i];
    var ls = PR().leaveState(e);
    var lb = PR().loanBook ? PR().loanBook(e.id) : [];
    return {
      id: e.id, emp: e, name: e.name, companyId: e.companyId, dept: e.dept || '—', designation: e.designation || '—',
      status: e.status || 'active', salary: +e.salary || 0,
      netDue: led.length ? led[led.length - 1].balance : 0,
      salaryDue: PR().salaryDue(e.id), advance: PR().advanceOutstanding(e.id),
      loan: PR().loanOutstanding(e.id), emi: PR().emiInstallment(e.id),
      // the loan column says "still due" — these are the rest of the loan's
      // facts (taken, when, paid so far) so the row answers the whole question
      loanBook: lb, loanTaken: sum(lb, function (L) { return L.principal; }),
      loanPaid: sum(lb, function (L) { return L.paid; }),
      loanOpen: lb.filter(function (L) { return !L.closed; }),
      encash: ls.value, encashDays: ls.encashableDays, eligible: ls.eligibleFullYear,
      lastPaid: lastPaid ? lastPaid.ym : '', movements: PR().txnsFor(e.id).length + slips.length
    };
  });
  var tbl = EPAL.table({
    columns: withCo([
      { key: 'name', label: 'Employee', render: function (r) { return EPAL.people ? EPAL.people.linkify(r.name, r.id) : '<span class="strong">' + esc(r.name) + '</span>'; } },
      { key: 'id', label: 'ID', render: function (r) { return '<span class="mono xs nowrap" title="' + esc(r.id) + '">' + esc(shortId(r.id)) + '</span>'; } },
      // ONE COLUMN, TWO ROWS (owner 2026-07-29). Dept and Designation used to sit
      // side by side — two narrow columns of short words, each wrapping over three
      // lines to fit. Stacked they cost one column's width instead of two: what the
      // person does on the first row, where they sit on the second. c-role keeps the
      // 25% smaller type the pair already had — they are labels you scan rather than
      // figures you read, and the width they give back goes to the money columns.
      { key: 'designation', label: 'Desig. / Dept', cls: 'c-role',
        // the CSV/PDF cell keeps both facts on one line — a spreadsheet has no
        // second row to put the department on
        exportVal: function (r) { return r.designation + ' · ' + r.dept; },
        render: function (r) {
          return '<div class="c-role-desig">' + esc(r.designation) + '</div>' +
            '<div class="c-role-dept"><span class="badge">' + esc(r.dept) + '</span></div>';
        } },
      { key: 'salary', label: 'Salary', num: true, money: true },
      { key: 'netDue', label: 'Net pos.', num: true, sortVal: function (r) { return r.netDue; },
        render: function (r) { return '<span class="num strong ' + (r.netDue >= 0 ? 'text-good' : 'text-bad') + '">' + ui.money(Math.abs(r.netDue)) + '</span> <span class="xs text-mute">' + (r.netDue >= 0 ? 'we owe' : 'they owe') + '</span>'; } },
      { key: 'salaryDue', label: 'Salary due', num: true, sortVal: function (r) { return r.salaryDue; }, render: function (r) { return r.salaryDue ? '<span class="num text-bad">' + ui.money(r.salaryDue) + '</span>' : '—'; } },
      // 'Adv. out' / 'Rec.': with the chips and every figure kept unbreakable,
      // the last columns that would not fit were floored by their own header
      // word — ADVANCE and RECORDS are wider than anything under them.
      { key: 'advance', label: 'Adv. out', num: true, sortVal: function (r) { return r.advance; }, render: function (r) { return r.advance ? '<span class="text-warn">' + ui.money(r.advance) + '</span>' : '—'; } },
      { key: 'loan', label: 'Loan out', num: true, sortVal: function (r) { return r.loan; },
        exportVal: function (r) { return r.loan; },
        render: function (r) {
          if (!r.loan) return r.loanTaken ? '—<div class="xs text-mute nowrap">' + ui.money(r.loanTaken) + ' taken · cleared</div>' : '—';
          var when = r.loanOpen.length === 1 ? 'taken ' + ui.date(r.loanOpen[0].date) : r.loanOpen.length + ' loans';
          return '<span class="text-warn">' + ui.money(r.loan) + '</span>' +
            (r.emi ? ' <span class="xs text-mute">' + ui.money(r.emi) + '/mo</span>' : ' <span class="xs text-mute">no EMI</span>') +
            '<div class="xs text-mute nowrap">' + ui.money(r.loanTaken) + ' taken · ' + ui.money(r.loanPaid) + ' paid</div>' +
            '<div class="xs text-mute nowrap">' + esc(when) + '</div>';
        } },
      { key: 'encash', label: 'Leave encash', num: true, sortVal: function (r) { return r.encash; },
        render: function (r) { return r.encash ? ui.money(r.encash) + ' <span class="xs text-mute">' + r.encashDays.toFixed(1) + 'd</span>' + (r.eligible ? ' <span class="badge badge-good">Eligible</span>' : '') : '—'; } },
      // a month is one token: without .nowrap the narrow column split "May 2026"
      // into "May 202 / 6"
      { key: 'lastPaid', label: 'Last paid', render: function (r) { return r.lastPaid ? '<span class="nowrap">' + esc(PR().mLabel(r.lastPaid)) + '</span>' : '<span class="text-mute">never</span>'; } },
      { key: 'movements', label: 'Rec.', num: true, sortVal: function (r) { return r.movements; } },
      { key: 'status', label: 'Status', badge: { active: 'good', resigned: 'bad', probation: 'warn' } }
    ], null, 2),
    rows: rows, searchKeys: ['name', 'id', 'dept', 'designation'], quickFilter: 'status', filterPanel: true,
    filters: [{ key: 'dept', label: 'Dept' }, { key: 'status', label: 'Status' }].concat(coFilter()),
    pageSize: 15, exportName: 'staff-accounts.csv', pdfTitle: scopeFull() + ' — Staff Payroll Accounts',
    /* PRINT — the STAFF POSITION STATEMENT, as at today. Not a month's document:
     * this table is a set of BALANCES, so its report is dated "as at" and has no
     * month to choose. Beside Export and PDF, where this table's outputs live. */
    toolbarEl: el('button.btn.btn-sm.btn-ghost', { html: ui.icon('printer') + ' Print',
      title: 'Print the staff position statement — everyone, or just those carrying a balance',
      onclick: function () { staffPrintCentre(rows); } }),
    /* THE FOOT. Money columns sum. The two that cannot:
     *  · NET POSITION is SIGNED — positive is owed to the employee, negative is
     *    owed by them — so the column's net is the answer, and the gross of each
     *    side is printed under it. A total that said "৳2.1L" while hiding
     *    ৳40,000 owed the other way would be worse than no total at all.
     *  · LAST PAID and STATUS are not money; they say what they count. */
    totals: function (rs) {
      if (!rs.length) return null;
      function S(f) { return sum(rs, f); }
      var net = S(function (r) { return r.netDue; });
      var weOwe = S(function (r) { return Math.max(0, r.netDue); });
      var theyOwe = S(function (r) { return Math.max(0, -r.netDue); });
      return { label: rs.length + (rs.length === 1 ? ' person' : ' people'), values: {
        salary: ui.money(S(function (r) { return r.salary; })),
        netDue: '<span class="num">' + ui.money(Math.abs(net)) + ' <span class="xs text-mute">' +
          (net >= 0 ? 'we owe' : 'they owe') + '</span></span>' +
          '<div class="xs text-mute nowrap">' + ui.money(weOwe) + ' we owe · ' + ui.money(theyOwe) + ' they owe</div>',
        salaryDue: ui.money(S(function (r) { return r.salaryDue; })),
        advance: ui.money(S(function (r) { return r.advance; })),
        loan: ui.money(S(function (r) { return r.loan; })),
        encash: ui.money(S(function (r) { return r.encash; })),
        movements: String(S(function (r) { return r.movements; })),
        lastPaid: '<span class="xs text-mute">' + rs.filter(function (r) { return !r.lastPaid; }).length + ' never paid</span>',
        status: '<span class="xs text-mute">' + rs.filter(function (r) { return r.status === 'active'; }).length + ' active</span>'
      } };
    },
    // the row and the name both open the file UNDER the table, not a modal
    onRow: function (r) { openFile(r.id, true); },
    actions: (canCreate() ? [
      { icon: 'cash', title: 'Give advance', onClick: function (r) { moneyForm(r.emp, 'advance'); } },
      { icon: 'bank', title: 'Disburse loan', onClick: function (r) { moneyForm(r.emp, 'loan'); } }
    ] : []).concat(ui.actions({ print: function (r) { statementPrint(r.emp, PR().curYm()); } })),
    empty: { icon: 'people', title: 'No employees on this payroll' }
  });
  var card2 = frag('reg-card');
  slot(card2, 'title').innerHTML = ui.icon('people') + ' Staff Accounts';
  slot(card2, 'sub').textContent = (isAll() ? 'everyone on every payroll in the group · ' : '') +
    'search by name OR employee ID · click anyone for their complete file — ledger, payslips, loans, advances, attendance';
  // .tbl-snug: 13 money/identity columns + the action buttons on screen at once,
  // one 10% step of type smaller and higher-contrast (owner 2026-07-29).
  slot(card2, 'body').classList.add('tbl-snug');
  slot(card2, 'body').appendChild(tbl.el);
  page.appendChild(card2);

  /* THE FILE OPENS HERE — under the table, with the list still above it. Two
   * ways in, one destination: the ROW click (onRow above) and the NAME
   * (.emp-link, claimed by the host below). See empFileUnder(). */
  var openFile = empFileUnder(page, fileHost, [card2]);
}

/* ============================================================ THE EMPLOYEE FILE
 * (owner 2026-07-29: "clicking a staff's name opens a modal card … but I want it
 * to open another structure, in the below of the page, not on a pop up card")
 *
 * The file opens UNDER the Staff Accounts table with the table still on screen
 * above it — pick a person, read them, pick the next one. Nothing is duplicated:
 * the tab bar and the five tab bodies (Overview · Accounts · Payslips ·
 * Attendance · All Details) are the SHARED kit `platform/kit/emp-profile.js`,
 * rendered with `{host, head:false}` — the very same code the modal runs from
 * every other module, in a different box. THIS screen adds the page chrome (the
 * identity band + the six money tiles) and, inside the Overview tab, the
 * analytics stack from the owner's reference screenshots.
 *
 * Charts live in `fileCharts` AND in the desk's own `myCharts`: a tab click
 * inside the file redraws Overview (so the file's own charts must go), and a
 * desk redraw or route change drops the whole page (so the desk must be able to
 * kill them too). Destroying twice is harmless — both killers swallow it.  */
var openEmp = null;                       // whose file is open under the table
var deskFileOpen = null;                  // the opener THIS desk mounted, if any
var fileCharts = [];
function killFileCharts() { fileCharts.forEach(function (c) { try { c.destroy(); } catch (e) {} }); fileCharts = []; }
function fileChart(c) { if (c) { fileCharts.push(c); trackChart(c); } return c; }
// a local date string — NEVER toISOString(), which shifts a day back in +06
function dstr(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function accentOf(node) {
  var v = node ? getComputedStyle(node).getPropertyValue('--accent').trim() : '';
  return v || '#1A43BF';
}

/* MOUNTING THE FILE ON A DESK (owner 2026-07-29: on the Salary Register "if i
 * click in profile here, it still opens the old layout … I want the updated
 * profile version"). Staff Accounts already opened the file under its table;
 * every other payroll desk still had the pop-up card. This is that same mount,
 * written once and handed to whichever desk wants it:
 *   · `host` goes directly UNDER `cards[0]` — the table the person was clicked
 *     in — so the file reads as that table's drill-down, not as something at
 *     the bottom of the page.
 *   · every card in `cards` is marked [data-emp-host] with an `__empOpen`, which
 *     is how the kit's own document-capture listener hands the NAME click to the
 *     desk instead of opening its modal.
 *   · `deskFileOpen` lets any other control on the desk (a row action, a radar
 *     finding) reach the same file through showEmp() without threading the
 *     opener through five call layers.
 * `openEmp` is module state, so the file survives a desk redraw (a company
 * switch, a data change) and re-renders itself for the same person. */
function empFileUnder(page, host, cards) {
  (cards || []).forEach(function (c) {
    if (!c) return;
    c.setAttribute('data-emp-host', '');
    c.__empOpen = function (id) { openFile(id, true); };
  });
  var anchor = cards && cards[0] && cards[0].parentNode === page ? cards[0] : null;
  if (anchor) page.insertBefore(host, anchor.nextSibling); else page.appendChild(host);
  deskFileOpen = openFile;
  draw(false);
  function draw(scroll) {
    if (!openEmp) { killFileCharts(); host.innerHTML = ''; return; }
    empFile(host, openEmp, { scroll: scroll, onClose: function () { openEmp = null; draw(false); } });
  }
  function openFile(id, scroll) { openEmp = id; draw(scroll !== false); }
  return openFile;
}

/* One way in from anywhere on the desk: the file if this desk holds one, the
 * shared modal (every other module's behaviour) if it does not. */
function showEmp(id) {
  if (deskFileOpen) { deskFileOpen(id, true); return; }
  if (EPAL.people) EPAL.people.open(id);
}

/* THE SAME FILE ON EVERY OTHER PAYROLL DESK. Salary Register and Staff Accounts
 * mount the file under the exact table the person was clicked in. The remaining
 * desks — Salary Manage, Loans, Advance, Payslip, Reports, Overview — carry
 * employee names too, and every one of them was still opening the pop-up card.
 * They get the file at the foot of the desk instead: no card to slide under, so
 * `page` itself is the host claim and the file scrolls into view. The desk's own
 * mount, if it made one, has already claimed `deskFileOpen` and this does
 * nothing. Called once per desk render, from both dispatchers. */
function ensureEmpFile(page) {
  if (deskFileOpen) return;
  empFileUnder(page, el('div.emp-file-host'), [page]);
}

/* THE FILE BELONGS TO THE DESK IT WAS OPENED ON. `openEmp` survives a REDRAW on
 * purpose (a company switch, a data change, a form saved) so the person you are
 * reading is still there afterwards — but a different tab is a different piece
 * of work, and finding someone's file sitting at the foot of it is a surprise,
 * not a convenience. So the file closes when the desk changes, and only then. */
var fileDesk = null;
function deskChanged(tab) {
  // the month register is a drill INSIDE the overview tab and a desk in its own
  // right — and a different month is a different desk
  var key = (tab === 'overview' && ovMonth) ? 'month:' + ovMonth : tab;
  if (fileDesk !== key) { fileDesk = key; openEmp = null; }
}

function empFile(host, empId, opts) {
  opts = opts || {};
  killFileCharts();
  host.innerHTML = '';
  var e = empById(empId) || (db.employee ? db.employee(empId) : null);
  if (!e || !EPAL.people || !PR()) return;
  var P = PR();
  var s = screen('emp-file');

  fillH(s, 'avatar', e.photo
    ? '<span class="avatar emp-av" style="background-image:url(' + esc(e.photo) + ')"></span>'
    : '<span class="avatar emp-av" style="background:' + ui.colorFor(e.name) + '">' + esc(ui.initials(e.name)) + '</span>');
  fillK(s, 'name', e.name);
  fillK(s, 'meta', [e.designation, e.dept, coFull(e.companyId || CID)].filter(Boolean).join(' · '));
  fillH(s, 'chips', '<span class="badge">' + esc(e.empType || 'Permanent') + '</span>' +
    '<span class="badge badge-' + (e.status === 'active' ? 'good' : e.status === 'resigned' ? 'bad' : 'warn') + '">' + esc(cap(e.status || 'active')) + '</span>');

  var led = P.empLedger(e.id);
  var netDue = led.length ? led[led.length - 1].balance : 0;
  var ls = P.leaveState(e);
  fillK(s, 't-salary', ui.money(e.salary || 0));
  fillK(s, 't-owes-l', netDue >= 0 ? 'Company owes' : 'Employee owes');
  fillK(s, 't-owes', ui.money(Math.abs(netDue)));
  fillK(s, 't-due', ui.money(P.salaryDue(e.id)));
  fillK(s, 't-adv', ui.money(P.advanceOutstanding(e.id)));
  fillK(s, 't-loan', ui.money(P.loanOutstanding(e.id)));
  fillK(s, 't-encash', ls.encashableDays.toFixed(1) + 'd · ' + ui.money(ls.value));

  var payBtn = act(s, 'payslip', function () { EPAL.people.statement(e, P.curYm()); });
  if (payBtn) payBtn.innerHTML = ui.icon('receipt') + ' Payslip';
  var closeBtn = act(s, 'close', function () { if (opts.onClose) opts.onClose(); });
  if (closeBtn) closeBtn.innerHTML = ui.icon('x-lg') + ' Close file';

  var fileBox = box(s, 'file');            // grabbed BEFORE the mount moves it
  mountScreen(host, s);
  EPAL.people.open(e.id, { host: fileBox, head: false,
    overviewExtra: function (h) { h.appendChild(empAnalytics(e)); } });

  if (opts.scroll) requestAnimationFrame(function () {
    if (!host.isConnected) return;
    try { host.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (x) { host.scrollIntoView(); }
  });
}

/* THE ANALYTICS STACK — the owner's two reference screenshots, built ONLY from
 * data this app already holds:
 *   tasks      db.tasksFor(empId)        (board records: created · status · phases)
 *   attendance att_monthly               (present · absent · late · earlyLeave · leave)
 *   leave      tv_leaves                 (type · status · days · from)
 *   money      EPAL.payroll              (slips · advances · loans · ledger)
 * The reference app also printed "Working Hour 174.03 hr" and "Late Time 862.52
 * min". Nothing in this system records a clock-in or a clock-out — attendance is
 * kept in DAYS — so those two are NOT rendered from a guess; the card shows the
 * days and hours we do hold and says plainly what is missing. */
function empAnalytics(e) {
  killFileCharts();
  var s = screen('emp-analytics');
  var P = PR(), t0 = today(), year = t0.slice(0, 4);
  var now = new Date(t0 + 'T00:00:00');
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /* ---- profile details ---------------------------------------------------*/
  fillH(s, 'pd-title', ui.icon('person-vcard') + ' Profile Details');
  fillK(s, 'pd-sub', 'current');
  fillK(s, 'p-email', e.email || '—');
  fillK(s, 'p-phone', e.phone || '—');
  fillK(s, 'p-company', coFull(e.companyId || CID));
  fillK(s, 'p-dept', e.dept || '—');
  fillK(s, 'p-desig', e.designation || '—');
  fillK(s, 'p-type', e.empType || 'Permanent');
  fillK(s, 'p-id', e.id);
  fillK(s, 'p-join', e.joinDate ? ui.date(e.joinDate) : '—');

  /* ---- tasks -------------------------------------------------------------
   * A task carries `created` (the board writes it) and per-phase `completedAt`
   * (epoch ms, written when a phase is ticked). There is no single "completed
   * on" field, so a done task is dated by its LAST completed phase — which is
   * the moment the work actually ended. Anything older than the board (seeded
   * records with neither) falls back to its due date, so it still lands on the
   * axis instead of silently disappearing from the count. */
  var tasks = (db.tasksFor ? db.tasksFor(e.id) : []) || [];
  var done = tasks.filter(function (t) { return t.status === 'done'; });
  var live = tasks.filter(function (t) { return t.status !== 'done' && t.status !== 'cancelled'; });
  fillK(s, 'k-tasks', tasks.length);
  fillK(s, 'k-tasks-f', 'assigned on this board');
  fillK(s, 'k-done', done.length);
  fillK(s, 'k-done-f', tasks.length ? Math.round(done.length / tasks.length * 100) + '% of the board' : 'nothing assigned yet');
  fillK(s, 'k-pending', live.length);
  fillK(s, 'k-pending-f', 'to-do · in progress · review');

  function taskStart(t) { return String(t.created || t.due || '').slice(0, 10); }
  function taskEnd(t) {
    var ph = (t.phases || []).filter(function (p) { return p.completedAt; });
    if (!ph.length) return taskStart(t);
    return dstr(new Date(Math.max.apply(null, ph.map(function (p) { return p.completedAt; }))));
  }

  var dowMon = (now.getDay() + 6) % 7;                    // 0 = Monday
  var monday = new Date(now); monday.setDate(now.getDate() - dowMon);
  var wDays = [], wLbl = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  for (var i = 0; i < 7; i++) { var d = new Date(monday); d.setDate(monday.getDate() + i); wDays.push(dstr(d)); }
  var wAssigned = wDays.map(function (day) { return tasks.filter(function (t) { return taskStart(t) === day; }).length; });
  var wDone = wDays.map(function (day) { return done.filter(function (t) { return taskEnd(t) === day; }).length; });

  var yms = [], mLbl = [];
  for (var k = 11; k >= 0; k--) {
    var dm = new Date(now.getFullYear(), now.getMonth() - k, 1);
    yms.push(dstr(dm).slice(0, 7)); mLbl.push(MON[dm.getMonth()]);
  }
  var mAssigned = yms.map(function (ym2) { return tasks.filter(function (t) { return taskStart(t).slice(0, 7) === ym2; }).length; });
  var mDone = yms.map(function (ym2) { return done.filter(function (t) { return taskEnd(t).slice(0, 7) === ym2; }).length; });

  fillH(s, 'wk-title', ui.icon('bar-chart') + ' Weekly Task Performance');
  fillK(s, 'wk-sub', 'this week · ' + ui.date(wDays[0]) + ' → ' + ui.date(wDays[6]));
  fillH(s, 'mn-title', ui.icon('graph-up') + ' Monthly Task Performance');
  fillK(s, 'mn-sub', 'last 12 months');

  /* ---- attendance --------------------------------------------------------*/
  var ym = P.curYm();
  var att = P.attendanceFor(e.id, ym) || {};
  var slipNow = P.slip(e.id, ym);
  fillH(s, 'att-title', ui.icon('calendar-check') + ' Attendance Summary');
  fillK(s, 'att-sub', P.mLabel(ym));
  fillK(s, 'a-present', att.present || 0);
  fillK(s, 'a-absent', att.absent || 0);
  fillK(s, 'a-late', att.late || 0);
  fillK(s, 'a-early', att.earlyLeave || 0);
  fillK(s, 'a-leave', att.leave || 0);
  fillK(s, 'a-ot', ((slipNow && +slipNow.overtimeHours) || 0) + ' hr');
  fillH(s, 'att-note', ui.icon('info-circle') + ' Attendance is recorded per month in <strong>days</strong> — present, absent, late, early leave, on leave — and those counts feed the month\'s draft payslip directly. Clock-in / clock-out times are not recorded anywhere in the system, so worked <em>hours</em> and late <em>minutes</em> cannot be shown; overtime hours come from the payslip.');
  var attRows = yms.map(function (ym2) { return P.attendanceFor(e.id, ym2) || {}; });

  /* ---- leave -------------------------------------------------------------*/
  var lv = S.list('tv_leaves').filter(function (l) { return l.empId === e.id; });
  var lvY = lv.filter(function (l) { return String(l.from || '').slice(0, 4) === year; });
  function lvCount(st) { return lvY.filter(function (l) { return String(l.status || '').toLowerCase() === st; }).length; }
  var ls2 = P.leaveState(e);
  fillH(s, 'lv-title', ui.icon('calendar2-week') + ' Leave Summary');
  fillK(s, 'lv-sub', year + ' · ' + ls2.accruedDays.toFixed(1) + 'd accrued of ' + ls2.fullYearDays + 'd a year');
  fillK(s, 'l-approved', lvCount('approved'));
  fillK(s, 'l-pending', lvCount('pending'));
  fillK(s, 'l-rejected', lvCount('rejected'));
  fillK(s, 'l-used', ls2.takenDays.toFixed(1) + 'd');
  fillK(s, 'l-left', ls2.encashableDays.toFixed(1) + 'd');

  /* ---- salary & loan -----------------------------------------------------
   * Staff loans are transactions, not documents — the engine keeps a running
   * outstanding, not one record per loan — so the per-loan facts (taken, taken
   * on, paid, still due, cleared or running) are rebuilt by the engine's
   * loanBook(), which allocates repayments to disbursements oldest first. It is
   * the same book Loan Management reads, so the file and the tab agree. */
  var slips = S.list('pay_slips').filter(function (x) { return x.empId === e.id && x.status !== 'draft'; })
    .sort(function (a, b) { return a.ym < b.ym ? 1 : -1; });
  var paidRec = slips.filter(function (x) { return P.slipPaid(x) > 0 && P.slipDue(x) <= 0; }).length;
  var pendRec = slips.length - paidRec;
  var totalNet = slips.filter(function (x) { return String(x.ym).slice(0, 4) === year; })
    .reduce(function (a, x) { return a + P.slipPayable(x); }, 0);
  var latest = slips[0];
  fillH(s, 'sl-title', ui.icon('cash-stack') + ' Salary & Loan Summary');
  fillK(s, 'sl-sub', slips.length + ' payslip' + (slips.length === 1 ? '' : 's') + ' on file');
  fillK(s, 's-paid', paidRec);
  fillK(s, 's-pending', pendRec);
  fillK(s, 's-total-l', 'Total net salary (' + year + ')');
  fillK(s, 's-total', ui.money(totalNet));
  fillK(s, 's-latest-l', 'Latest net salary' + (latest ? ' (' + P.mLabel(latest.ym) + ')' : ''));
  fillK(s, 's-latest', latest ? ui.money(P.slipPayable(latest)) : '—');

  var lb = P.loanBook ? P.loanBook(e.id) : [];
  var doneLoans = lb.filter(function (L) { return L.closed; }).length;
  fillK(s, 'ln-running', lb.length - doneLoans);
  fillK(s, 'ln-done', doneLoans);
  fillK(s, 'ln-remaining', ui.money(P.loanOutstanding(e.id)));
  /* THE LOANS THEMSELVES, not just the counts (owner 2026-07-29): each one says
   * what was taken and when, what has come back, what is still due, and out of
   * what — salary or cash. Newest first, like every other history. */
  var lnHost = part(s, 'ln-loans');
  if (lnHost) {
    lnHost.innerHTML = '';
    if (!lb.length) lnHost.appendChild(el('div.text-mute.xs', { text: 'No staff loan has ever been taken.' }));
    else {
      lnHost.appendChild(el('div.section-label', { text: 'Every loan taken' }));
      lb.slice().reverse().forEach(function (L) {
        var via = L.paid > 0
          ? (L.viaSalary > 0 && L.viaCash > 0 ? 'salary + cash' : L.viaSalary > 0 ? 'from salary' : 'in cash')
          : 'nothing repaid yet';
        lnHost.appendChild(el('div.data-row', null, [
          el('div.flex-1', null, [
            el('div.sm.strong', { text: ui.money(L.principal) + ' · taken ' + ui.date(L.date) }),
            el('div.text-mute.xs', { text: 'paid ' + ui.money(L.paid) + ' · due ' + ui.money(L.due) +
              (L.emi ? ' · EMI ' + ui.money(L.emi) + '/mo' : '') + ' · ' + via })
          ]),
          el('span.badge.badge-' + (L.closed ? 'good' : 'warn'), { text: L.closed ? 'Cleared' : 'Running' })
        ]));
      });
    }
  }
  var pendReq = P.advRequests ? P.advRequests({ empId: e.id, status: 'pending' }) : [];
  fillK(s, 'ln-advpending', pendReq.length ? ui.money(sum(pendReq, function (r) { return +r.amount || 0; })) + ' · ' + pendReq.length + ' waiting' : ui.money(0));
  fillK(s, 'ln-advout', ui.money(P.advanceOutstanding(e.id)));

  /* ---- the three charts, drawn once the canvases are on the page ---------
   * COUNT SCALES, PASSED EXPLICITLY. Two reasons, both worth writing down:
   *   · `EPAL.charts.bar()` sets `x.ticks.callback = undefined` on a vertical
   *     chart, and Chart.js then prints the INDEX instead of the label — every
   *     vertical bar chart in the app is currently showing 0,1,2… where its own
   *     labels should be (Travels Accounts › Overview has it too). Fixing the
   *     shared helper would move pixels on screens nobody asked me to touch
   *     (R1), so these charts pass their own `scales` — `cfg.options` replaces
   *     the block wholesale — and the app-wide defect is reported, not patched
   *     from here.
   *   · these axes count TASKS and DAYS, so the ticks must be whole numbers;
   *     the default was drawing 0.5 of a task. */
  function countScales(stacked) {
    var bd = getComputedStyle(document.documentElement).getPropertyValue('--border').trim() || 'rgba(255,255,255,.05)';
    return { scales: {
      x: { grid: { display: false }, border: { display: false }, stacked: !!stacked },
      y: { grid: { color: bd }, border: { display: false }, stacked: !!stacked, beginAtZero: true,
           ticks: { precision: 0, maxTicksLimit: 5 } }
    } };
  }
  var wk = part(s, 'wk'), mn = part(s, 'mn'), atc = part(s, 'att');
  // an empty chart says nothing; a sentence says why it is empty
  if (!tasks.length) {
    [[wk, 'No tasks on this person\'s board yet — nothing to chart. Tasks come from My Tasks / Task Oversight.'],
     [mn, 'No tasks on this person\'s board yet — nothing to chart.']].forEach(function (p) {
      if (p[0]) { var b = p[0].parentNode; b.classList.remove('emp-chart'); b.innerHTML = ''; b.appendChild(el('div.text-mute.sm', { text: p[1] })); }
    });
    wk = mn = null;
  }
  var hasAtt = attRows.some(function (a) { return a.present || a.absent || a.late || a.earlyLeave || a.leave; });
  if (!hasAtt && atc) {
    var ab = atc.parentNode; ab.classList.remove('emp-chart'); ab.innerHTML = '';
    ab.appendChild(el('div.text-mute.sm', { text: 'No attendance recorded in the last 12 months — record a month on the Attendance tab and it charts from there.' }));
    atc = null;
  }
  requestAnimationFrame(function () {
    if (!EPAL.charts) return;
    var root = document.documentElement, cs = getComputedStyle(root);
    var acc = accentOf(wk || atc || document.body);
    var good = cs.getPropertyValue('--good').trim() || '#12b3a6';
    var bad = cs.getPropertyValue('--bad').trim() || '#e0356e';
    var warn = cs.getPropertyValue('--warn').trim() || '#e2721b';
    if (wk && wk.isConnected) fileChart(EPAL.charts.bar(wk, { labels: wLbl, money: false, legend: true, options: countScales(false),
      datasets: [{ label: 'Assigned', data: wAssigned, color: acc }, { label: 'Completed', data: wDone, color: good }] }));
    if (mn && mn.isConnected) fileChart(EPAL.charts.area(mn, { labels: mLbl, money: false, legend: true, options: countScales(false),
      datasets: [{ label: 'Assigned', data: mAssigned, color: acc }, { label: 'Completed', data: mDone, color: good }] }));
    if (atc && atc.isConnected) fileChart(EPAL.charts.bar(atc, { labels: mLbl, money: false, legend: true, stacked: true, options: countScales(true),
      datasets: [
        { label: 'Present', data: attRows.map(function (a) { return +a.present || 0; }), color: good },
        { label: 'Absent', data: attRows.map(function (a) { return +a.absent || 0; }), color: bad },
        { label: 'Late', data: attRows.map(function (a) { return +a.late || 0; }), color: warn }
      ] }));
  });

  var wrap = el('div');
  mountScreen(wrap, s);
  return wrap;
}

/* the tab → view map, in one place so the route and the embedded desk can never
 * drift apart (Master Accounts, Travels Accounts and cid/payroll are one screen) */
var VIEWS = { overview: overviewView, template: tplView, manage: manageView, loans: loansView,
  payslip: payslipView, advance: advanceView, reports: reportsView, staff: staffView };

/* =================================================== SALARY TEMPLATE
 * TWO THINGS LIVE ON THIS TAB, and they answer different questions:
 *   · the SALARY TEMPLATES LIST — what THIS person is paid: five components in
 *     fixed taka, a standing bonus, an overtime switch (+ its own rate) and any
 *     standing fine. Assigning one to an employee makes it their pay.
 *   · the STRUCTURE card below it — HOW a salary is split when there is no
 *     package, plus the statutory rules (tax, PF, leave, working days, the pay-by
 *     and correction days) that apply to EVERYONE either way.
 * Engine side: EPAL.payroll.salaryPackages/savePackage/deletePackage/fineSlip. */
function tplListView(page) {
  var s = screen('salary-templates');
  /* A template lives in ONE company, so the combined list is the union of the
   * per-company lists. It is asked for PER COMPANY on purpose: salaryPackages()
   * seeds a company's templates on first read, derived from the staff already on
   * its payroll and figure-for-figure identical to what the percentages compute —
   * exactly what opening that company's own tab does. Reading the store directly
   * instead would silently omit every company nobody had visited yet, and a
   * combined list that is missing a concern is worse than no list. What must
   * NEVER happen is salaryPackages(ALL): it would create a real template row for
   * a company called "all". */
  var pkgs = [];
  scopeCids().forEach(function (c) { pkgs = pkgs.concat(PR().salaryPackages(c)); });
  var staff = team();
  var nameOf = {}; staff.forEach(function (e) { nameOf[e.id] = e.name; });

  fillH(s, 'title', ui.icon('list-ul') + ' Salary Templates List');
  fillK(s, 'sub', pkgs.length + ' template' + (pkgs.length === 1 ? '' : 's') + ' · ' +
    pkgs.filter(function (p) { return (p.empIds || []).length; }).length + ' assigned' +
    (isAll() ? ' · across ' + scopeCids().length + ' companies' : ''));
  var addBtn = act(s, 'new', function () { pkgForm(null); });
  if (addBtn) {
    if (canCreate()) addBtn.innerHTML = ui.icon('plus-lg') + ' Add New Salary Template';
    else addBtn.parentNode.removeChild(addBtn);      // removed, never hidden
  }
  // the note points at the Structure card below it — which all-mode does not
  // show, because a structure belongs to one company (see tplView)
  fillH(s, 'note', ui.icon('info-circle') + ' A template states the actual taka. An employee on one is paid its <strong>total</strong>, split exactly as it says; anyone <em>not</em> on a template is still computed from the percentages in ' +
    (isAll() ? 'their own company’s Structure. Income tax, provident fund, absence, late and leave-encashment come from there too, so the statutory rules stay in one place per concern — pick a company from the switcher to read or edit its Structure.'
             : 'Structure below. Income tax, provident fund, absence, late and leave-encashment always come from Structure, so the statutory rules stay in one place.'));

  var rows = pkgs.map(function (p, i) {
    var ids = (p.empIds || []).filter(function (id) { return nameOf[id]; });
    var emp = ids.length ? empById(ids[0]) : null;
    return {
      id: p.id, no: i + 1, name: p.name, pkg: p, companyId: p.companyId,
      basic: +p.basic || 0, house: +p.house || 0, medical: +p.medical || 0,
      conveyance: +p.conveyance || 0, other: +p.other || 0, bonus: +p.bonus || 0,
      total: PR().packageTotal(p),
      emp: emp, empName: emp ? emp.name : '', empId: emp ? emp.id : '',
      ot: p.otEligible === false ? 'Off' : 'On', otRate: +p.otRate || 0,
      fine: +p.fine || 0, fineNote: p.fineNote || '',
      // a template whose total no longer matches the employee's recorded salary:
      // the pay follows the TEMPLATE, so say so rather than let the two drift silently
      drift: emp ? (PR().packageTotal(p) - (+emp.salary || 0)) : 0
    };
  });

  function money(k) {
    return { key: k, label: k === 'conveyance' ? 'Conveyance' : cap(k === 'house' ? 'House rent' : k === 'medical' ? 'Medical' : k === 'basic' ? 'Basic salary' : k === 'other' ? 'Other' : k),
      num: true, render: function (r) { return r[k] ? '<span class="num">' + ui.money(r[k]) + '</span>' : '<span class="text-mute">' + ui.money(0) + '</span>'; } };
  }
  var tbl = EPAL.table({
    rows: rows, pageSize: 12, sortDefault: 'none', exportName: 'salary-templates-' + CID,
    searchKeys: ['name', 'empName', 'empId'],
    empty: { icon: 'list-ul', title: 'No salary templates yet', hint: canCreate() ? 'Add one and assign it to an employee — it becomes their pay.' : 'Nobody is on a fixed salary package yet.' },
    // the company goes after the NAME (index 2), not after the row number
    columns: withCo([
      { key: 'no', label: '#', width: '44px', render: function (r) { return '<span class="text-mute">' + r.no + '</span>'; } },
      { key: 'name', label: 'Template name', render: function (r) {
        // when the template IS the person, the second line does not repeat their
        // name — it carries the employee ID, which is what you search by
        var who = r.empName ? (r.empName === r.name ? esc(r.empId) : esc(r.empName) + ' · ' + esc(r.empId)) : '';
        return '<div class="fw-700">' + esc(r.name) + '</div><div class="text-mute xs">' +
          (who ? ui.icon('person') + ' ' + who : '<em>not assigned to anyone</em>') +
          (r.drift ? ' · <span class="text-warn">' + (r.drift > 0 ? '+' : '−') + ui.money(Math.abs(r.drift)) + ' vs recorded salary</span>' : '') + '</div>';
      } },
      money('basic'), money('house'), money('medical'), money('conveyance'), money('other'),
      { key: 'bonus', label: 'Bonus', num: true, render: function (r) { return r.bonus ? '<span class="num text-good">+' + ui.money(r.bonus) + '</span>' : '<span class="text-mute">' + ui.money(0) + '</span>'; } },
      { key: 'total', label: 'Total salary', num: true, render: function (r) { return '<span class="num strong">' + ui.money(r.total) + '</span>'; } },
      { key: 'ot', label: 'Overtime', render: function (r) {
        return '<span class="badge badge-' + (r.ot === 'On' ? 'good' : '') + '">' + r.ot + '</span>' +
          (r.ot === 'On' && r.otRate ? '<div class="text-mute xs">' + ui.money(r.otRate) + ' /hr</div>' : '');
      } },
      { key: 'fine', label: 'Punishment', num: true, render: function (r) {
        if (!r.fine) return '<span class="text-mute">—</span>';
        return '<span class="num text-bad">−' + ui.money(r.fine) + '</span><div class="text-mute xs">' + esc(r.fineNote || 'standing, every month') + '</div>';
      } }
    ], null, 2),
    actions: canCreate() ? [
      { icon: 'pencil-square', title: 'Edit this template', onClick: function (r) { pkgForm(r.pkg); } },
      { icon: 'toggles', title: 'Turn overtime on / off', onClick: function (r) {
        var p = r.pkg, on = p.otEligible === false;
        PR().savePackage({ id: p.id, companyId: p.companyId, otEligible: on });
        ui.toast('Overtime ' + (on ? 'enabled' : 'disabled') + ' · ' + p.name, 'success'); EPAL.router.render();
      } },
      { icon: 'exclamation-diamond', title: 'Deduct a punishment from a month', onClick: function (r) { fineForm(r); } },
      { icon: 'trash', title: 'Delete this template', onClick: function (r) { deletePkg(r); } }
    ] : [{ icon: 'eye', title: 'Open this employee\'s file', onClick: function (r) { if (r.empId) showEmp(r.empId); } }],
    onRow: function (r) { if (r.empId) showEmp(r.empId); }
  });
  box(s, 'list').appendChild(tbl.el);
  mountScreen(page, s);
}

/* Add / edit one template. TOTAL IS NOT TYPED — it is the five components added
 * up, so the list can never show a total the payslip disagrees with. */
function pkgForm(p) {
  var isNew = !p;
  // in all-mode a NEW template has no company until an employee is picked — the
  // person's own company is the answer, and it is required (see onSave)
  p = p || { companyId: isAll() ? '' : CID, otEligible: true };
  var taken = {};
  // "one person, one template" is a GROUP rule as much as a company one — the
  // clash to warn about is any template already claiming this employee, wherever
  // it lives, so the check reads the whole scope
  scopeCids().forEach(function (c) {
    PR().salaryPackages(c).forEach(function (o) {
      if (o.id === p.id) return;
      (o.empIds || []).forEach(function (id) { taken[id] = o.name; });
    });
  });
  var mine = (p.empIds || [])[0] || '';
  var opts = [['', '— not assigned (a pay grade, nobody on it yet) —']].concat(team().map(function (e) {
    return [e.id, e.name + ' · ' + e.id + (isAll() ? ' · ' + coShort(e.companyId) : '') + (taken[e.id] ? '  (moves off "' + taken[e.id] + '")' : '')];
  }));
  EPAL.formModal({
    title: (isNew ? 'Add New Salary Template' : 'Edit Salary Template — ' + p.name), icon: 'list-ul', size: 'md',
    record: { name: p.name || '', empId: mine,
      basic: +p.basic || 0, house: +p.house || 0, medical: +p.medical || 0, conveyance: +p.conveyance || 0,
      other: +p.other || 0, bonus: +p.bonus || 0,
      otEligible: p.otEligible !== false, otRate: +p.otRate || 0, fine: +p.fine || 0, fineNote: p.fineNote || '' },
    fields: [
      { key: 'name', label: 'Template name', required: true, hint: 'The employee\'s name, or a grade like "Manager".' },
      { key: 'empId', label: 'Assign to employee', type: 'select', options: opts,
        hint: 'The assigned employee is paid THIS template from the current draft month on. One person, one template.' +
          (isAll() && !p.companyId ? ' On All Companies the employee also decides which company the template belongs to, so it is required here.' : '') },
      { type: 'section', label: 'Salary components (৳) — the total is these five added up' },
      { key: 'basic', label: 'Basic salary', type: 'money', min: 0, required: true },
      { key: 'house', label: 'House rent', type: 'money', min: 0, default: 0 },
      { key: 'medical', label: 'Medical allowance', type: 'money', min: 0, default: 0 },
      { key: 'conveyance', label: 'Conveyance allowance', type: 'money', min: 0, default: 0 },
      { key: 'other', label: 'Other allowance', type: 'money', min: 0, default: 0 },
      { key: 'bonus', label: 'Bonus (৳ every month)', type: 'money', min: 0, default: 0, hint: 'Paid on top of the total, every month, until it is changed here. Leave 0 for a one-off bonus — those are entered on the payslip.' },
      { type: 'section', label: 'Overtime' },
      { key: 'otEligible', label: 'Overtime allowed', type: 'checkbox' },
      { key: 'otRate', label: 'Overtime rate (৳ / hour)', type: 'money', min: 0, default: 0, hint: '0 = the company rate in Structure (which is itself 1.5× the hourly rate when unset). Hours are entered per month in Salary Manage.' },
      { type: 'section', label: 'Punishment — a standing deduction' },
      { key: 'fine', label: 'Fine every month (৳)', type: 'money', min: 0, default: 0, hint: 'Deducted every month until it is set back to 0. For a single incident use the ⚠ action on the list instead.' },
      { key: 'fineNote', label: 'Reason', hint: 'Printed on the payslip beside the deduction.' }
    ],
    saveLabel: isNew ? 'Create Template' : 'Save Template',
    onSave: function (v) {
      var total = (+v.basic || 0) + (+v.house || 0) + (+v.medical || 0) + (+v.conveyance || 0) + (+v.other || 0);
      if (total <= 0) { ui.toast('A template must add up to more than zero', 'error'); return false; }
      if (+v.fine > 0 && !String(v.fineNote || '').trim()) { ui.toast('A standing fine needs a reason — it is printed on the payslip', 'error'); return false; }
      // A template lives in ONE company: its own if it already has one, otherwise
      // the assigned employee's. It must never be saved against the 'all'
      // sentinel — the row would belong to a company that does not exist and no
      // payroll run would ever find it.
      var pkgCid = p.companyId || (v.empId ? empCo(v.empId) : (isAll() ? '' : CID));
      if (!pkgCid || pkgCid === ALL) { ui.toast('Pick the employee this template is for — that is which company it belongs to', 'error'); return false; }
      PR().savePackage({
        id: p.id, companyId: pkgCid, name: String(v.name).trim(),
        basic: +v.basic || 0, house: +v.house || 0, medical: +v.medical || 0,
        conveyance: +v.conveyance || 0, other: +v.other || 0, bonus: +v.bonus || 0,
        otEligible: !!v.otEligible, otRate: +v.otRate || 0,
        fine: +v.fine || 0, fineNote: String(v.fineNote || '').trim(),
        empIds: v.empId ? [v.empId] : [], seeded: false
      });
      regenDraft(pkgCid);
      ui.toast('Template saved · ' + ui.money(total) + (v.empId ? ' · applies from the open draft month' : ''), 'success');
      EPAL.router.render(); return true;
    }
  });
}

/* A one-off punishment on ONE month. It adds to whatever fine that month already
 * carries and lands on the payslip as its own line with the reason. */
function fineForm(r) {
  if (!r.empId) { ui.toast('Assign this template to an employee first', 'error'); return; }
  var months = monthSeries(12).slice().reverse().map(function (m) { return [m.ym, PR().mLabel(m.ym)]; });   // newest first
  if (!months.length) { ui.toast('No payroll month to deduct from yet', 'error'); return; }
  EPAL.formModal({
    title: 'Deduct a Punishment — ' + r.empName, icon: 'exclamation-diamond', size: 'sm',
    record: { ym: months[0][0], amount: 0, note: '' },
    fields: [
      { key: 'ym', label: 'Month', type: 'select', options: months, required: true },
      { key: 'amount', label: 'Amount (৳)', type: 'money', min: 0, required: true },
      { key: 'note', label: 'Reason', required: true, hint: 'Printed on the payslip beside the deduction.' }
    ],
    saveLabel: 'Deduct',
    onSave: function (v) {
      if (+v.amount <= 0) { ui.toast('Enter the amount to deduct', 'error'); return false; }
      try {
        PR().fineSlip(r.empId, v.ym, +v.amount, String(v.note).trim());
        ui.toast('Deducted ' + ui.money(+v.amount) + ' from ' + PR().mLabel(v.ym), 'success');
        EPAL.router.render(); return true;
      } catch (e) { ui.toast(e.message || 'Blocked', 'error'); return false; }
    }
  });
}

function deletePkg(r) {
  ui.confirm({ title: 'Delete "' + r.name + '"?', confirmLabel: 'Delete', danger: true,
    text: r.empName
      ? r.empName + ' goes back to the percentage structure on their recorded salary of ' + ui.money((r.emp && +r.emp.salary) || 0) + ' from the open draft month on. Months already finalized keep the figures they were finalized with unless they are reopened.'
      : 'Nobody is on this template, so no pay changes.' })
    .then(function (ok) {
      if (!ok) return;
      PR().deletePackage(r.id); regenDraft(r.companyId);
      ui.toast('Template deleted', 'success'); EPAL.router.render();
    });
}

/* Re-generate the CURRENT DRAFT month so a template change shows up immediately.
 * Deliberately only the draft: generate() rewrites every slip it touches, and a
 * finalized month's figures are what was posted to the ledger — they change only
 * when someone reopens the month on purpose. */
// `cid` = the company whose template just changed. On All Companies that is the
// template's own company, never the 'all' sentinel — generate() writes a run row
// and a run belongs to a real company.
function regenDraft(cid) {
  var c = (cid && cid !== ALL) ? cid : (isAll() ? null : CID);
  if (!c) return;
  var ym = PR().curYm(), run = PR().getRun(c, ym);
  if (!run || run.status === 'draft') { try { PR().generate(c, ym); } catch (e) {} }
}

function tplView(page) {
  tplListView(page);
  /* THE STRUCTURE CARD IS PER COMPANY, so All Companies does not show it — the
   * percentages, the tax threshold, the working days and the pay-by day are that
   * concern's own rules and there is no single set of them to edit. Reading
   * template('all') would not merely be meaningless: template() UPSERTS, so it
   * would create a statutory template for a company that does not exist. Instead
   * the tab shows every company's structure side by side, read-only, which is the
   * question All Companies can actually answer: where do the six differ? */
  if (isAll()) { structureCompare(page); return; }
  var t = PR().template(CID);
  var preview = el('div');
  function drawPreview(salary) {
    var e = { salary: salary || 50000, companyId: CID };
    var c = PR().computeSlip(e, PR().curYm(), {});
    preview.innerHTML = '';
    preview.appendChild(el('div.data-list', null, [
      drow('Sample gross', ui.money(c.gross)),
      drow('Basic (' + Math.round(t.basicPct * 100) + '%)', ui.money(c.basic)), drow('House (' + Math.round(t.housePct * 100) + '%)', ui.money(c.house)),
      drow('Medical (' + Math.round(t.medicalPct * 100) + '%)', ui.money(c.medical)), drow('Transport', ui.money(c.transport)),
      drow('Income tax', '−' + ui.money(c.tax)), drow('Provident fund', '−' + ui.money(c.pf)),
      drow('Leave encashment / mo', c.encashDays.toFixed(2) + ' day · ' + ui.money(c.encashAmt)),
      el('div.data-row', null, [ el('div.strong.flex-1', { text: 'Net payable' }), el('div.strong.text-good', { text: ui.money(c.net) }) ])
    ]));
  }
  var tc = frag('two-col');
  var scard = frag('head-card');
  slot(scard, 'title').innerHTML = ui.icon('sliders') + ' Structure';
  var sbody = slot(scard, 'body');
  sbody.appendChild(formField('Basic %', 'basicPct', Math.round(t.basicPct * 100)));
  sbody.appendChild(formField('House rent %', 'housePct', Math.round(t.housePct * 100)));
  sbody.appendChild(formField('Medical %', 'medicalPct', Math.round(t.medicalPct * 100)));
  sbody.appendChild(el('div.text-mute.xs.mb-2', { text: 'Transport = the remainder of gross.' }));
  sbody.appendChild(formField('Income-tax threshold (৳)', 'taxThreshold', t.taxThreshold));
  sbody.appendChild(formField('Income-tax %', 'taxPct', Math.round(t.taxPct * 100)));
  sbody.appendChild(formField('Provident fund % (of basic)', 'pfPct', Math.round(t.pfPct * 100)));
  sbody.appendChild(formField('Overtime rate / hour (0 = auto 1.5×)', 'overtimeRate', t.overtimeRate || 0));
  sbody.appendChild(formField('Lates per absent day', 'latesPerAbsent', t.latesPerAbsent || 3));
  sbody.appendChild(formField('Annual leave days', 'leaveDaysPerYear', t.leaveDaysPerYear));
  sbody.appendChild(formField('Working days / month', 'workingDays', t.workingDays));
  sbody.appendChild(formField('Pay-by day', 'payByDay', t.payByDay));
  sbody.appendChild(formField('Correction until day', 'correctionDay', t.correctionDay));
  if (canCreate()) sbody.appendChild(el('button.btn.btn-primary.mt-2', { html: ui.icon('save') + ' Save Template', onclick: function () { saveTpl(t); } }));
  tc.appendChild(scard);
  var pcard = frag('reg-card');
  slot(pcard, 'title').innerHTML = ui.icon('receipt') + ' Live Preview';
  slot(pcard, 'sub').textContent = 'a ৳50,000 salary';
  slot(pcard, 'body').appendChild(preview);
  tc.appendChild(pcard);
  page.appendChild(tc);
  drawPreview(50000);
}
/* EVERY COMPANY'S STRUCTURE, SIDE BY SIDE — what All Companies can honestly say
 * about a per-company rule set. Read-only, and read straight from the store
 * rather than through template(), which upserts: by the time this runs the
 * templates list above has already asked each company for its own (documented
 * there), so nothing here creates anything. Editing happens on the company. */
function structureCompare(page) {
  var have = scoped('pay_templates');
  var byCo = {}; have.forEach(function (t) { byCo[t.companyId] = t; });
  var rows = scopeCids().map(function (c) {
    var t = byCo[c] || null;
    return { companyId: c, t: t,
      basic: t ? Math.round(t.basicPct * 100) : null, house: t ? Math.round(t.housePct * 100) : null,
      medical: t ? Math.round(t.medicalPct * 100) : null, taxPct: t ? Math.round(t.taxPct * 100) : null,
      taxThreshold: t ? t.taxThreshold : null, pf: t ? Math.round(t.pfPct * 100) : null,
      leave: t ? t.leaveDaysPerYear : null, workingDays: t ? t.workingDays : null,
      payByDay: t ? t.payByDay : null, correctionDay: t ? t.correctionDay : null };
  });
  function pct(k) {
    return { key: k, label: { basic: 'Basic %', house: 'House %', medical: 'Medical %', taxPct: 'Tax %', pf: 'PF % (of basic)' }[k],
      num: true, render: function (r) { return r[k] == null ? '<span class="text-mute">—</span>' : r[k] + '%'; } };
  }
  function day(k, label) {
    return { key: k, label: label, num: true,
      render: function (r) { return r[k] == null ? '<span class="text-mute">—</span>' : String(r[k]); } };
  }
  var card = frag('reg-card');
  slot(card, 'title').innerHTML = ui.icon('sliders') + ' Salary Structure — every company';
  slot(card, 'sub').textContent = 'the statutory rules each concern computes an off-template salary with · pick a company from the switcher to edit its own';
  slot(card, 'body').appendChild(EPAL.table({
    columns: [
      { key: 'companyId', label: 'Company', render: function (r) { return coCell(r.companyId); },
        exportVal: function (r) { return coShort(r.companyId); } },
      pct('basic'), pct('house'), pct('medical'),
      { key: 'taxThreshold', label: 'Tax-free up to', num: true,
        render: function (r) { return r.taxThreshold == null ? '<span class="text-mute">—</span>' : ui.money(r.taxThreshold); } },
      pct('taxPct'), pct('pf'),
      day('leave', 'Annual leave'), day('workingDays', 'Working days'),
      day('payByDay', 'Pay by'), day('correctionDay', 'Corrections until')
    ],
    rows: rows, pageSize: 10, exportName: 'salary-structures.csv',
    pdfTitle: scopeFull() + ' — Salary Structures',
    empty: { icon: 'sliders', title: 'No company has a salary structure yet' }
  }).el);
  slot(card, 'body').appendChild(el('p.text-mute.xs.mt-2', { text:
    'Transport is the remainder of gross in every case. A dash means that company has never run a payroll, so it has no structure yet — it opens on the standard the first time one is generated.' }));
  page.appendChild(card);
}
function formField(label, key, val) {
  return el('div.form-row', { style: { marginBottom: '9px' } }, [
    el('label.text-mute.sm', { text: label, style: { display: 'block', marginBottom: '3px' } }),
    el('input.input', { type: 'number', value: String(val), 'data-key': key, style: { width: '100%' } })
  ]);
}
function saveTpl(t) {
  var page = document.querySelector('#view');
  function g(k) { var i = page.querySelector('[data-key="' + k + '"]'); return i ? +i.value : 0; }
  t.basicPct = g('basicPct') / 100; t.housePct = g('housePct') / 100; t.medicalPct = g('medicalPct') / 100;
  t.taxThreshold = g('taxThreshold'); t.taxPct = g('taxPct') / 100; t.pfPct = g('pfPct') / 100; t.overtimeRate = g('overtimeRate'); t.latesPerAbsent = g('latesPerAbsent') || 3;
  t.leaveDaysPerYear = g('leaveDaysPerYear'); t.workingDays = g('workingDays'); t.payByDay = g('payByDay'); t.correctionDay = g('correctionDay');
  if (t.basicPct + t.housePct + t.medicalPct > 1) { ui.toast('Basic + House + Medical cannot exceed 100%', 'error'); return; }
  PR().saveTemplate(t); ui.toast('Template saved', 'success'); EPAL.router.render();
}

/* =================================================== SALARY MANAGE */
function manageView(page) {
  var ym = payYm || PR().curYm();
  /* GENERATE ONLY ON A REAL COMPANY. This is the one screen that writes as a side
   * effect of being opened — it opens the month so there is a sheet to work on —
   * and on All Companies there is no single company to open it for. It would be
   * wrong twice: `generate('all', ym)` would create a pay_runs row for a company
   * that does not exist, and generating SIX months because someone glanced at a
   * combined view is not a glance, it is a payroll action. So all-mode reads the
   * months that already exist and offers no run controls. */
  if (!isAll()) { PR().generate(CID, ym); PR().refreshRunStatus(CID, ym); }
  var R = runInfo(ym), run = R.run;
  var slips = slipsIn(ym).slice().sort(function (a, b) { return (a.empName || '') < (b.empName || '') ? -1 : 1; });
  var gross = sum(slips, function (s) { return s.earnedGross; }), net = sum(slips, function (s) { return PR().slipPayable(s); });
  var paid = sum(slips, paidOf), due = net - paid;
  var st = R.status, inWin = R.inWindow;

  // THE DASHBOARD ROW (owner 2026-07-28) — the five flat KPI tiles became the
  // same four-card row Manage Banks uses, scoped to the selected month. Every
  // figure the tiles carried is still here: Headcount and Gross are drill facts,
  // Net Payable is the hero, Paid and Outstanding are the payment-progress card.
  var meta = scopeMeta();
  var advRec = sum(slips, advOf), emiRec = sum(slips, emiOf);
  if (isAll()) page.appendChild(scopeNote('Combined salary sheet — ' + scopeNames(),
    'Every employee on ' + PR().mLabel(ym) + ' across ' + R.n + ' of ' + scopeCids().length + ' payrolls, with the company on each row. Generating, finalizing, reopening and Pay All write a run, and a run belongs to one company — pick one from the switcher for those. Paying, adjusting and managing an individual salary work from right here, because they follow the employee.'));
  page.appendChild(dashRow({
    hue: meta.accent, icon: meta.icon, co: scopeShort(),
    coSub: PR().mLabel(ym) + (isAll() ? ' · ' + R.n + ' payroll runs · ' : ' payroll run · ') + cap(st),
    hero: ui.money(net), heroLabel: 'Net payable · ' + PR().mLabel(ym),
    heroTitle: 'Open this month in full', heroOn: function () { ovMonth = ym; goTab('overview'); },
    facts: [
      { k: 'Headcount', v: String(slips.length), title: 'Everyone on this run', on: function () { goTab('staff'); } },
      { k: 'Gross', v: ui.money(gross, { compact: true }), title: 'Earned gross this month', on: function () { ovMonth = ym; goTab('overview'); } },
      { k: 'Outstanding', v: ui.money(Math.max(0, due), { compact: true }), title: 'Still owed to staff', on: function () { ovMonth = ym; goTab('overview'); } }
    ],
    last: lastEventCfg(ym, 'Last posting this month'),
    flow: {
      title: 'Payment progress', sub: 'per employee · paid vs outstanding' + (slips.length ? '' : ' · nobody on this run'),
      rows: slips.map(function (s) { return { up: paidOf(s), down: dueOf(s), tip: s.empName + ' · paid ' + ui.money(paidOf(s)) + (dueOf(s) ? ' · due ' + ui.money(dueOf(s)) : '') }; }),
      net: due > 0 ? '−' + ui.money(due, { compact: true }) : ui.money(0), netUp: due <= 0,
      inText: 'Paid ' + ui.money(paid), outText: 'Due ' + ui.money(Math.max(0, due)),
      hint: 'Open the full month', on: function () { ovMonth = ym; goTab('overview'); }
    },
    recon: {
      icon: 'calculator', title: 'How the month adds up', hint: 'Open the full month',
      stats: [
        { k: 'Gross earned', v: ui.money(gross) },
        { k: 'Additions', v: '+' + ui.money(sum(slips, addOf)), tone: sum(slips, addOf) ? 'text-good' : '' },
        { k: 'Deductions', v: '−' + ui.money(sum(slips, dedOf)), tone: sum(slips, dedOf) ? 'text-warn' : '' },
        { k: 'Paid', v: ui.money(paid), tone: paid > 0 ? 'text-good' : '' }
      ],
      on: function () { ovMonth = ym; goTab('overview'); }
    },
    minis: [
      { t: ui.icon('cash') + ' Advance recovered', v: ui.money(advRec), s: 'taken from this month\'s pay', on: function () { goTab('advance'); } },
      { t: ui.icon('bank') + ' Loan EMI taken', v: ui.money(emiRec), s: 'auto-deducted → loan management', on: function () { goTab('loans'); } }
    ]
  }));

  // the month list: one entry per run on a company, and the UNION of months on
  // All Companies (six runs of January are ONE January to pick)
  var months = isAll()
    ? monthSeries().slice().reverse().map(function (m) { return { ym: m.ym, status: m.status || 'draft' }; })
    : scoped('pay_runs').sort(function (a, b) { return a.ym < b.ym ? 1 : -1; }).map(function (r) { return { ym: r.ym, status: r.status }; });
  var sel = el('select.input', { onchange: function () { payYm = this.value; EPAL.router.render(); } }); sel.classList.add('tw-max-w-[230px]');
  months.forEach(function (r) { var o = el('option', { value: r.ym, text: PR().mLabel(r.ym) + '  ·  ' + cap(r.status) }); if (r.ym === ym) o.selected = true; sel.appendChild(o); });
  var rcard = frag('run-card');
  var left = slot(rcard, 'left');
  left.appendChild(sel);
  left.appendChild(el('span.badge.badge-' + (st === 'paid' ? 'good' : st === 'due' ? 'bad' : st === 'draft' ? 'warn' : 'info'), { text: cap(st) }));
  var actions = slot(rcard, 'actions');
  actions.appendChild(el('button.btn.btn-ghost', { html: ui.icon('printer') + ' Print Sheet', onclick: function () { printSheetForm(slips, ym); } }));
  if (canCreate() && !isAll()) {
    if (st === 'draft') actions.appendChild(el('button.btn.btn-primary', { html: ui.icon('lock') + ' Finalize & Accrue', onclick: function () { finalizeRun(ym, net); } }));
    if (st !== 'draft') actions.appendChild(el('button.btn.btn-outline', { html: ui.icon('arrow-counterclockwise') + ' Reopen Draft',
      title: 'Rewind to the BEFORE-ACCRUED state — repeatable (demo-safe)',
      onclick: function () {
        var paidCount = slips.filter(function (s) { return paidOf(s) > 0; }).length;
        ui.confirm({ title: 'Reopen ' + PR().mLabel(ym) + ' as Draft?', confirmLabel: 'Reopen Draft',
          text: 'Shows the month as it was BEFORE accrual: ' + (paidCount ? paidCount + ' payment(s) are reversed, ' : '') + 'the accrual is lifted from the books, and ✎ adjustments unlock. You can Finalize & Accrue again any time — fully repeatable.' })
          .then(function (ok) { if (!ok) return; PR().unfinalize(CID, ym); ui.toast('Back to draft — before-accrued state', 'success'); EPAL.router.render(); });
      } }));
    if (st !== 'draft' && due > 0) actions.appendChild(el('button.btn.btn-primary', { html: ui.icon('cash-coin') + ' Pay All', onclick: function () { payAll(ym); } }));
  }
  // generate() above normally creates the run, but a hydrated install can answer
  // with slips and no run row — say so rather than crash (live 2026-07-28)
  slot(rcard, 'status').innerHTML = isAll()
    ? (R.has
        ? (R.n + ' compan' + (R.n === 1 ? 'y has' : 'ies have') + ' opened ' + PR().mLabel(ym) +
           (st === 'mixed' ? ' and they are <b>not at the same stage</b>' : ' and all of them are <b>' + esc(cap(st)) + '</b>') +
           (R.dueAfter ? ' — the last pay-by date is ' + ui.date(R.dueAfter) + '.' : '.'))
        : ('No company has opened ' + PR().mLabel(ym) + ' yet — pick one from the switcher to generate it.'))
    : !run
    ? ('No payroll run exists for ' + PR().mLabel(ym) + ' yet — generating this month will open one.')
    : st === 'draft'
      ? (inWin ? ('<b>Correction window open</b> until ' + ui.date(run.correctionUntil) + ' — adjust per head, then finalize.') : ('Correction window closed (' + ui.date(run.correctionUntil) + ') — finalize to accrue.'))
      : ('Finalized — pay by ' + ui.date(run.dueAfter) + ' or unpaid salaries flag Due.');

  /* PAYMENT PROGRESS — the card states the net and the outstanding as two separate
   * figures; this shows the relationship without making anyone do the division.
   * Appended here rather than added to the [data-tpl="run-card"] fragment, which is
   * one of the ORIGINALS whose pixels must not move.
   * The .meter lvl-* scale is risk-coloured, and that reads correctly once you see
   * WHAT is being metered: unpaid salary. All paid = lvl-low = green. */
  if (net > 0) {
    var pm = shell('paymeter');
    var pct = Math.max(0, Math.min(100, Math.round(paid / net * 100)));
    fillK(pm, 'label', 'Paid ' + ui.money(paid) + ' of ' + ui.money(net) + (due > 0 ? ' · ' + ui.money(due) + ' still owed' : ''));
    fillK(pm, 'pct', pct + '%');
    var bar = part(pm, 'bar');
    bar.style.width = pct + '%';
    bar.classList.add(pct >= 100 ? 'lvl-low' : (pct > 0 ? 'lvl-mid' : 'lvl-high'));
    rcard.querySelector('.card-body').appendChild(pm);
  }
  page.appendChild(rcard);

  // The FULL salary sheet: Gross | OT | Bonus | Encash | Advance | Loan EMI |
  // Absent | Other ded | Net Payable | Paid | Due | Status per head.
  // (advOf / emiOf / otherOf / dueOf are shared helpers — see the top of the
  // file — so the sheet, the month register and the radar read a slip alike.)
  // Every row now adds up left to right: gross + OT + bonus − advance − EMI −
  // absent − other = net payable, and net payable − paid = due. Encash is the
  // one column that stands outside it: a yearly accrual, paid once, and it moves
  // none of the three (owner 2026-07-30).
  var tbl = EPAL.table({
    columns: withCo([
      { key: 'empName', label: 'Employee', render: function (s) { return EPAL.people ? EPAL.people.linkify(s.empName, s.empId) : '<span class="strong">' + esc(s.empName) + '</span>'; } },
      { key: 'gross', label: 'Gross', num: true, money: true },
      { key: 'overtime', label: 'OT', num: true, render: function (s) { return s.overtime ? ui.money(s.overtime) : '—'; }, sortVal: function (s) { return s.overtime || 0; } },
      { key: 'bonus', label: 'Bonus', num: true, render: function (s) { var v = bonusOf(s); return v ? ui.money(v) : '—'; }, sortVal: bonusOf },
      { key: 'encashAmt', label: 'Encash', num: true, money: true },
      { key: 'adv', label: 'Advance', num: true, sortVal: advOf, render: function (s) { var v = advOf(s); return v ? '<span class="text-warn">' + ui.money(v) + '</span>' : '—'; } },
      { key: 'emi', label: 'Loan EMI', num: true, sortVal: emiOf, render: function (s) { var v = emiOf(s); return v ? '<span class="text-warn">' + ui.money(v) + '</span>' : '—'; } },
      { key: 'absentDeduction', label: 'Absent', num: true, sortVal: function (s) { return s.absentDeduction || 0; }, render: function (s) { return s.absentDeduction ? '<span class="text-bad">' + ui.money(s.absentDeduction) + '</span>' : '—'; } },
      { key: 'other', label: 'Other Ded.', num: true, sortVal: otherOf, render: function (s) { var v = otherOf(s); return v ? ui.money(v) : '—'; } },
      { key: 'net', label: 'Net Payable', num: true, sortVal: function (s) { return PR().slipPayable(s); }, render: netCell },
      { key: 'paid', label: 'Paid', num: true, sortVal: paidOf, render: function (s) { var v = paidOf(s); return v ? '<span class="text-good">' + ui.money(v) + '</span>' : '—'; } },
      { key: 'due', label: 'Due', num: true, sortVal: dueOf, render: function (s) { var v = dueOf(s); return v ? '<span class="num strong text-bad">' + ui.money(v) + '</span>' : '—'; } },
      { key: 'status', label: 'Status', badge: { draft: '', accrued: 'info', partial: 'warn', due: 'bad', paid: 'good' } }
    ]),
    rows: slips, searchKeys: ['empName', 'empId', 'dept'], quickFilter: 'status', filterPanel: true,
    filters: [{ key: 'dept', label: 'Dept' }].concat(coFilter()),
    totalKey: 'net',
    /* THE FOOT (owner 2026-07-30: "add a totals row at the bottom of the table
     * that sums every numeric column"). Every money column is a plain sum of the
     * filtered set — search or filter the sheet and the foot follows it. The two
     * count columns are not money and say what they count instead. */
    totals: sheetTotals,
    /* PRINT — the DISBURSEMENT SHEET, beside Export and PDF where the reader looks
     * for this table's outputs. It opens the print centre on this month at
     * disbursement level: one row per employee, what to hand over, and a signature
     * line each. "Only unpaid" in the centre narrows it to the people actually
     * being paid today.
     * The control bar's older "Print Sheet" (tick the columns → a plain sheet) is
     * untouched: it answers "give me these columns quickly", which is a different
     * question from "give me the document the cashier signs". */
    toolbarEl: el('button.btn.btn-sm.btn-ghost', { html: ui.icon('printer') + ' Print',
      title: 'Print the disbursement sheet — signature line per employee (approved runs only)',
      onclick: function () { printCentre({ from: 'disburse', ym: ym }); } }),
    exportName: 'salary-sheet-' + ym + '.csv', pdfTitle: 'Salary Sheet — ' + PR().mLabel(ym),
    onRow: function (s) { var e = empById(s.empId); if (e) statement(e, ym); },
    actions: (canCreate() ? [{ icon: 'wallet2', title: 'Manage salary — pay / partial / due / advance / status', onClick: function (s) { manageSalary(s, ym); } }] : []).concat(ui.actions({
      edit: canCreate() ? function (s) { correctionForm(s, ym); } : null,
      print: function (s) { var e = empById(s.empId); if (e) statementPrint(e, ym); }
    })),
    empty: { icon: 'cash-stack', title: 'No employees to pay' }
  });
  // .tbl-dense: the 13-column salary sheet fits without a horizontal scrollbar.
  var scard = frag('salary-card');
  slot(scard, 'title').innerHTML = ui.icon('cash-stack') + ' Salary Sheet — ' + PR().mLabel(ym) + (isAll() ? ' · every company' : '');
  slot(scard, 'sub').textContent = 'click a row = payslip · 💰 manage pay/due/status · ✎ adjust';
  slot(scard, 'body').appendChild(tbl.el);
  page.appendChild(scard);

  page.appendChild(monthMakeupCard(slips, ym, net, paid));

  // PAYROLL HISTORY sits directly under the sheet (owner 2026-07-28). It goes in
  // BEFORE the pay-individual-salaries grid on purpose: that grid only exists
  // when the run is finalized and something is still owed, so appending after it
  // would move the history card up and down the page as the run status changes.
  page.appendChild(payrollHistoryCard());

  if (st !== 'draft' && due > 0 && canCreate()) {
    var pgrid = frag('grid-auto-compact');
    slips.forEach(function (s) { var out = dueOf(s); if (out <= 0) return;
      var card2 = frag('pay-tier-card');
      slot(card2, 'name').textContent = s.empName;
      slot(card2, 'out').textContent = 'Outstanding ' + ui.money(out);
      var b = slot(card2, 'badge'); b.classList.add('badge-' + (s.status === 'due' ? 'bad' : 'warn')); b.textContent = cap(s.status);
      card2.addEventListener('click', (function (ss) { return function () { payForm(ss, ym); }; })(s));
      pgrid.appendChild(card2); });
    var pcard = frag('head-card'); slot(pcard, 'title').innerHTML = ui.icon('cash-coin') + ' Pay individual salaries'; slot(pcard, 'body').appendChild(pgrid);
    page.appendChild(pcard);
  }
}
/* HOW THIS MONTH IS MADE UP (owner 2026-07-29: "how much am I gonna have as
 * deduction from employees' loans, absent, punishments, advance EMI — how much am
 * I gonna pay extra as overtime, bonus?").
 *
 * The sheet answers it per head and the dashboard answers it as two words —
 * "Additions" and "Deductions" — which is exactly the granularity the question is
 * NOT asked at. This is the same arithmetic the payslip runs, summed over the run,
 * so the two figures that matter are both on it: the NET PAYABLE (what the month
 * costs) and the CASH TO HAND OUT (what actually leaves an account, once the
 * advances and EMIs the company recovers come off).
 *
 * SHAPE (owner 2026-07-29: "make this card more compact, two columns"). It used to
 * be one full-width column of up to fourteen rows — a metre of near-empty card,
 * with each label a long way from its own figure. Now the three ANCHORS (gross,
 * net, cash) stay full-width rules across the card, and the movement between them
 * sits in two columns side by side: what was added on the left, what was taken off
 * on the right, each carrying its own subtotal in its heading. Same rows, same
 * arithmetic, roughly half the height, and the two sides can be compared at a
 * glance instead of by scrolling one past the other.
 *
 * A zero line is dropped — a month with no fine should not print a fine of ৳0 —
 * but the three anchors and both column subtotals always show, so the card can
 * always be added up.
 *
 * IT OPENS ON THE FULL GROSS, not on the sheet's `earnedGross`. The two differ by
 * exactly the absence deduction (`earnedGross = gross − absentDeduction`), so
 * anchoring on the earned figure and then printing Absent as a deduction line
 * takes absence off twice and the column stops adding up — which is what the
 * headless driver caught: it walked to ৳197,493 against a stated ৳202,093, short
 * by the ৳4,600 of absence. Every other card on this screen keeps reading
 * `earnedGross`; only this one, which has to be added up by eye, opens on gross. */
function monthMakeupCard(slips, ym, net, paid) {
  var f = function (fn) { return sum(slips, fn); };
  var gross = f(function (s) { return s.gross; });
  var adds = [
    ['Overtime', f(function (s) { return s.overtime; })],
    ['Bonus', f(bonusOf)],
    ['Salary adjustment', f(function (s) { return Math.max(0, s.adjustment || 0); })]
  ];
  /* THE ADVANCE AND THE EMI ARE DEDUCTIONS ON THIS CARD NOW (owner 2026-07-30).
   * They used to sit BELOW the net as a separate recovery block, because the net
   * did not carry them; now that it does, leaving them down there would take them
   * off twice and the card would walk to a figure the sheet never shows. They
   * lead the column, in the owner's order: advance, then EMI, then the rest. */
  var deds = [
    ['Advance', f(advOf)],
    ['Loan EMI', f(emiOf)],
    ['Absent', f(function (s) { return s.absentDeduction; })],
    ['Late', f(function (s) { return s.lateDeduction; })],
    ['Early leave', f(function (s) { return s.earlyDeduction; })],
    ['Fine / punishment', f(function (s) { return s.fine; })],
    ['Income tax', f(function (s) { return s.tax; })],
    ['Provident fund', f(function (s) { return s.pf; })],
    ['Other deduction', f(function (s) { return s.otherDeduction; })],
    ['Negative adjustment', f(function (s) { return Math.max(0, -(s.adjustment || 0)); })]
  ];
  /* One detail line — a label and its signed figure, sitting inside a column. */
  function line(k, v, sign) {
    return el('div.makeup-line', null, [
      el('div.makeup-k', { text: k }),
      el('div.makeup-v', { text: (sign ? sign + ' ' : '') + ui.money(v) })
    ]);
  }
  /* One anchor — the three figures the column has to be added up TO, so they read
     as rules across the card rather than as another detail line. */
  function anchor(k, v, mod) {
    return el('div.makeup-anchor' + (mod || ''), null, [
      el('div.makeup-k', { text: k }),
      el('div.makeup-v', { text: ui.money(v) })
    ]);
  }
  /* A side. Its own subtotal rides in the heading, so the two columns can be read
     against each other without adding either of them up first. A side with no
     movement this month still prints — an empty half would knock the pair out of
     alignment and read as a missing column rather than as "nothing happened". */
  function side(label, items, sign, mod) {
    var live = items.filter(function (i) { return i[1]; });
    var tot = live.reduce(function (a, i) { return a + i[1]; }, 0);
    return el('div.makeup-col' + mod, null, [
      el('div.makeup-colhead', null, [
        el('span.makeup-coltitle', { text: label }),
        el('span.makeup-coltotal', { text: sign + ' ' + ui.money(tot) })
      ]),
      el('div.makeup-lines', null, live.length
        ? live.map(function (i) { return line(i[0], i[1], sign); })
        : [el('div.makeup-none', { text: 'nothing this month' })])
    ]);
  }
  var body = [
    anchor('Gross salary', gross),
    el('div.makeup-cols', null, [
      side('Additions', adds, '+', '.is-add'),
      side('Deductions', deds, '−', '.is-ded')
    ]),
    anchor('Net payable to staff', net)
  ];
  /* …which is also the cash, and the card says so rather than quietly printing
   * one figure twice: the recoveries are in the column above, so nothing is left
   * to take off between the net and the money that leaves an account. */
  body.push(anchor('Cash to hand out', Math.max(0, net), '.is-cash'));
  var c = frag('reg-card');
  slot(c, 'title').innerHTML = ui.icon('calculator') + ' How ' + PR().mLabel(ym) + ' is made up';
  slot(c, 'sub').textContent = 'what is added, what is deducted, and what actually leaves an account';
  slot(c, 'body').appendChild(el('div.makeup', null, body));
  slot(c, 'body').appendChild(el('p.text-mute.xs.mt-2', { text:
    'Advance and loan EMI come back to the company out of the salary, so they are deducted from the net payable but not from the cost — the ledger books them against the advance and the loan, not against salary expense. Paid so far: '
    + ui.money(paid) + ' of ' + ui.money(net) + '.' }));
  return c;
}

/* Both of these accrue or pay a whole RUN, which belongs to one company. All-mode
 * never offers their buttons; the guard is here as well because a run action must
 * be impossible to reach with the 'all' sentinel, not merely hard to reach. */
function needsOneCompany(what) {
  if (!isAll()) return false;
  ui.toast(what + ' belongs to one company — pick one from the switcher', 'error');
  return true;
}
function finalizeRun(ym, net) {
  if (needsOneCompany('Finalizing a payroll month')) return;
  /* THE ROW-BY-ROW PROOF RUNS BEFORE THE QUESTION IS EVEN ASKED (owner
   * 2026-07-30: "before a payroll run can be approved, check every row: earnings
   * − all deductions = net payable. If any row fails, block approval and show
   * which rows and by how much"). The engine re-derives every row from its own
   * fields and refuses to accrue a month that does not add up; this is the same
   * verdict, shown before anything is posted rather than as a toast afterwards. */
  var chk = PR().runCheck(CID, ym);
  if (!chk.ok) { blockedApproval(chk, ym); return; }
  ui.confirm({ title: 'Finalize ' + PR().mLabel(ym) + '?', text: 'Locks corrections and accrues salaries + leave encashment to the ledger. Net ' + ui.money(net) + '. The advance and loan EMI on the sheet are deducted now — they come off the loan book with it.', confirmLabel: 'Finalize' })
    .then(function (ok) { if (!ok) return;
      try { PR().finalize(CID, ym); ui.toast('Payroll finalized', 'success'); EPAL.router.render(); }
      catch (e) { if (e && e.check) blockedApproval(e.check, ym); else ui.toast(e.message || 'Failed', 'error'); } });
}
/* WHICH ROWS FAILED, AND BY HOW MUCH — the block, in one modal. It names the
 * employee, what the row should come to, what it says, and the difference. */
function blockedApproval(chk, ym) {
  var body = el('div');
  body.appendChild(el('p.text-mute.sm', { html: '<b>' + chk.failed.length + ' row(s)</b> do not add up, so ' +
    esc(PR().mLabel(ym)) + ' cannot be approved. Earnings less every deduction must equal net payable on every row.' }));
  body.appendChild(EPAL.table({
    columns: [
      { key: 'empName', label: 'Employee' },
      { key: 'earnings', label: 'Earnings', num: true, money: true },
      { key: 'deductions', label: 'Deductions', num: true, money: true },
      { key: 'expected', label: 'Should be', num: true, render: function (r) { return '<span class="num strong">' + ui.money(r.expected) + '</span>'; } },
      { key: 'actual', label: 'Sheet says', num: true, money: true },
      { key: 'diff', label: 'Off by', num: true, render: function (r) { return '<span class="num strong text-bad">' + ui.money(r.diff) + '</span>'; } }
    ], rows: chk.failed, pageSize: 10, exportName: 'payroll-check-' + ym + '.csv'
  }).el);
  ui.modal({ title: 'Approval blocked — ' + PR().mLabel(ym), icon: 'shield-exclamation', size: 'lg', body: body, footer: false });
}
function payAll(ym) {
  if (needsOneCompany('Paying a whole payroll run')) return;
  ui.confirm({ title: 'Pay all outstanding?', text: 'Posts each payment (recovers any advance).', confirmLabel: 'Pay All' })
    .then(function (ok) { if (!ok) return; PR().slipsFor(CID, ym).forEach(function (s) { try { PR().pay(s.empId, ym); } catch (e) {} }); ui.toast('Salaries paid', 'success'); EPAL.router.render(); });
}
/* ============================================================================
 * THE ALLOCATOR — pay several months in one go, each month its own figure
 * ----------------------------------------------------------------------------
 * Owner 2026-07-29: "he might have 20K due for his March salary and 40K for
 * July, so I can pay 15K against the due (due becomes 5K) and 30K against July
 * (10K goes to the due) — total due 15K."
 *
 * Before this, salary payment could only aim at ONE month: the Pay… form paid
 * the month whose row you clicked, and past months were all-or-nothing through
 * Pay Arrears (payArrears clears every old month in full, oldest first). There
 * was no way to put a part-payment against March and a different part-payment
 * against July in the same breath — you either cleared March entirely or paid
 * nothing towards it.
 *
 * The accounting did not need a single change to allow this: the engine's
 * pay(empId, ym, amount, method) has always taken a partial amount against a
 * NAMED month, leaving the rest on 2100 Salary Payable as the company's debt.
 * What was missing was a way to SAY it. So this is one posting per month with a
 * figure in it — exactly what the engine already books — and every guard it
 * carries (never more than outstanding, advance/EMI recovery, the ledger
 * ceiling) still applies to each leg untouched.
 *
 * It lists EVERY month the employee is still owed for, not just the one that
 * was opened and not just the earlier ones — previousDueList against a
 * far-future month returns the lot, oldest first, and the opened month is
 * simply marked. Opening March must still show that July is unpaid.
 *
 * Returns { el, post() } so the same widget serves both surfaces: it renders
 * inline inside Manage Salary and it is the body of the Pay… modal.
 * ==========================================================================*/
function allocRows(empId, ym) {
  // '9999-12' is an upper bound, not a date: previousDueList filters `s.ym < ym`,
  // so this asks for "every unpaid month there is" instead of "before this one".
  return (PR().previousDueList(empId, '9999-12') || []).map(function (r) {
    return { ym: r.ym, label: r.label, owed: r.amount, since: r.dueSince, paid: r.paid, current: r.ym === ym };
  });
}
function payAllocator(emp, ym) {
  var rows = allocRows(emp.id, ym);
  var wrap = el('div');
  if (!rows.length) {
    wrap.appendChild(el('p.text-mute.sm', { text: emp.name + ' has nothing outstanding — every accrued month is paid in full.' }));
    return { el: wrap, post: function () { ui.toast('Nothing outstanding to pay', 'error'); return false; } };
  }
  var owedTotal = sum(rows, function (r) { return r.owed; });

  /* WHICH ACCOUNT the salary leaves. The generic list ('Bank', 'Cash', …) is kept
   * at the end of EPAL.pay.options — a cheque nobody registered an account for
   * must still be recordable — and 'm:<Method>' is unwrapped back to the plain
   * word before it reaches pay(), so the Method badge everywhere else reads as
   * it always has. */
  // the accounts of the EMPLOYEE'S company — it is that company's money paying
  // its own staff, and on All Companies the desk's scope is not a payer
  var srcSel = el('select.input', { style: { minWidth: '210px' } });
  payOptions(emp.companyId)
    .forEach(function (o) { srcSel.appendChild(el('option', { value: o[0], text: o[1] })); });
  var dateIn = el('input.input', { type: 'date', value: today() });

  var quick = el('div.alloc-quick');
  var list = el('div.alloc');
  var footL = el('div'), footR = el('div');
  var inputs = [];

  rows.forEach(function (r) {
    var inp = el('input.input.alloc-in', { type: 'number', min: '0', step: '0.01',
      max: String(r.owed), placeholder: '0', title: 'Amount to pay against ' + r.label });
    inp.setAttribute('data-alloc-ym', r.ym);
    var left = el('div.alloc-left');
    inputs.push({ r: r, inp: inp, left: left });
    list.appendChild(el('div.alloc-row', null, [
      el('div.alloc-m', null, [
        el('div.alloc-mn', { text: r.label + (r.current ? ' · this month' : '') }),
        el('div.alloc-ms', { text: (r.paid ? 'part-paid ' + ui.money(r.paid) + ' · ' : '') + 'due since ' + ui.date(r.since) })
      ]),
      el('div.alloc-owed', { text: 'owed ' + ui.money(r.owed) }),
      inp, left
    ]));
  });

  function recalc() {
    var pay = 0;
    inputs.forEach(function (x) {
      var v = Math.max(0, Math.min(+x.inp.value || 0, x.r.owed));
      pay += v;
      var rest = x.r.owed - v;
      x.left.textContent = rest <= 0.5 ? 'cleared' : 'left ' + ui.money(rest);
      x.left.className = 'alloc-left' + (rest <= 0.5 ? ' is-clear' : (v > 0 ? ' is-owing' : ''));
    });
    footL.innerHTML = 'Paying now <span class="alloc-foot-v">' + esc(ui.money(pay)) + '</span>';
    footR.innerHTML = 'Total due after this <span class="alloc-foot-v ' +
      (owedTotal - pay <= 0.5 ? 'text-good' : 'text-warn') + '">' + esc(ui.money(owedTotal - pay)) + '</span>';
  }
  inputs.forEach(function (x) { x.inp.addEventListener('input', recalc); });

  function fill(pick) {
    inputs.forEach(function (x) { x.inp.value = pick(x.r) ? String(x.r.owed) : ''; });
    recalc();
  }
  quick.appendChild(el('button.btn.btn-xs.btn-outline', { type: 'button',
    html: ui.icon('check2-all') + ' Fill everything (' + ui.money(owedTotal) + ')',
    onclick: function () { fill(function () { return true; }); } }));
  if (rows.some(function (r) { return !r.current; })) {
    quick.appendChild(el('button.btn.btn-xs.btn-outline', { type: 'button',
      html: ui.icon('hourglass-split') + ' Past dues only',
      onclick: function () { fill(function (r) { return !r.current; }); } }));
  }
  if (rows.some(function (r) { return r.current; })) {
    quick.appendChild(el('button.btn.btn-xs.btn-outline', { type: 'button',
      html: ui.icon('calendar-check') + ' This month only',
      onclick: function () { fill(function (r) { return r.current; }); } }));
  }
  quick.appendChild(el('button.btn.btn-xs.btn-outline', { type: 'button',
    html: ui.icon('x-circle') + ' Clear', onclick: function () { fill(function () { return false; }); } }));

  wrap.appendChild(el('div.flex.gap-2.flex-wrap.items-end.mb-2', null, [
    field('Paid from', srcSel), field('Payment date', dateIn)
  ]));
  wrap.appendChild(quick);
  wrap.appendChild(list);
  wrap.appendChild(el('div.alloc-foot', null, [footL, footR]));
  wrap.appendChild(el('p.text-mute.xs.mt-2', { text:
    'Each month is posted on its own, so a part-payment leaves the rest of THAT month on Salary Payable and it keeps ' +
    'showing as that month\'s due. Advance and loan EMI are recovered out of each posting exactly as they are on a normal payment.' }));
  recalc();

  function post() {
    var picks = inputs.map(function (x) {
      return { ym: x.r.ym, label: x.r.label, amt: Math.max(0, Math.min(+x.inp.value || 0, x.r.owed)) };
    }).filter(function (p) { return p.amt > 0.005; });
    if (!picks.length) { ui.toast('Put an amount against at least one month', 'error'); return false; }
    var raw = srcSel.value, method = raw.indexOf('m:') === 0 ? raw.slice(2) : raw;   // 'm:Bank' -> 'Bank'
    var when = dateIn.value || today();
    var done = 0, total = 0, failed = [];
    picks.forEach(function (p) {
      try { PR().pay(emp.id, p.ym, p.amt, method, { date: when }); done++; total += p.amt; }
      catch (x) { failed.push(p.label + ' — ' + (x.message || 'failed')); }
    });
    if (!done) { ui.toast(failed[0] || 'Nothing could be posted', 'error'); return false; }
    ui.toast(ui.money(total) + ' posted across ' + done + ' month' + (done > 1 ? 's' : '') +
      (failed.length ? ' · ' + failed.length + ' could not post' : ''), failed.length ? 'warning' : 'success');
    if (failed.length) failed.forEach(function (f) { ui.toast(f, 'error'); });
    EPAL.router.render();
    return true;
  }
  return { el: wrap, post: post };
}
/* The Pay… button's form — the allocator on its own, for when the month list is
 * all that is wanted. Manage Salary renders the same widget inline. */
function payForm(s, ym) {
  // the slip carries the company even when the employee record has gone, and the
  // allocator needs it to offer the right accounts
  var emp = empById(s.empId) || { id: s.empId, name: s.empName, companyId: s.companyId };
  var a = payAllocator(emp, ym);
  // onClick returning false keeps the modal open, so a rejected posting does not
  // throw the operator's figures away
  return ui.modal({ title: 'Pay — ' + s.empName, icon: 'cash-coin', size: 'lg', body: a.el, actions: [
    { label: 'Cancel', variant: 'ghost' },
    { label: 'Post Payment', variant: 'primary', icon: 'cash-coin', onClick: function () { return a.post(); } }
  ] });
}

/* ---- MANAGE SALARY modal (legacy el()) ---------------------------------- */
function manageSalary(s, ym) {
  var e = empById(s.empId); if (!e) { ui.toast('Employee not found', 'error'); return; }
  // THE SLIP'S OWN COMPANY, not the desk's scope: this modal is about one
  // person's month, and on All Companies the desk has no single run to read
  var run = PR().getRun(s.companyId || CID, ym), st = run ? run.status : 'draft';
  var payable = PR().slipPayable(s), out = dueOf(s);
  var advOut = PR().advanceOutstanding(e.id), arrears = PR().previousDue(e.id, ym);
  var body = el('div');
  // 'md' → 'lg': the modal now carries the full record read-out and the month-by-
  // month allocator beneath the part it always had, and 420px cannot hold a
  // four-column fact grid without wrapping every tile onto its own line.
  var m = ui.modal({ title: 'Manage Salary — ' + s.empName + ' · ' + PR().mLabel(ym), icon: 'wallet2', size: 'lg', body: body, footer: false });
  function act(label, icon2, kind, fn, hint) {
    return el('button.btn' + (kind || '.btn-outline'), { html: ui.icon(icon2) + ' ' + label, title: hint || '', onclick: fn });
  }
  body.appendChild(el('div.card', null, [ el('div.card-body', null, [
    el('div.flex.items-center.gap-2.flex-wrap.mb-2', null, [
      el('div.flex-1', null, [ el('div.fw-700', { html: EPAL.people ? EPAL.people.linkify(s.empName, s.empId) : esc(s.empName) }),
        el('div.text-mute.sm', { text: PR().mLabel(ym) + ' · run ' + cap(st) }) ]),
      el('span.badge.badge-' + (s.status === 'paid' ? 'good' : s.status === 'due' ? 'bad' : s.status === 'partial' ? 'warn' : 'info'), { text: cap(s.status) })
    ]),
    el('div.stat-row.mb-3', null, [
      el('div.stat', null, [el('div.stat-label', { text: 'Net payable' }), el('div.stat-value', { text: ui.money(payable) })]),
      el('div.stat', null, [el('div.stat-label', { text: 'Paid' }), el('div.stat-value', { text: ui.money(paidOf(s)) })]),
      el('div.stat', null, [el('div.stat-label', { text: 'Due (this month)' }), el('div.stat-value', { text: ui.money(out) })]),
      el('div.stat', null, [el('div.stat-label', { text: 'Advance out' }), el('div.stat-value', { text: ui.money(advOut) })]),
      arrears ? el('div.stat', null, [el('div.stat-label', { text: 'Past-months due' }), el('div.stat-value', { text: ui.money(arrears) })]) : null
    ].filter(Boolean)),
    st === 'draft' ? el('div.text-mute.sm.mb-2', { html: ui.icon('info-circle') + ' This month is still a <b>draft</b> — adjust freely, then <b>Finalize & Accrue</b> (top of the sheet) to unlock payment.' }) : null,
    el('div.flex.gap-1.flex-wrap', null, [
      (st !== 'draft' && out > 0) ? act('Pay… (partial allowed)', 'cash-coin', '.btn-primary', function () { m.close(); payForm(s, ym); }, 'Choose how much to pay now — the rest stays Due') : null,
      (st !== 'draft' && out > 0) ? act('Pay Full (' + ui.money(out) + ')', 'check2-circle', null, function () { try { PR().pay(s.empId, ym); ui.toast('Paid in full', 'success'); m.close(); EPAL.router.render(); } catch (x) { ui.toast(x.message || 'Failed', 'error'); } }) : null,
      (s.paid > 0) ? act('Mark Unpaid (undo payment)', 'arrow-counterclockwise', null, function () {
        ui.confirm({ title: 'Undo this month\'s payment?', text: ui.money(s.paid) + ' will be reversed in the books (cash restored, salary payable + advance/loan balances restored).', danger: true, confirmLabel: 'Mark Unpaid' })
          .then(function (ok) { if (!ok) return; PR().unpay(s.empId, ym); ui.toast('Payment reversed — status back to unpaid', 'success'); m.close(); EPAL.router.render(); }); }, 'Flips Paid → Unpaid with a clean reversal') : null,
      (st === 'draft') ? act('Adjust (absent/late/OT/bonus/deduction)', 'sliders', null, function () { m.close(); correctionForm(s, ym); }) : null,
      act('Give Advance', 'cash', null, function () { m.close(); moneyForm(e, 'advance'); }, 'Auto-deducts from the next payslip'),
      arrears > 0 && canCreate() ? act('Pay Arrears (' + ui.money(arrears) + ')', 'hourglass-split', null, function () {
        ui.confirm({ title: 'Pay all past-month dues?', text: ui.money(arrears) + ' across earlier months.', confirmLabel: 'Pay Arrears' })
          .then(function (ok) { if (!ok) return; PR().payArrears(e.id); ui.toast('Arrears paid', 'success'); m.close(); EPAL.router.render(); }); }) : null,
      act('Payslip', 'receipt', null, function () { m.close(); statement(e, ym); })
    ].filter(Boolean))
  ]) ]));

  /* …and beneath the part that was always here, the month READ OUT IN FULL and
     the allocator. Everything above this line is untouched. */
  body.appendChild(salaryRecordCard(e, s, ym, run, st));
  body.appendChild(attendanceCard(e, s, ym));
  body.appendChild(deductionCard(e, s));
  body.appendChild(additionCard(e, s));
  if (canCreate()) {
    var alloc = payAllocator(e, ym);
    var pc = frag('reg-card');
    slot(pc, 'title').innerHTML = ui.icon('cash-coin') + ' Pay now — month by month';
    slot(pc, 'sub').textContent = 'put a figure against each month; what you leave stays as that month\'s due';
    slot(pc, 'body').appendChild(alloc.el);
    slot(pc, 'body').appendChild(el('div.flex.justify-end.mt-2', null, [
      el('button.btn.btn-primary', { html: ui.icon('cash-coin') + ' Post Payment',
        onclick: function () { if (alloc.post()) m.close(); } })
    ]));
    body.appendChild(pc);
  }
}

/* ============================================================================
 * MANAGE SALARY — the month read out in full (owner 2026-07-29)
 * ----------------------------------------------------------------------------
 * The owner sent the reference app's salary form and asked for its SHAPE on top
 * of what we already have: the record header (month, dates, method, status,
 * gross, total deductions, total additions, bonus, adjustment, net), then
 * ATTENDANCE SUMMARY, DEDUCTION BREAKDOWN and OVERTIME ADDITION as their own
 * blocks. Every figure below already exists on the payslip or the attendance
 * record — nothing here computes a new number or invents a field. Where the
 * reference shows something this system does not record (clock minutes, a free
 * bonus label, a note), the tile says what we DO hold instead of guessing.
 *
 * These are READ-OUTS, not inputs: the month is edited where it always was, on
 * Adjust (correctionForm) while the run is a draft. Two places to type the same
 * figure is how the two drift apart.
 *
 * Net check: gross + additions − deductions === slipPayable(s), because
 * slipPayable is earnedGross (= gross − absent) + OT + bonus + tplBonus + adj
 * − tax − pf − other − late − early − fine. The tiles are that sum, split.
 * ==========================================================================*/
function factCard(title, sub, facts, note) {
  var c = frag('reg-card');
  slot(c, 'title').innerHTML = title;
  slot(c, 'sub').textContent = sub || '';
  var grid = el('div.emp-facts.sal-facts');
  facts.filter(Boolean).forEach(function (f) {
    grid.appendChild(el('div.emp-fact' + (f.tone ? '.is-' + f.tone : '') + (f.nil ? '.is-nil' : ''), null, [
      el('div.emp-fact-l', { text: f.l }),
      el('div.emp-fact-v', { text: f.v }),
      f.h ? el('div.sal-fact-h', { text: f.h }) : null
    ].filter(Boolean)));
  });
  slot(c, 'body').appendChild(grid);
  if (note) slot(c, 'body').appendChild(el('p.text-mute.xs.mt-2', { text: note }));
  return c;
}
// what the company takes back this month — the frozen figure once the month is
// approved, otherwise the plan. One engine call, so the payslip, the sheet and
// the net payable can never print three different deductions.
function advLineOf(s) { return advOf(s); }
function emiLineOf(s) { return emiOf(s); }
function dedTotalOf(s) {
  return (s.absentDeduction || 0) + (s.lateDeduction || 0) + (s.earlyDeduction || 0)
    + (s.tax || 0) + (s.pf || 0) + (s.otherDeduction || 0) + (s.fine || 0);
}
function addTotalOf(s) {
  return (s.overtime || 0) + (s.bonus || 0) + (s.tplBonus || 0) + (s.adjustment || 0);
}
function salaryRecordCard(e, s, ym, run, st) {
  var adj = s.adjustment || 0, bonus = (s.bonus || 0) + (s.tplBonus || 0);
  var pkg = s.pkgName || '';
  return factCard(ui.icon('card-list') + ' Salary record — ' + PR().mLabel(ym),
    'payslip ' + (s.slipNo || '—') + ' · the month as it stands on the books', [
      { l: 'Employee', v: e.name, h: [e.dept, e.designation].filter(Boolean).join(' · ') || '' },
      { l: 'Salary month', v: PR().mLabel(ym), h: 'run ' + cap(st) },
      { l: 'Salary generated', v: run && run.generatedAt ? ui.date(run.generatedAt) : '—', nil: !(run && run.generatedAt) },
      { l: 'Scheduled (pay by)', v: run && run.dueAfter ? ui.date(run.dueAfter) : '—', nil: !(run && run.dueAfter),
        h: run && run.correctionUntil ? 'corrections closed ' + ui.date(run.correctionUntil) : '' },
      { l: 'Payment method', v: s.payMethod || e.salaryMethod || 'Bank', h: s.paid > 0 ? 'last paid ' + ui.date(s.paidDate) : 'not paid yet' },
      { l: 'Payment status', v: cap(s.status || 'draft') },
      { l: 'Gross salary', v: ui.money(s.gross || 0), h: pkg ? 'package · ' + pkg : 'template rates' },
      { l: 'Total deductions', v: ui.money(dedTotalOf(s)), tone: 'ded', h: 'Absent + late + early + tax + PF + other + fine' },
      { l: 'Total additions', v: ui.money(addTotalOf(s)), tone: 'add', h: 'Auto: overtime + bonus + adjustment' },
      { l: 'Bonus', v: ui.money(bonus), nil: !bonus,
        h: s.tplBonus ? 'standing ' + ui.money(s.tplBonus) + (pkg ? ' · ' + pkg : '') + (s.bonus ? ' + this month ' + ui.money(s.bonus) : '') : (s.bonus ? 'this month' : 'none this month') },
      { l: 'Salary adjustment', v: (adj > 0 ? '+ ' : adj < 0 ? '− ' : '') + ui.money(Math.abs(adj)), nil: !adj,
        tone: adj > 0 ? 'add' : adj < 0 ? 'ded' : '', h: 'Can be positive or negative' },
      { l: 'Net salary', v: ui.money(PR().slipPayable(s)), tone: 'key', h: PR().amountInWords(PR().slipPayable(s)) }
    ]);
}
function attendanceCard(e, s, ym) {
  // the working-day divisor and the lates-per-absent rule are the SLIP'S
  // company's, which is also the only one that computed this month
  var att = PR().attendanceFor(s.empId, ym), t = PR().template(s.companyId || CID);
  var calDays = new Date(+ym.slice(0, 4), +ym.slice(5, 7), 0).getDate();
  var lpa = t.latesPerAbsent > 0 ? t.latesPerAbsent : 3;
  function d(n) { return (n || 0) + ' day' + ((n || 0) === 1 ? '' : 's'); }
  return factCard(ui.icon('calendar3') + ' Attendance summary — ' + PR().mLabel(ym),
    att ? 'from the month\'s attendance record' : 'no attendance record was entered for this month', [
      { l: 'Total days', v: String(calDays), h: 'calendar days' },
      { l: 'Payroll working days', v: String(t.workingDays || 30), h: 'the divisor a day is priced at' },
      { l: 'Present', v: att ? d(att.present) : '—', nil: !att },
      { l: 'Absent', v: d(s.leaveDeductDays), tone: s.leaveDeductDays ? 'ded' : '', nil: !s.leaveDeductDays },
      { l: 'Leave', v: att ? d(att.leave) : '—', nil: !att },
      { l: 'Late', v: String(s.lateDays || 0), tone: s.lateDays ? 'ded' : '', nil: !s.lateDays,
        h: s.lateDays ? 'counts as ' + (Math.round((s.lateDays / lpa) * 100) / 100) + ' day(s)' : '' },
      { l: 'Early out', v: String(s.earlyDays || 0), tone: s.earlyDays ? 'ded' : '', nil: !s.earlyDays },
      { l: 'Overtime', v: (s.overtimeHours || 0) + ' hr', tone: s.overtimeHours ? 'add' : '', nil: !s.overtimeHours },
      { l: 'Worked days (paid)', v: d(s.workedDays), h: 'working days − absent' }
    ],
    'Attendance is recorded in DAYS here — present, absent, late count, early-leave count, overtime hours. ' +
    'There is no clock-in/out anywhere in this system, so late MINUTES and worked HOURS cannot be shown. ' +
    'Every ' + lpa + ' lates deduct one day.');
}
function deductionCard(e, s) {
  var advL = advLineOf(s), emiL = emiLineOf(s), adj = s.adjustment || 0;
  return factCard(ui.icon('dash-circle') + ' Deduction breakdown',
    'what comes off the month — ' + ui.money(dedTotalOf(s)) + ' off the salary, ' + ui.money(advL + emiL) + ' off the cash', [
      { l: 'Absent deduction', v: ui.money(s.absentDeduction || 0), tone: 'ded', nil: !s.absentDeduction },
      { l: 'Late deduction', v: ui.money(s.lateDeduction || 0), tone: 'ded', nil: !s.lateDeduction },
      { l: 'Early-out deduction', v: ui.money(s.earlyDeduction || 0), tone: 'ded', nil: !s.earlyDeduction },
      { l: 'Income tax', v: ui.money(s.tax || 0), tone: 'ded', nil: !s.tax },
      { l: 'Provident fund', v: ui.money(s.pf || 0), tone: 'ded', nil: !s.pf },
      { l: 'Other deduction', v: ui.money(s.otherDeduction || 0), tone: 'ded', nil: !s.otherDeduction },
      { l: 'Fine / punishment', v: ui.money(s.fine || 0), tone: 'ded', nil: !s.fine, h: s.fineNote || '' },
      adj < 0 ? { l: 'Negative adjustment', v: ui.money(Math.abs(adj)), tone: 'ded' } : null,
      { l: 'Advance recovered', v: ui.money(advL), nil: !advL, h: 'of ' + ui.money(PR().advanceOutstanding(s.empId)) + ' outstanding' },
      { l: 'Loan EMI', v: ui.money(emiL), nil: !emiL, h: 'of ' + ui.money(PR().loanOutstanding(s.empId)) + ' outstanding' }
    ],
    'Advance and loan EMI come back to the company out of the salary, so they reduce the CASH handed over — ' +
    'not the salary cost, and not the net payable. They are deliberately outside the ' + ui.money(dedTotalOf(s)) + ' above.');
}
function additionCard(e, s) {
  var otOff = e.otEligible === false;
  var adj = s.adjustment || 0;
  /* The rate is read back OUT of the slip (pay ÷ hours) rather than recomputed.
     A slip does not carry otRate — generate() copies the figures, not the rate —
     and recomputing it would quote today's package against a month that was
     finalized under the old one. Division is what this slip actually paid. */
  var otRate = (s.overtimeHours > 0 && s.overtime > 0) ? Math.round((s.overtime / s.overtimeHours) * 100) / 100 : 0;
  return factCard(ui.icon('plus-circle') + ' Overtime & additions',
    'what goes on top — ' + ui.money(addTotalOf(s)), [
      { l: 'Overtime hours', v: (s.overtimeHours || 0) + ' hr', nil: !s.overtimeHours },
      { l: 'Overtime rate', v: otRate ? ui.money(otRate) + ' / hr' : '—', nil: !otRate, h: otRate ? 'as paid on this slip' : '' },
      { l: 'Overtime pay', v: otOff ? 'Not eligible' : ui.money(s.overtime || 0), tone: otOff ? '' : 'add', nil: otOff || !s.overtime,
        h: otOff ? 'overtime is switched off for this employee' : (s.otOverride != null ? 'overridden by hand' : 'hours × rate') },
      { l: 'Standing bonus', v: ui.money(s.tplBonus || 0), tone: 'add', nil: !s.tplBonus, h: s.pkgName ? 'from ' + s.pkgName : '' },
      { l: 'Bonus this month', v: ui.money(s.bonus || 0), tone: 'add', nil: !s.bonus },
      adj > 0 ? { l: 'Positive adjustment', v: ui.money(adj), tone: 'add' } : null,
      { l: 'Leave encashment accrued', v: ui.money(s.encashAmt || 0), nil: !s.encashAmt,
        h: (s.encashDays ? (Math.round(s.encashDays * 100) / 100) + ' days · paid on settlement, not with the salary' : '') }
    ]);
}

/* ---- PRINT SHEET with column marks (legacy el()) ------------------------ */
function printSheetForm(slips, ym) {
  var COLS = [
    ['gross', 'Gross', function (s) { return s.gross; }],
    ['overtime', 'Overtime', function (s) { return s.overtime || 0; }],
    ['bonus', 'Bonus', function (s) { return bonusOf(s); }],
    ['encash', 'Leave Encashment', function (s) { return s.encashAmt || 0; }],
    ['advance', 'Advance', advOf],
    ['emi', 'Loan EMI', emiOf],
    ['absent', 'Absent', function (s) { return s.absentDeduction || 0; }],
    ['other', 'Other Ded.', function (s) { return otherOf(s); }],
    ['net', 'Net Payable', function (s) { return PR().slipPayable(s); }],
    ['paid', 'Paid', paidOf],
    ['due', 'Due', dueOf],
    ['status', 'Status', function (s) { return cap(s.status || ''); }]
  ];
  var record = {}; COLS.forEach(function (c) { record['col_' + c[0]] = true; });
  EPAL.formModal({
    title: 'Print Salary Sheet — ' + PR().mLabel(ym), icon: 'printer', size: 'md', record: record,
    fields: [{ type: 'section', label: 'Tick the columns to print' }].concat(COLS.map(function (c) {
      return { key: 'col_' + c[0], label: c[1], type: 'checkbox', default: true };
    })),
    saveLabel: 'Print',
    onSave: function (v) {
      var chosen = COLS.filter(function (c) { return v['col_' + c[0]] !== false; });
      if (!chosen.length) { ui.toast('Tick at least one column', 'error'); return false; }
      // on All Companies the sheet mixes six payrolls, so the printed row has to
      // say whose employee it is
      var co = isAll();
      var head2 = '<tr><th>Employee</th>' + (co ? '<th>Company</th>' : '') + chosen.map(function (c) { return '<th style="text-align:right">' + esc(c[1]) + '</th>'; }).join('') + '</tr>';
      var totals = {};
      var rows = slips.map(function (s) {
        return '<tr><td>' + esc(s.empName) + '</td>' + (co ? '<td>' + esc(coShort(s.companyId)) + '</td>' : '') + chosen.map(function (c) {
          var val = c[2](s);
          if (typeof val === 'number') { totals[c[0]] = (totals[c[0]] || 0) + val; return '<td style="text-align:right">' + ui.money(val) + '</td>'; }
          return '<td style="text-align:right">' + esc(String(val)) + '</td>';
        }).join('') + '</tr>';
      }).join('');
      var totRow = '<tr><th>Total</th>' + (co ? '<th></th>' : '') + chosen.map(function (c) { return '<th style="text-align:right">' + (totals[c[0]] != null ? ui.money(totals[c[0]]) : '') + '</th>'; }).join('') + '</tr>';
      ui.printDoc({ title: 'Salary Sheet — ' + PR().mLabel(ym), subtitle: scopeShort() + ' · Payroll', meta: slips.length + ' employees · generated ' + ui.date(today()), footer: 'System-generated salary sheet — Confidential',
        bodyHtml: '<table>' + head2 + rows + totRow + '</table>' });
      return true;
    }
  });
}
EPAL.payrollEdit = function (empId, ym) {
  var s = PR().slip(empId, ym);
  if (!s) { ui.toast('No payslip for that month', 'error'); return; }
  CID = s.companyId;
  correctionForm(s, ym);
};

function correctionForm(s, ym) {
  var payableNow = PR().slipPayable(s);
  var pre = {
    absentAmt: s.absentDeduction || 0, lateAmt: s.lateDeduction || 0,
    earlyAmt: s.earlyDeduction || 0, otAmt: s.overtime || 0,
    advCap: (s.advCap != null && s.advCap !== '') ? +s.advCap : Math.min(PR().advanceOutstanding(s.empId), Math.max(0, payableNow)),
    emiCap: (s.emiCap != null && s.emiCap !== '') ? +s.emiCap : PR().emiInstallment(s.empId)
  };
  EPAL.formModal({ title: 'Edit Salary — ' + s.empName + ' · ' + PR().mLabel(ym), icon: 'sliders', size: 'md',
    record: { leaveDeductDays: s.leaveDeductDays || 0, lateDays: s.lateDays || 0, earlyDays: s.earlyDays || 0, overtimeHours: s.overtimeHours || 0,
      absentAmt: pre.absentAmt, lateAmt: pre.lateAmt, earlyAmt: pre.earlyAmt, otAmt: pre.otAmt,
      advCap: pre.advCap, emiCap: pre.emiCap,
      otherDeduction: s.otherDeduction || 0, bonus: s.bonus || 0, adjustment: s.adjustment || 0,
      fineExtra: s.fineExtra || 0, fineNote: (s.fineExtra > 0 ? (s.fineExtraNote || '') : '') },
    fields: [
      { type: 'section', label: 'Attendance counts (drive the automatic amounts)' },
      { key: 'leaveDeductDays', label: 'Absent days', type: 'number', min: 0, max: 30, default: 0 },
      { key: 'lateDays', label: 'Late count', type: 'number', min: 0, default: 0, hint: 'Every ' + (PR().template(s.companyId || CID).latesPerAbsent || 3) + ' lates = one day.' },
      { key: 'earlyDays', label: 'Early-leave count', type: 'number', min: 0, default: 0 },
      { key: 'overtimeHours', label: 'Overtime hours', type: 'number', min: 0, default: 0 },
      { type: 'section', label: 'Amounts (৳) — automatic; change any figure to override it' },
      { key: 'absentAmt', label: 'Absent deduction (৳)', type: 'money', min: 0, hint: s.absentOverride != null ? 'Currently overridden.' : 'Auto from absent days — edit to override.' },
      { key: 'lateAmt', label: 'Late deduction (৳)', type: 'money', min: 0, hint: s.lateOverride != null ? 'Currently overridden.' : 'Auto from late count.' },
      { key: 'earlyAmt', label: 'Early-leave deduction (৳)', type: 'money', min: 0 },
      { key: 'otAmt', label: 'Overtime pay (৳)', type: 'money', min: 0, hint: s.otOverride != null ? 'Currently overridden.' : 'Auto from OT hours × rate.' },
      { key: 'otherDeduction', label: 'Other deduction (৳)', type: 'money', min: 0, default: 0 },
      { key: 'bonus', label: 'Bonus (৳)', type: 'money', min: 0, default: 0 },
      { key: 'adjustment', label: 'Salary adjustment (± ৳)', type: 'number', default: 0, hint: 'Signed: positive adds, negative deducts.' },
      { key: 'fineExtra', label: 'Punishment this month (৳)', type: 'money', min: 0, default: 0,
        hint: (s.fine - (s.fineExtra || 0)) > 0
          ? 'A standing fine of ' + ui.money(s.fine - (s.fineExtra || 0)) + ' also applies from the salary template — take that off on the Salary Template tab.'
          : 'A one-off disciplinary deduction, printed on the payslip with its reason.' },
      { key: 'fineNote', label: 'Punishment reason', hint: 'Shown beside the deduction on the payslip.' },
      { type: 'section', label: 'Agreed pay-time deductions (auto — change what the company takes this month)' },
      { key: 'advCap', label: 'Advance to recover this month (৳)', type: 'money', min: 0, hint: 'Outstanding advance ' + ui.money(PR().advanceOutstanding(s.empId)) + ' — auto takes what fits.' },
      { key: 'emiCap', label: 'Loan EMI this month (৳)', type: 'money', min: 0, hint: 'Scheduled EMI ' + ui.money(PR().emiInstallment(s.empId)) + ' — edit what the company agrees to deduct.' }
    ],
    saveLabel: 'Apply',
    onSave: function (v) {
      function pick(entered, prefill, existingOvr) { return (+entered === +prefill) ? (existingOvr != null ? existingOvr : null) : +entered; }
      try {
        PR().adjustSlip(s.empId, ym, {
          leaveDeductDays: +v.leaveDeductDays, lateDays: +v.lateDays, earlyDays: +v.earlyDays, overtimeHours: +v.overtimeHours,
          absentOverride: pick(v.absentAmt, pre.absentAmt, s.absentOverride),
          lateOverride: pick(v.lateAmt, pre.lateAmt, s.lateOverride),
          earlyOverride: pick(v.earlyAmt, pre.earlyAmt, s.earlyOverride),
          otOverride: pick(v.otAmt, pre.otAmt, s.otOverride),
          advCap: pick(v.advCap, pre.advCap, s.advCap),
          emiCap: pick(v.emiCap, pre.emiCap, s.emiCap),
          otherDeduction: +v.otherDeduction, bonus: +v.bonus, adjustment: +v.adjustment,
          fineExtra: Math.max(0, +v.fineExtra || 0), fineNote: String(v.fineNote || '').trim()
        });
        ui.toast('Salary updated', 'success'); EPAL.router.render(); return true;
      } catch (e) { ui.toast(e.message || 'Blocked', 'error'); return false; }
    } });
}

/* ============================================================ LOAN MANAGEMENT
 * WHAT A LOAN ROW HAS TO SAY (owner 2026-07-29): "Mr X took ৳20,000, taken May
 * 2026, ৳6,000 paid, ৳14,000 still due, recovered from salary / in cash." Every
 * loan row on this screen — the status list, the register, the EMI history and
 * the transaction trail — now carries those four figures, because a row that
 * only says "outstanding ৳14,000" makes you go and reconstruct the rest by hand.
 *
 * The figures come from `EPAL.payroll.loanBook(empId)`, which rebuilds the
 * per-loan book from the movements (repayments applied oldest loan first). It
 * is a read: Σ due across the book IS loanOutstanding(), so nothing on this tab
 * can disagree with the tiles above it.
 * ==========================================================================*/

/* every loan on this payroll, newest first, each carrying its employee */
function loanRows() {
  var out = [];
  team().forEach(function (e) {
    (PR().loanBook ? PR().loanBook(e.id) : []).forEach(function (L) { L.emp = e; out.push(L); });
  });
  return out.sort(function (a, b) { return a.date === b.date ? (a.id < b.id ? 1 : -1) : (a.date < b.date ? 1 : -1); });
}
/* txnId → [{ L, p }] : which loan(s) a repayment went against, and the balance
 * that loan was left on right after it. A single payment can finish one loan
 * and start eating the next, so it is a list. */
function loanPayIndex(rows) {
  var ix = {};
  rows.forEach(function (L) {
    L.payments.forEach(function (p) { (ix[p.txnId] || (ix[p.txnId] = [])).push({ L: L, p: p }); });
  });
  return ix;
}
/* a stored 'bank:41' is an account id, not a sentence — name the account */
function methodLabel(v) {
  v = String(v || '');
  if (v.indexOf('bank:') === 0 && EPAL.pay && EPAL.pay.byId) {
    var b = EPAL.pay.byId(v.slice(5));
    if (b) return b.name + (b.branch && b.branch !== '—' ? ' · ' + b.branch : '');
  }
  return (v.indexOf('m:') === 0 ? v.slice(2) : v) || '—';
}
/* HOW the money came back — the part a total can never show */
function repaidViaHtml(L) {
  if (!(L.paid > 0)) return '<span class="text-mute">nothing repaid yet</span>';
  var bits = [];
  if (L.viaSalary > 0) bits.push('<span class="badge badge-info">Salary deduction</span> <span class="num">' + ui.money(L.viaSalary) + '</span>');
  if (L.viaCash > 0) bits.push('<span class="badge">Cash / bank</span> <span class="num">' + ui.money(L.viaCash) + '</span>');
  return bits.join('<br>');
}
function repaidViaText(L) {
  if (!(L.paid > 0)) return 'nothing repaid yet';
  var bits = [];
  if (L.viaSalary > 0) bits.push('salary deduction ' + ui.money(L.viaSalary));
  if (L.viaCash > 0) bits.push('cash / bank ' + ui.money(L.viaCash));
  return bits.join(' · ');
}
function loanStatusHtml(L) {
  return L.closed
    ? '<span class="badge badge-good">Cleared</span><div class="text-mute xs">' + esc(ui.date(L.closedOn)) + '</div>'
    : '<span class="badge badge-warn">Running</span>' +
      (L.emi ? '<div class="text-mute xs num">' + ui.money(L.emi) + '/mo · ' + Math.ceil(L.due / L.emi) + ' left</div>'
             : '<div class="text-mute xs">no EMI plan</div>');
}
function loanPct(L) { return L.principal ? Math.min(100, Math.round(L.paid / L.principal * 100)) : 0; }
/* the loan a transaction row touches — the same four figures, on the trail */
function loanRefHtml(hits) {
  if (!hits || !hits.length) return '<span class="text-mute">—</span>';
  return hits.map(function (h) {
    return '<div><span class="num">' + ui.money(h.L.principal) + '</span> <span class="text-mute xs">taken ' + esc(ui.date(h.L.date)) + '</span></div>';
  }).join('');
}
function loanPaidHtml(hits) {
  if (!hits || !hits.length) return '<span class="text-mute">—</span>';
  return hits.map(function (h) {
    var paid = h.p ? (h.L.principal - h.p.balance) : h.L.paid;
    return '<div class="num text-good">' + ui.money(paid) + '</div>';
  }).join('');
}
function loanDueHtml(hits) {
  if (!hits || !hits.length) return '<span class="text-mute">—</span>';
  return hits.map(function (h) {
    var due = h.p ? h.p.balance : h.L.due;
    return '<div class="num ' + (due > 0 ? 'text-warn' : 'text-good') + '">' + ui.money(due) + '</div>';
  }).join('');
}
function lstat(label, value, tone) {
  return el('div.stat', null, [ el('div.stat-label', { text: label }),
    el('div.stat-value' + (tone ? '.' + tone : ''), { text: value }) ]);
}

/* ONE LOAN — the whole life of it: what was taken, what has come back, out of
 * what, and what is still owed. Reached from any loan row on the tab. */
function loanDetailModal(L) {
  var body = el('div');
  var left = (L.emi > 0 && L.due > 0) ? Math.ceil(L.due / L.emi) : 0;
  body.appendChild(el('div.card', null, [el('div.card-body', null, [
    el('div.flex.items-center.gap-2.flex-wrap.mb-2', null, [
      el('div.flex-1', null, [
        el('div.fw-700', { html: EPAL.people ? EPAL.people.linkify(L.empName, L.empId) : esc(L.empName) }),
        el('div.text-mute.sm', { text: ui.money(L.principal) + ' taken on ' + ui.date(L.date) + (L.memo ? ' · ' + L.memo : '') })
      ]),
      ui.frag(loanStatusHtml(L))
    ]),
    // five stats, not six: the row lays out five to a line, and "taken on" is
    // already the first thing the header line says
    el('div.stat-row.mb-3', null, [
      lstat('Loan taken', ui.money(L.principal)),
      lstat('Paid so far', ui.money(L.paid), 'text-good'),
      lstat('Still due', ui.money(L.due), L.due > 0 ? 'text-warn' : 'text-good'),
      lstat('Monthly EMI', L.emi ? ui.money(L.emi) : '—'),
      lstat('Instalments left', left ? String(left) : (L.due > 0 ? 'no plan' : '—'))
    ]),
    el('div.data-list', null, [
      drow('Disbursed from', methodLabel(L.method)),
      drow('Repayment plan', L.emiMonths
        ? L.emiMonths + ' months · ' + ui.money(L.emi) + ' deducted from every salary'
        : 'None — it comes back only when a repayment is recorded by hand'),
      drow('Recovered from salary', ui.money(L.viaSalary)),
      drow('Repaid in cash / bank', ui.money(L.viaCash)),
      drow('Repaid so far', loanPct(L) + '% of the loan'),
      drow('Last payment', L.lastPaidOn ? ui.date(L.lastPaidOn) : 'none yet'),
      drow(L.closed ? 'Cleared on' : 'Status', L.closed ? ui.date(L.closedOn) : 'Running · ' + ui.money(L.due) + ' still due')
    ])
  ])]));

  body.appendChild(el('div.card.mt-3', null, [
    el('div.card-head', null, [ el('h3', { html: ui.icon('clock-history') + ' Every payment against this loan' }),
      el('span.card-sub', { text: L.payments.length + ' payment(s) · newest first' }) ]),
    el('div.card-body', null, [ EPAL.table({
      columns: [
        { key: 'date', label: 'Paid on', date: true },
        { key: 'kind', label: 'How', render: function (p) {
          return p.kind === 'salary' ? '<span class="badge badge-info">Salary deduction</span>'
            : p.kind === 'settlement' ? '<span class="badge badge-bad">Final settlement</span>'
            : '<span class="badge">Cash / bank</span>' + (p.method ? ' <span class="text-mute xs">' + esc(methodLabel(p.method)) + '</span>' : ''); },
          exportVal: function (p) { return p.kind; } },
        { key: 'memo', label: 'Note', render: function (p) { return esc(p.memo || '—'); } },
        { key: 'amount', label: 'Paid', num: true, money: true },
        { key: 'balance', label: 'Due after this', num: true, render: function (p) {
          return '<span class="num ' + (p.balance > 0 ? 'text-warn' : 'text-good') + '">' + ui.money(p.balance) + '</span>'; },
          sortVal: function (p) { return p.balance; } }
      ],
      rows: L.payments, pageSize: 8, totalKey: 'amount', exportName: 'loan-payments-' + L.empId + '.csv',
      pdfTitle: 'Loan payments — ' + L.empName,
      /* THE FOOT: "paid" sums, and "due after this" shows the CLOSING balance — the
       * last row's, which is where the loan actually stands. Adding a running
       * balance column together is the classic wrong total (see the encashment
       * column on the Monthly Register). */
      totals: function (ps) {
        if (!ps.length) return null;
        var last = ps.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; })[ps.length - 1];
        return { label: ps.length + (ps.length === 1 ? ' payment' : ' payments'), values: {
          amount: ui.money(sum(ps, function (p) { return +p.amount || 0; })),
          balance: '<span class="num">' + ui.money(last.balance) + '</span>' +
            '<div class="xs text-mute nowrap">closing balance</div>'
        } };
      },
      empty: { icon: 'hourglass-split', title: 'Nothing repaid yet', hint: L.emi ? 'The next payroll run deducts ' + ui.money(L.emi) + '.' : 'No EMI plan — record a repayment when the money comes in.' }
    }).el ])
  ]));

  var acts = [{ label: 'Print', icon: 'printer', onClick: function () { printLoan(L); return false; } }];
  if (canCreate() && L.due > 0) acts.push({ label: 'Record repayment', icon: 'arrow-return-left', variant: 'primary',
    onClick: function () { moneyForm(L.emp || empById(L.empId), 'loan-repay'); return true; } });
  acts.push({ label: 'Close' });
  ui.modal({ title: 'Staff loan · ' + L.empName, icon: 'bank', size: 'lg', body: body, actions: acts });
}

function printLoan(L) {
  var head = '<tr><th>Paid on</th><th>How</th><th>Note</th><th style="text-align:right">Paid</th><th style="text-align:right">Due after</th></tr>';
  var rows = L.payments.slice().reverse().map(function (p) {
    return '<tr><td>' + esc(ui.date(p.date)) + '</td><td>' +
      esc(p.kind === 'salary' ? 'Salary deduction' : p.kind === 'settlement' ? 'Final settlement' : 'Cash / bank · ' + methodLabel(p.method)) +
      '</td><td>' + esc(p.memo || '') + '</td><td style="text-align:right">' + ui.money(p.amount) +
      '</td><td style="text-align:right">' + ui.money(p.balance) + '</td></tr>';
  }).join('');
  var facts = '<table>' +
    '<tr><th>Loan taken</th><td style="text-align:right">' + ui.money(L.principal) + '</td></tr>' +
    '<tr><th>Taken on</th><td style="text-align:right">' + esc(ui.date(L.date)) + '</td></tr>' +
    '<tr><th>Paid so far</th><td style="text-align:right">' + ui.money(L.paid) + '</td></tr>' +
    '<tr><th>Still due</th><td style="text-align:right">' + ui.money(L.due) + '</td></tr>' +
    '<tr><th>Repaid via</th><td style="text-align:right">' + esc(repaidViaText(L)) + '</td></tr>' +
    '<tr><th>Monthly EMI</th><td style="text-align:right">' + (L.emi ? ui.money(L.emi) + ' · ' + L.emiMonths + ' months' : 'no plan') + '</td></tr>' +
    '</table>';
  ui.printDoc({
    title: 'Staff Loan Statement — ' + L.empName,
    subtitle: coFull(L.companyId || (L.emp && L.emp.companyId) || CID) + ' · Payroll · loan taken ' + ui.date(L.date),
    meta: L.payments.length + ' payment(s) · generated ' + ui.date(today()),
    footer: 'System-generated staff loan statement — Confidential',
    bodyHtml: facts + '<table>' + head + rows + '</table>'
  });
}

function loansView(page) {
  var t = team();
  var book = loanRows(), payIx = loanPayIndex(book);
  var byEmp = t.map(function (e) {
    var mine = book.filter(function (L) { return L.empId === e.id; });
    var back = sum(mine, function (L) { return L.paid; });
    return { e: e, companyId: e.companyId, out: PR().loanOutstanding(e.id), loans: mine,
      taken: sum(mine, function (L) { return L.principal; }),
      // `paid` as well as `back`, so the shared repaidVia* helpers read a person
      // and a loan with the same two fields
      back: back, paid: back,
      viaSalary: sum(mine, function (L) { return L.viaSalary; }),
      viaCash: sum(mine, function (L) { return L.viaCash; }),
      last: mine.length ? mine[0].date : '' };
  });
  var txns = scoped('pay_txns').filter(function (x) { return x.type === 'loan' || x.type === 'loan-repay'; }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
  var totalOut = sum(byEmp, function (x) { return x.out; });
  var active = byEmp.filter(function (x) { return x.out > 0; });

  /* The four tiles and their sparklines are built from ONE event list, so a tile
   * can never disagree with the line under it.
   * ⚠ `disbursed` now sums that list (team basis, the same basis as totalOut and
   * therefore as "Repaid = disbursed − totalOut") instead of the companyId-filtered
   * `txns` it used before. Those two filters agree whenever the engine has stamped
   * companyId — it always does — but mixing bases inside one subtraction was a
   * latent wrong-number waiting for the first row that lacked it. */
  var LE = loanEvents(), N = 12;
  var disbursed = sum(outflowOnly(LE), function (e) { return e.delta; });
  var emiTotal = sum(t, function (e) { return PR().emiInstallment(e.id); });

  if (isAll()) page.appendChild(scopeNote('Every staff loan in the group — ' + scopeNames(),
    'One book across ' + scopeCids().length + ' payrolls: who holds a loan, what was taken, what has been paid back, what is still due, and every loan transaction of every company. Disbursing and recording a repayment work from here — the loan is booked against the employee\'s own company, which is also whose account the money moves through.'));
  var grid = frag('kpi-grid');
  grid.appendChild(kpi2({ label: 'Loan Outstanding', value: ui.money(totalOut, { compact: true }), icon: 'bank', tone: 'text-warn',
    foot: active.length ? active.length + ' of ' + t.length + ' staff carrying a loan' : 'nobody is carrying a loan',
    series: balanceSeries(LE, N), goodDown: true }));
  grid.appendChild(kpi2({ label: 'Total Disbursed', value: ui.money(disbursed, { compact: true }), icon: 'cash-stack',
    foot: outflowOnly(LE).length + ' loan(s), all time',
    series: balanceSeries(outflowOnly(LE), N) }));
  grid.appendChild(kpi2({ label: 'Active Loans', value: String(active.length), icon: 'people',
    foot: emiTotal ? ui.money(emiTotal) + '/mo scheduled EMI' : 'no repayment schedule set',
    series: headSeries(LE, N), goodDown: true }));
  grid.appendChild(kpi2({ label: 'Repaid', value: ui.money(disbursed - totalOut, { compact: true }), icon: 'check2-circle', tone: 'text-good',
    foot: disbursed > 0 ? Math.round((disbursed - totalOut) / disbursed * 100) + '% of everything lent' : 'nothing lent yet',
    series: balanceSeries(inflowOnly(LE), N) }));
  page.appendChild(grid);
  if (canCreate()) { var br = frag('btn-row'); var bb = slot(br, 'btn'); bb.innerHTML = ui.icon('bank') + ' Disburse Loan'; bb.addEventListener('click', function () { moneyForm(null, 'loan'); }); page.appendChild(br); }

  if (active.length) {
    var lt = EPAL.table({
      columns: withCo([
        { key: 'name', label: 'Employee', sortVal: function (r) { return r.e.name; }, exportVal: function (r) { return r.e.name; },
          render: function (r) { return '<span class="strong">' + esc(r.e.name) + '</span>' +
            '<div class="text-mute xs">' + r.loans.length + ' loan' + (r.loans.length === 1 ? '' : 's') +
            (r.last ? ' · latest ' + esc(ui.date(r.last)) : '') + '</div>'; } },
        { key: 'taken', label: 'Loan taken', num: true, money: true, sortVal: function (r) { return r.taken; } },
        { key: 'back', label: 'Paid so far', num: true, sortVal: function (r) { return r.back; }, exportVal: function (r) { return r.back; },
          render: function (r) { return '<span class="num text-good">' + ui.money(r.back) + '</span>' +
            '<div class="text-mute xs">' + (r.taken ? Math.round(r.back / r.taken * 100) : 0) + '% of what was lent</div>'; } },
        { key: 'out', label: 'Still due', num: true, sortVal: function (r) { return r.out; }, exportVal: function (r) { return r.out; },
          render: function (r) { return '<span class="num strong text-warn">' + ui.money(r.out) + '</span>'; } },
        { key: 'via', label: 'Repaid via', sort: false, exportVal: function (r) { return repaidViaText(r); },
          render: function (r) { return repaidViaHtml(r); } },
        { key: 'emi', label: 'Monthly EMI', num: true, sortVal: function (r) { return PR().emiInstallment(r.e.id); },
          exportVal: function (r) { return PR().emiInstallment(r.e.id); },
          render: function (r) { var m = PR().emiInstallment(r.e.id);
            return m ? '<span class="num">' + ui.money(m) + '</span>' : '<span class="text-mute">no EMI plan</span>'; } }
      ]),
      rows: active, pageSize: 8, onRow: function (r) { moneyForm(r.e, 'loan-repay'); },
      // the filter panel appears only when there is something to filter BY —
      // a company. Search is untouched (the table always has it).
      filters: coFilter(), filterPanel: isAll(),
      exportName: 'staff-loans.csv', pdfTitle: 'Staff loans outstanding' + (isAll() ? ' — ' + scopeFull() : ''),
      /* THE FOOT. "Repaid via" is the one column a single figure cannot carry, so
       * it foots as the SPLIT — how much of the money came back out of salary and
       * how much was handed in — which is the whole reason the column exists. */
      totals: function (rs) {
        if (!rs.length) return null;
        function S(f) { return sum(rs, f); }
        return { label: rs.length + (rs.length === 1 ? ' person' : ' people'), values: {
          taken: ui.money(S(function (r) { return r.taken; })),
          back: ui.money(S(function (r) { return r.back; })),
          out: ui.money(S(function (r) { return r.out; })),
          via: '<span class="xs text-mute">salary ' + ui.money(S(function (r) { return r.viaSalary; })) +
            ' · cash ' + ui.money(S(function (r) { return r.viaCash; })) + '</span>',
          emi: ui.money(S(function (r) { return PR().emiInstallment(r.e.id); }))
        } };
      },
      actions: ui.actions({ edit: canCreate() ? function (r) { moneyForm(r.e, 'loan-repay'); } : null }), empty: { icon: 'bank', title: 'No active loans' }
    });
    var lc = frag('reg-card'); slot(lc, 'title').innerHTML = ui.icon('people') + ' Employees with loans';
    slot(lc, 'sub').textContent = 'taken · paid · still due, per person' + (isAll() ? ', across every company' : '') + ' · click to record a repayment';
    slot(lc, 'body').appendChild(lt.el); page.appendChild(lc);
  }

  /* THE REGISTER — one row per loan, running and cleared, because "how much of
   * the ৳20,000 taken in May is left" is a question about a LOAN, not a person. */
  if (book.length) {
    var rt = EPAL.table({
      columns: withCo([
        { key: 'empName', label: 'Employee', sortVal: function (L) { return L.empName; },
          render: function (L) { return '<span class="strong">' + esc(L.empName) + '</span>' +
            (L.memo && L.memo !== 'Staff loan' ? '<div class="text-mute xs">' + esc(L.memo) + '</div>' : ''); } },
        { key: 'date', label: 'Taken on', date: true, render: function (L) {
          return esc(ui.date(L.date)) + '<div class="text-mute xs">' +
            (L.emiMonths ? L.emiMonths + '-month EMI plan' : 'no EMI plan') + '</div>'; } },
        { key: 'principal', label: 'Loan taken', num: true, money: true },
        { key: 'paid', label: 'Paid till now', num: true, sortVal: function (L) { return L.paid; }, exportVal: function (L) { return L.paid; },
          render: function (L) { return '<span class="num text-good">' + ui.money(L.paid) + '</span>' +
            '<div class="text-mute xs">' + loanPct(L) + '%' + (L.lastPaidOn ? ' · last ' + esc(ui.date(L.lastPaidOn)) : '') + '</div>'; } },
        { key: 'due', label: 'Still due', num: true, sortVal: function (L) { return L.due; }, exportVal: function (L) { return L.due; },
          render: function (L) { return '<span class="num strong ' + (L.due > 0 ? 'text-warn' : 'text-good') + '">' + ui.money(L.due) + '</span>'; } },
        { key: 'via', label: 'Repaid via', sort: false, exportVal: repaidViaText, render: repaidViaHtml },
        { key: 'status', label: 'Status', sort: false, exportVal: function (L) { return L.closed ? 'Cleared' : 'Running'; },
          render: loanStatusHtml }
      ]),
      rows: book, pageSize: 8, searchKeys: ['empName', 'empId', 'memo'], sortKey: 'date', sortDir: -1,
      filters: coFilter(), filterPanel: isAll(),
      exportName: 'loan-register.csv', pdfTitle: 'Staff Loan Register — ' + scopeFull(),
      /* PRINT — the LOAN BOOK, as at today. The register IS the book, so its own
       * toolbar is where the document belongs. */
      toolbarEl: el('button.btn.btn-sm.btn-ghost', { html: ui.icon('printer') + ' Print',
        title: 'Print the loan book — every loan, only the running ones, or only those with no EMI plan',
        onclick: function () { loanPrintCentre(book); } }),
      /* THE FOOT: the three money columns sum; STATUS counts instead, because
       * "running or cleared" has no total — and a book whose foot says how many of
       * its loans are still alive is answering the question the total raises. */
      totals: function (ls) {
        if (!ls.length) return null;
        function S(f) { return sum(ls, f); }
        var open = ls.filter(function (L) { return !L.closed; }).length;
        return { label: ls.length + (ls.length === 1 ? ' loan' : ' loans'), values: {
          principal: ui.money(S(function (L) { return L.principal; })),
          paid: ui.money(S(function (L) { return L.paid; })),
          due: ui.money(S(function (L) { return L.due; })),
          via: '<span class="xs text-mute">salary ' + ui.money(S(function (L) { return L.viaSalary; })) +
            ' · cash ' + ui.money(S(function (L) { return L.viaCash; })) + '</span>',
          status: '<span class="xs text-mute">' + open + ' running · ' + (ls.length - open) + ' cleared</span>'
        } };
      },
      onRow: function (L) { loanDetailModal(L); },
      actions: [{ icon: 'eye', title: 'Open this loan', onClick: function (L) { loanDetailModal(L); } }],
      empty: { icon: 'bank', title: 'No loan has been disbursed yet' }
    });
    var rc = frag('reg-card');
    slot(rc, 'title').innerHTML = ui.icon('journal-bookmark') + ' Loan register';
    slot(rc, 'sub').textContent = 'every loan ever taken' + (isAll() ? ', in every company' : '') + ' — taken on · taken · paid till now · still due · click one for its whole history';
    slot(rc, 'body').appendChild(rt.el); page.appendChild(rc);
  }

  var emis = txns.filter(function (x) { return x.type === 'loan-repay' && /EMI auto-deducted/.test(x.memo || ''); });
  if (emis.length) {
    var et = EPAL.table({
      columns: withCo([
        { key: 'date', label: 'Deducted on', date: true },
        { key: 'empName', label: 'Employee', render: function (x) { return EPAL.people ? EPAL.people.linkify(x.empName, x.empId) : esc(x.empName); } },
        { key: 'memo', label: 'From which salary', render: function (x) { return esc(String(x.memo || '').replace('EMI auto-deducted from ', '')); } },
        // WHICH loan this instalment paid down, and where that loan stood after
        // it — an EMI row that only says "৳10,500" tells you nothing about the
        // debt it belongs to.
        { key: 'loan', label: 'Against loan', sort: false,
          exportVal: function (x) { return (payIx[x.id] || []).map(function (h) { return ui.money(h.L.principal) + ' taken ' + ui.date(h.L.date); }).join(' + '); },
          render: function (x) { return loanRefHtml(payIx[x.id]); } },
        { key: 'amount', label: 'EMI deducted', num: true, money: true },
        { key: 'after', label: 'Loan due after', sort: false,
          exportVal: function (x) { return (payIx[x.id] || []).map(function (h) { return h.p.balance; }).join(' + '); },
          render: function (x) { return loanDueHtml(payIx[x.id]); } }
      ], null, 2),
      rows: emis, pageSize: 8, totalKey: 'amount', exportName: 'emi-history.csv',
      filters: coFilter(), filterPanel: isAll(),
      /* THE FOOT: the EMI column sums, and "loan due after" deliberately does not
       * — it is a per-loan BALANCE at a moment in time, and adding fifteen of them
       * together would produce a figure that never existed. */
      totals: function (xs) {
        if (!xs.length) return null;
        return { label: xs.length + (xs.length === 1 ? ' deduction' : ' deductions'), values: {
          amount: ui.money(sum(xs, function (x) { return +x.amount || 0; })),
          after: '<span class="xs text-mute">a balance, not a sum</span>'
        } };
      },
      pdfTitle: 'Loan EMI Deduction History' + (isAll() ? ' — ' + scopeFull() : ''),
      onRow: function (x) { var h = (payIx[x.id] || [])[0]; if (h) loanDetailModal(h.L); },
      empty: { icon: 'bank', title: 'No EMI deductions yet' }
    });
    var ec = frag('reg-card'); slot(ec, 'title').innerHTML = ui.icon('calendar2-check') + ' EMI Deduction History';
    slot(ec, 'sub').textContent = 'auto-deducted from salary · dated individually' + (isAll() ? ' · every company' : '') + ' · click a row for that loan';
    slot(ec, 'body').appendChild(et.el); page.appendChild(ec);
  }
  page.appendChild(loanTxnTable(txns, book, payIx));
}

/* =================================================== ADVANCE SALARY */
function advanceView(page) {
  var t = team();
  var byEmp = t.map(function (e) { return { e: e, companyId: e.companyId, out: PR().advanceOutstanding(e.id) }; });
  var txns = scoped('pay_txns').filter(function (x) { return x.type === 'advance'; }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
  var totalOut = sum(byEmp, function (x) { return x.out; });
  var active = byEmp.filter(function (x) { return x.out > 0; });

  // same single-event-list rule as Loan Management above — see the note there
  var AE = advanceEvents(), N = 12;
  var given = sum(outflowOnly(AE), function (e) { return e.delta; });

  if (isAll()) page.appendChild(scopeNote('Every advance in the group — ' + scopeNames(),
    'Who is holding an advance across all ' + scopeCids().length + ' payrolls, what has been recovered, and every advance transaction and request. Giving and approving work from here — the money leaves the employee\'s own company\'s account.'));
  var grid = frag('kpi-grid');
  grid.appendChild(kpi2({ label: 'Advance Outstanding', value: ui.money(totalOut, { compact: true }), icon: 'cash', tone: 'text-warn',
    foot: totalOut ? 'recovered automatically from the next payslip' : 'nothing left to recover',
    series: balanceSeries(AE, N), goodDown: true }));
  grid.appendChild(kpi2({ label: 'Total Given', value: ui.money(given, { compact: true }), icon: 'cash-stack',
    foot: outflowOnly(AE).length + ' advance(s), all time',
    series: balanceSeries(outflowOnly(AE), N) }));
  grid.appendChild(kpi2({ label: 'Recovered', value: ui.money(given - totalOut, { compact: true }), icon: 'check2-circle', tone: 'text-good',
    foot: given > 0 ? Math.round((given - totalOut) / given * 100) + '% of everything advanced' : 'nothing advanced yet',
    series: balanceSeries(inflowOnly(AE), N) }));
  grid.appendChild(kpi2({ label: 'Employees', value: String(active.length), icon: 'people',
    foot: 'of ' + t.length + ' on this payroll',
    series: headSeries(AE, N), goodDown: true }));
  page.appendChild(grid);

  /* THE DECISION QUEUE comes before everything else on this tab: it is the only
   * thing here that is waiting on a person. */
  advRequestQueue(page);

  if (canCreate()) {
    var br = frag('btn-row'); var bb = slot(br, 'btn');
    bb.innerHTML = ui.icon('cash') + ' Give Advance';
    bb.addEventListener('click', function () { moneyForm(null, 'advance'); });
    // raising a REQUEST is the normal route; giving one outright stays for the
    // case where the boss simply decides to, which is how this desk worked before
    var rq = el('button.btn.btn-outline.ml-1', { html: ui.icon('hand-index') + ' Request Advance',
      title: 'Raise a request for approval instead of paying it out now',
      onclick: function () { advRequestForm(); } });
    slot(br, 'btn').parentNode.appendChild(rq);
    page.appendChild(br);
  }

  advRequestHistory(page);

  if (active.length) {
    var at = EPAL.table({
      columns: withCo([ { key: 'name', label: 'Employee', render: function (r) { return '<span class="strong">' + esc(r.e.name) + '</span>'; } },
        { key: 'out', label: 'Outstanding', num: true, render: function (r) { return '<span class="num strong text-warn">' + ui.money(r.out) + '</span>'; }, sortVal: function (r) { return r.out; } } ]),
      rows: active, pageSize: 8, filters: coFilter(), filterPanel: isAll(), empty: { icon: 'cash', title: 'No outstanding advances' },
      /* THE FOOT — one money column, so one sum, and the count says how many
       * people are behind it. This card only exists when somebody is holding an
       * advance, so the foot is never a row of dashes. */
      totals: function (rs) {
        if (!rs.length) return null;
        return { label: rs.length + (rs.length === 1 ? ' person' : ' people'), values: {
          out: ui.money(sum(rs, function (r) { return r.out; }))
        } };
      },
      /* PRINT — the ADVANCE REGISTER, from the card that asks the register's own
       * question: who is holding what. It also rides the transactions table below,
       * because that card is here even when nothing is outstanding. */
      toolbarEl: el('button.btn.btn-sm.btn-ghost', { html: ui.icon('printer') + ' Print',
        title: 'Print the advance register — everyone who has ever taken one, or only those still holding',
        onclick: function () { advancePrintCentre(); } })
    });
    var ac = frag('reg-card'); slot(ac, 'title').innerHTML = ui.icon('people') + ' Outstanding advances';
    slot(ac, 'sub').textContent = 'recovered automatically from the next salary' + (isAll() ? ' · every company' : '');
    slot(ac, 'body').appendChild(at.el); page.appendChild(ac);
  }
  page.appendChild(txnTable('Advance transactions', txns));
}
/* ============================================================================
 * ADVANCE SALARY REQUESTS — the ask, and the decision on it
 * ----------------------------------------------------------------------------
 * Owner 2026-07-29. Before this, opening the Give Advance form WAS the decision:
 * whoever filled it in moved the money, and there was nothing to allow or
 * disallow. Now a request is a record, and approving it is what disburses.
 *
 * Three things the owner asked for, and where each one lives:
 *   "boss will allow or disallow"     → Approve / Decline on every waiting row
 *   "can customize the amount"        → Approve opens a form with the asked
 *                                       figure pre-filled and editable; the ask
 *                                       is kept, so the sheet shows both
 *   "for which month advanced"        → a badge on the row, a column in the
 *                                       history, and the memo on the posting
 * ==========================================================================*/
function advRequestQueue(page) {
  var pend = (PR().advRequests({ status: 'pending' }) || []).filter(function (r) { return inScope(r.companyId); });
  if (!pend.length) return;                 // nothing waiting → no card at all
  var card = shell('advreq');
  fillH(card, 'title', ui.icon('hourglass-split') + ' Advance requests waiting on you');
  fillK(card, 'sub', pend.length + ' pending · ' + ui.money(sum(pend, function (r) { return r.amount; })) + ' asked for' +
    (isAll() ? ' · across every company' : ''));
  var host = box(card, 'rows');
  var tpl = host.querySelector('[data-proto="row"]');
  tpl.parentNode.removeChild(tpl);          // the prototype itself never renders
  pend.forEach(function (r) {
    var row = tpl.cloneNode(true);
    row.removeAttribute('hidden'); row.removeAttribute('data-proto');
    fillH(row, 'name', EPAL.people ? EPAL.people.linkify(r.empName, r.empId) : esc(r.empName));
    // on All Companies the row also has to say whose employee is asking
    fillK(row, 'when', 'asked ' + ui.date(r.requestedOn) + (isAll() ? ' · ' + coShort(r.companyId) : ''));
    fillK(row, 'amount', ui.money(r.amount));
    fillK(row, 'forym', 'against ' + PR().mLabel(r.forYm));
    fillK(row, 'reason', r.reason || 'No reason given');
    var ap = act(row, 'approve', function () { advDecideForm(r, 'approved'); });
    var rj = act(row, 'reject', function () { advDecideForm(r, 'rejected'); });
    if (canCreate()) {
      ap.innerHTML = ui.icon('check2-circle') + ' Approve';
      rj.innerHTML = ui.icon('x-circle') + ' Decline';
    } else {
      // no permission to decide → the row still informs, but offers no buttons
      ap.parentNode.removeChild(ap); rj.parentNode.removeChild(rj);
    }
    host.appendChild(row);
  });
  page.appendChild(card);
}

/* Everything already decided — kept because "who asked for what and what did we
 * say" is exactly the question this screen gets asked six months later. Both
 * figures are shown: what was requested, and what was actually approved. */
function advRequestHistory(page) {
  var rows = (PR().advRequests({}) || []).filter(function (r) { return r.status !== 'pending' && inScope(r.companyId); });
  if (!rows.length) return;
  var tbl = EPAL.table({
    columns: withCo([
      { key: 'requestedOn', label: 'Asked', date: true },
      { key: 'empName', label: 'Employee', render: function (r) { return EPAL.people ? EPAL.people.linkify(r.empName, r.empId) : '<span class="strong">' + esc(r.empName) + '</span>'; } },
      { key: 'forYm', label: 'Against', render: function (r) { return '<span class="badge">' + esc(PR().mLabel(r.forYm)) + '</span>'; } },
      { key: 'amount', label: 'Asked for', num: true, money: true },
      { key: 'approvedAmount', label: 'Approved', num: true, sortVal: function (r) { return r.approvedAmount || 0; },
        render: function (r) {
          if (r.status !== 'approved') return '—';
          // a figure that differs from the ask is the interesting case — say so
          var cut = r.approvedAmount < r.amount;
          return '<span class="num strong ' + (cut ? 'text-warn' : 'text-good') + '">' + ui.money(r.approvedAmount) + '</span>' +
            (cut ? ' <span class="xs text-mute">of ' + esc(ui.money(r.amount)) + '</span>' : '');
        } },
      { key: 'reason', label: 'Reason' },
      { key: 'note', label: 'Decision note' },
      { key: 'status', label: 'Status', badge: { approved: 'good', rejected: 'bad' } }
    ], null, 2),
    rows: rows, searchKeys: ['empName', 'reason', 'note'], quickFilter: 'status', pageSize: 10,
    filters: coFilter(), filterPanel: isAll(),
    exportName: 'advance-requests.csv', pdfTitle: scopeFull() + ' — Advance Salary Requests',
    /* THE FOOT. "Asked for" sums every decided row; "Approved" sums ONLY the
     * approved ones — adding a rejected row's approved figure of nothing into an
     * average is how a decline turns into a discount. The gap between the two is
     * the interesting number, so the foot prints it. */
    totals: function (rs) {
      if (!rs.length) return null;
      var ok = rs.filter(function (r) { return r.status === 'approved'; });
      var asked = sum(rs, function (r) { return r.amount || 0; });
      var appr = sum(ok, function (r) { return r.approvedAmount || 0; });
      return { label: rs.length + (rs.length === 1 ? ' decision' : ' decisions'), values: {
        amount: ui.money(asked),
        approvedAmount: '<span class="num">' + ui.money(appr) + '</span>' +
          '<div class="xs text-mute nowrap">' + ui.money(asked - appr) + ' not advanced</div>',
        status: '<span class="xs text-mute">' + ok.length + ' approved · ' + (rs.length - ok.length) + ' declined</span>'
      } };
    },
    empty: { icon: 'inbox', title: 'Nothing decided yet' }
  });
  var card = frag('reg-card');
  slot(card, 'title').innerHTML = ui.icon('journal-check') + ' Decided requests';
  slot(card, 'sub').textContent = 'what was asked for, what was approved, and why';
  slot(card, 'body').appendChild(tbl.el);
  page.appendChild(card);
}

/* Raising the ask. The month defaults to NEXT month because that is what an
 * advance is — money against pay not yet earned. */
function advRequestForm(emp) {
  var mopts = [];
  var ym = PR().curYm();
  for (var i = 0; i < 4; i++) { mopts.push([ym, PR().mLabel(ym)]); ym = PR().nextYm(ym); }
  EPAL.formModal({
    title: 'Request advance salary', icon: 'hand-index', size: 'sm',
    record: { empId: emp ? emp.id : '', forYm: PR().nextYm(PR().curYm()), date: today() },
    fields: [
      { key: 'empId', label: 'Employee', type: 'select', required: true, searchable: true,
        options: team().map(function (e) { return [e.id, e.name + ' · ' + (e.dept || '—') + (isAll() ? ' · ' + coShort(e.companyId) : '')]; }) },
      { key: 'amount', label: 'Amount asked for (৳)', type: 'money', required: true, min: 0 },
      { key: 'forYm', label: 'Advance against which month', type: 'select', required: true, options: mopts,
        hint: 'The month of salary this will be recovered from.' },
      { key: 'reason', label: 'Reason', type: 'text', placeholder: 'Why is it needed?' },
      { key: 'date', label: 'Requested on', type: 'date', default: today() }
    ],
    saveLabel: 'Submit request',
    onSave: function (v) {
      try {
        PR().requestAdvance(v.empId, +v.amount, { forYm: v.forYm, reason: v.reason, date: v.date });
        ui.toast('Request submitted — it now needs approval', 'success'); repaint(); return true;
      } catch (e) { ui.toast(e.message || 'Could not submit', 'error'); return false; }
    }
  });
}

/* The decision. Approving pre-fills the asked amount and lets it be changed —
 * "asked 20,000, approved 12,000" is the normal case, not an edge one — and it
 * names the account the money leaves, so an approval moves a real balance rather
 * than an abstract one. Declining insists on a reason. */
function advDecideForm(r, decision) {
  var approve = decision === 'approved';
  EPAL.formModal({
    title: (approve ? 'Approve advance · ' : 'Decline advance · ') + r.empName,
    icon: approve ? 'check2-circle' : 'x-circle', size: 'sm',
    record: { amount: r.amount, date: today(), method: 'Bank' },
    fields: [
      { type: 'section', label: r.empName + ' asked for ' + ui.money(r.amount) + ' against ' + PR().mLabel(r.forYm) +
          (r.reason ? ' — "' + r.reason + '"' : '') },
      approve ? { key: 'amount', label: 'Amount to release (৳)', type: 'money', required: true, min: 0, default: r.amount,
        hint: 'Asked for ' + ui.money(r.amount) + '. Release less (or more) by changing this — the request keeps what was asked.' } : null,
      // the accounts of the company the REQUEST belongs to — that is whose staff
      // is being paid, and on All Companies the desk's scope is not a payer
      approve ? { key: 'method', label: 'Paid from', type: 'select', required: true, searchable: true,
        options: payOptions(r.companyId) } : null,
      approve ? { key: 'date', label: 'Paid on', type: 'date', default: today() } : null,
      { key: 'note', label: approve ? 'Note (optional)' : 'Reason for declining', type: 'text',
        required: !approve, placeholder: approve ? '' : 'They need to be told why' }
    ].filter(Boolean),
    saveLabel: approve ? 'Approve & release' : 'Decline request',
    onSave: function (v) {
      try {
        PR().decideAdvance(r.id, decision, { amount: v.amount, method: v.method, date: v.date, note: v.note });
        ui.toast(approve ? 'Approved — ' + ui.money(+v.amount || r.amount) + ' released' : 'Request declined', 'success');
        repaint(); return true;
      } catch (e) { ui.toast(e.message || 'Could not record the decision', 'error'); return false; }
    }
  });
}

/* The loan trail, told as loans rather than as movements: every row — the
 * disbursement and each repayment — names its loan and carries that loan's
 * "taken · paid · due" at that point in time. A disbursement row shows where
 * the loan stands NOW; a repayment row shows where it stood right after the
 * money came in. */
function loanTxnTable(txns, book, payIx) {
  var byId = {}; book.forEach(function (L) { byId[L.id] = L; });
  function hitsOf(x) { return x.type === 'loan' ? (byId[x.id] ? [{ L: byId[x.id] }] : []) : (payIx[x.id] || []); }
  var tbl = EPAL.table({
    columns: withCo([
      { key: 'date', label: 'Date', date: true },
      { key: 'empName', label: 'Employee' },
      { key: 'type', label: 'Type', badge: { loan: 'warn', 'loan-repay': 'good' } },
      { key: 'memo', label: 'Note' },
      // an auto-EMI carries no account because no account moved — it came off
      // the salary, and saying so beats an em dash
      { key: 'method', label: 'Method', sortVal: function (x) { return isAutoEmi(x) ? 'Salary deduction' : methodLabel(x.method); },
        exportVal: function (x) { return isAutoEmi(x) ? 'Salary deduction' : methodLabel(x.method); },
        render: function (x) { return isAutoEmi(x)
          ? '<span class="badge badge-info">Salary deduction</span>'
          : '<span class="badge">' + esc(methodLabel(x.method)) + '</span>'; } },
      { key: 'loan', label: 'The loan', sort: false,
        exportVal: function (x) { return hitsOf(x).map(function (h) { return ui.money(h.L.principal) + ' taken ' + ui.date(h.L.date); }).join(' + '); },
        render: function (x) { return loanRefHtml(hitsOf(x)); } },
      { key: 'lpaid', label: 'Paid till then', num: true, sort: false,
        exportVal: function (x) { return hitsOf(x).map(function (h) { return h.p ? h.L.principal - h.p.balance : h.L.paid; }).join(' + '); },
        render: function (x) { return loanPaidHtml(hitsOf(x)); } },
      { key: 'ldue', label: 'Due after', num: true, sort: false,
        exportVal: function (x) { return hitsOf(x).map(function (h) { return h.p ? h.p.balance : h.L.due; }).join(' + '); },
        render: function (x) { return loanDueHtml(hitsOf(x)); } },
      { key: 'amount', label: 'Amount', num: true, money: true }
    ], null, 2),
    rows: txns, searchKeys: ['empName', 'empId', 'memo'], pageSize: 10, exportName: 'loan-transactions.csv',
    filters: coFilter(), filterPanel: isAll(),
    pdfTitle: 'Loan transactions — ' + scopeFull(),
    /* THE FOOT, and the one table on this tab where a single Amount total would be
     * a LIE: these rows run in both directions — money lent out and money coming
     * back — so summing the column nets a disbursement against a repayment and
     * calls the result "amount". It foots as the two directions plus the net. */
    totals: function (xs) {
      if (!xs.length) return null;
      var lent = sum(xs.filter(function (x) { return x.type === 'loan'; }), function (x) { return +x.amount || 0; });
      var back = sum(xs.filter(function (x) { return x.type === 'loan-repay'; }), function (x) { return +x.amount || 0; });
      return { label: xs.length + (xs.length === 1 ? ' transaction' : ' transactions'), values: {
        amount: '<span class="num">' + ui.money(lent - back) + ' <span class="xs text-mute">net</span></span>' +
          '<div class="xs text-mute nowrap">' + ui.money(lent) + ' lent · ' + ui.money(back) + ' repaid</div>',
        lpaid: '', ldue: '<span class="xs text-mute">balances, not sums</span>'
      } };
    },
    onRow: function (x) { var h = hitsOf(x)[0]; if (h) loanDetailModal(h.L); },
    empty: { icon: 'journal', title: 'No transactions' }
  });
  var card = frag('head-card');
  slot(card, 'title').innerHTML = ui.icon('journal-text') + ' Loan transactions' + (isAll() ? ' — every company' : '');
  slot(card, 'body').appendChild(tbl.el);
  return card;
}

function txnTable(title, txns) {
  var tbl = EPAL.table({
    columns: withCo([ { key: 'date', label: 'Date', date: true }, { key: 'empName', label: 'Employee' },
      { key: 'type', label: 'Type', badge: { advance: 'warn', loan: 'warn', 'loan-repay': 'good' } },
      { key: 'memo', label: 'Note' }, { key: 'method', label: 'Method', badge: {} },
      { key: 'amount', label: 'Amount', num: true, money: true } ], null, 2),
    rows: txns, searchKeys: ['empName', 'empId', 'memo'], pageSize: 10, exportName: 'payroll-txns.csv',
    filters: coFilter(), filterPanel: isAll(), empty: { icon: 'journal', title: 'No transactions' },
    /* Every row here is money going OUT to an employee (this table lists advances
     * only — see its one caller), so a plain sum is the honest total, unlike the
     * loan transactions table where the rows run both ways. */
    totals: function (xs) {
      if (!xs.length) return null;
      return { label: xs.length + (xs.length === 1 ? ' transaction' : ' transactions'), values: {
        amount: ui.money(sum(xs, function (x) { return +x.amount || 0; }))
      } };
    },
    toolbarEl: el('button.btn.btn-sm.btn-ghost', { html: ui.icon('printer') + ' Print',
      title: 'Print the advance register — who holds what, and what is being recovered',
      onclick: function () { advancePrintCentre(); } })
  });
  var card2 = frag('head-card'); slot(card2, 'title').innerHTML = ui.icon('journal-text') + ' ' + title + (isAll() ? ' — every company' : ''); slot(card2, 'body').appendChild(tbl.el); return card2;
}
function moneyForm(emp, type) {
  var meta = { advance: ['Give Advance Salary', 'cash', 'Advance salary'], loan: ['Disburse Staff Loan', 'bank', 'Staff loan'], 'loan-repay': ['Record Loan Repayment', 'arrow-return-left', 'Loan repayment'] }[type];
  var staff = team();
  var rec = { date: today(), method: 'Bank' }; if (emp) rec.empId = emp.id;
  // WHOSE ACCOUNTS to offer. The engine books this against the EMPLOYEE's company
  // (loan/advance/repayLoan all derive it from compOf(empId)), so the account list
  // has to follow the employee, not the desk — otherwise All Companies would offer
  // Travels' bank for a Woodart loan. The list starts on whoever the form opens
  // with and re-fills when the employee changes.
  var firstCo = (emp && emp.companyId) || (staff.length ? staff[0].companyId : CID);
  EPAL.formModal({
    title: meta[0], icon: meta[1], size: 'sm', record: rec,
    onReady: isAll() ? function (f) {
      var ctrl = f.ctrls && f.ctrls.empId;
      if (!ctrl || !ctrl.input) return;
      ctrl.input.addEventListener('change', function () { f.setOptions('method', payOptions(empCo(this.value))); });
    } : null,
    fields: [
      { key: 'empId', label: 'Employee', type: 'select', required: true,
        options: staff.map(function (e) { return [e.id, e.name + ' · ' + e.dept + (isAll() ? ' · ' + coShort(e.companyId) : '')]; }) },
      { key: 'amount', label: 'Amount (৳)', type: 'money', required: true, min: 0 },
      type === 'loan' ? { key: 'emiMonths', label: 'Repay over (months)', type: 'number', min: 0, default: 0 } : null,
      { key: 'date', label: 'Date', type: 'date', default: today() },
      // WHICH ACCOUNT the money moves through (audit 2026-07-28) — a real one, so
      // handing an employee an advance actually leaves an account and lands in its
      // history, instead of moving an abstract 1010 and nothing else
      { key: 'method', label: type === 'loan-repay' ? 'Received into' : 'Paid from', type: 'select', required: true, searchable: true,
        hint: isAll() ? 'The employee\'s own company\'s accounts — pick the employee first.' : '',
        options: payOptions(firstCo) },
      { key: 'memo', label: 'Note', type: 'text', placeholder: meta[2] }
    ].filter(Boolean),
    saveLabel: meta[0],
    onSave: function (v) {
      var fn = { advance: PR().advance, loan: PR().loan, 'loan-repay': PR().repayLoan }[type];
      try { fn(v.empId, +v.amount, { date: v.date, method: v.method, memo: v.memo || meta[2], emiMonths: +v.emiMonths || 0 }); ui.toast(meta[0] + ' recorded', 'success'); EPAL.router.render(); return true; } catch (x) { ui.toast(x.message || 'Failed', 'error'); return false; }
    }
  });
}

/* =================================================== PAYSLIP */
function payslipView(page) {
  var t = team();
  var slips = scoped('pay_slips').filter(function (s) { return s.status !== 'draft'; }).sort(function (a, b) { return a.ym < b.ym ? 1 : -1; });
  // the month list is a UNION on All Companies — six runs of January are one
  // January to pick, and a month with slips but no run still has payslips to read
  var months = isAll()
    ? monthSeries().map(function (m) { return m.ym; }).sort().reverse()
    : scoped('pay_runs').map(function (r) { return r.ym; }).sort().reverse();
  var pick = frag('pick-card');
  var row = slot(pick, 'row');
  row.appendChild(field('Employee', (function () { var s = el('select.input', { id: 'ps-emp' }); t.forEach(function (e) { s.appendChild(el('option', { value: e.id, text: e.name + (isAll() ? ' · ' + coShort(e.companyId) : '') })); }); return s; })()));
  row.appendChild(field('Month', (function () { var s = el('select.input', { id: 'ps-ym' }); (months.length ? months : [PR().curYm()]).forEach(function (m) { s.appendChild(el('option', { value: m, text: PR().mLabel(m) })); }); return s; })()));
  row.appendChild(field(' ', el('button.btn.btn-primary', { html: ui.icon('receipt') + ' View Statement', onclick: function () { var e = empById(document.getElementById('ps-emp').value); var ym = document.getElementById('ps-ym').value; if (e) statement(e, ym); } })));
  page.appendChild(pick);

  var tbl = EPAL.table({
    columns: withCo([
      { key: 'empName', label: 'Employee', render: function (s) { return EPAL.people ? EPAL.people.linkify(s.empName, s.empId) : '<span class="strong">' + esc(s.empName) + '</span>'; } },
      { key: 'ym', label: 'Month', render: function (s) { return PR().mLabel(s.ym); } },
      { key: 'earnedGross', label: 'Gross', num: true, money: true },
      { key: 'net', label: 'Net', num: true, sortVal: function (s) { return PR().slipPayable(s); }, render: function (s) { return '<span class="num strong">' + ui.money(PR().slipPayable(s)) + '</span>'; } },
      { key: 'encashAmt', label: 'Leave Encash', num: true, money: true },
      { key: 'status', label: 'Status', badge: { accrued: 'info', partial: 'warn', due: 'bad', paid: 'good' } }
    ]),
    rows: slips, searchKeys: ['empName', 'empId'], quickFilter: 'status', pageSize: 12, exportName: 'payslips.csv',
    filters: coFilter(), filterPanel: isAll(),
    pdfTitle: isAll() ? scopeFull() + ' — Payslips' : 'Travels Payslips',
    onRow: function (s) { var e = empById(s.empId); if (e) statement(e, s.ym); },
    actions: ui.actions({ print: function (s) { var e = empById(s.empId); if (e) statementPrint(e, s.ym); } }),
    empty: { icon: 'receipt', title: 'No payslips yet', hint: 'Finalize a payroll month in Salary Manage.' }
  });
  var card2 = frag('head-card'); slot(card2, 'title').innerHTML = ui.icon('card-list') + ' All Payslips' + (isAll() ? ' — every company' : ''); slot(card2, 'body').appendChild(tbl.el); page.appendChild(card2);
}
function field(label, input) { return el('div', null, [ el('label.text-mute.sm', { text: label, style: { display: 'block', marginBottom: '3px' } }), input ]); }

function statement(e, ym) { if (EPAL.people) EPAL.people.statement(e, ym); }
function statementPrint(e, ym) { if (EPAL.people) EPAL.people.payslipPrint(e, ym); }

/* =================================================== PAYROLL REPORTS */
/* ============================================================================
 * WHERE THE MONEY WENT — which account actually paid the payroll
 * ----------------------------------------------------------------------------
 * Owner 2026-07-29: "I have paid salary to Mr X — from WHERE have I paid? From
 * cash, how much in total? From bank, how much last month, and last 6 months?
 * In WHICH specific banks?"
 *
 * Every one of those figures was already on file and nowhere on a screen: the
 * month sheet names the account per transaction but only ever totals one month,
 * and it says "৳X left an account" without saying which. This is the same
 * `monthTxns()` rows — the ONE place a payroll transaction is normalised — walked
 * over a period and grouped by the account they left, so there is no second
 * definition of a payroll payment to keep in step.
 *
 * IT COUNTS CASH, NOT THE HEADLINE AMOUNT. A salary of 30,000 with a 5,000 EMI
 * recovered inside it took 25,000 out of the bank; `r.cash` is that figure and
 * `r.amount` is not. Rows where nothing moved (an advance recovered out of the
 * same salary) are excluded from every account and reported separately below the
 * table, because putting them in an account column would claim money left it.
 *
 * AND IT COUNTS BY THE DAY THE MONEY MOVED, not by the salary month it belonged
 * to. "How much did I pay out of the bank last month" is a question about the
 * BANK, and June's salary paid on 4 July left the bank in July. So every month
 * that HAS payroll data is scanned and each transaction is then kept or dropped
 * on its own date — bucketing by salary month instead lost every payment whose
 * month fell outside the window (caught by the driver against the ledger's own
 * cash movement: it was short by ৳51,453 over six months). */
var srcMonths = 6;
function sourceRollup(n) {
  var by = {}, tot = { out: 0, back: 0, internal: 0 };
  var win = monthsUpTo(n), first = win[0], last = win[win.length - 1];
  var scan = {};
  win.forEach(function (m) { scan[m] = 1; });
  monthSeries().forEach(function (m) { scan[m.ym] = 1; });      // salary months that pay later
  Object.keys(scan).sort().forEach(function (ym) {
    monthTxns(ym).forEach(function (r) {
      var d = String(r.date || '').slice(0, 7);
      if (d < first || d > last) return;                        // it moved outside the period
      if (r.dir === 'internal') { tot.internal += r.amount; return; }
      if (!r.cash) return;                            // nothing actually moved
      var k = r.from || '—';
      var row = by[k] || (by[k] = { from: k, salary: 0, advance: 0, loan: 0, bonus: 0, other: 0, out: 0, back: 0, txns: [] });
      row.txns.push(r);
      if (r.dir === 'in') { row.back += r.cash; tot.back += r.cash; return; }
      var b = (r.type === 'salary' || r.type === 'advance' || r.type === 'loan' || r.type === 'bonus') ? r.type : 'other';
      row[b] += r.cash; row.out += r.cash; tot.out += r.cash;
    });
  });
  return { rows: Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return b.out - a.out; }), tot: tot };
}
function moneyCol(key, label) {
  return { key: key, label: label, num: true, sortVal: function (r) { return r[key]; },
    render: function (r) { return r[key] ? ui.money(r[key]) : '—'; } };
}
function sourceCard() {
  var res = sourceRollup(srcMonths), c = frag('reg-card');
  var sel = el('select.input', { onchange: function () { srcMonths = +this.value; EPAL.router.render(); } });
  sel.classList.add('tw-max-w-[230px]');
  [[1, 'This month'], [3, 'Last 3 months'], [6, 'Last 6 months'], [12, 'Last 12 months']].forEach(function (o) {
    var op = el('option', { value: o[0], text: o[1] }); if (o[0] === srcMonths) op.selected = true; sel.appendChild(op);
  });
  slot(c, 'title').innerHTML = ui.icon('bank') + ' Where the money went';
  slot(c, 'sub').textContent = 'every payroll taka by the account it left, on the day it moved — click an account for its transactions';
  // the period rides IN the table's own toolbar, beside Search (owner 2026-07-29:
  // "all in one row") — on its own line above it cost a whole row to one control
  slot(c, 'body').appendChild(EPAL.table({
    toolbarEl: sel,
    columns: [
      { key: 'from', label: 'Paid from', render: function (r) { return '<span class="strong">' + esc(r.from) + '</span>'; } },
      moneyCol('salary', 'Salary'), moneyCol('advance', 'Advance'), moneyCol('loan', 'Staff loan'),
      moneyCol('bonus', 'Bonus'), moneyCol('other', 'Other'),
      { key: 'out', label: 'Total paid out', num: true, sortVal: function (r) { return r.out; },
        render: function (r) { return '<span class="num strong">' + ui.money(r.out) + '</span>'; } },
      { key: 'back', label: 'Came back in', num: true, sortVal: function (r) { return r.back; },
        render: function (r) { return r.back ? '<span class="text-good">' + ui.money(r.back) + '</span>' : '—'; } }
    ],
    rows: res.rows, pageSize: 10, totalKey: 'out', searchKeys: ['from'],
    exportName: 'payroll-by-account.csv', pdfTitle: scopeFull() + ' — Payroll by account',
    onRow: function (r) { sourceDrill(r); },
    empty: { icon: 'bank', title: 'Nothing was paid in this period', hint: 'Salary that is accrued but unpaid never leaves an account.' }
  }).el);
  var note = res.rows.length
    ? ui.money(res.tot.out) + ' left these account(s) over ' + srcMonths + ' month(s)'
      + (res.tot.back ? ' · ' + ui.money(res.tot.back) + ' came back in (loan repayments)' : '')
      + (res.tot.internal ? ' · ' + ui.money(res.tot.internal) + ' was recovered inside a salary payment and never touched an account' : '') + '.'
    : 'Nothing left an account in this period.';
  slot(c, 'body').appendChild(el('p.text-mute.xs.mt-2', { text: note }));
  return c;
}
/* ONE ACCOUNT — everything payroll moved through it in the period, newest first.
 * Rows are the same shape the month sheet uses, so clicking one opens the very
 * same detail + voucher. */
function sourceDrill(row) {
  var body = el('div');
  body.appendChild(el('p.text-mute.sm.mb-2', { text: row.txns.length + ' payroll transaction(s) through ' + row.from
    + ' in the last ' + srcMonths + ' month(s) — click one for its detail and voucher.' }));
  body.appendChild(EPAL.table({
    columns: [
      { key: 'date', label: 'Date', date: true },
      { key: 'empName', label: 'Employee', render: function (r) { return '<span class="strong">' + esc(r.empName) + '</span>'; } },
      { key: 'purpose', label: 'Purpose', badge: { Salary: 'good', Advance: 'warn', 'Staff loan': 'warn', 'Loan repayment': 'info', Bonus: 'good', 'Leave encashment': 'info', 'Final settlement': 'bad' } },
      { key: 'ym', label: 'Month', render: function (r) { return '<span class="nowrap">' + esc(PR().mLabel(r.ym)) + '</span>'; } },
      { key: 'cash', label: 'Amount', num: true, sortVal: function (r) { return r.cash; },
        render: function (r) { return '<span class="num strong ' + (r.dir === 'in' ? 'text-good' : '') + '">' + ui.money(r.cash) + '</span>'; } }
    ],
    rows: row.txns.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; }),
    searchKeys: ['empName', 'purpose', 'memo'], pageSize: 12, totalKey: 'cash',
    exportName: 'payroll-account.csv',
    onRow: function (r) { txnDetailModal(r); },
    empty: { icon: 'journal', title: 'No transactions' }
  }).el);
  ui.modal({ title: row.from, icon: 'bank', size: 'lg', body: body, actions: [{ label: 'Close' }] });
}

function reportsView(page) {
  var t = team();
  var liability = scopeCids().reduce(function (a, c) { return a + PR().encashmentLiability(c); }, 0);
  var salaryDue = sum(t, function (e) { return PR().salaryDue(e.id); });
  var advOut = sum(t, function (e) { return PR().advanceOutstanding(e.id); });
  var loanOut = sum(t, function (e) { return PR().loanOutstanding(e.id); });

  /* NO SPARKLINE BAND ON THIS ROW — on purpose (owner 2026-07-29).
   * Two of these four have no derivable history:
   *  · Leave-encashment liability is computed by the engine from leaveState() per
   *    employee (accrued days × today's day-rate). The only history the stores hold
   *    is Σ slip.encashAmt, which does NOT reconcile to it — drawing that line under
   *    this number would put two different quantities in one tile.
   *  · Salary Due needs accrual dates to walk backwards; the slip keeps a running
   *    `paid` and a single `paidDate`, so a true month-end series is not available
   *    without reading the ledger, which belongs to the variance work (Wave 2).
   * Advance and Loan DO have exact series, so they keep their trend pills — but a
   * row where two cards carry a sparkline and two do not reads broken, so the band
   * is dropped for all four and every tile gets a context line instead. */
  var advHolders = t.filter(function (e) { return PR().advanceOutstanding(e.id) > 0; }).length;
  var loanHolders = t.filter(function (e) { return PR().loanOutstanding(e.id) > 0; }).length;
  var dueHeads = t.filter(function (e) { return PR().salaryDue(e.id) > 0; }).length;
  var accruing = t.filter(function (e) { return PR().leaveState(e).value > 0; }).length;
  var eligible = t.filter(function (e) { var ls = PR().leaveState(e); return ls.eligibleFullYear && ls.value > 0; }).length;
  var emiTotal = sum(t, function (e) { return PR().emiInstallment(e.id); });

  if (isAll()) page.appendChild(scopeNote('Group payroll reports — ' + scopeNames(),
    'Encashment liability, salary due, advance and loan registers and the department cost of all ' + scopeCids().length + ' payrolls added together, with the company on every row. "Where the money went" groups by the account it left, so an account is still one company\'s.'));
  var grid = frag('kpi-grid');
  grid.appendChild(kpi2({ label: 'Leave Encash Liability', value: ui.money(liability, { compact: true }), icon: 'piggy-bank', tone: 'text-warn',
    foot: accruing ? accruing + ' accruing · ' + eligible + ' encashable now' : 'nothing accrued yet' }));
  grid.appendChild(kpi2({ label: 'Salary Due', value: ui.money(salaryDue, { compact: true }), icon: 'hourglass-split',
    tone: salaryDue > 0 ? 'text-bad' : 'text-good',
    foot: dueHeads ? dueHeads + ' employee(s) still owed' : 'every payslip is settled' }));
  grid.appendChild(kpi2({ label: 'Advance Outstanding', value: ui.money(advOut, { compact: true }), icon: 'cash',
    foot: advHolders ? advHolders + ' staff holding an advance' : 'no advances outstanding',
    series: balanceSeries(advanceEvents(), 12), spark: false, goodDown: true }));
  grid.appendChild(kpi2({ label: 'Loan Outstanding', value: ui.money(loanOut, { compact: true }), icon: 'bank',
    foot: loanHolders ? loanHolders + ' active loan(s)' + (emiTotal ? ' · ' + ui.money(emiTotal) + '/mo EMI' : '') : 'no active loans',
    series: balanceSeries(loanEvents(), 12), spark: false, goodDown: true }));
  page.appendChild(grid);

  // the owner's most-asked question — from WHICH account, over WHICH period
  page.appendChild(sourceCard());

  var encRows = t.map(function (e) { var ls = PR().leaveState(e); return { e: e, name: e.name, companyId: e.companyId, dept: e.dept, days: ls.encashableDays, value: ls.value, eligible: ls.eligibleFullYear }; }).filter(function (r) { return r.value > 0; });
  var encTbl = EPAL.table({
    columns: withCo([
      { key: 'name', label: 'Employee', render: function (r) { return EPAL.people ? EPAL.people.linkify(r.name, r.e.id) : '<span class="strong">' + esc(r.name) + '</span>'; } },
      { key: 'dept', label: 'Dept', badge: {} },
      { key: 'days', label: 'Accrued days', num: true, sortVal: function (r) { return r.days; }, render: function (r) { return r.days.toFixed(2); } },
      { key: 'value', label: 'Value', num: true, money: true },
      { key: 'eligible', label: 'Eligibility', render: function (r) { return r.eligible ? '<span class="badge badge-good">Eligible</span>' : '<span class="badge badge-warn">Accruing</span>'; } }
    ]),
    rows: encRows, pageSize: 10, exportName: 'leave-encashment-liability.csv',
    filters: coFilter(), filterPanel: isAll(), pdfTitle: 'Leave Encashment Liability' + (isAll() ? ' — ' + scopeFull() : ''),
    actions: ui.actions({ edit: canCreate() ? function (r) { payEncashFlow(r.e); } : null }),
    onRow: function (r) { statement(r.e, PR().curYm()); }, empty: { icon: 'piggy-bank', title: 'No accrued encashment' }
  });
  page.appendChild(reportCard('Leave Encashment Liability', 'piggy-bank', ui.money(liability) + ' total provision · ✎ to pay out & reset', encTbl.el));

  var dueRows = t.map(function (e) { return { id: e.id, name: e.name, companyId: e.companyId, dept: e.dept, amt: PR().salaryDue(e.id) }; }).filter(function (r) { return r.amt > 0; });
  if (dueRows.length) page.appendChild(reportCard('Salary Due', 'hourglass-split', dueRows.length + ' employees owed', simpleTbl(dueRows, 'Outstanding')));
  var advRows = t.map(function (e) { return { id: e.id, name: e.name, companyId: e.companyId, dept: e.dept, amt: PR().advanceOutstanding(e.id) }; }).filter(function (r) { return r.amt > 0; });
  if (advRows.length) page.appendChild(reportCard('Advance Register', 'cash', 'who holds advance now', simpleTbl(advRows, 'Advance held')));
  /* The loan register is the one report that cannot be a name-and-a-number:
   * a loan balance means nothing without what was taken, when, and how much has
   * already come back (owner 2026-07-29). */
  var openLoans = loanRows().filter(function (L) { return !L.closed; });
  if (openLoans.length) page.appendChild(reportCard('Loan Outstanding', 'bank',
    openLoans.length + ' loan(s) in progress · taken · paid till now · still due',
    EPAL.table({
      columns: withCo([
        { key: 'empName', label: 'Employee', sortVal: function (L) { return L.empName; },
          render: function (L) { return EPAL.people ? EPAL.people.linkify(L.empName, L.empId) : '<span class="strong">' + esc(L.empName) + '</span>'; } },
        { key: 'dept', label: 'Dept', badge: {}, exportVal: function (L) { return (L.emp && L.emp.dept) || ''; },
          render: function (L) { return '<span class="badge">' + esc((L.emp && L.emp.dept) || '—') + '</span>'; } },
        { key: 'date', label: 'Taken on', date: true },
        { key: 'principal', label: 'Loan taken', num: true, money: true },
        { key: 'paid', label: 'Paid till now', num: true, sortVal: function (L) { return L.paid; }, exportVal: function (L) { return L.paid; },
          render: function (L) { return '<span class="num text-good">' + ui.money(L.paid) + '</span> <span class="xs text-mute">' + loanPct(L) + '%</span>'; } },
        { key: 'due', label: 'Still due', num: true, sortVal: function (L) { return L.due; }, exportVal: function (L) { return L.due; },
          render: function (L) { return '<span class="num strong text-warn">' + ui.money(L.due) + '</span>'; } },
        { key: 'emi', label: 'EMI', num: true, sortVal: function (L) { return L.emi; },
          render: function (L) { return L.emi ? '<span class="num">' + ui.money(L.emi) + '/mo</span>' : '<span class="text-mute">no plan</span>'; } }
      ]),
      rows: openLoans, pageSize: 8, exportName: 'loan-outstanding.csv', pdfTitle: 'Loan Outstanding — ' + scopeFull(),
      filters: coFilter(), filterPanel: isAll(),
      onRow: function (L) { loanDetailModal(L); },
      empty: { icon: 'bank', title: 'Nothing outstanding' }
    }).el));

  // merged across the scope: "Sales" exists in more than one concern, and the
  // group's Sales line is their sum, not six rows with the same name
  var dc = deptCost();
  var dcTbl = EPAL.table({
    columns: [ { key: 'dept', label: 'Department', render: function (r) { return '<span class="strong">' + esc(r.dept) + '</span>'; } },
      { key: 'heads', label: 'Headcount', num: true, render: function (r) { return String(t.filter(function (e) { return (e.dept || '—') === r.dept; }).length); } },
      { key: 'cost', label: 'Monthly Cost', num: true, money: true } ],
    rows: dc, pageSize: 10, exportName: 'department-cost.csv', empty: { icon: 'diagram-3', title: 'No data' }
  });
  page.appendChild(reportCard('Department Cost (monthly gross)', 'diagram-3', 'salary cost by department', dcTbl.el));

  var incRows = []; t.forEach(function (e) { (e.salaryHistory || []).forEach(function (h) { incRows.push({ name: e.name, companyId: e.companyId, date: h.date, from: h.from, to: h.to, by: h.by || '' }); }); });
  incRows.sort(function (a, b) { return a.date < b.date ? 1 : -1; });
  if (incRows.length) {
    var incTbl = EPAL.table({
      columns: withCo([ { key: 'date', label: 'Date', date: true }, { key: 'name', label: 'Employee' },
        { key: 'from', label: 'From', num: true, money: true }, { key: 'to', label: 'To', num: true, money: true },
        { key: 'change', label: 'Change', num: true, sortVal: function (r) { return (r.to || 0) - (r.from || 0); }, render: function (r) { var d = (r.to || 0) - (r.from || 0); return '<span class="num ' + (d >= 0 ? 'text-good' : 'text-bad') + '">' + (d >= 0 ? '+' : '') + ui.money(d) + '</span>'; } } ], null, 2),
      rows: incRows, pageSize: 10, exportName: 'increment-history.csv',
      filters: coFilter(), filterPanel: isAll(), empty: { icon: 'graph-up-arrow', title: 'No increments' }
    });
    page.appendChild(reportCard('Increment History', 'graph-up-arrow', incRows.length + ' salary revisions', incTbl.el));
  }
}
function reportCard(title, icon, sub, node) {
  var card2 = frag('reg-card'); slot(card2, 'title').innerHTML = ui.icon(icon) + ' ' + title; slot(card2, 'sub').textContent = sub; slot(card2, 'body').appendChild(node); return card2;
}
function simpleTbl(rows, label) {
  return EPAL.table({ columns: withCo([ { key: 'name', label: 'Employee', render: function (r) { return EPAL.people ? EPAL.people.linkify(r.name, r.id || r.name) : '<span class="strong">' + esc(r.name) + '</span>'; } }, { key: 'dept', label: 'Dept', badge: {} }, { key: 'amt', label: label, num: true, money: true } ]),
    rows: rows, pageSize: 8, filters: coFilter(), filterPanel: isAll(), empty: { icon: 'inbox', title: 'Nothing outstanding' } }).el;
}
function payEncashFlow(e) {
  var ls = PR().leaveState(e);
  // it names the account it is paid from (audit 2026-07-28), so the payout leaves a
  // real balance and shows in that account's history like every other payment
  if (EPAL.pay && EPAL.pay.ask) {
    // the EMPLOYEE'S company pays its own staff — never the desk's scope, which
    // on All Companies is not a company and owns no accounts
    EPAL.pay.ask({ title: 'Pay leave encashment · ' + e.name, icon: 'cash-coin', owner: e.companyId || CID,
      amount: ls.value, saveLabel: 'Pay Encashment', onPick: function (src) {
        try { PR().payEncashment(e.id, { method: src && src.bank ? 'bank:' + src.bank.id : 'Bank' });
          ui.toast('Encashment paid' + (src && src.bank ? ' from ' + src.bank.name : ''), 'success'); EPAL.router.render(); }
        catch (x) { ui.toast(x.message || 'Failed', 'error'); } } });
    return;
  }
  ui.confirm({ title: 'Pay leave encashment — ' + e.name + '?', text: 'Pays ' + ls.encashableDays.toFixed(2) + ' accrued days = ' + ui.money(ls.value) + ' (DR Leave-Encash Payable / CR Bank) and resets the accrual.', confirmLabel: 'Pay Encashment' })
    .then(function (ok) { if (!ok) return; try { PR().payEncashment(e.id); ui.toast('Encashment paid', 'success'); EPAL.router.render(); } catch (x) { ui.toast(x.message || 'Failed', 'error'); } });
}

/* ============================================================================
 * THE PRINTED PAYROLL  (owner 2026-07-30 — written spec + a marked-up mock-up)
 * ----------------------------------------------------------------------------
 * "Print" no longer prints. It opens the PRINT CENTRE: confirm the scope, tick
 * the months, choose summary or employee-level, tick the people — then preview
 * the REAL document and send it to the printer. Everything below is the same
 * read the screens make, formatted for paper; nothing here invents a figure.
 *
 * WHAT A PAYROLL DOCUMENT MUST DO THAT A SCREEN NEED NOT
 *  · Every numeric column FOOTS — and the foot is not always a sum. A percentage
 *    is RE-COMPUTED from the totals (an average of row percentages is a
 *    different, wrong number); a cumulative accrual shows its CLOSING BALANCE;
 *    headcount is a DISTINCT count, because seven months of 21 staff is 21
 *    people and not 147.
 *  · A partial selection SAYS SO on the page. A payroll report that looks
 *    complete but is not is a control failure, not a formatting one.
 *  · Leave encashment is a LIABILITY ACCRUAL, never pay: it stays out of Net
 *    Payable, accrues monthly and settles once in December — printed in words so
 *    no reader mistakes it for unpaid salary.
 *  · Only APPROVED runs print. Drafts are excluded and every page says so.
 *  · The figures are the SHEET's. The desk's Payroll ↔ Ledger card is where the
 *    sheet is reconciled against the books; a report that quietly mixed the two
 *    would foot to neither.
 *
 * The layout itself lives in platform/kit/report-print.js (EPAL.report) — A4
 * landscape, JS-paginated, black figures, brackets for negatives. This file
 * decides WHAT is printed; that one decides how a page is built.
 * ==========================================================================*/

function payUser() { var u = (EPAL.auth && EPAL.auth.current && EPAL.auth.current()) || null; return (u && u.name) || 'Signed in'; }
function payMoney(n) { return EPAL.report.money(n); }
function payBrk(n) { return EPAL.report.brackets(n); }
function payPct(n) { return EPAL.report.pct(n); }
function coCode(cid) { return String(coShort(cid) || cid).toUpperCase().replace(/[^A-Z0-9]/g, ''); }

/* THE MASTHEAD — read from the company master record (EPAL.config), never from
 * this file, so one edit changes every document the group prints. A single
 * concern prints its OWN name over its own contact block where it has one, and
 * over the group's where it does not: they trade from the group's address, and
 * printing nothing there would be less true than printing that. */
function payLetterhead() {
  var g = (EPAL.config && EPAL.config.group) || {}, lh = g.letterhead || {};
  var c = isAll() ? null : (EPAL.config.company ? EPAL.config.company(CID) : null);
  var own = (c && c.letterhead) || {};
  var l1 = [g.legalName || '', own.address || lh.address || ''].filter(Boolean).join(' · ');
  var l2 = [own.web || lh.web, own.email || lh.email, own.phone || lh.phone, own.licences || lh.licences]
    .filter(Boolean).join(' · ');
  return { name: c ? c.name : (g.name || 'Epal Group'), division: 'Human Resources & Payroll',
    lines: [l1, l2].filter(Boolean) };
}

/* THE REPORT ID. MR = Monthly Register, SR = Salary Register — two different
 * documents that must never be confused for one another, and a consolidated
 * report must never be confused for one concern's: the company code sits in the
 * id exactly when the report is scoped to a company. */
function payReportId(kind, ym) { return 'PR-' + kind + (isAll() ? '' : '-' + coCode(CID)) + '-' + ym; }
/* REV — how many times THIS document has been raised. Read here, committed only
 * when the print dialog is actually opened (see onPrint), so flipping through
 * previews does not burn revision numbers. It is also the audit trail: who
 * raised a confidential payroll document, and when.
 * ⚠ Browser-local until the Laravel backend owns it (same gap as pay_txns). */
function payRev(id) { var r = S.list('pay_prints').filter(function (x) { return x.id === id; })[0]; return ((r && r.n) || 0) + 1; }
function payRevCommit(id, rev) { S.upsert('pay_prints', { id: id, n: rev, at: Date.now(), by: payUser() }); }
function payMetaLines(id, rev) {
  return ['Report  ' + id + '  ·  Rev ' + (rev < 10 ? '0' + rev : rev),
    'Generated ' + ui.date(new Date(), 'full') + ' by ' + payUser(),
    'Currency: Bangladeshi Taka (Tk)'];
}
function paySignoff() {
  return [{ role: 'Prepared by', name: payUser() }, { role: 'Checked by', name: 'Accounts' },
    { role: 'Recommended by', name: 'Head of HR & Admin' }, { role: 'Approved by', name: 'Managing Director' }];
}
// the filename Chrome pre-fills in Save-as-PDF (it takes the document title)
function payFileName(kind, first, last) {
  var d = new Date(), p = function (n) { return n < 10 ? '0' + n : String(n); };
  var mo = function (ym) { return PR().mLabel(ym).slice(0, 3); };      // "Jul"
  var period = (first === last ? mo(last) : mo(first) + '-' + mo(last)) + last.slice(0, 4);
  return ['Epal-Payroll', kind, isAll() ? 'AllCompanies' : coShort(CID).replace(/[^A-Za-z0-9]/g, ''),
    period, d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate())].filter(Boolean).join('-');
}

/* Only APPROVED (finalized and beyond) runs may be printed — a draft month is a
 * working figure, not a document. Ascending, because a register reads forwards. */
function approvedMonths() { return monthSeries().filter(function (m) { return m.status && m.status !== 'draft'; }); }
function draftMonthCount() { return monthSeries().length - approvedMonths().length; }
/* The encashment BALANCE at the end of each month — a running total over every
 * month in the book, not over the printed selection: a balance is what the
 * account actually holds, and unticking March does not un-accrue March. */
function encashRunning() {
  var run = 0, map = {};
  monthSeries().forEach(function (m) { run += m.encash || 0; map[m.ym] = run; });
  return map;
}
function distinctHeads(yms) {
  var want = {}, ids = {};
  yms.forEach(function (y) { want[y] = 1; });
  scoped('pay_slips').forEach(function (s) { if (want[s.ym]) ids[s.empId] = 1; });
  return Object.keys(ids).length;
}
/* People with NOTHING outstanding across a set of months — the honest foot for a
 * "staff paid" column. Summing the monthly counts would report 119 people out of
 * seven months of 17, and one month settled does not settle a person. */
function distinctSettledHeads(yms) {
  var want = {}, all = {}, owed = {};
  yms.forEach(function (y) { want[y] = 1; });
  scoped('pay_slips').forEach(function (s) {
    if (!want[s.ym]) return;
    all[s.empId] = 1;
    if (dueOf(s) > 0) owed[s.empId] = 1;
  });
  return Object.keys(all).filter(function (id) { return !owed[id]; }).length;
}
// column widths as weights, normalised — table-layout is fixed, so they must add up
function payWidths(ws) {
  var t = ws.reduce(function (a, b) { return a + b; }, 0);
  return ws.map(function (w) { return (w / t * 100).toFixed(2) + '%'; });
}

/* ---------------------------------------------------------------------------
 * REPORT 1 — the MONTHLY REGISTER (one row per month), summary level
 * ------------------------------------------------------------------------- */
function paySummaryReport(months) {
  var cum = encashRunning(), first = months[0], last = months[months.length - 1];
  var T = { gross: 0, adds: 0, deds: 0, net: 0, encash: 0, paid: 0, due: 0 };
  months.forEach(function (m) {
    T.gross += m.gross || 0; T.adds += m.adds || 0; T.deds += m.deds || 0; T.net += m.net || 0;
    T.encash += m.encash || 0; T.paid += m.paid || 0; T.due += m.due || 0;
  });
  var heads = distinctHeads(months.map(function (m) { return m.ym; }));
  var encBal = cum[last.ym] || 0;                       // liability carried
  var cost = T.gross + T.adds + T.encash;               // the budgeting figure
  var perHead = heads ? cost / heads / months.length : 0;
  var monthly = last.encash || 0;                       // this month's flat accrual
  var monthNo = +last.ym.slice(5, 7), left = Math.max(0, 12 - monthNo);
  var id = payReportId('MR', last.ym), rev = payRev(id);
  var everyMonth = approvedMonths().length === months.length;

  /* Widths, as weights over 273mm of printable page. The month column carries
   * "September 2026" and the totals row's "Total — 7 runs" on ONE line — a
   * wrapped label in the first column makes every row of a register look like
   * two. The figures need ~15mm for an eight-character taka amount at 8.5pt. */
  var w = payWidths([12, 5, 5.5, 7.5, 7, 7.5, 8, 7.5, 7.5, 7, 5.5, 5.5, 6]);
  var rows = months.map(function (m, i) {
    var prev = i > 0 ? months[i - 1] : null;
    var mom = (prev && prev.net) ? (m.net - prev.net) / prev.net * 100 : null;
    return [
      { v: esc(PR().mLabel(m.ym)), strong: true, sub: esc(m.ym) },
      { v: esc(cap(m.status || 'draft')) },
      { v: String(m.heads || 0), num: true },
      { v: payMoney(m.gross), num: true },
      { v: payMoney(m.adds), num: true },
      { v: payBrk(m.deds), num: true },
      { v: payMoney(m.net), num: true, strong: true },
      { v: payMoney(cum[m.ym]), num: true },
      { v: payMoney(m.paid), num: true },
      { v: payMoney(m.due), num: true },
      { v: m.net ? payPct(m.paid / m.net * 100) : '–', num: true },
      // month-on-month wears the document's own sign convention: a fall is in
      // brackets like every other negative on the page, never a minus sign
      { v: i === 0 ? 'base' : (mom == null ? '–' : mom < 0 ? '(' + payPct(-mom) + ')' : '+' + payPct(mom)), num: true },
      { v: m.gross ? payPct(m.deds / m.gross * 100) : '–', num: true }
    ];
  });

  return {
    docTitle: payFileName('', first.ym, last.ym),
    brand: payLetterhead(),
    meta: payMetaLines(id, rev),
    onPrint: function () { payRevCommit(id, rev); },
    title: 'Payroll Monthly Register' + (isAll() ? '' : ' — ' + coFull(CID)),
    scope: [
      'Period ' + PR().mLabel(first.ym) + ' – ' + PR().mLabel(last.ym) + ' · ' + months.length +
        ' approved run' + (months.length === 1 ? '' : 's') + ' · ' +
        (isAll() ? 'All Companies (consolidated) — ' + scopeNames() : coFull(CID)),
      'YTD = year to date, ' + PR().mLabel(first.ym) + ' to ' + PR().mLabel(last.ym) + '. Leave encashment is a ' +
        'liability accrued monthly and settled once in December — it is NOT part of Net Payable and is not ' +
        'disbursed with salary.'
    ],
    notice: everyMonth ? null : 'Partial selection — ' + months.length + ' of ' + approvedMonths().length +
      ' approved months. Totals below reflect the selected months only.',
    kpis: [
      { label: 'Total payroll cost, YTD', value: payMoney(cost), sub: 'gross + additions + encashment accrued' },
      { label: 'Cash disbursed, YTD', value: payMoney(T.paid), sub: 'paid out of bank and cash' },
      { label: 'True cost per employee', value: payMoney(perHead), sub: 'per person, per month' },
      { label: 'Deduction rate, YTD', value: T.gross ? payPct(T.deds / T.gross * 100) : '–', sub: 'deductions ÷ gross' },
      { label: 'Payroll liability carried', value: payMoney(T.due + T.deds + encBal), sub: 'unpaid pay + withheld + encashment' }
    ],
    table: {
      groups: [{ span: 3 }, { label: 'Earnings and deductions', span: 4 }, { label: 'Liability accrual', span: 1 },
        { label: 'Settlement', span: 3 }, { label: 'Trend', span: 2 }],
      head: [
        { label: 'Month', width: w[0] }, { label: 'Run', width: w[1] }, { label: 'Employees', num: true, width: w[2] },
        { label: 'Gross', num: true, width: w[3] }, { label: 'Additions', num: true, width: w[4] },
        { label: 'Deductions', num: true, width: w[5] }, { label: 'Net payable', num: true, width: w[6] },
        // the SCREEN's Encash column is that month's movement; the printed one is
        // the balance it had built to, so the header says which
        { label: 'Encashment accrued', sub: 'cumulative', num: true, width: w[7] },
        { label: 'Paid', num: true, width: w[8] }, { label: 'Due', num: true, width: w[9] },
        { label: 'Settled %', num: true, width: w[10] }, { label: 'MoM net', num: true, width: w[11] },
        { label: 'Ded % of gross', num: true, width: w[12] }
      ],
      rows: rows,
      /* THE FOOT. Sums where a sum is the answer; the CLOSING BALANCE for the
       * accrual; a DISTINCT headcount; percentages re-computed from the totals;
       * and a dash for month-on-month, which has no meaning across a period. */
      totals: [
        { v: 'Total — ' + months.length + ' run' + (months.length === 1 ? '' : 's') },
        { v: '' },
        { v: String(heads), num: true },
        { v: payMoney(T.gross), num: true },
        { v: payMoney(T.adds), num: true },
        { v: payBrk(T.deds), num: true },
        { v: payMoney(T.net), num: true },
        { v: payMoney(encBal), num: true, sub: 'cl. bal.' },
        { v: payMoney(T.paid), num: true },
        { v: payMoney(T.due), num: true },
        { v: T.net ? payPct(T.paid / T.net * 100) : '–', num: true },
        { v: '–', num: true },
        { v: T.gross ? payPct(T.deds / T.gross * 100) : '–', num: true }
      ]
    },
    panelPairs: [
      [
        { title: 'Reconciliation — year-to-date control', lines: [
          { k: 'Gross earnings', v: payMoney(T.gross) },
          { k: 'Add: allowances, arrears, bonus', v: payMoney(T.adds) },
          { k: 'Add: leave encashment accrued', v: payMoney(T.encash) },
          { k: 'Total payroll charge to profit & loss', v: payMoney(cost), rule: true },
          { k: 'Less: encashment deferred to December', v: payBrk(T.encash) },
          { k: 'Less: employee deductions withheld', v: payBrk(T.deds) },
          { k: 'Net payable to staff', v: payMoney(T.net), close: true }
        ] },
        { title: 'Liability position at ' + PR().mLabel(last.ym), lines: [
          { k: 'Salary payable — ' + PR().mLabel(last.ym) + ' run', v: payMoney(last.due) },
          { k: 'Deductions withheld, not yet remitted', v: payMoney(T.deds) },
          { k: 'Leave encashment payable, ' + months.length + ' month' + (months.length === 1 ? '' : 's'), v: payMoney(encBal) },
          { k: 'Total payroll liability carried', v: payMoney(last.due + T.deds + encBal), rule: true },
          { k: 'Encashment monthly accrual, flat', v: payMoney(monthly) },
          { k: 'Still to accrue, ' + left + ' month' + (left === 1 ? '' : 's') + ' to December', v: payMoney(monthly * left) }
        ] }
      ],
      [
        { title: 'Cash settlement', lines: [
          { k: 'Net payable to staff', v: payMoney(T.net) },
          { k: 'Less: disbursed by bank and cash', v: payBrk(T.paid) },
          { k: 'Still owed to staff', v: payMoney(T.due), close: true }
        ] },
        { title: 'Encashment obligation', lines: [
          { k: 'Full-year obligation, settles December', v: payMoney(monthly * 12) },
          { k: 'Encashment per employee, full year', v: heads ? payMoney(monthly * 12 / heads) : '–' },
          { k: 'Accrued to date', v: payMoney(encBal) },
          { k: 'Charged to expense monthly, not disbursed', v: payMoney(monthly) }
        ] }
      ]
    ],
    notesTitle: 'Exceptions requiring attention',
    notes: paySummaryNotes(months, T, everyMonth),
    signoff: paySignoff(),
    confidential: 'CONFIDENTIAL — PAYROLL',
    footId: id + ' · Rev ' + (rev < 10 ? '0' + rev : rev) + ' · approved runs only',
    previewTitle: 'Payroll Monthly Register — print preview'
  };
}

/* The exceptions list. HIGH first, then WATCH, then NOTE — and every one of them
 * is a fact already on the desk (the anomaly radar, the run statuses, the
 * selection), never a judgement invented for the page. */
function paySummaryNotes(months, T, everyMonth) {
  var out = [], P = position();
  months.forEach(function (m) {
    if (m.due > 0) out.push({ tag: 'HIGH', text: PR().mLabel(m.ym) + ' is still owed ' + payMoney(m.due) +
      ' of ' + payMoney(m.net) + ' net payable — ' + (m.heads - m.paidHeads) + ' of ' + m.heads + ' staff unpaid.' });
  });
  radar(P).filter(function (r) { return r.sev === 'high'; }).slice(0, 3).forEach(function (r) {
    out.push({ tag: 'HIGH', text: r.title + ' — ' + String(r.why || '').replace(/<[^>]+>/g, '') });
  });
  months.forEach(function (m) {
    if (m.status === 'mixed') out.push({ tag: 'WATCH', text: PR().mLabel(m.ym) +
      ' is not at the same stage in every concern — the run is closed in some and open in others.' });
  });
  if (draftMonthCount()) out.push({ tag: 'WATCH', text: draftMonthCount() + ' month' +
    (draftMonthCount() === 1 ? ' is' : 's are') + ' still in draft and therefore excluded from this report.' });
  if (!everyMonth) out.push({ tag: 'NOTE', text: 'This is a partial selection of the approved months. ' +
    'Every figure above, including the totals row, covers the selected months only.' });
  out.push({ tag: 'NOTE', text: 'Leave encashment is charged to expense each month and credited to Leave ' +
    'Encashment Payable. It is subject to the 12-month service condition, is not part of Net Payable, and the ' +
    'accrued balance settles once, in December.' });
  out.push({ tag: 'NOTE', text: 'Deductions withheld remain a liability of the group until they are remitted to ' +
    'the relevant authority; they are not a reduction in payroll cost. True cost = gross + additions + encashment accrual.' });
  return out;
}

/* ---------------------------------------------------------------------------
 * REPORT 2 — the SALARY REGISTER (one row per employee), a single month
 * ------------------------------------------------------------------------- */
function payDetailReport(ym, slips, allInMonth, pickLabel) {
  var co = isAll();
  var T = { gross: 0, absent: 0, earned: 0, ot: 0, bonus: 0, adj: 0, adds: 0, late: 0, early: 0,
    tax: 0, pf: 0, other: 0, deds: 0, net: 0, paid: 0, due: 0, encash: 0 };
  slips.forEach(function (s) {
    T.gross += s.gross || 0; T.absent += s.absentDeduction || 0; T.earned += s.earnedGross || 0;
    T.ot += s.overtime || 0; T.bonus += bonusOf(s); T.adj += s.adjustment || 0; T.adds += addOf(s);
    T.late += s.lateDeduction || 0; T.early += s.earlyDeduction || 0; T.tax += s.tax || 0; T.pf += s.pf || 0;
    T.other += (s.otherDeduction || 0) + (s.fine || 0); T.deds += dedOf(s); T.net += PR().slipPayable(s);
    T.paid += s.paid || 0; T.due += dueOf(s); T.encash += s.encashAmt || 0;
  });
  var partial = slips.length !== allInMonth.length;
  var id = payReportId('SR', ym), rev = payRev(id);
  /* THE COLUMN COUNT IS A BUDGET, and 273mm of printable width is all there is.
   * An eight-figure taka amount needs ~15mm at 8.5pt, and the spec is explicit
   * that type does not shrink to buy a column — a column goes instead. So:
   *   · the employee ID rides UNDER the name rather than in a column of its own
   *     (it is still printed, on every row, and the name gets the width it needs
   *     to stay on one line);
   *   · the ADDITIONS subtotal is dropped, because its three components —
   *     overtime, bonus and adjustment — are each printed beside it and the
   *     total appears twice more: in the KPI band and in "How the month adds up".
   * Nothing else in the spec's column list is left out. */
  /* Measured, not guessed: an eight-character taka figure at 8.5pt Consolas is
   * 13.2mm and needs ~14.8mm of column, so the fourteen money columns are the
   * fixed cost and the three text columns share what is left — "Nasir Uddin
   * Ahmed" in 28mm, "IT Solutions" and "Construction" in 19mm, both on one line. */
  var w = payWidths(co ? [10.5, 7, 6.6, 5.4, 5.4, 5.4, 5.4, 5.4, 5.4, 5.4, 5.4, 5.4, 5.4, 5.4, 5.8, 5.4, 5.4]
    : [12, 8, 5.5, 5.5, 5.5, 5.5, 5.5, 5.5, 5.5, 5.5, 5.5, 5.5, 5.5, 5.9, 5.5, 5.5]);
  var head = [{ label: 'Employee', sub: 'ID', width: w[0] }]
    .concat(co ? [{ label: 'Company', width: w[1] }] : [])
    .concat([{ label: 'Department' }, { label: 'Gross', num: true }, { label: 'Absent', num: true },
      { label: 'Earned gross', num: true }, { label: 'Overtime', num: true }, { label: 'Bonus', num: true },
      { label: 'Adjustment', num: true }, { label: 'Late', num: true },
      { label: 'Early', num: true }, { label: 'Tax', num: true }, { label: 'PF', num: true },
      { label: 'Other ded.', num: true }, { label: 'Net payable', num: true }, { label: 'Paid', num: true },
      { label: 'Due', num: true }].map(function (h, i) { h.width = w[i + (co ? 2 : 1)]; return h; }));

  var rows = slips.map(function (s) {
    return [{ v: esc(s.empName), strong: true, sub: esc(s.empId) }]
      .concat(co ? [{ v: esc(coShort(s.companyId)) }] : [])
      .concat([
        { v: esc(s.dept || '—') },
        { v: payMoney(s.gross), num: true },
        { v: payBrk(s.absentDeduction), num: true },
        { v: payMoney(s.earnedGross), num: true },
        { v: payMoney(s.overtime), num: true },
        { v: payMoney(bonusOf(s)), num: true },
        { v: payMoney(s.adjustment), num: true },
        { v: payBrk(s.lateDeduction), num: true },
        { v: payBrk(s.earlyDeduction), num: true },
        { v: payBrk(s.tax), num: true },
        { v: payBrk(s.pf), num: true },
        { v: payBrk((s.otherDeduction || 0) + (s.fine || 0)), num: true },
        { v: payMoney(PR().slipPayable(s)), num: true, strong: true },
        { v: payMoney(s.paid), num: true },
        { v: payMoney(dueOf(s)), num: true }
      ]);
  });
  var totals = [{ v: 'Total — ' + slips.length + ' employee' + (slips.length === 1 ? '' : 's') }]
    .concat(co ? [{ v: '' }] : [])
    .concat([{ v: '' },
      { v: payMoney(T.gross), num: true }, { v: payBrk(T.absent), num: true }, { v: payMoney(T.earned), num: true },
      { v: payMoney(T.ot), num: true }, { v: payMoney(T.bonus), num: true }, { v: payMoney(T.adj), num: true },
      { v: payBrk(T.late), num: true }, { v: payBrk(T.early), num: true },
      { v: payBrk(T.tax), num: true }, { v: payBrk(T.pf), num: true }, { v: payBrk(T.other), num: true },
      { v: payMoney(T.net), num: true }, { v: payMoney(T.paid), num: true }, { v: payMoney(T.due), num: true }]);

  /* THE DEPARTMENTAL SUMMARY — the same rows, grouped, so the register can be
   * read by cost centre without adding it up by hand. It foots to the register
   * above by construction: it is built from the very same slips. */
  var byDept = {};
  slips.forEach(function (s) {
    var d = byDept[s.dept || '—'] || (byDept[s.dept || '—'] = { heads: 0, gross: 0, deds: 0, net: 0 });
    d.heads++; d.gross += s.earnedGross || 0; d.deds += dedOf(s); d.net += PR().slipPayable(s);
  });
  var dw = payWidths([34, 12, 18, 18, 18]);
  var deptRows = Object.keys(byDept).sort(function (a, b) { return byDept[b].net - byDept[a].net; })
    .map(function (k) {
      var d = byDept[k];
      return [{ v: esc(k) }, { v: String(d.heads), num: true }, { v: payMoney(d.gross), num: true },
        { v: payBrk(d.deds), num: true }, { v: payMoney(d.net), num: true }];
    });

  return {
    docTitle: payFileName('SalaryRegister', ym, ym),
    brand: payLetterhead(),
    meta: payMetaLines(id, rev),
    onPrint: function () { payRevCommit(id, rev); },
    title: 'Salary Register — ' + PR().mLabel(ym) + (isAll() ? '' : ' · ' + coFull(CID)),
    scope: [
      PR().mLabel(ym) + ' · ' + slips.length + ' employee' + (slips.length === 1 ? '' : 's') + ' · ' +
        (isAll() ? 'All Companies (consolidated) — ' + scopeNames() : coFull(CID)) +
        ' · run ' + cap(runInfo(ym).status),
      'Gross is the contract gross; earned gross is gross less absence, and the net is built from it. Leave ' +
        'encashment accrued this month (' + payMoney(T.encash) + ') is a liability and is NOT part of Net Payable.'
    ],
    /* A partial register SAYS SO, and says WHICH part: "15 of 21 employees,
     * unpaid only" is a document somebody can act on; "15 of 21" leaves the
     * reader to guess which fifteen, and a payroll report that looks complete
     * but is not is a control failure. */
    notice: partial ? 'Partial selection — ' + slips.length + ' of ' + allInMonth.length +
      ' employees' + (pickLabel ? ', ' + pickLabel : '') + '. Totals below reflect the selected rows only.' : null,
    kpis: [
      { label: 'Employees printed', value: String(slips.length), sub: partial ? 'of ' + allInMonth.length + ' in the run' : 'the whole run' },
      { label: 'Gross', value: payMoney(T.earned), sub: 'earned gross, after absence' },
      { label: 'Total deductions', value: payMoney(T.deds), sub: T.earned ? payPct(T.deds / T.earned * 100) + ' of earned gross' : '' },
      { label: 'Net payable', value: payMoney(T.net), sub: payMoney(T.paid) + ' paid · ' + payMoney(T.due) + ' due' }
    ],
    table: { wide: true,          // 17 columns — the gutters give way, not the type
      groups: [{ span: co ? 3 : 2 }, { label: 'Earnings and additions', span: 6 },
        { label: 'Deductions', span: 5 }, { label: 'Settlement', span: 3 }],
      head: head, rows: rows, totals: totals },
    panelPairs: [[
      { title: 'Departmental summary', table: { head: [{ label: 'Department', width: dw[0] },
        { label: 'Staff', num: true, width: dw[1] }, { label: 'Gross', num: true, width: dw[2] },
        { label: 'Deductions', num: true, width: dw[3] }, { label: 'Net payable', num: true, width: dw[4] }],
        rows: deptRows,
        totals: [{ v: 'Total' }, { v: String(slips.length), num: true }, { v: payMoney(T.earned), num: true },
          { v: payBrk(T.deds), num: true }, { v: payMoney(T.net), num: true }] } },
      { title: 'How the month adds up', lines: [
        { k: 'Contract gross', v: payMoney(T.gross) },
        { k: 'Less: absence', v: payBrk(T.absent) },
        { k: 'Earned gross', v: payMoney(T.earned), rule: true },
        { k: 'Add: overtime, bonus and adjustments', v: payMoney(T.adds) },
        { k: 'Less: deductions withheld', v: payBrk(T.deds) },
        { k: 'Net payable', v: payMoney(T.net), rule: true },
        { k: 'Less: paid', v: payBrk(T.paid) },
        { k: 'Still owed', v: payMoney(T.due), close: true }
      ] }
    ]],
    notesTitle: 'Exceptions requiring attention',
    notes: payDetailNotes(ym, slips, partial, allInMonth, pickLabel),
    signoff: paySignoff(),
    confidential: 'CONFIDENTIAL — PAYROLL',
    footId: id + ' · Rev ' + (rev < 10 ? '0' + rev : rev) + ' · approved run only',
    previewTitle: 'Salary Register — print preview'
  };
}

/* ---------------------------------------------------------------------------
 * REPORT 3 — the SALARY DISBURSEMENT SHEET (owner 2026-07-30: "the disbursement
 * sheet — wants a signature column per employee")
 * ---------------------------------------------------------------------------
 * This is the one document on the desk that leaves the building UNFINISHED: it
 * goes out with a blank column and comes back as the receipt, one signature per
 * employee, which is what makes a cash payroll auditable. So it is not the Salary
 * Register with a column bolted on — it carries only what a person handing money
 * over needs, in the order they need it:
 *   a serial to tick down · who · what they are owed · what was taken back ·
 *   what has already been paid · WHAT TO HAND OVER NOW · through which account ·
 *   and the line they sign.
 * The full earnings breakdown belongs to the register (PR-SR); putting it here
 * would push the signature column off the paper.
 *
 * Net payable is ALREADY net of the advance and the loan EMI recovered this month
 * (the engine's slipPayable), so "to hand over" needs no further arithmetic — the
 * Recovered column is printed for the employee's benefit, not the cashier's.
 * ------------------------------------------------------------------------- */
function payDisburseReport(ym, slips, allInMonth, pickLabel) {
  var co = isAll();
  var T = { gross: 0, otb: 0, adv: 0, emi: 0, absent: 0, other: 0, net: 0, paid: 0, due: 0, encash: 0, short: 0 };
  slips.forEach(function (s) {
    T.gross += s.gross || 0; T.otb += (s.overtime || 0) + bonusOf(s); T.adv += advOf(s); T.emi += emiOf(s);
    T.absent += s.absentDeduction || 0; T.other += otherOf(s); T.net += PR().slipPayable(s);
    T.paid += paidOf(s); T.due += dueOf(s); T.encash += s.encashAmt || 0; T.short += shortOf(s);
  });
  var partial = slips.length !== allInMonth.length;
  var id = payReportId('DS', ym), rev = payRev(id);

  /* # · Employee · [Company] · Department · Net payable · Recovered · Paid ·
   * To hand over · Through · Signature — the signature gets the widest column of
   * the lot after the name, because a signature needs room and a number does not. */
  var w = payWidths(co ? [3, 15, 8, 9, 8.5, 8, 8.5, 9, 11, 19.5] : [3, 17, 10, 9, 8, 9, 9.5, 12, 22.5]);
  var head = [{ label: '#', width: w[0] }, { label: 'Employee', sub: 'ID', width: w[1] }]
    .concat(co ? [{ label: 'Company', width: w[2] }] : [])
    .concat([{ label: 'Department' }, { label: 'Net payable', num: true },
      { label: 'Recovered', sub: 'advance + EMI', num: true }, { label: 'Already paid', num: true },
      { label: 'To hand over', num: true }, { label: 'Through' },
      { label: 'Signature', sub: 'and date' }].map(function (h, i) { h.width = w[i + (co ? 3 : 2)]; return h; }));

  var rows = slips.map(function (s, i) {
    var rec = advOf(s) + emiOf(s), out = dueOf(s);
    return [{ v: String(i + 1), num: true }, { v: esc(s.empName), strong: true, sub: esc(s.empId) }]
      .concat(co ? [{ v: esc(coShort(s.companyId)) }] : [])
      .concat([
        { v: esc(s.dept || '—') },
        { v: payMoney(PR().slipPayable(s)), num: true },
        { v: payBrk(rec), num: true },
        { v: payMoney(paidOf(s)), num: true },
        // the figure the money is counted against — the only bold one on the row
        { v: payMoney(out), num: true, strong: true },
        { v: esc(paidOf(s) > 0 ? paidFrom(s.payMethod) : '') },
        { v: '<span class="rp-sigline"></span>' }
      ]);
  });
  var totals = [{ v: '' }, { v: 'Total — ' + slips.length + ' employee' + (slips.length === 1 ? '' : 's') }]
    .concat(co ? [{ v: '' }] : [])
    .concat([{ v: '' }, { v: payMoney(T.net), num: true }, { v: payBrk(T.adv + T.emi), num: true },
      { v: payMoney(T.paid), num: true }, { v: payMoney(T.due), num: true }, { v: '' }, { v: '' }]);

  /* WHERE THE MONEY WENT — the accounts the paid rows actually left through, which
   * is the half of a disbursement sheet the cashier does not have to sign for.
   * Built from the payslips' own payMethod, so it can only name accounts that
   * really carried money this month. */
  var byAcct = {};
  slips.forEach(function (s) {
    if (paidOf(s) <= 0) return;
    var k = paidFrom(s.payMethod) || 'Unstated';
    var a = byAcct[k] || (byAcct[k] = { n: 0, amt: 0 });
    a.n++; a.amt += paidOf(s);
  });
  var acctKeys = Object.keys(byAcct).sort(function (a, b) { return byAcct[b].amt - byAcct[a].amt; });
  var aw = payWidths([52, 16, 32]);

  /* The panel foots to the engine's own net, never to my arithmetic: whatever the
   * six lines above do not explain is the month's adjustments, and naming it is
   * how the panel stays honest. */
  var derived = T.gross + T.otb - T.adv - T.emi - T.absent - T.other;
  var adjust = T.net - derived;

  return {
    docTitle: payFileName('DisbursementSheet', ym, ym),
    brand: payLetterhead(),
    meta: payMetaLines(id, rev),
    onPrint: function () { payRevCommit(id, rev); },
    title: 'Salary Disbursement Sheet — ' + PR().mLabel(ym) + (isAll() ? '' : ' · ' + coFull(CID)),
    scope: [
      PR().mLabel(ym) + ' · ' + slips.length + ' employee' + (slips.length === 1 ? '' : 's') + ' · ' +
        (isAll() ? 'All Companies (consolidated) — ' + scopeNames() : coFull(CID)) +
        ' · run ' + cap(runInfo(ym).status),
      'Each row is signed by the employee when the money is handed over. Net payable is already net of the ' +
        'advance and the loan EMI recovered this month, so "to hand over" is the cash to count out. Leave ' +
        'encashment (' + payMoney(T.encash) + ' accrued) is a liability, is not part of this sheet and is not paid here.'
    ],
    notice: partial ? 'Partial selection — ' + slips.length + ' of ' + allInMonth.length +
      ' employees' + (pickLabel ? ', ' + pickLabel : '') + '. Totals below reflect the selected rows only.' : null,
    kpis: [
      { label: 'Employees on this sheet', value: String(slips.length), sub: partial ? 'of ' + allInMonth.length + ' in the run' : 'the whole run' },
      { label: 'Net payable', value: payMoney(T.net), sub: 'after advance and EMI recovery' },
      { label: 'Already paid', value: payMoney(T.paid), sub: T.net ? payPct(T.paid / T.net * 100) + ' of net payable' : '' },
      { label: 'To hand over', value: payMoney(T.due), sub: slips.filter(function (s) { return dueOf(s) > 0; }).length + ' employees still to be paid' }
    ],
    table: { tall: true, wide: false,
      groups: [{ span: co ? 4 : 3 }, { label: 'What is owed', span: 2 },
        { label: 'Settlement', span: 2 }, { label: 'Received by the employee', span: 2 }],
      head: head, rows: rows, totals: totals },
    panelPairs: [[
      { title: 'How this sheet adds up', lines: [
        { k: 'Gross for the month', v: payMoney(T.gross) },
        { k: 'Add: overtime and bonus', v: payMoney(T.otb) },
        { k: 'Add: adjustments', v: payMoney(adjust) },
        { k: 'Less: advance recovered', v: payBrk(T.adv) },
        { k: 'Less: loan EMI recovered', v: payBrk(T.emi) },
        { k: 'Less: absence', v: payBrk(T.absent) },
        { k: 'Less: tax, PF and other deductions', v: payBrk(T.other) },
        { k: 'Net payable', v: payMoney(T.net), rule: true },
        { k: 'Less: already paid', v: payBrk(T.paid) },
        { k: 'Cash to hand over', v: payMoney(T.due), close: true }
      ] },
      acctKeys.length
        ? { title: 'Paid so far, through which account', table: {
            head: [{ label: 'Account', width: aw[0] }, { label: 'Staff', num: true, width: aw[1] },
              { label: 'Amount', num: true, width: aw[2] }],
            rows: acctKeys.map(function (k) {
              return [{ v: esc(k) }, { v: String(byAcct[k].n), num: true }, { v: payMoney(byAcct[k].amt), num: true }];
            }),
            totals: [{ v: 'Total' }, { v: String(sum(acctKeys, function (k) { return byAcct[k].n; })), num: true },
              { v: payMoney(T.paid), num: true }] } }
        : { title: 'Paid so far, through which account', lines: [
            { k: 'Nothing has been disbursed from this run yet', v: '–' },
            { k: 'Cash to hand over', v: payMoney(T.due), close: true } ] }
    ]],
    notesTitle: 'Before the money is handed over',
    notes: payDisburseNotes(ym, slips, partial, allInMonth, pickLabel, T),
    /* A disbursement sheet is signed by the people who touch the CASH — the
     * register's "Recommended by" is not a step in handing money over. */
    signoff: [{ role: 'Prepared by', name: payUser() }, { role: 'Cash handed over by', name: 'Cashier' },
      { role: 'Checked by', name: 'Accounts' }, { role: 'Approved by', name: 'Managing Director' }],
    confidential: 'CONFIDENTIAL — PAYROLL',
    footId: id + ' · Rev ' + (rev < 10 ? '0' + rev : rev) + ' · signed on receipt',
    previewTitle: 'Salary Disbursement Sheet — print preview'
  };
}

function payDisburseNotes(ym, slips, partial, allInMonth, pickLabel, T) {
  var out = [];
  var unpaid = slips.filter(function (s) { return dueOf(s) > 0; });
  if (unpaid.length) out.push({ tag: 'PAY', text: unpaid.length + ' of ' + slips.length + ' employees are to be paid ' +
    payMoney(T.due) + ' against this sheet. Count each row out against the figure in "to hand over" and take the signature beside it.' });
  else out.push({ tag: 'NOTE', text: 'Every employee on this sheet has been paid in full — it is a receipt record, ' +
    'not a payment instruction.' });
  slips.forEach(function (s) {
    if (shortOf(s) > 0) out.push({ tag: 'WATCH', text: s.empName + ': ' + payMoney(shortOf(s)) +
      ' of this month\'s advance / loan recovery did not fit the pay and stays outstanding — it comes off next month, ' +
      'so do not deduct it in cash here.' });
  });
  if (partial) out.push({ tag: 'NOTE', text: 'Partial selection: ' + slips.length + ' of ' + allInMonth.length +
    ' employees in this run' + (pickLabel ? ' (' + pickLabel + ')' : '') + '. The totals row covers the printed rows only.' });
  out.push({ tag: 'NOTE', text: 'Only approved runs are disbursed against. A signature on this sheet is the ' +
    'employee\'s receipt for the amount in the "to hand over" column of that row, and nothing else.' });
  return out.slice(0, 8);
}

function payDetailNotes(ym, slips, partial, allInMonth, pickLabel) {
  var out = [];
  slips.forEach(function (s) {
    var payable = PR().slipPayable(s);
    if ((s.paid || 0) > payable + 1) out.push({ tag: 'HIGH', text: s.empName + ' was paid ' + payMoney(s.paid) +
      ' against a payslip of ' + payMoney(payable) + ' — ' + payMoney(s.paid - payable) + ' more than the sheet allows.' });
  });
  var unpaid = slips.filter(function (s) { return dueOf(s) > 0; });
  if (unpaid.length) out.push({ tag: 'HIGH', text: unpaid.length + ' of ' + slips.length +
    ' employees are still owed ' + payMoney(sum(unpaid, dueOf)) + ' for ' + PR().mLabel(ym) + '.' });
  slips.forEach(function (s) {
    if ((s.leaveDeductDays || 0) >= 5) out.push({ tag: 'WATCH', text: s.empName + ' was absent ' +
      s.leaveDeductDays + ' days — ' + payMoney(s.absentDeduction) + ' deducted.' });
  });
  if (partial) out.push({ tag: 'NOTE', text: 'Partial selection: ' + slips.length + ' of ' + allInMonth.length +
    ' employees in this run' + (pickLabel ? ' (' + pickLabel + ')' : '') + '. The totals row covers the printed rows only.' });
  out.push({ tag: 'NOTE', text: 'Leave encashment accrues monthly against a 12-month service condition, is ' +
    'charged to expense and credited to Leave Encashment Payable, and settles once in December. It is not ' +
    'part of Net Payable and is not disbursed with this month\'s salary.' });
  return out.slice(0, 8);
}

/* ---------------------------------------------------------------------------
 * REPORT 4 — the STAFF POSITION STATEMENT  (owner 2026-07-30, P4)
 * ---------------------------------------------------------------------------
 * The first document on the desk that is NOT about a month. Staff Accounts is a
 * set of BALANCES — what each person is owed, what they owe back, what has
 * accrued for them — so its report is dated "as at" and has no month to choose,
 * no run to approve and no signature to collect.
 *
 * THE SIGN CONVENTION IS THE WHOLE DOCUMENT: a positive net position is owed BY
 * the group TO the employee; a bracketed one is owed BY the employee. The screen
 * says that in green and red, which a photocopier throws away, so here it is the
 * bracket plus the words under the figure — and the scope line states the rule in
 * one sentence before the reader reaches the first row.
 * ------------------------------------------------------------------------- */
function payStaffReport(rows, allRows, pickLabel) {
  var co = isAll(), asAt = today();
  var T = { salary: 0, salaryDue: 0, advance: 0, loan: 0, emi: 0, encash: 0, net: 0, weOwe: 0, theyOwe: 0 };
  rows.forEach(function (r) {
    T.salary += r.salary; T.salaryDue += r.salaryDue; T.advance += r.advance; T.loan += r.loan;
    T.emi += r.emi; T.encash += r.encash; T.net += r.netDue;
    T.weOwe += Math.max(0, r.netDue); T.theyOwe += Math.max(0, -r.netDue);
  });
  var partial = rows.length !== allRows.length;
  var id = payReportId('SP', asAt.slice(0, 7)), rev = payRev(id);
  var owedTo = T.salaryDue + T.encash, owedBy = T.advance + T.loan;

  var w = payWidths(co ? [3, 14, 7, 11, 8, 8, 8, 8.5, 8.5, 9.5, 6] : [3, 15.5, 12, 8.5, 8.5, 8.5, 9, 9, 10.5, 6]);
  var head = [{ label: '#', width: w[0] }, { label: 'Employee', sub: 'ID', width: w[1] }]
    .concat(co ? [{ label: 'Company', width: w[2] }] : [])
    .concat([{ label: 'Designation', sub: 'department' }, { label: 'Monthly salary', num: true },
      { label: 'Salary due', num: true }, { label: 'Advance out', num: true },
      { label: 'Loan out', sub: 'EMI a month', num: true }, { label: 'Encashment', sub: 'accrued', num: true },
      { label: 'Net position', sub: 'we owe / (they owe)', num: true }, { label: 'Status' }]
      .map(function (h, i) { h.width = w[i + (co ? 3 : 2)]; return h; }));

  var rowCells = rows.map(function (r, i) {
    return [{ v: String(i + 1), num: true }, { v: esc(r.name), strong: true, sub: esc(r.id) }]
      .concat(co ? [{ v: esc(coShort(r.companyId)) }] : [])
      .concat([
        { v: esc(r.designation), sub: esc(r.dept) },
        { v: payMoney(r.salary), num: true },
        { v: payMoney(r.salaryDue), num: true },
        { v: payMoney(r.advance), num: true },
        { v: payMoney(r.loan), num: true, sub: r.emi ? payMoney(r.emi) : '' },
        { v: payMoney(r.encash), num: true, sub: r.encash ? r.encashDays.toFixed(1) + 'd' : '' },
        // signed, and the words carry what the screen says in colour
        { v: payMoney(r.netDue), num: true, strong: true, sub: r.netDue ? (r.netDue > 0 ? 'we owe' : 'they owe') : '' },
        { v: esc(cap(r.status)) }
      ]);
  });
  var totals = [{ v: '' }, { v: 'Total — ' + rows.length + (rows.length === 1 ? ' person' : ' people') }]
    .concat(co ? [{ v: '' }] : [])
    .concat([{ v: '' }, { v: payMoney(T.salary), num: true }, { v: payMoney(T.salaryDue), num: true },
      { v: payMoney(T.advance), num: true }, { v: payMoney(T.loan), num: true, sub: payMoney(T.emi) },
      { v: payMoney(T.encash), num: true },
      { v: payMoney(T.net), num: true, sub: payMoney(T.weOwe) + ' / (' + payMoney(T.theyOwe) + ')' },
      { v: rows.filter(function (r) { return r.status === 'active'; }).length + ' active' }]);

  /* A CUT THAT MEANS SOMETHING: on All Companies the reader wants the position by
   * CONCERN (each one carries its own liability); inside one company they want it
   * by DEPARTMENT. Same five figures either way, footed to the table above. */
  var cutKey = co ? function (r) { return coShort(r.companyId); } : function (r) { return r.dept || '—'; };
  var cuts = {};
  rows.forEach(function (r) {
    var k = cutKey(r), c = cuts[k] || (cuts[k] = { n: 0, salary: 0, to: 0, by: 0 });
    c.n++; c.salary += r.salary; c.to += r.salaryDue + r.encash; c.by += r.advance + r.loan;
  });
  var cutKeys = Object.keys(cuts).sort(function (a, b) { return (cuts[b].to - cuts[b].by) - (cuts[a].to - cuts[a].by); });
  var cw = payWidths([30, 10, 20, 20, 20]);

  return {
    docTitle: payFileName('StaffPosition', asAt.slice(0, 7), asAt.slice(0, 7)),
    brand: payLetterhead(),
    meta: payMetaLines(id, rev),
    onPrint: function () { payRevCommit(id, rev); },
    title: 'Staff Position Statement' + (isAll() ? '' : ' — ' + coFull(CID)),
    scope: [
      'As at ' + ui.date(asAt, 'long') + ' · ' + rows.length + (rows.length === 1 ? ' person' : ' people') + ' · ' +
        (isAll() ? 'All Companies (consolidated) — ' + scopeNames() : coFull(CID)),
      'Net position is signed: a plain figure is owed BY the group TO the employee, a bracketed one is owed by the ' +
        'employee. Leave encashment is an accrued liability that settles in December and is not payable on demand; ' +
        'advances and loans are recovered from future pay, not billed.'
    ],
    notice: partial ? 'Partial selection — ' + rows.length + ' of ' + allRows.length +
      ' people' + (pickLabel ? ', ' + pickLabel : '') + '. Totals below reflect the selected rows only.' : null,
    kpis: [
      { label: 'People on this statement', value: String(rows.length), sub: partial ? 'of ' + allRows.length + ' on the payroll' : 'the whole payroll' },
      { label: 'Monthly payroll', value: payMoney(T.salary), sub: 'contract salary, before movement' },
      { label: 'Owed to staff', value: payMoney(owedTo), sub: 'unpaid salary + encashment accrued' },
      { label: 'Owed by staff', value: payMoney(owedBy), sub: 'advances + loans outstanding' },
      /* THE FIFTH KPI IS THE TABLE'S OWN FOOT, not my arithmetic. The Net position
       * column is the employee LEDGER balance — everything earned and accrued over
       * the whole history, less everything handed over — which is a different
       * question from "current balances, netted", and the two need not agree. A
       * document that printed both under one name would be worse than useless, so
       * the band carries the ledger figure, the panel carries the netting, they are
       * named apart, and a NOTE says why. */
      { label: 'Ledger balance', value: payMoney(T.net),
        sub: payMoney(T.weOwe) + ' we owe · ' + payMoney(T.theyOwe) + ' they owe' }
    ],
    table: { wide: true,
      groups: [{ span: co ? 4 : 3 }, { label: 'Pay', span: 2 },
        { label: 'Recoverable from the employee', span: 2 }, { label: 'Accrued for the employee', span: 1 },
        { label: 'Position', span: 2 }],
      head: head, rows: rowCells, totals: totals },
    panelPairs: [[
      { title: 'What each side is owed, today', lines: [
        { k: 'Unpaid salary', v: payMoney(T.salaryDue) },
        { k: 'Leave encashment accrued', v: payMoney(T.encash) },
        { k: 'Owed to staff', v: payMoney(owedTo), rule: true },
        { k: 'Advances outstanding', v: payBrk(T.advance) },
        { k: 'Loans outstanding', v: payBrk(T.loan) },
        { k: 'Owed by staff', v: payBrk(owedBy), rule: true },
        { k: 'Owed to staff, less recoverables', v: payMoney(owedTo - owedBy), close: true },
        { k: 'Recoverable next month at current EMI', v: payMoney(T.emi) }
      ] },
      { title: co ? 'By concern' : 'By department', table: {
        head: [{ label: co ? 'Concern' : 'Department', width: cw[0] }, { label: 'Staff', num: true, width: cw[1] },
          { label: 'Monthly salary', num: true, width: cw[2] }, { label: 'Owed to', num: true, width: cw[3] },
          { label: 'Owed by', num: true, width: cw[4] }],
        rows: cutKeys.map(function (k) {
          return [{ v: esc(k) }, { v: String(cuts[k].n), num: true }, { v: payMoney(cuts[k].salary), num: true },
            { v: payMoney(cuts[k].to), num: true }, { v: payBrk(cuts[k].by), num: true }];
        }),
        totals: [{ v: 'Total' }, { v: String(rows.length), num: true }, { v: payMoney(T.salary), num: true },
          { v: payMoney(owedTo), num: true }, { v: payBrk(owedBy), num: true }] } }
    ]],
    notesTitle: 'Exceptions requiring attention',
    notes: payStaffNotes(rows, partial, allRows, pickLabel),
    signoff: [{ role: 'Prepared by', name: payUser() }, { role: 'Checked by', name: 'Accounts' },
      { role: 'Verified by', name: 'Head of HR & Admin' }, { role: 'Approved by', name: 'Managing Director' }],
    confidential: 'CONFIDENTIAL — PAYROLL',
    footId: id + ' · Rev ' + (rev < 10 ? '0' + rev : rev) + ' · balances as at ' + ui.date(asAt),
    previewTitle: 'Staff Position Statement — print preview'
  };
}

function payStaffNotes(rows, partial, allRows, pickLabel) {
  var out = [];
  /* A LEAVER STILL CARRYING A BALANCE is the one exception on this statement that
   * cannot wait: after the last payslip there is no pay left to recover from. */
  rows.forEach(function (r) {
    if (r.status !== 'active' && (r.advance > 0 || r.loan > 0)) out.push({ tag: 'HIGH', text: r.name +
      ' is ' + r.status + ' and still owes ' + payMoney(r.advance + r.loan) + ' (advance ' + payMoney(r.advance) +
      ' · loan ' + payMoney(r.loan) + '). There is no further pay to recover it from.' });
  });
  rows.forEach(function (r) {
    if (r.status !== 'active' && r.netDue > 0) out.push({ tag: 'HIGH', text: r.name + ' is ' + r.status +
      ' and is still owed ' + payMoney(r.netDue) + ' — a final settlement closes it.' });
  });
  rows.forEach(function (r) {
    if (r.advance > 0 && r.salary > 0 && r.advance > r.salary) out.push({ tag: 'WATCH', text: r.name +
      ' holds an advance of ' + payMoney(r.advance) + ' against a ' + payMoney(r.salary) +
      ' salary — it cannot clear in one payslip.' });
  });
  rows.forEach(function (r) {
    if (r.loan > 0 && !r.emi) out.push({ tag: 'WATCH', text: r.name + ' owes ' + payMoney(r.loan) +
      ' with no EMI set, so nothing is being recovered each month.' });
  });
  rows.forEach(function (r) { if (!r.salary) out.push({ tag: 'WATCH', text: r.name +
    ' has no salary on record, so no payslip can be generated for them.' }); });
  if (partial) out.push({ tag: 'NOTE', text: 'Partial selection: ' + rows.length + ' of ' + allRows.length +
    ' people on the payroll' + (pickLabel ? ' (' + pickLabel + ')' : '') + '. The totals row covers the printed rows only.' });
  /* THE TWO FIGURES A READER WILL COMPARE. Print the reason they differ before
   * somebody decides one of them is a bug. */
  out.push({ tag: 'NOTE', text: 'The Net position column is the employee\'s LEDGER balance — everything earned and ' +
    'accrued over their whole history, less everything handed over. The panel beside it nets only TODAY\'S balances: ' +
    'unpaid salary and encashment accrued against advances and loans outstanding. The two answer different questions ' +
    'and are not expected to agree.' });
  out.push({ tag: 'NOTE', text: 'Advances and loans are recovered from future pay, capped at what each month can ' +
    'bear; leave encashment accrues monthly against a 12-month service condition and settles in December.' });
  return out.slice(0, 9);
}

/* ---------------------------------------------------------------------------
 * REPORT 6 — the ADVANCE REGISTER  (owner 2026-07-30, P6)
 * ---------------------------------------------------------------------------
 * Per PERSON, not per transaction — and that is the difference from the loan book.
 * A loan is a thing with a plan and a maturity, so the book is one row per loan. An
 * advance is not: it is money against pay not yet earned, taken as often as the
 * boss allows and recovered whole from the very next payslip. The question is
 * therefore always "who is holding what, and what comes back next month".
 *
 * The row set is everyone who has EVER taken one, so a register that shows a
 * cleared advance still shows the person — the history is the point of a register.
 * ------------------------------------------------------------------------- */
function advanceRows() {
  var out = [];
  team().forEach(function (e) {
    var mine = S.list('pay_txns').filter(function (x) { return x.empId === e.id && x.type === 'advance'; })
      .sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    if (!mine.length) return;                       // never taken one → not on the register
    var given = sum(mine, function (x) { return +x.amount || 0; });
    var out2 = PR().advanceOutstanding(e.id);
    var slip = PR().slip(e.id, PR().curYm());
    out.push({ id: e.id, emp: e, name: e.name, companyId: e.companyId, dept: e.dept || '—',
      designation: e.designation || '—', status: e.status || 'active', salary: +e.salary || 0,
      given: given, taken: mine.length, last: mine[0].date, out: out2, back: Math.max(0, given - out2),
      // what the CURRENT month's payslip is actually taking back, if there is one
      nextBack: slip ? advOf(slip) : 0, hasSlip: !!slip,
      months: mine.map(function (x) { return String(x.memo || ''); }).join(' · ') });
  });
  return out.sort(function (a, b) { return b.out - a.out || (a.name < b.name ? -1 : 1); });
}

function payAdvanceReport(rows, allRows, pickLabel) {
  var co = isAll(), asAt = today();
  var T = { given: 0, back: 0, out: 0, nextBack: 0, taken: 0 };
  rows.forEach(function (r) {
    T.given += r.given; T.back += r.back; T.out += r.out; T.nextBack += r.nextBack; T.taken += r.taken;
  });
  var holding = rows.filter(function (r) { return r.out > 0; });
  var partial = rows.length !== allRows.length;
  var id = payReportId('AR', asAt.slice(0, 7)), rev = payRev(id);
  var reqs = (PR().advRequests({}) || []).filter(function (r) { return inScope(r.companyId); });
  function reqCut(st) { return reqs.filter(function (r) { return r.status === st; }); }

  var w = payWidths(co ? [3, 15, 7.5, 10, 8.5, 8, 9, 9, 10, 10] : [3, 16, 11, 9.5, 9, 9.5, 9.5, 11, 11.5]);
  var head = [{ label: '#', width: w[0] }, { label: 'Employee', sub: 'ID', width: w[1] }]
    .concat(co ? [{ label: 'Company', width: w[2] }] : [])
    .concat([{ label: 'Designation', sub: 'department' }, { label: 'Monthly salary', num: true },
      { label: 'Advances', sub: 'times taken', num: true }, { label: 'Given', sub: 'all time', num: true },
      { label: 'Recovered', num: true }, { label: 'Outstanding', num: true },
      /* NOT "coming back": on a month already paid this figure is what the payslip
       * ALREADY took, and on an unpaid one it is what the run plans to take. One
       * column, two tenses, so the label says both rather than picking the wrong one. */
      { label: 'This month', sub: 'recovered or planned', num: true }]
      .map(function (h, i) { h.width = w[i + (co ? 3 : 2)]; return h; }));

  var rowCells = rows.map(function (r, i) {
    return [{ v: String(i + 1), num: true }, { v: esc(r.name), strong: true, sub: esc(r.id) }]
      .concat(co ? [{ v: esc(coShort(r.companyId)) }] : [])
      .concat([
        { v: esc(r.designation), sub: esc(r.dept) },
        { v: payMoney(r.salary), num: true },
        { v: String(r.taken), num: true, sub: 'last ' + ui.date(r.last) },
        { v: payMoney(r.given), num: true },
        { v: payMoney(r.back), num: true, sub: r.given ? Math.round(r.back / r.given * 100) + '%' : '' },
        { v: payMoney(r.out), num: true, strong: true },
        /* THE FIGURE FIRST, always — an advance cleared BY this month's payslip has
         * nothing outstanding and everything to do with this column, and hiding it
         * behind the outstanding test made the column stop footing to its own
         * total. "no run" only when there is a balance and no payslip to take it. */
        { v: r.nextBack ? payMoney(r.nextBack) : (r.out > 0 && !r.hasSlip ? 'no run' : '–'), num: true }
      ]);
  });
  var totals = [{ v: '' }, { v: 'Total — ' + rows.length + (rows.length === 1 ? ' person' : ' people') }]
    .concat(co ? [{ v: '' }] : [])
    .concat([{ v: '' }, { v: payMoney(sum(rows, function (r) { return r.salary; })), num: true },
      { v: String(T.taken), num: true }, { v: payMoney(T.given), num: true },
      { v: payMoney(T.back), num: true, sub: T.given ? Math.round(T.back / T.given * 100) + '%' : '' },
      { v: payMoney(T.out), num: true, sub: holding.length + ' holding' },
      { v: payMoney(T.nextBack), num: true }]);

  var aw = payWidths([44, 18, 38]);
  return {
    docTitle: payFileName('AdvanceRegister', asAt.slice(0, 7), asAt.slice(0, 7)),
    brand: payLetterhead(),
    meta: payMetaLines(id, rev),
    onPrint: function () { payRevCommit(id, rev); },
    title: 'Advance Salary Register' + (isAll() ? '' : ' — ' + coFull(CID)),
    scope: [
      'As at ' + ui.date(asAt, 'long') + ' · ' + rows.length + (rows.length === 1 ? ' person' : ' people') +
        ' · ' + holding.length + ' still holding an advance · ' +
        (isAll() ? 'All Companies (consolidated) — ' + scopeNames() : coFull(CID)),
      'An advance is pay not yet earned. It is recovered from the very next payslip in full, capped at what that ' +
        'month can bear — so an advance bigger than a month\'s salary cannot clear in one run. No interest is charged.'
    ],
    notice: partial ? 'Partial selection — ' + rows.length + ' of ' + allRows.length +
      ' people' + (pickLabel ? ', ' + pickLabel : '') + '. Totals below reflect the selected rows only.' : null,
    kpis: [
      { label: 'On this register', value: String(rows.length), sub: holding.length + ' still holding · ' + T.taken + ' advances taken' },
      { label: 'Given', value: payMoney(T.given), sub: 'all time' },
      { label: 'Recovered', value: payMoney(T.back), sub: T.given ? payPct(T.back / T.given * 100) + ' of everything advanced' : '' },
      { label: 'Outstanding', value: payMoney(T.out), sub: 'to come off future pay' },
      { label: 'Recovery this month', value: payMoney(T.nextBack), sub: PR().mLabel(PR().curYm()) + '\'s payslips, recovered or planned' }
    ],
    table: { wide: true,
      groups: [{ span: co ? 4 : 3 }, { label: 'The person', span: 1 },
        { label: 'Advanced', span: 2 }, { label: 'Recovery', span: 3 }],
      head: head, rows: rowCells, totals: totals },
    panelPairs: [[
      /* A RECONCILIATION, and this month's recovery is CONTEXT inside it, not a
       * further subtraction: whatever the current payslip has taken is already
       * inside "recovered from pay", so deducting it again would understate the
       * outstanding by exactly one month. */
      { title: 'The advance book, both ways', lines: [
        { k: 'Advanced, all time', v: payMoney(T.given) },
        { k: 'Recovered from pay', v: payBrk(T.back) },
        { k: 'Outstanding', v: payMoney(T.out), close: true },
        { k: 'of which, ' + PR().mLabel(PR().curYm()) + '\'s payslips account for', v: payMoney(T.nextBack) },
        { k: 'Advances taken, all time', v: String(T.taken) }
      ] },
      { title: 'Requests, and what was decided', table: {
        head: [{ label: 'Status', width: aw[0] }, { label: 'Requests', num: true, width: aw[1] },
          { label: 'Amount', num: true, width: aw[2] }],
        rows: [['pending', 'Waiting on a decision'], ['approved', 'Approved'], ['rejected', 'Declined']]
          .map(function (p) {
            var list = reqCut(p[0]);
            var amt = p[0] === 'approved'
              ? sum(list, function (r) { return r.approvedAmount || 0; })
              : sum(list, function (r) { return r.amount || 0; });
            return [{ v: p[1] }, { v: String(list.length), num: true }, { v: payMoney(amt), num: true }];
          }),
        // the approved figure is what was APPROVED, the others what was ASKED —
        // so the column has no meaningful total and says so instead
        totals: [{ v: 'All requests raised' }, { v: String(reqs.length), num: true }, { v: '–' }] } }
    ]],
    notesTitle: 'Exceptions requiring attention',
    notes: payAdvanceNotes(rows, holding, partial, allRows, pickLabel, reqCut('pending')),
    signoff: [{ role: 'Prepared by', name: payUser() }, { role: 'Checked by', name: 'Accounts' },
      { role: 'Verified by', name: 'Head of HR & Admin' }, { role: 'Approved by', name: 'Managing Director' }],
    confidential: 'CONFIDENTIAL — PAYROLL',
    footId: id + ' · Rev ' + (rev < 10 ? '0' + rev : rev) + ' · balances as at ' + ui.date(asAt),
    previewTitle: 'Advance Salary Register — print preview'
  };
}

function payAdvanceNotes(rows, holding, partial, allRows, pickLabel, pending) {
  var out = [];
  holding.forEach(function (r) {
    if (r.status !== 'active') out.push({ tag: 'HIGH', text: r.name + ' is ' + r.status + ' and still holds ' +
      payMoney(r.out) + ' of advance. The payslip that would have recovered it has stopped.' });
  });
  holding.forEach(function (r) {
    if (r.salary > 0 && r.out > r.salary) out.push({ tag: 'HIGH', text: r.name + ' holds ' + payMoney(r.out) +
      ' against a ' + payMoney(r.salary) + ' salary — more than a month\'s pay, so it cannot clear in one run.' });
  });
  holding.forEach(function (r) {
    if (r.out > 0 && !r.hasSlip) out.push({ tag: 'WATCH', text: r.name + ' has ' + payMoney(r.out) +
      ' outstanding but no payslip in ' + PR().mLabel(PR().curYm()) + ' — nothing is recovering it this month.' });
  });
  holding.forEach(function (r) {
    if (r.hasSlip && r.out > 0 && r.nextBack <= 0) out.push({ tag: 'WATCH', text: r.name + ': ' + payMoney(r.out) +
      ' outstanding, but this month\'s payslip is recovering nothing — the pay could not bear it, or the recovery was capped to zero.' });
  });
  if (pending.length) out.push({ tag: 'NOTE', text: pending.length + ' advance request' +
    (pending.length === 1 ? '' : 's') + ' worth ' + payMoney(sum(pending, function (r) { return r.amount; })) +
    ' are still waiting on a decision and are NOT included above — an ask is not an advance.' });
  if (partial) out.push({ tag: 'NOTE', text: 'Partial selection: ' + rows.length + ' of ' + allRows.length +
    ' people on the register' + (pickLabel ? ' (' + pickLabel + ')' : '') + '. The totals row covers the printed rows only.' });
  out.push({ tag: 'NOTE', text: 'Recovery comes off the next payslip automatically and is capped at what that month ' +
    'can bear; whatever does not fit stays outstanding and comes off the month after.' });
  return out.slice(0, 9);
}

/* THE ADVANCE REGISTER PICKER — same shape as the loan and staff pickers. */
function advancePrintCentre() {
  var rows = advanceRows();
  if (!rows.length) { ui.toast('No advance has been given yet', 'warn'); return; }
  var pick = {}, q = '', pickWas = null;
  rows.forEach(function (r) { pick[r.id] = true; });
  function chosen() { return rows.filter(function (r) { return pick[r.id]; }); }

  var body = el('div.pay-print'), rowHost = el('div.pay-print-rows'), rCount = el('div.pay-print-count');
  var searchIn = el('input.input', { placeholder: 'Search name, ID or department…',
    oninput: ui.debounce(function () { q = searchIn.value.toLowerCase(); drawRows(); }, 120) });
  var goBtn = null;

  body.appendChild(el('div.pay-print-step', null, [
    el('div.pay-print-h', { text: '1 · Scope and date' }),
    el('div.pay-print-scope', null, [
      el('div', null, [ el('strong', { text: scopeFull() }),
        el('div.text-mute.sm', { text: 'balances as at ' + ui.date(today(), 'long') +
          ' · report id ' + payReportId('AR', today().slice(0, 7)) }) ]),
      el('button.btn.btn-sm.btn-ghost', { html: ui.icon('arrow-left-right') + ' Change company',
        onclick: function () { m.close(); ui.toast('Pick the company from the switcher above, then print again', 'info'); } })
    ])
  ]));

  function drawRows() {
    rowHost.innerHTML = '';
    var shown = rows.filter(function (r) {
      if (!q) return true;
      return (r.name + ' ' + r.id + ' ' + r.dept + ' ' + r.designation).toLowerCase().indexOf(q) >= 0;
    });
    shown.forEach(function (r) {
      var cb = el('input', { type: 'checkbox', checked: pick[r.id] ? 'checked' : null,
        onchange: function () { pick[r.id] = cb.checked; pickWas = null; syncCounts(); } });
      rowHost.appendChild(el('label.pay-print-row', null, [ cb,
        el('span.pay-print-row-n', { text: r.name }),
        isAll() ? el('span.badge', { text: coShort(r.companyId) }) : null,
        el('span.text-mute.xs', { text: r.taken + (r.taken === 1 ? ' advance' : ' advances') }),
        r.status !== 'active' ? el('span.badge.badge-bad', { text: cap(r.status) }) : null,
        el('span.pay-print-row-v', { text: r.out > 0 ? ui.money(r.out) + ' out' : 'cleared' })
      ].filter(Boolean)));
    });
    if (!shown.length) rowHost.appendChild(el('div.text-mute.sm', { text: 'Nobody matches “' + q + '”.' }));
  }
  function only(fn, label) { rows.forEach(function (r) { pick[r.id] = !!fn(r); }); pickWas = label || null; drawRows(); syncCounts(); }
  function add(fn) { rows.forEach(function (r) { if (fn(r)) pick[r.id] = true; }); pickWas = null; drawRows(); syncCounts(); }
  var byCoSel = el('select.select', { onchange: function () {
    var v = byCoSel.value; if (v !== '__') add(function (r) { return r.companyId === v; }); byCoSel.value = '__'; } });
  (function fill() {
    var cos = {};
    rows.forEach(function (r) { cos[r.companyId] = 1; });
    byCoSel.appendChild(el('option', { value: '__', text: 'Add by company…' }));
    Object.keys(cos).sort().forEach(function (c) { byCoSel.appendChild(el('option', { value: c, text: coShort(c) })); });
    byCoSel.style.display = isAll() ? '' : 'none';
  })();

  body.appendChild(el('div.pay-print-step', null, [
    el('div.pay-print-h', { text: '2 · Who is on the register' }),
    el('div.pay-print-bulk', null, [ searchIn,
      el('button.btn.btn-sm.btn-ghost', { text: 'Everyone', onclick: function () { only(function () { return true; }, null); } }),
      el('button.btn.btn-sm.btn-ghost', { text: 'Clear all', onclick: function () { only(function () { return false; }, null); } }),
      el('button.btn.btn-sm.btn-ghost', { html: ui.icon('cash') + ' Only still holding',
        onclick: function () { only(function (r) { return r.out > 0; }, 'people still holding an advance only'); } }),
      el('button.btn.btn-sm.btn-ghost', { html: ui.icon('exclamation-circle') + ' Only over a month\'s pay',
        title: 'Advances bigger than the salary they are recovered from — they cannot clear in one run',
        onclick: function () { only(function (r) { return r.out > 0 && r.salary > 0 && r.out > r.salary; }, 'advances over a month\'s pay only'); } }),
      byCoSel ]),
    rowHost, rCount
  ]));

  function syncCounts() {
    var sel = chosen();
    rCount.textContent = sel.length + ' of ' + rows.length + (rows.length === 1 ? ' person' : ' people') +
      ' selected' + (pickWas ? ' · ' + pickWas : '') + ' · outstanding ' +
      ui.money(sum(sel, function (r) { return r.out; }));
    if (goBtn) { goBtn.disabled = !sel.length; goBtn.style.opacity = sel.length ? 1 : .5; }
  }

  var m = ui.modal({
    title: 'Print the advance register — ' + scopeShort(), icon: 'printer', size: 'lg', body: body,
    actions: [
      { label: 'Cancel', onClick: function () {} },
      { label: 'Preview', icon: 'eye', variant: 'primary', onClick: function () {
          var sel = chosen();
          if (!sel.length) { ui.toast('Tick at least one person', 'error'); return false; }
          EPAL.report.open(payAdvanceReport(sel, rows, pickWas));
        } }
    ]
  });
  goBtn = m.box.querySelector('.modal-foot .btn-primary');
  drawRows(); syncCounts();
  return m;
}

/* ---------------------------------------------------------------------------
 * REPORT 5 — the LOAN BOOK  (owner 2026-07-30, P5)
 * ---------------------------------------------------------------------------
 * One row per LOAN, not per person: "how much of the ৳20,000 taken in May is
 * left" is a question about a loan, and a person can hold three of them. Dated
 * "as at", like the staff statement, because a loan book is a set of balances.
 *
 * The column that makes it a BOOK rather than a list is "months to clear": at the
 * EMI actually set, when does this debt end? A loan with no EMI plan has no
 * answer, and that is exactly the row a reader needs to see — so it prints
 * "no plan" and the same loan is named again in the exceptions.
 * ------------------------------------------------------------------------- */
function payLoanReport(loans, allLoans, pickLabel) {
  var co = isAll(), asAt = today();
  var T = { principal: 0, paid: 0, due: 0, emi: 0, viaSalary: 0, viaCash: 0 };
  loans.forEach(function (L) {
    T.principal += L.principal || 0; T.paid += L.paid || 0; T.due += L.due || 0;
    T.viaSalary += L.viaSalary || 0; T.viaCash += L.viaCash || 0;
    if (!L.closed) T.emi += +L.emi || 0;
  });
  var open = loans.filter(function (L) { return !L.closed; });
  var noPlan = open.filter(function (L) { return !(+L.emi > 0); });
  var partial = loans.length !== allLoans.length;
  var id = payReportId('LB', asAt.slice(0, 7)), rev = payRev(id);
  // months to clear the WHOLE open book at the EMI currently scheduled
  var bookMonths = T.emi > 0 ? Math.ceil(sum(open, function (L) { return L.due; }) / T.emi) : null;

  var w = payWidths(co ? [3, 14, 7, 9.5, 9, 9, 9, 8.5, 8, 12, 8] : [3, 15, 10, 9.5, 9.5, 9.5, 9, 8.5, 13, 8.5]);
  var head = [{ label: '#', width: w[0] }, { label: 'Employee', sub: 'ID', width: w[1] }]
    .concat(co ? [{ label: 'Company', width: w[2] }] : [])
    .concat([{ label: 'Taken on', sub: 'EMI plan' }, { label: 'Principal', num: true },
      { label: 'Repaid', num: true }, { label: 'Still due', num: true },
      { label: 'EMI a month', num: true }, { label: 'Months to clear', num: true },
      { label: 'Repaid via' }, { label: 'Status' }]
      .map(function (h, i) { h.width = w[i + (co ? 3 : 2)]; return h; }));

  var rowCells = loans.map(function (L, i) {
    var months = L.closed ? '–' : (+L.emi > 0 ? String(Math.ceil(L.due / L.emi)) : 'no plan');
    var via = [];
    if (L.viaSalary > 0) via.push('salary ' + payMoney(L.viaSalary));
    if (L.viaCash > 0) via.push('cash ' + payMoney(L.viaCash));
    return [{ v: String(i + 1), num: true }, { v: esc(L.empName), strong: true, sub: esc(L.empId) }]
      .concat(co ? [{ v: esc(coShort(L.companyId)) }] : [])
      .concat([
        { v: esc(ui.date(L.date)), sub: L.emiMonths ? L.emiMonths + '-month plan' : 'no plan' },
        { v: payMoney(L.principal), num: true },
        { v: payMoney(L.paid), num: true, sub: L.principal ? loanPct(L) + '%' : '' },
        { v: payMoney(L.due), num: true, strong: true },
        { v: payMoney(L.emi), num: true },
        { v: months, num: true },
        { v: via.length ? esc(via.join(' · ')) : '–' },
        { v: L.closed ? 'Cleared' : 'Running' }
      ]);
  });
  var totals = [{ v: '' }, { v: 'Total — ' + loans.length + (loans.length === 1 ? ' loan' : ' loans') }]
    .concat(co ? [{ v: '' }] : [])
    .concat([{ v: '' }, { v: payMoney(T.principal), num: true }, { v: payMoney(T.paid), num: true },
      { v: payMoney(T.due), num: true }, { v: payMoney(T.emi), num: true },
      // NOT a sum of the column: the book's own runway at the scheduled EMI
      { v: bookMonths == null ? '–' : String(bookMonths), num: true, sub: 'at this EMI' },
      { v: 'salary ' + payMoney(T.viaSalary) + ' · cash ' + payMoney(T.viaCash) },
      { v: open.length + ' running · ' + (loans.length - open.length) + ' cleared' }]);

  /* THE AGE OF THE DEBT — a book is judged by how old its outstanding money is,
   * and nothing else on the desk answers it. Buckets by when the loan was taken. */
  var buckets = [['Taken this year', 0, 12], ['1 to 2 years old', 12, 24], ['Over 2 years old', 24, 1e4]];
  var nowMs = new Date(asAt).getTime();
  function ageMonths(L) { return Math.max(0, Math.round((nowMs - new Date(L.date).getTime()) / 2629800000)); }
  var bw = payWidths([40, 14, 23, 23]);
  var bucketRows = buckets.map(function (b) {
    var inB = open.filter(function (L) { var a = ageMonths(L); return a >= b[1] && a < b[2]; });
    return [{ v: b[0] }, { v: String(inB.length), num: true },
      { v: payMoney(sum(inB, function (L) { return L.principal; })), num: true },
      { v: payMoney(sum(inB, function (L) { return L.due; })), num: true }];
  });

  return {
    docTitle: payFileName('LoanBook', asAt.slice(0, 7), asAt.slice(0, 7)),
    brand: payLetterhead(),
    meta: payMetaLines(id, rev),
    onPrint: function () { payRevCommit(id, rev); },
    title: 'Staff Loan Book' + (isAll() ? '' : ' — ' + coFull(CID)),
    scope: [
      'As at ' + ui.date(asAt, 'long') + ' · ' + loans.length + (loans.length === 1 ? ' loan' : ' loans') +
        ' · ' + open.length + ' still running · ' +
        (isAll() ? 'All Companies (consolidated) — ' + scopeNames() : coFull(CID)),
      'A staff loan is interest-free and recovered from pay at the EMI set when it was disbursed, capped each month ' +
        'at what the salary can bear; a repayment can also be handed in as cash. "Months to clear" is what the ' +
        'CURRENT EMI implies, not a contractual maturity.'
    ],
    notice: partial ? 'Partial selection — ' + loans.length + ' of ' + allLoans.length +
      ' loans' + (pickLabel ? ', ' + pickLabel : '') + '. Totals below reflect the selected rows only.' : null,
    kpis: [
      { label: 'Loans on this book', value: String(loans.length), sub: open.length + ' running · ' + (loans.length - open.length) + ' cleared' },
      { label: 'Disbursed', value: payMoney(T.principal), sub: 'principal, all time' },
      { label: 'Repaid', value: payMoney(T.paid), sub: T.principal ? payPct(T.paid / T.principal * 100) + ' of what was lent' : '' },
      { label: 'Outstanding', value: payMoney(T.due), sub: 'still recoverable from staff' },
      { label: 'Scheduled EMI', value: payMoney(T.emi), sub: bookMonths == null ? 'no EMI set on the open book' : 'clears the book in about ' + bookMonths + ' months' }
    ],
    table: { wide: true,
      groups: [{ span: co ? 4 : 3 }, { label: 'The loan', span: 3 },
        { label: 'Recovery', span: 3 }, { label: '', span: 1 }],
      head: head, rows: rowCells, totals: totals },
    panelPairs: [[
      { title: 'The book, both ways', lines: [
        { k: 'Disbursed, all time', v: payMoney(T.principal) },
        { k: 'Recovered from salary', v: payBrk(T.viaSalary) },
        { k: 'Recovered as cash or bank', v: payBrk(T.viaCash) },
        { k: 'Outstanding', v: payMoney(T.due), rule: true },
        { k: 'EMI scheduled a month', v: payMoney(T.emi) },
        { k: 'Loans with no EMI plan', v: noPlan.length ? String(noPlan.length) + ' · ' + payMoney(sum(noPlan, function (L) { return L.due; })) : '–' },
        { k: bookMonths == null ? 'Runway at current EMI' : 'Clears in about', v: bookMonths == null ? 'not recoverable on a schedule' : bookMonths + ' months', close: true }
      ] },
      { title: 'How old the outstanding money is', table: {
        head: [{ label: 'Taken', width: bw[0] }, { label: 'Loans', num: true, width: bw[1] },
          { label: 'Principal', num: true, width: bw[2] }, { label: 'Still due', num: true, width: bw[3] }],
        rows: bucketRows,
        totals: [{ v: 'Running loans' }, { v: String(open.length), num: true },
          { v: payMoney(sum(open, function (L) { return L.principal; })), num: true },
          { v: payMoney(sum(open, function (L) { return L.due; })), num: true }] } }
    ]],
    notesTitle: 'Exceptions requiring attention',
    notes: payLoanNotes(loans, open, noPlan, partial, allLoans, pickLabel, ageMonths),
    signoff: [{ role: 'Prepared by', name: payUser() }, { role: 'Checked by', name: 'Accounts' },
      { role: 'Verified by', name: 'Head of HR & Admin' }, { role: 'Approved by', name: 'Managing Director' }],
    confidential: 'CONFIDENTIAL — PAYROLL',
    footId: id + ' · Rev ' + (rev < 10 ? '0' + rev : rev) + ' · balances as at ' + ui.date(asAt),
    previewTitle: 'Staff Loan Book — print preview'
  };
}

function payLoanNotes(loans, open, noPlan, partial, allLoans, pickLabel, ageMonths) {
  var out = [];
  /* A LEAVER WITH A RUNNING LOAN is the one that cannot wait: the recovery route
   * is the payslip, and there are no more payslips. */
  open.forEach(function (L) {
    var st = L.emp ? (L.emp.status || 'active') : 'active';
    if (st !== 'active') out.push({ tag: 'HIGH', text: L.empName + ' is ' + st + ' and still owes ' +
      payMoney(L.due) + ' on the loan taken ' + ui.date(L.date) + '. Salary recovery has ended — settle it separately.' });
  });
  noPlan.forEach(function (L) {
    out.push({ tag: 'HIGH', text: L.empName + ': ' + payMoney(L.due) + ' outstanding with NO EMI plan, so nothing ' +
      'is recovered from pay each month. Set an instalment or it stays where it is.' });
  });
  open.forEach(function (L) {
    if (+L.emi > 0 && L.due / L.emi > 24) out.push({ tag: 'WATCH', text: L.empName + '\'s loan runs past two years — ' +
      payMoney(L.due) + ' at ' + payMoney(L.emi) + ' a month is ' + Math.ceil(L.due / L.emi) + ' more instalments.' });
  });
  open.forEach(function (L) {
    if (ageMonths(L) >= 24) out.push({ tag: 'WATCH', text: L.empName + '\'s loan was taken ' + ui.date(L.date) +
      ' — over two years ago — and ' + payMoney(L.due) + ' is still outstanding.' });
  });
  open.forEach(function (L) {
    if (!L.paid) out.push({ tag: 'WATCH', text: L.empName + ': nothing has been repaid on the ' +
      payMoney(L.principal) + ' taken ' + ui.date(L.date) + '.' });
  });
  if (partial) out.push({ tag: 'NOTE', text: 'Partial selection: ' + loans.length + ' of ' + allLoans.length +
    ' loans in the book' + (pickLabel ? ' (' + pickLabel + ')' : '') + '. The totals row covers the printed rows only.' });
  out.push({ tag: 'NOTE', text: 'Staff loans carry no interest. Recovery is capped each month at what the salary can ' +
    'bear, so an instalment that does not fit is carried to the next month rather than deducted in part.' });
  return out.slice(0, 9);
}

/* THE LOAN BOOK PICKER — which loans, and nothing else. Same shape as the staff
 * picker: no month, no run, just the set. */
function loanPrintCentre(book) {
  if (!book || !book.length) { ui.toast('No loan has been disbursed yet', 'warn'); return; }
  var loans = book.slice();          // already newest-first from loanRows()
  var pick = {}, q = '', pickWas = null;
  loans.forEach(function (L) { pick[L.id] = true; });
  function chosen() { return loans.filter(function (L) { return pick[L.id]; }); }

  var body = el('div.pay-print'), rowHost = el('div.pay-print-rows'), rCount = el('div.pay-print-count');
  var searchIn = el('input.input', { placeholder: 'Search name, ID or note…',
    oninput: ui.debounce(function () { q = searchIn.value.toLowerCase(); drawRows(); }, 120) });
  var goBtn = null;

  body.appendChild(el('div.pay-print-step', null, [
    el('div.pay-print-h', { text: '1 · Scope and date' }),
    el('div.pay-print-scope', null, [
      el('div', null, [ el('strong', { text: scopeFull() }),
        el('div.text-mute.sm', { text: 'balances as at ' + ui.date(today(), 'long') +
          ' · report id ' + payReportId('LB', today().slice(0, 7)) }) ]),
      el('button.btn.btn-sm.btn-ghost', { html: ui.icon('arrow-left-right') + ' Change company',
        onclick: function () { m.close(); ui.toast('Pick the company from the switcher above, then print again', 'info'); } })
    ])
  ]));

  function drawRows() {
    rowHost.innerHTML = '';
    var shown = loans.filter(function (L) {
      if (!q) return true;
      return (L.empName + ' ' + L.empId + ' ' + (L.memo || '')).toLowerCase().indexOf(q) >= 0;
    });
    shown.forEach(function (L) {
      var cb = el('input', { type: 'checkbox', checked: pick[L.id] ? 'checked' : null,
        onchange: function () { pick[L.id] = cb.checked; pickWas = null; syncCounts(); } });
      rowHost.appendChild(el('label.pay-print-row', null, [ cb,
        el('span.pay-print-row-n', { text: L.empName }),
        isAll() ? el('span.badge', { text: coShort(L.companyId) }) : null,
        el('span.text-mute.xs', { text: ui.date(L.date) }),
        el('span.badge' + (L.closed ? '.badge-good' : '.badge-warn'), { text: L.closed ? 'Cleared' : 'Running' }),
        +L.emi > 0 ? null : el('span.badge.badge-bad', { text: 'No EMI' }),
        el('span.pay-print-row-v', { text: ui.money(L.due) + (L.closed ? '' : ' due') })
      ].filter(Boolean)));
    });
    if (!shown.length) rowHost.appendChild(el('div.text-mute.sm', { text: 'No loan matches “' + q + '”.' }));
  }
  function only(fn, label) { loans.forEach(function (L) { pick[L.id] = !!fn(L); }); pickWas = label || null; drawRows(); syncCounts(); }
  function add(fn) { loans.forEach(function (L) { if (fn(L)) pick[L.id] = true; }); pickWas = null; drawRows(); syncCounts(); }
  var byCoSel = el('select.select', { onchange: function () {
    var v = byCoSel.value; if (v !== '__') add(function (L) { return L.companyId === v; }); byCoSel.value = '__'; } });
  (function fill() {
    var cos = {};
    loans.forEach(function (L) { cos[L.companyId] = 1; });
    byCoSel.appendChild(el('option', { value: '__', text: 'Add by company…' }));
    Object.keys(cos).sort().forEach(function (c) { byCoSel.appendChild(el('option', { value: c, text: coShort(c) })); });
    byCoSel.style.display = isAll() ? '' : 'none';
  })();

  body.appendChild(el('div.pay-print-step', null, [
    el('div.pay-print-h', { text: '2 · Which loans' }),
    el('div.pay-print-bulk', null, [ searchIn,
      el('button.btn.btn-sm.btn-ghost', { text: 'Everything lent', onclick: function () { only(function () { return true; }, null); } }),
      el('button.btn.btn-sm.btn-ghost', { text: 'Clear all', onclick: function () { only(function () { return false; }, null); } }),
      el('button.btn.btn-sm.btn-ghost', { html: ui.icon('hourglass-split') + ' Only running',
        onclick: function () { only(function (L) { return !L.closed; }, 'running loans only'); } }),
      el('button.btn.btn-sm.btn-ghost', { html: ui.icon('check2-circle') + ' Only cleared',
        onclick: function () { only(function (L) { return !!L.closed; }, 'cleared loans only'); } }),
      el('button.btn.btn-sm.btn-ghost', { html: ui.icon('exclamation-triangle') + ' Only without an EMI plan',
        title: 'Running loans with no instalment set — nothing is being recovered from pay',
        onclick: function () { only(function (L) { return !L.closed && !(+L.emi > 0); }, 'loans with no EMI plan only'); } }),
      byCoSel ]),
    rowHost, rCount
  ]));

  function syncCounts() {
    var sel = chosen();
    rCount.textContent = sel.length + ' of ' + loans.length + (loans.length === 1 ? ' loan' : ' loans') +
      ' selected' + (pickWas ? ' · ' + pickWas : '') + ' · still due ' +
      ui.money(sum(sel, function (L) { return L.due; }));
    if (goBtn) { goBtn.disabled = !sel.length; goBtn.style.opacity = sel.length ? 1 : .5; }
  }

  var m = ui.modal({
    title: 'Print the loan book — ' + scopeShort(), icon: 'printer', size: 'lg', body: body,
    actions: [
      { label: 'Cancel', onClick: function () {} },
      { label: 'Preview', icon: 'eye', variant: 'primary', onClick: function () {
          var sel = chosen();
          if (!sel.length) { ui.toast('Tick at least one loan', 'error'); return false; }
          EPAL.report.open(payLoanReport(sel, loans, pickWas));
        } }
    ]
  });
  goBtn = m.box.querySelector('.modal-foot .btn-primary');
  drawRows(); syncCounts();
  return m;
}

/* ---------------------------------------------------------------------------
 * THE STAFF PRINT PICKER — who is on the statement, and nothing else
 * ---------------------------------------------------------------------------
 * A separate, smaller centre than printCentre() on purpose: there is no month to
 * tick, no run to approve and no detail level to choose. What a reader DOES want
 * is the same set-picking vocabulary they learned on the payroll centre — all,
 * none, only the people carrying something — so the steps, the classes and the
 * live counter are the same, and only the questions differ.
 * ------------------------------------------------------------------------- */
function staffPrintCentre(rows) {
  if (!rows || !rows.length) { ui.toast('No staff on this payroll to print', 'warn'); return; }
  var sorted = rows.slice().sort(function (a, b) { return (a.name || '') < (b.name || '') ? -1 : 1; });
  var pick = {}, q = '', pickWas = null;
  sorted.forEach(function (r) { pick[r.id] = true; });
  function carries(r) { return r.salaryDue > 0 || r.advance > 0 || r.loan > 0 || r.encash > 0 || r.netDue !== 0; }
  function chosen() { return sorted.filter(function (r) { return pick[r.id]; }); }

  var body = el('div.pay-print'), rowHost = el('div.pay-print-rows'), rCount = el('div.pay-print-count');
  var searchIn = el('input.input', { placeholder: 'Search name, ID, designation or department…',
    oninput: ui.debounce(function () { q = searchIn.value.toLowerCase(); drawRows(); }, 120) });
  var goBtn = null;

  body.appendChild(el('div.pay-print-step', null, [
    el('div.pay-print-h', { text: '1 · Scope and date' }),
    el('div.pay-print-scope', null, [
      el('div', null, [ el('strong', { text: scopeFull() }),
        el('div.text-mute.sm', { text: 'balances as at ' + ui.date(today(), 'long') +
          ' · report id ' + payReportId('SP', today().slice(0, 7)) }) ]),
      el('button.btn.btn-sm.btn-ghost', { html: ui.icon('arrow-left-right') + ' Change company',
        onclick: function () { m.close(); ui.toast('Pick the company from the switcher above, then print again', 'info'); } })
    ])
  ]));

  function drawRows() {
    rowHost.innerHTML = '';
    var shown = sorted.filter(function (r) {
      if (!q) return true;
      return (r.name + ' ' + r.id + ' ' + r.designation + ' ' + r.dept).toLowerCase().indexOf(q) >= 0;
    });
    shown.forEach(function (r) {
      var cb = el('input', { type: 'checkbox', checked: pick[r.id] ? 'checked' : null,
        onchange: function () { pick[r.id] = cb.checked; pickWas = null; syncCounts(); } });
      rowHost.appendChild(el('label.pay-print-row', null, [ cb,
        el('span.pay-print-row-n', { text: r.name }),
        isAll() ? el('span.badge', { text: coShort(r.companyId) }) : null,
        el('span.text-mute.xs', { text: r.dept }),
        r.status !== 'active' ? el('span.badge.badge-bad', { text: cap(r.status) }) : null,
        el('span.pay-print-row-v', { text: r.netDue ? ui.money(Math.abs(r.netDue)) + (r.netDue > 0 ? ' owed' : ' owes') : '—' })
      ].filter(Boolean)));
    });
    if (!shown.length) rowHost.appendChild(el('div.text-mute.sm', { text: 'Nobody matches “' + q + '”.' }));
  }
  function only(fn, label) { sorted.forEach(function (r) { pick[r.id] = !!fn(r); }); pickWas = label || null; drawRows(); syncCounts(); }
  function add(fn) { sorted.forEach(function (r) { if (fn(r)) pick[r.id] = true; }); pickWas = null; drawRows(); syncCounts(); }
  var byCoSel = el('select.select', { onchange: function () {
    var v = byCoSel.value; if (v !== '__') add(function (r) { return r.companyId === v; }); byCoSel.value = '__'; } });
  var byDeptSel = el('select.select', { onchange: function () {
    var v = byDeptSel.value; if (v !== '__') add(function (r) { return (r.dept || '—') === v; }); byDeptSel.value = '__'; } });
  (function fillSelects() {
    var cos = {}, depts = {};
    sorted.forEach(function (r) { cos[r.companyId] = 1; depts[r.dept || '—'] = 1; });
    byCoSel.appendChild(el('option', { value: '__', text: 'Add by company…' }));
    Object.keys(cos).sort().forEach(function (c) { byCoSel.appendChild(el('option', { value: c, text: coShort(c) })); });
    byDeptSel.appendChild(el('option', { value: '__', text: 'Add by department…' }));
    Object.keys(depts).sort().forEach(function (d) { byDeptSel.appendChild(el('option', { value: d, text: d })); });
    byCoSel.style.display = isAll() ? '' : 'none';
  })();

  body.appendChild(el('div.pay-print-step', null, [
    el('div.pay-print-h', { text: '2 · Who is on the statement' }),
    el('div.pay-print-bulk', null, [ searchIn,
      el('button.btn.btn-sm.btn-ghost', { text: 'Everyone', onclick: function () { only(function () { return true; }, null); } }),
      el('button.btn.btn-sm.btn-ghost', { text: 'Clear all', onclick: function () { only(function () { return false; }, null); } }),
      el('button.btn.btn-sm.btn-ghost', { html: ui.icon('wallet2') + ' Only with a balance',
        title: 'Anyone owed salary, holding an advance or a loan, or carrying an encashment accrual',
        onclick: function () { only(carries, 'people carrying a balance only'); } }),
      el('button.btn.btn-sm.btn-ghost', { html: ui.icon('exclamation-circle') + ' Only owed salary',
        onclick: function () { only(function (r) { return r.salaryDue > 0; }, 'people owed salary only'); } }),
      byCoSel, byDeptSel ]),
    rowHost, rCount
  ]));

  function syncCounts() {
    var sel = chosen();
    var net = sum(sel, function (r) { return r.netDue; });
    rCount.textContent = sel.length + ' of ' + sorted.length + (sorted.length === 1 ? ' person' : ' people') +
      ' selected' + (pickWas ? ' · ' + pickWas : '') + ' · net position ' + ui.money(Math.abs(net)) +
      (net >= 0 ? ' owed to staff' : ' owed by staff');
    if (goBtn) { goBtn.disabled = !sel.length; goBtn.style.opacity = sel.length ? 1 : .5; }
  }

  var m = ui.modal({
    title: 'Print staff position — ' + scopeShort(), icon: 'printer', size: 'lg', body: body,
    actions: [
      { label: 'Cancel', onClick: function () {} },
      { label: 'Preview', icon: 'eye', variant: 'primary', onClick: function () {
          var sel = chosen();
          if (!sel.length) { ui.toast('Tick at least one person', 'error'); return false; }
          EPAL.report.open(payStaffReport(sel, sorted, pickWas));
        } }
    ]
  });
  goBtn = m.box.querySelector('.modal-foot .btn-primary');
  drawRows(); syncCounts();
  return m;
}

/* ---------------------------------------------------------------------------
 * THE PRINT CENTRE — scope → months → detail level → rows → preview
 * ---------------------------------------------------------------------------
 * Print never prints straight away (owner): a payroll document goes out under
 * somebody's name, so the scope is confirmed, the months are chosen and, at
 * employee level, the people are chosen — with the net payable of the CURRENT
 * ticks shown live, so what the printed totals row will say is known before the
 * paper exists.
 * ------------------------------------------------------------------------- */
function printCentre(opts) {
  opts = opts || {};
  var all = approvedMonths();
  if (!all.length) { ui.toast('No approved payroll run to print — finalize a month first', 'warn'); return; }

  /* Launched from the Salary Register (one month on screen) → that month only,
   * at employee level. Launched from the Monthly Register → every month, as the
   * summary. Either way the reader can change it below. */
  /* WHERE IT WAS LAUNCHED FROM decides the default, because that is what the
   * reader already has on screen: the Monthly Register wants the summary of every
   * month; the Salary Register wants one month, per employee; the Salary Manage
   * sheet wants the DISBURSEMENT sheet for the month being paid. */
  var oneMonth = (opts.from === 'sheet' || opts.from === 'disburse') && opts.ym;
  var pick = {}, level = opts.from === 'disburse' ? 'disburse' : (opts.from === 'sheet' ? 'detail' : 'summary');
  var q = '', rowPick = null;
  all.forEach(function (m) { pick[m.ym] = oneMonth ? (m.ym === opts.ym) : true; });
  if (oneMonth && !pick[opts.ym]) { ui.toast('That month is not an approved run yet — finalize it first', 'warn'); return; }

  var body = el('div.pay-print');
  var mCount = el('div.pay-print-count'), rCount = el('div.pay-print-count');
  var secLevel = el('div.pay-print-step'), secRows = el('div.pay-print-step'), rowHost = el('div.pay-print-rows');
  var searchIn = el('input.input', { placeholder: 'Search name, ID or department…',
    oninput: ui.debounce(function () { q = searchIn.value.toLowerCase(); drawRows(); }, 120) });
  var goBtn = null;

  function picked() { return all.filter(function (m) { return pick[m.ym]; }); }
  function oneYm() { var p = picked(); return p.length === 1 ? p[0].ym : null; }
  // two of the three levels print one row per person, so both need step 4
  function perEmployee() { return level === 'detail' || level === 'disburse'; }
  function monthSlips() {
    var ym = oneYm(); if (!ym) return [];
    return slipsIn(ym).slice().sort(function (a, b) { return (a.empName || '') < (b.empName || '') ? -1 : 1; });
  }
  function ensureRowPick() {
    var list = monthSlips();
    if (!rowPick) { rowPick = {}; list.forEach(function (s) { rowPick[s.empId] = true; }); }   // ALL ticked by default
    return list;
  }
  function pickedSlips() { var list = ensureRowPick(); return list.filter(function (s) { return rowPick[s.empId]; }); }

  /* ---- step 1 · scope (read-only — you cannot print the wrong entity by
   * accident, and changing it is a deliberate act on the switcher) ---------- */
  body.appendChild(el('div.pay-print-step', null, [
    el('div.pay-print-h', { text: '1 · Scope' }),
    el('div.pay-print-scope', null, [
      el('div', null, [ el('strong', { text: scopeFull() }),
        el('div.text-mute.sm', { text: isAll() ? scopeCids().length + ' concerns consolidated — ' + scopeNames()
          : 'this concern only · report id ' + payReportId('MR', all[all.length - 1].ym) }) ]),
      el('button.btn.btn-sm.btn-ghost', { html: ui.icon('arrow-left-right') + ' Change company',
        onclick: function () { m.close(); ui.toast('Pick the company from the switcher above, then print again', 'info'); } })
    ])
  ]));

  /* ---- step 2 · months --------------------------------------------------- */
  var monthHost = el('div.pay-print-months');
  all.slice().reverse().forEach(function (mo) {                      // newest first
    var cb = el('input', { type: 'checkbox', checked: pick[mo.ym] ? 'checked' : null,
      onchange: function () { pick[mo.ym] = cb.checked; rowPick = null; sync(); } });
    mo._cb = cb;
    monthHost.appendChild(el('label.pay-print-mo', null, [ cb,
      el('span.pay-print-mo-n', { text: PR().mLabel(mo.ym) }),
      el('span.badge', { text: cap(mo.status) }),
      el('span.text-mute.xs', { text: mo.heads + ' staff · ' + ui.money(mo.net) }) ]));
  });
  function setAll(fn) { all.forEach(function (mo) { pick[mo.ym] = fn(mo); if (mo._cb) mo._cb.checked = pick[mo.ym]; }); rowPick = null; sync(); }
  function lastN(n) { var keep = {}; all.slice(-n).forEach(function (mo) { keep[mo.ym] = 1; }); setAll(function (mo) { return !!keep[mo.ym]; }); }
  body.appendChild(el('div.pay-print-step', null, [
    el('div.pay-print-h', { text: '2 · Months' }),
    el('div.pay-print-bulk', null, [
      el('button.btn.btn-sm.btn-ghost', { text: 'Select all', onclick: function () { setAll(function () { return true; }); } }),
      el('button.btn.btn-sm.btn-ghost', { text: 'Clear all', onclick: function () { setAll(function () { return false; }); } }),
      el('button.btn.btn-sm.btn-ghost', { text: 'Last 3', onclick: function () { lastN(3); } }),
      el('button.btn.btn-sm.btn-ghost', { text: 'Last 6', onclick: function () { lastN(6); } }),
      el('button.btn.btn-sm.btn-ghost', { text: 'This year', onclick: function () {
        var y = all[all.length - 1].ym.slice(0, 4); setAll(function (mo) { return mo.ym.slice(0, 4) === y; }); } })
    ]),
    monthHost, mCount
  ]));

  /* ---- step 3 · detail level (only when the selection is ONE month, because
   * an employee-level register of six months is six registers) -------------- */
  var radios = [['summary', 'Summary row only', 'the register line for that month, its totals and the control panels'],
    ['detail', 'Employee-level detail', 'the full Salary Register — one row per employee'],
    /* The third level is a different DOCUMENT, not a longer version of the second:
     * it goes out with a blank column and comes back as the receipt. Pair it with
     * "Only unpaid" below and it is exactly the sheet the cashier carries. */
    ['disburse', 'Disbursement sheet', 'what the cashier carries — net payable, what to hand over, and a signature line per employee']];
  secLevel.appendChild(el('div.pay-print-h', { text: '3 · Detail level' }));
  radios.forEach(function (r) {
    var rb = el('input', { type: 'radio', name: 'paylvl', checked: level === r[0] ? 'checked' : null,
      onchange: function () { if (rb.checked) { level = r[0]; sync(); } } });
    secLevel.appendChild(el('label.pay-print-lvl', null, [ rb,
      el('span', null, [ el('strong', { text: r[1] }), el('div.text-mute.sm', { text: r[2] }) ]) ]));
  });
  body.appendChild(secLevel);

  /* ---- step 4 · rows ----------------------------------------------------- */
  function drawRows() {
    var list = ensureRowPick();
    rowHost.innerHTML = '';
    var shown = list.filter(function (s) {
      if (!q) return true;
      return (s.empName + ' ' + s.empId + ' ' + (s.dept || '')).toLowerCase().indexOf(q) >= 0;
    });
    shown.forEach(function (s) {
      /* ticking a person updates the COUNTER, never the list: redrawing 21 rows
       * under the cursor loses the scroll position and steals the next click */
      var cb = el('input', { type: 'checkbox', checked: rowPick[s.empId] ? 'checked' : null,
        onchange: function () { rowPick[s.empId] = cb.checked; pickWas = null; syncCounts(); } });
      var due = dueOf(s);
      rowHost.appendChild(el('label.pay-print-row', null, [ cb,
        el('span.pay-print-row-n', { text: s.empName }),
        el('span.text-mute.xs', { text: s.empId }),
        isAll() ? el('span.badge', { text: coShort(s.companyId) }) : null,
        el('span.text-mute.xs', { text: s.dept || '—' }),
        // the state the reader is choosing BY, on the row they are choosing
        el('span.badge' + (due > 0 ? '.badge-bad' : '.badge-good'), { text: due > 0 ? 'Due' : 'Paid' }),
        el('span.pay-print-row-v', { text: ui.money(PR().slipPayable(s)) }) ].filter(Boolean)));
    });
    if (!shown.length) rowHost.appendChild(el('div.text-mute.sm', { text: 'No employee matches “' + q + '”.' }));
  }
  /* TWO KINDS OF PICKER, and the difference is deliberate.
   *   onlyRows(fn) REPLACES the selection — "just the due ones" means those and
   *     nothing else, which is what a reader asking for it wants to print.
   *   bulkRows(fn) ADDS to it — so two companies, or three departments, can be
   *     built up one dropdown pick at a time.
   * `pickWas` remembers which named set was chosen, so the printed page can say
   * "unpaid only" rather than the anonymous "15 of 21"; any hand-tick clears it,
   * because the set is no longer the one that was named. */
  var pickWas = null;
  function bulkRows(fn) { ensureRowPick().forEach(function (s) { if (fn(s)) rowPick[s.empId] = true; }); pickWas = null; drawRows(); sync(); }
  function onlyRows(fn, label) {
    ensureRowPick().forEach(function (s) { rowPick[s.empId] = !!fn(s); });
    pickWas = label || null; drawRows(); sync();
  }
  var byCoSel = el('select.select', { onchange: function () {
    var v = byCoSel.value; if (v !== '__') bulkRows(function (s) { return s.companyId === v; }); byCoSel.value = '__'; } });
  var byDeptSel = el('select.select', { onchange: function () {
    var v = byDeptSel.value; if (v !== '__') bulkRows(function (s) { return (s.dept || '—') === v; }); byDeptSel.value = '__'; } });
  function fillBulkSelects() {
    var list = ensureRowPick(), cos = {}, depts = {};
    list.forEach(function (s) { cos[s.companyId] = 1; depts[s.dept || '—'] = 1; });
    byCoSel.innerHTML = ''; byCoSel.appendChild(el('option', { value: '__', text: 'Add by company…' }));
    Object.keys(cos).sort().forEach(function (c) { byCoSel.appendChild(el('option', { value: c, text: coShort(c) })); });
    byDeptSel.innerHTML = ''; byDeptSel.appendChild(el('option', { value: '__', text: 'Add by department…' }));
    Object.keys(depts).sort().forEach(function (d) { byDeptSel.appendChild(el('option', { value: d, text: d })); });
    byCoSel.style.display = isAll() ? '' : 'none';
    // a set nobody is in is not offered: no unpaid staff, no "Only unpaid" button
    var anyDue = list.filter(function (s) { return dueOf(s) > 0; }).length;
    dueBtn.style.display = anyDue ? '' : 'none';
    paidBtn.style.display = (anyDue < list.length) ? '' : 'none';
  }
  var dueBtn = el('button.btn.btn-sm.btn-ghost', { html: ui.icon('exclamation-circle') + ' Only unpaid',
    title: 'Print only the employees still owed money for this month',
    onclick: function () { onlyRows(function (s) { return dueOf(s) > 0; }, 'unpaid only'); } });
  var paidBtn = el('button.btn.btn-sm.btn-ghost', { html: ui.icon('check2-circle') + ' Only paid',
    title: 'Print only the employees whose month is fully settled',
    onclick: function () { onlyRows(function (s) { return dueOf(s) <= 0; }, 'fully paid only'); } });
  secRows.appendChild(el('div.pay-print-h', { text: '4 · Employees' }));
  secRows.appendChild(el('div.pay-print-bulk', null, [ searchIn,
    el('button.btn.btn-sm.btn-ghost', { text: 'Select all', onclick: function () { onlyRows(function () { return true; }, null); } }),
    el('button.btn.btn-sm.btn-ghost', { text: 'Clear all', onclick: function () { onlyRows(function () { return false; }, null); } }),
    dueBtn, paidBtn, byCoSel, byDeptSel ]));
  secRows.appendChild(rowHost);
  secRows.appendChild(rCount);
  body.appendChild(secRows);

  /* ---- what the reader is told, live -------------------------------------
   * syncCounts() is the cheap half — the two live counters and whether Preview
   * can be pressed. It is what a tick calls. sync() adds the structural half:
   * which steps exist at all, and rebuilding the employee list under them. */
  function syncCounts() {
    var p = picked(), one = oneYm(), wantRows = !!one && perEmployee();
    mCount.textContent = p.length + ' of ' + all.length + ' month' + (all.length === 1 ? '' : 's') + ' selected' +
      (p.length ? ' · net payable ' + ui.money(sum(p, function (m) { return m.net; })) : '');
    if (wantRows) {
      var sel = pickedSlips();
      rCount.textContent = sel.length + ' of ' + ensureRowPick().length + ' employees selected' +
        (pickWas ? ' · ' + pickWas : '') + ' · net payable ' +
        ui.money(sum(sel, function (s) { return PR().slipPayable(s); }));
      if (goBtn) goBtn.disabled = !sel.length;
    } else if (goBtn) goBtn.disabled = !p.length;
    if (goBtn) goBtn.style.opacity = goBtn.disabled ? .5 : 1;
  }
  function sync() {
    var one = oneYm();
    // step 3 only exists for a single month; two or more always print the summary
    secLevel.style.display = one ? '' : 'none';
    if (!one) level = 'summary';
    var wantRows = !!one && perEmployee();
    secRows.style.display = wantRows ? '' : 'none';
    if (wantRows) { fillBulkSelects(); drawRows(); }
    syncCounts();
  }

  var m = ui.modal({
    title: 'Print payroll — ' + scopeShort(), icon: 'printer', size: 'lg', body: body,
    actions: [
      { label: 'Cancel', onClick: function () {} },
      { label: 'Preview', icon: 'eye', variant: 'primary', onClick: function () {
          var p = picked();
          if (!p.length) { ui.toast('Tick at least one month', 'error'); return false; }
          var one = oneYm();
          if (one && perEmployee()) {
            var sel = pickedSlips();
            if (!sel.length) { ui.toast('Tick at least one employee', 'error'); return false; }
            EPAL.report.open((level === 'disburse' ? payDisburseReport : payDetailReport)(one, sel, ensureRowPick(), pickWas));
          } else {
            EPAL.report.open(paySummaryReport(p));
          }
        } }
    ]
  });
  goBtn = m.box.querySelector('.modal-foot .btn-primary');
  sync();
  return m;
}

/* ---- small helpers ----------------------------------------------------*/
function drow(k, v) { return el('div.data-row', null, [ el('div.text-mute.sm.flex-1', { text: k }), el('div.strong', { text: v == null || v === '' ? '—' : String(v) }) ]); }
function card(text) { var c = frag('card-body-card'); slot(c, 'body').textContent = text; return c; }
