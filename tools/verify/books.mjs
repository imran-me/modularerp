/* ============================================================================
 * EPAL GROUP ERP · tools/verify/books.mjs
 * ----------------------------------------------------------------------------
 * Bookkeeping harness — inspects the REAL double-entry ledger in a booted app.
 * Same headless-Chrome/CDP recipe as sweep.mjs (see its header for the gotchas).
 *
 *   node tools/verify/books.mjs trial     # trial balance (dr = cr) + dead accounts
 *   node tools/verify/books.mjs margin    # group revenue / expense / margin
 *   node tools/verify/books.mjs void      # prove a void fully reverses (no phantom)
 *   node tools/verify/books.mjs paid      # prove paid → Cash, due → Receivable
 *   node tools/verify/books.mjs salary    # salary charged per month (double-book check)
 *   node tools/verify/books.mjs receipt   # woodart goods receipt: balance-sheet only, reverses
 *
 * Exit 0 = the probe's invariant holds. Built for the 2026-07 bookkeeping audit;
 * keep it around — it is the fastest way to see whether a change moved the books.
 * ========================================================================= */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PROBE = (process.argv[2] || 'trial').toLowerCase();
const PORT = 9500 + (process.pid % 150);
const CDP_PORT = 9700 + (process.pid % 150);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2' };

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(ROOT, url === '/' ? 'index.html' : url);
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
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
const userDir = path.join(process.env.TEMP || '/tmp', 'epal-books-' + process.pid);
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
function send(method, params = {}, sid) {
  const id = ++msgId;
  return new Promise((res, rej) => { pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params, sessionId: sid })); });
}
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
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html#/group/finance` }, sessionId);
for (let i = 0; i < 120; i++) {
  await new Promise(r => setTimeout(r, 200));
  if (await evalJs(`!!(window.EPAL && EPAL.ledger && EPAL.db && EPAL.store)`).catch(() => false)) break;
}
await new Promise(r => setTimeout(r, 500));

const fmt = n => '৳' + Math.round(n).toLocaleString('en-IN');
let ok = true;

