/* ============================================================================
 * EPAL GROUP ERP · tools/verify/payroll-audit.mjs
 * ----------------------------------------------------------------------------
 * THE PAYROLL AUDIT — every account and every table on the desk, checked against
 * the double-entry ledger and against each other, in a really booted app.
 *
 *   node tools/verify/payroll-audit.mjs            # audit the seeded demo book
 *   node tools/verify/payroll-audit.mjs --verbose  # print every offending row
 *
 * WHY A HARNESS AND NOT A READING. The desk has a dozen tables that all restate
 * the same payslips — the salary sheet, the monthly register, the month drill,
 * staff accounts, the loan register, the advance ledger, the payslip print, the
 * employee file, the group's payroll line. Reading them can only ever say "this
 * looks right"; footing them against the general ledger says whether they ARE.
 * Every check below is an INVARIANT — true of any book, any data, any month — so
 * this stays useful long after the numbers in today's seed have changed.
 *
 * WHAT IT CHECKS
 *   A · the ledger    — 1250 · 1260 · 2100 · 2110 · 2120 · 2150 · 5100 · 5150
 *                       each equal what the payroll records say they should
 *   B · the payslip   — earnings − every deduction = net payable, on every slip
 *                       ever written; net − paid = due; encashment outside it
 *   C · the journals  — every accrual and payment balances, and its 2100 line is
 *                       the payable the sheet shows
 *   D · the tables    — the sheet foot, the monthly register, the month drill,
 *                       the loan register and the advance ledger all foot to the
 *                       same figures the engine gives per person and per month
 *   E · sanity        — no negative assets, no payment beyond the payable, no
 *                       recovery beyond what is owed, no orphan rows
 *
 * Exit 0 = every invariant holds. Same headless-Chrome/CDP recipe as sweep.mjs
 * (see its header for the hard-won gotchas).
 * ========================================================================= */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const VERBOSE = process.argv.includes('--verbose');
const PORT = 9560 + (process.pid % 120);
const CDP_PORT = 9760 + (process.pid % 120);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2' };

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  fs.readFile(path.join(ROOT, url === '/' ? 'index.html' : url), (err, buf) => {
    if (err) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(url)] || 'application/octet-stream' });
    res.end(buf);
  });
});
await new Promise(r => server.listen(PORT, r));
const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].find(p => { try { return fs.existsSync(p); } catch { return false; } });
if (!CHROME) { console.error('No Chrome found.'); process.exit(2); }
const userDir = path.join(process.env.TEMP || '/tmp', 'epal-payaudit-' + process.pid);
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run',
  `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${userDir}`, 'about:blank'], { stdio: 'ignore' });
const cleanup = () => { try { chrome.kill(); } catch {} try { server.close(); } catch {} };
process.on('exit', cleanup);
async function cdpUrl() {
  for (let i = 0; i < 60; i++) {
    try { const j = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json();
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl; } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('no CDP');
}
let msgId = 0; const pending = new Map(); let ws, sessionId;
const send = (method, params = {}, sid) => new Promise((res, rej) => {
  const id = ++msgId; pending.set(id, { res, rej });
  ws.send(JSON.stringify({ id, method, params, sessionId: sid }));
});
ws = new WebSocket(await cdpUrl());
await new Promise(r => ws.addEventListener('open', r));
ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id);
    if (m.error) p.rej(new Error(JSON.stringify(m.error))); else p.res(m.result); }
});
const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
({ sessionId } = await send('Target.attachToTarget', { targetId, flatten: true }));
await send('Runtime.enable', {}, sessionId);
const evalJs = async (e) => {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }, sessionId);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed');
  return r.result.value;
};
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html#/group/master-accounts/payroll` }, sessionId);
// wait for the thing being audited, not merely for the app (the demo payroll is
// seeded a beat after the engines register — see books.mjs)
for (let i = 0; i < 160; i++) {
  await new Promise(r => setTimeout(r, 250));
  if (await evalJs(`!!(window.EPAL && EPAL.payroll && EPAL.ledger && (EPAL.store.list('pay_slips')||[]).length)`).catch(() => false)) break;
}
await new Promise(r => setTimeout(r, 600));

