/* ============================================================================
 * EPAL GROUP ERP · tools/verify/parity.mjs
 * ----------------------------------------------------------------------------
 * PIXEL-PARITY HARNESS for the Tailwind conversion (Phase 4 / owner's rebuild
 * spec): screenshots routes in headless Chrome and byte-compares BEFORE vs
 * AFTER shots. The conversion contract is "no one-pixel difference", so the
 * pass bar is byte-identical PNGs (same machine + same Chrome + frozen
 * animations ⇒ deterministic rendering; any real pixel change breaks equality).
 *
 *   node tools/verify/parity.mjs shoot <outDir> <route[,route…]> [dark|light|both]
 *   node tools/verify/parity.mjs diff  <dirA> <dirB>
 *
 * Typical flow:
 *   node tools/verify/parity.mjs shoot .parity/before travels/passport-mgmt,travels/passport-mgmt/expiry both
 *   …convert the screen…
 *   node tools/verify/parity.mjs shoot .parity/after  travels/passport-mgmt,travels/passport-mgmt/expiry both
 *   node tools/verify/parity.mjs diff  .parity/before .parity/after
 *
 * DETERMINISM measures (do not remove):
 *   · fixed viewport 1440×900 @1x via Emulation.setDeviceMetricsOverride
 *   · every CSS animation/transition is seeked to t=0 and PAUSED right before
 *     capture (document.getAnimations) — ambient atmosphere keyframes loop
 *     forever and would otherwise differ frame-to-frame
 *   · same wait ladder as sweep.mjs (poll origin → seed theme → poll boot)
 * Inherits sweep.mjs's hard-won gotchas (JSON theme value, seed after origin,
 * poll don't sleep, kill only our own Chrome PID).
 * ========================================================================= */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MODE = (process.argv[2] || '').toLowerCase();

/* Tolerance: byte-equal is the first gate, but headless Chrome shows ~1px of
 * antialiasing jitter between two runs of IDENTICAL code (measured: 1 differing
 * pixel at the icon rail across a 1.3M-pixel frame). A real conversion mistake
 * moves hundreds+ of pixels, so byte-unequal pairs escalate to a canvas pixel
 * diff and PASS at ≤ JITTER_PX differing pixels. */
const JITTER_PX = 2;

if (MODE === 'diff') {
  const [a, b] = [process.argv[3], process.argv[4]].map(p => path.resolve(p));
  const names = fs.readdirSync(a).filter(f => f.endsWith('.png')).sort();
  const suspects = [];
  for (const n of names) {
    const fa = path.join(a, n), fb = path.join(b, n);
    if (!fs.existsSync(fb)) { console.log(`MISSING  ${n} (no counterpart in ${b})`); suspects.push({ n, missing: true }); continue; }
    if (fs.readFileSync(fa).equals(fs.readFileSync(fb))) console.log(`SAME     ${n} (byte-identical)`);
    else suspects.push({ n, fa, fb });
  }
  let fails = suspects.filter(s => s.missing).length;
  const toCheck = suspects.filter(s => !s.missing);
  if (toCheck.length) {
    for (const s of toCheck) {
      const r = await pixelDiff(s.fa, s.fb);
      const ok = r && r.pixels <= JITTER_PX;
      console.log(`${ok ? 'SAME~   ' : 'DIFFER  '} ${s.n} (${r ? r.pixels + 'px differ' + (r.box ? ' @ [' + r.box + ']' : '') : 'pixel diff failed'})`);
      if (!ok) fails++;
    }
  }
  console.log(fails === 0 ? `\n✓ PIXEL-IDENTICAL (≤${JITTER_PX}px AA jitter) — ${names.length} shots pass` : `\n✗ ${fails} of ${names.length} shots differ beyond jitter`);
  process.exit(fails === 0 ? 0 : 1);
}