if (PROBE === 'void') {
  const out = await evalJs(`(function(){
    var L = EPAL.ledger, bal = function(c){ return L.balance(c); }, ref = 'PROOF-' + EPAL.ui.uid('v');
    var s0 = bal('5000'), p0 = bal('2000');
    EPAL.db.postSale('travels', { amount:100000, cost:80000, ref:ref, desc:'void-proof', customer:'Proof Co', vendor:'Proof Air' });
    EPAL.db.postSale('travels', { amount:-100000, cost:-80000, ref:ref+'-VOID', desc:'void-proof rev', customer:'Proof Co', vendor:'Proof Air' });
    return { costLeft: Math.abs(bal('5000')-s0), payLeft: Math.abs(bal('2000')-p0) };
  })()`);
  ok = out.costLeft === 0 && out.payLeft === 0;
  console.log('VOID — reverse a ' + fmt(100000) + ' ticket (cost ' + fmt(80000) + ')');
  console.log('  COGS left on books   : ' + fmt(out.costLeft) + (out.costLeft ? '  ← phantom loss' : '  ✓'));
  console.log('  payable left on books: ' + fmt(out.payLeft) + (out.payLeft ? '  ← phantom debt' : '  ✓'));
  console.log(ok ? '✓ void fully reverses' : '✗ void destroys money');
}
if (PROBE === 'trial') {
  const out = await evalJs(`(function(){
    var tb = EPAL.ledger.trialBalance();
    var dr = tb.reduce(function(s,r){ return s+(r.debit||0); },0), cr = tb.reduce(function(s,r){ return s+(r.credit||0); },0);
    var dead = EPAL.ledger.accounts().filter(function(a){ return !tb.some(function(r){ return r.code===a.code && (r.debit||r.credit); }); })
      .map(function(a){ return a.code+' '+a.name; });
    return { dr:dr, cr:cr, balanced: Math.abs(dr-cr)<1, dead:dead };
  })()`);
  ok = out.balanced;
  console.log('TRIAL BALANCE');
  console.log('  debit : ' + fmt(out.dr));
  console.log('  credit: ' + fmt(out.cr));
  console.log('  ' + (out.balanced ? '✓ balances' : '✗ OUT BY ' + fmt(out.dr-out.cr)));
  console.log('  dead accounts (' + out.dead.length + '): ' + out.dead.join(' · '));
}
if (PROBE === 'margin') {
  const out = await evalJs(`(function(){
    var tb = EPAL.ledger.trialBalance();
    function sum(p){ return tb.filter(p).reduce(function(s,r){ return s+Math.abs((r.credit||0)-(r.debit||0)); },0); }
    var rev = sum(function(r){ return /^4/.test(r.code); }), exp = sum(function(r){ return /^5/.test(r.code); });
    return { rev:rev, exp:exp, margin: rev ? Math.round((rev-exp)/rev*100) : null };
  })()`);
  ok = out.margin != null && out.margin > 0;
  console.log('GROUP MARGIN (from the ledger)');
  console.log('  revenue (4xxx): ' + fmt(out.rev));
  console.log('  expense (5xxx): ' + fmt(out.exp));
  console.log('  margin: ' + out.margin + '%  ' + (ok ? '✓' : '← income not fully posted'));
}
if (PROBE === 'paid') {
  const out = await evalJs(`(function(){
    var L = EPAL.ledger, bal = function(c){ return L.balance(c); }, u = EPAL.ui.uid('p');
    var c0 = bal('1010'), a0 = bal('1200');
    EPAL.db.postSale('shop', { amount:5000, cost:3000, ref:'PAID-'+u, customer:'Cash', paid:true });
    var c1 = bal('1010'), a1 = bal('1200');
    EPAL.db.postSale('travels', { amount:5000, cost:3000, ref:'DUE-'+u, customer:'Credit', payStatus:'Due' });
    return { cashPaid: Math.abs(c1-c0), arPaid: Math.abs(a1-a0), arDue: Math.abs(bal('1200')-a1) };
  })()`);
  ok = out.cashPaid === 5000 && out.arPaid === 0 && out.arDue === 5000;
  console.log('PAID-FLAG ROUTING');
  console.log('  paid → Cash 1010: ' + fmt(out.cashPaid) + ' , AR 1200: ' + fmt(out.arPaid));
  console.log('  due  → AR 1200  : ' + fmt(out.arDue));
  console.log(ok ? '✓ paid → cash, due → receivable' : '✗ routing wrong');
}
if (PROBE === 'receipt') {
  // Woodart procurement: a goods receipt must land on the BALANCE SHEET
  // (DR 1400 Inventory / CR 2000 Payable), never on the P&L — that is what
  // makes it impossible to double-count against the project cost the projects
  // module posts to 5000 at sale. Also proves un-receiving reverses cleanly.
  const out = await evalJs(`(function(){
    var L = EPAL.ledger, db = EPAL.db, bal = function(c){ return L.balance(c); };
    var id = 'WPO-PROBE-' + EPAL.ui.uid('x');
    var inv0 = bal('1400'), ap0 = bal('2000'), cogs0 = bal('5000'), cash0 = bal('1010');
    var tb0 = L.trialBalance().reduce(function(s,r){ return s+(r.debit||0)-(r.credit||0); },0);

    function save(rec){ EPAL.views && 0; return null; }
    // drive the module's own seam by rendering its view first
    EPAL.router.navigate('woodart/procurement');
    var P = EPAL.diag && EPAL.diag.woodartProcurement;   // the module's documented probe hook
    if (!P) return { err: 'seam not exposed' };

    // 1. an ORDERED purchase posts NOTHING
    P.saveOrder({ id:id, supplier:'Akij Board', items:3, amount:120000, status:'Ordered', date:'2026-07-01' });
    var afterOrder = { inv: bal('1400')-inv0, ap: bal('2000')-ap0 };

    // 2. receiving it posts DR 1400 / CR 2000
    P.saveOrder({ id:id, supplier:'Akij Board', items:3, amount:120000, status:'Received', date:'2026-07-01' });
    var afterRecv = { inv: bal('1400')-inv0, ap: bal('2000')-ap0, cogs: bal('5000')-cogs0, cash: bal('1010')-cash0 };

    // 3. un-receiving reverses it back to zero
    P.saveOrder({ id:id, supplier:'Akij Board', items:3, amount:120000, status:'Partial', date:'2026-07-01' });
    var afterUn = { inv: bal('1400')-inv0, ap: bal('2000')-ap0 };

    var tb1 = L.trialBalance().reduce(function(s,r){ return s+(r.debit||0)-(r.credit||0); },0);
    P.removeOrder(id);
    return { afterOrder:afterOrder, afterRecv:afterRecv, afterUn:afterUn, tb0:tb0, tb1:tb1 };
  })()`);
  const o = out || {};
  ok = !o.err
    && o.afterOrder.inv === 0 && o.afterOrder.ap === 0
    && o.afterRecv.inv === 120000 && o.afterRecv.ap === 120000
    && o.afterRecv.cogs === 0 && o.afterRecv.cash === 0
    && o.afterUn.inv === 0 && o.afterUn.ap === 0
    && Math.abs(o.tb1 - o.tb0) < 1;
  console.log('WOODART GOODS RECEIPT');
  if (o.err) { console.log('  ' + o.err); }
  else {
    console.log('  Ordered      → inventory ' + fmt(o.afterOrder.inv) + ' , payable ' + fmt(o.afterOrder.ap) + (o.afterOrder.inv === 0 && o.afterOrder.ap === 0 ? '  ✓ a PO posts nothing' : '  ← a PO must not post'));
    console.log('  Received     → inventory ' + fmt(o.afterRecv.inv) + ' , payable ' + fmt(o.afterRecv.ap));
    console.log('  ...and P&L   → COGS 5000 ' + fmt(o.afterRecv.cogs) + ' , cash 1010 ' + fmt(o.afterRecv.cash) + (o.afterRecv.cogs === 0 ? '  ✓ balance sheet only, cannot double-count' : '  ← LEAKED TO THE P&L'));
    console.log('  Un-received  → inventory ' + fmt(o.afterUn.inv) + ' , payable ' + fmt(o.afterUn.ap) + (o.afterUn.inv === 0 ? '  ✓ fully reversed' : '  ← phantom stock'));
    console.log('  trial balance still balances: ' + (Math.abs(o.tb1 - o.tb0) < 1 ? '✓' : '✗ out by ' + fmt(o.tb1 - o.tb0)));
  }
  console.log(ok ? '✓ goods receipt books correctly' : '✗ goods receipt is wrong');
}
if (PROBE === 'salary') {
  const out = await evalJs(`(function(){
    var rows = EPAL.ledger.entries().filter(function(e){ return (e.lines||[]).some(function(l){ return l.account==='5100' && (l.dr||0)>0; }); });
    var byMonth = {}, perMonth = {};
    rows.forEach(function(e){ var mo=(e.date||'').slice(0,7);
      var amt=(e.lines||[]).filter(function(l){ return l.account==='5100'; }).reduce(function(s,l){ return s+(l.dr||0); },0);
      byMonth[mo]=(byMonth[mo]||0)+amt; perMonth[mo]=(perMonth[mo]||0)+1; });
    return { byMonth:byMonth, perMonth:perMonth };
  })()`);
  console.log('SALARY (5100) charged per month:');
  Object.keys(out.byMonth).sort().forEach(mo => console.log('  ' + mo + ' : ' + fmt(out.byMonth[mo]) + '  (' + out.perMonth[mo] + ' entries)'));
}
cleanup();
process.exit(ok ? 0 : 1);