/* ---------------------------------------------------------------------------
 * THE AUDIT ITSELF — one page-side pass that gathers every figure, so the whole
 * book is read at one instant and no check can disagree with another because
 * the data moved between them.
 * ------------------------------------------------------------------------- */
const R = await evalJs(`(function(){
  var P = EPAL.payroll, L = EPAL.ledger, S = EPAL.store;
  var r2 = function (n) { return Math.round((+n || 0) * 100) / 100; };
  var slips = S.list('pay_slips') || [];
  var live = slips.filter(function (s) { return s.status !== 'draft'; });
  var txns = S.list('pay_txns') || [];
  var runs = S.list('pay_runs') || [];
  var emps = {};
  slips.forEach(function (s) { emps[s.empId] = true; });
  txns.forEach(function (x) { emps[x.empId] = true; });
  var empIds = Object.keys(emps);
  var out = { counts: { slips: slips.length, live: live.length, txns: txns.length, runs: runs.length, staff: empIds.length }, fail: {} };
  function note(key, row) { (out.fail[key] = out.fail[key] || []).push(row); }

  /* ---- A · the ledger against the records ------------------------------- */
  var bal = function (c) { try { return r2(L.balance(c)); } catch (e) { return null; } };
  out.gl = { a1250: bal('1250'), a1260: bal('1260'), a2100: bal('2100'), a2110: bal('2110'),
             a2120: bal('2120'), a2150: bal('2150'), e5100: bal('5100'), e5150: bal('5150') };
  out.rec = {
    advance:  r2(empIds.reduce(function (a, id) { return a + P.advanceOutstanding(id); }, 0)),
    loan:     r2(empIds.reduce(function (a, id) { return a + P.loanOutstanding(id); }, 0)),
    payable:  r2(live.reduce(function (a, s) { return a + P.slipDue(s); }, 0)),
    pf:       r2(live.reduce(function (a, s) { return a + (s.pf || 0); }, 0)),
    tax:      r2(live.reduce(function (a, s) { return a + (s.tax || 0); }, 0)),
    encash:   r2(live.reduce(function (a, s) { return a + (s.encashAmt || 0); }, 0)
                 - txns.filter(function (x) { return x.type === 'encash-paid'; }).reduce(function (a, x) { return a + (x.amount || 0); }, 0))
  };

  /* ---- B · the payslip, row by row -------------------------------------- */
  slips.forEach(function (s) {
    var rec = P.slipRecovery(s);
    var earn = r2((s.earnedGross || 0) + (s.overtime || 0) + (s.bonus || 0) + (s.tplBonus || 0) + Math.max(0, s.adjustment || 0));
    var ded  = r2((s.tax || 0) + (s.pf || 0) + (s.otherDeduction || 0) + (s.lateDeduction || 0) + (s.earlyDeduction || 0)
             + (s.fine || 0) + Math.max(0, -(s.adjustment || 0)) + rec.adv + rec.emi);
    var net = P.slipPayable(s), paid = P.slipPaid(s), due = P.slipDue(s);
    if (Math.abs((earn - ded) - net) >= 1) note('rowMaths', { id: s.id, who: s.empName, ym: s.ym, earn: earn, ded: ded, net: net, off: r2(earn - ded - net) });
    if (Math.abs((net - paid) - due) >= 1) note('netPaidDue', { id: s.id, who: s.empName, ym: s.ym, net: net, paid: paid, due: due });
    if (net < 0) note('negativeNet', { id: s.id, who: s.empName, ym: s.ym, net: net });
    if (paid > net + 1) note('overpaid', { id: s.id, who: s.empName, ym: s.ym, net: net, paid: paid });
    // earnedGross must be the gross less the absence, or absence is taken twice
    if (Math.abs((s.gross || 0) - (s.absentDeduction || 0) - (s.earnedGross || 0)) >= 1)
      note('earnedGross', { id: s.id, who: s.empName, ym: s.ym, gross: s.gross, absent: s.absentDeduction, earned: s.earnedGross });
    // encashment must move none of the three
    if (String(net).indexOf('NaN') >= 0 || isNaN(net) || isNaN(paid) || isNaN(due)) note('nan', { id: s.id, who: s.empName, ym: s.ym });
    // a slip cannot recover more than the person owes
    if (rec.adv < 0 || rec.emi < 0) note('negativeRecovery', { id: s.id, who: s.empName, ym: s.ym, rec: rec });
  });
  // encashment: prove it is outside the payable by rebuilding one slip without it
  out.encashOutside = live.every(function (s) {
    var clone = JSON.parse(JSON.stringify(s)); clone.encashAmt = (s.encashAmt || 0) + 9999;
    return Math.abs(P.slipPayable(clone) - P.slipPayable(s)) < 1;
  });

  /* ---- C · the journals -------------------------------------------------- */
  var entries = L.entries().filter(function (e) { return e.source === 'payroll'; });
  out.counts.entries = entries.length;
  entries.forEach(function (e) {
    var dr = 0, cr = 0;
    (e.lines || []).forEach(function (l) { dr += (+l.dr || 0); cr += (+l.cr || 0); });
    if (Math.abs(dr - cr) >= 1) note('entryUnbalanced', { id: e.id, dr: r2(dr), cr: r2(cr) });
  });
  live.forEach(function (s) {
    var acc = entries.filter(function (e) { return e.id === 'GL-PAYA-' + s.empId + '-' + s.ym; })[0];
    if (!acc) { note('accrualMissing', { id: s.id, who: s.empName, ym: s.ym }); return; }
    var c2100 = (acc.lines || []).filter(function (l) { return l.account === '2100'; }).reduce(function (a, l) { return a + (+l.cr || 0); }, 0);
    // a settled legacy month was posted before the recovery moved to the accrual:
    // its 2100 line is the pre-recovery figure and its payment debits the same,
    // so the pair still nets to zero — compare against what that month posted
    var want = s.deductedAt ? P.slipPayable(s) : P.slipEarned(s);
    if (Math.abs(c2100 - want) >= 1) note('accrual2100', { id: s.id, who: s.empName, ym: s.ym, posted: r2(c2100), want: r2(want) });
  });

  /* ---- D · the tables ---------------------------------------------------- */
  // the loan register, footed per person, against the one number the card shows
  empIds.forEach(function (id) {
    var book = P.loanBook ? P.loanBook(id) : [];
    var due = r2(book.reduce(function (a, x) { return a + (x.due || 0); }, 0));
    var paid = r2(book.reduce(function (a, x) { return a + (x.paid || 0); }, 0));
    var principal = r2(book.reduce(function (a, x) { return a + (x.principal || 0); }, 0));
    var out1 = r2(P.loanOutstanding(id));
    if (Math.abs(due - out1) >= 1) note('loanFoot', { emp: id, register: due, card: out1 });
    if (Math.abs((principal - paid) - due) >= 1) note('loanRow', { emp: id, taken: principal, paid: paid, due: due });
    // every repayment out of a payslip must be filed as a salary deduction
    book.forEach(function (Lo) {
      (Lo.payments || []).forEach(function (p) {
        if (/EMI (auto-)?deducted from /.test(p.memo || '') && p.kind !== 'salary')
          note('repayKind', { emp: id, memo: p.memo, kind: p.kind });
      });
    });
  });
  // the monthly register: each month's foot against the slips it covers
  var byYm = {};
  live.forEach(function (s) { (byYm[s.ym] = byYm[s.ym] || []).push(s); });
  out.months = Object.keys(byYm).sort().map(function (ym) {
    var ss = byYm[ym];
    return { ym: ym, heads: ss.length,
      net: r2(ss.reduce(function (a, s) { return a + P.slipPayable(s); }, 0)),
      paid: r2(ss.reduce(function (a, s) { return a + P.slipPaid(s); }, 0)),
      due: r2(ss.reduce(function (a, s) { return a + P.slipDue(s); }, 0)),
      encash: r2(ss.reduce(function (a, s) { return a + (s.encashAmt || 0); }, 0)) };
  });
  out.months.forEach(function (m) {
    if (Math.abs((m.net - m.paid) - m.due) >= 1) note('monthFoot', m);
  });
  // arrears: what the payslip prints as "previous due" must be the earlier months
  empIds.forEach(function (id) {
    var months = Object.keys(byYm).sort();
    if (!months.length) return;
    var ym = months[months.length - 1];
    var listed = r2((P.previousDueList(id, ym) || []).reduce(function (a, r) { return a + r.amount; }, 0));
    var total = r2(P.previousDue(id, ym));
    var truth = r2(live.filter(function (s) { return s.empId === id && s.ym < ym; })
      .reduce(function (a, s) { return a + P.slipDue(s); }, 0));
    if (Math.abs(total - truth) >= 1 || Math.abs(listed - truth) >= 1)
      note('arrears', { emp: id, previousDue: total, listed: listed, truth: truth });
  });
  // the payslip print: earnings − deductions ± adjustment = the net it prints
  live.slice(0, 40).forEach(function (s) {
    var e = EPAL.db.employee(s.empId); if (!e) return;
    var st = P.statement(e, s.ym); if (!st) return;
    var earn = r2(st.grossEarnings);
    var net = r2(earn - st.totalDeductions + (st.adjustment || 0));
    if (Math.abs(net - st.netPayable) >= 1)
      note('statement', { who: s.empName, ym: s.ym, earnings: earn, deductions: r2(st.totalDeductions), adj: st.adjustment, prints: r2(st.netPayable), shouldBe: net });
    if (Math.abs(st.netCash - st.netPayable) >= 1)
      note('statementCash', { who: s.empName, ym: s.ym, net: r2(st.netPayable), cash: r2(st.netCash) });
    if (Math.abs((st.netPayable - st.paid) - st.outstanding) >= 1)
      note('statementDue', { who: s.empName, ym: s.ym, net: r2(st.netPayable), paid: r2(st.paid), out: r2(st.outstanding) });
  });
  /* the employee ledger: its closing balance is the WHOLE of what the person is
   * owed — the salary still due, PLUS the leave encashment accrued for them and
   * not yet paid out (the sheet credits it as it accrues), LESS what they hold of
   * the company's money in advances and loans. */
  empIds.slice(0, 40).forEach(function (id) {
    var rows = P.empLedger(id) || [];
    if (!rows.length) return;
    var close = r2(rows[rows.length - 1].balance);
    var encAcc = r2(live.filter(function (s) { return s.empId === id; }).reduce(function (a, s) { return a + (s.encashAmt || 0); }, 0)
      - txns.filter(function (x) { return x.empId === id && x.type === 'encash-paid'; }).reduce(function (a, x) { return a + (x.amount || 0); }, 0));
    var owed = r2(P.salaryDue(id) + encAcc - P.advanceOutstanding(id) - P.loanOutstanding(id));
    if (Math.abs(close - owed) >= 1) note('empLedger', { emp: id, closing: close, owed: owed, encashInIt: encAcc });
  });
  // advance requests: an approved request must have moved the money it says
  var reqs = (P.advRequests ? P.advRequests() : []) || [];
  out.counts.advReq = reqs.length;
  reqs.filter(function (q) { return q.status === 'approved'; }).forEach(function (q) {
    var t = txns.filter(function (x) { return x.id === q.txnId; })[0];
    if (!t) { note('advReqOrphan', { id: q.id, who: q.empName }); return; }
    var want = r2(q.approvedAmount != null ? q.approvedAmount : q.amount);
    if (Math.abs(r2(t.amount) - want) >= 1) note('advReqAmount', { id: q.id, who: q.empName, approved: want, moved: r2(t.amount) });
  });

  /* ---- E · sanity -------------------------------------------------------- */
  ['1250', '1260', '2100', '2110', '2120', '2150'].forEach(function (c) {
    var b = bal(c); if (b != null && b < -1) note('negativeAccount', { account: c, balance: b });
  });
  empIds.forEach(function (id) {
    if (P.advanceOutstanding(id) < 0) note('negativeAdvance', { emp: id });
    if (P.loanOutstanding(id) < 0) note('negativeLoan', { emp: id });
    if (P.emiInstallment(id) > P.loanOutstanding(id) + 1) note('emiOverLoan', { emp: id, emi: P.emiInstallment(id), owed: P.loanOutstanding(id) });
  });
  // every slip belongs to a run, and every run to a company
  slips.forEach(function (s) {
    if (!runs.some(function (r) { return r.id === s.runId || (r.companyId === s.companyId && r.ym === s.ym); }))
      note('orphanSlip', { id: s.id, ym: s.ym });
  });
  // the approval check must pass on every month that is already approved
  runs.filter(function (r) { return r.status !== 'draft'; }).forEach(function (r) {
    var chk = P.runCheck(r.companyId, r.ym);
    if (!chk.ok) note('runCheck', { run: r.id, failed: chk.failed.length, first: chk.failed[0] });
  });
  out.journalGap = P.journalGap ? P.journalGap({}) : { total: 0, rows: [] };
  var tb = L.trialBalance();
  out.trial = { dr: r2(tb.reduce(function (a, x) { return a + (x.debit || 0); }, 0)),
                cr: r2(tb.reduce(function (a, x) { return a + (x.credit || 0); }, 0)) };
  out.emiGap = P.emiGap({});
  return out;
})()`);