/* Canvas pixel diff of two PNGs via headless Chrome; returns {pixels, box, w, h}. */
async function pixelDiff(fa, fb) {
  const html = `<canvas id=c></canvas><script>
    async function load(u){ const i=new Image(); i.src=u; await i.decode(); return i; }
    (async () => {
      const [a,b] = await Promise.all([load('/__a.png'), load('/__b.png')]);
      const c=document.getElementById('c'); c.width=a.width; c.height=a.height;
      const g=c.getContext('2d',{willReadFrequently:true});
      g.drawImage(a,0,0); const da=g.getImageData(0,0,c.width,c.height).data;
      g.clearRect(0,0,c.width,c.height); g.drawImage(b,0,0); const db=g.getImageData(0,0,c.width,c.height).data;
      let n=0,minX=1e9,minY=1e9,maxX=-1,maxY=-1;
      for(let y=0;y<c.height;y++) for(let x=0;x<c.width;x++){ const i=(y*c.width+x)*4;
        if(da[i]!==db[i]||da[i+1]!==db[i+1]||da[i+2]!==db[i+2]||da[i+3]!==db[i+3]){ n++;
          if(x<minX)minX=x; if(x>maxX)maxX=x; if(y<minY)minY=y; if(y>maxY)maxY=y; } }
      window.__result = { pixels:n, box: n? [minX,minY,maxX,maxY] : null, w:c.width, h:c.height };
    })();
  </scr` + `ipt>`;
  const srv = http.createServer((req, res) => {
    if (req.url === '/__a.png') { res.writeHead(200, {'content-type':'image/png'}); res.end(fs.readFileSync(fa)); return; }
    if (req.url === '/__b.png') { res.writeHead(200, {'content-type':'image/png'}); res.end(fs.readFileSync(fb)); return; }
    res.writeHead(200, {'content-type':'text/html'}); res.end(html);
  });
  const LPORT = 9500 + ((process.pid + Math.floor(Math.random() * 90)) % 300);
  await new Promise(r => srv.listen(LPORT, r));
  const CH = ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe','/usr/bin/google-chrome']
    .find(p => { try { return fs.existsSync(p); } catch { return false; } });
  const ud = path.join(process.env.TEMP || '/tmp', 'epal-pixdiff-' + process.pid + '-' + LPORT);
  const LCDP = 9900 + ((process.pid + LPORT) % 90);
  const ch = spawn(CH, ['--headless=new','--disable-gpu',`--remote-debugging-port=${LCDP}`,`--user-data-dir=${ud}`,`http://127.0.0.1:${LPORT}/`], { stdio: 'ignore' });
  try {
    let wsUrl = null;
    for (let i = 0; i < 50 && !wsUrl; i++) {
      try { const list = await (await fetch(`http://127.0.0.1:${LCDP}/json`)).json();
        const pg = list.find(t => t.type === 'page' && t.url.includes(String(LPORT)));
        if (pg) wsUrl = pg.webSocketDebuggerUrl; } catch {}
      await new Promise(r => setTimeout(r, 200));
    }
    if (!wsUrl) return null;
    const w = new WebSocket(wsUrl); await new Promise(r => w.addEventListener('open', r));
    let mid = 0; const pend = new Map();
    w.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } });
    const call = (method, params) => new Promise(res => { const id = ++mid; pend.set(id, res); w.send(JSON.stringify({ id, method, params })); });
    let out = null;
    for (let i = 0; i < 50 && !out; i++) {
      const r = await call('Runtime.evaluate', { expression: 'window.__result ? JSON.stringify(window.__result) : null', returnByValue: true });
      out = r?.result?.value; if (!out) await new Promise(rr => setTimeout(rr, 200));
    }
    return out ? JSON.parse(out) : null;
  } finally { try { ch.kill(); } catch {} srv.close(); }
}

