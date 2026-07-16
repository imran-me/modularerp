/* ============================================================================
 * EPAL GROUP ERP · tools/verify/sweep.mjs
 * ----------------------------------------------------------------------------
 * Headless-Chrome BOOT SWEEP — the repo's regression guard. Serves the static
 * site, boots it in a real headless Chrome over CDP (no puppeteer, no deps),
 * walks EVERY route in the LIVE registry (EPAL.config) in the chosen theme, and
 * asserts 0 console errors + 0 render failures.
 *
 *   node tools/verify/sweep.mjs            # dark (default)
 *   node tools/verify/sweep.mjs light      # stored-light theme
 *   node tools/verify/sweep.mjs both       # dark then light, one process
 *
 * Requires Node 18+ (global fetch + WebSocket) and Google Chrome installed.
 * Exit code 0 = clean, 1 = at least one failing route.
 *
 * HARD-WON GOTCHAS baked in (do not "simplify" these away):
 *   1. The stored theme is JSON — write '"light"' WITH quotes; EPAL.store
 *      JSON-parses on read, and a bare value silently falls back to dark.
 *   2. <html data-theme> is a static default rewritten only at boot step 3
 *      (which waits on the icon-font CDN) — POLL for data-theme, never sleep.
 *   3. Seed the theme only AFTER the page reaches the server origin — a write
 *      to about:blank's localStorage is lost when the real navigate lands.
 *   4. Kill ONLY our own spawned Chrome PID (never `taskkill /IM chrome.exe` —
 *      that closes the developer's real browser). Random debug port per run.
 * ========================================================================= */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ARG = (process.argv[2] || 'dark').toLowerCase();
const THEMES = ARG === 'both' ? ['dark', 'light'] : [ARG];
const PORT = 9200 + (process.pid % 300);
const CDP_PORT = 9600 + (process.pid % 300);

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2' };

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(ROOT, url === '/' ? 'index.html' : url);
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
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
if (!CHROME) { console.error('No Chrome found — install Google Chrome to run the sweep.'); process.exit(2); }

const userDir = path.join(process.env.TEMP || '/tmp', 'epal-sweep-' + process.pid);
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${userDir}`, 'about:blank'], { stdio: 'ignore' });
const cleanup = () => { try { chrome.kill(); } catch {} try { server.close(); } catch {} };
process.on('exit', cleanup);

async function cdpUrl() {
  for (let i = 0; i < 60; i++) {
    try { const j = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json();
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl; } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('CDP never came up');
}
let msgId = 0; const pending = new Map(); let ws, sessionId;
const errors = [];
function send(method, params = {}, sid) {
  const id = ++msgId;
  return new Promise((res, rej) => { pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params, sessionId: sid })); });
}
ws = new WebSocket(await cdpUrl());
await new Promise(r => ws.addEventListener('open', r));
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id);
    if (m.error) p.rej(new Error(JSON.stringify(m.error))); else p.res(m.result); return; }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails; errors.push('EXCEPTION: ' + (d.exception?.description || d.text));
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error')
    errors.push('CONSOLE: ' + m.params.args.map(a => a.description || a.value).join(' '));
});
const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
({ sessionId } = await send('Target.attachToTarget', { targetId, flatten: true }));
await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);
const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed');
  return r.result.value;
};

let anyFail = false;
for (const theme of THEMES) {
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` }, sessionId);
  // Gotcha 3: wait for the real origin before seeding the theme.
  let onOrigin = false;
  for (let i = 0; i < 100; i++) {
    if ((await evalJs(`location.origin`).catch(() => null)) === `http://127.0.0.1:${PORT}`) { onOrigin = true; break; }
    await new Promise(r => setTimeout(r, 100));
  }
  if (!onOrigin) { console.error(`[${theme}] page never reached the server origin`); anyFail = true; continue; }
  // Gotcha 1: theme is a JSON string.
  await evalJs(`localStorage.setItem('epal.v1.ui.theme', ${JSON.stringify(JSON.stringify(theme))}); true`);
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html#/group/dashboard` }, sessionId);
  // Gotcha 2: poll for boot + the applied theme.
  let booted = false;
  for (let i = 0; i < 100; i++) {
    await new Promise(r => setTimeout(r, 200));
    const ok = await evalJs(`!!(window.EPAL && EPAL.config && EPAL.router &&
      document.documentElement.getAttribute('data-theme') === ${JSON.stringify(theme)})`).catch(() => false);
    if (ok) { booted = true; break; }
  }
  if (!booted) { console.error(`[${theme}] app never booted`); anyFail = true; continue; }

  const routes = await evalJs(`(function(){ var out = [];
    EPAL.config.companies.forEach(function (c) { (c.modules || []).forEach(function (m) {
      out.push(c.id + '/' + m.id);
      (m.subs || []).forEach(function (s) { out.push(c.id + '/' + m.id + '/' + s.id); });
    }); }); return out; })()`);
  console.log(`[${theme}] booted · sweeping ${routes.length} routes`);

  const fails = [];
  for (const route of routes) {
    errors.length = 0;
    await evalJs(`location.hash = '#/${route}'; true`);
    await new Promise(r => setTimeout(r, 130));
    const rendered = await evalJs(`(function(){ var v = document.getElementById('view'); return !!(v && v.children.length > 0); })()`)
      .catch(e => { errors.push('EVAL: ' + e.message); return false; });
    if (errors.length || !rendered) fails.push({ route, rendered, errors: [...errors] });
  }
  if (fails.length) {
    anyFail = true;
    console.log(`[${theme}] ✗ ${fails.length} FAILING ROUTES:`);
    fails.forEach(f => { console.log(`  #/${f.route}  rendered=${f.rendered}`);
      f.errors.slice(0, 4).forEach(e => console.log('     ' + e.slice(0, 260))); });
  } else {
    console.log(`[${theme}] ✓ ${routes.length}/${routes.length} routes · 0 console errors · 0 render failures`);
  }
}
cleanup();
process.exit(anyFail ? 1 : 0);