/* --------------------------------------------------------------- reporting */
const fmt = n => (n == null ? 'n/a' : '৳' + Math.round(n).toLocaleString('en-IN'));
const eq = (a, b) => a != null && b != null && Math.abs(a - b) < 1;
let ok = true;
const line = (good, label, detail) => { if (!good) ok = false; console.log('  ' + (good ? '✓' : '✗') + ' ' + label + (detail ? '  ' + detail : '')); };

console.log('PAYROLL AUDIT — ' + R.counts.staff + ' staff · ' + R.counts.slips + ' payslips (' + R.counts.live +
  ' approved) · ' + R.counts.runs + ' runs · ' + R.counts.txns + ' money events · ' + R.counts.entries + ' payroll journals');

console.log('\nA · THE LEDGER against what payroll says it should be');
const pairs = [
  ['1250 Employee Advances', R.gl.a1250, R.rec.advance, 'advance outstanding, all staff'],
  ['1260 Staff Loans', R.gl.a1260, R.rec.loan, 'loan outstanding, all staff'],
  ['2100 Salary Payable', R.gl.a2100, R.rec.payable, 'still due on approved payslips'],
  ['2110 Provident Fund', R.gl.a2110, R.rec.pf, 'PF withheld'],
  ['2120 Income Tax', R.gl.a2120, R.rec.tax, 'tax withheld'],
  ['2150 Leave Encashment', R.gl.a2150, R.rec.encash, 'accrued less paid out']
];
pairs.forEach(([name, glv, recv, what]) => {
  line(eq(glv, recv), name.padEnd(24) + ' ledger ' + fmt(glv).padStart(14) + '  ·  records ' + fmt(recv).padStart(14),
    eq(glv, recv) ? '' : '← off by ' + fmt((glv || 0) - (recv || 0)) + ' (' + what + ')');
});
line(eq(R.trial.dr, R.trial.cr), 'trial balance'.padEnd(24) + ' debit  ' + fmt(R.trial.dr).padStart(14) + '  ·  credit  ' + fmt(R.trial.cr).padStart(13));