if (MODE === 'locate') {
  // Pixel-locate the difference between two PNGs: loads both in Chrome, canvas
  // getImageData-diffs them, prints the differing-pixel count + bounding box.
  const [fa, fb] = [process.argv[3], process.argv[4]].map(p => path.resolve(p));
  const html = `<canvas id=c></canvas><script>
    async function load(u){ const i=new Image(); i.src=u; await i.decode(); return i; }
    (async () => {
      const [a,b] = await Promise.all([load('/__a.png'), load('/__b.png')]);
      const c=document.getElementById('c'); c.width=a.width; c.height=a.height;
      const g=c.getContext('2d',{willReadFrequently:true});
      g.drawImage(a,0,0); const da=g.getImageData(0,0,c.width,c.height).data;
      g.clearRect(0,0,c.width,c.height); g.drawImage(b,0,0); const db=g.getImageData(0,0,c.width,c.height).data;
      let n=0,minX=1e9,minY=1e9,maxX=-1,maxY=-1;
      for(let y=0;y<c.height;y++) for(let x=0;x<c.width;x++){ const i=(y*c.width+x)*4;
        if(da[i]!==db[i]||da[i+1]!==db[i+1]||da[i+2]!==db[i+2]||da[i+3]!==db[i+3]){ n++;
          if(x<minX)minX=x; if(x>maxX)maxX=x; if(y<minY)minY=y; if(y>maxY)maxY=y; } }
      window.__result = { pixels:n, box: n? [minX,minY,maxX,maxY] : null, w:c.width, h:c.height };
    })();
  </scr` + `ipt>`;
  const srv = http.createServer((req, res) => {
    if (req.url === '/__a.png') { res.writeHead(200, {'content-type':'image/png'}); res.end(fs.readFileSync(fa)); return; }
    if (req.url === '/__b.png') { res.writeHead(200, {'content-type':'image/png'}); res.end(fs.readFileSync(fb)); return; }
    res.writeHead(200, {'content-type':'text/html'}); res.end(html);
  });
  const LPORT = 9500 + (process.pid % 300);
  await new Promise(r => srv.listen(LPORT, r));
  const CH = ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe','/usr/bin/google-chrome']
    .find(p => { try { return fs.existsSync(p); } catch { return false; } });
  const ud = path.join(process.env.TEMP || '/tmp', 'epal-locate-' + process.pid);
  const LCDP = 9900 + (process.pid % 90);
  const ch = spawn(CH, ['--headless=new','--disable-gpu',`--remote-debugging-port=${LCDP}`,`--user-data-dir=${ud}`,`http://127.0.0.1:${LPORT}/`], { stdio: 'ignore' });
  let wsUrl = null;
  for (let i = 0; i < 50 && !wsUrl; i++) {
    try { const list = await (await fetch(`http://127.0.0.1:${LCDP}/json`)).json();
      const pg = list.find(t => t.type === 'page' && t.url.includes(String(LPORT)));
      if (pg) wsUrl = pg.webSocketDebuggerUrl; } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  const w = new WebSocket(wsUrl); await new Promise(r => w.addEventListener('open', r));
  let mid = 0; const pend = new Map();
  w.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } });
  const call = (method, params) => new Promise(res => { const id = ++mid; pend.set(id, res); w.send(JSON.stringify({ id, method, params })); });
  let out = null;
  for (let i = 0; i < 50 && !out; i++) {
    const r = await call('Runtime.evaluate', { expression: 'window.__result ? JSON.stringify(window.__result) : null', returnByValue: true });
    out = r?.result?.value; if (!out) await new Promise(rr => setTimeout(rr, 200));
  }
  console.log(path.basename(fa), 'vs', path.basename(fb), '→', out || 'no result');
  try { ch.kill(); } catch {} srv.close();
  process.exit(0);
}

if (MODE !== 'shoot') { console.error('usage: parity.mjs shoot <outDir> <routes> [dark|light|both] | diff <a> <b> | locate <a.png> <b.png>'); process.exit(2); }

const OUT = path.resolve(process.argv[3]);
const ROUTES = (process.argv[4] || '').split(',').map(s => s.trim()).filter(Boolean);
const ARG = (process.argv[5] || 'both').toLowerCase();
const THEMES = ARG === 'both' ? ['dark', 'light'] : [ARG];
if (!ROUTES.length) { console.error('no routes given'); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });

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
if (!CHROME) { console.error('No Chrome found.'); process.exit(2); }

// FIXED profile dir (not per-pid): localStorage — and therefore the demo seed's
// randomised data — persists across runs, so before/after shots render the SAME
// records. Belt-and-braces: Math.random is also seeded below for any runtime
// randomness. Delete the folder to re-roll the dataset deliberately.
const userDir = path.join(process.env.TEMP || '/tmp', 'epal-parity-profile');
let chrome;
const cleanup = () => { try { chrome && chrome.kill(); } catch {} try { server.close(); } catch {} };
process.on('exit', cleanup);

