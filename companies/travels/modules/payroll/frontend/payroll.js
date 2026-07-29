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
 * sparkline · a reconciliation against the general ledger · a mini stack), a
 * narrated digest, an AUTOPILOT of proposed next actions and an anomaly RADAR.
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
function glBal(code) { return (EPAL.ledger && EPAL.ledger.balance) ? EPAL.ledger.balance(code, { companyId: CID }) : 0; }
// every journal the payroll engine writes carries source:'payroll'
function payEntries(ym) {
  if (!EPAL.ledger || !EPAL.ledger.entries) return [];
  var rows = EPAL.ledger.entries({ companyId: CID, source: 'payroll' });
  return ym ? rows.filter(function (e) { return String(e.date || '').slice(0, 7) === ym; }) : rows;
}

function team() { return (db.employees ? db.employees({ companyId: CID }) : []).slice().sort(function (a, b) { return (a.name || '') < (b.name || '') ? -1 : 1; }); }
function empById(id) { return team().filter(function (e) { return e.id === id; })[0] || (db.employee ? db.employee(id) : null); }
function canCreate() { return !EPAL.perm || EPAL.perm.can(CID, 'payroll', 'create'); }
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
      if (CID !== cid) { payYm = null; ovMonth = null; }   // reset only when switching company
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
      VIEWS[sub](page);
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
  if (CID !== cid) { payYm = null; ovMonth = null; deskTab = 'overview'; }
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
    (VIEWS[deskTab] || VIEWS.overview)(section);
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
function advOf(s) { var auto = Math.min(PR().advanceOutstanding(s.empId), Math.max(0, PR().slipPayable(s))); return (s.paid > 0) ? (s.advanceRecovered || 0) : ((s.advCap == null || s.advCap === '') ? auto : Math.min(auto, +s.advCap)); }
function emiOf(s) { return (s.paid > 0) ? (s.loanRecovered || 0) : ((s.emiCap == null || s.emiCap === '') ? PR().emiInstallment(s.empId) : +s.emiCap); }
// (`fine` = the salary template's standing punishment + any one-off deducted on
// this month; `tplBonus` = the template's standing monthly bonus. A slip written
// before salary templates existed carries neither, so both read 0 and every old
// figure is exactly what it was.)
function otherOf(s) { return (s.tax || 0) + (s.pf || 0) + (s.lateDeduction || 0) + (s.earlyDeduction || 0) + (s.otherDeduction || 0) + (s.fine || 0); }
function addOf(s) { return (s.overtime || 0) + (s.bonus || 0) + (s.tplBonus || 0) + Math.max(0, s.adjustment || 0); }
function dedOf(s) { return otherOf(s) + Math.max(0, -(s.adjustment || 0)); }
function bonusOf(s) { return (s.bonus || 0) + (s.tplBonus || 0); }
function dueOf(s) { return Math.max(0, PR().slipPayable(s) - (s.paid || 0)); }
function cashOf(s) { return Math.max(0, (s.paid || 0) - (s.advanceRecovered || 0) - (s.loanRecovered || 0)); }

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
  var slips = S.list('pay_slips').filter(function (s) { return s.companyId === CID; });
  var live = slips.filter(function (s) { return s.status !== 'draft'; });
  var sheetOwed = sum(live, dueOf);
  var advOut = sum(t, function (e) { return PR().advanceOutstanding(e.id); });
  var loanOut = sum(t, function (e) { return PR().loanOutstanding(e.id); });
  return {
    team: t, slips: slips, live: live,
    sheetOwed: sheetOwed,
    glPayable: glBal(ACC.payable),
    glStatutory: glBal(ACC.pf) + glBal(ACC.tax) + glBal(ACC.encashPay),
    glAdvLoan: glBal(ACC.adv) + glBal(ACC.loan),
    advOut: advOut, loanOut: loanOut,
    encashLiability: PR().encashmentLiability(CID),
    runs: S.list('pay_runs').filter(function (r) { return r.companyId === CID; }).sort(function (a, b) { return a.ym < b.ym ? 1 : -1; })
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
  S.list('pay_slips').filter(function (s) { return s.companyId === CID; }).forEach(function (s) {
    var m = byYm[s.ym] || (byYm[s.ym] = blankMonth(s.ym));
    m.heads++; m.gross += s.earnedGross || 0; m.adds += addOf(s); m.deds += dedOf(s);
    m.net += PR().slipPayable(s); m.encash += s.encashAmt || 0;
    m.paid += s.paid || 0; m.due += dueOf(s);
    // FULLY paid, not merely part-paid: six people each given a token amount
    // must not read as "6 / 6 staff paid" while the month is still owed.
    if ((s.paid || 0) > 0 && dueOf(s) === 0) m.paidHeads++;
    if (s.status === 'draft') m.drafts++;
  });
  // pay_runs is the OTHER half of the union: a run can exist before any payslip
  // does, and a month with payslips can have no run row — Payroll History has to
  // list both, so the month list is built from both.
  S.list('pay_runs').filter(function (r) { return r.companyId === CID; }).forEach(function (r) {
    if (!byYm[r.ym]) byYm[r.ym] = blankMonth(r.ym);
    byYm[r.ym].status = r.status;
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
  PR().slipsFor(CID, ym).forEach(function (s) {
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
      out.push({ key: e.id, empId: s.empId, empName: s.empName, purpose: 'Salary', type: 'salary',
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
      out.push({ key: 'slip-' + s.empId + '-' + ym, empId: s.empId, empName: s.empName, purpose: 'Salary', type: 'salary',
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
    if (t.companyId !== CID) return false;
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
    out.push({ key: t.id, empId: t.empId, empName: t.empName, purpose: PURPOSE[t.type] || cap(t.type || 'Payroll'), type: t.type,
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
    ? 'every payroll month · click one for all its transactions'
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
          return '<span class="badge badge-' + (m.status === 'paid' ? 'good' : m.status === 'due' ? 'bad' : m.status === 'draft' ? 'warn' : 'info') + '">' + esc(cap(m.status)) + '</span>';
        },
        exportVal: function (m) { return m.status ? cap(m.status) : 'No run'; } }
    ],
    rows: months, sortKey: 'ym', sortDir: -1, pageSize: 12, totalKey: 'paid',
    exportName: 'payroll-history.csv', pdfTitle: coFull(CID) + ' — Payroll History',
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
    columns: [
      { key: 'empId', label: 'Employee ID', render: function (r) { return '<span class="mono xs">' + esc(r.empId) + '</span>'; } },
      { key: 'empName', label: 'Employee', render: function (r) { return '<span class="strong">' + esc(r.empName) + '</span>'; } },
      { key: 'purpose', label: 'Purpose', badge: { Salary: 'good', Advance: 'warn', 'Staff loan': 'warn', 'Loan repayment': 'info', Bonus: 'good', 'Leave encashment': 'info', 'Final settlement': 'bad' } },
      { key: 'date', label: 'Date', date: true },
      { key: 'from', label: 'Paid from' },
      { key: 'amount', label: 'Amount', num: true, money: true }
    ],
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
  var head = '<tr><th>Employee ID</th><th>Employee</th><th>Purpose</th><th>Date</th><th>Paid from</th><th style="text-align:right">Amount</th></tr>';
  var body = rows.map(function (r) {
    return '<tr><td>' + esc(r.empId) + '</td><td>' + esc(r.empName) + '</td><td>' + esc(r.purpose) + '</td><td>' +
      esc(ui.date(r.date)) + '</td><td>' + esc(r.from) + '</td><td style="text-align:right">' + ui.money(r.amount) + '</td></tr>';
  }).join('');
  var totRow = '<tr><th colspan="5">Total listed</th><th style="text-align:right">' + ui.money(tot.listed) + '</th></tr>' +
    '<tr><td colspan="5" style="text-align:right">of which cash left an account</td><td style="text-align:right">' + ui.money(tot.out) + '</td></tr>';
  if (tot.inn > 0) totRow += '<tr><td colspan="5" style="text-align:right">cash received back in</td><td style="text-align:right">' + ui.money(tot.inn) + '</td></tr>';
  if (tot.internal > 0) totRow += '<tr><td colspan="5" style="text-align:right">recovered inside a salary payment — never touched the bank</td><td style="text-align:right">' + ui.money(tot.internal) + '</td></tr>';
  ui.printDoc({
    title: 'Payroll Transactions — ' + PR().mLabel(ym),
    subtitle: coFull(CID) + ' · Payroll',
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
    ['Purpose', r.purpose + (r.instalments > 1 ? '  ·  instalment ' + r.instalment + ' of ' + r.instalments : '')],
    ['Amount', ui.money(r.amount)],
    ['Date', ui.date(r.date)],
    ['Paid from', r.from],
    [r.dir === 'in' ? 'Cash received into the account' : 'Cash that left the account',
      r.dir === 'internal' ? 'nothing moved — recovered inside a salary payment' : (r.cash ? ui.money(r.cash) : 'nothing moved')],
    ['Month', PR().mLabel(r.ym)],
    ['Note', r.memo || '—'],
    ['Journal', r.glId || 'no posting on file']
  ];
  body.appendChild(el('div.card', null, [el('div.card-body', null, [
    el('div.data-list', null, rows.map(function (p) { return drow(p[0], p[1]); }))
  ])]));
  if (r.slip) {
    body.appendChild(el('div.card.mt-3', null, [
      el('div.card-head', null, [el('h3', { html: ui.icon('receipt') + ' That month\'s payslip' })]),
      el('div.card-body', null, [el('div.data-list', null, [
        drow('Net payable', ui.money(PR().slipPayable(r.slip))),
        drow('Paid in total', ui.money(r.slip.paid || 0)),
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
  if (r.entry) acts.push({ label: 'Print voucher', icon: 'file-earmark-text', variant: 'primary',
    onClick: function () { EPAL.journalVoucher(r.entry, coFull(CID)); return false; } });
  if (r.slip) acts.push({ label: 'Payslip', icon: 'receipt',
    onClick: function () { var e = empById(r.empId); if (e) statement(e, r.ym); return true; } });
  acts.push({ label: 'Close' });
  ui.modal({ title: r.purpose + ' — ' + r.empName, icon: 'cash-coin', size: 'lg', body: body, actions: acts });
}

function printTxn(r, rows) {
  ui.printDoc({
    title: r.purpose + ' — ' + r.empName,
    subtitle: coFull(CID) + ' · Payroll · ' + PR().mLabel(r.ym),
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
  var P = position(), meta = coMeta(CID), ym = payYm || PR().curYm();
  var series = monthSeries(12);

  /* ---- 1 · the dashboard row -------------------------------------------- */
  var paid12 = sum(series, function (m) { return m.paid; });
  var due12 = sum(series, function (m) { return m.due; });
  var variance = P.glPayable - P.sheetOwed, reconciled = Math.abs(variance) < 1;
  box(s, 'dash').appendChild(dashRow({
    // SHORT name on the panel (as Manage Banks does) — the full legal name is
    // 30+ characters and ellipsises inside a four-card row; it reads in full on
    // the digest below.
    hue: meta.accent, icon: meta.icon, co: coShort(CID), coSub: 'Payroll position · ' + PR().mLabel(ym),
    hero: ui.money(P.sheetOwed), heroBad: P.sheetOwed > 0, heroLabel: 'Owed to staff',
    heroTitle: 'Open the salary sheet', heroOn: function () { goTab('manage'); },
    facts: [
      { k: 'Headcount', v: String(P.team.length), title: 'Every employee on this payroll', on: function () { goTab('staff'); } },
      { k: 'Payroll months', v: String(P.runs.length), title: 'Every month ever run', on: function () { goTab('manage'); } },
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

  /* ---- 2 · the narrated digest ------------------------------------------ */
  digest(s, P, ym, series);

  /* ---- 3 · autopilot (what to do next) + radar (what looks wrong) ------- */
  fillH(s, 'auto-title', ui.icon('magic') + ' Payroll Autopilot');
  fillK(s, 'auto-sub', 'proposals only — nothing posts until you click');
  rowsInto(box(s, 'auto'), autopilot(ym, P), 'Nothing to do — this payroll is up to date.');

  fillH(s, 'radar-title', ui.icon('radar') + ' Anomaly Radar');
  fillK(s, 'radar-sub', 'click to open the employee');
  rowsInto(box(s, 'radar'), radar(P), 'No anomalies in the payroll book.');

  /* ---- 4 · the Monthly Register + department cost ----------------------- */
  fillH(s, 'trend-title', ui.icon('calendar3') + ' Monthly Register');
  fillK(s, 'trend-sub', 'click a month for every employee, every transaction, every figure');
  box(s, 'trend').appendChild(registerTable(monthSeries()));

  fillH(s, 'dept-title', ui.icon('diagram-3') + ' Where the money goes');
  fillK(s, 'dept-sub', 'monthly salary cost by department');
  var dc = PR().departmentCost(CID);          // read ONCE — ring and table must agree
  box(s, 'dept').appendChild(deptTable(P, dc));
  deptRing(s, dc);

  mountScreen(page, s);
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
  var run = PR().getRun(CID, ym), st = run ? run.status : 'draft';
  var slips = PR().slipsFor(CID, ym);
  var gross = sum(slips, function (x) { return x.earnedGross; });
  var net = sum(slips, function (x) { return PR().slipPayable(x); });
  var paid = sum(slips, function (x) { return x.paid || 0; });
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
  lines.push(!run
    ? PR().mLabel(ym) + ' has not been opened yet — generate it on ' + b('Salary Manage') + ' to create this month’s payslips.'
    : st === 'draft'
      ? 'The month is still a ' + b('draft') + (PR().inCorrectionWindow(CID, ym) ? ' and the correction window is open until ' + b(ui.date(run.correctionUntil)) + '.' : ' — the correction window closed on ' + b(ui.date(run.correctionUntil)) + ', so nothing is on the books yet.')
      : 'The month is ' + b(cap(st)) + ' — accrued to the ledger, ' + b(ui.money(paid)) + ' paid and ' + b(ui.money(Math.max(0, due))) + ' still owed.');
  if (P.advOut || P.loanOut) lines.push('Staff hold ' + b(ui.money(P.advOut)) + ' of advances and ' + b(ui.money(P.loanOut)) + ' of loans, recovered automatically from future pay.');
  if (P.encashLiability > 0) lines.push('Leave encashment has built a ' + b(ui.money(P.encashLiability)) + ' liability.');
  var variance = P.glPayable - P.sheetOwed;
  lines.push(Math.abs(variance) < 1
    ? 'The salary sheet and the general ledger ' + b('agree') + ' to the taka.'
    : 'The ledger and the sheet disagree by ' + b(ui.money(variance)) + ' — worth opening before month-end.');

  fillK(s, 'digest-date', 'PAYROLL DIGEST · ' + ui.date(today(), 'long'));
  fillK(s, 'digest-title', coFull(CID) + ' — ' + PR().mLabel(ym));
  fillH(s, 'digest-text', lines.join(' '));
}

/* AUTOPILOT — everything the payroll calendar and the books say SHOULD happen
 * next, each as a proposal with the button that does it. It never acts on its
 * own (owner 2026-07-28), so an automatic payroll can never surprise the bank. */
function autopilot(ym, P) {
  var out = [], run = PR().getRun(CID, ym), st = run ? run.status : 'draft';
  var slips = PR().slipsFor(CID, ym);
  var net = sum(slips, function (s) { return PR().slipPayable(s); });
  var paid = sum(slips, function (s) { return s.paid || 0; });
  var due = net - paid, td = today();

  // both draft proposals quote the correction window, which only a RUN carries —
  // and a hydrated install can hold payslips with no run row (live 2026-07-28)
  if (st === 'draft' && slips.length && run) {
    if (PR().inCorrectionWindow(CID, ym)) {
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
  return out;
}

/* RADAR — the things nobody asked about that a payroll manager would want to be
 * told. Every finding names the employee and opens their file. */
function radar(P) {
  var out = [];
  function openEmp(e) { return function () { if (EPAL.people) EPAL.people.open(e.id); }; }
  P.live.forEach(function (s) {
    var payable = PR().slipPayable(s);
    if ((s.paid || 0) > payable + 1) out.push({ sev: 'high', icon: 'exclamation-octagon',
      title: s.empName + ' was overpaid in ' + PR().mLabel(s.ym),
      why: 'Paid ' + ui.money(s.paid) + ' against a payslip of ' + ui.money(payable) + ' — ' + ui.money(s.paid - payable) + ' more than the sheet allows.',
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
  return out.slice(0, 12);
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
    pdfTitle: coFull(CID) + ' — Payroll Monthly Register',
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
  dc = dc || PR().departmentCost(CID);
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
  var ym = ovMonth, s = screen('month'), meta = coMeta(CID);
  var run = PR().getRun(CID, ym), st = run ? run.status : 'draft';
  var slips = PR().slipsFor(CID, ym).slice().sort(function (a, b) { return (a.empName || '') < (b.empName || '') ? -1 : 1; });
  var gross = sum(slips, function (x) { return x.earnedGross; });
  var net = sum(slips, function (x) { return PR().slipPayable(x); });
  var paid = sum(slips, function (x) { return x.paid || 0; });
  var due = net - paid;
  var adds = sum(slips, addOf), deds = sum(slips, dedOf);
  var advRec = sum(slips, advOf), emiRec = sum(slips, emiOf);

  /* ---- the control bar -------------------------------------------------- */
  act(s, 'back', function () { ovMonth = null; repaint(); }).innerHTML = ui.icon('arrow-left') + ' Monthly Register';
  act(s, 'print', function () { printSheetForm(slips, ym); }).innerHTML = ui.icon('printer') + ' Print register';
  act(s, 'open-run', function () { payYm = ym; goTab('manage'); }).innerHTML = ui.icon('sliders') + ' Manage this run';
  var pick = part(s, 'mpick');
  monthSeries().slice().reverse().forEach(function (m) {
    var o = el('option', { value: m.ym, text: PR().mLabel(m.ym) + '  ·  ' + cap(m.status || 'draft') });
    if (m.ym === ym) o.selected = true; pick.appendChild(o);
  });
  pick.addEventListener('change', function () { ovMonth = this.value; repaint(); });
  fillK(s, 'status', cap(st)).classList.add('badge-' + (st === 'paid' ? 'good' : st === 'due' ? 'bad' : st === 'draft' ? 'warn' : 'info'));
  fillK(s, 'note', slips.length + ' employees · ' + payEntries(ym).length + ' ledger postings · ' +
    S.list('pay_txns').filter(function (x) { return x.companyId === CID && String(x.date || '').slice(0, 7) === ym; }).length +
    ' employee money movements in ' + PR().mLabel(ym) + '.');

  /* ---- the dashboard row, scoped to this month -------------------------- */
  box(s, 'dash').appendChild(dashRow({
    hue: meta.accent, icon: 'calendar3', co: PR().mLabel(ym), coSub: coShort(CID) + ' · ' + cap(st),
    hero: ui.money(net), heroLabel: 'Net payable', heroTitle: 'Manage this run', heroOn: function () { payYm = ym; goTab('manage'); },
    facts: [
      { k: 'Employees', v: String(slips.length), on: null },
      { k: 'Gross', v: ui.money(gross, { compact: true }), on: null },
      { k: 'Outstanding', v: ui.money(Math.max(0, due), { compact: true }), on: function () { payYm = ym; goTab('manage'); } }
    ],
    last: lastEventCfg(ym, 'Last posting this month'),
    flow: {
      title: 'Payment progress', sub: 'per employee · paid vs outstanding',
      rows: slips.map(function (x) { return { up: x.paid || 0, down: dueOf(x), tip: x.empName + ' · paid ' + ui.money(x.paid || 0) + (dueOf(x) ? ' · due ' + ui.money(dueOf(x)) : '') }; }),
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
  fillK(s, 'reg-sub', 'every employee · click a row for the payslip · export or print the lot');
  box(s, 'reg').appendChild(EPAL.table({
    columns: [
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
      { key: 'paid', label: 'Paid', num: true, sortVal: function (x) { return x.paid || 0; }, render: function (x) { return x.paid ? '<span class="text-good">' + ui.money(x.paid) + '</span>' : '—'; } },
      { key: 'due', label: 'Due', num: true, sortVal: dueOf, render: function (x) { var v = dueOf(x); return v ? '<span class="num strong text-bad">' + ui.money(v) + '</span>' : '—'; } },
      { key: 'status', label: 'Status', badge: { draft: '', accrued: 'info', partial: 'warn', due: 'bad', paid: 'good' } }
    ],
    rows: slips, searchKeys: ['empName', 'empId', 'dept'], quickFilter: 'status', filterPanel: true,
    filters: [{ key: 'dept', label: 'Dept' }, { key: 'status', label: 'Status' }],
    totalKey: 'net', pageSize: 25,
    exportName: 'salary-register-' + ym + '.csv', pdfTitle: coFull(CID) + ' — Salary Register ' + PR().mLabel(ym),
    onRow: function (x) { var e = empById(x.empId); if (e) statement(e, ym); },
    actions: [{ icon: 'person-lines-fill', title: 'Open the employee\'s full file', onClick: function (x) { if (EPAL.people) EPAL.people.open(x.empId); } }]
      .concat(ui.actions({ print: function (x) { var e = empById(x.empId); if (e) statementPrint(e, ym); } })),
    empty: { icon: 'table', title: 'No payslips in ' + PR().mLabel(ym) }
  }).el);

  /* ---- every movement that touched an employee's money this month ------- */
  var txns = S.list('pay_txns').filter(function (x) { return x.companyId === CID && String(x.date || '').slice(0, 7) === ym; })
    .sort(function (a, b) { return a.date < b.date ? 1 : -1; });
  fillH(s, 'txn-title', ui.icon('journal-text') + ' Employee money movements');
  fillK(s, 'txn-sub', txns.length + ' in ' + PR().mLabel(ym) + ' · advance · loan · repayment · bonus · encashment');
  box(s, 'txns').appendChild(EPAL.table({
    columns: [
      { key: 'date', label: 'Date', date: true },
      { key: 'empName', label: 'Employee', render: function (x) { return EPAL.people ? EPAL.people.linkify(x.empName, x.empId) : esc(x.empName); } },
      { key: 'type', label: 'Type', badge: { advance: 'warn', loan: 'warn', 'loan-repay': 'good', bonus: 'good', 'encash-paid': 'info', settlement: 'bad' } },
      { key: 'memo', label: 'Detail' },
      { key: 'method', label: 'Through', badge: {} },
      { key: 'amount', label: 'Amount', num: true, money: true }
    ],
    rows: txns, searchKeys: ['empName', 'empId', 'memo'], pageSize: 10, totalKey: 'amount',
    exportName: 'payroll-movements-' + ym + '.csv',
    onRow: function (x) { if (EPAL.people) EPAL.people.open(x.empId); },
    empty: { icon: 'journal', title: 'No movements in ' + PR().mLabel(ym) }
  }).el);

  /* ---- and every journal payroll wrote into the books that month -------- */
  var posts = payEntries(ym).slice().reverse().map(function (e) {
    var amt = 0; (e.lines || []).forEach(function (l) { amt += +l.dr || 0; });
    return { id: e.id, date: e.date, ref: e.ref || e.id, memo: e.memo || '', amount: amt, entry: e };
  });
  fillH(s, 'post-title', ui.icon('shield-check') + ' Ledger postings');
  fillK(s, 'post-sub', posts.length + ' journal(s) written by payroll');
  box(s, 'posts').appendChild(EPAL.table({
    columns: [
      { key: 'date', label: 'Date', date: true },
      { key: 'ref', label: 'Ref', render: function (r) { return '<span class="txn-id-chip">' + esc(r.ref) + '</span>'; } },
      { key: 'memo', label: 'Posting' },
      { key: 'amount', label: 'Amount', num: true, money: true }
    ],
    rows: posts, searchKeys: ['ref', 'memo'], pageSize: 10, totalKey: 'amount',
    exportName: 'payroll-postings-' + ym + '.csv',
    onRow: function () { EPAL.router.navigate('group/master-accounts/journals'); },
    empty: { icon: 'shield-check', title: 'Nothing posted in ' + PR().mLabel(ym), hint: 'A draft month is not on the books until it is finalized.' }
  }).el);

  mountScreen(page, s);
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
  var rows = t.map(function (e) {
    var led = PR().empLedger(e.id);
    var slips = S.list('pay_slips').filter(function (s) { return s.empId === e.id && s.status !== 'draft'; }).sort(function (a, b) { return a.ym < b.ym ? 1 : -1; });
    var lastPaid = null;
    for (var i = 0; i < slips.length; i++) if (slips[i].paid > 0) lastPaid = slips[i];
    var ls = PR().leaveState(e);
    return {
      id: e.id, emp: e, name: e.name, dept: e.dept || '—', designation: e.designation || '—',
      status: e.status || 'active', salary: +e.salary || 0,
      netDue: led.length ? led[led.length - 1].balance : 0,
      salaryDue: PR().salaryDue(e.id), advance: PR().advanceOutstanding(e.id),
      loan: PR().loanOutstanding(e.id), emi: PR().emiInstallment(e.id),
      encash: ls.value, encashDays: ls.encashableDays, eligible: ls.eligibleFullYear,
      lastPaid: lastPaid ? lastPaid.ym : '', movements: PR().txnsFor(e.id).length + slips.length
    };
  });
  var tbl = EPAL.table({
    columns: [
      { key: 'name', label: 'Employee', render: function (r) { return EPAL.people ? EPAL.people.linkify(r.name, r.id) : '<span class="strong">' + esc(r.name) + '</span>'; } },
      { key: 'id', label: 'ID', render: function (r) { return '<span class="mono xs nowrap" title="' + esc(r.id) + '">' + esc(shortId(r.id)) + '</span>'; } },
      // c-dept / c-desig: the two descriptive columns render 25% smaller than the
      // rest of the row (owner 2026-07-29) — they are the widest non-money text
      // on the sheet, and the width they give back goes to the figures
      { key: 'dept', label: 'Dept', badge: {}, cls: 'c-dept' },
      // soft hyphen: the word stays "Designation" everywhere it is read, copied
      // or exported, but the header may break as "DESIG-/NATION" when the column
      // is squeezed instead of setting a 76px floor for a column of short titles
      { key: 'designation', label: 'Desig­nation', cls: 'c-desig' },
      { key: 'salary', label: 'Salary', num: true, money: true },
      { key: 'netDue', label: 'Net pos.', num: true, sortVal: function (r) { return r.netDue; },
        render: function (r) { return '<span class="num strong ' + (r.netDue >= 0 ? 'text-good' : 'text-bad') + '">' + ui.money(Math.abs(r.netDue)) + '</span> <span class="xs text-mute">' + (r.netDue >= 0 ? 'we owe' : 'they owe') + '</span>'; } },
      { key: 'salaryDue', label: 'Salary due', num: true, sortVal: function (r) { return r.salaryDue; }, render: function (r) { return r.salaryDue ? '<span class="num text-bad">' + ui.money(r.salaryDue) + '</span>' : '—'; } },
      // 'Adv. out' / 'Rec.': with the chips and every figure kept unbreakable,
      // the last columns that would not fit were floored by their own header
      // word — ADVANCE and RECORDS are wider than anything under them.
      { key: 'advance', label: 'Adv. out', num: true, sortVal: function (r) { return r.advance; }, render: function (r) { return r.advance ? '<span class="text-warn">' + ui.money(r.advance) + '</span>' : '—'; } },
      { key: 'loan', label: 'Loan out', num: true, sortVal: function (r) { return r.loan; },
        render: function (r) { return r.loan ? '<span class="text-warn">' + ui.money(r.loan) + '</span>' + (r.emi ? ' <span class="xs text-mute">' + ui.money(r.emi) + '/mo</span>' : ' <span class="xs text-mute">no EMI</span>') : '—'; } },
      { key: 'encash', label: 'Leave encash', num: true, sortVal: function (r) { return r.encash; },
        render: function (r) { return r.encash ? ui.money(r.encash) + ' <span class="xs text-mute">' + r.encashDays.toFixed(1) + 'd</span>' + (r.eligible ? ' <span class="badge badge-good">Eligible</span>' : '') : '—'; } },
      // a month is one token: without .nowrap the narrow column split "May 2026"
      // into "May 202 / 6"
      { key: 'lastPaid', label: 'Last paid', render: function (r) { return r.lastPaid ? '<span class="nowrap">' + esc(PR().mLabel(r.lastPaid)) + '</span>' : '<span class="text-mute">never</span>'; } },
      { key: 'movements', label: 'Rec.', num: true, sortVal: function (r) { return r.movements; } },
      { key: 'status', label: 'Status', badge: { active: 'good', resigned: 'bad', probation: 'warn' } }
    ],
    rows: rows, searchKeys: ['name', 'id', 'dept', 'designation'], quickFilter: 'status', filterPanel: true,
    filters: [{ key: 'dept', label: 'Dept' }, { key: 'status', label: 'Status' }],
    pageSize: 15, exportName: 'staff-accounts.csv', pdfTitle: coFull(CID) + ' — Staff Payroll Accounts',
    onRow: function (r) { if (EPAL.people) EPAL.people.open(r.id); },
    actions: (canCreate() ? [
      { icon: 'cash', title: 'Give advance', onClick: function (r) { moneyForm(r.emp, 'advance'); } },
      { icon: 'bank', title: 'Disburse loan', onClick: function (r) { moneyForm(r.emp, 'loan'); } }
    ] : []).concat(ui.actions({ print: function (r) { statementPrint(r.emp, PR().curYm()); } })),
    empty: { icon: 'people', title: 'No employees on this payroll' }
  });
  var card2 = frag('reg-card');
  slot(card2, 'title').innerHTML = ui.icon('people') + ' Staff Accounts';
  slot(card2, 'sub').textContent = 'search by name OR employee ID · click anyone for their complete file — ledger, payslips, loans, advances, attendance';
  // .tbl-snug: 13 money/identity columns + the action buttons on screen at once,
  // one 10% step of type smaller and higher-contrast (owner 2026-07-29).
  slot(card2, 'body').classList.add('tbl-snug');
  slot(card2, 'body').appendChild(tbl.el);
  page.appendChild(card2);
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
  var pkgs = PR().salaryPackages(CID);
  var staff = team();
  var nameOf = {}; staff.forEach(function (e) { nameOf[e.id] = e.name; });

  fillH(s, 'title', ui.icon('list-ul') + ' Salary Templates List');
  fillK(s, 'sub', pkgs.length + ' template' + (pkgs.length === 1 ? '' : 's') + ' · ' + pkgs.filter(function (p) { return (p.empIds || []).length; }).length + ' assigned');
  var addBtn = act(s, 'new', function () { pkgForm(null); });
  if (addBtn) {
    if (canCreate()) addBtn.innerHTML = ui.icon('plus-lg') + ' Add New Salary Template';
    else addBtn.parentNode.removeChild(addBtn);      // removed, never hidden
  }
  fillH(s, 'note', ui.icon('info-circle') + ' A template states the actual taka. An employee on one is paid its <strong>total</strong>, split exactly as it says; anyone <em>not</em> on a template is still computed from the percentages in Structure below. Income tax, provident fund, absence, late and leave-encashment always come from Structure, so the statutory rules stay in one place.');

  var rows = pkgs.map(function (p, i) {
    var ids = (p.empIds || []).filter(function (id) { return nameOf[id]; });
    var emp = ids.length ? empById(ids[0]) : null;
    return {
      id: p.id, no: i + 1, name: p.name, pkg: p,
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
    columns: [
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
    ],
    actions: canCreate() ? [
      { icon: 'pencil-square', title: 'Edit this template', onClick: function (r) { pkgForm(r.pkg); } },
      { icon: 'toggles', title: 'Turn overtime on / off', onClick: function (r) {
        var p = r.pkg, on = p.otEligible === false;
        PR().savePackage({ id: p.id, companyId: p.companyId, otEligible: on });
        ui.toast('Overtime ' + (on ? 'enabled' : 'disabled') + ' · ' + p.name, 'success'); EPAL.router.render();
      } },
      { icon: 'exclamation-diamond', title: 'Deduct a punishment from a month', onClick: function (r) { fineForm(r); } },
      { icon: 'trash', title: 'Delete this template', onClick: function (r) { deletePkg(r); } }
    ] : [{ icon: 'eye', title: 'Open this employee\'s file', onClick: function (r) { if (r.empId && EPAL.people) EPAL.people.open(r.empId); } }],
    onRow: function (r) { if (r.empId && EPAL.people) EPAL.people.open(r.empId); }
  });
  box(s, 'list').appendChild(tbl.el);
  mountScreen(page, s);
}

/* Add / edit one template. TOTAL IS NOT TYPED — it is the five components added
 * up, so the list can never show a total the payslip disagrees with. */
function pkgForm(p) {
  var isNew = !p;
  p = p || { companyId: CID, otEligible: true };
  var taken = {};
  PR().salaryPackages(CID).forEach(function (o) {
    if (o.id === p.id) return;
    (o.empIds || []).forEach(function (id) { taken[id] = o.name; });
  });
  var mine = (p.empIds || [])[0] || '';
  var opts = [['', '— not assigned (a pay grade, nobody on it yet) —']].concat(team().map(function (e) {
    return [e.id, e.name + ' · ' + e.id + (taken[e.id] ? '  (moves off "' + taken[e.id] + '")' : '')];
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
        hint: 'The assigned employee is paid THIS template from the current draft month on. One person, one template.' },
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
      PR().savePackage({
        id: p.id, companyId: CID, name: String(v.name).trim(),
        basic: +v.basic || 0, house: +v.house || 0, medical: +v.medical || 0,
        conveyance: +v.conveyance || 0, other: +v.other || 0, bonus: +v.bonus || 0,
        otEligible: !!v.otEligible, otRate: +v.otRate || 0,
        fine: +v.fine || 0, fineNote: String(v.fineNote || '').trim(),
        empIds: v.empId ? [v.empId] : [], seeded: false
      });
      regenDraft();
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
      PR().deletePackage(r.id); regenDraft();
      ui.toast('Template deleted', 'success'); EPAL.router.render();
    });
}

/* Re-generate the CURRENT DRAFT month so a template change shows up immediately.
 * Deliberately only the draft: generate() rewrites every slip it touches, and a
 * finalized month's figures are what was posted to the ledger — they change only
 * when someone reopens the month on purpose. */
function regenDraft() {
  var ym = PR().curYm(), run = PR().getRun(CID, ym);
  if (!run || run.status === 'draft') { try { PR().generate(CID, ym); } catch (e) {} }
}

function tplView(page) {
  tplListView(page);
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
  PR().generate(CID, ym); PR().refreshRunStatus(CID, ym);
  var run = PR().getRun(CID, ym);
  var slips = PR().slipsFor(CID, ym).slice().sort(function (a, b) { return (a.empName || '') < (b.empName || '') ? -1 : 1; });
  var gross = sum(slips, function (s) { return s.earnedGross; }), net = sum(slips, function (s) { return PR().slipPayable(s); });
  var paid = sum(slips, function (s) { return s.paid || 0; }), due = net - paid;
  var st = run ? run.status : 'draft', inWin = PR().inCorrectionWindow(CID, ym);

  // THE DASHBOARD ROW (owner 2026-07-28) — the five flat KPI tiles became the
  // same four-card row Manage Banks uses, scoped to the selected month. Every
  // figure the tiles carried is still here: Headcount and Gross are drill facts,
  // Net Payable is the hero, Paid and Outstanding are the payment-progress card.
  var meta = coMeta(CID);
  var advRec = sum(slips, advOf), emiRec = sum(slips, emiOf);
  page.appendChild(dashRow({
    hue: meta.accent, icon: meta.icon, co: coShort(CID), coSub: PR().mLabel(ym) + ' payroll run · ' + cap(st),
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
      rows: slips.map(function (s) { return { up: s.paid || 0, down: dueOf(s), tip: s.empName + ' · paid ' + ui.money(s.paid || 0) + (dueOf(s) ? ' · due ' + ui.money(dueOf(s)) : '') }; }),
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

  var runs = S.list('pay_runs').filter(function (r) { return r.companyId === CID; }).sort(function (a, b) { return a.ym < b.ym ? 1 : -1; });
  var sel = el('select.input', { onchange: function () { payYm = this.value; EPAL.router.render(); } }); sel.classList.add('tw-max-w-[230px]');
  runs.forEach(function (r) { var o = el('option', { value: r.ym, text: PR().mLabel(r.ym) + '  ·  ' + cap(r.status) }); if (r.ym === ym) o.selected = true; sel.appendChild(o); });
  var rcard = frag('run-card');
  var left = slot(rcard, 'left');
  left.appendChild(sel);
  left.appendChild(el('span.badge.badge-' + (st === 'paid' ? 'good' : st === 'due' ? 'bad' : st === 'draft' ? 'warn' : 'info'), { text: cap(st) }));
  var actions = slot(rcard, 'actions');
  actions.appendChild(el('button.btn.btn-ghost', { html: ui.icon('printer') + ' Print Sheet', onclick: function () { printSheetForm(slips, ym); } }));
  if (canCreate()) {
    if (st === 'draft') actions.appendChild(el('button.btn.btn-primary', { html: ui.icon('lock') + ' Finalize & Accrue', onclick: function () { finalizeRun(ym, net); } }));
    if (st !== 'draft') actions.appendChild(el('button.btn.btn-outline', { html: ui.icon('arrow-counterclockwise') + ' Reopen Draft',
      title: 'Rewind to the BEFORE-ACCRUED state — repeatable (demo-safe)',
      onclick: function () {
        var paidCount = slips.filter(function (s) { return s.paid > 0; }).length;
        ui.confirm({ title: 'Reopen ' + PR().mLabel(ym) + ' as Draft?', confirmLabel: 'Reopen Draft',
          text: 'Shows the month as it was BEFORE accrual: ' + (paidCount ? paidCount + ' payment(s) are reversed, ' : '') + 'the accrual is lifted from the books, and ✎ adjustments unlock. You can Finalize & Accrue again any time — fully repeatable.' })
          .then(function (ok) { if (!ok) return; PR().unfinalize(CID, ym); ui.toast('Back to draft — before-accrued state', 'success'); EPAL.router.render(); });
      } }));
    if (st !== 'draft' && due > 0) actions.appendChild(el('button.btn.btn-primary', { html: ui.icon('cash-coin') + ' Pay All', onclick: function () { payAll(ym); } }));
  }
  // generate() above normally creates the run, but a hydrated install can answer
  // with slips and no run row — say so rather than crash (live 2026-07-28)
  slot(rcard, 'status').innerHTML = !run
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
  var tbl = EPAL.table({
    columns: [
      { key: 'empName', label: 'Employee', render: function (s) { return EPAL.people ? EPAL.people.linkify(s.empName, s.empId) : '<span class="strong">' + esc(s.empName) + '</span>'; } },
      { key: 'gross', label: 'Gross', num: true, money: true },
      { key: 'overtime', label: 'OT', num: true, render: function (s) { return s.overtime ? ui.money(s.overtime) : '—'; }, sortVal: function (s) { return s.overtime || 0; } },
      { key: 'bonus', label: 'Bonus', num: true, render: function (s) { var v = bonusOf(s); return v ? ui.money(v) : '—'; }, sortVal: bonusOf },
      { key: 'encashAmt', label: 'Encash', num: true, money: true },
      { key: 'adv', label: 'Advance', num: true, sortVal: advOf, render: function (s) { var v = advOf(s); return v ? '<span class="text-warn">' + ui.money(v) + '</span>' : '—'; } },
      { key: 'emi', label: 'Loan EMI', num: true, sortVal: emiOf, render: function (s) { var v = emiOf(s); return v ? '<span class="text-warn">' + ui.money(v) + '</span>' : '—'; } },
      { key: 'absentDeduction', label: 'Absent', num: true, sortVal: function (s) { return s.absentDeduction || 0; }, render: function (s) { return s.absentDeduction ? '<span class="text-bad">' + ui.money(s.absentDeduction) + '</span>' : '—'; } },
      { key: 'other', label: 'Other Ded.', num: true, sortVal: otherOf, render: function (s) { var v = otherOf(s); return v ? ui.money(v) : '—'; } },
      { key: 'net', label: 'Net Payable', num: true, sortVal: function (s) { return PR().slipPayable(s); }, render: function (s) { return '<span class="num strong">' + ui.money(PR().slipPayable(s)) + '</span>'; } },
      { key: 'paid', label: 'Paid', num: true, sortVal: function (s) { return s.paid || 0; }, render: function (s) { return s.paid ? '<span class="text-good">' + ui.money(s.paid) + '</span>' : '—'; } },
      { key: 'due', label: 'Due', num: true, sortVal: dueOf, render: function (s) { var v = dueOf(s); return v ? '<span class="num strong text-bad">' + ui.money(v) + '</span>' : '—'; } },
      { key: 'status', label: 'Status', badge: { draft: '', accrued: 'info', partial: 'warn', due: 'bad', paid: 'good' } }
    ],
    rows: slips, searchKeys: ['empName', 'empId', 'dept'], quickFilter: 'status', filterPanel: true, filters: [{ key: 'dept', label: 'Dept' }],
    totalKey: 'net',
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
  slot(scard, 'title').innerHTML = ui.icon('cash-stack') + ' Salary Sheet — ' + PR().mLabel(ym);
  slot(scard, 'sub').textContent = 'click a row = payslip · 💰 manage pay/due/status · ✎ adjust';
  slot(scard, 'body').appendChild(tbl.el);
  page.appendChild(scard);

  // PAYROLL HISTORY sits directly under the sheet (owner 2026-07-28). It goes in
  // BEFORE the pay-individual-salaries grid on purpose: that grid only exists
  // when the run is finalized and something is still owed, so appending after it
  // would move the history card up and down the page as the run status changes.
  page.appendChild(payrollHistoryCard());

  if (st !== 'draft' && due > 0 && canCreate()) {
    var pgrid = frag('grid-auto-compact');
    slips.forEach(function (s) { var payable = PR().slipPayable(s), out = payable - (s.paid || 0); if (out <= 0) return;
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
function finalizeRun(ym, net) {
  ui.confirm({ title: 'Finalize ' + PR().mLabel(ym) + '?', text: 'Locks corrections and accrues salaries + leave encashment to the ledger. Net ' + ui.money(net) + '.', confirmLabel: 'Finalize' })
    .then(function (ok) { if (!ok) return; try { PR().finalize(CID, ym); ui.toast('Payroll finalized', 'success'); EPAL.router.render(); } catch (e) { ui.toast(e.message || 'Failed', 'error'); } });
}
function payAll(ym) {
  ui.confirm({ title: 'Pay all outstanding?', text: 'Posts each payment (recovers any advance).', confirmLabel: 'Pay All' })
    .then(function (ok) { if (!ok) return; PR().slipsFor(CID, ym).forEach(function (s) { try { PR().pay(s.empId, ym); } catch (e) {} }); ui.toast('Salaries paid', 'success'); EPAL.router.render(); });
}
function payForm(s, ym) {
  var payable = PR().slipPayable(s), out = payable - (s.paid || 0);
  EPAL.formModal({ title: 'Pay — ' + s.empName, icon: 'cash-coin', size: 'sm', record: { amount: out, method: 'Bank' },
    fields: [ { key: 'amount', label: 'Amount (৳)', type: 'money', default: out, min: 0, max: out, hint: 'Outstanding ' + ui.money(out) + ' — pay less for a partial (rest becomes Due, shown on next month\'s payslip).' },
      { key: 'method', label: 'Method', type: 'select', options: ['Bank', 'Cash', 'bKash', 'Nagad', 'Rocket', 'Upay', 'Card', 'Cheque'], default: 'Bank' } ],
    saveLabel: 'Post Payment', onSave: function (v) { try { PR().pay(s.empId, ym, +v.amount, v.method); ui.toast('Payment posted', 'success'); EPAL.router.render(); return true; } catch (e) { ui.toast(e.message || 'Failed', 'error'); return false; } } });
}

/* ---- MANAGE SALARY modal (legacy el()) ---------------------------------- */
function manageSalary(s, ym) {
  var e = empById(s.empId); if (!e) { ui.toast('Employee not found', 'error'); return; }
  var run = PR().getRun(CID, ym), st = run ? run.status : 'draft';
  var payable = PR().slipPayable(s), out = Math.max(0, payable - (s.paid || 0));
  var advOut = PR().advanceOutstanding(e.id), arrears = PR().previousDue(e.id, ym);
  var body = el('div');
  var m = ui.modal({ title: 'Manage Salary — ' + s.empName + ' · ' + PR().mLabel(ym), icon: 'wallet2', size: 'md', body: body, footer: false });
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
      el('div.stat', null, [el('div.stat-label', { text: 'Paid' }), el('div.stat-value', { text: ui.money(s.paid || 0) })]),
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
}

/* ---- PRINT SHEET with column marks (legacy el()) ------------------------ */
function printSheetForm(slips, ym) {
  var COLS = [
    ['gross', 'Gross', function (s) { return s.gross; }],
    ['overtime', 'Overtime', function (s) { return s.overtime || 0; }],
    ['bonus', 'Bonus', function (s) { return bonusOf(s); }],
    ['encash', 'Leave Encashment', function (s) { return s.encashAmt || 0; }],
    ['advance', 'Advance', function (s) { return (s.paid > 0) ? (s.advanceRecovered || 0) : Math.min(PR().advanceOutstanding(s.empId), Math.max(0, PR().slipPayable(s))); }],
    ['emi', 'Loan EMI', function (s) { return (s.paid > 0) ? (s.loanRecovered || 0) : PR().emiInstallment(s.empId); }],
    ['absent', 'Absent', function (s) { return s.absentDeduction || 0; }],
    ['other', 'Other Ded.', function (s) { return otherOf(s); }],
    ['net', 'Net Payable', function (s) { return PR().slipPayable(s); }],
    ['paid', 'Paid', function (s) { return s.paid || 0; }],
    ['due', 'Due', function (s) { return Math.max(0, PR().slipPayable(s) - (s.paid || 0)); }],
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
      var head2 = '<tr><th>Employee</th>' + chosen.map(function (c) { return '<th style="text-align:right">' + esc(c[1]) + '</th>'; }).join('') + '</tr>';
      var totals = {};
      var rows = slips.map(function (s) {
        return '<tr><td>' + esc(s.empName) + '</td>' + chosen.map(function (c) {
          var val = c[2](s);
          if (typeof val === 'number') { totals[c[0]] = (totals[c[0]] || 0) + val; return '<td style="text-align:right">' + ui.money(val) + '</td>'; }
          return '<td style="text-align:right">' + esc(String(val)) + '</td>';
        }).join('') + '</tr>';
      }).join('');
      var totRow = '<tr><th>Total</th>' + chosen.map(function (c) { return '<th style="text-align:right">' + (totals[c[0]] != null ? ui.money(totals[c[0]]) : '') + '</th>'; }).join('') + '</tr>';
      ui.printDoc({ title: 'Salary Sheet — ' + PR().mLabel(ym), subtitle: coShort(CID) + ' · Payroll', meta: slips.length + ' employees · generated ' + ui.date(today()), footer: 'System-generated salary sheet — Confidential',
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
      { key: 'lateDays', label: 'Late count', type: 'number', min: 0, default: 0, hint: 'Every ' + (PR().template(CID).latesPerAbsent || 3) + ' lates = one day.' },
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

/* =================================================== LOAN MANAGEMENT */
function loansView(page) {
  var t = team();
  var byEmp = t.map(function (e) { return { e: e, out: PR().loanOutstanding(e.id) }; });
  var txns = S.list('pay_txns').filter(function (x) { return x.companyId === CID && (x.type === 'loan' || x.type === 'loan-repay'); }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
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
      columns: [ { key: 'name', label: 'Employee', render: function (r) { return '<span class="strong">' + esc(r.e.name) + '</span>'; } },
        { key: 'out', label: 'Outstanding', num: true, render: function (r) { return '<span class="num strong text-warn">' + ui.money(r.out) + '</span>'; }, sortVal: function (r) { return r.out; } } ],
      rows: active, pageSize: 8, onRow: function (r) { moneyForm(r.e, 'loan-repay'); },
      actions: ui.actions({ edit: canCreate() ? function (r) { moneyForm(r.e, 'loan-repay'); } : null }), empty: { icon: 'bank', title: 'No active loans' }
    });
    var lc = frag('reg-card'); slot(lc, 'title').innerHTML = ui.icon('people') + ' Employees with loans'; slot(lc, 'sub').textContent = 'click to record a repayment'; slot(lc, 'body').appendChild(lt.el); page.appendChild(lc);
  }
  var emis = txns.filter(function (x) { return x.type === 'loan-repay' && /EMI auto-deducted/.test(x.memo || ''); });
  if (emis.length) {
    var et = EPAL.table({
      columns: [
        { key: 'date', label: 'Deducted on', date: true },
        { key: 'empName', label: 'Employee', render: function (x) { return EPAL.people ? EPAL.people.linkify(x.empName, x.empId) : esc(x.empName); } },
        { key: 'memo', label: 'From which salary', render: function (x) { return esc(String(x.memo || '').replace('EMI auto-deducted from ', '')); } },
        { key: 'amount', label: 'EMI deducted', num: true, money: true }
      ],
      rows: emis, pageSize: 8, totalKey: 'amount', exportName: 'emi-history.csv', pdfTitle: 'Loan EMI Deduction History',
      empty: { icon: 'bank', title: 'No EMI deductions yet' }
    });
    var ec = frag('reg-card'); slot(ec, 'title').innerHTML = ui.icon('calendar2-check') + ' EMI Deduction History'; slot(ec, 'sub').textContent = 'auto-deducted from salary · dated individually'; slot(ec, 'body').appendChild(et.el); page.appendChild(ec);
  }
  page.appendChild(txnTable('Loan transactions', txns));
}

/* =================================================== ADVANCE SALARY */
function advanceView(page) {
  var t = team();
  var byEmp = t.map(function (e) { return { e: e, out: PR().advanceOutstanding(e.id) }; });
  var txns = S.list('pay_txns').filter(function (x) { return x.companyId === CID && x.type === 'advance'; }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
  var totalOut = sum(byEmp, function (x) { return x.out; });
  var active = byEmp.filter(function (x) { return x.out > 0; });

  // same single-event-list rule as Loan Management above — see the note there
  var AE = advanceEvents(), N = 12;
  var given = sum(outflowOnly(AE), function (e) { return e.delta; });

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
      columns: [ { key: 'name', label: 'Employee', render: function (r) { return '<span class="strong">' + esc(r.e.name) + '</span>'; } },
        { key: 'out', label: 'Outstanding', num: true, render: function (r) { return '<span class="num strong text-warn">' + ui.money(r.out) + '</span>'; }, sortVal: function (r) { return r.out; } } ],
      rows: active, pageSize: 8, empty: { icon: 'cash', title: 'No outstanding advances' }
    });
    var ac = frag('reg-card'); slot(ac, 'title').innerHTML = ui.icon('people') + ' Outstanding advances'; slot(ac, 'sub').textContent = 'recovered automatically from the next salary'; slot(ac, 'body').appendChild(at.el); page.appendChild(ac);
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
  var pend = PR().advRequests({ companyId: CID, status: 'pending' });
  if (!pend.length) return;                 // nothing waiting → no card at all
  var card = shell('advreq');
  fillH(card, 'title', ui.icon('hourglass-split') + ' Advance requests waiting on you');
  fillK(card, 'sub', pend.length + ' pending · ' + ui.money(sum(pend, function (r) { return r.amount; })) + ' asked for');
  var host = box(card, 'rows');
  var tpl = host.querySelector('[data-proto="row"]');
  tpl.parentNode.removeChild(tpl);          // the prototype itself never renders
  pend.forEach(function (r) {
    var row = tpl.cloneNode(true);
    row.removeAttribute('hidden'); row.removeAttribute('data-proto');
    fillH(row, 'name', EPAL.people ? EPAL.people.linkify(r.empName, r.empId) : esc(r.empName));
    fillK(row, 'when', 'asked ' + ui.date(r.requestedOn));
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
  var rows = PR().advRequests({ companyId: CID }).filter(function (r) { return r.status !== 'pending'; });
  if (!rows.length) return;
  var tbl = EPAL.table({
    columns: [
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
    ],
    rows: rows, searchKeys: ['empName', 'reason', 'note'], quickFilter: 'status', pageSize: 10,
    exportName: 'advance-requests.csv', pdfTitle: coFull(CID) + ' — Advance Salary Requests',
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
        options: team().map(function (e) { return [e.id, e.name + ' · ' + (e.dept || '—')]; }) },
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
      approve ? { key: 'method', label: 'Paid from', type: 'select', required: true, searchable: true,
        options: (EPAL.pay && EPAL.pay.options) ? EPAL.pay.options(CID) : ['Bank', 'Cash'] } : null,
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

function txnTable(title, txns) {
  var tbl = EPAL.table({
    columns: [ { key: 'date', label: 'Date', date: true }, { key: 'empName', label: 'Employee' },
      { key: 'type', label: 'Type', badge: { advance: 'warn', loan: 'warn', 'loan-repay': 'good' } },
      { key: 'memo', label: 'Note' }, { key: 'method', label: 'Method', badge: {} },
      { key: 'amount', label: 'Amount', num: true, money: true } ],
    rows: txns, searchKeys: ['empName', 'empId', 'memo'], pageSize: 10, exportName: 'payroll-txns.csv', empty: { icon: 'journal', title: 'No transactions' }
  });
  var card2 = frag('head-card'); slot(card2, 'title').innerHTML = ui.icon('journal-text') + ' ' + title; slot(card2, 'body').appendChild(tbl.el); return card2;
}
function moneyForm(emp, type) {
  var meta = { advance: ['Give Advance Salary', 'cash', 'Advance salary'], loan: ['Disburse Staff Loan', 'bank', 'Staff loan'], 'loan-repay': ['Record Loan Repayment', 'arrow-return-left', 'Loan repayment'] }[type];
  var rec = { date: today(), method: 'Bank' }; if (emp) rec.empId = emp.id;
  EPAL.formModal({
    title: meta[0], icon: meta[1], size: 'sm', record: rec,
    fields: [
      { key: 'empId', label: 'Employee', type: 'select', required: true, options: team().map(function (e) { return [e.id, e.name + ' · ' + e.dept]; }) },
      { key: 'amount', label: 'Amount (৳)', type: 'money', required: true, min: 0 },
      type === 'loan' ? { key: 'emiMonths', label: 'Repay over (months)', type: 'number', min: 0, default: 0 } : null,
      { key: 'date', label: 'Date', type: 'date', default: today() },
      // WHICH ACCOUNT the money moves through (audit 2026-07-28) — a real one, so
      // handing an employee an advance actually leaves an account and lands in its
      // history, instead of moving an abstract 1010 and nothing else
      { key: 'method', label: type === 'loan-repay' ? 'Received into' : 'Paid from', type: 'select', required: true, searchable: true,
        options: (EPAL.pay && EPAL.pay.options) ? EPAL.pay.options(CID) : ['Bank', 'Cash'] },
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
  var slips = S.list('pay_slips').filter(function (s) { return s.companyId === CID && s.status !== 'draft'; }).sort(function (a, b) { return a.ym < b.ym ? 1 : -1; });
  var months = S.list('pay_runs').filter(function (r) { return r.companyId === CID; }).map(function (r) { return r.ym; }).sort().reverse();
  var pick = frag('pick-card');
  var row = slot(pick, 'row');
  row.appendChild(field('Employee', (function () { var s = el('select.input', { id: 'ps-emp' }); t.forEach(function (e) { s.appendChild(el('option', { value: e.id, text: e.name })); }); return s; })()));
  row.appendChild(field('Month', (function () { var s = el('select.input', { id: 'ps-ym' }); (months.length ? months : [PR().curYm()]).forEach(function (m) { s.appendChild(el('option', { value: m, text: PR().mLabel(m) })); }); return s; })()));
  row.appendChild(field(' ', el('button.btn.btn-primary', { html: ui.icon('receipt') + ' View Statement', onclick: function () { var e = empById(document.getElementById('ps-emp').value); var ym = document.getElementById('ps-ym').value; if (e) statement(e, ym); } })));
  page.appendChild(pick);

  var tbl = EPAL.table({
    columns: [
      { key: 'empName', label: 'Employee', render: function (s) { return EPAL.people ? EPAL.people.linkify(s.empName, s.empId) : '<span class="strong">' + esc(s.empName) + '</span>'; } },
      { key: 'ym', label: 'Month', render: function (s) { return PR().mLabel(s.ym); } },
      { key: 'earnedGross', label: 'Gross', num: true, money: true },
      { key: 'net', label: 'Net', num: true, sortVal: function (s) { return PR().slipPayable(s); }, render: function (s) { return '<span class="num strong">' + ui.money(PR().slipPayable(s)) + '</span>'; } },
      { key: 'encashAmt', label: 'Leave Encash', num: true, money: true },
      { key: 'status', label: 'Status', badge: { accrued: 'info', partial: 'warn', due: 'bad', paid: 'good' } }
    ],
    rows: slips, searchKeys: ['empName', 'empId'], quickFilter: 'status', pageSize: 12, exportName: 'payslips.csv', pdfTitle: 'Travels Payslips',
    onRow: function (s) { var e = empById(s.empId); if (e) statement(e, s.ym); },
    actions: ui.actions({ print: function (s) { var e = empById(s.empId); if (e) statementPrint(e, s.ym); } }),
    empty: { icon: 'receipt', title: 'No payslips yet', hint: 'Finalize a payroll month in Salary Manage.' }
  });
  var card2 = frag('head-card'); slot(card2, 'title').innerHTML = ui.icon('card-list') + ' All Payslips'; slot(card2, 'body').appendChild(tbl.el); page.appendChild(card2);
}
function field(label, input) { return el('div', null, [ el('label.text-mute.sm', { text: label, style: { display: 'block', marginBottom: '3px' } }), input ]); }

function statement(e, ym) { if (EPAL.people) EPAL.people.statement(e, ym); }
function statementPrint(e, ym) { if (EPAL.people) EPAL.people.payslipPrint(e, ym); }

/* =================================================== PAYROLL REPORTS */
function reportsView(page) {
  var t = team();
  var liability = PR().encashmentLiability(CID);
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

  var encRows = t.map(function (e) { var ls = PR().leaveState(e); return { e: e, name: e.name, dept: e.dept, days: ls.encashableDays, value: ls.value, eligible: ls.eligibleFullYear }; }).filter(function (r) { return r.value > 0; });
  var encTbl = EPAL.table({
    columns: [
      { key: 'name', label: 'Employee', render: function (r) { return EPAL.people ? EPAL.people.linkify(r.name, r.e.id) : '<span class="strong">' + esc(r.name) + '</span>'; } },
      { key: 'dept', label: 'Dept', badge: {} },
      { key: 'days', label: 'Accrued days', num: true, sortVal: function (r) { return r.days; }, render: function (r) { return r.days.toFixed(2); } },
      { key: 'value', label: 'Value', num: true, money: true },
      { key: 'eligible', label: 'Eligibility', render: function (r) { return r.eligible ? '<span class="badge badge-good">Eligible</span>' : '<span class="badge badge-warn">Accruing</span>'; } }
    ],
    rows: encRows, pageSize: 10, exportName: 'leave-encashment-liability.csv', pdfTitle: 'Leave Encashment Liability',
    actions: ui.actions({ edit: canCreate() ? function (r) { payEncashFlow(r.e); } : null }),
    onRow: function (r) { statement(r.e, PR().curYm()); }, empty: { icon: 'piggy-bank', title: 'No accrued encashment' }
  });
  page.appendChild(reportCard('Leave Encashment Liability', 'piggy-bank', ui.money(liability) + ' total provision · ✎ to pay out & reset', encTbl.el));

  var dueRows = t.map(function (e) { return { id: e.id, name: e.name, dept: e.dept, amt: PR().salaryDue(e.id) }; }).filter(function (r) { return r.amt > 0; });
  if (dueRows.length) page.appendChild(reportCard('Salary Due', 'hourglass-split', dueRows.length + ' employees owed', simpleTbl(dueRows, 'Outstanding')));
  var advRows = t.map(function (e) { return { id: e.id, name: e.name, dept: e.dept, amt: PR().advanceOutstanding(e.id) }; }).filter(function (r) { return r.amt > 0; });
  if (advRows.length) page.appendChild(reportCard('Advance Register', 'cash', 'who holds advance now', simpleTbl(advRows, 'Advance held')));
  var loanRows = t.map(function (e) { return { id: e.id, name: e.name, dept: e.dept, amt: PR().loanOutstanding(e.id) }; }).filter(function (r) { return r.amt > 0; });
  if (loanRows.length) page.appendChild(reportCard('Loan Outstanding', 'bank', 'staff loans in progress', simpleTbl(loanRows, 'Loan balance')));

  var dc = PR().departmentCost(CID);
  var dcTbl = EPAL.table({
    columns: [ { key: 'dept', label: 'Department', render: function (r) { return '<span class="strong">' + esc(r.dept) + '</span>'; } },
      { key: 'heads', label: 'Headcount', num: true, render: function (r) { return String(t.filter(function (e) { return (e.dept || '—') === r.dept; }).length); } },
      { key: 'cost', label: 'Monthly Cost', num: true, money: true } ],
    rows: dc, pageSize: 10, exportName: 'department-cost.csv', empty: { icon: 'diagram-3', title: 'No data' }
  });
  page.appendChild(reportCard('Department Cost (monthly gross)', 'diagram-3', 'salary cost by department', dcTbl.el));

  var incRows = []; t.forEach(function (e) { (e.salaryHistory || []).forEach(function (h) { incRows.push({ name: e.name, date: h.date, from: h.from, to: h.to, by: h.by || '' }); }); });
  incRows.sort(function (a, b) { return a.date < b.date ? 1 : -1; });
  if (incRows.length) {
    var incTbl = EPAL.table({
      columns: [ { key: 'date', label: 'Date', date: true }, { key: 'name', label: 'Employee' },
        { key: 'from', label: 'From', num: true, money: true }, { key: 'to', label: 'To', num: true, money: true },
        { key: 'change', label: 'Change', num: true, sortVal: function (r) { return (r.to || 0) - (r.from || 0); }, render: function (r) { var d = (r.to || 0) - (r.from || 0); return '<span class="num ' + (d >= 0 ? 'text-good' : 'text-bad') + '">' + (d >= 0 ? '+' : '') + ui.money(d) + '</span>'; } } ],
      rows: incRows, pageSize: 10, exportName: 'increment-history.csv', empty: { icon: 'graph-up-arrow', title: 'No increments' }
    });
    page.appendChild(reportCard('Increment History', 'graph-up-arrow', incRows.length + ' salary revisions', incTbl.el));
  }
}
function reportCard(title, icon, sub, node) {
  var card2 = frag('reg-card'); slot(card2, 'title').innerHTML = ui.icon(icon) + ' ' + title; slot(card2, 'sub').textContent = sub; slot(card2, 'body').appendChild(node); return card2;
}
function simpleTbl(rows, label) {
  return EPAL.table({ columns: [ { key: 'name', label: 'Employee', render: function (r) { return EPAL.people ? EPAL.people.linkify(r.name, r.id || r.name) : '<span class="strong">' + esc(r.name) + '</span>'; } }, { key: 'dept', label: 'Dept', badge: {} }, { key: 'amt', label: label, num: true, money: true } ], rows: rows, pageSize: 8, empty: { icon: 'inbox', title: 'Nothing outstanding' } }).el;
}
function payEncashFlow(e) {
  var ls = PR().leaveState(e);
  // it names the account it is paid from (audit 2026-07-28), so the payout leaves a
  // real balance and shows in that account's history like every other payment
  if (EPAL.pay && EPAL.pay.ask) {
    EPAL.pay.ask({ title: 'Pay leave encashment · ' + e.name, icon: 'cash-coin', owner: CID,
      amount: ls.value, saveLabel: 'Pay Encashment', onPick: function (src) {
        try { PR().payEncashment(e.id, { method: src && src.bank ? 'bank:' + src.bank.id : 'Bank' });
          ui.toast('Encashment paid' + (src && src.bank ? ' from ' + src.bank.name : ''), 'success'); EPAL.router.render(); }
        catch (x) { ui.toast(x.message || 'Failed', 'error'); } } });
    return;
  }
  ui.confirm({ title: 'Pay leave encashment — ' + e.name + '?', text: 'Pays ' + ls.encashableDays.toFixed(2) + ' accrued days = ' + ui.money(ls.value) + ' (DR Leave-Encash Payable / CR Bank) and resets the accrual.', confirmLabel: 'Pay Encashment' })
    .then(function (ok) { if (!ok) return; try { PR().payEncashment(e.id); ui.toast('Encashment paid', 'success'); EPAL.router.render(); } catch (x) { ui.toast(x.message || 'Failed', 'error'); } });
}

/* ---- small helpers ----------------------------------------------------*/
function drow(k, v) { return el('div.data-row', null, [ el('div.text-mute.sm.flex-1', { text: k }), el('div.strong', { text: v == null || v === '' ? '—' : String(v) }) ]); }
function card(text) { var c = frag('card-body-card'); slot(c, 'body').textContent = text; return c; }