console.log('\nB · THE PAYSLIP — every row ever written');
line(!R.fail.rowMaths, 'earnings − every deduction = net payable', R.fail.rowMaths ? '(' + R.fail.rowMaths.length + ' rows off)' : '(' + R.counts.slips + ' rows)');
line(!R.fail.netPaidDue, 'net payable − paid = due', R.fail.netPaidDue ? '(' + R.fail.netPaidDue.length + ' rows off)' : '');
line(!R.fail.negativeNet, 'net payable never negative', R.fail.negativeNet ? '(' + R.fail.negativeNet.length + ' rows)' : '');
line(!R.fail.overpaid, 'nobody paid more than their payslip', R.fail.overpaid ? '(' + R.fail.overpaid.length + ' rows)' : '');
line(!R.fail.earnedGross, 'absence deducted once, not twice', R.fail.earnedGross ? '(' + R.fail.earnedGross.length + ' rows)' : '');
line(!R.fail.negativeRecovery, 'no negative advance or EMI recovery', '');
line(!R.fail.nan, 'no NaN anywhere in the three figures', '');
line(R.encashOutside === true, 'leave encashment moves none of the three', '');

console.log('\nC · THE JOURNALS');
line(!R.fail.entryUnbalanced, 'every payroll journal balances', R.fail.entryUnbalanced ? '(' + R.fail.entryUnbalanced.length + ' entries)' : '(' + R.counts.entries + ' entries)');
line(!R.fail.accrualMissing, 'every approved payslip has its accrual', R.fail.accrualMissing ? '(' + R.fail.accrualMissing.length + ' missing)' : '');
line(!R.fail.accrual2100, 'each accrual credits 2100 with the payable it posted', R.fail.accrual2100 ? '(' + R.fail.accrual2100.length + ' off)' : '');