// Launch with retry: the FIXED profile dir means a just-finished previous run
// may still hold Chrome's singleton lock for a moment — respawn until CDP is up.
async function launchChrome() {
  for (let attempt = 1; attempt <= 5; attempt++) {
    chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--hide-scrollbars', '--force-device-scale-factor=1',
      `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${userDir}`, 'about:blank'], { stdio: 'ignore' });
    for (let i = 0; i < 40; i++) {
      try { const j = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json();
        if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl; } catch {}
      await new Promise(r => setTimeout(r, 250));
    }
    try { chrome.kill(); } catch {}
    await new Promise(r => setTimeout(r, 1500));
  }
  throw new Error('CDP never came up after 5 launch attempts');
}
const cdpUrl = launchChrome;
let msgId = 0; const pending = new Map(); let ws, sessionId;
function send(method, params = {}, sid) {
  const id = ++msgId;
  return new Promise((res, rej) => { pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params, sessionId: sid })); });
}
ws = new WebSocket(await cdpUrl());
await new Promise(r => ws.addEventListener('open', r));
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id);
    if (m.error) p.rej(new Error(JSON.stringify(m.error))); else p.res(m.result); }
});
const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
({ sessionId } = await send('Target.attachToTarget', { targetId, flatten: true }));
await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
// Deterministic Math.random (mulberry32, fixed seed) injected BEFORE any app
// script on every navigation — any runtime randomness renders identically.
await send('Page.addScriptToEvaluateOnNewDocument', { source: [
  '(function(){',
  '  var s = 305419896;',                                  // fixed seed
  '  Math.random = function(){',
  '    s = (s + 0x6D2B79F5) | 0;',
  '    var t = Math.imul(s ^ (s >>> 15), 1 | s);',
  '    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;',
  '    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;',
  '  };',
  '})();'
].join('\n') }, sessionId);
const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed');
  return r.result.value;
};

for (const theme of THEMES) {
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` }, sessionId);
  let onOrigin = false;
  for (let i = 0; i < 100; i++) {
    if ((await evalJs(`location.origin`).catch(() => null)) === `http://127.0.0.1:${PORT}`) { onOrigin = true; break; }
    await new Promise(r => setTimeout(r, 100));
  }
  if (!onOrigin) { console.error(`[${theme}] never reached origin`); process.exit(1); }
  await evalJs(`localStorage.setItem('epal.v1.ui.theme', ${JSON.stringify(JSON.stringify(theme))}); true`);
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html#/group/dashboard` }, sessionId);
  let booted = false;
  for (let i = 0; i < 100; i++) {
    await new Promise(r => setTimeout(r, 200));
    const ok = await evalJs(`!!(window.EPAL && EPAL.config && EPAL.router &&
      document.documentElement.getAttribute('data-theme') === ${JSON.stringify(theme)})`).catch(() => false);
    if (ok) { booted = true; break; }
  }
  if (!booted) { console.error(`[${theme}] app never booted`); process.exit(1); }

  // WARM-UP circuit: visit every route once uncaptured so late-created layers
  // (THREE canvas, icon font, engines) fully settle — the first-captured theme
  // was otherwise racing them (dark differed run-to-run while light matched).
  for (const route of ROUTES) {
    await evalJs(`location.hash = '#/${route}'; true`);
    await new Promise(r => setTimeout(r, 400));
  }
  await new Promise(r => setTimeout(r, 800));

  for (const route of ROUTES) {
    await evalJs(`location.hash = '#/${route}'; true`);
    await new Promise(r => setTimeout(r, 900));            // settle render + entry animations
    await evalJs(`document.fonts.ready.then(() => true)`); // glyphs identical across runs
    // Deterministic animation freeze: FINITE animations jump to their END state
    // (the settled UI a user sees — also removes the finished-vs-running race
    // around the settle wait); INFINITE loops (ambient scenes) rewind to t=0
    // and pause so every run captures the exact same frame.
    await evalJs(`document.getAnimations().forEach(a => { try {
        var t = a.effect && a.effect.getComputedTiming ? a.effect.getComputedTiming() : {};
        if (t.iterations === Infinity) { a.currentTime = 0; a.pause(); } else { a.finish(); }
      } catch (e) {} }); true`);
    // MASK the two genuinely non-deterministic layers (identically on every
    // run, so before/after comparison is unaffected):
    //  · #ambient3d — the THREE.js ambient scene: RAF-driven WebGL, moving
    //    sprites, cannot be frozen via getAnimations
    //  · .notif-dot — the unread-notification count: engines append per boot
    await evalJs(`(function(){ var st = document.getElementById('parity-mask');
      if (!st) { st = document.createElement('style'); st.id = 'parity-mask'; document.head.appendChild(st); }
      st.textContent = '#ambient3d{display:none!important} #notif-dot,.notif-dot{display:none!important}';
      return true; })()`);
    await new Promise(r => setTimeout(r, 150));            // let the freeze paint
    const shot = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
    const name = `${route.replace(/[\/?=&]/g, '_')}.${theme}.png`;
    fs.writeFileSync(path.join(OUT, name), Buffer.from(shot.data, 'base64'));
    console.log(`[${theme}] shot ${name}`);
  }
}
cleanup();
console.log(`\n${ROUTES.length * THEMES.length} screenshots → ${OUT}`);
process.exit(0);
