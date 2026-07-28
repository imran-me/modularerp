/* ============================================================================
 * SAMPLE BOOK — a month of real-shaped trading, posted through the REAL paths
 * ----------------------------------------------------------------------------
 * Owner, 2026-07-28: "push 5 ticket sell, 5 visa sell, 5 others sells, put some
 * sell related expenses, other expense, so i have a full view of all. These
 * should be like real data."
 *
 * WHAT THIS IS. Not a fixture and not a SQL dump: it drives the same functions
 * the desks call — db.postSale, EPAL.pay.*, EPAL.ledger.post — so every book
 * fills exactly as it would if a person had typed each entry. If a chain is
 * broken, this script shows it rather than papering over it.
 *
 * WHAT IT WRITES
 *   · 5 air tickets   — mixed: paid now / on credit / sub-agent with commission
 *   · 5 visa files    — mixed countries, one still awaiting payment
 *   · 5 other sales   — contract seats, hotel, EMD baggage, package, consultancy
 *   · sale-related expenses — agent commission payouts, BSP settlement, courier
 *   · running expenses — rent, salary, utilities, marketing, tea, conveyance
 *   · one portal top-up, one bank transfer, one petty-cash IOU + settlement
 * Dates spread across the month so trends, aging and monthly KPIs all have shape.
 *
 * RUN:  node tools/demo/sample-book.mjs            (demo data, this machine)
 *       node tools/demo/sample-book.mjs --keep     (leave the browser profile)
 * It prints the books afterwards, so the output IS the verification.
 * ==========================================================================*/
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const PORT = 9911, CDP = 9912;
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.woff':'font/woff','.woff2':'font/woff2' };

const server = http.createServer((q, s) => {
  const u = decodeURIComponent(q.url.split('?')[0]);
  fs.readFile(path.join(ROOT, u === '/' ? 'index.html' : u), (e, b) => {
    if (e) { s.writeHead(404); s.end('x'); return; }
    s.writeHead(200, { 'content-type': MIME[path.extname(u)] || 'application/octet-stream' }); s.end(b);
  });
});
await new Promise(r => server.listen(PORT, r));
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe','/usr/bin/google-chrome'].find(p => fs.existsSync(p));
if (!CHROME) { console.error('Chrome not found'); process.exit(1); }
const profile = path.join(process.env.TEMP || '/tmp', 'epal-sample-' + process.pid);
const ch = spawn(CHROME, ['--headless=new','--disable-gpu','--no-first-run',`--remote-debugging-port=${CDP}`,`--user-data-dir=${profile}`,'about:blank'], { stdio:'ignore' });
process.on('exit', () => { try { ch.kill(); } catch {} try { server.close(); } catch {} });

let ws = null;
for (let i = 0; i < 80 && !ws; i++) {
  try { ws = (await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json()).webSocketDebuggerUrl; } catch {}
  if (!ws) await new Promise(r => setTimeout(r, 250));
}
let id = 0; const pend = new Map();
const W = new WebSocket(ws); await new Promise(r => W.addEventListener('open', r));
W.addEventListener('message', e => { const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } });
const send = (m, p = {}, s) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); W.send(JSON.stringify({ id:i, method:m, params:p, sessionId:s })); });
const { targetId } = await send('Target.createTarget', { url:'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten:true });
await send('Page.enable', {}, sessionId); await send('Runtime.enable', {}, sessionId);
const ev = async expr => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
await send('Page.navigate', { url:`http://127.0.0.1:${PORT}/index.html#/travels/accounts/overview` }, sessionId);
/* WAIT FOR THE ENGINES, not just the objects. A sale posts its journals through
 * the ledger's `sale:recorded` listener, which is attached in bootEngines — and
 * the globals exist well before that runs. Waiting only for EPAL.ledger wrote
 * fifteen sales with no journals behind them, which is the very failure this
 * script is meant to catch. A rendered page means boot finished. */
for (let i = 0; i < 200; i++) {
  await new Promise(r => setTimeout(r, 200));
  if (await ev('!!(window.EPAL&&EPAL.db&&EPAL.ledger&&EPAL.pay&&EPAL.sampleBook&&document.querySelector("#view .page"))').catch(() => 0)) break;
}
await new Promise(r => setTimeout(r, 400));

/* ---- the book — ONE implementation, shared with the app (platform/kit/sample-book.js)
 * so the button in Master Accounts and this CLI can never drift apart -------- */
const report = await ev(`EPAL.sampleBook.write()`);

const money = n => '৳' + Number(n).toLocaleString('en-IN');
console.log('\n╔══════════════════════════════════════════════════════════════');
console.log('║  SAMPLE BOOK — Epal Travels, July 2026');
console.log('╚══════════════════════════════════════════════════════════════');
console.log(`\nWritten: ${report.made.tickets} air tickets · ${report.made.visas} visa files · ${report.made.other} other sales`
  + `\n         ${report.made.expenses} expense vouchers · ${report.made.moves} cash/commission movements`);

console.log('\n── ACCOUNTS (balance after everything) ──');
report.accounts.forEach(a => console.log('   ' + a.name.padEnd(30) + money(a.balance).padStart(14)));
console.log('   ' + 'Galileo wallet (1180)'.padEnd(30) + money(report.wallet).padStart(14));

console.log('\n── THIS SAMPLE BOOK ON ITS OWN (the 15 sales + their expenses) ──');
console.log('   Revenue                      ' + money(report.mine.revenue).padStart(14));
console.log('   Cost of sales               −' + money(report.mine.cogs).padStart(14));
console.log('   GROSS PROFIT                 ' + money(report.mine.gross).padStart(14)
  + '   (' + Math.round(report.mine.gross / report.mine.revenue * 100) + '% margin)');
console.log('   Operating expenses          −' + money(report.mine.opex).padStart(14));
console.log('   NET PROFIT                   ' + money(report.mine.net).padStart(14));
console.log('\n   every head it touched:');
report.mine.heads.forEach(h => console.log('     ' + h));

console.log('\n── THE WHOLE COMPANY BOOK (this month plus everything already there) ──');
console.log('   Revenue                      ' + money(report.pnl.revenue).padStart(14));
console.log('   Cost of sales               −' + money(report.pnl.cogs).padStart(14));
console.log('   ────────────────────────────────────────────');
console.log('   GROSS PROFIT                 ' + money(report.pnl.gross).padStart(14));
console.log('   Operating expenses          −' + money(report.pnl.opex).padStart(14));
console.log('   ────────────────────────────────────────────');
console.log('   NET PROFIT                   ' + money(report.pnl.net).padStart(14));

console.log('\n── WHO OWES WHOM ──');
console.log('   Customers owe us (1200)      ' + money(report.owed.customers));
console.log('   Sub-agents owe us (1150)     ' + money(report.owed.agents));
console.log('   We owe vendors (2000)        ' + money(report.owed.vendors));
console.log('   Staff hold advances (1250)   ' + money(report.owed.staffAdvance));

console.log('\n── PROOF ──');
console.log('   journals posted              ' + report.journals);
console.log('   rows in account histories    ' + report.registerRows);
console.log('   trial balance                ' + money(report.trial.debit) + ' / ' + money(report.trial.credit)
  + (report.trial.out === 0 ? '   ✓ balances' : '   ✗ OUT BY ' + report.trial.out));
console.log('   reaches the group P&L        ' + money(report.group));
console.log('');
if (!process.argv.includes('--keep')) { try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} }
process.exit(report.trial.out === 0 ? 0 : 1);
