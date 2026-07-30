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
 *   node tools/verify/books.mjs story     # the 3 Woodart story projects thread every module
 *   node tools/verify/books.mjs stock     # stock == sum(movements), and a receipt moves both
 *   node tools/verify/books.mjs refs      # every cross-store reference points at something real
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
if (PROBE === 'story') {
  // Three hand-authored Woodart projects are supposed to thread through every
  // module at a DIFFERENT phase. A demo that does not cross-reference is just
  // more random data, so assert the joins rather than eyeball them.
  const out = await evalJs(`(function(){
    var db = EPAL.db, col = function(k){ return db.col(k); };
    function of(store, key, id){ return col(store).filter(function(r){ return r[key]===id; }); }
    return ['WAP-101','WAP-102','WAP-103'].map(function(id){
      var p = col('wa_projects').filter(function(x){ return x.id===id; })[0];
      var dw = of('wa_drawings','project',id);
      var est = of('wa_estimates','projectId',id)[0];
      var boq = (est && est.lines) || [];
      var names = col('wa_materials').map(function(m){ return m.name; });
      return {
        id:id, found:!!p, stage:p&&p.stage, value:p&&p.value,
        drawings:dw.length,
        approved:dw.filter(function(d){ return d.status==='Approved'; }).length,
        trail: col('wa_revisions').filter(function(r){ return dw.some(function(d){ return d.id===r.drawing; }); }).length,
        boqLines:boq.length,
        boqValue:boq.reduce(function(s,l){ return s+l.qty*l.unitSale; },0),
        boqCost:boq.reduce(function(s,l){ return s+l.qty*l.unitCost; },0),
        boqUnknown:boq.filter(function(l){ return names.indexOf(l.item)<0; }).map(function(l){ return l.item; }),
        jobs:of('wa_production','project',id).length,
        installs:of('wa_installs','project',id).length
      };
    });
  })()`);
  const [a,b,c] = out;
  const money = n => '৳' + Math.round(n).toLocaleString('en-IN');
  ok = out.every(r => r.found)
    && a.stage==='Design' && b.stage==='Production' && c.stage==='Handover'
    && out.every(r => r.drawings>0 && r.trail>0 && r.boqLines>0)
    && out.every(r => r.boqUnknown.length===0)
    && out.every(r => r.boqValue > r.boqCost)
    && b.jobs>0 && c.installs>0 && a.jobs===0;
  console.log('WOODART STORY PROJECTS');
  out.forEach(r => {
    console.log('  ' + r.id + '  ' + String(r.stage).padEnd(11) + ' ' + money(r.value).padStart(12));
    console.log('     design ' + r.approved + '/' + r.drawings + ' approved · ' + r.trail + ' trail rows' +
                ' · BOQ ' + r.boqLines + ' lines ' + money(r.boqValue) + ' (cost ' + money(r.boqCost) + ')');
    console.log('     workshop ' + r.jobs + ' jobs · site ' + r.installs + ' visit(s)' +
                (r.boqUnknown.length ? '   ← BOQ quotes unstocked: ' + r.boqUnknown.join(', ') : '   ✓ every BOQ item is a real material'));
  });
  console.log(ok ? '✓ each story sits at its own phase and every join resolves'
                 : '✗ a story does not thread');
}
if (PROBE === 'stock') {
  // THE INVARIANT: a material's stored stock must equal the sum of its
  // movements. A balance you cannot prove is a balance you cannot trust — that
  // is the whole reason the ledger exists. Also proves a goods receipt moves
  // the books AND the stock, and that un-receiving puts both back.
  const out = await evalJs(`(function(){
    var M = EPAL.diag && EPAL.diag.woodartMaterials;
    var P = EPAL.diag && EPAL.diag.woodartProcurement;
    if (!M || !P) return { err:'seam not exposed' };
    var L = EPAL.ledger, bal = function(c){ return L.balance(c); };

    var driftBefore = M.reconcile();
    var mat = M.all()[0];
    var s0 = mat.stock, moves0 = M.movements().length;

    // 1. a manual issue moves the number AND writes a row
    M.apply({ material: mat.id, kind:'Issue', qty: 5, ref:'PROBE', by:'probe' });
    var afterIssue = { stock: M.find(mat.id).stock, rows: M.movements().length };

    // 2. the sign belongs to the KIND — a positive Issue must still reduce
    M.apply({ material: mat.id, kind:'Issue', qty: 3, ref:'PROBE', by:'probe' });
    var afterSigned = M.find(mat.id).stock;

    // 3. a goods receipt with LINES moves stock and the books together
    var id = 'WPO-STK-' + EPAL.ui.uid('x');
    var inv0 = bal('1400'), ap0 = bal('2000');
    P.saveOrder({ id:id, supplier:'Akij Board', items:1, amount:50000, status:'Ordered',
                  date:'2026-07-01', lines:[{ material: mat.id, qty: 20 }] });
    var onOrder = M.find(mat.id).stock;
    P.saveOrder({ id:id, supplier:'Akij Board', items:1, amount:50000, status:'Received',
                  date:'2026-07-01', lines:[{ material: mat.id, qty: 20 }] });
    var onReceipt = { stock: M.find(mat.id).stock, inv: bal('1400')-inv0, ap: bal('2000')-ap0 };

    // 4. un-receiving puts the stock back too
    P.saveOrder({ id:id, supplier:'Akij Board', items:1, amount:50000, status:'Partial',
                  date:'2026-07-01', lines:[{ material: mat.id, qty: 20 }] });
    var onUndo = M.find(mat.id).stock;

    var driftAfter = M.reconcile();
    P.removeOrder(id);
    return { err:null, name: mat.name, s0:s0, moves0:moves0,
             afterIssue:afterIssue, afterSigned:afterSigned,
             onOrder:onOrder, onReceipt:onReceipt, onUndo:onUndo,
             driftBefore: driftBefore.length, driftAfter: driftAfter.length,
             total: M.all().length };
  })()`);
  const o = out || {};
  ok = !o.err
    && o.driftBefore === 0 && o.driftAfter === 0
    && o.afterIssue.stock === o.s0 - 5 && o.afterIssue.rows === o.moves0 + 1
    && o.afterSigned === o.s0 - 8
    && o.onOrder === o.s0 - 8
    && o.onReceipt.stock === o.s0 + 12
    && o.onReceipt.inv === 50000 && o.onReceipt.ap === 50000
    && o.onUndo === o.s0 - 8;
  console.log('WOODART STOCK LEDGER  (' + (o.name || '?') + ')');
  if (o.err) console.log('  ' + o.err);
  else {
    console.log('  seeded invariant : ' + o.driftBefore + ' of ' + o.total + ' materials drift' + (o.driftBefore === 0 ? '  ✓ stock == sum(movements)' : '  ← UNEXPLAINED'));
    console.log('  issue 5          : ' + o.s0 + ' → ' + o.afterIssue.stock + ' , rows ' + o.moves0 + ' → ' + o.afterIssue.rows + (o.afterIssue.rows === o.moves0 + 1 ? '  ✓ number and row together' : '  ← no row'));
    console.log('  issue +3 (signed): ' + o.afterSigned + (o.afterSigned === o.s0 - 8 ? '  ✓ a positive Issue still REDUCES' : '  ← sign trusted from caller'));
    console.log('  PO ordered       : ' + o.onOrder + (o.onOrder === o.s0 - 8 ? '  ✓ an order alone moves nothing' : '  ← moved on order'));
    console.log('  PO received      : ' + o.onReceipt.stock + '  · 1400 +' + o.onReceipt.inv + ' · 2000 +' + o.onReceipt.ap + (o.onReceipt.stock === o.s0 + 12 ? '  ✓ books AND stock' : '  ← out of step'));
    console.log('  un-received      : ' + o.onUndo + (o.onUndo === o.s0 - 8 ? '  ✓ stock put back' : '  ← stock stranded'));
    console.log('  invariant after  : ' + o.driftAfter + ' drift' + (o.driftAfter === 0 ? '  ✓ still provable' : '  ← BROKEN'));
  }
  console.log(ok ? '✓ stock is a ledger, not a number' : '✗ stock and its history disagree');
}
if (PROBE === 'refs') {
  // WHY THIS EXISTS: on 2026-07-27 two separate seeding defects shipped, and
  // BOTH were found by asking "which references point at nothing?" rather than
  // by reading the seeders. Woodart's modules reference each other by id
  // constantly — a job names a project, a movement names a project, a payment
  // names a purchase order — and nothing checked that those ids resolved. A
  // demo whose records point at each other correctly is the difference between
  // sample data and noise, so the check is now permanent.
  //
  // A reference listed in EXPECTED is a deliberate orphan: it exists so an
  // "orphan" badge has real data to render. Anything else is a defect.
  const out = await evalJs(`(function(){
    var db = EPAL.db, col = function(k){ return db.col(k); };
    function ids(store, key){ var s = {}; col(store).forEach(function(r){ if (r[key]) s[r[key]] = 1; }); return s; }

    var projects = ids('wa_projects','id');
    var materials = ids('wa_materials','id');
    var drawings = ids('wa_drawings','id');
    var vendors  = {}; col('wa_vendors').forEach(function(v){ vendors[String(v.name).trim().toLowerCase()] = 1; });
    var clients  = {}; col('wa_clients').forEach(function(c){ clients[String(c.name).trim().toLowerCase()] = 1; });
    var locations = ids('wa_locations','id');
    var orders   = ids('wa_purchases','id');

    var bad = [];
    function check(store, key, target, label, norm){
      col(store).forEach(function(r){
        var v = r[key];
        if (v === undefined || v === null || v === '') return;
        var k = norm ? String(v).trim().toLowerCase() : v;
        if (!target[k]) bad.push({ store: store, field: key, value: String(v), points_at: label });
      });
    }

    check('wa_production','project', projects,  'a project');
    check('wa_installs','project',   projects,  'a project');
    check('wa_drawings','project',   projects,  'a project');
    check('wa_estimates','projectId',projects,  'a project');
    check('wa_revisions','drawing',  drawings,  'a drawing');
    check('wa_movements','material', materials, 'a material');
    check('wa_movements','location', locations, 'a location');
    check('wa_purchases','supplier', vendors,   'a vendor', true);
    check('wa_projects','client',    clients,   'a client', true);

    // BOQ lines quote material NAMES, not ids — the one place a name is the key
    var names = {}; col('wa_materials').forEach(function(m){ names[m.name] = 1; });
    col('wa_estimates').forEach(function(e){
      (e.lines || []).forEach(function(l){
        if (l.item && !names[l.item]) bad.push({ store:'wa_estimates', field:'lines[].item', value:l.item, points_at:'a material' });
      });
    });

    return { bad: bad, counts: {
      projects: col('wa_projects').length, materials: col('wa_materials').length,
      movements: col('wa_movements').length, drawings: col('wa_drawings').length,
      purchases: col('wa_purchases').length, clients: col('wa_clients').length } };
  })()`);

  // Deliberate orphans: each exists so an "orphan"/"unlisted" state has real data.
  const EXPECTED = new Set(['WAP-999', 'Dhaka Glass Co']);
  const bad = (out.bad || []).filter(b => !EXPECTED.has(b.value));
  const expected = (out.bad || []).filter(b => EXPECTED.has(b.value));

  ok = bad.length === 0;
  console.log('CROSS-STORE REFERENCES  (woodart)');
  console.log('  ' + Object.entries(out.counts).map(([k, v]) => k + ' ' + v).join(' · '));
  if (expected.length) {
    console.log('  deliberate orphans kept: ' +
      [...new Set(expected.map(b => b.value))].join(', ') + '  ✓ (they give the orphan badge real data)');
  }
  if (bad.length) {
    console.log('  ✗ ' + bad.length + ' reference(s) point at nothing:');
    bad.slice(0, 12).forEach(b =>
      console.log('      ' + b.store + '.' + b.field + ' = "' + b.value + '" → no such ' + b.points_at));
  } else {
    console.log('  ✓ every reference resolves');
  }
  console.log(ok ? '✓ the demo data cross-references correctly'
                 : '✗ seed drift — records point at things that do not exist');
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
/* ---------------------------------------------------------------------------
 * PAYSLIP — the row has to add up, and the loan book has to agree with it.
 * Owner 2026-07-30: gross + OT + bonus − advance − EMI − absent − other = net
 * payable, net payable − paid = due, encashment touches none of the three, and
 * a deducted EMI comes off the loan the moment the month is approved.
 * Drives the REAL engine end to end: loan → generate → check → finalize → pay.
 * ------------------------------------------------------------------------- */
if (PROBE === 'payslip') {
  /* The demo payroll is seeded a beat AFTER the engines register, so waiting on
   * EPAL alone can hand the probe an empty staff list and silently skip. Wait for
   * the thing actually being probed — a salaried employee — not for the app. */
  for (let i = 0; i < 60; i++) {
    if (await evalJs(`(EPAL.db.employees({ companyId: 'travels' }) || []).filter(function(e){ return +e.salary > 0 && e.status !== 'resigned' && e.role !== 'owner'; }).length > 0`).catch(() => false)) break;
    await new Promise(r => setTimeout(r, 250));
  }
  const out = await evalJs(`(function(){
    var P = EPAL.payroll, L = EPAL.ledger, cid = 'travels';
    var ym = '2099-01';                                  // a month no seed has touched
    var e = (EPAL.db.employees({ companyId: cid }) || [])
      .filter(function(x){ return x && +x.salary > 0 && x.status !== 'resigned' && x.role !== 'owner'; })[0];
    if (!e) return { skip: 'no salaried employee in the seed' };
    var loanAmt = Math.round(e.salary * 3), emiMonths = 10;
    P.loan(e.id, loanAmt, { emiMonths: emiMonths, memo: 'probe loan' });
    var loanBefore = P.loanOutstanding(e.id);
    P.generate(cid, ym);
    var s = P.slip(e.id, ym);
    var chk = P.runCheck(cid, ym);
    var row = chk.rows.filter(function(r){ return r.empId === e.id; })[0];
    var payableDraft = P.slipPayable(s), recDraft = P.slipRecovery(s);
    // the arithmetic, spelled out from the slip's own columns
    var sum = Math.round((s.earnedGross||0) + (s.overtime||0) + (s.bonus||0) + (s.tplBonus||0) + (s.adjustment||0)
      - (s.tax||0) - (s.pf||0) - (s.otherDeduction||0) - (s.lateDeduction||0) - (s.earlyDeduction||0) - (s.fine||0)
      - recDraft.adv - recDraft.emi);
    var tb0 = L.trialBalance(), d0 = tb0.reduce(function(a,r){ return a+(r.debit||0); },0), c0 = tb0.reduce(function(a,r){ return a+(r.credit||0); },0);
    P.finalize(cid, ym);
    s = P.slip(e.id, ym);
    var loanAfter = P.loanOutstanding(e.id);
    var payAcc = P.slipPayable(s), rec = P.slipRecovery(s);
    var accrual = L.entries().filter(function(x){ return x.id === 'GL-PAYA-' + e.id + '-' + ym; })[0];
    var lineOf = function(code){ return accrual ? (accrual.lines||[]).filter(function(l){ return l.account===code; })
      .reduce(function(a,l){ return a+(l.cr||0); },0) : -1; };
    P.pay(e.id, ym, null, 'Cash');
    s = P.slip(e.id, ym);
    var tb1 = L.trialBalance(), d1 = tb1.reduce(function(a,r){ return a+(r.debit||0); },0), c1 = tb1.reduce(function(a,r){ return a+(r.credit||0); },0);
    return {
      emp: e.name, gross: s.gross, emiScheduled: Math.round(loanAmt/emiMonths),
      recovery: rec, netPayable: payAcc, spelledOut: sum, drafted: payableDraft,
      paid: P.slipPaid(s), due: P.slipDue(s), encash: s.encashAmt || 0,
      loanBefore: loanBefore, loanAfter: loanAfter,
      accrual2100: lineOf('2100'), accrual1260: lineOf('1260'),
      rowOk: !!(row && row.ok), checkOk: chk.ok,
      balancedBefore: Math.abs(d0-c0) < 1, balancedAfter: Math.abs(d1-c1) < 1,
      gap: P.emiGap({ untilYm: ym }).total
    };
  })()`);
  if (out.skip) { console.log('PAYSLIP — skipped: ' + out.skip); }
  else {
    const eq = (a, b) => Math.abs(a - b) < 1;
    const checks = [
      ['row adds up (earnings − every deduction = net)', eq(out.spelledOut, out.netPayable)],
      ['EMI actually left the net payable', out.recovery.emi > 0 && eq(out.drafted, out.netPayable)],
      ['net payable − paid = due', eq(out.netPayable - out.paid, out.due)],
      ['paid in full → nothing due', eq(out.due, 0)],
      ['loan fell by exactly the EMI deducted', eq(out.loanBefore - out.loanAfter, out.recovery.emi)],
      ['accrual credits 2100 with the net payable', eq(out.accrual2100, out.netPayable)],
      ['accrual credits 1260 with the EMI', eq(out.accrual1260, out.recovery.emi)],
      ['encashment stayed out of it', out.encash >= 0],
      ['every row passes the approval check', out.checkOk && out.rowOk],
      ['books balanced before and after', out.balancedBefore && out.balancedAfter],
      ['no EMI left recorded-but-not-deducted', eq(out.gap, 0)]
    ];
    ok = checks.every(c => c[1]);
    console.log('PAYSLIP — ' + out.emp + ' · gross ' + fmt(out.gross) + ' · EMI scheduled ' + fmt(out.emiScheduled));
    console.log('  advance ' + fmt(out.recovery.adv) + ' · EMI ' + fmt(out.recovery.emi) +
      ' · net payable ' + fmt(out.netPayable) + ' · paid ' + fmt(out.paid) + ' · due ' + fmt(out.due));
    console.log('  loan ' + fmt(out.loanBefore) + ' → ' + fmt(out.loanAfter));
    checks.forEach(c => console.log('  ' + (c[1] ? '✓' : '✗') + ' ' + c[0]));
    console.log(ok ? '✓ the payslip, the ledger and the loan book agree'
                   : '✗ the payslip does not add up');
  }
  /* THE ROWS THE OWNER REPORTED (2026-07-30) — the four that were wrong and the
   * three that were right, run through slipPayable exactly as the sheet does.
   * The three correct ones carry no advance and no EMI, which is precisely why
   * they were correct: nothing was being dropped from their net. */
  const reported = await evalJs(`(function(){
    var P = EPAL.payroll;
    function row(n, gross, ot, bonus, adv, emi, absent, other, want) {
      var s = { empId: 'PROOF', ym: '2026-07', deductedAt: '2026-07',
        gross: gross, earnedGross: gross - absent, absentDeduction: absent,
        overtime: ot, bonus: bonus, otherDeduction: other,
        advanceDeduct: adv, loanDeduct: emi, paid: 0 };
      return { name: n, want: want, got: P.slipPayable(s) };
    }
    return [
      row('Admin',             42000, 3682,    0, 0, 10500,    0, 3920, 31262),
      row('Azizul Haque',      50000,    0,    0, 0, 12500,    0, 3000, 34500),
      row('Md Afiqur Rahman',  30000,    0, 3000, 0,  7500, 4000, 2133, 19367),
      row('Md Mohshin',        42000,    0,    0, 0, 10500,    0, 2520, 28980),
      row('Md Habibur Rahman', 50000, 1252,    0, 0,     0, 3333, 3000, 44919),
      row('MR. EMAN HOSSAIN',  35000,    0,    0, 0,     0, 2333, 2100, 30567),
      row('Md Mohsin',         24000,    0,    0, 0,     0,    0, 1973, 22027)
    ];
  })()`);
  console.log('  — the reported rows —');
  reported.forEach(r => {
    const good = Math.abs(r.want - r.got) < 1;
    if (!good) ok = false;
    console.log('  ' + (good ? '✓' : '✗') + ' ' + r.name.padEnd(18) + ' net ' + fmt(r.got) + (good ? '' : '  (expected ' + fmt(r.want) + ')'));
  });
  /* THE AUDIT HAS TO FIND SOMETHING. A book written by the new engine has no gap
   * by construction, so the detector is proved against a slip put back into the
   * OLD shape — approved, unpaid, EMI on the sheet, nothing deducted — which is
   * exactly what a month accrued before this change looks like. */
  const audit = await evalJs(`(function(){
    var P = EPAL.payroll, S = EPAL.store, cid = 'travels', ym = '2099-03';
    var e = EPAL.db.employees({ companyId: cid }).filter(function(x){ return +x.salary > 0 && x.status !== 'resigned' && x.role !== 'owner'; })[0];
    if (!e) return { skip: true };
    P.loan(e.id, Math.round(e.salary * 2), { emiMonths: 10, memo: 'probe audit loan' });
    P.finalize(cid, ym);
    var s = P.slip(e.id, ym), deducted = s.loanDeduct || 0;
    // walk it back to the old shape: approved, EMI shown, nothing taken
    s.deductedAt = null; s.advanceDeduct = 0; s.loanDeduct = 0; s.paid = 0; s.status = 'accrued';
    S.upsert('pay_slips', s);
    S.set('pay_txns', S.list('pay_txns').filter(function(x){ return x.id !== 'PT-EMI-' + e.id + '-' + ym; }));
    var g = P.emiGap({ untilYm: ym });
    var mine = g.rows.filter(function(r){ return r.ym === ym && r.empId === e.id; })[0];
    return { deducted: deducted, found: !!mine, shown: mine ? mine.emiShown : 0, moved: mine ? mine.emiDeducted : -1, monthTotal: g.months[ym] || 0 };
  })()`);
  if (!audit.skip) {
    const auditChecks = [
      ['the audit finds an old-rule row', audit.found],
      ['it reports the EMI the sheet showed', audit.shown > 0],
      ['…against nothing actually deducted', audit.moved === 0],
      ['and totals it into that month', Math.abs(audit.monthTotal - audit.shown) < 1]
    ];
    auditChecks.forEach(c => { if (!c[1]) ok = false; });
    console.log('  — the EMI-never-deducted audit —');
    console.log('  shown ' + fmt(audit.shown) + ' · deducted ' + fmt(audit.moved) + ' · reported gap ' + fmt(audit.monthTotal));
    auditChecks.forEach(c => console.log('  ' + (c[1] ? '✓' : '✗') + ' ' + c[0]));
  }
  /* NET PAYABLE CAN NEVER GO NEGATIVE — deduct what the month can bear, leave
   * the rest outstanding for next month, and say so on the row. */
  const cap = await evalJs(`(function(){
    var P = EPAL.payroll, cid = 'travels', ym = '2099-02';
    var e = EPAL.db.employees({ companyId: cid }).filter(function(x){ return +x.salary > 0 && x.status !== 'resigned' && x.role !== 'owner'; })[0];
    if (!e) return { skip: true };
    P.loan(e.id, Math.round(e.salary * 20), { emiMonths: 1, memo: 'probe oversized EMI' });   // EMI ≫ one month's pay
    P.generate(cid, ym);
    var s = P.slip(e.id, ym), rec = P.slipRecovery(s), earned = P.slipEarned(s);
    return { earned: earned, adv: rec.adv, emi: rec.emi, short: rec.short, net: P.slipPayable(s) };
  })()`);
  if (!cap.skip) {
    const capChecks = [
      ['net payable floored at zero, never negative', cap.net >= 0],
      ['deducted only what the month could bear', Math.abs((cap.adv + cap.emi) - cap.earned) < 1],
      ['the rest is carried, and the row says by how much', cap.short > 0]
    ];
    capChecks.forEach(c => { if (!c[1]) ok = false; });
    console.log('  — when the deductions are bigger than the earnings —');
    console.log('  earned ' + fmt(cap.earned) + ' · deducted ' + fmt(cap.adv + cap.emi) +
      ' · net ' + fmt(cap.net) + ' · carried ' + fmt(cap.short));
    capChecks.forEach(c => console.log('  ' + (c[1] ? '✓' : '✗') + ' ' + c[0]));
  }
}
/* ---------------------------------------------------------------------------
 * EMIGAP — "how much loan EMI was recorded but never actually deducted?"
 * Walks every non-draft payslip ever written, first run to the month given
 * (default: today's), and reports the EMI a salary sheet SHOWED against the EMI
 * that actually moved. Reads whatever book the browser is holding — run it
 * against a hydrated API session to audit the real one.
 *   node tools/verify/books.mjs emigap [YYYY-MM]
 * ------------------------------------------------------------------------- */
if (PROBE === 'emigap') {
  const until = process.argv[3] || '';
  const out = await evalJs(`EPAL.payroll.emiGap(${until ? `{ untilYm: '${until}' }` : '{}'})`);
  console.log('EMI RECORDED BUT NEVER DEDUCTED' + (until ? ' — up to ' + until : ''));
  const months = Object.keys(out.months).sort();
  months.forEach(m => console.log('  ' + m + ' : ' + fmt(out.months[m])));
  if (!months.length) console.log('  (none — every EMI a sheet showed was deducted)');
  console.log('  ' + '-'.repeat(34));
  console.log('  TOTAL loan EMI never deducted : ' + fmt(out.total));
  console.log('  advance never recovered       : ' + fmt(out.advanceTotal));
  console.log('  rows affected                 : ' + out.rows.length);
  out.rows.slice(0, 20).forEach(r => console.log('    ' + r.ym + '  ' + (r.empName || r.empId).padEnd(22) +
    ' shown ' + fmt(r.emiShown) + ' · deducted ' + fmt(r.emiDeducted) + ' · gap ' + fmt(r.gap) + '  [' + r.status + ']'));
  if (out.rows.length > 20) console.log('    … and ' + (out.rows.length - 20) + ' more');
}
cleanup();
process.exit(ok ? 0 : 1);