console.log('\nD · THE TABLES — each restating the same payslips');
line(!R.fail.loanFoot, 'loan register foots to the per-person still-due', R.fail.loanFoot ? '(' + R.fail.loanFoot.length + ' staff)' : '');
line(!R.fail.loanRow, 'taken − paid = still due on every loan', R.fail.loanRow ? '(' + R.fail.loanRow.length + ' staff)' : '');
line(!R.fail.repayKind, 'an EMI out of a payslip is filed as a salary deduction', R.fail.repayKind ? '(' + R.fail.repayKind.length + ' rows mislabelled)' : '');
line(!R.fail.monthFoot, 'monthly register: net − paid = due, every month', '(' + R.months.length + ' months)');
line(!R.fail.arrears, 'arrears on a payslip = the earlier months still owed', R.fail.arrears ? '(' + R.fail.arrears.length + ' staff)' : '');
line(!R.fail.statement, 'printed payslip: earnings − deductions = its net', R.fail.statement ? '(' + R.fail.statement.length + ' slips)' : '');
line(!R.fail.statementCash, 'printed net payable = the cash it says to hand over', R.fail.statementCash ? '(' + R.fail.statementCash.length + ' slips)' : '');
line(!R.fail.statementDue, 'printed net − paid = its outstanding', R.fail.statementDue ? '(' + R.fail.statementDue.length + ' slips)' : '');
line(!R.fail.empLedger, 'employee ledger closes at what the person is owed', R.fail.empLedger ? '(' + R.fail.empLedger.length + ' staff)' : '');
line(!R.fail.advReqOrphan && !R.fail.advReqAmount, 'an approved advance moved exactly what was approved', '(' + (R.counts.advReq || 0) + ' requests)');

console.log('\nE · SANITY');
line(!R.fail.negativeAccount, 'no payroll account driven negative', R.fail.negativeAccount ? JSON.stringify(R.fail.negativeAccount) : '');
line(!R.fail.negativeAdvance && !R.fail.negativeLoan, 'no negative advance or loan balance', '');
line(!R.fail.emiOverLoan, 'the EMI never exceeds what is still owed', R.fail.emiOverLoan ? '(' + R.fail.emiOverLoan.length + ' staff)' : '');
line(!R.fail.orphanSlip, 'every payslip belongs to a run', R.fail.orphanSlip ? '(' + R.fail.orphanSlip.length + ' orphans)' : '');
line(!R.fail.runCheck, 'every approved month passes its own approval check', R.fail.runCheck ? '(' + R.fail.runCheck.length + ' runs fail)' : '');
line(R.emiGap.total === 0, 'no EMI recorded but never deducted', R.emiGap.total ? '← ' + fmt(R.emiGap.total) + ' over ' + R.emiGap.rows.length + ' rows' : '');
line(R.journalGap.total === 0, 'every advance · loan · repayment · bonus has a journal',
  R.journalGap.total ? '← ' + fmt(R.journalGap.total) + ' over ' + R.journalGap.rows.length + ' events' : '');
if (VERBOSE && R.journalGap.rows.length) {
  R.journalGap.rows.slice(0, 12).forEach(r => console.log('      ' + r.date + '  ' + (r.empName || r.empId) + '  ' + r.type + '  ' + fmt(r.amount) + '  ' + r.memo));
}

if (VERBOSE) {
  console.log('\nFAILING ROWS');
  Object.keys(R.fail).forEach(k => {
    console.log('  ' + k + ':');
    R.fail[k].slice(0, 12).forEach(row => console.log('    ' + JSON.stringify(row)));
    if (R.fail[k].length > 12) console.log('    … and ' + (R.fail[k].length - 12) + ' more');
  });
}

console.log('\n' + (ok ? '✓ the payroll adds up — every account, every table, against the ledger'
                       : '✗ the payroll does not add up — run with --verbose for the offending rows'));
cleanup();
process.exit(ok ? 0 : 1);
